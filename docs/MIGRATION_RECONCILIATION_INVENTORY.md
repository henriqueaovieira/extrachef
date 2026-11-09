# ExtraChef — Reconciliation / Restore Migration Inventory

**Status: CLASSIFICAÇÃO DOCUMENTAL; ESTADO DE PRODUÇÃO NÃO CONFIRMADO**

Os nomes e comentários SQL indicam intenção e risco, mas não demonstram por que cada arquivo foi criado, em qual ambiente foi aplicado ou se corrigiu produção. A concentração em 2026-11-04 é sinal para investigar, não prova isolada de schema drift.

| Migration | Tipo documental | Objetos/tema indicado no arquivo | Motivo observável | Risco |
|---|---|---|---|---|
| `20261104000000_reconcile_checkin_gps.sql` | Reconciliação/correção de RPC | `issue_operational_code` com coordenadas e validação de distância | Comentário: restaurar validação GPS do check-in | Mudança de assinatura/comportamento; clientes sem GPS podem falhar. Migration pede nova migration forward para rollback |
| `20261104010000_reconcile_verified_profile.sql` | Restore/correção de segurança | Guard, submit/review, view, índice, trigger e policies de selfie | Comentário: restaurar verificação, privacidade e status no diretório | Altera estado/policies restritivas de selfie; precisa validar combinação permissiva/restritiva |
| `20261104020000_reconcile_worker_earnings.sql` | Restore/reconciliação de função | Estimativa mensal de ganhos | Comentário: restaurar cálculo para Worker autenticado | Fuso horário/filtros incorretos podem alterar valores exibidos |
| `20261104030000_reconcile_operational_inbox.sql` | Restore/reconciliação de RPC | Inbox operacional paginada de Restaurante | Comentário: restaurar inbox com filtros de privacidade | Expõe dados operacionais; autorização, limites e paginação críticos |
| `20261104040000_reconcile_geocoded_locations.sql` | Correção/reconciliação funcional | RPC de salvar localização geocodificada e trigger de localização | Comentário: salvar coordenadas resolvidas; declara que não restaura o guard que exige geocoding | Altera comportamento de localização de vagas; regressão afeta criação/operação |
| `20261104050000_reconcile_restaurant_demand_location.sql` | Restore/reconciliação funcional | Criação de demanda a partir do endereço do Restaurante | Comentário: resolver endereço primário em localização reutilizável | Pode criar/reutilizar entradas de catálogo; não apagar localizações existentes no rollback |
| `20261104060000_reconcile_talent_interest.sql` | Script de diagnóstico manual, não DDL de reconciliação | Consulta de distribuição de categorias em `talent_connections` | O arquivo contém uma consulta `SELECT` de contagem | Nome pode induzir expectativa de reconciliação; não há alteração de schema nesse arquivo |
| `20261104070000_reconcile_operational_schedule.sql` | Reconciliação operacional / agendamento | Extensão `pg_cron` e job `extrachef-operational-minute` | Comentário: garantir execução por minuto do processador operacional | Privilégios de extensão, carga, idempotência e cron jobs compartilhados |
| `20261104090000_restore_talent_interest.sql` | Restore funcional | Constraint de categoria e `set_talent_connection` | Comentário: permitir categoria `interest` e manter exclusividade com `favorite` | Validação de constraint varre dados; rollback exige tratar conexões existentes sem apagá-las |
| `20261104190000_restore_operational_checkin_gps.sql` | Script manual de restore/correção | `issue_operational_code` e validação de GPS | Comentário: aplicação manual após `recruitment_availability`; não altera tabelas/dados | Processo manual pode divergir da ledger de migrations; revisar duplicidade e ordem antes de qualquer reaplicação |

## Conclusões

- ✅ Os arquivos e seus comentários documentam restaurações, reconciliações de RPCs e um ajuste de cron.
- ✅ Há pelo menos um arquivo com o prefixo `reconcile` que é somente diagnóstico (`SELECT`), não DDL.
- ⚠ A existência de arquivos `reconcile`/`restore` sugere necessidade de revisar sequência, ordem e processo de deploy.
- ❌ Não foi possível confirmar se foram aplicados em produção, se representam hotfix, se substituem migrations anteriores ou se corrigiram drift real.
- ❌ Não foi possível comparar seus efeitos com o estado corrente do banco ou com a tabela de migrations aplicadas.

## Próximo passo seguro

Com catálogo e migration history somente leitura, classificar cada arquivo como aplicado/não aplicado por ambiente, comparar definição efetiva antes/depois e identificar alterações manuais. Não reaplicar scripts marcados como manuais nem executar `repair`/`restore` com base apenas no nome. Qualquer correção deve seguir plano de deploy e rollback próprios após a reconciliação.
