const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ─── Preferências locais (arquivo no userData) ──────────────────────────────
function prefsPath() { return path.join(app.getPath('userData'), 'hub-prefs.json'); }
function lerPrefs() { try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch (e) { return {}; } }
function salvarPrefs(p) { try { fs.writeFileSync(prefsPath(), JSON.stringify(p)); } catch (e) {} }

// Iniciar com o Windows: ligado por padrão na primeira vez (só vale no app instalado).
function iniciarComWindowsAtivo() {
  if (app.isPackaged) return app.getLoginItemSettings().openAtLogin;
  return lerPrefs().iniciarComWindows !== false; // no modo dev, reflete só a preferência
}
function definirIniciarComWindows(ligar) {
  const p = lerPrefs(); p.iniciarComWindows = !!ligar; salvarPrefs(p);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!ligar });
}
function aplicarPadraoIniciarComWindows() {
  const p = lerPrefs();
  if (p.iniciarComWindows === undefined) definirIniciarComWindows(true); // 1ª vez: liga
}

// ─── Google OAuth (conectar a Google Agenda) ────────────────────────────────
// O Google não deixa logar dentro do Electron, então abrimos o navegador real
// e capturamos a resposta num servidor local (loopback). A troca do "code" pela
// permissão acontece no servidor (Cloud Function), não aqui — a chave secreta
// nunca entra no app.
const GOOGLE_CLIENT_ID = '474454438949-8hu3emcu98oa9pb92qcd7ucq9elhj9nc.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Permite sites HTTP antigos e ignora cert errors
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');

// ─── Auto-update via GitHub Releases ────────────────────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  console.log('Atualização disponível:', info.version);
});

autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Atualização pronta',
    message: `Versão ${info.version} foi baixada.`,
    detail: 'Reinicie o Hub para aplicar a atualização.',
    buttons: ['Reiniciar agora', 'Depois'],
    defaultId: 0
  }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
});

autoUpdater.on('error', (err) => {
  console.warn('Erro no auto-updater:', err.message);
});

// DevTools só no modo desenvolvedor. No .exe distribuído fica desligado
// pra usuário comum não conseguir bisbilhotar as credenciais compartilhadas.
const DEVTOOLS_HABILITADO = !app.isPackaged;

let janelaPrincipal = null;

function criarJanelaPrincipal() {
  janelaPrincipal = new BrowserWindow({
    width: 1100,
    height: 760,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1218', symbolColor: '#f5f7fa', height: 45 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEVTOOLS_HABILITADO
    }
  });
  // Links de arquivos (ex.: documentos do Drive) abrem numa janela nova
  janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      const w = new BrowserWindow({
        width: 1200, height: 800, autoHideMenuBar: true,
        webPreferences: { devTools: DEVTOOLS_HABILITADO }
      });
      w.loadURL(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  janelaPrincipal.loadFile('login.html');
}

app.whenReady().then(() => {
  aplicarPadraoIniciarComWindows();
  criarJanelaPrincipal();
  // Verifica updates 3s após abrir (não bloqueia o login)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(e => console.warn('Update check:', e.message));
    }, 3000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanelaPrincipal();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Navegação da janela principal ───────────────────────────────────────────
ipcMain.on('login-concluido', () => {
  if (janelaPrincipal) janelaPrincipal.loadFile('index.html');
});

ipcMain.on('voltar-para-login', () => {
  if (janelaPrincipal) janelaPrincipal.loadFile('login.html');
});

ipcMain.on('abrir-admin', () => {
  if (janelaPrincipal) janelaPrincipal.loadFile('admin.html');
});

ipcMain.on('voltar-para-hub', () => {
  if (janelaPrincipal) janelaPrincipal.loadFile('index.html');
});

// ─── Iniciar com o Windows (lido/alterado nas Configurações) ─────────────────
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-iniciar-windows', () => iniciarComWindowsAtivo());
ipcMain.handle('set-iniciar-windows', (_e, ligar) => { definirIniciarComWindows(ligar); return { ok: true }; });

// ─── Conectar Google Agenda (fluxo OAuth no navegador externo) ───────────────
// Devolve { ok, code, codeVerifier, redirectUri } pro renderer, que então chama
// a Cloud Function pra finalizar. Usa PKCE (S256) por segurança.
ipcMain.handle('conectar-google', async () => {
  return await new Promise((resolve) => {
    const codeVerifier  = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(16));
    let redirectUri = '';
    let resolvido = false;
    const finalizar = (r) => { if (!resolvido) { resolvido = true; resolve(r); } };

    const server = http.createServer((reqH, resH) => {
      try {
        const url = new URL(reqH.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { resH.writeHead(404); resH.end(); return; }
        const code     = url.searchParams.get('code');
        const retState = url.searchParams.get('state');
        const erro     = url.searchParams.get('error');
        resH.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resH.end('<!doctype html><html lang="pt-br"><meta charset="utf-8"><body style="font-family:system-ui,Segoe UI,Arial;text-align:center;padding-top:64px;background:#0e1117;color:#e6e6e6"><h2>Pronto! ✅</h2><p>Pode fechar esta aba e voltar ao Hub.</p></body></html>');
        server.close();
        if (erro) return finalizar({ ok: false, erro });
        if (retState !== state) return finalizar({ ok: false, erro: 'Resposta inválida (state).' });
        if (!code) return finalizar({ ok: false, erro: 'Sem código de autorização.' });
        finalizar({ ok: true, code, codeVerifier, redirectUri });
      } catch (e) {
        finalizar({ ok: false, erro: e.message });
      }
    });

    server.on('error', (e) => finalizar({ ok: false, erro: e.message }));

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
      shell.openExternal(authUrl);
    });

    // Desiste após 5 min se a pessoa não concluir.
    setTimeout(() => { try { server.close(); } catch (e) {} finalizar({ ok: false, erro: 'Tempo esgotado.' }); }, 300000);
  });
});

// ─── Abre uma janela do PWA (com ou sem autologin) ───────────────────────────
ipcMain.on('abrir-app', (_evt, payload) => {
  const { siteKey, url, credenciais } = payload || {};
  if (!url) return;

  // Configuração específica por site
  const configs = {
    forsale: {
      seletorUser: '#lgvUser_Logar_UserName, input[name="lgvUser$Logar$UserName"], input[type="text"]',
      seletorPass: '#lgvUser_Logar_Password, input[name="lgvUser$Logar$Password"], input[type="password"]',
      seletorBtn:  '#lgvUser_Logar_imgLogar, input[type="image"], input[type="submit"], button'
    },
    sp_imovel: {
      seletorUser: '#txtbUsuario, input[name="txtbUsuario"], input[type="text"], input[name*="usuario" i]',
      seletorPass: '#txtbSenha, input[name="txtbSenha"], input[type="password"]',
      seletorBtn:  '#btnLogar, input[name="btnLogar"], input[type="submit"], button'
    },
    alude: {
      seletorUser: 'input[type="email"], input[name*="email" i], input[name*="user" i], input[autocomplete="username"], input[autocomplete="email"], input[placeholder*="mail" i]',
      seletorPass: 'input[type="password"], input[name*="senha" i], input[name*="pass" i], input[placeholder*="senha" i]',
      seletorBtn:  'button[type="submit"], form button, button'
    },
    clicksign: {
      seletorUser: 'input[name="user[email]"], #user_email, input[type="email"], input[name*="email" i], input[autocomplete="username"]',
      seletorPass: 'input[name="user[password]"], #user_password, input[type="password"], input[name*="password" i]',
      seletorBtn:  'button[type="submit"], input[type="submit"]',
      // ClickSign tem reCAPTCHA: preenche tudo mas NÃO clica em Entrar
      // (evita tentativa falha/bloqueio). A pessoa clica e resolve o captcha.
      naoEnviar: true
    },
    cadastro_imobiliario: {
      seletorUser: 'input[type="text"], input[name="username"], input[name="login"]',
      seletorPass: 'input[type="password"]',
      seletorBtn:  'button[type="submit"], input[type="submit"], form button'
    },
    imovelp: {
      seletorUser: 'input[type="email"], input[name*="email" i], input[type="text"]',
      seletorPass: 'input[type="password"]',
      seletorBtn:  'button[type="submit"], form button, button'
    }
  };

  if (!credenciais) {
    // Apps sem autologin (Smart Vistorias / Motiva)
    abrirJanelaSimples(url);
    return;
  }

  const cfg = configs[siteKey];
  if (!cfg) {
    console.error('Sem configuração de autologin para', siteKey);
    abrirJanelaSimples(url);
    return;
  }

  abrirPwaComAutologin(url, cfg.seletorUser, cfg.seletorPass, cfg.seletorBtn,
                      credenciais.login, credenciais.password || '', { naoEnviar: !!cfg.naoEnviar });
});

// ─── Janela simples (sem autologin) ──────────────────────────────────────────
function abrirJanelaSimples(url) {
  const win = new BrowserWindow({
    width: 1200, height: 800, autoHideMenuBar: true,
    webPreferences: { devTools: DEVTOOLS_HABILITADO }
  });
  win.loadURL(url).catch(err => console.error(`Erro ao carregar ${url}:`, err));
}

// ─── Janela com autologin ────────────────────────────────────────────────────
function abrirPwaComAutologin(url, seletorUser, seletorPass, seletorBtn, usuario, senha, opcoes = {}) {
  const partition = `inmem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const pwaWindow = new BrowserWindow({
    width: 1200, height: 800, autoHideMenuBar: true,
    webPreferences: {
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition,
      devTools: DEVTOOLS_HABILITADO
    }
  });

  // Páginas com muitos iframes (reCAPTCHA etc.) podem estourar o limite padrão de listeners
  pwaWindow.webContents.setMaxListeners(50);

  pwaWindow.webContents.on('did-fail-load', (_e, errCode, errDesc, failedUrl, isMainFrame) => {
    // Ignora falhas de subframes (reCAPTCHA, anúncios) — só registra a página principal
    if (isMainFrame) console.error(`Falha ao carregar ${failedUrl}: [${errCode}] ${errDesc}`);
  });

  pwaWindow.loadURL(url).catch(() => {}); // falhas reais já vêm pelo did-fail-load

  // Injeta no dom-ready (cedo, e uma vez por carregamento — não por frame)
  pwaWindow.webContents.on('dom-ready', () => {
    const payload = { seletorUser, seletorPass, seletorBtn, usuario, senha, naoEnviar: !!opcoes.naoEnviar };

    const scriptLoop = `
      (function(){
        if (window.__hubAutologinAtivo) return;
        window.__hubAutologinAtivo = true;
        try { if (sessionStorage.getItem('__hubLogadoOk') === '1') return; } catch(e) {}

        const cfg = ${JSON.stringify(payload)};

        function banner(msg, cor, sumirEm){
          let b = document.getElementById('__hub-banner');
          if(!b){
            b = document.createElement('div');
            b.id = '__hub-banner';
            b.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:280px;padding:8px 12px;border-radius:8px;font:600 12px/1.4 system-ui,Segoe UI,Arial;color:#fff;background:#0043ff;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;opacity:.95;transition:opacity .3s ease';
            document.documentElement.appendChild(b);
          }
          b.style.background = cor || '#0043ff';
          b.style.opacity = '0.95';
          b.textContent = '[Hub] ' + msg;
          if(window.__hubBannerTimer) clearTimeout(window.__hubBannerTimer);
          if(sumirEm){
            window.__hubBannerTimer = setTimeout(() => {
              b.style.opacity = '0';
              setTimeout(() => b.remove(), 400);
            }, sumirEm);
          }
        }
        function setNativeValue(el, value) {
          const proto = Object.getPrototypeOf(el);
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(el, value);
        }
        function disparar(el){
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
        // Preenche simulando digitação real — frameworks (React/Ember/Vue) "enxergam" o valor
        function preencher(el, valor){
          if(!el) return;
          try { el.focus(); } catch(e){}
          let ok = false;
          try {
            try { el.select(); } catch(e){}
            try { document.execCommand('selectAll', false, null); } catch(e){}
            ok = document.execCommand('insertText', false, valor);
          } catch(e){}
          if(!ok || el.value !== valor){
            setNativeValue(el, valor);
            // truque pro framework detectar a mudança (React usa _valueTracker)
            if(el._valueTracker){ try { el._valueTracker.setValue(' '); } catch(e){} }
          }
          disparar(el);
        }
        function visivel(el){
          if(!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        }
        function achar(sel){
          const lista = Array.from(document.querySelectorAll(sel));
          return lista.find(visivel) || lista[0] || null;
        }
        // Detecta botões de "mostrar/ocultar senha" (olho) pra NUNCA clicar neles
        function ehMostrarSenha(el){
          if(!el || el.type === 'submit') return false;
          const s = ((el.getAttribute('aria-label')||'') + ' ' + (el.getAttribute('title')||'') + ' ' +
                     (el.className||'') + ' ' + (el.innerText || el.value || '')).toLowerCase();
          if(/eye|olho|password-toggle|toggle-password|show-password|reveal/.test(s)) return true;
          return /senha|password/.test(s) && /(mostrar|ocultar|exibir|esconder|ver|show|hide|toggle)/.test(s);
        }
        function acharPorTexto(termos){
          const elementos = Array.from(document.querySelectorAll(
            'button, input[type="submit"], input[type="button"], input[type="image"], a, [role="button"]'
          ));
          for(const termo of termos){
            const t = termo.toLowerCase();
            const achado = elementos.find(el => {
              if(!visivel(el)) return false;
              if(ehMostrarSenha(el)) return false;
              const texto = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
              return texto.includes(t);
            });
            if(achado) return achado;
          }
          return null;
        }
        // Mantém o campo de senha SEMPRE oculto, mesmo se clicarem no "olho"
        function blindarSenha(el){
          if(!el) return;
          if(el.type !== 'password') { try { el.type = 'password'; } catch(e){} }
          if(el.__hubBlindado) return;
          el.__hubBlindado = true;
          try {
            const obs = new MutationObserver(() => {
              if(el.type !== 'password') el.type = 'password';
            });
            obs.observe(el, { attributes: true, attributeFilter: ['type'] });
          } catch(e){}
          // Bloqueia o clique no botão de "mostrar senha" (olho) — reforço
          if(!window.__hubBloqueioOlho){
            window.__hubBloqueioOlho = true;
            document.addEventListener('click', function(e){
              let n = e.target;
              for(let i=0; i<4 && n; i++){
                if(ehMostrarSenha(n)){ e.preventDefault(); e.stopPropagation(); return; }
                n = n.parentElement;
              }
            }, true);
          }
        }
        function temCaptchaVisivel(){
          const cands = Array.from(document.querySelectorAll(
            'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], ' +
            '.g-recaptcha, .h-captcha, .cf-turnstile'
          ));
          return cands.some(el => {
            if(el.closest && el.closest('.grecaptcha-badge')) return false; // ignora o selo flutuante
            const r = el.getBoundingClientRect();
            // o desafio interativo ("Não sou um robô") é grande; o selo é pequeno
            return r.width > 150 && r.height > 60 && getComputedStyle(el).visibility !== 'hidden';
          });
        }

        const precisaSenha = cfg.senha !== '';
        let etapa = 'aguardando-usuario';
        let tentativas = 0;
        const max = 40;
        banner('procurando campos de login...');

        const intervalo = setInterval(() => {
          tentativas++;
          if(tentativas > max){
            clearInterval(intervalo);
            banner('campos não encontrados. Login manual.', '#8a0e1c');
            return;
          }

          const inputUser = achar(cfg.seletorUser);
          const inputPass = precisaSenha ? achar(cfg.seletorPass) : null;
          const btn       = achar(cfg.seletorBtn);

          // Blinda a senha assim que o campo existir (nunca deixa revelar)
          if(inputPass) blindarSenha(inputPass);

          if(etapa === 'aguardando-usuario' && tentativas > 8){
            const sinalLogin = inputPass || acharPorTexto(['continuar','próximo','proximo','avançar','avancar','prosseguir']);
            if(!sinalLogin){
              clearInterval(intervalo);
              banner('parece já logado — pulando autologin.', '#0a7a3a', 3000);
              return;
            }
          }

          if(etapa === 'aguardando-usuario' && inputUser){
            preencher(inputUser, cfg.usuario);

            if(precisaSenha && !inputPass){
              banner('usuário preenchido, clicando em Continuar...');
              etapa = 'aguardando-senha';
              setTimeout(() => {
                const btnNext = acharPorTexto(['continuar','próximo','proximo','avançar','avancar','next','entrar','prosseguir'])
                             || achar('button[type="submit"], button');
                if(btnNext) btnNext.click();
                else inputUser.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
              }, 400);
              return;
            }

            if(precisaSenha && inputPass){
              preencher(inputPass, cfg.senha);
              blindarSenha(inputPass);
            }

            // Sites com reCAPTCHA: preenche mas não envia (a pessoa clica + resolve)
            if(cfg.naoEnviar){
              clearInterval(intervalo);
              banner('Senha preenchida. Clique em Entrar e resolva o CAPTCHA.', '#0043ff', 20000);
              return;
            }

            if(temCaptchaVisivel()){
              clearInterval(intervalo);
              banner('CAPTCHA detectado — resolva e clique em Entrar.', '#b8860b', 9000);
              return;
            }

            setTimeout(() => {
              const alvoEnter = inputPass || inputUser;
              const btnFinal = (btn && !btn.disabled) ? btn
                            : acharPorTexto(['entrar','login','acessar','enviar','continuar','sign in','log in']);
              const onclickAttr = (btnFinal && btnFinal.getAttribute && btnFinal.getAttribute('onclick')) || '';
              const ehASPNET_onclick = /postback|__doPostBack|WebForm_/i.test(onclickAttr);
              const ehASPNET_viewstate = !!document.querySelector('input[name="__VIEWSTATE"], input[name="__EVENTTARGET"]');
              const isASPNET = ehASPNET_onclick || ehASPNET_viewstate;
              let enviou = false;

              if(btnFinal && !btnFinal.disabled){
                if(isASPNET){
                  try { btnFinal.click(); enviou = true; } catch(e){}
                } else {
                  try { btnFinal.click(); enviou = true; } catch(e){}
                  ['keydown','keypress','keyup'].forEach(tipo => {
                    alvoEnter.dispatchEvent(new KeyboardEvent(tipo, {
                      key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true
                    }));
                  });
                  const form = (alvoEnter.closest && alvoEnter.closest('form'));
                  if(form){
                    try {
                      if(typeof form.requestSubmit === 'function') form.requestSubmit();
                      else form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
                      enviou = true;
                    } catch(e){}
                  }
                }
              }

              try { sessionStorage.setItem('__hubLogadoOk','1'); } catch(e){}
              banner(enviou ? 'login enviado.' : 'tentativa de submit.', '#0a7a3a', 3000);
            }, 700);

            clearInterval(intervalo);
            return;
          }

          if(etapa === 'aguardando-senha' && inputPass){
            preencher(inputPass, cfg.senha);
            blindarSenha(inputPass);
            // Segurança: garante que a senha NÃO fique visível
            try { if(inputPass.type === 'text') inputPass.type = 'password'; } catch(e){}

            // Sites com reCAPTCHA (ClickSign): preenche mas NÃO envia — a pessoa
            // clica em Entrar e resolve o captcha (evita tentativa falha/bloqueio).
            if(cfg.naoEnviar){
              clearInterval(intervalo);
              banner('Senha preenchida. Clique em Entrar e resolva o CAPTCHA.', '#0043ff', 20000);
              return;
            }

            // CAPTCHA já visível antes de enviar (alguns sites): para e deixa resolver.
            if(temCaptchaVisivel()){
              clearInterval(intervalo);
              banner('CAPTCHA detectado — resolva e clique em Entrar.', '#b8860b', 15000);
              return;
            }

            setTimeout(() => {
              try { if(inputPass.type === 'text') inputPass.type = 'password'; } catch(e){}
              // Prefere o botão de enviar de verdade (texto), depois type=submit — nunca o "olho"
              const btn2 = acharPorTexto(['entrar','acessar','fazer login','login','sign in','log in','enviar'])
                        || achar('button[type="submit"], input[type="submit"]');
              if(btn2 && !btn2.disabled) btn2.click();
              else inputPass.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
              try { sessionStorage.setItem('__hubLogadoOk','1'); } catch(e){}
              // ClickSign mostra o reCAPTCHA SÓ DEPOIS de clicar em Entrar — checa de novo
              setTimeout(() => {
                if(temCaptchaVisivel())
                  banner('CAPTCHA detectado — resolva e clique em Entrar.', '#b8860b', 15000);
                else
                  banner('login enviado.', '#0a7a3a', 3000);
              }, 1800);
            }, 600);
            clearInterval(intervalo);
            return;
          }
        }, 500);
      })();
    `;

    pwaWindow.webContents.executeJavaScript(scriptLoop)
      .catch(e => console.error('Erro na injeção:', e));
  });
}
