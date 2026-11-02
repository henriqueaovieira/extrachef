# Relatorio: descontinuacao da interface Agenda/Eventos

## Resultado e estado de implantacao

A demanda passa a ser a entrada principal para organizar a operacao.
A interface Agenda/Eventos, seus acessos e a dependencia de eventos na
publicacao foram removidos.

A nova publicacao envia `p_location_source: 'restaurant'`. A RPC identifica o
proprietario por `auth.uid()`, le o endereco principal em `restaurant_profiles`
e cria/reutiliza um `work_location` padrao, sem evento nem cadastro manual.

**Implementado e validado em PostgreSQL isolado. A migration nao foi aplicada
ao banco remoto. Ela deve ser aplicada antes de publicar este frontend.**
Nenhuma demanda foi publicada no banco real durante as verificacoes.

## Plano executado e retrocompatibilidade

1. Remover somente a rota, componente visual e helper exclusivo da Agenda.
2. Retirar consulta/seletor de eventos, pre-selecao por URL e parametros de
   evento da tela de publicacao.
3. Adicionar a migration
   [20261019000000_demand_restaurant_location.sql](../supabase/migrations/20261019000000_demand_restaurant_location.sql).
4. Usar `CREATE OR REPLACE FUNCTION` na RPC `create_restaurant_demand`, mantendo
   assinatura, parametros, defaults, retorno e permissoes preexistentes.
5. Acrescentar somente o caminho explicito `restaurant`; chamadas legadas com
   `none`, `catalog`, `event` ou parametros opcionais omitidos mantem o contrato.
6. Resolver `restaurant` para `catalog` antes de chamar `create_restaurant_job`.
   Assim, nenhuma constraint precisa aceitar uma nova origem em `jobs`.
7. Validar contratos reais, historico, permissoes, UI e regressoes operacionais.

Nao foram criadas/removidas tabelas ou colunas. Nenhuma migration historica,
RPC existente, RLS, trigger, constraint ou relacionamento foi removido.
A unica RPC alterada e a criacao de demandas, pelo caminho adicional autorizado.

## Localizacao automatica

- Validacao de conta ativa e papel restaurant, sem aceitar proprietario do cliente.
- Lock da linha do proprietario, na mesma ordem das RPCs existentes.
- Leitura do perfil com lock compartilhado durante a transacao.
- Endereco/cidade normalizados por trim; UF em maiusculas e CEP numerico.
- Endereco de 3 a 300 caracteres, cidade de 2 a 120, UF de duas letras e CEP
  de oito digitos. Perfil ausente/invalido produz erro explicito e nao publica.
- O perfil tem endereco em texto unico: ele e preservado integralmente em
  `work_locations.address`; numero e bairro separados ficam vazios, sem tentar
  inferir ou decompor o texto.
- Reutilizacao somente de local ativo do mesmo proprietario com endereco
  normalizado exatamente igual. Caso nao exista, uso de `save_work_location`.
- O local torna-se padrao por `manage_work_location`, respeitando revisoes
  e o indice unico de padrao ativo. Outros locais nao sao excluidos.
- Nenhuma coordenada e inventada nem existe geocodificacao obrigatoria.
  Um local novo fica `pending_coordinates`; um local existente resolvido
  preserva suas coordenadas e produz um snapshot `ready`.
- `event_id` e `location_event_revision` ficam nulos nas publicacoes novas.
- Catalogo/padrao e todas as posicoes sao gravados na mesma transacao.
  Falha em uma posicao reverte tambem criacao do local e troca de padrao.
- Mudancas futuras no perfil sao consideradas na proxima publicacao, sem
  alterar snapshots de demandas/eventos existentes.
- Locais arquivados nao sao reativados automaticamente.

## Arquivos removidos nesta entrega

- `app/restaurant/events/page.tsx`.
- `app/components/restaurant-events.tsx`.
- `lib/event-locations.ts` (tipos, etiquetas e parametros exclusivos da antiga UI).

As remocoes anteriores de Meus Locais ja existiam no worktree e nao sao novas
remocoes desta entrega. Suas alteracoes foram preservadas.

## Arquivos alterados nesta entrega

### Produto

- [app/restaurant/more/page.tsx](../app/restaurant/more/page.tsx): remove Agenda.
- [app/components/mobile-bottom-nav.tsx](../app/components/mobile-bottom-nav.tsx):
  retira a antiga rota da regra de destaque de Mais.
- [app/restaurant/dashboard/jobs/create/page.tsx](../app/restaurant/dashboard/jobs/create/page.tsx):
  publica somente campos operacionais e origem restaurant; remove toda leitura,
  selecao, heranca de data/local e parametrizacao visual de eventos.

### Testes

- [tests/event-locations.test.mjs](../tests/event-locations.test.mjs):
  ausencia da interface e preservacao dos contratos historicos.
- [tests/work-locations.test.mjs](../tests/work-locations.test.mjs):
  preservacao do catalogo e uso automatico, sem depender do componente removido.
- [tests/operational-ui.test.mjs](../tests/operational-ui.test.mjs):
  publicacao de 1, 2, 20 e 50 profissionais, payload sem evento, erros explicitos
  e ausencia de fallback sem local.
- [tests/geolocation.test.mjs](../tests/geolocation.test.mjs):
  nova origem sem captura de GPS do publicador.
- [tests/restaurant-history.test.mjs](../tests/restaurant-history.test.mjs):
  menu sem Agenda e destino do retorno sem exigir um texto literal.
- [tests/auth-http.test.mjs](../tests/auth-http.test.mjs),
  [tests/auth-proxy.test.mjs](../tests/auth-proxy.test.mjs),
  [tests/auth-routes.test.mjs](../tests/auth-routes.test.mjs) e
  [tests/password-recovery.test.mjs](../tests/password-recovery.test.mjs):
  usam a rota existente de demandas como exemplo, sem mudar autenticacao.

### Documentacao

- [README.md](../README.md).
- [docs/work-locations.md](./work-locations.md).
- [docs/event-location-snapshots.md](./event-location-snapshots.md).
- [docs/mvp-test-and-deploy.md](./mvp-test-and-deploy.md).
- [docs/foundation-auth.md](./foundation-auth.md).
- [docs/design-system.md](./design-system.md).

## Arquivos adicionados

- [Migration retrocompativel](../supabase/migrations/20261019000000_demand_restaurant_location.sql).
- [Testes SQL de localizacao automatica](../tests/demand-restaurant-location-sql.test.mjs).
- Este relatorio.

Alteracoes paralelas nos componentes de perfil, notificacoes e privacidade
nao foram implementadas nem revertidas por esta entrega. Com autorizacao do
usuario, o teste de retorno foi ajustado para validar o destino sem exigir
literalmente o texto antigo do link.

## Rotas removidas

- `/restaurant/events`: pagina visual removida; HTTP 404 confirmado com sessao.
- Nenhuma rota de API foi removida.
- `/restaurant/dashboard/jobs/create` continua disponivel. `?event=` e
  `event_id` em query string nao preenchem nem vinculam dados.

## Dependencias preservadas

- `events`: dados, RLS, trigger de atualizacao e RPC `save_restaurant_event`.
- `work_locations`: dados, coordenadas, versoes, RLS, indices e RPCs.
- `jobs`: FKs de evento/catalogo e todas as constraints de snapshots/proveniencia.
- `demand_events`: historico de demandas; nao corresponde a Agenda.
- `applications`, `demand_reserves`, `demand_invitations`, contratacoes,
  `operational_assignments`, `operational_codes`, `checkins`, `checkouts`,
  pagamentos, avaliacoes, notificacoes e mensagens.
- `create_restaurant_job`, `manage_restaurant_demand`, duplicacao historica,
  funcoes de presenca, cron e `process_operational_schedule`.
- Todas as migrations anteriores e a proposta suspensa (que nao deve ser aplicada).
- Editor e regras de perfil do restaurante; somente a publicacao passa a ler
  seu endereco ja existente.

## Referencias restantes a events

### Infraestrutura intencional

- [20261015010000_restaurant_events.sql](../supabase/migrations/20261015010000_restaurant_events.sql):
  tabela, RLS, indices e trigger.
- [20261015070000_event_location_snapshots.sql](../supabase/migrations/20261015070000_event_location_snapshots.sql):
  snapshots e `save_restaurant_event`.
- [20261015080000_job_location_snapshots.sql](../supabase/migrations/20261015080000_job_location_snapshots.sql):
  FK, tipo de registro e consulta do caminho legado de eventos.
- [Proposta suspensa](../supabase/proposals/20261015050000_operational_locations.sql):
  contrato antigo mantido sem aplicacao.
- A migration de privacidade menciona `restaurant_events`; e uma referencia
  preexistente distinta do nome da tabela `events`, nao alterada nesta entrega.
- Testes de eventos, geolocalizacao SQL, demandas SQL e localizacao automatica
  conservam fixtures/assertions de compatibilidade.
- Documentacao e relatorios historicos continuam descrevendo esses contratos.

### Nomes que nao representam a Agenda

- `events` no detalhe da demanda e um estado React preenchido por `demand_events`.
- `events` no chat representa a linha do tempo de `operational_assignments`.
- A categoria de notificacoes `event` e a preferencia `events_enabled` continuam
  intactas; nao foram tratadas como codigo morto da Agenda.
- Nao resta consulta a tabela `events` nem import do componente da Agenda no
  codigo frontend de producao.

## Referencias restantes a event_id

- Migration de snapshots de vagas: coluna/FK/indice, constraints e copia legada.
- Migration de demandas existente: assinatura da RPC e preservacao na duplicacao.
- Nova migration: parametros legados sao mantidos, rejeitados se combinados com
  origem restaurant e encaminhados somente pelos caminhos compativeis.
- Proposta suspensa e testes SQL de historico/compatibilidade.
- Testes de UI/regressao verificam que a publicacao nao envia `p_event_id` e que
  parametros antigos da URL nao selecionam eventos.
- Nao resta parametro `event_id`/`p_event_id` no frontend de publicacao.

## Validacao executada

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- `npm test` com PGLITE_MODULE apontando para a dependencia ja instalada:
  **148 testes, 146 aprovados, zero falhas e dois ignorados**.
- Os dois ignorados sao HTTP opcionais sem EXTRACHEF_TEST_URL configurada.
- Nova suite SQL usa migrations reais de eventos, catalogo, snapshots de vagas
  e demandas, com RLS/constraints reais em PGlite, sem Supabase remoto.
- Comparacao antes/depois comprova que constraints, policies e todas as outras
  funcoes do schema de teste permanecem iguais.
- Validacao SQL de historico, legado none/catalog/event, duplicacao,
  coordenadas resolvidas, arquivamento, isolamento por dono, conta apagada,
  anonimo/trabalhador, perfil invalido e rollback completo.
- Navegador autenticado: menu Mais sem Agenda e antiga rota retorna 404.
- Formulario conferido em desktop e mobile (390 px), com sete campos
  operacionais, aviso de endereco principal, data nao herdada e sem seletor.
- Nenhum formulario foi submetido ao banco real nessa verificacao.
- `git diff --check`: aprovado. Nao foi executado build de producao.

## Implantacao segura

1. Revisar backup/PITR, historico e schema real do ambiente alvo.
2. Confirmar que as dependencias existentes estao presentes: perfis,
   catalogo/RPCs, snapshots de vagas e RPC atual de demandas.
3. Ensaiar somente a nova migration em staging e validar o perfil de uma conta
   de restaurante com endereco, cidade, UF e CEP completos.
4. Aplicar somente `20261019000000_demand_restaurant_location.sql` no ambiente
   autorizado; nao reaplicar migrations historicas nem usar db push indiscriminado.
5. Confirmar o reload do PostgREST e o caminho restaurant.
6. Publicar o novo frontend e executar uma publicacao controlada autorizada.

A migration usa BEGIN/COMMIT e timeouts. O NOTIFY ocorre apos COMMIT; falha de
reload nao reverte uma funcao ja confirmada. Reverter somente o frontend antigo
e compativel, pois a assinatura e os caminhos legados permanecem disponiveis.

## Possiveis impactos e limites

- Links antigos da Agenda passam a receber 404.
- A publicacao nova exige endereco principal valido; nao cria demanda sem local
  como alternativa silenciosa.
- O backend deve ser publicado primeiro. Sem a migration, o caminho restaurant
  e rejeitado explicitamente; nao existe fallback para none.
- Um endereco novo ou um local arquivado gera novo registro ativo; dados antigos
  nao sao apagados. O catalogo pode crescer com mudancas reais de endereco.
- Ao publicar, o local principal passa a ser o padrao. O padrao anterior perde
  apenas essa condicao, sem perder endereco, coordenadas ou snapshots existentes.
- Mudancas no perfil nao sincronizam locais em tempo real: sao consideradas
  na proxima publicacao, sem modificar o editor de perfil.
- Localizacao de endereco nao implica coordenadas disponiveis. GPS/geocodificacao
  futura continua separada, sem alterar check-in/check-out nesta entrega.
- Clientes legados ainda podem usar explicitamente none/event/catalog por
  retrocompatibilidade; a interface nova nunca solicita esses caminhos.
- O funcionamento completo foi confirmado na UI simulada e no PostgreSQL
  isolado. A publicacao real depende da aplicacao da migration no ambiente alvo.
