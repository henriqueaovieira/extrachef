# Locais operacionais: implantação e validação

> PROPOSTA SUSPENSA. Este documento descreve a implementação anterior, não
> aprovada para aplicação. O SQL foi preservado em `supabase/proposals/`, fora
> das migrations executáveis. Para a fase atual independente, siga
> [Catálogo de locais](./work-locations.md). Não aplicar esta proposta.

## Diagnóstico

- O GPS já era salvo em `jobs.latitude/longitude`, não no perfil do restaurante.
  O problema era a origem: criar vaga capturava a posição do dispositivo do
  publicador. Isso não confirma o endereço de um serviço externo.
- Check-in e check-out comparavam esse GPS com um raio fixo de 300 m.
- As políticas de INSERT de jobs também exigiam as coordenadas antigas.
- Perfis guardam endereço cadastral. Não são fonte de GPS operacional.
- Eventos não tinham local nem ligação com vagas. Não havia mapa ou geocodificador.
- Buscar vagas e candidatar-se não exigia GPS; esse comportamento foi preservado.

## Arquitetura implementada

- Empresa: endereço cadastral, sem alterações nas tabelas de perfis.
- Evento: endereço próprio em `event_*` e `location_name`.
- Vaga: endereço próprio em `work_*`, `location_name`, `event_id` opcional,
  `geofence_radius_m` e `location_source`.
- Selecionar evento copia o local para o formulário. É um snapshot editável,
  não uma referência dinâmica. Alterar/excluir o evento não muda o local da vaga.
  Excluir evento apenas remove `event_id`.
- O endereço completo de eventos inclui número/bairro em `event_address`.
- O componente compartilhado invalida coordenadas quando os campos mudam.
  Salvar geocodifica automaticamente; “Conferir localização” antecipa a consulta.
  Falha impede salvar e mostra erro, sem coordenadas fictícias ou GPS da empresa.
- A distância no painel do trabalhador é opcional, em linha reta, calculada
  apenas após um gesto de permissão. Não filtra vagas nem bloqueia candidatura.
- As RPCs existentes continuam sendo a autoridade de presença. Assinaturas,
  participantes autorizados, locks e transições de status foram preservados.
  Só a origem das coordenadas e o raio passam a vir do local da vaga.
- Novas vagas: 200 m, check-in na data da vaga em `America/Sao_Paulo`.
  Check-out não exige mesma data, para preservar diárias que cruzam meia-noite.
- Vagas existentes: GPS original e 300 m, sem impor uma nova restrição de data
  retroativamente. Coordenadas/endereço/raio não podem mudar após um check-in.
- Configuração futura: o banco aceita 100, 200, 300 ou 500 m. Não foi criada
  uma tela de configuração. Alteração administrativa deve ocorrer antes do início.
- `applications.manual_checkin_requested_at/manual_checkin_reason` são somente
  fundação: sem formulário, concessão de acesso, aprovação ou desvio de GPS.

GPS do navegador pode ser impreciso ou falsificado; uma cerca geográfica não
certifica presença física. As observações originais de checkins/checkouts são
preservadas. Não ampliamos o raio automaticamente pela precisão do dispositivo.

## Geocodificação: configuração opcional

Configure somente no servidor, usando o serviço próprio/contratado escolhido:

```dotenv
GEOCODING_ENDPOINT=https://seu-servico.example/geocode
GEOCODING_API_KEY=
```

Não use prefixo `NEXT_PUBLIC_` para essas variáveis. A chave, se configurada, é
enviada como Bearer apenas ao endpoint fixo do servidor. A rota interna
`POST /api/geocode` autentica a sessão e consulta o papel no banco; somente
restaurantes podem consultar. Respostas não são cacheadas.

Contrato esperado pelo adaptador externo:

```json
{
  "address": "Rua das Flores",
  "number": "120",
  "neighborhood": "Centro",
  "city": "Piracicaba",
  "state": "SP",
  "postal_code": "13400000",
  "country": "BR"
}
```

Resposta HTTP 200 com números, não strings:

```json
{ "latitude": -22.7, "longitude": -47.6 }
```

O endpoint deve usar HTTPS, aceitar POST JSON, resolver endereço completo
(não apenas centro da cidade/CEP) e responder em menos de 10 segundos.
Use 404/422 para endereço não localizado. Timeout, indisponibilidade,
redirecionamentos e coordenadas fora dos limites são rejeitados.
Configure quotas/rate limiting no serviço/gateway contratado; a autenticação
da rota não constitui limitação de consumo.
Não há mapa, pin arrastável ou integração com fornecedor público implícita.
Somente as coordenadas são mostradas para conferência.

Sem endpoint, ou quando o serviço falhar, a criação da operação continua com o
endereço informado e coordenadas pendentes. Não são inventadas coordenadas:
recursos que dependam de distância, proximidade ou validação geográfica não
estarão disponíveis para essa operação até que suas coordenadas sejam
resolvidas. A criação e o salvamento do endereço não dependem da configuração
do serviço.

## Migration e dependências

Aplicar **uma vez**:
[20261015050000_operational_locations.sql](../supabase/proposals/20261015050000_operational_locations.sql).
É transacional, cria campos/constraints/índices/triggers e substitui as duas RPCs.
Não cria tabelas, não altera aprovação, notificações ou regras de autenticação.
As políticas de INSERT de jobs preservam proprietário/papel/status, trocando
somente `latitude/longitude` por `work_latitude/work_longitude`.

Pré-requisitos reais, que devem ser verificados e não presumidos:

| Contrato | Migration de origem |
|---|---|
| Jobs, aplicações e usuários básicos | Schema original do projeto |
| Aprovação e bloqueio de candidaturas em vagas fechadas | `20261014000000_approve_application_and_block_closed_jobs.sql` |
| Status `in_progress` e `completed`, checkins e checkouts | Migrations históricas de presença/status |
| Coordenadas nas três tabelas e RPCs com parâmetros GPS | `20261014050000_profiles_and_geo.sql` |
| RLS e permissões por coluna de jobs | `20261014051000_core_rls.sql` |
| Tabela events e políticas do proprietário | `20261015010000_restaurant_events.sql` |

**Não reaplique migrations históricas nem Events às cegas.** As migrations de
chat/push/candidatura recebida não são dependências desta alteração.

### Preflight de produção

1. Fazer backup/PITR e exportar definições atuais das RPCs, políticas e grants.
2. Pausar escritas e anotar contagens de jobs/events/applications/checkins/checkouts.
3. Rodar as consultas abaixo. Se houver objeto ausente, schema diferente,
   políticas extras ou coluna nova parcialmente aplicada, interromper e reconciliar.

```sql
SELECT to_regclass('public.events') AS events,
       to_regclass('public.checkins') AS checkins,
       to_regclass('public.checkouts') AS checkouts,
       to_regprocedure('public.register_worker_checkin(uuid,double precision,double precision)') AS checkin_rpc,
       to_regprocedure('public.register_worker_checkout(uuid,double precision,double precision)') AS checkout_rpc,
       to_regprocedure('public.approve_application(uuid,uuid)') AS approval_rpc;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('jobs','events','applications','checkins','checkouts')
  AND column_name IN ('latitude','longitude','work_latitude','event_latitude',
                      'geofence_radius_m','event_id','worker_id','restaurant_id','status')
ORDER BY table_name, column_name;

SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('jobs','events','applications','checkins','checkouts')
ORDER BY tablename, policyname;

SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE oid IN (
  to_regprocedure('public.register_worker_checkin(uuid,double precision,double precision)'),
  to_regprocedure('public.register_worker_checkout(uuid,double precision,double precision)')
);

SELECT 'jobs' AS entity, count(*) FROM public.jobs
UNION ALL SELECT 'events', count(*) FROM public.events
UNION ALL SELECT 'applications', count(*) FROM public.applications
UNION ALL SELECT 'checkins', count(*) FROM public.checkins
UNION ALL SELECT 'checkouts', count(*) FROM public.checkouts;
```

4. Ensaiar a migration numa cópia de staging e os fluxos abaixo com dois papéis.
5. Configurar/testar geocodificador no ambiente de destino.
6. Em janela coordenada, aplicar SQL e publicar a versão nova antes de reabrir
   escritas. A versão antiga não fornece endereço operacional obrigatório:
   **não há compatibilidade de criação entre o app antigo e o novo contrato**.
7. A migration termina com reload de schema PostgREST. Confirmar leitura via API.

### Validação após a migration

As contagens anteriores devem continuar iguais durante a janela sem escritas.
As consultas de inconsistências abaixo devem retornar zero linhas:

```sql
-- Backfill não muda o ponto nem o raio de vagas antigas com GPS válido.
SELECT id FROM public.jobs
WHERE location_source = 'legacy'
  AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
  AND (work_latitude IS DISTINCT FROM latitude
    OR work_longitude IS DISTINCT FROM longitude OR geofence_radius_m <> 300);

SELECT id FROM public.jobs
WHERE (work_latitude IS NULL) <> (work_longitude IS NULL)
   OR geofence_radius_m NOT IN (100,200,300,500);

-- Consultas informativas: não são erros de migração.
SELECT id, title FROM public.jobs WHERE work_latitude IS NULL;
SELECT id, title FROM public.events WHERE event_latitude IS NULL;

SELECT column_name, privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='jobs' AND grantee='authenticated'
  AND column_name IN ('work_latitude','work_longitude','event_id','geofence_radius_m')
ORDER BY column_name, privilege_type;

SELECT policyname, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='jobs' AND cmd='INSERT';

SELECT has_function_privilege('authenticated',
  'public.assert_job_presence(uuid,double precision,double precision,boolean)',
  'EXECUTE') AS must_be_false;
```

### Backfill e históricos

- Vagas com coordenadas válidas: copia exatamente para `work_*`; preserva 300 m.
- Vagas sem GPS válido: não inventa coordenadas, não usa perfil e não bloqueia
  candidatura. Check-in/out seguem bloqueados até corrigir o local.
- Corrigir vagas antigas sem presença somente com endereço/ponto confirmado,
  por operação administrativa direcionada, em transação com lock da vaga;
  conferir `restaurant_id` e ausência de checkins antes de atualizar.
  Manter `location_source='legacy'` e raio 300 para conservar a regra escolhida.
  Não há edição geral de vaga nova neste escopo.
- Vaga já iniciada: não mover o ponto de check-out; tratar inconsistências
  operacionalmente, sem apagar presença ou liberar bypass manual.
- Eventos existentes ficam sem local conhecido. Continuam editáveis sem exigir
  localização retroativa. “Adicionar local do evento” permite cadastrar o local.
  Criar uma vaga a partir de evento antigo exige completar seu local no formulário.
- Não há geocodificação em massa/reversa automática nem cópia de endereços cadastrais.
- Os índices adicionados são para vínculo e consultas por cidade/UF. A distância
  atual é calculada no cliente; não foi adicionado PostGIS nem filtro espacial.

### Rollback

- Falha antes do COMMIT: a transação inteira é revertida; não publicar o app novo.
- Falha de configuração do provedor: corrigir endpoint/chave e republicar;
  não remover dados nem fingir sucesso.
- Depois do COMMIT: preferir correção incremental e manter colunas, vínculos,
  snapshots e registros novos. Não reaplicar o SQL como tentativa de reparo.
- Não voltar cegamente ao app/RPCs antigos: eles exigem GPS antigo e fixam
  300 m, o que impediria novas vagas ou mudaria a política de vagas de 200 m.
- Se downgrade for inevitável: pausar escritas, exportar também todos os registros
  criados após rollout, comparar schemas/contratos, preparar uma versão compatível
  e ensaiar a reversão em cópia. Usar as definições salvas no preflight, não
  executar migrations históricas inteiras. Não fazer DROP de tabelas/colunas.
- Restauração por backup/PITR exige avaliação explícita da perda de escritas
  posteriores. Validar novamente autenticação, candidaturas e presença antes de abrir.

## Validação automatizada e aceite

Sem novas dependências no projeto:

```powershell
node --test tests\geolocation.test.mjs tests\ui.test.mjs tests\communication.test.mjs
npm run lint
npm run typecheck
npm run build
```

O teste SQL usa PostgreSQL embutido PGlite, instalado temporariamente fora do
repositório nesta implementação. Para repeti-lo, use uma instalação local
disponível ou restaure a ferramenta isoladamente, sem alterar dependências do app:

```powershell
$sqlTools = Join-Path $env:LOCALAPPDATA 'ExtraChefSqlTests'
npm install --prefix $sqlTools --no-save --package-lock=false @electric-sql/pglite
$env:PGLITE_MODULE = Join-Path $sqlTools 'node_modules\@electric-sql\pglite\dist\index.js'
node --test tests\geolocation-sql.test.mjs
```

Sem essa variável, o teste SQL é explicitamente pulado. Ele executa migrations
reais de eventos/RLS/aprovação/GPS e a migration nova, com schema-base isolado,
papéis e `auth.uid()` simulados. Não representa todas as extensões, triggers ou
dados do seu Supabase; o ensaio em staging continua obrigatório.

Checklist de aceite em staging e depois com contas de teste no destino:

- [ ] Restaurante cria vaga com endereço externo ao cadastro da empresa.
- [ ] Todos os `work_*`, local e CEP são persistidos corretamente.
- [ ] Provedor real gera coordenadas correspondentes ao endereço; falhas aparecem.
- [ ] Trabalhador vê a vaga sem permitir localização.
- [ ] Permitir GPS mostra distância; negar GPS não impede candidatura.
- [ ] Candidatura funciona sem coordenadas do trabalhador.
- [ ] Aprovação existente continua funcionando.
- [ ] Check-in dentro do raio e na data da vaga funciona; fora do dia é rejeitado.
- [ ] Check-in fora do raio mostra distância em metros e não altera status.
- [ ] Check-out dentro do raio funciona, inclusive após meia-noite; fora é rejeitado.
- [ ] Evento fornece snapshot editável à vaga; alterar/excluir evento não move a vaga.
- [ ] Legacy mantém 300 m, histórico e coordenadas de presença sem alterações.
- [ ] Novo local é 200 m; configuração administrativa aceita só 100/200/300/500.
- [ ] Outro trabalhador não registra presença; outro restaurante não vincula evento alheio.
- [ ] Endereço alterado invalida coordenadas; duplo envio/preview não troca snapshots.
- [ ] Testar Android/iPhone, permissão negada, timeout e baixa precisão em HTTPS.
