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

// Mesma lista do hub-app.js — sites que têm autologin (são os únicos com credenciais)
const SITES = [
  { key: 'alude', nome: 'Alude' },
  { key: 'cadastro_imobiliario', nome: 'Central de Cadastro' },
  { key: 'imovelp', nome: 'Imóvel do Proprietário' },
  { key: 'sp_imovel', nome: 'SP Imóvel' },
  { key: 'forsale', nome: 'Jr Captações (Sigavi360)' }
];

const elListaCred  = document.getElementById('listaCredenciais');
const elListaUser  = document.getElementById('listaUsuarios');
const modalCred    = document.getElementById('modalCred');
const modalUser    = document.getElementById('modalUser');

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
  await Promise.all([carregarCredenciais(), carregarUsuarios()]);
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
          if (!confirm(`Excluir credenciais de ${key}?`)) return;
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

async function carregarUsuarios() {
  elListaUser.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listUsers();
    const usuarios = resp.data;
    elListaUser.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Email</th><th>Admin</th><th>Criado</th><th>Último acesso</th><th></th></tr>
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
              <td><button class="topbar-btn perigo" data-uid="${u.uid}" data-email="${u.email}">Excluir</button></td>
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
        if (!confirm(`Excluir usuário ${b.dataset.email}?`)) return;
        try {
          await deleteUserAccount({ uid: b.dataset.uid });
          carregarUsuarios();
        } catch (e) { alert('Erro: ' + e.message); }
      });
    });
  } catch (err) {
    elListaUser.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}
