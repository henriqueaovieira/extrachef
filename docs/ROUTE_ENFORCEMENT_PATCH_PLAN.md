# ROUTE_ENFORCEMENT_PATCH_PLAN

**Projeto:** ExtraChef  
**Sprint:** 3.0.2 — Fase 5, Route Enforcement  
**Status:** Proposta; nenhuma implementação realizada.

## 1. Estado atual observado

### Onde o acesso administrativo é decidido

- `proxy.ts` intercepta `/admin` e `/admin/:path*` pelo matcher.
- Após validar a sessão com `supabase.auth.getUser()`, o proxy consulta `get_staff_membership()`.
- Membership ausente, inválida ou diferente de `active` recebe HTTP 403; indisponibilidade da consulta recebe 503.
- O proxy não aplica autorização por capability a sub-rotas; qualquer Staff ativo pode acessar o namespace administrativo.

### Onde a membership é validada

- `proxy.ts` valida sessão e membership para navegação administrativa.
- `lib/auth/staff-api.ts` repete validação de sessão e consulta de membership por chamada de API.
- `app/admin/page.tsx` é Client Component. Após montar, consulta `/api/admin/staff/me` para exibir papel e status. Isso é apresentação de contexto, não um guard server-side.
- `app/admin/layout.tsx` é um Server Component sem lógica de autenticação ou autorização; atualmente apenas renderiza `<main>` e seus filhos.

### Onde os guards da Fase 3 se integram

- `lib/auth/admin-guards.ts` exporta guards síncronos que recebem uma `StaffMembership` já carregada. Eles não leem cookies, validam JWT ou consultam o Supabase.
- `requireAdmin`, `requireReviewer` e `requireSupport` exigem um papel específico; nenhum deles, isoladamente, representa “qualquer Staff ativo”.
- `requirePermission` verifica capability da matriz. A rota raiz `/admin` não possui uma capability comum dedicada; não se deve associá-la artificialmente a uma permissão funcional, como `verification.view`.

## 2. Arquivos previstos

### Alterar

1. `app/admin/layout.tsx` — tornar a validação de Staff uma precondição server-side para renderizar o segmento e seus filhos.
2. `app/admin/page.tsx` — deixar de depender de uma checagem exclusivamente client-side para autorizar/renderizar conteúdo; consumir o contexto obtido no servidor.
3. `lib/auth/admin-guards.ts` — adicionar, se aprovado, um guard explícito `requireActiveStaff()` que aceite qualquer um dos três papéis ativos. Os guards de papel e permission existentes permanecem disponíveis para páginas específicas futuras.

### Criar

4. `lib/auth/staff-page-access.ts` — módulo `server-only` para validar usuário e carregar membership usando cookies/request-scoped Supabase; aplicar o guard reutilizável e devolver somente o contexto mínimo `{ role, status }`.

### Não alterar nesta fase proposta

- APIs administrativas, inclusive `/api/admin/staff/me`.
- `proxy.ts`: continuará como filtro antecipado para redirect/403/503.
- Banco, migrations, RLS, RPCs, roles e componentes de navegação.

## 3. Estratégia mínima de integração

1. Implementar em `staff-page-access.ts` uma única função server-side que:
   - crie o cliente Supabase associado aos cookies da requisição, sem `service_role`;
   - valide identidade com `auth.getUser()`;
   - consulte `get_staff_membership()`;
   - use `parseStaffMembership()` para validar estrutura, papel e status;
   - chame `requireActiveStaff()` antes de retornar contexto ou permitir renderização.
2. Fazer o `app/admin/layout.tsx` chamar essa função antes de renderizar os filhos. A ausência ou invalidade de membership nunca deve resultar na renderização do conteúdo administrativo.
3. O `app/admin/page.tsx` pode consumir o contexto retornado pelo mesmo DAL, removendo a busca client-side apenas se a página puder renderizar o papel/status no servidor sem alterar o contrato externo da API.
4. Se layout e página precisarem chamar o DAL separadamente durante o mesmo render, usar o mecanismo de memoização por request suportado pelo React/Next para deduplicar a leitura no ciclo de renderização. Não armazenar membership em cache entre requisições.
5. Manter o `proxy.ts` como proteção rápida: usuário anônimo continua redirecionado ao login; membership ausente/inativa continua recebendo 403; falhas de auth/banco continuam fail-closed. A validação server-side do segmento protege o conteúdo caso uma página seja acessada por um caminho de renderização que não deva depender exclusivamente do Proxy.
6. Usar `requirePermission(membership, permission)` nas páginas administrativas específicas quando elas forem introduzidas. A rota raiz permanece acessível a qualquer Staff ativo; não aplicar guard exclusivo de Admin e não inventar uma capability apenas para habilitar o shell.

**Tratamento de falhas:** erro de autenticação não pode expor conteúdo; membership inválida/inativa nega o acesso; indisponibilidade do Supabase falha fechada. A implementação deve preservar a resposta antecipada do proxy para 401/403/503 e não converter falha de autorização em sucesso ou renderização parcial de conteúdo protegido.

## 4. Fluxos por papel

### Admin

- Sem sessão: `proxy.ts` redireciona ao login; o DAL também não permite renderização se executado sem o filtro.
- Membership Admin ativa: passa pelo proxy, `requireActiveStaff()` aprova no layout e a página mostra `admin`/`active`.
- Membership inválida, inativa ou consulta indisponível: sem conteúdo administrativo; 403 ou 503 conforme o erro e o tratamento já estabelecido.
- Páginas futuras: além de Staff ativo, cada página/consulta deve exigir sua capability específica.

### Reviewer

- Sem sessão ou membership ativa: mesmo comportamento de negação do Admin.
- Membership Reviewer ativa: acessa o shell `/admin`; o guard genérico não pode exigir `requireAdmin()`.
- Páginas futuras: somente páginas cuja capability conste na matriz; por exemplo, `staff.manage` deve continuar negada. O menu, se houver depois, não substitui o guard server-side.

### Support

- Sem sessão ou membership ativa: mesmo comportamento de negação do Admin.
- Membership Support ativa: acessa o shell `/admin`; o guard genérico não pode exigir `requireAdmin()` nem `requireReviewer()`.
- Páginas futuras: somente capabilities atribuídas a Support. Acesso à gestão de Staff deve ser negado por `staff.manage`.

## 5. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Exigir `requireAdmin()` no layout bloquear Reviewer e Support | Usar um guard explícito para qualquer Staff ativo; reservar guards específicos para páginas com papel/capability exclusiva |
| Usar uma permission funcional como autorização genérica do shell | Não associar `/admin` a `verification.view` ou outra capability não relacionada |
| Tratar o `useEffect` de `/staff/me` como proteção | Fazer autorização em Server Component/DAL antes de renderizar; endpoint atual permanece para seu uso existente até decisão explícita |
| Proxy considerado única fronteira de segurança | Acrescentar validação server-side antes da renderização; proteger também APIs e operações perto da fonte de dados |
| Membership cacheada entre usuários ou requisições | Memoizar somente no escopo de render/request; nunca usar cache global ou persistente |
| Falha no Supabase resultar em renderização administrativa | Falhar fechado e não renderizar children; preservar observabilidade e tratamento de indisponibilidade |
| Diferenças no acesso a cookies do Supabase em Server Components | Usar cliente SSR request-scoped suportado pelo projeto e testar refresh/cookie behavior na versão instalada; não reutilizar diretamente o helper de Proxy, que recebe `NextRequest` |
| Erro de autorização ser convertido em status confuso por Server Components | Manter Proxy responsável por resposta antecipada 401/403/503 e definir explicitamente comportamento server-side para acesso direto sem revelar conteúdo |

## 6. Rollback

1. Reverter somente as alterações de `app/admin/layout.tsx`, `app/admin/page.tsx`, `lib/auth/admin-guards.ts` e remover `lib/auth/staff-page-access.ts`.
2. Manter `proxy.ts` e todas as APIs inalteradas; o filtro atual do Proxy volta a ser a barreira de navegação, e `/api/admin/staff/me` continua atendendo a página como hoje.
3. Nenhum rollback de banco, migration ou dado é necessário, pois a fase não propõe alterações de persistência.
4. Antes de reverter, confirmar que não houve expansão de páginas administrativas dependentes exclusivamente do DAL novo.

## Decisão recomendada

Prosseguir com uma camada server-only reutilizável chamada pelo layout para o shell administrativo e pela página somente se necessário para entregar o contexto de exibição. O Proxy mantém o bloqueio antecipado e os APIs mantêm seus próprios guards. Essa composição evita duplicar a lógica de decisão entre layout e página, permite os três papéis no shell e estabelece authorization server-side para futuras páginas sem alterar nesta fase APIs ou banco.
