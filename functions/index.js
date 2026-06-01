const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.firestore();

// UID do admin inicial — usado SÓ pra "bootstrap": setar a primeira claim de admin.
// Depois disso, admin gerencia outros admins pela UI.
const BOOTSTRAP_ADMIN_UID = 'OwcT6wCrXMgJ0tPADMUdKdBB8h32';

// ─── Helpers ────────────────────────────────────────────────────────────────

function exigirAutenticado(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Faça login primeiro.');
  return req.auth;
}

async function exigirAdmin(req) {
  const auth = exigirAutenticado(req);
  if (auth.token && auth.token.admin === true) return auth;
  // Fallback: aceita o bootstrap admin mesmo sem a claim (primeira vez)
  if (auth.uid === BOOTSTRAP_ADMIN_UID) return auth;
  throw new HttpsError('permission-denied', 'Apenas admin pode fazer isso.');
}

// ─── Bootstrap do admin inicial ─────────────────────────────────────────────
// O usuário com BOOTSTRAP_ADMIN_UID chama isso 1 vez pra ganhar a custom claim.
exports.bootstrapAdmin = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (auth.uid !== BOOTSTRAP_ADMIN_UID) {
    throw new HttpsError('permission-denied', 'Você não é o admin inicial.');
  }
  await admin.auth().setCustomUserClaims(auth.uid, { admin: true });
  return { ok: true, mensagem: 'Você agora é admin. Faça logout/login pra atualizar o token.' };
});

// ─── Credenciais dos sistemas (usado pelo autologin) ───────────────────────
// Qualquer usuário autenticado pode pedir credenciais — elas voltam só na resposta,
// nunca ficam no .exe nem no disco do cliente.
exports.getCredentials = onCall(async (req) => {
  exigirAutenticado(req);
  const { siteKey } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');

  const snap = await db.collection('credentials').doc(siteKey).get();
  if (!snap.exists) throw new HttpsError('not-found', `Sem credenciais para ${siteKey}.`);

  const d = snap.data();
  return { login: d.login || '', password: d.password || '' };
});

// Lista quais siteKeys têm credenciais cadastradas
exports.listCredentials = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('credentials').get();
  return snap.docs.map(doc => ({
    siteKey: doc.id,
    login: doc.data().login || '',
    // NÃO retorna a senha em lista — só ao editar.
    temSenha: !!doc.data().password
  }));
});

// Lê uma credencial específica (admin only) — pra preencher form de edição
exports.getCredentialAdmin = onCall(async (req) => {
  await exigirAdmin(req);
  const { siteKey } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');

  const snap = await db.collection('credentials').doc(siteKey).get();
  if (!snap.exists) return { login: '', password: '' };
  const d = snap.data();
  return { login: d.login || '', password: d.password || '' };
});

// Cria ou atualiza credenciais (admin only)
exports.setCredentials = onCall(async (req) => {
  await exigirAdmin(req);
  const { siteKey, login, password } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');

  await db.collection('credentials').doc(siteKey).set({
    login: login || '',
    password: password || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// Remove credenciais (admin only)
exports.deleteCredentials = onCall(async (req) => {
  await exigirAdmin(req);
  const { siteKey } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');
  await db.collection('credentials').doc(siteKey).delete();
  return { ok: true };
});

// ─── Gestão de usuários (admin only) ────────────────────────────────────────
exports.listUsers = onCall(async (req) => {
  await exigirAdmin(req);
  const result = await admin.auth().listUsers(1000);
  return result.users.map(u => ({
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    disabled: u.disabled,
    isAdmin: !!(u.customClaims && u.customClaims.admin),
    createdAt: u.metadata.creationTime,
    lastSignIn: u.metadata.lastSignInTime
  }));
});

exports.setUserAdmin = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid, isAdmin } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  // Impede de tirar a claim do próprio admin inicial
  if (uid === BOOTSTRAP_ADMIN_UID && isAdmin === false) {
    throw new HttpsError('failed-precondition', 'O admin inicial não pode ser rebaixado.');
  }
  await admin.auth().setCustomUserClaims(uid, { admin: !!isAdmin });
  return { ok: true };
});

exports.createUser = onCall(async (req) => {
  await exigirAdmin(req);
  const { email, password, displayName, isAdmin } = req.data || {};
  if (!email || !password) throw new HttpsError('invalid-argument', 'email e password obrigatórios.');
  const user = await admin.auth().createUser({ email, password, displayName: displayName || undefined });
  if (isAdmin) {
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  }
  return { uid: user.uid };
});

exports.deleteUserAccount = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  if (uid === BOOTSTRAP_ADMIN_UID) {
    throw new HttpsError('failed-precondition', 'O admin inicial não pode ser deletado.');
  }
  await admin.auth().deleteUser(uid);
  return { ok: true };
});
