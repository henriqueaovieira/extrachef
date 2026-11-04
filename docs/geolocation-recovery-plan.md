# Recuperacao de localizacao de operacoes antigas

## Escopo e autorizacao

Este documento e estrategia, nao uma correcao executada. Nenhum endereco real
foi consultado, nenhum job foi atualizado e nao ha backfill automatico.
Novas publicacoes exigem snapshot pronto; registros legados invalidos continuam
visiveis aos participantes, mas nao podem receber novos avancos de recrutamento,
contratacao ou substituicao.

## Inventario somente leitura

Executar apenas em etapa autorizada, com acesso restrito:

```sql
SELECT id, demand_id, restaurant_id, status, location_status, work_location_id,
       work_address, work_number, work_neighborhood, work_city, work_state,
       work_postal_code, work_latitude, work_longitude, location_snapshot_at
FROM public.jobs
WHERE work_latitude IS NULL OR work_longitude IS NULL
   OR work_latitude NOT BETWEEN -90 AND 90
   OR work_longitude NOT BETWEEN -180 AND 180
   OR location_status IS DISTINCT FROM 'ready'
ORDER BY job_date, id;
```

Cruzar IDs com candidaturas, assignments (inclusive interrompidos),
checkins/checkouts e pagamentos. Produzir contagens por estagio sem divulgar
enderecos em logs, tickets publicos ou relatorios sem controle de acesso.
As contagens de producao ainda nao foram apuradas por esta implementacao.

## Criterios

| Grupo | Conduta |
|---|---|
| Aberta sem candidaturas | Resolver endereco historico e submeter a aprovacao. |
| Com candidaturas | Preservar pessoas e timestamps; nao criar nova demanda para contornar bloqueios. |
| Contratada sem check-in | Prioridade; confirmar o local combinado com restaurante e profissional. |
| Iniciada/check-in existente | Nao alterar automaticamente; guard rejeita mudanca de local. Analise individual. |
| Concluida/cancelada | Preservar evidencia historica; corrigir somente por justificativa especifica. |
| Endereco incompleto/ambiguo | Solicitar esclarecimento; nunca usar centro da cidade/CEP ou GPS do publicador. |

O perfil atual e o catalogo podem ter mudado. A fonte e o snapshot historico do
job, nao uma propagacao indiscriminada do endereco atual. Varios jobs podem
referenciar o mesmo catalogo com snapshots diferentes.

## Execucao futura, separada desta entrega

1. Obter backup/PITR e manifesto protegido dos valores anteriores.
2. Selecionar lote pequeno por restaurante/estagio.
3. Confirmar endereco completo e numero. Enderecos confidenciais exigem
   instancia propria ou servico aprovado, nao demonstrativo publico.
4. Gerar candidatos pelo adapter interno, sem atualizar jobs. Nao criar scripts
   distribuidos ou carga em lote no servidor demonstrativo.
5. Conferir territorio, estabelecimento e proximidade real. Coordenada valida
   matematicamente nao comprova local certo. Rejeitar aproximacoes/ambiguidades.
6. Aprovar IDs, coordenadas e justificativa com responsavel operacional.
7. Revalidar versoes/snapshot e estagio imediatamente antes da alteracao.
8. Em transacao curta, bloquear owner/job/assignments na ordem das RPCs
   existentes e confirmar que nao houve check-in/novo evento operacional.
9. Atualizar somente campos aprovados e `location_status` coerente. Registrar
   origem, data e antes/depois em manifesto auditavel. Nao alterar historico,
   participantes, contratos, timestamps de presenca ou pagamentos.
10. Validar coordenadas, constraints, prontidao e acesso dos participantes.

O procedimento de escrita devera ser revisado separadamente; nenhum SQL de
UPDATE em massa e fornecido aqui. Nao desabilitar guards em producao para
contornar operacoes iniciadas. Resolver somente catalogo nao recupera snapshots.

## Riscos

- endereco historico divergente do perfil atual;
- ponto no numero errado com consequente rejeicao no raio de 100 m;
- alteracao concorrente de contratacao/presenca;
- mudanca de local compartilhado afetando novas publicacoes;
- limites/disponibilidade/cobertura do Photon publico;
- exposicao de enderecos e manifestos;
- interpretar localizacao como prova suficiente de presenca.

## Reversao

Guardar manifesto com IDs, versoes, valores anteriores/novos, origem,
aprovacao e horario. Reverter apenas se nao houve avancos operacionais
dependentes desde a correcao. Caso tenha ocorrido check-in/pagamento,
interromper reversao automatica e analisar individualmente.
Reversao nao deve reabrir recrutamento encerrado, trocar assignments,
remover check-in ou apagar pagamento. Preservar backup e evidencia.

## Aceite

- Cada ID aprovado tem snapshot `ready` e coordenadas conferidas.
- Historico, candidaturas e assignments permanecem intactos.
- Operacao invalida nao aceita novos avancos antes da recuperacao.
- Check-in aceita 100 m e rejeita acima de 100 m.
- Pagamento/checkout continuam funcionando.
- Jobs nao aprovados permanecem inalterados.

Para arquitetura, variaveis e rollout, consultar
[monitoramento e implantacao](./geolocation-monitoring.md).
