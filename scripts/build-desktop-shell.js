#!/usr/bin/env node
/**
 * Monta as telas CRUAS (sem o shim do PWA) em `public/desktop/`.
 *
 *   node scripts/build-desktop-shell.js
 *
 * PARA QUE SERVE: a "casca fina" (Electron que carrega as telas do Hosting em vez
 * do disco) precisa das telas SEM o `platform-web.js` — porque no Electron quem
 * fornece o `hubApi` (com autologin=true) é o preload.js, e o shim do PWA
 * SOBRESCREVERIA isso pra autologin=false. Então esta rota /desktop/ é idêntica ao
 * que o .exe carrega do disco hoje, só que servida por https.
 *
 * Diferença pro build-pwa.js: aqui as telas vão SEM NENHUMA injeção no <head>
 * (sem platform-web, sem manifest, sem sw, sem mobile.css).
 *
 * ⚠ /desktop/ é destinada a ser carregada pela CASCA (Electron, que injeta hubApi
 * via preload). Aberta num navegador comum ela quebra — não tem hubApi. É de
 * propósito: o navegador/celular usa /app/ (com shim), a casca usa /desktop/.
 *
 * Saída descartável (public/desktop/ está no .gitignore e fora do .exe).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'public', 'desktop');

// Mesmos arquivos que o build-pwa copia como compartilhados com o .exe.
const COMPARTILHADOS = [
  'hub-app.js',
  'auth-login.js',
  'admin-app.js',
  'firebase-env.js',   // resolve prod/staging/emulador pelo hostname
  'styles.css',
  'broker.css',
  'broker-app.js',
  'logo.png'
];

// As telas vão CRUAS (sem injeção de <head>).
const TELAS = ['index.html', 'login.html', 'admin.html'];

function copiarPasta(origem, destino, filtro) {
  if (!fs.existsSync(origem)) return 0;
  fs.mkdirSync(destino, { recursive: true });
  let n = 0;
  for (const item of fs.readdirSync(origem)) {
    const de = path.join(origem, item);
    const para = path.join(destino, item);
    if (filtro && !filtro(item, de)) continue;
    if (fs.statSync(de).isDirectory()) n += copiarPasta(de, para, filtro);
    else { fs.copyFileSync(de, para); n++; }
  }
  return n;
}

console.log('Montando as telas cruas em public/desktop/ …');
fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });

for (const arq of COMPARTILHADOS) {
  fs.copyFileSync(path.join(RAIZ, arq), path.join(SAIDA, arq));
}
console.log(`  ✓ ${COMPARTILHADOS.length} arquivos compartilhados`);

for (const tela of TELAS) {
  fs.copyFileSync(path.join(RAIZ, tela), path.join(SAIDA, tela)); // CRUA, sem injeção
}
console.log(`  ✓ ${TELAS.length} telas (cruas, sem shim)`);

const nVendor = copiarPasta(path.join(RAIZ, 'vendor'), path.join(SAIDA, 'vendor'));
const nApps = copiarPasta(path.join(RAIZ, 'app-icons'), path.join(SAIDA, 'app-icons'), item => !item.endsWith('.txt'));
const nMkt = copiarPasta(path.join(RAIZ, 'marketing'), path.join(SAIDA, 'marketing'), item => item !== 'template');
console.log(`  ✓ ${nVendor} vendor, ${nApps} ícones de app, ${nMkt} arquivos de marketing`);

console.log('\nPronto. Deploy (staging): firebase deploy --only hosting --project staging');
console.log('Carregada pela casca em: https://remax-smart-hub-staging.web.app/desktop/login.html');
