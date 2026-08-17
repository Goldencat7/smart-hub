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

// O casco mínimo pra tela abrir offline E rápido depois de uma att. Inclui os JS
// PESADOS da abertura (hub-app.js ~470KB + firebase-env.js): pré-cacheados aqui,
// eles já estão prontos quando o SW novo recarrega a página — o reload lê do cache
// em vez de baixar 470KB da rede no 4G (era isso que travava o 1º F5 pós-deploy).
const CASCO = [
  './',
  './index.html',
  './login.html',
  './admin.html',   // sem ele, abrir o Admin offline caía no fallback e servia o index no lugar
  './styles.css',
  './mobile.css',
  './platform-web.js',
  './hub-app.js',       // ~470KB — o maior peso da abertura; pré-cachear evita o F5 lento pós-att
  './firebase-env.js',  // config do Firebase que o hub-app.js importa no boot
  './auth-login.js',    // tela de login (primeiro passo antes do Hub)
  './admin-app.js',     // tela Admin (pequena; evita fetch na hora pro admin)
  // Pacote do Broker ("Meus Negócios") — lazy na ABERTURA, mas pré-cacheado AQUI:
  // sem isso, após cada att o 1º clique em Meus Negócios baixava ~700KB na hora.
  './broker-app.js',
  './broker.css',
  './vendor/lucide.min.js',
  './logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (evt) => {
  // Tudo-ou-nada (se um arquivo falhar, a instalação inteira falha e o SW antigo
  // continua no ar — comportamento seguro). `cache: 'reload'` força buscar da REDE,
  // ignorando o HTTP cache do navegador: senão, logo após um deploy, o pré-cache
  // poderia gravar o hub-app.js VELHO e a tela voltaria a ficar "Frankenstein".
  evt.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      CASCO.map(u => fetch(new Request(u, { cache: 'reload' })).then(resp => {
        if (!resp || !resp.ok) throw new Error('pré-cache falhou: ' + u);
        return c.put(u, resp);
      }))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n.startsWith('hub-pwa-') && n !== CACHE).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
      // Avisa as abas abertas que a versão trocou. Sem isso, a carga que INSTALA
      // o SW novo fica "Frankenstein": o HTML vem da rede (novo) mas o CSS/JS
      // saem do cache antigo (stale-while-revalidate), e a tela aparece
      // desalinhada até a pessoa recarregar de novo por conta própria.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(abas => abas.forEach(a => a.postMessage({ tipo: 'hub-sw-atualizado', build: BUILD })))
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

  // Navegação (abrir/atualizar a página): CACHE primeiro, rede por trás (app-shell).
  // Antes era rede-primeiro: TODA abertura esperava o Hosting responder (300-800ms no
  // 4G) mesmo sem deploy nenhum. Agora a tela abre do cache NA HORA; a rede atualiza a
  // cópia por trás. Versão nova continua chegando: o navegador SEMPRE reconsulta o
  // sw.js numa navegação — o ciclo install (pré-cache novo) → activate (postMessage)
  // → reload da página cuida da troca, e o reload já cai no cache novo (instantâneo).
  if (req.mode === 'navigate') {
    // Navegação COM query string (?code=… do OAuth, ?google=…) é dinâmica e o code
    // não pode ficar em disco: rede direto, sem cache.
    if (url.search) {
      evt.respondWith(fetch(req).catch(() => caches.match('./index.html')));
      return;
    }
    evt.respondWith(
      caches.match(req).then(emCache => {
        const daRede = fetch(req).then(resp => {
          // Só guarda resposta boa: cachear um 404/500 de um deploy no meio do
          // caminho deixaria a página quebrada como fallback offline.
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
          }
          return resp;
        }).catch(() => emCache || caches.match('./index.html'));
        return emCache || daRede;
      })
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
