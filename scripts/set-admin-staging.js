#!/usr/bin/env node
/* Torna uma conta ADMIN no projeto STAGING (real, não emulador).
 * ---------------------------------------------------------------------------
 * Uso:  node scripts/set-admin-staging.js [email]
 *       (sem argumento, usa nathangabrieldovale07@gmail.com)
 *
 * - projectId FIXO em staging (nunca produção).
 * - Se a conta já existe: só adiciona a claim admin (preservando as outras).
 * - Se não existe: cria com a senha padrão e avisa.
 * - Também liga loc_beta (aba "Meus Negócios") e isAdmin no perfil.
 *
 * Requer ADC do Admin SDK (gcloud auth application-default login — 1x).
 * ⚠ Depois de rodar, é preciso SAIR e LOGAR de novo pra o token pegar a claim.
 */
'use strict';
const path = require('path');

const PROJETO = 'remax-smart-hub-staging';
const EMAIL = (process.argv[2] || 'nathangabrieldovale07@gmail.com').trim().toLowerCase();
const SENHA_SE_CRIAR = 'teste1234';

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✋ Env de emulador setada — este script é pro STAGING real. Abortando.');
  process.exit(1);
}

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: PROJETO });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  console.log(`🔑 Tornando ${EMAIL} admin no STAGING (${PROJETO})…`);
  let user;
  let criada = false;
  try {
    user = await auth.getUserByEmail(EMAIL);
    console.log('  • Conta encontrada:', user.uid);
  } catch (_e) {
    user = await auth.createUser({ email: EMAIL, password: SENHA_SE_CRIAR, emailVerified: true });
    criada = true;
    console.log('  • Conta NÃO existia — criada agora:', user.uid);
  }

  // Preserva claims existentes + admin:true.
  const claims = Object.assign({}, user.customClaims || {}, { admin: true });
  await auth.setCustomUserClaims(user.uid, claims);
  console.log('  • Claims:', JSON.stringify(claims));

  await db.collection('user_profiles').doc(user.uid).set(
    { nome: user.displayName || 'Nathan', email: EMAIL, isAdmin: true }, { merge: true });
  await db.collection('user_access').doc(user.uid).set(
    { loc_beta: true }, { merge: true }); // libera a aba "Meus Negócios"

  console.log('\n✅ Pronto.');
  if (criada) console.log(`   Conta criada — senha: ${SENHA_SE_CRIAR}`);
  console.log('   ⚠ SAIR e LOGAR de novo pra o token pegar a claim admin.');
  process.exit(0);
})().catch((e) => { console.error('Erro:', e.message || e); process.exit(1); });
