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
  versao: '1.0.178',
  novo: [
    'Link do Imóvel (menu Ferramentas): informe o link de um anúncio e o sistema gera uma página com a identidade da REMAX Smart e os seus dados de contato — fotos, valor e WhatsApp — para envio ao cliente. Preencha seus dados em Meu Perfil.',
    'Jornada e Metas na aba Performance: cada corretor passa a visualizar e preencher a própria Jornada e as Metas diárias; o gestor acompanha toda a equipe.'
  ],
  melhorias: [
    'Etapas dos negócios de Locação e Venda reorganizadas em um fluxo mais objetivo. A alteração vale para os negócios criados a partir desta versão.',
    'Maior fluidez nos Negócios: a troca de abas e a marcação de etapas passaram a ser instantâneas, sem recarregar a tela.',
    'Menu lateral: a opção de recolher passou a ocultar a barra por completo, ampliando a área de trabalho, com um botão lateral para reexibi-la.'
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
