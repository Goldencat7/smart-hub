// Página admin: gerenciar credenciais dos sistemas + usuários do Hub
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8",
  authDomain: "remax-smart-hub.firebaseapp.com",
  projectId: "remax-smart-hub",
  storageBucket: "remax-smart-hub.firebasestorage.app",
  messagingSenderId: "474454438949",
  appId: "1:474454438949:web:ba1e10e6b343af0408fbcc"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const fns     = getFunctions(app, 'southamerica-east1');
const storage = getStorage(app);

const listCredentials   = httpsCallable(fns, 'listCredentials');
const getCredentialAdmin = httpsCallable(fns, 'getCredentialAdmin');
const setCredentials    = httpsCallable(fns, 'setCredentials');
const deleteCredentials = httpsCallable(fns, 'deleteCredentials');
const listUsers         = httpsCallable(fns, 'listUsers');
const setUserAdmin      = httpsCallable(fns, 'setUserAdmin');
const createUser        = httpsCallable(fns, 'createUser');
const deleteUserAccount = httpsCallable(fns, 'deleteUserAccount');
const criarCodigoConvite    = httpsCallable(fns, 'criarCodigoConvite');
const listarCodigosConvite  = httpsCallable(fns, 'listarCodigosConvite');
const excluirCodigoConvite  = httpsCallable(fns, 'excluirCodigoConvite');
const getUserAccess  = httpsCallable(fns, 'getUserAccess');
const setUserAccess  = httpsCallable(fns, 'setUserAccess');
const listarStatusApps    = httpsCallable(fns, 'listarStatusApps');
const getTreinamentoLinks = httpsCallable(fns, 'getTreinamentoLinks');
const setTreinamentoLink  = httpsCallable(fns, 'setTreinamentoLink');
const setStatusApp     = httpsCallable(fns, 'setStatusApp');
const getBanner        = httpsCallable(fns, 'getBanner');
const setBanner        = httpsCallable(fns, 'setBanner');

// Estrutura de treinamentos (espelho do hub-app.js)
const TREINAMENTO_CATS = [
  { id: 'onboarding', nome: 'Onboarding', emoji: '📋', itens: [
    { id: 'onb1', nome: 'Do Zero à Primeira Venda' },
    { id: 'onb2', nome: 'Primeiros 30 Dias' },
    { id: 'onb3', nome: 'Cultura REMAX Smart' },
    { id: 'onb4', nome: 'Gestão de Locação Smart' }
  ]},
  { id: 'captacao_t', nome: 'Captação', emoji: '🎯', itens: [
    { id: 'cap1', nome: 'Prospecção de Proprietários' },
    { id: 'cap2', nome: 'Captação por Indicação' },
    { id: 'cap3', nome: 'Captação Digital' }
  ]},
  { id: 'vendas', nome: 'Vendas', emoji: '🤝', itens: [
    { id: 'ven1', nome: 'Processo Completo da Venda' },
    { id: 'ven2', nome: 'Objeções e Negociação' },
    { id: 'ven3', nome: 'Fechamento de Negócios' }
  ]},
  { id: 'locacao_t', nome: 'Locação', emoji: '🏠', itens: [
    { id: 'loc1', nome: 'Primeira Locação' },
    { id: 'loc2', nome: 'Atendimento ao Locatário' },
    { id: 'loc3', nome: 'Processo de Locação' }
  ]},
  { id: 'mkt_t', nome: 'Marketing', emoji: '📣', itens: [
    { id: 'mkt1', nome: 'Instagram para Corretores' },
    { id: 'mkt2', nome: 'Produção de Conteúdo' },
    { id: 'mkt3', nome: 'Posicionamento Digital' }
  ]},
  { id: 'remax', nome: 'REMAX Smart', emoji: '🏢', itens: [
    { id: 'rmx1', nome: 'Modelo de Negócio' },
    { id: 'rmx2', nome: 'Ferramentas da Unidade' },
    { id: 'rmx3', nome: 'Processos Internos' }
  ]}
];

// Apps restritos (aparecem só pra quem o admin liberar)
const APPS_RESTRITOS = [
  { key: 'clicksign', nome: 'ClickSign' }
];

// Todos os apps do Hub (espelha o array APPS do hub-app.js) — pro controle de status
const TODOS_APPS = [
  { key: 'cadastro_imobiliario', nome: 'Central de Cadastro' },
  { key: 'imovelp', nome: 'Imóvel do Proprietário' },
  { key: 'sp_imovel', nome: 'SP Imóvel' },
  { key: 'forsale', nome: 'Jr Captações' },
  { key: 'itbi_smart', nome: 'ITBI Smart' },
  { key: 'checkvisto', nome: 'Smart Vistorias' },
  { key: 'alude', nome: 'Alude' },
  { key: 'clicksign', nome: 'ClickSign' },
  { key: 'motiva', nome: 'Motiva Smart' },
  { key: 'universidade', nome: 'Universidade REMAX' },
  { key: 'goiconnect', nome: 'IConnect' },
  { key: 'brokerapp', nome: 'BrokerApp' }
];

// Mesma lista do hub-app.js — sites que têm autologin (são os únicos com credenciais)
const SITES = [
  { key: 'alude', nome: 'Alude' },
  { key: 'cadastro_imobiliario', nome: 'Central de Cadastro' },
  { key: 'imovelp', nome: 'Imóvel do Proprietário' },
  { key: 'sp_imovel', nome: 'SP Imóvel' },
  { key: 'forsale', nome: 'Jr Captações (Sigavi360)' },
  { key: 'clicksign', nome: 'ClickSign (conta compartilhada)' }
];

const elListaCred  = document.getElementById('listaCredenciais');
const elListaUser  = document.getElementById('listaUsuarios');
const elListaCodigos = document.getElementById('listaCodigos');
const elListaStatus = document.getElementById('listaStatusApps');
const modalCred    = document.getElementById('modalCred');
const modalUser    = document.getElementById('modalUser');
const modalCodigo  = document.getElementById('modalCodigo');
const modalCodigoGerado = document.getElementById('modalCodigoGerado');
const modalPermissoes = document.getElementById('modalPermissoes');
const modalConfirm = document.getElementById('modalConfirm');

// Formata "03/06 14:30"
function fmtDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// Verifica auth + admin
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.hubApi.voltarParaLogin(); return; }
  const t = await user.getIdTokenResult();
  if (!t.claims.admin) {
    alert('Sem permissão de admin.');
    window.hubApi.voltarParaHub();
    return;
  }
  carregarTudo();
});

document.getElementById('btnVoltar').addEventListener('click', () => window.hubApi.voltarParaHub());

document.getElementById('btnNovoUsuario').addEventListener('click', () => {
  document.getElementById('userEmail').value = '';
  document.getElementById('userSenha').value = '';
  document.getElementById('userAdmin').checked = false;
  modalUser.showModal();
});

document.getElementById('btnNovoCodigo').addEventListener('click', () => {
  document.getElementById('codigoMaxUsos').value = '1';
  document.getElementById('codigoValidade').value = '7';
  document.getElementById('codigoFazAdmin').checked = false;
  modalCodigo.showModal();
});
document.getElementById('cancelarCodigo').addEventListener('click', () => modalCodigo.close());
document.getElementById('fecharCodigoGerado').addEventListener('click', () => modalCodigoGerado.close());
document.getElementById('btnCopiarCodigo').addEventListener('click', async () => {
  const txt = document.getElementById('codigoTexto').textContent;
  try { await navigator.clipboard.writeText(txt); alert('Copiado!'); }
  catch(e) { alert('Não copiou. Selecione e Ctrl+C manualmente.'); }
});

document.getElementById('formCodigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const maxUsos = parseInt(document.getElementById('codigoMaxUsos').value, 10);
  const diasRaw = document.getElementById('codigoValidade').value.trim();
  const diasValidade = diasRaw ? parseInt(diasRaw, 10) : null;
  const fazAdmin = document.getElementById('codigoFazAdmin').checked;
  try {
    const r = await criarCodigoConvite({ maxUsos, diasValidade, fazAdmin });
    modalCodigo.close();
    document.getElementById('codigoTexto').textContent = r.data.codigo;
    modalCodigoGerado.showModal();
    carregarCodigos();
  } catch (err) { alert('Erro: ' + err.message); }
});

document.getElementById('cancelarCred').addEventListener('click', () => modalCred.close());
document.getElementById('cancelarUser').addEventListener('click', () => modalUser.close());

document.getElementById('formCred').addEventListener('submit', async (e) => {
  e.preventDefault();
  const siteKey  = document.getElementById('credSiteKey').value;
  const login    = document.getElementById('credLogin').value;
  const password = document.getElementById('credPassword').value;
  try {
    await setCredentials({ siteKey, login, password });
    modalCred.close();
    carregarCredenciais();
  } catch (err) { alert('Erro: ' + err.message); }
});

document.getElementById('formUser').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email   = document.getElementById('userEmail').value;
  const password = document.getElementById('userSenha').value;
  const isAdmin = document.getElementById('userAdmin').checked;
  try {
    await createUser({ email, password, isAdmin });
    modalUser.close();
    carregarUsuarios();
  } catch (err) { alert('Erro: ' + err.message); }
});

async function carregarTudo() {
  await Promise.all([carregarMateriais(), carregarBanner(), carregarCredenciais(), carregarUsuarios(), carregarCodigos(), carregarStatusApps()]);
}

// ─── Materiais de Treinamento ─────────────────────────────────────────────────
const elListaMateriais = document.getElementById('listaMateriais');
let materialUploadTarget = null; // { itemId, nomeAnteriorUrl } — item que receberá o upload

async function carregarMateriais() {
  elListaMateriais.innerHTML = '<p class="muted">carregando...</p>';
  let links = {};
  try { const r = await getTreinamentoLinks(); links = r.data.links || {}; }
  catch (e) { elListaMateriais.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; return; }

  elListaMateriais.innerHTML = TREINAMENTO_CATS.map(cat => `
    <div class="material-cat">
      <div class="material-cat-head">${cat.emoji} ${cat.nome}</div>
      <table class="users-table">
        <tbody>
          ${cat.itens.map(item => {
            const link = links[item.id];
            const temArquivo = !!(link && link.url);
            const nomeArquivo = temArquivo ? decodeURIComponent(link.url.split('%2F').pop().split('?')[0]) : '';
            const tipo = link?.tipo || '';
            const icone = { pdf:'📄', video:'▶', drive:'📁', link:'🔗' }[tipo] || '📎';
            return `
              <tr data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}">
                <td style="width:220px;font-weight:600;font-size:12px">${item.nome}</td>
                <td>
                  ${temArquivo
                    ? `<span class="badge ok">${icone} ${escapeHtml(nomeArquivo.slice(0,40))}</span>`
                    : '<span class="badge falta">Sem arquivo</span>'}
                </td>
                <td class="acoes-user">
                  <button class="topbar-btn mat-upload" data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}">${temArquivo ? 'Trocar' : '↑ Enviar'}</button>
                  ${temArquivo ? `<button class="topbar-btn perigo mat-remover" data-item="${item.id}" data-url="${escapeHtml(link.url)}">Remover</button>` : ''}
                  ${temArquivo ? `<a class="topbar-btn" href="${escapeHtml(link.url)}" target="_blank">Abrir ↗</a>` : ''}
                  <div class="mat-progress" id="prog-${item.id}" hidden>
                    <div class="mat-progress-bar" id="bar-${item.id}"></div>
                    <span id="pct-${item.id}">0%</span>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`).join('');

  // Upload
  elListaMateriais.querySelectorAll('.mat-upload').forEach(btn => {
    btn.addEventListener('click', () => {
      materialUploadTarget = { itemId: btn.dataset.item, urlAnterior: btn.dataset.url };
      document.getElementById('materialFileInput').click();
    });
  });

  // Remover
  elListaMateriais.querySelectorAll('.mat-remover').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmar(`Remover o arquivo de "${btn.closest('tr').querySelector('td').textContent.trim()}"?`))) return;
      try {
        // Apaga do Storage se for URL do Firebase
        if (btn.dataset.url && btn.dataset.url.includes('firebasestorage')) {
          try { await deleteObject(ref(storage, btn.dataset.url)); } catch (_) {}
        }
        await setTreinamentoLink({ itemId: btn.dataset.item, url: '', tipo: 'link' });
        carregarMateriais();
      } catch (e) { alert('Erro: ' + e.message); }
    });
  });
}

// Upload via input de arquivo
document.getElementById('materialFileInput').addEventListener('change', async () => {
  const file = document.getElementById('materialFileInput').files[0];
  document.getElementById('materialFileInput').value = '';
  if (!file || !materialUploadTarget) return;

  const { itemId, urlAnterior } = materialUploadTarget;
  materialUploadTarget = null;

  // Detecta tipo pelo nome
  const ext = file.name.split('.').pop().toLowerCase();
  const tipo = ext === 'pdf' ? 'pdf' : ['mp4','mov','avi'].includes(ext) ? 'video' : 'link';

  // Mostra barra de progresso
  const progEl = document.getElementById(`prog-${itemId}`);
  const barEl  = document.getElementById(`bar-${itemId}`);
  const pctEl  = document.getElementById(`pct-${itemId}`);
  if (progEl) { progEl.hidden = false; }

  try {
    // Apaga arquivo anterior do Storage se existia
    if (urlAnterior && urlAnterior.includes('firebasestorage')) {
      try { await deleteObject(ref(storage, urlAnterior)); } catch (_) {}
    }

    // Faz upload pro Firebase Storage
    const storageRef = ref(storage, `treinamentos/${itemId}/${Date.now()}_${file.name}`);
    const task = uploadBytesResumable(storageRef, file);

    await new Promise((resolve, reject) => {
      task.on('state_changed',
        snap => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          if (barEl) barEl.style.width = pct + '%';
          if (pctEl) pctEl.textContent = pct + '%';
        },
        reject,
        resolve
      );
    });

    const downloadURL = await getDownloadURL(task.snapshot.ref);
    await setTreinamentoLink({ itemId, url: downloadURL, tipo });
    carregarMateriais();
  } catch (e) {
    if (progEl) progEl.hidden = true;
    alert('Erro no upload: ' + e.message);
  }
});

// ─── Banner principal ─────────────────────────────────────────────────────────
let bannerPendente = null; // null = sem mudança, '' = remover, string = nova imagem

async function carregarBanner() {
  const el = document.getElementById('bannerAdmin');
  el.innerHTML = '<p class="muted">carregando...</p>';
  let imagemAtual = '';
  try {
    const r = await getBanner();
    imagemAtual = r.data.imagem || '';
  } catch (e) {
    el.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; return;
  }
  bannerPendente = null;
  renderBannerAdmin(el, imagemAtual);
}

function renderBannerAdmin(el, imagemAtual) {
  el.innerHTML = `
    <div class="banner-admin-preview">
      ${imagemAtual
        ? `<img id="bannerPreviewImg" src="${imagemAtual}" class="banner-preview-img" alt="Banner atual">`
        : `<div class="banner-preview-vazio"><span>Nenhum banner cadastrado</span></div>`}
    </div>
    <div class="banner-admin-acoes">
      <button class="topbar-btn primario" id="bannerEscolher"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>${imagemAtual ? 'Trocar imagem' : 'Enviar imagem'}</button>
      ${imagemAtual ? '<button class="topbar-btn perigo" id="bannerRemover">✕ Remover banner</button>' : ''}
      <span id="bannerMsg" class="muted" style="font-size:11px"></span>
    </div>`;

  document.getElementById('bannerEscolher').addEventListener('click', () => {
    document.getElementById('bannerFileInput').click();
  });
  document.getElementById('bannerRemover')?.addEventListener('click', async () => {
    if (!(await confirmar('Remover o banner atual?'))) return;
    try {
      await setBanner({ imagem: '' });
      carregarBanner();
    } catch (e) { alert('Erro: ' + e.message); }
  });
}

document.getElementById('bannerFileInput').addEventListener('change', async () => {
  const f = document.getElementById('bannerFileInput').files[0];
  document.getElementById('bannerFileInput').value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => alert('Não consegui ler essa imagem. Tente PNG ou JPG.');
    img.onload = async () => {
      // Redimensiona e recorta na proporção 6:1 (900×150 base, 1800×300 @2x)
      const MAX_W = 1800, MAX_H = 300;
      let sw = img.width, sh = img.height;
      const escala = Math.min(MAX_W / sw, MAX_H / sh, 1);
      const w = Math.round(sw * escala), h = Math.round(sh * escala);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataURL = canvas.toDataURL('image/jpeg', 0.88);
      if (dataURL.length > 600000) { alert('Imagem ainda muito grande após compressão. Use JPEG em menor resolução.'); return; }
      const el = document.getElementById('bannerAdmin');
      const msg = document.getElementById('bannerMsg');
      const btn = document.getElementById('bannerEscolher');
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        await setBanner({ imagem: dataURL });
        carregarBanner();
      } catch (e) {
        msg.textContent = 'Erro: ' + e.message;
        btn.disabled = false; btn.textContent = 'Trocar imagem';
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});

// ─── Status dos apps (avisos de instabilidade) ───────────────────────────────
function escHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function carregarStatusApps() {
  elListaStatus.innerHTML = '<p class="muted">carregando...</p>';
  let ativos = {};
  try {
    const r = await listarStatusApps();
    ativos = r.data.status || {};
  } catch (e) {
    elListaStatus.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
    return;
  }
  elListaStatus.innerHTML = `
    <table class="users-table">
      <thead><tr><th>App</th><th>Mensagem de aviso</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${TODOS_APPS.map(a => {
          const ativo = a.key in ativos;
          const msg = ativos[a.key] || '';
          return `
            <tr data-key="${a.key}">
              <td><strong>${escHtml(a.nome)}</strong></td>
              <td>
                <select class="foto-input status-msg">
                  <option value="Indisponível" ${msg === 'Indisponível' ? 'selected' : ''}>Indisponível</option>
                  <option value="Em manutenção" ${msg === 'Em manutenção' ? 'selected' : ''}>Em manutenção</option>
                </select>
              </td>
              <td>${ativo ? '<span class="badge falta">⚠ Com aviso</span>' : '<span class="badge ok">OK</span>'}</td>
              <td class="acoes-user">
                <button class="topbar-btn status-ativar">${ativo ? 'Atualizar' : 'Ativar aviso'}</button>
                ${ativo ? '<button class="topbar-btn perigo status-limpar">Limpar</button>' : ''}
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  elListaStatus.querySelectorAll('tr[data-key]').forEach(row => {
    const key = row.dataset.key;
    const input = row.querySelector('.status-msg');
    row.querySelector('.status-ativar').addEventListener('click', async () => {
      const mensagem = input.value; // "Indisponível" ou "Em manutenção"
      try { await setStatusApp({ siteKey: key, mensagem, ativo: true }); carregarStatusApps(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
    row.querySelector('.status-limpar')?.addEventListener('click', async () => {
      try { await setStatusApp({ siteKey: key, ativo: false }); carregarStatusApps(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
}

async function carregarCredenciais() {
  elListaCred.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listCredentials();
    const existentes = new Map(resp.data.map(r => [r.siteKey, r]));

    elListaCred.innerHTML = '';
    for (const site of SITES) {
      const dado = existentes.get(site.key);
      const status = dado?.temSenha
        ? `<span class="badge ok">✓ Cadastrada</span>`
        : `<span class="badge falta">! Não cadastrada</span>`;
      const login = dado?.login ? `<code>${dado.login}</code>` : '<em class="muted">—</em>';

      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <div class="admin-card-head">
          <h4>${site.nome}</h4>
          ${status}
        </div>
        <p class="admin-card-row">Login: ${login}</p>
        <p class="admin-card-row">Senha: <em class="muted">oculta</em></p>
        <div class="admin-card-actions">
          <button class="topbar-btn" data-acao="editar" data-key="${site.key}" data-nome="${site.nome}">Editar</button>
          ${dado ? `<button class="topbar-btn perigo" data-acao="excluir" data-key="${site.key}">Excluir</button>` : ''}
        </div>
      `;
      elListaCred.appendChild(card);
    }

    elListaCred.querySelectorAll('button[data-acao]').forEach(b => {
      b.addEventListener('click', async () => {
        const acao = b.dataset.acao;
        const key  = b.dataset.key;
        if (acao === 'editar') abrirModalCredencial(key, b.dataset.nome);
        if (acao === 'excluir') {
          if (!(await confirmar(`Excluir as credenciais de ${key}?`))) return;
          await deleteCredentials({ siteKey: key });
          carregarCredenciais();
        }
      });
    });
  } catch (err) {
    elListaCred.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

async function abrirModalCredencial(siteKey, nome) {
  document.getElementById('modalCredTitulo').textContent = `Credencial: ${nome}`;
  document.getElementById('credSiteKey').value = siteKey;
  document.getElementById('credLogin').value = '';
  document.getElementById('credPassword').value = '';
  try {
    const r = await getCredentialAdmin({ siteKey });
    document.getElementById('credLogin').value = r.data.login || '';
    document.getElementById('credPassword').value = r.data.password || '';
  } catch (e) { /* sem credenciais ainda */ }
  modalCred.showModal();
}

async function carregarCodigos() {
  elListaCodigos.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listarCodigosConvite();
    const lista = resp.data;
    if (lista.length === 0) {
      elListaCodigos.innerHTML = '<p class="muted">Nenhum código ainda. Clique em "+ Gerar código" pra criar.</p>';
      return;
    }
    elListaCodigos.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Código</th><th>Usos</th><th>Admin?</th><th>Validade</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${lista.map(c => {
            const status = c.expirado ? '<span class="badge falta">Expirado</span>'
                         : c.esgotado ? '<span class="badge falta">Esgotado</span>'
                         : '<span class="badge ok">Ativo</span>';
            const validade = c.expiraEm ? new Date(c.expiraEm).toLocaleDateString('pt-BR') : 'Sem validade';
            return `
              <tr>
                <td><code>${c.codigo}</code></td>
                <td>${c.usos}/${c.maxUsos}</td>
                <td>${c.fazAdmin ? 'Sim' : 'Não'}</td>
                <td>${validade}</td>
                <td>${status}</td>
                <td><button class="topbar-btn perigo" data-cod="${c.codigo}">Excluir</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    elListaCodigos.querySelectorAll('button[data-cod]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!(await confirmar(`Excluir o código ${b.dataset.cod}?`))) return;
        try {
          await excluirCodigoConvite({ codigo: b.dataset.cod });
          carregarCodigos();
        } catch (e) { alert('Erro: ' + e.message); }
      });
    });
  } catch (err) {
    elListaCodigos.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

async function carregarUsuarios() {
  elListaUser.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listUsers();
    const usuarios = resp.data;
    elListaUser.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Email</th><th>Admin</th><th>Criado</th><th>Último acesso</th><th>Último app</th><th></th></tr>
        </thead>
        <tbody>
          ${usuarios.map(u => `
            <tr>
              <td>${u.email || '<em>sem email</em>'}</td>
              <td>
                <input type="checkbox" ${u.isAdmin ? 'checked' : ''} data-uid="${u.uid}" class="toggle-admin">
              </td>
              <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
              <td>${u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString('pt-BR') : 'nunca'}</td>
              <td>${u.lastApp ? `${u.lastApp} · ${fmtDataHora(u.lastAppAt)}` : '<span class="muted">—</span>'}</td>
              <td class="acoes-user">
                <button class="topbar-btn" data-perm="${u.uid}" data-email="${u.email || ''}">Permissões</button>
                <button class="topbar-btn perigo" data-uid="${u.uid}" data-email="${u.email}">Excluir</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    elListaUser.querySelectorAll('.toggle-admin').forEach(cb => {
      cb.addEventListener('change', async () => {
        try {
          await setUserAdmin({ uid: cb.dataset.uid, isAdmin: cb.checked });
        } catch (e) { alert('Erro: ' + e.message); cb.checked = !cb.checked; }
      });
    });
    elListaUser.querySelectorAll('button[data-uid]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!(await confirmar(`Excluir o usuário ${b.dataset.email}? Essa ação não pode ser desfeita.`))) return;
        try {
          await deleteUserAccount({ uid: b.dataset.uid });
          carregarUsuarios();
        } catch (e) { alert('Erro: ' + e.message); }
      });
    });
    elListaUser.querySelectorAll('button[data-perm]').forEach(b => {
      b.addEventListener('click', () => abrirModalPermissoes(b.dataset.perm, b.dataset.email));
    });
  } catch (err) {
    elListaUser.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

// ─── Modal de permissões (apps restritos por usuário) ────────────────────────
async function abrirModalPermissoes(uid, email) {
  document.getElementById('permUid').value = uid;
  document.getElementById('permEmail').textContent = email || '(sem email)';
  const cont = document.getElementById('permLista');
  cont.innerHTML = '<p class="muted">carregando...</p>';
  modalPermissoes.showModal();
  try {
    const r = await getUserAccess({ uid });
    const liberados = r.data.apps || [];
    const alvoAdmin = !!r.data.isAdmin;
    const temFoto = !!r.data.drives_fotografia;
    cont.innerHTML =
      (alvoAdmin ? '<p class="muted">Este usuário é admin — já enxerga todos os apps restritos.</p>' : '') +
      APPS_RESTRITOS.map(a => `
        <label class="auth-label-inline">
          <input type="checkbox" value="${a.key}"
            ${(alvoAdmin || liberados.includes(a.key)) ? 'checked' : ''}
            ${alvoAdmin ? 'disabled' : ''}>
          ${a.nome}
        </label>
      `).join('') +
      `<hr style="border-color:var(--border);margin:10px 0">
       <p class="muted" style="font-size:11px;margin:0 0 6px">Permissões especiais:</p>
       <label class="auth-label-inline">
         <input type="checkbox" id="permDrivesFotografia" ${temFoto ? 'checked' : ''}>
         Drives Fotografia <span class="muted" style="font-size:10px">(gerenciar pastas de fotos)</span>
       </label>`;
  } catch (e) {
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

document.getElementById('cancelarPermissoes').addEventListener('click', () => modalPermissoes.close());
document.getElementById('formPermissoes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('permUid').value;
  const apps = Array.from(document.querySelectorAll('#permLista input[type="checkbox"]:not(#permDrivesFotografia):checked')).map(c => c.value);
  const drives_fotografia = !!(document.getElementById('permDrivesFotografia')?.checked);
  try {
    await setUserAccess({ uid, apps, drives_fotografia });
    modalPermissoes.close();
  } catch (err) { alert('Erro: ' + err.message); }
});

// ─── Confirmação estilizada (no lugar do confirm() do navegador) ─────────────
// ─── Confirmação estilizada (no lugar do confirm() do navegador) ─────────────
function confirmar(mensagem) {
  return new Promise((resolve) => {
    document.getElementById('confirmMsg').textContent = mensagem;
    const btnSim = document.getElementById('confirmSim');
    const btnNao = document.getElementById('confirmNao');
    
    const fechar = (valor) => {
      btnSim.removeEventListener('click', onSim);
      btnNao.removeEventListener('click', onNao);
      modalConfirm.removeEventListener('cancel', onCancel); // Limpa o evento do ESC
      modalConfirm.close();
      resolve(valor);
    };
    
    const onSim = () => fechar(true);
    const onNao = () => fechar(false);
    
    // Se a pessoa apertar ESC, cancelamos a Promise com "false"
    const onCancel = (e) => {
      e.preventDefault(); 
      fechar(false);
    };

    btnSim.addEventListener('click', onSim);
    btnNao.addEventListener('click', onNao);
    modalConfirm.addEventListener('cancel', onCancel); // Ouve a tecla ESC
    
    modalConfirm.showModal();
  });
}
