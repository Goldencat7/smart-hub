// Lógica da tela principal do Hub:
// - Sidebar com categorias + busca por categoria
// - Verifica auth, busca credenciais via Cloud Function ao clicar
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail,
  multiFactor, TotpMultiFactorGenerator, sendEmailVerification,
  EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp as fsTs
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
const locListarImoveis = httpsCallable(fns, 'locListarImoveis');
const locListarFichasImovel = httpsCallable(fns, 'locListarFichasImovel');
const locMoverImovelStatus = httpsCallable(fns, 'locMoverImovelStatus');
const locExcluirImovel = httpsCallable(fns, 'locExcluirImovel');
const locObterImovel = httpsCallable(fns, 'locObterImovel');
const locGerarTokenPortal = httpsCallable(fns, 'locGerarTokenPortal');
const locAddDocLocatario = httpsCallable(fns, 'locAddDocLocatario');
const locSalvarCamposLocacao = httpsCallable(fns, 'locSalvarCamposLocacao');
const locAddLocatario = httpsCallable(fns, 'locAddLocatario');
const locAnalisarLocatario = httpsCallable(fns, 'locAnalisarLocatario');
const locFichasParaVincular = httpsCallable(fns, 'locFichasParaVincular');
const locVincularFichaLocatario = httpsCallable(fns, 'locVincularFichaLocatario');
const locSalvarGarantia = httpsCallable(fns, 'locSalvarGarantia');
const locCriarContrato = httpsCallable(fns, 'locCriarContrato');
const locAtualizarContrato = httpsCallable(fns, 'locAtualizarContrato');
const locAtivarContrato = httpsCallable(fns, 'locAtivarContrato');
const locListarFinanceiro = httpsCallable(fns, 'locListarFinanceiro');
const locRegistrarPagamento = httpsCallable(fns, 'locRegistrarPagamento');
const locRegistrarRepasse = httpsCallable(fns, 'locRegistrarRepasse');
const locAtualizarRepasse = httpsCallable(fns, 'locAtualizarRepasse');
const locListarAlertas = httpsCallable(fns, 'locListarAlertas');
const locTratarAlerta = httpsCallable(fns, 'locTratarAlerta');
const locSalvarVistoria = httpsCallable(fns, 'locSalvarVistoria');
const locMeuPerfil = httpsCallable(fns, 'locMeuPerfil');
const locDashboard = httpsCallable(fns, 'locDashboard');
const locRelatorios = httpsCallable(fns, 'locRelatorios');
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
const contarChamadosAbertos = httpsCallable(fns, 'contarChamadosAbertos');
const listarChamados      = httpsCallable(fns, 'listarChamados');
const responderChamado    = httpsCallable(fns, 'responderChamado');
const excluirChamado      = httpsCallable(fns, 'excluirChamado');

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
  calculadoras: svgIcone('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>'),
  notas:        svgIcone('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>'),
  ti:            svgIcone('<path d="M4 15s1-1 4-1 4 1 4 1"/><circle cx="8" cy="9" r="3"/><path d="M22 19V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14"/><path d="M16 8h.01M16 12h4"/>'),
  imoveis:      svgIcone('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/>'),
  financeiro:   svgIcone('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="8" cy="15" r="1.4"/>'),
  locadmin:     svgIcone('<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  painel:       svgIcone('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
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

// Sub-apps da Gestão de Locações — viram cards dentro da aba "Locação"
// Versão enxuta (pedido do chefe): só Painel + Imóveis. Financeiro/Alertas/
// Relatórios saíram; as fichas voltaram pro Cadastro.
const LOC_APPS = [
  { id: 'painel',     titulo: 'Painel',     desc: 'Visão geral da carteira', icone: ICN.painel },
  { id: 'imoveis',    titulo: 'Imóveis',    desc: 'Esteira das captações',   icone: ICN.imoveis },
];

const CATEGORIAS = [
  { id: 'captacao',    nome: 'Captação',    icone: ICN.captacao },
  { id: 'crm',         nome: 'CRM',         icone: ICN.crm },
  { id: 'vistoria',    nome: 'Vistoria',    icone: ICN.vistoria },
  { id: 'performance', nome: 'Performance', icone: ICN.performance },
  { id: 'treinamento', nome: 'Treinamento', icone: ICN.treinamento, treinamento: true },
  { id: 'marketing',   nome: 'Marketing',   icone: ICN.marketing, marketing: true },
  { id: 'clicksign',   nome: 'ClickSign',   icone: ICN.clicksign, appDireto: 'clicksign', restrito: true },
  { id: 'agenda',      nome: 'Agenda',      icone: ICN.agenda, agenda: true },
  { id: 'documentos',  nome: 'Cadastro',  icone: ICN.documentos, placeholder: true },
  { id: 'locacoes',    nome: 'Locação',   icone: ICN.locacao, locacoes: true, soLocGestao: true },
  { id: 'fotografia',  nome: 'Fotografia',  icone: ICN.fotografia, fotografia: true },
  { id: 'reuniao',      nome: 'Reunião',        icone: ICN.reuniao, reuniao: true },
  { id: 'sala_reuniao', nome: 'Sala de Reunião', icone: ICN.salaReuniao, salaReuniao: true },
  { id: 'ia',           nome: 'IA',              icone: ICN.ia, ia: true },
  { id: 'calculadoras', nome: 'Calculadoras',    icone: ICN.calculadoras, calculadoras: true },
  { id: 'notas',        nome: 'Bloco de Notas',  icone: ICN.notas, notas: true },
  { id: 'whatsapp',    nome: 'WhatsApp',     icone: ICN.whatsapp, appDireto: 'whatsapp' },
  { id: 'ti',          nome: 'Suporte / TI',  icone: ICN.ti, ti: true, soTI: true },
  { id: 'config',      nome: 'Configurações', icone: ICN.config, config: true }
];

// Avatar padrão (quando a pessoa não tem foto)
const AVATAR_PADRAO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1d222d"/><circle cx="60" cy="46" r="22" fill="#6b7280"/><rect x="24" y="74" width="72" height="48" rx="24" fill="#6b7280"/></svg>'
);

let categoriaAtiva = 'captacao';
let locSub = null;              // sub-app aberto dentro da aba Locação (null = grade de cards)
let termoBusca = '';
let isAdmin = false;
let locRoleAtual = 'corretor'; // papel na Gestão de Locações (setado no onAuthStateChanged)
let betaLocacoes = false;       // acesso de teste ao módulo de Locações (feature flag) — gate das abas
let locacoesPublicado = false;  // true quando a versão deste app foi publicada p/ todos (painel de Admin)
let podeGestaoLoc = false;      // permissão loc_gestao — vê as abas de gestão (Painel/Imóveis/Financeiro/Alertas/Relatórios). Fichas é pra todos.
let currentUid = null;
let appsPermitidos = [];
let temDrivesFotografia = false;
let temPermTI = false;
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
const secaoCalculadoras   = document.getElementById('secaoCalculadoras');
const secaoNotas          = document.getElementById('secaoNotas');
const secaoImoveis        = document.getElementById('secaoImoveis');
const secaoFinanceiro     = document.getElementById('secaoFinanceiro');
const secaoPainel         = document.getElementById('secaoPainel');
const secaoAlertas        = document.getElementById('secaoAlertas');
const secaoRelatorios     = document.getElementById('secaoRelatorios');
const secaoTreinamento    = document.getElementById('secaoTreinamento');
const secaoTI             = document.getElementById('secaoTI');
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
let calVisao = 'mes';             // 'mes' | 'semana' | 'lista'
let diaSelecionado = null;        // 'YYYY-MM-DD' no calendário completo
let eventoEditandoId = null;      // id do evento em edição no modal (null = modo criar)
const alertados = new Set();      // ids já alertados (1h antes)
let pessoasCache = null;          // lista de pessoas (admin) pro seletor
let pessoasCacheAt = 0;           // timestamp da última carga do cache (TTL: 5 min)

// ─── Render sidebar ──────────────────────────────────────────────────────
function renderSidebar() {
  const visiveis = CATEGORIAS.filter(c =>
    !c.oculto &&
    (!c.soLocGestao || podeGestaoLoc) &&
    (!c.soGestor || locRoleAtual === 'gestor') &&
    (!c.restrito || isAdmin || (c.appDireto && appsPermitidos.includes(c.appDireto))) &&
    (!c.soTI || temPermTI || isAdmin)
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
      locSub = null;
      termoBusca = '';
      inputBusca.value = '';
      renderSidebar();
      renderCentro();
      const _grid = ['captacao','crm','vistoria','performance'];
      if (cat && !cat.appDireto && cat.id !== 'config' && !_grid.includes(cat.id)) {
        registrarAcesso({ siteKey: cat.id, titulo: cat.nome }).catch(() => {});
      }
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
  secaoCalculadoras.hidden = true;
  secaoNotas.hidden = true;
  secaoImoveis.hidden = true;
  secaoFinanceiro.hidden = true;
  secaoPainel.hidden = true;
  secaoAlertas.hidden = true;
  secaoRelatorios.hidden = true;
  secaoTreinamento.hidden = true;
  secaoTI.hidden = true;
  searchWrap.hidden = true;
  atualizarBanner();
  // Painel direito é redundante na própria aba Agenda → esconde lá (e some os botões de minimizar)
  hubLayout.classList.toggle('na-agenda', !!cat.agenda);
  btnExpandAgenda.hidden = cat.agenda ? true : !hubLayout.classList.contains('agenda-oculta');

  // Aba Suporte / TI (chamados)
  if (cat.ti) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoTI.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarChamadosHub();
    return;
  }

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
    carregarMarketing();
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

  // Aba Calculadoras
  if (cat.calculadoras) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoCalculadoras.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarCalculadoras();
    return;
  }

  // Aba Bloco de Notas
  if (cat.notas) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoNotas.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarNotas();
    return;
  }

  // Aba Locação (Gestão de Locações) — Painel/Imóveis/Financeiro como sub-apps
  if (cat.locacoes) {
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';

    if (!locSub) {
      // Grade inicial: cards dos sub-apps (Painel e Imóveis). A aba Locação
      // inteira já é gated por loc_gestao lá no filtro da sidebar.
      appsGrid.hidden = false;
      appsGrid.innerHTML = LOC_APPS.map(a => `
        <button class="hub-card" data-locsub="${a.id}">
          <span class="card-icon">${a.icone}</span>
          <span class="card-title">${a.titulo}</span>
          <span class="card-desc">${a.desc}</span>
        </button>
      `).join('');
      appsGrid.querySelectorAll('.hub-card').forEach(b => {
        b.addEventListener('click', () => { locSub = b.dataset.locsub; renderCentro(); });
      });
      return;
    }

    // Sub-app aberto: título vira "voltar + nome" e mostra a seção.
    if (!podeGestaoLoc) { locSub = null; renderCentro(); return; }
    appsGrid.hidden = true;
    const sub = LOC_APPS.find(a => a.id === locSub);
    tituloCategoria.innerHTML = `<button class="loc-voltar" id="locVoltar">← Locação</button> <span>${sub ? sub.titulo : ''}</span>`;
    document.getElementById('locVoltar').addEventListener('click', () => { locSub = null; renderCentro(); });

    if (locSub === 'painel')  { secaoPainel.hidden = false;  carregarPainel(); }
    if (locSub === 'imoveis') { secaoImoveis.hidden = false; imoveisFiltroStatus = null; carregarImoveis(); }
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
    carregarDocumentos('cadastro');
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
const SEM_BANNER = new Set(['agenda', 'marketing', 'documentos', 'fotografia', 'reuniao', 'sala_reuniao', 'ia', 'calculadoras', 'notas', 'locacoes', 'ti']);

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
    // PNG/JPG: 15 segundos fixos
    window.__bannerTimer = setTimeout(avancarBanner, 15000);
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

// ─── 2FA / TOTP ─────────────────────────────────────────────────────────────
// Estado do 2FA do usuário atual: checa se já tem TOTP fator inscrito
// e alterna botões "Ativar" / "Remover" na aba Configurações.
const cfg2faStatus  = document.getElementById('cfg2faStatus');
const cfg2faAtivar  = document.getElementById('cfg2faAtivar');
const cfg2faRemover = document.getElementById('cfg2faRemover');
const cfg2faVerificarEmail = document.getElementById('cfg2faVerificarEmail');
const cfg2faAtualizar      = document.getElementById('cfg2faAtualizar');
const modal2fa      = document.getElementById('modal2fa');
const form2fa       = document.getElementById('form2fa');
const tfaEmail      = document.getElementById('tfaEmail');
const tfaSecret     = document.getElementById('tfaSecret');
const tfaCodigo     = document.getElementById('tfaCodigo');
const tfaMsg        = document.getElementById('tfaMsg');
const tfaCopiar     = document.getElementById('tfaCopiar');
const tfaCancelar   = document.getElementById('tfaCancelar');
const cfg2faFechar  = document.getElementById('cfg2faFechar');

let _tfaSecret = null; // guardado enquanto o modal está aberto

function atualizar2faUi() {
  const user = auth.currentUser;
  if (!user) return;
  const mf = multiFactor(user);
  const temTotp = (mf.enrolledFactors || []).some(f => f.factorId === 'totp');
  const emailOk = !!user.emailVerified;
  if (temTotp) {
    cfg2faStatus.textContent = 'ativo';
    cfg2faStatus.style.background = '#16a34a';
  } else if (!emailOk) {
    cfg2faStatus.textContent = 'email não verificado';
    cfg2faStatus.style.background = '#b45309';
  } else {
    cfg2faStatus.textContent = 'inativo';
    cfg2faStatus.style.background = '#6b7280';
  }
  cfg2faStatus.style.color = '#fff';
  cfg2faVerificarEmail.hidden = temTotp || emailOk;
  cfg2faAtualizar.hidden = temTotp || emailOk;
  cfg2faAtivar.hidden  = temTotp || !emailOk;
  cfg2faRemover.hidden = !temTotp;
}

cfg2faVerificarEmail.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  cfg2faVerificarEmail.disabled = true;
  const orig = cfg2faVerificarEmail.textContent;
  cfg2faVerificarEmail.textContent = 'Enviando…';
  try {
    await sendEmailVerification(user);
    alert(`Enviamos um link de verificação para ${user.email}.\n\n1. Abre o email e clica no link.\n   ⚠️ Se não achar, verifica a pasta de SPAM / Lixo Eletrônico — o link do Firebase costuma cair lá.\n2. Volta aqui e clica em "↻ Atualizar" pra checar o status.`);
  } catch (e) {
    alert('Erro ao enviar email: ' + (e.message || e));
  } finally {
    cfg2faVerificarEmail.disabled = false;
    cfg2faVerificarEmail.textContent = orig;
  }
});

cfg2faAtualizar.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  cfg2faAtualizar.disabled = true;
  const orig = cfg2faAtualizar.textContent;
  cfg2faAtualizar.textContent = 'Checando…';
  try {
    await user.reload();
    atualizar2faUi();
    if (!user.emailVerified) {
      alert('Ainda tá como não verificado. Abre o email (inclusive a pasta de SPAM), clica no link e tenta de novo.');
    }
  } catch (e) {
    alert('Erro ao atualizar: ' + (e.message || e));
  } finally {
    cfg2faAtualizar.disabled = false;
    cfg2faAtualizar.textContent = orig;
  }
});

function mostrarMsgTfa(texto, ok) {
  tfaMsg.textContent = texto;
  tfaMsg.style.color = ok ? '#16a34a' : 'var(--danger)';
  tfaMsg.hidden = false;
}

// Reautentica com senha via modal HTML (Electron não suporta prompt()).
// Retorna true se autenticou, false se usuário cancelou.
function pedirSenhaModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('modalReauth');
    const form  = document.getElementById('formReauth');
    const inp   = document.getElementById('reauthSenha');
    const msg   = document.getElementById('reauthMsg');
    const btnCancelar = document.getElementById('reauthCancelar');
    const btnFechar   = document.getElementById('reauthFechar');
    inp.value = ''; msg.hidden = true;
    const encerrar = (senha) => {
      form.onsubmit = null;
      btnCancelar.onclick = null;
      btnFechar.onclick = null;
      modal.close();
      resolve(senha);
    };
    form.onsubmit = (e) => { e.preventDefault(); encerrar(inp.value || null); };
    btnCancelar.onclick = () => encerrar(null);
    btnFechar.onclick = () => encerrar(null);
    modal.showModal();
    setTimeout(() => inp.focus(), 50);
  });
}

async function reautenticarComSenha(user) {
  const senha = await pedirSenhaModal();
  if (!senha) return false;
  const cred = EmailAuthProvider.credential(user.email, senha);
  await reauthenticateWithCredential(user, cred);
  return true;
}

cfg2faAtivar.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  cfg2faAtivar.disabled = true;
  try {
    // Reautentica SEMPRE — Firebase exige login recente pra qualquer operação MFA
    const ok = await reautenticarComSenha(user);
    if (!ok) return;
    const mf = multiFactor(user);
    const session = await mf.getSession();
    _tfaSecret = await TotpMultiFactorGenerator.generateSecret(session);
    tfaEmail.value  = user.email || '';
    tfaSecret.value = _tfaSecret.secretKey;
    tfaCodigo.value = '';
    tfaMsg.hidden = true;
    modal2fa.showModal();
  } catch (e) {
    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      alert('Senha incorreta. Tenta de novo.');
    } else {
      alert('Erro ao iniciar 2FA: ' + (e.message || e));
    }
  } finally {
    cfg2faAtivar.disabled = false;
  }
});

tfaCopiar.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(tfaSecret.value);
    tfaCopiar.textContent = '✓ Copiado';
    setTimeout(() => { tfaCopiar.textContent = '📋 Copiar segredo'; }, 1500);
  } catch (_) {
    tfaSecret.select();
  }
});

function fecharModal2fa() {
  modal2fa.close();
  _tfaSecret = null;
}
tfaCancelar.addEventListener('click', fecharModal2fa);
cfg2faFechar.addEventListener('click', fecharModal2fa);

form2fa.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user || !_tfaSecret) return;
  const codigo = (tfaCodigo.value || '').replace(/\D/g, '').trim();
  if (codigo.length !== 6) { mostrarMsgTfa('O código tem 6 dígitos.', false); return; }
  const btn = form2fa.querySelector('button[type="submit"]');
  btn.disabled = true; mostrarMsgTfa('Verificando…', true);
  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(_tfaSecret, codigo);
    await multiFactor(user).enroll(assertion, 'Autenticador principal');
    fecharModal2fa();
    atualizar2faUi();
    alert('2FA ativado! No próximo login vamos pedir um código do seu app.');
  } catch (err) {
    mostrarMsgTfa('Código inválido. Confira no seu app e tente de novo.', false);
    btn.disabled = false;
  }
});

cfg2faRemover.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm('Remover a autenticação em dois fatores? Sua conta ficará só com senha.')) return;
  cfg2faRemover.disabled = true;
  try {
    const ok = await reautenticarComSenha(user);
    if (!ok) return;
    const mf = multiFactor(user);
    const totp = (mf.enrolledFactors || []).find(f => f.factorId === 'totp');
    if (!totp) { atualizar2faUi(); return; }
    await mf.unenroll(totp);
    atualizar2faUi();
    alert('2FA removido.');
  } catch (e) {
    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      alert('Senha incorreta. Tenta de novo.');
    } else {
      alert('Erro ao remover 2FA: ' + (e.message || e));
    }
  } finally {
    cfg2faRemover.disabled = false;
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
  atualizar2faUi();

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

  // Busca os apps restritos liberados pra este usuário e re-renderiza
  try {
    const perm = await getMinhasPermissoes();
    appsPermitidos = perm.data.apps || [];
    temDrivesFotografia = !!perm.data.drives_fotografia;
    temPermTI = !!perm.data.ti;
    temPermMarketing = !!perm.data.marketing_gerenciar;
    betaLocacoes = !!perm.data.loc_beta;
    podeGestaoLoc = !!perm.data.loc_gestao;
    try {
      const v = await window.hubApi.getAppVersion();
      locacoesPublicado = !!perm.data.locacoesPublicadaEm && v === perm.data.locacoesPublicadaEm;
    } catch (_) { locacoesPublicado = false; }
    if (perm.data.isAdmin) isAdmin = true;
  } catch (e) {
    console.warn('Permissões:', e);
    appsPermitidos = [];
  }

  btnAdmin.hidden = !(isAdmin || temPermTI);
  try {
    const mp = await locMeuPerfil();
    locRoleAtual = mp.data?.role || 'corretor';
  } catch (e) { locRoleAtual = 'corretor'; }
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

  // Sininho de fichas: carrega ao entrar e atualiza a cada 60s
  atualizarNotifFichas();
  clearInterval(window.__notifFichasTimer);
  window.__notifFichasTimer = setInterval(atualizarNotifFichas, 60000);

  // Badge de chamados abertos (TI / admin)
  atualizarBadgeChamados();
  clearInterval(window.__chamadosTimer);
  window.__chamadosTimer = setInterval(atualizarBadgeChamados, 120000);

  // Atualiza na hora quando a pessoa volta pro app (foco / aba visível),
  // pra não esperar o timer quando a ficha acabou de chegar. Wire uma vez só.
  if (!window.__notifFocusWired) {
    window.__notifFocusWired = true;
    let ultimaAtt = 0;
    const attAoVoltar = () => {
      if (document.hidden) return;
      const agora = Date.now();
      if (agora - ultimaAtt < 10000) return; // trava: no máx. 1x a cada 10s
      ultimaAtt = agora;
      atualizarNotifFichas();
      verificarNotificacoes();
      atualizarBadgeChamados();
    };
    window.addEventListener('focus', attAoVoltar);
    document.addEventListener('visibilitychange', attAoVoltar);
  }
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

    // Leitura reversa: traz o que foi criado direto no Google (só se conectado), sem duplicar.
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
    // Mini calendário (painel direito) mantém só pontinhos por questão de espaço
    if (mini) {
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
        <span class="cal-num">${dia}</span>${pontoHtml}
      </button>`;
      continue;
    }
    // Calendário grande: pílulas de eventos ao estilo Google Calendar
    const MAX_PILLS = 3;
    const evsOrd = [...evs].sort((a,b) => a.inicio - b.inicio);
    const visiveis = evsOrd.slice(0, MAX_PILLS);
    const restantes = evsOrd.length - visiveis.length;
    const pillsHtml = visiveis.map(e => {
      const cls = e.origem === 'google' ? 'tipo-google'
        : (e.meuRsvp === 'pendente' && !e.souDono ? 'tipo-pendente'
        : ({ cliente:'tipo-cliente', visita:'tipo-visita', pessoal:'tipo-pessoal' }[e.tipo] || ''));
      const hora = e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      return `<span class="cal-ev-pill ${cls}" data-ev-id="${e.id}" title="${escapeHtml(hora + ' ' + e.titulo)}">
        <span class="cal-ev-hora">${hora}</span>
        <span class="cal-ev-tit-wrap"><span class="cal-ev-tit">${escapeHtml(e.titulo)}</span></span>
      </span>`;
    }).join('');
    const maisHtml = restantes > 0 ? `<span class="cal-ev-mais">+${restantes} mais</span>` : '';
    const feriadoHtml = fer ? `<span class="cal-feriado">${escapeHtml(fer)}</span>` : '';
    html += `<button class="cal-dia ${chave===hojeChave?'hoje':''} ${chave===diaSelecionado?'sel':''} ${evs.length?'tem-ev':''} ${fer?'feriado':''}" data-dia="${chave}"${fer?` title="${escapeHtml(fer)}"`:''}>
      <span class="cal-num">${dia}</span>
      ${feriadoHtml}
      <div class="cal-ev-lista">${pillsHtml}${maisHtml}</div>
    </button>`;
  }
  return html + '</div>';
}

// View LISTA — cronológica dos eventos do mês
function montarListaMes(ano, mes){
  const inicio = new Date(ano, mes, 1);
  const fim    = new Date(ano, mes+1, 0, 23, 59, 59);
  const hojeChave = chaveDia(new Date());
  const evs = eventos.filter(e => e.inicio >= inicio && e.inicio <= fim).sort((a,b) => a.inicio - b.inicio);
  if (!evs.length) return '<div class="cal-lista-vazio">Nenhum compromisso neste mês.</div>';
  // Agrupa por dia
  const porDia = new Map();
  for (const e of evs) {
    const c = chaveDia(e.inicio);
    if (!porDia.has(c)) porDia.set(c, []);
    porDia.get(c).push(e);
  }
  return '<div class="cal-lista">' + [...porDia.entries()].map(([chave, lista]) => {
    const d = new Date(chave + 'T00:00:00');
    const eh = chave === hojeChave;
    return `<div class="cal-lista-grupo">
      <div class="cal-lista-dia ${eh ? 'cal-lista-hoje' : ''}">${d.toLocaleDateString('pt-BR',{weekday:'long', day:'2-digit', month:'long'})}${eh ? ' · Hoje' : ''}</div>
      ${lista.map(e => `<div class="cal-lista-ev" data-ev-id="${e.id}" data-dia="${chave}">
        <span class="cal-lista-hora">${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
        <span class="cal-lista-titulo">${iconeTipo(e.tipo)} ${escapeHtml(e.titulo)}</span>
        ${e.origem === 'google' ? '<span class="cal-lista-tag ev-tag-google">Google</span>' : ''}
        ${e.meuRsvp === 'pendente' && !e.souDono ? '<span class="cal-lista-tag ev-tag-pendente">convite</span>' : ''}
      </div>`).join('')}
    </div>`;
  }).join('') + '</div>';
}

// View SEMANA — 7 colunas × 24h. Cada evento vira uma pílula no seu horário.
function montarSemana(dataRef){
  // Segunda a partir do dataRef
  const d = new Date(dataRef);
  const dow = d.getDay(); // 0=dom
  const inicio = new Date(d); inicio.setDate(d.getDate() - dow); inicio.setHours(0,0,0,0);
  const hojeChave = chaveDia(new Date());
  const dias = Array.from({length:7}, (_,i) => {
    const x = new Date(inicio); x.setDate(inicio.getDate() + i); return x;
  });
  const HORAS = Array.from({length: 15}, (_,i) => i + 7); // 07:00 → 21:00
  let html = '<div class="cal-semana-grid">';
  // Header
  html += '<div class="cal-semana-head"></div>';
  html += dias.map(dt => {
    const eh = chaveDia(dt) === hojeChave;
    return `<div class="cal-semana-head ${eh ? 'hoje' : ''}">${DIAS_SEM[dt.getDay()]}<br>${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}</div>`;
  }).join('');
  // Linhas de horas
  for (const h of HORAS) {
    html += `<div class="cal-semana-hora">${String(h).padStart(2,'0')}:00</div>`;
    for (const dt of dias) {
      const chave = chaveDia(dt);
      const evsHora = eventos.filter(e =>
        chaveDia(e.inicio) === chave && e.inicio.getHours() === h
      ).sort((a,b) => a.inicio - b.inicio);
      const cel = evsHora.map(e => {
        const cor = e.origem === 'google' ? '#4285F4'
          : (e.meuRsvp === 'pendente' && !e.souDono ? '#DC1C2E'
          : ({ cliente:'#16a34a', visita:'#b45309', pessoal:'#6366f1' }[e.tipo] || 'var(--blue)'));
        return `<span class="cal-semana-ev" data-ev-id="${e.id}" style="background:${cor}" title="${escapeHtml(e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + ' ' + e.titulo)}">${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} ${escapeHtml(e.titulo)}</span>`;
      }).join('');
      html += `<div class="cal-semana-cel" data-dia="${chave}" data-hora="${h}">${cel}</div>`;
    }
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
  if (calVisao === 'lista') {
    calGrade.innerHTML = montarListaMes(calAno, calMes);
    calGrade.querySelectorAll('.cal-lista-ev').forEach(el => {
      el.addEventListener('click', () => {
        diaSelecionado = el.dataset.dia;
        const ev = eventos.find(x => x.id === el.dataset.evId);
        if (ev) abrirModalEvento(diaSelecionado, ev);
      });
    });
  } else if (calVisao === 'semana') {
    calGrade.innerHTML = montarSemana(new Date(calAno, calMes, new Date().getDate()));
    calGrade.querySelectorAll('.cal-semana-ev').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = eventos.find(x => x.id === el.dataset.evId);
        if (ev) { diaSelecionado = chaveDia(ev.inicio); abrirModalEvento(diaSelecionado, ev); }
      });
    });
    calGrade.querySelectorAll('.cal-semana-cel').forEach(el => {
      el.addEventListener('click', () => {
        diaSelecionado = el.dataset.dia;
        abrirModalEvento(diaSelecionado);
      });
    });
  } else {
    calGrade.innerHTML = montarGradeMes(calAno, calMes);
    // Título que não cabe no quadrado rola de lado (LED). Mede num double-rAF
    // (layout já assentado) e só anima os que de fato transbordam; hora/dia fixos.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      calGrade.querySelectorAll('.cal-ev-tit').forEach(t => {
        t.classList.remove('marquee');
        t.style.removeProperty('--shift'); t.style.removeProperty('--dur');
        const over = Math.round(t.scrollWidth - t.parentElement.clientWidth);
        if (over > 4) {
          t.classList.add('marquee');
          t.style.setProperty('--shift', `-${over}px`);
          t.style.setProperty('--dur', `${Math.max(4, Math.round(over / 15) + 3)}s`);
        }
      });
    }));
    calGrade.querySelectorAll('.cal-dia[data-dia]').forEach(b => {
      b.addEventListener('click', (e) => {
        // Se clicou numa pílula, abre o evento direto
        const pill = e.target.closest('.cal-ev-pill');
        if (pill) {
          e.stopPropagation();
          const ev = eventos.find(x => x.id === pill.dataset.evId);
          if (ev) { diaSelecionado = b.dataset.dia; abrirModalEvento(diaSelecionado, ev); return; }
        }
        diaSelecionado = b.dataset.dia;
        renderCalendarioCompleto();
      });
    });
  }
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

// Botões de visualização (Mês / Semana / Lista)
document.querySelectorAll('.cal-visao-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    calVisao = btn.dataset.visao;
    document.querySelectorAll('.cal-visao-btn').forEach(b => b.classList.toggle('ativo', b === btn));
    renderCalendarioCompleto();
  });
});
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
  // No modo gerenciar, os cliques têm handlers próprios; deixa o modo default só pro modo visualizar.
  if (mktModoGerenciar) return;
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

// ─── Marketing dinâmico + gerenciamento ─────────────────────────────────────
const listarMarketingConfig = httpsCallable(fns, 'listarMarketingConfig');
const salvarMarketingConfig = httpsCallable(fns, 'salvarMarketingConfig');
let mktConfig = { sanfonas: [] };
let mktModoGerenciar = false;
let temPermMarketing = false; // vem do getMinhasPermissoes

// Paleta de ícones pra escolher na sanfona (clicável — não precisa digitar emoji)
const MKT_EMOJIS = ['🏆','🏠','🏡','🏘️','🏢','🔑','💰','💎','📣','📢','⭐','🌟','✨','🔥','🎯','🎉','🎁','🥳','📸','🖼️','🎨','👑','❤️','✅','📌','🚀','💼','🛋️','🌆','🏅','🤝','📈'];

async function carregarMarketing() {
  const cont = document.getElementById('mktContainer');
  const toolbar = document.getElementById('mktToolbar');
  const info = document.getElementById('mktToolbarInfo');
  // Gerenciar Marketing é permissão à parte (marketing_gerenciar), NÃO herda de admin.
  toolbar.hidden = !temPermMarketing;
  if (info) info.textContent = mktModoGerenciar ? 'Modo edição — arraste/edite/remova. Clique em Salvar quando terminar.' : '';
  const btnG = document.getElementById('btnMktGerenciar');
  if (btnG) btnG.textContent = mktModoGerenciar ? '← Voltar' : '⚙ Gerenciar';
  cont.innerHTML = '<p class="muted" style="text-align:center;padding:32px 0">Carregando templates...</p>';
  try {
    const r = await listarMarketingConfig({});
    mktConfig.sanfonas = (r.data?.sanfonas || []).slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    if (mktModoGerenciar) renderMarketingGerenciar();
    else renderMarketingVisualizar();
  } catch (e) {
    cont.innerHTML = `<p style="color:var(--danger);text-align:center;padding:24px">Erro ao carregar: ${escapeHtml(e.message)}</p>`;
  }
}

function urlArquivo(caminho) {
  // Se for URL http, usa direto; senão é arquivo local
  if (!caminho) return '';
  if (/^https?:/.test(caminho)) return caminho;
  return caminho;
}

function renderMarketingVisualizar() {
  const cont = document.getElementById('mktContainer');
  cont.innerHTML = mktConfig.sanfonas.map(s => {
    const templates = (s.templates || []).slice().sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    return `<details class="mkt-accordion" ${s.aberta ? 'open' : ''}>
      <summary class="mkt-accordion-head">${escapeHtml(s.emoji || '')} ${escapeHtml(s.titulo || '')}</summary>
      <div class="mkt-carousel-wrap">
        <button class="mkt-nav-btn mkt-prev" aria-label="Anterior">‹</button>
        <div class="mkt-carousel">
          ${templates.map(t => `
            <div class="mkt-card" data-template="${escapeHtml(t.arquivo)}">
              <div class="mkt-thumb"><img src="${escapeHtml(urlArquivo(t.capa))}" alt="${escapeHtml(t.descricao)}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:11px\\'>sem capa</div>'"></div>
              <div class="mkt-info"><span class="mkt-desc">${escapeHtml(t.descricao)}</span></div>
              <button class="mkt-btn">Abrir editor ↗</button>
            </div>`).join('')}
        </div>
        <button class="mkt-nav-btn mkt-next" aria-label="Próximo">›</button>
      </div>
    </details>`;
  }).join('') || '<p class="muted" style="text-align:center;padding:32px 0">Nenhuma sanfona configurada.</p>';
  requestAnimationFrame(() => iniciarCarrosseis());
}

function renderMarketingGerenciar() {
  const cont = document.getElementById('mktContainer');
  const esc = escapeHtml;
  cont.innerHTML = `
    <div style="background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:16px">
      ⚠ Você está no modo edição. As mudanças só entram no ar quando clicar em <strong>Salvar</strong>.
    </div>
    ${mktConfig.sanfonas.map((s, si) => `
      <div class="mkt-edit-sanfona" data-si="${si}" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <div class="mkt-emoji-wrap" style="display:flex;align-items:stretch">
            <input class="mkt-edit-emoji" data-si="${si}" value="${esc(s.emoji || '')}" placeholder="🏆" maxlength="4" style="width:40px;font-size:18px;text-align:center;padding:6px 2px;border:1px solid var(--border);border-right:none;border-radius:6px 0 0 6px;background:var(--bg);color:var(--text-primary)">
            <button type="button" class="mkt-emoji-toggle" data-si="${si}" title="Escolher ícone" style="border:1px solid var(--border);border-radius:0 6px 6px 0;background:var(--surface);color:var(--text-muted);cursor:pointer;padding:0 6px;font-size:11px">▾</button>
          </div>
          <input class="mkt-edit-titulo" data-si="${si}" value="${esc(s.titulo || '')}" placeholder="Título da sanfona" style="flex:1;min-width:180px;font-size:13px;font-weight:600;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
          <label class="auth-label-inline" style="font-size:11px"><input type="checkbox" class="mkt-edit-aberta" data-si="${si}" ${s.aberta ? 'checked' : ''}> abre por padrão</label>
          <div style="display:flex;gap:4px">
            <button class="topbar-btn mkt-sanfona-up" data-si="${si}" ${si === 0 ? 'disabled' : ''} title="Subir" style="padding:4px 8px">▲</button>
            <button class="topbar-btn mkt-sanfona-down" data-si="${si}" ${si === mktConfig.sanfonas.length - 1 ? 'disabled' : ''} title="Descer" style="padding:4px 8px">▼</button>
            <button class="topbar-btn perigo mkt-sanfona-del" data-si="${si}" title="Excluir sanfona" style="padding:4px 8px">🗑</button>
          </div>
        </div>
        <div class="mkt-emoji-pop" data-si="${si}" style="display:none;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:2px;padding:8px;margin-bottom:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
          ${MKT_EMOJIS.map(e => `<button type="button" class="mkt-emoji-opt" data-si="${si}" data-emoji="${e}" title="${e}" style="font-size:18px;padding:6px 4px;border:none;background:transparent;cursor:pointer;border-radius:4px;line-height:1">${e}</button>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${(s.templates || []).sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((t, ti) => `
            <div class="mkt-edit-template" data-si="${si}" data-ti="${ti}" style="display:flex;gap:10px;align-items:flex-start;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
              <div style="width:90px;height:120px;flex-shrink:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center">
                ${t.capa ? `<img src="${esc(urlArquivo(t.capa))}" style="width:100%;height:100%;object-fit:cover" alt="">` : `<span class="muted" style="font-size:10px">sem capa</span>`}
              </div>
              <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                <input class="mkt-edit-desc" data-si="${si}" data-ti="${ti}" value="${esc(t.descricao || '')}" placeholder="Descrição" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)">
                <div style="display:flex;gap:6px;align-items:center">
                  <span style="font-size:11px;color:var(--text-muted);min-width:70px">Arquivo HTML:</span>
                  <input class="mkt-edit-arquivo" data-si="${si}" data-ti="${ti}" value="${esc(t.arquivo || '')}" placeholder="ex: vendido-v1-faixa.html ou URL" style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary);font-family:monospace">
                  <button class="topbar-btn mkt-upload-html" data-si="${si}" data-ti="${ti}" title="Substituir arquivo HTML" style="font-size:10px;padding:4px 8px">📄 Upload</button>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <span style="font-size:11px;color:var(--text-muted);min-width:70px">Capa (imagem):</span>
                  <input class="mkt-edit-capa" data-si="${si}" data-ti="${ti}" value="${esc(t.capa || '')}" placeholder="ex: marketing/assets/x.jpg ou URL" style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary);font-family:monospace">
                  <button class="topbar-btn mkt-upload-capa" data-si="${si}" data-ti="${ti}" title="Substituir capa" style="font-size:10px;padding:4px 8px">🖼 Upload</button>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px">
                <button class="topbar-btn mkt-tpl-up" data-si="${si}" data-ti="${ti}" ${ti === 0 ? 'disabled' : ''} title="Subir" style="padding:2px 6px;font-size:10px">▲</button>
                <button class="topbar-btn mkt-tpl-down" data-si="${si}" data-ti="${ti}" ${ti === (s.templates || []).length - 1 ? 'disabled' : ''} title="Descer" style="padding:2px 6px;font-size:10px">▼</button>
                <button class="topbar-btn perigo mkt-tpl-del" data-si="${si}" data-ti="${ti}" title="Excluir template" style="padding:2px 6px;font-size:10px">✕</button>
              </div>
            </div>`).join('')}
          <button class="topbar-btn mkt-add-tpl" data-si="${si}" style="align-self:flex-start;font-size:11px;padding:6px 12px">+ Adicionar template</button>
        </div>
      </div>`).join('')}
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="topbar-btn primario" id="btnMktAddSanfona" style="font-size:12px">+ Nova sanfona</button>
      <button class="topbar-btn primario" id="btnMktSalvar" style="font-size:12px;margin-left:auto">💾 Salvar alterações</button>
    </div>`;
  ligarHandlersGerenciar();
}

// Re-render agendado pra DEPOIS do evento de clique atual.
// Trocar o innerHTML de forma síncrona dentro do container com overflow:auto
// (.hub-main), no meio do clique, desincroniza o hit-testing do Chromium:
// cliques/digitação param de responder até um relayout (por isso "sair e voltar"
// consertava — remontava a seção). Deferir com rAF quebra esse padrão, igual ao
// caminho async do carregarMarketing (que renderiza após o await).
function agendarRerender(){ requestAnimationFrame(renderMarketingGerenciar); }

function ligarHandlersGerenciar() {
  const cont = document.getElementById('mktContainer');
  // Edições inline — persistem no mktConfig imediatamente (só valem quando Salvar)
  cont.querySelectorAll('.mkt-edit-titulo').forEach(inp => inp.addEventListener('input', e => { mktConfig.sanfonas[+e.target.dataset.si].titulo = e.target.value; }));
  cont.querySelectorAll('.mkt-edit-emoji').forEach(inp => inp.addEventListener('input', e => { mktConfig.sanfonas[+e.target.dataset.si].emoji = e.target.value; }));
  // Seletor de ícone: abre/fecha a paleta
  cont.querySelectorAll('.mkt-emoji-toggle').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const pop = btn.closest('.mkt-edit-sanfona').querySelector('.mkt-emoji-pop');
    const abrindo = pop.style.display === 'none' || !pop.style.display;
    cont.querySelectorAll('.mkt-emoji-pop').forEach(p => { p.style.display = 'none'; }); // fecha as outras
    pop.style.display = abrindo ? 'grid' : 'none';
  }));
  // Clique num ícone da paleta: aplica na sanfona e fecha
  cont.querySelectorAll('.mkt-emoji-opt').forEach(opt => opt.addEventListener('click', e => {
    e.stopPropagation();
    const si = +opt.dataset.si;
    const emoji = opt.dataset.emoji;
    mktConfig.sanfonas[si].emoji = emoji;
    const inp = cont.querySelector(`.mkt-edit-emoji[data-si="${si}"]`);
    if (inp) inp.value = emoji;
    opt.closest('.mkt-emoji-pop').style.display = 'none';
  }));
  cont.querySelectorAll('.mkt-edit-aberta').forEach(inp => inp.addEventListener('change', e => { mktConfig.sanfonas[+e.target.dataset.si].aberta = e.target.checked; }));
  cont.querySelectorAll('.mkt-edit-desc').forEach(inp => inp.addEventListener('input', e => {
    const si = +e.target.dataset.si, ti = +e.target.dataset.ti;
    mktConfig.sanfonas[si].templates[ti].descricao = e.target.value;
  }));
  cont.querySelectorAll('.mkt-edit-arquivo').forEach(inp => inp.addEventListener('input', e => {
    const si = +e.target.dataset.si, ti = +e.target.dataset.ti;
    mktConfig.sanfonas[si].templates[ti].arquivo = e.target.value;
  }));
  cont.querySelectorAll('.mkt-edit-capa').forEach(inp => inp.addEventListener('input', e => {
    const si = +e.target.dataset.si, ti = +e.target.dataset.ti;
    mktConfig.sanfonas[si].templates[ti].capa = e.target.value;
  }));
  // Reordenar sanfonas
  cont.querySelectorAll('.mkt-sanfona-up').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.si; if (i === 0) return;
    [mktConfig.sanfonas[i-1], mktConfig.sanfonas[i]] = [mktConfig.sanfonas[i], mktConfig.sanfonas[i-1]];
    mktConfig.sanfonas.forEach((s, idx) => { s.ordem = idx; });
    agendarRerender();
  }));
  cont.querySelectorAll('.mkt-sanfona-down').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.si; if (i >= mktConfig.sanfonas.length - 1) return;
    [mktConfig.sanfonas[i+1], mktConfig.sanfonas[i]] = [mktConfig.sanfonas[i], mktConfig.sanfonas[i+1]];
    mktConfig.sanfonas.forEach((s, idx) => { s.ordem = idx; });
    agendarRerender();
  }));
  cont.querySelectorAll('.mkt-sanfona-del').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Excluir esta sanfona e todos os templates dela?')) return;
    mktConfig.sanfonas.splice(+b.dataset.si, 1);
    agendarRerender();
  }));
  // Reordenar/excluir templates
  cont.querySelectorAll('.mkt-tpl-up').forEach(b => b.addEventListener('click', () => {
    const si = +b.dataset.si, ti = +b.dataset.ti; if (ti === 0) return;
    const arr = mktConfig.sanfonas[si].templates;
    [arr[ti-1], arr[ti]] = [arr[ti], arr[ti-1]];
    arr.forEach((t, idx) => { t.ordem = idx; });
    agendarRerender();
  }));
  cont.querySelectorAll('.mkt-tpl-down').forEach(b => b.addEventListener('click', () => {
    const si = +b.dataset.si, ti = +b.dataset.ti;
    const arr = mktConfig.sanfonas[si].templates;
    if (ti >= arr.length - 1) return;
    [arr[ti+1], arr[ti]] = [arr[ti], arr[ti+1]];
    arr.forEach((t, idx) => { t.ordem = idx; });
    agendarRerender();
  }));
  cont.querySelectorAll('.mkt-tpl-del').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Excluir este template da sanfona?')) return;
    const si = +b.dataset.si, ti = +b.dataset.ti;
    mktConfig.sanfonas[si].templates.splice(ti, 1);
    agendarRerender();
  }));
  // Adicionar template
  cont.querySelectorAll('.mkt-add-tpl').forEach(b => b.addEventListener('click', () => {
    const si = +b.dataset.si;
    mktConfig.sanfonas[si].templates.push({
      id: 'tpl-' + Date.now(),
      arquivo: '',
      capa: '',
      descricao: 'Novo template',
      ordem: mktConfig.sanfonas[si].templates.length
    });
    agendarRerender();
  }));
  // Uploads
  cont.querySelectorAll('.mkt-upload-html').forEach(b => b.addEventListener('click', () => uploadArquivoTemplate(+b.dataset.si, +b.dataset.ti, 'arquivo')));
  cont.querySelectorAll('.mkt-upload-capa').forEach(b => b.addEventListener('click', () => uploadArquivoTemplate(+b.dataset.si, +b.dataset.ti, 'capa')));
  // Nova sanfona
  document.getElementById('btnMktAddSanfona').addEventListener('click', () => {
    mktConfig.sanfonas.push({
      id: 'sanfona-' + Date.now(),
      titulo: 'Nova sanfona',
      emoji: '📁',
      ordem: mktConfig.sanfonas.length,
      aberta: false,
      templates: []
    });
    agendarRerender();
  });
  // Salvar
  document.getElementById('btnMktSalvar').addEventListener('click', async () => {
    const btn = document.getElementById('btnMktSalvar');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      await salvarMarketingConfig({ sanfonas: mktConfig.sanfonas });
      alert('✓ Alterações salvas! Voltando pra visão normal.');
      mktModoGerenciar = false;
      carregarMarketing();
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 Salvar alterações';
    }
  });
}

async function uploadArquivoTemplate(si, ti, campo) {
  const aceito = campo === 'arquivo' ? '.html,text/html' : 'image/*';
  const input = document.createElement('input');
  input.type = 'file'; input.accept = aceito;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    // Limite: 8MB pro HTML (templates bundled), 2MB pra imagem
    const limite = campo === 'arquivo' ? 8 : 2;
    if (file.size > limite * 1024 * 1024) { alert(`Arquivo muito grande. Máx ${limite}MB.`); return; }
    try {
      const sanfonaId = mktConfig.sanfonas[si].id;
      const templateId = mktConfig.sanfonas[si].templates[ti].id;
      const ext = campo === 'arquivo' ? 'html' : (file.name.split('.').pop() || 'jpg');
      const path = `marketing/${sanfonaId}/${templateId}-${Date.now()}.${ext}`;
      const ref = storageRef(storage, path);
      const snap = await uploadBytesResumable(ref, file);
      const url = await getDownloadURL(snap.ref);
      mktConfig.sanfonas[si].templates[ti][campo] = url;
      agendarRerender();
    } catch (e) {
      alert('Erro no upload: ' + e.message);
    }
  };
  input.click();
}

document.getElementById('btnMktGerenciar')?.addEventListener('click', () => {
  mktModoGerenciar = !mktModoGerenciar;
  carregarMarketing();
});

// Clicar em qualquer lugar fora da paleta de ícones fecha ela
document.addEventListener('click', (e) => {
  if (e.target.closest('.mkt-emoji-wrap') || e.target.closest('.mkt-emoji-pop')) return; // clique dentro do seletor/paleta: ignora
  document.querySelectorAll('.mkt-emoji-pop').forEach(p => { p.style.display = 'none'; });
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
    // eslint-disable-next-line no-self-assign -- reatribuir src recarrega o iframe (puxa o conteúdo atual do Drive)
    if (frame) frame.src = frame.src;
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
    const nomePend = { cpf:'CPF', rg:'RG', rgcpf:'RG/CPF', profissao:'Profissão', renda:'Renda', banco:'Banco', tipoConta:'Tipo conta', agencia:'Agência', conta:'Conta', pix:'Pix', rgFrente:'RG frente', rgVerso:'RG verso', compRenda:'Comp. renda', compEndereco:'Comp. endereço', compEstadoCivil:'Estado civil', matricula:'Matrícula', iptu:'IPTU', energia:'Energia', agua:'Água', gas:'Gás', condominio:'Condomínio', condominio_doc:'Condomínio', iptu_doc:'IPTU', im_condominio:'Condomínio', im_admcond:'Adm. condominial', im_iptu:'IPTU', im_valorcond:'Valor condomínio', im_enel:'ENEL', im_sabesp:'Sabesp', im_comgas:'Comgás', im_contribuinte:'Contribuinte IPTU', im_entrada:'Entrada', im_financiamento:'Financiamento', im_fgts:'FGTS', com_parc_nome:'Parceira', com_parc_cnpj:'CNPJ parceira', com_parc_banco:'Banco parceira', com_parc_agencia:'Agência parceira', com_parc_conta:'Conta parceira', com_parc_valor:'Comissão parceira' };

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
                <strong style="font-size:13px">${escapeHtml(d.nome || 'Sem nome')}</strong>
                <span style="font-size:11px;color:var(--text-muted);margin-left:8px">Corretor: ${escapeHtml(f.corretorNome || '—')}</span>
              </div>
              <span style="font-size:11px;color:var(--text-muted)">${dataEnvio}</span>
            </div>
            ${pends > 0 ? `<div style="font-size:11px;color:#b45309;margin-top:4px">⚠ Pendente: ${f.pendentes.map(p=>escapeHtml(nomePend[p]||p)).join(', ')}</div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              <button class="topbar-btn primario btn-baixar-docs" data-id="${f.id}" style="font-size:11px;padding:4px 10px">📥 Baixar documentos</button>
              <button class="topbar-btn btn-ver-dados" data-id="${f.id}" style="font-size:11px;padding:4px 10px">Ver dados ▾</button>
              <button class="topbar-btn btn-finalizar" data-id="${f.id}" style="font-size:11px;padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:var(--radius-btn)">✓ Marcar analisado</button>
            </div>
            <div id="dados-${f.id}" style="display:none;margin-top:10px;font-size:12px;border-top:1px solid var(--border);padding-top:10px">
              <div class="row-dados" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
                ${[['Nome',d.nome],['CPF',d.cpf],['RG',d.rg],['Nascimento',d.dataNasc],['Estado civil',d.estadoCivil],['Profissão',d.profissao],['Renda',d.renda],['WhatsApp',d.whatsapp],['E-mail',d.email],['CEP',d.cep],['Endereço',`${d.logradouro||''} ${d.numero||''} ${d.complemento||''}`],['Bairro',d.bairro],['Cidade',`${d.cidade||''}/${d.estado||''}`],['Banco',d.banco],['Agência',d.agencia],['Conta',`${d.conta||''} (${d.tipoConta||''})`],['Pix',d.pix]].filter(([,v])=>v).map(([k,v])=>`<div style="margin-bottom:3px"><span style="color:var(--text-muted)">${k}:</span> ${escapeHtml(v)}</div>`).join('')}
              </div>
              ${docs.length > 0 ? `<div style="margin-top:8px;font-weight:600;font-size:12px;margin-bottom:4px">Documentos:</div><div style="display:flex;flex-wrap:wrap;gap:6px">${docs.map(([k,url])=> /^https?:/i.test(url) ? `<a href="${escapeHtml(url)}" target="_blank" class="topbar-btn" style="font-size:11px;padding:4px 10px">${escapeHtml(nomesDoc[k]||k)} ↗</a>` : '').join('')}</div>` : '<p style="font-size:11px;color:var(--text-muted);margin-top:6px">Nenhum documento enviado.</p>'}
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

// ─── Imóveis (esteira das captações — Gestão de Locações) ────────────────────
const IMOVEL_STATUS = [
  { key: 'recebido',    label: 'Recebido',    cor: '#b45309' },
  { key: 'em_analise',  label: 'Em análise',  cor: '#6366f1' },
  { key: 'aprovado',    label: 'Aprovado',    cor: '#16a34a' },
  { key: 'em_contrato', label: 'Em contrato', cor: '#0ea5e9' },
  { key: 'ativo',       label: 'Ativo',       cor: '#002749' }
];
const imovelLabel = k => (IMOVEL_STATUS.find(s => s.key === k) || {}).label || k;
const imovelCor   = k => (IMOVEL_STATUS.find(s => s.key === k) || {}).cor   || '#6b7280';
const IMOVEL_STATUS_SO_GESTOR = ['aprovado', 'em_contrato', 'ativo'];

// Checklist padrão da esteira de LOCAÇÃO (baseado no fluxo definido pelo gestor).
// Cada item tem uma chave curta (grava em imovel.checklist[chave] = true/false) e o rótulo.
const LOC_CHECKLIST = [
  { k: 'docs',                 l: 'Documentação completa e ficha cadastral no drive' },
  { k: 'analise',              l: 'Análise de crédito aprovada' },
  { k: 'contrato',             l: 'Contrato assinado' },
  { k: 'vistoria',             l: 'Vistoria assinada' },
  { k: 'seguro_fianca',        l: 'Seguro fiança emitido' },
  { k: 'transf_enel',          l: 'Transferência ENEL' },
  { k: 'seguro_incendio',      l: 'Seguro incêndio' },
  { k: 'chaves',               l: 'Entrega de chaves' },
  { k: 'cadastro_sistema',     l: 'Cadastrar locação no sistema' },
  { k: 'gerar_cobranca',       l: 'Gerar cobrança' },
  { k: 'acompanhamento',       l: 'Acompanhamento' },
  { k: 'conferir_transf_enel', l: 'Conferir transferência ENEL' }
];
// Itens que o sistema marca sozinho (derivados de análise/garantia/vistoria/contrato/ativo).
// O backend (recomputarChecklistAuto) persiste em imovel.checklist; a UI mostra read-only.
const CHECKLIST_AUTO = new Set(['analise', 'seguro_fianca', 'vistoria', 'contrato', 'cadastro_sistema', 'gerar_cobranca']);

// Abre seletor de imagem/PDF, valida o tamanho e devolve o File (ou null).
function _escolherDoc(maxMB = 20) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      if (f.size > maxMB * 1024 * 1024) { alert(`Arquivo muito grande (máx ${maxMB}MB).`); return resolve(null); }
      resolve(f);
    };
    inp.click();
  });
}
// Sobe um documento da locação pro Storage e devolve a URL (gestor/admin autenticado).
async function _uploadLocacao(imovelId, prefixo, file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const sRef = storageRef(storage, `locacao/${imovelId}/${prefixo}-${Date.now()}.${ext}`);
  const task = await uploadBytesResumable(sRef, file);
  return await getDownloadURL(task.ref);
}
const fmtBRL = n => n == null || n === '' ? '' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDataBR = s => { if (!s) return ''; const [y,m,d] = String(s).split('-'); return (d && m && y) ? `${d}/${m}/${y}` : s; };
// Status derivado da comissão a partir das datas das parcelas
function statusComissao(im) {
  const c1 = !!im.comissao1Data, c2 = !!im.comissao2Data;
  if (c1 && c2) return { txt: 'Total recebida', cor: '#16a34a' };
  if (c1) return { txt: '1ª parcela recebida', cor: '#b45309' };
  return { txt: 'Comissão pendente', cor: '#DC1C2E' };
}
// Progresso da checklist (0-100)
function progressoChecklist(im) {
  const c = im.checklist || {};
  const feitos = LOC_CHECKLIST.filter(x => c[x.k]).length;
  return { feitos, total: LOC_CHECKLIST.length, pct: Math.round((feitos / LOC_CHECKLIST.length) * 100) };
}
// Formato "0001-07/26" — número zero-padded + mês/ano-curto do criadoEm.
function fmtProtocolo(im) {
  if (im.numeroProtocolo == null) return '';
  const num = String(im.numeroProtocolo).padStart(4, '0');
  const dt = im.criadoEm ? new Date(im.criadoEm) : new Date();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const aa = String(dt.getFullYear()).slice(-2);
  return `${num}-${mm}/${aa}`;
}
const IMOVEL_NOMES_DOC = { rgcpf:'RG e CPF', energia:'Conta de energia', agua:'Conta de água', gas:'Conta de gás', iptu_doc:'Documento do IPTU', condominio_doc:'Doc. do condomínio' };
const IMOVEL_NOMES_PEND = { rgcpf:'RG e CPF', energia:'Conta de energia', agua:'Conta de água', gas:'Conta de gás', iptu_doc:'Documento do IPTU', condominio_doc:'Doc. do condomínio', profissao:'Profissão', im_admcond:'Adm. condominial', im_admcontato:'Contato adm', im_condominio:'Condomínio', im_iptu:'IPTU', im_valorcond:'Valor condomínio', im_enel:'ENEL', im_sabesp:'Sabesp', im_comgas:'Comgás', im_contribuinte:'Contribuinte IPTU' };
let imoveisRole = 'corretor'; // papel do usuário atual na aba Imóveis (setado em carregarImoveis)
let _imoveisCache = null;        // { imoveis, veTudo, role } — evita refetch ao filtrar
let imoveisFiltroStatus = null;  // filtro por status via quadrados (null = todos)
const GAR_MOD_LABEL = { seguro_fianca:'Seguro fiança', fiador:'Fiador', caucao:'Caução', titulo_capitalizacao:'Título de capitalização' };
const GAR_STATUS_LABEL = { pendente:'Pendente', aprovada:'Aprovada', reprovada:'Reprovada' };
const ANALISE_LABEL = { em_analise:'Em análise', pendencia:'Pendência', aprovado:'Aprovado', reprovado:'Reprovado' };
const ANALISE_COR   = { em_analise:'#6366f1', pendencia:'#b45309', aprovado:'#16a34a', reprovado:'#DC1C2E' };
const _selStyle = 'font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)';

// Renderiza o detalhe completo de um imóvel (retorno de locObterImovel).
function renderDetalheImovel(d) {
  const lin = (r, v) => v ? `<div style="display:flex;gap:8px;padding:2px 0;font-size:12px"><span style="color:var(--text-muted);min-width:120px;flex-shrink:0">${r}</span><span style="word-break:break-word">${escapeHtml(v)}</span></div>` : '';
  const sec = (t, corpo) => corpo ? `<div style="margin-top:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">${t}</div>${corpo}</div>` : '';
  const im = d.imovel || {};

  const podeGerarLink = (imoveisRole === 'gestor' || imoveisRole === 'administrativo');
  const locHtml = (d.locadores || []).map((p, i) => {
    const e = p.endereco || {};
    const end = [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean).join(', ');
    const conj = p.conjuge ? lin('Cônjuge', [p.conjuge.nome, p.conjuge.cpf].filter(Boolean).join(' · ')) : '';
    const linkBtn = podeGerarLink ? `<div style="margin-top:8px">
        <button class="topbar-btn btn-link-proprietario" data-pessoa="${escapeHtml(p.id)}" style="font-size:11px;padding:3px 10px">🔗 Link de consulta do proprietário</button>
        <div class="link-prop-box" data-pessoa="${escapeHtml(p.id)}" style="margin-top:6px"></div></div>` : '';
    return sec((d.locadores.length > 1 ? `Locador ${i + 1}` : 'Locador'),
      lin('Nome', p.nome) + lin('CPF', p.cpf) + lin('RG', p.rg) + lin('Nascimento', p.dataNasc) + lin('Estado civil', p.estadoCivil) + lin('Profissão', p.profissao) + lin('E-mail', p.email) + lin('WhatsApp', p.whatsapp) + lin('Telefone', p.fixo) + lin('Endereço', end) + conj + linkBtn);
  }).join('');

  const e = im.endereco || {};
  const endImovel = [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean).join(', ');
  const inst = [im.instalacoes?.enel && 'ENEL ' + im.instalacoes.enel, im.instalacoes?.sabesp && 'Sabesp ' + im.instalacoes.sabesp, im.instalacoes?.comgas && 'Comgás ' + im.instalacoes.comgas].filter(Boolean).join(' · ');
  const imovelHtml = sec('Imóvel',
    lin('Tipo', im.tipo) + lin('Referência', im.referencia) + lin('Endereço', endImovel) + lin('Condomínio', im.condominio) + lin('Adm. condominial', im.admCondominial) + lin('Contato adm', im.admContato) + lin('Valor condomínio', im.valorCondominio) + lin('IPTU', im.iptu) + lin('Contribuinte IPTU', im.contribuinteIptu) + lin('Instalações', inst) + lin('Início pretendido', im.inicioPretendido) + lin('Valor anúncio', im.valorAnuncio) + lin('Valor proposta', im.valorProposta));

  const t1 = im.repasse?.titular1 || {}, t2 = im.repasse?.titular2 || {};
  const banc = t => [t.banco && 'Banco ' + t.banco, t.agencia && 'Ag ' + t.agencia, t.conta && 'Conta ' + t.conta, t.favorecido, t.pix && 'PIX ' + t.pix].filter(Boolean).join(' · ');
  const repasseHtml = sec('Repasse (dados bancários)', lin('Titular 1', banc(t1)) + lin('Titular 2', banc(t2)));

  const adm = im.administracao || {};
  const admHtml = sec('Administração', lin('REMAX administra?', adm.remaxAdministra) + lin('Taxa', adm.taxa) + lin('Tipo de repasse', adm.tipoRepasse) + lin('Observações', adm.observacoes));

  const docs = Object.entries(im.documentos || {}).filter(([, url]) => /^https?:/i.test(url));
  const docsHtml = docs.length ? sec('Documentos', `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${docs.map(([k, url]) => `<a href="${escapeHtml(url)}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:4px 10px;border-radius:14px;background:#16a34a18;color:#16a34a;border:1px solid #16a34a40;text-decoration:none;font-weight:600">✓ ${escapeHtml(IMOVEL_NOMES_DOC[k] || k)}</a>`).join('')}</div>`) : '';

  const pend = im.pendentes || [];
  const pendHtml = pend.length ? sec('Pendências', `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${pend.map(p => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 9px;border-radius:14px;background:#b4530918;color:#b45309;border:1px solid #b4530940;font-weight:600">⚠ ${escapeHtml(IMOVEL_NOMES_PEND[p] || p)}</span>`).join('')}</div>`) : '';

  const hist = im.historico || [];
  const histHtml = hist.length ? sec('Histórico de status', hist.map(h => {
    const dt = h.em ? new Date(h.em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    return `<div style="font-size:11px;color:var(--text-muted);padding:1px 0">${imovelLabel(h.de)} → ${imovelLabel(h.para)} · ${escapeHtml(h.porNome || '—')} · ${dt}</div>`;
  }).join('')) : '';

  // Seção de gestão (locatário + garantia) — só p/ gestor/administrativo
  let gestaoHtml = '';
  if (imoveisRole === 'gestor' || imoveisRole === 'administrativo') {
    const ehGestor = imoveisRole === 'gestor';
    const imId = im.id;

    const locatarios = d.locatarios || [];
    const locG = locatarios.length ? locatarios.map(l => {
      const st = (l.analise || {}).status || 'em_analise';
      const acoes = ehGestor ? `<div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
        <button class="topbar-btn btn-analise" data-pessoa="${l.id}" data-status="aprovado" style="font-size:10px;padding:3px 8px">✓ Aprovar</button>
        <button class="topbar-btn btn-analise" data-pessoa="${l.id}" data-status="pendencia" style="font-size:10px;padding:3px 8px">Pendência</button>
        <button class="topbar-btn btn-analise" data-pessoa="${l.id}" data-status="reprovado" style="font-size:10px;padding:3px 8px">Reprovar</button></div>` : '';
      const ldocs = Array.isArray(l.documentos) ? l.documentos : [];
      const ldocsHtml = ldocs.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">${ldocs.map(dc => `<a href="${escapeHtml(dc.url)}" target="_blank" style="font-size:10px;padding:2px 8px;border-radius:12px;background:#16a34a18;color:#16a34a;border:1px solid #16a34a40;text-decoration:none;font-weight:600">📄 ${escapeHtml(dc.nome || 'doc')}</a>`).join('')}</div>` : '';
      return `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong style="font-size:12px">${escapeHtml(l.nome || '')}</strong>
          <span style="font-size:10px;font-weight:600;color:${ANALISE_COR[st]};background:${ANALISE_COR[st]}18;padding:2px 7px;border-radius:5px">${ANALISE_LABEL[st] || st}</span></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${[l.cpf, l.renda && 'Renda ' + l.renda, l.whatsapp].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</div>
        ${ldocsHtml}
        ${acoes}
        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
          <button class="topbar-btn btn-doc-locatario" data-pessoa="${l.id}" style="font-size:10px;padding:3px 8px">📎 Documento</button>
          <button class="topbar-btn btn-link-proprietario" data-pessoa="${l.id}" style="font-size:10px;padding:3px 8px">🔗 Link do inquilino</button>
        </div>
        <div class="link-prop-box" data-pessoa="${l.id}" style="margin-top:6px"></div></div>`;
    }).join('') : '<div style="font-size:11px;color:var(--text-muted)">Nenhum locatário cadastrado.</div>';

    const inp = (ph, cls) => `<input class="${cls}" placeholder="${ph}" style="${_selStyle}">`;
    const formLoc = `<div style="margin-top:8px">
      <button class="topbar-btn btn-vincular-ficha" data-imovel="${imId}" style="font-size:11px;padding:4px 10px">🔗 Vincular ficha recebida</button>
      <div class="vincular-ficha-box" data-imovel="${imId}" style="margin-top:8px"></div>
      <details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">ou digitar à mão</summary>
        <div class="form-add-locatario" data-imovel="${imId}" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:5px">
          ${inp('Nome*', 'ni-nome')}${inp('CPF', 'ni-cpf')}${inp('WhatsApp', 'ni-whats')}${inp('Renda', 'ni-renda')}
          <button class="topbar-btn primario btn-add-locatario" style="font-size:11px;padding:4px 10px">+ Adicionar</button></div>
      </details></div>`;

    const g = d.garantia || {};
    const optSel = (obj, val) => Object.entries(obj).map(([k, lbl]) => `<option value="${k}"${k === val ? ' selected' : ''}>${lbl}</option>`).join('');
    const garForm = ehGestor ? `<div class="form-garantia" data-imovel="${imId}" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">
      <select class="gar-mod" style="${_selStyle}">${optSel(GAR_MOD_LABEL, g.modalidade || 'seguro_fianca')}</select>
      <select class="gar-status" style="${_selStyle}">${optSel(GAR_STATUS_LABEL, g.status || 'pendente')}</select>
      <input class="gar-apolice" placeholder="Link da apólice (ou anexe)" value="${escapeHtml(g.apoliceUrl || '')}" style="${_selStyle}">
      <button class="topbar-btn btn-anexar-apolice" data-imovel="${imId}" style="font-size:11px;padding:4px 10px">📎 Anexar</button>
      <button class="topbar-btn primario btn-salvar-garantia" style="font-size:11px;padding:4px 10px">Salvar garantia</button></div>`
      : `<div style="font-size:12px">${g.modalidade ? GAR_MOD_LABEL[g.modalidade] : '—'} · <strong>${g.status ? GAR_STATUS_LABEL[g.status] : 'sem garantia'}</strong></div>`;

    // Contrato
    const CT_STATUS_LABEL = { rascunho:'Rascunho', assinatura:'Em assinatura', ativo:'Ativo', encerrado:'Encerrado' };
    const CT_STATUS_COR   = { rascunho:'#b45309', assinatura:'#6366f1', ativo:'#16a34a', encerrado:'#6b7280' };
    const c = d.contrato;
    let contratoHtml;
    if (c && ehGestor) {
      const numInp = (cls, val) => `<input class="${cls}" type="number" step="0.01" value="${val != null ? val : ''}" style="${_selStyle};width:110px">`;
      const editavel = c.status !== 'ativo';
      const dis = editavel ? '' : ' disabled';
      contratoHtml = `<div class="form-contrato" data-contrato="${c.id}">
        <div style="margin-bottom:8px"><span style="font-size:11px;font-weight:600;color:${CT_STATUS_COR[c.status]};background:${CT_STATUS_COR[c.status]}18;padding:2px 8px;border-radius:5px">${CT_STATUS_LABEL[c.status] || c.status}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 10px">
          <label style="font-size:11px;color:var(--text-muted)">Aluguel R$ ${numInp('ct-aluguel', c.valorAluguel)}</label>
          <label style="font-size:11px;color:var(--text-muted)">Condomínio R$ ${numInp('ct-cond', c.valorCondominio)}</label>
          <label style="font-size:11px;color:var(--text-muted)">IPTU R$ ${numInp('ct-iptu', c.valorIptu)}</label>
          <label style="font-size:11px;color:var(--text-muted)">Taxa adm % ${numInp('ct-taxa', c.taxaAdm)}</label>
          <label style="font-size:11px;color:var(--text-muted)">Dia venc. <input class="ct-dia" type="number" min="1" max="28" value="${c.diaVencimento || 10}" style="${_selStyle};width:60px"></label>
          <label style="font-size:11px;color:var(--text-muted)">Índice <input class="ct-indice" value="${escapeHtml(c.indiceReajuste || 'IGP-M')}" style="${_selStyle};width:90px"></label>
          <label style="font-size:11px;color:var(--text-muted)">Início <input class="ct-ini" type="date" value="${escapeHtml(c.vigenciaInicio || '')}" style="${_selStyle}"${dis}></label>
          <label style="font-size:11px;color:var(--text-muted)">Fim <input class="ct-fim" type="date" value="${escapeHtml(c.vigenciaFim || '')}" style="${_selStyle}"${dis}></label>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          ${editavel ? `<button class="topbar-btn btn-salvar-contrato" style="font-size:11px;padding:4px 10px">Salvar contrato</button>` : ''}
          ${c.status !== 'ativo' ? `<button class="topbar-btn primario btn-ativar-contrato" data-contrato="${c.id}" style="font-size:11px;padding:4px 10px">✓ Ativar contrato</button>` : '<span style="font-size:11px;color:#16a34a;align-self:center">Contrato ativo — cobranças geradas (veja no Financeiro).</span>'}
        </div></div>`;
    } else if (c) {
      contratoHtml = `<div style="font-size:12px">Status: <strong>${CT_STATUS_LABEL[c.status] || c.status}</strong> · Aluguel R$ ${escapeHtml(String(c.valorAluguel || 0))} · Venc. dia ${escapeHtml(String(c.diaVencimento || '—'))}</div>`;
    } else if (ehGestor) {
      contratoHtml = d.podeContratar
        ? `<button class="topbar-btn primario btn-gerar-contrato" data-imovel="${imId}" style="font-size:11px;padding:4px 10px">Gerar contrato</button>`
        : `<div style="font-size:11px;color:var(--text-muted)">Aprove a análise do locatário e a garantia pra liberar a geração do contrato.</div>`;
    } else {
      contratoHtml = '<div style="font-size:11px;color:var(--text-muted)">Sem contrato ainda.</div>';
    }

    gestaoHtml = sec('Locatário &amp; análise', locG + formLoc) + sec('Garantia', garForm) + sec('Contrato', contratoHtml);
    // Excluir imóvel (só gestor) — cascata, irreversível
    if (ehGestor) {
      gestaoHtml += `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
        <button class="topbar-btn perigo btn-excluir-imovel" data-imovel="${imId}" style="font-size:11px;padding:4px 10px">🗑 Excluir imóvel</button>
        <span style="font-size:10px;color:var(--text-muted);margin-left:8px">Apaga imóvel, locatários, garantia, contrato e financeiro. Não desfaz.</span></div>`;
    }
  }

  // Vistorias — quem vê o detalhe pode registrar (corretor dono executa; gestor/admin acompanham)
  const VIST_LABEL = { agendada:'Agendada', realizada:'Realizada', laudo_emitido:'Laudo emitido' };
  const vistorias = d.vistorias || [];
  const vistList = vistorias.length ? vistorias.map(v => {
    const laudo = /^https?:/i.test(v.laudoUrl || '') ? ` · <a href="${escapeHtml(v.laudoUrl)}" target="_blank">laudo ↗</a>` : '';
    return `<div style="font-size:12px;padding:3px 0">${v.tipo === 'entrada' ? 'Entrada' : 'Saída'} — <strong>${VIST_LABEL[v.status] || v.status}</strong>${laudo}</div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-muted)">Nenhuma vistoria registrada.</div>';
  const vistForm = `<div class="form-vistoria" data-imovel="${im.id}" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">
    <select class="vi-tipo" style="${_selStyle}"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
    <select class="vi-status" style="${_selStyle}"><option value="agendada">Agendada</option><option value="realizada">Realizada</option><option value="laudo_emitido">Laudo emitido</option></select>
    <input class="vi-laudo" placeholder="Link do laudo (opcional)" style="${_selStyle}">
    <button class="topbar-btn primario btn-add-vistoria" style="font-size:11px;padding:4px 10px">Registrar vistoria</button></div>`;
  const vistoriaHtml = sec('Vistorias', vistList + vistForm);

  const FICHAS_IMOVEL = [
    { key: 'pf', label: 'Pessoa Física', arquivo: 'ficha-pf.html' },
    { key: 'pj', label: 'Pessoa Jurídica', arquivo: 'ficha-pj.html' },
    { key: 'fianca', label: 'Fiança', arquivo: 'ficha-fianca.html' },
  ];
  const fichasBtns = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    ${FICHAS_IMOVEL.map(fi => `<button class="topbar-btn primario btn-nova-ficha-imovel" data-imovel="${im.id}" data-tipo="${fi.key}" data-arquivo="${fi.arquivo}" style="font-size:11px;padding:4px 10px">+ ${escapeHtml(fi.label)}</button>`).join('')}</div>`;
  const fichasImovelHtml = sec('Fichas vinculadas', `<div class="fichas-imovel-lista" data-imovel="${im.id}"><div style="font-size:11px;color:var(--text-muted)">Carregando fichas...</div></div>${fichasBtns}`);

  // Bloco "Esteira de Locação" — editor de campos financeiros + checklist (Opção A)
  const chk = im.checklist || {};
  const _lblSty = 'display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-muted)';
  const _inp = (cls, ph, val, tipo) => `<input class="${cls}" type="${tipo || 'text'}" placeholder="${ph || ''}" value="${val == null ? '' : escapeHtml(String(val))}" style="${_selStyle};width:100%">`;
  const _sel = (cls, val, opts) => `<select class="${cls}" style="${_selStyle};width:100%"><option value=""${!val ? ' selected' : ''}>—</option>${opts.map(([k,l]) => `<option value="${k}"${val === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const SIM_NAO = [['sim','Sim'],['nao','Não']];
  const locFormHtml = `<div class="form-loc-esteira" data-imovel="${im.id}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-bottom:12px">
      <label style="${_lblSty}">Valor de fechamento (R$)${_inp('lf-fechamento','R$ do aluguel', im.valorFechamento, 'number')}</label>
      <label style="${_lblSty}">Valor de comissão (R$)${_inp('lf-comissao','valor total', im.valorComissao, 'number')}</label>
      <label style="${_lblSty}">1ª parcela recebida em${_inp('lf-com1','', im.comissao1Data, 'date')}</label>
      <label style="${_lblSty}">2ª parcela recebida em${_inp('lf-com2','', im.comissao2Data, 'date')}</label>
      <label style="${_lblSty}">REMAX administra?${_sel('lf-adm', im.possuiAdministracao, SIM_NAO)}</label>
      <label style="${_lblSty}">Contrato assinado?${_sel('lf-contrato', im.contratoAssinado, SIM_NAO)}</label>
      <label style="${_lblSty}">Possui parceria?${_sel('lf-parceria', im.possuiParceria, SIM_NAO)}</label>
    </div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:4px 0 6px">Checklist de locação <span style="font-weight:500;text-transform:none;letter-spacing:0">· itens ✓ automático são atualizados pelo sistema</span></div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px">
      ${LOC_CHECKLIST.map(x => {
        const feito = !!chk[x.k];
        if (CHECKLIST_AUTO.has(x.k)) {
          return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
            <span style="width:15px;flex-shrink:0;text-align:center;color:${feito ? '#16a34a' : 'var(--text-muted)'}">${feito ? '✓' : '○'}</span>
            <span style="color:${feito ? 'var(--text-primary)' : 'var(--text-muted)'}">${escapeHtml(x.l)}</span>
            <span style="font-size:9px;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);padding:1px 6px;border-radius:10px">automático</span></div>`;
        }
        return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
          <input type="checkbox" class="lf-chk" data-k="${x.k}"${feito ? ' checked' : ''} style="width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <span>${escapeHtml(x.l)}</span></label>`;
      }).join('')}
    </div>
    <button class="topbar-btn primario btn-salvar-loc" style="font-size:11px;padding:5px 12px">Salvar</button>
    <span class="lf-msg" style="font-size:11px;margin-left:8px"></span>
  </div>`;
  const esteiraHtml = sec('Esteira de Locação', locFormHtml);

  // Layout em 2 colunas: dados cadastrais + histórico à esquerda (com as fichas e
  // o checklist logo abaixo do histórico) · gestão/vistoria à direita.
  const colEsq = locHtml + imovelHtml + repasseHtml + admHtml + docsHtml + pendHtml + histHtml + fichasImovelHtml + esteiraHtml;
  const colDir = gestaoHtml + vistoriaHtml;
  const conteudo = colEsq + colDir;
  if (!conteudo) return '<p style="color:var(--text-muted)">Sem dados.</p>';
  const protocolo = im.numeroProtocolo != null ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--hover);border:1px solid var(--border);padding:3px 10px;border-radius:6px;letter-spacing:.06em">PROTOCOLO ${fmtProtocolo(im)}</span></div>` : '';
  return `${protocolo}<div class="imovel-det-grid" style="display:grid;grid-template-columns:${colDir ? '1fr 1fr' : '1fr'};gap:24px">
    <div>${colEsq}</div>
    ${colDir ? `<div>${colDir}</div>` : ''}
  </div>`;
}

// Liga os controles de gestão (locatário/garantia) dentro de um painel de detalhe.
function wireDetalheImovel(cont, imovelId, imovelData) {
  cont.querySelectorAll('.btn-analise').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await locAnalisarLocatario({ pessoaId: btn.dataset.pessoa, status: btn.dataset.status });
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    });
  });
  const formLoc = cont.querySelector('.form-add-locatario');
  if (formLoc) {
    const btn = formLoc.querySelector('.btn-add-locatario');
    btn.addEventListener('click', async () => {
      const nome = formLoc.querySelector('.ni-nome').value.trim();
      if (!nome) { alert('Informe ao menos o nome do locatário.'); return; }
      btn.disabled = true;
      try {
        await locAddLocatario({ imovelId, dados: {
          nome,
          cpf: formLoc.querySelector('.ni-cpf').value.trim(),
          whatsapp: formLoc.querySelector('.ni-whats').value.trim(),
          renda: formLoc.querySelector('.ni-renda').value.trim()
        }});
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    });
  }
  // vincular uma ficha recebida (PF/PJ/Loc. c/ fiador) como locatário
  const btnVinc = cont.querySelector('.btn-vincular-ficha');
  if (btnVinc) {
    const box = cont.querySelector('.vincular-ficha-box');
    btnVinc.addEventListener('click', async () => {
      box.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">Buscando fichas recebidas...</span>';
      try {
        const r = await locFichasParaVincular({ imovelId });
        const fichas = r.data?.fichas || [];
        if (!fichas.length) { box.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">Nenhuma ficha recebida deste corretor. Gere um link na aba Cadastro.</span>'; return; }
        const TIPO_LBL = { pf: 'PF', pj: 'PJ', locacao_fiador: 'Loc. c/ fiador' };
        box.innerHTML = fichas.map(f => `
          <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin-bottom:5px">
            <div style="flex:1;min-width:0"><strong style="font-size:12px">${escapeHtml(f.nome)}</strong>
              <div style="font-size:10px;color:var(--text-muted)">${TIPO_LBL[f.tipo] || f.tipo}${f.cpf ? ' · ' + escapeHtml(f.cpf) : ''}</div></div>
            ${f.jaVinculada
              ? '<span style="font-size:10px;color:#16a34a">✓ vinculada</span>'
              : `<button class="topbar-btn primario btn-do-vincular" data-ficha="${escapeHtml(f.id)}" style="font-size:10px;padding:3px 10px">Vincular</button>`}
          </div>`).join('');
        box.querySelectorAll('.btn-do-vincular').forEach(b => b.addEventListener('click', async () => {
          b.disabled = true;
          try { await locVincularFichaLocatario({ imovelId, fichaId: b.dataset.ficha }); await recarregarDetalhe(cont, imovelId); }
          catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
        }));
      } catch (e) { box.innerHTML = `<span style="font-size:11px;color:var(--danger)">Erro: ${escapeHtml(e.message)}</span>`; }
    });
  }
  // gerar link de consulta do proprietário (portal externo, sem senha)
  cont.querySelectorAll('.btn-link-proprietario').forEach(btn => btn.addEventListener('click', async () => {
    const box = cont.querySelector(`.link-prop-box[data-pessoa="${btn.dataset.pessoa}"]`);
    btn.disabled = true;
    box.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">Gerando link...</span>';
    try {
      const r = await locGerarTokenPortal({ pessoaId: btn.dataset.pessoa });
      const url = r.data?.url || '';
      const ehInq = r.data?.papel === 'inquilino';
      const quem = ehInq ? 'inquilino' : 'proprietário';
      const oque = ehInq ? 'os pagamentos' : 'os repasses';
      box.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input readonly value="${escapeHtml(url)}" style="flex:1;min-width:220px;font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)">
          <button class="topbar-btn btn-copiar-link" style="font-size:11px;padding:4px 10px">Copiar</button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Envie ao ${quem} (WhatsApp/e-mail). Ele consulta ${oque} sem senha. O link é fixo — regerar invalida o anterior.</div>`;
      const inp = box.querySelector('input');
      inp.focus(); inp.select();
      box.querySelector('.btn-copiar-link').addEventListener('click', async (ev) => {
        try { await navigator.clipboard.writeText(url); } catch (_) { inp.select(); try { document.execCommand('copy'); } catch (__) {} }
        ev.target.textContent = '✓ Copiado'; setTimeout(() => { ev.target.textContent = 'Copiar'; }, 1500);
      });
    } catch (e) { box.innerHTML = `<span style="font-size:11px;color:var(--danger)">Erro: ${escapeHtml(e.message)}</span>`; }
    btn.disabled = false;
  }));
  // Anexar apólice da garantia (upload → preenche o campo; "Salvar garantia" persiste)
  cont.querySelectorAll('.btn-anexar-apolice').forEach(btn => btn.addEventListener('click', async () => {
    const file = await _escolherDoc(20);
    if (!file) return;
    const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const url = await _uploadLocacao(btn.dataset.imovel, 'apolice', file);
      const inp = cont.querySelector('.gar-apolice');
      if (inp) inp.value = url;
      btn.textContent = '✓ anexado (salve a garantia)';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    } catch (e) { alert('Erro no upload: ' + e.message); btn.textContent = orig; btn.disabled = false; }
  }));
  // Anexar documento do locatário (upload → salva no locatário → recarrega)
  cont.querySelectorAll('.btn-doc-locatario').forEach(btn => btn.addEventListener('click', async () => {
    const file = await _escolherDoc(20);
    if (!file) return;
    const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const url = await _uploadLocacao(imovelId, `locatario/${btn.dataset.pessoa}`, file);
      await locAddDocLocatario({ pessoaId: btn.dataset.pessoa, nome: file.name, url });
      await recarregarDetalhe(cont, imovelId);
    } catch (e) { alert('Erro: ' + e.message); btn.textContent = orig; btn.disabled = false; }
  }));
  // Esteira de Locação: financeiro + checklist
  const formLocE = cont.querySelector('.form-loc-esteira');
  if (formLocE) {
    const btn = formLocE.querySelector('.btn-salvar-loc');
    const msg = formLocE.querySelector('.lf-msg');
    btn.addEventListener('click', async () => {
      btn.disabled = true; msg.textContent = 'salvando...'; msg.style.color = 'var(--text-muted)';
      const checklist = {};
      formLocE.querySelectorAll('.lf-chk').forEach(c => { checklist[c.dataset.k] = c.checked; });
      const campos = {
        valorFechamento: formLocE.querySelector('.lf-fechamento').value,
        valorComissao:   formLocE.querySelector('.lf-comissao').value,
        comissao1Data:   formLocE.querySelector('.lf-com1').value,
        comissao2Data:   formLocE.querySelector('.lf-com2').value,
        possuiAdministracao: formLocE.querySelector('.lf-adm').value,
        contratoAssinado:    formLocE.querySelector('.lf-contrato').value,
        possuiParceria:      formLocE.querySelector('.lf-parceria').value,
        checklist
      };
      try {
        await locSalvarCamposLocacao({ imovelId, campos });
        msg.textContent = '✓ salvo'; msg.style.color = '#16a34a';
        carregarImoveis(); // atualiza os cards (badges, valores, progresso)
      } catch (e) { msg.textContent = 'Erro: ' + e.message; msg.style.color = 'var(--danger)'; }
      finally { btn.disabled = false; }
    });
  }

  const formGar = cont.querySelector('.form-garantia');
  if (formGar) {
    const btn = formGar.querySelector('.btn-salvar-garantia');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await locSalvarGarantia({
          imovelId,
          modalidade: formGar.querySelector('.gar-mod').value,
          status: formGar.querySelector('.gar-status').value,
          apoliceUrl: formGar.querySelector('.gar-apolice').value.trim()
        });
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    });
  }
  // Excluir imóvel (só gestor)
  const btnExcluir = cont.querySelector('.btn-excluir-imovel');
  if (btnExcluir) btnExcluir.addEventListener('click', async () => {
    if (!confirm('Excluir este imóvel e TUDO vinculado (locatários, garantia, contrato, cobranças, repasses, vistorias)? Não dá pra desfazer.')) return;
    btnExcluir.disabled = true;
    try { await locExcluirImovel({ imovelId }); carregarImoveis(); }
    catch (e) { alert('Erro: ' + e.message); btnExcluir.disabled = false; }
  });

  // Vistoria: registrar
  const formVi = cont.querySelector('.form-vistoria');
  if (formVi) {
    const btn = formVi.querySelector('.btn-add-vistoria');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await locSalvarVistoria({
          imovelId,
          tipo: formVi.querySelector('.vi-tipo').value,
          status: formVi.querySelector('.vi-status').value,
          laudoUrl: formVi.querySelector('.vi-laudo').value.trim()
        });
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    });
  }
  // Contrato: gerar / salvar / ativar
  const btnGerar = cont.querySelector('.btn-gerar-contrato');
  if (btnGerar) btnGerar.addEventListener('click', async () => {
    btnGerar.disabled = true;
    try { await locCriarContrato({ imovelId }); carregarImoveis(); }
    catch (e) { alert('Erro: ' + e.message); btnGerar.disabled = false; }
  });
  const formCt = cont.querySelector('.form-contrato');
  if (formCt) {
    const btnSalvar = formCt.querySelector('.btn-salvar-contrato');
    if (btnSalvar) btnSalvar.addEventListener('click', async () => {
      btnSalvar.disabled = true;
      try {
        await locAtualizarContrato({ contratoId: formCt.dataset.contrato, dados: {
          valorAluguel: formCt.querySelector('.ct-aluguel').value,
          valorCondominio: formCt.querySelector('.ct-cond').value,
          valorIptu: formCt.querySelector('.ct-iptu').value,
          taxaAdm: formCt.querySelector('.ct-taxa').value,
          diaVencimento: formCt.querySelector('.ct-dia').value,
          indiceReajuste: formCt.querySelector('.ct-indice').value,
          vigenciaInicio: formCt.querySelector('.ct-ini').value,
          vigenciaFim: formCt.querySelector('.ct-fim').value
        }});
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btnSalvar.disabled = false; }
    });
    const btnAtivar = formCt.querySelector('.btn-ativar-contrato');
    if (btnAtivar) btnAtivar.addEventListener('click', async () => {
      if (!confirm('Ativar o contrato? O imóvel passa a "Ativo".')) return;
      btnAtivar.disabled = true;
      try { await locAtivarContrato({ contratoId: btnAtivar.dataset.contrato }); carregarImoveis(); }
      catch (e) { alert('Erro: ' + e.message); btnAtivar.disabled = false; }
    });
  }

  // Fichas vinculadas ao imóvel — pré-preenche com dados do imóvel
  const im = imovelData?.imovel || {};
  const imEnd = im.endereco || {};
  cont.querySelectorAll('.btn-nova-ficha-imovel').forEach(btn => {
    btn.addEventListener('click', () => {
      const nomeCorretor = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
      const params = {
        corretor: currentUid,
        nome: encodeURIComponent(nomeCorretor),
        imovelId: btn.dataset.imovel
      };
      const tipo = btn.dataset.tipo;
      if (tipo === 'fianca') {
        if (im.valorAnuncio) params.pre_aluguel = im.valorAnuncio;
        if (im.iptu) params.pre_iptu = im.iptu;
        if (im.valorCondominio) params.pre_condominio = im.valorCondominio;
      } else {
        if (im.tipo) params.pre_im_tipo = im.tipo;
        if (im.referencia) params.pre_im_ref = im.referencia;
        if (imEnd.cep) params.pre_im_cep = imEnd.cep;
        if (imEnd.logradouro) params.pre_im_endereco = imEnd.logradouro;
        if (imEnd.numero) params.pre_im_numero = imEnd.numero;
        if (imEnd.complemento) params.pre_im_complemento = imEnd.complemento;
        if (imEnd.bairro) params.pre_im_bairro = imEnd.bairro;
        if (imEnd.cidade) params.pre_im_cidade = imEnd.cidade;
        if (imEnd.estado) params.pre_im_estado = imEnd.estado;
        if (im.condominio) params.pre_im_condominio = im.condominio;
        if (im.valorAnuncio) params.pre_im_anuncio = im.valorAnuncio;
      }
      window.hubApi.abrirFichaLocal(btn.dataset.arquivo, params);
    });
  });
  const fichasListaEl = cont.querySelector('.fichas-imovel-lista');
  if (fichasListaEl) {
    const TIPO_LABEL = { pf:'Pessoa Física', pj:'Pessoa Jurídica', fianca:'Fiança', locador:'Locador', locacao_fiador:'Locação c/ Fiador' };
    const STATUS_LABEL = { aguardando_corretor:'Aguardando revisão', aguardando_edicao_cliente:'Aguardando cliente', enviado_admin:'Enviado ao admin', correcao_solicitada:'Correção solicitada', finalizado:'Finalizado' };
    const STATUS_COR = { aguardando_corretor:'#b45309', aguardando_edicao_cliente:'#6366f1', enviado_admin:'#16a34a', correcao_solicitada:'#DC1C2E', finalizado:'#6b7280' };
    locListarFichasImovel({ imovelId }).then(res => {
      const fichas = res.data || [];
      if (!fichas.length) { fichasListaEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Nenhuma ficha vinculada a este imóvel.</div>'; return; }
      fichasListaEl.innerHTML = fichas.map(f => {
        const dt = f.criadoEm ? new Date(f.criadoEm).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        const cor = STATUS_COR[f.status] || '#6b7280';
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <strong style="font-size:12px">${escapeHtml(f.dados?.nome || 'Sem nome')}</strong>
            <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${escapeHtml(TIPO_LABEL[f.tipo] || f.tipo)}</span>
            ${f.corretorNome ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">· ${escapeHtml(f.corretorNome)}</span>` : ''}
            <span style="font-size:10px;color:var(--text-muted);margin-left:6px">${dt}</span>
          </div>
          <span style="font-size:10px;font-weight:600;color:${cor};background:${cor}18;padding:2px 7px;border-radius:5px;white-space:nowrap">${STATUS_LABEL[f.status] || f.status}</span>
        </div>`;
      }).join('');
    }).catch(() => { fichasListaEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Erro ao carregar fichas.</div>'; });
  }
}

async function recarregarDetalhe(cont, imovelId) {
  cont.innerHTML = '<p style="color:var(--text-muted)">Atualizando...</p>';
  const res = await locObterImovel({ imovelId });
  const d = res.data || {};
  cont.innerHTML = renderDetalheImovel(d);
  wireDetalheImovel(cont, imovelId, d);
}

async function toggleDetalheImovel(btn) {
  const id = btn.dataset.id;
  const cont = document.getElementById('det-' + id);
  if (!cont) return;
  if (!cont.hidden) { cont.hidden = true; btn.textContent = 'Ver detalhes ▾'; return; }
  cont.hidden = false; btn.textContent = 'Ocultar ▴';
  if (cont.dataset.carregado) return;
  cont.innerHTML = '<p style="color:var(--text-muted)">Carregando detalhes...</p>';
  try {
    const res = await locObterImovel({ imovelId: id });
    const d = res.data || {};
    cont.innerHTML = renderDetalheImovel(d);
    wireDetalheImovel(cont, id, d);
    cont.dataset.carregado = '1';
  } catch (e) {
    cont.innerHTML = `<p style="color:var(--text-muted)">Erro ao carregar: ${escapeHtml(e.message)}</p>`;
  }
}

// Card de um imóvel. Se `role` for gestor/administrativo, inclui o controle de mover status.
function cardImovelHtml(im, role) {
  const e = im.endereco || {};
  const end = [e.logradouro, e.numero, e.bairro, e.cidade].filter(Boolean).join(', ');
  const data = im.atualizadoEm ? new Date(im.atualizadoEm).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
  const admin = role === 'gestor' || role === 'administrativo';
  const meta = [im.tipo, im.valorAnuncio ? 'Anúncio ' + im.valorAnuncio : '', admin && im.corretorNome ? 'Corretor: ' + im.corretorNome : '', data]
    .filter(Boolean).map(escapeHtml).join(' · ');

  let controle = '';
  // 'ativo' não é movível pela esteira (só via "Ativar contrato"); imóvel já ativo não tem seletor.
  if (admin && im.status !== 'ativo') {
    const opts = IMOVEL_STATUS.filter(s => s.key !== 'ativo').map(s => {
      const dis = (role !== 'gestor' && IMOVEL_STATUS_SO_GESTOR.includes(s.key)) ? ' disabled' : '';
      return `<option value="${s.key}"${s.key === im.status ? ' selected' : ''}${dis}>${s.label}</option>`;
    }).join('');
    controle = `<div style="margin-top:8px;display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--text-muted)">Mover para:</span>
      <select class="imovel-status-sel" data-id="${escapeHtml(im.id)}" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)">${opts}</select></div>`;
  }

  // Bloco financeiro + checklist + badges (só aparece se tem algum dado preenchido)
  const prog = progressoChecklist(im);
  const stCom = statusComissao(im);
  const temFin = im.valorFechamento != null || im.valorComissao != null;
  const finRow = temFin ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:12px">
    ${im.valorFechamento != null ? `<span><span style="color:var(--text-muted)">Fechamento:</span> <strong>${fmtBRL(im.valorFechamento)}</strong></span>` : ''}
    ${im.valorComissao != null ? `<span><span style="color:var(--text-muted)">Comissão:</span> <strong>${fmtBRL(im.valorComissao)}</strong></span>` : ''}
  </div>` : '';
  const progRow = `<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
    <div style="flex:1;height:6px;background:var(--hover);border-radius:3px;overflow:hidden"><div style="width:${prog.pct}%;height:100%;background:${prog.pct === 100 ? '#16a34a' : '#0ea5e9'};transition:width .2s"></div></div>
    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${prog.feitos}/${prog.total} etapas</span>
  </div>`;
  const badge = (txt, cor) => `<span style="font-size:10px;font-weight:600;color:${cor};background:${cor}18;border:1px solid ${cor}40;padding:2px 8px;border-radius:12px">${escapeHtml(txt)}</span>`;
  const badges = [];
  badges.push(badge(stCom.txt, stCom.cor));
  if (im.contratoAssinado === 'sim') badges.push(badge('Contrato assinado', '#16a34a'));
  else if (im.contratoAssinado === 'nao') badges.push(badge('Contrato pendente', '#b45309'));
  if (im.possuiAdministracao === 'sim') badges.push(badge('Adm. REMAX', '#16a34a'));
  else if (im.possuiAdministracao === 'nao') badges.push(badge('Sem administração', '#6b7280'));
  if (im.possuiParceria === 'sim') badges.push(badge('Parceria', '#6366f1'));
  const badgesRow = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${badges.join('')}</div>`;

  const numProt = im.numeroProtocolo != null ? `<span style="font-size:10px;font-weight:700;color:var(--text-muted);background:var(--hover);border:1px solid var(--border);padding:2px 8px;border-radius:6px;letter-spacing:.04em">${fmtProtocolo(im)}</span>` : '';
  return `<div class="ficha-card">
    <div class="ficha-card-head">
      <div><strong style="font-size:13px">${escapeHtml(end || im.tipo || 'Imóvel')}</strong>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${escapeHtml(im.locadorNome || '')}</span></div>
      <div style="display:flex;align-items:center;gap:6px">${numProt}
        <span style="font-size:11px;font-weight:600;color:${imovelCor(im.status)};background:${imovelCor(im.status)}18;padding:3px 8px;border-radius:6px">${imovelLabel(im.status)}</span></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${meta}</div>
    ${finRow}${progRow}${badgesRow}
    ${controle}
    <div style="margin-top:8px"><button class="topbar-btn btn-det-imovel" data-id="${im.id}" style="font-size:11px;padding:4px 10px">Ver detalhes ▾</button></div>
    <div class="imovel-det" id="det-${im.id}" hidden style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"></div>
  </div>`;
}

async function carregarImoveis() {
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando imóveis...</p>';
  try {
    const res = await locListarImoveis({});
    const imoveis = res.data?.imoveis || [];
    const veTudo  = !!res.data?.veTudo;
    const role    = res.data?.role || 'corretor';
    imoveisRole = role;

    if (!imoveis.length) {
      secaoImoveis.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:32px 16px;line-height:1.6">
        Nenhum imóvel na esteira ainda.<br>
        <span style="font-size:12px">Um imóvel aparece aqui automaticamente quando o corretor aprova uma ficha do locador e <strong>envia ao administrativo</strong> (aba Cadastro).</span></div>`;
      return;
    }

    _imoveisCache = { imoveis, veTudo, role };
    renderImoveis();
  } catch (e) {
    secaoImoveis.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar imóveis: ${escapeHtml(e.message)}</p>`;
  }
}

// Renderiza a esteira a partir do cache, respeitando o filtro por status (quadrados clicáveis).
function renderImoveis() {
  if (!_imoveisCache) return;
  const { imoveis, veTudo, role } = _imoveisCache;
  const contagem = {};
  imoveis.forEach(im => { contagem[im.status] = (contagem[im.status] || 0) + 1; });
  const filtro = imoveisFiltroStatus;
  const ativo = k => (k === '__todos' ? filtro === null : filtro === k);

  // Quadrados de resumo (clicáveis pra filtrar; o ativo fica destacado)
  const quad = (key, label, cor, num) => `<div class="imovel-filtro" data-status="${key}" title="Filtrar: ${label}" style="flex:1;min-width:88px;background:${ativo(key) ? cor + '1f' : 'var(--surface)'};border:1px solid ${ativo(key) ? cor : 'var(--border)'};border-radius:var(--radius-card);padding:10px 12px;cursor:pointer;transition:border-color .12s">
      <div style="font-size:20px;font-weight:700;color:${cor}">${num}</div>
      <div style="font-size:11px;color:var(--text-muted)">${label}</div></div>`;
  const resumo = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    ${quad('__todos', 'Todos', '#0ea5e9', imoveis.length)}
    ${IMOVEL_STATUS.map(s => quad(s.key, s.label, s.cor, contagem[s.key] || 0)).join('')}</div>`;

  const lista = arr => `<div style="display:flex;flex-direction:column;gap:10px">${arr.map(im => cardImovelHtml(im, role)).join('')}</div>`;
  let corpo;
  if (filtro) {
    // Filtrado: lista simples só do status escolhido
    const visiveis = imoveis.filter(im => im.status === filtro);
    const lbl = (IMOVEL_STATUS.find(s => s.key === filtro) || {}).label || filtro;
    corpo = visiveis.length
      ? `<div style="margin-top:14px">${lista(visiveis)}</div>`
      : `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Nenhum imóvel com status "${escapeHtml(lbl)}".</p>`;
  } else if (veTudo) {
    // Sem filtro (gestor/admin): agrupado por etapa
    const grupos = IMOVEL_STATUS.map(s => {
      const l = imoveis.filter(im => im.status === s.key);
      if (!l.length) return '';
      return `<div style="margin-top:18px"><div style="font-size:12px;font-weight:700;color:${s.cor};text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${s.label} · ${l.length}</div>${lista(l)}</div>`;
    }).join('');
    const fora = imoveis.filter(im => !IMOVEL_STATUS.some(s => s.key === im.status));
    const foraHtml = fora.length ? `<div style="margin-top:18px"><div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:8px">OUTROS · ${fora.length}</div>${lista(fora)}</div>` : '';
    corpo = grupos + foraHtml;
  } else {
    // Corretor sem filtro: lista simples dos seus
    corpo = `<div style="margin-top:14px">${lista(imoveis)}</div>`;
  }

  secaoImoveis.innerHTML = resumo + corpo;

  // Clique nos quadrados: alterna o filtro (clicar no ativo ou em "Todos" limpa)
  secaoImoveis.querySelectorAll('.imovel-filtro').forEach(el => el.addEventListener('click', () => {
    const s = el.dataset.status;
    imoveisFiltroStatus = (s === '__todos') ? null : (imoveisFiltroStatus === s ? null : s);
    renderImoveis();
  }));
  // Controle de status (gestor/administrativo)
  secaoImoveis.querySelectorAll('.imovel-status-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      sel.disabled = true;
      try { await locMoverImovelStatus({ imovelId: sel.dataset.id, novoStatus: sel.value }); carregarImoveis(); }
      catch (e) { alert('Erro ao mover: ' + e.message); carregarImoveis(); }
    });
  });
  // Ver detalhes do imóvel (busca sob demanda)
  secaoImoveis.querySelectorAll('.btn-det-imovel').forEach(btn => btn.addEventListener('click', () => toggleDetalheImovel(btn)));
}

// Tipos de alerta da Gestão de Locações: [ícone, rótulo, cor, fundo, borda]
const ALERTA_INFO = {
  atraso:            ['⚠', 'Cobrança(s) em atraso',   '#DC1C2E', '#fef2f2', '#fecaca'],
  repasse_pendente:  ['↩', 'Repasse(s) pendente(s)',  '#b45309', '#fffbeb', '#fde68a'],
  contrato_vencendo: ['📄', 'Contrato(s) vencendo',    '#0ea5e9', '#eff6ff', '#bfdbfe'],
  vistoria_pendente: ['🔍', 'Vistoria(s) pendente(s)', '#6366f1', '#eef2ff', '#c7d2fe'],
  cadastro_pendente: ['📝', 'Cadastro(s) com pendência', '#b45309', '#fffbeb', '#fde68a'],
};

// Definição dos relatórios: colunas, mapeamento de linha e colunas de dinheiro (idx).
const REL_DEFS = {
  contratosAtivos:        { titulo: 'Contratos ativos',        cols: ['Ref', 'Endereço', 'Locador', 'Locatário', 'Aluguel', 'Início', 'Fim', 'Corretor'], money: [4], row: r => [r.referencia, r.endereco, r.locador, r.locatario, r.valorAluguel, r.vigenciaInicio, r.vigenciaFim, r.corretorNome] },
  inadimplencia:          { titulo: 'Inadimplência',           cols: ['Competência', 'Ref', 'Endereço', 'Valor', 'Venceu', 'Corretor'], money: [3], row: r => [r.competencia, r.referencia, r.endereco, r.valor, r.vencimento, r.corretorNome] },
  repassesMes:            { titulo: 'Repasses do mês',         cols: ['Competência', 'Ref', 'Proprietário', 'Valor', 'Status', 'Corretor'], money: [3], row: r => [r.competencia, r.referencia, r.proprietario, r.valorRepasse, r.status, r.corretorNome] },
  imoveisPorCorretor:     { titulo: 'Imóveis por corretor',    cols: ['Corretor', 'Imóveis'], money: [], row: r => [r.nome, r.qtd] },
  extratoPorProprietario: { titulo: 'Extrato por proprietário', cols: ['Proprietário', 'Repasses', 'Total', 'Repassado', 'Pendente'], money: [2, 3, 4], row: r => [r.proprietario, r.qtd, r.total, r.repassado, r.pendente] },
};
let _relatorioDados = null;

// ─── Painel / Dashboard (Gestão de Locações) ─────────────────────────────────
async function carregarPainel() {
  secaoPainel.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando painel...</p>';
  try {
    const [res, aRes] = await Promise.all([locDashboard({}), locListarAlertas({}).catch(() => ({ data: { alertas: [] } }))]);
    const d = res.data || {};
    const alertas = aRes.data?.alertas || [];
    const fmt = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const card = (num, label, cor) => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:14px 16px;min-width:120px;flex:1">
      <div style="font-size:23px;font-weight:700;color:${cor || 'var(--text-primary)'}">${num}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${label}</div></div>`;
    const st = d.imoveisPorStatus || {};
    const etapas = [['recebido', 'Recebido', '#b45309'], ['em_analise', 'Em análise', '#6366f1'], ['aprovado', 'Aprovado', '#16a34a'], ['em_contrato', 'Em contrato', '#0ea5e9'], ['ativo', 'Ativo', '#002749']];
    const titulo = t => `<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin:16px 0 10px">${t}</div>`;

    // Bloco de alertas (genérico — reflete novos tipos automaticamente; ignora os tratados)
    const contagem = {};
    alertas.filter(a => !a.tratado).forEach(a => { contagem[a.tipo] = (contagem[a.tipo] || 0) + 1; });
    const alertaPills = Object.entries(contagem).filter(([, n]) => n).map(([tipo, n]) => {
      const [ic, lbl, cor, bg, bd] = ALERTA_INFO[tipo] || ['•', tipo, 'var(--text-muted)', 'var(--surface)', 'var(--border)'];
      return `<div style="background:${bg};border:1px solid ${bd};color:${cor};border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600">${ic} ${n} ${lbl}</div>`;
    }).join('');
    const alertaBloco = alertaPills ? titulo('Alertas') + `<div style="display:flex;gap:8px;flex-wrap:wrap">${alertaPills}</div>` : '';

    // Atalhos rápidos (entrada principal do corretor: gerar link de ficha)
    const atalho = (ic, txt, sub) => `<button class="atalho-painel" data-locsub="${sub}" style="flex:1;min-width:150px;display:flex;align-items:center;gap:10px;padding:12px 14px;text-align:left;cursor:pointer;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card)">
      <span style="font-size:20px">${ic}</span><span style="font-size:13px;font-weight:600;color:var(--text-primary)">${txt}</span></button>`;
    const atalhos = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      ${atalho('🏠', d.veTudo ? 'Esteira de imóveis' : 'Meus imóveis', 'imoveis')}</div>`;

    secaoPainel.innerHTML =
      atalhos +
      titulo(`Visão geral${d.veTudo ? '' : ' (seus imóveis)'}`) +
      `<div style="display:flex;gap:8px;flex-wrap:wrap">${card(d.totalImoveis || 0, 'Imóveis')}${card(d.aguardandoAnalise || 0, 'Aguardando análise', '#6366f1')}${card(d.contratosAtivos || 0, 'Contratos ativos', '#16a34a')}${card(d.inadimplencia?.qtd || 0, 'Cobranças em atraso', '#DC1C2E')}${card(d.repassePendente?.qtd || 0, 'Repasses pendentes', '#b45309')}</div>` +
      titulo('Valores') +
      `<div style="display:flex;gap:8px;flex-wrap:wrap">${card(fmt(d.inadimplencia?.valor), 'Inadimplência', '#DC1C2E')}${card(fmt(d.repassePendente?.valor), 'A repassar', '#b45309')}${card(fmt(d.repassadoMes), 'Repassado no mês', '#16a34a')}</div>` +
      alertaBloco +
      titulo('Imóveis por etapa') +
      `<div style="display:flex;gap:8px;flex-wrap:wrap">${etapas.map(([k, l, c]) => card(st[k] || 0, l, c)).join('')}</div>`;

    // Atalhos → sub-app
    secaoPainel.querySelectorAll('.atalho-painel').forEach(el => el.addEventListener('click', () => { locSub = el.dataset.locsub; renderCentro(); }));
  } catch (e) {
    secaoPainel.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar painel: ${escapeHtml(e.message)}</p>`;
  }
}

// ─── Central de Alertas (Gestão de Locações) ─────────────────────────────────
function _descAlerta(a) {
  const fmt = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ref = a.referencia ? ` · ${escapeHtml(a.referencia)}` : '';
  switch (a.tipo) {
    case 'atraso':            return `Competência ${a.competencia || '?'} · ${fmt(a.valor)} · venceu ${a.vencimento || '?'}`;
    case 'repasse_pendente':  return `Competência ${a.competencia || '?'} · ${fmt(a.valor)} a repassar`;
    case 'contrato_vencendo': return `Vigência termina em ${a.vigenciaFim || '?'}`;
    case 'vistoria_pendente': return `Vistoria de ${a.tipoVistoria === 'saida' ? 'saída' : 'entrada'} agendada${ref}`;
    case 'cadastro_pendente': return `${a.qtd || 0} documento(s) pendente(s)${ref}`;
    default: return '';
  }
}

async function carregarAlertas() {
  secaoAlertas.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando alertas...</p>';
  const podeTratar = (locRoleAtual === 'gestor' || locRoleAtual === 'administrativo');
  try {
    const res = await locListarAlertas({});
    const alertas = res.data?.alertas || [];
    const ativos = alertas.filter(a => !a.tratado);
    const tratados = alertas.filter(a => a.tratado);

    if (!alertas.length) {
      secaoAlertas.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:36px 16px;line-height:1.6">✅ Nenhum alerta.<br><span style="font-size:12px">Cobranças, repasses, contratos e vistorias em dia.</span></div>`;
      return;
    }

    const linha = (a) => {
      const [ic, lbl, cor, bg, bd] = ALERTA_INFO[a.tipo] || ['•', a.tipo, 'var(--text-muted)', 'var(--surface)', 'var(--border)'];
      const nome = lbl.replace(/\(s\)/g, '').replace(/\s+$/, '');
      const btnTratar = podeTratar
        ? `<button class="topbar-btn btn-tratar-alerta" data-chave="${escapeHtml(a.chave)}" data-desfazer="${a.tratado ? '1' : '0'}" style="font-size:11px;padding:3px 10px">${a.tratado ? '↩ Reabrir' : '✓ Tratado'}</button>`
        : '';
      const btnVer = a.imovelId
        ? `<button class="topbar-btn btn-ver-alerta-imovel" data-imovel="${escapeHtml(a.imovelId)}" style="font-size:11px;padding:3px 10px">Ver imóvel</button>`
        : '';
      return `<div style="display:flex;gap:10px;align-items:center;background:${a.tratado ? 'var(--surface)' : bg};border:1px solid ${a.tratado ? 'var(--border)' : bd};border-radius:10px;padding:10px 12px;margin-bottom:8px;${a.tratado ? 'opacity:.55' : ''}">
        <span style="font-size:18px">${ic}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:${a.tratado ? 'var(--text-muted)' : cor}">${nome}</div>
          <div style="font-size:11px;color:var(--text-muted)">${_descAlerta(a)}</div>
        </div>
        ${btnVer}${btnTratar}
      </div>`;
    };

    const titulo = (t, n) => `<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin:6px 0 10px">${t}${n != null ? ` <span style="color:var(--text-muted);font-weight:600">(${n})</span>` : ''}</div>`;
    let html = '';
    if (ativos.length) {
      // agrupa ativos por tipo, na ordem do ALERTA_INFO
      const ordem = Object.keys(ALERTA_INFO);
      const porTipo = {};
      ativos.forEach(a => { (porTipo[a.tipo] = porTipo[a.tipo] || []).push(a); });
      html += titulo('Pendentes', ativos.length);
      ordem.filter(t => porTipo[t]).forEach(t => { html += porTipo[t].map(linha).join(''); });
      // tipos fora do ALERTA_INFO conhecido
      Object.keys(porTipo).filter(t => !ordem.includes(t)).forEach(t => { html += porTipo[t].map(linha).join(''); });
    } else {
      html += `<div style="font-size:13px;color:#16a34a;text-align:center;padding:16px">✅ Nenhuma pendência ativa.</div>`;
    }
    if (tratados.length) {
      html += `<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted);font-weight:600">Tratados (${tratados.length})</summary><div style="margin-top:10px">${tratados.map(linha).join('')}</div></details>`;
    }
    secaoAlertas.innerHTML = html;

    // Marcar/reabrir
    secaoAlertas.querySelectorAll('.btn-tratar-alerta').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await locTratarAlerta({ chave: btn.dataset.chave, desfazer: btn.dataset.desfazer === '1' });
        carregarAlertas();
      } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    }));
    // Ir pra aba Imóveis (o corretor localiza o card lá)
    secaoAlertas.querySelectorAll('.btn-ver-alerta-imovel').forEach(btn => btn.addEventListener('click', () => {
      locSub = 'imoveis';
      renderCentro();
    }));
  } catch (e) {
    secaoAlertas.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar alertas: ${escapeHtml(e.message)}</p>`;
  }
}

// ─── Relatórios (Gestão de Locações) ─────────────────────────────────────────
function _relCSV(chave) {
  const d = _relatorioDados || {};
  const def = REL_DEFS[chave];
  if (!def) return;
  const rows = d[chave] || [];
  const esc = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const money = new Set(def.money || []);
  // Colunas de dinheiro saem com vírgula decimal (Excel pt-BR lê como número). Separador ';'.
  const cel = (v, i) => money.has(i) ? Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, '') : esc(v);
  const linhas = [def.cols.join(';'), ...rows.map(r => def.row(r).map(cel).join(';'))];
  const csv = '﻿' + linhas.join('\r\n'); // BOM p/ Excel abrir com acento certo
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `remax-locacoes-${chave}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function carregarRelatorios() {
  secaoRelatorios.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando relatórios...</p>';
  try {
    const res = await locRelatorios({});
    const d = res.data || {};
    _relatorioDados = d;
    const fmt = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const bloco = (chave) => {
      const def = REL_DEFS[chave];
      const rows = d[chave] || [];
      const head = `<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px">
        <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${def.titulo}</span>
        <span style="font-size:11px;color:var(--text-muted)">(${rows.length})</span>
        ${rows.length ? `<button class="topbar-btn btn-rel-csv" data-rel="${chave}" style="margin-left:auto;font-size:11px;padding:3px 10px">⬇ Baixar CSV</button>` : ''}
      </div>`;
      if (!rows.length) return head + `<p style="font-size:12px;color:var(--text-muted);padding:0 0 4px">Sem dados.</p>`;
      const th = def.cols.map(c => `<th style="text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">${escapeHtml(c)}</th>`).join('');
      const trs = rows.map(r => {
        const cells = def.row(r).map((v, i) => {
          const val = def.money.includes(i) ? fmt(v) : escapeHtml(v == null ? '' : String(v));
          return `<td style="font-size:12px;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">${val}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return head + `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:max-content"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
    };

    const totalRepMes = (d.repassesMes || []).reduce((s, r) => s + (r.valorRepasse || 0), 0);
    const totalInad = (d.inadimplencia || []).reduce((s, r) => s + (r.valor || 0), 0);
    const resumo = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;flex:1;min-width:130px"><div style="font-size:20px;font-weight:700">${(d.contratosAtivos || []).length}</div><div style="font-size:11px;color:var(--text-muted)">Contratos ativos</div></div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;flex:1;min-width:130px"><div style="font-size:20px;font-weight:700;color:#DC1C2E">${fmt(totalInad)}</div><div style="font-size:11px;color:var(--text-muted)">Inadimplência</div></div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;flex:1;min-width:130px"><div style="font-size:20px;font-weight:700;color:#16a34a">${fmt(totalRepMes)}</div><div style="font-size:11px;color:var(--text-muted)">Repasses do mês</div></div>
    </div>`;

    secaoRelatorios.innerHTML = resumo + ['contratosAtivos', 'inadimplencia', 'repassesMes', 'imoveisPorCorretor', 'extratoPorProprietario'].map(bloco).join('');
    secaoRelatorios.querySelectorAll('.btn-rel-csv').forEach(btn => btn.addEventListener('click', () => _relCSV(btn.dataset.rel)));
  } catch (e) {
    secaoRelatorios.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar relatórios: ${escapeHtml(e.message)}</p>`;
  }
}

// (perfil/role e acesso ao Financeiro são geridos no painel de Admin → Permissões,
//  não aqui — a antiga tela "Locação · Admin" foi removida por ser redundante.)

// ─── Financeiro (cobranças, repasses, alertas — Gestão de Locações) ──────────
const COB_STATUS = { previsto:['Previsto','#6366f1'], pago:['Pago','#16a34a'], atrasado:['Atrasado','#DC1C2E'] };
const REP_STATUS = { pendente:['Pendente','#b45309'], repassado:['Repassado','#16a34a'] };
const fmtBRLnum = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compLabel = c => { const [y, m] = String(c || '').split('-'); const mes = ['', 'Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][+m] || m; return mes + '/' + (y || ''); };

// Filtros da aba Financeiro (persistem entre re-renders)
const finFiltro = { mes: '', status: 'todos' };

async function carregarFinanceiro() {
  secaoFinanceiro.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando financeiro...</p>';
  try {
    const [fRes, aRes, dRes] = await Promise.all([locListarFinanceiro({}), locListarAlertas({}), locDashboard({})]);
    const cobrancasFull = (fRes.data?.cobrancas || []);
    const repassesFull  = (fRes.data?.repasses  || []);
    const podeBaixar = !!fRes.data?.podeBaixar;
    const alertas = aRes.data?.alertas || [];
    const dash = dRes.data || {};

    if (!cobrancasFull.length && !repassesFull.length) {
      secaoFinanceiro.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:32px 16px;line-height:1.6">Nada no financeiro ainda.<br><span style="font-size:12px">Cobranças e repasses são gerados quando um contrato é <strong>ativado</strong> (na aba Imóveis).</span></div>`;
      return;
    }

    // ─── KPI CARDS (Dashboard) ───────────────────────────────────────────────
    const compAtual = new Date().toISOString().slice(0, 7);
    const aReceberValor = cobrancasFull
      .filter(c => (c.status === 'previsto' || c.status === 'atrasado') && (c.competencia || '') <= compAtual)
      .reduce((s, c) => s + (c.valor || 0), 0);
    const kpiCard = (label, valor, sub, cor) => `
      <div style="flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">${label}</div>
        <div style="font-size:22px;font-weight:700;color:${cor};margin-top:2px">${valor}</div>
        ${sub ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sub}</div>` : ''}
      </div>`;
    const kpiHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${kpiCard('Contratos ativos', String(dash.contratosAtivos || 0), '', 'var(--text-primary)')}
      ${kpiCard('A receber (venc. até hoje)', fmtBRLnum(aReceberValor), (dash.inadimplencia?.qtd || 0) + ' em atraso · ' + fmtBRLnum(dash.inadimplencia?.valor || 0), '#DC1C2E')}
      ${kpiCard('Repasse pendente', fmtBRLnum(dash.repassePendente?.valor || 0), (dash.repassePendente?.qtd || 0) + ' aguardando', '#b45309')}
      ${kpiCard('Repassado no mês', fmtBRLnum(dash.repassadoMes || 0), compLabel(compAtual), '#16a34a')}
    </div>`;

    // ─── ALERTAS ────────────────────────────────────────────────────────────
    const nAtraso = alertas.filter(a => a.tipo === 'atraso').length;
    const nRep = alertas.filter(a => a.tipo === 'repasse_pendente').length;
    const alertaHtml = (nAtraso || nRep) ? `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      ${nAtraso ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#DC1C2E;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600">⚠ ${nAtraso} cobrança(s) em atraso</div>` : ''}
      ${nRep ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600">↩ ${nRep} repasse(s) pendente(s)</div>` : ''}</div>` : '';

    // ─── FILTROS ────────────────────────────────────────────────────────────
    // Popula lista de meses únicos (das cobranças) ordenados desc
    const mesesUnicos = [...new Set([...cobrancasFull, ...repassesFull].map(x => x.competencia).filter(Boolean))].sort().reverse();
    const filtroHtml = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px">
      <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Filtros</span>
      <select id="finFiltroMes" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
        <option value="">Todos os meses</option>
        ${mesesUnicos.map(m => `<option value="${m}"${finFiltro.mes === m ? ' selected' : ''}>${compLabel(m)}</option>`).join('')}
      </select>
      <select id="finFiltroStatus" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
        <option value="todos"${finFiltro.status === 'todos' ? ' selected' : ''}>Todos os status</option>
        <option value="previsto"${finFiltro.status === 'previsto' ? ' selected' : ''}>Previsto</option>
        <option value="atrasado"${finFiltro.status === 'atrasado' ? ' selected' : ''}>Atrasado</option>
        <option value="pago"${finFiltro.status === 'pago' ? ' selected' : ''}>Pago</option>
        <option value="pendente"${finFiltro.status === 'pendente' ? ' selected' : ''}>Repasse pendente</option>
        <option value="repassado"${finFiltro.status === 'repassado' ? ' selected' : ''}>Repassado</option>
      </select>
      ${(finFiltro.mes || finFiltro.status !== 'todos') ? `<button id="finLimparFiltro" class="topbar-btn" style="font-size:11px;padding:5px 10px">✕ Limpar</button>` : ''}
    </div>`;

    // Aplica filtros (competência mais recente primeiro)
    const bateStatus = (item, campo) => {
      if (finFiltro.status === 'todos') return true;
      return item[campo] === finFiltro.status;
    };
    const cobrancas = cobrancasFull
      .filter(c => !finFiltro.mes || c.competencia === finFiltro.mes)
      .filter(c => finFiltro.status === 'todos' || ['previsto','atrasado','pago'].includes(finFiltro.status) && c.status === finFiltro.status)
      .sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''));
    const repasses = repassesFull
      .filter(r => !finFiltro.mes || r.competencia === finFiltro.mes)
      .filter(r => finFiltro.status === 'todos' || ['pendente','repassado'].includes(finFiltro.status) && r.status === finFiltro.status)
      .sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''));

    // ─── LINHAS ─────────────────────────────────────────────────────────────
    const linhaCob = c => {
      const [lbl, cor] = COB_STATUS[c.status] || [c.status, '#6b7280'];
      const acao = podeBaixar ? (c.status === 'pago'
        ? `<button class="topbar-btn btn-fin" data-tipo="pag-desfazer" data-id="${c.id}" style="font-size:10px;padding:3px 8px">Desfazer</button>`
        : `<button class="topbar-btn primario btn-fin" data-tipo="pag" data-id="${c.id}" style="font-size:10px;padding:3px 8px">Dar baixa</button>`) : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
        <div style="min-width:66px;font-weight:600;font-size:12px">${compLabel(c.competencia)}</div>
        <div style="flex:1;font-size:12px">${fmtBRLnum(c.valor)}<span style="color:var(--text-muted);font-size:11px"> · venc. ${escapeHtml(c.vencimento || '—')}</span></div>
        <span style="font-size:10px;font-weight:600;color:${cor};background:${cor}18;padding:2px 7px;border-radius:5px">${lbl}</span>${acao}</div>`;
    };
    const linhaRep = r => {
      const [lbl, cor] = REP_STATUS[r.status] || [r.status, '#6b7280'];
      const valorCell = podeBaixar
        ? `<input type="number" step="0.01" min="0" class="rep-valor" data-id="${r.id}" value="${r.valorRepasse != null ? r.valorRepasse : 0}" style="width:100px;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)">
           <button class="topbar-btn btn-fin" data-tipo="rep-valor" data-id="${r.id}" style="font-size:10px;padding:3px 7px">Salvar</button>`
        : fmtBRLnum(r.valorRepasse);
      const acao = podeBaixar ? (r.status === 'repassado'
        ? `<button class="topbar-btn btn-fin" data-tipo="rep-desfazer" data-id="${r.id}" style="font-size:10px;padding:3px 8px">Desfazer</button>`
        : `<button class="topbar-btn primario btn-fin" data-tipo="rep" data-id="${r.id}" style="font-size:10px;padding:3px 8px">Repassar</button>`) : '';
      const rateio = r.revisarRateio ? `<span title="Mais de um proprietário — divida o valor manualmente" style="font-size:10px;font-weight:600;color:#b45309;background:#fffbeb;border:1px solid #fde68a;padding:2px 7px;border-radius:5px">⚠ 2 titulares · revisar rateio</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;flex-wrap:wrap">
        <div style="min-width:66px;font-weight:600;font-size:12px">${compLabel(r.competencia)}</div>
        <div style="flex:1;font-size:12px;display:flex;align-items:center;gap:5px">${valorCell}</div>
        ${rateio}<span style="font-size:10px;font-weight:600;color:${cor};background:${cor}18;padding:2px 7px;border-radius:5px">${lbl}</span>${acao}</div>`;
    };
    const h = t => `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-primary);margin:16px 0 8px">${t}</div>`;

    secaoFinanceiro.innerHTML = kpiHtml + alertaHtml + filtroHtml
      + h(`Cobranças · locatário (${cobrancas.length})`) + (cobrancas.map(linhaCob).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhuma cobrança neste filtro.</p>')
      + h(`Repasses · proprietário (${repasses.length})`) + (repasses.map(linhaRep).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhum repasse neste filtro.</p>');

    // Handlers dos filtros
    document.getElementById('finFiltroMes')?.addEventListener('change', (e) => { finFiltro.mes = e.target.value; carregarFinanceiro(); });
    document.getElementById('finFiltroStatus')?.addEventListener('change', (e) => { finFiltro.status = e.target.value; carregarFinanceiro(); });
    document.getElementById('finLimparFiltro')?.addEventListener('click', () => { finFiltro.mes = ''; finFiltro.status = 'todos'; carregarFinanceiro(); });

    if (podeBaixar) {
      secaoFinanceiro.querySelectorAll('.btn-fin').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const t = btn.dataset.tipo, id = btn.dataset.id;
          try {
            if (t === 'pag') await locRegistrarPagamento({ cobrancaId: id });
            else if (t === 'pag-desfazer') await locRegistrarPagamento({ cobrancaId: id, desfazer: true });
            else if (t === 'rep') await locRegistrarRepasse({ repasseId: id });
            else if (t === 'rep-desfazer') await locRegistrarRepasse({ repasseId: id, desfazer: true });
            else if (t === 'rep-valor') {
              const inp = secaoFinanceiro.querySelector(`.rep-valor[data-id="${id}"]`);
              await locAtualizarRepasse({ repasseId: id, valorRepasse: inp ? inp.value : 0 });
            }
            carregarFinanceiro();
          } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
        });
      });
    }
  } catch (e) {
    secaoFinanceiro.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar financeiro: ${escapeHtml(e.message)}</p>`;
  }
}

// ─── Calculadoras ────────────────────────────────────────────────────────────
function carregarCalculadoras() {
  const CALCS = [
    {
      calc: 'aluguel', nome: 'Aluguel proporcional',
      desc: 'Valor do aluguel por dia e o total proporcional aos dias contabilizados.',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><circle cx="24" cy="24" r="12" fill="none" stroke="#A4D7F4" stroke-width="2.5"/><text x="24" y="30" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="Arial,sans-serif">R$</text></svg>`
    },
    {
      calc: 'multa', nome: 'Multa rescisória',
      desc: 'Multa proporcional pela saída antecipada, com base nos dias restantes do contrato.',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><rect x="15" y="12" width="18" height="24" rx="2" fill="none" stroke="#A4D7F4" stroke-width="2"/><path d="M24 19v7" stroke="#DC1C2E" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="30" r="1.4" fill="#DC1C2E"/></svg>`
    }
  ];

  secaoCalculadoras.innerHTML = `
    <div class="ia-grid">
      ${CALCS.map(c => `
        <button class="ia-card" data-calc="${c.calc}">
          <div class="ia-icone">${c.icone}</div>
          <div class="ia-nome">${c.nome}</div>
          <div class="ia-empresa">Calculadora</div>
          <p class="ia-desc">${c.desc}</p>
        </button>
      `).join('')}
    </div>`;

  secaoCalculadoras.querySelectorAll('.ia-card').forEach(card => {
    card.addEventListener('click', () => {
      window.hubApi.abrirFichaLocal('calculadoras.html', { calc: card.dataset.calc });
    });
  });
}

// ─── Bloco de Notas ──────────────────────────────────────────────────────────
let notasState = null;        // array de {id, titulo, corpo, atualizadoEm}
let notasSaveTimer = null;
let notasCarregando = false;

async function carregarNotas() {
  if (notasState === null) {
    if (notasCarregando) return;
    notasCarregando = true;
    secaoNotas.innerHTML = '<p class="notas-vazio">Carregando suas notas...</p>';
    try {
      const snap = currentUid ? await getDoc(doc(db, 'user_notes', currentUid)) : null;
      notasState = (snap && snap.exists() && Array.isArray(snap.data().notas)) ? snap.data().notas : [];
    } catch (e) {
      notasState = [];
      console.warn('Erro ao carregar notas:', e.message);
    }
    notasCarregando = false;
  }
  renderNotas();
}

function renderNotas() {
  const notas = notasState || [];
  secaoNotas.innerHTML = `
    <div class="notas-barra">
      <button class="topbar-btn primario" id="btnNovaNota">+ Nova nota</button>
      <span class="notas-status" id="notasStatus"></span>
    </div>
    ${notas.length === 0
      ? '<p class="notas-vazio">Nenhuma nota ainda. Clique em <strong>+ Nova nota</strong> para começar.</p>'
      : `<div class="notas-grid">${notas.map(n => `
        <div class="nota-card" data-id="${escapeHtml(n.id)}">
          <div class="nota-card-head">
            <input class="nota-titulo" data-campo="titulo" placeholder="Título" value="${escapeHtml(n.titulo || '')}">
          </div>
          <textarea class="nota-corpo" data-campo="corpo" placeholder="Escreva aqui...">${escapeHtml(n.corpo || '')}</textarea>
          <div class="nota-rodape">
            <span>${n.atualizadoEm ? 'Editada ' + new Date(n.atualizadoEm).toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Nova'}</span>
            <button class="nota-excluir" data-excluir="${escapeHtml(n.id)}">🗑 Excluir</button>
          </div>
        </div>`).join('')}</div>`}
  `;

  const btnNova = document.getElementById('btnNovaNota');
  if (btnNova) btnNova.addEventListener('click', () => {
    notasState.unshift({ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), titulo: '', corpo: '', atualizadoEm: Date.now() });
    renderNotas();
    const primeiro = secaoNotas.querySelector('.nota-titulo');
    if (primeiro) primeiro.focus();
    agendarSalvarNotas();
  });

  secaoNotas.querySelectorAll('.nota-card').forEach(card => {
    const id = card.dataset.id;
    // Edição inline: atualiza o estado sem re-renderizar (não perde o foco ao digitar)
    card.querySelectorAll('[data-campo]').forEach(el => {
      el.addEventListener('input', () => {
        const nota = notasState.find(n => n.id === id);
        if (!nota) return;
        nota[el.dataset.campo] = el.value;
        nota.atualizadoEm = Date.now();
        agendarSalvarNotas();
      });
    });
    const btnDel = card.querySelector('[data-excluir]');
    if (btnDel) btnDel.addEventListener('click', () => {
      if (!confirm('Excluir esta nota?')) return;
      notasState = notasState.filter(n => n.id !== id);
      renderNotas();
      salvarNotas();
    });
  });
}

function agendarSalvarNotas() {
  const status = document.getElementById('notasStatus');
  if (status) status.textContent = 'Salvando...';
  clearTimeout(notasSaveTimer);
  notasSaveTimer = setTimeout(salvarNotas, 800);
}

async function salvarNotas() {
  clearTimeout(notasSaveTimer);
  if (!currentUid) return;
  try {
    await setDoc(doc(db, 'user_notes', currentUid), { notas: notasState || [], updatedAt: fsTs() }, { merge: true });
    const status = document.getElementById('notasStatus');
    if (status) status.textContent = 'Salvo ✓';
  } catch (e) {
    const status = document.getElementById('notasStatus');
    if (status) status.textContent = 'Erro ao salvar';
    console.warn('Erro ao salvar notas:', e.message);
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
    grupo: 'locacao',
    geraLink: true,
    temAnalise: true,   // botão "Para análise" (requer permissão analise_locador)
    temFirebase: true   // tem integração com Firestore (lista fichas recebidas)
  },
  {
    key: 'pf',
    nome: 'Ficha Cadastral (Pessoa Física)',
    desc: 'Cadastro de pessoa física',
    arquivo: 'ficha-pf.html',
    grupo: 'locacao',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'pj',
    nome: 'Ficha Cadastral (Pessoa Jurídica)',
    desc: 'Cadastro de pessoa jurídica',
    arquivo: 'ficha-pj.html',
    grupo: 'locacao',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'locacao_fiador',
    nome: 'Ficha Cadastral Locação com Fiador',
    desc: 'Cadastro com fiador para locação',
    arquivo: 'ficha-locacao-fiador.html',
    grupo: 'locacao',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'vendedor',
    nome: 'Ficha Cadastral Vendedor',
    desc: 'Cadastro de vendedor para transação de venda',
    arquivo: 'ficha-vendedor.html',
    grupo: 'venda',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'proposta',
    nome: 'Ficha Proposta',
    desc: 'Proposta de compra ou locação de imóvel',
    arquivo: 'ficha-proposta.html',
    grupo: 'venda',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'fianca',
    nome: 'Ficha Fiança',
    desc: 'Cotação de seguro fiança — preenchida pelo corretor',
    arquivo: 'ficha-fianca.html',
    grupo: 'locacao',
    geraLink: false, abrirInterno: true, temAnalise: true, temFirebase: true
  },
];

// ─── Cadastro de Fichas (aba "Cadastro") ─────────────────────────────────────
// Layout novo: KPIs + filtros + tabela única de fichas recebidas. Substituiu a
// pilha de sanfonas por tipo. Corretor vê as suas; admin ("Broker") vê todas,
// com coluna e filtro de corretor. Tudo client-side sobre os callables que já
// existiam — busca as 7 fichas (locador + 6 tipos) em paralelo e filtra local.
const CAD_TIPO_LABEL = { locador:'Locador', pf:'Pessoa Física', pj:'Pessoa Jurídica', locacao_fiador:'Locação com Fiador', vendedor:'Vendedor', proposta:'Proposta', fianca:'Fiança' };
const CAD_TIPO_ICO   = { locador:'👤', pf:'🧍', pj:'🏢', locacao_fiador:'🤝', vendedor:'🏷️', proposta:'📄', fianca:'🛡️' };
const CAD_CORES = ['#0052CC','#C8001A','#4ade80','#8b7cf6','#fbbf24','#0ea5e9','#ec4899'];
const cadIniciais = n => ((n||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()) || '?';
const cadCor = n => CAD_CORES[[...(n||'x')].reduce((a,c)=>a+c.charCodeAt(0),0) % CAD_CORES.length];

let cadFichas = [];   // cache normalizado de todas as fichas
let cadFiltro = { tab:'todas', busca:'', tipo:'', status:'', periodo:'30', corretor:'' };
let cadVisao  = '';   // admin: uid de um corretor pra enxergar a aba como ele ('' = visão geral)

// Base de tudo (KPIs, abas, tabela): com a visão de corretor ativa, o admin
// enxerga exatamente o recorte daquele corretor.
function cadBase() {
  return cadVisao ? cadFichas.filter(f => f.corretorUid === cadVisao) : cadFichas;
}

// O backend guarda menos granularidade que os status de exibição — aqui a gente
// deriva o "bucket" (usado nos KPIs/abas) e o rótulo/cor da pílula.
function cadStatusInfo(f) {
  const temPend = (f.pendentes||[]).length > 0;
  switch (f.status) {
    case 'enviado_admin':             return { bucket:'enviadas',   label:'Enviada ao broker',  cls:'cad-p-broker' };
    case 'finalizado':                return { bucket:'concluidas', label:'Concluída',          cls:'cad-p-fim' };
    case 'correcao_solicitada':       return { bucket:'devolvidas', label:'Devolvida',          cls:'cad-p-dev' };
    case 'aguardando_edicao_cliente': return { bucket:'pendentes',  label:'Aguardando cliente', cls:'cad-p-cli' };
    case 'aguardando_corretor':
    default:
      return temPend
        ? { bucket:'pendentes', label:'Aguardando envio',  cls:'cad-p-env' }
        : { bucket:'pendentes', label:'Pronta para envio', cls:'cad-p-pronta' };
  }
}

async function carregarDocumentos(grupo) {
  const nomeCorretor = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
  cadFiltro = { tab:'todas', busca:'', tipo:'', status:'', periodo:'30', corretor:'' };
  cadVisao = '';

  const painelEnviar = FICHAS_CONFIG.map(f => {
    const link = `${BASE_HOSTING}/${f.arquivo}?corretor=${currentUid}&nome=${encodeURIComponent(nomeCorretor)}`;
    const btn = f.geraLink
      ? `<button class="topbar-btn primario cad-copiar" data-link="${link}" style="height:28px">Copiar link</button>`
      : `<button class="topbar-btn cad-preencher" data-arquivo="${f.arquivo}" style="height:28px">Preencher</button>`;
    return `<div class="cad-enviar-item"><span class="cad-ei-ico">${CAD_TIPO_ICO[f.key]||'📄'}</span>
      <span class="cad-ei-nome">${escapeHtml(CAD_TIPO_LABEL[f.key]||f.nome)}</span>${btn}</div>`;
  }).join('');

  secaoDocs.innerHTML = `
    <div class="cad-wrap">
      <div class="cad-head">
        <div>
          <h2>Cadastro de Fichas</h2>
          <p>${isAdmin ? 'Acompanhe todas as fichas enviadas e recebidas dos corretores' : 'Acompanhe e gerencie as fichas enviadas e recebidas dos seus clientes'}</p>
        </div>
        ${isAdmin ? `<div class="cad-fcampo"><label>👁 Visão</label><select id="cadVisao">
          <option value="">Visão geral (todos)</option>
        </select></div>` : ''}
      </div>
      <div class="cad-kpis" id="cadKpis"></div>
      <div class="cad-filtros">
        <div class="cad-fcampo grow"><label>Buscar</label><input id="cadBusca" placeholder="Buscar por nome, CPF/CNPJ..."></div>
        <div class="cad-fcampo"><label>Tipo de ficha</label><select id="cadTipo">
          <option value="">Todos</option>${Object.entries(CAD_TIPO_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select></div>
        ${isAdmin ? '<div class="cad-fcampo"><label>Corretor</label><select id="cadCorretor"><option value="">Todos</option></select></div>' : ''}
        <div class="cad-fcampo"><label>Status</label><select id="cadStatus">
          <option value="">Todos</option>
          <option value="pendentes">Pendente</option>
          <option value="enviadas">Enviada ao broker</option>
          <option value="devolvidas">Devolvida</option>
          <option value="concluidas">Concluída</option>
        </select></div>
        <div class="cad-fcampo"><label>Período</label><select id="cadPeriodo">
          <option value="30">Últimos 30 dias</option><option value="7">Últimos 7 dias</option>
          <option value="90">Últimos 90 dias</option><option value="">Tudo</option>
        </select></div>
        <button class="cad-limpar" id="cadLimpar">✕ Limpar filtros</button>
      </div>
      <div class="cad-grid">
        <div class="cad-panel">
          <div class="cad-panel-h"><b>Enviar Fichas</b><span>Copie o link e envie ao cliente</span></div>
          ${painelEnviar}
          <div class="cad-dica"><b>Dica:</b> cada corretor tem um link exclusivo. O sistema identifica automaticamente quem enviou a ficha.</div>
        </div>
        <div class="cad-panel">
          <div class="cad-tabs" id="cadTabs"></div>
          <div class="cad-tbl-scroll"><table class="cad-tbl">
            <thead><tr>
              <th>Cliente</th><th>Tipo de ficha</th>
              ${isAdmin ? '<th>Corretor</th>' : ''}
              <th>Recebida em</th><th>Pendências</th><th>Status</th><th>Ações</th>
            </tr></thead>
            <tbody id="cadTbody"><tr><td colspan="7" class="cad-vazio">Carregando fichas...</td></tr></tbody>
          </table></div>
          <div class="cad-foot" id="cadFoot"></div>
        </div>
      </div>
    </div>`;

  // Painel "Enviar Fichas": copiar link / preencher (ficha interna)
  secaoDocs.querySelectorAll('.cad-copiar').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.link).catch(() => prompt('Copie o link:', btn.dataset.link));
      const t = btn.textContent; btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = t; }, 2000);
    });
  });
  secaoDocs.querySelectorAll('.cad-preencher').forEach(btn => {
    btn.addEventListener('click', () => {
      window.hubApi.abrirFichaLocal(btn.dataset.arquivo, { corretor: currentUid, nome: encodeURIComponent(nomeCorretor) });
    });
  });

  // Filtros (todos só re-renderizam a tabela; nada refaz a busca no servidor)
  document.getElementById('cadBusca')?.addEventListener('input',  e => { cadFiltro.busca = e.target.value.toLowerCase(); cadRenderTabela(); });
  document.getElementById('cadTipo')?.addEventListener('change',  e => { cadFiltro.tipo = e.target.value; cadRenderTabela(); });
  document.getElementById('cadStatus')?.addEventListener('change',e => { cadFiltro.status = e.target.value; cadRenderTabela(); });
  document.getElementById('cadPeriodo')?.addEventListener('change',e => { cadFiltro.periodo = e.target.value; cadRenderTabela(); });
  document.getElementById('cadCorretor')?.addEventListener('change',e => { cadFiltro.corretor = e.target.value; cadRenderTabela(); });
  // Visão de corretor (admin): muda a base de TUDO — KPIs, abas e tabela.
  document.getElementById('cadVisao')?.addEventListener('change', e => {
    cadVisao = e.target.value;
    cadRenderKpisTabs();
    cadRenderTabela();
  });
  document.getElementById('cadLimpar')?.addEventListener('click', () => {
    cadFiltro = { tab: cadFiltro.tab, busca:'', tipo:'', status:'', periodo:'30', corretor:'' };
    ['cadBusca','cadTipo','cadStatus','cadCorretor'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const per = document.getElementById('cadPeriodo'); if (per) per.value = '30';
    cadRenderTabela();
  });

  await cadCarregarFichas();
}

// Busca todas as fichas (locador + 6 tipos) em paralelo e normaliza num só array.
async function cadCarregarFichas() {
  const TIPOS = ['pf','pj','locacao_fiador','vendedor','proposta','fianca'];
  const norm = (f, key) => ({
    id: f.id, key,
    tipoLabel: CAD_TIPO_LABEL[key] || key,
    nome: f.dados?.nome || f.dados?.razao || 'Sem nome',
    doc: f.dados?.cpf || f.dados?.cnpj || '',
    corretorNome: f.corretorNome || '',
    corretorUid: f.corretorUid || '',
    criadoEm: f.criadoEm ? new Date(f.criadoEm) : null,
    pendentes: f.pendentes || [],
    status: f.status || 'aguardando_corretor',
    arquivo: (FICHAS_CONFIG.find(c => c.key === key) || {}).arquivo,
    dados: f.dados || {}
  });
  // Cada tipo protegido com .catch pra que uma falha isolada não derrube a tabela.
  const pedidos = [
    listarFichasLocador({}).then(r => (r.data||[]).map(f => norm(f,'locador'))).catch(() => []),
    ...TIPOS.map(t => listarFichasTipo({ tipo:t }).then(r => (r.data||[]).map(f => norm(f,t))).catch(() => []))
  ];
  const partes = await Promise.all(pedidos);
  cadFichas = partes.flat().sort((a,b) => (b.criadoEm?.getTime()||0) - (a.criadoEm?.getTime()||0));

  if (isAdmin) {
    // uid no value (nome pode repetir); rótulo é o nome
    const vistos = new Map();
    cadFichas.forEach(f => { if (f.corretorUid && f.corretorNome && !vistos.has(f.corretorUid)) vistos.set(f.corretorUid, f.corretorNome); });
    const ordenados = [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    const selVisao = document.getElementById('cadVisao');
    if (selVisao) {
      selVisao.innerHTML = '<option value="">Visão geral (todos)</option>'
        + ordenados.map(([uid, nome]) => `<option value="${escapeHtml(uid)}">${escapeHtml(nome)}</option>`).join('');
      selVisao.value = cadVisao;
    }
    // filtro rápido da tabela (por nome) — convive com a Visão, que muda a base toda
    const selFiltro = document.getElementById('cadCorretor');
    if (selFiltro) {
      selFiltro.innerHTML = '<option value="">Todos</option>'
        + ordenados.map(([, nome]) => `<option value="${escapeHtml(nome)}">${escapeHtml(nome)}</option>`).join('');
      selFiltro.value = cadFiltro.corretor;
    }
  }
  cadRenderKpisTabs();
  cadRenderTabela();
}

function cadContagens() {
  const base = cadBase();
  const c = { todas: base.length, pendentes:0, enviadas:0, devolvidas:0, concluidas:0 };
  base.forEach(f => { c[cadStatusInfo(f).bucket]++; });
  return c;
}

function cadRenderKpisTabs() {
  const c = cadContagens();
  const nomeVisao = cadVisao ? (cadFichas.find(f => f.corretorUid === cadVisao)?.corretorNome || 'Corretor') : '';
  const kpis = [
    { k:'todas',      ico:'🏢', cls:'cad-ic-blue',   lbl: nomeVisao ? `Fichas de ${nomeVisao}` : (isAdmin?'Todas as fichas':'Minhas fichas'), sub:'Total geral', n:c.todas },
    { k:'pendentes',  ico:'📄', cls:'cad-ic-amber',  lbl:'Pendentes',          sub:'Aguardando ação',    n:c.pendentes },
    { k:'enviadas',   ico:'📤', cls:'cad-ic-green',  lbl:'Enviadas ao broker', sub:'Aguardando análise', n:c.enviadas },
    { k:'devolvidas', ico:'↩️', cls:'cad-ic-red',    lbl:'Devolvidas',         sub:'Para correção',      n:c.devolvidas },
    { k:'concluidas', ico:'✅', cls:'cad-ic-violet', lbl:'Concluídas',         sub:'Finalizadas',        n:c.concluidas },
  ];
  const kpiEl = document.getElementById('cadKpis');
  if (kpiEl) kpiEl.innerHTML = kpis.map(x => `
    <button class="cad-kpi ${cadFiltro.tab===x.k?'on':''}" data-tab="${x.k}">
      <div class="cad-ico ${x.cls}">${x.ico}</div>
      <div class="cad-lbl">${x.lbl}</div>
      <div class="cad-num">${x.n}</div>
      <div class="cad-sub">${x.sub}</div>
    </button>`).join('');

  const tabs = [['todas','Todas'],['pendentes','Pendentes'],['enviadas','Enviadas ao broker'],['devolvidas','Devolvidas'],['concluidas','Concluídas']];
  const tabsEl = document.getElementById('cadTabs');
  if (tabsEl) tabsEl.innerHTML = tabs.map(([k,label]) => `
    <button class="${cadFiltro.tab===k?'on':''}" data-tab="${k}">${label} <span class="cad-cnt">${c[k]}</span></button>`).join('');

  // KPI e aba compartilham o mesmo estado (cadFiltro.tab)
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', () => { cadFiltro.tab = el.dataset.tab; cadRenderKpisTabs(); cadRenderTabela(); });
  });
}

function cadFichasFiltradas() {
  return cadBase().filter(f => {
    if (cadFiltro.tab !== 'todas' && cadStatusInfo(f).bucket !== cadFiltro.tab) return false;
    if (cadFiltro.status && cadStatusInfo(f).bucket !== cadFiltro.status) return false;
    if (cadFiltro.tipo && f.key !== cadFiltro.tipo) return false;
    if (cadFiltro.corretor && f.corretorNome !== cadFiltro.corretor) return false;
    if (cadFiltro.periodo && f.criadoEm) {
      const dias = (Date.now() - f.criadoEm.getTime()) / 86400000;
      if (dias > Number(cadFiltro.periodo)) return false;
    }
    if (cadFiltro.busca) {
      const alvo = (f.nome + ' ' + f.doc + ' ' + f.corretorNome).toLowerCase();
      if (!alvo.includes(cadFiltro.busca)) return false;
    }
    return true;
  });
}

function cadNomePend(p) {
  const nomes = { cpf:'CPF', rg:'RG', rgcpf:'RG/CPF', renda:'Renda', compRenda:'Comp. renda', compEndereco:'Comp. endereço',
    rgFrente:'RG frente', rgVerso:'RG verso', matricula:'Matrícula', iptu:'IPTU', profissao:'Profissão' };
  return nomes[p] || p;
}

function cadRenderTabela() {
  const tbody = document.getElementById('cadTbody');
  if (!tbody) return;
  const lista = cadFichasFiltradas();
  const colSpan = isAdmin ? 7 : 6;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="cad-vazio">Nenhuma ficha encontrada com esses filtros.</td></tr>`;
    const foot0 = document.getElementById('cadFoot'); if (foot0) foot0.textContent = '';
    return;
  }

  tbody.innerHTML = lista.map(f => {
    const st = cadStatusInfo(f);
    const data = f.criadoEm
      ? f.criadoEm.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + f.criadoEm.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
      : '—';
    const pend = f.pendentes.length
      ? `<span class="cad-pend-x">⚠ ${f.pendentes.length} pendência${f.pendentes.length>1?'s':''}<span class="cad-det">${escapeHtml(f.pendentes.map(p=>cadNomePend(p)).join(', '))}</span></span>`
      : '<span class="cad-pend-ok">✓ Sem pendências</span>';
    const corretorCel = isAdmin
      ? `<td><div class="cad-corretor"><span class="cad-avt" style="width:26px;height:26px;font-size:10px;background:${cadCor(f.corretorNome)}">${cadIniciais(f.corretorNome)}</span><div class="cad-cr-nm">${escapeHtml(f.corretorNome||'—')}</div></div></td>`
      : '';
    return `<tr>
      <td><div class="cad-cli"><span class="cad-avt" style="background:${cadCor(f.nome)}">${cadIniciais(f.nome)}</span>
        <div><div class="cad-nm">${escapeHtml(f.nome)}</div><div class="cad-cpf">${escapeHtml(f.doc||'')}</div></div></div></td>
      <td><span class="cad-tipo"><span class="cad-ti">${CAD_TIPO_ICO[f.key]||'📄'}</span>${f.tipoLabel}</span></td>
      ${corretorCel}
      <td style="white-space:nowrap;color:var(--text-muted)">${data}</td>
      <td>${pend}</td>
      <td><span class="cad-pill ${st.cls}">${st.label}</span></td>
      <td><div class="cad-acoes">
        <button class="topbar-btn cad-abrir" data-id="${f.id}" data-key="${f.key}" style="height:28px">Abrir ficha</button>
        <button class="cad-kebab" data-id="${f.id}" data-key="${f.key}" aria-label="Ações">⋮</button>
      </div></td>
    </tr>`;
  }).join('');

  const foot = document.getElementById('cadFoot');
  if (foot) foot.innerHTML = `<span>Mostrando ${lista.length} ficha${lista.length>1?'s':''}${lista.length!==cadBase().length?` de ${cadBase().length}`:''}</span>`;

  tbody.querySelectorAll('.cad-abrir').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = cadFichas.find(x => x.id === btn.dataset.id && x.key === btn.dataset.key);
      if (f) abrirModalFicha(f.arquivo, f.id, 'corretor', '👁 ' + f.tipoLabel);
    });
  });
  tbody.querySelectorAll('.cad-kebab').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const f = cadFichas.find(x => x.id === btn.dataset.id && x.key === btn.dataset.key);
      if (f) cadAbrirMenu(btn, f);
    });
  });
}

// Menu de ações do kebab — anexado ao body, fecha ao clicar fora.
function cadAbrirMenu(anchor, f) {
  document.querySelector('.cad-menu')?.remove();
  const ehLocador = f.key === 'locador';
  const podeMexer = ['aguardando_corretor','aguardando_edicao_cliente'].includes(f.status);
  const menu = document.createElement('div');
  menu.className = 'cad-menu';
  menu.innerHTML = `
    <button data-a="editar">✏ Editar</button>
    <button data-a="pdf">⬇ Baixar PDF</button>
    ${podeMexer ? '<button data-a="enviar">📤 Enviar ao broker</button>' : ''}
    ${podeMexer ? '<button data-a="reenviar">↩ Reenviar ao cliente</button>' : ''}
    <div class="cad-menu-sep"></div>
    <button data-a="excluir" class="perigo">🗑 Excluir</button>`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';

  const fechar = () => { menu.remove(); document.removeEventListener('click', fora); };
  const fora = ev => { if (!menu.contains(ev.target)) fechar(); };
  setTimeout(() => document.addEventListener('click', fora), 0);

  const fnEnviar   = ehLocador ? enviarFichaParaAdmin     : enviarFichaTipoAdmin;
  const fnReenviar = ehLocador ? reenviarFichaParaCliente : reenviarFichaTipoCliente;
  const fnExcluir  = ehLocador ? excluirFichaLocador      : excluirFichaTipo;

  menu.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', async () => {
    const acao = b.dataset.a; fechar();
    if (acao === 'editar') { abrirModalFicha(f.arquivo, f.id, 'edicao', '✏ Editar ' + f.tipoLabel); return; }
    if (acao === 'pdf') {
      const url = `${BASE_HOSTING}/${f.arquivo}?modo=corretor&idFicha=${f.id}&origem=hub`;
      const nome = (f.nome || 'ficha').replace(/[^a-zA-Z0-9À-ɏ\s_-]/g,'').trim();
      try { const rr = await hubApi.baixarFichaPDF(url, `Ficha - ${nome}.pdf`); if (!rr?.ok && rr?.erro) alert('Erro ao gerar PDF: ' + rr.erro); }
      catch(err) { console.warn('PDF:', err); }
      return;
    }
    if (acao === 'enviar') {
      if (!confirm('Confirma envio desta ficha para o administrativo?')) return;
      try { await fnEnviar({ fichaId: f.id }); atualizarNotifFichas(); await cadCarregarFichas(); }
      catch(err) { alert('Erro: ' + err.message); }
      return;
    }
    if (acao === 'reenviar') {
      const obs = prompt('Observação para o cliente (opcional):');
      if (obs === null) return;
      try {
        const rr = await fnReenviar({ fichaId: f.id, observacao: obs });
        await navigator.clipboard.writeText(rr.data.link).catch(() => prompt('Copie o link:', rr.data.link));
        alert('Link copiado! Envie ao cliente pelo WhatsApp.');
        await cadCarregarFichas();
      } catch(err) { alert('Erro: ' + err.message); }
      return;
    }
    if (acao === 'excluir') {
      if (!confirm('Excluir esta ficha permanentemente?')) return;
      try { await fnExcluir({ fichaId: f.id }); }
      catch(err) { if (!err.message?.includes('não encontrada') && !err.message?.includes('not-found')) { alert('Erro: ' + err.message); return; } }
      await cadCarregarFichas();
      return;
    }
  }));
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
    const naoVistos = notifDados.filter(n => n.id && !vistos.has(n.id));
    if (naoVistos.length > 0) {
      notifBadge.textContent = naoVistos.length > 99 ? '99+' : naoVistos.length;
      notifBadge.hidden = false;
    } else {
      notifBadge.hidden = true;
    }
    const tiposNaoVistos = new Set(naoVistos.map(n => n.tipo));
    FICHAS_CONFIG.forEach(f => { const dot = document.getElementById('dot-' + f.key); if (dot) dot.hidden = !tiposNaoVistos.has(f.key); });
  } catch(e) { console.warn('Notif fichas:', e); }
}

const adminBadge = document.getElementById('adminBadge');
async function atualizarBadgeChamados() {
  if (!temPermTI && !isAdmin) { if (adminBadge) adminBadge.hidden = true; return; }
  try {
    const res = await contarChamadosAbertos();
    const total = res.data?.total || 0;
    if (total > 0 && adminBadge) {
      adminBadge.textContent = total > 99 ? '99+' : total;
      adminBadge.hidden = false;
    } else if (adminBadge) {
      adminBadge.hidden = true;
    }
  } catch (e) { console.warn('Badge chamados:', e); }
}

// ─── Aba TI: carregar e responder chamados ──────────────────────────────
async function carregarChamadosHub() {
  const el = document.getElementById('listaChamadosHub');
  if (!el) return;
  el.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const r = await listarChamados();
    const lista = r.data || [];
    if (!lista.length) { el.innerHTML = '<p class="muted">Nenhum chamado recebido.</p>'; return; }
    el.innerHTML = `
      <table class="users-table">
        <thead><tr><th>Usuário</th><th>Mensagem</th><th>Data</th><th>Status</th><th></th></tr></thead>
        <tbody>${lista.map(c => {
          const d = c.criadoEm ? new Date(c.criadoEm).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
          const st = c.status === 'aberto'
            ? '<span style="color:#e8a735;font-weight:600">Aberto</span>'
            : '<span style="color:#22c55e;font-weight:600">Resolvido</span>';
          const msg = escapeHtml((c.mensagem||'').slice(0,80)) + ((c.mensagem||'').length > 80 ? '…' : '');
          return `<tr>
            <td><strong style="font-size:12px">${escapeHtml(c.criadoPorNome)}</strong><div class="muted" style="font-size:10px">${escapeHtml(c.criadoPorEmail)}</div></td>
            <td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg}${c.temImagem ? ' 📎' : ''}</td>
            <td style="font-size:12px;white-space:nowrap">${d}</td>
            <td>${st}</td>
            <td>${c.status === 'aberto'
              ? `<button class="topbar-btn primario chamadoHub-resp" data-id="${c.id}" data-nome="${escapeHtml(c.criadoPorNome)}" data-email="${escapeHtml(c.criadoPorEmail)}" data-msg="${escapeHtml(c.mensagem||'')}">Responder</button>`
              : `<span class="muted" style="font-size:11px">${escapeHtml((c.resposta||'').slice(0,60))}${(c.resposta||'').length>60?'…':''}</span>
                 <button class="topbar-btn perigo chamadoHub-del" data-id="${c.id}" style="margin-left:6px;font-size:11px">Excluir</button>`
            }</td></tr>`;
        }).join('')}</tbody>
      </table>`;
    el.querySelectorAll('.chamadoHub-resp').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('chamadoHubId').value = btn.dataset.id;
        document.getElementById('chamadoHubNome').textContent = btn.dataset.nome;
        document.getElementById('chamadoHubEmail').textContent = btn.dataset.email;
        document.getElementById('chamadoHubMsgOriginal').textContent = btn.dataset.msg;
        document.getElementById('chamadoHubResposta').value = '';
        document.getElementById('modalResponderChamadoHub').showModal();
      });
    });
    el.querySelectorAll('.chamadoHub-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '...';
        try {
          await excluirChamado({ chamadoId: btn.dataset.id });
          carregarChamadosHub();
          atualizarBadgeChamados();
        } catch (err) { alert('Erro: ' + err.message); btn.disabled = false; btn.textContent = 'Excluir'; }
      });
    });
  } catch (e) { el.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; }
}

document.querySelectorAll('.chamadoHub-cancelar').forEach(b => b.addEventListener('click', () => {
  document.getElementById('modalResponderChamadoHub').close();
}));

document.getElementById('formResponderChamadoHub').addEventListener('submit', async (e) => {
  e.preventDefault();
  const chamadoId = document.getElementById('chamadoHubId').value;
  const resposta = document.getElementById('chamadoHubResposta').value.trim();
  if (!resposta) return;
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await responderChamado({ chamadoId, resposta });
    document.getElementById('modalResponderChamadoHub').close();
    carregarChamadosHub();
    atualizarBadgeChamados();
  } catch (err) { alert('Erro: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Resolver e responder'; }
});

function renderNotifPanel() {
  if (!notifDados.length) {
    notifLista.innerHTML = '<p class="notif-vazio">Nenhuma ficha pendente</p>';
    return;
  }
  const vistos = getVistos();
  notifLista.innerHTML = notifDados.map(n => {
    const data = n.data ? new Date(n.data).toLocaleDateString('pt-BR') : '—';
    const sub  = n.corretor ? `${n.corretor} · ${data}` : data;
    const novo = n.id && !vistos.has(n.id);
    return `<div class="notif-item${novo ? ' notif-novo' : ''}" data-tipo="${n.tipo}">
      ${novo ? '<span class="notif-item-dot"></span>' : ''}
      <span class="notif-item-titulo">${escapeHtml(n.nome)}</span>
      <span class="notif-item-sub">${escapeHtml(n.tipoLabel)} · ${escapeHtml(sub)}</span>
    </div>`;
  }).join('');

  notifLista.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      notifPanel.hidden = true;
      const secKey = item.dataset.tipo;
      // Todas as fichas (locação e venda) vivem no Cadastro.
      categoriaAtiva = 'documentos';
      locSub = null;
      renderSidebar();
      renderCentro();
      // Abre o accordion da ficha correspondente
      setTimeout(() => {
        const head = document.querySelector(`.docs-acc-head[data-key="${secKey}"]`);
        if (head) head.click();
      }, 250);
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
