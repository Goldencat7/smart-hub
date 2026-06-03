const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEVTOOLS_HABILITADO
    }
  });
  janelaPrincipal.loadFile('login.html');
}

app.whenReady().then(() => {
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
      seletorBtn:  'button[type="submit"], input[type="submit"], form button, button'
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
                      credenciais.login, credenciais.password || '');
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
function abrirPwaComAutologin(url, seletorUser, seletorPass, seletorBtn, usuario, senha) {
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

  pwaWindow.webContents.on('did-fail-load', (_e, errCode, errDesc, failedUrl) => {
    console.error(`Falha ao carregar ${failedUrl}: [${errCode}] ${errDesc}`);
  });

  pwaWindow.loadURL(url).catch(err => console.error(`Erro ao carregar ${url}:`, err));

  pwaWindow.webContents.on('did-frame-finish-load', () => {
    const payload = { seletorUser, seletorPass, seletorBtn, usuario, senha };

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
        function visivel(el){
          if(!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        }
        function achar(sel){
          const lista = Array.from(document.querySelectorAll(sel));
          return lista.find(visivel) || lista[0] || null;
        }
        function acharPorTexto(termos){
          const elementos = Array.from(document.querySelectorAll(
            'button, input[type="submit"], input[type="button"], input[type="image"], a, [role="button"]'
          ));
          for(const termo of termos){
            const t = termo.toLowerCase();
            const achado = elementos.find(el => {
              if(!visivel(el)) return false;
              const texto = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
              return texto.includes(t);
            });
            if(achado) return achado;
          }
          return null;
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

          if(etapa === 'aguardando-usuario' && tentativas > 8){
            const sinalLogin = inputPass || acharPorTexto(['continuar','próximo','proximo','avançar','avancar','prosseguir']);
            if(!sinalLogin){
              clearInterval(intervalo);
              banner('parece já logado — pulando autologin.', '#0a7a3a', 3000);
              return;
            }
          }

          if(etapa === 'aguardando-usuario' && inputUser){
            setNativeValue(inputUser, cfg.usuario);
            disparar(inputUser);

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
              setNativeValue(inputPass, cfg.senha);
              disparar(inputPass);
            }

            const captchaCandidatos = Array.from(document.querySelectorAll(
              'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], ' +
              '.g-recaptcha, .h-captcha, .cf-turnstile'
            ));
            const captchaVisivel = captchaCandidatos.find(el => {
              const r = el.getBoundingClientRect();
              return r.width > 30 && r.height > 30 && getComputedStyle(el).visibility !== 'hidden';
            });
            if(captchaVisivel){
              clearInterval(intervalo);
              banner('CAPTCHA detectado — resolva e clique em Continuar.', '#b8860b', 8000);
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
            setNativeValue(inputPass, cfg.senha);
            disparar(inputPass);
            setTimeout(() => {
              const btn2 = achar(cfg.seletorBtn)
                        || acharPorTexto(['entrar','login','acessar','enviar','continuar','sign in','log in']);
              if(btn2 && !btn2.disabled) btn2.click();
              else inputPass.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
              try { sessionStorage.setItem('__hubLogadoOk','1'); } catch(e){}
              banner('senha enviada.', '#0a7a3a', 3000);
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
