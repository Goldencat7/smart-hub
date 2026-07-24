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
// locGestao liga a aba "Meus Negócios" como GESTOR (visão Broker). Corretor e
// Administrativo NÃO têm loc_gestao — o papel vem do claim locRole, e a visão é
// roteada por ele (gestor→Broker, administrativo→Admin, corretor→Corretor).
const USERS = [
  { uid: 'stg-admin',  email: 'admin@teste.local',    nome: 'Admin de Teste',   claims: { admin: true }, locGestao: true },
  { uid: 'stg-colega', email: 'teste@staggin.com.br', nome: 'Teste (Gestor)',   senha: '12345678', claims: { admin: true, locRole: 'gestor' }, locGestao: true },
  // Contas novas pra testar as visões novas (pedido do Nathan):
  { uid: 'stg-corretor', email: 'corretor@staggin.com.br', nome: 'Corretor de Teste',      senha: '12345678', claims: { locRole: 'corretor' },      locGestao: false },
  { uid: 'stg-adm',      email: 'adm@staggin.com.br',      nome: 'Administrativo de Teste', senha: '12345678', claims: { locRole: 'administrativo' }, locGestao: false },
];

async function criarUsuario(u) {
  const senha = u.senha || SENHA;
  try { await auth.deleteUser(u.uid); } catch (_e) { /* ainda não existe pelo uid */ }
  // Também apaga qualquer conta avulsa com o mesmo e-mail (ex.: criada na mão pelo console),
  // senão o createUser abaixo falha com "email already exists".
  try { const j = await auth.getUserByEmail(u.email); if (j.uid !== u.uid) await auth.deleteUser(j.uid); } catch (_e) { /* sem duplicata */ }
  await auth.createUser({ uid: u.uid, email: u.email, password: senha, displayName: u.nome, emailVerified: true });
  if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  await db.collection('user_profiles').doc(u.uid).set({ nome: u.nome, email: u.email, isAdmin: !!(u.claims && u.claims.admin) });
  // user_access liga a aba Locação como gestor (loc_gestao) — não herda de admin.
  const locGestao = u.locGestao !== false;
  await db.collection('user_access').doc(u.uid).set({ apps: [], loc_gestao: locGestao, loc_beta: false }, { merge: true });
}

(async () => {
  console.log('🌱 Semeando STAGING (', PROJETO, ')...');
  for (const u of USERS) { await criarUsuario(u); console.log('  •', u.email, '—', JSON.stringify(u.claims)); }
  console.log('\n✅ Pronto. Login de teste (STAGING):');
  for (const u of USERS) console.log('   ', u.email.padEnd(24), '/', u.senha || SENHA);
  console.log('   (sem 2FA no staging; a aba Locação já vem ligada)');
  process.exit(0);
})().catch((e) => { console.error('Erro ao semear staging:', e.message || e); process.exit(1); });
