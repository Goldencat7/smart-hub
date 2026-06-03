const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.firestore();

// UIDs dos admins iniciais — usado SÓ pra "bootstrap": setar a claim de admin
// na primeira vez que cada um logar. Depois disso, admins gerenciam outros admins pela UI.
const BOOTSTRAP_ADMIN_UIDS = [
  'OwcT6wCrXMgJ0tPADMUdKdBB8h32' // adminhub@smart.com
  // adicionar aqui novos UIDs separados por vírgula
];
function ehBootstrapAdmin(uid) {
  return BOOTSTRAP_ADMIN_UIDS.includes(uid);
}

// Apps "restritos": só aparecem/funcionam pra quem o admin liberar (ou pra admins).
const RESTRICTED_APPS = ['clicksign'];

function ehAdminAuth(auth) {
  return !!(auth && ((auth.token && auth.token.admin === true) || ehBootstrapAdmin(auth.uid)));
}

// Verifica se o usuário pode acessar um app (todos podem os normais; restritos só liberados/admin)
async function temAcessoApp(auth, siteKey) {
  if (!RESTRICTED_APPS.includes(siteKey)) return true;
  if (!auth) return false;
  if (ehAdminAuth(auth)) return true;
  const snap = await db.collection('user_access').doc(auth.uid).get();
  const apps = snap.exists ? (snap.data().apps || []) : [];
  return apps.includes(siteKey);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function exigirAutenticado(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Faça login primeiro.');
  return req.auth;
}

async function exigirAdmin(req) {
  const auth = exigirAutenticado(req);
  if (auth.token && auth.token.admin === true) return auth;
  // Fallback: aceita o bootstrap admin mesmo sem a claim (primeira vez)
  if (ehBootstrapAdmin(auth.uid)) return auth;
  throw new HttpsError('permission-denied', 'Apenas admin pode fazer isso.');
}

// ─── Bootstrap do admin inicial ─────────────────────────────────────────────
// O usuário com BOOTSTRAP_ADMIN_UID chama isso 1 vez pra ganhar a custom claim.
exports.bootstrapAdmin = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehBootstrapAdmin(auth.uid)) {
    throw new HttpsError('permission-denied', 'Você não é o admin inicial.');
  }
  await admin.auth().setCustomUserClaims(auth.uid, { admin: true });
  return { ok: true, mensagem: 'Você agora é admin. Faça logout/login pra atualizar o token.' };
});

// ─── Credenciais dos sistemas (usado pelo autologin) ───────────────────────
// Qualquer usuário autenticado pode pedir credenciais — elas voltam só na resposta,
// nunca ficam no .exe nem no disco do cliente.
exports.getCredentials = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { siteKey } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');

  // Apps restritos: só entrega credenciais pra quem tem acesso
  if (!(await temAcessoApp(auth, siteKey))) {
    throw new HttpsError('permission-denied', 'Você não tem acesso a este app.');
  }

  const snap = await db.collection('credentials').doc(siteKey).get();
  if (!snap.exists) throw new HttpsError('not-found', `Sem credenciais para ${siteKey}.`);

  const d = snap.data();
  return { login: d.login || '', password: d.password || '' };
});

// Apps restritos que o usuário ATUAL pode ver (admin vê todos)
exports.getMinhasPermissoes = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (ehAdminAuth(auth)) return { apps: RESTRICTED_APPS, isAdmin: true };
  const snap = await db.collection('user_access').doc(auth.uid).get();
  const apps = snap.exists ? (snap.data().apps || []) : [];
  return { apps, isAdmin: false };
});

// (admin) Lê os apps restritos liberados pra um usuário + lista de restritos disponíveis
exports.getUserAccess = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const userRec = await admin.auth().getUser(uid).catch(() => null);
  const alvoAdmin = !!(userRec && userRec.customClaims && userRec.customClaims.admin) || ehBootstrapAdmin(uid);
  const snap = await db.collection('user_access').doc(uid).get();
  return {
    apps: snap.exists ? (snap.data().apps || []) : [],
    restritos: RESTRICTED_APPS,
    isAdmin: alvoAdmin
  };
});

// (admin) Define quais apps restritos um usuário pode ver
exports.setUserAccess = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid, apps } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const limpos = Array.isArray(apps) ? apps.filter(a => RESTRICTED_APPS.includes(a)) : [];
  await db.collection('user_access').doc(uid).set({
    apps: limpos,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
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

  // Carrega a atividade (último app acessado) de todos de uma vez
  const atividade = {};
  const actSnap = await db.collection('user_activity').get();
  actSnap.forEach(d => { atividade[d.id] = d.data(); });

  return result.users.map(u => {
    const a = atividade[u.uid] || {};
    return {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      disabled: u.disabled,
      isAdmin: !!(u.customClaims && u.customClaims.admin),
      createdAt: u.metadata.creationTime,
      lastSignIn: u.metadata.lastSignInTime,
      lastApp: a.lastAppTitulo || null,
      lastAppAt: a.lastAppAt ? a.lastAppAt.toDate().toISOString() : null
    };
  });
});

// Registra o último app que o usuário abriu (chamado pelo Hub ao abrir um app)
exports.registrarAcesso = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { siteKey, titulo } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');
  await db.collection('user_activity').doc(auth.uid).set({
    lastApp: siteKey,
    lastAppTitulo: titulo || siteKey,
    lastAppAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// ─── Perfil do usuário (nome + foto) ─────────────────────────────────────────
exports.getMeuPerfil = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const userRec = await admin.auth().getUser(auth.uid).catch(() => null);
  const snap = await db.collection('user_profiles').doc(auth.uid).get();
  const p = snap.exists ? snap.data() : {};
  return {
    email: (userRec && userRec.email) || (auth.token && auth.token.email) || '',
    displayName: (userRec && userRec.displayName) || '',
    photo: p.photo || ''
  };
});

exports.salvarMeuPerfil = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { displayName, photo } = req.data || {};
  const upd = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (typeof displayName === 'string' && displayName.trim()) {
    const nome = displayName.trim().slice(0, 80);
    await admin.auth().updateUser(auth.uid, { displayName: nome });
    upd.displayName = nome;
  }
  if (typeof photo === 'string') {
    // foto = data URL (base64) pequena. Limite de segurança ~300KB.
    if (photo.length > 400000) {
      throw new HttpsError('invalid-argument', 'Foto muito grande. Tente uma imagem menor.');
    }
    upd.photo = photo;
  }
  await db.collection('user_profiles').doc(auth.uid).set(upd, { merge: true });
  return { ok: true };
});

// ─── Agenda / Eventos ────────────────────────────────────────────────────────
// Admin pode criar pra outras pessoas (ou "todos"); usuário comum só pra si.
exports.criarEvento = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehAdmin = ehAdminAuth(auth);
  const { titulo, inicio, participantes, todos, descricao } = req.data || {};
  if (!titulo || !inicio) throw new HttpsError('invalid-argument', 'Título e data/hora são obrigatórios.');
  const dataInicio = new Date(inicio);
  if (isNaN(dataInicio.getTime())) throw new HttpsError('invalid-argument', 'Data/hora inválida.');

  let parts = [auth.uid];
  let paraTodos = false;
  if (ehAdmin) {
    if (todos) { paraTodos = true; parts = []; }
    else if (Array.isArray(participantes) && participantes.length) parts = participantes.slice(0, 300);
  }

  const ref = await db.collection('events').add({
    titulo: String(titulo).slice(0, 120),
    descricao: descricao ? String(descricao).slice(0, 500) : '',
    inicio: admin.firestore.Timestamp.fromDate(dataInicio),
    participantes: parts,
    todos: paraTodos,
    criadoPor: auth.uid,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, id: ref.id };
});

// Lista os eventos do usuário num período (participante, "todos", ou criados por ele)
exports.listarEventos = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { de, ate } = req.data || {};
  const dDe = de ? new Date(de) : new Date();
  const dAte = ate ? new Date(ate) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 60);
  const snap = await db.collection('events')
    .where('inicio', '>=', admin.firestore.Timestamp.fromDate(dDe))
    .where('inicio', '<=', admin.firestore.Timestamp.fromDate(dAte))
    .orderBy('inicio')
    .get();

  const lista = [];
  snap.forEach(d => {
    const x = d.data();
    const meu = x.todos === true
      || (Array.isArray(x.participantes) && x.participantes.includes(auth.uid))
      || x.criadoPor === auth.uid;
    if (meu) {
      lista.push({
        id: d.id,
        titulo: x.titulo,
        descricao: x.descricao || '',
        inicio: x.inicio.toDate().toISOString(),
        todos: !!x.todos,
        souDono: x.criadoPor === auth.uid
      });
    }
  });
  return lista;
});

exports.excluirEvento = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  const ref = db.collection('events').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (snap.data().criadoPor !== auth.uid && !ehAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Só quem criou (ou admin) pode excluir.');
  }
  await ref.delete();
  return { ok: true };
});

// (admin) Lista pessoas pra escolher participantes de uma reunião
exports.listarPessoas = onCall(async (req) => {
  await exigirAdmin(req);
  const result = await admin.auth().listUsers(1000);
  return result.users.map(u => ({ uid: u.uid, nome: u.displayName || u.email || u.uid }));
});

exports.setUserAdmin = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid, isAdmin } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  // Impede de tirar a claim do próprio admin inicial
  if (ehBootstrapAdmin(uid) && isAdmin === false) {
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
  if (ehBootstrapAdmin(uid)) {
    throw new HttpsError('failed-precondition', 'O admin inicial não pode ser deletado.');
  }
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

// ─── Códigos de Convite ────────────────────────────────────────────────────
// Admin gera um código → pessoa usa pra criar conta no Hub.

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L
function gerarCodigoAleatorio(tamanho = 8) {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return 'REMAX-' + s;
}

exports.criarCodigoConvite = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { fazAdmin, diasValidade, maxUsos } = req.data || {};
  const codigo = gerarCodigoAleatorio();
  const agora = admin.firestore.FieldValue.serverTimestamp();
  const expira = diasValidade
    ? admin.firestore.Timestamp.fromMillis(Date.now() + diasValidade * 24 * 60 * 60 * 1000)
    : null;

  await db.collection('codigos_convite').doc(codigo).set({
    criadoPor: auth.uid,
    criadoEm: agora,
    expiraEm: expira,
    maxUsos: maxUsos || 1,
    usos: 0,
    fazAdmin: !!fazAdmin,
    usadosPor: []
  });

  return { codigo };
});

exports.listarCodigosConvite = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('codigos_convite').orderBy('criadoEm', 'desc').get();
  return snap.docs.map(d => {
    const x = d.data();
    return {
      codigo: d.id,
      maxUsos: x.maxUsos,
      usos: x.usos,
      fazAdmin: x.fazAdmin,
      expiraEm: x.expiraEm ? x.expiraEm.toDate().toISOString() : null,
      criadoEm: x.criadoEm ? x.criadoEm.toDate().toISOString() : null,
      esgotado: x.usos >= x.maxUsos,
      expirado: x.expiraEm ? x.expiraEm.toDate() < new Date() : false
    };
  });
});

exports.excluirCodigoConvite = onCall(async (req) => {
  await exigirAdmin(req);
  const { codigo } = req.data || {};
  if (!codigo) throw new HttpsError('invalid-argument', 'codigo é obrigatório.');
  await db.collection('codigos_convite').doc(codigo).delete();
  return { ok: true };
});

// PÚBLICO (sem auth) — pessoa nova usa o código pra criar conta.
exports.criarContaComCodigo = onCall(async (req) => {
  const { email, senha, codigo, displayName } = req.data || {};
  if (!email || !senha || !codigo) {
    throw new HttpsError('invalid-argument', 'email, senha e codigo são obrigatórios.');
  }
  if (senha.length < 6) {
    throw new HttpsError('invalid-argument', 'A senha precisa ter pelo menos 6 caracteres.');
  }

  const ref = db.collection('codigos_convite').doc(codigo.trim().toUpperCase());

  // 1) Validação rápida ANTES de criar a conta (evita conta órfã no caso comum)
  const snapInicial = await ref.get();
  if (!snapInicial.exists) throw new HttpsError('not-found', 'Código de convite inválido.');
  const dadosCodigo = snapInicial.data();
  if (dadosCodigo.usos >= dadosCodigo.maxUsos) {
    throw new HttpsError('failed-precondition', 'Este código já foi usado.');
  }
  if (dadosCodigo.expiraEm && dadosCodigo.expiraEm.toDate() < new Date()) {
    throw new HttpsError('failed-precondition', 'Este código expirou.');
  }

  // 2) Cria a conta UMA vez, fora da transação
  let user;
  try {
    user = await admin.auth().createUser({
      email,
      password: senha,
      displayName: displayName || undefined
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Já existe uma conta com esse email.');
    }
    throw new HttpsError('internal', e.message);
  }

  // 3) Consome o código atomicamente (a transação só lê + atualiza, então é seguro re-executar).
  //    Se falhar (corrida: código esgotou/expirou no meio), desfaz a conta criada.
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Código de convite inválido.');
      const x = snap.data();
      if (x.usos >= x.maxUsos) throw new HttpsError('failed-precondition', 'Este código já foi usado.');
      if (x.expiraEm && x.expiraEm.toDate() < new Date()) {
        throw new HttpsError('failed-precondition', 'Este código expirou.');
      }
      tx.update(ref, {
        usos: x.usos + 1,
        usadosPor: admin.firestore.FieldValue.arrayUnion(user.uid)
      });
    });
  } catch (e) {
    await admin.auth().deleteUser(user.uid).catch(() => {}); // rollback da conta
    throw e;
  }

  // 4) Promove a admin se o código pedir
  if (dadosCodigo.fazAdmin) {
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  }

  return { ok: true, uid: user.uid, fazAdmin: !!dadosCodigo.fazAdmin };
});
