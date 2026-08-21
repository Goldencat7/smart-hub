/* H-REC AGENDA — dados de semente (MD §4). Valores EXATOS migrados do protótipo
 * `hrec-agenda.html` (2 tabelas de preço + 5 adicionais) e do MD (configs).
 * Correção obrigatória na migração: a marca é "REMAX", sem barra (MD §3 regra 7 / §11 bug #13).
 * UMD: require() no script de seed / global window.Hrec.Seed no renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Hrec = root.Hrec || {}; root.Hrec.Seed = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // servicosAdicionais/{extraId} — os 5 do protótipo, valores exatos.
  // recebeDesconto:false — adicionais NÃO recebem desconto de parceria (default).
  var ADICIONAIS = [
    {
      id: 'video_vertical_editado', nome: 'Vídeo vertical editado para redes sociais',
      descricao: 'Captação, seleção dos melhores takes, edição, cortes, legendas, sound effects e acabamento para redes sociais. Duração final de até 1 min 30 s.',
      valor: 100, tipoCobranca: 'fixed', tempoAdicionalMinutos: 15,
      requerAprovacao: false, recebeDesconto: false, exigeRoteiro: true,
      ativo: true, ordem: 1, icon: 'video'
    },
    {
      id: 'area_comum', nome: 'Fotos + vídeo das áreas comuns',
      descricao: 'Captação das principais áreas comuns disponíveis do condomínio no momento da sessão: piscina, academia, salão, brinquedoteca, quadra, churrasqueira, espaço gourmet e fachada.',
      valor: 100, tipoCobranca: 'fixed', tempoAdicionalMinutos: 30,
      requerAprovacao: false, recebeDesconto: false,
      ativo: true, ordem: 2, icon: 'building'
    },
    {
      id: 'fotos_360', nome: 'Fotos 360°',
      descricao: 'Captação de fotografias 360° dos principais ambientes do imóvel. Não inclui montagem, hotspots ou hospedagem de tour virtual.',
      valor: 100, tipoCobranca: 'fixed', tempoAdicionalMinutos: 15,
      requerAprovacao: false, recebeDesconto: false,
      ativo: true, ordem: 3, icon: 'rotate-3d'
    },
    {
      id: 'drone', nome: 'Vídeo com drone',
      descricao: 'Captação aérea. Valor e tempo por subida. Sujeito à análise de endereço, espaço aéreo, autorizações e condições climáticas.',
      valor: 600, tipoCobranca: 'per_unit', tempoAdicionalMinutos: 30,
      requerAprovacao: true, recebeDesconto: false,
      ativo: true, ordem: 4, icon: 'send'
    },
    {
      id: 'video_ia', nome: 'Vídeo com IA',
      descricao: 'Mobiliário virtual, transformação de ambiente, animação, inserção de elementos e outras alterações. Serviço de pós-produção — não ocupa tempo presencial.',
      valor: 50, tipoCobranca: 'from_minimum', tempoAdicionalMinutos: 0,
      requerAprovacao: true, recebeDesconto: false,
      ativo: true, ordem: 5, icon: 'sparkles'
    }
  ];

  var ADICIONAIS_PERMITIDOS = ['area_comum', 'video_vertical_editado', 'fotos_360', 'drone', 'video_ia'];

  // pricingTables/{tableId} — valores EXATOS do protótipo.
  // Faixa: min EXCLUSIVO, max INCLUSIVO (null = sem teto). Última faixa (>500 m²) = sobConsulta.
  var TABELAS = [
    {
      id: 'padrao_hrec', nome: 'Tabela Padrão H-REC',
      descricao: 'Condição comercial padrão para clientes sem parceria',
      tipo: 'padrao', descontoPercentual: 0, ativa: true, vigencia: null,
      // Vídeo cru é 1 só: na tabela padrão o corretor escolhe o formato.
      servicosIncluidos: { fotos: true, tratamento: true, videoHorizontal: false, videoVertical: false, areaComumFotos: false, areaComumVideo: false },
      escolheFormatoVideo: true,
      adicionaisPermitidos: ADICIONAIS_PERMITIDOS,
      faixas: [
        { id: 1, min: 0, max: 80, fotosAproximadas: 30, valorReferencia: 180, desconto: 0, valorFinal: 180, tempoMinutos: 60, ativo: true, sobConsulta: false },
        { id: 2, min: 80, max: 160, fotosAproximadas: 40, valorReferencia: 230, desconto: 0, valorFinal: 230, tempoMinutos: 90, ativo: true, sobConsulta: false },
        { id: 3, min: 160, max: 250, fotosAproximadas: 50, valorReferencia: 300, desconto: 0, valorFinal: 300, tempoMinutos: 120, ativo: true, sobConsulta: false },
        { id: 4, min: 250, max: 350, fotosAproximadas: 60, valorReferencia: 350, desconto: 0, valorFinal: 350, tempoMinutos: 150, ativo: true, sobConsulta: false },
        { id: 5, min: 350, max: 500, fotosAproximadas: 70, valorReferencia: 450, desconto: 0, valorFinal: 450, tempoMinutos: 180, ativo: true, sobConsulta: false },
        { id: 6, min: 500, max: null, fotosAproximadas: null, valorReferencia: null, desconto: 0, valorFinal: null, tempoMinutos: null, ativo: true, sobConsulta: true }
      ],
      versao: 1
    },
    {
      // Marca sem barra: "REMAX" (MD §3.7 / bug #13). No protótipo estava "RE/MAX Empire".
      id: 'remax_empire', nome: 'REMAX Empire — Parceria',
      descricao: 'Condição comercial exclusiva REMAX Empire',
      tipo: 'parceria', descontoPercentual: 20, ativa: true, vigencia: null,
      // Vídeo horizontal E vertical já entram na parceria — não perguntar o formato.
      servicosIncluidos: { fotos: true, tratamento: true, videoHorizontal: true, videoVertical: true, areaComumFotos: false, areaComumVideo: false },
      escolheFormatoVideo: false,
      adicionaisPermitidos: ADICIONAIS_PERMITIDOS,
      faixas: [
        { id: 1, min: 0, max: 80, fotosAproximadas: 30, valorReferencia: 150, desconto: 20, valorFinal: 120, tempoMinutos: 60, ativo: true, sobConsulta: false },
        { id: 2, min: 80, max: 120, fotosAproximadas: 35, valorReferencia: 180, desconto: 20, valorFinal: 144, tempoMinutos: 75, ativo: true, sobConsulta: false },
        { id: 3, min: 120, max: 160, fotosAproximadas: 40, valorReferencia: 210, desconto: 20, valorFinal: 168, tempoMinutos: 90, ativo: true, sobConsulta: false },
        { id: 4, min: 160, max: 200, fotosAproximadas: 45, valorReferencia: 240, desconto: 20, valorFinal: 192, tempoMinutos: 105, ativo: true, sobConsulta: false },
        { id: 5, min: 200, max: 250, fotosAproximadas: 50, valorReferencia: 270, desconto: 20, valorFinal: 216, tempoMinutos: 120, ativo: true, sobConsulta: false },
        { id: 6, min: 250, max: 300, fotosAproximadas: 55, valorReferencia: 300, desconto: 20, valorFinal: 240, tempoMinutos: 135, ativo: true, sobConsulta: false },
        { id: 7, min: 300, max: 400, fotosAproximadas: 60, valorReferencia: 350, desconto: 20, valorFinal: 280, tempoMinutos: 150, ativo: true, sobConsulta: false },
        { id: 8, min: 400, max: 500, fotosAproximadas: 70, valorReferencia: 400, desconto: 20, valorFinal: 320, tempoMinutos: 180, ativo: true, sobConsulta: false },
        { id: 9, min: 500, max: null, fotosAproximadas: null, valorReferencia: null, desconto: 20, valorFinal: null, tempoMinutos: null, ativo: true, sobConsulta: true }
      ],
      versao: 1
    }
  ];

  var TABELA_FALLBACK = 'padrao_hrec';

  // Vira um mapa { [id]: tabela } — formato que o motor de preço espera em `tabelas`.
  function tabelasMapa() {
    var m = {};
    TABELAS.forEach(function (t) { m[t.id] = t; });
    return m;
  }

  // config/agenda — documento único (MD §4). Valores exatos.
  var CONFIG_AGENDA = {
    timezone: 'America/Sao_Paulo',
    travelBufferMinutes: 30,
    gradeMinutos: 15,
    horaInicio: '09:00',
    horaFim: '18:00',
    almocoInicio: '12:00',
    almocoFim: '13:00',
    antecedenciaHoras: 24,
    limiteDia: 5,               // MÁXIMO DE JOBS POR DIA — aplicar no motor (bug #6 do protótipo)
    diasAtendimento: [1, 2, 3, 4, 5, 6], // 0=domingo (fecha domingo)
    holdMinutos: 30
  };

  // config/pix — estrutura (preencher com dados reais no Admin, não em código).
  var CONFIG_PIX = {
    chave: '', tipoChave: '', recebedor: '', documento: '',
    cidade: '', qrCodeUrl: '', observacoes: '', ativo: false
  };

  return {
    ADICIONAIS: ADICIONAIS,
    TABELAS: TABELAS,
    TABELA_FALLBACK: TABELA_FALLBACK,
    tabelasMapa: tabelasMapa,
    CONFIG_AGENDA: CONFIG_AGENDA,
    CONFIG_PIX: CONFIG_PIX
  };
});
