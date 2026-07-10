const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const https = require('https');
// pdfkit carregado sob demanda (lazy) dentro de gerarPdfFicha
// para não afetar o startup das outras Cloud Functions

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.firestore();

// ─── Cofre: criptografia de senhas em repouso (KMS) ─────────────────────────
// Todas as senhas das plataformas (REMAX Mais, ClickSign etc) ficam
// criptografadas no Firestore com uma chave simétrica no Google Cloud KMS.
// A chave nunca sai do KMS: a Cloud Function pede pra criptografar/decriptar
// via API. Se o banco vazar, as senhas continuam ilegíveis.
const { KeyManagementServiceClient } = require('@google-cloud/kms');
let _kmsClient = null;
const KMS_KEY_NAME = 'projects/remax-smart-hub/locations/southamerica-east1/keyRings/hub-cofre/cryptoKeys/credenciais';
function kmsClient() {
  if (!_kmsClient) _kmsClient = new KeyManagementServiceClient();
  return _kmsClient;
}
async function kmsEncrypt(plaintext) {
  if (!plaintext) return null;
  const [r] = await kmsClient().encrypt({ name: KMS_KEY_NAME, plaintext: Buffer.from(plaintext, 'utf8') });
  return r.ciphertext.toString('base64');
}
async function kmsDecrypt(cipherB64) {
  if (!cipherB64) return '';
  const [r] = await kmsClient().decrypt({ name: KMS_KEY_NAME, ciphertext: Buffer.from(cipherB64, 'base64') });
  return r.plaintext.toString('utf8');
}

// ─── Monitoramento: log de erros no Firestore ──────────────────────────────
async function logErro(funcao, erro, contexto = {}) {
  try {
    await db.collection('_erros').add({
      funcao,
      mensagem: erro.message || String(erro),
      contexto,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (_) { /* fallback: Cloud Logging via console.error */ }
  console.error(`[ERRO][${funcao}]`, erro.message || erro, contexto);
}

// ─── Auditoria: log de ações sensíveis no Firestore ─────────────────────────
// Grava eventos importantes (viu credencial, mudou permissão, excluiu recurso)
// pra rastreabilidade + LGPD. Nunca lança erro — falha silenciosa preserva o fluxo.
async function registrarAudit(auth, acao, alvo, detalhes = {}) {
  try {
    const ator = auth ? {
      uid: auth.uid,
      nome: auth.token?.name || '',
      email: auth.token?.email || ''
    } : { uid: null, nome: 'sistema', email: '' };
    await db.collection('audit_log').add({
      acao,                                                 // ex: 'viu_credencial'
      alvo: alvo || null,                                   // ex: { tipo:'credencial', id:'clicksign' }
      detalhes: detalhes || {},                             // extras livres (não guardar senha)
      ator,
      em: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('[AUDIT_FAIL]', acao, e.message);
  }
}

// ─── Google Agenda (OAuth + sincronização) ──────────────────────────────────
// A chave secreta do cliente OAuth fica no cofre (Secret Manager), NUNCA no código.
const { defineSecret } = require('firebase-functions/params');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
// Senha de app (Google Workspace) da conta que envia/recebe os chamados de suporte.
const SUPPORT_EMAIL_PASS = defineSecret('SUPPORT_EMAIL_PASS');
const SUPORTE_EMAIL = 'nathangabriel@remax.com.br'; // remetente + destino dos chamados
const FICHAS_ADMIN_EMAIL = 'marcelogutierres@remax.com.br'; // recebe aviso quando ficha é enviada ao admin
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

// Verifica se o usuário tem a permissão "drives fotografia" (nem todo admin tem — é explícita)
async function temPermissaoFotografia(auth) {
  if (!auth) return false;
  const snap = await db.collection('user_access').doc(auth.uid).get();
  return !!(snap.exists && snap.data().drives_fotografia);
}

async function temPermissaoTI(auth) {
  if (!auth) return false;
  const snap = await db.collection('user_access').doc(auth.uid).get();
  return !!(snap.exists && snap.data().ti);
}

async function temPermissaoMarketing(auth) {
  if (!auth) return false;
  const snap = await db.collection('user_access').doc(auth.uid).get();
  return !!(snap.exists && snap.data().marketing_gerenciar);
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

// ─── Modo Cofre — proteção anti-dump de credenciais (flag em config/seguranca) ─
// DESLIGADO por padrão (cofreAtivo=false): a getCredentials se comporta exatamente
// como antes e o autologin fica intacto. LIGADO: bloqueia quem tenta baixar muitas
// credenciais em pouco tempo (script-dump), sem atrapalhar o uso normal (1-2 apps).
// Não toca no fluxo do autologin (nem Alude, nem ClickSign) — é só um guarda no servidor.
let _cfgSegCache = { at: 0, val: null };
async function lerConfigSeguranca() {
  const agora = Date.now();
  if (_cfgSegCache.val && agora - _cfgSegCache.at < 60000) return _cfgSegCache.val;
  let val = { cofreAtivo: false, maxJanela: 8, janelaSeg: 120 };
  try {
    const snap = await db.collection('config').doc('seguranca').get();
    if (snap.exists) val = { ...val, ...snap.data() };
  } catch (_) { /* na dúvida, mantém o padrão desligado */ }
  _cfgSegCache = { at: agora, val };
  return val;
}
// Guarda anti-dump. Só age com cofreAtivo=true; admin isento. NUNCA lança por erro
// interno (transação/rede) — só lança o bloqueio proposital — pra não derrubar o autologin.
async function guardCofre(auth, siteKey) {
  let cfg;
  try { cfg = await lerConfigSeguranca(); } catch (_) { return; }
  if (!cfg.cofreAtivo) return;
  if (ehAdminAuth(auth)) return;
  const janelaMs = (cfg.janelaSeg || 120) * 1000;
  const max = cfg.maxJanela || 8;
  const ref = db.collection('cred_acessos').doc(auth.uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const agora = Date.now();
      const antigos = (snap.exists && Array.isArray(snap.data().eventos)) ? snap.data().eventos : [];
      const eventos = antigos.filter(e => e && (agora - e.t) < janelaMs);
      eventos.push({ s: siteKey, t: agora });
      const distintos = new Set(eventos.map(e => e.s));
      tx.set(ref, { eventos: eventos.slice(-50), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (distintos.size > max) {
        throw new HttpsError('resource-exhausted', 'Muitas credenciais solicitadas em pouco tempo. Aguarde alguns minutos e tente de novo.');
      }
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;  // bloqueio proposital
    /* erro interno não bloqueia o autologin */
  }
}

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

  // Modo Cofre (anti-dump). Inerte enquanto a flag está desligada.
  await guardCofre(auth, siteKey);

  const snap = await db.collection('credentials').doc(siteKey).get();
  if (!snap.exists) throw new HttpsError('not-found', `Sem credenciais para ${siteKey}.`);

  const d = snap.data();
  let password = '';
  if (d.password_enc) {
    // Formato novo (criptografado). Decripta on-the-fly.
    try { password = await kmsDecrypt(d.password_enc); }
    catch (e) { await logErro('getCredentials.decrypt', e, { siteKey }); throw new HttpsError('internal', 'Falha ao decriptar credencial.'); }
  } else if (d.password) {
    // Formato antigo (texto puro). Devolve como está e migra em background.
    password = d.password;
    try {
      const enc = await kmsEncrypt(password);
      await snap.ref.set({ password_enc: enc, password: admin.firestore.FieldValue.delete(), migratedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { await logErro('getCredentials.migrate', e, { siteKey }); }
  }
  await registrarAudit(auth, 'viu_credencial', { tipo: 'credencial', id: siteKey });
  return { login: d.login || '', password };
});

// (admin) Liga/desliga o Modo Cofre e ajusta o limite. Grava em config/seguranca.
exports.setModoCofre = onCall(async (req) => {
  await exigirAdmin(req);
  const { ativo, maxJanela, janelaSeg } = req.data || {};
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.auth.uid };
  if (typeof ativo === 'boolean') patch.cofreAtivo = ativo;
  if (Number.isFinite(maxJanela)) patch.maxJanela = Math.max(1, Math.floor(maxJanela));
  if (Number.isFinite(janelaSeg)) patch.janelaSeg = Math.max(10, Math.floor(janelaSeg));
  await db.collection('config').doc('seguranca').set(patch, { merge: true });
  _cfgSegCache = { at: 0, val: null }; // invalida o cache local (outras instâncias expiram em 60s)
  return { ok: true };
});

// (admin) Lê o estado atual do Modo Cofre.
exports.getModoCofre = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('config').doc('seguranca').get();
  const d = snap.exists ? snap.data() : {};
  return { cofreAtivo: !!d.cofreAtivo, maxJanela: d.maxJanela || 8, janelaSeg: d.janelaSeg || 120 };
});

// Apps restritos que o usuário ATUAL pode ver (admin vê todos)
exports.getMinhasPermissoes = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const snap = await db.collection('user_access').doc(auth.uid).get();
  const dados = snap.exists ? snap.data() : {};
  const drives_fotografia = !!dados.drives_fotografia;
  const loc_beta = !!dados.loc_beta;   // acesso de teste ao módulo de Locações (feature flag)
  const loc_gestao = !!dados.loc_gestao; // vê as abas de gestão de Locações (Painel/Imóveis/Financeiro/Alertas/Relatórios). NÃO herda de admin.
  const ti = !!dados.ti;
  const marketing_gerenciar = !!dados.marketing_gerenciar;
  const relSnap = await db.collection('config').doc('release').get();
  const locacoesPublicadaEm = (relSnap.exists && relSnap.data().locacoesPublicadaEm) || ''; // versão liberada p/ todos
  if (ehAdminAuth(auth)) return { apps: RESTRICTED_APPS, isAdmin: true, drives_fotografia, loc_beta, loc_gestao, locacoesPublicadaEm, ti, marketing_gerenciar };
  const apps = dados.apps || [];
  return { apps, isAdmin: false, drives_fotografia, loc_beta, loc_gestao, locacoesPublicadaEm, ti, marketing_gerenciar };
});

// (admin) Publica a versão atual da Gestão de Locações pra TODOS (ou volta pra teste com versao='').
exports.publicarLocacoes = onCall(async (req) => {
  await exigirAdmin(req);
  const { versao } = req.data || {};
  await db.collection('config').doc('release').set({
    locacoesPublicadaEm: typeof versao === 'string' ? versao : '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: req.auth.uid
  }, { merge: true });
  return { ok: true };
});

// (admin) Lê os apps restritos liberados pra um usuário + lista de restritos disponíveis
exports.getUserAccess = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const userRec = await admin.auth().getUser(uid).catch(() => null);
  const alvoAdmin = !!(userRec && userRec.customClaims && userRec.customClaims.admin) || ehBootstrapAdmin(uid);
  const snap = await db.collection('user_access').doc(uid).get();
  const dados = snap.exists ? snap.data() : {};
  const perfilSnap = await db.collection('loc_perfis').doc(uid).get();
  return {
    apps: dados.apps || [],
    restritos: RESTRICTED_APPS,
    isAdmin: alvoAdmin,
    drives_fotografia: !!dados.drives_fotografia,
    loc_beta: !!dados.loc_beta,
    loc_gestao: !!dados.loc_gestao,
    ti: !!dados.ti,
    marketing_gerenciar: !!dados.marketing_gerenciar,
    loc_role: (userRec && userRec.customClaims && userRec.customClaims.locRole) || 'corretor',
    loc_financeiro: !!(perfilSnap.exists && perfilSnap.data().financeiro)
  };
});

// (admin) Define quais apps restritos um usuário pode ver + o perfil de Locação
exports.setUserAccess = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid, apps, drives_fotografia, loc_beta, loc_gestao, loc_role, loc_financeiro, ti, marketing_gerenciar } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const limpos = Array.isArray(apps) ? apps.filter(a => RESTRICTED_APPS.includes(a)) : [];
  await db.collection('user_access').doc(uid).set({
    apps: limpos,
    drives_fotografia: !!drives_fotografia,
    loc_beta: !!loc_beta,
    loc_gestao: !!loc_gestao,
    ti: !!ti,
    marketing_gerenciar: !!marketing_gerenciar,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  // Perfil de Locação (opcional): grava na claim locRole (autoridade) + loc_perfis p/ Financeiro.
  if (loc_role !== undefined) {
    const role = LOC_ROLES.includes(loc_role) ? loc_role : 'corretor';
    const userRec = await admin.auth().getUser(uid).catch(() => null);
    if (!userRec) throw new HttpsError('not-found', 'Usuário não encontrado.');
    const claims = { ...(userRec.customClaims || {}) };
    if (role === 'corretor') delete claims.locRole; else claims.locRole = role;   // preserva claim admin
    await admin.auth().setCustomUserClaims(uid, claims);
    await db.collection('loc_perfis').doc(uid).set({
      role, financeiro: role === 'corretor' ? false : !!loc_financeiro,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await registrarAudit(req.auth, 'alterou_permissoes', { tipo: 'usuario', id: uid },
    { apps: limpos, drives_fotografia: !!drives_fotografia, loc_beta: !!loc_beta, loc_gestao: !!loc_gestao, ti: !!ti, marketing_gerenciar: !!marketing_gerenciar, loc_role: loc_role ?? null, loc_financeiro: !!loc_financeiro });
  return { ok: true };
});

// ─── Gestão de Locações · Perfis de acesso ──────────────────────────────────
// Modelo HÍBRIDO: o PERFIL (gestor/administrativo/corretor) mora numa custom claim
// `locRole` — seguro e barato de checar nas regras do Firestore. A liberação da aba
// FINANCEIRO mora num doc `loc_perfis/{uid}` que o gestor liga/desliga na hora (sem
// exigir relogin). "corretor" é o PADRÃO: todo usuário logado sem a claim já é corretor.
const LOC_ROLES = ['gestor', 'administrativo', 'corretor'];

// É gestor? A claim locRole manda (concedida pelo admin no painel de Permissões);
// o bootstrap admin entra como gestor de largada.
function ehGestorAuth(auth) {
  return !!(auth && ((auth.token && auth.token.locRole === 'gestor') || ehBootstrapAdmin(auth.uid)));
}
async function exigirGestor(req) {
  const auth = exigirAutenticado(req);
  if (ehGestorAuth(auth)) return auth;
  throw new HttpsError('permission-denied', 'Apenas o gestor de locações pode fazer isso.');
}

// Bootstrap: o admin inicial do Hub vira o 1º gestor de locações (chama 1 vez).
exports.locBootstrapGestor = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehBootstrapAdmin(auth.uid)) {
    throw new HttpsError('permission-denied', 'Só o admin inicial pode virar o primeiro gestor.');
  }
  const userRec = await admin.auth().getUser(auth.uid);
  // Merge das claims pra preservar a claim `admin` do Hub
  await admin.auth().setCustomUserClaims(auth.uid, { ...(userRec.customClaims || {}), locRole: 'gestor' });
  await db.collection('loc_perfis').doc(auth.uid).set({
    role: 'gestor', financeiro: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: auth.uid
  }, { merge: true });
  return { ok: true, mensagem: 'Você agora é gestor de locações. Faça logout/login pra atualizar o token.' };
});

// (gestor) Define o perfil de alguém e libera/tira a aba Financeiro.
// A claim `locRole` é a AUTORIDADE (as regras leem dela); o doc guarda o `financeiro`
// e espelha o `role` só pra facilitar a listagem na futura tela de admin.
exports.locDefinirPerfil = onCall(async (req) => {
  const gestor = await exigirGestor(req);
  const { uid, role, financeiro } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  if (!LOC_ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Perfil inválido.');

  const userRec = await admin.auth().getUser(uid).catch(() => null);
  if (!userRec) throw new HttpsError('not-found', 'Usuário não encontrado.');

  // Merge das claims pra NÃO apagar outras (ex.: a claim `admin` do Hub).
  const claims = { ...(userRec.customClaims || {}) };
  if (role === 'corretor') delete claims.locRole;   // corretor = padrão, sem claim
  else claims.locRole = role;
  await admin.auth().setCustomUserClaims(uid, claims);

  const fin = role === 'corretor' ? false : !!financeiro;   // corretor nunca tem Financeiro
  await db.collection('loc_perfis').doc(uid).set({
    role, financeiro: fin,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: gestor.uid
  }, { merge: true });

  return { ok: true, aviso: 'A pessoa precisa deslogar/logar pra a mudança de perfil valer.' };
});

// (qualquer autenticado) Retorna o próprio perfil — a UI usa pra decidir o que mostrar.
exports.locMeuPerfil = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const role = ehGestorAuth(auth) ? 'gestor'
             : (auth.token && auth.token.locRole === 'administrativo' ? 'administrativo' : 'corretor');
  const snap = await db.collection('loc_perfis').doc(auth.uid).get();
  const financeiro = role !== 'corretor' && !!(snap.exists && snap.data().financeiro);
  return { role, financeiro };
});

// (gestor) Lista os usuários do Hub com seus perfis de locação (pra tela de admin).
exports.locListarPessoasPerfis = onCall(async (req) => {
  await exigirGestor(req);
  const [result, perfisSnap] = await Promise.all([
    admin.auth().listUsers(1000),
    db.collection('loc_perfis').get()
  ]);
  const perfis = {};
  perfisSnap.forEach(d => { perfis[d.id] = d.data(); });
  const usuarios = result.users.map(u => ({
    uid: u.uid, nome: u.displayName || '', email: u.email || '',
    role: (u.customClaims && u.customClaims.locRole) || 'corretor',
    financeiro: !!(perfis[u.uid] && perfis[u.uid].financeiro)
  }));
  return { usuarios };
});

// ─── Gestão de Locações · Captação ──────────────────────────────────────────
// Quando o corretor aprova a ficha do locador e envia ao admin (status -> enviado_admin),
// materializamos o IMÓVEL na esteira + as PESSOAS (locadores). Idempotente: o id do
// imóvel = id da ficha (1 ficha do locador = 1 imóvel), então reenvio ATUALIZA em vez
// de duplicar e nunca reseta o status da esteira que o admin já avançou.

// Nomes de campo do locador na ficha são irregulares (loc1 usa chaves planas com
// `dataNasc`/`whatsapp`; loc2 usa prefixo `loc2_` com `nasc`/`celular`), então mapeamos
// explicitamente pra não perder dado.
const LOC_KEYS_1 = { nome:'nome', rg:'rg', cpf:'cpf', nasc:'dataNasc', civil:'estadoCivil', prof:'profissao', email:'email', whats:'whatsapp', fixo:'fixo', cep:'cep', end:'endereco', num:'numero', compl:'complemento', bairro:'bairro', cidade:'cidade', estado:'estado', conj:{ nome:'conj_nome', rg:'conj_rg', cpf:'conj_cpf', nasc:'conj_nasc', prof:'conj_profissao', regime:'conj_regime' } };
const LOC_KEYS_2 = { nome:'loc2_nome', rg:'loc2_rg', cpf:'loc2_cpf', nasc:'loc2_nasc', civil:'loc2_estadoCivil', prof:'loc2_profissao', email:'loc2_email', whats:'loc2_celular', fixo:'', cep:'loc2_cep', end:'loc2_endereco', num:'loc2_numero', compl:'loc2_complemento', bairro:'loc2_bairro', cidade:'loc2_cidade', estado:'loc2_estado', conj:{ nome:'loc2_conj_nome', rg:'loc2_conj_rg', cpf:'loc2_conj_cpf', nasc:'loc2_conj_nasc', prof:'loc2_conj_profissao', regime:'loc2_conj_regime' } };

function loc_montarPessoa(dados, keys) {
  const v = k => (k && dados[k]) ? dados[k] : '';
  const p = {
    papel: 'locador',
    nome: v(keys.nome), rg: v(keys.rg), cpf: v(keys.cpf), dataNasc: v(keys.nasc), estadoCivil: v(keys.civil),
    profissao: v(keys.prof), email: v(keys.email), whatsapp: v(keys.whats), fixo: v(keys.fixo),
    endereco: { cep: v(keys.cep), logradouro: v(keys.end), numero: v(keys.num), complemento: v(keys.compl), bairro: v(keys.bairro), cidade: v(keys.cidade), estado: v(keys.estado) },
    conjuge: null
  };
  if (keys.conj && dados[keys.conj.nome]) {
    p.conjuge = { nome: v(keys.conj.nome), rg: v(keys.conj.rg), cpf: v(keys.conj.cpf), nasc: v(keys.conj.nasc), profissao: v(keys.conj.prof), regime: v(keys.conj.regime) };
  }
  return p;
}

function loc_montarImovel(dados) {
  const v = k => dados[k] || '';
  return {
    tipo: v('im_tipo'), referencia: v('im_ref'),
    endereco: { cep: v('im_cep'), logradouro: v('im_endereco'), numero: v('im_numero'), complemento: v('im_complemento'), bairro: v('im_bairro'), cidade: v('im_cidade'), estado: v('im_estado') },
    condominio: v('im_condominio'), admCondominial: v('im_admcond'), admContato: v('im_admcontato'),
    iptu: v('im_iptu'), valorCondominio: v('im_valorcond'), contribuinteIptu: v('im_contribuinte'),
    instalacoes: { enel: v('im_enel'), sabesp: v('im_sabesp'), comgas: v('im_comgas') },
    inicioPretendido: v('im_inicio'), valorAnuncio: v('im_anuncio'), valorProposta: v('im_proposta'),
    repasse: {
      titular1: { banco: v('fin1_banco'), agencia: v('fin1_agencia'), conta: v('fin1_conta'), favorecido: v('fin1_favorecido'), pix: v('fin1_pix') },
      titular2: { banco: v('fin2_banco'), agencia: v('fin2_agencia'), conta: v('fin2_conta'), favorecido: v('fin2_favorecido'), pix: v('fin2_pix') }
    },
    administracao: { remaxAdministra: v('adm_resp'), taxa: v('adm_taxa'), tipoRepasse: v('repasse'), observacoes: v('outras') }
  };
}

// Contador transacional de protocolo interno dos imóveis (números sequenciais).
async function proximoNumeroProtocolo() {
  const ref = db.collection('counters').doc('imoveis');
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data().proximo || 0) : 0;
    const novo = atual + 1;
    tx.set(ref, { proximo: novo, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return novo;
  });
}

// Trigger de ingestão: ficha do locador -> imóvel + pessoas (na transição p/ enviado_admin).
exports.onFichaLocadorEnviadaAdmin = onDocumentWritten({ document: 'fichas_locador/{fichaId}' }, async (event) => {
  const after  = event.data.after?.data();
  const before = event.data.before?.data();
  if (!after || after.status !== 'enviado_admin') return;
  if (before && before.status === 'enviado_admin') return;   // já processado nesta transição
  const fichaId = event.params.fichaId;
  const dados = after.dados || {};
  const ts = () => admin.firestore.FieldValue.serverTimestamp();
  try {
    // Pessoas (locadores) — ids determinísticos p/ idempotência
    const locadorIds = [];
    const p1 = loc_montarPessoa(dados, LOC_KEYS_1);
    if (p1.nome) {
      const id1 = `${fichaId}_loc1`;
      await db.collection('pessoas').doc(id1).set({ ...p1, corretorUid: after.corretorUid, fichaId, atualizadoEm: ts() }, { merge: true });
      locadorIds.push(id1);
    }
    const id2 = `${fichaId}_loc2`;
    if (dados.loc2_nome) {
      await db.collection('pessoas').doc(id2).set({ ...loc_montarPessoa(dados, LOC_KEYS_2), corretorUid: after.corretorUid, fichaId, atualizadoEm: ts() }, { merge: true });
      locadorIds.push(id2);
    } else {
      // Se o 2º locador foi removido numa reedição, apaga o doc órfão (LGPD).
      await db.collection('pessoas').doc(id2).delete().catch(() => {});
    }
    // Imóvel — id = fichaId
    const imovelRef = db.collection('imoveis').doc(fichaId);
    const existente = await imovelRef.get();
    const base = {
      ...loc_montarImovel(dados),
      corretorUid: after.corretorUid, corretorNome: after.corretorNome || '',
      fichaId, fichaTipo: 'locador', locadorIds, locadorNome: p1.nome || '',
      documentos: after.documentos || {}, pendentes: after.pendentes || [],
      atualizadoEm: ts()
    };
    if (existente.exists) {
      await imovelRef.set(base, { merge: true });          // preserva status + criadoEm + numeroProtocolo
    } else {
      const numeroProtocolo = await proximoNumeroProtocolo();
      await imovelRef.set({ ...base, status: 'recebido', numeroProtocolo, criadoEm: ts() });
    }
  } catch (e) {
    await logErro('onFichaLocadorEnviadaAdmin', e, { fichaId });
  }
});

// (autenticado) Lista imóveis: corretor vê só os seus; gestor/administrativo veem todos.
exports.locListarImoveis = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const role = ehGestorAuth(auth) ? 'gestor'
             : (auth.token && auth.token.locRole === 'administrativo' ? 'administrativo' : 'corretor');
  const veTudo = role === 'gestor' || role === 'administrativo';
  let q = db.collection('imoveis');
  if (!veTudo) q = q.where('corretorUid', '==', auth.uid);
  const snap = await q.get();
  // Backfill de numeroProtocolo em imóveis antigos (ordenados por criadoEm p/ manter ordem cronológica).
  const semNumero = snap.docs.filter(d => d.data().numeroProtocolo == null)
    .sort((a, b) => {
      const ta = a.data().criadoEm?.toMillis?.() || 0;
      const tb = b.data().criadoEm?.toMillis?.() || 0;
      return ta - tb;
    });
  for (const d of semNumero) {
    const n = await proximoNumeroProtocolo();
    await d.ref.set({ numeroProtocolo: n }, { merge: true });
  }
  const finalSnap = semNumero.length ? await q.get() : snap;
  const imoveis = finalSnap.docs.map(d => ({
    id: d.id, ...d.data(),
    criadoEm: d.data().criadoEm?.toDate?.()?.toISOString() || null,
    atualizadoEm: d.data().atualizadoEm?.toDate?.()?.toISOString() || null
  }));
  return { imoveis, veTudo, role };
});

exports.locListarFichasImovel = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const imSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const im = imSnap.data();
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && im.corretorUid !== auth.uid) throw new HttpsError('permission-denied', 'Sem acesso.');
  const snap = await db.collection('fichas').where('imovelId', '==', imovelId).get();
  const fichas = snap.docs.map(d => {
    const f = d.data();
    return { id: d.id, tipo: f.tipo, status: f.status, dados: { nome: f.dados?.nome || '' }, corretorNome: f.corretorNome || '', criadoEm: f.criadoEm?.toDate?.()?.toISOString() || null };
  });
  return fichas;
});

// (autenticado, com posse) Detalhe de um imóvel + seus locadores (coleção pessoas).
// Reúne o que a esteira precisa pra revisar antes de aprovar. Respeita a regra de ouro:
// gestor/administrativo veem qualquer um; corretor só os seus (corretorUid).
exports.locObterImovel = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');

  const snap = await db.collection('imoveis').doc(imovelId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const imovel = snap.data();

  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && imovel.corretorUid !== auth.uid) {
    throw new HttpsError('permission-denied', 'Sem acesso a este imóvel.');
  }

  // Locadores (pessoas ligadas ao imóvel)
  const locadores = [];
  for (const pid of (imovel.locadorIds || [])) {
    const p = await db.collection('pessoas').doc(pid).get();
    if (p.exists) locadores.push({ id: p.id, ...p.data(), atualizadoEm: p.data().atualizadoEm?.toDate?.()?.toISOString() || null });
  }

  // Locatários (candidatos) + análise. Só locatários têm imovelId (campo único, sem índice composto).
  const locSnap = await db.collection('pessoas').where('imovelId', '==', imovelId).get();
  const locatarios = locSnap.docs.filter(d => d.data().papel === 'locatario').map(d => {
    const dd = d.data();
    return { id: d.id, ...dd, analise: dd.analise ? { ...dd.analise, em: dd.analise.em?.toDate?.()?.toISOString() || null } : null };
  });

  // Garantia (1 por imóvel)
  const gSnap = await db.collection('garantias').doc(imovelId).get();
  const garantia = gSnap.exists ? { ...gSnap.data(), atualizadoEm: gSnap.data().atualizadoEm?.toDate?.()?.toISOString() || null } : null;

  // Contrato (1 por imóvel)
  const cSnap = await db.collection('contratos').doc(imovelId).get();
  const contrato = cSnap.exists ? {
    id: cSnap.id, ...cSnap.data(),
    criadoEm: cSnap.data().criadoEm?.toDate?.()?.toISOString() || null,
    ativadoEm: cSnap.data().ativadoEm?.toDate?.()?.toISOString() || null,
    atualizadoEm: cSnap.data().atualizadoEm?.toDate?.()?.toISOString() || null
  } : null;
  const podeContratar = (await locImovelPodeContratar(imovelId)).ok;

  // Vistorias do imóvel
  const vSnap = await db.collection('vistorias').where('imovelId', '==', imovelId).get();
  const vistorias = vSnap.docs.map(v => ({ id: v.id, ...v.data(), atualizadoEm: v.data().atualizadoEm?.toDate?.()?.toISOString() || null }));

  const historico = (imovel.historico || []).map(h => ({
    ...h, em: h.em?.toDate?.()?.toISOString() || null
  }));

  return {
    imovel: {
      id: snap.id, ...imovel,
      criadoEm: imovel.criadoEm?.toDate?.()?.toISOString() || null,
      atualizadoEm: imovel.atualizadoEm?.toDate?.()?.toISOString() || null,
      historico
    },
    locadores, locatarios, garantia, contrato, podeContratar, vistorias
  };
});

// (GESTOR) Exclui um imóvel e TUDO que está vinculado (cascata). Irreversível.
// Não apaga a ficha de origem (fica no Cadastro) — só os registros de locação.
exports.locExcluirImovel = onCall(async (req) => {
  await exigirGestor(req);
  const { imovelId } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');

  // Vinculados: locadores (pessoas.fichaId), locatários (pessoas.imovelId),
  // cobranças/repasses (contratoId==imovelId), vistorias (imovelId).
  const [pessLoc, pessLoct, cobr, rep, vist] = await Promise.all([
    db.collection('pessoas').where('fichaId', '==', imovelId).get(),
    db.collection('pessoas').where('imovelId', '==', imovelId).get(),
    db.collection('cobrancas').where('contratoId', '==', imovelId).get(),
    db.collection('repasses').where('contratoId', '==', imovelId).get(),
    db.collection('vistorias').where('imovelId', '==', imovelId).get()
  ]);
  const batch = db.batch();
  [pessLoc, pessLoct, cobr, rep, vist].forEach(s => s.docs.forEach(d => batch.delete(d.ref)));
  batch.delete(db.collection('garantias').doc(imovelId));
  batch.delete(db.collection('contratos').doc(imovelId));
  batch.delete(db.collection('imoveis').doc(imovelId));
  await batch.commit();
  const im = imovelSnap.data();
  await registrarAudit(req.auth, 'excluiu_imovel', { tipo: 'imovel', id: imovelId },
    { locadorNome: im.locadorNome || '', endereco: im.endereco || null });
  return { ok: true };
});

// (gestor/administrativo) Move um imóvel pela esteira, com trilha de auditoria.
// Regra da spec: recepção/triagem (recebido<->em_analise) o administrativo pode;
// decisões (aprovado) e contrato (em_contrato/ativo) são EXCLUSIVAS do gestor.
const IMOVEL_STATUS_VALIDOS = ['recebido', 'em_analise', 'aprovado', 'em_contrato', 'ativo'];
const IMOVEL_STATUS_SO_GESTOR = ['aprovado', 'em_contrato', 'ativo'];

// Helper: um imóvel só pode ir pra contrato com ≥1 locatário aprovado E garantia aprovada.
async function locImovelPodeContratar(imovelId) {
  const gSnap = await db.collection('garantias').doc(imovelId).get();
  const garantiaOk = gSnap.exists && gSnap.data().status === 'aprovada';
  // Só locatários têm o campo imovelId (índice de campo único, sem composto); filtra o papel em memória.
  const locSnap = await db.collection('pessoas').where('imovelId', '==', imovelId).get();
  const analiseOk = locSnap.docs.some(d => d.data().papel === 'locatario' && (d.data().analise || {}).status === 'aprovado');
  return { ok: garantiaOk && analiseOk, garantiaOk, analiseOk };
}

exports.locMoverImovelStatus = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehGestor = ehGestorAuth(auth);
  const ehAdm = auth.token && auth.token.locRole === 'administrativo';
  if (!ehGestor && !ehAdm) throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo movem imóveis.');

  const { imovelId, novoStatus } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  if (!IMOVEL_STATUS_VALIDOS.includes(novoStatus)) throw new HttpsError('invalid-argument', 'Status inválido.');
  if (IMOVEL_STATUS_SO_GESTOR.includes(novoStatus) && !ehGestor) {
    throw new HttpsError('permission-denied', 'Só o gestor pode aprovar ou mandar pra contrato.');
  }

  const ref = db.collection('imoveis').doc(imovelId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const atual = snap.data().status || 'recebido';
  if (atual === novoStatus) return { ok: true, status: novoStatus };

  // Máquina de estados (a esteira só faz triagem + entrada em contrato):
  // - 'ativo' NÃO é manual — só via locAtivarContrato (que valida vigência/valor e gera cobranças).
  // - imóvel já 'ativo' não volta pela esteira (deixaria contrato/cobranças órfãos).
  // - 'em_contrato' exige vir de 'aprovado' E o gate de análise + garantia.
  if (novoStatus === 'ativo') throw new HttpsError('failed-precondition', "Pra ativar, use 'Ativar contrato' no detalhe do imóvel.");
  if (atual === 'ativo') throw new HttpsError('failed-precondition', 'Imóvel ativo é controlado pelo contrato, não pela esteira.');
  if (novoStatus === 'em_contrato') {
    if (atual !== 'aprovado' && atual !== 'em_contrato') {
      throw new HttpsError('failed-precondition', 'O imóvel precisa estar "Aprovado" antes de ir pra contrato.');
    }
    const gate = await locImovelPodeContratar(imovelId);
    if (!gate.ok) {
      const falta = [!gate.analiseOk && 'análise do locatário aprovada', !gate.garantiaOk && 'garantia aprovada'].filter(Boolean).join(' e ');
      throw new HttpsError('failed-precondition', `Falta ${falta} antes de ir pra contrato.`);
    }
  }

  let porNome = '';
  try { porNome = (await admin.auth().getUser(auth.uid)).displayName || ''; } catch (_) {}

  await ref.update({
    status: novoStatus,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    historico: admin.firestore.FieldValue.arrayUnion({
      de: atual, para: novoStatus, por: auth.uid, porNome, em: admin.firestore.Timestamp.now()
    })
  });
  return { ok: true, status: novoStatus };
});

// ─── Gestão de Locações · Campos financeiros + checklist (esteira de locação) ─
const LOC_CAMPOS_EDITAVEIS = new Set([
  'valorFechamento', 'valorComissao', 'comissao1Data', 'comissao2Data',
  'possuiAdministracao', 'contratoAssinado', 'possuiParceria', 'checklist'
]);

exports.locSalvarCamposLocacao = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, campos } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  if (!campos || typeof campos !== 'object') throw new HttpsError('invalid-argument', 'Campos inválidos.');

  const ref = db.collection('imoveis').doc(imovelId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const dados = snap.data();

  const ehGestor = ehGestorAuth(auth);
  const ehAdm = auth.token && auth.token.locRole === 'administrativo';
  const ehDono = dados.corretorUid === auth.uid;
  if (!ehGestor && !ehAdm && !ehDono) throw new HttpsError('permission-denied', 'Sem permissão.');

  const update = { atualizadoEm: admin.firestore.FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(campos)) {
    if (!LOC_CAMPOS_EDITAVEIS.has(k)) continue;
    // Números viram Number; datas ficam como string YYYY-MM-DD; booleans/objetos passam direto
    if (k === 'valorFechamento' || k === 'valorComissao') {
      update[k] = v === '' || v == null ? null : Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
    } else {
      update[k] = v;
    }
  }
  await ref.update(update);
  await recomputarChecklistAuto(imovelId); // reaplica os itens automáticos por cima do save manual
  return { ok: true };
});

// ─── Gestão de Locações · Locatário + Garantia ──────────────────────────────
const LOC_ANALISE_STATUS = ['em_analise', 'pendencia', 'aprovado', 'reprovado'];
const LOC_GARANTIA_MODALIDADES = ['seguro_fianca', 'fiador', 'caucao', 'titulo_capitalizacao'];
const LOC_GARANTIA_STATUS = ['pendente', 'aprovada', 'reprovada'];

// Recomputa os itens AUTOMÁTICOS do checklist (derivados de análise/garantia/vistoria/
// contrato/imóvel ativo) e persiste em imovel.checklist, além de avançar a tag da esteira
// até "aprovado" (contrato/ativo continuam sendo passo manual/por ativação). Chamado após
// qualquer ação que mexa nesses dados. Os itens manuais do checklist são preservados.
const CHECKLIST_AUTO_KEYS = ['analise', 'seguro_fianca', 'vistoria', 'contrato', 'cadastro_sistema', 'gerar_cobranca'];
async function recomputarChecklistAuto(imovelId) {
  if (!imovelId) return;
  const [imSnap, locSnap, garSnap, ctSnap, viSnap] = await Promise.all([
    db.collection('imoveis').doc(imovelId).get(),
    db.collection('pessoas').where('imovelId', '==', imovelId).get(),
    db.collection('garantias').doc(imovelId).get(),
    db.collection('contratos').doc(imovelId).get(),
    db.collection('vistorias').where('imovelId', '==', imovelId).get()
  ]);
  if (!imSnap.exists) return;
  const im = imSnap.data();
  const locatarios = locSnap.docs.filter(d => d.data().papel === 'locatario').map(d => d.data());
  const gar = garSnap.exists ? garSnap.data() : {};
  const c = ctSnap.exists ? ctSnap.data() : {};
  const vistorias = viSnap.docs.map(d => d.data());

  const analiseOk = locatarios.some(l => (l.analise || {}).status === 'aprovado');
  const garantiaOk = gar.status === 'aprovada';                                   // status é feminino
  const seguroFiancaOk = gar.modalidade === 'seguro_fianca' && garantiaOk;
  const vistoriaOk = vistorias.some(v => v.tipo === 'entrada' && ['laudo_emitido', 'realizada'].includes(v.status));
  const contratoAtivo = c.status === 'ativo';

  const auto = {
    analise: analiseOk,
    seguro_fianca: seguroFiancaOk,
    vistoria: vistoriaOk,
    contrato: contratoAtivo || !!c.contratoDocUrl,
    cadastro_sistema: im.status === 'ativo',
    gerar_cobranca: contratoAtivo
  };
  const checklist = { ...(im.checklist || {}), ...auto };

  // Auto-tag: só avança (nunca volta), e nunca mexe em em_contrato/ativo.
  let novoStatus = im.status;
  if (im.status === 'recebido' && locatarios.length) novoStatus = 'em_analise';
  if (['recebido', 'em_analise'].includes(im.status) && analiseOk && garantiaOk) novoStatus = 'aprovado';

  const upd = { checklist, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() };
  if (novoStatus !== im.status) {
    upd.status = novoStatus;
    upd.historico = admin.firestore.FieldValue.arrayUnion({ de: im.status || '', para: novoStatus, por: 'sistema', porNome: 'automático', em: admin.firestore.Timestamp.now() });
  }
  await imSnap.ref.update(upd);
}

// (gestor/administrativo) Adiciona um locatário (candidato) a um imóvel.
// Vira uma pessoa com papel 'locatario', ligada ao imóvel, em análise.
exports.locAddLocatario = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth) && !(auth.token && auth.token.locRole === 'administrativo')) {
    throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo.');
  }
  const { imovelId, dados } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const d = dados || {};
  if (!d.nome) throw new HttpsError('invalid-argument', 'Nome do locatário é obrigatório.');

  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');

  const ref = db.collection('pessoas').doc();
  await ref.set({
    papel: 'locatario', imovelId,
    corretorUid: imovelSnap.data().corretorUid,   // herda o dono p/ a regra de ouro
    nome: d.nome, cpf: d.cpf || '', email: d.email || '', whatsapp: d.whatsapp || '',
    renda: d.renda || '', profissao: d.profissao || '', obs: d.obs || '',
    analise: { status: 'em_analise', obs: '', por: '', em: null },
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  await recomputarChecklistAuto(imovelId); // 1º locatário → esteira vai pra "em análise"
  return { ok: true, id: ref.id };
});

// (GESTOR) Registra a análise cadastral de um locatário.
exports.locAnalisarLocatario = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const { pessoaId, status, obs } = req.data || {};
  if (!pessoaId) throw new HttpsError('invalid-argument', 'pessoaId é obrigatório.');
  if (!LOC_ANALISE_STATUS.includes(status)) throw new HttpsError('invalid-argument', 'Status de análise inválido.');

  const ref = db.collection('pessoas').doc(pessoaId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().papel !== 'locatario') throw new HttpsError('not-found', 'Locatário não encontrado.');

  let porNome = '';
  try { porNome = (await admin.auth().getUser(auth.uid)).displayName || ''; } catch (_) {}
  await ref.update({
    analise: { status, obs: obs || '', por: porNome || auth.uid, em: admin.firestore.Timestamp.now() },
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  await recomputarChecklistAuto(snap.data().imovelId); // análise aprovada + garantia → "aprovado"
  return { ok: true };
});

// (gestor/admin) Adiciona/remove um documento anexado ao locatário (URL do Storage).
exports.locAddDocLocatario = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth) && !(auth.token && auth.token.locRole === 'administrativo')) {
    throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo.');
  }
  const { pessoaId, nome, url, remover } = req.data || {};
  if (!pessoaId) throw new HttpsError('invalid-argument', 'pessoaId é obrigatório.');
  const ref = db.collection('pessoas').doc(pessoaId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().papel !== 'locatario') throw new HttpsError('not-found', 'Locatário não encontrado.');
  let docs = Array.isArray(snap.data().documentos) ? snap.data().documentos : [];
  if (remover) {
    docs = docs.filter(x => x.url !== url);
  } else {
    if (!url) throw new HttpsError('invalid-argument', 'url é obrigatória.');
    docs.push({ nome: String(nome || 'Documento').slice(0, 80), url: String(url).slice(0, 600) });
  }
  await ref.update({ documentos: docs, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true };
});

// (gestor/admin) Lista fichas recebidas (PF/PJ/Locação c/ Fiador) do corretor dono
// do imóvel, pra vincular uma como locatário — reusa a ficha online que o cliente já preenche.
const LOC_FICHA_TIPOS_LOCATARIO = ['pf', 'pj', 'locacao_fiador'];
exports.locFichasParaVincular = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth) && !(auth.token && auth.token.locRole === 'administrativo')) {
    throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo.');
  }
  const { imovelId } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');

  const [fSnap, pSnap] = await Promise.all([
    db.collection('fichas').where('corretorUid', '==', imovelSnap.data().corretorUid).get(),
    db.collection('pessoas').where('imovelId', '==', imovelId).get()
  ]);
  const jaVinc = new Set();
  pSnap.forEach(p => { const f = p.data().fichaVinculadaId; if (f) jaVinc.add(f); });
  const mascCpf = c => { const s = String(c || '').replace(/\D/g, ''); return s ? '•••.' + s.slice(-5, -2) + '.' + s.slice(-2) : ''; };

  const fichas = fSnap.docs
    .filter(d => LOC_FICHA_TIPOS_LOCATARIO.includes(d.data().tipo))
    .map(d => { const x = d.data(); const dd = x.dados || {}; return { id: d.id, tipo: x.tipo, nome: dd.nome || '(sem nome)', cpf: mascCpf(dd.cpf), status: x.status || '', jaVinculada: jaVinc.has(d.id), criadoEm: x.criadoEm && x.criadoEm.toDate ? x.criadoEm.toDate().toISOString() : null }; })
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  return { fichas };
});

// (gestor/admin) Cria o locatário (pessoa) a partir de uma ficha recebida, pendente
// de análise. Espelha o fluxo do locador (ficha → pessoa). Idempotente por (imóvel, ficha).
exports.locVincularFichaLocatario = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth) && !(auth.token && auth.token.locRole === 'administrativo')) {
    throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo.');
  }
  const { imovelId, fichaId } = req.data || {};
  if (!imovelId || !fichaId) throw new HttpsError('invalid-argument', 'imovelId e fichaId são obrigatórios.');
  const [imovelSnap, fichaSnap] = await Promise.all([
    db.collection('imoveis').doc(imovelId).get(),
    db.collection('fichas').doc(fichaId).get()
  ]);
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  if (!fichaSnap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  // A ficha precisa ser do mesmo corretor do imóvel (regra de ouro).
  if (fichaSnap.data().corretorUid !== imovelSnap.data().corretorUid) {
    throw new HttpsError('permission-denied', 'A ficha não pertence ao corretor deste imóvel.');
  }
  const dd = fichaSnap.data().dados || {};
  if (!dd.nome) throw new HttpsError('failed-precondition', 'A ficha não tem nome preenchido.');

  const ref = db.collection('pessoas').doc(`${imovelId}_locficha_${fichaId}`);
  if ((await ref.get()).exists) throw new HttpsError('already-exists', 'Essa ficha já foi vinculada a este imóvel.');
  await ref.set({
    papel: 'locatario', imovelId,
    corretorUid: imovelSnap.data().corretorUid,
    nome: dd.nome, cpf: dd.cpf || '', email: dd.email || '', whatsapp: dd.whatsapp || dd.celular || '',
    renda: dd.renda || dd.rendaMensal || '', profissao: dd.profissao || '', obs: '',
    fichaVinculadaId: fichaId, fichaTipo: fichaSnap.data().tipo || '',
    analise: { status: 'em_analise', obs: '', por: '', em: null },
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  await recomputarChecklistAuto(imovelId); // vínculo do locatário → esteira "em análise"
  return { ok: true, id: ref.id };
});

// (GESTOR) Registra/atualiza a garantia de um imóvel (1 garantia ativa por imóvel).
exports.locSalvarGarantia = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const { imovelId, modalidade, status, apoliceUrl, obs } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  if (!LOC_GARANTIA_MODALIDADES.includes(modalidade)) throw new HttpsError('invalid-argument', 'Modalidade inválida.');
  if (!LOC_GARANTIA_STATUS.includes(status)) throw new HttpsError('invalid-argument', 'Status de garantia inválido.');

  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');

  await db.collection('garantias').doc(imovelId).set({
    imovelId,
    corretorUid: imovelSnap.data().corretorUid,   // regra de ouro
    modalidade, status, apoliceUrl: apoliceUrl || '', obs: obs || '',
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await recomputarChecklistAuto(imovelId); // garantia aprovada → seguro_fiança + talvez "aprovado"
  return { ok: true };
});

// ─── Gestão de Locações · Contratos ─────────────────────────────────────────
// Converte "R$ 1.500,00" / "10%" em número (pra cobranças calculáveis).
function loc_valorNum(s) {
  const n = Number(String(s == null ? '' : s).replace(/[^\d,]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

// (GESTOR) Gera o contrato (rascunho) a partir do imóvel — 1 contrato ativo por imóvel.
// Só depois de análise + garantia aprovadas (mesma regra do gate da esteira).
exports.locCriarContrato = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const { imovelId, dados } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const d = dados || {};

  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const imovel = imovelSnap.data();
  if (imovel.status === 'ativo') throw new HttpsError('failed-precondition', 'Imóvel já está ativo (contrato em vigor).');

  const gate = await locImovelPodeContratar(imovelId);
  if (!gate.ok) {
    const falta = [!gate.analiseOk && 'análise do locatário aprovada', !gate.garantiaOk && 'garantia aprovada'].filter(Boolean).join(' e ');
    throw new HttpsError('failed-precondition', `Falta ${falta} antes de gerar o contrato.`);
  }

  const ref = db.collection('contratos').doc(imovelId); // 1 contrato por imóvel
  const existente = await ref.get();
  if (existente.exists && existente.data().status === 'ativo') {
    throw new HttpsError('already-exists', 'Este imóvel já tem um contrato ativo.');
  }

  // Locatários aprovados
  const locSnap = await db.collection('pessoas').where('imovelId', '==', imovelId).get();
  const locatarioIds = locSnap.docs.filter(p => p.data().papel === 'locatario' && (p.data().analise || {}).status === 'aprovado').map(p => p.id);

  const contrato = {
    imovelId, corretorUid: imovel.corretorUid,
    locadorIds: imovel.locadorIds || [], locatarioIds, garantiaId: imovelId,
    valorAluguel: loc_valorNum(d.valorAluguel != null ? d.valorAluguel : (imovel.valorProposta || imovel.valorAnuncio)),
    valorCondominio: loc_valorNum(d.valorCondominio != null ? d.valorCondominio : imovel.valorCondominio),
    valorIptu: loc_valorNum(d.valorIptu != null ? d.valorIptu : imovel.iptu),
    taxaAdm: loc_valorNum(d.taxaAdm != null ? d.taxaAdm : (imovel.administracao || {}).taxa),
    tipoRepasse: d.tipoRepasse || (imovel.administracao || {}).tipoRepasse || '',
    indiceReajuste: d.indiceReajuste || 'IGP-M',
    diaVencimento: Math.min(28, Math.max(1, parseInt(d.diaVencimento, 10) || 10)),
    vigenciaInicio: d.vigenciaInicio || '', vigenciaFim: d.vigenciaFim || '',
    status: 'rascunho', contratoDocUrl: '',
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  };
  if (!existente.exists) contrato.criadoEm = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(contrato, { merge: true });

  // Move o imóvel pra "em_contrato" (passou o gate)
  if (imovel.status !== 'em_contrato' && imovel.status !== 'ativo') {
    await imovelSnap.ref.update({
      status: 'em_contrato', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      historico: admin.firestore.FieldValue.arrayUnion({ de: imovel.status || 'aprovado', para: 'em_contrato', por: auth.uid, porNome: 'geração de contrato', em: admin.firestore.Timestamp.now() })
    });
  }
  await recomputarChecklistAuto(imovelId);
  return { ok: true, id: ref.id };
});

// (GESTOR) Registra dados/assinatura do contrato (edita enquanto rascunho/assinatura).
exports.locAtualizarContrato = onCall(async (req) => {
  await exigirGestor(req);
  const { contratoId, dados } = req.data || {};
  if (!contratoId) throw new HttpsError('invalid-argument', 'contratoId é obrigatório.');
  const ref = db.collection('contratos').doc(contratoId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Contrato não encontrado.');
  if (snap.data().status === 'ativo') throw new HttpsError('failed-precondition', 'Contrato ativo não é editável (encerre ou renove).');

  const d = dados || {};
  const upd = { atualizadoEm: admin.firestore.FieldValue.serverTimestamp() };
  if (d.valorAluguel != null)    upd.valorAluguel = loc_valorNum(d.valorAluguel);
  if (d.valorCondominio != null) upd.valorCondominio = loc_valorNum(d.valorCondominio);
  if (d.valorIptu != null)       upd.valorIptu = loc_valorNum(d.valorIptu);
  if (d.taxaAdm != null)         upd.taxaAdm = loc_valorNum(d.taxaAdm);
  if (d.indiceReajuste != null)  upd.indiceReajuste = d.indiceReajuste;
  if (d.diaVencimento != null)   upd.diaVencimento = Math.min(28, Math.max(1, parseInt(d.diaVencimento, 10) || 10));
  if (d.vigenciaInicio != null)  upd.vigenciaInicio = d.vigenciaInicio;
  if (d.vigenciaFim != null)     upd.vigenciaFim = d.vigenciaFim;
  if (d.contratoDocUrl != null)  upd.contratoDocUrl = d.contratoDocUrl;
  if (d.status === 'assinatura') upd.status = 'assinatura';
  await ref.update(upd);
  return { ok: true };
});

// (GESTOR) Ativa o contrato → imóvel vira "ativo" e gera as cobranças do contrato.
exports.locAtivarContrato = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const { contratoId } = req.data || {};
  if (!contratoId) throw new HttpsError('invalid-argument', 'contratoId é obrigatório.');
  const ref = db.collection('contratos').doc(contratoId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Contrato não encontrado.');
  const c = snap.data();
  if (c.status === 'ativo') return { ok: true, status: 'ativo' };
  if (!c.vigenciaInicio || !c.vigenciaFim || !c.valorAluguel) {
    throw new HttpsError('failed-precondition', 'Preencha vigência e valor do aluguel antes de ativar.');
  }

  // O imóvel precisa estar "em_contrato" (ou já "ativo", num retry). Não força de estado errado.
  const imovelRef = db.collection('imoveis').doc(c.imovelId);
  const imovelSnap = await imovelRef.get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel do contrato não encontrado.');
  const statusImovel = imovelSnap.data().status;
  if (statusImovel !== 'em_contrato' && statusImovel !== 'ativo') {
    throw new HttpsError('failed-precondition', 'O imóvel precisa estar "Em contrato" pra ativar.');
  }

  // Ordem: imóvel → cobranças → contrato (marca 'ativo' por ÚLTIMO). Se algo falhar no meio,
  // o contrato NÃO fica 'ativo', então dá pra reativar e reconciliar (tudo idempotente).
  if (statusImovel === 'em_contrato') {
    await imovelRef.update({
      status: 'ativo', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      historico: admin.firestore.FieldValue.arrayUnion({ de: statusImovel, para: 'ativo', por: auth.uid, porNome: 'ativação de contrato', em: admin.firestore.Timestamp.now() })
    });
  }
  await gerarCobrancasDoContrato(c, contratoId);
  await ref.update({ status: 'ativo', ativadoEm: admin.firestore.FieldValue.serverTimestamp(), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
  await recomputarChecklistAuto(c.imovelId); // ativo → contrato/cadastro/gerar_cobrança automáticos
  return { ok: true, status: 'ativo' };
});

// (autenticado) Lista contratos: corretor vê os seus; gestor/admin veem todos.
exports.locListarContratos = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  let q = db.collection('contratos');
  if (!veTudo) q = q.where('corretorUid', '==', auth.uid);
  const snap = await q.get();
  const contratos = snap.docs.map(dc => ({
    id: dc.id, ...dc.data(),
    criadoEm: dc.data().criadoEm?.toDate?.()?.toISOString() || null,
    ativadoEm: dc.data().ativadoEm?.toDate?.()?.toISOString() || null,
    atualizadoEm: dc.data().atualizadoEm?.toDate?.()?.toISOString() || null
  }));
  return { contratos, veTudo };
});

// ─── Gestão de Locações · Cobrança + Repasse + Alertas ──────────────────────
// Permissão Financeiro: gestor sempre; administrativo só se o gestor liberar a aba
// (loc_perfis/{uid}.financeiro). Corretor nunca dá baixa (só consulta).
async function podeFinanceiro(auth) {
  if (ehGestorAuth(auth)) return true;
  if (auth.token && auth.token.locRole === 'administrativo') {
    const snap = await db.collection('loc_perfis').doc(auth.uid).get();
    return !!(snap.exists && snap.data().financeiro === true);
  }
  return false;
}
async function exigirFinanceiro(req) {
  const auth = exigirAutenticado(req);
  if (await podeFinanceiro(auth)) return auth;
  throw new HttpsError('permission-denied', 'Precisa da aba Financeiro liberada pelo gestor.');
}

// Gera as cobranças + repasses mensais da vigência do contrato (previsão).
// Ids determinísticos (contratoId_competencia) → idempotente. Ganchos pra integração bancária:
// origemStatus='manual' e idExterno='' já nascem aqui (o gateway só troca esses depois).
async function gerarCobrancasDoContrato(c, contratoId) {
  const pi = String(c.vigenciaInicio || '').split('-').map(Number);
  const pf = String(c.vigenciaFim || '').split('-').map(Number);
  if (!pi[0] || !pi[1] || !pf[0] || !pf[1]) {
    console.warn(`gerarCobrancasDoContrato: vigência inválida no contrato ${contratoId} (${c.vigenciaInicio}..${c.vigenciaFim}) — nenhuma cobrança gerada.`);
    return;
  }
  const dia = Math.min(28, Math.max(1, c.diaVencimento || 10));
  const valorAluguel = c.valorAluguel || 0, valorCond = c.valorCondominio || 0, valorIptu = c.valorIptu || 0;
  const valorCobranca = valorAluguel + valorCond + valorIptu;                 // o que o locatário paga
  // Repasse ao proprietário conforme tipoRepasse da ficha ('Somente aluguel' vs
  // 'Aluguel + condomínio + IPTU'). A taxa de administração incide sobre o aluguel.
  const incluiEncargos = /condom|iptu/i.test(String(c.tipoRepasse || ''));
  const baseRepasse = valorAluguel + (incluiEncargos ? (valorCond + valorIptu) : 0);
  const valorRepasse = Math.max(0, baseRepasse - (valorAluguel * (c.taxaAdm || 0) / 100));
  // Rateio da 2ª titular: não há % de divisão no cadastro, então gera 1 repasse ao
  // titular principal e marca revisarRateio quando há mais de um proprietário (ajuste manual).
  const locadorIds = c.locadorIds || [];
  const proprietarioId = locadorIds[0] || '';
  const revisarRateio = locadorIds.length > 1;
  const ts = admin.firestore.FieldValue.serverTimestamp();

  // Idempotência REAL: lê o que já existe e só CRIA o que falta — nunca reescreve
  // uma cobrança/repasse existente (não reseta uma baixa/repasse já registrado).
  const [exC, exR] = await Promise.all([
    db.collection('cobrancas').where('contratoId', '==', contratoId).get(),
    db.collection('repasses').where('contratoId', '==', contratoId).get()
  ]);
  const temC = new Set(exC.docs.map(d => d.id));
  const temR = new Set(exR.docs.map(d => d.id));

  const batch = db.batch();
  let y = pi[0], m = pi[1], count = 0;
  while ((y < pf[0] || (y === pf[0] && m <= pf[1])) && count < 60) {
    const competencia = `${y}-${String(m).padStart(2, '0')}`;
    const docId = `${contratoId}_${competencia}`;
    if (!temC.has(docId)) batch.set(db.collection('cobrancas').doc(docId), {
      contratoId, imovelId: c.imovelId, corretorUid: c.corretorUid, competencia,
      valor: valorCobranca, valorAluguel, valorCondominio: valorCond, valorIptu,
      vencimento: `${competencia}-${String(dia).padStart(2, '0')}`,
      status: 'previsto', dataBaixa: null, origemStatus: 'manual', idExterno: '', criadoEm: ts
    });
    if (!temR.has(docId)) batch.set(db.collection('repasses').doc(docId), {
      contratoId, imovelId: c.imovelId, corretorUid: c.corretorUid, proprietarioId, proprietarioIds: locadorIds, revisarRateio, competencia,
      valorRepasse, baseRepasse, tipoRepasse: c.tipoRepasse || '', status: 'pendente', dataRepasse: null, origemStatus: 'manual', idExterno: '', criadoEm: ts
    });
    count++; m++; if (m > 12) { m = 1; y++; }
  }
  if (count >= 60 && (y < pf[0] || (y === pf[0] && m <= pf[1]))) {
    console.warn(`gerarCobrancasDoContrato: contrato ${contratoId} tem vigência > 60 meses; geradas só as 60 primeiras competências.`);
  }
  await batch.commit();
}

// (financeiro) Baixa manual de um pagamento.
exports.locRegistrarPagamento = onCall(async (req) => {
  const auth = await exigirFinanceiro(req);
  const { cobrancaId, desfazer } = req.data || {};
  if (!cobrancaId) throw new HttpsError('invalid-argument', 'cobrancaId é obrigatório.');
  const ref = db.collection('cobrancas').doc(cobrancaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Cobrança não encontrada.');
  if (desfazer) {
    await ref.update({ status: 'previsto', dataBaixa: null });
  } else {
    let nome = ''; try { nome = (await admin.auth().getUser(auth.uid)).displayName || ''; } catch (_) {}
    await ref.update({ status: 'pago', dataBaixa: admin.firestore.Timestamp.now(), origemStatus: 'manual', baixaPor: nome || auth.uid });
  }
  const c = snap.data();
  await registrarAudit(auth, desfazer ? 'desfez_baixa_cobranca' : 'baixou_cobranca', { tipo: 'cobranca', id: cobrancaId }, { competencia: c.competencia || '', valor: c.valor || 0, contratoId: c.contratoId || '' });
  return { ok: true };
});

// (financeiro) Registra o repasse efetuado ao proprietário.
exports.locRegistrarRepasse = onCall(async (req) => {
  const auth = await exigirFinanceiro(req);
  const { repasseId, desfazer } = req.data || {};
  if (!repasseId) throw new HttpsError('invalid-argument', 'repasseId é obrigatório.');
  const ref = db.collection('repasses').doc(repasseId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Repasse não encontrado.');
  if (desfazer) {
    await ref.update({ status: 'pendente', dataRepasse: null });
  } else {
    let nome = ''; try { nome = (await admin.auth().getUser(auth.uid)).displayName || ''; } catch (_) {}
    await ref.update({ status: 'repassado', dataRepasse: admin.firestore.Timestamp.now(), origemStatus: 'manual', repassePor: nome || auth.uid });
  }
  const rr = snap.data();
  await registrarAudit(auth, desfazer ? 'desfez_repasse' : 'repassou', { tipo: 'repasse', id: repasseId }, { competencia: rr.competencia || '', valor: rr.valorRepasse || 0, contratoId: rr.contratoId || '' });
  return { ok: true };
});

// (financeiro) Ajusta o valor do repasse (a conta automática é uma estimativa — o
// financeiro corrige caso a caso; ainda não considera 100% o tipo de repasse).
exports.locAtualizarRepasse = onCall(async (req) => {
  const auth = await exigirFinanceiro(req);
  const { repasseId, valorRepasse } = req.data || {};
  if (!repasseId) throw new HttpsError('invalid-argument', 'repasseId é obrigatório.');
  const valor = Number(valorRepasse);
  if (!isFinite(valor) || valor < 0) throw new HttpsError('invalid-argument', 'Valor inválido.');
  const ref = db.collection('repasses').doc(repasseId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Repasse não encontrado.');
  const antes = snap.data().valorRepasse || 0;
  await ref.update({ valorRepasse: valor, valorAjustado: true, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
  await registrarAudit(auth, 'ajustou_valor_repasse', { tipo: 'repasse', id: repasseId }, { de: antes, para: valor, competencia: snap.data().competencia || '' });
  return { ok: true, valorRepasse: valor };
});

// (autenticado) Financeiro: cobranças + repasses. Gestor/admin veem tudo; corretor os seus (consulta).
exports.locListarFinanceiro = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const podeBaixar = await podeFinanceiro(auth);
  const filtro = coll => veTudo ? db.collection(coll) : db.collection(coll).where('corretorUid', '==', auth.uid);
  const [cobS, repS] = await Promise.all([filtro('cobrancas').get(), filtro('repasses').get()]);
  const ser = (d, campos) => { const o = { id: d.id, ...d.data() }; campos.forEach(k => { o[k] = d.data()[k]?.toDate?.()?.toISOString() || null; }); return o; };
  const cobrancas = cobS.docs.map(d => ser(d, ['dataBaixa', 'criadoEm']));
  const repasses  = repS.docs.map(d => ser(d, ['dataRepasse', 'criadoEm']));
  return { cobrancas, repasses, veTudo, podeBaixar };
});

// "Agora" no fuso de São Paulo (UTC-3; Brasil sem horário de verão). Evita que a data/
// competência "de hoje" vire um dia antes perto da meia-noite (Timestamp.now() é UTC).
function agoraSP() { return new Date(admin.firestore.Timestamp.now().toDate().getTime() - 3 * 3600000); }

// (autenticado) Painel/Dashboard: números agregados. Gestor/admin veem tudo;
// corretor só os seus. Evita índice composto: filtra por 1 campo e agrega em memória
// (volume pequeno — ~12 corretores, dezenas de imóveis/mês).
exports.locDashboard = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const flt = coll => veTudo ? db.collection(coll) : db.collection(coll).where('corretorUid', '==', auth.uid);

  const [imS, ctS, cobS, repS] = await Promise.all([
    flt('imoveis').get(), flt('contratos').get(), flt('cobrancas').get(), flt('repasses').get()
  ]);

  const porStatus = {};
  imS.forEach(d => { const s = d.data().status || 'recebido'; porStatus[s] = (porStatus[s] || 0) + 1; });

  const contratosAtivos = ctS.docs.filter(d => d.data().status === 'ativo').length;

  let inadimplenciaQtd = 0, inadimplenciaValor = 0;
  cobS.forEach(d => { const x = d.data(); if (x.status === 'atrasado') { inadimplenciaQtd++; inadimplenciaValor += (x.valor || 0); } });

  let repassePendQtd = 0, repassePendValor = 0, repassadoMesValor = 0;
  const compAtual = agoraSP().toISOString().slice(0, 7);
  repS.forEach(d => {
    const x = d.data();
    if (x.status === 'pendente') { repassePendQtd++; repassePendValor += (x.valorRepasse || 0); }
    if (x.status === 'repassado' && x.competencia === compAtual) repassadoMesValor += (x.valorRepasse || 0);
  });

  // Cadastros aguardando análise = imóveis em em_analise (proxy da esteira)
  const aguardandoAnalise = porStatus['em_analise'] || 0;

  return {
    veTudo,
    imoveisPorStatus: porStatus,
    totalImoveis: imS.size,
    contratosAtivos,
    inadimplencia: { qtd: inadimplenciaQtd, valor: inadimplenciaValor },
    repassePendente: { qtd: repassePendQtd, valor: repassePendValor },
    repassadoMes: repassadoMesValor,
    aguardandoAnalise
  };
});

// (autenticado) Relatórios: contratos ativos, inadimplência, repasses do mês,
// imóveis por corretor e extrato por proprietário. Corretor só os seus; gestor/admin tudo.
// Volume pequeno → agrega em memória (sem índice composto). A exportação (CSV) é no cliente.
exports.locRelatorios = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const flt = coll => veTudo ? db.collection(coll) : db.collection(coll).where('corretorUid', '==', auth.uid);

  const [imS, ctS, cobS, repS, peS] = await Promise.all([
    flt('imoveis').get(), flt('contratos').get(), flt('cobrancas').get(), flt('repasses').get(), flt('pessoas').get()
  ]);
  const pessoaNome = {}; peS.forEach(d => { pessoaNome[d.id] = d.data().nome || ''; });
  const imById = {}; imS.forEach(d => { imById[d.id] = d.data(); });
  const endStr = im => {
    const e = (im && im.endereco) || {};
    return [e.logradouro, e.numero, e.bairro, e.cidade].filter(Boolean).join(', ');
  };
  const nomes = ids => (ids || []).map(id => pessoaNome[id]).filter(Boolean).join(', ');
  const compAtual = agoraSP().toISOString().slice(0, 7);

  // 1) Contratos ativos
  const contratosAtivos = ctS.docs.filter(d => d.data().status === 'ativo').map(d => {
    const c = d.data(); const im = imById[c.imovelId] || {};
    return { imovelId: c.imovelId, referencia: im.referencia || '', endereco: endStr(im), locador: nomes(c.locadorIds) || im.locadorNome || '', locatario: nomes(c.locatarioIds), valorAluguel: c.valorAluguel || 0, vigenciaInicio: c.vigenciaInicio || '', vigenciaFim: c.vigenciaFim || '', corretorNome: im.corretorNome || '' };
  });

  // 2) Inadimplência (cobranças atrasadas)
  const inadimplencia = cobS.docs.filter(d => d.data().status === 'atrasado').map(d => {
    const x = d.data(); const im = imById[x.imovelId] || {};
    return { competencia: x.competencia || '', referencia: im.referencia || '', endereco: endStr(im), valor: x.valor || 0, vencimento: x.vencimento || '', corretorNome: im.corretorNome || '' };
  }).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));

  // 3) Repasses do mês atual
  const repassesMes = repS.docs.map(d => d.data()).filter(x => x.competencia === compAtual).map(x => {
    const im = imById[x.imovelId] || {};
    return { competencia: x.competencia, referencia: im.referencia || '', proprietario: pessoaNome[x.proprietarioId] || im.locadorNome || '', valorRepasse: x.valorRepasse || 0, status: x.status || '', corretorNome: im.corretorNome || '' };
  });

  // 4) Imóveis captados por corretor
  const porCorretor = {};
  imS.forEach(d => { const x = d.data(); const nome = x.corretorNome || x.corretorUid || '—'; porCorretor[nome] = (porCorretor[nome] || 0) + 1; });
  const imoveisPorCorretor = Object.entries(porCorretor).map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd);

  // 5) Extrato por proprietário (consolida repasses)
  const extrato = {};
  repS.forEach(d => {
    const x = d.data(); const pid = x.proprietarioId || '—'; const nome = pessoaNome[pid] || '(proprietário)';
    if (!extrato[pid]) extrato[pid] = { proprietario: nome, total: 0, repassado: 0, pendente: 0, qtd: 0 };
    const e = extrato[pid];
    e.qtd++; e.total += x.valorRepasse || 0;
    if (x.status === 'repassado') e.repassado += x.valorRepasse || 0; else e.pendente += x.valorRepasse || 0;
  });
  const extratoPorProprietario = Object.values(extrato).sort((a, b) => b.total - a.total);

  return { veTudo, compAtual, contratosAtivos, inadimplencia, repassesMes, imoveisPorCorretor, extratoPorProprietario };
});

// (autenticado) Central de alertas: atrasos, repasses pendentes, contratos vencendo,
// vistorias pendentes e cadastros com pendência. Corretor só os seus; gestor/admin tudo.
// Cada alerta tem `chave` determinística e flag `tratado` (marcado em loc_alertas_tratados).
const DIAS_CONTRATO_VENCENDO = 60;
exports.locListarAlertas = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const flt = coll => veTudo ? db.collection(coll) : db.collection(coll).where('corretorUid', '==', auth.uid);

  const [cobS, repS, ctS, viS, imS, trS] = await Promise.all([
    flt('cobrancas').get(), flt('repasses').get(), flt('contratos').get(),
    flt('vistorias').get(), flt('imoveis').get(),
    db.collection('loc_alertas_tratados').get()
  ]);
  const tratados = new Set(trS.docs.map(d => d.id));

  const hoje = agoraSP();
  const hojeStr = hoje.toISOString().slice(0, 10);
  const limiteStr = new Date(hoje.getTime() + DIAS_CONTRATO_VENCENDO * 86400000).toISOString().slice(0, 10);

  const alertas = [];
  const push = (tipo, refId, extra) => {
    const chave = `${tipo}:${refId}`;
    alertas.push({ tipo, chave, refId, tratado: tratados.has(chave), ...extra });
  };

  cobS.forEach(d => { const x = d.data(); if (x.status === 'atrasado') push('atraso', d.id, { competencia: x.competencia, valor: x.valor, vencimento: x.vencimento, contratoId: x.contratoId, imovelId: x.imovelId }); });
  repS.forEach(d => { const x = d.data(); if (x.status === 'pendente') push('repasse_pendente', d.id, { competencia: x.competencia, valor: x.valorRepasse, contratoId: x.contratoId, imovelId: x.imovelId }); });
  ctS.forEach(d => { const x = d.data(); if (x.status === 'ativo' && x.vigenciaFim && x.vigenciaFim >= hojeStr && x.vigenciaFim <= limiteStr) push('contrato_vencendo', d.id, { vigenciaFim: x.vigenciaFim, imovelId: x.imovelId }); });
  viS.forEach(d => { const x = d.data(); if (x.status === 'agendada') push('vistoria_pendente', d.id, { tipoVistoria: x.tipo, imovelId: x.imovelId }); });
  imS.forEach(d => { const x = d.data(); if (Array.isArray(x.pendentes) && x.pendentes.length) push('cadastro_pendente', d.id, { qtd: x.pendentes.length, imovelId: d.id, referencia: x.referencia || '' }); });

  return { alertas };
});

// (gestor/admin) Marca/desmarca um alerta como tratado (persiste em loc_alertas_tratados).
exports.locTratarAlerta = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo) throw new HttpsError('permission-denied', 'Só gestor/administrativo pode tratar alertas.');
  const { chave, desfazer } = req.data || {};
  if (!chave || typeof chave !== 'string') throw new HttpsError('invalid-argument', 'chave é obrigatória.');
  const docId = chave.replace(/\//g, '_').slice(0, 300);
  const ref = db.collection('loc_alertas_tratados').doc(docId);
  if (desfazer) await ref.delete();
  else await ref.set({ chave, tratadoPor: auth.uid, tratadoEm: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true };
});

// ─── Webhook de cobrança (desativado — entra com a integração bancária) ──────
// O endpoint de entrada do gateway já existe, mas fica inerte por enquanto
// (o pagamento é dado manualmente em locRegistrarPagamento). Quando a integração
// bancária entrar, este handler: (1) valida a assinatura/segredo do provedor
// (Asaas/Iugu/etc.), (2) acha a cobrança/repasse por `idExterno`, (3) grava status
// + origemStatus='gateway' — no MESMO lugar que a baixa manual. Nada aqui muda telas/relatórios.
const GATEWAY_WEBHOOK_ATIVO = false; // a integração bancária liga isto (+ segredo do provedor)
exports.locGatewayWebhook = onRequest(async (req, res) => {
  if (!GATEWAY_WEBHOOK_ATIVO) {
    res.status(503).json({ ok: false, disabled: true, message: 'Webhook de cobrança desativado. Pagamentos são registrados manualmente.' });
    return;
  }
  // ── quando plugar o gateway ──
  // if (!assinaturaValida(req)) { res.status(401).end(); return; }
  // const { idExterno, evento } = req.body || {};
  // const cob = await db.collection('cobrancas').where('idExterno','==',idExterno).limit(1).get();
  // if (!cob.empty && evento === 'pago') await cob.docs[0].ref.update({ status:'pago', dataBaixa: admin.firestore.Timestamp.now(), origemStatus:'gateway' });
  res.status(200).json({ ok: true });
});

// ─── Portal externo do proprietário (consulta por token, sem login) ─────────────
const PORTAL_BASE = 'https://remax-smart-hub.web.app';

// Papel da pessoa → papel do portal + página. Locador vê repasses; locatário vê pagamentos.
const PORTAL_PAPEL = { locador: 'proprietario', locatario: 'inquilino' };
const PORTAL_PAGINA = { proprietario: 'portal-proprietario.html', inquilino: 'portal-inquilino.html' };

// (gestor/admin) Gera (ou reusa) o link do portal de um proprietário/inquilino. Link
// estável por padrão; regenerar=true cria um novo e revoga os antigos.
exports.locGerarTokenPortal = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth) && !(auth.token && auth.token.locRole === 'administrativo')) {
    throw new HttpsError('permission-denied', 'Apenas gestor ou administrativo.');
  }
  const { pessoaId, regenerar } = req.data || {};
  if (!pessoaId) throw new HttpsError('invalid-argument', 'pessoaId é obrigatório.');
  const pSnap = await db.collection('pessoas').doc(pessoaId).get();
  const papelPortal = pSnap.exists ? PORTAL_PAPEL[pSnap.data().papel] : null;
  if (!papelPortal) throw new HttpsError('not-found', 'Pessoa não encontrada ou sem portal.');

  // Busca tokens da pessoa (1 campo → sem índice composto) e filtra em memória.
  const existentes = await db.collection('portal_tokens').where('pessoaId', '==', pessoaId).get();
  let token = null;
  if (!regenerar) {
    const valido = existentes.docs.find(d => d.data().papel === papelPortal && !d.data().revogado);
    if (valido) token = valido.id;
  }
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url'); // ~32 chars, imprevisível
    await db.collection('portal_tokens').doc(token).set({
      pessoaId, papel: papelPortal, corretorUid: pSnap.data().corretorUid || '',
      criadoEm: admin.firestore.FieldValue.serverTimestamp(), revogado: false, criadoPor: auth.uid
    });
    if (regenerar) { // revoga os antigos válidos do mesmo papel
      const batch = db.batch();
      existentes.docs.filter(d => d.data().papel === papelPortal && !d.data().revogado).forEach(d => batch.update(d.ref, { revogado: true }));
      await batch.commit();
    }
  }
  return { token, url: `${PORTAL_BASE}/${PORTAL_PAGINA[papelPortal]}?token=${token}`, nome: pSnap.data().nome || '', papel: papelPortal };
});

// (PÚBLICO — sem auth do Hub) O proprietário consulta o extrato de repasses pelo token.
// O token É a credencial; retorna SÓ os dados desse proprietário (sem PII de terceiros).
exports.portalProprietario = onCall(async (req) => {
  const { token } = req.data || {};
  if (!token || typeof token !== 'string') throw new HttpsError('invalid-argument', 'Link inválido.');
  const tSnap = await db.collection('portal_tokens').doc(token).get();
  if (!tSnap.exists || tSnap.data().revogado || tSnap.data().papel !== 'proprietario') {
    throw new HttpsError('permission-denied', 'Link inválido ou revogado.');
  }
  const pessoaId = tSnap.data().pessoaId;
  const pSnap = await db.collection('pessoas').doc(pessoaId).get();
  const nome = pSnap.exists ? (pSnap.data().nome || 'Proprietário') : 'Proprietário';

  // Repasses do proprietário: titular principal (proprietarioId) + 2ª titular (proprietarioIds).
  const [r1, r2] = await Promise.all([
    db.collection('repasses').where('proprietarioId', '==', pessoaId).get(),
    db.collection('repasses').where('proprietarioIds', 'array-contains', pessoaId).get()
  ]);
  const map = {};
  [...r1.docs, ...r2.docs].forEach(d => { map[d.id] = d.data(); });

  const imIds = [...new Set(Object.values(map).map(r => r.imovelId).filter(Boolean))];
  const imById = {};
  await Promise.all(imIds.map(async id => { const s = await db.collection('imoveis').doc(id).get(); if (s.exists) imById[id] = s.data(); }));
  const endStr = im => { const e = (im && im.endereco) || {}; return [e.logradouro, e.numero, e.bairro, e.cidade].filter(Boolean).join(', '); };

  let totalRepassado = 0, totalPendente = 0;
  const repasses = Object.values(map)
    .sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''))
    .map(r => {
      const im = imById[r.imovelId] || {};
      const v = r.valorRepasse || 0;
      if (r.status === 'repassado') totalRepassado += v; else totalPendente += v;
      return {
        competencia: r.competencia || '', valor: v, status: r.status || 'pendente',
        imovel: im.referencia || endStr(im) || 'Imóvel',
        dataRepasse: r.dataRepasse && r.dataRepasse.toDate ? r.dataRepasse.toDate().toISOString().slice(0, 10) : null
      };
    });
  return { nome, totalRepassado, totalPendente, repasses };
});

// (PÚBLICO — sem auth do Hub) O inquilino consulta a situação dos pagamentos pelo token.
// Só CONSULTA (o boleto pagável entra com a integração bancária). Cobranças com status manual.
exports.portalInquilino = onCall(async (req) => {
  const { token } = req.data || {};
  if (!token || typeof token !== 'string') throw new HttpsError('invalid-argument', 'Link inválido.');
  const tSnap = await db.collection('portal_tokens').doc(token).get();
  if (!tSnap.exists || tSnap.data().revogado || tSnap.data().papel !== 'inquilino') {
    throw new HttpsError('permission-denied', 'Link inválido ou revogado.');
  }
  const pessoaId = tSnap.data().pessoaId;
  const pSnap = await db.collection('pessoas').doc(pessoaId).get();
  const nome = pSnap.exists ? (pSnap.data().nome || 'Inquilino') : 'Inquilino';
  const imovelId = pSnap.exists ? pSnap.data().imovelId : null;
  if (!imovelId) return { nome, imovel: '', totalPago: 0, totalAberto: 0, cobrancas: [] };

  const [cobS, imSnap, ctSnap] = await Promise.all([
    db.collection('cobrancas').where('imovelId', '==', imovelId).get(),
    db.collection('imoveis').doc(imovelId).get(),
    db.collection('contratos').doc(imovelId).get()
  ]);
  const im = imSnap.exists ? imSnap.data() : {};
  const e = im.endereco || {};
  const imovel = im.referencia || [e.logradouro, e.numero, e.bairro, e.cidade].filter(Boolean).join(', ') || 'Imóvel';

  // SEGURANÇA: só o(s) locatário(s) do contrato vigente veem as cobranças. Vários
  // "pessoas" locatário podem dividir o mesmo imovelId (candidatos rejeitados, inquilino
  // anterior após re-locação) — sem esse gate, um veria os pagamentos do outro.
  const locatarioIds = ctSnap.exists ? (ctSnap.data().locatarioIds || []) : [];
  if (!locatarioIds.includes(pessoaId)) {
    return { nome, imovel, totalPago: 0, totalAberto: 0, cobrancas: [] };
  }

  let totalPago = 0, totalAberto = 0;
  const cobrancas = cobS.docs.map(d => d.data())
    .sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''))
    .map(x => {
      const v = x.valor || 0;
      if (x.status === 'pago') totalPago += v; else totalAberto += v;
      return { competencia: x.competencia || '', valor: v, vencimento: x.vencimento || '', status: x.status || 'previsto' };
    });
  return { nome, imovel, totalPago, totalAberto, cobrancas };
});

// ─── Gestão de Locações · Vistorias ─────────────────────────────────────────
// Registro manual: entrada/saída + link do laudo. O corretor
// (dono) executa; gestor/admin acompanham.
const VISTORIA_STATUS = ['agendada', 'realizada', 'laudo_emitido'];
exports.locSalvarVistoria = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, vistoriaId, tipo, status, laudoUrl, obs } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  if (!['entrada', 'saida'].includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo inválido.');
  if (!VISTORIA_STATUS.includes(status)) throw new HttpsError('invalid-argument', 'Status inválido.');

  const imovelSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imovelSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && imovelSnap.data().corretorUid !== auth.uid) throw new HttpsError('permission-denied', 'Sem acesso a este imóvel.');

  const ref = vistoriaId ? db.collection('vistorias').doc(vistoriaId) : db.collection('vistorias').doc();
  // Ao editar (vistoriaId dado), a vistoria existente PRECISA pertencer a este imóvel —
  // impede sobrescrever/sequestrar a vistoria de outro imóvel/corretor via id arbitrário (IDOR).
  if (vistoriaId) {
    const existente = await ref.get();
    if (existente.exists && existente.data().imovelId !== imovelId) {
      throw new HttpsError('permission-denied', 'Esta vistoria não pertence a este imóvel.');
    }
  }
  const base = {
    imovelId, contratoId: imovelId, corretorUid: imovelSnap.data().corretorUid,
    tipo, status, laudoUrl: laudoUrl || '', obs: obs || '',
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  };
  if (!vistoriaId) base.criadoEm = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(base, { merge: true });
  await recomputarChecklistAuto(imovelId); // vistoria de entrada com laudo → item automático
  return { ok: true, id: ref.id };
});

// Rotina diária: cobranças previstas cujo vencimento passou viram "atrasado".
exports.locRecalcularAlertas = onSchedule({ schedule: '0 6 * * *', timeZone: TZ }, async () => {
  const hoje = admin.firestore.Timestamp.now().toDate().toISOString().slice(0, 10);
  const snap = await db.collection('cobrancas').where('status', '==', 'previsto').get();
  const vencidas = snap.docs.filter(d => (d.data().vencimento || '') < hoje);
  for (let i = 0; i < vencidas.length; i += 400) {
    const batch = db.batch();
    vencidas.slice(i, i + 400).forEach(d => batch.update(d.ref, { status: 'atrasado' }));
    await batch.commit();
  }
  console.log(`locRecalcularAlertas: ${vencidas.length} cobranças marcadas atrasadas.`);
});

// Lista quais siteKeys têm credenciais cadastradas
exports.listCredentials = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('credentials').get();
  return snap.docs.map(doc => ({
    siteKey: doc.id,
    login: doc.data().login || '',
    // NÃO retorna a senha em lista — só ao editar.
    temSenha: !!(doc.data().password || doc.data().password_enc)
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
  let password = '';
  if (d.password_enc) {
    try { password = await kmsDecrypt(d.password_enc); }
    catch (e) { await logErro('getCredentialAdmin.decrypt', e, { siteKey }); throw new HttpsError('internal', 'Falha ao decriptar credencial.'); }
  } else if (d.password) {
    password = d.password;
  }
  return { login: d.login || '', password };
});

// Cria ou atualiza credenciais (admin only)
exports.setCredentials = onCall(async (req) => {
  await exigirAdmin(req);
  const { siteKey, login, password } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');

  const patch = {
    login: login || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (password) {
    // Sempre criptografa antes de gravar. Apaga o campo texto puro se existir.
    patch.password_enc = await kmsEncrypt(password);
    patch.password = admin.firestore.FieldValue.delete();
  }
  await db.collection('credentials').doc(siteKey).set(patch, { merge: true });
  return { ok: true };
});

// (admin) Força a migração: criptografa todas as credenciais em texto puro.
// Ao terminar, nenhum doc de credentials deve ter o campo 'password' — só 'password_enc'.
exports.migrarCredenciaisCofre = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('credentials').get();
  let migradas = 0, jaOk = 0, erros = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.password_enc && !d.password) { jaOk++; continue; }
    if (!d.password) { jaOk++; continue; }
    try {
      const enc = await kmsEncrypt(d.password);
      await doc.ref.set({
        password_enc: enc,
        password: admin.firestore.FieldValue.delete(),
        migratedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      migradas++;
    } catch (e) {
      await logErro('migrarCredenciaisCofre', e, { siteKey: doc.id });
      erros++;
    }
  }
  await registrarAudit(req.auth, 'migrou_credenciais', { tipo: 'credencial', id: 'batch' }, { migradas, jaOk, erros, total: snap.size });
  return { migradas, jaOk, erros, total: snap.size };
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

// ─── Status dos apps (aviso de instabilidade, sem precisar atualizar o .exe) ──
// Admin marca um app como instável com uma mensagem; aparece pra todos no Hub.
exports.listarStatusApps = onCall(async (req) => {
  exigirAutenticado(req);
  const snap = await db.collection('app_status').where('ativo', '==', true).get();
  const status = {};
  snap.forEach(d => { status[d.id] = d.data().mensagem || ''; });
  return { status };
});

exports.setStatusApp = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { siteKey, mensagem, ativo } = req.data || {};
  if (!siteKey) throw new HttpsError('invalid-argument', 'siteKey é obrigatório.');
  if (ativo) {
    await db.collection('app_status').doc(siteKey).set({
      mensagem: String(mensagem || '').slice(0, 300),
      ativo: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid
    });
  } else {
    await db.collection('app_status').doc(siteKey).delete();
  }
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
  await registrarAudit(auth, 'editou_perfil', { tipo: 'usuario', id: auth.uid },
    { alterouNome: 'displayName' in upd, alterouFoto: 'photo' in upd });
  return { ok: true };
});

// ─── Treinamento — links dos materiais por item ───────────────────────────────
exports.getTreinamentoLinks = onCall(async (req) => {
  exigirAutenticado(req);
  const snap = await db.collection('treinamento_links').get();
  const links = {};
  snap.forEach(d => { links[d.id] = d.data(); });
  return { links };
});

exports.setTreinamentoLink = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { itemId, url, tipo } = req.data || {};
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId é obrigatório.');
  const tipoLimpo = ['video', 'pdf', 'drive', 'link'].includes(tipo) ? tipo : 'link';
  if (url && url.trim()) {
    await db.collection('treinamento_links').doc(itemId).set({
      url: url.trim(),
      tipo: tipoLimpo,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid
    });
  } else {
    await db.collection('treinamento_links').doc(itemId).delete();
  }
  return { ok: true };
});

// ─── Banners principais (carrossel — múltiplas imagens, alternam no Hub) ────────
// Coleção `banners`: cada doc tem { imagem: base64, ordem: number, updatedAt }.
exports.listarBanners = onCall(async (req) => {
  exigirAutenticado(req);
  const snap = await db.collection('banners').orderBy('ordem').get();
  return { banners: snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, tipo: x.tipo || 'imagem', imagem: x.imagem || '', mediaUrl: x.mediaUrl || '', duracao: x.duracao || null };
  })};
});

exports.adicionarBanner = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { imagem, mediaUrl, tipo } = req.data || {};
  // imagem = base64 (JPG/PNG) | mediaUrl = Storage URL (GIF/MP4)
  if (!imagem && !mediaUrl) throw new HttpsError('invalid-argument', 'imagem ou mediaUrl é obrigatório.');
  if (imagem && imagem.length > 600000) throw new HttpsError('invalid-argument', 'Imagem muito grande.');
  const snap = await db.collection('banners').orderBy('ordem', 'desc').limit(1).get();
  const proximaOrdem = snap.empty ? 0 : (snap.docs[0].data().ordem || 0) + 1;
  const { duracao } = req.data || {}; // duração em ms (GIF: calculada no cliente)
  const doc = { ordem: proximaOrdem, tipo: tipo || 'imagem', updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: auth.uid };
  if (imagem) doc.imagem = imagem;
  if (mediaUrl) doc.mediaUrl = mediaUrl;
  if (duracao) doc.duracao = duracao;
  const ref = await db.collection('banners').add(doc);
  return { ok: true, id: ref.id };
});

exports.removerBanner = onCall(async (req) => {
  await exigirAdmin(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  await db.collection('banners').doc(id).delete();
  return { ok: true };
});

// Reordena os banners: recebe a lista completa de ids na nova ordem e grava ordem=posição.
exports.reordenarBanners = onCall(async (req) => {
  await exigirAdmin(req);
  const { ids } = req.data || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw new HttpsError('invalid-argument', 'ids inválidos.');
  const batch = db.batch();
  ids.forEach((id, i) => {
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'id inválido.');
    batch.update(db.collection('banners').doc(id), { ordem: i });
  });
  await batch.commit();
  return { ok: true };
});

// Mantém getBanner/setBanner por compatibilidade (migração: se não há banners na coleção nova,
// retorna o banner antigo de config/banner como fallback).
exports.getBanner = onCall(async (req) => {
  exigirAutenticado(req);
  const snap = await db.collection('banners').orderBy('ordem').limit(1).get();
  if (!snap.empty) return { imagem: snap.docs[0].data().imagem || '' };
  const old = await db.collection('config').doc('banner').get();
  return { imagem: old.exists ? (old.data().imagem || '') : '' };
});

exports.setBanner = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { imagem } = req.data || {};
  if (typeof imagem !== 'string') throw new HttpsError('invalid-argument', 'imagem é obrigatória.');
  if (imagem.length > 600000) throw new HttpsError('invalid-argument', 'Imagem muito grande.');
  if (imagem) {
    await db.collection('config').doc('banner').set({ imagem, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true });
  } else {
    await db.collection('config').doc('banner').delete();
  }
  return { ok: true };
});

// ─── Suporte (chamado por email com anexo opcional) ──────────────────────────
function escaparHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Gera PDF da ficha a partir dos dados estruturados do Firestore.
// As chaves das fichas seguem o padrão `prefixo_sufixo` (ex.: im_endereco, s1_cpf,
// emp_cep, fin1_banco). Em vez de mapear cada chave (são dezenas e mudam), o rótulo
// é montado: ROTULO_BASE traduz o sufixo, ROTULO_PREFIXO nomeia o bloco, e o que
// não casar é "humanizado" (vira "Algo assim") — nunca pior que a chave crua.
const ROTULO_BASE = {
  // pessoa / empresa
  nome:'Nome', razaoSocial:'Razão social', nomeFantasia:'Nome fantasia',
  rg:'RG', cpf:'CPF', cnpj:'CNPJ', cnh:'CNH', inscricaoEstadual:'Insc. estadual',
  nasc:'Nascimento', dataNasc:'Data de nascimento', abertura:'Data de abertura',
  profissao:'Profissão', civil:'Estado civil', estadoCivil:'Estado civil', renda:'Renda mensal',
  ramo:'Ramo de atividade', faturamento:'Faturamento atual', faturamento_ano:'Faturamento último ano',
  email:'E-mail', whatsapp:'WhatsApp', celular:'Celular / WhatsApp', fixo:'Telefone fixo', telefone:'Telefone',
  // endereço
  cep:'CEP', endereco:'Endereço', logradouro:'Logradouro', numero:'Número',
  complemento:'Complemento', bairro:'Bairro', cidade:'Cidade', estado:'Estado',
  // financeiro
  banco:'Banco', tipoConta:'Tipo de conta', agencia:'Agência', conta:'Conta',
  pix:'Chave Pix', favorecido:'Favorecido',
  // imóvel / proposta
  tipo:'Tipo de imóvel', ref:'Referência', condominio:'Condomínio',
  anuncio:'Valor do anúncio', proposta:'Valor da proposta', valor:'Valor',
  valorProposta:'Valor da proposta', formaPagamento:'Forma de pagamento',
  observacoes:'Observações', obs:'Observações',
  // cônjuge
  conj_nome:'Cônjuge — Nome', conj_rg:'Cônjuge — RG', conj_cpf:'Cônjuge — CPF',
  conj_nasc:'Cônjuge — Nascimento', conj_profissao:'Cônjuge — Profissão',
  conj_civil_regime:'Cônjuge — Regime de bens',
  // documentos (aparecem em pendentes[])
  cnpj_card:'Cartão CNPJ', contrato:'Contrato social', soc_rgcpf:'RG/CPF (sócios)',
  soc_endereco:'Comp. endereço (sócios)', soc_civil:'Comp. estado civil (sócios)',
  emp_renda:'Comp. renda (empresa)', rgFrente:'RG (frente)', rgVerso:'RG (verso)',
  rgcpf:'RG/CPF', compRenda:'Comprovante de renda', compEndereco:'Comprovante de endereço',
  matricula:'Matrícula', iptu:'IPTU',
};
const ROTULO_PREFIXO = {
  emp:'Empresa', im:'Imóvel', imovel:'Imóvel',
  s1:'Sócio 1', s2:'Sócio 2', s3:'Sócio 3',
  loc2:'2º Locatário', tit2:'2º Titular', loc:'Locador',
  fin1:'Dados bancários', fin2:'Dados bancários 2', fin:'Dados bancários',
  gar:'Garantia', com:'Comercial', prop:'Proposta', fiador:'Fiador',
};
function humanizarChave(k) {
  return String(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
}
function rotuloFicha(k) {
  if (ROTULO_BASE[k]) return ROTULO_BASE[k];           // chave exata (inclui conj_* e docs)
  const m = String(k).match(/^([a-z]+\d*)_(.+)$/i);    // separa prefixo_sufixo
  if (m && ROTULO_PREFIXO[m[1]] !== undefined) {
    const pref = ROTULO_PREFIXO[m[1]];
    const base = ROTULO_BASE[m[2]] || humanizarChave(m[2]);
    return pref ? `${pref} · ${base}` : base;
  }
  return humanizarChave(k);
}

async function gerarPdfFicha(ficha, tipoLabel) {
  const NOMES_DOC = { rgcpf:'RG e CPF', energia:'Energia', agua:'Água', gas:'Gás', iptu_doc:'IPTU', condominio_doc:'Condomínio', rgFrente:'RG (frente)', rgVerso:'RG (verso)', compRenda:'Comp. renda', compEndereco:'Comp. endereço', compEstadoCivil:'Estado civil', matricula:'Matrícula' };

  // Baixa imagens dos documentos antes de montar o PDF. As chaves não têm extensão,
  // então detectamos PDF pelos bytes mágicos (%PDF) e não tentamos embuti-lo como imagem.
  const docImages = {};
  for (const [campo, url] of Object.entries(ficha.documentos || {})) {
    try {
      const buf = await fetchBuffer(url);
      if (buf.slice(0, 4).toString('latin1') === '%PDF') continue;
      docImages[campo] = buf;
    } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const d = ficha.dados || {};
      const chunks = [];
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cabeçalho
      doc.fontSize(10).fillColor('#888').text('REMAX Smart — Imóveis');
      doc.fontSize(18).fillColor('#002749').text(tipoLabel, { paragraphGap: 4 });
      doc.fontSize(11).fillColor('#555').text(`Corretor: ${ficha.corretorNome || '—'}`);
      doc.moveDown(1);

      // Linha divisória
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(0.5);

      // Campos preenchidos
      const colKey = 40, colVal = 200, lineH = 18;
      Object.entries(d).filter(([, v]) => v).forEach(([k, v]) => {
        const label = rotuloFicha(k);
        const y = doc.y;
        doc.fontSize(10).fillColor('#555').text(label + ':', colKey, y, { width: 155, continued: false });
        doc.fontSize(10).fillColor('#111').text(String(v), colVal, y, { width: 355 });
        if (doc.y < y + lineH) doc.y = y + lineH;
      });

      // Pendências
      const pendentes = ficha.pendentes || [];
      if (pendentes.length) {
        doc.moveDown(0.8);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ddd').stroke();
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#b45309').text('Itens pendentes:');
        doc.fontSize(10).fillColor('#b45309')
          .text(pendentes.map(p => '• ' + rotuloFicha(p)).join('\n'));
      }

      // Documentos anexados (imagens embutidas no PDF)
      const docKeys = Object.keys(docImages);
      if (docKeys.length) {
        doc.addPage();
        doc.fontSize(14).fillColor('#002749').text('Documentos anexados', { paragraphGap: 6 });
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ddd').stroke();
        doc.moveDown(0.5);

        for (const campo of docKeys) {
          const label = NOMES_DOC[campo] || rotuloFicha(campo);
          doc.fontSize(10).fillColor('#555').text(label + ':', { paragraphGap: 4 });
          try {
            doc.image(docImages[campo], { fit: [475, 600], align: 'center' });
          } catch (_) {
            doc.fontSize(9).fillColor('#999').text('(imagem não pôde ser incorporada)');
          }
          doc.moveDown(1);
          if (doc.y > 700) doc.addPage();
        }
      }

      doc.end();
    } catch (e) { reject(e); }
  });
}

// Só permite baixar do próprio bucket de Storage do projeto. Os documentos das fichas
// são gravados por clientes anônimos, que poderiam apontar 'documentos' para endpoints
// internos/metadata (SSRF) — aqui garantimos que a URL é do Firebase Storage do projeto.
const STORAGE_BUCKET = 'remax-smart-hub.firebasestorage.app';
function urlStoragePermitida(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'firebasestorage.googleapis.com') return parsed.pathname.startsWith(`/v0/b/${STORAGE_BUCKET}/o/`);
    if (host === 'storage.googleapis.com') return parsed.pathname.startsWith(`/${STORAGE_BUCKET}/`);
    return false;
  } catch (_) { return false; }
}

// Busca um arquivo de URL remota como Buffer (limite 8 MB por arquivo)
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    if (!urlStoragePermitida(url)) { reject(new Error('URL de documento não permitida')); return; }
    const MAX = 8 * 1024 * 1024;
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; err ? reject(err) : resolve(val); };
    https.get(url, res => {
      if (res.statusCode !== 200) { finish(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > MAX) { res.destroy(); finish(new Error('Arquivo muito grande')); return; }
        chunks.push(c);
      });
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', e => finish(e));
    }).on('error', e => finish(e));
  });
}

// Avisa o administrativo por email quando uma ficha é enviada ao admin.
// Não lança erro: se o email falhar, a ficha já foi enviada (status mudou).
async function avisarFichaAdminPorEmail(ficha, tipoLabel) {
  try {
    const d = ficha.dados || {};
    // Nome do corretor que enviou: usa o gravado na ficha; se faltar, busca pelo UID no Auth.
    let corretorNome = ficha.corretorNome || '';
    if (!corretorNome && ficha.corretorUid) {
      try { const u = await admin.auth().getUser(ficha.corretorUid); corretorNome = u.displayName || u.email || ''; } catch (_) {}
    }
    const linhas = [
      ['Tipo', tipoLabel],
      ['Cliente', d.nome || 'Sem nome'],
      ['CPF/CNPJ', d.cpf || d.cnpj || '—'],
      ['WhatsApp', d.whatsapp || '—'],
      ['E-mail', d.email || '—'],
      ['Corretor', corretorNome || '—'],
      ['Pendências', (ficha.pendentes || []).length ? ficha.pendentes.join(', ') : 'nenhuma'],
    ];

    // Gera PDF da ficha e anexa
    const nomesDoc = { rgFrente:'RG-frente', rgVerso:'RG-verso', compRenda:'Comp-renda', compEndereco:'Comp-endereco', matricula:'Matricula', iptu:'IPTU' };
    const attachments = [];
    try {
      const pdfBuf = await gerarPdfFicha(ficha, tipoLabel);
      const nomeCliente = (ficha.dados?.nome || 'ficha').replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
      attachments.push({ filename: `${tipoLabel} - ${nomeCliente}.pdf`, content: pdfBuf });
    } catch (e) {
      console.warn('PDF da ficha não gerado:', e.message);
    }

    // Anexa os documentos enviados pelo cliente (RG, comprovante, etc.)
    // Limite acumulado de 20 MB para caber dentro dos 25 MB do Gmail
    const LIMITE_TOTAL = 20 * 1024 * 1024;
    let totalAnexos = attachments.reduce((s, a) => s + (a.content?.length || 0), 0);
    for (const [campo, url] of Object.entries(ficha.documentos || {})) {
      if (totalAnexos >= LIMITE_TOTAL) {
        console.warn(`Anexo ${campo} ignorado: limite de tamanho do email atingido`);
        continue;
      }
      try {
        const buf = await fetchBuffer(url);
        const isPdf = buf.slice(0, 4).toString('latin1') === '%PDF';
        const nomeBase = nomesDoc[campo] || campo;
        attachments.push({ filename: `${nomeBase}.${isPdf ? 'pdf' : 'jpg'}`, content: buf });
        totalAnexos += buf.length;
      } catch (e) {
        console.warn(`Anexo ${campo} ignorado:`, e.message);
      }
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
    });
    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: FICHAS_ADMIN_EMAIL,
      subject: `[Hub] ${tipoLabel} — ${d.nome || 'Nova ficha'} (${corretorNome || 'corretor'})`,
      text: linhas.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nAcesse o Hub para revisar.',
      html: `<p>Uma ficha foi enviada ao administrativo:</p>`
          + `<table style="border-collapse:collapse;font-size:14px">`
          + linhas.map(([k, v]) => `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>${escaparHtml(k)}</strong></td><td style="padding:3px 0">${escaparHtml(v)}</td></tr>`).join('')
          + `</table>`
          + (attachments.length ? `<p style="margin-top:12px;color:#444">${attachments.length} documento(s) anexado(s).</p>` : '<p style="margin-top:12px;color:#444">Nenhum documento enviado ainda.</p>'),
      attachments
    });
  } catch (e) {
    console.error('Falha ao avisar ficha por email:', e.message);
  }
}

exports.enviarSuporte = onCall({ secrets: [SUPPORT_EMAIL_PASS] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { mensagem, imagem, imagemNome } = req.data || {};
  if (!mensagem || !String(mensagem).trim()) {
    throw new HttpsError('invalid-argument', 'A mensagem é obrigatória.');
  }

  // Dados de quem enviou (pra você saber quem é, sem a pessoa precisar digitar)
  let nome = auth.uid;
  let email = (auth.token && auth.token.email) || '';
  try {
    const u = await admin.auth().getUser(auth.uid);
    nome = u.displayName || u.email || auth.uid;
    email = u.email || email;
  } catch (e) { /* usa o que tiver */ }

  // Anexo opcional (data URL base64). Limite ~7MB de base64 (~5MB de imagem).
  const attachments = [];
  if (typeof imagem === 'string' && imagem.startsWith('data:')) {
    if (imagem.length > 7000000) {
      throw new HttpsError('invalid-argument', 'Imagem muito grande. Tente uma menor.');
    }
    const m = imagem.match(/^data:(.+?);base64,(.+)$/);
    if (m) attachments.push({ filename: imagemNome || 'anexo.jpg', content: Buffer.from(m[2], 'base64') });
  }

  const texto = String(mensagem).slice(0, 5000);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
  });

  try {
    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: SUPORTE_EMAIL,
      replyTo: email || undefined,
      subject: `[Hub] Suporte — ${nome}`,
      text: `De: ${nome} (${email})\n\n${texto}`,
      html: `<p><strong>De:</strong> ${escaparHtml(nome)} (${escaparHtml(email)})</p>`
          + `<p style="white-space:pre-wrap">${escaparHtml(texto)}</p>`
          + (attachments.length ? '<p><em>(imagem anexada)</em></p>' : ''),
      attachments
    });
  } catch (e) {
    console.error('Erro ao enviar suporte:', e.message);
    throw new HttpsError('internal', 'Não foi possível enviar o chamado. Tente de novo.');
  }

  await db.collection('chamados').add({
    mensagem: texto,
    imagemUrl: (attachments.length && typeof imagem === 'string') ? imagem : null,
    imagemNome: imagemNome || null,
    status: 'aberto',
    criadoPor: auth.uid,
    criadoPorNome: nome,
    criadoPorEmail: email,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    resposta: null,
    resolvidoPor: null,
    resolvidoEm: null
  });

  return { ok: true };
});

// ─── Chamados de Suporte ────────────────────────────────────────────────────

exports.listarChamados = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehTI = await temPermissaoTI(auth);
  if (!ehTI && !ehAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Sem permissão de TI.');
  }
  const snap = await db.collection('chamados')
    .orderBy('criadoEm', 'desc')
    .limit(100)
    .get();
  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      mensagem: x.mensagem || '',
      status: x.status,
      criadoPorNome: x.criadoPorNome || '',
      criadoPorEmail: x.criadoPorEmail || '',
      criadoEm: x.criadoEm?.toDate?.()?.toISOString() || null,
      resposta: x.resposta || null,
      resolvidoEm: x.resolvidoEm?.toDate?.()?.toISOString() || null,
      temImagem: !!x.imagemUrl
    };
  });
});

exports.responderChamado = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehTI = await temPermissaoTI(auth);
  if (!ehTI && !ehAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Sem permissão de TI.');
  }
  const { chamadoId, resposta } = req.data || {};
  if (!chamadoId) throw new HttpsError('invalid-argument', 'chamadoId é obrigatório.');
  if (!resposta || !String(resposta).trim()) {
    throw new HttpsError('invalid-argument', 'A resposta é obrigatória.');
  }

  const ref = db.collection('chamados').doc(chamadoId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Chamado não encontrado.');
  const dados = snap.data();
  if (dados.status === 'resolvido') {
    throw new HttpsError('failed-precondition', 'Chamado já foi resolvido.');
  }

  await ref.update({
    status: 'resolvido',
    resposta: String(resposta).slice(0, 2000),
    resolvidoPor: auth.uid,
    resolvidoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('notifications').add({
    titulo: 'Resposta do Suporte',
    mensagem: String(resposta).slice(0, 1000),
    todos: false,
    destinatarios: [dados.criadoPor],
    totalDestinatarios: 1,
    criadoPor: auth.uid,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    lidoPor: []
  });

  return { ok: true };
});

exports.contarChamadosAbertos = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehTI = await temPermissaoTI(auth);
  if (!ehTI && !ehAdminAuth(auth)) return { total: 0 };
  const snap = await db.collection('chamados')
    .where('status', '==', 'aberto')
    .get();
  return { total: snap.size };
});

// ─── Marketing: config editável (sanfonas + templates) ─────────────────────
// Semente com o layout hardcoded original. Se marketing_config/layout não existir,
// a leitura retorna essa semente e persiste pra próximas leituras editáveis.
const MARKETING_SEED = {
  sanfonas: [
    { id: 'vendido', titulo: 'Vendido', emoji: '🏆', ordem: 0, aberta: true, templates: [
      { id: 'v1-faixa',     arquivo: 'vendido-v1-faixa.html',     capa: 'marketing/assets/vendido-v1-thumb.jpg',            descricao: 'Selo central · fundo navy',            ordem: 0 },
      { id: 'v2-editorial', arquivo: 'vendido-v2-editorial.html', capa: 'marketing/assets/vendido-v2-thumb.jpg',            descricao: 'Faixa diagonal · fundo claro',         ordem: 1 },
      { id: 'v3-elegante',  arquivo: 'vendido-v3-elegante.html',  capa: 'marketing/assets/vendido-v3-thumb.jpg',            descricao: 'Elegante · fundo navy',                ordem: 2 },
      { id: 'v4-claro',     arquivo: 'vendido-v4-claro.html',     capa: 'marketing/assets/vendido-v4-thumb.jpg',            descricao: 'Editorial · fundo claro',              ordem: 3 },
      { id: 'v5-2dias',     arquivo: 'vendido-v5-2dias.html',     capa: 'marketing/assets/vendido-v5-thumb.jpg',            descricao: 'Selo circular · "vendido em X dias"',  ordem: 4 },
      { id: 'v6-rede-corretor', arquivo: 'vendido-v6-rede-corretor.html', capa: 'marketing/assets/vendido-v6-thumb.jpg',        descricao: 'Rede que vende · claro · com corretor', ordem: 5 }
    ]},
    { id: 'para-vender', titulo: 'Para Vender', emoji: '🏠', ordem: 1, aberta: false, templates: [
      { id: 'anuncio-v3',            arquivo: 'anuncio-v3-galeria.html',              capa: 'marketing/assets/anuncio-v3-galeria-thumb.jpg',           descricao: 'Imóvel à venda — 3 fotos + preço + corretor', ordem: 0 },
      { id: 'sonhos-editorial',      arquivo: 'anuncio-imovel-sonhos-editorial.html', capa: 'marketing/assets/anuncio-sonhos-editorial-thumb.jpg',     descricao: 'Editorial · galeria 3 fotos · fundo claro',   ordem: 1 },
      { id: 'sonhos-corretor',       arquivo: 'anuncio-imovel-sonhos-corretor.html',  capa: 'marketing/assets/anuncio-sonhos-corretor-thumb.jpg',      descricao: 'Editorial + corretor · galeria 3 fotos',      ordem: 2 },
      { id: 'apto-condominio',       arquivo: 'anuncio-apto-condominio.html',         capa: 'marketing/assets/anuncio-apto-condominio-thumb.jpg',      descricao: 'Apto à venda · condomínio completo',          ordem: 3 },
      { id: 'anuncio-v4-semfoto',    arquivo: 'anuncio-v4-galeria-semfoto.html',      capa: 'marketing/assets/anuncio-v4-galeria-semfoto-thumb.jpg',   descricao: 'Galeria 3 fotos · sem corretor',              ordem: 4 }
    ]},
    { id: 'aniversario', titulo: 'Aniversário', emoji: '🎉', ordem: 2, aberta: false, templates: [
      { id: 'aniv-story-1', arquivo: 'aniversario-story-1.html', capa: 'marketing/assets/aniversario-1-thumb.jpg', descricao: 'Aniversário · glass card · story 1080×1920', ordem: 0 },
      { id: 'aniv-story-2', arquivo: 'aniversario-story-2.html', capa: 'marketing/assets/aniversario-2-thumb.jpg', descricao: 'Aniversário · destaque · story 1080×1920',   ordem: 1 }
    ]},
    { id: 'prontos', titulo: 'Templates Prontos', emoji: '✅', ordem: 3, aberta: false, templates: [
      { id: 'imovel-escondido', arquivo: 'pronto-imovel-escondido.html', capa: 'marketing/assets/pronto-imovel-escondido-thumb.jpg', descricao: 'Imóvel escondido · método', ordem: 0 }
    ]}
  ]
};

// Versão do seed. Ao incrementar, o listarMarketingConfig faz merge das sanfonas/
// templates NOVOS (por id) na config já salva, sem apagar o que o admin editou.
// Assim dá pra publicar templates novos só editando o seed + deploy (sem escrita manual no banco).
const MARKETING_SEED_VERSION = 2;

// Faz merge do seed na config salva: adiciona sanfonas que faltam e, nas que já
// existem (mesmo id), adiciona templates que faltam. Não remove nem sobrescreve o resto.
function mergeMarketingSeed(atuais) {
  const out = Array.isArray(atuais) ? atuais.map(s => ({ ...s, templates: [...(s.templates || [])] })) : [];
  const porId = new Map(out.map(s => [s.id, s]));
  let maxOrdem = out.reduce((m, s) => Math.max(m, s.ordem ?? 0), -1);
  for (const seedS of MARKETING_SEED.sanfonas) {
    const existente = porId.get(seedS.id);
    if (!existente) {
      out.push({ ...seedS, ordem: ++maxOrdem, templates: [...(seedS.templates || [])] });
      continue;
    }
    const idsTpl = new Set((existente.templates || []).map(t => t.id));
    let maxT = (existente.templates || []).reduce((m, t) => Math.max(m, t.ordem ?? 0), -1);
    for (const seedT of (seedS.templates || [])) {
      if (!idsTpl.has(seedT.id)) existente.templates.push({ ...seedT, ordem: ++maxT });
    }
  }
  return out;
}

// (autenticado) Lê o layout do Marketing. Semeia na 1ª chamada se não existir.
exports.listarMarketingConfig = onCall(async (req) => {
  exigirAutenticado(req);
  const ref = db.collection('marketing_config').doc('layout');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      sanfonas: MARKETING_SEED.sanfonas,
      seedVersion: MARKETING_SEED_VERSION,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      seed: true
    });
    return { sanfonas: MARKETING_SEED.sanfonas };
  }
  const dados = snap.data();
  // Se o seed subiu de versão, injeta os templates/sanfonas novos na config salva.
  if ((dados.seedVersion || 1) < MARKETING_SEED_VERSION) {
    const merged = mergeMarketingSeed(dados.sanfonas || []);
    await ref.set({ sanfonas: merged, seedVersion: MARKETING_SEED_VERSION }, { merge: true });
    return { sanfonas: merged };
  }
  return { sanfonas: dados.sanfonas || [] };
});

// (marketing_gerenciar OR admin) Salva o layout inteiro. Substitui.
exports.salvarMarketingConfig = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  // Permissão à parte: gerenciar Marketing NÃO herda de admin (só marketing_gerenciar).
  const pode = await temPermissaoMarketing(auth);
  if (!pode) throw new HttpsError('permission-denied', 'Sem permissão para gerenciar o Marketing.');
  const { sanfonas } = req.data || {};
  if (!Array.isArray(sanfonas)) throw new HttpsError('invalid-argument', 'sanfonas deve ser um array.');
  // Sanitização mínima: cada item precisa de id + título, templates são opcionais
  const limpas = sanfonas.map((s, i) => ({
    id: String(s.id || '').slice(0, 40) || `sanfona-${Date.now()}-${i}`,
    titulo: String(s.titulo || '').slice(0, 60),
    emoji: String(s.emoji || '').slice(0, 8),
    ordem: Number.isFinite(s.ordem) ? s.ordem : i,
    aberta: !!s.aberta,
    templates: (Array.isArray(s.templates) ? s.templates : []).map((t, j) => ({
      id: String(t.id || '').slice(0, 60) || `tpl-${Date.now()}-${j}`,
      arquivo: String(t.arquivo || '').slice(0, 500),
      capa: String(t.capa || '').slice(0, 500),
      descricao: String(t.descricao || '').slice(0, 200),
      ordem: Number.isFinite(t.ordem) ? t.ordem : j
    }))
  }));
  await db.collection('marketing_config').doc('layout').set({
    sanfonas: limpas,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoPor: auth.uid
  }, { merge: true });
  await registrarAudit(auth, 'salvou_marketing', { tipo: 'marketing_config', id: 'layout' },
    { sanfonas: limpas.length, templatesTotais: limpas.reduce((s,x) => s + x.templates.length, 0) });
  return { ok: true };
});

exports.excluirChamado = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehTI = await temPermissaoTI(auth);
  if (!ehTI && !ehAdminAuth(auth)) throw new HttpsError('permission-denied', 'Sem permissão.');
  const { chamadoId } = req.data || {};
  if (!chamadoId) throw new HttpsError('invalid-argument', 'chamadoId obrigatório.');
  const snap = await db.collection('chamados').doc(chamadoId).get();
  await db.collection('chamados').doc(chamadoId).delete();
  await registrarAudit(auth, 'excluiu_chamado', { tipo: 'chamado', id: chamadoId },
    snap.exists ? { criadoPorNome: snap.data().criadoPorNome || '', status: snap.data().status || '' } : {});
  return { ok: true };
});

// (admin) Lista últimos eventos de auditoria com filtros opcionais (ação, ator)
// + retorna a lista completa de usuários pra exibir também quem não tem atividade.
exports.listarAuditoria = onCall(async (req) => {
  await exigirAdmin(req);
  const { acao, atorUid, limite } = req.data || {};
  let q = db.collection('audit_log').orderBy('em', 'desc');
  if (acao) q = q.where('acao', '==', String(acao));
  if (atorUid) q = q.where('ator.uid', '==', String(atorUid));
  const lim = Math.max(1, Math.min(500, Number(limite) || 100));
  const snap = await q.limit(lim).get();
  const eventos = snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      acao: x.acao || '',
      alvo: x.alvo || null,
      detalhes: x.detalhes || {},
      ator: x.ator || {},
      em: x.em?.toDate?.()?.toISOString() || null
    };
  });
  let usuarios = [];
  try {
    const r = await admin.auth().listUsers(1000);
    usuarios = r.users.filter(u => !u.disabled).map(u => ({
      uid: u.uid,
      nome: u.displayName || u.email || u.uid,
      email: u.email || ''
    }));
  } catch (_) {}
  return { eventos, usuarios };
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
// Qualquer usuário pode criar eventos, convidar pessoas ou marcar "para todos".
exports.criarEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const ehAdmin = ehAdminAuth(auth);
  const { titulo, inicio, participantes, todos, descricao, tipo, dataLocal } = req.data || {};
  if (!titulo || !inicio) throw new HttpsError('invalid-argument', 'Título e data/hora são obrigatórios.');
  const dataInicio = new Date(inicio);
  if (isNaN(dataInicio.getTime())) throw new HttpsError('invalid-argument', 'Data/hora inválida.');
  const tipoLimpo = ['evento', 'tarefa', 'lembrete'].includes(tipo) ? tipo : 'evento';

  // Todos podem convidar pessoas e usar "para todos". Criador sempre incluso.
  let parts = [auth.uid];
  let paraTodos = false;
  if (todos) {
    paraTodos = true;
    parts = [auth.uid];
  } else if (Array.isArray(participantes) && participantes.length) {
    const set = new Set([auth.uid, ...participantes]);
    parts = [...set].slice(0, 300);
  }

  // Busca os nomes dos participantes para exibir nos convites
  const participantesNomes = {};
  await Promise.all(parts.map(async uid => {
    try {
      const u = await admin.auth().getUser(uid);
      participantesNomes[uid] = u.displayName || u.email || uid;
    } catch { participantesNomes[uid] = uid; }
  }));

  // RSVP: criador aceita automaticamente; demais ficam "pendente"
  const rsvp = {};
  for (const uid of parts) rsvp[uid] = uid === auth.uid ? 'aceito' : 'pendente';

  const tituloLimpo = String(titulo).slice(0, 120);
  const descricaoLimpa = descricao ? String(descricao).slice(0, 500) : '';

  const ref = await db.collection('events').add({
    titulo: tituloLimpo,
    descricao: descricaoLimpa,
    inicio: admin.firestore.Timestamp.fromDate(dataInicio),
    tipo: tipoLimpo,
    participantes: parts,
    todos: paraTodos,
    rsvp,
    participantesNomes,
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

// Edita um evento existente — só quem criou (ou admin). Não mexe em participantes/"todos"
// (mudar isso exigiria resetar RSVP de quem já respondeu, fora do escopo aqui).
exports.editarEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { id, titulo, inicio, descricao, tipo, dataLocal } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  if (!titulo || !inicio) throw new HttpsError('invalid-argument', 'Título e data/hora são obrigatórios.');
  const dataInicio = new Date(inicio);
  if (isNaN(dataInicio.getTime())) throw new HttpsError('invalid-argument', 'Data/hora inválida.');
  const tipoLimpo = ['evento', 'tarefa', 'lembrete'].includes(tipo) ? tipo : 'evento';

  const ref = db.collection('events').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Compromisso não encontrado.');
  const dados = snap.data();
  if (dados.criadoPor !== auth.uid && !ehAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Só quem criou (ou admin) pode editar.');
  }

  const tituloLimpo = String(titulo).slice(0, 120);
  const descricaoLimpa = descricao ? String(descricao).slice(0, 500) : '';

  await ref.update({
    titulo: tituloLimpo,
    descricao: descricaoLimpa,
    inicio: admin.firestore.Timestamp.fromDate(dataInicio),
    tipo: tipoLimpo,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  // Re-sincroniza com o Google: remove o item antigo (se existia) e insere de novo já
  // atualizado — mais simples que um PATCH seletivo, e cobre troca de tipo (evento ↔ tarefa).
  try {
    const removerAntigo = async (mapa, ehTarefa) => {
      if (!mapa) return;
      for (const [uid, gid] of Object.entries(mapa)) {
        try {
          const tokSnap = await db.collection('google_tokens').doc(uid).get();
          if (!tokSnap.exists || !tokSnap.data().refreshToken) continue;
          const accessToken = await getAccessToken(tokSnap.data().refreshToken);
          if (ehTarefa) await removerTarefaGoogle(accessToken, gid);
          else await removerEventoGoogle(accessToken, gid);
        } catch (e) {
          console.warn(`Remover Google (editarEvento) falhou p/ ${uid}:`, e.message);
        }
      }
    };
    await removerAntigo(dados.googleEventIds, false);
    await removerAntigo(dados.googleTaskIds, true);

    const alvos = dados.todos ? await uidsConectados() : (dados.participantes || []);
    const inicioISO = dataInicio.toISOString();
    const fimISO = new Date(dataInicio.getTime() + 60 * 60 * 1000).toISOString();
    const dueISO = (dataLocal && /^\d{4}-\d{2}-\d{2}$/.test(dataLocal))
      ? `${dataLocal}T00:00:00.000Z` : inicioISO;
    const ids = await sincronizarParaGoogle(alvos, {
      titulo: tituloLimpo, descricao: descricaoLimpa, inicioISO, fimISO, dueISO
    }, tipoLimpo);
    const campoNovo   = (tipoLimpo === 'evento') ? 'googleEventIds' : 'googleTaskIds';
    const campoAntigo = (tipoLimpo === 'evento') ? 'googleTaskIds' : 'googleEventIds';
    const update = { [campoNovo]: ids };
    if (dados[campoAntigo]) update[campoAntigo] = admin.firestore.FieldValue.delete();
    await ref.update(update);
  } catch (e) {
    console.warn('Sync Google (editarEvento) falhou:', e.message);
  }

  return { ok: true };
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
        rsvp: x.rsvp || {},
        meuRsvp: (x.rsvp && x.rsvp[auth.uid]) || 'aceito', // eventos antigos sem rsvp = aceito
        participantesNomes: x.participantesNomes || {},
        // id do item no Google (pra não trazer ele de volta duplicado na leitura reversa)
        googleId: (x.googleEventIds && x.googleEventIds[auth.uid]) ||
                  (x.googleTaskIds && x.googleTaskIds[auth.uid]) || null
      });
    }
  });
  return lista;
});

// ─── Leitura reversa: itens criados DIRETO no Google (Agenda + Tarefas) ───────
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
    if (!resp.ok) console.warn('listarGoogleAgenda DEBUG Calendar status', resp.status, JSON.stringify(data).slice(0, 300));
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
    if (!resp.ok) console.warn('listarGoogleAgenda DEBUG Tasks status', resp.status, JSON.stringify(data).slice(0, 300));
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

// ─── Fotografia — links de Drive por pessoa ───────────────────────────────────
// Quem tem "drives_fotografia" vê todos + pode editar. Outros veem só o próprio.
exports.getFotoDrives = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const podeGerenciar = await temPermissaoFotografia(auth);
  if (podeGerenciar) {
    const [usuarios, drivesSnap] = await Promise.all([
      admin.auth().listUsers(1000),
      db.collection('foto_drives').get()
    ]);
    const drives = {};
    drivesSnap.forEach(d => { drives[d.id] = d.data().driveLink || ''; });
    return {
      gerenciar: true,
      pessoas: usuarios.users.filter(u => !u.disabled).map(u => ({
        uid: u.uid,
        nome: u.displayName || u.email || u.uid,
        driveLink: drives[u.uid] || ''
      }))
    };
  }
  const snap = await db.collection('foto_drives').doc(auth.uid).get();
  return { gerenciar: false, driveLink: snap.exists ? (snap.data().driveLink || '') : '' };
});

exports.setFotoDrive = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!(await temPermissaoFotografia(auth))) {
    throw new HttpsError('permission-denied', 'Você não tem permissão para gerenciar drives de fotografia.');
  }
  const { uid, driveLink } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const link = typeof driveLink === 'string' ? driveLink.trim() : '';
  if (link) {
    await db.collection('foto_drives').doc(uid).set({
      driveLink: link,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid
    });
  } else {
    await db.collection('foto_drives').doc(uid).delete();
  }
  return { ok: true };
});

// Lista pessoas para escolher participantes (qualquer usuário autenticado)
exports.listarPessoas = onCall(async (req) => {
  exigirAutenticado(req);
  const result = await admin.auth().listUsers(1000);
  return result.users.filter(u => !u.disabled).map(u => ({ uid: u.uid, nome: u.displayName || u.email || u.uid })); // fix 6: exclui contas desativadas
});

// Responder a um convite de reunião (aceitar ou recusar)
exports.responderConvite = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { eventoId, status } = req.data || {};
  if (!eventoId) throw new HttpsError('invalid-argument', 'eventoId é obrigatório.');
  if (!['aceito', 'recusado'].includes(status))
    throw new HttpsError('invalid-argument', 'Status deve ser "aceito" ou "recusado".');

  const ref = db.collection('events').doc(eventoId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Evento não encontrado.');

  const dados = snap.data();
  if (dados.criadoPor === auth.uid)
    throw new HttpsError('failed-precondition', 'O organizador não precisa responder.');
  const eParticipante = dados.todos === true || (Array.isArray(dados.participantes) && dados.participantes.includes(auth.uid));
  if (!eParticipante)
    throw new HttpsError('permission-denied', 'Você não foi convidado para este evento.');

  await ref.update({ [`rsvp.${auth.uid}`]: status });
  return { ok: true };
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

  // Para "todos": conta usuários ativos para exibir progresso de confirmações
  let totalDestinatarios = parts.length;
  if (paraTodos) {
    try {
      const users = await admin.auth().listUsers(1000);
      // Exclui o próprio admin que enviou (ele não recebe o próprio aviso)
      totalDestinatarios = users.users.filter(u => u.uid !== auth.uid && !u.disabled).length;
    } catch (e) { totalDestinatarios = 0; }
  }

  const ref = await db.collection('notifications').add({
    titulo: titulo ? String(titulo).slice(0, 120) : '',
    mensagem: String(mensagem).slice(0, 1000),
    todos: paraTodos,
    destinatarios: parts,
    totalDestinatarios,
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

// Marca um aviso como visto (a pessoa clicou em "Vi"). Se com isso todo mundo já
// confirmou, apaga o aviso na hora — não precisa esperar a limpeza dos 30 dias.
exports.marcarNotificacaoLida = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  const ref = db.collection('notifications').doc(id);
  await ref.update({ lidoPor: admin.firestore.FieldValue.arrayUnion(auth.uid) });

  try {
    const snap = await ref.get();
    if (snap.exists) {
      const x = snap.data();
      const lidoPor = Array.isArray(x.lidoPor) ? x.lidoPor : [];
      const total = x.totalDestinatarios || 0;
      if (total > 0 && lidoPor.length >= total) await ref.delete();
    }
  } catch (e) { console.warn('Limpeza de aviso (todos confirmaram):', e.message); }

  return { ok: true };
});

// Limpeza automática: apaga avisos com mais de 30 dias (roda 1x por dia).
// Cobre o caso de avisos que nunca foram confirmados por todo mundo.
// Retenção do log de auditoria: mantém os últimos 15 eventos por pessoa,
// apaga o resto (LGPD — minimização). Rodagem diária.
exports.limparAuditoriaAntiga = onSchedule('every 24 hours', async () => {
  const snap = await db.collection('audit_log').orderBy('em', 'desc').get();
  if (snap.empty) return;
  const porAtor = new Map();
  const paraApagar = [];
  snap.forEach(d => {
    const uid = d.data().ator?.uid || 'anonimo';
    const cnt = (porAtor.get(uid) || 0) + 1;
    porAtor.set(uid, cnt);
    if (cnt > 15) paraApagar.push(d.ref);
  });
  if (!paraApagar.length) return;
  // Firestore batch permite até 500 ops por vez
  for (let i = 0; i < paraApagar.length; i += 400) {
    const batch = db.batch();
    paraApagar.slice(i, i + 400).forEach(r => batch.delete(r));
    await batch.commit();
  }
  console.log(`Auditoria trimada: ${paraApagar.length} eventos antigos removidos.`);
});

exports.limparAvisosAntigos = onSchedule('every 24 hours', async () => {
  const limite = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snap = await db.collection('notifications').where('criadoEm', '<', limite).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
  console.log(`Avisos antigos removidos: ${snap.size}`);
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
  for (let i = 0; i < tamanho; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)]; // fix 4: crypto seguro
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
  if (!displayName || !displayName.trim()) {
    throw new HttpsError('invalid-argument', 'Nome e sobrenome são obrigatórios.');
  }

  // Normaliza: "JOÃO SILVA" ou "joão silva" → "João Silva"
  const nomeNormalizado = displayName.trim().toLowerCase()
    .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

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
      displayName: nomeNormalizado
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

  await registrarAudit(null, 'criou_conta', { tipo: 'usuario', id: user.uid },
    { email, displayName: nomeNormalizado, codigo: codigo.trim().toUpperCase(), fazAdmin: !!dadosCodigo.fazAdmin });
  return { ok: true, uid: user.uid, fazAdmin: !!dadosCodigo.fazAdmin };
});

// ─── Fichas: escrita do cliente (sem login) ──────────────────────────────────
// O cliente preenche a ficha por link, sem conta. Antes ele gravava direto no
// Firestore e as regras validavam o formato; qualquer um na internet podia criar
// documento e sobrescrever ficha alheia sabendo o id. Agora as regras negam
// escrita do cliente e tudo passa por aqui — mesma regra de ouro da Locação.
// É também o ponto onde dá pra exigir App Check depois.

const FICHA_COLECOES = ['fichas', 'fichas_locador'];
const FICHA_TIPOS = ['pf', 'pj', 'vendedor', 'proposta', 'fianca', 'locacao_fiador'];
// Só aceitamos anexo que aponte pro nosso bucket, nas pastas das fichas. Sem isso,
// um cliente podia gravar qualquer URL em `documentos` e o corretor clicaria nela.
// As pastas diferem por página: as fichas por tipo usam `fichas/<tipo>/...` e a do
// locador usa `fichas-locador/...` (com hífen). O path vem urlencoded (`%2F`).
const FICHA_DOC_BASE =
  'https://firebasestorage.googleapis.com/v0/b/remax-smart-hub.firebasestorage.app/o/';
const FICHA_DOC_PASTAS = ['fichas%2F', 'fichas-locador%2F'];
const ehUrlDeAnexoDaFicha = (url) =>
  typeof url === 'string' &&
  url.startsWith(FICHA_DOC_BASE) &&
  FICHA_DOC_PASTAS.some(pasta => url.slice(FICHA_DOC_BASE.length).startsWith(pasta));
// Depois de enviada ao admin (ou finalizada) a ficha não aceita mais escrita do cliente.
const FICHA_STATUS_EDITAVEL = ['aguardando_corretor', 'aguardando_edicao_cliente', 'correcao_solicitada'];

function validarDadosFicha(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new HttpsError('invalid-argument', 'Dados inválidos.');
  }
  const chaves = Object.keys(dados);
  if (chaves.length > 400) throw new HttpsError('invalid-argument', 'Ficha com campos demais.');
  for (const k of chaves) {
    if (k.length > 80) throw new HttpsError('invalid-argument', 'Nome de campo inválido.');
    const v = dados[k];
    const tipo = typeof v;
    if (tipo !== 'string' && tipo !== 'number' && tipo !== 'boolean') {
      throw new HttpsError('invalid-argument', `Campo "${k}" com tipo não suportado.`);
    }
    if (tipo === 'string' && v.length > 5000) {
      throw new HttpsError('invalid-argument', `Campo "${k}" longo demais.`);
    }
  }
  // Firestore trava em 1 MB por documento; recusamos antes pra dar erro legível.
  if (Buffer.byteLength(JSON.stringify(dados), 'utf8') > 900000) {
    throw new HttpsError('invalid-argument', 'Ficha grande demais.');
  }
  return dados;
}

function validarDocumentosFicha(documentos) {
  if (documentos == null) return {};
  if (typeof documentos !== 'object' || Array.isArray(documentos)) {
    throw new HttpsError('invalid-argument', 'Documentos inválidos.');
  }
  const chaves = Object.keys(documentos);
  if (chaves.length > 60) throw new HttpsError('invalid-argument', 'Documentos demais.');
  for (const k of chaves) {
    if (!ehUrlDeAnexoDaFicha(documentos[k])) {
      throw new HttpsError('invalid-argument', `Anexo "${k}" fora do storage do Hub.`);
    }
  }
  return documentos;
}

function validarPendentes(pendentes) {
  if (pendentes == null) return [];
  if (!Array.isArray(pendentes) || pendentes.length > 60) {
    throw new HttpsError('invalid-argument', 'Pendências inválidas.');
  }
  for (const p of pendentes) {
    if (typeof p !== 'string' || p.length > 80) {
      throw new HttpsError('invalid-argument', 'Pendências inválidas.');
    }
  }
  return pendentes;
}

// Cria ou atualiza a ficha preenchida pelo cliente. SEM login por design —
// o link é a credencial, igual aos portais. Quem chama nunca escolhe o status.
exports.salvarFichaPublica = onCall(async (req) => {
  const {
    colecao, fichaId, tipo, corretorUid, corretorNome, imovelId,
    dados, documentos, pendentes
  } = req.data || {};

  if (!FICHA_COLECOES.includes(colecao)) {
    throw new HttpsError('invalid-argument', 'Coleção inválida.');
  }
  const dadosOk = validarDadosFicha(dados);
  const docsOk = validarDocumentosFicha(documentos);
  const pendOk = validarPendentes(pendentes);
  const agora = admin.firestore.FieldValue.serverTimestamp();

  // ── Atualização: o cliente reabre o link e reenvia ──
  if (fichaId) {
    if (typeof fichaId !== 'string' || fichaId.length > 200) {
      throw new HttpsError('invalid-argument', 'fichaId inválido.');
    }
    const ref = db.collection(colecao).doc(fichaId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');

    const atual = snap.data();
    if (!FICHA_STATUS_EDITAVEL.includes(atual.status)) {
      throw new HttpsError('failed-precondition', 'Esta ficha não aceita mais alterações.');
    }
    // corretorUid e tipo são imutáveis: o que veio do cliente é ignorado de propósito.
    await ref.update({
      status: 'aguardando_corretor',
      observacaoCorretor: '',
      dados: dadosOk,
      documentos: { ...(atual.documentos || {}), ...docsOk },
      pendentes: pendOk,
      atualizadoEm: agora
    });
    return { ok: true, fichaId };
  }

  // ── Criação ──
  if (typeof corretorUid !== 'string' || !corretorUid) {
    throw new HttpsError('invalid-argument', 'corretorUid obrigatório.');
  }
  // O link carrega o uid do corretor na query. Confirmamos que existe mesmo,
  // pra não acumular ficha órfã apontando pra uid inventado.
  try {
    await admin.auth().getUser(corretorUid);
  } catch (_) {
    throw new HttpsError('invalid-argument', 'Corretor não encontrado.');
  }

  const novo = {
    corretorUid,
    corretorNome: typeof corretorNome === 'string' ? corretorNome.slice(0, 200) : '',
    status: 'aguardando_corretor',
    observacaoCorretor: '',
    dados: dadosOk,
    documentos: docsOk,
    pendentes: pendOk,
    criadoEm: agora
  };
  if (colecao === 'fichas') {
    if (!FICHA_TIPOS.includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo de ficha inválido.');
    novo.tipo = tipo;
  }
  if (typeof imovelId === 'string' && imovelId) novo.imovelId = imovelId;

  const ref = await db.collection(colecao).add(novo);
  return { ok: true, fichaId: ref.id };
});

// ─── Fichas do Locador ───────────────────────────────────────────────────────

// Lista as fichas recebidas pelo corretor autenticado.
exports.listarFichasLocador = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const uid = req.auth.uid;
  const isAdmin = req.auth.token.admin;

  // Sem orderBy aqui: where + orderBy em campos diferentes exigiria índice composto.
  // Ordenamos em memória (mais novo primeiro).
  let query = db.collection('fichas_locador');
  if (!isAdmin) query = query.where('corretorUid', '==', uid);

  const snap = await query.limit(100).get();
  // id: d.id (Firestore doc ID) vem DEPOIS do spread pra não ser sobrescrito pelo campo interno 'id'
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id, criadoEm: d.data().criadoEm?.toDate?.()?.toISOString() }))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

// Corretor envia a ficha revisada para o administrativo.
exports.enviarFichaParaAdmin = onCall({ secrets: [SUPPORT_EMAIL_PASS] }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');

  const ref = db.collection('fichas_locador').doc(fichaId);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');

  const uid = req.auth.uid;
  const isAdmin = req.auth.token.admin;
  if (!isAdmin && doc.data().corretorUid !== uid) throw new HttpsError('permission-denied', 'Sem permissão.');

  await ref.update({ status: 'enviado_admin', enviadoAdminEm: admin.firestore.FieldValue.serverTimestamp() });

  // Avisa o administrativo por email
  await avisarFichaAdminPorEmail(doc.data(), 'Ficha do Locador');

  // Notifica admins no Hub (reutiliza a coleção de notificações)
  const adminsSnap = await db.collection('user_profiles').where('isAdmin', '==', true).get();
  const batch = db.batch();
  adminsSnap.docs.forEach(a => {
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      para: a.id,
      titulo: 'Ficha do Locador',
      mensagem: `Nova ficha enviada por ${doc.data().corretorNome || 'um corretor'} para análise.`,
      lido: false,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();

  return { ok: true };
});

// Lista fichas enviadas para análise administrativa (requer permissão analise_locador ou admin).
exports.listarFichasParaAnalise = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');

  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;

  // Verifica permissão se não for admin
  if (!isAdm) {
    const permSnap = await db.collection('user_access').doc(uid).get();
    const apps = permSnap.exists ? (permSnap.data().apps || []) : [];
    if (!apps.includes('analise_locador')) throw new HttpsError('permission-denied', 'Sem permissão.');
  }

  const snap = await db.collection('fichas_locador')
    .where('status', '==', 'enviado_admin')
    .limit(100)
    .get();

  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    criadoEm:        d.data().criadoEm?.toDate?.()?.toISOString(),
    enviadoAdminEm:  d.data().enviadoAdminEm?.toDate?.()?.toISOString()
  }));
});

// Marca ficha como finalizada (analisada pelo admin).
exports.finalizarFichaLocador = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');

  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;
  if (!isAdm) {
    const permSnap = await db.collection('user_access').doc(uid).get();
    const apps = permSnap.exists ? (permSnap.data().apps || []) : [];
    if (!apps.includes('analise_locador')) throw new HttpsError('permission-denied', 'Sem permissão.');
  }

  await db.collection('fichas_locador').doc(fichaId).update({
    status: 'finalizado',
    finalizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    finalizadoPor: uid
  });
  return { ok: true };
});

// Exclui uma ficha (corretor dono ou admin).
exports.excluirFichaLocador = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');

  // Tenta pelo doc ID direto; se não achar, busca pelo campo 'id' interno (fichas antigas)
  let fichaRef = db.collection('fichas_locador').doc(fichaId);
  let fichaSnap = await fichaRef.get();
  if (!fichaSnap.exists) {
    const q = await db.collection('fichas_locador').where('id', '==', fichaId).limit(1).get();
    if (q.empty) throw new HttpsError('not-found', 'Ficha não encontrada.');
    fichaRef  = q.docs[0].ref;
    fichaSnap = q.docs[0];
  }

  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;
  if (!isAdm && fichaSnap.data().corretorUid !== uid) throw new HttpsError('permission-denied', 'Sem permissão.');

  await fichaRef.delete();
  return { ok: true };
});

// Devolve ficha ao cliente para edição — retorna o link de edição.
exports.reenviarFichaParaCliente = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId, observacao } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');

  const fichaRef = db.collection('fichas_locador').doc(fichaId);
  const fichaSnap = await fichaRef.get();
  if (!fichaSnap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');

  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;
  if (!isAdm && fichaSnap.data().corretorUid !== uid) throw new HttpsError('permission-denied', 'Sem permissão.');

  await fichaRef.update({
    status: 'aguardando_edicao_cliente',
    observacaoCorretor: observacao || '',
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  const dados = fichaSnap.data();
  const link = `https://remax-smart-hub.web.app/ficha-locador.html?modo=edicao&idFicha=${fichaId}&corretor=${dados.corretorUid}&nome=${encodeURIComponent(dados.corretorNome || '')}`;
  return { ok: true, link };
});

// ─── Fichas genéricas (pf, pj, vendedor, locacao_fiador, proposta) ───────────
// Usa a coleção `fichas` com campo `tipo` para diferenciar os formulários.

const TIPOS_VALIDOS = ['pf','pj','locacao_fiador','vendedor','proposta','fianca'];

function assertTipo(tipo) {
  if (!TIPOS_VALIDOS.includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo de ficha inválido.');
}

async function assertDono(fichaSnap, uid, isAdm) {
  if (!fichaSnap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  if (!isAdm && fichaSnap.data().corretorUid !== uid) throw new HttpsError('permission-denied', 'Sem permissão.');
}

exports.listarFichasTipo = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { tipo } = req.data || {};
  assertTipo(tipo);
  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;

  let q = db.collection('fichas').where('tipo', '==', tipo);
  if (!isAdm) q = q.where('corretorUid', '==', uid);
  const snap = await q.limit(100).get();
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id, criadoEm: d.data().criadoEm?.toDate?.()?.toISOString() }))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

exports.enviarFichaTipoAdmin = onCall({ secrets: [SUPPORT_EMAIL_PASS] }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  const ref = db.collection('fichas').doc(fichaId);
  const snap = await ref.get();
  await assertDono(snap, req.auth.uid, req.auth.token.admin);
  await ref.update({ status: 'enviado_admin', enviadoAdminEm: admin.firestore.FieldValue.serverTimestamp() });

  // Avisa o administrativo por email
  const nomesFicha = { pf:'Ficha (Pessoa Física)', pj:'Ficha (Pessoa Jurídica)', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta' };
  const ficha = snap.data();
  await avisarFichaAdminPorEmail(ficha, nomesFicha[ficha.tipo] || 'Ficha');

  return { ok: true };
});

exports.excluirFichaTipo = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  const ref = db.collection('fichas').doc(fichaId);
  let snap = await ref.get();
  let alvoRef = ref;
  if (!snap.exists) {
    // Fichas antigas: busca pelo campo 'id' interno
    const q = await db.collection('fichas').where('id', '==', fichaId).limit(1).get();
    if (q.empty) throw new HttpsError('not-found', 'Ficha não encontrada.');
    snap = q.docs[0]; alvoRef = q.docs[0].ref;
  }
  await assertDono(snap, req.auth.uid, req.auth.token.admin); // checa posse nos DOIS caminhos
  await alvoRef.delete();
  return { ok: true };
});

exports.reenviarFichaTipoCliente = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId, observacao } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  const ref = db.collection('fichas').doc(fichaId);
  const snap = await ref.get();
  await assertDono(snap, req.auth.uid, req.auth.token.admin);
  const d = snap.data();
  await ref.update({ status: 'aguardando_edicao_cliente', observacaoCorretor: observacao || '', atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
  const arquivo = `ficha-${d.tipo === 'locacao_fiador' ? 'locacao-fiador' : d.tipo}.html`;
  const link = `https://remax-smart-hub.web.app/${arquivo}?modo=edicao&idFicha=${fichaId}&corretor=${d.corretorUid}&nome=${encodeURIComponent(d.corretorNome||'')}`;
  return { ok: true, link };
});

exports.listarFichasTipoAnalise = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { tipo } = req.data || {};
  assertTipo(tipo);
  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;
  if (!isAdm) {
    const perm = await db.collection('user_access').doc(uid).get();
    if (!(perm.exists && (perm.data().apps||[]).includes('analise_locador'))) throw new HttpsError('permission-denied', 'Sem permissão.');
  }
  const snap = await db.collection('fichas').where('tipo','==',tipo).where('status','==','enviado_admin').limit(100).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id, criadoEm: d.data().criadoEm?.toDate?.()?.toISOString(), enviadoAdminEm: d.data().enviadoAdminEm?.toDate?.()?.toISOString() }));
});

// ─── Notificações do sininho: fichas que precisam de atenção ─────────────────
exports.contarNotifFichas = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const uid    = req.auth.uid;
  const isAdm  = ehAdminAuth(req.auth);
  const nomesFicha = { locador:'Ficha do Locador', pf:'Ficha (Pessoa Física)', pj:'Ficha (Pessoa Jurídica)', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta' };
  const items = [];

  if (isAdm) {
    // Admin vê tudo que foi enviado ao admin (aguardando análise)
    const snapLoc = await db.collection('fichas_locador').where('status','==','enviado_admin').limit(50).get();
    snapLoc.forEach(d => { const f = d.data(); items.push({ id:d.id, tipo:'locador', nome:f.dados?.nome||'Sem nome', corretor:f.corretorNome||'—', data:f.enviadoAdminEm?.toDate?.()?.toISOString()||null }); });
    const snapGen = await db.collection('fichas').where('status','==','enviado_admin').limit(50).get();
    snapGen.forEach(d => { const f = d.data(); items.push({ id:d.id, tipo:f.tipo||'pf', nome:f.dados?.nome||'Sem nome', corretor:f.corretorNome||'—', data:f.enviadoAdminEm?.toDate?.()?.toISOString()||null }); });
  } else {
    // Corretor vê as fichas que o cliente devolveu (aguardando revisão)
    const snapLoc = await db.collection('fichas_locador').where('corretorUid','==',uid).where('status','==','aguardando_corretor').limit(50).get();
    snapLoc.forEach(d => { const f = d.data(); items.push({ id:d.id, tipo:'locador', nome:f.dados?.nome||'Sem nome', data:f.atualizadoEm?.toDate?.()?.toISOString()||null }); });
    const snapGen = await db.collection('fichas').where('corretorUid','==',uid).where('status','==','aguardando_corretor').limit(50).get();
    snapGen.forEach(d => { const f = d.data(); items.push({ id:d.id, tipo:f.tipo||'pf', nome:f.dados?.nome||'Sem nome', data:f.atualizadoEm?.toDate?.()?.toISOString()||null }); });
  }

  return { total: items.length, items: items.map(i => ({ ...i, tipoLabel: nomesFicha[i.tipo]||i.tipo })) };
});

exports.finalizarFichaTipo = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  // Finalizar é ação de análise (admin ou quem tem analise_locador) — não do dono da ficha.
  const uid = req.auth.uid;
  const isAdm = req.auth.token.admin;
  if (!isAdm) {
    const perm = await db.collection('user_access').doc(uid).get();
    if (!(perm.exists && (perm.data().apps||[]).includes('analise_locador'))) throw new HttpsError('permission-denied', 'Sem permissão.');
  }
  const ref = db.collection('fichas').doc(fichaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  await ref.update({ status: 'finalizado', finalizadoEm: admin.firestore.FieldValue.serverTimestamp(), finalizadoPor: uid });
  return { ok: true };
});

// ─── Trigger: avisa o corretor por email quando recebe ficha do cliente ───────
const NOMES_FICHA = { locador:'Ficha do Locador', pf:'Ficha Locatário (PF)', pj:'Ficha Locatário (PJ)', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta' };

async function avisarCorretorFichaRecebida(event) {
  const before = event.data.before?.data();
  const after  = event.data.after?.data();
  if (!after || after.status !== 'aguardando_corretor') return;
  if (before && before.status === 'aguardando_corretor') return;

  const corretorUid = after.corretorUid;
  if (!corretorUid) return;

  let email;
  try { email = (await admin.auth().getUser(corretorUid)).email; } catch (_) { return; }
  if (!email) return;

  const nomeCliente = after.dados?.nome || 'Cliente';
  const tipo = after.tipo ? (NOMES_FICHA[after.tipo] || 'Ficha') : 'Ficha do Locador';
  const reenvio = !!before;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
  });
  try {
    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: email,
      subject: `[Hub] ${tipo} recebida — ${nomeCliente}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
          + `<p>Olá, ${escaparHtml(after.corretorNome || 'corretor')}!</p>`
          + `<p>${reenvio ? 'O cliente <strong>reenviou</strong> a ficha após as correções' : 'Uma <strong>nova ficha</strong> foi preenchida pelo cliente'}.</p>`
          + `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">`
          + `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>Tipo</strong></td><td>${escaparHtml(tipo)}</td></tr>`
          + `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>Cliente</strong></td><td>${escaparHtml(nomeCliente)}</td></tr>`
          + (after.dados?.whatsapp ? `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>WhatsApp</strong></td><td>${escaparHtml(after.dados.whatsapp)}</td></tr>` : '')
          + `</table>`
          + `<p>Acesse o <strong>Hub</strong> para revisar a ficha.</p>`
          + `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">`
          + `<p style="font-size:12px;color:#999">E-mail automático do Hub REMAX Smart.</p>`
          + `</div>`,
      text: `${tipo} recebida de ${nomeCliente}. Acesse o Hub para revisar.`
    });
  } catch (e) {
    await logErro('avisarCorretorFichaRecebida', e, { corretorUid, tipo });
  }
}

exports.onFichaLocadorRecebida = onDocumentWritten({
  document: 'fichas_locador/{fichaId}',
  secrets: [SUPPORT_EMAIL_PASS]
}, avisarCorretorFichaRecebida);

exports.onFichaTipoRecebida = onDocumentWritten({
  document: 'fichas/{fichaId}',
  secrets: [SUPPORT_EMAIL_PASS]
}, avisarCorretorFichaRecebida);

// ─── Backup diário do Firestore ───────────────────────────────────────────────
// Exporta todas as coleções para gs://remax-smart-hub-backups/{data}.
// Pré-requisitos (1x): criar o bucket e dar permissão ao service account.
exports.backupFirestore = onSchedule({
  schedule: '0 3 * * *',
  timeZone: TZ
}, async () => {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const projectId = 'remax-smart-hub';
  const timestamp = new Date().toISOString().split('T')[0];

  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputUriPrefix: `gs://${projectId}-backups/${timestamp}` })
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    await logErro('backupFirestore', new Error(`${resp.status}: ${body}`));
    return;
  }

  console.log('Backup Firestore concluído para', `gs://${projectId}-backups/${timestamp}`);
});

// ─── Relatório diário de erros ────────────────────────────────────────────────
// Roda às 8h: se houve erros nas últimas 24h, manda email pro suporte.
// Limpa erros com mais de 7 dias.
exports.relatorioErrosDiario = onSchedule({
  schedule: '0 8 * * *',
  timeZone: TZ,
  secrets: [SUPPORT_EMAIL_PASS]
}, async () => {
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);

  const snap = await db.collection('_erros')
    .where('timestamp', '>=', ontem)
    .orderBy('timestamp', 'desc')
    .get();

  if (!snap.empty) {
    const linhas = snap.docs.map(d => {
      const e = d.data();
      const ctx = e.contexto && Object.keys(e.contexto).length
        ? ` (${JSON.stringify(e.contexto)})` : '';
      return `• [${e.funcao}] ${e.mensagem}${ctx}`;
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
    });

    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: SUPORTE_EMAIL,
      subject: `[Hub] ${snap.size} erro(s) nas últimas 24h`,
      html: `<div style="font-family:system-ui,sans-serif">`
          + `<h3 style="color:#c00">Erros detectados no Hub</h3>`
          + `<pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px">${linhas.join('\n')}</pre>`
          + `<p style="font-size:12px;color:#999">E-mail automático — Hub REMAX Smart</p></div>`,
      text: `Erros nas últimas 24h:\n\n${linhas.join('\n')}`
    });
  }

  // Limpa erros com mais de 7 dias
  const seteDias = new Date();
  seteDias.setDate(seteDias.getDate() - 7);
  const antigos = await db.collection('_erros')
    .where('timestamp', '<', seteDias)
    .get();
  if (!antigos.empty) {
    const batch = db.batch();
    antigos.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  console.log(`Relatório: ${snap.empty ? '0' : snap.size} erro(s); ${antigos?.size || 0} antigo(s) removido(s).`);
});
