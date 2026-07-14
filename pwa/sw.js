/**
 * Service worker do PWA do Hub.
 *
 * É ele que torna o Hub instalável no celular e faz a tela abrir mesmo com
 * internet ruim. Ele NÃO guarda dado nenhum da empresa: só o "casco" do app
 * (HTML, CSS, JS, ícones). Tudo que é Firestore/Functions/Auth passa direto pela
 * rede, sempre — nada de ficha, contrato ou credencial encosta neste cache.
 *
 * CACHE (nome versionado): trocou a versão → cache novo, cache velho apagado.
 * Isso é o que faz o `firebase deploy --only hosting` chegar no celular de todo
 * mundo sem ninguém "reinstalar" nada.
 */
// Os dois são trocados pelo scripts/build-pwa.js. O BUILD (carimbo de data/hora) é
// o que realmente invalida o cache: o PWA é publicado várias vezes na MESMA versão
// do package.json, então versionar o cache só pela versão deixaria o celular abrindo
// o JS velho depois de um deploy de correção.
const VERSAO = '__VERSAO__';
const BUILD = '__BUILD__';
const CACHE = `hub-pwa-${VERSAO}-${BUILD}`;

// O casco mínimo pra tela abrir offline.
const CASCO = [
  './',
  './index.html',
  './login.html',
  './styles.css',
  './mobile.css',
  './platform-web.js',
  './logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (evt) => {
  // addAll é tudo-ou-nada; se um arquivo falhar, a instalação inteira falha e o
  // SW antigo continua no ar (que é o comportamento seguro).
  evt.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CASCO)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n.startsWith('hub-pwa-') && n !== CACHE).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Domínios do SDK do Firebase (CDN). Guardamos em cache porque sem eles a tela
// nem carrega — mas as CHAMADAS de dados (googleapis.com) ficam de fora.
function ehSdkFirebase(url) {
  return url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');
}

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;                     // POST das functions: nunca

  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;

  // Dados e autenticação SEMPRE pela rede — sem cache, sem interceptar.
  // (firestore.googleapis.com, *.cloudfunctions.net, identitytoolkit, storage…)
  if (!mesmaOrigem && !ehSdkFirebase(url)) return;

  // Navegação (abrir/atualizar a página): rede primeiro, cache como plano B.
  // Assim uma versão nova no Hosting aparece na hora que a pessoa abre o app.
  if (req.mode === 'navigate') {
    evt.respondWith(
      fetch(req)
        .then(resp => {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Estático (css/js/ícones/SDK): responde do cache na hora e atualiza por trás
  // (stale-while-revalidate) — rápido no 3G e nunca fica velho por muito tempo.
  evt.respondWith(
    caches.match(req).then(emCache => {
      const daRede = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return resp;
        // Offline e sem cópia no cache: respondWith(undefined) explodiria em
        // TypeError. Devolve um erro de rede de verdade — mesmo resultado que
        // teríamos sem service worker nenhum.
      }).catch(() => emCache || Response.error());
      return emCache || daRede;
    })
  );
});
