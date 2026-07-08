# Remax Smart Hub — contexto do projeto

App **Electron** (desktop Windows) da imobiliária RE/MAX Smart. Dá acesso rápido às
plataformas de trabalho com **autologin**, e é o hub interno da equipe: **login próprio**
(Firebase, com 2FA), **Gestão de Locações** (módulo completo, em dark launch), **Marketing**
(templates editáveis), **fichas** cadastrais (web), **agenda**, **calculadoras**, **bloco de
notas** e uma **área admin**. Versão publicada atual: **1.0.84** (auto-update via GitHub Releases).

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
- **Permissões granulares por pessoa** (concedidas no painel de Admin, nunca elevação em bloco): `marketing_gerenciar` (editar Marketing — NÃO herda de admin), `ti` (Suporte), `drives_fotografia`, `analise_locador`, `loc_beta` (acesso de teste às Locações). Perfil de Locação = claim `locRole` (gestor/administrativo/corretor) + `loc_financeiro`.
- **Escrita das coleções de Locação = SEMPRE via Cloud Function** (Admin SDK). Regras do Firestore negam write do cliente; leitura filtrada por `corretorUid` (regra de ouro). Idem cobranças/repasses (integridade do financeiro).
- **Portais externos** (proprietário/inquilino) são PÚBLICOS, sem login: o **token** (`portal_tokens`, `crypto.randomBytes`) é a credencial; cada função devolve só os dados daquela pessoa. **Anonymous Auth NUNCA pode ser habilitado** (o `getCredentials` confia em qualquer autenticado).
- **2FA (TOTP)** via Firebase MFA; **credenciais dos sistemas criptografadas** (KMS) em repouso; **auditoria** (`registrarAudit` → `audit_log`); **backup Firestore diário** (`gs://remax-smart-hub-backups/`, retenção 30d).

## Apps / autologin

- Catálogo em `hub-app.js` (array `APPS`): chave, categoria, título, url, `autologin`, `restrito`.
- Config de seletores de login por site em `main.js` (objeto `configs`). Sites ASP.NET, 2 etapas, CAPTCHA são tratados lá.
- **ClickSign**: app restrito; admin abre com login próprio; não-admin liberado usa conta compartilhada (autologin **preenche mas NÃO envia** — `naoEnviar: true` — por causa do reCAPTCHA; a pessoa resolve o captcha e clica Entrar). Credenciais por pessoa: CheckVisto e Motiva (esses não têm autologin).

## Funcionalidades

- **Sidebar** (`CATEGORIAS` em `hub-app.js`): Captação, CRM, Vistoria, **Locação** (Gestão de Locações), Performance, Treinamento, **Marketing**, ClickSign, Agenda, **Cadastro** (fichas), Fotografia, Reunião, Sala de Reunião, IA, Calculadoras, Bloco de Notas, WhatsApp, Suporte/TI, Configurações. Categorias podem ser ocultadas por permissão (`soTI`, `beta`, etc.) ou serem "app direto".
- **Gestão de Locações** (aba Locação, **dark launch** por `loc_beta`): módulo completo — captação (ficha do locador vira imóvel na esteira) → análise do locatário + garantia → contrato → cobrança/repasse → vistorias → alertas → relatórios (com export CSV). Sub-apps: Painel, Imóveis (esteira com filtro por status), Financeiro, Alertas, Relatórios, Fichas. **Checklist automático** (6 itens marcam sozinhos; esteira avança até "Aprovado" sozinha). **Portais externos** (Fase 1.5): proprietário vê repasses, inquilino vê pagamentos — por link/token, sem login (`public/portal-proprietario.html`, `portal-inquilino.html`). Detalhes completos na memória `project-gestao-locacoes`. Fase 2 (bancária) em `FASE-2-INTEGRACAO-BANCARIA.md`.
- **Marketing** (dinâmico, editável no painel): sanfonas + templates em Firestore `marketing_config/layout` (semente `MARKETING_SEED` + versão/merge); ⚙ Gerenciar (permissão `marketing_gerenciar`) edita/reordena/faz upload de HTML e capa pro Storage. Templates abrem em janela dedicada (`abrir-template` no `main.js`).
- **Cadastro / Fichas** (web, Firebase Hosting — NÃO vão no .exe): locador, PF, PJ, locação c/ fiador, vendedor, proposta, fiança (`public/ficha-*.html`). Cliente preenche por link (`geraLink`); upload de documentos com **download token próprio** (ver `project-fichas-documentos`). Com a Locação ativa, as fichas de locação migram pra Locação→Fichas.
- **Agenda** (`events` no Firestore): reuniões com participantes (ou "todos"); mini calendário + relógio; calendário completo; alerta 1h antes; **integra com Google Agenda/Tarefas**. Functions: `criarEvento`, `listarEventos`, `excluirEvento`, `listarPessoas`.
- **Calculadoras** (`public/calculadoras.html`): aluguel proporcional + multa rescisória (conferidas com o Excel do financeiro).
- **Bloco de Notas**: notas por usuário (`user_notes/{uid}`), autosave com debounce.
- **Documentos (Google Drive)**: embed da pasta do Drive — **desabilitado temporariamente** no `index.html` (limitação de service account/tamanho).
- **Configurações**: perfil (nome + foto, `user_profiles`, base64). Functions: `getMeuPerfil`, `salvarMeuPerfil`.
- **Admin**: credenciais dos sistemas (cripto KMS), códigos de convite, usuários (admin/excluir/**permissões granulares**), **painel de Lançamento** (controla o dark launch das Locações: "Publicar para todos"), banners (reordenáveis), "último app acessado".

## Como PUBLICAR uma nova versão (os 4 passos)

1. Ajustar os arquivos.
2. Subir a versão no `package.json` (ex.: `1.0.84` -> `1.0.85`).
3. `$env:GH_TOKEN="<token github com escopo repo>"; npm run publish` (compila o .exe e sobe pro GitHub Releases; auto-update pega).
4. `git add -A; git commit -m "..."; git push origin main`.

- `publish.releaseType` = `release` (sai publicado, não rascunho). Não usar `npm run build` sozinho pra distribuir.
- Link de download/instalação: `https://github.com/Goldencat7/remax-smart-hub/releases/latest`.
- Ícone do app: `build/icon.ico`.

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

### Gestão de Locações (Fase 1 + 1.5 prontas — 2026-07-08)
- **Publicar o `.exe`**: a UI nova de Locações (Painel/Alertas/Relatórios/filtro de imóveis/vincular ficha/portais) só chega aos corretores no próximo `npm run publish`. Backend + hosting já deployados; falta só o app.
- **Liberar pra todos**: quando aprovar, Admin → Lançamento → "Publicar para todos" (tira o dark launch do `loc_beta`).
- **Fase 2 — integração bancária (cobrança automática)**: BLOQUEADA por decisão + cadastro externo (conta no provedor + chave). Explicação completa e plano em **[`FASE-2-INTEGRACAO-BANCARIA.md`](FASE-2-INTEGRACAO-BANCARIA.md)**. Recomendação: Asaas. O terreno já está pronto (webhook-stub + `origemStatus`/`idExterno`).
- **Portal do inquilino — boleto/PIX**: a página já avisa "pagamento online em breve"; exibir o boleto real depende da Fase 2.
- **Refinamentos opcionais da Fase 1** (não bloqueiam; anexo de docs, auditoria financeira e painel do corretor JÁ feitos): faltam modelos de contrato + **assinatura eletrônica** (D-04, precisa provedor ClickSign/D4Sign/ZapSign) e **integração real do app de vistoria** (D-06, hoje é registro manual de link).

### App de celular (PWA) — pendência
- **Objetivo**: ter o Hub no celular **sem** autologin (a pessoa não precisa do login automático no cell). Dados já chegam simultâneos nos dois (Firestore é tempo real).
- **Caminho recomendado (PWA)**: mover a UI compartilhada (`index.html` + `hub-app.js` + `styles.css` + lógica) pro **Firebase Hosting**; o Electron vira casca que faz `loadURL(hosting)` e mantém só o autologin nativo. Assim `firebase deploy --only hosting` atualiza **desktop + celular juntos** (só o .exe é republicado quando mexer no autologin).
- **Precisa**: "shim de plataforma" (`if (window.hubApi) {…Electron…} else {…web…}`) pra esconder/adaptar autologin, `printToPDF`, janelas nativas no celular; `manifest.json` + service worker pra virar PWA instalável.
- **NÃO ter no celular**: autologin nos sistemas externos (impossível/reprovado em loja), abertura de janelas nativas, download de ficha via printToPDF (usar compartilhar/imprimir do próprio celular).
- **Loja (opcional)**: Capacitor/TWA pra Play Store/App Store — mas review da loja quebra o "update simultâneo", então PWA primeiro.

### Infra / segurança
- **Backup Firestore**: ✅ FUNCIONANDO. Export diário (03h) pra `gs://remax-smart-hub-backups/{data}`, SA de compute já tem `roles/datastore.importExportAdmin`, retenção de 30 dias (lifecycle Delete age=30). Backups presentes e íntegros (com `overall_export_metadata`). **Falta só**: testar um RESTORE (nunca validado) — importar um backup num destino que NÃO seja produção (projeto de staging ou um 2º banco Firestore) pra confirmar que os dados voltam íntegros.
- **App Check**: validar que as chamadas às Cloud Functions (inclusive fichas anônimas e portais públicos) vêm de origem legítima. reCAPTCHA Enterprise / Device Check.

### ✅ Já feito (era pendência, saiu)
- **2FA / MFA**: TOTP via Firebase MFA (v1.0.80).
- **Criptografia de credenciais em repouso**: KMS + descriptografia no `getCredentials` (v1.0.81).
- **Log de auditoria**: `registrarAudit` → `audit_log` cobre credenciais, permissões, perfil, marketing, exclusão de imóvel/chamado e **ações financeiras** (baixa/repasse/ajuste). Dá pra ampliar mais.
- **Backup Firestore**: export diário + retenção 30d, funcionando (ver Infra acima).
- **CI**: `node --check` a cada push (ver pendências — falta lint/testes).
- **Gestão de Locações Fase 1 + 1.5**: construída, publicada (v1.0.84) em dark launch.

### Ideias antigas (seguem em aberto)

- **Notificação WhatsApp via Meta Cloud API**: quando corretor recebe uma ficha, mandar mensagem automática no WhatsApp pessoal dele.
  - Precisa de: chip novo (qualquer operadora) para ser o número remetente da RE/MAX Smart.
  - Fluxo: Firestore `onCreate` em `fichas` → Cloud Function → Meta Cloud API → WhatsApp do corretor.
  - Corretor salva número pessoal nas Configurações do Hub.
  - Custo estimado: <$1/mês para 12 corretores (~30 fichas/mês, ~$0,02/conversa utility).
  - Setup: Meta for Developers → Meta Business Account → cadastrar número → aprovar template de mensagem (~24h) → token na Cloud Function.

- **Ambiente de staging** (projeto Firebase separado): testar mudanças sem risco de afetar produção. Criar um segundo projeto Firebase (ex.: `remax-smart-hub-staging`) e trocar config por variável de ambiente.

- **LGPD — retenção e exclusão de dados**: fichas guardam CPF, RG, renda. Implementar política de expurgo automático (ex.: 2 anos) e fluxo de exclusão a pedido do titular.

- **CI/CD**: ✅ parcial — `.github/workflows/ci.yml` roda `node --check` (CJS + módulos ES do renderer via cópia `.mjs`) e valida os JSONs a cada push/PR. Falta: lint, testes automatizados e bloquear deploy quebrado (o deploy/publish segue manual).

- **Monitoramento e alertas em tempo real**: parcial — há `relatorioErrosDiario` (schedule) + `logErro`. Falta alerta em tempo real (Cloud Monitoring / Slack) quando uma function falha.

- **Refatoração de arquivos monolíticos**: `hub-app.js` e `functions/index.js` têm milhares de linhas. Quebrar em módulos menores facilita manutenção e reduz risco de regressão.
