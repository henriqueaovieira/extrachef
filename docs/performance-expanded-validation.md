# Validação ampliada de performance

> Registro histórico da campanha concluída. A fase está encerrada e novas
> medições estão congeladas; consultar o [backlog técnico](./performance-backlog.md)
> para critérios de eventual retomada.

## Escopo e método

Campanha executada em 2026-11-04 nas rotas `/worker/profile` e
`/restaurant/candidates`, no build de produção local (`127.0.0.1:3037`) e com
contas de teste autenticadas. Foram feitos 10 reloads independentes por rota,
identificados por `performance.timeOrigin`. Nenhum código de produto,
funcionalidade, regra de negócio, API, banco ou migration foi alterado.

Para `/restaurant/candidates`, a tela foi considerada pronta quando o título
“Talentos” estava presente e os estados “Carregando talentos...” haviam
desaparecido. Para `/worker/profile`, a campanha anterior não registrou um
marcador equivalente de prontidão; portanto, não há métrica comparável de
tempo até conteúdo pronto nessa rota.

As primeiras três capturas do perfil profissional não tinham a mesma
instrumentação detalhada de endpoint das sete restantes. O ranking temporal
usa as 10 caudas registradas; a tabela por endpoint usa apenas as sete
capturas que preservaram os caminhos e durações individuais. Contagens totais
de requests por reload incluem as 10 capturas.

Os p90 usam o método nearest-rank. Os limites CRÍTICO/ALTO/MÉDIO/BAIXO são os
critérios provisórios do [profiling inicial](./performance-profiling.md), não
SLOs do produto. Os reloads usam a mesma sessão e o mesmo navegador; não
representam cache frio, outros dispositivos, produção ou uma distribuição de
usuários.

## Comparativo

| Tela | Reloads | Requests Supabase por reload | Cauda Supabase p50 / p90 / máximo | Prontidão de conteúdo p50 / p90 / máximo | Sinal de volume |
|---|---:|---:|---:|---:|---|
| `/worker/profile` | 10 | 6–15; mediana 13 | 3.555 / 4.093 / 5.388 ms | Não medida de modo comparável | Uma conta e um perfil; sem conjunto de volume |
| `/restaurant/candidates` | 10 | 12 em todos | 1.883 / 3.207 / 4.650 ms | 2.719 / 4.732 / 5.380 ms | 0 operações e 1 registro no diretório RPC na amostra extra |

Na rota do perfil profissional, 8/10 caudas excederam 3 s e uma excedeu 5 s.
Pelo critério provisório, isso confirma uma cauda de rede recorrente ALTA, com
um pico CRÍTICO; não identifica qual request explica sozinho o tempo total.

Em Candidatos, a cauda de rede mediana ficou em MÉDIO, o p90 em ALTO e o máximo
abaixo de 5 s. A prontidão observada teve mediana MÉDIA, p90 ALTO e um pico
CRÍTICO. Nenhum endpoint individual medido excedeu 704 ms, portanto não há um
request isolado comprovado como causa do pico de prontidão.

## `/worker/profile`: requests e atribuição

Nos sete reloads com registros individuais, foram observadas estas durações:

| Endpoint | Requests | Mediana | p90 | Máximo | Status observado |
|---|---:|---:|---:|---:|---|
| `/storage/v1/object/sign/worker-private` | 10 | 290 ms | 1.325 ms | 1.576 ms | 6× 200; 4 sem status exposto |
| `/auth/v1/user` | 26 | 186 ms | 349 ms | 513 ms | 200 |
| `/rest/v1/messages` | 21 | 199 ms | 250 ms | 467 ms | 200 |
| `/rest/v1/worker_profiles` | 6 | 172 ms | 321 ms | 321 ms | 200 |
| `/rest/v1/users` | 7 | 180 ms | 253 ms | 253 ms | 200 |
| `/rest/v1/public_user_directory` | 6 | 177 ms | 225 ms | 225 ms | 200 |
| `/rest/v1/notification_preferences` | 7 | 183 ms | 213 ms | 213 ms | 200 |
| `/rest/v1/notifications` | 7 | 175 ms | 193 ms | 193 ms | 200 |
| `/rest/v1/rpc` | 5 | 165 ms | 213 ms | 213 ms | 200; nome da função não preservado |

Os valores de status 0 do Storage não foram tratados como falha: o Resource
Timing não expôs o status de quatro respostas cross-origin. Bytes de resposta
REST/Storage também não foram expostos pelo navegador; zeros de
`transferSize`/`encodedBodySize`/`decodedBodySize` significam indisponíveis,
não respostas vazias.

O código de [ProfileOverview](../app/components/profile-overview.tsx) confirma
uma cadeia sequencial no carregamento do perfil profissional:
`auth.getUser()` → `public_user_directory` → `worker_profiles` → URL assinada
da foto, quando existente. Isso confirma a ordem técnica, não o percentual da
cauda atribuível a cada etapa. Na instrumentação observada, cada endpoint
individual foi bem mais curto que a cauda total.

Uma amostra separada de CPU teve 2.684 amostras; o frame idle acumulou 4.527 ms
e `createElement` 59 ms. O profiler era amostrado no navegador, não o React
Profiler, e os demais frames de aplicação eram anônimos/minificados. Não é
possível atribuir custo a um componente React específico nem contar renders.

## `/restaurant/candidates`: requests, payload e UI

Cada um dos 10 reloads registrou 12 requests Supabase, todos com status 200:

| Endpoint | Requests | Mediana | p90 | Máximo |
|---|---:|---:|---:|---:|
| `/auth/v1/user` | 30 | 233 ms | 448 ms | 704 ms |
| `/rest/v1/messages` | 30 | 206 ms | 285 ms | 390 ms |
| `/rest/v1/notification_preferences` | 10 | 188 ms | 458 ms | 473 ms |
| `/rest/v1/users` | 10 | 186 ms | 319 ms | 407 ms |
| `/rest/v1/notifications` (HEAD) | 10 | 171 ms | 198 ms | 215 ms |
| `/rest/v1/jobs` | 10 | 180 ms | 199 ms | 204 ms |
| `/rest/v1/rpc/restaurant_talent_directory` | 10 | 204 ms | 244 ms | 322 ms |
| `/storage/v1/object/sign/worker-private` | 10 | 195 ms | 316 ms | 419 ms |

Uma captura adicional, sem guardar conteúdo pessoal, contou 0 linhas em
`/rest/v1/jobs` (2 caracteres JSON) e 1 linha no RPC do diretório (895
caracteres JSON serializados). A resposta RPC não expôs `Content-Length`; os
bytes no Resource Timing permaneceram indisponíveis por CORS. É uma amostra de
volume muito baixo, não uma medição de payload sob carga.

Após autorização explícita e confirmação de staging, tentou-se criar uma
operação sintética pela interface para medir um estado com operação ativa. A
publicação foi bloqueada por `/api/geocode` (HTTP 503: serviço não configurado).
Não foram observadas chamadas de gravação `save_work_location` ou
`create_restaurant_demand`; a tela continuou sem operação ativa. Nenhum dado foi
criado, nenhuma configuração foi alterada e o fluxo não foi contornado.

A tela apresentou 111–115 nós DOM, cinco botões e quatro abas nos reloads
medidos; não havia operação ativa e as contagens das abas eram zero. Isso não
representa volume de candidatos por operação. Nó DOM não equivale a render
React.

O código de [TalentCenter](../app/restaurant/candidates/talent-center.tsx)
confirma que a carga espera `loadDemands`, depois consulta o diretório, busca
convites quando há demandas e assina fotos antes de encerrar o estado de
carregamento. A ordem sequencial está confirmada; seu impacto em um conjunto
representativo não está, pois a conta não tinha operação ativa e o RPC retornou
apenas um registro.

Uma amostra separada de CPU cobriu 3.096 ms, dos quais 2.355 ms foram idle e
741 ms ativos. Os frames de aplicação não permitiram atribuir esse custo a um
componente; um frame anônimo sem URL de origem acumulou 83 ms. O React Profiler
e contagem de renders continuam indisponíveis.

## Causas: classificação da evidência

| Causa/observação | Classificação | Evidência e limite |
|---|---|---|
| Cauda Supabase recorrente em `/worker/profile` | **CONFIRMADA** | 8/10 reloads acima de 3 s; mediana 3.555 ms, p90 4.093 ms e máximo 5.388 ms. A contribuição individual para a cauda não foi atribuída. |
| Cadeia sequencial de carregamento em `ProfileOverview` | **CONFIRMADA** | A ordem auth → diretório público → perfil → Storage está explícita no código. O ganho de paralelizar não foi medido; nenhuma otimização é proposta nesta etapa. |
| 12 requests de `/restaurant/candidates` por reload | **CONFIRMADA** | Contagem idêntica em 10/10 reloads; endpoints individuais medidos abaixo de 704 ms. Contagem, por si só, não prova excesso ou gargalo. |
| Cadeia sequencial do `TalentCenter` | **CONFIRMADA** | A ordem de `await`s e a manutenção do estado de loading até o fim estão explícitas no código. Efeito sob volume relevante não foi testado. |
| Demora de prontidão de Candidatos atribuível a um endpoint específico | **NÃO CONFIRMADA** | p90 de prontidão 4.732 ms, mas nenhum endpoint passou de 704 ms; ausência de dados representativos impede atribuição causal. |
| Renderização de um componente específico como gargalo | **NÃO CONFIRMADA** | Perfis de CPU não identificaram componente React; não houve React Profiler nem render counts. |
| Sensibilidade a volume de candidatos/operações ou payload grande | **NÃO CONFIRMADA** | A conta de restaurante tinha 0 operações e o RPC retornou 1 registro; não há comparação de volumes. |
| Respostas Storage com status 0 em `/worker/profile` representam falha | **NÃO CONFIRMADA** | O navegador não expôs status cross-origin em quatro entradas; não há evidência para classificá-las como erros. |

## Ranking e próximos dados necessários

1. **`/worker/profile` — maior sinal confirmado.** A cauda acima de 3 s se repetiu
   em 8/10 reloads. A cadeia sequencial é uma característica confirmada do
   código, mas não se atribui a ela todo o atraso nem se estima ganho sem uma
   captura com atribuição por etapa e bytes.
2. **`/restaurant/candidates` — prontidão variável, causa não isolada.** O p90
   foi 4.732 ms, enquanto as latências dos endpoints ficaram abaixo de 704 ms.
   É necessário medir novamente com operação ativa e volume representativo.
3. **Render e escala de dados — inconclusivos.** Nenhuma melhoria de produto é
   sugerida sem React Profiler e amostras autorizadas com múltiplos candidatos,
   fotos e operações.

### Limitações

- O cache estava aquecido e as capturas ocorreram no mesmo navegador e na mesma
  conta por rota.
- A duração de respostas concorrentes não é tempo de parede; a cauda é o maior
  `responseEnd` observado desde o reload.
- Resource Timing ocultou os tamanhos das respostas Supabase cross-origin.
  Só uma amostra adicional de Candidatos contou linhas e caracteres JSON.
- Reloads frequentes cancelaram algumas prefetches Next.js e consultas HEAD de
  notificações (`ERR_ABORTED`); esses cancelamentos não foram contados como
  falhas das respostas Supabase medidas.
- A criação da operação de teste ficou bloqueada pela geocodificação não
  configurada em staging; concluir a validação de volume exige corrigir essa
  configuração fora desta sprint ou disponibilizar dados de teste existentes.
- Não houve mudanças de código, banco, APIs, migrations, autenticação,
  notificações, check-in, checkout, pagamentos ou fluxos operacionais.
