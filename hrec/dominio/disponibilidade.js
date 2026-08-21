/* H-REC AGENDA — motor de disponibilidade (MD §7). Função PURA, compartilhada entre
 * cliente e Cloud Function (o cliente mostra; a function revalida o slot na transação
 * antes de gravar — SLOT_TAKEN). Recebe `now` por parâmetro (nunca Date.now() dentro).
 * Performance: getMonthAvailability indexa os bookings do mês UMA vez (O(bookings+dias)),
 * não O(bookings × dias) como o protótipo (bug #12).
 * UMD: require() nas Functions / global window.Hrec.Disponibilidade no renderer
 * (carregar enums.js e datas.js ANTES no browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./enums'), require('./datas'));
  else { root.Hrec = root.Hrec || {}; root.Hrec.Disponibilidade = factory(root.Hrec.Enums, root.Hrec.Datas); }
})(typeof self !== 'undefined' ? self : this, function (Enums, Datas) {
  'use strict';

  var PAY = Enums.PAYMENT_STATUS;
  var NAO_BLOQUEIA = Enums.STATUS_NAO_BLOQUEIA;
  var hhmm2min = Datas.hhmm2min, min2hhmm = Datas.min2hhmm, diaSemana = Datas.diaSemana;

  function _ms(ts) {
    if (ts == null) return null;
    if (typeof ts === 'number') return ts;
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts.toMillis === 'function') return ts.toMillis();          // Firestore Timestamp
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;         // {seconds,nanoseconds}
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;       // Admin SDK serializado
    var t = Date.parse(ts); return isNaN(t) ? null : t;
  }

  // Um booking bloqueia a agenda? Exclui status não-bloqueantes e HOLD vencido pendente.
  function bloqueia(b, nowMs) {
    if (!b || !b.schedule || !b.schedule.dateISO || !b.schedule.startAt) return false;
    if (NAO_BLOQUEIA.indexOf(b.status) >= 0) return false;
    // Hold vencido + pagamento ainda pendente = slot liberado (MD §5).
    var hold = _ms(b.holdExpiresAt);
    var pagPend = b.payment && b.payment.status === PAY.PENDING_CONFIRMATION;
    if (hold != null && nowMs != null && hold < nowMs && pagPend) return false;
    return true;
  }

  // Intervalos ocupados [inicio,fim] (minutos do dia) de um dia. `ignoreCode` pula um
  // booking (edição do próprio). `nowMs` avalia holds vencidos.
  function getDayOccupancy(bookings, dateISO, opts) {
    opts = opts || {};
    var ignore = opts.ignoreCode || null, nowMs = opts.nowMs != null ? opts.nowMs : (opts.now ? opts.now.getTime() : null);
    var out = [];
    (bookings || []).forEach(function (b) {
      if (!b || (b.schedule && b.schedule.dateISO) !== dateISO) return;
      if (ignore && b.codigo === ignore) return;
      if (!bloqueia(b, nowMs)) return;
      var ini = hhmm2min(b.schedule.startAt);
      var dur = Number(b.schedule.durationMinutes) || 0; // tempo PRESENCIAL (sem buffer)
      out.push({ inicio: ini, fim: ini + dur, codigo: b.codigo || null });
    });
    return out.sort(function (a, c) { return a.inicio - c.inicio; });
  }

  // Slots livres de um dia pra uma sessão de `durationMin`. Aplica: dia de atendimento,
  // data bloqueada, limiteDia, janela do dia, almoço, antecedência (só se dateISO===hoje),
  // colisão com ocupação incluindo buffer dos DOIS lados.
  function getAvailableSlots(occupancy, dateISO, durationMin, config, opts) {
    opts = opts || {};
    config = config || {};
    durationMin = Number(durationMin) || 0;
    if (durationMin <= 0) return [];

    var blocked = opts.blockedDates || [];
    var blockedSet = (blocked instanceof Set) ? blocked : new Set(blocked);
    if (blockedSet.has(dateISO)) return [];

    var dias = config.diasAtendimento || [1, 2, 3, 4, 5, 6];
    if (dias.indexOf(diaSemana(dateISO)) < 0) return [];

    // limiteDia: se o dia já tem `limiteDia` bookings ativos, dia inteiro indisponível (bug #6).
    var ativosNoDia = opts.ativosNoDia != null ? opts.ativosNoDia : (occupancy || []).length;
    if (config.limiteDia && ativosNoDia >= config.limiteDia) return [];

    var abre = hhmm2min(config.horaInicio || '09:00');
    var fecha = hhmm2min(config.horaFim || '18:00');
    var almI = config.almocoInicio ? hhmm2min(config.almocoInicio) : null;
    var almF = config.almocoFim ? hhmm2min(config.almocoFim) : null;
    var grade = Number(config.gradeMinutos) || 15;
    var buffer = Number(config.travelBufferMinutes) || 0;

    // Antecedência mínima só quando é HOJE (MD §7). now vem por opts.
    var minInicio = abre;
    if (opts.now && opts.nowSP) {
      var nSP = opts.nowSP;
      if (nSP.iso === dateISO) minInicio = Math.max(abre, nSP.minutos + (Number(config.antecedenciaHoras) || 0) * 60);
      else if (dateISO < nSP.iso) return []; // passado
    }

    var oc = occupancy || [];
    var slots = [];
    for (var t = abre; t + durationMin <= fecha; t += grade) {
      if (t < minInicio) continue;
      // Não cruzar o almoço.
      if (almI != null && almF != null && t < almF && t + durationMin > almI) continue;
      // Colisão com ocupação existente, com buffer dos dois lados.
      var colide = false;
      for (var i = 0; i < oc.length; i++) {
        if (t < oc[i].fim + buffer && t + durationMin + buffer > oc[i].inicio) { colide = true; break; }
      }
      if (colide) continue;
      slots.push({ inicio: t, fim: t + durationMin, hhmm: min2hhmm(t), fimHhmm: min2hhmm(t + durationMin) });
    }
    return slots;
  }

  function _pad(n) { return (n < 10 ? '0' : '') + n; }
  function _diasNoMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); } // mes 1..12

  // Disponibilidade do mês inteiro numa passagem. Retorna Map<dateISO, { status, slots, total }>.
  // status: passado | bloqueado | lotado | indisponivel | disponivel.
  function getMonthAvailability(bookings, ano, mes, durationMin, config, opts) {
    opts = opts || {};
    config = config || {};
    var nowSP = opts.nowSP || null, nowMs = opts.now ? opts.now.getTime() : null;
    var blocked = opts.blockedDates || [];
    var blockedSet = (blocked instanceof Set) ? blocked : new Set(blocked);
    var dias = config.diasAtendimento || [1, 2, 3, 4, 5, 6];

    // 1 passada: indexa ocupação e conta ativos por dia.
    var porDia = new Map(), ativosPorDia = new Map();
    (bookings || []).forEach(function (b) {
      var iso = b && b.schedule && b.schedule.dateISO;
      if (!iso) return;
      if (!bloqueia(b, nowMs)) return;
      var ini = hhmm2min(b.schedule.startAt), dur = Number(b.schedule.durationMinutes) || 0;
      if (!porDia.has(iso)) porDia.set(iso, []);
      porDia.get(iso).push({ inicio: ini, fim: ini + dur, codigo: b.codigo || null });
      ativosPorDia.set(iso, (ativosPorDia.get(iso) || 0) + 1);
    });

    var out = new Map();
    var total = _diasNoMes(ano, mes);
    for (var d = 1; d <= total; d++) {
      var iso = ano + '-' + _pad(mes) + '-' + _pad(d);
      var reg;
      if (nowSP && iso < nowSP.iso) { reg = { status: 'passado', slots: [], total: 0 }; }
      else if (blockedSet.has(iso) || dias.indexOf(diaSemana(iso)) < 0) { reg = { status: 'bloqueado', slots: [], total: 0 }; }
      else {
        var oc = porDia.get(iso) || [];
        var ativos = ativosPorDia.get(iso) || 0;
        var slots = getAvailableSlots(oc, iso, durationMin, config, { now: opts.now, nowSP: nowSP, blockedDates: blockedSet, ativosNoDia: ativos });
        if (slots.length) reg = { status: 'disponivel', slots: slots, total: ativos };
        else reg = { status: ativos ? 'lotado' : 'indisponivel', slots: [], total: ativos };
      }
      out.set(iso, reg);
    }
    return out;
  }

  return {
    bloqueia: bloqueia,
    getDayOccupancy: getDayOccupancy,
    getAvailableSlots: getAvailableSlots,
    getMonthAvailability: getMonthAvailability
  };
});
