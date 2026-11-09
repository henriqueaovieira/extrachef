# Título sugerido

Sprint 3.0.2: autorização RBAC para a área administrativa

## Resumo

Implementa a camada local de autorização Staff para o ExtraChef, com catálogo central de permissions, guards reutilizáveis, enforcement nas APIs Staff e no segmento `/admin`, navegação filtrada e proteção SQL contra perda do último Admin ativo nas operações Staff.

## Alterações

- Define permissions e a matriz Admin/Reviewer/Support em `lib/auth/staff-permissions.ts`, com serviço de autorização e guards compartilhados.
- Exige `staff.view` para listar Staff e `staff.manage` para conceder, alterar ou revogar memberships.
- Valida autenticação e membership Staff ativa no layout administrativo; a navegação é derivada das permissions e não substitui os checks de backend.
- Acrescenta a migration `20261110040000_admin_preservation.sql`, que compartilha a verificação de preservação nas RPCs de grant e revoke e revalida o ator após o lock.
- Amplia a cobertura automatizada de matriz, API, proxy, navegação, SQL e cenários Playwright.

Papéis Staff permanecem distintos de `public.users.role`. As permissions catalogadas não significam que todas as telas ou operações correspondentes já estejam implementadas; algumas subpáginas dos links administrativos ainda não existem.

## Validação

- Typecheck aprovado na Fase 6.
- Testes API, proxy e navegação: **23 aprovados**, conforme `SECURITY_TEST_MATRIX_REPORT.md`; os testes de API utilizam mocks.
- Testes SQL em PGlite: **7 aprovados** após a correção documentada em `ADMIN_PRESERVATION_FIX_REPORT.md`.
- Playwright RBAC: **Blocked by environment configuration**. A preparação falhou por incompatibilidade Host/autoridade; nenhuma asserção E2E foi executada. Também faltam credenciais de teste para Admin, Reviewer, Support e Worker.

## Pendências e riscos

- Validar os cenários E2E de acesso e navegação com as contas necessárias; o spec atual não executa grant/revoke na UI.
- Testar Admin Preservation com sessões PostgreSQL independentes e concorrentes.
- Reconciliar a migration e o histórico no banco-alvo antes da implantação; aplicação remota não foi confirmada. Se já aplicada, definir migration corretiva apropriada.
- Verificar proteção específica das futuras páginas/ações; ocultar links não é autorização.

## Documentação de suporte

`SPRINT_3_2_COMPLETION_REPORT.md`, `MERGE_CHECKLIST.md`, `SECURITY_TEST_MATRIX_REPORT.md`, `ADMIN_PRESERVATION_FIX_REPORT.md` e `RBAC_E2E_VALIDATION_REPORT.md`.

**Recomendação:** abrir o PR para revisão com os bloqueios explícitos; não considerar o E2E aprovado nem fazer merge antes dos gates aplicáveis.
