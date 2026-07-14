/**
 * Shim de plataforma — versão WEB / PWA (celular).
 * =============================================================================
 * O Hub roda em dois lugares com o MESMO código de tela (index.html, hub-app.js,
 * styles.css, admin.html, login.html):
 *
 *   • Desktop (Electron): o `preload.js` publica `window.hubApi` / `window.hubAuth`
 *     e o `main.js` faz o trabalho nativo (abrir janela, autologin, PDF, update).
 *   • Celular (este arquivo): não existe processo nativo. Aqui reimplementamos a
 *     MESMA API em cima do que o navegador sabe fazer (abrir aba, imprimir, navegar).
 *
 * Assim `hub-app.js` continua sendo um arquivo só, sem `if (é celular)` espalhado —
 * quem muda de comportamento é a ponte, não a tela.
 *
 * ⚠ AUTOLOGIN NÃO EXISTE AQUI — de propósito.
 * `hubApi.autologin = false` é o contrato: com essa flag o `hub-app.js` NUNCA chama
 * a Cloud Function `getCredentials`, então as senhas dos sistemas (CRM, portais,
 * ClickSign…) simplesmente não trafegam pro celular. Os apps continuam listados,
 * mas abrem no navegador como um link normal, e a pessoa entra com o login dela.
 * Injetar senha em site de terceiro é impossível na web (e reprovado nas lojas).
 *
 * Este arquivo só é carregado na build do PWA (public/app/), NUNCA no .exe.
 * Ele roda como script clássico no <head>, ou seja, ANTES do módulo hub-app.js.
 */
(function () {
  'use strict';

  // Injetado pelo scripts/build-pwa.js (fica igual à versão do package.json).
  // SEM sufixo "(web)": o hub-app.js compara essa string com versões gravadas no
  // Firestore (ex.: locacoesPublicadaEm) — um sufixo quebraria a igualdade e, se
  // um admin publicasse pelo celular, gravaria uma versão que o desktop nunca
  // casa. O selo "web" vai na topbar, só visual (marcarComoWeb abaixo).
  const VERSAO = window.__HUB_VERSAO__ || '0.0.0';

  // As fichas/calculadoras moram na RAIZ do Hosting (public/), enquanto o Hub em si
  // mora em /app/. Por isso o caminho absoluto — nada de path relativo aqui.
  const RAIZ_HOSTING = '/';

  // Abre em ABA NOVA, sempre — o Hub nunca é substituído pelo site que ele abriu.
  //
  // Por que um <a target="_blank"> e não window.open(): no celular o window.open()
  // é tratado como pop-up e vários navegadores o bloqueiam (ou o abrem na MESMA
  // aba, engolindo o Hub). O clique num link é o gesto que todo navegador respeita
  // — e, no app instalado (standalone), é ele que joga o site pro navegador do
  // celular em vez de abrir dentro da janela do Hub.
  //
  // rel="noopener noreferrer": a aba nova não ganha referência ao Hub
  // (`window.opener`), então o site aberto não consegue mexer na nossa página.
  function abrirAba(url) {
    const u = String(url || '');
    // Só http(s) ou caminho do próprio Hosting — nada de javascript:/data:.
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/') && !/^[\w.-]+\//.test(u)) return;
    const a = document.createElement('a');
    a.href = u;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function comParams(base, params) {
    const qs = new URLSearchParams(params || {}).toString();
    return qs ? `${base}?${qs}` : base;
  }

  window.hubApi = {
    // ─── Contrato de capacidade (lido pelo hub-app.js) ──────────────────────
    plataforma: 'web',
    autologin: false,   // ⚠ ver o cabeçalho: desliga o getCredentials no celular

    // ─── Abrir um sistema ───────────────────────────────────────────────────
    // No desktop isso abriria uma janela Electron e injetaria login/senha.
    // Aqui é só um link: `credenciais` chega null (o hub-app nem busca) e, se
    // um dia chegasse preenchido, ignoramos — a senha não sai do servidor.
    abrirApp: ({ url }) => abrirAba(url),

    // Aviso de status oferece "abrir no navegador" — aqui já É o navegador.
    abrirNoNavegador: (url) => abrirAba(url),

    // ─── Navegação entre as telas do Hub ────────────────────────────────────
    // No Electron o main faz loadFile(); no navegador é navegação normal.
    voltarParaLogin: () => { window.location.href = 'login.html'; },
    abrirAdmin:      () => { window.location.href = 'admin.html'; },
    voltarParaHub:   () => { window.location.href = 'index.html'; },

    // ─── Versão ─────────────────────────────────────────────────────────────
    getAppVersion: () => Promise.resolve(VERSAO),

    // ─── Atualização ────────────────────────────────────────────────────────
    // PWA se atualiza sozinho (service worker). Não há .exe pra baixar.
    verificarAtualizacao: async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update();
      } catch (_) { /* sem SW: segue o jogo */ }
      return { disponivel: false, web: true };
    },

    // ─── Fichas ─────────────────────────────────────────────────────────────
    // abrirFicha recebe URL absoluta do Hosting; abrirFichaLocal recebe só o nome
    // do arquivo (no desktop vem do disco; aqui vem da raiz do Hosting).
    abrirFicha:      (url) => abrirAba(url),
    abrirFichaLocal: (arquivo, params) => abrirAba(comParams(RAIZ_HOSTING + arquivo, params)),

    // PDF: no desktop o Electron imprime a página num arquivo (printToPDF). No
    // celular quem faz isso é o próprio sistema — abrimos a ficha e a pessoa usa
    // Compartilhar → Imprimir → Salvar em PDF.
    baixarFichaPDF: (url) => {
      abrirAba(url);
      return Promise.resolve({ ok: true, web: true });
    },

    // ─── Templates de marketing ─────────────────────────────────────────────
    // Podem ser um HTML enviado pro Storage (URL absoluta) ou um dos templates
    // que vêm junto com o app (copiados pra /app/marketing/ no build).
    abrirTemplate: (arquivo) => {
      const raw = String(arquivo || '');
      abrirAba(/^https?:\/\//i.test(raw) ? raw : 'marketing/' + encodeURIComponent(raw));
    },

    // ─── Google Agenda ──────────────────────────────────────────────────────
    // O fluxo OAuth do desktop usa um servidor local de callback (loopback), que
    // não existe no navegador. Fica só no computador por enquanto — o botão é
    // escondido abaixo, e isto aqui é a rede de segurança.
    conectarGoogle: () => Promise.resolve({
      ok: false,
      erro: 'conectar a Google Agenda só pelo Hub do computador (por enquanto)'
    })

    // getIniciarWindows / setIniciarWindows: NÃO existem aqui de propósito —
    // o hub-app.js já testa `if (!window.hubApi.getIniciarWindows) return;`.
  };

  // Login: no Electron o main troca a página; aqui é navegação normal.
  window.hubAuth = {
    loginConcluido: () => { window.location.href = 'index.html'; }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Ajustes de UI que só fazem sentido no navegador/celular.
  // Tudo aqui é feito por JS, em cima do HTML compartilhado — assim o index.html
  // continua idêntico pro desktop (nada de <div hidden> só pra web).
  // ───────────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    esconderSoDesktop();
    montarMenuMobile();
    marcarComoWeb();
  });

  // Selo "web" ao lado da versão na topbar — só visual (a versão em si fica
  // limpa, ver o comentário do VERSAO no topo).
  function marcarComoWeb() {
    const versaoEl = document.getElementById('appVersion');
    if (!versaoEl) return;
    const selo = document.createElement('span');
    selo.className = 'brand-version';
    selo.textContent = '· web';
    versaoEl.after(selo);
  }

  function esconderSoDesktop() {
    // "Iniciar com o Windows" e "Conectar Google" não têm equivalente no celular.
    const linhaWindows = document.getElementById('cfgIniciarWindows')?.closest('label');
    if (linhaWindows) linhaWindows.hidden = true;

    const btnGoogle = document.getElementById('btnGoogleAgenda');
    if (btnGoogle) btnGoogle.hidden = true;

    // "Verificar atualização" vira informação: o PWA se atualiza sozinho.
    const btnUpdate = document.getElementById('cfgVerificarUpdate');
    if (btnUpdate) btnUpdate.hidden = true;
    const infoUpdate = document.getElementById('cfgVersaoInfo');
    const titulo = infoUpdate?.closest('.config-linha')?.querySelector('.config-linha-titulo');
    if (titulo) titulo.textContent = 'Versão';   // sem o botão, "Versão do app" vira só "Versão"
  }

  // Sidebar vira gaveta (off-canvas): um botão ☰ na topbar abre/fecha.
  function montarMenuMobile() {
    const layout = document.querySelector('.hub-layout');
    const marca = document.querySelector('.topbar .brand');
    const sidebar = document.querySelector('.sidebar');
    if (document.getElementById('btnMenuMobile')) return;
    if (!layout || !marca || !sidebar) {
      // login.html/admin.html não têm .hub-layout — silêncio é o esperado. Mas no
      // index a falta significa que alguém renomeou a estrutura no HTML
      // compartilhado e o celular ficou SEM MENU — grita no console.
      if (/index\.html$|\/app\/?$/.test(location.pathname)) {
        console.error('[pwa] estrutura esperada não encontrada (.hub-layout/.brand) — o menu ☰ não foi criado. O index.html mudou?');
      }
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'btnMenuMobile';
    btn.className = 'menu-mobile-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Abrir menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
    marca.parentNode.insertBefore(btn, marca);

    const veu = document.createElement('div');
    veu.className = 'menu-mobile-veu';
    veu.hidden = true;
    document.body.appendChild(veu);

    const fechar = () => {
      document.body.classList.remove('menu-aberto');
      veu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const abrir = () => {
      document.body.classList.add('menu-aberto');
      veu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    };

    // Cabeçalho da gaveta: a gaveta cobre a topbar inteira, então sem a logo os
    // itens ficariam soltos encostados no topo da tela (e sem jeito óbvio de fechar).
    const topo = document.createElement('div');
    topo.className = 'menu-mobile-topo';
    const logoTopbar = document.querySelector('.topbar .brand-logo');
    topo.innerHTML =
      `<img class="brand-logo" src="${logoTopbar ? logoTopbar.getAttribute('src') : 'logo.png'}" alt="REMAX Smart">
       <button type="button" class="menu-mobile-fechar" aria-label="Fechar menu">✕</button>`;
    sidebar.prepend(topo);
    topo.querySelector('.menu-mobile-fechar').addEventListener('click', () => fechar());

    btn.addEventListener('click', () => {
      document.body.classList.contains('menu-aberto') ? fechar() : abrir();
    });
    veu.addEventListener('click', fechar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    // Escolher uma categoria fecha a gaveta (é o que se espera no celular).
    document.getElementById('navCategorias')?.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item')) fechar();
    });
  }

  // ─── Service worker (é o que torna o Hub instalável e abre offline) ────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('Service worker não registrou:', err);
      });
    });
  }
})();
