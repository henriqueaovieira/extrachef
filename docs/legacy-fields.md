# LEGACY_FIELDS: perfil profissional

## Escopo

Inventario do worktree local sobre o commit
`f64c18810f7b48850db7ae77c687c365a23576c2`, incluindo trabalho
preexistente ainda nao commitado. Nao representa uma verificacao do deployment
ou do schema remoto.

Esta epica apenas documenta. Nao altera colunas, registros, migrations, RPCs,
uploads, buckets ou permissoes. Ausencia de interface nao autoriza exclusao.

## Inventario

Os tres campos foram introduzidos na tabela `public.worker_profiles` pela
[migration de perfis e geolocalizacao](../supabase/migrations/20261014050000_profiles_and_geo.sql#L80).

| Campo | Origem e contrato | Motivo da preservacao | Uso atual | Status |
| --- | --- | --- | --- | --- |
| `worker_profiles.whatsapp` | Linha 86 da migration: `text NOT NULL`, sem default. Era contato adicional ao telefone. | Preservar valores antigos e compatibilidade da gravacao do perfil sem mudar o schema. | O editor consulta e hidrata o valor antigo, mantem-no no estado interno e o reenvia no `upsert`. Para novo perfil utiliza `''`. Nao existe input, validacao ou exibicao de WhatsApp no perfil profissional. | **LEGACY / PRESERVADO / SEM INTERFACE** |
| `worker_profiles.resume_pdf_path` | Linha 96: `text` nullable. Referencia historica ao caminho do curriculo. | Preservar documentos, referencias e historico, sem supor que arquivos sao orfaos. | Nao integra os tipos, SELECT explicito, payload ou uploads do editor profissional atual. Pode ser recuperado pelo SELECT amplo da visualizacao e pela exportacao autenticada de dados, sem renderizacao no perfil. | **LEGACY / PRESERVADO / SEM INTERFACE** |
| `worker_profiles.certificates` | Linha 94: `jsonb NOT NULL DEFAULT '[]'::jsonb`. Colecao historica de referencias a certificados. | Preservar dados e arquivos; quantidade de certificados nao e criterio da experiencia atual. | Nao integra o editor, uploads, listagens, contagens ou completude profissional. Pode ser recuperado pelo SELECT amplo da visualizacao e pela exportacao autenticada, sem renderizacao no perfil. | **LEGACY / PRESERVADO / SEM INTERFACE** |

## Evidencias e limites de "sem interface"

- [WorkerProfile e estado inicial](../app/components/profile-editor.tsx#L15)
  ainda incluem `whatsapp`; a
  [consulta profissional](../app/components/profile-editor.tsx#L132) o carrega
  e a [gravacao](../app/components/profile-editor.tsx#L215) preserva o valor.
  Remover essa propriedade sem tratar `NOT NULL` quebraria novos cadastros.
- [ProfileOverview](../app/components/profile-overview.tsx#L67) ainda faz
  `select('*')` em `worker_profiles`. Portanto, **sem interface nao significa
  sem leitura, sem trafego de dados ou existente exclusivamente no banco**.
  Os campos historicos nao entram nas linhas visiveis do profissional.
- As [permissoes historicas por coluna](../supabase/migrations/20261015020000_auth_foundation.sql#L52)
  continuam citando os campos. Documentar nao modifica esses contratos.
- A [exportacao de conta](../supabase/migrations/20261015090000_privacy_account_rights.sql#L104)
  serializa a linha de perfil com `to_jsonb(p)`. O download autenticado pode
  conter os campos historicos; isso e direito de acesso aos dados, nao
  reintroducao no perfil ou formulario.
- O [teste de exportacao](../tests/privacy-sql.test.mjs#L65) preserva uma
  referencia de curriculo. Os
  [testes do editor](../tests/ui.test.mjs#L149) verificam a preservacao dos
  documentos e do contato antigo sem renderizar inputs nem executar uploads
  dos campos aposentados.
- O [WhatsApp do restaurante](../app/components/profile-editor.tsx#L375)
  continua sendo um campo ativo de outro perfil/tabela. Nao faz parte deste
  inventario de legados profissionais.
- Foto de perfil e selfie de verificacao permanecem ativas. O bucket
  `worker-private` nao e exclusivo de curriculos/certificados. Nao excluir o
  bucket, referencias ou objetos por causa desta classificacao.
- A exclusao autenticada de conta continua com seu comportamento existente;
  esta epica nao executa exclusoes nem modifica direitos de privacidade.

## Regra de manutencao

Nao voltar a apresentar esses campos como requisito, pontuacao, completude,
verificacao, upload, lista ou resumo profissional. Manter telefone, identidade,
especialidades, Perfil Verificado e Confianca Operacional.

Qualquer desativacao tecnica futura exige tarefa propria, inventario de
consumidores historicos/exportacoes e politica explicita de retencao. **Nenhuma
migration ou limpeza de Storage esta autorizada por este documento.**

Consulte o [roadmap V2](./consolidation-roadmap-v2.md) para o mapa das experiencias.
