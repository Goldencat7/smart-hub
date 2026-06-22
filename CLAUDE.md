# Remax Smart Hub — contexto do projeto

App **Electron** (desktop Windows) da imobiliária RE/MAX Smart. Dá acesso rápido às
plataformas de trabalho com **autologin**, tem **login próprio** (Firebase), **agenda**,
**documentos** (Google Drive) e uma **área admin**.

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

## Apps / autologin

- Catálogo em `hub-app.js` (array `APPS`): chave, categoria, título, url, `autologin`, `restrito`.
- Config de seletores de login por site em `main.js` (objeto `configs`). Sites ASP.NET, 2 etapas, CAPTCHA são tratados lá.
- **ClickSign**: app restrito; admin abre com login próprio; não-admin liberado usa conta compartilhada (autologin **preenche mas NÃO envia** — `naoEnviar: true` — por causa do reCAPTCHA; a pessoa resolve o captcha e clica Entrar). Credenciais por pessoa: CheckVisto e Motiva (esses não têm autologin).

## Funcionalidades

- **Sidebar** com categorias (Captação, CRM, Vistoria, Locação, Performance, Treinamento, Agenda, Documentos, Configurações).
- **Agenda** (`events` no Firestore): admin marca reuniões e escolhe participantes (ou "todos"); cada um cria os próprios; mini calendário + relógio no painel direito; calendário completo na aba Agenda; alerta 1h antes. Functions: `criarEvento`, `listarEventos`, `excluirEvento`, `listarPessoas`.
- **Documentos**: embed da pasta do Google Drive (id `10dlIlDyGyvyMCZQUWbt2_YVDdXgfmlzp`, compartilhada "qualquer um com link: leitor"). Admin gerencia no Drive; o Hub só exibe. Sem upload pelo app (limitação de service account + tamanho).
- **Configurações**: perfil (nome + foto via upload, guardada em `user_profiles` no Firestore como base64 pequena). Functions: `getMeuPerfil`, `salvarMeuPerfil`.
- **Admin**: credenciais dos sistemas, códigos de convite, usuários (admin/excluir/permissões), "último app acessado".

## Como PUBLICAR uma nova versão (os 4 passos)

1. Ajustar os arquivos.
2. Subir a versão no `package.json` (ex.: `1.0.10` -> `1.0.11`).
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
