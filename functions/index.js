const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
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

// ─── Projeto por ambiente ────────────────────────────────────────────────────
// As functions rodam em produção E no staging (remax-smart-hub-staging) com o
// MESMO código. Tudo que aponta pro próprio projeto (Hosting das fichas/portais,
// bucket do Storage) é derivado daqui — cravar a URL de produção fazia o staging
// gerar links de ficha de PRODUÇÃO (dado de teste iria pro banco real) e falhar
// nos anexos (bucket de outro projeto). O KMS continua cravado em produção de
// propósito: o cofre de credenciais é um recurso só de produção.
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'remax-smart-hub';
const HOSTING_BASE = `https://${PROJECT_ID}.web.app`;
const PROJECT_BUCKET = `${PROJECT_ID}.firebasestorage.app`;

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
// Secret do cliente OAuth "Aplicativo da Web" (fluxo do navegador/PWA). O Desktop
// e o Web são clientes DIFERENTES no Google Cloud; o refresh_token é amarrado ao
// cliente que o emitiu, então guardamos por-usuário qual foi (campo `web`).
const GOOGLE_CLIENT_SECRET_WEB = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET_WEB');
// Senha de app (Google Workspace) da conta que envia/recebe os chamados de suporte.
const SUPPORT_EMAIL_PASS = defineSecret('SUPPORT_EMAIL_PASS');
// Fine-grained PAT (Contents+Pull requests: write) que dispara o Bug Fix Bot no GitHub Actions.
const BOT_GH_TOKEN = defineSecret('BOT_GH_TOKEN');
// Segredo compartilhado com o workflow do caça-bugs (header x-bot-secret) — só ele
// pode entregar achados pro botReceberAchados. Gerado por nós; não é credencial de conta.
const BOT_HOOK_SECRET = defineSecret('BOT_HOOK_SECRET');
const HUB_CHECKVISTO_SECRET = defineSecret('HUB_CHECKVISTO_SECRET'); // integração CheckVisto (INTEGRACAO-CHECKVISTO.md)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY'); // Assistente de Leads (IA · Gemini)
const RECRUTAMENTO_SECRET = defineSecret('RECRUTAMENTO_SECRET'); // webhook do formulário de recrutamento de corretores
const BOT_REPO = 'Goldencat7/remax-smart-hub';       // owner/repo alvo do repository_dispatch
const SUPORTE_EMAIL = 'nathangabriel@remax.com.br'; // remetente + destino dos chamados
const FICHAS_ADMIN_EMAIL = 'marcelogutierres@remax.com.br'; // recebe aviso quando ficha é enviada ao admin
const GOOGLE_CLIENT_ID = '474454438949-8hu3emcu98oa9pb92qcd7ucq9elhj9nc.apps.googleusercontent.com';       // "Hub Desktop" (loopback do .exe)
const GOOGLE_CLIENT_ID_WEB = '474454438949-1t333dt83j46pph39uep7oqmv31i1t64.apps.googleusercontent.com'; // "Web client" (redirect https do navegador)
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

// Escolhe o cliente OAuth certo: web (redirect https / token conectado pelo navegador)
// vs desktop (loopback do .exe). O refresh_token só renova com o cliente que o emitiu.
function _googleClient(ehWeb) {
  return ehWeb
    ? { id: GOOGLE_CLIENT_ID_WEB, secret: GOOGLE_CLIENT_SECRET_WEB.value() }
    : { id: GOOGLE_CLIENT_ID,     secret: GOOGLE_CLIENT_SECRET.value() };
}

// Troca o "code" por tokens — o que importa é o refresh_token. redirect https ⇒ cliente web.
async function trocarCodePorTokens(code, codeVerifier, redirectUri) {
  const c = _googleClient(/^https:\/\//i.test(redirectUri || ''));
  return googleTokenRequest({
    code,
    client_id: c.id,
    client_secret: c.secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  });
}

// Gera um access_token novo a partir do refresh_token guardado. `ehWeb` = campo
// `web` do doc google_tokens (undefined nos tokens antigos do .exe ⇒ cliente desktop).
async function getAccessToken(refreshToken, ehWeb) {
  const c = _googleClient(!!ehWeb);
  const data = await googleTokenRequest({
    client_id: c.id,
    client_secret: c.secret,
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
      const accessToken = await getAccessToken(tokSnap.data().refreshToken, tokSnap.data().web);
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
  'OwcT6wCrXMgJ0tPADMUdKdBB8h32', // adminhub@smart.com
  'GpyXVhlmJhMUHliypiEwhoi27Fp1'  // nathangabrieldovale07@gmail.com (Nathan) — não pode ser rebaixado/deletado
  // adicionar aqui novos UIDs separados por vírgula
];
function ehBootstrapAdmin(uid) {
  return BOOTSTRAP_ADMIN_UIDS.includes(uid);
}

// Apps "restritos": só aparecem/funcionam pra quem o admin liberar (ou pra admins).
// ClickSign foi LIBERADO pra geral (2026-07-29) — a lista ficou vazia. A conta é
// compartilhada e a getCredentials entrega pra qualquer autenticado. Se um dia
// precisar voltar a restringir algum app, é só reincluir a key aqui.
const RESTRICTED_APPS = [];
// Apps concedíveis por pessoa no painel de Admin (não só os de credencial). Sem
// isso o setUserAccess descartava silenciosamente `analise_locador` (filtrava só
// por RESTRICTED_APPS), e a permissão nunca chegava a ninguém.
const GRANTABLE_APPS = [...RESTRICTED_APPS, 'analise_locador'];

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
exports.getMinhasPermissoes = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
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
  const limpos = Array.isArray(apps) ? apps.filter(a => GRANTABLE_APPS.includes(a)) : [];
  // Valida o usuário ANTES de qualquer gravação — evita write parcial (user_access gravado,
  // claims não) se o Auth não existir. O user_access pode ficar órfão após deleteUserAccount,
  // que só apaga o Auth.
  const userRec = await admin.auth().getUser(uid).catch(() => null);
  if (!userRec) throw new HttpsError('not-found', 'Usuário não encontrado.');
  await db.collection('user_access').doc(uid).set({
    apps: limpos,
    drives_fotografia: !!drives_fotografia,
    loc_beta: !!loc_beta,
    loc_gestao: !!loc_gestao,
    ti: !!ti,
    marketing_gerenciar: !!marketing_gerenciar,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  // Claims do token (autoridade nas regras). marketing_gerenciar vira CLAIM porque a
  // regra do Storage checa request.auth.token.marketing_gerenciar — o firestore.get()
  // cross-service dentro da regra de Storage é frágil e estava negando pra todos.
  // locRole (Locação) segue a mesma lógica. Uma única escrita de claims (merge).
  const claims = { ...(userRec.customClaims || {}) };
  if (marketing_gerenciar) claims.marketing_gerenciar = true; else delete claims.marketing_gerenciar;
  let role;
  if (loc_role !== undefined) {
    role = LOC_ROLES.includes(loc_role) ? loc_role : 'corretor';
    if (role === 'corretor') delete claims.locRole; else claims.locRole = role;   // preserva claim admin
  }
  await admin.auth().setCustomUserClaims(uid, claims);
  if (loc_role !== undefined) {
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
// Ao RECEBER a ficha do locador (status aguardando_corretor, sem esperar o corretor
// aprovar/enviar), materializamos o IMÓVEL na esteira + as PESSOAS (locadores).
// Idempotente: o id do imóvel = id da ficha (1 ficha do locador = 1 imóvel), então
// reenvio ATUALIZA em vez de duplicar e nunca reseta o status da esteira já avançado.

// Nomes de campo do locador na ficha são irregulares (loc1 usa chaves planas com
// `dataNasc`/`whatsapp`; loc2 usa prefixo `loc2_` com `nasc`/`celular`), então mapeamos
// explicitamente pra não perder dado.
const LOC_KEYS_1 = { nome:'nome', rg:'rg', cpf:'cpf', nasc:'dataNasc', civil:'estadoCivil', prof:'profissao', email:'email', whats:'whatsapp', fixo:'fixo', cep:'cep', end:'endereco', num:'numero', compl:'complemento', bairro:'bairro', cidade:'cidade', estado:'estado', conj:{ nome:'conj_nome', rg:'conj_rg', cpf:'conj_cpf', nasc:'conj_nasc', prof:'conj_profissao', regime:'conj_regime', email:'conj_email', celular:'conj_celular', fixo:'conj_fixo' } };
const LOC_KEYS_2 = { nome:'loc2_nome', rg:'loc2_rg', cpf:'loc2_cpf', nasc:'loc2_nasc', civil:'loc2_estadoCivil', prof:'loc2_profissao', email:'loc2_email', whats:'loc2_celular', fixo:'', cep:'loc2_cep', end:'loc2_endereco', num:'loc2_numero', compl:'loc2_complemento', bairro:'loc2_bairro', cidade:'loc2_cidade', estado:'loc2_estado', conj:{ nome:'loc2_conj_nome', rg:'loc2_conj_rg', cpf:'loc2_conj_cpf', nasc:'loc2_conj_nasc', prof:'loc2_conj_profissao', regime:'loc2_conj_regime', email:'loc2_conj_email', celular:'loc2_conj_celular', fixo:'loc2_conj_fixo' } };

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
    p.conjuge = { nome: v(keys.conj.nome), rg: v(keys.conj.rg), cpf: v(keys.conj.cpf), nasc: v(keys.conj.nasc), profissao: v(keys.conj.prof), regime: v(keys.conj.regime),
      email: v(keys.conj.email), celular: v(keys.conj.celular), fixo: v(keys.conj.fixo) };
  }
  return p;
}

function loc_montarImovel(dados) {
  const v = k => dados[k] || '';
  return {
    tipo: v('im_tipo'), referencia: v('im_ref'),
    matricula: v('im_matricula'), cartorio: v('im_cartorio'),   // p/ o contrato de representação (venda)
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

// Público (SEM login): devolve só o bloco "Imóvel de interesse" de um imóvel, pra
// pré-preencher a ficha que o interessado abre pelo link (&imovelId=). O imovelId
// (id aleatório do Firestore) é a credencial, como nos portais externos. NÃO devolve
// PII do proprietário, anexos, financeiro nem a lista de interessados — só endereço,
// tipo e valor do anúncio (o que o interessado já viu no anúncio do imóvel).
exports.imovelParaFicha = onCall(async (req) => {
  const imovelId = _txt(req.data && req.data.imovelId, 200);
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId obrigatório.');
  const snap = await db.collection('imoveis').doc(imovelId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const i = snap.data();
  const e = i.endereco || {};
  return {
    im_tipo: i.tipo || '',
    im_ref: i.referencia || '',
    im_cep: e.cep || '',
    im_endereco: e.logradouro || '',
    im_numero: e.numero || '',
    im_complemento: e.complemento || '',
    im_bairro: e.bairro || '',
    im_cidade: e.cidade || '',
    im_estado: e.estado || '',
    im_condominio: i.condominio || '',
    im_anuncio: i.valorAnuncio || ''
  };
});

// Stringify estável: ordena as chaves recursivamente antes de serializar. Serve pra
// comparar `dados`/`documentos` de duas versões da ficha sem falso-positivo por ordem
// de chaves diferente (o cliente reconstrói o objeto e a ordem pode variar). Sem isto,
// um re-save que não mudou nada poderia re-materializar o imóvel e reverter edições que
// o corretor fez na Carteira.
function _jsonEstavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_jsonEstavel).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _jsonEstavel(v[k])).join(',') + '}';
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

// Atribui protocolo a UM imóvel que ainda não tem, sem corrida: lê o imóvel e o
// contador na MESMA transação e só consome um número se o imóvel ainda estiver
// sem. Duas listagens concorrentes (o backfill do locListarImoveis) serializam
// no contador — a 2ª vê o número já gravado e não consome outro (antes gerava
// buracos na sequência). Idempotente.
async function _atribuirProtocoloSeFalta(imovelRef) {
  const counterRef = db.collection('counters').doc('imoveis');
  return await db.runTransaction(async (tx) => {
    const imovel = await tx.get(imovelRef);
    if (!imovel.exists) return null;
    const jaTem = imovel.data().numeroProtocolo;
    if (jaTem != null) return jaTem;
    const cs = await tx.get(counterRef);
    const novo = (cs.exists ? (cs.data().proximo || 0) : 0) + 1;
    tx.set(counterRef, { proximo: novo, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(imovelRef, { numeroProtocolo: novo }, { merge: true });
    return novo;
  });
}

// UIDs dos admins. Admin é custom claim `admin` (NÃO há campo isAdmin em
// user_profiles), então enumera pelos claims. ~dezenas de usuários = 1 página.
async function _uidsDosAdmins() {
  const r = await admin.auth().listUsers(1000);
  return r.users.filter(u => u.customClaims && u.customClaims.admin).map(u => u.uid);
}

// Trigger de ingestão: ficha do locador -> imóvel + pessoas. Materializa já no
// RECEBIMENTO da ficha (aguardando_corretor), sem esperar o corretor enviar ao admin.
exports.onFichaLocadorEnviadaAdmin = onDocumentWritten({ document: 'fichas_locador/{fichaId}' }, async (event) => {
  const after  = event.data.after?.data();
  const before = event.data.before?.data();
  // Materializa o imóvel assim que a ficha CHEGA (aguardando_corretor) — não espera
  // mais a aprovação do corretor (enviado_admin). Assim o imóvel nasce na Carteira já
  // no recebimento, mesmo incompleto/com pendências; o corretor trabalha nele lá dentro.
  const MATERIALIZA = ['aguardando_corretor', 'enviado_admin'];
  if (!after || !MATERIALIZA.includes(after.status)) return;
  const fichaId = event.params.fichaId;
  const dados = after.dados || {};
  const ts = () => admin.firestore.FieldValue.serverTimestamp();
  try {
    // Idempotência que PRESERVA edições do corretor na Carteira: se o imóvel JÁ existe e
    // os dados/anexos da ficha não mudaram, não reescreve. Imóvel ainda inexistente ⇒
    // sempre materializa (cobre criação nova, fichas antigas paradas e reenvio com dados novos).
    const imovelRef = db.collection('imoveis').doc(fichaId);
    const existente = await imovelRef.get();
    const mudou = _jsonEstavel(before?.dados || {}) !== _jsonEstavel(dados)
      || _jsonEstavel(before?.documentos || {}) !== _jsonEstavel(after.documentos || {});
    if (existente.exists && !mudou) return;
    // Ficha amarrada a um imóvel que JÁ existe (ex.: veio do feed do portal, sem
    // proprietário): preenche o proprietário NESSE card, sem criar um duplicado.
    // Guardas: só o dono do imóvel (o link carrega im.corretorUid) e só se o imóvel
    // ainda não tem outra ficha de dono vinculada. Fichas comuns (sem imovelId) não
    // entram aqui — comportamento da captação normal fica intacto.
    if (after.imovelId && after.imovelId !== fichaId) {
      const alvoRef = db.collection('imoveis').doc(after.imovelId);
      const alvoSnap = await alvoRef.get();
      if (alvoSnap.exists) {
        const im = alvoSnap.data();
        const donoOk = !!im.corretorUid && !!after.corretorUid && im.corretorUid === after.corretorUid;
        const semOutraFicha = !im.fichaId || im.fichaId === fichaId;
        if (donoOk && semOutraFicha) {
          if (im.fichaId === fichaId && !mudou) return;
          const pa = loc_montarPessoa(dados, LOC_KEYS_1);
          const ids = [];
          const a1 = `${fichaId}_loc1`;
          if (pa.nome) { await db.collection('pessoas').doc(a1).set({ ...pa, corretorUid: after.corretorUid, fichaId, imovelId: after.imovelId, atualizadoEm: ts() }, { merge: true }); ids.push(a1); }
          else { await db.collection('pessoas').doc(a1).delete().catch(() => {}); }
          const a2 = `${fichaId}_loc2`;
          if (dados.loc2_nome) { await db.collection('pessoas').doc(a2).set({ ...loc_montarPessoa(dados, LOC_KEYS_2), corretorUid: after.corretorUid, fichaId, imovelId: after.imovelId, atualizadoEm: ts() }, { merge: true }); ids.push(a2); }
          else { await db.collection('pessoas').doc(a2).delete().catch(() => {}); }
          const novaVinc = im.fichaId !== fichaId;
          await alvoRef.set({
            fichaId, fichaTipo: 'locador', locadorIds: ids, locadorNome: pa.nome || '',
            proprietarioNome: pa.nome || '',
            proprietarioContato: [pa.whatsapp || pa.fixo, pa.email].filter(Boolean).join(' · '),
            documentos: { ...(im.documentos || {}), ...(after.documentos || {}) },
            pendentes: after.pendentes || [], atualizadoEm: ts(),
            ...(novaVinc ? { timeline: admin.firestore.FieldValue.arrayUnion({ texto: 'Proprietário vinculado pela ficha do locador', porNome: 'Sistema', em: admin.firestore.Timestamp.now() }) } : {})
          }, { merge: true });
          await _bumpBroadcast('imovelSeq');
          return;
        }
      }
    }
    // Fichas de proprietário NÃO geram mais imóvel (v1.0.158): os imóveis vêm do iList
    // e a ficha só é PLUGADA num imóvel existente — via o bloco &imovelId= acima ou o
    // picker "vincular ficha existente" (carteiraVincularProprietario). Ficha solta sem
    // imóvel legado ⇒ nada nasce; ela fica só disponível no listarFichasProprietario, e as
    // pessoas (PII) são criadas na HORA do vínculo, não aqui.
    // Legado: um imoveis/{fichaId} criado ANTES desta mudança segue atualizado no reenvio.
    if (!existente.exists) return;
    // Pessoas (locadores) — ids determinísticos p/ idempotência
    const locadorIds = [];
    const p1 = loc_montarPessoa(dados, LOC_KEYS_1);
    const id1 = `${fichaId}_loc1`;
    if (p1.nome) {
      await db.collection('pessoas').doc(id1).set({ ...p1, corretorUid: after.corretorUid, fichaId, atualizadoEm: ts() }, { merge: true });
      locadorIds.push(id1);
    } else {
      // Simétrico ao loc2: se o 1º locador foi removido numa reedição, apaga o
      // doc órfão (senão CPF/RG do loc1 ficariam soltos em `pessoas` — LGPD).
      await db.collection('pessoas').doc(id1).delete().catch(() => {});
    }
    const id2 = `${fichaId}_loc2`;
    if (dados.loc2_nome) {
      await db.collection('pessoas').doc(id2).set({ ...loc_montarPessoa(dados, LOC_KEYS_2), corretorUid: after.corretorUid, fichaId, atualizadoEm: ts() }, { merge: true });
      locadorIds.push(id2);
    } else {
      // Se o 2º locador foi removido numa reedição, apaga o doc órfão (LGPD).
      await db.collection('pessoas').doc(id2).delete().catch(() => {});
    }
    // Imóvel — id = fichaId (imovelRef/existente já lidos no topo p/ a guarda de idempotência)
    const base = {
      ...loc_montarImovel(dados),
      corretorUid: after.corretorUid, corretorNome: after.corretorNome || '',
      fichaId, fichaTipo: 'locador', locadorIds, locadorNome: p1.nome || '',
      proprietarioNome: p1.nome || '',   // campo genérico da Carteira (venda usa o mesmo)
      proprietarioContato: [p1.whatsapp || p1.fixo, p1.email].filter(Boolean).join(' · '),
      documentos: after.documentos || {}, pendentes: after.pendentes || [],
      atualizadoEm: ts()
    };
    // existente.exists garantido pela guarda acima — só atualiza o card LEGADO
    // (merge preserva status + criadoEm + numeroProtocolo + situacao). Nunca cria um novo.
    await imovelRef.set(base, { merge: true });
  } catch (e) {
    await logErro('onFichaLocadorEnviadaAdmin', e, { fichaId });
  }
});

// Trigger de ingestão da VENDA: ficha do vendedor -> imóvel, já no RECEBIMENTO da ficha
// (aguardando_corretor), sem esperar o corretor enviar ao admin.
// Espelha o onFichaLocadorEnviadaAdmin: a ficha do vendedor usa as MESMAS chaves im_* de
// endereço, então o loc_montarImovel serve pros dois (os campos de repasse/adm que a ficha
// de venda não tem viram '' e não atrapalham). Venda não entra na esteira de locação
// (sem `status`); vive só na Carteira (finalidade/situacao).
exports.onFichaVendedorEnviadaAdmin = onDocumentWritten({ document: 'fichas/{fichaId}' }, async (event) => {
  const after  = event.data.after?.data();
  const before = event.data.before?.data();
  if (!after || after.tipo !== 'vendedor') return;
  // Igual ao locador: materializa o imóvel de venda já no recebimento (aguardando_corretor),
  // sem esperar a aprovação do corretor, mesmo com pendências.
  const MATERIALIZA = ['aguardando_corretor', 'enviado_admin'];
  if (!MATERIALIZA.includes(after.status)) return;
  const fichaId = event.params.fichaId;
  const dados = after.dados || {};
  const ts = () => admin.firestore.FieldValue.serverTimestamp();
  try {
    const imovelRef = db.collection('imoveis').doc(fichaId);
    const existente = await imovelRef.get();
    // Idempotência que preserva edições do corretor: só reescreve se o imóvel ainda não
    // existe (criação/retroativo) ou se os dados/anexos da ficha mudaram (reenvio).
    const mudou = _jsonEstavel(before?.dados || {}) !== _jsonEstavel(dados)
      || _jsonEstavel(before?.documentos || {}) !== _jsonEstavel(after.documentos || {});
    if (existente.exists && !mudou) return;
    // Ficha do vendedor amarrada a um imóvel que JÁ existe (ex.: veio do feed): preenche
    // o proprietário NESSE card, sem duplicar. Mesmas guardas do locador.
    if (after.imovelId && after.imovelId !== fichaId) {
      const alvoRef = db.collection('imoveis').doc(after.imovelId);
      const alvoSnap = await alvoRef.get();
      if (alvoSnap.exists) {
        const im = alvoSnap.data();
        const donoOk = !!im.corretorUid && !!after.corretorUid && im.corretorUid === after.corretorUid;
        const semOutraFicha = !im.fichaId || im.fichaId === fichaId;
        if (donoOk && semOutraFicha) {
          if (im.fichaId === fichaId && !mudou) return;
          const novaVinc = im.fichaId !== fichaId;
          await alvoRef.set({
            fichaId, fichaTipo: 'vendedor',
            proprietarioNome: dados.nome || '',
            proprietarioContato: [dados.whatsapp || dados.fixo, dados.email].filter(Boolean).join(' · '),
            documentos: { ...(im.documentos || {}), ...(after.documentos || {}) },
            pendentes: after.pendentes || [], atualizadoEm: ts(),
            ...(novaVinc ? { timeline: admin.firestore.FieldValue.arrayUnion({ texto: 'Proprietário vinculado pela ficha do vendedor', porNome: 'Sistema', em: admin.firestore.Timestamp.now() }) } : {})
          }, { merge: true });
          await _bumpBroadcast('imovelSeq');
          return;
        }
      }
    }
    // Ficha do vendedor NÃO gera mais imóvel (v1.0.158): imóveis vêm do iList; a ficha só
    // é plugada num imóvel existente. Legado: card criado antes desta mudança segue
    // atualizado no reenvio. Ficha solta nova ⇒ nada nasce (fica no listarFichasProprietario).
    if (!existente.exists) return;
    const base = {
      ...loc_montarImovel(dados),
      corretorUid: after.corretorUid, corretorNome: after.corretorNome || '',
      fichaId, fichaTipo: 'vendedor',
      proprietarioNome: dados.nome || '',   // vendedor principal (prefixo vazio na ficha)
      proprietarioContato: [dados.whatsapp || dados.fixo, dados.email].filter(Boolean).join(' · '),
      documentos: after.documentos || {}, pendentes: after.pendentes || [],
      atualizadoEm: ts()
    };
    // existente.exists garantido pela guarda acima — só atualiza o card LEGADO, nunca cria.
    await imovelRef.set(base, { merge: true });
  } catch (e) {
    await logErro('onFichaVendedorEnviadaAdmin', e, { fichaId });
  }
});

// ── Sinal de tempo real "recebeu ficha" (padrão campainha) ───────────────────
// Doc SEM PII por corretor em `user_feed/{uid}`. O cliente escuta esse doc (barato,
// só o dono lê pela regra) e, quando o `seq` muda, busca as fichas pela função segura
// de sempre — o CPF/PII NUNCA fica ao alcance do listener do cliente. Isso é o que dá
// tempo real sem afrouxar as regras das fichas.
async function _bumpUserFeed(uid, campo) {
  if (!uid) return;
  try {
    await db.collection('user_feed').doc(uid).set({
      seq: admin.firestore.FieldValue.increment(1),
      [campo + 'Em']: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) { console.warn('_bumpUserFeed', (e && e.message) || e); }
}
// Cutuca o sinal do corretor quando uma ficha CHEGA (status aguardando_corretor) — na
// criação ou reenvio. Gatilhos dedicados e leves (early-return na maioria dos writes),
// cobrem TODAS as fichas (pf/pj/vendedor/proposta/fiador/locador), não só as que viram imóvel.
function _sinalFichaHandler(event) {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.status !== 'aguardando_corretor') return null;
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  if (before && before.status === 'aguardando_corretor') return null; // só na transição p/ recebida
  return _bumpUserFeed(after.corretorUid, 'ficha');
}
exports.onFichaSinal        = onDocumentWritten({ document: 'fichas/{fichaId}' }, _sinalFichaHandler);
exports.onFichaLocadorSinal = onDocumentWritten({ document: 'fichas_locador/{fichaId}' }, _sinalFichaHandler);

// Broadcast (tempo real para TODOS): um doc único e minúsculo (config/broadcast) com
// contadores por tipo. Quando o admin muda status de app, banner ou envia aviso, a
// function "toca a campainha" incrementando o contador; todo cliente escuta esse doc
// (via onSnapshot) e recarrega SÓ a peça que mudou, reusando as functions que já existem.
// Sem PII no doc (só números/timestamp) e a leitura é liberada só pra ESTE doc — o resto
// de config/ (seguranca, release, banner) continua fechado.
async function _bumpBroadcast(campo) {
  try {
    await db.collection('config').doc('broadcast').set({
      [campo]: admin.firestore.FieldValue.increment(1),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) { console.warn('_bumpBroadcast', (e && e.message) || e); }
}

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
  // Imóvel do feed NÃO recebe protocolo SH (ele mostra o código do portal) — senão
  // consumiria a sequência SH à toa com números invisíveis a cada sync diário.
  const semNumero = snap.docs.filter(d => d.data().numeroProtocolo == null && d.data().origem !== 'feed')
    .sort((a, b) => {
      const ta = a.data().criadoEm?.toMillis?.() || 0;
      const tb = b.data().criadoEm?.toMillis?.() || 0;
      return ta - tb;
    });
  for (const d of semNumero) {
    await _atribuirProtocoloSeFalta(d.ref); // transacional: sem corrida/buraco na sequência
  }
  const finalSnap = semNumero.length ? await q.get() : snap;
  const imoveis = finalSnap.docs.map(d => {
    const dd = d.data();
    // Aliviar a resposta (egress): a LISTA só usa a CAPA (foto 0). As demais dezenas de
    // URLs por imóvel só pesam. Mando capa + contagem (qtdFotos); a UI não itera o resto.
    let feedDados = dd.feedDados;
    if (feedDados && Array.isArray(feedDados.fotos) && feedDados.fotos.length > 1) {
      feedDados = { ...feedDados, fotos: feedDados.fotos.slice(0, 1), qtdFotos: feedDados.fotos.length };
    }
    return {
      id: d.id, ...dd, ...(feedDados ? { feedDados } : {}),
      criadoEm: dd.criadoEm?.toDate?.()?.toISOString() || null,
      atualizadoEm: dd.atualizadoEm?.toDate?.()?.toISOString() || null
    };
  });
  return { imoveis, veTudo, role };
});

// Lista a coleção `pessoas` (locadores/locatários com PII, populada pelos gatilhos
// de ficha) pra alimentar a aba "Pessoas" da visão nova do Broker. Mesma regra de
// ouro das outras: gestor/administrativo vê tudo; corretor só as suas
// (corretorUid). Devolve só o necessário pro CRM — sem RG/cônjuge/nascimento.
exports.pessoasListar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  let q = db.collection('pessoas');
  if (!veTudo) q = q.where('corretorUid', '==', auth.uid);
  const snap = await q.get();
  const pessoas = snap.docs.slice(0, 800).map(d => {
    const p = d.data();
    return {
      id: d.id,
      papel: p.papel || 'locador',
      nome: p.nome || '',
      cpf: p.cpf || '',
      email: p.email || '',
      whatsapp: p.whatsapp || '',
      fixo: p.fixo || '',
      endereco: p.endereco || null,
      corretorUid: p.corretorUid || '',
      imovelId: p.imovelId || '',
      fichaId: p.fichaId || '',
      atualizadoEm: p.atualizadoEm?.toDate?.()?.toISOString() || null,
    };
  });
  return { pessoas, veTudo };
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

// (autenticado, com posse) Gera o PDF de UMA ficha (dados + documentos embutidos) e
// devolve em base64 pra download no detalhe do imóvel (ficha do proprietário e dos
// interessados). Gestor/administrativo baixam qualquer uma; corretor só as suas.
exports.gerarFichaPdf = onCall({ memory: '512MiB', timeoutSeconds: 120 }, async (req) => {
  const auth = exigirAutenticado(req);
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId é obrigatório.');
  let col = (req.data.colecao === 'fichas_locador') ? 'fichas_locador' : 'fichas';
  let snap = await db.collection(col).doc(String(fichaId)).get();
  if (!snap.exists) { const alt = col === 'fichas' ? 'fichas_locador' : 'fichas'; const s2 = await db.collection(alt).doc(String(fichaId)).get(); if (s2.exists) { snap = s2; col = alt; } }
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  const ficha = snap.data();
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && ficha.corretorUid !== auth.uid) throw new HttpsError('permission-denied', 'Sem acesso a esta ficha.');
  const LABELS = { pf: 'Ficha (Pessoa Física)', pj: 'Ficha (Pessoa Jurídica)', proposta: 'Ficha Proposta', vendedor: 'Ficha Vendedor', locacao_fiador: 'Ficha Locação c/ Fiador', fianca: 'Ficha Fiança' };
  const label = col === 'fichas_locador' ? 'Ficha Locador' : (LABELS[ficha.tipo] || 'Ficha');
  const buf = await gerarPdfFicha(ficha, label);
  const nome = (ficha.dados && (ficha.dados.nome || ficha.dados.razaoSocial || ficha.dados.nomeCompleto)) || 'ficha';
  const filename = (label + ' - ' + nome).replace(/[^\w .À-ÿ-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) + '.pdf';
  return { base64: buf.toString('base64'), filename };
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
  // Timeline da Tela 03 (histórico automático) + interessados com datas legíveis
  const timeline = (imovel.timeline || []).map(h => ({
    ...h, em: h.em?.toDate?.()?.toISOString() || null
  }));
  const interessados = (imovel.interessados || []).map(p => ({
    ...p,
    em: p.em?.toDate?.()?.toISOString() || null,
    statusEm: p.statusEm?.toDate?.()?.toISOString() || null
  }));

  return {
    imovel: {
      id: snap.id, ...imovel,
      criadoEm: imovel.criadoEm?.toDate?.()?.toISOString() || null,
      atualizadoEm: imovel.atualizadoEm?.toDate?.()?.toISOString() || null,
      historico, timeline, interessados
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
  // Simétrico ao guard de destino: SAIR de um estado que é do gestor
  // (aprovado/em_contrato/ativo) também é exclusivo do gestor — senão o
  // administrativo desfazia a decisão do gestor (ex.: aprovado → em_análise).
  if (IMOVEL_STATUS_SO_GESTOR.includes(atual) && !ehGestor) {
    throw new HttpsError('permission-denied', 'Só o gestor pode mudar um imóvel já aprovado, em contrato ou ativo.');
  }

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

// ─── Carteira de Imóveis (Tela 01 do SMART HUB) ──────────────────────────────
// A Carteira é a visão comercial por cima da coleção `imoveis`: finalidade
// (locacao|venda|venda_locacao), situacao (disponivel|em_negociacao), arquivado
// (nunca excluir fisicamente — regra da spec) e interessados. A esteira de
// locação (campo `status`) continua existindo por baixo, como detalhe.
const CARTEIRA_FINALIDADES = ['locacao', 'venda', 'venda_locacao'];
const CARTEIRA_SITUACOES = ['disponivel', 'em_negociacao'];
const _txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Status do interessado (Tela 03). Aprovar/reprovar é decisão exclusiva do broker
// (Manual de Regras: "Apenas decisões do Broker poderão alterar status manualmente").
const INTERESSADO_STATUS = ['ficha_enviada', 'ficha_recebida', 'em_analise', 'aprovado', 'reprovado', 'desistiu', 'negocio_gerado'];
const INTERESSADO_SO_BROKER = ['aprovado', 'reprovado'];
const INTERESSADO_LABEL = {
  ficha_enviada: 'Ficha enviada', ficha_recebida: 'Ficha recebida', em_analise: 'Em análise',
  aprovado: 'Aprovado', reprovado: 'Reprovado', desistiu: 'Desistiu', negocio_gerado: 'Negócio gerado'
};

// Nome de exibição de um uid (pra timeline/auditoria). Nunca lança.
async function _nomeDoUid(uid) {
  try { const u = await admin.auth().getUser(uid); return u.displayName || u.email || uid; }
  catch (_) { return uid || 'Sistema'; }
}

// Timeline do imóvel (aba Histórico da Tela 03) — registro automático, nunca editável.
// Transacional pra não perder entrada em escrita concorrente; cap de 300.
async function _imovelTimeline(ref, texto, porNome) {
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      const tl = Array.isArray(s.data().timeline) ? [...s.data().timeline] : [];
      tl.push({ texto: String(texto).slice(0, 300), porNome: porNome || 'Sistema', em: admin.firestore.Timestamp.now() });
      tx.set(ref, { timeline: tl.slice(-300) }, { merge: true });
    });
  } catch (e) { await logErro('_imovelTimeline', e, { imovelId: ref.id }); }
}

// Posse na Carteira: broker (gestor/administrativo) mexe em tudo; corretor só nos seus.
async function _carteiraImovelComPosse(imovelId, auth) {
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');
  const ref = db.collection('imoveis').doc(imovelId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const ehBroker = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!ehBroker && snap.data().corretorUid !== auth.uid) {
    throw new HttpsError('permission-denied', 'Sem permissão neste imóvel.');
  }
  return { ref, snap, ehBroker };
}

// Cria (cadastro manual — caso excepcional da spec) ou edita um imóvel da Carteira.
exports.carteiraSalvarImovel = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};

  // Regras da spec: todo imóvel tem proprietário, corretor responsável e finalidade.
  const proprietarioNome = _txt(d.proprietarioNome, 120);
  const finalidade = CARTEIRA_FINALIDADES.includes(d.finalidade) ? d.finalidade : null;
  const e = d.endereco || {};
  const endereco = {
    cep: _txt(e.cep, 12), logradouro: _txt(e.logradouro, 160), numero: _txt(e.numero, 20),
    complemento: _txt(e.complemento, 80), bairro: _txt(e.bairro, 80),
    cidade: _txt(e.cidade, 80), estado: _txt(e.estado, 2)
  };
  const campos = {
    proprietarioNome,
    proprietarioContato: _txt(d.proprietarioContato, 120),
    tipo: _txt(d.tipo, 60),
    valorAnuncio: _txt(d.valorAnuncio, 40),
    endereco,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  };

  if (d.imovelId) {
    // Edição: posse + não deixa "des-obrigar" campo obrigatório
    const { ref } = await _carteiraImovelComPosse(d.imovelId, auth);
    if (!proprietarioNome) delete campos.proprietarioNome;
    if (finalidade) campos.finalidade = finalidade;
    await ref.set(campos, { merge: true });
    await _imovelTimeline(ref, 'Dados do imóvel alterados', await _nomeDoUid(auth.uid));
    return { ok: true, imovelId: d.imovelId };
  }

  // Criação manual
  if (!proprietarioNome) throw new HttpsError('invalid-argument', 'Proprietário é obrigatório.');
  if (!finalidade) throw new HttpsError('invalid-argument', 'Finalidade é obrigatória.');
  if (!endereco.logradouro || !endereco.cidade) throw new HttpsError('invalid-argument', 'Endereço (logradouro e cidade) é obrigatório.');

  let porNome = '';
  try { porNome = (await admin.auth().getUser(auth.uid)).displayName || ''; } catch (_) {}
  const ref = db.collection('imoveis').doc();
  const numeroProtocolo = await proximoNumeroProtocolo();
  await ref.set({
    ...campos,
    finalidade,
    situacao: 'disponivel',            // todo imóvel nasce Disponível (spec)
    arquivado: false,
    origem: 'manual',
    corretorUid: auth.uid, corretorNome: porNome,
    // Com locação na finalidade, entra na esteira em 'recebido'; venda pura não tem esteira.
    ...(finalidade !== 'venda' ? { status: 'recebido' } : {}),
    interessados: [],
    pendentes: [],
    numeroProtocolo,
    timeline: [{ texto: 'Imóvel cadastrado manualmente', porNome: porNome || 'Sistema', em: admin.firestore.Timestamp.now() }],
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, imovelId: ref.id, numeroProtocolo };
});

// Arquiva / restaura (a spec proíbe excluir fisicamente — arquivamento é o "delete").
exports.carteiraArquivar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, arquivar } = req.data || {};
  const { ref } = await _carteiraImovelComPosse(imovelId, auth);
  // Checagem + escrita na MESMA transação: senão um negócio criado entre o "ler" e o
  // "gravar" (negocioGerar concorrente) escapava e o imóvel arquivava com NG ativo,
  // órfão na Tela 04A. Ler a query dentro da tx trava a faixa até o commit.
  await db.runTransaction(async (tx) => {
    if (arquivar) {
      const negs = await tx.get(db.collection('negocios').where('imovelId', '==', imovelId));
      const ativo = negs.docs.find(d => NEGOCIO_ATIVO(d.data().status));
      if (ativo) throw new HttpsError('failed-precondition', `Este imóvel tem um negócio ativo (${ativo.data().codigo}) — conclua ou cancele o negócio antes de arquivar.`);
    }
    tx.set(ref, {
      arquivado: !!arquivar,
      ...(arquivar ? { arquivadoEm: admin.firestore.FieldValue.serverTimestamp() } : { arquivadoEm: null }),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await _imovelTimeline(ref, arquivar ? 'Imóvel arquivado' : 'Imóvel restaurado do arquivo', await _nomeDoUid(auth.uid));
  await _bumpBroadcast('imovelSeq');   // tempo real: dashboards abertos recarregam
  return { ok: true, arquivado: !!arquivar };
});

// Muda a situação comercial (Disponível / Em negociação).
exports.carteiraSituacao = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, situacao } = req.data || {};
  if (!CARTEIRA_SITUACOES.includes(situacao)) throw new HttpsError('invalid-argument', 'Situação inválida.');
  const { ref } = await _carteiraImovelComPosse(imovelId, auth);
  // Não deixa voltar pra "Disponível" com negócio ativo: a UI mostraria Disponível
  // enquanto o NG segue vivo apontando pro imóvel (só concluir/cancelar libera).
  // Mesma corrida do arquivar — checagem + escrita na mesma transação.
  await db.runTransaction(async (tx) => {
    if (situacao === 'disponivel') {
      const negs = await tx.get(db.collection('negocios').where('imovelId', '==', imovelId));
      const ativo = negs.docs.find(d => NEGOCIO_ATIVO(d.data().status));
      if (ativo) throw new HttpsError('failed-precondition', `Este imóvel tem um negócio ativo (${ativo.data().codigo}) — conclua ou cancele o negócio antes de marcar como Disponível.`);
    }
    tx.set(ref, { situacao, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
  await _imovelTimeline(ref, `Situação alterada para ${situacao === 'disponivel' ? 'Disponível' : 'Em Negociação'}`, await _nomeDoUid(auth.uid));
  await _bumpBroadcast('imovelSeq');   // tempo real: dashboards abertos recarregam
  return { ok: true, situacao };
});

// Revalida que o interessado no índice `i` ainda é o que o cliente viu na tela.
// O índice vem do cliente e ENVELHECE se um interessado anterior foi removido entre
// o render e o clique (splice desloca todo mundo pra baixo) — sem esta guarda, uma
// ação (aprovar/reprovar/remover/gerar negócio) acertaria a pessoa ERRADA em silêncio.
// Confere fichaId (único) quando disponível e sempre o nome. Cliente antigo que não
// manda as dicas (esperaFichaId/esperaNome) passa como antes — aditivo, sem quebrar.
function _interessadoConfere(alvo, d) {
  if (!alvo) return false;
  const efid = _txt(d && d.esperaFichaId, 200);
  if (efid && (alvo.fichaId || '') !== efid) return false;
  const enome = _txt(d && d.esperaNome, 120);
  if (enome && (alvo.nome || '') !== enome) return false;
  return true;
}

// Interessados: vários por imóvel (spec). MVP: array no doc (cap 50), add/remover por índice.
// Transacional: o trigger onFichaInteressadoRecebida escreve o MESMO array — sem
// transação, um clique simultâneo à chegada de uma ficha perderia um dos dois.
exports.carteiraInteressado = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, acao } = req.data || {};
  const { ref } = await _carteiraImovelComPosse(imovelId, auth);
  const ehGestor = ehGestorAuth(auth);
  let evento = '';
  let total = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
    const lista = Array.isArray(snap.data().interessados) ? [...snap.data().interessados] : [];
    evento = '';

    if (acao === 'add') {
      const nome = _txt(req.data.nome, 120);
      if (!nome) throw new HttpsError('invalid-argument', 'Nome do interessado é obrigatório.');
      if (lista.length >= 50) throw new HttpsError('resource-exhausted', 'Limite de interessados atingido.');
      // Status inicial: 'em_analise' (add manual) ou 'ficha_enviada' (fluxo Enviar Ficha da Tela 03).
      const status = INTERESSADO_STATUS.includes(req.data.status) ? req.data.status : 'em_analise';
      if (INTERESSADO_SO_BROKER.includes(status) || status === 'negocio_gerado') throw new HttpsError('invalid-argument', 'Status inicial inválido.');
      // Vínculo com a ficha do Cadastro (quando o add vem do seletor "Adicionar interessado"):
      // guarda fichaId + contatos pra o "Ver ficha" funcionar igual aos interessados automáticos.
      const extra = {};
      const _fid = _txt(req.data.fichaId, 200);   if (_fid) extra.fichaId = _fid;
      // Dedupe: a mesma ficha do Cadastro não entra duas vezes como interessada
      // (reabrir o seletor e clicar de novo criaria uma pessoa repetida).
      if (_fid && lista.some(it => it.fichaId === _fid)) {
        throw new HttpsError('failed-precondition', 'Esta ficha já é interessada deste imóvel.');
      }
      const _ftp = _txt(req.data.fichaTipo, 30);  if (_ftp) extra.fichaTipo = _ftp;
      const _eml = _txt(req.data.email, 160);      if (_eml) extra.email = _eml;
      const _cpf = _txt(req.data.cpf, 40);         if (_cpf) extra.cpf = _cpf;
      const _tel = _txt(req.data.telefone, 40);    if (_tel) extra.telefone = _tel;
      lista.push({
        nome,
        contato: _txt(req.data.contato, 120),
        tipo: _txt(req.data.tipo, 20) || 'locatario',
        status,
        ...extra,
        em: admin.firestore.Timestamp.now()
      });
      evento = `Interessado ${nome} adicionado (${INTERESSADO_LABEL[status]})`;
    } else if (acao === 'remover') {
      const i = Number(req.data.index);
      if (!Number.isInteger(i) || i < 0 || i >= lista.length) throw new HttpsError('invalid-argument', 'Interessado não encontrado.');
      if (!_interessadoConfere(lista[i], req.data)) throw new HttpsError('failed-precondition', 'A lista de interessados mudou — recarregue a tela e tente de novo.');
      if (lista[i].status === 'negocio_gerado') {
        // Só bloqueia se o negócio ainda está ATIVO (esse precisa ser cancelado antes).
        // Negócio concluído/cancelado é só-leitura e não pode ser cancelado — sem esta
        // saída o interessado ficava preso pra sempre, e o erro pedia uma ação impossível.
        const negId = lista[i].negocioId;
        let negAtivo = false;
        if (negId) {
          const nSnap = await tx.get(db.collection('negocios').doc(negId));
          negAtivo = nSnap.exists && !['concluido', 'cancelado'].includes(nSnap.data().status);
        }
        if (negAtivo) throw new HttpsError('failed-precondition', 'Este interessado tem um negócio ativo — cancele o negócio antes de removê-lo.');
        if (!ehGestor) throw new HttpsError('permission-denied', 'Remover um interessado com negócio é decisão do broker.');
      }
      if (INTERESSADO_SO_BROKER.includes(lista[i].status) && !ehGestor) throw new HttpsError('permission-denied', 'Remover um interessado já avaliado é decisão do broker.');
      evento = `Interessado ${lista[i].nome} removido`;
      lista.splice(i, 1);
    } else if (acao === 'status') {
      // Tela 03: muda o status do interessado. Aprovar/Reprovar = só broker (Manual de Regras).
      const i = Number(req.data.index);
      if (!Number.isInteger(i) || i < 0 || i >= lista.length) throw new HttpsError('invalid-argument', 'Interessado não encontrado.');
      if (!_interessadoConfere(lista[i], req.data)) throw new HttpsError('failed-precondition', 'A lista de interessados mudou — recarregue a tela e tente de novo.');
      const status = req.data.status;
      if (!INTERESSADO_STATUS.includes(status) || status === 'negocio_gerado') throw new HttpsError('invalid-argument', 'Status inválido.');
      if (INTERESSADO_SO_BROKER.includes(status) && !ehGestor) {
        throw new HttpsError('permission-denied', 'Aprovar ou reprovar interessado é decisão do broker.');
      }
      // Guarda simétrica: SAIR de aprovado/reprovado também é só broker — senão o
      // corretor desfaz a decisão mandando o interessado de volta pra análise.
      if (INTERESSADO_SO_BROKER.includes(lista[i].status) && !ehGestor) {
        throw new HttpsError('permission-denied', 'Este interessado já foi avaliado — mudar isso é decisão do broker.');
      }
      if (lista[i].status === 'negocio_gerado') throw new HttpsError('failed-precondition', 'Este interessado já gerou um negócio.');
      lista[i] = { ...lista[i], status, statusEm: admin.firestore.Timestamp.now() };
      evento = `Interessado ${lista[i].nome}: ${INTERESSADO_LABEL[status]}`;
    } else {
      throw new HttpsError('invalid-argument', 'Ação inválida.');
    }

    tx.set(ref, { interessados: lista, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    total = lista.length;
  });

  if (evento) await _imovelTimeline(ref, evento, await _nomeDoUid(auth.uid));
  return { ok: true, interessados: total };
});

// ─── Negócios (Telas 03/04 do SMART HUB) ─────────────────────────────────────
// Todo negócio NASCE de um imóvel (Tela 03, botão Gerar Negócio) a partir de um
// interessado APROVADO. Só 1 negócio ativo por imóvel. O checklist muda conforme
// o tipo (Venda/Locação) — modelos da spec 04B; as etapas `obrigatoria` travam o
// "Entregar para Gestão" (Tela 04B, fase seguinte).
const NEGOCIO_STATUS = ['negocio_criado', 'em_andamento', 'aguardando_broker', 'aguardando_corretor', 'aguardando_administrativo', 'entregue_gestao', 'concluido', 'cancelado'];
const NEGOCIO_ATIVO = s => !['concluido', 'cancelado'].includes(s);
const _chkItem = ([key, label, obrigatoria]) => ({ key, label, obrigatoria, feito: false, feitoPor: '', feitoEm: null });
const CHECKLIST_NEGOCIO = {
  // Locação: 7 primeiras obrigatórias (travam Entregar/Concluir e aparecem no stepper).
  locacao: [
    ['doc_pasta', 'Documentação completa e ficha cadastral no drive', true],
    ['analise_credito', 'Análise de crédito aprovada', true],
    ['contrato_assinado', 'Contrato assinado', true],
    ['vistoria_assinada', 'Vistoria assinada', true],
    ['seguro_fianca', 'Seguro fiança emitido', true],
    ['enel', 'Transferência ENEL', true],
    ['seguro_incendio', 'Seguro incêndio', true],
    ['chaves', 'Entrega de chaves', false],
    ['cadastrar_locacao', 'Cadastrar locação no sistema', false],
    ['gerar_cobranca', 'Gerar cobrança', false],
    ['acompanhamento', 'Acompanhamento', false],
    ['conferir_enel', 'Conferir transferência ENEL', false],
  ],
  // Venda: 7 primeiras obrigatórias.
  venda: [
    ['doc_pasta', 'Documentação salva na pasta', true],
    ['ficha', 'Ficha cadastral preenchida', true],
    ['proposta', 'Proposta ajustada entre as partes', true],
    ['compromisso_emitido', 'Compromisso de compra e venda emitido', true],
    ['certidoes', 'Certidões salvas na pasta', true],
    ['matricula_atualizada', 'Puxar matrícula atualizada', true],
    ['compromisso_aprovado', 'Compromisso aprovado pelas partes', true],
    ['compromisso_assinado', 'Compromisso assinado', false],
    ['comissao1', '1ª parcela da comissão paga', false],
    ['comissao2', '2ª parcela da comissão paga', false],
    ['averbacao', 'Averbação da escritura/financiamento', false],
    ['matricula_emitida', 'Matrícula atualizada emitida', false],
    ['chaves', 'Entrega de chaves', false],
    ['enel', 'Transferência ENEL', false],
    ['iptu', 'Transferência IPTU', false],
    ['condominio', 'Transferência titularidade condomínio', false],
    ['avaliacao', 'Avaliação Google', false],
  ],
};

// ─── Configurações do SMART HUB (T-06 Administração) ─────────────────────────
// Coleção `smarthub_config`: tipos_imovel/cidades (listas de texto) e
// checklist_locacao/checklist_venda (itens {key,label,obrigatoria}). O admin
// edita no painel; o negocioGerar usa o checklist configurado (fallback =
// padrão do código). Finalidades NÃO são configuráveis (fazem parte do modelo).
const CONFIG_DOCS = ['tipos_imovel', 'cidades', 'checklist_locacao', 'checklist_venda'];

exports.configObter = onCall(async (req) => {
  exigirAutenticado(req);
  const out = {};
  const snaps = await db.getAll(...CONFIG_DOCS.map(d => db.collection('smarthub_config').doc(d)));
  snaps.forEach((s, i) => { out[CONFIG_DOCS[i]] = s.exists ? (s.data().itens || []) : null; });
  return out;
});

exports.configSalvar = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const { doc, itens } = req.data || {};
  if (!CONFIG_DOCS.includes(doc)) throw new HttpsError('invalid-argument', 'Config inválida.');
  if (!Array.isArray(itens) || itens.length > 100) throw new HttpsError('invalid-argument', 'Lista inválida (máx. 100 itens).');

  let limpos;
  if (doc.startsWith('checklist_')) {
    if (!itens.length) throw new HttpsError('invalid-argument', 'O checklist não pode ficar vazio.');
    const vistos = new Set();
    limpos = itens.map((x, i) => {
      const label = _txt(x && x.label, 120);
      if (!label) throw new HttpsError('invalid-argument', `Etapa ${i + 1} sem nome.`);
      let key = _txt(x && x.key, 40) || label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'etapa_' + (i + 1);
      while (vistos.has(key)) key += '_2';   // chave única (o toggle do 04B acha por key)
      vistos.add(key);
      return { key, label, obrigatoria: !!(x && x.obrigatoria) };
    });
  } else {
    limpos = [...new Set(itens.map(x => _txt(x, 60)).filter(Boolean))];
  }

  await db.collection('smarthub_config').doc(doc).set({
    itens: limpos,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    porUid: auth.uid
  });
  await registrarAudit(auth, 'config_salvar', { tipo: 'smarthub_config', id: doc }, { qtd: limpos.length });
  return { ok: true, itens: limpos };
});

// Checklist do negócio: usa o configurado no Admin; sem config, o padrão do código.
async function _checklistModelo(tipo) {
  try {
    const s = await db.collection('smarthub_config').doc('checklist_' + tipo).get();
    const itens = s.exists ? s.data().itens : null;
    if (Array.isArray(itens) && itens.length) {
      return itens.map(x => ({ key: x.key, label: x.label, obrigatoria: !!x.obrigatoria, feito: false, feitoPor: '', feitoEm: null }));
    }
  } catch (_) { /* config quebrada → padrão */ }
  return CHECKLIST_NEGOCIO[tipo].map(_chkItem);
}

// Código sequencial NG-000001 (mesmo desenho transacional do protocolo dos imóveis).
async function proximoNumeroNegocio() {
  const ref = db.collection('counters').doc('negocios');
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const novo = (snap.exists ? (snap.data().proximo || 0) : 0) + 1;
    tx.set(ref, { proximo: novo, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return novo;
  });
}

// (BROKER) Gera um negócio a partir de um interessado aprovado do imóvel.
exports.negocioGerar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth)) throw new HttpsError('permission-denied', 'Gerar negócio é decisão do broker.');
  const { imovelId, interessadoIndex } = req.data || {};
  const { ref, snap } = await _carteiraImovelComPosse(imovelId, auth);
  const im = snap.data();
  // Defesa em profundidade: não gera negócio ativo pra imóvel arquivado (ficaria órfão
  // na lista de negócios apontando pra um imóvel invisível na Carteira). A UI já filtra
  // arquivados, então isto só barra chamada crua/estado de borda.
  if (im.arquivado) throw new HttpsError('failed-precondition', 'Imóvel arquivado — restaure antes de gerar negócio.');

  const lista = Array.isArray(im.interessados) ? [...im.interessados] : [];
  const i = Number(interessadoIndex);
  if (!Number.isInteger(i) || i < 0 || i >= lista.length) throw new HttpsError('invalid-argument', 'Interessado não encontrado.');
  const interessado = lista[i];
  if (!_interessadoConfere(interessado, req.data)) throw new HttpsError('failed-precondition', 'A lista de interessados mudou — recarregue a tela e tente de novo.');
  if (interessado.status !== 'aprovado') throw new HttpsError('failed-precondition', 'Somente um interessado APROVADO pode gerar negócio.');

  const finalidade = im.finalidade || 'locacao';
  const tipo = finalidade === 'venda' ? 'venda'
    : finalidade === 'venda_locacao' ? (interessado.tipo === 'comprador' ? 'venda' : 'locacao')
    : 'locacao';
  const checklist = await _checklistModelo(tipo);   // configurável no Admin (T-06)

  // Auto-marca o que o Hub JÁ tem certeza (o resto é ação no mundo real → manual):
  //  • "Ficha cadastral preenchida": o negócio nasce de uma ficha (interessado.fichaId).
  //  • "Documentação salva na pasta": a ficha/imóvel vieram com anexos.
  const _temDocs = o => !!(o && Object.values(o).some(u => typeof u === 'string' && /^https?:/.test(u)));
  const fichaPreenchida = !!interessado.fichaId;
  let temDocs = _temDocs(im.documentos);
  if (!temDocs && interessado.fichaId) {
    try { const fS = await db.collection('fichas').doc(interessado.fichaId).get(); if (fS.exists) temDocs = _temDocs(fS.data().documentos); } catch (_) { /* ficha some => segue manual */ }
  }
  const _autoMarcados = [];
  const _autoMarcar = (key, cond) => { if (!cond) return; const it = checklist.find(x => x.key === key); if (it && !it.feito) { it.feito = true; it.feitoPor = 'Sistema'; it.feitoEm = admin.firestore.Timestamp.now(); _autoMarcados.push(it.label); } };
  _autoMarcar('ficha', fichaPreenchida);
  _autoMarcar('doc_pasta', temDocs);
  const _proximaAcao = (checklist.find(x => !x.feito) || checklist[0]).label;

  const numero = await proximoNumeroNegocio();
  const codigo = 'NG-' + String(numero).padStart(6, '0');
  const porNome = await _nomeDoUid(auth.uid);
  const nRef = db.collection('negocios').doc();

  // Transacional: a checagem "só 1 negócio ativo por imóvel" + criação + reflexos
  // no imóvel viram um átomo — dois cliques rápidos em "Gerar Negócio" não criam
  // dois negócios (o segundo cai na checagem e leva o erro amigável).
  await db.runTransaction(async (tx) => {
    const existentes = await tx.get(db.collection('negocios').where('imovelId', '==', imovelId));
    const ativo = existentes.docs.find(x => NEGOCIO_ATIVO(x.data().status));
    if (ativo) throw new HttpsError('failed-precondition', `Este imóvel já tem um negócio ativo (${ativo.data().codigo}).`);
    const s2 = await tx.get(ref);
    const im2 = s2.data() || {};
    if (im2.arquivado) throw new HttpsError('failed-precondition', 'Imóvel arquivado — restaure antes de gerar negócio.');
    const lista2 = Array.isArray(im2.interessados) ? [...im2.interessados] : [];
    const it = lista2[i];
    // Revalida dentro da transação: a lista pode ter mudado entre o clique e agora.
    // Confere identidade (fichaId único quando houver + nome) — não só o nome, senão
    // dois interessados de mesmo nome com o índice deslocado atacariam o registro errado.
    if (!_interessadoConfere(it, req.data) || (it && it.nome !== interessado.nome)) throw new HttpsError('failed-precondition', 'A lista de interessados mudou — recarregue a tela e tente de novo.');
    if (it.status !== 'aprovado') throw new HttpsError('failed-precondition', 'Somente um interessado APROVADO pode gerar negócio.');

    const e = im2.endereco || {};
    tx.set(nRef, {
      codigo, numero,
      imovelId, imovelProtocolo: im2.numeroProtocolo != null ? im2.numeroProtocolo : null,
      imovelResumo: [e.logradouro, e.numero].filter(Boolean).join(', ') || im2.tipo || 'Imóvel',
      cidade: e.cidade || '',
      tipo,
      clienteNome: it.nome, clienteContato: it.contato || '',
      interessadoIndex: i,
      corretorUid: im2.corretorUid || '', corretorNome: im2.corretorNome || '',
      brokerUid: auth.uid, brokerNome: porNome,
      status: 'negocio_criado',
      proximaAcao: _proximaAcao,
      checklist,
      comentarios: [],
      timeline: [{ texto: `Negócio criado a partir do interessado ${it.nome}`, porNome, em: admin.firestore.Timestamp.now() }]
        .concat(_autoMarcados.length ? [{ texto: 'Etapas concluídas automaticamente: ' + _autoMarcados.join(', '), porNome: 'Sistema', em: admin.firestore.Timestamp.now() }] : []),
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    // Reflexos no imóvel: interessado vira "Negócio gerado" e o imóvel entra Em Negociação.
    lista2[i] = { ...it, status: 'negocio_gerado', negocioId: nRef.id, statusEm: admin.firestore.Timestamp.now() };
    tx.set(ref, { interessados: lista2, situacao: 'em_negociacao', atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
  await _imovelTimeline(ref, `Negócio ${codigo} gerado para ${interessado.nome}`, porNome);
  await registrarAudit(auth, 'negocio_gerar', { tipo: 'negocio', id: nRef.id }, { codigo, imovelId });
  await _bumpBroadcast('imovelSeq');   // tempo real: imóvel foi p/ "Em negociação" → dashboards recarregam
  return { ok: true, negocioId: nRef.id, codigo };
});

// Lista os negócios (Tela 04A): broker/administrativo vê tudo; corretor só os seus.
exports.negocioListar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const ehGestor = ehGestorAuth(auth);
  const veTudo = ehGestor || (auth.token && auth.token.locRole === 'administrativo');
  const q = veTudo ? db.collection('negocios') : db.collection('negocios').where('corretorUid', '==', auth.uid);
  const snap = await q.get();
  const negocios = snap.docs.map(d => {
    const n = d.data();
    // Comentários são EXCLUSIVOS do broker + corretor responsável (spec 04B) — o
    // administrativo vê o negócio na lista, mas os comentários nem trafegam.
    const podeComentar = ehGestor || n.corretorUid === auth.uid;
    return {
      ...n, id: d.id,
      criadoEm: n.criadoEm?.toDate?.()?.toISOString() || null,
      atualizadoEm: n.atualizadoEm?.toDate?.()?.toISOString() || null,
      timeline: (n.timeline || []).map(h => ({ ...h, em: h.em?.toDate?.()?.toISOString() || null })),
      checklist: (n.checklist || []).map(x => ({ ...x, feitoEm: x.feitoEm?.toDate?.()?.toISOString() || null })),
      documentos: (n.documentos || []).map(x => ({ ...x, em: x.em?.toDate?.()?.toISOString() || null })),
      tarefas: (n.tarefas || []).map(t => ({ ...t, criadoEm: t.criadoEm?.toDate?.()?.toISOString() || null, feitoEm: t.feitoEm?.toDate?.()?.toISOString() || null })),
      canceladoEm: n.canceladoEm?.toDate?.()?.toISOString() || null,
      comentarios: podeComentar ? (n.comentarios || []).map(c => ({ ...c, em: c.em?.toDate?.()?.toISOString() || null, editadoEm: c.editadoEm?.toDate?.()?.toISOString() || null })) : null,
    };
  }).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  return { negocios, veTudo };
});

// Posse num negócio: gestor/administrativo veem tudo; corretor só o dele.
async function _negocioComPosse(negocioId, auth) {
  if (!negocioId) throw new HttpsError('invalid-argument', 'negocioId é obrigatório.');
  const ref = db.collection('negocios').doc(negocioId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Negócio não encontrado.');
  const ehGestor = ehGestorAuth(auth);
  const ehAdm = !!(auth.token && auth.token.locRole === 'administrativo');
  const ehResponsavel = snap.data().corretorUid === auth.uid;
  if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem acesso a este negócio.');
  return { ref, snap, ehGestor, ehAdm, ehResponsavel };
}

function _negocioSerializar(id, n, podeComentar) {
  return {
    ...n, id,
    // Comentários internos são EXCLUSIVOS do broker + corretor responsável (spec 04B).
    comentarios: podeComentar ? (n.comentarios || []).map(c => ({ ...c, em: c.em?.toDate?.()?.toISOString() || null, editadoEm: c.editadoEm?.toDate?.()?.toISOString() || null })) : null,
    timeline: (n.timeline || []).map(h => ({ ...h, em: h.em?.toDate?.()?.toISOString() || null })),
    checklist: (n.checklist || []).map(x => ({ ...x, feitoEm: x.feitoEm?.toDate?.()?.toISOString() || null })),
    documentos: (n.documentos || []).map(x => ({ ...x, em: x.em?.toDate?.()?.toISOString() || null })),
    tarefas: (n.tarefas || []).map(t => ({ ...t, criadoEm: t.criadoEm?.toDate?.()?.toISOString() || null, feitoEm: t.feitoEm?.toDate?.()?.toISOString() || null })),
    canceladoEm: n.canceladoEm?.toDate?.()?.toISOString() || null,
    criadoEm: n.criadoEm?.toDate?.()?.toISOString() || null,
    atualizadoEm: n.atualizadoEm?.toDate?.()?.toISOString() || null,
  };
}

// Tela 04B: carrega um negócio.
exports.negocioObter = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { ref, snap, ehGestor, ehResponsavel } = await _negocioComPosse((req.data || {}).negocioId, auth);
  const podeComentar = ehGestor || ehResponsavel;
  return { negocio: _negocioSerializar(ref.id, snap.data(), podeComentar), ehGestor, ehResponsavel, podeComentar };
});

// Tela 04B: toda mutação do negócio passa por aqui (checklist, comentário,
// status, drive, entregar, cancelar, concluir). Permissões por ação:
//   checklist/drive → gestor, administrativo, corretor responsável
//   comentario      → gestor, corretor responsável (exclusivo — spec)
//   status/entregar/cancelar/concluir → SÓ gestor (decisões do Broker)
exports.negocioAtualizar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref, snap, ehGestor, ehAdm, ehResponsavel } = await _negocioComPosse(d.negocioId, auth);
  const n0 = snap.data();
  // Alinhado com a trava de dentro da transação (arquivar/desarquivar valem em encerrado).
  if (['concluido', 'cancelado'].includes(n0.status) && !['comentario', 'comentario_editar', 'arquivar', 'desarquivar'].includes(d.acao)) {
    throw new HttpsError('failed-precondition', 'Negócio encerrado não aceita mais alterações.');
  }
  const porNome = await _nomeDoUid(auth.uid);
  const imovelId = n0.imovelId;
  const codigo = n0.codigo;
  // Efeitos no imóvel (doc SEPARADO) rodam DEPOIS da transação do negócio — sinalizados aqui.
  let efeito = null; // 'entregue' | 'concluido' | 'cancelar'

  // Transação: relê o negócio FRESCO e muta os arrays atuais. Sem isso, dois
  // cliques simultâneos (ex.: broker e corretor marcando ✓ diferentes, ou dois
  // comentários) liam o mesmo snapshot e o último a gravar apagava a alteração do outro.
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Negócio não encontrado.');
    const n = s.data();
    if (['concluido', 'cancelado'].includes(n.status) && !['comentario', 'comentario_editar', 'arquivar', 'desarquivar'].includes(d.acao)) {
      throw new HttpsError('failed-precondition', 'Negócio encerrado não aceita mais alterações.');
    }
    const agora = admin.firestore.Timestamp.now();
    const up = { atualizadoEm: admin.firestore.FieldValue.serverTimestamp() };
    const tl = Array.isArray(n.timeline) ? [...n.timeline] : [];
    const anota = (texto) => tl.push({ texto: String(texto).slice(0, 300), porNome, em: agora });
    const checklist = (n.checklist || []).map(x => ({ ...x }));
    const proximaAcaoDe = (lista) => { const p = lista.find(x => !x.feito); return p ? p.label : 'Processo encerrado'; };

    if (d.acao === 'checklist') {
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão no checklist.');
      const item = checklist.find(x => x.key === d.key);
      if (!item) throw new HttpsError('invalid-argument', 'Etapa não encontrada.');
      item.feito = !!d.feito;
      item.feitoPor = item.feito ? porNome : '';
      item.feitoEm = item.feito ? agora : null;
      up.checklist = checklist;
      up.proximaAcao = proximaAcaoDe(checklist);
      // Status automático: primeiro item concluído tira o negócio de "Negócio Criado".
      if (item.feito && n.status === 'negocio_criado') { up.status = 'em_andamento'; anota('Status: Em Andamento (automático)'); }
      anota(`${item.feito ? '✓' : '○'} ${item.label}`);
    } else if (d.acao === 'comentario') {
      if (!ehGestor && !ehResponsavel) throw new HttpsError('permission-denied', 'Comentários são exclusivos do broker e do corretor responsável.');
      const texto = _txt(d.texto, 1000);
      if (!texto) throw new HttpsError('invalid-argument', 'Comentário vazio.');
      const com = Array.isArray(n.comentarios) ? [...n.comentarios] : [];
      if (com.length >= 200) throw new HttpsError('resource-exhausted', 'Limite de comentários atingido.');
      // Resposta a outro comentário: guarda o id do pai (thread renderizada no cliente).
      const respostaDe = _txt(d.respostaDe, 80) || null;
      if (respostaDe && !com.some(c => c.id === respostaDe)) throw new HttpsError('invalid-argument', 'Comentário respondido não existe (recarregue a tela).');
      const novo = { id: crypto.randomUUID(), texto, porUid: auth.uid, porNome, em: agora };
      if (respostaDe) novo.respostaDe = respostaDe;
      com.push(novo);
      up.comentarios = com;
    } else if (d.acao === 'comentario_editar') {
      if (!ehGestor && !ehResponsavel) throw new HttpsError('permission-denied', 'Comentários são exclusivos do broker e do corretor responsável.');
      const texto = _txt(d.texto, 1000);
      if (!texto) throw new HttpsError('invalid-argument', 'Comentário vazio.');
      const com = Array.isArray(n.comentarios) ? [...n.comentarios] : [];
      const c = com.find(x => x.id && x.id === d.comentarioId);
      if (!c) throw new HttpsError('not-found', 'Comentário não encontrado (só dá pra editar comentários novos, com id).');
      if (c.porUid !== auth.uid) throw new HttpsError('permission-denied', 'Só quem escreveu pode editar o comentário.');
      c.texto = texto; c.editadoEm = agora;
      up.comentarios = com;
    } else if (d.acao === 'drive') {
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const url = _txt(d.url, 500);
      if (url && !/^https:\/\//i.test(url)) throw new HttpsError('invalid-argument', 'Link inválido (precisa começar com https://).');
      up.driveUrl = url;
      anota(url ? 'Pasta do Google Drive vinculada' : 'Pasta do Google Drive removida');
    } else if (d.acao === 'origem') {
      // De onde veio o cliente (lead source) — o corretor responsável preenche na mão.
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      up.origem = _txt(d.origem, 120);
      anota(up.origem ? ('Origem do cliente: ' + up.origem) : 'Origem do cliente removida');
    } else if (d.acao === 'comissao') {
      // % de comissão editável POR NEGÓCIO (pedido Marcelo): venda padrão 6% mas
      // parceria cai pra 3% (ou 4/5% negociado); locação padrão 100%.
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const pct = Number(d.pct);
      if (!isFinite(pct) || pct < 0 || pct > 100) throw new HttpsError('invalid-argument', 'Percentual de comissão inválido (use um número entre 0 e 100).');
      if (pct === 0) {
        // 0 = limpar o override e voltar ao padrão (venda 6% / locação 100%) —
        // sem isso não havia caminho de desfazer uma comissão negociada.
        up.comissaoPct = admin.firestore.FieldValue.delete();
        anota('Comissão do negócio restaurada ao padrão');
      } else {
        up.comissaoPct = pct;
        anota('Comissão do negócio: ' + pct + '%');
      }
    } else if (d.acao === 'campos') {
      // Campos personalizados (pedido Marcelo). Whitelist por chave — merge aditivo.
      // Locação: administracao/parceria/comissaoRecebida (sim|nao). Venda: parceria +
      // comissaoRecebida (parcela1|parcela2|total). Vazio = limpar o campo.
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const SN = ['', 'sim', 'nao'];
      const CR = ['', 'sim', 'nao', 'parcela1', 'parcela2', 'total'];
      const cIn = (d.campos && typeof d.campos === 'object') ? d.campos : {};
      const limpo = { ...(n.campos || {}) };
      if ('administracao' in cIn) { if (!SN.includes(cIn.administracao)) throw new HttpsError('invalid-argument', 'Valor inválido em administração.'); limpo.administracao = cIn.administracao; }
      if ('parceria' in cIn) { if (!SN.includes(cIn.parceria)) throw new HttpsError('invalid-argument', 'Valor inválido em parceria.'); limpo.parceria = cIn.parceria; }
      if ('comissaoRecebida' in cIn) { if (!CR.includes(cIn.comissaoRecebida)) throw new HttpsError('invalid-argument', 'Valor inválido em comissão recebida.'); limpo.comissaoRecebida = cIn.comissaoRecebida; }
      up.campos = limpo;
      anota('Campos do negócio atualizados');
    } else if (d.acao === 'proposta') {
      // Proposta preenchida na mão (broker ou corretor). Merge por whitelist de chaves;
      // valores como TEXTO (datas dd/mm/aaaa ou ISO, números como o usuário digitar).
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const KEYS = ['inicio', 'valorAcordado', 'prazo', 'taxaAdm', 'sinal', 'sinalData', 'parcelaA', 'parcelaAData', 'parcelaB', 'parcelaBData', 'fgts', 'fgtsValor', 'financiamento'];
      const pIn = (d.proposta && typeof d.proposta === 'object') ? d.proposta : {};
      const prop = { ...(n.proposta || {}) };
      for (const k of KEYS) if (k in pIn) prop[k] = _txt(pIn[k], 60);
      up.proposta = prop;
      // Taxa de comissão editada NO PRÓPRIO card da proposta (pedido Marcelo): % por negócio,
      // salva no mesmo clique. Só entra quando o cliente manda `comissaoPct`; 0/vazio limpa o
      // override e volta ao padrão (venda 6% / locação 100%). Mesma regra da ação `comissao`.
      if ('comissaoPct' in d) {
        const pct = Number(d.comissaoPct);
        if (!isFinite(pct) || pct < 0 || pct > 100) throw new HttpsError('invalid-argument', 'Percentual de comissão inválido (use um número entre 0 e 100).');
        up.comissaoPct = pct === 0 ? admin.firestore.FieldValue.delete() : pct;
      }
      anota('Proposta atualizada');
    } else if (d.acao === 'status') {
      if (!ehGestor) throw new HttpsError('permission-denied', 'Mudar status é decisão do broker.');
      const permitidos = ['em_andamento', 'aguardando_broker', 'aguardando_corretor', 'aguardando_administrativo'];
      if (!permitidos.includes(d.status)) throw new HttpsError('invalid-argument', 'Status inválido (use os botões pra entregar/cancelar/concluir).');
      up.status = d.status;
      anota(`Status: ${d.status.replace(/_/g, ' ')}`);
    } else if (d.acao === 'entregar') {
      if (!ehGestor) throw new HttpsError('permission-denied', 'Entregar para Gestão é decisão do broker.');
      const faltam = checklist.filter(x => x.obrigatoria && !x.feito);
      if (faltam.length) throw new HttpsError('failed-precondition', `Etapas obrigatórias pendentes: ${faltam.map(x => x.label).join(', ')}.`);
      up.status = 'entregue_gestao';
      anota('Negócio entregue para Gestão');
      efeito = 'entregue';
    } else if (d.acao === 'concluir') {
      if (!ehGestor) throw new HttpsError('permission-denied', 'Concluir é decisão do broker.');
      const faltam = checklist.filter(x => x.obrigatoria && !x.feito);
      if (faltam.length) throw new HttpsError('failed-precondition', `Etapas obrigatórias pendentes: ${faltam.map(x => x.label).join(', ')}.`);
      up.status = 'concluido';
      up.proximaAcao = 'Processo encerrado';
      anota('Negócio concluído');
      efeito = 'concluido';
    } else if (d.acao === 'cancelar') {
      if (!ehGestor) throw new HttpsError('permission-denied', 'Cancelar é decisão do broker.');
      up.status = 'cancelado';
      up.proximaAcao = 'Processo encerrado';
      // Motivo da perda: além da timeline, guarda como campo estruturado pra virar relatório.
      const motivo = _txt(d.motivo, 200);
      up.motivoCancelamento = motivo;
      up.canceladoEm = admin.firestore.FieldValue.serverTimestamp();
      anota('Negócio cancelado' + (motivo ? ` — ${motivo}` : ''));
      efeito = 'cancelar';
    } else if (d.acao === 'tarefa') {
      // Nova tarefa com prazo opcional (gestor/adm/responsável). Máx. 50 por negócio.
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const texto = _txt(d.texto, 200);
      if (!texto) throw new HttpsError('invalid-argument', 'Descreva a tarefa.');
      const prazo = _txt(d.prazo, 10);
      if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw new HttpsError('invalid-argument', 'Data inválida.');
      const arr = Array.isArray(n.tarefas) ? [...n.tarefas] : [];
      if (arr.length >= 50) throw new HttpsError('resource-exhausted', 'Limite de tarefas atingido.');
      const tid = agora.toMillis().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      arr.push({ id: tid, texto, prazo: prazo || '', feito: false, criadoEm: agora, criadoPor: porNome });
      up.tarefas = arr;
      anota('Tarefa criada: ' + texto);
    } else if (d.acao === 'tarefa_check') {
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const arr = (n.tarefas || []).map(t => ({ ...t }));
      const t = arr.find(x => x.id === d.tarefaId);
      if (!t) throw new HttpsError('not-found', 'Tarefa não encontrada.');
      t.feito = !!d.feito;
      t.feitoEm = t.feito ? agora : null;
      t.feitoPor = t.feito ? porNome : '';
      up.tarefas = arr;
    } else if (d.acao === 'tarefa_rm') {
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      up.tarefas = (n.tarefas || []).filter(x => x.id !== d.tarefaId);
    } else if (d.acao === 'tags') {
      // Etiquetas livres (quente/morno/frio, prioridade…): gestor/adm/corretor responsável.
      // Sanitiza, dedup, no máx. 6 tags de até 24 chars. Sem timeline (mudança leve).
      if (!ehGestor && !ehAdm && !ehResponsavel) throw new HttpsError('permission-denied', 'Sem permissão.');
      const arr = Array.isArray(d.tags) ? d.tags : [];
      const tags = [];
      for (const t of arr) { const s = _txt(t, 24); if (s && !tags.includes(s)) tags.push(s); if (tags.length >= 6) break; }
      up.tags = tags;
    } else if (d.acao === 'arquivar' || d.acao === 'desarquivar') {
      // Arquivar = tirar da lista ativa de Negócios SEM perder histórico/relatório.
      // Só vale pra negócio encerrado (concluído/cancelado); é reversível.
      if (!ehGestor) throw new HttpsError('permission-denied', 'Arquivar é decisão do broker.');
      if (!['concluido', 'cancelado'].includes(n.status)) throw new HttpsError('failed-precondition', 'Só negócios encerrados podem ser arquivados.');
      up.arquivado = d.acao === 'arquivar';
      anota(up.arquivado ? 'Negócio arquivado' : 'Negócio desarquivado');
    } else {
      throw new HttpsError('invalid-argument', 'Ação inválida.');
    }

    up.timeline = tl.slice(-300);
    tx.set(ref, up, { merge: true });
  });

  // ── Efeitos no imóvel (doc separado), após a transação do negócio ──
  if (efeito === 'entregue') {
    await _imovelTimeline(db.collection('imoveis').doc(imovelId), `Negócio ${codigo} entregue para Gestão`, porNome);
  } else if (efeito === 'concluido') {
    // Negócio fechado ⇒ o imóvel sai de "Em negociação" e ganha a tag Vendido/Alugado.
    // NÃO arquiva (o cliente lê o preço do imóvel pra calcular a comissão — arquivar
    // esconderia e zeraria o valor do negócio concluído).
    const imRef = db.collection('imoveis').doc(imovelId);
    const tagFinal = n0.tipo === 'venda' ? 'Vendido' : 'Alugado';
    await imRef.set({ situacao: 'concluido', tagFinal, concluidoEm: admin.firestore.FieldValue.serverTimestamp(), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await _imovelTimeline(imRef, `Negócio ${codigo} concluído — imóvel marcado como ${tagFinal}`, porNome);
  } else if (efeito === 'cancelar') {
    // Espelho da regra "Reprovar encerra mantendo o imóvel disponível": cancelar
    // devolve o imóvel pra Disponível e o interessado volta pra Aprovado.
    // Transacional pra não atropelar escrita concorrente no array de interessados.
    const imRef = db.collection('imoveis').doc(imovelId);
    await db.runTransaction(async (tx) => {
      const imSnap = await tx.get(imRef);
      if (!imSnap.exists) return;
      const lista = Array.isArray(imSnap.data().interessados) ? [...imSnap.data().interessados] : [];
      // Acha pelo negocioId carimbado no interessado — o índice guardado na geração
      // fica podre se alguém adicionou/removeu interessado depois. Índice = fallback de legado.
      let i = lista.findIndex(p => p && p.negocioId === ref.id);
      if (i < 0) i = Number(n0.interessadoIndex);
      if (Number.isInteger(i) && lista[i] && lista[i].status === 'negocio_gerado') {
        lista[i] = { ...lista[i], status: 'aprovado', negocioId: null, statusEm: admin.firestore.Timestamp.now() };
      }
      tx.set(imRef, { interessados: lista, situacao: 'disponivel', atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    await _imovelTimeline(imRef, `Negócio ${codigo} cancelado — imóvel de volta pra Disponível`, porNome);
  }

  if (['entregar', 'cancelar', 'concluir'].includes(d.acao)) {
    await registrarAudit(auth, 'negocio_' + d.acao, { tipo: 'negocio', id: ref.id }, { codigo });
  }
  const novo = await ref.get();
  return { negocio: _negocioSerializar(ref.id, novo.data(), ehGestor || ehResponsavel), ehGestor, ehResponsavel, podeComentar: ehGestor || ehResponsavel };
});

// ─── Documentos do negócio (Tela Documentos) ─────────────────────────────────
// Anexa um documento a UM negócio. Quem envia é o GESTOR ou o ADMINISTRATIVO
// (o corretor responsável vê e baixa, mas não sobe — pedido do Nathan). O arquivo
// chega em base64 e é gravado no Storage pela Admin SDK (mesma regra de ouro das
// fichas: escrita de Locação SÓ via Cloud Function), com token de download próprio.
const NEGOCIO_DOC_CATEGORIAS = ['contrato', 'proposta', 'cliente', 'outro'];
// Documentos de escritório aceitos além de PDF/imagem raster no upload de docs de
// negócio/imóvel. São BAIXADOS pela URL (não renderizam no navegador) → sem risco de
// script como o SVG. Aceita Word/Excel/PowerPoint/RTF/TXT/CSV (mime já normalizado).
const _MIME_DOC_OK = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf', 'text/rtf', 'text/plain', 'text/csv',
]);
function _mimeDocOk(m) { return _MIME_DOC_OK.has(m); }
exports.negocioAnexarDoc = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref, snap, ehGestor, ehAdm } = await _negocioComPosse(d.negocioId, auth);
  if (!ehGestor && !ehAdm) throw new HttpsError('permission-denied', 'Enviar documentos é do gestor ou do administrativo.');
  if (['concluido', 'cancelado'].includes(snap.data().status)) throw new HttpsError('failed-precondition', 'Negócio encerrado — não aceita novos documentos.');
  const categoria = NEGOCIO_DOC_CATEGORIAS.includes(d.categoria) ? d.categoria : 'outro';
  const nome = _txt(d.nome, 160) || 'documento';
  // Normaliza o mime (caixa + parâmetros tipo ";charset=") ANTES de validar — é ISSO
  // que fecha o bypass: "image/SVG+XML" e "image/svg+xml;charset=utf-8" viravam
  // "image/svg+xml" e batiam no bloqueio. Aceita PDF ou QUALQUER imagem raster; só o
  // SVG (e variações que contenham "svg") fica de fora — é XML e pode carregar script
  // que rodaria ao abrir a URL do arquivo (token público). Não restrinjo a uma lista
  // curta pra não recusar bmp/tiff/avif/heic legítimos de celular.
  const mime = _txt(d.mime, 100).toLowerCase().split(';')[0].trim();
  const ehImagem = /^image\//.test(mime) && !mime.includes('svg');
  if (mime !== 'application/pdf' && !ehImagem && !_mimeDocOk(mime)) throw new HttpsError('invalid-argument', 'Tipo não aceito. Use PDF, imagem ou documento (Word, Excel, PowerPoint). SVG não é aceito.');
  const b64 = typeof d.base64 === 'string' ? d.base64 : '';
  const buf = b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
  if (!buf.length) throw new HttpsError('invalid-argument', 'Arquivo vazio ou inválido.');
  if (buf.length > 20 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Arquivo acima de 20MB.');

  const docId = crypto.randomUUID();
  const safe = nome.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'arquivo';
  const path = `negocios/${ref.id}/${docId}_${safe}`;
  const token = crypto.randomUUID();
  await admin.storage().bucket(FICHA_BUCKET).file(path).save(buf, {
    resumable: false,
    metadata: { contentType: mime, metadata: { firebaseStorageDownloadTokens: token } }
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${FICHA_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  const porNome = await _nomeDoUid(auth.uid);
  const entrada = { id: docId, nome, categoria, url, path, tamanho: buf.length, mime, porUid: auth.uid, porNome, em: admin.firestore.Timestamp.now() };

  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpsError('not-found', 'Negócio não encontrado.');
      if (['concluido', 'cancelado'].includes(s.data().status)) throw new HttpsError('failed-precondition', 'Negócio encerrado — não aceita novos documentos.');
      const lista = Array.isArray(s.data().documentos) ? [...s.data().documentos] : [];
      if (lista.length >= 100) throw new HttpsError('resource-exhausted', 'Limite de documentos do negócio atingido.');
      lista.push(entrada);
      const tl = Array.isArray(s.data().timeline) ? [...s.data().timeline] : [];
      tl.push({ texto: `Documento anexado: ${nome}`, porNome, em: admin.firestore.Timestamp.now() });
      tx.set(ref, { documentos: lista, timeline: tl.slice(-300), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    // Se a transação falhou (cap atingido, contenção), apaga o arquivo já gravado no
    // Storage pra não deixar órfão sem referência em documentos[].
    try { await admin.storage().bucket(FICHA_BUCKET).file(path).delete(); } catch (_) { /* nada a limpar */ }
    throw e;
  }
  await registrarAudit(auth, 'negocio_doc_anexar', { tipo: 'negocio', id: ref.id }, { nome, categoria });
  return { ok: true, documento: { ...entrada, em: entrada.em.toDate().toISOString() } };
});

// Remove um documento do negócio (gestor/administrativo) — apaga do array e do Storage.
exports.negocioRemoverDoc = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref, ehGestor, ehAdm } = await _negocioComPosse(d.negocioId, auth);
  if (!ehGestor && !ehAdm) throw new HttpsError('permission-denied', 'Remover documentos é do gestor ou do administrativo.');
  const docId = _txt(d.docId, 80);
  const porNome = await _nomeDoUid(auth.uid);
  let removido = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Negócio não encontrado.');
    const lista = Array.isArray(s.data().documentos) ? [...s.data().documentos] : [];
    const idx = lista.findIndex(x => x && x.id === docId);
    if (idx < 0) throw new HttpsError('not-found', 'Documento não encontrado.');
    removido = lista[idx];
    lista.splice(idx, 1);
    const tl = Array.isArray(s.data().timeline) ? [...s.data().timeline] : [];
    tl.push({ texto: `Documento removido: ${removido.nome}`, porNome, em: admin.firestore.Timestamp.now() });
    tx.set(ref, { documentos: lista, timeline: tl.slice(-300), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
  if (removido && removido.path) { try { await admin.storage().bucket(FICHA_BUCKET).file(removido.path).delete(); } catch (_) { /* arquivo já sumiu */ } }
  await registrarAudit(auth, 'negocio_doc_remover', { tipo: 'negocio', id: ref.id }, { nome: removido && removido.nome });
  return { ok: true };
});

// ─── Documentos avulsos do IMÓVEL (aba Documentos do imóvel) ──────────────────
// Anexa um documento a um imóvel (contrato, laudo, foto extra…). Dono do imóvel OU
// gestor/administrativo (mesma posse de `_carteiraImovelComPosse`). Base64 → Storage
// (Admin SDK) com token próprio, gravado em `imoveis.documentosExtra[]` — array
// SEPARADO do `documentos{}` que vem das fichas, pra não misturar nem sobrescrever.
// Mesma validação de tipo/tamanho do negocioAnexarDoc (PDF ou imagem raster, sem SVG).
exports.carteiraAnexarDoc = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref } = await _carteiraImovelComPosse(d.imovelId, auth);
  const nome = _txt(d.nome, 160) || 'documento';
  const mime = _txt(d.mime, 100).toLowerCase().split(';')[0].trim();
  const ehImagem = /^image\//.test(mime) && !mime.includes('svg');
  if (mime !== 'application/pdf' && !ehImagem && !_mimeDocOk(mime)) throw new HttpsError('invalid-argument', 'Tipo não aceito. Use PDF, imagem ou documento (Word, Excel, PowerPoint). SVG não é aceito.');
  const b64 = typeof d.base64 === 'string' ? d.base64 : '';
  const buf = b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
  if (!buf.length) throw new HttpsError('invalid-argument', 'Arquivo vazio ou inválido.');
  if (buf.length > 20 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Arquivo acima de 20MB.');

  const docId = crypto.randomUUID();
  const safe = nome.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'arquivo';
  const path = `imoveis/${ref.id}/${docId}_${safe}`;
  const token = crypto.randomUUID();
  await admin.storage().bucket(FICHA_BUCKET).file(path).save(buf, {
    resumable: false,
    metadata: { contentType: mime, metadata: { firebaseStorageDownloadTokens: token } }
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${FICHA_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  const porNome = await _nomeDoUid(auth.uid);
  const entrada = { id: docId, nome, url, path, tamanho: buf.length, mime, porUid: auth.uid, porNome, em: admin.firestore.Timestamp.now() };

  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
      const lista = Array.isArray(s.data().documentosExtra) ? [...s.data().documentosExtra] : [];
      if (lista.length >= 100) throw new HttpsError('resource-exhausted', 'Limite de documentos do imóvel atingido.');
      lista.push(entrada);
      tx.set(ref, { documentosExtra: lista, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    try { await admin.storage().bucket(FICHA_BUCKET).file(path).delete(); } catch (_) { /* nada a limpar */ }
    throw e;
  }
  try { await _imovelTimeline(ref, `Documento anexado: ${nome}`, porNome); } catch (_) { /* timeline é best-effort */ }
  await registrarAudit(auth, 'imovel_doc_anexar', { tipo: 'imovel', id: ref.id }, { nome });
  return { ok: true, documento: { id: docId, nome, url, porNome } };
});

// Remove um documento avulso do imóvel (dono/gestor/adm) — do array e do Storage.
exports.carteiraRemoverDoc = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref } = await _carteiraImovelComPosse(d.imovelId, auth);
  const docId = _txt(d.docId, 80);
  let removido = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
    const lista = Array.isArray(s.data().documentosExtra) ? [...s.data().documentosExtra] : [];
    const idx = lista.findIndex(x => x && x.id === docId);
    if (idx < 0) throw new HttpsError('not-found', 'Documento não encontrado.');
    removido = lista[idx];
    lista.splice(idx, 1);
    tx.set(ref, { documentosExtra: lista, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
  if (removido && removido.path) { try { await admin.storage().bucket(FICHA_BUCKET).file(removido.path).delete(); } catch (_) { /* arquivo já sumiu */ } }
  // Timeline espelha o "Documento anexado" — sem isto o Histórico do imóvel mostrava
  // um anexo que "sumiu" sem rastro (o par do negócio já registrava a remoção).
  try { await _imovelTimeline(ref, `Documento removido: ${(removido && removido.nome) || 'documento'}`, await _nomeDoUid(auth.uid)); } catch (_) { /* timeline é best-effort */ }
  await registrarAudit(auth, 'imovel_doc_remover', { tipo: 'imovel', id: ref.id }, { nome: removido && removido.nome });
  return { ok: true };
});

// Nome amigável pra chave de documento de ficha (tira prefixo de proponente/sócio/
// cônjuge e traduz os stems conhecidos; senão humaniza a chave).
const _DOC_CLI_LABEL = {
  rgcpf: 'RG / CPF', rg: 'RG', cpf: 'CPF', cnh: 'CNH / Habilitação',
  compendereco: 'Comprovante de endereço', comprenda: 'Comprovante de renda',
  compestadocivil: 'Comprovante de estado civil', cnpj_card: 'Cartão CNPJ',
  contrato: 'Contrato social', emp_renda: 'Comprovante de renda (empresa)',
  ir: 'Imposto de renda', extrato: 'Extrato bancário'
};
function _docCliLabel(k) {
  const stem = String(k).replace(/^(p\d+_|s\d+_|loc\d+_|conj_)/, '');
  const low = stem.toLowerCase();
  if (_DOC_CLI_LABEL[low]) return _DOC_CLI_LABEL[low];
  return stem.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

// Sanfona "Documentos dos clientes" da tela Documentos: lista as fichas de
// locatário/comprador (pf/pj/fiador/proposta/fiança) COM anexos, o nome do cliente,
// o imóvel a que está vinculado (se é interessado de algum) e os documentos reais
// (URL de download da própria ficha). Role-scoped (regra de ouro): corretor vê as
// suas + compartilhadas; gestor/administrativo veem todas.
exports.documentosClientes = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const uid = auth.uid;
  // Admin do Hub NÃO herda visão total da Locação (regra do projeto: permissão
  // granular por pessoa; só o bootstrap admin conta como gestor via ehGestorAuth).
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const TIPOS = ['pf', 'pj', 'locacao_fiador', 'proposta', 'fianca'];
  let fichaDocs = [];
  if (veTudo) {
    const snaps = await Promise.all(TIPOS.map(t => db.collection('fichas').where('tipo', '==', t).limit(500).get()));
    fichaDocs = snaps.flatMap(s => s.docs);
  } else {
    const [minhas, comp] = await Promise.all([
      Promise.all(TIPOS.map(t => db.collection('fichas').where('tipo', '==', t).where('corretorUid', '==', uid).limit(500).get())),
      Promise.all(TIPOS.map(t => db.collection('fichas').where('tipo', '==', t).where('visivelPara', 'array-contains', uid).limit(500).get()))
    ]);
    const vistos = new Set();
    for (const s of [...minhas, ...comp]) for (const dd of s.docs) if (!vistos.has(dd.id)) { vistos.add(dd.id); fichaDocs.push(dd); }
  }
  // Ligação ficha -> imóvel (a ficha é interessada de algum imóvel).
  const imSnap = await (veTudo ? db.collection('imoveis') : db.collection('imoveis').where('corretorUid', '==', uid)).get();
  const link = {};
  imSnap.forEach(dc => {
    const im = dc.data(); const e = im.endereco || {};
    const resumo = [e.logradouro, e.numero].filter(Boolean).join(', ') || im.tipo || 'Imóvel';
    (im.interessados || []).forEach(it => { if (it.fichaId && !link[it.fichaId]) link[it.fichaId] = { id: dc.id, resumo }; });
  });
  const clientes = fichaDocs.map(dc => {
    const f = dc.data(); const dd = f.dados || {};
    const documentos = Object.entries(f.documentos || {})
      .filter(([, url]) => typeof url === 'string' && /^https?:/.test(url))
      .map(([k, url]) => ({ nome: _docCliLabel(k), url }));
    return {
      fichaId: dc.id, tipo: f.tipo,
      nome: _txt(dd.nome || dd.razaoSocial, 120) || 'Cliente',
      imovel: link[dc.id] || null,
      documentos
    };
  }).filter(c => c.documentos.length).sort((a, b) => a.nome.localeCompare(b.nome));
  return { clientes };
});

// Tela 01 — Dashboard: tudo numa chamada só (broker vê geral; corretor só o dele).
// Responde "o que precisa da minha atenção?": negócios parados, atividades, resumo.
exports.dashboardDados = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const [imSnap, negSnap] = await Promise.all([
    (veTudo ? db.collection('imoveis') : db.collection('imoveis').where('corretorUid', '==', auth.uid)).get(),
    (veTudo ? db.collection('negocios') : db.collection('negocios').where('corretorUid', '==', auth.uid)).get(),
  ]);

  const imoveis = imSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(im => !im.arquivado);
  const negocios = negSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const ativos = negocios.filter(n => !['concluido', 'cancelado'].includes(n.status));

  // Contagem por status (Resumo da Operação)
  const porStatus = {};
  for (const n of negocios) porStatus[n.status] = (porStatus[n.status] || 0) + 1;

  // "O que precisa da sua atenção": negócios em aberto, do mais parado pro mais recente.
  const RESP = {
    negocio_criado: n => n.corretorNome || 'Corretor',
    em_andamento: n => n.corretorNome || 'Corretor',
    aguardando_broker: () => 'Broker',
    aguardando_corretor: n => n.corretorNome || 'Corretor',
    aguardando_administrativo: () => 'Administrativo',
    entregue_gestao: () => 'Gestão',
  };
  const agora = Date.now();
  const atencao = ativos
    .filter(n => n.status !== 'entregue_gestao')
    .map(n => ({
      id: n.id, codigo: n.codigo, cliente: n.clienteNome, status: n.status,
      proximaAcao: n.proximaAcao || '', tipo: n.tipo,
      responsavel: (RESP[n.status] || (() => ''))(n),
      diasParado: Math.max(0, Math.floor((agora - (n.atualizadoEm?.toMillis?.() || agora)) / 86400000)),
      progresso: (n.checklist || []).length ? Math.round(((n.checklist || []).filter(x => x.feito).length / n.checklist.length) * 100) : 0,
    }))
    .sort((a, b) => b.diasParado - a.diasParado)
    .slice(0, 8);

  // Últimas atividades: timelines dos negócios + dos imóveis, mais novo primeiro.
  const atividades = [];
  for (const n of negocios) for (const h of (n.timeline || [])) {
    atividades.push({ em: h.em?.toDate?.()?.toISOString() || null, texto: h.texto, porNome: h.porNome, ref: n.codigo });
  }
  for (const im of imoveis) for (const h of (im.timeline || [])) {
    atividades.push({ em: h.em?.toDate?.()?.toISOString() || null, texto: h.texto, porNome: h.porNome, ref: im.numeroProtocolo != null ? '#SH-' + String(im.numeroProtocolo).padStart(4, '0') : '' });
  }
  atividades.sort((a, b) => (b.em || '').localeCompare(a.em || ''));

  return {
    veTudo,
    imoveisTotal: imoveis.length,
    pendencias: imoveis.filter(im => (im.pendentes || []).length > 0).length,
    negociosAtivos: ativos.length,
    entregues: negocios.filter(n => n.status === 'entregue_gestao').length,
    concluidos: negocios.filter(n => n.status === 'concluido').length,
    porStatus,
    atencao,
    atividades: atividades.slice(0, 12),
  };
});

// Ficha de interessado (PF/PJ/Comprador) vinculada a um imóvel → interessado
// automático na Tela 03 ("Sistema cria automaticamente o interessado" — spec).
exports.onFichaInteressadoRecebida = onDocumentWritten({ document: 'fichas/{fichaId}' }, async (event) => {
  const fichaId = event.params.fichaId;
  try {
    const after = event.data?.after?.data();
    if (!after || !after.imovelId) return;
    if (!['pf', 'pj', 'proposta'].includes(after.tipo)) return;
    const before = event.data?.before?.data();
    // Dispara na criação e no reenvio (status volta pra aguardando_corretor); ignora o resto.
    if (after.status !== 'aguardando_corretor') return;
    if (before && before.status === 'aguardando_corretor') return;

    const ref = db.collection('imoveis').doc(after.imovelId);
    const dados = after.dados || {};
    const nome = _txt(dados.nome || dados.razaoSocial || dados.nomeCompleto, 120) || 'Interessado';
    const contato = _txt(dados.whatsapp || dados.telefone || dados.email, 120);
    const tipoInt = after.tipo === 'proposta' ? 'comprador' : 'locatario';

    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      // Recusa ficha apontando pra imóvel de OUTRO corretor: o link legítimo carrega
      // o dono do imóvel (ver hub-app), então corretorUid da ficha === dono do imóvel.
      // Sem isto, quem tivesse um link válido poderia trocar o imovelId na mão e
      // despejar "Ficha recebida" na carteira alheia. Imóvel legado sem dono passa.
      if (s.data().corretorUid && after.corretorUid && s.data().corretorUid !== after.corretorUid) return;
      const lista = Array.isArray(s.data().interessados) ? [...s.data().interessados] : [];
      // Reenvio (mesma ficha) atualiza; senão casa por NOME — igualdade exata
      // normalizada (sem caixa/acento) com qualquer interessado vivo (cada envio da
      // ficha gera um fichaId NOVO no cliente; sem isso, reenvio duplicava a pessoa),
      // ou por prefixo SÓ com quem está "Ficha enviada" (nome digitado pelo corretor
      // pode diferir do que o cliente escreve; prefixo em status avançado mesclaria
      // pessoas parecidas — Maria Silva × Maria Silvano). Negócio gerado não é tocado.
      const _normNome = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
      let i = lista.findIndex(p => p.fichaId === fichaId);
      if (i < 0) i = lista.findIndex(p => p.status !== 'negocio_gerado' && _normNome(p.nome) === _normNome(nome));
      if (i < 0) i = lista.findIndex(p => p.status === 'ficha_enviada' && p.nome && _normNome(nome).startsWith(_normNome(p.nome).slice(0, 30)));
      const entrada = { nome, contato, tipo: tipoInt, status: 'ficha_recebida', fichaId, fichaTipo: after.tipo,
        email: _txt(dados.email, 120) || '', cpf: _txt(dados.cpf || dados.cnpj, 30) || '', telefone: _txt(dados.whatsapp || dados.telefone, 40) || '',
        statusEm: admin.firestore.Timestamp.now() };
      if (i >= 0) {
        // Não rebaixa NENHUMA decisão já tomada: só volta pra "ficha_recebida" quem
        // ainda estava em ficha_enviada/ficha_recebida. Aprovado/reprovado/desistiu/
        // em_analise/negocio_gerado (decisões do broker ou etapas avançadas) ficam
        // como estão — o reenvio só atualiza os dados da ficha (nome/contato/fichaId).
        const atual = lista[i].status;
        const st = (atual === 'ficha_enviada' || atual === 'ficha_recebida' || !atual) ? 'ficha_recebida' : atual;
        lista[i] = { ...lista[i], ...entrada, status: st };
      } else {
        if (lista.length >= 50) return;
        lista.push({ ...entrada, em: admin.firestore.Timestamp.now() });
      }
      const tl = Array.isArray(s.data().timeline) ? [...s.data().timeline] : [];
      tl.push({ texto: `Ficha recebida de ${nome}`, porNome: 'Sistema', em: admin.firestore.Timestamp.now() });
      tx.set(ref, { interessados: lista, timeline: tl.slice(-300), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) { await logErro('onFichaInteressadoRecebida', e, { fichaId }); }
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
const PORTAL_BASE = HOSTING_BASE;   // portais servidos do Hosting do próprio projeto (prod/staging)

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

// ─── Integração CheckVisto (contrato INTEGRACAO-CHECKVISTO.md v1.1) ──────────
const CHECKVISTO_SOLICITAR_URL = 'https://us-central1-checkvisto-app.cloudfunctions.net/hubSolicitarVistoria';

// Solicita a vistoria lá no CheckVisto (vira agendamento + push pro vistoriador)
// e registra aqui como vistoria "agendada" de origem checkvisto.
exports.locSolicitarVistoriaCheckVisto = onCall({ secrets: [HUB_CHECKVISTO_SECRET] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId, tipo, vistoriadorEmail, horario } = req.data || {};
  if (!['entrada', 'saida'].includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo inválido.');
  const email = _txt(vistoriadorEmail, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Informe o e-mail da conta CheckVisto do vistoriador.');
  const { snap } = await _carteiraImovelComPosse(imovelId, auth);
  const im = snap.data();
  const e = im.endereco || {};
  const ambiente = process.env.GCLOUD_PROJECT === 'remax-smart-hub-staging' ? 'staging' : 'prod';

  const r = await fetch(CHECKVISTO_SOLICITAR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-integracao-secret': HUB_CHECKVISTO_SECRET.value() },
    body: JSON.stringify({
      hubImovelId: imovelId, ambiente, tipo,
      endereco: [e.logradouro, e.numero, e.bairro, e.cidade].filter(Boolean).join(', '),
      codigoHub: im.numeroProtocolo != null ? '#SH-' + String(im.numeroProtocolo).padStart(4, '0') : '',
      proprietarioNome: im.proprietarioNome || '',
      corretorNome: im.corretorNome || '',
      vistoriadorEmail: email,
      horario: _txt(horario, 16),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new HttpsError('unavailable', 'CheckVisto recusou: ' + (j.erro || ('HTTP ' + r.status)));

  // Registro local: aparece na Gestão da Locação já como Agendada.
  if (!j.jaExistia) {
    await db.collection('vistorias').add({
      imovelId, contratoId: imovelId, corretorUid: im.corretorUid,
      tipo, status: 'agendada', laudoUrl: '', obs: `Solicitada no CheckVisto (${email})`,
      origem: 'checkvisto', idExterno: j.agendaId || '',
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    await _imovelTimeline(db.collection('imoveis').doc(imovelId), `Vistoria de ${tipo} solicitada no CheckVisto`, await _nomeDoUid(auth.uid));
  }
  return { ok: true, jaExistia: !!j.jaExistia };
});

// Webhook: o CheckVisto avisa quando a vistoria muda de status lá.
// Upsert idempotente por idExterno; senão "promove" a solicitação agendada.
exports.vistoriaWebhook = onRequest({ secrets: [HUB_CHECKVISTO_SECRET] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    if ((req.get('x-integracao-secret') || '') !== HUB_CHECKVISTO_SECRET.value()) return res.status(401).json({ ok: false });
    const b = req.body || {};
    const hubImovelId = typeof b.hubImovelId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(b.hubImovelId) ? b.hubImovelId : '';
    const idExterno = _txt(b.vistoriaId, 60);
    const tipo = ['entrada', 'saida'].includes(b.tipo) ? b.tipo : '';
    const status = VISTORIA_STATUS.includes(b.status) ? b.status : '';
    if (!hubImovelId || !idExterno || !tipo || !status) return res.status(400).json({ ok: false, erro: 'payload inválido' });

    const imSnap = await db.collection('imoveis').doc(hubImovelId).get();
    if (!imSnap.exists) return res.status(404).json({ ok: false, erro: 'imóvel não existe' });

    // 1º por idExterno; 2º a solicitação "agendada" desse imóvel+tipo; senão cria.
    let ref = null, atual = null;
    const porExt = await db.collection('vistorias').where('idExterno', '==', idExterno).limit(1).get();
    if (!porExt.empty) { ref = porExt.docs[0].ref; atual = porExt.docs[0].data(); }
    if (!ref) {
      const ag = await db.collection('vistorias').where('imovelId', '==', hubImovelId)
        .where('origem', '==', 'checkvisto').where('tipo', '==', tipo).where('status', '==', 'agendada').limit(1).get();
      if (!ag.empty) { ref = ag.docs[0].ref; atual = ag.docs[0].data(); }
    }
    if (!ref) ref = db.collection('vistorias').doc();

    // Guarda monotônica: webhook fora de ordem / reentregue não regride o status
    // (a vistoria não "desanda" de laudo_emitido → realizada → agendada) nem apaga
    // um laudo já recebido. Fluxo normal (só avança) fica idêntico ao de antes.
    const rank = s => ({ agendada: 0, realizada: 1, laudo_emitido: 2 })[s] ?? -1;
    const atualStatus = atual ? atual.status : null;
    const regride = !!atual && rank(status) < rank(atualStatus);
    const statusFinal = regride ? atualStatus : status;
    const laudoAtual = atual ? _txt(atual.laudoUrl, 500) : '';
    const laudoFinal = regride ? laudoAtual : (_txt(b.laudoUrl, 500) || laudoAtual);

    await ref.set({
      imovelId: hubImovelId, contratoId: hubImovelId, corretorUid: imSnap.data().corretorUid || '',
      tipo, status: statusFinal, laudoUrl: laudoFinal, obs: _txt(b.obs, 300),
      origem: 'checkvisto', idExterno,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await recomputarChecklistAuto(hubImovelId);
    if (statusFinal !== atualStatus) {
      await _imovelTimeline(db.collection('imoveis').doc(hubImovelId),
        `Vistoria de ${tipo} no CheckVisto: ${statusFinal === 'laudo_emitido' ? 'laudo emitido' : statusFinal}`, 'CheckVisto');
    }
    return res.json({ ok: true });
  } catch (e) {
    await logErro('vistoriaWebhook', e, {});
    return res.status(500).json({ ok: false });
  }
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
  const auth = await exigirAdmin(req);
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
  // Admin vendo a senha em CLARO é o evento que a auditoria diz cobrir — o autologin
  // (getCredentials) loga 'viu_credencial', mas o modal Editar não logava nada.
  if (password) await registrarAudit(auth, 'viu_credencial', { tipo: 'credencial', id: siteKey }, { via: 'admin_editar' });
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
  // siteKey/titulo são texto livre do cliente e vão parar na tabela de Usuários do
  // Admin. O render lá ESCAPA (fix do XSS), mas aqui limitamos o tamanho por higiene.
  const siteKey = _txt(req.data && req.data.siteKey, 80);
  const titulo = _txt(req.data && req.data.titulo, 120);
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
exports.listarStatusApps = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
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
  await _bumpBroadcast('statusSeq');
  return { ok: true };
});

// ─── Perfil do usuário (nome + foto) ─────────────────────────────────────────
// Fotos de perfil por uid (avatar do corretor na tabela de fichas).
// Só autenticado; devolve apenas quem tem foto. As fotos são base64 e
// pesam — por isso o front pede só os uids que aparecem na tela.
exports.listarFotosPerfil = onCall(async (req) => {
  exigirAutenticado(req);
  const { uids } = req.data || {};
  if (!Array.isArray(uids) || !uids.length) return { fotos: {} };
  const unicos = [...new Set(uids.filter(u => typeof u === 'string' && u))].slice(0, 100);
  const snaps = await db.getAll(...unicos.map(u => db.collection('user_profiles').doc(u)));
  const fotos = {};
  snaps.forEach(s => { if (s.exists && s.data().photo) fotos[s.id] = s.data().photo; });
  return { fotos };
});

exports.getMeuPerfil = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
  const auth = exigirAutenticado(req);
  const userRec = await admin.auth().getUser(auth.uid).catch(() => null);
  const snap = await db.collection('user_profiles').doc(auth.uid).get();
  const p = snap.exists ? snap.data() : {};
  return {
    email: (userRec && userRec.email) || (auth.token && auth.token.email) || '',
    displayName: (userRec && userRec.displayName) || '',
    photo: p.photo || '',
    telefone: p.telefone || '',
    creci: p.creci || '',
    cpf: p.cpf || ''
  };
});

exports.salvarMeuPerfil = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const { displayName, photo, telefone, creci, cpf } = req.data || {};
  const upd = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (typeof displayName === 'string' && displayName.trim()) {
    const nome = displayName.trim().slice(0, 80);
    await admin.auth().updateUser(auth.uid, { displayName: nome });
    upd.displayName = nome;
  }
  // Telefone/WhatsApp: string simples (aparece nos templates de marketing). String
  // vazia é válida — é como o corretor limpa o campo.
  if (typeof telefone === 'string') {
    upd.telefone = telefone.trim().slice(0, 30);
  }
  // CRECI e CPF: preenchem o contrato de representação (venda). String vazia é
  // válida (limpa o campo). Mesmo padrão aditivo do telefone.
  if (typeof creci === 'string') {
    upd.creci = creci.trim().slice(0, 30);
  }
  if (typeof cpf === 'string') {
    upd.cpf = cpf.trim().slice(0, 20);
  }
  if (typeof photo === 'string') {
    // foto = data URL (base64) pequena. Limite de segurança ~300KB.
    if (photo.length > 400000) {
      throw new HttpsError('invalid-argument', 'Foto muito grande. Tente uma imagem menor.');
    }
    // O FORMATO é obrigatório: esta string é renderizada em src="..." por OUTROS
    // usuários (listarFotosPerfil → Cadastro do admin, Pessoas/Produção do Broker).
    // Sem esta trava, texto arbitrário aqui vira XSS armazenado na sessão de quem
    // abre a tela — inclusive o admin, que alcança getCredentials. Só data URL de
    // imagem raster, base64, nada de svg (é XML e carrega script). String vazia
    // limpa a foto (mesmo padrão aditivo dos outros campos).
    if (photo !== '' && !/^data:image\/(png|jpe?g|webp|gif|bmp|avif|heic|heif);base64,[A-Za-z0-9+/=]+$/i.test(photo)) {
      throw new HttpsError('invalid-argument', 'Formato de foto inválido. Envie uma imagem (PNG, JPG ou WEBP).');
    }
    upd.photo = photo;
  }
  await db.collection('user_profiles').doc(auth.uid).set(upd, { merge: true });
  await registrarAudit(auth, 'editou_perfil', { tipo: 'usuario', id: auth.uid },
    { alterouNome: 'displayName' in upd, alterouFoto: 'photo' in upd, alterouTelefone: 'telefone' in upd,
      alterouCreci: 'creci' in upd, alterouCpf: 'cpf' in upd });
  return { ok: true };
});

// ─── Contrato de Representação (venda) ────────────────────────────────────────
// Preenche o PDF-modelo da RE/MAX (AcroForm) com os dados dos vendedores + imóvel
// + corretor e devolve o PDF pronto (base64). O texto jurídico, os dados da REMAX
// e prazo/%/foro JÁ vêm no modelo — a gente só injeta o que falta.
//
// ⚠️ Os nomes dos campos do PDF são "sem sentido" (foi um editável mal nomeado);
// o mapa abaixo foi conferido VISUALMENTE campo a campo (não reordenar às cegas).
const CONTRATO_CAMPOS = {
  // 4 blocos de contratante (pág. 3), na ordem em que aparecem
  vendedores: [
    { nome:'07ggfA',     rg:'07gggA',  cpf:'07ggAuu0',      endereco:'07ggsA',     nacionalidade:'07ggAs0',  civil:'07ggAyy0',   email:'07ggAe',    tel1:'07ggAt0',  tel2:'07ggAt0fg1' },
    { nome:'07ggAy0',    rg:'07ggAnn0',cpf:'07ggAj0',       endereco:'07ggAn0',    nacionalidade:'07ggAgg0', civil:'07ggAy0h1',  email:'07ggAr0',   tel1:'07ggAhh0', tel2:'07ggfAb1' },
    { nome:'07ggAgg041', rg:'07ggAll0',cpf:'07ggArr1',      endereco:'07ggAk0',    nacionalidade:'07ggAçç0', civil:'07ggA',      email:'07ggAl0',   tel1:'07ggAoo0', tel2:'07ggAu0' },
    { nome:'07ggAqwq1',  rg:'07ggA771',cpf:'07ggAh1',       endereco:'07ggA451',   nacionalidade:'07ggA871', civil:'07ggA441',   email:'07ggAss1',  tel1:'07ggA331', tel2:'07ggAj0765561' }
  ],
  // bloco do imóvel (pág. 4)
  imovel: { tipo:'25dFDG', endereco:'BBB', complemento:'2EE5', bairro:'25RR', municipio:'2W5', estado:'2wE',
            classificacaoFiscal:'25RfR', matricula:'25E', cartorio:'2gg5RR', valor:'25FDvG', observacoes:'25FDG' },
  // corretor (pág. 5, ao lado da assinatura da CONTRATADA)
  corretor: { nome:'Texto novo 0006', creci:'Texto novo 00006', cpf:'Texto novo 000006' }
};

function _contratoEndereco(o) {
  const p = k => (o[k] || '').toString().trim();
  const rua = p('logradouro') || p('endereco');
  const partes = [
    rua + (p('numero') ? ', ' + p('numero') : ''),
    p('complemento'),
    p('bairro'),
    (p('cidade') ? p('cidade') + (p('estado') ? '/' + p('estado') : '') : p('estado')),
    p('cep') ? 'CEP ' + p('cep') : ''
  ].filter(Boolean);
  return partes.join(' - ');
}

// (autenticado, com posse) Gera o contrato de representação de um imóvel de VENDA.
exports.gerarContratoVenda = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { imovelId } = req.data || {};
  if (!imovelId) throw new HttpsError('invalid-argument', 'imovelId é obrigatório.');

  const imSnap = await db.collection('imoveis').doc(imovelId).get();
  if (!imSnap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
  const imovel = imSnap.data();

  // posse: corretor dono OU gestor/administrativo
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && imovel.corretorUid !== auth.uid) {
    throw new HttpsError('permission-denied', 'Sem acesso a este imóvel.');
  }
  const finalidade = imovel.finalidade || 'locacao';
  if (finalidade !== 'venda' && finalidade !== 'venda_locacao') {
    throw new HttpsError('failed-precondition', 'O contrato de representação é só para imóveis de venda.');
  }

  // Vendedores: vêm da ficha do vendedor que originou o imóvel (dados pessoais ficam
  // na ficha, não em `pessoas`). Imóvel manual não tem ficha → sai sem vendedores.
  // SÓ a ficha vinculada pelo próprio imóvel (imovel.fichaId, carimbada pelo trigger
  // onFichaVendedorEnviadaAdmin). Um imóvel só é escrito por Cloud Function, então
  // ninguém injeta um fichaId num imóvel manual. NÃO cair num fallback por
  // where('imovelId','==',...): a salvarFichaPublica é anônima e aceita imovelId
  // arbitrário, então qualquer um criaria uma ficha de vendedor apontando pro imóvel
  // e envenenaria os dados do contrato. Imóvel manual (sem fichaId) sai como semFicha.
  let fichaDados = null;
  if (imovel.fichaTipo === 'vendedor' && imovel.fichaId) {
    const fSnap = await db.collection('fichas').doc(imovel.fichaId).get();
    if (fSnap.exists) fichaDados = fSnap.data().dados || {};
  }

  const vendedores = [];
  if (fichaDados) {
    const prefixos = ['', 'loc2_', 'loc3_', 'loc4_'];
    prefixos.forEach((P, i) => {
      const d = fichaDados;
      const nome = (d[P + 'nome'] || '').toString().trim();
      if (!nome) return;
      vendedores.push({
        nome,
        rg: d[P + 'rg'] || '',
        cpf: d[P + 'cpf'] || '',
        endereco: _contratoEndereco({
          logradouro: d[P + 'endereco'], numero: d[P + 'numero'], complemento: d[P + 'complemento'],
          bairro: d[P + 'bairro'], cidade: d[P + 'cidade'], estado: d[P + 'estado'], cep: d[P + 'cep']
        }),
        nacionalidade: d[P + 'nacionalidade'] || 'Brasileiro(a)',
        civil: d[P + 'civil'] || '',
        email: d[P + 'email'] || '',
        tel1: (i === 0 ? d['whatsapp'] : d[P + 'celular']) || '',
        tel2: d[P + 'fixo'] || ''
      });
    });
  }

  // Corretor = quem enviou a ficha (dono do imóvel). Nome vem do imóvel/Auth; CRECI/CPF do perfil.
  const perfilSnap = await db.collection('user_profiles').doc(imovel.corretorUid).get();
  const perfil = perfilSnap.exists ? perfilSnap.data() : {};
  const donoRec = await admin.auth().getUser(imovel.corretorUid).catch(() => null);
  const corretor = {
    nome: imovel.corretorNome || (donoRec && donoRec.displayName) || '',
    creci: perfil.creci || '',
    cpf: perfil.cpf || ''
  };

  // Preenche o PDF-modelo
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument } = require('pdf-lib');
  const tpl = fs.readFileSync(path.join(__dirname, 'assets', 'contrato-representacao-pf.pdf'));
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm();
  // A fonte padrão do PDF (Helvetica/WinAnsi) não codifica travessão, aspas curvas,
  // reticências, emoji etc. — colar de observações/endereço traz isso e o pdf.save()
  // estouraria. Troca pelos equivalentes ASCII e derruba o resto (acento do português é WinAnsi, fica).
  const _ansi = (s) => String(s)
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .replace(/[^ -ÿ]/g, '');
  const setF = (campo, valor) => {
    if (!campo || valor == null || String(valor).trim() === '') return;
    try { form.getTextField(campo).setText(_ansi(valor)); } catch (_) { /* campo ausente no modelo */ }
  };

  vendedores.slice(0, 4).forEach((v, i) => {
    const c = CONTRATO_CAMPOS.vendedores[i];
    setF(c.nome, v.nome);   setF(c.rg, v.rg);   setF(c.cpf, v.cpf);
    setF(c.endereco, v.endereco);  setF(c.nacionalidade, v.nacionalidade);  setF(c.civil, v.civil);
    setF(c.email, v.email);  setF(c.tel1, v.tel1);  setF(c.tel2, v.tel2);
  });

  const im = CONTRATO_CAMPOS.imovel;
  const e = imovel.endereco || {};
  setF(im.tipo, imovel.tipo);
  setF(im.endereco, [e.logradouro, e.numero].filter(Boolean).join(', '));
  setF(im.complemento, e.complemento);
  setF(im.bairro, e.bairro);
  setF(im.municipio, e.cidade);
  setF(im.estado, e.estado);
  setF(im.classificacaoFiscal, imovel.contribuinteIptu);
  setF(im.valor, imovel.valorAnuncio || imovel.valorProposta);
  setF(im.observacoes, (imovel.administracao && imovel.administracao.observacoes) || '');
  setF(im.matricula, imovel.matricula || '');
  setF(im.cartorio, imovel.cartorio || '');

  setF(CONTRATO_CAMPOS.corretor.nome, corretor.nome);
  setF(CONTRATO_CAMPOS.corretor.creci, corretor.creci);
  setF(CONTRATO_CAMPOS.corretor.cpf, corretor.cpf);

  const bytes = await pdf.save();
  const ref = imovel.referencia || imovel.numeroProtocolo || imovelId;
  const filename = 'Contrato-Representacao-' + String(ref).replace(/[^a-zA-Z0-9-]+/g, '_') + '.pdf';

  // Sobe o contrato pro Drive do DONO do imóvel (se conectado), na pasta do vendedor
  // → Documentos Diversos. Best-effort: nunca falha a geração do contrato.
  let drive = false;
  try {
    const uid = imovel.corretorUid;
    const tokDoc = uid && (await db.collection('google_tokens').doc(uid).get());
    if (tokDoc && tokDoc.exists && tokDoc.data().drive) {
      const nomePessoa = _driveSanitizar((vendedores[0] && vendedores[0].nome) || imovel.proprietarioNome || ('Imóvel ' + imovelId.slice(0, 8)));
      const token = await _driveToken(uid);
      const rootId = await _driveRoot(token, uid);
      const pastaPessoa = await _driveFindOrCreateFolder(token, nomePessoa, rootId);
      const diversos = await _driveFindOrCreateFolder(token, 'Documentos Diversos', pastaPessoa);
      const nomeArq = _driveSanitizar('Contrato de Representação - ' + nomePessoa) + '.pdf';
      if (!(await _driveArquivoExiste(token, nomeArq, diversos))) await _driveUploadBuffer(token, nomeArq, diversos, Buffer.from(bytes), 'application/pdf');
      drive = true;
    }
  } catch (e) { console.error('driveContrato', (e && e.message) || e); }

  await registrarAudit(auth, 'gerou_contrato_venda', { tipo: 'imovel', id: imovelId }, { vendedores: vendedores.length, drive });

  return {
    pdfBase64: Buffer.from(bytes).toString('base64'),
    filename,
    vendedores: vendedores.length,
    semFicha: !fichaDados,
    semCreci: !corretor.creci,
    drive
  };
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
exports.listarBanners = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
  exigirAutenticado(req);
  const snap = await db.collection('banners').orderBy('ordem').get();
  // Modo LEVE ({leve:true}): só id+rev — o timer de 3 min do Hub usa isso pra saber
  // se algo mudou SEM baixar o base64 (até 600KB por banner) toda vez. O payload
  // completo só trafega quando a assinatura muda. (Corta ~GB/mês de egress.)
  if (req.data && req.data.leve) {
    return { banners: snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, tipo: x.tipo || 'imagem', rev: x.updatedAt?.toMillis?.() || 0 };
    })};
  }
  return { banners: snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, tipo: x.tipo || 'imagem', rev: x.updatedAt?.toMillis?.() || 0, imagem: x.imagem || '', mediaUrl: x.mediaUrl || '', duracao: x.duracao || null };
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
  await _bumpBroadcast('bannerSeq');
  return { ok: true, id: ref.id };
});

exports.removerBanner = onCall(async (req) => {
  await exigirAdmin(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  await db.collection('banners').doc(id).delete();
  await _bumpBroadcast('bannerSeq');
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
  await _bumpBroadcast('bannerSeq');
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
  await _bumpBroadcast('bannerSeq');
  return { ok: true };
});

// ─── Novidades (patch notes) ─────────────────────────────────────────────────
// Coleção `novidades` (1 doc por versão, id = "1.0.135"). Sem PII: qualquer logado
// LÊ (pra ver o "o que há de novo"); só admin ESCREVE (via salvarNovidade). O broadcast
// (novidadeSeq) deixa a bolinha "não lida" acender em tempo real quando o admin publica.
function _listaTexto(arr, maxItens, maxLen) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const s of arr) { const t = _txt(s, maxLen); if (t) out.push(t); if (out.length >= maxItens) break; }
  return out;
}
// Compara versões tipo "1.0.135" vs "1.0.9" numericamente (135 > 9), não como texto.
function _cmpVersao(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x - y; }
  return 0;
}

// Marca no INÍCIO do item = novidade só pro gestor. O servidor NEM ENVIA esses itens pra
// quem não é gestor (corretor/administrativo não veem, nem inspecionando). Gestor/admin
// recebem sem a marca (texto limpo). Assim uma nota pode misturar itens gerais e de gestor.
const NOV_MARCA_GESTOR = '@gestor ';
exports.listarNovidades = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const veGestor = ehGestorAuth(auth) || !!(auth.token && auth.token.admin === true);
  const filtrar = (arr) => (Array.isArray(arr) ? arr : []).reduce((out, item) => {
    if (typeof item !== 'string') return out;
    if (item.startsWith(NOV_MARCA_GESTOR)) { if (veGestor) out.push(item.slice(NOV_MARCA_GESTOR.length)); }
    else out.push(item);
    return out;
  }, []);
  const snap = await db.collection('novidades').get();
  let novidades = snap.docs.map(x => {
    const n = x.data();
    const item = {
      versao: n.versao || x.id,
      novo: filtrar(n.novo), melhorias: filtrar(n.melhorias), correcoes: filtrar(n.correcoes),
      criadoEm: n.criadoEm?.toDate?.()?.toISOString() || null,
      atualizadoEm: n.atualizadoEm?.toDate?.()?.toISOString() || null,
    };
    // Campos CRUS (com a marca @gestor intacta) só pro editor do Admin — gestor/admin.
    if (veGestor) {
      item.novoRaw = Array.isArray(n.novo) ? n.novo : [];
      item.melhoriasRaw = Array.isArray(n.melhorias) ? n.melhorias : [];
      item.correcoesRaw = Array.isArray(n.correcoes) ? n.correcoes : [];
    }
    return item;
  });
  // Some a versão inteira se, depois do filtro, não sobrou nada (evita "novidade vazia").
  novidades = novidades.filter(n => n.novo.length || n.melhorias.length || n.correcoes.length);
  novidades.sort((a, b) => _cmpVersao(b.versao, a.versao)); // mais nova primeiro
  return { novidades };
});

exports.salvarNovidade = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const d = req.data || {};
  const versao = _txt(d.versao, 20);
  if (!versao || !/^[0-9]+(\.[0-9]+)*$/.test(versao)) throw new HttpsError('invalid-argument', 'Versão inválida (ex.: 1.0.135).');
  const ref = db.collection('novidades').doc(versao);
  const snap = await ref.get();
  const up = {
    versao,
    novo: _listaTexto(d.novo, 30, 240),
    melhorias: _listaTexto(d.melhorias, 30, 240),
    correcoes: _listaTexto(d.correcoes, 30, 240),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoPor: auth.uid,
  };
  if (!snap.exists) up.criadoEm = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(up, { merge: true });
  await _bumpBroadcast('novidadeSeq');
  await registrarAudit(auth, 'salvou_novidade', { tipo: 'novidade', id: versao }, {});
  return { ok: true };
});

exports.excluirNovidade = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const versao = _txt((req.data || {}).versao, 20);
  if (!versao) throw new HttpsError('invalid-argument', 'Versão obrigatória.');
  await db.collection('novidades').doc(versao).delete();
  await _bumpBroadcast('novidadeSeq');
  await registrarAudit(auth, 'excluiu_novidade', { tipo: 'novidade', id: versao }, {});
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
const STORAGE_BUCKET = PROJECT_BUCKET;   // bucket do próprio projeto (prod/staging)
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

  // O doc do Firestore tem teto de ~1MB. Print acima disso fazia o add() estourar
  // DEPOIS do e-mail já ter saído: o TI recebia o e-mail e o chamado nunca aparecia
  // na lista. Anexo grande passa a ir só por e-mail; o chamado entra sempre.
  const anexoCabeNoDoc = attachments.length && typeof imagem === 'string' && imagem.length <= 700000;
  await db.collection('chamados').add({
    mensagem: texto,
    imagemUrl: anexoCabeNoDoc ? imagem : null,
    imagemNome: imagemNome || null,
    imagemSoPorEmail: !!(attachments.length && !anexoCabeNoDoc),
    status: 'aberto',
    criadoPor: auth.uid,
    criadoPorNome: nome,
    criadoPorEmail: email,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    resposta: null,
    resolvidoPor: null,
    resolvidoEm: null
  });

  await _bumpBroadcast('chamadoSeq');   // tempo real: acende o badge do TI na hora
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

  await _bumpUserFeed(dados.criadoPor, 'resposta');   // tempo real: campainha do usuário → vê a resposta na hora
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
exports.conectarGoogleAgenda = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
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
    // marca se este consentimento concedeu o escopo do Drive — o trigger de
    // sincronização só age em quem tem `drive:true` (evita 403 em quem só ligou a Agenda).
    drive: (tokens.scope || '').includes('/auth/drive.file'),
    // qual cliente OAuth emitiu este refresh_token (web vs desktop) — o getAccessToken
    // precisa renovar com o MESMO cliente. redirect https ⇒ web.
    web: /^https:\/\//i.test(redirectUri || ''),
    connectedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, email };
});

exports.desconectarGoogleAgenda = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  await db.collection('google_tokens').doc(auth.uid).delete();
  return { ok: true };
});

exports.statusGoogleAgenda = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
  const auth = exigirAutenticado(req);
  const snap = await db.collection('google_tokens').doc(auth.uid).get();
  if (!snap.exists) return { conectado: false, email: '' };
  return { conectado: true, email: snap.data().email || '' };
});

// ═══ Google Drive: organização automática de documentos (escopo drive.file) ═══
// Reaproveita o MESMO OAuth da Agenda (google_tokens/{uid}.refreshToken) — basta o
// escopo drive.file estar no consentimento. Como drive.file só dá acesso ao que o
// APP cria, a raiz é uma pasta criada por nós na conta conectada. (Fase 2: apontar
// pra pasta da empresa via Google Picker, mantendo drive.file — sem verificação pesada.)
const DRIVE_ROOT_NOME = 'REMAX Smart Hub — Documentos';
// Estrutura: raiz → pasta da PESSOA (nome vindo da ficha) → 4 categorias de documento.
const DRIVE_CATEGORIAS = [
  { key: 'identidade',   nome: 'Identidade' },
  { key: 'comprovantes', nome: 'Comprovantes' },
  { key: 'imovel',       nome: 'Imóvel' },
  { key: 'diversos',     nome: 'Documentos Diversos' },
];
// Decide a categoria pelo NOME DO CAMPO do documento (o app sabe o que cada arquivo é).
function _categoriaDoc(campo) {
  const c = String(campo || '').toLowerCase();
  // rgcpf/p_rgcpf/f_rgcpf/soc_rgcpf vêm colados (sem \b entre rg e cpf) — casar a string inteira.
  if (/rgcpf|\brg\b|identidade|cnh|\bcpf\b|cnpj|ident/.test(c)) return 'identidade';
  // energia/agua/gas = contas de consumo (comprovante de endereço) da ficha do locador.
  if (/comprov|renda|endere|energia|\bagua\b|\bg[aá]s\b/.test(c)) return 'comprovantes';
  if (/matric|iptu|escritura|im[oó]vel|condom/.test(c)) return 'imovel';
  return 'diversos'; // contrato e demais
}
function _driveSanitizar(nome) { return String(nome || '').replace(/[\\/:*?"<>|\r\n]+/g, '-').trim().slice(0, 120) || 'Sem nome'; }

async function _driveToken(uid) {
  const snap = await db.collection('google_tokens').doc(uid).get();
  if (!snap.exists || !snap.data().refreshToken) throw new HttpsError('failed-precondition', 'Conta Google não conectada — conecte nas Configurações.');
  return getAccessToken(snap.data().refreshToken, snap.data().web);
}
async function _driveApi(token, path, opts = {}) {
  const resp = await fetch('https://www.googleapis.com/drive/v3/' + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new HttpsError('internal', 'Drive: ' + ((data.error && data.error.message) || resp.status));
  return data;
}
// Procura (só entre o que o app criou) uma pasta por nome+pai; cria se não existir.
async function _driveFindOrCreateFolder(token, nome, parentId) {
  const nomeEsc = nome.replace(/'/g, "\\'");
  let q = `mimeType='application/vnd.google-apps.folder' and name='${nomeEsc}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const found = await _driveApi(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`);
  if (found.files && found.files.length) return found.files[0].id;
  const meta = { name: nome, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const created = await _driveApi(token, 'files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  return created.id;
}
// Garante a pasta-raiz (as categorias agora vivem dentro da pasta de cada pessoa);
// cacheia o rootId em drive_config/{uid}.
async function _driveRoot(token, uid) {
  const cfgRef = db.collection('drive_config').doc(uid);
  const cfg = (await cfgRef.get()).data() || {};
  let rootId = cfg.rootId;
  if (rootId) { try { const r = await _driveApi(token, `files/${rootId}?fields=id,trashed`); if (r.trashed) rootId = null; } catch (_e) { rootId = null; } }
  if (!rootId) rootId = await _driveFindOrCreateFolder(token, DRIVE_ROOT_NOME, null);
  await cfgRef.set({ rootId, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return rootId;
}
// Sobe um Buffer pro Drive (multipart).
async function _driveUploadBuffer(token, nome, parentId, buf, contentType) {
  // Boundary aleatório: um determinístico poderia colidir com bytes do próprio arquivo.
  const boundary = 'rmxdrv' + crypto.randomUUID().replace(/-/g, '');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nome, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new HttpsError('internal', 'Drive upload: ' + ((data.error && data.error.message) || resp.status));
  return data;
}
// Baixa de uma URL (Storage) e sobe pro Drive.
async function _driveUpload(token, nome, parentId, url) {
  // SSRF: mesma allowlist do fetchBuffer. Fichas antigas (anteriores ao fechamento
  // das regras na v1.0.100) podem ter URL arbitrária em `documentos`; sem isto, a
  // function buscava o alvo e subia a resposta pro Drive do corretor.
  if (!urlStoragePermitida(url)) throw new HttpsError('invalid-argument', 'URL de anexo não permitida.');
  const r = await fetch(url);
  if (!r.ok) throw new HttpsError('internal', 'Falha ao baixar anexo (' + r.status + ')');
  return _driveUploadBuffer(token, nome, parentId, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || 'application/octet-stream');
}

// Dedup: já existe arquivo com esse nome na pasta? (torna o trigger idempotente)
async function _driveArquivoExiste(token, nome, parentId) {
  const q = `name='${nome.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const r = await _driveApi(token, `files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  return !!(r.files && r.files.length);
}
// Igual ao anterior mas devolve {id,name} (ou null) — a sync precisa do ID pra registrar
// o que o robô subiu e poder remover depois.
async function _driveAcharArquivo(token, nome, parentId) {
  const q = `name='${nome.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const r = await _driveApi(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  return (r.files && r.files.length) ? r.files[0] : null;
}
// Núcleo da sincronização — usado pela callable (auth.uid) e pelo trigger (corretorUid).
async function _driveSyncFicha(uid, fichaId, col) {
  const snap = await db.collection(col).doc(fichaId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  const ficha = snap.data();
  const tipo = col === 'fichas_locador' ? 'locador' : (ficha.tipo || 'diversos');
  const d = ficha.dados || {};
  const nomePessoa = _driveSanitizar(d.nome || d.razaoSocial || d.nomeCompleto || ('Ficha ' + fichaId.slice(0, 8)));
  const campos = Object.entries(ficha.documentos || {}).filter(([, u]) => typeof u === 'string' && /^https?:/.test(u));
  const token = await _driveToken(uid);
  const rootId = await _driveRoot(token, uid);
  // Pasta da PESSOA (nome vindo da ficha) na raiz, e as 4 categorias dentro dela.
  const pastaPessoa = await _driveFindOrCreateFolder(token, nomePessoa, rootId);
  const cats = {};
  for (const c of DRIVE_CATEGORIAS) cats[c.key] = await _driveFindOrCreateFolder(token, c.nome, pastaPessoa);
  const arquivos = [];
  for (const [campo, url] of campos) {
    const nome = _driveSanitizar(campo);
    const dest = cats[_categoriaDoc(campo)];
    try { if (await _driveArquivoExiste(token, nome, dest)) continue; const up = await _driveUpload(token, nome, dest, url); arquivos.push(up.name); } catch (_e) { /* segue os demais */ }
  }
  // Sobe também o PDF da própria ficha (dados + documentos embutidos) em Documentos Diversos.
  try {
    const label = { locador: 'Locador', pf: 'Pessoa Física', pj: 'Pessoa Jurídica', 'locacao-fiador': 'Locação c/ Fiador', locacao_fiador: 'Locação c/ Fiador', vendedor: 'Vendedor', proposta: 'Proposta' }[tipo] || 'Ficha';
    const pdfNome = _driveSanitizar(`Ficha ${label} - ${nomePessoa}`) + '.pdf';
    if (!(await _driveArquivoExiste(token, pdfNome, cats.diversos))) {
      const pdfBuf = await gerarPdfFicha(ficha, label);
      const up = await _driveUploadBuffer(token, pdfNome, cats.diversos, pdfBuf, 'application/pdf');
      arquivos.push(up.name);
    }
  } catch (e) { console.error('drivePdfFicha', (e && e.message) || e); }
  return { ok: true, pasta: nomePessoa, enviados: arquivos.length, arquivos, semDocumentos: campos.length === 0 };
}

exports.driveStatus = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = exigirAutenticado(req);
  const tok = await db.collection('google_tokens').doc(auth.uid).get();
  const cfg = await db.collection('drive_config').doc(auth.uid).get();
  return { conectado: tok.exists && !!tok.data().refreshToken && !!tok.data().drive, email: tok.exists ? (tok.data().email || '') : '', estruturaCriada: cfg.exists && !!cfg.data().rootId };
});
// Cria/garante a raiz + as 4 pastas na conta conectada ("Preparar Drive").
exports.drivePrepararEstrutura = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = exigirAutenticado(req);
  const token = await _driveToken(auth.uid);
  const rootId = await _driveRoot(token, auth.uid);
  return { ok: true, rootId, categorias: DRIVE_CATEGORIAS.map(p => p.nome) };
});
// Sincroniza os documentos de UMA ficha pro Drive (pasta da pessoa → categorias por tipo de doc).
exports.driveSincronizarFicha = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 120 }, async (req) => {
  const auth = exigirAutenticado(req);
  const { fichaId, colecao } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId é obrigatório.');
  const col = colecao === 'fichas_locador' ? 'fichas_locador' : 'fichas';
  // POSSE (mesma regra do gerarFichaPdf): esta function copia TODOS os anexos + um
  // PDF com CPF/RG/renda pro Drive de QUEM CHAMA. Sem conferir o dono, qualquer
  // autenticado exfiltrava ficha alheia pra conta Google pessoal dele.
  const snap = await db.collection(col).doc(String(fichaId)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudo && snap.data().corretorUid !== auth.uid) {
    throw new HttpsError('permission-denied', 'Sem acesso a esta ficha.');
  }
  return _driveSyncFicha(auth.uid, fichaId, col);
});

// Gatilho: ficha COM documentos gravada → sincroniza pro Drive do corretor DONO
// (se ele conectou o Google). Falha graciosamente se não conectado. Dedup evita
// reenvio a cada gravação.
async function _driveTriggerFicha(event, col) {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const temDocs = after.documentos && Object.values(after.documentos).some(u => typeof u === 'string' && /^https?:/.test(u));
  if (!temDocs || !after.corretorUid) return;
  // Só segue se os DOCUMENTOS mudaram neste write (o trigger dispara em todo write da
  // ficha — mudança de status, aprovação etc. relia google_tokens à toa em cada um).
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  if (before && _jsonEstavel(before.documentos || {}) === _jsonEstavel(after.documentos || {})) return;
  const tok = await db.collection('google_tokens').doc(after.corretorUid).get();
  if (!tok.exists || !tok.data().refreshToken || !tok.data().drive) return; // corretor não concedeu o Drive
  try { await _driveSyncFicha(after.corretorUid, event.params.fichaId, col); }
  catch (e) { console.error('driveTriggerFicha', (e && e.message) || e); }
}
// 256MiB: a maioria das execuções é early-return (sem docs novos / sem token do Drive);
// o upload em si é streaming de arquivos de ficha (≤20MB) — 256MiB dá conta.
exports.onFichaDriveSync = onDocumentWritten({ document: 'fichas/{fichaId}', secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 300, memory: '256MiB' }, (event) => _driveTriggerFicha(event, 'fichas'));
exports.onFichaLocadorDriveSync = onDocumentWritten({ document: 'fichas_locador/{fichaId}', secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 300, memory: '256MiB' }, (event) => _driveTriggerFicha(event, 'fichas_locador'));

// ═══ Google Drive: ROBÔ central (conta dedicada) — pastas por negócio ═════════
// Diferente do sync por-ficha (que usa o Drive de CADA corretor com drive.file),
// o ROBÔ é UMA conta Google dedicada (remaxsmarthub@gmail.com) com escopo `drive`
// COMPLETO, que escreve dentro de uma pasta da imobiliária compartilhada com ele
// como Editor. Token guardado central em `drive_robot/config`. O escopo amplo é só
// pro robô — os corretores seguem com drive.file (login Google deles intacto).
// Como é conta Gmail real (não service account), os arquivos que ela cria contam
// nos 15 GB dela — resolvendo a cota 0 do service account.
const DRIVE_ROBO_ROOT_PADRAO = '1-0dJYva2LtFbebZLSfwxMdFzKqdlY1Yh'; // "02 - Corretores" (trocável em drive_robot/config.rootId)

async function _driveRoboToken() {
  const snap = await db.collection('drive_robot').doc('config').get();
  if (!snap.exists || !snap.data().refreshToken) throw new HttpsError('failed-precondition', 'Robô do Drive não conectado — conecte em Meu Perfil (admin).');
  return getAccessToken(snap.data().refreshToken, snap.data().web);
}
async function _driveRoboRoot() {
  const snap = await db.collection('drive_robot').doc('config').get();
  return (snap.exists && snap.data().rootId) || DRIVE_ROBO_ROOT_PADRAO;
}

// Conecta o robô: troca o code por refresh_token (escopo drive completo) e guarda central.
exports.conectarDriveRobo = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = await exigirAdmin(req);
  const { code, codeVerifier, redirectUri } = req.data || {};
  if (!code || !codeVerifier || !redirectUri) throw new HttpsError('invalid-argument', 'Dados do OAuth incompletos.');
  const tokens = await trocarCodePorTokens(code, codeVerifier, redirectUri);
  if (!tokens.refresh_token) throw new HttpsError('failed-precondition', 'O Google não devolveu refresh_token. Remova o app em myaccount.google.com/permissions e conecte de novo.');
  if (!(tokens.scope || '').includes('/auth/drive')) throw new HttpsError('failed-precondition', 'Faltou autorizar o acesso ao Google Drive.');
  let email = '';
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
    const j = await r.json().catch(() => ({}));
    email = j.email || '';
  } catch (_e) { /* email é só informativo */ }
  await db.collection('drive_robot').doc('config').set({
    refreshToken: tokens.refresh_token,
    web: /^https:\/\//i.test(redirectUri || ''),
    email,
    conectadoPor: auth.uid,
    conectadoEm: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await registrarAudit(auth, 'drive_robo_conectar', 'drive_robot/config', { email });
  return { ok: true, email };
});

exports.driveRoboStatus = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = await exigirAdmin(req);
  const snap = await db.collection('drive_robot').doc('config').get();
  const d = snap.exists ? snap.data() : {};
  return { conectado: !!(d && d.refreshToken), email: (d && d.email) || '', rootId: (d && d.rootId) || DRIVE_ROBO_ROOT_PADRAO };
});

// Teste de gravação: confirma que o robô ENXERGA a pasta compartilhada e consegue
// CRIAR pasta + subir arquivo dentro dela (o grande "será que funciona?"). Durante
// os testes, escrevemos DENTRO da subpasta "NATHAN" (a do Nathan), não na raiz.
const DRIVE_ROBO_SUBPASTA_TESTE = 'NATHAN';
exports.driveRoboTeste = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 120 }, async (req) => {
  await exigirAdmin(req);
  const token = await _driveRoboToken();
  const rootId = await _driveRoboRoot();
  // 1) o robô enxerga a pasta raiz compartilhada?
  let root;
  try { root = await _driveApi(token, `files/${rootId}?fields=id,name`); }
  catch (e) { throw new HttpsError('failed-precondition', 'O robô não acessa a pasta raiz (' + rootId + '): ' + ((e && e.message) || e) + '. Confirme que compartilhou a pasta com o robô como Editor.'); }
  // 2) acha a subpasta "NATHAN" dentro da raiz (não cria — tem que existir)
  const nomeEsc = DRIVE_ROBO_SUBPASTA_TESTE.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${nomeEsc}' and '${rootId}' in parents and trashed=false`;
  const achado = await _driveApi(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name,capabilities(canAddChildren))&pageSize=1`);
  if (!achado.files || !achado.files.length) throw new HttpsError('failed-precondition', 'Não achei a subpasta "' + DRIVE_ROBO_SUBPASTA_TESTE + '" dentro de "' + (root.name || rootId) + '". Confirme o nome/compartilhamento.');
  const nathan = achado.files[0];
  if (nathan.capabilities && nathan.capabilities.canAddChildren === false) throw new HttpsError('failed-precondition', 'O robô vê a pasta "' + nathan.name + '" mas NÃO pode criar dentro dela — compartilhe como Editor (não Leitor).');
  // 3) cria a subpasta de teste + sobe um arquivinho DENTRO da NATHAN
  const sub = await _driveFindOrCreateFolder(token, '___teste-hub', nathan.id);
  const buf = Buffer.from('Teste de gravacao do robo do Hub — pode apagar esta pasta.\n', 'utf8');
  const up = await _driveUploadBuffer(token, 'teste-hub.txt', sub, buf, 'text/plain');
  return { ok: true, raiz: (root.name || rootId) + ' / ' + nathan.name, arquivo: up.name, link: `https://drive.google.com/drive/folders/${sub}` };
});

// Lista as SUBPASTAS diretas da raiz "02 - Corretores" (pro dropdown do mapa).
exports.driveListarSubpastas = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 60 }, async (req) => {
  await exigirAdmin(req);
  const token = await _driveRoboToken();
  const rootId = await _driveRoboRoot();
  const q = `mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`;
  const r = await _driveApi(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name&pageSize=1000`);
  return { pastas: (r.files || []).map(f => ({ id: f.id, name: f.name })) };
});

// Lê o mapa corretor→pasta (drive_robot/mapa: { uid: folderId }).
exports.driveMapaGet = onCall(async (req) => {
  await exigirAdmin(req);
  const snap = await db.collection('drive_robot').doc('mapa').get();
  return { mapa: snap.exists ? (snap.data() || {}) : {} };
});

// Salva o mapa corretor→pasta (substitui o doc inteiro).
exports.driveMapaSalvar = onCall(async (req) => {
  const auth = await exigirAdmin(req);
  const mapa = (req.data && req.data.mapa) || null;
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) throw new HttpsError('invalid-argument', 'Mapa inválido.');
  // sanitiza: só pares uid(string)→folderId com cara de id do Drive (um id colado
  // errado — URL inteira, espaços — só estouraria lá na frente, no sync).
  const limpo = {};
  for (const [uid, fid] of Object.entries(mapa)) {
    if (typeof uid === 'string' && typeof fid === 'string' && /^[A-Za-z0-9_-]{10,80}$/.test(fid.trim())) limpo[uid] = fid.trim();
  }
  // O doc é substituído inteiro — mapa vazio (modal que falhou ao carregar) apagaria
  // todos os vínculos em silêncio.
  if (!Object.keys(limpo).length) throw new HttpsError('invalid-argument', 'Nenhum vínculo válido pra salvar — recarregue o mapa.');
  await db.collection('drive_robot').doc('mapa').set(limpo);
  await registrarAudit(auth, 'drive_mapa_salvar', 'drive_robot/mapa', { n: Object.keys(limpo).length });
  return { ok: true, n: Object.keys(limpo).length };
});

// Sincroniza os documentos de UM negócio pro Drive (via robô): pasta do corretor →
// subpasta do imóvel ("endereço (NG-código)"). Sobe os docs do negócio + os anexos e
// PDFs das fichas vinculadas (vendedor/locador do imóvel + comprador/locatário interessado).
// Manual (botão no negócio) — dedup por existência de nome; não apaga nada (aditivo).
const _LABEL_FICHA = { locador: 'Locador', pf: 'Pessoa Fisica', pj: 'Pessoa Juridica', 'locacao-fiador': 'Locacao c Fiador', locacao_fiador: 'Locacao c Fiador', vendedor: 'Vendedor', proposta: 'Proposta' };
exports.driveSyncNegocio = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB], timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const auth = exigirAutenticado(req);
  const { ref, snap, ehGestor, ehAdm } = await _negocioComPosse(req.data && req.data.negocioId, auth);
  const n = snap.data();
  const ehDono = n.corretorUid === auth.uid;
  if (!ehGestor && !ehAdm && !ehDono) throw new HttpsError('permission-denied', 'Sem acesso a este negócio.');
  // 1) pasta do corretor (pelo mapa)
  const mapaSnap = await db.collection('drive_robot').doc('mapa').get();
  const mapa = mapaSnap.exists ? (mapaSnap.data() || {}) : {};
  const pastaCorretor = mapa[n.corretorUid];
  if (!pastaCorretor) throw new HttpsError('failed-precondition', 'O corretor deste negócio ainda não tem pasta no Drive. Peça ao admin pra mapear em Meu Perfil → Mapear pastas.');
  const token = await _driveRoboToken();
  // 2) subpasta do imóvel: "endereço - Locação|Venda (NG-código)"
  const tipoLabel = n.tipo === 'venda' ? 'Venda' : 'Locação';
  const nomeImovel = _driveSanitizar((n.imovelResumo || 'Imovel') + ' - ' + tipoLabel + ' (' + (n.codigo || (n.imovelId || '').slice(0, 6)) + ')');
  let pastaImovel;
  try { pastaImovel = await _driveFindOrCreateFolder(token, nomeImovel, pastaCorretor); }
  catch (e) { throw new HttpsError('failed-precondition', 'Não consegui criar a pasta do imóvel — confirme que a pasta do corretor está compartilhada com o robô como Editor. (' + ((e && e.message) || e) + ')'); }
  // 3) reúne os arquivos: docs do negócio + fichas vinculadas (anexos + PDF)
  const itens = []; // { nome, url } (baixa da Storage) OU { nomePdf, buf } (PDF gerado)
  for (const doc of (n.documentos || [])) {
    if (doc && typeof doc.url === 'string' && /^https?:/.test(doc.url) && urlStoragePermitida(doc.url))
      itens.push({ nome: _driveSanitizar(((doc.categoria && doc.categoria !== 'outro') ? doc.categoria + ' - ' : '') + (doc.nome || 'documento')), url: doc.url });
  }
  const im = (await db.collection('imoveis').doc(n.imovelId).get()).data() || {};
  const fichaIds = [];
  if (im.fichaId) fichaIds.push(im.fichaId);
  // Interessado do negócio: por negocioId (o índice envelhece com remoções — invariante 2026-07-28).
  const lista = Array.isArray(im.interessados) ? im.interessados : [];
  // SÓ por negocioId — o fallback por índice (n.interessadoIndex) envelhece com remoções
  // e, em negócio cancelado (negocioId zerado no interessado), pegaria a PESSOA ERRADA,
  // subindo docs (CPF/RG) de outro cliente pra esta pasta. Invariante _interessadoConfere.
  const inter = lista.find(i => i && i.negocioId === ref.id) || null;
  if (inter && inter.fichaId && !fichaIds.includes(inter.fichaId)) fichaIds.push(inter.fichaId);
  for (const fid of fichaIds) {
    let fSnap = await db.collection('fichas').doc(fid).get(); let col = 'fichas';
    if (!fSnap.exists) { fSnap = await db.collection('fichas_locador').doc(fid).get(); col = 'fichas_locador'; }
    if (!fSnap.exists) continue;
    const f = fSnap.data();
    const nomeP = _driveSanitizar((f.dados && (f.dados.nome || f.dados.razaoSocial || f.dados.nomeCompleto)) || 'Ficha');
    for (const [campo, url] of Object.entries(f.documentos || {})) {
      if (typeof url === 'string' && /^https?:/.test(url) && urlStoragePermitida(url))
        itens.push({ nome: _driveSanitizar('Ficha ' + nomeP + ' - ' + campo), url });
    }
    try {
      const tipoF = col === 'fichas_locador' ? 'locador' : (f.tipo || 'ficha');
      const label = _LABEL_FICHA[tipoF] || 'Ficha';
      const pdfBuf = await gerarPdfFicha(f, label);
      itens.push({ nomePdf: _driveSanitizar('Ficha ' + label + ' - ' + nomeP) + '.pdf', buf: pdfBuf });
    } catch (e) { console.error('driveSyncNegocio pdf', (e && e.message) || e); }
  }
  // 4) sobe (dedup por nome já existente na pasta) e registra o ID de cada arquivo
  // DESEJADO — a lista `atuais` vira a base de remoção da PRÓXIMA sync.
  let enviados = 0, jaExistiam = 0, falhas = 0, removidos = 0;
  const atuais = [];              // [{id, nome}] de tudo que DEVE estar na pasta agora
  const desejados = new Set();    // nomes desejados (p/ decidir o que remover)
  const anteriores = (n.driveSync && Array.isArray(n.driveSync.arquivos)) ? n.driveSync.arquivos : [];
  const antPorNome = new Map(anteriores.filter(a => a && a.id).map(a => [a.nome, a.id]));
  for (const it of itens) {
    const nomeArq = it.buf ? it.nomePdf : it.nome;
    desejados.add(nomeArq);
    try {
      const existe = await _driveAcharArquivo(token, nomeArq, pastaImovel);
      if (existe) { jaExistiam++; atuais.push({ id: existe.id, nome: nomeArq }); continue; }
      const up = it.buf ? await _driveUploadBuffer(token, it.nomePdf, pastaImovel, it.buf, 'application/pdf')
                        : await _driveUpload(token, it.nome, pastaImovel, it.url);
      if (up && up.id) atuais.push({ id: up.id, nome: nomeArq });
      enviados++;
    } catch (e) {
      falhas++; console.error('driveSyncNegocio upload', (e && e.message) || e);
      // Falha transitória num arquivo JÁ registrado antes: preserva o id, senão ele
      // vira órfão não-gerenciável (o robô perderia o id pra removê-lo depois).
      if (antPorNome.has(nomeArq)) atuais.push({ id: antPorNome.get(nomeArq), nome: nomeArq });
    }
  }
  // 5) REMOÇÃO SEGURA: só os arquivos que o robô registrou numa sync ANTERIOR
  // (n.driveSync.arquivos) e que não estão mais no negócio. Nunca toca em arquivo
  // que a pessoa colocou na pasta manualmente (esses nunca entram em driveSync).
  // Vai pra LIXEIRA (trashed) — recuperável, não é exclusão definitiva.
  for (const a of anteriores) {
    if (!a || !a.id || desejados.has(a.nome)) continue;
    try { await _driveApi(token, 'files/' + a.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); removidos++; }
    catch (e) { console.error('driveSyncNegocio remove', (e && e.message) || e); }
  }
  await ref.set({ driveSync: { pastaId: pastaImovel, arquivos: atuais, em: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
  const link = `https://drive.google.com/drive/folders/${pastaImovel}`;
  await registrarAudit(auth, 'negocio_drive_sync', { tipo: 'negocio', id: ref.id }, { enviados, jaExistiam, removidos, falhas });
  return { ok: true, pasta: nomeImovel, enviados, jaExistiam, removidos, falhas, total: itens.length, link };
});

// ─── Agenda / Eventos ────────────────────────────────────────────────────────
// Qualquer usuário pode criar eventos, convidar pessoas ou marcar "para todos".
exports.criarEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
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
exports.editarEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
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
          const accessToken = await getAccessToken(tokSnap.data().refreshToken, tokSnap.data().web);
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
exports.listarEventos = onCall({ minInstances: 1 }, async (req) => {   // login: quente pra evitar cold start
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
exports.listarGoogleAgenda = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
  const auth = exigirAutenticado(req);
  const { de, ate } = req.data || {};
  const tokSnap = await db.collection('google_tokens').doc(auth.uid).get();
  if (!tokSnap.exists || !tokSnap.data().refreshToken) return { itens: [] };

  let accessToken;
  try { accessToken = await getAccessToken(tokSnap.data().refreshToken, tokSnap.data().web); }
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

exports.excluirEvento = onCall({ secrets: [GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET_WEB] }, async (req) => {
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
        const accessToken = await getAccessToken(tokSnap.data().refreshToken, tokSnap.data().web);
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
  await _bumpBroadcast('avisoSeq');
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
  const snapAntes = await ref.get();
  if (!snapAntes.exists) throw new HttpsError('not-found', 'Aviso não encontrado.');
  const antes = snapAntes.data();
  const ehAlvo = antes.todos === true || (Array.isArray(antes.destinatarios) && antes.destinatarios.includes(auth.uid));
  if (!ehAlvo) throw new HttpsError('permission-denied', 'Este aviso não é destinado a você.');

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
  // Impede de tirar a claim do próprio admin inicial. `!isAdmin` (não `=== false`)
  // pra pegar também undefined/null — a escrita usa `!!isAdmin`, então qualquer
  // valor falsy rebaixaria; a guarda tem que cobrir os mesmos casos.
  if (ehBootstrapAdmin(uid) && !isAdmin) {
    throw new HttpsError('failed-precondition', 'O admin inicial não pode ser rebaixado.');
  }
  // MESCLA as claims (não substitui) — senão promover/rebaixar admin apagaria
  // silenciosamente locRole, loc_financeiro e qualquer outra claim da pessoa,
  // que só voltaria rodando locDefinirPerfil de novo. Mesmo padrão do
  // locDefinirPerfil/setUserAccess ({ ...claims, ... }).
  const user = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: !!isAdmin });
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
    // Rollback da conta. Se o delete TAMBÉM falhar, sobra uma conta autenticada que não
    // consumiu código — e o getCredentials confia em qualquer autenticado. Não engolir:
    // loga (dispara o alerta de monitoramento) pra um admin apagar a órfã na mão.
    await admin.auth().deleteUser(user.uid).catch(delErr =>
      logErro('criarContaComCodigo_rollback', delErr, { uid: user.uid, email }).catch(() => {})
    );
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
  `https://firebasestorage.googleapis.com/v0/b/${PROJECT_BUCKET}/o/`;
// (as pastas permitidas viraram parte da RE_ANEXO_FICHA, abaixo)
// ⚠️ Valida a URL INTEIRA, não só o começo. Só conferir o prefixo deixava o resto
// da string livre — e essa URL é interpolada em href="..."/src="..." nas fichas, então
// uma aspa no meio fechava o atributo e injetava handler na revisão do corretor.
// Formato que o servidor gera (único legítimo): <base><pasta>%2F<segmentos>?alt=media&token=<uuid>
// (o path vem de encodeURIComponent, o token de crypto.randomUUID — sem aspas, sem < >).
const RE_ANEXO_FICHA = /^(?:fichas-locador|fichas)(?:%2F[A-Za-z0-9%._-]+)+\?alt=media&token=[A-Za-z0-9_-]{20,60}$/;
const ehUrlDeAnexoDaFicha = (url) =>
  typeof url === 'string' &&
  url.length <= 700 &&
  url.startsWith(FICHA_DOC_BASE) &&
  RE_ANEXO_FICHA.test(url.slice(FICHA_DOC_BASE.length));
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

const FICHA_BUCKET = PROJECT_BUCKET;   // bucket do próprio projeto (prod/staging)

// O cliente sobe o arquivo sem token e manda só o CAMINHO; o token de download
// é gerado AQUI com o Admin SDK. Em 2026-07-03 o Firebase passou a rejeitar
// upload anônimo que seta firebaseStorageDownloadTokens no customMetadata —
// todo anexo de ficha falhou em silêncio desde então (virava "pendência").
//
// `donoChave` (colecao/fichaId) é carimbado no arquivo (customMetadata.remaxFichaDono)
// na primeira vez que ele é resolvido. Sem isso, bastava descobrir o caminho de um
// anexo de OUTRA ficha (ex.: lendo o link já salvo no Firestore) pra anexar o mesmo
// arquivo na própria ficha e gerar um link de download válido pra ele.
async function resolverDocumentosPorCaminho(paths, donoChave) {
  if (paths == null) return {};
  if (typeof paths !== 'object' || Array.isArray(paths)) {
    throw new HttpsError('invalid-argument', 'Documentos inválidos.');
  }
  const chaves = Object.keys(paths);
  if (chaves.length > 60) throw new HttpsError('invalid-argument', 'Documentos demais.');

  const bucket = admin.storage().bucket(FICHA_BUCKET);
  const urls = {};
  for (const k of chaves) {
    const p = paths[k];
    const ok = typeof p === 'string' && p.length < 500 && !p.includes('..')
      && (p.startsWith('fichas/') || p.startsWith('fichas-locador/'));
    if (!ok) throw new HttpsError('invalid-argument', `Anexo "${k}" fora do storage do Hub.`);

    const file = bucket.file(p);
    const [existe] = await file.exists();
    if (!existe) throw new HttpsError('invalid-argument', `Anexo "${k}" não encontrado no storage.`);

    const [meta] = await file.getMetadata();
    const donoAtual = meta.metadata && meta.metadata.remaxFichaDono;
    if (donoAtual && donoAtual !== donoChave) {
      throw new HttpsError('invalid-argument', `Anexo "${k}" já pertence a outra ficha.`);
    }

    const token = crypto.randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token, remaxFichaDono: donoChave } });
    urls[k] = `https://firebasestorage.googleapis.com/v0/b/${FICHA_BUCKET}/o/${encodeURIComponent(p)}?alt=media&token=${token}`;
  }
  return urls;
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
// Limitador de criação de ficha: janela fixa de 1h por corretor, via transação
// num doc dedicado (`_rate_fichas/{uid}`). Fixed-window é simples e uma escrita só;
// no pior caso deixa passar ~2x o teto na virada da janela, o que é irrelevante
// pra barrar despejo (o alvo é milhares, não 61). Não usa o timestamp do doc pra
// nada sensível — só compara Date.now() com o início da janela guardado.
const LIMITE_FICHAS_HORA = 60;
async function _limitarCriacaoFicha(corretorUid) {
  const ref = db.collection('_rate_fichas').doc(corretorUid);
  const JANELA_MS = 3600 * 1000;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const agora = Date.now();
    let d = snap.exists ? snap.data() : null;
    if (!d || (agora - (d.inicio || 0)) >= JANELA_MS) {
      d = { inicio: agora, contagem: 0 };            // janela nova
    }
    if (d.contagem >= LIMITE_FICHAS_HORA) {
      throw new HttpsError('resource-exhausted',
        'Muitas fichas enviadas em pouco tempo. Aguarde alguns minutos e tente de novo.');
    }
    d.contagem += 1;
    tx.set(ref, d);
  });
}

exports.salvarFichaPublica = onCall(async (req) => {
  const {
    colecao, fichaId, tipo, corretorUid, corretorNome, imovelId,
    dados, documentos, documentosPaths, pendentes
  } = req.data || {};

  if (!FICHA_COLECOES.includes(colecao)) {
    throw new HttpsError('invalid-argument', 'Coleção inválida.');
  }
  const dadosOk = validarDadosFicha(dados);
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
    // Caminho novo: `documentosPaths` (a function gera o token de download).
    // `documentos` com URL completa segue aceito por compatibilidade.
    const docsOk = {
      ...validarDocumentosFicha(documentos),
      ...(await resolverDocumentosPorCaminho(documentosPaths, `${colecao}/${fichaId}`))
    };
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
  // Valida o FORMATO do uid antes de usá-lo como doc id (em _limitarCriacaoFicha) —
  // um uid com nº ímpar de segmentos "/" faz o .doc() estourar e vira um 500 opaco
  // em vez de um erro limpo. UID do Firebase é alfanumérico.
  if (typeof corretorUid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(corretorUid)) {
    throw new HttpsError('invalid-argument', 'corretorUid inválido.');
  }
  // Limite anti-abuso: no máximo LIMITE_FICHAS_HORA fichas NOVAS por corretor por
  // hora. A ficha é anônima (sem login), então sem isto um script poderia despejar
  // milhares de fichas falsas na base. Uso real é ~30/mês na equipe toda — o teto
  // aqui é folgado de propósito, só barra despejo automático. Vale só na criação:
  // edição de ficha existente já exige status editável, não é vetor de despejo.
  await _limitarCriacaoFicha(corretorUid);

  // O link carrega o uid do corretor na query. Confirmamos que existe mesmo,
  // pra não acumular ficha órfã apontando pra uid inventado.
  try {
    await admin.auth().getUser(corretorUid);
  } catch (_) {
    throw new HttpsError('invalid-argument', 'Corretor não encontrado.');
  }

  // Valida o tipo ANTES de carimbar os anexos: se isso falhar depois de resolver
  // os documentos, o arquivo já fica marcado como dono de uma ficha que nunca é
  // criada, e um reenvio passa a falhar com "Anexo já pertence a outra ficha".
  if (colecao === 'fichas' && !FICHA_TIPOS.includes(tipo)) {
    throw new HttpsError('invalid-argument', 'Tipo de ficha inválido.');
  }

  // Aloca o ID antes de resolver os anexos: é ele que vira o "dono" carimbado em
  // cada arquivo (ver resolverDocumentosPorCaminho), então precisa existir antes.
  const novoRef = db.collection(colecao).doc();
  const docsOk = {
    ...validarDocumentosFicha(documentos),
    ...(await resolverDocumentosPorCaminho(documentosPaths, `${colecao}/${novoRef.id}`))
  };

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
    novo.tipo = tipo;
  }
  // Formato de id do Firestore, nada além: endpoint anônimo — sem o cap, dava pra
  // inflar o doc com uma string gigante; com "/" no meio, o trigger só gerava ruído.
  if (typeof imovelId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(imovelId)) novo.imovelId = imovelId;

  await novoRef.set(novo);
  return { ok: true, fichaId: novoRef.id };
});

// ─── Fichas do Locador ───────────────────────────────────────────────────────

// Lista as fichas recebidas pelo corretor autenticado.
exports.listarFichasLocador = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const uid = req.auth.uid;
  const isAdmin = req.auth.token.admin;

  // Sem orderBy aqui: where + orderBy em campos diferentes exigiria índice composto.
  // Ordenamos em memória (mais novo primeiro).
  let docs;
  if (isAdmin) {
    docs = (await db.collection('fichas_locador').limit(100).get()).docs;
  } else {
    // Vê as próprias + as que o admin compartilhou com ele (visivelPara).
    const [minhas, compartilhadas] = await Promise.all([
      db.collection('fichas_locador').where('corretorUid', '==', uid).limit(100).get(),
      db.collection('fichas_locador').where('visivelPara', 'array-contains', uid).limit(100).get()
    ]);
    const vistos = new Set();
    docs = [...minhas.docs, ...compartilhadas.docs].filter(d => !vistos.has(d.id) && vistos.add(d.id));
  }
  // id: d.id (Firestore doc ID) vem DEPOIS do spread pra não ser sobrescrito pelo campo interno 'id'
  return docs
    .map(d => ({ ...d.data(), id: d.id, criadoEm: d.data().criadoEm?.toDate?.()?.toISOString() }))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

// Corretor envia a ficha revisada para o administrativo.
exports.enviarFichaParaAdmin = onCall({ secrets: [SUPPORT_EMAIL_PASS], memory: '512MiB' }, async (req) => {
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

  // Notifica admins no Hub. Admin é custom claim (não há campo isAdmin em
  // user_profiles — a query antiga voltava sempre vazia e ninguém era avisado).
  const adminUids = await _uidsDosAdmins();
  if (adminUids.length) {
    const batch = db.batch();
    adminUids.forEach(uid => {
      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        para: uid,
        titulo: 'Ficha do Locador',
        mensagem: `Nova ficha enviada por ${doc.data().corretorNome || 'um corretor'} para análise.`,
        lido: false,
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
  }

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

  // Apaga também os anexos do Storage — senão o arquivo (RG/CPF/renda) fica no bucket
  // com o download token vivo depois da ficha "excluída", acessível por URL.
  await _apagarAnexosDaFicha(fichaSnap.data().documentos).catch(() => {});
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
  const link = `${HOSTING_BASE}/ficha-locador.html?modo=edicao&idFicha=${fichaId}&corretor=${dados.corretorUid}&nome=${encodeURIComponent(dados.corretorNome || '')}`;
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

  const base = db.collection('fichas').where('tipo', '==', tipo);
  let docs;
  if (isAdm) {
    docs = (await base.limit(100).get()).docs;
  } else {
    // Vê as próprias + as que o admin compartilhou com ele (visivelPara).
    const [minhas, compartilhadas] = await Promise.all([
      base.where('corretorUid', '==', uid).limit(100).get(),
      base.where('visivelPara', 'array-contains', uid).limit(100).get()
    ]);
    const vistos = new Set();
    docs = [...minhas.docs, ...compartilhadas.docs].filter(d => !vistos.has(d.id) && vistos.add(d.id));
  }
  return docs
    .map(d => ({ ...d.data(), id: d.id, criadoEm: d.data().criadoEm?.toDate?.()?.toISOString() }))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

// Lista as fichas do Cadastro que podem virar INTERESSADO de um imóvel (locatário/
// comprador): pf, pj, locação c/ fiador, proposta, fiança. NÃO inclui locador/vendedor
// (esses são o DONO do imóvel). Corretor vê as suas + as compartilhadas; admin vê todas.
// Alimenta o seletor "Adicionar interessado" da Tela 03.
exports.listarFichasInteressaveis = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const uid = auth.uid;
  // Gestor/administrativo VÊEM TODAS as fichas (regra de ouro) — o picker de interessado
  // do negócio precisa achar a ficha de QUALQUER corretor. Antes checava só `admin`, então
  // um gestor não-admin só via as próprias e as fichas dos outros "sumiam" no seletor.
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const TIPOS = ['pf', 'pj', 'locacao_fiador', 'proposta', 'fianca'];
  const col = db.collection('fichas');
  let docs;
  if (veTudo) {
    const snaps = await Promise.all(TIPOS.map(t => col.where('tipo', '==', t).limit(60).get()));
    docs = snaps.flatMap(s => s.docs);
  } else {
    const [minhas, comp] = await Promise.all([
      Promise.all(TIPOS.map(t => col.where('tipo', '==', t).where('corretorUid', '==', uid).limit(60).get())),
      Promise.all(TIPOS.map(t => col.where('tipo', '==', t).where('visivelPara', 'array-contains', uid).limit(60).get()))
    ]);
    const vistos = new Set(); docs = [];
    for (const s of [...minhas, ...comp]) for (const d of s.docs) if (!vistos.has(d.id)) { vistos.add(d.id); docs.push(d); }
  }
  return docs.map(d => {
    const f = d.data(); const dd = f.dados || {};
    return {
      id: d.id, tipo: f.tipo, status: f.status || '',
      nome: _txt(dd.nome, 120),
      email: _txt(dd.email, 160),
      cpf: _txt(dd.cpf || dd.cnpj, 40),
      telefone: _txt(dd.whatsapp || dd.celular || dd.fixo, 40),
      criadoEm: f.criadoEm?.toDate?.()?.toISOString() || ''
    };
  }).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

// Lista fichas de PROPRIETÁRIO (vendedor em `fichas`, locador em `fichas_locador`)
// pro picker "vincular ficha existente" ao imóvel. Role-scoped (gestor/adm vê tudo;
// corretor vê as suas). Filtra pela finalidade do imóvel.
exports.listarFichasProprietario = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const fin = (req.data && req.data.finalidade) || 'locacao';
  // Admin do Hub NÃO herda visão total (mesma política do documentosClientes, v1.0.117);
  // só o bootstrap admin conta como gestor (dentro do ehGestorAuth).
  const veTudo = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  const querVend = fin === 'venda' || fin === 'venda_locacao';
  const querLoc = fin === 'locacao' || fin === 'venda_locacao';
  const out = [];
  const push = (d, tipoLabel) => { const f = d.data(); const dd = f.dados || {}; out.push({ id: d.id, tipo: tipoLabel, nome: _txt(dd.nome, 120) || '(sem nome)', cpf: _txt(dd.cpf || dd.cnpj, 40), telefone: _txt(dd.whatsapp || dd.fixo || dd.celular, 40), criadoEm: f.criadoEm?.toDate?.()?.toISOString() || '' }); };
  if (querVend) {
    // vendedor: coleção `fichas`, tipo='vendedor'. Sem índice composto: veTudo filtra por tipo;
    // corretor filtra por corretorUid e checa o tipo em memória.
    const snap = veTudo ? await db.collection('fichas').where('tipo', '==', 'vendedor').limit(300).get()
                        : await db.collection('fichas').where('corretorUid', '==', auth.uid).limit(500).get();  // corretor: filtra vendedor em memória — limite alto pra não perder as de venda entre muitas fichas
    for (const d of snap.docs) if (veTudo || d.data().tipo === 'vendedor') push(d, 'vendedor');
  }
  if (querLoc) {
    const snap = veTudo ? await db.collection('fichas_locador').limit(300).get()
                        : await db.collection('fichas_locador').where('corretorUid', '==', auth.uid).limit(300).get();
    for (const d of snap.docs) push(d, 'locador');
  }
  return out.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
});

// Vincula uma ficha de proprietário JÁ EXISTENTE a um imóvel (preenche o card, como
// o trigger faz no envio). Posse pelo imóvel; recusa se já houver outra ficha vinculada.
exports.carteiraVincularProprietario = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref } = await _carteiraImovelComPosse(d.imovelId, auth);
  const tipo = d.tipo === 'vendedor' ? 'vendedor' : 'locador';
  const col = tipo === 'vendedor' ? 'fichas' : 'fichas_locador';
  const fichaId = String(d.fichaId || '');
  const fSnap = await db.collection(col).doc(fichaId).get();
  if (!fSnap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  const f = fSnap.data();
  // Posse da FICHA (não só do imóvel): sem isso um corretor vincularia a ficha de
  // OUTRO corretor (PII + docs com token) num imóvel próprio e leria tudo.
  const veTudoFicha = ehGestorAuth(auth) || (auth.token && auth.token.locRole === 'administrativo');
  if (!veTudoFicha && f.corretorUid && f.corretorUid !== auth.uid) throw new HttpsError('permission-denied', 'Essa ficha pertence a outro corretor.');
  // 1 ficha ↔ 1 imóvel. Exceção: se a ficha só está presa no PRÓPRIO imóvel-fantasma dela
  // (o card que a trigger auto-gerava, id == fichaId, hoje descontinuado) e esse fantasma está
  // PRISTINO (disponível, sem interessados), a gente MOVE a ficha pro imóvel do iList e apaga o
  // fantasma. Num imóvel REAL (id != fichaId) ou num fantasma em uso, mantém a trava — mover à
  // força repontaria pessoas/{fichaId}_loc* e corromperia o vínculo original.
  const jaUsada = await db.collection('imoveis').where('fichaId', '==', fichaId).limit(1).get();
  let fantasmaParaApagar = null;
  if (!jaUsada.empty && jaUsada.docs[0].id !== String(d.imovelId)) {
    const holder = jaUsada.docs[0];
    const im0 = holder.data() || {};
    const ehFantasma = holder.id === fichaId;   // card auto-gerado pela própria ficha
    const temInteressados = Array.isArray(im0.interessados) && im0.interessados.length > 0;
    const emUso = (im0.situacao && im0.situacao !== 'disponivel') || temInteressados;
    if (!ehFantasma || emUso) throw new HttpsError('failed-precondition', 'Essa ficha já está vinculada a outro imóvel.');
    fantasmaParaApagar = holder.id;
  }
  const dados = f.dados || {};
  const porNome = await _nomeDoUid(auth.uid);
  const ts = () => admin.firestore.FieldValue.serverTimestamp();
  const pa = tipo === 'locador' ? loc_montarPessoa(dados, LOC_KEYS_1) : null;
  // Locador: as pessoas (loc1/loc2) apontariam pro corretor/imóvel novo — por isso
  // só grava DEPOIS da transação do imóvel dar certo, preservando o dono da ficha.
  const locadorIds = [];
  if (tipo === 'locador') {
    if (pa.nome) locadorIds.push(`${fichaId}_loc1`);
    if (dados.loc2_nome) locadorIds.push(`${fichaId}_loc2`);
  }
  const nome = tipo === 'locador' ? (pa.nome || '') : (dados.nome || '');
  const contato = tipo === 'locador' ? [pa.whatsapp || pa.fixo, pa.email].filter(Boolean).join(' · ') : [dados.whatsapp || dados.fixo, dados.email].filter(Boolean).join(' · ');
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
    const im = s.data();
    if (im.fichaId && im.fichaId !== fichaId) throw new HttpsError('failed-precondition', 'Este imóvel já tem uma ficha de proprietário vinculada.');
    const up = {
      fichaId, fichaTipo: tipo, proprietarioNome: nome,
      proprietarioContato: contato,
      documentos: { ...(im.documentos || {}), ...(f.documentos || {}) },
      timeline: admin.firestore.FieldValue.arrayUnion({ texto: `Proprietário vinculado (ficha ${tipo} existente)`, porNome, em: admin.firestore.Timestamp.now() }),
      atualizadoEm: ts()
    };
    if (tipo === 'locador') { up.locadorIds = locadorIds; up.locadorNome = nome; }
    tx.set(ref, up, { merge: true });
  });
  // Pessoas só depois do imóvel confirmar (sem write parcial se a transação recusar);
  // corretorUid = dono ORIGINAL da ficha (regra de ouro), não quem clicou.
  if (tipo === 'locador') {
    const donoUid = f.corretorUid || auth.uid;
    if (pa.nome) await db.collection('pessoas').doc(`${fichaId}_loc1`).set({ ...pa, corretorUid: donoUid, fichaId, imovelId: d.imovelId, atualizadoEm: ts() }, { merge: true });
    if (dados.loc2_nome) await db.collection('pessoas').doc(`${fichaId}_loc2`).set({ ...loc_montarPessoa(dados, LOC_KEYS_2), corretorUid: donoUid, fichaId, imovelId: d.imovelId, atualizadoEm: ts() }, { merge: true });
  }
  // Move concluída: apaga o imóvel-fantasma (o card auto-gerado). NÃO apagar pessoas por
  // fichaId — os docs {fichaId}_loc* são os MESMOS que acabamos de repontar pro imóvel novo.
  if (fantasmaParaApagar && fantasmaParaApagar !== String(d.imovelId)) {
    await db.collection('imoveis').doc(fantasmaParaApagar).delete().catch(() => {});
  }
  await registrarAudit(auth, 'imovel_vincular_proprietario', { tipo: 'imovel', id: d.imovelId }, { fichaId, tipoFicha: tipo, movidoDeFantasma: fantasmaParaApagar || null });
  await _bumpBroadcast('imovelSeq');
  return { ok: true, nome };
});

// Exclui um NEGÓCIO (SÓ gestor). Libera o imóvel: interessado volta a 'aprovado',
// imóvel volta a 'disponivel' (como o cancelar). Hard delete + audit.
exports.negocioExcluir = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth)) throw new HttpsError('permission-denied', 'Só o gestor pode excluir negócios.');
  const negocioId = String((req.data && req.data.negocioId) || '');
  const ref = db.collection('negocios').doc(negocioId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Negócio não encontrado.');
  const n = snap.data();
  if (n.imovelId) {
    const imRef = db.collection('imoveis').doc(n.imovelId);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(imRef);
      if (!s.exists) return;
      const im = s.data();
      const lista = Array.isArray(im.interessados) ? [...im.interessados] : [];
      let mudou = false;
      for (let i = 0; i < lista.length; i++) { if (lista[i] && lista[i].negocioId === negocioId) { lista[i] = { ...lista[i], status: 'aprovado', negocioId: null }; mudou = true; } }
      const up = { atualizadoEm: admin.firestore.FieldValue.serverTimestamp() };
      if (mudou) up.interessados = lista;
      // Excluir o negócio devolve o imóvel a Disponível — inclusive quando estava
      // 'concluido' (Vendido/Alugado), limpando a tag final; senão o imóvel ficava
      // "Vendido" sem negócio nenhum e sem caminho na UI pra limpar.
      if (im.situacao && im.situacao !== 'disponivel') { up.situacao = 'disponivel'; up.tagFinal = admin.firestore.FieldValue.delete(); up.concluidoEm = admin.firestore.FieldValue.delete(); }
      tx.set(imRef, up, { merge: true });
    });
  }
  await ref.delete();
  // Anexos do negócio (PII, URL com token) não podem ficar órfãos no Storage.
  try { await admin.storage().bucket(FICHA_BUCKET).deleteFiles({ prefix: `negocios/${negocioId}/` }); } catch (_) { /* sem anexos ou já sumiu */ }
  await registrarAudit(auth, 'negocio_excluir', { tipo: 'negocio', id: negocioId }, { codigo: n.codigo });
  await _bumpBroadcast('imovelSeq');
  return { ok: true };
});

// Exclui um IMÓVEL (SÓ gestor). Bloqueia se houver negócio ATIVO (cancele/exclua antes).
// Apaga as pessoas (locadores) derivadas. Hard delete + audit.
exports.carteiraExcluirImovel = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth)) throw new HttpsError('permission-denied', 'Só o gestor pode excluir imóveis.');
  const imovelId = String((req.data && req.data.imovelId) || '');
  const ref = db.collection('imoveis').doc(imovelId);
  // Checagem de negócio ativo + delete na MESMA transação: um negocioGerar concorrente
  // entre o check e o delete deixaria negócio ativo apontando pra imóvel inexistente.
  let im = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Imóvel não encontrado.');
    const negs = await tx.get(db.collection('negocios').where('imovelId', '==', imovelId));
    const ativo = negs.docs.find(d => NEGOCIO_ATIVO(d.data().status));
    if (ativo) throw new HttpsError('failed-precondition', `Este imóvel tem um negócio ativo (${ativo.data().codigo}). Exclua ou cancele o negócio antes.`);
    im = snap.data();
    tx.delete(ref);
  });
  for (const pid of (Array.isArray(im.locadorIds) ? im.locadorIds : [])) await db.collection('pessoas').doc(pid).delete().catch(() => {});
  // Anexos avulsos do imóvel (documentosExtra) não podem ficar órfãos no Storage.
  try { await admin.storage().bucket(FICHA_BUCKET).deleteFiles({ prefix: `imoveis/${imovelId}/` }); } catch (_) { /* sem anexos ou já sumiu */ }
  await registrarAudit(auth, 'imovel_excluir', { tipo: 'imovel', id: imovelId }, { protocolo: im.numeroProtocolo != null ? im.numeroProtocolo : null });
  await _bumpBroadcast('imovelSeq');
  return { ok: true };
});

// ── Kanban customizável (Modelo 2 — Trello) ─────────────────────────────────
// As colunas do quadro deixam de ser os status fixos e viram config editável
// (smarthub_config/kanban.colunas = [{id,label}]). Cada negócio ganha `colunaId`
// (posição no quadro), SEPARADO do `status` semântico (que segue mandando em
// permissões/relatórios/Entregar/Concluir). Negócio sem colunaId é derivado do
// status no cliente (migração suave, sem mexer nos docs existentes).
const KANBAN_COLUNAS_PADRAO = [
  { id: 'novo', label: 'Novo' },
  { id: 'andamento', label: 'Em andamento' },
  { id: 'aguard_corretor', label: 'Aguard. corretor' },
  { id: 'aguard_broker', label: 'Aguard. broker' },
  { id: 'aguard_adm', label: 'Aguard. adm' },
];
function _kanbanSanitizaColunas(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(); const cols = [];
  for (const c of raw) {
    const id = _txt(c && c.id, 40).replace(/[^a-z0-9_]/gi, '').toLowerCase();
    const label = _txt(c && c.label, 40);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id); cols.push({ id, label });
    if (cols.length >= 20) break;
  }
  return cols;
}
exports.kanbanColunasGet = onCall(async (req) => {
  exigirAutenticado(req);
  const snap = await db.collection('smarthub_config').doc('kanban').get();
  const cols = snap.exists ? _kanbanSanitizaColunas(snap.data().colunas) : [];
  return { colunas: cols.length ? cols : KANBAN_COLUNAS_PADRAO, padrao: !cols.length };
});
exports.kanbanColunasSalvar = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  if (!ehGestorAuth(auth)) throw new HttpsError('permission-denied', 'Só o gestor gerencia as colunas do quadro.');
  const cols = _kanbanSanitizaColunas(req.data && req.data.colunas);
  if (!cols.length) throw new HttpsError('invalid-argument', 'Envie ao menos uma coluna válida (id + nome).');
  await db.collection('smarthub_config').doc('kanban').set({ colunas: cols, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await registrarAudit(auth, 'kanban_colunas_salvar', 'smarthub_config/kanban', { n: cols.length });
  await _bumpBroadcast('imovelSeq'); // tempo real: quadros recarregam a config
  return { ok: true, colunas: cols };
});
// Move um negócio pra uma coluna do quadro (SÓ gestor, como o arrastar de hoje).
exports.negocioMoverColuna = onCall(async (req) => {
  const auth = exigirAutenticado(req);
  const d = req.data || {};
  const { ref, ehGestor } = await _negocioComPosse(d.negocioId, auth);
  if (!ehGestor) throw new HttpsError('permission-denied', 'Só o gestor move os cards.');
  const colunaId = _txt(d.colunaId, 40).replace(/[^a-z0-9_]/gi, '').toLowerCase();
  if (!colunaId) throw new HttpsError('invalid-argument', 'Coluna inválida.');
  // Só aceita coluna que EXISTE na config (senão o card "voltaria pro Novo" em silêncio no cliente).
  const cfgSnap = await db.collection('smarthub_config').doc('kanban').get();
  const cfgCols = cfgSnap.exists ? _kanbanSanitizaColunas(cfgSnap.data().colunas) : [];
  const validas = (cfgCols.length ? cfgCols : KANBAN_COLUNAS_PADRAO).map(c => c.id);
  if (!validas.includes(colunaId)) throw new HttpsError('invalid-argument', 'Essa coluna não existe mais — recarregue o quadro.');
  await ref.set({ colunaId, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, colunaId };
});

exports.enviarFichaTipoAdmin = onCall({ secrets: [SUPPORT_EMAIL_PASS], memory: '512MiB' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  const { fichaId } = req.data || {};
  if (!fichaId) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  const ref = db.collection('fichas').doc(fichaId);
  const snap = await ref.get();
  await assertDono(snap, req.auth.uid, req.auth.token.admin);
  await ref.update({ status: 'enviado_admin', enviadoAdminEm: admin.firestore.FieldValue.serverTimestamp() });

  // Avisa o administrativo por email
  const nomesFicha = { pf:'Ficha (Pessoa Física)', pj:'Ficha (Pessoa Jurídica)', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta', fianca:'Ficha Fiança' };
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
  // Apaga os anexos do Storage junto (senão sobram no bucket com token vivo).
  await _apagarAnexosDaFicha(snap.data().documentos).catch(() => {});
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
  const link = `${HOSTING_BASE}/${arquivo}?modo=edicao&idFicha=${fichaId}&corretor=${d.corretorUid}&nome=${encodeURIComponent(d.corretorNome||'')}`;
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

// ─── Compartilhamento de ficha (admin escolhe quem mais pode ver) ──────────────
// Grava `visivelPara: [uid...]` no doc. Quem está na lista passa a ver a ficha na
// própria aba Cadastro (listarFichas* faz o OR com corretorUid) e entra nos avisos
// por e-mail junto com o corretor dono. Só admin define; o dono sempre vê.
exports.fichaDefinirVisibilidade = onCall({ secrets: [SUPPORT_EMAIL_PASS] }, async (req) => {
  const auth = await exigirAdmin(req);
  const { colecao, fichaId, uids } = req.data || {};
  if (!['fichas', 'fichas_locador'].includes(colecao)) throw new HttpsError('invalid-argument', 'Coleção inválida.');
  if (!fichaId || typeof fichaId !== 'string' || fichaId.length > 128) throw new HttpsError('invalid-argument', 'fichaId obrigatório.');
  if (!Array.isArray(uids) || uids.length > 30 || uids.some(u => typeof u !== 'string' || !u || u.length > 128)) {
    throw new HttpsError('invalid-argument', 'Lista de usuários inválida (máx. 30).');
  }

  const ref = db.collection(colecao).doc(fichaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');
  const ficha = snap.data();

  // Dono sempre vê — não precisa (nem deve) entrar na lista.
  const unicos = [...new Set(uids)].filter(u => u !== ficha.corretorUid);
  const users = [];
  for (const u of unicos) {
    try { users.push(await admin.auth().getUser(u)); }
    catch (_) { throw new HttpsError('invalid-argument', 'Usuário não encontrado.'); }
  }

  const antes = Array.isArray(ficha.visivelPara) ? ficha.visivelPara : [];
  await ref.update({ visivelPara: unicos });
  await registrarAudit(auth, 'definiu_visibilidade_ficha', { tipo: 'ficha', id: fichaId }, { colecao, quantidade: unicos.length });

  // Avisa por e-mail (de login) só quem GANHOU acesso agora.
  const novos = users.filter(u => !antes.includes(u.uid) && u.email);
  if (novos.length) {
    const tipoNome = ficha.tipo ? (NOMES_FICHA[ficha.tipo] || 'Ficha') : 'Ficha do Locador';
    const nomeCliente = ficha.dados?.nome || 'Cliente';
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
    });
    try {
      await transporter.sendMail({
        from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
        to: SUPORTE_EMAIL,
        bcc: novos.map(u => u.email),
        subject: `[Hub] Você recebeu acesso a uma ficha — ${nomeCliente}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
            + `<p>Olá!</p>`
            + `<p>O administrador liberou pra você o acesso a uma ficha no Hub:</p>`
            + `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">`
            + `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>Tipo</strong></td><td>${escaparHtml(tipoNome)}</td></tr>`
            + `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>Cliente</strong></td><td>${escaparHtml(nomeCliente)}</td></tr>`
            + `<tr><td style="padding:3px 10px 3px 0;color:#666"><strong>Corretor</strong></td><td>${escaparHtml(ficha.corretorNome || '—')}</td></tr>`
            + `</table>`
            + `<p>Ela já aparece na sua aba <strong>Cadastro</strong> do Hub.</p>`
            + `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">`
            + `<p style="font-size:12px;color:#999">E-mail automático do Hub REMAX Smart.</p>`
            + `</div>`,
        text: `Você recebeu acesso à ficha (${tipoNome}) de ${nomeCliente}. Ela aparece na sua aba Cadastro do Hub.`
      });
    } catch (e) { await logErro('fichaDefinirVisibilidade.email', e, { fichaId }); }
  }
  return { ok: true, visivelPara: unicos };
});

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

  // Quem tem a ficha compartilhada (visivelPara) recebe o mesmo aviso, em BCC,
  // no e-mail de login de cada um.
  const extras = [];
  for (const u of (Array.isArray(after.visivelPara) ? after.visivelPara : []).slice(0, 30)) {
    if (u === corretorUid) continue;
    try {
      const e2 = (await admin.auth().getUser(u)).email;
      if (e2 && e2 !== email && !extras.includes(e2)) extras.push(e2);
    } catch (_) { /* usuário removido — ignora */ }
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
  });
  try {
    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: email,
      bcc: extras.length ? extras : undefined,
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
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId !== 'remax-smart-hub') {
    console.log(`Backup ignorado: projeto ${projectId} não é o de produção.`);
    return;
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

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

// ─── Sync diário do FEED de imóveis (portal RE/MAX → Carteira) ────────────────
// O feed público (padrão VRSync/OLX) atualiza todo dia; este job espelha na
// coleção `imoveis` (origem:'feed'), 1 imóvel por anúncio, no corretor certo
// (resolvido por e-mail). UPSERT por feedListingId: cria os novos, atualiza
// preço/foto dos existentes, marca feedAtivo:false os que saíram do portal (NÃO
// apaga). Só toca em campos do PORTAL — nunca em interessados/negócios/
// proprietário/status/situacao (esses são do Hub, o corretor mexe por cima).
// O feed é público e NÃO traz o dono → proprietário fica em branco (vem da ficha).
const FEED_IMOVEIS_URL = 'https://feeds.goiconnect.com/RemaxBrazil_FormatoPadraoGrupoOlx/33E833C7-A06A-483C-BF4B-5923F3261294/Remax_60147.xml';
// Corretor cujo e-mail no feed (@remax) difere do e-mail da conta no Hub.
const FEED_ALIAS_EMAIL = { 'mauricioallegrini@remax.com.br': 'mauricioallegrini@gmail.com' };
const FEED_GESTOR_UID = 'OwcT6wCrXMgJ0tPADMUdKdBB8h32'; // fallback: sem corretor mapeado
const FEED_TIPOS = {
  'Residential / Apartment': 'Apartamento', 'Residential / Home': 'Casa',
  'Residential / Studio': 'Studio', 'Residential / Condo': 'Casa de Condomínio',
  'Residential / Sobrado': 'Sobrado', 'Residential / Penthouse': 'Cobertura',
  'Residential / Land Lot': 'Terreno', 'Commercial / Office': 'Sala Comercial',
  'Commercial / Industrial': 'Galpão / Industrial', 'Commercial / Edificio Comercial': 'Edifício Comercial',
  'Commercial / Building': 'Prédio Comercial', 'Commercial / Business': 'Ponto Comercial',
};
function _feedArr(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
function _feedTxt(x) { if (x == null) return ''; if (typeof x === 'object') return String(x['#text'] != null ? x['#text'] : '').trim(); return String(x).trim(); }
function _feedNum(x) { const n = parseInt(_feedTxt(x).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; }
function _feedBrl(n) { return n == null ? '' : 'R$ ' + n.toLocaleString('pt-BR'); }
function _feedTipo(pt) { if (FEED_TIPOS[pt]) return FEED_TIPOS[pt]; const p = String(pt || '').split('/').pop().trim(); return p || 'Imóvel'; }
function _feedMapear(L, corretor) {
  const finalidade = _feedTxt(L.TransactionType) === 'For Sale' ? 'venda' : 'locacao';
  const det = L.Details || {}, loc = L.Location || {};
  const valorN = finalidade === 'venda' ? _feedNum(det.ListPrice) : _feedNum(det.RentalPrice);
  const fotos = _feedArr(L.Media && L.Media.Item).filter((m) => m['@_medium'] === 'image').map((m) => _feedTxt(m));
  const video = _feedArr(L.Media && L.Media.Item).filter((m) => m['@_medium'] === 'video').map((m) => _feedTxt(m))[0] || '';
  return {
    feedListingId: _feedTxt(L.ListingID), origem: 'feed', finalidade,
    tipo: _feedTipo(_feedTxt(det.PropertyType)), valorAnuncio: _feedBrl(valorN),
    proprietarioNome: '', proprietarioContato: '',
    corretorUid: corretor.uid, corretorNome: corretor.nome,
    endereco: { cep: _feedTxt(loc.PostalCode), logradouro: _feedTxt(loc.Address), numero: _feedTxt(loc.StreetNumber), complemento: _feedTxt(loc.Complement), bairro: _feedTxt(loc.Neighborhood), cidade: _feedTxt(loc.City), estado: (loc.State && loc.State['@_abbreviation']) || '' },
    dormitorios: _feedNum(det.Bedrooms), vagas: _feedNum(det.Garage), area: _feedNum(det.LivingArea),
    iptu: _feedTxt(det.Iptu) ? _feedBrl(_feedNum(det.Iptu)) : '',
    feedDados: {
      titulo: _feedTxt(L.Title), descricao: _feedTxt(det.Description), suites: _feedNum(det.Suites),
      banheiros: _feedNum(det.Bathrooms), condominio: _feedNum(det.PropertyAdministrationFee), ano: _feedNum(det.YearBuilt),
      andar: _feedNum(det.UnitFloor), unidade: _feedTxt(det.UnitNumber), areaTotal: _feedNum(det.LotArea),
      lat: _feedTxt(loc.Latitude), lng: _feedTxt(loc.Longitude), fotos, video,
      tour: _feedTxt(L.VirtualTourLink), detalheUrl: _feedTxt(L.DetailViewUrl),
      features: _feedArr(det.Features && det.Features.Feature).map(_feedTxt),
    },
  };
}
exports.sincronizarFeedImoveis = onSchedule({ schedule: '0 5 * * *', timeZone: TZ, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId !== 'remax-smart-hub') { console.log(`Sync feed ignorado: ${projectId} não é produção.`); return; }
  try {
    const resp = await fetch(FEED_IMOVEIS_URL);
    if (!resp.ok) throw new Error('Feed HTTP ' + resp.status);
    const xml = await resp.text();
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false });
    const doc = parser.parse(xml);
    const listings = _feedArr(doc.ListingDataFeed && doc.ListingDataFeed.Listings && doc.ListingDataFeed.Listings.Listing);
    if (!listings.length) throw new Error('Feed vazio / não parseou');

    const cacheC = {};
    const resolver = async (email) => {
      const alvo = FEED_ALIAS_EMAIL[email] || email;
      if (cacheC[alvo] !== undefined) return cacheC[alvo];
      try { const u = await admin.auth().getUserByEmail(alvo); cacheC[alvo] = { uid: u.uid, nome: u.displayName || alvo }; }
      catch (_e) { cacheC[alvo] = { uid: FEED_GESTOR_UID, nome: '' }; }
      return cacheC[alvo];
    };

    let criados = 0, atualizados = 0, falhas = 0;
    const vistos = new Set();
    for (const L of listings) {
      // Marca como VISTO antes de processar: se der erro no meio, o anúncio (que ESTÁ
      // no feed) não é confundido com "sumido" e arquivado por engano na varredura.
      const fid0 = _feedTxt(L.ListingID);
      if (fid0) vistos.add(fid0);
      try {
        const email = _feedTxt((L.ContactInfo || {}).Email).toLowerCase();
        const corretor = await resolver(email);
        const m = _feedMapear(L, corretor);
        if (!m.feedListingId) continue;
        const snap = await db.collection('imoveis').where('feedListingId', '==', m.feedListingId).limit(1).get();
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (snap.empty) {
          await db.collection('imoveis').add({
            ...m, situacao: 'disponivel', arquivado: false, feedAtivo: true,
            ...(m.finalidade !== 'venda' ? { status: 'recebido' } : {}),
            interessados: [], pendentes: [],
            timeline: [{ texto: 'Imóvel importado do portal (feed RE/MAX)', porNome: 'Sync do portal', em: admin.firestore.Timestamp.now() }],
            criadoEm: now, atualizadoEm: now, feedSyncEm: now,
          });
          criados++;
        } else {
          // Se tinha sido arquivado POR TER SAÍDO do portal e agora voltou, desarquiva
          // (mas não mexe em arquivamento MANUAL feito pelo gestor).
          const atual = snap.docs[0].data();
          const voltou = atual.arquivado === true && atual.arquivadoMotivo === 'Saiu do portal';
          await snap.docs[0].ref.set({
            finalidade: m.finalidade, tipo: m.tipo, valorAnuncio: m.valorAnuncio, endereco: m.endereco,
            dormitorios: m.dormitorios, vagas: m.vagas, area: m.area, iptu: m.iptu,
            corretorUid: m.corretorUid, corretorNome: m.corretorNome, feedDados: m.feedDados, feedAtivo: true,
            ...(voltou ? { arquivado: false, arquivadoMotivo: admin.firestore.FieldValue.delete(), voltouAoPortalEm: now } : {}),
            atualizadoEm: now, feedSyncEm: now,
          }, { merge: true });
          atualizados++;
        }
      } catch (errItem) {
        // Um anúncio problemático não pode abortar o sync inteiro do dia.
        falhas++;
        console.warn('Sync feed: falha no anúncio', fid0, (errItem && errItem.message) || errItem);
      }
    }
    // Imóveis do feed que sumiram (vendidos/despublicados): ARQUIVA (não apaga) — vão
    // pro filtro "Arquivado" da Carteira. `feedAtivo !== false` garante arquivar 1x só,
    // e respeita se o gestor já desarquivou na mão depois.
    const doFeed = await db.collection('imoveis').where('origem', '==', 'feed').get();
    let sumidos = 0;
    for (const d of doFeed.docs) {
      const fid = d.get('feedListingId');
      if (fid && !vistos.has(fid) && d.get('feedAtivo') !== false) {
        // Não arquiva imóvel EM NEGOCIAÇÃO (tem negócio ativo) — só marca que saiu do
        // portal, pra não sumir da lista ativa enquanto o negócio está rolando.
        const emNeg = d.get('situacao') === 'em_negociacao';
        await d.ref.set({
          feedAtivo: false, feedSaiuEm: admin.firestore.FieldValue.serverTimestamp(),
          ...(emNeg ? {} : { arquivado: true, arquivadoMotivo: 'Saiu do portal', arquivadoEm: admin.firestore.FieldValue.serverTimestamp() }),
        }, { merge: true });
        sumidos++;
      }
    }
    // Tempo real: se algo mudou na carteira, avisa os Brokers abertos (gestor E corretor)
    // pelo broadcast — que TODO cliente lê (o listener direto da coleção `imoveis` pode
    // ser negado no `list` pro gestor e falhar calado; o broadcast é o caminho garantido).
    if (criados || atualizados || sumidos) await _bumpBroadcast('imovelSeq');
    console.log(`Sync feed OK: ${criados} criados, ${atualizados} atualizados, ${sumidos} fora do portal, ${falhas} falhas.`);
    if (falhas) await logErro('sincronizarFeedImoveis', new Error(`${falhas} anúncio(s) falharam no sync (ver logs de warning)`));
  } catch (e) {
    await logErro('sincronizarFeedImoveis', e);
  }
});

// ─── Relatório diário de SAÚDE ────────────────────────────────────────────────
// Roda às 8h e manda e-mail TODO DIA — inclusive quando está tudo ok.
// Por que sempre: antes só mandava se houvesse erro, então dia bom = silêncio,
// e silêncio era ambíguo ("tudo bem" ou "o monitoramento morreu?"). Mandando
// sempre, a AUSÊNCIA do e-mail das 08h vira sinal de alarme por si só.
// Além dos erros, sonda os serviços de verdade (Hosting/Firestore/Auth/Storage/
// Backup) — principalmente o BACKUP, que se parar de rodar só se descobriria no
// dia de precisar restaurar. Limpa erros com mais de 7 dias (como antes).
exports.relatorioErrosDiario = onSchedule({
  schedule: '0 8 * * *',
  timeZone: TZ,
  secrets: [SUPPORT_EMAIL_PASS]
}, async () => {
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ehStaging = process.env.GCLOUD_PROJECT === 'remax-smart-hub-staging';
  const ehProducao = process.env.GCLOUD_PROJECT === 'remax-smart-hub';
  const hostingUrl = ehStaging ? 'https://remax-smart-hub-staging.web.app' : 'https://remax-smart-hub.web.app';

  // Cada sonda é isolada: uma falha vira linha vermelha, nunca derruba o relatório.
  const sondas = [];
  const sonda = async (nome, fn) => {
    try { sondas.push({ nome, ok: true, detalhe: await fn() }); }
    catch (e) { sondas.push({ nome, ok: false, detalhe: (e && e.message ? e.message : String(e)).slice(0, 200) }); }
  };

  await sonda('Hosting', async () => {
    const r = await fetch(hostingUrl);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return `HTTP ${r.status} · ${hostingUrl.replace('https://', '')}`;
  });
  await sonda('Firestore', async () => {
    const ref = db.collection('_health').doc('probe');
    await ref.set({ em: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (!(await ref.get()).exists) throw new Error('escreveu mas não leu de volta');
    return 'read/write ok';
  });
  await sonda('Auth', async () => {
    const l = await admin.auth().listUsers(1);
    return l.users.length ? 'ok (com usuários)' : 'ok (sem usuários)';
  });
  await sonda('Storage', async () => {
    const [existe] = await admin.storage().bucket().exists();
    if (!existe) throw new Error('bucket padrão não encontrado');
    return 'bucket acessível';
  });
  if (ehStaging) {
    sondas.push({ nome: 'Backup', ok: true, detalhe: 'n/a no staging (bucket é de produção)' });
  } else {
    await sonda('Backup', async () => {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
      const [arqs] = await admin.storage().bucket('remax-smart-hub-backups')
        .getFiles({ prefix: hoje + '/', maxResults: 1 });
      if (!arqs.length) throw new Error(`sem backup de hoje (${hoje}) no bucket`);
      return `${hoje} ok`;
    });
  }

  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);

  // Pulso: quanto a operação andou nas últimas 24h (best-effort — nunca quebra).
  const contar = async (col) => {
    try { return (await db.collection(col).where('criadoEm', '>=', ontem).count().get()).data().count; }
    catch (_) { return null; }
  };
  const pulso = {
    Fichas: await contar('fichas'),
    Imóveis: await contar('imoveis'),
    Negócios: await contar('negocios')
  };

  const snap = await db.collection('_erros')
    .where('timestamp', '>=', ontem)
    .orderBy('timestamp', 'desc')
    .get();
  const linhas = snap.docs.map(d => {
    const e = d.data();
    const ctx = e.contexto && Object.keys(e.contexto).length ? ` (${JSON.stringify(e.contexto)})` : '';
    return `• [${e.funcao}] ${e.mensagem}${ctx}`;
  });

  const tudoOk = sondas.every(s => s.ok);
  const semErros = snap.empty;
  const saudavel = tudoOk && semErros;
  const agoraBR = new Date().toLocaleString('pt-BR', { timeZone: TZ });
  const dataBR = new Date().toLocaleDateString('pt-BR', { timeZone: TZ });

  const linhaTabela = (nome, ok, detalhe) =>
    `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee">${ok ? '✅' : '❌'} ${esc(nome)}</td>`
    + `<td style="padding:7px 10px;border-bottom:1px solid #eee;color:${ok ? '#188038' : '#c5221f'}">${esc(detalhe)}</td></tr>`;

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;color:#202124">
    <h2 style="color:#1a73e8;margin:0 0 4px">📊 Hub REMAX Smart — Relatório Diário</h2>
    <p style="color:#666;font-size:13px;margin:0 0 18px">Gerado em ${esc(agoraBR)}${ehStaging ? ' · <b>STAGING</b>' : ''}</p>
    <h3 style="margin:0 0 8px">${tudoOk ? '✅ Status — tudo funcionando' : '⚠️ Status — atenção'}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${sondas.map(s => linhaTabela(s.nome, s.ok, s.detalhe)).join('')}</table>
    <h3 style="margin:22px 0 8px">🐛 Erros (últimas 24h)</h3>
    ${semErros
      ? '<p style="color:#188038;margin:0">🎉 Nenhum erro registrado nas últimas 24h.</p>'
      : `<pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap">${esc(linhas.join('\n'))}</pre>`}
    <h3 style="margin:22px 0 8px">📈 Movimento (últimas 24h)</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      ${Object.entries(pulso).map(([k, v]) =>
        `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee">${esc(k)}</td>`
        + `<td style="padding:7px 10px;border-bottom:1px solid #eee"><b>${v == null ? '—' : v}</b> novo(s)</td></tr>`).join('')}
    </table>
    <p style="font-size:12px;color:#999;margin-top:22px">Relatório automático · logs apagados após 7 dias ·
    erros de servidor também no Google Cloud Error Reporting.</p></div>`;

  const texto = `Hub REMAX Smart — Relatório Diário (${agoraBR})\n\n`
    + sondas.map(s => `${s.ok ? '[OK]' : '[FALHA]'} ${s.nome}: ${s.detalhe}`).join('\n')
    + `\n\nErros (24h): ${semErros ? 'nenhum' : snap.size}\n${linhas.join('\n')}`
    + `\n\nMovimento (24h): ` + Object.entries(pulso).map(([k, v]) => `${k}=${v == null ? '—' : v}`).join(' · ');

  // Fora de produção o secret de e-mail é dummy (staging-dummy-nao-usar): tentar
  // enviar dá 535 BadCredentials, o logErro grava em _erros, e o relatório do dia
  // seguinte conta esse erro e falha de novo — laço que só produz lixo. A limpeza
  // dos erros antigos (abaixo) continua rodando nos dois, por isso não é um return.
  if (ehProducao) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
      });
      await transporter.sendMail({
        from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
        to: SUPORTE_EMAIL,
        subject: `${saudavel ? '✅' : '⚠️'} Hub — ${snap.size} erro(s) · ${dataBR}`,
        html, text: texto
      });
    } catch (e) {
      await logErro('relatorioErrosDiario', e, { etapa: 'envio' });
    }
  } else {
    console.log('Relatório pronto — e-mail não enviado fora de produção.');
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

  // Nomeia as sondas que falharam: se um dia o e-mail também falhar, o log ainda conta o que quebrou.
  const falhas = sondas.filter(s => !s.ok);
  console.log(`Relatório: ${snap.size} erro(s); sondas ${sondas.length - falhas.length}/${sondas.length} ok`
    + (falhas.length ? ` — FALHOU: ${falhas.map(f => `${f.nome} (${f.detalhe})`).join('; ')}` : '')
    + `; ${antigos?.size || 0} antigo(s) removido(s).`);
});

// ─── Bug Fix Bot: dispara o Claude no GitHub Actions pra propor um fix ─────────
// Regra de ouro: o bot PROPÕE (abre PR), o humano DISPÕE (revisa e publica).
// Nada aqui faz deploy nem publica o .exe — só abre um repository_dispatch no
// GitHub, que roda o Claude num branch e abre um Pull Request pra revisão.
//
// Dois caminhos:
//  1. botCorrigirBug  — disparo MANUAL (admin), pra testar/pedir um fix sob demanda.
//  2. onErroParaBot   — disparo AUTOMÁTICO quando cai um erro em `_erros`.
//     Vem DESLIGADO por padrão (kill switch `_bot_config/bugfix.habilitado`);
//     só liga quando você quiser, e mesmo ligado tem dedupe + rate-limit pra
//     não abrir 50 PRs do mesmo erro nem estourar gasto de token.

// Assinatura estável de um erro (função + mensagem sem números) pra dedupe.
function _botAssinatura(funcao, mensagem) {
  const msg = String(mensagem || '').toLowerCase().replace(/\d+/g, '#').slice(0, 160);
  return crypto.createHash('sha1').update(`${funcao}|${msg}`).digest('hex').slice(0, 16);
}

// Dispara o workflow no GitHub via repository_dispatch. Não lança: loga e segue.
async function _botDispatch(descricao, contexto = {}) {
  const token = BOT_GH_TOKEN.value();
  if (!token) { await logErro('botDispatch', new Error('BOT_GH_TOKEN vazio — configure o secret')); return false; }
  const resp = await fetch(`https://api.github.com/repos/${BOT_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'remax-hub-bugbot'
    },
    body: JSON.stringify({
      event_type: 'bug-encontrado',
      client_payload: { descricao: String(descricao || '').slice(0, 4000), contexto }
    })
  });
  if (!resp.ok) {
    await logErro('botDispatch', new Error(`${resp.status}: ${await resp.text()}`), { descricao: String(descricao).slice(0, 200) });
    return false;
  }
  return true;
}

// Disparo manual (admin): { descricao, erroId? }. Se vier erroId, anexa o erro.
exports.botCorrigirBug = onCall({ secrets: [BOT_GH_TOKEN] }, async (req) => {
  await exigirAdmin(req);
  const descricao = (req.data?.descricao || '').trim();
  const erroId = (req.data?.erroId || '').trim();
  let contexto = { origem: 'manual', por: req.auth?.token?.email || req.auth?.uid || '' };
  if (erroId) {
    const doc = await db.collection('_erros').doc(erroId).get();
    if (doc.exists) contexto = { ...contexto, erro: doc.data() };
  }
  if (!descricao && !erroId) throw new HttpsError('invalid-argument', 'Informe uma descrição do bug ou um erroId.');
  const ok = await _botDispatch(descricao || 'Ver erro anexado no contexto.', contexto);
  if (!ok) throw new HttpsError('internal', 'Falha ao disparar o bot no GitHub. Confira o secret BOT_GH_TOKEN e as permissões do token.');
  await registrarAudit(req.auth, 'disparou_bugbot', { tipo: 'bugbot' }, { descricao: descricao.slice(0, 200), erroId });
  return { ok: true };
});

// Disparo automático ao cair um erro novo em `_erros`. DESLIGADO por padrão.
exports.onErroParaBot = onDocumentCreated({
  document: '_erros/{erroId}',
  secrets: [BOT_GH_TOKEN]
}, async (event) => {
  const erro = event.data?.data();
  if (!erro) return;

  // Kill switch: só roda se _bot_config/bugfix.habilitado === true.
  const cfgSnap = await db.collection('_bot_config').doc('bugfix').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (cfg.habilitado !== true) return;

  // Nunca deixar o bot reagir a erros do próprio bot (evita laço).
  if (['botDispatch', 'botCorrigirBug', 'onErroParaBot'].includes(erro.funcao)) return;

  // Dedupe + rate-limit por assinatura: 1 disparo a cada 24h por tipo de erro.
  const sig = _botAssinatura(erro.funcao, erro.mensagem);
  const ref = db.collection('_bot_bugfix_sigs').doc(sig);
  const jaViu = await ref.get();
  const agora = Date.now();
  if (jaViu.exists) {
    const ultimo = jaViu.data().ultimoDispatch?.toDate?.()?.getTime?.() || 0;
    if (agora - ultimo < 24 * 60 * 60 * 1000) return; // já abriu PR desse erro nas últimas 24h
  }

  const descricao = `Erro recorrente na Cloud Function "${erro.funcao}":\n${erro.mensagem}`;
  const ok = await _botDispatch(descricao, { origem: 'auto', erro });
  if (ok) {
    await ref.set({
      funcao: erro.funcao, assinatura: sig,
      ultimoDispatch: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
});

// ─── Caça-Bugs diário (Fase 2): achados → e-mail → página de aprovação ─────────
// O workflow bug-hunter.yml roda todo dia 00h (Brasília), o Claude varre o código
// e POSTa os achados aqui. Fluxo: valida o segredo → dedupe (7 dias) → grava o
// lote em `_bot_achados` com token → e-mail com resumo simples + link da página
// `bugbot.html?t=<token>`, onde o Nathan toca "Autorizar correção" (isso dispara
// o Bug Fix Bot, que abre o PR — a decisão continua 100% humana).

// Recebe os achados do workflow (POST JSON, header x-bot-secret).
exports.botReceberAchados = onRequest({ secrets: [BOT_HOOK_SECRET, SUPPORT_EMAIL_PASS] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  const segredo = req.get('x-bot-secret') || '';
  const esperado = BOT_HOOK_SECRET.value() || '';
  if (!esperado || segredo.length !== esperado.length ||
      !crypto.timingSafeEqual(Buffer.from(segredo), Buffer.from(esperado))) {
    res.status(401).json({ ok: false }); return;
  }

  const brutos = Array.isArray(req.body) ? req.body : [];
  // Sanitiza: só os campos esperados, com limite de tamanho e no máximo 5 achados.
  const GRAVIDADES = ['alta', 'media', 'baixa'];
  const achados = brutos.slice(0, 5).map(a => ({
    titulo: String(a?.titulo || '').slice(0, 140),
    resumo: String(a?.resumo || '').slice(0, 600),
    arquivo: String(a?.arquivo || '').slice(0, 200),
    gravidade: GRAVIDADES.includes(a?.gravidade) ? a.gravidade : 'media'
  })).filter(a => a.titulo && a.resumo);
  if (!achados.length) { res.json({ ok: true, novos: 0 }); return; }

  // Dedupe: mesmo achado (título+arquivo) não repete e-mail por 7 dias.
  const novos = [];
  for (const a of achados) {
    const sig = _botAssinatura(a.arquivo, a.titulo);
    const ref = db.collection('_bot_achados_sigs').doc(sig);
    const visto = await ref.get();
    const ultimo = visto.exists ? (visto.data().visto?.toDate?.()?.getTime?.() || 0) : 0;
    if (Date.now() - ultimo < 7 * 24 * 60 * 60 * 1000) continue;
    await ref.set({ titulo: a.titulo, arquivo: a.arquivo, visto: admin.firestore.FieldValue.serverTimestamp() });
    novos.push({ ...a, estado: 'pendente' });
  }
  if (!novos.length) { res.json({ ok: true, novos: 0, motivo: 'todos repetidos (7d)' }); return; }

  const token = crypto.randomBytes(24).toString('base64url');
  const lote = await db.collection('_bot_achados').add({
    achados: novos, token, status: 'aberto',
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  const link = `${PORTAL_BASE}/bugbot.html?t=${token}`;
  const emoji = { alta: '🔴', media: '🟡', baixa: '🔵' };
  const linhas = novos.map(a => `${emoji[a.gravidade]} ${a.titulo}\n   ${a.resumo}`);
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SUPORTE_EMAIL, pass: SUPPORT_EMAIL_PASS.value() }
    });
    await transporter.sendMail({
      from: `Hub REMAX Smart <${SUPORTE_EMAIL}>`,
      to: SUPORTE_EMAIL,
      subject: `[Hub] 🤖 Caça-bugs achou ${novos.length} possível(is) bug(s)`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:600px">`
          + `<h3 style="color:#002749">🤖 Caça-bugs diário — ${novos.length} achado(s)</h3>`
          + novos.map(a => `<div style="margin:10px 0;padding:10px 14px;background:#f6f8fa;border-left:4px solid ${a.gravidade === 'alta' ? '#dc2626' : a.gravidade === 'media' ? '#d97706' : '#2563eb'};border-radius:6px">`
              + `<strong>${emoji[a.gravidade]} ${a.titulo}</strong>`
              + `<div style="font-size:13px;color:#444;margin-top:4px">${a.resumo}</div>`
              + `<div style="font-size:12px;color:#888;margin-top:4px">${a.arquivo}</div></div>`).join('')
          + `<p style="margin:18px 0"><a href="${link}" style="background:#0b5fff;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Ver e autorizar correções</a></p>`
          + `<p style="font-size:12px;color:#999">Nada é corrigido sem a sua autorização. Mesmo autorizado, a correção vira um Pull Request pra sua revisão.</p></div>`,
      text: `Caça-bugs diário — ${novos.length} achado(s):\n\n${linhas.join('\n\n')}\n\nVer e autorizar: ${link}`
    });
  } catch (e) { await logErro('botReceberAchados.email', e, { loteId: lote.id }); }

  res.json({ ok: true, novos: novos.length, loteId: lote.id });
});

// Página de aprovação lista os achados do lote (token é a credencial, como nos portais).
exports.botListarAchados = onCall(async (req) => {
  const token = String(req.data?.token || '');
  if (!token || token.length > 64) throw new HttpsError('invalid-argument', 'Token inválido.');
  const snap = await db.collection('_bot_achados').where('token', '==', token).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Link inválido ou expirado.');
  const d = snap.docs[0].data();
  return {
    criadoEm: d.criadoEm?.toDate?.()?.toISOString?.() || null,
    achados: (d.achados || []).map((a, i) => ({ idx: i, ...a }))
  };
});

// "Autorizar correção": marca o achado e dispara o Bug Fix Bot (que abre o PR).
exports.botAprovarAchado = onCall({ secrets: [BOT_GH_TOKEN] }, async (req) => {
  const token = String(req.data?.token || '');
  const idx = Number(req.data?.idx);
  if (!token || token.length > 64 || !Number.isInteger(idx) || idx < 0) {
    throw new HttpsError('invalid-argument', 'Pedido inválido.');
  }
  const snap = await db.collection('_bot_achados').where('token', '==', token).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Link inválido ou expirado.');
  const ref = snap.docs[0].ref;
  const d = snap.docs[0].data();
  const achados = d.achados || [];
  const a = achados[idx];
  if (!a) throw new HttpsError('not-found', 'Achado não encontrado.');
  if (a.estado === 'aprovado') return { ok: true, jaAprovado: true };

  const descricao = `Bug encontrado pelo caça-bugs diário e AUTORIZADO para correção:\n\n`
    + `${a.titulo}\n\n${a.resumo}\n\nArquivo: ${a.arquivo || '(não informado)'}\nGravidade: ${a.gravidade}`;
  const ok = await _botDispatch(descricao, { origem: 'cacabugs', loteId: ref.id, idx });
  if (!ok) throw new HttpsError('internal', 'Falha ao acionar o bot no GitHub. Tente de novo em instantes.');

  achados[idx] = { ...a, estado: 'aprovado', aprovadoEm: new Date().toISOString() };
  await ref.update({ achados });
  await registrarAudit(null, 'aprovou_correcao_bugbot', { tipo: 'bugbot', id: ref.id }, { idx, titulo: a.titulo });
  return { ok: true };
});

// "Ignorar": marca como descartado (só organiza a página; o dedupe de 7d já evita spam).
exports.botIgnorarAchado = onCall(async (req) => {
  const token = String(req.data?.token || '');
  const idx = Number(req.data?.idx);
  if (!token || token.length > 64 || !Number.isInteger(idx) || idx < 0) {
    throw new HttpsError('invalid-argument', 'Pedido inválido.');
  }
  const snap = await db.collection('_bot_achados').where('token', '==', token).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Link inválido ou expirado.');
  const ref = snap.docs[0].ref;
  const achados = snap.docs[0].data().achados || [];
  if (!achados[idx]) throw new HttpsError('not-found', 'Achado não encontrado.');
  if (achados[idx].estado === 'pendente') {
    achados[idx] = { ...achados[idx], estado: 'descartado' };
    await ref.update({ achados });
  }
  return { ok: true };
});

// ─── Painel do Bug Bot no Admin ───────────────────────────────────────────────
// Junta num lugar só o que antes exigia abrir o e-mail, o GitHub ou o Firestore:
// a última varredura (com o token, pra aprovar direto do Hub), os erros recentes
// e o estado do disparo automático. Não faz nada novo — só dá tela pro que existe.

exports.botPainel = onCall(async (req) => {
  await exigirAdmin(req);

  const cfgSnap = await db.collection('_bot_config').doc('bugfix').get();
  const autoHabilitado = cfgSnap.exists && cfgSnap.data().habilitado === true;

  // Última varredura do caça-bugs. O `token` vai junto de propósito: é a mesma
  // credencial do link do e-mail, e quem está aqui já passou pelo exigirAdmin.
  let ultimoLote = null;
  const loteSnap = await db.collection('_bot_achados')
    .orderBy('criadoEm', 'desc').limit(1).get();
  if (!loteSnap.empty) {
    const d = loteSnap.docs[0].data();
    ultimoLote = {
      token: d.token,
      criadoEm: d.criadoEm?.toDate?.()?.toISOString?.() || null,
      achados: (d.achados || []).map((a, i) => ({ idx: i, ...a }))
    };
  }

  // Erros recentes das Cloud Functions (o relatorioErrosDiario limpa > 7 dias).
  const errosSnap = await db.collection('_erros')
    .orderBy('timestamp', 'desc').limit(15).get();
  const erros = errosSnap.docs.map(doc => {
    const e = doc.data();
    return {
      id: doc.id,
      funcao: e.funcao || '',
      mensagem: String(e.mensagem || '').slice(0, 300),
      quando: e.timestamp?.toDate?.()?.toISOString?.() || null
    };
  });

  return { autoHabilitado, ultimoLote, erros };
});

// Liga/desliga o disparo AUTOMÁTICO em cima de erro (o kill switch que o
// onErroParaBot lê). A varredura das 00:17 é do GitHub Actions e não passa por
// aqui — ela roda de qualquer jeito e só manda e-mail; quem decide continua sendo
// você. O que este botão libera é o bot abrir PR sozinho quando um erro estoura.
exports.botSetAuto = onCall(async (req) => {
  await exigirAdmin(req);
  const habilitado = req.data?.habilitado === true;
  await db.collection('_bot_config').doc('bugfix').set({
    habilitado,
    alteradoEm: admin.firestore.FieldValue.serverTimestamp(),
    alteradoPor: req.auth?.token?.email || req.auth?.uid || ''
  }, { merge: true });
  await registrarAudit(req.auth, 'alterou_bugbot_auto', { tipo: 'bugbot' }, { habilitado });
  return { ok: true, habilitado };
});

// ═══════════════════════════════════════════════════════════════════════════════
// LGPD — retenção e exclusão dos dados pessoais das fichas
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ NADA DESTE BLOCO ESTÁ DEPLOYADO. Desativado a pedido do Nathan (2026-07-14):
// o código fica pronto, mas as functions NÃO subiram e a aba do Admin está
// comentada no admin.html. Não deployar sem resolver o que está abaixo.
//
// O QUE FALTA DECIDIR (é o que trava): a ficha do locador não vive só na ficha.
// O gatilho `onFichaLocadorEnviadaAdmin` COPIA os dados pessoais pra:
//   • `pessoas/{fichaId}_loc1|_loc2` — nome, RG, CPF, nascimento, endereço, cônjuge;
//   • `imoveis/{fichaId}`            — endereço, nome do locador, links dos anexos.
// Anonimizar só a ficha deixaria o CPF e o RG inteiros no `pessoas` — pior que não
// fazer nada, porque passa a sensação de conformidade sem a conformidade.
// Mas apagar `pessoas` de um imóvel com CONTRATO VIGENTE quebra a operação (e a
// LGPD nem pede isso: enquanto dura o contrato existe base legal pra guardar).
// Caminho recomendado quando for retomar: expurgar ficha + pessoas + PII do imóvel,
// PULANDO os imóveis com contrato ativo (eles entram na fila quando o contrato cair).
//
// As fichas guardam CPF, RG, renda, endereço. A LGPD não deixa guardar isso "pra
// sempre": passado o tempo em que o dado é necessário, ele tem que sair.
//
// Duas operações, com intenções DIFERENTES — não confundir:
//
//   • EXPURGO por retenção (lgpdExpurgar) → ANONIMIZA. Apaga os dados pessoais e
//     os anexos, mas mantém a casca da ficha (qual corretor, tipo, status, data).
//     Assim o histórico do negócio não some dos relatórios, e o dado pessoal sim.
//
//   • EXCLUSÃO a pedido do titular (lgpdExcluirTitular) → APAGA TUDO. O direito ao
//     esquecimento é sobre o registro inteiro, não sobre "quase tudo". Sem volta.
//
// Nada disso roda sozinho por padrão: o automático mensal tem interruptor próprio
// (`_lgpd_config/retencao.automatico`) e vem DESLIGADO.

const LGPD_DIAS_MIN = 180;      // menos que isso é quase certo que foi engano de digitação
const LGPD_DIAS_PADRAO = 730;   // 2 anos
const LGPD_LOTE_MAX = 200;      // por chamada, pra não estourar o tempo da function

// O caminho do arquivo no Storage está embutido na URL de download que gravamos na
// ficha (…/o/<caminho-encodado>?alt=media&token=…). É de lá que o tiramos.
function _caminhoDoAnexo(url) {
  const m = /\/o\/([^?]+)/.exec(String(url || ''));
  if (!m) return null;
  let p;
  try { p = decodeURIComponent(m[1]); } catch (_) { return null; }
  if (p.includes('..')) return null;
  // Cinto de segurança: só apagamos dentro das pastas de ficha, nunca fora delas.
  if (!p.startsWith('fichas/') && !p.startsWith('fichas-locador/')) return null;
  return p;
}

// Apaga os anexos de uma ficha. Não lança: um arquivo que já sumiu não pode
// impedir o resto do expurgo de acontecer. Os deletes vão em paralelo — em série,
// uma ficha com 10 anexos já custa ~1s, e 200 fichas estouram o tempo da function.
async function _apagarAnexosDaFicha(documentos) {
  const bucket = admin.storage().bucket(FICHA_BUCKET);
  const caminhos = Object.values(documentos || {}).map(_caminhoDoAnexo).filter(Boolean);
  const r = await Promise.all(caminhos.map(async (p) => {
    try { await bucket.file(p).delete({ ignoreNotFound: true }); return 1; }
    catch (e) { await logErro('lgpd.apagarAnexo', e, { caminho: p }); return 0; }
  }));
  return r.reduce((a, b) => a + b, 0);
}

async function _lgpdConfig() {
  const snap = await db.collection('_lgpd_config').doc('retencao').get();
  const c = snap.exists ? snap.data() : {};
  return {
    dias: Number.isInteger(c.dias) && c.dias >= LGPD_DIAS_MIN ? c.dias : LGPD_DIAS_PADRAO,
    automatico: c.automatico === true
  };
}

function _lgpdCorte(dias) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - dias * 86400000);
}

// CONTA quantas fichas passaram do prazo — o número que a tela mostra antes de
// perguntar qualquer coisa, então ele precisa ser o número REAL, sem teto. Puxa só
// o campo `expurgadoEm` de cada doc (select), o que deixa a leitura barata mesmo
// com milhares de fichas — nenhum dado pessoal sai do servidor.
//
// Por que filtrar em memória e não no Firestore: doc que NUNCA foi expurgado não
// tem o campo `expurgadoEm`, e no Firestore um doc sem o campo não casa com
// comparação nenhuma (nem `== null`). Não dá pra pedir "os que não têm".
//
// Fichas antigas sem `criadoEm` (se houver) não entram: a comparação não as pega.
// Isso erra pro lado seguro — deixa de apagar, nunca apaga demais.
async function _lgpdContar(dias) {
  const corte = _lgpdCorte(dias);
  const porColecao = {};
  let total = 0;
  for (const colecao of FICHA_COLECOES) {
    const snap = await db.collection(colecao)
      .where('criadoEm', '<', corte)
      .select('expurgadoEm')
      .get();
    const n = snap.docs.filter(d => !d.data().expurgadoEm).length;
    porColecao[colecao] = n;
    total += n;
  }
  return { fichas: total, porColecao };
}

// APLICA o expurgo, no máximo LGPD_LOTE_MAX fichas por chamada (pra não estourar o
// tempo da function). Devolve quantas sobraram, pra tela pedir de novo.
async function _lgpdExpurgar(dias, auth) {
  const corte = _lgpdCorte(dias);
  const antes = await _lgpdContar(dias);
  const resumo = { fichas: 0, anexos: 0, restantes: 0, porColecao: {} };
  let orcamento = LGPD_LOTE_MAX;

  for (const colecao of FICHA_COLECOES) {
    resumo.porColecao[colecao] = 0;
    if (orcamento <= 0) continue;

    // PAGINA de verdade (startAfter), não "pega os N primeiros e filtra".
    // Como a ordem é por criadoEm asc, as já-expurgadas são justamente as MAIS
    // ANTIGAS — numa janela fixa elas ocupariam o resultado inteiro e as fichas
    // recém-vencidas nunca apareceriam. O expurgo pararia de funcionar em silêncio.
    let cursor = null;
    while (orcamento > 0) {
      let q = db.collection(colecao)
        .where('criadoEm', '<', corte)
        .orderBy('criadoEm', 'asc')
        .limit(300);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      cursor = snap.docs[snap.docs.length - 1];

      const alvos = snap.docs.filter(d => !d.data().expurgadoEm).slice(0, orcamento);
      for (const doc of alvos) {
        resumo.anexos += await _apagarAnexosDaFicha(doc.data().documentos);
        // Anonimiza: o dado pessoal sai, a casca do negócio fica.
        await doc.ref.update({
          dados: {},
          documentos: {},
          pendentes: [],
          observacaoCorretor: '',
          expurgado: true,
          expurgadoEm: admin.firestore.FieldValue.serverTimestamp(),
          expurgadoPor: auth?.token?.email || auth?.uid || 'automatico'
        });
      }
      resumo.porColecao[colecao] += alvos.length;
      resumo.fichas += alvos.length;
      orcamento -= alvos.length;
      if (snap.size < 300) break;   // acabou a coleção
    }
  }

  resumo.restantes = Math.max(0, antes.fichas - resumo.fichas);
  if (resumo.fichas) {
    await registrarAudit(auth, 'expurgou_fichas_lgpd', { tipo: 'lgpd' },
      { dias, fichas: resumo.fichas, anexos: resumo.anexos, restantes: resumo.restantes });
  }
  return resumo;
}

// ─── CHAVE MESTRA ─────────────────────────────────────────────────────────────
// Enquanto isto for `false`, NENHUMA function de LGPD é exportada — nem um
// `firebase deploy --only functions` (que o CLAUDE.md documenta, sem nome de
// função) consegue subir isso por acidente. O firebase-functions descobre o que
// deployar lendo os `exports` no carregamento do módulo: sem export, sem deploy.
// Vira `true` só quando o alcance do expurgo estiver resolvido (ver o cabeçalho
// deste bloco: falta cobrir `pessoas` e `imoveis`, pulando contrato vigente).
const LGPD_ATIVO = false;

if (LGPD_ATIVO) {

// Painel do Admin: o prazo configurado e quantas fichas já passaram dele.
// Devolve SÓ contagens — nenhum dado pessoal sai daqui.
exports.lgpdPainel = onCall(async (req) => {
  await exigirAdmin(req);
  const cfg = await _lgpdConfig();
  const dias = Number.isInteger(req.data?.dias) ? req.data.dias : cfg.dias;
  if (dias < LGPD_DIAS_MIN) throw new HttpsError('invalid-argument', `O prazo mínimo é ${LGPD_DIAS_MIN} dias.`);

  const previa = await _lgpdContar(dias);

  const totais = {};
  for (const colecao of FICHA_COLECOES) {
    const [tudo, expurgadas] = await Promise.all([
      db.collection(colecao).count().get(),
      db.collection(colecao).where('expurgado', '==', true).count().get()
    ]);
    totais[colecao] = { total: tudo.data().count, expurgadas: expurgadas.data().count };
  }

  return { cfg, diasConsultado: dias, previa, totais, minimo: LGPD_DIAS_MIN };
});

// Salva o prazo de retenção e o interruptor do automático.
exports.lgpdSetConfig = onCall(async (req) => {
  await exigirAdmin(req);
  const dias = Number(req.data?.dias);
  const automatico = req.data?.automatico === true;
  if (!Number.isInteger(dias) || dias < LGPD_DIAS_MIN || dias > 3650) {
    throw new HttpsError('invalid-argument', `O prazo tem que ser um número entre ${LGPD_DIAS_MIN} e 3650 dias.`);
  }
  await db.collection('_lgpd_config').doc('retencao').set({
    dias, automatico,
    alteradoEm: admin.firestore.FieldValue.serverTimestamp(),
    alteradoPor: req.auth?.token?.email || req.auth?.uid || ''
  }, { merge: true });
  await registrarAudit(req.auth, 'alterou_config_lgpd', { tipo: 'lgpd' }, { dias, automatico });
  return { ok: true, dias, automatico };
});

// Executa o expurgo (anonimização) das fichas mais velhas que o prazo.
// A tela sempre mostra a prévia antes — esta chamada é o "sim, pode".
// timeoutSeconds: um lote de 200 fichas com anexos passa MUITO dos 60s padrão.
exports.lgpdExpurgar = onCall({ timeoutSeconds: 540 }, async (req) => {
  await exigirAdmin(req);
  const cfg = await _lgpdConfig();
  const dias = Number.isInteger(req.data?.dias) ? req.data.dias : cfg.dias;
  if (dias < LGPD_DIAS_MIN) throw new HttpsError('invalid-argument', `O prazo mínimo é ${LGPD_DIAS_MIN} dias.`);
  return await _lgpdExpurgar(dias, req.auth);
});

// Direito ao esquecimento: o titular pede, a ficha inteira sai (doc + anexos).
// Diferente do expurgo, aqui NÃO sobra casca — é exatamente isso que ele pediu.
exports.lgpdExcluirTitular = onCall(async (req) => {
  await exigirAdmin(req);
  const colecao = String(req.data?.colecao || '');
  const fichaId = String(req.data?.fichaId || '');
  if (!FICHA_COLECOES.includes(colecao)) throw new HttpsError('invalid-argument', 'Coleção inválida.');
  if (!fichaId || fichaId.length > 200) throw new HttpsError('invalid-argument', 'ID da ficha inválido.');

  const ref = db.collection(colecao).doc(fichaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha não encontrada.');

  const anexos = await _apagarAnexosDaFicha(snap.data().documentos);
  await ref.delete();
  await registrarAudit(req.auth, 'excluiu_ficha_lgpd', { tipo: 'lgpd', id: fichaId },
    { colecao, anexos, motivo: 'pedido do titular' });
  return { ok: true, anexos };
});

// Expurgo automático mensal — dia 1, 04h. Só roda com o interruptor ligado
// (`_lgpd_config/retencao.automatico`), que vem DESLIGADO. Enquanto estiver
// desligado, o expurgo só acontece pelo botão do Admin.
exports.lgpdExpurgoAutomatico = onSchedule({ schedule: '0 4 1 * *', timeZone: TZ, timeoutSeconds: 540 }, async () => {
  const cfg = await _lgpdConfig();
  if (!cfg.automatico) return;
  // Roda em lotes até esvaziar (cada _lgpdExpurgar cobre até LGPD_LOTE_MAX fichas).
  // O teto de voltas existe pra um bug nunca virar laço infinito dentro da function.
  let voltas = 0, fichas = 0, anexos = 0, restantes = 0;
  do {
    const r = await _lgpdExpurgar(cfg.dias, null);
    fichas += r.fichas; anexos += r.anexos; restantes = r.restantes;
    if (!r.fichas) break;   // nada saiu nesta volta: para, senão gira à toa
  } while (restantes > 0 && ++voltas < 20);
  console.log(`[LGPD] expurgo automático: ${fichas} ficha(s), ${anexos} anexo(s), faltam ${restantes}`);
});

}  // ← fim do if (LGPD_ATIVO). Acima daqui, nada é exportado enquanto a chave for false.

// ─── Assistente de Leads (IA · Gemini) ───────────────────────────────────────
// Sugere 3 respostas de WhatsApp a partir da mensagem de um lead. A chave do
// Gemini fica como SECRET do Firebase (GEMINI_API_KEY) — nunca vai pro cliente
// nem pro .exe. Qualquer usuário logado do Hub pode usar. Modelo trocável pela
// env GEMINI_MODEL (padrão: apelido oficial do flash atual).
const IA_LEAD_SYSTEM = `Você é o assistente de um corretor de imóveis da REMAX Smart no Brasil.
A partir da mensagem de um cliente (lead) que chegou pelo WhatsApp, escreva 3 opções de
resposta para o corretor enviar. Regras:
- Português do Brasil, tom de WhatsApp: caloroso, profissional e direto (2 a 5 frases).
- Objetivo: responder à dúvida, QUALIFICAR o lead (ex.: finalidade, região, orçamento, prazo)
  e conduzir para AGENDAR uma visita ou próxima conversa.
- NUNCA invente dados do imóvel (valor, metragem, endereço) que não foram informados.
- Se o nome do corretor for informado, pode assinar; se o nome do cliente aparecer, use.
- Cada resposta deve estar pronta para copiar e colar (sem colchetes de preenchimento).
Devolva também uma "dica" curta de próximo passo para o corretor.`;

exports.sugerirRespostaLead = onCall({ secrets: [GEMINI_API_KEY] }, async (req) => {
  exigirAutenticado(req);
  const KEY = (GEMINI_API_KEY.value() || '').trim();
  if (!KEY) throw new HttpsError('failed-precondition', 'A chave do Gemini não está configurada no servidor.');
  const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const dados = req.data || {};
  const mensagem = String(dados.mensagem || '').trim();
  if (!mensagem) throw new HttpsError('invalid-argument', 'Cole a mensagem do cliente.');
  if (mensagem.length > 4000) throw new HttpsError('invalid-argument', 'Mensagem muito longa.');

  const lim = (s, n) => String(s || '').trim().slice(0, n);
  const ctx = [
    `Mensagem do cliente: ${mensagem.slice(0, 4000)}`,
    dados.canal      ? `Canal/origem: ${lim(dados.canal, 120)}` : '',
    dados.finalidade ? `Interesse: ${lim(dados.finalidade, 60)}` : '',
    dados.imovel     ? `Imóvel em questão: ${lim(dados.imovel, 300)}` : '',
    dados.tom        ? `Tom desejado: ${lim(dados.tom, 60)}` : '',
    dados.corretor   ? `Nome do corretor (assinatura): ${lim(dados.corretor, 80)}` : ''
  ].filter(Boolean).join('\n');

  const body = {
    system_instruction: { parts: [{ text: IA_LEAD_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: ctx }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { respostas: { type: 'array', items: { type: 'string' } }, dica: { type: 'string' } },
        required: ['respostas']
      }
    }
  };

  let resp, txt;
  try {
    resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body)
    });
    txt = await resp.text();
  } catch (e) {
    throw new HttpsError('unavailable', 'Não consegui falar com o Gemini agora. Tente de novo.');
  }
  if (!resp.ok) {
    let msg = '';
    try { msg = ((JSON.parse(txt) || {}).error || {}).message || ''; } catch { msg = ''; }
    console.error('[sugerirRespostaLead] Gemini', resp.status, msg);
    if (resp.status === 429) throw new HttpsError('resource-exhausted', 'O limite grátis do Gemini foi atingido por enquanto. Tente mais tarde.');
    throw new HttpsError('internal', 'O Gemini recusou a solicitação. Tente de novo.');
  }

  let data; try { data = JSON.parse(txt); } catch { data = {}; }
  const cand = (data.candidates || [])[0];
  if (!cand) throw new HttpsError('internal', 'O Gemini não retornou resposta. Reformule e tente de novo.');
  const fim = cand.finishReason || '';
  if (fim === 'SAFETY' || fim === 'PROHIBITED_CONTENT' || fim === 'BLOCKLIST') throw new HttpsError('invalid-argument', 'O Gemini bloqueou esta mensagem por segurança. Reformule o texto.');
  if (fim === 'MAX_TOKENS') throw new HttpsError('internal', 'A resposta veio cortada. Tente uma mensagem mais curta.');
  const conteudo = (((cand.content || {}).parts || [])[0] || {}).text || '';
  let out; try { out = JSON.parse(conteudo); } catch { throw new HttpsError('internal', 'Não consegui interpretar a resposta da IA. Tente de novo.'); }
  const respostas = Array.isArray(out.respostas) ? out.respostas.filter(r => typeof r === 'string' && r.trim()).slice(0, 3) : [];
  if (!respostas.length) throw new HttpsError('internal', 'A IA não retornou respostas utilizáveis. Tente de novo.');
  return { ok: true, respostas, dica: typeof out.dica === 'string' ? out.dica : '', modelo: MODEL };
});

// ─── Próxima ação do Negócio (IA · Gemini) ───────────────────────────────────
// A partir do ESTADO de um negócio (etapa, checklist, dias parado, histórico),
// sugere (1) a próxima ação para o corretor e (2) um rascunho de mensagem pronta
// para o cliente. SÓ POR CLIQUE — nunca roda sozinha (não torra o limite grátis).
// Mesmo molde da sugerirRespostaLead: secret GEMINI_API_KEY, responseSchema, humano
// revisa. Posse via _negocioComPosse (gestor/administrativo/corretor responsável).
const IA_NEG_SYSTEM = `Você é o assistente de um corretor de imóveis da REMAX Smart no Brasil.
Recebe o ESTADO de um negócio (imobiliário) em andamento: tipo, etapa atual, o que já foi
concluído no checklist, o que falta, há quantos dias está parado e o histórico recente.
Sua tarefa é devolver DUAS coisas:
- "acao": a próxima ação concreta que o corretor deve tomar AGORA para destravar o negócio
  (1 a 3 frases, direto ao ponto, em português do Brasil). Baseie-se SÓ no que falta no
  checklist e no tempo parado. Se está tudo em dia, oriente o próximo passo natural da etapa.
- "mensagem": um rascunho de mensagem de WhatsApp pronto para o corretor ENVIAR AO CLIENTE
  neste momento do negócio (2 a 5 frases, tom caloroso e profissional, pronto para copiar,
  sem colchetes de preenchimento). Se souber o nome do cliente, use.
Regras: NUNCA invente valores, metragem, endereço ou dados que não foram informados. Não
prometa prazos que você não tem como garantir. Escreva sempre em português do Brasil.`;

exports.negocioSugerirAcao = onCall({ secrets: [GEMINI_API_KEY] }, async (req) => {
  const auth = exigirAutenticado(req);
  const KEY = (GEMINI_API_KEY.value() || '').trim();
  if (!KEY) throw new HttpsError('failed-precondition', 'A chave do Gemini não está configurada no servidor.');
  const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  // Posse: gestor/administrativo veem tudo; corretor só o seu negócio.
  const { snap } = await _negocioComPosse((req.data || {}).negocioId, auth);
  const n = snap.data() || {};
  if (n.status === 'concluido' || n.status === 'cancelado') {
    throw new HttpsError('failed-precondition', 'Este negócio já está encerrado — não há próxima ação.');
  }

  const ROTULO_STATUS = {
    negocio_criado: 'Negócio criado', em_andamento: 'Em andamento',
    aguardando_broker: 'Aguardando o gestor', aguardando_corretor: 'Aguardando o corretor',
    aguardando_administrativo: 'Aguardando o administrativo', entregue_gestao: 'Entregue para a gestão'
  };
  const checklist = Array.isArray(n.checklist) ? n.checklist : [];
  const feitas = checklist.filter(x => x.feito).map(x => x.label);
  const pendentes = checklist.filter(x => !x.feito);
  const proxObrig = pendentes.filter(x => x.obrigatoria).map(x => x.label);
  const ultAtual = n.atualizadoEm && n.atualizadoEm.toDate ? n.atualizadoEm.toDate().getTime() : Date.now();
  const diasParado = Math.max(0, Math.floor((Date.now() - ultAtual) / 86400000));
  const hist = (n.timeline || []).slice(-5).map(h => `- ${h.texto || ''}`).join('\n');

  const ctx = [
    `Tipo de negócio: ${n.tipo === 'venda' ? 'Venda' : 'Locação'}`,
    `Etapa atual (status): ${ROTULO_STATUS[n.status] || n.status || '—'}`,
    `Cliente: ${n.clienteNome || '(não informado)'}`,
    `Imóvel: ${(n.imovelResumo || '') + (n.cidade ? ' — ' + n.cidade : '') || '(não informado)'}`,
    `Próxima ação registrada no sistema: ${n.proximaAcao || '(nenhuma)'}`,
    `Dias parado sem atualização: ${diasParado}`,
    `Etapas JÁ concluídas do checklist: ${feitas.length ? feitas.join('; ') : '(nenhuma ainda)'}`,
    `Etapas que FALTAM: ${pendentes.length ? pendentes.map(x => x.label).join('; ') : '(nenhuma — checklist completo)'}`,
    proxObrig.length ? `Dessas, são OBRIGATÓRIAS: ${proxObrig.join('; ')}` : '',
    hist ? `Histórico recente:\n${hist}` : ''
  ].filter(Boolean).join('\n');

  const body = {
    system_instruction: { parts: [{ text: IA_NEG_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: ctx }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { acao: { type: 'string' }, mensagem: { type: 'string' } },
        required: ['acao', 'mensagem']
      }
    }
  };

  let resp, txt;
  try {
    resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body)
    });
    txt = await resp.text();
  } catch (e) {
    throw new HttpsError('unavailable', 'Não consegui falar com o Gemini agora. Tente de novo.');
  }
  if (!resp.ok) {
    let msg = '';
    try { msg = ((JSON.parse(txt) || {}).error || {}).message || ''; } catch { msg = ''; }
    console.error('[negocioSugerirAcao] Gemini', resp.status, msg);
    if (resp.status === 429) throw new HttpsError('resource-exhausted', 'O limite grátis do Gemini foi atingido por enquanto. Tente mais tarde.');
    throw new HttpsError('internal', 'O Gemini recusou a solicitação. Tente de novo.');
  }

  let data; try { data = JSON.parse(txt); } catch { data = {}; }
  const cand = (data.candidates || [])[0];
  if (!cand) throw new HttpsError('internal', 'O Gemini não retornou resposta. Tente de novo.');
  const fim = cand.finishReason || '';
  if (fim === 'SAFETY' || fim === 'PROHIBITED_CONTENT' || fim === 'BLOCKLIST') throw new HttpsError('invalid-argument', 'O Gemini bloqueou esta solicitação por segurança.');
  if (fim === 'MAX_TOKENS') throw new HttpsError('internal', 'A resposta veio cortada. Tente de novo.');
  const conteudo = (((cand.content || {}).parts || [])[0] || {}).text || '';
  let out; try { out = JSON.parse(conteudo); } catch { throw new HttpsError('internal', 'Não consegui interpretar a resposta da IA. Tente de novo.'); }
  const acao = typeof out.acao === 'string' ? out.acao.trim() : '';
  const mensagem = typeof out.mensagem === 'string' ? out.mensagem.trim() : '';
  if (!acao && !mensagem) throw new HttpsError('internal', 'A IA não retornou uma sugestão utilizável. Tente de novo.');
  return { ok: true, acao, mensagem, modelo: MODEL };
});

// ─── Notícia de imóveis (banner automático) ──────────────────────────────────
// Lê o RSS do Google Notícias (imóveis/BR), guarda a lista ~1h no Firestore e
// devolve a LISTA de manchetes (o Hub mostra uma diferente a cada aparição do banner).
// SEM IA, SEM chave, SEM secret — só um feed. O cliente nunca lê o cache direto:
// pega tudo pelo retorno desta função (usuário logado do Hub).
const NOTICIA_CACHE_DOC = '_cache/noticia_imoveis';
const NOTICIA_RSS_URL = 'https://news.google.com/rss/search?q=' +
  encodeURIComponent('mercado imobiliário OR imóveis OR aluguel OR financiamento imobiliário') +
  '&hl=pt-BR&gl=BR&ceid=BR:pt-419';

function _noticiaLimparXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
function _noticiaParseRss(xml) {
  const itens = [];
  const blocos = String(xml || '').split('<item>').slice(1);
  for (const b of blocos) {
    const titulo = _noticiaLimparXml((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link   = _noticiaLimparXml((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const fonte  = _noticiaLimparXml((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (titulo && /^https?:\/\//i.test(link)) itens.push({ titulo, link, fonte });
    if (itens.length >= 15) break;
  }
  return itens;
}

exports.noticiaImoveisDoDia = onCall(async (req) => {
  exigirAutenticado(req);
  const db = admin.firestore();
  const ref = db.doc(NOTICIA_CACHE_DOC);
  const agora = Date.now();
  let itens = [];

  // 1) tenta o cache (< 1h)
  try {
    const snap = await ref.get();
    const c = snap.exists ? snap.data() : null;
    if (c && Array.isArray(c.itens) && c.itens.length && (agora - (c.buscadoEm || 0)) < 3600000) {
      itens = c.itens;
    }
  } catch (_) { /* segue pro fetch */ }

  // 2) cache velho/ausente → lê o RSS e regrava
  if (!itens.length) {
    try {
      const resp = await fetch(NOTICIA_RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 SmartHub' } });
      if (resp.ok) {
        itens = _noticiaParseRss(await resp.text());
        if (itens.length) await ref.set({ itens, buscadoEm: agora }, { merge: true });
      }
    } catch (_) { /* devolve indisponível */ }
  }

  if (!itens.length) return { ok: false };
  // Devolve a lista; o Hub mostra uma manchete diferente a cada vez que o banner aparece.
  return { ok: true, itens: itens.slice(0, 10) };
});

// ═══ RECRUTAMENTO DE CORRETORES ══════════════════════════════════════════════
// CRM de funil pra recrutar corretores. Os candidatos chegam por um Google Forms
// (webhook → Apps Script) e o GESTOR trabalha cada um no Hub (só gestor vê).
// ⚠️ DADOS SENSÍVEIS (RG, CPF, dados bancários): escrita/leitura SÓ via estas
// functions (Admin SDK). As regras do Firestore negam acesso direto do cliente à
// coleção `candidatos` (default-deny). Entra na LGPD quando ela for ligada.
const REC_ETAPAS = ['primeiro_contato', 'reuniao_agendada', 'reuniao_realizada', 'acompanhamento', 'associado', 'nao_associado'];
const REC_STATUS = ['ativo', 'inativo'];
const REC_ETAPA_ROTULO = {
  primeiro_contato: 'Primeiro contato', reuniao_agendada: 'Reunião agendada',
  reuniao_realizada: 'Reunião realizada', acompanhamento: 'Acompanhamento',
  associado: 'Corretor associado', nao_associado: 'Corretor não associado'
};
// Chaves antigas (antes do rename 2026-08) → novas. Normaliza na LEITURA; a gravação
// já usa as novas. Migra sozinho quando o gestor mover o candidato de fase.
const REC_ETAPA_LEGADO = { sem_contato: 'primeiro_contato', contato_realizado: 'acompanhamento', desassociado: 'nao_associado' };
function _recEtapa(e) { return REC_ETAPA_LEGADO[e] || (REC_ETAPAS.includes(e) ? e : 'primeiro_contato'); }

// Valida CPF pelo dígito verificador (grátis, offline). Pega digitação errada e CPF
// falso (ex.: 111.111.111-11). NÃO garante que existe na Receita — só que é bem-formado.
function _cpfValido(cpf) {
  const s = String(cpf || '').replace(/\D/g, '');
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(s[i], 10) * (10 - i);
  let d1 = (soma * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(s[i], 10) * (11 - i);
  let d2 = (soma * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10], 10);
}

// Serializa um candidato pro cliente (Timestamps viram ISO).
function _recSerializar(id, d) {
  const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : (typeof t === 'string' ? t : null));
  return {
    id,
    nome: d.nome || '', email: d.email || '', telefone: d.telefone || '', telefone2: d.telefone2 || '', fonte: d.fonte || '',
    rg: d.rg || '', cpf: d.cpf || '', cpfValido: (d.cpfValido === undefined ? null : d.cpfValido), endereco: d.endereco || '', dadosBancarios: d.dadosBancarios || '',
    expImobiliaria: !!d.expImobiliaria, expImobiliariaDesc: d.expImobiliariaDesc || '',
    expVendas: !!d.expVendas, expVendasDesc: d.expVendasDesc || '',
    maiorSonho: d.maiorSonho || '', opiniaoRemax: d.opiniaoRemax || '', clubeDesejado: d.clubeDesejado || '',
    etapa: _recEtapa(d.etapa), status: d.status || 'ativo',
    perfil: d.perfil || '', nota: (d.nota != null ? d.nota : ''), tags: Array.isArray(d.tags) ? d.tags : [],
    origem: d.origem || 'manual',
    historico: Array.isArray(d.historico) ? d.historico : [],
    criadoEm: iso(d.criadoEm), atualizadoEm: iso(d.atualizadoEm)
  };
}

// Webhook do Google Forms (Apps Script POSTa aqui a cada resposta). Cria/atualiza o
// candidato na etapa inicial. Idempotente por CPF (reenvio não duplica). Secret no header.
exports.recrutamentoWebhook = onRequest({ secrets: [RECRUTAMENTO_SECRET] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    // Secret vazio/não-configurado NÃO pode autorizar (senão '' !== '' liberaria geral);
    // comparação timing-safe, igual ao botReceberAchados.
    const segRec = req.get('x-recrutamento-secret') || '';
    const espRec = RECRUTAMENTO_SECRET.value() || '';
    if (!espRec || segRec.length !== espRec.length || !crypto.timingSafeEqual(Buffer.from(segRec), Buffer.from(espRec))) return res.status(401).json({ ok: false });
    const b = req.body || {};
    const nome = _txt(b.nome, 160);
    if (!nome) return res.status(400).json({ ok: false, erro: 'nome obrigatório' });
    const cpf = _txt(b.cpf, 20);
    const cpfDigits = cpf.replace(/\D/g, '');   // dedupe por dígitos: "123.456.789-09" == "12345678909"
    const sim = (v) => v === true || /^sim$/i.test(String(v || '').trim());

    const dados = {
      nome, email: _txt(b.email, 160), telefone: _txt(b.telefone, 40),
      rg: _txt(b.rg, 40), cpf, cpfDigits, endereco: _txt(b.endereco, 300), dadosBancarios: _txt(b.dadosBancarios, 400),
      expImobiliaria: sim(b.expImobiliaria), expImobiliariaDesc: _txt(b.expImobiliariaDesc, 2000),
      expVendas: sim(b.expVendas), expVendasDesc: _txt(b.expVendasDesc, 2000),
      maiorSonho: _txt(b.maiorSonho, 2000), opiniaoRemax: _txt(b.opiniaoRemax, 2000),
      clubeDesejado: _txt(b.clubeDesejado, 120),
      cpfValido: cpf ? _cpfValido(cpf) : null,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    };

    // Dedupe por CPF: reenvio da mesma pessoa atualiza os dados, não cria duplicado.
    // Compara pelos DÍGITOS (cpfDigits) — formato diferente ("123.456…" vs "123456…") não duplica.
    // Fallback no cpf cru pra docs antigos que ainda não têm cpfDigits.
    let ref = null, existe = false;
    if (cpfDigits) {
      let q = await db.collection('candidatos').where('cpfDigits', '==', cpfDigits).limit(1).get();
      if (q.empty) q = await db.collection('candidatos').where('cpf', '==', cpf).limit(1).get();
      if (!q.empty) { ref = q.docs[0].ref; existe = true; }
    }
    if (!ref) ref = db.collection('candidatos').doc();

    if (existe) {
      await ref.set({ ...dados, historico: admin.firestore.FieldValue.arrayUnion({
        texto: 'Reenviou o formulário de inscrição', etapa: '', por: 'form', porNome: 'Formulário', em: Date.now()
      }) }, { merge: true });
    } else {
      await ref.set({
        ...dados, etapa: 'primeiro_contato', status: 'ativo', perfil: '', nota: '', tags: [], origem: 'formulario',
        historico: [{ texto: 'Inscrição recebida pelo formulário', etapa: 'primeiro_contato', por: 'form', porNome: 'Formulário', em: Date.now() }],
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    await _bumpBroadcast('recrutamentoSeq');   // tempo real: a tela Recrutamento (se aberta) recarrega
    return res.json({ ok: true, id: ref.id, atualizado: existe });
  } catch (e) {
    await logErro('recrutamentoWebhook', e, {});
    return res.status(500).json({ ok: false });
  }
});

// (gestor) Lista os candidatos — SÓ campos leves (sem PII pesada: nada de CPF/RG/banco).
exports.recrutamentoListar = onCall(async (req) => {
  await exigirGestor(req);
  const snap = await db.collection('candidatos').orderBy('atualizadoEm', 'desc').limit(1000).get();
  const iso = (t) => (t && t.toDate ? t.toDate().toISOString() : null);
  const itens = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id, nome: d.nome || '', etapa: _recEtapa(d.etapa), status: d.status || 'ativo',
      cpfValido: (d.cpfValido === undefined ? null : d.cpfValido),
      perfil: d.perfil || '', nota: (d.nota != null ? d.nota : ''), tags: Array.isArray(d.tags) ? d.tags : [],
      origem: d.origem || 'manual', atualizadoEm: iso(d.atualizadoEm), criadoEm: iso(d.criadoEm)
    };
  });
  return { ok: true, itens };
});

// (gestor) Um candidato completo (com a PII).
exports.recrutamentoObter = onCall(async (req) => {
  await exigirGestor(req);
  const id = _txt((req.data || {}).id, 60);
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  const snap = await db.collection('candidatos').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Candidato não encontrado.');
  return { ok: true, candidato: _recSerializar(snap.id, snap.data()) };
});

// (gestor) Cria (manual) ou edita um candidato. Mudança de etapa gera histórico automático.
exports.recrutamentoSalvar = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const d = req.data || {};
  const id = _txt(d.id, 60);
  const porNome = _txt(d.porNome, 80) || 'Gestor';

  // Campos editáveis (todos opcionais no update; nome obrigatório na criação).
  // ⚠️ Limites por campo IGUAIS aos do webhook — os 4 textos longos aceitam 2000;
  // um teto único de 400 amputava em silêncio a resposta do formulário no 1º Salvar.
  const patch = {};
  const REC_MAX = {
    nome: 160, email: 160, telefone: 40, telefone2: 40, fonte: 120, rg: 40, cpf: 20,
    endereco: 300, dadosBancarios: 400, perfil: 120, clubeDesejado: 120,
    expImobiliariaDesc: 2000, expVendasDesc: 2000, maiorSonho: 2000, opiniaoRemax: 2000
  };
  Object.keys(REC_MAX).forEach(k => { if (typeof d[k] === 'string') patch[k] = d[k].trim().slice(0, REC_MAX[k]); });
  if (typeof d.expImobiliaria === 'boolean') patch.expImobiliaria = d.expImobiliaria;
  if (typeof d.expVendas === 'boolean') patch.expVendas = d.expVendas;
  if (d.nota != null) patch.nota = _txt(String(d.nota), 20);
  if (Array.isArray(d.tags)) patch.tags = d.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 40)).slice(0, 20);
  if (d.etapa != null) { if (!REC_ETAPAS.includes(d.etapa)) throw new HttpsError('invalid-argument', 'Etapa inválida.'); patch.etapa = d.etapa; }
  if (d.status != null) { if (!REC_STATUS.includes(d.status)) throw new HttpsError('invalid-argument', 'Status inválido.'); patch.status = d.status; }
  if ('cpf' in patch) {
    patch.cpfValido = patch.cpf ? _cpfValido(patch.cpf) : null;
    patch.cpfDigits = patch.cpf.replace(/\D/g, '');   // mantém o dedupe do webhook funcionando após edição
  }
  patch.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();

  if (!id) {
    if (!patch.nome) throw new HttpsError('invalid-argument', 'O nome é obrigatório.');
    const ref = await db.collection('candidatos').add({
      etapa: 'primeiro_contato', status: 'ativo', perfil: '', nota: '', tags: [], origem: 'manual',
      ...patch,
      historico: [{ texto: 'Candidato cadastrado manualmente', etapa: patch.etapa || 'primeiro_contato', por: auth.uid, porNome, em: Date.now() }],
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    await _bumpBroadcast('recrutamentoSeq');
    return { ok: true, id: ref.id };
  }

  // Update: relê pra detectar mudança de etapa e carimbar histórico.
  const ref = db.collection('candidatos').doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato não encontrado.');
    const antes = snap.data();
    const writes = { ...patch };
    if (patch.etapa && patch.etapa !== antes.etapa) {
      writes.historico = admin.firestore.FieldValue.arrayUnion({
        texto: 'Etapa alterada para ' + (REC_ETAPA_ROTULO[patch.etapa] || patch.etapa), etapa: patch.etapa, por: auth.uid, porNome, em: Date.now()
      });
    }
    tx.set(ref, writes, { merge: true });
  });
  await _bumpBroadcast('recrutamentoSeq');
  return { ok: true, id };
});

// (gestor) Adiciona um registro no histórico do candidato.
exports.recrutamentoHistorico = onCall(async (req) => {
  const auth = await exigirGestor(req);
  const d = req.data || {};
  const id = _txt(d.id, 60);
  const texto = _txt(d.texto, 1000);
  const porNome = _txt(d.porNome, 80) || 'Gestor';
  if (!id || !texto) throw new HttpsError('invalid-argument', 'id e texto são obrigatórios.');
  const ref = db.collection('candidatos').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Candidato não encontrado.');
  await ref.set({
    historico: admin.firestore.FieldValue.arrayUnion({ texto, etapa: '', por: auth.uid, porNome, em: Date.now() }),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await _bumpBroadcast('recrutamentoSeq');   // muda atualizadoEm (ordem da lista) → avisa quem está com a tela aberta
  return { ok: true };
});

// (gestor) Exclui um candidato (some com a PII — decisão do gestor).
exports.recrutamentoExcluir = onCall(async (req) => {
  await exigirGestor(req);
  const id = _txt((req.data || {}).id, 60);
  if (!id) throw new HttpsError('invalid-argument', 'id é obrigatório.');
  await db.collection('candidatos').doc(id).delete();
  await _bumpBroadcast('recrutamentoSeq');
  return { ok: true };
});
