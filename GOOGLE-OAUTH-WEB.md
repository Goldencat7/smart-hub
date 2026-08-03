# Conectar Google no navegador (web/PWA) — o que falta no Google Cloud

O **código já está pronto** (página de callback + fluxo no `platform-web.js` + botão reexibido no web). Falta **1 passo no Google Cloud Console** que só você faz — sem ele o Google recusa o retorno com "redirect_uri_mismatch".

## O ponto: o tipo do cliente OAuth

Hoje o `.exe` usa o cliente OAuth `474454438949-…` com um endereço de retorno **`127.0.0.1` (loopback)**. Isso funciona porque ele é (provavelmente) do tipo **"App para computador / Desktop"**. Cliente Desktop **não aceita** endereço de retorno `https://` — que é o que a web precisa.

Então, no **Google Cloud Console → APIs e Serviços → Credenciais** (projeto `remax-smart-hub`), abra o cliente `474454438949-…` e veja o **Tipo**:

### Caso A — ele já é "Aplicativo da Web"
Só adicione, em **URIs de redirecionamento autorizados**, estes dois:
```
https://remax-smart-hub.web.app/app/google-callback.html
https://smarthubapp.com.br/app/google-callback.html
```
Salve. **Nada mais precisa mudar** — o mesmo Client ID/secret já é usado pela Cloud Function. Me avisa que a gente testa.

### Caso B — ele é "App para computador / Desktop" (mais provável)
Aí crie um **cliente OAuth novo** do tipo **"Aplicativo da Web"**:
1. **+ Criar credenciais → ID do cliente OAuth → Tipo: Aplicativo da Web**.
2. Nome: `REMAX Smart Hub — Web`.
3. **URIs de redirecionamento autorizados** → adicione os dois de cima (`…web.app/app/google-callback.html` e `…smarthubapp.com.br/app/google-callback.html`).
4. Criar → ele te dá um **Client ID** novo e um **Client secret** novo.
5. Me manda o **Client ID** novo (pode colar aqui — Client ID não é segredo).
6. O **secret** novo você seta você mesmo, sem me mostrar:
   ```bash
   firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
   ```
   (cola o secret quando pedir). ⚠️ Isso troca o secret pro **web**; enquanto o `.exe` ainda existir, ele precisa do secret **antigo** — então no dia da migração online-only a gente ajusta o backend pra escolher o cliente certo por origem (te explico na hora). Como estamos indo pra online-only mesmo, o caminho natural é o web virar o único.

> Em quase todo caso é o **B**. Se for o B, quando você me passar o Client ID novo eu troco em **2 lugares** (`pwa/platform-web.js` e `functions/index.js`) e a gente deixa o backend escolhendo cliente por origem pro `.exe` não quebrar no meio do caminho.

## Confirme que as APIs estão ligadas
Já devem estar (o desktop usa): **Google Calendar API**, **Tasks API**, **Drive API**. Se o teste reclamar de API desabilitada, é só ativar em "APIs e Serviços → Biblioteca".

## Como a gente testa (quando o cliente estiver pronto)
1. `npm run deploy:pwa` (sobe o app com a página de callback).
2. Abre `https://remax-smart-hub.web.app/app/` logado → **Meu Perfil → Conectar Google**.
3. Deve abrir o consentimento do Google → voltar pro Hub → "Conta Google conectada! ✅".
4. Confere na tela que o botão ficou "Google ✓".

## Resumo do que o código já faz (pronto, commitado, NÃO publicado)
- `pwa/google-callback.html` — página de retorno (confere `state`, chama `conectarGoogleAgenda`).
- `pwa/platform-web.js` — `conectarGoogle()` faz PKCE + redireciona; botão reexibido.
- `hub-app.js` — não tenta finalizar no web (`redirecting`); avisa o resultado ao voltar.
- `scripts/build-pwa.js` — inclui a `google-callback.html` no build.
- Backend (`conectarGoogleAgenda`) **não mudou** — já aceita o `redirectUri` da web.
