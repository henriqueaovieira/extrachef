# Relatorio: remocao exclusiva da interface Meus Locais

## Resultado

A interface de gerenciamento manual de locais foi removida, incluindo pagina,
componente, entrada do menu Mais e atalhos da Agenda. A infraestrutura interna
de `work_locations` foi preservada. Nenhuma migration ou operacao contra o banco
real foi executada.

## Arquivos removidos

- `app/restaurant/locations/page.tsx`: pagina da interface.
- `app/components/restaurant-locations.tsx`: listagem, busca, filtros e
  formulario de cadastro/edicao; acoes de padrao, arquivamento, restauracao e
  exclusao na interface.

## Arquivos alterados

| Arquivo | Alteracao |
| --- | --- |
| [app/restaurant/more/page.tsx](../app/restaurant/more/page.tsx) | Removido somente o item Meus locais. |
| [app/components/mobile-bottom-nav.tsx](../app/components/mobile-bottom-nav.tsx) | Removida a rota antiga da regra de destaque de Mais. |
| [app/components/restaurant-events.tsx](../app/components/restaurant-events.tsx) | Removidos dois atalhos e instrucoes de cadastro manual, sem alterar consultas ou salvamento. |
| [lib/work-locations.ts](../lib/work-locations.ts) | Removidos LocationAction, emptyLocationForm, geocodingLabels e locationParameters, exclusivos da interface removida. Mantidos tipos e colunas compartilhados. |
| [tests/work-locations.test.mjs](../tests/work-locations.test.mjs) | Substituidos testes da interface removida por regressoes de ausencia da interface e preservacao da infraestrutura. |
| [tests/event-locations.test.mjs](../tests/event-locations.test.mjs) | Adicionada regressao de ausencia de atalhos, local opcional e preservacao do formulario ao atualizar o catalogo. |
| [tests/restaurant-history.test.mjs](../tests/restaurant-history.test.mjs) | Atualizadas expectativas do menu Mais e das paginas remanescentes. |
| [docs/work-locations.md](./work-locations.md) | Documentado o estado atual sem interface e com infraestrutura preservada. |
| [docs/event-location-snapshots.md](./event-location-snapshots.md) | Atualizadas instrucoes da Agenda sem atalhos de cadastro. |
| [docs/mvp-test-and-deploy.md](./mvp-test-and-deploy.md) | Atualizado checklist da funcionalidade removida. |

Este relatorio foi adicionado em `docs/meus-locais-removal-report.md`.

## Rotas removidas

- `/restaurant/locations`: acesso direto autenticado verificado com HTTP 404.
- Nenhuma rota de API foi removida ou alterada.

## Referencias restantes a work_locations

| Arquivo | Finalidade preservada |
| --- | --- |
| [app/components/restaurant-events.tsx](../app/components/restaurant-events.tsx) | Consulta paginada dos locais existentes para selecao em eventos. |
| [supabase/migrations/20261015060000_work_locations_catalog.sql](../supabase/migrations/20261015060000_work_locations_catalog.sql) | Tabela, indices, constraints, RLS e RPCs save_work_location/manage_work_location. |
| [supabase/migrations/20261015070000_event_location_snapshots.sql](../supabase/migrations/20261015070000_event_location_snapshots.sql) | FK e copia de snapshots de locais em eventos. |
| [supabase/migrations/20261015080000_job_location_snapshots.sql](../supabase/migrations/20261015080000_job_location_snapshots.sql) | Dependencias, FK e consultas de locais em vagas. |
| [supabase/migrations/20261015090000_privacy_account_rights.sql](../supabase/migrations/20261015090000_privacy_account_rights.sql) | Tratamento existente dos dados da conta. |
| [tests/work-locations.test.mjs](../tests/work-locations.test.mjs) | Regressoes da remocao e da infraestrutura interna. |
| [tests/work-locations-sql.test.mjs](../tests/work-locations-sql.test.mjs) | Testes isolados de RPCs, RLS, revisoes, padroes e coordenadas. |
| [tests/event-locations.test.mjs](../tests/event-locations.test.mjs) | Contrato de snapshots, consultas e falhas do catalogo. |
| [tests/demands-sql.test.mjs](../tests/demands-sql.test.mjs) | Fixture SQL das dependencias de demandas. |
| [docs/work-locations.md](./work-locations.md) | Contrato e preservacao da infraestrutura do catalogo. |
| [docs/event-location-snapshots.md](./event-location-snapshots.md) | Documentacao das dependencias e consultas de snapshots. |
| [docs/mvp-test-and-deploy.md](./mvp-test-and-deploy.md) | Orientacao de deploy das dependencias ja existentes. |

Este relatorio tambem menciona a tabela para documentar sua preservacao.
Os tipos CatalogLocation/GeocodingStatus e catalogLocationColumns continuam em
[lib/work-locations.ts](../lib/work-locations.ts), compartilhados com eventos.

## Validacao

- Typecheck: `npm run typecheck`, aprovado.
- ESLint dos sete arquivos de codigo/testes alterados, aprovado.
- `git diff --check`, aprovado.
- 29 testes distintos aprovados, sem falhas: remocao da interface, navegacao,
  eventos/snapshots, GPS/geocodificacao, demandas e testes SQL de catalogo/presenca.
  Os dois testes SQL inicialmente ignorados por falta de PGLITE_MODULE foram
  reexecutados com o pacote ja instalado; ambos passaram.
- PostgreSQL de teste executado em memoria com PGlite, sem acessar o Supabase.
- Navegador autenticado: Mais sem Meus Locais em 390 px e 1280 px.
- Navegador autenticado: rota antiga responde 404.
- Navegador autenticado: Agenda sem atalhos de gerenciamento; formulario
  continua mostrando o seletor e a opcao Definir depois / sem local.
  Nenhum evento foi salvo durante essa verificacao no navegador.

## Impactos e limites

- Impacto intencional: o restaurante nao pode mais cadastrar, editar, definir
  padrao, arquivar, restaurar ou excluir locais pela interface removida.
- Favoritos e links externos para a rota antiga passam a receber 404.
- Locais existentes permanecem no banco e podem ser selecionados nos eventos.
  Sem locais ativos, permanece disponivel Definir depois / sem local.
- RPCs internas continuam disponiveis com as permissoes existentes: esta
  entrega nao revoga acesso de API nem modifica regras de banco.
- Nenhuma alteracao em criacao de vagas, perfil do restaurante, candidaturas,
  contratacoes, mensagens, notificacoes, GPS, check-in ou check-out.
- Durante a verificacao, o servidor Next.js de desenvolvimento emitiu
  diagnosticos de validacao de navegacao instantanea enquanto paginas exibiam
  validacao de sessao; as paginas renderizaram depois. Nao foi alterada
  configuracao do framework ou autenticacao para tratar esse diagnostico.
- Nao foi executado build de producao; a verificacao de tipos/rotas e as
  verificacoes HTTP/visuais foram feitas no ambiente de desenvolvimento.
