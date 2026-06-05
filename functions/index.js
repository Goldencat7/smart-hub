const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.firestore();

// ─── Google Agenda (OAuth + sincronização) ──────────────────────────────────
// A chave secreta do cliente OAuth fica no cofre (Secret Manager), NUNCA no código.
const { defineSecret } = require('firebase-functions/params');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const GOOGLE_CLIENT_ID = '474454438949-8hu3emcu98oa9pb92qcd7ucq9elhj9nc.apps.googleusercontent.com';
const TZ = 'America/Sao_Paulo';

async function googleTokenRequest(params) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new HttpsError('internal', 'Google OAuth: ' + (data.error_description || data.error || resp.status));
  }
  return data;
}

// Troca o "code" (vindo do fluxo no app) por tokens — o que importa é o refresh_token.
async function trocarCodePorTokens(code, codeVerifier, redirectUri) {
  return googleTokenRequest({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET.value(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  });
}

// Gera um access_token novo a partir do refresh_token guardado.
async function getAccessToken(refreshToken) {
  const data = await googleTokenRequest({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET.value(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  return data.access_token;
}

// Insere um evento na agenda "primary" do usuário; devolve o id do evento no Google.
async function inserirEventoGoogle(accessToken, ev) {
  const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: ev.titulo,
      description: ev.descricao || '',
      start: { dateTime: ev.inicioISO, timeZone: TZ },
      end:   { dateTime: ev.fimISO,    timeZone: TZ }
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new HttpsError('internal', 'Calendar insert: ' + ((data.error && data.error.message) || resp.status));
  return data.id;
}

async function removerEventoGoogle(accessToken, googleEventId) {
  const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  // 410 = já removido, 404 = não existe — tratamos como ok.
  if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
    throw new HttpsError('internal', 'Calendar delete: ' + resp.status);
  }
}

// Insere uma TAREFA na lista padrão do Google Tarefas; devolve o id da tarefa.
// (No Google, "lembrete" e "tarefa" são a mesma coisa — ambos viram Tarefa.)
async function inserirTarefaGoogle(accessToken, ev) {
  const resp = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: ev.titulo,
      notes: ev.descricao || '',
      due: ev.dueISO   // o Google Tarefas só guarda a DATA (ignora a hora)
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new HttpsError('internal', 'Tasks insert: ' + ((data.error && data.error.message) || resp.status));
  return data.id;
}

async function removerTarefaGoogle(accessToken, taskId) {
  const resp = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
    throw new HttpsError('internal', 'Tasks delete: ' + resp.status);
  }
}

// uids que conectaram a Google Agenda (usado em eventos "para todos").
async function uidsConectados() {
  const snap = await db.collection('google_tokens').get();
  return snap.docs.map(d => d.id);
}

// Espelha um item pro Google de cada uid conectado; devolve { uid: googleId }.
// tipo 'evento' → Google Agenda; 'tarefa'/'lembrete' → Google Tarefas.
// Best-effort: falha de um não derruba os outros.
async function sincronizarParaGoogle(uids, ev, tipo) {
  const ehTarefa = (tipo === 'tarefa' || tipo === 'lembrete');
  const ids = {};
  for (const uid of [...new Set(uids)]) {
    try {
      const tokSnap = await db.collection('google_tokens').doc(uid).get();
      if (!tokSnap.exists || !tokSnap.data().refreshToken) continue;
      const accessToken = await getAccessToken(tokSnap.data().refreshToken);
      ids[uid] = ehTarefa
        ? await inserirTarefaGoogle(accessToken, ev)
        : await inserirEventoGoogle(accessToken, ev);
    } catch (e) {
      console.warn(`Sync Google falhou p/ ${uid} (${tipo}):`, e.message);
    }
  }
  return ids;
}

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

// ─── Google Agenda: conectar / desconectar / status ──────────────────────────
// O app abre o navegador, a pessoa autoriza, e manda o "code" pra cá. A troca
// pela permissão de longo prazo (refresh_token) acontece aqui no servidor.
exports.conectarGoogleAgenda = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { code, codeVerifier, redirectUri } = req.data || {};
  if (!code || !codeVerifier || !redirectUri) {
    throw new HttpsError('invalid-argument', 'Dados de conexão incompletos.');
  }
  const tokens = await trocarCodePorTokens(code, codeVerifier, redirectUri);
  if (!tokens.refresh_token) {
    throw new HttpsError('failed-precondition', 'Não recebemos a permissão de longo prazo. Tente conectar de novo.');
  }
  // Descobre o email da conta Google conectada (vem no id_token) só pra mostrar na tela.
  let email = '';
  try {
    if (tokens.id_token) {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8'));
      email = payload.email || '';
    }
  } catch (e) { /* email é só cosmético */ }

  await db.collection('google_tokens').doc(auth.uid).set({
    refreshToken: tokens.refresh_token,
    email,
    connectedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, email };
});

exports.desconectarGoogleAgenda = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  await db.collection('google_tokens').doc(auth.uid).delete();
  return { ok: true };
});

exports.statusGoogleAgenda = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const snap = await db.collection('google_tokens').doc(auth.uid).get();
  if (!snap.exists) return { conectado: false, email: '' };
  return { conectado: true, email: snap.data().email || '' };
});

// ─── Agenda / Eventos ────────────────────────────────────────────────────────
// Admin pode criar pra outras pessoas (ou "todos"); usuário comum só pra si.
exports.criarEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const ehAdmin = ehAdminAuth(auth);
  const { titulo, inicio, participantes, todos, descricao, tipo, dataLocal } = req.data || {};
  if (!titulo || !inicio) throw new HttpsError('invalid-argument', 'Título e data/hora são obrigatórios.');
  const dataInicio = new Date(inicio);
  if (isNaN(dataInicio.getTime())) throw new HttpsError('invalid-argument', 'Data/hora inválida.');
  const tipoLimpo = ['evento', 'tarefa', 'lembrete'].includes(tipo) ? tipo : 'evento';

  let parts = [auth.uid];
  let paraTodos = false;
  if (ehAdmin) {
    if (todos) { paraTodos = true; parts = []; }
    else if (Array.isArray(participantes) && participantes.length) parts = participantes.slice(0, 300);
  }

  const tituloLimpo = String(titulo).slice(0, 120);
  const descricaoLimpa = descricao ? String(descricao).slice(0, 500) : '';

  const ref = await db.collection('events').add({
    titulo: tituloLimpo,
    descricao: descricaoLimpa,
    inicio: admin.firestore.Timestamp.fromDate(dataInicio),
    tipo: tipoLimpo,
    participantes: parts,
    todos: paraTodos,
    criadoPor: auth.uid,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  // Espelha no Google de quem estiver conectado (best-effort; não derruba o item).
  // Evento → Google Agenda (googleEventIds); tarefa/lembrete → Google Tarefas (googleTaskIds).
  try {
    const alvos = paraTodos ? await uidsConectados() : parts;
    const inicioISO = dataInicio.toISOString();
    const fimISO = new Date(dataInicio.getTime() + 60 * 60 * 1000).toISOString();
    // Tarefa só guarda a data — usa a data local escolhida (evita erro de fuso).
    const dueISO = (dataLocal && /^\d{4}-\d{2}-\d{2}$/.test(dataLocal))
      ? `${dataLocal}T00:00:00.000Z` : inicioISO;
    const ids = await sincronizarParaGoogle(alvos, {
      titulo: tituloLimpo, descricao: descricaoLimpa, inicioISO, fimISO, dueISO
    }, tipoLimpo);
    if (Object.keys(ids).length) {
      const campo = (tipoLimpo === 'evento') ? 'googleEventIds' : 'googleTaskIds';
      await ref.update({ [campo]: ids });
    }
  } catch (e) {
    console.warn('Sync Google (criarEvento) falhou:', e.message);
  }

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
        tipo: x.tipo || 'evento',
        todos: !!x.todos,
        souDono: x.criadoPor === auth.uid,
        // id do item no Google (pra Fase 2 não trazer ele de volta duplicado)
        googleId: (x.googleEventIds && x.googleEventIds[auth.uid]) ||
                  (x.googleTaskIds && x.googleTaskIds[auth.uid]) || null
      });
    }
  });
  return lista;
});

// ─── Fase 2: lê os itens criados DIRETO no Google (Agenda + Tarefas) ──────────
// Best-effort: se algo falhar, devolve o que conseguiu (não quebra a agenda do Hub).
exports.listarGoogleAgenda = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { de, ate } = req.data || {};
  const tokSnap = await db.collection('google_tokens').doc(auth.uid).get();
  if (!tokSnap.exists || !tokSnap.data().refreshToken) return { itens: [] };

  let accessToken;
  try { accessToken = await getAccessToken(tokSnap.data().refreshToken); }
  catch (e) { console.warn('listarGoogleAgenda token:', e.message); return { itens: [] }; }

  const timeMin = de ? new Date(de).toISOString() : new Date().toISOString();
  const timeMax = ate ? new Date(ate).toISOString() : new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString();
  const itens = [];

  // Eventos da Agenda
  try {
    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
      + `?singleEvents=true&orderBy=startTime&maxResults=250`
      + `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && Array.isArray(data.items)) {
      data.items.forEach(ev => {
        if (ev.status === 'cancelled' || !ev.start) return;
        // Evento com hora → usa a hora; dia inteiro (date) → meio-dia UTC (evita erro de fuso).
        const inicioISO = ev.start.dateTime
          ? new Date(ev.start.dateTime).toISOString()
          : (ev.start.date ? ev.start.date + 'T12:00:00.000Z' : null);
        if (!inicioISO) return;
        itens.push({ googleId: ev.id, titulo: ev.summary || '(sem título)', descricao: ev.description || '', inicio: inicioISO, tipo: 'evento' });
      });
    }
  } catch (e) { console.warn('listarGoogleAgenda eventos:', e.message); }

  // Tarefas (Google Tarefas) — só as com data, dentro do período.
  try {
    const resp = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=100', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && Array.isArray(data.items)) {
      const minMs = new Date(timeMin).getTime();
      const maxMs = new Date(timeMax).getTime();
      data.items.forEach(t => {
        if (!t.due) return;
        const inicioISO = t.due.slice(0, 10) + 'T12:00:00.000Z'; // só a data importa
        const ms = new Date(inicioISO).getTime();
        if (ms < minMs || ms > maxMs) return;
        itens.push({ googleId: t.id, titulo: t.title || '(sem título)', descricao: t.notes || '', inicio: inicioISO, tipo: 'tarefa' });
      });
    }
  } catch (e) { console.warn('listarGoogleAgenda tarefas:', e.message); }

  return { itens };
});

exports.excluirEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  const ref = db.collection('events').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  const dados = snap.data();
  if (dados.criadoPor !== auth.uid && !ehAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Só quem criou (ou admin) pode excluir.');
  }

  // Remove do Google onde foi espelhado (best-effort): eventos da Agenda, tarefas das Tarefas.
  const remover = async (mapa, ehTarefa) => {
    if (!mapa) return;
    for (const [uid, gid] of Object.entries(mapa)) {
      try {
        const tokSnap = await db.collection('google_tokens').doc(uid).get();
        if (!tokSnap.exists || !tokSnap.data().refreshToken) continue;
        const accessToken = await getAccessToken(tokSnap.data().refreshToken);
        if (ehTarefa) await removerTarefaGoogle(accessToken, gid);
        else await removerEventoGoogle(accessToken, gid);
      } catch (e) {
        console.warn(`Remover Google (excluirEvento) falhou p/ ${uid}:`, e.message);
      }
    }
  };
  await remover(dados.googleEventIds, false);
  await remover(dados.googleTaskIds, true);

  await ref.delete();
  return { ok: true };
});

// (admin) Lista pessoas pra escolher participantes de uma reunião
exports.listarPessoas = onCall(async (req) => {
  await exigirAdmin(req);
  const result = await admin.auth().listUsers(1000);
  return result.users.map(u => ({ uid: u.uid, nome: u.displayName || u.email || u.uid }));
});

// ─── Avisos / Notificações (admin → pessoas, com confirmação obrigatória) ─────
exports.criarNotificacao = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { mensagem, titulo, participantes, todos } = req.data || {};
  if (!mensagem || !String(mensagem).trim()) throw new HttpsError('invalid-argument', 'A mensagem é obrigatória.');

  let parts = [];
  let paraTodos = false;
  if (todos) paraTodos = true;
  else if (Array.isArray(participantes) && participantes.length) parts = participantes.slice(0, 300);
  else throw new HttpsError('invalid-argument', 'Escolha "todos" ou pelo menos uma pessoa.');

  const ref = await db.collection('notifications').add({
    titulo: titulo ? String(titulo).slice(0, 120) : '',
    mensagem: String(mensagem).slice(0, 1000),
    todos: paraTodos,
    destinatarios: parts,
    criadoPor: auth.uid,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    lidoPor: []
  });
  return { ok: true, id: ref.id };
});

// Avisos que o usuário atual AINDA não confirmou (mostra como popup ao abrir o app).
exports.listarMinhasNotificacoes = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const snap = await db.collection('notifications').orderBy('criadoEm', 'asc').get();
  const lista = [];
  snap.forEach(d => {
    const x = d.data();
    if (x.criadoPor === auth.uid) return; // quem enviou não recebe o próprio aviso
    const ehAlvo = x.todos === true || (Array.isArray(x.destinatarios) && x.destinatarios.includes(auth.uid));
    const jaLeu = Array.isArray(x.lidoPor) && x.lidoPor.includes(auth.uid);
    if (ehAlvo && !jaLeu) {
      lista.push({
        id: d.id,
        titulo: x.titulo || '',
        mensagem: x.mensagem || '',
        criadoEm: x.criadoEm ? x.criadoEm.toDate().toISOString() : null
      });
    }
  });
  return lista;
});

// Marca um aviso como visto (a pessoa clicou em "Vi").
exports.marcarNotificacaoLida = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  await db.collection('notifications').doc(id).update({
    lidoPor: admin.firestore.FieldValue.arrayUnion(auth.uid)
  });
  return { ok: true };
});

// (admin) Avisos enviados + quantos confirmaram.
exports.listarNotificacoesAdmin = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('notifications').orderBy('criadoEm', 'desc').get();
  let totalUsuarios = 0;
  try { totalUsuarios = (await admin.auth().listUsers(1000)).users.length; } catch (e) {}
  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      titulo: x.titulo || '',
      mensagem: x.mensagem || '',
      todos: !!x.todos,
      confirmaram: Array.isArray(x.lidoPor) ? x.lidoPor.length : 0,
      alvo: x.todos ? totalUsuarios : (Array.isArray(x.destinatarios) ? x.destinatarios.length : 0),
      criadoEm: x.criadoEm ? x.criadoEm.toDate().toISOString() : null
    };
  });
});

exports.excluirNotificacao = onCall(async (req) => {
  await exigirAdmin(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  await db.collection('notifications').doc(id).delete();
  return { ok: true };
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
