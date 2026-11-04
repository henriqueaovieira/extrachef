# Arquitetura atual do ExtraChef

## Escopo e fontes de verdade

Mapa tecnico do worktree local apos consolidacoes de perfil e mensagens.
Nao comprova qual commit esta em producao, nem quais migrations estao aplicadas
remotamente. Esta sprint nao altera infraestrutura, schema ou regras de negocio.
Os [contratos de rotas](./routes.md) distinguem experiencias oficiais e legados.

## Areas e componentes principais

| Area | Entradas / componentes | Responsabilidade |
| --- | --- | --- |
| Shell / navegacao | [RootLayout](../app/layout.tsx), [MobileBottomNav](../app/components/mobile-bottom-nav.tsx), [MoreNavigation](../app/components/more-navigation.tsx), [DashboardIdentity](../app/components/dashboard-identity.tsx) | Estrutura comum, papel, menus, avatares e destinos canonicos. |
| Conta | [Proxy](../proxy.ts), [SessionGuard](../app/components/session-guard.tsx), [auth/routes](../lib/auth/routes.ts), login/register/callback | Validacao de sessao/papel, retornos autorizados e recuperacao. Camadas servidor/cliente complementares, nao duplicatas removiveis. |
| Perfil profissional | [WorkerProfileExperience](../app/components/worker-profile-experience.tsx), [ProfileOverview](../app/components/profile-overview.tsx), [ProfileEditor](../app/components/profile-editor.tsx) | Uma rota principal; leitura e formulario existentes, foto e atalhos de conta. |
| Identidade privada | [ProfileVerification](../app/components/profile-verification.tsx), [CameraCapture](../app/components/camera-capture.tsx), [profile-verification](../lib/profile-verification.ts) | Requisitos, selfie, previa/confirmacao, submissao e estados existentes. |
| Selo publico | [ProfessionalVerificationProvider](../app/components/professional-verification.tsx), [VerifiedProfileBadge](../app/components/verified-profile-badge.tsx) | Leitura em lotes do sinal publico, resolucao por usuario/job e selo acessivel. Nao expor selfie ou documentos. |
| Confianca operacional | [OperationalReputationView](../app/components/operational-reputation.tsx), [operations](../lib/operations.ts) | Apresentar indicadores calculados pelo contrato operacional. Nao confundir identidade com desempenho. |
| Perfil restaurante | Mesmos Overview/Editor com papel restaurante | Dados e midias da empresa; WhatsApp restaurante continua ativo. |
| Demandas | [demands](../lib/demands.ts), [DemandCard](../app/components/demand-card.tsx), [DemandDetail](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Criacao/edicao/duplicacao, resumo, candidatos, contratados e acoes contextuais conforme regras existentes. |
| Talentos / equipe | [TalentCenter](../app/restaurant/candidates/talent-center.tsx), [DemandTalentNetwork](../app/components/demand-talent-network.tsx), [DemandPerson](../app/components/demand-person.tsx), [TeamCenter](../app/restaurant/team/team-center.tsx) | Busca, relacionamentos, convite/contratacao e acompanhamento global ou por demanda. |
| Mensagens | [RestaurantMessageCenter](../app/restaurant/messages/message-center.tsx), [restaurant-message-inbox](../lib/restaurant-message-inbox.ts), worker/messages, [ChatClient](../app/chat/[jobId]/chat-client.tsx) | Caixas por papel e conversa contratada por job. Apenas `/restaurant/messages` monta a caixa do restaurante. |
| Comunicacao global | [NotificationExperience](../app/components/notification-experience.tsx), [communication-state](../app/components/communication-state.tsx), [NotificationCenter](../app/components/notification-center.tsx) | Contadores, Realtime, previews/resposta rapida versus lista de avisos. Nao sao o mesmo produto visual. |
| Presenca / pagamento / encerramento | [OperationalPanel](../app/components/operational-panel.tsx), wrappers checkin/payment/checkout | Etapas/codigos/GPS/pagamento existentes; limites de negocio intactos. |
| Direitos e preferencias | [PrivacySettings](../app/components/privacy-settings.tsx), [AccountRights](../app/components/account-rights.tsx), APIs de conta | Preferencias, exportacao e exclusao autenticadas, nao limpeza de legados. |
| UI | [Primitivas](../app/components/ui/index.tsx), [mascaras](../lib/ui/input-masks.ts), [progresso](../lib/ui/profile-progress.ts) | Campos, botoes, erros/loading/vazios e completude exclusivamente visual. |

## Fluxos criticos e limites

### Perfil

```text
aba Perfil / avatar
  -> /worker/profile
     -> ProfileOverview -> identidade privada + confianca operacional
     -> ?edit=1 -> ProfileEditor existente
        -> cancelar -> ProfileOverview remonta e consulta novamente
```

O editor mantem seus contratos de gravacao, validacao e uploads. Os campos
historicos profissionais sao [LEGACY_FIELDS](./legacy-fields.md); ausencia de
interface nao autoriza apagar coluna, referencia ou objeto.

### Mensagens

```text
menu / notificacoes -> /restaurant/messages -> RestaurantMessageCenter
URL antiga em candidates -> replace cliente -> /restaurant/messages
caixa / Home / equipe / detalhe / aviso -> /chat/{jobId}
```

Candidates com `?demand=` continua sendo Talentos. `#chats` e `?view=messages`
sao apenas compatibilidade de entrada; nao montam outra caixa e nao mudam dados.
O helper de inbox usa RPC existente e fallback de compatibilidade somente
quando a funcao esta ausente. Essa logica nao foi removida ou alterada.

### Operacao

Demanda -> candidatura/convite -> aprovacao -> conversa/chegada -> check-in ->
trabalho -> pagamento/confirmacao -> checkout -> avaliacao.

O fluxo e descrito para governanca, nao reimplementado aqui. RPCs e regras no
backend continuam autoritativas; drawers, cards e dashboards sao projecoes.
Nao eliminar URLs operacionais porque montam o mesmo painel.

### Identidade versus reputacao

O fluxo privado verifica CPF/RG/telefone/selfie e exibe estados oficiais.
O provider consulta somente `profile_verified`, com refresh e tratamento de erro.
O selo nao e garantia de comparecimento. A confianca deriva de registros de
servico e nao de WhatsApp, curriculo, certificados ou numero de uploads.

## Integracoes

| Integracao | Mecanismo existente | Restricao de manutencao |
| --- | --- | --- |
| Supabase Auth | Clientes SSR/browser, proxy e callback | Nao alterar autenticacao nesta sprint. |
| Supabase PostgREST/RPC | Consultas por papel e operacoes de negocio | Nao alterar schema, migrations, RPCs ou permissoes. |
| Supabase Realtime | Mensagens, contadores, contextos operacionais | Avaliar custo sem mudar recebimento/push como efeito colateral. |
| Supabase Storage | `worker-private` (foto/selfie e historico), `restaurant-assets` (midias da empresa) | Buckets ativos; URLs assinadas e cleanup autenticado existentes preservados. |
| Web Push / service worker | APIs push, webhook e [sw.js](../public/sw.js) | Push nao depende de link JSX; nenhum payload ou entrega alterado. |
| Geocodificacao / mapas | [API geocode](../app/api/geocode/route.ts), helpers de local e links externos | Localizacao automatica ativa; nao apagar catalogos por formulario retirado. |
| Capacitor / Android | Configuracao e projeto Android | Validar upgrades web/nativo separadamente; nenhum upgrade executado. |
| Next.js / React | App Router, prerender parcial, providers e componentes cliente | Ler docs da versao instalada; build nao equivale a teste autenticado real. |

## Governanca e responsabilidades

Responsaveis funcionais em [routes.md](./routes.md) sao areas, nao pessoas.
Nomear owners no repositorio e uma decisao futura do mantenedor.

- Extrair apresentacao quando houver contrato comum comprovado; nao criar
  segunda fonte de verdade de contratacao, presenca, identidade ou notificacoes.
- Preservar diferenca entre erro, loading, indisponibilidade, privacidade e vazio.
- Medir bundle/rede/render antes de memoizar ou introduzir cache compartilhado.
- Nao usar contagem de linhas como prova de bug; e indicador de risco de manutencao.
- Testes SQL usam ambiente isolado, nao devem executar migrations no banco remoto
  para validar uma consolidacao de interface.
- Alteracoes preexistentes devem ser distinguidas da sprint atual por baseline;
  worktree, commit e deployment podem ser diferentes.

Inventarios, evidencias, prioridades e plano de atualizacao sem upgrades:
[relatorio de estabilidade](./stability-report.md).
