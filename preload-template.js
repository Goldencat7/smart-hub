// ─── Preload da janela de template de marketing (desktop) ────────────────────
// Semeia o estado do editor com o perfil do corretor ANTES de o template rodar,
// pra nome/telefone/foto já virem preenchidos — o mesmo que o platform-web faz na
// web gravando localStorage['vendido_editor_v6'] antes de abrir a aba.
//
// Por que aqui e não no main via executeJavaScript: o preload roda ANTES dos scripts
// da página, então o loadState do editor (que só corre depois do bundle se remontar)
// enxerga o que gravamos — sem corrida. O perfil vem do main por IPC síncrono (não
// por argumento de linha de comando, que tem limite de tamanho e cortaria a foto).
const { ipcRenderer } = require('electron');

try {
  const prefill = ipcRenderer.sendSync('template-prefill-get');
  if (prefill && (prefill.nome || prefill.phone || prefill.agent)) {
    // 1) Vendido: lê este estado de fábrica (built no bundle).
    const KEY = 'vendido_editor_v6';
    let atual = {};
    try { atual = JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}; } catch (_) {}
    if (prefill.nome)  atual.nome  = prefill.nome;
    if (prefill.phone) atual.phone = prefill.phone;   // contato na arte
    if (prefill.agent) atual.agent = prefill.agent;   // foto do corretor
    window.localStorage.setItem(KEY, JSON.stringify(atual));

    // 2) Demais templates: um "preenchedor" injetado no HTML lê esta chave genérica
    // (nome/telefone/foto) e preenche os campos. Assim novos templates só precisam
    // do preenchedor, sem mexer aqui. Ver o <script> injetado em cada template.
    try {
      window.localStorage.setItem('smarthub_perfil', JSON.stringify({
        nome: prefill.nome || '',
        telefone: prefill.phone || '',
        foto: prefill.agent || ''
      }));
    } catch (_) { /* storage indisponível: template abre com o demo */ }
  }
} catch (_) { /* sem prefill / storage indisponível: o template abre normal */ }
