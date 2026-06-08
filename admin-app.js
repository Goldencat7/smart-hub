// Página admin: gerenciar credenciais dos sistemas + usuários do Hub
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8",
  authDomain: "remax-smart-hub.firebaseapp.com",
  projectId: "remax-smart-hub",
  storageBucket: "remax-smart-hub.firebasestorage.app",
  messagingSenderId: "474454438949",
  appId: "1:474454438949:web:ba1e10e6b343af0408fbcc"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fns  = getFunctions(app, 'southamerica-east1');

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

// Apps restritos (aparecem só pra quem o admin liberar)
const APPS_RESTRITOS = [
  { key: 'clicksign', nome: 'ClickSign' }
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
  await Promise.all([carregarCredenciais(), carregarUsuarios(), carregarCodigos()]);
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
    cont.innerHTML =
      (alvoAdmin ? '<p class="muted">Este usuário é admin — já enxerga todos os apps.</p>' : '') +
      APPS_RESTRITOS.map(a => `
        <label class="auth-label-inline">
          <input type="checkbox" value="${a.key}"
            ${(alvoAdmin || liberados.includes(a.key)) ? 'checked' : ''}
            ${alvoAdmin ? 'disabled' : ''}>
          ${a.nome}
        </label>
      `).join('');
  } catch (e) {
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

document.getElementById('cancelarPermissoes').addEventListener('click', () => modalPermissoes.close());
document.getElementById('formPermissoes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('permUid').value;
  const apps = Array.from(document.querySelectorAll('#permLista input[type="checkbox"]:checked')).map(c => c.value);
  try {
    await setUserAccess({ uid, apps });
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
