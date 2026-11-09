# ExtraChef — Storage Diff Report

**Status: DIVERGÊNCIA PARCIAL CONFIRMADA**

## Buckets

| Bucket | Migration Git | Ambiente consultado | Status |
|---|---|---|---|
| `worker-private` | Privado; 10 MiB; JPEG/PNG/WebP/PDF (`20261014050000_profiles_and_geo.sql`) | Privado; 10,485,760 bytes; JPEG/PNG/WebP/PDF | ✅ Alinhado nos atributos observados |
| `restaurant-assets` | Público; 10 MiB; JPEG/PNG/WebP (`20261014050000_profiles_and_geo.sql`) | Privado; 10,485,760 bytes; JPEG/PNG/WebP | ⚠ Divergência confirmada: flag de visibilidade |

## Policies e fluxo de selfie

- Git define `restaurant_assets_public_read` e policies de ownership para `worker-private` em `20261014050000_profiles_and_geo.sql`.
- `20261103000000_verified_profile.sql` define policies restritivas para selfie submetida, impedindo leitura por terceiros e mutação/remoção por usuários comuns.
- As policies implantadas não foram lidas; não declarar equivalência nem inferir exposição efetiva.
- Nenhum objeto de Storage foi listado ou baixado durante a verificação.

## Decisão

Não alterar buckets nem policies como parte da Fase 0, que é somente leitura. Antes de decidir se `restaurant-assets` deve ser público ou privado, confirmar o requisito do produto e comparar a policy efetiva, a estratégia de URLs usada pela aplicação e o acesso real esperado. O resultado deve ser corrigido em plano/migration separado, com testes.

**Rollback:** não aplicável à auditoria. Nenhuma escrita, migration ou deploy foi realizado.
