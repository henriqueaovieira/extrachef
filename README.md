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
iniciar uma conversa livremente. Mais reúne perfil, agenda, locais e preferências.
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
com um diálogo de confirmação antes da contratação. A reserva só aparece
quando existe posição reaberta por cancelamento, ausência ou abandono.

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
  preservam a posição original, registram a ocorrência e abrem uma posição de
  substituição na mesma demanda. Candidaturas pendentes são transferidas, não
  apagadas. Alternativas usam apenas confiabilidade compartilhada e histórico
  registrado; a empresa ainda precisa confirmar disponibilidade e contratação.
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
