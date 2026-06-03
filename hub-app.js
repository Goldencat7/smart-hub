// Lógica da tela principal do Hub:
// - Sidebar com categorias + busca por categoria
// - Verifica auth, busca credenciais via Cloud Function ao clicar
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

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

const getCredentials = httpsCallable(fns, 'getCredentials');
const bootstrapAdmin = httpsCallable(fns, 'bootstrapAdmin');
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const registrarAcesso = httpsCallable(fns, 'registrarAcesso');
const getMeuPerfil = httpsCallable(fns, 'getMeuPerfil');
const salvarMeuPerfil = httpsCallable(fns, 'salvarMeuPerfil');

const BOOTSTRAP_ADMIN_UIDS = ['OwcT6wCrXMgJ0tPADMUdKdBB8h32'];

// ─── Catálogo de apps ─────────────────────────────────────────────────────
// Cada app tem categoria + url + se usa autologin
const APPS = [
  {
    key: 'cadastro_imobiliario', categoria: 'captacao',
    titulo: 'Central de Cadastro', icone: 'CC', desc: 'centraldecadastroimobiliario.com',
    url: 'https://centraldecadastroimobiliario.com/login/', autologin: true
  },
  {
    key: 'imovelp', categoria: 'captacao',
    titulo: 'Imóvel do Proprietário', icone: 'IP', desc: 'Gestão de imóveis',
    url: 'https://www.imovelp.com.br/login', autologin: true
  },
  {
    key: 'sp_imovel', categoria: 'captacao',
    titulo: 'SP Imóvel', icone: 'SP', desc: 'Captação SP',
    url: 'https://captacao.spimovel.com.br/', autologin: true
  },
  {
    key: 'forsale', categoria: 'captacao',
    titulo: 'Jr Captações', icone: 'JC', desc: 'Sigavi360',
    url: 'https://jr.sigavi360.com.br/Login.aspx?ReturnUrl=%2f', autologin: true
  },
  {
    key: 'checkvisto', categoria: 'vistoria',
    titulo: 'Smart Vistorias', icone: 'SV', desc: 'Controle de visitas',
    url: 'https://checkvisto-app.web.app', autologin: false
  },
  {
    key: 'alude', categoria: 'locacao',
    titulo: 'Alude', icone: 'AL', desc: 'Análise de crédito',
    url: 'https://app.alude.com.br/', autologin: true
  },
  {
    key: 'clicksign', categoria: 'locacao',
    titulo: 'ClickSign', icone: 'CS', desc: 'Assinatura digital',
    url: 'https://app.clicksign.com/', autologin: true, restrito: true
  },
  {
    key: 'motiva', categoria: 'performance',
    titulo: 'Motiva Smart', icone: 'MS', desc: 'Motivação & metas',
    url: 'https://motivatech-app.web.app', autologin: false
  },
  {
    key: 'universidade', categoria: 'treinamento',
    titulo: 'Universidade RE/MAX', icone: 'UR', desc: 'Treinamento e cursos',
    url: 'https://universidaderemax.studionmx.com/', autologin: false
  },
  {
    key: 'goiconnect', categoria: 'crm',
    titulo: 'IConnect', icone: 'IC', desc: 'goiconnect.com',
    url: 'https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f', autologin: false
  }
];

const CATEGORIAS = [
  { id: 'captacao',    nome: 'Captação',    icone: '🏠' },
  { id: 'crm',         nome: 'CRM',         icone: '📇' },
  { id: 'vistoria',    nome: 'Vistoria',    icone: '🔎' },
  { id: 'locacao',     nome: 'Locação',     icone: '🤝' },
  { id: 'performance', nome: 'Performance', icone: '📊' },
  { id: 'treinamento', nome: 'Treinamento', icone: '🎓' },
  { id: 'documentos',  nome: 'Documentos',  icone: '📄', placeholder: true },
  { id: 'config',      nome: 'Configurações', icone: '⚙️', config: true }
];

// Avatar padrão (quando a pessoa não tem foto)
const AVATAR_PADRAO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1d222d"/><circle cx="60" cy="46" r="22" fill="#6b7280"/><rect x="24" y="74" width="72" height="48" rx="24" fill="#6b7280"/></svg>'
);

let categoriaAtiva = 'captacao';
let termoBusca = '';
let isAdmin = false;
let appsPermitidos = []; // apps restritos liberados pra este usuário

// ─── DOM ─────────────────────────────────────────────────────────────────
const navCategorias  = document.getElementById('navCategorias');
const tituloCategoria = document.getElementById('tituloCategoria');
const inputBusca     = document.getElementById('inputBusca');
const appsGrid       = document.getElementById('appsGrid');
const estadoVazio    = document.getElementById('estadoVazio');
const secaoDocs      = document.getElementById('secaoDocumentos');
const secaoConfig    = document.getElementById('secaoConfig');
const usuarioInfo    = document.getElementById('usuarioInfo');
const topAvatar      = document.getElementById('topAvatar');
const btnAdmin       = document.getElementById('btnAdmin');
const btnSair        = document.getElementById('btnSair');

// Refs da aba Configurações
const cfgAvatar      = document.getElementById('cfgAvatar');
const cfgTrocarFoto  = document.getElementById('cfgTrocarFoto');
const cfgRemoverFoto = document.getElementById('cfgRemoverFoto');
const cfgFileInput   = document.getElementById('cfgFileInput');
const cfgNome        = document.getElementById('cfgNome');
const cfgEmail       = document.getElementById('cfgEmail');
const cfgSalvar      = document.getElementById('cfgSalvar');
const cfgMsg         = document.getElementById('cfgMsg');

let fotoPendente = null; // null = sem mudança; string = nova foto (ou '' = remover)

// ─── Render sidebar ──────────────────────────────────────────────────────
function renderSidebar() {
  navCategorias.innerHTML = CATEGORIAS.map(c => `
    <button class="nav-item ${c.id === categoriaAtiva ? 'ativo' : ''} ${c.config ? 'nav-item-fim' : ''}" data-cat="${c.id}">
      <span class="nav-icone">${c.icone}</span>
      <span class="nav-label">${c.nome}</span>
    </button>
  `).join('');

  navCategorias.querySelectorAll('.nav-item').forEach(b => {
    b.addEventListener('click', () => {
      categoriaAtiva = b.dataset.cat;
      termoBusca = '';
      inputBusca.value = '';
      renderSidebar();
      renderCentro();
    });
  });
}

// ─── Render central (cards filtrados) ────────────────────────────────────
function renderCentro() {
  const cat = CATEGORIAS.find(c => c.id === categoriaAtiva);
  tituloCategoria.textContent = cat.nome;
  secaoConfig.hidden = true;

  // Aba Configurações
  if (cat.config) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoConfig.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarPerfil();
    return;
  }

  // Placeholder de documentos
  if (cat.placeholder) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = 'Em desenvolvimento';
    return;
  }
  inputBusca.disabled = false;
  inputBusca.placeholder = `Buscar em ${cat.nome.toLowerCase()}...`;
  secaoDocs.hidden = true;
  appsGrid.hidden = false;

  // Filtra apps da categoria + termo de busca
  const termo = termoBusca.trim().toLowerCase();
  const filtrados = APPS.filter(a =>
    a.categoria === categoriaAtiva &&
    (!a.restrito || isAdmin || appsPermitidos.includes(a.key)) &&
    (!termo || a.titulo.toLowerCase().includes(termo) || a.desc.toLowerCase().includes(termo))
  );

  if (filtrados.length === 0) {
    appsGrid.innerHTML = '';
    estadoVazio.hidden = false;
    return;
  }
  estadoVazio.hidden = true;

  appsGrid.innerHTML = filtrados.map(a => `
    <button class="hub-card" data-app="${a.key}">
      <span class="card-icon">
        <img class="card-icon-img" src="app-icons/${a.key}.png" alt="">
        ${a.icone}
      </span>
      <span class="card-title">${a.titulo}</span>
      <span class="card-desc">${a.desc}</span>
    </button>
  `).join('');

  appsGrid.querySelectorAll('.hub-card').forEach(b => {
    b.addEventListener('click', () => abrirApp(b.dataset.app));
  });
  // Se o ícone de imagem não existir, remove a <img> e ficam as iniciais.
  appsGrid.querySelectorAll('.card-icon-img').forEach(img => {
    img.addEventListener('error', () => img.remove());
  });
}

// ─── Abrir app (com ou sem autologin) ────────────────────────────────────
async function abrirApp(siteKey) {
  const app = APPS.find(a => a.key === siteKey);
  if (!app) return;

  // Registra o acesso (não bloqueia a abertura)
  registrarAcesso({ siteKey, titulo: app.titulo }).catch(() => {});

  // ClickSign: admin entra com o próprio login (sem autologin compartilhado)
  if (siteKey === 'clicksign' && isAdmin) {
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: null });
    return;
  }

  if (!app.autologin) {
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: null });
    return;
  }

  const btn = appsGrid.querySelector(`[data-app="${siteKey}"]`);
  btn?.classList.add('loading');
  try {
    const resp = await getCredentials({ siteKey });
    const { login, password } = resp.data;
    if (!login) {
      alert(`Credenciais não configuradas pra ${app.titulo}. Peça pro admin cadastrar.`);
      return;
    }
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: { login, password } });
  } catch (err) {
    console.error(err);
    alert(`Erro ao buscar credenciais: ${err.message}`);
  } finally {
    btn?.classList.remove('loading');
  }
}

// ─── Busca ───────────────────────────────────────────────────────────────
inputBusca.addEventListener('input', (e) => {
  termoBusca = e.target.value;
  renderCentro();
});

// ─── Configurações / Perfil ──────────────────────────────────────────────
function setFoto(dataURL) {
  cfgAvatar.src = dataURL || AVATAR_PADRAO;
  if (dataURL) { topAvatar.src = dataURL; topAvatar.hidden = false; }
  else { topAvatar.hidden = true; }
}

async function carregarPerfil() {
  fotoPendente = null;
  cfgNome.value = '';
  cfgEmail.value = '';
  setFoto('');
  try {
    const r = await getMeuPerfil();
    cfgEmail.value = r.data.email || '';
    cfgNome.value = r.data.displayName || '';
    setFoto(r.data.photo || '');
  } catch (e) {
    console.warn('Perfil:', e);
  }
}

function mostrarMsgCfg(texto, ok) {
  cfgMsg.textContent = texto;
  cfgMsg.style.color = ok ? '#8ddca8' : '#ffb4bc';
  cfgMsg.hidden = false;
  setTimeout(() => { cfgMsg.hidden = true; }, 3000);
}

cfgTrocarFoto.addEventListener('click', () => cfgFileInput.click());
cfgRemoverFoto.addEventListener('click', () => { fotoPendente = ''; setFoto(''); });

cfgFileInput.addEventListener('change', () => {
  const f = cfgFileInput.files[0];
  cfgFileInput.value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const tam = 240;
      const min = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = tam; canvas.height = tam;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, tam, tam);
      const dataURL = canvas.toDataURL('image/jpeg', 0.85);
      fotoPendente = dataURL;
      setFoto(dataURL);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});

cfgSalvar.addEventListener('click', async () => {
  cfgSalvar.disabled = true;
  const payload = { displayName: cfgNome.value };
  if (fotoPendente !== null) payload.photo = fotoPendente;
  try {
    await salvarMeuPerfil(payload);
    fotoPendente = null;
    usuarioInfo.textContent = cfgNome.value || cfgEmail.value;
    mostrarMsgCfg('Salvo!', true);
  } catch (e) {
    mostrarMsgCfg('Erro: ' + e.message, false);
  } finally {
    cfgSalvar.disabled = false;
  }
});

// ─── Auth + topbar ───────────────────────────────────────────────────────
btnAdmin.addEventListener('click', () => window.hubApi.abrirAdmin());
btnSair.addEventListener('click', async () => { await signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.hubApi.voltarParaLogin();
    return;
  }
  usuarioInfo.textContent = user.displayName || user.email;

  const tokenResult = await user.getIdTokenResult();
  isAdmin = !!tokenResult.claims.admin;

  if (!isAdmin && BOOTSTRAP_ADMIN_UIDS.includes(user.uid)) {
    try {
      await bootstrapAdmin();
      await user.getIdToken(true);
      const r2 = await user.getIdTokenResult();
      isAdmin = !!r2.claims.admin;
    } catch (e) { console.warn('Bootstrap admin:', e); }
  }

  btnAdmin.hidden = !isAdmin;

  // Busca os apps restritos liberados pra este usuário e re-renderiza
  try {
    const perm = await getMinhasPermissoes();
    appsPermitidos = perm.data.apps || [];
    if (perm.data.isAdmin) isAdmin = true;
  } catch (e) {
    console.warn('Permissões:', e);
    appsPermitidos = [];
  }
  renderCentro();
  carregarPerfil(); // popula o avatar no topo
});

// ─── Render inicial ──────────────────────────────────────────────────────
renderSidebar();
renderCentro();
