// H-REC AGENDA — testes dos motores puros (Bloco 1 + 3). node --test.
// Tabela sintética: valida a LÓGICA sem depender dos valores do protótipo (pendentes).
import test from 'node:test';
import assert from 'node:assert/strict';

import Enums from '../../hrec/dominio/enums.js';
import Datas from '../../hrec/dominio/datas.js';
import Precificacao from '../../hrec/dominio/precificacao.js';
import Seed from '../../hrec/dominio/seed.js';

const { APROVACAO, PAYMENT_STATUS } = Enums;

// --- Tabela + catálogo sintéticos ------------------------------------------------
const TABELA = {
  id: 'teste', nome: 'Teste', descontoPercentual: 20,
  adicionaisPermitidos: ['vv', 'com_desc', 'drone', 'ia'],
  faixas: [
    { id: 1, min: 0, max: 80, valorReferencia: 500, valorFinal: 400, tempoMinutos: 60, ativo: true },
    { id: 2, min: 80, max: 160, valorReferencia: 700, valorFinal: 560, tempoMinutos: 90, ativo: true },
    { id: 3, min: 160, max: 500, valorReferencia: 1000, valorFinal: 800, tempoMinutos: 120, ativo: true },
    { id: 4, min: 500, max: null, sobConsulta: true, tempoMinutos: 180, ativo: true }
  ]
};
const CAT = [
  { id: 'vv', nome: 'Vídeo vertical', valor: 100, tipoCobranca: 'fixed', tempoAdicionalMinutos: 15, recebeDesconto: false, ordem: 1 },
  { id: 'com_desc', nome: 'Com desconto', valor: 100, tipoCobranca: 'fixed', tempoAdicionalMinutos: 0, recebeDesconto: true, ordem: 2 },
  { id: 'drone', nome: 'Drone', valor: 600, tipoCobranca: 'per_unit', tempoAdicionalMinutos: 30, recebeDesconto: false, ordem: 3 },
  { id: 'ia', nome: 'Vídeo IA', valor: 50, tipoCobranca: 'from_minimum', tempoAdicionalMinutos: 0, recebeDesconto: false, ordem: 4 }
];
const calc = (metragem, extras) => Precificacao.calcular({ metragem, tabela: TABELA, catalogoAdicionais: CAT, extras: extras || {} });

// --- Faixas: min EXCLUSIVO, max INCLUSIVO, decimal ------------------------------
test('faixa: min exclusivo / max inclusivo / decimal', () => {
  assert.equal(calc(80).faixaId, 1);     // 80 <= 80 (inclusivo)
  assert.equal(calc(80.5).faixaId, 2);   // 80.5 > 80 (exclusivo) — metragem decimal
  assert.equal(calc(160).faixaId, 2);    // 160 <= 160
  assert.equal(calc(500).faixaId, 3);    // 500 <= 500
  assert.equal(calc(0.1).faixaId, 1);
});

test('faixa base: valorBase = valorFinal, desconto = ref - final', () => {
  const c = calc(100);
  assert.equal(c.valorBase, 560);
  assert.equal(c.valorReferencia, 700);
  assert.equal(c.descontoBase, 140);
  assert.equal(c.tempoPresencial, 90);
  assert.equal(c.totalConfirmado, 560);
});

test('sobConsulta (>500 m²): sem preço, vira orçamento', () => {
  const c = calc(501);
  assert.equal(c.sobConsulta, true);
  assert.equal(c.valorBase, null);
  assert.equal(c.totalConfirmado, 0);
});

// --- Adicionais ------------------------------------------------------------------
test('per_unit multiplica por quantidade e soma tempo por unidade', () => {
  const c = calc(100, { drone: { selecionado: true, quantidade: 2, status: APROVACAO.APROVADO } });
  assert.equal(c.totalConfirmado, 560 + 1200);   // 600 * 2
  assert.equal(c.tempoPresencial, 90 + 60);      // 30 * 2
  assert.equal(c.itensConfirmados.length, 1);
});

test('recebeDesconto aplica o % da parceria só quando true', () => {
  const c = calc(100, {
    vv: { selecionado: true, status: APROVACAO.APROVADO },        // sem desconto → 100
    com_desc: { selecionado: true, status: APROVACAO.APROVADO }   // com desconto 20% → 80
  });
  assert.equal(c.totalConfirmado, 560 + 100 + 80);
});

test('reprovado é ignorado por completo', () => {
  const c = calc(100, { drone: { selecionado: true, quantidade: 3, status: APROVACAO.REPROVADO } });
  assert.equal(c.totalConfirmado, 560);
  assert.equal(c.tempoPresencial, 90);           // nem soma o tempo
  assert.equal(c.itensConfirmados.length, 0);
  assert.equal(c.itensPendentes.length, 0);
});

test('aprovado mas aguardando pagamento → pendente (não entra no confirmado)', () => {
  const c = calc(100, { drone: { selecionado: true, status: APROVACAO.APROVADO, paymentStatus: PAYMENT_STATUS.PENDING_CONFIRMATION } });
  assert.equal(c.totalConfirmado, 560);
  assert.equal(c.itensPendentes.length, 1);
  assert.equal(c.itensConfirmados.length, 0);
});

test('from_minimum usa valorDefinido quando a H-REC já orçou', () => {
  const c = calc(100, { ia: { selecionado: true, status: APROVACAO.APROVADO, valorDefinido: 350 } });
  assert.equal(c.totalConfirmado, 560 + 350);
});

test('tempoOperacional = presencial + buffer de deslocamento', () => {
  assert.equal(Precificacao.tempoOperacional(90, 30), 120);
});

// --- Resolução de tabela ---------------------------------------------------------
test('resolverTabela: explícita → imobiliária → fallback padrao_hrec', () => {
  const tabelas = { padrao_hrec: { id: 'padrao_hrec' }, remax_empire: { id: 'remax_empire' } };
  assert.equal(Precificacao.resolverTabela({ pricingTableId: 'remax_empire', tabelas }).id, 'remax_empire');
  assert.equal(Precificacao.resolverTabela({ imobiliaria: { pricingTableId: 'remax_empire' }, tabelas }).id, 'remax_empire');
  assert.equal(Precificacao.resolverTabela({ tabelas }).id, 'padrao_hrec');
});

// --- Helpers de data: virada de mês, bissexto, fuso -----------------------------
test('addDias: virada de mês, ano e bissexto', () => {
  assert.equal(Datas.addDias('2026-01-31', 1), '2026-02-01');
  assert.equal(Datas.addDias('2026-03-01', -1), '2026-02-28');
  assert.equal(Datas.addDias('2024-02-28', 1), '2024-02-29'); // 2024 bissexto
  assert.equal(Datas.addDias('2026-12-31', 1), '2027-01-01');
});

test('diaSemana é fuso-safe (0=domingo)', () => {
  assert.equal(Datas.diaSemana('2026-01-01'), 4); // quinta
  assert.equal(Datas.diaSemana('2026-08-16'), 0); // domingo
});

test('hojeISO respeita America/Sao_Paulo (UTC-3)', () => {
  // 02:30Z de 20/08 = 23:30 de 19/08 em SP
  assert.equal(Datas.hojeISO(new Date('2026-08-20T02:30:00Z')), '2026-08-19');
});

test('conversões e formatação de hora/dinheiro', () => {
  assert.equal(Datas.hhmm2min('14:00'), 840);
  assert.equal(Datas.min2hhmm(840), '14:00');
  assert.equal(Datas.formatDur(90), '1h30');
  assert.equal(Datas.formatDur(120), '2h');
  assert.equal(Datas.formatDur(45), '45min');
  assert.equal(Datas.r2(0.1 + 0.2), 0.3);
});

// --- Paridade com o SEED real (as 2 tabelas do protótipo) -----------------------
const MAPA = Seed.tabelasMapa();
const calcSeed = (id, metragem, extras) => Precificacao.calcular({
  metragem, tabela: MAPA[id], catalogoAdicionais: Seed.ADICIONAIS, extras: extras || {}
});

test('seed: cada faixa cobrável casa metragem→valorFinal (as 2 tabelas)', () => {
  Seed.TABELAS.forEach(t => {
    t.faixas.filter(f => !f.sobConsulta).forEach(f => {
      const c = calcSeed(t.id, f.max);           // metragem = teto (inclusivo) da faixa
      assert.equal(c.faixaId, f.id, `${t.id} faixa ${f.id} @ ${f.max}m²`);
      assert.equal(c.valorBase, f.valorFinal, `${t.id} faixa ${f.id} valorBase`);
      assert.equal(c.tempoPresencial, f.tempoMinutos, `${t.id} faixa ${f.id} tempo`);
    });
  });
});

test('seed: REMAX Empire = 20% de desconto exato em toda faixa cobrável', () => {
  MAPA.remax_empire.faixas.filter(f => !f.sobConsulta).forEach(f => {
    assert.equal(f.valorFinal, Datas.r2(f.valorReferencia * 0.8), `Empire faixa ${f.id}`);
  });
  assert.equal(MAPA.remax_empire.descontoPercentual, 20);
  assert.equal(MAPA.padrao_hrec.descontoPercentual, 0);
});

test('seed: > 500 m² é sobConsulta nas duas tabelas', () => {
  assert.equal(calcSeed('padrao_hrec', 501).sobConsulta, true);
  assert.equal(calcSeed('remax_empire', 999).sobConsulta, true);
});

test('seed: escolheFormatoVideo — padrão pergunta, Empire não', () => {
  assert.equal(MAPA.padrao_hrec.escolheFormatoVideo, true);
  assert.equal(MAPA.remax_empire.escolheFormatoVideo, false);
});

test('seed: adicional não recebe desconto de parceria mesmo na Empire', () => {
  // drone (per_unit 600, recebeDesconto:false) na Empire (20%): continua 600, sem desconto.
  const c = calcSeed('remax_empire', 100, { drone: { selecionado: true, quantidade: 1, status: APROVACAO.APROVADO } });
  const base = MAPA.remax_empire.faixas.find(f => f.id === 2).valorFinal; // 100 m² → faixa 2 (80–120) = 144
  assert.equal(c.valorBase, base);
  assert.equal(c.totalConfirmado, base + 600);
});

test('seed: marca sem barra — nome da parceria é "REMAX", nunca "RE/MAX"', () => {
  assert.match(MAPA.remax_empire.nome, /REMAX/);
  assert.doesNotMatch(MAPA.remax_empire.nome, /RE\/MAX/);
  assert.doesNotMatch(MAPA.remax_empire.descricao, /RE\/MAX/);
});

test('seed: 5 adicionais exatos (id, valor, cobrança, tempo)', () => {
  const byId = Object.fromEntries(Seed.ADICIONAIS.map(a => [a.id, a]));
  assert.equal(byId.drone.valor, 600);
  assert.equal(byId.drone.tipoCobranca, 'per_unit');
  assert.equal(byId.video_ia.tipoCobranca, 'from_minimum');
  assert.equal(byId.video_ia.tempoAdicionalMinutos, 0);
  assert.equal(byId.video_vertical_editado.exigeRoteiro, true);
  assert.ok(Seed.ADICIONAIS.every(a => a.recebeDesconto === false));
});
