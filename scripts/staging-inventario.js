#!/usr/bin/env node
/* Inventário READ-ONLY do STAGING — lista coleções e contagem de docs.
 * Trava anti-produção: projectId FIXO em staging + aborta se env de emulador.
 * Uso: node scripts/staging-inventario.js
 */
'use strict';
const path = require('path');
const PROJETO = 'remax-smart-hub-staging';

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✋ Env de emulador setada — abortando.'); process.exit(1);
}
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: PROJETO });
const db = admin.firestore();
const auth = admin.auth();

(async () => {
  console.log('📋 Inventário do STAGING (', PROJETO, ')\n');
  const cols = await db.listCollections();
  const linhas = [];
  for (const c of cols) {
    const snap = await c.count().get();
    linhas.push([c.id, snap.data().count]);
  }
  linhas.sort((a, b) => b[1] - a[1]);
  console.log('— Coleções do Firestore —');
  for (const [id, n] of linhas) console.log('  ' + String(n).padStart(5), id);
  const total = linhas.reduce((s, l) => s + l[1], 0);
  console.log('  ' + String(total).padStart(5), 'TOTAL de docs\n');

  const users = await auth.listUsers(1000);
  console.log('— Contas (Auth) —', users.users.length, 'usuário(s):');
  for (const u of users.users) console.log('   ', (u.email || u.uid).padEnd(28), JSON.stringify(u.customClaims || {}));
  process.exit(0);
})().catch((e) => { console.error('Erro:', e.message || e); process.exit(1); });
