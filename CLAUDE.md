# REMAX Smart Hub — contexto do projeto

App **Electron** (desktop Windows) da imobiliária REMAX Smart. Dá acesso rápido às
plataformas de trabalho com **autologin**, e é o hub interno da equipe: **login próprio**
(Firebase, com 2FA), **Gestão de Locações** (Painel + Imóveis, liberada por permissão),
**Marketing** (templates editáveis), **fichas** cadastrais (web), **agenda**, **calculadoras**,
**bloco de notas** e uma **área admin**. Versão publicada atual: **1.0.99** (auto-update via GitHub Releases).

## Stack

- **Electron** (`main.js` = processo principal, `preload.js` = bridge IPC).
- Renderer (telas): `login.html`+`auth-login.js`, `index.html`+`hub-app.js`, `admin.html`+`admin-app.js`. CSS único em `styles.css`.
- **Firebase**: Auth (email/senha), Firestore, Cloud Functions v2 (Node 22) em `functions/index.js`, região **southamerica-east1**. Config pública em `firebase-config.js` (e repetida no topo de cada `*-app.js`).
- Projeto Firebase: `remax-smart-hub`. Repo GitHub **público**: `Goldencat7/remax-smart-hub`.

## Segurança (regras importantes — NÃO quebrar)

- **Senhas dos sistemas NÃO ficam no código** — ficam no Firestore (`credentials/{siteKey}`) e só saem pela Cloud Function `getCredentials` (usuário autenticado). Autologin injeta no site e **nunca revela a senha** (campo de senha é "blindado": observer força `type=password` + bloqueia o "olho").
- **Conta só por convite**: criação via `criarContaComCodigo` (valida código). Por isso "logado = convidado" e o `getCredentials` pode confiar em qualquer autenticado.
- **Admin** via custom claim `admin`. Bootstrap admin UID: `OwcT6wCrXMgJ0tPADMUdKdBB8h32` (em `functions/index.js` e `hub-app.js`).
- **Apps restritos** (ex.: ClickSign): só aparecem pra quem o admin liberar (coleção `user_access/{uid}`). Admin libera em Admin → Usuários → Permissões.
- **Permissões granulares por pessoa** (concedidas no painel de Admin, nunca elevação em bloco): `marketing_gerenciar` (editar Marketing — NÃO herda de admin), `ti` (Suporte), `drives_fotografia`, `analise_locador`, `loc_gestao` (vê a aba Locação inteira — Painel + Imóveis; NÃO herda de admin). Existe também `loc_beta` (antigo dark launch), hoje **inerte** — ver "Dívida técnica intencional". Perfil de Locação = claim `locRole` (gestor/administrativo/corretor) + `loc_financeiro`.
- **Escrita das coleções de Locação = SEMPRE via Cloud Function** (Admin SDK). Regras do Firestore negam write do cliente; leitura filtrada por `corretorUid` (regra de ouro). Idem cobranças/repasses (integridade do financeiro).
- **Escrita das fichas = SEMPRE via Cloud Function** (`salvarFichaPublica`), mesma regra de ouro. O cliente preenche sem login, mas não grava direto: a function valida tamanho, tipo dos campos, e que cada anexo aponta pro nosso bucket (`fichas/<tipo>/…` ou `fichas-locador/…`). `corretorUid`, `tipo` e `status` são decididos no servidor. **Leitura** por id ainda é aberta (`allow get: if true`) — o id é a credencial, como nos portais; fechar isso exige token e é o próximo passo.
  - **Rollout (2026-07-10)**: functions + hosting DEPLOYADOS (páginas no ar já usam a function; smoke test em produção: cria ok, recusa coleção inválida/anexo externo/corretor falso). **As regras novas (`write: if false`) AINDA NÃO subiram** — o `.exe` 1.0.91 instalado carrega a ficha Fiança do disco local (versão antiga com `addDoc`), e as regras a quebrariam. Deployar `firestore:rules` só DEPOIS de publicar o `.exe` novo e dar tempo do auto-update alcançar os corretores.
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
- **Gestão de Locações** (aba Locação): módulo completo — captação (ficha do locador vira imóvel na esteira) → análise do locatário + garantia → contrato → cobrança/repasse → vistorias → alertas → relatórios (com export CSV). **Versão enxuta (pedido do chefe, v1.0.90):** sub-apps = só **Painel** e **Imóveis** (esteira com filtro por status). Financeiro/Alertas/Relatórios saíram da UI (as Cloud Functions `locFinanceiro`/`locListarAlertas`/`locRelatorios` continuam no backend, só não têm mais tela) e as **fichas voltaram pro Cadastro**. **Visibilidade**: a aba Locação inteira só aparece com a permissão `loc_gestao` (por pessoa no Admin, não herda de admin). **Checklist automático** (6 itens marcam sozinhos; esteira avança até "Aprovado" sozinha). **Portais externos** (Fase 1.5): proprietário vê repasses, inquilino vê pagamentos — por link/token, sem login (`public/portal-proprietario.html`, `portal-inquilino.html`). Detalhes completos na memória `project-gestao-locacoes`. Fase 2 (bancária) em `FASE-2-INTEGRACAO-BANCARIA.md`.
- **Marketing** (dinâmico, editável no painel): sanfonas + templates em Firestore `marketing_config/layout` (semente `MARKETING_SEED` + versão/merge); ⚙ Gerenciar (permissão `marketing_gerenciar`) edita/reordena/faz upload de HTML e capa pro Storage. Templates abrem em janela dedicada (`abrir-template` no `main.js`).
- **Cadastro / Fichas** (web, Firebase Hosting — NÃO vão no .exe): locador, PF, PJ, locação c/ fiador, vendedor, proposta, fiança (`public/ficha-*.html`). Cliente preenche por link (`geraLink`); upload de documentos com **download token próprio** (ver `project-fichas-documentos`). Todas as fichas (locação e venda) vivem no Cadastro.
- **Agenda** (`events` no Firestore): reuniões com participantes (ou "todos"); mini calendário + relógio; calendário completo; alerta 1h antes; **integra com Google Agenda/Tarefas**. Functions: `criarEvento`, `listarEventos`, `excluirEvento`, `listarPessoas`.
- **Calculadoras** (`public/calculadoras.html`): aluguel proporcional + multa rescisória (conferidas com o Excel do financeiro).
- **Bloco de Notas**: notas por usuário (`user_notes/{uid}`), autosave com debounce.
- **Documentos (Google Drive)**: embed da pasta do Drive — **desabilitado temporariamente** no `index.html` (limitação de service account/tamanho).
- **Configurações**: perfil (nome + foto, `user_profiles`, base64). Functions: `getMeuPerfil`, `salvarMeuPerfil`.
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
- **Integração real do app de vistoria**: hoje é registro manual de link; precisa da API do app usado.
- **Notificação WhatsApp via Meta Cloud API**: quando corretor recebe uma ficha, mandar mensagem automática no WhatsApp pessoal dele.
  - Precisa de: chip novo (qualquer operadora) para ser o número remetente da REMAX Smart.
  - Fluxo: Firestore `onCreate` em `fichas` → Cloud Function → Meta Cloud API → WhatsApp do corretor.
  - Corretor salva número pessoal nas Configurações do Hub.
  - Custo estimado: <$1/mês para 12 corretores (~30 fichas/mês, ~$0,02/conversa utility).
  - Setup: Meta for Developers → Meta Business Account → cadastrar número → aprovar template de mensagem (~24h) → token na Cloud Function.

### Dívida técnica intencional (NÃO remover sem o Nathan pedir)
A "versão enxuta" das Locações (v1.0.90) tirou telas da UI mas deixou o código no lugar,
porque o Nathan vai voltar nessa parte ("vão ter mais atualizações dessa parte, eu vou mecher depois").
- `hub-app.js`: `carregarFinanceiro`, `carregarAlertas`, `carregarRelatorios`, `REL_DEFS`, `_relCSV`, `_descAlerta`, `_relatorioDados`, as flags `betaLocacoes`/`locacoesPublicado` e o branch `grupo === 'locacao'` do `carregarDocumentos`.
- `admin.html`/`admin-app.js`: o painel de **Lançamento** ("Publicar para todos") e o checkbox **"Acesso de teste"** (`loc_beta`) — visíveis, porém inertes (a visibilidade da aba Locação hoje é só `loc_gestao`).
- Cloud Functions `locFinanceiro` / `locListarAlertas` / `locRelatorios`: continuam no backend, sem tela.

### App de celular (PWA) — Fase 1 PRONTA (2026-07-14), falta publicar
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
  **Falta**: `npm run deploy:pwa` + testar no celular de verdade (login, 2FA, fichas).
- **Fase 2 (opcional)**: o Electron virar casca que faz `loadURL(hosting)` — aí
  `firebase deploy --only hosting` atualiza **desktop + celular juntos** e o `.exe` só é republicado
  quando mexer no autologin. Hoje ainda são dois deploys (o `.exe` carrega os arquivos do disco).
- **Loja (opcional)**: Capacitor/TWA pra Play Store — mas review de loja quebra o "update simultâneo".

### Infra / segurança
- **App Check**: validar que as chamadas às Cloud Functions (inclusive fichas anônimas e portais públicos) vêm de origem legítima. reCAPTCHA Enterprise / Device Check.

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

- **Ambiente de staging** (projeto Firebase separado): testar mudanças sem risco de afetar produção. Criar um segundo projeto Firebase (ex.: `remax-smart-hub-staging`) e trocar config por variável de ambiente. Destrava também o teste de restore do backup.

- **LGPD — retenção e exclusão de dados**: fichas guardam CPF, RG, renda. Implementar política de expurgo automático (ex.: 2 anos) e fluxo de exclusão a pedido do titular.

- **CI/CD**: ✅ parcial — `.github/workflows/ci.yml` roda **ESLint** (`npm run lint`), `node --check` (CJS + módulos ES do renderer via cópia `.mjs`) e valida os JSONs a cada push/PR. Falta: testes automatizados e bloquear deploy quebrado (o deploy/publish segue manual).
  - Config em `eslint.config.mjs` (flat config). Três ambientes: Node puro (`main.js`, `functions/index.js`), preloads (Node + DOM) e renderers (módulos ES + globals de browser + `hubApi`).
  - Regra do jogo: **só erro derruba o build**; aviso passa. `no-unused-vars` é aviso — e é ele que sinaliza o código morto intencional da Locação, sem quebrar a CI.
  - Achou um bug real na estreia: `escapeHtml` era usado no `admin-app.js` sem existir lá (ele é declarado no `hub-app.js`, e módulos ES não compartilham escopo) — a tela Admin → Materiais travava em "carregando...".
  - No CI, `npm ci` roda com `ELECTRON_SKIP_BINARY_DOWNLOAD=1` pra não baixar os ~100 MB do Electron.

- **Monitoramento e alertas em tempo real**: ✅ FEITO (2026-07-10). Alerta do Cloud Monitoring `Hub — falha em Cloud Function (tempo real)` (policy `6131141434551857038`) dispara e-mail pra `nathangabriel@remax.com.br` (canal `14857592127522318626`) quando qualquer function loga severidade ERROR. Filtro: `(resource.type="cloud_run_revision" OR resource.type="cloud_function") AND severity>=ERROR` — as functions v2 aparecem como `cloud_run_revision`, não `cloud_function`. Limite de 1 notificação a cada 5 min (`notificationRateLimit`), incidente fecha sozinho em 30 min.
  - Complementa (não substitui) o `relatorioErrosDiario` das 08h e o `logErro` → `_erros`. O `logErro` cobre só 7 functions; o alerta pega qualquer `throw` não tratado, porque lê o Cloud Logging.
  - Pra testar sem quebrar nada: escrever um log sintético via `logging.googleapis.com/v2/entries:write` com `resource.type=cloud_run_revision` e `severity=ERROR`.
  - Nada disso vive no repo — é config do projeto GCP. `gcloud alpha/beta monitoring` não está instalado nesta máquina; usar a REST API com `gcloud auth print-access-token`.

- **Bug Fix Bot + Caça-Bugs diário** (autônomo, "propõe → você dispõe"): ✅ **COMPLETO E NO AR** (2026-07-13). Fluxo testado ponta a ponta: caça-bugs varre à meia-noite (`bug-hunter.yml`, cron `0 3 * * *`) → e-mail com resumo → Nathan aprova no celular (`bugbot.html`, token) → Claude corrige num branch isolado, roda os checks e **abre um Pull Request** → Nathan revisa/merga. **Nunca** faz merge, sobe versão ou publica sozinho — isso segue 100% manual. Achou 10 bugs reais em 2 varreduras; 5 corrigidos direto + 5 via PR aprovado.
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
