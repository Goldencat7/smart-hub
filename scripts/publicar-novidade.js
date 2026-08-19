#!/usr/bin/env node
/* Publica a nota de Novidades de uma versão DIRETO na produção (Admin SDK) +
 * acende a bolinha "não lida" em tempo real (bump novidadeSeq).
 * ---------------------------------------------------------------------------
 * Mesmo formato do salvarNovidade: coleção `novidades`, id = versão, com
 * novo[]/melhorias[]/correcoes[]. Item começando com "@gestor " = só pro gestor.
 * projectId FIXO em produção; aborta se env de emulador estiver setada.
 *
 * Uso: node scripts/publicar-novidade.js
 * Editar o objeto NOTA abaixo a cada versão.
 */
'use strict';
const path = require('path');
const PROJETO = 'remax-smart-hub';

if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('✋ Env de emulador setada. Abortando.'); process.exit(1); }

const NOTA = {
  versao: '1.0.181',
  novo: [
    'A área de Performance passou a contar com o Painel do dia para a gestão: acompanhamento diário de quem enviou o check-in e quem ainda está pendente, com totais do time e filtro por corretor e por data.'
  ],
  melhorias: [
    'No check-in diário, o dia que está sendo registrado ficou mais visível. Caso tenha esquecido de enviar em outra data, basta selecionar o dia desejado e preencher normalmente.',
    'O banner de notícias do mercado imobiliário, no painel inicial, recebeu um novo visual, mais destacado e com acesso direto à matéria.'
  ],
  correcoes: []
};

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: PROJETO });
const db = admin.firestore();

(async () => {
  const ref = db.collection('novidades').doc(NOTA.versao);
  const snap = await ref.get();
  const up = {
    versao: NOTA.versao,
    novo: NOTA.novo || [],
    melhorias: NOTA.melhorias || [],
    correcoes: NOTA.correcoes || [],
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoPor: 'script-claude'
  };
  if (!snap.exists) up.criadoEm = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(up, { merge: true });
  await db.collection('config').doc('broadcast').set({
    novidadeSeq: admin.firestore.FieldValue.increment(1),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log('✅ Novidade', NOTA.versao, 'publicada (', up.novo.length, 'novo,', up.melhorias.length, 'melhorias ) + bolinha acesa.');
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message || e); process.exit(1); });
