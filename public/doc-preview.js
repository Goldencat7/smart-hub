// Preview inline de PDFs anexados nas fichas (modo corretor).
// PDF não renderiza dentro de <img>; aqui buscamos o arquivo e desenhamos as
// páginas em <canvas> via pdf.js — assim a tela E o "Baixar PDF" do Hub
// (printToPDF da página) mostram o documento de verdade, igual às fotos.
//
// Uso: window.__pdfInline(imgQueFalhou, 'Comp. renda')
// O main.js espera window.__docsProntos === true antes de imprimir o PDF.

let pendentes = 0;
window.__docsProntos = true;
function comeca() { pendentes++; window.__docsProntos = false; }
function termina() { if (--pendentes <= 0) window.__docsProntos = true; }

const MAX_PAGINAS = 4;
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let pdfjsPromise = null;
function carregarPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS).then(async m => {
      // Worker cross-origin não é permitido; baixa o código e cria um blob local.
      // Se falhar, pdf.js cai sozinho no "fake worker" (main thread) — só mais lento.
      try {
        const code = await (await fetch(PDFJS_WORKER)).text();
        m.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      } catch (_) {
        m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      }
      return m;
    });
  }
  return pdfjsPromise;
}

function caixaMsg(texto) {
  const d = document.createElement('div');
  d.textContent = texto;
  d.style.cssText = 'margin-top:6px;padding:10px 12px;background:#eef2f7;border:1px solid #d5dde8;border-radius:8px;color:#002749;font-size:13px;font-weight:600';
  return d;
}

window.__pdfInline = async function (img, label) {
  comeca();
  const url = img.src;
  const cont = document.createElement('div');
  img.replaceWith(cont);
  try {
    const pdfjs = await carregarPdfjs();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const dados = await resp.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: dados }).promise;
    const n = Math.min(doc.numPages, MAX_PAGINAS);
    for (let i = 1; i <= n; i++) {
      const pg = await doc.getPage(i);
      const vp1 = pg.getViewport({ scale: 1 });
      const escala = Math.min(2, 900 / vp1.width);
      const vp = pg.getViewport({ scale: escala });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      c.style.cssText = 'width:100%;border-radius:8px;margin-top:6px;border:1px solid #e0e0e0;background:#fff';
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      cont.appendChild(c);
    }
    if (doc.numPages > n) {
      cont.appendChild(caixaMsg(`📄 ${label}: mostrando ${n} de ${doc.numPages} páginas — clique no link do documento acima pra ver completo no navegador.`));
    }
  } catch (e) {
    const protegido = /password/i.test((e && (e.name + ' ' + e.message)) || '');
    cont.appendChild(caixaMsg(protegido
      ? `🔒 ${label} é um PDF protegido por senha (comum em faturas de banco) — clique no link do documento acima e use a senha do titular pra visualizar.`
      : `📄 ${label} é um PDF — clique no link do documento acima para visualizar no navegador.`));
  } finally { termina(); }
};
