// Testes de INTEGRAÇÃO das Cloud Functions — a camada de trava de acesso das callables.
//
// Rodam contra o emulador (Auth + Functions + Firestore de mentira, isolado — nunca
// tocam produção). NÃO mexem em uma linha do app: só CHAMAM as funções reais rodando
// no emulador e conferem que elas RECUSAM quem não pode. Focam nas travas que barram
// ANTES de qualquer segredo (KMS/e-mail) ou rede externa — então não precisam de
// secret configurado nem de internet.
//
// Como rodar:  npm run test:functions   (sobe auth+functions+firestore, roda, derruba)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const app  = initializeApp({ projectId: 'demo-smart-hub', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns  = getFunctions(app, 'southamerica-east1');   // mesma região das functions
connectFunctionsEmulator(fns, '127.0.0.1', 5001);

const chamar = (nome, dados) => httpsCallable(fns, nome)(dados || {});

// Afirma que a chamada FALHA com o código esperado (ex.: 'unauthenticated').
async function esperaErro(promise, code) {
  try {
    await promise;
    assert.fail(`esperava falhar com '${code}', mas a chamada passou`);
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    assert.equal(e.code, `functions/${code}`, `esperava '${code}', veio '${e.code}' (${e.message})`);
  }
}

describe('Callables — sem login (anônimo é barrado)', () => {
  before(() => signOut(auth).catch(() => {}));

  it('getCredentials sem login → unauthenticated (cofre fechado pra anônimo)', async () => {
    await esperaErro(chamar('getCredentials', { siteKey: 'clicksign' }), 'unauthenticated');
  });

  it('sincronizarFeedAgora sem login → unauthenticated', async () => {
    await esperaErro(chamar('sincronizarFeedAgora'), 'unauthenticated');
  });

  it('bootstrapAdmin sem login → unauthenticated', async () => {
    await esperaErro(chamar('bootstrapAdmin'), 'unauthenticated');
  });
});

describe('Callables — logado comum (sem privilégio)', () => {
  before(async () => {
    // Cria + loga um usuário comum no emulador (banco fresco a cada run).
    await createUserWithEmailAndPassword(auth, 'tester@demo.com', 'senha123').catch(async (e) => {
      if (e.code !== 'auth/email-already-in-use') throw e;
    });
  });
  after(() => signOut(auth).catch(() => {}));

  it('getCredentials sem siteKey → invalid-argument', async () => {
    await esperaErro(chamar('getCredentials', {}), 'invalid-argument');
  });

  it('getCredentials com siteKey inexistente → not-found (passou a trava, sem credencial)', async () => {
    await esperaErro(chamar('getCredentials', { siteKey: 'nao-existe-xyz' }), 'not-found');
  });

  it('bootstrapAdmin por usuário comum → permission-denied', async () => {
    await esperaErro(chamar('bootstrapAdmin'), 'permission-denied');
  });
});
