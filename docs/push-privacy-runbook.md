# ExtraChef: Push, comunicação e privacidade

## Diagnóstico e limites

O fluxo `messages -> notifications` está confirmado pelo relato do operador. O ponto exato da quebra em produção depende dos logs da Vercel, configuração do webhook e subscriptions do destinatário; não pode ser determinado apenas pelo código local.

O repositório já continha central, preferências de categorias, badges independentes, popup de mensagem, resposta rápida e recibo HMAC no Service Worker. Estes componentes foram preservados. A central mantém mensagens no Chat para não duplicar contagens; há acesso visível a Mensagens na central.

Correções desta entrega:
- Falta de subscriptions retorna `reason=no_registered_devices`, sem sucesso fictício.
- VAPID validado por ECDH: chave pública/privada precisam formar par e a chave do cliente deve coincidir.
- Erros do provedor geram log sem endpoint/chaves e HTTP 502; 404/410 removem dispositivos inválidos.
- Resultado HTTP do provedor registrado em `push_deliveries`; recibo não pode ser rebaixado de received para sent.
- Renovação ao retornar ao app somente com opt-in explícito por conta e permissão já concedida. Nunca abre prompt no login.
- Permissão iOS solicitada diretamente no toque do botão, antes de consultar sessão/servidor.
- Diagnóstico autenticado em `/api/push/status` mostra presença de configuração e entregas próprias, nunca segredos.
- Botão de teste no Perfil cria notificação própria por RPC, no máximo uma por minuto; testa o webhook real.

## Arquitetura

```text
messages INSERT -> trigger -> notifications(category, message_id, url)
  |-> Realtime -> provider global -> badges + toast + popup + resposta rápida
  |-> Database Webhook -> /api/push/dispatch -> preferências -> push_subscriptions
       -> provedor VAPID -> Service Worker -> notificação de sistema se background
       -> /api/push/receipt (HMAC) -> push_deliveries(received)
```

`sent`: o provedor aceitou o envio. `received`: Service Worker processou e postou recibo. `messages.read_at`: leitura reconhecida pelo cliente autenticado. Nenhum destes, sozinho, prova leitura humana ou exibição física do alerta.

App visível: mensagem nova fora da conversa ativa mostra toast/popup, sem notificação duplicada do sistema. Na conversa ativa, o chat recebe a mensagem e confirma leitura dos IDs visíveis. App minimizado/fechado: depende do navegador/SO para entregar Push; encerramento forçado, economia de energia ou revogação de permissões podem impedir a entrega. Não é possível garantir comportamento idêntico a um aplicativo nativo em todos os aparelhos.

## Implantação

1. Backup e ambiente de homologação. Conferir migrations aplicadas, sem reexecutar migrations históricas para rollback.
2. Aplicar migrations pendentes em ordem até `20261015080000_job_location_snapshots.sql`.
3. Aplicar integralmente `20261015090000_privacy_account_rights.sql`. A migration não foi executada remotamente nesta entrega.
4. A migration introduz `privacy_preferences`, `legal_acceptances`, RPCs de exportação/exclusão, teste Push, diretório protegido e guardas de conta excluída. `auth` em subscriptions é um alias gerado de `auth_secret`, preservado para compatibilidade com o dispatcher existente.
5. As fotos de restaurante deixam de ser públicas. Atualizar o frontend junto com a migration; links assinados antigos vencem no seu prazo. CPF/RG/selfie/currículo continuam privados.
6. Configurar variáveis abaixo na Vercel e fazer redeploy. Não publicar segredos nem colocá-los em screenshots.
7. No Supabase Database Webhooks: tabela `public.notifications`, INSERT, POST `https://DOMINIO/api/push/dispatch`, header `x-extra-chef-webhook-secret` com o mesmo segredo da Vercel e `Content-Type: application/json`. Não criar webhook em messages nem em push_deliveries.
8. Usar domínio HTTPS público sem proteção de Preview que bloqueie chamadas do Supabase. Configurar URLs de Auth no domínio correto.
9. Ativar Push no Perfil do destinatário, em cada dispositivo; confirmar POST `/api/push/subscriptions` HTTP 201.
10. Minimize o app, envie uma mensagem de outra conta e execute as verificações abaixo.

### Variáveis

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=https://DOMINIO
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:CONTATO_REAL
PUSH_WEBHOOK_SECRET=
```

`WEB_PUSH_VAPID_PUBLIC_KEY` é opcional no servidor; se configurada, precisa ser igual a `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`. As chaves públicas devem pertencer ao mesmo par da privada. Alterar VAPID exige reinscrever dispositivos existentes; não regenerar chaves a cada deploy.

Geração de chaves (execute localmente, guarde a saída fora de logs compartilhados):

```powershell
npx web-push generate-vapid-keys
```

## Localizar a quebra

Execute `supabase/diagnostics/push_pipeline.sql` no SQL Editor. Os SELECTs não alteram registros e evitam endpoints/chaves. PostgreSQL/RLS reais precisam de teste em homologação; verificações de texto SQL não equivalem a executar a migration.

| Evidência | Próxima verificação |
| --- | --- |
| Mensagem existe, notificação não existe | Trigger habilitado, função atual, candidatura e destinatário correto. |
| Notificação existe, devices=0 | Perfil do destinatário, permissão e POST de subscription. |
| Notificação e dispositivo existem, attempts=0 | Webhook, Logs da Vercel e migrations de preferences/deliveries. Supressão por leitura/preferência também não gera envio. |
| 401 no dispatch | Header/segredo ausente ou divergente, ou proteção do deployment. |
| 503 | Variável ausente, par VAPID inválido ou URL mal configurada. |
| 400 | Payload diferente de INSERT de notifications. |
| 500 | RPC/tabela/grant do banco ausente ou erro de consulta/gravação. |
| 502 e delivery failed | Consultar status_code nos logs; 401/403 do provedor costuma indicar VAPID. |
| expired | 404/410: assinatura inválida removida; reinscrever dispositivo. |
| sent sem received | SO, SW antigo, conexão, assinatura criada com outra VAPID; receipt endpoint também pode estar inacessível. |
| received sem alerta | App visível suprime alerta do sistema; verificar popup, Não Perturbe e preferências do SO. |

### Navegador: inspeção sem revelar chaves

No Console do destinatário, no domínio final:

```javascript
const registration = await navigator.serviceWorker.getRegistration('/');
const subscription = await registration?.pushManager.getSubscription();
console.table({
  secure: isSecureContext,
  permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  standalone: matchMedia('(display-mode: standalone)').matches,
  serviceWorker: Boolean(registration?.active),
  deviceSubscription: Boolean(subscription),
});
```

Não imprima `subscription.toJSON()` em relatórios. Teste somente a exibição local:

```javascript
await registration.showNotification('Teste local ExtraChef', {
  body: 'Este teste não usa VAPID, webhook nem banco.',
  icon: '/icons/icon-192.png',
});
```

Isso comprova apenas capacidade de exibição local. O botão “Enviar notificação de teste” do Perfil testa banco/webhook/provedor e gera ID para correlacionar logs. Para receber alerta de sistema, minimize imediatamente o app; com ele aberto, o evento segue o comportamento foreground.

### Android, iPhone e desktop

- Android Chrome: HTTPS, site/PWA autorizado e notificações do navegador permitidas no Android.
- iPhone/iPad: iOS/iPadOS 16.4+, PWA adicionada à Tela de Início, abrir por esse ícone e ativar Push por toque explícito. Aba comum no Safari não equivale à PWA instalada.
- Desktop: navegador compatível, permissão do site e notificações do sistema ativadas.
- Validar duas contas, ida/volta, app aberto, minimizado, fechado, sem rede e após reconexão.
- Rodar cenário de logout/troca de conta: o dispositivo antigo não deve continuar recebendo mensagens da outra conta.
- Expiração pode ser recuperada ao reabrir o app; se o navegador não permitir renovar em background, nenhum refresh token será guardado no SW para contornar isso.

## Privacidade e direitos

- `/settings/privacy`: categorias de avisos, visibilidade, estado de permissões, aceite, JSON e exclusão.
- `/privacy` e `/terms`: documentos-base versionados. Falta completar identificação do controlador, contato, base legal e retenção; revisão jurídica é obrigatória antes do Beta externo.
- `/api/account/export`: Bearer validado, RPC limitada a auth.uid(), JSON no-store; documentos binários permanecem no Storage e o export lista seus caminhos, não cria URLs públicas.
- `/api/account/delete`: EXCLUIR + senha revalidada; bloqueia diárias aprovadas/em andamento, remove arquivos dos dois buckets por pasta do usuário, pseudonimiza histórico e desativa conta Auth sem cascatas destrutivas.
- Exclusão atravessa Storage, SQL e Auth, sem transação distribuída: em falha parcial, informa erro e exige suporte/reconciliação; não promete rollback de arquivos.
- Perfis/arquivos próprios são removidos, nome/e-mail/telefone/cidade são substituídos; UUIDs operacionais permanecem. Isso é pseudonimização, não anonimização irreversível. Conteúdo de vagas, eventos e históricos compartilhados exige revisão de retenção do operador; backups seguem política separada.
- Nenhum dado privado é cacheado pelo SW. GPS/câmera só nos fluxos que precisam deles; arquivos somente pelo seletor escolhido pelo usuário.

## Testes locais

```powershell
node --test tests/*.test.mjs
npm run lint
npm run typecheck
npm run build
```

Os testes de provedores e limites HTTP usam mocks; não provam recebimento em aparelho físico. `tests/privacy-sql.test.mjs` executa a nova migration duas vezes no PGlite (PostgreSQL efêmero), com schema mínimo Supabase, e valida RLS, exportação, aceite, fotos privadas e guardas de conta excluída. Não é uma cópia do schema remoto, portanto não elimina a homologação. Outras integrações PostgreSQL preexistentes exigem `PGLITE_MODULE`; testes HTTP precisam de servidor habilitado pelo harness. Nenhum teste deve apagar contas ou enviar Push reais em produção sem autorização do operador.

```powershell
npm run test:push
npm run test:privacy:sql
```