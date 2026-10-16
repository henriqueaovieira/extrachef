# ExtraChef: auditoria visual e Design System

## Escopo

Padronizacao de UX e apresentacao sobre os componentes existentes, sem novas tabelas,
APIs de negocio ou alteracoes de policies/autenticacao. Nao foram criados fluxos de
recuperacao/troca de senha, que nao existem no projeto atual.
Os handlers e as validacoes de negocio foram preservados. O retorno da publicacao de
vaga recebe apenas `feedback=job_created` para apresentar confirmacao no dashboard.

## Auditoria antes da implementacao

| Superficie | Problema encontrado | Tratamento |
| --- | --- | --- |
| Inputs e formularios | Classes repetidas em login, cadastro, eventos, perfil, vagas e chat | Controles nativos encapsulados em uma base compartilhada |
| Placeholders | `text-gray-400` e cores implicitas pouco legiveis | Token explicito de texto secundario e placeholder, opacidade 1 |
| Labels | Login/cadastro/vagas com label separado sem `htmlFor` | Associacao explicita com IDs; labels envolventes preservados no perfil |
| Senha | Somente input password, sem visibilidade | Toggle acessivel sem submit, mantendo autocomplete e valor |
| Cores | CSS de modo escuro contradizia paginas claras e viewport light | Tema claro consistente, sem implementar tema escuro incompleto |
| Tipografia | Fonte Geist carregada, mas body forcava Arial | Usar a fonte ja instalada, sem nova dependencia |
| Botoes | Estilos repetidos, formas diferentes e icones de 36/40 px | Primitiva comum, variantes e alvo minimo de 44 px |
| Cards | Bordas, sombras e raios repetidos | Token e Card compartilhado nas superficies migradas |
| Badges | Estilos diferentes para estados equivalentes | Badge com tom semantico, preservando rotulos e status |
| Feedback | Mensagens soltas, blocos diferentes e falta de confirmacao ao voltar de criar vaga | Toast comum para feedback local e notificacao flutuante existente |
| Carregamento | Paragrafos isolados de carregamento | Skeleton com descricao acessivel e shimmer reduzivel |
| Vazio | Mensagem sem orientacao/contexto | EmptyState com descricao e acao existente quando apropriado |
| Mobile | Cidade/telefone lado a lado em tela estreita; teclados inconsistentes | Empilhar no mobile; inputMode/autocomplete e mascaras brasileiras |
| Perfil | Ausencia de orientacao de preenchimento | Progresso apenas visual usando os dados existentes, sem bloquear acoes |
| Safe area | Bottom nav tratava base; faltava viewport cover e margem superior/lateral global | Viewport cover, insets de body/nav e ajustes de overlays |
| Dialogos | Exclusao usa confirmacao nativa; camera e popup sao nao modais | Preservar mecanismo existente; nao adicionar modal paralelo |
| Teclado | Estrelas com semantica radio, mas sem setas | Tab unico no grupo, setas para navegar/selecionar |

## Componentes e contratos

Implementacao em [ui/index.tsx](../app/components/ui/index.tsx).
Todos os inputs, textareas, selects e botoes HTML da aplicacao passam por essas primitivas.
O teste de adocao evita a reintroducao de controles nativos fora dessa base.
Wrappers de pagina, tabelas, links de navegacao e cards de indicadores especificos mantem seus layouts.

| Componente | Uso |
| --- | --- |
| Button | `variant`: primary, secondary, ghost, danger; `busy` adiciona spinner e aria-busy sem apagar rotulo |
| TextInput | Props nativas, restricoes/handlers preservados; base visual compartilhada |
| PasswordInput | Mostrar/ocultar, aria-controls/pressed, botao nao envia formulario |
| TextArea | Mesmo contraste e foco de TextInput; permite redimensionamento vertical |
| Select | Select nativo, incluindo navegacao por teclado e selecao no sistema mobile |
| Card | Superficie comum; `as` preserva section/article/div conforme contexto |
| Badge | neutral, success, warning, danger; texto sempre explicita o estado |
| Toast | success/error/info; erro usa alert, demais usam status; fechamento opcional |
| EmptyState | Icone decorativo, titulo, orientacao e acao ja existente |
| LoadingSkeleton | Texto para leitor de tela e linhas decorativas; respeita reduced-motion |
| MaskedInput | cpf/cnpj/phone/postal-code, digitacao/colagem, restauracao de cursor |

Nao foi criado outro sistema global de notificacoes.
O componente de experiencia de notificacao existente reutiliza Toast; erros de formulario
continuam proximos ao contexto, sem desaparecer automaticamente durante a correcao.
Os avisos flutuantes mantem seu comportamento existente e podem ser fechados.

Exemplo:

```tsx
<label htmlFor="event-title">Nome do evento</label>
<TextInput id="event-title" required minLength={2} maxLength={160} />
<Button type="submit" variant="primary" busy={saving}>
  {saving ? 'Salvando...' : 'Criar evento'}
</Button>
```

Passar `type="submit"` explicitamente para a acao de envio; Button padrao usa `button`.
Usar classes adicionais para layout, nao copiar novamente cor/borda/foco dos campos.
As variantes secondary/ghost ficam na camada de componentes para permitir estados selecionados
de controles existentes sem sobrescrever suas classes condicionais.

## Tokens visuais e acessibilidade

Definidos em [globals.css](../app/globals.css):

- Fundo: `#f7f8fa`; superficie: branco; texto: `#182230`.
- Marca/acao principal: `#b9470d`; hover: `#95390b`.
- Texto secundario/placeholder: `#526071`; borda de campo: `#8994a3`.
- Controles com 16 px, altura minima de 48 px e borda visivel.
- Botoes com alvos minimos de 44 x 44 px, incluindo mostrar senha e fechar avisos.
- Raios, sombras, foco e animacoes centralizados; foco nao depende apenas de mudar a cor.
- Texto e placeholder sobre branco e texto branco na marca testados em >= 4.5:1.
- Limite de campo sobre branco testado em >= 3:1.
- Tema claro intencional, inclusive quando o SO solicita modo escuro.
- Nao foi desabilitado zoom do navegador.
- `prefers-reduced-motion: reduce` remove shimmer, spinner/transicoes e entradas animadas.
- Regioes de feedback possuem semantica alert/status; progresso tem nome acessivel.
- Notificacao expansivel pode fechar por Escape e devolve foco ao gatilho.

Esses testes dos tokens nao constituem certificacao WCAG de toda a aplicacao.
Imagens, combinacoes dinamicas, leitor de tela e estados remotos ainda precisam de homologacao.

## Mascaras e compatibilidade de dados

Funcoes puras em [input-masks.ts](../lib/ui/input-masks.ts):

- CPF: `123.456.789-01`.
- CNPJ: `12.345.678/0001-90`.
- Telefone: `(11) 98765-4321` ou fixo `(11) 3456-7890`; prefixo brasileiro +55 quando informado.
- CEP: `01310-930`.
- Data: controle nativo `type=date`, formato visual definido pelo navegador/idioma,
  valor de formulario preservado em ISO `YYYY-MM-DD`.

Nao foi criada mascara textual dd/mm/aaaa que mudaria o payload de data ou perderia
min/max e seletor nativo mobile. Horarios continuam controles nativos time.
CPF/CNPJ continuam normalizados e validados pelo fluxo existente no salvamento.
Mascaras sao ajuda de preenchimento, nao validacao de identidade.
O progresso contabiliza presenca, nao validade ou verificacao dos documentos.
No editor ele acompanha dados ainda nao salvos; no resumo ele usa dados carregados.

## Arquivos alterados por esta etapa

### Base e helpers

- [Design System](../app/components/ui/index.tsx)
- [Tokens e estilos](../app/globals.css)
- [Layout/viewport](../app/layout.tsx)
- [Mascaras](../lib/ui/input-masks.ts)
- [Calculo visual de progresso](../lib/ui/profile-progress.ts)
- [Indicador de perfil](../app/components/profile-progress.tsx)
- [Confirmacao apos criar vaga](../app/components/route-feedback.tsx)
- [Testes UI](../tests/ui.test.mjs)

### Telas e componentes existentes migrados

- [Login](../app/login/page.tsx), [Cadastro](../app/register/page.tsx), [Perfil generico](../app/profile/page.tsx).
- [Editor de perfil](../app/components/profile-editor.tsx), [Resumo de perfil](../app/components/profile-overview.tsx), [Camera](../app/components/camera-capture.tsx), [Logout](../app/components/logout-button.tsx).
- [Eventos](../app/components/restaurant-events.tsx), [Criar vaga](../app/restaurant/dashboard/jobs/create/page.tsx), [Dashboard restaurante](../app/restaurant/dashboard/page.tsx).
- [Candidatos](../app/restaurant/candidates/page.tsx), [Dashboard worker](../app/worker/dashboard/page.tsx), [Candidaturas](../app/worker/applications/page.tsx).
- [Chat](../app/chat/[jobId]/chat-client.tsx), [Fallback chat](../app/chat/[jobId]/page.tsx).
- [Check-in](../app/checkin/[jobId]/checkin-client.tsx), [Fallback check-in](../app/checkin/[jobId]/page.tsx).
- [Check-out](../app/checkout/[jobId]/checkout-client.tsx), [Fallback check-out](../app/checkout/[jobId]/page.tsx).
- [Avaliacao](../app/reviews/[jobId]/review-client.tsx), [Fallback avaliacao](../app/reviews/[jobId]/page.tsx).
- [Central de notificacoes](../app/components/notification-center.tsx), [Sino](../app/components/notification-bell.tsx), [Experiencia de notificacoes](../app/components/notification-experience.tsx).
- [Preferencias](../app/components/privacy-settings.tsx), [Controle Push](../app/components/push-notification-control.tsx), [Instalacao PWA](../app/components/pwa-install-prompt.tsx).
- [Navegacao mobile](../app/components/mobile-bottom-nav.tsx), [Guarda de sessao](../app/components/session-guard.tsx) (somente controles/fallback visual).

Nenhuma mudanca desta etapa em SQL, policies, APIs de autenticacao ou regras de acesso.
O repositorio ja tinha alteracoes anteriores nessas areas; elas nao foram revertidas.

## Validacao executada

- Testes unitarios: mascaras completas/parciais/coladas, limites, idempotencia e progresso.
- Renderizacao dos componentes: senha inicialmente oculta, toggle button, autocomplete,
  busy/disabled e preservacao de tipos/constraints de data/numero.
- Verificacao automatica de adocao dos controles e contraste dos tokens CSS reais.
- Regressao dos testes existentes de rotas, proxy, cookies e provisionamento.
- Navegador local: mostrar/ocultar preserva valor; toggle nao submete formulario.
- Cadastro nas larguras 360, 390, 430 e 1280: sem overflow horizontal, campos de 16 px,
  botoes >= 44 px e labels associados.
- Eventos nas larguras 360, 390 e 430: sem overflow horizontal e botoes >= 44 px.
- Formulario de eventos: tipos nativos e labels presentes.
- Editor restaurante: CNPJ/telefone/CEP formatados, exclusao de digito, labels e progresso
  presentes, sem overflow em 390 px. Dados de teste nao foram salvos.
- Emulacao reduced-motion: transition-duration observado como 0s.

Nao foram criados registros, alteradas contas ou enviados formularios durante os testes visuais.
Dispositivos fisicos, teclado virtual real, VoiceOver/TalkBack e push em PWA nao foram certificados.
O servidor dev exibiu avisos de instant-navigation das rotas protegidas e falhas de requisicoes
do modulo de notificacoes; nao foram ocultados ou corrigidos fora deste escopo.
Esses avisos devem ser investigados separadamente, sem alterar as regras Auth nesta tarefa.

### Comandos

```powershell
node --test tests\ui.test.mjs tests\auth-routes.test.mjs tests\auth-proxy.test.mjs
$env:EXTRACHEF_TEST_URL = 'http://localhost:3000'
node --test tests\auth-http.test.mjs
npm run lint
npm run typecheck
npm run build
```

## Checklist de homologacao

- [ ] iPhone Safari/PWA: notch, Dynamic Island, orientacao horizontal e teclado aberto.
- [ ] Android Chrome/PWA: retorno do teclado, botao voltar e safe area inferior.
- [ ] Zoom 200%, font scaling e conteudo longo sem sobreposicao.
- [ ] VoiceOver/TalkBack: labels, campo senha, feedback, progresso e ordem de leitura.
- [ ] Teclado desktop: foco visivel, Tab/Shift+Tab, Escape no sino e setas nas estrelas.
- [ ] CPF/CNPJ invalidos continuam recusados ao salvar; mascara nao burla validacao.
- [ ] Datas/horarios enviados no mesmo formato anterior em todos os navegadores.
- [ ] Cadastro/login/redirects e sessao continuam funcionando sem mudanca de regras.
- [ ] Submissoes reais em homologacao: evento, vaga, candidatura, perfil e avaliacao.
- [ ] Estados de erro/rede lenta, loading e vazio em cada papel.
- [ ] Popup, toast e teclado nao cobrem a resposta rapida em dispositivos reais.
- [ ] Imagens/arquivos longos e formularios de perfil worker em aparelho real.
