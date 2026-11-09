# Security Test Matrix — Fase 8

## 1. Arquivos alterados

- `tests/admin-api.test.mjs`
- `tests/admin-navigation.test.mjs` (novo)
- `tests/staff-members.sql.test.mjs`
- `tests/auth-proxy.test.mjs`
- `tests/e2e/admin-access.spec.ts`
- `SECURITY_TEST_MATRIX_REPORT.md` (este relatório)

Nenhum arquivo de implementação, regra RBAC, API, migration ou banco foi alterado nesta fase.

## 2–3. Casos adicionados e resultados

| Área | Cobertura | Resultado |
|---|---|---|
| Permission Matrix | Admin possui `staff.view` e `staff.manage`; Reviewer e Support não possuem essas permissions, mas possuem `verification.view`. | **Aprovado** |
| API — GET `/api/admin/staff` | Admin permitido; Reviewer e Support sem `staff.view` recebem 403. | **Aprovado** nos testes unitários de API |
| API — POST `/api/admin/staff` | Admin permitido; Reviewer e Support recebem 403 sem chamar a RPC de mutação. | **Aprovado** |
| API — POST `/api/admin/staff/[id]/revoke` | Admin permitido no mock do handler; Reviewer e Support recebem 403 sem chamar a RPC. | **Aprovado** nos testes unitários de API |
| Membership | Ausente e inativa são recusadas com 403. | **Aprovado** |
| Route enforcement via proxy | Não-Staff e membership revogada são recusados; Staff ativo é aceito pelo proxy. | **Aprovado** nos testes de proxy |
| Navigation RBAC | Admin vê Staff/Audit/Settings; Reviewer e Support não veem esses links; os três veem os itens de consulta permitidos. | **Aprovado** em teste server-rendered |
| Admin Preservation — downgrade | Com dois Admins, rebaixar um para Reviewer deixa um Admin; o ator rebaixado não pode iniciar nova concessão. | **Parcialmente aprovado** antes do teste de revoke falhar |
| Admin Preservation — helper | O helper recusa as transições testadas de último Admin com SQLSTATE `23514`. | **Aprovado** |
| Admin Preservation — revoke | A migration atual impede a execução funcional da RPC de revoke devido à chamada do helper descrita em “Pendências”. | **Falhou** |
| Concorrência real | O fluxo serial de ator despromovido é coberto; não foi possível executar duas transações simultâneas no PGlite usado por este conjunto. | **Pendente** |
| E2E `/admin` e navegação autenticada | Foram adicionados casos Admin/Reviewer/Support; a execução terminou antes das asserções por erro de autoridade Host/URL do ambiente Playwright. | **Pendente** |

## 4. Casos pendentes e bloqueios encontrados

1. **Falha na RPC de revoke:** ao executar `revoke_staff_role()`, PostgreSQL/PGlite reportou que não existe `private.assert_admin_preservation(name, private.staff_status, name, private.staff_status)`. A migration declara os parâmetros como enums `private.staff_role`, mas a referência `current_role` na chamada do helper é interpretada como o identificador especial `CURRENT_ROLE`, de tipo `name`, em vez da variável PL/pgSQL. Isso quebra a revogação tanto de membros não-Admin quanto de Admins. O teste capturou a falha no caminho de revoke existente e no novo cenário SQL.
2. **Teste concorrente de duas sessões:** requer um PostgreSQL capaz de executar sessões independentes e sincronizadas; PGlite nesta configuração não oferece um teste confiável de lock concorrente entre sessões.
3. **Playwright E2E:** execução de `tests/e2e/admin-access.spec.ts` foi interrompida com `The property 'Host in options.headers' must match the request authority (127.0.0.1:52093). Received 'localhost:3000'`. As credenciais/rotas E2E não chegaram às asserções.
4. **Route Enforcement no layout:** proxy possui cobertura unitária e os casos de E2E foram preparados, mas o acesso server-side real ao layout com sessão Staff ativa/inexistente não foi validado neste ambiente.

Corrigir o erro da chamada ao helper exige alterar a migration de Admin Preservation, fora do escopo autorizado para a Fase 8. Os testes foram mantidos para tornar a regressão visível; não foi feito ajuste que esconda ou contorne a falha.

## 5. Riscos remanescentes

- A revogação de Staff permanece indisponível enquanto a chamada inválida ao helper não for corrigida por uma alteração autorizada na implementação SQL.
- A garantia de Admin Preservation sob concorrência ainda não foi exercitada com sessões simultâneas reais nesta fase.
- O segmento administrativo não foi validado via E2E autenticado, devido à configuração Host/URL.
- A aprovação unitária de Admin para o endpoint de revoke usa RPC mockada e não substitui a validação de integração SQL, que falhou.

## Validação executada

- `node --test tests/admin-navigation.test.mjs tests/admin-api.test.mjs tests/auth-proxy.test.mjs`: **23 aprovados, 0 falhas**.
- `node --test tests/staff-members.sql.test.mjs`: **falhou** ao chamar o helper a partir de `revoke_staff_role()`; a falha é detalhada acima.
- ESLint direcionado aos arquivos de teste alterados: **aprovado**.
- Playwright E2E direcionado: **bloqueado** pelo erro de incompatibilidade de Host/autoridade.

## Próxima fase recomendada

Autorizar uma correção mínima na migration de Admin Preservation para resolver a referência de role no helper; então repetir o conjunto SQL, adicionar um teste concorrente com PostgreSQL de múltiplas sessões e reexecutar o E2E com `PLAYWRIGHT_BASE_URL` alinhado ao host/porta do servidor.
