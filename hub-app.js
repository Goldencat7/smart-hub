// Lógica da tela principal do Hub:
// - Sidebar com categorias + busca por categoria
// - Verifica auth, busca credenciais via Cloud Function ao clicar
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  getFirestore, doc, setDoc, serverTimestamp as fsTs
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbMmPdIzIaLA-pKGYv0R9UQ_z3Q-EC2U8",
  authDomain: "remax-smart-hub.firebaseapp.com",
  projectId: "remax-smart-hub",
  storageBucket: "remax-smart-hub.firebasestorage.app",
  messagingSenderId: "474454438949",
  appId: "1:474454438949:web:ba1e10e6b343af0408fbcc"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const fns     = getFunctions(app, 'southamerica-east1');
const storage = getStorage(app);
const db      = getFirestore(app);

const getCredentials = httpsCallable(fns, 'getCredentials');
const bootstrapAdmin = httpsCallable(fns, 'bootstrapAdmin');
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const registrarAcesso = httpsCallable(fns, 'registrarAcesso');
const getMeuPerfil = httpsCallable(fns, 'getMeuPerfil');
const salvarMeuPerfil = httpsCallable(fns, 'salvarMeuPerfil');
const criarEvento = httpsCallable(fns, 'criarEvento');
const editarEvento = httpsCallable(fns, 'editarEvento');
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
const responderConvite = httpsCallable(fns, 'responderConvite');
const getBanner        = httpsCallable(fns, 'getBanner');
const listarBanners    = httpsCallable(fns, 'listarBanners');
const adicionarBanner  = httpsCallable(fns, 'adicionarBanner');
const removerBanner    = httpsCallable(fns, 'removerBanner');
const getTreinamentoLinks = httpsCallable(fns, 'getTreinamentoLinks');
const setTreinamentoLink  = httpsCallable(fns, 'setTreinamentoLink');

const getFotoDrives = httpsCallable(fns, 'getFotoDrives');
const setFotoDrive = httpsCallable(fns, 'setFotoDrive');
const enviarSuporte = httpsCallable(fns, 'enviarSuporte');
const listarFichasLocador      = httpsCallable(fns, 'listarFichasLocador');
const enviarFichaParaAdmin     = httpsCallable(fns, 'enviarFichaParaAdmin');
const excluirFichaLocador      = httpsCallable(fns, 'excluirFichaLocador');
const reenviarFichaParaCliente = httpsCallable(fns, 'reenviarFichaParaCliente');
const listarFichasParaAnalise   = httpsCallable(fns, 'listarFichasParaAnalise');
const finalizarFichaLocador     = httpsCallable(fns, 'finalizarFichaLocador');
const listarFichasTipo          = httpsCallable(fns, 'listarFichasTipo');
const enviarFichaTipoAdmin      = httpsCallable(fns, 'enviarFichaTipoAdmin');
const excluirFichaTipo          = httpsCallable(fns, 'excluirFichaTipo');
const reenviarFichaTipoCliente  = httpsCallable(fns, 'reenviarFichaTipoCliente');
const listarFichasTipoAnalise   = httpsCallable(fns, 'listarFichasTipoAnalise');
const finalizarFichaTipo        = httpsCallable(fns, 'finalizarFichaTipo');
const listarStatusApps    = httpsCallable(fns, 'listarStatusApps');
const contarNotifFichas   = httpsCallable(fns, 'contarNotifFichas');

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
    key: 'itbi_smart', categoria: 'captacao',
    titulo: 'ITBI Smart', icone: 'IT', desc: 'Cálculo de ITBI',
    url: 'https://itbi-smart.web.app', autologin: false
  },
  {
    key: 'checkvisto', categoria: 'vistoria',
    titulo: 'Smart Vistorias', icone: 'SV', desc: 'Controle de visitas',
    url: 'https://checkvisto-app.web.app', autologin: false
  },
  {
    key: 'alude', categoria: 'captacao',
    titulo: 'Alude', icone: 'AL', desc: 'Análise de crédito',
    url: 'https://app.alude.com.br/', autologin: true
  },
  {
    key: 'clicksign', categoria: '_',
    titulo: 'ClickSign', icone: 'CS', desc: 'Assinatura digital',
    url: 'https://app.clicksign.com/', autologin: true, restrito: true
  },
  {
    key: 'motiva', categoria: 'performance',
    titulo: 'Motiva Smart', icone: 'MS', desc: 'Motivação & metas',
    url: 'https://motivatech-app.web.app', autologin: false
  },
  {
    key: 'gemini', categoria: '_',
    titulo: 'Gemini', icone: 'GM', desc: 'Assistente de IA do Google',
    url: 'https://gemini.google.com/', autologin: false
  },
  {
    key: 'whatsapp', categoria: '_',
    titulo: 'WhatsApp', icone: 'WA', desc: 'WhatsApp Web',
    url: 'https://web.whatsapp.com/', autologin: false
  },
  {
    key: 'universidade', categoria: 'treinamento',
    titulo: 'Universidade REMAX', icone: 'UR', desc: 'Treinamento e cursos',
    url: 'https://universidaderemax.studionmx.com/', autologin: false
  },
  {
    key: 'goiconnect', categoria: 'crm',
    titulo: 'IConnect', icone: 'IC', desc: 'goiconnect.com',
    url: 'https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f', autologin: false
  },
  {
    key: 'brokerapp', categoria: 'crm',
    titulo: 'BrokerApp', icone: 'BA', desc: 'brokerapp.com.br',
    url: 'https://brokerapp.com.br/app/', autologin: false
  }
];

// Ícones em SVG (estilo linha, herdam a cor do item via currentColor)
const svgIcone = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICN = {
  captacao:    svgIcone('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>'),
  crm:         svgIcone('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.2"/><path d="M15.5 8.5h2.5"/><path d="M15.5 12h2.5"/><path d="M6.5 16c.5-1.6 4.5-1.6 5 0"/>'),
  vistoria:    svgIcone('<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>'),
  locacao:     svgIcone('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8.2-8.2"/><path d="m16 7 3 3"/>'),
  performance: svgIcone('<path d="M4 4v16h16"/><path d="M8 16v-4"/><path d="M13 16V9"/><path d="M18 16V6"/>'),
  treinamento: svgIcone('<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v4.5c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5V12"/>'),
  marketing:   svgIcone('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-4.5-4.5L5 21"/>'),
  agenda:      svgIcone('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>'),
  documentos:  svgIcone('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  fotografia:  svgIcone('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  reuniao:     svgIcone('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  salaReuniao: svgIcone('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
  whatsapp:    svgIcone('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  clicksign:   svgIcone('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  ia:          svgIcone('<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>'),
  config:      svgIcone('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')
};

// ─── Estrutura fixa dos treinamentos ─────────────────────────────────────────
const TREINAMENTO_CATS = [
  { id: 'onboarding', nome: 'Onboarding', emoji: '📋', itens: [
    { id: 'onb1', nome: 'Do Zero à Primeira Venda' },
    { id: 'onb2', nome: 'Primeiros 30 Dias' },
    { id: 'onb3', nome: 'Cultura REMAX Smart' },
    { id: 'onb4', nome: 'Gestão de Locação Smart' }
  ]},
  { id: 'captacao_t', nome: 'Captação', emoji: '🎯', itens: [
    { id: 'cap1', nome: 'Prospecção de Proprietários' },
    { id: 'cap2', nome: 'Captação por Indicação' },
    { id: 'cap3', nome: 'Captação Digital' }
  ]},
  { id: 'vendas', nome: 'Vendas', emoji: '🤝', itens: [
    { id: 'ven1', nome: 'Processo Completo da Venda' },
    { id: 'ven2', nome: 'Objeções e Negociação' },
    { id: 'ven3', nome: 'Fechamento de Negócios' }
  ]},
  { id: 'locacao_t', nome: 'Locação', emoji: '🏠', itens: [
    { id: 'loc1', nome: 'Primeira Locação' },
    { id: 'loc2', nome: 'Atendimento ao Locatário' },
    { id: 'loc3', nome: 'Processo de Locação' }
  ]},
  { id: 'mkt_t', nome: 'Marketing', emoji: '📣', itens: [
    { id: 'mkt1', nome: 'Instagram para Corretores' },
    { id: 'mkt2', nome: 'Produção de Conteúdo' },
    { id: 'mkt3', nome: 'Posicionamento Digital' }
  ]},
  { id: 'remax', nome: 'REMAX Smart', emoji: '🏢', itens: [
    { id: 'rmx1', nome: 'Modelo de Negócio' },
    { id: 'rmx2', nome: 'Ferramentas da Unidade' },
    { id: 'rmx3', nome: 'Processos Internos' }
  ]}
];

const CATEGORIAS = [
  { id: 'captacao',    nome: 'Captação',    icone: ICN.captacao },
  { id: 'crm',         nome: 'CRM',         icone: ICN.crm },
  { id: 'vistoria',    nome: 'Vistoria',    icone: ICN.vistoria },
  { id: 'locacao',     nome: 'Locação',     icone: ICN.locacao, oculto: true },
  { id: 'performance', nome: 'Performance', icone: ICN.performance },
  { id: 'treinamento', nome: 'Treinamento', icone: ICN.treinamento, treinamento: true },
  { id: 'marketing',   nome: 'Marketing',   icone: ICN.marketing, marketing: true },
  { id: 'clicksign',   nome: 'ClickSign',   icone: ICN.clicksign, appDireto: 'clicksign', restrito: true },
  { id: 'agenda',      nome: 'Agenda',      icone: ICN.agenda, agenda: true },
  { id: 'documentos',  nome: 'Cadastro',  icone: ICN.documentos, placeholder: true },
  { id: 'fotografia',  nome: 'Fotografia',  icone: ICN.fotografia, fotografia: true },
  { id: 'reuniao',      nome: 'Reunião',        icone: ICN.reuniao, reuniao: true },
  { id: 'sala_reuniao', nome: 'Sala de Reunião', icone: ICN.salaReuniao, salaReuniao: true },
  { id: 'ia',           nome: 'IA',              icone: ICN.ia, ia: true },
  { id: 'whatsapp',    nome: 'WhatsApp',     icone: ICN.whatsapp, appDireto: 'whatsapp' },
  { id: 'config',      nome: 'Configurações', icone: ICN.config, config: true }
];

// Avatar padrão (quando a pessoa não tem foto)
const AVATAR_PADRAO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1d222d"/><circle cx="60" cy="46" r="22" fill="#6b7280"/><rect x="24" y="74" width="72" height="48" rx="24" fill="#6b7280"/></svg>'
);

let categoriaAtiva = 'captacao';
let termoBusca = '';
let isAdmin = false;
let currentUid = null;
let appsPermitidos = [];
let temDrivesFotografia = false;
let statusApps = {};
let treinamentoLinks = {};     // { itemId: { url, tipo } }
let treinamentoCatAberta = null; // id da categoria expandida no accordion
let bannerImagens = [];            // array de data URLs dos banners
let bannerIdx = 0;                 // índice do banner atual no carrossel
let renderizandoCal = false;
let renderCalPendente = false;    // fix 3: guarda clique durante render pra re-renderizar depois
let verificandoNotif = false;     // Bug 5: evita chamadas concorrentes de verificarNotificacoes // apps restritos liberados pra este usuário

// ─── DOM ─────────────────────────────────────────────────────────────────
const navCategorias  = document.getElementById('navCategorias');
const tituloCategoria = document.getElementById('tituloCategoria');
const inputBusca     = document.getElementById('inputBusca');
const searchWrap     = document.querySelector('.search-wrap');
const appsGrid       = document.getElementById('appsGrid');
const estadoVazio    = document.getElementById('estadoVazio');
const secaoMarketing      = document.getElementById('secaoMarketing');
const secaoDocs           = document.getElementById('secaoDocumentos');
const secaoFotografia     = document.getElementById('secaoFotografia');
const secaoReuniao        = document.getElementById('secaoReuniao');
const secaoSalaReuniao    = document.getElementById('secaoSalaReuniao');
const secaoIA             = document.getElementById('secaoIA');
const secaoTreinamento    = document.getElementById('secaoTreinamento');
const driveFrame     = document.getElementById('driveFrame');
const btnAbrirDrive  = document.getElementById('btnAbrirDrive');
const secaoConfig    = document.getElementById('secaoConfig');

// Pasta de documentos no Google Drive (compartilhada como "qualquer um com link: leitor")
const DRIVE_FOLDER_ID  = '10dlIlDyGyvyMCZQUWbt2_YVDdXgfmlzp';
const DRIVE_EMBED_URL  = `https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#grid`;
const DRIVE_FOLDER_URL = `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`;

// Agendamento de sessão de fotografia (Google Agenda — booking page)
const AGENDA_FOTOGRAFIA_URL = 'https://calendar.app.google/xXv4jHQee8Q9zAoR6';
// Agendamento de reunião
const AGENDA_REUNIAO_URL = 'https://calendar.app.google/nNon8YNJjC39Rj4b9';

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
const cfgAlterarSenha    = document.getElementById('cfgAlterarSenha');
const cfgVerificarUpdate = document.getElementById('cfgVerificarUpdate');
const cfgVersaoInfo      = document.getElementById('cfgVersaoInfo');

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
let eventoEditandoId = null;      // id do evento em edição no modal (null = modo criar)
const alertados = new Set();      // ids já alertados (1h antes)
let pessoasCache = null;          // lista de pessoas (admin) pro seletor
let pessoasCacheAt = 0;           // timestamp da última carga do cache (TTL: 5 min)

// ─── Render sidebar ──────────────────────────────────────────────────────
function renderSidebar() {
  const visiveis = CATEGORIAS.filter(c =>
    !c.oculto &&
    (!c.restrito || isAdmin || (c.appDireto && appsPermitidos.includes(c.appDireto)))
  );

  navCategorias.innerHTML = visiveis.map(c => `
    <button class="nav-item ${c.id === categoriaAtiva ? 'ativo' : ''} ${c.config ? 'nav-item-fim' : ''}" data-cat="${c.id}">
      <span class="nav-icone">${c.icone}</span>
      <span class="nav-label">${c.nome}</span>
    </button>
  `).join('');

  navCategorias.querySelectorAll('.nav-item').forEach(b => {
    const cat = CATEGORIAS.find(c => c.id === b.dataset.cat);
    b.addEventListener('click', () => {
      if (cat && cat.appDireto) {
        abrirApp(cat.appDireto);
        return;
      }
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
  secaoMarketing.hidden = true;
  secaoFotografia.hidden = true;
  secaoReuniao.hidden = true;
  secaoSalaReuniao.hidden = true;
  secaoIA.hidden = true;
  secaoTreinamento.hidden = true;
  searchWrap.hidden = true;
  atualizarBanner();
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
    // Auto-refresh ao entrar na aba: mostra "Atualizando..." no botão enquanto carrega
    const btnR = document.getElementById('calRecarregar');
    const textoR = btnR.textContent;
    btnR.disabled = true;
    btnR.textContent = '↻ Atualizando...';
    renderCalendarioCompleto().finally(() => { btnR.disabled = false; btnR.textContent = textoR; });
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

  // Aba Marketing (templates editáveis)
  if (cat.marketing) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoMarketing.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    setTimeout(iniciarCarrosseis, 50); // aguarda render pra medir scrollWidth
    return;
  }

  // Aba Treinamento (accordion de categorias)
  if (cat.treinamento) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoTreinamento.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarTreinamento();
    return;
  }

  // Aba Fotografia
  if (cat.fotografia) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoFotografia.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarFotografia();
    return;
  }

  // Aba IA
  if (cat.ia) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoIA.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarIA();
    return;
  }

  // Aba Reunião
  if (cat.salaReuniao) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoSalaReuniao.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarSalaReuniao();
    return;
  }

  if (cat.reuniao) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoReuniao.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarReuniao();
    return;
  }

  // Documentos (ficha cadastral + fichas recebidas)
  if (cat.placeholder) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarDocumentos();
    return;
  }
  inputBusca.disabled = false;
  inputBusca.placeholder = `Buscar em ${cat.nome.toLowerCase()}...`;
  searchWrap.hidden = false;
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
    <button class="hub-card ${statusApps[a.key] ? 'com-aviso' : ''}" data-app="${a.key}">
      <span class="card-icon">
        <img class="card-icon-img" src="app-icons/${a.key}.png" alt="">
        ${a.icone}
      </span>
      <span class="card-title">${a.titulo}</span>
      <span class="card-desc">${a.desc}</span>
      ${statusApps[a.key] ? badgeStatus(statusApps[a.key]) : ''}
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

// ─── Banner principal ──────────────────────────────────────────────────────
const bannerEl = document.getElementById('bannerPrincipal');

async function carregarBanner() {
  try {
    const r = await listarBanners();
    bannerImagens = (r.data.banners || []).filter(b => b.imagem || b.mediaUrl);
  } catch (e) {
    console.warn('Banner:', e);
    bannerImagens = [];
  }
  bannerIdx = 0;
  iniciarRotacaoBanner();
}

// Tabs que NÃO mostram o banner
const SEM_BANNER = new Set(['agenda', 'marketing', 'documentos', 'fotografia', 'reuniao', 'sala_reuniao', 'ia']);

function renderBannerEl(banner) {
  if (banner.tipo === 'video') {
    // loop SÓ quando é o único banner; com vários, sem loop pra o evento 'ended' disparar e avançar
    const loop = bannerImagens.length <= 1 ? 'loop' : '';
    return `<video class="banner-video" autoplay ${loop} muted playsinline src="${banner.mediaUrl}"></video>`;
  }
  const src = banner.mediaUrl || banner.imagem;
  return `<img src="${src}" class="banner-img" alt="Banner">`;
}

function atualizarBanner() {
  const mostrar = !SEM_BANNER.has(categoriaAtiva) && bannerImagens.length > 0;
  bannerEl.hidden = !mostrar;
  if (mostrar && !bannerEl.children.length) {
    bannerEl.innerHTML = renderBannerEl(bannerImagens[bannerIdx]);
    agendarProximoBanner(); // DOM já tem o elemento — listener de 'ended' vai funcionar
  }
}

function avancarBanner() {
  if (bannerImagens.length <= 1) return;
  bannerEl.style.opacity = '0';
  setTimeout(() => {
    bannerIdx = (bannerIdx + 1) % bannerImagens.length;
    bannerEl.innerHTML = renderBannerEl(bannerImagens[bannerIdx]);
    bannerEl.style.opacity = '1';
    agendarProximoBanner();
  }, 400);
}

function agendarProximoBanner() {
  clearTimeout(window.__bannerTimer);
  if (bannerImagens.length <= 1) return;
  const banner = bannerImagens[bannerIdx];

  if (banner.tipo === 'video') {
    // MP4: avança quando o vídeo terminar
    const video = bannerEl.querySelector('.banner-video');
    if (video) video.addEventListener('ended', avancarBanner, { once: true });
  } else if (banner.tipo === 'gif' && banner.duracao) {
    // GIF: avança após 1 loop completo (duração calculada dos frames)
    window.__bannerTimer = setTimeout(avancarBanner, banner.duracao);
  } else {
    // PNG/JPG: 30 segundos fixos
    window.__bannerTimer = setTimeout(avancarBanner, 30000);
  }
}

function iniciarRotacaoBanner() {
  bannerIdx = 0;
  // agendarProximoBanner é chamado por atualizarBanner após renderizar o DOM
}

// ─── Status dos apps (avisos de instabilidade postados pelo admin) ────────
async function carregarStatusApps() {
  try {
    const r = await listarStatusApps();
    statusApps = r.data.status || {};
  } catch (e) {
    console.warn('Status apps:', e);
    statusApps = {};
  }
}

// ─── Abrir app (com ou sem autologin) ────────────────────────────────────
async function abrirApp(siteKey) {
  const app = APPS.find(a => a.key === siteKey);
  if (!app) return;

  // Status: bloqueia (Indisponível/Em manutenção) ou avisa (Instável)
  const statusAtual = statusApps[siteKey];
  if (statusAtual) {
    if (statusAtual === 'Indisponível' || statusAtual === 'Em manutenção') {
      const icone = statusAtual === 'Em manutenção' ? '🔧' : '⛔';
      alert(`${icone} ${statusAtual}\n\nEste sistema está ${statusAtual.toLowerCase()} no momento. Tente novamente mais tarde.`);
      return;
    }
    // Instável: avisa mas permite abrir
    if (!confirm(`⚠️ Instável\n\nEste sistema pode apresentar instabilidade agora. Deseja abrir mesmo assim?`)) return;
  }

  // Registra o acesso (não bloqueia a abertura)
  registrarAcesso({ siteKey, titulo: app.titulo }).catch(() => {});

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
    usuarioInfo.textContent = formatarNome(cfgNome.value) || cfgEmail.value;
    mostrarMsgCfg('Salvo!', true);
  } catch (e) {
    mostrarMsgCfg('Erro: ' + e.message, false);
  } finally {
    cfgSalvar.disabled = false;
  }
});

// Alterar senha — envia link de redefinição para o email da conta
cfgAlterarSenha.addEventListener('click', async () => {
  const email = cfgEmail.value;
  if (!email) { mostrarMsgCfg('Email não disponível.', false); return; }
  if (!confirm(`Enviar um link de redefinição de senha para ${email}?`)) return;
  cfgAlterarSenha.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    mostrarMsgCfg('Link enviado! Verifique seu email.', true);
  } catch (e) {
    mostrarMsgCfg('Erro: ' + e.message, false);
  } finally {
    cfgAlterarSenha.disabled = false;
  }
});

// Verificar atualização — força a checagem de update via main process
cfgVerificarUpdate.addEventListener('click', async () => {
  cfgVerificarUpdate.disabled = true;
  const txtOrig = cfgVerificarUpdate.textContent;
  cfgVerificarUpdate.textContent = 'Verificando...';
  try {
    const r = await window.hubApi.verificarAtualizacao();
    if (r?.disponivel) {
      mostrarMsgCfg(`Atualização ${r.versao} encontrada! Baixando...`, true);
    } else if (r?.erro) {
      mostrarMsgCfg('Não foi possível verificar agora.', false);
    } else {
      mostrarMsgCfg('Você já está na versão mais recente.', true);
    }
  } catch (e) {
    mostrarMsgCfg('Não foi possível verificar agora.', false);
  } finally {
    cfgVerificarUpdate.disabled = false;
    cfgVerificarUpdate.textContent = txtOrig;
  }
});

// ─── Auth + topbar ───────────────────────────────────────────────────────
btnAdmin.addEventListener('click', () => window.hubApi.abrirAdmin());
btnSair.addEventListener('click', async () => {
  if (currentUid) await setDoc(doc(db, 'user_presence', currentUid), { online: false, updatedAt: fsTs() }, { merge: true }).catch(() => {});
  await signOut(auth);
});

// Exibe a versão do app ao lado da logo (e na aba Configurações)
window.hubApi.getAppVersion().then(v => {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = 'v' + v;
  if (cfgVersaoInfo) cfgVersaoInfo.textContent = 'Versão atual: v' + v;
}).catch(() => {});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.hubApi.voltarParaLogin();
    return;
  }
  currentUid = user.uid;
  usuarioInfo.textContent = formatarNome(user.displayName) || user.email;

  // Marca presença online + heartbeat a cada 2 min
  const marcarOnline = () => setDoc(doc(db, 'user_presence', user.uid), { online: true, updatedAt: fsTs() }, { merge: true }).catch(() => {});
  marcarOnline();
  clearInterval(window.__presenceTimer);
  window.__presenceTimer = setInterval(marcarOnline, 120000);

  const tokenResult = await user.getIdTokenResult(true); // force refresh pra pegar claims atualizadas (ex: nova promoção a admin)
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
    temDrivesFotografia = !!perm.data.drives_fotografia;
    if (perm.data.isAdmin) isAdmin = true;
  } catch (e) {
    console.warn('Permissões:', e);
    appsPermitidos = [];
  }
  await Promise.all([carregarStatusApps(), carregarBanner()]); // carrega dados antes de renderizar
  renderSidebar(); // re-render: agora que isAdmin/permissões chegaram, itens restritos (ClickSign) aparecem
  renderCentro();
  carregarPerfil(); // popula o avatar no topo

  // Atualiza os avisos de instabilidade a cada 3 min (sem precisar relogar)
  clearInterval(window.__statusTimer);
  window.__statusTimer = setInterval(async () => {
    const antes = JSON.stringify(statusApps);
    await carregarStatusApps();
    if (JSON.stringify(statusApps) !== antes) renderCentro();
  }, 180000);

  // Atualiza banners a cada 3 min (para pegar banners novos sem relogar)
  clearInterval(window.__bannerTimer2);
  window.__bannerTimer2 = setInterval(async () => {
    const antesLen = bannerImagens.length;
    await carregarBanner();
    if (bannerImagens.length !== antesLen) atualizarBanner();
  }, 180000);

  // fix 2: busca status Google antes de carregar eventos para incluir eventos do Google no mini calendário desde o início
  await atualizarStatusGoogle();
  await carregarEventos(new Date(Date.now() - 86400000), new Date(Date.now() + 1000 * 60 * 60 * 24 * 90));
  renderPainelAgenda();
  if (categoriaAtiva === 'agenda') renderCalendarioCompleto();
  verificarAlertas();
  // Bug 1: limpa timers anteriores antes de criar novos (evita duplicação ao voltar do Admin)
  clearInterval(window.__alertaTimer);
  window.__alertaTimer = setInterval(verificarAlertas, 30000);

  // Avisos do admin: mostra os não confirmados ao abrir + checa a cada 3 min
  btnAviso.hidden = !isAdmin;
  verificarNotificacoes();
  clearInterval(window.__notifTimer);
  window.__notifTimer = setInterval(verificarNotificacoes, 180000);

  // Sininho de fichas: carrega ao entrar e atualiza a cada 3 min
  atualizarNotifFichas();
  clearInterval(window.__notifFichasTimer);
  window.__notifFichasTimer = setInterval(atualizarNotifFichas, 180000);
});

// ─── Agenda ────────────────────────────────────────────────────────────────
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// Eventos do Google podem vir com HTML na descrição (ex: <b>, <br>) — limpa antes de exibir como texto puro.
function stripHtml(s){ return String(s).replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div)>/gi,'\n').replace(/<[^>]*>/g,'').trim(); }

function badgeStatus(status) {
  if (!status) return '';
  const cfg = {
    'Instável':       { icone: '⚠', cor: '#b45309', bg: '#fef3c7' },
    'Em manutenção':  { icone: '🔧', cor: '#9a3412', bg: '#ffedd5' },
    'Indisponível':   { icone: '⛔', cor: '#991b1b', bg: '#fee2e2' }
  };
  const c = cfg[status] || { icone: '⚠', cor: '#6b7280', bg: '#f3f4f6' };
  return `<span class="card-aviso" style="color:${c.cor};background:${c.bg};border:1px solid ${c.cor}40">${c.icone} ${escapeHtml(status)}</span>`;
}
// Padroniza nome: "ALEXANDRE gutierres" → "Alexandre Gutierres". Email/uid ficam como estão.
function formatarNome(nome){
  const s = String(nome || '').trim();
  if (!s || s.includes('@')) return s;
  return s.toLowerCase().split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}
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
    const googleEvs = evs.filter(e => e.origem === 'google');
    const pendentesEvs = evs.filter(e => e.meuRsvp === 'pendente' && !e.souDono && e.origem !== 'google');
    const pendentesIds = new Set(pendentesEvs.map(e => e.id));
    const hubNormais = evs.filter(e => e.origem !== 'google' && !pendentesIds.has(e.id));
    const pontoHtml = evs.length ? `<span class="cal-pontos">` +
      (hubNormais.length ? `<span class="cal-ponto">${hubNormais.length > 1 ? hubNormais.length : ''}</span>` : '') +
      (pendentesEvs.length ? `<span class="cal-ponto-pendente">${pendentesEvs.length > 1 ? pendentesEvs.length : ''}</span>` : '') +
      (googleEvs.length ? `<span class="cal-ponto-google"></span>` : '') +
      `</span>` : '';
    html += `<button class="cal-dia ${chave===hojeChave?'hoje':''} ${chave===diaSelecionado?'sel':''} ${evs.length?'tem-ev':''} ${fer?'feriado':''}" data-dia="${chave}"${fer?` title="${escapeHtml(fer)}"`:''}>
      <span class="cal-num">${dia}</span>${pontoHtml}${(fer && !mini)?`<span class="cal-feriado">${escapeHtml(fer)}</span>`:''}
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
        <div class="ev-titulo">${iconeTipo(e.tipo)} ${escapeHtml(e.titulo)} ${e.todos?'<span class="ev-tag">todos</span>':''}${e.meuRsvp==='pendente'&&!e.souDono?'<span class="ev-tag ev-tag-pendente">convite</span>':''}</div>
      </div>`).join('');
}

async function renderCalendarioCompleto(){
  // fix 3: se já está renderizando, guarda o pedido e re-renderiza ao terminar
  if (renderizandoCal) { renderCalPendente = true; return; }
  renderizandoCal = true;
  renderCalPendente = false;
  try {
  if(calAno == null){ const h=new Date(); calAno=h.getFullYear(); calMes=h.getMonth(); }
  if(!diaSelecionado) diaSelecionado = chaveDia(new Date()); // detalhe sempre visível (sem "pulo")
  await carregarFeriados(calAno);
  await carregarEventos(new Date(calAno, calMes-1, 1), new Date(calAno, calMes+2, 0));
  calTitulo.textContent = `${MESES[calMes]} ${calAno}`;
  document.getElementById('calHoje').hidden = (diaSelecionado === chaveDia(new Date()));
  calGrade.innerHTML = montarGradeMes(calAno, calMes);
  calGrade.querySelectorAll('.cal-dia[data-dia]').forEach(b=>{
    b.addEventListener('click', ()=>{ diaSelecionado = b.dataset.dia; renderCalendarioCompleto(); });
  });
  renderDetalheDia();
  renderPainelAgenda();
  } finally {
    renderizandoCal = false;
    if (renderCalPendente) renderCalendarioCompleto();
  }
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
    ${evs.length ? evs.map(e => {
      const pendente = e.meuRsvp === 'pendente' && !e.souDono && e.origem !== 'google';
      // Lista de participantes com status RSVP (só pra quem criou o evento)
      const rsvpLista = (e.souDono && e.rsvp && Object.keys(e.rsvp).length > 1)
        ? `<div class="ev-rsvp-lista">${Object.entries(e.rsvp).filter(([uid]) => uid !== currentUid).map(([uid, st]) => {
            const nome = escapeHtml(formatarNome((e.participantesNomes && e.participantesNomes[uid]) || uid));
            const badge = st === 'aceito' ? 'rsvp-aceito' : st === 'recusado' ? 'rsvp-recusado' : 'rsvp-pendente';
            const icone = st === 'aceito' ? '✓' : st === 'recusado' ? '✗' : '?';
            return `<span class="rsvp-badge ${badge}">${nome} ${icone}</span>`;
          }).join('')}</div>` : '';
      // Botões aceitar/recusar para quem foi convidado e ainda não respondeu
      const rsvpBtns = pendente
        ? `<div class="ev-rsvp-btns"><button class="btn-rsvp btn-rsvp-aceitar" data-id="${e.id}">✓ Aceitar</button><button class="btn-rsvp btn-rsvp-recusar" data-id="${e.id}">✗ Recusar</button></div>`
        : (e.meuRsvp === 'recusado' && !e.souDono && e.origem !== 'google'
            ? `<div class="ev-rsvp-btns"><button class="btn-rsvp btn-rsvp-aceitar" data-id="${e.id}">✓ Aceitar</button></div>`
            : '');
      return `
      <div class="ev-item${pendente ? ' ev-pendente' : ''}">
        <div class="ev-quando">${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="ev-corpo">
          <div class="ev-titulo">${iconeTipo(e.tipo)} ${escapeHtml(e.titulo)} ${e.todos?'<span class="ev-tag">todos</span>':''} ${e.origem==='google'?'<span class="ev-tag ev-tag-google">Google</span>':''}</div>
          ${e.descricao?`<div class="ev-desc">${escapeHtml(stripHtml(e.descricao))}</div>`:''}
          ${rsvpLista}${rsvpBtns}
        </div>
        ${(e.souDono||isAdmin) && e.origem!=='google'?`<div class="ev-acoes"><button class="ev-edit" data-id="${e.id}" title="Editar">✎</button><button class="ev-del" data-id="${e.id}" title="Excluir">✕</button></div>`:''}
      </div>`;
    }).join('') : '<p class="muted">Nada nesse dia.</p>'}
  `;
  calDiaDetalhe.querySelector('#btnNovoNoDia')?.addEventListener('click', ()=> abrirModalEvento(diaSelecionado));
  calDiaDetalhe.querySelectorAll('.ev-edit').forEach(b=>{
    b.addEventListener('click', ()=>{
      const ev = eventos.find(x=>x.id===b.dataset.id);
      if(ev) abrirModalEvento(diaSelecionado, ev);
    });
  });
  calDiaDetalhe.querySelectorAll('.ev-del').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Excluir este compromisso?')) return;
      try { await excluirEvento({ id: b.dataset.id }); eventos = eventos.filter(e=>e.id!==b.dataset.id); renderCalendarioCompleto(); }
      catch(e){ alert('Erro: '+e.message); }
    });
  });
  // Listeners dos botões de RSVP (aceitar / recusar convite)
  calDiaDetalhe.querySelectorAll('.btn-rsvp').forEach(b => {
    b.addEventListener('click', async () => {
      const status = b.classList.contains('btn-rsvp-aceitar') ? 'aceito' : 'recusado';
      b.disabled = true;
      try {
        await responderConvite({ eventoId: b.dataset.id, status });
        // Atualiza localmente sem precisar rebuscar tudo
        const ev = eventos.find(e => e.id === b.dataset.id);
        // Bug 4: só atualiza estado local se currentUid já foi definido
        if (ev && currentUid) { ev.meuRsvp = status; if (!ev.rsvp) ev.rsvp = {}; ev.rsvp[currentUid] = status; }
        renderDetalheDia();
        renderPainelAgenda();
      } catch(e) { alert('Erro: ' + e.message); b.disabled = false; }
    });
  });
}

function iconeTipo(tipo){
  const p = tipo === 'tarefa' ? '<path d="M20 6 9 17l-5-5"/>'
    : tipo === 'lembrete' ? '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'
    : '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>';
  return `<svg class="ev-tipo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

async function abrirModalEvento(diaPre, eventoEditar) {
  eventoEditandoId = eventoEditar ? eventoEditar.id : null;
  const titulo = document.getElementById('modalEventoTitulo');
  const btnSalvar = modalEvento.querySelector('[type="submit"]');
  if (titulo) titulo.textContent = eventoEditar ? 'Editar compromisso' : 'Criar';
  if (btnSalvar) btnSalvar.textContent = eventoEditar ? 'Salvar alterações' : 'Salvar';

  // 1. Preenche os campos (vazio pra criar, ou com os dados do evento pra editar)
  document.getElementById('evTitulo').value = eventoEditar ? eventoEditar.titulo : '';
  document.getElementById('evDesc').value = eventoEditar ? (eventoEditar.descricao || '') : '';
  if (eventoEditar) {
    document.getElementById('evHora').value = eventoEditar.inicio.toTimeString().slice(0,5);
    document.getElementById('evData').value = chaveDia(eventoEditar.inicio);
  } else {
    document.getElementById('evHora').value = '09:00';
    document.getElementById('evData').value = diaPre || chaveDia(new Date());
  }

  const radioTipo = document.querySelector(`input[name="evTipo"][value="${eventoEditar ? (eventoEditar.tipo||'evento') : 'evento'}"]`);
  if(radioTipo) radioTipo.checked = true;

  // 2. ABRE O MODAL IMEDIATAMENTE (O usuário já vê a tela)
  modalEvento.showModal();

  // 3. Força o foco com um pequeno atraso (Resolve o bug do Chromium ignorar o cursor)
  setTimeout(() => {
    document.getElementById('evTitulo').focus();
  }, 50);

  // 4. Participantes — só no modo criar (editar participantes exigiria resetar RSVP, fora de escopo)
  const area = document.getElementById('evParticipantesArea');
  const todosLabel = document.getElementById('evTodosLabel');
  const chkTodos = document.getElementById('evTodos');
  if (chkTodos) chkTodos.checked = false;

  if (eventoEditar) {
    area.hidden = true;
    return;
  }
  area.hidden = false;
  if (todosLabel) todosLabel.hidden = false;

  const cont = document.getElementById('evPessoas');
  if (!pessoasCache || (Date.now() - pessoasCacheAt) > 300000) {
    cont.innerHTML = '<p class="muted" style="font-size:12px">carregando...</p>';
    try {
      const r = await listarPessoas();
      pessoasCache = r.data || [];
      pessoasCacheAt = Date.now();
    } catch(e) {
      // Bug 6: fecha o modal antes de mostrar o erro — evita modal aberto sem conteúdo
      modalEvento.close();
      alert('Não foi possível carregar a lista de participantes: ' + e.message);
      return;
    }
  }

  // Remove o próprio usuário da lista (já é incluído automaticamente pelo servidor)
  const outros = pessoasCache.filter(p => p.uid !== currentUid);
  cont.innerHTML = outros.length
    ? outros.map(p => `<label class="auth-label-inline"><input type="checkbox" value="${p.uid}"> ${escapeHtml(formatarNome(p.nome))}</label>`).join('')
    : '<p class="muted" style="font-size:12px">Nenhuma outra pessoa cadastrada.</p>';

  // Rebuilding innerHTML pode roubar o foco — devolve pro título se necessário
  const focado = document.activeElement;
  if (!focado || !modalEvento.contains(focado) || focado === document.body) {
    document.getElementById('evTitulo').focus();
  }
}

function verificarAlertas(){
  // Não interrompe com alerta enquanto a pessoa está num modal (ex.: criando compromisso)
  if (document.querySelector('dialog[open]')) return;
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
document.getElementById('calPrev').addEventListener('click', async (e) => { 
  const b = e.currentTarget;
  b.disabled = true; // Trava o botão
  calMes--; 
  if(calMes < 0) { calMes = 11; calAno--; } 
  try { 
    await renderCalendarioCompleto(); 
  } finally { 
    b.disabled = false; // Destrava quando o Firebase responder
  }
});

document.getElementById('calProx').addEventListener('click', async (e) => { 
  const b = e.currentTarget;
  b.disabled = true; // Trava o botão
  calMes++; 
  if(calMes > 11) { calMes = 0; calAno++; } 
  try { 
    await renderCalendarioCompleto(); 
  } finally { 
    b.disabled = false; // Destrava quando o Firebase responder
  }
});

document.getElementById('calHoje').addEventListener('click', ()=>{ const h=new Date(); calAno=h.getFullYear(); calMes=h.getMonth(); diaSelecionado=chaveDia(h); renderCalendarioCompleto(); });
document.getElementById('calRecarregar').addEventListener('click', async (e)=>{
  const b = e.currentTarget; const t = b.textContent;
  b.disabled = true; b.textContent = '↻ Atualizando...';
  try { await renderCalendarioCompleto(); } finally { b.disabled = false; b.textContent = t; }
});
document.getElementById('evTodos').addEventListener('change', (e)=>{ document.getElementById('evPessoas').style.opacity = e.target.checked ? '0.4' : '1'; });

// ─── Conectar / desconectar a Google Agenda ──────────────────────────────────
const btnGoogleAgenda = document.getElementById('btnGoogleAgenda');
let googleConectado = false;

const SVG_CAL_BTN = '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/></svg>';
const SVG_CHECK_BTN = '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
function pintarBotaoGoogle(conectado, email){
  googleConectado = conectado;
  if(conectado){
    btnGoogleAgenda.classList.add('google-on');
    btnGoogleAgenda.innerHTML = SVG_CAL_BTN + 'Google' + SVG_CHECK_BTN;
    btnGoogleAgenda.title = email ? `Conectado: ${email} — clique para desconectar` : 'Conectado — clique para desconectar';
  } else {
    btnGoogleAgenda.classList.remove('google-on');
    btnGoogleAgenda.innerHTML = SVG_CAL_BTN + 'Conectar Google';
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
    if(!googleConectado) pintarBotaoGoogle(false, ''); // fix 1: restaura HTML completo (com SVG), não só texto
  }
});

document.getElementById('formEvento').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const titulo = document.getElementById('evTitulo').value.trim();
  const data = document.getElementById('evData').value;
  const hora = document.getElementById('evHora').value;
  const descricao = document.getElementById('evDesc').value.trim();
  if(!titulo || !data || !hora) return;
  const btnSalvar = e.target.querySelector('[type="submit"]');
  btnSalvar.disabled = true;
  const tipo = (document.querySelector('input[name="evTipo"]:checked') || {}).value || 'evento';
  const payload = { titulo, inicio: new Date(data + 'T' + hora).toISOString(), descricao, tipo, dataLocal: data };
  try {
    if (eventoEditandoId) {
      await editarEvento({ id: eventoEditandoId, ...payload });
    } else {
      if(document.getElementById('evTodos').checked && isAdmin) {
        payload.todos = true;
      } else {
        const selecionados = Array.from(document.querySelectorAll('#evPessoas input:checked')).map(c => c.value);
        if(selecionados.length) payload.participantes = selecionados;
      }
      await criarEvento(payload);
    }
    modalEvento.close();
    await carregarEventos(new Date(Date.now()-86400000), new Date(Date.now()+1000*60*60*24*90));
    renderPainelAgenda();
    if(categoriaAtiva==='agenda') renderCalendarioCompleto();
  } catch(err){ alert('Erro ao salvar: '+err.message); }
  finally { btnSalvar.disabled = false; }
});

// Abrir a pasta no Drive (pra admin gerenciar / ou visualizar completo)
if (btnAbrirDrive) btnAbrirDrive.addEventListener('click', () => window.open(DRIVE_FOLDER_URL, '_blank'));

// Abrir template de marketing numa janela dedicada
document.getElementById('secaoMarketing').addEventListener('click', (e) => {
  // Navegação do carrossel
  const navBtn = e.target.closest('.mkt-nav-btn');
  if (navBtn) {
    const carousel = navBtn.closest('.mkt-carousel-wrap').querySelector('.mkt-carousel');
    const passo = 220 + 14; // largura do card + gap
    carousel.scrollBy({ left: navBtn.classList.contains('mkt-next') ? passo : -passo, behavior: 'smooth' });
    return;
  }
  const card = e.target.closest('.mkt-card');
  if (!card) return;
  window.hubApi.abrirTemplate(card.dataset.template);
});

// Atualiza estado dos botões ‹ › ao scrollar
document.getElementById('secaoMarketing').addEventListener('scroll', (e) => {
  atualizarNavMarketing(e.target);
}, true);

function atualizarNavMarketing(carousel) {
  if (!carousel.classList.contains('mkt-carousel')) return;
  const wrap = carousel.closest('.mkt-carousel-wrap');
  if (!wrap) return;
  const prev = wrap.querySelector('.mkt-prev');
  const next = wrap.querySelector('.mkt-next');
  if (prev) prev.disabled = carousel.scrollLeft <= 0;
  if (next) next.disabled = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2;
}

// Estado inicial dos botões ao abrir a aba
function iniciarCarrosseis() {
  document.querySelectorAll('.mkt-carousel').forEach(c => atualizarNavMarketing(c));
}

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
  document.getElementById('avisoTitulo').textContent = av.titulo || 'Aviso';
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
  if(filaAvisos.length) mostrarProximoAviso(); else { modalAviso.close(); verificarNotificacoes(); }
});

async function verificarNotificacoes(){
  // Bug 5: evita chamadas concorrentes que duplicariam avisos na fila
  if (verificandoNotif) return;
  if (document.querySelector('dialog[open]')) return;
  verificandoNotif = true;
  try {
    const r = await listarMinhasNotificacoes();
    const novos = r.data || [];
    if(!novos.length) return;
    const naFila = new Set(filaAvisos.map(a => a.id));
    novos.forEach(n => { if(!naFila.has(n.id)) filaAvisos.push(n); });
    mostrarProximoAviso();
  } catch(e){ console.warn('Notificações:', e); }
  finally { verificandoNotif = false; }
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
    if(!pessoasCache){ const r = await listarPessoas(); pessoasCache = r.data || []; pessoasCacheAt = Date.now(); } // fix 5: atualiza timestamp do cache
    cont.innerHTML = pessoasCache.filter(p => p.uid !== currentUid).map(p => `
      <label class="auth-label-inline"><input type="checkbox" value="${p.uid}"> ${escapeHtml(formatarNome(p.nome))}</label>`).join('');
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

// ─── Treinamento ──────────────────────────────────────────────────────────────
async function carregarTreinamento() {
  secaoTreinamento.innerHTML = '<p class="muted" style="padding:20px">Carregando...</p>';
  try {
    const r = await getTreinamentoLinks();
    treinamentoLinks = r.data.links || {};
  } catch (e) {
    console.warn('Treinamento links:', e);
    treinamentoLinks = {};
  }
  renderTreinamento();
}

function renderTreinamento() {
  const iconesTipo = { video: '▶', pdf: '📄', drive: '📁', link: '🔗' };

  const appUniv = APPS.find(a => a.key === 'universidade');
  const statusUniv = statusApps['universidade'] ? badgeStatus(statusApps['universidade']) : '';

  secaoTreinamento.innerHTML = `
    <div class="trein-wrap">
      ${appUniv ? `
      <button class="hub-card trein-univ-card ${statusApps['universidade'] ? 'com-aviso' : ''}" id="btnUniversidade">
        <span class="card-icon">
          <img class="card-icon-img" src="app-icons/universidade.png" alt="" onerror="this.remove()">
          ${appUniv.icone}
        </span>
        <span class="card-title">${appUniv.titulo}</span>
        <span class="card-desc">${appUniv.desc}</span>
        ${statusUniv}
      </button>` : ''}
      <div class="trein-header">
        <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v4.5c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5V12"/></svg>
        Materiais de Treinamento
      </div>
      <div class="trein-lista">
        ${TREINAMENTO_CATS.map(cat => {
          const aberta = treinamentoCatAberta === cat.id;
          const totalLinks = cat.itens.filter(it => treinamentoLinks[it.id]?.url).length;
          return `
            <div class="trein-cat ${aberta ? 'aberta' : ''}" data-cat="${cat.id}">
              <button class="trein-cat-btn">
                <span class="trein-cat-emoji">${cat.emoji}</span>
                <span class="trein-cat-nome">${cat.nome}</span>
                ${totalLinks ? `<span class="trein-badge">${totalLinks}/${cat.itens.length}</span>` : ''}
                <svg class="trein-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div class="trein-itens">
                ${cat.itens.map(item => {
                  const link = treinamentoLinks[item.id];
                  return `
                    <div class="trein-item ${link ? 'tem-link' : ''}" data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}" data-nome="${escapeHtml(item.nome)}">
                      <span class="trein-item-ico">${link ? (iconesTipo[link.tipo] || '🔗') : '○'}</span>
                      <span class="trein-item-nome">${escapeHtml(item.nome)}</span>
                      ${link ? '<span class="trein-item-abrir">Abrir →</span>' : '<span class="trein-item-em-breve">Em breve</span>'}
                      ${isAdmin ? `<button class="trein-item-editar" data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}" data-tipo="${link?.tipo || 'link'}" title="Editar link">✎</button>` : ''}
                    </div>`;
                }).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // Card Universidade REMAX
  document.getElementById('btnUniversidade')?.addEventListener('click', () => abrirApp('universidade'));

  // Acordeon — toggle categoria
  secaoTreinamento.querySelectorAll('.trein-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.closest('.trein-cat').dataset.cat;
      treinamentoCatAberta = treinamentoCatAberta === catId ? null : catId;
      renderTreinamento();
    });
  });

  // Abrir item com link
  secaoTreinamento.querySelectorAll('.trein-item.tem-link').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('trein-item-editar')) return;
      const url = el.dataset.url;
      if (url) window.open(url, '_blank');
    });
  });

  // Editar link (admin inline)
  secaoTreinamento.querySelectorAll('.trein-item-editar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirEdicaoTreinamento(btn.dataset.item, btn.dataset.url, btn.dataset.tipo);
    });
  });
}

// Seletor de arquivo reutilizável pra upload de treinamento
let _treinUploadTarget = null;
const _treinFileInput = (() => {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = '.pdf,.mp4,.mov,.pptx,.docx,image/*';
  el.style.display = 'none';
  document.body.appendChild(el);
  el.addEventListener('change', async () => {
    const file = el.files[0];
    el.value = '';
    if (!file || !_treinUploadTarget) return;
    const { itemId, urlAnterior, rowEl } = _treinUploadTarget;
    _treinUploadTarget = null;

    const ext = file.name.split('.').pop().toLowerCase();
    const tipo = ext === 'pdf' ? 'pdf' : ['mp4','mov','avi'].includes(ext) ? 'video' : 'link';

    // Mostra progresso inline no item
    const editBtn = rowEl?.querySelector('.trein-item-editar');
    if (editBtn) { editBtn.textContent = '0%'; editBtn.disabled = true; }

    try {
      if (urlAnterior && urlAnterior.includes('firebasestorage')) {
        try { await deleteObject(storageRef(storage, urlAnterior)); } catch (_) {}
      }
      const sRef = storageRef(storage, `treinamentos/${itemId}/${Date.now()}_${file.name}`);
      const task = uploadBytesResumable(sRef, file);

      await new Promise((resolve, reject) => {
        task.on('state_changed',
          snap => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            if (editBtn) editBtn.textContent = pct + '%';
          },
          reject, resolve
        );
      });

      const url = await getDownloadURL(task.snapshot.ref);
      await setTreinamentoLink({ itemId, url, tipo });
      carregarTreinamento();
    } catch (e) {
      if (editBtn) { editBtn.textContent = '✎'; editBtn.disabled = false; }
      alert('Erro no upload: ' + e.message);
    }
  });
  return el;
})();

function abrirEdicaoTreinamento(itemId, urlAtual) {
  const rowEl = secaoTreinamento.querySelector(`[data-item="${itemId}"]`);
  _treinUploadTarget = { itemId, urlAnterior: urlAtual, rowEl };
  _treinFileInput.click();
}

// ─── Fotografia ───────────────────────────────────────────────────────────────
let fotoPessoasCache = null;     // lista de pessoas+links (só pra quem gerencia)
let fotoVisaoUsuario = false;    // gestor pré-visualizando como usuário comum

async function carregarFotografia() {
  fotoVisaoUsuario = false; // fix B: sempre abre a aba na visão de gestão (não gruda o preview)
  secaoFotografia.innerHTML = '<p class="muted" style="padding:20px">Carregando...</p>';
  try {
    const r = await getFotoDrives();
    if (r.data.gerenciar) {
      fotoPessoasCache = r.data.pessoas || [];
      renderFotografiaGestor();
    } else {
      fotoPessoasCache = null;
      renderFotoPessoal(r.data.driveLink || '');
    }
  } catch (e) {
    secaoFotografia.innerHTML = `<p style="padding:20px;color:var(--danger)">Erro: ${escapeHtml(e.message)}</p>`;
  }
}

// Decide o que mostrar pra quem gerencia: tabela de gestão ou visão de usuário comum
function renderFotografiaGestor() {
  if (fotoVisaoUsuario) {
    const eu = (fotoPessoasCache || []).find(p => p.uid === currentUid);
    renderFotoPessoal(eu ? eu.driveLink : '', true);
  } else {
    renderFotoGerenciar(fotoPessoasCache || []);
  }
}

// Barra com o botão de alternar visão (só aparece pra quem gerencia)
function barraToggleFoto() {
  return `
    <div class="foto-toggle-bar">
      <button class="topbar-btn" id="btnToggleFotoVisao">${fotoVisaoUsuario ? '← Voltar para gestão' : '👁 Ver como usuário'}</button>
      ${fotoVisaoUsuario ? '<span class="muted" style="font-size:11px">Pré-visualização — assim um usuário comum enxerga esta aba.</span>' : ''}
    </div>`;
}
function ligarToggleFoto() {
  document.getElementById('btnToggleFotoVisao')?.addEventListener('click', () => {
    fotoVisaoUsuario = !fotoVisaoUsuario;
    renderFotografiaGestor();
  });
}

function linkParaEmbedDrive(link) {
  const m = (link || '').match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? `https://drive.google.com/embeddedfolderview?id=${m[1]}#grid` : null;
}

// Card de agendamento de fotografia — aparece pra todos no topo da aba.
// A pessoa agenda direto na própria visualização (sem abrir janela nova).
function cardAgendamentoFoto() {
  return `
    <div class="foto-agendar">
      <h3 class="foto-agendar-titulo"><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/></svg>Agende sua fotografia <span class="muted" style="font-weight:400;font-size:12px">— escolha um horário disponível abaixo</span></h3>
      <iframe class="foto-agendar-frame" src="${AGENDA_FOTOGRAFIA_URL}" title="Agendar fotografia"></iframe>
    </div>`;
}

function renderFotoPessoal(driveLink, gestorPreview = false) {
  const topo = gestorPreview ? barraToggleFoto() : '';
  if (!driveLink) {
    secaoFotografia.innerHTML = topo + cardAgendamentoFoto() + `
      <div class="foto-vazio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <p>Nenhuma pasta de fotos foi atribuída a você ainda.</p>
      </div>`;
    if (gestorPreview) ligarToggleFoto();
    return;
  }
  const embedUrl = linkParaEmbedDrive(driveLink);
  secaoFotografia.innerHTML = topo + cardAgendamentoFoto() + `
    <div class="docs-painel">
      <div class="docs-painel-head">
        <span><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Minha pasta de fotos</span>
        <span style="display:flex;gap:6px">
          ${embedUrl ? '<button class="topbar-btn" id="btnAtualizarFoto" title="Recarregar a pasta pra ver fotos novas">↻ Atualizar</button>' : ''}
          <button class="topbar-btn" id="btnAbrirFotoDrive">Abrir no Drive ↗</button>
        </span>
      </div>
      ${embedUrl
        ? `<iframe id="fotoDriveFrame" class="drive-frame" src="${escapeHtml(embedUrl)}" title="Pasta de fotos"></iframe>`
        : `<div class="foto-vazio" style="border:none"><p>Link configurado. Clique em "Abrir no Drive" pra acessar.</p></div>`}
    </div>`;
  if (gestorPreview) ligarToggleFoto();
  document.getElementById('btnAbrirFotoDrive')?.addEventListener('click', () => window.open(driveLink, '_blank'));
  document.getElementById('btnAtualizarFoto')?.addEventListener('click', (e) => {
    const frame = document.getElementById('fotoDriveFrame');
    if (frame) frame.src = frame.src; // recarrega o embed (puxa o conteúdo atual do Drive)
    const b = e.currentTarget; const t = b.textContent;
    b.disabled = true; b.textContent = '↻ Atualizando...';
    setTimeout(() => { b.disabled = false; b.textContent = t; }, 1200);
  });
}

function renderFotoGerenciar(pessoas) {
  secaoFotografia.innerHTML = barraToggleFoto() + `
    <div class="foto-gerenciar">
      <div class="docs-painel-head" style="border:1px solid var(--border);border-radius:var(--radius-card);margin-bottom:12px">
        <span><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Gerenciar pastas de fotografia</span>
        <span class="muted" style="font-size:11px">${pessoas.length} pessoa${pessoas.length !== 1 ? 's' : ''}</span>
      </div>
      <table class="users-table">
        <thead><tr><th>Nome</th><th>Link do Drive (pasta de fotos)</th><th></th></tr></thead>
        <tbody>
          ${pessoas.map(p => `
            <tr data-uid="${p.uid}">
              <td class="foto-nome">${escapeHtml(formatarNome(p.nome))}</td>
              <td><input class="foto-input" type="url" placeholder="https://drive.google.com/drive/folders/..." value="${escapeHtml(p.driveLink || '')}"></td>
              <td><button class="topbar-btn foto-salvar-btn">Salvar</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  ligarToggleFoto();
  secaoFotografia.querySelectorAll('tr[data-uid]').forEach(row => {
    const uid = row.dataset.uid;
    const input = row.querySelector('.foto-input');
    const btn = row.querySelector('.foto-salvar-btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const novoLink = input.value.trim();
        await setFotoDrive({ uid, driveLink: novoLink });
        // fix A: atualiza o cache local pra refletir na pré-visualização e em re-renders
        const p = (fotoPessoasCache || []).find(x => x.uid === uid);
        if (p) p.driveLink = novoLink;
        btn.textContent = '✓ Salvo';
        setTimeout(() => { btn.textContent = 'Salvar'; btn.disabled = false; }, 1800);
      } catch (e) {
        alert('Erro: ' + e.message);
        btn.textContent = 'Salvar';
        btn.disabled = false;
      }
    });
  });
}

// ─── Sala de Reunião ─────────────────────────────────────────────────────────
function carregarSalaReuniao() {
  secaoSalaReuniao.innerHTML = `
    <div class="foto-agendar">
      <h3 class="foto-agendar-titulo">
        <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        Reservar Sala de Reunião
        <span class="muted" style="font-weight:400;font-size:12px">— escolha um horário disponível abaixo</span>
      </h3>
      <iframe class="foto-agendar-frame" src="https://calendar.app.google/yhXBzwJAWq7NkJN2A" title="Sala de Reunião"></iframe>
    </div>`;
}

// ─── Reunião ─────────────────────────────────────────────────────────────────
function carregarReuniao() {
  secaoReuniao.innerHTML = `
    <div class="foto-agendar">
      <h3 class="foto-agendar-titulo">
        <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/></svg>
        Agende uma reunião
        <span class="muted" style="font-weight:400;font-size:12px">— escolha um horário disponível abaixo</span>
      </h3>
      <iframe class="foto-agendar-frame" src="${AGENDA_REUNIAO_URL}" title="Agendar reunião"></iframe>
    </div>`;
}

// ─── Fichas para análise administrativa ─────────────────────────────────────
async function carregarFichasAnalise(fichaKey = 'locador') {
  const lista = document.getElementById(`lista-${fichaKey}`);
  if (!lista) return;

  const config = FICHAS_CONFIG.find(f => f.key === fichaKey);
  if (!config?.temFirebase) {
    lista.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0">
      Integração de recebimento em breve para esta ficha.<br>
      <span style="font-size:11px">Por enquanto o cliente preenche e salva no próprio dispositivo.</span>
    </p>`;
    return;
  }

  lista.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center">Carregando fichas para análise...</p>';

  const ehLocadorAn = fichaKey === 'locador';
  const fnFinalizar = ehLocadorAn ? finalizarFichaLocador : finalizarFichaTipo;

  try {
    const res = ehLocadorAn
      ? await listarFichasParaAnalise({})
      : await listarFichasTipoAnalise({ tipo: fichaKey });
    const fichas = res.data || [];
    const nomesDoc = { rgFrente:'RG/CNH frente', rgVerso:'RG/CNH verso', compRenda:'Comp. renda', compEndereco:'Comp. endereço', matricula:'Matrícula', iptu:'IPTU' };
    const nomePend = { cpf:'CPF', rg:'RG', profissao:'Profissão', renda:'Renda', banco:'Banco', tipoConta:'Tipo conta', agencia:'Agência', conta:'Conta', pix:'Pix', rgFrente:'RG frente', rgVerso:'RG verso', compRenda:'Comp. renda', compEndereco:'Comp. endereço', matricula:'Matrícula', iptu:'IPTU' };

    if (fichas.length === 0) {
      lista.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Nenhuma ficha aguardando análise.</p>';
      return;
    }

    lista.innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${fichas.length} ficha(s) aguardando análise</p>
      ${fichas.map(f => {
        const dataEnvio = f.enviadoAdminEm ? new Date(f.enviadoAdminEm).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        const pends = (f.pendentes || []).length;
        const docs = Object.entries(f.documentos || {});
        const d = f.dados || {};
        return `
          <div class="ficha-card" data-id="${f.id}">
            <div class="ficha-card-head">
              <div>
                <strong style="font-size:13px">${d.nome || 'Sem nome'}</strong>
                <span style="font-size:11px;color:var(--text-muted);margin-left:8px">Corretor: ${f.corretorNome || '—'}</span>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">${dataEnvio}</span>
            </div>
            ${pends > 0 ? `<div style="font-size:11px;color:#b45309;margin-top:4px">⚠ Pendente: ${f.pendentes.map(p=>nomePend[p]||p).join(', ')}</div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              <button class="topbar-btn primario btn-baixar-docs" data-id="${f.id}" style="font-size:11px;padding:4px 10px">📥 Baixar documentos</button>
              <button class="topbar-btn btn-ver-dados" data-id="${f.id}" style="font-size:11px;padding:4px 10px">Ver dados ▾</button>
              <button class="topbar-btn btn-finalizar" data-id="${f.id}" style="font-size:11px;padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:var(--radius-btn)">✓ Marcar analisado</button>
            </div>
            <div id="dados-${f.id}" style="display:none;margin-top:10px;font-size:12px;border-top:1px solid var(--border);padding-top:10px">
              <div class="row-dados" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
                ${[['Nome',d.nome],['CPF',d.cpf],['RG',d.rg],['Nascimento',d.dataNasc],['Estado civil',d.estadoCivil],['Profissão',d.profissao],['Renda',d.renda],['WhatsApp',d.whatsapp],['E-mail',d.email],['CEP',d.cep],['Endereço',`${d.logradouro||''} ${d.numero||''} ${d.complemento||''}`],['Bairro',d.bairro],['Cidade',`${d.cidade||''}/${d.estado||''}`],['Banco',d.banco],['Agência',d.agencia],['Conta',`${d.conta||''} (${d.tipoConta||''})`],['Pix',d.pix]].filter(([,v])=>v).map(([k,v])=>`<div style="margin-bottom:3px"><span style="color:var(--text-muted)">${k}:</span> ${v}</div>`).join('')}
              </div>
              ${docs.length > 0 ? `<div style="margin-top:8px;font-weight:600;font-size:12px;margin-bottom:4px">Documentos:</div><div style="display:flex;flex-wrap:wrap;gap:6px">${docs.map(([k,url])=>`<a href="${url}" target="_blank" class="topbar-btn" style="font-size:11px;padding:4px 10px">${nomesDoc[k]||k} ↗</a>`).join('')}</div>` : '<p style="font-size:11px;color:var(--text-muted);margin-top:6px">Nenhum documento enviado.</p>'}
            </div>
          </div>`;
      }).join('')}`;

    // Baixar todos os documentos (abre cada um numa aba)
    lista.querySelectorAll('.btn-baixar-docs').forEach(btn => {
      btn.addEventListener('click', () => {
        const ficha = fichas.find(f => f.id === btn.dataset.id);
        const docs = Object.entries(ficha?.documentos || {});
        if (docs.length === 0) { alert('Nenhum documento disponível para download.'); return; }
        docs.forEach(([, url]) => window.open(url, '_blank'));
      });
    });

    // Ver / ocultar dados
    lista.querySelectorAll('.btn-ver-dados').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(`dados-${btn.dataset.id}`);
        const aberto = el.style.display !== 'none';
        el.style.display = aberto ? 'none' : 'block';
        btn.textContent = aberto ? 'Ver dados ▾' : 'Ocultar ▴';
      });
    });

    // Marcar como analisado
    lista.querySelectorAll('.btn-finalizar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Marcar esta ficha como analisada? Ela sairá da lista.')) return;
        btn.disabled = true; btn.textContent = 'Salvando...';
        try {
          await fnFinalizar({ fichaId: btn.dataset.id });
          const card = btn.closest('.ficha-card');
          card.style.opacity = '0';
          card.style.transition = 'opacity .3s';
          setTimeout(() => {
            card.remove();
            if (!lista.querySelector('.ficha-card')) {
              lista.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Nenhuma ficha aguardando análise.</p>';
            }
          }, 300);
        } catch(e) { alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = '✓ Marcar analisado'; }
      });
    });

  } catch(e) {
    lista.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center">Erro: ${e.message}</p>`;
  }
}

// ─── IA ──────────────────────────────────────────────────────────────────────
function carregarIA() {
  const MODELOS = [
    {
      key: 'martina', nome: 'Martina', empresa: 'REMAX Smart',
      desc: 'Assistente virtual da REMAX Smart — precisa estar logado no ChatGPT para usar',
      url: 'https://chatgpt.com/g/g-68b2625b33f481918039b79f11b5c713-martina-assistente-virtual',
      avisoLogin: true,
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><rect x="0" y="36" width="48" height="12" rx="0" fill="#DC1C2E"/><rect x="0" y="36" width="48" height="4" fill="#DC1C2E"/><text x="24" y="30" text-anchor="middle" font-size="22" font-weight="900" fill="white" font-family="Arial,sans-serif">M</text><text x="24" y="44" text-anchor="middle" font-size="8" font-weight="700" fill="white" font-family="Arial,sans-serif" letter-spacing="1">REMAX</text></svg>`
    },
    {
      key: 'gemini', nome: 'Gemini', empresa: 'Google',
      desc: 'Analisa texto, imagens e código com IA multimodal do Google',
      url: 'https://gemini.google.com/',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ia-gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285F4"/><stop offset="100%" stop-color="#00BCD4"/></linearGradient></defs><path fill="url(#ia-gm)" d="M24 4C24 15 33 23 44 24C33 25 24 34 24 44C24 34 15 25 4 24C15 23 24 15 24 4Z"/></svg>`
    },
    {
      key: 'chatgpt', nome: 'ChatGPT', empresa: 'OpenAI',
      desc: 'O modelo de IA mais usado no mundo para conversas e tarefas',
      url: 'https://chatgpt.com/',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#10a37f"/><path fill="white" transform="translate(8,8) scale(0.667)" d="M32.5 12.7a9 9 0 0 0-1.7-5.5 9.3 9.3 0 0 0-17.4 2A6.4 6.4 0 0 0 9.5 21a6.4 6.4 0 0 0 .8 3.1 6.4 6.4 0 0 0 1.3 7.5A9.3 9.3 0 0 0 29.1 29a6.4 6.4 0 0 0 3.4-5.6 6.4 6.4 0 0 0-.9-3.1 6.4 6.4 0 0 0 .9-7.6zM24 31a6.9 6.9 0 0 1-3.7-1.1l.2-.1 6.1-3.5a1 1 0 0 0 .5-.9V18l2.6 1.5v7.1A6.9 6.9 0 0 1 24 31zm-13-6.3a6.9 6.9 0 0 1-.8-4.6l.2.1 6.1 3.5a1 1 0 0 0 1 0l7.5-4.3v3L17.5 27a6.9 6.9 0 0 1-6.5-2.3zm-1-9.5a6.9 6.9 0 0 1 3.6-3v7.2a1 1 0 0 0 .5.9l7.5 4.3-2.6 1.5-6.1-3.6a6.9 6.9 0 0 1-2.9-7.3zm18.6 5.9-7.5-4.3 2.6-1.5 6.1 3.5A6.9 6.9 0 0 1 28.7 27v-7.2a1 1 0 0 0-.1-.7zm2.3-4.7-.2-.1-6.1-3.5a1 1 0 0 0-1 0l-7.5 4.3v-3L24 9.7a6.9 6.9 0 0 1 6.9 7.7z"/></svg>`
    },
    {
      key: 'claude', nome: 'Claude', empresa: 'Anthropic',
      desc: 'IA da Anthropic, destaque em redação, análise e raciocínio',
      url: 'https://claude.ai/',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#D97757"/><text x="24" y="33" text-anchor="middle" font-size="28" font-weight="700" fill="white" font-family="Georgia,serif">C</text></svg>`
    },
    {
      key: 'copilot', nome: 'Copilot', empresa: 'Microsoft',
      desc: 'IA da Microsoft integrada ao ecossistema Office e Windows',
      url: 'https://copilot.microsoft.com/',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#0078D4"/><path fill="white" d="M24 10a14 14 0 1 0 0 28 14 14 0 0 0 0-28zm0 4a10 10 0 0 1 9.9 8.7L24 24l-9.9-1.3A10 10 0 0 1 24 14zm0 20a10 10 0 0 1-9.9-8.7L24 24l9.9 1.3A10 10 0 0 1 24 34z"/></svg>`
    },
  ];

  secaoIA.innerHTML = `
    <div class="ia-grid">
      ${MODELOS.map(m => `
        <button class="ia-card" data-url="${m.url}">
          <div class="ia-icone">${m.icone}</div>
          <div class="ia-nome">${m.nome}</div>
          <div class="ia-empresa">${m.empresa}</div>
          <p class="ia-desc">${m.desc}</p>
        </button>
      `).join('')}
    </div>`;

  secaoIA.querySelectorAll('.ia-card').forEach(card => {
    card.addEventListener('click', () => {
      const modelo = MODELOS.find(m => m.url === card.dataset.url);
      if (modelo?.avisoLogin) {
        const chave = `ia_login_${modelo.key}`;
        if (!localStorage.getItem(chave)) {
          alert(`💡 Para usar a ${modelo.nome} você precisa estar logado no ChatGPT.\n\nSe ainda não fez login, entre com sua conta na janela que vai abrir.`);
          localStorage.setItem(chave, '1');
        }
      }
      window.hubApi.abrirApp({ siteKey: card.dataset.url, url: card.dataset.url, credenciais: null });
    });
  });
}

// ─── Documentos ──────────────────────────────────────────────────────────────
const BASE_HOSTING = 'https://remax-smart-hub.web.app';

// Catálogo de fichas — para adicionar nova: inclua um objeto aqui e hospede o HTML
const FICHAS_CONFIG = [
  {
    key: 'locador',
    nome: 'Ficha Cadastral do Locador',
    desc: 'Cadastro do proprietário para locação de imóveis',
    arquivo: 'ficha-locador.html',
    geraLink: true,
    temAnalise: true,   // botão "Para análise" (requer permissão analise_locador)
    temFirebase: true   // tem integração com Firestore (lista fichas recebidas)
  },
  {
    key: 'pf',
    nome: 'Ficha Cadastral Locatário (Pessoa Física)',
    desc: 'Cadastro de locatário pessoa física',
    arquivo: 'ficha-pf.html',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'pj',
    nome: 'Ficha Cadastral Locatário (Pessoa Jurídica)',
    desc: 'Cadastro de locatário pessoa jurídica',
    arquivo: 'ficha-pj.html',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'locacao_fiador',
    nome: 'Ficha Cadastral Locação com Fiador',
    desc: 'Cadastro com fiador para locação',
    arquivo: 'ficha-locacao-fiador.html',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'vendedor',
    nome: 'Ficha Cadastral Vendedor',
    desc: 'Cadastro de vendedor para transação de venda',
    arquivo: 'ficha-vendedor.html',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'proposta',
    nome: 'Ficha Proposta',
    desc: 'Proposta de compra ou locação de imóvel',
    arquivo: 'ficha-proposta.html',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'fianca',
    nome: 'Ficha Fiança',
    desc: 'Cotação de seguro fiança — preenchida pelo corretor',
    arquivo: 'ficha-fianca.html',
    geraLink: false, abrirInterno: true, temAnalise: true, temFirebase: true
  },
];

async function carregarDocumentos() {
  const nomeCorretor = encodeURIComponent(document.getElementById('usuarioInfo')?.textContent?.trim() || '');

  // Gera um accordion para cada ficha no catálogo
  secaoDocs.innerHTML = FICHAS_CONFIG.map(f => {
    const link = `${BASE_HOSTING}/${f.arquivo}?corretor=${currentUid}&nome=${nomeCorretor}`;
    return `
      <div class="docs-accordion" id="acc-${f.key}">
        <div class="docs-acc-head" data-key="${f.key}">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span class="acc-chevron">►</span>
            <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>
            <div>
              <div style="font-weight:700;font-size:13px">${f.nome}</div>
              <div style="font-size:11px;color:var(--text-muted)">${f.desc}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${f.geraLink ? `<button class="topbar-btn primario btn-link-${f.key}" data-link="${link}" style="font-size:11px">📋 Copiar link</button>` : ''}
            ${f.abrirInterno ? `<button class="topbar-btn primario btn-preencher-${f.key}" data-link="${link}" style="font-size:11px">📝 Preencher ficha</button>` : ''}
          </div>
        </div>
        <div class="docs-acc-body" id="body-${f.key}" style="display:none">
          <div class="docs-acc-aviso">
            ${f.abrirInterno
              ? 'Clique em <strong>Preencher ficha</strong> para abrir o formulário. As fichas enviadas ao admin aparecem abaixo.'
              : 'Clique em <strong>Copiar link</strong> e envie ao cliente pelo WhatsApp. As fichas recebidas aparecem abaixo.'}
          </div>
          <div id="lista-${f.key}" style="padding:12px 16px">
            <p style="font-size:12px;color:var(--text-muted);text-align:center">Carregando...</p>
          </div>
        </div>
      </div>`;
  }).join('');

  // Inicializa cada ficha
  FICHAS_CONFIG.forEach(f => {
    const head    = secaoDocs.querySelector(`.docs-acc-head[data-key="${f.key}"]`);
    const body    = document.getElementById(`body-${f.key}`);
    const chevron = head.querySelector('.acc-chevron');
    const btnLink = secaoDocs.querySelector(`.btn-link-${f.key}`);

    let aberto = false;

    function abrir() {
      if (aberto) return;
      aberto = true;
      body.style.display = 'block';
      chevron.textContent = '▼';
    }
    function fechar() {
      aberto = false;
      body.style.display = 'none';
      chevron.textContent = '►';
    }

    // Toggle pelo cabeçalho (ignora cliques nos botões)
    head.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (aberto) { fechar(); return; }
      abrir();
      carregarListaFichas(f.key);
    });

    // Copiar link — feedback no próprio botão (visível mesmo com accordion fechado)
    if (btnLink) {
      btnLink.addEventListener('click', () => {
        const link = btnLink.dataset.link;
        navigator.clipboard.writeText(link).catch(() => prompt('Copie o link:', link));
        const txtOrig = btnLink.textContent;
        btnLink.textContent = '✓ Copiado!';
        setTimeout(() => { btnLink.textContent = txtOrig; }, 2000);
      });
    }

    // Preencher interno — abre em janela Electron local (sem precisar de deploy de hosting)
    const btnPreencher = secaoDocs.querySelector(`.btn-preencher-${f.key}`);
    if (btnPreencher) {
      btnPreencher.addEventListener('click', () => {
        const nomeCorretor = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
        window.hubApi.abrirFichaLocal(f.arquivo, { corretor: currentUid, nome: encodeURIComponent(nomeCorretor) });
        if (!aberto) { abrir(); carregarListaFichas(f.key); }
      });
    }

  });
}

async function carregarListaFichas(fichaKey = 'locador') {
  const lista = document.getElementById(`lista-${fichaKey}`);
  if (!lista) return;

  const config = FICHAS_CONFIG.find(f => f.key === fichaKey);
  if (!config?.temFirebase) {
    lista.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0">
      Envie o link ao cliente pelo botão acima.<br>
      <span style="font-size:11px">As fichas preenchidas ficam salvas no dispositivo do cliente.</span>
    </p>`;
    return;
  }

  lista.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center">Carregando fichas...</p>';

  const ehLocador = fichaKey === 'locador';

  try {
    const res = ehLocador
      ? await listarFichasLocador({})
      : await listarFichasTipo({ tipo: fichaKey });
    const fichas = res.data || [];

    if (fichas.length === 0) {
      lista.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Nenhuma ficha recebida ainda.</p>';
      return;
    }

    const statusLabel = {
      aguardando_corretor:      'Aguardando revisão',
      aguardando_edicao_cliente:'Aguardando cliente',
      enviado_admin:            'Enviado ao admin',
      correcao_solicitada:      '⚠ Correção solicitada'
    };
    const statusCor = {
      aguardando_corretor:      '#b45309',
      aguardando_edicao_cliente:'#6366f1',
      enviado_admin:            '#16a34a',
      correcao_solicitada:      '#DC1C2E'
    };
    const nomesDoc = { rgFrente:'RG/CNH frente', rgVerso:'RG/CNH verso', compRenda:'Comp. renda', compEndereco:'Comp. endereço', matricula:'Matrícula', iptu:'IPTU' };
    const nomePend = { cpf:'CPF', rg:'RG', profissao:'Profissão', renda:'Renda', banco:'Banco', tipoConta:'Tipo conta', agencia:'Agência', conta:'Conta', pix:'Pix', rgFrente:'RG frente', rgVerso:'RG verso', compRenda:'Comp. renda', compEndereco:'Comp. endereço', matricula:'Matrícula', iptu:'IPTU' };

    lista.innerHTML = fichas.map(f => {
      const data = f.criadoEm ? new Date(f.criadoEm).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      const pends = (f.pendentes || []).length;
      const label = statusLabel[f.status] || f.status;
      const cor   = statusCor[f.status]   || '#6b7280';
      const obs   = f.observacaoCorretor  || '';
      const podeMexer = ['aguardando_corretor','aguardando_edicao_cliente'].includes(f.status);

      return `
        <div class="ficha-card" data-id="${f.id}">
          <div class="ficha-card-head">
            <div>
              <strong style="font-size:13px">${f.dados?.nome || 'Sem nome'}</strong>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${data}</span>
            </div>
            <span style="font-size:11px;font-weight:600;color:${cor};background:${cor}18;padding:3px 8px;border-radius:6px">${label}</span>
          </div>

          ${obs ? `<div style="font-size:11px;color:#6366f1;margin-top:6px;background:#eef2ff;padding:5px 8px;border-radius:6px">📝 Obs. ao cliente: ${obs}</div>` : ''}
          ${pends > 0 ? `<div style="font-size:11px;color:#b45309;margin-top:4px">⚠ Pendente: ${f.pendentes.map(p => nomePend[p]||p).join(', ')}</div>` : ''}
          ${f.corretorNome ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:right">Corretor: ${escapeHtml(f.corretorNome)}</div>` : ''}

          <!-- Ações -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            ${podeMexer ? `<button class="topbar-btn primario btn-enviar-admin" data-id="${f.id}" style="font-size:11px;padding:4px 10px">✓ Enviar ao admin</button>` : ''}
            ${podeMexer ? `<button class="topbar-btn btn-reenviar" data-id="${f.id}" style="font-size:11px;padding:4px 10px">↩ Reenviar ao cliente</button>` : ''}
            <button class="topbar-btn perigo btn-excluir" data-id="${f.id}" style="font-size:11px;padding:4px 10px">🗑 Excluir</button>
            <button class="ficha-ver-btn topbar-btn" data-id="${f.id}" data-arquivo="${config.arquivo}" style="font-size:11px;padding:4px 10px">👁 Visualizar</button>
            <button class="ficha-editar-btn topbar-btn" data-id="${f.id}" data-arquivo="${config.arquivo}" style="font-size:11px;padding:4px 10px">✏ Editar</button>
            <button class="ficha-pdf-btn topbar-btn" data-id="${f.id}" data-arquivo="${config.arquivo}" data-nome="${escapeHtml(f.dados?.nome||'ficha')}" style="font-size:11px;padding:4px 10px">⬇ Baixar PDF</button>
          </div>
        </div>`;
    }).join('');

    const fnEnviar   = ehLocador ? enviarFichaParaAdmin    : enviarFichaTipoAdmin;
    const fnReenviar = ehLocador ? reenviarFichaParaCliente : reenviarFichaTipoCliente;
    const fnExcluir  = ehLocador ? excluirFichaLocador      : excluirFichaTipo;

    // Enviar ao admin
    lista.querySelectorAll('.btn-enviar-admin').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Confirma envio desta ficha para o administrativo?')) return;
        btn.disabled = true; btn.textContent = 'Enviando...';
        try { await fnEnviar({ fichaId: btn.dataset.id }); carregarListaFichas(fichaKey); atualizarNotifFichas(); }
        catch(e) { alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = '✓ Enviar ao admin'; }
      });
    });

    // Reenviar ao cliente
    lista.querySelectorAll('.btn-reenviar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const obs = prompt('Observação para o cliente (opcional):');
        if (obs === null) return; // cancelou o prompt → não reenvia
        btn.disabled = true; btn.textContent = 'Gerando link...';
        try {
          const res = await fnReenviar({ fichaId: btn.dataset.id, observacao: obs });
          const link = res.data.link;
          await navigator.clipboard.writeText(link).catch(() => prompt('Copie o link:', link));
          alert('Link copiado! Envie ao cliente pelo WhatsApp.');
          carregarListaFichas(fichaKey);
        } catch(e) { alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = '↩ Reenviar ao cliente'; }
      });
    });

    // Excluir
    lista.querySelectorAll('.btn-excluir').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir esta ficha permanentemente?')) return;
        btn.disabled = true; btn.textContent = 'Excluindo...';
        try { await fnExcluir({ fichaId: btn.dataset.id }); }
        catch(e) {
          if (!e.message?.includes('não encontrada') && !e.message?.includes('not-found')) {
            alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = '🗑 Excluir'; return;
          }
        }
        const card = btn.closest('.ficha-card');
        card.style.opacity = '0'; card.style.transition = 'opacity .3s';
        setTimeout(() => {
          card.remove();
          if (!lista.querySelector('.ficha-card'))
            lista.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Nenhuma ficha recebida ainda.</p>';
        }, 300);
      });
    });

    // Visualizar ficha (modo leitura)
    lista.querySelectorAll('.ficha-ver-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        abrirModalFicha(btn.dataset.arquivo, btn.dataset.id, 'corretor', '👁 Visualizar ficha');
      });
    });

    // Editar ficha (modo edição — para todos os corretores)
    lista.querySelectorAll('.ficha-editar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        abrirModalFicha(btn.dataset.arquivo, btn.dataset.id, 'edicao', '✏ Editar ficha');
      });
    });

    // Baixar ficha como PDF
    lista.querySelectorAll('.ficha-pdf-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = `${BASE_HOSTING}/${btn.dataset.arquivo}?modo=corretor&idFicha=${btn.dataset.id}&origem=hub`;
        const nome = (btn.dataset.nome || 'ficha').replace(/[^a-zA-Z0-9À-ɏ\s_-]/g, '').trim();
        const txtOrig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Gerando...';
        try {
          const r = await hubApi.baixarFichaPDF(url, `Ficha - ${nome}.pdf`);
          if (!r?.ok && r?.erro) alert('Erro ao gerar PDF: ' + r.erro);
        } catch(e) { console.warn('PDF:', e); }
        finally { btn.disabled = false; btn.textContent = txtOrig; }
      });
    });

  } catch(e) {
    if (lista) lista.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center">Erro ao carregar fichas: ${e.message}</p>`;
  }
}

// ─── Sininho de notificações de fichas ───────────────────────────────────────
const btnNotif   = document.getElementById('btnNotif');
const notifBadge = document.getElementById('notifBadge');
const notifPanel = document.getElementById('notifPanel');
const notifLista = document.getElementById('notifLista');

let notifDados = [];  // cache dos itens para o painel

// Gerencia IDs "vistos" por usuário no localStorage
function getVistos() {
  try { return new Set(JSON.parse(localStorage.getItem(`notif_vistos_${currentUid}`) || '[]')); }
  catch { return new Set(); }
}
function salvarVistos(set) {
  try { localStorage.setItem(`notif_vistos_${currentUid}`, JSON.stringify([...set])); }
  catch {}
}

async function atualizarNotifFichas() {
  try {
    const res = await contarNotifFichas();
    notifDados = res.data?.items || [];
    const vistos = getVistos();
    // Só conta fichas com ID ainda não visto pelo usuário
    const novos = notifDados.filter(n => n.id && !vistos.has(n.id));
    if (novos.length > 0) {
      notifBadge.textContent = novos.length > 99 ? '99+' : novos.length;
      notifBadge.hidden = false;
    } else {
      notifBadge.hidden = true;
    }
  } catch(e) { console.warn('Notif fichas:', e); }
}

function renderNotifPanel() {
  if (!notifDados.length) {
    notifLista.innerHTML = '<p class="notif-vazio">Nenhuma ficha pendente</p>';
    return;
  }
  notifLista.innerHTML = notifDados.map(n => {
    const data = n.data ? new Date(n.data).toLocaleDateString('pt-BR') : '—';
    const sub  = n.corretor ? `${n.corretor} · ${data}` : data;
    return `<div class="notif-item" data-tipo="${n.tipo}">
      <span class="notif-item-titulo">${escapeHtml(n.nome)}</span>
      <span class="notif-item-sub">${escapeHtml(n.tipoLabel)} · ${escapeHtml(sub)}</span>
    </div>`;
  }).join('');

  notifLista.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      notifPanel.hidden = true;
      const secKey = item.dataset.tipo;
      // Navega para Documentos
      categoriaAtiva = 'documentos';
      renderSidebar();
      renderCentro();
      // Abre o accordion da ficha correspondente
      setTimeout(() => {
        const head = document.querySelector(`.docs-acc-head[data-key="${secKey}"]`);
        if (head) head.click();
      }, 200);
    });
  });
}

btnNotif.addEventListener('click', (e) => {
  e.stopPropagation();
  const abrindo = notifPanel.hidden;
  notifPanel.hidden = !abrindo;
  if (abrindo) {
    renderNotifPanel();
    // Marca todas as fichas visíveis agora como "visto"
    // Mantém apenas IDs que ainda estão na lista atual (limpa IDs de fichas já resolvidas)
    const idsAtuais = new Set(notifDados.map(n => n.id).filter(Boolean));
    const vistos = getVistos();
    idsAtuais.forEach(id => vistos.add(id));
    // Prune: remove IDs que não estão mais pendentes (ficha resolvida)
    for (const id of [...vistos]) { if (!idsAtuais.has(id)) vistos.delete(id); }
    salvarVistos(vistos);
    notifBadge.hidden = true;
  }
});

document.addEventListener('click', (e) => {
  if (!notifPanel.hidden && !notifPanel.contains(e.target) && e.target !== btnNotif) {
    notifPanel.hidden = true;
  }
});

// ─── Abrir ficha em janela dedicada ──────────────────────────────────────────
function abrirModalFicha(arquivo, fichaId, modo, titulo) {
  // origem=hub: marca que foi aberta pelo corretor dentro do app.
  // Isso desativa a barra "Solicitar correção" (visualizar) e libera a edição
  // mesmo quando o link de uso único do cliente já estaria inativo.
  const url = `${BASE_HOSTING}/${arquivo}?modo=${modo}&idFicha=${fichaId}&origem=hub`;
  hubApi.abrirFicha(url, titulo);
}

// ─── Suporte (botão flutuante + modal) ────────────────────────────────────
const btnSuporte   = document.getElementById('btnSuporte');
const modalSuporte = document.getElementById('modalSuporte');
const supMensagem  = document.getElementById('supMensagem');
const supFile      = document.getElementById('supFile');
const supFileNome  = document.getElementById('supFileNome');
const supPreview   = document.getElementById('supPreview');
const supRemover   = document.getElementById('supRemover');
const supMsg       = document.getElementById('supMsg');
let supImagemPendente = null; // data URL da imagem anexada (ou null)

function limparAnexoSuporte() {
  supImagemPendente = null;
  supFile.value = '';
  supFileNome.textContent = '';
  supPreview.hidden = true;
  supPreview.removeAttribute('src');
  supRemover.hidden = true;
}

function resetSuporte() {
  supMensagem.value = '';
  limparAnexoSuporte();
  supMsg.hidden = true;
}

btnSuporte.addEventListener('click', () => { resetSuporte(); modalSuporte.showModal(); });
document.getElementById('supCancelar').addEventListener('click', () => modalSuporte.close());
document.getElementById('supFechar').addEventListener('click', () => modalSuporte.close());
document.getElementById('supAnexar').addEventListener('click', () => supFile.click());
supRemover.addEventListener('click', limparAnexoSuporte);

supFile.addEventListener('change', () => {
  const f = supFile.files[0];
  if (!f) return;
  const falhou = () => {
    limparAnexoSuporte(); // limpa qualquer anexo anterior pra não enviar imagem errada
    alert('Não consegui ler essa imagem. Tente outro arquivo (PNG ou JPG).');
  };
  const reader = new FileReader();
  reader.onerror = falhou;
  reader.onload = () => {
    const img = new Image();
    img.onerror = falhou;
    img.onload = () => {
      // Redimensiona pra no máx 1400px (mantém proporção) e comprime — evita anexo gigante
      const maxDim = 1400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const escala = maxDim / Math.max(width, height);
        width = Math.round(width * escala); height = Math.round(height * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      supImagemPendente = canvas.toDataURL('image/jpeg', 0.8);
      supFileNome.textContent = f.name;
      supPreview.src = supImagemPendente;
      supPreview.hidden = false;
      supRemover.hidden = false;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});

document.getElementById('formSuporte').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensagem = supMensagem.value.trim();
  if (!mensagem) return;
  const btn = document.getElementById('supEnviar');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await enviarSuporte({ mensagem, imagem: supImagemPendente, imagemNome: supFile.files[0]?.name });
    modalSuporte.close();
    alert('Chamado enviado! ✅ Em breve entramos em contato.');
  } catch (err) {
    supMsg.textContent = 'Erro: ' + err.message;
    supMsg.style.color = '#ffb4bc';
    supMsg.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar';
  }
});

// ─── Render inicial ──────────────────────────────────────────────────────
atualizarRelogio();
setInterval(atualizarRelogio, 1000);
renderPainelAgenda();
renderSidebar();
renderCentro();
// Feriados do ano atual já no mini calendário (atualiza assim que chegar)
carregarFeriados(new Date().getFullYear()).then(() => renderPainelAgenda());

// fix 7: checa notificações quando qualquer dialog fechar (evita delay de 3 min se modal estava aberto)
document.querySelectorAll('dialog').forEach(d => {
  new MutationObserver(() => {
    if (!d.open && !document.querySelector('dialog[open]')) verificarNotificacoes();
  }).observe(d, { attributes: true, attributeFilter: ['open'] });
});
