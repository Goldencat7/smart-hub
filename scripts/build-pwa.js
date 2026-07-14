#!/usr/bin/env node
/**
 * Monta o PWA (versão celular/navegador do Hub) em `public/app/`.
 *
 *   npm run build:pwa      → só monta
 *   npm run deploy:pwa     → monta e sobe pro Firebase Hosting
 *
 * A IDEIA: não existe "código do celular". As telas (index.html, hub-app.js,
 * styles.css, admin…) são as MESMAS do .exe — este script só as copia pra dentro
 * de public/app/ e pluga três coisas que só a web precisa:
 *
 *   1. `platform-web.js`  — reimplementa a ponte `hubApi` do Electron em cima do
 *                            navegador. É onde o AUTOLOGIN é desligado (`autologin:false`).
 *   2. `mobile.css`       — ajustes de layout pra tela de celular.
 *   3. manifest + sw.js   — o que torna o Hub instalável e rápido no 4G.
 *
 * Nada aqui edita o código-fonte: a saída é descartável (public/app/ está no
 * .gitignore) e é reconstruída do zero a cada build. Mexeu numa tela? roda de novo.
 *
 * ⚠ public/app/ fica FORA do .exe (`!public/app/**` no package.json) — senão o
 * instalador levaria uma cópia inútil de si mesmo.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'public', 'app');
const VERSAO = require(path.join(RAIZ, 'package.json')).version;

// ─── Arquivos compartilhados com o .exe (copiados como estão) ────────────────
const COMPARTILHADOS = [
  'hub-app.js',
  'auth-login.js',
  'admin-app.js',
  'firebase-config.js',
  'styles.css',
  'logo.png'
];

// ─── Telas (levam a injeção do <head> do PWA) ────────────────────────────────
const TELAS = ['index.html', 'login.html', 'admin.html'];

// ─── Só da web (pasta pwa/) ──────────────────────────────────────────────────
const SO_WEB = ['platform-web.js', 'mobile.css', 'manifest.webmanifest'];

function copiarPasta(origem, destino, filtro) {
  if (!fs.existsSync(origem)) return 0;
  fs.mkdirSync(destino, { recursive: true });
  let n = 0;
  for (const item of fs.readdirSync(origem)) {
    const de = path.join(origem, item);
    const para = path.join(destino, item);
    if (filtro && !filtro(item, de)) continue;
    if (fs.statSync(de).isDirectory()) {
      n += copiarPasta(de, para, filtro);
    } else {
      fs.copyFileSync(de, para);
      n++;
    }
  }
  return n;
}

// ─── O que entra no <head> de toda tela do PWA ───────────────────────────────
// Ordem importa: mobile.css DEPOIS do styles.css (sobrescreve), e platform-web.js
// é script clássico — roda ANTES do hub-app.js, que é `type=module` (adiado).
function cabecalhoPwa() {
  return `
    <!-- ↓↓↓ injetado por scripts/build-pwa.js — não editar aqui, editar em pwa/ ↓↓↓ -->
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#1d222d">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Smart Hub">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
    <link rel="icon" href="icons/icon-192.png">
    <link rel="stylesheet" href="mobile.css">
    <script>window.__HUB_VERSAO__ = ${JSON.stringify(VERSAO)};</script>
    <script src="platform-web.js"></script>
    <!-- ↑↑↑ fim da injeção do PWA ↑↑↑ -->
`;
}

function transformarTela(html) {
  if (!/<\/head>/i.test(html)) throw new Error('Tela sem </head> — não sei onde injetar o PWA');
  let out = html.replace(/<\/head>/i, cabecalhoPwa() + '  </head>');

  // O Hub mora em /app/, mas as fichas moram na RAIZ do Hosting (public/).
  // O iframe do index.html aponta pra ficha-locador.html relativo — vira absoluto.
  out = out.replace(/(<iframe[^>]*\ssrc=")(ficha-[^"]+)(")/gi, '$1/$2$3');
  return out;
}

// ─── Build ───────────────────────────────────────────────────────────────────
console.log(`Montando o PWA v${VERSAO} em public/app/ …`);
fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });

for (const arq of COMPARTILHADOS) {
  fs.copyFileSync(path.join(RAIZ, arq), path.join(SAIDA, arq));
}
console.log(`  ✓ ${COMPARTILHADOS.length} arquivos compartilhados com o .exe`);

for (const tela of TELAS) {
  const html = fs.readFileSync(path.join(RAIZ, tela), 'utf8');
  fs.writeFileSync(path.join(SAIDA, tela), transformarTela(html));
}
console.log(`  ✓ ${TELAS.length} telas (com o <head> do PWA injetado)`);

for (const arq of SO_WEB) {
  fs.copyFileSync(path.join(RAIZ, 'pwa', arq), path.join(SAIDA, arq));
}

// Service worker: o nome do cache carrega versão + carimbo do build. O carimbo é o
// que garante que um deploy de correção (mesma versão do package.json) chegue no
// celular — sem ele o cache antigo continuaria valendo.
// AAAAMMDDHHMMSS — com segundos: dois deploys no mesmo minuto ganharem o mesmo
// nome de cache faria o segundo não chegar em ninguém.
const BUILD = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const sw = fs.readFileSync(path.join(RAIZ, 'pwa', 'sw.js'), 'utf8')
  .replace('__VERSAO__', VERSAO)
  .replace('__BUILD__', BUILD);
fs.writeFileSync(path.join(SAIDA, 'sw.js'), sw);
console.log(`  ✓ platform-web.js, mobile.css, manifest, sw.js (cache hub-pwa-${VERSAO}-${BUILD})`);

const nIcones = copiarPasta(path.join(RAIZ, 'pwa', 'icons'), path.join(SAIDA, 'icons'));
const nApps = copiarPasta(path.join(RAIZ, 'app-icons'), path.join(SAIDA, 'app-icons'), item => !item.endsWith('.txt'));
// Templates de marketing que vêm com o app (os enviados pelo painel moram no Storage).
// marketing/template/ é o "esqueleto" de edição — não vai (nem no .exe vai).
const nMkt = copiarPasta(path.join(RAIZ, 'marketing'), path.join(SAIDA, 'marketing'), item => item !== 'template');
console.log(`  ✓ ${nIcones} ícones do PWA, ${nApps} ícones de app, ${nMkt} arquivos de marketing`);

console.log(`\nPronto. Testar: firebase serve --only hosting  →  http://localhost:5000/app/`);
console.log(`Publicar:  npm run deploy:pwa   →  https://remax-smart-hub.web.app/app/`);
