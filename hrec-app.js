/* H-REC AGENDA — wizard de agendamento (Bloco 6 do MD, §9). Front vanilla no padrão do
 * Hub. Script CLÁSSICO: define window.HrecAgenda = { render(container, ctx) }. Recebe as
 * callables e os motores por ctx (sem importar o SDK do Firebase aqui):
 *   ctx.api    = { catalogo, disponibilidade, criar }   (Cloud Functions já embrulhadas)
 *   ctx.Preco  = window.Hrec.Precificacao                (preview de preço no cliente)
 *   ctx.Datas  = window.Hrec.Datas
 * O backend é a fonte de verdade (revalida preço e slot); aqui é só UX.
 */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function brl(n) { return (window.Hrec && window.Hrec.Datas) ? window.Hrec.Datas.brl(n) : ('R$ ' + (Number(n) || 0).toFixed(2)); }
  function waLink(tel, texto) { const d = String(tel || '').replace(/\D/g, ''); if (!d) return ''; const num = d.length <= 11 ? '55' + d : d; return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto || ''); }
  // Re-renderiza mantendo foco e cursor num input (o innerHTML novo destrói o elemento).
  function manterFoco(id, renderFn) {
    const el0 = document.getElementById(id);
    const pos = el0 && el0.selectionStart != null ? el0.selectionStart : null;
    renderFn();
    const el = document.getElementById(id);
    if (el) { el.focus(); if (pos != null) { try { el.setSelectionRange(pos, pos); } catch (_e) { /* number input não deixa */ } } }
  }

  let ctx, root, S;
  let CAT = null;            // catálogo (tabelas/adicionais/config/minhaImob) — carregado 1x
  let view = 'lista';        // 'lista' | 'wizard' | 'detalhe' | 'operacao' | ... | 'notifs'
  let bookings = null;       // lista de agendamentos (Meus Agendamentos)
  let detalhe = null;        // agendamento aberto no detalhe
  let notifs = null, notifCount = 0; // notificações in-app
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  function novoEstado(prefill) {
    const hoje = ctx.Datas.hojeISO(new Date());
    const tabela = CAT.tabelas[CAT.minhaTabelaId] || CAT.tabelas['padrao_hrec'];
    const S0 = {
      step: 1, cat: CAT, tabela,
      form: { endereco: '', metragem: '', extras: {}, formatoVideoCru: '', dateISO: null, startAt: null,
        situacao: 'desocupado', energia: 'sim', acesso: 'corretor_no_local', quartos: '', responsavel: '', responsavelTelefone: '', observacoes: '' },
      calcPreview: null, mesAno: { ano: +hoje.slice(0, 4), mes: +hoje.slice(5, 7) }, dispCache: null, carregandoDisp: false, criando: false, sucesso: null
    };
    if (prefill) { Object.assign(S0.form, prefill); }
    return S0;
  }

  async function render(container, contexto) {
    ctx = contexto; root = container;
    root.innerHTML = '<div class="hrec-wrap"><p class="hrec-muted" style="padding:24px">Carregando…</p></div>';
    try {
      const r = await ctx.api.catalogo();
      CAT = r.data;
      if (!(CAT.tabelas[CAT.minhaTabelaId] || CAT.tabelas['padrao_hrec'])) { root.innerHTML = alerta('Nenhuma tabela de preço configurada. Fale com a H-REC.'); return; }
      try { const nr = await ctx.api.minhasNotifs(); notifs = nr.data.itens || []; notifCount = nr.data.naoLidas || 0; } catch (_e) { /* best-effort */ }
      // Staff H-REC (fotógrafo/administrador) abre na OPERAÇÃO (agenda do dia); os demais, na lista.
      if (CAT.papel === 'fotografo' || CAT.papel === 'administrador') irOperacao(); else irLista();
    } catch (e) {
      root.innerHTML = alerta('Não deu pra carregar o catálogo: ' + esc(e.message || e));
    }
  }

  function alerta(msg) { return '<div class="hrec-wrap"><div class="hrec-alerta">' + msg + '</div></div>'; }

  // ---------------------------------------------------------------- dispatcher de view
  function pintar() {
    if (view === 'lista') return pintarLista();
    if (view === 'detalhe') return pintarDetalhe();
    if (view === 'operacao') return pintarOperacao();
    if (view === 'pagamentos') return pintarPagamentos();
    if (view === 'creditos') return pintarCreditos();
    if (view === 'relatorios') return pintarRelatorios();
    if (view === 'notifs') return pintarNotifs();
    return pintarWizard();
  }
  function irHome() { return (CAT.papel === 'fotografo' || CAT.papel === 'administrador') ? irOperacao() : irLista(); }
  function novoAgendamento(prefill) { S = novoEstado(prefill); if (prefill) recalcPreview(); view = 'wizard'; pintar(); }

  // ---------------------------------------------------------------- Meus Agendamentos (lista)
  async function irLista() {
    view = 'lista'; bookings = null; pintar();
    try { const r = await ctx.api.listar(); bookings = r.data.bookings || []; }
    catch (e) { bookings = { _erro: e.message || String(e) }; }
    if (view === 'lista') pintar();
  }

  const ST_ROT = { aguardando_pagamento: 'Aguardando pagamento', pagamento_expirado: 'Pagamento expirado', pagamento_pendente_revisao: 'Pagamento em revisão', aguardando_orcamento: 'Aguardando orçamento', agendado: 'Agendado', confirmado: 'Confirmado', servico_iniciado: 'Em captação', captacao_concluida: 'Captação concluída', em_tratamento: 'Em tratamento', material_entregue: 'Material entregue', cancelado: 'Cancelado', nao_realizado: 'Não realizado' };
  function stRot(s) { return ST_ROT[s] || s || '—'; }
  const _lista = { busca: '', filtro: 'todos' };

  function ligarTopoLista() {
    const n = document.getElementById('hrNovoAg'); if (n) n.addEventListener('click', () => novoAgendamento());
    const c = document.getElementById('hrIrCred'); if (c) c.addEventListener('click', irCreditos);
    const rl = document.getElementById('hrIrRel'); if (rl) rl.addEventListener('click', irRelatorios);
    ligarBell();
  }
  function pintarLista() {
    const cred = CAT.papel === 'broker' ? '<button class="hrec-btn" id="hrIrRel">Relatórios</button><button class="hrec-btn" id="hrIrCred">Créditos</button>' : '';
    const topo = '<div class="hrec-lista-topo"><h3 class="hrec-h" style="margin:0">Meus agendamentos</h3><div style="display:flex;gap:8px">' + bellHtml() + cred + '<button class="hrec-btn primario" id="hrNovoAg">+ Novo agendamento</button></div></div>';
    if (bookings === null) { root.innerHTML = '<div class="hrec-wrap">' + topo + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; ligarTopoLista(); return; }
    if (bookings && bookings._erro) { root.innerHTML = '<div class="hrec-wrap">' + topo + alerta('Erro ao listar: ' + esc(bookings._erro)) + '</div>'; ligarTopoLista(); return; }
    const q = _lista.busca.toLowerCase();
    let arr = bookings.filter(b => {
      if (_lista.filtro === 'ativos' && ['cancelado', 'nao_realizado', 'material_entregue'].indexOf(b.status) >= 0) return false;
      if (_lista.filtro === 'concluidos' && b.status !== 'material_entregue') return false;
      if (q && !((b.codigo || '').toLowerCase().includes(q) || (b.endereco || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const filtros = [['todos', 'Todos'], ['ativos', 'Ativos'], ['concluidos', 'Entregues']].map(f =>
      '<button class="hrec-fchip ' + (_lista.filtro === f[0] ? 'sel' : '') + '" data-filtro="' + f[0] + '">' + f[1] + '</button>').join('');
    const linhas = arr.length ? arr.map(b =>
      '<button class="hrec-ag-card" data-abrir="' + esc(b.bookingId) + '">' +
      '<div class="hrec-ag-top"><b>' + esc(b.codigo || '—') + '</b><span class="hrec-badge st-' + esc(b.status) + '">' + esc(stRot(b.status)) + '</span></div>' +
      '<div class="hrec-ag-end">' + esc(b.endereco || 'Sem endereço') + ' · ' + esc(b.metragem || '?') + ' m²</div>' +
      '<div class="hrec-muted">' + (b.dateISO ? esc(b.dateISO.split('-').reverse().join('/')) + ' às ' + esc(b.startAt || '') : 'sem data') + ' · ' + brl(b.valorTotal) + '</div></button>'
    ).join('') : '<p class="hrec-muted" style="padding:20px;text-align:center">Nenhum agendamento ainda. Clique em <b>+ Novo agendamento</b>.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + topo +
      '<div class="hrec-lista-tools"><input class="hrec-inp" id="hrBusca" placeholder="Buscar por código ou endereço" value="' + esc(_lista.busca) + '"><div class="hrec-fchips">' + filtros + '</div></div>' +
      '<div class="hrec-ag-lista">' + linhas + '</div></div>';
    ligarTopoLista();
    document.getElementById('hrBusca').addEventListener('input', (e) => { _lista.busca = e.target.value; manterFoco('hrBusca', pintarLista); });
    root.querySelectorAll('[data-filtro]').forEach(el => el.addEventListener('click', () => { _lista.filtro = el.dataset.filtro; pintarLista(); }));
    root.querySelectorAll('[data-abrir]').forEach(el => el.addEventListener('click', () => abrirDetalhe(el.dataset.abrir)));
  }

  // ---------------------------------------------------------------- Detalhe
  async function abrirDetalhe(id) {
    view = 'detalhe'; detalhe = null; pintar();
    try { const r = await ctx.api.obter({ bookingId: id }); detalhe = r.data.booking; }
    catch (e) { detalhe = { _erro: e.message || String(e) }; }
    if (view === 'detalhe') pintar();
  }
  function pintarDetalhe() {
    const back = '<button class="hrec-btn" id="hrVoltarLista">‹ Meus agendamentos</button>';
    if (detalhe === null) { root.innerHTML = '<div class="hrec-wrap">' + back + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; document.getElementById('hrVoltarLista').addEventListener('click', irLista); return; }
    if (detalhe._erro) { root.innerHTML = '<div class="hrec-wrap">' + back + alerta('Erro: ' + esc(detalhe._erro)) + '</div>'; document.getElementById('hrVoltarLista').addEventListener('click', irLista); return; }
    const b = detalhe, sch = b.schedule || {}, fin = b.financial || {}, prop = b.property || {};
    const linha = (l, v) => '<div class="hrec-rev-l"><span>' + l + '</span><b>' + v + '</b></div>';
    const podeCancelar = ['cancelado', 'nao_realizado', 'material_entregue'].indexOf(b.status) < 0;
    const hist = (b.history || []).slice().reverse().map(h =>
      '<div class="hrec-tl-item"><span class="hrec-tl-dot"></span><div><b>' + esc(rotAcao(h.action)) + '</b>' + (h.atMs ? '<div class="hrec-muted">' + fmtData(h.atMs) + '</div>' : '') + '</div></div>').join('') || '<p class="hrec-muted">Sem histórico.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + back +
      '<div class="hrec-card"><div class="hrec-det-head"><div><div class="hrec-servico-faixa">' + esc(b.codigo || '') + '</div><span class="hrec-badge st-' + esc(b.status) + '">' + esc(stRot(b.status)) + '</span></div>' +
      (podeCancelar ? '<button class="hrec-btn" id="hrCancelar">Cancelar</button>' : '') + '</div>' +
      '<div class="hrec-rev" style="margin-top:12px">' +
      linha('Imóvel', esc(prop.endereco || '—') + ' · ' + esc(prop.metragem || '?') + ' m²') +
      linha('Serviço', esc((b.service || {}).faixaNome || '—')) +
      linha('Data', sch.dateISO ? esc(sch.dateISO.split('-').reverse().join('/')) + ' às ' + esc(sch.startAt || '') + '–' + esc(sch.endAt || '') : '—') +
      linha('Situação financeira', esc(fin.tipo === 'pacote' ? 'Pacote (créditos): ' + brl(fin.creditosReservados) + ' reservado' : 'Avulso (Pix): ' + brl(fin.valorTotalConfirmado))) +
      linha('Total', brl(fin.valorTotalConfirmado)) +
      '</div>' +
      ((b.itensPendentes && b.itensPendentes.length) ? '<div class="hrec-muted" style="margin-top:8px">Pendente de aprovação: ' + b.itensPendentes.map(i => esc(i.nome)).join(', ') + '</div>' : '') +
      (prop.responsavelTelefone ? '<a class="hrec-btn" style="margin-top:14px;display:block;text-align:center;text-decoration:none" href="' + esc(waLink(prop.responsavelTelefone, 'Olá! Sobre a sessão de fotos em ' + (prop.endereco || 'seu imóvel') + ' (' + (b.codigo || '') + ').')) + '" target="_blank" rel="noopener">💬 WhatsApp do responsável</a>' : '') +
      '<button class="hrec-btn primario" id="hrDeNovo" style="margin-top:10px;width:100%">Agendar de novo (mesmo imóvel)</button>' +
      '<h4 class="hrec-h" style="margin:18px 0 8px">Histórico</h4><div class="hrec-tl">' + hist + '</div>' +
      '</div></div>';
    document.getElementById('hrVoltarLista').addEventListener('click', irLista);
    document.getElementById('hrDeNovo').addEventListener('click', () => novoAgendamento({
      endereco: prop.endereco || '', metragem: String(prop.metragem || ''), extras: JSON.parse(JSON.stringify(b.extras || {})),
      situacao: prop.situacao, energia: prop.energia, acesso: prop.acesso, quartos: prop.quartos || '', formatoVideoCru: (b.service || {}).formatoVideoCru || ''
    }));
    const bc = document.getElementById('hrCancelar');
    if (bc) bc.addEventListener('click', () => cancelarBooking(b.bookingId, bc));
  }
  function rotAcao(a) { return ({ criado: 'Agendamento criado', cancelado: 'Cancelado', pagamento_expirado: 'Pagamento expirado' })[a] || a || 'Evento'; }
  function fmtData(ms) { try { return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_e) { return ''; } }
  async function cancelarBooking(id, btn) {
    if (!ctx.api.cancelar) return;
    btn.disabled = true; btn.textContent = 'Cancelando…';
    try { await ctx.api.cancelar({ bookingId: id }); abrirDetalhe(id); }
    catch (e) { btn.disabled = false; btn.textContent = 'Cancelar'; toast(e.message || 'Erro ao cancelar'); }
  }
  function toast(msg) { const b = document.createElement('div'); b.className = 'hrec-toast'; b.textContent = msg; document.body.appendChild(b); setTimeout(() => b.remove(), 4000); }

  // ---------------------------------------------------------------- preço (cliente)
  function recalcPreview() {
    const m = parseFloat(String(S.form.metragem).replace(',', '.')) || 0;
    S.calcPreview = m > 0 ? ctx.Preco.calcular({ metragem: m, tabela: S.tabela, catalogoAdicionais: S.cat.adicionais, extras: S.form.extras }) : null;
  }
  function adicionaisPermitidos() {
    const ids = S.tabela.adicionaisPermitidos || [];
    return S.cat.adicionais.filter(a => ids.indexOf(a.id) >= 0).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }

  // ---------------------------------------------------------------- Operação (fotógrafo/admin)
  let opDate = null, opItens = null, opAcao = null; // opAcao = { id, tipo:'entregar'|'ia' }
  async function irOperacao() {
    view = 'operacao';
    if (!opDate) opDate = ctx.Datas.hojeISO(new Date());
    opItens = null; opAcao = null; pintar();
    try { const r = await ctx.api.agendaDia({ dateISO: opDate }); opItens = r.data.itens || []; }
    catch (e) { opItens = { _erro: e.message || String(e) }; }
    if (view === 'operacao') pintar();
  }
  function temPendente(b, id) { return (b.itensPendentes || []).some(i => i.id === id); }

  function pintarOperacao() {
    const nav = '<button class="hrec-btn" id="hrIrRel">Relatórios</button>' + (CAT.papel === 'administrador' ? '<button class="hrec-btn" id="hrIrPag">Pagamentos</button>' : '');
    const head = '<div class="hrec-lista-topo"><h3 class="hrec-h" style="margin:0">Agenda do dia</h3>' +
      '<div style="display:flex;gap:8px;align-items:center">' + bellHtml() + nav + '<input class="hrec-inp" id="hrOpData" type="date" value="' + esc(opDate) + '" style="width:auto"></div></div>';
    if (opItens === null) { root.innerHTML = '<div class="hrec-wrap">' + head + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; ligarOpData(); return; }
    if (opItens && opItens._erro) { root.innerHTML = '<div class="hrec-wrap">' + head + alerta('Erro: ' + esc(opItens._erro)) + '</div>'; ligarOpData(); return; }
    const ativos = opItens.filter(b => ['cancelado', 'nao_realizado', 'pagamento_expirado'].indexOf(b.status) < 0);
    const cards = ativos.length ? ativos.map(cardOp).join('') : '<p class="hrec-muted" style="padding:20px;text-align:center">Nada agendado nesse dia.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + head + '<div class="hrec-ag-lista">' + cards + '</div></div>';
    ligarOpData();
    ligarOpAcoes();
  }
  function cardOp(b) {
    let acoes = '';
    if (opAcao && opAcao.id === b.bookingId && opAcao.tipo === 'entregar') {
      acoes = '<div class="hrec-op-form"><input class="hrec-inp" id="hrOpUrl" placeholder="https://drive.google.com/…"><button class="hrec-btn primario" data-op="entregar-ok" data-id="' + esc(b.bookingId) + '">Enviar</button><button class="hrec-btn" data-op="cancelar-form">✕</button></div>';
    } else if (opAcao && opAcao.id === b.bookingId && opAcao.tipo === 'ia') {
      acoes = '<div class="hrec-op-form"><input class="hrec-inp" id="hrOpIA" inputmode="decimal" placeholder="Valor do vídeo IA (R$)"><button class="hrec-btn primario" data-op="ia-ok" data-id="' + esc(b.bookingId) + '">Definir</button><button class="hrec-btn" data-op="cancelar-form">✕</button></div>';
    } else {
      const btns = [];
      if (b.status === 'confirmado') btns.push(bt('iniciar', b.bookingId, '▶ Iniciar'));
      if (b.status === 'servico_iniciado') btns.push(bt('concluir', b.bookingId, '✓ Concluir captação'));
      if (['captacao_concluida', 'em_tratamento', 'material_entregue'].indexOf(b.status) >= 0) btns.push(bt('entregar', b.bookingId, b.driveUrl ? '📎 Trocar material' : '📎 Entregar material', true));
      if (temPendente(b, 'drone')) { btns.push(bt('aprovarDrone', b.bookingId, 'Aprovar drone')); btns.push(bt('reprovarDrone', b.bookingId, 'Reprovar', false, 'sec')); }
      if (temPendente(b, 'video_ia')) btns.push(bt('ia', b.bookingId, 'Definir valor IA', true));
      acoes = '<div class="hrec-op-btns">' + (btns.join('') || '<span class="hrec-muted" style="font-size:12px">Sem ação pendente</span>') + '</div>';
    }
    return '<div class="hrec-ag-card" style="cursor:default">' +
      '<div class="hrec-ag-top"><b>' + esc(b.startAt || '') + ' · ' + esc(b.codigo || '') + '</b><span class="hrec-badge st-' + esc(b.status) + '">' + esc(stRot(b.status)) + '</span></div>' +
      '<div class="hrec-ag-end">' + esc(b.endereco || 'Sem endereço') + ' · ' + esc(b.metragem || '?') + ' m²</div>' +
      ((b.itensPendentes && b.itensPendentes.length) ? '<div class="hrec-muted">Pendente: ' + b.itensPendentes.map(i => esc(i.nome)).join(', ') + '</div>' : '') +
      (b.driveUrl ? '<div class="hrec-muted">Material: <a href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener">abrir ↗</a></div>' : '') +
      acoes + '</div>';
  }
  function bt(op, id, txt, prim, cls) { return '<button class="hrec-btn ' + (prim ? 'primario' : (cls === 'sec' ? '' : '')) + '" data-op="' + op + '" data-id="' + esc(id) + '">' + txt + '</button>'; }
  function ligarOpData() {
    const el = document.getElementById('hrOpData');
    if (el) el.addEventListener('change', () => { opDate = el.value; irOperacao(); });
    const p = document.getElementById('hrIrPag');
    if (p) p.addEventListener('click', irPagamentos);
    const rl = document.getElementById('hrIrRel');
    if (rl) rl.addEventListener('click', irRelatorios);
    ligarBell();
  }
  function ligarOpAcoes() {
    root.querySelectorAll('[data-op]').forEach(el => el.addEventListener('click', () => opAgir(el.dataset.op, el.dataset.id, el)));
  }
  async function opAgir(op, id, el) {
    if (op === 'cancelar-form') { opAcao = null; pintar(); return; }
    if (op === 'entregar') { opAcao = { id, tipo: 'entregar' }; pintar(); return; }
    if (op === 'ia') { opAcao = { id, tipo: 'ia' }; pintar(); return; }
    if (op === 'entregar-ok') {
      const url = (document.getElementById('hrOpUrl') || {}).value || '';
      return opChamar(() => ctx.api.entregar({ bookingId: id, driveUrl: url }), el);
    }
    if (op === 'ia-ok') {
      const valor = parseFloat(String((document.getElementById('hrOpIA') || {}).value || '').replace(',', '.'));
      if (!(valor > 0)) { toast('Informe um valor válido.'); return; }
      return opChamar(() => ctx.api.definirIA({ bookingId: id, valor }), el);
    }
    const mapa = { iniciar: ctx.api.iniciar, concluir: ctx.api.concluir, aprovarDrone: ctx.api.aprovarDrone, reprovarDrone: ctx.api.reprovarDrone };
    if (mapa[op]) return opChamar(() => mapa[op]({ bookingId: id }), el);
  }
  async function opChamar(fn, el) {
    if (el) { el.disabled = true; el.dataset._t = el.textContent; el.textContent = '…'; }
    try { await fn(); opAcao = null; irOperacao(); }
    catch (e) { if (el) { el.disabled = false; el.textContent = el.dataset._t || 'OK'; } toast(e.message || 'Erro na ação.'); }
  }

  // ---------------------------------------------------------------- Pagamentos (admin)
  let pagItens = null;
  async function irPagamentos() { view = 'pagamentos'; pagItens = null; pintar(); try { const r = await ctx.api.pagamentosPendentes(); pagItens = r.data.pagamentos || []; } catch (e) { pagItens = { _erro: e.message }; } if (view === 'pagamentos') pintar(); }
  function pintarPagamentos() {
    const back = '<button class="hrec-btn" id="hrPagBack">‹ Agenda</button>';
    const head = '<div class="hrec-lista-topo" style="margin-top:10px"><h3 class="hrec-h" style="margin:0">Pagamentos pendentes</h3></div>';
    if (pagItens === null) { root.innerHTML = '<div class="hrec-wrap">' + back + head + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; document.getElementById('hrPagBack').addEventListener('click', irOperacao); return; }
    if (pagItens._erro) { root.innerHTML = '<div class="hrec-wrap">' + back + alerta('Erro: ' + esc(pagItens._erro)) + '</div>'; document.getElementById('hrPagBack').addEventListener('click', irOperacao); return; }
    const TP = { servico: 'Serviço (Pix)', adicional: 'Adicional (Pix)', credito: 'Compra de créditos' };
    const cards = pagItens.length ? pagItens.map(p =>
      '<div class="hrec-ag-card" style="cursor:default"><div class="hrec-ag-top"><b>' + brl(p.amount) + '</b><span class="hrec-badge">' + esc(TP[p.tipo] || p.tipo) + '</span></div>' +
      '<div class="hrec-muted">Imobiliária: ' + esc(p.imobiliariaId || '—') + (p.bookingId ? ' · booking ' + esc(p.bookingId) : '') + '</div>' +
      '<div class="hrec-op-btns"><button class="hrec-btn primario" data-pag="' + esc(p.id) + '" data-tipo="' + esc(p.tipo) + '">Confirmar recebimento</button></div></div>'
    ).join('') : '<p class="hrec-muted" style="padding:20px;text-align:center">Nenhum pagamento pendente.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + back + head + '<div class="hrec-ag-lista">' + cards + '</div></div>';
    document.getElementById('hrPagBack').addEventListener('click', irOperacao);
    root.querySelectorAll('[data-pag]').forEach(el => el.addEventListener('click', async () => {
      el.disabled = true; el.textContent = '…';
      try { await (el.dataset.tipo === 'credito' ? ctx.api.confirmarCompraCredito({ paymentId: el.dataset.pag }) : ctx.api.confirmarPagamento({ paymentId: el.dataset.pag })); irPagamentos(); }
      catch (e) { el.disabled = false; el.textContent = 'Confirmar recebimento'; toast(e.message || 'Erro ao confirmar.'); }
    }));
  }

  // ---------------------------------------------------------------- Créditos (broker)
  let credData = null, credCompra = null;
  async function irCreditos() { view = 'creditos'; credData = null; credCompra = null; pintar(); try { const r = await ctx.api.listarMovimentos({}); credData = r.data; } catch (e) { credData = { _erro: e.message }; } if (view === 'creditos') pintar(); }
  function pintarCreditos() {
    const back = '<button class="hrec-btn" id="hrCredBack">‹ Meus agendamentos</button>';
    if (credData === null) { root.innerHTML = '<div class="hrec-wrap">' + back + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; document.getElementById('hrCredBack').addEventListener('click', irLista); return; }
    if (credData._erro) { root.innerHTML = '<div class="hrec-wrap">' + back + alerta('Erro: ' + esc(credData._erro)) + '</div>'; document.getElementById('hrCredBack').addEventListener('click', irLista); return; }
    const s = credData.saldo || {};
    const saldoCard = '<div class="hrec-card"><h3 class="hrec-h" style="margin:0 0 10px">Saldo de créditos</h3>' +
      '<div class="hrec-rev">' +
      '<div class="hrec-rev-l"><span>Disponível</span><b>' + brl(s.disponivel) + '</b></div>' +
      '<div class="hrec-rev-l"><span>Reservado</span><b>' + brl(s.reservado) + '</b></div>' +
      '<div class="hrec-rev-l"><span>Consumido</span><b>' + brl(s.consumido) + '</b></div>' +
      '<div class="hrec-rev-l"><span>Contratado (total)</span><b>' + brl(s.contratado) + '</b></div></div>' +
      '<div class="hrec-op-form"><input class="hrec-inp" id="hrCredVal" inputmode="decimal" placeholder="Comprar créditos (R$)"><button class="hrec-btn primario" id="hrCredComprar">Gerar Pix</button></div></div>';
    let compraCard = '';
    if (credCompra) {
      compraCard = '<div class="hrec-card" style="margin-top:12px"><h3 class="hrec-h" style="margin:0 0 8px">Pague via Pix ' + brl(credCompra.valor) + '</h3>' +
        (credCompra.qrCodeUrl ? '<img src="' + esc(credCompra.qrCodeUrl) + '" alt="QR Pix" style="max-width:180px;display:block;margin:0 auto 10px">' : '') +
        '<div class="hrec-muted" style="margin-bottom:6px">Pix copia e cola:</div>' +
        '<textarea class="hrec-inp" id="hrPixCopia" rows="3" readonly style="font-family:monospace;font-size:11px">' + esc(credCompra.brcode) + '</textarea>' +
        '<button class="hrec-btn" id="hrPixCopiar" style="margin-top:8px">Copiar código</button>' +
        '<div class="hrec-muted" style="margin-top:6px">Depois de pagar, a H-REC confirma e o crédito entra no saldo.</div></div>';
    }
    const movs = (credData.movimentos || []).map(m =>
      '<div class="hrec-rev-l"><span>' + esc(m.tipo) + (m.descricao ? ' · ' + esc(m.descricao) : '') + '</span><b style="color:' + (m.sinal === '+' ? 'var(--ok,#2e7d46)' : 'var(--accent,#c0353a)') + '">' + esc(m.sinal) + brl(m.valor) + '</b></div>'
    ).join('') || '<p class="hrec-muted">Sem movimentos.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + back + saldoCard + compraCard +
      '<div class="hrec-card" style="margin-top:12px"><h3 class="hrec-h" style="margin:0 0 8px">Extrato</h3>' + movs + '</div></div>';
    document.getElementById('hrCredBack').addEventListener('click', irLista);
    document.getElementById('hrCredComprar').addEventListener('click', comprarCreditos);
    const cp = document.getElementById('hrPixCopiar');
    if (cp) cp.addEventListener('click', () => { const t = document.getElementById('hrPixCopia'); t.select(); try { document.execCommand('copy'); cp.textContent = 'Copiado ✔'; } catch (_e) { toast('Selecione e copie o código.'); } });
  }
  async function comprarCreditos() {
    const valor = parseFloat(String((document.getElementById('hrCredVal') || {}).value || '').replace(',', '.'));
    if (!(valor > 0)) { toast('Informe um valor válido.'); return; }
    const btn = document.getElementById('hrCredComprar'); btn.disabled = true; btn.textContent = 'Gerando…';
    try { const r = await ctx.api.comprarCreditos({ valor }); credCompra = Object.assign({ valor }, r.data); pintar(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Gerar Pix'; toast(e.message || 'Erro ao gerar Pix.'); }
  }

  // ---------------------------------------------------------------- Relatórios (broker/staff)
  let relData = null, relPeriodo = '30d';
  function relRange() {
    const hoje = ctx.Datas.hojeISO(new Date());
    if (relPeriodo === 'tudo') return { de: '', ate: '' };
    if (relPeriodo === 'mes') return { de: hoje.slice(0, 8) + '01', ate: hoje };
    return { de: ctx.Datas.addDias(hoje, -30), ate: hoje }; // 30d
  }
  async function irRelatorios() {
    view = 'relatorios'; relData = null; pintar();
    const r = relRange();
    try { const res = await ctx.api.relatorio({ de: r.de, ate: r.ate }); relData = res.data; }
    catch (e) { relData = { _erro: e.message }; }
    if (view === 'relatorios') pintar();
  }
  function voltarDeRel() { return (CAT.papel === 'fotografo' || CAT.papel === 'administrador') ? irOperacao : irLista; }
  function pintarRelatorios() {
    const back = '<button class="hrec-btn" id="hrRelBack">‹ Voltar</button>';
    if (relData === null) { root.innerHTML = '<div class="hrec-wrap">' + back + '<p class="hrec-muted" style="padding:16px">Carregando…</p></div>'; document.getElementById('hrRelBack').addEventListener('click', voltarDeRel()); return; }
    if (relData._erro) { root.innerHTML = '<div class="hrec-wrap">' + back + alerta('Erro: ' + esc(relData._erro)) + '</div>'; document.getElementById('hrRelBack').addEventListener('click', voltarDeRel()); return; }
    const chips = [['30d', 'Últimos 30 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']].map(f =>
      '<button class="hrec-fchip ' + (relPeriodo === f[0] ? 'sel' : '') + '" data-rel="' + f[0] + '">' + f[1] + '</button>').join('');
    const R = relData.resumo || {};
    const kpis = '<div class="hrec-kpis"><div class="hrec-kpi"><span>Serviços</span><b>' + (R.count || 0) + '</b></div>' +
      '<div class="hrec-kpi"><span>Faturamento</span><b>' + brl(R.faturamento) + '</b></div>' +
      '<div class="hrec-kpi"><span>Pacote / Avulso</span><b>' + ((R.porTipo || {}).pacote || {}).c + ' / ' + ((R.porTipo || {}).avulso || {}).c + '</b></div></div>';
    const quebra = (titulo, obj, mapV) => {
      const ent = Object.keys(obj || {}); if (!ent.length) return '';
      return '<div class="hrec-card" style="margin-top:12px"><h4 class="hrec-h" style="margin:0 0 8px">' + titulo + '</h4>' +
        ent.map(k => '<div class="hrec-rev-l"><span>' + esc(mapV ? mapV(k) : k) + '</span><b>' + (typeof obj[k] === 'object' ? (obj[k].c + ' · ' + brl(obj[k].v)) : obj[k]) + '</b></div>').join('') + '</div>';
    };
    root.innerHTML = '<div class="hrec-wrap">' + back +
      '<div class="hrec-lista-topo" style="margin-top:10px"><h3 class="hrec-h" style="margin:0">Relatórios</h3>' +
      '<div style="display:flex;gap:6px"><button class="hrec-btn" id="hrRelCsv">⬇ CSV</button><button class="hrec-btn" id="hrRelPdf">🖨 PDF</button></div></div>' +
      '<div class="hrec-fchips" style="margin-bottom:12px">' + chips + '</div>' + kpis +
      quebra('Por status', R.porStatus, stRot) +
      quebra('Por fotógrafo', relData.porFotografo, k => (relData.nomesFotografos || {})[k] || k) +
      quebra('Por imobiliária', relData.porImob) + '</div>';
    document.getElementById('hrRelBack').addEventListener('click', voltarDeRel());
    root.querySelectorAll('[data-rel]').forEach(el => el.addEventListener('click', () => { relPeriodo = el.dataset.rel; irRelatorios(); }));
    document.getElementById('hrRelCsv').addEventListener('click', relCSV);
    document.getElementById('hrRelPdf').addEventListener('click', relImprimir);
  }
  function relCSV() {
    const rows = (relData.rows || []);
    const esc2 = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const money = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, '');
    const cols = ['Código', 'Status', 'Data', 'Hora', 'Endereço', 'Metragem', 'Tipo', 'Valor'];
    const linhas = [cols.join(';'), ...rows.map(b => [b.codigo, stRot(b.status), b.dateISO || '', b.startAt || '', b.endereco || '', b.metragem || '', b.tipoFinanceiro || '', money(b.valorTotal)].map(esc2).join(';'))];
    const csv = '﻿' + linhas.join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'hrec-relatorio.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function relImprimir() {
    const R = relData.resumo || {};
    const rows = (relData.rows || []).map(b => '<tr><td>' + esc(b.codigo) + '</td><td>' + esc(stRot(b.status)) + '</td><td>' + esc(b.dateISO || '') + ' ' + esc(b.startAt || '') + '</td><td>' + esc(b.endereco || '') + '</td><td style="text-align:right">' + brl(b.valorTotal) + '</td></tr>').join('');
    const html = '<html><head><meta charset="utf-8"><title>Relatório H-REC</title><style>body{font-family:Arial;padding:20px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}td,th{border:1px solid #ccc;padding:5px;text-align:left}</style></head><body>' +
      '<h1>H-REC Agenda — Relatório</h1><p>Serviços: <b>' + (R.count || 0) + '</b> · Faturamento: <b>' + brl(R.faturamento) + '</b></p>' +
      '<table><thead><tr><th>Código</th><th>Status</th><th>Data</th><th>Endereço</th><th>Valor</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';
    const ifr = document.createElement('iframe'); ifr.style.position = 'fixed'; ifr.style.right = '0'; ifr.style.bottom = '0'; ifr.style.width = '0'; ifr.style.height = '0'; ifr.style.border = '0';
    document.body.appendChild(ifr);
    ifr.contentDocument.open(); ifr.contentDocument.write(html); ifr.contentDocument.close();
    setTimeout(() => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_e) { /* nada */ } setTimeout(() => ifr.remove(), 1000); }, 300);
  }

  // ---------------------------------------------------------------- Notificações (sino)
  function bellHtml() { return '<button class="hrec-btn hrec-bell" id="hrBell" title="Notificações">🔔' + (notifCount ? '<span class="hrec-bell-badge">' + notifCount + '</span>' : '') + '</button>'; }
  function ligarBell() { const b = document.getElementById('hrBell'); if (b) b.addEventListener('click', irNotifs); }
  async function irNotifs() {
    view = 'notifs'; pintar();
    try { const nr = await ctx.api.minhasNotifs(); notifs = nr.data.itens || []; notifCount = nr.data.naoLidas || 0; } catch (e) { notifs = { _erro: e.message }; }
    if (view === 'notifs') pintar();
  }
  const NOTIF_ICO = { material: '📸', pagamento: '💳', adicional: '➕' };
  function pintarNotifs() {
    const back = '<button class="hrec-btn" id="hrNotBack">‹ Voltar</button>';
    const head = '<div class="hrec-lista-topo" style="margin-top:10px"><h3 class="hrec-h" style="margin:0">Notificações</h3>' + (Array.isArray(notifs) && notifs.some(n => !n.lida) ? '<button class="hrec-btn" id="hrNotLidas">Marcar todas lidas</button>' : '') + '</div>';
    if (!Array.isArray(notifs)) { root.innerHTML = '<div class="hrec-wrap">' + back + (notifs && notifs._erro ? alerta('Erro: ' + esc(notifs._erro)) : '<p class="hrec-muted" style="padding:16px">Carregando…</p>') + '</div>'; document.getElementById('hrNotBack').addEventListener('click', () => irHome()); return; }
    const itens = notifs.length ? notifs.map(n =>
      '<div class="hrec-notif' + (n.lida ? '' : ' nova') + '"><span class="hrec-notif-ico">' + (NOTIF_ICO[n.tipo] || '🔔') + '</span><div><div class="hrec-notif-txt">' + esc(n.texto) + '</div>' + (n.atMs ? '<div class="hrec-muted" style="font-size:11px">' + fmtData(n.atMs) + '</div>' : '') + '</div></div>'
    ).join('') : '<p class="hrec-muted" style="padding:20px;text-align:center">Nenhuma notificação.</p>';
    root.innerHTML = '<div class="hrec-wrap">' + back + head + '<div class="hrec-notif-lista">' + itens + '</div></div>';
    document.getElementById('hrNotBack').addEventListener('click', () => irHome());
    const bl = document.getElementById('hrNotLidas');
    if (bl) bl.addEventListener('click', async () => { bl.disabled = true; bl.textContent = '…'; try { await ctx.api.marcarNotifsLidas(); } catch (_e) { /* nada */ } irNotifs(); });
  }

  // ---------------------------------------------------------------- render do WIZARD
  function pintarWizard() {
    if (S.sucesso) return pintarSucesso();
    root.innerHTML = '<div class="hrec-wrap">' + voltarLista() + stepper() + '<div class="hrec-card">' +
      (S.step === 1 ? passoImovel() : S.step === 2 ? passoData() : passoConfirmar()) +
      '</div></div>' + barraInferior();
    ligar();
  }

  function voltarLista() { return '<button class="hrec-btn" id="hrVoltarWiz" style="margin-bottom:10px">‹ Meus agendamentos</button>'; }

  function stepper() {
    const nomes = ['Imóvel', 'Data e horário', 'Confirmar'];
    return '<div class="hrec-stepper">' + nomes.map((n, i) =>
      '<div class="hrec-step ' + (S.step === i + 1 ? 'ativo' : (S.step > i + 1 ? 'feito' : '')) + '"><span class="hrec-step-n">' + (i + 1) + '</span><span class="hrec-step-l">' + n + '</span></div>'
    ).join('<span class="hrec-step-sep"></span>') + '</div>';
  }

  // ---- Passo 1 — Imóvel
  function passoImovel() {
    const c = S.calcPreview;
    let card = '';
    if (c && c.sobConsulta) {
      card = '<div class="hrec-servico hrec-servico--consulta">Acima de 500 m² o valor é <b>sob consulta</b>. Finalize como <b>Solicitar orçamento</b> — a H-REC retorna com a proposta.</div>';
    } else if (c && !c.erro) {
      const inc = incluidos();
      card = '<div class="hrec-servico"><div class="hrec-servico-top"><div><div class="hrec-servico-faixa">' + esc(c.faixaNome) + '</div><div class="hrec-muted">≈ ' + (faixaAtual().fotosAproximadas || '—') + ' fotos · ' + ctx.Datas.formatDur(c.tempoPresencial) + ' no imóvel</div></div>' +
        '<div class="hrec-servico-preco">' + (c.descontoBase > 0 ? '<span class="hrec-risco">' + brl(c.valorReferencia) + '</span>' : '') + '<span class="hrec-valor">' + brl(c.valorBase) + '</span></div></div>' +
        (inc.length ? '<div class="hrec-incluido">Incluído: ' + inc.map(esc).join(' · ') + '</div>' : '') + '</div>';
    }
    const ads = adicionaisPermitidos();
    return '<h3 class="hrec-h">Sobre o imóvel</h3>' +
      '<label class="hrec-lbl">Endereço</label><input class="hrec-inp" id="hrEnd" placeholder="Rua, número, bairro" value="' + esc(S.form.endereco) + '">' +
      '<label class="hrec-lbl">Metragem (m²)</label><input class="hrec-inp" id="hrMet" inputmode="decimal" placeholder="Ex.: 80" value="' + esc(S.form.metragem) + '">' +
      card +
      (S.tabela.escolheFormatoVideo ? '<label class="hrec-lbl">Formato do vídeo</label><select class="hrec-inp" id="hrFmt"><option value="">Escolher…</option><option value="horizontal"' + (S.form.formatoVideoCru === 'horizontal' ? ' selected' : '') + '>Horizontal</option><option value="vertical"' + (S.form.formatoVideoCru === 'vertical' ? ' selected' : '') + '>Vertical</option></select>' : '') +
      '<details class="hrec-det"><summary>Adicionar serviços</summary>' + ads.map(cardAdicional).join('') + '</details>' +
      '<details class="hrec-det"><summary>Observações</summary><textarea class="hrec-inp" id="hrObs" rows="2" placeholder="Algo que o fotógrafo precisa saber?">' + esc(S.form.observacoes) + '</textarea></details>';
  }
  function cardAdicional(a) {
    const sel = S.form.extras[a.id] || {};
    const on = !!sel.selecionado;
    return '<div class="hrec-add"><label class="hrec-add-chk"><input type="checkbox" data-add="' + esc(a.id) + '"' + (on ? ' checked' : '') + '><span><b>' + esc(a.nome) + '</b> — ' + brl(a.valor) + (a.tipoCobranca === 'per_unit' ? '/un' : a.tipoCobranca === 'from_minimum' ? ' (a partir de)' : '') + (a.requerAprovacao ? ' · requer aprovação' : '') + '</span></label>' +
      (on && a.tipoCobranca === 'per_unit' ? '<input class="hrec-qtd" id="hrQtd-' + esc(a.id) + '" type="number" min="1" value="' + (sel.quantidade || 1) + '" data-qtd="' + esc(a.id) + '">' : '') + '</div>';
  }
  function faixaAtual() { return S.calcPreview ? (S.tabela.faixas.find(f => f.id === S.calcPreview.faixaId) || {}) : {}; }
  function incluidos() {
    const s = S.tabela.servicosIncluidos || {}, out = [];
    if (s.fotos) out.push('Fotos'); if (s.tratamento) out.push('Tratamento');
    if (s.videoHorizontal) out.push('Vídeo horizontal'); if (s.videoVertical) out.push('Vídeo vertical');
    return out;
  }

  // ---- Passo 2 — Data e horário
  function passoData() {
    const dc = S.dispCache;
    let grade = '<p class="hrec-muted" style="padding:12px">Carregando disponibilidade…</p>';
    if (dc) {
      const { ano, mes } = S.mesAno;
      const prim = ctx.Datas.diaSemana(ano + '-' + String(mes).padStart(2, '0') + '-01');
      const nd = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      let cells = '';
      for (let i = 0; i < prim; i++) cells += '<div class="hrec-cal-cell vazio"></div>';
      for (let d = 1; d <= nd; d++) {
        const iso = ano + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const st = (dc.dias[iso] || {}).status || 'indisponivel';
        const clic = st === 'disponivel';
        cells += '<div class="hrec-cal-cell ' + st + (S.form.dateISO === iso ? ' sel' : '') + '"' + (clic ? ' data-dia="' + iso + '"' : '') + '>' + d + '</div>';
      }
      grade = '<div class="hrec-cal-head"><button class="hrec-cal-nav" data-mes="-1">‹</button><b>' + MESES[mes - 1] + ' ' + ano + '</b><button class="hrec-cal-nav" data-mes="1">›</button></div>' +
        '<div class="hrec-cal-dow">' + DOW.map(x => '<span>' + x + '</span>').join('') + '</div>' +
        '<div class="hrec-cal">' + cells + '</div>';
    }
    let slots = '';
    if (S.form.dateISO && dc) {
      const arr = (dc.dias[S.form.dateISO] || {}).slots || [];
      slots = '<div class="hrec-slots-tit">Horários em ' + esc(S.form.dateISO.split('-').reverse().join('/')) + '</div>' +
        (arr.length ? '<div class="hrec-slots">' + arr.map(h => '<button class="hrec-slot ' + (S.form.startAt === h ? 'sel' : '') + '" data-slot="' + h + '">' + h + '</button>').join('') + '</div>' : '<p class="hrec-muted">Sem horários nesse dia.</p>');
    }
    const banner = dc ? '<div class="hrec-banner-tempo">⏱ Tempo previsto no imóvel: ' + ctx.Datas.formatDur((dc.durMin || 0)) + ' (inclui deslocamento)</div>' : '';
    return '<h3 class="hrec-h">Escolha data e horário</h3>' +
      '<button class="hrec-btn-prox" id="hrProx">⚡ Próximo horário disponível</button>' + banner + grade + slots;
  }

  // ---- Passo 3 — Confirmar
  function passoConfirmar() {
    const c = S.calcPreview;
    const linha = (l, v) => '<div class="hrec-rev-l"><span>' + l + '</span><b>' + v + '</b></div>';
    return '<h3 class="hrec-h">Confirme o agendamento</h3>' +
      '<div class="hrec-rev">' +
      linha('Imóvel', esc(S.form.endereco || '—') + ' · ' + esc(S.form.metragem) + ' m²') +
      linha('Serviço', esc(c ? c.faixaNome : '—')) +
      linha('Data', esc((S.form.dateISO || '').split('-').reverse().join('/')) + ' às ' + esc(S.form.startAt || '')) +
      '<a class="hrec-editar" data-goto="1">Editar imóvel</a> · <a class="hrec-editar" data-goto="2">Editar data</a>' +
      '</div>' +
      '<details class="hrec-det"><summary>Detalhes do acesso · editar</summary>' +
      selCampo('Situação', 'situacao', [['desocupado', 'Desocupado / Vago'], ['ocupado', 'Ocupado / Mobiliado']]) +
      selCampo('Energia elétrica', 'energia', [['sim', 'Sim'], ['nao', 'Não'], ['nao_sei', 'Não sei']]) +
      selCampo('Acesso', 'acesso', [['corretor_no_local', 'Corretor estará no local'], ['proprietario', 'Proprietário'], ['inquilino', 'Inquilino'], ['porteiro', 'Porteiro'], ['chaves_imob', 'Chaves na imobiliária']]) +
      '<label class="hrec-lbl">Quartos</label><input class="hrec-inp" id="hrQt" value="' + esc(S.form.quartos) + '" placeholder="opcional">' +
      '<label class="hrec-lbl">Responsável no local (se houver)</label><input class="hrec-inp" id="hrResp" value="' + esc(S.form.responsavel) + '"><input class="hrec-inp" id="hrRespTel" value="' + esc(S.form.responsavelTelefone) + '" placeholder="Telefone">' +
      '</details>' +
      '<div class="hrec-total-box"><span>Total do serviço</span><b>' + brl(c ? c.totalConfirmado : 0) + '</b></div>' +
      ((c && c.itensPendentes && c.itensPendentes.length) ? '<div class="hrec-muted" style="margin-top:4px">+ ' + c.itensPendentes.map(i => esc(i.nome)).join(', ') + ' — sob aprovação da H-REC (cobrado depois).</div>' : '') +
      '<div class="hrec-muted" style="margin-top:6px">' + (S.cat.minhaImob && S.cat.minhaImob.tipo === 'parceria' ? 'Será reservado do saldo de créditos da imobiliária.' : 'Será gerada uma cobrança via Pix (confirmação manual da H-REC).') + '</div>';
  }
  function selCampo(lbl, campo, opts) {
    return '<label class="hrec-lbl">' + lbl + '</label><select class="hrec-inp" data-campo="' + campo + '">' +
      opts.map(o => '<option value="' + o[0] + '"' + (S.form[campo] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  }

  function pintarSucesso() {
    root.innerHTML = '<div class="hrec-wrap"><div class="hrec-card hrec-sucesso">' +
      '<div class="hrec-suc-ico">✓</div><h3>Agendamento criado!</h3>' +
      '<p>Código <b>' + esc(S.sucesso.codigo) + '</b> · ' + esc(rotuloStatus(S.sucesso.status)) + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="hrec-btn primario" id="hrVerLista">Ver meus agendamentos</button><button class="hrec-btn" id="hrNovo">Novo agendamento</button></div></div></div>';
    document.getElementById('hrVerLista').addEventListener('click', irLista);
    document.getElementById('hrNovo').addEventListener('click', () => novoAgendamento());
  }
  function rotuloStatus(s) { return s === 'confirmado' ? 'Confirmado (crédito reservado)' : 'Aguardando pagamento (Pix)'; }

  // ---------------------------------------------------------------- barra + navegação
  function barraInferior() {
    const c = S.calcPreview;
    const total = c && !c.sobConsulta ? brl(c.totalConfirmado) : '—';
    let btn;
    if (S.step === 1) btn = { txt: S.calcPreview && S.calcPreview.sobConsulta ? 'Solicitar orçamento' : 'Continuar', act: 'next', dis: !podeAvancar1() };
    else if (S.step === 2) btn = { txt: 'Continuar', act: 'next', dis: !S.form.startAt };
    else btn = { txt: S.criando ? 'Criando…' : 'Confirmar agendamento', act: 'criar', dis: S.criando };
    return '<div class="hrec-barra"><div class="hrec-barra-total"><span>Total</span><b>' + total + '</b></div>' +
      '<div class="hrec-barra-btns">' + (S.step > 1 ? '<button class="hrec-btn" data-act="back">Voltar</button>' : '') +
      '<button class="hrec-btn primario" data-act="' + btn.act + '"' + (btn.dis ? ' disabled' : '') + '>' + btn.txt + '</button></div></div>';
  }
  function podeAvancar1() {
    const m = parseFloat(String(S.form.metragem).replace(',', '.')) || 0;
    if (m <= 0) return false;
    if (S.calcPreview && S.calcPreview.sobConsulta) return false; // orçamento é outro fluxo (Bloco 8)
    if (S.tabela.escolheFormatoVideo && !S.form.formatoVideoCru) return false;
    return true;
  }

  function ligar() {
    const g = id => document.getElementById(id);
    g('hrVoltarWiz') && g('hrVoltarWiz').addEventListener('click', irLista);
    if (S.step === 1) {
      g('hrEnd') && g('hrEnd').addEventListener('input', e => { S.form.endereco = e.target.value; });
      g('hrMet') && g('hrMet').addEventListener('input', e => { S.form.metragem = e.target.value; recalcPreview(); manterFoco('hrMet', pintar); });
      g('hrFmt') && g('hrFmt').addEventListener('change', e => { S.form.formatoVideoCru = e.target.value; pintar(); });
      g('hrObs') && g('hrObs').addEventListener('input', e => { S.form.observacoes = e.target.value; });
      root.querySelectorAll('[data-add]').forEach(el => el.addEventListener('change', e => {
        const id = e.target.dataset.add; const def = S.cat.adicionais.find(a => a.id === id) || {};
        S.form.extras[id] = S.form.extras[id] || {}; S.form.extras[id].selecionado = e.target.checked;
        if (e.target.checked) {
          if (!S.form.extras[id].quantidade) S.form.extras[id].quantidade = 1;
          // Espelha o servidor: fixo/sem aprovação entra no total; drone/IA fica pendente.
          S.form.extras[id].status = def.requerAprovacao ? 'aguardando_analise' : 'aprovado';
        }
        recalcPreview(); pintar();
      }));
      root.querySelectorAll('[data-qtd]').forEach(el => el.addEventListener('input', e => {
        const id = e.target.dataset.qtd; S.form.extras[id].quantidade = Math.max(1, +e.target.value || 1); recalcPreview(); manterFoco('hrQtd-' + id, pintar);
      }));
    }
    if (S.step === 2) {
      g('hrProx') && g('hrProx').addEventListener('click', proximoHorario);
      root.querySelectorAll('[data-mes]').forEach(el => el.addEventListener('click', () => mudarMes(+el.dataset.mes)));
      root.querySelectorAll('[data-dia]').forEach(el => el.addEventListener('click', () => { S.form.dateISO = el.dataset.dia; S.form.startAt = null; pintar(); }));
      root.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('click', () => { S.form.startAt = el.dataset.slot; pintar(); }));
    }
    if (S.step === 3) {
      root.querySelectorAll('[data-campo]').forEach(el => el.addEventListener('change', e => { S.form[e.target.dataset.campo] = e.target.value; }));
      root.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => { S.step = +el.dataset.goto; pintar(); }));
      g('hrQt') && g('hrQt').addEventListener('input', e => { S.form.quartos = e.target.value; });
      g('hrResp') && g('hrResp').addEventListener('input', e => { S.form.responsavel = e.target.value; });
      g('hrRespTel') && g('hrRespTel').addEventListener('input', e => { S.form.responsavelTelefone = e.target.value; });
    }
    root.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => acao(el.dataset.act)));
  }

  function acao(a) {
    if (a === 'back') { S.step = Math.max(1, S.step - 1); pintar(); return; }
    if (a === 'next') {
      if (S.step === 1) { S.step = 2; pintar(); carregarDisp(); return; }
      if (S.step === 2) { S.step = 3; pintar(); return; }
    }
    if (a === 'criar') criar();
  }

  async function carregarDisp() {
    S.carregandoDisp = true;
    try {
      const r = await ctx.api.disponibilidade({ ano: S.mesAno.ano, mes: S.mesAno.mes, metragem: parseFloat(String(S.form.metragem).replace(',', '.')) || 0, extras: S.form.extras });
      S.dispCache = r.data;
    } catch (e) { S.dispCache = { dias: {}, durMin: 0, _erro: e.message }; }
    S.carregandoDisp = false;
    if (S.step === 2) pintar();
  }
  function mudarMes(delta) {
    let m = S.mesAno.mes + delta, a = S.mesAno.ano;
    if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; }
    S.mesAno = { ano: a, mes: m }; S.dispCache = null; S.form.dateISO = null; S.form.startAt = null; pintar(); carregarDisp();
  }
  function proximoHorario() {
    const dc = S.dispCache; if (!dc) return;
    const isos = Object.keys(dc.dias).filter(iso => dc.dias[iso].status === 'disponivel' && (dc.dias[iso].slots || []).length).sort();
    if (!isos.length) return;
    S.form.dateISO = isos[0]; S.form.startAt = dc.dias[isos[0]].slots[0]; S.step = 3; pintar();
  }

  async function criar() {
    S.criando = true; pintar();
    try {
      const r = await ctx.api.criar({
        dateISO: S.form.dateISO, startAt: S.form.startAt,
        property: { endereco: S.form.endereco, metragem: parseFloat(String(S.form.metragem).replace(',', '.')) || 0, situacao: S.form.situacao, energia: S.form.energia, acesso: S.form.acesso, quartos: S.form.quartos, responsavel: S.form.responsavel, responsavelTelefone: S.form.responsavelTelefone, observacoes: S.form.observacoes },
        service: { formatoVideoCru: S.form.formatoVideoCru }, extras: S.form.extras
      });
      S.sucesso = r.data; pintar();
    } catch (e) {
      S.criando = false;
      const slotTaken = /SLOT_TAKEN/.test(e.message || '');
      if (slotTaken) { S.step = 2; S.form.startAt = null; S.dispCache = null; pintar(); carregarDisp(); }
      else pintar();
      toast(slotTaken ? 'Esse horário acabou de ser ocupado. Escolha outro.' : (e.message || 'Erro ao criar.'));
    }
  }

  window.HrecAgenda = { render };
})();
