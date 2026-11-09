# Admin Preservation — Implementation Plan

## Objetivo e invariante

Garantir, para todas as operações de gestão Staff disponíveis à aplicação, que nenhuma revogação ou alteração de papel resulte em zero memberships Admin ativas. A regra deve ser aplicada no banco, sob serialização compartilhada por `grant_staff_role()` e `revoke_staff_role()`, e resistir a operações concorrentes.

Esta análise cobre o código versionado. Não confirma o estado de migrations ou de funções já aplicadas a qualquer banco remoto.

## 1. Fluxo atual de `revoke_staff_role()`

Arquivo: `supabase/migrations/20261110030000_staff_functions.sql`, aproximadamente linhas 225–286.

1. Captura `auth.uid()` em `actor_id`.
2. Antes de adquirir lock, exige que o ator esteja autenticado e `private.is_admin()` retorne verdadeiro (linhas 238–240).
3. Recusa alvo nulo, auto-revogação e justificativa inválida.
4. Adquire lock exclusivo da tabela `private.staff_members` (linha 248).
5. Consulta papel/status atuais do alvo com `FOR UPDATE`; recusa se não existir ou não estiver ativo (linhas 250–257).
6. Para alvo Admin, conta Admins ativos e recusa se a contagem for menor ou igual a um (linhas 259–264).
7. Marca a membership como `revoked` e grava evento na `private.admin_audit_log`.

O bloqueio explícito da última revogação já existe e retorna SQLSTATE `23514`.

## 2. Fluxo atual de `grant_staff_role()`

Arquivo: `supabase/migrations/20261110030000_staff_functions.sql`, aproximadamente linhas 151–223.

1. Captura `auth.uid()` em `actor_id`.
2. Antes de adquirir lock, exige que o ator esteja autenticado e seja Admin ativo por `private.is_admin()` (linhas 165–167).
3. Recusa alvo nulo, auto-operação, papel inválido, justificativa inválida e usuário inexistente.
4. Converte o papel solicitado para `private.staff_role`.
5. Adquire lock exclusivo de `private.staff_members` (linha 182).
6. Consulta role/status atuais do alvo com `FOR UPDATE` (linhas 184–188).
7. Se o registro já estiver ativo com o mesmo papel, recusa a operação; caso contrário, atualiza ou insere a membership ativa.
8. Registra concessão/alteração em `private.admin_audit_log`.

Não há proteção para impedir que essa atualização rebaixe um Admin ativo, e a autorização do ator não é revalidada depois de adquirir o lock.

## 3–4. Lock e autorização atuais

| RPC | Autorização atual do ator | Lock atual |
|---|---|---|
| `grant_staff_role()` | `IF actor_id IS NULL OR NOT private.is_admin()` antes das validações do alvo e do lock (linhas 165–167). | `LOCK TABLE private.staff_members IN EXCLUSIVE MODE` na linha 182. |
| `revoke_staff_role()` | `IF actor_id IS NULL OR NOT private.is_admin()` antes das validações do alvo e do lock (linhas 238–240). | `LOCK TABLE private.staff_members IN EXCLUSIVE MODE` na linha 248. |

As APIs também verificam sessão/membership e `staff.manage`, mas essas verificações não substituem a autorização transacional das RPCs. `app/api/admin/staff/route.ts` chama `grant_staff_role()` no POST; `app/api/admin/staff/[id]/revoke/route.ts` chama `revoke_staff_role()` no POST. Ambas propagam o SQLSTATE por `rpcErrorStatus()` em `lib/auth/staff-api.ts`, que já mapeia `23514` para HTTP 409.

## 5. Janela de concorrência

Com dois Admins ativos, A e B, duas chamadas podem validar `private.is_admin()` antes de qualquer uma adquirir o lock:

1. A solicita rebaixar B para Reviewer e B solicita rebaixar A para Support.
2. Ambas passam pela verificação inicial de Admin.
3. A obtém o lock, rebaixa B e confirma a transação, deixando A como único Admin.
4. B obtém o lock. O código atual não revalida o ator; portanto, apesar de B já não ser Admin, a operação ainda pode rebaixar A.
5. O resultado pode ser zero Admins ativos.

O lock serializa as escritas nas duas RPCs, mas, sozinho, não corrige a decisão de autorização tomada antes da espera. A autorização precisa ser verificada novamente após o lock, em uma consulta que observe o estado confirmado pela operação anterior.

## 6–8. Helper recomendado e uso

Criar uma função privada, por exemplo `private.assert_admin_preservation(...)`, com finalidade restrita a validar se a transição planejada reduziria a contagem de Admins ativos abaixo de um. A função deve:

- ser chamada somente depois de a RPC adquirir o lock de `staff_members`;
- inspecionar o papel/status atual do alvo e a contagem de Admins ativos;
- rejeitar com SQLSTATE de conflito consistente (recomendado manter `23514`) se a operação retirar o último Admin ativo;
- não executar a mutação nem gravar auditoria;
- permanecer inacessível a `PUBLIC`, `anon`, `authenticated` e `service_role`, seguindo o padrão de privilégios das funções privadas existentes.

**Reutilização:**

- `revoke_staff_role()`: após lock e leitura/validação da membership ativa, chamar o helper para o alvo. A chamada só bloqueia se o alvo atual for Admin e for o último ativo.
- `grant_staff_role()`: após lock e leitura da membership, chamar o helper quando a transição efetiva for de Admin ativo para Reviewer ou Support. Não bloquear a concessão de Admin, a alteração de papel de não-Admin nem a ativação de registro que não seja Admin ativo.

**Revalidação do ator:** em ambas as RPCs, manter a checagem inicial para rejeição rápida, mas repetir a checagem depois de adquirir o lock e antes de qualquer alteração. A segunda checagem deve confirmar que o `actor_id` ainda corresponde a uma membership Admin ativa. Caso não corresponda, falhar com `42501`. No caminho concorrente descrito, a chamada de B deve falhar nessa verificação antes de avaliar ou alterar o alvo.

Na revogação, executar a revalidação imediatamente após o lock e antes de selecionar/alterar o alvo. Na concessão, executá-la imediatamente após o lock e antes da consulta e atualização/inserção do alvo. O helper de preservação deve ser chamado depois de identificar a transição pretendida e antes da escrita.

## 9. Comportamento esperado

| Situação | Resultado esperado |
|---|---|
| Um Admin ativo tenta rebaixar ou revogar outro registro de Admin | A operação não pode retirar o último Admin. O último Admin não pode ser auto-operado pelas RPCs atuais; a regra no banco também deve bloquear qualquer transição que tente deixar a contagem em zero. |
| Dois Admins ativos; um é rebaixado ou revogado | Permitido quando resta pelo menos um Admin ativo. |
| Dois Admins tentam simultaneamente rebaixar um ao outro | Uma operação pode concluir e deixar um Admin. A segunda, após o lock, deve falhar na revalidação do ator ou na preservação; o resultado nunca pode ser zero. |
| Rebaixamento de Admin ativo via `grant_staff_role()` | Permitido somente quando a operação deixa outro Admin ativo; caso contrário, conflito `23514`. |
| Revogação de Admin ativo via `revoke_staff_role()` | Mantém a regra existente, reutilizando o helper; não pode revogar o último Admin. |
| Concessão de Admin a usuário novo ou não-Admin | Permitida para ator ainda autorizado; aumenta ou mantém a contagem de Admins. |
| Membro Reviewer/Support é alterado entre papéis não-Admin | Não deve ser afetado pela proteção de preservação de Admins. |
| Ator perde papel Admin enquanto aguarda lock | A operação deve falhar com `42501` após obter o lock e revalidar a membership. |

## 10. Migration necessária

Criar uma migration forward com nome descritivo `admin_preservation`, usando `supabase migration new admin_preservation` para gerar o timestamp compatível com o histórico do repositório. Não editar migrations já existentes.

Funções afetadas:

- criar `private.assert_admin_preservation(...)` (ou nome equivalente);
- atualizar `public.grant_staff_role(...)`;
- atualizar `public.revoke_staff_role(...)`;
- ajustar privilégios da nova função privada para mantê-la não executável por roles de cliente.

Não são previstas alterações de tabela, enums, `public.users.role`, `staff_members`, `admin_audit_log` ou contratos das APIs.

## 11. Estratégia de rollback

Preferir correção forward caso a nova proteção apresente problema: a invariável de não chegar a zero Admins não deve ser abandonada por rollback operacional. Se for indispensável reverter uma definição defeituosa, publicar outra migration que restaure as RPCs de forma consistente e mantenha qualquer salvaguarda equivalente contra a corrida. Remover o helper somente depois de confirmar que nenhuma função depende dele e que os privilégios foram tratados. Restaurar simplesmente a versão atual reabre a janela concorrente e deve ser considerado regressão de segurança, com uso temporário e explicitamente aprovado.

## 12. Casos de teste obrigatórios

1. Com um Admin ativo, tentativas de downgrade e revoke de Admin não podem resultar em zero Admins.
2. Com dois Admins ativos, downgrade e revoke de um deles são permitidos e deixam exatamente um Admin.
3. Com dois Admins, concessão de Admin a um terceiro membro continua permitida.
4. Mudanças que não retiram Admin ativo não são bloqueadas indevidamente.
5. Ator não autenticado, sem membership ou sem role Admin continua recusado.
6. Ator cuja role foi revogada/rebaixada enquanto aguarda o lock falha na revalidação posterior ao lock.
7. Teste concorrente sincronizado (barrier) reproduz A rebaixando B e B rebaixando A; confirmar que somente uma operação que mantém ao menos um Admin pode confirmar e que a outra falha.
8. Concorrência entre downgrade/revoke e concessão de Admin não causa falso bloqueio nem permite zero Admins.
9. Falhas de preservação não alteram `staff_members` nem inserem evento de sucesso em `admin_audit_log`.
10. SQLSTATE de preservação continua sendo convertido para HTTP 409 pelas APIs; falhas de autorização retornam 403.
11. Confirmar que as operações concorrentes respeitam o timeout de lock configurado e não deixam transação parcialmente aplicada.

## 13. Critérios de aceite

- Toda operação de aplicação que possa retirar ou rebaixar Admin usa o lock compartilhado e verifica a invariável dentro da transação.
- `grant_staff_role()` e `revoke_staff_role()` revalidam o ator após obter o lock.
- Downgrade, revoke e concorrência nunca deixam zero Admins ativos.
- Operações válidas que preservam pelo menos um Admin continuam funcionando.
- A auditoria registra somente operações efetivamente concluídas; falhas não criam eventos de sucesso.
- Testes SQL/API relevantes passam, incluindo o cenário concorrente determinístico.
- Nenhuma alteração é feita em `public.users.role`, no schema das tabelas ou nos contratos das APIs.
- A migration forward aplica em ambiente de teste sem alterar migrations históricas.
- Typecheck/build e validações aplicáveis permanecem verdes após implementação.

## Arquivos inspecionados e impacto previsto

**Inspecionados:** `supabase/migrations/20261110030000_staff_functions.sql`, `app/api/admin/staff/route.ts`, `app/api/admin/staff/[id]/revoke/route.ts` e `lib/auth/staff-api.ts`.

**Impacto esperado na implementação:** nova migration SQL e testes SQL para as duas RPCs e concorrência. As APIs não precisam ser modificadas para enforcement; eventual mensagem HTTP específica de conflito seria melhoria opcional, pois o mapeamento atual já retorna 409 para `23514`.

Durante esta preparação, os arquivos de API inspecionados já estavam modificados no working tree. Este plano não os altera.
