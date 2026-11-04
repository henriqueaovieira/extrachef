# Geolocalizacao operacional

## Contrato definitivo: locais operacionais

Coordenadas sao geradas e confirmadas uma unica vez, no cadastro do local
(`work_locations`), e nunca por operacao. Nova Operacao apenas seleciona um
local confirmado; o endereco principal do restaurante vem pre-selecionado.

Cadastro (`/restaurant/locations` ou "+ Novo local" em Nova Operacao):

1. Formulario exige CEP (8 digitos), rua, numero, cidade e UF; o CEP preenche
   o endereco via `GET /api/postal-code/[cep]` (ViaCEP, server-side).
2. `POST /api/locations` (ou `PATCH /api/locations/[id]`) autentica sessao,
   papel e conta ativa e chama `save_restaurant_location` com a sessao do
   usuario. O navegador nunca envia coordenadas.
3. O servidor geocodifica o endereco SALVO via `lib/geocoding` (cache
   persistente, reserva distribuida, adapter Photon com validacao de pais, UF,
   municipio, rua, numero e CEP; CEP generico `xxxxx-000` compara 5 digitos).
4. `apply_work_location_geocode` copia as coordenadas do cache server-only:
   - numero encontrado: `resolved`, precisao `house`;
   - somente rua: `needs_review` com coordenada candidata. O restaurante
     confirma no local (GPS, precisao <= 50 m e ate 1 km do candidato) ou aceita
     explicitamente a posicao aproximada (`confirm_work_location`).
5. Falhas definitivas (`not_found`, `ambiguous`, `invalid_address`) gravam
   `failed` via `record_work_location_geocoding_failure`; falhas transitorias
   mantem `pending` para nova tentativa (`PATCH` com `action: 'locate'`).
6. Alterar o endereco incrementa `address_version` e invalida coordenadas e
   confirmacao.

Publicacao e operacao:

7. `create_restaurant_demand` aceita apenas local ativo, `resolved` e, se
   temporario, valido na data da operacao; o job recebe snapshot `ready`.
8. Recrutamento, candidatura, convite, contratacao e substituicao exigem prontidao.
9. GPS e `issue_operational_code` preservam raio de 100 m, participante atual,
   validacao bilateral, pagamento e checkout.

Locais: um principal por restaurante (permanente), varios permanentes e
temporarios com `valid_until` (ate 1 ano; "Usar apenas nesta operacao" usa a
data da operacao). Locais legados sem CEP permanecem no catalogo, mas so podem
ser usados apos completar o endereco.

Falhas nao geram coordenadas nulas nem sucesso aparente. Nao ha fallback para
centro de cidade/CEP, GPS do publicador ou outro fornecedor.

## Migrations e ordem de implantacao

1. `20261105000000_restaurant_operational_locations.sql` junto com o deploy do
   frontend novo (a partir dela o fluxo antigo exige CEP).
2. `20261105010000_revoke_client_geocoded_locations.sql` apos o frontend novo
   estar ativo: revoga `save_geocoded_work_location` de clientes.
## Configuracao server-only

```dotenv
GEOCODING_PROVIDER=photon
GEOCODING_ENDPOINT=
GEOCODING_TIMEOUT=10000
GEOCODING_CACHE_TTL=7776000
# Opcional (consulta de CEP, padrao ViaCEP)
POSTAL_CODE_ENDPOINT=https://viacep.com.br/ws
POSTAL_CODE_TIMEOUT=4000
```

`GEOCODING_ENDPOINT` e a URL base HTTPS da instancia, sem `/api` ou `/reverse`,
query, fragmento ou credenciais. Nenhuma URL publica e assumida pelo codigo.
Exemplo demonstrativo, somente apos aprovar seu uso: `https://photon.komoot.io`.
Timeout: milissegundos, inteiro entre 1000 e 30000. TTL: segundos, inteiro
entre 60 e 7776000 (90 dias). Configuracao incompleta bloqueia explicitamente.
Photon publico nao exige `GEOCODING_API_KEY`; essa variavel nao e consumida.

Reutilizam-se `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` para
sessao, e `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY` para o cache.
`SUPABASE_URL` e o fallback server-only ja suportado. Todas as URLs devem
apontar ao mesmo projeto. Nunca expor credencial administrativa no frontend.

Para trocar Photon publico por proprio, configurar a nova URL base e
reimplantar a configuracao. O namespace do cache muda automaticamente.
Outra tecnologia exige somente novo adapter no servidor, mantendo os tipos,
API, banco e fluxo operacional; nenhum fallback automatico e instalado.

## Photon e qualidade

Referencia: [Photon](https://github.com/komoot/photon) e
[API](https://github.com/komoot/photon/blob/master/docs/api-v1.md).
O servidor demonstrativo permite uso moderado, pode limitar/bloquear consumo
e nao garante disponibilidade. Sua utilizacao precisa de decisao operacional
consciente; nao e SLA. Instancia propria e o destino recomendado.

O adapter usa `/api` e `/reverse`, sem depender de busca estruturada disponivel
somente em certas versoes. Busca retorna ate cinco candidatos, sem autocomplete.
Comparacao normaliza acentos e pontuacao, mas nao presume equivalencia de
abreviacoes ou aceita numero ausente. Dois candidatos correspondentes separados
por mais de 25 m geram erro de ambiguidade. Esse limiar detecta conflito; nao
representa garantia estatistica de precisao.

Enderecos fora da cobertura OSM ou abreviados diferentemente podem ser recusados.
Isso e preferivel a publicar local errado para uma cerca de 100 m.
Reverse geocoding existe na interface interna, com cache, mas nao e chamado no
check-in nem constitui evidencia de presenca. Nao foi criado endpoint publico
adicional para reverse.

Dados derivados do OpenStreetMap exigem atribuicao e observancia da ODbL:
[copyright](https://www.openstreetmap.org/copyright).
A atribuicao aparece junto ao formulario, sem acoplar o frontend ao adapter.
Nao enviar enderecos pessoais/confidenciais a instancia publica; conferir
privacidade, termos e cobertura antes de habilitar o ambiente.

## Cache e coordenacao

`geocoding_cache` guarda entrada normalizada, hash SHA-256 versionado,
restaurante, operacao (geocode/reverse), namespace, coordenadas, endereco
normalizado do resultado, hash da resposta e timestamps/expiracao.
O nome de exibicao nao integra a chave. Numero e territorio sao preservados.
O JSON bruto do provedor nao e persistido. Hash nao significa anonimato.
O formulario atual e a RPC oficial de sete argumentos trabalham com rua,
numero, cidade e UF; bairro e CEP ficam vazios nesse caminho. Clientes que
consultarem a API com bairro/CEP nao devem presumir que a RPC antiga armazena
esses campos. Nao foi criada outra assinatura da RPC para contornar o contrato.

RLS habilitada e nenhum grant para anon/authenticated. Somente servidor tem
acesso ao cache/coordenacao. Registros acompanham exclusao fisica do usuario
por FK; uma exclusao logica nao elimina automaticamente o cache. A retencao
administrativa deve remover dados expirados e de contas excluidas conforme
politica aprovada. Nenhum job de limpeza foi agendado automaticamente.

- Hit valido: sem consulta externa.
- Miss: consulta coordenada, depois upsert.
- Refresh: expiracao obriga nova consulta; nao serve stale silenciosamente.
- Invalidacao: `GeocodingCache.invalidate` e operacao interna server-only;
  tambem e possivel remover entrada por procedimento administrativo autorizado.
- Mudanca de endereco/instancia: outra chave/namespace.
- TTL nao invalida snapshots de operacoes ja publicadas.

`geocoding_requests` coordena uma consulta por namespace por vez. Lease vale
timeout arredondado mais 10 s; token impede liberar reserva de outro request.
Cooldown global minimo de 1 s e limite por restaurante de uma nova consulta
externa a cada 10 s. Cache hits nao consomem esse limite. Em concorrencia a API
responde 429 com Retry-After, sem filas locais ou retries automaticos.
429 do fornecedor gera cooldown (Retry-After ou 60 s, limitado a 3600 s).
Esses limites sao conservadores da aplicacao, nao quotas oficiais do Photon.
Deployments compartilhando endpoint devem compartilhar banco/namespace para
coordenacao conjunta; bancos independentes nao coordenam entre si.

Cache/coordenador indisponivel bloqueia a consulta externa. Falha de release
e explicita; lease expira e evita bloqueio permanente. Nao manter transacao de
banco aberta enquanto faz HTTP.

## Logs e alertas

Evento estruturado `geocoding` inclui requestId, event, durationMs quando
disponivel, code e providerStatus em falhas HTTP do fornecedor. A resposta da
API inclui `X-Request-Id`. Nao registrar endereco, resposta bruta, chave,
usuario ou coordenadas do trabalhador.

Eventos: `auth_failed`, `profile_failed`, `forbidden`,
`account_validation_failed`, `cache_hit`, `cache_miss`, `cache_refresh`,
`resolved`, `failed`, `request_failed`.

Codigos: `configuration`, `invalid_address`, `not_found`, `ambiguous`,
`timeout`, `offline`, `rate_limited`, `provider_error`, `invalid_response`,
`invalid_coordinates`, `cache_error`, `internal`.

HTTP: 400 entrada invalida; 401 sem sessao; 403 sem permissao;
422 endereco nao localizado/ambiguo; 429 ocupado; 502 resposta invalida;
503 configuracao, cache ou fornecedor indisponivel.

No agregador de logs existente, acompanhar:

- sucesso/erro e p95 de duracao;
- hit ratio e taxa de refresh;
- 429, 5xx, timeout/offline;
- configuracao/cache falhando apos release;
- publicacoes bloqueadas e prontidao dos jobs.

Alertas sugeridos: qualquer erro de configuracao apos implantacao; falha de
cache persistente; crescimento de 429; erro externo acima de 5% em 15 min com
amostra suficiente. Criacao de alertas na Vercel/infra exige autorizacao externa;
este codigo gera eventos, nao provisiona dashboards/alertas.

## Implantacao manual

1. Backup/PITR e exportacao das definicoes/grants atuais. Conferir migrations
   registradas e assinatura de vaga unica, recrutamento e GPS restaurado.
2. Restaurar RPC ausente usando
   [reconciliacao oficial](../supabase/migrations/20261104040000_reconcile_geocoded_locations.sql).
   Nao reaplicar a migration original que tambem impunha outro trigger.
3. Revisar/aplicar
   [cache](../supabase/migrations/20261104200000_geocoding_cache.sql).
4. Em janela sem novas publicacoes, disponibilizar aplicacao/configuracao
   candidata e aplicar
   [prontidao](../supabase/migrations/20261104210000_operational_location_readiness.sql).
   A coordenacao evita clientes antigos publicando pelo fallback.
5. Validar em staging antes de producao. Nao executar db push indiscriminado.
6. Confirmar cache protegido, assinatura RPC unica, reload PostgREST, job com
   `ready`/coordenadas, convite/candidatura/contratacao/substituicao,
   check-in dentro/no limite/fora de 100 m, pagamento e checkout.
7. Testar miss/hit e chamadas concorrentes entre instancias reais. PGlite
   valida SQL, nao HTTP PostgREST, JWT real ou concorrencia de varios servidores.
8. Monitorar e tratar legados pelo
   [plano de recuperacao](./geolocation-recovery-plan.md).

Migrations nao foram aplicadas a producao por esta implementacao.

## Validacao local desta entrega

- Suite completa com suites opcionais SQL e HTTP habilitadas: 254 aprovados,
  nenhuma falha e nenhum skip.
- SQL executado somente em bancos PGlite efemeros. Inclui criacao/snapshot,
  atestacao de coordenadas, isolamento, expiracao, coordenacao, recrutamento,
  contratacao/substituicao reais via RPCs, GPS/raio, pagamento e checkout.
- HTTP usa servidor local de producao e sessoes nao autenticadas; testes de
  adapter usam respostas simuladas, nao consultam enderecos reais.
- Lint sem erros, com 16 avisos preexistentes em JavaScript gerado do Android.
- Typecheck e build de producao aprovados.

Isso nao comprova conectividade/cobertura do Photon escolhido, permissoes JWT
reais no Supabase, concorrencia multi-instancia ou GPS de dispositivo em
producao. O checklist manual acima continua obrigatorio.

## Rollback

Suspender novas publicacoes se necessario. Voltar somente a release compativel,
mantendo bloqueio de coordenadas ausentes. Preservar dados/cache/snapshots.
Usar migration forward revisada para restaurar definicoes, nao remover tabelas
ou restabelecer GPS legado. Nao remover `participant_assignment` nem alterar
pagamentos/checkout para contornar falhas geograficas.

O guard de novos jobs e deferred ate commit: permite a duplicacao existente
montar seu snapshot na mesma transacao, mas nao permite persistir job invalido.
Nao executar `SET CONSTRAINTS ... IMMEDIATE` dentro desse fluxo historico.
