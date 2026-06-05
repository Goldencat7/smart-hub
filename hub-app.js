// Lógica da tela principal do Hub:
// - Sidebar com categorias + busca por categoria
// - Verifica auth, busca credenciais via Cloud Function ao clicar
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8",
  authDomain: "remax-smart-hub.firebaseapp.com",
  projectId: "remax-smart-hub",
  storageBucket: "remax-smart-hub.firebasestorage.app",
  messagingSenderId: "474454438949",
  appId: "1:474454438949:web:ba1e10e6b343af0408fbcc"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fns  = getFunctions(app, 'southamerica-east1');

const getCredentials = httpsCallable(fns, 'getCredentials');
const bootstrapAdmin = httpsCallable(fns, 'bootstrapAdmin');
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const registrarAcesso = httpsCallable(fns, 'registrarAcesso');
const getMeuPerfil = httpsCallable(fns, 'getMeuPerfil');
const salvarMeuPerfil = httpsCallable(fns, 'salvarMeuPerfil');
const criarEvento = httpsCallable(fns, 'criarEvento');
const listarEventos = httpsCallable(fns, 'listarEventos');
const excluirEvento = httpsCallable(fns, 'excluirEvento');
const listarPessoas = httpsCallable(fns, 'listarPessoas');
const conectarGoogleAgenda = httpsCallable(fns, 'conectarGoogleAgenda');
const desconectarGoogleAgenda = httpsCallable(fns, 'desconectarGoogleAgenda');
const statusGoogleAgenda = httpsCallable(fns, 'statusGoogleAgenda');
const listarGoogleAgenda = httpsCallable(fns, 'listarGoogleAgenda');
const criarNotificacao = httpsCallable(fns, 'criarNotificacao');
const listarMinhasNotificacoes = httpsCallable(fns, 'listarMinhasNotificacoes');
const marcarNotificacaoLida = httpsCallable(fns, 'marcarNotificacaoLida');

const BOOTSTRAP_ADMIN_UIDS = ['OwcT6wCrXMgJ0tPADMUdKdBB8h32'];

// ─── Catálogo de apps ─────────────────────────────────────────────────────
// Cada app tem categoria + url + se usa autologin
const APPS = [
  {
    key: 'cadastro_imobiliario', categoria: 'captacao',
    titulo: 'Central de Cadastro', icone: 'CC', desc: 'centraldecadastroimobiliario.com',
    url: 'https://centraldecadastroimobiliario.com/login/', autologin: true
  },
  {
    key: 'imovelp', categoria: 'captacao',
    titulo: 'Imóvel do Proprietário', icone: 'IP', desc: 'Gestão de imóveis',
    url: 'https://www.imovelp.com.br/login', autologin: true
  },
  {
    key: 'sp_imovel', categoria: 'captacao',
    titulo: 'SP Imóvel', icone: 'SP', desc: 'Captação SP',
    url: 'https://captacao.spimovel.com.br/', autologin: true
  },
  {
    key: 'forsale', categoria: 'captacao',
    titulo: 'Jr Captações', icone: 'JC', desc: 'Sigavi360',
    url: 'https://jr.sigavi360.com.br/Login.aspx?ReturnUrl=%2f', autologin: true
  },
  {
    key: 'checkvisto', categoria: 'vistoria',
    titulo: 'Smart Vistorias', icone: 'SV', desc: 'Controle de visitas',
    url: 'https://checkvisto-app.web.app', autologin: false
  },
  {
    key: 'alude', categoria: 'locacao',
    titulo: 'Alude', icone: 'AL', desc: 'Análise de crédito',
    url: 'https://app.alude.com.br/', autologin: true
  },
  {
    key: 'clicksign', categoria: 'locacao',
    titulo: 'ClickSign', icone: 'CS', desc: 'Assinatura digital',
    url: 'https://app.clicksign.com/', autologin: true, restrito: true
  },
  {
    key: 'motiva', categoria: 'performance',
    titulo: 'Motiva Smart', icone: 'MS', desc: 'Motivação & metas',
    url: 'https://motivatech-app.web.app', autologin: false
  },
  {
    key: 'universidade', categoria: 'treinamento',
    titulo: 'Universidade RE/MAX', icone: 'UR', desc: 'Treinamento e cursos',
    url: 'https://universidaderemax.studionmx.com/', autologin: false
  },
  {
    key: 'goiconnect', categoria: 'crm',
    titulo: 'IConnect', icone: 'IC', desc: 'goiconnect.com',
    url: 'https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f', autologin: false
  }
];

const CATEGORIAS = [
  { id: 'captacao',    nome: 'Captação',    icone: '🏠' },
  { id: 'crm',         nome: 'CRM',         icone: '📇' },
  { id: 'vistoria',    nome: 'Vistoria',    icone: '🔎' },
  { id: 'locacao',     nome: 'Locação',     icone: '🤝' },
  { id: 'performance', nome: 'Performance', icone: '📊' },
  { id: 'treinamento', nome: 'Treinamento', icone: '🎓' },
  { id: 'agenda',      nome: 'Agenda',      icone: '📅', agenda: true },
  { id: 'documentos',  nome: 'Documentos',  icone: '📄', placeholder: true },
  { id: 'config',      nome: 'Configurações', icone: '⚙️', config: true }
];

// Avatar padrão (quando a pessoa não tem foto)
const AVATAR_PADRAO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1d222d"/><circle cx="60" cy="46" r="22" fill="#6b7280"/><rect x="24" y="74" width="72" height="48" rx="24" fill="#6b7280"/></svg>'
);

let categoriaAtiva = 'captacao';
let termoBusca = '';
let isAdmin = false;
let appsPermitidos = []; // apps restritos liberados pra este usuário

// ─── DOM ─────────────────────────────────────────────────────────────────
const navCategorias  = document.getElementById('navCategorias');
const tituloCategoria = document.getElementById('tituloCategoria');
const inputBusca     = document.getElementById('inputBusca');
const appsGrid       = document.getElementById('appsGrid');
const estadoVazio    = document.getElementById('estadoVazio');
const secaoDocs      = document.getElementById('secaoDocumentos');
const driveFrame     = document.getElementById('driveFrame');
const btnAbrirDrive  = document.getElementById('btnAbrirDrive');
const secaoConfig    = document.getElementById('secaoConfig');

// Pasta de documentos no Google Drive (compartilhada como "qualquer um com link: leitor")
const DRIVE_FOLDER_ID  = '10dlIlDyGyvyMCZQUWbt2_YVDdXgfmlzp';
const DRIVE_EMBED_URL  = `https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#grid`;
const DRIVE_FOLDER_URL = `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`;
const usuarioInfo    = document.getElementById('usuarioInfo');
const topAvatar      = document.getElementById('topAvatar');
const btnAdmin       = document.getElementById('btnAdmin');
const btnAviso       = document.getElementById('btnAviso');
const btnSair        = document.getElementById('btnSair');

// Refs da aba Configurações
const cfgAvatar      = document.getElementById('cfgAvatar');
const cfgTrocarFoto  = document.getElementById('cfgTrocarFoto');
const cfgRemoverFoto = document.getElementById('cfgRemoverFoto');
const cfgFileInput   = document.getElementById('cfgFileInput');
const cfgNome        = document.getElementById('cfgNome');
const cfgEmail       = document.getElementById('cfgEmail');
const cfgSalvar      = document.getElementById('cfgSalvar');
const cfgMsg         = document.getElementById('cfgMsg');

// Refs da Agenda
const secaoAgenda    = document.getElementById('secaoAgenda');
const agendaPanel    = document.getElementById('agendaPanel');
const relogioHora    = document.getElementById('relogioHora');
const relogioData    = document.getElementById('relogioData');
const miniCal        = document.getElementById('miniCal');
const listaProx      = document.getElementById('listaProx');
const calTitulo      = document.getElementById('calTitulo');
const calGrade       = document.getElementById('calGrade');
const calDiaDetalhe  = document.getElementById('calDiaDetalhe');
const modalEvento    = document.getElementById('modalEvento');

let fotoPendente = null; // null = sem mudança; string = nova foto (ou '' = remover)

// Estado da agenda
let eventos = [];                 // {id, titulo, descricao, inicio:Date, todos, souDono}
let calAno, calMes;               // mês exibido no calendário completo
let diaSelecionado = null;        // 'YYYY-MM-DD' no calendário completo
const alertados = new Set();      // ids já alertados (1h antes)
let pessoasCache = null;          // lista de pessoas (admin) pro seletor

// ─── Render sidebar ──────────────────────────────────────────────────────
function renderSidebar() {
  navCategorias.innerHTML = CATEGORIAS.map(c => `
    <button class="nav-item ${c.id === categoriaAtiva ? 'ativo' : ''} ${c.config ? 'nav-item-fim' : ''}" data-cat="${c.id}">
      <span class="nav-icone">${c.icone}</span>
      <span class="nav-label">${c.nome}</span>
    </button>
  `).join('');

  navCategorias.querySelectorAll('.nav-item').forEach(b => {
    b.addEventListener('click', () => {
      categoriaAtiva = b.dataset.cat;
      termoBusca = '';
      inputBusca.value = '';
      renderSidebar();
      renderCentro();
    });
  });
}

// ─── Render central (cards filtrados) ────────────────────────────────────
function renderCentro() {
  const cat = CATEGORIAS.find(c => c.id === categoriaAtiva);
  tituloCategoria.textContent = cat.nome;
  secaoConfig.hidden = true;
  secaoAgenda.hidden = true;
  // Painel direito é redundante na própria aba Agenda → esconde lá (e some os botões de minimizar)
  hubLayout.classList.toggle('na-agenda', !!cat.agenda);
  btnExpandAgenda.hidden = cat.agenda ? true : !hubLayout.classList.contains('agenda-oculta');

  // Aba Agenda (calendário completo)
  if (cat.agenda) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoConfig.hidden = true;
    secaoAgenda.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    renderCalendarioCompleto();
    atualizarStatusGoogle();
    return;
  }

  // Aba Configurações
  if (cat.config) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoConfig.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarPerfil();
    return;
  }

  // Documentos (embed do Google Drive)
  if (cat.placeholder) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    if (driveFrame && !driveFrame.getAttribute('src')) driveFrame.src = DRIVE_EMBED_URL;
    return;
  }
  inputBusca.disabled = false;
  inputBusca.placeholder = `Buscar em ${cat.nome.toLowerCase()}...`;
  secaoDocs.hidden = true;
  appsGrid.hidden = false;

  // Filtra apps da categoria + termo de busca
  const termo = termoBusca.trim().toLowerCase();
  const filtrados = APPS.filter(a =>
    a.categoria === categoriaAtiva &&
    (!a.restrito || isAdmin || appsPermitidos.includes(a.key)) &&
    (!termo || a.titulo.toLowerCase().includes(termo) || a.desc.toLowerCase().includes(termo))
  );

  if (filtrados.length === 0) {
    appsGrid.innerHTML = '';
    estadoVazio.hidden = false;
    return;
  }
  estadoVazio.hidden = true;

  appsGrid.innerHTML = filtrados.map(a => `
    <button class="hub-card" data-app="${a.key}">
      <span class="card-icon">
        <img class="card-icon-img" src="app-icons/${a.key}.png" alt="">
        ${a.icone}
      </span>
      <span class="card-title">${a.titulo}</span>
      <span class="card-desc">${a.desc}</span>
    </button>
  `).join('');

  appsGrid.querySelectorAll('.hub-card').forEach(b => {
    b.addEventListener('click', () => abrirApp(b.dataset.app));
  });
  // Se o ícone de imagem não existir, remove a <img> e ficam as iniciais.
  appsGrid.querySelectorAll('.card-icon-img').forEach(img => {
    img.addEventListener('error', () => img.remove());
  });
}

// ─── Abrir app (com ou sem autologin) ────────────────────────────────────
async function abrirApp(siteKey) {
  const app = APPS.find(a => a.key === siteKey);
  if (!app) return;

  // Registra o acesso (não bloqueia a abertura)
  registrarAcesso({ siteKey, titulo: app.titulo }).catch(() => {});

  // ClickSign: admin entra com o próprio login (sem autologin compartilhado)
  if (siteKey === 'clicksign' && isAdmin) {
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: null });
    return;
  }

  if (!app.autologin) {
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: null });
    return;
  }

  const btn = appsGrid.querySelector(`[data-app="${siteKey}"]`);
  btn?.classList.add('loading');
  try {
    const resp = await getCredentials({ siteKey });
    const { login, password } = resp.data;
    if (!login) {
      alert(`Credenciais não configuradas pra ${app.titulo}. Peça pro admin cadastrar.`);
      return;
    }
    window.hubApi.abrirApp({ siteKey, url: app.url, credenciais: { login, password } });
  } catch (err) {
    console.error(err);
    alert(`Erro ao buscar credenciais: ${err.message}`);
  } finally {
    btn?.classList.remove('loading');
  }
}

// ─── Busca ───────────────────────────────────────────────────────────────
inputBusca.addEventListener('input', (e) => {
  termoBusca = e.target.value;
  renderCentro();
});

// ─── Configurações / Perfil ──────────────────────────────────────────────
function setFoto(dataURL) {
  cfgAvatar.src = dataURL || AVATAR_PADRAO;
  if (dataURL) { topAvatar.src = dataURL; topAvatar.hidden = false; }
  else { topAvatar.hidden = true; }
}

async function carregarPerfil() {
  fotoPendente = null;
  cfgNome.value = '';
  cfgEmail.value = '';
  setFoto('');
  carregarIniciarWindows();
  try {
    const r = await getMeuPerfil();
    cfgEmail.value = r.data.email || '';
    cfgNome.value = r.data.displayName || '';
    setFoto(r.data.photo || '');
  } catch (e) {
    console.warn('Perfil:', e);
  }
}

function mostrarMsgCfg(texto, ok) {
  cfgMsg.textContent = texto;
  cfgMsg.style.color = ok ? '#8ddca8' : '#ffb4bc';
  cfgMsg.hidden = false;
  setTimeout(() => { cfgMsg.hidden = true; }, 3000);
}

cfgTrocarFoto.addEventListener('click', () => cfgFileInput.click());
cfgRemoverFoto.addEventListener('click', () => { fotoPendente = ''; setFoto(''); });

cfgFileInput.addEventListener('change', () => {
  const f = cfgFileInput.files[0];
  cfgFileInput.value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const tam = 240;
      const min = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = tam; canvas.height = tam;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, tam, tam);
      const dataURL = canvas.toDataURL('image/jpeg', 0.85);
      fotoPendente = dataURL;
      setFoto(dataURL);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});

cfgSalvar.addEventListener('click', async () => {
  cfgSalvar.disabled = true;
  const payload = { displayName: cfgNome.value };
  if (fotoPendente !== null) payload.photo = fotoPendente;
  try {
    await salvarMeuPerfil(payload);
    fotoPendente = null;
    usuarioInfo.textContent = cfgNome.value || cfgEmail.value;
    mostrarMsgCfg('Salvo!', true);
  } catch (e) {
    mostrarMsgCfg('Erro: ' + e.message, false);
  } finally {
    cfgSalvar.disabled = false;
  }
});

// ─── Auth + topbar ───────────────────────────────────────────────────────
btnAdmin.addEventListener('click', () => window.hubApi.abrirAdmin());
btnSair.addEventListener('click', async () => { await signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.hubApi.voltarParaLogin();
    return;
  }
  usuarioInfo.textContent = user.displayName || user.email;

  const tokenResult = await user.getIdTokenResult();
  isAdmin = !!tokenResult.claims.admin;

  if (!isAdmin && BOOTSTRAP_ADMIN_UIDS.includes(user.uid)) {
    try {
      await bootstrapAdmin();
      await user.getIdToken(true);
      const r2 = await user.getIdTokenResult();
      isAdmin = !!r2.claims.admin;
    } catch (e) { console.warn('Bootstrap admin:', e); }
  }

  btnAdmin.hidden = !isAdmin;

  // Busca os apps restritos liberados pra este usuário e re-renderiza
  try {
    const perm = await getMinhasPermissoes();
    appsPermitidos = perm.data.apps || [];
    if (perm.data.isAdmin) isAdmin = true;
  } catch (e) {
    console.warn('Permissões:', e);
    appsPermitidos = [];
  }
  renderCentro();
  carregarPerfil(); // popula o avatar no topo

  // Agenda: carrega eventos e liga os alertas
  await carregarEventos(new Date(Date.now() - 86400000), new Date(Date.now() + 1000 * 60 * 60 * 24 * 90));
  renderPainelAgenda();
  if (categoriaAtiva === 'agenda') renderCalendarioCompleto();
  verificarAlertas();
  if (!window.__alertaTimer) window.__alertaTimer = setInterval(verificarAlertas, 30000);

  // Avisos do admin: mostra os não confirmados ao abrir + checa a cada 3 min
  btnAviso.hidden = !isAdmin;
  verificarNotificacoes();
  if (!window.__notifTimer) window.__notifTimer = setInterval(verificarNotificacoes, 180000);
});

// ─── Agenda ────────────────────────────────────────────────────────────────
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function chaveDia(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function atualizarRelogio(){
  const agora = new Date();
  relogioHora.textContent = agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  relogioData.textContent = agora.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' });
}

function chaveEvento(e){ return e.origem === 'google' ? ('g:' + e.googleId) : e.id; }

async function carregarEventos(de, ate){
  try {
    const r = await listarEventos({ de: de.toISOString(), ate: ate.toISOString() });
    const novos = (r.data || []).map(e => ({ ...e, inicio: new Date(e.inicio) }));
    // Mantém só o que está FORA do período recarregado; o de dentro é refeito do zero,
    // assim itens excluídos (no Hub ou no Google) somem ao atualizar a agenda.
    const deMs = de.getTime(), ateMs = ate.getTime();
    const mapa = new Map(
      eventos.filter(e => { const t = e.inicio.getTime(); return t < deMs || t > ateMs; })
             .map(e => [chaveEvento(e), e])
    );
    novos.forEach(e => mapa.set(e.id, e));

    // Fase 2: traz o que foi criado direto no Google (só se conectado), sem duplicar.
    if (googleConectado) {
      try {
        const g = await listarGoogleAgenda({ de: de.toISOString(), ate: ate.toISOString() });
        const idsDoHub = new Set(novos.map(e => e.googleId).filter(Boolean));
        ((g.data && g.data.itens) || []).forEach(it => {
          if (idsDoHub.has(it.googleId)) return; // já é um item do Hub espelhado
          mapa.set('g:' + it.googleId, { ...it, inicio: new Date(it.inicio), origem: 'google', souDono: false });
        });
      } catch(e){ console.warn('Google agenda:', e); }
    }
    eventos = Array.from(mapa.values()).sort((a,b) => a.inicio - b.inicio);
  } catch(e){ console.warn('Eventos:', e); }
}

function eventosDoDia(chave){
  return eventos.filter(e => chaveDia(e.inicio) === chave).sort((a,b)=>a.inicio-b.inicio);
}

// ─── Feriados nacionais (BrasilAPI — grátis, sem login) ──────────────────────
let feriados = {};                  // { 'YYYY-MM-DD': 'Nome do feriado' }
const feriadosAnos = new Set();     // anos já carregados (cache)
async function carregarFeriados(ano){
  if(feriadosAnos.has(ano)) return;
  feriadosAnos.add(ano);            // marca antes pra evitar corrida em chamadas paralelas
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if(!resp.ok) throw new Error('status ' + resp.status);
    const lista = await resp.json();
    lista.forEach(f => { feriados[f.date] = f.name; });
  } catch(e){
    feriadosAnos.delete(ano);       // deixa tentar de novo numa próxima
    console.warn('Feriados:', e.message);
  }
}

function montarGradeMes(ano, mes, mini=false){
  const inicioSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes+1, 0).getDate();
  const hojeChave = chaveDia(new Date());
  let html = '<div class="cal-semana">' + DIAS_SEM.map(d=>`<span>${d}</span>`).join('') + '</div><div class="cal-dias">';
  for(let i=0;i<inicioSemana;i++) html += '<span class="cal-dia vazio"></span>';
  for(let dia=1; dia<=diasNoMes; dia++){
    const chave = chaveDia(new Date(ano, mes, dia));
    const evs = eventosDoDia(chave);
    const fer = feriados[chave];
    html += `<button class="cal-dia ${chave===hojeChave?'hoje':''} ${chave===diaSelecionado?'sel':''} ${evs.length?'tem-ev':''} ${fer?'feriado':''}" data-dia="${chave}"${fer?` title="${escapeHtml(fer)}"`:''}>
      <span class="cal-num">${dia}</span>${evs.length?`<span class="cal-ponto">${evs.length>1?evs.length:''}</span>`:''}${(fer && !mini)?`<span class="cal-feriado">${escapeHtml(fer)}</span>`:''}
    </button>`;
  }
  return html + '</div>';
}

function renderPainelAgenda(){
  const agora = new Date();
  miniCal.innerHTML = `<div class="mini-cal-titulo">${MESES[agora.getMonth()]} ${agora.getFullYear()}</div>` +
                      montarGradeMes(agora.getFullYear(), agora.getMonth(), true);
  miniCal.querySelectorAll('.cal-dia[data-dia]').forEach(b=>{
    b.addEventListener('click', ()=>{
      diaSelecionado = b.dataset.dia;
      const d = new Date(b.dataset.dia + 'T00:00:00');
      calAno = d.getFullYear(); calMes = d.getMonth();
      categoriaAtiva = 'agenda'; renderSidebar(); renderCentro();
    });
  });
  const prox = eventos.filter(e => e.inicio >= new Date(Date.now()-3600000)).slice(0,8);
  listaProx.innerHTML = prox.length === 0
    ? '<p class="muted" style="font-size:12px">Nenhum compromisso.</p>'
    : prox.map(e => `
      <div class="ev-item compacto">
        <div class="ev-quando">${e.inicio.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} ${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="ev-titulo">${iconeTipo(e.tipo)} ${escapeHtml(e.titulo)} ${e.todos?'<span class="ev-tag">todos</span>':''}</div>
      </div>`).join('');
}

async function renderCalendarioCompleto(){
  if(calAno == null){ const h=new Date(); calAno=h.getFullYear(); calMes=h.getMonth(); }
  if(!diaSelecionado) diaSelecionado = chaveDia(new Date()); // detalhe sempre visível (sem "pulo")
  await carregarFeriados(calAno);
  await carregarEventos(new Date(calAno, calMes-1, 1), new Date(calAno, calMes+2, 0));
  calTitulo.textContent = `${MESES[calMes]} ${calAno}`;
  calGrade.innerHTML = montarGradeMes(calAno, calMes);
  calGrade.querySelectorAll('.cal-dia[data-dia]').forEach(b=>{
    b.addEventListener('click', ()=>{ diaSelecionado = b.dataset.dia; renderCalendarioCompleto(); });
  });
  renderDetalheDia();
  renderPainelAgenda();
}

function renderDetalheDia(){
  if(!diaSelecionado){ calDiaDetalhe.hidden = true; return; }
  calDiaDetalhe.hidden = false;
  const evs = eventosDoDia(diaSelecionado);
  const d = new Date(diaSelecionado + 'T00:00:00');
  calDiaDetalhe.innerHTML = `
    <div class="dia-det-head">
      <h4>${d.toLocaleDateString('pt-BR',{weekday:'long', day:'2-digit', month:'long'})}</h4>
      <button class="topbar-btn primario" id="btnNovoNoDia">+ Compromisso</button>
    </div>
    ${feriados[diaSelecionado] ? `<div class="dia-det-feriado">🎉 Feriado: ${escapeHtml(feriados[diaSelecionado])}</div>` : ''}
    ${evs.length ? evs.map(e=>`
      <div class="ev-item">
        <div class="ev-quando">${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="ev-corpo">
          <div class="ev-titulo">${iconeTipo(e.tipo)} ${escapeHtml(e.titulo)} ${e.todos?'<span class="ev-tag">todos</span>':''} ${e.origem==='google'?'<span class="ev-tag ev-tag-google">Google</span>':''}</div>
          ${e.descricao?`<div class="ev-desc">${escapeHtml(e.descricao)}</div>`:''}
        </div>
        ${(e.souDono||isAdmin) && e.origem!=='google'?`<button class="ev-del" data-id="${e.id}" title="Excluir">✕</button>`:''}
      </div>`).join('') : '<p class="muted">Nada nesse dia.</p>'}
  `;
  calDiaDetalhe.querySelector('#btnNovoNoDia')?.addEventListener('click', ()=> abrirModalEvento(diaSelecionado));
  calDiaDetalhe.querySelectorAll('.ev-del').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Excluir este compromisso?')) return;
      try { await excluirEvento({ id: b.dataset.id }); eventos = eventos.filter(e=>e.id!==b.dataset.id); renderCalendarioCompleto(); }
      catch(e){ alert('Erro: '+e.message); }
    });
  });
}

function iconeTipo(tipo){ return tipo === 'tarefa' ? '✓' : tipo === 'lembrete' ? '🔔' : '📅'; }

async function abrirModalEvento(diaPre){
  document.getElementById('evTitulo').value = '';
  document.getElementById('evDesc').value = '';
  document.getElementById('evHora').value = '09:00';
  document.getElementById('evData').value = diaPre || chaveDia(new Date());
  const radioEvento = document.querySelector('input[name="evTipo"][value="evento"]');
  if(radioEvento) radioEvento.checked = true;
  const area = document.getElementById('evParticipantesArea');
  if(isAdmin){
    area.hidden = false;
    document.getElementById('evTodos').checked = false;
    const cont = document.getElementById('evPessoas');
    cont.innerHTML = '<p class="muted" style="font-size:12px">carregando...</p>';
    try {
      if(!pessoasCache){ const r = await listarPessoas(); pessoasCache = r.data || []; }
      cont.innerHTML = pessoasCache.map(p=>`
        <label class="auth-label-inline"><input type="checkbox" value="${p.uid}"> ${escapeHtml(p.nome)}</label>`).join('');
    } catch(e){ cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; }
  } else {
    area.hidden = true;
  }
  modalEvento.showModal();
}

function verificarAlertas(){
  const agora = Date.now();
  eventos.forEach(e=>{
    const k = chaveEvento(e);
    const falta = e.inicio.getTime() - agora;
    if(falta > 0 && falta <= 3600000 && !alertados.has(k)){
      alertados.add(k);
      const hora = e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      alert(`⏰ Lembrete: "${e.titulo}" às ${hora} (em menos de 1h).`);
    }
  });
}

// Listeners da agenda
document.getElementById('btnNovoEvento').addEventListener('click', ()=> abrirModalEvento(null));
document.getElementById('btnNovoEvento2').addEventListener('click', ()=> abrirModalEvento(diaSelecionado));
document.getElementById('cancelarEvento').addEventListener('click', ()=> modalEvento.close());
document.getElementById('calPrev').addEventListener('click', ()=>{ calMes--; if(calMes<0){calMes=11;calAno--;} renderCalendarioCompleto(); });
document.getElementById('calProx').addEventListener('click', ()=>{ calMes++; if(calMes>11){calMes=0;calAno++;} renderCalendarioCompleto(); });
document.getElementById('calHoje').addEventListener('click', ()=>{ const h=new Date(); calAno=h.getFullYear(); calMes=h.getMonth(); diaSelecionado=chaveDia(h); renderCalendarioCompleto(); });
document.getElementById('evTodos').addEventListener('change', (e)=>{ document.getElementById('evPessoas').style.opacity = e.target.checked ? '0.4' : '1'; });

// ─── Conectar / desconectar a Google Agenda ──────────────────────────────────
const btnGoogleAgenda = document.getElementById('btnGoogleAgenda');
let googleConectado = false;

function pintarBotaoGoogle(conectado, email){
  googleConectado = conectado;
  if(conectado){
    btnGoogleAgenda.classList.add('google-on');
    btnGoogleAgenda.textContent = '📅 Google ✓';
    btnGoogleAgenda.title = email ? `Conectado: ${email} — clique para desconectar` : 'Conectado — clique para desconectar';
  } else {
    btnGoogleAgenda.classList.remove('google-on');
    btnGoogleAgenda.textContent = '📅 Conectar Google';
    btnGoogleAgenda.title = 'Sincronizar com a Google Agenda';
  }
}

async function atualizarStatusGoogle(){
  try {
    const r = await statusGoogleAgenda();
    pintarBotaoGoogle(!!(r.data && r.data.conectado), (r.data && r.data.email) || '');
  } catch(e){ console.warn('Status Google:', e); }
}

btnGoogleAgenda.addEventListener('click', async ()=>{
  // Já conectado → oferece desconectar
  if(googleConectado){
    if(!confirm('Desconectar sua Google Agenda? Os compromissos já enviados continuam lá.')) return;
    btnGoogleAgenda.disabled = true;
    try { await desconectarGoogleAgenda(); pintarBotaoGoogle(false, ''); }
    catch(e){ alert('Erro ao desconectar: '+e.message); }
    finally { btnGoogleAgenda.disabled = false; }
    return;
  }
  // Não conectado → abre o navegador pra autorizar
  btnGoogleAgenda.disabled = true;
  const txtAntes = btnGoogleAgenda.textContent;
  btnGoogleAgenda.textContent = 'Abrindo navegador...';
  try {
    const r = await window.hubApi.conectarGoogle();
    if(!r || !r.ok){ alert('Conexão cancelada' + (r && r.erro ? ': '+r.erro : '.')); return; }
    btnGoogleAgenda.textContent = 'Finalizando...';
    const res = await conectarGoogleAgenda({ code: r.code, codeVerifier: r.codeVerifier, redirectUri: r.redirectUri });
    pintarBotaoGoogle(true, (res.data && res.data.email) || '');
    alert('Google Agenda conectada! ✅ Novos compromissos vão aparecer lá também.');
  } catch(e){
    alert('Erro ao conectar: '+e.message);
  } finally {
    btnGoogleAgenda.disabled = false;
    if(!googleConectado) btnGoogleAgenda.textContent = txtAntes;
  }
});

document.getElementById('formEvento').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const titulo = document.getElementById('evTitulo').value.trim();
  const data = document.getElementById('evData').value;
  const hora = document.getElementById('evHora').value;
  const descricao = document.getElementById('evDesc').value.trim();
  if(!titulo || !data || !hora) return;
  const tipo = (document.querySelector('input[name="evTipo"]:checked') || {}).value || 'evento';
  const payload = { titulo, inicio: new Date(data + 'T' + hora).toISOString(), descricao, tipo, dataLocal: data };
  if(isAdmin){
    if(document.getElementById('evTodos').checked) payload.todos = true;
    else payload.participantes = Array.from(document.querySelectorAll('#evPessoas input:checked')).map(c=>c.value);
  }
  try {
    await criarEvento(payload);
    modalEvento.close();
    await carregarEventos(new Date(Date.now()-86400000), new Date(Date.now()+1000*60*60*24*90));
    renderPainelAgenda();
    if(categoriaAtiva==='agenda') renderCalendarioCompleto();
  } catch(err){ alert('Erro ao salvar: '+err.message); }
});

// Abrir a pasta no Drive (pra admin gerenciar / ou visualizar completo)
btnAbrirDrive.addEventListener('click', () => window.open(DRIVE_FOLDER_URL, '_blank'));

// Minimizar/mostrar o painel da agenda (setinha no canto + botão flutuante; lembra a preferência)
const btnMinAgenda = document.getElementById('btnMinAgenda');
const btnExpandAgenda = document.getElementById('btnExpandAgenda');
const hubLayout = document.querySelector('.hub-layout');
function setAgendaOculta(oculta){
  hubLayout.classList.toggle('agenda-oculta', oculta);
  btnExpandAgenda.hidden = !oculta;
  try { localStorage.setItem('agendaOculta', oculta ? '1' : '0'); } catch(e){}
}
btnMinAgenda.addEventListener('click', () => setAgendaOculta(true));
btnExpandAgenda.addEventListener('click', () => setAgendaOculta(false));
let _agendaOcultaInicial = false;
try { _agendaOcultaInicial = localStorage.getItem('agendaOculta') === '1'; } catch(e){}
setAgendaOculta(_agendaOcultaInicial);

// ─── Avisos / Notificações do admin ──────────────────────────────────────
const modalAviso = document.getElementById('modalAviso');
modalAviso.addEventListener('cancel', (e) => e.preventDefault()); // não fecha no ESC: precisa clicar "Vi"
let filaAvisos = [];

function mostrarProximoAviso(){
  if(!filaAvisos.length){ if(modalAviso.open) modalAviso.close(); return; }
  const av = filaAvisos[0];
  document.getElementById('avisoTitulo').textContent = av.titulo || '📢 Aviso';
  document.getElementById('avisoMensagem').textContent = av.mensagem;
  if(!modalAviso.open) modalAviso.showModal();
}

document.getElementById('avisoCheck').addEventListener('click', async () => {
  const av = filaAvisos[0];
  if(!av){ modalAviso.close(); return; }
  const btn = document.getElementById('avisoCheck');
  btn.disabled = true;
  try { await marcarNotificacaoLida({ id: av.id }); } catch(e){ console.warn('marcar lido:', e); }
  btn.disabled = false;
  filaAvisos.shift();
  if(filaAvisos.length) mostrarProximoAviso(); else modalAviso.close();
});

async function verificarNotificacoes(){
  try {
    const r = await listarMinhasNotificacoes();
    const novos = r.data || [];
    if(!novos.length) return;
    const naFila = new Set(filaAvisos.map(a => a.id));
    novos.forEach(n => { if(!naFila.has(n.id)) filaAvisos.push(n); });
    mostrarProximoAviso();
  } catch(e){ console.warn('Notificações:', e); }
}

// Admin: enviar aviso
const modalEnviarAviso = document.getElementById('modalEnviarAviso');
btnAviso.addEventListener('click', async () => {
  document.getElementById('avTitulo').value = '';
  document.getElementById('avMensagem').value = '';
  document.getElementById('avTodos').checked = false;
  const cont = document.getElementById('avPessoas');
  cont.style.opacity = '1';
  cont.innerHTML = '<p class="muted" style="font-size:12px">carregando...</p>';
  try {
    if(!pessoasCache){ const r = await listarPessoas(); pessoasCache = r.data || []; }
    cont.innerHTML = pessoasCache.map(p => `
      <label class="auth-label-inline"><input type="checkbox" value="${p.uid}"> ${escapeHtml(p.nome)}</label>`).join('');
  } catch(e){ cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; }
  modalEnviarAviso.showModal();
});
document.getElementById('avCancelar').addEventListener('click', () => modalEnviarAviso.close());
document.getElementById('avTodos').addEventListener('change', (e) => {
  document.getElementById('avPessoas').style.opacity = e.target.checked ? '0.4' : '1';
});
document.getElementById('formEnviarAviso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensagem = document.getElementById('avMensagem').value.trim();
  const titulo = document.getElementById('avTitulo').value.trim();
  if(!mensagem) return;
  const payload = { mensagem, titulo };
  if(document.getElementById('avTodos').checked) payload.todos = true;
  else payload.participantes = Array.from(document.querySelectorAll('#avPessoas input:checked')).map(c => c.value);
  if(!payload.todos && (!payload.participantes || !payload.participantes.length)){
    alert('Escolha "todos" ou pelo menos uma pessoa.'); return;
  }
  try {
    await criarNotificacao(payload);
    modalEnviarAviso.close();
    alert('Aviso enviado! ✅');
  } catch(err){ alert('Erro ao enviar: ' + err.message); }
});

// ─── Config: iniciar com o Windows ────────────────────────────────────────
const cfgIniciarWindows = document.getElementById('cfgIniciarWindows');
async function carregarIniciarWindows(){
  if(!cfgIniciarWindows || !window.hubApi.getIniciarWindows) return;
  try { cfgIniciarWindows.checked = await window.hubApi.getIniciarWindows(); } catch(e){ console.warn(e); }
}
cfgIniciarWindows?.addEventListener('change', async () => {
  try { await window.hubApi.setIniciarWindows(cfgIniciarWindows.checked); }
  catch(e){ alert('Não foi possível alterar: ' + e.message); }
});

// ─── Render inicial ──────────────────────────────────────────────────────
atualizarRelogio();
setInterval(atualizarRelogio, 1000);
renderPainelAgenda();
renderSidebar();
renderCentro();
// Feriados do ano atual já no mini calendário (atualiza assim que chegar)
carregarFeriados(new Date().getFullYear()).then(() => renderPainelAgenda());
