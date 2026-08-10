#!/usr/bin/env node
/* Cria UM negócio de locação ATIVO no STAGING pra testar o Assistente IA.
 * ---------------------------------------------------------------------------
 * Cenário realista: proposta ajustada, contrato ainda NÃO emitido, obrigatórias
 * pendentes, parado há ~5 dias — dá à IA material pra sugerir a próxima ação.
 *
 * SEGURANÇA: projectId FIXO em staging; aborta se env de emulador estiver setada.
 * Requer ADC (gcloud auth application-default login). Uso: node scripts/seed-negocio-staging.js
 */
'use strict';
const path = require('path');
const PROJETO = 'remax-smart-hub-staging';

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✋ Env de emulador setada — este seed é pro STAGING real. Abortando.');
  process.exit(1);
}

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: PROJETO });
const db = admin.firestore();
const T = admin.firestore.Timestamp;
const diasAtras = (n) => T.fromMillis(Date.now() - n * 86400000);

// Checklist-modelo de locação (espelha CHECKLIST_NEGOCIO.locacao do index.js).
const MODELO = [
  ['doc_pasta', 'Documentação salva na pasta', true],
  ['ficha', 'Ficha cadastral preenchida', true],
  ['proposta', 'Proposta ajustada', true],
  ['contrato_emitido', 'Contrato emitido', true],
  ['contrato_aprovado', 'Contrato aprovado', true],
  ['contrato_assinado', 'Contrato assinado', true],
  ['seguro', 'Seguro aprovado', true],
  ['chaves', 'Entrega das chaves', false],
  ['enel', 'Transferência ENEL', false],
  ['iptu', 'Transferência IPTU', false],
  ['condominio', 'Transferência titularidade condomínio', false],
  ['avaliacao', 'Avaliação Google', false],
  ['finalizado', 'Processo finalizado', false],
];
const FEITAS = new Set(['doc_pasta', 'ficha', 'proposta']); // 3 primeiras concluídas
const checklist = MODELO.map(([key, label, obrigatoria]) => ({
  key, label, obrigatoria,
  feito: FEITAS.has(key),
  feitoPor: FEITAS.has(key) ? 'Corretor de Teste' : '',
  feitoEm: FEITAS.has(key) ? diasAtras(7) : null,
}));

const CODIGO = 'NG-900001'; // número alto: não colide com o counter real
const negocio = {
  codigo: CODIGO, numero: 900001,
  imovelId: 'seed-imovel-ia', imovelProtocolo: null,
  imovelResumo: 'Rua das Acácias, 245 — Apto 52', cidade: 'São Paulo',
  tipo: 'locacao',
  clienteNome: 'Mariana Souza', clienteContato: '(11) 98888-1234',
  interessadoIndex: 0,
  corretorUid: 'stg-corretor', corretorNome: 'Corretor de Teste',
  brokerUid: 'stg-colega', brokerNome: 'Teste (Gestor)',
  status: 'em_andamento',
  proximaAcao: 'Contrato emitido',
  checklist,
  comentarios: [],
  documentos: [], tarefas: [], tags: [],
  timeline: [
    { texto: 'Negócio criado a partir do interessado Mariana Souza', porNome: 'Teste (Gestor)', em: diasAtras(10) },
    { texto: 'Etapas concluídas automaticamente: Documentação salva na pasta, Ficha cadastral preenchida', porNome: 'Sistema', em: diasAtras(10) },
    { texto: 'Etapa concluída: Proposta ajustada', porNome: 'Corretor de Teste', em: diasAtras(7) },
  ],
  criadoEm: diasAtras(10),
  atualizadoEm: diasAtras(5), // parado há ~5 dias
};

(async () => {
  console.log('🌱 Criando negócio de teste no STAGING (', PROJETO, ')...');
  const ref = db.collection('negocios').doc('seed-negocio-ia');
  await ref.set(negocio);
  console.log('  ✓', CODIGO, '— Locação — Mariana Souza — status em_andamento — parado há 5 dias');
  console.log('\n✅ Pronto. Abra a aba Negócios no staging e clique em', CODIGO, '→ card "Assistente IA".');
  console.log('   Visível para: teste@staggin.com.br (gestor) e corretor@staggin.com.br (dono).');
  process.exit(0);
})().catch((e) => { console.error('Erro:', e.message || e); process.exit(1); });
