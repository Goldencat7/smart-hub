/* H-REC AGENDA — motor de precificação (MD §6). Função PURA, compartilhada entre
 * cliente e Cloud Function. NUNCA duplicar essa lógica: o cliente calcula pra EXIBIR,
 * a function recalcula pra GRAVAR; se divergirem, vale o backend (MD §3 regra 1).
 * UMD: require() nas Functions / global window.Hrec.Precificacao no renderer
 * (carregar enums.js e datas.js ANTES no browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./enums'), require('./datas'));
  else { root.Hrec = root.Hrec || {}; root.Hrec.Precificacao = factory(root.Hrec.Enums, root.Hrec.Datas); }
})(typeof self !== 'undefined' ? self : this, function (Enums, Datas) {
  'use strict';

  var TC = Enums.TIPO_COBRANCA;
  var APROVACAO = Enums.APROVACAO;
  var PAY = Enums.PAYMENT_STATUS;
  var r2 = Datas.r2;

  // Resolve a tabela de preços: pricingTableId explícito → tabela da imobiliária →
  // fallback 'padrao_hrec' (MD §6 passo 1).
  function resolverTabela(opts) {
    opts = opts || {};
    var tabelas = opts.tabelas || {}; // { [id]: tabela }
    var id = opts.pricingTableId
      || (opts.imobiliaria && opts.imobiliaria.pricingTableId)
      || 'padrao_hrec';
    return tabelas[id] || tabelas['padrao_hrec'] || null;
  }

  // Faixa por metragem: min EXCLUSIVO, max INCLUSIVO (null = sem teto). Só faixas ativas.
  // metragem > min && metragem <= max  (MD §4/§6 passo 2). Não inverter.
  function acharFaixa(tabela, metragem) {
    var faixas = (tabela && tabela.faixas) || [];
    for (var i = 0; i < faixas.length; i++) {
      var f = faixas[i];
      if (!f || f.ativo === false) continue;
      var acimaMin = metragem > f.min;
      var abaixoMax = (f.max == null) || (metragem <= f.max);
      if (acimaMin && abaixoMax) return f;
    }
    return null;
  }

  function _catMap(catalogo) {
    if (!catalogo) return {};
    if (Array.isArray(catalogo)) {
      var m = {};
      catalogo.forEach(function (a) { if (a && a.id) m[a.id] = a; });
      return m;
    }
    return catalogo;
  }

  /* calcular({ metragem, tabela, catalogoAdicionais, extras })
   *  - tabela: objeto pricingTables já resolvido (use resolverTabela antes)
   *  - catalogoAdicionais: array ou mapa de servicosAdicionais
   *  - extras: { [extraId]: { selecionado, quantidade, status, valorDefinido, paymentStatus } }
   * Retorna o BookingCalc (valores pra exibir/gravar). Tempo em minutos, dinheiro em reais.
   */
  function calcular(input) {
    input = input || {};
    var metragem = Number(input.metragem) || 0;
    var tabela = input.tabela || null;
    var extras = input.extras || {};
    var cat = _catMap(input.catalogoAdicionais);

    var base = {
      tabelaId: tabela ? tabela.id : null,
      tabelaNome: tabela ? tabela.nome : null,
      faixaId: null,
      faixaNome: '',
      sobConsulta: false,
      valorReferencia: null,
      descontoBase: 0,
      valorBase: null,
      itensConfirmados: [],
      itensPendentes: [],
      totalConfirmado: 0,
      tempoPresencial: null,
      tempoOperacional: null
    };

    if (!tabela) return Object.assign(base, { erro: 'tabela_nao_resolvida' });

    var faixa = acharFaixa(tabela, metragem);
    if (!faixa) return Object.assign(base, { erro: 'faixa_nao_encontrada' });
    base.faixaId = faixa.id;
    base.faixaNome = faixa.nome || ('Faixa ' + faixa.id);

    // sobConsulta (ex.: > 500 m²) → não precifica, vira solicitação de orçamento (MD §6 passo 3).
    if (faixa.sobConsulta) {
      base.sobConsulta = true;
      base.valorBase = null;
      base.totalConfirmado = 0;
      base.tempoPresencial = faixa.tempoMinutos || null;
      base.tempoOperacional = null; // sem agendamento nesse fluxo
      return base;
    }

    base.valorReferencia = faixa.valorReferencia;
    base.valorBase = faixa.valorFinal;
    base.descontoBase = (faixa.valorReferencia != null && faixa.valorFinal != null)
      ? r2(faixa.valorReferencia - faixa.valorFinal) : 0;

    var permitidos = (tabela.adicionaisPermitidos || []);
    var tempoAdic = 0;
    var totalExtrasConfirmados = 0;

    // Percorre na ordem de `ordem` do catálogo, só os permitidos pela tabela (MD §6 passo 5).
    var idsOrdenados = Object.keys(cat).sort(function (a, b) {
      return (cat[a].ordem || 0) - (cat[b].ordem || 0);
    });

    idsOrdenados.forEach(function (id) {
      if (permitidos.indexOf(id) < 0) return;
      var sel = extras[id];
      if (!sel || !sel.selecionado) return;
      var def = cat[id];
      if (sel.status === APROVACAO.REPROVADO) return; // reprovado: ignora por completo

      var qtd = Math.max(1, Number(sel.quantidade) || 1);
      var valorUnit;
      switch (def.tipoCobranca) {
        case TC.PER_UNIT: valorUnit = (Number(def.valor) || 0) * qtd; break;
        case TC.FROM_MINIMUM:
        case TC.MANUAL:
          // "a partir de" até a H-REC orçar: usa valorDefinido se houver.
          valorUnit = (sel.valorDefinido != null) ? Number(sel.valorDefinido) : (Number(def.valor) || 0);
          break;
        default: // fixed
          valorUnit = Number(def.valor) || 0;
      }
      if (def.recebeDesconto && tabela.descontoPercentual) {
        valorUnit = valorUnit * (1 - (tabela.descontoPercentual / 100));
      }
      valorUnit = r2(valorUnit);

      // Tempo presencial do adicional (per_unit multiplica pela quantidade).
      var t = (Number(def.tempoAdicionalMinutos) || 0);
      if (def.tipoCobranca === TC.PER_UNIT) t = t * qtd;
      tempoAdic += t;

      // Confirmado só quando APROVADO e (sem cobrança OU já paga). Senão, pendente.
      var confirmado = (sel.status === APROVACAO.APROVADO) &&
        (sel.paymentStatus == null || sel.paymentStatus === PAY.PAID);
      var item = { id: id, nome: def.nome, quantidade: qtd, valor: valorUnit, status: sel.status || null };
      if (confirmado) { base.itensConfirmados.push(item); totalExtrasConfirmados += valorUnit; }
      else base.itensPendentes.push(item);
    });

    base.totalConfirmado = r2((base.valorBase || 0) + totalExtrasConfirmados);
    base.tempoPresencial = (faixa.tempoMinutos || 0) + tempoAdic;
    return base;
  }

  // tempoOperacional = presencial + buffer de deslocamento (bloqueia agenda, não é cobrado).
  function tempoOperacional(tempoPresencial, travelBufferMinutes) {
    return (Number(tempoPresencial) || 0) + (Number(travelBufferMinutes) || 0);
  }

  return {
    resolverTabela: resolverTabela,
    acharFaixa: acharFaixa,
    calcular: calcular,
    tempoOperacional: tempoOperacional
  };
});
