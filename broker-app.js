/* ============================================================================
   Broker — visão nova da Gestão de Locações (SMART HUB).
   Design 1:1 do mockup do Nathan (Broker (1).html). Estilos em broker.css
   (escopados em #bkRoot). Este módulo:
     - monta o SPA dentro de #bkRoot (overlay tela cheia sobre o Hub);
     - carrega DADOS REAIS via Cloud Functions e mapeia pro formato que os
       renderizadores do mockup esperam (assim o visual fica idêntico);
     - Imóveis / Negócios / Relatórios / Pessoas = dado real;
     - Dashboard "Performance da equipe" + "SMART IA" = MODO DE TESTE
       (dados de demonstração, marcados na tela) até o Nathan definir as métricas.
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
const fnDash      = call('dashboardDados');
const fnPessoas   = call('pessoasListar');    // criada no functions/index.js (gestor)
const fnRoster    = call('listarPessoas');    // usuários do Auth {uid,nome}
const fnFotos     = call('listarFotosPerfil');// {uids} -> {fotos:{uid:dataUrl}}
const fnGetPerfil = call('getMeuPerfil');     // {nome,photo,telefone,creci,cpf,email}
const fnSalvarPerfil = call('salvarMeuPerfil');

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
const dealsByCorretor = c => DEALS.filter(d=>d.corretor===c);
function brl(n){ n=Number(n)||0; if(n>=1000000) return 'R$ '+(n/1000000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M'; if(n>=10000) return 'R$ '+Math.round(n/1000)+'k'; return 'R$ '+n.toLocaleString('pt-BR'); }
function brlFull(n){ return 'R$ '+(Number(n)||0).toLocaleString('pt-BR'); }
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

/* ============================ MODO DE TESTE (dashboard equipe/IA) ============================ */
// Dados de DEMONSTRAÇÃO — não vêm do Firestore. Ver CLAUDE.md. Marcados na tela.
const STALE = { d2:12, d4:8 };
const MESES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const TEAM = {
  aline:{id:'aline',nome:'Aline Sales',cargo:'Corretora',cor:'#DB2777',score:96,cap:8,capV:2,capL:6,vendas:1,loc:4,conversao:72,comPrev:420000,comReceb:180000,comPend:240000,ativos:5,encerrados:6,vgv:520000,ticket:520000,tempoFech:29,tempoResp:'1 h',docsPend:0,tel:'(11) 98330-7742',flag:'green',analise:'Excelente desempenho em captação e alta produtividade em locações. Há uma boa oportunidade de aumentar o número de vendas.',attTxt:'Melhor desempenho geral da imobiliária.',attRec:'',mensal:[30,42,38,55,60,68,72,65,78,82,88,92]},
  alexandre:{id:'alexandre',nome:'Alexandre Gutierres',cargo:'Corretor',cor:'#0EA5E9',score:88,cap:7,capV:2,capL:5,vendas:1,loc:4,conversao:68,comPrev:398000,comReceb:150000,comPend:248000,ativos:5,encerrados:5,vgv:498000,ticket:498000,tempoFech:31,tempoResp:'2 h',docsPend:1,tel:'(11) 99120-4471',flag:'green',analise:'Excelente equilíbrio entre captação e fechamento. Mantém ótima produtividade e consistência ao longo do mês.',attTxt:'Todos os indicadores dentro da meta.',attRec:'',mensal:[45,50,48,58,55,62,66,60,70,68,74,78]},
  leandro:{id:'leandro',nome:'Leandro Freitas',cargo:'Corretor',cor:'#2563EB',score:73,cap:6,capV:4,capL:2,vendas:3,loc:2,conversao:44,comPrev:184700,comReceb:96500,comPend:88200,ativos:5,encerrados:3,vgv:2900000,ticket:966667,tempoFech:31,tempoResp:'2 h',docsPend:1,tel:'(11) 98420-1180',flag:'yellow',analise:'Especialista em vendas de alto valor. A conversão está abaixo da média da equipe e pode melhorar com follow-up.',attTxt:'Conversão abaixo da média da equipe.',attRec:'Reforçar técnicas de negociação e follow-up.',mensal:[22,28,25,31,29,34,38,33,42,45,40,48]},
  adriana:{id:'adriana',nome:'Adriana Dias',cargo:'Corretora',cor:'#7C3AED',score:71,cap:2,capV:1,capL:1,vendas:3,loc:2,conversao:58,comPrev:380200,comReceb:118300,comPend:261900,ativos:5,encerrados:5,vgv:6040000,ticket:2013333,tempoFech:38,tempoResp:'5 h',docsPend:3,tel:'(11) 99655-3320',flag:'red',analise:'Excelente em vendas de alto padrão. Necessita aumentar a captação de novos imóveis para manter o pipeline.',attTxt:'Captação caiu nos últimos 30 dias.',attRec:'Focar em prospecção de novos proprietários.',mensal:[40,55,48,62,58,70,52,60,72,68,75,80]}
};
const badgeTeste = '<span class="pill warning" style="font-size:10.5px;padding:2px 8px" title="Dados de demonstração — as métricas de performance/IA ainda não têm fonte real. Ver CLAUDE.md.">'+icon('flask-conical',12)+'MODO DE TESTE</span>';

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
  const preco = Number(im.valorAnuncio || im.valorProposta || im.valorFechamento || 0);
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
  const comValor = Number((im&&im.raw&&im.raw.valorComissao) || (tipo==='Venda' ? preco*0.06 : preco));
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
    podeComentar: n.comentarios!==null,
  };
}

/* prop()/person() para negócios: fallback quando o imóvel/cliente não está carregado */
function propDoDeal(d){ return PROPERTIES.find(p=>p.id===d.imovelId) || {rua:d.imovelResumo||'Imóvel', bairro:'', cidade:d.cidade||'', code:'', tipo:'', preco:d.valor, finalidade:d.tipo}; }

/* ============================ CARREGAMENTO DE DADOS ============================ */
async function carregarDados(){
  const [imR, ngR, dashR] = await Promise.all([
    fnImoveis({}).catch(()=>({data:{imoveis:[]}})),
    fnNegocios({}).catch(()=>({data:{negocios:[]}})),
    fnDash({}).catch(()=>({data:null})),
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
    comissaoRecebida: DEALS.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+d.comValor,0),
    comissaoPendente: DEALS.filter(d=>d.statusRaw!=='concluido').reduce((s,d)=>s+d.comValor,0),
    pagoCorretores: 0, pendenteCorretores: 0,
    encerradosMes: DEALS.filter(d=>d.statusRaw==='concluido'||d.statusRaw==='entregue_gestao').length,
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
  state.meuNome = opts.nome || state.meuNome;
  state.role = opts.role || 'broker';
  state.view = 'dashboard';
  // Reabrir a Locação começa limpo: sem filtros/seleções/pessoas da sessão anterior.
  Object.assign(state, { negFiltroTipo:'Todos', negFiltroStatus:'Todos', negBusca:'', pessoasFiltro:'Todos', pessoasBusca:'', imoveisFiltro:'Todos', imoveisBusca:'', filaBusca:'', relCorretor:'Todos', currentDeal:null, dealTab:'timeline' });
  PEOPLE = [];
  const root = ROOT();
  if(!root){ console.warn('[broker] #bkRoot ausente'); return; }
  root.innerHTML = shellHTML();
  root.hidden = false;
  document.body.classList.add('bk-open');
  if(!wired){ wireEvents(root); wired = true; }
  navigate('dashboard');
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
function scoreColor(s){ return s>=90?'#16A34A':s>=75?'#2563EB':s>=60?'#F59E0B':'#DC2626'; }
function cstat(id){ return Object.assign({}, TEAM[id]); }
function destaquesFor(t){ const all=Object.values(TEAM); const mx=k=>Math.max.apply(null,all.map(x=>x[k])); const out=[];
  if(t.cap===mx('cap')) out.push({ic:'house',txt:'Melhor captação',v:'success'});
  if(t.conversao===mx('conversao')) out.push({ic:'trending-up',txt:'Melhor conversão',v:'info'});
  if(t.comPrev===mx('comPrev')) out.push({ic:'coins',txt:'Maior comissão',v:'success'});
  if(t.ticket===mx('ticket')) out.push({ic:'gem',txt:'Maior ticket médio',v:'ai'});
  if(t.vendas===mx('vendas')) out.push({ic:'trophy',txt:'Destaque em vendas',v:'success'});
  if(t.flag==='red') out.push({ic:'triangle-alert',txt:'Baixa captação',v:'danger'});
  else if(t.flag==='yellow') out.push({ic:'triangle-alert',txt:'Conversão abaixo da média',v:'warning'});
  if(!out.length) out.push({ic:'circle-check',txt:'Metas em dia',v:'success'});
  return out.slice(0,4);
}
function teamCard(t,rank){
  const medal=['🥇','🥈','🥉'][rank]||''; const sc=scoreColor(t.score);
  const inds=[['house','Captações',t.cap],['dollar-sign','Vendas',t.vendas],['key-round','Locações',t.loc],['trending-up','Conversão',t.conversao+'%'],['wallet','Comissão',brl(t.comPrev)],['handshake','Ativos',t.ativos]];
  const dest=destaquesFor(t);
  return '<div class="card" style="padding:0;overflow:hidden;margin-bottom:14px"><div class="teamgrid">'
   + '<div class="fx col" style="gap:16px"><div class="fx ac g3"><div class="rel">'+avatar(t.nome,52,t.cor)+(medal?'<span style="position:absolute;bottom:-6px;right:-6px;font-size:20px">'+medal+'</span>':'')+'</div><div class="mw0"><div class="fz15 fw7 t900 trunc">'+esc(t.nome)+'</div><div class="fz12 t500">'+t.cargo+' · Ranking #'+(rank+1)+'</div></div></div>'
     + '<div><div class="fx ac jb"><span class="fz11 up fw7 t500">Smart Score</span><span class="fz22 fw7" style="color:'+sc+'">'+t.score+'</span></div><div style="height:8px;border-radius:999px;background:var(--ink100);overflow:hidden;margin-top:6px"><div style="height:100%;border-radius:999px;width:'+t.score+'%;background:'+sc+'"></div></div></div>'
     + '<button class="btn btn-outline sm" data-corr="'+t.id+'" style="margin-top:auto">Ver perfil '+icon('arrow-right',14)+'</button></div>'
   + '<div><div class="gd" style="grid-template-columns:repeat(3,1fr);gap:16px 14px">'+inds.map(x=>'<div class="fx ac g2">'+iconChip(x[0],'brand',34)+'<div class="mw0"><div class="fz11 t500">'+x[1]+'</div><div class="fz15 fw7 t900 trunc">'+x[2]+'</div></div></div>').join('')+'</div><div class="fz13 t600" style="margin-top:16px;line-height:1.55;padding-top:14px;border-top:1px solid var(--ink100)">'+t.analise+'</div></div>'
   + '<div style="background:var(--ink50)"><div class="fz11 up fw7 t500" style="margin-bottom:12px">Destaques</div><div class="fx col g2">'+dest.map(d=>'<div class="fx ac g2 fz13 fw6" style="color:var(--'+d.v+'tx)"><span class="iconchip" style="width:26px;height:26px;background:var(--'+d.v+'bg)">'+icon(d.ic,14)+'</span>'+d.txt+'</div>').join('')+'</div></div>'
   + '</div></div>';
}
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

  function ops(ico,variant,label,qty,prio){ const pc={Alta:'danger','Média':'warning',Baixa:'neutral'}[prio];
    return '<button class="card card-hover" style="padding:16px;text-align:left" data-ops="1"><div class="fx as jb g2">'+iconChip(ico,variant,38)+'<span class="pill '+pc+'">'+prio+'</span></div><div style="margin-top:12px;font-size:26px;font-weight:700;letter-spacing:-.02em;color:var(--ink900)">'+qty+'</div><div class="fz13 fw5 t600" style="margin-top:2px">'+label+'</div></button>'; }
  function tile(label,valor,delta,dir){ const c=dir==='up'?'c-suc':dir==='down'?'c-dan':'t400'; const ar=dir==='up'?'trending-up':dir==='down'?'trending-down':'minus'; const mono=(typeof valor==='string'&&valor.indexOf('R$')===0)?'mono':'';
    return '<div class="card" style="padding:16px"><div class="fz12 fw5 t500">'+label+'</div><div class="'+mono+'" style="margin-top:6px;font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--ink900)">'+valor+'</div><div class="fx ac g1 fz12 fw6 '+c+'" style="margin-top:6px">'+icon(ar,13)+delta+'</div></div>'; }

  const ia=[
    {tag:'Aline Sales',ic:'award',txt:'Melhor Smart Score da equipe, impulsionada por captação e conversão acima da média.',sug:'Direcionar leads de venda para aproveitar a alta conversão.'},
    {tag:'Adriana Dias',ic:'target',txt:'Forte em vendas de alto padrão, porém com baixa captação nos últimos 30 dias.',sug:'Focar em prospecção de novos proprietários.'},
    {tag:'Mercado',ic:'trending-up',txt:'As vendas cresceram 18% em relação ao mês anterior.',sug:''},
    {tag:'Operação',ic:'flame',txt:'4 negócios estão muito próximos do fechamento.',sug:'Comissão estimada: R$ 215.000.'}
  ];
  const funil=[['Leads',60,'#2563EB'],['Visitas',32,'#7C3AED'],['Propostas',18,'#F59E0B'],['Fechados',8,'#16A34A']];
  const maxF=funil[0][1];
  const flagOrder={red:0,yellow:1,green:2};
  const primeiroNome=(state.meuNome||'Broker').split(' ')[0];

  host.innerHTML =
    '<div><h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-.02em;color:#fff">Olá, '+esc(primeiroNome)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Central de comando da REMAX SMART — veja onde concentrar sua atenção hoje.</p></div>'
  + blockH('Centro de operações','O que precisa da sua atenção agora')
  + '<div class="grid4">'
    + ops('search-check','info','Aguardando análise',analise,'Média')
    + ops('file-signature','warning','Aguardando assinatura',assin,'Alta')
    + ops('file-text','warning','Aguardando documentação',docum,'Média')
    + ops('hand-coins','danger','Aguardando comissão',comis,'Alta')
    + ops('pause-circle','danger','Sem movimentação +7 dias',stale,'Alta')
    + ops('folder-clock','warning','Documentos pendentes',docsPend,'Média')
    + ops('calendar-check','info','Próximas ações hoje',hoje,'Alta')
    + ops('alert-triangle','danger','Pendências vencidas',vencidas,'Alta')
  + '</div>'
  + blockH('Performance da imobiliária','Resultados do mês',badgeTeste)
  + '<div class="grid4">'
    + tile('Captações',String(PROPERTIES.length),'imóveis na carteira','flat')
    + tile('Vendas',String(nVendas),'negócios de venda','flat')
    + tile('Locações',String(nLoc),'negócios de locação','flat')
    + tile('VGV','R$ 8,9M','+18% vs mês anterior','up')
    + tile('Ticket médio','R$ 1,49M','+6% vs mês anterior','up')
    + tile('Tempo médio de fechamento','34 dias','-3 dias (melhor)','down')
    + tile('Negócios encerrados',String(KPI.encerradosMes),'no período','flat')
    + tile('Comissão prevista',brl(KPI.comissaoPrevista),'pipeline atual','flat')
  + '</div>'
  + '<div class="grid3" style="margin-top:16px">'
    + '<div class="card" style="padding:20px"><div class="fz13 fw5 t500">Comissão</div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:var(--ink900)">'+brlFull(KPI.comissaoPrevista)+'</div><div class="fx" style="margin-top:12px;height:8px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="width:38%;background:var(--success)"></div><div style="width:62%;background:rgba(245,158,11,.7)"></div></div><div class="fx jb" style="margin-top:8px;font-size:12px"><span class="c-suc fw6">Recebida '+brl(KPI.comissaoRecebida)+'</span><span class="c-war fw6">Pendente '+brl(KPI.comissaoPendente)+'</span></div></div>'
    + '<div class="card" style="padding:20px"><div class="fx ac jb"><div class="fz13 fw6 t800">Funil de conversão</div>'+badgeTeste+'</div><div class="fz11 t400" style="margin-bottom:12px">Oportunidades no trimestre</div>'+funil.map(f=>'<div style="margin-bottom:9px"><div class="fx jb fz12" style="margin-bottom:4px"><span class="t600 fw5">'+f[0]+'</span><span class="fw7 t900">'+f[1]+'</span></div><div style="height:9px;border-radius:999px;background:var(--ink100);overflow:hidden"><div style="height:100%;border-radius:999px;width:'+Math.round(f[1]/maxF*100)+'%;background:'+f[2]+'"></div></div></div>').join('')+'<div class="fz12 t500" style="margin-top:8px">Taxa de conversão: <strong class="c-suc">13%</strong></div></div>'
    + '<div class="card" style="padding:20px"><div class="fz13 fw6 t800" style="margin-bottom:14px">Carteira por finalidade</div><div class="fx col g3">'+[['Venda',PROPERTIES.filter(p=>p.finalidadeRaw==='venda').length,'info','building-2'],['Locação',PROPERTIES.filter(p=>p.finalidadeRaw==='locacao').length,'ai','key-round'],['Venda e Locação',PROPERTIES.filter(p=>p.finalidadeRaw==='venda_locacao').length,'brand','layers']].map(r=>'<div class="fx ac jb"><span class="fx ac g2 fz13 t600">'+iconChip(r[3],r[2],30)+r[0]+'</span><span class="fz18 fw7 t900">'+r[1]+'</span></div>').join('')+'<div class="fx ac jb" style="padding-top:12px;border-top:1px solid var(--ink100)"><span class="fz13 fw6 t900">Total</span><span class="fz20 fw7" style="color:var(--brand)">'+PROPERTIES.length+'</span></div></div></div>'
  + '</div>'
  + blockH('Performance da equipe','Quem está em alta, quem evolui e quem precisa de atenção',badgeTeste)
  + Object.values(TEAM).sort((a,b)=>b.score-a.score).map((t,i)=>teamCard(t,i)).join('')
  + blockH('Corretores que precisam da sua atenção','Painel de decisão — onde o Broker deve agir primeiro',badgeTeste)
  + '<div class="grid2">'+Object.values(TEAM).slice().sort((a,b)=>flagOrder[a.flag]-flagOrder[b.flag]).map(t=>{ const dc={red:'#DC2626',yellow:'#F59E0B',green:'#16A34A'}[t.flag]; const lb={red:'Precisa de ação',yellow:'Atenção',green:'No caminho certo'}[t.flag]; return '<div class="card" style="padding:18px;border-left:3px solid '+dc+'"><div class="fx ac g3"><span style="width:12px;height:12px;border-radius:50%;background:'+dc+';box-shadow:0 0 0 4px '+dc+'22"></span>'+avatar(t.nome,36,t.cor)+'<div class="grow mw0"><div class="fz14 fw7 t900 trunc">'+esc(t.nome)+'</div><div class="fz12 fw6" style="color:'+dc+'">'+lb+'</div></div></div><div class="fz13 t700" style="margin-top:12px;line-height:1.5">'+t.attTxt+'</div>'+(t.attRec?'<div class="fx as g2 fz12 t500" style="margin-top:8px">'+icon('lightbulb',14,'c-war')+'<span>Recomendação: '+t.attRec+'</span></div>':'')+'<button class="btn btn-outline sm" style="width:100%;margin-top:14px" data-corr="'+t.id+'">Abrir perfil</button></div>'; }).join('')+'</div>'
  + blockH('SMART IA','Insights inteligentes da operação',badgeTeste)
  + '<div class="grid2">'+ia.map(x=>'<div class="card" style="padding:18px;background:linear-gradient(180deg,var(--aibg),#fff);border-color:#EBD9FF"><div class="fx ac g2" style="margin-bottom:8px">'+iconChip('sparkles','ai',32)+'<div class="fz11 up fw7 c-ai">SMART IA · '+x.tag+'</div></div><div class="fz14 t800 fw5" style="line-height:1.5">'+x.txt+'</div>'+(x.sug?'<div class="fx ac g2 fz13 fw6 t900" style="margin-top:10px;padding-top:10px;border-top:1px solid #EBD9FF">'+icon(x.ic,15,'c-ai')+x.sug+'</div>':'')+'</div>').join('')+'</div>';
};

function openCorretor(id){ openDrawer(corretorDrawer(id)); }
function corretorDrawer(id){
  const c=cstat(id); const mx=Math.max.apply(null,c.mensal);
  const chart='<div class="fx g1" style="height:120px;align-items:flex-end">'+c.mensal.map((v,i)=>'<div class="grow" style="text-align:center"><div style="height:'+Math.round(v/mx*96)+'px;border-radius:4px 4px 0 0;background:'+(i===6?c.cor:'#C9D2E3')+'"></div><div class="fz11" style="margin-top:4px;color:'+(i===6?'var(--ink900)':'var(--ink400)')+';font-weight:'+(i===6?'700':'400')+'">'+MESES[i]+'</div></div>').join('')+'</div>';
  const stat=(l,v)=>'<div class="card" style="padding:12px 14px"><div class="fz11 t500">'+l+'</div><div class="fz15 fw7 t900" style="margin-top:2px">'+v+'</div></div>';
  const sc=scoreColor(c.score);
  return drawerHead(c.nome,c.cargo+' · REMAX SMART')
   + '<div class="grow scrolly" style="overflow:auto;padding:18px 20px">'
   + '<div class="fx ac g2" style="margin-bottom:14px">'+badgeTeste+'<span class="fz11 t500">Métricas de performance ainda são demonstração.</span></div>'
   + '<div class="fx ac g3" style="margin-bottom:16px">'+avatar(c.nome,56,c.cor)+'<div class="grow mw0"><div class="fx ac g2 fz13 t500">'+icon('phone',14,'t400')+c.tel+'</div></div><div class="tright nsh"><div class="fz11 t500">Smart Score</div><div class="fz22 fw7" style="color:'+sc+'">'+c.score+'</div></div></div>'
   + '<div class="gd" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">'+stat('Captações',c.cap)+stat('Vendas',c.vendas)+stat('Locações',c.loc)+stat('Ativos',c.ativos)+stat('Encerrados',c.encerrados)+stat('Conversão',c.conversao+'%')+stat('VGV',brl(c.vgv))+stat('Ticket médio',brl(c.ticket))+stat('T. resposta',c.tempoResp)+'</div>'
   + '<div class="card" style="padding:14px 16px;margin-bottom:16px"><div class="fx jb wrap g2"><div><div class="fz11 t500">Comissão prevista</div><div class="fz15 fw7 mono t900">'+brlFull(c.comPrev)+'</div></div><div class="tright"><div class="fz11 t500">Recebida / Pendente</div><div class="fz13 fw6"><span class="c-suc">'+brl(c.comReceb)+'</span> / <span class="c-war">'+brl(c.comPend)+'</span></div></div></div></div>'
   + '<div class="fz12 up fw7 t500" style="margin-bottom:10px">Produção mensal (comissão)</div>'+chart
   + '</div>'
   + '<div class="fx g2" style="padding:14px 20px;border-top:1px solid var(--ink100)"><button class="btn btn-outline sm grow" data-action="close-drawer">Fechar</button></div>';
}

/* ---------------- NEGÓCIOS ---------------- */
function filteredDeals(){ const q=(state.negBusca||'').toLowerCase().trim(); return DEALS.filter(d=>{ if(state.negFiltroTipo!=='Todos'&&d.tipo!==state.negFiltroTipo)return false; if(state.negFiltroStatus!=='Todos'&&d.status!==state.negFiltroStatus)return false; if(q){ const im=propDoDeal(d); const s=(d.code+' '+im.rua+' '+d.clienteNome+' '+corrNome(d.corretor)).toLowerCase(); if(s.indexOf(q)<0)return false; } return true; }); }
function allStatusReais(){ return [...new Set(DEALS.map(d=>d.status))]; }
function corrNome(uid){ return CORRETORES[uid]?CORRETORES[uid].nome:'—'; }
function corrFoto(uid){ return CORRETORES[uid]?CORRETORES[uid].foto:''; }
function negRows(){
  const list=filteredDeals();
  if(!list.length) return '<tr><td colspan="7"><div class="tcenter t500" style="padding:44px 0"><div class="t400">'+icon('search-x',26)+'</div><p style="margin-top:10px" class="fz14 fw5">Nenhum negócio encontrado para este filtro.</p></div></td></tr>';
  return list.map(d=>{ const im=propDoDeal(d); return '<tr data-deal="'+d.id+'"><td class="mono fz13 t900 fw6">'+esc(d.code)+'</td><td><div class="fw6 t900">'+esc(im.rua)+'</div><div class="fz12 t500">'+esc(im.bairro||d.cidade)+'</div></td><td><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'">'+d.tipo+'</span></td><td class="t700">'+esc(d.clienteNome)+'</td><td><div class="fx ac g2">'+avatar(corrNome(d.corretor),24,'var(--ink800)',corrFoto(d.corretor))+'<span class="fz13 t700">'+esc(corrNome(d.corretor))+'</span></div></td><td>'+statusPill(d.status)+'</td><td class="tright mono fw6 t900">'+brl(d.comValor)+'</td></tr>'; }).join('');
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
  + '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:820px"><thead><tr><th>Código</th><th>Imóvel</th><th>Tipo</th><th>Cliente</th><th>Corretor</th><th>Status</th><th class="tright">Comissão</th></tr></thead><tbody id="negTbody">'+negRows()+'</tbody></table></div></div>';
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
  + '<div class="card" style="padding:22px 24px;margin-bottom:16px"><div class="fx ac jb"><div class="up fz13 fw7 t800">Etapas do processo</div><div class="fz12 t500">Próxima: <strong class="t900">'+esc(d.prox)+'</strong></div></div><div style="margin-top:18px">'+renderStepper(d)+'</div></div>'
  + '<div class="split-r">'
    + '<div class="fx col g4">'
      + '<div class="card" style="padding:18px"><div class="up fz12 fw7 t800" style="margin-bottom:12px">Cliente</div><div class="fx ac g3">'+avatar(d.clienteNome,40,'var(--ink800)')+'<div class="mw0"><div class="fz14 fw6 t900 trunc">'+esc(d.clienteNome)+'</div><div class="fz12 t500">'+esc(d.clienteContato||'—')+'</div></div></div></div>'
      + '<div class="card" style="padding:18px"><div class="up fz12 fw7 t800" style="margin-bottom:14px">Financeiro</div><div class="fx col g3 fz13">'+[['Valor',brlFull(d.valor)],['Comissão ('+d.comPct+'%)',brlFull(d.comValor)],['Progresso',d.progresso+'%'],['Clicksign',d.clicksign]].map(r=>'<div class="fx jb ac"><span class="t500">'+r[0]+'</span><span class="fw6 t900 mono">'+r[1]+'</span></div>').join('')+'</div></div>'
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

/* ---------------- PESSOAS ---------------- */
const PTIPOS=['Todos','Proprietário','Comprador','Locatário','Fiador'];
function filteredPeople(){ const q=(state.pessoasBusca||'').toLowerCase().trim(); return PEOPLE.filter(p=>{ if(state.pessoasFiltro!=='Todos'&&!p.tipos.includes(state.pessoasFiltro))return false; if(q&&(p.nome+' '+p.email+' '+p.cpf).toLowerCase().indexOf(q)<0)return false; return true; }); }
function tipoColor(t){ return t==='Proprietário'?'info':t==='Comprador'?'success':t==='Locatário'?'ai':'warning'; }
function pessoasList(){
  const list=filteredPeople();
  if(!list.length) return vazio('user-x','Nenhuma pessoa encontrada. (As pessoas vêm das fichas e dos interessados dos imóveis.)');
  if(state.pessoasView==='cards'){
    return '<div class="gd" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">'+list.map(p=>{ const negs=DEALS.filter(d=>d.clienteNome===p.nome).length; return '<button class="card card-hover" data-person="'+p.id+'" style="text-align:left;padding:16px"><div class="fx ac g3">'+avatar(p.nome,44,'var(--ink800)')+'<div class="mw0"><div class="fz14 fw6 t900 trunc">'+esc(p.nome)+'</div><div style="margin-top:4px">'+p.tipos.map(t=>pill(t,tipoColor(t))).join(' ')+'</div></div></div><div class="fx col g2" style="margin-top:14px"><div class="fx ac g2 fz12 t500">'+icon('mail',13,'t400')+'<span class="trunc">'+esc(p.email)+'</span></div><div class="fx ac g2 fz12 t500">'+icon('phone',13,'t400')+esc(p.tel)+'</div></div></button>'; }).join('')+'</div>';
  }
  return '<div class="card" style="overflow:hidden"><div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:720px"><thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th>CPF</th></tr></thead><tbody>'+list.map(p=>'<tr data-person="'+p.id+'"><td><div class="fx ac g2">'+avatar(p.nome,30,'var(--ink800)')+'<span class="fw6 t900">'+esc(p.nome)+'</span></div></td><td>'+p.tipos.map(t=>pill(t,tipoColor(t))).join(' ')+'</td><td class="t700">'+esc(p.email)+'<div class="fz12 t500">'+esc(p.tel)+'</div></td><td class="mono fz13 t700">'+esc(p.cpf)+'</td></tr>').join('')+'</tbody></table></div></div>';
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
  return drawerHead(p.nome, p.tipos.join(' · '))
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
    return '<div class="gd" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">'+list.map((p,i)=>'<button class="card card-hover" data-prop="'+p.id+'" style="overflow:hidden;text-align:left;padding:0"><div style="height:148px;background:'+GRAD[i%GRAD.length]+';position:relative"><span class="pill" style="position:absolute;top:10px;left:10px;background:rgba(255,255,255,.92);color:var(--ink900)">'+p.finalidade+'</span>'+(p.fotos?'<span style="position:absolute;top:10px;right:10px"><span class="pill" style="background:rgba(0,0,0,.35);color:#fff">'+icon("image",12)+p.fotos+'</span></span>':'')+'<span class="mono" style="position:absolute;bottom:10px;left:12px;color:#fff;font-weight:700;font-size:17px;text-shadow:0 1px 4px rgba(0,0,0,.3)">'+(p.preco?brlFull(p.preco)+(p.finalidadeRaw==='locacao'?'<span style="font-size:12px;font-weight:500">/mês</span>':''):'Sem valor')+'</span></div><div style="padding:14px"><div class="fz14 fw6 t900 trunc">'+esc(p.rua)+'</div><div class="fz12 t500">'+esc(p.bairro)+' · '+esc(p.tipo)+'</div><div class="fx ac g3 fz12 t500" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--ink100)">'+statusPill(p.status)+'<span class="mono t400" style="margin-left:auto">'+esc(p.code)+'</span></div></div></button>').join('')+'</div>';
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
function propDrawer(id){
  const p=prop(id); const tab=state.imovelTab||'dados'; const negs=DEALS.filter(d=>d.imovelId===id); const gi=PROPERTIES.indexOf(PROPERTIES.find(x=>x.id===id));
  const tabs=[['dados','Dados'],['interessados','Interessados'],['vinc','Negócios']];
  let body='';
  if(tab==='dados'){ body='<div>'+kv('Finalidade',p.finalidade)+kv('Tipo',esc(p.tipo))+kv('Valor','<span class="mono">'+(p.preco?brlFull(p.preco):'—')+(p.finalidadeRaw==='locacao'?'/mês':'')+'</span>')+kv('Situação',p.status)+kv('Bairro',esc(p.bairro))+kv('Cidade',esc(p.cidade))+'</div><div class="card" style="margin-top:14px;padding:12px 14px;background:var(--ink50);border-color:var(--ink200)"><div class="fz11 t500">Proprietário</div><div class="fz14 fw6 t900">'+esc(p.proprietarioNome)+'</div>'+(p.proprietarioContato?'<div class="fz12 t500">'+esc(p.proprietarioContato)+'</div>':'')+'</div>'; }
  else if(tab==='interessados'){ const its=p.interessados||[]; body=its.length?its.map(it=>'<div class="fx ac g3" style="padding:11px 12px;border:1px solid var(--ink200);border-radius:10px;margin-bottom:8px">'+avatar(it.nome,34,'var(--ink800)')+'<div class="grow mw0"><div class="fz13 fw6 t900 trunc">'+esc(it.nome||'—')+'</div><div class="fz11 t500">'+esc(it.contato||'')+'</div></div>'+pill((it.status||'').replace(/_/g,' '),'neutral')+'</div>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Nenhum interessado neste imóvel.</div>'; }
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
  const perc=uids.map(uid=>{ const ds=DEALS.filter(d=>d.corretor===uid); return {uid, nome:corrNome(uid), foto:corrFoto(uid), cor:(CORRETORES[uid]&&CORRETORES[uid].cor)||'#2563EB', vendas:ds.filter(d=>d.tipo==='Venda').length, loc:ds.filter(d=>d.tipo==='Locação').length, com:ds.reduce((s,d)=>s+d.comValor,0), vgv:ds.filter(d=>d.tipo==='Venda').reduce((s,d)=>s+d.valor,0)}; }).sort((a,b)=>b.com-a.com);
  const maxCom=Math.max(1,...perc.map(p=>p.com));
  const funil=[['Negócios ativos',DEALS.length,'#2563EB'],['Em andamento',DEALS.filter(d=>['em_andamento','aguardando_corretor','aguardando_broker','aguardando_administrativo','negocio_criado'].includes(d.statusRaw)).length,'#7C3AED'],['Entregues',DEALS.filter(d=>d.statusRaw==='entregue_gestao').length,'#F59E0B'],['Concluídos',KPI.encerradosMes,'#16A34A']];
  const maxF=Math.max(1,...funil.map(f=>f[1]));
  function relKpi(label,val,sub,cor){ return '<div class="card" style="padding:18px"><div class="fz13 fw5 t500">'+label+'</div><div class="mono" style="margin-top:8px;font-size:24px;font-weight:700;color:'+(cor||'var(--ink900)')+'">'+val+'</div><div class="fz12 t500" style="margin-top:4px">'+sub+'</div></div>'; }
  const nomes=['Todos'].concat(perc.map(p=>p.nome));
  const sel=(id,opts,val)=>'<select class="input" data-action="'+id+'" style="width:auto;background-color:var(--raised);border-color:var(--bd);color:#fff">'+opts.map(o=>'<option'+(o===val?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
  host.innerHTML=pageHead(hTitulo('Relatórios'),'Visão executiva da operação — comissões, produção e funil.', sel('relcorr',nomes,corr)+'<button class="btn btn-outline" data-action="export-rel">'+icon('download',16)+'Exportar</button>')
  + '<div class="grid4" style="margin-bottom:16px">'+relKpi('Comissão prevista',brl(KPI.comissaoPrevista),'Pipeline total','var(--ink900)')+relKpi('Comissão recebida',brl(KPI.comissaoRecebida),'Concluídos','var(--successtx)')+relKpi('Comissão pendente',brl(KPI.comissaoPendente),'A receber','var(--warningtx)')+relKpi('Negócios encerrados',KPI.encerradosMes,'No período','var(--ink900)')+'</div>'
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

/* ============================ EVENTOS (escopados no #bkRoot) ============================ */
function wireEvents(root){
  root.addEventListener('click', e=>{
    // Clicar no backdrop fecha drawer/modal/gaveta. Delegado no `root` (persistente)
    // — o #overlay é recriado a cada mount, então um listener direto nele vazaria.
    if(e.target.id==='overlay'){ closeDrawer(); closeModal(); closeMobileNav(); return; }
    const nav=e.target.closest('[data-nav]'); if(nav){ navigate(nav.dataset.nav); return; }
    const ops=e.target.closest('[data-ops]'); if(ops){ navigate('negocios'); return; }
    const cr=e.target.closest('[data-corr]'); if(cr){ openCorretor(cr.dataset.corr); return; }
    const chk=e.target.closest('[data-chk]'); if(chk){ negAtualizar({negocioId:state.currentDeal, acao:'checklist', key:chk.dataset.chk, feito:chk.dataset.feito==='1'}); return; }
    const deal=e.target.closest('[data-deal]'); if(deal){ openDeal(deal.dataset.deal); return; }
    const pers=e.target.closest('[data-person]'); if(pers){ openPerson(pers.dataset.person); return; }
    const pr=e.target.closest('[data-prop]'); if(pr){ openProp(pr.dataset.prop); return; }
    const act=e.target.closest('[data-action]'); if(act){ handleAction(act.dataset.action, act); return; }
  });
  root.addEventListener('input', e=>{ const t=e.target.closest('[data-input]'); if(!t) return; const k=t.dataset.input; if(k==='negBusca'){ state.negBusca=t.value; updateNegTable(); } else if(k==='pessoasBusca'){ state.pessoasBusca=t.value; updatePessoas(); } else if(k==='imoveisBusca'){ state.imoveisBusca=t.value; updateImoveis(); } });
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
    {id:'relatorios',ico:'clipboard-list',label:'Relatórios Operacionais'},
    {id:'perfil',ico:'user',label:'Meu Perfil'},
  ],
};
renderNav = function(target){ if(!target) return; const items=NAV_ROLE[state.role]||NAV_ROLE.broker; target.innerHTML=items.map(n=>'<button class="navitem'+(state.view===n.id?' active':'')+'" data-nav="'+n.id+'">'+icon(n.ico,18)+n.label+'</button>').join(''); };
Object.assign(CRUMB, {
  clientes:['SMART HUB','Meus Clientes'], comissoes:['SMART HUB','Minhas Comissões'], perfil:['SMART HUB','Meu Perfil'],
  fila:['SMART HUB','Fila de Trabalho'], documentos:['SMART HUB','Documentos'],
});

// Título por papel/tela (Meus Imóveis, Meus Negócios, Meus Clientes, Relatórios Operacionais).
function hTitulo(base){
  const r=state.role, v=state.view;
  if(r==='corretor'){ if(v==='imoveis') return 'Meus Imóveis'; if(v==='negocios') return 'Meus Negócios'; if(v==='pessoas'||v==='clientes') return 'Meus Clientes'; }
  if(r==='administrativo' && v==='relatorios') return 'Relatórios Operacionais';
  return base;
}

// Clientes (corretor) reaproveita a tela Pessoas (backend já devolve só os dele).
RENDERERS.clientes = function(host){ RENDERERS.pessoas(host); };

/* ---------------- DASHBOARD por papel ---------------- */
const _dashBroker = RENDERERS.dashboard;
RENDERERS.dashboard = function(host){
  if(state.role==='corretor') return renderDashCorretor(host);
  if(state.role==='administrativo') return renderDashAdmin(host);
  return _dashBroker(host);
};

const FICHA_HOST = 'https://remax-smart-hub.web.app';
const FICHAS_CORRETOR = [
  ['ficha-locador.html','Locador','house','info'],
  ['ficha-vendedor.html','Vendedor','key-round','success'],
  ['ficha-pf.html','Pessoa Física','user','ai'],
  ['ficha-pj.html','Pessoa Jurídica','building-2','brand'],
  ['ficha-locacao-fiador.html','Locação c/ Fiador','shield','warning'],
  ['ficha-proposta.html','Proposta','file-signature','danger'],
];
function fichaLink(arquivo){ const uid=(auth.currentUser&&auth.currentUser.uid)||''; return FICHA_HOST+'/'+arquivo+'?corretor='+encodeURIComponent(uid)+'&nome='+encodeURIComponent(state.meuNome||''); }

function renderDashCorretor(host){
  const primeiro=(state.meuNome||'Corretor').split(' ')[0];
  const ativos=DEALS.length;
  const propostas=DEALS.filter(d=>['negocio_criado','em_andamento'].includes(d.statusRaw)).length;
  const captacoes=PROPERTIES.length;
  const comPrev=DEALS.reduce((s,d)=>s+Math.round((d.comValor||0)*0.5),0);
  const comReceb=DEALS.filter(d=>d.statusRaw==='concluido').reduce((s,d)=>s+Math.round((d.comValor||0)*0.5),0);
  const acoes=DEALS.slice().sort((a,b)=>b.diasParado-a.diasParado).slice(0,6);
  const kcard=(ico,variant,label,valor,sub,view)=>'<button class="card card-hover" style="padding:18px;text-align:left" data-nav="'+view+'"><div class="fx as jb g3"><div class="mw0"><div class="fz13 fw5 t500">'+label+'</div><div style="margin-top:8px;font-size:24px;line-height:1;font-weight:700;letter-spacing:-.02em;color:var(--ink900)" class="'+(String(valor).indexOf("R$")===0?"mono":"")+'">'+valor+'</div></div>'+iconChip(ico,variant,40)+'</div>'+(sub?'<div class="fz12 fw6 '+sub[1]+'" style="margin-top:10px">'+sub[0]+'</div>':'')+'</button>';
  const blockH=(t,sub,badge)=>'<div style="margin:26px 0 14px"><div class="fx ac g2"><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff">'+t+'</h2>'+(badge||'')+'</div>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div>';
  const iaB=['Mantenha o follow-up dos clientes sem contato há mais de 7 dias.','Priorize os negócios parados há mais tempo (lista abaixo).','Envie a ficha certa pelo card ao lado pra iniciar um novo atendimento.'];
  host.innerHTML=
    '<div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">Olá, '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Seu centro de trabalho — seus números, suas ações e suas fichas à mão.</p></div>'
  + '<div class="grid3" style="margin-top:20px">'
    + kcard('handshake','info','Meus negócios ativos',ativos,['Em andamento','c-inf'],'negocios')
    + kcard('house','brand','Minhas captações',captacoes,['Imóveis na carteira','c-suc'],'imoveis')
    + kcard('file-signature','warning','Propostas em andamento',propostas,['Em negociação','c-war'],'negocios')
    + kcard('wallet','success','Comissão prevista',brl(comPrev),['Repasse estimado (50%)','c-suc'],'comissoes')
    + kcard('badge-dollar-sign','success','Comissão recebida',brl(comReceb),['Negócios concluídos','c-suc'],'comissoes')
    + kcard('users','ai','Meus clientes',PEOPLE.length||DEALS.length,['Vinculados a você','c-ai'],'clientes')
  + '</div>'
  + blockH('Fichas digitais','Envie a ficha cadastral e inicie o atendimento — link já sai com seu nome')
  + '<div class="card" style="overflow:hidden"><div style="padding:8px">'+FICHAS_CORRETOR.map(f=>'<div class="fx ac g3 hoverbg" style="padding:11px 12px;border-radius:10px">'+iconChip(f[2],f[3],38)+'<div class="grow mw0"><div class="fz14 fw6 t900">'+f[1]+'</div><div class="fz12 t500">Ficha digital · link personalizado</div></div><div class="fx g1 nsh">'+[['ficha-copy','copy','Copiar link'],['ficha-whats','message-circle','WhatsApp'],['ficha-view','eye','Visualizar']].map(a=>'<button class="iconbtn" title="'+a[2]+'" style="background:var(--ink50);border-color:var(--ink200);color:var(--ink600);width:34px;height:34px" data-action="'+a[0]+'" data-arq="'+f[0]+'" data-nome="'+esc(f[1])+'">'+icon(a[1],15)+'</button>').join('')+'</div></div>').join('')+'</div></div>'
  + blockH('Precisa da sua atenção','Seus negócios ordenados por tempo parado')
  + '<div class="card" style="overflow:hidden"><div style="padding:8px">'+(acoes.length?acoes.map(d=>'<button class="fx ac g3 hoverbg" data-deal="'+d.id+'" style="width:100%;text-align:left;background:none;border:none;padding:12px;border-radius:10px;cursor:pointer"><span style="width:10px;height:10px;border-radius:50%;background:'+(d.diasParado>7?'var(--danger)':'var(--warning)')+';flex-shrink:0"></span><div class="grow mw0"><div class="fz14 fw6 t900 trunc">'+esc(d.prox)+'</div><div class="fz12 t500 trunc">'+esc(d.code)+' · '+esc(propDoDeal(d).rua)+'</div></div><div class="fx ac g2 nsh">'+statusPill(d.status)+'<span class="fz12 t500 mono">'+d.diasParado+'d</span></div></button>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem negócios ativos ainda.</div>')+'</div></div>'
  + blockH('SMART IA','Recomendações do seu dia',badgeTeste)
  + '<div class="card" style="padding:18px;background:linear-gradient(180deg,var(--aibg),#fff);border-color:#EBD9FF"><div class="fx ac g2" style="margin-bottom:12px">'+iconChip('sparkles','ai',34)+'<div class="fz13 up fw7 c-ai">SMART IA</div></div><div class="fx col g2">'+iaB.map(b=>'<div class="fx as g2 fz14 t800" style="line-height:1.5">'+icon('chevron-right',15,'c-ai')+'<span>'+b+'</span></div>').join('')+'</div></div>';
}

function renderDashAdmin(host){
  const primeiro=(state.meuNome||'Administrativo').split(' ')[0];
  const cnt=raw=>DEALS.filter(d=>d.statusRaw===raw).length;
  const emAndamento=DEALS.filter(d=>['negocio_criado','em_andamento','aguardando_corretor','aguardando_administrativo','aguardando_broker'].includes(d.statusRaw)).length;
  const aguardBroker=cnt('aguardando_broker'), aguardAdm=cnt('aguardando_administrativo');
  const docsPend=DEALS.filter(d=>(d.checklist||[]).some(x=>x.obrigatoria&&!x.feito)).length;
  const entregues=cnt('entregue_gestao');
  const ops=(ico,variant,label,qty,view)=>'<button class="card card-hover" style="padding:16px;text-align:left" data-nav="'+view+'"><div class="fx as jb g2">'+iconChip(ico,variant,38)+icon('chevron-right',16,'t400')+'</div><div style="margin-top:12px;font-size:26px;font-weight:700;color:var(--ink900)">'+qty+'</div><div class="fz13 fw5 t600" style="margin-top:2px">'+label+'</div></button>';
  const blockH=(t,sub)=>'<div style="margin:26px 0 14px"><h2 style="margin:0;font-size:17px;font-weight:700;color:#fff">'+t+'</h2>'+(sub?'<p style="margin:3px 0 0;font-size:13px;color:var(--ondarkmuted)">'+sub+'</p>':'')+'</div>';
  host.innerHTML=
    '<div><h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fff">Olá, '+esc(primeiro)+'</h1><p style="margin:6px 0 0;font-size:15px;color:var(--ondarkmuted)">Central operacional — processe negócios, documentos e contratos da imobiliária.</p></div>'
  + '<div class="grid4" style="margin-top:20px">'
    + ops('kanban','info','Em andamento',emAndamento,'fila')
    + ops('user-check','warning','Aguardando administrativo',aguardAdm,'fila')
    + ops('gavel','warning','Aguardando broker',aguardBroker,'fila')
    + ops('folder-clock','danger','Documentos pendentes',docsPend,'negocios')
  + '</div>'
  + blockH('Fila de trabalho','Resumo por etapa — abra a fila pra processar')
  + '<div class="grid4">'+[['negocio_criado','Novos','info'],['em_andamento','Em andamento','info'],['aguardando_administrativo','Comigo','warning'],['entregue_gestao','Entregues','success']].map(s=>'<button class="card card-hover" style="padding:18px;text-align:left" data-nav="fila"><div class="fz13 fw5 t500">'+s[1]+'</div><div style="margin-top:8px;font-size:26px;font-weight:700;color:var(--'+s[2]+'tx)">'+cnt(s[0])+'</div></button>').join('')+'</div>'
  + blockH('Atividades recentes','Últimas movimentações dos negócios')
  + '<div class="card" style="overflow:hidden"><div style="padding:16px">'+(ACTIVITY.length?ACTIVITY.map((a,i)=>'<div class="fx g3"><div class="fx col ac">'+iconChip('circle-dot','info',32)+(i<ACTIVITY.length-1?'<span class="timeline-line"></span>':'')+'</div><div style="padding-bottom:16px" class="mw0 grow"><div class="fz13 fw6 t900">'+esc(a.txt)+'</div><div class="fz12 t500 trunc">'+esc(a.sub)+'</div><div class="fz11 t400 mono" style="margin-top:2px">'+esc(a.quando)+'</div></div></div>').join(''):'<div class="tcenter t500 fz13" style="padding:24px">Sem atividades recentes.</div>')+'</div></div>';
}

/* ---------------- FILA DE TRABALHO (kanban real — administrativo) ---------------- */
RENDERERS.fila = function(host){
  const COLS=[['Novos',['negocio_criado']],['Em andamento',['em_andamento','aguardando_corretor']],['Aguardando',['aguardando_administrativo','aguardando_broker']],['Entregues',['entregue_gestao','concluido']]];
  const q=(state.filaBusca||'').toLowerCase().trim();
  const inQ=d=>!q||(d.code+' '+propDoDeal(d).rua+' '+d.clienteNome).toLowerCase().indexOf(q)>=0;
  host.innerHTML=pageHead('Fila de Trabalho','Todos os negócios por etapa — clique num cartão pra abrir.','<div class="fx ac g2" style="height:40px;padding:0 12px;background:var(--raised);border:1px solid var(--bd);border-radius:8px;width:min(280px,50vw)">'+icon('search',16,'tmut')+'<input data-input="filaBusca" value="'+esc(state.filaBusca||'')+'" placeholder="Buscar…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:13px;font-family:var(--sans)"></div>')
  + '<div style="overflow-x:auto" class="scrolly"><div id="filaBoard" class="gd" style="grid-template-columns:repeat('+COLS.length+',minmax(240px,1fr));gap:14px;align-items:start;min-width:760px">'+COLS.map(c=>{ const list=DEALS.filter(d=>c[1].includes(d.statusRaw)&&inQ(d)); return '<div class="card" style="padding:0;overflow:hidden"><div class="fx ac jb" style="padding:12px 14px;border-bottom:1px solid var(--ink100)"><span class="fz12 up fw7 t700">'+c[0]+'</span><span class="pill neutral">'+list.length+'</span></div><div style="padding:10px;display:flex;flex-direction:column;gap:8px;min-height:60px">'+(list.length?list.map(d=>'<button class="card card-hover" data-deal="'+d.id+'" style="padding:12px;text-align:left"><div class="fx ac jb g2"><span class="mono fz12 fw7 t900">'+esc(d.code)+'</span><span class="pill '+(d.tipo==='Venda'?'info':'ai')+'" style="font-size:10px;padding:1px 7px">'+d.tipo+'</span></div><div class="fz13 fw6 t900 trunc" style="margin-top:6px">'+esc(propDoDeal(d).rua)+'</div><div class="fz12 t500 trunc">'+esc(d.clienteNome)+'</div><div class="fx ac jb g2" style="margin-top:8px"><span class="fz11 t400 mono">'+d.diasParado+'d parado</span>'+avatar(corrNome(d.corretor),22,'var(--ink800)',corrFoto(d.corretor))+'</div></button>').join(''):'<div class="tcenter t400 fz12" style="padding:16px 0">—</div>')+'</div></div>'; }).join('')+'</div></div>';
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
  host.innerHTML=pageHead('Minhas Comissões','Sua comissão (repasse estimado de 50%) por negócio. Valores estimados até a baixa financeira.','')
  + '<div class="grid3" style="margin-bottom:16px">'+card('Prevista',prevista,'wallet','info')+card('Recebida',recebida,'badge-dollar-sign','success','var(--successtx)')+card('Pendente',pendente,'hand-coins','warning','var(--warningtx)')+'</div>'
  + '<div class="card" style="overflow:hidden">'+cardHead('Comissões por negócio')+'<div style="overflow-x:auto" class="scrolly"><table class="tbl" style="min-width:520px"><thead><tr><th>Negócio</th><th>Cliente</th><th>Status</th><th class="tright">Repasse</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr style="cursor:default"><td class="mono fz13 fw6 t900">'+esc(r.code)+'</td><td class="t700">'+esc(r.cli)+'</td><td>'+pill(r.st,r.st==='Recebida'?'success':'info')+'</td><td class="tright mono fw6 t900">'+brlFull(r.val)+'</td></tr>').join(''):'<tr><td colspan="4" class="tcenter t500" style="padding:24px">Sem negócios ainda.</td></tr>')+'</tbody></table></div></div>';
};

/* ---------------- MEU PERFIL (real — getMeuPerfil/salvarMeuPerfil) ---------------- */
RENDERERS.perfil = function(host){
  host.innerHTML=pageHead('Meu Perfil','Seus dados de contato. Usados nos links de ficha e no contrato de representação.','')
  + '<div id="perfilBox"><div class="tcenter t500" style="padding:60px 0">'+icon('loader-2',28,'spin')+'</div></div>';
  refreshIcons();
  fnGetPerfil({}).then(r=>{ state.perfilCache=r.data||{}; pintarPerfil(); }).catch(()=>{ const b=$('#perfilBox'); if(b) b.innerHTML='<div class="card" style="padding:24px" class="t500">Não consegui carregar o perfil.</div>'; });
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

/* ---------------- Placeholders MODO DE TESTE (Documentos) ---------------- */
function placeholderTela(host, titulo, desc, ico, txt){
  host.innerHTML=pageHead(titulo,desc,'')
  + '<div class="card" style="padding:48px 24px;text-align:center">'+iconChip(ico,'brand',52)+'<div class="fz16 fw7 t900" style="margin-top:14px">'+titulo+' '+badgeTeste+'</div><p class="fz14 t500" style="max-width:520px;margin:10px auto 0;line-height:1.55">'+txt+'</p></div>';
}
RENDERERS.documentos = function(host){ placeholderTela(host,'Documentos','Central de documentos dos negócios.','folder','Em construção. A central de documentos vai reunir aqui os anexos das fichas e os contratos de cada negócio (hoje eles vivem no negócio e no Google Drive). Enquanto isso, use a aba Negócios.'); };

/* Ações extras de fichas (corretor) e salvar perfil — estende o handleAction. */
const _handleAction = handleAction;
handleAction = function(a, el){
  if(a==='ficha-copy'){ const l=fichaLink(el.dataset.arq); try{ navigator.clipboard.writeText(l); }catch(e){} toast('Link da ficha '+(el.dataset.nome||'')+' copiado','copy'); return; }
  if(a==='ficha-whats'){ const l=fichaLink(el.dataset.arq); window.open('https://wa.me/?text='+encodeURIComponent('Olá! Segue o link da ficha cadastral. Ao concluir, me avise pra dar continuidade.\n\n'+l),'_blank'); return; }
  if(a==='ficha-view'){ window.open(fichaLink(el.dataset.arq),'_blank'); return; }
  if(a==='salvar-perfil'){
    const payload={ telefone:($('#pfTel')||{}).value||'', creci:($('#pfCreci')||{}).value||'', cpf:($('#pfCpf')||{}).value||'' };
    toast('Salvando…','loader-2','var(--brand)');
    fnSalvarPerfil(payload).then(()=>{ if(state.perfilCache) Object.assign(state.perfilCache,payload); toast('Perfil salvo'); }).catch(e=>toast(e.message||'Erro','alert-triangle','var(--danger)'));
    return;
  }
  return _handleAction(a, el);
};

/* Busca da Fila de Trabalho — listener próprio no #bkRoot (o de wireEvents não cobre filaBusca). */
(function(){ const r=ROOT(); if(r) r.addEventListener('input', e=>{ const t=e.target.closest('[data-input="filaBusca"]'); if(t){ state.filaBusca=t.value; updateFila(); } }); })();
