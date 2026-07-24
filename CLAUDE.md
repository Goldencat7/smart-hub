# REMAX Smart Hub — contexto do projeto

App **Electron** (desktop Windows) da imobiliária REMAX Smart. Dá acesso rápido às
plataformas de trabalho com **autologin**, e é o hub interno da equipe: **login próprio**
(Firebase, com 2FA), **Gestão de Locações** (Painel + Imóveis, liberada por permissão),
**Marketing** (templates editáveis), **fichas** cadastrais (web), **agenda**, **calculadoras**,
**bloco de notas** e uma **área admin**. Versão publicada atual: **1.0.103** (auto-update via GitHub Releases).

## Stack

- **Electron** (`main.js` = processo principal, `preload.js` = bridge IPC).
- Renderer (telas): `login.html`+`auth-login.js`, `index.html`+`hub-app.js`, `admin.html`+`admin-app.js`. CSS único em `styles.css`.
- **Firebase**: Auth (email/senha), Firestore, Cloud Functions v2 (Node 22) em `functions/index.js`, região **southamerica-east1**. Config pública em `firebase-env.js` (resolvida por hostname — ver "Config por ambiente"; a cópia `public/firebase-env.js` atende as fichas).
- Projeto Firebase: `remax-smart-hub`. Repo GitHub **público**: `Goldencat7/remax-smart-hub`.

## Segurança (regras importantes — NÃO quebrar)

- **Senhas dos sistemas NÃO ficam no código** — ficam no Firestore (`credentials/{siteKey}`) e só saem pela Cloud Function `getCredentials` (usuário autenticado). Autologin injeta no site e **nunca revela a senha** (campo de senha é "blindado": observer força `type=password` + bloqueia o "olho").
- **Conta só por convite**: criação via `criarContaComCodigo` (valida código). Por isso "logado = convidado" e o `getCredentials` pode confiar em qualquer autenticado.
  - ⚠️ **Isso SÓ é verdade porque o cadastro pelo cliente está BLOQUEADO** (fechado em 2026-07-14).
    Até então, o endpoint público `accounts:signUp` da apiKey (que é pública e está no repo) aceitava
    **qualquer** e-mail — um estranho criava conta sem convite, logava e o `getCredentials` entregava
    as senhas dos sistemas. Descoberto ao investigar um alerta do GitGuardian (a apiKey NÃO é segredo;
    o alerta é falso positivo — o buraco era o cadastro aberto, não a chave).
  - **Trava**: Identity Platform → `config.client.permissions.disabledUserSignup = true`
    (`PATCH .../admin/v2/projects/remax-smart-hub/config`, `updateMask=client.permissions.disabledUserSignup`).
    Efeito: `signUp` do cliente → `ADMIN_ONLY_OPERATION`; **login** (`signInWithPassword`) intacto;
    **convite** (`criarContaComCodigo`, Admin SDK) intacto — o Admin SDK ignora essa trava. Tudo
    verificado por sonda em produção. Reversível (mesma chamada com `false`).
  - **Próxima camada recomendada** (defesa em profundidade, só Cloud Functions): `criarContaComCodigo`
    carimba uma claim `membro:true` e o `getCredentials` passa a EXIGIR essa claim, em vez de confiar
    em "qualquer autenticado". Assim, se o cadastro reabrir por acidente, ninguém tira credencial.
- **Admin** via custom claim `admin`. Bootstrap admin UID: `OwcT6wCrXMgJ0tPADMUdKdBB8h32` (em `functions/index.js` e `hub-app.js`).
- **Apps restritos** (ex.: ClickSign): só aparecem pra quem o admin liberar (coleção `user_access/{uid}`). Admin libera em Admin → Usuários → Permissões.
- **Permissões granulares por pessoa** (concedidas no painel de Admin, nunca elevação em bloco): `marketing_gerenciar` (editar Marketing — NÃO herda de admin), `ti` (Suporte), `drives_fotografia`, `analise_locador`, `loc_gestao` (vê a aba Locação inteira — Painel + Imóveis; NÃO herda de admin). Existe também `loc_beta` (antigo dark launch), hoje **inerte** — ver "Dívida técnica intencional". Perfil de Locação = claim `locRole` (gestor/administrativo/corretor) + `loc_financeiro`.
- **Escrita das coleções de Locação = SEMPRE via Cloud Function** (Admin SDK). Regras do Firestore negam write do cliente; leitura filtrada por `corretorUid` (regra de ouro). Idem cobranças/repasses (integridade do financeiro).
- **Escrita das fichas = SEMPRE via Cloud Function** (`salvarFichaPublica`), mesma regra de ouro. O cliente preenche sem login, mas não grava direto: a function valida tamanho, tipo dos campos, e que cada anexo aponta pro nosso bucket (`fichas/<tipo>/…` ou `fichas-locador/…`). `corretorUid`, `tipo` e `status` são decididos no servidor. **Leitura** por id ainda é aberta (`allow get: if true`) — o id é a credencial, como nos portais; fechar isso exige token e é o próximo passo.
  - **✅ FECHADO (2026-07-14, v1.0.100).** As regras `write: if false` **estão no ar**. A escrita direta
    do cliente na coleção `fichas` agora devolve `PERMISSION_DENIED` — testado em produção. A
    `salvarFichaPublica` continua funcionando (o Admin SDK **ignora** as regras; o smoke test bate na
    validação dela, não em permissão). O que segurava esse deploy era o `.exe` antigo, que carregava a
    ficha do **disco** (cópia congelada no build, e a de 1.0.91 ainda usava `addDoc`); desde a 1.0.100 a
    ficha vem **sempre do Hosting**, então versão velha de ficha não existe mais em máquina nenhuma.
    Junto subiu outra mudança que já estava no arquivo: `locGestor()` **não herda mais de `admin`**
    (alinha com "permissão granular por pessoa"). Não quebra tela — **nenhuma** tela lê as coleções de
    Locação pelo SDK do cliente; tudo passa por Cloud Function.
  - **Leitura** por id segue aberta (`allow get: if true`) — o id é a credencial, como nos portais.
    Fechar isso exige token de acesso e é o próximo passo.
- **Portais externos** (proprietário/inquilino) são PÚBLICOS, sem login: o **token** (`portal_tokens`, `crypto.randomBytes`) é a credencial; cada função devolve só os dados daquela pessoa. **Anonymous Auth NUNCA pode ser habilitado** (o `getCredentials` confia em qualquer autenticado).
- **2FA (TOTP)** via Firebase MFA; **credenciais dos sistemas criptografadas** (KMS) em repouso; **auditoria** (`registrarAudit` → `audit_log`); **backup Firestore diário** (`gs://remax-smart-hub-backups/`, retenção 30d).

## Apps / autologin

- Catálogo em `hub-app.js` (array `APPS`): chave, categoria, título, url, `autologin`, `restrito`.
- Config de seletores de login por site em `main.js` (objeto `configs`). Sites ASP.NET, 2 etapas, CAPTCHA são tratados lá.
- **ClickSign**: app restrito; admin abre com login próprio; não-admin liberado usa conta compartilhada (autologin **preenche mas NÃO envia** — `naoEnviar: true` — por causa do reCAPTCHA; a pessoa resolve o captcha e clica Entrar). Credenciais por pessoa: CheckVisto e Motiva (esses não têm autologin).
- **Aviso de status com saída pelo navegador** (v1.0.98): quando o admin marca um app como
  *Instável/Em manutenção* (Admin → Status dos apps), o Hub mostra um **modal** (não mais `alert()`,
  que não aceita botão). Se o app tiver `linkNavegador` no catálogo (`APPS` do `hub-app.js`), o aviso
  oferece **"🌐 Abrir no navegador ↗"** — abre no Chrome/Edge do Windows via `shell.openExternal`
  (IPC `abrir-no-navegador`), fora da janela do Electron. Hoje só o **CheckVisto** usa isso: a janela
  nativa dele dentro do Hub não está confiável, então o aviso de manutenção vira também a saída.
  Pra dar essa saída a outro app, é só acrescentar `linkNavegador` na entrada dele em `APPS`.

## Funcionalidades

- **Sidebar** (`CATEGORIAS` em `hub-app.js`): Captação, CRM, Vistoria, **Locação** (Gestão de Locações), Performance, Treinamento, **Marketing**, ClickSign, Agenda, **Cadastro** (fichas), Fotografia, Reunião, Sala de Reunião, IA, Calculadoras, Bloco de Notas, WhatsApp, Suporte/TI, Configurações. Categorias podem ser ocultadas por permissão (`soTI`, `beta`, etc.) ou serem "app direto".
- **Gestão de Locações** (aba Locação): módulo completo — captação (ficha do locador vira imóvel na esteira) → análise do locatário + garantia → contrato → cobrança/repasse → vistorias → alertas → relatórios (com export CSV). **Versão enxuta (pedido do chefe, v1.0.90):** sub-apps = só **Painel** e **Imóveis**.
  - **Imóveis = Carteira de Imóveis** (reestruturação 2026-07-15, spec "Tela 01 – Carteira de Imóveis" MVP; **só no STAGING por enquanto**, produção continua na tela antiga até o `.exe`/PWA de produção serem publicados): visão comercial em tabela — 6 fichas com Copiar Link (Comprador=ficha-proposta, Fiador=ficha-locacao-fiador), 6 indicadores, pesquisa incremental, filtros (finalidade/situação/corretor), modal + Novo Imóvel (Enviar Ficha | Cadastro Manual), interessados, arquivamento (nunca exclui). Modelo: `imoveis` ganhou `finalidade` (locacao|venda|venda_locacao), `situacao` (disponivel|em_negociacao), `arquivado`, `interessados[]`, `proprietarioNome`; a **esteira (`status`) virou detalhe** do imóvel de locação (o "Mover para" do gestor vive dentro do Abrir). Legado sem finalidade = locação, situação derivada da esteira (em_contrato/ativo ⇒ em negociação) — sem migração. Functions: `carteiraSalvarImovel`/`carteiraArquivar`/`carteiraSituacao`/`carteiraInteressado` (+posse: corretor só os seus, broker tudo) e trigger `onFichaVendedorEnviadaAdmin` (ficha do vendedor ⇒ imóvel de venda; a ficha usa as mesmas chaves `im_*`). Venda pura não tem esteira (sem `status`). Financeiro/Alertas/Relatórios saíram da UI (as Cloud Functions `locFinanceiro`/`locListarAlertas`/`locRelatorios` continuam no backend, só não têm mais tela) e as **fichas voltaram pro Cadastro**. **Visibilidade**: a aba Locação inteira só aparece com a permissão `loc_gestao` (por pessoa no Admin, não herda de admin). **Checklist automático** (6 itens marcam sozinhos; esteira avança até "Aprovado" sozinha). **Portais externos** (Fase 1.5): proprietário vê repasses, inquilino vê pagamentos — por link/token, sem login (`public/portal-proprietario.html`, `portal-inquilino.html`). Detalhes completos na memória `project-gestao-locacoes`. Fase 2 (bancária) em `FASE-2-INTEGRACAO-BANCARIA.md`.
  - **Tela 03 — Detalhes do Imóvel + Negócios (fundação)** (2026-07-16, **só no staging**; specs do Drive em `C:\Users\Natha\Downloads\SMART-HUB-DRIVE`, mockups em pastas T-01..T-06): "Abrir" na Carteira leva a tela cheia — resumo + abas **Informações / Proprietário / Interessados / Histórico / Gestão da Locação** (esta herda o detalhe antigo inteiro: análise, garantia, contrato, vistorias, esteira — nada se perdeu; `renderDetalheImovel(d, true)` devolve os blocos por aba). **Interessados têm status** (`ficha_enviada→ficha_recebida→em_analise→aprovado|reprovado|desistiu→negocio_gerado`); aprovar/reprovar = SÓ gestor (Manual de Regras: decisão do Broker). **Negócio**: `negocioGerar` (só gestor, só interessado aprovado, só 1 ativo por imóvel) cria doc em `negocios` com código `NG-000001` (counter transacional `counters/negocios`), checklist-modelo por tipo (13 etapas locação / 18 venda, spec 04B; `obrigatoria:true` nas 7-8 primeiras trava o futuro "Entregar para Gestão"), `proximaAcao`, timeline própria; interessado vira Negócio Gerado e imóvel entra Em Negociação. `negocioListar` já existe (base da Tela 04A). **Timeline do imóvel** (`imoveis.timeline[]`, cap 300, transacional) registra tudo automaticamente. **Ficha vinculada**: "Enviar Ficha ao Interessado" copia link com `&imovelId=` (a ficha já lia o param e o `salvarFichaPublica` já persistia); trigger `onFichaInteressadoRecebida` (pf/pj/proposta com imovelId) cria/atualiza o interessado como Ficha Recebida sozinho. Rules: `negocios` = read regra de ouro, write só via function. Testado ponta a ponta no staging (NG-000001 criado, trava de 2º negócio confirmada, ficha→interessado automático OK). **TODAS as telas construídas** (01 Dashboard, 02 Carteira, 03 Detalhes, 04A/04B Negócios, 05 Relatórios, 06 Fichas=Cadastro, T-06 Admin configs) — no staging, aguardando validação pra ir pra produção. As specs por tela vivem só no Drive baixado (`01-DESIGN-SYSTEM.md`, `03-ESPECIFICACAO-*`, `04A/04B-*`, `Manual-de-Regras-do-Negocio.docx`); **não existe um doc mestre no repo** — se precisar de visão geral, é esta seção do CLAUDE.md.
  - **Invariantes da caça-bugs 2026-07-17** (não reintroduzir — commits `f54825c`/`9e9f604`):
    - `onFichaInteressadoRecebida`: reenvio da MESMA ficha **não rebaixa decisão já tomada** — só volta pra
      "Ficha recebida" quem estava em `ficha_enviada`/`ficha_recebida`; `aprovado`/`reprovado`/`desistiu`/
      `em_analise`/`negocio_gerado` ficam como estão (o reenvio só atualiza nome/contato/fichaId).
    - **Anti-injeção de interessado em imóvel alheio**: o link "Enviar Ficha ao Interessado" carrega o **dono
      do imóvel** (`im.corretorUid`), NÃO o usuário logado (assim o gestor envia pra imóvel de corretor sem
      roubar atribuição). O trigger **recusa** ficha cujo `corretorUid` ≠ dono do imóvel (imóvel legado sem
      dono passa). ⚠️ Não voltar o link pra `currentUid` — reabre a injeção.
    - `negocioAtualizar` é **transacional**: relê o negócio fresco dentro de `runTransaction` antes de gravar
      checklist/comentário/timeline (dois cliques simultâneos não se sobrescrevem). Efeitos no imóvel
      (entregar/concluir/cancelar) rodam após a transação; o `cancelar` também é transação no `interessados[]`.
    - `carteiraSituacao` bloqueia voltar pra **"Disponível" com negócio ativo** (mesma guarda do arquivamento).
  - **T-06 — Admin → "SMART HUB — configs"** (2026-07-16, **só no staging**): CRUD de **Tipos de Imóvel** e **Cidades** (chips + adicionar/remover) e **Checklists de Locação/Venda editáveis** (nome, flag obrigatória, reordenar ↑↓); Finalidades são fixas (informativo). Coleção `smarthub_config` (read logado, write só via `configSalvar`, admin + audit). `negocioGerar` usa o checklist configurado (fallback = padrão do código; negócio já criado não muda). No Hub, os campos Tipo/Cidade do modal Novo Imóvel ganham datalist da config (sem config = texto livre). Selo "padrão do sistema — ainda não salvo" enquanto o doc não existe.
  - **Tela 05 — Relatórios** (2026-07-16, **só no staging**): sub-app **Relatórios** na aba Locação — período (hoje/7d/30d/mês/tudo/personalizado), filtros tipo/status/corretor, 6 indicadores, pipeline por status (chips+barras), produção por corretor, negócios que precisam de atenção (Abrir → 04B). **Exports** em cima do filtro ativo: CSV (BOM + `;`), Excel (.xls = tabela HTML), PDF (iframe imprimível → diálogo do sistema, funciona no .exe e no navegador). **Sem backend novo** — agrega `negocioListar` + `locListarImoveis` no cliente; a posse continua no servidor.
  - **Tela 01 — Dashboard** (2026-07-16, **só no staging**): o sub-app **Painel** virou o Dashboard da spec — saudação por hora + data, 4 cards (Imóveis/Negócios Ativos/Pendências/Entregues), ações rápidas (Novo Imóvel·Enviar Ficha abre o modal, Carteira, Negócios), **"O que precisa da sua atenção"** (negócios abertos ordenados por dias parado; Gerenciar abre o 04B direto via `negAbrirDireto`), **últimas atividades** (timelines de negócios+imóveis fundidas) e **resumo da operação** por status. Broker vê geral; corretor só o dele (function `dashboardDados`, 1 chamada). Blocos herdados no rodapé: alertas da Locação + financeiro do gestor (`locDashboard`) — nada se perdeu.
  - **Telas 04A/04B — Negócios** (2026-07-16, **só no staging**): sub-app **Negócios** na aba Locação. 04A = indicadores + pesquisa + filtros + tabela (próxima ação, barra de progresso, Gerenciar); SEM "Novo Negócio" (nasce na Tela 03). 04B = resumo, **checklist operacional** (cada etapa grava feitoPor/feitoEm; 1º ✓ move pra Em Andamento automático; `proximaAcao` recalculada), painel lateral (status manual do broker, progresso, **Drive = campo de link** — integração real fica pra fase da service account), abas **Comentários** (exclusivos broker + corretor responsável — o servidor nem devolve pros demais) e **Histórico**. Ações do broker: **Entregar p/ Gestão** e **Concluir** exigem TODAS as obrigatórias; **Cancelar** devolve o imóvel pra Disponível e o interessado pra Aprovado. Encerrado (concluído/cancelado) = só leitura. Functions: `negocioObter`, `negocioAtualizar` (acao: checklist|comentario|drive|status|entregar|concluir|cancelar). Testado ponta a ponta no staging. ⚠️ O SW do PWA segura o casco velho — depois de deploy no staging, forçar atualização (unregister + reload) pra ver tela nova.
- **Marketing** (dinâmico, editável no painel): sanfonas + templates em Firestore `marketing_config/layout` (semente `MARKETING_SEED` + versão/merge); ⚙ Gerenciar (permissão `marketing_gerenciar`) edita/reordena/faz upload de HTML e capa pro Storage. Templates abrem em janela dedicada (`abrir-template` no `main.js`).
  - **Layout de "prateleiras"** (2026-07-21, pedido do chefe, referência REMARKT; **só no staging**):
    a sanfona `<details>` virou faixa sempre visível — título à esquerda + contador + **"Ver mais"**
    (vira grade; só aparece com >4 templates) e os cards numa linha que rola. O card é **só a capa**
    (sem botão e sem legenda: a descrição vive no `title`/`alt`), 186px, e o **cabeçalho inteiro**
    recolhe a faixa — ⚠️ não voltar a escutar só a setinha, alvo de 22px passa impressão de botão
    quebrado. O campo `aberta` da config (checkbox do ⚙ Gerenciar) voltou a valer como estado
    INICIAL; sem o campo, abre. **Pesquisa** (`mktBusca`) filtra em memória por descrição ou título
    da categoria, sem acento/caixa; durante a busca ninguém fica recolhido.
  - **`formato: 'paisagem'`** na sanfona = artes 16:9 (capa de YouTube): card 300px e thumb 16/9.
    Sem o campo, retrato 1080×1440 (a maioria). O passo das setas ‹ › **mede** o card — não cravar
    largura de novo, quebra no outro formato.
  - ⚠️ O espaçamento entre faixas vive em `.mkt-prateleira + .mkt-prateleira`, **não** num `gap` do
    `.mkt-wrap`: as prateleiras são irmãs dentro do `#mktContainer`, que é filho único do wrap.
  - **Pré-preenchimento do corretor nos templates "vendido"** (2026-07-24, **staging + `.exe` de dev**;
    functions do perfil já em produção, o resto só chega aos corretores quando a att grande sair):
    ao abrir um template Vendido (v1–v5), **nome + telefone + foto** do corretor já vêm preenchidos,
    puxados do perfil (`getMeuPerfil`). CRECI/cargo/cidade **não** entram — a pessoa edita na hora.
    - **Como**: os bundles vendido são editores React que leem o estado salvo em
      **`localStorage['vendido_editor_v6']`**, e esse estado **vence** o corretor de demonstração
      embutido (o `vendido-data.js` do bundle reescreve `window.VENDIDO_DEFAULTS` **depois** de qualquer
      injeção, então injetar o global não adianta — tem que ser o localStorage). Campo: `nome` (nome
      completo), `phone`, `agent` (foto = data URL). `formatarTelefone` (hub-app) põe `(XX) XXXXX-XXXX`.
    - ⚠️ **A chave `vendido_editor_v6` precisa BATER com o `STORAGE_KEY` do bundle deployado.** O fonte
      em `marketing/template/editor.jsx` diz `v5`, mas o bundle no ar é `v6` — o deployado é mais novo
      que o fonte. Se um dia rebuildar os templates e o key virar `v7`, o seed **para em silêncio**
      (falha segura: abre com o demo). Conferir a chave real no bundle antes de mexer.
    - **Web** (`platform-web.js` `abrirTemplate`): grava o localStorage **antes** de abrir a aba —
      same-origin, sem fetch/CORS/injeção. Só pega os templates **locais** (`/app/marketing/…`); os
      hospedados no Storage abrem em outra origem e ficam de fora.
    - **Desktop** (`preload-template.js` + `main.js`): a janela do template ganhou um preload que semeia
      o mesmo localStorage **antes** do editor rodar. O perfil vem do `main` por **IPC síncrono**
      (`template-prefill-get`), NÃO por `additionalArguments` — a foto (base64) estouraria o limite de
      argv. ⚠️ No `'closed'` o `webContents` já morreu: guardar `w.webContents.id` numa variável antes
      (ler lá dentro dá `Object has been destroyed`). No desktop pega até os vendido do Storage.
    - **Foto**: só entra se o corretor tiver foto no perfil; sem foto, fica a ilustração demo do bundle
      (a foto do perfil é avatar quadrado, a arte espera recorte — manter a demo costuma ficar melhor).
- **Cadastro / Fichas** (web, Firebase Hosting): locador, PF, PJ, locação c/ fiador, vendedor, proposta, fiança (`public/ficha-*.html`). Cliente preenche por link (`geraLink`); upload de documentos com **download token próprio** (ver `project-fichas-documentos`). Todas as fichas (locação e venda) vivem no Cadastro.
  - **A ficha vem SEMPRE do Hosting, inclusive dentro do .exe** (v1.0.100). Antes o `abrir-ficha-local`
    do `main.js` carregava do disco (`public/` empacotado no instalador) — a ficha virava uma **cópia
    congelada no build**: corrigir uma ficha exigia republicar o `.exe` e esperar o auto-update chegar
    em cada máquina, e nesse meio-tempo cada corretor rodava uma versão diferente. Foi esse descompasso
    que segurou o deploy das regras do Firestore. Além disso, `file://` não tem origem — o reCAPTCHA não
    consegue atestar a página, e era isso que impedia ligar o **App Check** no `salvarFichaPublica`.
    Agora: `app.isPackaged` → Hosting; em dev → disco (senão o `npm start` mostraria a ficha **publicada**,
    não a que você acabou de editar). Sem internet, a janela avisa em vez de ficar branca.
  - Consequência: **depois que a 1.0.100 alcançar todos**, nenhuma máquina consegue mais rodar ficha
    velha — o que destravou o `firebase deploy --only firestore:rules`. (Destravava o App Check
    também, mas ele foi **revertido** por quebrar as fichas — ver Infra.)
  - ⚠️ `public/ficha-engine.js` **foi apagado** (era código morto; último lugar que gravava direto). Hoje
    `grep addDoc` no projeto = zero.
  - **Ficha "em branco" (resolvido)**: as fichas montam o form com módulos ES que importam o SDK do
    Firebase de um CDN externo (gstatic). Em módulo ES, se UM import trava na rede, o script inteiro não
    roda e o form nunca aparece — rede fria abria em branco, reabrir (cache) resolvia. Passou a ser
    possível só desde a 1.0.100 (ficha vem da rede, não mais do disco). **Vigia**: `public/ficha-watchdog.js`
    (script CLÁSSICO, mesma origem — confiável; o que falha é o CDN de terceiro). Cada engine faz
    `window.__fichaPronta=true` logo após os imports; se em 7s a flag não virar true, o vigia recarrega
    **uma vez** (guard em sessionStorage evita loop) e, se ainda assim nada, mostra aviso com botão em vez
    de branco. Está nas 7 fichas.
  - **Limite anti-despejo**: `salvarFichaPublica` limita **60 fichas NOVAS por corretor por hora**
    (`_limitarCriacaoFicha`, janela fixa transacional em `_rate_fichas/{uid}`). A ficha é anônima; sem isso
    um script despejaria fichas falsas. Faz o papel que o App Check faria, mas 100% no servidor (App Check
    no cliente foi revertido — quebrava a ficha, ver Infra). Só na criação; edição não é vetor de despejo.
  - **Duplicados entre pessoas da MESMA ficha** (validação no cliente, antes do envio): **CPF** e **e-mail**
    (minúsculo) não podem se repetir entre pessoas; **telefone** dedup só em **celular/WhatsApp** — NÃO em
    `fixo` (⚠️ não reincluir: um casal que mora junto compartilha o fixo da casa, e incluir travava envio
    legítimo). Campos vazios/"Não existe" são ignorados. Ao sair de casado/união estável, a `ficha-pf`
    **apaga os dados do cônjuge** (`p{i}c_*`) — senão a PII do ex-cônjuge ia no envio e um CPF/e-mail
    residual travava o submit sem campo visível pra destacar. (Caça-bugs 2026-07-17.)
  - **`barraCorretor` dentro da ficha = LEGADO, escondida de propósito (NÃO é bug ativo).** Cada ficha tem
    uma barra "Modo Corretor" com "✓ Aprovar e enviar ao admin" e "⚠ Solicitar correção". Ela fica
    `display:none` sempre que `origem=hub`, e o corretor **sempre** abre a ficha com `origem=hub`
    (`hub-app.js` `abrirModalFicha`) — então **ninguém vê esses botões**. As ações reais do corretor
    (aprovar / reenviar pro cliente) vivem no **Hub** (`enviarFichaTipoAdmin`/`reenviarFichaTipoCliente`,
    via Cloud Function; o status `correcao_solicitada` aparece lá como "Devolvida"). ⚠️ O `solicitarCorrecao()`
    da barra está **quebrado-se-reativado**: usa `updateDoc` direto (bloqueado por `write:if false` desde a
    v1.0.100) e `prompt()` (não roda em janela do Electron). Um caça-bugs vai reapontar isso toda varredura —
    é **falso positivo**: código morto e oculto, sem substituto perdido. Se um dia reativar a barra, refazer
    o `solicitarCorrecao` via Cloud Function + trocar o `prompt()` por um `<dialog>`.
- **Agenda** (`events` no Firestore): reuniões com participantes (ou "todos"); mini calendário + relógio; calendário completo; alerta 1h antes; **integra com Google Agenda/Tarefas**. Functions: `criarEvento`, `listarEventos`, `excluirEvento`, `listarPessoas`.
- **Calculadoras** (`public/calculadoras.html`): aluguel proporcional + multa rescisória (conferidas com o Excel do financeiro).
- **Bloco de Notas**: notas por usuário (`user_notes/{uid}`), autosave com debounce.
- **Documentos (Google Drive)**: embed da pasta do Drive — **desabilitado temporariamente** no `index.html` (limitação de service account/tamanho).
- **Configurações**: perfil (nome + foto + **telefone**, `user_profiles`, foto em base64). Functions: `getMeuPerfil`, `salvarMeuPerfil` (as duas já retornam/aceitam `telefone` **em produção** — deploy aditivo de 2026-07-24). O telefone reaproveita o campo `cfgWhatsapp` (era placeholder desabilitado) e alimenta o pré-preenchimento dos templates de Marketing (ver Marketing).
- **Admin**: credenciais dos sistemas (cripto KMS), códigos de convite, usuários (admin/excluir/**permissões granulares**), banners (reordenáveis), "último app acessado". O **painel de Lançamento** ("Publicar para todos") e o checkbox "Acesso de teste" ainda aparecem na tela mas **não fazem nada** — ver "Dívida técnica intencional".

## Como PUBLICAR uma nova versão (os 4 passos)

1. Ajustar os arquivos.
2. Subir a versão no `package.json` (ex.: `1.0.84` -> `1.0.85`).
3. `$env:GH_TOKEN="<token github com escopo repo>"; npm run publish` (compila o .exe e sobe pro GitHub Releases; auto-update pega).
4. `git add -A; git commit -m "..."; git push origin main`.

- `publish.releaseType` = `release` (sai publicado, não rascunho). Não usar `npm run build` sozinho pra distribuir.
- Link de download/instalação: `https://github.com/Goldencat7/remax-smart-hub/releases/latest`.
- Ícone do app: `build/icon.ico`.

## Deploy do PWA (celular) — separado do .exe

```
npm run deploy:pwa      # monta public/app/ e sobe pro Firebase Hosting
```

Publica em `https://remax-smart-hub.web.app/app/`. **Mexeu numa tela** (`hub-app.js`, `index.html`,
`styles.css`, `admin*`)? Precisa dos **dois**: publicar o `.exe` (4 passos acima) **e** rodar o
`deploy:pwa` — senão desktop e celular ficam em versões diferentes. Ver a seção do PWA nas pendências.

## Deploy das Cloud Functions (separado do .exe)

```
firebase deploy --only functions --project remax-smart-hub
```

(ou `--only functions:nomeDaFuncao` pra uma só). As functions NÃO vão no .exe.

## Ambiente de teste — Firebase Emulator Suite (local, grátis, isolado)

Sandbox do Firebase rodando na sua máquina — Auth, Firestore, Functions e Storage
**de mentira**, sem tocar em produção. É onde dá pra **quebrar tudo à vontade**: testar
regras do Firestore, Cloud Functions e migração de dados (LGPD/expurgo) sem risco. O dado
vive só em memória e some ao desligar (a não ser que exporte). Escolhido no lugar de um 2º
projeto Firebase (mais pesado: centralizar config dos 10 arquivos + recriar KMS/App Check +
billing) — pra um dev só, o emulador entrega ~90% do "testar sem quebrar prod".

```
npm run emu        # sobe a suíte (UI em http://localhost:4000)
npm run emu:seed   # semeia dados de MENTIRA (com o emulador rodando em outra janela)
```

- **Java 11+ é obrigatório** (os emuladores de Firestore/Storage são programas Java). Instalado
  o **Temurin 21** (`winget install EclipseAdoptium.Temurin.21.JDK`). O app **não** usa Java —
  é só dependência dessa ferramenta de dev. ⚠️ No Windows a Oracle fixa um "java8path" na frente
  do PATH; por isso o `scripts/emu.js` **prependa `JAVA_HOME/bin`** no PATH do processo (usa o
  Java do `JAVA_HOME`, que aponta pro 21) — assim funciona nos dois PCs sem cravar caminho no repo.
- **`scripts/emu-seed.js`** usa o Admin SDK (o de `functions/node_modules`) apontado pros emuladores.
  Trava anti-produção: se as env `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` não
  estiverem setadas, aborta — impossível escrever em produção por engano. Cria `admin@teste.local`
  e `corretor@teste.local` (senha `teste1234`) + 3 fichas. A **2FA não roda no emulador** (login simples).
- Config em `firebase.json` → bloco `emulators` (portas: auth 9099, functions 5001, firestore 8080,
  storage 9199, UI 4000). Logs/dumps do emulador estão no `.gitignore`.
- **`npm run emu` sobe auth+firestore+functions+storage por padrão** (o `emu.js` injeta `--only`).
  O Storage **ficava de fora** até 2026-07-21, quando o bloco `storage` do `firebase.json` era um
  array e o emulador exigia um `target` (`Must supply 'target'`); virou objeto e passou a subir
  (verificado: `Storage 127.0.0.1:9199`).
- **Verificado (2026-07-15)**: Firestore sobe com Java 21, Auth/Functions OK, seed grava — e o **Hub
  real logou no emulador** (login → auth 9099, Firestore 8080, Functions 5001, tudo 200, **zero produção**).

## Config por ambiente — interruptor prod/staging/emulador (`firebase-env.js`)

As telas escolhem o projeto Firebase **pelo hostname**, sem flag manual — então é impossível um build de
produção apontar pro lugar errado:
- `file://` (o .exe) ou `remax-smart-hub.web.app` → **produção**.
- `remax-smart-hub-staging.web.app` → **staging** (projeto `remax-smart-hub-staging`).
- `localhost` / `127.0.0.1` → **emulador** (liga os `connect*` locais).

- **Onde**: `firebase-env.js` (raiz) + **cópia idêntica** `public/firebase-env.js` (as fichas em public/
  importam desta; as telas da raiz importam da outra — **manter as duas em sync**). Exporta `firebaseConfig`
  (resolvido por hostname) e `conectarEmuladores({auth,db,fns,storage})`.
- **Segurança**: `conectarEmuladores` é **no-op fora de localhost** e **não importa o SDK no topo** — em
  prod/staging não baixa `connect*` nenhum (não reabre a "ficha em branco"). Só em localhost ele
  dinamicamente importa e liga os emuladores. Provado: hostname de prod/`.exe` → sempre config de produção.
- **Ligado em**: `hub-app.js`, `auth-login.js`, `admin-app.js` (raiz) e `ficha-comum.js`, `ficha-pf.html`,
  `ficha-locador.html`, `portal-proprietario.html`, `portal-inquilino.html`, `bugbot.html` (public). O
  `build-pwa.js` copia o `firebase-env.js` pro `public/app/`. As chaves dos dois projetos são PÚBLICAS.
- ⚠️ **Nada de id de projeto/bucket cravado em código que roda nos dois ambientes.** O deploy manda
  **todas** as functions pro staging também, então quem crava `remax-smart-hub` bate em produção a
  partir do staging. Duas ocorrências já corrigidas (2026-07-21): o `firebase.json` tinha o bloco
  `storage` como **array com o bucket de produção fixo** (por isso `--project staging` aplicava as
  regras no bucket errado, e o staging ficou desde sempre sem bucket default — anexo de ficha
  quebrado); e o `backupFirestore` tinha `const projectId = 'remax-smart-hub'`, então a instância do
  staging tentava exportar **produção** todo dia às 3h e tomava 403 (produção nunca foi tocada, mas
  o erro fantasma ia sujar o relatório diário). Padrão correto: `process.env.GCLOUD_PROJECT` nas
  functions (com *early return* fora de produção) e `"storage": { "rules": "..." }` como **objeto**
  sem `bucket` no `firebase.json` — assim segue o `--project`. Bônus: virando objeto, o emulador de
  Storage deixou de exigir `target` e agora sobe por padrão no `npm run emu`.
- **Staging (projeto `remax-smart-hub-staging`, plano Blaze) — NO AR** em
  `https://remax-smart-hub-staging.web.app/app/`. App + todas as functions + regras deployados; Auth
  ligada (Email/senha). Deploy num comando: **`npm run deploy:staging`** (build + hosting + functions +
  regras, tudo `--project staging`). Secrets do staging são **dummy** (`staging-dummy-nao-usar`) — as
  functions de e-mail falham lá de propósito; trocar por real se precisar. Contas de teste (sem 2FA):
  `admin@teste.local` (admin, senha `teste1234`) e `teste@staggin.com.br` (admin + gestor de Locação,
  senha `12345678`, aba Locação ligada via `user_access.loc_gestao`). Semeadas por **`node scripts/seed-staging.js`**
  (Admin SDK, projectId fixo em staging; requer **ADC** — `gcloud auth application-default login` 1x).
  Os 3 bugs da esteira achados na caça-bugs de 2026-07-15 (`BUGS-ESTEIRA-IMOVEIS.md`) foram
  **resolvidos na reestruturação** e o arquivo foi removido em 2026-07-16 (guarda simétrica no
  `locMoverImovelStatus`, `_uidsDosAdmins` por claims, `_atribuirProtocoloSeFalta` transacional).
  ⚠️ **Primeiro deploy de trigger em projeto novo falha** (service agent do Eventarc
  propaga com atraso) — repetir o deploy dos triggers resolve; o `deploy:staging` aborta o hosting se as
  functions falharem, então rode o hosting de novo depois.

## Convenções

- Sempre que terminar algo, lembrar o usuário dos 4 passos pra publicar.
- Mensagens de commit terminam com:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Trabalhar entre máquinas: `git pull` antes de mexer, `git push` ao terminar.

## Pendências / ideias futuras

### Bloqueado por dependência externa (não dá pra resolver só codando)
- **Fase 2 — integração bancária (cobrança automática)**: precisa abrir conta no provedor + gerar a chave. Recomendação: Asaas. Plano completo em **[`FASE-2-INTEGRACAO-BANCARIA.md`](FASE-2-INTEGRACAO-BANCARIA.md)**. O terreno já está pronto (webhook-stub + `origemStatus`/`idExterno`).
- **Portal do inquilino — boleto/PIX**: a página já avisa "pagamento online em breve"; exibir o boleto real depende da Fase 2.
- **Assinatura eletrônica de contrato** + modelos de contrato: precisa contratar provedor (ClickSign/D4Sign/ZapSign).
- **Integração real do app de vistoria (CheckVisto)**: ✅ FEITA no staging (2026-07-16) — contrato em
  `INTEGRACAO-CHECKVISTO.md` (v1.1). Botão "Solicitar no CheckVisto" na Gestão da Locação → agendamento
  + push na conta do vistoriador; status/laudo voltam sozinhos via `vistoriaWebhook` (upsert por
  `idExterno`) e andam o checklist automático. Lado CheckVisto 100% aditivo (`functions/hub-integracao.js`
  + apêndice no index.js), testado ponta a ponta. Falta: secret `HUB_CHECKVISTO_SECRET` já está nos 3
  projetos; produção entra no publish grande (deploy de `vistoriaWebhook`/`locSolicitarVistoriaCheckVisto`
  já sai no `--only functions`). Auditoria do commit `0fd186d` pelo chat do CheckVisto recomendada.
- **Notificação WhatsApp via Meta Cloud API**: quando corretor recebe uma ficha, mandar mensagem automática no WhatsApp pessoal dele.
  - Precisa de: chip novo (qualquer operadora) para ser o número remetente da REMAX Smart.
  - Fluxo: Firestore `onCreate` em `fichas` → Cloud Function → Meta Cloud API → WhatsApp do corretor.
  - Corretor salva número pessoal nas Configurações do Hub.
  - Custo estimado: <$1/mês para 12 corretores (~30 fichas/mês, ~$0,02/conversa utility).
  - Setup: Meta for Developers → Meta Business Account → cadastrar número → aprovar template de mensagem (~24h) → token na Cloud Function.

### LGPD — código PRONTO, porém DESATIVADO de propósito (2026-07-14)
Escrito e revisado, mas **não deployado** e **fora do ar** — o Nathan pediu pra deixar parado
("não vamos colocar a lgpd agr"). Não ligar sem resolver o item que trava.

- **Onde está**: bloco `LGPD` no fim do `functions/index.js` (`lgpdPainel`, `lgpdSetConfig`,
  `lgpdExpurgar`, `lgpdExcluirTitular`, `lgpdExpurgoAutomatico`) + `carregarLgpd()` no
  `admin-app.js` + a `<section data-aba="lgpd">` no `admin.html`. O **botão da aba está
  comentado** no `admin.html`, então a tela é inalcançável; as functions **nunca subiram**.
- **O que trava** (decisão do Nathan, não de código): a ficha do locador **não vive só na ficha**.
  O gatilho `onFichaLocadorEnviadaAdmin` **copia** os dados pessoais pra `pessoas/{fichaId}_loc1|_loc2`
  (nome, RG, **CPF**, nascimento, endereço, cônjuge) e pra `imoveis/{fichaId}` (endereço, nome do
  locador, links dos anexos). Anonimizar **só a ficha** deixaria CPF/RG intactos no `pessoas` —
  pior que não fazer nada, porque dá sensação de conformidade sem conformidade. Mas apagar
  `pessoas` de imóvel com **contrato vigente** quebra a operação — e a LGPD não pede isso
  (enquanto dura o contrato há base legal pra guardar).
- **Caminho recomendado quando retomar**: expurgar ficha + `pessoas` + PII do imóvel, **pulando
  os imóveis com contrato ativo** (voltam pra fila quando o contrato cair).
- **Desenho já decidido**: *expurgo por retenção* = **anonimiza** (apaga `dados`/`documentos`/anexos,
  mantém a casca: corretor, tipo, status, data) — o relatório não perde nada. *Exclusão a pedido do
  titular* = **apaga tudo**. Prazo em `_lgpd_config/retencao` (padrão 730 dias, mínimo 180);
  automático mensal com interruptor próprio, que vem OFF.
- **Bugs já corrigidos na revisão** (não reintroduzir): `prompt()` **não existe no Electron** — a
  confirmação digitada é um `<dialog>` (`confirmarDigitando`); a varredura **pagina com `startAfter`**
  (uma janela fixa encheria de fichas já expurgadas — as mais antigas — e o expurgo pararia em
  silêncio); os deletes de anexo vão em paralelo e as functions têm `timeoutSeconds: 540`.

### Dívida técnica intencional (NÃO remover sem o Nathan pedir)
A "versão enxuta" das Locações (v1.0.90) tirou telas da UI mas deixou o código no lugar,
porque o Nathan vai voltar nessa parte ("vão ter mais atualizações dessa parte, eu vou mecher depois").
- `hub-app.js`: `carregarFinanceiro`, `carregarAlertas`, `carregarRelatorios`, `REL_DEFS`, `_relCSV`, `_descAlerta`, `_relatorioDados`, as flags `betaLocacoes`/`locacoesPublicado` e o branch `grupo === 'locacao'` do `carregarDocumentos`.
- `admin.html`/`admin-app.js`: o painel de **Lançamento** ("Publicar para todos") e o checkbox **"Acesso de teste"** (`loc_beta`) — visíveis, porém inertes (a visibilidade da aba Locação hoje é só `loc_gestao`).
- Cloud Functions `locFinanceiro` / `locListarAlertas` / `locRelatorios`: continuam no backend, sem tela.

### App de celular (PWA) — ✅ NO AR (publicado em 2026-07-14)
O Hub roda no celular em **`https://remax-smart-hub.web.app/app/`** (instalável). Não existe
"código do celular": as telas são **as mesmas** do `.exe` (`index.html`, `hub-app.js`, `styles.css`,
`admin.html`, `login.html`). Quem muda é a **ponte**, não a tela.

- **Como funciona**: `scripts/build-pwa.js` copia as telas pra `public/app/` e pluga 3 coisas que só
  a web precisa (tudo em `pwa/`, nada disso vai no `.exe`):
  - **`pwa/platform-web.js`** — reimplementa `window.hubApi` (a ponte que o `preload.js` dá no
    Electron) em cima do navegador: `abrirApp`→aba nova, `abrirFicha`→aba, `baixarFichaPDF`→abre a
    ficha (o celular imprime/salva em PDF), `voltarParaHub`→navegação. Também vira a sidebar em
    **gaveta** (botão ☰) e registra o service worker.
  - **`pwa/mobile.css`** — só ajustes de tela pequena (entra depois do `styles.css`). Em tela grande
    quase nada vale: abrir o PWA no PC dá o Hub de 3 colunas de sempre.
  - **`pwa/manifest.webmanifest` + `pwa/sw.js` + `pwa/icons/`** — instalável e rápido no 4G. O SW
    cacheia **só o casco** (HTML/CSS/JS/ícones); Firestore/Functions/Auth passam **sempre** pela rede.
  - ⚠️ **Depois de cada deploy o SW avisa as abas e a página se recarrega uma vez** (2026-07-21).
    Sem isso a 1ª carga pós-deploy era um **Frankenstein**: o HTML vem da rede (novo) e o CSS/JS do
    cache (velhos, por causa do *stale-while-revalidate*) — tela desalinhada até a pessoa apertar F5,
    e isso atingia **todo corretor**, não só quem testa. O `sw.js` faz `postMessage` no `activate`
    e o `platform-web.js` recarrega, com duas travas: só se a página tem **menos de 15s** de aberta
    (senão puxaria o tapete de quem está digitando) e **um reload por build** (`sessionStorage`).
    Não vale pro `.exe`, que lê do disco e não tem service worker.
- **⚠ AUTOLOGIN NÃO EXISTE NO PWA — de propósito.** O contrato é a flag `hubApi.autologin`
  (`true` no `preload.js`, `false` no `platform-web.js`). Com ela `false`, o `abrirApp()` do
  `hub-app.js` **nunca** chama o `getCredentials` → **nenhuma senha de sistema trafega pro celular**.
  Os apps continuam listados, mas abrem como link normal e a pessoa entra com o login dela.
  **Não "consertar" isso**: injetar senha em site de terceiro é impossível na web e reprovado em loja.
- **Só no desktop** (escondidos no celular pelo `platform-web.js`): autologin, "Iniciar com o Windows",
  "Conectar Google Agenda" (o OAuth usa servidor loopback, que não existe no navegador),
  "Verificar atualização" (o PWA se atualiza sozinho).
- **Comandos**: `npm run build:pwa` (monta) · `npm run serve:pwa` (testa em `localhost:5055/app/`)
  · `npm run deploy:pwa` (monta + `firebase deploy --only hosting`).
- **`public/app/` é gerado** — está no `.gitignore` e fora do `.exe` (`!public/app/**` no `package.json`).
  Nunca editar lá dentro: editar a fonte na raiz (ou em `pwa/`) e rodar o build.
- **Verificado** (localhost, viewport 375×812): login redireciona certo pelo shim, `autologin:false`,
  SW ativo no escopo `/app/`, manifest com 3 ícones, gaveta abre/fecha, sem scroll horizontal.
  **Publicado** — no ar em `remax-smart-hub.web.app/app/` (acompanha as versões do `.exe` via
  `deploy:pwa`). Teste em celular físico (login, 2FA, fichas) segue recomendado a cada release grande.
- **Fase 2 (opcional)**: o Electron virar casca que faz `loadURL(hosting)` — aí
  `firebase deploy --only hosting` atualiza **desktop + celular juntos** e o `.exe` só é republicado
  quando mexer no autologin. Hoje ainda são dois deploys (o `.exe` carrega os arquivos do disco).
- **Loja (opcional)**: Capacitor/TWA pra Play Store — mas review de loja quebra o "update simultâneo".

### Infra / segurança
- **App Check** — ⛔ **FORA DO AR no cliente (revertido em `904d2e7`). NENHUMA página emite crachá.**
  Foi ligado em modo observação em 2026-07-14 e **removido dias depois**: o `public/app-check.js`
  lançava `reCAPTCHA placeholder element must be an element or id` no meio da inicialização das 5
  fichas que passam pelo `ficha-comum.js` (PJ, fiança, vendedor, proposta, locação c/ fiador) —
  fichas abrindo em branco. Como o `enforcementMode` estava `UNENFORCED` em tudo, ele não protegia
  nada; tirar foi de graça. **O arquivo `public/app-check.js` não existe mais** e ninguém o importa.
  - 🚨 **NÃO ligar a imposição (Enforce) no console.** Sem cliente emitindo crachá, impor em
    `salvarFichaPublica` derrubaria o **Cadastro inteiro** em produção — toda ficha passaria a ser
    recusada. As métricas do console mostram tráfego "sem crachá" porque é exatamente esse o estado,
    não porque falta amostra.
  - **Quem faz esse papel hoje**: o limite anti-despejo no servidor (`_limitarCriacaoFicha`,
    60 fichas novas por corretor por hora) — ver a seção de Fichas. 100% server-side, não depende
    de nada no cliente.
  - **Se um dia retomar**: (1) corrigir a inicialização do reCAPTCHA (o erro é de elemento
    placeholder ausente — provedor SCORE/invisível não deve precisar de container); (2) subir só em
    UMA ficha e confirmar que ela abre em rede fria; (3) espalhar; (4) só então pensar em Enforce, e
    ainda assim conferindo no console que ~100% das requisições verificadas têm crachá.
    Chave pública (site key, SCORE/invisível): `6Lfa9FMtAAAAAPcB1WwGieeCGF45Y5nUBCaoemDr`.
    Domínios: `remax-smart-hub.web.app`, `.firebaseapp.com`, `localhost`.
  - ⛔ **Nunca no `hub-app.js` / `auth-login.js` / `admin-app.js`**: rodam em `file://` dentro do
    `.exe`, e página `file://` não tem origem — o reCAPTCHA não teria o que atestar. Pelo mesmo
    motivo **não dá pra impor** no `criarContaComCodigo` (chamado do `login.html`, que roda no `.exe`).
  - **Armadilha que custou debug**: o `PATCH .../recaptchaEnterpriseConfig` precisa de
    `updateMask=siteKey` — mandar `updateMask=siteSecret` (campo que não existe aqui) retorna 200
    e **não grava a chave**; o cliente então leva `400 App not registered`. Conferir sempre com um
    `GET` depois. A config também leva alguns minutos pra propagar.

#### Como testar o restore do backup (validado em 2026-07-10)
Restaura num **2º banco do mesmo projeto**, nunca em produção. ⚠️ `gcloud firestore import` **sem**
`--database` escreve no `(default)` e sobrescreve produção — a flag é obrigatória em toda chamada.

```bash
gcloud firestore databases create --database=restore-test --location=southamerica-east1 \
  --type=firestore-native --project=remax-smart-hub
gcloud firestore import gs://remax-smart-hub-backups/AAAA-MM-DD --database=restore-test \
  --project=remax-smart-hub
gcloud firestore operations list --database=restore-test --project=remax-smart-hub  # espera SUCCESSFUL
# comparar doc a doc (ordena chaves, ignora createTime/updateTime e o nome do banco no path)
gcloud firestore databases delete --database=restore-test --project=remax-smart-hub --quiet
```

Resultado de 2026-07-10 (backup do dia, 162 docs, 24 coleções): **0 documentos perdidos, 0 conteúdo
corrompido**. As únicas diferenças foram drift esperado desde o export das 03h — `user_presence` /
`user_activity` (o app reescreve `updatedAt` o tempo todo) e um doc a mais em `_erros` no restore,
que o `relatorioErrosDiario` apagou da produção depois do backup (limpa erros > 7 dias).
Ao comparar, normalize: a ordem das chaves no JSON da REST API **não** é estável e o campo `name`
embute o nome do banco — comparar texto cru dá falso positivo em tudo.

### ✅ Já feito (era pendência, saiu)
- **2FA / MFA**: TOTP via Firebase MFA (v1.0.80).
- **Criptografia de credenciais em repouso**: KMS + descriptografia no `getCredentials` (v1.0.81).
- **Log de auditoria**: `registrarAudit` → `audit_log` cobre credenciais, permissões, perfil, marketing, exclusão de imóvel/chamado e **ações financeiras** (baixa/repasse/ajuste). Dá pra ampliar mais.
- **Backup Firestore**: export diário + retenção 30d, funcionando. **Restore validado em 2026-07-10** (0 docs perdidos) — procedimento em Infra acima.
- **CI**: `node --check` a cada push (ver pendências — falta lint/testes).
- **Gestão de Locações Fase 1 + 1.5**: construída e publicada. O `.exe` com a UI nova já saiu; o dark launch (`loc_beta`) foi substituído pela permissão `loc_gestao` (por pessoa, no Admin).

### Ideias antigas (seguem em aberto)

- **Ambiente de staging**: ✅ FEITO — projeto `remax-smart-hub-staging` no ar (ver seção
  "Config por ambiente" acima; `npm run deploy:staging`). Também existe o Emulator Suite local.

- **LGPD — retenção e exclusão de dados**: código PRONTO e revisado, porém **desativado por
  decisão do Nathan** — ver a seção "LGPD" acima (o que trava é a cópia de PII em `pessoas`/`imoveis`).

- **CI/CD**: ✅ parcial — `.github/workflows/ci.yml` roda **ESLint** (`npm run lint`), `node --check` (CJS + módulos ES do renderer via cópia `.mjs`) e valida os JSONs a cada push/PR. Falta: testes automatizados e bloquear deploy quebrado (o deploy/publish segue manual).
  - Config em `eslint.config.mjs` (flat config). Três ambientes: Node puro (`main.js`, `functions/index.js`), preloads (Node + DOM) e renderers (módulos ES + globals de browser + `hubApi`).
  - Regra do jogo: **só erro derruba o build**; aviso passa. `no-unused-vars` é aviso — e é ele que sinaliza o código morto intencional da Locação, sem quebrar a CI.
  - Achou um bug real na estreia: `escapeHtml` era usado no `admin-app.js` sem existir lá (ele é declarado no `hub-app.js`, e módulos ES não compartilham escopo) — a tela Admin → Materiais travava em "carregando...".
  - No CI, `npm ci` roda com `ELECTRON_SKIP_BINARY_DOWNLOAD=1` pra não baixar os ~100 MB do Electron.

- **Monitoramento e alertas em tempo real**: ✅ FEITO (2026-07-10). Alerta do Cloud Monitoring `Hub — falha em Cloud Function (tempo real)` (policy `6131141434551857038`) dispara e-mail pra `nathangabriel@remax.com.br` (canal `14857592127522318626`) quando qualquer function loga severidade ERROR. Filtro: `(resource.type="cloud_run_revision" OR resource.type="cloud_function") AND severity>=ERROR` — as functions v2 aparecem como `cloud_run_revision`, não `cloud_function`. Limite de 1 notificação a cada 5 min (`notificationRateLimit`), incidente fecha sozinho em 30 min.
  - Complementa (não substitui) o `relatorioErrosDiario` das 08h e o `logErro` → `_erros`. O `logErro` cobre só 7 functions; o alerta pega qualquer `throw` não tratado, porque lê o Cloud Logging.
  - Pra testar sem quebrar nada: escrever um log sintético via `logging.googleapis.com/v2/entries:write` com `resource.type=cloud_run_revision` e `severity=ERROR`.
  - Nada disso vive no repo — é config do projeto GCP. `gcloud alpha/beta monitoring` não está instalado nesta máquina; usar a REST API com `gcloud auth print-access-token`.

- **Bug Fix Bot + Caça-Bugs diário** (autônomo, "propõe → você dispõe"): ⏸️ **DESLIGADO por enquanto** (2026-07-15) — a assinatura Claude que gerava o `CLAUDE_CODE_OAUTH_TOKEN` (outra conta do Nathan) venceu, então as rodadas falhariam com 401 toda noite e mandariam e-mail de erro. Os **dois** workflows foram desabilitados **no GitHub** (`gh workflow disable "Caça-Bugs Diário"` + `"Bug Fix Bot"`, estado `disabled_manually`) — nada de código foi apagado, só o gatilho. O **CI continua ativo** (não usa esse token). **Pra religar quando a assinatura voltar**: gerar novo token (`claude setup-token`) → atualizar o secret `CLAUDE_CODE_OAUTH_TOKEN` no GitHub → `gh workflow enable "Caça-Bugs Diário"` + `gh workflow enable "Bug Fix Bot"`. Nenhum outro passo — o resto (secrets do Firebase, painel do Admin) está intacto.
  - Histórico (quando estava no ar): ✅ **COMPLETO E NO AR** (2026-07-13). Fluxo testado ponta a ponta: caça-bugs varre à meia-noite (`bug-hunter.yml`, cron `0 3 * * *`) → e-mail com resumo → Nathan aprova no celular (`bugbot.html`, token) → Claude corrige num branch isolado, roda os checks e **abre um Pull Request** → Nathan revisa/merga. **Nunca** faz merge, sobe versão ou publica sozinho — isso segue 100% manual. Achou 10 bugs reais em 2 varreduras; 5 corrigidos direto + 5 via PR aprovado.
  - **Todos os secrets configurados**: GitHub → `CLAUDE_CODE_OAUTH_TOKEN` (assinatura) + `BOT_HOOK_SECRET`; Firebase → `BOT_GH_TOKEN` + `BOT_HOOK_SECRET`; checkbox "Allow GitHub Actions to create PRs" ligado. ⚠ **Gravar `BOT_GH_TOKEN` via `--data-file`, NUNCA pelo prompt mascarado** (o paste trunca → 401 Bad credentials). Verificar token antes: `curl -H "Authorization: Bearer <tok>" https://api.github.com/repos/Goldencat7/remax-smart-hub`.
  - **Detalhes do workflow que custaram debug**: precisa `permissions: contents/pull-requests/id-token: write` (OIDC); reautenticar o `git push` com GITHUB_TOKEN (a action limpa a cred do checkout); `concurrency.group` ÚNICO por run (`bug-fix-bot-${{ github.run_id }}`) senão o "Autorizar todos" cancela os do meio; `--permission-mode acceptEdits` (não `--dangerously-skip-permissions`, que o classificador bloqueia).
  - **Peças no repo**: `.github/workflows/bug-fix-bot.yml` (usa `anthropics/claude-code-action@v1` → abre PR via `gh pr create`) + 3 coisas no `functions/index.js`: `botCorrigirBug` (onCall admin, disparo manual), `onErroParaBot` (onDocumentCreated `_erros/{id}`, disparo automático **desligado por padrão**) e o helper `_botDispatch` (repository_dispatch).
  - **Kill switch do automático**: `onErroParaBot` só dispara se `_bot_config/bugfix.habilitado === true` (doc no Firestore). Vem OFF. Mesmo ON tem dedupe por assinatura do erro (função + mensagem sem números) e rate-limit de 1 PR a cada 24h por tipo de erro; ignora erros do próprio bot (anti-laço).
  - **Setup manual (só o Nathan faz — 1x):**
    1. GitHub → Settings → Secrets and variables → Actions → **`CLAUDE_CODE_OAUTH_TOKEN`** — gerado com `claude setup-token` (usa a **assinatura** Claude, Pro já basta; token dura 1 ano; **não** gasta crédito de API). Vai no `env:` do step, não no `with:`. NÃO usar `--bare` (só funciona com API key). Alternativa paga: `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`.
    2. Criar **fine-grained PAT** (repo `Goldencat7/remax-smart-hub`, permissões **Contents: write** + **Pull requests: write**) e pôr como secret do Firebase: `firebase functions:secrets:set BOT_GH_TOKEN`.
    3. `firebase deploy --only functions:botCorrigirBug,functions:onErroParaBot`.
  - **Testar sem esperar bug real**: aba **Actions → Bug Fix Bot → Run workflow** (input `descricao`) — não precisa nem do PAT nem da Cloud Function. O `botCorrigirBug` (admin) é o disparo manual pelo backend; o auto só liga quando você criar `_bot_config/bugfix` com `habilitado:true`.
  - **Substrato**: escolhido GitHub Actions (sempre-ligado, zero manutenção) em vez do PC da empresa. O PC só entraria como *self-hosted runner* se quiser evitar minutos do Actions.
  - **Painel no Admin** (v1.0.99): aba **Admin → Bug Bot**. Junta num lugar só o que antes exigia abrir o e-mail, o GitHub ou o Firestore na mão: os achados da última varredura (com **"Autorizar correção"** — mesmo efeito do link do e-mail, porque a function devolve o `token` do lote pro admin), **"Pedir correção agora"** (texto livre → `botCorrigirBug`), o **interruptor do automático** (`_bot_config/bugfix.habilitado`, o kill switch do `onErroParaBot` — vem OFF) e os **15 erros mais recentes** de `_erros`, cada um com um botão "Corrigir". Functions novas: `botPainel` e `botSetAuto` (ambas `exigirAdmin`).
  - **Onde a varredura das 00h NÃO passa**: ela é do GitHub Actions (cron `17 3 * * *` UTC = **00:17 de Brasília**; o minuto quebrado é de propósito — às 03:00 cheias o Actions congestiona e atrasa o cron em 1–2h). Ela roda independente do interruptor do Admin, que só governa o disparo **reativo a erro**.

- **Refatoração de arquivos monolíticos**: `hub-app.js` e `functions/index.js` têm milhares de linhas. Quebrar em módulos menores facilita manutenção e reduz risco de regressão.
