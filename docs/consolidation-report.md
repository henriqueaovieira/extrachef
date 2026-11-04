# Consolidacao e limpeza segura do ExtraChef

## Escopo e evidencias

Auditoria do worktree local em 2026-11-03, sobre o commit
`f64c18810f7b48850db7ae77c687c365a23576c2`, incluindo alteracoes preexistentes.
Este documento nao afirma que o worktree corresponde ao deployment publicado.
Nenhum inventario remoto de trafego, banco ou objetos do Storage foi consultado.
Ausencia de links internos nao comprova ausencia de favoritos, deep links,
consumidores externos ou uso em versoes antigas.

Somente as fases 1 e 2 alteram codigo de produto. As demais sao inventarios.
Nenhum helper, rota, API, fluxo operacional, dependencia npm ou migration foi
removido. Push, check-in, checkout, pagamentos e regras de negocio foram preservados.

## Fase 1: componentes sem consumidores

Classificacao: **Remover agora**, executado para:

- `app/components/communication-navigation.tsx`
- `app/components/job-presence-location.tsx`
- `app/components/work-location-fields.tsx`

Antes das exclusoes foram pesquisados nomes de arquivos, simbolos, imports,
reexports, `import()`, `require()`, `dynamic` e `lazy` no codigo da aplicacao.
A inspecao sintatica tambem verificou loaders com argumentos calculados.
Nao foram encontrados importadores diretos, indiretos ou carregamentos em runtime
dos tres componentes. Eles nao sao entradas convencionais do Next.js.

Foram encontrados dois testes que liam arquivos abandonados como texto, sem montar
os componentes. Esses testes agora verificam a navegacao e o formulario ativos.
Regressoes adicionais verificam ausencia dos arquivos e de referencias em app/lib.
A documentacao de comunicacao foi atualizada; nenhuma implementacao Push mudou.

## Fase 2: score sem consumidor no frontend

Classificacao: **Remover agora**, executado em:

- [ProfileOverview](../app/components/profile-overview.tsx): retirada de `score`
  do SELECT de `public_user_directory`, de `ProfileView` e dos dois objetos
  enviados a `setProfile`.
- [ProfilePage](../app/profile/page.tsx): retirada de `score` do SELECT e de
  `UserProfile`, evitando seu armazenamento no estado.

O estado `profile` continua existindo. Nenhum estado funcional foi removido.
Nao houve alteracao de payload de gravacao no banco.
[OperationalReputationView](../app/components/operational-reputation.tsx),
reputacao, score operacional, RPCs e usos em talentos/mensagens foram preservados.

## Fase 3: inventario de perfil

| Rota | Implementacao e consumidores | Autenticacao | Classificacao |
| --- | --- | --- | --- |
| `/profile` | [Pagina generica](../app/profile/page.tsx). Sem link exato de navegacao identificado; reconhecida em regras e testes de autenticacao. | Proxy, SessionGuard e consulta autenticada. | Consolidar futuramente |
| `/worker/profile` | [Menu Mais](../app/worker/profile/page.tsx), via MoreNavigation. Consumido pela navegacao principal, retorno das preferencias e do perfil detalhado. | Protecao `/worker`; papel profissional. | Manter agora; consolidar futuramente |
| `/worker/profile/details` | [Visualizacao](../app/worker/profile/details/page.tsx), via ProfileOverview. Avatar, Mais, verificacao, confianca e cancelar edicao apontam para ela. | Protecao `/worker`; papel profissional. | Manter |
| `/worker/profile/edit` | [Edicao](../app/worker/profile/edit/page.tsx), via ProfileEditor. Acessada por editar/completar perfil e preencher requisitos de verificacao. | Protecao `/worker`; papel profissional. | Manter |

Nenhuma dessas rotas foi removida ou redirecionada nesta sprint.
Os caminhos completos, queries e hashes podem estar em favoritos ou links externos.
O uso externo real e desconhecido sem telemetria; nao considerar `/profile` morta.

### Recomendacao para ponto unico `/worker/profile`

1. Definir o destino dos itens atuais de Mais antes de mudar a pagina principal;
   nao simplesmente substituir o menu pelo perfil e perder preferencias/historico.
2. Em outra sprint, tornar `/worker/profile` a entrada canonica de identidade,
   especialidades, verificacao e confianca, reutilizando os componentes existentes.
3. Preservar edicao como subrota, evitando unir leitura e formulario sem necessidade.
4. Atualizar avatar, navegacao, retornos e hashes `verification`/`confidence`.
5. Manter compatibilidade de `/worker/profile/details`, preservando query/hash e
   protecao de autenticacao. Definir redirecionamento de `/profile` por papel.
6. Validar deep links, sessoes expiradas, papeis, voltar/cancelar e historico
   do navegador antes de descontinuar URLs antigas.

## Fase 4: inventario de mensagens

- [Pagina propria](../app/restaurant/messages/page.tsx): `/restaurant/messages`.
  Consumidores: navegacao principal e retorno do chat.
- [Pagina de candidatos](../app/restaurant/candidates/page.tsx):
  `/restaurant/candidates?view=messages` monta o mesmo RestaurantMessageCenter.
  Nenhum produtor literal de `view=messages` foi identificado no codigo atual.
- Ambas compartilham [RestaurantMessageCenter](../app/restaurant/messages/message-center.tsx),
  helpers de inbox, contexto de comunicacao e regras existentes de operacoes/chat.
- Ambas dependem da autenticacao e papel restaurante. A navegacao possui tratamento
  explicito do modo Mensagens na pagina de candidatos.

Classificacao: **Consolidar futuramente** o caminho legado; **Manter** o componente
compartilhado e a rota propria. Antes de trocar por redirecionamento, verificar
parametros de selecao, links antigos, navegacao ativa e consumidores externos.
Nao alterar conversas, Realtime, notificacoes ou permissao de participantes.

## Fase 5: helpers utilizados apenas em testes

| Helper | Implementacao | Consumidor encontrado | Classificacao |
| --- | --- | --- | --- |
| `jobLocationValues` | [work-location](../lib/work-location.ts) | geolocation.test.mjs | Consolidar futuramente |
| `eventLocationValues` | [work-location](../lib/work-location.ts) | geolocation.test.mjs | Consolidar futuramente |
| `locationFromEvent` | [work-location](../lib/work-location.ts) | geolocation.test.mjs | Consolidar futuramente |
| `nextDemand` | [restaurant-home](../lib/restaurant-home.ts) | restaurant-home.test.mjs | Consolidar futuramente |
| `demandProgress` | [demand-detail](../lib/demand-detail.ts) | demand-detail.test.mjs | Consolidar futuramente |

Nao foram encontradas chamadas de aplicacao, indiretas por imports/reexports ou
carregamento dinamico desses cinco exports. Os testes carregam modulos transpilados
e acessam os exports: ha contrato de testes, nao evidencia de fluxo de usuario.
Todos os helpers e respectivos testes foram preservados.

Nao remover os modulos inteiros: geocodificacao e distancias, helpers da Home e
carregamento de participantes/fotos de demandas possuem consumidores atuais.

## Fase 6: LEGACY_FIELDS

Classificacao: **Manter**, sem alteracao:

| Campo | Situacao |
| --- | --- |
| `worker_profiles.whatsapp` | Sem input profissional. Valor historico mantido internamente por compatibilidade com NOT NULL; perfis novos usam string vazia. |
| `worker_profiles.resume_pdf_path` | Referencia historica, sem upload ou exibicao pelo editor atual. |
| `worker_profiles.certificates` | Referencias historicas, sem upload, lista ou contagem na interface atual. |

Nao criar migration nem remover colunas, dados ou arquivos por falta de uso visual.
Exportacao e exclusao autenticada de conta continuam com seus contratos.

## Fase 7: Storage

| Bucket | Consumidores ativos confirmados no codigo | Classificacao |
| --- | --- | --- |
| `worker-private` | Foto em ProfileEditor/ProfileOverview, dashboards, candidaturas, mensagens; selfie em ProfileVerification; fotos em signDemandPhotos e notificacoes. | Manter |
| `restaurant-assets` | Logo/fotos em ProfileEditor/ProfileOverview, logo na Home e imagens de notificacoes. | Manter |

A [exclusao autenticada de conta](../app/api/account/delete/route.ts) tambem
processa os dois buckets. Nenhuma configuracao, objeto ou permissao foi alterada.
Nao foi feito inventario de objetos remotos; nenhum upload pode ser declarado
orfao por esta auditoria. Documentos historicos continuam preservados.

## Fase 8: API de diagnostico

[GET /api/debug/env](../app/api/debug/env/route.ts) nao possui consumidor de
interface identificado. Possui testes em push-status.test.mjs e uso operacional
documentado em [coleta de producao](./push-production-collection.md) e
[diagnostico Push](./push-status-diagnosis.md).

E uma entrada HTTP externa, habilitada por `PUSH_DIAGNOSTICS_ENABLED`, sem leitura
de trafego real nesta auditoria. Classificacao: **Consolidar futuramente**
(pode remover futuramente apos encerrar o diagnostico e atualizar os runbooks);
**Manter nesta sprint**. Nenhuma API ou configuracao Push foi alterada.

## Fase 9: duplicacao e complexidade

| Item | Evidencia e oportunidade | Classificacao |
| --- | --- | --- |
| Navegacao de comunicacao abandonada | Sem importadores; sobrepunha links/badges da navegacao ativa. | Remover agora: executado |
| Formulario e painel de local abandonados | Sem paginas consumidoras; helpers/API de geocodificacao continuam ativos. | Remover agora: executado |
| Score local sem leitura nos perfis | Consulta e propriedade de estado sem uso posterior. | Remover agora: executado |
| Perfil generico e especificos | Identidade, cidade e reputacao apresentadas por entradas diferentes. | Consolidar futuramente |
| Mensagens por rota propria e query de candidatos | Mesmo componente montado por duas entradas. | Consolidar futuramente |
| Wrappers de check-in e checkout | Ambos montam OperationalPanel; pagamento tambem usa o painel. URLs sao contratos operacionais, nao fluxos independentes descartaveis. | Manter |
| Foto/URL assinada do profissional | Consultas semelhantes em Home, candidaturas, mensagens e perfil; possivel mecanismo compartilhado com lifecycle e erros preservados. | Consolidar futuramente |
| NotificationCenter e NotificationExperience | Lista de avisos versus coordenacao global, badges e mensagens flutuantes. Nao sao substitutos. | Manter |
| SessionGuard e proxy | Validacao cliente versus servidor; nao eliminar uma camada por semelhanca. | Manter |
| ProfileVerification, ProfessionalVerification e VerifiedProfileBadge | Fluxo privado, consulta publica e apresentacao do selo. | Manter |
| Tipos de catalogo em lib/work-locations.ts | Sem importadores de produto identificados, mas preservados por contrato de teste. | Consolidar futuramente |

## Riscos e proximas etapas

- O worktree ja tinha alteracoes de verificacao, operacoes e uma migration nao
  rastreada antes desta sprint; elas nao foram criadas nem revertidas aqui.
- Testes locais nao equivalem a comprovacao de trafego real ou uso de favoritos.
- Nao remover APIs chamadas por webhooks, buckets ativos, campos internos de RPCs,
  migrations historicas ou dependencias de build/Android por falta de JSX.
- Proxima sprint: decidir arquitetura canonica do perfil, levantar deep links
  externos e desenhar compatibilidade antes de implementar redirecionamentos.
- Depois, consolidar entrada de mensagens e revisar helpers apenas de testes,
  separadamente e com contratos de regressao.

## Validacao

| Verificacao | Resultado |
| --- | --- |
| Baseline antes da limpeza | 189 testes: 185 aprovados, 4 ignorados por configuracao, 0 falhas. |
| Suite completa apos a limpeza | 191 testes: 189 aprovados, 2 HTTP inicialmente ignorados, 0 falhas. PGLITE_MODULE apontou para o pacote ja instalado para executar tambem os testes SQL opcionais em memoria. |
| Testes HTTP no build de producao local | 12 testes/subtestes aprovados, 0 ignorados; cobrem os dois casos HTTP inicialmente ignorados e seus dez caminhos protegidos. Servidor temporario confirmou HTTP 200 no login e foi encerrado apos a validacao. |
| `npm run typecheck` | Aprovado. |
| `npm run lint` | Codigo de saida 0; 0 erros, 16 avisos em `android/app/build/intermediates/assets/debug/mergeDebugAssets/native-bridge.js`, arquivo gerado e nao alterado pela sprint. |
| `npm run build` | Aprovado na segunda execucao; compilacao, tipos e geracao das rotas concluidos. |
| `git diff --check` | Aprovado. |
| Comparacao de hashes anteriores/posteriores | No codigo de produto: somente tres componentes excluidos e as duas telas de perfil alteradas. app/api, lib, public, supabase, dependencias e AGENTS.md preservados. |

O primeiro build compilou e gerou as rotas, mas terminou com SecurityFatalError:
o proprio Next.js informou vulnerabilidade conhecida na versao instalada e
orientou repetir o comando. A repeticao concluiu com sucesso, mantendo o aviso.
Isso nao corrige a vulnerabilidade: recomendar atualizacao de seguranca em tarefa
separada, com validacao propria. Nenhuma dependencia foi atualizada nesta sprint.

Os testes SQL executam PostgreSQL isolado em memoria; nao alteram tabelas remotas.
Os testes de operacoes, notificacoes, geocodificacao, privacidade e verificacao
passaram. As rotas de check-in, checkout, pagamentos e as oito APIs permanecem
no build. Nao foi realizada homologacao manual autenticada de todos os fluxos;
a confirmacao de preservacao se baseia nos testes e na integridade dos arquivos.

## Entrega e limites do diff

Arquivos excluidos: os tres componentes listados na fase 1.

Arquivos alterados nesta sprint:

- [app/components/profile-overview.tsx](../app/components/profile-overview.tsx)
- [app/profile/page.tsx](../app/profile/page.tsx)
- [tests/ui.test.mjs](../tests/ui.test.mjs)
- [tests/geolocation.test.mjs](../tests/geolocation.test.mjs)
- [docs/communication-qa.md](./communication-qa.md)

Arquivo criado: este relatorio.

Existiam alteracoes nao commitadas antes da sprint, inclusive nos perfis e testes.
O diff contra HEAD inclui trabalho anterior; nao atribuir todas essas mudancas
a limpeza. Nenhum commit, push ou deployment foi realizado nesta sprint.
