// Lógica da tela principal do Hub: verifica auth, busca credenciais via Cloud
// Function ao clicar em cada card, manda pro main abrir a janela do PWA.
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

// UID do admin inicial — usado pra oferecer "virar admin" na primeira execução
const BOOTSTRAP_ADMIN_UID = 'OwcT6wCrXMgJ0tPADMUdKdBB8h32';

const usuarioInfo = document.getElementById('usuarioInfo');
const btnAdmin    = document.getElementById('btnAdmin');
const btnSair     = document.getElementById('btnSair');
const grid        = document.getElementById('appsGrid');

// Apps que NÃO usam autologin (cada pessoa loga com sua própria conta)
const APPS_SEM_AUTOLOGIN = new Set(['checkvisto', 'motiva']);

// URL fixa de cada app (a parte que NÃO é credencial)
const APP_URLS = {
  checkvisto: 'https://checkvisto-app.web.app',
  motiva: 'https://motivatech-app.web.app',
  alude: 'https://app.alude.com.br/',
  cadastro_imobiliario: 'https://centraldecadastroimobiliario.com/login/',
  imovelp: 'https://www.imovelp.com.br/login',
  sp_imovel: 'https://captacao.spimovel.com.br/',
  forsale: 'https://jr.sigavi360.com.br/Login.aspx?ReturnUrl=%2f'
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Sem login → main volta pra login.html
    window.hubApi.voltarParaLogin();
    return;
  }

  usuarioInfo.textContent = user.displayName || user.email;

  // Verifica se é admin via custom claim
  const tokenResult = await user.getIdTokenResult();
  let isAdmin = !!tokenResult.claims.admin;

  // Caso especial: bootstrap. Se for o admin inicial e ainda não tem a claim,
  // chama bootstrapAdmin pra ganhar acesso.
  if (!isAdmin && user.uid === BOOTSTRAP_ADMIN_UID) {
    try {
      await bootstrapAdmin();
      // Força refresh do token pra pegar a nova claim
      await user.getIdToken(true);
      const r2 = await user.getIdTokenResult();
      isAdmin = !!r2.claims.admin;
    } catch (e) {
      console.warn('Falha no bootstrap admin:', e);
    }
  }

  btnAdmin.hidden = !isAdmin;
});

btnAdmin.addEventListener('click', () => window.hubApi.abrirAdmin());

btnSair.addEventListener('click', async () => {
  await signOut(auth);
});

grid.addEventListener('click', async (e) => {
  const btn = e.target.closest('.hub-card');
  if (!btn) return;
  const siteKey = btn.dataset.app;
  if (!siteKey) return;

  const url = APP_URLS[siteKey];
  if (!url) return alert('App desconhecido: ' + siteKey);

  // Apps sem autologin: só manda abrir a janela com a URL
  if (APPS_SEM_AUTOLOGIN.has(siteKey)) {
    window.hubApi.abrirApp({ siteKey, url, credenciais: null });
    return;
  }

  // Apps com autologin: busca credenciais via Cloud Function
  btn.classList.add('loading');
  try {
    const resp = await getCredentials({ siteKey });
    const { login, password } = resp.data;
    if (!login) {
      alert(`Credenciais não configuradas pra ${siteKey}. Peça pro admin cadastrar.`);
      return;
    }
    window.hubApi.abrirApp({ siteKey, url, credenciais: { login, password } });
  } catch (err) {
    console.error(err);
    alert(`Erro ao buscar credenciais: ${err.message}`);
  } finally {
    btn.classList.remove('loading');
  }
});
