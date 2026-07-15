/* Seletor de ambiente do Firebase — prod / staging / emulador — POR HOSTNAME.
 * ===========================================================================
 * Cada superfície se auto-seleciona pela URL onde está rodando. NÃO existe flag
 * manual — então é impossível um build de produção apontar pro lugar errado:
 *
 *   • file://  ou  remax-smart-hub.web.app  → PRODUÇÃO   (o .exe é sempre prod)
 *   • remax-smart-hub-staging.web.app        → STAGING    (onde o colega testa)
 *   • localhost / 127.0.0.1                  → EMULADOR   (dev local; connect*)
 *
 * Por que é seguro: `location.hostname` no .exe é vazio (file://) e no site de
 * produção é `remax-smart-hub.web.app` — nenhum dos dois é localhost nem staging,
 * então produção SEMPRE cai no config de produção e NUNCA liga emulador. O único
 * jeito de tocar staging/emulador é abrir de propósito na URL de staging ou num
 * servidor local. As chaves abaixo são PÚBLICAS (não são segredo — ver CLAUDE.md).
 *
 * Este módulo NÃO importa o SDK do Firebase no topo de propósito: em produção ele
 * é só config + um no-op. O `connect*` do emulador só é baixado (dinamicamente)
 * em localhost — assim as fichas não ganham SDK extra no carregamento (o que
 * poderia reabrir o problema da "ficha em branco").
 *
 * ⚠️ Existe uma cópia idêntica em `firebase-env.js` (raiz). As telas da raiz
 *    importam de lá; as fichas em public/ importam desta. Mantenha as duas em sync.
 */
const PROD = {
  apiKey: 'AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8',
  authDomain: 'remax-smart-hub.firebaseapp.com',
  projectId: 'remax-smart-hub',
  storageBucket: 'remax-smart-hub.firebasestorage.app',
  messagingSenderId: '474454438949',
  appId: '1:474454438949:web:ba1e10e6b343af0408fbcc',
};

const STAGING = {
  apiKey: 'AIzaSyBaG1lCAh5HGkmn1mz_IcmampEa1LpT_is',
  authDomain: 'remax-smart-hub-staging.firebaseapp.com',
  projectId: 'remax-smart-hub-staging',
  storageBucket: 'remax-smart-hub-staging.firebasestorage.app',
  messagingSenderId: '46653971309',
  appId: '1:46653971309:web:2e0a7b11a7123f119f5864',
};

const host = (typeof location !== 'undefined' && location.hostname) || '';

export const EH_STAGING    = host.includes('remax-smart-hub-staging');
export const USAR_EMULADOR = host === 'localhost' || host === '127.0.0.1';
export const AMBIENTE      = USAR_EMULADOR ? 'emulador' : (EH_STAGING ? 'staging' : 'producao');

// Config que o initializeApp deve usar. Em localhost o projectId não importa
// (tudo é redirecionado pro emulador), então reusa o de produção.
export const firebaseConfig = EH_STAGING ? STAGING : PROD;

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

/* Liga os emuladores locais — SÓ faz algo em localhost. Chame logo depois do
 * initializeApp/getX. Em prod/staging retorna na hora sem importar nada. O
 * `connect*` é baixado dinamicamente (e só em localhost). Passe apenas os
 * serviços que a tela usa. */
export async function conectarEmuladores({ auth, db, fns, storage } = {}) {
  if (!USAR_EMULADOR) return;
  try {
    if (auth)    { const { connectAuthEmulator }      = await import(`${SDK}/firebase-auth.js`);      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
    if (db)      { const { connectFirestoreEmulator }  = await import(`${SDK}/firebase-firestore.js`); connectFirestoreEmulator(db, '127.0.0.1', 8080); }
    if (fns)     { const { connectFunctionsEmulator }  = await import(`${SDK}/firebase-functions.js`); connectFunctionsEmulator(fns, '127.0.0.1', 5001); }
    if (storage) { const { connectStorageEmulator }    = await import(`${SDK}/firebase-storage.js`);   connectStorageEmulator(storage, '127.0.0.1', 9199); }
    console.info('[firebase-env] emuladores locais conectados');
  } catch (e) {
    console.error('[firebase-env] falha ao conectar emuladores:', e);
  }
}
