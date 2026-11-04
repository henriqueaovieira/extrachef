This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Recuperação de senha

Em `/login`, o link **Esqueceu sua senha?** pede o e-mail e chama
`resetPasswordForEmail` do Supabase Auth. O link do e-mail passa pelo
`/auth/callback` já existente, que troca o código pela sessão e abre
`/settings/password`. Ali o usuário define a nova senha (mínimo de 6
caracteres), a sessão de recuperação é encerrada e ele volta ao login. O link
precisa ser aberto no mesmo navegador, como na confirmação de cadastro, e
`<origem>/auth/callback**` deve estar em **Authentication → URL Configuration →
Redirect URLs** do projeto Supabase.

O callback identifica o fluxo (`flow=recovery`) e usa mensagens próprias para
cada caso: `confirmation_expired`/`confirmation_invalid` no cadastro e
`recovery_expired`/`recovery_invalid` na recuperação. Nos casos de recuperação,
o login já abre em **Recuperar senha** para pedir um novo link.

## Fluxo operacional

### Disponibilidade para recrutamento

A elegibilidade fica centralizada em `lib/demands.ts` e nas funcoes SQL da
migration `20261104180000_recruitment_availability.sql`. O corte normal e cinco
horas antes do inicio, inclusive no instante exato do corte. Publicacoes urgentes
(publicadas no corte ou depois dele, mas antes do inicio) recrutam ate o inicio;
o formulario avisa sobre a janela reduzida. A data original de publicacao nao
pode ser alterada para reabrir recrutamento.

Apos o corte, a operacao sai da descoberta publica, da Home/Vagas Abertas do
profissional e das sugestoes de convite. Candidaturas existentes continuam
acessiveis, e podem ser aprovadas ate o inicio. Convites comuns enviados antes
do corte podem ser aceitos ate o inicio. No inicio, novas participacoes e
contratacoes comuns sao bloqueadas mesmo sem contratado. O restaurante continua
vendo a operacao e seu historico; contratacoes existentes mantem seu fluxo.

Ausencia, abandono ou cancelamento do contratado nao criam jobs nem reabrem
recrutamento. No detalhe, o restaurante decide **Encerrar operacao** ou
**Buscar substituto**. So candidatos vinculados antes da ocorrencia recebem
convite de substituicao. O aceite informa disponibilidade; o restaurante deve
confirmar a contratacao antes do termino. A substituicao reutiliza o mesmo job,
preservando assignments, ocorrencias e confianca operacional anteriores.
Mensagens sao vinculadas a contratacao, para nao expor conversas anteriores ao
substituto. Check-in, pagamento, checkout e avaliacoes usam o participante certo.

As telas reavaliam o relogio enquanto abertas, e o banco valida INSERT direto,
RPCs e reabertura sob locks. Nenhum status funcional novo foi adicionado ao banco.
Aplicar essa migration exige conferir antes as migrations efetivamente
instaladas no ambiente: validacao local nao significa deploy remoto concluido.

A revisao de compatibilidade dessa migration preserva a assinatura instalada de
`issue_operational_code`: dois argumentos sem GPS ou quatro argumentos com GPS.
GPS nao e requisito para aplicar a regra de recrutamento. As diferencas e os
cuidados de reaplicacao estao no
[relatorio de compatibilidade](docs/recruitment-schema-compatibility.md).

Em Talentos, a operacao selecionada tem um resumo proprio; as abas usam chips
com os mesmos contadores e filtros existentes. Talentos recomendados preserva
a ordenacao anterior. Cards exibem avaliacao, operacoes concluidas, experiencia
compartilhada e status, sem modificar convites ou relacionamentos.

No detalhe da operacao, o resumo destaca data, horario, diaria, local e candidatos
ou a contratacao confirmada. A secao de pessoas mostra Candidatos antes da
contratacao e Profissional da Operacao depois, sem misturar as duas listas.
Registros historicos com mais de uma contratacao continuam acessiveis.
O fluxo compartilhado permanece antes dessa secao.
As acoes operacionais ficam na timeline existente, sem atalhos duplicados na
equipe ou barra fixa. Estados vazios de participantes e observacoes sao compactos.
Local, rota e observacoes ficam dentro do resumo principal. O historico tambem
fica nele quando vazio ou contendo apenas a criacao da demanda; eventos
adicionais ou um evento operacional isolado mantem um card de historico proprio.

O detalhe da operacao, as candidaturas do profissional, o Chat e o painel de
Check-in/Pagamento/Checkout reutilizam `OperationFlow`: Operacao, Contratacao,
Check-in, Pagamento, Checkout e Conclusao. Etapas bloqueadas nao oferecem links
para executar a acao. Sem contratacao, o Chat tambem permanece bloqueado.

A apresentacao usa os registros operacionais existentes: check-in confirmado,
horario de encerramento, pagamento informado, recebimento confirmado pelo
profissional, checkout e ocorrencias. Informar pagamento nao libera checkout:
e necessaria a confirmacao de recebimento. Contestacoes e interrupcoes
permanecem visiveis; falhas de consulta nao liberam etapas por suposicao.
O Chat continua autorizado pelo RPC `get_approved_chat_context`.

As rotas existentes sao preservadas e continuam usando o mesmo painel.
O banco e os RPCs de escrita nao foram alterados. O detalhe e o Chat atualizam
o estado operacional periodicamente e ao recuperar o foco.

Testes focados: `node --test tests/operational-ui.test.mjs tests/demand-detail.test.mjs tests/restaurant-message-ui.test.mjs tests/message-navigation.test.mjs`.

## Privacidade e Preferencias

`/settings/privacy` usa a mesma estrutura para Restaurante e Profissional:
notificacoes, privacidade do perfil, Centro de Talentos, Perfil Verificado e
conta e seguranca. O botao inferior salva em `notification_preferences` e
`privacy_preferences`; valores existentes que nao aparecem na interface sao
preservados. Falhas de carregamento desabilitam o salvamento para evitar
sobrescrever preferencias com valores padrao.

Somente preferencias com persistencia e comportamento existentes recebem
switches. Notificacoes continuam agrupadas pelas categorias atuais de Push:
mensagens, candidaturas, avaliacoes, operacoes (incluindo convites, check-in e
check-out) e eventos/reservas. Esses controles nao apagam os avisos da plataforma.
Endereco profissional nao e oferecido como controle, pois a consulta publica
atual retorna apenas o endereco comercial. Cidade, score e experiencia do
profissional permanecem em mais opcoes de visibilidade.

Talentos oferece atalhos para funcionalidades existentes, sem criar regras
para ocultar profissionais ou bloquear Interesse e convites. A verificacao e
somente status, com atalho para o fluxo de selfie do profissional; nao e
inventado um fluxo de verificacao do estabelecimento. Sessoes ativas nao
aparecem porque nao existe gerenciamento implementado. Alteracao de senha,
documentos legais, exportacao e exclusao de conta sao preservados. O aceite de
documentos nao e exibido nas preferencias; o aceite do cadastro permanece
inalterado. Conta e Seguranca apresenta os cards Seus dados (Exportar dados)
e Zona de Perigo, mantendo senha e confirmacao explicita antes da exclusao.
Permissoes tecnicas do dispositivo nao aparecem nesta tela.

Testes focados: `node --test tests/settings-preferences.test.mjs tests/push-privacy.test.mjs tests/privacy-sql.test.mjs`.

## Perfil unico do profissional

`/worker/profile` e a entrada principal da aba **Perfil**. Reutiliza
`ProfileOverview`, `ProfileEditor` e `ProfileVerification`: dados pessoais,
especialidades, identidade validada e Confianca Operacional permanecem juntos.
**Editar perfil** abre o formulario existente na mesma rota com `?edit=1`;
**Cancelar** volta a visualizacao. Salvar permanece no formulario, com a
confirmacao existente; ao retornar ao perfil os dados sao consultados novamente.

Historico Operacional, notificacoes, privacidade e sair continuam acessiveis
na pagina, reutilizando os links do antigo Mais. A presenca e apresentada pelo
contador existente de check-ins; nenhum score ou calculo operacional mudou.

Compatibilidade mantida, sem excluir paginas:

- `/worker/profile/details` redireciona para `/worker/profile`.
- `/worker/profile/edit` redireciona para `/worker/profile?edit=1`, preservando
  a intencao de editar.
- `/profile` redireciona somente profissionais; restaurantes mantem a tela
  generica atual.
- Os redirecionamentos acontecem no cliente apos a protecao de acesso
  existente, usam substituicao do historico e preservam query/hash, inclusive
  `#verification` e `#confidence`. As secoes aguardam o carregamento dos dados
  para posicionar o atalho. Nao sao novas regras de autenticacao.

Nenhum link interno profissional produz mais os caminhos `details` ou `edit`.
Nao remover as rotas legadas nesta sprint. Uma eventual remocao exige medir
uso externo/URLs de retorno, validar notificacoes e favoritos antigos e manter
uma camada de compatibilidade antes de eliminar as paginas. Nao ha remocao
agendada nem mudanca de notificacoes, banco, RPCs ou Storage nesta entrega.

Testes focados: `node --test tests/worker-profile.test.mjs tests/ui.test.mjs tests/profile-verification.test.mjs tests/restaurant-history.test.mjs tests/communication.test.mjs`.

## Perfil Verificado

Aplicar a migration [20261103000000_verified_profile.sql](supabase/migrations/20261103000000_verified_profile.sql)
antes de publicar esta interface. Ela reutiliza `worker_profiles.verification_status`,
`selfie_verification_path` e o bucket privado `worker-private`, sem novas tabelas,
campos de identidade ou armazenamento paralelo.

Em **Perfil > Perfil Verificado**, o profissional com CPF, RG e telefone salvos
abre a câmera existente, captura, confere a prévia e confirma o envio.
Sem selfie aparece **Perfil não verificado**; com selfie `pending`,
**Verificação em análise**; `rejected` mostra **Revisão necessária** e permite
nova captura, que retorna a `pending`.

WhatsApp, currículo e certificados não fazem parte da experiência do
profissional: não aparecem na visualização, edição, uploads, completude ou
verificação. Telefone, identidade, especialidades, Perfil Verificado e Confiança
Operacional permanecem. As colunas `worker_profiles.whatsapp`, `resume_pdf_path`
e `certificates` e os uploads históricos são preservados, sem novas migrations.
O editor não lê nem grava os campos dos arquivos antigos. O WhatsApp histórico
é mantido internamente para compatibilidade com a coluna `NOT NULL`; novos
perfis salvam uma string vazia, sem input ou validação desse campo.
O WhatsApp do restaurante permanece inalterado.

Se a view `public_user_directory` ainda não expuser `profile_verified`, o provider
oculta temporariamente os selos e registra o erro de coluna ausente (`42703`)
somente no console, sem banner. As consultas periódicas continuam e os selos
voltam a funcionar quando a coluna estiver disponível. Outros erros continuam
visíveis; o fluxo de selfie e revisão permanece inalterado.

A aprovação/rejeição é manual. Um administrador autorizado deve conferir CPF,
RG, telefone e a selfie privada no Supabase e executar, somente em ambiente
administrativo, `review_profile_verification(p_user_id, p_selfie_path, p_status, p_expected_updated_at)`,
com `p_status` igual a `verified` ou `rejected`. A função só é executável por
`service_role` (ou pelo administrador do banco); o caminho e o `updated_at`
conferidos evitam aprovar uma selfie substituída ou dados alterados durante a
revisão. O banco gera o `updated_at`, sem aceitar a data enviada pelo cliente.
Não há painel administrativo ou aprovação
automática no frontend, nem biometria, reconhecimento facial ou prova de vida.
Uma selfie isolada não comprova identidade: o responsável deve definir os
critérios e procedimentos de revisão antes de aprovar.

O navegador não pode escrever o status nem trocar diretamente a referência da
selfie; a RPC de submissão valida propriedade, pré-requisitos e arquivo enviado.
Arquivos de selfies referenciadas não podem ser sobrescritos ou excluídos pelo
profissional; o reenvio usa outro objeto no mesmo bucket e remove o anterior
após registrar a substituição. Falhas de limpeza são notificadas para suporte.
A exclusão de conta já remove todos os arquivos desse bucket.
Alterar CPF, RG ou telefone retorna o status a `pending`, exigindo nova revisão
da identidade com a selfie existente; não altera a Confiança Operacional.

O escudo com check aparece junto aos nomes de profissionais nos perfis,
talentos/candidatos/convidados, conversas, mensagens e telas da operação.
O tooltip funciona por hover, foco, clique e toque. Só o indicador
`public_user_directory.profile_verified` é compartilhado; selfies e documentos
não integram o diretório. As leituras dos selos são agrupadas e atualizadas ao
retornar ao app e a cada minuto. A Confiança Operacional, avaliações, mensagens,
demandas e contratação mantêm suas regras.

**Antes do uso externo:** revisar aprovações históricas (o cliente já teve
permissão de escrever status em versões anteriores), confirmar as policies
implantadas e definir responsável, base legal, critérios de revisão e prazo de
retenção. Esta implementação não certifica conformidade LGPD. Testes focados:
`node --test tests/profile-verification.test.mjs tests/profile-verification-sql.test.mjs tests/ui.test.mjs tests/privacy-sql.test.mjs`.

## Home do contratante

A rota `/restaurant/dashboard` funciona como Central Operacional mobile first:
prioriza presença, pagamento, avaliações pendentes, demandas ativas e futuras.
Candidaturas levam à central da demanda, onde a empresa confere o profissional
e confirma a contratação. Mensagens não lidas continuam abrindo o chat.

A Home separa demandas ativas das futuras (incluindo turnos que atravessam a
meia-noite) e mantém até três conversas recentes, inclusive não lidas.
Não há gráficos, indicadores de desempenho ou relatórios. A foto usa o logo do
perfil do contratante, com inicial quando não há imagem cadastrada.

O botão fixo **+ Criar Demanda** e o menu **Home / Demandas / Talentos /
Mensagens / Equipe / Mais** mantêm os fluxos existentes acessíveis.
`/restaurant/team` (Equipe) acompanha cada contratação até a conclusão, usando
apenas o fluxo operacional existente (`operational_context`): cada card mostra
função, dia, profissional, horário, status e a próxima ação, que abre as telas
atuais de check-in, pagamento, checkout ou avaliação. A ordem é automática:
avaliação obrigatória, pagamento pendente, aguardando confirmação do pagamento,
checkout, código de check-in, em operação, aguardando início (menos de 24 horas)
e futuras. A contratação sai da Equipe após o checkout e a avaliação da empresa;
ausências e abandonos ficam visíveis por 24 horas. Contratações inconsistentes
são ignoradas com aviso no console. Demandas lista os
trabalhos do contratante; os links de candidatos são filtrados por demanda.
`/restaurant/candidates` (Talentos) é organizado pela demanda selecionada
(`?demand=`). As abas Todos, Candidatos, Convidados e Interesses mostram apenas
as pessoas relacionadas a essa demanda; Interesses é independente da demanda.
Os filtros (função, cidade, já trabalhou comigo, favoritos, interesses) ficam
em um painel lateral no desktop e inferior no celular, e os filtros ativos
aparecem como chips removíveis. Sem convidados, a aba Todos sugere até três
profissionais, por ordem de prioridade: favoritos, histórico com a empresa,
avaliação, operações concluídas e função compatível. As sugestões só são
trocadas quando deixam de ser elegíveis. Convites são enviados apenas pelo
perfil do profissional. 👀 Interesse vale para quem nunca trabalhou com a
empresa e ❤️ Favorito para quem já trabalhou; os dois não coexistem. Recusas
de convite aparecem apenas como “Indisponível para esta demanda”. Com todas as
vagas preenchidas, convidar e aprovar ficam desabilitados.
`/restaurant/messages` é a central de comunicação operacional: cada conversa
corresponde a um profissional contratado e a uma operação, com status e mensagens
não lidas. O chat só fica disponível após a aprovação da contratação; não é possível
iniciar uma conversa livremente. O atalho Mensagens em Notificações aponta
diretamente para `/restaurant/messages`. URLs antigas
`/restaurant/candidates#chats` e `/restaurant/candidates?view=messages` são
encaminhadas no cliente para a caixa oficial com substituição do histórico;
outros parâmetros são preservados e o seletor/hash legado é consumido.
Candidatos normais e `?demand=` continuam em Talentos, sem montar outra caixa.
Nenhum aviso persistido, Push ou migration foi alterado para essa compatibilidade.
Mais reúne perfil, histórico, notificações e preferências.
Avaliações pendentes substituem a ação principal de criar demanda por um acesso
direto à avaliação.

A caixa operacional usa `restaurant_operational_message_inbox` quando a função
está disponível no banco. Se a função ainda não estiver no cache do PostgREST, a
tela consulta os mesmos dados de operação, perfil e mensagens por caminhos
protegidos pelas políticas existentes. A migration continua sendo necessária
para usar a consulta consolidada. Em ambos os caminhos, só entram operações cujo
profissional tem role `worker`, diferente do próprio restaurante, e cuja empresa
tem role `restaurant`. Registros inconsistentes são ignorados com um aviso no
console, sem bloquear as demais conversas. A seção “Conversas recentes” da Home
usa a mesma fonte, então só mostra conversas que também aparecem em Mensagens.

Governança técnica: [rotas oficiais e legadas](docs/routes.md),
[arquitetura](docs/architecture.md) e
[relatórios de estabilidade, performance e prioridades](docs/stability-report.md).

## Demandas 2.0

`/restaurant/demands` apresenta cards operacionais, resumo compacto e filtros
Todas, Hoje, Contratando, Em Andamento, Concluídas, Canceladas e Arquivadas. O toque no card
abre `/restaurant/demands/[demandId]`, uma tela completa com a equipe, candidatos,
reservas e ações. Leituras são paginadas para não truncar os totais da empresa.

Uma demanda reúne de **1 a 50 posições** por `jobs.demand_id`. Demandas antigas
mantêm identidade individual: nomes, horários ou locais iguais **não** mesclam
operações independentes. A criação de todas as posições é transacional por
`create_restaurant_demand`. Cada posição mantém os contratos existentes de
candidatura, chat, check-in e checkout. Na área do profissional, as posições
continuam sendo trabalhos individuais.

Antes de utilizar a nova interface, aplicar nesta ordem, em execuções separadas:

1. `supabase/migrations/20261017000000_demand_cancelled_status.sql`
2. `supabase/migrations/20261017010000_operational_demands.sql`
3. `supabase/migrations/20261017020000_demand_control_center.sql`
4. `supabase/migrations/20261017030000_operational_trust.sql`
5. `supabase/migrations/20261017040000_operational_schedule.sql`
6. `supabase/migrations/20261018000000_restaurant_talent_directory.sql`
7. `supabase/migrations/20261018010000_restaurant_operational_message_inbox.sql`
8. `supabase/migrations/20261018020000_talent_interest.sql`

A primeira execução precisa confirmar o novo valor do enum antes da segunda
migration. As regras operacionais são verificadas em PostgreSQL isolado; não são aplicadas
automaticamente ao banco remoto pela interface.

Os números de contratados, candidatos e reserva contam **pessoas distintas**,
sem duplicar quem se candidatou a mais de uma posição. `approve_demand_candidate`
permite contratar um candidato da demanda em uma posição ainda aberta, mesmo
quando a posição original já foi preenchida. Não permite contratar a mesma
pessoa duas vezes na mesma demanda.

- **Verde:** equipe contratada.
- **Amarelo:** equipe incompleta com antecedência.
- **Vermelho:** faltam profissionais a até 24 horas do início, ou há checkout
  pendente após o término. O texto acompanha a cor.
- **Reserva:** indicação explícita da empresa, não uma contratação ou aceite
  automático do profissional. Deve ter a disponibilidade combinada com ele.
- **Concluída:** somente quando todas as posições não canceladas foram concluídas.
  Passar do horário não conclui o trabalho automaticamente.

Editar mantém local e quantidade e só é permitido antes do início, sem
candidaturas, com controle de revisão. Duplicar permite revisar data, horários,
nome, descrição e diária, preserva o snapshot do local e não copia pessoas.
Cancelar requer confirmação e só é permitido sem contratações; operações já
contratadas não são canceladas silenciosamente. Compartilhar usa o navegador ou
copia um resumo com o link de cadastro, sem expor a tela privada da empresa.
O pagamento é externo ao ExtraChef. A empresa registra que pagou; somente a
confirmação de recebimento pelo profissional libera o checkout.

As reservas são incluídas na exportação de dados do titular e removidas na
anonimização da conta. As mutations verificam propriedade da demanda, bloqueiam
contas excluídas e serializam alterações de equipe; os dados existentes de
presença e conversa continuam nas posições individuais.

### Centro operacional da demanda

O detalhe reúne informações, três candidatos mais recentes, equipe, chat,
check-in, pagamento, checkout, observações, endereço e linha do tempo. A lista
completa de candidatos, o perfil e a Rede de Talentos abrem páginas completas,
com um diálogo de confirmação antes da contratação. A substituicao so aparece
quando existe ocorrencia de cancelamento, ausencia ou abandono, sem reabertura.

A Rede de Talentos permite classificar contatos, conhecidos, favoritos e
parceiros; recorrentes são profissionais com pelo menos duas demandas concluídas
com a empresa. Convites geram notificações e aparecem em `/worker/invitations`,
também acessível pelas candidaturas do profissional. **Aceitar um convite gera
uma candidatura pendente**, nunca uma contratação automática. Operações encerradas
ou sem posições abertas recusam novas aceitações e contratações.

A terceira migration registra eventos reais por triggers: criação, edição,
convites e respostas, candidaturas, contratação, reserva, check-in, checkout e
avaliação. O histórico anterior usa apenas timestamps existentes: não inventa
datas de contratação nem confirmações de pagamento. A quarta migration acrescenta
evidências de pagamento, recebimento, chegada, interrupções e reabertura.
Arquivar é permitido somente após concluir ou cancelar; o filtro Arquivadas
permite restaurar a demanda sem apagar equipe ou histórico.

Perfis respeitam compartilhamento de especialidades, experiência, fotos e
pontuação. A avaliação média continua **de 1 a 5**; o Score de Confiança é um
indicador separado, calculado pelas evidências abaixo. Falhas de perfil ou histórico são explícitas e não escondem
o restante da operação. Convites, categorias e eventos entram na exportação
e anonimização dos dados pessoais. O mapa só conecta ao OpenStreetMap após
consentimento; Abrir rota usa o endereço ou coordenadas disponíveis.

### Presença, pagamento e encerramento

- Check-in/checkout não solicitam GPS nem validam raio. Os RPCs antigos de
  presença por coordenadas deixam de estar disponíveis para usuários autenticados.
- No dia do trabalho, o profissional gera um código temporário de oito caracteres.
  Apresenta à empresa, que digita e confirma sua chegada. O horário da validação,
  gerado pelo banco, é a evidência de check-in e classifica antecipação, pontualidade
  (até cinco minutos) ou atraso.
- Cada código vale dez minutos e só pode ser usado uma vez. Cinco tentativas
  incorretas bloqueiam a etapa por dez minutos. Somente quem gera o código consegue
  consultá-lo; a outra parte precisa recebê-lo presencialmente.
- O término do turno, inclusive após meia-noite, muda a apresentação para
  **Trabalho encerrado**. Isso não equivale a checkout ou conclusão.
- A empresa paga fora do aplicativo e seleciona **Confirmar Pagamento**.
  O profissional informa **Não Recebi** ou **Recebi**. Não recebimento notifica a
  empresa e mantém o checkout bloqueado; é possível regularizar e confirmar depois.
- **Recebi** registra valor, profissional e data/hora de recebimento. O código de
  checkout é gerado para a empresa, nunca entregue automaticamente ao profissional.
  Ele digita o código informado pela empresa para concluir.
- Checkout cria pendências de avaliação para as duas partes. Não bloqueia o
  encerramento; o banco impede nova demanda (incluindo duplicação) ou candidatura
  (incluindo aceite de convite que cria candidatura) até as avaliações pendentes.
  A avaliação pede estrelas e se trabalharia/contrataria novamente; comentário
  permanece opcional.
- Após cinco minutos sem chegada confirmada, a ausência fica **pendente**, nunca
  é afirmada automaticamente. A empresa confirma ausência ou valida o check-in
  tardio. Um check-in tardio elimina o estado pendente sem apagar o histórico.
- Cancelamento antes da chegada, ausência confirmada ou abandono durante o trabalho
  preservam a operacao e registram a ocorrencia, sem reabertura automatica.
  A empresa decide encerrar ou convidar substituto entre candidatos anteriores
  a ocorrencia; o aceite ainda exige confirmacao explicita da contratacao.
- Dados legados são preservados. Não é inventado recebimento para checkouts
  anteriores: eles continuam concluídos, mas não contam como uma cadeia completa
  de evidências de pagamento no novo Score.

### Confiança operacional

O cálculo é consultado no banco e não modifica `users.score`, que é legado de
avaliação média. Respeita a preferência existente de compartilhamento de score.

Antes de cinco trabalhos com check-in + recebimento + checkout: Score **70**,
**Em Desenvolvimento**. Depois disso:

`Score = Presença × 0,35 + Pontualidade × 0,25 + Conclusão × 0,15 +
Avaliações × 0,10 + Recontratações × 0,10 + Cancelamentos × 0,05 − Abandonos`

Componentes normalizados de 0 a 100:

- Presença: check-ins / contratações; abandono não conta como presença positiva.
- Pontualidade: média de 100 (antecipado/pontual), 70 (atrasado), 0 (sem presença).
  O índice exibido separadamente é (antecipados + pontuais) / compromissos.
- Conclusão: cadeias completas / contratações.
- Avaliações: média real / 5 × 100; sem avaliação, o componente é zero, mas a UI
  informa ausência de avaliações em vez de inventar uma nota.
- Recontratações: novas contratações após checkout e avaliação positiva explícita
  de trabalhar novamente, pela mesma empresa / trabalhos concluídos, limitado a 100.
- Cancelamentos em 90 dias: até dois = 100; três/quatro = 80; cinco/seis = 60;
  sete ou mais = 40.
- Abandonos confirmados em 180 dias: menos dez por ocorrência, limitado a menos
  trinta. O Score é limitado a 0–100 e arredondado a duas casas.

Faixas: 95+ Excelente; 85+ Muito Confiável; 70+ Confiável; 50+ Em Desenvolvimento;
abaixo de 50 Atenção. Antecipações são contadas, sem bônus fora da fórmula.
O Score é um indicador operacional, não uma probabilidade estatística validada.

### Agenda descontinuada e localizacao das demandas

A interface Agenda/Eventos nao faz mais parte do produto. Novas demandas usam
automaticamente o endereco principal do restaurante, convertido em um local
padrao interno de `work_locations`, sem evento ou cadastro manual de local.
Perfil sem endereco valido bloqueia a publicacao com erro explicito.

Aplicar `20261019000000_demand_restaurant_location.sql` antes do novo frontend.
Nenhuma tabela, migration historica, RLS ou constraint e removida. Os caminhos
legados das RPCs e snapshots existentes permanecem compativeis.
Ver [plano de implantacao e relatorio](docs/agenda-retirement-report.md).

### Agendamento e implantação

Aplicar todas as migrations anteriores antes das novas, em ordem. A migration
`20261017040000_operational_schedule.sql` exige **pg_cron** no Supabase e agenda
`process_operational_schedule()` a cada minuto. Se a extensão não estiver
disponível, a migration falha explicitamente: habilite o Supabase Cron antes de
reaplicar. Não basta deixar uma aba aberta para enviar lembretes.

O agendamento gera uma única notificação por compromisso na véspera, ausência
pendente após tolerância e término do turno. Usa `America/Sao_Paulo`, como os
horários existentes. A consulta da operação também deriva o estado do horário,
sem depender do cron para bloquear pagamento antecipado. A entrega push continua
dependendo da configuração existente de notificações; o cron persiste os eventos.

Teste o agendador com `SELECT public.process_operational_schedule();` no SQL Editor
administrativo. Confira o job `extrachef-operational-minute` no Supabase Cron e seu
histórico de execuções. Códigos não entram na exportação da conta.

Validação focada:

```bash
node --test tests/operational-ui.test.mjs tests/operational-trust-sql.test.mjs tests/demand-detail.test.mjs tests/demands.test.mjs tests/demands-sql.test.mjs tests/restaurant-home.test.mjs tests/ui.test.mjs tests/communication.test.mjs
npm run typecheck
npm run build
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
