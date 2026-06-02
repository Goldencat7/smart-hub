// Tela de login do Hub — Firebase Auth (Email/Senha) + cadastro via código de convite
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged
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
const criarContaComCodigo = httpsCallable(fns, 'criarContaComCodigo');

// Refs
const viewLogin    = document.getElementById('viewLogin');
const viewCadastro = document.getElementById('viewCadastro');
const formLogin    = document.getElementById('formLogin');
const formCadastro = document.getElementById('formCadastro');
const inputEmail   = document.getElementById('inputEmail');
const inputPass    = document.getElementById('inputPass');
const btnEntrar    = document.getElementById('btnEntrar');
const btnCriar     = document.getElementById('btnCriar');
const msgErro      = document.getElementById('msgErro');
const msgErroCad   = document.getElementById('msgErroCad');
const msgOkCad     = document.getElementById('msgOkCad');
const linkCriarConta  = document.getElementById('linkCriarConta');
const linkVoltarLogin = document.getElementById('linkVoltarLogin');

function mostrar(el, t) { el.textContent = t; el.hidden = false; }
function esconder(el)   { el.hidden = true; el.textContent = ''; }

function travarBotoes(travar) {
  btnEntrar.disabled = travar;
  btnEntrar.textContent = travar ? 'Entrando...' : 'Entrar';
}
function travarCadastro(travar) {
  btnCriar.disabled = travar;
  btnCriar.textContent = travar ? 'Criando...' : 'Criar conta';
}

function traduzErroFirebase(code) {
  const map = {
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/invalid-email': 'Email inválido.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
    'auth/popup-closed-by-user': 'Login com Google cancelado.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/email-already-in-use': 'Esse email já tem conta.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).'
  };
  return map[code] || `Erro: ${code}`;
}

// ─── Trocar entre login e cadastro ───────────────────────────────────────────
linkCriarConta.addEventListener('click', (e) => {
  e.preventDefault();
  esconder(msgErro); esconder(msgErroCad); esconder(msgOkCad);
  viewLogin.hidden = true;
  viewCadastro.hidden = false;
});
linkVoltarLogin.addEventListener('click', (e) => {
  e.preventDefault();
  esconder(msgErro); esconder(msgErroCad); esconder(msgOkCad);
  viewCadastro.hidden = true;
  viewLogin.hidden = false;
});

// ─── Login: Email + Senha ────────────────────────────────────────────────────
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconder(msgErro);
  travarBotoes(true);
  try {
    await signInWithEmailAndPassword(auth, inputEmail.value.trim(), inputPass.value);
  } catch (err) {
    mostrar(msgErro, traduzErroFirebase(err.code));
    travarBotoes(false);
  }
});

// ─── Cadastro com código de convite ──────────────────────────────────────────
formCadastro.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconder(msgErroCad); esconder(msgOkCad);
  travarCadastro(true);

  const nome   = document.getElementById('cadNome').value.trim();
  const email  = document.getElementById('cadEmail').value.trim();
  const senha  = document.getElementById('cadSenha').value;
  const codigo = document.getElementById('cadCodigo').value.trim().toUpperCase();

  try {
    await criarContaComCodigo({ email, senha, codigo, displayName: nome });
    mostrar(msgOkCad, 'Conta criada! Entrando...');
    // Faz login automaticamente com as credenciais novas
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    const msg = err.message || 'Erro ao criar conta.';
    mostrar(msgErroCad, msg);
    travarCadastro(false);
  }
});

// Quando o login der certo, manda o main pra index.html
onAuthStateChanged(auth, (user) => {
  if (user) window.hubAuth.loginConcluido();
});
