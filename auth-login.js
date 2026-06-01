// Tela de login do Hub — Firebase Auth (Email/Senha + Google)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, GoogleAuthProvider,
  signInWithPopup, signInWithCredential, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

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

const form     = document.getElementById('formLogin');
const inputEmail = document.getElementById('inputEmail');
const inputPass  = document.getElementById('inputPass');
const btnGoogle  = document.getElementById('btnGoogle');
const btnEntrar  = document.getElementById('btnEntrar');
const msgErro    = document.getElementById('msgErro');

function mostrarErro(texto) {
  msgErro.textContent = texto;
  msgErro.hidden = false;
}
function limparErro() {
  msgErro.hidden = true;
  msgErro.textContent = '';
}

function travarBotoes(travar) {
  btnEntrar.disabled = travar;
  btnGoogle.disabled = travar;
  btnEntrar.textContent = travar ? 'Entrando...' : 'Entrar';
}

function traduzErroFirebase(code) {
  const map = {
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/invalid-email': 'Email inválido.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
    'auth/popup-closed-by-user': 'Login com Google cancelado.',
    'auth/network-request-failed': 'Sem conexão com a internet.'
  };
  return map[code] || `Erro: ${code}`;
}

// Email + Senha
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  limparErro();
  travarBotoes(true);
  try {
    await signInWithEmailAndPassword(auth, inputEmail.value.trim(), inputPass.value);
  } catch (err) {
    mostrarErro(traduzErroFirebase(err.code));
    travarBotoes(false);
  }
});

// Google — em Electron, o popup OAuth tem limitações com origin file://.
// Por enquanto tentamos signInWithPopup; se não funcionar, usa email/senha.
btnGoogle.addEventListener('click', async () => {
  limparErro();
  travarBotoes(true);
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    mostrarErro('Login com Google não funciona no Hub ainda. Use email/senha.');
    travarBotoes(false);
  }
});

// Quando o login der certo, avisa o main pra carregar o index.
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.hubAuth.loginConcluido();
  }
});
