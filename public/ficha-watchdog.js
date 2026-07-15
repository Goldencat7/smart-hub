/* Vigia da ficha — script CLÁSSICO (não-módulo), servido do nosso próprio Hosting.
 * ---------------------------------------------------------------------------
 * As fichas montam o formulário com módulos ES que importam o SDK do Firebase de
 * um CDN externo (gstatic.com). Em módulos ES, se UM import trava na rede, o script
 * inteiro nunca roda e o formulário nunca aparece — a ficha abre "em branco". Numa
 * rede fria (1ª abertura) isso acontece; reabrir resolvia, porque aí está em cache.
 *
 * Este vigia automatiza esse "reabrir": se o módulo não sinalizar que montou dentro
 * de alguns segundos, ele recarrega a página UMA vez. Se mesmo assim não montar,
 * mostra um aviso claro em vez de deixar a tela branca.
 *
 * Por que é confiável: é um <script> clássico, mesma origem que acabou de servir o
 * HTML. O que falha é o CDN de terceiro, não o nosso Hosting — então este arquivo
 * sempre carrega e sempre roda, mesmo quando os módulos da página não rodam.
 *
 * O sinal: cada engine de ficha faz `window.__fichaPronta = true` assim que executa
 * (logo depois dos imports). Se os imports falharem, o engine não roda e a flag
 * nunca vira true — é isso que o vigia detecta.
 */
(function () {
  'use strict';
  var GUARD = 'ficha_recarregou_1x';   // marca que já tentamos recarregar (evita laço)
  var ESPERA_MS = 7000;

  function montou() { return window.__fichaPronta === true; }

  function guardLer() { try { return sessionStorage.getItem(GUARD); } catch (e) { return 'sem-storage'; } }
  function guardGravar() { try { sessionStorage.setItem(GUARD, '1'); return true; } catch (e) { return false; } }
  function guardLimpar() { try { sessionStorage.removeItem(GUARD); } catch (e) {} }

  function mostrarAviso() {
    if (document.getElementById('fichaWatchdogAviso')) return;
    var d = document.createElement('div');
    d.id = 'fichaWatchdogAviso';
    d.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:16px', 'padding:24px', 'text-align:center',
      'background:#fff', 'color:#002749', 'font-family:system-ui,-apple-system,Arial,sans-serif'
    ].join(';'));
    d.innerHTML =
      '<div style="font-size:40px">📄</div>' +
      '<div style="font-size:17px;font-weight:700">A ficha não carregou totalmente</div>' +
      '<div style="font-size:14px;color:#555;max-width:340px;line-height:1.5">' +
        'Isso costuma ser a conexão no primeiro carregamento. Toque no botão para tentar de novo.' +
      '</div>' +
      '<button id="fichaWatchdogRetry" style="margin-top:4px;padding:12px 22px;border:none;border-radius:8px;' +
        'background:#002749;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Tentar de novo</button>';
    document.body.appendChild(d);
    document.getElementById('fichaWatchdogRetry').addEventListener('click', function () {
      guardLimpar();
      location.reload();
    });
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (montou()) { guardLimpar(); return; }          // montou: tudo certo, zera o guard

      var g = guardLer();
      if (g === null) {                                  // 1ª falha: recarrega uma vez
        if (guardGravar()) { location.reload(); return; }
        mostrarAviso();                                  // sem sessionStorage: não arrisca laço, avisa
        return;
      }
      // já recarregou (ou storage indisponível) e ainda não montou → aviso, não branco
      mostrarAviso();
    }, ESPERA_MS);
  });
})();
