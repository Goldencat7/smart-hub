/* H-REC AGENDA — Cloud Functions do Bloco 5 (agendamento). Módulo separado do
 * index.js gigante; ligado via `Object.assign(exports, require('./hrec'))` no fim do
 * index.js (depois de admin.initializeApp() e setGlobalOptions).
 *
 * Regras de ouro (MD §3): backend é a fonte de verdade — preço, slot e crédito são
 * RECALCULADOS aqui, nunca confiados no cliente. Escrita nas coleções sensíveis só por
 * aqui (Admin SDK ignora as Security Rules). Motores puros compartilhados vêm da cópia
 * `./hrec-dominio/` (sincronizada de hrec/dominio/ pelo predeploy).
 */
'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore'); // classes estáveis (sem getter lazy)
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const SUPPORT_EMAIL_PASS = defineSecret('SUPPORT_EMAIL_PASS'); // mesmo secret do Hub (idempotente por nome)
const HREC_REMETENTE = 'nathangabriel@remax.com.br';

const Enums = require('./hrec-dominio/enums');
const Datas = require('./hrec-dominio/datas');
const Preco = require('./hrec-dominio/precificacao');
const Disp = require('./hrec-dominio/disponibilidade');

const BS = Enums.BOOKING_STATUS, MS = Enums.MATERIAL_STATUS, PAY = Enums.PAYMENT_STATUS, APROVACAO = Enums.APROVACAO;
const db = () => admin.firestore();
const FV = FieldValue;   // .serverTimestamp()
const TS = Timestamp;    // .now(), .fromMillis()

// ------------------------------------------------------------------ helpers
function _auth(req) { if (!req.auth) throw new HttpsError('unauthenticated', 'Faça login primeiro.'); return req.auth; }
function _papel(req) { const t = (req.auth && req.auth.token) || {}; return { role: t.hrecRole || null, imob: t.hrecImob || null, hubAdmin: t.admin === true }; }
function _staff(p) { return p.role === 'administrador' || p.role === 'fotografo' || p.hubAdmin === true; }
function _txt(v, n) { return typeof v === 'string' ? v.trim().slice(0, n || 200) : ''; }
function _escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _num(v) { const x = Number(v); return isFinite(x) ? x : 0; }
function _agoraSP() { const now = new Date(); return { now, sp: Datas.nowSP(now), ms: now.getTime() }; }

// Exige um dos papéis H-REC (ou Hub admin, que conta como administrador H-REC).
function _exigePapel(req, papeisOk) {
  const p = _papel(req);
  const efetivo = p.hubAdmin ? 'administrador' : p.role;
  if (!efetivo || papeisOk.indexOf(efetivo) < 0) {
    throw new HttpsError('permission-denied', 'Ação não permitida para o seu papel.');
  }
  return Object.assign(p, { efetivo });
}

// Normaliza os extras vindos do cliente: o SERVIDOR decide o status pelo `requerAprovacao`
// do catálogo (fixo/sem aprovação = 'aprovado' automático e entra no total; drone/IA =
// 'aguardando_analise', ficam pendentes até a H-REC aprovar). NUNCA confia no status do
// cliente (senão alguém "auto-aprovaria" um item condicional). Mantém só selecionado+qtd.
function _normalizarExtras(extras, adicionais) {
  const cat = {}; (adicionais || []).forEach(a => { cat[a.id] = a; });
  const out = {};
  Object.keys(extras || {}).forEach(id => {
    const sel = extras[id]; const def = cat[id];
    if (!sel || !sel.selecionado || !def) return;
    out[id] = { selecionado: true, quantidade: Math.max(1, Number(sel.quantidade) || 1),
      status: def.requerAprovacao ? APROVACAO.AGUARDANDO_ANALISE : APROVACAO.APROVADO };
  });
  return out;
}

// Notificação in-app: grava em `hrec_notifs` (o dono lê pela callable). Best-effort.
async function _hrecNotificar(uid, tipo, texto, meta) {
  if (!uid || !texto) return;
  try { await db().collection('hrec_notifs').add({ uid, tipo: _txt(tipo, 30), texto: _txt(texto, 300), meta: meta || null, lida: false, createdAt: FV.serverTimestamp() }); }
  catch (e) { console.warn('_hrecNotificar', (e && e.message) || e); }
}
// E-mail transacional (reusa o transporte Gmail do Hub; secret SUPPORT_EMAIL_PASS). Best-effort.
async function _hrecEmail(to, subject, html) {
  if (!to) return;
  try {
    const tr = nodemailer.createTransport({ service: 'gmail', auth: { user: HREC_REMETENTE, pass: SUPPORT_EMAIL_PASS.value() } });
    await tr.sendMail({ from: `H-REC Agenda <${HREC_REMETENTE}>`, to, subject, html });
  } catch (e) { console.warn('_hrecEmail', (e && e.message) || e); }
}
async function _emailDoUid(uid) { try { const u = await admin.auth().getUser(uid); return u.email || ''; } catch (_e) { return ''; } }

// Carrega catálogo (tabelas + adicionais + config) — leituras baratas e estáveis.
async function _carregarCatalogo() {
  const [pt, sa, cfg] = await Promise.all([
    db().collection('pricingTables').get(),
    db().collection('servicosAdicionais').get(),
    db().collection('config').doc('agenda').get()
  ]);
  const tabelas = {}; pt.forEach(d => { tabelas[d.id] = d.data(); });
  const adicionais = sa.docs.map(d => d.data());
  const config = cfg.exists ? cfg.data() : {};
  return { tabelas, adicionais, config };
}

// ============================================================ claims (papéis)
// Define papel H-REC de um usuário. Só Hub admin ou administrador H-REC. MERGE das
// claims (preserva admin/locRole/etc. — igual ao setUserAccess do Hub).
exports.hrecSetPapel = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const d = req.data || {};
  const uid = _txt(d.uid, 128);
  const role = _txt(d.role, 20);
  const imob = _txt(d.imobiliariaId, 80);
  const PAPEIS = ['corretor', 'avulso', 'broker', 'fotografo', 'administrador'];
  if (!uid) throw new HttpsError('invalid-argument', 'uid é obrigatório.');
  // role vazio = REMOVER acesso H-REC (limpa as claims). Antes o front coagia '' → avulso.
  if (role !== '' && PAPEIS.indexOf(role) < 0) throw new HttpsError('invalid-argument', 'role inválido.');
  if ((role === 'corretor' || role === 'broker') && !imob) throw new HttpsError('invalid-argument', 'corretor/broker exige imobiliariaId.');
  const user = await admin.auth().getUser(uid);
  const claims = Object.assign({}, user.customClaims || {}, { hrecRole: role || null, hrecImob: (role ? imob : '') || null });
  await admin.auth().setCustomUserClaims(uid, claims);
  return { ok: true, uid, role: role || null, imobiliariaId: (role ? imob : '') || null };
});

// Lista usuários (auth) com o papel H-REC atual — pra tela de atribuição no Admin.
exports.hrecUsuariosListar = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const out = [];
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    res.users.forEach(u => {
      const c = u.customClaims || {};
      out.push({ uid: u.uid, email: u.email || '', nome: u.displayName || '', hrecRole: c.hrecRole || null, hrecImob: c.hrecImob || null });
    });
    pageToken = res.pageToken;
  } while (pageToken);
  out.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  return { ok: true, usuarios: out };
});

// Lista imobiliárias (staff/admin) — pra popular o select de atribuição.
exports.hrecImobiliariasListar = onCall(async (req) => {
  _exigePapel(req, ['administrador', 'fotografo']);
  const snap = await db().collection('imobiliarias').get();
  return { ok: true, imobiliarias: snap.docs.map(d => Object.assign({ id: d.id }, d.data())) };
});

// Cria/edita uma imobiliária (só administrador). id opcional (gera se faltar).
exports.hrecImobiliariaSalvar = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const d = req.data || {};
  const nome = _txt(d.nome, 160);
  if (!nome) throw new HttpsError('invalid-argument', 'nome é obrigatório.');
  const tipo = (d.tipo === 'parceria') ? 'parceria' : 'avulso';
  const pricingTableId = _txt(d.pricingTableId, 80) || (tipo === 'parceria' ? 'remax_empire' : 'padrao_hrec');
  const ref = d.id ? db().collection('imobiliarias').doc(_txt(d.id, 80)) : db().collection('imobiliarias').doc();
  await ref.set({
    nome, cnpj: _txt(d.cnpj, 30), creci: _txt(d.creci, 30), responsavel: _txt(d.responsavel, 160),
    email: _txt(d.email, 160), whatsapp: _txt(d.whatsapp, 40), endereco: _txt(d.endereco, 300),
    tipo, pricingTableId, ativa: d.ativa !== false, updatedAt: FV.serverTimestamp()
  }, { merge: true });
  return { ok: true, id: ref.id };
});

// ============================================================ catálogo (cliente)
// Devolve tabelas/adicionais/config pro wizard montar preço. Qualquer logado.
exports.hrecCatalogo = onCall(async (req) => {
  _auth(req);
  const { tabelas, adicionais, config } = await _carregarCatalogo();
  // Resolve a tabela do próprio usuário (pra preview de preço no cliente): imob da claim.
  const p = _papel(req);
  let minhaTabelaId = 'padrao_hrec', minhaImob = null;
  if (p.imob) {
    const im = await db().collection('imobiliarias').doc(p.imob).get();
    if (im.exists) { minhaImob = Object.assign({ id: im.id }, im.data()); if (tabelas[minhaImob.pricingTableId]) minhaTabelaId = minhaImob.pricingTableId; }
  }
  return { ok: true, tabelas, adicionais, config, minhaTabelaId, minhaImob, papel: p.role || (p.hubAdmin ? 'administrador' : null) };
});

// ============================================================ disponibilidade
// Disponibilidade do MÊS, calculada no SERVIDOR (não vaza PII de bookings — devolve só
// status/slots). Duração vem do preço (metragem + extras) → tempo presencial + buffer.
exports.hrecDisponibilidadeMes = onCall(async (req) => {
  _auth(req);
  const d = req.data || {};
  const ano = _num(d.ano), mes = _num(d.mes);
  if (ano < 2020 || mes < 1 || mes > 12) throw new HttpsError('invalid-argument', 'ano/mes inválidos.');
  const { tabelas, adicionais, config } = await _carregarCatalogo();
  const p = _papel(req);
  const imobId = _txt(d.imobiliariaId, 80) || p.imob;
  let tabela = null;
  if (imobId) { const im = await db().collection('imobiliarias').doc(imobId).get(); if (im.exists) tabela = tabelas[im.data().pricingTableId]; }
  tabela = tabela || tabelas['padrao_hrec'];
  const extrasN = _normalizarExtras(d.extras, adicionais);
  const calc = Preco.calcular({ metragem: _num(d.metragem), tabela, catalogoAdicionais: adicionais, extras: extrasN });
  const durPresencial = calc.tempoPresencial || 60;   // usado pra ENCAIXAR o slot (buffer entra na colisão)
  const durMin = Preco.tempoOperacional(calc.tempoPresencial || 0, _num(config.travelBufferMinutes)) || 60; // só pro banner "tempo previsto"

  // bookings do mês (uma query) — sem devolver PII.
  const primeiro = ano + '-' + String(mes).padStart(2, '0') + '-01';
  const ultimo = ano + '-' + String(mes).padStart(2, '0') + '-' + String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0');
  const snap = await db().collection('bookings')
    .where('schedule.dateISO', '>=', primeiro).where('schedule.dateISO', '<=', ultimo).get();
  const bookings = snap.docs.map(x => x.data());
  const bloq = await db().collection('blockedDates').get();
  const blockedDates = bloq.docs.map(x => x.id);

  const a = _agoraSP();
  const mapa = Disp.getMonthAvailability(bookings, ano, mes, durPresencial, config, { now: a.now, nowSP: a.sp, blockedDates });
  const dias = {};
  mapa.forEach((v, iso) => { dias[iso] = { status: v.status, slots: v.slots.map(s => s.hhmm) }; });
  return { ok: true, durMin, calc: { valorBase: calc.valorBase, totalConfirmado: calc.totalConfirmado, sobConsulta: calc.sobConsulta, faixaNome: calc.faixaNome, tempoPresencial: calc.tempoPresencial }, dias };
});

// ============================================================ criar booking
// Transação: revalida slot (SLOT_TAKEN) → recalcula preço no servidor → código
// sequencial → reserva crédito (pacote) OU cria Pix (avulso) → grava booking.
exports.hrecCriarBooking = onCall(async (req) => {
  const p = _exigePapel(req, ['corretor', 'avulso', 'administrador']);
  const d = req.data || {};
  const dateISO = _txt(d.dateISO, 10);
  const startAt = _txt(d.startAt, 5);
  const metragem = _num((d.property || {}).metragem);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{2}:\d{2}$/.test(startAt)) throw new HttpsError('invalid-argument', 'data/hora inválidas.');
  if (metragem <= 0) throw new HttpsError('invalid-argument', 'metragem é obrigatória.');

  // Imobiliária: corretor/avulso usa a própria (claim); administrador pode indicar uma.
  const imobId = p.efetivo === 'administrador' ? (_txt(d.imobiliariaId, 80) || p.imob) : p.imob;
  if (!imobId) throw new HttpsError('failed-precondition', 'Sem imobiliária no seu perfil.');

  const { tabelas, adicionais, config } = await _carregarCatalogo();
  const imobSnap = await db().collection('imobiliarias').doc(imobId).get();
  if (!imobSnap.exists) throw new HttpsError('not-found', 'Imobiliária não encontrada.');
  const imob = imobSnap.data();
  const tabela = tabelas[imob.pricingTableId] || tabelas['padrao_hrec'];
  if (!tabela) throw new HttpsError('failed-precondition', 'Sem tabela de preço.');

  const extrasN = _normalizarExtras(d.extras, adicionais);
  const calc = Preco.calcular({ metragem, tabela, catalogoAdicionais: adicionais, extras: extrasN });
  if (calc.erro) throw new HttpsError('failed-precondition', 'Não deu pra precificar: ' + calc.erro);
  if (calc.sobConsulta) throw new HttpsError('failed-precondition', 'Metragem exige orçamento (use Solicitar orçamento).');

  const buffer = _num(config.travelBufferMinutes);
  const durPresencial = calc.tempoPresencial || 0;
  const startMin = Datas.hhmm2min(startAt);
  const ehPacote = imob.tipo === 'parceria';
  const valorBaseFinal = calc.valorBase || 0;
  // Cobra/reserva o total CONFIRMADO (base + adicionais fixos auto-aprovados); os que
  // requerem aprovação ficam pendentes e são cobrados depois (approveDrone/setAIValue).
  const valorCobrar = calc.totalConfirmado || valorBaseFinal;

  const a = _agoraSP();
  const bloqSnap = await db().collection('blockedDates').doc(dateISO).get();
  const blockedDates = bloqSnap.exists ? [dateISO] : [];

  const bookingRef = db().collection('bookings').doc();
  const counterRef = db().collection('hrec_counters').doc('bookings');
  const creditRef = db().collection('credits').doc(imobId);

  let codigo, status, holdExpiresAt = null, paymentRef = null;

  await db().runTransaction(async (tx) => {
    // 1) Revalida o slot com os bookings FRESCOS do dia (query dentro da transação:
    //    se um concorrente inserir no mesmo dia, a tx re-executa e vê — SLOT_TAKEN).
    const daySnap = await tx.get(db().collection('bookings').where('schedule.dateISO', '==', dateISO));
    const doDia = daySnap.docs.map(x => x.data());
    const occ = Disp.getDayOccupancy(doDia, dateISO, { nowMs: a.ms });
    const slots = Disp.getAvailableSlots(occ, dateISO, durPresencial, config, { now: a.now, nowSP: a.sp, blockedDates, ativosNoDia: occ.length });
    if (!slots.some(s => s.inicio === startMin)) {
      throw new HttpsError('failed-precondition', 'SLOT_TAKEN: esse horário não está mais disponível.');
    }

    // 2) Código sequencial HREC-AAAA-NNNNN (reinicia a cada ano).
    const ano = a.sp.iso.slice(0, 4);
    const cSnap = await tx.get(counterRef);
    const cur = cSnap.exists ? cSnap.data() : { ano: ano, seq: 0 };
    const seq = (cur.ano === ano ? cur.seq : 0) + 1;
    codigo = 'HREC-' + ano + '-' + String(seq).padStart(5, '0');

    // 3) Pacote → reserva crédito (nunca deixa `disponivel` negativo); avulso → Pix + hold.
    if (ehPacote) {
      const crSnap = await tx.get(creditRef);
      const cr = crSnap.exists ? crSnap.data() : { contratado: 0, disponivel: 0, reservado: 0, consumido: 0, estornado: 0 };
      if ((cr.disponivel || 0) < valorCobrar) throw new HttpsError('resource-exhausted', 'Créditos insuficientes na imobiliária.');
      tx.set(creditRef, { disponivel: (cr.disponivel || 0) - valorCobrar, reservado: (cr.reservado || 0) + valorCobrar, updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.set(db().collection('creditMovements').doc(), { imobiliariaId: imobId, tipo: 'Reserva', descricao: 'Reserva do agendamento', ref: codigo, valor: valorCobrar, sinal: '-', usuario: req.auth.uid, createdAt: FV.serverTimestamp() });
      status = BS.CONFIRMADO;
    } else {
      status = BS.AGUARDANDO_PAGAMENTO;
      holdExpiresAt = TS.fromMillis(a.ms + (_num(config.holdMinutos) || 30) * 60000);
      paymentRef = db().collection('payments').doc();
      tx.set(paymentRef, {
        id: paymentRef.id, tipo: 'servico', bookingId: bookingRef.id, imobiliariaId: imobId,
        amount: valorCobrar, status: PAY.PENDING_CONFIRMATION, chavePix: (config.chavePix || ''),
        requestedAt: FV.serverTimestamp(), expiresAt: holdExpiresAt
      });
    }

    // 4) Contador + booking.
    tx.set(counterRef, { ano: ano, seq: seq, updatedAt: FV.serverTimestamp() }, { merge: true });
    tx.set(bookingRef, {
      bookingId: bookingRef.id, codigo, imobiliariaId: imobId, corretorId: req.auth.uid, fotografoId: null, status,
      property: {
        endereco: _txt((d.property || {}).endereco, 300), bairro: _txt((d.property || {}).bairro, 120),
        metragem, quartos: _txt((d.property || {}).quartos, 20) || null,
        situacao: _txt((d.property || {}).situacao, 40) || 'desocupado',
        energia: _txt((d.property || {}).energia, 10) || 'sim',
        acesso: _txt((d.property || {}).acesso, 40) || 'corretor_no_local',
        responsavel: _txt((d.property || {}).responsavel, 160), responsavelTelefone: _txt((d.property || {}).responsavelTelefone, 40),
        observacoes: _txt((d.property || {}).observacoes, 1000)
      },
      service: { faixaId: calc.faixaId, faixaNome: calc.faixaNome, formatoVideoCru: _txt((d.service || {}).formatoVideoCru, 12) || null, fotosAproximadas: null, tempoBaseMinutos: durPresencial },
      extras: extrasN,
      itensPendentes: calc.itensPendentes || [],
      schedule: { dateISO, startAt, endAt: Datas.min2hhmm(startMin + durPresencial), durationMinutes: durPresencial, travelBufferMinutes: buffer, googleCalendarEventId: null, calendarId: null },
      financial: {
        tipo: ehPacote ? 'pacote' : 'avulso', pricingTableId: tabela.id, pricingTableName: tabela.nome,
        valorReferencia: calc.valorReferencia, descontoPercentual: tabela.descontoPercentual || 0, desconto: calc.descontoBase || 0,
        valorBaseFinal, adicionaisConfirmados: calc.totalConfirmado - valorBaseFinal, adicionaisPendentes: (calc.itensPendentes || []).length,
        valorTotalConfirmado: calc.totalConfirmado, creditosReservados: ehPacote ? valorCobrar : 0, creditosConsumidos: false,
        pricingSnapshot: tabela
      },
      material: { status: MS.AGUARDANDO_SESSAO, driveUrl: null, notes: '', deliveredAt: null, deliveredBy: null, history: [] },
      holdExpiresAt, payment: paymentRef ? { id: paymentRef.id, status: PAY.PENDING_CONFIRMATION } : null,
      history: [{ action: 'criado', actor: req.auth.uid, at: TS.fromMillis(a.ms) }],
      createdAt: FV.serverTimestamp(), createdBy: req.auth.uid, updatedAt: FV.serverTimestamp()
    });
  });

  return { ok: true, bookingId: bookingRef.id, codigo, status };
});

// ============================================================ cancelar booking
// Corretor (só o próprio), broker (da imob), administrador. Estorna crédito SE havia
// reserva. (Remoção do evento do Calendar entra junto do Bloco 5.5/8.)
exports.hrecCancelarBooking = onCall(async (req) => {
  const p = _exigePapel(req, ['corretor', 'broker', 'administrador']);
  const bookingId = _txt((req.data || {}).bookingId, 128);
  const motivo = _txt((req.data || {}).motivo, 300);
  if (!bookingId) throw new HttpsError('invalid-argument', 'bookingId é obrigatório.');
  const ref = db().collection('bookings').doc(bookingId);

  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Agendamento não encontrado.');
    const b = s.data();
    // Permissão de posse.
    const dono = b.corretorId === req.auth.uid;
    const brokerDaImob = p.efetivo === 'broker' && p.imob === b.imobiliariaId;
    if (!dono && !brokerDaImob && p.efetivo !== 'administrador') throw new HttpsError('permission-denied', 'Sem permissão para cancelar este agendamento.');
    // Não cancela encerrado nem depois da captação concluída (serviço já executado). (BUG5)
    if ([BS.CANCELADO, BS.NAO_REALIZADO, BS.MATERIAL_ENTREGUE, BS.CAPTACAO_CONCLUIDA, BS.EM_TRATAMENTO].indexOf(b.status) >= 0) throw new HttpsError('failed-precondition', 'Este agendamento não pode ser cancelado (serviço já em andamento/concluído).');

    // Estorna crédito SÓ se havia reserva (não consumida) — booking avulso (Pix) não estorna crédito.
    const reserva = _num((b.financial || {}).creditosReservados);
    if (reserva > 0 && !(b.financial || {}).creditosConsumidos) {
      const creditRef = db().collection('credits').doc(b.imobiliariaId);
      const cr = (await tx.get(creditRef)).data() || { disponivel: 0, reservado: 0, estornado: 0 };
      tx.set(creditRef, { reservado: Math.max(0, (cr.reservado || 0) - reserva), disponivel: (cr.disponivel || 0) + reserva, estornado: (cr.estornado || 0) + reserva, updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.set(db().collection('creditMovements').doc(), { imobiliariaId: b.imobiliariaId, tipo: 'Estorno', descricao: 'Cancelamento ' + b.codigo, ref: b.codigo, valor: reserva, sinal: '+', usuario: req.auth.uid, createdAt: FV.serverTimestamp() });
    }
    const hist = Array.isArray(b.history) ? b.history.slice(-50) : [];
    hist.push({ action: 'cancelado', actor: req.auth.uid, metadata: { motivo }, at: TS.now() });
    tx.set(ref, { status: BS.CANCELADO, holdExpiresAt: null, financial: Object.assign({}, b.financial, { creditosReservados: 0 }), history: hist, updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid }, { merge: true });
  });
  return { ok: true, tipoEstorno: 'ver_financial' };
});

// ============================================================ meus agendamentos
function _toMs(ts) { return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : null); }
function _bookingResumo(b) {
  return {
    bookingId: b.bookingId, codigo: b.codigo, status: b.status, corretorId: b.corretorId, imobiliariaId: b.imobiliariaId,
    endereco: (b.property || {}).endereco || '', metragem: (b.property || {}).metragem || null,
    dateISO: (b.schedule || {}).dateISO || null, startAt: (b.schedule || {}).startAt || null,
    valorTotal: (b.financial || {}).valorTotalConfirmado || 0, tipoFinanceiro: (b.financial || {}).tipo || null,
    materialStatus: (b.material || {}).status || null, createdAtMs: _toMs(b.createdAt)
  };
}
function _bookingSerial(b) {
  const out = Object.assign({}, b);
  out.createdAtMs = _toMs(b.createdAt); out.updatedAtMs = _toMs(b.updatedAt); out.holdExpiresAtMs = _toMs(b.holdExpiresAt);
  out.history = (Array.isArray(b.history) ? b.history : []).map(h => Object.assign({}, h, { atMs: _toMs(h.at) }));
  delete out.createdAt; delete out.updatedAt; delete out.holdExpiresAt;
  return out;
}
function _posseBooking(b, req, p) {
  return b.corretorId === req.auth.uid || _staff(p) || (p.efetivo === 'broker' && p.imob === b.imobiliariaId);
}

// Lista os agendamentos do escopo do usuário (corretor: os seus; broker: da imobiliária;
// staff H-REC: todos). Ordena por criação desc no cliente (sem índice composto).
exports.hrecListarBookings = onCall(async (req) => {
  const p = _exigePapel(req, ['corretor', 'avulso', 'broker', 'fotografo', 'administrador']);
  let q = db().collection('bookings');
  if (_staff(p)) { /* tudo */ }
  else if (p.efetivo === 'broker') q = q.where('imobiliariaId', '==', p.imob || '__none__');
  else q = q.where('corretorId', '==', req.auth.uid);
  const snap = await q.limit(500).get();
  const bookings = snap.docs.map(d => _bookingResumo(d.data())).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return { ok: true, bookings };
});

// Detalhe de um agendamento (posse: dono/broker/staff), com histórico serializado.
exports.hrecBookingObter = onCall(async (req) => {
  const p = _exigePapel(req, ['corretor', 'avulso', 'broker', 'fotografo', 'administrador']);
  const id = _txt((req.data || {}).bookingId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'bookingId é obrigatório.');
  const s = await db().collection('bookings').doc(id).get();
  if (!s.exists) throw new HttpsError('not-found', 'Agendamento não encontrado.');
  const b = s.data();
  if (!_posseBooking(b, req, p)) throw new HttpsError('permission-denied', 'Sem acesso a este agendamento.');
  return { ok: true, booking: _bookingSerial(b) };
});

// ============================================================ operação (fotógrafo)
// Agenda de um dia (staff H-REC): todos os agendamentos do dia, com o que a operação precisa.
exports.hrecAgendaDia = onCall(async (req) => {
  _exigePapel(req, ['fotografo', 'administrador']);
  const dateISO = _txt((req.data || {}).dateISO, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new HttpsError('invalid-argument', 'dateISO inválido.');
  const snap = await db().collection('bookings').where('schedule.dateISO', '==', dateISO).get();
  const itens = snap.docs.map(d => {
    const b = d.data();
    return Object.assign(_bookingResumo(b), {
      fotografoId: b.fotografoId || null, inicioRealMs: _toMs(b.inicioReal), fimRealMs: _toMs(b.fimReal),
      driveUrl: (b.material || {}).driveUrl || null, itensPendentes: b.itensPendentes || [],
      startAtMin: Datas.hhmm2min((b.schedule || {}).startAt || '00:00')
    });
  }).sort((a, b) => a.startAtMin - b.startAtMin);
  return { ok: true, dateISO, itens };
});

// Guardas comuns das ações de operação: staff, booking existe, retorna ref+dados.
async function _opBooking(req, bookingId) {
  _exigePapel(req, ['fotografo', 'administrador']);
  const id = _txt(bookingId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'bookingId é obrigatório.');
  const ref = db().collection('bookings').doc(id);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Agendamento não encontrado.');
  return { ref, b: s.data() };
}
function _histPush(b, action, actor, meta) {
  const h = Array.isArray(b.history) ? b.history.slice(-80) : [];
  h.push(Object.assign({ action, actor, at: TS.now() }, meta ? { metadata: meta } : {}));
  return h;
}

// Iniciar serviço: confirmado → servico_iniciado (material em captação).
exports.hrecIniciarServico = onCall(async (req) => {
  const { ref, b } = await _opBooking(req, (req.data || {}).bookingId);
  if (b.status !== BS.CONFIRMADO) throw new HttpsError('failed-precondition', 'Só dá pra iniciar um agendamento confirmado.');
  await ref.set({
    status: BS.SERVICO_INICIADO, fotografoId: req.auth.uid, inicioReal: TS.now(),
    material: Object.assign({}, b.material, { status: MS.EM_CAPTACAO }),
    history: _histPush(b, 'servico_iniciado', req.auth.uid), updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
  }, { merge: true });
  return { ok: true, status: BS.SERVICO_INICIADO };
});

// Concluir captação: servico_iniciado → captacao_concluida. CONSOME os créditos reservados
// (pacote): reservado -= v ; consumido += v (transação; creditMovements 'Consumo').
exports.hrecConcluirServico = onCall(async (req) => {
  const id = _txt((req.data || {}).bookingId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'bookingId é obrigatório.');
  const ref = db().collection('bookings').doc(id);
  let novoStatus;
  await db().runTransaction(async (tx) => {
    _exigePapel(req, ['fotografo', 'administrador']);
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Agendamento não encontrado.');
    const b = s.data();
    if (b.status !== BS.SERVICO_INICIADO) throw new HttpsError('failed-precondition', 'O serviço precisa estar iniciado.');
    const reserva = _num((b.financial || {}).creditosReservados);
    if (reserva > 0 && !(b.financial || {}).creditosConsumidos && b.financial.tipo === 'pacote') {
      const creditRef = db().collection('credits').doc(b.imobiliariaId);
      const cr = (await tx.get(creditRef)).data() || { reservado: 0, consumido: 0 };
      tx.set(creditRef, { reservado: Math.max(0, (cr.reservado || 0) - reserva), consumido: (cr.consumido || 0) + reserva, updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.set(db().collection('creditMovements').doc(), { imobiliariaId: b.imobiliariaId, tipo: 'Consumo', descricao: 'Serviço concluído ' + b.codigo, ref: b.codigo, valor: reserva, sinal: '-', usuario: req.auth.uid, createdAt: FV.serverTimestamp() });
    }
    novoStatus = BS.CAPTACAO_CONCLUIDA;
    tx.set(ref, {
      status: novoStatus, fimReal: TS.now(),
      material: Object.assign({}, b.material, { status: MS.EM_TRATAMENTO }),
      financial: Object.assign({}, b.financial, { creditosConsumidos: true }),
      history: _histPush(b, 'captacao_concluida', req.auth.uid), updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
    }, { merge: true });
  });
  return { ok: true, status: novoStatus };
});

// Entregar material: valida a URL, grava o link + histórico de troca, status material_entregue.
exports.hrecEntregarMaterial = onCall({ secrets: [SUPPORT_EMAIL_PASS] }, async (req) => {
  const { ref, b } = await _opBooking(req, (req.data || {}).bookingId);
  const url = _txt((req.data || {}).driveUrl, 500);
  const notes = _txt((req.data || {}).notes, 500);
  if (!/^https:\/\/.+/i.test(url)) throw new HttpsError('invalid-argument', 'Informe uma URL https válida (link do material).');
  if ([BS.CAPTACAO_CONCLUIDA, BS.EM_TRATAMENTO, BS.MATERIAL_ENTREGUE].indexOf(b.status) < 0) throw new HttpsError('failed-precondition', 'Conclua a captação antes de entregar o material.');
  const mat = b.material || {};
  const historyLink = Array.isArray(mat.history) ? mat.history.slice(-30) : [];
  if (mat.driveUrl && mat.driveUrl !== url) historyLink.push({ oldUrl: mat.driveUrl, newUrl: url, changedAt: TS.now(), changedBy: req.auth.uid });
  await ref.set({
    status: BS.MATERIAL_ENTREGUE,
    material: Object.assign({}, mat, { status: MS.DISPONIVEL, driveUrl: url, notes, deliveredAt: TS.now(), deliveredBy: req.auth.uid, history: historyLink }),
    history: _histPush(b, 'material_entregue', req.auth.uid), updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
  }, { merge: true });
  // Avisa o corretor: notificação in-app + e-mail (best-effort).
  await _hrecNotificar(b.corretorId, 'material', 'Material do ' + b.codigo + ' está pronto — ' + ((b.property || {}).endereco || 'imóvel') + '.', { bookingId: b.bookingId, driveUrl: url });
  const email = await _emailDoUid(b.corretorId);
  await _hrecEmail(email, 'H-REC — Material pronto (' + _escHtml(b.codigo) + ')', '<p>O material de fotografia do agendamento <b>' + _escHtml(b.codigo) + '</b> (' + _escHtml((b.property || {}).endereco || '') + ') está pronto.</p><p><a href="' + _escHtml(url) + '">Abrir material</a></p>');
  return { ok: true, status: BS.MATERIAL_ENTREGUE };
});

// Aprova/reprova um extra que requer aprovação (drone/IA), recalculando o total e cobrando
// a DIFERENÇA (pacote reserva; avulso gera Pix complementar em pagamentosAdicionais).
// Valor CONFIRMADO de um extra (o quanto ele soma ao total quando aprovado+pago).
function _valorExtra(extraId, extrasBase, tabela, adicionais, metragem) {
  const com = Object.assign({}, extrasBase, { [extraId]: Object.assign({}, extrasBase[extraId], { status: APROVACAO.APROVADO, paymentStatus: null }) });
  const sem = Object.assign({}, extrasBase, { [extraId]: Object.assign({}, extrasBase[extraId], { status: APROVACAO.REPROVADO }) });
  const vc = Preco.calcular({ metragem, tabela, catalogoAdicionais: adicionais, extras: com }).totalConfirmado || 0;
  const vs = Preco.calcular({ metragem, tabela, catalogoAdicionais: adicionais, extras: sem }).totalConfirmado || 0;
  return vc - vs;
}
// Estados ENCERRADOS/mortos onde NÃO se mexe mais em adicionais (BUG1). Aguardando
// pagamento/confirmado/em execução seguem editáveis.
const _ENCERRADO_EXTRA = [BS.CANCELADO, BS.NAO_REALIZADO, BS.MATERIAL_ENTREGUE, BS.PAGAMENTO_EXPIRADO];

async function _decidirExtra(req, extraId, decisao, valorDef) {
  _exigePapel(req, ['fotografo', 'administrador']);   // gate ANTES de qualquer leitura (L3)
  const id = _txt((req.data || {}).bookingId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'bookingId é obrigatório.');
  const ref = db().collection('bookings').doc(id);
  const { adicionais } = await _carregarCatalogo();
  let resultado;
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Agendamento não encontrado.');
    const b = s.data();
    if (_ENCERRADO_EXTRA.indexOf(b.status) >= 0) throw new HttpsError('failed-precondition', 'Agendamento encerrado — não dá pra mexer nos adicionais.'); // BUG1
    const extras = Object.assign({}, b.extras || {});
    const sel = extras[extraId];
    if (!sel || !sel.selecionado) throw new HttpsError('failed-precondition', 'Este adicional não está no agendamento.');
    const tabela = (b.financial || {}).pricingSnapshot;
    if (!tabela) throw new HttpsError('failed-precondition', 'Snapshot de preço ausente.');
    const metragem = _num((b.property || {}).metragem);
    const ehPacote = b.financial.tipo === 'pacote';
    const estavaAprovado = sel.status === APROVACAO.APROVADO;
    const valorEx = _valorExtra(extraId, extras, tabela, adicionais, metragem);

    let deltaCredito = 0, novoPay = null, cobranca = null;
    if (decisao === 'reprovado') {
      extras[extraId] = Object.assign({}, sel, { status: APROVACAO.REPROVADO });
      if (estavaAprovado && ehPacote) deltaCredito = -valorEx;   // BUG2: libera a reserva do extra
    } else {
      const upd = Object.assign({}, sel, { status: APROVACAO.APROVADO }, (valorDef != null ? { valorDefinido: _num(valorDef) } : {}));
      if (ehPacote) { upd.paymentStatus = PAY.PAID; deltaCredito = estavaAprovado ? 0 : valorEx; }   // pacote: reserva e conta
      else { upd.paymentStatus = PAY.PENDING_CONFIRMATION; }   // BUG3 avulso: NÃO conta até o Pix ser confirmado
      extras[extraId] = upd;
    }

    // Crédito (pacote): reserva (deltaCredito>0) ou estorna (deltaCredito<0).
    if (deltaCredito !== 0) {
      const creditRef = db().collection('credits').doc(b.imobiliariaId);
      const cr = (await tx.get(creditRef)).data() || { disponivel: 0, reservado: 0, estornado: 0 };
      if (deltaCredito > 0 && (cr.disponivel || 0) < deltaCredito) throw new HttpsError('resource-exhausted', 'Créditos insuficientes para o adicional.');
      const abs = Math.abs(deltaCredito);
      tx.set(creditRef, deltaCredito > 0
        ? { disponivel: (cr.disponivel || 0) - abs, reservado: (cr.reservado || 0) + abs, updatedAt: FV.serverTimestamp() }
        : { disponivel: (cr.disponivel || 0) + abs, reservado: Math.max(0, (cr.reservado || 0) - abs), estornado: (cr.estornado || 0) + abs, updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.set(db().collection('creditMovements').doc(), { imobiliariaId: b.imobiliariaId, tipo: deltaCredito > 0 ? 'Reserva' : 'Estorno', descricao: 'Adicional ' + extraId + ' ' + b.codigo, ref: b.codigo, valor: abs, sinal: deltaCredito > 0 ? '-' : '+', usuario: req.auth.uid, createdAt: FV.serverTimestamp() });
    }
    // Avulso aprovar: gera Pix complementar do valor do extra (com extraId pra casar na confirmação).
    if (decisao !== 'reprovado' && !ehPacote && valorEx > 0) {
      const payRef = db().collection('payments').doc();
      tx.set(payRef, { id: payRef.id, tipo: 'adicional', bookingId: id, extraId, imobiliariaId: b.imobiliariaId, amount: valorEx, status: PAY.PENDING_CONFIRMATION, requestedAt: FV.serverTimestamp() });
      cobranca = { tipo: 'pix', valor: valorEx, paymentId: payRef.id };
      novoPay = { id: payRef.id, extraId, amount: valorEx, status: PAY.PENDING_CONFIRMATION };
    }
    // Avulso reprovar: cancela um Pix pendente daquele extra (se houver).
    let pagAd = b.pagamentosAdicionais || [];
    if (decisao === 'reprovado' && !ehPacote) pagAd = pagAd.map(x => (x.extraId === extraId && x.status === PAY.PENDING_CONFIRMATION) ? Object.assign({}, x, { status: PAY.CANCELLED }) : x);
    if (novoPay) pagAd = [...pagAd, novoPay];

    const calc = Preco.calcular({ metragem, tabela, catalogoAdicionais: adicionais, extras });
    const fin = Object.assign({}, b.financial, {
      valorTotalConfirmado: calc.totalConfirmado,
      adicionaisConfirmados: (calc.totalConfirmado || 0) - _num(b.financial.valorBaseFinal),
      adicionaisPendentes: (calc.itensPendentes || []).length,
      creditosReservados: _num(b.financial.creditosReservados) + (ehPacote ? deltaCredito : 0)
    });
    tx.set(ref, {
      extras, itensPendentes: calc.itensPendentes || [], financial: fin, pagamentosAdicionais: pagAd,
      history: _histPush(b, decisao === 'reprovado' ? 'extra_reprovado' : 'extra_aprovado', req.auth.uid, { extra: extraId, valor: valorEx }),
      updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
    }, { merge: true });
    resultado = { total: calc.totalConfirmado, delta: cobranca ? cobranca.valor : (deltaCredito || 0), cobranca, corretorId: b.corretorId, codigo: b.codigo, valorEx };
  });
  const rot = extraId === 'drone' ? 'Drone' : (extraId === 'video_ia' ? 'Vídeo IA' : extraId);
  await _hrecNotificar(resultado.corretorId, 'adicional', rot + ' do ' + resultado.codigo + ' foi ' + (decisao === 'reprovado' ? 'reprovado' : 'aprovado') + (decisao !== 'reprovado' && resultado.valorEx > 0 ? ' (+' + resultado.valorEx.toFixed(2) + ')' : '') + '.', { codigo: resultado.codigo });
  return Object.assign({ ok: true }, { total: resultado.total, delta: resultado.delta, cobranca: resultado.cobranca });
}
exports.hrecAprovarDrone = onCall((req) => _decidirExtra(req, 'drone', 'aprovado', (req.data || {}).valor));
exports.hrecReprovarDrone = onCall((req) => _decidirExtra(req, 'drone', 'reprovado'));
exports.hrecDefinirValorIA = onCall((req) => {
  const v = _num((req.data || {}).valor);
  if (v <= 0) throw new HttpsError('invalid-argument', 'Informe o valor do vídeo IA.');
  return _decidirExtra(req, 'video_ia', 'aprovado', v);
});

// ============================================================ Pix (BR Code) + pagamentos
// Gera o "copia e cola" do Pix (padrão EMV BR Code) com CRC16-CCITT. Estático ou com valor.
function _emv(id, val) { const s = String(val); return id + String(s.length).padStart(2, '0') + s; }
function _crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) { crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1); crc &= 0xFFFF; }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function _sanBR(s, n) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, n); }
function _brCodePix(opts) {
  const chave = _txt(opts.chave, 77);
  if (!chave) return '';
  const mai = _emv('26', _emv('00', 'br.gov.bcb.pix') + _emv('01', chave));
  const add = _emv('62', _emv('05', (_txt(opts.txid, 25) || '***')));
  const valor = opts.valor ? _emv('54', Number(opts.valor).toFixed(2)) : '';
  const semCRC = _emv('00', '01') + mai + _emv('52', '0000') + _emv('53', '986') + valor +
    _emv('58', 'BR') + _emv('59', _sanBR(opts.nome || 'RECEBEDOR', 25)) + _emv('60', _sanBR(opts.cidade || 'SAO PAULO', 15)) + add + '6304';
  return semCRC + _crc16(semCRC);
}

// Revalida o slot de um booking (exclui ele mesmo). Lança SLOT_TAKEN se ocupado.
function _revalidarSlot(bookingsDoDia, b, config, ag) {
  const occ = Disp.getDayOccupancy(bookingsDoDia, b.schedule.dateISO, { nowMs: ag.ms, ignoreCode: b.codigo });
  // BUG4: passar a duração PRESENCIAL — o buffer de deslocamento é aplicado dos dois lados
  // DENTRO da colisão do motor. Passar operacional (presencial+buffer) duplicaria o buffer.
  const dur = _num(b.schedule.durationMinutes);
  const slots = Disp.getAvailableSlots(occ, b.schedule.dateISO, dur, config, { now: ag.now, nowSP: ag.sp, ativosNoDia: occ.length });
  if (!slots.some(s => s.inicio === Datas.hhmm2min(b.schedule.startAt))) throw new HttpsError('failed-precondition', 'SLOT_TAKEN: o horário foi ocupado; reagende o cliente.');
}

// Confirma um pagamento (serviço avulso ou adicional). SÓ administrador. Revalida o slot,
// marca paid, confirma o booking e limpa o hold. (Calendar entra junto quando ligarmos.)
exports.hrecConfirmarPagamento = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const payId = _txt((req.data || {}).paymentId, 128);
  if (!payId) throw new HttpsError('invalid-argument', 'paymentId é obrigatório.');
  const { config, adicionais } = await _carregarCatalogo();
  const ag = _agoraSP();
  const payRef = db().collection('payments').doc(payId);
  let out = {};
  await db().runTransaction(async (tx) => {
    const ps = await tx.get(payRef);
    if (!ps.exists) throw new HttpsError('not-found', 'Pagamento não encontrado.');
    const pay = ps.data();
    if (pay.status !== PAY.PENDING_CONFIRMATION) throw new HttpsError('failed-precondition', 'Este pagamento não está pendente.');
    if (pay.tipo === 'credito') throw new HttpsError('failed-precondition', 'Use Confirmar compra de crédito.');
    const bRef = db().collection('bookings').doc(pay.bookingId);
    const bs = await tx.get(bRef);
    if (!bs.exists) throw new HttpsError('not-found', 'Agendamento do pagamento não existe.');
    const b = bs.data();
    if (pay.tipo === 'servico') {
      const daySnap = await tx.get(db().collection('bookings').where('schedule.dateISO', '==', b.schedule.dateISO));
      _revalidarSlot(daySnap.docs.map(d => d.data()), b, config, ag);
      tx.set(bRef, { status: BS.CONFIRMADO, holdExpiresAt: null, payment: { id: payId, status: PAY.PAID }, history: _histPush(b, 'pagamento_confirmado', req.auth.uid), updatedAt: FV.serverTimestamp() }, { merge: true });
    } else { // adicional — marca o Pix pago, o extra vinculado como PAGO e RECOMPUTA o total (BUG3)
      const lista = (b.pagamentosAdicionais || []).map(x => x.id === payId ? Object.assign({}, x, { status: PAY.PAID }) : x);
      const extras = Object.assign({}, b.extras || {});
      const patch = { pagamentosAdicionais: lista, history: _histPush(b, 'pagamento_adicional_confirmado', req.auth.uid), updatedAt: FV.serverTimestamp() };
      if (pay.extraId && extras[pay.extraId]) {
        extras[pay.extraId] = Object.assign({}, extras[pay.extraId], { paymentStatus: PAY.PAID });
        const calc = Preco.calcular({ metragem: _num((b.property || {}).metragem), tabela: (b.financial || {}).pricingSnapshot, catalogoAdicionais: adicionais, extras });
        patch.extras = extras;
        patch.itensPendentes = calc.itensPendentes || [];
        patch.financial = Object.assign({}, b.financial, { valorTotalConfirmado: calc.totalConfirmado, adicionaisConfirmados: (calc.totalConfirmado || 0) - _num(b.financial.valorBaseFinal), adicionaisPendentes: (calc.itensPendentes || []).length });
      }
      tx.set(bRef, patch, { merge: true });
    }
    tx.set(payRef, { status: PAY.PAID, confirmedAt: FV.serverTimestamp(), confirmedBy: req.auth.uid }, { merge: true });
    out = { status: PAY.PAID, tipo: pay.tipo, corretorId: b.corretorId, codigo: b.codigo };
  });
  if (out.tipo === 'servico') await _hrecNotificar(out.corretorId, 'pagamento', 'Pagamento do ' + out.codigo + ' confirmado — agendamento garantido.', { codigo: out.codigo });
  return Object.assign({ ok: true }, { status: out.status, tipo: out.tipo });
});

// Reverte um pagamento pago. SÓ administrador. Exige motivo. Booking → pagamento_pendente_revisao.
// NÃO libera o horário (o motor mantém esse status bloqueando o slot).
exports.hrecReverterPagamento = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const payId = _txt((req.data || {}).paymentId, 128);
  const motivo = _txt((req.data || {}).motivo, 300);
  if (!payId) throw new HttpsError('invalid-argument', 'paymentId é obrigatório.');
  if (!motivo) throw new HttpsError('invalid-argument', 'Informe o motivo da reversão.');
  const payRef = db().collection('payments').doc(payId);
  await db().runTransaction(async (tx) => {
    const ps = await tx.get(payRef);
    if (!ps.exists) throw new HttpsError('not-found', 'Pagamento não encontrado.');
    const pay = ps.data();
    if (pay.status !== PAY.PAID) throw new HttpsError('failed-precondition', 'Só dá pra reverter um pagamento pago.');
    // Compra de crédito já lançada não é revertida aqui (exigiria debitar o saldo, que pode já
    // ter sido usado) — ajuste manual. (BUG6: evita saldo inconsistente.)
    if (pay.tipo === 'credito') throw new HttpsError('failed-precondition', 'Compra de crédito confirmada não pode ser revertida por aqui.');
    // TODAS as leituras ANTES de qualquer escrita (regra da transação Firestore).
    let bRef = null, bData = null;
    if (pay.tipo === 'servico' && pay.bookingId) {
      bRef = db().collection('bookings').doc(pay.bookingId);
      const bs = await tx.get(bRef);
      if (bs.exists) bData = bs.data();
    }
    tx.set(payRef, { status: PAY.CANCELLED, reversal: { reason: motivo, reversedAt: FV.serverTimestamp(), reversedBy: req.auth.uid } }, { merge: true });
    if (bData) tx.set(bRef, { status: BS.PAGAMENTO_PENDENTE_REVISAO, history: _histPush(bData, 'pagamento_revertido', req.auth.uid, { motivo }), updatedAt: FV.serverTimestamp() }, { merge: true });
  });
  return { ok: true };
});

// Compra de créditos: broker (própria imob) ou admin (qualquer). Cria a cobrança Pix
// pendente e devolve o BR Code (copia e cola) pra pagar. Admin confirma depois.
exports.hrecComprarCreditos = onCall(async (req) => {
  const p = _exigePapel(req, ['broker', 'administrador']);
  const valor = _num((req.data || {}).valor);
  if (valor <= 0) throw new HttpsError('invalid-argument', 'Informe um valor válido.');
  const imobId = p.efetivo === 'administrador' ? (_txt((req.data || {}).imobiliariaId, 80) || p.imob) : p.imob;
  if (!imobId) throw new HttpsError('failed-precondition', 'Sem imobiliária.');
  const pixSnap = await db().collection('config').doc('pix').get();
  const pix = pixSnap.exists ? pixSnap.data() : {};
  const payRef = db().collection('payments').doc();
  await payRef.set({ id: payRef.id, tipo: 'credito', bookingId: null, imobiliariaId: imobId, amount: valor, status: PAY.PENDING_CONFIRMATION, chavePix: pix.chave || '', requestedAt: FV.serverTimestamp(), requestedBy: req.auth.uid });
  const brcode = _brCodePix({ chave: pix.chave, nome: pix.recebedor, cidade: pix.cidade, valor, txid: payRef.id.slice(0, 20) });
  return { ok: true, paymentId: payRef.id, brcode, qrCodeUrl: pix.qrCodeUrl || null, pixAtivo: !!pix.ativo };
});

// Confirma a compra de crédito (SÓ administrador): credita contratado + disponivel.
exports.hrecConfirmarCompraCredito = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const payId = _txt((req.data || {}).paymentId, 128);
  if (!payId) throw new HttpsError('invalid-argument', 'paymentId é obrigatório.');
  const payRef = db().collection('payments').doc(payId);
  let creditado = 0;
  await db().runTransaction(async (tx) => {
    const ps = await tx.get(payRef);
    if (!ps.exists) throw new HttpsError('not-found', 'Pagamento não encontrado.');
    const pay = ps.data();
    if (pay.tipo !== 'credito') throw new HttpsError('failed-precondition', 'Este pagamento não é compra de crédito.');
    if (pay.status !== PAY.PENDING_CONFIRMATION) throw new HttpsError('failed-precondition', 'Compra já processada.');
    const creditRef = db().collection('credits').doc(pay.imobiliariaId);
    const cr = (await tx.get(creditRef)).data() || { contratado: 0, disponivel: 0, reservado: 0, consumido: 0, estornado: 0 };
    creditado = _num(pay.amount);
    tx.set(creditRef, { contratado: (cr.contratado || 0) + creditado, disponivel: (cr.disponivel || 0) + creditado, updatedAt: FV.serverTimestamp() }, { merge: true });
    tx.set(db().collection('creditMovements').doc(), { imobiliariaId: pay.imobiliariaId, tipo: 'Compra', descricao: 'Compra de créditos', ref: payId, valor: creditado, sinal: '+', usuario: req.auth.uid, createdAt: FV.serverTimestamp() });
    tx.set(payRef, { status: PAY.PAID, confirmedAt: FV.serverTimestamp(), confirmedBy: req.auth.uid }, { merge: true });
  });
  return { ok: true, creditado };
});

// Painel do admin: pagamentos pendentes (serviço/adicional/crédito).
exports.hrecPagamentosPendentes = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const snap = await db().collection('payments').where('status', '==', PAY.PENDING_CONFIRMATION).limit(200).get();
  const pagamentos = snap.docs.map(d => { const x = d.data(); return { id: d.id, tipo: x.tipo, imobiliariaId: x.imobiliariaId, bookingId: x.bookingId || null, amount: x.amount, requestedAtMs: _toMs(x.requestedAt) }; })
    .sort((a, b) => (a.requestedAtMs || 0) - (b.requestedAtMs || 0));
  return { ok: true, pagamentos };
});

// Extrato de créditos de uma imobiliária: saldo + movimentos (broker vê a sua; staff qualquer).
exports.hrecListarMovimentos = onCall(async (req) => {
  const p = _exigePapel(req, ['broker', 'administrador', 'fotografo']);
  const imobId = _staff(p) ? (_txt((req.data || {}).imobiliariaId, 80) || p.imob) : p.imob;
  if (!imobId) throw new HttpsError('invalid-argument', 'imobiliariaId é obrigatório.');
  const [cr, mv] = await Promise.all([
    db().collection('credits').doc(imobId).get(),
    db().collection('creditMovements').where('imobiliariaId', '==', imobId).limit(200).get()
  ]);
  const movimentos = mv.docs.map(d => { const x = d.data(); return { tipo: x.tipo, descricao: x.descricao, ref: x.ref || null, valor: x.valor, sinal: x.sinal, atMs: _toMs(x.createdAt) }; })
    .sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  return { ok: true, saldo: cr.exists ? cr.data() : { disponivel: 0, reservado: 0, consumido: 0, contratado: 0 }, movimentos };
});

// ============================================================ relatórios
const _FATURAVEL = [BS.CONFIRMADO, BS.SERVICO_INICIADO, BS.CAPTACAO_CONCLUIDA, BS.EM_TRATAMENTO, BS.MATERIAL_ENTREGUE];
// Relatório agregado por período (filtra por schedule.dateISO). Broker vê a própria
// imobiliária; staff vê tudo (ou filtra por imobiliariaId). Devolve KPIs + quebras +
// as linhas (pro export CSV/PDF no cliente). Sem índice composto: filtra data em memória.
exports.hrecRelatorio = onCall(async (req) => {
  const p = _exigePapel(req, ['broker', 'administrador', 'fotografo']);
  const d = req.data || {};
  const de = _txt(d.de, 10), ate = _txt(d.ate, 10);
  let q = db().collection('bookings');
  if (_staff(p)) { const imf = _txt(d.imobiliariaId, 80); if (imf) q = q.where('imobiliariaId', '==', imf); }
  else q = q.where('imobiliariaId', '==', p.imob || '__none__');
  const snap = await q.limit(2000).get();
  const rows = snap.docs.map(x => x.data()).filter(b => {
    const iso = (b.schedule || {}).dateISO; if (!iso) return false;
    if (de && iso < de) return false; if (ate && iso > ate) return false; return true;
  });

  let faturamento = 0;
  const porStatus = {}, porFotografo = {}, porImob = {}, porTipo = { pacote: { c: 0, v: 0 }, avulso: { c: 0, v: 0 } };
  const fotUids = new Set();
  rows.forEach(b => {
    porStatus[b.status] = (porStatus[b.status] || 0) + 1;
    const v = _FATURAVEL.indexOf(b.status) >= 0 ? _num((b.financial || {}).valorTotalConfirmado) : 0;
    faturamento += v;
    if (b.fotografoId) { fotUids.add(b.fotografoId); (porFotografo[b.fotografoId] = porFotografo[b.fotografoId] || { c: 0, v: 0 }).c++; porFotografo[b.fotografoId].v += v; }
    (porImob[b.imobiliariaId] = porImob[b.imobiliariaId] || { c: 0, v: 0 }).c++; porImob[b.imobiliariaId].v += v;
    const t = (b.financial || {}).tipo; if (porTipo[t]) { porTipo[t].c++; porTipo[t].v += v; }
  });
  const nomesFotografos = {};
  // Só o NOME (nunca e-mail) — não vaza contato de staff pro broker. (L2)
  for (const uid of fotUids) { try { const u = await admin.auth().getUser(uid); nomesFotografos[uid] = u.displayName || 'Fotógrafo'; } catch (_e) { nomesFotografos[uid] = 'Fotógrafo'; } }

  return {
    ok: true, periodo: { de: de || null, ate: ate || null },
    resumo: { count: rows.length, faturamento, porStatus, porTipo },
    porFotografo, porImob, nomesFotografos, rows: rows.map(_bookingResumo)
  };
});

// ============================================================ administração (CRUD)
// Tudo aqui exige administrador. Bookings existentes NÃO mudam (têm pricingSnapshot próprio).
function _bool(v) { return v === true || v === 'true'; }

// Config completa pro painel do Admin (tabelas + adicionais + config/agenda + config/pix + bloqueios).
exports.hrecAdminConfig = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const [pt, sa, cfg, pix, bloq] = await Promise.all([
    db().collection('pricingTables').get(), db().collection('servicosAdicionais').get(),
    db().collection('config').doc('agenda').get(), db().collection('config').doc('pix').get(),
    db().collection('blockedDates').get()
  ]);
  return {
    ok: true,
    tabelas: pt.docs.map(d => d.data()),
    adicionais: sa.docs.map(d => d.data()).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)),
    configAgenda: cfg.exists ? cfg.data() : {},
    configPix: pix.exists ? pix.data() : {},
    bloqueios: bloq.docs.map(d => Object.assign({ dateISO: d.id }, d.data())).sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1))
  };
});

// Salva uma tabela de preço (upsert) e VERSIONA em pricingHistory (append-only). Bump versao.
exports.hrecSalvarTabela = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const t = (req.data || {}).tabela || {};
  const id = _txt(t.id, 80);
  if (!id) throw new HttpsError('invalid-argument', 'id da tabela é obrigatório.');
  if (!Array.isArray(t.faixas)) throw new HttpsError('invalid-argument', 'faixas inválidas.');
  const ref = db().collection('pricingTables').doc(id);
  const prev = await ref.get();
  const anterior = prev.exists ? prev.data() : null;
  const versao = ((anterior && anterior.versao) || 0) + 1;
  const faixas = t.faixas.map(f => ({
    id: _num(f.id), min: _num(f.min), max: (f.max == null || f.max === '') ? null : _num(f.max),
    fotosAproximadas: f.fotosAproximadas == null ? null : _num(f.fotosAproximadas),
    valorReferencia: f.valorReferencia == null ? null : _num(f.valorReferencia),
    desconto: _num(f.desconto), valorFinal: f.valorFinal == null ? null : _num(f.valorFinal),
    tempoMinutos: f.tempoMinutos == null ? null : _num(f.tempoMinutos), ativo: f.ativo !== false, sobConsulta: _bool(f.sobConsulta)
  }));
  const novo = {
    id, nome: _txt(t.nome, 120), descricao: _txt(t.descricao, 300),
    tipo: t.tipo === 'parceria' ? 'parceria' : 'padrao', descontoPercentual: _num(t.descontoPercentual),
    ativa: t.ativa !== false, vigencia: null, escolheFormatoVideo: _bool(t.escolheFormatoVideo),
    servicosIncluidos: t.servicosIncluidos || {}, adicionaisPermitidos: Array.isArray(t.adicionaisPermitidos) ? t.adicionaisPermitidos : [],
    faixas, versao, updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
  };
  await ref.set(novo);
  await db().collection('pricingHistory').add({ tableId: id, versao, anterior, novo: Object.assign({}, novo, { updatedAt: null }), usuario: req.auth.uid, obs: _txt((req.data || {}).obs, 300), createdAt: FV.serverTimestamp() });
  return { ok: true, versao };
});

// Salva um adicional (upsert).
exports.hrecSalvarAdicional = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const a = (req.data || {}).adicional || {};
  const id = _txt(a.id, 80);
  if (!id) throw new HttpsError('invalid-argument', 'id do adicional é obrigatório.');
  const cob = ['fixed', 'per_unit', 'from_minimum', 'manual'];
  await db().collection('servicosAdicionais').doc(id).set({
    id, nome: _txt(a.nome, 120), descricao: _txt(a.descricao, 500), valor: _num(a.valor),
    tipoCobranca: cob.indexOf(a.tipoCobranca) >= 0 ? a.tipoCobranca : 'fixed',
    tempoAdicionalMinutos: _num(a.tempoAdicionalMinutos), requerAprovacao: _bool(a.requerAprovacao),
    recebeDesconto: _bool(a.recebeDesconto), exigeRoteiro: _bool(a.exigeRoteiro),
    ativo: a.ativo !== false, ordem: _num(a.ordem), icon: _txt(a.icon, 30), updatedAt: FV.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// Salva a config da agenda (horários, almoço, buffer, grade, limiteDia, dias, antecedência, hold).
exports.hrecSalvarConfigAgenda = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const c = (req.data || {}).config || {};
  const hhmm = (v, def) => (/^\d{1,2}:\d{2}$/.test(v) ? v : def);
  const dias = Array.isArray(c.diasAtendimento) ? c.diasAtendimento.map(Number).filter(n => n >= 0 && n <= 6) : [1, 2, 3, 4, 5, 6];
  await db().collection('config').doc('agenda').set({
    timezone: 'America/Sao_Paulo',
    horaInicio: hhmm(c.horaInicio, '09:00'), horaFim: hhmm(c.horaFim, '18:00'),
    almocoInicio: hhmm(c.almocoInicio, '12:00'), almocoFim: hhmm(c.almocoFim, '13:00'),
    travelBufferMinutes: _num(c.travelBufferMinutes) || 30, gradeMinutos: _num(c.gradeMinutos) || 15,
    antecedenciaHoras: _num(c.antecedenciaHoras), limiteDia: _num(c.limiteDia) || 5,
    diasAtendimento: dias.length ? dias : [1, 2, 3, 4, 5, 6], holdMinutos: _num(c.holdMinutos) || 30,
    updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
  }, { merge: true });
  return { ok: true };
});

// Salva a config do Pix (chave, tipo, recebedor, cidade, QR, ativo).
exports.hrecSalvarConfigPix = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const p = (req.data || {}).pix || {};
  await db().collection('config').doc('pix').set({
    chave: _txt(p.chave, 77), tipoChave: _txt(p.tipoChave, 20), recebedor: _txt(p.recebedor, 120),
    documento: _txt(p.documento, 30), cidade: _txt(p.cidade, 60), qrCodeUrl: _txt(p.qrCodeUrl, 500),
    observacoes: _txt(p.observacoes, 300), ativo: _bool(p.ativo), updatedAt: FV.serverTimestamp(), updatedBy: req.auth.uid
  }, { merge: true });
  return { ok: true };
});

// Bloqueia / desbloqueia uma data (feriado, férias, bloqueio manual).
exports.hrecBloquearData = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const dateISO = _txt((req.data || {}).dateISO, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new HttpsError('invalid-argument', 'dateISO inválido.');
  await db().collection('blockedDates').doc(dateISO).set({ dateISO, motivo: _txt((req.data || {}).motivo, 200), criadoPor: req.auth.uid, createdAt: FV.serverTimestamp() });
  return { ok: true };
});
exports.hrecDesbloquearData = onCall(async (req) => {
  _exigePapel(req, ['administrador']);
  const dateISO = _txt((req.data || {}).dateISO, 10);
  if (!dateISO) throw new HttpsError('invalid-argument', 'dateISO é obrigatório.');
  await db().collection('blockedDates').doc(dateISO).delete();
  return { ok: true };
});

// ============================================================ notificações in-app
// Minhas notificações (as do próprio uid). Devolve as 50 mais recentes + contagem não-lidas.
exports.hrecMinhasNotifs = onCall(async (req) => {
  _auth(req);
  const snap = await db().collection('hrec_notifs').where('uid', '==', req.auth.uid).limit(80).get();
  const itens = snap.docs.map(d => { const x = d.data(); return { id: d.id, tipo: x.tipo, texto: x.texto, meta: x.meta || null, lida: !!x.lida, atMs: _toMs(x.createdAt) }; })
    .sort((a, b) => (b.atMs || 0) - (a.atMs || 0)).slice(0, 50);
  return { ok: true, itens, naoLidas: itens.filter(i => !i.lida).length };
});
// Marca todas as minhas notificações como lidas.
exports.hrecMarcarNotifsLidas = onCall(async (req) => {
  _auth(req);
  const snap = await db().collection('hrec_notifs').where('uid', '==', req.auth.uid).where('lida', '==', false).limit(400).get();
  const batch = db().batch();
  snap.docs.forEach(d => batch.set(d.ref, { lida: true }, { merge: true }));
  await batch.commit();
  return { ok: true, marcadas: snap.size };
});

// ============================================================ relatório semanal (e-mail)
// Toda segunda 08h (SP): resumo da semana anterior por e-mail pro administrativo da H-REC.
// Só em produção (o staging roda todas as functions; evita e-mail duplicado/dummy).
exports.hrecRelatorioSemanal = onSchedule({ schedule: '0 8 * * 1', timeZone: 'America/Sao_Paulo', secrets: [SUPPORT_EMAIL_PASS] }, async () => {
  if (process.env.GCLOUD_PROJECT !== 'remax-smart-hub') { console.log('hrecRelatorioSemanal: fora de produção, ignorado.'); return; }
  const hoje = Datas.hojeISO(new Date());
  const de = Datas.addDias(hoje, -7);
  const snap = await db().collection('bookings').where('schedule.dateISO', '>=', de).where('schedule.dateISO', '<=', hoje).limit(2000).get();
  const rows = snap.docs.map(d => d.data());
  let faturamento = 0; const porStatus = {};
  rows.forEach(b => { porStatus[b.status] = (porStatus[b.status] || 0) + 1; if (_FATURAVEL.indexOf(b.status) >= 0) faturamento += _num((b.financial || {}).valorTotalConfirmado); });
  const cfg = await db().collection('config').doc('agenda').get();
  const to = (cfg.exists && _txt(cfg.data().emailRelatorio, 160)) || HREC_REMETENTE;
  const linhas = Object.keys(porStatus).map(s => '<li>' + s + ': ' + porStatus[s] + '</li>').join('');
  await _hrecEmail(to, 'H-REC — Resumo semanal (' + de + ' a ' + hoje + ')',
    '<h2>Resumo da semana</h2><p>Serviços no período: <b>' + rows.length + '</b><br>Faturamento: <b>R$ ' + faturamento.toFixed(2) + '</b></p><ul>' + linhas + '</ul>');
  console.log('hrecRelatorioSemanal: enviado pra', to, '·', rows.length, 'serviços');
});

// ============================================================ expirar holds
// A cada 5 min: cobranças Pix vencidas (hold passou e ainda pendente) → status
// pagamento_expirado (libera o slot; o motor já ignora esse status).
exports.hrecExpirarHolds = onSchedule({ schedule: 'every 5 minutes', timeZone: 'America/Sao_Paulo' }, async () => {
  const agora = TS.now();
  const snap = await db().collection('bookings')
    .where('status', '==', BS.AGUARDANDO_PAGAMENTO)
    .where('holdExpiresAt', '<=', agora).limit(200).get();
  let n = 0;
  for (const doc of snap.docs) {
    const b = doc.data();
    if (b.payment && b.payment.status === PAY.PENDING_CONFIRMATION) {
      const hist = Array.isArray(b.history) ? b.history.slice(-50) : [];
      hist.push({ action: 'pagamento_expirado', actor: 'sistema', at: agora });
      await doc.ref.set({ status: BS.PAGAMENTO_EXPIRADO, holdExpiresAt: null, history: hist, updatedAt: FV.serverTimestamp() }, { merge: true });
      if (b.payment.id) await db().collection('payments').doc(b.payment.id).set({ status: PAY.EXPIRED }, { merge: true }).catch(() => {});
      n++;
    }
  }
  console.log('hrecExpirarHolds: expirou', n, 'cobranças');
});
