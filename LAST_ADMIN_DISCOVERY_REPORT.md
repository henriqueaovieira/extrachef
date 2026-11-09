# Last Admin Protection — Discovery Report

## Resumo

O fluxo de revogação passa pela API administrativa e termina na RPC `public.revoke_staff_role()`. A RPC consulta o papel e o status atuais do alvo, conta os Admins ativos e recusa a revogação quando há apenas um. Essa proteção está no banco, que é a camada adequada para garantir a regra também em chamadas diretas à RPC.

Não foi encontrada uma função SQL separada para contar Admins. A função `revoke_staff_role()` faz a contagem diretamente em `private.staff_members` e adquire um lock exclusivo na tabela antes de ler e alterar a membership.

## Fluxo atual de revogação

1. `app/api/admin/staff/[id]/revoke/route.ts`: o handler chama `authorizeStaffApi()`, exige `staff.manage`, valida a origem, o UUID do alvo e a justificativa. Em seguida, invoca `authorization.supabase.rpc('revoke_staff_role', ...)`.
2. `lib/auth/staff-api.ts`: `authorizeStaffApi()` valida o usuário autenticado via `supabase.auth.getUser()` e chama `get_staff_membership()` para obter role/status do ator. Membership ausente, inválida ou inativa é recusada; o role ativo é devolvido no contexto da requisição.
3. `supabase/migrations/20261110030000_staff_functions.sql`: a RPC `revoke_staff_role()` autentica e autoriza novamente o ator como Admin, valida o alvo e a justificativa, trava `private.staff_members`, carrega a role/status do alvo com `FOR UPDATE`, aplica a proteção de último Admin e, se permitido, marca a membership como revogada e registra a ação em `private.admin_audit_log`.

## Respostas aos pontos solicitados

| Pergunta | Constatação |
|---|---|
| Onde `revoke_staff_role()` é chamado? | No handler `POST` de `app/api/admin/staff/[id]/revoke/route.ts`, após as verificações de API. |
| Onde a role atual do Staff alvo é consultada? | Dentro de `public.revoke_staff_role()`: `current_role` e `current_status` são lidos de `private.staff_members` para o `p_user_id` (migration `20261110030000_staff_functions.sql`, linhas 231–256). A API não consulta previamente o papel do alvo. |
| Como um Admin ativo é identificado? | Pela combinação `staff_role = 'admin'` e `status = 'active'` em `private.staff_members`. O predicado é usado tanto por `private.is_admin()` (ator) quanto pela contagem de alvos Admin ativos. |
| Existe função SQL que conte Admins? | Não há função de contagem dedicada. A contagem é inline em `revoke_staff_role()`, contando linhas Admin com status ativo (linhas 259–264). |
| Há validação para impedir revogação do último Admin? | Sim. Se o alvo atual é Admin e a contagem de Admins ativos é menor ou igual a um, a RPC lança exceção com SQLSTATE `23514` antes de atualizar a membership ou gravar o evento de revogação (linhas 259–264). |

## Concorrência e tratamento de erro

`revoke_staff_role()` adquire `LOCK TABLE private.staff_members IN EXCLUSIVE MODE` antes de consultar o alvo e contar Admins (linha 248). `grant_staff_role()` também adquire esse lock (linha 182), serializando operações por essas funções que modificam a tabela e evitando que duas revogações concorrentes, ambas observando mais de um Admin, removam simultaneamente a última membership ativa.

A API converte SQLSTATE `23514` em HTTP 409 por meio de `rpcErrorStatus()` em `lib/auth/staff-api.ts`. Atualmente, o handler retorna uma mensagem genérica quando a RPC falha; não há mapeamento específico da proteção de último Admin para uma mensagem de domínio.

## Camada recomendada

**Banco como enforcement obrigatório; API como apresentação de erro.**

- **SQL:** manter a regra dentro da RPC. É a fronteira autoritativa e protege também invocações que não passem pelo handler Next.js. A verificação deve permanecer na mesma transação e sob o lock que cobre a alteração.
- **API:** não duplicar consulta/contagem de Admins. Uma verificação prévia na API seria sujeita a corrida e não protegeria chamadas diretas à RPC. A API pode, opcionalmente, traduzir o SQLSTATE de proteção para uma resposta 409 com mensagem explícita, preservando o status atual.

## Gap relacionado identificado

Embora a revogação explícita do último Admin esteja protegida, `public.grant_staff_role()` atualiza um registro Staff existente para o papel solicitado e define seu status como ativo (linhas 194–209), sem impedir a transição de um Admin ativo para Reviewer ou Support. Assim, um ator Admin pode potencialmente rebaixar o último Admin ativo usando a operação de concessão/alteração de role, contornando a regra se a proteção for entendida como “sempre deve existir ao menos um Admin ativo”.

Esse caminho não altera `public.users.role`; trata-se exclusivamente de `private.staff_members.staff_role`. A proteção completa deve considerar tanto revogação quanto transição/rebaixamento de role. A verificação precisa ser executada no SQL, sob a mesma estratégia de serialização. A API não deve ser a única barreira.

## Escopo e limitações da discovery

- Analisados: `app/api/admin/staff/[id]/revoke/route.ts`, `lib/auth/staff-api.ts`, `supabase/migrations/20261110030000_staff_functions.sql` e `supabase/migrations/20261110010000_staff_foundation.sql`.
- A migration da Foundation define `private.staff_members`, os enums de role/status, a unicidade por `user_id` e RLS; não contém contador de Admins nem regra de último Admin.
- Não houve alteração de código, banco, migration ou teste.
- A análise descreve o código versionado; não confirma se as migrations correspondentes foram aplicadas ao banco remoto.

## Recomendação para a implementação da Fase 7

Manter a proteção na camada SQL e cobrir também a alteração de role em `grant_staff_role()`. Na API, considerar apenas a tradução de erro para uma resposta 409 específica. A validação deve incluir revogação do único Admin, revogação quando existem múltiplos Admins, chamadas concorrentes e tentativa de rebaixar o último Admin por alteração de role.
