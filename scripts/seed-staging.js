#!/usr/bin/env node
/* Semeia o projeto STAGING (real, não emulador) com contas de teste.
 * ---------------------------------------------------------------------------
 * Cria um admin e um "colega" (admin + gestor de Locação, com a aba Locação
 * ligada via user_access.loc_gestao) pra testar a reestruturação de Imóveis.
 *
 * SEGURANÇA: o projectId é FIXO em 'remax-smart-hub-staging' — nunca produção.
 * E aborta se qualquer env de emulador estiver setada (isto aqui é pro projeto
 * REAL de staging). Requer credenciais do Admin SDK (ADC do gcloud/firebase).
 *
 * Uso: node scripts/seed-staging.js
 */
'use strict';
const path = require('path');

const PROJETO = 'remax-smart-hub-staging';

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✋ Env de emulador setada — este seed é pro STAGING real, não pro emulador. Abortando.');
  process.exit(1);
}

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: PROJETO });
const auth = admin.auth();
const db = admin.firestore();

const SENHA = 'teste1234';
const USERS = [
  { uid: 'stg-admin',  email: 'admin@teste.local',  nome: 'Admin de Teste',   claims: { admin: true } },
  { uid: 'stg-colega', email: 'colega@teste.local', nome: 'Colega (Gestor)',  claims: { admin: true, locRole: 'gestor' } },
];

async function criarUsuario(u) {
  try { await auth.deleteUser(u.uid); } catch (_e) { /* ainda não existe */ }
  await auth.createUser({ uid: u.uid, email: u.email, password: SENHA, displayName: u.nome, emailVerified: true });
  if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  await db.collection('user_profiles').doc(u.uid).set({ nome: u.nome, email: u.email, isAdmin: !!(u.claims && u.claims.admin) });
  // user_access liga a aba Locação (loc_gestao) — não herda de admin.
  await db.collection('user_access').doc(u.uid).set({ apps: [], loc_gestao: true, loc_beta: false }, { merge: true });
}

(async () => {
  console.log('🌱 Semeando STAGING (', PROJETO, ')...');
  for (const u of USERS) { await criarUsuario(u); console.log('  •', u.email, '—', JSON.stringify(u.claims)); }
  console.log('\n✅ Pronto. Login de teste (STAGING):');
  for (const u of USERS) console.log('   ', u.email.padEnd(20), '/', SENHA);
  console.log('   (sem 2FA no staging; a aba Locação já vem ligada)');
  process.exit(0);
})().catch((e) => { console.error('Erro ao semear staging:', e.message || e); process.exit(1); });
