# Performance profiling do ExtraChef

## Escopo e método

Medição de runtime realizada em 2026-11-03, hora local, sem alteração de código
de produto ou de comportamento. O profiling foi feito no build de produção já
disponível no worktree, servido localmente em `127.0.0.1:3037`, com sessão de
teste autenticada no navegador integrado.

Uma navegação medida por rota, com cerca de cinco segundos de estabilização:

- `/restaurant/dashboard`
- `/restaurant/messages`
- `/restaurant/candidates`
- `/worker/profile`

Foram coletados Navigation Timing, entradas de Resource Timing, contagens de
requests para o Supabase, grupos de endpoint sem query string, duração das
respostas, bytes informados pelo navegador para assets locais e quantidade de
nós DOM no fim da janela de observação.

### Como ler os números

- **Carga do documento** é `responseStart` / `DOMContentLoaded` / `load`; não é
  tempo até os dados do usuário estarem visíveis.
- **Última resposta Supabase** é o maior `responseEnd` observado relativo ao
  início da navegação. Serve como proxy do fim do trabalho de rede inicial, não
  como métrica formal de interatividade.
- **Duração acumulada Supabase** soma requests que podem ocorrer em paralelo;
  não representa tempo de parede.
- **Request Supabase** significa uma requisição de rede observada (Auth,
  PostgREST/RPC ou Storage), não uma instrução SQL executada no servidor.
- O navegador não expôs `transferSize`, `encodedBodySize` nem `decodedBodySize`
  das respostas Supabase cross-origin; valores zerados abaixo significam
  **indisponíveis**, não payload vazio. Tamanhos das respostas do banco não
  puderam ser medidos com a instrumentação disponível.
- **Chunks JS** e bytes são os recursos locais observados no browser. Podem
  incluir runtime e módulos comuns/prefetch do App Router; não equivalem a
  quantidade de componentes React montados.
- **Nós DOM** são uma fotografia da árvore ao fim da observação, não o número de
  renderizações React. Contagem de commits/renders requer React Profiler ou
  instrumentação específica, ausente e não adicionada nesta medição.

Os resultados são uma amostra única por rota, em navegação autenticada e com
cache local aquecido. A conta de restaurante de teste tinha zero operações
ativas e zero mensagens não lidas no Dashboard. A amostra não representa
restaurantes com grande volume de dados, dispositivos lentos, cache frio,
produção ou percentis de múltiplas sessões.

## Resultados por tela

| Tela | Requests Supabase | Composição observada | Última resposta Supabase | Duração acumulada (paralela) | Documento: response / DOMContentLoaded / load | Chunks JS / bytes codificados | Nós DOM | Classificação |
|---|---:|---|---:|---:|---|---:|---:|---|
| `/restaurant/dashboard` | **17** | Auth 3; REST/tabela 12; RPC 2 (`pending_operational_reviews`, `restaurant_operational_message_inbox`) | **2.157 ms** | 4.387 ms | 738 / 760 / 774 ms | 9 / **232.830 B** (227,4 KiB) | 126 | **MÉDIO** |
| `/restaurant/messages` | **12** | Auth 4; REST/tabela 7; RPC 1 (`restaurant_operational_message_inbox`) | **2.892 ms** | 6.010 ms | 700 / 720 / 740 ms | 9 / **230.672 B** (225,3 KiB) | 104 | **MÉDIO** |
| `/restaurant/candidates` | **12** | Auth 3; REST/tabela 7; RPC 1 (`restaurant_talent_directory`); Storage 1 | **3.104 ms** | 4.909 ms | 615 / 652 / 689 ms | 9 / **234.978 B** (229,5 KiB) | 109 | **ALTO** |
| `/worker/profile` | **15** | Auth 4; REST/tabela 8; RPC 1 (`worker_operational_reputation`); Storage 2 | **3.747 ms** | 6.770 ms | 428 / 459 / 564 ms | 14 / **265.846 B** (259,6 KiB) | 242 | **ALTO** |

O documento HTML teve `decodedBodySize` próximo de 10,7 KB nas quatro rotas.
Essa medida é do HTML/shell, não dos dados retornados pelos endpoints.

### Assets e componentes

Os recursos locais observados incluíram CSS, fontes, runtime e chunks do Next,
além do chunk específico da rota. Bytes locais decodificados no browser (não
bytes de fio; variam com cache):

| Tela | Recursos locais | Bytes decodificados locais | Chunk específico da página no build (bruto) |
|---|---:|---:|---:|
| Dashboard | 12 | 914.246 B | 36.032 B |
| Mensagens | 12 | 904.117 B | 25.903 B |
| Talentos | 12 | 921.828 B | 43.614 B |
| Perfil profissional | 31 | 1.052.300 B | 43.233 B |

O chunk específico é apenas o módulo de página gerado pelo build; ele não
representa o tamanho total da experiência. O conjunto compartilhado de runtime
e componentes domina os recursos listados no HTML. O número de chunks no browser
pode incluir prefetch e carregamentos adicionais do perfil, por isso não deve
ser interpretado como número de componentes React.

### Renderizações

| Tela | Nós DOM ao fim da captura | Contagem de renders/commits React |
|---|---:|---|
| Dashboard | 126 | **Não medida** |
| Mensagens | 104 | **Não medida** |
| Talentos | 109 | **Não medida** |
| Perfil profissional | 242 | **Não medida** |

Não houve profiler React ligado ao build e nenhum contador foi inserido. Os nós
DOM são fornecidos apenas como dimensão aproximada da árvore apresentada; não
permitem inferir quantas vezes um componente renderizou.

## Ranking dos maiores gargalos observados

Ordenação pelo fim da cauda inicial de rede; bytes Supabase e volume de dados
não estavam acessíveis, então o ranking não é uma comparação de payloads.

| Rank | Tela | Sinal dominante | Classificação |
|---:|---|---|---|
| 1 | `/worker/profile` | Maior cauda de API (**3,747 s**), maior número de requests entre as telas de perfil/área (**15**), maior conjunto de chunks (**14**) e mais nós DOM (**242**). | **ALTO** |
| 2 | `/restaurant/candidates` | Cauda de API de **3,104 s**, incluindo diretório RPC e Storage para fotos; busca e filtro são feitos sobre dados em memória. | **ALTO** |
| 3 | `/restaurant/messages` | Cauda de API de **2,892 s** e maior duração acumulada paralela (**6,010 s**) na amostra; RPC da inbox e atualização de mensagens são dependências principais. | **MÉDIO** |
| 4 | `/restaurant/dashboard` | Maior quantidade de requests (**17**), mas menor cauda observada (**2,157 s**) nesta conta vazia; rotinas de operações, avaliações e inbox concorrem na carga. | **MÉDIO** |

**CRÍTICO:** nenhum confirmado pela amostra.

## Critérios de classificação usados

Aplicados à última resposta Supabase observada, não ao `load` do HTML:

- **CRÍTICO:** acima de 5 s.
- **ALTO:** acima de 3 s até 5 s.
- **MÉDIO:** acima de 1,5 s até 3 s.
- **BAIXO:** até 1,5 s.

Os limites são critérios operacionais deste relatório, não SLO do produto.
Volume de requests, chunks e DOM complementa o ranking, mas não altera sozinho
a classificação temporal. Uma única amostra não permite afirmar percentis,
reprodutibilidade ou causalidade.

## Conclusões e limites

1. A duração do HTML está entre **0,56 e 0,77 s**, mas o fim das respostas de
   rede Supabase ficou entre **2,16 e 3,75 s**. Usar apenas o `load` do documento
   subestima o tempo até a conclusão das consultas iniciais.
2. Perfil profissional e Talentos são as maiores caudas observadas; ambos
   carregam conteúdo adicional (reputação/fotos/diretório), mas não se pode
   atribuir causalidade a uma consulta específica sem medidas repetidas e
   payloads.
3. Dashboard teve mais requests, mas não a maior latência de parede no cenário
   observado. Sua amostra vazia não valida como se comporta com muitas
   operações, pendências e conversas.
4. Os payloads de respostas Supabase e o número exato de renders React continuam
   **não medidos**. Para fechar esses dois itens sem inferência, será necessário
   habilitar captura de tamanho de resposta no nível de rede (HAR/DevTools com
   acesso cross-origin) e React Profiler em build apropriado, com amostra
   representativa e consentida.
5. Esta tarefa foi exclusivamente diagnóstica: nenhuma otimização ou alteração
   funcional foi realizada. A única mudança persistente é este relatório.
