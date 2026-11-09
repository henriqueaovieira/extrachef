# Snapshot parcial Supabase

**Data:** 2026-11-09  
**Modo:** somente leitura  
**Estado:** parcial; não equivale a snapshot de `pg_catalog`.

`tables.csv`, `views.csv` e `functions.csv` contêm recursos/endpoints anunciados pelo OpenAPI PostgREST. Não se pode inferir que cada recurso é uma tabela, que cada RPC é a função única no catálogo, nem que itens não expostos estejam ausentes. `buckets.csv` contém metadados retornados pela Storage API.

`triggers.csv`, `indexes.csv`, `policies.csv` e `extensions.csv` têm apenas cabeçalho porque a credencial/API disponível não permite listar os catálogos correspondentes. Cabeçalho sem registros significa **não coletado**, não “nenhum objeto”.

Não foram consultados dados de usuários, objetos/arquivos Storage, nem executadas escritas. Nenhum segredo, URL ou project ref foi armazenado.
