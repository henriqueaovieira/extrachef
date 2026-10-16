# Catalogo independente de locais

## Escopo da Fase 1 e integracao aprovada na Fase 2

Rota: `/restaurant/locations`, acessivel pelo link **Meus Locais** no dashboard
do restaurante, inclusive em mobile. Usa App Router, cliente Supabase existente
e componentes compartilhados Button, Card, Badge, MaskedInput, Select, Toast,
EmptyState e LoadingSkeleton. Nao altera autenticacao ou os cinco itens da
navegacao inferior.

O catalogo nao le/grava events, jobs, applications, checkins ou checkouts.
Nao altera as RPCs de presenca e nao depende de migrations dessas entidades.
Nao existe GPS, chamada externa, mapa ou geocodificacao no catalogo.
A [Fase 2 de eventos](./event-location-snapshots.md) agora prepara selecao e copia
independente para eventos, em migration separada ainda nao executada.
Vagas continuam fora desta integracao.

A proposta operacional anterior foi suspensa e movida para
`supabase/proposals/20261015050000_operational_locations.sql`. Nao aplicar.
O codigo operacional anterior existente no worktree nao foi integrado nem
concluido nesta entrega; nao deve ser confundido com requisito do catalogo.

## Arquitetura

`users` (restaurante) -> varios `work_locations`.

- Endereco: name, address, number, neighborhood, city, state, postal_code,
  country_code BR. CEP, numero e bairro sao opcionais.
- Coordenadas: latitude/longitude opcionais; ambas nulas ou ambas validas.
- Estado tecnico: pending/resolved/failed/needs_review, coordinate_source,
  geocoded_at, geocoding_attempted_at, geocoding_error_code.
- Ciclo de vida: is_default, archived_at, created_at, updated_at.
- address_version muda quando o endereco muda; respostas futuras do geocodificador
  deverao conferir essa versao antes de aplicar coordenadas.
- revision muda em todas as mutacoes das RPCs, inclusive troca de padrao,
  protegendo contra sobrescrita por outra aba. Conflito exige atualizar a lista
  e reabrir o formulario; nao sobrescreve automaticamente.

Todos os cadastros novos comecam com coordenadas nulas e estado pending. A tela
explica essa pendencia sem tratar o cadastro como falha. A fase atual nao tenta
resolver coordenadas nem permite ao navegador forcar estado resolved.

Editar somente o nome preserva coordenadas existentes. Alterar endereco, numero,
bairro, cidade, UF ou CEP invalida coordenadas e metadados, muda para pending
e incrementa address_version. As RPCs sao a autoridade das mutacoes. Operacoes
privilegiadas diretas futuras devem respeitar o mesmo protocolo de revisao.

## RLS e gravacoes

- SELECT permitido somente ao restaurante proprietario, mediante RLS permissiva
  e restritiva. Trabalhadores nao consultam o catalogo.
- INSERT/UPDATE/DELETE diretos nao sao concedidos a authenticated.
- `save_work_location`: cria ou edita endereco, normaliza dados e confere
  identidade/papel/propriedade/revisao; nao recebe proprietario do navegador.
- `manage_work_location`: set_default, unset_default, archive, restore, delete.
- Funcoes SECURITY DEFINER com search_path vazio, EXECUTE apenas authenticated,
  validacao interna de auth.uid() e papel restaurant.
- Todas as escritas dessas RPCs bloqueiam a linha do proprietario em users;
  operacoes concorrentes do mesmo restaurante sao serializadas. Cada transacao
  e curta e nao faz requisicoes externas.
- Indice unico parcial garante no maximo um padrao ativo por restaurante,
  inclusive contra gravacoes privilegiadas inconsistentes.
- Arquivar remove o padrao. Restaurar nao escolhe novo padrao nem retoma o antigo.
- Nao ha padrao escolhido silenciosamente: o usuario usa Definir como padrao.
- Exclusao definitiva exige arquivamento previo e confirmacao na interface.
  A migration separada da Fase 2 adiciona FK que bloqueia exclusao de locais
  referenciados por eventos; arquivamento continua permitido e preserva snapshots.
- Nenhum papel admin e criado. Exclusao da conta em users faz cascade do catalogo.

## Migration

[20261015060000_work_locations_catalog.sql](../supabase/migrations/20261015060000_work_locations_catalog.sql)

Depende somente de:

1. public.users com id UUID unico e role contendo restaurant/worker.
2. auth.uid(), papeis anon/authenticated e geracao de UUID disponiveis no Supabase.
3. Consulta do papel do proprio usuario permitida no contrato de users existente.

Nao depende da proposta operacional 20261015050000, nem das tabelas events/jobs.
Nao reexecutar migrations historicas para satisfazer dependencias sem inspecao.
Nao foi aplicada no Supabase nesta entrega.

O arquivo usa BEGIN/COMMIT, lock timeout 5s e statement timeout por instrucao de
5min. Cria uma tabela vazia, dois indices, duas policies e duas funcoes. Nao ha
backfill. O NOTIFY de reload do PostgREST esta depois do COMMIT: falha no reload
nao reverte o schema confirmado. Nao e uma migration idempotente.

### Preflight de producao

- [ ] Backup/PITR verificado.
- [ ] Inspecionar migration history e schema real, nao presumir historico completo.
- [ ] Confirmar que work_locations e as duas RPCs ainda nao existem.
- [ ] Confirmar users.id UUID, role e permissao de leitura do proprio papel.
- [ ] Garantir que a proposta suspensa esta fora das migrations executaveis.
- [ ] Ensaiar somente esta migration em staging.
- [ ] Publicar banco antes de habilitar a tela; sem a tabela, a UI exibe erro,
      nao uma falsa lista vazia.
- [ ] Nao usar db push indiscriminado para aplicar outras migrations pendentes.

Consultas abaixo sao para execucao futura autorizada:

```sql
SELECT to_regclass('public.work_locations') AS catalog;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='users'
  AND column_name IN ('id','role');
```

### Validacao depois da aplicacao

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='work_locations';

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='work_locations';

SELECT has_table_privilege('authenticated','public.work_locations','SELECT') AS select_allowed,
       has_table_privilege('authenticated','public.work_locations','INSERT') AS insert_must_be_false,
       has_table_privilege('authenticated','public.work_locations','UPDATE') AS update_must_be_false,
       has_table_privilege('authenticated','public.work_locations','DELETE') AS delete_must_be_false;

SELECT restaurant_id, count(*) FROM public.work_locations
WHERE is_default AND archived_at IS NULL
GROUP BY restaurant_id HAVING count(*) > 1;
```

A ultima consulta nao deve retornar linhas. Testar RLS com JWTs de usuarios
reais de staging, nao apenas SQL Editor privilegiado.

## Checklist funcional

- [ ] Meus Locais abre pelo dashboard em desktop e mobile.
- [ ] Restaurante cria local sem CEP, coordenadas ou servico externo.
- [ ] Nome/endereco/cidade/UF invalidos sao rejeitados.
- [ ] Listar/buscar/filtrar ativos, arquivados e todos funciona.
- [ ] Editar e recarregar preserva os dados salvos.
- [ ] Primeiro padrao e troca de padrao deixam somente um ativo.
- [ ] Remover padrao deixa zero; nao seleciona outro automaticamente.
- [ ] Arquivar padrao mostra confirmacao e remove a condicao de padrao.
- [ ] Restaurar nao recupera padrao automaticamente.
- [ ] Excluir exige arquivamento e confirmacao; cancelar preserva registro.
- [ ] Conflito entre abas nao sobrescreve uma revisao mais recente.
- [ ] Duplo clique nao dispara duas mutacoes simultaneas.
- [ ] Falha de leitura aparece como erro com opcao de atualizar.
- [ ] Gravacao bem-sucedida seguida de falha na leitura e informada como salva,
      sem oferecer reenviar o formulario.
- [ ] Outro restaurante e trabalhador nao leem/alteram o catalogo alheio.
- [ ] Sem sessao/anon nao grava e nao consulta.
- [ ] Nenhuma operacao altera eventos, vagas ou presenca.

## Testes

```powershell
node --test tests\work-locations.test.mjs tests\ui.test.mjs
npm run lint
npm run typecheck
npm run build
```

O teste de banco executa SQL em PostgreSQL embutido isolado, com somente users,
auth.uid() e papeis simulados. Nao acessa o Supabase nem exige eventos/vagas.
Nao ha dependencia adicional no projeto. Para repetir com ferramenta local:

```powershell
$sqlTools = Join-Path $env:LOCALAPPDATA 'ExtraChefSqlTests'
npm install --prefix $sqlTools --no-save --package-lock=false @electric-sql/pglite
$env:PGLITE_MODULE = Join-Path $sqlTools 'node_modules\@electric-sql\pglite\dist\index.js'
node --test tests\work-locations-sql.test.mjs
```

Sem PGLITE_MODULE o teste SQL e explicitamente pulado. Nao substitui teste no
Supabase staging, especialmente para RLS/JWTs, concorrencia e schema real.

## Rollback

Antes do COMMIT, falha reverte a transacao inteira. Apos COMMIT, desabilitar
o acesso a tela e preservar a tabela e os locais cadastrados e a reversao mais
segura. O restante do sistema nao depende desta tabela.

Se for indispensavel remover o schema, primeiro exportar os dados, verificar
dependencias reais e ausencia de integracoes futuras, depois remover funcoes
e tabela em uma reversao revisada/autorizada. Remover a tabela destroi catalogo,
padroes e dados de resolucao. Nao usar CASCADE indiscriminado nem remover users.
Nenhum dado de jobs/events/checkins/checkouts precisa ser revertido por esta fase.
