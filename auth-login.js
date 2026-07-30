// Tela de login do Hub — Firebase Auth (Email/Senha) + cadastro via código de convite
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  getMultiFactorResolver, TotpMultiFactorGenerator
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

// Config por ambiente (prod/staging/emulador, por hostname) — ver firebase-env.js
import { firebaseConfig, conectarEmuladores } from "./firebase-env.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fns  = getFunctions(app, 'southamerica-east1');
conectarEmuladores({ auth, fns });
const criarContaComCodigo = httpsCallable(fns, 'criarContaComCodigo');

// Refs
const viewLogin      = document.getElementById('viewLogin');
const viewCadastro   = document.getElementById('viewCadastro');
const viewEsqueceu   = document.getElementById('viewEsqueceu');
const formLogin      = document.getElementById('formLogin');
const formCadastro   = document.getElementById('formCadastro');
const formEsqueceu   = document.getElementById('formEsqueceu');
const inputEmail     = document.getElementById('inputEmail');
const inputPass      = document.getElementById('inputPass');
const btnVerSenha    = document.getElementById('btnVerSenha');
const btnEntrar      = document.getElementById('btnEntrar');
const btnCriar       = document.getElementById('btnCriar');
const btnReset       = document.getElementById('btnReset');
const msgErro        = document.getElementById('msgErro');
const msgErroCad     = document.getElementById('msgErroCad');
const msgOkCad       = document.getElementById('msgOkCad');
const msgErroReset   = document.getElementById('msgErroReset');
const msgOkReset     = document.getElementById('msgOkReset');
const linkCriarConta    = document.getElementById('linkCriarConta');
const linkVoltarLogin   = document.getElementById('linkVoltarLogin');
const linkEsqueceu      = document.getElementById('linkEsqueceu');
const linkVoltarEsqueceu = document.getElementById('linkVoltarEsqueceu');

function mostrar(el, t) { el.textContent = t; el.hidden = false; }
function esconder(el)   { el.hidden = true; el.textContent = ''; }

function travarBotoes(travar) {
  btnEntrar.disabled = travar;
  btnEntrar.textContent = travar ? 'Entrando...' : 'Entrar';
}
function travarReset(travar) {
  btnReset.disabled = travar;
  btnReset.textContent = travar ? 'Enviando...' : 'Enviar link';
}
function travarCadastro(travar) {
  btnCriar.disabled = travar;
  btnCriar.textContent = travar ? 'Criando...' : 'Criar conta';
}

function toTitleCase(str) {
  return str.trim().toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function traduzErroFirebase(code) {
  const map = {
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/invalid-email': 'Email inválido.',
    // Mesma mensagem de invalid-credential de propósito: distinguir "não existe" de
    // "senha errada" revela quais emails têm conta (e logado = acesso ao getCredentials).
    'auth/user-not-found': 'Email ou senha incorretos.',
    'auth/wrong-password': 'Email ou senha incorretos.',
    'auth/user-disabled': 'Conta desativada. Fale com o administrador.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
    'auth/popup-closed-by-user': 'Login com Google cancelado.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/email-already-in-use': 'Esse email já tem conta.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).'
  };
  return map[code] || `Erro: ${code}`;
}

// ─── Trocar entre views ───────────────────────────────────────────────────────
function mostrarView(view) {
  viewLogin.hidden    = view !== 'login';
  viewCadastro.hidden = view !== 'cadastro';
  viewEsqueceu.hidden = view !== 'esqueceu';
  esconder(msgErro); esconder(msgErroCad); esconder(msgOkCad);
  esconder(msgErroReset); esconder(msgOkReset);
}

linkCriarConta.addEventListener('click',      (e) => { e.preventDefault(); mostrarView('cadastro'); });
linkVoltarLogin.addEventListener('click',     (e) => { e.preventDefault(); mostrarView('login'); });
linkEsqueceu.addEventListener('click',        (e) => { e.preventDefault(); mostrarView('esqueceu'); });
linkVoltarEsqueceu.addEventListener('click',  (e) => { e.preventDefault(); mostrarView('login'); });

// ─── Redefinir senha ─────────────────────────────────────────────────────────
formEsqueceu.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconder(msgErroReset); esconder(msgOkReset);
  travarReset(true);
  const email = document.getElementById('resetEmail').value.trim();
  // Mensagem SEMPRE genérica no sucesso e no "email não existe" — não revela se o
  // email tem conta. Só erros que não vazam existência (formato, rede, rate-limit)
  // viram erro de verdade.
  const generico = 'Se esse email tiver conta, enviamos o link. Verifique a caixa de entrada (e o spam).';
  try {
    await sendPasswordResetEmail(auth, email);
    mostrar(msgOkReset, generico);
    formEsqueceu.reset();
  } catch (err) {
    if (['auth/invalid-email', 'auth/too-many-requests', 'auth/network-request-failed'].includes(err.code)) {
      mostrar(msgErroReset, traduzErroFirebase(err.code));
    } else {
      mostrar(msgOkReset, generico);
      formEsqueceu.reset();
    }
  } finally {
    travarReset(false);
  }
});

// ─── Olhinho: mostrar/ocultar a senha do cadastro ────────────────────────────
const olhoCadSenha  = document.getElementById('olhoCadSenha');
const inputCadSenha = document.getElementById('cadSenha');
const SVG_OLHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_OLHO_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a16.4 16.4 0 0 1-2.9 3.6"/><path d="M6.6 6.6A16.1 16.1 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg>';
olhoCadSenha.addEventListener('click', () => {
  const mostrando = inputCadSenha.type === 'text';
  inputCadSenha.type = mostrando ? 'password' : 'text';
  olhoCadSenha.innerHTML = mostrando ? SVG_OLHO : SVG_OLHO_OFF;
  olhoCadSenha.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
});

// ─── Login: Email + Senha ────────────────────────────────────────────────────
// Olhinho pra mostrar/ocultar senha
btnVerSenha?.addEventListener('click', () => {
  const mostrando = inputPass.type === 'text';
  inputPass.type = mostrando ? 'password' : 'text';
  btnVerSenha.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
  btnVerSenha.setAttribute('title', mostrando ? 'Mostrar senha' : 'Ocultar senha');
  inputPass.focus();
});

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconder(msgErro);
  travarBotoes(true);
  try {
    await signInWithEmailAndPassword(auth, inputEmail.value.trim(), inputPass.value);
  } catch (err) {
    if (err.code === 'auth/multi-factor-auth-required') {
      abrirDesafio2fa(err);
      return;
    }
    mostrar(msgErro, traduzErroFirebase(err.code));
    travarBotoes(false);
  }
});

// ─── Desafio 2FA no login ────────────────────────────────────────────────────
// Quando a conta tem TOTP habilitado, o Firebase lança 'auth/multi-factor-auth-required'.
// Aí a gente pega o resolver, pede o código de 6 dígitos e completa o login.
function abrirDesafio2fa(err) {
  const resolver = getMultiFactorResolver(auth, err);
  const totpHint = (resolver.hints || []).find(h => h.factorId === 'totp');
  if (!totpHint) {
    mostrar(msgErro, 'Conta com 2FA por método não suportado.');
    travarBotoes(false);
    return;
  }
  // Ao invés de reescrever o form (destrói refs de inputEmail/inputPass e vaza handlers),
  // esconde o form de login e mostra um bloco 2FA IRMÃO. Cancelar = volta simples.
  const form2faLogin = document.createElement('form');
  form2faLogin.className = 'auth-form';
  form2faLogin.id = 'form2faLogin';
  form2faLogin.innerHTML = `
    <h2 style="margin:0 0 6px">Autenticação em dois fatores</h2>
    <p class="muted" style="font-size:12px;margin:0 0 14px">Abra seu app autenticador (Google Authenticator / Authy / 1Password) e digite o código de 6 dígitos.</p>
    <label class="auth-label">
      Código
      <input id="inputTfa" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000" style="font-family:monospace;letter-spacing:8px;font-size:20px;text-align:center" required>
    </label>
    <div id="msgErroTfa" class="auth-msg-erro" hidden></div>
    <button type="submit" class="auth-btn primario" id="btnConfirmTfa">Entrar</button>
    <button type="button" class="auth-btn" id="btnVoltarLogin" style="margin-top:8px">Cancelar</button>
  `;
  formLogin.hidden = true;
  formLogin.parentNode.insertBefore(form2faLogin, formLogin.nextSibling);
  travarBotoes(false);

  const inputTfa      = form2faLogin.querySelector('#inputTfa');
  const msgErroTfa    = form2faLogin.querySelector('#msgErroTfa');
  const btnConfirmTfa = form2faLogin.querySelector('#btnConfirmTfa');
  inputTfa.focus();

  const removerForm2fa = () => {
    form2faLogin.remove();
    formLogin.hidden = false;
  };

  form2faLogin.querySelector('#btnVoltarLogin').addEventListener('click', removerForm2fa);

  form2faLogin.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const codigo = (inputTfa.value || '').replace(/\D/g, '');
    if (codigo.length !== 6) { msgErroTfa.textContent = 'O código tem 6 dígitos.'; msgErroTfa.hidden = false; return; }
    btnConfirmTfa.disabled = true; msgErroTfa.hidden = true;
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, codigo);
      await resolver.resolveSignIn(assertion);
      // onAuthStateChanged vai chamar loginConcluido; deixa o form 2fa até redirecionar
    } catch (e) {
      msgErroTfa.textContent = 'Código inválido. Tenta de novo.';
      msgErroTfa.hidden = false;
      btnConfirmTfa.disabled = false;
    }
  });
}

// ─── Cadastro com código de convite ──────────────────────────────────────────
formCadastro.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconder(msgErroCad); esconder(msgOkCad);
  travarCadastro(true);

  const nomeRaw      = document.getElementById('cadNome').value.trim();
  const sobrenomeRaw = document.getElementById('cadSobrenome').value.trim();
  if (!nomeRaw || !sobrenomeRaw) {
    mostrar(msgErroCad, 'Preencha o nome e o sobrenome.');
    travarCadastro(false);
    return;
  }
  const nome    = toTitleCase(`${nomeRaw} ${sobrenomeRaw}`);
  const email   = document.getElementById('cadEmail').value.trim();
  const senha   = document.getElementById('cadSenha').value;
  const confirma = document.getElementById('cadSenhaConfirma').value;
  const codigo  = document.getElementById('cadCodigo').value.trim().toUpperCase();

  if (senha !== confirma) {
    mostrar(msgErroCad, 'As senhas não conferem.');
    travarCadastro(false);
    return;
  }

  try {
    await criarContaComCodigo({ email, senha, codigo, displayName: nome });
    mostrar(msgOkCad, 'Conta criada! Entrando...');
    // Faz login automaticamente com as credenciais novas
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    const msg = (err.code && err.code.startsWith('auth/'))
      ? traduzErroFirebase(err.code)
      : (err.message || 'Erro ao criar conta.');
    mostrar(msgErroCad, msg);
    travarCadastro(false);
  }
});

// Quando o login der certo, manda o main pra index.html
onAuthStateChanged(auth, (user) => {
  if (user) window.hubAuth.loginConcluido();
});
