// Motor Firebase compartilhado para todos os formulários de ficha
// Carregado via <script type="module" src="ficha-engine.js?tipo=XXX">

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getFirestore, collection, addDoc, doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';

const app = initializeApp({
  apiKey: "AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8",
  authDomain: "remax-smart-hub.firebaseapp.com",
  projectId: "remax-smart-hub",
  storageBucket: "remax-smart-hub.firebasestorage.app",
  messagingSenderId: "474454438949",
  appId: "1:474454438949:web:ba1e10e6b343af0408fbcc"
});
const db = getFirestore(app);
const storage = getStorage(app);

// tipo vem do ?tipo= no src do <script>. Usa a URL API (robusto contra fragmentos/edge cases).
let tipo = 'pf';
try { tipo = new URL(import.meta.url).searchParams.get('tipo') || 'pf'; } catch(e) {}
const params = new URLSearchParams(location.search);
const modo         = params.get('modo') || 'cliente';
const corretorUid  = params.get('corretor') || '';
const corretorNome = params.get('nome') ? decodeURIComponent(params.get('nome')) : '';
const idFicha      = params.get('idFicha') || '';
const origemHub    = params.get('origem') === 'hub';

const arquivos = {};
const pendentes = new Set();

// Escape p/ inserção segura em innerHTML — dados do Firestore são preenchidos por
// clientes anônimos, então nunca vão pra innerHTML sem passar por aqui.
function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Inicialização por modo ──────────────────────────────────────────────────
if (modo === 'corretor' && idFicha) {
  iniciarModoCorretor();
} else if (modo === 'edicao' && idFicha) {
  iniciarModoEdicao();
} else {
  iniciarModoCliente();
}

function iniciarModoCliente() {
  configurarEventos();
}

async function iniciarModoEdicao() {
  const badge = document.getElementById('badgeModo');
  if (badge) { badge.style.display = 'inline'; badge.textContent = 'Edição'; }
  const btn = document.getElementById('btnSubmit');
  if (btn) btn.textContent = 'Salvar alterações';

  try {
    const snap = await getDoc(doc(db, 'fichas', idFicha));
    if (!snap.exists()) { mostrarErro('Ficha não encontrada.'); return; }
    const ficha = snap.data();

    // Link de uso único: só vale enquanto a ficha está aguardando o cliente.
    // O corretor abrindo pelo hub (origem=hub) edita livremente.
    if (!origemHub && ficha.status !== 'aguardando_edicao_cliente') {
      mostrarErro('Este link não está mais ativo. Caso precise fazer alterações, peça ao seu corretor um novo link.');
      return;
    }

    if (ficha.observacaoCorretor) {
      const intro = document.getElementById('introTexto');
      if (intro) intro.innerHTML = `<p>📝 <strong>Observação do corretor:</strong> ${escHtml(ficha.observacaoCorretor)}</p><p style="margin-top:8px;color:#444">Atualize as informações e clique em <strong>Salvar alterações</strong>.</p>`;
    }
    Object.entries(ficha.dados || {}).forEach(([k,v]) => {
      const el = document.querySelector(`[name="${k}"]`);
      if (el) el.value = v || '';
    });
    (ficha.pendentes || []).forEach(campo => {
      const cb = document.querySelector(`[data-campo="${campo}"], [data-doc-campo="${campo}"]`);
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    });
    atualizarProgresso();
  } catch(e) { mostrarErro('Erro ao carregar ficha: ' + e.message); }
  configurarEventos();
}

async function iniciarModoCorretor() {
  const barraCorretor = document.getElementById('barraCorretor');
  if (barraCorretor) barraCorretor.style.display = origemHub ? 'none' : 'flex';
  const badge = document.getElementById('badgeModo');
  if (badge) { badge.style.display = 'inline'; badge.textContent = 'Revisão'; }
  const intro = document.getElementById('introTexto');
  if (intro) intro.style.display = 'none';
  const btn = document.getElementById('btnSubmit');
  if (btn) btn.style.display = 'none';

  try {
    const snap = await getDoc(doc(db, 'fichas', idFicha));
    if (!snap.exists()) { if (intro) { intro.innerHTML = '<p style="color:#dc2626">Ficha não encontrada.</p>'; intro.style.display = 'block'; } return; }
    const ficha = snap.data();
    const dados = ficha.dados || {};
    document.querySelectorAll('input:not([type=checkbox]):not([type=file]), select, textarea').forEach(el => { el.readOnly = true; if (el.tagName === 'SELECT') el.disabled = true; });
    document.querySelectorAll('.nao-tenho').forEach(el => el.style.display = 'none');
    Object.entries(dados).forEach(([k,v]) => { const el = document.querySelector(`[name="${k}"]`); if (el) el.value = v||''; });
    const pendList = ficha.pendentes || [];
    if (pendList.length > 0) {
      const resumo = document.getElementById('resumoPendencias');
      const lista = document.getElementById('listaPendencias');
      if (resumo) resumo.style.display = 'block';
      if (lista) lista.innerHTML = pendList.map(p => `<li>${escHtml(p)}</li>`).join('');
      pendList.forEach(c => { const t = document.getElementById(`pend-${c}`); if (t) t.style.display = 'inline-block'; });
    }
    window.__fichaId = idFicha;
  } catch(e) { mostrarErro('Erro: ' + e.message); }
  atualizarBadges();
}

function configurarEventos() {
  // Campos "Não tenho agora"
  document.querySelectorAll('[data-campo]').forEach(cb => {
    const campo = cb.dataset.campo;
    const input = document.querySelector(`[name="${campo}"]`);
    const pend  = document.getElementById(`pend-${campo}`);
    cb.addEventListener('change', () => {
      if (cb.checked) { pendentes.add(campo); if (input) { input.disabled = true; input.value = ''; } if (pend) pend.style.display = 'inline-block'; }
      else { pendentes.delete(campo); if (input) input.disabled = false; if (pend) pend.style.display = 'none'; }
      atualizarProgresso();
    });
  });

  // Documentos "Não tenho agora"
  document.querySelectorAll('[data-doc-campo]').forEach(cb => {
    const campo = cb.dataset.docCampo;
    const area  = cb.closest('.doc-wrapper')?.querySelector('.doc-area');
    const pend  = document.getElementById(`pend-${campo}`);
    cb.addEventListener('change', () => {
      if (cb.checked) { pendentes.add(campo); delete arquivos[campo]; if (area) { area.classList.remove('tem-arquivo'); area.classList.add('pendente-doc'); } const st = document.getElementById(`status-${campo}`); if (st) st.textContent = 'Pendente'; if (pend) pend.style.display = 'inline-block'; }
      else { pendentes.delete(campo); if (area) area.classList.remove('pendente-doc'); const st = document.getElementById(`status-${campo}`); if (st) st.textContent = 'Toque para selecionar'; if (pend) pend.style.display = 'none'; }
      atualizarProgresso();
    });
  });

  // CEP automático
  const campoCep = document.getElementById('campoCep');
  if (campoCep) campoCep.addEventListener('blur', async function() {
    const cep = this.value.replace(/\D/g,'');
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (!d.erro) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v||''; };
        set('campoLogradouro', d.logradouro); set('campoBairro', d.bairro); set('campoCidade', d.localidade); set('campoEstado', d.uf);
        atualizarProgresso();
      }
    } catch(e) {}
  });

  // Máscara CPF
  document.querySelectorAll('[name="cpf"], [name="cpfFiador"], [name="cpfRepresentante"]').forEach(el => {
    el.addEventListener('input', function() {
      let v = this.value.replace(/\D/g,'').slice(0,11);
      if (v.length>9) v=v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6,9)+'-'+v.slice(9);
      else if (v.length>6) v=v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6);
      else if (v.length>3) v=v.slice(0,3)+'.'+v.slice(3);
      this.value=v; atualizarProgresso();
    });
  });

  // Máscara CNPJ
  document.querySelectorAll('[name="cnpj"]').forEach(el => {
    el.addEventListener('input', function() {
      let v = this.value.replace(/\D/g,'').slice(0,14);
      if (v.length>12) v=v.slice(0,2)+'.'+v.slice(2,5)+'.'+v.slice(5,8)+'/'+v.slice(8,12)+'-'+v.slice(12);
      else if (v.length>8) v=v.slice(0,2)+'.'+v.slice(2,5)+'.'+v.slice(5,8)+'/'+v.slice(8);
      else if (v.length>5) v=v.slice(0,2)+'.'+v.slice(2,5)+'.'+v.slice(5);
      else if (v.length>2) v=v.slice(0,2)+'.'+v.slice(2);
      this.value=v; atualizarProgresso();
    });
  });

  document.querySelectorAll('input,select,textarea').forEach(el => el.addEventListener('input', atualizarProgresso));

  const form = document.getElementById('formFicha');
  if (form) form.addEventListener('submit', enviarFicha);
}

function atualizarProgresso() {
  const inputs = document.querySelectorAll('input[name]:not([type=checkbox]):not([type=file]), select[name]');
  let total = 0, ok = 0;
  inputs.forEach(el => {
    total++;
    if (pendentes.has(el.name) || el.value.trim() || arquivos[el.name]) ok++;
  });
  Object.keys(arquivos).forEach(k => { if (!document.querySelector(`[name="${k}"]`)) { total++; ok++; } });
  const pct = total > 0 ? Math.round((ok/total)*100) : 0;
  const bar = document.getElementById('progressFill');
  if (bar) bar.style.width = pct + '%';
  atualizarBadges();
}

function atualizarBadges() {
  // Campos de texto / select
  document.querySelectorAll('.field').forEach(field => {
    const badge = field.querySelector('.badge-obrig, .badge-preen');
    if (!badge) return;
    const input = field.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea');
    if (!input) return;
    const preenchido = input.value.trim() !== '';
    badge.textContent = preenchido ? 'Preenchido' : 'Obrigatório';
    badge.className   = preenchido ? 'badge-preen' : 'badge-obrig';
  });
  // Documentos
  document.querySelectorAll('.doc-label').forEach(label => {
    const badge = label.querySelector('.badge-obrig, .badge-preen');
    if (!badge) return;
    const area = label.closest('.doc-wrapper')?.querySelector('.doc-area');
    const preenchido = area?.classList.contains('tem-arquivo');
    badge.textContent = preenchido ? 'Preenchido' : 'Obrigatório';
    badge.className   = preenchido ? 'badge-preen' : 'badge-obrig';
  });
}

async function enviarFicha(e) {
  e.preventDefault();
  if (!corretorUid) { mostrarErro('Link inválido. Solicite um novo link ao seu corretor.'); return; }

  const form = e.target;
  const rigidos = ['nome','whatsapp','email'];
  const faltando = rigidos.filter(c => { const el = form.querySelector(`[name="${c}"]`); return el && !el.value.trim(); });
  if (faltando.length > 0) { mostrarErro('Preencha pelo menos nome, WhatsApp e e-mail.'); form.querySelector(`[name="${faltando[0]}"]`)?.focus(); return; }

  const btn = document.getElementById('btnSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  document.getElementById('erroFinal').style.display = 'none';

  const dados = {};
  new FormData(form).forEach((v,k) => { if (v) dados[k] = v; });

  const fichaId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const urlsDocs = {};
  const docsKeys = Object.keys(arquivos);
  if (docsKeys.length > 0) {
    const prog = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    if (prog) prog.style.display = 'block';
    let n = 0;
    for (const campo of docsKeys) {
      try {
        const r = ref(storage, `fichas/${tipo}/${fichaId}/${campo}`);
        await uploadBytes(r, arquivos[campo]);
        urlsDocs[campo] = await getDownloadURL(r);
      } catch(err) { console.warn('Upload falhou:', campo, err.message); pendentes.add(campo); }
      if (fill) fill.style.width = Math.round((++n/docsKeys.length)*100)+'%';
    }
  }

  try {
    if (modo === 'edicao' && idFicha) {
      const existente = await getDoc(doc(db, 'fichas', idFicha));
      const docsAntigos = existente.exists() ? (existente.data().documentos||{}) : {};
      await updateDoc(doc(db, 'fichas', idFicha), { status:'aguardando_corretor', dados, documentos:{...docsAntigos,...urlsDocs}, pendentes:Array.from(pendentes), observacaoCorretor:'', atualizadoEm:serverTimestamp() });
    } else {
      await addDoc(collection(db, 'fichas'), { tipo, id:fichaId, corretorUid, corretorNome, status:'aguardando_corretor', dados, documentos:urlsDocs, pendentes:Array.from(pendentes), criadoEm:serverTimestamp() });
    }
    document.getElementById('formFicha').style.display = 'none';
    document.getElementById('tela-sucesso').style.display = 'block';
    const t = document.getElementById('sucessoTitulo');
    const m = document.getElementById('sucessoMsg');
    if (t) t.textContent = modo==='edicao' ? 'Alterações salvas!' : 'Ficha enviada!';
    if (m) m.textContent = modo==='edicao' ? 'Suas informações foram atualizadas.' : 'Seu corretor receberá suas informações em breve.';
    const bar = document.getElementById('progressFill');
    if (bar) bar.style.width = '100%';
    window.scrollTo({top:0,behavior:'smooth'});
  } catch(err) {
    mostrarErro('Erro ao enviar. Verifique sua conexão e tente novamente.');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar ficha'; }
  }
}

function mostrarErro(msg) {
  const el = document.getElementById('erroFinal');
  if (!el) return;
  el.textContent = msg; el.style.display = 'block';
  el.scrollIntoView({behavior:'smooth',block:'center'});
}

// Expostas globalmente
window.triggerFile = function(campo) {
  const cb = document.querySelector(`[data-doc-campo="${campo}"]`);
  if (cb && cb.checked) return;
  const fi = document.getElementById(`file-${campo}`);
  if (fi) fi.click();
};

window.docSelecionado = function(input) {
  const campo = input.dataset.doc;
  const area = input.closest('.doc-wrapper')?.querySelector('.doc-area');
  if (input.files[0]) {
    arquivos[campo] = input.files[0];
    if (area) { area.classList.add('tem-arquivo'); area.classList.remove('pendente-doc'); }
    const st = document.getElementById(`status-${campo}`);
    if (st) st.textContent = '✓ ' + input.files[0].name;
    atualizarProgresso();
  }
};

window.enviarParaAdmin = async function() {
  if (!window.__fichaId) return;
  if (!confirm('Confirma envio ao administrativo?')) return;
  try {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js');
    const fns = getFunctions(app, 'southamerica-east1');
    await httpsCallable(fns, 'enviarFichaTipoAdmin')({ fichaId: window.__fichaId });
    alert('Ficha enviada ao administrativo!'); window.close();
  } catch(e) { alert('Erro: ' + e.message); }
};

window.solicitarCorrecao = function() {
  const msg = prompt('Descreva o que precisa ser corrigido:');
  if (!msg) return;
  import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js').then(({ doc: fsDoc, updateDoc: fsUpdate, serverTimestamp: fsST }) => {
    fsUpdate(fsDoc(db, 'fichas', window.__fichaId), { status:'correcao_solicitada', observacaoCorretor:msg, atualizadoEm:fsST() })
      .then(() => alert('Solicitação registrada.')).catch(e => alert('Erro: '+e.message));
  });
};
