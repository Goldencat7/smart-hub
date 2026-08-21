// H-REC AGENDA — testes de INTEGRAÇÃO das Cloud Functions (Bloco 5) no emulador.
// Aceite do MD: dois createBooking no mesmo slot → um grava, outro SLOT_TAKEN;
// crédito nunca fica negativo; código sequencial. Roda dentro de `npm run test:functions`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin'); // firebase-admin vive nas functions
const Seed = require('../../hrec/dominio/seed.js');
const Datas = require('../../hrec/dominio/datas.js');

// Admin SDK → emulador (as env FIRESTORE/AUTH_EMULATOR_HOST são injetadas pelo emulators:exec).
admin.initializeApp({ projectId: 'demo-smart-hub' });
const db = admin.firestore();

// Client SDK → emulador (mesma região das functions).
const app = initializeApp({ projectId: 'demo-smart-hub', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns = getFunctions(app, 'southamerica-east1');
connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const chamar = (nome, dados) => httpsCallable(fns, nome)(dados || {});

// Data futura em dia útil (evita antecedência/fim de semana).
let DIA, DIA2;
function utilDepois(base, dias) {
  let iso = Datas.addDias(base, dias);
  while (Datas.diaSemana(iso) === 0) iso = Datas.addDias(iso, 1); // pula domingo
  return iso;
}
function futuroUtil() { return utilDepois(Datas.hojeISO(new Date()), 40); }

async function criarUser(email, claims) {
  let u;
  try { u = await admin.auth().createUser({ email, password: 'senha123' }); }
  catch (e) { if (e.code === 'auth/email-already-exists') u = await admin.auth().getUserByEmail(email); else throw e; }
  await admin.auth().setCustomUserClaims(u.uid, claims);
  return u.uid;
}
async function login(email) {
  await signInWithEmailAndPassword(auth, email, 'senha123');
  await auth.currentUser.getIdToken(true); // pega as claims recém-setadas
}

async function esperaErro(promise, code) {
  try { await promise; assert.fail(`esperava '${code}', mas passou`); }
  catch (e) { if (e instanceof assert.AssertionError) throw e; assert.equal(e.code, `functions/${code}`, `veio '${e.code}' (${e.message})`); }
}

let DIA3, DIA4, DIA5;
before(async () => {
  DIA = futuroUtil();
  DIA2 = utilDepois(DIA, 7);
  DIA3 = utilDepois(DIA2, 7);
  DIA4 = utilDepois(DIA3, 7);
  DIA5 = utilDepois(DIA4, 7);
  // Catálogo.
  const batch = db.batch();
  Seed.TABELAS.forEach(t => batch.set(db.collection('pricingTables').doc(t.id), t));
  Seed.ADICIONAIS.forEach(a => batch.set(db.collection('servicosAdicionais').doc(a.id), a));
  batch.set(db.collection('config').doc('agenda'), Seed.CONFIG_AGENDA);
  // Imobiliárias + créditos.
  batch.set(db.collection('imobiliarias').doc('imobPARC'), { nome: 'Parc', pricingTableId: 'remax_empire', tipo: 'parceria', ativa: true });
  batch.set(db.collection('imobiliarias').doc('imobPOOR'), { nome: 'Poor', pricingTableId: 'remax_empire', tipo: 'parceria', ativa: true });
  batch.set(db.collection('imobiliarias').doc('imobOP'), { nome: 'Op', pricingTableId: 'remax_empire', tipo: 'parceria', ativa: true });
  batch.set(db.collection('imobiliarias').doc('imobAV'), { nome: 'Avulsa', pricingTableId: 'padrao_hrec', tipo: 'avulso', ativa: true });
  batch.set(db.collection('config').doc('pix'), { chave: 'hrec@pix.com', recebedor: 'H-REC AudioVisual', cidade: 'Sao Paulo', ativo: true });
  batch.set(db.collection('credits').doc('imobPARC'), { contratado: 1000, disponivel: 1000, reservado: 0, consumido: 0, estornado: 0 });
  batch.set(db.collection('credits').doc('imobPOOR'), { contratado: 50, disponivel: 50, reservado: 0, consumido: 0, estornado: 0 });
  batch.set(db.collection('credits').doc('imobOP'), { contratado: 5000, disponivel: 5000, reservado: 0, consumido: 0, estornado: 0 });
  await batch.commit();
  // Usuários por papel.
  await criarUser('cor.parc@demo.com', { hrecRole: 'corretor', hrecImob: 'imobPARC' });
  await criarUser('cor.poor@demo.com', { hrecRole: 'corretor', hrecImob: 'imobPOOR' });
  await criarUser('adm.hrec@demo.com', { hrecRole: 'administrador' });
  await criarUser('cor.sem@demo.com', { hrecRole: 'corretor', hrecImob: 'imobPOOR' }); // corretor SEM posse dos bookings de imobPARC (não é mutado por outros testes)
  await criarUser('cor.op@demo.com', { hrecRole: 'corretor', hrecImob: 'imobOP' });
  await criarUser('fot@demo.com', { hrecRole: 'fotografo' });
  await criarUser('brk.op@demo.com', { hrecRole: 'broker', hrecImob: 'imobOP' });
  await criarUser('avu@demo.com', { hrecRole: 'avulso', hrecImob: 'imobAV' });
});
after(() => signOut(auth).catch(() => {}));

describe('H-REC Bloco 5 — createBooking / cancel / crédito', () => {
  it('catálogo devolve as 2 tabelas e 5 adicionais', async () => {
    await login('cor.parc@demo.com');
    const r = await chamar('hrecCatalogo');
    assert.equal(Object.keys(r.data.tabelas).length, 2);
    assert.equal(r.data.adicionais.length, 5);
  });

  it('cria booking pacote (confirmado), reserva crédito e gera código sequencial', async () => {
    await login('cor.parc@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO: DIA, startAt: '09:00', property: { metragem: 100, endereco: 'Rua A' } });
    assert.equal(r.data.ok, true);
    assert.equal(r.data.status, 'confirmado');
    assert.match(r.data.codigo, /^HREC-\d{4}-00001$/);
    const cr = (await db.collection('credits').doc('imobPARC').get()).data();
    assert.equal(cr.disponivel, 856); // 1000 - 144 (Empire faixa 2, 100m²)
    assert.equal(cr.reservado, 144);
  });

  it('segundo booking no MESMO slot → SLOT_TAKEN', async () => {
    await login('cor.parc@demo.com');
    await esperaErro(chamar('hrecCriarBooking', { dateISO: DIA, startAt: '09:00', property: { metragem: 100 } }), 'failed-precondition');
  });

  it('outro slot livre gera código 00002', async () => {
    await login('cor.parc@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO: DIA, startAt: '13:00', property: { metragem: 100, endereco: 'Rua B' } });
    assert.match(r.data.codigo, /^HREC-\d{4}-00002$/);
  });

  it('crédito insuficiente → resource-exhausted (nunca fica negativo)', async () => {
    await login('cor.poor@demo.com'); // imobPOOR só tem 50 de crédito, serviço custa 144
    await esperaErro(chamar('hrecCriarBooking', { dateISO: DIA, startAt: '15:00', property: { metragem: 100 } }), 'resource-exhausted');
    const cr = (await db.collection('credits').doc('imobPOOR').get()).data();
    assert.equal(cr.disponivel, 50); // intacto
    assert.ok(cr.disponivel >= 0);
  });

  it('cancelar devolve o crédito reservado (estorno)', async () => {
    await login('cor.parc@demo.com');
    // acha o booking das 13:00 pra cancelar
    const snap = await db.collection('bookings').where('schedule.startAt', '==', '13:00').limit(1).get();
    const id = snap.docs[0].id;
    const antes = (await db.collection('credits').doc('imobPARC').get()).data();
    await chamar('hrecCancelarBooking', { bookingId: id, motivo: 'teste' });
    const depois = (await db.collection('credits').doc('imobPARC').get()).data();
    assert.equal(depois.disponivel, antes.disponivel + 144);
    assert.equal(depois.estornado, 144);
    const b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.status, 'cancelado');
  });

  it('adicional FIXO (area_comum) entra no total; drone (requer aprovação) fica pendente', async () => {
    await login('cor.parc@demo.com');
    const antes = (await db.collection('credits').doc('imobPARC').get()).data().disponivel;
    const r = await chamar('hrecCriarBooking', {
      dateISO: DIA2, startAt: '09:00', property: { metragem: 100 },
      extras: { area_comum: { selecionado: true }, drone: { selecionado: true, quantidade: 1 } }
    });
    const b = (await db.collection('bookings').doc(r.data.bookingId).get()).data();
    // 144 (base Empire) + 100 (area_comum fixo) = 244 reservado; drone fica pendente.
    assert.equal(b.financial.valorTotalConfirmado, 244);
    assert.equal(b.financial.creditosReservados, 244);
    assert.equal(b.financial.adicionaisPendentes, 1); // só o drone
    const depois = (await db.collection('credits').doc('imobPARC').get()).data().disponivel;
    assert.equal(antes - depois, 244);
  });

  it('dois createBooking concorrentes no mesmo slot → no máx. um grava', async () => {
    await login('cor.parc@demo.com');
    const alvo = { dateISO: DIA, startAt: '16:00', property: { metragem: 100 } };
    const res = await Promise.allSettled([chamar('hrecCriarBooking', alvo), chamar('hrecCriarBooking', alvo)]);
    const ok = res.filter(x => x.status === 'fulfilled').length;
    assert.ok(ok <= 1, `esperava no máximo 1 gravação concorrente, houve ${ok}`);
  });

  it('corretor não pode definir papéis (só administrador)', async () => {
    await login('cor.parc@demo.com');
    await esperaErro(chamar('hrecSetPapel', { uid: 'x', role: 'broker', imobiliariaId: 'imobPARC' }), 'permission-denied');
  });
});

describe('H-REC Bloco 6 — Admin (imobiliárias + papéis)', () => {
  it('administrador cria imobiliária e ela aparece na listagem', async () => {
    await login('adm.hrec@demo.com');
    const r = await chamar('hrecImobiliariaSalvar', { nome: 'Nova Imob', tipo: 'parceria' });
    assert.ok(r.data.id);
    const l = await chamar('hrecImobiliariasListar');
    assert.ok(l.data.imobiliarias.some(i => i.id === r.data.id && i.nome === 'Nova Imob'));
  });

  it('corretor NÃO cria imobiliária (permission-denied)', async () => {
    await login('cor.parc@demo.com');
    await esperaErro(chamar('hrecImobiliariaSalvar', { nome: 'X' }), 'permission-denied');
  });

  it('administrador atribui papel e o usuário aparece com o papel na listagem', async () => {
    await login('adm.hrec@demo.com');
    const alvoUid = (await admin.auth().getUserByEmail('cor.poor@demo.com')).uid;
    await chamar('hrecSetPapel', { uid: alvoUid, role: 'broker', imobiliariaId: 'imobPARC' });
    const u = await chamar('hrecUsuariosListar');
    const achado = u.data.usuarios.find(x => x.uid === alvoUid);
    assert.equal(achado.hrecRole, 'broker');
    assert.equal(achado.hrecImob, 'imobPARC');
  });

  it('setPapel de corretor sem imobiliária → invalid-argument', async () => {
    await login('adm.hrec@demo.com');
    const alvoUid = (await admin.auth().getUserByEmail('cor.parc@demo.com')).uid;
    await esperaErro(chamar('hrecSetPapel', { uid: alvoUid, role: 'corretor' }), 'invalid-argument');
  });

  it('setPapel com role vazio REMOVE o acesso H-REC (limpa a claim)', async () => {
    await login('adm.hrec@demo.com');
    const u = await admin.auth().createUser({ email: 'remov@demo.com', password: 'senha123' });
    await chamar('hrecSetPapel', { uid: u.uid, role: 'fotografo' });
    let claims = (await admin.auth().getUser(u.uid)).customClaims || {};
    assert.equal(claims.hrecRole, 'fotografo');
    await chamar('hrecSetPapel', { uid: u.uid, role: '' }); // remove
    claims = (await admin.auth().getUser(u.uid)).customClaims || {};
    assert.equal(claims.hrecRole, null);
  });
});

describe('H-REC Bloco 7 — Meus Agendamentos (listar + obter)', () => {
  it('corretor lista só os PRÓPRIOS agendamentos', async () => {
    await login('cor.parc@demo.com');
    const r = await chamar('hrecListarBookings');
    assert.ok(r.data.bookings.length >= 1);
    const parcUid = (await admin.auth().getUserByEmail('cor.parc@demo.com')).uid;
    assert.ok(r.data.bookings.every(b => b.corretorId === parcUid), 'todos são do corretor logado');
  });

  it('obter detalhe do próprio agendamento traz histórico; de outro → permission-denied', async () => {
    await login('cor.parc@demo.com');
    const lista = await chamar('hrecListarBookings');
    const id = lista.data.bookings[0].bookingId;
    const det = await chamar('hrecBookingObter', { bookingId: id });
    assert.equal(det.data.booking.bookingId, id);
    assert.ok(Array.isArray(det.data.booking.history));
    // corretor de OUTRA imobiliária (sem posse) não abre o agendamento do cor.parc
    await login('cor.sem@demo.com');
    await esperaErro(chamar('hrecBookingObter', { bookingId: id }), 'permission-denied');
  });
});

describe('H-REC Bloco 8 — Operação (fotógrafo)', () => {
  async function novoBooking(dateISO, startAt, extras) {
    await login('cor.op@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO, startAt, property: { metragem: 100 }, extras: extras || {} });
    return r.data.bookingId;
  }

  it('iniciar → concluir consome os créditos reservados', async () => {
    const id = await novoBooking(DIA3, '09:00');
    const antes = (await db.collection('credits').doc('imobOP').get()).data();
    await login('fot@demo.com');
    let r = await chamar('hrecIniciarServico', { bookingId: id });
    assert.equal(r.data.status, 'servico_iniciado');
    r = await chamar('hrecConcluirServico', { bookingId: id });
    assert.equal(r.data.status, 'captacao_concluida');
    const depois = (await db.collection('credits').doc('imobOP').get()).data();
    assert.equal(depois.reservado, antes.reservado - 144); // reserva liberada
    assert.equal(depois.consumido, antes.consumido + 144); // e consumida
    const b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.financial.creditosConsumidos, true);
    assert.equal(b.material.status, 'em_tratamento');
  });

  it('entregar material valida URL https e guarda histórico de troca', async () => {
    const id = await novoBooking(DIA3, '13:00');
    await login('fot@demo.com');
    await chamar('hrecIniciarServico', { bookingId: id });
    await chamar('hrecConcluirServico', { bookingId: id });
    await esperaErro(chamar('hrecEntregarMaterial', { bookingId: id, driveUrl: 'ftp://x' }), 'invalid-argument');
    const r = await chamar('hrecEntregarMaterial', { bookingId: id, driveUrl: 'https://drive.google.com/folders/AAA' });
    assert.equal(r.data.status, 'material_entregue');
    await chamar('hrecEntregarMaterial', { bookingId: id, driveUrl: 'https://drive.google.com/folders/BBB' });
    const b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.material.driveUrl, 'https://drive.google.com/folders/BBB');
    assert.equal(b.material.history.length, 1);
    assert.equal(b.material.history[0].oldUrl, 'https://drive.google.com/folders/AAA');
  });

  it('aprovar drone recalcula o total e reserva a diferença (pacote)', async () => {
    const id = await novoBooking(DIA3, '15:30', { drone: { selecionado: true, quantidade: 1 } });
    const b0 = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b0.financial.valorTotalConfirmado, 144); // drone ainda pendente
    const antes = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    await login('fot@demo.com');
    const r = await chamar('hrecAprovarDrone', { bookingId: id });
    assert.equal(r.data.total, 744); // 144 + 600
    assert.equal(r.data.delta, 600);
    const depois = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    assert.equal(antes - depois, 600);
    const b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.extras.drone.status, 'aprovado');
    assert.equal(b.financial.adicionaisPendentes, 0);
  });

  it('corretor não pode operar (só fotógrafo/administrador)', async () => {
    await login('cor.op@demo.com');
    await esperaErro(chamar('hrecIniciarServico', { bookingId: 'qualquer' }), 'permission-denied');
  });
});

describe('H-REC Bloco 9 — Pagamentos e créditos', () => {
  let payAvulso;
  it('avulso gera booking aguardando_pagamento com cobrança Pix', async () => {
    await login('avu@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO: DIA4, startAt: '09:00', property: { metragem: 100 } });
    assert.equal(r.data.status, 'aguardando_pagamento');
    const b = (await db.collection('bookings').doc(r.data.bookingId).get()).data();
    payAvulso = b.payment.id;
    assert.ok(payAvulso);
    assert.equal(b.financial.valorTotalConfirmado, 230); // padrao_hrec faixa 2 (80-160)
  });

  it('só administrador confirma pagamento; broker não', async () => {
    await login('brk.op@demo.com');
    await esperaErro(chamar('hrecConfirmarPagamento', { paymentId: payAvulso }), 'permission-denied');
    await login('adm.hrec@demo.com');
    const r = await chamar('hrecConfirmarPagamento', { paymentId: payAvulso });
    assert.equal(r.data.status, 'paid');
    const b = (await db.collection('bookings').where('payment.id', '==', payAvulso).get()).docs[0].data();
    assert.equal(b.status, 'confirmado');
    assert.equal(b.holdExpiresAt, null);
  });

  it('reverter pagamento exige motivo e joga o booking pra revisão (sem liberar slot)', async () => {
    await login('adm.hrec@demo.com');
    await esperaErro(chamar('hrecReverterPagamento', { paymentId: payAvulso }), 'invalid-argument'); // sem motivo
    const r = await chamar('hrecReverterPagamento', { paymentId: payAvulso, motivo: 'estorno solicitado' });
    assert.equal(r.data.ok, true);
    const b = (await db.collection('bookings').where('payment.id', '==', payAvulso).get()).docs[0].data();
    assert.equal(b.status, 'pagamento_pendente_revisao');
  });

  it('compra de créditos: broker gera Pix (BR Code) e admin confirma creditando', async () => {
    await login('brk.op@demo.com');
    const r = await chamar('hrecComprarCreditos', { valor: 1000 });
    assert.ok(r.data.paymentId);
    assert.match(r.data.brcode, /^000201.*6304[0-9A-F]{4}$/); // BR Code válido
    const antes = (await db.collection('credits').doc('imobOP').get()).data();
    await login('adm.hrec@demo.com');
    const c = await chamar('hrecConfirmarCompraCredito', { paymentId: r.data.paymentId });
    assert.equal(c.data.creditado, 1000);
    const depois = (await db.collection('credits').doc('imobOP').get()).data();
    assert.equal(depois.contratado, antes.contratado + 1000);
    assert.equal(depois.disponivel, antes.disponivel + 1000);
  });

  it('extrato: broker vê saldo + movimentos da própria imobiliária', async () => {
    await login('brk.op@demo.com');
    const r = await chamar('hrecListarMovimentos', {});
    assert.ok(r.data.saldo);
    assert.ok(Array.isArray(r.data.movimentos));
    assert.ok(r.data.movimentos.some(m => m.tipo === 'Compra' && m.sinal === '+'));
  });

  it('pagamentos pendentes: administrador lista', async () => {
    await login('adm.hrec@demo.com');
    const r = await chamar('hrecPagamentosPendentes');
    assert.ok(Array.isArray(r.data.pagamentos));
  });
});

describe('H-REC Bloco 10 — Relatórios', () => {
  it('administrador agrega todos os agendamentos com faturamento e quebras', async () => {
    await login('adm.hrec@demo.com');
    const r = await chamar('hrecRelatorio', {});
    assert.ok(r.data.resumo.count >= 1);
    assert.equal(typeof r.data.resumo.faturamento, 'number');
    assert.ok(r.data.resumo.porStatus && typeof r.data.resumo.porStatus === 'object');
    assert.ok(Array.isArray(r.data.rows));
    assert.ok(r.data.porImob && Object.keys(r.data.porImob).length >= 1);
  });

  it('broker vê só a própria imobiliária no relatório', async () => {
    await login('brk.op@demo.com');
    const r = await chamar('hrecRelatorio', {});
    assert.ok(r.data.rows.every(b => b.imobiliariaId === 'imobOP'), 'todas as linhas são da imobOP');
  });

  it('filtro de período por data recorta as linhas', async () => {
    await login('adm.hrec@demo.com');
    const vazio = await chamar('hrecRelatorio', { de: '2099-01-01', ate: '2099-12-31' });
    assert.equal(vazio.data.resumo.count, 0);
  });

  it('corretor não acessa relatórios', async () => {
    await login('cor.op@demo.com');
    await esperaErro(chamar('hrecRelatorio', {}), 'permission-denied');
  });
});

describe('H-REC Bloco 11 — Administração (CRUD)', () => {
  it('adminConfig devolve tabelas, adicionais, configs e bloqueios', async () => {
    await login('adm.hrec@demo.com');
    const r = await chamar('hrecAdminConfig');
    assert.ok(r.data.tabelas.length >= 2);
    assert.ok(r.data.adicionais.length >= 5);
    assert.ok(r.data.configAgenda && r.data.configPix);
    assert.ok(Array.isArray(r.data.bloqueios));
  });

  it('salvar tabela versiona em pricingHistory e reflete (bookings antigos não mudam)', async () => {
    await login('adm.hrec@demo.com');
    const cfg = await chamar('hrecAdminConfig');
    const t = cfg.data.tabelas.find(x => x.id === 'padrao_hrec');
    const vAntes = t.versao || 1;
    t.faixas[0].valorFinal = 199;
    const r = await chamar('hrecSalvarTabela', { tabela: t, obs: 'ajuste de teste' });
    assert.equal(r.data.versao, vAntes + 1);
    const hist = await db.collection('pricingHistory').where('tableId', '==', 'padrao_hrec').get();
    assert.ok(hist.size >= 1);
    const t2 = (await db.collection('pricingTables').doc('padrao_hrec').get()).data();
    assert.equal(t2.faixas[0].valorFinal, 199);
    assert.equal(t2.versao, vAntes + 1);
  });

  it('salvar adicional reflete o novo valor', async () => {
    await login('adm.hrec@demo.com');
    await chamar('hrecSalvarAdicional', { adicional: { id: 'drone', nome: 'Vídeo com drone', valor: 650, tipoCobranca: 'per_unit', requerAprovacao: true, tempoAdicionalMinutos: 30, ordem: 4 } });
    const d = (await db.collection('servicosAdicionais').doc('drone').get()).data();
    assert.equal(d.valor, 650);
    assert.equal(d.tipoCobranca, 'per_unit');
  });

  it('salvar config da agenda reflete limiteDia', async () => {
    await login('adm.hrec@demo.com');
    await chamar('hrecSalvarConfigAgenda', { config: { horaInicio: '08:00', horaFim: '19:00', limiteDia: 7, diasAtendimento: [1, 2, 3, 4, 5] } });
    const c = (await db.collection('config').doc('agenda').get()).data();
    assert.equal(c.limiteDia, 7);
    assert.equal(c.horaInicio, '08:00');
    assert.deepEqual(c.diasAtendimento, [1, 2, 3, 4, 5]);
  });

  it('bloquear e desbloquear data', async () => {
    await login('adm.hrec@demo.com');
    await chamar('hrecBloquearData', { dateISO: '2099-12-25', motivo: 'Natal' });
    let cfg = await chamar('hrecAdminConfig');
    assert.ok(cfg.data.bloqueios.some(b => b.dateISO === '2099-12-25'));
    await chamar('hrecDesbloquearData', { dateISO: '2099-12-25' });
    cfg = await chamar('hrecAdminConfig');
    assert.ok(!cfg.data.bloqueios.some(b => b.dateISO === '2099-12-25'));
  });

  it('corretor não acessa a administração', async () => {
    await login('cor.op@demo.com');
    await esperaErro(chamar('hrecAdminConfig'), 'permission-denied');
    await esperaErro(chamar('hrecSalvarConfigPix', { pix: { chave: 'x' } }), 'permission-denied');
  });
});

describe('H-REC Bloco 12 — Notificações', () => {
  it('corretor recebe notificações in-app dos eventos (entrega/adicional do Bloco 8)', async () => {
    await login('cor.op@demo.com');
    const r = await chamar('hrecMinhasNotifs');
    assert.ok(r.data.itens.length >= 1, 'tem ao menos uma notificação');
    assert.ok(r.data.naoLidas >= 1);
    assert.ok(r.data.itens.some(n => n.tipo === 'material' || n.tipo === 'adicional'), 'tem notif de material/adicional');
  });

  it('marcar como lidas zera o não-lidas', async () => {
    await login('cor.op@demo.com');
    await chamar('hrecMarcarNotifsLidas');
    const r = await chamar('hrecMinhasNotifs');
    assert.equal(r.data.naoLidas, 0);
  });
});

describe('H-REC caça-bugs — dinheiro dos adicionais', () => {
  async function novoPacote(startAt, extras) {
    await login('cor.op@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO: DIA5, startAt, property: { metragem: 100 }, extras: extras || {} });
    return r.data.bookingId;
  }

  it('BUG1: aprovar adicional em booking CANCELADO é recusado (não prende crédito)', async () => {
    const id = await novoPacote('09:00', { drone: { selecionado: true, quantidade: 1 } });
    await chamar('hrecCancelarBooking', { bookingId: id, motivo: 'teste' });
    const antes = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    await login('fot@demo.com');
    await esperaErro(chamar('hrecAprovarDrone', { bookingId: id }), 'failed-precondition');
    const depois = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    assert.equal(depois, antes); // nada reservado
  });

  it('BUG2: reprovar um adicional já aprovado (pacote) devolve o crédito reservado', async () => {
    const id = await novoPacote('13:00', { drone: { selecionado: true, quantidade: 1 } });
    const saldo0 = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    await login('fot@demo.com');
    await chamar('hrecAprovarDrone', { bookingId: id });
    const saldo1 = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    assert.ok(saldo1 < saldo0, 'aprovar reservou (saldo caiu)');
    await chamar('hrecReprovarDrone', { bookingId: id });
    const saldo2 = (await db.collection('credits').doc('imobOP').get()).data().disponivel;
    assert.equal(saldo2, saldo0, 'reprovar devolveu tudo');
    const b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.financial.creditosReservados, 144); // só a base voltou a ser a reserva
  });

  it('BUG3: adicional avulso só entra no total DEPOIS do Pix confirmado', async () => {
    await login('avu@demo.com');
    const r = await chamar('hrecCriarBooking', { dateISO: DIA5, startAt: '15:30', property: { metragem: 100 }, extras: { drone: { selecionado: true, quantidade: 1 } } });
    const id = r.data.bookingId;
    let b = (await db.collection('bookings').doc(id).get()).data();
    const base = b.financial.valorTotalConfirmado; // 230 (drone pendente na criação)
    await login('fot@demo.com');
    await chamar('hrecAprovarDrone', { bookingId: id });
    b = (await db.collection('bookings').doc(id).get()).data();
    assert.equal(b.financial.valorTotalConfirmado, base, 'aprovar NÃO conta o drone ainda (avulso)');
    const pend = (b.pagamentosAdicionais || []).find(p => p.extraId === 'drone' && p.status === 'pending_confirmation');
    assert.ok(pend, 'gerou Pix pendente do drone');
    await login('adm.hrec@demo.com');
    await chamar('hrecConfirmarPagamento', { paymentId: pend.id });
    b = (await db.collection('bookings').doc(id).get()).data();
    assert.ok(b.financial.valorTotalConfirmado > base, 'depois do Pix confirmado, o drone entra no total');
  });
});
