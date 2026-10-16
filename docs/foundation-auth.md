# Fundacao ExtraChef: auditoria, autenticacao e roadmap

## Escopo e limites

Esta etapa implementa o primeiro recorte aprovado: autenticacao, autorizacao de navegacao,
redirects, cadastro com confirmacao, sessao expirada, logout e protecao do status de verificacao.
Nao implementa reservas, escalas, disponibilidade, IA, pagamentos ou integracoes externas.
As demais fases abaixo sao roadmap, nao funcionalidades entregues.

Evidencia: leitura do codigo e migrations locais, testes automatizados, build e navegador local.
Nao foi consultado nem alterado o Supabase de producao, a Vercel ou dispositivos fisicos.
Uma migration versionada nao comprova que as mesmas policies estao implantadas.
Esta revisao nao e uma certificacao de seguranca de toda a aplicacao.

## Diagnostico antes das alteracoes

| Area | Existente | Lacuna confirmada / decisao |
| --- | --- | --- |
| Auth | Supabase Auth e cliente SSR no navegador | Nao havia proxy central de rotas |
| Login | Senha e consulta de papel em `users` | Destino fixo; erro/ausencia de papel caia no dashboard worker |
| Cadastro | Auth seguido de insert client-side em `users` | Tentava inserir mesmo sem sessao quando a confirmacao de e-mail estava ativa |
| Rotas | Verificacoes client-side em varias telas | Paginas podiam abrir sem login e apenas exibir avisos locais |
| Sessao | Refresh automatico do cliente Supabase | Sem guarda global para expiracao, historico e troca de conta |
| Logout | `signOut` em `/profile` | Erro ignorado, sem limpeza de Push e sem acesso nos perfis usados pela navegacao mobile |
| Autorizacao de dados | RLS, grants e RPCs de participantes/proprietarios | Preservar; proxy nao substitui autorizacao no banco |
| Storage | `worker-private` privado, `restaurant-assets` publico; policies por pasta do dono | Policies existem na migration de perfis; validar configuracao implantada |
| Verificacao | `users.verified` e `worker_profiles.verification_status` | Worker podia escrever `verified` no proprio status |
| Push/PWA | SW, subscriptions, dispatcher, recibos e offline publico | Entrega real Android/iPhone e webhook nao comprovados por testes locais |
| Eventos | CRUD com RLS de restaurante | Reutilizado sem criar outro modulo |
| Auditoria/erros | Logs pontuais e historico de entrega Push | Sem trilha global `audit_logs` ou `system_errors` nas migrations locais |
| Saude | `/api/push/status` autenticado | Nao equivale a health check completo dos servicos |
| Sessoes por dispositivo | Auth gerenciado pelo Supabase | Sem listagem/revogacao individual na aplicacao |
| Perfil | Formularios existentes e documentos validados | Sem progresso/onboarding ou requisito global de completude |
| Flags/favoritos/admin | Sem fundacao especifica nas migrations locais | Adiar para etapas seguintes; nao duplicar perfis ou papeis |

### Achado de seguranca

Worker podia alterar `verification_status` por REST: grant de INSERT/UPDATE na tabela inteira
e policies que apenas exigiam propriedade e papel. O indicador "Verificada" era mostrado no perfil.
Severidade MEDIA, confianca 10/10, confirmada por analise estatica. Nao foi executado um ataque remoto.

Correcao: migration aditiva remove os grants amplos de escrita em `worker_profiles` e concede
somente colunas editaveis. O campo de verificacao permanece legivel, mas nao gravavel pelo cliente.
O editor seleciona explicitamente os campos do formulario para nao reenviar status/metadados no upsert.
As policies existentes continuam exigindo propriedade e papel.

**Dados antigos:** a correcao nao legitima verificacoes previamente gravadas. Revisar os registros
marcados `verified` antes da migration; nao usar esse historico como prova de verificacao humana.
Nenhum status existente foi alterado automaticamente.

## Arquitetura entregue

```text
rota protegida / toque no Push
  -> proxy.ts
     -> Supabase getUser (nao confiar apenas no cookie)
     -> papel em public.users (nao confiar em metadata do navegador)
     -> sem sessao: login?redirect=...
     -> papel oposto: dashboard proprio?reason=role_forbidden
     -> sessao valida: renovar cookies e liberar navegacao sem cache compartilhado
  -> SessionGuard
     -> verificar antes de montar a tela protegida
     -> observar SIGNED_OUT / SIGNED_IN / TOKEN_REFRESHED
     -> revalidar ao voltar ao app, pelo historico e a cada 60 segundos
  -> componentes/RPCs existentes
     -> RLS e grants continuam sendo a barreira de autorizacao dos dados
```

Login/cadastro usam a mesma funcao `sanitizeRedirect`. Apenas namespaces protegidos internos
sao aceitos; destinos externos, protocolos, barras ambiguas, caracteres de controle, caminhos
codificados e paginas de autenticacao sao rejeitados. Uma rota de papel oposto vai ao dashboard
correto com mensagem amigavel. Query e fragmento validos sao preservados quando disponiveis.

O cadastro salva os dados iniciais em metadata do Supabase Auth. Somente depois de existir
sessao autenticada a RPC `ensure_account_profile()` cria o registro ausente em `users`.
A RPC usa `auth.uid()`, busca o e-mail em `auth.users`, aceita apenas worker/restaurant,
define score/verified no servidor e nunca altera um perfil existente.
Metadata e usada somente para esse cadastro inicial, nunca para autorizar um usuario existente.

Com confirmacao ativa: mostrar orientacao de e-mail, trocar o codigo PKCE em `/auth/callback`,
provisionar perfil e voltar ao destino autorizado. Sem confirmacao: provisionar e voltar imediatamente.
O fluxo PKCE precisa abrir o link no navegador que iniciou o cadastro.
Contas antigas orfas sem metadata valida precisam de correcao assistida; nao recebem papel inventado.

Logout do dispositivo: cancelar subscription local, tentar excluir seu endpoint usando RLS,
limpar chaves `extrachef:` e caches `extrachef-private-*`, encerrar a sessao local e fazer navegacao
completa ao login. Falha na limpeza do dispositivo gera aviso; falha no signOut impede falso sucesso.
Nao limpar armazenamento de terceiros nem remover o cache offline publico.
A navegacao completa descarta estado em memoria e cache do router; outras abas observam SIGNED_OUT.

**Limites de sessao:** um JWT copiado pode continuar valido ate sua expiracao mesmo apos signOut.
Nao foi implementada revogacao instantanea de todos os access tokens, listagem de dispositivos
ou encerramento seletivo de outras sessoes. Validar duracao/revogacao no Supabase antes de definir SLA.
Falhas de Auth/Database retornam erro explicito, nao acesso liberado nem expiracao ficticia.

### Arquivos principais

- [Proxy central](../proxy.ts)
- [Regras compartilhadas de rotas](../lib/auth/routes.ts)
- [Resolucao/provisionamento de papel](../lib/auth/account.ts)
- [Cliente Supabase por request](../lib/supabase/request.ts)
- [Guarda client-side](../app/components/session-guard.tsx)
- [Callback de confirmacao](../app/auth/callback/route.ts)
- [Logout do dispositivo](../lib/auth/logout.ts)
- [Botao de logout reutilizado](../app/components/logout-button.tsx)
- [Migration aditiva](../supabase/migrations/20261015020000_auth_foundation.sql)
- [Testes de redirects](../tests/auth-routes.test.mjs)
- [Testes de proxy/cookies com dependencias simuladas](../tests/auth-proxy.test.mjs)
- [Testes HTTP locais sem sessao](../tests/auth-http.test.mjs)

Nao foi criado `middleware.ts`: Next.js 16 usa `proxy.ts`.
Nao foram criadas tabelas paralelas de usuarios ou sessoes.
As APIs Push existentes permanecem autenticadas pelo mecanismo proprio; nao redirecionar webhooks ao login.

## Implantacao desta etapa

1. Fazer backup e testar em ambiente de homologacao com o schema-base real.
2. Aplicar migrations anteriores e depois `20261015020000_auth_foundation.sql`.
3. Confirmar que a RPC existe e que os grants abaixo estao corretos.
4. Configurar Auth Site URL e Redirect URLs com as origens aprovadas e `/auth/callback`,
   incluindo Preview explicitamente autorizado. Nao usar dominios arbitrarios.
5. Validar template de confirmacao do Supabase e decidir se confirmacao de e-mail esta ativa.
   Este fluxo suporta o link PKCE padrao que retorna `code` ao callback.
6. Publicar o codigo somente depois da migration: o cadastro novo depende da RPC.
7. Executar os testes autenticados abaixo nos dois papeis antes de promover para producao.
8. Revisar verificacoes historicas. Nao reduzir RLS para contornar falha de perfil/cadastro.

Coordenar a janela de publicacao e recarregar abas/PWAs antigas: o editor anterior selecionava
todas as colunas e podia reenviar `verification_status`. Depois dos grants novos esse payload
antigo sera recusado. Para deploy sem janela, publicar primeiro apenas a projecao explicita
do editor, depois aplicar a migration e por fim publicar o novo fluxo Auth.

SQL de diagnostico, sem alteracao de dados:

```sql
SELECT to_regprocedure('public.ensure_account_profile()') AS account_rpc;
SELECT
  has_table_privilege('authenticated', 'public.worker_profiles', 'INSERT') AS broad_insert,
  has_table_privilege('authenticated', 'public.worker_profiles', 'UPDATE') AS broad_update,
  has_column_privilege('authenticated', 'public.worker_profiles', 'verification_status', 'INSERT') AS can_insert_status,
  has_column_privilege('authenticated', 'public.worker_profiles', 'verification_status', 'UPDATE') AS can_update_status,
  has_column_privilege('authenticated', 'public.worker_profiles', 'phone', 'UPDATE') AS can_update_phone;
-- Esperado: false, false, false, false, true.

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND tablename IN ('users', 'worker_profiles', 'restaurant_profiles', 'events', 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT verification_status, count(*)
FROM public.worker_profiles
GROUP BY verification_status;
```

## Checklist de validacao

### Automatizado local

```powershell
node --test tests\auth-routes.test.mjs tests\auth-proxy.test.mjs
# Com o servidor local ja rodando:
$env:EXTRACHEF_TEST_URL = 'http://localhost:3000'
node --test tests\auth-http.test.mjs
npm run lint
npm run typecheck
npm run build
```

O runner e o Node instalado, sem novas dependencias de teste.
Os testes de proxy usam Supabase simulado; os testes HTTP usam o servidor Next real sem credenciais.
Eles nao comprovam login, refresh ou policies no Supabase remoto.

### Homologacao autenticada / navegadores reais

- [ ] Sem login, cada namespace protegido redireciona a login preservando rota e query.
- [ ] Login worker e restaurante sem redirect levam ao dashboard correto.
- [ ] Login com `/chat/<vaga-autorizada>` volta ao chat; RLS continua recusando vaga alheia.
- [ ] Worker em `/restaurant/events` e restaurante em `/worker/dashboard`: dashboard proprio e aviso.
- [ ] `redirect=https://google.com`, `//malicioso.com`, URL codificada e caminho de login: fallback interno.
- [ ] Link "Cadastre-se" e "Faca login" preservam redirect.
- [ ] Cadastro com confirmacao desligada cria exatamente um perfil e volta ao destino.
- [ ] Cadastro com confirmacao ligada nao tenta gravar sem sessao; e-mail/callback concluem o cadastro.
- [ ] Callback invalido/sem codigo/falha de perfil: aviso explicito sem loop.
- [ ] Novo login da mesma conta nao muda papel, score ou verificacao existentes.
- [ ] Sessao realmente revogada/expirada em app aberto: login com reason=session_expired e destino original.
- [ ] Access token expirado com refresh valido: continuar autenticado; nao simular expiracao so esperando o JWT.
- [ ] Auth/Database fora do ar: erro explicito e tentar novamente, sem autorizar nem criar sessao ficticia.
- [ ] Logout nos perfis mobile e generico funciona; voltar no historico nao libera area protegida.
- [ ] Logout em outra aba e troca de conta nao preservam dados da conta anterior.
- [ ] Subscription antiga nao recebe mensagens do usuario depois do logout; falhas de limpeza sao visiveis.
- [ ] Editar e criar perfil worker via upsert continuam funcionando apos os grants novos.
- [ ] PATCH/INSERT REST com verification_status=verified usando JWT worker sao recusados.
- [ ] Conta A nao consegue editar dados de B por REST, independentemente da interface.
- [ ] Android/iPhone PWA: toque no Push abre chat; sem sessao vai ao login e depois ao chat.
- [ ] Offline: fallback publico funciona, sem servir paginas privadas salvas.
- [ ] Regressao: vagas, candidaturas/aprovacao, chat, check-in/out, avaliacoes, eventos e preferencias.

## Roadmap restante, em ordem de dependencia

| Etapa | Implementacao proposta | Condicao de aceite |
| --- | --- | --- |
| 1 (esta entrega) | Auth, redirects, sessao, logout, grants de verificacao | Homologacao autenticada e migration aprovadas |
| 2 | Auditoria transacional e logs de erros | Cobertura das mutacoes existentes e redacao de PII/segredos |
| 3 | Health/observabilidade | Checks reais com timeouts e estados degraded/unknown; sem falsos positivos |
| 4 | Sessoes por dispositivo | Modelo de revogacao compativel com Supabase e testes de JWT/refresh/replay |
| 5 | Progresso de perfil e onboarding | Definir quais acoes bloquear, validar no banco e permitir completar perfil |
| 6 | Verificacao administrativa preparada | Reutilizar campos atuais; verified_at/by com escrita exclusiva privilegiada |
| 7 | Favoritos e flags | Uma relacao favorita por par; leitura autenticada e mutacao privilegiada das flags |
| 8 | Rate limiting distribuido | Auth configurado no Supabase; limites de chat/eventos/perfil no ponto real de escrita |
| 9 | Fundacao admin | Papel separado nao controlavel pelo usuario; autorizacao server-side e RLS |
| 10 | Gate de producao | Testes reais de dispositivos, concorrencia, restauracao e regressao |

### Decisoes de arquitetura para as etapas futuras

- `audit_logs`: gravacao confiavel por trigger/RPC transacional para mutacoes no banco.
  Login/logout exigem evidencia server-side do fluxo Auth, nao evento de cliente como prova.
  Reter actor/entity/action/metadata minima; nao copiar CPF, documentos, mensagens ou tokens para logs.
  IP so de fonte confiavel da infraestrutura, nunca de header arbitrario enviado pelo cliente.
- `system_errors`: endpoint com validacao, redacao, deduplicacao, limites e retencao; stack nao publico.
  Separar eventos de seguranca de erros tecnicos e de eventos de produto.
- `/api/health`: exposicao publica minima; diagnosticos sensiveis autenticados/administrativos.
  Realtime exige exercicio real de canal, Storage exige operacao real controlada, Push distingue
  configurado/enviado/recebido. Service Worker e permissão so podem ser comprovados no navegador.
- Sessoes: nao manipular tabelas internas `auth.sessions` sem contrato suportado e sem avaliar
  efeito em JWTs ja emitidos. Nao criar uma lista decorativa de dispositivos que nao revoga acesso.
- Completude: reutilizar `worker_profiles`/`restaurant_profiles`. Nao exigir cadastro completo para
  entrar ou editar o proprio perfil. Escolher explicitamente acoes bloqueadas e estrategia para usuarios antigos.
- Flags: negar escrita a clientes comuns; aplicar no backend/banco alem de esconder botoes.
  Flags de modulos ainda nao construidos nao liberam rotas inexistentes.
- Rate limiting: contador em memoria da Function Vercel nao e protecao distribuida.
  Limitador no frontend/proxy nao impede REST direto de chat/eventos/perfis.
- Admin: nao reutilizar role em user_metadata como autoridade; nao colocar service role no navegador.
- Antes de novas tabelas, comparar schema real e migrations. Definir retencao LGPD, acesso aos logs,
  quotas e alertas antes de chamar observabilidade de pronta para producao.
