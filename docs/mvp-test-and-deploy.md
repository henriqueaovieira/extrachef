# ExtraChef MVP: testes e deploy

## Checklist de testes

### Restaurante

- [ ] Criar uma vaga com dados válidos; confirmar status `open`.
- [ ] Ver candidaturas da vaga e confirmar que os registros correspondem à diária.
- [ ] Aprovar uma candidatura; confirmar status `approved` e vaga `filled`.
- [ ] Tentar aprovar outra candidatura na mesma vaga; confirmar que a operação é recusada.
- [ ] Abrir o chat e enviar uma mensagem; confirmar recebimento em tempo real na sessão do trabalhador.
- [ ] Receber notificações de aprovação, mensagem, check-in, check-out e avaliação.
- [ ] Após o checkout, avaliar o trabalhador; confirmar que a nota aparece e que não é possível duplicá-la.
- [ ] Conferir total de vagas, estados, profissionais contratados e média das avaliações no dashboard.

### Trabalhador

- [ ] Candidatar-se a uma vaga aberta; confirmar status `pending`.
- [ ] Confirmar que vaga preenchida não aparece como aberta e que candidatura direta é recusada.
- [ ] Receber a aprovação e trocar mensagens no chat em duas sessões.
- [ ] Abrir check-in antes da aprovação; confirmar acesso negado.
- [ ] Fazer check-in; confirmar registro único, status `in_progress` e notificação ao restaurante.
- [ ] Tentar repetir check-in; confirmar que não cria novo registro.
- [ ] Fazer check-out; confirmar status `completed` em candidatura e vaga, com notificação ao restaurante.
- [ ] Tentar repetir check-out; confirmar que não cria novo registro.
- [ ] Avaliar o restaurante; confirmar atualização do score e bloqueio de duplicidade.
- [ ] Conferir candidaturas, diárias concluídas, média, score e histórico no dashboard.
- [ ] Completar/editar perfil com CPF, RG, foto, selfie, certificados e currículo; confirmar validação e upload privado.
- [ ] Recusar GPS e confirmar que check-in é bloqueado; testar coordenadas dentro e fora do raio de 300 m.
- [ ] Compartilhar uma vaga pelo menu nativo; testar também o fallback de cópia.
- [ ] Ativar Push no Perfil e confirmar recebimento/clique após aprovação, mensagem e avaliação.

### Perfil do restaurante

- [ ] Completar/editar perfil com CNPJ, endereço, logo e fotos; confirmar rejeição de CNPJ inválido.
- [ ] Capturar foto pela câmera traseira e testar substituição dos arquivos.
- [ ] Criar vaga com localização e validar check-in/out no endereço cadastrado.

### Segurança e interface

- [ ] Abrir chat, check-in, check-out e avaliação sem autenticação; confirmar acesso negado.
- [ ] Tentar acessar uma diária de outro usuário; confirmar bloqueio por RLS/RPC.
- [ ] Testar estados vazios, erros de rede e sessão expirada.
- [ ] Testar layout em viewport móvel e desktop, inclusive tabelas com rolagem horizontal.
- [ ] Testar 360, 390 e 430 px, safe area com notch e teclado mobile aberto.
- [ ] Testar permissão de câmera e GPS recusada, arquivo com MIME incorreto e limite acima de 10 MB.
- [ ] Confirmar que notificações chegam em tempo real e a leitura persiste após recarregar.
- [ ] Executar `npm run lint`, `npm run typecheck` e `npm run build` antes de publicar.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` em desenvolvimento e preencha:

- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave publicável/anon do projeto.
- `NEXT_PUBLIC_APP_URL`: origem pública HTTPS do ExtraChef, sem barra final.
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`: chave pública VAPID usada pelo navegador.
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada usada somente nas rotas server-side de push.
- `WEB_PUSH_VAPID_PRIVATE_KEY`: chave privada VAPID, somente no servidor.
- `WEB_PUSH_SUBJECT`: contato VAPID, por exemplo `mailto:suporte@seudominio.com`.
- `PUSH_WEBHOOK_SECRET`: segredo aleatório compartilhado com o Database Webhook.

Não exponha `SUPABASE_SERVICE_ROLE_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` ou `PUSH_WEBHOOK_SECRET` no navegador nem em variáveis `NEXT_PUBLIC_*`.

## Vercel

- [ ] Importar o repositório e manter o preset Next.js detectado.
- [ ] Configurar as duas variáveis de ambiente em Development, Preview e Production.
- [ ] Confirmar o comando de build `npm run build`.
- [ ] Fazer deploy de Preview e testar login, dashboards, notificações e o fluxo completo de uma diária.
- [ ] Configurar domínio de produção e HTTPS.
- [ ] Adicionar domínio de produção e URLs de Preview às URLs permitidas de autenticação do Supabase.
- [ ] Confirmar que `.env.local`, `.env.production` e chaves privadas não foram commitadas.

## Supabase

- [ ] Confirmar backup e projeto/ambiente correto antes de executar SQL.
- [ ] Aplicar migrations em ordem cronológica, após o schema-base de `users`, `jobs` e `applications`.
- [ ] Confirmar que o schema-base e suas policies RLS estão versionados/aplicados; as migrations deste MVP não criam `users`, `jobs` e `applications`.
- [ ] Aplicar migrations nesta ordem: `20261014000000`, `20261014010000`, `20261014015000`, `20261014020000`, `20261014025000`, `20261014030000`, `20261014035000`, `20261014040000`, `20261014050000_profiles_and_geo.sql`, `20261014051000_core_rls.sql`, `20261014055000_profile_summary_push.sql`, `20261014059000_worker_estimated_earnings.sql`, `20261014060000_notification_deep_links.sql`.
- [ ] Executar as migrations `20261014015000` e `20261014025000` separadamente das migrations que usam os novos valores de enum; aguardar commit entre execuções.
- [ ] Confirmar RLS e policies nas tabelas usadas pela aplicação.
- [ ] Em **Database > Publications**, confirmar `messages` e `notifications` em `supabase_realtime`.
- [ ] Configurar Auth Site URL e Redirect URLs para produção e Preview.
- [ ] Em Database > Webhooks, criar webhook `INSERT` em `public.notifications` apontando para `POST https://SEU_DOMINIO/api/push/dispatch` com header `x-extra-chef-webhook-secret: <PUSH_WEBHOOK_SECRET>`.
- [ ] Gerar chaves com `npx web-push generate-vapid-keys`; configurar a chave pública também como `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`.
- [ ] Revisar logs de Database, Auth e API após o primeiro deploy.

## Segurança de produção

- [ ] Manter somente chaves publicáveis no cliente; segredos devem ficar no servidor.
- [ ] Confirmar que RPCs `SECURITY DEFINER` usam `search_path` restrito, validam `auth.uid()` e limitam `EXECUTE` a `authenticated`.
- [ ] Testar policies RLS com contas de restaurante, trabalhador e usuário não relacionado.
- [ ] Validar no banco IDs e status sensíveis; não confiar apenas nos campos enviados pelo navegador.
- [ ] Confirmar unicidade de candidatura, check-in, check-out e avaliação no banco.
- [ ] Manter CPF, RG, data de nascimento, selfie e currículo privados; definir consentimento, retenção e exclusão conforme LGPD antes de usuários reais.
- [ ] Confirmar que o webhook de Push usa segredo forte e que a chave `service_role`/VAPID privada existe apenas no servidor.
- [ ] Não registrar tokens, chaves ou dados pessoais em logs do navegador ou da Vercel.
- [ ] Ativar MFA nas contas administrativas do Supabase e da Vercel.