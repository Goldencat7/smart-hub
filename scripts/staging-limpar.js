#!/usr/bin/env node
/* Limpa os DADOS DO FLUXO de teste no STAGING (imóveis, negócios, fichas,
 * vistorias, counters, rate limits). Deixa o pipeline zerado pra testar do zero.
 * NÃO toca: contas (Auth), user_access/profiles, loc_perfis, marketing_config,
 * smarthub_config, audit_log, user_activity/presence, _health.
 *
 * Trava anti-produção: projectId FIXO em staging + aborta se env de emulador.
 * Uso: node scripts/staging-limpar.js
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

// Coleções do FLUXO a zerar. (contas/config/logs ficam intactos.)
const ALVO = ['imoveis', 'negocios', 'fichas', 'vistorias', 'counters', '_rate_fichas',
  // extras do fluxo que podem aparecer conforme se testa (zera se existirem):
  'contratos', 'cobrancas', 'repasses', 'portal_tokens', 'pessoas', 'interessados'];

async function apagarColecao(id) {
  const col = db.collection(id);
  let total = 0;
  while (true) {
    const snap = await col.limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 300) break;
  }
  return total;
}

(async () => {
  console.log('🧹 Limpando DADOS DO FLUXO no STAGING (', PROJETO, ')\n');
  let geral = 0;
  for (const id of ALVO) {
    const n = await apagarColecao(id);
    if (n > 0) { console.log('  🗑️  ', String(n).padStart(4), id); geral += n; }
  }
  console.log('\n✅ Pronto.', geral, 'doc(s) apagado(s). Contas, config e perfis mantidos.');
  console.log('   (staging pronto pra testar o fluxo do zero.)');
  process.exit(0);
})().catch((e) => { console.error('Erro:', e.message || e); process.exit(1); });
