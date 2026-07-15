#!/usr/bin/env node
/* Semeia dados de MENTIRA no emulador (nunca em produção).
 * ---------------------------------------------------------------------------
 * Roda o Admin SDK apontado pros emuladores (via as env FIRESTORE_EMULATOR_HOST
 * / FIREBASE_AUTH_EMULATOR_HOST). Cria um admin, um corretor e algumas fichas,
 * pra você abrir o Hub/telas contra o emulador e já ver conteúdo.
 *
 * GARANTIA ANTI-PRODUÇÃO: se as env de emulador não estiverem setadas, aborta.
 * Assim é impossível esse script escrever no Firestore de verdade por engano.
 *
 * Uso: `npm run emu:seed`  (com o emulador rodando em outra janela)
 */
'use strict';
const path = require('path');

// Aponta o Admin SDK pros emuladores. `npm run emu:seed` já injeta esses hosts,
// mas reforçamos aqui pro caso de rodar `node scripts/emu-seed.js` na mão.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✋ Env de emulador ausente — abortando pra não escrever em produção.');
  process.exit(1);
}

// firebase-admin já está instalado na pasta functions (não é dep do app).
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: 'remax-smart-hub' });
const db = admin.firestore();
const auth = admin.auth();

const SENHA = 'teste1234';
const USERS = [
  { uid: 'seed-admin',    email: 'admin@teste.local',    nome: 'Admin de Teste',    admin: true },
  { uid: 'seed-corretor', email: 'corretor@teste.local', nome: 'Corretor de Teste', admin: false },
];

async function criarUsuario(u) {
  try { await auth.deleteUser(u.uid); } catch (_e) { /* ainda não existe */ }
  await auth.createUser({ uid: u.uid, email: u.email, password: SENHA, displayName: u.nome, emailVerified: true });
  if (u.admin) await auth.setCustomUserClaims(u.uid, { admin: true });
  await db.collection('user_profiles').doc(u.uid).set({ nome: u.nome, email: u.email, isAdmin: !!u.admin });
}

async function criarFichas(corretorUid, corretorNome) {
  const base = { corretorUid, corretorNome, criadoEm: admin.firestore.FieldValue.serverTimestamp() };
  const fichas = [
    { id: 'seed-ficha-pf-1', tipo: 'pf', status: 'aguardando_corretor',
      dados: { nome_completo: 'Maria Teste da Silva', cpf: '123.456.789-00', email: 'maria@exemplo.com' } },
    { id: 'seed-ficha-pf-2', tipo: 'pf', status: 'enviado_admin',
      dados: { nome_completo: 'João Teste Souza', cpf: '987.654.321-00', email: 'joao@exemplo.com' } },
    { id: 'seed-ficha-vendedor-1', tipo: 'vendedor', status: 'correcao_solicitada',
      observacaoCorretor: 'Falta anexar o comprovante de endereço.',
      dados: { nome_completo: 'Imobiliária Teste Ltda', email: 'contato@exemplo.com' } },
  ];
  for (const f of fichas) {
    const { id, ...resto } = f;
    await db.collection('fichas').doc(id).set({ ...base, ...resto });
  }
  return fichas.length;
}

(async () => {
  console.log('🌱 Semeando o emulador (', process.env.FIRESTORE_EMULATOR_HOST, ')...');
  for (const u of USERS) { await criarUsuario(u); console.log('  • usuário', u.email, u.admin ? '(admin)' : ''); }
  const n = await criarFichas('seed-corretor', 'Corretor de Teste');
  console.log('  •', n, 'fichas do corretor de teste');
  console.log('\n✅ Pronto. Login de teste (no emulador):');
  console.log('   admin    → admin@teste.local     /', SENHA);
  console.log('   corretor → corretor@teste.local  /', SENHA);
  console.log('   (a 2FA não roda no emulador; é login simples)');
  process.exit(0);
})().catch((e) => { console.error('Erro ao semear:', e); process.exit(1); });
