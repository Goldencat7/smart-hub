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
  './admin.html',   // sem ele, abrir o Admin offline caía no fallback e servia o index no lugar
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

// CDNs imutáveis que a tela precisa pra carregar: o SDK do Firebase (a versão
// está no caminho — o conteúdo nunca muda) e a fonte de ícones do Admin.
// As CHAMADAS de dados (googleapis.com, cloudfunctions.net) ficam de fora.
function ehCdnImutavel(url) {
  return (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/'))
    || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/@tabler/'));
}

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;                     // POST das functions: nunca

  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;

  // Dados e autenticação SEMPRE pela rede — sem cache, sem interceptar.
  // (firestore.googleapis.com, *.cloudfunctions.net, identitytoolkit, storage…)
  if (!mesmaOrigem && !ehCdnImutavel(url)) return;

  // CDN imutável (SDK/fonte com a versão no caminho): cache primeiro, sem
  // revalidar — re-baixar centenas de KB a cada abertura no 4G seria jogar
  // fora exatamente o que o service worker existe pra economizar.
  if (!mesmaOrigem) {
    evt.respondWith(
      caches.match(req).then(emCache => emCache || fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return resp;
      }))
    );
    return;
  }

  // Navegação (abrir/atualizar a página): rede primeiro, cache como plano B.
  // Assim uma versão nova no Hosting aparece na hora que a pessoa abre o app.
  if (req.mode === 'navigate') {
    evt.respondWith(
      fetch(req)
        .then(resp => {
          // Só guarda resposta boa: cachear um 404/500/redirect de um deploy no
          // meio do caminho deixaria a página quebrada como fallback offline.
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
          }
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
