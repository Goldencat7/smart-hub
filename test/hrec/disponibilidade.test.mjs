// H-REC AGENDA — testes do motor de disponibilidade (Bloco 4). node --test.
import test from 'node:test';
import assert from 'node:assert/strict';

import Enums from '../../hrec/dominio/enums.js';
import Datas from '../../hrec/dominio/datas.js';
import Disp from '../../hrec/dominio/disponibilidade.js';
import Seed from '../../hrec/dominio/seed.js';

const CFG = Seed.CONFIG_AGENDA; // 09-18, almoço 12-13, grade 15, buffer 30, antecedência 24h, limiteDia 5
const QUINTA = '2026-08-20';    // dia útil (quinta)
const DOMINGO = '2026-08-16';   // fora de atendimento
const PASSADO_NOW = new Date('2026-08-01T12:00:00Z'); // bem antes → sem antecedência atrapalhando

const booking = (dateISO, startAt, dur, extra) => Object.assign({
  codigo: 'HREC-x', status: Enums.BOOKING_STATUS.CONFIRMADO,
  schedule: { dateISO, startAt, durationMinutes: dur }
}, extra || {});

const hhmms = (slots) => slots.map(s => s.hhmm);
const cruzaAlmoco = (s, almI, almF) => s.inicio < almF && s.fim > almI;

test('dia útil vazio: começa 09:00, respeita janela, nada cruza o almoço', () => {
  const slots = Disp.getAvailableSlots([], QUINTA, 60, CFG);
  assert.equal(slots[0].hhmm, '09:00');
  const almI = Datas.hhmm2min(CFG.almocoInicio), almF = Datas.hhmm2min(CFG.almocoFim);
  assert.ok(slots.every(s => !cruzaAlmoco(s, almI, almF)), 'nenhum slot cruza o almoço');
  assert.ok(slots.every(s => s.fim <= Datas.hhmm2min(CFG.horaFim)), 'nada passa das 18:00');
  assert.equal(hhmms(slots).includes('12:00'), false); // 12:00-13:00 cai no almoço
  assert.equal(hhmms(slots).includes('13:00'), true);
});

test('sessão longa não é oferecida se não cabe até o fim do dia', () => {
  const slots = Disp.getAvailableSlots([], QUINTA, 120, CFG); // 2h
  const ultimo = slots[slots.length - 1];
  assert.equal(ultimo.fim <= Datas.hhmm2min(CFG.horaFim), true);
  assert.equal(ultimo.hhmm, '16:00'); // 16:00+2h = 18:00, último possível
  assert.equal(hhmms(slots).includes('17:00'), false); // terminaria 19:00
});

test('buffer de deslocamento dos DOIS lados ao redor de ocupação', () => {
  const oc = Disp.getDayOccupancy([booking(QUINTA, '14:00', 60)], QUINTA); // ocupa 14:00-15:00
  const set = new Set(hhmms(Disp.getAvailableSlots(oc, QUINTA, 60, CFG)));
  assert.equal(set.has('15:30'), true);  // 15:00 + buffer 30 → livre a partir de 15:30
  assert.equal(set.has('15:15'), false); // ainda dentro do buffer
  assert.equal(set.has('15:00'), false);
  assert.equal(set.has('14:00'), false);
  assert.equal(set.has('13:30'), false); // terminaria 14:30, invade o job das 14:00
});

test('limiteDia: dia com o teto de jobs ativos fica indisponível', () => {
  const slots = Disp.getAvailableSlots([], QUINTA, 60, CFG, { ativosNoDia: CFG.limiteDia });
  assert.equal(slots.length, 0);
});

test('dias bloqueados e fora de atendimento retornam vazio', () => {
  assert.equal(Disp.getAvailableSlots([], DOMINGO, 60, CFG).length, 0); // domingo não atende
  assert.equal(Disp.getAvailableSlots([], QUINTA, 60, CFG, { blockedDates: [QUINTA] }).length, 0);
});

test('antecedência mínima (24h) zera o dia de HOJE, mas não os futuros', () => {
  const now = new Date('2026-08-20T13:00:00Z'); // 10:00 em SP, hoje = 2026-08-20
  const nowSP = Datas.nowSP(now);
  const hoje = Disp.getAvailableSlots([], QUINTA, 60, CFG, { now, nowSP });
  assert.equal(hoje.length, 0); // +24h já é amanhã
  const amanha = Disp.getAvailableSlots([], '2026-08-21', 60, CFG, { now, nowSP });
  assert.ok(amanha.length > 0);
});

test('bloqueia(): cancelado não bloqueia; hold vencido + pagamento pendente libera', () => {
  const nowMs = new Date('2026-08-20T12:00:00Z').getTime();
  assert.equal(Disp.bloqueia(booking(QUINTA, '10:00', 60), nowMs), true);
  assert.equal(Disp.bloqueia(booking(QUINTA, '10:00', 60, { status: Enums.BOOKING_STATUS.CANCELADO }), nowMs), false);
  const holdVencido = booking(QUINTA, '10:00', 60, {
    status: Enums.BOOKING_STATUS.AGUARDANDO_PAGAMENTO,
    holdExpiresAt: nowMs - 60000,
    payment: { status: Enums.PAYMENT_STATUS.PENDING_CONFIRMATION }
  });
  assert.equal(Disp.bloqueia(holdVencido, nowMs), false);
});

test('getDayOccupancy: só do dia, ignora cancelado e o próprio (ignoreCode), ordenado', () => {
  const bs = [
    booking(QUINTA, '15:00', 60, { codigo: 'B' }),
    booking(QUINTA, '09:00', 60, { codigo: 'A' }),
    booking(QUINTA, '11:00', 60, { codigo: 'CANC', status: Enums.BOOKING_STATUS.CANCELADO }),
    booking('2026-08-21', '10:00', 60, { codigo: 'OUTRO_DIA' })
  ];
  const oc = Disp.getDayOccupancy(bs, QUINTA, { ignoreCode: 'B' });
  assert.deepEqual(oc.map(o => o.codigo), ['A']); // B ignorado, CANC não bloqueia, outro dia fora
});

test('getMonthAvailability: 1 passada, marca passado/bloqueado/disponível e é rápido', () => {
  // 200 bookings concentrados nos dias 3/5/7 (viram 'lotado'); dia 20 fica livre.
  const bookings = [];
  const carga = ['03', '05', '07'];
  for (let i = 0; i < 200; i++) bookings.push(booking('2026-08-' + carga[i % 3], '10:00', 60, { codigo: 'B' + i }));

  const now = new Date('2026-08-10T12:00:00Z'); // hoje = 2026-08-10
  const nowSP = Datas.nowSP(now);
  const t0 = process.hrtime.bigint();
  const mapa = Disp.getMonthAvailability(bookings, 2026, 8, 120, CFG, { now, nowSP });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.equal(mapa.size, 31);                              // agosto tem 31 dias
  assert.equal(mapa.get('2026-08-16').status, 'bloqueado'); // domingo
  assert.equal(mapa.get('2026-08-05').status, 'passado');   // antes de hoje (10)
  assert.equal(mapa.get('2026-08-20').status, 'disponivel'); // quinta, sem bookings
  assert.ok(ms < 50, `getMonthAvailability levou ${ms.toFixed(2)}ms (esperado « 50ms)`);
});
