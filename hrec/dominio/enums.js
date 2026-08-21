/* H-REC AGENDA — enums canônicos (MD §5).
 * Fonte única de status/papéis/tipos. Nenhuma string de status escrita fora daqui.
 * UMD: require() nas Cloud Functions / global window.Hrec.Enums no renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Hrec = root.Hrec || {}; root.Hrec.Enums = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOOKING_STATUS = {
    AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
    PAGAMENTO_EXPIRADO: 'pagamento_expirado',
    PAGAMENTO_PENDENTE_REVISAO: 'pagamento_pendente_revisao',
    AGUARDANDO_ORCAMENTO: 'aguardando_orcamento',
    AGENDADO: 'agendado',
    CONFIRMADO: 'confirmado',
    SERVICO_INICIADO: 'servico_iniciado',
    CAPTACAO_CONCLUIDA: 'captacao_concluida',
    EM_TRATAMENTO: 'em_tratamento',
    MATERIAL_ENTREGUE: 'material_entregue',
    CANCELADO: 'cancelado',
    NAO_REALIZADO: 'nao_realizado'
  };

  var MATERIAL_STATUS = {
    AGUARDANDO_SESSAO: 'aguardando_sessao',
    EM_CAPTACAO: 'em_captacao',
    EM_TRATAMENTO: 'em_tratamento',
    DISPONIVEL: 'material_disponivel'
  };

  var APROVACAO = {
    NAO_SOLICITADO: 'nao_solicitado',
    AGUARDANDO_ANALISE: 'aguardando_analise',
    AGUARDANDO_ORCAMENTO: 'aguardando_orcamento',
    ORCADO: 'orcado',
    APROVADO: 'aprovado',
    REPROVADO: 'reprovado'
  };

  var PAYMENT_STATUS = {
    PENDING_CONFIRMATION: 'pending_confirmation',
    PAID: 'paid',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired'
  };

  var PAPEIS = {
    CORRETOR: 'corretor',
    AVULSO: 'avulso',
    BROKER: 'broker',
    FOTOGRAFO: 'fotografo',
    ADMINISTRADOR: 'administrador'
  };

  var TIPO_COBRANCA = {
    FIXED: 'fixed',
    PER_UNIT: 'per_unit',
    FROM_MINIMUM: 'from_minimum',
    MANUAL: 'manual'
  };

  // Status que NÃO bloqueiam a agenda (MD §5). Hold vencido + pending_confirmation
  // também não bloqueia, mas isso depende de `now` e é tratado no motor de disponibilidade.
  var STATUS_NAO_BLOQUEIA = [
    BOOKING_STATUS.CANCELADO,
    BOOKING_STATUS.NAO_REALIZADO,
    BOOKING_STATUS.AGUARDANDO_ORCAMENTO,
    BOOKING_STATUS.PAGAMENTO_EXPIRADO
  ];

  return {
    BOOKING_STATUS: BOOKING_STATUS,
    MATERIAL_STATUS: MATERIAL_STATUS,
    APROVACAO: APROVACAO,
    PAYMENT_STATUS: PAYMENT_STATUS,
    PAPEIS: PAPEIS,
    TIPO_COBRANCA: TIPO_COBRANCA,
    STATUS_NAO_BLOQUEIA: STATUS_NAO_BLOQUEIA
  };
});
