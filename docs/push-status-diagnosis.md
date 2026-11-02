# Diagnostico de `/api/push/status` na Vercel

Para executar somente a coleta, use o [procedimento operacional final, com JSONs e checklist](./push-production-collection.md).

## Rodada pratica: capturar a excecao real em producao

Esta rodada acrescenta instrumentacao temporaria e uma reproducao usando o SDK real instalado, nao apenas mocks. O ranking da investigacao inicial abaixo nao comprova a causa remota; este procedimento permite substitui-lo por evidencia do deployment.

### Descoberta reproduzida

No SDK instalado, `SupabaseClient` inicializa Realtime dentro do construtor. O construtor de Realtime resolve um transporte WebSocket imediatamente, mesmo que o consumidor so utilize Auth/REST. Sem WebSocket global, o SDK lanca sincronamente:

```text
Node.js detected but native WebSocket not found.
```

O experimento usou URL/chave sinteticas e bloqueou `fetch`. Com WebSocket nativo, `createClient()` inicializou. Removendo apenas o WebSocket global, lancou a excecao acima. Nos dois casos houve **zero chamadas externas**. O teste automatizado reproduz isso contra o SDK real, atraves do factory admin.

Fontes: `node_modules/@supabase/supabase-js/src/SupabaseClient.ts` (construtor), `node_modules/@supabase/realtime-js/src/RealtimeClient.ts` (`_initializeOptions`) e `node_modules/@supabase/realtime-js/src/lib/websocket-factory.ts` (`detectEnvironment`). A verificacao de formato de chave em `supabase-js/src/lib/fetch.ts` explicitamente nao lanca por uma chave nao reconhecida: uma chave nao vazia mas revogada/incorreta normalmente falha depois, no servidor.

**Controle contrario importante:** ao repetir a tentativa no build real com `next start`, o Next.js disponibilizou WebSocket, o admin inicializou e o request chegou a Auth. A chamada externa de Auth foi deliberadamente bloqueada no teste; nao houve acesso ao Supabase remoto. A implementacao esta em `node_modules/next/dist/server/node-environment-baseline.js`: quando falta WebSocket, instala o transporte compilado `ws` no global.

Portanto **E/F foi reproduzida no SDK isolado, mas nao no caminho normal do build Next.js**. Nao ha base para eleger E como causa mais provavel de producao. Com os dados atuais, A/B/D continuam sem distincao: nomes no painel nao demonstram o estado do processo implantado. C por chave nao vazia mas incorreta tampouco explica a excecao do construtor observado. Se ambos os valores forem comprovadamente nao vazios no processo, URL valida e WebSocket disponivel, resta procurar a excecao F ou uma revisao diferente D; nao e correto escolher uma sem a resposta instrumentada.

Outro limite: no factory original, chave contendo somente espacos era truthy e nao disparava a guarda de ausencia; o novo factory normaliza espacos e a rejeita. String vazia ou undefined, sim, disparavam a guarda original. O caso de espacos testa o diagnostico novo, nao comprova sozinho o 503 anterior.

### O que foi instrumentado

Ative temporariamente **`PUSH_DIAGNOSTICS_ENABLED=true`** em Production e publique o codigo novo:

- Admin registra tipos, comprimentos, ausencia, string vazia, somente espacos, preenchimento nas bordas, validade da URL selecionada, fonte da URL/chave e igualdade das duas credenciais sem revelar valores.
- `keysEqual: false` nao indica erro por si so: service-role legada e secret-key nova podem ser diferentes e validas. A precedencia continua service-role nao vazia, depois secret-key; nao ha troca automatica quando a primeira e rejeitada remotamente.
- Registra `runtime.nodeVersion`, `runtime.websocketType` e `runtime.fetchType`.
- Compara metadados da URL publica usada pelo codigo (potencialmente incorporada no build) com o valor efetivo em `process.env` da funcao, usando acesso dinamico. `buildAndRuntimeUrlMatch: false` indica divergencia, nao revela as URLs.
- Antes do SDK: evento `supabase_admin_sdk_start`. Sucesso: `supabase_admin_initialized`. Excecao: `supabase_admin_configuration_failed`, `code=initialization_failed`, categoria `sdkException`. Mensagens arbitrarias e stacks nunca sao serializadas.
- Status inclui temporariamente `step`, `reason`, `requestId` e `diagnostics` alem dos campos anteriores. Falhas locais incluem o snapshot que causou a excecao.
- Versao da instrumentacao: `diagnostics.version=admin-env-v2`.
- [GET /api/debug/env](../app/api/debug/env/route.ts) retorna exatamente os quatro campos pedidos: `hasSupabaseUrl`, `hasServiceRoleKey`, `supabaseUrlLength`, `serviceRoleLength`. Nao inicializa Supabase, nao faz requests e usa `no-store`.

O endpoint de debug fica acessivel sem sessao somente durante a flag ativa, expondo apenas os quatro metadados. Sem flag retorna 404. Os booleanos usam `Boolean(valor)`: uma string de espacos pode aparecer como presente; consulte `whitespaceOnly` em status/logs para distinguir. A URL do endpoint acompanha o mesmo acesso direto a variavel publica do admin, podendo refletir o build; a comparacao runtime esta nos diagnosticos detalhados.

### Sobrescritas e runtime: resultado da busca

- Nenhuma escrita em `process.env` foi encontrada no codigo de producao. Escritas/restauracoes existem apenas em testes de geocodificacao e comunicacao; nao sao executadas pelo build nem por `next start`.
- Nao existem middleware ou instrumentation customizados no codigo-fonte examinado.
- [proxy.ts](../proxy.ts) nao escreve no ambiente e seu matcher nao cobre APIs push/debug.
- [next.config.ts](../next.config.ts) nao define `env`, runtime customizado nem reescrita de variaveis.
- Os factories Supabase leem o ambiente, mas nao o alteram. Apenas admin seleciona service-role/secret-key; os demais clientes usam a chave anon publica.
- Como esperado, Next.js pode carregar arquivos `.env` e incorporar `NEXT_PUBLIC_*` no build. Isso nao equivale a uma sobrescrita feita pelo codigo da aplicacao.
- Nao ha runtime fixado em `package.json` por `engines.node`. A versao efetiva da funcao precisa ser lida no novo diagnostico e comparada com Settings da Vercel.

### Implantacao e coleta, sem adivinhar

1. Publique os arquivos novos/alterados desta instrumentacao pelo fluxo Git conectado a Vercel. Apenas clicar Redeploy numa revisao antiga nao envia mudancas locais. Revise o diff: a arvore local possui outras alteracoes que nao devem ser incluidas automaticamente.
2. Em **Settings > Environment Variables**, cadastre `PUSH_DIAGNOSTICS_ENABLED=true` para **Production**. Nao mude as credenciais durante a primeira coleta: isso preserva a condicao que esta falhando.
3. Crie um deployment novo a partir da revisao instrumentada. Se usar Redeploy, escolha essa revisao e desmarque o reaproveitamento do Build Cache. Confirme estado Ready e o dominio apontando para esse deployment.
4. Abra `https://DOMINIO/api/debug/env`. Deve retornar 200 com exatamente quatro campos. 404 significa flag desligada ou codigo/deployment incorreto; sozinho nao distingue os dois.
5. Entre na aplicacao, abra o controle de push e inspecione a resposta existente de `/api/push/status` na aba Network. A rota continua exigindo Bearer. Nao compartilhe cabecalhos de autenticacao.
6. Copie somente o JSON de diagnostico e o `X-Request-Id`. Confirme `diagnostics.version=admin-env-v2`.
7. Em **Logs / Runtime Logs**, filtre `/api/push/status`, intervalo da chamada e `requestId`. Compare `supabase_admin_sdk_start`, `supabase_admin_configuration_failed` e `push_status_completed`.
8. Use a tabela abaixo para a conclusao exata e so depois aplique a correcao correspondente.
9. Ao terminar, defina `PUSH_DIAGNOSTICS_ENABLED=false` e faca novo deployment. Confirme `/api/debug/env` 404 e ausencia dos campos detalhados no status; remova o endpoint temporario na limpeza final.

| Evidencia capturada no mesmo request | Conclusao / acao |
| --- | --- |
| `reason=missing_credentials`, `present=false` na fonte necessaria e nenhuma alternativa utilizavel | **A**: ausente no processo observado; conferir escopo/projeto/deployment |
| `reason=missing_credentials`, `empty=true` ou `whitespaceOnly=true` e nenhuma alternativa utilizavel | **B**: vazia/espacos; corrigir valor e redeploy |
| `reason=invalid_url`, `urlValid=false` | **C**: URL selecionada invalida; corrigir a fonte indicada por `urlSource` |
| Revisao da Vercel nao contem instrumentacao ou resposta/log ainda usa formato anterior | **D**: deployment/revisao antiga confirmado por comparacao de revisoes |
| `reason=initialization_failed`, `sdkException=native_websocket_missing`, `runtime.websocketType=undefined` | **E causando F**: falta WebSocket nativo no runtime; configurar Node 22+ suportado na Vercel, verificar disponibilidade e redeploy |
| `sdkException=edge_websocket_unsupported` | **E causando F**: runtime sem suporte necessario; investigar diferenca do deployment, pois codigo local nao seleciona Edge |
| `reason=initialization_failed`, `sdkException=unclassified_sdk_exception` | **F** comprovado, causa interna ainda nao identificada; nao atribuir a credenciais sem evidencia |
| `supabase_admin_initialized`, seguido de `step=auth_get_user` | `createAdminClient()` nao e mais o ponto de falha; investigar resultado Auth, nao inicializacao |

O JSON/log da Vercel ainda nao foi coletado por este ambiente. Portanto **a causa exata de producao permanece pendente dessa coleta**, apesar da reproducao concreta de uma falha compativel.

### Buscas exatas (PowerShell)

```powershell
rg -n 'SUPABASE_SERVICE_ROLE_KEY' app lib tests .env.example next.config.ts proxy.ts
rg -n 'SUPABASE_SECRET_KEY' app lib tests .env.example next.config.ts proxy.ts
rg -n 'createAdminClient' app lib tests
rg -n 'process\.env' app lib tests proxy.ts next.config.ts capacitor.config.ts
rg -n 'Object\.assign\(process\.env|delete process\.env|process\.env\[[^]]+\]\s*=|process\.env\.[A-Za-z0-9_]+\s*=(?!=)' app lib tests
Get-ChildItem -Path . -File -Name *middleware*,*instrumentation*,*proxy*,*next.config*
```

Validacao desta rodada: 42 testes direcionados passaram, incluindo o SDK real e ausencia de segredos nos diagnosticos; build, type-check e lint direcionado passaram. HTTP real do build confirmou os quatro campos exatos em debug/env e 503 com `step=admin_initialization`, `reason=missing_credentials`, `whitespaceOnly=true` e identificadores correlacionados ao simular credenciais compostas de espacos. A falha local durou 2 ms e nao chamou o SDK. Os servidores temporarios foram encerrados. Nenhuma variavel remota foi modificada.

## Conclusao e limite da investigacao

Ha dois problemas distintos:

1. **503 observado:** no codigo anterior, o unico retorno explicito de 503 desta rota era o `catch` de `createAdminClient()`. Esse bloco executava antes da autenticacao, consultas e verificacao VAPID. Logo, se a resposta recebida era o JSON desse bloco e o deployment executava esse codigo, o cliente administrativo falhou localmente.
2. **Push incompleto:** a lista de variaveis fornecida contem apenas `VAPID_PUBLIC_KEY`, nome que nenhum consumidor de push utiliza. Faltam a chave publica do navegador, a privada correspondente, o subject e o segredo do webhook. Isso produziria **200 com `configured: false`** nesta rota depois de inicializar o admin, nao o 503 original.

A presenca de um nome no painel nao comprova valor nao vazio, escopo Production ou disponibilidade no deployment ativo. Nao houve acesso ao painel, aos valores ou aos logs remotos nesta investigacao. A causa exata entre as falhas locais so pode ser confirmada pelo novo log de inicializacao. Nenhuma credencial real foi inspecionada ou alterada.

### Hipoteses ordenadas

| Ordem | Hipotese | Probabilidade relativa | Como confirmar |
| --- | --- | --- | --- |
| 1 | `SUPABASE_SERVICE_ROLE_KEY` ausente/vazia no deployment ativo: escopo incorreto, alteracao sem redeploy, projeto Vercel diferente ou override de ambiente | Alta | `supabase_admin_configuration_failed`, `code=missing_credentials`, estados `present`/`nonEmpty` |
| 2 | `NEXT_PUBLIC_SUPABASE_URL` ausente/invalida no artefato implantado, espacos ou valor copiado incorretamente | Media | Mesmo evento, `missing_credentials` ou `invalid_url`; revisar build e URL do projeto |
| 3 | Excecao sincrona do SDK durante `createClient`, mascarada pelo `catch` anterior como credencial ausente | Menor | `code=initialization_failed`; reproducao local com as mesmas versoes e configuracao, sem imprimir valores |
| 4 | Deployment executa outra revisao, ou o 503 e da plataforma/protecao, nao deste handler | Condicional | Comparar revisao/alias, corpo da resposta e logs da funcao; ausencia dos eventos novos |
| 5 | VAPID ausente causa diretamente este 503 em status | Nao explica o caminho original | VAPID so era verificado depois das consultas; pode causar 503 em dispatch |
| 6 | Rede, banco, RLS ou service-role revogada/incorreta no Supabase | Muito baixa para este caminho sem chamadas externas | Exigiria alcancar Auth/REST; normalmente gera rejeicao de autenticacao ou erro de consulta |

Nao sao porcentagens estatisticas: o ranking depende do codigo e do log fornecidos.

### Por que 10 ms importa

Ler `process.env`, validar uma URL e construir o SDK sao operacoes locais. Uma excecao nesse ponto pode encerrar em poucos milissegundos. Auth e consultas exigem requests externos. A combinacao **10 ms + nenhuma chamada externa + retorno antecipado conhecido** favorece fortemente falha de inicializacao, nao timeout do Supabase. Tempo isolado nao prova a causa; a instrumentacao da plataforma pode ser incompleta e os 251 ms podem incluir overhead fora do handler.

Login usa cliente publico/anon e nao testa a credencial administrativa. Portanto login, banco e navegacao funcionando nao invalidam esta hipotese.

## Inventario completo de `process.env`

"Existe na Vercel" abaixo significa **consta na lista fornecida**, nao valor/escopo verificado. Os aliases de servidor foram adicionados nesta correcao; antes somente os nomes legados eram aceitos pelo admin.

### Codigo da aplicacao

| Variavel | Arquivos consumidores | Obrigatoria ou opcional | Existe na Vercel? | Inconsistencia / observacao |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | [admin](../lib/supabase/admin.ts), [cliente browser](../lib/supabase/client.ts), [cliente request](../lib/supabase/request.ts), [API user](../lib/auth/api-user.ts), [exclusao](../app/api/account/delete/route.ts) | Obrigatoria para app; admin agora aceita alternativa | Sim | Publica, incorporada no build; conferir URL valida e projeto correto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | [cliente browser](../lib/supabase/client.ts), [cliente request](../lib/supabase/request.ts), [API user](../lib/auth/api-user.ts), [exclusao](../app/api/account/delete/route.ts) | Obrigatoria para os consumidores atuais | Sim | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` nao substitui automaticamente este nome nesses consumidores |
| `SUPABASE_SERVICE_ROLE_KEY` | [admin](../lib/supabase/admin.ts), [status](../app/api/push/status/route.ts) | Uma credencial admin e obrigatoria | Sim | Existir no painel nao comprova disponibilidade no runtime; nunca usar prefixo publico |
| `SUPABASE_SECRET_KEY` | [admin](../lib/supabase/admin.ts), [status](../app/api/push/status/route.ts) | Alternativa server-only agora aceita | Sim | Antes nao era consumida; service-role nao vazia tem precedencia |
| `SUPABASE_URL` | [admin](../lib/supabase/admin.ts) | Alternativa server-only agora aceita | Sim | Usada somente se URL publica estiver ausente/vazia; mesmo projeto Supabase |
| `NEXT_PUBLIC_APP_URL` | [dispatch](../app/api/push/dispatch/route.ts), [status](../app/api/push/status/route.ts) | Obrigatoria para push completo | Sim | Usar dominio HTTPS de producao acessivel ao navegador e ao webhook |
| `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` | [controle](../app/components/push-notification-control.tsx), [renovacao](../app/components/notification-experience.tsx), [dispatch](../app/api/push/dispatch/route.ts), [status](../app/api/push/status/route.ts) | Obrigatoria para ativar/renovar push no navegador | **Nao** | `VAPID_PUBLIC_KEY` nao e alias; precisa existir antes do build |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | [dispatch](../app/api/push/dispatch/route.ts), [status](../app/api/push/status/route.ts) | Opcional se a publica do browser existir | **Nao** | Se definida, deve coincidir com a publica do navegador |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | [dispatch](../app/api/push/dispatch/route.ts), [status](../app/api/push/status/route.ts) | Obrigatoria para envio | **Nao** | Deve formar par ECDH P-256 com a publica; nunca publica |
| `WEB_PUSH_SUBJECT` | [dispatch](../app/api/push/dispatch/route.ts), [status](../app/api/push/status/route.ts) | Obrigatoria para envio | **Nao** | Usar `mailto:` de contato real ou URL HTTPS valida |
| `PUSH_WEBHOOK_SECRET` | [dispatch](../app/api/push/dispatch/route.ts), [receipt](../app/api/push/receipt/route.ts), [status](../app/api/push/status/route.ts) | Obrigatoria para webhook e recibos | **Nao** | Mesmo valor no header configurado no Database Webhook; tambem assina recibos HMAC |
| `GEOCODING_ENDPOINT` | [geocode](../app/api/geocode/route.ts) | Obrigatoria apenas para geocodificacao externa | Nao | Independente do push; nao alterada nesta entrega |
| `GEOCODING_API_KEY` | [geocode](../app/api/geocode/route.ts) | Opcional no codigo; depende do provedor | Nao | Independente do push |
| `NODE_ENV` | [instalacao PWA](../app/components/pwa-install-prompt.tsx) | Gerenciada pelo framework | Automatica | Producao registra Service Worker; nao cadastrar manualmente |

### Testes e acessos dinamicos

| Variavel | Arquivo | Obrigatoriedade | Existe na lista? | Observacao |
| --- | --- | --- | --- | --- |
| `EXTRACHEF_TEST_URL` | [auth HTTP](../tests/auth-http.test.mjs) | Opcional | Nao | Habilita testes HTTP contra um ambiente escolhido; nao e requisito de producao |
| `PGLITE_MODULE` | [geolocation SQL](../tests/geolocation-sql.test.mjs), [work locations SQL](../tests/work-locations-sql.test.mjs) | Opcional | Nao | Habilita testes SQL isolados; nao e requisito de producao |
| `GEOCODING_ENDPOINT`, `GEOCODING_API_KEY` | [geolocation](../tests/geolocation.test.mjs) | Fixtures | Nao | Teste altera/restaura ambiente, nao configura Vercel |
| `PUSH_WEBHOOK_SECRET`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, `NEXT_PUBLIC_APP_URL` | [communication](../tests/communication.test.mjs) | Fixtures | Parcial | `Object.assign(process.env, environment)` e `process.env[key]` restauram somente estas chaves |

O novo [teste de status](../tests/push-status.test.mjs) injeta um ambiente isolado em VM; nao modifica `process.env` real. Os demais testes de componentes importam o factory do browser, nao definem novos consumidores de variaveis. A busca inclui codigo versionado e arquivos novos de codigo, nao segredos `.env`, dependencias, bundles ou caches gerados.

### Variaveis listadas na Vercel sem consumidor direto na aplicacao

`SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` e `VAPID_PUBLIC_KEY`.

Podem ter origem na integracao e uso por ferramentas externas. Nao precisam ser removidas; nao corrigem nomes esperados pelo codigo. Nao ha uso de Prisma/Postgres direto no caminho de push.

## Factories, imports e fluxo investigado

- Existe **uma** implementacao de `createAdminClient`, em [lib/supabase/admin.ts](../lib/supabase/admin.ts). E usada por status, subscriptions, dispatch, receipt e [exclusao de conta](../app/api/account/delete/route.ts).
- O outro factory chamado `createClient`, em [lib/supabase/client.ts](../lib/supabase/client.ts), e **cliente publico do navegador**, nao duplicacao do admin.
- O SDK `createClient` e importado diretamente em admin, [API user](../lib/auth/api-user.ts) e exclusao de conta. [request](../lib/supabase/request.ts) utiliza `createServerClient`; browser utiliza `createBrowserClient`, ambos de `@supabase/ssr`.
- `validateVapidPair` tem uma implementacao em [lib/push-config.ts](../lib/push-config.ts), baseada em `node:crypto` e ECDH `prime256v1`. Status e dispatch a utilizam.
- Alias `@/* -> ./*` esta definido no [tsconfig](../tsconfig.json). Imports/exports resolvem; type-check e build verificam isso. Nao foi encontrada implementacao alternativa escondida.
- [Proxy](../proxy.ts) protege paginas, mas seu matcher nao inclui `/api/push/status`; a autenticacao da API e por Bearer.
- [Service Worker](../public/sw.js) recebe push, avisa janelas ou mostra alerta em background e envia recibo. [push-device](../lib/push-device.ts) gerencia opt-in/reinscricao.
- Migrations relevantes: [subscriptions](../supabase/migrations/20261014055000_profile_summary_push.sql), [deliveries/preferences](../supabase/migrations/20261015000000_notification_delivery_and_preferences.sql), [privacidade/teste push](../supabase/migrations/20261015090000_privacy_account_rights.sql). Nao foram executadas remotamente.

| Rota | Autorizacao | Funcao / falhas relevantes |
| --- | --- | --- |
| [GET status](../app/api/push/status/route.ts) | Bearer do usuario | Diagnostico proprio; admin mal configurado e dependencia Auth indisponivel sao diferenciados |
| [POST/DELETE subscriptions](../app/api/push/subscriptions/route.ts) | Bearer do usuario | Registra/remove dispositivo; usa admin, portanto recebe os novos logs de inicializacao |
| [POST dispatch](../app/api/push/dispatch/route.ts) | Segredo do webhook | Verifica VAPID, recarrega notificacao, preferencias e devices; envia ao provedor e registra resultado |
| [POST receipt](../app/api/push/receipt/route.ts) | HMAC por notificacao/dispositivo | Registra recebimento pelo Service Worker, sem exigir sessao do browser |

## Codigo corrigido e logs

Implementacoes completas prontas para revisao:
- [Cliente administrativo](../lib/supabase/admin.ts).
- [Rota de diagnostico](../app/api/push/status/route.ts).
- [Contrato de ambiente](../.env.example).
- [Testes automatizados](../tests/push-status.test.mjs).

### Comportamento de producao

- Admin valida valores nao vazios e URL HTTP(S), recusa credenciais na URL/query/fragmento e remove espacos nas bordas.
- Precedencia explicita: URL publica, depois URL server-only; service-role, depois secret-key. Nunca faz fallback para anon/publishable. Uma configuracao primaria nao vazia mas invalida nao e ignorada para tentar outra.
- `server-only` e mantido. Sessao persistente e refresh automatico continuam desativados.
- Logs admin distinguem `missing_credentials`, `invalid_url` e `initialization_failed`; mostram fonte selecionada e somente presenca/nao vazio/espacos, nunca valores.
- Status gera `requestId`, devolve `X-Request-Id` e `Cache-Control: no-store` em todos os resultados. Os campos anteriores de sucesso sao preservados.
- Sem Bearer: **401 antes de inicializar admin**. Mudanca intencional: o endpoint nao diagnostica credenciais para chamadas anonimas.
- Configuracao admin invalida: **503**, `code=PUSH_ADMIN_CONFIGURATION_ERROR`. Erro inesperado: **500**, sem fingir que e credencial ausente.
- Rejeicao Auth: **401**. Erro retornado por Auth sem status ou com status >= 500: **503**, `code=AUTH_SERVICE_UNAVAILABLE`. Excecao inesperada de transporte: **500** com etapa registrada.
- Erro em subscriptions: **500**. Falha de historico continua sendo **200** com `deliveryHistoryAvailable: false`, agora tambem registrada em warning.
- Ausencia de VAPID continua sendo **200**, `configured: false`. Novo campo `browserVapidPublicKey` evita indicar configuracao completa quando so o servidor conhece a publica.
- `configured` continua sendo verificacao de presenca e par VAPID, **nao prova entrega**, existencia do webhook, validade remota da credencial ou disponibilidade do provedor. Subject/URL precisam ser validos no dispatch.
- Node.js e o runtime padrao. Nao adicionar `export const runtime` com Cache Components nesta versao; o build recusa esse segment config.

### Eventos para filtrar nos Runtime Logs da Vercel

```text
push_status_started
supabase_admin_configuration_failed
supabase_admin_initialized
push_status_admin_unavailable
push_status_auth_failed
push_status_subscriptions_failed
push_status_notifications_failed
push_status_deliveries_failed
push_status_configuration_checked
push_status_unexpected_failure
push_status_completed
```

Exemplo ilustrativo, sem dados reais:

```json
{
  "event": "supabase_admin_configuration_failed",
  "requestId": "<gerado pelo servidor>",
  "code": "missing_credentials",
  "keySource": null,
  "environment": {
    "SUPABASE_SERVICE_ROLE_KEY": {"present": true, "nonEmpty": false, "padded": false}
  }
}
```

O logger usa o nome do evento como primeiro argumento e o objeto como segundo; o exemplo e uma representacao desses campos, nao um dump real. `push_status_completed` inclui HTTP, etapa final, duracao total e tempos por etapa. Correlacione pelo `requestId`, nao por tokens/IDs pessoais. Erros do Supabase registram apenas codigo limitado, nunca mensagem, SQL, stack, cabecalhos ou corpo. O SDK nao e chamado durante falha de configuracao local.

## Passos exatos na Vercel e no Supabase

1. Abra o projeto ExtraChef correto na Vercel, **Settings > Environment Variables**. Confira time/projeto, dominio e deployment que recebeu o 503.
2. Confira valores nao vazios e escopo **Production** de `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. Alternativamente, o novo admin aceita `SUPABASE_SECRET_KEY`; a chave precisa ser realmente server-side do mesmo projeto, nao anon/publishable. Nao renomeie uma chave publica para fingir privilegio administrativo.
3. Configure `NEXT_PUBLIC_APP_URL` com o dominio HTTPS canonico.
4. Recupere o **par VAPID existente**, se houver. Copie a publica atualmente chamada `VAPID_PUBLIC_KEY` para **`NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`**, desde que voce possua a privada correspondente. So criar `WEB_PUSH_VAPID_PUBLIC_KEY` nao basta para o browser. Opcionalmente configure tambem esse nome server-side com a mesma publica.
5. Cadastre `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` e `PUSH_WEBHOOK_SECRET`. Nao existe como derivar a privada a partir da publica.
6. Se nunca houve par utilizavel, gere uma unica vez com o pacote ja instalado: `npx --no-install web-push generate-vapid-keys`. Execute em terminal privado, sem enviar a saida para chat/log compartilhado. Guarde a privada em gerenciador de segredos.
7. Para criar um segredo de webhook, execute em terminal privado: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Salve o mesmo valor na Vercel e no Database Webhook. Nao gere novo segredo a cada deploy.
8. Em Supabase **Database Webhooks**, configure `public.notifications`, evento **INSERT**, metodo **POST**, URL `https://DOMINIO/api/push/dispatch`, headers `Content-Type: application/json` e `x-extra-chef-webhook-secret: <mesmo segredo>`. Nao adicionar um segundo webhook duplicado.
9. Confirme migrations/tabelas/RPCs com [push_pipeline.sql](../supabase/diagnostics/push_pipeline.sql) em ambiente autorizado. Nao reexecute migrations antigas cegamente. Verifique protecao do deployment para que Supabase e Service Worker consigam acessar dispatch/receipt.
10. Publique esta correcao e faca **novo build/redeploy de Production**. Se usar Redeploy para recarregar `NEXT_PUBLIC_*`, desmarque o reaproveitamento do Build Cache. Mudar variavel no painel nao modifica deployments existentes; publica do browser fica incorporada no build.
11. Confirme deployment novo **Ready**, alias/dominio apontando para ele e revise Runtime Logs. Nunca publique service-role, secret-key, privada VAPID ou webhook secret em `NEXT_PUBLIC_*`.
12. Se VAPID mudou, desative/reative notificacoes em cada dispositivo, confirmando reinscricao com a nova publica. Evite rotacao desnecessaria: subscriptions existentes dependem do par antigo.

Configuracao minima para push, alem das variaveis publicas Supabase ja usadas:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=<credencial administrativa privada>
NEXT_PUBLIC_APP_URL=https://DOMINIO
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=<publica do par>
WEB_PUSH_VAPID_PRIVATE_KEY=<privada do mesmo par>
WEB_PUSH_SUBJECT=mailto:CONTATO_REAL
PUSH_WEBHOOK_SECRET=<segredo forte compartilhado com webhook>
```

`SUPABASE_SECRET_KEY` e alternativa ao service-role com esta correcao. `WEB_PUSH_VAPID_PUBLIC_KEY` e opcional, mas, se definida, deve ser identica a publica do browser. Nao adicione fallback para `VAPID_PUBLIC_KEY`: isso esconderia a ausencia da variavel compilada no cliente.

## Checklist de validacao

- [ ] Requisicao sem Bearer retorna 401, JSON e `no-store`.
- [ ] Sessao valida: status retorna 200, `configured: true`, `browserVapidPublicKey: true` e `vapidKeysMatch: true`.
- [ ] Correlacao `requestId` no JSON/header e nos logs, sem tokens ou valores de configuracao.
- [ ] `registeredDevices` > 0 para a conta destinataria; zero nao e erro de configuracao, mas nao ha para quem enviar.
- [ ] Ativar no Perfil retorna POST subscriptions 201.
- [ ] `deliveryHistoryAvailable: true`; se false, corrigir tabela/grant/consulta conforme warning.
- [ ] Botao de teste cria notificacao; webhook atinge dispatch sem 401/503.
- [ ] Provedor aceita e registra `sent`; Service Worker registra `received`. Nenhum destes estados prova leitura humana.
- [ ] App minimizado mostra alerta; app aberto segue supressao de alerta duplicado e UI foreground.
- [ ] Testar logout/troca de conta, preferencias desativadas, 404/410, Android/desktop e PWA instalada no iOS.
- [ ] Nao considerar apenas `configured: true` como teste fim a fim.

Para consultar sem copiar token para comandos, execute no DevTools da propria aplicacao, onde ja existe acesso ao cliente Supabase:

```javascript
// Use a sessao corrente do cliente da aplicacao; nao imprima o access_token.
const { data } = await supabase.auth.getSession();
const response = await fetch('/api/push/status', {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
console.log(response.status, response.headers.get('x-request-id'), await response.json());
```

O cliente `supabase` nao e global por padrao; use um breakpoint no componente que ja o possui. Alternativamente, inspecione a resposta da chamada existente na aba Network, sem compartilhar os headers.

## Comandos de busca e verificacao (PowerShell)

```powershell
# Somente codigo, incluindo arquivos novos; nao ler .env nem bundles/dependencias.
rg -n 'process\.env' app lib tests proxy.ts next.config.ts capacitor.config.ts
rg -n 'createAdminClient|createClient|createBrowserClient|createServerClient|validateVapidPair' app lib tests
rg -n 'VAPID_PUBLIC_KEY|WEB_PUSH_|PUSH_WEBHOOK_SECRET|SUPABASE_' app lib docs .env.example
Get-ChildItem app\api\push -Recurse -Filter route.ts
git --no-pager grep -n -e 'process.env' -- '*.ts' '*.tsx' '*.js' '*.mjs'

node --test tests\push-status.test.mjs tests\push-privacy.test.mjs tests\communication.test.mjs
npx --no-install eslint lib\supabase\admin.ts app\api\push\status\route.ts tests\push-status.test.mjs
npm run typecheck
npm run build
```

Validacao local: 38 testes de push/comunicacao/privacidade passaram, assim como type-check, lint direcionado e build de producao. Os testes cobrem falha antes de qualquer chamada externa, aliases/precedencia, URL invalida, excecao do SDK, auth, consultas, historico parcial, par VAPID e ausencia de segredos nos logs.

Tambem foi iniciado um servidor temporario com o build de producao, credenciais administrativas deliberadamente indisponiveis e token sintetico: HTTP real sem Bearer retornou 401; com Bearer retornou 503, `PUSH_ADMIN_CONFIGURATION_ERROR`, `no-store` e identificadores iguais no header/JSON/logs. O log mostrou `missing_credentials`, nenhuma inicializacao do SDK e duracao local de 1 ms. O servidor foi encerrado ao final. Nao houve teste HTTP remoto com sessao real nem envio real ao provedor.

O build tambem alertou que a versao instalada de Next.js possui vulnerabilidade conhecida. A atualizacao de seguranca deve ser tratada separadamente, com testes; nao e evidencia de causa deste 503. Nenhuma versao de dependencia foi alterada nesta investigacao.

## Estabilizacao recomendada

Mantenha nomes canonicos documentados, par VAPID persistente, credenciais separadas por ambiente e validacao de deployment antes de promover Production. Monitore separadamente configuracao, subscriptions, execucao do webhook, aceitacao pelo provedor e recibos. O dispatcher ja remove 404/410 e evita reenvio sequencial de entregas conhecidas.

Como evolucao, avalie outbox/fila persistente com retry limitado/backoff para 429/5xx e claim atomico por notificacao/dispositivo antes do envio: a verificacao atual de entregas anteriores nao garante exclusao mutua em webhooks concorrentes. Nao acrescente retries cegos, regeneracao automatica de chaves ou fallback para credencial publica. A garantia fim a fim depende tambem do navegador/SO, permissao, Service Worker e conectividade.
