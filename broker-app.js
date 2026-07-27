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
import { firebaseConfig } from "./firebase-env.js";

// hub-app.js já inicializou o app e (em localhost) ligou os emuladores nas MESMAS
// instâncias; aqui só reaproveitamos — sem re-conectar emulador (evita erro de "já conectado").
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const fns  = getFunctions(app, 'southamerica-east1');

const call = (name) => httpsCallable(fns, name);
const fnImoveis   = call('locListarImoveis');
const fnNegocios  = call('negocioListar');
const fnNegAtual  = call('negocioAtualizar');
const fnInteressado = call('carteiraInteressado'); // aprovar/reprovar interessado (gestor)
const fnGerarNeg    = call('negocioGerar');         // gerar negócio de um interessado aprovado (gestor)
const fnPessoas   = call('pessoasListar');    // criada no functions/index.js (gestor)
const fnRoster    = call('listarPessoas');    // usuários do Auth {uid,nome}
const fnFotos     = call('listarFotosPerfil');// {uids} -> {fotos:{uid:dataUrl}}
const fnGetPerfil = call('getMeuPerfil');     // {nome,photo,telefone,creci,cpf,email}
const fnSalvarPerfil = call('salvarMeuPerfil');
const fnEventos   = call('listarEventos');    // agenda real do Hub ({de,ate} -> [eventos])

/* ============================ ESTADO ============================ */
const state = {
  view:'dashboard',
  pessoasView:'tabela', pessoasFiltro:'Todos', pessoasBusca:'',
  imoveisView:'cards', imoveisFiltro:'Todos', imoveisBusca:'',
  negFiltroTipo:'Todos', negFiltroStatus:'Todos', negBusca:'',
  relCorretor:'Todos', cfgTab:'usuarios',
  currentDeal:null, dealTab:'timeline', currentPerson:null, pessoaTab:'dados',
  currentProp:null, imovelTab:'dados',
  loaded:false, meuNome:'Broker', onExit:null,
  role:'broker',        // 'broker' (gestor) | 'corretor' | 'administrativo'
  filaBusca:'', perfilCache:null,
};

// Dados reais (preenchidos por carregarDados) — no FORMATO do mockup.
let PROPERTIES = [];
let DEALS = [];
let PEOPLE = [];
let CORRETORES = {};   // uid -> {id, nome, ini, cor, foto}
let KPI = { comissaoPrevista:0, comissaoRecebida:0, comissaoPendente:0, pagoCorretores:0, pendenteCorretores:0, encerradosMes:0, tempoMedioDias:0 };
let ACTIVITY = [];

/* ============================ HELPERS ============================ */
const ROOT = () => document.getElementById('bkRoot');
const $ = (s) => ROOT() ? ROOT().querySelector(s) : null;
const person = id => PEOPLE.find(p=>p.id===id) || {nome:'—', tipos:[], docs:[], obs:'—', cpf:'—', email:'—', tel:'—', cidade:'—', desde:'—'};
const prop = id => PROPERTIES.find(p=>p.id===id) || {rua:'—', bairro:'', cidade:'', code:'', tipo:'', preco:0, finalidade:'', docs:[]};
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
function icon(n,sz=18,cls=''){ return '<i data-lucide="'+n+'" class="'+cls+'" style="width:'+sz+'px;height:'+sz+'px"></i>'; }
function refreshIcons(){ if(window.lucide){ try{ window.lucide.createIcons(); }catch(e){} } }
const STATUS = {
  // rótulos amigáveis (venda/locação) + status reais de negócio
  'Disponível':'success','Em negociação':'info',
  'Negócio criado':'info','Em andamento':'info','Aguardando broker':'warning',
  'Aguardando corretor':'warning','Aguardando administrativo':'warning',
  'Entregue à gestão':'success','Concluído':'success','Cancelado':'danger',
};
function pill(txt,variant){ return '<span class="pill '+(variant||'neutral')+'"><span class="dot"></span>'+esc(txt)+'</span>'; }
function statusPill(s){ return pill(s, STATUS[s]||'neutral'); }
function avatar(nome,size=36,bg='var(--brand)',foto){ if(foto) return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background-image:url('+foto+');background-size:cover;background-position:center"></span>'; return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:'+bg+';font-size:'+(size<30?10:12)+'px">'+ini(nome)+'</span>'; }
const TINT = { info:['#EFF4FF','#1D4ED8'], success:['#ECFDF3','#15803D'], warning:['#FFFAEB','#B45309'], danger:['#FEF2F2','#B91C1C'], ai:['#F5F0FF','#6D28D9'], brand:['#EFF4FF','#2563EB'] };
function iconChip(ico,variant,size=40){ const t=TINT[variant]||TINT.brand; return '<span class="iconchip" style="width:'+size+'px;height:'+size+'px;background:'+t[0]+';color:'+t[1]+'">'+icon(ico,size>34?20:16)+'</span>'; }
const COR_PALETA = ['#2563EB','#7C3AED','#DB2777','#0EA5E9','#16A34A','#F59E0B','#9333EA','#0D9488'];
function corDe(uid){ let h=0; const s=String(uid||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return COR_PALETA[h%COR_PALETA.length]; }
function diasEntre(iso){ if(!iso) return 0; return Math.max(0, Math.floor((Date.now()-new Date(iso).getTime())/86400000)); }
function relData(iso){ const d=diasEntre(iso); if(d===0) return 'Hoje'; if(d===1) return 'Ontem'; return 'Há '+d+' dias'; }

/* (Removidos os dados de DEMONSTRAÇÃO — TEAM/Smart Score/IA. Todas as telas usam
   dado real; onde ainda não há fonte, a tela mostra estado "em breve".) */

/* ============================ MAPEADORES real -> shape do mockup ============================ */
const FINAL_LABEL = { locacao:'Locação', venda:'Venda', venda_locacao:'Venda e Locação' };
const NEG_STATUS_LABEL = {
  negocio_criado:'Negócio criado', em_andamento:'Em andamento', aguardando_broker:'Aguardando broker',
  aguardando_corretor:'Aguardando corretor', aguardando_administrativo:'Aguardando administrativo',
  entregue_gestao:'Entregue à gestão', concluido:'Concluído', cancelado:'Cancelado',
};
function fmtCodImovel(im){ const n=im.numeroProtocolo; return n!=null ? '#SH-'+String(n).padStart(4,'0') : (im.id||'').slice(0,6); }
function endImovel(im){ const e=im.endereco||{}; const l=[e.logradouro, e.numero].filter(Boolean).join(', '); return l||im.referencia||'Imóvel sem endereço'; }

function mapImovel(im){
  const e = im.endereco||{};
  const fin = FINAL_LABEL[im.finalidade] || 'Locação';
  const preco = parseMoney(im.valorAnuncio || im.valorProposta || im.valorFechamento || 0);
  const situ = im.arquivado ? 'Arquivado' : (im.situacao==='em_negociacao' ? 'Em negociação' : 'Disponível');
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
    status: situ,
    arquivado: !!im.arquivado,
    dorm: im.dormitorios||null, vaga: im.vagas!=null?im.vagas:null, area: im.area||null,
    mat: im.matricula||'—', iptu: im.iptu||im.contribuinteIptu||'—', escritura: !!im.escritura,
    fotos: (im.documentos&&im.documentos.fotos&&im.documentos.fotos.length)||0, tour:false,
    interessados: im.interessados||[],
  };
}

function chkPct(cl){ if(!cl||!cl.length) return 0; const f=cl.filter(x=>x.feito).length; return Math.round(f/cl.length*100); }
function clicksignDe(cl){ cl=cl||[]; const f=k=>cl.find(x=>x.key===k&&x.feito); if(f('contrato_assinado')) return 'Concluído'; if(f('contrato_emitido')||f('contrato_aprovado')) return 'Enviado'; return '—'; }
function mapNegocio(n){
  const im = PROPERTIES.find(p=>p.id===n.imovelId);
  const preco = im ? im.preco : 0;
  const tipo = n.tipo==='venda' ? 'Venda' : 'Locação';
  const comBruto = (im&&im.raw&&im.raw.valorComissao) ? parseMoney(im.raw.valorComissao) : 0;
  const comValor = comBruto || (tipo==='Venda' ? preco*0.06 : preco);
  const rel = relData(n.atualizadoEm || n.criadoEm);
  return {
    id: n.id, raw: n,
    code: n.codigo || '—',
    tipo,
    status: NEG_STATUS_LABEL[n.status] || n.status || '—', statusRaw: n.status,
    corretor: n.corretorUid, corretorNome: n.corretorNome||'',
    imovelId: n.imovelId, imovelResumo: n.imovelResumo||'', cidade: n.cidade||'',
    clienteNome: n.clienteNome||'—', clienteContato: n.clienteContato||'',
    valor: preco, comPct: tipo==='Venda'?6:100, comValor, comStatus:'Prevista',
    criado: (n.criadoEm||'').slice(0,10).split('-').reverse().join('/'),
    prox: n.proximaAcao || 'Sem próxima ação definida',
    proxData: rel, diasParado: diasEntre(n.atualizadoEm || n.criadoEm),
    clicksign: clicksignDe(n.checklist), progresso: chkPct(n.checklist),
    checklist: n.checklist||[], comentarios: n.comentarios||[], timeline: n.timeline||[], driveUrl: n.driveUrl||'',
    // O servidor só devolve o array pra quem PODE comentar (broker + corretor do
    // negócio); ausente/null = sem permissão. `!==null` deixava `undefined` passar.
    podeComentar: Array.isArray(n.comentarios),
  };
}

/* prop()/person() para negócios: fallback quando o imóvel/cliente não está carregado */
function propDoDeal(d){ return PROPERTIES.find(p=>p.id===d.imovelId) || {rua:d.imovelResumo||'Imóvel', bairro:'', cidade:d.cidade||'', code:'', tipo:'', preco:d.valor, finalidade:d.tipo}; }

/* ============================ CARREGAMENTO DE DADOS ============================ */
async function carregarDados(){
  const [imR, ngR] = await Promise.all([
    fnImoveis({}).catch(()=>({data:{imoveis:[]}})),
    fnNegocios({}).catch(()=>({data:{negocios:[]}})),
  ]);
  const imoveisRaw = (imR.data&&imR.data.imoveis)||[];
  PROPERTIES = imoveisRaw.filter(im=>!im.arquivado).map(mapImovel);
  DEALS = ((ngR.data&&ngR.data.negocios)||[]).filter(n=>n.status!=='cancelado').map(mapNegocio);

  // Corretores (para nomes/cores/fotos nas tabelas). Base: nomes que já vêm nos docs.
  CORRETORES = {};
  const addCorr = (uid,nome)=>{ if(!uid) return; if(!CORRETORES[uid]) CORRETORES[uid]={id:uid,nome:nome||'Corretor',ini:ini(nome),cor:corDe(uid),foto:''}; else if(nome&&CORRETORES[uid].nome==='Corretor') CORRETORES[uid].nome=nome; };
  PROPERTIES.forEach(p=>addCorr(p.corretor,p.corretorNome));
  DEALS.forEach(d=>addCorr(d.corretor,d.corretorNome));

  // KPIs reais (best-effort a partir dos negócios ativos).
  const soma = DEALS.reduce((s,d)=>s+(d.comValor||0),0);
  KPI = {
    comissaoPrevista: soma,
    comissaoRecebida: DEALS.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+(d.comValor||0),0),
    comissaoPendente: DEALS.filter(d=>d.statusRaw!=='concluido').reduce((s,d)=>s+(d.comValor||0),0),
    pagoCorretores: 0, pendenteCorretores: 0,
    encerradosMes: DEALS.filter(d=>d.statusRaw==='concluido'||d.statusRaw==='entregue_gestao').length,
    concluidos: DEALS.filter(d=>d.statusRaw==='concluido').length,
    // "ativos" = em andamento de verdade (exclui concluído/entregue; cancelado já saiu de DEALS)
    ativos: DEALS.filter(d=>d.statusRaw!=='concluido'&&d.statusRaw!=='entregue_gestao').length,
    tempoMedioDias: 0,
  };
  KPI.pagoCorretores = Math.round(KPI.comissaoRecebida*0.5);
  KPI.pendenteCorretores = Math.round(KPI.comissaoPendente*0.5);

  // Atividades reais (timelines dos negócios), mais recentes primeiro.
  ACTIVITY = DEALS.flatMap(d=>(d.timeline||[]).map(t=>({ico:'circle-dot',cor:'info',txt:t.texto||'Atualização',sub:d.code+' · '+(d.corretorNome||''),quando:relData(t.em),_em:t.em})))
    .sort((a,b)=>(b._em||'').localeCompare(a._em||'')).slice(0,6);

  state.loaded = true;
}

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
        cpf:'—', email:'—', tel:it.contato||'—', cidade:'—', desde:'—', docs:[], obs:'Interessado no imóvel '+im.code });
    });
  });
  PEOPLE = arr;
}

/* ============================ UI INFRA ============================ */
const RENDERERS = {};
// Configurações e "sair da conta" ficam SÓ no Hub (pedido do Nathan) — não entram aqui.
const NAVITEMS = [ {id:'dashboard',ico:'layout-dashboard',label:'Dashboard'},{id:'pessoas',ico:'users',label:'Pessoas'},{id:'imoveis',ico:'building-2',label:'Imóveis'},{id:'negocios',ico:'handshake',label:'Negócios'},{id:'relatorios',ico:'bar-chart-3',label:'Relatórios'} ];
const CRUMB = { dashboard:['SMART HUB','Dashboard'], pessoas:['SMART HUB','Pessoas'], imoveis:['SMART HUB','Imóveis'], negocios:['SMART HUB','Negócios'], relatorios:['SMART HUB','Relatórios'], configuracoes:['SMART HUB','Configurações'] };

function renderNav(target){ if(!target) return; target.innerHTML = NAVITEMS.map(n=>'<button class="navitem'+(state.view===n.id?' active':'')+'" data-nav="'+n.id+'">'+icon(n.ico,18)+n.label+'</button>').join(''); }
function renderBreadcrumb(){ const c=CRUMB[state.view]||['SMART HUB','—']; const b=$('#breadcrumb'); if(b) b.innerHTML='<span class="tmut nowrap">'+c[0]+'</span>'+icon('chevron-right',15,'tmut')+'<span class="tw fw6 trunc">'+c[1]+'</span>'; }

function navigate(view){
  if(view) state.view=view;
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
function closeDrawer(){ const d=$('#drawer'); if(d) d.classList.remove('show'); maybeHideOverlay(); }
function openModal(html){ $('#modal').innerHTML=html; const o=$('#overlay'); o.classList.remove('hide'); requestAnimationFrame(()=>{o.classList.add('show');$('#modal').classList.add('show');}); refreshIcons(); }
function closeModal(){ const m=$('#modal'); if(m) m.classList.remove('show'); maybeHideOverlay(); }
function openMobileNav(){ $('#mobilenav').classList.add('show'); const o=$('#overlay'); o.classList.remove('hide'); requestAnimationFrame(()=>o.classList.add('show')); }
function closeMobileNav(){ const m=$('#mobilenav'); if(m) m.classList.remove('show'); maybeHideOverlay(); }
function maybeHideOverlay(){ const has=id=>{const el=$(id);return el&&el.classList.contains('show');}; const open=has('#drawer')||has('#modal')||has('#mobilenav'); if(!open){ const o=$('#overlay'); if(o){ o.classList.remove('show'); setTimeout(()=>{ if(!has('#drawer')&&!has('#modal')&&!has('#mobilenav')) o.classList.add('hide'); },220); } } }
let toastT; function toast(msg,ico='check-circle-2',cor='var(--success)'){ const t=$('#toast'); if(!t) return; t.innerHTML='<div class="fx ac g2" style="background:var(--ink900);color:#fff;font-size:14px;font-weight:500;padding:12px 16px 12px 14px;border-radius:12px;box-shadow:var(--lg)"><i data-lucide="'+ico+'" style="width:16px;height:16px;color:'+cor+'"></i>'+esc(msg)+'</div>'; t.classList.add('show'); refreshIcons(); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2800); }

function pageHead(title,desc,actions){ return '<div class="fx as jb wrap g4" style="margin-bottom:24px"><div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+title+'</h1><p style="margin:6px 0 0;font-size:14px;color:var(--ondarkmuted);max-width:640px">'+desc+'</p></div>'+(actions?'<div class="fx ac g2 nsh">'+actions+'</div>':'')+'</div>'; }
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
  Object.assign(state, { negFiltroTipo:'Todos', negFiltroStatus:'Todos', negBusca:'', pessoasFiltro:'Todos', pessoasBusca:'', imoveisFiltro:'Todos', imoveisBusca:'', filaBusca:'', relCorretor:'Todos', currentDeal:null, dealTab:'timeline', cliFiltro:'Todos', cliBusca:'', agView:'mes', driveTipo:'Venda' });
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
  } catch(e){
    if(host) host.innerHTML = '<div class="card" style="padding:24px;margin:24px"><div class="fz14 fw6 t900">Não consegui carregar a Locação</div><div class="fz13 t500" style="margin-top:6px">'+esc(e.message||e)+'</div></div>';
    refreshIcons();
  }
}
function unmount(){
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

window.Broker = { mount, unmount };

/* ============================================================================
   RENDERIZADORES (portados 1:1 do mockup, alimentados por dados reais)
   ============================================================================ */

/* ---------------- DASHBOARD (Central de Comando) ---------------- */
function blockH(t,sub,badge){ return '<div style="margin:28px 0 14px"><div class="fx ac g2"><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff;letter-spacing:-.01em">'+t+'</h2>'+(badge||'')+'</div>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div>'; }

RENDERERS.dashboard = function(host){
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
    '<div><h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiroNome)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Central de comando da REMAX SMART — veja onde concentrar sua atenção hoje.</p></div>'
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
function filteredDeals(){ const q=(state.negBusca||'').toLowerCase().trim(); return DEALS.filter(d=>{ if(state.negFiltroTipo!=='Todos'&&d.tipo!==state.negFiltroTipo)return false; if(state.negFiltroStatus!=='Todos'&&d.status!==state.negFiltroStatus)return false; if(q){ const im=propDoDeal(d); const s=(d.code+' '+im.rua+' '+d.clienteNome+' '+corrNome(d.corretor)).toLowerCase(); if(s.indexOf(q)<0)return false; } return true; }); }
function allStatusReais(){ return [...new Set(DEALS.map(d=>d.status))]; }
function corrNome(uid){ return CORRETORES[uid]?CORRETORES[uid].nome:'—'; }
function corrFoto(uid){ return CORRETORES[uid]?CORRETORES[uid].foto:''; }
function negRows(){
  const list=filteredDeals();
  const meu=state.role==='corretor';   // corretor: sem coluna Corretor, comissão = repasse 50% (mockup)
  if(!list.length) return '<tr><td colspan="'+(meu?6:7)+'"><div class="tcenter t500" style="padding:44px 0"><div class="t400">'+icon('search-x',26)+'</div><p style="margin-top:10px" class="fz14 fw5">Nenhum negócio encontrado para este filtro.</p></div></td></tr>';
  return list.map(d=>{ const im=propDoDeal(d); return '<tr data-deal="'+d.id+'"><td class="mono fz13 t900 fw6">'+esc(d.code)+'</td><td><div class="fw6 t900">'+esc(im.rua)+'</div><div class="fz12 t500">'+esc(im.bairro||d.cidade)+'</div></td><td><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'">'+d.tipo+'</span></td><td class="t700">'+esc(d.clienteNome)+'</td>'+(meu?'':'<td><div class="fx ac g2">'+avatar(corrNome(d.corretor),24,'var(--ink800)',corrFoto(d.corretor))+'<span class="fz13 t700">'+esc(corrNome(d.corretor))+'</span></div></td>')+'<td>'+statusPill(d.status)+'</td><td class="tright mono fw6 t900">'+brl(meu?repasse(d):d.comValor)+'</td></tr>'; }).join('');
}
function updateNegTable(){ const tb=$('#negTbody'); if(tb){ tb.innerHTML=negRows(); refreshIcons(); } const c=$('#negCount'); if(c) c.textContent=filteredDeals().length; }
RENDERERS.negocios = function(host){
  const tipos=['Todos','Venda','Locação']; const ALL_STATUS=allStatusReais();
  host.innerHTML = pageHead(hTitulo('Negócios'),'Em que etapa está cada negociação? Acompanhe todos os negócios da imobiliária.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px">'
    + '<div class="fx ac g2 wrap">'+tipos.map(t=>'<button class="chip'+(state.negFiltroTipo===t?' active':'')+'" data-action="negtipo" data-v="'+t+'">'+t+'</button>').join('')+'</div>'
    + '<div class="fx ac g2">'
      + '<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(300px,60vw)">'+icon('search',16,'tmut')+'<input data-input="negBusca" value="'+esc(state.negBusca||'')+'" placeholder="Buscar negócio, imóvel, cliente…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>'
      + '<select class="input" data-action="negstatus" style="width:auto;background-color:var(--raised);border-color:var(--bd);color:#fff"><option'+(state.negFiltroStatus==='Todos'?' selected':'')+'>Todos</option>'+ALL_STATUS.map(s=>'<option'+(state.negFiltroStatus===s?' selected':'')+'>'+s+'</option>').join('')+'</select>'
    + '</div>'
  + '</div>'
  + '<div class="fz13 tmut" style="margin-bottom:12px"><strong class="tw" id="negCount">'+filteredDeals().length+'</strong> negócios · '+(state.negFiltroTipo)+(state.negFiltroStatus!=='Todos'?' · '+state.negFiltroStatus:'')+'</div>'
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:'+(state.role==='corretor'?'720':'820')+'px"><thead><tr><th>Código</th><th>Imóvel</th><th>Tipo</th><th>Cliente</th>'+(state.role==='corretor'?'':'<th>Corretor</th>')+'<th>Status</th><th class="tright">'+(state.role==='corretor'?'Minha comissão':'Comissão')+'</th></tr></thead><tbody id="negTbody">'+negRows()+'</tbody></table></div></div>';
};

function renderStepper(d){
  const cl=d.checklist||[]; if(!cl.length) return '<div class="fz13 t500">Sem checklist neste negócio.</div>';
  const doneN=cl.filter(x=>x.feito).length;
  const stages=cl.slice(0,6);
  return '<div class="fx">'+stages.map((s,i)=>{ const done=i<doneN, now=i===doneN&&doneN<cl.length; const bg=done?'var(--success)':now?'var(--brand)':'#fff'; const bd=done||now?'transparent':'2px solid var(--ink300)'; const col=done||now?'#fff':'var(--ink400)'; const lineL=i===0?'transparent':(i<=doneN?'var(--success)':'var(--ink200)'); const lineR=i===stages.length-1?'transparent':(i<doneN?'var(--success)':'var(--ink200)'); const cap=done?'Concluído':now?'Em andamento':'Pendente'; const capc=done?'c-suc':now?'c-inf':'t400';
    return '<div class="fx col ac g2" style="flex:1"><div class="fx ac" style="width:100%"><span style="flex:1;height:2px;background:'+lineL+'"></span><span class="ifx ac jc nsh" style="width:32px;height:32px;border-radius:50%;background:'+bg+';border:'+(bd==='transparent'?'none':bd)+';color:'+col+';font-size:12px;font-weight:700'+(now?';box-shadow:0 0 0 4px rgba(37,99,235,.18)':'')+'">'+(done?icon('check',16):(i+1))+'</span><span style="flex:1;height:2px;background:'+lineR+'"></span></div><div class="tcenter"><div class="fz12 fw6 '+(done||now?'t900':'t500')+'">'+esc((s.label||'').split(' ').slice(0,2).join(' '))+'</div><div class="fz11 '+capc+'" style="margin-top:1px">'+cap+'</div></div></div>'; }).join('')+'</div>';
}

function openDeal(id){
  const d=DEALS.find(x=>x.id===id); if(!d) return; state.currentDeal=id; const tab=state.dealTab||'timeline';
  // Vindo de um drawer (pessoa/imóvel), fecha ele — senão o detalhe renderiza atrás.
  closeDrawer(); closeModal();
  // O detalhe é logicamente a tela Negócios (sanfona destaca certo + ESC/voltar coerentes).
  if(state.view!=='negocios'){ state.view='negocios'; if(state.embedded && typeof state.onNavigate==='function'){ try{ state.onNavigate('negocios'); }catch(e){} } }
  const im=propDoDeal(d), corr=CORRETORES[d.corretor]||{nome:'—'};
  const bc=$('#breadcrumb'); if(bc) bc.innerHTML='<button class="btn-dark-ghost" data-nav="negocios">SMART HUB</button>'+icon('chevron-right',15,'tmut')+'<button class="btn-dark-ghost" data-nav="negocios">Negócios</button>'+icon('chevron-right',15,'tmut')+'<span class="tw fw6 mono trunc">'+esc(d.code)+'</span>';

  const tl=(d.timeline||[]).slice().reverse();
  const tabBtn=(k,l)=>'<button class="tab'+(tab===k?' active':'')+'" data-action="dealtab-'+k+'">'+l+'</button>';
  let tabContent='';
  if(tab==='timeline'){ tabContent='<div style="padding:20px">'+(tl.length?tl.map((e,i)=>'<div class="fx g3"><div class="fx col ac">'+iconChip('circle-dot','info',32)+(i<tl.length-1?'<span class="timeline-line"></span>':'')+'</div><div style="padding-bottom:18px" class="grow"><div class="fz14 fw6 t900">'+esc(e.texto)+'</div><div class="fz12 t500">'+esc(e.porNome||'')+' · '+relData(e.em)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:20px">Sem histórico ainda.</div>')+'</div>'; }
  else if(tab==='comentarios'){ if(!d.podeComentar){ tabContent='<div class="tcenter t500 fz13" style="padding:24px">Comentários são exclusivos do broker e do corretor responsável.</div>'; } else { const cs=d.comentarios||[]; tabContent='<div style="padding:20px"><div class="fx g2" style="margin-bottom:16px">'+avatar(state.meuNome,34)+'<div class="grow"><textarea id="bkComent" class="input" rows="2" placeholder="Escreva um comentário para a equipe…"></textarea><div class="fx je" style="margin-top:8px"><button class="btn btn-primary sm" data-action="add-coment">Comentar</button></div></div></div>'+(cs.length?cs.slice().reverse().map(c=>'<div class="fx g2" style="padding:12px 0;border-top:1px solid var(--ink100)">'+avatar(c.porNome,34,'var(--ink800)')+'<div class="grow"><div class="fx ac g2"><span class="fz13 fw6 t900">'+esc(c.porNome)+'</span><span class="fz11 t400">'+relData(c.em)+'</span></div><div class="fz13 t700" style="margin-top:2px">'+esc(c.texto)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:20px">Nenhum comentário ainda.</div>')+'</div>'; } }
  else { tabContent='<div style="padding:16px 20px"><div class="fz13 fw6 t900" style="margin-bottom:10px">Checklist do negócio</div>'+(d.checklist||[]).map(x=>'<button class="fx ac g3 hoverbg" data-chk="'+esc(x.key)+'" data-feito="'+(x.feito?'0':'1')+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:pointer;margin-bottom:8px"><span class="ifx ac jc nsh" style="width:24px;height:24px;border-radius:6px;background:'+(x.feito?'var(--success)':'#fff')+';border:'+(x.feito?'none':'2px solid var(--ink300)')+';color:#fff">'+(x.feito?icon('check',15):'')+'</span><div class="grow mw0"><div class="fz13 fw6 t900">'+esc(x.label)+(x.obrigatoria?' <span class="pill danger" style="font-size:10px;padding:1px 6px">obrigatória</span>':'')+'</div>'+(x.feito&&x.feitoPor?'<div class="fz11 t500">'+esc(x.feitoPor)+' · '+relData(x.feitoEm)+'</div>':'')+'</div></button>').join('')+'</div>'; }

  const host=$('#root'); host.style.animation='none'; void host.offsetWidth; host.style.animation='';
  host.innerHTML =
    '<button class="btn-dark-ghost" style="margin-bottom:16px" data-nav="negocios">'+icon('arrow-left',15)+'Voltar aos Negócios</button>'
  + '<div class="card" style="padding:22px;margin-bottom:16px"><div class="fx as jb wrap g4"><div class="mw0"><div class="fx ac g2 wrap"><span class="mono fz13 fw7 t900">'+esc(d.code)+'</span><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'">'+d.tipo+'</span>'+statusPill(d.status)+'</div><div class="fz20 fw7 t900" style="margin-top:10px">'+esc(im.rua)+'</div><div class="fx ac g3 wrap fz13 t500" style="margin-top:8px"><span class="fx ac g1">'+icon('map-pin',14,'t400')+esc(im.bairro||d.cidade)+'</span><span class="divx" style="height:12px"></span><span class="fx ac g1">'+icon('user',14,'t400')+esc(corr.nome)+'</span></div></div><div class="tright nsh"><div class="fz12 t500">Valor do negócio</div><div class="mono fw7 t900" style="font-size:24px;margin-top:2px">'+brlFull(d.valor)+(d.tipo==='Locação'?'<span class="fz13 t500">/mês</span>':'')+'</div><div class="fz13 c-suc fw6" style="margin-top:4px">Comissão '+brlFull(d.comValor)+'</div></div></div><div class="fx g2 wrap" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--ink100)">'+(d.driveUrl?'<a class="btn btn-outline sm" href="'+esc(d.driveUrl)+'" target="_blank" rel="noopener">'+icon('folder-open',15)+'Abrir Drive</a>':'<button class="btn btn-outline sm" data-action="sem-drive">'+icon('folder-open',15)+'Sem Drive</button>')+'<button class="btn btn-outline sm" data-action="dealtab-comentarios">'+icon('message-square',15)+'Comentários</button></div></div>'
  + '<div class="card" style="padding:22px 24px;margin-bottom:16px"><div class="fx ac jb wrap g2"><div class="up fz13 fw7 t800">Etapas do processo</div><div class="fx ac g3"><span class="fz12 t500">Próxima: <strong class="t900">'+esc(d.prox)+'</strong></span>'+((d.checklist||[]).some(x=>!x.feito)&&d.statusRaw!=='concluido'&&d.statusRaw!=='cancelado'?'<button class="btn btn-primary sm nsh" data-action="concluir-proxima">'+icon('check',15)+'Concluir etapa</button>':'')+'</div></div><div style="margin-top:18px">'+renderStepper(d)+'</div></div>'
  + (state.role==='broker' && d.statusRaw!=='concluido' && d.statusRaw!=='cancelado' ? '<div class="card" style="padding:18px;margin-bottom:16px"><div class="up fz12 fw7 t800" style="margin-bottom:12px">Ações do gestor</div><div class="fx g2 wrap"><button class="btn btn-outline sm" data-action="neg-entregar">'+icon('package',15)+'Entregar p/ Gestão</button><button class="btn btn-success sm" data-action="neg-concluir">'+icon('check',15)+'Concluir</button><button class="btn btn-outline sm" data-action="neg-cancelar" style="color:var(--danger);border-color:var(--danger)">'+icon('x',15)+'Cancelar</button></div><div class="fz11 t500" style="margin-top:10px">Entregar e Concluir exigem todas as etapas obrigatórias feitas. Cancelar devolve o imóvel a Disponível.</div></div>' : '')
  + '<div class="split-r">'
    + '<div class="fx col g4">'
      + '<div class="card" style="padding:18px"><div class="up fz12 fw7 t800" style="margin-bottom:12px">Cliente</div><div class="fx ac g3">'+avatar(d.clienteNome,40,'var(--ink800)')+'<div class="mw0"><div class="fz14 fw6 t900 trunc">'+esc(d.clienteNome)+'</div><div class="fz12 t500">'+esc(d.clienteContato||'—')+'</div></div></div></div>'
      + '<div class="card" style="padding:18px"><div class="up fz12 fw7 t800" style="margin-bottom:14px">Financeiro</div><div class="fx col g3 fz13">'+[['Valor',brlFull(d.valor)],['Comissão ('+d.comPct+'%)',brlFull(d.comValor)],['Repasse corretor (50%)',brlFull(repasse(d))],['Progresso',d.progresso+'%'],['Clicksign',d.clicksign]].map(r=>'<div class="fx jb ac"><span class="t500">'+r[0]+'</span><span class="fw6 t900 mono">'+r[1]+'</span></div>').join('')+'</div></div>'
    + '</div>'
    + '<div class="card" style="overflow:hidden"><div class="fx g1" style="padding:4px 12px 0;border-bottom:1px solid var(--ink100)">'+tabBtn('timeline','Timeline')+tabBtn('comentarios','Comentários')+tabBtn('checklist','Checklist')+'</div>'+tabContent+'</div>'
  + '</div>';
  const sc=$('#scroller'); if(sc) sc.scrollTop=0; refreshIcons();
}

async function negAtualizar(payload, okMsg){
  try {
    const r = await fnNegAtual(payload);
    const ng = r.data && r.data.negocio;
    if(ng){ const mapped=mapNegocio(ng); const i=DEALS.findIndex(x=>x.id===mapped.id); if(i>=0) DEALS[i]=mapped; else DEALS.push(mapped); }
    if(okMsg) toast(okMsg);
    openDeal(state.currentDeal);
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); }
}

// Aprovar/reprovar um interessado (gestor). Recarrega os dados e reabre o imóvel.
async function interessadoAcao(imovelId, index, status, okMsg){
  try {
    await fnInteressado({ imovelId, acao:'status', index, status });
    toast(okMsg||'Interessado atualizado', 'check');
    await carregarDados();
    openProp(imovelId);
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); }
}
// Gerar negócio de um interessado aprovado (gestor). Recarrega e abre o negócio novo.
async function gerarNegocioUI(imovelId, index){
  try {
    toast('Gerando negócio…', 'loader-2', 'var(--brand)');
    const r = await fnGerarNeg({ imovelId, interessadoIndex: index });
    await carregarDados();
    const nid = r.data && r.data.negocioId;
    toast('Negócio '+((r.data && r.data.codigo)||'')+' criado', 'check');
    if(nid && DEALS.find(x=>x.id===nid)) openDeal(nid); else navigate('negocios');
  } catch(e){ toast(e.message||'Erro', 'alert-triangle', 'var(--danger)'); }
}

/* ---------------- PESSOAS ---------------- */
const PTIPOS=['Todos','Proprietário','Comprador','Locatário','Fiador'];
function filteredPeople(){ const q=(state.pessoasBusca||'').toLowerCase().trim(); return PEOPLE.filter(p=>{ if(state.pessoasFiltro!=='Todos'&&!p.tipos.includes(state.pessoasFiltro))return false; if(q&&(p.nome+' '+p.email+' '+p.cpf).toLowerCase().indexOf(q)<0)return false; return true; }); }
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
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px"><div class="fx ac g2 wrap">'+PTIPOS.map(t=>'<button class="chip'+(state.pessoasFiltro===t?' active':'')+'" data-action="pesstipo" data-v="'+t+'">'+t+'</button>').join('')+'</div><div class="fx ac g2"><div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(260px,55vw)">'+icon('search',16,'tmut')+'<input data-input="pessoasBusca" value="'+esc(state.pessoasBusca||'')+'" placeholder="Buscar pessoa…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div><div class="fx" style="background:var(--raised);border:1px solid var(--bd);border-radius:8px;padding:3px"><button class="seg'+(state.pessoasView==='tabela'?" active":"")+'" data-action="pessview" data-v="tabela" style="color:'+(state.pessoasView==='tabela'?'':'var(--ondarkmuted)')+'">'+icon('list',15)+'</button><button class="seg'+(state.pessoasView==='cards'?" active":"")+'" data-action="pessview" data-v="cards" style="color:'+(state.pessoasView==='cards'?'':'var(--ondarkmuted)')+'">'+icon('layout-grid',15)+'</button></div></div></div>'
  + '<div id="pessoasList">'+pessoasList()+'</div>';
};
function kv(l,v){ return '<div class="fx jb ac" style="padding:11px 0;border-bottom:1px solid var(--ink100)"><span class="fz13 t500">'+l+'</span><span class="fz13 fw6 t900 tright">'+v+'</span></div>'; }
function openPerson(id){ state.currentPerson=id; if(!state.pessoaTab)state.pessoaTab='dados'; openDrawer(personDrawer(id)); }
function personDrawer(id){
  const p=person(id); const tab=state.pessoaTab||'dados';
  const negs=DEALS.filter(d=>d.clienteNome===p.nome);
  const tabs=[['dados','Dados'],['vinc','Negócios'],['obs','Observações']];
  let body='';
  if(tab==='dados'){ body='<div>'+kv('E-mail',esc(p.email))+kv('Telefone',esc(p.tel))+kv('CPF','<span class="mono">'+esc(p.cpf)+'</span>')+kv('Cidade',esc(p.cidade))+'</div>'; }
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
function imFinalMatch(p){ if(state.imoveisFiltro==='Todos') return true; if(state.imoveisFiltro==='Venda') return p.finalidadeRaw==='venda'||p.finalidadeRaw==='venda_locacao'; if(state.imoveisFiltro==='Locação') return p.finalidadeRaw==='locacao'||p.finalidadeRaw==='venda_locacao'; return true; }
function filteredProps(){ const q=(state.imoveisBusca||'').toLowerCase().trim(); return PROPERTIES.filter(p=>{ if(!imFinalMatch(p))return false; if(q&&(p.rua+' '+p.bairro+' '+p.code+' '+p.tipo).toLowerCase().indexOf(q)<0)return false; return true; }); }
function imoveisList(){
  const list=filteredProps();
  if(!list.length) return vazio('building','Nenhum imóvel encontrado.');
  if(state.imoveisView==='cards'){
    return '<div class="gd" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">'+list.map((p,i)=>'<button class="card card-hover" data-prop="'+p.id+'" style="overflow:hidden;text-align:left;padding:0"><div style="height:148px;background:'+GRAD[i%GRAD.length]+';position:relative"><span class="pill" style="position:absolute;top:10px;left:10px;background:rgba(255,255,255,.92);color:var(--ink900)">'+p.finalidade+'</span>'+(p.fotos?'<span style="position:absolute;top:10px;right:10px"><span class="pill" style="background:rgba(0,0,0,.35);color:#fff">'+icon("image",12)+p.fotos+'</span></span>':'')+'<span class="mono" style="position:absolute;bottom:10px;left:12px;color:#fff;font-weight:700;font-size:17px;text-shadow:0 1px 4px rgba(0,0,0,.3)">'+(p.preco?brlFull(p.preco)+(p.finalidadeRaw==='locacao'?'<span style="font-size:12px;font-weight:500">/mês</span>':''):'Sem valor')+'</span></div><div style="padding:14px"><div class="fz14 fw6 t900 trunc">'+esc(p.rua)+'</div><div class="fz12 t500">'+esc(p.bairro)+' · '+esc(p.tipo)+'</div>'+((p.dorm||p.vaga!=null||p.area)?'<div class="fx ac g3 fz12 t500" style="margin-top:8px">'+(p.dorm?'<span class="fx ac g1">'+icon('bed-double',13,'t400')+p.dorm+'</span>':'')+(p.vaga!=null?'<span class="fx ac g1">'+icon('car',13,'t400')+p.vaga+'</span>':'')+(p.area?'<span class="fx ac g1">'+icon('ruler',13,'t400')+p.area+'m²</span>':'')+'</div>':'')+(state.role!=='corretor'&&corrNome(p.corretor)!=='—'?'<div class="fz12 t500" style="margin-top:6px">Corretor: '+esc(corrNome(p.corretor))+'</div>':'')+'<div class="fx ac g3 fz12 t500" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--ink100)">'+statusPill(p.status)+'<span class="mono t400" style="margin-left:auto">'+esc(p.code)+'</span></div></div></button>').join('')+'</div>';
  }
  return '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:760px"><thead><tr><th>Código</th><th>Imóvel</th><th>Tipo</th><th>Finalidade</th><th>Proprietário</th><th class="tright">Valor</th></tr></thead><tbody>'+list.map(p=>'<tr data-prop="'+p.id+'"><td class="mono fz13 fw6 t900">'+esc(p.code)+'</td><td><div class="fw6 t900">'+esc(p.rua)+'</div><div class="fz12 t500">'+esc(p.bairro)+'</div></td><td class="t700">'+esc(p.tipo)+'</td><td>'+pill(p.finalidade,p.finalidadeRaw==='locacao'?'ai':'info')+'</td><td class="t700">'+esc(p.proprietarioNome)+'</td><td class="tright mono fw6 t900">'+(p.preco?brlFull(p.preco):'—')+'</td></tr>').join('')+'</tbody></table></div></div>';
}
function updateImoveis(){ const el=$('#imoveisList'); if(el){ el.innerHTML=imoveisList(); refreshIcons(); } }
RENDERERS.imoveis=function(host){
  const fs=['Todos','Venda','Locação'];
  host.innerHTML=pageHead(hTitulo('Imóveis'),'Carteira de imóveis da imobiliária — reutilizáveis entre negócios.','')
  + '<div class="fx ac jb wrap g3" style="margin-bottom:16px"><div class="fx ac g2 wrap">'+fs.map(t=>'<button class="chip'+(state.imoveisFiltro===t?' active':'')+'" data-action="imotipo" data-v="'+t+'">'+t+'</button>').join('')+'</div><div class="fx ac g2"><div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(260px,55vw)">'+icon('search',16,'tmut')+'<input data-input="imoveisBusca" value="'+esc(state.imoveisBusca||'')+'" placeholder="Buscar imóvel…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div><div class="fx" style="background:var(--raised);border:1px solid var(--bd);border-radius:8px;padding:3px"><button class="seg'+(state.imoveisView==='cards'?" active":"")+'" data-action="imoview" data-v="cards" style="color:'+(state.imoveisView==='cards'?'':'var(--ondarkmuted)')+'">'+icon('layout-grid',15)+'</button><button class="seg'+(state.imoveisView==='tabela'?" active":"")+'" data-action="imoview" data-v="tabela" style="color:'+(state.imoveisView==='tabela'?'':'var(--ondarkmuted)')+'">'+icon('list',15)+'</button></div></div></div>'
  + '<div id="imoveisList">'+imoveisList()+'</div>';
};
function openProp(id){ state.currentProp=id; if(!state.imovelTab)state.imovelTab='dados'; openDrawer(propDrawer(id)); }
const DOC_LABELS={matricula:'Matrícula',iptu:'IPTU',escritura:'Escritura',contaConsumo:'Conta de consumo',rgCpf:'RG / CPF',comprovanteRenda:'Comprovante de renda',contrato:'Contrato',habitese:'Habite-se',planta:'Planta',fotos:'Fotos'};
function docLabel(k){ return DOC_LABELS[k] || String(k).replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()); }
function propDrawer(id){
  const p=prop(id); const tab=state.imovelTab||'dados'; const negs=DEALS.filter(d=>d.imovelId===id); const gi=PROPERTIES.indexOf(PROPERTIES.find(x=>x.id===id));
  const tabs=[['dados','Dados'],['interessados','Interessados'],['docs','Documentos'],['vinc','Negócios']];
  let body='';
  if(tab==='dados'){ body='<div>'+kv('Finalidade',p.finalidade)+kv('Tipo',esc(p.tipo))+kv('Valor','<span class="mono">'+(p.preco?brlFull(p.preco):'—')+(p.finalidadeRaw==='locacao'?'/mês':'')+'</span>')+kv('Situação',p.status)+(p.area?kv('Área',esc(p.area)+' m²'):'')+(p.dorm?kv('Dormitórios',esc(p.dorm)):'')+(p.vaga!=null?kv('Vagas',esc(p.vaga)):'')+kv('Bairro',esc(p.bairro))+kv('Cidade',esc(p.cidade))+'</div><div class="card" style="margin-top:14px;padding:12px 14px;background:var(--ink50);border-color:var(--ink200)"><div class="fz11 t500">Proprietário</div><div class="fz14 fw6 t900">'+esc(p.proprietarioNome)+'</div>'+(p.proprietarioContato?'<div class="fz12 t500">'+esc(p.proprietarioContato)+'</div>':'')+'</div>'; }
  else if(tab==='interessados'){ const its=p.interessados||[]; const ehG=state.role==='broker'; const fichaOpts=[]; if(p.finalidadeRaw!=='locacao')fichaOpts.push(['ficha-proposta.html','Comprador']); if(p.finalidadeRaw!=='venda'){fichaOpts.push(['ficha-pf.html','Locatário PF']);fichaOpts.push(['ficha-pj.html','Locatário PJ']);} const enviarFicha='<div class="card" style="padding:12px 14px;margin-bottom:14px;background:var(--ink50);border-color:var(--ink200)"><div class="fz12 fw7 t800" style="margin-bottom:2px">Enviar ficha ao interessado</div><div class="fz11 t500" style="margin-bottom:10px">O link já vai amarrado a este imóvel — quando o cliente responder, ele entra aqui como “Ficha recebida”.</div><div class="fx g2 wrap">'+fichaOpts.map(f=>'<button class="btn btn-outline sm" data-action="int-ficha-copy" data-arq="'+f[0]+'" data-imovel="'+esc(p.id)+'">'+icon('copy',14)+f[1]+'</button>').join('')+'</div></div>'; body=enviarFicha+(its.length?its.map((it,idx)=>{ const st=it.status||''; let ac=''; if(ehG){ if(st==='ficha_recebida'||st==='em_analise'||st==='ficha_enviada'){ ac='<div class="fx g2" style="margin-top:10px"><button class="btn btn-primary sm" data-action="int-aprovar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'">'+icon('check',14)+'Aprovar</button><button class="btn btn-outline sm" data-action="int-reprovar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'">'+icon('x',14)+'Reprovar</button></div>'; } else if(st==='aprovado'){ ac='<div class="fx" style="margin-top:10px"><button class="btn btn-primary sm" data-action="int-gerar" data-imovel="'+esc(p.id)+'" data-idx="'+idx+'">'+icon('handshake',14)+'Gerar negócio</button></div>'; } } return '<div style="border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px;padding:11px 12px"><div class="fx ac g3">'+avatar(it.nome,34,'var(--ink800)')+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(it.nome||'—')+'</div><div class="fz11 t500">'+esc(it.contato||'')+'</div></div>'+pill(st.replace(/_/g,' '),'neutral')+'</div>'+ac+'</div>'; }).join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum interessado ainda — envie uma ficha acima.</div>'); }
  else if(tab==='docs'){
    const raw=(p.raw&&p.raw.documentos)||{};
    const anexos=Object.entries(raw).filter(([,url])=>typeof url==='string' && /^https?:/i.test(url));
    const ehVenda=p.finalidadeRaw==='venda'||p.finalidadeRaw==='venda_locacao';
    body=(ehVenda?'<button class="btn btn-primary sm" data-action="gerar-contrato" data-imovel="'+esc(p.id)+'" style="width:100%;margin-bottom:14px">'+icon('file-text',15)+'Gerar Contrato de representação</button>':'')
      + '<div class="fz12 up fw7 t500" style="margin-bottom:10px">Anexos da ficha</div>'
      + (anexos.length?anexos.map(([k,url])=>'<a class="fx ac g3 hoverbg" href="'+esc(url)+'" target="_blank" rel="noopener" style="text-decoration:none;padding:10px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px">'+iconChip('file-text','info',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(docLabel(k))+'</div><div class="fz11 t500">Anexo do imóvel</div></div>'+icon('download',15,'t400')+'</a>').join(''):'<div class="fz13 t500" style="margin-bottom:12px">Nenhum anexo enviado ainda.</div>')
      + '<button class="btn btn-outline sm" data-action="add-doc" style="width:100%;margin-top:6px">'+icon('plus',15)+'Adicionar documento</button>';
  }
  else { body=negs.length?negs.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:1px solid var(--ink200);border-radius:10px;padding:10px 12px;cursor:pointer;margin-bottom:8px">'+iconChip('handshake',d.tipo==='Venda'?'info':'ai',34)+'<div class="grow mw0"><div class="fz13 fw6 t900 mono">'+esc(d.code)+'</div><div class="fz11 t500 trunc">'+esc(d.clienteNome)+'</div></div>'+statusPill(d.status)+'</button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum negócio vinculado.</div>'; }
  return drawerHead(p.rua, esc(p.tipo)+' · '+esc(p.code))
   + '<div style="height:150px;background:'+GRAD[(gi<0?0:gi)%GRAD.length]+';position:relative;flex-shrink:0"><span class="mono" style="position:absolute;bottom:12px;left:16px;color:#fff;font-weight:700;font-size:20px;text-shadow:0 1px 4px rgba(0,0,0,.3)">'+(p.preco?brlFull(p.preco)+(p.finalidadeRaw==='locacao'?'<span style="font-size:13px;font-weight:500">/mês</span>':''):'')+'</span><span class="pill" style="position:absolute;top:12px;left:16px;background:rgba(255,255,255,.92);color:var(--ink900)">'+p.finalidade+'</span></div>'
   + '<div class="fx g1" style="padding:2px 16px 0;border-bottom:1px solid var(--ink100);overflow-x:auto">'+tabs.map(t=>'<button class="tab'+(tab===t[0]?' active':'')+'" data-action="itab-'+t[0]+'">'+t[1]+'</button>').join('')+'</div>'
   + '<div class="grow scrolly" style="overflow:auto;padding:18px 20px">'+body+'</div>'
   + '<div class="fx g2" style="padding:14px 20px;border-top:1px solid var(--ink100)"><button class="btn btn-outline sm grow" data-action="close-drawer">Fechar</button></div>';
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
  const nomes=['Todos'].concat(perc.map(p=>p.nome));
  const sel=(id,opts,val)=>'<select class="input" data-action="'+id+'" style="width:auto;background-color:var(--raised);border-color:var(--bd);color:#fff">'+opts.map(o=>'<option'+(o===val?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
  host.innerHTML=pageHead(hTitulo('Relatórios'),'Visão executiva da operação — comissões, produção e funil.', sel('relcorr',nomes,corr)+'<button class="btn btn-outline" data-action="export-rel">'+icon('download',16)+'Exportar</button>')
  + '<div class="grid4" style="margin-bottom:16px">'+relKpi('Comissão prevista',brl(KPI.comissaoPrevista),'Pipeline total','var(--ink900)')+relKpi('Comissão recebida',brl(KPI.comissaoRecebida),'Concluídos','var(--successtx)')+relKpi('Comissão pendente',brl(KPI.comissaoPendente),'A receber','var(--warningtx)')+relKpi('Negócios encerrados',KPI.encerradosMes,'No período','var(--ink900)')+'</div>'
  + '<div class="card" style="padding:20px;margin-bottom:16px"><div class="fz13 fw5 t500">Repasse aos corretores (50%) <span class="pill neutral" style="font-size:10px">estimado</span></div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:var(--ink900)">'+brlFull(KPI.pagoCorretores+KPI.pendenteCorretores)+'</div><div class="fx" style="margin-top:12px;height:8px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="width:'+((KPI.pagoCorretores+KPI.pendenteCorretores)?Math.round(KPI.pagoCorretores/(KPI.pagoCorretores+KPI.pendenteCorretores)*100):0)+'%;background:var(--success)"></div><div class="grow" style="background:rgba(245,158,11,.7)"></div></div><div class="fx jb" style="margin-top:8px;font-size:12px"><span class="c-suc fw6">Concluídos '+brl(KPI.pagoCorretores)+'</span><span class="c-war fw6">A receber '+brl(KPI.pendenteCorretores)+'</span></div><div class="fz11 t400" style="margin-top:8px">Valores estimados (50% da comissão) — não é controle de pagamento.</div></div>'
  + '<div class="split" style="margin-bottom:16px">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Produção por corretor')+'<div style="padding:18px 20px;display:flex;flex-direction:column;gap:18px">'+(perc.length?perc.filter(p=>corr==='Todos'||p.nome===corr).map(p=>'<div><div class="fx ac g3" style="margin-bottom:8px">'+avatar(p.nome,34,'var(--ink800)',p.foto)+'<div class="grow"><div class="fz14 fw6 t900">'+esc(p.nome)+'</div><div class="fz12 t500">'+p.vendas+' vendas · '+p.loc+' locações · VGV '+brl(p.vgv)+'</div></div><div class="mono fw7 t900">'+brlFull(p.com)+'</div></div><div style="height:10px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(p.com/maxCom*100)+'%;background:'+p.cor+'"></div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:20px">Sem negócios no período.</div>')+'</div></div>'
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
  if(k==='comissao'){ return box('Tipos de comissão',[['Venda','6% sobre o valor da venda','percent','info'],['Locação','100% do primeiro aluguel','key-round','ai'],['Repasse corretor','50% da comissão da imobiliária','users','success']].map(r=>'<div class="fx ac g3" style="padding:12px;border-bottom:1px solid var(--ink100)">'+iconChip(r[2],r[3],38)+'<div class="grow"><div class="fz14 fw6 t900">'+r[0]+'</div><div class="fz12 t500">'+r[1]+'</div></div></div>').join('')); }
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
}

/* ============================ EVENTOS (escopados no #bkRoot) ============================ */
function wireEvents(root){
  root.addEventListener('click', e=>{
    // Clicar no backdrop fecha drawer/modal/gaveta. Delegado no `root` (persistente)
    // — o #overlay é recriado a cada mount, então um listener direto nele vazaria.
    if(e.target.id==='overlay'){ closeDrawer(); closeModal(); closeMobileNav(); return; }
    const nav=e.target.closest('[data-nav]'); if(nav){ navigate(nav.dataset.nav); return; }
    const ops=e.target.closest('[data-ops]'); if(ops){ const f=ops.dataset.ops; state.negFiltroStatus=(f&&f!=='Todos')?f:'Todos'; navigate('negocios'); return; }
    const chk=e.target.closest('[data-chk]'); if(chk){ negAtualizar({negocioId:state.currentDeal, acao:'checklist', key:chk.dataset.chk, feito:chk.dataset.feito==='1'}); return; }
    // [data-action] ANTES das linhas container: um botão de ação dentro de uma
    // linha `data-deal` (ex.: Clicksign "Abrir"/"Reenviar") deve disparar a ação,
    // não abrir o detalhe da linha que o envolve.
    const act=e.target.closest('[data-action]'); if(act){ handleAction(act.dataset.action, act); return; }
    const deal=e.target.closest('[data-deal]'); if(deal){ openDeal(deal.dataset.deal); return; }
    const pers=e.target.closest('[data-person]'); if(pers){ openPerson(pers.dataset.person); return; }
    const pr=e.target.closest('[data-prop]'); if(pr){ openProp(pr.dataset.prop); return; }
  });
  root.addEventListener('input', e=>{
    // Busca do topbar (só visível na janela standalone; no Hub o topbar é escondido):
    // roteia pra busca da tela ativa em vez de ficar inerte.
    if(e.target.id==='globalSearch'){ globalFilter(e.target.value); return; }
    const t=e.target.closest('[data-input]'); if(!t) return; const k=t.dataset.input;
    if(k==='negBusca'){ state.negBusca=t.value; updateNegTable(); }
    else if(k==='pessoasBusca'){ state.pessoasBusca=t.value; updatePessoas(); }
    else if(k==='imoveisBusca'){ state.imoveisBusca=t.value; updateImoveis(); }
    else if(k==='cliBusca'){ state.cliBusca=t.value; if(typeof updateClientes==='function') updateClientes(); }
  });
  root.addEventListener('change', e=>{ const t=e.target.closest('select[data-action]'); if(!t)return; const a=t.dataset.action; if(a==='negstatus'){ state.negFiltroStatus=t.value; RENDERERS.negocios($('#root')); refreshIcons(); } else if(a==='relcorr'){ state.relCorretor=t.value; RENDERERS.relatorios($('#root')); refreshIcons(); } });
  document.addEventListener('keydown', e=>{ if(!ROOT()||ROOT().hidden) return; if(e.key==='Escape'){ closeDrawer(); closeModal(); closeMobileNav(); } });
}
function handleAction(a,el){
  if(a==='sair'){ unmount(); if(typeof state.onExit==='function') state.onExit(); }
  else if(a==='mobilenav') openMobileNav();
  else if(a==='mobilenav-close') closeMobileNav();
  else if(a==='close-drawer') closeDrawer();
  else if(a==='close-modal') closeModal();
  else if(a==='negtipo'){ state.negFiltroTipo=el.dataset.v; RENDERERS.negocios($('#root')); refreshIcons(); }
  else if(a==='pesstipo'){ state.pessoasFiltro=el.dataset.v; RENDERERS.pessoas($('#root')); refreshIcons(); }
  else if(a==='pessview'){ state.pessoasView=el.dataset.v; RENDERERS.pessoas($('#root')); refreshIcons(); }
  else if(a==='imotipo'){ state.imoveisFiltro=el.dataset.v; RENDERERS.imoveis($('#root')); refreshIcons(); }
  else if(a==='imoview'){ state.imoveisView=el.dataset.v; RENDERERS.imoveis($('#root')); refreshIcons(); }
  else if(a.indexOf('dealtab-')===0){ state.dealTab=a.slice(8); openDeal(state.currentDeal); }
  else if(a.indexOf('ptab-')===0){ state.pessoaTab=a.slice(5); openPerson(state.currentPerson); }
  else if(a.indexOf('itab-')===0){ state.imovelTab=a.slice(5); openProp(state.currentProp); }
  else if(a.indexOf('cfgtab-')===0){ state.cfgTab=a.slice(7); RENDERERS.configuracoes($('#root')); refreshIcons(); }
  else if(a==='add-coment'){ const ta=$('#bkComent'); const txt=ta?ta.value.trim():''; if(!txt){ toast('Escreva algo primeiro','alert-triangle','var(--warning)'); return; } negAtualizar({negocioId:state.currentDeal, acao:'comentario', texto:txt}, 'Comentário adicionado'); }
  else if(a==='sem-drive') toast('Este negócio ainda não tem pasta do Drive vinculada','folder-open','var(--warning)');
  else if(a==='export-rel') toast('Exportação de relatório — em breve nesta tela','download','var(--brand)');
}

/* Rerender pessoas carrega a lista sob demanda ao entrar na aba */
const _origPessoas = RENDERERS.pessoas;
RENDERERS.pessoas = function(host){ _origPessoas(host); if(!PEOPLE.length){ carregarPessoas().then(()=>{ if(state.view==='pessoas'||state.view==='clientes') updatePessoas(); }); } };

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
    {id:'fila',ico:'kanban',label:'Fila de Trabalho'},
    {id:'pessoas',ico:'users',label:'Pessoas'},
    {id:'imoveis',ico:'building-2',label:'Imóveis'},
    {id:'negocios',ico:'handshake',label:'Negócios'},
    {id:'documentos',ico:'folder',label:'Documentos'},
    {id:'clicksign',ico:'file-signature',label:'Clicksign'},
    {id:'drive',ico:'hard-drive',label:'Google Drive'},
    {id:'agenda',ico:'calendar',label:'Agenda'},
    {id:'relatorios',ico:'clipboard-list',label:'Relatórios Operacionais'},
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
  if(r==='corretor'){ if(v==='imoveis') return 'Meus Imóveis'; if(v==='negocios') return 'Meus Negócios'; if(v==='pessoas'||v==='clientes') return 'Meus Clientes'; }
  if(r==='administrativo' && v==='relatorios') return 'Relatórios Operacionais';
  return base;
}

// Clientes (corretor) — layout do mockup (Nome/Tipo/Telefone/Negócios), dado REAL
// (o backend já devolve só as pessoas do corretor via `pessoasListar`).
const CLI_TIPOS=['Todos','Comprador','Locatário','Proprietário','Fiador'];
function cliTipoColor(t){ return t==='Comprador'?'success':t==='Locatário'?'ai':t==='Fiador'?'warning':'info'; }
function clientesRows(){
  const q=(state.cliBusca||'').toLowerCase().trim(); const f=state.cliFiltro||'Todos';
  const list=PEOPLE.filter(p=>{ if(f!=='Todos'&&!p.tipos.includes(f))return false; if(q&&(p.nome+' '+p.email+' '+p.cpf).toLowerCase().indexOf(q)<0)return false; return true; });
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

/* ---------------- DASHBOARD por papel ---------------- */
const _dashBroker = RENDERERS.dashboard;
RENDERERS.dashboard = function(host){
  if(state.role==='corretor') return renderDashCorretor(host);
  if(state.role==='administrativo') return renderDashAdmin(host);
  return _dashBroker(host);
};

// Mesmo critério do Hub (BASE_HOSTING): a ficha resolve o backend pelo hostname
// DELA, então link de produção gravaria dado de teste na PRODUÇÃO quando o
// corretor está no staging. `.exe` (file://) e web.app de produção → produção.
// Produção SÓ quando roda em produção de verdade: `.exe` (file://, sem hostname)
// ou o web.app de produção. Staging, localhost e emulador → staging (nunca gerar
// link que gravaria ficha de teste na PRODUÇÃO).
const _fichaHost = (typeof location !== 'undefined') ? location.hostname : '';
const _fichaProd = (_fichaHost === '' || _fichaHost === 'remax-smart-hub.web.app' || _fichaHost === 'remax-smart-hub.firebaseapp.com');
const FICHA_HOST = _fichaProd ? 'https://remax-smart-hub.web.app' : 'https://remax-smart-hub-staging.web.app';
const FICHAS_CORRETOR = [
  ['ficha-locador.html','Locador','house','info'],
  ['ficha-vendedor.html','Vendedor','key-round','success'],
  ['ficha-pf.html','Pessoa Física','user','ai'],
  ['ficha-pj.html','Pessoa Jurídica','building-2','brand'],
  ['ficha-locacao-fiador.html','Locação c/ Fiador','shield','warning'],
  ['ficha-proposta.html','Proposta','file-signature','danger'],
];
function fichaLink(arquivo){ const uid=(auth.currentUser&&auth.currentUser.uid)||''; return FICHA_HOST+'/'+arquivo+'?corretor='+encodeURIComponent(uid)+'&nome='+encodeURIComponent(state.meuNome||''); }
// Link da ficha AMARRADO a um imóvel: carrega o UID do DONO do imóvel (não o do usuário
// logado) — o gestor manda ficha pro imóvel do corretor sem roubar atribuição, e o trigger
// só aceita ficha cujo corretorUid === dono do imóvel (trava anti-injeção).
function fichaLinkImovel(arquivo, imovelId){ const p=prop(imovelId); const uid=(p&&p.corretor)||(auth.currentUser&&auth.currentUser.uid)||''; return FICHA_HOST+'/'+arquivo+'?corretor='+encodeURIComponent(uid)+'&nome='+encodeURIComponent(state.meuNome||'')+'&imovelId='+encodeURIComponent(imovelId); }

function saudacao(){ const h=new Date().getHours(); return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'; }
const repasse = d => Math.round((d.comValor||0)*0.5);
function renderDashCorretor(host){
  const primeiro=(state.meuNome||'Corretor').split(' ')[0];
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
    '<div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Seu centro de trabalho — ações do dia e ferramentas sempre à mão.</p></div>'
  + '<div class="grid3" style="margin-top:20px">'
    + kcard('handshake','info','Negócios ativos',ativos,['Em andamento','c-inf'],'negocios')
    + kcard('house','brand','Captações',captacoes,['Imóveis na carteira','c-suc'],'imoveis')
    + kcard('users','ai','Meus clientes',PEOPLE.length,['Vinculados a você','c-ai'],'clientes')
    + kcard('file-signature','warning','Propostas em andamento',props,['Em negociação','c-war'],'negocios')
    + kcard('wallet','success','Comissão prevista',brl(MYCOM.prevista),['Repasse estimado (50%)','c-suc'],'comissoes')
    + kcard('badge-dollar-sign','success','Comissão recebida',brl(MYCOM.recebida),['Negócios concluídos','c-suc'],'comissoes')
  + '</div>'
  + '<div class="card" style="padding:12px;margin-top:16px"><div class="fx wrap g2">'+atalhos.map(x=>'<button class="btn btn-outline sm" data-action="'+x[0]+'">'+icon(x[1],15)+x[2]+'</button>').join('')+'</div></div>'
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
    '<div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">'+saudacao()+', '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Centro de operações — mantenha todos os processos em andamento.</p></div>'
  + '<div class="grid3" style="margin-top:20px">'+cards.map(kc).join('')+'</div>'
  + blockH('Resumo da fila','Distribuição dos negócios por etapa')
  + '<div class="card" style="padding:16px"><div class="fx wrap g2">'+RESUMO.map(c=>'<button class="fx ac g2 hoverbg" data-nav="fila" style="flex:1;min-width:150px;background:var(--ink50);border:none;border-radius:10px;padding:12px;cursor:pointer;text-align:left"><span style="width:10px;height:10px;border-radius:50%;background:'+c[2]+'"></span><div><div class="fz18 fw7 t900">'+c[1]+'</div><div class="fz12 t500">'+c[0]+'</div></div></button>').join('')+'</div></div>'
  + '<div class="split" style="margin-top:16px">'
    + '<div class="card" style="overflow:hidden">'+cardHead('Precisa de atenção','<button class="btn-dark-ghost" style="color:var(--brand)" data-nav="fila">Ver fila</button>')+'<div style="padding:8px">'+(crit.length?crit.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:none;padding:11px 12px;border-radius:10px;cursor:pointer">'+iconChip('alert-triangle','danger',32)+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(d.code)+' · '+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500 trunc">'+esc(d.clienteNome)+' · '+esc(corrNome(d.corretor))+'</div></div><span class="fz12 t500 mono nsh">'+d.diasParado+'d</span></button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nada parado. 🎉</div>')+'</div></div>'
    + '<div class="card" style="overflow:hidden">'+cardHead('Atividades recentes')+'<div style="padding:16px">'+(ACTIVITY.length?ACTIVITY.map((a,i)=>'<div class="fx g3"><div class="fx col ac">'+iconChip('circle-dot','info',30)+(i<ACTIVITY.length-1?'<span class="timeline-line"></span>':'')+'</div><div style="padding-bottom:14px" class="mw0 grow"><div class="fz13 fw6 t900 trunc">'+esc(a.txt)+'</div><div class="fz12 t500 trunc">'+esc(a.sub)+'</div><div class="fz11 t400 mono" style="margin-top:2px">'+esc(a.quando)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem atividades recentes.</div>')+'</div></div>'
  + '</div>';
}

/* ---------------- FILA DE TRABALHO (kanban REAL, por status do negócio) ---------------- */
RENDERERS.fila = function(host){
  const COLS=[['Novos',['negocio_criado'],'#2563EB'],['Em andamento',['em_andamento','aguardando_corretor'],'#7C3AED'],['Aguardando',['aguardando_administrativo','aguardando_broker'],'#F59E0B'],['Entregues',['entregue_gestao','concluido'],'#16A34A']];
  const q=(state.filaBusca||'').toLowerCase().trim();
  const inQ=d=>!q||(d.code+' '+propDoDeal(d).rua+' '+d.clienteNome+' '+corrNome(d.corretor)).toLowerCase().indexOf(q)>=0;
  host.innerHTML=pageHead('Fila de Trabalho','Todos os negócios por etapa — clique num cartão pra abrir.','<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(280px,50vw)">'+icon('search',16,'tmut')+'<input data-input="filaBusca" value="'+esc(state.filaBusca||'')+'" placeholder="Buscar…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>')
  + '<div style="overflow-x:auto;padding-bottom:8px" class="scrolly"><div class="gd" style="grid-template-columns:repeat('+COLS.length+',minmax(240px,1fr));gap:14px;align-items:start;min-width:900px">'+COLS.map(c=>{ const list=DEALS.filter(d=>c[1].includes(d.statusRaw)&&inQ(d)); return '<div class="card" style="padding:0;overflow:hidden"><div class="fx ac jb" style="padding:12px 14px;border-bottom:1px solid var(--ink100)"><span class="fx ac g2 fz12 up fw7 t700"><span style="width:9px;height:9px;border-radius:50%;background:'+c[2]+'"></span>'+c[0]+'</span><span class="pill neutral">'+list.length+'</span></div><div style="padding:10px;display:flex;flex-direction:column;gap:8px;min-height:60px">'+(list.length?list.map(d=>'<button class="card card-hover" data-deal="'+d.id+'" style="padding:12px;text-align:left"><div class="fx ac jb g2"><span class="mono fz12 fw7 t900">'+esc(d.code)+'</span><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'" style="font-size:10px;padding:1px 7px">'+d.tipo+'</span></div><div class="fz13 fw6 t900 trunc" style="margin-top:6px">'+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500 trunc">'+esc(d.clienteNome)+'</div><div class="fx ac jb g2" style="margin-top:8px"><span class="fz11 t400 mono">'+d.diasParado+'d parado</span>'+avatar(corrNome(d.corretor),22,'var(--ink800)',corrFoto(d.corretor))+'</div></button>').join(''):'<div class="tcenter t400 fz12" style="padding:16px 0">—</div>')+'</div></div>'; }).join('')+'</div></div>';
};
function updateFila(){ if(state.view==='fila') RENDERERS.fila($('#root')); refreshIcons(); }

/* ---------------- MINHAS COMISSÕES (corretor) ---------------- */
RENDERERS.comissoes = function(host){
  const rep=d=>Math.round((d.comValor||0)*0.5);
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
  host.innerHTML=pageHead('Minhas Comissões','Sua comissão (repasse estimado de 50%) por negócio. Valores estimados até a baixa financeira.','')
  + '<div class="grid3" style="margin-bottom:16px">'+card('Prevista',prevista,'wallet','info')+card('Recebida',recebida,'badge-dollar-sign','success','var(--successtx)')+card('Pendente',pendente,'hand-coins','warning','var(--warningtx)')+'</div>'
  + '<div class="card" style="padding:18px 20px;margin-bottom:16px"><div class="fz12 up fw7 t500" style="margin-bottom:12px">Evolução mensal (recebido)</div>'+chart+'</div>'
  + '<div class="card" style="overflow:hidden">'+cardHead('Comissões por negócio')+'<div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:520px"><thead><tr><th>Negócio</th><th>Cliente</th><th>Status</th><th class="tright">Repasse</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr style="cursor:default"><td class="mono fz13 fw6 t900">'+esc(r.code)+'</td><td class="t700">'+esc(r.cli)+'</td><td>'+pill(r.st,r.st==='Recebida'?'success':'info')+'</td><td class="tright mono fw6 t900">'+brlFull(r.val)+'</td></tr>').join(''):'<tr><td colspan="4" class="tcenter t500" style="padding:24px">Sem negócios ainda.</td></tr>')+'</tbody></table></div></div>';
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
    + '<div class="card" style="padding:22px;text-align:center">'+(foto?'<span class="avatar" style="width:88px;height:88px;background-image:url('+foto+');background-size:cover;background-position:center;margin:0 auto"></span>':avatar(p.displayName||state.meuNome,88,'var(--brand)'))+'<div class="fz18 fw7 t900" style="margin-top:12px">'+esc(p.displayName||state.meuNome)+'</div><div class="fz13 t500">'+roleLabel()+' · REMAX SMART</div><div class="fz12 t500" style="margin-top:8px">'+esc(p.email||'')+'</div></div>'
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

/* ---- Documentos (corretor + administrativo) — sem integração ainda ---- */
RENDERERS.documentos = function(host){
  if(state.role==='administrativo') return emBreveTela(host,'Documentos','Central documental — categorias, versões e histórico.','folder','A central de documentos vai reunir aqui os anexos das fichas e os contratos de cada negócio. Hoje eles vivem dentro de cada negócio (aba Negócios) e no Google Drive.');
  return emBreveTela(host,'Documentos','Contratos, propostas e documentos dos seus negócios.','folder','Aqui vão ficar os contratos, propostas e documentos dos seus negócios. Por enquanto, os anexos ficam dentro de cada negócio (aba Meus Negócios).');
};

/* ---- Clicksign (administrativo) — status vem do checklist REAL dos negócios ---- */
RENDERERS.clicksign = function(host){
  const map={'—':['Não enviado','neutral'],'Enviado':['Enviado','info'],'Concluído':['Assinado','success']};
  host.innerHTML=pageHead('Clicksign','Status de assinatura eletrônica dos negócios (a assinatura em si é feita no app do Clicksign).')
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:680px"><thead><tr><th>Negócio</th><th>Cliente</th><th>Tipo</th><th>Status</th><th class="tright">Ações</th></tr></thead><tbody>'+(DEALS.length?DEALS.map(d=>{ const s=map[d.clicksign]||['Não enviado','neutral']; return '<tr data-deal="'+d.id+'"><td class="mono fz13 fw6 t900">'+esc(d.code)+'</td><td class="t700">'+esc(d.clienteNome)+'</td><td>'+pill(d.tipo,d.tipo==='Venda'?'info':'ai')+'</td><td>'+pill(s[0],s[1])+'</td><td class="tright"><div class="fx je g1 nsh"><button class="btn btn-outline sm" data-action="clk-open">'+icon('external-link',14)+'Abrir</button><button class="btn btn-outline sm" data-action="clk-resend">'+icon('send',14)+'Reenviar</button></div></td></tr>'; }).join(''):'<tr><td colspan="5" class="tcenter t500" style="padding:24px">Nenhum negócio ainda.</td></tr>')+'</tbody></table></div></div>';
};

/* ---- Google Drive (administrativo) — sem integração ainda ---- */
RENDERERS.drive = function(host){
  emBreveTela(host,'Google Drive','Estrutura de pastas dos negócios.','hard-drive','A integração com o Google Drive (pastas por negócio, sincronização de anexos) depende de uma service account e ainda não está ligada. Cada negócio pode guardar um link do Drive na aba Negócios.');
};

/* ---- Agenda (corretor + administrativo) — sem fonte de eventos ainda ---- */
RENDERERS.agenda = function(host){
  emBreveTela(host,'Agenda','Visitas, vistorias, assinaturas e reuniões.','calendar','A visão de calendário desta tela ainda está por vir. A agenda da equipe (com seus eventos reais) já funciona no Hub — abra por aqui.','<button class="btn btn-primary sm" data-action="hub-agenda"><i data-lucide="calendar" style="width:16px;height:16px"></i>Abrir agenda do Hub</button>');
};

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
  if(a==='novo-menu'){ toast('Use os atalhos do painel para começar','plus','var(--brand)'); return; }
  if(a==='novo-cliente'||a==='novo-imovel'){
    // Cliente e imóvel nascem de uma FICHA — leva pro Cadastro do Hub (todas as fichas).
    if(!(window.hubAbrirCategoria && window.hubAbrirCategoria('documentos'))){ navigate('dashboard'); toast('Envie a ficha na seção "Fichas digitais"','clipboard-list','var(--brand)'); }
    return;
  }
  if(a==='novo-negocio'){
    // O negócio é GERADO a partir de um interessado aprovado no imóvel (decisão do gestor).
    navigate('imoveis');
    toast('O negócio nasce de um interessado aprovado no imóvel — abra o imóvel para gerar','handshake','var(--brand)');
    return;
  }
  if(a==='agendar-visita'||a==='hub-agenda'){
    // Agenda de verdade é a do HUB (a interna saiu do menu). Fallback: tela interna.
    if(!(window.hubAbrirCategoria && window.hubAbrirCategoria('agenda'))) navigate('agenda');
    return;
  }
  if(a==='enviar-ficha'){ navigate('dashboard'); toast('Escolha a ficha na seção "Fichas digitais"','clipboard-list','var(--brand)'); return; }
  if(a==='whatsapp-quick'){ window.open('https://web.whatsapp.com/','_blank'); return; }
  if(a==='abrir-drive'){ window.open('https://drive.google.com','_blank'); return; }
  if(a==='clicksign'){
    if(state.role==='administrativo'){ navigate('clicksign'); return; }
    // Integra com o app ClickSign do Hub (restrito — o Hub checa a permissão).
    if(!(window.hubAbrirApp && window.hubAbrirApp('clicksign'))) emBreve('ClickSign é liberado por pessoa no Admin do Hub.');
    return;
  }
  if(a==='clk-open'){ if(!(window.hubAbrirApp && window.hubAbrirApp('clicksign'))) emBreve('ClickSign é liberado por pessoa no Admin do Hub.'); return; }
  if(a==='gerar-contrato'){
    if(typeof window.hubGerarContratoVenda!=='function'){ emBreve('Geração de contrato disponível no Hub.'); return; }
    toast('Gerando contrato…','loader-2','var(--brand)');
    window.hubGerarContratoVenda(el.dataset.imovel).then(r=>{ toast((r&&r.msg)||'Pronto', (r&&r.ok)?'file-text':'alert-triangle', (r&&r.ok)?'var(--success)':'var(--danger)'); });
    return;
  }
  if(a==='add-doc'){ emBreve('Upload de documento por aqui em breve — por ora, os anexos vêm das fichas.'); return; }
  if(a==='concluir-proxima'){
    const d=DEALS.find(x=>x.id===state.currentDeal); if(!d) return;
    const nx=(d.checklist||[]).find(x=>!x.feito);
    if(!nx){ toast('Todas as etapas já estão concluídas'); return; }
    negAtualizar({negocioId:d.id, acao:'checklist', key:nx.key, feito:true}, 'Etapa concluída: '+(nx.label||''));
    return;
  }
  // Interessados (gestor): aprovar / reprovar / gerar negócio
  if(a==='int-ficha-copy'){ const l=fichaLinkImovel(el.dataset.arq, el.dataset.imovel); try{ navigator.clipboard.writeText(l); }catch(e){} toast('Link da ficha copiado — mande ao interessado','copy'); return; }
  if(a==='int-aprovar'){ interessadoAcao(el.dataset.imovel, +el.dataset.idx, 'aprovado', 'Interessado aprovado'); return; }
  if(a==='int-reprovar'){ if(confirm('Reprovar este interessado?')) interessadoAcao(el.dataset.imovel, +el.dataset.idx, 'reprovado', 'Interessado reprovado'); return; }
  if(a==='int-gerar'){ if(confirm('Gerar o negócio deste interessado? O imóvel entra em negociação.')) gerarNegocioUI(el.dataset.imovel, +el.dataset.idx); return; }
  // Negócio (gestor): entregar / concluir / cancelar
  if(a==='neg-entregar'){ if(confirm('Entregar este negócio para a gestão? (exige as etapas obrigatórias)')) negAtualizar({negocioId:state.currentDeal, acao:'entregar'}, 'Entregue para a gestão'); return; }
  if(a==='neg-concluir'){ if(confirm('Concluir este negócio? (exige as etapas obrigatórias)')) negAtualizar({negocioId:state.currentDeal, acao:'concluir'}, 'Negócio concluído'); return; }
  if(a==='neg-cancelar'){ if(confirm('Cancelar este negócio? O imóvel volta a Disponível e o interessado volta a Aprovado.')) negAtualizar({negocioId:state.currentDeal, acao:'cancelar'}, 'Negócio cancelado'); return; }
  // Ações operacionais de demonstração (administrativo)
  if(['upload-doc','preview-doc','download-doc','drive-sync','drive-new','clk-resend','reenviar-ficha','alterar-senha','maps','editar','notif'].indexOf(a)>=0){ emBreve('Ação de demonstração — integração em breve.'); return; }
  return _handleAction(a, el);
};

/* Busca da Fila de Trabalho — listener próprio no #bkRoot (o de wireEvents não cobre filaBusca). */
(function(){ const r=ROOT(); if(r) r.addEventListener('input', e=>{ const t=e.target.closest('[data-input="filaBusca"]'); if(t){ state.filaBusca=t.value; updateFila(); } }); })();

/* API pública extra — usada pela SANFONA do Hub (modo embutido):
   - navigate(view): troca de tela do Broker sem remontar (a nav vem da sidebar do Hub);
   - getNav(role): itens de menu daquele papel (o Hub filtra o que quiser, ex.: tira "agenda"). */
window.Broker.navigate = function(view){ const r=ROOT(); if(r && !r.hidden && view){ navigate(view); } };
window.Broker.getNav = function(role){ return (NAV_ROLE[role] || NAV_ROLE.broker).map(n=>({ id:n.id, label:n.label, ico:n.ico })); };
