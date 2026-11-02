# Coleta operacional: Push em producao

Este procedimento publica a instrumentacao e coleta evidencia. Nao altere credenciais, par VAPID, versao do Node ou dependencias antes da primeira coleta.

## 1. Arquivos finais

Publique juntos:

- [app/api/debug/env/route.ts](../app/api/debug/env/route.ts)
- [lib/supabase/admin.ts](../lib/supabase/admin.ts)
- [app/api/push/status/route.ts](../app/api/push/status/route.ts)

Teste de regressao: [tests/push-status.test.mjs](../tests/push-status.test.mjs).
Contrato de ambiente: [.env.example](../.env.example).

### Protecao temporaria

```dotenv
PUSH_DIAGNOSTICS_ENABLED=true
```

Somente a string exata `true` habilita a coleta detalhada.

| Flag | `/api/debug/env` | `/api/push/status` |
| --- | --- | --- |
| Ausente ou diferente de `true` | 404 | Comportamento normal, sem `step`, `reason`, `diagnostics` detalhados |
| `true` | 200 com exatamente quatro metadados; nao exige sessao | Exige Bearer; adiciona `step`, `reason`, `requestId`, `diagnostics` |

O debug fica publicamente acessivel enquanto a flag esta ativa. Ele retorna somente presenca/comprimentos, nunca valores. Habilite por uma janela curta. O status nao valida um token antes de diagnosticar uma falha de inicializacao: a presenca de Bearer nao deve ser tratada como autorizacao administrativa. Por isso, apenas metadados seguros sao incluidos.

Todos os resultados usam `Cache-Control: no-store`. Com coleta ativa:
- Debug 200 e status incluem `X-Push-Diagnostics-Version: admin-env-v2`.
- Status tambem inclui `X-Request-Id`, igual ao `requestId` do JSON.
- Logs nunca imprimem URL, chaves, tokens, endpoint do dispositivo, SQL, stack ou mensagens arbitrarias do SDK.

## 2. Implantar na Vercel

1. Abra o projeto ExtraChef correto e confira qual revisao atende o dominio de producao.
2. Em **Settings > Environment Variables**, crie `PUSH_DIAGNOSTICS_ENABLED` com valor `true`, escopo **Production**. Nao use prefixo `NEXT_PUBLIC_`.
3. Nao mude os valores Supabase/VAPID nesta primeira rodada.
4. Revise e publique os tres arquivos acima pelo fluxo Git conectado ao projeto. Eles devem estar na revisao implantada; Redeploy de uma revisao antiga nao envia arquivos locais.
5. Se desejar criar um commit somente desta entrega, revise antes:

   ```powershell
   git --no-pager diff -- lib\supabase\admin.ts app\api\push\status\route.ts
   git --no-pager status --short
   ```

   Nao use `git add .`: ha outras alteracoes no workspace. Nao inclua arquivos `.env` nem credenciais. O arquivo novo de debug precisa ser incluido explicitamente no seu commit.

6. Dispare o deploy da revisao instrumentada para a branch de Production configurada no projeto.
7. Se precisar usar **Redeploy**, selecione a revisao instrumentada e desmarque o reaproveitamento do Build Cache. Isso tambem recompila os acessos `NEXT_PUBLIC_*`.
8. Aguarde **Ready**. Anote identificador do deployment, revisao/commit e horario. Confirme que o dominio aponta para ele.
9. Se houver Deployment Protection, acesse com a autorizacao normal da Vercel; nao desative a protecao nem compartilhe tokens de bypass.

Validacao local opcional antes de publicar:

```powershell
node --test tests\push-status.test.mjs tests\push-privacy.test.mjs tests\communication.test.mjs
npx --no-install eslint lib\supabase\admin.ts app\api\push\status\route.ts app\api\debug\env\route.ts tests\push-status.test.mjs
npm run typecheck
npm run build
```

## 3. Consultar `/api/debug/env`

Abra no dominio de producao:

```text
https://DOMINIO/api/debug/env
```

Ou execute no PowerShell:

```powershell
curl.exe -i "https://DOMINIO/api/debug/env"
```

Resposta 200 ilustrativa, com os quatro campos exatos:

```json
{
  "hasSupabaseUrl": true,
  "hasServiceRoleKey": true,
  "supabaseUrlLength": 40,
  "serviceRoleLength": 200
}
```

Comprimentos sao ilustrativos, nao requisitos de validade. Ausente e string vazia produzem o mesmo `false`/`0` nesse endpoint; status/logs distinguem os dois. Uma string de espacos produz `true` e comprimento maior que zero.

Este endpoint inspeciona os nomes legados pedidos. Nao mostra `SUPABASE_SECRET_KEY` e nao inicializa o admin. Pode mostrar service-role ausente e o admin funcionar usando secret-key: confira `diagnostics.keySource` no status.

## 4. Consultar `/api/push/status` sem copiar tokens

1. Entre na aplicacao no mesmo dominio.
2. Abra DevTools > **Network** e ative **Preserve log**.
3. Abra o controle de notificacoes push no Perfil; ele ja consulta `/api/push/status` com a sessao corrente.
4. Selecione a requisicao GET. Na aba **Response**, copie o JSON; em **Headers**, copie somente HTTP, `X-Request-Id`, `X-Push-Diagnostics-Version` e `Cache-Control`.
5. Se necessario, recarregue a pagina do Perfil para disparar nova consulta.
6. Anote o horario exato e o dominio.

Nao abra a rota apenas pela barra de enderecos para testar autenticado: ela exige Bearer, nao apenas cookies de login. Sem Bearer, o resultado esperado e 401.

Nao use **Copy as cURL**, exportacao HAR ou copia completa de Request Headers: esses formatos podem carregar o token da sessao.

Para nova consulta pelo codigo, use apenas em um breakpoint onde o cliente `supabase` do componente esteja disponivel:

```javascript
const { data } = await supabase.auth.getSession();
if (!data.session) throw new Error('Sessao ausente: entre novamente.');
const response = await fetch('/api/push/status', {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
console.log({
  status: response.status,
  requestId: response.headers.get('x-request-id'),
  version: response.headers.get('x-push-diagnostics-version'),
  body: await response.json(),
});
```

`supabase` nao e global por padrao. Prefira a chamada existente em Network. Nao imprima `data.session`.

## 5. JSONs por cenario

Os exemplos de status abaixo sao **recortes validos do JSON**, limitados aos campos que devem ser comparados. A resposta real preserva tambem `error`, `code`, `configured`, tempos e demais metadados. IDs, versoes de Node, tempos e comprimentos sao ilustrativos.

### A. Variavel ausente no processo

Exemplo sem service-role nem alternativa utilizavel: HTTP 503.

```json
{
  "step": "admin_initialization",
  "reason": "missing_credentials",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "diagnostics": {
    "version": "admin-env-v2",
    "keySource": null,
    "environment": {
      "SUPABASE_SERVICE_ROLE_KEY": {
        "present": false,
        "type": "undefined",
        "length": 0,
        "empty": false,
        "whitespaceOnly": false,
        "nonEmpty": false,
        "padded": false
      }
    }
  }
}
```

### B. Variavel vazia

Exemplo com service-role vazia e sem alternativa utilizavel: HTTP 503.

```json
{
  "step": "admin_initialization",
  "reason": "missing_credentials",
  "requestId": "22222222-2222-4222-8222-222222222222",
  "diagnostics": {
    "version": "admin-env-v2",
    "keySource": null,
    "environment": {
      "SUPABASE_SERVICE_ROLE_KEY": {
        "present": true,
        "type": "string",
        "length": 0,
        "empty": true,
        "whitespaceOnly": false,
        "nonEmpty": false,
        "padded": false
      }
    }
  }
}
```

Somente espacos: `length > 0`, `empty=false`, `whitespaceOnly=true`, `nonEmpty=false`, `padded=true`. Se houver secret-key utilizavel, o admin seleciona essa alternativa em vez de retornar este erro.

### C. Variavel invalida: URL

Exemplo com URL selecionada invalida e chave nao vazia: HTTP 503.

```json
{
  "step": "admin_initialization",
  "reason": "invalid_url",
  "requestId": "33333333-3333-4333-8333-333333333333",
  "diagnostics": {
    "version": "admin-env-v2",
    "urlSource": "NEXT_PUBLIC_SUPABASE_URL",
    "urlValid": false,
    "urlLength": 9,
    "sdkException": null
  }
}
```

Uma chave nao vazia mas revogada/incorreta nao tem um JSON local garantido de "chave invalida". Copie a resposta real e a etapa: se passou a `auth_get_user` ou consultas, nao foi a validacao local de URL.

### D. Deployment antigo

Nao existe um JSON confiavel `reason=deployment_old`: codigo antigo nao sabe que foi substituido. Se o deployment ainda executa a rota original, pode retornar:

```json
{
  "error": "Push status is unavailable because server credentials are not configured.",
  "configured": false
}
```

Ou uma instrumentacao intermediaria pode retornar:

```json
{
  "error": "Push status is unavailable because server credentials are missing or invalid.",
  "code": "PUSH_ADMIN_CONFIGURATION_ERROR",
  "configured": false,
  "requestId": "44444444-4444-4444-8444-444444444444"
}
```

Ausencia de `diagnostics.version` ou do header de versao nao comprova deployment antigo sozinha: a flag desligada tambem remove os detalhes. Confirme **flag Production + revisao/commit + alias do dominio** no painel. O debug 404 tambem pode significar flag desligada.

### E. Excecao do SDK sem categoria conhecida

HTTP 503:

```json
{
  "step": "admin_initialization",
  "reason": "initialization_failed",
  "requestId": "55555555-5555-4555-8555-555555555555",
  "diagnostics": {
    "version": "admin-env-v2",
    "urlValid": true,
    "keySource": "SUPABASE_SERVICE_ROLE_KEY",
    "sdkException": "unclassified_sdk_exception"
  }
}
```

Esse resultado comprova a etapa, mas nao identifica a causa interna. Nao substitua a categoria por uma conclusao inventada. Preserve os metadados e o requestId para uma segunda coleta direcionada; nao publique mensagem/stack bruta.

### F. Excecao do SDK por falta de WebSocket

HTTP 503, caso a excecao conhecida aconteca de fato:

```json
{
  "step": "admin_initialization",
  "reason": "initialization_failed",
  "requestId": "66666666-6666-4666-8666-666666666666",
  "diagnostics": {
    "version": "admin-env-v2",
    "urlValid": true,
    "sdkException": "native_websocket_missing",
    "runtime": {
      "nodeVersion": "v20.0.0",
      "websocketType": "undefined",
      "fetchType": "function"
    }
  }
}
```

Outra categoria reconhecida: `edge_websocket_unsupported`. Copie a categoria observada; nao simule esse cenario alterando o runtime de producao.

### Controle: inicializacao passou

Se aparecer `supabase_admin_initialized`, a criacao do cliente passou. Uma indisponibilidade posterior de Auth pode retornar:

```json
{
  "step": "auth_get_user",
  "reason": "AUTH_SERVICE_UNAVAILABLE",
  "requestId": "77777777-7777-4777-8777-777777777777",
  "diagnostics": {
    "version": "admin-env-v2",
    "urlValid": true,
    "sdkException": null,
    "keySource": "SUPABASE_SERVICE_ROLE_KEY"
  }
}
```

## 6. Checklist: o que copiar dos logs

Em Vercel **Logs / Runtime Logs**, selecione Production, o intervalo correto e a rota `/api/push/status`. Correlacione todos os eventos pelo mesmo `requestId`.

- [ ] Horario e fuso da chamada.
- [ ] Deployment, revisao/commit e dominio utilizado.
- [ ] HTTP da resposta.
- [ ] `X-Request-Id` e `X-Push-Diagnostics-Version`.
- [ ] `step`, `reason` e `diagnostics.version`.
- [ ] JSON dos quatro campos de `/api/debug/env`.
- [ ] Evento `push_status_started`.
- [ ] Evento `supabase_admin_configuration_failed`, se existir: `code`, `sdkException`, `urlSource`, `keySource`, `environment`, `runtime`, `durationMs`.
- [ ] Evento `supabase_admin_sdk_start`, se existir.
- [ ] Presenca ou ausencia de `supabase_admin_initialized`.
- [ ] Evento `push_status_admin_unavailable`, se existir.
- [ ] Evento `push_status_unexpected_failure`, se existir.
- [ ] Evento `push_status_auth_failed` ou erro da etapa seguinte, se houver.
- [ ] Evento `push_status_completed`: HTTP, etapa final, duracao e tempos por etapa.
- [ ] `runtimePublicUrl` e `buildAndRuntimeUrlMatch`.
- [ ] Confirmacao de chamadas externas observadas pela Vercel.

Copie apenas esses eventos/objetos da instrumentacao. Nao copie cookies, Authorization, service-role, secret-key, chave privada VAPID, segredo do webhook, HAR ou variaveis completas do painel. Se copiar a resposta de sucesso, remova o historico `deliveries` antes de compartilhar.

Modelo de entrega da coleta:

```text
Horario/fuso:
Deployment/revisao:
Dominio:
HTTP:
X-Request-Id:
X-Push-Diagnostics-Version:
JSON debug/env:
JSON status (sem deliveries):
Eventos correlacionados:
Chamadas externas observadas:
```

## 7. Encerrar a coleta

1. Salve a evidencia segura.
2. Defina `PUSH_DIAGNOSTICS_ENABLED=false` em Production.
3. Publique novo deployment com a flag desligada.
4. Confirme debug 404 e status sem detalhes/header de versao.
5. Remova a rota temporaria de debug e os detalhes adicionais quando a causa estiver encerrada; preserve apenas o logging operacional necessario.

Esta entrega prepara a coleta; nao publica nem altera configuracoes remotas automaticamente.

## Validacao da entrega

- 43 testes direcionados passaram.
- Lint direcionado passou.
- Build de producao, incluindo TypeScript, passou.
- O build alertou sobre vulnerabilidade conhecida na versao instalada de Next.js. Trate a atualizacao de seguranca separadamente; nao altere dependencias durante a primeira coleta.
