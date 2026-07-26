#!/usr/bin/env node
/* Testa a sincronização automática do Drive em PRODUÇÃO:
 * acha o usuário conectado (drive:true), sobe um documento de exemplo, cria uma
 * ficha de teste atribuída a ele (tipo pf, status rascunho, SEM imovelId — só o
 * trigger do Drive reage), espera o trigger e confere o drive_config.
 * Uso: node scratchpad/drive-test.js
 */
'use strict';
const path = require('path');
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('emulador — abortando'); process.exit(1); }
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: 'remax-smart-hub', storageBucket: 'remax-smart-hub.firebasestorage.app' });
const db = admin.firestore();

(async () => {
  // 1. usuário conectado com Drive
  const snap = await db.collection('google_tokens').where('drive', '==', true).get();
  if (snap.empty) { console.error('❌ Ninguém com Drive conectado (drive:true). Reconecte no Meu Perfil.'); process.exit(1); }
  const docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (b.connectedAt?.toMillis?.() || 0) - (a.connectedAt?.toMillis?.() || 0));
  const user = docs[0];
  console.log('👤 Conectado:', user.email || '(sem email)', '| uid=', user.uid, docs.length > 1 ? `(+${docs.length - 1} outros)` : '');

  // 2. sobe um documento de exemplo no Storage
  const bucket = admin.storage().bucket();
  const filePath = `_teste_drive/rg-exemplo-${Date.now()}.txt`;
  const file = bucket.file(filePath);
  const token = require('crypto').randomUUID();
  await file.save(Buffer.from('Documento de teste — sincronização do Google Drive (REMAX Smart Hub).'), { contentType: 'text/plain', metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  console.log('📎 Documento de exemplo no Storage OK (token de download)');
  // 3 campos com nomes diferentes pra ver a categorização: RG→Identidade, comprovante→Comprovantes, contrato→Diversos
  const documentos = { 'rgFrente': url, 'compRenda': url, 'contrato': url };

  // 3. cria a ficha de teste (só o trigger do Drive reage)
  const fichaId = 'TEST-drive-' + Date.now();
  await db.collection('fichas').doc(fichaId).set({
    tipo: 'pf', status: 'rascunho', corretorUid: user.uid, corretorNome: 'Teste Drive',
    dados: { nome: 'TESTE Estrutura Nova' },
    documentos,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('📝 Ficha de teste criada:', fichaId, '(pessoa → 4 categorias)');

  // 4. espera o trigger criar/atualizar o drive_config
  const cfgRef = db.collection('drive_config').doc(user.uid);
  const antes = (await cfgRef.get()).data();
  const antesAt = antes?.atualizadoEm?.toMillis?.() || 0;
  console.log('⏳ Esperando o trigger sincronizar...');
  let ok = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const c = (await cfgRef.get()).data();
    if (c && c.rootId && (c.atualizadoEm?.toMillis?.() || 0) > antesAt) { ok = true; console.log('\n✅ drive_config atualizado — estrutura criada no Drive!'); console.log('   rootId:', c.rootId); console.log('   pastas:', Object.keys(c.pastas || {}).join(', ')); break; }
  }
  if (!ok) console.log('\n⚠️ drive_config não mudou em 40s. (Pode ser cold start do trigger ou token sem Drive — vou checar os logs.)');

  // 5. limpa a ficha de teste (os arquivos no Drive PERMANECEM pra você ver)
  await db.collection('fichas').doc(fichaId).delete();
  await file.delete().catch(() => {});
  console.log('\n🧹 Ficha e arquivo de Storage de teste removidos (o que foi pro Drive continua lá).');
  console.log('\n👉 Abra seu Google Drive e procure:');
  console.log('   REMAX Smart Hub — Documentos ▸ TESTE Estrutura Nova ▸');
  console.log('     Identidade ▸ rgFrente   |   Comprovantes ▸ compRenda   |   Documentos Diversos ▸ contrato + PDF da ficha');
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('💥', e.message); process.exit(1); });
