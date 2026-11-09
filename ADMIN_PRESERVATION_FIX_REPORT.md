# Admin Preservation Fix Report

## Causa raiz

`private.assert_admin_preservation()` recebe `private.staff_role` como primeiro e terceiro argumentos. Em `public.revoke_staff_role()`, a variável PL/pgSQL tinha o nome `current_role`; nesse contexto, o identificador colidiu com a expressão especial SQL `CURRENT_ROLE`, que tem tipo `name`. A chamada ao helper era resolvida como `(name, private.staff_status, name, private.staff_status)` e não encontrava a assinatura declarada com enums `private.staff_role`.

## Alteração realizada

Na migration `supabase/migrations/20261110040000_admin_preservation.sql`, a variável local de role dentro de `revoke_staff_role()` foi renomeada para `target_staff_role`, e suas referências na leitura, chamada do helper e construção dos dados de auditoria/retorno foram atualizadas. A assinatura do helper, as regras de autorização, as APIs, RBAC, navegação, route enforcement e os testes não foram alterados nesta correção.

## Resultado dos testes

`node --test tests/staff-members.sql.test.mjs` — **7 aprovados, 0 falhas**. A migration foi aplicada pelo teste PGlite e os caminhos de concessão, downgrade, revogação, preservação do último Admin, revalidação e auditoria passaram.

## Riscos remanescentes

- O teste SQL usa PGlite e não substitui uma validação concorrente em PostgreSQL com sessões independentes.
- O teste E2E autenticado da matriz de segurança continua pendente por incompatibilidade Host/URL do ambiente Playwright, conforme registrado em `SECURITY_TEST_MATRIX_REPORT.md`.
- Esta mudança corrige a migration no repositório; não confirma que ela foi aplicada a qualquer banco remoto.
