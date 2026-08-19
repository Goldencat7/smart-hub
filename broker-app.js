/* ============================================================================
   Broker — visão nova da Gestão de Locações (SMART HUB).
   Design 1:1 do mockup do Nathan (Broker (1).html). Estilos em broker.css
   (escopados em #bkRoot). Este módulo:
     - monta o SPA dentro de #bkRoot (overlay tela cheia sobre o Hub);
     - carrega DADOS REAIS via Cloud Functions e mapeia pro formato que os
       renderizadores do mockup esperam (assim o visual fica idêntico);
     - TODAS as telas usam dado real (dashboards, fila, relatórios, comissões,
       clicksign, pessoas, imóveis, negócios). SEM dados de demonstração.
     - Onde ainda não há fonte real (Documentos/Drive/Agenda desta visão), a tela
       mostra um estado honesto de "em breve" — nunca números falsos.
   Exposto como window.Broker = { mount, unmount }. Chamado pelo hub-app.js
   quando o gestor abre a aba Locação. NÃO toca nas telas antigas da Locação.
   ============================================================================ */
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getFirestore, collection, doc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-env.js";

// hub-app.js já inicializou o app e (em localhost) ligou os emuladores nas MESMAS
// instâncias; aqui só reaproveitamos — sem re-conectar emulador (evita erro de "já conectado").
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const fns  = getFunctions(app, 'southamerica-east1');
const db   = getFirestore(app);

// Tempo real (padrão campainha): escuta imóveis/negócios e re-busca pela função segura
// quando algo muda. Vire false pra voltar 100% pro on-demand (mount + botão Atualizar).
// ⚠️ Manter igual à flag REALTIME do hub-app.js.
const REALTIME = true;

const call = (name) => httpsCallable(fns, name);
const fnImoveis   = call('locListarImoveis');
const fnNegocios  = call('negocioListar');
const fnNegAtual  = call('negocioAtualizar');
const fnFichaPdf    = call('gerarFichaPdf');        // gera o PDF de uma ficha p/ download
const fnInteressado = call('carteiraInteressado'); // add/remover/aprovar/reprovar interessado
const fnFichasInter = call('listarFichasInteressaveis'); // fichas do Cadastro p/ o seletor "Adicionar interessado"
const fnGerarNeg    = call('negocioGerar');         // gerar negócio de um interessado aprovado (gestor)
const fnAnexarDoc   = call('negocioAnexarDoc');     // gestor/adm sobe documento pra um negócio
const fnRemoverDoc  = call('negocioRemoverDoc');    // gestor/adm remove documento do negócio
const fnDocsClientes= call('documentosClientes');   // sanfona: clientes (fichas) + docs + imóvel vinculado
const fnImovelDoc   = call('carteiraAnexarDoc');    // dono/gestor/adm sobe documento avulso a um imóvel
const fnDriveSync   = call('driveSyncNegocio');     // robô: sincroniza docs+fichas do negócio pro Drive do corretor
const fnFichasProp  = call('listarFichasProprietario');  // fichas de vendedor/locador p/ vincular como proprietário
const fnVincularProp= call('carteiraVincularProprietario'); // vincula ficha existente ao imóvel
const fnNegExcluir  = call('negocioExcluir');       // gestor: exclui negócio
const fnImovelExcluir=call('carteiraExcluirImovel'); // gestor: exclui imóvel
const fnKanbanGet   = call('kanbanColunasGet');     // colunas customizáveis do quadro
const fnKanbanSalvar= call('kanbanColunasSalvar');  // gestor: salva colunas
const fnMoverColuna = call('negocioMoverColuna');   // gestor: move card de coluna (Modelo 2)
const fnFeedSync    = call('sincronizarFeedAgora');  // botão "Atualizar do portal" (feed iList) sob demanda
// Kanban Modelo 2 (Trello): colunas do quadro = config editável; cada negócio tem
// `colunaId` (posição), separado do status. Sem colunaId → deriva do status (migração).
const KANBAN_COLUNAS_PADRAO = [
  { id:'novo', label:'Novo' }, { id:'andamento', label:'Em andamento' },
  { id:'aguard_corretor', label:'Aguard. corretor' }, { id:'aguard_broker', label:'Aguard. broker' }, { id:'aguard_adm', label:'Aguard. adm' },
];
const STATUS_PARA_COLUNA = { negocio_criado:'novo', em_andamento:'andamento', aguardando_corretor:'aguard_corretor', aguardando_broker:'aguard_broker', aguardando_administrativo:'aguard_adm', entregue_gestao:'aguard_adm' };
function kanbanCols(){ return (state.kanbanCols && state.kanbanCols.length) ? state.kanbanCols : KANBAN_COLUNAS_PADRAO; }
function colunaDoDeal(d, cols){ let cid=d.colunaId||STATUS_PARA_COLUNA[d.statusRaw]||''; if(!cols.some(c=>c.id===cid)) cid=(cols[0]||{}).id; return cid; }
async function carregarKanbanCols(){ try{ const r=await fnKanbanGet(); state.kanbanCols=(r.data&&r.data.colunas)||KANBAN_COLUNAS_PADRAO; }catch(_e){ if(!state.kanbanCols) state.kanbanCols=KANBAN_COLUNAS_PADRAO; } }
const fnImovelDocRm = call('carteiraRemoverDoc');   // remove documento avulso do imóvel
const fnCartSalvar  = call('carteiraSalvarImovel'); // edit: valor/dados do imóvel (posse: dono ou gestor)
const fnSugAcao     = call('negocioSugerirAcao');   // IA (Gemini): próxima ação + rascunho de mensagem do negócio
const fnClkEnviar   = call('clicksignEnviar');      // envia um doc do negócio pra assinatura (ClickSign)
const fnClkReenviar = call('clicksignReenviar');    // reenvia o lembrete de assinatura
const fnClkCancelar = call('clicksignCancelar');    // cancela o envelope
const FTIPO_LABEL = { pf:'Cliente PF', pj:'Cliente PJ', locacao_fiador:'Locação c/ Fiador', proposta:'Proposta de compra', fianca:'Fiança' };
let _intPickCache = {};   // id da ficha -> dados (preenchido ao abrir o seletor de interessado)
const fnPessoas   = call('pessoasListar');    // criada no functions/index.js (gestor)
const fnRoster    = call('listarPessoas');    // usuários do Auth {uid,nome}
const fnFotos     = call('listarFotosPerfil');// {uids} -> {fotos:{uid:dataUrl}}
const fnGetPerfil = call('getMeuPerfil');     // {nome,photo,telefone,creci,cpf,email}
const fnSalvarPerfil = call('salvarMeuPerfil');
const fnEventos   = call('listarEventos');    // agenda real do Hub ({de,ate} -> [eventos])

/* ============================ ESTADO ============================ */
const state = {
  view:'dashboard',
  pessoasView:'tabela', pessoasFiltro:'Todos', pessoasCorretor:'Todos', pessoasBusca:'',
  imoveisView:'cards', imoveisFiltro:'Todos', imoveisCorretor:'Todos', imoveisBusca:'', imoveisSort:'recente', mesFiltro:'todos',
  negFiltroTipo:'Todos', negFiltroStatus:'Todos', negCorretor:'Todos', negBusca:'', negView:'tabela',
  relCorretor:'Todos', cfgTab:'usuarios',
  currentDeal:null, dealTab:'timeline', currentPerson:null, pessoaTab:'dados',
  currentProp:null, imovelTab:'dados',
  loaded:false, meuNome:'Broker', onExit:null,
  role:'broker',        // 'broker' (gestor) | 'corretor' | 'administrativo'
  filaBusca:'', perfilCache:null,
  leadsBusca:'', leadsFiltro:'Todos', leadsOrigem:'Todos', leadsVeTudo:false,   // Leads do C2S
  leadVincLeadId:null, leadVincBusca:'',   // picker "vincular a um imóvel"
};

// Dados reais (preenchidos por carregarDados) — no FORMATO do mockup.
let PROPERTIES = [];
let PROPERTIES_ALL = [];   // inclui arquivados — usado SÓ na tela de Imóveis (filtro "Arquivado")
let DEALS = [];
let DEALS_DOCS = [];   // TODOS os negócios (inclui cancelados) — só pra tela Documentos, pra os anexos de negócio cancelado não sumirem da UI (gestor ainda baixa/remove)
let PEOPLE = [];
let CORRETORES = {};   // uid -> {id, nome, ini, cor, foto}
let KPI = { comissaoPrevista:0, comissaoRecebida:0, comissaoPendente:0, pagoCorretores:0, pendenteCorretores:0, encerradosMes:0, tempoMedioDias:0 };
let ACTIVITY = [];

/* ============================ HELPERS ============================ */
const ROOT = () => document.getElementById('bkRoot');
const $ = (s) => ROOT() ? ROOT().querySelector(s) : null;
const person = id => PEOPLE.find(p=>p.id===id) || {nome:'—', tipos:[], docs:[], obs:'—', cpf:'—', email:'—', tel:'—', cidade:'—', desde:'—'};
const prop = id => (PROPERTIES_ALL||PROPERTIES).find(p=>p.id===id) || {rua:'—', bairro:'', cidade:'', code:'', tipo:'', preco:0, finalidade:'', docs:[]};  // ALL: abrir imóvel arquivado não pode cair no placeholder vazio
function brl(n){ n=Number(n)||0; if(n>=1000000) return 'R$ '+(n/1000000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M'; if(n>=10000) return 'R$ '+Math.round(n/1000)+'k'; return 'R$ '+n.toLocaleString('pt-BR'); }
function brlFull(n){ return 'R$ '+(Number(n)||0).toLocaleString('pt-BR'); }
// Valores de imóvel (valorAnuncio/valorComissao) são TEXTO LIVRE no backend
// ("R$ 2.500,00", "2.500", "2500/mês"). Number() cru → NaN e contamina VGV/ticket/comissão.
// Parser tolerante ao formato pt-BR: mantém só dígitos/separadores e resolve milhar × decimal.
function parseMoney(v){
  if(typeof v==='number') return isFinite(v)?v:0;
  if(v==null) return 0;
  let s=String(v).replace(/[^\d.,]/g,'');
  if(!s) return 0;
  if(s.includes(',')&&s.includes('.')){
    // o último separador é o decimal
    if(s.lastIndexOf(',')>s.lastIndexOf('.')) s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  } else if(s.includes(',')){
    s=s.replace(/\./g,'').replace(',','.');
  } else {
    // só pontos: "2.500" = milhar (grupo final de 3 dígitos); "2.5" = decimal
    const parts=s.split('.');
    if(parts.length>1 && parts[parts.length-1].length===3) s=s.replace(/\./g,'');
  }
  const n=Number(s);
  return isFinite(n)?n:0;
}
function ini(nome){ const p=(nome||'').trim().split(/\s+/); return (((p[0]||'')[0]||'')+((p[p.length-1]||'')[0]||'')).toUpperCase()||'?'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Tipo aceito no upload de doc (negócio/imóvel): PDF, imagem raster (não SVG) ou
// documento de escritório (Word/Excel/PowerPoint/RTF/TXT/CSV) — por mime OU extensão
// (alguns navegadores dão file.type vazio no .docx). O servidor é o gate final.
const _DOC_EXT_OK=/\.(docx?|xlsx?|pptx?|rtf|txt|csv)$/i;
const _DOC_MIME_OK=new Set(['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/rtf','text/rtf','text/plain','text/csv']);
function _docTipoOk(f){ const tp=((f&&f.type)||'').toLowerCase().split(';')[0].trim(); if(tp==='application/pdf') return true; if(tp.indexOf('image/')===0 && tp.indexOf('svg')<0) return true; if(_DOC_MIME_OK.has(tp)) return true; if(_DOC_EXT_OK.test((f&&f.name)||'')) return true; return false; }
const _DOC_ACCEPT='application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.txt,.csv';
// Busca sem acento/caixa ("jose" acha "José") — aplicar na query E no texto pesquisado.
function semAcento(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
// ─── Repasse do corretor (% da comissão da imobiliária que fica com o corretor) ───
// Regra definida pelo chefe: 45% para a lista abaixo, 40% para os demais. Casa pelo
// PRIMEIRO nome, sem acento/caixa (ex.: "rafa" pega "Rafael"). É só editar esta lista
// se a regra mudar; quem não estiver aqui recebe 40%.
const REPASSE_45 = ['adriana','aline','alexandre','leandro','karina','rafa','kelvin','lynderson','mauricio','fernanda'];
function repassePctPorNome(nome){
  const primeiro = semAcento(nome).trim().split(/\s+/)[0] || '';
  if(!primeiro) return 0.40;
  const bate = REPASSE_45.some(t => primeiro===t || primeiro.startsWith(t) || t.startsWith(primeiro));
  return bate ? 0.45 : 0.40;
}
function repassePct(uid){ return repassePctPorNome(corrNome(uid)); }
// Baixa um PDF a partir de base64 (funciona no .exe e no navegador).
function baixarPdfBase64(b64, filename){
  try{ const bin=atob(b64); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([arr],{type:'application/pdf'}));
    const a=document.createElement('a'); a.href=url; a.download=filename||'ficha.pdf'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }catch(e){ toast('Não foi possível baixar o PDF','alert-triangle','var(--danger)'); }
}
// Baixa um texto (CSV etc.) como arquivo — mesmo truque do PDF (Blob + <a download>).
function baixarTexto(texto, filename, mime){
  try{ const url=URL.createObjectURL(new Blob([texto],{type:(mime||'text/plain')+';charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=filename||'arquivo.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }catch(e){ toast('Não foi possível baixar o arquivo','alert-triangle','var(--danger)'); }
}
// CSV pt-BR: BOM (Excel abre com acento) + separador ';' + escape de aspas.
// Anti-injeção de fórmula: célula começando com = + - @ (ou tab/CR) ganha um
// apóstrofo — o texto vem de FICHA PREENCHIDA POR CLIENTE ANÔNIMO (nome, endereço),
// e sem isso o Excel do gestor executaria "=HYPERLINK(...)" ao abrir o export.
function _csvCel(v){ let s=String(v==null?'':v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; s=s.replace(/"/g,'""'); return /[";\r\n]/.test(s)?'"'+s+'"':s; }
function montarCSV(linhas){ return '﻿'+linhas.map(l=>l.map(_csvCel).join(';')).join('\r\n'); }
function icon(n,sz=18,cls=''){ return '<i data-lucide="'+n+'" class="'+cls+'" style="width:'+sz+'px;height:'+sz+'px"></i>'; }
// Converte SÓ os ícones ainda não convertidos e SÓ dentro do #bkRoot. A versão
// global (createIcons() sem root) varria o documento inteiro e RECONSTRUÍA todos
// os <svg data-lucide> já prontos (o lucide mantém o atributo) a cada toast/drawer/
// render — O(todos-os-ícones) por clique, e a UI ia "lagando" com o uso (causa do
// travamento reportado em 2026-07-29). O guard de <i data-lucide> torna a chamada
// no-op quando não há nada novo a converter.
function refreshIcons(){
  if(!window.lucide) return;
  const root = ROOT(); if(!root) return;
  if(!root.querySelector('i[data-lucide]')) return;   // tudo já convertido — nada a fazer
  try{ window.lucide.createIcons({ root }); }catch(e){}
}
const STATUS = {
  // rótulos amigáveis (venda/locação) + status reais de negócio
  'Disponível':'success','Em negociação':'info',
  'Negócio criado':'info','Em andamento':'info','Aguardando broker':'warning',
  'Aguardando corretor':'warning','Aguardando administrativo':'warning',
  'Entregue à gestão':'success','Concluído':'success','Cancelado':'danger',
  'Vendido':'ai','Alugado':'ai',
};
function pill(txt,variant){ return '<span class="pill '+(variant||'neutral')+'"><span class="dot"></span>'+esc(txt)+'</span>'; }
function statusPill(s){ return pill(s, STATUS[s]||'neutral'); }
function avatar(nome,size=36,bg='var(--brand)',foto){ if(foto) return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background-image:url('+esc(foto)+');background-size:cover;background-position:center"></span>'; return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:'+bg+';font-size:'+(size<30?10:12)+'px">'+esc(ini(nome))+'</span>'; }
const TINT = { info:['#EFF4FF','#1D4ED8'], success:['#ECFDF3','#15803D'], warning:['#FFFAEB','#B45309'], danger:['#FEF2F2','#B91C1C'], ai:['#F5F0FF','#6D28D9'], brand:['#EFF4FF','#2563EB'] };
function iconChip(ico,variant,size=40){ const t=TINT[variant]||TINT.brand; return '<span class="iconchip" style="width:'+size+'px;height:'+size+'px;background:'+t[0]+';color:'+t[1]+'">'+icon(ico,size>34?20:16)+'</span>'; }
const COR_PALETA = ['#2563EB','#7C3AED','#DB2777','#0EA5E9','#16A34A','#F59E0B','#9333EA','#0D9488'];
function corDe(uid){ let h=0; const s=String(uid||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return COR_PALETA[h%COR_PALETA.length]; }
function diasEntre(iso){ if(!iso) return 0; return Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/86400000)); }
function relData(iso){ if(!iso) return '—'; const d=diasEntre(iso); if(d===0) return 'Hoje'; if(d===1) return 'Ontem'; return 'Há '+d+' dias'; }

/* (Removidos os dados de DEMONSTRAÇÃO — TEAM/Smart Score/IA. Todas as telas usam
   dado real; onde ainda não há fonte, a tela mostra estado "em breve".) */

/* ============================ MAPEADORES real -> shape do mockup ============================ */
const FINAL_LABEL = { locacao:'Locação', venda:'Venda', venda_locacao:'Venda e Locação' };
const NEG_STATUS_LABEL = {
  negocio_criado:'Negócio criado', em_andamento:'Em andamento', aguardando_broker:'Aguardando broker',
  aguardando_corretor:'Aguardando corretor', aguardando_administrativo:'Aguardando administrativo',
  entregue_gestao:'Entregue à gestão', concluido:'Concluído', cancelado:'Cancelado',
};
function fmtCodImovel(im){ if(im.feedListingId) return im.feedListingId; const n=im.numeroProtocolo; return n!=null ? '#SH-'+String(n).padStart(4,'0') : (im.id||'').slice(0,6); }
function endImovel(im){ const e=im.endereco||{}; const l=[e.logradouro, e.numero].filter(Boolean).join(', '); return l||im.referencia||'Imóvel sem endereço'; }

// Rótulos das pendências da ficha (campos que o cliente marcou "não tenho agora").
const IMOVEL_NOMES_PEND = { rgcpf:'RG e CPF', energia:'Conta de energia', agua:'Conta de água', gas:'Conta de gás', iptu_doc:'Documento do IPTU', condominio_doc:'Doc. do condomínio', profissao:'Profissão', im_admcond:'Adm. condominial', im_admcontato:'Contato adm', im_condominio:'Condomínio', im_iptu:'IPTU', im_valorcond:'Valor condomínio', im_enel:'ENEL', im_sabesp:'Sabesp', im_comgas:'Comgás', im_contribuinte:'Contribuinte IPTU' };
function pendLabel(k){ return IMOVEL_NOMES_PEND[k] || String(k).replace(/^im_/,'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()); }
function mapImovel(im){
  const e = im.endereco||{};
  const fin = FINAL_LABEL[im.finalidade] || 'Locação';
  const preco = parseMoney(im.valorAnuncio || im.valorProposta || im.valorFechamento || 0);
  const concluido = im.situacao==='concluido';
  const situ = im.arquivado ? 'Arquivado' : (concluido ? (im.tagFinal || 'Concluído') : (im.situacao==='em_negociacao' ? 'Em negociação' : 'Disponível'));
  return {
    id: im.id, raw: im,
    code: fmtCodImovel(im),
    rua: endImovel(im),
    bairro: e.bairro||'—',
    cidade: [e.cidade, e.estado].filter(Boolean).join(' · ')||'—',
    finalidade: fin, finalidadeRaw: im.finalidade,
    tipo: im.tipo||'Imóvel',
    preco,
    proprietarioNome: im.proprietarioNome || im.locadorNome || '—',
    proprietarioContato: im.proprietarioContato || '',
    corretor: im.corretorUid, corretorNome: im.corretorNome||'',
    status: situ, concluido,
    arquivado: !!im.arquivado,
    dorm: im.dormitorios||null, vaga: im.vagas!=null?im.vagas:null, area: im.area||null,
    mat: im.matricula||'—', iptu: im.iptu||im.contribuinteIptu||'—', escritura: !!im.escritura,
    fotos: ((im.documentos&&im.documentos.fotos&&im.documentos.fotos.length) || (im.feedDados&&(im.feedDados.qtdFotos||(im.feedDados.fotos&&im.feedDados.fotos.length))) || 0), tour:false,
    feed: im.feedDados||null, capa: (im.feedDados&&im.feedDados.fotos&&im.feedDados.fotos[0])||'', portalUrl: (im.feedDados&&im.feedDados.detalheUrl)||'',
    interessados: im.interessados||[],
    pendentes: im.pendentes||[],
    criadoEm: im.criadoEm||null,
    dataFmt: (im.criadoEm||'').slice(0,10).split('-').reverse().join('/'),
  };
}

function chkPct(cl){ if(!cl||!cl.length) return 0; const f=cl.filter(x=>x.feito).length; return Math.round(f/cl.length*100); }
// Checklist NOVO (2026-08): venda usa compromisso_*; locação usa contrato_assinado.
// As chaves antigas (contrato_emitido/aprovado) ficam pros negócios já criados.
function clicksignDe(cl){ cl=cl||[]; const f=k=>cl.find(x=>x.key===k&&x.feito); if(f('contrato_assinado')||f('compromisso_assinado')) return 'Concluído'; if(f('contrato_emitido')||f('contrato_aprovado')||f('compromisso_emitido')||f('compromisso_aprovado')) return 'Enviado'; return '—'; }
// Valor total da PROPOSTA (o que o comprador paga): soma do sinal + parcelas + FGTS +
// financiamento. Vira a base da comissão quando informado (pedido do Marcelo: imóvel 340k,
// proposta 330k ⇒ comissão sobre 330k). Vazio (0) ⇒ cai no valor do imóvel, como antes.
function _propostaTotal(p){ if(!p) return 0; return ['sinal','parcelaA','parcelaB','fgtsValor','financiamento'].reduce((s,k)=>s+parseMoney(p[k]||0),0); }
function mapNegocio(n){
  // PROPERTIES_ALL (não PROPERTIES): imóvel ARQUIVADO após concluir a venda ainda
  // precisa dar preço/comissão ao negócio — senão KPIs e "Minhas Comissões" zeravam.
  const im = (PROPERTIES_ALL||[]).find(p=>p.id===n.imovelId);
  const precoImovel = im ? im.preco : 0;
  const tipo = n.tipo==='venda' ? 'Venda' : 'Locação';
  // Base da comissão = VALOR DA PROPOSTA quando informado; senão, valor do imóvel (como antes).
  // Venda: soma sinal+parcelas+FGTS+financiamento. Locação: o "Valor acordado" (aluguel negociado).
  const totalProposta = tipo==='Venda'
    ? _propostaTotal(n.proposta)
    : parseMoney((n.proposta && n.proposta.valorAcordado) || 0);
  const usaProposta = totalProposta > 0;
  const preco = usaProposta ? totalProposta : precoImovel;
  // % de comissão: editável por negócio (n.comissaoPct — venda com parceria cai pra 3%,
  // negociadas 4/5%); padrão venda 6%, locação 100%. O valor do feed (valorComissao)
  // só vale quando NÃO há % editado E não há proposta informada.
  const pctPadrao = tipo==='Venda' ? 6 : 100;
  const comPct = (isFinite(n.comissaoPct) && n.comissaoPct>0) ? n.comissaoPct : pctPadrao;
  const comBruto = (im&&im.raw&&im.raw.valorComissao) ? parseMoney(im.raw.valorComissao) : 0;
  const comValor = usaProposta ? (preco*comPct/100)
                 : (n.comissaoPct ? preco*comPct/100 : (comBruto || preco*pctPadrao/100));
  const rel = relData(n.atualizadoEm || n.criadoEm);
  return {
    id: n.id, raw: n,
    code: n.codigo || '—',
    tipo,
    status: NEG_STATUS_LABEL[n.status] || n.status || '—', statusRaw: n.status,
    corretor: n.corretorUid, corretorNome: n.corretorNome||'',
    imovelId: n.imovelId, imovelResumo: n.imovelResumo||'', cidade: n.cidade||'',
    clienteNome: n.clienteNome||'—', clienteContato: n.clienteContato||'',
    valor: preco, comPct, comValor, comStatus:'Prevista',
    comDoFeed: (!usaProposta && !n.comissaoPct && !!comBruto),   // valor veio do feed — o rótulo não pode dizer "(6%)"
    criado: (n.criadoEm||'').slice(0,10).split('-').reverse().join('/'), criadoEm: n.criadoEm||'',
    prox: n.proximaAcao || 'Sem próxima ação definida',
    proxData: rel, diasParado: diasEntre(n.atualizadoEm || n.criadoEm),
    clicksign: clicksignDe(n.checklist), progresso: chkPct(n.checklist),
    clicksignEnv: (n.clicksign && n.clicksign.envelopeId) ? n.clicksign : null,   // envelope REAL da assinatura (ClickSign)
    checklist: n.checklist||[], comentarios: n.comentarios||[], timeline: n.timeline||[], driveUrl: n.driveUrl||'',
    driveDestinoUrl: n.driveDestinoUrl||'',   // pasta-mãe onde o robô cria a pasta deste negócio
    arquivado: n.arquivado===true, motivoCancelamento: n.motivoCancelamento||'',
    colunaId: n.colunaId||'', origem: n.origem||'',   // kanban Modelo 2 + origem do cliente
    campos: n.campos||{}, proposta: n.proposta||{},   // campos personalizados + proposta (Marcelo)
    tags: Array.isArray(n.tags) ? n.tags : [],
    tarefas: Array.isArray(n.tarefas) ? n.tarefas : [],
    // O servidor só devolve o array pra quem PODE comentar (broker + corretor do
    // negócio); ausente/null = sem permissão. `!==null` deixava `undefined` passar.
    podeComentar: Array.isArray(n.comentarios),
  };
}

/* prop()/person() para negócios: fallback quando o imóvel/cliente não está carregado */
function propDoDeal(d){ return PROPERTIES.find(p=>p.id===d.imovelId) || {rua:d.imovelResumo||'Imóvel', bairro:'', cidade:d.cidade||'', code:'', tipo:'', preco:d.valor, finalidade:d.tipo}; }

/* ============================ CARREGAMENTO DE DADOS ============================ */
async function carregarDados(){
  // Falha de rede/cold-start REJEITA (não vira lista vazia): senão um blip no meio
  // do refresh do tempo real zerava PROPERTIES/DEALS e a tela mostrava KPI R$ 0 /
  // carteira vazia em silêncio. Quem chama trata: mount → card de erro; _rtOnChange
  // → aborta o re-render (mantém os dados antigos); refresh → toast.
  // Recarrega também a config das colunas do kanban (o broadcast do kanbanColunasSalvar
  // dispara carregarDados nos outros clientes — sem isto eles ficavam com colunas velhas).
  const [imR, ngR] = await Promise.all([ fnImoveis({}), fnNegocios({}), (state.kanbanCols ? carregarKanbanCols() : Promise.resolve()) ]);
  const imoveisRaw = (imR.data&&imR.data.imoveis)||[];
  PROPERTIES_ALL = imoveisRaw.map(mapImovel);
  PROPERTIES = PROPERTIES_ALL.filter(p=>!p.arquivado);
  const negociosRaw = (ngR.data&&ngR.data.negocios)||[];
  DEALS = negociosRaw.filter(n=>n.status!=='cancelado').map(mapNegocio);
  DEALS_DOCS = negociosRaw.map(mapNegocio);   // inclui cancelados (docs continuam acessíveis na tela Documentos)

  // Corretores (para nomes/cores/fotos nas tabelas). Base: nomes que já vêm nos docs.
  CORRETORES = {};
  const addCorr = (uid,nome)=>{ if(!uid) return; if(!CORRETORES[uid]) CORRETORES[uid]={id:uid,nome:nome||'Corretor',ini:ini(nome),cor:corDe(uid),foto:''}; else if(nome&&CORRETORES[uid].nome==='Corretor') CORRETORES[uid].nome=nome; };
  PROPERTIES.forEach(p=>addCorr(p.corretor,p.corretorNome));
  DEALS.forEach(d=>addCorr(d.corretor,d.corretorNome));

  recalcKPI();
  state.loaded = true;
}

// KPIs + atividades derivados de DEALS. Fora do carregarDados pra poder recalcular
// depois de escritas locais (concluir/cancelar) sem refazer as chamadas de rede —
// senão o funil/comissões mostravam número velho até remontar a aba.
// KPI sobre UMA lista de negócios (recebe a lista) — assim os dashboards recalculam
// sobre o subconjunto filtrado por mês sem tocar no DEALS global.
function kpiDe(ds){
  const k = {
    comissaoPrevista: ds.reduce((s,d)=>s+(d.comValor||0),0),
    comissaoRecebida: ds.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+(d.comValor||0),0),
    comissaoPendente: ds.filter(d=>d.statusRaw!=='concluido').reduce((s,d)=>s+(d.comValor||0),0),
    pagoCorretores: 0, pendenteCorretores: 0,
    encerradosMes: ds.filter(d=>d.statusRaw==='concluido'||d.statusRaw==='entregue_gestao').length,
    concluidos: ds.filter(d=>d.statusRaw==='concluido').length,
    // "ativos" = em andamento de verdade (exclui concluído/entregue; cancelado já saiu de DEALS)
    ativos: ds.filter(d=>d.statusRaw!=='concluido'&&d.statusRaw!=='entregue_gestao').length,
    tempoMedioDias: 0,
  };
  k.pagoCorretores = Math.round(ds.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+(d.comValor||0)*repassePct(d.corretor),0));
  k.pendenteCorretores = Math.round(ds.filter(d=>d.statusRaw!=='concluido').reduce((s,d)=>s+(d.comValor||0)*repassePct(d.corretor),0));
  return k;
}
function atividadesDe(ds){
  return ds.flatMap(d=>(d.timeline||[]).map(t=>({ico:'circle-dot',cor:'info',txt:t.texto||'Atualização',sub:d.code+' · '+(d.corretorNome||''),quando:relData(t.em),_em:t.em})))
    .sort((a,b)=>(b._em||'').localeCompare(a._em||'')).slice(0,6);
}
function recalcKPI(){ KPI = kpiDe(DEALS); ACTIVITY = atividadesDe(DEALS); }

// ── Filtro por MÊS (dashboards / Negócios / Imóveis) ──
// Filtra por `criadoEm` (quando o negócio/imóvel nasceu). Vazio/"todos" = tudo.
const _MES_NOMES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function mesLabel(ym){ const p=String(ym).split('-'); return (_MES_NOMES[(+p[1])-1]||'?')+'/'+p[0]; }
function noMes(iso){ return !state.mesFiltro || state.mesFiltro==='todos' || String(iso||'').slice(0,7)===state.mesFiltro; }
function dealsView(){ return DEALS.filter(d=>noMes(d.criadoEm)); }
function propsView(){ return PROPERTIES.filter(p=>noMes(p.criadoEm)); }
function mesesDisponiveis(){ const s=new Set(); DEALS.forEach(d=>{ const m=String(d.criadoEm||'').slice(0,7); if(m) s.add(m); }); PROPERTIES.forEach(p=>{ const m=String(p.criadoEm||'').slice(0,7); if(m) s.add(m); }); return [...s].sort().reverse(); }
function mesSelect(){ const opts=[['todos','Todos os meses']].concat(mesesDisponiveis().map(m=>[m,mesLabel(m)])); return '<select class="input" data-action="mesfiltro" title="Filtrar por mês" style="width:auto;background-color:var(--raised);border-color:var(--bd);color:#fff">'+opts.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===(state.mesFiltro||'todos')?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>'; }
function rerenderMes(){ const v=state.view; if((v==='dashboard'||v==='negocios'||v==='imoveis') && RENDERERS[v]){ RENDERERS[v]($('#root')); refreshIcons(); } }

async function carregarPessoas(){
  // Real: coleção `pessoas` (locadores/locatários com PII) + interessados dos imóveis.
  let base = [];
  try {
    const r = await fnPessoas({});
    base = (r.data && r.data.pessoas) || [];
  } catch(e){ base = []; }
  const PAPEL = { locador:'Proprietário', locatario:'Locatário', comprador:'Comprador', fiador:'Fiador' };
  const arr = base.map((p,i)=>({
    id: p.id || ('pes'+i),
    nome: p.nome||'—',
    tipos: [PAPEL[p.papel]||'Proprietário'],
    cpf: p.cpf||'—', email: p.email||'—', tel: p.whatsapp||p.fixo||'—',
    cidade: (p.endereco&&[p.endereco.cidade,p.endereco.estado].filter(Boolean).join(' · '))||'—',
    desde: (p.atualizadoEm||'').slice(0,4)||'—',
    docs: [], obs: p.obs||'—',
    _corretor: p.corretorUid||'',
  }));
  // Interessados (compradores/locatários por imóvel) que não estão na coleção pessoas.
  const vistos = new Set(arr.map(p=>(p.nome||'').toLowerCase()+'|'+(p.cpf||'')));
  PROPERTIES.forEach(im=>{
    (im.interessados||[]).forEach((it,i)=>{
      const key=(it.nome||'').toLowerCase()+'|';
      if(!it.nome || [...vistos].some(v=>v.startsWith(key))) return;
      vistos.add(key);
      arr.push({ id:'int_'+im.id+'_'+i, nome:it.nome, tipos:[it.tipo==='comprador'?'Comprador':'Locatário'],
        cpf:it.cpf||'—', email:it.email||'—', tel:it.telefone||it.contato||'—', cidade:'—', desde:'—', docs:[], obs:'Interessado no imóvel '+im.code, fichaId:it.fichaId||'', fichaTipo:it.fichaTipo||'', _corretor:im.corretor||'' });
    });
  });
  PEOPLE = arr;
}

/* ============================ UI INFRA ============================ */
const RENDERERS = {};
// Configurações e "sair da conta" ficam SÓ no Hub (pedido do Nathan) — não entram aqui.
const NAVITEMS = [ {id:'dashboard',ico:'layout-dashboard',label:'Dashboard'},{id:'leads',ico:'inbox',label:'Leads'},{id:'pessoas',ico:'users',label:'Pessoas'},{id:'imoveis',ico:'building-2',label:'Imóveis'},{id:'negocios',ico:'handshake',label:'Negócios'},{id:'documentos',ico:'folder',label:'Documentos'},{id:'clicksign',ico:'file-signature',label:'Clicksign'},{id:'relatorios',ico:'bar-chart-3',label:'Relatórios'},{id:'conciliacao',ico:'clipboard-check',label:'Conciliação'} ];
const CRUMB = { dashboard:['SMART HUB','Dashboard'], leads:['SMART HUB','Leads'], pessoas:['SMART HUB','Pessoas'], imoveis:['SMART HUB','Imóveis'], negocios:['SMART HUB','Negócios'], relatorios:['SMART HUB','Relatórios'], conciliacao:['SMART HUB','Conciliação de Malote'], configuracoes:['SMART HUB','Configurações'] };

function renderNav(target){ if(!target) return; target.innerHTML = NAVITEMS.map(n=>'<button class="navitem'+(state.view===n.id?' active':'')+'" data-nav="'+n.id+'">'+icon(n.ico,18)+n.label+'</button>').join(''); }
function renderBreadcrumb(){ const c=CRUMB[state.view]||['SMART HUB','—']; const b=$('#breadcrumb'); if(b) b.innerHTML='<span class="tmut nowrap">'+c[0]+'</span>'+icon('chevron-right',15,'tmut')+'<span class="tw fw6 trunc">'+c[1]+'</span>'; }

function navigate(view){
  if(view) state.view=view;
  state._viewingDeal = false;   // saiu do detalhe de um negócio (real-time pode re-renderizar)
  _teardownDealRT();            // desliga os comentários ao vivo do negócio que estava aberto
  // Modo embutido: avisa o Hub pra sanfona destacar o sub-item certo mesmo quando
  // a navegação nasce DENTRO do Broker (KPI cards, "Voltar aos Negócios" etc.).
  if(state.embedded && typeof state.onNavigate==='function'){ try{ state.onNavigate(state.view); }catch(e){} }
  closeDrawer(); closeModal(); closeMobileNav();
  renderNav($('#nav')); renderNav($('#navMobile')); renderBreadcrumb();
  const host=$('#root'); if(!host) return;
  host.style.animation='none'; void host.offsetWidth; host.style.animation='';
  (RENDERERS[state.view]||(h=>h.innerHTML=''))(host);
  const sc=$('#scroller'); if(sc) sc.scrollTop=0; refreshIcons();
}
function openDrawer(html){ $('#drawerBody').innerHTML=html; const o=$('#overlay'); o.classList.remove('hide'); requestAnimationFrame(()=>{o.classList.add('show');$('#drawer').classList.add('show');}); refreshIcons(); }
function closeDrawer(){ const d=$('#drawer'); if(d) d.classList.remove('show'); maybeHideOverlay(); setTimeout(()=>{ const dd=$('#drawer'); if(dd&&!dd.classList.contains('show')){ const b=$('#drawerBody'); if(b) b.innerHTML=''; } },240); }
function openModal(html){ $('#modal').innerHTML=html; const o=$('#overlay'); o.classList.remove('hide'); requestAnimationFrame(()=>{o.classList.add('show');$('#modal').classList.add('show');}); refreshIcons(); }
function closeModal(){ const m=$('#modal'); if(m) m.classList.remove('show'); maybeHideOverlay(); setTimeout(()=>{ const mm=$('#modal'); if(mm&&!mm.classList.contains('show')) mm.innerHTML=''; },240); }
function openMobileNav(){ $('#mobilenav').classList.add('show'); const o=$('#overlay'); o.classList.remove('hide'); requestAnimationFrame(()=>o.classList.add('show')); }
function closeMobileNav(){ const m=$('#mobilenav'); if(m) m.classList.remove('show'); maybeHideOverlay(); }
function maybeHideOverlay(){ const has=id=>{const el=$(id);return el&&el.classList.contains('show');}; const open=has('#drawer')||has('#modal')||has('#mobilenav'); if(!open){ const o=$('#overlay'); if(o){ o.classList.remove('show'); setTimeout(()=>{ if(!has('#drawer')&&!has('#modal')&&!has('#mobilenav')) o.classList.add('hide'); },220); } } }
let toastT; function toast(msg,ico='check-circle-2',cor='var(--success)'){ const t=$('#toast'); if(!t) return; t.innerHTML='<div class="fx ac g2" style="background:var(--ink900);color:#fff;font-size:14px;font-weight:500;padding:12px 16px 12px 14px;border-radius:12px;box-shadow:var(--lg)"><i data-lucide="'+ico+'" style="width:16px;height:16px;color:'+cor+'"></i>'+esc(msg)+'</div>'; t.classList.add('show'); refreshIcons(); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2800); }

function pageHead(title,desc,actions){ const refresh='<button class="btn btn-outline sm" data-action="refresh" title="Atualizar (buscar dados novos do servidor)">'+icon('refresh-cw',15)+'Atualizar</button>'; return '<div class="fx as jb wrap g4" style="margin-bottom:24px"><div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+title+'</h1><p style="margin:6px 0 0;font-size:14px;color:var(--ondarkmuted);max-width:640px">'+desc+'</p></div><div class="fx ac g2 nsh">'+refresh+(actions||'')+'</div></div>'; }
function cardHead(title,right){ return '<div class="fx ac jb g3" style="padding:16px 20px 14px;border-bottom:1px solid var(--ink100)"><h2 class="up trunc" style="margin:0;font-size:13px;font-weight:700;color:var(--ink800)">'+title+'</h2>'+(right?'<div class="nsh">'+right+'</div>':'')+'</div>'; }
function drawerHead(title,sub){ return '<div class="fx ac jb g3" style="padding:18px 20px;border-bottom:1px solid var(--ink100)"><div class="mw0"><div class="fz18 fw7 t900 trunc">'+esc(title)+'</div>'+(sub?'<div class="fz13 t500 trunc" style="margin-top:2px">'+esc(sub)+'</div>':'')+'</div><button class="iconbtn" style="background:var(--ink50);border-color:var(--ink200);color:var(--ink500);width:34px;height:34px" data-action="close-drawer"><i data-lucide="x" style="width:18px;height:18px"></i></button></div>'; }
function vazio(ico,txt){ return '<div class="card tcenter t500" style="padding:48px 0"><div class="t400">'+icon(ico,26)+'</div><p style="margin-top:10px" class="fz14 fw5">'+txt+'</p></div>'; }

/* ============================ MOUNT / UNMOUNT ============================ */
function shellHTML(){
  return ''
  + '<div class="app">'
  +   '<aside class="sidebar" id="sidebar">'
  +     '<div style="padding:20px 16px 12px">'
  +       '<div class="fx ac" style="gap:2px;color:#fff;font-size:20px;font-weight:700;letter-spacing:-.02em;padding:0 4px">Smart<span class="tmut fw5">Hub</span></div>'
  +       '<button class="btn btn-dark sm" data-action="sair" style="width:100%;margin-top:14px;justify-content:flex-start" title="Voltar ao Hub">'+icon('arrow-left',15)+'Voltar ao Hub</button>'
  +     '</div>'
  +     '<nav id="nav" class="fx col g1" style="padding:0 12px"></nav>'
  +     '<div style="margin-top:auto;padding:12px">'
  +       '<div class="fx ac g3" style="padding:12px;border-radius:12px;background:var(--base);border:1px solid var(--bd)">'
  +         '<span class="avatar" id="bkMeAvatar" style="width:36px;height:36px;background:var(--brand)">'+ini(state.meuNome)+'</span>'
  +         '<div class="mw0"><div class="fz13 fw6 tw trunc" id="bkMeNome">'+esc(state.meuNome)+'</div><div class="fz11 tmut">'+roleLabel()+'</div></div>'
  +       '</div>'
  +     '</div>'
  +   '</aside>'
  +   '<div class="fx col grow" style="min-width:0">'
  +     '<header class="topbar">'
  +       '<div class="fx ac g3 mw0"><button class="menuBtn" data-action="mobilenav"><i data-lucide="menu" style="width:20px;height:20px"></i></button><div id="breadcrumb" class="fx ac g2 fz13 fw5 mw0"></div></div>'
  +       '<div class="fx ac g3 nsh">'
  +         (state.role==='corretor' ? '<button class="btn btn-primary sm" data-action="novo-menu" style="white-space:nowrap"><i data-lucide="plus" style="width:16px;height:16px"></i>Novo</button>' : '')
  +         '<div class="searchbox"><i data-lucide="search" style="width:16px;height:16px;color:var(--ondarkmuted)"></i><input id="globalSearch" placeholder="Buscar pessoas, imóveis, negócios…"></div>'
  +         '<div class="fx ac g2 hide-sm" style="padding-left:4px"><span class="avatar" id="bkMeAvatar2" style="width:38px;height:38px;background:var(--brand)">'+ini(state.meuNome)+'</span><div style="line-height:1.3"><div class="fz13 fw6 tw" id="bkMeNome2">'+esc(state.meuNome)+'</div><div class="fz11 tmut">'+roleLabel()+' · REMAX SMART</div></div></div>'
  +       '</div>'
  +     '</header>'
  +     '<main id="scroller"><div id="root"></div></main>'
  +   '</div>'
  + '</div>'
  + '<div id="overlay" class="ov hide"></div>'
  + '<aside id="drawer" class="drawer"><div id="drawerBody" class="fx col" style="height:100%;min-height:0"></div></aside>'
  + '<div id="modal" class="modal"></div>'
  + '<div id="toast" class="toast"></div>'
  + '<aside id="mobilenav" class="mobilenav"><div class="fx ac jb" style="padding:20px"><div style="color:#fff;font-size:20px;font-weight:700">Smart<span class="tmut fw5">Hub</span></div><button style="background:none;border:none;color:var(--ondarkmuted);cursor:pointer" data-action="mobilenav-close"><i data-lucide="x" style="width:20px;height:20px"></i></button></div><nav id="navMobile" class="fx col g1" style="padding:0 12px"></nav></aside>';
}

let wired = false;
async function mount(opts){
  opts = opts||{};
  state.onExit = opts.onExit || null;
  state.onNavigate = opts.onNavigate || null;   // Hub sincroniza a sanfona por aqui
  state.meuNome = opts.nome || state.meuNome;
  state.role = opts.role || 'broker';
  state.embedded = !!opts.embedded;   // embutido na área central do Hub (sanfona)
  state.view = opts.view || 'dashboard';
  // Reabrir a Locação começa limpo: sem filtros/seleções/pessoas da sessão anterior.
  Object.assign(state, { negFiltroTipo:'Todos', negFiltroStatus:'Todos', negCorretor:'Todos', negBusca:'', negView:'tabela', negVerArquivados:false, negVerCancelados:false, pessoasFiltro:'Todos', pessoasCorretor:'Todos', pessoasBusca:'', imoveisFiltro:'Todos', imoveisCorretor:'Todos', imoveisBusca:'', imoveisSort:'recente', mesFiltro:'todos', filaBusca:'', relCorretor:'Todos', currentDeal:null, dealTab:'timeline', cliFiltro:'Todos', cliBusca:'', agView:'mes', driveTipo:'Venda' });
  PEOPLE = [];
  const root = ROOT();
  if(!root){ console.warn('[broker] #bkRoot ausente'); return; }
  root.innerHTML = shellHTML();
  root.classList.toggle('bk-embedded', state.embedded);
  root.hidden = false;
  document.body.classList.add('bk-open');
  if(!wired){ wireEvents(root); wired = true; }
  navigate(state.view);
  refreshIcons();
  // Carrega dados reais e re-renderiza a view atual.
  const host = $('#root');
  try {
    if(host) host.innerHTML = '<div class="tcenter t500" style="padding:80px 0">'+icon('loader-2',30,'spin')+'<p style="margin-top:12px;color:var(--ondarkmuted)">Carregando a operação…</p></div>';
    refreshIcons();
    await carregarDados();
    carregarRoster();            // nomes/fotos dos corretores (não bloqueia)
    navigate(state.view);
    setupRealtime();             // liga o tempo real (imóveis/negócios ao vivo)
  } catch(e){
    if(host) host.innerHTML = '<div class="card" style="padding:24px;margin:24px"><div class="fz14 fw6 t900">Não consegui carregar a Locação</div><div class="fz13 t500" style="margin-top:6px">'+esc(e.message||e)+'</div></div>';
    refreshIcons();
  }
}
function unmount(){
  teardownRealtime();            // desliga os listeners (sai do Meus Negócios)
  const root = ROOT();
  if(root){ root.hidden = true; }
  document.body.classList.remove('bk-open');
  closeDrawer(); closeModal(); closeMobileNav();
}
async function carregarRoster(){
  try {
    const r = await fnRoster({});
    const users = (r.data)||[];
    users.forEach(u=>{ if(!CORRETORES[u.uid]) CORRETORES[u.uid]={id:u.uid,nome:u.nome,ini:ini(u.nome),cor:corDe(u.uid),foto:''}; else if(u.nome) CORRETORES[u.uid].nome=u.nome; });
    const uids = Object.keys(CORRETORES).slice(0,100);
    if(uids.length){ const f = await fnFotos({uids}); const fotos=(f.data&&f.data.fotos)||{}; Object.entries(fotos).forEach(([uid,foto])=>{ if(CORRETORES[uid]) CORRETORES[uid].foto=foto; }); }
    // NÃO re-navega em 'negocios': openDeal não muda state.view, então re-render
    // fecharia um detalhe aberto. A lista já mostra os nomes (vêm dos docs); o
    // roster só acrescenta fotos, que aparecem no próximo render natural.
    if(state.view==='dashboard'||state.view==='relatorios') navigate(state.view);
  } catch(e){ /* silencioso — nomes já vêm dos docs */ }
}

// ── Tempo real (padrão campainha) ────────────────────────────────────────────
// Escuta imóveis/negócios e, ao mudar, RE-BUSCA pela função segura (mantém a
// serialização/segurança) e re-renderiza a view atual — SEM atropelar drawer/modal
// aberto nem um negócio sendo lido (o usuário pode estar digitando comentário).
// Query casa com as regras: imóveis (gestor/adm=tudo, corretor=os seus); negócios
// (gestor=tudo, corretor=os seus; administrativo NÃO lê negócio cru → sem listener).
let _rtTimer = null;
// Seguro re-renderizar a tela agora? NÃO se a pessoa está no meio de algo — drawer/
// modal aberto, detalhe de negócio aberto, ou digitando num input/select (o texto
// sobrevive via state, mas foco e scroll se perderiam no meio da palavra).
function _podeRenavegar(){
  if(!ROOT() || ROOT().hidden) return false;
  const overlay = ($('#drawer') && $('#drawer').classList.contains('show'))
               || ($('#modal') && $('#modal').classList.contains('show'));
  const ae = document.activeElement;
  const digitando = ae && ROOT().contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  return !(overlay || state._viewingDeal || digitando);
}
function _rtOnChange(){
  clearTimeout(_rtTimer);
  _rtTimer = setTimeout(async () => {
    try {
      await carregarDados();
      // _feedSyncing: durante o sync manual do portal, não re-renderiza (soltaria o
      // botão "Buscando…" no meio); o próprio sync re-renderiza ao terminar.
      if(state._feedSyncing || !_podeRenavegar()) return;
      navigate(state.view);
    } catch(_e){ /* silencioso */ }
  }, 1500);
}
function setupRealtime(){
  teardownRealtime();
  if(!REALTIME) return;
  const uid = auth.currentUser && auth.currentUser.uid;
  if(!uid) return;
  const subs = [];
  try {
    let qImv = collection(db, 'imoveis');
    if(state.role === 'corretor') qImv = query(qImv, where('corretorUid', '==', uid));
    subs.push(onSnapshot(qImv, () => _rtOnChange(), e => console.warn('rt imoveis:', e && e.message)));
    if(state.role !== 'administrativo'){   // administrativo não tem read direto de negócios (regra)
      let qNeg = collection(db, 'negocios');
      if(state.role === 'corretor') qNeg = query(qNeg, where('corretorUid', '==', uid));
      subs.push(onSnapshot(qNeg, () => _rtOnChange(), e => console.warn('rt negocios:', e && e.message)));
    }
    // Fallback GARANTIDO via broadcast (config/broadcast é lido por TODOS): cobre o caso
    // do listener direto da coleção `imoveis` ser negado no `list` pro gestor e falhar
    // calado. Quando a carteira muda no servidor (sync do feed etc.), imovelSeq sobe e
    // recarregamos — assim o dashboard atualiza mesmo com o app aberto.
    let bcPrimeiro = true, bcImovel = 0, bcLead = 0;
    subs.push(onSnapshot(doc(db, 'config', 'broadcast'), snap => {
      const d = snap.exists() ? (snap.data() || {}) : {};
      const seq = d.imovelSeq || 0, leadSeq = d.leadSeq || 0;
      if(bcPrimeiro){ bcPrimeiro = false; bcImovel = seq; bcLead = leadSeq; return; }
      if(seq !== bcImovel){ bcImovel = seq; _rtOnChange(); }
      // Lead novo/alterado no C2S: só recarrega quem está REALMENTE na aba Leads
      // (senão todo Broker aberto puxava 500 leads por lead que entra — leitura à toa).
      // Quem entra na aba depois já carrega fresco pelo RENDERERS.leads.
      if(leadSeq !== bcLead){ bcLead = leadSeq; if(state.view==='leads') carregarLeads().then(()=>{ if(state.view==='leads') updateLeads(); }); }
    }, e => console.warn('rt broadcast:', e && e.message)));
  } catch(e){ console.warn('setupRealtime:', e && e.message); }
  state._rtUnsubs = subs;
}
function teardownRealtime(){
  clearTimeout(_rtTimer);
  _teardownDealRT();
  (state._rtUnsubs || []).forEach(u => { try { u(); } catch(_e){} });
  state._rtUnsubs = [];
}

window.Broker = { mount, unmount };

/* ============================================================================
   RENDERIZADORES (portados 1:1 do mockup, alimentados por dados reais)
   ============================================================================ */

/* ---------------- DASHBOARD (Central de Comando) ---------------- */
function blockH(t,sub,badge){ return '<div style="margin:28px 0 14px"><div class="fx ac g2"><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff;letter-spacing:-.01em">'+t+'</h2>'+(badge||'')+'</div>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div>'; }

RENDERERS.dashboard = function(host){
  const DEALS=dealsView(), PROPERTIES=propsView(), KPI=kpiDe(DEALS);   // escopo do mês selecionado
  const cnt=raw=>DEALS.filter(d=>d.statusRaw===raw).length;
  const analise=cnt('negocio_criado');
  const assin=DEALS.filter(d=>d.clicksign==='Enviado').length;
  const docum=cnt('aguardando_corretor')+cnt('aguardando_administrativo');
  const comis=cnt('concluido');
  const stale=DEALS.filter(d=>d.diasParado>7 && d.statusRaw!=='entregue_gestao' && d.statusRaw!=='concluido').length;
  const docsPend=DEALS.filter(d=>(d.checklist||[]).some(x=>x.obrigatoria&&!x.feito)).length;
  const hoje=DEALS.filter(d=>d.proxData==='Hoje').length;
  const vencidas=DEALS.filter(d=>d.diasParado>14 && d.statusRaw!=='entregue_gestao' && d.statusRaw!=='concluido').length;
  const nVendas=DEALS.filter(d=>d.tipo==='Venda').length, nLoc=DEALS.filter(d=>d.tipo==='Locação').length;
  const vgv=DEALS.filter(d=>d.tipo==='Venda').reduce((s,d)=>s+(d.valor||0),0);
  const ticket=nVendas?Math.round(vgv/nVendas):0;
  // Produção por corretor — REAL (agregado dos negócios).
  const uids=[...new Set(DEALS.map(d=>d.corretor).filter(Boolean))];
  const prod=uids.map(uid=>{ const ds=DEALS.filter(d=>d.corretor===uid); return {uid,nome:corrNome(uid),foto:corrFoto(uid),cor:(CORRETORES[uid]&&CORRETORES[uid].cor)||'#2563EB',vendas:ds.filter(d=>d.tipo==='Venda').length,loc:ds.filter(d=>d.tipo==='Locação').length,com:ds.reduce((s,d)=>s+(d.comValor||0),0),vgv:ds.filter(d=>d.tipo==='Venda').reduce((s,d)=>s+(d.valor||0),0)}; }).sort((a,b)=>b.com-a.com);
  const maxCom=Math.max(1,...prod.map(p=>p.com));

  // flt = status que o clique aplica na tela Negócios (como no mockup); 'Todos' = sem filtro.
  function ops(ico,variant,label,qty,prio,flt){ const pc={Alta:'danger','Média':'warning',Baixa:'neutral'}[prio];
    return '<button class="card card-hover" style="padding:16px;text-align:left" data-ops="'+esc(flt||'Todos')+'"><div class="fx as jb g2">'+iconChip(ico,variant,38)+'<span class="pill '+pc+'">'+prio+'</span></div><div style="margin-top:12px;font-size:26px;font-weight:700;letter-spacing:-.02em;color:var(--ink900)">'+qty+'</div><div class="fz13 fw5 t600" style="margin-top:2px">'+label+'</div></button>'; }
  function tile(label,valor,sub){ const mono=(typeof valor==='string'&&valor.indexOf('R$')===0)?'mono':'';
    return '<div class="card" style="padding:16px"><div class="fz12 fw5 t500">'+label+'</div><div class="'+mono+'" style="margin-top:6px;font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--ink900)">'+valor+'</div>'+(sub?'<div class="fz12 fw5 t400" style="margin-top:6px">'+sub+'</div>':'')+'</div>'; }

  const funil=[['Negócios ativos',KPI.ativos,'#2563EB'],['Em andamento',DEALS.filter(d=>['em_andamento','aguardando_corretor','aguardando_broker','aguardando_administrativo','negocio_criado'].includes(d.statusRaw)).length,'#7C3AED'],['Entregues',DEALS.filter(d=>d.statusRaw==='entregue_gestao').length,'#F59E0B'],['Concluídos',KPI.concluidos,'#16A34A']];
  const maxF=Math.max(1,...funil.map(f=>f[1]));
  const recPct=KPI.comissaoPrevista?Math.round(KPI.comissaoRecebida/KPI.comissaoPrevista*100):0;
  const primeiroNome=(state.meuNome||'Broker').split(' ')[0];

  host.innerHTML =
    '<div class="fx as jb wrap g3"><div><h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiroNome)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Central de comando da REMAX SMART — veja onde concentrar sua atenção hoje.</p></div><div class="nsh">'+mesSelect()+'</div></div>'
  + tarefasWidgetHTML(DEALS)
  + blockH('Centro de operações','O que precisa da sua atenção agora')
  + '<div class="grid4">'
    + ops('search-check','info','Aguardando análise',analise,'Média','Negócio criado')
    + ops('file-signature','warning','Aguardando assinatura',assin,'Alta','Todos')
    + ops('file-text','warning','Aguardando documentação',docum,'Média','Todos')
    + ops('hand-coins','danger','Aguardando comissão',comis,'Alta','Concluído')
    + ops('pause-circle','danger','Sem movimentação +7 dias',stale,'Alta','Todos')
    + ops('folder-clock','warning','Documentos pendentes',docsPend,'Média','Todos')
    + ops('calendar-check','info','Próximas ações hoje',hoje,'Alta','Todos')
    + ops('alert-triangle','danger','Pendências vencidas',vencidas,'Alta','Todos')
  + '</div>'
  + blockH('Performance da imobiliária','Números atuais da operação')
  + '<div class="grid4">'
    + tile('Captações',String(PROPERTIES.length),'imóveis na carteira')
    + tile('Vendas',String(nVendas),'negócios de venda')
    + tile('Locações',String(nLoc),'negócios de locação')
    + tile('VGV',brl(vgv),'valor de venda no pipeline')
    + tile('Ticket médio',ticket?brl(ticket):'—',nVendas?'por venda':'sem vendas ainda')
    + tile('Negócios ativos',String(KPI.ativos),'em andamento')
    + tile('Negócios encerrados',String(KPI.encerradosMes),'no período')
    + tile('Comissão prevista',brl(KPI.comissaoPrevista),'pipeline atual')
  + '</div>'
  + '<div class="grid3" style="margin-top:16px">'
    + '<div class="card" style="padding:20px"><div class="fz13 fw5 t500">Comissão</div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:var(--ink900)">'+brlFull(KPI.comissaoPrevista)+'</div><div class="fx" style="margin-top:12px;height:8px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="width:'+recPct+'%;background:var(--success)"></div><div style="width:'+(100-recPct)+'%;background:rgba(245,158,11,.7)"></div></div><div class="fx jb" style="margin-top:8px;font-size:12px"><span class="c-suc fw6">Recebida '+brl(KPI.comissaoRecebida)+'</span><span class="c-war fw6">Pendente '+brl(KPI.comissaoPendente)+'</span></div></div>'
    + '<div class="card" style="padding:20px"><div class="fz13 fw6 t800" style="margin-bottom:12px">Funil operacional</div>'+funil.map(f=>'<div style="margin-bottom:9px"><div class="fx jb fz12" style="margin-bottom:4px"><span class="t600 fw5">'+f[0]+'</span><span class="fw7 t900">'+f[1]+'</span></div><div style="height:9px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(f[1]/maxF*100)+'%;background:'+f[2]+'"></div></div></div>').join('')+'</div>'
    + '<div class="card" style="padding:20px"><div class="fz13 fw6 t800" style="margin-bottom:14px">Carteira por finalidade</div><div class="fx col g3">'+[['Venda',PROPERTIES.filter(p=>p.finalidadeRaw==='venda').length,'info','building-2'],['Locação',PROPERTIES.filter(p=>p.finalidadeRaw==='locacao').length,'ai','key-round'],['Venda e Locação',PROPERTIES.filter(p=>p.finalidadeRaw==='venda_locacao').length,'brand','layers']].map(r=>'<div class="fx ac jb"><span class="fx ac g2 fz13 t600">'+iconChip(r[3],r[2],30)+r[0]+'</span><span class="fz18 fw7 t900">'+r[1]+'</span></div>').join('')+'<div class="fx ac jb" style="padding-top:12px;border-top:1px solid var(--ink100)"><span class="fz13 fw6 t900">Total</span><span class="fz20 fw7" style="color:var(--brand)">'+PROPERTIES.length+'</span></div></div></div>'
  + '</div>'
  + blockH('Produção por corretor','Vendas, locações e comissão prevista por pessoa')
  + '<div class="card" style="padding:18px 20px">'+(prod.length?'<div class="fx col g4">'+prod.map(p=>'<div><div class="fx ac g3" style="margin-bottom:8px">'+avatar(p.nome,34,'var(--ink800)',p.foto)+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(p.nome)+'</div><div class="fz12 t500">'+p.vendas+' vendas · '+p.loc+' locações · VGV '+brl(p.vgv)+'</div></div><div class="mono fw7 t900 nsh">'+brlFull(p.com)+'</div></div><div style="height:10px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(p.com/maxCom*100)+'%;background:'+p.cor+'"></div></div></div>').join('')+'</div>':'<div class="tcenter t500 fz13" style="padding:24px">Nenhum negócio com corretor atribuído ainda.</div>')+'</div>';
};

/* ---------------- NEGÓCIOS ---------------- */
// Base da tela Negócios SEM o filtro de status — serve pros contadores das abas
// (cada aba conta quantos negócios têm aquele status dentro do escopo tipo+mês+busca).
function dealsBaseSemStatus(){
  const q=semAcento(state.negBusca).trim();
  // Fonte: view "Cancelados" puxa do DEALS_DOCS (cancelados não estão em DEALS);
  // senão, DEALS filtrando arquivados on/off.
  let arr;
  if(state.negVerCancelados){ arr=(DEALS_DOCS||[]).filter(d=>d.statusRaw==='cancelado'); }
  else { const verArq=!!state.negVerArquivados; arr=DEALS.filter(d=>!!d.arquivado===verArq); }
  return arr.filter(d=>{ if(!noMes(d.criadoEm))return false; if(state.negCorretor&&state.negCorretor!=='Todos'&&d.corretor!==state.negCorretor)return false; if(state.negFiltroTipo!=='Todos'&&d.tipo!==state.negFiltroTipo)return false; if(q){ const im=propDoDeal(d); const s=semAcento(d.code+' '+im.rua+' '+d.clienteNome+' '+corrNome(d.corretor)); if(s.indexOf(q)<0)return false; } return true; });
}
function nArquivados(){ return DEALS.filter(d=>d.arquivado).length; }
function nCancelados(){ return (DEALS_DOCS||[]).filter(d=>d.statusRaw==='cancelado').length; }
function filteredDeals(){ return dealsBaseSemStatus().filter(d=>state.negFiltroStatus==='Todos'||d.status===state.negFiltroStatus); }
// Quadro (kanban): SEM encerrados — concluído/cancelado não têm coluna (cairiam na
// primeira, sem poder arrastar, inflando o "Total comissões" dela pra sempre).
function dealsQuadro(){ return dealsBaseSemStatus().filter(d=>d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado'); }
function allStatusReais(){ return [...new Set(DEALS.map(d=>d.status))]; }
// Abas com contador (estilo Pipe Imob): Todos + cada status presente, com o total.
// Reusa state.negFiltroStatus (mesmo filtro do drill-down do dashboard) — clicar filtra na hora.
function negStatusChips(){
  const base=dealsBaseSemStatus();
  const counts={}; base.forEach(d=>{ counts[d.status]=(counts[d.status]||0)+1; });
  const chip=(val,label,n,active)=>'<button class="chip'+(active?' active':'')+'" data-action="negstatuschip" data-v="'+esc(val)+'">'+esc(label)+'<span style="margin-left:6px;opacity:.65;font-weight:700">'+n+'</span></button>';
  let html=chip('Todos','Todos',base.length,state.negFiltroStatus==='Todos');
  allStatusReais().forEach(s=>{ html+=chip(s,s,counts[s]||0,state.negFiltroStatus===s); });
  // Toggle "Arquivados" (só aparece se há algum arquivado, ou já está ligado) — separado à direita.
  const nArq=nArquivados();
  if(nArq>0 || state.negVerArquivados){
    html+='<button class="chip'+(state.negVerArquivados?' active':'')+'" data-action="negverarquivados" style="margin-left:6px" title="Negócios encerrados que foram arquivados">'+icon('archive',13)+'Arquivados<span style="margin-left:6px;opacity:.65;font-weight:700">'+nArq+'</span></button>';
  }
  const nCanc=nCancelados();
  if(nCanc>0 || state.negVerCancelados){
    html+='<button class="chip'+(state.negVerCancelados?' active':'')+'" data-action="negvercancelados" style="margin-left:6px" title="Negócios cancelados — com o motivo da perda">'+icon('x-circle',13)+'Cancelados<span style="margin-left:6px;opacity:.65;font-weight:700">'+nCanc+'</span></button>';
  }
  return html;
}
function corrNome(uid){ return CORRETORES[uid]?CORRETORES[uid].nome:'—'; }
function corrFoto(uid){ return CORRETORES[uid]?CORRETORES[uid].foto:''; }
// Semáforo de "dias parado" (verde ≤7, amarelo 8-14, vermelho >14) — coerente com as
// regras stale(>7)/vencida(>14) do dashboard. Negócio encerrado (concluído/cancelado)
// não envelhece → mostra "—".
function agingBadge(d){
  if(d.statusRaw==='concluido'||d.statusRaw==='cancelado') return '<span class="t400">—</span>';
  const n=d.diasParado||0;
  let bg,cor,bd;
  if(n<=7){ bg='rgba(16,185,129,.15)'; cor='#10b981'; bd='rgba(16,185,129,.35)'; }
  else if(n<=14){ bg='rgba(245,158,11,.15)'; cor='#f59e0b'; bd='rgba(245,158,11,.35)'; }
  else { bg='rgba(239,68,68,.15)'; cor='#ef4444'; bd='rgba(239,68,68,.35)'; }
  const txt=n===0?'hoje':(n===1?'1 dia':n+' dias');
  return '<span title="Dias desde a última movimentação" style="background:'+bg+';color:'+cor+';border:1px solid '+bd+';border-radius:999px;padding:2px 9px;font-weight:700;font-size:12px;white-space:nowrap">'+txt+'</span>';
}
// ── Etiquetas (tags) do negócio ──────────────────────────────────────────────
// Cor por matiz: palavras conhecidas ganham cor semântica (quente=vermelho,
// frio=azul…); as demais derivam um matiz estável do texto. Alpha via hsl 4-valores.
const TAG_HUE = { quente:0, morno:32, frio:214, urgente:0, prioridade:270, vip:270, alta:0, media:32, ['média']:32, baixa:150,
  // Etiquetas de etapa do negócio (presets novos)
  ['em andamento']:214, ['aguardando assinaturas']:270, ['pendência']:32, ['pendencia']:32, parado:0, ['contrato assinado']:150, ['processo finalizado']:150 };
function tagHue(t){ const k=String(t||'').toLowerCase().trim(); if(Object.prototype.hasOwnProperty.call(TAG_HUE,k)) return TAG_HUE[k]; let h=0; for(let i=0;i<t.length;i++) h=(h*31+t.charCodeAt(i))>>>0; return h%360; }
function tagChipHTML(t, removable){
  const H=tagHue(t), fg='hsl('+H+' 70% 64%)', bg='hsl('+H+' 70% 55% / .15)', bd='hsl('+H+' 70% 60% / .40)';
  const x = removable ? '<span data-action="tag-remove" data-tag="'+esc(t)+'" title="Remover" style="margin-left:6px;cursor:pointer;font-weight:800;opacity:.85">×</span>' : '';
  return '<span style="display:inline-flex;align-items:center;background:'+bg+';color:'+fg+';border:1px solid '+bd+';border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">'+esc(t)+x+'</span>';
}
const TAG_PRESETS = ['Em andamento','Aguardando assinaturas','Pendência','Parado','Contrato assinado','Processo finalizado'];
// Card "Etiquetas" no detalhe: chips atuais (removíveis) + presets + campo livre.
function dealTagsCardHTML(d){
  const tags=d.tags||[];
  const chips = tags.length ? tags.map(t=>tagChipHTML(t,true)).join(' ') : '<span class="fz13 t500">Sem etiquetas ainda.</span>';
  const cheio = tags.length>=6;
  const presets = TAG_PRESETS.filter(p=>!tags.some(t=>t.toLowerCase()===p.toLowerCase()))
    .map(p=>'<button class="btn btn-ghost sm" data-action="tag-preset" data-tag="'+esc(p)+'" '+(cheio?'disabled':'')+'>'+tagChipHTML(p,false)+'</button>').join('');
  const input = cheio ? ''
    : '<input id="bkTagInput" class="input nsh" maxlength="24" placeholder="+ etiqueta…" style="max-width:150px;height:30px;font-size:12px"><button class="btn btn-outline sm nsh" data-action="tag-add" style="height:30px;padding:0 10px">'+icon('plus',14)+'</button>';
  // Faixa compacta (uma linha), fica no topo do detalhe do negócio.
  return '<div class="card fx ac wrap g2" style="padding:10px 14px;margin-bottom:16px"><span class="up fz11 fw7 t800 nsh">Etiquetas</span>'+(tags.length?chips:'')+presets+input+'</div>';
}
function _curDealTags(){ const d=DEALS.find(x=>x.id===state.currentDeal)||(DEALS_DOCS||[]).find(x=>x.id===state.currentDeal); return d?(d.tags||[]).slice():[]; }
function _saveTags(tags){ negAtualizar({negocioId:state.currentDeal, acao:'tags', tags}); }
function _addTag(t){ t=String(t||'').trim().slice(0,24); if(!t) return; const cur=_curDealTags(); if(cur.some(x=>x.toLowerCase()===t.toLowerCase())){ toast('Etiqueta já existe','info'); return; } if(cur.length>=6){ toast('Máximo de 6 etiquetas','alert-triangle','var(--warning)'); return; } _saveTags(cur.concat([t])); }
// ── Tarefas do negócio (com prazo/lembrete) ──────────────────────────────────
function hojeISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function prazoStatus(p){ if(!p) return ''; const h=hojeISO(); if(p<h) return 'atrasada'; if(p===h) return 'hoje'; return 'futura'; }
function fmtPrazo(p){ if(!p) return ''; const a=p.split('-'); return a[2]+'/'+a[1]+'/'+a[0]; }
function tarefaBadge(d){ // pílula "⏰ N" no card se houver tarefa aberta pra hoje/atrasada
  const venc=(d.tarefas||[]).filter(t=>!t.feito && (prazoStatus(t.prazo)==='atrasada'||prazoStatus(t.prazo)==='hoje'));
  if(!venc.length) return '';
  const atrasada=venc.some(t=>prazoStatus(t.prazo)==='atrasada');
  const cor=atrasada?'#ef4444':'#f59e0b';
  return '<span title="Tarefas para hoje ou atrasadas" style="display:inline-flex;align-items:center;gap:3px;background:'+cor+'22;color:'+cor+';border:1px solid '+cor+'55;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700;white-space:nowrap">⏰ '+venc.length+'</span>';
}
// Tarefas abertas pra hoje/atrasadas em TODOS os negócios (alerta do Dashboard).
function tarefasDoDia(deals){
  const out=[];
  (deals||[]).forEach(d=>{ (d.tarefas||[]).forEach(t=>{ if(t.feito) return; const s=prazoStatus(t.prazo); if(s==='atrasada'||s==='hoje') out.push({texto:t.texto, prazo:t.prazo, s, dealId:d.id, code:d.code, rua:propDoDeal(d).rua}); }); });
  out.sort((a,b)=>(a.prazo||'')<(b.prazo||'')?-1:1);
  return out;
}
function tarefasWidgetHTML(deals){
  const ts=tarefasDoDia(deals); if(!ts.length) return '';
  const rows=ts.slice(0,8).map(t=>'<button class="fx ac g3 hoverbg" data-deal="'+t.dealId+'" style="width:100%;text-align:left;background:none;border:none;padding:11px 12px;border-radius:10px;cursor:pointer">'+iconChip('alarm-clock',t.s==='atrasada'?'danger':'warning',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(t.texto)+'</div><div class="fz12 t500 trunc">'+esc(t.code)+' · '+esc(t.rua)+'</div></div><span class="fz12 fw6 nsh" style="color:'+(t.s==='atrasada'?'#ef4444':'#f59e0b')+'">'+(t.s==='atrasada'?'Atrasada':'Hoje')+'</span></button>').join('');
  return '<div class="card" style="overflow:hidden;margin:16px 0">'+cardHead('⏰ Tarefas para hoje / atrasadas','')+'<div style="padding:8px">'+rows+(ts.length>8?'<div class="fz12 t500 tcenter" style="padding:6px">+'+(ts.length-8)+' outras</div>':'')+'</div></div>';
}
function negRows(){
  const list=filteredDeals();
  const meu=state.role==='corretor';   // corretor: sem coluna Corretor, comissão = repasse por corretor (45%/40%)
  if(!list.length) return '<tr><td colspan="'+(meu?7:8)+'"><div class="tcenter t500" style="padding:44px 0"><div class="t400">'+icon('search-x',26)+'</div><p style="margin-top:10px" class="fz14 fw5">Nenhum negócio encontrado para este filtro.</p></div></td></tr>';
  return list.map(d=>{ const im=propDoDeal(d); return '<tr data-deal="'+d.id+'"><td class="mono fz13 t900 fw6">'+esc(d.code)+'</td><td><div class="fw6 t900">'+esc(im.rua)+'</div><div class="fz12 t500">'+esc(im.bairro||d.cidade)+'</div>'+(d.tags&&d.tags.length?'<div class="fx wrap g1" style="margin-top:5px">'+d.tags.map(t=>tagChipHTML(t,false)).join('')+'</div>':'')+'</td><td><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'">'+d.tipo+'</span></td><td class="t700">'+esc(d.clienteNome)+'</td>'+(meu?'':'<td><div class="fx ac g2">'+avatar(corrNome(d.corretor),24,'var(--ink800)',corrFoto(d.corretor))+'<span class="fz13 t700">'+esc(corrNome(d.corretor))+'</span></div></td>')+'<td>'+statusPill(d.status)+'</td><td class="tcenter"><div class="fx ac jc g1 wrap">'+agingBadge(d)+tarefaBadge(d)+'</div></td><td class="tright mono fw6 t900">'+brl(meu?repasse(d):d.comValor)+'</td></tr>'; }).join('');
}
function updateNegTable(){
  // Quadro: re-renderiza SÓ o board (não a página — preserva o foco do input de busca).
  const kw=$('#kanbanWrap'); if(kw){ kw.innerHTML=kanbanHTML(); refreshIcons(); const ck=$('#negCountK'); if(ck) ck.textContent=dealsQuadro().length; return; }
  const tb=$('#negTbody'); if(tb){ tb.innerHTML=negRows(); } const ch=$('#negChips'); if(ch){ ch.innerHTML=negStatusChips(); } refreshIcons(); const c=$('#negCount'); if(c) c.textContent=filteredDeals().length;
}
// ── Kanban (Modelo 2 — colunas customizáveis) ───────────────────────────────
// As colunas vêm da config (kanbanCols()); cada negócio tem colunaId separado do
// status. Arrastar move a COLUNA (negocioMoverColuna), não o status.
const KANBAN_CSS ='.kboard{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}'
  + '.kcol{flex:1 1 230px;min-width:230px;background:var(--ink50);border:1px solid var(--ink200);border-radius:12px;display:flex;flex-direction:column;max-height:68vh}'
  + '.kcol-head{padding:11px 13px;font-size:12px;font-weight:800;color:var(--ink700);text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ink200)}'
  + '.kcol-body{padding:9px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1;min-height:70px}'
  + '.kcol-over{outline:2px dashed var(--brand);outline-offset:-3px;background:rgba(37,99,235,.06)}'
  + '.kcard{background:#fff;border:1px solid var(--ink200);border-radius:10px;padding:10px 11px;box-shadow:0 1px 2px rgba(0,0,0,.04)}'
  + '.kcard[draggable="true"]{cursor:grab}.kcard[draggable="true"]:active{cursor:grabbing}.kdragging{opacity:.45}';
// Rótulo curto do "comissão recebida" (venda tem parcelas; locação é sim/não).
const _CR_LABEL={ sim:'Sim', nao:'Não', parcela1:'1ª parcela', parcela2:'2ª parcela', total:'Total' };
function _snLabel(v){ return v==='sim'?'Sim':v==='nao'?'Não':''; }
// Linhas de visualização rápida do card (pedido Marcelo): campos personalizados +
// data de início da proposta. Só mostra o que está preenchido.
function kanbanCardInfo(d){
  const c=d.campos||{}, p=d.proposta||{};
  const linhas=[];
  if(d.tipo==='Locação' && c.administracao) linhas.push(['Administração', _snLabel(c.administracao)]);
  if(c.parceria) linhas.push(['Parceria', _snLabel(c.parceria)]);
  if(c.comissaoRecebida) linhas.push(['Comissão recebida', _CR_LABEL[c.comissaoRecebida]||c.comissaoRecebida]);
  if(p.inicio){ const m=String(p.inicio).match(/^(\d{4})-(\d{2})-(\d{2})$/); linhas.push(['Início do contrato', m?(m[3]+'/'+m[2]+'/'+m[1]):p.inicio]); }  // ISO→dd/mm/aaaa
  if(!linhas.length) return '';
  return '<div style="margin-top:8px;padding-top:7px;border-top:1px dashed var(--ink200)">'
    + linhas.map(l=>'<div class="fx ac jb fz11" style="padding:1px 0"><span class="t500">'+esc(l[0])+'</span><span class="fw7 t900">'+esc(l[1])+'</span></div>').join('')+'</div>';
}
function kanbanCard(d, podeArrastar){
  const im=propDoDeal(d);
  const arrast = podeArrastar && d.statusRaw!=='concluido' && d.statusRaw!=='cancelado';
  const tags = (d.tags&&d.tags.length) ? '<div class="fx wrap g1" style="margin-top:7px">'+d.tags.map(t=>tagChipHTML(t,false)).join('')+'</div>' : '';
  // Botão "mover" (só broker): fallback do drag pro TOUCH — no celular o HTML5 drag
  // não dispara, então sem ele não dava pra mover card nenhum. data-action é captado
  // antes do data-deal, então não abre o negócio ao tocar.
  const btnMover = arrast ? '<button class="nsh" data-action="kmove-open" data-deal="'+d.id+'" title="Mover de coluna" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ink200);border-radius:8px;background:#fff;cursor:pointer;color:var(--ink500);flex:none">'+icon('arrow-left-right',15)+'</button>' : '';
  return '<div class="kcard" data-deal="'+d.id+'" data-kcard="'+d.id+'" draggable="'+(arrast?'true':'false')+'">'
    + '<div class="fx ac jb g2"><span class="mono fz12 fw7 t900">'+esc(d.code)+'</span><span class="fx ac g1">'+'<span class="pill '+(d.tipo==='Venda'?'info':'ai')+'" style="font-size:10px">'+d.tipo+'</span>'+btnMover+'</span></div>'
    + '<div class="fz13 fw6 t900 trunc" style="margin-top:6px">'+esc(im.rua)+'</div>'
    + '<div class="fz12 t500 trunc">'+esc(d.clienteNome)+'</div>'
    + '<div class="fx ac jb g2" style="margin-top:8px"><span class="mono fw6 t900 fz13">'+brl(d.valor)+'</span><span class="fx ac g1">'+agingBadge(d)+tarefaBadge(d)+'</span></div>'
    + '<div class="fz11 fw6 c-suc" style="margin-top:3px">Comissão '+brlFull(d.comValor)+'</div>'
    + kanbanCardInfo(d)
    + tags + '</div>';
}
function kanbanHTML(){
  // carrega a config das colunas 1x (async) e re-renderiza o board quando chegar
  if(!state.kanbanCols && !state._kanbanLoading){ state._kanbanLoading=true; carregarKanbanCols().then(()=>{ state._kanbanLoading=false; const kw=$('#kanbanWrap'); if(kw){ kw.innerHTML=kanbanHTML(); refreshIcons(); } }); }
  const cols=kanbanCols();
  const base=dealsQuadro();
  const by={}; cols.forEach(c=>by[c.id]=[]);
  base.forEach(d=>{ const cid=colunaDoDeal(d,cols); (by[cid]=by[cid]||[]).push(d); });
  const podeArrastar = state.role==='broker';
  const colHTML = cols.map(c=>{
    const cards=(by[c.id]||[]);
    const body = cards.length ? cards.map(d=>kanbanCard(d,podeArrastar)).join('') : '<div class="fz12 t400" style="padding:12px;text-align:center">—</div>';
    const dropAttr = podeArrastar ? ' data-kdrop="'+esc(c.id)+'"' : '';
    const total = cards.reduce((s,d)=>s+(d.comValor||0),0);
    const totalHTML = cards.length ? '<div class="fx ac jb" style="padding:2px 14px 10px"><span class="fz12 fw6 t500">Total comissões</span><span class="mono fw7 c-suc" style="font-size:15px">'+brlFull(total)+'</span></div>' : '';
    return '<div class="kcol"><div class="kcol-head"><span class="trunc">'+esc(c.label)+'</span><span class="pill neutral">'+cards.length+'</span></div>'+totalHTML+'<div class="kcol-body"'+dropAttr+'>'+body+'</div></div>';
  }).join('');
  const manage = podeArrastar ? '<button class="btn btn-outline sm" data-action="kanban-gerenciar" style="margin-bottom:10px">'+icon('settings-2',14)+'Gerenciar colunas</button>' : '';
  const hint = podeArrastar
    ? 'Arraste os cards entre as colunas pra organizar o quadro. As etapas, relatórios e permissões seguem pelo status do negócio (independente das colunas).'
    : 'Somente o broker move os cards.';
  return '<style>'+KANBAN_CSS+'</style>'+manage+'<div class="kboard">'+colHTML+'</div><div class="fz12 t500" style="margin-top:10px">'+hint+'</div>';
}
// Espelha um negócio atualizado nos DOIS caches (DEALS e DEALS_DOCS) — sem isso o
// chip "Cancelados"/tela Documentos ficava stale até o próximo carregarDados.
function _syncDealCache(mapped){
  const i=DEALS.findIndex(x=>x.id===mapped.id);
  if(mapped.statusRaw==='cancelado'){ if(i>=0) DEALS.splice(i,1); }
  else if(i>=0) DEALS[i]=mapped; else DEALS.push(mapped);
  const j=(DEALS_DOCS||[]).findIndex(x=>x.id===mapped.id);
  if(j>=0) DEALS_DOCS[j]=mapped; else (DEALS_DOCS||[]).push(mapped);
}
// Re-renderiza a tela Negócios SÓ se o usuário ainda está nela (lista, não detalhe) —
// resposta atrasada não pode pintar a lista por cima de outra view.
function _rerenderNegocios(){ if(state.view==='negocios' && !state._viewingDeal){ RENDERERS.negocios($('#root')); refreshIcons(); } }
// Modelo 2: mover = trocar a COLUNA do quadro (colunaId), sem mexer no status.
async function kanbanMove(id, colunaId){
  const d=DEALS.find(x=>x.id===id); if(!d) return;
  const cols=kanbanCols(); if(colunaDoDeal(d,cols)===colunaId) return;
  const prev=d.colunaId; d.colunaId=colunaId;   // otimista
  const kw=$('#kanbanWrap'); if(kw){ kw.innerHTML=kanbanHTML(); refreshIcons(); }
  try {
    await fnMoverColuna({negocioId:id, colunaId});
    const dd=(DEALS_DOCS||[]).find(x=>x.id===id); if(dd) dd.colunaId=colunaId;
    const c=(cols.find(x=>x.id===colunaId)||{}); toast('Movido para '+(c.label||colunaId),'check');
  } catch(err){
    d.colunaId=prev; const kw2=$('#kanbanWrap'); if(kw2){ kw2.innerHTML=kanbanHTML(); refreshIcons(); }
    toast(err.message||'Não foi possível mover','alert-triangle','var(--danger)');
  }
}
// Seletor de coluna (fallback do arrastar pro touch): lista as colunas e move ao tocar.
function openKanbanMovePicker(dealId){
  const d=DEALS.find(x=>x.id===dealId); if(!d) return;
  const cols=kanbanCols(); const cur=colunaDoDeal(d,cols);
  openModal('<div style="padding:20px;max-width:340px"><div class="fz15 fw7 t900" style="margin-bottom:4px">Mover card</div><div class="fz12 t500" style="margin-bottom:14px">'+esc(d.code)+' — escolha a coluna</div>'
    + cols.map(c=>'<button class="fx ac jb hoverbg" data-action="kmove-to" data-deal="'+esc(dealId)+'" data-col="'+esc(c.id)+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:13px 14px;cursor:pointer;margin-bottom:8px"><span class="fz14 fw6 t900">'+esc(c.label)+'</span>'+(c.id===cur?'<span class="pill neutral">atual</span>':'')+'</button>').join('')
    + '<button class="btn btn-outline sm" data-action="close-modal" style="width:100%;margin-top:4px">Cancelar</button></div>');
}
// ── Gerenciar colunas do quadro (Modelo 2) ───────────────────────────────────
function _colCaptura(){ (state._colEdit||[]).forEach((c,i)=>{ const inp=document.querySelector('[data-colinput="'+i+'"]'); if(inp) c.label=inp.value; }); }
function openKanbanGerenciar(){ state._colEdit=kanbanCols().map(c=>({id:c.id,label:c.label})); renderKanbanGerenciar(); }
function renderKanbanGerenciar(){
  const cols=state._colEdit||[];
  const rows=cols.map((c,i)=>'<div class="fx ac g2" style="margin-bottom:8px">'
    +'<input class="input grow" data-colinput="'+i+'" value="'+esc(c.label)+'" maxlength="40" placeholder="Nome da coluna">'
    +'<button class="btn btn-ghost sm nsh" data-action="col-up" data-i="'+i+'"'+(i===0?' disabled':'')+' title="Subir">'+icon('chevron-up',15)+'</button>'
    +'<button class="btn btn-ghost sm nsh" data-action="col-down" data-i="'+i+'"'+(i===cols.length-1?' disabled':'')+' title="Descer">'+icon('chevron-down',15)+'</button>'
    +'<button class="btn btn-ghost sm nsh" data-action="col-rm" data-i="'+i+'" style="color:var(--danger)" title="Remover">'+icon('trash-2',15)+'</button>'
    +'</div>').join('');
  openModal('<div style="padding:20px;min-width:380px;max-width:460px"><div class="fz15 fw7 t900" style="margin-bottom:4px">Colunas do quadro</div><div class="fz12 t500" style="margin-bottom:14px">Renomeie, reordene (↑↓), adicione ou remova. Cards de uma coluna removida voltam pra primeira.</div>'
    +'<div id="colEditList">'+rows+'</div>'
    +'<button class="btn btn-outline sm" data-action="col-add" style="width:100%;margin-top:6px">'+icon('plus',15)+'Adicionar coluna</button>'
    +'<div class="fx g2" style="margin-top:16px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="col-salvar">'+icon('check',15)+'Salvar</button></div></div>');
}
function _colGenId(){ return 'c'+Math.random().toString(36).slice(2,8); }
async function salvarKanbanColunas(){
  _colCaptura();
  const cols=(state._colEdit||[]).filter(c=>(c.label||'').trim());
  if(!cols.length){ toast('Deixe ao menos uma coluna com nome','alert-triangle','var(--warning)'); return; }
  try{
    const r=await fnKanbanSalvar({colunas:cols});
    state.kanbanCols=(r.data&&r.data.colunas)||cols;
    closeModal(); toast('Colunas salvas','check','var(--success)');
    const kw=$('#kanbanWrap'); if(kw){ kw.innerHTML=kanbanHTML(); refreshIcons(); }
  }catch(e){ toast(e.message||'Erro ao salvar','alert-triangle','var(--danger)'); }
}

RENDERERS.negocios = function(host){
  const tipos=['Todos','Venda','Locação'];
  const isKanban = state.negView==='kanban';
  const toggle = '<div class="fx ac g1">'
    + '<button class="chip'+(!isKanban?' active':'')+'" data-action="negview" data-v="tabela" title="Tabela">'+icon('table',14)+'Tabela</button>'
    + '<button class="chip'+(isKanban?' active':'')+'" data-action="negview" data-v="kanban" title="Quadro (arraste os cards)">'+icon('layout-grid',14)+'Quadro</button>'
  + '</div>';
  const tabela = '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:'+(state.role==='corretor'?'800':'900')+'px"><thead><tr><th>Código</th><th>Imóvel</th><th>Tipo</th><th>Cliente</th>'+(state.role==='corretor'?'':'<th>Corretor</th>')+'<th>Status</th><th class="tcenter" title="Dias desde a última movimentação">Parado</th><th class="tright">'+(state.role==='corretor'?'Minha comissão':'Comissão')+'</th></tr></thead><tbody id="negTbody">'+negRows()+'</tbody></table></div></div>';
  host.innerHTML = pageHead(hTitulo('Negócios'),'Em que etapa está cada negociação? Acompanhe todos os negócios da imobiliária.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:14px">'
    + '<div class="fx ac g2 wrap">'+tipos.map(t=>'<button class="chip'+(state.negFiltroTipo===t?' active':'')+'" data-action="negtipo" data-v="'+t+'">'+t+'</button>').join('')+'</div>'
    + '<div class="fx ac g2">'
      + toggle
      + '<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(300px,60vw)">'+icon('search',16,'tmut')+'<input data-input="negBusca" value="'+esc(state.negBusca||'')+'" placeholder="Buscar negócio, imóvel, cliente…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>'
      + (state.role==='broker'?corrSelectFrom('negcorr',state.negCorretor,DEALS.concat(DEALS_DOCS||[]).map(d=>[d.corretor,corrNome(d.corretor)])):'')
      + mesSelect()
    + '</div>'
  + '</div>'
  + (isKanban ? '' : '<div class="fx ac g2 wrap" id="negChips" style="margin-bottom:14px">'+negStatusChips()+'</div>')
  + '<div class="fz13 tmut" style="margin-bottom:12px">'+(isKanban
      ? ('<strong class="tw" id="negCountK">'+dealsQuadro().length+'</strong> negócios no quadro · '+(state.negFiltroTipo))
      : ('<strong class="tw" id="negCount">'+filteredDeals().length+'</strong> negócios · '+(state.negFiltroTipo)+(state.negFiltroStatus!=='Todos'?' · '+state.negFiltroStatus:'')))+'</div>'
  + (isKanban ? '<div id="kanbanWrap">'+kanbanHTML()+'</div>' : tabela)
  + '<div class="fx ac g3 wrap fz12 t500" style="margin-top:12px"><span class="fw6 t700">Parado:</span><span class="fx ac g1"><span style="width:10px;height:10px;border-radius:50%;background:#10b981;display:inline-block"></span>até 7 dias</span><span class="fx ac g1"><span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;display:inline-block"></span>8 a 14 dias</span><span class="fx ac g1"><span style="width:10px;height:10px;border-radius:50%;background:#ef4444;display:inline-block"></span>mais de 14 dias</span></div>';
};

function renderStepper(d){
  const cl=d.checklist||[]; if(!cl.length) return '<div class="fz13 t500">Sem checklist neste negócio.</div>';
  // Mostra TODAS as etapas OBRIGATÓRIAS (as que travam o Concluir) — não só as 6 primeiras —
  // e usa o estado REAL de cada uma (não a contagem), pra marcar certo mesmo fora de ordem.
  const stages=cl.filter(x=>x.obrigatoria); if(!stages.length) return '';
  const nextIdx=stages.findIndex(x=>!x.feito); // 1ª obrigatória pendente = "em andamento"
  return '<div class="fx" style="overflow-x:auto">'+stages.map((s,i)=>{ const done=!!s.feito, now=!done&&i===nextIdx; const bg=done?'var(--success)':now?'var(--brand)':'#fff'; const bd=done||now?'transparent':'2px solid var(--ink300)'; const col=done||now?'#fff':'var(--ink400)'; const lineL=i===0?'transparent':(stages[i-1].feito?'var(--success)':'var(--ink200)'); const lineR=i===stages.length-1?'transparent':(done?'var(--success)':'var(--ink200)'); const cap=done?'Concluído':now?'Em andamento':'Pendente'; const capc=done?'c-suc':now?'c-inf':'t400';
    return '<div class="fx col ac g2" style="flex:1;min-width:80px"><div class="fx ac" style="width:100%"><span style="flex:1;height:2px;background:'+lineL+'"></span><span class="ifx ac jc nsh" style="width:32px;height:32px;border-radius:50%;background:'+bg+';border:'+(bd==='transparent'?'none':bd)+';color:'+col+';font-size:12px;font-weight:700'+(now?';box-shadow:0 0 0 4px rgba(37,99,235,.18)':'')+'">'+(done?icon('check',16):(i+1))+'</span><span style="flex:1;height:2px;background:'+lineR+'"></span></div><div class="tcenter"><div class="fz12 fw6 '+(done||now?'t900':'t500')+'">'+esc((s.label||'').split(' ').slice(0,2).join(' '))+'</div><div class="fz11 '+capc+'" style="margin-top:1px">'+cap+'</div></div></div>'; }).join('')+'</div>';
}

// Um balão de comentário. `isReply` = está aninhado sob outro (não mostra "Responder"
// pra evitar thread profunda). "Editar" só aparece pra quem escreveu (c.porUid).
function comentBubbleHTML(c, isReply){
  const meu=(auth.currentUser&&auth.currentUser.uid)||'';
  const podeEditar=c.id&&c.porUid===meu;
  const podeResp=c.id&&!isReply;
  const editado=c.editadoEm?' · <span class="fz11 t400">editado</span>':'';
  const acoes=(podeEditar||podeResp)?'<div class="fx g1" style="margin-top:4px">'
    +(podeResp?'<button class="btn btn-ghost sm" data-action="coment-responder" data-id="'+esc(c.id)+'" data-nome="'+esc(c.porNome)+'">'+icon('reply',13)+'Responder</button>':'')
    +(podeEditar?'<button class="btn btn-ghost sm" data-action="coment-editar" data-id="'+esc(c.id)+'" data-texto="'+esc(c.texto)+'">'+icon('pencil',13)+'Editar</button>':'')
    +'</div>':'';
  return '<div class="fx g2" style="padding:12px 0;border-top:1px solid var(--ink100)">'+avatar(c.porNome,34,'var(--ink800)')+'<div class="grow"><div class="fx ac g2"><span class="fz13 fw6 t900">'+esc(c.porNome)+'</span><span class="fz11 t400">'+relData(c.em)+editado+'</span></div><div class="fz13 t700" style="margin-top:2px;white-space:pre-wrap">'+esc(c.texto)+'</div>'+acoes+'</div></div>';
}
// Lista de comentários com respostas aninhadas (thread de 1 nível). Topos do mais
// novo pro mais antigo; respostas em ordem cronológica sob o pai.
function comentListHTML(cs){
  const filhos={}; cs.forEach(c=>{ if(c.respostaDe){ (filhos[c.respostaDe]=filhos[c.respostaDe]||[]).push(c); } });
  return cs.filter(c=>!c.respostaDe).slice().reverse().map(c=>{
    const reps=filhos[c.id]||[];
    return comentBubbleHTML(c,false)+(reps.length?'<div style="margin-left:38px;border-left:2px solid var(--ink100);padding-left:10px">'+reps.map(r=>comentBubbleHTML(r,true)).join('')+'</div>':'');
  }).join('');
}
// Desliga o listener de tempo real do negócio aberto (comentários ao vivo).
function _teardownDealRT(){ if(state._dealUnsub){ try{ state._dealUnsub(); }catch(_e){} state._dealUnsub=null; } }

// Card "Documentos deste negócio" no detalhe (anexo rápido). Reusa negocioAnexarDoc:
// gestor/adm/corretor responsável anexam; gestor/adm removem qualquer doc, o corretor
// só remove o que ELE mesmo subiu (o backend também garante isso).
const DOC_CAT_LABEL = { contrato:'Contrato', proposta:'Proposta', cliente:'Doc. do cliente', outro:'Outro' };
function dealDocsCardHTML(d, podeSubir){
  const docs = (d.raw && d.raw.documentos) || [];
  const encerrado = d.statusRaw==='concluido' || d.statusRaw==='cancelado';
  const addBtn = (podeSubir && !encerrado) ? '<button class="btn btn-outline sm nsh" data-action="deal-doc-add">'+icon('upload',15)+'Anexar</button>' : '';
  const gestorAdm = (state.role==='broker'||state.role==='administrativo');
  const meuUid = (auth.currentUser&&auth.currentUser.uid)||'';
  // Rótulo da subpasta do Drive deste doc (doc antigo sem driveDestino não mostra nada).
  const _destLabel=(k)=>{ const v=d.tipo==='Venda'; return ({vendedor:v?'Vendedor':'Locador', comprador:v?'Comprador':'Locatário', imovel:'Imóvel', outros:'Outros'})[k]||''; };
  const rows = docs.length ? docs.map(x=>{
    const dl=_destLabel(x.driveDestino);
    const meta=[DOC_CAT_LABEL[x.categoria]||'', dl?('Drive: '+dl):'', docFmtTam(x.tamanho), relData(x.em)].filter(Boolean).join(' · ');
    const baixar='<a class="btn btn-outline sm nsh" href="'+esc(x.url||'')+'" target="_blank" rel="noopener" style="text-decoration:none" title="Baixar">'+icon('download',15)+'</a>';
    const podeRem = !encerrado && (gestorAdm || x.porUid===meuUid);
    const rem = podeRem ? '<button class="btn btn-ghost sm nsh" data-action="doc-remover" data-deal="'+esc(d.id)+'" data-doc="'+esc(x.id)+'" data-nome="'+esc(x.nome||'')+'" title="Remover" style="color:#dc2626">'+icon('trash-2',15)+'</button>' : '';
    return '<div class="fx ac g3" style="padding:11px 0;border-top:1px solid var(--ink100)">'+iconChip(x.mime==='application/pdf'?'file-text':'image','info',34)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(x.nome||'documento')+'</div><div class="fz12 t500 trunc">'+esc(meta)+'</div></div><div class="fx ac g1 nsh">'+baixar+rem+'</div></div>';
  }).join('') : '<div class="fz13 t500" style="padding:12px 0 4px">Nenhum documento anexado a este negócio.</div>';
  return '<div class="card" style="padding:18px;margin-bottom:16px"><div class="fx ac jb g2"><span class="up fz12 fw7 t800">Documentos deste negócio</span>'+addBtn+'</div>'+rows+'</div>';
}

// Card de assinatura eletrônica (ClickSign) no detalhe do negócio. Enviar/reenviar/
// cancelar são de gestor/administrativo; corretor vê o status. O documento assinado
// é UM dos anexos do negócio (card Documentos acima); quando o envelope fecha, o
// checklist (contrato/compromisso assinado) é marcado sozinho pelo webhook.
function clicksignCardHTML(d){
  const cs = d.clicksignEnv;
  const encerrado = d.statusRaw==='concluido' || d.statusRaw==='cancelado';
  const gestorAdm = (state.role==='broker'||state.role==='administrativo');
  const head = '<div class="fx ac g2"><span class="ifx ac jc nsh" style="width:34px;height:34px;border-radius:9px;background:var(--ink100)">'+icon('file-signature',18,'info')+'</span><div><div class="up fz12 fw7 t800">Assinatura eletrônica</div><div class="fz11 t500">ClickSign</div></div></div>';
  const ativo = cs && cs.status==='running';
  const fechado = cs && cs.status==='closed';
  let corpo='', acoes='';
  if(ativo || fechado){
    const sigs=(cs.signatarios||[]).map(s=>'<div class="fx ac g2" style="padding:8px 0;border-top:1px solid var(--ink100)"><span class="ifx ac jc nsh" style="width:22px;height:22px;border-radius:50%;background:'+(s.assinou?'var(--success)':'#fff')+';border:'+(s.assinou?'none':'2px solid var(--ink300)')+';color:#fff">'+(s.assinou?icon('check',13):icon('clock',13,'t400'))+'</span><div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(s.nome)+'</div><div class="fz12 t500 trunc">'+esc(s.email)+'</div></div><span class="fz12 nsh '+(s.assinou?'c-suc fw6':'t500')+'">'+(s.assinou?'Assinou':'Pendente')+'</span></div>').join('');
    const selo = fechado ? '<span class="pill success">Assinado por todos ✓</span>' : '<span class="pill ai">Aguardando assinaturas</span>';
    corpo='<div class="fx ac jb g2 wrap" style="margin-top:12px"><div class="fz13 t700 trunc">'+icon('file-text',14,'t400')+' '+esc(cs.documentoNome||'documento')+'</div>'+selo+'</div><div style="margin-top:6px">'+sigs+'</div>';
    if(gestorAdm && ativo && !encerrado){
      acoes='<div class="fx g2 wrap" style="margin-top:14px"><button class="btn btn-outline sm" data-action="clk-reenviar">'+icon('mail',15)+'Reenviar lembrete</button><button class="btn btn-outline sm" data-action="clk-cancelar" style="color:var(--danger);border-color:var(--danger)">'+icon('x',15)+'Cancelar assinatura</button></div>';
    }
  } else {
    const cancel = cs && cs.status==='canceled';
    const expirou = cs && cs.status==='deadline';
    const aviso = cancel ? '<div class="fz12 t500" style="margin-top:8px">O envelope anterior foi cancelado.</div>' : (expirou?'<div class="fz12 t500" style="margin-top:8px">O prazo do envelope anterior expirou.</div>':'');
    corpo='<div class="fz13 t500" style="margin-top:12px">Envie um documento anexado deste negócio para assinatura. Os signatários recebem por e-mail; quando todos assinam, a etapa do checklist é marcada sozinha.</div>'+aviso;
    if(gestorAdm && !encerrado){
      acoes='<div style="margin-top:14px"><button class="btn btn-primary sm" data-action="clk-enviar">'+icon('send',15)+'Enviar para assinatura</button></div>';
    } else if(!gestorAdm){
      acoes='<div class="fz12 t500" style="margin-top:12px">Só o gestor ou o administrativo envia para assinatura.</div>';
    }
  }
  return '<div class="card" style="padding:18px;margin-bottom:16px">'+head+corpo+acoes+'</div>';
}

// Uma linha de signatário no modal de envio (nome + e-mail + CPF opcional).
function _clkSigRow(){
  return '<div class="fx g2 wrap clk-sig-row" style="margin-bottom:10px;align-items:center"><input class="input clk-nome" maxlength="120" placeholder="Nome completo (nome e sobrenome)" style="flex:1;min-width:150px"><input class="input clk-email" maxlength="160" placeholder="E-mail" inputmode="email" style="flex:1;min-width:150px"><input class="input clk-cpf nsh" maxlength="14" placeholder="CPF (opcional)" style="width:130px"><button class="btn btn-ghost sm nsh" data-action="clk-sig-rm" title="Remover signatário" style="color:#dc2626">'+icon('x',15)+'</button></div>';
}

// Modal "Enviar para assinatura": escolhe um documento anexado + digita os signatários.
function clkEnviarModal(d){
  const todos = (d.raw && d.raw.documentos) || [];
  // Só documentos assináveis: PDF ou Word (foto de RG etc. não vai pra assinatura).
  const docs = todos.filter(x=>x && (x.mime==='application/pdf' || /wordprocessingml|msword/.test(x.mime||'')));
  if(!docs.length){
    const temAlgum = todos.length>0;
    openModal('<div style="padding:20px;max-width:520px;max-height:80vh;overflow-y:auto"><div class="fz16 fw7 t900" style="margin-bottom:6px">Enviar para assinatura</div><div class="fz13 t500" style="margin-bottom:16px">'+(temAlgum?'Nenhum documento em PDF (ou Word) anexado a este negócio. A assinatura precisa de um PDF — anexe o contrato no card "Documentos deste negócio" e volte aqui.':'Este negócio ainda não tem nenhum documento anexado. Anexe o documento (ex.: o contrato em PDF) no card "Documentos deste negócio" e volte aqui.')+'</div><div class="fx je"><button class="btn btn-primary sm" data-action="close-modal">Entendi</button></div></div>');
    return;
  }
  const opts = docs.map((x,i)=>'<label class="fx ac g2" style="padding:9px 11px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px;cursor:pointer"><input type="radio" name="clkDoc" value="'+esc(x.id)+'"'+(i===0?' checked':'')+'>'+iconChip(x.mime==='application/pdf'?'file-text':'image','info',30)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(x.nome||'documento')+'</div><div class="fz12 t500">'+esc(DOC_CAT_LABEL[x.categoria]||'')+'</div></div></label>').join('');
  openModal(
    '<div style="padding:20px;max-width:520px;max-height:82vh;overflow-y:auto">'
    + '<div class="fz16 fw7 t900" style="margin-bottom:4px">Enviar para assinatura</div>'
    + '<div class="fz12 t500" style="margin-bottom:14px">O documento vai para o ClickSign e cada signatário recebe um e-mail para assinar.</div>'
    + '<div class="fz12 fw7 up t800" style="margin-bottom:8px">Documento</div>'+opts
    + '<div class="fz12 fw7 up t800" style="margin:16px 0 4px">Signatários</div>'
    + '<div class="fz11 t500" style="margin-bottom:8px">Use o <b>nome completo</b> (nome e sobrenome) e o <b>e-mail</b> de cada pessoa que vai assinar. O ClickSign recusa nome de uma palavra só.</div>'
    + '<div id="clkSigs">'+_clkSigRow()+'</div>'
    + '<button class="btn btn-ghost sm" data-action="clk-sig-add" style="margin-bottom:8px">'+icon('plus',14)+'Adicionar signatário</button>'
    + '<div class="fz12 fw7 up t800" style="margin:12px 0 6px">Mensagem (opcional)</div><textarea id="clkMsg" class="input" rows="2" maxlength="400" placeholder="Ex.: Segue o contrato para assinatura. Qualquer dúvida, estamos à disposição." style="width:100%"></textarea>'
    + '<div class="fx ac g2" style="margin-top:12px"><span class="fz12 t500">Prazo (dias, opcional):</span><input id="clkPrazo" type="number" min="1" max="90" class="input nsh" style="max-width:90px" placeholder="—"></div>'
    + '<div class="fx je g2" style="margin-top:18px"><button class="btn btn-ghost sm" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm" data-action="clk-enviar-go">'+icon('send',15)+'Enviar</button></div>'
    + '</div>'
  );
}

// Card do Assistente IA (Gemini): botão que sugere a próxima ação + rascunho de
// mensagem ao cliente. SÓ POR CLIQUE (não gasta token sozinho). Some no negócio
// encerrado. O resultado é injetado em #bkIaBox (ver handleAction 'ia-sugerir').
function iaCardHTML(){
  return '<div class="card" style="padding:18px;margin-bottom:16px">'
    + '<div class="fx ac jb wrap g2"><div class="fx ac g2">'+iconChip('sparkles','ai',34)+'<div><div class="up fz12 fw7 t800">Assistente IA</div><div class="fz11 t500">Sugere o próximo passo e um rascunho de mensagem</div></div></div>'
    + '<button class="btn btn-primary sm nsh" data-action="ia-sugerir">'+icon('sparkles',15)+'Sugerir próxima ação</button></div>'
    + '<div id="bkIaBox"></div></div>';
}

function openDeal(id, opts){
  opts = opts || {};
  // DEALS não tem cancelados (filtrados no load); cai no DEALS_DOCS pra poder abrir
  // um cancelado (ver motivo da perda / arquivar).
  const d=DEALS.find(x=>x.id===id) || (DEALS_DOCS||[]).find(x=>x.id===id); if(!d) return; state.currentDeal=id; state._viewingDeal=true; const tab=state.dealTab||'timeline';
  // Vindo de um drawer (pessoa/imóvel), fecha ele — senão o detalhe renderiza atrás.
  closeDrawer(); closeModal();
  // O detalhe é logicamente a tela Negócios (sanfona destaca certo + ESC/voltar coerentes).
  if(state.view!=='negocios'){ state.view='negocios'; if(state.embedded && typeof state.onNavigate==='function'){ try{ state.onNavigate('negocios'); }catch(e){} } }
  const im=propDoDeal(d), corr=CORRETORES[d.corretor]||{nome:'—'};
  // Dados completos do cliente: o doc do negócio guarda só nome+contato, mas o
  // interessado que o gerou (no imóvel) tem email/cpf/telefone/fichaId — busca por
  // negocioId (com fallback no index) pra cobrir negócios antigos sem mudar backend.
  const imv=PROPERTIES.find(p=>p.id===d.imovelId);
  // Fallback por índice SÓ com validação (o índice gravado apodrece se um interessado
  // anterior foi removido — sem a guarda mostraria CPF/ficha de OUTRA pessoa).
  const _fb=(imv&&d.raw&&d.raw.interessadoIndex!=null)?(imv.interessados||[])[d.raw.interessadoIndex]:null;
  const cli=imv?(((imv.interessados||[]).find(it=>it.negocioId===d.id))||((_fb&&_fb.status==='negocio_gerado'&&!_fb.negocioId&&_fb.nome===d.clienteNome)?_fb:null)):null;
  const foneCli = (cli && (cli.telefone  || cli.contato)) || d.clienteContato || '';
  const emailCli = (cli && cli.email) || '';
  const bc=$('#breadcrumb'); if(bc) bc.innerHTML='<button class="btn-dark-ghost" data-nav="negocios">SMART HUB</button>'+icon('chevron-right',15,'tmut')+'<button class="btn-dark-ghost" data-nav="negocios">Negócios</button>'+icon('chevron-right',15,'tmut')+'<span class="tw fw6 mono trunc">'+esc(d.code)+'</span>';

  const tl=(d.timeline||[]).slice().reverse();
  const tabBtn=(k,l)=>'<button class="tab'+(tab===k?' active':'')+'" data-action="dealtab-'+k+'">'+l+'</button>';
  let tabContent='';
  if(tab==='timeline'){ tabContent='<div style="padding:20px">'+(tl.length?tl.map((e,i)=>'<div class="fx g3"><div class="fx col ac">'+iconChip('circle-dot','info',32)+(i<tl.length-1?'<span class="timeline-line"></span>':'')+'</div><div style="padding-bottom:18px" class="grow"><div class="fz14 fw6 t900">'+esc(e.texto)+'</div><div class="fz12 t500">'+esc(e.porNome||'')+' · '+relData(e.em)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:20px">Sem histórico ainda.</div>')+'</div>'; }
  else if(tab==='comentarios'){ if(!d.podeComentar){ tabContent='<div class="tcenter t500 fz13" style="padding:24px">Comentários são exclusivos do broker e do corretor responsável.</div>'; } else { const cs=d.comentarios||[]; if(state.respondendo&&state.respondendo.deal!==d.id) state.respondendo=null; const resp=state.respondendo; const banner=resp?'<div class="fx ac jb g2" style="margin-bottom:8px;padding:6px 10px;background:var(--base);border:1px solid var(--bd);border-radius:8px"><span class="fz12 fw6 t900">'+icon('reply',13)+' Respondendo a '+esc(resp.nome)+'</span><button class="btn btn-ghost sm" data-action="cancelar-resposta">Cancelar</button></div>':''; tabContent='<div style="padding:20px">'+banner+'<div class="fx g2" style="margin-bottom:16px">'+avatar(state.meuNome,34)+'<div class="grow"><textarea id="bkComent" class="input" rows="2" placeholder="'+(resp?'Sua resposta…':'Escreva um comentário para a equipe…')+'"></textarea><div class="fx je" style="margin-top:8px"><button class="btn btn-primary sm" data-action="add-coment">'+(resp?'Responder':'Comentar')+'</button></div></div></div><div id="bkComentList">'+(cs.length?comentListHTML(cs):'<div class="tcenter t500 fz13" data-coment-empty style="padding:20px">Nenhum comentário ainda.</div>')+'</div></div>'; } }
  else if(tab==='tarefas'){ const enc=(d.statusRaw==='concluido'||d.statusRaw==='cancelado'); const ts=(d.tarefas||[]).slice().sort((a,b)=>{ if(a.feito!==b.feito) return a.feito?1:-1; return (a.prazo||'9999-99-99')<(b.prazo||'9999-99-99')?-1:1; }); const rows = ts.length? ts.map(t=>{ const st=prazoStatus(t.prazo); const cor=t.feito?'':(st==='atrasada'?'#ef4444':st==='hoje'?'#f59e0b':''); const prazoTxt = t.prazo? ('<span style="'+(cor?'color:'+cor+';font-weight:700':'')+'">'+(st==='atrasada'?'Atrasada · ':st==='hoje'?'Hoje · ':'')+fmtPrazo(t.prazo)+'</span>') : '<span class="t400">sem prazo</span>'; const chk = enc ? '<span class="ifx ac jc nsh" style="width:22px;height:22px;border-radius:6px;background:'+(t.feito?'var(--success)':'#fff')+';border:'+(t.feito?'none':'2px solid var(--ink300)')+';color:#fff">'+(t.feito?icon('check',14):'')+'</span>' : '<button class="ifx ac jc nsh" data-action="tarefa-check" data-tid="'+esc(t.id)+'" data-feito="'+(t.feito?'0':'1')+'" style="width:22px;height:22px;border-radius:6px;background:'+(t.feito?'var(--success)':'#fff')+';border:'+(t.feito?'none':'2px solid var(--ink300)')+';color:#fff;cursor:pointer">'+(t.feito?icon('check',14):'')+'</button>'; const rm = enc ? '' : '<button class="btn btn-ghost sm nsh" data-action="tarefa-rm" data-tid="'+esc(t.id)+'" title="Remover" style="color:#dc2626">'+icon('trash-2',15)+'</button>'; return '<div class="fx ac g3" style="padding:11px 0;border-top:1px solid var(--ink100)">'+chk+'<div class="grow mw0"><div class="fz13 fw6 t900" style="'+(t.feito?'text-decoration:line-through;opacity:.55':'')+'">'+esc(t.texto)+'</div><div class="fz12 t500">'+prazoTxt+'</div></div>'+rm+'</div>'; }).join('') : '<div class="tcenter t500 fz13" style="padding:20px">Nenhuma tarefa ainda.</div>'; const addRow = enc ? '<div class="fz12 t500" style="margin-bottom:14px">Negócio encerrado — tarefas em modo leitura.</div>' : '<div class="fx g2 wrap" style="margin-bottom:14px"><input id="bkTarefaTxt" class="input grow" maxlength="200" placeholder="Nova tarefa (ex.: ligar para o cliente)" style="min-width:180px"><input id="bkTarefaPrazo" type="date" class="input nsh" style="max-width:170px"><button class="btn btn-primary sm nsh" data-action="tarefa-add">'+icon('plus',15)+'Adicionar</button></div>'; tabContent='<div style="padding:20px">'+addRow+'<div>'+rows+'</div></div>'; }
  else { const encCk=(d.statusRaw==='concluido'||d.statusRaw==='cancelado'); tabContent='<div style="padding:16px 20px"><div class="fz13 fw6 t900" style="margin-bottom:10px">Checklist do negócio'+(encCk?' <span class="fz11 t500 fw5">(encerrado — leitura)</span>':'')+'</div>'+(d.checklist||[]).map(x=>'<button class="fx ac g3'+(encCk?'':' hoverbg')+'"'+(encCk?'':' data-chk="'+esc(x.key)+'" data-feito="'+(x.feito?'0':'1')+'"')+' style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:'+(encCk?'default':'pointer')+';margin-bottom:8px"><span class="ifx ac jc nsh" style="width:24px;height:24px;border-radius:6px;background:'+(x.feito?'var(--success)':'#fff')+';border:'+(x.feito?'none':'2px solid var(--ink300)')+';color:#fff">'+(x.feito?icon('check',15):'')+'</span><div class="grow mw0"><div class="fz13 fw6 t900">'+esc(x.label)+(x.obrigatoria?' <span class="pill danger" style="font-size:10px;padding:1px 6px">obrigatória</span>':'')+'</div>'+(x.feito&&x.feitoPor?'<div class="fz11 t500">'+esc(x.feitoPor)+' · '+relData(x.feitoEm)+'</div>':'')+'</div></button>').join('')+'</div>'; }

  // Troca de aba (Timeline/Tarefas/Comentários/Checklist): re-renderiza SÓ o card das
  // abas — sem rebuildar a tela, resetar a rolagem ou repetir a animação de entrada.
  // Mantém viva a assinatura de comentários ao vivo (não passa pelo teardown/setup abaixo).
  if(opts.tabsOnly){
    const box=$('#bkDealTabs');
    if(box){
      box.innerHTML='<div class="fx g1" style="padding:4px 12px 0;border-bottom:1px solid var(--ink100)">'+tabBtn('timeline','Timeline')+tabBtn('tarefas','Tarefas')+tabBtn('comentarios','Comentários')+tabBtn('checklist','Checklist')+'</div>'+tabContent;
      refreshIcons();
      if(state.dealTab==='comentarios') state._dealRendCount=(d.comentarios||[]).length;
      return;
    }
  }

  // refresh = atualização NO LUGAR (ação dentro do negócio): sem repetir a animação
  // de entrada e preservando a rolagem (não "pisca" nem sobe pro topo). Sem refresh
  // (abrir o negócio de fato) mantém a entrada animada + começa do topo.
  const host=$('#root'); const _sc=$('#scroller'); const _prevY=(opts.refresh&&_sc)?_sc.scrollTop:0;
  if(!opts.refresh){ host.style.animation='none'; void host.offsetWidth; host.style.animation=''; }
  host.innerHTML =
    '<button class="btn-dark-ghost" style="margin-bottom:16px" data-nav="negocios">'+icon('arrow-left',15)+'Voltar aos Negócios</button>'
  + '<div class="card" style="padding:22px;margin-bottom:16px"><div class="fx as jb wrap g4"><div class="mw0"><div class="fx ac g2 wrap"><span class="mono fz13 fw7 t900">'+esc(d.code)+'</span><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'">'+d.tipo+'</span>'+statusPill(d.status)+'</div><div class="fz20 fw7 t900" style="margin-top:10px">'+esc(im.rua)+'</div><div class="fx ac g3 wrap fz13 t500" style="margin-top:8px"><span class="fx ac g1">'+icon('map-pin',14,'t400')+esc(im.bairro||d.cidade)+'</span><span class="divx" style="height:12px"></span><span class="fx ac g1">'+icon('user',14,'t400')+esc(corr.nome)+'</span><span class="divx" style="height:12px"></span><span class="fx ac g1" title="Data em que o negócio foi gerado">'+icon('calendar',14,'t400')+'Gerado em '+esc(d.criado||relData(d.criadoEm))+'</span></div></div>'
    + (imv ? '<button class="nsh" data-prop="'+esc(d.imovelId)+'" title="Ver imóvel completo" style="background:none;border:1px solid var(--ink200);border-radius:12px;padding:8px;cursor:pointer;display:flex;gap:10px;align-items:center;max-width:260px">'
        + (imv.capa ? '<img src="'+esc(imv.capa)+'" alt="" style="width:60px;height:60px;border-radius:8px;object-fit:cover;flex:none">' : '<span class="ifx ac jc nsh" style="width:60px;height:60px;border-radius:8px;background:var(--ink100)">'+icon('building-2',24,'t400')+'</span>')
        + '<div class="mw0" style="text-align:left"><div class="fz13 fw6 t900 trunc">'+esc(imv.tipo||'Imóvel')+'</div><div class="fz12 t500 trunc">'+esc(imv.code||'')+'</div><div class="fz11 c-inf fw6" style="margin-top:2px">Ver imóvel ›</div></div>'
        + '</button>' : '')
    + '<div class="tright nsh"><div class="fz12 t500">Valor do negócio</div><div class="mono fw7 t900" style="font-size:24px;margin-top:2px">'+brlFull(d.valor)+(d.tipo==='Locação'?'<span class="fz13 t500">/mês</span>':'')+'</div><div class="fz13 c-suc fw6" style="margin-top:4px">Comissão '+(d.comDoFeed?'':d.comPct+'% · ')+brlFull(d.comValor)+'</div></div></div><div class="fx g2 wrap" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--ink100)">'+(d.driveUrl?'<a class="btn btn-outline sm" href="'+esc(d.driveUrl)+'" target="_blank" rel="noopener">'+icon('folder-open',15)+'Abrir Drive</a>':'')+'<button class="btn btn-primary sm" data-action="drive-sync-real" title="Cria a pasta do negócio no Drive (com subpastas '+(d.tipo==='Venda'?'Vendedor/Comprador':'Locador/Locatário')+'/Imóvel/Outros) e envia os documentos + fichas">'+icon('refresh-cw',15)+'Sincronizar Drive</button>'+(d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado'?'<button class="btn btn-outline sm" data-action="drive-destino-edit" title="'+(d.driveDestinoUrl?'Pasta destino definida — clique pra ver/alterar':'Cole o link da pasta do Drive onde o robô deve guardar este negócio')+'">'+icon('folder-cog',15)+(d.driveDestinoUrl?'Pasta destino ✓':'Definir pasta destino')+'</button>':'')+'<button class="btn btn-outline sm" data-action="ir-comentarios">'+icon('message-square',15)+'Comentários</button><button class="btn btn-outline sm" data-action="prop-info">'+icon('user-round',15)+'Proprietário</button></div></div>'
  + (d.statusRaw!=='concluido' && d.statusRaw!=='cancelado' ? dealTagsCardHTML(d) : '')
  + '<div class="card" style="padding:22px 24px;margin-bottom:16px"><div class="fx ac jb wrap g2"><div class="up fz13 fw7 t800">Etapas do processo</div><div class="fx ac g3"><span class="fz12 t500">Próxima: <strong class="t900">'+esc(d.prox)+'</strong></span>'+((d.checklist||[]).some(x=>!x.feito)&&d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado'?'<button class="btn btn-primary sm nsh" data-action="concluir-proxima">'+icon('check',15)+'Concluir etapa</button>':'')+'</div></div><div style="margin-top:18px">'+renderStepper(d)+'</div></div>'
  + camposCardHTML(d)
  + propostaCardHTML(d)
  + distribuicaoCardHTML(d)
  + (d.statusRaw!=='concluido' && d.statusRaw!=='cancelado' ? iaCardHTML() : '')
  + (state.role==='broker' && d.statusRaw!=='concluido' && d.statusRaw!=='cancelado' ? '<div class="card" style="padding:18px;margin-bottom:16px"><div class="up fz12 fw7 t800" style="margin-bottom:12px">Ações do gestor</div><div class="fx g2 wrap"><button class="btn btn-outline sm" data-action="neg-entregar">'+icon('package',15)+'Entregar p/ Gestão</button><button class="btn btn-success sm" data-action="neg-concluir">'+icon('check',15)+'Concluir</button><button class="btn btn-outline sm" data-action="neg-cancelar" style="color:var(--danger);border-color:var(--danger)">'+icon('x',15)+'Cancelar</button><button class="btn btn-ghost sm nsh" data-action="neg-excluir" data-codigo="'+esc(d.code)+'" style="color:var(--danger)" title="Excluir permanentemente">'+icon('trash-2',15)+'Excluir</button></div><div class="fz11 t500" style="margin-top:10px">Entregar e Concluir exigem todas as etapas obrigatórias feitas. Cancelar devolve o imóvel a Disponível.</div></div>' : '')
  + (state.role==='broker' && (d.statusRaw==='concluido' || d.statusRaw==='cancelado') ? '<div class="card" style="padding:18px;margin-bottom:16px"><div class="up fz12 fw7 t800 fx ac jb" style="margin-bottom:12px"><span>Negócio encerrado</span><button class="btn btn-ghost sm nsh" data-action="neg-excluir" data-codigo="'+esc(d.code)+'" style="color:var(--danger)" title="Excluir permanentemente">'+icon('trash-2',14)+'Excluir</button></div>'+(d.motivoCancelamento?'<div class="fz13 t700" style="margin-bottom:12px"><span class="t500">Motivo da perda:</span> <strong class="t900">'+esc(d.motivoCancelamento)+'</strong></div>':'')+(d.statusRaw==='concluido' ? '<div class="fx g2 wrap">'+(d.arquivado?'<button class="btn btn-outline sm" data-action="neg-desarquivar">'+icon('archive-restore',15)+'Desarquivar</button>':'<button class="btn btn-outline sm" data-action="neg-arquivar">'+icon('archive',15)+'Arquivar</button>')+'</div><div class="fz11 t500" style="margin-top:10px">Arquivar tira o negócio da lista, mas mantém o histórico e os relatórios.</div>' : '<div class="fz11 t500">Este negócio foi cancelado — o imóvel voltou para Disponível. Continua aqui no histórico e nos relatórios.</div>')+'</div>' : '')
  + dealDocsCardHTML(d, true) /* anexar: gestor/adm/corretor (todos veem só negócio com posse) */
  + clicksignCardHTML(d) /* assinatura eletrônica (ClickSign) — enviar/reenviar/cancelar */
  + '<div class="split-r">'
    + '<div class="fx col g4">'
      + '<div class="card" style="padding:18px"><div class="up fz12 fw7 t800" style="margin-bottom:12px">Cliente</div><div class="fx ac g3">'+avatar(d.clienteNome,40,'var(--ink800)')+'<div class="mw0"><div class="fz14 fw6 t900 trunc">'+esc(d.clienteNome)+'</div><div class="fz12 t500 trunc">'+esc((cli&&[cli.telefone||cli.contato,cli.email].filter(Boolean).join(' · '))||d.clienteContato||'—')+'</div>'+(cli&&cli.cpf?'<div class="fz12 t500 mono">CPF '+esc(cli.cpf)+'</div>':'')+'</div></div>'+'<div class="fx ac jb g2" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--ink100)"><div class="mw0"><div class="fz11 t500 up fw6">Origem do cliente</div><div class="fz13 fw6 t900 trunc">'+(d.origem?esc(d.origem):'<span class="t400 fw4">não informada</span>')+'</div></div>'+(d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado'?'<button class="btn btn-ghost sm nsh" data-action="origem-edit" data-origem="'+esc(d.origem||'')+'" title="Editar origem">'+icon('pencil',14)+'</button>':'')+'</div>'+(cli&&cli.fichaId?'<button class="btn btn-outline sm" data-action="int-ver-ficha" data-ficha="'+esc(cli.fichaId)+'" data-tipo="'+esc(cli.fichaTipo||'')+'" style="width:100%;margin-top:12px">'+icon('file-text',14)+'Ver ficha do cliente</button>':'')+(foneCli?'<button class="btn btn-ghost sm" data-action="copiar-fone" data-valor="'+esc(foneCli)+'" style="width:100%;margin-top:8px">'+icon('copy',14)+'Copiar telefone</button>':'')+(emailCli?'<button class="btn btn-ghost sm" data-action="copiar-email" data-valor="'+esc(emailCli)+'" style="width:100%;margin-top:8px">'+icon('copy',14)+'Copiar e-mail</button>':'')+'</div>'
      + '<div class="card" style="padding:18px"><div class="fx ac jb g2" style="margin-bottom:14px"><span class="up fz12 fw7 t800">Financeiro</span></div><div class="fx col g3 fz13">'+[['Valor',brlFull(d.valor)],['Comissão'+(d.comDoFeed?' (valor do feed)':' ('+d.comPct+'%)'),brlFull(d.comValor)],['Repasse corretor ('+Math.round(repassePct(d.corretor)*100)+'%)',brlFull(repasse(d))],['Progresso',d.progresso+'%'],['Clicksign',d.clicksign]].map(r=>'<div class="fx jb ac"><span class="t500">'+r[0]+'</span><span class="fw6 t900 mono">'+r[1]+'</span></div>').join('')+'</div></div>'
    + '</div>'
    + '<div class="card" id="bkDealTabs" style="overflow:hidden"><div class="fx g1" style="padding:4px 12px 0;border-bottom:1px solid var(--ink100)">'+tabBtn('timeline','Timeline')+tabBtn('tarefas','Tarefas')+tabBtn('comentarios','Comentários')+tabBtn('checklist','Checklist')+'</div>'+tabContent+'</div>'
  + '</div>';
  const sc=$('#scroller'); if(sc) sc.scrollTop=opts.refresh?_prevY:0; refreshIcons();

  // Comentários AO VIVO (estilo chat): escuta ESTE negócio e, quando chega comentário
  // novo de outra pessoa, insere só o balão novo — sem re-renderizar (não apaga o que
  // você está digitando). Só p/ quem pode comentar (broker + corretor do negócio) — as
  // regras deixam gestor/dono ler o doc; administrativo nem tem esta aba.
  _teardownDealRT();
  if(REALTIME && d.podeComentar){
    state._dealRendCount = (d.comentarios||[]).length;
    state._dealUnsub = onSnapshot(doc(db,'negocios',id), (snap)=>{
      if(!snap.exists() || state.currentDeal!==id) return;
      // O doc cru traz `em` como Timestamp do SDK (a conversão pra ISO vive na Cloud
      // Function) — normaliza aqui, senão relData(Timestamp) vira "Há NaN dias" e o
      // cache DEALS fica envenenado pra sempre.
      const cs = (snap.data().comentarios || []).map(c => ({ ...c, em: (c.em && c.em.toDate) ? c.em.toDate().toISOString() : (c.em || null), editadoEm: (c.editadoEm && c.editadoEm.toDate) ? c.editadoEm.toDate().toISOString() : (c.editadoEm || null) }));
      const dd = DEALS.find(x=>x.id===id) || (DEALS_DOCS||[]).find(x=>x.id===id);
      if(dd) dd.comentarios = cs;                    // mantém o cache fresco p/ troca de aba
      if(state.dealTab!=='comentarios'){ state._dealRendCount = cs.length; return; }
      // Re-renderiza a lista inteira (pega adições, edições e threads). O textarea
      // (#bkComent) fica FORA do #bkComentList, então quem está digitando não é atrapalhado.
      const listEl = $('#bkComentList');
      if(listEl){ listEl.innerHTML = cs.length ? comentListHTML(cs) : '<div class="tcenter t500 fz13" data-coment-empty style="padding:20px">Nenhum comentário ainda.</div>'; refreshIcons(); }
      state._dealRendCount = cs.length;
    }, e=>console.warn('deal rt:', e && e.message));
  }
}

// Recarrega os dados e reabre o detalhe do negócio (usado após ações que mudam o
// negócio no servidor mas não devolvem o doc inteiro — ex.: ClickSign enviar/cancelar).
async function reloadDealDetalhe(id){ await carregarDados(); if(state.currentDeal===id && state._viewingDeal) openDeal(id, {refresh:true}); }

async function negAtualizar(payload, okMsg){
  try {
    const dealId = state.currentDeal; // guarda: a resposta pode chegar depois de o usuário navegar
    const r = await fnNegAtual(payload);
    const ng = r.data && r.data.negocio;
    let mapped = null;
    if(ng){
      mapped = mapNegocio(ng);
      _syncDealCache(mapped);   // DEALS + DEALS_DOCS (cancelado sai da lista, fica no _DOCS)
      recalcKPI();
    }
    if(okMsg) toast(okMsg);
    // Só reabre se o usuário AINDA está DENTRO deste negócio — `_viewingDeal` cobre o
    // "cliquei Voltar antes da resposta" (a lista também é view 'negocios', e navigate
    // não limpa currentDeal — sem essa guarda o detalhe reabria sozinho).
    if(state.currentDeal===dealId && state.view==='negocios' && state._viewingDeal){
      if(mapped && mapped.statusRaw==='cancelado') navigate('negocios');
      else {
        // Preserva o que foi digitado nos OUTROS cards (Proposta/Informações/comentário):
        // o openDeal re-renderiza o detalhe inteiro e apagaria rascunho não salvo.
        const drafts={};
        document.querySelectorAll('#root [id^="pp"], #root [id^="cp"], #root #bkComent, #root #bkTarefaTxt').forEach(x=>{ if(x.id&&x.value) drafts[x.id]=x.value; });
        openDeal(dealId, {refresh:true});
        Object.entries(drafts).forEach(([k,v])=>{ const x=document.getElementById(k); if(x) x.value=v; });
      }
    }
    return true;
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); return false; }
}

// Carimbo do portal "2026-08-14T09:22:42" → "14/08 09:22" (mostrado como está, sem
// converter fuso — é o horário que o próprio feed publicou).
function fmtPublish(s){ try{ const [dt,tm]=String(s).split('T'); const [,mo,da]=dt.split('-'); return da+'/'+mo+(tm?(' '+tm.slice(0,5)):''); }catch(_e){ return ''; } }

// Botão "Atualizar do portal": força a sync do feed do iList agora. O backend checa
// primeiro se o feed mudou (ETag) — se não mudou, avisa "sem novidade" sem reprocessar.
async function sincronizarFeedPortal(btn){
  if(btn){ btn.disabled=true; btn.innerHTML=icon('loader',15)+'Buscando…'; refreshIcons(); }
  toast('Buscando novidades do portal…','refresh-cw');
  const restaura=()=>{ if(btn){ btn.disabled=false; btn.innerHTML=icon('refresh-cw',15)+'Atualizar do portal'; refreshIcons(); } };
  state._feedSyncing=true;   // segura o re-render do tempo real enquanto sincroniza
  try{
    const r = await fnFeedSync({});
    const d = r.data || {};
    if(d.semNovidade){
      toast('O portal não gerou novidade'+(d.publishDate?(' desde '+fmtPublish(d.publishDate)):'')+' — nada novo pra trazer.','info');
      restaura();
      return;
    }
    const partes=[];
    if(d.criados) partes.push(d.criados+' novo'+(d.criados>1?'s':''));
    if(d.atualizados) partes.push(d.atualizados+' atualizado'+(d.atualizados>1?'s':''));
    if(d.sumidos) partes.push(d.sumidos+' fora do portal');
    if(d.falhas) partes.push(d.falhas+' falha'+(d.falhas>1?'s':''));
    const resumo = partes.length ? ('✅ '+partes.join(' · ')) : '✅ Carteira já estava em dia.';
    await carregarDados();          // recarrega imóveis+negócios do servidor
    toast(resumo,'check-circle-2','var(--success)');
    // Só re-renderiza se a pessoa não estiver no meio de algo (drawer/modal/detalhe/
    // input). Se estiver, restaura o botão — o toast já avisou o resultado.
    if(_podeRenavegar()) navigate(state.view); else restaura();
  }catch(e){
    toast(e.message||'Erro ao atualizar do portal','alert-triangle','var(--danger)');
    restaura();
  }finally{
    state._feedSyncing=false;
  }
}

// Modal "Pasta destino no Drive": o corretor cola o link da pasta-mãe onde o robô
// deve criar a pasta DESTE negócio (precisa estar compartilhada com o robô como
// Editor). Vazio = volta ao padrão (pasta do corretor mapeada pelo admin).
function openDriveDestino(){
  const d = DEALS.find(x=>x.id===state.currentDeal) || (DEALS_DOCS||[]).find(x=>x.id===state.currentDeal) || {};
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:6px">Pasta destino no Drive</div>'
    +'<div class="fz12 t500" style="margin-bottom:12px;line-height:1.5">Cole o link da pasta do Drive onde o robô deve criar a pasta deste negócio (ex.: a sua pasta de '+(d.tipo==='Venda'?'venda':'locação')+'). Ela precisa estar compartilhada com o robô como Editor. Deixe vazio pra voltar ao padrão (pasta do corretor mapeada pelo admin).</div>'
    +'<input id="ddUrl" class="input" placeholder="https://drive.google.com/drive/folders/…" value="'+esc(d.driveDestinoUrl||'')+'" style="margin-bottom:6px">'
    +'<div id="ddErr" class="fz12" style="color:#dc2626;min-height:16px"></div>'
    +'<div class="fx g2" style="margin-top:10px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="drive-destino-save">'+icon('check',15)+'Salvar</button></div></div>');
}

// Sincroniza os documentos + fichas do negócio pro Drive do corretor (via robô).
// Cria a pasta "endereço (NG-código)" na pasta do corretor e sobe os arquivos.
// Ao terminar, salva o link da pasta como driveUrl do negócio (aparece "Abrir Drive").
async function syncNegocioDrive(){
  const id = state.currentDeal; if(!id) return;
  const btn = document.querySelector('[data-action="drive-sync-real"]');
  if(btn){ btn.disabled = true; btn.innerHTML = icon('loader',15)+'Sincronizando…'; }
  toast('Sincronizando com o Drive…','refresh-cw');
  try {
    const r = await fnDriveSync({ negocioId: id });
    const d = r.data || {};
    const resumo = '✅ '+(d.enviados||0)+' enviado(s)'+(d.jaExistiam?(' · '+d.jaExistiam+' já lá'):'')+(d.removidos?(' · '+d.removidos+' removido(s)'):'')+(d.falhas?(' · '+d.falhas+' falha(s)'):'');
    // salva o link da pasta como driveUrl e recarrega o negócio (reusa negAtualizar → reabre o detalhe).
    // Negócio ENCERRADO aceita o sync (arquivos sobem) mas o servidor recusa gravar driveUrl —
    // então só toast, sem tentar salvar (senão o erro esconderia o sucesso do envio).
    const deal = DEALS.find(x=>x.id===id) || (DEALS_DOCS||[]).find(x=>x.id===id);
    const encerrado = deal && (deal.statusRaw==='concluido'||deal.statusRaw==='cancelado');
    if(d.link && !encerrado){ await negAtualizar({ negocioId:id, acao:'drive', url:d.link }, resumo); }
    else { toast(resumo); if(state.currentDeal===id && state._viewingDeal) openDeal(id); }
  } catch(e){
    toast(e.message||'Erro ao sincronizar','alert-triangle','var(--danger)');
    if(btn){ btn.disabled=false; if(state.currentDeal===id) openDeal(id); }
  }
}

// Modal de CANCELAR negócio com motivo da perda (gestor). O motivo vira campo
// estruturado no negócio (motivoCancelamento) + entra na timeline. Pra virar relatório.
const MOTIVOS_PERDA=['Cliente desistiu','Perdeu para concorrente','Preço / condições','Crédito / documentação reprovada','Imóvel indisponível','Sem retorno do cliente','Outro'];
function openCancelarModal(){
  openModal('<div style="padding:20px;max-width:440px">'
    + '<div class="fz15 fw7 t900" style="margin-bottom:4px">Cancelar negócio</div>'
    + '<div class="fz12 t500" style="margin-bottom:14px">O imóvel volta a <b>Disponível</b> e o interessado volta a <b>Aprovado</b>. Registre o motivo da perda.</div>'
    + '<label class="fz11 fw6 t700" style="display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em">Motivo *</label>'
    + '<select id="cancMotivo" class="input" style="width:100%;padding:9px 11px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;margin-bottom:12px">'+MOTIVOS_PERDA.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('')+'</select>'
    + '<label class="fz11 fw6 t700" style="display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em">Detalhe (opcional)</label>'
    + '<textarea id="cancDetalhe" class="input" rows="2" placeholder="Ex.: comprou outro imóvel na região" style="width:100%;padding:9px 11px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;font-family:var(--sans);resize:vertical"></textarea>'
    + '<div class="fx g2" style="margin-top:16px"><button class="btn btn-outline sm grow" data-action="close-modal">Voltar</button><button class="btn btn-danger sm grow" data-action="neg-cancelar-save">'+icon('x-circle',15)+'Confirmar cancelamento</button></div>'
    + '</div>');
}
// Aprovar/reprovar um interessado (gestor). Recarrega os dados e reabre o imóvel.
// Modal simples pra alterar o "Valor do anúncio" do imóvel. Chama carteiraSalvarImovel
// (que valida posse: dono ou gestor). Aceita "1.500.000", "1500000", "R$ 1.500,00" —
// a function do backend só grava o texto; o parse pra número acontece no cliente.
function openAlterarValor(imovelId){
  const p = (typeof prop==='function' ? prop(imovelId) : null) || {};
  const atual = p.preco ? brlFull(p.preco) : '';
  openModal('<div style="padding:20px;min-width:320px">'
    + '<div class="fz15 fw7 t900" style="margin-bottom:4px">Alterar valor do imóvel</div>'
    + '<div class="fz12 t500" style="margin-bottom:14px">'+esc(p.rua||'—')+(p.finalidadeRaw==='locacao'?' — valor mensal':'')+'</div>'
    + '<label class="fz12 fw6 t700" style="display:block;margin-bottom:6px">Novo valor (R$)</label>'
    + '<input id="alterarValorInput" type="text" class="input" value="'+esc(atual)+'" placeholder="R$ 0,00" style="width:100%;padding:10px 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:14px;font-family:var(--mono)">'
    + '<div class="fx g2" style="margin-top:16px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="alterar-valor-save" data-imovel="'+esc(imovelId)+'">'+icon('check',15)+'Salvar</button></div>'
    + '</div>');
  setTimeout(()=>{ const i=document.getElementById('alterarValorInput'); if(i){ i.focus(); i.select(); } }, 50);
}
// Modal pra CADASTRAR imóvel que veio "de fora" (fora do fluxo de ficha).
// Chama carteiraSalvarImovel SEM imovelId — o backend cria novo, marca origem:'manual',
// atribui numeroProtocolo e situacao:'disponivel'. Obrigatórios (spec): proprietário,
// finalidade e endereço (logradouro + cidade). Sem ficha, sem interessados.
function openNovoImovelManual(){
  const UF=['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  const linha = (l,r)=>'<div class="fx g2 wrap" style="margin-bottom:10px"><div style="flex:1;min-width:180px">'+l+'</div><div style="flex:1;min-width:180px">'+r+'</div></div>';
  const inp = (id,ph,val)=>'<input id="'+id+'" type="text" class="input" placeholder="'+esc(ph)+'"'+(val?' value="'+esc(val)+'"':'')+' style="width:100%;padding:9px 11px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;font-family:var(--sans)">';
  const lbl = (t)=>'<label class="fz11 fw6 t700" style="display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em">'+esc(t)+'</label>';
  const campo = (id,t,ph,val)=>lbl(t)+inp(id,ph,val);
  const selUF = '<select id="niEstado" class="input" style="width:100%;padding:9px 11px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;font-family:var(--sans)"><option value="">UF</option>'+UF.map(u=>'<option value="'+u+'">'+u+'</option>').join('')+'</select>';
  const fin = ['locacao','venda','venda_locacao'].map((v,i)=>'<label style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--bd);border-radius:8px;cursor:pointer;background:var(--raised);flex:1;justify-content:center;font-size:13px"><input type="radio" name="niFin" value="'+v+'"'+(i===0?' checked':'')+' style="margin:0">'+(v==='locacao'?'Locação':v==='venda'?'Venda':'Venda + Locação')+'</label>').join('');
  openModal('<div style="padding:20px;max-width:560px;max-height:80vh;overflow-y:auto">'
    + '<div class="fz15 fw7 t900" style="margin-bottom:4px">Novo imóvel (cadastro manual)</div>'
    + '<div class="fz12 t500" style="margin-bottom:16px">Use quando o imóvel vem de fora — sem passar pela ficha do proprietário. Você pode enviar a ficha depois se quiser.</div>'
    + '<div style="margin-bottom:14px"><div class="fz11 fw6 t700" style="margin-bottom:6px;text-transform:uppercase;letter-spacing:.03em">Finalidade *</div><div class="fx g2 wrap">'+fin+'</div></div>'
    + linha(campo('niProp','Proprietário *','Nome completo'), campo('niContato','Contato do proprietário','Telefone ou e-mail'))
    + linha(campo('niTipo','Tipo','Apartamento, Casa, Sala…'), campo('niValor','Valor (R$)','R$ 0,00'))
    + linha(campo('niLog','Logradouro *','Rua, Avenida…'), campo('niNum','Número','123'))
    + linha(campo('niCompl','Complemento','Apto, bloco…'), campo('niBairro','Bairro','Nome do bairro'))
    + linha(campo('niCidade','Cidade *','Nome da cidade'), lbl('Estado')+selUF)
    + '<div style="margin-bottom:4px">'+campo('niCep','CEP','00000-000')+'</div>'
    + '<div class="fz11 t500" style="margin:6px 0 14px">* obrigatórios</div>'
    + '<div class="fx g2"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="novo-imovel-save">'+icon('check',15)+'Cadastrar imóvel</button></div>'
    + '</div>');
  setTimeout(()=>{ const i=document.getElementById('niProp'); if(i) i.focus(); }, 50);
}
async function salvarNovoImovel(){
  const g=(id)=>((document.getElementById(id)||{}).value||'').trim();
  const finRadio = document.querySelector('input[name="niFin"]:checked');
  const finalidade = finRadio ? finRadio.value : 'locacao';
  const proprietarioNome = g('niProp');
  const logradouro = g('niLog');
  const cidade = g('niCidade');
  if(!proprietarioNome){ toast('Informe o proprietário','alert-triangle','var(--danger)'); return; }
  if(!logradouro){ toast('Informe o logradouro','alert-triangle','var(--danger)'); return; }
  if(!cidade){ toast('Informe a cidade','alert-triangle','var(--danger)'); return; }
  const bruto = g('niValor');
  let valorAnuncio = '';
  if(bruto){
    const soNumero = bruto.replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');
    const n = parseFloat(soNumero);
    if(!isFinite(n) || n < 0){ toast('Valor inválido','alert-triangle','var(--danger)'); return; }
    valorAnuncio = String(n);
  }
  const btn = document.querySelector('[data-action="novo-imovel-save"]'); if(btn) btn.disabled=true;
  try {
    const r = await fnCartSalvar({
      finalidade, proprietarioNome,
      proprietarioContato: g('niContato'),
      tipo: g('niTipo'), valorAnuncio,
      endereco: { cep:g('niCep'), logradouro, numero:g('niNum'), complemento:g('niCompl'), bairro:g('niBairro'), cidade, estado:g('niEstado') }
    });
    toast('Imóvel cadastrado','check');
    closeModal();
    await carregarDados();
    if(state.view==='imoveis') navigate('imoveis');
    // Abre o drawer do imóvel novo pra continuar preenchendo
    const novoId = r && r.data && r.data.imovelId;
    if(novoId) setTimeout(()=>openProp(novoId), 200);
  } catch(e){
    if(btn) btn.disabled=false;
    toast(e.message||'Erro ao cadastrar','alert-triangle','var(--danger)');
  }
}
async function salvarNovoValor(imovelId){
  const inp = document.getElementById('alterarValorInput'); if(!inp) return;
  const bruto = (inp.value||'').trim();
  // Aceita R$/pontos/vírgulas; extrai só dígitos e vírgula → normaliza pra "1234567.89"
  const soNumero = bruto.replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');
  const n = parseFloat(soNumero);
  if(!isFinite(n) || n < 0){ toast('Valor inválido', 'alert-triangle', 'var(--danger)'); return; }
  const btn = document.querySelector('[data-action="alterar-valor-save"]'); if(btn) btn.disabled=true;
  try {
    await fnCartSalvar({ imovelId, valorAnuncio: String(n) });
    toast('Valor atualizado', 'check');
    closeModal();
    await carregarDados();
    const dr=$('#drawer');
    if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId);
  } catch(e){
    if(btn) btn.disabled=false;
    toast(e.message||'Erro ao salvar', 'alert-triangle', 'var(--danger)');
  }
}
async function interessadoAcao(imovelId, index, status, okMsg, id){
  try {
    await fnInteressado({ imovelId, acao:'status', index, status, esperaNome:(id&&id.nome)||'', esperaFichaId:(id&&id.fid)||'' });
    toast(okMsg||'Interessado atualizado', 'check');
    await carregarDados();
    // Só reabre o drawer se ele ainda está aberto neste imóvel (não reabrir o que o usuário fechou).
    const dr=$('#drawer');
    if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId);
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); }
}
// Seletor "Adicionar interessado do Cadastro": lista as fichas de locatário/comprador
// do corretor e, ao escolher, cria o interessado já vinculado à ficha (com "Ver ficha").
async function openInteressadoPicker(imovelId){
  // Filtra os tipos de ficha pela finalidade do imóvel (igual aos botões "Enviar ficha"):
  // venda ⇒ só comprador (proposta); locação ⇒ só locatário (pf/pj/fiador/fiança);
  // venda+locação/legado ⇒ ambos. E marca as fichas que já são interessadas deste imóvel.
  const im = (typeof prop==='function' ? prop(imovelId) : null) || {};
  const fin = im.finalidadeRaw || 'locacao';
  // Comprador (venda) pode ser Proposta de compra OU Pessoa Física/Jurídica — nem sempre
  // há proposta formal no estágio de interessado, e o corretor costuma cadastrar o comprador
  // como pf/pj. Sem isso, a ficha do comprador "sumia" do seletor num imóvel de venda.
  const TIPOS_LOCA=['pf','pj','locacao_fiador','fianca'], TIPOS_VEN=['proposta','pf','pj'];
  const permitidos = fin==='venda' ? TIPOS_VEN : (fin==='locacao' ? TIPOS_LOCA : TIPOS_VEN.concat(TIPOS_LOCA));
  const jaAdicionadas = new Set((im.interessados||[]).map(it=>it.fichaId).filter(Boolean));
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:4px">Adicionar interessado</div><div class="fz12 t500" style="margin-bottom:14px">Escolha uma ficha do Cadastro'+(fin==='venda'?' (comprador)':fin==='locacao'?' (locatário)':' (locatário ou comprador)')+'. Ela entra como “Em análise”.</div><div id="intPickList" class="fz13 t500" style="max-height:52vh;overflow:auto">Carregando fichas…</div><div class="fx" style="margin-top:16px"><button class="btn btn-outline sm grow" data-action="close-modal">Fechar</button></div></div>');
  try {
    const r = await fnFichasInter({});
    const list = ((r && r.data) || []).filter(f=>permitidos.includes(f.tipo));
    const box = document.getElementById('intPickList'); if(!box) return;
    _intPickCache = {};
    if(!list.length){ box.innerHTML='<div class="tcenter t500" style="padding:20px">Nenhuma ficha '+(fin==='venda'?'de comprador':fin==='locacao'?'de locatário':'de locatário/comprador')+' no Cadastro ainda.</div>'; return; }
    list.forEach(f=>{ _intPickCache[f.id]=f; });
    box.innerHTML = list.map(f=>{ const tl=FTIPO_LABEL[f.tipo]||f.tipo; const sub=[f.telefone,f.email,f.cpf?('CPF '+f.cpf):''].filter(Boolean).join(' · '); const ja=jaAdicionadas.has(f.id); const acao=ja?'<span class="pill nsh" style="background:var(--ink100);color:var(--ink500)">Adicionado</span>':'<button class="btn btn-primary sm nsh" data-action="int-add-pick" data-imovel="'+esc(imovelId)+'" data-ficha="'+esc(f.id)+'">'+icon('plus',14)+'Adicionar</button>'; return '<div class="fx ac g3" style="padding:10px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px'+(ja?';opacity:.6':'')+'">'+avatar(f.nome,32,'var(--ink800)')+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(f.nome||'(sem nome)')+'</div><div class="fz11 t500 trunc">'+esc(tl+(sub?' · '+sub:''))+'</div></div>'+acao+'</div>'; }).join('');
    refreshIcons();
  } catch(e){ const box=document.getElementById('intPickList'); if(box) box.innerHTML='<div class="fz13" style="color:#dc2626">'+esc(e.message||'Erro ao carregar fichas')+'</div>'; }
}
// Gerar negócio de um interessado aprovado (gestor). Recarrega e abre o negócio novo.
async function gerarNegocioUI(imovelId, index, id){
  try {
    toast('Gerando negócio…', 'loader-2', 'var(--brand)');
    const r = await fnGerarNeg({ imovelId, interessadoIndex: index, esperaNome:(id&&id.nome)||'', esperaFichaId:(id&&id.fid)||'' });
    await carregarDados();
    const nid = r.data && r.data.negocioId;
    toast('Negócio '+((r.data && r.data.codigo)||'')+' criado', 'check');
    if(nid && DEALS.find(x=>x.id===nid)) openDeal(nid); else navigate('negocios');
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); }
}

/* ---------------- PESSOAS ---------------- */
const PTIPOS=['Todos','Proprietário','Comprador','Locatário','Fiador'];
function filteredPeople(){ const q=semAcento(state.pessoasBusca).trim(); return PEOPLE.filter(p=>{ if(state.pessoasFiltro!=='Todos'&&!p.tipos.includes(state.pessoasFiltro))return false; if(state.pessoasCorretor&&state.pessoasCorretor!=='Todos'&&p._corretor!==state.pessoasCorretor)return false; if(q&&semAcento(p.nome+' '+p.email+' '+p.cpf).indexOf(q)<0)return false; return true; }); }
function tipoColor(t){ return t==='Proprietário'?'info':t==='Comprador'?'success':t==='Locatário'?'ai':'warning'; }
function vinculos(p){ const negs=DEALS.filter(d=>d.clienteNome===p.nome).length; const ims=PROPERTIES.filter(im=>im.proprietarioNome===p.nome).length; return {negs, ims}; }
function vincLabel(p){ const v=vinculos(p); const parts=[]; if(v.negs)parts.push(v.negs+' neg.'); if(v.ims)parts.push(v.ims+' imó.'); return parts.length?parts.join(' · '):'—'; }
function pessoasList(){
  const list=filteredPeople();
  if(!list.length) return vazio('user-x','Nenhuma pessoa encontrada. (As pessoas vêm das fichas e dos interessados dos imóveis.)');
  if(state.pessoasView==='cards'){
    return '<div class="gd" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">'+list.map(p=>{ return '<button class="card card-hover" data-person="'+p.id+'" style="text-align:left;padding:16px"><div class="fx ac g3">'+avatar(p.nome,44,'var(--ink800)')+'<div class="mw0"><div class="fz14 fw6 t900 trunc">'+esc(p.nome)+'</div><div style="margin-top:4px">'+p.tipos.map(t=>pill(t,tipoColor(t))).join(' ')+'</div></div></div><div class="fx col g2" style="margin-top:14px"><div class="fx ac g2 fz12 t500">'+icon('mail',13,'t400')+'<span class="trunc">'+esc(p.email)+'</span></div><div class="fx ac g2 fz12 t500">'+icon('phone',13,'t400')+esc(p.tel)+'</div></div><div class="fx ac g2 fz12 t500" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--ink100)">'+icon('link',13,'t400')+'<span class="fw6 t700">'+esc(vincLabel(p))+'</span></div></button>'; }).join('')+'</div>';
  }
  return '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:720px"><thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th>CPF</th><th>Vínculos</th></tr></thead><tbody>'+list.map(p=>'<tr data-person="'+p.id+'"><td><div class="fx ac g2">'+avatar(p.nome,30,'var(--ink800)')+'<span class="fw6 t900">'+esc(p.nome)+'</span></div></td><td>'+p.tipos.map(t=>pill(t,tipoColor(t))).join(' ')+'</td><td class="t700">'+esc(p.email)+'<div class="fz12 t500">'+esc(p.tel)+'</div></td><td class="mono fz13 t700">'+esc(p.cpf)+'</td><td class="fz13 fw6 t700">'+esc(vincLabel(p))+'</td></tr>').join('')+'</tbody></table></div></div>';
}
function updatePessoas(){ const el=$('#pessoasList'); if(el){ el.innerHTML=pessoasList(); refreshIcons(); } }
RENDERERS.pessoas=function(host){
  host.innerHTML=pageHead(hTitulo('Pessoas'),'Proprietários, compradores, locatários e fiadores vindos das fichas e dos interessados.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px"><div class="fx ac g2 wrap">'+PTIPOS.map(t=>'<button class="chip'+(state.pessoasFiltro===t?' active':'')+'" data-action="pesstipo" data-v="'+t+'">'+t+'</button>').join('')+'</div><div class="fx ac g2"><div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(260px,55vw)">'+icon('search',16,'tmut')+'<input data-input="pessoasBusca" value="'+esc(state.pessoasBusca||'')+'" placeholder="Buscar pessoa…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>'+(state.role==='broker'?corrSelectFrom('pesscorr',state.pessoasCorretor,Object.keys(CORRETORES).map(u=>[u,corrNome(u)]).concat(PEOPLE.map(p=>[p._corretor,corrNome(p._corretor)]))):'')+'<div class="fx" style="background:var(--raised);border:1px solid var(--bd);border-radius:8px;padding:3px"><button class="seg'+(state.pessoasView==='tabela'?" active":"")+'" data-action="pessview" data-v="tabela" style="color:'+(state.pessoasView==='tabela'?'':'var(--ondarkmuted)')+'">'+icon('list',15)+'</button><button class="seg'+(state.pessoasView==='cards'?" active":"")+'" data-action="pessview" data-v="cards" style="color:'+(state.pessoasView==='cards'?'':'var(--ondarkmuted)')+'">'+icon('layout-grid',15)+'</button></div></div></div>'
  + '<div id="pessoasList">'+pessoasList()+'</div>';
};
function kv(l,v){ return '<div class="fx jb ac" style="padding:11px 0;border-bottom:1px solid var(--ink100)"><span class="fz13 t500">'+l+'</span><span class="fz13 fw6 t900 tright">'+v+'</span></div>'; }
function openPerson(id){ state.currentPerson=id; if(!state.pessoaTab)state.pessoaTab='dados'; openDrawer(personDrawer(id)); }
function personDrawer(id){
  const p=person(id); const tab=state.pessoaTab||'dados';
  const negs=DEALS.filter(d=>d.clienteNome===p.nome);
  const tabs=[['dados','Dados'],['vinc','Negócios'],['obs','Observações']];
  let body='';
  if(tab==='dados'){ body='<div>'+kv('E-mail',esc(p.email))+kv('Telefone',esc(p.tel))+kv('CPF','<span class="mono">'+esc(p.cpf)+'</span>')+kv('Cidade',esc(p.cidade))+'</div>'+(p.fichaId?'<button class="btn btn-outline sm" data-action="int-ver-ficha" data-ficha="'+esc(p.fichaId)+'" data-tipo="'+esc(p.fichaTipo||'')+'" style="width:100%;margin-top:14px">'+icon('file-text',15)+'Ver ficha completa</button>':''); }
  else if(tab==='vinc'){ body=negs.length?negs.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:pointer;margin-bottom:8px">'+iconChip('handshake',d.tipo==='Venda'?'info':'ai',34)+'<div class="grow mw0"><div class="fz13 fw6 t900 mono">'+esc(d.code)+'</div><div class="fz11 t500 trunc">'+esc(propDoDeal(d).rua)+'</div></div>'+statusPill(d.status)+'</button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum negócio vinculado.</div>'; }
  else { body='<div class="fz13 t700" style="line-height:1.55">'+esc(p.obs||'—')+'</div>'; }
  const telNum=(p.tel&&p.tel!=='—')?String(p.tel).replace(/\D/g,''):'';
  const acoesContato=telNum?'<div class="fx g2" style="padding:12px 16px 0"><a class="btn btn-success sm grow" href="https://wa.me/55'+telNum+'" target="_blank" rel="noopener" style="text-decoration:none">'+icon('message-circle',15)+'WhatsApp</a><a class="btn btn-outline sm grow" href="tel:+55'+telNum+'" style="text-decoration:none">'+icon('phone',15)+'Ligar</a></div>':'';
  return drawerHead(p.nome, p.tipos.join(' · '))
   + acoesContato
   + '<div class="fx g1" style="padding:2px 16px 0;border-bottom:1px solid var(--ink100);overflow-x:auto">'+tabs.map(t=>'<button class="tab'+(tab===t[0]?' active':'')+'" data-action="ptab-'+t[0]+'">'+t[1]+'</button>').join('')+'</div>'
   + '<div class="grow scrolly" style="overflow:auto;padding:18px 20px">'+body+'</div>'
   + '<div class="fx g2" style="padding:14px 20px;border-top:1px solid var(--ink100)"><button class="btn btn-outline sm grow" data-action="close-drawer">Fechar</button></div>';
}

/* ---------------- IMÓVEIS ---------------- */
const GRAD=['linear-gradient(135deg,#1e3a8a,#3b82f6)','linear-gradient(135deg,#0f766e,#14b8a6)','linear-gradient(135deg,#6d28d9,#a855f7)','linear-gradient(135deg,#9a3412,#f59e0b)','linear-gradient(135deg,#9f1239,#f43f5e)','linear-gradient(135deg,#334155,#64748b)'];
function imFinalMatch(p){ const f=state.imoveisFiltro; if(f==='Arquivado') return !!p.arquivado; if(p.arquivado) return false; if(f==='Venda') return p.finalidadeRaw==='venda'||p.finalidadeRaw==='venda_locacao'; if(f==='Locação') return p.finalidadeRaw==='locacao'||p.finalidadeRaw==='venda_locacao'; return true; }
// Filtro por corretor (só o gestor tem o select; pros outros papéis fica 'Todos').
function imCorrMatch(p){ const c=state.imoveisCorretor; return !c||c==='Todos'||p.corretor===c; }
// Nota de qualidade do anúncio, SÓ com os critérios oficiais do iList que o Nathan passou:
// fotos ≥ 20, título ≤ 100 caracteres, descrição entre 1500 e 2999 caracteres.
// Pesos somam 100: fotos 40, título 20, descrição 40. (Mais critérios entram aqui conforme
// forem definidos.)
function imQualidade(p){
  const f=p.feed||{}; const fotos=p.fotos||0;
  const tit=(f.titulo||'').trim();
  const desc=(f.descricao||(p.raw&&p.raw.observacoes)||'').trim();
  let s=0; const falta=[];
  // Fotos: mínimo 20
  s+=Math.min(fotos/20,1)*40; if(fotos<20)falta.push('Mín. 20 fotos (tem '+fotos+')');
  // Título: até 100 caracteres
  if(tit&&tit.length<=100){ s+=20; } else if(!tit){ falta.push('Sem título'); } else { falta.push('Título acima de 100 caracteres (tem '+tit.length+')'); }
  // Descrição: entre 1500 e 2999 caracteres
  if(desc.length>=1500&&desc.length<=2999){ s+=40; }
  else if(desc.length<1500){ s+=Math.round(desc.length/1500*40); falta.push('Descrição curta — mín. 1500 (tem '+desc.length+')'); }
  else { s+=28; falta.push('Descrição longa — máx. 2999 (tem '+desc.length+')'); }
  return { pct: Math.round(s), falta };
}
function qualCor(pct){ return pct>=80?'#16a34a':pct>=50?'#f59e0b':'#ef4444'; }
// Círculo pequeno com a nota, pro card da Carteira.
function notaCirculo(p){ const q=imQualidade(p); const cor=qualCor(q.pct); const tip='Qualidade do cadastro: '+q.pct+'%'+(q.falta.length?' — falta: '+q.falta.join(', '):' — completo'); return '<span title="'+esc(tip)+'" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:3px solid '+cor+';color:'+cor+';font-weight:800;font-size:11px;line-height:1;font-family:var(--mono,monospace)">'+q.pct+'</span>'; }
// Select "por corretor" (só o gestor usa). Monta a lista de corretores a partir dos
// pares [uid,nome] da tela (imóveis, negócios ou pessoas), dedup + ordem alfabética.
function corrSelectFrom(action, cur, pares){ const seen={}; (pares||[]).forEach(pr=>{ const uid=pr&&pr[0]; if(uid&&!seen[uid]) seen[uid]=pr[1]||corrNome(uid)||'Corretor'; }); const opts=[['Todos','Todos os corretores']].concat(Object.keys(seen).map(u=>[u,seen[u]]).sort((a,b)=>a[1].localeCompare(b[1]))); return '<select class="input" data-action="'+action+'" title="Filtrar por corretor" style="width:auto;max-width:190px;background-color:var(--raised);border-color:var(--bd);color:#fff">'+opts.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===(cur||'Todos')?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>'; }
function filteredProps(){ const q=semAcento(state.imoveisBusca).trim(); const arr=PROPERTIES_ALL.filter(p=>{ if(!noMes(p.criadoEm))return false; if(!imFinalMatch(p))return false; if(!imCorrMatch(p))return false; if(q&&semAcento(p.rua+' '+p.bairro+' '+p.code+' '+p.tipo).indexOf(q)<0)return false; return true; }); const asc=state.imoveisSort==='antigo'; arr.sort((a,b)=>{ const ta=a.criadoEm||'', tb=b.criadoEm||''; if(ta===tb) return 0; return asc ? (ta<tb?-1:1) : (ta<tb?1:-1); }); return arr; }
function imoveisList(){
  const list=filteredProps();
  if(!list.length) return vazio('building','Nenhum imóvel encontrado.');
  if(state.imoveisView==='cards'){
    return '<div class="gd" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">'+list.map((p,i)=>'<button class="card card-hover" data-prop="'+p.id+'" style="overflow:hidden;text-align:left;padding:0'+(p.concluido?';opacity:.6':'')+'"><div style="height:148px;background:'+GRAD[i%GRAD.length]+';position:relative;overflow:hidden">'+(p.capa?'<img src="'+esc(p.capa)+'" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 60%)"></div>':'')+'<span class="pill" style="position:absolute;top:10px;left:10px;background:rgba(255,255,255,.92);color:var(--ink900)">'+p.finalidade+'</span>'+(p.fotos?'<span style="position:absolute;top:10px;right:10px"><span class="pill" style="background:rgba(0,0,0,.35);color:#fff">'+icon("image",12)+p.fotos+'</span></span>':'')+'<span class="mono" style="position:absolute;bottom:10px;left:12px;color:#fff;font-weight:700;font-size:17px;text-shadow:0 1px 4px rgba(0,0,0,.3)">'+(p.preco?brlFull(p.preco)+(p.finalidadeRaw==='locacao'?'<span style="font-size:12px;font-weight:500">/mês</span>':''):'Sem valor')+'</span></div><div style="padding:14px"><div class="fx ac jb g2"><div class="fz14 fw6 t900 trunc grow mw0">'+esc(p.rua)+'</div>'+(p.raw&&p.raw.origem==='feed'?notaCirculo(p):'')+'</div><div class="fz12 t500">'+esc(p.bairro)+' · '+esc(p.tipo)+'</div>'+((p.dorm||p.vaga!=null||p.area)?'<div class="fx ac g3 fz12 t500" style="margin-top:8px">'+(p.dorm?'<span class="fx ac g1">'+icon('bed-double',13,'t400')+p.dorm+'</span>':'')+(p.vaga!=null?'<span class="fx ac g1">'+icon('car',13,'t400')+p.vaga+'</span>':'')+(p.area?'<span class="fx ac g1">'+icon('ruler',13,'t400')+p.area+'m²</span>':'')+'</div>':'')+(state.role!=='corretor'&&corrNome(p.corretor)!=='—'?'<div class="fz12 t500" style="margin-top:6px">Corretor: '+esc(corrNome(p.corretor))+'</div>':'')+'<div class="fx ac g3 fz12 t500" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--ink100)">'+statusPill(p.status)+(p.pendentes.length?'<span class="fx ac g1" title="Pendências da ficha" style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.35);border-radius:999px;padding:2px 8px;font-weight:700;font-size:11px">'+icon('alert-triangle',11)+p.pendentes.length+'</span>':'')+'<span class="fx ac g2" style="margin-left:auto">'+(p.dataFmt?'<span class="fx ac g1 t400">'+icon('calendar',12,'t400')+esc(p.dataFmt)+'</span>':'')+'<span class="mono t400">'+esc(p.code)+'</span></span></div></div></button>').join('')+'</div>';
  }
  return '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:760px"><thead><tr><th>Código</th><th>Imóvel</th><th>Tipo</th><th>Finalidade</th><th>Proprietário</th><th>Data</th><th class="tcenter">Pend.</th><th class="tright">Valor</th></tr></thead><tbody>'+list.map(p=>'<tr data-prop="'+p.id+'"'+(p.concluido?' style="opacity:.6"':'')+'><td class="mono fz13 fw6 t900">'+esc(p.code)+'</td><td><div class="fw6 t900">'+esc(p.rua)+'</div><div class="fz12 t500">'+esc(p.bairro)+'</div></td><td class="t700">'+esc(p.tipo)+'</td><td>'+pill(p.finalidade,p.finalidadeRaw==='locacao'?'ai':'info')+'</td><td class="t700">'+esc(p.proprietarioNome)+'</td><td class="fz13 t700">'+esc(p.dataFmt||'—')+'</td><td class="tcenter">'+(p.pendentes.length?'<span title="'+esc(p.pendentes.map(pendLabel).join(', '))+'" style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.35);border-radius:999px;padding:2px 8px;font-weight:700;font-size:12px">'+p.pendentes.length+'</span>':'<span class="t400">—</span>')+'</td><td class="tright mono fw6 t900">'+(p.preco?brlFull(p.preco):'—')+'</td></tr>').join('')+'</tbody></table></div></div>';
}
function updateImoveis(){ const el=$('#imoveisList'); if(el){ el.innerHTML=imoveisList(); refreshIcons(); } }
RENDERERS.imoveis=function(host){
  const fs=['Todos','Venda','Locação','Arquivado'];
  // Contagem por filtro (respeita o mês, ignora a busca e o chip ativo). Todos/Venda/
  // Locação contam só os ATIVOS; Arquivado conta os arquivados (saíram do portal etc.).
  const _baseC=PROPERTIES_ALL.filter(p=>noMes(p.criadoEm)&&imCorrMatch(p));
  const _ativosC=_baseC.filter(p=>!p.arquivado);
  const _contFin=(t)=> t==='Arquivado' ? _baseC.filter(p=>p.arquivado).length
    : t==='Todos' ? _ativosC.length
    : t==='Venda' ? _ativosC.filter(p=>p.finalidadeRaw==='venda'||p.finalidadeRaw==='venda_locacao').length
    : _ativosC.filter(p=>p.finalidadeRaw==='locacao'||p.finalidadeRaw==='venda_locacao').length;
  host.innerHTML=pageHead(hTitulo('Imóveis'),'Carteira de imóveis da imobiliária — reutilizáveis entre negócios.','<button class="btn btn-outline sm" data-action="feed-sync" title="Buscar imóveis novos/atualizados do portal (iList) agora, sem esperar a sincronização automática">'+icon('refresh-cw',15)+'Atualizar do portal</button><button class="btn btn-primary sm" data-action="novo-imovel-manual" title="Cadastrar imóvel que veio de fora (sem ficha)">'+icon('plus',15)+'Novo imóvel</button>')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px"><div class="fx ac g2 wrap">'+fs.map(t=>'<button class="chip'+(state.imoveisFiltro===t?' active':'')+'" data-action="imotipo" data-v="'+t+'">'+t+' <span class="mono" style="opacity:.6;font-weight:700;font-size:11px">'+_contFin(t)+'</span></button>').join('')+'</div><div class="fx ac g2 wrap"><div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(260px,55vw)">'+icon('search',16,'tmut')+'<input data-input="imoveisBusca" value="'+esc(state.imoveisBusca||'')+'" placeholder="Buscar imóvel…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div><button data-action="imosort" title="Ordenar por data de cadastro" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;font-family:var(--sans);cursor:pointer;white-space:nowrap">'+icon(state.imoveisSort==='antigo'?'arrow-up':'arrow-down',15)+(state.imoveisSort==='antigo'?'Mais antigos':'Mais novos')+'</button>'+(state.role==='broker'?corrSelectFrom('imocorr',state.imoveisCorretor,PROPERTIES_ALL.map(p=>[p.corretor,p.corretorNome])):'')+mesSelect()+'<div class="fx" style="background:var(--raised);border:1px solid var(--bd);border-radius:8px;padding:3px"><button class="seg'+(state.imoveisView==='cards'?" active":"")+'" data-action="imoview" data-v="cards" style="color:'+(state.imoveisView==='cards'?'':'var(--ondarkmuted)')+'">'+icon('layout-grid',15)+'</button><button class="seg'+(state.imoveisView==='tabela'?" active":"")+'" data-action="imoview" data-v="tabela" style="color:'+(state.imoveisView==='tabela'?'':'var(--ondarkmuted)')+'">'+icon('list',15)+'</button></div></div></div>'
  + '<div id="imoveisList">'+imoveisList()+'</div>';
};
function openProp(id){ state.currentProp=id; if(!state.imovelTab)state.imovelTab='dados'; openDrawer(propDrawer(id)); }
const DOC_LABELS={matricula:'Matrícula',iptu:'IPTU',escritura:'Escritura',contaConsumo:'Conta de consumo',rgCpf:'RG / CPF',comprovanteRenda:'Comprovante de renda',contrato:'Contrato',habitese:'Habite-se',planta:'Planta',fotos:'Fotos'};
function docLabel(k){ return DOC_LABELS[k] || String(k).replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()); }
function propDrawer(id){
  const p=prop(id); const tab=state.imovelTab||'dados'; const negs=DEALS.filter(d=>d.imovelId===id); const gi=PROPERTIES.indexOf(PROPERTIES.find(x=>x.id===id));
  // Imóvel do feed (e qualquer um) vem sem proprietário: oferece copiar a ficha do
  // locador (locação) ou do vendedor (venda) pra mandar ao dono preencher os dados.
  const _fr=p.finalidadeRaw; const _semDono=!p.proprietarioContato&&(!p.proprietarioNome||p.proprietarioNome==='—');
  const _fichasProp=[]; if(_fr==='venda'||_fr==='venda_locacao')_fichasProp.push(['ficha-vendedor.html','Copiar ficha do vendedor']); if(_fr==='locacao'||_fr==='venda_locacao'||!_fr)_fichasProp.push(['ficha-locador.html','Copiar ficha do locador']);
  // Só oferece o botão se o imóvel TEM corretor: o merge no backend exige ficha do mesmo
  // dono (anti-injeção) — sem dono conhecido a ficha viraria um card duplicado, não o
  // preenchimento deste. Imóvel legado sem dono usa o fluxo normal do Cadastro.
  // Vincular ficha JÁ cadastrada (não depende de corretor — a ficha traz o dono dela);
  // Copiar ficha nova só com corretor (o merge no backend exige ficha do mesmo dono).
  const _finBtn=_fr||'locacao';
  const _vincBtn=_semDono?'<button class="btn btn-outline sm" data-action="prop-vincular" data-imovel="'+esc(p.id)+'" data-fin="'+esc(_finBtn)+'" style="width:100%;margin-bottom:8px">'+icon('link',14)+'Vincular uma ficha já existente</button>':'';
  const _copyBtns=(_semDono&&p.corretor)?'<div class="fx wrap g2">'+_fichasProp.map(f=>'<button class="btn btn-outline sm" data-action="prop-ficha-copy" data-arq="'+f[0]+'" data-imovel="'+esc(p.id)+'">'+icon('copy',14)+f[1]+'</button>').join('')+'</div>':'';
  const propFichaBtns=_semDono?('<div class="fz11 t500" style="margin-top:10px;margin-bottom:6px">Sem proprietário — vincule uma ficha já cadastrada'+(p.corretor?' ou envie uma nova pra ele preencher':'')+':</div>'+_vincBtn+_copyBtns):'';
  // "Qualidade do cadastro" (estilo iList): nota calculada + o que falta preencher.
  const _q=imQualidade(p); const _falta=_q.falta; const _pct=_q.pct; const _corPct=qualCor(_pct);
  const _feedHint=(p.raw&&p.raw.origem==='feed'&&_falta.length)?'<div class="fz11 t400" style="margin-top:8px">Esses itens se corrigem no anúncio do portal (sincroniza no dia seguinte).</div>':'';
  const dicasImovel='<div class="card" style="margin-top:14px;padding:12px 14px"><div class="fx ac jb g2" style="margin-bottom:8px"><span class="fz11 up fw7 t500">Qualidade do cadastro</span><span class="mono fw7" style="font-size:13px;color:'+_corPct+'">'+_pct+'%</span></div><div style="height:7px;border-radius:999px;background:var(--ink100);overflow:hidden'+(_falta.length?';margin-bottom:10px':'')+'"><div style="height:100%;border-radius:999px;width:'+_pct+'%;background:'+_corPct+'"></div></div>'+(_falta.length?('<div class="fz12 fw6 t700" style="margin-bottom:6px">Falta preencher:</div><div class="fx wrap g2">'+_falta.map(f=>'<span style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.35);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600">'+esc(f)+'</span>').join('')+'</div>'+_feedHint):'<div class="fz12 fw6 c-suc">Cadastro completo ✓</div>')+'</div>';
  const tabs=[['dados','Dados'],['interessados','Interessados'],['docs','Documentos'],['vinc','Negócios']];
  let body='';
  if(tab==='dados'){ body='<div>'+kv('Finalidade',p.finalidade)+kv('Tipo',esc(p.tipo))+kv('Valor','<span class="mono">'+(p.preco?brlFull(p.preco):'—')+(p.finalidadeRaw==='locacao'?'/mês':'')+'</span>'+(p.raw&&p.raw.origem==='feed'?' <span class="fz11 t400" title="Vem do portal — edite o valor no anúncio">· do portal</span>':' <button class="btn btn-ghost sm" data-action="alterar-valor" data-imovel="'+esc(p.id)+'" title="Alterar valor" style="margin-left:6px;padding:2px 8px;font-size:11px">'+icon('pencil',12)+'Alterar</button>'))+kv('Situação',p.status)+(p.area?kv('Área',esc(p.area)+' m²'):'')+(p.dorm?kv('Dormitórios',esc(p.dorm)):'')+(p.vaga!=null?kv('Vagas',esc(p.vaga)):'')+(p.feed&&p.feed.suites?kv('Suítes',esc(p.feed.suites)):'')+(p.feed&&p.feed.banheiros?kv('Banheiros',esc(p.feed.banheiros)):'')+(p.feed&&p.feed.condominio?kv('Condomínio','R$ '+esc(p.feed.condominio)):'')+(p.feed&&p.feed.ano?kv('Ano de construção',esc(p.feed.ano)):'')+kv('Bairro',esc(p.bairro))+kv('Cidade',esc(p.cidade))+kv('Cadastrado em',esc(p.dataFmt||'—'))+(p.portalUrl?'<div class="fx ac g2" style="margin-top:12px"><a href="'+esc(p.portalUrl)+'" target="_blank" rel="noopener" class="btn btn-outline sm" style="text-decoration:none">'+icon('external-link',14)+'Ver anúncio no portal</a><details class="im-share" style="position:relative"><summary class="btn btn-outline sm" style="list-style:none;padding:6px 12px;font-size:18px;line-height:1;font-weight:800" title="Mais opções">⋯</summary><div style="position:absolute;top:calc(100% + 6px);right:0;z-index:20;background:var(--surface,#fff);border:1px solid var(--ink200);border-radius:10px;padding:6px;box-shadow:0 10px 28px rgba(0,0,0,.28);min-width:190px"><button class="btn btn-ghost sm" data-action="imovel-compartilhar" data-url="'+esc(p.portalUrl)+'" data-titulo="'+esc(p.rua||'Imóvel')+'" style="width:100%;justify-content:flex-start">'+icon('share-2',14)+'Compartilhar link</button></div></details></div>':'')+(p.feed&&p.feed.descricao?'<div class="fz11 up fw7 t500" style="margin-top:16px;margin-bottom:6px">Descrição do anúncio</div><div class="fz12 t600" style="white-space:pre-line;max-height:180px;overflow:auto;line-height:1.5">'+esc(p.feed.descricao)+'</div>':'')+'</div><div class="card" style="margin-top:14px;padding:12px 14px;background:var(--ink50);border-color:var(--ink200)"><div class="fz11 t500">Proprietário</div><div class="fz14 fw6 t900">'+esc(p.proprietarioNome)+'</div>'+(p.proprietarioContato?'<div class="fz12 t500">'+esc(p.proprietarioContato)+'</div>':'')+propFichaBtns+'</div>'+(p.pendentes.length?'<div class="card" style="margin-top:14px;padding:12px 14px;background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.3)"><div class="fx ac g2 fz12 fw7" style="margin-bottom:8px;color:#f59e0b">'+icon('alert-triangle',14)+'Pendências da ficha ('+p.pendentes.length+')</div><div class="fx wrap g2">'+p.pendentes.map(k=>'<span style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.35);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600">'+esc(pendLabel(k))+'</span>').join('')+'</div><div class="fz11 t500" style="margin-top:8px">Itens que o cliente marcou como “não tenho agora” ao preencher a ficha.</div></div>':'')+(p.raw&&p.raw.origem==='feed'?dicasImovel:''); }
  else if(tab==='interessados'){ const its=p.interessados||[]; const ehG=state.role==='broker'; const fichaOpts=[]; if(p.finalidadeRaw!=='locacao')fichaOpts.push(['ficha-proposta.html','Comprador']); if(p.finalidadeRaw!=='venda'){fichaOpts.push(['ficha-pf.html','Cliente PF']);fichaOpts.push(['ficha-pj.html','Cliente PJ']);} const enviarFicha='<div class="card" style="padding:12px 14px;margin-bottom:14px;background:var(--ink50);border-color:var(--ink200)"><div class="fz12 fw7 t800" style="margin-bottom:2px">Enviar ficha ao interessado</div><div class="fz11 t500" style="margin-bottom:10px">O link já vai amarrado a este imóvel — quando o cliente responder, ele entra aqui como “Ficha recebida”.</div><div class="fx g2 wrap">'+fichaOpts.map(f=>'<button class="btn btn-outline sm" data-action="int-ficha-copy" data-arq="'+f[0]+'" data-imovel="'+esc(p.id)+'">'+icon('copy',14)+f[1]+'</button>').join('')+'</div></div>'; const addInteressado='<button class="btn btn-outline sm" data-action="int-add-open" data-imovel="'+esc(p.id)+'" style="width:100%;margin-bottom:14px">'+icon('user-plus',14)+'Adicionar interessado do Cadastro</button>'; body=enviarFicha+addInteressado+(its.length?its.map((it,idx)=>{ const st=it.status||''; const _ida=' data-nome="'+esc(it.nome||'')+'" data-fid="'+esc(it.fichaId||'')+'"'; let ac=''; if(ehG){ if(st==='ficha_recebida'||st==='em_analise'||st==='ficha_enviada'){ ac='<div class="fx g2" style="margin-top:10px"><button class="btn btn-primary sm" data-action="int-aprovar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'"'+_ida+'>'+icon('check',14)+'Aprovar</button><button class="btn btn-outline sm" data-action="int-reprovar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'"'+_ida+'>'+icon('x',14)+'Reprovar</button></div>'; } else if(st==='aprovado'){ ac='<div class="fx" style="margin-top:10px"><button class="btn btn-primary sm" data-action="int-gerar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'"'+_ida+'>'+icon('handshake',14)+'Gerar negócio</button></div>'; } } return '<div style="border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px;padding:11px 12px"><div class="fx ac g3">'+avatar(it.nome,34,'var(--ink800)')+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(it.nome||'—')+'</div>'+((it.telefone||it.contato||it.email||it.cpf)?'<div class="fz11 t500 trunc">'+esc([it.telefone||it.contato,it.email,it.cpf?('CPF '+it.cpf):''].filter(Boolean).join(' · '))+'</div>':'')+'</div>'+pill(st.replace(/_/g,' '),'neutral')+'</div>'+(it.fichaId?'<button class="btn btn-outline sm" data-action="int-ver-ficha" data-ficha="'+esc(it.fichaId)+'" data-tipo="'+esc(it.fichaTipo||'')+'" style="margin-top:10px">'+icon('file-text',14)+'Ver ficha</button>':'')+ac+((st!=='negocio_gerado'&&(ehG||(st!=='aprovado'&&st!=='reprovado')))?'<button class="btn btn-ghost sm" data-action="int-remover" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'"'+_ida+' style="margin-top:8px;color:#dc2626">'+icon('trash-2',14)+'Remover</button>':'')+'</div>'; }).join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum interessado ainda — adicione um do Cadastro ou envie uma ficha acima.</div>'); }
  else if(tab==='docs'){
    const raw=(p.raw&&p.raw.documentos)||{};
    const extra=(p.raw&&p.raw.documentosExtra)||[];
    const anexos=Object.entries(raw).filter(([,url])=>typeof url==='string' && /^https?:/i.test(url));
    const ehVenda=p.finalidadeRaw==='venda'||p.finalidadeRaw==='venda_locacao';
    const fichasEnv=[];
    if(p.raw&&p.raw.fichaId) fichasEnv.push({id:p.raw.fichaId, col:(p.raw.fichaTipo==='locador'?'fichas_locador':'fichas'), rot:'Ficha do proprietário'+(p.proprietarioNome?(' — '+p.proprietarioNome):'')});
    (p.interessados||[]).forEach(it=>{ if(it.fichaId) fichasEnv.push({id:it.fichaId, col:'fichas', rot:'Ficha de '+(it.nome||'interessado')}); });
    const fichasHtml=fichasEnv.length?('<div class="fz12 up fw7 t500" style="margin-bottom:10px">Fichas envolvidas (PDF)</div>'+fichasEnv.map(f=>'<div class="fx ac g3" style="padding:10px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px">'+iconChip('file-text','info',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(f.rot)+'</div><div class="fz11 t500">Dados + documentos embutidos</div></div><button class="btn btn-outline sm nsh" data-action="baixar-ficha-pdf" data-ficha="'+esc(f.id)+'" data-col="'+esc(f.col)+'">'+icon('download',14)+'Baixar PDF</button></div>').join('')+'<div style="height:16px"></div>'):'';
    body=(ehVenda?'<button class="btn btn-primary sm" data-action="gerar-contrato" data-imovel="'+esc(p.id)+'" style="width:100%;margin-bottom:14px">'+icon('file-text',15)+'Gerar Contrato de representação</button>':'')
      + fichasHtml
      + '<div class="fz12 up fw7 t500" style="margin-bottom:10px">Anexos da ficha</div>'
      + (anexos.length?anexos.map(([k,url])=>'<a class="fx ac g3 hoverbg" href="'+esc(url)+'" target="_blank" rel="noopener" style="text-decoration:none;padding:10px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px">'+iconChip('file-text','info',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(docLabel(k))+'</div><div class="fz11 t500">Anexo do imóvel</div></div>'+icon('download',15,'t400')+'</a>').join(''):'<div class="fz13 t500" style="margin-bottom:12px">Nenhum anexo enviado ainda.</div>')
      + (extra.length?('<div style="height:16px"></div><div class="fz12 up fw7 t500" style="margin-bottom:10px">Outros documentos</div>'+extra.map(x=>'<div class="fx ac g3" style="padding:10px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px">'+iconChip('file-text','info',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(x.nome||'documento')+'</div><div class="fz11 t500 trunc">'+esc(x.porNome||'anexado')+'</div></div><a class="btn btn-outline sm nsh" href="'+esc(x.url||'')+'" target="_blank" rel="noopener" title="Baixar">'+icon('download',14)+'</a><button class="btn btn-ghost sm nsh" data-action="imovel-doc-remover" data-imovel="'+esc(p.id)+'" data-doc="'+esc(x.id||'')+'" data-nome="'+esc(x.nome||'')+'" style="color:#dc2626" title="Remover">'+icon('trash-2',14)+'</button></div>').join('')):'')
      + '<button class="btn btn-outline sm" data-action="add-doc" style="width:100%;margin-top:6px">'+icon('plus',15)+'Adicionar documento</button>';
  }
  else { body=negs.length?negs.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:pointer;margin-bottom:8px">'+iconChip('handshake',d.tipo==='Venda'?'info':'ai',34)+'<div class="grow mw0"><div class="fz13 fw6 t900 mono">'+esc(d.code)+'</div><div class="fz11 t500 trunc">'+esc(d.clienteNome)+'</div></div>'+statusPill(d.status)+'</button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum negócio vinculado.</div>'; }
  return drawerHead(p.rua, (p.tipo||'')+' · '+(p.code||''))   /* drawerHead já escapa o sub — esc() aqui dobrava o & */
   + '<div style="height:150px;background:'+GRAD[(gi<0?0:gi)%GRAD.length]+';position:relative;flex-shrink:0;overflow:hidden">'+(p.capa?'<img src="'+esc(p.capa)+'" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 55%)"></div>':'')+'<span class="mono" style="position:absolute;bottom:12px;left:16px;color:#fff;font-weight:700;font-size:20px;text-shadow:0 1px 4px rgba(0,0,0,.3)">'+(p.preco?brlFull(p.preco)+(p.finalidadeRaw==='locacao'?'<span style="font-size:13px;font-weight:500">/mês</span>':''):'')+'</span><span class="pill" style="position:absolute;top:12px;left:16px;background:rgba(255,255,255,.92);color:var(--ink900)">'+p.finalidade+'</span></div>'
   + '<div class="fx g1" style="padding:2px 16px 0;border-bottom:1px solid var(--ink100);overflow-x:auto">'+tabs.map(t=>'<button class="tab'+(tab===t[0]?' active':'')+'" data-action="itab-'+t[0]+'">'+t[1]+'</button>').join('')+'</div>'
   + '<div class="grow scrolly" style="overflow:auto;padding:18px 20px">'+body+'</div>'
   + '<div class="fx g2" style="padding:14px 20px;border-top:1px solid var(--ink100)">'+(state.role==='broker'?'<button class="btn btn-outline sm nsh" data-action="imovel-excluir" data-imovel="'+esc(p.id)+'" data-rua="'+esc(p.rua||'')+'" style="color:var(--danger);border-color:var(--danger)">'+icon('trash-2',15)+'Excluir</button>':'')+'<button class="btn btn-outline sm grow" data-action="close-drawer">Fechar</button></div>';
}

/* ---------------- RELATÓRIOS ---------------- */
RENDERERS.relatorios=function(host){
  const corr=state.relCorretor;
  const uids=[...new Set(DEALS.map(d=>d.corretor).filter(Boolean))];
  const perc=uids.map(uid=>{ const ds=DEALS.filter(d=>d.corretor===uid); return {uid, nome:corrNome(uid), foto:corrFoto(uid), cor:(CORRETORES[uid]&&CORRETORES[uid].cor)||'#2563EB', vendas:ds.filter(d=>d.tipo==='Venda').length, loc:ds.filter(d=>d.tipo==='Locação').length, com:ds.reduce((s,d)=>s+(d.comValor||0),0), vgv:ds.filter(d=>d.tipo==='Venda').reduce((s,d)=>s+(d.valor||0),0)}; }).sort((a,b)=>b.com-a.com);
  const maxCom=Math.max(1,...perc.map(p=>p.com));
  const funil=[['Negócios ativos',KPI.ativos,'#2563EB'],['Em andamento',DEALS.filter(d=>['em_andamento','aguardando_corretor','aguardando_broker','aguardando_administrativo','negocio_criado'].includes(d.statusRaw)).length,'#7C3AED'],['Entregues',DEALS.filter(d=>d.statusRaw==='entregue_gestao').length,'#F59E0B'],['Concluídos',KPI.concluidos,'#16A34A']];
  const maxF=Math.max(1,...funil.map(f=>f[1]));
  function relKpi(label,val,sub,cor){ return '<div class="card" style="padding:18px"><div class="fz13 fw5 t500">'+label+'</div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:'+(cor||'var(--ink900)')+'">'+val+'</div><div class="fz12 t500" style="margin-top:4px">'+sub+'</div></div>'; }
  // Filtro por UID (o value), não por nome — dois corretores homônimos não se misturam.
  const nomes=[['Todos','Todos']].concat(perc.map(p=>[p.uid,p.nome]));
  const sel=(id,opts,val)=>'<select class="input" data-action="'+id+'" style="width:auto;background-color:var(--raised);border-color:var(--bd);color:#fff">'+opts.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===val?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';
  host.innerHTML=pageHead(hTitulo('Relatórios'),'Visão executiva da operação — comissões, produção e funil.', sel('relcorr',nomes,corr)+'<button class="btn btn-outline" data-action="export-rel">'+icon('download',16)+'Exportar</button>')
  + '<div class="grid4" style="margin-bottom:16px">'+relKpi('Comissão prevista',brl(KPI.comissaoPrevista),'Pipeline total','var(--ink900)')+relKpi('Comissão recebida',brl(KPI.comissaoRecebida),'Concluídos','var(--successtx)')+relKpi('Comissão pendente',brl(KPI.comissaoPendente),'A receber','var(--warningtx)')+relKpi('Negócios encerrados',KPI.encerradosMes,'No período','var(--ink900)')+'</div>'
  + '<div class="card" style="padding:20px;margin-bottom:16px"><div class="fz13 fw5 t500">Repasse aos corretores <span class="pill neutral" style="font-size:10px">estimado</span></div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:var(--ink900)">'+brlFull(KPI.pagoCorretores+KPI.pendenteCorretores)+'</div><div class="fx" style="margin-top:12px;height:8px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="width:'+((KPI.pagoCorretores+KPI.pendenteCorretores)?Math.round(KPI.pagoCorretores/(KPI.pagoCorretores+KPI.pendenteCorretores)*100):0)+'%;background:var(--success)"></div><div class="grow" style="background:rgba(245,158,11,.7)"></div></div><div class="fx jb" style="margin-top:8px;font-size:12px"><span class="c-suc fw6">Concluídos '+brl(KPI.pagoCorretores)+'</span><span class="c-war fw6">A receber '+brl(KPI.pendenteCorretores)+'</span></div><div class="fz11 t400" style="margin-top:8px">Valores estimados (45%/40% da comissão) — não é controle de pagamento.</div></div>'
  + '<div class="split" style="margin-bottom:16px">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Produção por corretor')+'<div style="padding:18px 20px;display:flex;flex-direction:column;gap:18px">'+(perc.length?perc.filter(p=>corr==='Todos'||p.uid===corr).map(p=>'<div><div class="fx ac g3" style="margin-bottom:8px">'+avatar(p.nome,34,'var(--ink800)',p.foto)+'<div class="grow"><div class="fz14 fw6 t900">'+esc(p.nome)+'</div><div class="fz12 t500">'+p.vendas+' vendas · '+p.loc+' locações · VGV '+brl(p.vgv)+'</div></div><div class="mono fw7 t900">'+brlFull(p.com)+'</div></div><div style="height:10px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(p.com/maxCom*100)+'%;background:'+p.cor+'"></div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:20px">Sem negócios no período.</div>')+'</div></div>'
    + '<div class="card" style="overflow:hidden">'+cardHead('Funil operacional')+'<div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">'+funil.map(f=>'<div><div class="fx jb fz12" style="margin-bottom:5px"><span class="t600 fw5">'+f[0]+'</span><span class="fw7 t900">'+f[1]+'</span></div><div style="height:10px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(f[1]/maxF*100)+'%;background:'+f[2]+'"></div></div></div>').join('')+'</div></div>'
  + '</div>'
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:620px"><thead><tr><th>Corretor</th><th class="tright">Vendas</th><th class="tright">Locações</th><th class="tright">VGV</th><th class="tright">Comissão</th></tr></thead><tbody>'+(perc.length?perc.map(p=>'<tr style="cursor:default"><td><div class="fx ac g2">'+avatar(p.nome,26,'var(--ink800)',p.foto)+'<span class="fw6 t900">'+esc(p.nome)+'</span></div></td><td class="tright fw6">'+p.vendas+'</td><td class="tright fw6">'+p.loc+'</td><td class="tright mono t700">'+brl(p.vgv)+'</td><td class="tright mono fw7 t900">'+brlFull(p.com)+'</td></tr>').join('')+'<tr style="cursor:default;background:var(--ink50)"><td class="fw7 t900">Total</td><td class="tright fw7">'+perc.reduce((s,p)=>s+p.vendas,0)+'</td><td class="tright fw7">'+perc.reduce((s,p)=>s+p.loc,0)+'</td><td class="tright mono fw7">'+brl(perc.reduce((s,p)=>s+p.vgv,0))+'</td><td class="tright mono fw7 t900">'+brlFull(perc.reduce((s,p)=>s+p.com,0))+'</td></tr>':'<tr><td colspan="5" class="tcenter t500" style="padding:24px">Sem dados no período.</td></tr>')+'</tbody></table></div></div>';
};

/* ---------------- CONFIGURAÇÕES ---------------- */
const CFG_TABS=[['usuarios','Usuários','users'],['permissoes','Permissões','shield'],['status','Status','flag'],['comissao','Tipos de comissão','percent'],['categorias','Categorias','tag'],['templates','Templates','file-text']];
function cfgPanel(k){
  const box=(title,inner)=>'<div class="card" style="overflow:hidden">'+cardHead(title)+'<div style="padding:6px 8px">'+inner+'</div></div>';
  if(k==='usuarios'){ const us=Object.values(CORRETORES); return box('Usuários do sistema', (us.length?us.map(u=>'<div class="fx ac g3" style="padding:12px;border-bottom:1px solid var(--ink100)">'+avatar(u.nome,38,u.cor,u.foto)+'<div class="grow mw0"><div class="fz14 fw6 t900">'+esc(u.nome)+'</div><div class="fz12 t500">REMAX SMART</div></div></div>').join(''):'<div class="fz13 t500" style="padding:12px">Carregando corretores…</div>')+'<div style="padding:12px"><div class="fz12 t500">Gerenciar usuários e permissões continua no Admin do Hub.</div></div>'); }
  if(k==='permissoes'){ const rows=[['Ver todos os negócios','Broker'],['Criar e editar negócios','Broker + Corretor'],['Aprovar comprador / locatário','Broker'],['Ver relatórios financeiros','Broker'],['Gerenciar usuários','Admin']]; return box('Matriz de permissões (resumo)', rows.map(r=>'<div class="fx ac jb" style="padding:11px 12px;border-bottom:1px solid var(--ink100)"><span class="fz13 fw5 t800">'+r[0]+'</span>'+pill(r[1],'neutral')+'</div>').join('')+'<div style="padding:12px" class="fz12 t500">As permissões granulares por pessoa são concedidas no Admin do Hub.</div>'); }
  if(k==='status'){ const st=allStatusReais(); return box('Status dos negócios','<div style="padding:12px;display:flex;flex-wrap:wrap;gap:8px">'+(st.length?st.map(s=>statusPill(s)).join(''):'<span class="fz13 t500">Sem negócios ainda.</span>')+'</div>'); }
  if(k==='comissao'){ return box('Tipos de comissão',[['Venda','6% sobre o valor da venda','percent','info'],['Locação','100% do primeiro aluguel','key-round','ai'],['Repasse corretor','45% ou 40% da comissão, conforme o corretor','users','success']].map(r=>'<div class="fx ac g3" style="padding:12px;border-bottom:1px solid var(--ink100)">'+iconChip(r[2],r[3],38)+'<div class="grow"><div class="fz14 fw6 t900">'+r[0]+'</div><div class="fz12 t500">'+r[1]+'</div></div></div>').join('')); }
  if(k==='categorias'){ const cats=[...new Set(PROPERTIES.map(p=>p.tipo).filter(Boolean))]; return box('Tipos de imóvel na carteira','<div style="padding:12px;display:flex;flex-wrap:wrap;gap:8px">'+(cats.length?cats.map(c=>'<span class="chip" style="cursor:default">'+esc(c)+'</span>').join(''):'<span class="fz13 t500">Nenhum tipo cadastrado.</span>')+'</div><div style="padding:0 12px 12px" class="fz12 t500">Tipos e cidades são configurados em Admin → SMART HUB configs.</div>'); }
  if(k==='templates'){ return box('Modelos de contrato',[['Contrato de representação (venda)','Venda · PDF'],['Contrato de locação','Locação · PDF']].map(t=>'<div class="fx ac g3" style="padding:12px;border-bottom:1px solid var(--ink100)">'+iconChip('file-text','danger',38)+'<div class="grow"><div class="fz14 fw6 t900">'+t[0]+'</div><div class="fz12 t500">'+t[1]+'</div></div></div>').join('')+'<div style="padding:12px" class="fz12 t500">O contrato de representação é gerado na tela do imóvel de venda.</div>'); }
  return '';
}
RENDERERS.configuracoes=function(host){
  const cur=state.cfgTab||'usuarios';
  host.innerHTML=pageHead('Configurações','Usuários, permissões e preferências operacionais. Ações de escrita continuam no Admin do Hub.')
  + '<div class="split-r" style="align-items:start">'
    + '<div class="card" style="padding:8px">'+CFG_TABS.map(t=>'<button class="fx ac g3" data-action="cfgtab-'+t[0]+'" style="width:100%;text-align:left;background:'+(cur===t[0]?'var(--infobg)':'none')+';border:none;border-radius:8px;padding:10px 12px;cursor:pointer;font-family:var(--sans)"><span style="color:'+(cur===t[0]?'var(--brand)':'var(--ink400)')+'">'+icon(t[2],17)+'</span><span class="fz14 fw'+(cur===t[0]?'6':'5')+'" style="color:'+(cur===t[0]?'var(--brand)':'var(--ink700)')+'">'+t[1]+'</span></button>').join('')+'</div>'
    + '<div>'+cfgPanel(cur)+'</div>'
  + '</div>';
};

// Busca global do topbar → filtra a lista da tela ativa (se ela tiver busca).
function globalFilter(v){
  const view=state.view;
  if(view==='negocios'){ state.negBusca=v; updateNegTable(); }
  else if(view==='pessoas'){ state.pessoasBusca=v; updatePessoas(); }
  else if(view==='imoveis'){ state.imoveisBusca=v; updateImoveis(); }
  else if(view==='clientes'){ state.cliBusca=v; if(typeof updateClientes==='function') updateClientes(); }
  else if(view==='leads'){ state.leadsBusca=v; updateLeads(); }
}

/* ============================ EVENTOS (escopados no #bkRoot) ============================ */
function wireEvents(root){
  root.addEventListener('click', e=>{
    // Clicar no backdrop fecha drawer/modal/gaveta. Delegado no `root` (persistente)
    // — o #overlay é recriado a cada mount, então um listener direto nele vazaria.
    if(e.target.id==='overlay'){ closeDrawer(); closeModal(); closeMobileNav(); return; }
    const nav=e.target.closest('[data-nav]'); if(nav){ navigate(nav.dataset.nav); return; }
    const ops=e.target.closest('[data-ops]'); if(ops){ const f=ops.dataset.ops; state.negFiltroStatus=(f&&f!=='Todos')?f:'Todos'; state.negView='tabela'; navigate('negocios'); return; }   // drill-down filtra por status → tabela (o quadro ignora esse filtro)
    const chk=e.target.closest('[data-chk]'); if(chk){ negAtualizar({negocioId:state.currentDeal, acao:'checklist', key:chk.dataset.chk, feito:chk.dataset.feito==='1'}); return; }
    // [data-action] ANTES das linhas container: um botão de ação dentro de uma
    // linha `data-deal` (ex.: Clicksign "Abrir"/"Reenviar") deve disparar a ação,
    // não abrir o detalhe da linha que o envolve.
    const act=e.target.closest('[data-action]'); if(act){ handleAction(act.dataset.action, act); return; }
    const deal=e.target.closest('[data-deal]'); if(deal){ openDeal(deal.dataset.deal); return; }
    const pers=e.target.closest('[data-person]'); if(pers){ openPerson(pers.dataset.person); return; }
    const pr=e.target.closest('[data-prop]'); if(pr){ openProp(pr.dataset.prop); return; }
  });
  // Kanban: arrastar card entre colunas (só broker). Delegado no root persistente.
  root.addEventListener('dragstart', e=>{ const c=e.target.closest('[data-kcard]'); if(!c||c.getAttribute('draggable')!=='true') return; state._dragDeal=c.dataset.kcard; c.classList.add('kdragging'); try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', c.dataset.kcard); }catch(_e){} });
  root.addEventListener('dragend', e=>{ state._dragDeal=null; const c=e.target.closest('[data-kcard]'); if(c) c.classList.remove('kdragging'); const r=ROOT(); if(r) r.querySelectorAll('.kcol-over').forEach(x=>x.classList.remove('kcol-over')); });
  root.addEventListener('dragover', e=>{ if(!state._dragDeal) return; const col=e.target.closest('[data-kdrop]'); if(!col) return; e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(_e){} col.classList.add('kcol-over'); });
  root.addEventListener('dragleave', e=>{ const col=e.target.closest('[data-kdrop]'); if(col && !col.contains(e.relatedTarget)) col.classList.remove('kcol-over'); });
  root.addEventListener('drop', e=>{ const col=e.target.closest('[data-kdrop]'); if(!col) return; e.preventDefault(); col.classList.remove('kcol-over'); const id=state._dragDeal; state._dragDeal=null; if(id) kanbanMove(id, col.dataset.kdrop); });
  root.addEventListener('input', e=>{
    if(e.target.matches('[data-money]')){ e.target.value=_maskMoeda(e.target.value); _syncPropostaTotal(); return; }  // máscara R$ ao digitar + soma do total da proposta
    // Busca do topbar (só visível na janela standalone; no Hub o topbar é escondido):
    // roteia pra busca da tela ativa em vez de ficar inerte.
    if(e.target.id==='globalSearch'){ globalFilter(e.target.value); return; }
    const t=e.target.closest('[data-input]'); if(!t) return; const k=t.dataset.input;
    if(k==='negBusca'){ state.negBusca=t.value; updateNegTable(); }
    else if(k==='pessoasBusca'){ state.pessoasBusca=t.value; updatePessoas(); }
    else if(k==='imoveisBusca'){ state.imoveisBusca=t.value; updateImoveis(); }
    else if(k==='cliBusca'){ state.cliBusca=t.value; if(typeof updateClientes==='function') updateClientes(); }
    else if(k==='leadsBusca'){ state.leadsBusca=t.value; updateLeads(); }
    else if(k==='leadVincBusca'){ state.leadVincBusca=t.value; updateLeadVinc(); }
  });
  root.addEventListener('change', e=>{
    // "Possui parceria? = Sim" → preenche a Taxa de comissão da Proposta com 3%
    // (comissão de parceria). A pessoa ainda clica Salvar na Proposta pra gravar.
    if(e.target && e.target.id==='cpParceria' && e.target.value==='sim'){ const c=$('#ppComPct'); if(c) c.value='3'; return; }
    const t=e.target.closest('select[data-action]'); if(!t)return; const a=t.dataset.action; if(a==='negstatus'){ state.negFiltroStatus=t.value; RENDERERS.negocios($('#root')); refreshIcons(); } else if(a==='relcorr'){ state.relCorretor=t.value; RENDERERS.relatorios($('#root')); refreshIcons(); } else if(a==='mesfiltro'){ state.mesFiltro=t.value; rerenderMes(); } else if(a==='imocorr'){ state.imoveisCorretor=t.value; RENDERERS.imoveis($('#root')); refreshIcons(); } else if(a==='negcorr'){ state.negCorretor=t.value; RENDERERS.negocios($('#root')); refreshIcons(); } else if(a==='pesscorr'){ state.pessoasCorretor=t.value; RENDERERS.pessoas($('#root')); refreshIcons(); } else if(a==='leadorigem'){ state.leadsOrigem=t.value; updateLeads(); } });
  document.addEventListener('keydown', e=>{ if(!ROOT()||ROOT().hidden) return; if(e.key==='Escape'){ closeDrawer(); closeModal(); closeMobileNav(); } else if(e.key==='Enter' && e.target && e.target.id==='bkTagInput'){ e.preventDefault(); _addTag(e.target.value); } });
}
function handleAction(a,el){
  if(a==='sair'){ unmount(); if(typeof state.onExit==='function') state.onExit(); }
  else if(a==='refresh'){ if(el) el.disabled=true; carregarDados().then(()=>{ toast('Atualizado','check-circle-2','var(--success)'); navigate(state.view); }).catch(()=>{ toast('Erro ao atualizar','alert-triangle','var(--warning)'); if(el) el.disabled=false; }); }
  else if(a==='negview'){ state.negView=el.dataset.v; if(state.negView==='kanban'){ state.negVerCancelados=false; state.negVerArquivados=false; } RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='negstatuschip'){ state.negFiltroStatus=el.dataset.v; RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='negverarquivados'){ state.negVerArquivados=!state.negVerArquivados; if(state.negVerArquivados) state.negVerCancelados=false; state.negFiltroStatus='Todos'; RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='negvercancelados'){ state.negVerCancelados=!state.negVerCancelados; if(state.negVerCancelados) state.negVerArquivados=false; state.negFiltroStatus='Todos'; RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='leadfiltro'){ state.leadsFiltro=el.dataset.v; const r=ROOT(); if(r) r.querySelectorAll('[data-action=leadfiltro]').forEach(b=>b.classList.toggle('active', b.dataset.v===el.dataset.v)); updateLeads(); }
  else if(a==='openlead'){ openLead(el.dataset.id); }
  else if(a==='lead-verimovel'){ openProp(el.dataset.id); }
  else if(a==='lead-vincular'){ openLeadVincular(el.dataset.id); }
  else if(a==='lead-desvincular'){ leadsDesvincular(el.dataset.id); }
  else if(a==='lead-vincular-do'){ leadsVincularDo(el.dataset.lead, el.dataset.imovel, el.dataset.codigo, el.dataset.end); }
  else if(a==='novo-imovel-manual'){ openNovoImovelManual(); }
  else if(a==='novo-imovel-save'){ salvarNovoImovel(); }
  else if(a==='feed-sync'){ sincronizarFeedPortal(el); }
  else if(a==='conc-excel'){ concExportarExcel(); }
  else if(a==='conc-baixar'){ concBaixarPagina(+el.dataset.pag, el.dataset.nome); }
  else if(a==='mobilenav') openMobileNav();
  else if(a==='mobilenav-close') closeMobileNav();
  else if(a==='close-drawer') closeDrawer();
  else if(a==='close-modal') closeModal();
  else if(a==='negtipo'){ state.negFiltroTipo=el.dataset.v; RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='pesstipo'){ state.pessoasFiltro=el.dataset.v; RENDERERS.pessoas($('#root')); refreshIcons(); }
  else if(a==='pessview'){ state.pessoasView=el.dataset.v; RENDERERS.pessoas($('#root')); refreshIcons(); }
  else if(a==='imotipo'){ state.imoveisFiltro=el.dataset.v; RENDERERS.imoveis($('#root')); refreshIcons(); }
  else if(a==='imoview'){ state.imoveisView=el.dataset.v; RENDERERS.imoveis($('#root')); refreshIcons(); }
  else if(a==='imosort'){ state.imoveisSort = state.imoveisSort==='antigo'?'recente':'antigo'; RENDERERS.imoveis($('#root')); refreshIcons(); }
  else if(a.indexOf('dealtab-')===0){ state.dealTab=a.slice(8); openDeal(state.currentDeal, {tabsOnly:true}); }
  else if(a.indexOf('ptab-')===0){ state.pessoaTab=a.slice(5); openPerson(state.currentPerson); }
  else if(a.indexOf('itab-')===0){ state.imovelTab=a.slice(5); openProp(state.currentProp); }
  else if(a.indexOf('cfgtab-')===0){ state.cfgTab=a.slice(7); RENDERERS.configuracoes($('#root')); refreshIcons(); }
  else if(a==='add-coment'){ const ta=$('#bkComent'); const txt=ta?ta.value.trim():''; if(!txt){ toast('Escreva algo primeiro','alert-triangle','var(--warning)'); return; } el.disabled=true; const resp=state.respondendo; const payload={negocioId:state.currentDeal, acao:'comentario', texto:txt}; if(resp&&resp.id) payload.respostaDe=resp.id; state.respondendo=null; if(ta) ta.value=''; /* limpa ANTES: senão o restore de rascunho do negAtualizar re-injeta o texto já enviado = comentário duplicado */ negAtualizar(payload, resp?'Resposta enviada':'Comentário adicionado').then(ok=>{ if(ok===false){ const t2=$('#bkComent'); if(t2) t2.value=txt; if(resp) state.respondendo=resp; } /* falhou: devolve o texto e o contexto */ }).finally(()=>{ try{ el.disabled=false; }catch(_e){} }); }
  else if(a==='coment-responder'){ state.respondendo={id:el.dataset.id, nome:el.dataset.nome||'', deal:state.currentDeal}; state.dealTab='comentarios'; openDeal(state.currentDeal, {tabsOnly:true}); setTimeout(()=>{ const t=$('#bkComent'); if(t) t.focus(); },60); }
  else if(a==='cancelar-resposta'){ state.respondendo=null; openDeal(state.currentDeal); }
  else if(a==='coment-editar'){ openEditarComent(el.dataset.id, el.dataset.texto||''); }
  else if(a==='coment-editar-salvar'){ const t=$('#edComentTxt'); const txt=t?t.value.trim():''; if(!txt){ toast('Escreva algo','alert-triangle','var(--warning)'); return; } el.disabled=true; closeModal(); negAtualizar({negocioId:state.currentDeal, acao:'comentario_editar', comentarioId:el.dataset.id, texto:txt}, 'Comentário editado'); }
  else if(a==='tag-preset'){ _addTag(el.dataset.tag); }
  else if(a==='tag-add'){ const inp=$('#bkTagInput'); _addTag(inp?inp.value:''); }
  else if(a==='tag-remove'){ _saveTags(_curDealTags().filter(x=>x!==el.dataset.tag)); }
  else if(a==='tarefa-add'){ const tx=$('#bkTarefaTxt'), pz=$('#bkTarefaPrazo'); const texto=tx?tx.value.trim():''; if(!texto){ toast('Descreva a tarefa','alert-triangle','var(--warning)'); return; } const prazo=pz?pz.value:''; if(tx) tx.value=''; if(pz) pz.value=''; /* limpa ANTES (mesmo motivo do add-coment) */ negAtualizar({negocioId:state.currentDeal, acao:'tarefa', texto, prazo}, 'Tarefa adicionada').then(ok=>{ if(ok===false){ const t2=$('#bkTarefaTxt'); if(t2) t2.value=texto; } }); }
  else if(a==='tarefa-check'){ negAtualizar({negocioId:state.currentDeal, acao:'tarefa_check', tarefaId:el.dataset.tid, feito:el.dataset.feito==='1'}); }
  else if(a==='tarefa-rm'){ if(!confirm('Remover esta tarefa?')) return; negAtualizar({negocioId:state.currentDeal, acao:'tarefa_rm', tarefaId:el.dataset.tid}); }
  else if(a==='abrir-termos'){ const url=FICHA_HOST+'/termos.html'; if(window.hubApi&&window.hubApi.abrirFicha){ window.hubApi.abrirFicha(url,'Termos de Uso'); } else { window.open(url,'_blank'); } }
  else if(a==='sem-drive'||a==='drive-set'){ openDriveModal(el.dataset.cur||''); }
  else if(a==='drive-save'){
    const u=(($('#drvUrl')||{}).value||'').trim(); const errEl=$('#drvErr');
    if(u && !/^https:\/\//i.test(u)){ if(errEl) errEl.textContent='Cole um link válido (começa com https://).'; return; }
    closeModal(); negAtualizar({negocioId:state.currentDeal, acao:'drive', url:u}, u?'Link do Drive salvo':'Link do Drive removido');
  }
  else if(a==='export-rel'){
    let ds=DEALS.slice(); const corr=state.relCorretor;
    if(corr && corr!=='Todos') ds=ds.filter(d=>d.corretor===corr);   // filtro por uid (value do select)
    if(!ds.length){ toast('Sem negócios para exportar','alert-triangle','var(--warning)'); return; }
    const head=['Código','Tipo','Cliente','Imóvel','Bairro/Cidade','Corretor','Status','Valor','Comissão','Progresso %','Dias parado','Próxima ação'];
    const linhas=[head].concat(ds.map(d=>{ const im=propDoDeal(d)||{}; return [d.code,d.tipo,d.clienteNome,im.rua||'',im.bairro||d.cidade||'',corrNome(d.corretor),d.status,d.valor||0,d.comValor||0,d.progresso||0,d.diasParado||0,d.prox||'']; }));
    baixarTexto(montarCSV(linhas),'relatorio-negocios-'+new Date().toISOString().slice(0,10)+'.csv','text/csv');
    toast('Relatório exportado (CSV)','download','var(--success)');
  }
}
// Modal pra vincular/editar o link da pasta do Google Drive do negócio (ação `drive`).
function openDriveModal(cur){
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:6px">Link da pasta do Drive</div><div class="fz12 t500" style="margin-bottom:12px">Cole o link da pasta do Google Drive deste negócio (deixe em branco para remover).</div>'
    +'<input id="drvUrl" class="input" placeholder="https://drive.google.com/…" value="'+esc(cur||'')+'" style="margin-bottom:6px">'
    +'<div id="drvErr" class="fz12" style="color:#dc2626;min-height:16px"></div>'
    +'<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="drive-save">'+icon('check',15)+'Salvar</button></div></div>');
}
// ── Campos personalizados + Proposta (pedido Marcelo) ────────────────────────
// Card "Informações do negócio": selects por tipo, salvos pela ação `campos`.
function camposCardHTML(d){
  const c=d.campos||{}; const ehVenda=d.tipo==='Venda';
  const enc=(d.statusRaw==='concluido'||d.statusRaw==='cancelado');   // encerrado = leitura (o servidor recusaria o Salvar)
  const sel=(id,cur,opts)=>'<select id="'+id+'" class="input nsh"'+(enc?' disabled':'')+' style="width:100%">'+opts.map(o=>'<option value="'+o[0]+'"'+(cur===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>';
  const SN=[['','Selecione…'],['sim','Sim'],['nao','Não']];
  const CRV=[['','Selecione…'],['parcela1','1ª parcela'],['parcela2','2ª parcela'],['total','Recebido total']];
  const campo=(rot,inner)=>'<div class="grow" style="min-width:170px"><div class="fz11 fw6 t700 up" style="margin-bottom:4px">'+rot+'</div>'+inner+'</div>';
  const inp=(id,val,ph)=>'<input id="'+id+'" class="input nsh"'+(enc?' disabled':'')+' value="'+esc(val||'')+'" placeholder="'+esc(ph||'')+'" maxlength="120" style="width:100%">';
  const linha = ehVenda
    ? campo('Possui parceria?', sel('cpParceria', c.parceria||'', SN)) + campo('Imobiliária parceira (nome)', inp('cpParceiraNome', c.imobiliariaParceira, 'Se houver parceria')) + campo('Possui referenciamento?', sel('cpRef', c.referenciamento||'', SN)) + campo('Comissão recebida', sel('cpComRec', c.comissaoRecebida||'', CRV))
    : campo('Possui administração?', sel('cpAdm', c.administracao||'', SN)) + campo('Possui parceria?', sel('cpParceria', c.parceria||'', SN)) + campo('Comissão recebida?', sel('cpComRec', c.comissaoRecebida||'', SN));
  return '<div class="card" style="padding:18px;margin-bottom:16px"><div class="fx ac jb g2" style="margin-bottom:12px"><div class="up fz12 fw7 t800">Informações do negócio'+(enc?' <span class="fz11 t500 fw5">(encerrado — leitura)</span>':'')+'</div>'+(enc?'':'<button class="btn btn-primary sm nsh" data-action="campos-salvar">'+icon('check',14)+'Salvar</button>')+'</div><div class="fx g3 wrap">'+linha+'</div></div>';
}
// Card "Proposta": inputs por tipo, salvos pela ação `proposta` (texto livre).
// Máscara de moeda "R$ 2.500" / "R$ 2.500,50" (milhar automático). Idempotente: reaplica
// sobre o próprio valor já formatado (o strip tira o "R$" e os pontos antes de refazer).
function _maskMoeda(v){
  v = String(v).replace(/[^\d,]/g, '');
  if(!v) return '';
  const parts = v.split(',');
  const ints = (parts[0].replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + ints + (v.indexOf(',') >= 0 ? (',' + parts.slice(1).join('').slice(0, 2)) : '');
}
// Recalcula o "Valor total" da proposta ao vivo (soma dos campos de moeda da venda) — é a
// base da comissão. No-op se o campo #ppTotal não estiver na tela (ex.: proposta de locação).
function _syncPropostaTotal(){ const el=document.getElementById('ppTotal'); if(!el) return; let s=0; ['ppSinal','ppParcelaA','ppParcelaB','ppFgtsValor','ppFinanciamento'].forEach(id=>{ const e=document.getElementById(id); if(e) s+=parseMoney(e.value||0); }); el.value = s>0 ? _maskMoeda(String(s)) : ''; }
function propostaCardHTML(d){
  const p=d.proposta||{}; const ehVenda=d.tipo==='Venda';
  const enc=(d.statusRaw==='concluido'||d.statusRaw==='cancelado');   // encerrado = leitura (o servidor recusaria o Salvar)
  const dis=enc?' disabled':'';
  // Data nativa (sem digitar a barra); converte valor antigo dd/mm/aaaa pra ISO do input.
  const _iso=v=>{ if(!v)return''; if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v; const m=String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m?m[3]+'-'+m[2]+'-'+m[1]:''; };
  const dtN=(id,val)=>'<input id="'+id+'" type="date" class="input nsh" value="'+esc(_iso(val))+'"'+dis+' style="width:100%">';
  const money=(id,val,ph)=>'<input id="'+id+'" class="input nsh" data-money value="'+esc(val?_maskMoeda(val):'')+'" placeholder="'+esc(ph||'')+'" inputmode="decimal" maxlength="22"'+dis+' style="width:100%">';  // R$ automático (máscara delegada)
  const unidade=(id,val,ph,un)=>'<div class="fx ac" style="width:100%"><input id="'+id+'" class="input nsh" value="'+esc(val||'')+'" placeholder="'+esc(ph||'')+'" inputmode="decimal" maxlength="12"'+dis+' style="flex:1 1 0;min-width:0;width:auto;border-radius:8px 0 0 8px;border-right:none"><span class="nsh" style="flex:none;padding:0 12px;align-self:stretch;display:flex;align-items:center;background:var(--ink100);border:1px solid var(--ink200);border-radius:0 8px 8px 0;color:var(--ink600);font-size:13px;white-space:nowrap">'+un+'</span></div>';
  const campo=(rot,inner)=>'<div class="grow" style="min-width:160px;max-width:240px"><div class="fz11 fw6 t700 up" style="margin-bottom:4px">'+rot+'</div>'+inner+'</div>';
  const _totProp=_propostaTotal(p); const _totFmt=_totProp>0?_maskMoeda(String(_totProp)):'';
  const corpo = (ehVenda
    ? campo('Valor do sinal (R$)', money('ppSinal', p.sinal, 'Ex.: 50.000'))
      + campo('Sinal pago em', dtN('ppSinalData', p.sinalData))
      + campo('Parcela A (R$)', money('ppParcelaA', p.parcelaA, 'Ex.: 100.000'))
      + campo('Parcela A paga em', dtN('ppParcelaAData', p.parcelaAData))
      + campo('Parcela B (R$)', money('ppParcelaB', p.parcelaB, 'Ex.: 100.000'))
      + campo('Parcela B paga em', dtN('ppParcelaBData', p.parcelaBData))
      + campo('Possui FGTS?', '<select id="ppFgts" class="input nsh"'+dis+' style="width:100%"><option value=""'+(!p.fgts?' selected':'')+'>Selecione…</option><option value="sim"'+(p.fgts==='sim'?' selected':'')+'>Sim</option><option value="nao"'+(p.fgts==='nao'?' selected':'')+'>Não</option></select>')
      + campo('Valor do FGTS (R$)', money('ppFgtsValor', p.fgtsValor, 'Se sim'))
      + campo('Financiamento (R$)', money('ppFinanciamento', p.financiamento, 'Ex.: 350.000'))
      + campo('Valor total da proposta (R$)', '<input id="ppTotal" class="input nsh" value="'+esc(_totFmt)+'" readonly placeholder="Soma automática" title="Sinal + parcelas + FGTS + financiamento — base da comissão" style="width:100%;font-weight:700;background:var(--ink100)">')
    : campo('Início do contrato', dtN('ppInicio', p.inicio))
      + campo('Valor acordado (R$)', money('ppValorAcordado', p.valorAcordado, 'Ex.: 2.500'))
      + campo('Prazo do contrato', unidade('ppPrazo', p.prazo, 'Ex.: 30', 'meses'))
      + campo('Taxa de administração', unidade('ppTaxaAdm', p.taxaAdm, '8', '%')))
    + campo('Taxa de comissão (%)', unidade('ppComPct', (d.comPct!=null?String(d.comPct):''), ehVenda?'6':'100', '%'));
  return '<div class="card" style="padding:18px;margin-bottom:16px"><div class="fx ac jb g2" style="margin-bottom:12px"><div class="up fz12 fw7 t800">Proposta'+(enc?' <span class="fz11 t500 fw5">(encerrado — leitura)</span>':'')+'</div>'+(enc?'':'<button class="btn btn-primary sm nsh" data-action="proposta-salvar">'+icon('check',14)+'Salvar</button>')+'</div><div class="fx g3 wrap">'+corpo+'</div>'+(!enc?'<div class="fz11 t500" style="margin-top:10px">'+(d.tipo!=='Venda'?'A comissão da locação é calculada sobre o <b>Valor acordado</b> (o aluguel negociado). Taxa de administração padrão 8% — edite se for negociada.':'O <b>valor total</b> é a soma automática (sinal + parcelas + FGTS + financiamento) e é a base do cálculo da comissão.')+'</div>':'')+'</div>';
}
// Card "Distribuição da comissão" (venda): mostra em R$ quanto vai pra cada parte.
// Base = "parte REMAX" = comValor (taxa × valor; com parceria a taxa cai pra 3%).
// A imobiliária parceira leva a MESMA metade (50/50 da comissão do cliente); o
// referenciamento = 12,5% da comissão TOTAL do cliente e sai da REMAX Smart (o
// corretor recebe os 45% cheios — decisão do Nathan). Corretor % = repasse dele (45/40).
function distribuicaoCardHTML(d){
  if(d.tipo!=='Venda' || !(d.comValor>0)) return '';
  const c=d.campos||{};
  const V=d.valor||0;
  const parteRemax=d.comValor||0;
  const temParceria=c.parceria==='sim';
  const temRef=c.referenciamento==='sim';
  const comParceira=temParceria ? parteRemax : 0;   // parceira = mesma metade que a REMAX
  const comTotal=parteRemax+comParceira;             // comissão do cliente (bruta)
  const ref=temRef ? comTotal*0.125 : 0;
  const corPct=repassePct(d.corretor);               // 0,45 ou 0,40 (por corretor)
  const corretorV=parteRemax*corPct;
  const remaxV=parteRemax*(1-corPct)-ref;
  const fp=x=> V>0 ? (Math.round(x/V*1000)/10).toString().replace('.',',') : '0';
  const row=(rot,sub,val,forte)=>'<div class="fx ac jb g2" style="padding:9px 0;border-top:1px solid var(--ink100)"><div class="mw0"><div class="fz13 '+(forte?'fw7 t900':'fw6 t800')+' trunc">'+rot+'</div>'+(sub?'<div class="fz11 t500 trunc">'+sub+'</div>':'')+'</div><div class="mono fw7 '+(forte?'t900':'t800')+' nsh">'+brlFull(val)+'</div></div>';
  let linhas=row('Comissão total (cliente)', fp(comTotal)+'% · '+brlFull(V), comTotal, true);
  if(temParceria) linhas+=row('Imobiliária parceira'+(c.imobiliariaParceira?' — '+esc(c.imobiliariaParceira):''), fp(comParceira)+'% do valor', comParceira);
  linhas+=row('Corretor'+(d.corretorNome?' — '+esc(d.corretorNome):''), Math.round(corPct*100)+'% da parte REMAX', corretorV);
  linhas+=row('REMAX Smart', Math.round((1-corPct)*100)+'% da parte REMAX'+(temRef?' − referenciamento':''), remaxV);
  if(temRef) linhas+=row('Taxa de referenciamento', '12,5% dos '+fp(comTotal)+'% totais', ref);
  return '<div class="card" style="padding:18px;margin-bottom:16px"><div class="up fz12 fw7 t800" style="margin-bottom:6px">Distribuição da comissão</div>'+linhas+'<div class="fz11 t400" style="margin-top:8px">Cálculo automático a partir do valor da proposta, da parceria e do referenciamento. Valor estimado — vale o acerto oficial.</div></div>';
}

// Modal pra editar o % de comissão do negócio (ação `comissao`). Venda: padrão 6%,
// parceria 3%, negociadas 4/5%. Locação: padrão 100%.
function openComissaoModal(){
  const d=DEALS.find(x=>x.id===state.currentDeal)||(DEALS_DOCS||[]).find(x=>x.id===state.currentDeal); if(!d) return;
  openModal('<div style="padding:20px;max-width:380px"><div class="fz15 fw7 t900" style="margin-bottom:6px">Comissão do negócio</div><div class="fz12 t500" style="margin-bottom:12px">'+(d.tipo==='Venda'?'Padrão 6% — parceria cai pra 3%; negociadas podem ser 4 ou 5%.':'Locação: padrão 100% do valor do aluguel.')+' Digite 0 pra voltar ao padrão.</div>'
    +'<div class="fz11 fw6 t700 up" style="margin-bottom:4px">Percentual (%)</div>'
    +'<input id="comPctInp" class="input" inputmode="decimal" maxlength="6" style="margin-bottom:4px">'
    +'<div id="comPctErr" class="fz12" style="color:#dc2626;min-height:16px"></div>'
    +'<div class="fx g2" style="margin-top:10px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="comissao-salvar">'+icon('check',15)+'Salvar</button></div></div>');
  const t=document.getElementById('comPctInp'); if(t){ t.value=String(d.comPct||''); t.focus(); t.select(); }
}
// Modal pra editar a origem do cliente (ação `origem`). O texto é setado via JS.
function openOrigemModal(cur){
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:6px">Origem do cliente</div><div class="fz12 t500" style="margin-bottom:12px">De onde veio esse cliente? (ex.: Instagram, Indicação, Portal, Placa, WhatsApp…)</div>'
    +'<input id="origemInp" class="input" maxlength="120" placeholder="Ex.: Indicação da Maria" style="margin-bottom:6px">'
    +'<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="origem-salvar">'+icon('check',15)+'Salvar</button></div></div>');
  const t=document.getElementById('origemInp'); if(t){ t.value=cur||''; t.focus(); }
}
// Modal pra editar um comentário próprio (ação `comentario_editar`). O texto é setado
// via JS (não no HTML) pra não escapar aspas/quebras de linha.
function openEditarComent(id, texto){
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:8px">Editar comentário</div>'
    +'<textarea id="edComentTxt" class="input" rows="3" maxlength="1000" style="margin-bottom:6px"></textarea>'
    +'<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="coment-editar-salvar" data-id="'+esc(id)+'">'+icon('check',15)+'Salvar</button></div></div>');
  const t=document.getElementById('edComentTxt'); if(t){ t.value=texto; t.focus(); }
}
// Modal com as informações do proprietário do imóvel do negócio aberto.
function openProprietario(){
  const d=DEALS.find(x=>x.id===state.currentDeal)||(DEALS_DOCS||[]).find(x=>x.id===state.currentDeal); if(!d) return;
  const imv=PROPERTIES.find(p=>p.id===d.imovelId);
  const nome=(imv&&imv.proprietarioNome&&imv.proprietarioNome!=='—')?imv.proprietarioNome:'';
  const contato=(imv&&imv.proprietarioContato)||'';
  const fichaId=(imv&&imv.raw&&imv.raw.fichaId)||''; const fichaTipo=(imv&&imv.raw&&imv.raw.fichaTipo)||'';
  // Sem ficha vinculada → botão pra ENVIAR a ficha do proprietário (vendedor na venda,
  // locador na locação; venda_locacao mostra os dois). O link vai amarrado ao imóvel
  // (&imovelId=): a ficha enviada PREENCHE este card — não cria imóvel novo (trigger).
  const fin=(imv&&imv.finalidadeRaw)||'locacao';
  const btnFicha=(arq,rot)=>'<button class="btn btn-outline sm" data-action="prop-ficha-link" data-arq="'+arq+'" data-imovel="'+esc(d.imovelId)+'" style="width:100%;margin-bottom:8px">'+icon('clipboard-list',14)+rot+'</button>';
  const btnVincular='<button class="btn btn-outline sm" data-action="prop-vincular" data-imovel="'+esc(d.imovelId)+'" data-fin="'+esc(fin)+'" style="width:100%;margin-bottom:8px">'+icon('link',14)+'Vincular uma ficha já existente</button>';
  const enviarFicha = fichaId ? '' :
      ((fin==='venda' ? btnFicha('ficha-vendedor.html','Copiar link — ficha do vendedor')
    : fin==='venda_locacao' ? btnFicha('ficha-vendedor.html','Copiar link — ficha do vendedor')+btnFicha('ficha-locador.html','Copiar link — ficha do locador')
    : btnFicha('ficha-locador.html','Copiar link — ficha do locador'))
    + btnVincular);
  openModal('<div style="padding:20px;min-width:320px;max-width:420px">'
    + '<div class="fz15 fw7 t900 fx ac g2" style="margin-bottom:14px">'+icon('user-round',18)+'Proprietário do imóvel</div>'
    + (nome ? '<div class="fx ac g3" style="margin-bottom:14px">'+avatar(nome,42,'var(--ink800)')+'<div class="mw0"><div class="fz15 fw6 t900 trunc">'+esc(nome)+'</div>'+(contato?'<div class="fz13 t500 trunc">'+esc(contato)+'</div>':'<div class="fz12 t400">sem contato cadastrado</div>')+'</div></div>'
        + (contato?'<button class="btn btn-outline sm" data-action="copiar-fone" data-valor="'+esc(contato)+'" style="width:100%;margin-bottom:8px">'+icon('copy',14)+'Copiar contato</button>':'')
        + (fichaId?'<button class="btn btn-outline sm" data-action="int-ver-ficha" data-ficha="'+esc(fichaId)+'" data-tipo="'+esc(fichaTipo)+'" style="width:100%;margin-bottom:8px">'+icon('file-text',14)+'Ver ficha do proprietário</button>':'')
        + enviarFicha
      : '<div class="pc-vazio" style="margin-bottom:12px">Proprietário não informado neste imóvel.</div>'
        + '<div class="fz12 t500" style="margin-bottom:10px">Envie a ficha ao proprietário — quando ele preencher, os dados entram neste imóvel (não cria um imóvel novo).</div>'
        + enviarFicha)
    + '<button class="btn btn-primary sm" data-action="close-modal" style="width:100%">Fechar</button></div>');
}
// Picker de fichas de proprietário (vendedor/locador) já existentes, pra vincular ao imóvel.
function openVincularProp(imovelId, fin){
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:4px">Vincular ficha do proprietário</div><div class="fz12 t500" style="margin-bottom:14px">Escolha uma ficha '+(fin==='venda'?'de vendedor':fin==='venda_locacao'?'de vendedor ou locador':'de locador')+' já cadastrada. Os dados entram neste imóvel.</div><div id="propPickList" class="fz13 t500" style="max-height:52vh;overflow:auto">Carregando fichas…</div><div class="fx" style="margin-top:16px"><button class="btn btn-outline sm grow" data-action="close-modal">Fechar</button></div></div>');
  fnFichasProp({ finalidade: fin }).then(r=>{
    const list=(r.data||[]); const el=$('#propPickList'); if(!el) return;
    if(!list.length){ el.innerHTML='<div class="tcenter t500" style="padding:20px">Nenhuma ficha de proprietário encontrada no Cadastro.</div>'; return; }
    el.innerHTML=list.map(f=>'<div class="fx ac jb g2" style="padding:10px 0;border-top:1px solid var(--ink100)"><div class="mw0"><div class="fz13 fw6 t900 trunc">'+esc(f.nome)+' <span class="pill '+(f.tipo==='vendedor'?'info':'ai')+'" style="font-size:10px">'+(f.tipo==='vendedor'?'Vendedor':'Locador')+'</span></div><div class="fz12 t500 trunc">'+esc([f.cpf,f.telefone].filter(Boolean).join(' · ')||'—')+'</div></div><button class="btn btn-primary sm nsh" data-action="prop-vincular-do" data-imovel="'+esc(imovelId)+'" data-ficha="'+esc(f.id)+'" data-tipo="'+esc(f.tipo)+'">'+icon('link',13)+'Vincular</button></div>').join('');
    refreshIcons();
  }).catch(e=>{ const el=$('#propPickList'); if(el) el.innerHTML='<div class="tcenter t500" style="padding:20px">Erro ao carregar: '+esc(e.message||'')+'</div>'; });
}
async function vincularProprietario(imovelId, fichaId, tipo){
  const btn=document.querySelector('[data-action="prop-vincular-do"][data-ficha="'+fichaId+'"]'); if(btn){ btn.disabled=true; btn.innerHTML='...'; }
  try{
    const r=await fnVincularProp({ imovelId, fichaId, tipo });
    closeModal(); toast('✅ Proprietário vinculado'+((r.data&&r.data.nome)?': '+r.data.nome:'')+'.','check','var(--success)');
    // recarrega os caches na hora (sem depender do broadcast) — reabrir o modal
    // "Proprietário" logo em seguida já mostra o vínculo novo
    try{ await carregarDados(); if(RENDERERS[state.view] && !state._viewingDeal){ RENDERERS[state.view]($('#root')); refreshIcons(); } }catch(_e){}
  }catch(e){ if(btn){ btn.disabled=false; btn.innerHTML=icon('link',13)+'Vincular'; refreshIcons(); } toast(e.message||'Erro ao vincular','alert-triangle','var(--danger)'); }
}
// Menu "+ Novo" do corretor — abre os atalhos (que já existem como ações).
function openNovoMenu(){
  const item=(act,ico,tit,sub)=>'<button class="fx ac g3 hoverbg" data-action="'+act+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:12px;cursor:pointer;margin-bottom:8px">'+iconChip(ico,'brand',38)+'<div class="grow mw0"><div class="fz14 fw6 t900">'+tit+'</div><div class="fz12 t500">'+sub+'</div></div></button>';
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:14px">Criar novo</div>'
    +item('novo-cliente','user-plus','Novo Cliente','Envie uma ficha — o cliente nasce dela')
    +item('novo-imovel','building-2','Novo Imóvel','Ficha de vendedor/locador vira imóvel')
    +item('enviar-ficha','clipboard-list','Enviar Ficha','Escolha o tipo na seção Fichas digitais')
    +item('agendar-visita','calendar','Agendar Visita','Abre a Agenda do Hub')
    +'<button class="btn btn-outline sm" data-action="close-modal" style="width:100%;margin-top:2px">Fechar</button></div>');
}
// Modal de upload de documento avulso pra um imóvel (função carteiraAnexarDoc).
function openImovelDocUpload(imovelId){
  if(!imovelId){ toast('Abra um imóvel primeiro','alert-triangle','var(--warning)'); return; }
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:14px">Adicionar documento ao imóvel</div>'
    +'<input type="hidden" id="imDocId" value="'+esc(imovelId)+'">'
    +'<div class="fz12 fw6 t700" style="margin-bottom:4px">Arquivo <span class="t500">(PDF, imagem ou documento, até 20MB)</span></div><input id="imDocFile" type="file" accept="'+_DOC_ACCEPT+'" class="input" style="margin-bottom:6px">'
    +'<div id="imDocErr" class="fz12" style="color:#dc2626;min-height:16px"></div>'
    +'<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="imovel-doc-send">'+icon('upload',15)+'Enviar</button></div></div>');
}

/* Rerender pessoas carrega a lista sob demanda ao entrar na aba */
const _origPessoas = RENDERERS.pessoas;
RENDERERS.pessoas = function(host){ _origPessoas(host); if(!PEOPLE.length){ carregarPessoas().then(()=>{ if(state.view==='pessoas'){ const h=$('#root'); if(h){ _origPessoas(h); refreshIcons(); } } else if(state.view==='clientes'){ updatePessoas(); } }); } };

/* ============================================================================
   PAPÉIS — Corretor e Administrativo (além do Broker/gestor).
   O mesmo app serve os 3; o backend já filtra por papel (corretor só o dele,
   administrativo/gestor veem tudo). Aqui muda o MENU e algumas telas próprias.
   Mockups do Nathan: "Corretor (offline)" e "Administrativo (offline)".
   ============================================================================ */
function roleLabel(){ return {broker:'Broker', corretor:'Corretor', administrativo:'Administrativo'}[state.role] || 'Broker'; }

// Menu por papel. Broker = NAVITEMS (já definido). Corretor/Administrativo abaixo.
const NAV_ROLE = {
  broker: NAVITEMS,
  corretor: [
    {id:'dashboard',ico:'layout-dashboard',label:'Dashboard'},
    {id:'leads',ico:'inbox',label:'Leads'},
    {id:'clientes',ico:'users',label:'Meus Clientes'},
    {id:'imoveis',ico:'building-2',label:'Meus Imóveis'},
    {id:'negocios',ico:'handshake',label:'Meus Negócios'},
    {id:'agenda',ico:'calendar',label:'Agenda'},
    {id:'documentos',ico:'folder',label:'Documentos'},
    {id:'comissoes',ico:'wallet',label:'Minhas Comissões'},
    {id:'perfil',ico:'user',label:'Meu Perfil'},
  ],
  administrativo: [
    {id:'dashboard',ico:'layout-dashboard',label:'Dashboard'},
    {id:'leads',ico:'inbox',label:'Leads'},
    {id:'fila',ico:'kanban',label:'Fila de Trabalho'},
    {id:'pessoas',ico:'users',label:'Pessoas'},
    {id:'imoveis',ico:'building-2',label:'Imóveis'},
    {id:'negocios',ico:'handshake',label:'Negócios'},
    {id:'documentos',ico:'folder',label:'Documentos'},
    {id:'clicksign',ico:'file-signature',label:'Clicksign'},
    {id:'drive',ico:'hard-drive',label:'Google Drive'},
    {id:'agenda',ico:'calendar',label:'Agenda'},
    {id:'relatorios',ico:'clipboard-list',label:'Relatórios Operacionais'},
    {id:'conciliacao',ico:'clipboard-check',label:'Conciliação'},
    {id:'perfil',ico:'user',label:'Meu Perfil'},
  ],
};
renderNav = function(target){ if(!target) return; const items=NAV_ROLE[state.role]||NAV_ROLE.broker; target.innerHTML=items.map(n=>'<button class="navitem'+(state.view===n.id?' active':'')+'" data-nav="'+n.id+'">'+icon(n.ico,18)+n.label+'</button>').join(''); };
Object.assign(CRUMB, {
  clientes:['SMART HUB','Meus Clientes'], comissoes:['SMART HUB','Minhas Comissões'], perfil:['SMART HUB','Meu Perfil'],
  fila:['SMART HUB','Fila de Trabalho'], documentos:['SMART HUB','Documentos'],
  agenda:['SMART HUB','Agenda'], clicksign:['SMART HUB','Clicksign'], drive:['SMART HUB','Google Drive'],
});

// Título por papel/tela (Meus Imóveis, Meus Negócios, Meus Clientes, Relatórios Operacionais).
function hTitulo(base){
  const r=state.role, v=state.view;
  if(r==='corretor'){ if(v==='imoveis') return 'Meus Imóveis'; if(v==='negocios') return 'Meus Negócios'; if(v==='pessoas'||v==='clientes') return 'Meus Clientes'; if(v==='leads') return 'Meus Leads'; }
  if(r==='administrativo' && v==='relatorios') return 'Relatórios Operacionais';
  return base;
}

// Clientes (corretor) — layout do mockup (Nome/Tipo/Telefone/Negócios), dado REAL
// (o backend já devolve só as pessoas do corretor via `pessoasListar`).
const CLI_TIPOS=['Todos','Comprador','Locatário','Proprietário','Fiador'];
function cliTipoColor(t){ return t==='Comprador'?'success':t==='Locatário'?'ai':t==='Fiador'?'warning':'info'; }
function clientesRows(){
  const q=semAcento(state.cliBusca).trim(); const f=state.cliFiltro||'Todos';
  const list=PEOPLE.filter(p=>{ if(f!=='Todos'&&!p.tipos.includes(f))return false; if(q&&semAcento(p.nome+' '+p.email+' '+p.cpf).indexOf(q)<0)return false; return true; });
  if(!list.length) return '<tr><td colspan="4"><div class="tcenter t500" style="padding:40px 0">'+icon('user-x',24)+'<p style="margin-top:8px" class="fz14 fw5">Nenhum cliente encontrado.</p></div></td></tr>';
  return list.map(p=>{ const negs=DEALS.filter(d=>d.clienteNome===p.nome).length; return '<tr data-person="'+p.id+'"><td><div class="fx ac g2">'+avatar(p.nome,30,'var(--ink800)')+'<span class="fw6 t900">'+esc(p.nome)+'</span></div></td><td>'+p.tipos.map(t=>pill(t,cliTipoColor(t))).join(' ')+'</td><td class="t700">'+esc(p.tel)+'</td><td class="tright fw6 t900">'+negs+' neg.</td></tr>'; }).join('');
}
function updateClientes(){ const el=$('#cliBody'); if(el){ el.innerHTML=clientesRows(); refreshIcons(); } }
RENDERERS.clientes = function(host){
  host.innerHTML=pageHead('Meus Clientes','Todos os clientes vinculados aos seus negócios.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px"><div class="fx ac g2 wrap">'+CLI_TIPOS.map(t=>'<button class="chip'+((state.cliFiltro||'Todos')===t?' active':'')+'" data-action="clifiltro" data-v="'+t+'">'+t+'</button>').join('')+'</div><div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(260px,60vw)">'+icon('search',16,'tmut')+'<input data-input="cliBusca" value="'+esc(state.cliBusca||'')+'" placeholder="Buscar cliente…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div></div>'
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:560px"><thead><tr><th>Nome</th><th>Tipo</th><th>Telefone</th><th class="tright">Negócios</th></tr></thead><tbody id="cliBody">'+clientesRows()+'</tbody></table></div></div>';
  if(!PEOPLE.length){ carregarPessoas().then(()=>{ if(state.view==='clientes') updateClientes(); }); }
};

/* ---------------- LEADS (Contact2Sale) ---------------- */
// Leads que chegam dos portais (ZAP/VivaReal/site) via webhook do C2S (leadsC2SWebhook).
// Corretor vê os seus; gestor/administrativo veem todos (o backend já filtra por posse).
let LEADS = [];
const LEAD_FILTROS = ['Todos','Não lidos','Novo','Em negociação','Fechado','Arquivado'];
function leadStatusVar(l){
  const a=(l.statusAlias||'').toLowerCase(), n=semAcento(l.status||'').toLowerCase();
  if(l.arquivado || n.indexOf('arquiv')>=0 || n.indexOf('recus')>=0) return 'neutral';
  if(a.indexOf('done')>=0 || n.indexOf('fechado')>=0 || n.indexOf('convert')>=0 || n.indexOf('finaliz')>=0) return 'success';
  if(a.indexOf('negoti')>=0 || n.indexOf('negocia')>=0) return 'warning';
  return 'info';
}
function leadData(iso){ if(!iso) return '—'; try{ return new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(_e){ return '—'; } }
function leadCodigo(l){ return ((l.imovel||{}).propRef||'').trim(); }   // código do anúncio no portal (prop_ref)
function leadEnderecoTxt(l){
  const im=l.imovel||{}; const ref=leadCodigo(l); let desc=(im.descricao||'').trim();
  if(ref && desc.indexOf('['+ref+']')===0) desc=desc.slice(('['+ref+']').length).trim();   // C2S repete o código no início da descrição
  return [desc, [im.bairro,im.cidade].filter(Boolean).join(', ')].filter(Boolean).join(' · ')||'—';
}
function leadsOrigensOpts(){
  const set=[...new Set(LEADS.map(l=>l.origem).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return ['Todos'].concat(set).map(o=>'<option value="'+esc(o)+'"'+((state.leadsOrigem||'Todos')===o?' selected':'')+'>'+esc(o==='Todos'?'Todas as origens':o)+'</option>').join('');
}
function leadWa(tel){ const d=String(tel||'').replace(/\D/g,''); if(!d) return ''; return 'https://wa.me/'+(d.length<=11?'55'+d:d); }
async function carregarLeads(){
  try{ const r=await call('leadsListar')({}); LEADS=(r.data&&r.data.itens)||[]; state.leadsVeTudo=!!(r.data&&r.data.veTudo); state._leadsErro=''; }
  catch(e){ LEADS=[]; state._leadsErro=(e&&e.message)||'erro'; }
}
function leadsFiltradas(){
  const q=semAcento(state.leadsBusca||'').trim(); const f=state.leadsFiltro||'Todos'; const og=state.leadsOrigem||'Todos';
  return LEADS.filter(l=>{
    const vv=leadStatusVar(l);
    if(og!=='Todos' && (l.origem||'')!==og) return false;
    if(f==='Não lidos' && l.lido) return false;
    if(f==='Novo' && vv!=='info') return false;
    if(f==='Em negociação' && vv!=='warning') return false;
    if(f==='Fechado' && vv!=='success') return false;
    if(f==='Arquivado' && !l.arquivado) return false;
    if(q){ const c=l.cliente||{}; if(semAcento([c.nome,c.email,c.telefone,leadEnderecoTxt(l),leadCodigo(l),l.origem].join(' ')).indexOf(q)<0) return false; }
    return true;
  });
}
function leadsRows(){
  const list=leadsFiltradas(); const veTudo=state.leadsVeTudo; const cols=veTudo?7:6;
  if(state._leadsErro) return '<tr><td colspan="'+cols+'"><div class="tcenter t500" style="padding:36px 0">'+icon('alert-triangle',22,'tmut')+'<p style="margin-top:8px" class="fz13">Não consegui carregar os leads.</p></div></td></tr>';
  if(!list.length) return '<tr><td colspan="'+cols+'"><div class="tcenter t500" style="padding:40px 0">'+icon('inbox',24)+'<p style="margin-top:8px" class="fz14 fw5">Nenhum lead por aqui ainda.</p><p class="fz12 tmut" style="margin-top:4px">Quando chega um contato dos portais, ele aparece aqui na hora.</p></div></td></tr>';
  return list.map(l=>{ const c=l.cliente||{};
    return '<tr data-action="openlead" data-id="'+esc(l.id)+'" style="cursor:pointer">'
    + '<td><div class="fx ac g2">'+(l.lido?'':'<span style="width:8px;height:8px;border-radius:50%;background:var(--ai);flex:none"></span>')+avatar(c.nome||'?',30,'var(--ink800)')+'<span class="fw6 t900">'+esc(c.nome||'—')+'</span></div></td>'
    + '<td class="t700 trunc" style="max-width:220px">'+esc(leadEnderecoTxt(l))+'</td>'
    + '<td class="mono fz12 t700 nowrap">'+(leadCodigo(l)?esc(leadCodigo(l)):'<span class="tmut">—</span>')+'</td>'
    + '<td>'+(l.origem?pill(l.origem,'ai'):'<span class="tmut">—</span>')+'</td>'
    + '<td>'+pill(l.status||'Novo',leadStatusVar(l))+'</td>'
    + (veTudo?'<td class="t700 trunc" style="max-width:140px">'+esc((l.corretor&&l.corretor.nome)||'—')+'</td>':'')
    + '<td class="tright tmut fz12 nowrap">'+leadData(l.recebidoEm)+'</td></tr>';
  }).join('');
}
function updateLeads(){
  const el=$('#leadsBody'); if(el){ el.innerHTML=leadsRows(); refreshIcons(); }
  const cnt=$('#leadsCount'); if(cnt){ const n=leadsFiltradas().length; cnt.textContent=n+' lead'+(n===1?'':'s'); }
  const sel=$('#leadsOrigemSel'); if(sel){ sel.innerHTML=leadsOrigensOpts(); sel.value=state.leadsOrigem||'Todos'; }   // origens só existem depois do load
}
function renderLeadsInner(host){
  const veTudo=state.leadsVeTudo; const cols=veTudo?7:6;
  const corpo = LEADS.length ? leadsRows() : '<tr><td colspan="'+cols+'"><div class="tcenter tmut" style="padding:30px 0">Carregando…</div></td></tr>';
  host.innerHTML=pageHead(hTitulo('Leads'),'Contatos que chegam dos portais (ZAP, VivaReal, site) em tempo real.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:14px"><div class="fx ac g2 wrap">'+LEAD_FILTROS.map(t=>'<button class="chip'+((state.leadsFiltro||'Todos')===t?' active':'')+'" data-action="leadfiltro" data-v="'+t+'">'+t+'</button>').join('')+'</div>'
  + '<div class="fx ac g2 wrap">'
  + '<select id="leadsOrigemSel" data-action="leadorigem" style="height:40px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;padding:0 10px;font-family:var(--sans);max-width:200px">'+leadsOrigensOpts()+'</select>'
  + '<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(240px,60vw)">'+icon('search',16,'tmut')+'<input data-input="leadsBusca" value="'+esc(state.leadsBusca||'')+'" placeholder="Buscar lead…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div></div></div>'
  + '<div class="fz12 tmut" id="leadsCount" style="margin-bottom:8px"></div>'
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:'+(veTudo?860:740)+'px"><thead><tr><th>Cliente</th><th>Imóvel</th><th>Código</th><th>Origem</th><th>Status</th>'+(veTudo?'<th>Corretor</th>':'')+'<th class="tright">Recebido</th></tr></thead><tbody id="leadsBody">'+corpo+'</tbody></table></div></div>';
  if(LEADS.length){ const cnt=$('#leadsCount'); if(cnt){ const n=leadsFiltradas().length; cnt.textContent=n+' lead'+(n===1?'':'s'); } }
  refreshIcons();
}
RENDERERS.leads = function(host){
  renderLeadsInner(host);
  // Re-renderiza a TABELA INTEIRA depois do load (não só o corpo): o cabeçalho depende de
  // state.leadsVeTudo, que só existe depois do carregarLeads — senão header (6 col) e linhas
  // (7 col) ficam desalinhados no 1º acesso do gestor/adm.
  carregarLeads().then(()=>{ const h=$('#root'); if(state.view==='leads'&&h) renderLeadsInner(h); });
};
function openLead(id){
  const l=LEADS.find(x=>x.id===id); if(!l) return;
  const c=l.cliente||{}; const im=l.imovel||{}; const wa=leadWa(c.telefone);
  const prop=(PROPERTIES.concat(PROPERTIES_ALL||[])).find(p=>im.propRef && (String(p.code||'')===String(im.propRef) || String(p.ref||'')===String(im.propRef)));
  const linhas=[['Código do portal',leadCodigo(l)||'—'],['Origem',l.origem||'—'],['Canal',l.canal||'—'],['Status',l.status||'Novo'],['Recebido',leadData(l.recebidoEm)]];
  if(state.leadsVeTudo) linhas.push(['Corretor',(l.corretor&&l.corretor.nome)||'—']);
  const info=linhas.map(kv=>'<div class="fx jb g2" style="padding:8px 0;border-bottom:1px solid var(--ink100)"><span class="tmut fz13">'+esc(kv[0])+'</span><span class="fw6 t900 fz13 tright">'+esc(kv[1])+'</span></div>').join('');
  const contato='<div class="fx g2 wrap" style="padding:12px 20px 2px">'
    + (wa?'<a class="btn btn-primary sm" href="'+wa+'" target="_blank" rel="noopener" style="text-decoration:none"><i data-lucide="message-circle" style="width:16px;height:16px"></i>WhatsApp</a>':'')
    + (c.telefone?'<a class="btn btn-outline sm" href="tel:'+esc(String(c.telefone).replace(/[^\d+]/g,''))+'" style="text-decoration:none"><i data-lucide="phone" style="width:16px;height:16px"></i>Ligar</a>':'')
    + (c.email?'<a class="btn btn-outline sm" href="mailto:'+esc(c.email)+'" style="text-decoration:none"><i data-lucide="mail" style="width:16px;height:16px"></i>E-mail</a>':'')
    + '</div>';
  const imovelBox='<div class="card" style="padding:12px;margin:0 0 12px"><div class="fx jb ac g2"><div style="min-width:0"><div class="fz11 tmut">IMÓVEL</div><div class="fw6 t900 trunc">'+esc(leadEnderecoTxt(l))+'</div>'+(im.preco?'<div class="fz13 t700">R$ '+esc(im.preco)+(im.negociacao?' · '+esc(im.negociacao):'')+'</div>':'')+'</div>'+(prop?'<button class="btn btn-outline sm nsh" data-action="lead-verimovel" data-id="'+esc(prop.id)+'">Ver imóvel</button>':'')+'</div></div>';
  const msg=l.mensagem?'<div style="margin:0 0 12px"><div class="fz11 tmut">MENSAGEM</div><div class="card" style="padding:12px;font-size:13px;line-height:1.5">'+esc(l.mensagem)+'</div></div>':'';
  // Vínculo manual com um imóvel da Carteira (gestor/adm ou o dono do lead).
  const meuUid=(auth.currentUser&&auth.currentUser.uid)||'';
  const podeVincular=state.leadsVeTudo || l.corretorUid===meuUid;
  const v=l.imovelVinculado;
  const vincBox = v
    ? '<div class="card" style="padding:12px;margin:0 0 12px;border:1px solid var(--success)"><div class="fx jb ac g2"><div style="min-width:0"><div class="fz11 tmut">IMÓVEL VINCULADO (Carteira)</div><div class="fw6 t900 trunc">'+(v.codigo?('<span class="mono">['+esc(v.codigo)+']</span> '):'')+esc(v.endereco||'—')+'</div></div><div class="fx g1 nsh">'+(v.id?'<button class="btn btn-outline sm nsh" data-action="lead-verimovel" data-id="'+esc(v.id)+'">Ver</button>':'')+(podeVincular?'<button class="btn btn-outline sm nsh" data-action="lead-desvincular" data-id="'+esc(l.id)+'" style="color:var(--danger);border-color:var(--danger)">Desvincular</button>':'')+'</div></div></div>'
    : (podeVincular?'<button class="btn btn-outline sm" data-action="lead-vincular" data-id="'+esc(l.id)+'" style="width:100%;margin:0 0 12px">'+icon('link',15)+'Vincular a um imóvel</button>':'');
  openDrawer('<div class="fx ac g2" style="padding:18px 20px 4px">'+avatar(c.nome||'?',44,'var(--ink800)')+'<div style="min-width:0"><div class="fw7 t900 trunc" style="font-size:17px">'+esc(c.nome||'—')+'</div><div class="tmut fz13 trunc">'+esc(c.telefone||'')+(c.email?(' · '+esc(c.email)):'')+'</div></div></div>'
    + contato
    + '<div class="grow scrolly" style="overflow:auto;padding:14px 20px">'
    + imovelBox + vincBox + msg
    + '<div class="fz11 tmut" style="margin-bottom:2px">DETALHES</div>'+info
    + '</div>'
    + '<div class="fx g2" style="padding:14px 20px;border-top:1px solid var(--ink100)"><button class="btn btn-outline sm grow" data-action="close-drawer">Fechar</button></div>');
  if(!l.lido){ l.lido=true; updateLeads(); call('leadsMarcarLido')({id:l.id}).catch(()=>{}); }
}
/* ---- Vincular lead a um imóvel da Carteira (manual) ---- */
function leadVincLista(){
  const q=semAcento(state.leadVincBusca||'').trim();
  const seen=new Set(); const all=(PROPERTIES||[]).concat(PROPERTIES_ALL||[]).filter(p=>{ if(!p||seen.has(p.id))return false; seen.add(p.id); return true; });
  if(!all.length) return '<div class="tcenter t500 fz13" style="padding:24px">Nenhum imóvel na Carteira.</div>';
  const filt=all.filter(p=> !q || semAcento((p.code||'')+' '+(p.rua||'')).indexOf(q)>=0).slice(0,80);
  if(!filt.length) return '<div class="tcenter t500 fz13" style="padding:24px">Nenhum imóvel encontrado.</div>';
  return filt.map(p=>'<button class="fx ac g3 hoverbg" data-action="lead-vincular-do" data-lead="'+esc(state.leadVincLeadId||'')+'" data-imovel="'+esc(p.id)+'" data-codigo="'+esc(p.code||'')+'" data-end="'+esc(p.rua||'')+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:pointer;margin-bottom:8px"><div class="grow mw0"><div class="fz13 fw6 t900 mono">'+esc(p.code||'—')+'</div><div class="fz11 t500 trunc">'+esc(p.rua||'—')+'</div></div>'+icon('chevron-right',16,'t400')+'</button>').join('');
}
function updateLeadVinc(){ const el=$('#leadVincLista'); if(el){ el.innerHTML=leadVincLista(); refreshIcons(); } }
function openLeadVincular(leadId){
  state.leadVincLeadId=leadId; state.leadVincBusca='';
  openModal('<div style="padding:20px;max-width:520px">'
    + '<div class="fz15 fw7 t900" style="margin-bottom:2px">Vincular a um imóvel</div>'
    + '<div class="fz12 t500" style="margin-bottom:14px">Escolha um imóvel da Carteira pra grudar neste lead — não precisa o código bater.</div>'
    + '<div style="margin-bottom:10px"><input data-input="leadVincBusca" placeholder="Buscar por código ou endereço…" style="width:100%;padding:9px 11px;background:var(--ink50);border:1px solid var(--ink200);border-radius:8px;font-size:13px;font-family:var(--sans)"></div>'
    + '<div id="leadVincLista" class="scrolly" style="max-height:48vh;overflow:auto">'+leadVincLista()+'</div>'
    + '<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Fechar</button></div>'
    + '</div>');
}
async function leadsVincularDo(leadId, imovelId, codigo, endereco){
  try{
    await call('leadsVincularImovel')({ leadId, imovelId, codigo, endereco });
    const l=LEADS.find(x=>x.id===leadId); if(l){ l.imovelVinculadoId=imovelId; l.imovelVinculado={id:imovelId,codigo:codigo||'',endereco:endereco||''}; }
    closeModal(); toast('Imóvel vinculado','check-circle-2','var(--success)'); openLead(leadId);
  }catch(e){ toast('Erro ao vincular','alert-triangle','var(--warning)'); }
}
async function leadsDesvincular(leadId){
  try{
    await call('leadsVincularImovel')({ leadId, imovelId:'' });
    const l=LEADS.find(x=>x.id===leadId); if(l){ l.imovelVinculadoId=null; l.imovelVinculado=null; }
    toast('Desvinculado','check-circle-2','var(--success)'); openLead(leadId);
  }catch(e){ toast('Erro ao desvincular','alert-triangle','var(--warning)'); }
}

/* ---------------- DASHBOARD por papel ---------------- */
const _dashBroker = RENDERERS.dashboard;
RENDERERS.dashboard = function(host){
  if(state.role==='corretor') return renderDashCorretor(host);
  if(state.role==='administrativo') return renderDashAdmin(host);
  return _dashBroker(host);
};

// Mesmo critério do Hub (BASE_HOSTING/firebase-env): staging e localhost/emulador
// geram link de staging; QUALQUER outro host (`.exe` sem hostname, web.app de
// produção e domínios próprios como smarthubapp.com.br) → produção. ⚠️ Não voltar
// pra allowlist de produção: host novo desconhecido caía no staging e ficha REAL
// (com CPF) ia parar no projeto de teste, invisível pra produção.
const _fichaHost = (typeof location !== 'undefined') ? location.hostname : '';
const _fichaStaging = _fichaHost.includes('remax-smart-hub-staging') || _fichaHost === 'localhost' || _fichaHost === '127.0.0.1';
const FICHA_HOST = _fichaStaging ? 'https://remax-smart-hub-staging.web.app' : 'https://remax-smart-hub.web.app';
const FICHAS_CORRETOR = [
  ['ficha-locador.html','Locador','house','info'],
  ['ficha-vendedor.html','Vendedor','key-round','success'],
  ['ficha-pf.html','Cliente PF','user','ai'],
  ['ficha-pj.html','Cliente PJ','building-2','brand'],
  ['ficha-locacao-fiador.html','Locação c/ Fiador','shield','warning'],
  ['ficha-proposta.html','Proposta','file-signature','danger'],
];
function fichaLink(arquivo){ const uid=(auth.currentUser&&auth.currentUser.uid)||''; return FICHA_HOST+'/'+arquivo+'?corretor='+encodeURIComponent(uid)+'&nome='+encodeURIComponent(state.meuNome||''); }
// Link da ficha AMARRADO a um imóvel: carrega o UID do DONO do imóvel (não o do usuário
// logado) — o gestor manda ficha pro imóvel do corretor sem roubar atribuição, e o trigger
// só aceita ficha cujo corretorUid === dono do imóvel (trava anti-injeção).
function fichaLinkImovel(arquivo, imovelId){ const p=prop(imovelId); const uid=(p&&p.corretor)||(auth.currentUser&&auth.currentUser.uid)||''; const nome=(p&&p.corretorNome)||state.meuNome||''; return FICHA_HOST+'/'+arquivo+'?corretor='+encodeURIComponent(uid)+'&nome='+encodeURIComponent(nome)+'&imovelId='+encodeURIComponent(imovelId); }

function saudacao(){ const h=new Date().getHours(); return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'; }
const repasse = d => Math.round((d.comValor||0)*repassePct(d.corretor));
function renderDashCorretor(host){
  const primeiro=(state.meuNome||'Corretor').split(' ')[0];
  const DEALS=dealsView(), PROPERTIES=propsView();   // escopo do mês selecionado
  // Dados REAIS (o backend já devolve só os negócios/imóveis do corretor).
  const ativos=DEALS.filter(d=>d.statusRaw!=='concluido'&&d.statusRaw!=='entregue_gestao').length;
  const assin=DEALS.filter(d=>d.clicksign==='Enviado').length;
  const props=DEALS.filter(d=>['negocio_criado','em_andamento'].includes(d.statusRaw)).length;
  const captacoes=PROPERTIES.length;
  const MYCOM={ prevista:DEALS.reduce((s,d)=>s+repasse(d),0), recebida:DEALS.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+repasse(d),0) };
  const kcard=(ico,variant,label,valor,sub,view)=>'<button class="card card-hover" style="padding:18px;text-align:left" data-nav="'+view+'"><div class="fx as jb g3"><div class="mw0"><div class="fz13 fw5 t500">'+label+'</div><div style="margin-top:8px;font-size:24px;line-height:1;font-weight:700;letter-spacing:-.02em;color:var(--ink900)" class="'+(String(valor).indexOf("R$")===0?"mono":"")+'">'+valor+'</div></div>'+iconChip(ico,variant,40)+'</div>'+(sub?'<div class="fz12 fw6 '+sub[1]+'" style="margin-top:10px">'+sub[0]+'</div>':'')+'</button>';
  const atalhos=[['novo-cliente','user-plus','Novo Cliente'],['novo-imovel','building-2','Novo Imóvel'],['novo-negocio','handshake','Novo Negócio'],['agendar-visita','calendar-plus','Agendar Visita'],['enviar-ficha','clipboard-list','Enviar Ficha'],['whatsapp-quick','message-circle','WhatsApp'],['abrir-drive','folder-open','Google Drive'],['clicksign','file-signature','Clicksign']];
  // Próximas ações / pendências — REAIS, dos negócios do corretor.
  const acoes=DEALS.slice().sort((a,b)=>b.diasParado-a.diasParado).slice(0,5).map(d=>[d.prox,d.code+' · '+propDoDeal(d).rua,d.diasParado>7?'warning':'info',d.id]);
  const pend=DEALS.filter(d=>(d.checklist||[]).some(x=>x.obrigatoria&&!x.feito)||d.diasParado>7).slice(0,5).map(d=>[(d.diasParado>7?'Negócio parado há '+d.diasParado+' dias':'Documentação pendente'),d.code+' · '+propDoDeal(d).rua,d.diasParado>7?'danger':'warning',d.id]);
  // Pipeline — REAL, por etapa do negócio.
  const bucket=arr=>DEALS.filter(d=>arr.includes(d.statusRaw)).length;
  const pipe=[['Captação',captacoes,'#2563EB'],['Novos',bucket(['negocio_criado']),'#7C3AED'],['Em andamento',bucket(['em_andamento','aguardando_corretor']),'#0EA5E9'],['Documentação',bucket(['aguardando_administrativo','aguardando_broker']),'#F59E0B'],['Assinatura',assin,'#F59E0B'],['Concluído',bucket(['concluido']),'#16A34A']];
  const maxP=Math.max.apply(null,pipe.map(p=>p[1]))||1;
  const recs=DEALS.slice().sort((a,b)=>repasse(b)-repasse(a)).slice(0,5);
  const blockH=(t,sub,right)=>'<div class="fx ac jb g3" style="margin:26px 0 14px"><div class="fx ac g2"><div><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff">'+t+'</h2>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div></div>'+(right||'')+'</div>';
  host.innerHTML=
    '<div class="fx as jb wrap g3"><div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Seu centro de trabalho — ações do dia e ferramentas sempre à mão.</p></div><div class="nsh">'+mesSelect()+'</div></div>'
  + '<div class="grid3" style="margin-top:20px">'
    + kcard('handshake','info','Negócios ativos',ativos,['Em andamento','c-inf'],'negocios')
    + kcard('house','brand','Captações',captacoes,['Imóveis na carteira','c-suc'],'imoveis')
    + kcard('users','ai','Meus clientes',PEOPLE.length,['Vinculados a você','c-ai'],'clientes')
    + kcard('file-signature','warning','Propostas em andamento',props,['Em negociação','c-war'],'negocios')
    + kcard('wallet','success','Comissão prevista',brl(MYCOM.prevista),['Repasse estimado ('+Math.round(repassePctPorNome(state.meuNome)*100)+'%)','c-suc'],'comissoes')
    + kcard('badge-dollar-sign','success','Comissão recebida',brl(MYCOM.recebida),['Negócios concluídos','c-suc'],'comissoes')
  + '</div>'
  + '<div class="card" style="padding:12px;margin-top:16px"><div class="fx wrap g2">'+atalhos.map(x=>'<button class="btn btn-outline sm" data-action="'+x[0]+'">'+icon(x[1],15)+x[2]+'</button>').join('')+'</div></div>'
  + tarefasWidgetHTML(DEALS)
  + blockH('Fichas digitais','Envie a ficha cadastral e inicie o processo de locação ou venda')
  + '<div class="card" style="overflow:hidden"><div style="padding:8px">'+FICHAS_CORRETOR.map(f=>'<div class="fx ac g3 hoverbg" style="padding:11px 12px;border-radius:10px">'+iconChip(f[2],f[3],38)+'<div class="grow mw0"><div class="fz14 fw6 t900">'+f[1]+'</div><div class="fz12 t500">Ficha digital · link personalizado</div></div><div class="fx g1 nsh">'+[['ficha-copy','copy','Copiar link'],['ficha-whats','message-circle','WhatsApp'],['ficha-email','mail','E-mail'],['ficha-view','eye','Visualizar']].map(a=>'<button class="iconbtn" title="'+a[2]+'" style="background:var(--ink50);border-color:var(--ink200);color:var(--ink600);width:34px;height:34px" data-action="'+a[0]+'" data-arq="'+f[0]+'" data-nome="'+esc(f[1])+'">'+icon(a[1],15)+'</button>').join('')+'</div></div>').join('')+'</div></div>'
  + blockH('Meu dia','Suas tarefas e pendências')
  + '<div class="split">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Próximas ações','<button class="btn-dark-ghost" style="color:var(--brand)" data-action="hub-agenda">Ver agenda</button>')+'<div style="padding:8px">'+(acoes.length?acoes.map(a=>'<div class="fx ac g3 hoverbg" style="padding:12px;border-radius:10px">'+iconChip('circle-dot',a[2],32)+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(a[0])+'</div><div class="fz12 t500 trunc">'+esc(a[1])+'</div></div><button class="btn btn-outline sm nsh" data-deal="'+a[3]+'">Abrir negócio</button></div>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nada pendente. 🎉</div>')+'</div></div>'
    + '<div class="card" style="overflow:hidden">'+cardHead('Minhas pendências')+'<div style="padding:8px">'+(pend.length?pend.map(p=>'<button class="fx ac g3 hoverbg" data-deal="'+p[3]+'" style="width:100%;text-align:left;background:none;border:none;padding:11px 12px;border-radius:10px;cursor:pointer"><span style="width:10px;height:10px;border-radius:50%;background:var(--'+p[2]+');box-shadow:0 0 0 3px var(--'+p[2]+'bg);flex-shrink:0"></span><div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(p[0])+'</div><div class="fz12 t500 trunc">'+esc(p[1])+'</div></div>'+icon('chevron-right',15,'t400')+'</button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem pendências.</div>')+'</div></div>'
  + '</div>'
  + blockH('Meu pipeline','Acompanhe seus negócios por etapa')
  + '<div class="card" style="padding:18px 20px"><div class="fx col g3">'+pipe.map(p=>'<button class="fx ac g3" data-nav="negocios" style="width:100%;background:none;border:none;cursor:pointer;padding:0"><span class="fz12 t500 tright nsh" style="width:104px">'+p[0]+'</span><div class="grow" style="height:26px;border-radius:6px;background:var(--ink100);overflow:hidden"><div class="fx ac" style="height:100%;border-radius:6px;padding:0 10px;color:#fff;font-size:12px;font-weight:600;width:'+Math.max(Math.round(p[1]/maxP*100),12)+'%;background:'+p[2]+'">'+p[1]+'</div></div></button>').join('')+'</div></div>'
  + blockH('Agenda &amp; recebimentos','Seu dia e as próximas comissões')
  + '<div class="split">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Agenda do dia')+'<div id="bkAgendaDia" style="padding:8px"><div class="tcenter t500" style="padding:24px">'+icon('loader-2',22,'spin')+'</div></div></div>'
    + '<div class="card" style="overflow:hidden">'+cardHead('Comissões previstas','<button class="btn-dark-ghost" style="color:var(--brand)" data-nav="comissoes">Ver todas</button>')+'<div style="padding:8px">'+(recs.length?recs.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:none;padding:12px;border-radius:10px;cursor:pointer"><div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500">'+esc(d.code)+' · '+esc(d.clienteNome)+'</div></div><span class="fz15 fw7 c-suc mono nsh">'+brlFull(repasse(d))+'</span></button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem comissões previstas ainda.</div>')+'</div></div>'
  + '</div>';
  carregarAgendaDia();
  // KPI "Meus clientes": PEOPLE é lazy (só carregava ao entrar em Meus Clientes) —
  // sem isto o card mostrava 0 mesmo com clientes. Re-renderiza 1x quando chegar.
  if(!PEOPLE.length){ carregarPessoas().then(()=>{ if(PEOPLE.length && state.view==='dashboard' && state.role==='corretor') navigate('dashboard'); }); }
}

/* Agenda do dia (dashboard do corretor) — eventos REAIS de hoje (listarEventos do Hub). */
async function carregarAgendaDia(){
  const box=$('#bkAgendaDia'); if(!box) return;
  try {
    const h=new Date();
    const ini=new Date(h.getFullYear(),h.getMonth(),h.getDate(),0,0,0);
    const fim=new Date(h.getFullYear(),h.getMonth(),h.getDate(),23,59,59);
    const r=await fnEventos({ de:ini.toISOString(), ate:fim.toISOString() });
    const evs=((r&&r.data)||[]).filter(e=>e.meuRsvp!=='recusado').sort((a,b)=>(a.inicio||'').localeCompare(b.inicio||''));
    const b2=$('#bkAgendaDia'); if(!b2) return;   // navegou pra outra tela
    if(!evs.length){ b2.innerHTML='<div class="tcenter t500 fz13" style="padding:24px">Nenhum evento para hoje.</div>'; return; }
    b2.innerHTML=evs.map(e=>{ const dt=new Date(e.inicio); const hh=isNaN(dt)?'--:--':dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); return '<div class="fx ac g3 hoverbg" style="padding:11px 12px;border-radius:10px"><span class="fz13 fw7 t900 mono nsh" style="width:46px">'+hh+'</span>'+iconChip('calendar','info',32)+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(e.titulo||'Evento')+'</div>'+(e.descricao?'<div class="fz12 t500 trunc">'+esc(e.descricao)+'</div>':'')+'</div></div>'; }).join('');
    refreshIcons();
  } catch(e){ const b=$('#bkAgendaDia'); if(b) b.innerHTML='<div class="tcenter t500 fz13" style="padding:24px">Não consegui carregar a agenda.</div>'; }
}

function renderDashAdmin(host){
  const primeiro=(state.meuNome||'Administrativo').split(' ')[0];
  const DEALS=dealsView(), PROPERTIES=propsView(), KPI=kpiDe(DEALS), ACTIVITY=atividadesDe(DEALS);   // escopo do mês
  const cnt=raw=>DEALS.filter(d=>d.statusRaw===raw).length;
  const docsPend=DEALS.filter(d=>(d.checklist||[]).some(x=>x.obrigatoria&&!x.feito)).length;
  const assin=DEALS.filter(d=>d.clicksign==='Enviado').length;
  const stale=DEALS.filter(d=>d.diasParado>7 && d.statusRaw!=='entregue_gestao' && d.statusRaw!=='concluido');
  const emAndamento=DEALS.filter(d=>['negocio_criado','em_andamento','aguardando_corretor','aguardando_administrativo','aguardando_broker'].includes(d.statusRaw)).length;
  const cards=[['handshake','info','Negócios ativos',KPI.ativos,'negocios'],['file-warning','warning','Documentações pendentes',docsPend,'negocios'],['file-signature','ai','Contratos para assinatura',assin,'clicksign'],['kanban','info','Em andamento',emAndamento,'fila'],['user-check','warning','Aguardando administrativo',cnt('aguardando_administrativo'),'fila'],['alert-triangle','danger','Parados +7 dias',stale.length,'fila']];
  const kc=c=>'<button class="card card-hover" style="padding:18px;text-align:left" data-nav="'+c[4]+'"><div class="fx as jb g3"><div class="mw0"><div class="fz13 fw5 t500">'+c[2]+'</div><div style="margin-top:8px;font-size:28px;line-height:1;font-weight:700;color:var(--ink900)">'+c[3]+'</div></div>'+iconChip(c[0],c[1],42)+'</div></button>';
  const RESUMO=[['Novos',cnt('negocio_criado'),'#2563EB'],['Em andamento',cnt('em_andamento')+cnt('aguardando_corretor'),'#7C3AED'],['Aguardando',cnt('aguardando_administrativo')+cnt('aguardando_broker'),'#F59E0B'],['Entregues',cnt('entregue_gestao'),'#0EA5E9'],['Concluídos',cnt('concluido'),'#16A34A']];
  const crit=stale.slice().sort((a,b)=>b.diasParado-a.diasParado).slice(0,6);
  const blockH=(t,sub)=>'<div style="margin:26px 0 14px"><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff">'+t+'</h2>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div>';
  host.innerHTML=
    '<div class="fx as jb wrap g3"><div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Centro de operações — mantenha todos os processos em andamento.</p></div><div class="nsh">'+mesSelect()+'</div></div>'
  + '<div class="grid3" style="margin-top:20px">'+cards.map(kc).join('')+'</div>'
  + tarefasWidgetHTML(DEALS)
  + blockH('Resumo da fila','Distribuição dos negócios por etapa')
  + '<div class="card" style="padding:16px"><div class="fx wrap g2">'+RESUMO.map(c=>'<button class="fx ac g2 hoverbg" data-nav="fila" style="flex:1;min-width:150px;background:var(--ink50);border:none;border-radius:10px;padding:12px;cursor:pointer;text-align:left"><span style="width:10px;height:10px;border-radius:50%;background:'+c[2]+'"></span><div><div class="fz18 fw7 t900">'+c[1]+'</div><div class="fz12 t500">'+c[0]+'</div></div></button>').join('')+'</div></div>'
  + '<div class="split" style="margin-top:16px">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Precisa de atenção','<button class="btn-dark-ghost" style="color:var(--brand)" data-nav="fila">Ver fila</button>')+'<div style="padding:8px">'+(crit.length?crit.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:none;padding:11px 12px;border-radius:10px;cursor:pointer">'+iconChip('alert-triangle','danger',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(d.code)+' · '+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500 trunc">'+esc(d.clienteNome)+' · '+esc(corrNome(d.corretor))+'</div></div><span class="fz12 t500 mono nsh">'+d.diasParado+'d</span></button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nada parado. 🎉</div>')+'</div></div>'
    + '<div class="card" style="overflow:hidden">'+cardHead('Atividades recentes')+'<div style="padding:16px">'+(ACTIVITY.length?ACTIVITY.map((a,i)=>'<div class="fx g3"><div class="fx col ac">'+iconChip('circle-dot','info',30)+(i<ACTIVITY.length-1?'<span class="timeline-line"></span>':'')+'</div><div style="padding-bottom:14px" class="mw0 grow"><div class="fz13 fw6 t900 trunc">'+esc(a.txt)+'</div><div class="fz12 t500 trunc">'+esc(a.sub)+'</div><div class="fz11 t400 mono" style="margin-top:2px">'+esc(a.quando)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem atividades recentes.</div>')+'</div></div>'
  + '</div>';
}

/* ---------------- FILA DE TRABALHO (kanban REAL, por status do negócio) ---------------- */
function filaBoardHtml(){
  const COLS=[['Novos',['negocio_criado'],'#2563EB'],['Em andamento',['em_andamento','aguardando_corretor'],'#7C3AED'],['Aguardando',['aguardando_administrativo','aguardando_broker'],'#F59E0B'],['Entregues',['entregue_gestao','concluido'],'#16A34A']];
  const q=semAcento(state.filaBusca||'').trim();
  const inQ=d=>!q||semAcento(d.code+' '+propDoDeal(d).rua+' '+d.clienteNome+' '+corrNome(d.corretor)).indexOf(q)>=0;
  return '<div class="gd" style="grid-template-columns:repeat('+COLS.length+',minmax(240px,1fr));gap:14px;align-items:start;min-width:900px">'+COLS.map(c=>{ const list=DEALS.filter(d=>c[1].includes(d.statusRaw)&&inQ(d)); return '<div class="card" style="padding:0;overflow:hidden"><div class="fx ac jb" style="padding:12px 14px;border-bottom:1px solid var(--ink100)"><span class="fx ac g2 fz12 up fw7 t700"><span style="width:9px;height:9px;border-radius:50%;background:'+c[2]+'"></span>'+c[0]+'</span><span class="pill neutral">'+list.length+'</span></div><div style="padding:10px;display:flex;flex-direction:column;gap:8px;min-height:60px">'+(list.length?list.map(d=>'<button class="card card-hover" data-deal="'+d.id+'" style="padding:12px;text-align:left"><div class="fx ac jb g2"><span class="mono fz12 fw7 t900">'+esc(d.code)+'</span><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'" style="font-size:10px;padding:1px 7px">'+d.tipo+'</span></div><div class="fz13 fw6 t900 trunc" style="margin-top:6px">'+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500 trunc">'+esc(d.clienteNome)+'</div><div class="fx ac jb g2" style="margin-top:8px"><span class="fz11 t400 mono">'+d.diasParado+'d parado</span>'+avatar(corrNome(d.corretor),22,'var(--ink800)',corrFoto(d.corretor))+'</div></button>').join(''):'<div class="tcenter t400 fz12" style="padding:16px 0">—</div>')+'</div></div>'; }).join('')+'</div>';
}
RENDERERS.fila = function(host){
  host.innerHTML=pageHead('Fila de Trabalho','Todos os negócios por etapa — clique num cartão pra abrir.','<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(280px,50vw)">'+icon('search',16,'tmut')+'<input data-input="filaBusca" value="'+esc(state.filaBusca||'')+'" placeholder="Buscar…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>')
  + '<div style="overflow-x:auto;padding-bottom:8px" class="scrolly" id="filaBoard">'+filaBoardHtml()+'</div>';
};
// Re-renderiza SÓ o quadro (não a página inteira) — recriar o input a cada tecla matava o foco.
function updateFila(){ const b=$('#filaBoard'); if(b){ b.innerHTML=filaBoardHtml(); refreshIcons(); } else if(state.view==='fila'){ RENDERERS.fila($('#root')); refreshIcons(); } }

/* ---------------- MINHAS COMISSÕES (corretor) ---------------- */
RENDERERS.comissoes = function(host){
  const rep=d=>Math.round((d.comValor||0)*repassePct(d.corretor));
  const prevista=DEALS.reduce((s,d)=>s+rep(d),0);
  const recebida=DEALS.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+rep(d),0);
  const pendente=prevista-recebida;
  const rows=DEALS.map(d=>({code:d.code,cli:d.clienteNome,val:rep(d),st:d.statusRaw==='concluido'?'Recebida':'Prevista'}));
  const card=(l,v,ico,variant,cor)=>'<div class="card" style="padding:20px"><div class="fx ac jb"><div class="fz13 fw5 t500">'+l+'</div>'+iconChip(ico,variant,36)+'</div><div class="mono '+(cor||'')+'" style="margin-top:10px;font-size:26px;font-weight:700;color:'+(cor?'':'var(--ink900)')+'">'+brlFull(v)+'</div></div>';
  // Evolução mensal REAL: repasse dos negócios concluídos, por mês de conclusão (12 meses).
  const NOMES_MES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const agora=new Date(); const meses=[];
  for(let i=11;i>=0;i--){ const dt=new Date(agora.getFullYear(),agora.getMonth()-i,1); meses.push({y:dt.getFullYear(),m:dt.getMonth(),label:NOMES_MES[dt.getMonth()],total:0}); }
  DEALS.filter(d=>d.statusRaw==='concluido').forEach(d=>{ const iso=(d.raw&&(d.raw.atualizadoEm||d.raw.criadoEm))||''; const dt=new Date(iso); if(isNaN(dt)) return; const hit=meses.find(x=>x.y===dt.getFullYear()&&x.m===dt.getMonth()); if(hit) hit.total+=rep(d); });
  const mxMes=Math.max.apply(null,meses.map(x=>x.total))||1;
  const chart='<div class="fx g1" style="height:120px;align-items:flex-end">'+meses.map((x,i)=>'<div class="grow" style="text-align:center"><div title="'+x.label+': '+brlFull(x.total)+'" style="height:'+(x.total?Math.max(Math.round(x.total/mxMes*96),4):2)+'px;border-radius:4px 4px 0 0;background:'+(i===11?'var(--brand)':'#C9D2E3')+'"></div><div class="fz11" style="margin-top:4px;color:'+(i===11?'var(--ink900)':'var(--ink400)')+';font-weight:'+(i===11?'700':'400')+'">'+x.label+'</div></div>').join('')+'</div>';
  host.innerHTML=pageHead('Minhas Comissões','Sua comissão (repasse estimado de '+Math.round(repassePctPorNome(state.meuNome)*100)+'%) por negócio. Valores estimados até a baixa financeira.','')
  + '<div class="grid3" style="margin-bottom:16px">'+card('Prevista',prevista,'wallet','info')+card('Recebida',recebida,'badge-dollar-sign','success','var(--successtx)')+card('Pendente',pendente,'hand-coins','warning','var(--warningtx)')+'</div>'
  + '<div class="card" style="padding:18px 20px;margin-bottom:16px"><div class="fz12 up fw7 t500" style="margin-bottom:12px">Evolução mensal (recebido)</div>'+chart+'</div>'
  + '<div class="card" style="overflow:hidden">'+cardHead('Comissões por negócio')+'<div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:520px"><thead><tr><th>Negócio</th><th>Cliente</th><th>Status</th><th class="tright">Repasse</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr style="cursor:default"><td class="mono fz13 fw6 t900">'+esc(r.code)+'</td><td class="t700">'+esc(r.cli)+'</td><td>'+pill(r.st,r.st==='Recebida'?'success':'info')+'</td><td class="tright mono fw6 t900">'+brlFull(r.val)+'</td></tr>').join(''):'<tr><td colspan="4" class="tcenter t500" style="padding:24px">Sem negócios ainda.</td></tr>')+'</tbody></table></div></div>'
  + '<div class="fz11 t400" style="margin-top:12px;line-height:1.5">'+icon('info',13,'t400')+' Valor estimado — pode divergir do efetivamente devido (fechamento, descontos, impostos, parcerias e baixa financeira). Não é extrato de pagamento; vale o acerto oficial. <button class="lnk" data-action="abrir-termos" style="background:none;border:none;padding:0;color:var(--brand);font:inherit;cursor:pointer;text-decoration:underline">Termos</button></div>';
};

/* ---------------- MEU PERFIL (real — getMeuPerfil/salvarMeuPerfil) ---------------- */
RENDERERS.perfil = function(host){
  host.innerHTML=pageHead('Meu Perfil','Seus dados de contato. Usados nos links de ficha e no contrato de representação.','')
  + '<div id="perfilBox"><div class="tcenter t500" style="padding:60px 0">'+icon('loader-2',28,'spin')+'</div></div>';
  refreshIcons();
  fnGetPerfil({}).then(r=>{ state.perfilCache=r.data||{}; pintarPerfil(); }).catch(()=>{ const b=$('#perfilBox'); if(b) b.innerHTML='<div class="card t500" style="padding:24px">Não consegui carregar o perfil.</div>'; });
};
function pintarPerfil(){
  const p=state.perfilCache||{}; const box=$('#perfilBox'); if(!box) return;
  const foto=p.photo||'';
  const campo=(id,label,val,ph,extra)=>'<div><label class="lbl">'+label+'</label><input id="'+id+'" class="input" value="'+esc(val||'')+'" placeholder="'+(ph||'')+'" '+(extra||'')+'></div>';
  box.innerHTML='<div class="split-r">'
    + '<div class="card" style="padding:22px;text-align:center">'+(foto?'<span class="avatar" style="width:88px;height:88px;background-image:url('+esc(foto)+');background-size:cover;background-position:center;margin:0 auto"></span>':avatar(p.displayName||state.meuNome,88,'var(--brand)'))+'<div class="fz18 fw7 t900" style="margin-top:12px">'+esc(p.displayName||state.meuNome)+'</div><div class="fz13 t500">'+roleLabel()+' · REMAX SMART</div><div class="fz12 t500" style="margin-top:8px">'+esc(p.email||'')+'</div></div>'
    + '<div class="card" style="padding:22px"><div class="fz12 up fw7 t500" style="margin-bottom:14px">Meus dados</div><div class="gd" style="grid-template-columns:1fr 1fr;gap:14px">'
      + campo('pfTel','Telefone / WhatsApp',p.telefone,'(11) 90000-0000')
      + campo('pfCreci','CRECI',p.creci,'Ex.: 123456-F')
      + campo('pfCpf','CPF',p.cpf,'000.000.000-00')
      + '</div><div class="fx je" style="margin-top:18px"><button class="btn btn-primary" data-action="salvar-perfil">'+icon('check',16)+'Salvar</button></div>'
      + '<div class="fz12 t500" style="margin-top:12px">Nome e foto do perfil são alterados nas Configurações do Hub.</div>'
    + '</div></div>';
  refreshIcons();
}

/* ============================================================================
   TELAS OPERACIONAIS (Documentos, Clicksign, Drive, Agenda, Relatórios op.)
   Sem dados de demonstração: Clicksign e Relatórios op. usam o dado REAL dos
   negócios; Documentos/Drive/Agenda ainda não têm fonte — mostram estado
   honesto de "em breve" em vez de números falsos.
   ============================================================================ */
function emBreveTela(host,titulo,desc,ico,txt,acoes){
  host.innerHTML=pageHead(titulo,desc,acoes||'')
  + '<div class="card" style="padding:48px 24px;text-align:center">'+iconChip(ico,'brand',52)+'<div class="fz16 fw7 t900" style="margin-top:14px">'+titulo+' — em breve</div><p class="fz14 t500" style="max-width:560px;margin:10px auto 0;line-height:1.55">'+txt+'</p></div>';
}

/* ---- Documentos: contratos/propostas/docs dos negócios (dado REAL) ----
   Fonte: o array `documentos[]` de cada negócio (subido via negocioAnexarDoc).
   Gestor/adm/corretor sobem docs nos negócios com posse; gestor/adm removem
   qualquer um, o corretor só o que ele mesmo anexou. Agrupado nas 4 seções do
   mockup (Contratos, Propostas, Doc. do cliente, Outros). Sem dado falso: vazio
   mostra estado honesto até alguém anexar. */
const DOC_SECOES = [['contrato','Contratos','file-text'],['proposta','Propostas','file-signature'],['cliente','Documentação do cliente','id-card'],['outro','Outros','file']];
function docFmtTam(b){ b=+b||0; if(b<1024) return b+' B'; if(b<1048576) return Math.round(b/1024)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function todosDocs(){ const out=[]; DEALS_DOCS.forEach(d=>{ const cancelado=d.statusRaw==='cancelado'; ((d.raw&&d.raw.documentos)||[]).forEach(x=>{ out.push({...x, dealId:d.id, dealCode:d.code, cliente:d.clienteNome, cancelado}); }); }); return out; }
function docRow(x,podeSubir){
  const meta=[x.dealCode, x.cliente, docFmtTam(x.tamanho), relData(x.em), x.cancelado?'⚠ Negócio cancelado':''].filter(Boolean).join(' · ');
  const baixar='<a class="btn btn-outline sm nsh" href="'+esc(x.url||'')+'" target="_blank" rel="noopener" style="text-decoration:none" title="Baixar">'+icon('download',16)+'</a>';
  const gestorAdm = (state.role==='broker'||state.role==='administrativo');
  const meuUid = (auth.currentUser&&auth.currentUser.uid)||'';
  const rem = (!x.cancelado && (gestorAdm || x.porUid===meuUid)) ? '<button class="btn btn-ghost sm nsh" data-action="doc-remover" data-deal="'+esc(x.dealId)+'" data-doc="'+esc(x.id)+'" data-nome="'+esc(x.nome||'')+'" title="Remover" style="color:#dc2626">'+icon('trash-2',16)+'</button>' : '';
  return '<div class="fx ac g3" style="padding:13px 20px;border-top:1px solid var(--ink100)">'+iconChip(x.mime==='application/pdf'?'file-text':'image','info',38)+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(x.nome||'documento')+'</div><div class="fz12 t500 trunc">'+esc(meta)+'</div></div><div class="fx ac g1 nsh">'+baixar+rem+'</div></div>';
}
RENDERERS.documentos = function(host){
  const podeSubir = true; // gestor/adm/corretor sobem docs nos seus negócios (posse garantida no servidor)
  const docs = todosDocs();
  const btn = podeSubir ? '<button class="btn btn-primary" data-action="doc-upload-open">'+icon('upload',16)+'Enviar documento</button>' : '';
  let corpo='';
  DOC_SECOES.forEach(([cat,label,ico])=>{
    const lista=docs.filter(x=>x.categoria===cat); if(!lista.length) return;
    corpo += '<div class="card" style="padding:0;margin-bottom:16px;overflow:hidden"><div class="fx ac g2" style="padding:15px 20px"><span class="t500">'+icon(ico,18)+'</span><span class="up fz13 fw7 t800">'+label+'</span><span class="pill neutral nsh" style="margin-left:auto">'+lista.length+'</span></div>'+lista.map(x=>docRow(x,podeSubir)).join('')+'</div>';
  });
  if(!docs.length) corpo = '<div class="card tcenter t500" style="padding:28px 16px"><div class="t400">'+icon('folder',24)+'</div><p class="fz13 fw5" style="margin-top:8px">'+(podeSubir?'Nenhum contrato/proposta anexado a um negócio ainda. Use “Enviar documento”.':'Nenhum contrato ou proposta nos seus negócios ainda.')+'</p></div>';
  // Sanfona "Documentos dos clientes" — carrega async (fichas dos clientes + anexos).
  const secCli = '<div class="fx ac g2" style="margin:26px 0 12px"><span class="t500">'+icon('users',18)+'</span><span class="up fz13 fw7 t800">Documentos dos clientes</span></div><div id="docsClientes"><div class="card tcenter t500" style="padding:24px"><span class="fz13">Carregando clientes…</span></div></div>';
  host.innerHTML = pageHead(hTitulo('Documentos'),'Contratos, propostas e documentos dos seus negócios.', btn) + corpo + secCli;
  carregarDocsClientes();
};
async function carregarDocsClientes(){
  const box = document.getElementById('docsClientes'); if(!box) return;
  try {
    const r = await fnDocsClientes({});
    const clientes = (r && r.data && r.data.clientes) || [];
    box.innerHTML = renderDocsClientes(clientes);
    refreshIcons();
  } catch(e){ box.innerHTML = '<div class="card" style="padding:16px"><div class="fz13" style="color:#dc2626">'+esc(e.message||'Erro ao carregar clientes')+'</div></div>'; }
}
function renderDocsClientes(clientes){
  if(!clientes.length) return '<div class="card tcenter t500" style="padding:24px"><p class="fz13 fw5">Nenhum cliente com documentos ainda. Os anexos das fichas (RG/CPF, comprovantes…) aparecem aqui por cliente.</p></div>';
  return '<div class="card" style="padding:0;overflow:hidden">'+clientes.map(c=>{
    const vinc = c.imovel ? ('Imóvel: '+esc(c.imovel.resumo||'—')) : 'Não vinculado a imóvel';
    const n = c.documentos.length;
    const rows = c.documentos.map(d=>'<div class="fx ac g3" style="padding:11px 20px 11px 56px;border-top:1px solid var(--ink100)">'+icon('file-text',15,'t400')+'<span class="grow trunc fz13 t700">'+esc(d.nome)+'</span><a class="btn btn-outline sm nsh" href="'+esc(d.url||'')+'" target="_blank" rel="noopener" style="text-decoration:none" title="Baixar">'+icon('download',15)+'Baixar</a></div>').join('');
    return '<details style="border-top:1px solid var(--ink100)"><summary class="fx ac g3" style="cursor:pointer;padding:13px 20px;list-style:none">'+avatar(c.nome,36,'var(--ink800)')+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(c.nome)+'</div><div class="fz12 t500 trunc">'+vinc+' · '+n+' doc'+(n>1?'s':'')+'</div></div><span class="nsh t400">'+icon('chevron-down',18)+'</span></summary>'+rows+'</details>';
  }).join('')+'</div>';
}
function openDocUpload(preDealId){
  const deals = DEALS.filter(d=>d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado');
  if(!deals.length){ toast('Não há negócio ativo para anexar documento','alert-triangle','var(--danger)'); return; }
  const opts = deals.map(d=>'<option value="'+esc(d.id)+'"'+(d.id===preDealId?' selected':'')+'>'+esc((d.code||'—')+' · '+(d.clienteNome||''))+'</option>').join('');
  const cats = [['contrato','Contrato'],['proposta','Proposta'],['cliente','Documentação do cliente'],['outro','Outro']].map(c=>'<option value="'+c[0]+'">'+c[1]+'</option>').join('');
  // Destino no DRIVE (subpasta da pasta do negócio ao Sincronizar). Rótulos por tipo:
  // venda = Vendedor/Comprador; locação = Locador/Locatário. Chaves neutras no servidor.
  const _destinoOpts = (dealId)=>{ const dd=deals.find(x=>x.id===dealId)||deals[0]; const v=!dd||dd.tipo==='Venda';
    return [['outros','Outros'],['comprador',v?'Comprador':'Locatário'],['vendedor',v?'Vendedor':'Locador'],['imovel','Imóvel']]
      .map(c=>'<option value="'+c[0]+'">'+c[1]+'</option>').join(''); };
  openModal('<div style="padding:20px"><div class="fz15 fw7 t900" style="margin-bottom:14px">Enviar documento</div>'
    +'<div class="fz12 fw6 t700" style="margin-bottom:4px">Negócio</div><select id="docDeal" class="input" style="margin-bottom:12px">'+opts+'</select>'
    +'<div class="fz12 fw6 t700" style="margin-bottom:4px">Categoria</div><select id="docCat" class="input" style="margin-bottom:12px">'+cats+'</select>'
    +'<div class="fz12 fw6 t700" style="margin-bottom:4px">Pasta no Drive <span class="t500">(onde o robô guarda ao Sincronizar)</span></div><select id="docDrive" class="input" style="margin-bottom:12px">'+_destinoOpts(preDealId)+'</select>'
    +'<div class="fz12 fw6 t700" style="margin-bottom:4px">Arquivo <span class="t500">(PDF, imagem ou documento, até 20MB)</span></div><input id="docFile" type="file" accept="'+_DOC_ACCEPT+'" class="input" style="margin-bottom:6px">'
    +'<div id="docErr" class="fz12" style="color:#dc2626;min-height:16px"></div>'
    +'<div class="fx g2" style="margin-top:12px"><button class="btn btn-outline sm grow" data-action="close-modal">Cancelar</button><button class="btn btn-primary sm grow" data-action="doc-upload-send">'+icon('upload',15)+'Enviar</button></div></div>');
  // Trocou o negócio no seletor → re-rotula o destino (Vendedor/Comprador ↔ Locador/Locatário).
  const selDeal=$('#docDeal');
  if(selDeal) selDeal.addEventListener('change',()=>{ const s=$('#docDrive'); if(s){ const atual=s.value; s.innerHTML=_destinoOpts(selDeal.value); s.value=atual; if(!s.value) s.value='outros'; } });
}

/* ---- Conciliação de Malote (gestor + administrativo) ----------------------
   Cruza os COMPROVANTES bancários (PDF) com a planilha do MALOTE (Excel) pela
   "Representação numérica do código de barras". 100% NO NAVEGADOR: os arquivos
   (com dados bancários) NUNCA sobem pro servidor — pdf.js + SheetJS rodam local
   (vendor/, carregados só nesta tela). Saída: nº · condomínio · página no PDF ·
   linha na planilha, + lista de "não encontrados" (nunca CHUTA um pagamento).
   Exporta Excel (2 abas) e PDF (impressão). */
let _concLibs = null, _concUltimo = null, _concPdfFile = null, _concPdfLib = null;
function _concLoadScript(src){ return new Promise((ok,err)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>err(new Error('não carregou '+src)); document.head.appendChild(s); }); }
function concCarregarLibs(){
  if(_concLibs) return _concLibs;
  _concLibs = (async()=>{
    if(!window.XLSX) await _concLoadScript('vendor/xlsx.full.min.js');
    if(!window.pdfjsLib) await _concLoadScript('vendor/pdf.min.js');
    if(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';
  })().catch(e=>{ _concLibs=null; throw e; });
  return _concLibs;
}
// pdf-lib só é necessário pra RECORTAR uma página no download — carrega sob demanda.
function concCarregarPdfLib(){
  if(_concPdfLib) return _concPdfLib;
  _concPdfLib = (async()=>{ if(!window.PDFLib) await _concLoadScript('vendor/pdf-lib.min.js'); })().catch(e=>{ _concPdfLib=null; throw e; });
  return _concPdfLib;
}
// Recorta a página `pag` do PDF carregado num arquivo próprio e baixa.
async function concBaixarPagina(pag, nomeBase){
  if(!_concPdfFile){ toast('Recarregue e cruze os arquivos de novo','alert-triangle','var(--warning)'); return; }
  try{
    await concCarregarPdfLib();
    const { PDFDocument } = window.PDFLib;
    const src = await PDFDocument.load(await _concPdfFile.arrayBuffer());
    const out = await PDFDocument.create();
    const [pagina] = await out.copyPages(src, [pag-1]);
    out.addPage(pagina);
    const bytes = await out.save();
    const nome = (String(nomeBase||'comprovante').replace(/[^\w\- ]+/g,'').trim().slice(0,60) || 'comprovante') + ' - pag ' + pag + '.pdf';
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
    const a = document.createElement('a'); a.href=url; a.download=nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }catch(e){ toast((e&&e.message)||'Erro ao baixar o comprovante','alert-triangle','var(--danger)'); }
}
const _concDig  = s => String(s==null?'':s).replace(/\D/g,'');
const _concNorm = s => String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();

// Planilha → índice { digitos -> {linha, nome} }. Acha as colunas pelo CABEÇALHO
// (não por posição fixa): "Imóvel/Condomínio", "Linha Digitável", "Código de Barras".
async function concLerXlsx(file){
  const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, defval:''});
  if(!aoa.length) throw new Error('Planilha vazia.');
  const head = (aoa[0]||[]).map(_concNorm);
  const findCol = (...alts) => head.findIndex(h => alts.some(a => h.includes(a)));
  const colNome = findCol('imovel','condominio','nome');
  const colLD   = findCol('linha digitavel','linha digit');
  const colCB   = findCol('codigo de barras','codigo barras','cod barras');
  if(colLD<0 && colCB<0) throw new Error('Não achei as colunas "Linha Digitável" / "Código de Barras" na planilha.');
  const idx = new Map();
  for(let i=1;i<aoa.length;i++){
    const r = aoa[i]||[]; const nome = colNome>=0 ? String(r[colNome]||'').trim() : '';
    [colLD,colCB].forEach(c=>{ if(c<0) return; const d=_concDig(r[c]); if(d.length>=20 && !idx.has(d)) idx.set(d, {linha:i+1, nome}); });
  }
  if(!idx.size) throw new Error('Nenhum código de barras válido na planilha.');
  return idx;
}

// Código de barras / linha digitável extraído pelo PADRÃO, não pelo label — assim
// funciona em qualquer layout de comprovante (Itaú "Identificação no meu
// comprovante", "Código de barras", "Linha digitável"…). Boleto = 47 dígitos
// (5·5·5·6·5·6·1·14); concessionária = 48 (4 blocos de 12); barcode bruto = 44.
// (?<!\d)…(?!\d): fronteira — o padrão só casa um NÚMERO INTEIRO, não uma janela
// deslocada dentro de um dígito maior (evita concatenar um valor/agência ao boleto
// e extrair um código de barras errado, sobretudo no fallback "tight").
const _RE_BOLETO  = /(?<!\d)\d{5}[.\s]?\d{5}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d{5}[.\s]?\d{6}[.\s]?\d[.\s]?\d{14}(?!\d)/;
const _RE_CONCESS = /(?<!\d)\d{11,12}[.\s-]?\d{11,12}[.\s-]?\d{11,12}[.\s-]?\d{11,12}(?!\d)/;
function _concBarcode(txt){
  // "tight" = junta dígitos separados por espaço/ponto (o pdf.js às vezes quebra os
  // grupos da linha digitável em itens de texto diferentes → viram "34191 09180…").
  const tight = txt.replace(/(\d)[ .]+(?=\d)/g, '$1');
  for(const s of [txt, tight]){
    const m = s.match(_RE_BOLETO) || s.match(_RE_CONCESS);
    if(m){ const d = _concDig(m[0]); if(d.length >= 44 && d.length <= 48) return d; }
  }
  // Fallback por rótulo, pra formatos que não batam o padrão (pega 20+ dígitos após o label).
  const mL = txt.match(/(?:c[oó]digo de barras|linha digit\w*|representa[^:]{0,40}|identifica[^:]{0,40})[:\s]*([\d][\d.\s]{18,})/i);
  return mL ? _concDig(mL[1]) : '';
}

// PDF → por página: número do código de barras + nome do favorecido/beneficiário.
async function concLerPdf(file, onProg){
  const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  const paginas = [];
  for(let p=1; p<=pdf.numPages; p++){
    const tc = await (await pdf.getPage(p)).getTextContent();
    const txt = tc.items.map(it=>it.str).join(' ').replace(/\s+/g,' ');
    const mF = txt.match(/(?:favorecido|benefici[aá]rio|raz[aã]o social)[:\s]*(.+?)\s+(?:CPF|CNPJ|Nome|Valor|Data|Raz[aã]o|Ag[eê]ncia|$)/i);
    paginas.push({ pag:p, num:_concBarcode(txt), favorecido:(mF?mF[1]:'').trim() });
    if(onProg) onProg(p, pdf.numPages);
  }
  return paginas;
}

async function concCruzar(fileXlsx, filePdf){
  const msg=$('#concMsg'), go=$('#concGo');
  const setMsg = t => { if(msg) msg.textContent=t; };
  if(go) go.disabled=true;
  try{
    _concPdfFile = filePdf;   // guarda pra baixar páginas individuais depois
    setMsg('Carregando módulos de leitura…'); await concCarregarLibs();
    setMsg('Lendo a planilha…');            const idx = await concLerXlsx(fileXlsx);
    setMsg('Lendo os comprovantes…');       const paginas = await concLerPdf(filePdf, (p,n)=>setMsg('Lendo os comprovantes… '+p+'/'+n));
    const achados=[], faltam=[];
    paginas.forEach(pg=>{
      const hit = pg.num && idx.get(pg.num);
      if(hit) achados.push({ num:pg.num, nome:hit.nome||'(sem nome na planilha)', pag:pg.pag, linha:hit.linha });
      else    faltam.push({ pag:pg.pag, favorecido:pg.favorecido||'—', num:pg.num });
    });
    _concUltimo = { achados, faltam, total:paginas.length };
    setMsg(''); concRenderResultado();
    if(!achados.length) toast('Nenhum comprovante casou — confira se os arquivos são do mesmo malote','alert-triangle','var(--warning)');
  }catch(e){
    setMsg(''); toast((e&&e.message)||'Erro ao cruzar os arquivos','alert-triangle','var(--danger)');
  }finally{ if(go) go.disabled=false; }
}

function concRenderResultado(){
  const res=$('#concRes'); if(!res||!_concUltimo) return;
  const {achados,faltam,total}=_concUltimo;
  const btnDl = (pag,nome)=>'<button class="btn btn-outline sm nsh" data-action="conc-baixar" data-pag="'+pag+'" data-nome="'+esc(nome)+'" title="Baixar este comprovante (PDF)">'+icon('download',14)+'Baixar</button>';
  const ok = achados.map((a,i)=>'<tr><td class="t500">'+(i+1)+'</td><td class="fw6 t900">'+esc(a.nome)+'</td><td class="mono fz12 t700">'+esc(a.num)+'</td><td class="tcenter">'+a.pag+'</td><td class="tcenter">'+a.linha+'</td><td class="tright">'+btnDl(a.pag,a.nome)+'</td></tr>').join('')
    || '<tr><td colspan="6" class="tcenter t500" style="padding:24px">Nenhum comprovante conciliado.</td></tr>';
  const falt = faltam.map(f=>'<tr><td class="tcenter">'+f.pag+'</td><td class="t700">'+esc(f.favorecido)+'</td><td class="mono fz12 t700">'+esc((f.num||'—').slice(0,24))+'</td><td class="tright">'+btnDl(f.pag,f.favorecido)+'</td></tr>').join('');
  res.innerHTML =
    '<div class="fx ac g2 wrap" style="margin-bottom:14px">'
    + '<span class="pill success">'+achados.length+' conciliados</span>'
    + '<span class="pill '+(faltam.length?'warning':'neutral')+'">'+faltam.length+' não encontrados</span>'
    + '<span class="pill neutral">'+total+' comprovantes</span>'
    + '<div style="margin-left:auto"><button class="btn btn-outline sm" data-action="conc-excel">'+icon('file-spreadsheet',15)+'Exportar Excel</button></div>'
    + '</div>'
    + '<div class="card" style="overflow:hidden;margin-bottom:16px"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:720px"><thead><tr><th>#</th><th>Condomínio</th><th>Código de barras</th><th class="tcenter">Pág. PDF</th><th class="tcenter">Linha planilha</th><th class="tright">Comprovante</th></tr></thead><tbody>'+ok+'</tbody></table></div></div>'
    + (faltam.length ? '<div class="fz13 fw7" style="margin:4px 0 8px;color:var(--ondark)">'+icon('alert-triangle',15)+' Não encontrados — conferir manualmente</div><div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:600px"><thead><tr><th class="tcenter">Pág. PDF</th><th>Favorecido</th><th>Código lido</th><th class="tright">Comprovante</th></tr></thead><tbody>'+falt+'</tbody></table></div></div>' : '');
  refreshIcons();
}

function concExportarExcel(){
  if(!_concUltimo || !window.XLSX) return;
  const {achados,faltam}=_concUltimo;
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet([['#','Condomínio','Código de barras','Página PDF','Linha planilha'], ...achados.map((a,i)=>[i+1,a.nome,a.num,a.pag,a.linha])]);
  s1['!cols'] = [{wch:5},{wch:44},{wch:50},{wch:12},{wch:14}];  // larguras pra caber o texto
  XLSX.utils.book_append_sheet(wb, s1, 'Conciliados');
  const s2 = XLSX.utils.aoa_to_sheet([['Página PDF','Favorecido','Código lido'], ...faltam.map(f=>[f.pag,f.favorecido,f.num])]);
  s2['!cols'] = [{wch:12},{wch:40},{wch:50}];
  XLSX.utils.book_append_sheet(wb, s2, 'Não encontrados');
  XLSX.writeFile(wb, 'conciliacao-malote.xlsx');
}

RENDERERS.conciliacao = function(host){
  const inp = 'width:100%;padding:10px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;color:#fff;font-size:13px;font-family:var(--sans)';
  host.innerHTML = pageHead('Conciliação de Malote','Cruza os comprovantes (PDF) com a planilha do malote (Excel) pela representação numérica do código de barras. Os arquivos ficam só no seu computador — nada é enviado ao servidor.','')
    + '<div class="card" style="padding:20px;margin-bottom:16px;max-width:680px">'
    +   '<div class="fz13 fw6 t800" style="margin-bottom:8px">1) Planilha do malote (.xlsx)</div>'
    +   '<input id="concXlsx" type="file" accept=".xlsx,.xls" style="'+inp+'">'
    +   '<div class="fz13 fw6 t800" style="margin:16px 0 8px">2) Comprovantes (.pdf)</div>'
    +   '<input id="concPdf" type="file" accept="application/pdf,.pdf" style="'+inp+'">'
    +   '<div class="fx ac g2" style="margin-top:18px"><button class="btn btn-primary" id="concGo" disabled>'+icon('git-compare',16)+'Cruzar</button><span id="concMsg" class="fz12 tmut"></span></div>'
    + '</div>'
    + '<div id="concRes"></div>';
  const fx=$('#concXlsx'), fp=$('#concPdf'), go=$('#concGo');
  const upd = () => { if(go) go.disabled = !(fx&&fx.files[0] && fp&&fp.files[0]); };
  if(fx) fx.addEventListener('change', upd);
  if(fp) fp.addEventListener('change', upd);
  if(go) go.addEventListener('click', () => concCruzar(fx.files[0], fp.files[0]));
  if(_concUltimo) concRenderResultado();
  refreshIcons();
};

/* ---- Clicksign (gestor/administrativo) — assinatura REAL via ClickSign ----
   Visão geral dos envelopes; enviar/reenviar/cancelar ficam DENTRO de cada negócio
   (card "Assinatura eletrônica" no detalhe). Aqui é só o panorama + atalho "Abrir". */
RENDERERS.clicksign = function(host){
  const CLK_ST = { running:['Aguardando assinaturas','ai'], closed:['Assinado','success'], canceled:['Cancelado','neutral'], deadline:['Prazo expirado','danger'] };
  const linhas = DEALS.map(d=>{
    const st=d.clicksignEnv;
    const info = st ? (CLK_ST[st.status]||['—','neutral']) : ['Não enviado','neutral'];
    const ass = st ? (st.signatarios||[]).filter(s=>s.assinou).length : 0;
    const tot = st ? (st.signatarios||[]).length : 0;
    const ord = st ? ({running:0,deadline:1,closed:2,canceled:3})[st.status] ?? 4 : 5;
    return { d, info, ass, tot, ord };
  }).sort((a,b)=>a.ord-b.ord);
  const aguardando = linhas.filter(l=>l.d.clicksignEnv && l.d.clicksignEnv.status==='running').length;
  const assinados  = linhas.filter(l=>l.d.clicksignEnv && l.d.clicksignEnv.status==='closed').length;
  const tile=(l,v,c)=>'<div class="card" style="padding:16px"><div class="fz13 fw5 t500">'+l+'</div><div style="margin-top:6px;font-size:24px;font-weight:700;color:'+c+'">'+v+'</div></div>';
  host.innerHTML=pageHead('Clicksign','Assinatura eletrônica dos negócios. Enviar, reenviar e cancelar ficam dentro de cada negócio.')
  + '<div class="grid3" style="margin-bottom:16px">'+tile('Aguardando assinatura',aguardando,'#7C3AED')+tile('Assinados',assinados,'#16A34A')+tile('Negócios',DEALS.length,'var(--ink900)')+'</div>'
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:720px"><thead><tr><th>Negócio</th><th>Cliente</th><th>Tipo</th><th>Assinaturas</th><th>Status</th><th class="tright">Ações</th></tr></thead><tbody>'
  + (linhas.length?linhas.map(l=>{ const d=l.d; return '<tr data-deal="'+d.id+'" style="cursor:pointer"><td class="mono fz13 fw6 t900">'+esc(d.code)+'</td><td class="t700">'+esc(d.clienteNome)+'</td><td>'+pill(d.tipo,d.tipo==='Venda'?'info':'ai')+'</td><td class="t700">'+(l.tot?(l.ass+'/'+l.tot):'—')+'</td><td>'+pill(l.info[0],l.info[1])+'</td><td class="tright"><button class="btn btn-outline sm nsh" data-action="clk-abrir-neg" data-deal="'+d.id+'">'+icon('arrow-right',14)+'Abrir</button></td></tr>'; }).join(''):'<tr><td colspan="6" class="tcenter t500" style="padding:24px">Nenhum negócio ainda.</td></tr>')
  + '</tbody></table></div></div>';
  refreshIcons();
};

/* ---- Google Drive (administrativo) — sem integração ainda ---- */
RENDERERS.drive = function(host){
  emBreveTela(host,'Google Drive','Estrutura de pastas dos negócios.','hard-drive','A integração com o Google Drive (pastas por negócio, sincronização de anexos) depende de uma service account e ainda não está ligada. Cada negócio pode guardar um link do Drive na aba Negócios.');
};

/* ---- Agenda (corretor + administrativo) — eventos REAIS (listarEventos do Hub) ---- */
RENDERERS.agenda = function(host){
  host.innerHTML=pageHead('Agenda','Seus próximos eventos (visitas, vistorias, reuniões) — sincronizados com a Agenda do Hub.','<button class="btn btn-primary sm" data-action="hub-agenda">'+icon('calendar',16)+'Abrir agenda do Hub</button>')
    +'<div class="card" id="bkAgendaLista" style="padding:0;overflow:hidden"><div class="tcenter t500 fz13" style="padding:28px">Carregando agenda…</div></div>';
  carregarAgendaLista();
};
async function carregarAgendaLista(){
  const box=$('#bkAgendaLista'); if(!box) return;
  try{
    const h=new Date(); const ini=new Date(h.getFullYear(),h.getMonth(),h.getDate(),0,0,0);
    const fim=new Date(ini.getTime()+30*86400000);
    const r=await fnEventos({ de:ini.toISOString(), ate:fim.toISOString() });
    const evs=((r&&r.data)||[]).filter(e=>e.meuRsvp!=='recusado').sort((a,b)=>(a.inicio||'').localeCompare(b.inicio||''));
    const b2=$('#bkAgendaLista'); if(!b2) return;   // navegou pra outra tela
    if(!evs.length){ b2.innerHTML='<div class="tcenter t500 fz13" style="padding:28px">Nenhum evento nos próximos 30 dias. Crie um na Agenda do Hub.</div>'; return; }
    let cur='',html='';
    evs.forEach(e=>{ const dt=new Date(e.inicio); const dia=isNaN(dt)?'—':dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}); const hh=isNaN(dt)?'--:--':dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      if(dia!==cur){ cur=dia; html+='<div class="up fz12 fw7 t500" style="padding:12px 20px 6px;background:var(--ink50)">'+esc(dia)+'</div>'; }
      html+='<div class="fx ac g3" style="padding:12px 20px;border-top:1px solid var(--ink100)"><span class="fz13 fw7 t900 mono nsh" style="width:46px">'+hh+'</span>'+iconChip('calendar','info',32)+'<div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(e.titulo||'Evento')+'</div>'+(e.descricao?'<div class="fz12 t500 trunc">'+esc(e.descricao)+'</div>':'')+'</div></div>';
    });
    b2.innerHTML=html; refreshIcons();
  }catch(e){ const b=$('#bkAgendaLista'); if(b) b.innerHTML='<div class="tcenter t500 fz13" style="padding:28px">Não consegui carregar a agenda. <button class="btn btn-outline sm" data-action="hub-agenda" style="margin-left:8px">Abrir no Hub</button></div>'; refreshIcons(); }
}

/* ---- Relatórios Operacionais (administrativo) — REAL, sem financeiro ---- */
function relatoriosAdmin(host){
  const cnt=raw=>DEALS.filter(d=>d.statusRaw===raw).length;
  const docsPend=DEALS.filter(d=>(d.checklist||[]).some(x=>x.obrigatoria&&!x.feito)).length;
  const assin=DEALS.filter(d=>d.clicksign==='Enviado').length;
  const stale=DEALS.filter(d=>d.diasParado>7 && d.statusRaw!=='entregue_gestao' && d.statusRaw!=='concluido').length;
  const tile=(l,v,s)=>'<div class="card" style="padding:18px"><div class="fz13 fw5 t500">'+l+'</div><div style="margin-top:8px;font-size:26px;font-weight:700;color:var(--ink900)">'+v+'</div><div class="fz12 t500" style="margin-top:4px">'+s+'</div></div>';
  const ETAPAS=[['Novos',cnt('negocio_criado'),'#2563EB'],['Em andamento',cnt('em_andamento')+cnt('aguardando_corretor'),'#7C3AED'],['Aguardando',cnt('aguardando_administrativo')+cnt('aguardando_broker'),'#F59E0B'],['Entregues',cnt('entregue_gestao'),'#0EA5E9'],['Concluídos',cnt('concluido'),'#16A34A']];
  const mx=Math.max(1,...ETAPAS.map(e=>e[1]));
  host.innerHTML=pageHead('Relatórios Operacionais','Indicadores de execução — sem dados financeiros.')
  + '<div class="grid3">'+[tile('Negócios ativos',String(KPI.ativos),'no total'),tile('Documentações pendentes',String(docsPend),'a regularizar'),tile('Contratos p/ assinatura',String(assin),'no Clicksign'),tile('Entregues à gestão',String(cnt('entregue_gestao')),'no período'),tile('Concluídos',String(cnt('concluido')),'no período'),tile('Parados +7 dias',String(stale),'precisam de ação')].join('')+'</div>'
  + '<div class="card" style="padding:20px;margin-top:16px"><div class="fz13 fw6 t800" style="margin-bottom:14px">Negócios por etapa</div><div class="fx col g3">'+ETAPAS.map(c=>'<div class="fx ac g3"><span class="fz12 t500 tright nsh" style="width:150px">'+c[0]+'</span><div class="grow" style="height:22px;border-radius:6px;background:var(--ink100);overflow:hidden"><div class="fx ac" style="height:100%;border-radius:6px;padding:0 8px;color:#fff;font-size:12px;font-weight:600;width:'+Math.max(Math.round(c[1]/mx*100),8)+'%;background:'+c[2]+'">'+c[1]+'</div></div></div>').join('')+'</div></div>';
}
const _relBroker = RENDERERS.relatorios;
RENDERERS.relatorios = function(host){ if(state.role==='administrativo') return relatoriosAdmin(host); return _relBroker(host); };

/* Ações extras de fichas (corretor) e salvar perfil — estende o handleAction. */
const _handleAction = handleAction;
const emBreve=(msg)=>toast(msg||'Em breve nesta visão.','sparkles','var(--brand)');
handleAction = function(a, el){
  if(a==='imovel-compartilhar'){
    const url=el.dataset.url||''; const titulo=el.dataset.titulo||'Imóvel';
    const d=el.closest('details'); if(d) d.open=false;
    if(!url){ toast('Sem link do anúncio.','info'); return; }
    const copiar=()=>{ try{ navigator.clipboard.writeText(url); }catch(e){} toast('Link copiado — cole onde quiser compartilhar','copy'); };
    try{
      if(navigator.share){ navigator.share({ title:titulo, text:titulo, url:url }).catch(err=>{ if(err&&err.name!=='AbortError') copiar(); }); }
      else { copiar(); }
    }catch(e){ copiar(); }
    return;
  }
  if(a==='ficha-copy'){ const l=fichaLink(el.dataset.arq); try{ navigator.clipboard.writeText(l); }catch(e){} toast('Link da ficha '+(el.dataset.nome||'')+' copiado','copy'); return; }
  if(a==='ficha-whats'){ const l=fichaLink(el.dataset.arq); window.open('https://wa.me/?text='+encodeURIComponent('Olá! Segue o link da ficha cadastral. Ao concluir, me avise pra dar continuidade.\n\n'+l),'_blank'); return; }
  if(a==='ficha-email'){ const l=fichaLink(el.dataset.arq); const su=encodeURIComponent('Ficha cadastral — REMAX SMART'); const body=encodeURIComponent('Olá! Segue o link da ficha cadastral:\n\n'+l); window.open('https://mail.google.com/mail/?view=cm&fs=1&tf=1&su='+su+'&body='+body,'_blank'); return; }
  if(a==='ficha-view'){ window.open(fichaLink(el.dataset.arq),'_blank'); return; }
  if(a==='salvar-perfil'){
    const payload={ telefone:($('#pfTel')||{}).value||'', creci:($('#pfCreci')||{}).value||'', cpf:($('#pfCpf')||{}).value||'' };
    toast('Salvando…','loader-2','var(--brand)');
    fnSalvarPerfil(payload).then(()=>{ if(state.perfilCache) Object.assign(state.perfilCache,payload); toast('Perfil salvo'); }).catch(e=>toast(e.message||'Erro','alert-triangle','var(--danger)'));
    return;
  }
  // Filtros / toggles das telas novas
  if(a==='clifiltro'){ state.cliFiltro=el.dataset.v; RENDERERS.clientes($('#root')); refreshIcons(); return; }
  if(a==='agview'){ state.agView=el.dataset.v; RENDERERS.agenda($('#root')); refreshIcons(); return; }
  if(a==='drivetipo'){ state.driveTipo=el.dataset.v; RENDERERS.drive($('#root')); refreshIcons(); return; }
  // Atalhos do corretor
  if(a==='novo-menu'){ openNovoMenu(); return; }
  if(a==='novo-cliente'||a==='novo-imovel'){
    closeModal();
    // Cliente e imóvel nascem de uma FICHA — leva pro Cadastro do Hub (todas as fichas).
    if(!(window.hubAbrirCategoria && window.hubAbrirCategoria('documentos'))){ navigate('dashboard'); toast('Envie a ficha na seção "Fichas digitais"','clipboard-list','var(--brand)'); }
    return;
  }
  if(a==='novo-negocio'){
    closeModal();
    // O negócio é GERADO a partir de um interessado aprovado no imóvel (decisão do gestor).
    navigate('imoveis');
    toast('O negócio nasce de um interessado aprovado no imóvel — abra o imóvel para gerar','handshake','var(--brand)');
    return;
  }
  if(a==='agendar-visita'||a==='hub-agenda'){
    closeModal();
    // Agenda de verdade é a do HUB (a interna saiu do menu). Fallback: tela interna.
    if(!(window.hubAbrirCategoria && window.hubAbrirCategoria('agenda'))) navigate('agenda');
    return;
  }
  if(a==='enviar-ficha'){ closeModal(); navigate('dashboard'); toast('Escolha a ficha na seção "Fichas digitais"','clipboard-list','var(--brand)'); return; }
  if(a==='whatsapp-quick'){ window.open('https://web.whatsapp.com/','_blank'); return; }
  if(a==='abrir-drive'){ window.open('https://drive.google.com','_blank'); return; }
  if(a==='clicksign'){
    if(state.role==='administrativo'){ navigate('clicksign'); return; }
    // Integra com o app ClickSign do Hub (restrito — o Hub checa a permissão).
    if(!(window.hubAbrirApp && window.hubAbrirApp('clicksign'))) emBreve('ClickSign é liberado por pessoa no Admin do Hub.');
    return;
  }
  if(a==='clk-open'){ if(!(window.hubAbrirApp && window.hubAbrirApp('clicksign'))) emBreve('ClickSign é liberado por pessoa no Admin do Hub.'); return; }
  if(a==='clk-abrir-neg'){ if(el.dataset.deal) openDeal(el.dataset.deal); return; }
  if(a==='clk-enviar'){ const d=DEALS.find(x=>x.id===state.currentDeal)||(DEALS_DOCS||[]).find(x=>x.id===state.currentDeal); if(d) clkEnviarModal(d); return; }
  if(a==='clk-sig-add'){ const box=$('#clkSigs'); if(box){ box.insertAdjacentHTML('beforeend', _clkSigRow()); refreshIcons(); } return; }
  if(a==='clk-sig-rm'){ const row=el.closest('.clk-sig-row'); const box=$('#clkSigs'); if(row&&box&&box.querySelectorAll('.clk-sig-row').length>1) row.remove(); return; }
  if(a==='clk-enviar-go'){
    const negocioId=state.currentDeal; if(!negocioId) return;
    const docSel=document.querySelector('#modal input[name="clkDoc"]:checked'); const docId=docSel?docSel.value:'';
    if(!docId){ toast('Escolha um documento','alert-triangle','var(--danger)'); return; }
    const signatarios=[]; let erro='';
    document.querySelectorAll('#clkSigs .clk-sig-row').forEach(r=>{
      const nome=(r.querySelector('.clk-nome')||{}).value||''; const email=((r.querySelector('.clk-email')||{}).value||'').trim(); const cpf=(r.querySelector('.clk-cpf')||{}).value||'';
      if(!nome.trim() && !email) return;   // linha vazia é ignorada
      // O ClickSign exige NOME COMPLETO (nome + sobrenome) — nome de 1 palavra é recusado lá.
      if(nome.trim().split(/\s+/).length < 2){ erro='Use o nome completo do signatário (nome e sobrenome).'; return; }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ erro='E-mail inválido em um dos signatários.'; return; }
      signatarios.push({nome:nome.trim(), email:email.toLowerCase(), cpf});
    });
    if(erro){ toast(erro,'alert-triangle','var(--danger)'); return; }
    if(!signatarios.length){ toast('Informe ao menos um signatário','alert-triangle','var(--danger)'); return; }
    const mensagem=((document.querySelector('#clkMsg')||{}).value||'').trim();
    const prazoDias=parseInt((document.querySelector('#clkPrazo')||{}).value,10)||0;
    if(el.dataset.busy) return; el.dataset.busy='1'; el.innerHTML=icon('loader-2',15)+'Enviando…'; refreshIcons();
    fnClkEnviar({negocioId, docId, signatarios, mensagem, prazoDias})
      .then(()=>{ closeModal(); toast('Enviado para assinatura','file-signature','var(--success)'); return reloadDealDetalhe(negocioId); })
      .catch(e=>{ el.dataset.busy=''; el.innerHTML=icon('send',15)+'Enviar'; refreshIcons(); toast((e&&e.message)||'Falha ao enviar','alert-triangle','var(--danger)'); });
    return;
  }
  if(a==='clk-reenviar'){
    const negocioId=state.currentDeal; if(!negocioId) return;
    if(el.dataset.busy) return; el.dataset.busy='1';
    fnClkReenviar({negocioId}).then(()=>toast('Lembrete reenviado','mail','var(--success)')).catch(e=>toast((e&&e.message)||'Falha','alert-triangle','var(--danger)')).finally(()=>{ el.dataset.busy=''; });
    return;
  }
  if(a==='clk-cancelar'){
    const negocioId=state.currentDeal; if(!negocioId) return;
    if(!confirm('Cancelar a assinatura no ClickSign?\n\nO documento deixa de poder ser assinado. Esta ação não pode ser desfeita.')) return;
    fnClkCancelar({negocioId}).then(()=>{ toast('Assinatura cancelada','x','var(--danger)'); return reloadDealDetalhe(negocioId); }).catch(e=>toast((e&&e.message)||'Falha','alert-triangle','var(--danger)'));
    return;
  }
  if(a==='gerar-contrato'){
    if(typeof window.hubGerarContratoVenda!=='function'){ emBreve('Geração de contrato disponível no Hub.'); return; }
    toast('Gerando contrato…','loader-2','var(--brand)');
    window.hubGerarContratoVenda(el.dataset.imovel).then(r=>{ toast((r&&r.msg)||'Pronto', (r&&r.ok)?'file-text':'alert-triangle', (r&&r.ok)?'var(--success)':'var(--danger)'); });
    return;
  }
  if(a==='add-doc'){ openImovelDocUpload(state.currentProp); return; }
  if(a==='imovel-doc-send'){
    const imovelId=($('#imDocId')||{}).value, errEl=$('#imDocErr');
    const f=($('#imDocFile')||{}).files && $('#imDocFile').files[0];
    if(!f){ if(errEl) errEl.textContent='Escolha um arquivo.'; return; }
    if(f.size>20*1024*1024){ if(errEl) errEl.textContent='Arquivo acima de 20MB.'; return; }
    if(!_docTipoOk(f)){ if(errEl) errEl.textContent='Tipo não aceito. Use PDF, imagem ou documento (Word, Excel, PowerPoint).'; return; }
    el.disabled=true; if(errEl) errEl.textContent='Enviando…';
    const rd=new FileReader();
    rd.onload=async()=>{ try{
        const b64=String(rd.result||'').split(',')[1]||'';
        await fnImovelDoc({imovelId, nome:f.name, mime:f.type||'application/octet-stream', base64:b64});
        toast('Documento enviado','check'); closeModal(); await carregarDados();
        const dr=$('#drawer'); if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId);
      }catch(e){ if(errEl) errEl.textContent=e.message||'Erro ao enviar'; try{el.disabled=false;}catch(_e){} } };
    rd.onerror=()=>{ if(errEl) errEl.textContent='Falha ao ler o arquivo.'; try{el.disabled=false;}catch(_e){} };
    rd.readAsDataURL(f);
    return;
  }
  if(a==='imovel-doc-remover'){ if(!confirm('Remover o documento “'+(el.dataset.nome||'')+'”?'))return; const imovelId=el.dataset.imovel; el.disabled=true; fnImovelDocRm({imovelId, docId:el.dataset.doc}).then(async()=>{ toast('Documento removido','trash-2'); await carregarDados(); const dr=$('#drawer'); if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId); }).catch(e=>{ toast(e.message||'Erro','alert-triangle','var(--danger)'); try{el.disabled=false;}catch(_e){} }); return; }
  if(a==='concluir-proxima'){
    const d=DEALS.find(x=>x.id===state.currentDeal); if(!d) return;
    const nx=(d.checklist||[]).find(x=>!x.feito);
    if(!nx){ toast('Todas as etapas já estão concluídas'); return; }
    negAtualizar({negocioId:d.id, acao:'checklist', key:nx.key, feito:true}, 'Etapa concluída: '+(nx.label||''));
    return;
  }
  // Interessados (gestor): aprovar / reprovar / gerar negócio
  if(a==='baixar-ficha-pdf'){ const b=el; if(b.dataset.busy)return; b.dataset.busy='1'; const oh=b.innerHTML; b.disabled=true; b.innerHTML='Gerando…'; fnFichaPdf({fichaId:b.dataset.ficha, colecao:b.dataset.col||''}).then(r=>{ const d=(r&&r.data)||r; baixarPdfBase64(d.base64,d.filename); toast('PDF gerado','download'); }).catch(e=>toast(e.message||'Erro ao gerar PDF','alert-triangle','var(--danger)')).finally(()=>{ try{ b.disabled=false; b.innerHTML=oh; delete b.dataset.busy; refreshIcons(); }catch(_e){} }); return; }
  if(a==='int-ficha-copy'){ const l=fichaLinkImovel(el.dataset.arq, el.dataset.imovel); try{ navigator.clipboard.writeText(l); }catch(e){} toast('Link da ficha copiado — mande ao interessado','copy'); return; }
  if(a==='prop-ficha-copy'){ const l=fichaLinkImovel(el.dataset.arq, el.dataset.imovel); try{ navigator.clipboard.writeText(l); }catch(e){} toast('Link da ficha copiado — mande ao proprietário do imóvel','copy'); return; }
  if(a==='copiar-fone'){ try{ navigator.clipboard.writeText(el.dataset.valor||''); }catch(e){} toast('Telefone copiado','copy'); return; }
  if(a==='copiar-email'){ try{ navigator.clipboard.writeText(el.dataset.valor||''); }catch(e){} toast('E-mail copiado','copy'); return; }
  if(a==='prop-info'){ openProprietario(); return; }
  if(a==='prop-ficha-link'){ const link=fichaLinkImovel(el.dataset.arq, el.dataset.imovel); try{ navigator.clipboard.writeText(link); }catch(_e){} toast('Link copiado! Envie ao proprietário — a ficha entra neste imóvel.','clipboard-check','var(--success)'); return; }
  if(a==='prop-vincular'){ openVincularProp(el.dataset.imovel, el.dataset.fin||'locacao'); return; }
  if(a==='prop-vincular-do'){ vincularProprietario(el.dataset.imovel, el.dataset.ficha, el.dataset.tipo); return; }
  if(a==='neg-excluir'){ if(!confirm('Tem certeza que deseja EXCLUIR o negócio '+(el.dataset.codigo||'')+'?\n\nEsta ação é PERMANENTE e não pode ser desfeita. O imóvel volta a Disponível.')) return; const id=state.currentDeal; fnNegExcluir({negocioId:id}).then(()=>{ [DEALS, DEALS_DOCS].forEach(arr=>{ if(Array.isArray(arr)){ const i=arr.findIndex(x=>x&&x.id===id); if(i>=0) arr.splice(i,1); } }); try{ recalcKPI(); }catch(_e){} state._viewingDeal=false; toast('Negócio excluído','trash-2','var(--danger)'); navigate('negocios'); }).catch(e=>toast(e.message||'Erro ao excluir','alert-triangle','var(--danger)')); return; }
  if(a==='imovel-excluir'){ if(!confirm('Tem certeza que deseja EXCLUIR o imóvel "'+(el.dataset.rua||'')+'"?\n\nEsta ação é PERMANENTE e não pode ser desfeita.')) return; const iid=el.dataset.imovel; fnImovelExcluir({imovelId:iid}).then(()=>{ [PROPERTIES, PROPERTIES_ALL].forEach(arr=>{ if(Array.isArray(arr)){ const idx=arr.findIndex(p=>p&&p.id===iid); if(idx>=0) arr.splice(idx,1); } }); closeDrawer(); state._viewingDeal=false; /* a lista substitui o detalhe; sem isso o realtime fica travado */ toast('Imóvel excluído','trash-2','var(--danger)'); if(RENDERERS[state.view]){ RENDERERS[state.view]($('#root')); refreshIcons(); } }).catch(e=>toast(e.message||'Erro ao excluir','alert-triangle','var(--danger)')); return; }
  if(a==='kmove-open'){ openKanbanMovePicker(el.dataset.deal); return; }
  if(a==='kmove-to'){ closeModal(); kanbanMove(el.dataset.deal, el.dataset.col); return; }
  if(a==='kanban-gerenciar'){ openKanbanGerenciar(); return; }
  if(a==='col-add'){ _colCaptura(); (state._colEdit=state._colEdit||[]).push({id:_colGenId(), label:''}); renderKanbanGerenciar(); return; }
  if(a==='col-rm'){ _colCaptura(); state._colEdit.splice(+el.dataset.i,1); renderKanbanGerenciar(); return; }
  if(a==='col-up'){ _colCaptura(); const i=+el.dataset.i; if(i>0){ const A=state._colEdit; const t=A[i-1]; A[i-1]=A[i]; A[i]=t; } renderKanbanGerenciar(); return; }
  if(a==='col-down'){ _colCaptura(); const i=+el.dataset.i; const A=state._colEdit; if(i<A.length-1){ const t=A[i+1]; A[i+1]=A[i]; A[i]=t; } renderKanbanGerenciar(); return; }
  if(a==='col-salvar'){ salvarKanbanColunas(); return; }
  if(a==='ir-comentarios'){ state.dealTab='comentarios'; openDeal(state.currentDeal, {tabsOnly:true}); setTimeout(()=>{ const el=$('#bkDealTabs'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }, 60); return; }
  if(a==='drive-sync-real'){ syncNegocioDrive(); return; }
  if(a==='drive-destino-edit'){ openDriveDestino(); return; }
  if(a==='drive-destino-save'){
    const url=(($('#ddUrl')||{}).value||'').trim(); const errEl=$('#ddErr');
    // Validação leve aqui (o servidor extrai/valida o id de verdade): tem que parecer
    // link de pasta do Drive — pega link de ARQUIVO colado por engano.
    if(url && !/drive\.google\.com/.test(url)){ if(errEl) errEl.textContent='Cole um link do Google Drive (…/drive/folders/…).'; return; }
    if(url && /\/file\//.test(url)){ if(errEl) errEl.textContent='Esse é o link de um ARQUIVO — cole o link da PASTA (…/drive/folders/…).'; return; }
    el.disabled=true; if(errEl) errEl.textContent='Salvando…';
    negAtualizar({negocioId:state.currentDeal, acao:'drive_destino', url}, url?'Pasta destino definida':'Pasta destino removida (padrão)').then(ok=>{ if(ok!==false) closeModal(); else if(errEl) errEl.textContent=''; }).finally(()=>{ try{el.disabled=false;}catch(_e){} });
    return;
  }
  if(a==='campos-salvar'){ const v=id=>{const e=$('#'+id); return e?e.value:undefined;}; const campos={}; if($('#cpAdm')) campos.administracao=v('cpAdm'); if($('#cpParceria')) campos.parceria=v('cpParceria'); if($('#cpRef')) campos.referenciamento=v('cpRef'); if($('#cpParceiraNome')) campos.imobiliariaParceira=v('cpParceiraNome'); if($('#cpComRec')) campos.comissaoRecebida=v('cpComRec'); el.disabled=true; negAtualizar({negocioId:state.currentDeal, acao:'campos', campos}, 'Informações salvas').finally(()=>{ try{ el.disabled=false; }catch(_e){} }); return; }
  if(a==='proposta-salvar'){ const v=id=>{const e=$('#'+id); return e?e.value.trim():undefined;}; const proposta={}; const map={ppInicio:'inicio',ppValorAcordado:'valorAcordado',ppPrazo:'prazo',ppTaxaAdm:'taxaAdm',ppSinal:'sinal',ppSinalData:'sinalData',ppParcelaA:'parcelaA',ppParcelaAData:'parcelaAData',ppParcelaB:'parcelaB',ppParcelaBData:'parcelaBData',ppFgts:'fgts',ppFgtsValor:'fgtsValor',ppFinanciamento:'financiamento'}; Object.entries(map).forEach(([id,k])=>{ const val=v(id); if(val!==undefined) proposta[k]=val; }); const payload={negocioId:state.currentDeal, acao:'proposta', proposta}; const cp=$('#ppComPct'); if(cp){ const raw=(cp.value||'').replace('%','').replace(',','.').trim(); const pct=raw===''?0:parseFloat(raw); if(!isFinite(pct)||pct<0||pct>100){ toast('Taxa de comissão inválida — use um número entre 0 e 100.','alert-triangle','var(--danger)'); return; } payload.comissaoPct=pct; } el.disabled=true; negAtualizar(payload, 'Proposta salva').finally(()=>{ try{ el.disabled=false; }catch(_e){} }); return; }
  if(a==='comissao-edit'){ openComissaoModal(); return; }
  if(a==='comissao-salvar'){ const raw=(($('#comPctInp')||{}).value||'').replace(',','.'); const pct=parseFloat(raw); if(!isFinite(pct)||pct<0||pct>100){ const err=$('#comPctErr'); if(err) err.textContent='Digite um percentual entre 0 e 100 (0 volta ao padrão).'; return; } closeModal(); negAtualizar({negocioId:state.currentDeal, acao:'comissao', pct}, pct===0?'Comissão restaurada ao padrão':'Comissão atualizada'); return; }
  if(a==='origem-edit'){ openOrigemModal(el.dataset.origem||''); return; }
  if(a==='origem-salvar'){ const v=(($('#origemInp')||{}).value||'').trim(); closeModal(); negAtualizar({negocioId:state.currentDeal, acao:'origem', origem:v}, 'Origem salva'); return; }
  // Assistente IA do negócio (Gemini): sugere próxima ação + rascunho de mensagem.
  if(a==='ia-sugerir'){
    const box=$('#bkIaBox'); if(!box) return;
    const oh=el.innerHTML; el.disabled=true; el.innerHTML=icon('loader-2',15)+'Gerando…';
    box.innerHTML='<div class="fz12 t500" style="padding:10px 2px">'+icon('loader-2',14)+' A IA está analisando o negócio…</div>'; refreshIcons();
    fnSugAcao({negocioId:state.currentDeal}).then(r=>{
      const dd=(r&&r.data)||r||{}; const acao=dd.acao||''; const msg=dd.mensagem||'';
      box.innerHTML='<div style="margin-top:12px;padding:14px;border:1px solid var(--ink200);border-radius:10px;background:var(--ink50)">'
        + (acao?'<div class="up fz11 fw7 t800" style="margin-bottom:6px">Próxima ação sugerida</div><div class="fz13 t900" style="margin-bottom:14px;white-space:pre-wrap">'+esc(acao)+'</div>':'')
        + (msg?'<div class="up fz11 fw7 t800" style="margin-bottom:6px">Rascunho de mensagem ao cliente</div><textarea id="bkIaMsg" class="input" rows="5" style="width:100%;height:auto;resize:vertical;padding:10px 12px">'+esc(msg)+'</textarea>'
            + '<div class="fx g2 wrap" style="margin-top:8px"><button class="btn btn-outline sm" data-action="ia-copiar">'+icon('copy',14)+'Copiar mensagem</button><button class="btn btn-ghost sm" data-action="ia-whats">'+icon('message-circle',14)+'Abrir no WhatsApp</button></div>':'')
        + '<div class="fz11 t400" style="margin-top:12px">Sugestão de IA — revise antes de enviar. A IA pode errar.</div></div>';
      refreshIcons();
    }).catch(e=>{ box.innerHTML='<div class="fz12" style="color:var(--danger);padding:8px 2px">'+esc(e.message||'Não consegui gerar agora. Tente de novo.')+'</div>'; })
    .finally(()=>{ try{ el.disabled=false; el.innerHTML=oh; refreshIcons(); }catch(_e){} });
    return;
  }
  if(a==='ia-copiar'){ const t=(($('#bkIaMsg')||{}).value)||''; try{ navigator.clipboard.writeText(t); }catch(e){} toast('Mensagem copiada','copy'); return; }
  if(a==='ia-whats'){ const t=(($('#bkIaMsg')||{}).value)||''; window.open('https://wa.me/?text='+encodeURIComponent(t),'_blank'); return; }
  if(a==='int-ver-ficha'){ const map={proposta:'ficha-proposta.html',pf:'ficha-pf.html',pj:'ficha-pj.html',locacao_fiador:'ficha-locacao-fiador.html',fianca:'ficha-fianca.html',vendedor:'ficha-vendedor.html',locador:'ficha-locador.html'}; const arq=map[el.dataset.tipo]||'ficha-proposta.html'; const url=FICHA_HOST+'/'+arq+'?modo=corretor&idFicha='+encodeURIComponent(el.dataset.ficha||'')+'&origem=hub'; if(window.hubApi&&window.hubApi.abrirFicha){ window.hubApi.abrirFicha(url,'Ficha do interessado'); } else { window.open(url,'_blank'); } return; }
  if(a==='alterar-valor'){ openAlterarValor(el.dataset.imovel); return; }
  if(a==='alterar-valor-save'){ salvarNovoValor(el.dataset.imovel); return; }
  if(a==='int-add-open'){ openInteressadoPicker(el.dataset.imovel); return; }
  if(a==='int-add-pick'){ const f=_intPickCache[el.dataset.ficha]; if(!f)return; const imovelId=el.dataset.imovel; const _imf=(typeof prop==='function'?prop(imovelId):null)||{}; const _fin=_imf.finalidadeRaw||''; const tipo = _fin==='venda' ? 'comprador' : _fin==='locacao' ? 'locatario' : (f.tipo==='proposta'?'comprador':'locatario'); /* papel vem da finalidade do imóvel, não do tipo da ficha */ el.disabled=true; fnInteressado({imovelId, acao:'add', nome:f.nome||'(sem nome)', contato:f.telefone||f.email||'', tipo, status:'em_analise', fichaId:f.id, fichaTipo:f.tipo, email:f.email||'', cpf:f.cpf||'', telefone:f.telefone||''}).then(async()=>{ toast('Interessado adicionado','user-plus'); closeModal(); await carregarDados(); const dr=$('#drawer'); if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId); }).catch(e=>{ toast(e.message||'Erro','alert-triangle','var(--danger)'); try{el.disabled=false;}catch(_e){} }); return; }
  if(a==='int-remover'){ if(!confirm('Remover este interessado do imóvel?'))return; const imovelId=el.dataset.imovel, idx=+el.dataset.idx; el.disabled=true; fnInteressado({imovelId, acao:'remover', index:idx, esperaNome:el.dataset.nome||'', esperaFichaId:el.dataset.fid||''}).then(async()=>{ toast('Interessado removido','trash-2'); await carregarDados(); const dr=$('#drawer'); if(state.currentProp===imovelId && dr && dr.classList.contains('show')) openProp(imovelId); }).catch(e=>{ toast(e.message||'Erro','alert-triangle','var(--danger)'); try{el.disabled=false;}catch(_e){} }); return; }
  if(a==='int-aprovar'){ el.disabled=true; interessadoAcao(el.dataset.imovel, +el.dataset.idx, 'aprovado', 'Interessado aprovado', {nome:el.dataset.nome, fid:el.dataset.fid}).finally(()=>{ try{ el.disabled=false; }catch(_e){} }); return; }
  if(a==='int-reprovar'){ if(confirm('Reprovar este interessado?')){ el.disabled=true; interessadoAcao(el.dataset.imovel, +el.dataset.idx, 'reprovado', 'Interessado reprovado', {nome:el.dataset.nome, fid:el.dataset.fid}).finally(()=>{ try{ el.disabled=false; }catch(_e){} }); } return; }
  if(a==='int-gerar'){ if(confirm('Gerar o negócio deste interessado? O imóvel entra em negociação.')){ el.disabled=true; gerarNegocioUI(el.dataset.imovel, +el.dataset.idx, {nome:el.dataset.nome, fid:el.dataset.fid}).finally(()=>{ try{ el.disabled=false; }catch(_e){} }); } return; }
  // Documentos do negócio (gestor/adm sobe; corretor só baixa)
  if(a==='doc-upload-open'){ openDocUpload(); return; }
  if(a==='deal-doc-add'){ openDocUpload(state.currentDeal); return; }
  if(a==='doc-upload-send'){
    const dealId=($('#docDeal')||{}).value, cat=($('#docCat')||{}).value, errEl=$('#docErr');
    // Captura o destino do Drive AGORA (síncrono): se lido só no rd.onload, um Cancelar
    // no meio da leitura do arquivo esvazia o modal e cairia em 'outros' em silêncio.
    const dest=(($('#docDrive')||{}).value)||'outros';
    const f=($('#docFile')||{}).files && $('#docFile').files[0];
    if(!f){ if(errEl) errEl.textContent='Escolha um arquivo.'; return; }
    if(f.size>20*1024*1024){ if(errEl) errEl.textContent='Arquivo acima de 20MB.'; return; }
    // Valida o tipo AQUI (antes de ler os ~15MB): SVG e tipos fora da lista são
    // recusados pelo servidor de qualquer jeito — pegar cedo evita o upload inútil.
    if(!_docTipoOk(f)){ if(errEl) errEl.textContent='Tipo não aceito. Use PDF, imagem ou documento (Word, Excel, PowerPoint).'; return; }
    el.disabled=true; if(errEl) errEl.textContent='Enviando…';
    const rd=new FileReader();
    rd.onload=async()=>{ try{
        const b64=String(rd.result||'').split(',')[1]||'';
        await fnAnexarDoc({negocioId:dealId, categoria:cat, driveDestino:dest, nome:f.name, mime:f.type||'application/octet-stream', base64:b64});
        toast('Documento enviado','check'); closeModal(); await carregarDados(); if(state.view==='documentos') navigate('documentos'); else if(state.currentDeal && state._viewingDeal) openDeal(state.currentDeal);
      }catch(e){ if(errEl) errEl.textContent=e.message||'Erro ao enviar'; try{el.disabled=false;}catch(_e){} } };
    rd.onerror=()=>{ if(errEl) errEl.textContent='Falha ao ler o arquivo.'; try{el.disabled=false;}catch(_e){} };
    rd.readAsDataURL(f);
    return;
  }
  if(a==='doc-remover'){ if(!confirm('Remover o documento “'+(el.dataset.nome||'')+'”?'))return; el.disabled=true; fnRemoverDoc({negocioId:el.dataset.deal, docId:el.dataset.doc}).then(async()=>{ toast('Documento removido','trash-2'); await carregarDados(); if(state.view==='documentos') navigate('documentos'); else if(state.currentDeal && state._viewingDeal) openDeal(state.currentDeal); }).catch(e=>{ toast(e.message||'Erro','alert-triangle','var(--danger)'); try{el.disabled=false;}catch(_e){} }); return; }
  // Negócio (gestor): entregar / concluir / cancelar
  if(a==='neg-entregar'){ if(confirm('Entregar este negócio para a gestão? (exige as etapas obrigatórias)')) negAtualizar({negocioId:state.currentDeal, acao:'entregar'}, 'Entregue para a gestão'); return; }
  if(a==='neg-concluir'){ if(confirm('Concluir este negócio? (exige as etapas obrigatórias)')) negAtualizar({negocioId:state.currentDeal, acao:'concluir'}, 'Negócio concluído'); return; }
  if(a==='neg-cancelar'){ openCancelarModal(); return; }
  if(a==='neg-cancelar-save'){ const sel=$('#cancMotivo'), det=$('#cancDetalhe'); const cat=sel?sel.value:''; const detalhe=det?det.value.trim():''; const motivo=detalhe?(cat+' — '+detalhe):cat; if(el) el.disabled=true; closeModal(); negAtualizar({negocioId:state.currentDeal, acao:'cancelar', motivo}, 'Negócio cancelado'); return; }
  if(a==='neg-arquivar'){ if(confirm('Arquivar este negócio? Ele sai da lista de Negócios, mas continua no histórico e nos relatórios.')) negAtualizar({negocioId:state.currentDeal, acao:'arquivar'}, 'Negócio arquivado'); return; }
  if(a==='neg-desarquivar'){ negAtualizar({negocioId:state.currentDeal, acao:'desarquivar'}, 'Negócio desarquivado'); return; }
  // Ações operacionais de demonstração (administrativo)
  if(['upload-doc','preview-doc','download-doc','drive-sync','drive-new','reenviar-ficha','alterar-senha','maps','editar','notif'].indexOf(a)>=0){ emBreve('Ação de demonstração — integração em breve.'); return; }
  return _handleAction(a, el);
};

/* Busca da Fila de Trabalho — listener próprio no #bkRoot (o de wireEvents não cobre filaBusca). */
(function(){ const r=ROOT(); if(r) r.addEventListener('input', e=>{ const t=e.target.closest('[data-input="filaBusca"]'); if(t){ state.filaBusca=t.value; updateFila(); } }); })();

/* API pública extra — usada pela SANFONA do Hub (modo embutido):
   - navigate(view): troca de tela do Broker sem remontar (a nav vem da sidebar do Hub);
   - getNav(role): itens de menu daquele papel (o Hub filtra o que quiser, ex.: tira "agenda"). */
window.Broker.navigate = function(view){ const r=ROOT(); if(r && !r.hidden && view){ navigate(view); } };
window.Broker.getNav = function(role){ return (NAV_ROLE[role] || NAV_ROLE.broker).map(n=>({ id:n.id, label:n.label, ico:n.ico })); };
