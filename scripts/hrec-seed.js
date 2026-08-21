#!/usr/bin/env node
/* H-REC AGENDA — semeia o CATÁLOGO de referência (Bloco 2 do MD):
 *   pricingTables (2), servicosAdicionais (5), config/agenda, config/pix.
 * Os valores vêm de `hrec/dominio/seed.js` (migrados EXATOS do protótipo).
 * ---------------------------------------------------------------------------
 * ALVO PADRÃO = EMULADOR (dados de dev). Pra semear um PROJETO REAL (staging/prod),
 * passe `HREC_SEED_PROJECT=<id>` com o emulador DESLIGADO — aí grava de verdade
 * (via ADC) e avisa em alto e bom som. Sem isso, é impossível tocar produção.
 *
 * Uso:  npm run hrec:seed         (emulador rodando em outra janela)
 *       HREC_SEED_PROJECT=remax-smart-hub-staging node scripts/hrec-seed.js
 */
'use strict';
const path = require('path');

const REAL = process.env.HREC_SEED_PROJECT || '';   // projeto real explícito (opt-in)
const ehHostLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):\d+$/.test(h || '');

let projectId;
if (REAL) {
  // Modo projeto real: NÃO pode haver env de emulador (senão escreveria no lugar errado).
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('✋ HREC_SEED_PROJECT setado, mas FIRESTORE_EMULATOR_HOST também. Escolha um. Abortando.');
    process.exit(1);
  }
  projectId = REAL;
  console.warn('⚠️  GRAVANDO EM PROJETO REAL:', projectId, '(via ADC). Ctrl+C em 3s pra abortar…');
} else {
  // Modo emulador (padrão). Reforça os hosts e trava anti-produção.
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  if (!ehHostLocal(process.env.FIRESTORE_EMULATOR_HOST)) {
    console.error('✋ Host de emulador não é localhost — abortando pra não escrever em produção.');
    console.error('   FIRESTORE_EMULATOR_HOST =', process.env.FIRESTORE_EMULATOR_HOST);
    process.exit(1);
  }
  projectId = 'remax-smart-hub'; // qualquer id serve no emulador
  console.log('🧪 Alvo: EMULADOR', process.env.FIRESTORE_EMULATOR_HOST);
}

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const Seed = require(path.join(__dirname, '..', 'hrec', 'dominio', 'seed.js'));

admin.initializeApp({ projectId });
const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

async function main() {
  if (REAL) await new Promise((r) => setTimeout(r, 3000)); // janela pra Ctrl+C

  const batch = db.batch();

  // Tabelas de preço (canônicas — overwrite idempotente).
  Seed.TABELAS.forEach((t) => {
    batch.set(db.collection('pricingTables').doc(t.id),
      Object.assign({}, t, { createdAt: now, updatedAt: now, updatedBy: 'hrec-seed' }));
  });

  // Adicionais.
  Seed.ADICIONAIS.forEach((a) => {
    batch.set(db.collection('servicosAdicionais').doc(a.id),
      Object.assign({}, a, { updatedAt: now, updatedBy: 'hrec-seed' }));
  });

  // Config da agenda (canônica).
  batch.set(db.collection('config').doc('agenda'),
    Object.assign({}, Seed.CONFIG_AGENDA, { updatedAt: now, updatedBy: 'hrec-seed' }));

  // Config do Pix: MERGE — não clobbera chave real já preenchida no Admin.
  batch.set(db.collection('config').doc('pix'),
    Object.assign({}, Seed.CONFIG_PIX, { updatedAt: now, updatedBy: 'hrec-seed' }), { merge: true });

  await batch.commit();
  console.log('✅ Seed H-REC:', Seed.TABELAS.length, 'tabelas,', Seed.ADICIONAIS.length,
    'adicionais, config/agenda + config/pix. Projeto:', projectId);
}

main().then(() => process.exit(0)).catch((e) => { console.error('Erro:', e.message || e); process.exit(1); });
