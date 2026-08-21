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
  versao: '1.0.188',
  novo: [
    'Enviar imóveis por e-mail: no SmartLead e nos Leads, o botão "E-mail" abre um envio com até 5 imóveis parecidos (com foto, preço e link do anúncio) direto pro cliente.',
    'Conecte seu Gmail em Configurações → os e-mails de imóveis passam a sair da SUA conta (o cliente responde pra você). Sem conectar, saem pela conta do Hub, com o seu nome e responder-para você.',
    'Nova aba "E-mails" no Meus Negócios: histórico do que você enviou + quem pediu pra não receber mais.'
  ],
  melhorias: [
    '@gestor Botão de copiar (📋) os dados do cliente (nome, telefone, e-mail) com um clique — no SmartLead, nos interessados e na lista de Leads.'
  ],
  correcoes: [
    'Mais estabilidade no SmartLead em imóveis com muitos leads.'
  ]
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
