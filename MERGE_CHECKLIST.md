# Checklist de merge — Sprint 3.0.2

## Entregas locais

- [x] Catálogo, matriz e serviço de autorização Staff implementados.
- [x] Guards e permission checks das APIs de gestão Staff implementados.
- [x] Membership Staff ativa exigida server-side no layout `/admin`.
- [x] Navegação filtrada por permissions existentes, sem matriz adicional.
- [x] Migration local de Admin Preservation para grant/revoke, com revalidação do ator após o lock.
- [x] Correção da colisão `CURRENT_ROLE` e resultado SQL subsequente documentados.

## Validações registradas

- [x] Typecheck aprovado na Fase 6; resultado histórico.
- [x] API/proxy/navegação: 23 testes aprovados; resultado histórico, com mocks na API.
- [x] SQL em PGlite: 7 testes aprovados após a correção.
- [ ] Playwright RBAC: **Blocked by environment configuration**; nenhuma asserção foi executada. Resolver a divergência Host/autoridade e executar `tests/e2e/admin-access.spec.ts` com as credenciais de teste adequadas para Admin, Reviewer, Support e usuário sem Staff.
- [ ] Validar no navegador os menus e o acesso direto esperados para cada papel, incluindo usuário sem Staff.
- [ ] Definir e verificar a continuidade da UI de Admin Preservation; o spec atual não executa grant/revoke na UI.
- [ ] Testar concorrência de grant/downgrade/revoke em PostgreSQL com sessões independentes, incluindo revalidação do ator e preservação de Admin ativo.

## Banco e implantação

- [ ] Reconciliar estado e histórico de migrations do banco-alvo com a Foundation e a migration de Admin Preservation; nenhuma aplicação remota foi confirmada.
- [ ] Confirmar procedimento de implantação e rollback apropriado ao estado real do banco. Caso a migration já tenha sido aplicada, avaliar migration corretiva versionada em vez de depender de sua edição local.
- [ ] Validar os cenários SQL pertinentes no ambiente-alvo apropriado, sem presumir que PGlite reproduza concorrência real.

## Revisão do PR

- [ ] Revisar o diff completo, inclusive arquivos novos, e selecionar apenas os artefatos pertencentes ao PR.
- [ ] Confirmar que `public.users.role` não foi alterado e que roles Staff continuam separados.
- [ ] Confirmar que páginas e operações futuras terão autorização própria: visibilidade da navegação não protege acesso direto.
- [ ] Registrar que links de subpáginas ainda não implementadas podem retornar 404 e que permissions no catálogo não comprovam funcionalidades prontas.
- [ ] Obter aprovação das revisões e cumprir os gates de CI e de implantação aplicáveis.

**Decisão atual:** PR pode ser preparado para revisão; merge não recomendado enquanto os gates E2E, concorrência e reconciliação do banco aplicáveis permanecerem pendentes.
