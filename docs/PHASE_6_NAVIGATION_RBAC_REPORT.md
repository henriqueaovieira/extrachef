# PHASE_6_NAVIGATION_RBAC_REPORT

**Projeto:** ExtraChef  
**Sprint:** 3.0.2 — Fase 6, Navigation RBAC  
**Status:** Implementada; nenhuma fase posterior iniciada.

## 1. Arquivos criados

- `docs/PHASE_6_NAVIGATION_RBAC_REPORT.md` — este relatório.

## 2. Arquivos modificados

- `app/admin/layout.tsx` — adicionada navegação server-rendered, filtrada pela membership e pelas permissões existentes.

Não foram alterados `proxy.ts`, APIs, banco, migrations, testes ou roles. Nenhum componente de navegação separado foi criado.

## 3. Permissões utilizadas

- `staff.view` — menu Staff.
- `user.view` — menu Users.
- `verification.view` — menu Verification.
- `audit.view` — menu Audit.
- `system.settings` — menu Settings.
- Dashboard não exige uma permission de recurso; é exibido para membership ativa que tenha permissões no catálogo.

O layout usa `getStaffPermissions()` para obter as permissions permitidas e `hasPermission()` para verificar cada item protegido. Não foi criada uma segunda matriz role-permission.

## 4. Menus por papel

| Papel | Itens visíveis |
|---|---|
| Admin | Dashboard, Staff, Users, Verification, Audit, Settings |
| Reviewer | Dashboard, Users, Verification |
| Support | Dashboard, Users, Verification |

O resultado deriva da matriz em `lib/auth/staff-permissions.ts`, não de comparações diretas de papel no layout.

## 5. Riscos e limites

- Navigation RBAC controla apenas visibilidade. Não substitui guards server-side nas páginas, APIs ou operações de dados.
- A árvore atual de `app/admin` contém apenas `layout.tsx` e `page.tsx`. `/admin/staff`, `/admin/users`, `/admin/verifications`, `/admin/audit` e `/admin/settings` ainda não possuem páginas; clicar nesses links pode resultar em 404 até que as páginas sejam implementadas.
- `staff.manage`, `verification.review`, `verification.approve`, `verification.reject`, `audit.export`, `user.flag` e `system.bootstrap` não são permissões de navegação separadas nesta fase; qualquer ação correspondente precisa de autorização própria no backend.
- A checagem `permissions.includes(...) && hasPermission(...)` é uma interseção dos helpers existentes, não uma nova regra de RBAC. A fonte continua sendo o catálogo compartilhado.
- Não foram adicionadas verificações de `Last Admin Protection`.

## 6. Validação e próxima fase recomendada

- `npm.cmd run typecheck` passou.
- ESLint direcionado a `app/admin/layout.tsx` passou.
- Nenhum teste foi modificado ou executado.

**Próxima fase recomendada:** implementar as páginas administrativas previstas e aplicar guards de permission server-side em cada página e operação; manter a navegação como conveniência de UX, não como barreira de segurança.
