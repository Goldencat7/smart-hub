const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
  const snap = await db.collection('user_access').doc(auth.uid).get();
  const dados = snap.exists ? snap.data() : {};
  const drives_fotografia = !!dados.drives_fotografia;
  if (ehAdminAuth(auth)) return { apps: RESTRICTED_APPS, isAdmin: true, drives_fotografia };
  const apps = dados.apps || [];
  return { apps, isAdmin: false, drives_fotografia };
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
  return {
    apps: dados.apps || [],
    restritos: RESTRICTED_APPS,
    isAdmin: alvoAdmin,
    drives_fotografia: !!dados.drives_fotografia
  };
});

// (admin) Define quais apps restritos um usuário pode ver
exports.setUserAccess = onCall(async (req) => {
  await exigirAdmin(req);
  const { uid, apps, drives_fotografia } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  const limpos = Array.isArray(apps) ? apps.filter(a => RESTRICTED_APPS.includes(a)) : [];
  await db.collection('user_access').doc(uid).set({
    apps: limpos,
    drives_fotografia: !!drives_fotografia,
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

// Gera PDF da ficha a partir dos dados estruturados do Firestore
const LABELS_FICHA = {
  nome:'Nome', cpf:'CPF', cnpj:'CNPJ', rg:'RG', dataNasc:'Data de nascimento',
  estadoCivil:'Estado civil', profissao:'Profissão', renda:'Renda mensal',
  empresa:'Empresa / Empregador', whatsapp:'WhatsApp', email:'E-mail',
  cep:'CEP', logradouro:'Logradouro', numero:'Número', complemento:'Complemento',
  bairro:'Bairro', cidade:'Cidade', estado:'Estado',
  banco:'Banco', tipoConta:'Tipo de conta', agencia:'Agência', conta:'Conta', pix:'Chave Pix',
  razaoSocial:'Razão social', nomeFantasia:'Nome fantasia', inscricaoEstadual:'Insc. estadual',
  nomeRepresentante:'Representante', cpfRepresentante:'CPF do representante',
  nomeFiador:'Nome do fiador', cpfFiador:'CPF do fiador',
  imovel:'Imóvel', valorProposta:'Valor da proposta', formaPagamento:'Forma de pagamento',
  observacoes:'Observações',
};

function gerarPdfFicha(ficha, tipoLabel) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit'); // lazy: só carrega quando gerar PDF
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
        const label = LABELS_FICHA[k] || k;
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
          .text(pendentes.map(p => '• ' + (LABELS_FICHA[p] || p)).join('\n'));
      }

      doc.end();
    } catch (e) { reject(e); }
  });
}

// Busca um arquivo de URL remota como Buffer (limite 8 MB por arquivo)
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
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
    const linhas = [
      ['Tipo', tipoLabel],
      ['Cliente', d.nome || 'Sem nome'],
      ['CPF/CNPJ', d.cpf || d.cnpj || '—'],
      ['WhatsApp', d.whatsapp || '—'],
      ['E-mail', d.email || '—'],
      ['Corretor', ficha.corretorNome || '—'],
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
        const isPdf = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('%2fpdf');
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
      subject: `[Hub] ${tipoLabel} — ${d.nome || 'Nova ficha'} (${ficha.corretorNome || 'corretor'})`,
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

  return { ok: true, uid: user.uid, fazAdmin: !!dadosCodigo.fazAdmin };
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
  const nomesFicha = { pf:'Ficha Pessoa Física', pj:'Ficha Pessoa Jurídica', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta' };
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
  if (!snap.exists) {
    const q = await db.collection('fichas').where('id', '==', fichaId).limit(1).get();
    if (q.empty) throw new HttpsError('not-found', 'Ficha não encontrada.');
    snap = q.docs[0]; await q.docs[0].ref.delete(); return { ok: true };
  }
  await assertDono(snap, req.auth.uid, req.auth.token.admin);
  await ref.delete();
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
  const nomesFicha = { locador:'Ficha do Locador', pf:'Ficha Pessoa Física', pj:'Ficha Pessoa Jurídica', locacao_fiador:'Ficha Locação c/ Fiador', vendedor:'Ficha Vendedor', proposta:'Ficha Proposta' };
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
  const ref = db.collection('fichas').doc(fichaId);
  const snap = await ref.get();
  await assertDono(snap, req.auth.uid, req.auth.token.admin);
  await ref.update({ status: 'finalizado', finalizadoEm: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true };
});
