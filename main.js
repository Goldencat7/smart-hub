const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ─── Servidor local pros templates de Marketing ─────────────────────────────
// Os templates são HTMLs auto-empacotados (fontes/scripts em base64 viram blob:
// em runtime). Sob file://, o blob herda origem "null" e a 1ª tentativa de
// carregar cada recurso falha (o template tem fallback, mas gera erros no console).
// Servindo por http://127.0.0.1 a origem fica válida e os erros somem na raiz.
// fs.readFile lê de dentro do asar normalmente, então funciona no .exe instalado.
const MARKETING_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2'
};
let servidorMarketing = null; // { url } depois de iniciado

function iniciarServidorMarketing() {
  if (servidorMarketing) return Promise.resolve(servidorMarketing);
  return new Promise((resolve, reject) => {
    const baseDir = path.join(__dirname, 'marketing');
    const server = http.createServer((req, res) => {
      try {
        const nome = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
        const alvo = path.join(baseDir, nome);
        // Proteção contra path traversal: o arquivo tem que ficar dentro de marketing/.
        // Usa baseDir + separador pra não deixar passar pasta-irmã (ex.: marketing2/).
        if (alvo !== baseDir && !alvo.startsWith(baseDir + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
        fs.readFile(alvo, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
          const mime = MARKETING_MIME[path.extname(alvo).toLowerCase()] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mime });
          res.end(data);
        });
      } catch (e) { res.writeHead(500); res.end('Error'); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      servidorMarketing = { url: `http://127.0.0.1:${port}`, server };
      resolve(servidorMarketing);
    });
  });
}

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
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive.file';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sites legados de autologin às vezes têm certificado quebrado/expirado e conteúdo misto.
// Antes a verificação TLS era desligada no app INTEIRO — o que expunha o login do Firebase
// e as Cloud Functions a interceptação (MITM). Agora a leniência de certificado vale só
// para as janelas que abrem esses sites de terceiros (ver 'certificate-error' abaixo).
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests');

// webContents.id das janelas de autologin/PWA autorizadas a aceitar cert inválido.
const contentsComCertLiberado = new Set();

// Fixa (pin) o certificado de cada site legado na 1ª vez que ele aparece — como o
// known_hosts do SSH. Se o certificado mudar depois, REGISTRA o aviso e re-fixa
// (confia no novo) em vez de bloquear: esses sites trocam de cert com frequência,
// e bloquear derrubaria o autologin. O log fica de rastro caso um dia precise
// investigar (mudança pode ser rotação legítima OU, em tese, um MITM).
function certPinsPath() { return path.join(app.getPath('userData'), 'cert-pins.json'); }
function lerCertPins() { try { return JSON.parse(fs.readFileSync(certPinsPath(), 'utf8')); } catch (e) { return {}; } }
function salvarCertPins(p) { try { fs.writeFileSync(certPinsPath(), JSON.stringify(p)); } catch (e) { /* disco cheio/sem permissão — segue confiando */ } }

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Fora das janelas de autologin/PWA: verificação TLS padrão (Firebase, Google, o Hub).
  if (!webContents || !contentsComCertLiberado.has(webContents.id)) { callback(false); return; }

  const fingerprint = certificate && certificate.fingerprint;
  let host; try { host = new URL(url).host; } catch (_) { host = null; }
  if (!fingerprint || !host) { event.preventDefault(); callback(true); return; } // sem dados p/ pin: mantém o comportamento antigo

  const pins = lerCertPins();
  if (pins[host] && pins[host] !== fingerprint) {
    // Certificado mudou desde a 1ª vez — registra e re-fixa (não bloqueia).
    console.warn(`[cert] ${host}: certificado mudou (${pins[host]} → ${fingerprint}). Re-fixando (site legado).`);
  }
  pins[host] = fingerprint;
  salvarCertPins(pins);
  event.preventDefault();
  callback(true);
});

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
let forcandoSaida = false; // true quando o fechamento é intencional (botão "Fechar tudo", update, etc.)

function criarJanelaPrincipal() {
  janelaPrincipal = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false, // só mostra depois de maximizar — evita o "pulo" da janela pequena pra cheia
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

  janelaPrincipal.once('ready-to-show', () => {
    janelaPrincipal.maximize();
    janelaPrincipal.show();
  });

  // Impede fechar o Hub enquanto houver janelas de sistemas abertas (evita ficar
  // "trancado pra fora": a sub-janela segura o app vivo, mas a principal some).
  janelaPrincipal.on('close', (e) => {
    if (forcandoSaida) return;
    const subs = BrowserWindow.getAllWindows().filter(w => w !== janelaPrincipal && !w.isDestroyed());
    if (subs.length === 0) return; // sem sub-janelas: fecha normal
    e.preventDefault();
    dialog.showMessageBox(janelaPrincipal, {
      type: 'warning',
      title: 'Há janelas abertas',
      message: `Você tem ${subs.length} janela(s) de sistema aberta(s).`,
      detail: 'Feche as janelas dos sistemas antes de sair — ou clique em "Fechar tudo" para encerrar o Hub e todas as janelas abertas.',
      buttons: ['Cancelar', 'Fechar tudo'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response === 1) {
        forcandoSaida = true;
        BrowserWindow.getAllWindows().forEach(w => {
          if (w !== janelaPrincipal) { try { w.destroy(); } catch (_) {} }
        });
        janelaPrincipal.close();
      }
    });
  });
  // Links de arquivos (ex.: documentos do Drive) abrem numa janela nova.
  // Documentos das fichas (Firebase Storage) vão pro navegador padrão — o
  // visualizador de PDF do navegador é mais confiável que a janela Electron.
  janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/firebasestorage\.googleapis\.com\//i.test(url)) {
      shell.openExternal(url);
    } else if (/^https?:\/\//i.test(url)) {
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

// Qualquer saída programática (update, app.quit) libera o bloqueio do fechamento.
app.on('before-quit', () => { forcandoSaida = true; });

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

// ─── "Meus Negócios" (visão nova do Broker) em janela própria ────────────────
// Como abrir um app: janela dedicada carregando broker.html. Singleton — se já
// estiver aberta, só foca (não abre várias). A sessão Firebase é a mesma do Hub
// (janelas file:// dividem o IndexedDB), então o Broker já entra logado.
let janelaMeusNegocios = null;
ipcMain.on('abrir-meus-negocios', (_e, role) => {
  const papel = ['broker', 'corretor', 'administrativo'].includes(role) ? role : 'corretor';
  if (janelaMeusNegocios && !janelaMeusNegocios.isDestroyed()) {
    if (janelaMeusNegocios.isMinimized()) janelaMeusNegocios.restore();
    // Defensivo: se reaberta com papel diferente do carregado, recarrega o certo.
    if (janelaMeusNegocios._papel !== papel) {
      janelaMeusNegocios._papel = papel;
      janelaMeusNegocios.loadFile('broker.html', { query: { role: papel } });
    }
    janelaMeusNegocios.focus();
    return;
  }
  const w = new BrowserWindow({
    width: 1280, height: 860,
    show: false,
    autoHideMenuBar: true,
    title: 'Meus Negócios — REMAX Smart',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEVTOOLS_HABILITADO
    }
  });
  janelaMeusNegocios = w;
  w._papel = papel;
  w.once('ready-to-show', () => { w.maximize(); w.show(); });
  w.on('closed', () => { janelaMeusNegocios = null; });
  w.loadFile('broker.html', { query: { role: papel } });
});

// Fecha a janela que enviou (usado pelo "Voltar ao Hub" do Broker). Nunca fecha a principal.
ipcMain.on('fechar-janela', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w !== janelaPrincipal && !w.isDestroyed()) w.close();
});

// ─── Abrir link no navegador padrão do Windows ───────────────────────────────
// Saída de emergência do aviso de status: quando a janela nativa de um app não
// está confiável (hoje o CheckVisto), o aviso oferece abrir o site no navegador.
// Só http/https — qualquer outro esquema (file:, javascript:) seria abrir a porta
// pra o shell executar coisa arbitrária.
ipcMain.on('abrir-no-navegador', (_e, url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return;
  shell.openExternal(u).catch(err => console.warn('Abrir no navegador:', err.message));
});

// ─── Iniciar com o Windows (lido/alterado nas Configurações) ─────────────────
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-iniciar-windows', () => iniciarComWindowsAtivo());
ipcMain.handle('set-iniciar-windows', (_e, ligar) => { definirIniciarComWindows(ligar); return { ok: true }; });

// ─── Baixar ficha como PDF ───────────────────────────────────────────────────
ipcMain.handle('baixar-ficha-pdf', async (_e, { url, filename }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: filename || 'ficha.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled) return { ok: false };

  const win = new BrowserWindow({ width: 900, height: 860, show: false, webPreferences: { devTools: false } });
  try {
    await win.loadURL(url);
    await new Promise(r => setTimeout(r, 2500)); // aguarda render base (dados/imagens)
    // PDFs anexados são renderizados de forma assíncrona (doc-preview.js seta
    // window.__docsProntos). Espera até 20s por isso antes de imprimir.
    for (let i = 0; i < 40; i++) {
      const prontos = await win.webContents.executeJavaScript('window.__docsProntos !== false').catch(() => true);
      if (prontos) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 400)); // pequena folga pro layout assentar
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 1 });
    await fs.promises.writeFile(result.filePath, pdf);
    shell.openPath(result.filePath);
    return { ok: true };
  } catch (err) {
    console.error('Erro ao gerar PDF:', err.message);
    return { ok: false, erro: err.message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// ─── Verificar atualização sob demanda (Configurações) ───────────────────────
ipcMain.handle('verificar-atualizacao', async () => {
  // Em desenvolvimento (npm start) o autoUpdater não funciona — não há release.
  if (!app.isPackaged) return { disponivel: false, dev: true };
  try {
    const r = await autoUpdater.checkForUpdates();
    const versaoAtual = app.getVersion();
    const versaoRemota = r?.updateInfo?.version;
    const disponivel = !!versaoRemota && versaoRemota !== versaoAtual;
    return { disponivel, versao: versaoRemota };
  } catch (err) {
    console.warn('Verificar atualização:', err.message);
    return { disponivel: false, erro: true };
  }
});

// ─── Templates de Marketing ──────────────────────────────────────────────────
// Perfil do corretor por janela de template (webContents.id → prefill), servido ao
// preload-template.js por IPC síncrono. Não vai por argv (a foto estouraria o limite).
const _templatePrefill = new Map();
ipcMain.on('template-prefill-get', (e) => {
  e.returnValue = _templatePrefill.get(e.sender.id) || null;
});

ipcMain.on('abrir-template', async (_e, payload) => {
  // Compat: aceita string (formato antigo) ou { fileName, prefill } (com perfil do corretor).
  const fileName = typeof payload === 'string' ? payload : (payload && payload.fileName) || '';
  const prefill  = (payload && typeof payload === 'object') ? payload.prefill : null;
  const raw = String(fileName || '');
  // URL absoluta (Firebase Storage etc): só aceita https/http — outros esquemas são rejeitados.
  const ehUrlHttps = /^https:\/\//i.test(raw);
  const ehUrlHttp  = /^http:\/\//i.test(raw);
  // Só nomes de arquivo simples (sem barras) — defesa extra contra path traversal
  const nome = path.basename(raw);
  const w = new BrowserWindow({
    width: 1280, height: 860,
    autoHideMenuBar: true,
    title: 'Editor de Template — REMAX Smart',
    webPreferences: {
      devTools: DEVTOOLS_HABILITADO,
      contextIsolation: true,
      nodeIntegration: false,
      // Semeia o editor com o perfil do corretor (ver preload-template.js). Inócuo
      // pros templates que não leem esse estado.
      preload: path.join(__dirname, 'preload-template.js')
    }
  });
  // Só os "vendido" leem o estado do editor, e só semeamos se há perfil. O preload
  // pega isto por IPC síncrono; limpa ao fechar pra não vazar entre janelas.
  // Guardamos o id numa variável: no 'closed' o webContents já foi destruído e
  // ler w.webContents.id lá estoura "Object has been destroyed".
  const wcId = w.webContents.id;
  if (/vendido/i.test(raw) && prefill && (prefill.nome || prefill.phone || prefill.agent)) {
    _templatePrefill.set(wcId, prefill);
    w.on('closed', () => _templatePrefill.delete(wcId));
  }
  try {
    if (ehUrlHttps || ehUrlHttp) {
      // Só permite hostnames do Firebase Storage (defesa contra abrir qualquer site)
      const u = new URL(raw);
      const hostOk = u.hostname === 'firebasestorage.googleapis.com'
        || u.hostname.endsWith('.firebaseapp.com')
        || u.hostname.endsWith('.web.app');
      if (!hostOk) throw new Error('Host não permitido: ' + u.hostname);
      await w.loadURL(raw);
    } else {
      const { url } = await iniciarServidorMarketing();
      await w.loadURL(`${url}/${encodeURIComponent(nome)}`);
    }
  } catch (err) {
    console.warn('Erro ao abrir template:', err.message);
    if (!w.isDestroyed()) w.destroy();
  }
});

// ─── Abrir ficha em janela dedicada ──────────────────────────────────────────
ipcMain.on('abrir-ficha', (_e, payload) => {
  const { url, titulo } = payload || {};   // guarda: mensagem sem payload não derruba o main
  const win = new BrowserWindow({
    width: 900, height: 860, autoHideMenuBar: true,
    title: titulo || 'Ficha',
    webPreferences: { devTools: DEVTOOLS_HABILITADO }
  });
  // Documentos anexados (links target=_blank) abrem no navegador padrão do Windows —
  // o visualizador de PDF do navegador é mais confiável que uma janela Electron crua.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.loadURL(url).catch(err => console.error('Erro ao abrir ficha:', err));
});

// ─── Abrir ficha interna (corretor preenche ele mesmo) ────────────────────────
// Instalado (.exe) → carrega do Firebase Hosting. Em desenvolvimento → do disco.
//
// Antes carregava SEMPRE do disco (public/), "pra não depender de deploy de
// hosting". O preço disso era alto e não era óbvio:
//   • a ficha dentro do .exe é uma CÓPIA congelada na hora do build. Corrigir uma
//     ficha passava a exigir republicar o .exe e esperar o auto-update chegar em
//     cada corretor — enquanto isso, cada máquina roda uma versão diferente. Foi
//     exatamente esse descompasso que segurou o deploy das regras do Firestore.
//   • `file://` não tem origem, então o reCAPTCHA não consegue atestar a página —
//     era o que impedia ligar o App Check no `salvarFichaPublica` (hoje qualquer
//     um pode chamar essa function).
// Do Hosting, a ficha é sempre a última publicada e tem origem de verdade.
//
// Em dev segue do disco: senão o `npm start` mostraria a ficha JÁ PUBLICADA, e não
// a que você acabou de editar — daria pra "corrigir" uma ficha e não ver diferença.
const BASE_HOSTING = 'https://remax-smart-hub.web.app';

ipcMain.on('abrir-ficha-local', (_e, payload) => {
  const { arquivo, params } = payload || {};   // guarda: mensagem sem payload não derruba o main
  const win = new BrowserWindow({
    width: 940, height: 860, autoHideMenuBar: true,
    webPreferences: { devTools: DEVTOOLS_HABILITADO }
  });
  // Documentos anexados (links target=_blank) abrem no navegador padrão do Windows —
  // o visualizador de PDF do navegador é mais confiável que uma janela Electron crua.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  // basename evita path traversal (ex.: '..\\..\\algo.html') — e, no Hosting, evita
  // que um `arquivo` malformado escape pra outro caminho do site.
  const nome = path.basename(arquivo || '');
  if (!/^[\w.-]+\.html$/.test(nome)) {
    console.error('Ficha inválida:', arquivo);
    win.destroy();
    return;
  }

  const alvo = app.isPackaged
    ? `${BASE_HOSTING}/${nome}?${new URLSearchParams(params || {})}`
    : null;

  const p = alvo
    ? win.loadURL(alvo)
    : win.loadFile(path.join(__dirname, 'public', nome), { query: params || {} });

  p.catch(err => {
    console.error('Erro ao abrir ficha:', err.message);
    // Sem internet o Hosting não responde. Diz isso em vez de deixar a janela branca.
    if (win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Não foi possível abrir a ficha',
      message: 'A ficha não carregou.',
      detail: 'As fichas são carregadas pela internet, sempre na versão mais recente. Verifique sua conexão e tente de novo.'
    }).finally(() => { if (!win.isDestroyed()) win.destroy(); });
  });
});

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
      // A tela nova tem 2 botões (magic-link vs senha). Depois do email, clicar
      // EXATAMENTE em "Acessar com senha" (nunca "Receber link de acesso").
      textosAvancar: ['acessar com senha', 'com senha'],
      naoEnviar: true,
      partition: 'persist:clicksign' // sessão salva no disco → histórico de visitas → menos suspeito
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
    // CheckVisto (Smart Vistorias) é app PRÓPRIO e precisa de tratamento especial:
    // permissões de dispositivo (GPS/notificações/microfone), popup de OAuth do Drive
    // e — importante — SEM o disfarce de Chrome, pra que a detecção de Electron do
    // próprio CheckVisto funcione (senão ele recarrega o messaging e reintroduz bugs).
    if (/checkvisto-app\./i.test(url)) {
      abrirCheckVisto(url);
      return;
    }
    // Demais apps sem autologin (Motiva)
    abrirJanelaSimples(url);
    return;
  }

  const cfg = configs[siteKey];
  if (!cfg) {
    console.error('Sem configuração de autologin para', siteKey);
    abrirJanelaSimples(url);
    return;
  }

  // Bug 11: garante que login/senha nunca sejam undefined (evita string literal "undefined" no site)
  abrirPwaComAutologin(url, cfg.seletorUser, cfg.seletorPass, cfg.seletorBtn,
                      credenciais.login || '', credenciais.password || '',
                      { naoEnviar: !!cfg.naoEnviar, partition: cfg.partition || null, textosAvancar: cfg.textosAvancar || null });
});

// ─── Disfarça a janela como Chrome real (anti bot-detection) ─────────────────
// Sites como ClickSign e ChatGPT bloqueiam clientes Electron. Não basta tirar
// "Electron/x" da User-Agent: o Electron ainda (a) deixa o nome do app na UA e
// (b) anuncia "Electron" nos Client Hints (Sec-CH-UA), que a detecção moderna lê.
// Aqui reconstruímos uma User-Agent Chrome padrão e reescrevemos os Client Hints.
function disfarcarComoChrome(win) {
  const wc = win.webContents;
  const uaOrig     = wc.getUserAgent();
  const chromeVer  = uaOrig.match(/Chrome\/([\d.]+)/)?.[1] ?? '131.0.0.0';
  const chromeMaj  = chromeVer.split('.')[0];
  const plataforma = uaOrig.match(/\(([^)]*)\)/)?.[1] ?? 'Windows NT 10.0; Win64; x64';
  const ua = `Mozilla/5.0 (${plataforma}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  wc.setUserAgent(ua);
  wc.session.setUserAgent(ua);

  const secUa     = `"Chromium";v="${chromeMaj}", "Google Chrome";v="${chromeMaj}", "Not_A Brand";v="24"`;
  const secUaFull = `"Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}", "Not_A Brand";v="24.0.0.0"`;
  wc.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      const kl = k.toLowerCase();
      if (kl === 'sec-ch-ua') h[k] = secUa;
      else if (kl === 'sec-ch-ua-full-version-list') h[k] = secUaFull;
    }
    cb({ requestHeaders: h });
  });
}

// ─── Janela simples (sem autologin) ──────────────────────────────────────────
function abrirJanelaSimples(url) {
  const win = new BrowserWindow({
    width: 1200, height: 800, autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:apps', // sessão isolada do Hub, mas que SALVA o login
      devTools: DEVTOOLS_HABILITADO
    }
  });
  disfarcarComoChrome(win);
  const cidSimples = win.webContents.id;
  contentsComCertLiberado.add(cidSimples);
  win.on('closed', () => contentsComCertLiberado.delete(cidSimples));
  win.loadURL(url).catch(err => console.error(`Erro ao carregar ${url}:`, err));
}

// ─── Janela do CheckVisto (Smart Vistorias) — app próprio ─────────────────────
// Diferente de abrirJanelaSimples: (1) partição própria 'persist:checkvisto' pra
// que as permissões abaixo valham SÓ pro CheckVisto (não afeta Motiva/outros);
// (2) NÃO disfarça de Chrome — assim navigator.userAgent mantém "Electron" e a
// camada de adaptação do próprio CheckVisto funciona (pula messaging/FCM/App Check
// e faz o auto-reload de versão); (3) concede GPS/notificações/microfone, que a
// janela padrão do Electron nega; (4) libera o popup de OAuth do Google Drive.
const CHECKVISTO_HOST = 'checkvisto-app.web.app';
const CHECKVISTO_PERMS = new Set(['geolocation', 'notifications', 'media', 'clipboard-read']);
function _origemEhCheckVisto(origem) {
  try {
    const h = new URL(origem).host;
    return h === CHECKVISTO_HOST || h === 'checkvisto-app.firebaseapp.com';
  } catch (_) { return false; }
}
function abrirCheckVisto(url) {
  const win = new BrowserWindow({
    width: 1200, height: 800, autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:checkvisto', // isola sessão + permissões só do CheckVisto
      devTools: DEVTOOLS_HABILITADO
    }
  });

  const ses = win.webContents.session;
  // Concede as permissões APENAS para a origem do CheckVisto e só as necessárias.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origem = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    callback(_origemEhCheckVisto(origem) && CHECKVISTO_PERMS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return _origemEhCheckVisto(requestingOrigin) && CHECKVISTO_PERMS.has(permission);
  });

  // Popup de login do Google (OAuth do Drive) abre como janela filha; qualquer
  // outro link externo vai pro navegador padrão em vez de abrir dentro do app.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\/(accounts\.google\.com|checkvisto-app\.(web\.app|firebaseapp\.com))/i.test(u)) {
      return { action: 'allow' };
    }
    // Só entrega ao SO links http(s) (igual aos outros openExternal do arquivo);
    // file:// ou esquema custom vindo de um popup não vaza pro shell do Windows.
    if (/^https?:\/\//i.test(u)) shell.openExternal(u).catch(() => {});
    return { action: 'deny' };
  });

  win.loadURL(url).catch(err => console.error(`Erro ao carregar CheckVisto: ${err}`));
}

// ─── Janela com autologin ────────────────────────────────────────────────────
function abrirPwaComAutologin(url, seletorUser, seletorPass, seletorBtn, usuario, senha, opcoes = {}) {
  // ClickSign usa sessão persistente (cookies salvos = histórico de visitas = menos suspeito).
  // Outros sites usam in-memory pra evitar vazamento de sessão entre usuários.
  const partition = opcoes.partition || `inmem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const pwaWindow = new BrowserWindow({
    width: 1200, height: 800, autoHideMenuBar: true,
    webPreferences: {
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition,
      contextIsolation: false, // permite preload modificar window/navigator da página
      preload: path.join(__dirname, 'autologin-preload.js'),
      devTools: DEVTOOLS_HABILITADO
    }
  });

  // Disfarça como Chrome real (UA padrão + Client Hints) — ClickSign e afins
  // bloqueiam clientes Electron mesmo com o "Electron/x" removido da UA.
  disfarcarComoChrome(pwaWindow);

  // Autoriza esta janela (site legado) a aceitar certificado inválido.
  const cidPwa = pwaWindow.webContents.id;
  contentsComCertLiberado.add(cidPwa);
  pwaWindow.on('closed', () => contentsComCertLiberado.delete(cidPwa));

  // Páginas com muitos iframes (reCAPTCHA etc.) podem estourar o limite padrão de listeners
  pwaWindow.webContents.setMaxListeners(50);

  pwaWindow.webContents.on('did-fail-load', (_e, errCode, errDesc, failedUrl, isMainFrame) => {
    // Ignora falhas de subframes (reCAPTCHA, anúncios) — só registra a página principal
    if (isMainFrame) console.error(`Falha ao carregar ${failedUrl}: [${errCode}] ${errDesc}`);
  });

  pwaWindow.loadURL(url).catch(() => {}); // falhas reais já vêm pelo did-fail-load

  // Injeta CSS de loading imediatamente quando a página começa a carregar
  // (antes do React inicializar) — garante feedback visual desde o início
  pwaWindow.webContents.on('did-start-loading', () => {
    pwaWindow.webContents.insertCSS(
      `#__hub-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);` +
      `display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;pointer-events:all}` +
      `@keyframes __hub-spin{to{transform:rotate(360deg)}}` +
      `#__hub-spin{width:44px;height:44px;border:3px solid rgba(255,255,255,.18);border-top-color:#fff;` +
      `border-radius:50%;animation:__hub-spin .8s linear infinite}`
    ).catch(() => {});
  });

  // Injeta no dom-ready (cedo, e uma vez por carregamento — não por frame)
  pwaWindow.webContents.on('dom-ready', () => {
    const payload = { seletorUser, seletorPass, seletorBtn, usuario, senha, naoEnviar: !!opcoes.naoEnviar, textosAvancar: opcoes.textosAvancar || null };

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
            if(el._valueTracker){ try { el._valueTracker.setValue(''); } catch(e){} }
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

        // ── Overlay de loading ──────────────────────────────────────────────
        function _criarOv(){
          const ov = document.createElement('div');
          ov.id = '__hub-overlay';
          ov.innerHTML =
            '<div id="__hub-spin"></div>' +
            '<div style="color:#fff;font:600 13px/1.4 system-ui,Segoe UI,Arial;letter-spacing:.3px">Preenchendo credenciais...</div>';
          return ov;
        }
        function mostrarOverlayLoading(){
          if(window.__hubOverlayAtivo) return;
          window.__hubOverlayAtivo = true;
          const style = document.createElement('style');
          style.id = '__hub-overlay-style';
          style.textContent = '@keyframes __hub-spin{to{transform:rotate(360deg)}}';
          if(!document.getElementById('__hub-overlay-style')) document.head.appendChild(style);
          document.documentElement.appendChild(_criarOv());
          // Mantém o overlay mesmo se o SPA React re-renderizar o DOM
          const obs = new MutationObserver(() => {
            if(!document.getElementById('__hub-overlay'))
              document.documentElement.appendChild(_criarOv());
          });
          obs.observe(document.documentElement, { childList: true });
          window.__hubOverlayObs = obs;
        }
        function removerOverlayLoading(){
          window.__hubOverlayAtivo = false;
          if(window.__hubOverlayObs){ window.__hubOverlayObs.disconnect(); window.__hubOverlayObs = null; }
          const ov = document.getElementById('__hub-overlay');
          if(ov) ov.remove();
        }
        // Bloqueia interação com os campos preenchidos (email, senha, botão olho)
        // mas deixa o reCAPTCHA e o botão Entrar acessíveis
        function bloquearCampos(user, pass){
          [user, pass].forEach(el => {
            if(el) el.style.pointerEvents = 'none';
          });
          document.querySelectorAll('button, [role="button"], label, span').forEach(el => {
            if(ehMostrarSenha(el)) el.style.pointerEvents = 'none';
          });
        }
        // Fecha notificações de erro que o site exibiu (ex: tentativa anterior)
        function fecharNotificacoesErro(){
          const seletores = [
            'button[aria-label*="fechar" i]', 'button[aria-label*="close" i]',
            'button[aria-label*="dismiss" i]', 'button[title*="fechar" i]',
            '[class*="notification"] button', '[class*="alert"] button',
            '[class*="toast"] button', '[class*="snack"] button',
            '[class*="flash"] button', '[class*="error"] button',
            '[role="alert"] button', '[role="status"] button'
          ];
          seletores.forEach(sel => {
            document.querySelectorAll(sel).forEach(btn => {
              const txt = (btn.textContent || btn.getAttribute('aria-label') || '').trim();
              if(!txt || txt === '×' || txt === '✕' || txt === 'X' || txt.length <= 2) {
                try { btn.click(); } catch(e){}
              }
            });
          });
        }

        const precisaSenha = cfg.senha !== '';
        let etapa = 'aguardando-usuario';
        let tentativas = 0;
        const max = 60; // ~30s — margem pra net lenta renderizar o form (SPA)
        mostrarOverlayLoading();

        const intervalo = setInterval(() => {
          tentativas++;
          if(tentativas > max){
            clearInterval(intervalo);
            removerOverlayLoading();
            banner('campos não encontrados. Login manual.', '#8a0e1c');
            return;
          }

          const inputUser = achar(cfg.seletorUser);
          const inputPass = precisaSenha ? achar(cfg.seletorPass) : null;
          const btn       = achar(cfg.seletorBtn);

          // Blinda a senha assim que o campo existir (nunca deixa revelar)
          if(inputPass) blindarSenha(inputPass);

          // Só conclui "já logado" se NÃO houver NENHUM campo de login na tela.
          // Se o campo de email/usuário (inputUser) está visível, é a página de
          // login ainda carregando (net lenta) — nunca desistir nesse caso.
          if(etapa === 'aguardando-usuario' && tentativas > 16){
            const sinalLogin = inputUser || inputPass || acharPorTexto(['continuar','próximo','proximo','avançar','avancar','prosseguir']);
            if(!sinalLogin){
              clearInterval(intervalo);
              removerOverlayLoading();
              banner('parece já logado — pulando autologin.', '#0a7a3a', 3000);
              return;
            }
          }

          if(etapa === 'aguardando-usuario' && inputUser){
            preencher(inputUser, cfg.usuario);

            if(precisaSenha && !inputPass){
              // Se o site tem botão específico pra revelar a senha (ClickSign:
              // "Acessar com senha"), procura SÓ por ele — nunca chuta o 1º botão
              // (que na ClickSign é "Receber link de acesso", o errado).
              const espec = cfg.textosAvancar && cfg.textosAvancar.length;
              const textosAv = espec ? cfg.textosAvancar
                             : ['continuar','próximo','proximo','avançar','avancar','next','entrar','prosseguir'];
              const btnNext = acharPorTexto(textosAv) || (espec ? null : achar('button[type="submit"], button'));
              if(espec && !btnNext) return; // aguarda o botão específico renderizar (retenta no próximo ciclo)
              banner('usuário preenchido, abrindo acesso com senha...');
              etapa = 'aguardando-senha';
              setTimeout(() => {
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
              setTimeout(() => {
                fecharNotificacoesErro();
                removerOverlayLoading();
                bloquearCampos(inputUser, inputPass);
                banner('CAPTCHA detectado — resolva e clique em Entrar.', '#b8860b', 25000);
              }, 400);
              return;
            }

            if(temCaptchaVisivel()){
              clearInterval(intervalo);
              removerOverlayLoading();
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
              removerOverlayLoading();
              banner(enviou ? 'login enviado.' : 'tentativa de submit.', '#0a7a3a', 3000);
            }, 700);

            clearInterval(intervalo);
            return;
          }

          // Robustez (ClickSign): se clicamos em "Acessar com senha" mas o campo
          // não apareceu (ex.: botão ainda desabilitado na hora do clique),
          // re-clica a cada ~3s enquanto o botão específico seguir na tela.
          if(etapa === 'aguardando-senha' && !inputPass && cfg.textosAvancar && tentativas % 6 === 0){
            const btnEspec = acharPorTexto(cfg.textosAvancar);
            if(btnEspec) { try { btnEspec.click(); } catch(e){} }
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
              setTimeout(() => {
                fecharNotificacoesErro();
                removerOverlayLoading();
                bloquearCampos(inputUser, inputPass);
                banner('CAPTCHA detectado — resolva e clique em Entrar.', '#b8860b', 25000);
              }, 400);
              return;
            }

            // CAPTCHA já visível antes de enviar (alguns sites): para e deixa resolver.
            if(temCaptchaVisivel()){
              clearInterval(intervalo);
              removerOverlayLoading();
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
              removerOverlayLoading();
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
