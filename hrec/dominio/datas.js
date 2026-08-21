/* H-REC AGENDA — helpers de data/hora/fuso e formatação (MD §1 Bloco 1, §3 regra 5).
 * TODO horário e data no fuso America/Sao_Paulo. Funções puras: recebem `now` por
 * parâmetro, nunca chamam Date.now() dentro (MD §13). Corrige o bug #8 do protótipo
 * (grade calculada com getDay() em hora local do navegador).
 * UMD: require() nas Cloud Functions / global window.Hrec.Datas no renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Hrec = root.Hrec || {}; root.Hrec.Datas = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';
  var _fmtISO = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  // 'YYYY-MM-DD' de hoje NO FUSO de SP, a partir de um Date `now` (recebido, não Date.now()).
  function hojeISO(now) {
    if (!(now instanceof Date)) throw new Error('hojeISO exige um Date `now`.');
    return _fmtISO.format(now); // en-CA já entrega YYYY-MM-DD
  }

  var _fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // "Agora" no fuso de SP a partir de um Date `now`: { iso, minutos } (minutos do dia 0..1439).
  function nowSP(now) {
    if (!(now instanceof Date)) throw new Error('nowSP exige um Date `now`.');
    return { iso: _fmtISO.format(now), minutos: hhmm2min(_fmtHM.format(now)) };
  }

  function _parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) throw new Error('ISO inválido: ' + iso);
    return { y: +m[1], mo: +m[2], d: +m[3] };
  }
  function _pad(n) { return (n < 10 ? '0' : '') + n; }

  // Dia da semana FUSO-SAFE: 0=domingo … 6=sábado. Usa meio-dia UTC pra não escorregar
  // de dia por causa do fuso do dispositivo (a data já é "civil", sem hora).
  function diaSemana(iso) {
    var p = _parts(iso);
    return new Date(Date.UTC(p.y, p.mo - 1, p.d, 12, 0, 0)).getUTCDay();
  }

  // Soma `n` dias a um 'YYYY-MM-DD' (n pode ser negativo). Aritmética em UTC → sem DST.
  function addDias(iso, n) {
    var p = _parts(iso);
    var dt = new Date(Date.UTC(p.y, p.mo - 1, p.d, 12, 0, 0));
    dt.setUTCDate(dt.getUTCDate() + (n | 0));
    return dt.getUTCFullYear() + '-' + _pad(dt.getUTCMonth() + 1) + '-' + _pad(dt.getUTCDate());
  }

  // Comparação de datas civis (string ISO já ordena lexicograficamente, mas explicitamos).
  function isoAntesDe(a, b) { return String(a) < String(b); }

  function hhmm2min(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) throw new Error('hora inválida: ' + hhmm);
    return (+m[1]) * 60 + (+m[2]);
  }
  function min2hhmm(mins) {
    mins = ((mins % 1440) + 1440) % 1440; // normaliza pro dia
    return _pad(Math.floor(mins / 60)) + ':' + _pad(mins % 60);
  }

  // "2h", "1h30", "45min", "30min"
  function formatDur(mins) {
    mins = Math.max(0, Math.round(mins || 0));
    var h = Math.floor(mins / 60), mm = mins % 60;
    if (!h) return mm + 'min';
    return mm ? (h + 'h' + _pad(mm)) : (h + 'h');
  }

  var _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function brl(n) { return _brl.format(Number(n) || 0); }

  // Arredondamento monetário: só no FIM do cálculo (MD §13).
  function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  return {
    TZ: TZ,
    hojeISO: hojeISO,
    nowSP: nowSP,
    diaSemana: diaSemana,
    addDias: addDias,
    isoAntesDe: isoAntesDe,
    hhmm2min: hhmm2min,
    min2hhmm: min2hhmm,
    formatDur: formatDur,
    brl: brl,
    r2: r2
  };
});
