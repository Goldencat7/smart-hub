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
  getFirestore, doc, getDoc, setDoc, serverTimestamp as fsTs, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
// Config por ambiente (prod/staging/emulador, por hostname) — ver firebase-env.js
import { firebaseConfig, conectarEmuladores } from "./firebase-env.js";

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const fns     = getFunctions(app, 'southamerica-east1');
const storage = getStorage(app);
const db      = getFirestore(app);
conectarEmuladores({ auth, fns, db, storage });

const getCredentials = httpsCallable(fns, 'getCredentials');
const bootstrapAdmin = httpsCallable(fns, 'bootstrapAdmin');
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const registrarAcesso = httpsCallable(fns, 'registrarAcesso');
const getMeuPerfil = httpsCallable(fns, 'getMeuPerfil');
const salvarMeuPerfil = httpsCallable(fns, 'salvarMeuPerfil');
const sugerirRespostaLead = httpsCallable(fns, 'sugerirRespostaLead');
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
const locSolicitarVistoriaCheckVisto = httpsCallable(fns, 'locSolicitarVistoriaCheckVisto');
const locDashboard = httpsCallable(fns, 'locDashboard');
const locRelatorios = httpsCallable(fns, 'locRelatorios');
const criarEvento = httpsCallable(fns, 'criarEvento');
const editarEvento = httpsCallable(fns, 'editarEvento');
const listarEventos = httpsCallable(fns, 'listarEventos');
const excluirEvento = httpsCallable(fns, 'excluirEvento');
const listarPessoas = httpsCallable(fns, 'listarPessoas');
const conectarGoogleAgenda = httpsCallable(fns, 'conectarGoogleAgenda');
const desconectarGoogleAgenda = httpsCallable(fns, 'desconectarGoogleAgenda');
// Robô do Drive (setup admin, só .exe) — conecta a conta dedicada com escopo drive completo.
const conectarDriveRobo = httpsCallable(fns, 'conectarDriveRobo');
const driveRoboStatus   = httpsCallable(fns, 'driveRoboStatus');
const driveRoboTeste    = httpsCallable(fns, 'driveRoboTeste');
const driveListarSubpastas = httpsCallable(fns, 'driveListarSubpastas');
const driveMapaGet      = httpsCallable(fns, 'driveMapaGet');
const driveMapaSalvar   = httpsCallable(fns, 'driveMapaSalvar');
const DRIVE_ROBO_SCOPE  = 'openid email https://www.googleapis.com/auth/drive';

// Retorno do OAuth do Google no WEB: a página google-callback.html volta pra cá
// com ?google=ok|erro. Guarda o resultado e limpa a URL agora; o aviso sai depois
// do login (quando a auth e o botão já estão prontos). No .exe isso nunca dispara.
try {
  const _gp = new URLSearchParams(location.search);
  if (_gp.has('google')) {
    sessionStorage.setItem('__googleRetorno', _gp.get('google') + '|' + (_gp.get('msg') || ''));
    history.replaceState(null, '', location.pathname + location.hash);
  }
} catch (_) { /* location/sessionStorage indisponível: ignora */ }
const statusGoogleAgenda = httpsCallable(fns, 'statusGoogleAgenda');
const listarGoogleAgenda = httpsCallable(fns, 'listarGoogleAgenda');
const criarNotificacao = httpsCallable(fns, 'criarNotificacao');
const listarNovidades = httpsCallable(fns, 'listarNovidades');
const listarMinhasNotificacoes = httpsCallable(fns, 'listarMinhasNotificacoes');
const marcarNotificacaoLida = httpsCallable(fns, 'marcarNotificacaoLida');
const responderConvite = httpsCallable(fns, 'responderConvite');
const getBanner        = httpsCallable(fns, 'getBanner');
const listarBanners    = httpsCallable(fns, 'listarBanners');
const noticiaImoveisDoDia = httpsCallable(fns, 'noticiaImoveisDoDia');
const recrutamentoListar    = httpsCallable(fns, 'recrutamentoListar');
const recrutamentoObter     = httpsCallable(fns, 'recrutamentoObter');
const recrutamentoSalvar    = httpsCallable(fns, 'recrutamentoSalvar');
const recrutamentoHistorico = httpsCallable(fns, 'recrutamentoHistorico');
const recrutamentoExcluir   = httpsCallable(fns, 'recrutamentoExcluir');
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
const listarFotosPerfil         = httpsCallable(fns, 'listarFotosPerfil');
const fichaDefinirVisibilidade  = httpsCallable(fns, 'fichaDefinirVisibilidade');
const listarStatusApps    = httpsCallable(fns, 'listarStatusApps');
const contarNotifFichas   = httpsCallable(fns, 'contarNotifFichas');
const contarChamadosAbertos = httpsCallable(fns, 'contarChamadosAbertos');
const listarChamados      = httpsCallable(fns, 'listarChamados');
const responderChamado    = httpsCallable(fns, 'responderChamado');
const excluirChamado      = httpsCallable(fns, 'excluirChamado');
// Carteira de Imóveis
const carteiraSalvarImovel = httpsCallable(fns, 'carteiraSalvarImovel');
const carteiraArquivar     = httpsCallable(fns, 'carteiraArquivar');
const carteiraSituacaoFn   = httpsCallable(fns, 'carteiraSituacao');
const carteiraInteressado  = httpsCallable(fns, 'carteiraInteressado');
const negocioGerarFn       = httpsCallable(fns, 'negocioGerar');
const gerarContratoVendaFn = httpsCallable(fns, 'gerarContratoVenda');

// Baixa um PDF a partir de base64 (o backend devolve o contrato assim). Funciona
// tanto no .exe (Electron) quanto no navegador/PWA — só um <a download> com blob.
function baixarBase64Pdf(b64, filename) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'contrato.pdf';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
const negocioListarFn      = httpsCallable(fns, 'negocioListar');
const negocioObterFn       = httpsCallable(fns, 'negocioObter');
const negocioAtualizarFn   = httpsCallable(fns, 'negocioAtualizar');
const dashboardDadosFn     = httpsCallable(fns, 'dashboardDados');
const configObterFn        = httpsCallable(fns, 'configObter');

const BOOTSTRAP_ADMIN_UIDS = ['OwcT6wCrXMgJ0tPADMUdKdBB8h32', 'GpyXVhlmJhMUHliypiEwhoi27Fp1'];

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
    url: 'https://checkvisto-app.web.app', autologin: false,
    // Alternativa oferecida quando o admin marca o app como instável/indisponível:
    // o aviso ganha um botão que abre o site no navegador padrão. É a saída
    // enquanto a janela nativa do CheckVisto dentro do Hub não está confiável.
    linkNavegador: 'https://checkvisto-app.web.app'
  },
  {
    key: 'alude', categoria: 'captacao',
    titulo: 'Alude', icone: 'AL', desc: 'Análise de crédito',
    url: 'https://app.alude.com.br/', autologin: true
  },
  {
    key: 'clicksign', categoria: '_',
    titulo: 'ClickSign', icone: 'CS', desc: 'Assinatura digital',
    url: 'https://app.clicksign.com/', autologin: true
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
  recrutamento: svgIcone('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  ti:            svgIcone('<path d="M4 15s1-1 4-1 4 1 4 1"/><circle cx="8" cy="9" r="3"/><path d="M22 19V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14"/><path d="M16 8h.01M16 12h4"/>'),
  imoveis:      svgIcone('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/>'),
  financeiro:   svgIcone('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="8" cy="15" r="1.4"/>'),
  locadmin:     svgIcone('<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  painel:       svgIcone('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  config:      svgIcone('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  perfil:      svgIcone('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  home:        svgIcone('<path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>'),
  ferramentas: svgIcone('<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.7 2.7-2.3-2.3z"/>')
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
  { id: 'painel',     titulo: 'Painel',     desc: 'Visão geral da carteira',        icone: ICN.painel },
  { id: 'imoveis',    titulo: 'Imóveis',    desc: 'Carteira de imóveis',            icone: ICN.imoveis },
  { id: 'negocios',   titulo: 'Negócios',   desc: 'Vendas e locações em andamento', icone: ICN.locadmin },
  { id: 'relatorios', titulo: 'Relatórios', desc: 'Indicadores e exportações',      icone: ICN.financeiro },
];

// webOculto: escondida no PWA/celular (apps externos que dependem de autologin, ou
// não fazem sentido no celular). No PWA sobram só as ferramentas que funcionam como
// link web (ITBI Smart, Smart Vistorias) + as telas internas (Meus Negócios, Cadastro,
// Agenda, Calculadoras, Notas, Meu Perfil). Marketing sai do PWA a pedido do Nathan.
// Catálogo de TELAS (cada item carrega flags/permissões e é a fonte de verdade do que abre).
// A ORDEM e o AGRUPAMENTO da sidebar vivem em SIDEBAR_LAYOUT (abaixo) — aqui é só o catálogo.
const CATEGORIAS = [
  { id: 'home',        nome: 'Dashboard',   icone: ICN.home, home: true },
  { id: 'captacao',    nome: 'Captações',   icone: ICN.captacao },
  { id: 'crm',         nome: 'CRM',         icone: ICN.crm, webOculto: true },
  { id: 'vistoria',    nome: 'Vistorias',   icone: ICN.vistoria },
  { id: 'performance', nome: 'Performance', icone: ICN.performance, webOculto: true },
  { id: 'treinamento', nome: 'Treinamentos', icone: ICN.treinamento, treinamento: true, webOculto: true },
  { id: 'marketing',   nome: 'Marketing',   icone: ICN.marketing, marketing: true, webOculto: true },
  { id: 'clicksign',   nome: 'Clicksign',   icone: ICN.clicksign, appDireto: 'clicksign', webOculto: true },
  { id: 'agenda',      nome: 'Minha Agenda', icone: ICN.agenda, agenda: true },
  { id: 'documentos',  nome: 'Fichas Digitais', icone: ICN.documentos, placeholder: true },
  // "Meus Negócios" aparece pra TODOS os papéis de locação (gestor→Broker,
  // administrativo→Admin, corretor→Corretor). A visão é roteada por papel no
  // branch cat.locacoes.
  { id: 'locacoes',    nome: 'Meus Negócios', icone: ICN.locacao, locacoes: true },
  { id: 'recrutamento', nome: 'Recrutamento', icone: ICN.recrutamento, recrutamento: true, soGestor: true },
  { id: 'fotografia',  nome: 'Fotografia',  icone: ICN.fotografia, fotografia: true },   // aparece no celular (pedido 2026-08-13): agendamento + Drive são iframes/links, funcionam na web
  { id: 'reuniao',      nome: 'Reuniões',        icone: ICN.reuniao, reuniao: true, webOculto: true },
  { id: 'sala_reuniao', nome: 'Reserva de Sala', icone: ICN.salaReuniao, salaReuniao: true, webOculto: true },
  { id: 'ia',           nome: 'SMART IA',        icone: ICN.ia, ia: true, webOculto: true },
  { id: 'calculadoras', nome: 'Calculadoras',    icone: ICN.calculadoras, calculadoras: true },
  { id: 'notas',        nome: 'Bloco de Notas',  icone: ICN.notas, notas: true },
  { id: 'whatsapp',    nome: 'WhatsApp',     icone: ICN.whatsapp, appDireto: 'whatsapp', webOculto: true },
  { id: 'ti',          nome: 'Suporte / TI',  icone: ICN.ti, ti: true, soTI: true },
  { id: 'config',      nome: 'Meu Perfil', icone: ICN.perfil, config: true }
];

// Organização da sidebar (2026-07-30, pedido do Nathan): itens soltos + grupos-sanfona.
// { item } = tela solta (usa as flags da CATEGORIAS). { grupo, filhos } = cabeçalho que
// abre/fecha mostrando os filhos (cada filho é um id de CATEGORIAS). Grupo sem filho
// visível (permissão) não aparece.
const SIDEBAR_LAYOUT = [
  { item: 'home' },
  { item: 'locacoes' },
  { item: 'recrutamento' },
  { grupo: 'g_pessoas',        nome: 'Pessoas',        icone: ICN.crm,         filhos: ['crm', 'documentos'] },
  { grupo: 'g_imoveis',        nome: 'Imóveis',        icone: ICN.imoveis,     filhos: ['captacao', 'vistoria', 'fotografia'] },
  { grupo: 'g_agenda',         nome: 'Agenda',         icone: ICN.agenda,      filhos: ['agenda', 'reuniao', 'sala_reuniao'] },
  { item: 'ia' },
  { grupo: 'g_ferramentas',    nome: 'Ferramentas',    icone: ICN.ferramentas, filhos: ['whatsapp', 'calculadoras', 'notas', 'clicksign'] },
  { grupo: 'g_desenvolvimento', nome: 'Desenvolvimento', icone: ICN.performance, filhos: ['treinamento', 'marketing', 'performance'] },
  { item: 'ti' },
  { item: 'config' },
];

// Web/PWA? O shim web zera o autologin (`hubApi.autologin === false`, `plataforma:'web'`).
// (No .exe/desktop isso é sempre false → nada é escondido.)
function ehWeb() { return !!(window.hubApi && (window.hubApi.plataforma === 'web' || window.hubApi.autologin === false)); }
// Tela de celular? (mesmo breakpoint do layout mobile). O PWA aberto num PC (tela larga)
// NÃO conta como celular.
function ehTelaCelular() { return typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches); }
// Só o PWA NUM CELULAR enxuga os apps. Desktop (.exe) e PWA num PC mostram tudo.
function ehPwaCelular() { return ehWeb() && ehTelaCelular(); }
// Apps liberados no PWA do celular (não dependem de autologin — abrem como link web).
const WEB_APPS = new Set(['itbi_smart', 'checkvisto']);

// Avatar padrão (quando a pessoa não tem foto)
const AVATAR_PADRAO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1d222d"/><circle cx="60" cy="46" r="22" fill="#6b7280"/><rect x="24" y="74" width="72" height="48" rx="24" fill="#6b7280"/></svg>'
);

let categoriaAtiva = 'home';
const gruposAbertos = new Set();   // ids dos grupos-sanfona da sidebar que estão expandidos
let locSub = null;              // sub-app aberto dentro da aba Locação (null = grade de cards)
let locSanfonaAberta = false;   // "Meus Negócios" expandido na sidebar (sanfona)
let locBrokerView = 'dashboard';// tela ativa do Broker embutido (sub-item da sanfona)
let brokerMontado = false;      // Broker já montado (embutido) na área central
let termoBusca = '';
let isAdmin = false;
let locRoleAtual = 'corretor'; // papel na Gestão de Locações (setado no onAuthStateChanged)
let betaLocacoes = false;       // acesso de teste ao módulo de Locações (feature flag) — gate das abas
let locacoesPublicado = false;  // true quando a versão deste app foi publicada p/ todos (painel de Admin)
let currentUid = null;
// Tempo real (padrão "campainha"): escuta user_feed/{uid} pra "recebeu ficha" aparecer
// na hora, e o Broker escuta imóveis/negócios. Vire false pra voltar 100% pro timing
// (polling), sem tirar código. O broker-app.js tem a MESMA flag — manter as duas iguais.
const REALTIME = true;
let appsPermitidos = [];
let temDrivesFotografia = false;
let temPermTI = false;
let statusApps = {};
let treinamentoLinks = {};     // { itemId: { url, tipo } }
let treinamentoCatAberta = null; // id da categoria expandida no accordion
let bannerImagens = [];            // array final exibido no carrossel (admin + notícia)
let bannerAdmin = [];              // só os banners do admin (antes de anexar a notícia)
let bannerNoticia = null;          // slot da notícia (último item), ou null
let noticiaLista = [];             // manchetes do RSS (troca a cada vez que o banner aparece)
let noticiaPtr = 0;                // ponteiro da manchete atual
let bannerIdx = 0;                 // índice do banner atual no carrossel
let renderizandoCal = false;
let renderCalPendente = false;    // fix 3: guarda clique durante render pra re-renderizar depois
let verificandoNotif = false;     // Bug 5: evita chamadas concorrentes de verificarNotificacoes // apps restritos liberados pra este usuário

// ─── DOM ─────────────────────────────────────────────────────────────────
const navCategorias  = document.getElementById('navCategorias');
const tituloCategoria = document.getElementById('tituloCategoria');
const hubMain        = document.querySelector('.hub-main');
const hubMainHead    = document.querySelector('.hub-main-head');
const inputBusca     = document.getElementById('inputBusca');
const searchWrap     = document.querySelector('.search-wrap');
const appsGrid       = document.getElementById('appsGrid');
const estadoVazio    = document.getElementById('estadoVazio');
const secaoHome      = document.getElementById('secaoHome');
const secaoMarketing      = document.getElementById('secaoMarketing');
const secaoDocs           = document.getElementById('secaoDocumentos');
const secaoFotografia     = document.getElementById('secaoFotografia');
const secaoReuniao        = document.getElementById('secaoReuniao');
const secaoSalaReuniao    = document.getElementById('secaoSalaReuniao');
const secaoIA             = document.getElementById('secaoIA');
const secaoCalculadoras   = document.getElementById('secaoCalculadoras');
const secaoNotas          = document.getElementById('secaoNotas');
const secaoRecrutamento   = document.getElementById('secaoRecrutamento');
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
const cfgWhatsapp    = document.getElementById('cfgWhatsapp');
const cfgCreci       = document.getElementById('cfgCreci');
const cfgCpf         = document.getElementById('cfgCpf');
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
  // Permissão/visibilidade de uma TELA (mesma regra de antes).
  const podeVer = c => !!c && !c.oculto
    && (!c.webOculto || !ehPwaCelular())
    && (!c.soGestor || locRoleAtual === 'gestor')
    && (!c.restrito || isAdmin || (c.appDireto && appsPermitidos.includes(c.appDireto)))
    && (!c.soTI || temPermTI || isAdmin);
  const catDe = id => CATEGORIAS.find(c => c.id === id);

  // HTML de um item solto (inclui a sanfona própria do "Meus Negócios").
  const itemHtml = c => {
    const btn = `
    <button class="nav-item ${c.id === categoriaAtiva ? 'ativo' : ''} ${c.config ? 'nav-item-fim' : ''}" data-cat="${c.id}">
      <span class="nav-icone">${c.icone}</span>
      <span class="nav-label">${c.nome}</span>
      ${c.locacoes ? `<span class="nav-caret">${locSanfonaAberta ? '▾' : '▸'}</span>` : ''}
    </button>`;
    if (c.locacoes && locSanfonaAberta) {
      const itens = locSubItens();
      if (itens.length) {
        const subs = itens.map(s => `
        <button class="nav-subitem ${locBrokerView === s.id ? 'ativo' : ''}" data-locview="${s.id}">
          <span class="nav-sub-dot"></span><span>${s.label}</span>
        </button>`).join('');
        return btn + `<div class="nav-subwrap">${subs}</div>`;
      }
    }
    return btn;
  };

  // Monta a sidebar seguindo SIDEBAR_LAYOUT: itens soltos + grupos-sanfona.
  let html = '';
  for (const entry of SIDEBAR_LAYOUT) {
    if (entry.item) {
      const c = catDe(entry.item);
      if (podeVer(c)) html += itemHtml(c);
    } else if (entry.grupo) {
      const filhos = entry.filhos.map(catDe).filter(podeVer);
      if (!filhos.length) continue;   // grupo sem filho visível não aparece
      // Aberto = SÓ o que está em gruposAbertos. Ao navegar pra uma tela de dentro,
      // `abrirGrupoDe` adiciona o grupo ao set — então ele abre sozinho, mas o clique
      // no cabeçalho consegue FECHAR de verdade (antes o "contém a tela ativa" reabria).
      const aberto = gruposAbertos.has(entry.grupo);
      html += `
      <button class="nav-item nav-group" data-grupo="${entry.grupo}">
        <span class="nav-icone">${entry.icone}</span>
        <span class="nav-label">${entry.nome}</span>
        <span class="nav-caret">${aberto ? '▾' : '▸'}</span>
      </button>`;
      if (aberto) {
        html += `<div class="nav-subwrap">` + filhos.map(f => `
        <button class="nav-subitem ${f.id === categoriaAtiva ? 'ativo' : ''}" data-cat="${f.id}">
          <span class="nav-sub-dot"></span><span>${f.nome}</span>
        </button>`).join('') + `</div>`;
      }
    }
  }
  navCategorias.innerHTML = html;

  // Grupos: abrir/fechar a sanfona.
  navCategorias.querySelectorAll('[data-grupo]').forEach(b => {
    b.addEventListener('click', () => {
      const g = b.dataset.grupo;
      if (gruposAbertos.has(g)) gruposAbertos.delete(g); else gruposAbertos.add(g);
      renderSidebar();
    });
  });

  // Itens soltos + filhos de grupo (ambos têm data-cat) → ativa a tela.
  navCategorias.querySelectorAll('[data-cat]').forEach(b => {
    b.addEventListener('click', () => ativarCategoria(b.dataset.cat));
  });

  // Sub-itens do Broker embutido (Meus Negócios): trocam a tela sem remontar.
  navCategorias.querySelectorAll('[data-locview]').forEach(b => {
    b.addEventListener('click', () => {
      locBrokerView = b.dataset.locview;
      if (window.Broker && window.Broker.navigate) window.Broker.navigate(locBrokerView);
      navCategorias.querySelectorAll('[data-locview]').forEach(x => x.classList.toggle('ativo', x.dataset.locview === locBrokerView));
    });
  });
}

// Abre (no set) o grupo-sanfona que contém uma tela — pra ela aparecer destacada
// quando a navegação vem de fora do sidebar (bridge do Broker, alerta, etc.).
function abrirGrupoDe(id) {
  const g = SIDEBAR_LAYOUT.find(e => e.grupo && e.filhos.includes(id));
  if (g) gruposAbertos.add(g.grupo);
}

// Ativa uma tela. appDireto abre app; locacoes é a sanfona embutida do Broker;
// o resto troca a tela central. Reusado pelos itens soltos e pelos filhos de grupo.
function ativarCategoria(id) {
  const cat = CATEGORIAS.find(c => c.id === id);
  if (!cat) return;
  if (cat.appDireto) { abrirApp(cat.appDireto); return; }
  if (cat.locacoes) {
    // Sanfona: se já está aberta e ativa, clicar de novo FECHA (recolhe + sai do Broker).
    if (locSanfonaAberta && categoriaAtiva === 'locacoes') {
      locSanfonaAberta = false;
      categoriaAtiva = 'home';
      locSub = null;
      renderSidebar();
      renderCentro();   // desmonta o Broker e restaura o layout do Hub
      return;
    }
    categoriaAtiva = 'locacoes';
    locSanfonaAberta = true;
    if (!locBrokerView) locBrokerView = 'dashboard';
    termoBusca = ''; inputBusca.value = '';
    renderSidebar();
    renderCentro();
    registrarAcesso({ siteKey: 'locacoes', titulo: 'Meus Negócios' }).catch(() => {});
    return;
  }
  categoriaAtiva = id;
  locSub = null;
  locSanfonaAberta = false;   // sai da sanfona do Broker ao trocar de tela
  termoBusca = '';
  inputBusca.value = '';
  abrirGrupoDe(id);           // mantém aberto o grupo da tela que abriu
  renderSidebar();
  renderCentro();
  const _grid = ['captacao', 'crm', 'vistoria', 'performance'];
  if (!cat.appDireto && cat.id !== 'config' && !_grid.includes(cat.id)) {
    registrarAcesso({ siteKey: cat.id, titulo: cat.nome }).catch(() => {});
  }
}

// Papel na Gestão de Locações → Broker/Corretor/Administrativo. Fonte ÚNICA: a
// claim `locRole` (via locMeuPerfil). gestor→Broker, administrativo→Admin, resto→Corretor.
// (A antiga permissão `loc_gestao` foi removida — ver CLAUDE.md.)
function locPapel() {
  return locRoleAtual === 'gestor' ? 'broker'
       : (locRoleAtual === 'administrativo' ? 'administrativo' : 'corretor');
}
// Sub-itens da sanfona = menu do Broker daquele papel, SEM "Agenda" nem "Meu Perfil"
// (Agenda já existe no Hub; "Meu Perfil" virou a aba de baixo do Hub, no lugar de Configurações).
function locSubItens() {
  const nav = (window.Broker && window.Broker.getNav) ? window.Broker.getNav(locPapel()) : [];
  return nav.filter(n => n.id !== 'agenda' && n.id !== 'perfil');
}

// ─── Render central (cards filtrados) ────────────────────────────────────
function renderCentro() {
  const cat = CATEGORIAS.find(c => c.id === categoriaAtiva);
  tituloCategoria.textContent = cat.nome;

  // Saiu do "Meus Negócios" embutido → desmonta o Broker e restaura o layout do Hub.
  if (!cat.locacoes && brokerMontado) {
    if (window.Broker && window.Broker.unmount) window.Broker.unmount();
    brokerMontado = false;
    const bk = document.getElementById('bkRoot'); if (bk) bk.hidden = true;
    hubMainHead.hidden = false;
    hubMain.classList.remove('hub-main--broker');
    hubLayout.classList.remove('loc-embed');
  }

  secaoConfig.hidden = true;
  secaoAgenda.hidden = true;
  secaoMarketing.hidden = true;
  secaoFotografia.hidden = true;
  secaoReuniao.hidden = true;
  secaoSalaReuniao.hidden = true;
  secaoIA.hidden = true;
  secaoCalculadoras.hidden = true;
  secaoNotas.hidden = true;
  secaoRecrutamento.hidden = true;
  secaoImoveis.hidden = true;
  secaoFinanceiro.hidden = true;
  secaoPainel.hidden = true;
  secaoAlertas.hidden = true;
  secaoRelatorios.hidden = true;
  secaoTreinamento.hidden = true;
  secaoTI.hidden = true;
  if (secaoHome) secaoHome.hidden = true;
  searchWrap.hidden = true;
  atualizarBanner();
  // Painel direito é redundante na própria aba Agenda → esconde lá (e some os botões de minimizar)
  hubLayout.classList.toggle('na-agenda', !!cat.agenda);
  btnExpandAgenda.hidden = cat.agenda ? true : !hubLayout.classList.contains('agenda-oculta');

  // Dashboard (tela inicial) — resumo real da operação.
  if (cat.home) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    if (secaoHome) secaoHome.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarHome();
    return;
  }

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
    atualizarStatusGoogle(); // pinta o botão "Conectar Google" (Agenda + Drive) em Meu Perfil
    atualizarStatusRoboDrive(); // seção do robô do Drive (só admin + desktop)
    carregarIndicadoresPerfil(); // números reais em "Meus indicadores"
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

  // Aba Recrutamento de corretores (só gestor)
  if (cat.recrutamento) {
    appsGrid.hidden = true;
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    secaoRecrutamento.hidden = false;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';
    carregarRecrutamento();
    return;
  }

  // Aba "Meus Negócios" (Gestão de Locações) — visão NOVA do Broker (broker-app.js).
  // Roda EMBUTIDO na área central do Hub (sanfona na sidebar), sem janela/tela nova:
  // a sidebar do Hub mostra os sub-itens (Dashboard/Pessoas/Imóveis/Negócios/…) e o
  // conteúdo do Broker aparece aqui. As telas antigas (renderCarteira, carregarPainel,
  // renderTela03/04A/04B/05) ficam de fallback caso o módulo do Broker não carregue.
  if (cat.locacoes) {
    estadoVazio.hidden = true;
    secaoDocs.hidden = true;
    appsGrid.hidden = true;
    inputBusca.disabled = true;
    inputBusca.placeholder = '';

    if (window.Broker && typeof window.Broker.mount === 'function') {
      const bk = document.getElementById('bkRoot');
      hubMainHead.hidden = true;                 // o Broker tem título próprio (pageHead)
      hubMain.classList.add('hub-main--broker');  // tira padding/scroll da main
      hubLayout.classList.add('loc-embed');       // esconde o painel direito (agenda) → largura cheia
      if (bk && bk.parentElement !== hubMain) hubMain.appendChild(bk);
      if (bk) bk.hidden = false;
      if (!locBrokerView) locBrokerView = 'dashboard';
      if (!brokerMontado) {
        const nome = (formatarNome(auth.currentUser?.displayName) || auth.currentUser?.email || 'Broker');
        window.Broker.mount({
          role: locPapel(), nome, embedded: true, view: locBrokerView,
          // Navegação que nasce DENTRO do Broker (KPI card, "Voltar aos Negócios"…)
          // sincroniza o destaque da sanfona aqui.
          onNavigate: (v) => {
            locBrokerView = v;
            navCategorias.querySelectorAll('[data-locview]').forEach(x => x.classList.toggle('ativo', x.dataset.locview === v));
          }
        });
        brokerMontado = true;
      } else {
        window.Broker.navigate(locBrokerView);
      }
      return;
    }

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
    if (locRoleAtual !== 'gestor') { locSub = null; renderCentro(); return; }
    appsGrid.hidden = true;
    const sub = LOC_APPS.find(a => a.id === locSub);
    tituloCategoria.innerHTML = `<button class="loc-voltar" id="locVoltar">← Meus Negócios</button> <span>${sub ? sub.titulo : ''}</span>`;
    document.getElementById('locVoltar').addEventListener('click', () => { locSub = null; renderCentro(); });

    if (locSub === 'painel')  { secaoPainel.hidden = false;  carregarPainel(); }
    if (locSub === 'imoveis') { secaoImoveis.hidden = false; cartFiltros = { fin: null, sit: null, corretor: null, busca: '' }; carregarImoveis(); }
    if (locSub === 'negocios') {
      secaoImoveis.hidden = false;
      // Atalho vindo do Dashboard ("Gerenciar" na tabela de atenção): abre o 04B direto.
      if (negAbrirDireto) { const alvo = negAbrirDireto; negAbrirDireto = null; abrirTela04B(alvo); }
      else { negFiltros = { tipo: null, status: null, corretor: null, busca: '' }; carregarNegocios(); }
    }
    if (locSub === 'relatorios') { secaoImoveis.hidden = false; relFiltros = { periodo: '30d', ini: '', fim: '', tipo: null, status: null, corretor: null }; carregarRelatorio(); }
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
    (!ehPwaCelular() || WEB_APPS.has(a.key)) &&
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
// Estrutura: um conteúdo (trocado a cada banner) + setas de navegação persistentes.
bannerEl.classList.add('banner-wrap');
bannerEl.innerHTML =
  '<div class="banner-conteudo"></div>' +
  '<button type="button" class="banner-nav banner-nav--prev" aria-label="Banner anterior">‹</button>' +
  '<button type="button" class="banner-nav banner-nav--next" aria-label="Próximo banner">›</button>';
const bannerConteudo = bannerEl.querySelector('.banner-conteudo');
// Clique no banner de notícia abre a matéria no navegador (ignora as setas)
bannerEl.addEventListener('click', (e) => {
  if (e.target.closest('.banner-nav')) return;
  const b = bannerImagens[bannerIdx];
  if (b && b.tipo === 'noticia' && b.link) abrirNoNavegador(b.link);
});
bannerEl.querySelector('.banner-nav--prev').addEventListener('click', (e) => { e.stopPropagation(); irBanner(-1); });
bannerEl.querySelector('.banner-nav--next').addEventListener('click', (e) => { e.stopPropagation(); irBanner(1); });

let bannerAssinatura = '';   // id:rev dos banners carregados — o timer compara isso via chamada LEVE
function _bannerAss(lista) { return (lista || []).map(b => b.id + ':' + (b.rev || 0)).join('|'); }
async function carregarBanner() {
  try {
    const r = await listarBanners();
    bannerAdmin = (r.data.banners || []).filter(b => b.imagem || b.mediaUrl);
    bannerAssinatura = _bannerAss(r.data.banners);
  } catch (e) {
    console.warn('Banner:', e);
    bannerAdmin = [];
  }
  comporBanners();           // mostra os banners do admin JÁ (não espera a notícia)
  bannerIdx = 0;
  iniciarRotacaoBanner();
  // A notícia vem em segundo plano pra não atrasar a exibição dos banners do admin.
  carregarNoticia().then(() => { comporBanners(); atualizarBanner(); });
  iniciarRefreshNoticia();
}

// Notícia de imóveis (banner automático): busca a lista de manchetes do RSS.
// Falha silenciosa — sem notícia, o carrossel fica só com os banners do admin.
async function carregarNoticia() {
  try {
    const r = await noticiaImoveisDoDia();
    const d = r && r.data;
    noticiaLista = (d && d.ok && Array.isArray(d.itens))
      ? d.itens.filter(n => n && n.titulo && n.link)
      : [];
  } catch (_) { noticiaLista = []; }
  noticiaPtr = 0;
  // O slot da notícia tem os campos preenchidos na hora de renderizar (troca a cada aparição).
  bannerNoticia = noticiaLista.length
    ? { tipo: 'noticia', id: '__noticia', rev: 0, titulo: '', fonte: '', link: '' }
    : null;
}

// Array exibido = banners do admin + a notícia como ÚLTIMO item.
function comporBanners() {
  bannerImagens = bannerNoticia ? bannerAdmin.concat([bannerNoticia]) : bannerAdmin.slice();
}

// Re-busca a lista de manchetes a cada 1h (o feed é cacheado ~1h no servidor),
// sem rebaixar os banners pesados do admin. A troca por aparição é local.
function iniciarRefreshNoticia() {
  clearTimeout(window.__noticiaTimer);
  window.__noticiaTimer = setTimeout(async () => {
    await carregarNoticia();
    comporBanners();
    if (bannerIdx >= bannerImagens.length) bannerIdx = 0;
    // Se a notícia está na tela agora, re-renderiza — senão o slot recriado fica
    // com link vazio e o clique não abriria nada (e mostraria a manchete antiga).
    const atual = bannerImagens[bannerIdx];
    if (atual && atual.tipo === 'noticia') bannerConteudo.innerHTML = renderBannerEl(atual);
    iniciarRefreshNoticia();
  }, 60 * 60 * 1000);
}
// Checagem barata do timer: pede só id+rev ({leve:true}) e só rebaixa o payload
// completo (base64 de até 600KB por banner) quando a assinatura mudou de fato.
async function bannerMudou() {
  try {
    const r = await listarBanners({ leve: true });
    return _bannerAss(r.data.banners) !== bannerAssinatura;
  } catch (_) { return false; }
}

// Tabs que NÃO mostram o banner
const SEM_BANNER = new Set(['agenda', 'marketing', 'documentos', 'fotografia', 'reuniao', 'sala_reuniao', 'ia', 'calculadoras', 'notas', 'locacoes', 'ti']);

function renderBannerEl(banner) {
  if (banner.tipo === 'noticia') {
    // Cada vez que o banner de notícia aparece, mostra a próxima manchete da lista.
    if (noticiaLista.length) {
      const n = noticiaLista[noticiaPtr % noticiaLista.length];
      noticiaPtr++;
      banner.titulo = n.titulo; banner.fonte = n.fonte || ''; banner.link = n.link;
    }
    return `<div class="banner-noticia" role="link" tabindex="0" title="Abrir a notícia no navegador">
      <div class="bn-tag"><span class="bn-dot"></span>Notícia do dia · imóveis</div>
      <div class="bn-titulo">${escapeHtml(banner.titulo || '')}</div>
      <div class="bn-rodape">${banner.fonte ? escapeHtml(banner.fonte) + ' · ' : ''}ler a matéria →</div>
    </div>`;
  }
  if (banner.tipo === 'video') {
    // loop SÓ quando é o único banner; com vários, sem loop pra o evento 'ended' disparar e avançar
    const loop = bannerImagens.length <= 1 ? 'loop' : '';
    return `<video class="banner-video" autoplay ${loop} muted playsinline src="${escapeHtml(banner.mediaUrl || '')}"></video>`;
  }
  const src = banner.mediaUrl || banner.imagem;
  return `<img src="${escapeHtml(src || '')}" class="banner-img" alt="Banner">`;
}

function atualizarBanner() {
  const mostrar = !SEM_BANNER.has(categoriaAtiva) && bannerImagens.length > 0;
  bannerEl.hidden = !mostrar;
  bannerEl.classList.toggle('banner-sem-nav', bannerImagens.length <= 1);
  if (mostrar && !bannerConteudo.childElementCount) {
    bannerConteudo.innerHTML = renderBannerEl(bannerImagens[bannerIdx]);
    agendarProximoBanner(); // DOM já tem o elemento — listener de 'ended' vai funcionar
  }
}

function avancarBanner() {
  if (bannerImagens.length <= 1) return;
  bannerEl.style.opacity = '0';
  setTimeout(() => {
    bannerIdx = (bannerIdx + 1) % bannerImagens.length;
    bannerConteudo.innerHTML = renderBannerEl(bannerImagens[bannerIdx]);
    bannerEl.style.opacity = '1';
    agendarProximoBanner();
  }, 400);
}

// Navegação manual pelas setas (‹ ›): pula/volta um banner e reprograma o giro.
function irBanner(dir) {
  if (bannerImagens.length <= 1) return;
  clearTimeout(window.__bannerTimer);
  bannerEl.style.opacity = '0';
  setTimeout(() => {
    bannerIdx = (bannerIdx + dir + bannerImagens.length) % bannerImagens.length;
    bannerConteudo.innerHTML = renderBannerEl(bannerImagens[bannerIdx]);
    bannerEl.style.opacity = '1';
    agendarProximoBanner();
  }, 200);
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

// Abre uma URL no navegador PADRÃO do sistema (Chrome/Edge), não numa janela do
// Hub. É o caminho de fuga quando a janela nativa do app não está funcionando.
function abrirNoNavegador(url) {
  if (window.hubApi?.abrirNoNavegador) window.hubApi.abrirNoNavegador(url);
  else window.open(url, '_blank', 'noopener');
}

// ─── Aviso de status do app (postado pelo admin) ─────────────────────────
// Existe em vez de alert()/confirm() porque estes não aceitam botão: quando o
// app tem `linkNavegador`, o aviso precisa oferecer "abra pelo navegador
// enquanto isso" (caso do CheckVisto). Resolve `true` = pode abrir no Hub.
function avisoStatusApp(app, status) {
  return new Promise((resolve) => {
    const bloqueia = status === 'Indisponível' || status === 'Em manutenção';
    const icone = status === 'Em manutenção' ? '🔧' : (bloqueia ? '⛔' : '⚠️');
    const texto = bloqueia
      ? `O <strong>${escapeHtml(app.titulo)}</strong> está <strong>${escapeHtml(status.toLowerCase())}</strong> no Hub no momento.`
      : `O <strong>${escapeHtml(app.titulo)}</strong> pode apresentar instabilidade agora.`;

    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-form">
        <h3>${icone} ${escapeHtml(status)}</h3>
        <p class="app-aviso-txt">${texto}</p>
        ${app.linkNavegador ? `
          <div class="app-aviso-alt">
            <p class="app-aviso-alt-txt">Use este link para acessar o app pelo navegador por enquanto:</p>
            <button type="button" class="topbar-btn primario" data-acao="navegador">
              🌐 Abrir no navegador ↗
            </button>
            <p class="muted app-aviso-url">${escapeHtml(app.linkNavegador)}</p>
          </div>` : ''}
        <div class="modal-actions">
          <button type="button" class="topbar-btn" data-acao="fechar">Fechar</button>
          ${bloqueia ? '' : '<button type="button" class="topbar-btn primario" data-acao="abrir">Abrir mesmo assim</button>'}
        </div>
      </div>`;
    document.body.appendChild(dlg);

    const fim = (podeAbrir) => { dlg.close(); dlg.remove(); resolve(podeAbrir); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-acao]');
      if (!b) return;
      if (b.dataset.acao === 'navegador') { abrirNoNavegador(app.linkNavegador); fim(false); return; }
      fim(b.dataset.acao === 'abrir');
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); fim(false); }); // ESC
    dlg.showModal();
  });
}

// prompt() NÃO existe em janela do Electron — ele LANÇA exceção, então usar prompt()
// mata a ação inteira no .exe (funcionava só na web). Este é o substituto: devolve o
// texto digitado, ou null se cancelar — mesmo contrato do prompt(), com <dialog>.
function pedirTextoModal({ titulo, descricao = '', placeholder = '', okLabel = 'Confirmar', multilinha = true }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-conteudo" style="max-width:460px">
        <h3 style="margin:0 0 6px">${escapeHtml(titulo)}</h3>
        ${descricao ? `<p class="muted" style="margin:0 0 12px;font-size:13px">${escapeHtml(descricao)}</p>` : ''}
        ${multilinha
          ? `<textarea id="ptmCampo" rows="3" placeholder="${escapeHtml(placeholder)}" style="width:100%;box-sizing:border-box"></textarea>`
          : `<input id="ptmCampo" type="text" placeholder="${escapeHtml(placeholder)}" style="width:100%;box-sizing:border-box">`}
        <div class="modal-actions" style="margin-top:14px">
          <button type="button" class="topbar-btn" data-acao="cancelar">Cancelar</button>
          <button type="button" class="topbar-btn primario" data-acao="ok">${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const campo = dlg.querySelector('#ptmCampo');
    const fim = (valor) => { dlg.close(); dlg.remove(); resolve(valor); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-acao]');
      if (!b) return;
      fim(b.dataset.acao === 'ok' ? (campo.value || '') : null);
    });
    // ESC fecha o <dialog> nativo sem passar pelos botões — sem isto a Promise
    // nunca resolvia e a ação ficava pendurada pra sempre.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); fim(null); });
    dlg.showModal();
    campo.focus();
  });
}

// Quando a cópia automática falha, mostra o link num campo selecionável pra pessoa
// copiar na mão (o prompt() que fazia esse papel não roda no Electron).
function mostrarLinkModal(link) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-conteudo" style="max-width:520px">
        <h3 style="margin:0 0 6px">Copie o link</h3>
        <p class="muted" style="margin:0 0 12px;font-size:13px">Não foi possível copiar automaticamente. Selecione o link e copie (Ctrl+C).</p>
        <input id="mlmCampo" type="text" readonly value="${escapeHtml(link)}" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px">
        <div class="modal-actions" style="margin-top:14px">
          <button type="button" class="topbar-btn primario" data-acao="fechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const fim = () => { dlg.close(); dlg.remove(); resolve(); };
    dlg.addEventListener('click', (e) => { if (e.target.closest('button[data-acao]')) fim(); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); fim(); });
    dlg.showModal();
    const c = dlg.querySelector('#mlmCampo'); c.focus(); c.select();
  });
}

// ─── Novidades (patch notes) ────────────────────────────────────────────────
// Botão "📣 Novidades" na topbar com bolinha de "não lida". O conteúdo vem do
// backend (listarNovidades). "Visto" fica no localStorage (por aparelho) — basta
// pra saber se tem versão nova que a pessoa ainda não abriu.
let novidadesCache = null;
function _cmpVer(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x - y; }
  return 0;
}
let novidadesErro = false;   // último carregamento falhou? (distingue erro de "vazio")
async function carregarNovidadesBadge() {
  try {
    const r = await listarNovidades({});
    novidadesCache = (r.data && r.data.novidades) || [];
    novidadesErro = false;
    atualizarBadgeNovidades();
  } catch (_) { novidadesErro = true; /* mantém cache anterior; sem bolinha nova */ }
}
function atualizarBadgeNovidades() {
  const badge = document.getElementById('novidadesBadge');
  if (!badge) return;
  if (!novidadesCache || !novidadesCache.length) { badge.hidden = true; return; } // vazio → sem bolinha (fix: bolinha órfã se excluir a última)
  const maisNova = novidadesCache[0].versao; // servidor já ordena desc
  let vista = ''; try { vista = localStorage.getItem('novidades_vista') || ''; } catch (_) {}
  badge.hidden = !(!vista || _cmpVer(maisNova, vista) > 0);
}
function _novItemHTML(v, sel) {
  const ativo = sel && v.versao === sel.versao;
  const data = v.criadoEm ? new Date(v.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
  return `<button class="nov-item" data-nov-ver="${escapeHtml(v.versao)}" style="display:block;width:100%;text-align:left;padding:9px 11px;border:none;border-radius:8px;cursor:pointer;background:${ativo ? 'var(--blue-light)' : 'transparent'};margin-bottom:2px">
    <span style="font-size:13px;font-weight:600;color:${ativo ? '#5b9bf0' : 'var(--text-primary)'}">v${escapeHtml(v.versao)}</span>
    <span style="display:block;font-size:11px;color:var(--text-muted)">${data}</span></button>`;
}
function _novDetalheHTML(n) {
  if (!n) return '';
  const grupo = (t, cor, itens) => (itens && itens.length)
    ? `<div style="font-size:12px;font-weight:700;color:${cor};margin:0 0 6px;text-transform:uppercase;letter-spacing:.03em">${t}</div><ul style="margin:0 0 16px;padding-left:18px;font-size:13px;line-height:1.65;color:var(--text-primary)">${itens.map(i => `<li style="margin-bottom:3px">${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  const data = n.criadoEm ? new Date(n.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const corpo = grupo('Novidades', '#4ade80', n.novo) + grupo('Melhorias', '#5b9bf0', n.melhorias) + grupo('Correções', '#fbbf24', n.correcoes);
  return `<div style="font-size:16px;font-weight:600;margin-bottom:2px">Versão ${escapeHtml(n.versao)}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${data}</div>
    ${corpo || '<p style="font-size:13px;color:var(--text-muted)">Sem detalhes nesta versão.</p>'}`;
}
let novAberto = false;   // guarda de reentrância (evita 2 modais no duplo clique)
async function abrirNovidades() {
  if (novAberto) return;
  novAberto = true;
  if (!novidadesCache) await carregarNovidadesBadge();
  const lista = novidadesCache || [];
  let sel = lista[0] || null;
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.style.width = 'min(660px, 94vw)';   // .modal é 400px por padrão — largo o bastante p/ 2 colunas
  dlg.style.maxWidth = 'none';
  dlg.style.overflow = 'hidden';           // clipa os cantos arredondados
  const fim = () => { novAberto = false; dlg.close(); dlg.remove(); };
  const render = () => {
    const cab = `<div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)">
        <strong style="font-size:15px">Novidades</strong>
        <button type="button" data-acao="fechar" title="Fechar" style="background:none;border:none;color:var(--text-muted);font-size:18px;line-height:1;cursor:pointer;padding:2px 6px">✕</button>
      </div>`;
    const aviso = (t) => `<div style="padding:48px 24px;text-align:center;color:var(--text-muted);font-size:14px">${t}</div>`;
    const miolo = (novidadesErro && !lista.length) ? aviso('Não foi possível carregar as novidades. Tente novamente.')
      : !lista.length ? aviso('Nenhuma novidade publicada ainda.')
      : `<div style="display:grid;grid-template-columns:180px 1fr">
          <div style="border-right:1px solid var(--border);padding:8px;overflow:auto;max-height:60vh">${lista.map(v => _novItemHTML(v, sel)).join('')}</div>
          <div style="padding:18px 20px;overflow:auto;max-height:60vh">${_novDetalheHTML(sel)}</div>
        </div>`;
    dlg.innerHTML = cab + miolo;
    dlg.querySelectorAll('[data-nov-ver]').forEach(b => b.addEventListener('click', () => { sel = lista.find(v => v.versao === b.dataset.novVer); render(); }));
    const bf = dlg.querySelector('[data-acao="fechar"]'); if (bf) bf.addEventListener('click', fim);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fim(); });      // ESC fecha
  document.body.appendChild(dlg);
  render();
  dlg.showModal();
  // marca a mais nova como vista → some a bolinha
  if (lista.length) { try { localStorage.setItem('novidades_vista', lista[0].versao); } catch (_) {} }
  const badge = document.getElementById('novidadesBadge'); if (badge) badge.hidden = true;
}
document.getElementById('btnNovidades')?.addEventListener('click', abrirNovidades);

// ─── Tema claro/escuro (alterna pelo botão do topo, salvo em localStorage) ───
(function(){
  const SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const LUA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';
  const btn = document.getElementById('btnTema');
  // CLARO é o padrão (pedido 2026-08-12); escuro só pra quem escolher no botão —
  // a escolha fica salva NA MÁQUINA (localStorage) e persiste ao reabrir o app.
  const lerTema = () => { try { return localStorage.getItem('hub_tema') === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; } };
  function aplicar(tema){
    document.documentElement.dataset.theme = tema === 'light' ? 'light' : 'dark';
    if (btn){ btn.innerHTML = tema === 'light' ? LUA : SOL; btn.title = tema === 'light' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'; }
  }
  aplicar(lerTema());
  btn?.addEventListener('click', () => {
    const novo = lerTema() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('hub_tema', novo); } catch (_) {}
    aplicar(novo);
  });
})();

// ─── Abrir app (com ou sem autologin) ────────────────────────────────────
// Ponte pro Broker embutido: troca a categoria ativa do Hub (ex.: Agenda).
// Sai do "Meus Negócios" — o renderCentro desmonta o Broker e restaura o layout.
window.hubAbrirCategoria = (id) => {
  const cat = CATEGORIAS.find(c => c.id === id);
  if (!cat) return false;
  categoriaAtiva = id; locSub = null; locSanfonaAberta = false;
  abrirGrupoDe(id);
  renderSidebar(); renderCentro();
  return true;
};

// Ponte pro Broker embutido: gera o contrato de representação (venda) reusando a
// MESMA function do Hub (gerarContratoVenda) e baixa o PDF. Devolve {ok,msg}.
window.hubGerarContratoVenda = async (imovelId) => {
  try {
    const r = await gerarContratoVendaFn({ imovelId });
    const d = r.data || {};
    baixarBase64Pdf(d.pdfBase64, d.filename);
    let msg = 'Contrato gerado — confira e suba no ClickSign.';
    if (d.semFicha) msg = 'Contrato gerado, mas sem ficha de vendedor: os dados dos vendedores saíram em branco.';
    else if (!d.vendedores) msg = 'Contrato gerado, mas nenhum vendedor foi encontrado na ficha.';
    if (d.semCreci) msg += ' (Preencha CRECI/CPF em Meu Perfil.)';
    if (d.drive) msg += ' 📁 Também salvo no seu Google Drive.';
    return { ok: true, msg };
  } catch (e) {
    return { ok: false, msg: 'Erro ao gerar contrato: ' + (e.message || e) };
  }
};

// Ponte pro Broker embutido (Meus Negócios): deixa o Broker abrir um app do Hub
// (ex.: ClickSign) respeitando a permissão por pessoa. Devolve false se não pode.
window.hubAbrirApp = (siteKey) => {
  const app = APPS.find(a => a.key === siteKey);
  if (!app) return false;
  if (app.restrito && !(isAdmin || appsPermitidos.includes(siteKey))) return false;
  abrirApp(siteKey);
  return true;
};

async function abrirApp(siteKey) {
  const app = APPS.find(a => a.key === siteKey);
  if (!app) return;


  // Status postado pelo admin: "Indisponível"/"Em manutenção" bloqueiam a
  // abertura no Hub; "Instável" só avisa. Nos dois casos, se o app tiver
  // linkNavegador, o aviso oferece a alternativa pelo navegador.
  const statusAtual = statusApps[siteKey];
  if (statusAtual && !(await avisoStatusApp(app, statusAtual))) return;
  // O aviso é assíncrono (diferente do confirm() antigo, que congelava tudo):
  // enquanto ele estava aberto, o refresh de 3 min pode ter piorado o status.
  // Re-checa antes de abrir — "Abrir mesmo assim" não vale pra app bloqueado.
  const statusAgora = statusApps[siteKey];
  if (statusAgora === 'Indisponível' || statusAgora === 'Em manutenção') {
    if (statusAgora !== statusAtual) await avisoStatusApp(app, statusAgora);
    return;
  }

  // Registra o acesso (não bloqueia a abertura)
  registrarAcesso({ siteKey, titulo: app.titulo }).catch(() => {});

  // No PWA (celular) o autologin não existe — `hubApi.autologin` é false e o app
  // abre como link normal, sem NUNCA pedir a senha ao getCredentials.
  const autologinDisponivel = app.autologin && window.hubApi.autologin !== false;
  if (!autologinDisponivel) {
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

// Indicadores reais do "Meu Perfil" — puxam os números dos negócios do próprio
// usuário (mesma fonte da visão Meus Negócios). "T. resposta" fica "—" (ainda não
// medimos tempo de resposta). Silencioso em erro: mantém os zeros.
function indParseMoney(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v == null) return 0;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = s.split('.');
    if (parts.length > 1 && parts[parts.length - 1].length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
async function carregarIndicadoresPerfil() {
  const elConv = document.getElementById('cfgIndConv');
  if (!elConv) return;   // tela não montada
  const elTicket = document.getElementById('cfgIndTicket'),
        elAtivos = document.getElementById('cfgIndAtivos'),
        elVendas = document.getElementById('cfgIndVendas'),
        elLoc    = document.getElementById('cfgIndLoc');
  try {
    const [nRes, iRes] = await Promise.all([negocioListarFn({}), locListarImoveis({})]);
    const negocios = (nRes.data?.negocios || []).filter(n => n.corretorUid === currentUid);
    const imById = new Map((iRes.data?.imoveis || []).map(im => [im.id, im]));
    const precoDe = im => indParseMoney(im ? (im.valorAnuncio || im.valorProposta || im.valorFechamento || 0) : 0);
    const total = negocios.length;
    const concluidos = negocios.filter(n => n.status === 'concluido').length;
    const ativos = negocios.filter(n => !['concluido', 'cancelado'].includes(n.status)).length;
    const vendas = negocios.filter(n => n.tipo === 'venda').length;
    const locacoes = negocios.filter(n => n.tipo === 'locacao').length;
    const valores = negocios.map(n => precoDe(imById.get(n.imovelId))).filter(v => v > 0);
    const ticket = valores.length ? Math.round(valores.reduce((s, v) => s + v, 0) / valores.length) : 0;
    elConv.textContent = (total ? Math.round(concluidos / total * 100) : 0) + '%';
    if (elTicket) elTicket.textContent = 'R$ ' + ticket.toLocaleString('pt-BR');
    if (elAtivos) elAtivos.textContent = String(ativos);
    if (elVendas) elVendas.textContent = String(vendas);
    if (elLoc) elLoc.textContent = String(locacoes);
  } catch (_) { /* mantém os zeros — indicadores não são críticos */ }
}

// ─── Dashboard (tela inicial) ────────────────────────────────────────────────
// Dado REAL, role-scoped pelas próprias functions (corretor vê o seu; gestor vê a
// imobiliária). Reusa negocioListar + locListarImoveis (KPIs/comissão/negócios) +
// listarEventos (agenda de hoje) + CARTEIRA_FICHAS (links de ficha).
let _homeRun = 0;   // token de corrida: só a execução mais recente pode escrever na tela
async function carregarHome() {
  if (!secaoHome) return;
  if (!currentUid) return;   // boot pré-login: sem token as functions só rejeitam (a rodada pós-login preenche)
  const _run = ++_homeRun;
  const esc = escapeHtml;
  const brl = v => 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');
  const hh = new Date().getHours();
  const saud = hh < 12 ? 'Bom dia' : hh < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (document.getElementById('usuarioInfo')?.textContent?.trim() || '').split(' ')[0] || '';
  const dataExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  secaoHome.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:48px 0;font-size:13px">Carregando…</p>';

  const de = new Date(); de.setHours(0, 0, 0, 0);
  const ate = new Date(); ate.setHours(23, 59, 59, 999);
  let negocios = [], imoveis = [], eventosHoje = [];
  try {
    const [nR, iR, eR] = await Promise.all([
      negocioListarFn({}).catch(() => ({ data: { negocios: [] } })),
      locListarImoveis({}).catch(() => ({ data: { imoveis: [] } })),
      listarEventos({ de: de.toISOString(), ate: ate.toISOString() }).catch(() => ({ data: { eventos: [] } })),
    ]);
    negocios = nR.data?.negocios || [];
    imoveis = iR.data?.imoveis || [];
    eventosHoje = eR.data?.eventos || [];
  } catch (_) { /* segue com o que tiver */ }
  if (categoriaAtiva !== 'home') return;   // usuário já saiu da tela enquanto carregava
  if (_run !== _homeRun) return;           // execução velha terminando por último não sobrescreve a nova

  const imById = new Map(imoveis.map(im => [im.id, im]));
  const precoDe = im => indParseMoney(im ? (im.valorAnuncio || im.valorProposta || im.valorFechamento || 0) : 0);
  const ruaDe = im => { if (!im) return 'Imóvel'; const e = im.endereco || {}; return [e.logradouro, e.numero].filter(Boolean).join(', ') || im.referencia || im.proprietarioNome || 'Imóvel'; };
  const chkPct = cl => (cl && cl.length) ? Math.round(cl.filter(x => x.feito).length / cl.length * 100) : 0;
  const diasDe = iso => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0;

  const ativos = negocios.filter(n => !['concluido', 'cancelado'].includes(n.status));
  const comissao = ativos.reduce((s, n) => { const p = precoDe(imById.get(n.imovelId)); return s + (n.tipo === 'venda' ? p * 0.06 : p); }, 0);
  const pendencias = imoveis.filter(im => (im.pendentes || []).length > 0 && !im.arquivado).length;
  const ativosOrd = ativos.map(n => ({
    rua: ruaDe(imById.get(n.imovelId)), prog: chkPct(n.checklist),
    prox: n.proximaAcao || 'Sem próxima ação definida', dias: diasDe(n.atualizadoEm || n.criadoEm),
  })).sort((a, b) => b.dias - a.dias);

  // Estilos base (tema claro do Hub)
  const cardSt = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card)';
  const kpi = (ico, num, label, cor) => `<div class="lc-q" style="${cardSt};padding:14px 16px;flex:1;min-width:140px">
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:6px">${ico} ${esc(label)}</div>
    <div style="font-size:26px;font-weight:700;margin-top:6px;color:${cor || 'var(--text-primary)'}">${num}</div></div>`;
  const secTit = (t, extra) => `<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 10px"><span style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${t}</span>${extra || ''}</div>`;

  // KPIs
  const kpis = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">
    ${kpi('📁', ativos.length, 'Negócios em andamento')}
    ${kpi('📅', eventosHoje.length, 'Compromissos hoje')}
    ${kpi('🔴', pendencias, 'Pendências', pendencias ? '#DC1C2E' : undefined)}
    ${kpi('💰', brl(comissao), 'Comissão prevista', '#16a34a')}
  </div>`;

  // Próximas ações (dos negócios ativos mais parados)
  const proxItems = ativosOrd.slice(0, 6).map(a => `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:var(--blue)">○</span><span style="flex:1;min-width:0">${esc(a.prox)}</span>
    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${esc(a.rua)}</span></div>`).join('') ||
    '<p style="font-size:13px;color:var(--text-muted);padding:12px 0">Nenhuma ação pendente. 🎉</p>';
  const colProx = `<div class="lc-q" style="${cardSt};padding:16px;flex:1;min-width:280px">${secTit('📋 Próximas ações')}${proxItems}</div>`;

  // Agenda de hoje
  const evOrd = eventosHoje.slice().sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const evItems = evOrd.slice(0, 6).map(ev => {
    const t = new Date(ev.inicio); const hhmm = isNaN(t) ? '' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span style="font-weight:700;color:var(--blue);white-space:nowrap">${hhmm}</span><span style="flex:1;min-width:0">${esc(ev.titulo || 'Compromisso')}</span></div>`;
  }).join('') || '<p style="font-size:13px;color:var(--text-muted);padding:12px 0">Nada agendado para hoje.</p>';
  const colAgenda = `<div class="lc-q" style="${cardSt};padding:16px;flex:1;min-width:280px">${secTit('📅 Agenda de hoje', '<button class="topbar-btn" data-home="agenda" style="font-size:11px;padding:3px 10px">Abrir Agenda</button>')}${evItems}</div>`;

  // Negócios em andamento (com barra de progresso)
  const negItems = ativosOrd.slice(0, 6).map(a => `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)">
    <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.rua)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(a.prox)}</div></div>
    <div style="width:120px;height:7px;background:var(--border);border-radius:99px;overflow:hidden;flex-shrink:0"><div style="width:${a.prog}%;height:100%;background:var(--blue)"></div></div>
    <span style="font-size:12px;font-weight:700;color:var(--text-primary);width:38px;text-align:right;flex-shrink:0">${a.prog}%</span></div>`).join('') ||
    '<p style="font-size:13px;color:var(--text-muted);padding:12px 0">Nenhum negócio em andamento.</p>';
  const blocoNeg = `<div class="lc-q" style="${cardSt};padding:16px;margin-bottom:18px">${secTit('📁 Negócios em andamento', '<button class="topbar-btn" data-home="negocios" style="font-size:11px;padding:3px 10px">Ver todos</button>')}${negItems}</div>`;

  // Fichas digitais (links reais do corretor)
  const fichaRows = CARTEIRA_FICHAS.map(f => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="flex:1;min-width:0;font-weight:600;color:var(--text-primary)">${esc(f.label)}</span>
    <button class="topbar-btn" data-home="ficha-copiar" data-arq="${esc(f.arquivo)}" style="font-size:11px;padding:3px 9px">📋 Copiar</button>
    <button class="topbar-btn" data-home="ficha-wpp" data-arq="${esc(f.arquivo)}" style="font-size:11px;padding:3px 9px">💬 WhatsApp</button>
    <button class="topbar-btn" data-home="ficha-abrir" data-arq="${esc(f.arquivo)}" style="font-size:11px;padding:3px 9px">👁 Abrir</button></div>`).join('');
  const blocoFichas = `<div class="lc-q" style="${cardSt};padding:16px">${secTit('🗂️ Fichas digitais', '<button class="topbar-btn" data-home="fichas" style="font-size:11px;padding:3px 10px">Ver todas</button>')}${fichaRows}</div>`;

  const header = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px">
    <div><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${saud}${nome ? ', ' + esc(nome) : ''} 👋</div></div>
    <div style="text-align:right"><div style="font-size:13px;color:var(--text-muted);text-transform:capitalize">${esc(dataExtenso)}</div>
    ${pendencias ? `<button class="topbar-btn" data-home="negocios" style="font-size:12px;padding:3px 10px;margin-top:6px">🔔 ${pendencias} pendência${pendencias > 1 ? 's' : ''}</button>` : ''}</div>
  </div>`;

  secaoHome.innerHTML = header + kpis
    + `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:18px">${colProx}${colAgenda}</div>`
    + blocoNeg + blocoFichas;

  // Wiring (delegação num container recém-criado)
  secaoHome.querySelectorAll('[data-home]').forEach(b => {
    b.addEventListener('click', () => {
      const act = b.dataset.home, arq = b.dataset.arq;
      if (act === 'agenda') return ativarCategoria('agenda');
      if (act === 'negocios') return ativarCategoria('locacoes');
      if (act === 'fichas') return ativarCategoria('documentos');
      if (act === 'ficha-copiar') return cartCopiarLink(arq);
      const nomeC = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
      const link = `${BASE_HOSTING}/${arq}?corretor=${currentUid}&nome=${encodeURIComponent(nomeC)}`;
      if (act === 'ficha-wpp') return window.open('https://wa.me/?text=' + encodeURIComponent('Olá! Preencha sua ficha cadastral: ' + link), '_blank');
      if (act === 'ficha-abrir') { if (window.hubApi && window.hubApi.abrirFicha) window.hubApi.abrirFicha(link, 'Ficha'); else window.open(link, '_blank'); }
    });
  });
}
let perfilOk = false;   // getMeuPerfil carregou? Bloqueia salvar por cima de campos vazios se falhou.
async function carregarPerfil() {
  perfilOk = false;
  fotoPendente = null;
  cfgNome.value = '';
  cfgEmail.value = '';
  cfgWhatsapp.value = '';
  if (cfgCreci) cfgCreci.value = '';
  if (cfgCpf) cfgCpf.value = '';
  setFoto('');
  carregarIniciarWindows();
  carregarEspecialidades();
  try {
    const r = await getMeuPerfil();
    cfgEmail.value = r.data.email || '';
    cfgNome.value = r.data.displayName || '';
    cfgWhatsapp.value = r.data.telefone || '';
    if (cfgCreci) cfgCreci.value = r.data.creci || '';
    if (cfgCpf) cfgCpf.value = r.data.cpf || '';
    setFoto(r.data.photo || '');
    perfilOk = true;
  } catch (e) {
    console.warn('Perfil:', e);
    mostrarMsgCfg('Não foi possível carregar seu perfil agora. Recarregue antes de salvar.', false);
  }
}

function mostrarMsgCfg(texto, ok) {
  cfgMsg.textContent = texto;
  cfgMsg.style.color = ok ? 'var(--success)' : 'var(--danger)'; // tema claro/escuro
  cfgMsg.hidden = false;
  setTimeout(() => { cfgMsg.hidden = true; }, 3000);
}

cfgTrocarFoto.addEventListener('click', () => cfgFileInput.click());
cfgRemoverFoto.addEventListener('click', () => { fotoPendente = ''; setFoto(''); });

/* ── Especialidades & atuação (Meu Perfil) ─────────────────────────────────
   Chips com botão + pra adicionar e × pra remover. Salvo no dispositivo
   (localStorage por uid) por enquanto — quando houver campo no backend,
   trocar por salvarMeuPerfil({ especialidades }). */
let cfgEspLista = [];
const cfgEspAdd       = document.getElementById('cfgEspAdd');
const cfgEspInputWrap = document.getElementById('cfgEspInputWrap');
const cfgEspInput     = document.getElementById('cfgEspInput');
const cfgEspConfirm   = document.getElementById('cfgEspConfirm');
const cfgEspBox       = document.getElementById('cfgEspecialidades');

function espChave() { return 'cfgEsp_' + (currentUid || 'anon'); }
function carregarEspecialidades() {
  try { cfgEspLista = JSON.parse(localStorage.getItem(espChave()) || '[]'); } catch (_) { cfgEspLista = []; }
  if (!Array.isArray(cfgEspLista)) cfgEspLista = [];
  renderEspecialidades();
}
function salvarEspecialidades() { try { localStorage.setItem(espChave(), JSON.stringify(cfgEspLista)); } catch (_) {} }
function renderEspecialidades() {
  if (!cfgEspBox) return;
  cfgEspBox.innerHTML = cfgEspLista.length
    ? cfgEspLista.map((e, i) => `<span class="cfg-chip">${escapeHtml(e)}<button type="button" class="cfg-chip-x" data-esp="${i}" title="Remover" aria-label="Remover">×</button></span>`).join('')
    : '<span class="muted config-dica">Nenhuma especialidade cadastrada ainda.</span>';
}
function addEspecialidade() {
  const v = (cfgEspInput.value || '').trim();
  if (!v) { cfgEspInput.focus(); return; }
  if (!cfgEspLista.some(x => x.toLowerCase() === v.toLowerCase())) { cfgEspLista.push(v); salvarEspecialidades(); renderEspecialidades(); }
  cfgEspInput.value = ''; cfgEspInput.focus();
}
if (cfgEspAdd) cfgEspAdd.addEventListener('click', () => {
  cfgEspInputWrap.hidden = !cfgEspInputWrap.hidden;
  if (!cfgEspInputWrap.hidden) cfgEspInput.focus();
});
if (cfgEspConfirm) cfgEspConfirm.addEventListener('click', addEspecialidade);
if (cfgEspInput) cfgEspInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addEspecialidade(); } });
if (cfgEspBox) cfgEspBox.addEventListener('click', e => {
  const x = e.target.closest('.cfg-chip-x'); if (!x) return;
  cfgEspLista.splice(+x.dataset.esp, 1); salvarEspecialidades(); renderEspecialidades();
});

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
  // Se o perfil não carregou (cold start/rede), NÃO salvar — senão gravaria nome/telefone/
  // CRECI/CPF vazios por cima dos dados reais.
  if (!perfilOk) { mostrarMsgCfg('Seu perfil não carregou — recarregue a página antes de salvar.', false); cfgSalvar.disabled = false; return; }
  const payload = { displayName: cfgNome.value, telefone: cfgWhatsapp.value };
  if (cfgCreci) payload.creci = cfgCreci.value;
  if (cfgCpf) payload.cpf = cfgCpf.value;
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
    let resolvido = false;
    const encerrar = (senha) => {
      if (resolvido) return;
      resolvido = true;
      form.onsubmit = null;
      btnCancelar.onclick = null;
      btnFechar.onclick = null;
      modal.removeEventListener('close', onClose);
      if (modal.open) modal.close();
      resolve(senha);
    };
    // ESC fecha o <dialog> nativo sem passar pelos botões — sem isso a Promise nunca resolvia.
    const onClose = () => encerrar(null);
    form.onsubmit = (e) => { e.preventDefault(); encerrar(inp.value || null); };
    btnCancelar.onclick = () => encerrar(null);
    btnFechar.onclick = () => encerrar(null);
    modal.addEventListener('close', onClose);
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
  // Fire-and-forget: offline o setDoc fica pendente pra sempre (não rejeita) e travava
  // o botão Sair. O logout não pode depender de conseguir gravar a presença.
  if (currentUid) setDoc(doc(db, 'user_presence', currentUid), { online: false, updatedAt: fsTs() }, { merge: true }).catch(() => {});
  // Encerra os listeners de tempo real antes do logout (senão disparam permission-denied sem auth).
  if (window.__feedUnsub) { try { window.__feedUnsub(); } catch (_) {} window.__feedUnsub = null; }
  if (window.__broadcastUnsub) { try { window.__broadcastUnsub(); } catch (_) {} window.__broadcastUnsub = null; }
  // Idem pros listeners do Broker embutido (imoveis/negocios/negócio aberto): o unmount
  // chama o teardownRealtime dele.
  if (brokerMontado && window.Broker) { try { window.Broker.unmount(); } catch (_) {} brokerMontado = false; }
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

  // Marca presença online + heartbeat a cada 2 min.
  // (Todos os timers de rede abaixo pausam com a janela minimizada/oculta —
  // `document.hidden` — pra não gastar invocação/leitura com ninguém olhando.
  // O handler de foco no fim deste bloco já atualiza tudo quando a pessoa volta.)
  const marcarOnline = () => setDoc(doc(db, 'user_presence', user.uid), { online: true, updatedAt: fsTs() }, { merge: true }).catch(() => {});
  marcarOnline();
  clearInterval(window.__presenceTimer);
  window.__presenceTimer = setInterval(() => { if (!document.hidden) marcarOnline(); }, 120000);

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

  // Busca os apps restritos liberados pra este usuário e re-renderiza.
  // Tudo dispara em PARALELO: eram 4 esperas em sequência (2 delas Cloud
  // Functions, que com cold start levam segundos cada) e as abas por
  // permissão (Locação/ClickSign/Suporte) demoravam a aparecer na sidebar.
  const _extrasP = Promise.all([carregarStatusApps(), carregarBanner()]).catch(() => {});
  try {
    const perm = await getMinhasPermissoes();
    appsPermitidos = perm.data.apps || [];
    temDrivesFotografia = !!perm.data.drives_fotografia;
    temPermTI = !!perm.data.ti;
    temPermMarketing = !!perm.data.marketing_gerenciar;
    betaLocacoes = !!perm.data.loc_beta;
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
  // Papel na Gestão de Locações: vem SÓ da claim `locRole` (mesma lógica do servidor
  // em ehGestorAuth/locMeuPerfil — bootstrap admin conta como gestor). Lê direto do
  // token (já buscado com getIdTokenResult acima), sem depender de uma Cloud Function:
  // um cold start / blip na locMeuPerfil rebaixava gestor/administrativo pra visão de
  // corretor (só dados próprios) até relogar. A claim já está no token, não falha.
  locRoleAtual = (tokenResult.claims.locRole === 'gestor' || BOOTSTRAP_ADMIN_UIDS.includes(user.uid)) ? 'gestor'
               : (tokenResult.claims.locRole === 'administrativo' ? 'administrativo' : 'corretor');
  renderSidebar(); // re-render JÁ: com isAdmin/permissões, itens restritos (Locação/ClickSign) aparecem
  await _extrasP; // status dos apps + banner (afetam só o centro, não a sidebar)
  renderCentro();
  carregarPerfil(); // popula o avatar no topo

  // Atualiza os avisos de instabilidade a cada 3 min (sem precisar relogar)
  clearInterval(window.__statusTimer);
  window.__statusTimer = setInterval(async () => {
    if (document.hidden) return;
    const antes = JSON.stringify(statusApps);
    await carregarStatusApps();
    // Não re-renderiza o centro enquanto o Broker embutido está aberto: o aviso de
    // status vive no grid de apps (invisível dentro do Broker), e um renderCentro aqui
    // re-navegaria o Broker (window.Broker.navigate), descartando estado transitório —
    // ex.: um comentário sendo digitado. Ao sair da aba, renderCentro pega o status novo.
    // Guarda por categoria (não só brokerMontado): no fallback sem Broker as telas
    // antigas da Locação também têm filtros/busca que um renderCentro descartaria —
    // e o aviso de status é invisível dentro da aba de qualquer jeito.
    if (JSON.stringify(statusApps) !== antes && categoriaAtiva !== 'locacoes') renderCentro();
  }, 180000);

  // Atualiza banners a cada 3 min (para pegar banners novos sem relogar).
  // Checagem LEVE (id+rev) primeiro — o base64 completo só desce se algo mudou.
  clearInterval(window.__bannerTimer2);
  window.__bannerTimer2 = setInterval(async () => {
    if (document.hidden) return;
    if (await bannerMudou()) { await carregarBanner(); atualizarBanner(); }
  }, 180000);

  // fix 2: busca status Google antes de carregar eventos para incluir eventos do Google no mini calendário desde o início
  await atualizarStatusGoogle();
  // Avisa o resultado da conexão Google feita pelo fluxo web (o status já foi repintado acima).
  try {
    const gr = sessionStorage.getItem('__googleRetorno');
    if (gr) {
      sessionStorage.removeItem('__googleRetorno');
      const st = gr.slice(0, gr.indexOf('|') < 0 ? gr.length : gr.indexOf('|'));
      const msg = gr.indexOf('|') < 0 ? '' : gr.slice(gr.indexOf('|') + 1);   // não split('|'): msg pode conter '|'
      if (st === 'ok') alert('Conta Google conectada! ✅ A agenda sincroniza e os documentos das fichas vão pro seu Google Drive.');
      else alert('Não deu pra conectar o Google' + (msg ? ': ' + msg : '.'));   // msg já vem decodificada do URLSearchParams
    }
  } catch (_) { /* ignora */ }
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
  window.__notifTimer = setInterval(() => { if (!document.hidden) verificarNotificacoes(); }, 180000);

  // Sininho de fichas: carrega ao entrar e atualiza a cada 5 min (era 60s — a
  // maior fonte de leituras do Firestore; o handler de foco cobre o "cheguei agora").
  atualizarNotifFichas();
  clearInterval(window.__notifFichasTimer);
  window.__notifFichasTimer = setInterval(() => { if (!document.hidden) atualizarNotifFichas(); }, 300000);

  // Badge de chamados abertos (TI / admin)
  atualizarBadgeChamados();
  clearInterval(window.__chamadosTimer);
  window.__chamadosTimer = setInterval(() => { if (!document.hidden) atualizarBadgeChamados(); }, 120000);

  // Novidades (patch notes): carrega a lista e acende a bolinha se tem versão nova não lida.
  carregarNovidadesBadge();

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
      carregarNovidadesBadge();   // fallback: bolinha atualiza no foco mesmo com REALTIME=false
    };
    window.addEventListener('focus', attAoVoltar);
    document.addEventListener('visibilitychange', attAoVoltar);
  }

  // Tempo real: escuta o sinal user_feed/{uid} (SEM PII — só contador/timestamp). Quando
  // muda (chegou/reenviou ficha), atualiza o badge e o Cadastro na HORA, sem esperar o
  // timer acima (que fica de fallback). REALTIME=false → só o timing. Padrão campainha:
  // o sinal é público-pro-dono; a ficha (com CPF) continua vindo pela função segura.
  if (REALTIME && currentUid) {
    if (window.__feedUnsub) { try { window.__feedUnsub(); } catch (_) {} }
    let feedPrimeiro = true;
    window.__feedUnsub = onSnapshot(doc(db, 'user_feed', currentUid), (snap) => {
      if (feedPrimeiro) { feedPrimeiro = false; return; } // ignora o estado inicial (não é "novo")
      atualizarNotifFichas();
      verificarNotificacoes();   // resposta do TI chega pela campainha → notificação na hora
      // cadCarregarFichas (não carregarDocumentos): só re-busca e re-renderiza a TABELA,
      // preservando cadFiltro/cadVisao e o texto da busca — o carregarDocumentos refazia
      // a tela inteira e resetava tudo no meio do uso (empurrado por terceiros).
      if (categoriaAtiva === 'documentos') cadCarregarFichas();
    }, (e) => console.warn('feed onSnapshot:', e && e.message));
  }

  // Tempo real p/ TODOS: escuta o doc de broadcast (SEM PII — só contadores). Quando o admin
  // muda status de app, banner ou envia aviso, o contador correspondente sobe e recarregamos
  // SÓ a peça que mudou, na HORA. Os timers de 3 min continuam de fallback (REALTIME=false → só eles).
  if (REALTIME) {
    if (window.__broadcastUnsub) { try { window.__broadcastUnsub(); } catch (_) {} }
    let bcPrimeiro = true, bcStatus = 0, bcBanner = 0, bcAviso = 0, bcNov = 0, bcChamado = 0, bcRec = 0;
    window.__broadcastUnsub = onSnapshot(doc(db, 'config', 'broadcast'), async (snap) => {
      const d = snap.exists() ? (snap.data() || {}) : {};
      const s = d.statusSeq || 0, b = d.bannerSeq || 0, a = d.avisoSeq || 0, nv = d.novidadeSeq || 0, ch = d.chamadoSeq || 0, rc = d.recrutamentoSeq || 0;
      if (bcPrimeiro) { bcPrimeiro = false; bcStatus = s; bcBanner = b; bcAviso = a; bcNov = nv; bcChamado = ch; bcRec = rc; return; }
      if (nv !== bcNov) { bcNov = nv; carregarNovidadesBadge(); }   // admin publicou nota → bolinha na hora
      if (s !== bcStatus) {
        bcStatus = s;
        await carregarStatusApps();
        // mesmo cuidado do timer: nada de renderCentro dentro da aba Locação (Broker OU fallback)
        if (categoriaAtiva !== 'locacoes') renderCentro();
      }
      if (b !== bcBanner) {
        bcBanner = b;
        await carregarBanner(); atualizarBanner();
      }
      if (a !== bcAviso) {
        bcAviso = a;
        verificarNotificacoes();
      }
      if (ch !== bcChamado) {
        bcChamado = ch;
        atualizarBadgeChamados();                                   // badge do TI sobe na hora (pra quem é TI)
        if (categoriaAtiva === 'ti') carregarChamadosHub();         // e a lista recarrega se ele estiver na aba
      }
      if (rc !== bcRec) {
        bcRec = rc;
        // Recrutamento em tempo real: candidato caiu/mudou → a LISTA recarrega sozinha
        // (não recarrega se o gestor está editando um candidato, pra não perder o que digitou).
        if (categoriaAtiva === 'recrutamento' && recView === 'lista') carregarRecrutamento();
      }
    }, (e) => console.warn('broadcast onSnapshot:', e && e.message));
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

// Data do dia selecionado (a partir da chave YYYY-MM-DD); cai pro hoje se vazia.
// A visão Semana ancora nela — antes usava o DIA de hoje sempre, então a semana
// mostrada não acompanhava a navegação.
function dataSelecionada(){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(diaSelecionado || '');
  return m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date();
}

function atualizarRelogio(){
  const agora = new Date();
  relogioHora.textContent = agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  relogioData.textContent = agora.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' });
}

function chaveEvento(e){ return e.origem === 'google' ? ('g:' + e.googleId) : e.id; }
function eventoPelaChave(chave){ return eventos.find(x => chaveEvento(x) === chave); }
// Clique num evento (pílula/lista/semana): só abre "Editar" pra quem realmente pode
// editar (dono ou admin, e nunca evento do Google). Pra convite de outra pessoa,
// abre o detalhe do dia — é lá que fica o Aceitar/Recusar. Antes abria "Editar" pra
// qualquer um e o Salvar sempre falhava no servidor (trabalho perdido).
function abrirEventoDoClique(dia, ev) {
  if (dia) diaSelecionado = dia;
  if (ev && (ev.souDono || isAdmin) && ev.origem !== 'google') {
    abrirModalEvento(diaSelecionado, ev);
  } else {
    renderCalendarioCompleto(); // mostra o detalhe do dia com o RSVP
  }
}

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
      return `<span class="cal-ev-pill ${cls}" data-ev-id="${chaveEvento(e)}" title="${escapeHtml(hora + ' ' + e.titulo)}">
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
      ${lista.map(e => `<div class="cal-lista-ev" data-ev-id="${chaveEvento(e)}" data-dia="${chave}">
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
        return `<span class="cal-semana-ev" data-ev-id="${chaveEvento(e)}" style="background:${cor}" title="${escapeHtml(e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + ' ' + e.titulo)}">${e.inicio.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} ${escapeHtml(e.titulo)}</span>`;
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
      categoriaAtiva = 'agenda'; abrirGrupoDe('agenda'); locSub = null; locSanfonaAberta = false; renderSidebar(); renderCentro();
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
        abrirEventoDoClique(el.dataset.dia, eventoPelaChave(el.dataset.evId));
      });
    });
  } else if (calVisao === 'semana') {
    calGrade.innerHTML = montarSemana(dataSelecionada());
    calGrade.querySelectorAll('.cal-semana-ev').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = eventoPelaChave(el.dataset.evId);
        if (ev) abrirEventoDoClique(chaveDia(ev.inicio), ev);
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
          const ev = eventoPelaChave(pill.dataset.evId);
          if (ev) { abrirEventoDoClique(b.dataset.dia, ev); return; }
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
// Na visão Semana anda 7 dias; nas outras (Mês/Lista) anda 1 mês.
function navegarCalendario(passo){
  if (calVisao === 'semana') {
    const d = dataSelecionada(); d.setDate(d.getDate() + passo * 7);
    diaSelecionado = chaveDia(d); calAno = d.getFullYear(); calMes = d.getMonth();
  } else {
    calMes += passo;
    if (calMes < 0) { calMes = 11; calAno--; }
    else if (calMes > 11) { calMes = 0; calAno++; }
  }
}

document.getElementById('calPrev').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true; // Trava o botão
  navegarCalendario(-1);
  try {
    await renderCalendarioCompleto();
  } finally {
    b.disabled = false; // Destrava quando o Firebase responder
  }
});

document.getElementById('calProx').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true; // Trava o botão
  navegarCalendario(1);
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
    if(!confirm('Desconectar sua conta Google (Agenda + Drive)? Os compromissos e documentos já enviados continuam lá.')) return;
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
    // Web: o platform-web redireciona o navegador pro Google; quem finaliza é a
    // página google-callback.html. Aqui não há code pra trocar — só sai.
    if(r && r.redirecting) return;
    if(!r || !r.ok){ alert('Conexão cancelada' + (r && r.erro ? ': '+r.erro : '.')); return; }
    btnGoogleAgenda.textContent = 'Finalizando...';
    const res = await conectarGoogleAgenda({ code: r.code, codeVerifier: r.codeVerifier, redirectUri: r.redirectUri });
    pintarBotaoGoogle(true, (res.data && res.data.email) || '');
    alert('Conta Google conectada! ✅ A agenda sincroniza e os documentos das fichas vão pro seu Google Drive automaticamente.');
  } catch(e){
    alert('Erro ao conectar: '+e.message);
  } finally {
    btnGoogleAgenda.disabled = false;
    if(!googleConectado) pintarBotaoGoogle(false, ''); // fix 1: restaura HTML completo (com SVG), não só texto
  }
});

// ── Robô do Drive (setup de bastidor — admin, só .exe) ───────────────────────
// Conecta a conta dedicada (remaxsmarthub@gmail.com) com escopo Drive COMPLETO.
// Reusa o mesmo fluxo OAuth do desktop, passando um escopo diferente. Só aparece
// pra admin no app de computador (o Picker/loopback não existe no PWA).
const cfgRoboDrive = document.getElementById('cfgRoboDrive');
const cfgRoboDriveStatus = document.getElementById('cfgRoboDriveStatus');
const btnRoboConectar = document.getElementById('btnRoboConectar');
const btnRoboTeste = document.getElementById('btnRoboTeste');
async function atualizarStatusRoboDrive(){
  if(!cfgRoboDrive) return;
  // Só admin + desktop (no web não há loopback pra escopo amplo).
  if(!isAdmin || ehWeb()){ cfgRoboDrive.hidden = true; return; }
  cfgRoboDrive.hidden = false;
  try {
    const r = await driveRoboStatus();
    const d = r.data || {};
    if(d.conectado){
      cfgRoboDriveStatus.innerHTML = 'Conectado como <code>'+escapeHtml(d.email||'?')+'</code>. As pastas dos negócios são organizadas na pasta da imobiliária.';
      if(btnRoboConectar) btnRoboConectar.textContent = 'Reconectar robô';
    } else {
      cfgRoboDriveStatus.innerHTML = 'Conecte a conta-robô (<code>remaxsmarthub@gmail.com</code>) que organiza os documentos dos negócios. Entre com a conta do robô ao autorizar.';
      if(btnRoboConectar) btnRoboConectar.textContent = 'Conectar robô';
    }
  } catch(e){ /* silencioso: se não for admin, a function nega */ }
}
if(btnRoboConectar) btnRoboConectar.addEventListener('click', async ()=>{
  btnRoboConectar.disabled = true;
  const txt = btnRoboConectar.textContent;
  btnRoboConectar.textContent = 'Abrindo navegador...';
  try {
    const r = await window.hubApi.conectarGoogle(DRIVE_ROBO_SCOPE);
    if(r && r.redirecting) return; // web não usa este fluxo, mas por segurança
    if(!r || !r.ok){ alert('Conexão cancelada' + (r && r.erro ? ': '+r.erro : '.')); return; }
    btnRoboConectar.textContent = 'Finalizando...';
    const res = await conectarDriveRobo({ code: r.code, codeVerifier: r.codeVerifier, redirectUri: r.redirectUri });
    alert('Robô conectado! ✅ Conta: ' + ((res.data && res.data.email) || '?') + '\n\nAgora clique em "Testar gravação" pra confirmar o acesso à pasta.');
    atualizarStatusRoboDrive();
  } catch(e){ alert('Erro ao conectar o robô: ' + e.message); }
  finally { btnRoboConectar.disabled = false; btnRoboConectar.textContent = txt; }
});
if(btnRoboTeste) btnRoboTeste.addEventListener('click', async ()=>{
  btnRoboTeste.disabled = true;
  const txt = btnRoboTeste.textContent;
  btnRoboTeste.textContent = 'Testando...';
  try {
    const r = await driveRoboTeste();
    const d = r.data || {};
    alert('✅ Gravação OK!\n\nPasta raiz: ' + (d.raiz||'?') + '\nArquivo criado: ' + (d.arquivo||'?') + '\n\nAbra a pasta "___teste-hub" no Drive pra confirmar (pode apagar depois).');
  } catch(e){ alert('❌ Falhou: ' + e.message); }
  finally { btnRoboTeste.disabled = false; btnRoboTeste.textContent = txt; }
});

// ── Mapa corretor → pasta do Drive (robô) ────────────────────────────────────
const modalRoboMapa = document.getElementById('modalRoboMapa');
const roboMapaCorpo = document.getElementById('roboMapaCorpo');
const roboMapaMsg = document.getElementById('roboMapaMsg');
function _normNome(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
// Casa o nome do corretor com uma pasta: 1) igual; 2) pasta é prefixo por tokens
// do nome (NATHAN ⊂ "Nathan Gabriel"); 3) mesmo primeiro nome. Devolve o id ou ''.
function _autoMatchPasta(nomeCorretor, pastas){
  const n = _normNome(nomeCorretor); if(!n) return '';
  const primeiro = n.split(' ')[0];
  let hit = pastas.find(p => _normNome(p.name) === n); if(hit) return hit.id;
  hit = pastas.find(p => { const pn=_normNome(p.name); return pn && (n === pn || n.startsWith(pn + ' ')); }); if(hit) return hit.id;
  hit = pastas.find(p => _normNome(p.name).split(' ')[0] === primeiro); if(hit) return hit.id;
  return '';
}
async function abrirRoboMapa(){
  if(!modalRoboMapa) return;
  roboMapaCorpo.innerHTML = 'Carregando…'; roboMapaMsg.hidden = true;
  modalRoboMapa.showModal();
  try {
    const [pRes, fRes, mRes] = await Promise.all([listarPessoas(), driveListarSubpastas(), driveMapaGet()]);
    const pessoas = (pRes.data||[]).slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||'','pt'));
    const pastas = (fRes.data && fRes.data.pastas) || [];
    const mapa = (mRes.data && mRes.data.mapa) || {};
    if(!pastas.length){ roboMapaCorpo.innerHTML = '<p class="muted" style="font-size:13px">O robô não encontrou subpastas na "02 - Corretores". Confirme que ele está conectado e a pasta compartilhada.</p>'; return; }
    const opts = (sel) => '<option value="">— não mapear —</option>' + pastas.map(p=>`<option value="${escapeHtml(p.id)}"${p.id===sel?' selected':''}>${escapeHtml(p.name)}</option>`).join('');
    roboMapaCorpo.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr><th style="text-align:left;padding:6px 8px;color:var(--text-muted)">Corretor</th><th style="text-align:left;padding:6px 8px;color:var(--text-muted)">Pasta no Drive</th></tr></thead><tbody>'
      + pessoas.map(u=>{ const sel = mapa[u.uid] || _autoMatchPasta(u.nome, pastas); return `<tr data-uid="${escapeHtml(u.uid)}"><td style="padding:6px 8px;border-top:1px solid var(--border)">${escapeHtml(u.nome)}</td><td style="padding:6px 8px;border-top:1px solid var(--border)"><select class="robo-mapa-sel" style="width:100%;padding:5px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text-primary)">${opts(sel)}</select></td></tr>`; }).join('')
      + '</tbody></table>';
  } catch(e){ roboMapaCorpo.innerHTML = '<p class="muted" style="font-size:13px">Erro ao carregar: '+escapeHtml(e.message||'')+'</p>'; }
}
document.getElementById('btnRoboMapa')?.addEventListener('click', abrirRoboMapa);
document.getElementById('roboMapaFechar')?.addEventListener('click', ()=>modalRoboMapa.close());
document.getElementById('roboMapaCancelar')?.addEventListener('click', ()=>modalRoboMapa.close());
document.getElementById('roboMapaSalvar')?.addEventListener('click', async ()=>{
  const mapa = {};
  roboMapaCorpo.querySelectorAll('tr[data-uid]').forEach(tr=>{ const uid=tr.getAttribute('data-uid'); const v=tr.querySelector('.robo-mapa-sel')?.value; if(v) mapa[uid]=v; });
  // Modal que falhou ao carregar (ou tudo "não mapear") não tem o que salvar — e o
  // servidor substitui o doc INTEIRO, então {} apagaria todos os vínculos.
  if(!Object.keys(mapa).length){ roboMapaMsg.hidden=false; roboMapaMsg.style.color='var(--danger)'; roboMapaMsg.textContent='Nenhum vínculo selecionado — nada foi salvo.'; return; }
  const btn = document.getElementById('roboMapaSalvar'); btn.disabled=true; const t=btn.textContent; btn.textContent='Salvando…';
  try { const r = await driveMapaSalvar({ mapa }); roboMapaMsg.hidden=false; roboMapaMsg.style.color='var(--success)'; roboMapaMsg.textContent='✅ Mapa salvo ('+((r.data&&r.data.n)||0)+' corretores).'; setTimeout(()=>modalRoboMapa.close(), 900); }
  catch(e){ roboMapaMsg.hidden=false; roboMapaMsg.style.color='var(--danger)'; roboMapaMsg.textContent='Erro: '+e.message; }
  finally { btn.disabled=false; btn.textContent=t; }
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
      if(document.getElementById('evTodos').checked) {
        // Sem admin, "para todos" não é enviado; antes caía no else e criava
        // evento SEM ninguém convidado, em silêncio. Agora avisa e não cria vazio.
        if(!isAdmin){ alert('Só o admin pode criar evento para todos. Selecione os participantes manualmente.'); return; }
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
    // Mede o card em vez de cravar a largura: faixa em paisagem (capa de YouTube)
    // usa card mais largo, e um passo fixo pularia errado.
    const umCard = carousel.querySelector('.mkt-card');
    const passo = (umCard ? umCard.getBoundingClientRect().width : 186) + 14;
    carousel.scrollBy({ left: navBtn.classList.contains('mkt-next') ? passo : -passo, behavior: 'smooth' });
    return;
  }
  // Recolher: o CABEÇALHO INTEIRO alterna, não só a setinha. No accordion antigo
  // clicava-se no título, e é lá que o mouse vai — seta de 22px é alvo pequeno
  // demais e passa a impressão de que o botão não funciona.
  const head = e.target.closest('.mkt-prat-head');
  if (head && !e.target.closest('.mkt-vermais')) {
    const prat = head.closest('.mkt-prateleira');
    const toggle = head.querySelector('.mkt-toggle');
    const recolhida = prat.classList.toggle('recolhida');
    toggle.setAttribute('aria-expanded', String(!recolhida));
    toggle.title = recolhida ? 'Abrir esta categoria' : 'Recolher esta categoria';
    // Ao reabrir, as setas ‹ › precisam reavaliar se ainda fazem sentido:
    // com a faixa escondida o scrollWidth era 0 e elas ficariam desabilitadas.
    if (!recolhida) atualizarNavMarketing(prat.querySelector('.mkt-carousel'));
    return;
  }
  // "Ver mais": alterna a faixa entre linha que rola e grade com tudo à vista.
  const verMais = e.target.closest('.mkt-vermais');
  if (verMais) {
    const prat = verMais.closest('.mkt-prateleira');
    const aberta = prat.classList.toggle('expandida');
    verMais.textContent = aberta ? 'Ver menos' : 'Ver mais';
    // Ao recolher, volta o scroll pro começo — senão a faixa reabre no meio.
    if (!aberta) {
      const c = prat.querySelector('.mkt-carousel');
      c.scrollTo({ left: 0 });
      atualizarNavMarketing(c);
    }
    return;
  }
  const card = e.target.closest('.mkt-card');
  if (!card) return;
  window.hubApi.abrirTemplate(card.dataset.template, mktPrefill);
});

// Pesquisa de templates: filtra em memória a cada tecla (os dados já estão
// no mktConfig — nenhuma chamada de rede).
document.getElementById('mktBusca').addEventListener('input', (e) => {
  mktBusca = e.target.value;
  if (!mktModoGerenciar) renderMarketingVisualizar();
});

// Card é focável (role="button"): Enter/Espaço abrem, como o clique.
document.getElementById('secaoMarketing').addEventListener('keydown', (e) => {
  if (mktModoGerenciar) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.mkt-card');
  if (!card) return;
  e.preventDefault();
  window.hubApi.abrirTemplate(card.dataset.template, mktPrefill);
});

// ─── Marketing dinâmico + gerenciamento ─────────────────────────────────────
const listarMarketingConfig = httpsCallable(fns, 'listarMarketingConfig');
const salvarMarketingConfig = httpsCallable(fns, 'salvarMarketingConfig');
let mktConfig = { sanfonas: [] };

// Perfil do corretor pré-carregado pra semear os templates de marketing (nome + foto).
// Usado só na WEB: o platform-web grava em localStorage['vendido_editor_v6'] antes de
// abrir a aba, e o editor do template lê de lá (vence o corretor de demonstração).
// No desktop o abrirTemplate ignora o 2º argumento (o preload manda só o nome do arquivo).
let mktPrefill = null;
// (XX) XXXXX-XXXX pra celular (11 díg.) ou (XX) XXXX-XXXX pra fixo (10). Tira tudo que
// não é dígito antes, então funciona com o número cru ou já com máscara. Formato
// inesperado (menos/mais dígitos) volta como veio, sem mexer.
function formatarTelefone(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(bruto || '').trim();
}
async function carregarPrefillMkt() {
  if (mktPrefill) return;
  try {
    const r = await getMeuPerfil();
    mktPrefill = {
      nome: (r.data.displayName || '').trim(),
      phone: formatarTelefone(r.data.telefone),   // telefone formatado → contato na arte
      agent: r.data.photo || ''                    // foto do corretor (data URL) → foto na arte
    };
  } catch (_) { /* sem perfil: os templates abrem com o padrão de sempre */ }
}
let mktModoGerenciar = false;
let temPermMarketing = false; // vem do getMinhasPermissoes
let mktBusca = ''; // termo da pesquisa (só filtra o modo visualizar)

// Busca ignora acento e caixa: "aniversario" acha "Aniversário".
function mktNorm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Paleta de ícones pra escolher na sanfona (clicável — não precisa digitar emoji)
const MKT_EMOJIS = ['🏆','🏠','🏡','🏘️','🏢','🔑','💰','💎','📣','📢','⭐','🌟','✨','🔥','🎯','🎉','🎁','🥳','📸','🖼️','🎨','👑','❤️','✅','📌','🚀','💼','🛋️','🌆','🏅','🤝','📈'];

async function carregarMarketing() {
  carregarPrefillMkt();   // fire-and-forget: perfil pronto antes do 1º clique num card
  const cont = document.getElementById('mktContainer');
  const toolbar = document.getElementById('mktToolbar');
  const info = document.getElementById('mktToolbarInfo');
  // Gerenciar Marketing é permissão à parte (marketing_gerenciar), NÃO herda de admin.
  toolbar.hidden = !temPermMarketing;
  // A pesquisa só faz sentido no modo visualizar (no gerenciar a lista é outra).
  document.getElementById('mktBuscaWrap').hidden = mktModoGerenciar;
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
  // Layout de "prateleiras" (referência: REMARKT) — cada categoria é uma faixa
  // sempre visível, com os templates numa linha que rola na horizontal. Antes era
  // sanfona fechada: quem não clicava não via nada. "Ver mais" abre a faixa em
  // grade (todos de uma vez); o clique continua em qualquer ponto do card.
  // A pesquisa filtra por descrição do template OU título da categoria (título
  // que bate = categoria inteira); resultado abre em grade, sem carrossel.
  const termo = mktNorm(mktBusca.trim());
  cont.innerHTML = mktConfig.sanfonas.map(s => {
    let templates = (s.templates || []).slice().sort((a,b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    if (termo && !mktNorm(s.titulo).includes(termo)) {
      templates = templates.filter(t => mktNorm(t.descricao).includes(termo));
    }
    if (termo && !templates.length) return '';
    const cards = templates.map(t => `
      <div class="mkt-card" data-template="${escapeHtml(t.arquivo)}" role="button" tabindex="0"
           title="${escapeHtml(t.descricao)}">
        <div class="mkt-thumb"><img src="${escapeHtml(urlArquivo(t.capa))}" alt="${escapeHtml(t.descricao)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:11px\\'>sem capa</div>'"></div>
      </div>`).join('');
    // `aberta` vem da config (checkbox do ⚙ Gerenciar) e é só o estado INICIAL —
    // o botão de recolher alterna daqui pra frente. Sem o campo, abre: faixa
    // fechada por omissão foi o que escondia os templates no layout antigo.
    // Durante a busca ninguém fica fechado, senão o resultado some.
    const fechada = !termo && s.aberta === false;
    // `formato: 'paisagem'` = arte deitada (ex.: capa de YouTube, 16:9). Sem o
    // campo, segue retrato (1080×1440), que é o formato da maioria das artes.
    const paisagem = s.formato === 'paisagem' ? ' paisagem' : '';
    return `<section class="mkt-prateleira${termo ? ' expandida' : ''}${fechada ? ' recolhida' : ''}${paisagem}">
      <div class="mkt-prat-head">
        <button class="mkt-toggle" type="button" aria-expanded="${!fechada}"
                title="${fechada ? 'Abrir' : 'Recolher'} esta categoria">▾</button>
        <h3 class="mkt-prat-titulo">${escapeHtml(s.emoji || '')} ${escapeHtml(s.titulo || '')}
          <span class="mkt-prat-num">· ${templates.length}</span></h3>
        ${!termo && templates.length > 4 ? '<button class="mkt-vermais" type="button">Ver mais</button>' : ''}
      </div>
      <div class="mkt-carousel-wrap">
        <button class="mkt-nav-btn mkt-prev" aria-label="Anterior">‹</button>
        <div class="mkt-carousel">${cards}</div>
        <button class="mkt-nav-btn mkt-next" aria-label="Próximo">›</button>
      </div>
    </section>`;
  }).join('') || `<p class="muted" style="text-align:center;padding:32px 0">${termo
    ? `Nenhum template encontrado para "${escapeHtml(mktBusca.trim())}".`
    : 'Nenhuma sanfona configurada.'}</p>`;
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
      // Força o contentType — a regra do Storage exige text/html ou image/*. Sem isso, um
      // .html cujo file.type o Windows reporta vazio sobe como octet-stream e a regra nega
      // (erro genérico "sem permissão", mesmo tendo a permissão marketing_gerenciar).
      const contentType = campo === 'arquivo'
        ? 'text/html'
        : (file.type && /^image\//.test(file.type) ? file.type : 'image/' + (ext === 'jpg' ? 'jpeg' : ext.toLowerCase()));
      const snap = await uploadBytesResumable(ref, file, { contentType });
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

// Card de download do guia "Preparo do Imóvel para Fotos" (PDF servido pelo Hosting).
// Aparece pra todos na aba Fotografia. BASE_HOSTING resolve prod/staging por hostname.
function cardGuiaFotos() {
  return `
    <div class="foto-guia">
      <div class="foto-guia-ico">📸</div>
      <div class="foto-guia-txt">
        <h3>Guia: Preparo do Imóvel para Fotos</h3>
        <p class="muted">Checklist do que organizar em cada ambiente antes da sessão — iluminação, arrumação e detalhes. Use na visita ou envie ao proprietário.</p>
      </div>
      <button class="topbar-btn foto-guia-btn" id="btnBaixarGuiaFotos">⬇ Baixar PDF</button>
    </div>`;
}
function ligarGuiaFotos() {
  document.getElementById('btnBaixarGuiaFotos')?.addEventListener('click', () => {
    window.open(`${BASE_HOSTING}/guia-preparo-fotos.pdf`, '_blank');
  });
}

function renderFotoPessoal(driveLink, gestorPreview = false) {
  const topo = gestorPreview ? barraToggleFoto() : '';
  if (!driveLink) {
    secaoFotografia.innerHTML = topo + cardAgendamentoFoto() + cardGuiaFotos() + `
      <div class="foto-vazio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <p>Nenhuma pasta de fotos foi atribuída a você ainda.</p>
      </div>`;
    ligarGuiaFotos();
    if (gestorPreview) ligarToggleFoto();
    return;
  }
  const embedUrl = linkParaEmbedDrive(driveLink);
  secaoFotografia.innerHTML = topo + cardAgendamentoFoto() + cardGuiaFotos() + `
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
  ligarGuiaFotos();
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
  secaoFotografia.innerHTML = barraToggleFoto() + cardGuiaFotos() + `
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

  ligarGuiaFotos();
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
// ─── Carteira de Imóveis (Tela 01 do SMART HUB) ─────────────────────────────
// Visão comercial da coleção `imoveis`: finalidade + situação + interessados +
// arquivamento. A esteira de locação (status) vira detalhe do imóvel.
let cartFiltros = { fin: null, sit: null, corretor: null, busca: '' };

// As 6 fichas da Carteira (Copiar Link). Comprador = ficha-proposta; Fiador = locação c/ fiador.
const CARTEIRA_FICHAS = [
  { label: 'Locador',       arquivo: 'ficha-locador.html' },
  { label: 'Vendedor',      arquivo: 'ficha-vendedor.html' },
  { label: 'Cliente PF',  arquivo: 'ficha-pf.html' },
  { label: 'Cliente PJ',  arquivo: 'ficha-pj.html' },
  { label: 'Comprador',     arquivo: 'ficha-proposta.html' },
  { label: 'Fiador',        arquivo: 'ficha-locacao-fiador.html' },
];
const CART_FINALIDADES = [
  { key: 'locacao',       label: 'Locação',         cor: '#0ea5e9' },
  { key: 'venda',         label: 'Venda',           cor: '#16a34a' },
  { key: 'venda_locacao', label: 'Venda + Locação', cor: '#6366f1' },
];
const CART_SITUACOES = [
  { key: 'disponivel',     label: 'Disponível',     cor: '#16a34a' },
  { key: 'em_negociacao',  label: 'Em Negociação',  cor: '#b45309' },
  { key: 'arquivado',      label: 'Arquivado',      cor: '#6b7280' },
];
// Status do interessado (Tela 03). Aprovar/Reprovar = decisão do broker.
const INT_STATUS = [
  { key: 'ficha_enviada',  label: 'Ficha Enviada',  cor: '#6b7280' },
  { key: 'ficha_recebida', label: 'Ficha Recebida', cor: '#0ea5e9' },
  { key: 'em_analise',     label: 'Em Análise',     cor: '#6366f1' },
  { key: 'aprovado',       label: 'Aprovado',       cor: '#16a34a' },
  { key: 'reprovado',      label: 'Reprovado',      cor: '#DC1C2E' },
  { key: 'desistiu',       label: 'Desistiu',       cor: '#b45309' },
  { key: 'negocio_gerado', label: 'Negócio Gerado', cor: '#7C3AED' },
];
const intStatusDe    = p => p.status || 'em_analise';
const intStatusLabel = k => (INT_STATUS.find(s => s.key === k) || {}).label || k;
const intStatusCor   = k => (INT_STATUS.find(s => s.key === k) || {}).cor || '#6b7280';
const cartFinLabel = k => (CART_FINALIDADES.find(f => f.key === k) || {}).label || k;
const cartFinCor   = k => (CART_FINALIDADES.find(f => f.key === k) || {}).cor || '#6b7280';
const cartSitLabel = k => (CART_SITUACOES.find(s => s.key === k) || {}).label || k;
const cartSitCor   = k => (CART_SITUACOES.find(s => s.key === k) || {}).cor || '#6b7280';
// Imóvel legado (pré-Carteira) não tem finalidade/situacao: veio da ficha do locador ⇒ locação;
// situação derivada da esteira (em contrato/ativo = em negociação).
const cartFinalidadeDe = im => im.finalidade || 'locacao';
const cartSituacaoDe = im => {
  if (im.arquivado) return 'arquivado';
  if (im.situacao) return im.situacao;
  return (im.status === 'em_contrato' || im.status === 'ativo') ? 'em_negociacao' : 'disponivel';
};
const fmtCodigoSH = im => im.numeroProtocolo != null ? '#SH-' + String(im.numeroProtocolo).padStart(4, '0') : '—';
// "há 2 horas" / "ontem" / "há 3 dias" / data
function tempoRelativo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (h < 24) return `há ${h} hora${h > 1 ? 's' : ''}`;
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
// Toastzinho (sem alert): "Link copiado com sucesso", etc.
function cartToast(msg) {
  let t = document.getElementById('cartToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cartToast';
    t.setAttribute('style', 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#111827;color:#fff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.25);opacity:0;transition:opacity .15s;pointer-events:none');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}
async function cartCopiarLink(arquivo) {
  const nomeCorretor = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
  const link = `${BASE_HOSTING}/${arquivo}?corretor=${currentUid}&nome=${encodeURIComponent(nomeCorretor)}`;
  try { await navigator.clipboard.writeText(link); cartToast('Link copiado com sucesso'); }
  catch (_e) {
    // Fallback (clipboard bloqueado): textarea temporário
    const ta = document.createElement('textarea');
    ta.value = link; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); cartToast('Link copiado com sucesso'); }
    catch (_e2) { cartToast('Não consegui copiar — copie manualmente: ' + link); }
    ta.remove();
  }
}
const GAR_MOD_LABEL = { seguro_fianca:'Seguro fiança', fiador:'Fiador', caucao:'Caução', titulo_capitalizacao:'Título de capitalização' };
const GAR_STATUS_LABEL = { pendente:'Pendente', aprovada:'Aprovada', reprovada:'Reprovada' };
const ANALISE_LABEL = { em_analise:'Em análise', pendencia:'Pendência', aprovado:'Aprovado', reprovado:'Reprovado' };
const ANALISE_COR   = { em_analise:'#6366f1', pendencia:'#b45309', aprovado:'#16a34a', reprovado:'#DC1C2E' };
const _selStyle = 'font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)';

// Renderiza o detalhe completo de um imóvel (retorno de locObterImovel).
// `paraTela03` devolve os blocos separados (um por aba) em vez do grid único.
function renderDetalheImovel(d, paraTela03) {
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
  // Integração CheckVisto: solicita lá (vira agendamento + push) e volta sozinha pra cá.
  const vistCv = `<div class="form-vist-cv" data-imovel="${im.id}" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:8px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">
    <span style="font-size:11px;font-weight:700">Solicitar no CheckVisto:</span>
    <select class="cv-tipo" style="${_selStyle}"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
    <input class="cv-email" placeholder="e-mail do vistoriador (conta CheckVisto)" style="${_selStyle};min-width:210px">
    <button class="topbar-btn btn-vist-cv" style="font-size:11px;padding:4px 10px">📲 Solicitar</button>
    <span style="font-size:10px;color:var(--text-muted)">O status e o laudo voltam sozinhos quando a vistoria andar lá.</span></div>`;
  const vistoriaHtml = sec('Vistorias', vistList + vistForm + vistCv);

  const FICHAS_IMOVEL = [
    { key: 'pf', label: 'Cliente PF', arquivo: 'ficha-pf.html' },
    { key: 'pj', label: 'Cliente PJ', arquivo: 'ficha-pj.html' },
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

  // Tela 03: os mesmos blocos, distribuídos pelas abas (Informações / Proprietário /
  // Gestão da Locação). O histórico da esteira entra na aba Histórico da Tela 03.
  if (paraTela03) {
    return {
      informacoes: (imovelHtml + repasseHtml + admHtml + docsHtml + pendHtml) || '<p style="font-size:12px;color:var(--text-muted)">Sem dados cadastrais ainda. Use ✎ Editar Imóvel.</p>',
      proprietario: locHtml,
      gestao: gestaoHtml + vistoriaHtml + fichasImovelHtml + esteiraHtml,
      historicoEsteira: histHtml
    };
  }

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
  // Vistoria: solicitar no CheckVisto
  const formCv = cont.querySelector('.form-vist-cv');
  if (formCv) {
    const btnCv = formCv.querySelector('.btn-vist-cv');
    btnCv.addEventListener('click', async () => {
      const email = formCv.querySelector('.cv-email').value.trim();
      if (!email) { alert('Informe o e-mail da conta CheckVisto do vistoriador.'); return; }
      btnCv.disabled = true; btnCv.textContent = 'Solicitando...';
      try {
        const r = await locSolicitarVistoriaCheckVisto({ imovelId, tipo: formCv.querySelector('.cv-tipo').value, vistoriadorEmail: email });
        cartToast(r.data?.jaExistia ? 'Já havia uma solicitação aberta no CheckVisto' : 'Vistoria solicitada — o vistoriador recebe a notificação no CheckVisto');
        await recarregarDetalhe(cont, imovelId);
      } catch (e) { alert('Erro: ' + e.message); btnCv.disabled = false; btnCv.textContent = '📲 Solicitar'; }
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
    const TIPO_LABEL = { pf:'Cliente PF', pj:'Cliente PJ', fianca:'Fiança', locador:'Locador', locacao_fiador:'Locação c/ Fiador' };
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
  // Dentro da Tela 03, "recarregar o detalhe" = re-renderizar a tela inteira
  // (senão as abas seriam substituídas pelo grid antigo).
  if (cont && cont.closest && cont.closest('[data-tela03]')) { await abrirTela03(imovelId); return; }
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

// (cardImovelHtml removido — a Carteira usa tabela; ver renderCarteira abaixo)

async function carregarImoveis() {
  tela03Atual = null;   // carregar a lista sempre sai da Tela 03
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando a carteira...</p>';
  try {
    const res = await locListarImoveis({});
    const imoveis = res.data?.imoveis || [];
    const veTudo  = !!res.data?.veTudo;
    const role    = res.data?.role || 'corretor';
    imoveisRole = role;
    _imoveisCache = { imoveis, veTudo, role };
    renderCarteira();
  } catch (e) {
    secaoImoveis.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar a carteira: ${escapeHtml(e.message)}</p>`;
  }
}

// ─── Render da Carteira (fichas + indicadores + pesquisa + filtros + tabela) ──
function renderCarteira() {
  if (!_imoveisCache) return;
  const { imoveis, veTudo } = _imoveisCache;

  // Indicadores (arquivados ficam fora dos demais números)
  const naoArq  = imoveis.filter(im => !im.arquivado);
  const arq     = imoveis.filter(im => im.arquivado);
  const disp    = naoArq.filter(im => cartSituacaoDe(im) === 'disponivel');
  const neg     = naoArq.filter(im => cartSituacaoDe(im) === 'em_negociacao');
  const pend    = naoArq.filter(im => (im.pendentes || []).length > 0);
  const hojeKey = chaveDia(new Date());
  const captHoje = naoArq.filter(im => im.criadoEm && chaveDia(new Date(im.criadoEm)) === hojeKey);

  // Aplica pesquisa + filtros (client-side, em cima do cache)
  const busca = (cartFiltros.busca || '').toLowerCase();
  const buscaDe = im => {
    const e = im.endereco || {};
    return [fmtCodigoSH(im), e.logradouro, e.numero, e.bairro, e.cidade,
      im.proprietarioNome || im.locadorNome, im.corretorNome].filter(Boolean).join(' ').toLowerCase();
  };
  let lista = imoveis.filter(im => {
    const sit = cartSituacaoDe(im);
    // Sem filtro de situação, arquivado não aparece (spec: arquivar = tirar da operação)
    if (cartFiltros.sit ? sit !== cartFiltros.sit : sit === 'arquivado') return false;
    if (cartFiltros.fin && cartFinalidadeDe(im) !== cartFiltros.fin) return false;
    if (cartFiltros.corretor && im.corretorUid !== cartFiltros.corretor) return false;
    if (busca && !buscaDe(im).includes(busca)) return false;
    return true;
  });

  // ── Blocos ──
  const fichasHtml = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <strong style="font-size:13px">Fichas de Cadastro</strong>
      <span style="font-size:11px;color:var(--text-muted)">Copie o link e envie ao cliente.</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${CARTEIRA_FICHAS.map(f => `<button class="cart-copiar" data-arquivo="${f.arquivo}" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:var(--hover);border:1px solid var(--border);border-radius:8px;padding:8px 12px;cursor:pointer;min-width:110px">
        <span style="font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--text-muted);text-transform:uppercase">${f.label}</span>
        <span style="font-size:11px;font-weight:600;color:#0ea5e9">Copiar Link</span></button>`).join('')}
    </div></div>`;

  const card = (num, label, sub, cor) => `<div style="flex:1;min-width:104px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:10px 12px">
    <div style="font-size:20px;font-weight:700;color:${cor}">${num}</div>
    <div style="font-size:11px;color:var(--text-primary);font-weight:600">${label}</div>
    <div style="font-size:10px;color:var(--text-muted)">${sub}</div></div>`;
  const pct = naoArq.length ? Math.round((disp.length / naoArq.length) * 100) : 0;
  const indicadores = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    ${card(naoArq.length, 'Imóveis', 'na carteira', '#0ea5e9')}
    ${card(disp.length, 'Disponíveis', pct + '% da carteira', '#16a34a')}
    ${card(neg.length, 'Em Negociação', 'negócios andando', '#b45309')}
    ${card(pend.length, 'Pendências', 'imóveis c/ pendência', '#DC1C2E')}
    ${card(captHoje.length, 'Captados Hoje', hojeKey.split('-').reverse().slice(0, 2).join('/'), '#6366f1')}
    ${card(arq.length, 'Arquivados', 'fora da operação', '#6b7280')}
  </div>`;

  // Filtros: pills de finalidade + situação (+ corretor se broker) + limpar
  const pill = (grupo, key, label, ativoAgora, cor) => `<button class="cart-pill" data-grupo="${grupo}" data-key="${key}" style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:14px;cursor:pointer;border:1px solid ${ativoAgora ? cor : 'var(--border)'};background:${ativoAgora ? cor + '1f' : 'var(--surface)'};color:${ativoAgora ? cor : 'var(--text-muted)'}">${label}</button>`;
  const corretores = veTudo ? [...new Map(imoveis.filter(i => i.corretorUid).map(i => [i.corretorUid, i.corretorNome || i.corretorUid])).entries()] : [];
  const temFiltro = cartFiltros.fin || cartFiltros.sit || cartFiltros.corretor || cartFiltros.busca;
  const filtrosHtml = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:12px 16px;margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
    <input id="cartBusca" type="search" placeholder="Pesquisar por código, endereço, proprietário, corretor, bairro..." value="${escapeHtml(cartFiltros.busca)}"
      style="flex:1;min-width:220px;font-size:12px;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--text-primary)">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Finalidade</span>
      ${CART_FINALIDADES.map(f => pill('fin', f.key, f.label, cartFiltros.fin === f.key, f.cor)).join('')}</div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Situação</span>
      ${CART_SITUACOES.map(s => pill('sit', s.key, s.label, cartFiltros.sit === s.key, s.cor)).join('')}</div>
    ${corretores.length ? `<select id="cartFCorretor" style="font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-primary)">
      <option value="">Corretor: todos</option>
      ${corretores.map(([uid, nome]) => `<option value="${escapeHtml(uid)}"${cartFiltros.corretor === uid ? ' selected' : ''}>${escapeHtml(nome)}</option>`).join('')}</select>` : ''}
    ${temFiltro ? `<button id="cartLimpar" style="font-size:11px;font-weight:600;color:#DC1C2E;background:none;border:none;cursor:pointer">Limpar filtros</button>` : ''}
  </div>`;

  // Tabela
  const badge = (label, cor) => `<span style="font-size:10px;font-weight:600;color:${cor};background:${cor}18;border:1px solid ${cor}40;padding:2px 8px;border-radius:12px;white-space:nowrap">${label}</span>`;
  const th = t => `<th style="text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap">${t}</th>`;
  const td = (c, extra) => `<td style="font-size:12px;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top;${extra || ''}">${c}</td>`;
  const linhas = lista.map(im => {
    const e = im.endereco || {};
    const l1 = [e.logradouro, e.numero].filter(Boolean).join(', ') + (e.complemento ? ' · ' + e.complemento : '');
    const l2 = [e.bairro, e.cidade].filter(Boolean).join(' · ');
    const fin = cartFinalidadeDe(im), sit = cartSituacaoDe(im);
    const nPend = (im.pendentes || []).length;
    const nInt = (im.interessados || []).length;
    return `<tr class="cart-row">
      ${td(`<strong style="white-space:nowrap">${fmtCodigoSH(im)}</strong>`)}
      ${td(`<div style="font-weight:600">${escapeHtml(l1 || im.tipo || 'Imóvel')}</div><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(l2)}</div>`)}
      ${td(escapeHtml(im.proprietarioNome || im.locadorNome || '—'))}
      ${td(escapeHtml(im.corretorNome || '—'))}
      ${td(badge(cartFinLabel(fin), cartFinCor(fin)))}
      ${td(badge(cartSitLabel(sit), cartSitCor(sit)))}
      ${td(`<span style="font-weight:700">${nInt || '—'}</span>`, 'text-align:center')}
      ${td(nPend ? badge(nPend + ' Pendência' + (nPend > 1 ? 's' : ''), '#DC1C2E') : '—', 'text-align:center')}
      ${td(`<span style="color:var(--text-muted);white-space:nowrap">${tempoRelativo(im.atualizadoEm)}</span>`)}
      ${td(`<button class="topbar-btn cart-abrir" data-id="${escapeHtml(im.id)}" style="font-size:11px;padding:4px 12px">Abrir</button>`)}
    </tr>`;
  }).join('');

  const tabela = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <div><strong style="font-size:13px">Imóveis</strong>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${lista.length} de ${naoArq.length} imóve${naoArq.length === 1 ? 'l' : 'is'}</span></div>
      <button id="cartNovo" class="topbar-btn" style="font-size:12px;font-weight:600;padding:6px 14px;background:#002749;color:#fff;border-color:#002749">+ Novo Imóvel</button></div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:920px">
      <thead><tr>${['Código', 'Endereço', 'Proprietário', 'Corretor', 'Finalidade', 'Situação', 'Interessados', 'Pendências', 'Última atualização', 'Ações'].map(th).join('')}</tr></thead>
      <tbody>${linhas || `<tr><td colspan="10" style="font-size:12px;color:var(--text-muted);text-align:center;padding:32px 16px;line-height:1.6">
        ${imoveis.length ? 'Nenhum imóvel com esses filtros.' : 'Nenhum imóvel na carteira ainda.<br><span style="font-size:11px">O fluxo principal é enviar a ficha (Locador ou Vendedor) pro cliente — o imóvel entra sozinho quando a ficha é enviada ao administrativo. Pra casos excepcionais, use o botão <strong>+ Novo Imóvel</strong>.</span>'}
      </td></tr>`}</tbody>
    </table></div></div>`;

  secaoImoveis.innerHTML = fichasHtml + indicadores + filtrosHtml + tabela;
  wireCarteira();
}

function badgeMini(label, cor) {
  // inline-block + nowrap: rótulo de duas palavras ("Em Andamento") não quebra em
  // duas linhas com a borda da pílula cortando o texto no meio.
  return `<span style="display:inline-block;white-space:nowrap;font-size:10px;font-weight:600;color:${cor};background:${cor}18;border:1px solid ${cor}40;padding:2px 8px;border-radius:12px">${escapeHtml(label)}</span>`;
}

// ─── Tela 03 — Detalhes do Imóvel ─────────────────────────────────────────────
// Centro operacional do imóvel (spec Tela 03): abas Informações / Proprietário /
// Interessados / Histórico (+ Gestão da Locação, herdada). Daqui nasce o Negócio.
let tela03Atual = null;         // imovelId aberto (null = lista da Carteira)
let tela03Aba = 'informacoes';

async function abrirTela03(id, aba) {
  tela03Atual = id;
  tela03Aba = aba || tela03Aba || 'informacoes';
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando detalhes do imóvel...</p>';
  try {
    const res = await locObterImovel({ imovelId: id });
    renderTela03(res.data || {});
  } catch (e) {
    secaoImoveis.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar: ${escapeHtml(e.message)}<br>
      <button id="t3VoltarErr" class="topbar-btn" style="margin-top:10px;font-size:12px">← Voltar à Carteira</button></div>`;
    document.getElementById('t3VoltarErr')?.addEventListener('click', () => { tela03Atual = null; carregarImoveis(); });
  }
}

function renderTela03(d) {
  const im = d.imovel || {};
  const broker = imoveisRole === 'gestor' || imoveisRole === 'administrativo';
  const ehGestorTela = imoveisRole === 'gestor';
  const fin = cartFinalidadeDe(im), sit = cartSituacaoDe(im);
  const e = im.endereco || {};
  const endStr = [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ');

  // Resumo (spec: código, tipo, finalidade, situação, endereço, corretor)
  const resumoItem = (r, v) => `<div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${r}</div><div style="font-size:13px;font-weight:600;margin-top:3px">${v || '—'}</div></div>`;
  const sitSel = im.arquivado
    ? badgeMini('Arquivado', '#6b7280')
    : `<select id="t3Sit" style="${_selStyle}">
        <option value="disponivel"${sit === 'disponivel' ? ' selected' : ''}>Disponível</option>
        <option value="em_negociacao"${sit === 'em_negociacao' ? ' selected' : ''}>Em Negociação</option></select>`;
  let esteiraSel = '';
  if (fin !== 'venda' && im.status) {
    if (broker && im.status !== 'ativo') {
      const opts = IMOVEL_STATUS.filter(s => s.key !== 'ativo').map(s => {
        const dis = (!ehGestorTela && IMOVEL_STATUS_SO_GESTOR.includes(s.key)) ? ' disabled' : '';
        return `<option value="${s.key}"${s.key === im.status ? ' selected' : ''}${dis}>${s.label}</option>`;
      }).join('');
      esteiraSel = `<select id="t3Esteira" style="${_selStyle}">${opts}</select>`;
    } else {
      esteiraSel = badgeMini(imovelLabel(im.status), imovelCor(im.status));
    }
  }

  const abas = [
    ['informacoes', 'Informações'],
    ['proprietario', 'Proprietário'],
    ['interessados', `Interessados (${(im.interessados || []).length})`],
    ['historico', 'Histórico'],
  ];
  if (fin !== 'venda') abas.push(['gestao', 'Gestão da Locação']);
  if (!abas.some(([k]) => k === tela03Aba)) tela03Aba = 'informacoes';

  const blocos = renderDetalheImovel(d, true);

  // Aba Proprietário sem ficha (cadastro manual / venda sem locadores): resumo do cadastro.
  // Spec 03: mostra os dados que o imóvel tem + botão "Abrir Cadastro Completo".
  const pLin = (r, v) => `<div style="display:flex;gap:8px;padding:3px 0;font-size:12px"><span style="color:var(--text-muted);min-width:120px">${r}</span><span>${escapeHtml(v || '—')}</span></div>`;
  const propFallback = `<div>
    ${pLin('Nome', im.proprietarioNome || im.locadorNome)}
    ${pLin('Telefone / WhatsApp', im.proprietarioContato)}
    ${pLin('Corretor responsável', im.corretorNome)}
    ${pLin('Situação da ficha', im.origem === 'manual' ? 'Cadastro manual (sem ficha)' : 'Sem ficha vinculada')}
    <div style="margin-top:10px"><button id="t3PropCadastro" class="topbar-btn" style="font-size:11px;padding:5px 14px">Abrir Cadastro Completo</button></div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:8px">${im.origem === 'manual' ? 'Imóvel de cadastro manual — os dados do proprietário ficam no cadastro do imóvel.' : 'Os dados completos do proprietário vêm da ficha de origem.'}</p></div>`;

  // Aba Histórico: timeline automática + movimentos da esteira (mais novo primeiro).
  const eventos = [
    ...(im.timeline || []).map(h => ({ em: h.em, texto: h.texto, por: h.porNome })),
    ...(im.historico || []).map(h => ({ em: h.em, texto: `Esteira: ${imovelLabel(h.de)} → ${imovelLabel(h.para)}`, por: h.porNome })),
    ...(im.criadoEm ? [{ em: im.criadoEm, texto: 'Imóvel criado', por: im.corretorNome || '' }] : []),
  ].filter(ev => ev.texto).sort((a, b) => (b.em || '').localeCompare(a.em || ''));
  const histTela = eventos.length ? eventos.map(ev => {
    const dt = ev.em ? new Date(ev.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--text-muted);white-space:nowrap;min-width:112px">${dt}</span>
      <span style="flex:1">${escapeHtml(ev.texto)}</span>
      <span style="color:var(--text-muted);white-space:nowrap">${escapeHtml(ev.por || '')}</span></div>`;
  }).join('') : '<p style="font-size:12px;color:var(--text-muted)">Nada registrado ainda.</p>';

  const paneStyle = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px 18px';
  const conteudos = {
    informacoes: blocos.informacoes,
    proprietario: blocos.proprietario || propFallback,
    interessados: tela03IntHtml(im, broker, ehGestorTela),
    historico: histTela,
    gestao: blocos.gestao || '<p style="font-size:12px;color:var(--text-muted)">Sem dados de gestão.</p>',
  };

  secaoImoveis.innerHTML = `<div id="tela03" data-tela03="1" data-id="${escapeHtml(im.id || '')}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <button id="t3Voltar" class="topbar-btn" style="font-size:12px;padding:6px 12px">← Carteira</button>
      <strong style="font-size:15px">Detalhes do Imóvel</strong>
      <span style="font-size:12px;font-weight:700;color:var(--text-muted);background:var(--hover);border:1px solid var(--border);padding:3px 10px;border-radius:6px">${fmtCodigoSH(im)}</span>
      <span style="flex:1"></span>
      <button id="t3Editar" class="topbar-btn" style="font-size:12px;padding:6px 14px">✎ Editar Imóvel</button>
      ${(im.finalidade === 'venda' || im.finalidade === 'venda_locacao') ? '<button id="t3Contrato" class="topbar-btn" style="font-size:12px;padding:6px 14px">📄 Gerar Contrato</button>' : ''}
      ${ehGestorTela ? '<button id="t3GerarNeg" class="topbar-btn" style="font-size:12px;font-weight:700;padding:6px 14px;background:#002749;color:#fff;border-color:#002749">⚡ Gerar Negócio</button>' : ''}
      <button id="t3Arquivar" class="topbar-btn" style="font-size:12px;padding:6px 12px;color:${im.arquivado ? '#16a34a' : '#6b7280'}">${im.arquivado ? '↩ Restaurar' : '🗂 Arquivar'}</button>
    </div>
    <div style="${paneStyle};margin-bottom:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px 18px;align-items:start">
      ${resumoItem('Código', fmtCodigoSH(im))}
      ${resumoItem('Tipo', escapeHtml(im.tipo || '—'))}
      ${resumoItem('Finalidade', badgeMini(cartFinLabel(fin), cartFinCor(fin)))}
      ${resumoItem('Situação', sitSel)}
      ${fin !== 'venda' && im.status ? resumoItem('Esteira', esteiraSel) : ''}
      ${resumoItem('Corretor responsável', escapeHtml(im.corretorNome || '—'))}
      <div style="grid-column:1/-1">${resumoItem('Endereço', escapeHtml(endStr || '—'))}</div>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:0">
      ${abas.map(([k, l]) => `<button class="t3-aba" data-aba="${k}" style="font-size:12px;font-weight:600;padding:7px 16px;border:1px solid ${k === tela03Aba ? '#002749' : 'var(--border)'};border-bottom:none;border-radius:8px 8px 0 0;background:${k === tela03Aba ? '#002749' : 'var(--surface)'};color:${k === tela03Aba ? '#fff' : 'var(--text-muted)'};cursor:pointer">${l}</button>`).join('')}
    </div>
    ${abas.map(([k]) => `<div class="t3-pane" data-pane="${k}" style="${paneStyle};border-top-left-radius:0"${k === tela03Aba ? '' : ' hidden'}>${conteudos[k]}</div>`).join('')}
  </div>`;

  wireTela03(d);
  const t3 = document.getElementById('tela03');
  if (t3) wireDetalheImovel(t3, im.id, d);   // liga os blocos herdados (gestão/vistorias/fichas/portal)
}

// Aba Interessados da Tela 03: enviar ficha vinculada + status + gerar negócio.
function tela03IntHtml(im, broker, ehGestorTela) {
  const fin = cartFinalidadeDe(im);
  const fichasOpcoes = [
    ...(fin !== 'venda' ? [
      { label: 'Cliente PF', arquivo: 'ficha-pf.html' },
      { label: 'Cliente PJ', arquivo: 'ficha-pj.html' },
    ] : []),
    ...(fin !== 'locacao' ? [{ label: 'Comprador', arquivo: 'ficha-proposta.html' }] : []),
  ];
  const enviar = `<div style="border:1px dashed var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;margin-bottom:2px">Enviar Ficha ao Interessado</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">O link sai vinculado a este imóvel — quando o cliente responder, o interessado entra aqui sozinho como “Ficha Recebida”.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <input id="t3FichaNome" placeholder="Nome (opcional — registra já como Ficha Enviada)" style="${_selStyle};min-width:250px">
      ${fichasOpcoes.map(f => `<button class="t3-enviar-ficha" data-arquivo="${f.arquivo}" style="font-size:11px;font-weight:600;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);cursor:pointer;color:var(--text-primary)">📄 ${f.label} · Copiar Link</button>`).join('')}
    </div></div>`;

  const linhas = (im.interessados || []).map((p, i) => {
    const st = intStatusDe(p);
    // Já avaliado (aprovado/reprovado): só o broker mexe — pros demais, nem select
    // (o servidor recusaria; mostrar controle que sempre falha só frustra).
    const travadoPraMim = ['aprovado', 'reprovado'].includes(st) && !ehGestorTela;
    const selStatus = (st === 'negocio_gerado' || travadoPraMim)
      ? ''
      : `<select class="t3-int-status" data-index="${i}" style="${_selStyle}">
          ${INT_STATUS.filter(s => s.key !== 'negocio_gerado').map(s => {
            const dis = ['aprovado', 'reprovado'].includes(s.key) && !ehGestorTela ? ' disabled' : '';
            return `<option value="${s.key}"${s.key === st ? ' selected' : ''}${dis}>${s.label}</option>`;
          }).join('')}</select>`;
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:6px">
      <div style="flex:1;min-width:160px">
        <strong style="font-size:13px">${escapeHtml(p.nome || '')}</strong>
        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml([p.tipo === 'comprador' ? 'Comprador' : 'Locatário', p.contato].filter(Boolean).join(' · '))}</div></div>
      ${badgeMini(intStatusLabel(st), intStatusCor(st))}
      ${selStatus}
      ${ehGestorTela && st === 'aprovado' ? `<button class="t3-gerar-neg" data-index="${i}" style="font-size:11px;font-weight:700;padding:6px 12px;border:none;border-radius:8px;background:#002749;color:#fff;cursor:pointer">⚡ Gerar Negócio</button>` : ''}
      ${st !== 'negocio_gerado' && !travadoPraMim ? `<button class="t3-int-rem" data-index="${i}" title="Remover" style="border:none;background:none;color:#DC1C2E;cursor:pointer;font-size:14px;line-height:1">✕</button>` : ''}
    </div>`;
  }).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhum interessado ainda. Envie uma ficha acima ou adicione manualmente abaixo.</p>';

  const addManual = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
    <input id="t3IntNome" placeholder="Nome do interessado" style="${_selStyle};min-width:170px">
    <input id="t3IntContato" placeholder="Contato (opc.)" style="${_selStyle};min-width:130px">
    <select id="t3IntTipo" style="${_selStyle}"><option value="locatario">Locatário</option><option value="comprador">Comprador</option></select>
    <button id="t3IntAdd" style="font-size:11px;font-weight:600;padding:6px 12px;border:none;border-radius:8px;background:#002749;color:#fff;cursor:pointer">+ Adicionar</button></div>`;

  const dica = ehGestorTela
    ? '<p style="font-size:11px;color:var(--text-muted);margin-top:10px">Somente interessado <strong>Aprovado</strong> gera negócio — e cada imóvel tem no máximo 1 negócio ativo.</p>'
    : '<p style="font-size:11px;color:var(--text-muted);margin-top:10px">Aprovar/Reprovar interessado e Gerar Negócio são decisões do broker.</p>';
  return enviar + linhas + addManual + dica;
}

function t3TrocarAba(aba) {
  tela03Aba = aba;
  document.querySelectorAll('.t3-aba').forEach(b => {
    const ativo = b.dataset.aba === aba;
    b.style.background = ativo ? '#002749' : 'var(--surface)';
    b.style.color = ativo ? '#fff' : 'var(--text-muted)';
    b.style.borderColor = ativo ? '#002749' : 'var(--border)';
  });
  document.querySelectorAll('.t3-pane').forEach(p => { p.hidden = p.dataset.pane !== aba; });
}

function wireTela03(d) {
  const im = d.imovel || {};
  const id = im.id;
  const $ = s => document.getElementById(s);

  $('t3Voltar')?.addEventListener('click', () => { tela03Atual = null; carregarImoveis(); });
  $('t3Editar')?.addEventListener('click', () => cartAbrirModal(im));
  $('t3PropCadastro')?.addEventListener('click', () => cartAbrirModal(im)); // "Abrir Cadastro Completo" (aba Proprietário, imóvel manual)
  document.querySelectorAll('.t3-aba').forEach(b => b.addEventListener('click', () => t3TrocarAba(b.dataset.aba)));

  $('t3Arquivar')?.addEventListener('click', async (ev) => {
    const arquivar = !im.arquivado;
    if (arquivar && !confirm('Arquivar este imóvel? Ele sai da operação, mas nada é excluído — dá pra restaurar depois.')) return;
    ev.target.disabled = true;
    try { await carteiraArquivar({ imovelId: id, arquivar }); cartToast(arquivar ? 'Imóvel arquivado' : 'Imóvel restaurado'); abrirTela03(id); }
    catch (e) { alert('Erro: ' + e.message); ev.target.disabled = false; }
  });
  $('t3Sit')?.addEventListener('change', async (ev) => {
    ev.target.disabled = true;
    try { await carteiraSituacaoFn({ imovelId: id, situacao: ev.target.value }); cartToast('Situação atualizada'); abrirTela03(id); }
    catch (e) { alert('Erro: ' + e.message); abrirTela03(id); }
  });
  $('t3Esteira')?.addEventListener('change', async (ev) => {
    ev.target.disabled = true;
    try { await locMoverImovelStatus({ imovelId: id, novoStatus: ev.target.value }); cartToast('Esteira atualizada'); abrirTela03(id); }
    catch (e) { alert('Erro ao mover: ' + e.message); abrirTela03(id); }
  });

  // Gerar Contrato de representação (só imóvel de venda): backend preenche o PDF-modelo
  // da RE/MAX com vendedores + imóvel + corretor e devolve pronto pra baixar.
  $('t3Contrato')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ Gerando...';
    try {
      const r = await gerarContratoVendaFn({ imovelId: id });
      const d = r.data || {};
      baixarBase64Pdf(d.pdfBase64, d.filename);
      let msg = 'Contrato gerado — confira e suba no ClickSign.';
      if (d.semFicha) msg = 'Contrato gerado, mas este imóvel não tem ficha de vendedor: os dados dos vendedores saíram em branco.';
      else if (!d.vendedores) msg = 'Contrato gerado, mas nenhum vendedor foi encontrado na ficha.';
      if (d.semCreci) msg += ' (CRECI/CPF do corretor não está no perfil — Configurações.)';
      if (d.drive) msg += ' 📁 Também salvo no seu Google Drive.';
      cartToast(msg);
    } catch (e) {
      alert('Erro ao gerar contrato: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = txt;
    }
  });

  // Gerar Negócio (cabeçalho): aponta pro interessado aprovado — o botão ⚡ mora na linha dele.
  $('t3GerarNeg')?.addEventListener('click', () => {
    const aprovados = (im.interessados || []).filter(p => intStatusDe(p) === 'aprovado');
    if (!aprovados.length) alert('Nenhum interessado Aprovado ainda.\n\nO negócio nasce de um interessado aprovado: na aba Interessados, aprove um (decisão do broker) e clique no ⚡ Gerar Negócio da linha dele.');
    t3TrocarAba('interessados');
  });

  // Interessados
  document.querySelectorAll('.t3-enviar-ficha').forEach(b => b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true;               // duplo clique no "Copiar Link" registrava o interessado 2x
    setTimeout(() => { b.disabled = false; }, 1500);
    const nome = $('t3FichaNome')?.value.trim() || '';
    const nomeCorretor = document.getElementById('usuarioInfo')?.textContent?.trim() || '';
    // corretor = DONO do imóvel (não o usuário logado): assim o gestor pode enviar
    // ficha pra imóvel de um corretor sem "roubar" a atribuição, a ficha cai na
    // regra de ouro do dono, e o link sempre bate com o imóvel (o servidor recusa
    // ficha apontando pra imóvel de outro corretor). Fallback = legado sem dono.
    const corretorLink = im.corretorUid || currentUid;
    const link = `${BASE_HOSTING}/${b.dataset.arquivo}?corretor=${corretorLink}&nome=${encodeURIComponent(nomeCorretor)}&imovelId=${id}`;
    try { await navigator.clipboard.writeText(link); cartToast('Link copiado — vinculado a este imóvel'); }
    catch (_e) {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); cartToast('Link copiado — vinculado a este imóvel'); }
      catch (_e2) { cartToast('Não consegui copiar — copie manualmente: ' + link); }
      ta.remove();
    }
    if (nome) {
      const tipo = b.dataset.arquivo === 'ficha-proposta.html' ? 'comprador' : 'locatario';
      try { await carteiraInteressado({ imovelId: id, acao: 'add', nome, tipo, status: 'ficha_enviada' }); abrirTela03(id, 'interessados'); }
      catch (e) { alert('Link copiado, mas não registrei o interessado: ' + e.message); }
    }
  }));
  $('t3IntAdd')?.addEventListener('click', async (ev) => {
    const nome = $('t3IntNome')?.value.trim();
    if (!nome) { alert('Informe o nome do interessado.'); return; }
    ev.target.disabled = true;
    try { await carteiraInteressado({ imovelId: id, acao: 'add', nome, contato: $('t3IntContato')?.value.trim() || '', tipo: $('t3IntTipo')?.value }); cartToast('Interessado adicionado'); abrirTela03(id, 'interessados'); }
    catch (e) { alert('Erro: ' + e.message); ev.target.disabled = false; }
  });
  document.querySelectorAll('.t3-int-rem').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await carteiraInteressado({ imovelId: id, acao: 'remover', index: Number(b.dataset.index) }); cartToast('Interessado removido'); abrirTela03(id, 'interessados'); }
    catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
  }));
  document.querySelectorAll('.t3-int-status').forEach(sel => sel.addEventListener('change', async () => {
    sel.disabled = true;
    try { await carteiraInteressado({ imovelId: id, acao: 'status', index: Number(sel.dataset.index), status: sel.value }); cartToast('Status atualizado'); abrirTela03(id, 'interessados'); }
    catch (e) { alert('Erro: ' + e.message); abrirTela03(id, 'interessados'); }
  }));
  document.querySelectorAll('.t3-gerar-neg').forEach(b => b.addEventListener('click', async () => {
    const i = Number(b.dataset.index);
    const p = (im.interessados || [])[i] || {};
    if (!confirm(`Gerar negócio para ${p.nome}?\n\nO interessado vira "Negócio Gerado" e o imóvel entra Em Negociação.`)) return;
    b.disabled = true;
    try { const r = await negocioGerarFn({ imovelId: id, interessadoIndex: i }); cartToast(`Negócio ${r.data?.codigo || ''} criado`); abrirTela03(id, 'interessados'); }
    catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
  }));
}

// ─── Telas 04A/04B — Lista de Negócios + Gerenciar Negócio ───────────────────
// 04A: todas as negociações (broker vê tudo; corretor só as dele). NÃO tem botão
// "Novo Negócio" — todo negócio nasce na Tela 03. 04B: checklist operacional,
// comentários internos (broker + corretor responsável), histórico e Entregar
// para Gestão (broker, só com as etapas obrigatórias concluídas).
const NEG_STATUS = [
  { key: 'negocio_criado',            label: 'Negócio Criado',            cor: '#6b7280' },
  { key: 'em_andamento',              label: 'Em Andamento',              cor: '#0ea5e9' },
  { key: 'aguardando_broker',         label: 'Aguardando Broker',         cor: '#6366f1' },
  { key: 'aguardando_corretor',       label: 'Aguardando Corretor',       cor: '#b45309' },
  { key: 'aguardando_administrativo', label: 'Aguardando Administrativo', cor: '#8b5cf6' },
  { key: 'entregue_gestao',           label: 'Entregue para Gestão',      cor: '#16a34a' },
  { key: 'concluido',                 label: 'Concluído',                 cor: '#15803d' },
  { key: 'cancelado',                 label: 'Cancelado',                 cor: '#DC1C2E' },
];
const negStatusLabel = k => (NEG_STATUS.find(s => s.key === k) || {}).label || k;
const negStatusCor   = k => (NEG_STATUS.find(s => s.key === k) || {}).cor || '#6b7280';
const negProgresso = n => {
  const c = n.checklist || [];
  return c.length ? Math.round((c.filter(x => x.feito).length / c.length) * 100) : 0;
};
let negFiltros = { tipo: null, status: null, corretor: null, busca: '' };
let _negociosCache = null;
let negAbrirDireto = null;   // negocioId pra abrir o 04B direto ao entrar no sub-app

async function carregarNegocios() {
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando os negócios...</p>';
  try {
    const res = await negocioListarFn({});
    _negociosCache = { negocios: res.data?.negocios || [], veTudo: !!res.data?.veTudo };
    renderTela04A();
  } catch (e) {
    secaoImoveis.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar os negócios: ${escapeHtml(e.message)}</p>`;
  }
}

function renderTela04A() {
  if (!_negociosCache) return;
  const { negocios, veTudo } = _negociosCache;

  const conta = f => negocios.filter(f).length;
  const card = (num, label, cor) => `<div style="flex:1;min-width:104px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:10px 12px">
    <div style="font-size:20px;font-weight:700;color:${cor}">${num}</div>
    <div style="font-size:11px;color:var(--text-primary);font-weight:600">${label}</div></div>`;
  const indicadores = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    ${card(negocios.length, 'Total de Negócios', '#0ea5e9')}
    ${card(conta(n => n.tipo === 'locacao'), 'Locações', '#6366f1')}
    ${card(conta(n => n.tipo === 'venda'), 'Vendas', '#16a34a')}
    ${card(conta(n => (n.status || '').startsWith('aguardando')), 'Pendentes', '#b45309')}
    ${card(conta(n => n.status === 'entregue_gestao'), 'Entregues p/ Gestão', '#15803d')}
    ${card(conta(n => n.status === 'concluido'), 'Concluídos', '#6b7280')}
  </div>`;

  // Filtros: pesquisa + tipo + status + corretor (broker)
  const busca = (negFiltros.busca || '').toLowerCase();
  const buscaDe = n => [n.codigo, n.clienteNome, n.imovelResumo, n.cidade, n.corretorNome, n.brokerNome].filter(Boolean).join(' ').toLowerCase();
  const lista = negocios.filter(n => {
    if (negFiltros.tipo && n.tipo !== negFiltros.tipo) return false;
    if (negFiltros.status && n.status !== negFiltros.status) return false;
    if (negFiltros.corretor && n.corretorUid !== negFiltros.corretor) return false;
    if (busca && !buscaDe(n).includes(busca)) return false;
    return true;
  });
  const pill = (grupo, key, label, ativo, cor) => `<button class="neg-pill" data-grupo="${grupo}" data-key="${key}" style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:14px;cursor:pointer;border:1px solid ${ativo ? cor : 'var(--border)'};background:${ativo ? cor + '1f' : 'var(--surface)'};color:${ativo ? cor : 'var(--text-muted)'}">${label}</button>`;
  const corretores = veTudo ? [...new Map(negocios.filter(n => n.corretorUid).map(n => [n.corretorUid, n.corretorNome || n.corretorUid])).entries()] : [];
  const temFiltro = negFiltros.tipo || negFiltros.status || negFiltros.corretor || negFiltros.busca;
  const filtros = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:12px 16px;margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
    <input id="negBusca" type="search" placeholder="Pesquisar por código, cliente, imóvel, corretor..." value="${escapeHtml(negFiltros.busca)}"
      style="flex:1;min-width:220px;font-size:12px;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--text-primary)">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Tipo</span>
      ${pill('tipo', 'locacao', 'Locação', negFiltros.tipo === 'locacao', '#6366f1')}
      ${pill('tipo', 'venda', 'Venda', negFiltros.tipo === 'venda', '#16a34a')}</div>
    <select id="negFStatus" style="font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-primary)">
      <option value="">Status: todos</option>
      ${NEG_STATUS.map(s => `<option value="${s.key}"${negFiltros.status === s.key ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
    ${corretores.length ? `<select id="negFCorretor" style="font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-primary)">
      <option value="">Corretor: todos</option>
      ${corretores.map(([uid, nome]) => `<option value="${escapeHtml(uid)}"${negFiltros.corretor === uid ? ' selected' : ''}>${escapeHtml(nome)}</option>`).join('')}</select>` : ''}
    ${temFiltro ? '<button id="negLimpar" style="font-size:11px;font-weight:600;color:#DC1C2E;background:none;border:none;cursor:pointer">Limpar filtros</button>' : ''}
  </div>`;

  const th = t => `<th style="text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap">${t}</th>`;
  const td = (c, extra) => `<td style="font-size:12px;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle;${extra || ''}">${c}</td>`;
  const barra = pct => `<div style="display:flex;align-items:center;gap:6px;min-width:110px">
    <div style="flex:1;height:6px;border-radius:3px;background:var(--hover);overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:3px;background:${pct >= 100 ? '#16a34a' : '#0ea5e9'}"></div></div>
    <span style="font-size:10px;font-weight:700;color:var(--text-muted)">${pct}%</span></div>`;
  const linhas = lista.map(n => `<tr>
    ${td(`<strong style="white-space:nowrap">${escapeHtml(n.codigo || '—')}</strong>`)}
    ${td(escapeHtml(n.clienteNome || '—'))}
    ${td(`<div style="font-weight:600">${escapeHtml(n.imovelResumo || '—')}</div><div style="font-size:11px;color:var(--text-muted)">${n.imovelProtocolo != null ? '#SH-' + String(n.imovelProtocolo).padStart(4, '0') : ''}${n.cidade ? ' · ' + escapeHtml(n.cidade) : ''}</div>`)}
    ${td(badgeMini(n.tipo === 'venda' ? 'Venda' : 'Locação', n.tipo === 'venda' ? '#16a34a' : '#6366f1'))}
    ${td(badgeMini(negStatusLabel(n.status), negStatusCor(n.status)))}
    ${td(`<span style="font-size:11px">${escapeHtml(n.proximaAcao || '—')}</span>`)}
    ${td(escapeHtml(n.corretorNome || '—'))}
    ${td(barra(negProgresso(n)))}
    ${td(`<span style="color:var(--text-muted);white-space:nowrap">${tempoRelativo(n.atualizadoEm)}</span>`)}
    ${td(`<button class="neg-gerenciar topbar-btn" data-id="${escapeHtml(n.id)}" style="font-size:11px;padding:4px 12px">Gerenciar</button>`)}
  </tr>`).join('');

  const tabela = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)">
      <div><strong style="font-size:13px">Negócios</strong>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${lista.length} de ${negocios.length}</span></div>
      <span style="font-size:11px;color:var(--text-muted)">Negócios nascem na Carteira → Detalhes do Imóvel → ⚡ Gerar Negócio</span></div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:980px">
      <thead><tr>${['Código', 'Cliente', 'Imóvel', 'Tipo', 'Status', 'Próxima Ação', 'Corretor', 'Progresso', 'Atualização', 'Ações'].map(th).join('')}</tr></thead>
      <tbody>${linhas || `<tr><td colspan="10" style="font-size:12px;color:var(--text-muted);text-align:center;padding:32px 16px;line-height:1.6">
        ${negocios.length ? 'Nenhum negócio com esses filtros.' : 'Nenhum negócio ainda.<br><span style="font-size:11px">Todo negócio nasce de um imóvel: abra o imóvel na Carteira, aprove um interessado e clique em <strong>⚡ Gerar Negócio</strong>.</span>'}
      </td></tr>`}</tbody>
    </table></div></div>`;

  secaoImoveis.innerHTML = indicadores + filtros + tabela;

  // Wiring 04A
  secaoImoveis.querySelectorAll('.neg-pill').forEach(b => b.addEventListener('click', () => {
    negFiltros[b.dataset.grupo] = (negFiltros[b.dataset.grupo] === b.dataset.key) ? null : b.dataset.key;
    renderTela04A();
  }));
  document.getElementById('negFStatus')?.addEventListener('change', ev => { negFiltros.status = ev.target.value || null; renderTela04A(); });
  document.getElementById('negFCorretor')?.addEventListener('change', ev => { negFiltros.corretor = ev.target.value || null; renderTela04A(); });
  document.getElementById('negLimpar')?.addEventListener('click', () => { negFiltros = { tipo: null, status: null, corretor: null, busca: '' }; renderTela04A(); });
  const busca2 = document.getElementById('negBusca');
  if (busca2) busca2.addEventListener('input', () => {
    clearTimeout(busca2._t);
    busca2._t = setTimeout(() => {
      negFiltros.busca = busca2.value;
      renderTela04A();
      const b2 = document.getElementById('negBusca');
      if (b2) { b2.focus(); b2.setSelectionRange(b2.value.length, b2.value.length); }
    }, 220);
  });
  secaoImoveis.querySelectorAll('.neg-gerenciar').forEach(b => b.addEventListener('click', () => abrirTela04B(b.dataset.id)));
}

// ── Tela 04B — Gerenciar Negócio ──
async function abrirTela04B(id) {
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando o negócio...</p>';
  try {
    const res = await negocioObterFn({ negocioId: id });
    renderTela04B(res.data || {});
  } catch (e) {
    secaoImoveis.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao carregar: ${escapeHtml(e.message)}<br>
      <button id="negVoltarErr" class="topbar-btn" style="margin-top:10px;font-size:12px">← Voltar aos Negócios</button></div>`;
    document.getElementById('negVoltarErr')?.addEventListener('click', carregarNegocios);
  }
}

function renderTela04B(d) {
  const n = d.negocio || {};
  const ehGestorNeg = !!d.ehGestor;
  const podeComentar = !!d.podeComentar;
  const encerrado = ['concluido', 'cancelado'].includes(n.status);
  const pct = negProgresso(n);
  const fmtDt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  const resumoItem = (r, v) => `<div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${r}</div><div style="font-size:13px;font-weight:600;margin-top:3px">${v || '—'}</div></div>`;
  const cardStyle = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px 18px';

  // Checklist operacional (área principal). Etapas obrigatórias travam o Entregar.
  const checklist = (n.checklist || []).map(x => `
    <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:5px;cursor:${encerrado ? 'default' : 'pointer'};background:${x.feito ? '#16a34a0d' : 'var(--surface)'}">
      <input type="checkbox" class="n4b-chk" data-key="${escapeHtml(x.key)}"${x.feito ? ' checked' : ''}${encerrado ? ' disabled' : ''} style="width:15px;height:15px;margin-top:2px;flex-shrink:0;cursor:pointer">
      <span style="flex:1">
        <span style="font-size:12px;font-weight:600;color:${x.feito ? 'var(--text-muted)' : 'var(--text-primary)'};${x.feito ? 'text-decoration:line-through' : ''}">${escapeHtml(x.label)}</span>
        ${x.obrigatoria ? '<span style="font-size:9px;font-weight:700;color:#b45309;background:#b4530918;border:1px solid #b4530940;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle">obrigatória</span>' : ''}
        ${x.feito ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">✓ ${escapeHtml(x.feitoPor || '')} · ${fmtDt(x.feitoEm)}</div>` : ''}
      </span>
    </label>`).join('');

  // Painel lateral: status, próxima ação, progresso, Drive, ações do broker.
  const statusSel = ehGestorNeg && !encerrado && n.status !== 'entregue_gestao'
    ? `<select id="n4bStatus" style="${_selStyle};width:100%">
        ${NEG_STATUS.filter(s => ['em_andamento', 'aguardando_broker', 'aguardando_corretor', 'aguardando_administrativo'].includes(s.key) || s.key === n.status).map(s =>
          `<option value="${s.key}"${s.key === n.status ? ' selected' : ''}${['negocio_criado', 'entregue_gestao', 'concluido', 'cancelado'].includes(s.key) ? ' disabled' : ''}>${s.label}</option>`).join('')}</select>`
    : badgeMini(negStatusLabel(n.status), negStatusCor(n.status));
  const driveBox = `<div style="display:flex;gap:5px;margin-top:4px">
      <input id="n4bDrive" placeholder="https://drive.google.com/..." value="${escapeHtml(n.driveUrl || '')}"${encerrado ? ' disabled' : ''} style="${_selStyle};flex:1;min-width:0">
      ${encerrado ? '' : '<button id="n4bDriveSalvar" class="topbar-btn" style="font-size:11px;padding:4px 10px">Salvar</button>'}</div>
    ${/^https?:\/\//i.test(n.driveUrl || '') ? `<a href="${escapeHtml(n.driveUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#0ea5e9">Abrir pasta ↗</a>` : '<span style="font-size:10px;color:var(--text-muted)">Cole o link da pasta do negócio no Drive.</span>'}`;
  const acoesBroker = !ehGestorNeg || encerrado ? '' : `
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
      ${n.status !== 'entregue_gestao' ? '<button id="n4bEntregar" style="font-size:12px;font-weight:700;padding:9px 12px;border:none;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer">📦 Entregar para Gestão</button>' : ''}
      <button id="n4bConcluir" style="font-size:12px;font-weight:600;padding:8px 12px;border:1px solid #16a34a;border-radius:8px;background:var(--surface);color:#16a34a;cursor:pointer">✓ Concluir negócio</button>
      <button id="n4bCancelar" style="font-size:12px;font-weight:600;padding:8px 12px;border:1px solid #DC1C2E;border-radius:8px;background:var(--surface);color:#DC1C2E;cursor:pointer">✕ Cancelar negócio</button>
    </div>`;

  // Abas: Comentários (exclusivos broker+corretor responsável) e Histórico
  const comentarios = podeComentar ? `
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <input id="n4bComTexto" placeholder="Comentário interno (só broker + corretor responsável veem)" style="${_selStyle};flex:1">
      <button id="n4bComEnviar" style="font-size:11px;font-weight:600;padding:6px 14px;border:none;border-radius:8px;background:#002749;color:#fff;cursor:pointer">Enviar</button></div>
    ${(n.comentarios || []).slice().reverse().map(c => `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(c.porNome || '')} · ${fmtDt(c.em)}</div>
      <div style="font-size:12px;margin-top:2px;white-space:pre-wrap">${escapeHtml(c.texto || '')}</div></div>`).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhum comentário ainda.</p>'}`
    : '<p style="font-size:12px;color:var(--text-muted)">Comentários internos são exclusivos do broker e do corretor responsável.</p>';
  const historico = (n.timeline || []).slice().reverse().map(h => `
    <div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--text-muted);white-space:nowrap;min-width:112px">${fmtDt(h.em)}</span>
      <span style="flex:1">${escapeHtml(h.texto || '')}</span>
      <span style="color:var(--text-muted);white-space:nowrap">${escapeHtml(h.porNome || '')}</span></div>`).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nada registrado.</p>';

  // Aba Status: resumo operacional (spec 04B pede a aba Status além de Comentários/Histórico)
  const feitas = (n.checklist || []).filter(x => x.feito).length;
  const totalEtapasChk = (n.checklist || []).length;
  const stItem = (r, v) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${r}</div><div style="font-size:13px;font-weight:600;margin-top:3px">${v}</div></div>`;
  const statusResumo = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 24px">
    ${stItem('Status atual', badgeMini(negStatusLabel(n.status), negStatusCor(n.status)))}
    ${stItem('Próxima ação', escapeHtml(n.proximaAcao || '—'))}
    ${stItem('Progresso', `${pct}% · ${feitas}/${totalEtapasChk} etapas concluídas`)}
    ${stItem('Corretor responsável', escapeHtml(n.corretorNome || '—'))}
    ${stItem('Broker responsável', escapeHtml(n.brokerNome || '—'))}
    ${stItem('Tipo', n.tipo === 'venda' ? 'Venda' : 'Locação')}
  </div>`;

  secaoImoveis.innerHTML = `<div id="tela04b" data-id="${escapeHtml(n.id || '')}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <button id="n4bVoltar" class="topbar-btn" style="font-size:12px;padding:6px 12px">← Negócios</button>
      <strong style="font-size:15px">Gerenciar Negócio</strong>
      <span style="font-size:12px;font-weight:700;color:var(--text-muted);background:var(--hover);border:1px solid var(--border);padding:3px 10px;border-radius:6px">${escapeHtml(n.codigo || '')}</span>
      ${badgeMini(n.tipo === 'venda' ? 'Venda' : 'Locação', n.tipo === 'venda' ? '#16a34a' : '#6366f1')}
      ${badgeMini(negStatusLabel(n.status), negStatusCor(n.status))}
    </div>
    <div style="${cardStyle};margin-bottom:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 18px">
      ${resumoItem('Código', escapeHtml(n.codigo || ''))}
      ${resumoItem('Cliente', escapeHtml(n.clienteNome || ''))}
      ${resumoItem('Imóvel', escapeHtml(n.imovelResumo || '') + (n.imovelProtocolo != null ? ` <span style="color:var(--text-muted)">#SH-${String(n.imovelProtocolo).padStart(4, '0')}</span>` : ''))}
      ${resumoItem('Corretor responsável', escapeHtml(n.corretorNome || ''))}
      ${resumoItem('Broker responsável', escapeHtml(n.brokerNome || ''))}
      ${resumoItem('Criado em', fmtDt(n.criadoEm))}
      ${resumoItem('Última atualização', fmtDt(n.atualizadoEm))}
    </div>
    <div style="display:grid;grid-template-columns:1fr 290px;gap:12px;align-items:start">
      <div style="${cardStyle}">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Checklist Operacional · ${n.tipo === 'venda' ? 'Venda' : 'Locação'}</div>
        ${checklist || '<p style="font-size:12px;color:var(--text-muted)">Sem checklist.</p>'}
      </div>
      <div style="${cardStyle}">
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Status</div><div style="margin-top:4px">${statusSel}</div></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Próxima ação</div><div style="font-size:12px;font-weight:600;margin-top:3px">${escapeHtml(n.proximaAcao || '—')}</div></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Progresso</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
              <div style="flex:1;height:8px;border-radius:4px;background:var(--hover);overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:4px;background:${pct >= 100 ? '#16a34a' : '#0ea5e9'}"></div></div>
              <strong style="font-size:12px">${pct}%</strong></div></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Google Drive</div>${driveBox}</div>
          ${acoesBroker}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:4px;margin-top:12px">
      <button class="n4b-aba" data-aba="status" style="font-size:12px;font-weight:600;padding:7px 16px;border:1px solid #002749;border-bottom:none;border-radius:8px 8px 0 0;background:#002749;color:#fff;cursor:pointer">Status</button>
      <button class="n4b-aba" data-aba="comentarios" style="font-size:12px;font-weight:600;padding:7px 16px;border:1px solid var(--border);border-bottom:none;border-radius:8px 8px 0 0;background:var(--surface);color:var(--text-muted);cursor:pointer">Comentários${podeComentar && (n.comentarios || []).length ? ` (${n.comentarios.length})` : ''}</button>
      <button class="n4b-aba" data-aba="historico" style="font-size:12px;font-weight:600;padding:7px 16px;border:1px solid var(--border);border-bottom:none;border-radius:8px 8px 0 0;background:var(--surface);color:var(--text-muted);cursor:pointer">Histórico</button>
    </div>
    <div class="n4b-pane" data-pane="status" style="${cardStyle};border-top-left-radius:0">${statusResumo}</div>
    <div class="n4b-pane" data-pane="comentarios" style="${cardStyle};border-top-left-radius:0" hidden>${comentarios}</div>
    <div class="n4b-pane" data-pane="historico" style="${cardStyle};border-top-left-radius:0" hidden>${historico}</div>
  </div>`;

  wireTela04B(d);
}

function wireTela04B(d) {
  const n = d.negocio || {};
  const id = n.id;
  const $ = s => document.getElementById(s);
  const aplicar = async (payload, msgOk) => {
    // O re-render redesenha a tela toda — preserva o comentário em digitação e a
    // aba ativa (marcar um ✓ do checklist apagava o texto e voltava pra Comentários).
    const comTexto = payload.acao !== 'comentario' ? ($('n4bComTexto')?.value || '') : '';
    const abaAtiva = document.querySelector('.n4b-pane:not([hidden])')?.dataset.pane || 'status';
    try {
      const r = await negocioAtualizarFn({ negocioId: id, ...payload });
      if (msgOk) cartToast(msgOk);
      renderTela04B(r.data || {});
      if (comTexto && $('n4bComTexto')) $('n4bComTexto').value = comTexto;
      // Restaura a aba ativa SEMPRE (a tela renderiza em "status"; sem restaurar
      // "comentarios" o usuário era jogado de volta pra Status e o texto sumia numa aba escondida).
      if (abaAtiva !== 'status') document.querySelector(`.n4b-aba[data-aba="${abaAtiva}"]`)?.click();
    } catch (e) { alert('Erro: ' + e.message); abrirTela04B(id); }
  };

  $('n4bVoltar')?.addEventListener('click', carregarNegocios);
  document.querySelectorAll('.n4b-aba').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.n4b-aba').forEach(x => {
      const ativo = x === b;
      x.style.background = ativo ? '#002749' : 'var(--surface)';
      x.style.color = ativo ? '#fff' : 'var(--text-muted)';
      x.style.borderColor = ativo ? '#002749' : 'var(--border)';
    });
    document.querySelectorAll('.n4b-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.aba; });
  }));
  document.querySelectorAll('.n4b-chk').forEach(c => c.addEventListener('change', () => {
    c.disabled = true;
    aplicar({ acao: 'checklist', key: c.dataset.key, feito: c.checked });
  }));
  $('n4bStatus')?.addEventListener('change', ev => { ev.target.disabled = true; aplicar({ acao: 'status', status: ev.target.value }, 'Status atualizado'); });
  $('n4bDriveSalvar')?.addEventListener('click', () => aplicar({ acao: 'drive', url: $('n4bDrive')?.value.trim() || '' }, 'Drive atualizado'));
  $('n4bComEnviar')?.addEventListener('click', () => {
    const texto = $('n4bComTexto')?.value.trim();
    if (!texto) return;
    aplicar({ acao: 'comentario', texto }, 'Comentário enviado');
  });
  $('n4bComTexto')?.addEventListener('keydown', ev => { if (ev.key === 'Enter') $('n4bComEnviar')?.click(); });
  $('n4bEntregar')?.addEventListener('click', () => {
    if (!confirm('Entregar este negócio para a Gestão?\n\nSó é possível com todas as etapas obrigatórias concluídas.')) return;
    aplicar({ acao: 'entregar' }, 'Negócio entregue para Gestão');
  });
  $('n4bConcluir')?.addEventListener('click', () => {
    if (!confirm('Concluir este negócio? Ele não aceita mais alterações depois.')) return;
    aplicar({ acao: 'concluir' }, 'Negócio concluído');
  });
  $('n4bCancelar')?.addEventListener('click', () => {
    const motivo = prompt2Cancelar();
    if (motivo === null) return;
    aplicar({ acao: 'cancelar', motivo }, 'Negócio cancelado');
  });
}

// prompt() não roda em janela do Electron — mini-dialog pro motivo do cancelamento.
function prompt2Cancelar() {
  const ok = confirm('Cancelar este negócio?\n\nO imóvel volta pra Disponível e o interessado volta pra Aprovado.');
  return ok ? '' : null;
}

// ─── Tela 05 — Relatórios ─────────────────────────────────────────────────────
// Indicadores operacionais + pipeline + produção por corretor + atenção, com
// exportação CSV / Excel / PDF. Tudo agregado no cliente em cima do que o
// negocioListar e o locListarImoveis já devolvem (posse: broker tudo, corretor
// só o dele) — sem backend novo.
let relFiltros = { periodo: '30d', ini: '', fim: '', tipo: null, status: null, corretor: null };
let _relCache = null;

function relJanela() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const p = relFiltros.periodo;
  if (p === 'hoje') return { ini: hoje, fim: null };
  if (p === '7d')   return { ini: new Date(hoje.getTime() - 7 * 86400000), fim: null };
  if (p === '30d')  return { ini: new Date(hoje.getTime() - 30 * 86400000), fim: null };
  if (p === 'mes')  return { ini: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: null };
  if (p === 'custom') {
    const ini = relFiltros.ini ? new Date(relFiltros.ini + 'T00:00:00') : null;
    const fim = relFiltros.fim ? new Date(relFiltros.fim + 'T23:59:59') : null;
    return { ini, fim };
  }
  return { ini: null, fim: null };   // 'tudo'
}
const relNoPeriodo = (iso, j) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (j.ini && t < j.ini.getTime()) return false;
  if (j.fim && t > j.fim.getTime()) return false;
  return true;
};

async function carregarRelatorio() {
  secaoImoveis.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Montando o relatório...</p>';
  try {
    const [nRes, iRes] = await Promise.all([negocioListarFn({}), locListarImoveis({})]);
    _relCache = {
      negocios: nRes.data?.negocios || [],
      imoveis: (iRes.data?.imoveis || []).filter(im => !im.arquivado),
      veTudo: !!nRes.data?.veTudo,
    };
    renderTela05();
  } catch (e) {
    secaoImoveis.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Erro ao montar o relatório: ${escapeHtml(e.message)}</p>`;
  }
}

// Negócios filtrados (período + tipo + status + corretor) — base de tudo na tela.
function relNegociosFiltrados() {
  const j = relJanela();
  const semJanela = !j.ini && !j.fim;
  return (_relCache?.negocios || []).filter(n => {
    if (!semJanela && !relNoPeriodo(n.criadoEm, j)) return false;
    if (relFiltros.tipo && n.tipo !== relFiltros.tipo) return false;
    if (relFiltros.status && n.status !== relFiltros.status) return false;
    if (relFiltros.corretor && n.corretorUid !== relFiltros.corretor) return false;
    return true;
  });
}

function renderTela05() {
  if (!_relCache) return;
  const { negocios, imoveis, veTudo } = _relCache;
  const j = relJanela();
  const semJanela = !j.ini && !j.fim;
  const negs = relNegociosFiltrados();
  const imoveisPeriodo = imoveis.filter(im => (semJanela || relNoPeriodo(im.criadoEm, j)) &&
    (!relFiltros.corretor || im.corretorUid === relFiltros.corretor));
  const ativos = negocios.filter(n => !['concluido', 'cancelado'].includes(n.status));

  const cardStyle = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card)';
  const card = (num, label, cor) => `<div style="${cardStyle};padding:12px 14px;min-width:120px;flex:1">
    <div style="font-size:22px;font-weight:700;color:${cor}">${num}</div>
    <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${label}</div></div>`;
  const titulo = (t, sub) => `<div style="margin:18px 0 8px"><span style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${t}</span>${sub ? `<span style="font-size:11px;color:var(--text-muted);margin-left:8px">${sub}</span>` : ''}</div>`;

  // Cabeçalho: período + exports
  const pill = (key, label) => `<button class="rel-periodo" data-p="${key}" style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:14px;cursor:pointer;border:1px solid ${relFiltros.periodo === key ? '#002749' : 'var(--border)'};background:${relFiltros.periodo === key ? '#00274912' : 'var(--surface)'};color:${relFiltros.periodo === key ? '#002749' : 'var(--text-muted)'}">${label}</button>`;
  const exportBtn = (id, label) => `<button id="${id}" style="font-size:11px;font-weight:600;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-primary);cursor:pointer">${label}</button>`;
  const corretores = veTudo ? [...new Map(negocios.filter(n => n.corretorUid).map(n => [n.corretorUid, n.corretorNome || n.corretorUid])).entries()] : [];
  const cab = `<div style="${cardStyle};padding:12px 16px;margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
    <div style="display:flex;gap:5px;flex-wrap:wrap">${pill('hoje', 'Hoje')}${pill('7d', '7 dias')}${pill('30d', '30 dias')}${pill('mes', 'Este mês')}${pill('tudo', 'Tudo')}${pill('custom', 'Personalizado')}</div>
    ${relFiltros.periodo === 'custom' ? `<div style="display:flex;gap:5px;align-items:center">
      <input id="relIni" type="date" value="${escapeHtml(relFiltros.ini)}" style="${_selStyle}">
      <span style="font-size:11px;color:var(--text-muted)">até</span>
      <input id="relFim" type="date" value="${escapeHtml(relFiltros.fim)}" style="${_selStyle}"></div>` : ''}
    <select id="relTipo" style="${_selStyle}">
      <option value="">Tipo: todos</option>
      <option value="locacao"${relFiltros.tipo === 'locacao' ? ' selected' : ''}>Locação</option>
      <option value="venda"${relFiltros.tipo === 'venda' ? ' selected' : ''}>Venda</option></select>
    <select id="relStatus" style="${_selStyle}">
      <option value="">Status: todos</option>
      ${NEG_STATUS.map(s => `<option value="${s.key}"${relFiltros.status === s.key ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
    ${corretores.length ? `<select id="relCorretor" style="${_selStyle}">
      <option value="">Corretor: todos</option>
      ${corretores.map(([uid, nome]) => `<option value="${escapeHtml(uid)}"${relFiltros.corretor === uid ? ' selected' : ''}>${escapeHtml(nome)}</option>`).join('')}</select>` : ''}
    <span style="flex:1"></span>
    ${exportBtn('relCsv', '⬇ CSV')}${exportBtn('relXls', '⬇ Excel')}${exportBtn('relPdf', '🖨 PDF')}
  </div>`;

  // Cards
  const cards = `<div style="display:flex;gap:8px;flex-wrap:wrap">
    ${card(imoveisPeriodo.length, semJanela ? 'Imóveis na carteira' : 'Imóveis cadastrados', '#0ea5e9')}
    ${card(ativos.filter(n => !relFiltros.corretor || n.corretorUid === relFiltros.corretor).length, 'Negócios ativos (hoje)', '#6366f1')}
    ${card(negs.filter(n => n.tipo === 'locacao').length, 'Locações', '#6366f1')}
    ${card(negs.filter(n => n.tipo === 'venda').length, 'Vendas', '#16a34a')}
    ${card(negs.filter(n => n.status === 'entregue_gestao').length, 'Entregues p/ Gestão', '#15803d')}
    ${card(negs.filter(n => n.status === 'concluido').length, 'Concluídos', '#6b7280')}
  </div>`;

  // Pipeline (chips) + barras por status
  const porStatus = {};
  negs.forEach(n => { porStatus[n.status] = (porStatus[n.status] || 0) + 1; });
  const maxSt = Math.max(1, ...Object.values(porStatus));
  const pipeline = `<div style="display:flex;gap:8px;flex-wrap:wrap">${NEG_STATUS.map(s => `
    <div style="${cardStyle};padding:10px 14px;text-align:center;min-width:96px;flex:1">
      <div style="font-size:19px;font-weight:700;color:${(porStatus[s.key] || 0) ? s.cor : 'var(--text-muted)'}">${porStatus[s.key] || 0}</div>
      <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-top:2px">${s.label}</div></div>`).join('')}</div>`;
  const barras = `<div style="${cardStyle};padding:14px 16px">${NEG_STATUS.map(s => {
    const n = porStatus[s.key] || 0;
    return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0">
      <span style="font-size:11px;min-width:180px;color:var(--text-primary)">${s.label}</span>
      <div style="flex:1;height:8px;border-radius:4px;background:var(--hover);overflow:hidden"><div style="width:${Math.round((n / maxSt) * 100)}%;height:100%;border-radius:4px;background:${s.cor}"></div></div>
      <strong style="font-size:12px;min-width:24px;text-align:right">${n}</strong></div>`;
  }).join('')}</div>`;

  // Produção por corretor (broker vê todos; corretor vê a própria linha)
  const th = t => `<th style="text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap">${t}</th>`;
  const td = (c, extra) => `<td style="font-size:12px;padding:8px 10px;border-bottom:1px solid var(--border);${extra || ''}">${c}</td>`;
  const porCorretor = new Map();
  const linhaDe = (uid, nome) => { if (!porCorretor.has(uid)) porCorretor.set(uid, { nome, imoveis: 0, negocios: 0, locacoes: 0, vendas: 0, pendencias: 0 }); return porCorretor.get(uid); };
  imoveisPeriodo.forEach(im => {
    const l = linhaDe(im.corretorUid || '?', im.corretorNome || '—');
    l.imoveis++;
    if ((im.pendentes || []).length) l.pendencias++;
  });
  negs.forEach(n => {
    const l = linhaDe(n.corretorUid || '?', n.corretorNome || '—');
    l.negocios++;
    if (n.tipo === 'venda') l.vendas++; else l.locacoes++;
  });
  const producao = `<div style="${cardStyle};overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:560px">
    <thead><tr>${['Corretor', 'Imóveis', 'Negócios', 'Locações', 'Vendas', 'Pendências'].map(th).join('')}</tr></thead>
    <tbody>${[...porCorretor.values()].sort((a, b) => b.negocios - a.negocios || b.imoveis - a.imoveis).map(l => `<tr>
      ${td(`<strong>${escapeHtml(l.nome)}</strong>`)}${td(l.imoveis, 'text-align:center')}${td(l.negocios, 'text-align:center')}${td(l.locacoes, 'text-align:center')}${td(l.vendas, 'text-align:center')}${td(l.pendencias ? `<span style="color:#DC1C2E;font-weight:700">${l.pendencias}</span>` : '0', 'text-align:center')}
    </tr>`).join('') || '<tr><td colspan="6" style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px">Nada no período.</td></tr>'}</tbody>
  </table></div></div>`;

  // Negócios que precisam de atenção (abertos, mais parados primeiro)
  const agora = Date.now();
  const atencao = negs
    .filter(n => !['concluido', 'cancelado', 'entregue_gestao'].includes(n.status))
    .map(n => ({ ...n, diasParado: Math.max(0, Math.floor((agora - new Date(n.atualizadoEm || n.criadoEm || 0).getTime()) / 86400000)) }))
    .sort((a, b) => b.diasParado - a.diasParado)
    .slice(0, 10);
  const atencaoTbl = `<div style="${cardStyle};overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:720px">
    <thead><tr>${['Código', 'Cliente', 'Próxima Ação', 'Parado há', 'Status', ''].map(th).join('')}</tr></thead>
    <tbody>${atencao.map(n => `<tr>
      ${td(`<strong style="white-space:nowrap">${escapeHtml(n.codigo || '')}</strong>`)}
      ${td(escapeHtml(n.clienteNome || ''))}
      ${td(`<span style="font-size:11px">${escapeHtml(n.proximaAcao || '—')}</span>`)}
      ${td(n.diasParado >= 3 ? `<span style="color:#DC1C2E;font-weight:700">${n.diasParado} dias</span>` : (n.diasParado === 0 ? 'Hoje' : n.diasParado + ' dia' + (n.diasParado > 1 ? 's' : '')), 'text-align:center;white-space:nowrap')}
      ${td(badgeMini(negStatusLabel(n.status), negStatusCor(n.status)))}
      ${td(`<button class="rel-abrir topbar-btn" data-id="${escapeHtml(n.id)}" style="font-size:11px;padding:4px 12px">Abrir</button>`)}
    </tr>`).join('') || '<tr><td colspan="6" style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px">Nenhum negócio em aberto no período. 🎉</td></tr>'}</tbody>
  </table></div></div>`;

  secaoImoveis.innerHTML = `<div id="tela05">
    ${cab}${cards}
    ${titulo('Pipeline de Negócios', 'status geral no período filtrado')}${pipeline}
    ${titulo('Negócios por Status')}${barras}
    ${titulo('Produção por Corretor')}${producao}
    ${titulo('Negócios que Precisam de Atenção')}${atencaoTbl}
  </div>`;

  wireTela05();
}

function wireTela05() {
  secaoImoveis.querySelectorAll('.rel-periodo').forEach(b => b.addEventListener('click', () => { relFiltros.periodo = b.dataset.p; renderTela05(); }));
  document.getElementById('relIni')?.addEventListener('change', ev => { relFiltros.ini = ev.target.value; renderTela05(); });
  document.getElementById('relFim')?.addEventListener('change', ev => { relFiltros.fim = ev.target.value; renderTela05(); });
  document.getElementById('relTipo')?.addEventListener('change', ev => { relFiltros.tipo = ev.target.value || null; renderTela05(); });
  document.getElementById('relStatus')?.addEventListener('change', ev => { relFiltros.status = ev.target.value || null; renderTela05(); });
  document.getElementById('relCorretor')?.addEventListener('change', ev => { relFiltros.corretor = ev.target.value || null; renderTela05(); });
  secaoImoveis.querySelectorAll('.rel-abrir').forEach(b => b.addEventListener('click', () => {
    negAbrirDireto = b.dataset.id;
    locSub = 'negocios'; renderCentro();
  }));
  document.getElementById('relCsv')?.addEventListener('click', () => relExportar('csv'));
  document.getElementById('relXls')?.addEventListener('click', () => relExportar('xls'));
  document.getElementById('relPdf')?.addEventListener('click', relImprimirPdf);
}

// Linhas de exportação = os negócios filtrados na tela.
function relLinhasExport() {
  const cab = ['Código', 'Cliente', 'Imóvel', 'Cidade', 'Tipo', 'Status', 'Próxima Ação', 'Corretor', 'Broker', 'Progresso %', 'Criado em', 'Atualizado em'];
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
  const linhas = relNegociosFiltrados().map(n => [
    n.codigo || '', n.clienteNome || '', n.imovelResumo || '', n.cidade || '',
    n.tipo === 'venda' ? 'Venda' : 'Locação', negStatusLabel(n.status), n.proximaAcao || '',
    n.corretorNome || '', n.brokerNome || '', String(negProgresso(n)), fmtD(n.criadoEm), fmtD(n.atualizadoEm),
  ]);
  return { cab, linhas };
}

function relBaixar(nome, mime, conteudo) {
  const blob = new Blob([conteudo], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function relExportar(formato) {
  const { cab, linhas } = relLinhasExport();
  const stamp = new Date().toISOString().slice(0, 10);
  if (formato === 'csv') {
    const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(esc).join(';')).join('\r\n');
    relBaixar(`relatorio-negocios-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
  } else {
    // "Excel": tabela HTML com mime do Excel — abre direto no Excel/LibreOffice.
    const escH = v => escapeHtml(String(v));
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1">
      <tr>${cab.map(c => `<th>${escH(c)}</th>`).join('')}</tr>
      ${linhas.map(l => `<tr>${l.map(v => `<td>${escH(v)}</td>`).join('')}</tr>`).join('')}
    </table></body></html>`;
    relBaixar(`relatorio-negocios-${stamp}.xls`, 'application/vnd.ms-excel', html);
  }
  cartToast('Relatório exportado');
}

// PDF = versão imprimível num iframe invisível + diálogo de impressão do sistema
// (a pessoa escolhe "Salvar como PDF"). Funciona igual no .exe e no navegador.
function relImprimirPdf() {
  const { cab, linhas } = relLinhasExport();
  const negs = relNegociosFiltrados();
  const porStatus = {};
  negs.forEach(n => { porStatus[n.status] = (porStatus[n.status] || 0) + 1; });
  const escH = v => escapeHtml(String(v));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Negócios</title>
    <style>body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0}
    .sub{color:#666;font-size:11px;margin:4px 0 16px}table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;font-size:10px}th{background:#f3f3f3}
    .chips{margin:10px 0}.chip{display:inline-block;border:1px solid #ccc;border-radius:4px;padding:3px 8px;margin:2px;font-size:10px}</style></head><body>
    <h1>REMAX Smart Hub — Relatório de Negócios</h1>
    <div class="sub">Gerado em ${new Date().toLocaleString('pt-BR')} · ${negs.length} negócio(s) no filtro</div>
    <div class="chips">${NEG_STATUS.map(s => `<span class="chip">${s.label}: <strong>${porStatus[s.key] || 0}</strong></span>`).join('')}</div>
    <table><tr>${cab.map(c => `<th>${escH(c)}</th>`).join('')}</tr>
    ${linhas.map(l => `<tr>${l.map(v => `<td>${escH(v)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
  document.getElementById('relPdfFrame')?.remove();   // clique repetido não enfileira prints
  const frame = document.createElement('iframe');
  frame.id = 'relPdfFrame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    finally { setTimeout(() => frame.remove(), 60000); }
  };
}

// Liga os eventos da Carteira depois de cada render.
function wireCarteira() {
  const $$ = sel => secaoImoveis.querySelectorAll(sel);
  $$('.cart-copiar').forEach(b => b.addEventListener('click', () => cartCopiarLink(b.dataset.arquivo)));
  $$('.cart-abrir').forEach(b => b.addEventListener('click', () => abrirTela03(b.dataset.id, 'informacoes')));
  $$('.cart-pill').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.grupo, k = b.dataset.key;
    cartFiltros[g] = (cartFiltros[g] === k) ? null : k;   // clicar de novo desliga
    renderCarteira();
  }));
  const fc = document.getElementById('cartFCorretor');
  if (fc) fc.addEventListener('change', () => { cartFiltros.corretor = fc.value || null; renderCarteira(); });
  const lim = document.getElementById('cartLimpar');
  if (lim) lim.addEventListener('click', () => { cartFiltros = { fin: null, sit: null, corretor: null, busca: '' }; renderCarteira(); });
  const busca = document.getElementById('cartBusca');
  if (busca) {
    // Incremental com debounce curto; re-render preservando o foco no campo
    busca.addEventListener('input', () => {
      clearTimeout(busca._t);
      busca._t = setTimeout(() => {
        cartFiltros.busca = busca.value;
        renderCarteira();
        const b2 = document.getElementById('cartBusca');
        if (b2) { b2.focus(); b2.setSelectionRange(b2.value.length, b2.value.length); }
      }, 220);
    });
  }
  const novo = document.getElementById('cartNovo');
  if (novo) novo.addEventListener('click', () => cartAbrirModal(null));

}

// Datalists de Tipo/Cidade (configuradas no Admin → SMART HUB). Cache com TTL de
// 5 min: por sessão inteira, o admin salvava uma cidade nova e o corretor só via
// depois de reiniciar o app ("a config não pegou").
let _shListas = null;
let _shListasAt = 0;
async function _shListasAplicar(dlg) {
  try {
    if (!_shListas || Date.now() - _shListasAt > 300000) {
      const r = await configObterFn({});
      _shListas = { tipos: r.data?.tipos_imovel || [], cidades: r.data?.cidades || [] };
      _shListasAt = Date.now();
    }
    const liga = (inputId, listId, itens) => {
      if (!itens.length) return;
      const inp = dlg.querySelector('#' + inputId);
      if (!inp) return;
      let dl = document.getElementById(listId);
      if (!dl) { dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl); }
      dl.innerHTML = itens.map(v => `<option value="${escapeHtml(v)}">`).join('');
      inp.setAttribute('list', listId);
    };
    liga('cfTipo', 'shListaTipos', _shListas.tipos);
    liga('cfCidade', 'shListaCidades', _shListas.cidades);
  } catch (_e) { /* sem config → texto livre, sem erro na tela */ }
}

// ─── Modal Novo Imóvel / Editar (dialog único, criado sob demanda) ────────────
function cartAbrirModal(im) {
  let dlg = document.getElementById('dlgCartImovel');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'dlgCartImovel';
    dlg.setAttribute('style', 'border:1px solid var(--border);border-radius:12px;padding:0;background:var(--surface);color:var(--text-primary);max-width:560px;width:92vw');
    document.body.appendChild(dlg);
  }
  const e = im?.endereco || {};
  const campo = (id, label, valor, ph, req) => `<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--text-muted)">${label}${req ? ' *' : ''}
    <input id="${id}" value="${escapeHtml(valor || '')}" placeholder="${ph || ''}" style="font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--text-primary)"></label>`;

  // Escolha inicial (só na criação): Enviar Ficha (fluxo principal) × Cadastro Manual
  const escolha = im ? '' : `<div id="cartEscolha" style="display:flex;gap:10px;padding:18px 20px">
      <button id="cartOpFicha" style="flex:1;padding:16px 12px;border:1px solid var(--border);border-radius:10px;background:var(--hover);cursor:pointer;text-align:left">
        <div style="font-size:14px;font-weight:700">📄 Enviar Ficha</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Fluxo principal: copie o link, o cliente preenche e o imóvel entra sozinho.</div></button>
      <button id="cartOpManual" style="flex:1;padding:16px 12px;border:1px solid var(--border);border-radius:10px;background:var(--hover);cursor:pointer;text-align:left">
        <div style="font-size:14px;font-weight:700">✍ Cadastro Manual</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Casos excepcionais, sem ficha do cliente.</div></button>
    </div>
    <div id="cartFichasLinks" hidden style="padding:0 20px 18px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Copie o link da ficha e mande pro cliente:</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${CARTEIRA_FICHAS.map(f => `<button class="cart-copiar-dlg" data-arquivo="${f.arquivo}" style="font-size:11px;font-weight:600;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);cursor:pointer">${f.label} · Copiar</button>`).join('')}</div>
    </div>`;

  dlg.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">
      <strong style="font-size:15px">${im ? 'Editar imóvel' : 'Novo Imóvel'}</strong>
      <button id="cartDlgFechar" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--text-muted)">✕</button></div>
    ${escolha}
    <form id="cartForm" ${im ? '' : 'hidden'} style="padding:16px 20px;display:flex;flex-direction:column;gap:10px" onsubmit="return false">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--text-muted)">Finalidade *
        <select id="cfFin" style="font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--text-primary)">
          ${CART_FINALIDADES.map(f => `<option value="${f.key}"${im && cartFinalidadeDe(im) === f.key ? ' selected' : ''}>${f.label}</option>`).join('')}</select></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${campo('cfProp', 'Proprietário', im?.proprietarioNome || im?.locadorNome, 'Nome completo', true)}
        ${campo('cfContato', 'Contato do proprietário', im?.proprietarioContato, 'Telefone/e-mail')}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
        ${campo('cfLog', 'Endereço', e.logradouro, 'Rua, Avenida...', true)}
        ${campo('cfNum', 'Número', e.numero)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        ${campo('cfCompl', 'Complemento', e.complemento, 'Ap 12')}
        ${campo('cfBairro', 'Bairro', e.bairro)}
        ${campo('cfCep', 'CEP', e.cep, '00000-000')}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px">
        ${campo('cfCidade', 'Cidade', e.cidade, '', true)}
        ${campo('cfUf', 'UF', e.estado, 'SP')}
        ${campo('cfTipo', 'Tipo', im?.tipo, 'Apartamento')}</div>
      ${campo('cfValor', 'Valor de anúncio', im?.valorAnuncio, 'R$')}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button id="cartDlgCancelar" type="button" style="font-size:12px;font-weight:600;padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-muted);cursor:pointer">Cancelar</button>
        <button id="cartDlgSalvar" type="button" style="font-size:12px;font-weight:600;padding:8px 18px;border:none;border-radius:8px;background:#002749;color:#fff;cursor:pointer">${im ? 'Salvar alterações' : 'Criar imóvel'}</button></div>
    </form>`;

  // Sugestões de Tipo/Cidade vindas do Admin (SMART HUB — configs). Lazy + cache;
  // se a config não existir ou falhar, o campo segue como texto livre.
  _shListasAplicar(dlg);

  const fechar = () => dlg.close();
  dlg.querySelector('#cartDlgFechar').addEventListener('click', fechar);
  dlg.querySelector('#cartDlgCancelar')?.addEventListener('click', fechar);
  dlg.querySelector('#cartOpManual')?.addEventListener('click', () => {
    dlg.querySelector('#cartEscolha').hidden = true;
    dlg.querySelector('#cartForm').hidden = false;
  });
  dlg.querySelector('#cartOpFicha')?.addEventListener('click', () => {
    dlg.querySelector('#cartFichasLinks').hidden = false;
  });
  dlg.querySelectorAll('.cart-copiar-dlg').forEach(b => b.addEventListener('click', () => cartCopiarLink(b.dataset.arquivo)));
  dlg.querySelector('#cartDlgSalvar').addEventListener('click', async () => {
    const v = id => dlg.querySelector('#' + id)?.value.trim() || '';
    const payload = {
      ...(im ? { imovelId: im.id } : {}),
      finalidade: dlg.querySelector('#cfFin').value,
      proprietarioNome: v('cfProp'), proprietarioContato: v('cfContato'),
      tipo: v('cfTipo'), valorAnuncio: v('cfValor'),
      endereco: { logradouro: v('cfLog'), numero: v('cfNum'), complemento: v('cfCompl'), bairro: v('cfBairro'), cidade: v('cfCidade'), estado: v('cfUf').toUpperCase(), cep: v('cfCep') }
    };
    if (!payload.proprietarioNome || !payload.endereco.logradouro || !payload.endereco.cidade) {
      alert('Preencha os campos obrigatórios: proprietário, endereço e cidade.'); return;
    }
    const btn = dlg.querySelector('#cartDlgSalvar');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      await carteiraSalvarImovel(payload);
      dlg.close();
      cartToast(im ? 'Imóvel atualizado' : 'Imóvel criado');
      // Editando de dentro da Tela 03, volta pra ela; criando pelo Dashboard,
      // recarrega o Dashboard (antes renderizava a Carteira numa seção oculta e
      // os cards do Painel ficavam com os números velhos); senão, a lista.
      if (im && tela03Atual === im.id) abrirTela03(im.id);
      else if (locSub === 'painel') carregarPainel();
      else carregarImoveis();
    } catch (e2) {
      alert('Erro ao salvar: ' + e2.message);
      btn.disabled = false; btn.textContent = im ? 'Salvar alterações' : 'Criar imóvel';
    }
  });
  dlg.showModal();
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
// Painel = Tela 01 (Dashboard da spec): saudação, cards, ações rápidas, "o que
// precisa da sua atenção", últimas atividades e resumo da operação. Broker vê
// geral; corretor só o dele. O bloco financeiro antigo (gestor) fica no rodapé.
async function carregarPainel() {
  secaoPainel.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0">Carregando painel...</p>';
  try {
    const [dRes, finRes, aRes] = await Promise.all([
      dashboardDadosFn({}),
      locDashboard({}).catch(() => ({ data: null })),
      locListarAlertas({}).catch(() => ({ data: { alertas: [] } })),
    ]);
    const d = dRes.data || {};
    const fin = finRes.data;
    const alertas = aRes.data?.alertas || [];

    // Saudação por hora + data por extenso
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const nome = (document.getElementById('usuarioInfo')?.textContent?.trim() || '').split(' ')[0] || '';
    const dataExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

    const cardStyle = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card)';
    const card = (num, label, cor) => `<div style="${cardStyle};padding:14px 16px;min-width:130px;flex:1">
      <div style="font-size:24px;font-weight:700;color:${cor || 'var(--text-primary)'}">${num}</div>
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${label}</div></div>`;
    const titulo = t => `<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px">${t}</div>`;

    // Ações rápidas
    const acao = (ic, txt, id) => `<button class="painel-acao" data-acao="${id}" style="flex:1;min-width:150px;display:flex;align-items:center;gap:10px;padding:12px 14px;text-align:left;cursor:pointer;${cardStyle}">
      <span style="font-size:19px">${ic}</span><span style="font-size:13px;font-weight:600;color:var(--text-primary)">${txt}</span></button>`;
    const acoes = `<div style="display:flex;gap:8px;flex-wrap:wrap">
      ${acao('📄', 'Novo Imóvel · Enviar Ficha', 'novo')}
      ${acao('🏠', 'Carteira de Imóveis', 'imoveis')}
      ${acao('💼', 'Negócios', 'negocios')}</div>`;

    // O que precisa da sua atenção (negócios parados)
    const th = t => `<th style="text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap">${t}</th>`;
    const td = (c, extra) => `<td style="font-size:12px;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle;${extra || ''}">${c}</td>`;
    const diasBadge = dias => dias >= 3
      ? `<span style="font-size:10px;font-weight:700;color:#DC1C2E;background:#DC1C2E14;border:1px solid #DC1C2E40;padding:2px 8px;border-radius:10px;white-space:nowrap">${dias} dia${dias > 1 ? 's' : ''} parado</span>`
      : `<span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${dias === 0 ? 'Hoje' : dias + ' dia' + (dias > 1 ? 's' : '')}</span>`;
    const atencaoLinhas = (d.atencao || []).map(n => `<tr>
      ${td(`<strong style="white-space:nowrap">${escapeHtml(n.codigo || '')}</strong>`)}
      ${td(escapeHtml(n.cliente || ''))}
      ${td(`<span style="font-size:11px">${escapeHtml(n.proximaAcao || '—')}</span>`)}
      ${td(escapeHtml(n.responsavel || '—'))}
      ${td(diasBadge(n.diasParado), 'text-align:center')}
      ${td(badgeMini(negStatusLabel(n.status), negStatusCor(n.status)))}
      ${td(`<button class="painel-gerenciar topbar-btn" data-id="${escapeHtml(n.id)}" style="font-size:11px;padding:4px 12px">Gerenciar</button>`)}
    </tr>`).join('');
    const atencaoBloco = `<div style="${cardStyle};overflow:hidden">
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:720px">
        <thead><tr>${['Código', 'Cliente', 'Próxima Ação', 'Responsável', 'Parado há', 'Status', ''].map(th).join('')}</tr></thead>
        <tbody>${atencaoLinhas || '<tr><td colspan="7" style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px">Nenhum negócio precisando de atenção. 🎉</td></tr>'}</tbody>
      </table></div></div>`;

    // Últimas atividades
    const fmtHora = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const atividades = (d.atividades || []).map(a => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--text-muted);white-space:nowrap;min-width:88px">${fmtHora(a.em)}</span>
      <span style="flex:1">${escapeHtml(a.texto || '')}${a.ref ? ` <span style="color:var(--text-muted)">· ${escapeHtml(a.ref)}</span>` : ''}</span></div>`).join('')
      || '<p style="font-size:12px;color:var(--text-muted)">Nada ainda.</p>';

    // Resumo da operação (negócios por status)
    const resumoOp = NEG_STATUS.map(s => {
      const n = (d.porStatus || {})[s.key] || 0;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px">${s.label}</span><strong style="font-size:13px;color:${n ? s.cor : 'var(--text-muted)'}">${n}</strong></div>`;
    }).join('');

    // Blocos herdados (gestor): alertas da locação + visão financeira
    const contagem = {};
    alertas.filter(a => !a.tratado).forEach(a => { contagem[a.tipo] = (contagem[a.tipo] || 0) + 1; });
    const alertaPills = Object.entries(contagem).filter(([, n]) => n).map(([tipo, n]) => {
      const [ic, lbl, cor, bg, bd] = ALERTA_INFO[tipo] || ['•', tipo, 'var(--text-muted)', 'var(--surface)', 'var(--border)'];
      return `<div style="background:${bg};border:1px solid ${bd};color:${cor};border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600">${ic} ${n} ${lbl}</div>`;
    }).join('');
    const alertaBloco = alertaPills ? titulo('Alertas da Locação') + `<div style="display:flex;gap:8px;flex-wrap:wrap">${alertaPills}</div>` : '';
    let finBloco = '';
    if (fin && d.veTudo) {
      const fmt = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      finBloco = titulo('Financeiro da Locação (gestão)') +
        `<div style="display:flex;gap:8px;flex-wrap:wrap">${card(fin.contratosAtivos || 0, 'Contratos ativos', '#16a34a')}${card(fmt(fin.inadimplencia?.valor), 'Inadimplência', '#DC1C2E')}${card(fmt(fin.repassePendente?.valor), 'A repassar', '#b45309')}${card(fmt(fin.repassadoMes), 'Repassado no mês', '#0ea5e9')}</div>`;
    }

    secaoPainel.innerHTML = `
      <div style="margin-bottom:14px">
        <div style="font-size:19px;font-weight:700">${saud}${nome ? ', ' + escapeHtml(nome) : ''}!</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Bem-vindo ao SMART HUB. Hoje é ${dataExtenso}.${d.veTudo ? '' : ' Você está vendo apenas os seus números.'}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${card(d.imoveisTotal || 0, 'Imóveis', '#0ea5e9')}
        ${card(d.negociosAtivos || 0, 'Negócios Ativos', '#6366f1')}
        ${card(d.pendencias || 0, 'Pendências', '#DC1C2E')}
        ${card(d.entregues || 0, 'Entregues p/ Gestão', '#16a34a')}
      </div>
      ${titulo('Ações rápidas')}${acoes}
      ${titulo('O que precisa da sua atenção')}${atencaoBloco}
      <div style="display:grid;grid-template-columns:1fr 260px;gap:12px;align-items:start;margin-top:4px">
        <div>${titulo('Últimas atividades')}<div style="${cardStyle};padding:12px 16px">${atividades}</div></div>
        <div>${titulo('Resumo da operação')}<div style="${cardStyle};padding:12px 16px">${resumoOp}</div></div>
      </div>
      ${alertaBloco}
      ${finBloco}`;

    // Wiring
    secaoPainel.querySelectorAll('.painel-acao').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.acao;
      if (a === 'novo') { cartAbrirModal(null); return; }
      locSub = a; renderCentro();
    }));
    secaoPainel.querySelectorAll('.painel-gerenciar').forEach(b => b.addEventListener('click', () => {
      negAbrirDireto = b.dataset.id;
      locSub = 'negocios'; renderCentro();
    }));
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
// ═══ Recrutamento de corretores (só gestor) ══════════════════════════════════
const REC_ETAPAS = [
  ['primeiro_contato', 'Primeiro contato'], ['reuniao_agendada', 'Reunião agendada'],
  ['reuniao_realizada', 'Reunião realizada'], ['acompanhamento', 'Acompanhamento'],
  ['associado', 'Corretor associado'], ['nao_associado', 'Corretor não associado']
];
const REC_ETAPA_LABEL = Object.fromEntries(REC_ETAPAS);
// Chaves antigas → novas (defesa; o backend já normaliza na leitura).
const REC_ETAPA_LEGADO = { sem_contato: 'primeiro_contato', contato_realizado: 'acompanhamento', desassociado: 'nao_associado' };
const recEtapa = e => REC_ETAPA_LEGADO[e] || (REC_ETAPA_LABEL[e] ? e : 'primeiro_contato');
let recLista = [];
let recView = 'lista';   // 'lista' | 'detalhe'
let recCand = null;      // candidato aberto (completo) no detalhe
let recFiltroEtapa = '', recBusca = '', recFiltroTag = '', recFiltroStatus = '', recWired = false;

const recEsc = s => escapeHtml(String(s == null ? '' : s));
// Valida CPF pelo dígito verificador (mesma regra do backend) — aviso ao vivo.
function _recCpfValido(cpf) {
  const s = String(cpf || '').replace(/\D/g, '');
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let soma = 0; for (let i = 0; i < 9; i++) soma += parseInt(s[i], 10) * (10 - i);
  let d1 = (soma * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9], 10)) return false;
  soma = 0; for (let i = 0; i < 10; i++) soma += parseInt(s[i], 10) * (11 - i);
  let d2 = (soma * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10], 10);
}
function recData(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (_) { return '—'; } }
function recDataHora(ms) { if (!ms) return ''; try { return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
function recToast(msg, erro) {
  let t = document.getElementById('recToast');
  if (!t) { t = document.createElement('div'); t.id = 'recToast'; document.body.appendChild(t); }
  t.className = 'rec-toast' + (erro ? ' erro' : ''); t.textContent = msg; t.style.opacity = '1';
  clearTimeout(window.__recToast); window.__recToast = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

// Modal simples de "Adicionar candidato" manual (só o básico; RG/CPF/banco vêm do formulário).
function recAbrirNovoModal() {
  const inp = (id, ph) => '<input class="rec-input" id="recn_' + id + '" placeholder="' + (ph || '') + '">';
  const html = '<div class="rec-modal-bg" data-rec="modal-bg"><div class="rec-modal">'
    + '<div class="rec-modal-head"><span>Adicionar candidato</span><button class="rec-modal-x" data-rec="modal-fechar" title="Fechar">×</button></div>'
    + '<div class="rec-linha2"><div class="rec-campo"><label>Nome do candidato *</label>' + inp('nome', 'Nome completo') + '</div>'
    + '<div class="rec-campo"><label>E-mail</label>' + inp('email') + '</div></div>'
    + '<div class="rec-linha2"><div class="rec-campo"><label>Celular / WhatsApp *</label>' + inp('telefone', '(00) 00000-0000') + '</div>'
    + '<div class="rec-campo"><label>Celular / WhatsApp 2</label>' + inp('telefone2') + '</div></div>'
    + '<div class="rec-linha2"><div class="rec-campo"><label>Perfil</label>' + inp('perfil') + '</div>'
    + '<div class="rec-campo"><label>Origem</label>' + inp('fonte', 'Ex.: Indicação, Instagram…') + '</div></div>'
    + '<div style="text-align:right;margin-top:10px"><button class="rec-btn primary" data-rec="novo-salvar">Adicionar</button></div>'
    + '</div></div>';
  secaoRecrutamento.insertAdjacentHTML('beforeend', html);
  const f = document.getElementById('recn_nome'); if (f) f.focus();
}

async function carregarRecrutamento() {
  if (!recWired) { recWireEvents(); recWired = true; }
  // O tempo real pode recarregar no meio da digitação da busca — guarda foco/cursor pra devolver.
  const buscaFocada = document.activeElement && document.activeElement.id === 'recBusca';
  const pos = buscaFocada ? document.activeElement.selectionStart : 0;
  if (!buscaFocada) secaoRecrutamento.innerHTML = '<div class="rec-msg">Carregando candidatos…</div>';
  try {
    const r = await recrutamentoListar();
    recLista = ((r && r.data && r.data.itens) || []).map(c => ({ ...c, etapa: recEtapa(c.etapa) }));
  } catch (e) {
    secaoRecrutamento.innerHTML = '<div class="rec-msg rec-erro">Não foi possível carregar os candidatos.<br><span class="rec-dim">' + recEsc(e && e.message) + '</span></div>';
    return;
  }
  recView = 'lista'; recCand = null; recRender();
  if (buscaFocada) {
    const b = document.getElementById('recBusca');
    if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (_) { /* ok */ } }
  }
}

function recRender() {
  secaoRecrutamento.innerHTML = (recView === 'detalhe') ? recDetalheHtml() : recListaHtml();
}

function recLinhasHtml() {
  const termo = recBusca.trim().toLowerCase();
  const filtrada = recLista.filter(c =>
    (!recFiltroEtapa || c.etapa === recFiltroEtapa) &&
    (!recFiltroStatus || (c.status || 'ativo') === recFiltroStatus) &&
    (!recFiltroTag || (c.tags || []).includes(recFiltroTag)) &&
    (!termo || (c.nome || '').toLowerCase().includes(termo)));
  if (!filtrada.length) return '<div class="rec-msg rec-dim">Nenhum candidato' + (recFiltroEtapa || recFiltroTag || recFiltroStatus || termo ? ' com esses filtros.' : ' ainda.') + '</div>';
  return filtrada.map(c => {
    const inativo = (c.status || 'ativo') === 'inativo';
    return '<div class="rec-linha" data-rec="abrir" data-id="' + recEsc(c.id) + '">'
    + '<div class="rec-linha-main"><div class="rec-nome">' + recEsc(c.nome || '—')
    + '<span class="rec-status rec-status-' + (inativo ? 'inativo' : 'ativo') + '">' + (inativo ? 'Inativo' : 'Ativo') + '</span></div>'
    + '<div class="rec-sub">' + recData(c.atualizadoEm) + (c.origem === 'formulario' ? ' · <span class="rec-dim">do formulário</span>' : '')
    + (c.cpfValido === false ? ' · <span class="rec-cpf-flag">⚠ CPF inválido</span>' : '')
    + ((c.tags && c.tags.length) ? ' · ' + c.tags.map(t => '<span class="rec-tag">' + recEsc(t) + '</span>').join(' ') : '') + '</div></div>'
    + '<span class="rec-badge rec-badge-' + recEsc(c.etapa) + '">' + (REC_ETAPA_LABEL[c.etapa] || c.etapa) + '</span>'
    + '<span class="rec-btn sm">Ver detalhes</span></div>';
  }).join('');
}

function recListaHtml() {
  const cont = {}; REC_ETAPAS.forEach(([k]) => cont[k] = 0);
  recLista.forEach(c => { if (cont[c.etapa] != null) cont[c.etapa]++; });
  const nInativos = recLista.filter(c => (c.status || 'ativo') === 'inativo').length;
  const semFiltro = !recFiltroEtapa && !recFiltroStatus;
  const tags = [...new Set(recLista.flatMap(c => c.tags || []))].sort();
  const tile = (cls, attrs, n, rot) => '<button class="rec-etapa' + cls + '" ' + attrs + '><span class="rec-etapa-n">' + n + '</span><span class="rec-etapa-r">' + rot + '</span></button>';
  const funil =
    tile(semFiltro ? ' on' : '', 'data-rec="todos"', recLista.length, 'Todos')
    + REC_ETAPAS.map(([k, rot]) => tile(recFiltroEtapa === k ? ' on' : '', 'data-rec="etapa" data-k="' + k + '"', cont[k], rot)).join('')
    + tile(recFiltroStatus === 'inativo' ? ' on' : '', 'data-rec="inativos"', nInativos, 'Inativos');
  const filtros = '<div class="rec-filtros">'
    + '<input type="text" class="rec-input" id="recBusca" placeholder="Buscar por nome…" value="' + recEsc(recBusca) + '">'
    + '<select class="rec-input rec-sel" id="recTag"><option value="">Todas as tags</option>' + tags.map(t => '<option value="' + recEsc(t) + '"' + (recFiltroTag === t ? ' selected' : '') + '>' + recEsc(t) + '</option>').join('') + '</select>'
    + (recFiltroEtapa ? '<button class="rec-btn ghost" data-rec="limpar-etapa">Etapa: ' + REC_ETAPA_LABEL[recFiltroEtapa] + ' ✕</button>' : '')
    + (recFiltroStatus === 'inativo' ? '<button class="rec-btn ghost" data-rec="limpar-status">Status: Inativos ✕</button>' : '')
    + '</div>';
  return '<div class="rec-wrap">'
    + '<div class="rec-head"><div><h2 class="rec-titulo">Recrutamento de corretores</h2>'
    + '<div class="rec-dim">' + recLista.length + ' candidato(s) — só o gestor vê esta área</div></div>'
    + '<button class="rec-btn primary" data-rec="novo">+ Adicionar candidato</button></div>'
    + '<div class="rec-funil">' + funil + '</div>' + filtros
    + '<div class="rec-lista">' + recLinhasHtml() + '</div></div>';
}

function recDetalheHtml() {
  const c = recCand || {};
  const novo = !c.id;
  const inp = (id, ph) => '<input class="rec-input" id="rec_' + id + '" value="' + recEsc(c[id]) + '" placeholder="' + (ph || '') + '">';
  const ta = (id) => '<textarea class="rec-input rec-ta" id="rec_' + id + '">' + recEsc(c[id]) + '</textarea>';
  const simnao = (id) => '<select class="rec-input rec-sel" id="rec_' + id + '"><option value="sim"' + (c[id] ? ' selected' : '') + '>Sim</option><option value="nao"' + (c[id] ? '' : ' selected') + '>Não</option></select>';
  const campo = (lab, html) => '<div class="rec-campo"><label>' + lab + '</label>' + html + '</div>';
  const statusSel = '<select class="rec-input rec-sel" id="rec_status"><option value="ativo"' + ((c.status || 'ativo') === 'ativo' ? ' selected' : '') + '>Ativo</option><option value="inativo"' + (c.status === 'inativo' ? ' selected' : '') + '>Inativo</option></select>';
  const hist = (c.historico || []).slice().sort((a, b) => (b.em || 0) - (a.em || 0)).map(h =>
    '<div class="rec-hist"><div class="rec-hist-top"><b>' + recEsc(h.porNome || '—') + '</b><span class="rec-dim">' + recDataHora(h.em) + '</span></div><div>' + recEsc(h.texto) + '</div></div>'
  ).join('') || '<div class="rec-dim" style="padding:6px 0">Sem histórico ainda.</div>';

  return '<div class="rec-wrap">'
    + '<div class="rec-head"><button class="rec-btn ghost" data-rec="voltar">← Voltar</button>'
    + '<div class="rec-acoes">' + (novo ? '' : '<button class="rec-btn danger" data-rec="excluir">Excluir</button>') + '<button class="rec-btn primary" data-rec="salvar">Salvar</button></div></div>'
    + '<h2 class="rec-titulo">' + (novo ? 'Novo candidato' : recEsc(c.nome || 'Candidato')) + '</h2>'
    + '<div class="rec-cols">'
    // Coluna esquerda: dados
    + '<div class="rec-card"><div class="rec-card-t">Dados do candidato</div>'
    + campo('Nome', inp('nome', 'Nome completo')) + campo('E-mail', inp('email'))
    + '<div class="rec-linha2">' + campo('Telefone', inp('telefone')) + campo('Telefone 2', inp('telefone2')) + '</div>'
    + campo('Origem', inp('fonte', 'Ex.: Indicação, Instagram…'))
    + '<div class="rec-linha2">' + campo('RG', inp('rg'))
    + '<div class="rec-campo"><label>CPF</label>' + inp('cpf')
    + '<div class="rec-cpf-aviso' + ((c.cpf && c.cpfValido === false) ? ' erro' : '') + '" id="rec_cpf_aviso">' + ((c.cpf && c.cpfValido === false) ? '⚠ CPF inválido (confira os números)' : '') + '</div></div></div>'
    + campo('Endereço', inp('endereco'))
    + campo('Dados bancários (comissões)', inp('dadosBancarios'))
    + '<div class="rec-linha2">' + campo('Experiência imobiliária?', simnao('expImobiliaria')) + campo('Experiência em vendas?', simnao('expVendas')) + '</div>'
    // As descrições só aparecem quando a resposta é "Sim" (toggle no change dos selects).
    + '<div class="rec-campo" id="rec_wrap_expImobiliariaDesc"' + (c.expImobiliaria ? '' : ' hidden') + '><label>Descreva a experiência imobiliária</label>' + ta('expImobiliariaDesc') + '</div>'
    + '<div class="rec-campo" id="rec_wrap_expVendasDesc"' + (c.expVendas ? '' : ' hidden') + '><label>Descreva a experiência em vendas</label>' + ta('expVendasDesc') + '</div>'
    + campo('Maior sonho', ta('maiorSonho'))
    + campo('O que achou do modelo REMAX', ta('opiniaoRemax'))
    + campo('Clube desejado', inp('clubeDesejado')) + '</div>'
    // Coluna direita: funil + histórico
    + '<div class="rec-card"><div class="rec-card-t">Funil e qualificação</div>'
    + (novo
        ? campo('Etapa', '<div class="rec-dim" style="padding:4px 0">Começa em “Sem contato”. Salve para mover no funil.</div>')
        : '<div class="rec-fases-wrap"><label class="rec-fases-lab">Etapa do funil <span class="rec-dim">— clique para mover</span></label>' + recFasesHtml(c.etapa) + '</div>')
    + campo('Status', statusSel)
    + '<div class="rec-linha2">' + campo('Perfil', inp('perfil')) + campo('Nota', inp('nota')) + '</div>'
    + campo('Tags (separadas por vírgula)', inp('tags'))
    + '<div class="rec-card-t" style="margin-top:14px">Histórico</div>'
    + (novo ? '<div class="rec-dim" style="padding:6px 0">Salve o candidato para registrar histórico.</div>'
      : '<div class="rec-add-hist"><input class="rec-input" id="rec_novoHist" placeholder="Registrar uma ação (ligação, reunião…)"><button class="rec-btn sm" data-rec="add-hist">Adicionar</button></div><div class="rec-hists">' + hist + '</div>')
    + '</div></div></div>';
}

// Funil clicável dentro da ficha: destaca a fase atual, marca as anteriores como
// concluídas; clicar move o candidato na hora (handler 'fase').
function recFasesHtml(atual) {
  const cur = REC_ETAPAS.findIndex(([k]) => k === recEtapa(atual));
  return '<div class="rec-fases">' + REC_ETAPAS.map(([k, rot], i) => {
    let cls = 'rec-fase';
    if (i < cur) cls += ' done';
    if (i === cur) cls += ' on';
    return '<button type="button" class="' + cls + '" data-rec="fase" data-k="' + k + '" title="Mover para: ' + recEsc(rot) + '">'
      + '<span class="rec-fase-dot"></span><span class="rec-fase-r">' + rot + '</span></button>';
  }).join('') + '</div>';
}

// Lê a ficha aberta num payload (SEM a etapa — a etapa só muda pelo funil clicável,
// então "Salvar" nunca mexe na fase e mover de fase não perde o que foi digitado).
function recColetarPayload() {
  const val = id => { const x = document.getElementById('rec_' + id); return x ? x.value : ''; };
  const payload = {
    nome: val('nome'), email: val('email'), telefone: val('telefone'), telefone2: val('telefone2'), fonte: val('fonte'), rg: val('rg'), cpf: val('cpf'),
    endereco: val('endereco'), dadosBancarios: val('dadosBancarios'),
    expImobiliaria: val('expImobiliaria') === 'sim', expImobiliariaDesc: val('expImobiliariaDesc'),
    expVendas: val('expVendas') === 'sim', expVendasDesc: val('expVendasDesc'),
    maiorSonho: val('maiorSonho'), opiniaoRemax: val('opiniaoRemax'), clubeDesejado: val('clubeDesejado'),
    status: val('status'), perfil: val('perfil'), nota: val('nota'),
    tags: val('tags').split(',').map(t => t.trim()).filter(Boolean)
  };
  if (recCand && recCand.id) payload.id = recCand.id;
  return payload;
}

function recWireEvents() {
  secaoRecrutamento.addEventListener('input', e => {
    if (e.target.id === 'recBusca') { recBusca = e.target.value; const el = secaoRecrutamento.querySelector('.rec-lista'); if (el) el.innerHTML = recLinhasHtml(); }
    if (e.target.id === 'rec_cpf') {
      const av = document.getElementById('rec_cpf_aviso'); if (!av) return;
      const v = e.target.value.trim();
      if (!v) { av.textContent = ''; av.className = 'rec-cpf-aviso'; }
      else if (_recCpfValido(v)) { av.textContent = '✓ CPF válido'; av.className = 'rec-cpf-aviso ok'; }
      else { av.textContent = '⚠ CPF inválido (confira os números)'; av.className = 'rec-cpf-aviso erro'; }
    }
  });
  secaoRecrutamento.addEventListener('change', e => {
    if (e.target.id === 'recTag') { recFiltroTag = e.target.value; const el = secaoRecrutamento.querySelector('.rec-lista'); if (el) el.innerHTML = recLinhasHtml(); }
    // Descrição da experiência só visível quando "Sim".
    if (e.target.id === 'rec_expImobiliaria') { const w = document.getElementById('rec_wrap_expImobiliariaDesc'); if (w) w.hidden = e.target.value !== 'sim'; }
    if (e.target.id === 'rec_expVendas') { const w = document.getElementById('rec_wrap_expVendasDesc'); if (w) w.hidden = e.target.value !== 'sim'; }
  });
  secaoRecrutamento.addEventListener('click', async e => {
    const el = e.target.closest('[data-rec]'); if (!el) return;
    const a = el.dataset.rec;
    if (a === 'etapa') { const k = el.dataset.k; recFiltroEtapa = (recFiltroEtapa === k) ? '' : k; recFiltroStatus = ''; recRender(); return; }
    if (a === 'todos') { recFiltroEtapa = ''; recFiltroStatus = ''; recRender(); return; }
    if (a === 'inativos') { recFiltroStatus = (recFiltroStatus === 'inativo') ? '' : 'inativo'; recFiltroEtapa = ''; recRender(); return; }
    if (a === 'limpar-etapa') { recFiltroEtapa = ''; recRender(); return; }
    if (a === 'limpar-status') { recFiltroStatus = ''; recRender(); return; }
    if (a === 'novo') { recAbrirNovoModal(); return; }
    if (a === 'modal-fechar') { const bg = secaoRecrutamento.querySelector('.rec-modal-bg'); if (bg) bg.remove(); return; }
    if (a === 'modal-bg') { if (e.target === el) el.remove(); return; }
    if (a === 'novo-salvar') {
      const v = id => { const x = document.getElementById('recn_' + id); return x ? x.value.trim() : ''; };
      const nome = v('nome'), telefone = v('telefone');
      if (!nome) { recToast('Informe o nome.', true); return; }
      if (!telefone) { recToast('Informe o celular/WhatsApp.', true); return; }
      el.disabled = true;
      try {
        await recrutamentoSalvar({ nome, email: v('email'), telefone, telefone2: v('telefone2'), perfil: v('perfil'), fonte: v('fonte') });
        recToast('Candidato adicionado'); carregarRecrutamento();
      } catch (err) { recToast('Erro: ' + (err && err.message), true); el.disabled = false; }
      return;
    }
    if (a === 'voltar') { carregarRecrutamento(); return; }
    if (a === 'abrir') {
      const id = el.dataset.id;
      secaoRecrutamento.innerHTML = '<div class="rec-msg">Abrindo…</div>';
      try { const r = await recrutamentoObter({ id }); recCand = r.data.candidato; if (recCand) recCand.etapa = recEtapa(recCand.etapa); recView = 'detalhe'; recRender(); }
      catch (err) { recToast('Erro ao abrir: ' + (err && err.message), true); carregarRecrutamento(); }
      return;
    }
    // Mover de fase clicando no funil da ficha: salva na hora (leva junto o que foi
    // editado, então nada se perde) e recarrega o detalhe pra mostrar o histórico.
    if (a === 'fase') {
      const k = el.dataset.k;
      if (!recCand || !recCand.id) { recToast('Salve o candidato primeiro.', true); return; }
      if (k === (recCand.etapa || 'primeiro_contato')) return;   // já está nessa fase
      const payload = { ...recColetarPayload(), etapa: k };
      if (!String(payload.nome || '').trim()) { recToast('Informe o nome antes de mover.', true); return; }
      const fases = secaoRecrutamento.querySelectorAll('[data-rec="fase"]');
      fases.forEach(b => { b.disabled = true; });
      try {
        await recrutamentoSalvar(payload);
        recToast('Movido para “' + (REC_ETAPA_LABEL[k] || k) + '”');
        const r = await recrutamentoObter({ id: recCand.id }); recCand = r.data.candidato; if (recCand) recCand.etapa = recEtapa(recCand.etapa); recRender();
      } catch (err) { recToast('Erro ao mover: ' + (err && err.message), true); fases.forEach(b => { b.disabled = false; }); }
      return;
    }
    if (a === 'salvar') {
      const payload = recColetarPayload();
      if (!payload.nome.trim()) { recToast('Informe o nome.', true); return; }
      el.disabled = true;
      try { await recrutamentoSalvar(payload); recToast('Candidato salvo'); carregarRecrutamento(); }
      catch (err) { recToast('Erro ao salvar: ' + (err && err.message), true); el.disabled = false; }
      return;
    }
    if (a === 'add-hist') {
      const inpH = document.getElementById('rec_novoHist'); const texto = inpH ? inpH.value.trim() : '';
      if (!texto || !recCand || !recCand.id) return;
      el.disabled = true;
      try { await recrutamentoHistorico({ id: recCand.id, texto }); const r = await recrutamentoObter({ id: recCand.id }); recCand = r.data.candidato; recRender(); }
      catch (err) { recToast('Erro: ' + (err && err.message), true); el.disabled = false; }
      return;
    }
    if (a === 'excluir') {
      if (!recCand || !recCand.id) return;
      if (!confirm('Excluir este candidato? Isso apaga os dados dele (inclusive os sensíveis). Não dá pra desfazer.')) return;
      try { await recrutamentoExcluir({ id: recCand.id }); recToast('Candidato excluído'); carregarRecrutamento(); }
      catch (err) { recToast('Erro ao excluir: ' + (err && err.message), true); }
      return;
    }
  });
}

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
    },
    {
      calc: 'parceria', nome: 'Parceria e referenciamentos',
      desc: 'Divide a comissão entre indicação, captação e venda conforme o tipo de parceria REMAX.',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><path d="M24 13v9M24 22l-9 13M24 22l9 13" fill="none" stroke="#A4D7F4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="13" r="2.6" fill="#fff"/><circle cx="15" cy="35" r="2.6" fill="#fff"/><circle cx="33" cy="35" r="2.6" fill="#fff"/></svg>`
    },
    {
      calc: 'sonhos', nome: 'Calculadora dos Sonhos',
      desc: 'A partir da sua meta de comissão no ano, mostra quantas transações e atividades você precisa por ano, mês, semana e dia (benchmark REMAX).',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><path d="M14 34l7-8 5 4 8-11" fill="none" stroke="#A4D7F4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 19h5v5" fill="none" stroke="#DC1C2E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      calc: 'emolumentos', nome: 'Custo de Escritura (Emolumentos 2026)',
      desc: 'Informe o Valor Venal de Referência e veja a faixa da tabela de emolumentos do Tabelionato de Notas de SP — cada componente e o total da escritura.',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><path d="M17 13h10l6 6v16a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z" fill="none" stroke="#A4D7F4" stroke-width="2.2" stroke-linejoin="round"/><path d="M27 13v6h6" fill="none" stroke="#A4D7F4" stroke-width="2.2" stroke-linejoin="round"/><path d="M20 27h8M20 31h8" stroke="#DC1C2E" stroke-width="2" stroke-linecap="round"/></svg>`
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
      key: 'lead-assistente', nome: 'Assistente de Leads', empresa: 'REMAX Smart · Gemini',
      desc: 'Cole a mensagem que o cliente mandou no WhatsApp e receba 3 respostas prontas para copiar e enviar.',
      interno: 'lead',
      icone: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002749"/><path d="M24 12c-6.6 0-12 4.6-12 10.3 0 2.4 1 4.7 2.6 6.4L15 36l7.3-2.2c.5.1 1.1.1 1.7.1 6.6 0 12-4.6 12-10.3S30.6 12 24 12z" fill="none" stroke="#A4D7F4" stroke-width="2.2" stroke-linejoin="round"/><circle cx="19.5" cy="22.5" r="1.4" fill="#fff"/><circle cx="24" cy="22.5" r="1.4" fill="#fff"/><circle cx="28.5" cy="22.5" r="1.4" fill="#fff"/></svg>`
    },
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
        <button class="ia-card" data-key="${m.key}">
          <div class="ia-icone">${m.icone}</div>
          <div class="ia-nome">${m.nome}</div>
          <div class="ia-empresa">${m.empresa}</div>
          <p class="ia-desc">${m.desc}</p>
        </button>
      `).join('')}
    </div>`;

  secaoIA.querySelectorAll('.ia-card').forEach(card => {
    card.addEventListener('click', () => {
      const modelo = MODELOS.find(m => m.key === card.dataset.key);
      if (!modelo) return;
      // Assistente de Leads: tela interna do Hub, não abre site de fora.
      if (modelo.interno === 'lead') { renderAssistenteLead(); return; }
      if (modelo.avisoLogin) {
        const chave = `ia_login_${modelo.key}`;
        if (!localStorage.getItem(chave)) {
          alert(`💡 Para usar a ${modelo.nome} você precisa estar logado no ChatGPT.\n\nSe ainda não fez login, entre com sua conta na janela que vai abrir.`);
          localStorage.setItem(chave, '1');
        }
      }
      window.hubApi.abrirApp({ siteKey: modelo.url, url: modelo.url, credenciais: null });
    });
  });
}

// ─── Assistente de Leads (IA · Gemini · em teste) ────────────────────────────
// Tela DENTRO da aba SMART IA. Cole a mensagem do lead → o main chama o Gemini
// (chave na env GEMINI_API_KEY) e devolve 3 respostas prontas pra copiar.
function _leadEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function _leadCss() {
  if (document.getElementById('leadiaCss')) return;
  const s = document.createElement('style');
  s.id = 'leadiaCss';
  s.textContent = `
  .leadia-top{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap}
  .leadia-back{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-btn);color:var(--text-muted);font-size:13px;font-family:inherit;cursor:pointer}
  .leadia-back:hover{color:var(--text-primary);border-color:var(--blue)}
  .leadia-h{font-size:18px;font-weight:800;color:var(--text-primary)}
  .leadia-tag{margin-left:auto;display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border:1px solid var(--border);border-radius:999px;font-size:12px;color:var(--text-muted)}
  .leadia-tag .d{width:7px;height:7px;border-radius:50%;background:var(--warning)}
  .leadia-grid{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}
  .leadia-col{flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:14px}
  .leadia-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px}
  .leadia-card h3{margin:0 0 4px;font-size:14px;font-weight:700;color:var(--text-primary)}
  .leadia-card p.sub{margin:0 0 12px;font-size:12px;color:var(--text-muted)}
  .leadia-f{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
  .leadia-f:last-child{margin-bottom:0}
  .leadia-f label{font-size:12.5px;color:var(--text-muted)}
  .leadia-f textarea,.leadia-f input,.leadia-f select{width:100%;font-family:inherit;font-size:14px;color:var(--text-primary);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);outline:none}
  .leadia-f textarea{min-height:120px;resize:vertical;line-height:1.55;padding:10px 11px}
  .leadia-f input,.leadia-f select{height:42px;padding:0 11px}
  .leadia-f textarea:focus,.leadia-f input:focus,.leadia-f select:focus{border-color:var(--blue)}
  .leadia-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .leadia-acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
  .leadia-note{font-size:12px;color:var(--text-muted)}
  .leadia-btns{display:flex;gap:8px}
  .leadia-btn{height:42px;padding:0 18px;border-radius:var(--radius-btn);font-family:inherit;font-size:13.5px;font-weight:700;border:1px solid transparent;cursor:pointer}
  .leadia-btn.prim{background:var(--blue);color:#fff}
  .leadia-btn.prim:disabled{opacity:.6;cursor:default}
  .leadia-btn.ghost{background:transparent;color:var(--text-muted);border-color:var(--border)}
  .leadia-btn.ghost:hover{color:var(--text-primary)}
  .leadia-panel-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .leadia-panel-h .t{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)}
  .leadia-status{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--text-muted)}
  .leadia-status .sd{width:7px;height:7px;border-radius:50%;background:var(--text-muted)}
  .leadia-status.ok .sd{background:var(--success)}
  .leadia-empty{padding:20px;text-align:center;font-size:13px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius-input);background:var(--bg)}
  .leadia-flag{display:none;padding:10px 12px;border-radius:var(--radius-input);font-size:12.5px;line-height:1.5;margin-bottom:4px}
  .leadia-flag.show{display:block}
  .leadia-flag.err{background:rgba(200,0,26,.12);border:1px solid rgba(200,0,26,.4);color:var(--danger)}
  .leadia-flag.tip{background:var(--blue-light);border:1px solid rgba(0,82,204,.35);color:#9dc0ff}
  .leadia-resp{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:12px 13px;margin-bottom:10px}
  .leadia-resp-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
  .leadia-resp-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted)}
  .leadia-resp-tag .n{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:var(--blue-light);color:#9dc0ff;font-size:11px}
  .leadia-resp-txt{font-size:13.5px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;word-break:break-word}
  .leadia-copy{display:inline-flex;align-items:center;gap:6px;height:29px;padding:0 12px;font-size:12px;font-weight:600;font-family:inherit;background:var(--bg);border:1px solid var(--border);border-radius:999px;color:var(--text-muted);cursor:pointer}
  .leadia-copy:hover{border-color:var(--blue);color:#9dc0ff}
  .leadia-copy.done{border-color:var(--success);color:var(--success)}
  `;
  document.head.appendChild(s);
}
function _leadCopiar(texto) {
  return new Promise(resolve => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(() => resolve(true), () => resolve(_leadExec(texto)));
        return;
      }
    } catch (_) { /* cai no fallback */ }
    resolve(_leadExec(texto));
  });
}
function _leadExec(texto) {
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}
function renderAssistenteLead() {
  _leadCss();
  secaoIA.innerHTML = `
    <div class="leadia-top">
      <button type="button" class="leadia-back" id="leadVoltar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        SMART IA
      </button>
      <span class="leadia-h">Assistente de Leads</span>
      <span class="leadia-tag"><span class="d"></span>Gemini · em teste</span>
    </div>
    <div class="leadia-grid">
      <form class="leadia-col" id="leadForm" novalidate>
        <section class="leadia-card">
          <h3>Mensagem do cliente</h3>
          <p class="sub">Cole exatamente como chegou no WhatsApp.</p>
          <div class="leadia-f">
            <textarea id="leadMsg" placeholder="Ex.: Oi, vi o anúncio do apartamento no Jardim América. Ainda está disponível? Qual o valor e aceita financiamento?"></textarea>
          </div>
        </section>
        <section class="leadia-card">
          <h3>Contexto (opcional)</h3>
          <p class="sub">Ajuda a IA a personalizar — pode deixar em branco.</p>
          <div class="leadia-2">
            <div class="leadia-f"><label for="leadFin">Interesse</label>
              <select id="leadFin"><option value="">Não sei ainda</option><option>Compra</option><option>Locação</option><option>Só pesquisando</option></select></div>
            <div class="leadia-f"><label for="leadTom">Tom</label>
              <select id="leadTom"><option value="">Padrão (profissional e caloroso)</option><option>Mais formal</option><option>Mais descontraído</option></select></div>
          </div>
          <div class="leadia-f"><label for="leadImovel">Imóvel em questão</label>
            <input type="text" id="leadImovel" placeholder="Ex.: Apto 82m² no Jardim América, R$ 9.500/mês"></div>
          <div class="leadia-2">
            <div class="leadia-f"><label for="leadCanal">Origem do lead</label>
              <input type="text" id="leadCanal" placeholder="Ex.: portal, indicação, anúncio"></div>
            <div class="leadia-f"><label for="leadCorretor">Seu nome (assinatura)</label>
              <input type="text" id="leadCorretor" placeholder="Ex.: Leandro"></div>
          </div>
        </section>
        <div class="leadia-card leadia-acts">
          <p class="leadia-note">A IA não inventa dados do imóvel que você não informar.</p>
          <div class="leadia-btns">
            <button type="button" class="leadia-btn ghost" id="leadLimpar">Limpar</button>
            <button type="submit" class="leadia-btn prim" id="leadGerar">Gerar respostas</button>
          </div>
        </div>
      </form>
      <aside class="leadia-col" aria-label="Respostas sugeridas">
        <div class="leadia-panel-h">
          <span class="t">Respostas sugeridas</span>
          <span class="leadia-status" id="leadStatus"><span class="sd"></span>Aguardando</span>
        </div>
        <div class="leadia-flag" id="leadFlag"></div>
        <div id="leadSaida"><div class="leadia-empty">Cole a mensagem do cliente e clique em <b>Gerar respostas</b>. Aparecem 3 opções aqui — é só copiar e enviar.</div></div>
      </aside>
    </div>`;

  const $ = id => document.getElementById(id);
  const form = $('leadForm');
  const saida = $('leadSaida');
  const status = $('leadStatus');
  const flag = $('leadFlag');
  const btn = $('leadGerar');
  const val = id => (($(id) || {}).value || '').trim();
  const setFlag = (kind, msg) => {
    if (!msg) { flag.className = 'leadia-flag'; flag.textContent = ''; return; }
    flag.className = 'leadia-flag show ' + kind; flag.textContent = msg;
  };
  const setStatus = (cls, txt) => {
    status.className = 'leadia-status' + (cls ? ' ' + cls : '');
    status.innerHTML = '<span class="sd"></span>' + _leadEsc(txt);
  };

  const render = (respostas, dica) => {
    if (!respostas.length) { saida.innerHTML = '<div class="leadia-empty">A IA não retornou respostas. Tente reformular a mensagem.</div>'; return; }
    const copiar = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copiar';
    const copiado = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>Copiado';
    saida.innerHTML = respostas.map((r, i) => (
      '<div class="leadia-resp"><div class="leadia-resp-h"><span class="leadia-resp-tag"><span class="n">' + (i + 1) + '</span>Opção ' + (i + 1) + '</span>' +
      '<button class="leadia-copy" data-i="' + i + '">' + copiar + '</button></div>' +
      '<div class="leadia-resp-txt">' + _leadEsc(r) + '</div></div>'
    )).join('');
    if (dica) setFlag('tip', '💡 ' + dica); else setFlag('');
    saida.querySelectorAll('.leadia-copy').forEach(b => {
      b.addEventListener('click', () => {
        const t = respostas[+b.dataset.i] || '';
        const volta = () => setTimeout(() => { b.classList.remove('done'); b.innerHTML = copiar; }, 1600);
        _leadCopiar(t).then(ok => {
          if (ok) { b.classList.add('done'); b.innerHTML = copiado; }
          else { b.textContent = 'Não copiou — selecione o texto'; }
          volta();
        });
      });
    });
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const mensagem = val('leadMsg');
    setFlag('');
    if (!mensagem) { setFlag('err', 'Cole a mensagem do cliente primeiro.'); const m = $('leadMsg'); if (m) m.focus(); return; }
    const payload = { mensagem, finalidade: val('leadFin'), tom: val('leadTom'), imovel: val('leadImovel'), canal: val('leadCanal'), corretor: val('leadCorretor') };
    btn.disabled = true; setStatus('', 'Gerando…');
    saida.innerHTML = '<div class="leadia-empty">Consultando a IA…</div>';
    sugerirRespostaLead(payload)
      .then(res => {
        const r = res && res.data;
        if (!r || !r.ok) throw new Error('Falha ao gerar respostas.');
        render(r.respostas || [], r.dica || '');
        setStatus('ok', 'Pronto');
      })
      .catch(err => {
        saida.innerHTML = '<div class="leadia-empty">Sem respostas.</div>';
        setStatus('', 'Erro');
        setFlag('err', (err && err.message) || String(err));
      })
      .finally(() => { btn.disabled = false; });
  });

  $('leadLimpar').addEventListener('click', () => {
    form.reset(); setFlag(''); setStatus('', 'Aguardando');
    saida.innerHTML = '<div class="leadia-empty">Cole a mensagem do cliente e clique em <b>Gerar respostas</b>. Aparecem 3 opções aqui — é só copiar e enviar.</div>';
  });

  $('leadVoltar').addEventListener('click', () => carregarIA());
}

// ─── Documentos ──────────────────────────────────────────────────────────────
// Base das fichas POR AMBIENTE: no staging os links de ficha têm que apontar pro
// Hosting do staging — a página da ficha resolve o backend pelo hostname DELA,
// então um link de produção gravaria dado de teste na PRODUÇÃO. `.exe` (file://)
// e web.app de produção continuam caindo em produção.
const BASE_HOSTING = (typeof location !== 'undefined' && location.hostname.includes('remax-smart-hub-staging'))
  ? 'https://remax-smart-hub-staging.web.app'
  : 'https://remax-smart-hub.web.app';

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
    nome: 'Cliente PF',
    desc: 'Cadastro de cliente pessoa física',
    arquivo: 'ficha-pf.html',
    grupo: 'locacao',
    geraLink: true, temAnalise: true, temFirebase: true
  },
  {
    key: 'pj',
    nome: 'Cliente PJ',
    desc: 'Cadastro de cliente pessoa jurídica',
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
const CAD_TIPO_LABEL = { locador:'Locador', pf:'Cliente PF', pj:'Cliente PJ', locacao_fiador:'Locação com Fiador', vendedor:'Vendedor', proposta:'Proposta', fianca:'Fiança' };
const CAD_TIPO_ICO   = { locador:'👤', pf:'🧍', pj:'🏢', locacao_fiador:'🤝', vendedor:'🏷️', proposta:'📄', fianca:'🛡️' };
const CAD_CORES = ['#0052CC','#C8001A','#4ade80','#8b7cf6','#fbbf24','#0ea5e9','#ec4899'];
// Ícones dos KPIs (SVG branco, badge com cor sólida). Feather-style.
const _sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CAD_KPI_ICO = {
  todas:      _sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  pendentes:  _sv('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  enviadas:   _sv('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
  devolvidas: _sv('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
  concluidas: _sv('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
};
const cadIniciais = n => ((n||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()) || '?';
const cadCor = n => CAD_CORES[[...(n||'x')].reduce((a,c)=>a+c.charCodeAt(0),0) % CAD_CORES.length];

let cadFichas = [];   // cache normalizado de todas as fichas
let cadFiltro = { tab:'todas', busca:'', tipo:'', status:'', periodo:'30', corretor:'' };
// Filtro que o sininho pede ao abrir o Cadastro. carregarDocumentos reseta o cadFiltro
// (30 dias), então sem isto o clique na notificação perdia o tipo E o período — ficha
// com mais de 30 dias nem aparecia. carregarDocumentos consome e zera este pendente.
let cadFiltroPendente = null;
let cadErroCarga = false;   // true quando TODAS as chamadas de ficha falharam (≠ vazio)
let cadVisao  = '';   // admin: uid de um corretor pra enxergar a aba como ele ('' = visão geral)
let cadFotos  = {};   // uid -> foto de perfil (base64); quem não tem cai nas iniciais

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
  cadFiltro = cadFiltroPendente || { tab:'todas', busca:'', tipo:'', status:'', periodo:'30', corretor:'' };
  cadFiltroPendente = null;
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
    btn.addEventListener('click', async () => {
      // O "✓ Copiado!" só aparece se copiou de verdade — a promise do clipboard
      // rejeitada não era pega, e o botão mentia. Falhou? mostra o link pra copiar.
      try {
        await navigator.clipboard.writeText(btn.dataset.link);
        const t = btn.textContent; btn.textContent = '✓ Copiado!';
        setTimeout(() => { btn.textContent = t; }, 2000);
      } catch (_) {
        await mostrarLinkModal(btn.dataset.link);
      }
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
    dados: f.dados || {},
    visivelPara: f.visivelPara || []   // compartilhamento (admin → "Quem pode ver")
  });
  // Cada tipo protegido com .catch pra que uma falha isolada não derrube a tabela.
  // Mas se TODAS falharem (offline, backend fora), a tabela mostrava "nenhuma ficha"
  // como se estivesse vazia — enganoso. Contamos as falhas pra distinguir vazio de erro.
  let cadFalhas = 0;
  const comCatch = (p) => p.catch(() => { cadFalhas++; return []; });
  const pedidos = [
    comCatch(listarFichasLocador({}).then(r => (r.data||[]).map(f => norm(f,'locador')))),
    ...TIPOS.map(t => comCatch(listarFichasTipo({ tipo:t }).then(r => (r.data||[]).map(f => norm(f,t)))))
  ];
  const partes = await Promise.all(pedidos);
  cadErroCarga = (cadFalhas === pedidos.length); // tudo falhou → estado de erro, não "vazio"
  cadFichas = partes.flat().sort((a,b) => (b.criadoEm?.getTime()||0) - (a.criadoEm?.getTime()||0));

  // Fotos dos corretores da tabela (quem tem). Falha aqui não pode travar a
  // aba — sem foto, o avatar cai nas iniciais.
  try {
    const uids = [...new Set(cadFichas.map(f => f.corretorUid).filter(Boolean))];
    if (uids.length) cadFotos = (await listarFotosPerfil({ uids })).data?.fotos || {};
  } catch (_) { cadFotos = {}; }

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
    { k:'todas',      cls:'cad-ic-blue',   lbl: nomeVisao ? `Fichas de ${escapeHtml(nomeVisao)}` : (isAdmin?'Todas as fichas':'Minhas fichas'), sub:'Total geral', n:c.todas },
    { k:'pendentes',  cls:'cad-ic-amber',  lbl:'Pendentes',          sub:'Aguardando ação',    n:c.pendentes },
    { k:'enviadas',   cls:'cad-ic-green',  lbl:'Enviadas ao broker', sub:'Aguardando análise', n:c.enviadas },
    { k:'devolvidas', cls:'cad-ic-red',    lbl:'Devolvidas',         sub:'Para correção',      n:c.devolvidas },
    { k:'concluidas', cls:'cad-ic-violet', lbl:'Concluídas',         sub:'Finalizadas',        n:c.concluidas },
  ];
  const kpiEl = document.getElementById('cadKpis');
  if (kpiEl) kpiEl.innerHTML = kpis.map(x => `
    <button class="cad-kpi ${cadFiltro.tab===x.k?'on':''}" data-tab="${x.k}">
      <div class="cad-kpi-top">
        <div class="cad-ico ${x.cls}">${CAD_KPI_ICO[x.k]}</div>
        <div class="cad-lbl">${x.lbl}</div>
      </div>
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
    const msg = cadErroCarga
      ? '⚠ Não foi possível carregar as fichas. Verifique a conexão e tente recarregar.'
      : 'Nenhuma ficha encontrada com esses filtros.';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="cad-vazio">${msg}</td></tr>`;
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
    const fotoCorretor = cadFotos[f.corretorUid];
    const avtCorretor = fotoCorretor
      ? `<img class="cad-avt" style="width:26px;height:26px" src="${escapeHtml(fotoCorretor)}" alt="">`
      : `<span class="cad-avt" style="width:26px;height:26px;font-size:10px;background:${cadCor(f.corretorNome)}">${escapeHtml(cadIniciais(f.corretorNome))}</span>`;
    const corretorCel = isAdmin
      ? `<td><div class="cad-corretor">${avtCorretor}<div class="cad-cr-nm">${escapeHtml(f.corretorNome||'—')}</div></div></td>`
      : '';
    return `<tr>
      <td><div class="cad-cli"><span class="cad-avt" style="background:${cadCor(f.nome)}">${escapeHtml(cadIniciais(f.nome))}</span>
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
  // Quem recebeu a ficha por compartilhamento (visivelPara) só VÊ: as ações de
  // dono (enviar/reenviar/excluir) ficam com o corretor da ficha e com o admin.
  const ehDono = isAdmin || f.corretorUid === currentUid;
  const podeMexer = ehDono && ['aguardando_corretor','aguardando_edicao_cliente'].includes(f.status);
  // Finalizar é ação de análise (broker): admin ou quem tem analise_locador,
  // e só quando a ficha já chegou nele (mesma regra do backend).
  const ehAnalise = isAdmin || appsPermitidos.includes('analise_locador');
  const podeFinalizar = f.status === 'enviado_admin' && ehAnalise;
  // O broker também pode DEVOLVER uma ficha já enviada pro cliente completar
  // (ex.: chegou sem os documentos) — vira "Aguardando cliente".
  const podeReenviar = podeMexer || (f.status === 'enviado_admin' && ehAnalise);
  const qtdVis = (f.visivelPara || []).length;
  const menu = document.createElement('div');
  menu.className = 'cad-menu';
  menu.innerHTML = `
    ${podeMexer ? '<button data-a="editar">✏ Editar</button>' : '<button data-a="ver">👁 Ver ficha</button>'}
    <button data-a="pdf">⬇ Baixar PDF</button>
    ${podeMexer ? '<button data-a="enviar">📤 Enviar ao broker</button>' : ''}
    ${podeReenviar ? '<button data-a="reenviar">↩ Reenviar ao cliente</button>' : ''}
    ${podeFinalizar ? '<button data-a="finalizar">✅ Finalizar ficha</button>' : ''}
    ${isAdmin ? `<button data-a="quem">👁 Quem pode ver${qtdVis ? ` (${qtdVis})` : ''}</button>` : ''}
    ${ehDono ? '<div class="cad-menu-sep"></div><button data-a="excluir" class="perigo">🗑 Excluir</button>' : ''}`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';

  const fechar = () => { menu.remove(); document.removeEventListener('click', fora); };
  const fora = ev => { if (!menu.contains(ev.target)) fechar(); };
  setTimeout(() => document.addEventListener('click', fora), 0);

  const fnEnviar    = ehLocador ? enviarFichaParaAdmin     : enviarFichaTipoAdmin;
  const fnReenviar  = ehLocador ? reenviarFichaParaCliente : reenviarFichaTipoCliente;
  const fnExcluir   = ehLocador ? excluirFichaLocador      : excluirFichaTipo;
  const fnFinalizar = ehLocador ? finalizarFichaLocador    : finalizarFichaTipo;

  menu.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', async () => {
    const acao = b.dataset.a; fechar();
    if (acao === 'editar') { abrirModalFicha(f.arquivo, f.id, 'edicao', '✏ Editar ' + f.tipoLabel); return; }
    // Ficha já enviada/finalizada: só leitura (modo=corretor). Evita o corretor
    // digitar tudo e o Salvar falhar com "não aceita mais alterações".
    if (acao === 'ver') { abrirModalFicha(f.arquivo, f.id, 'corretor', '👁 ' + f.tipoLabel); return; }
    if (acao === 'quem') { cadAbrirVisibilidade(f); return; }
    if (acao === 'pdf') {
      const url = `${BASE_HOSTING}/${f.arquivo}?modo=corretor&idFicha=${f.id}&origem=hub`;
      const nome = (f.nome || 'ficha').replace(/[^a-zA-Z0-9À-ɏ\s_-]/g,'').trim();
      try { const rr = await hubApi.baixarFichaPDF(url, `Ficha - ${nome}.pdf`); if (!rr?.ok && rr?.erro) alert('Erro ao gerar PDF: ' + rr.erro); }
      catch(err) { console.warn('PDF:', err); }
      return;
    }
    if (acao === 'enviar') {
      const aviso = f.pendentes.length
        ? `⚠ Esta ficha tem ${f.pendentes.length} pendência(s): ${f.pendentes.map(p=>cadNomePend(p)).join(', ')}.\n\nEnviar ao administrativo mesmo assim?`
        : 'Confirma envio desta ficha para o administrativo?';
      if (!confirm(aviso)) return;
      try { await fnEnviar({ fichaId: f.id }); atualizarNotifFichas(); await cadCarregarFichas(); }
      catch(err) { alert('Erro: ' + err.message); }
      return;
    }
    if (acao === 'finalizar') {
      if (!confirm(`Finalizar a ficha de ${f.nome}? Ela vai pra "Concluídas" e o cliente não pode mais editar.`)) return;
      try { await fnFinalizar({ fichaId: f.id }); await cadCarregarFichas(); }
      catch(err) { alert('Erro: ' + err.message); }
      return;
    }
    if (acao === 'reenviar') {
      const obs = await pedirTextoModal({
        titulo: 'Reenviar ao cliente',
        descricao: 'A ficha volta para o cliente editar. A observação abaixo aparece para ele (opcional).',
        placeholder: 'Ex.: falta o comprovante de renda legível',
        okLabel: 'Reenviar'
      });
      if (obs === null) return;
      try {
        const rr = await fnReenviar({ fichaId: f.id, observacao: obs });
        let copiou = true;
        try { await navigator.clipboard.writeText(rr.data.link); } catch (_) { copiou = false; }
        if (!copiou) await mostrarLinkModal(rr.data.link);
        else alert('Link copiado! Envie ao cliente pelo WhatsApp.');
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

// ─── "Quem pode ver" (admin): compartilha a ficha com outras pessoas ─────────
// Grava `visivelPara` via Cloud Function; quem entra na lista vê a ficha na
// própria aba Cadastro e passa a receber os avisos por e-mail junto com o dono.
async function cadAbrirVisibilidade(f) {
  document.querySelector('.cad-vis-overlay')?.remove();
  if (!pessoasCache || (Date.now() - pessoasCacheAt) > 300000) {
    try { const r = await listarPessoas(); pessoasCache = r.data || []; pessoasCacheAt = Date.now(); }
    catch (e) { alert('Erro ao listar pessoas: ' + e.message); return; }
  }
  const atuais = new Set(f.visivelPara || []);
  // Dono fica de fora da lista (ele sempre vê a própria ficha).
  const pessoas = pessoasCache.filter(p => p.uid !== f.corretorUid);

  const ov = document.createElement('div');
  ov.className = 'cad-vis-overlay';
  ov.innerHTML = `
    <div class="cad-vis-panel">
      <h3>👁 Quem pode ver esta ficha</h3>
      <p class="muted">Ficha de <strong>${escapeHtml(f.nome || 'Cliente')}</strong> · corretor ${escapeHtml(f.corretorNome || '—')}.<br>
      Quem for marcado vê a ficha na aba Cadastro e recebe os avisos por e-mail. Admins já veem tudo.</p>
      <div class="cad-vis-lista">
        ${pessoas.map(p => `<label class="auth-label-inline"><input type="checkbox" value="${p.uid}" ${atuais.has(p.uid) ? 'checked' : ''}> ${escapeHtml(formatarNome(p.nome))}</label>`).join('') || '<p class="muted">Nenhum outro usuário.</p>'}
      </div>
      <div class="cad-vis-acoes">
        <button class="topbar-btn" data-v="cancelar">Cancelar</button>
        <button class="topbar-btn primario" data-v="salvar">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
  ov.querySelector('[data-v="cancelar"]').addEventListener('click', () => ov.remove());
  ov.querySelector('[data-v="salvar"]').addEventListener('click', async () => {
    const btn = ov.querySelector('[data-v="salvar"]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    const uids = [...ov.querySelectorAll('.cad-vis-lista input:checked')].map(c => c.value);
    try {
      await fichaDefinirVisibilidade({ colecao: f.key === 'locador' ? 'fichas_locador' : 'fichas', fichaId: f.id, uids });
      ov.remove();
      await cadCarregarFichas();
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  });
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
      // Todas as fichas (locação e venda) vivem no Cadastro (Fichas Digitais).
      categoriaAtiva = 'documentos';
      abrirGrupoDe('documentos');
      locSub = null;
      locSanfonaAberta = false;   // recolhe a sanfona do Broker (senão fica aberta e órfã)
      // A tela nova do Cadastro é uma TABELA (não mais sanfonas). O antigo
      // .docs-acc-head não existe mais — em vez de clicar num elemento inexistente,
      // já abre o Cadastro filtrado pelo tipo da ficha (mostra todo o período).
      // Vai como PENDENTE porque o carregarDocumentos reseta o cadFiltro logo em seguida.
      cadFiltroPendente = { tab:'todas', busca:'', tipo: secKey || '', status:'', periodo:'', corretor:'' };
      renderSidebar();
      renderCentro();
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
