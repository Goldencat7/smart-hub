#!/usr/bin/env node
/**
 * Servidor estático local pra testar o PWA antes de publicar:
 *
 *   npm run build:pwa && npm run serve:pwa    →  http://localhost:5055/app/
 *
 * Imita o Firebase Hosting servindo a pasta `public/` na raiz (fichas, portais,
 * calculadoras) com o Hub em `/app/`. É só pra desenvolvimento — em produção
 * quem serve isso é o Hosting.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'public');
const PORTA = process.env.PORT || 5055;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let alvo = path.join(RAIZ, url);

  // Impede sair da pasta public/ (../../ no caminho). Compara com o separador no
  // fim de propósito: um `startsWith(RAIZ)` cru deixaria passar uma pasta irmã de
  // nome parecido (…/public2/x começa com …/public).
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + path.sep)) { res.writeHead(403).end('403'); return; }

  if (fs.existsSync(alvo) && fs.statSync(alvo).isDirectory()) alvo = path.join(alvo, 'index.html');
  if (!fs.existsSync(alvo)) { res.writeHead(404).end('404 — ' + url); return; }

  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'   // igual ao header do firebase.json
  });
  fs.createReadStream(alvo).pipe(res);
}).listen(PORTA, () => {
  console.log(`PWA local:  http://localhost:${PORTA}/app/`);
  console.log(`Fichas:     http://localhost:${PORTA}/ficha-locador.html`);
});
