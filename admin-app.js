// Página admin: gerenciar credenciais dos sistemas + usuários do Hub
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { getFirestore, collection, onSnapshot, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Config por ambiente (prod/staging/emulador, por hostname) — ver firebase-env.js
import { firebaseConfig, conectarEmuladores } from "./firebase-env.js";

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const fns     = getFunctions(app, 'southamerica-east1');
const storage = getStorage(app);
const dbFs    = getFirestore(app);
conectarEmuladores({ auth, fns, db: dbFs, storage });

const listCredentials   = httpsCallable(fns, 'listCredentials');
const getCredentialAdmin = httpsCallable(fns, 'getCredentialAdmin');
const setCredentials    = httpsCallable(fns, 'setCredentials');
const deleteCredentials = httpsCallable(fns, 'deleteCredentials');
const listUsers         = httpsCallable(fns, 'listUsers');
const setUserAdmin      = httpsCallable(fns, 'setUserAdmin');
const createUser        = httpsCallable(fns, 'createUser');
const deleteUserAccount = httpsCallable(fns, 'deleteUserAccount');
const configObter       = httpsCallable(fns, 'configObter');
const configSalvar      = httpsCallable(fns, 'configSalvar');
const criarCodigoConvite    = httpsCallable(fns, 'criarCodigoConvite');
const listarCodigosConvite  = httpsCallable(fns, 'listarCodigosConvite');
const excluirCodigoConvite  = httpsCallable(fns, 'excluirCodigoConvite');
const getUserAccess  = httpsCallable(fns, 'getUserAccess');
const setUserAccess  = httpsCallable(fns, 'setUserAccess');
const adminSetPessoaExtra = httpsCallable(fns, 'adminSetPessoaExtra');
const c2sImportarLeads = httpsCallable(fns, 'c2sImportarLeads', { timeout: 120000 });
const c2sAssinarWebhooks = httpsCallable(fns, 'c2sAssinarWebhooks', { timeout: 120000 });
const leadsAutoVincular = httpsCallable(fns, 'leadsAutoVincular', { timeout: 120000 });
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const publicarLocacoes = httpsCallable(fns, 'publicarLocacoes');
const getModoCofre = httpsCallable(fns, 'getModoCofre');
const setModoCofre = httpsCallable(fns, 'setModoCofre');
const migrarCredenciaisCofre = httpsCallable(fns, 'migrarCredenciaisCofre');
const listarStatusApps        = httpsCallable(fns, 'listarStatusApps');
const listarNotificacoesAdmin = httpsCallable(fns, 'listarNotificacoesAdmin');
const excluirNotificacao      = httpsCallable(fns, 'excluirNotificacao');
const hrecUsuariosListar    = httpsCallable(fns, 'hrecUsuariosListar');
const hrecImobiliariasListar = httpsCallable(fns, 'hrecImobiliariasListar');
const hrecImobiliariaSalvar = httpsCallable(fns, 'hrecImobiliariaSalvar');
const hrecSetPapel          = httpsCallable(fns, 'hrecSetPapel');
const hrecAdminConfig       = httpsCallable(fns, 'hrecAdminConfig');
const hrecSalvarTabela      = httpsCallable(fns, 'hrecSalvarTabela');
const hrecSalvarAdicional   = httpsCallable(fns, 'hrecSalvarAdicional');
const hrecSalvarConfigAgenda = httpsCallable(fns, 'hrecSalvarConfigAgenda');
const hrecSalvarConfigPix   = httpsCallable(fns, 'hrecSalvarConfigPix');
const hrecBloquearData      = httpsCallable(fns, 'hrecBloquearData');
const hrecDesbloquearData   = httpsCallable(fns, 'hrecDesbloquearData');
const getTreinamentoLinks = httpsCallable(fns, 'getTreinamentoLinks');
const setTreinamentoLink  = httpsCallable(fns, 'setTreinamentoLink');
const setStatusApp     = httpsCallable(fns, 'setStatusApp');
const getBanner        = httpsCallable(fns, 'getBanner');
const setBanner        = httpsCallable(fns, 'setBanner');
const listarBanners    = httpsCallable(fns, 'listarBanners');
const adicionarBanner  = httpsCallable(fns, 'adicionarBanner');
const removerBanner    = httpsCallable(fns, 'removerBanner');
const reordenarBanners = httpsCallable(fns, 'reordenarBanners');
const listarNovidades  = httpsCallable(fns, 'listarNovidades');
const salvarNovidade   = httpsCallable(fns, 'salvarNovidade');
const excluirNovidade  = httpsCallable(fns, 'excluirNovidade');
const listarChamados   = httpsCallable(fns, 'listarChamados');
const responderChamado = httpsCallable(fns, 'responderChamado');
const excluirChamado   = httpsCallable(fns, 'excluirChamado');

// Cópia da do hub-app.js: admin.html carrega este arquivo como <script type="module">,
// que tem escopo próprio e não enxerga funções declaradas nos outros renderers.
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const listarAuditoria  = httpsCallable(fns, 'listarAuditoria');
const botPainel        = httpsCallable(fns, 'botPainel');
const botSetAuto       = httpsCallable(fns, 'botSetAuto');
const botCorrigirBug   = httpsCallable(fns, 'botCorrigirBug');
const botAprovarAchado = httpsCallable(fns, 'botAprovarAchado');
const botIgnorarAchado = httpsCallable(fns, 'botIgnorarAchado');
const lgpdPainelFn       = httpsCallable(fns, 'lgpdPainel');
const lgpdSetConfig      = httpsCallable(fns, 'lgpdSetConfig');
const lgpdExpurgar       = httpsCallable(fns, 'lgpdExpurgar');
const lgpdExcluirTitular = httpsCallable(fns, 'lgpdExcluirTitular');

// Estrutura de treinamentos (espelho do hub-app.js)
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

// Apps restritos (aparecem só pra quem o admin liberar)
const APPS_RESTRITOS = [
  // ClickSign saiu daqui (liberado pra geral em 2026-07-29) — não é mais concedível por pessoa.
  { key: 'analise_locador', nome: 'Análise de Fichas do Locador' }
];

// Todos os apps e abas internas do Hub — pro controle de status e registro de uso
const TODOS_APPS = [
  { key: 'cadastro_imobiliario', nome: 'Central de Cadastro' },
  { key: 'imovelp', nome: 'Imóvel do Proprietário' },
  { key: 'sp_imovel', nome: 'SP Imóvel' },
  { key: 'forsale', nome: 'Jr Captações' },
  { key: 'itbi_smart', nome: 'ITBI Smart' },
  { key: 'checkvisto', nome: 'Smart Vistorias' },
  { key: 'alude', nome: 'Alude' },
  { key: 'clicksign', nome: 'ClickSign' },
  { key: 'motiva', nome: 'Motiva Smart' },
  { key: 'gemini', nome: 'Gemini' },
  { key: 'whatsapp', nome: 'WhatsApp' },
  { key: 'universidade', nome: 'Universidade REMAX' },
  { key: 'goiconnect', nome: 'IConnect' },
  { key: 'brokerapp', nome: 'BrokerApp' },
  { key: 'documentos', nome: 'Cadastro (Fichas)' },
  { key: 'marketing', nome: 'Marketing' },
  { key: 'treinamento', nome: 'Treinamento' },
  { key: 'locacoes', nome: 'Gestão de Locações' },
  { key: 'agenda', nome: 'Agenda' },
  { key: 'calculadoras', nome: 'Calculadoras' },
  { key: 'notas', nome: 'Bloco de Notas' },
  { key: 'ia', nome: 'IA' },
  { key: 'fotografia', nome: 'Fotografia' },
  { key: 'reuniao', nome: 'Reunião' },
  { key: 'sala_reuniao', nome: 'Sala de Reunião' },
];

// Mesma lista do hub-app.js — sites que têm autologin (são os únicos com credenciais)
const SITES = [
  { key: 'alude', nome: 'Alude' },
  { key: 'cadastro_imobiliario', nome: 'Central de Cadastro' },
  { key: 'imovelp', nome: 'Imóvel do Proprietário' },
  { key: 'sp_imovel', nome: 'SP Imóvel' },
  { key: 'forsale', nome: 'Jr Captações (Sigavi360)' },
  { key: 'clicksign', nome: 'ClickSign (conta compartilhada)' }
];

// Estado de presença em tempo real (uid → { online, updatedAt })
let presenceMap = {};
let totalUsuariosAdmin = 0; // total de usuários (para calcular % dos avisos)
let notificacoesCache = []; // cache para re-renderizar quando usuários carregarem
let permReqId = 0; // contador da chamada mais recente ao modal de Permissões (evita corrida)

const elListaCred  = document.getElementById('listaCredenciais');
const elListaUser  = document.getElementById('listaUsuarios');
const elListaCodigos = document.getElementById('listaCodigos');
const elListaStatus = document.getElementById('listaStatusApps');
const modalCred    = document.getElementById('modalCred');
const modalUser    = document.getElementById('modalUser');
const modalCodigo  = document.getElementById('modalCodigo');
const modalCodigoGerado = document.getElementById('modalCodigoGerado');
const modalPermissoes = document.getElementById('modalPermissoes');
const modalConfirm = document.getElementById('modalConfirm');

// Formata "03/06 14:30"
function fmtDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// Verifica auth + admin ou TI
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.hubApi.voltarParaLogin(); return; }
  const t = await user.getIdTokenResult();
  const isAdminUser = !!t.claims.admin;

  let isTI = false;
  if (!isAdminUser) {
    try {
      const perm = await getMinhasPermissoes();
      isTI = !!perm.data.ti;
    } catch (e) {}
  }

  if (!isAdminUser && !isTI) {
    alert('Sem permissão.');
    window.hubApi.voltarParaHub();
    return;
  }

  // Nav item de Chamados só aparece pra quem tem TI ou admin (ambos casos aqui, já passou a checagem acima)
  const navChamados = document.getElementById('navChamados');
  if (navChamados) navChamados.hidden = false;

  // Se for TI-only (não admin), esconde tudo do nav exceto Chamados
  if (isTI && !isAdminUser) {
    document.querySelectorAll('.admin-nav-item').forEach(b => {
      if (b.dataset.aba !== 'chamados') b.hidden = true;
    });
    document.querySelectorAll('.admin-nav-grupo').forEach(g => g.hidden = true);
    ativarAba('chamados');
    carregarChamados();
  } else {
    // Admin normal — carrega tudo em background e abre aba padrão
    carregarTudo();
    carregarChamados();
    ativarAba('usuarios');
  }

  // Handler das abas
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => ativarAba(btn.dataset.aba));
  });

  // Presença em tempo real — atualiza os dots na tabela de usuários
  onSnapshot(collection(dbFs, 'user_presence'), snap => {
    presenceMap = {};
    const limiteOnline = Date.now() - 3 * 60 * 1000; // considera online se viu nos últimos 3 min
    snap.forEach(d => {
      const dados = d.data();
      const ms = dados.updatedAt?.toMillis?.() || 0;
      presenceMap[d.id] = dados.online === true && ms > limiteOnline;
    });
    atualizarDotsPresenca();
  });

  // Avisos em tempo real — quem viu
  onSnapshot(collection(dbFs, 'notifications'), snap => {
    const lista = [];
    snap.forEach(d => { lista.push({ id: d.id, ...d.data() }); });
    lista.sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    notificacoesCache = lista;
    renderAvisosEnviados(lista);
  });
});

document.getElementById('btnVoltar').addEventListener('click', () => window.hubApi.voltarParaHub());

document.getElementById('btnNovoUsuario').addEventListener('click', () => {
  document.getElementById('userEmail').value = '';
  document.getElementById('userSenha').value = '';
  document.getElementById('userAdmin').checked = false;
  modalUser.showModal();
});

document.getElementById('btnNovoCodigo').addEventListener('click', () => {
  document.getElementById('codigoMaxUsos').value = '1';
  document.getElementById('codigoValidade').value = '7';
  document.getElementById('codigoFazAdmin').checked = false;
  modalCodigo.showModal();
});
document.getElementById('cancelarCodigo').addEventListener('click', () => modalCodigo.close());
document.getElementById('fecharCodigoGerado').addEventListener('click', () => modalCodigoGerado.close());
document.getElementById('btnCopiarCodigo').addEventListener('click', async () => {
  const txt = document.getElementById('codigoTexto').textContent;
  try { await navigator.clipboard.writeText(txt); alert('Copiado!'); }
  catch(e) { alert('Não copiou. Selecione e Ctrl+C manualmente.'); }
});

document.getElementById('formCodigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const maxUsos = parseInt(document.getElementById('codigoMaxUsos').value, 10);
  const diasRaw = document.getElementById('codigoValidade').value.trim();
  const diasValidade = diasRaw ? parseInt(diasRaw, 10) : null;
  const fazAdmin = document.getElementById('codigoFazAdmin').checked;
  try {
    const r = await criarCodigoConvite({ maxUsos, diasValidade, fazAdmin });
    modalCodigo.close();
    document.getElementById('codigoTexto').textContent = r.data.codigo;
    modalCodigoGerado.showModal();
    carregarCodigos();
  } catch (err) { alert('Erro: ' + err.message); }
});

document.getElementById('cancelarCred').addEventListener('click', () => modalCred.close());
document.getElementById('cancelarUser').addEventListener('click', () => modalUser.close());

document.getElementById('formCred').addEventListener('submit', async (e) => {
  e.preventDefault();
  const siteKey  = document.getElementById('credSiteKey').value;
  const login    = document.getElementById('credLogin').value;
  const password = document.getElementById('credPassword').value;
  try {
    await setCredentials({ siteKey, login, password });
    modalCred.close();
    carregarCredenciais();
  } catch (err) { alert('Erro: ' + err.message); }
});

document.getElementById('formUser').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email   = document.getElementById('userEmail').value;
  const password = document.getElementById('userSenha').value;
  const isAdmin = document.getElementById('userAdmin').checked;
  try {
    await createUser({ email, password, isAdmin });
    modalUser.close();
    carregarUsuarios();
  } catch (err) { alert('Erro: ' + err.message); }
});

function ativarAba(aba) {
  document.querySelectorAll('.admin-section').forEach(s => {
    s.hidden = s.dataset.aba !== aba;
  });
  document.querySelectorAll('.admin-nav-item').forEach(b => {
    b.classList.toggle('ativo', b.dataset.aba === aba);
  });
  if (aba === 'auditoria') carregarAuditoria();
  if (aba === 'bugbot')    carregarBugBot();
  if (aba === 'smarthub')  carregarSmartHub();
  if (aba === 'hrec')      carregarHrecAdmin();
  if (aba === 'leadsc2s')  carregarLeadsC2S();
  if (aba === 'lgpd')      carregarLgpd();
  if (aba === 'novidades') carregarNovidades();
}

// ─── Leads — integração C2S (Contact2Sale) ──────────────────────────────────
// Dois botões: importar o histórico (só lê do C2S) e ligar o tempo real (assina o
// webhook). Ambos chamam Cloud Functions que usam o secret C2S_TOKEN.
function carregarLeadsC2S() {
  const p = document.getElementById('leadsC2sPainel');
  if (!p) return;
  const passo = (n, titulo, texto, btnId, btnLabel, ico, primario) => `
    <div style="display:flex;gap:14px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px">
      <div style="flex:none;width:28px;height:28px;border-radius:50%;background:var(--blue,#0a3d62);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${n}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:2px">${titulo}</div>
        <div class="muted" style="font-size:12.5px;line-height:1.5;margin-bottom:12px">${texto}</div>
        <button id="${btnId}" style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid ${primario ? 'transparent' : 'var(--border)'};background:${primario ? 'var(--blue,#0a3d62)' : 'transparent'};color:${primario ? '#fff' : 'var(--text)'}"><i class="ti ti-${ico}"></i>${btnLabel}</button>
      </div>
    </div>`;
  p.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;max-width:640px">
      ${passo(1, 'Importar histórico', 'Puxa os leads que já existem no C2S pra cá — só leitura, não altera nada lá. Roda em blocos e mostra o progresso.', 'c2sImportarBtn', 'Importar histórico', 'download', true)}
      ${passo(2, 'Ligar tempo real', 'Assina o webhook do C2S apontando pra este Hub — a partir daí, todo lead novo cai sozinho. ⚠️ Use um token <strong>dedicado</strong>: se este já serve outra integração, o webhook dela é substituído.', 'c2sAssinarBtn', 'Ligar tempo real', 'bolt', false)}
      ${passo(3, 'Vincular aos imóveis', 'Liga automaticamente cada lead ao imóvel da Carteira que tem o mesmo código do portal. Vale pros leads já importados; os novos já entram vinculados sozinhos. Não mexe em vínculo feito à mão.', 'c2sVincularBtn', 'Vincular automaticamente', 'link', false)}
      <div id="c2sResultado" style="font-size:13px"></div>
    </div>`;
  const out = document.getElementById('c2sResultado');
  const msg = (txt, cor) => { out.innerHTML = `<div style="padding:12px 14px;border-radius:10px;background:var(--bg);border:1px solid var(--border)${cor ? `;color:${cor}` : ''}">${txt}</div>`; };
  document.getElementById('c2sImportarBtn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.style.opacity = '.6';
    const orig = b.innerHTML; b.innerHTML = '<i class="ti ti-loader"></i> Importando…';
    let page = 1, total = 0, guarda = 0;
    try {
      // Loop em fatias: chama até proximaPagina vir null (o servidor processa poucas páginas por vez).
      while (guarda++ < 300) {
        const r = await c2sImportarLeads({ page });
        const d = r.data || {};
        total += (d.total || 0);
        const tp = d.totalPaginas ? ` de ~${d.totalPaginas}` : '';
        msg(`Importando… <strong>${total}</strong> leads até agora (página ${page}${tp}).`);
        if (!d.proximaPagina) break;
        page = d.proximaPagina;
      }
      msg(`✔ Concluído: <strong>${total}</strong> leads sincronizados. Abra a aba <strong>Leads</strong> no Meus Negócios pra ver.`, '#3ddc84');
    } catch (err) { msg('Erro: ' + escHtml(err.message), '#ff6b6b'); }
    b.disabled = false; b.style.opacity = ''; b.innerHTML = orig;
  });
  document.getElementById('c2sAssinarBtn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;   // captura ANTES do await — currentTarget vira null depois do await
    if (!(await confirmar('Ligar o tempo real vai assinar o webhook no C2S apontando pra este Hub. Se este token já é usado por outra integração, o webhook dela será substituído. Continuar?', 'Ligar tempo real'))) return;
    b.disabled = true; b.style.opacity = '.6';
    const orig = b.innerHTML; b.innerHTML = '<i class="ti ti-loader"></i> Ligando…';
    try {
      const r = await c2sAssinarWebhooks({});
      const d = r.data || {};
      const linhas = (d.resultados || []).map(x => `${x.ok ? '✔' : '✖'} ${escHtml(x.acao)} — HTTP ${x.status || '?'}`).join('<br>');
      msg(`<strong>Webhook assinado:</strong><br><span style="word-break:break-all;opacity:.8">${escHtml(d.hookUrl || '')}</span><br><br>${linhas}`, '#3ddc84');
    } catch (err) { msg('Erro: ' + escHtml(err.message), '#ff6b6b'); }
    b.disabled = false; b.style.opacity = ''; b.innerHTML = orig;
  });
  document.getElementById('c2sVincularBtn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.style.opacity = '.6';
    const orig = b.innerHTML; b.innerHTML = '<i class="ti ti-loader"></i> Vinculando…';
    let depoisDe = '', imoveis = 0, vinculados = 0, interessados = 0, guarda = 0;
    try {
      // Loop em fatias por imóvel: chama até `proximo` vir null.
      while (guarda++ < 500) {
        const r = await leadsAutoVincular(depoisDe ? { depoisDe } : {});
        const d = r.data || {};
        imoveis += (d.imoveis || 0); vinculados += (d.vinculados || 0); interessados += (d.interessados || 0);
        msg(`Vinculando… <strong>${vinculados}</strong> leads vinculados, <strong>${interessados}</strong> interessados criados (${imoveis} imóveis verificados).`);
        if (!d.proximo) break;
        depoisDe = d.proximo;
      }
      msg(`✔ Concluído: <strong>${vinculados}</strong> leads vinculados e <strong>${interessados}</strong> interessados criados nos imóveis da Carteira (${imoveis} imóveis verificados). Os que não casaram continuam sem vínculo — o imóvel pode ter saído do portal.`, '#3ddc84');
    } catch (err) { msg('Erro: ' + escHtml(err.message), '#ff6b6b'); }
    b.disabled = false; b.style.opacity = ''; b.innerHTML = orig;
  });
}

// ─── SMART HUB — configurações (T-06 Administração) ──────────────────────────
// Tipos de imóvel e cidades = listas simples. Checklists = etapas ordenadas com
// flag "obrigatória" (trava o Entregar p/ Gestão no 04B). Salvar é por painel.
// Padrões do código valem enquanto a config não existir (fallback do servidor).
const SH_CHECKLIST_PADRAO = {
  checklist_locacao: [
    ['Documentação salva na pasta', true], ['Ficha cadastral preenchida', true], ['Proposta ajustada', true],
    ['Contrato emitido', true], ['Contrato aprovado', true], ['Contrato assinado', true], ['Seguro aprovado', true],
    ['Entrega das chaves', false], ['Transferência ENEL', false], ['Transferência IPTU', false],
    ['Transferência titularidade condomínio', false], ['Avaliação Google', false], ['Processo finalizado', false],
  ],
  checklist_venda: [
    ['Documentação salva na pasta', true], ['Ficha cadastral preenchida', true], ['Proposta ajustada', true],
    ['Compromisso emitido', true], ['Certidões', true], ['Matrícula atualizada', true],
    ['Compromisso aprovado', true], ['Compromisso assinado', true],
    ['1ª parcela comissão', false], ['2ª parcela comissão', false], ['Averbação', false], ['Matrícula emitida', false],
    ['Entrega das chaves', false], ['Transferência ENEL', false], ['Transferência IPTU', false],
    ['Transferência condomínio', false], ['Avaliação Google', false], ['Processo finalizado', false],
  ],
};
let shConfig = null;   // estado editável em memória (por doc)

async function carregarSmartHub() {
  const painel = document.getElementById('smarthubPainel');
  painel.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const res = await configObter({});
    const d = res.data || {};
    shConfig = {
      tipos_imovel: d.tipos_imovel || ['Apartamento', 'Casa', 'Casa em condomínio', 'Sobrado', 'Kitnet/Studio', 'Sala comercial', 'Loja', 'Galpão', 'Terreno'],
      cidades: d.cidades || ['Curitiba'],
      checklist_locacao: d.checklist_locacao || SH_CHECKLIST_PADRAO.checklist_locacao.map(([label, obrigatoria]) => ({ label, obrigatoria })),
      checklist_venda: d.checklist_venda || SH_CHECKLIST_PADRAO.checklist_venda.map(([label, obrigatoria]) => ({ label, obrigatoria })),
      _existia: { tipos_imovel: !!d.tipos_imovel, cidades: !!d.cidades, checklist_locacao: !!d.checklist_locacao, checklist_venda: !!d.checklist_venda },
    };
    renderSmartHub();
  } catch (e) {
    painel.innerHTML = `<p class="muted">Erro ao carregar: ${escHtmlAdmin(e.message)}</p>`;
  }
}

function escHtmlAdmin(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Lê a tela INTEIRA de volta pro estado (edições não salvas de TODOS os painéis)
// e devolve o texto dos campos "Adicionar..." pra sobreviverem ao re-render.
// Chamar SEMPRE antes de mutar shConfig: sem isso, mexer num card apagava em
// silêncio o rename/checkbox/texto digitado nos outros cards.
function shSyncTudo() {
  const painel = document.getElementById('smarthubPainel');
  painel.querySelectorAll('.sh-label').forEach(inp => {
    const d = shConfig[inp.dataset.doc], i = Number(inp.dataset.i);
    if (d && d[i]) d[i].label = inp.value;
  });
  painel.querySelectorAll('.sh-obr').forEach(chk => {
    const d = shConfig[chk.dataset.doc], i = Number(chk.dataset.i);
    if (d && d[i]) d[i].obrigatoria = chk.checked;
  });
  const novos = {};
  painel.querySelectorAll('.sh-novo').forEach(inp => { if (inp.value) novos[inp.dataset.doc] = inp.value; });
  return novos;
}

function renderSmartHub(novos) {
  const painel = document.getElementById('smarthubPainel');
  const card = (titulo, sub, corpo, doc) => `<div style="background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:16px 18px;margin-bottom:14px">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <strong style="font-size:14px">${titulo}</strong>
      <span class="muted" style="font-size:11px">${sub}</span>
      ${doc && !shConfig._existia[doc] ? '<span style="font-size:10px;font-weight:700;color:#b45309;background:#b4530918;border:1px solid #b4530940;padding:2px 8px;border-radius:10px">padrão do sistema — ainda não salvo</span>' : ''}
      <span style="flex:1"></span>
      ${doc ? `<button class="sh-salvar" data-doc="${doc}" style="font-size:12px;font-weight:600;padding:6px 16px;border:none;border-radius:8px;background:#002749;color:#fff;cursor:pointer">Salvar</button>` : ''}
    </div>${corpo}</div>`;

  // Listas simples (tipos / cidades): chips com ✕ + campo de adicionar
  const listaHtml = (doc) => {
    const chips = shConfig[doc].map((v, i) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;background:var(--hover,#f5f6f8);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:4px 12px;margin:2px">
      ${escHtmlAdmin(v)}<button class="sh-rem" data-doc="${doc}" data-i="${i}" style="border:none;background:none;color:#DC1C2E;cursor:pointer;font-size:12px;line-height:1;padding:0">✕</button></span>`).join('');
    return `<div style="margin:6px 0">${chips || '<span class="muted" style="font-size:12px">Lista vazia.</span>'}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input class="sh-novo" data-doc="${doc}" placeholder="Adicionar..." style="font-size:12px;padding:6px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;min-width:200px">
        <button class="sh-add" data-doc="${doc}" style="font-size:12px;font-weight:600;padding:6px 12px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--surface,#fff);cursor:pointer">+ Adicionar</button></div>`;
  };

  // Checklists: linhas ordenáveis (↑↓) com nome + obrigatória + ✕
  const checklistHtml = (doc) => {
    const linhas = shConfig[doc].map((x, i) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border,#e5e7eb)">
      <span class="muted" style="font-size:11px;min-width:22px;text-align:right">${i + 1}.</span>
      <button class="sh-mov" data-doc="${doc}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} style="border:none;background:none;cursor:pointer;font-size:12px;padding:0 2px">↑</button>
      <button class="sh-mov" data-doc="${doc}" data-i="${i}" data-dir="1" ${i === shConfig[doc].length - 1 ? 'disabled' : ''} style="border:none;background:none;cursor:pointer;font-size:12px;padding:0 2px">↓</button>
      <input class="sh-label" data-doc="${doc}" data-i="${i}" value="${escHtmlAdmin(x.label)}" style="flex:1;font-size:12px;padding:5px 10px;border:1px solid var(--border,#e5e7eb);border-radius:6px">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap;cursor:pointer">
        <input type="checkbox" class="sh-obr" data-doc="${doc}" data-i="${i}"${x.obrigatoria ? ' checked' : ''}> obrigatória</label>
      <button class="sh-rem" data-doc="${doc}" data-i="${i}" style="border:none;background:none;color:#DC1C2E;cursor:pointer;font-size:13px">✕</button>
    </div>`).join('');
    return `<div>${linhas}</div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <input class="sh-novo" data-doc="${doc}" placeholder="Nova etapa..." style="font-size:12px;padding:6px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;min-width:240px">
        <button class="sh-add" data-doc="${doc}" style="font-size:12px;font-weight:600;padding:6px 12px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--surface,#fff);cursor:pointer">+ Adicionar etapa</button></div>
      <p class="muted" style="font-size:11px;margin-top:8px">Etapas <strong>obrigatórias</strong> travam o "Entregar para Gestão" e o "Concluir" do negócio. A mudança vale só pros próximos negócios.</p>`;
  };

  const finalidades = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
    ${['Locação', 'Venda', 'Venda + Locação'].map(f => `<span style="font-size:12px;background:var(--hover,#f5f6f8);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:4px 12px">${f}</span>`).join('')}
  </div><p class="muted" style="font-size:11px;margin-top:8px">As finalidades fazem parte do modelo de dados (esteira, fichas, negócios) — não são editáveis.</p>`;

  painel.innerHTML =
    card('Tipos de Imóvel', 'sugestões no cadastro do imóvel', listaHtml('tipos_imovel'), 'tipos_imovel') +
    card('Cidades', 'sugestões no cadastro do imóvel', listaHtml('cidades'), 'cidades') +
    card('Checklist — Locação', 'etapas do negócio de locação (Tela Gerenciar Negócio)', checklistHtml('checklist_locacao'), 'checklist_locacao') +
    card('Checklist — Venda', 'etapas do negócio de venda', checklistHtml('checklist_venda'), 'checklist_venda') +
    card('Finalidades', 'fixas no sistema', finalidades, null);

  // Devolve o texto do "Adicionar..." que ainda não virou item (sobrevive ao re-render)
  Object.entries(novos || {}).forEach(([doc, v]) => {
    const inp = painel.querySelector(`.sh-novo[data-doc="${doc}"]`);
    if (inp) inp.value = v;
  });
  wireSmartHub();
}

function wireSmartHub() {
  const painel = document.getElementById('smarthubPainel');
  painel.querySelectorAll('.sh-add').forEach(b => b.addEventListener('click', () => {
    const doc = b.dataset.doc;
    const inp = painel.querySelector(`.sh-novo[data-doc="${doc}"]`);
    const v = inp?.value.trim();
    if (!v) return;
    const novos = shSyncTudo();
    delete novos[doc];   // esse texto virou item — não volta pro campo
    if (!doc.startsWith('checklist_')) {
      // Duplicado (ignorando caixa/acento): avisa aqui em vez de deixar o servidor
      // deduplicar em silêncio no Salvar (o chip sumia sem explicação).
      const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      if (shConfig[doc].some(x => norm(x) === norm(v))) { alert('Esse item já está na lista.'); return; }
    }
    shConfig[doc].push(doc.startsWith('checklist_') ? { label: v, obrigatoria: false } : v);
    renderSmartHub(novos);
  }));
  painel.querySelectorAll('.sh-novo').forEach(inp => inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); painel.querySelector(`.sh-add[data-doc="${inp.dataset.doc}"]`)?.click(); }
  }));
  painel.querySelectorAll('.sh-rem').forEach(b => b.addEventListener('click', () => {
    const doc = b.dataset.doc;
    const novos = shSyncTudo();
    shConfig[doc].splice(Number(b.dataset.i), 1);
    renderSmartHub(novos);
  }));
  painel.querySelectorAll('.sh-mov').forEach(b => b.addEventListener('click', () => {
    const doc = b.dataset.doc, i = Number(b.dataset.i), j = i + Number(b.dataset.dir);
    const novos = shSyncTudo();
    if (j < 0 || j >= shConfig[doc].length) return;
    [shConfig[doc][i], shConfig[doc][j]] = [shConfig[doc][j], shConfig[doc][i]];
    renderSmartHub(novos);
  }));
  painel.querySelectorAll('.sh-salvar').forEach(b => b.addEventListener('click', async () => {
    const doc = b.dataset.doc;
    const novos = shSyncTudo();
    b.disabled = true; b.textContent = 'Salvando...';
    try {
      const r = await configSalvar({ doc, itens: shConfig[doc] });
      shConfig[doc] = r.data?.itens || shConfig[doc];
      shConfig._existia[doc] = true;
      renderSmartHub(novos);
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
      b.disabled = false; b.textContent = 'Salvar';
    }
  }));
}

// ─── LGPD ───────────────────────────────────────────────────────────────────
// Duas operações que parecem a mesma e NÃO são:
//   • Expurgo por retenção = ANONIMIZA. Apaga CPF/RG/renda e os anexos, mas deixa
//     a casca da ficha (corretor, tipo, status, data) — o relatório não perde nada.
//   • Exclusão a pedido do titular = APAGA TUDO. Direito ao esquecimento, sem volta.
// A tela sempre mostra a PRÉVIA (quantas fichas) antes de perguntar qualquer coisa.

const LGPD_COL_NOME = { fichas: 'Fichas (PF, PJ, vendedor, proposta, fiança…)', fichas_locador: 'Fichas do locador' };

// Confirmação digitada pra operação sem volta. NÃO usar prompt(): o Electron não
// implementa prompt() (ver hub-app.js) — ele devolve nada e a confirmação nunca
// passaria, deixando o botão morto no .exe. Aqui é um <dialog> de verdade.
function confirmarDigitando(titulo, aviso, palavra) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" class="modal-form">
        <h3>${escapeHtml(titulo)}</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;line-height:1.5">${aviso}</p>
        <label class="auth-label">Digite <strong>${escapeHtml(palavra)}</strong> pra confirmar
          <input type="text" autocomplete="off" spellcheck="false">
        </label>
        <div class="modal-actions">
          <button type="button" class="topbar-btn" data-x="nao">Cancelar</button>
          <button type="button" class="topbar-btn perigo" data-x="sim" disabled>Confirmar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('input');
    const ok = dlg.querySelector('[data-x="sim"]');
    input.addEventListener('input', () => { ok.disabled = input.value.trim() !== palavra; });
    const fechar = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    ok.addEventListener('click', () => fechar(true));
    dlg.querySelector('[data-x="nao"]').addEventListener('click', () => fechar(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(false); });   // Esc
    dlg.showModal();
    input.focus();
  });
}

async function carregarLgpd(diasConsulta) {
  const cont = document.getElementById('lgpdPainel');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const { data } = await lgpdPainelFn(Number.isInteger(diasConsulta) ? { dias: diasConsulta } : {});
    const { cfg, diasConsultado, previa, totais, minimo } = data;
    const anos = (d) => (d / 365).toFixed(1).replace('.0', '').replace('.', ',');

    const totaisHtml = Object.entries(totais).map(([col, t]) => `
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-top:1px solid var(--border)">
        <span>${escapeHtml(LGPD_COL_NOME[col] || col)}</span>
        <span style="color:var(--text-muted)">${t.total} no total · <strong style="color:var(--text-primary)">${t.expurgadas}</strong> já anonimizadas</span>
      </div>`).join('');

    cont.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">📅 Prazo de retenção</div>
        <div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px">Depois de quantos dias uma ficha deixa de ser necessária? Passado o prazo, os dados pessoais dela são apagados. Mínimo ${minimo} dias.</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="lgpdDias" type="number" min="${minimo}" max="3650" value="${diasConsultado}" style="width:110px;font-size:13px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
          <span style="font-size:12px;color:var(--text-muted)">dias (≈ ${anos(diasConsultado)} anos)</span>
          <button class="topbar-btn" id="lgpdVer">Ver o que passou do prazo</button>
          <button class="topbar-btn primario" id="lgpdSalvar">Salvar prazo</button>
        </div>
        <div id="lgpdCfgMsg" class="muted" style="font-size:11px;margin-top:6px">Prazo salvo hoje: <strong>${cfg.dias} dias</strong> · expurgo automático mensal: <strong>${cfg.automatico ? '🟢 ligado' : '⚪ desligado'}</strong></div>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🧹 Fichas que já passaram de ${diasConsultado} dias</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px">${previa.fichas}${previa.restantes ? ` <span style="font-size:13px;font-weight:400;color:var(--text-muted)">+ ${previa.restantes} na fila</span>` : ''}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          Apagar significa <strong>anonimizar</strong>: saem o CPF, o RG, a renda, o endereço e os <strong>anexos</strong>.
          Fica a casca — qual corretor, tipo, status e data — pra não furar os relatórios. <strong>Não tem volta.</strong>
        </div>
        <button class="topbar-btn perigo" id="lgpdExpurgar" style="margin-top:10px" ${previa.fichas ? '' : 'disabled'}>🧹 Anonimizar essas ${previa.fichas} fichas</button>
        <span id="lgpdExpMsg" class="muted" style="font-size:11px;margin-left:8px"></span>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">⏱ Fazer isso sozinho, todo mês</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${cfg.automatico ? '🟢 Ligado' : '⚪ Desligado'}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Todo dia 1º, às 4h, anonimiza sozinho tudo que passou do prazo. Ligue só depois de rodar uma vez no botão e conferir o resultado.</div>
        <button class="topbar-btn ${cfg.automatico ? '' : 'primario'}" id="lgpdAuto" style="margin-top:10px">${cfg.automatico ? '⚪ Desligar' : '⏱ Ligar'}</button>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🗑 Exclusão a pedido do titular</div>
        <div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px">Quando o cliente exerce o direito ao esquecimento. Aqui a ficha sai <strong>inteira</strong> — não sobra casca. O ID aparece na URL do link da ficha.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="lgpdCol" style="font-size:13px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
            <option value="fichas">Ficha comum</option>
            <option value="fichas_locador">Ficha do locador</option>
          </select>
          <input id="lgpdFichaId" type="text" placeholder="ID da ficha" style="flex:1;min-width:200px;font-size:13px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary)">
          <button class="topbar-btn perigo" id="lgpdExcluir">🗑 Excluir para sempre</button>
        </div>
        <div id="lgpdExcMsg" class="muted" style="font-size:11px;margin-top:6px"></div>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">📦 O que existe hoje</div>
        <div style="margin-top:6px">${totaisHtml}</div>
      </div>`;

    const lerDias = () => parseInt(document.getElementById('lgpdDias').value, 10);

    document.getElementById('lgpdVer').addEventListener('click', () => {
      const d = lerDias();
      if (!Number.isInteger(d) || d < minimo) { alert(`O prazo mínimo é ${minimo} dias.`); return; }
      carregarLgpd(d);
    });

    document.getElementById('lgpdSalvar').addEventListener('click', async () => {
      const d = lerDias();
      const msg = document.getElementById('lgpdCfgMsg');
      try {
        await lgpdSetConfig({ dias: d, automatico: cfg.automatico });
        msg.textContent = '✓ Prazo salvo.';
        carregarLgpd(d);
      } catch (e) { msg.textContent = 'Erro: ' + e.message; }
    });

    document.getElementById('lgpdAuto').addEventListener('click', async () => {
      const ligar = !cfg.automatico;
      if (!confirm(ligar
        ? `Ligar o automático? Todo dia 1º, às 4h, as fichas com mais de ${cfg.dias} dias serão anonimizadas sozinhas. Não tem volta.`
        : 'Desligar? A partir de agora nada é apagado sem você clicar.')) return;
      try { await lgpdSetConfig({ dias: cfg.dias, automatico: ligar }); carregarLgpd(diasConsultado); }
      catch (e) { alert('Erro: ' + e.message); }
    });

    const btnExp = document.getElementById('lgpdExpurgar');
    btnExp.addEventListener('click', async () => {
      const d = lerDias();
      // Confirmação DIGITADA de propósito: é operação sem volta, não pode sair no reflexo.
      const ok = await confirmarDigitando(
        `Anonimizar ${previa.fichas} ficha(s)?`,
        `Todas as fichas com mais de <strong>${d} dias</strong>. Saem o CPF, o RG, a renda, o endereço e os <strong>anexos</strong>. Fica só a casca (corretor, tipo, status, data). <strong>Não tem volta.</strong>`,
        'APAGAR');
      if (!ok) return;
      const msg = document.getElementById('lgpdExpMsg');
      btnExp.disabled = true; msg.textContent = 'apagando...';
      try {
        const r = await lgpdExpurgar({ dias: d });
        msg.textContent = `✓ ${r.data.fichas} ficha(s) anonimizada(s), ${r.data.anexos} anexo(s) apagado(s).`
          + (r.data.restantes ? ` Faltam ${r.data.restantes} — clique de novo.` : '');
        setTimeout(() => carregarLgpd(d), 1500);
      } catch (e) { msg.textContent = 'Erro: ' + e.message; btnExp.disabled = false; }
    });

    document.getElementById('lgpdExcluir').addEventListener('click', async () => {
      const colecao = document.getElementById('lgpdCol').value;
      const fichaId = document.getElementById('lgpdFichaId').value.trim();
      const msg = document.getElementById('lgpdExcMsg');
      if (!fichaId) { msg.textContent = 'Informe o ID da ficha.'; return; }
      const ok = await confirmarDigitando(
        'Excluir a ficha para sempre?',
        `A ficha <strong>${escapeHtml(fichaId)}</strong> sai inteira (documento + anexos). Use isto só quando o <strong>titular pedir</strong>. <strong>Não tem volta.</strong>`,
        'EXCLUIR');
      if (!ok) return;
      msg.textContent = 'excluindo...';
      try {
        const r = await lgpdExcluirTitular({ colecao, fichaId });
        msg.textContent = `✓ Ficha excluída (${r.data.anexos} anexo(s) apagado(s)).`;
        document.getElementById('lgpdFichaId').value = '';
      } catch (e) { msg.textContent = 'Erro: ' + e.message; }
    });
  } catch (err) {
    cont.innerHTML = `<p class="muted">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
  }
}

// ─── Bug Bot ────────────────────────────────────────────────────────────────
// Três coisas que antes exigiam abrir o e-mail, o GitHub ou o Firestore na mão:
//   1. os achados da última varredura, com "Autorizar correção" (abre o PR);
//   2. pedir uma correção na hora, descrevendo o bug;
//   3. o interruptor do disparo automático em cima de erro (vem desligado).
// Em nenhum caminho o bot faz merge, sobe versão ou publica — ele só abre PR.

const BUG_COR = { alta: '#DC1C2E', media: '#b45309', baixa: '#6b7280' };

async function carregarBugBot() {
  const cont = document.getElementById('bugbotPainel');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const { data } = await botPainel();
    const { autoHabilitado, ultimoLote, erros } = data;

    const pendentes = (ultimoLote?.achados || []).filter(a => a.estado !== 'descartado');
    const achadosHtml = !ultimoLote
      ? '<p class="muted" style="font-size:12px;margin:0">Nenhuma varredura ainda. A primeira roda hoje à meia-noite.</p>'
      : !pendentes.length
        ? '<p class="muted" style="font-size:12px;margin:0">Nada pendente da última varredura. 🎉</p>'
        : pendentes.map(a => {
            const aprovado = a.estado === 'aprovado';
            return `
            <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:999px;color:#fff;background:${BUG_COR[a.gravidade] || BUG_COR.baixa}">${escapeHtml(a.gravidade || '?')}</span>
                <strong style="font-size:13px">${escapeHtml(a.titulo || '')}</strong>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escapeHtml(a.resumo || '')}</div>
              ${a.arquivo ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:monospace">${escapeHtml(a.arquivo)}</div>` : ''}
              <div style="display:flex;gap:6px;margin-top:8px">
                ${aprovado
                  ? '<span style="font-size:11px;color:#16a34a;font-weight:600">✓ correção autorizada — o PR está a caminho</span>'
                  : `<button class="topbar-btn primario bb-aprovar" data-idx="${a.idx}" style="font-size:11px">✓ Autorizar correção</button>
                     <button class="topbar-btn bb-ignorar" data-idx="${a.idx}" style="font-size:11px">Ignorar</button>`}
              </div>
            </div>`;
          }).join('');

    const errosHtml = !erros.length
      ? '<p class="muted" style="font-size:12px;margin:0">Nenhum erro registrado nos últimos 7 dias. 🎉</p>'
      : erros.map(e => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;font-family:monospace">${escapeHtml(e.funcao)}</div>
            <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.mensagem)}</div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${e.quando ? fmtDataHora(e.quando) : ''}</span>
          <button class="topbar-btn bb-corrigir-erro" data-id="${escapeHtml(e.id)}" style="font-size:11px;flex-shrink:0">🔧 Corrigir</button>
        </div>`).join('');

    cont.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🔎 Última varredura</div>
        <div style="font-size:12px;color:var(--text-muted);margin:2px 0 10px">${ultimoLote?.criadoEm ? fmtDataHora(ultimoLote.criadoEm) : 'ainda não rodou'} · roda sozinha todo dia à meia-noite</div>
        ${achadosHtml}
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🔧 Pedir uma correção agora</div>
        <div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px">Descreva o problema como você o vê. O robô lê o código, corrige num branch separado e abre um Pull Request.</div>
        <textarea id="bbDescricao" rows="3" placeholder="Ex.: na aba Agenda, o botão Hoje some depois de trocar de mês." style="width:100%;box-sizing:border-box;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary);resize:vertical"></textarea>
        <button class="topbar-btn primario" id="bbPedir" style="margin-top:8px">Pedir correção</button>
        <span id="bbMsg" class="muted" style="font-size:11px;margin-left:8px"></span>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">⚡ Corrigir sozinho quando um erro estourar</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${autoHabilitado ? '🟢 Ligado' : '⚪ Desligado'}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Com isso ligado, quando uma Cloud Function quebra o robô abre um PR sozinho, sem te perguntar. Mesmo assim ele <strong>não</strong> faz merge — e há limite de 1 PR por tipo de erro a cada 24h. A varredura da meia-noite <strong>não</strong> depende disto.</div>
        <button class="topbar-btn ${autoHabilitado ? '' : 'primario'}" id="bbAuto" style="margin-top:10px">${autoHabilitado ? '⚪ Desligar' : '⚡ Ligar'}</button>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🐞 Erros recentes das Cloud Functions</div>
        <div style="font-size:12px;color:var(--text-muted);margin:2px 0 6px">Últimos 15. Some sozinho depois de 7 dias.</div>
        ${errosHtml}
      </div>`;

    const token = ultimoLote?.token;
    cont.querySelectorAll('.bb-aprovar').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Autorizar a correção deste bug? O robô vai abrir um Pull Request — nada é publicado sem você mergear.')) return;
      b.disabled = true; b.textContent = 'abrindo PR...';
      try { await botAprovarAchado({ token, idx: Number(b.dataset.idx) }); carregarBugBot(); }
      catch (e) { alert('Erro: ' + e.message); b.disabled = false; b.textContent = '✓ Autorizar correção'; }
    }));
    cont.querySelectorAll('.bb-ignorar').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await botIgnorarAchado({ token, idx: Number(b.dataset.idx) }); carregarBugBot(); }
      catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
    }));
    cont.querySelectorAll('.bb-corrigir-erro').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Pedir pro robô corrigir este erro? Ele abre um Pull Request pra você revisar.')) return;
      b.disabled = true; b.textContent = 'abrindo PR...';
      try { await botCorrigirBug({ erroId: b.dataset.id }); b.textContent = '✓ PR a caminho'; }
      catch (e) { alert('Erro: ' + e.message); b.disabled = false; b.textContent = '🔧 Corrigir'; }
    }));

    const btnPedir = document.getElementById('bbPedir');
    btnPedir.addEventListener('click', async () => {
      const descricao = document.getElementById('bbDescricao').value.trim();
      const msg = document.getElementById('bbMsg');
      if (!descricao) { msg.textContent = 'Escreva o que está errado.'; return; }
      btnPedir.disabled = true; msg.textContent = 'acionando o robô...';
      try {
        await botCorrigirBug({ descricao });
        msg.textContent = '✓ Pedido enviado. O PR aparece no GitHub em alguns minutos.';
        document.getElementById('bbDescricao').value = '';
      } catch (e) { msg.textContent = 'Erro: ' + e.message; }
      finally { btnPedir.disabled = false; }
    });

    document.getElementById('bbAuto').addEventListener('click', async () => {
      const ligar = !autoHabilitado;
      if (!confirm(ligar
        ? 'Ligar o automático? Quando uma Cloud Function quebrar, o robô vai abrir um Pull Request sozinho (sem merge, sem publicar).'
        : 'Desligar o automático? O robô só vai corrigir quando VOCÊ pedir.')) return;
      try { await botSetAuto({ habilitado: ligar }); carregarBugBot(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  } catch (err) {
    cont.innerHTML = `<p class="muted">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
  }
}

const AUDIT_LABEL = {
  viu_credencial:     'Abriu app',
  alterou_permissoes: 'Alterou permissões',
  excluiu_imovel:     'Excluiu imóvel',
  excluiu_chamado:    'Excluiu chamado',
  editou_perfil:      'Editou perfil',
  criou_conta:        'Criou conta'
};
const AUDIT_COR = {
  viu_credencial:'#6366f1', alterou_permissoes:'#b45309', excluiu_imovel:'#DC1C2E',
  excluiu_chamado:'#DC1C2E', editou_perfil:'#0ea5e9', criou_conta:'#16a34a'
};

async function carregarAuditoria() {
  const el = document.getElementById('listaAuditoria');
  if (!el) return;
  el.innerHTML = '<p class="muted">carregando...</p>';
  const acao = document.getElementById('auditFiltroAcao')?.value || '';
  try {
    const r = await listarAuditoria({ acao: acao || undefined, limite: 500 });
    const eventos = r.data?.eventos || [];
    const usuarios = r.data?.usuarios || [];
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // Agrupa eventos por ator (uid)
    const grupos = new Map();
    // Semeia com todos os usuários (mesmo os sem atividade)
    for (const u of usuarios) {
      grupos.set(u.uid, { nome: u.nome, email: u.email, eventos: [] });
    }
    for (const e of eventos) {
      const uid = e.ator?.uid || 'sistema';
      if (!grupos.has(uid)) grupos.set(uid, { nome: e.ator?.nome || 'Sistema', email: e.ator?.email || '', eventos: [] });
      grupos.get(uid).eventos.push(e);
    }
    // Ordena: quem tem atividade primeiro (mais recente), depois quem não tem (alfabético)
    const arr = [...grupos.values()].sort((a, b) => {
      const ta = a.eventos.length ? new Date(a.eventos[0].em || 0).getTime() : 0;
      const tb = b.eventos.length ? new Date(b.eventos[0].em || 0).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    if (!arr.length) { el.innerHTML = '<p class="muted">Nenhum evento registrado.</p>'; return; }
    const fmtDT = s => s ? new Date(s).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const sanfonas = arr.map((g, idx) => {
      const semAtiv = g.eventos.length === 0;
      const ult = semAtiv ? 'sem atividade' : ('Última: ' + fmtDT(g.eventos[0]?.em));
      const corCnt = semAtiv ? 'var(--text-muted)' : 'var(--text-primary)';
      const linhas = semAtiv
        ? `<div style="padding:14px 16px;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border)">Nenhuma ação sensível registrada para este usuário.</div>`
        : g.eventos.map(e => {
            const cor = AUDIT_COR[e.acao] || '#6b7280';
            const lbl = AUDIT_LABEL[e.acao] || e.acao;
            const alvo = e.alvo ? `${esc(e.alvo.tipo || '')}${e.alvo.id ? ' · ' + esc(e.alvo.id) : ''}` : '—';
            const det = e.detalhes && Object.keys(e.detalhes).length
              ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:monospace;word-break:break-all">${esc(JSON.stringify(e.detalhes))}</div>` : '';
            return `<div style="display:grid;grid-template-columns:130px 150px 1fr;gap:12px;padding:8px 12px;border-top:1px solid var(--border);align-items:start">
              <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${fmtDT(e.em)}</span>
              <span style="font-size:11px;font-weight:600;color:${cor};background:${cor}18;padding:2px 8px;border-radius:6px;text-align:center;justify-self:start">${esc(lbl)}</span>
              <div style="font-size:12px">${alvo}${det}</div>
            </div>`;
          }).join('');
      const opac = semAtiv ? 'opacity:.65' : '';
      return `<details style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--surface);overflow:hidden;${opac}">
        <summary style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none">
          <div style="display:flex;flex-direction:column;gap:2px">
            <strong style="font-size:13px;color:${corCnt}">${esc(g.nome)}</strong>
            <span style="font-size:11px;color:var(--text-muted)">${esc(g.email)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:11px;color:var(--text-muted)">${ult}</span>
            <span style="font-size:11px;font-weight:700;background:var(--hover);border:1px solid var(--border);padding:3px 10px;border-radius:12px">${g.eventos.length} evento${g.eventos.length !== 1 ? 's' : ''}</span>
            <span style="font-size:14px;color:var(--text-muted)">▾</span>
          </div>
        </summary>
        <div>${linhas}</div>
      </details>`;
    }).join('');
    el.innerHTML = `<p class="muted" style="font-size:11px;margin-bottom:12px">Retenção: últimos 15 eventos por pessoa · limpeza diária.</p>${sanfonas}`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger);font-size:12px">Erro: ${e.message}</p>`;
  }
}

document.getElementById('btnAuditFiltrar')?.addEventListener('click', carregarAuditoria);
document.getElementById('btnAuditAtualizar')?.addEventListener('click', carregarAuditoria);

async function carregarTudo() {
  carregarLancamento();
  carregarSeguranca();
  await Promise.all([carregarBanner(), carregarCredenciais(), carregarUsuarios(), carregarCodigos(), carregarStatusApps()]);
}

// ─── Materiais de Treinamento ─────────────────────────────────────────────────
const elListaMateriais = document.getElementById('listaMateriais');
let materialUploadTarget = null; // { itemId, nomeAnteriorUrl } — item que receberá o upload

async function carregarMateriais() {
  elListaMateriais.innerHTML = '<p class="muted">carregando...</p>';
  let links = {};
  try { const r = await getTreinamentoLinks(); links = r.data.links || {}; }
  catch (e) { elListaMateriais.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; return; }

  elListaMateriais.innerHTML = TREINAMENTO_CATS.map(cat => `
    <div class="material-cat">
      <div class="material-cat-head">${cat.emoji} ${cat.nome}</div>
      <table class="users-table">
        <tbody>
          ${cat.itens.map(item => {
            const link = links[item.id];
            const temArquivo = !!(link && link.url);
            const nomeArquivo = temArquivo ? decodeURIComponent(link.url.split('%2F').pop().split('?')[0]) : '';
            const tipo = link?.tipo || '';
            const icone = { pdf:'📄', video:'▶', drive:'📁', link:'🔗' }[tipo] || '📎';
            return `
              <tr data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}">
                <td style="width:220px;font-weight:600;font-size:12px">${item.nome}</td>
                <td>
                  ${temArquivo
                    ? `<span class="badge ok">${icone} ${escapeHtml(nomeArquivo.slice(0,40))}</span>`
                    : '<span class="badge falta">Sem arquivo</span>'}
                </td>
                <td class="acoes-user">
                  <button class="topbar-btn mat-upload" data-item="${item.id}" data-url="${escapeHtml(link?.url || '')}">${temArquivo ? 'Trocar' : '↑ Enviar'}</button>
                  ${temArquivo ? `<button class="topbar-btn perigo mat-remover" data-item="${item.id}" data-url="${escapeHtml(link.url)}">Remover</button>` : ''}
                  ${temArquivo ? `<a class="topbar-btn" href="${escapeHtml(link.url)}" target="_blank">Abrir ↗</a>` : ''}
                  <div class="mat-progress" id="prog-${item.id}" hidden>
                    <div class="mat-progress-bar" id="bar-${item.id}"></div>
                    <span id="pct-${item.id}">0%</span>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`).join('');

  // Upload
  elListaMateriais.querySelectorAll('.mat-upload').forEach(btn => {
    btn.addEventListener('click', () => {
      materialUploadTarget = { itemId: btn.dataset.item, urlAnterior: btn.dataset.url };
      document.getElementById('materialFileInput').click();
    });
  });

  // Remover
  elListaMateriais.querySelectorAll('.mat-remover').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmar(`Remover o arquivo de "${btn.closest('tr').querySelector('td').textContent.trim()}"?`))) return;
      try {
        // Apaga do Storage se for URL do Firebase
        if (btn.dataset.url && btn.dataset.url.includes('firebasestorage')) {
          try { await deleteObject(ref(storage, btn.dataset.url)); } catch (_) {}
        }
        await setTreinamentoLink({ itemId: btn.dataset.item, url: '', tipo: 'link' });
        carregarMateriais();
      } catch (e) { alert('Erro: ' + e.message); }
    });
  });
}

// Upload via input de arquivo
document.getElementById('materialFileInput').addEventListener('change', async () => {
  const file = document.getElementById('materialFileInput').files[0];
  document.getElementById('materialFileInput').value = '';
  if (!file || !materialUploadTarget) return;

  const { itemId, urlAnterior } = materialUploadTarget;
  materialUploadTarget = null;

  // Detecta tipo pelo nome
  const ext = file.name.split('.').pop().toLowerCase();
  const tipo = ext === 'pdf' ? 'pdf' : ['mp4','mov','avi'].includes(ext) ? 'video' : 'link';

  // Mostra barra de progresso
  const progEl = document.getElementById(`prog-${itemId}`);
  const barEl  = document.getElementById(`bar-${itemId}`);
  const pctEl  = document.getElementById(`pct-${itemId}`);
  if (progEl) { progEl.hidden = false; }

  try {
    // Apaga arquivo anterior do Storage se existia
    if (urlAnterior && urlAnterior.includes('firebasestorage')) {
      try { await deleteObject(ref(storage, urlAnterior)); } catch (_) {}
    }

    // Faz upload pro Firebase Storage
    const storageRef = ref(storage, `treinamentos/${itemId}/${Date.now()}_${file.name}`);
    const task = uploadBytesResumable(storageRef, file);

    await new Promise((resolve, reject) => {
      task.on('state_changed',
        snap => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          if (barEl) barEl.style.width = pct + '%';
          if (pctEl) pctEl.textContent = pct + '%';
        },
        reject,
        resolve
      );
    });

    const downloadURL = await getDownloadURL(task.snapshot.ref);
    await setTreinamentoLink({ itemId, url: downloadURL, tipo });
    carregarMateriais();
  } catch (e) {
    if (progEl) progEl.hidden = true;
    alert('Erro no upload: ' + e.message);
  }
});

// ─── Banner principal (carrossel) ─────────────────────────────────────────────
async function carregarLancamento() {
  const cont = document.getElementById('lancamentoLocacoes');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const [perm, versao] = await Promise.all([getMinhasPermissoes(), window.hubApi.getAppVersion()]);
    const publicada = perm.data.locacoesPublicadaEm || '';
    const jaPublicada = !!publicada && versao === publicada;
    cont.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🧪 Versão de teste (esta)</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${versao}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${jaPublicada ? '✓ já publicada para todos' : 'só quem tem "Acesso de teste" vê o módulo'}</div>
          ${jaPublicada
            ? `<button class="topbar-btn" id="btnVoltarTeste" style="margin-top:10px">↩ Voltar pra teste</button>`
            : `<button class="topbar-btn primario" id="btnPublicar" style="margin-top:10px">🚀 Publicar ${versao} para todos</button>`}
        </div>
        <div style="flex:1;min-width:220px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">📦 Publicada para todos</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${publicada || '—'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${publicada ? 'todos nesta versão veem o módulo' : 'ainda ninguém (só testadores)'}</div>
        </div>
      </div>`;
    const btnPub = document.getElementById('btnPublicar');
    if (btnPub) btnPub.addEventListener('click', async () => {
      if (!confirm(`Publicar a Gestão de Locações (versão ${versao}) para TODOS os usuários?`)) return;
      btnPub.disabled = true;
      try { await publicarLocacoes({ versao }); carregarLancamento(); }
      catch (e) { alert('Erro: ' + e.message); btnPub.disabled = false; }
    });
    const btnVolta = document.getElementById('btnVoltarTeste');
    if (btnVolta) btnVolta.addEventListener('click', async () => {
      if (!confirm('Voltar a Gestão de Locações para modo de teste (esconde de quem não tem Acesso de teste)?')) return;
      btnVolta.disabled = true;
      try { await publicarLocacoes({ versao: '' }); carregarLancamento(); }
      catch (e) { alert('Erro: ' + e.message); btnVolta.disabled = false; }
    });
  } catch (e) {
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

// ─── Novidades (patch notes) ──────────────────────────────────────────────────
// Escreve a nota de cada versão (Novo/Melhorias/Correções, um item por linha). A
// versão vem preenchida com a do app atual. O corretor vê no botão "Novidades".
let novidadesCache = [];
async function carregarNovidades() {
  const cont = document.getElementById('novidadesPainel');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const [versaoApp, res] = await Promise.all([window.hubApi.getAppVersion(), listarNovidades({})]);
    novidadesCache = (res.data && res.data.novidades) || [];
    renderNovidades(versaoApp);
  } catch (e) {
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}
function renderNovidades(versaoApp, edit) {
  const cont = document.getElementById('novidadesPainel');
  const a = edit || { versao: versaoApp, novo: [], melhorias: [], correcoes: [] };
  const lista = novidadesCache.map(n => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <div style="flex:1"><strong>v${escHtml(n.versao)}</strong><span style="color:var(--text-muted);font-size:12px"> · ${n.novo.length + n.melhorias.length + n.correcoes.length} itens</span></div>
      <button class="topbar-btn" data-edit-nov="${escHtml(n.versao)}">Editar</button>
      <button class="topbar-btn" data-del-nov="${escHtml(n.versao)}" style="color:#dc2626">Excluir</button>
    </div>`).join('') || '<p class="muted">Nenhuma novidade ainda.</p>';
  cont.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">${edit ? 'Editar' : 'Nova'} novidade</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">💡 Dica: comece um item com <code style="background:var(--border);padding:1px 5px;border-radius:4px">@gestor </code> para ele aparecer <strong>só para o gestor</strong> (corretor e administrativo não veem).</div>
      <label style="font-size:12px;color:var(--text-muted)">Versão</label>
      <input id="novVersao" value="${escHtml(a.versao)}" ${edit ? 'readonly title="A versão identifica a nota; para outra versão, crie uma nova"' : ''} style="width:130px;display:block;margin:4px 0 12px${edit ? ';opacity:.7' : ''}" />
      <label style="font-size:12px;color:var(--text-muted)">Novidades <span style="opacity:.7">(um item por linha)</span></label>
      <textarea id="novNovo" rows="3" style="width:100%;margin:4px 0 12px">${escHtml((a.novoRaw || a.novo).join('\n'))}</textarea>
      <label style="font-size:12px;color:var(--text-muted)">Melhorias <span style="opacity:.7">(um por linha)</span></label>
      <textarea id="novMelhorias" rows="3" style="width:100%;margin:4px 0 12px">${escHtml((a.melhoriasRaw || a.melhorias).join('\n'))}</textarea>
      <label style="font-size:12px;color:var(--text-muted)">Correções <span style="opacity:.7">(um por linha)</span></label>
      <textarea id="novCorrecoes" rows="2" style="width:100%;margin:4px 0 12px">${escHtml((a.correcoesRaw || a.correcoes).join('\n'))}</textarea>
      <button class="topbar-btn primario" id="btnSalvarNov">Salvar novidade</button>
      ${edit ? '<button class="topbar-btn" id="btnCancelarNov" style="margin-left:8px">Cancelar</button>' : ''}
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Publicadas</div>${lista}`;
  document.getElementById('btnSalvarNov').addEventListener('click', salvarNovidadeUI);
  const bc = document.getElementById('btnCancelarNov');
  if (bc) bc.addEventListener('click', () => renderNovidades(versaoApp));
  cont.querySelectorAll('[data-edit-nov]').forEach(b => b.addEventListener('click', () => {
    const n = novidadesCache.find(x => x.versao === b.dataset.editNov);
    if (n) renderNovidades(versaoApp, n);
  }));
  cont.querySelectorAll('[data-del-nov]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Excluir a novidade da v${b.dataset.delNov}?`)) return;
    try { await excluirNovidade({ versao: b.dataset.delNov }); carregarNovidades(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
}
async function salvarNovidadeUI() {
  const versao = document.getElementById('novVersao').value.trim();
  const linhas = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const btn = document.getElementById('btnSalvarNov');
  btn.disabled = true;
  try {
    await salvarNovidade({ versao, novo: linhas('novNovo'), melhorias: linhas('novMelhorias'), correcoes: linhas('novCorrecoes') });
    await carregarNovidades();
  } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
}

// ─── Segurança — Modo Cofre (anti-dump de credenciais) ────────────────────────
async function carregarSeguranca() {
  const cont = document.getElementById('segurancaCofre');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const r = await getModoCofre();
    const { cofreAtivo, maxJanela, janelaSeg } = r.data;
    cont.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch">
        <div style="flex:1;min-width:260px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🔐 Modo Cofre</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${cofreAtivo ? '🟢 Ligado' : '⚪ Desligado'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Bloqueia acima de <strong>${maxJanela}</strong> sistemas diferentes em <strong>${janelaSeg}s</strong> por pessoa.</div>
          <button class="topbar-btn ${cofreAtivo ? '' : 'primario'}" id="btnCofre" style="margin-top:10px">${cofreAtivo ? '⚪ Desligar' : '🔐 Ligar Modo Cofre'}</button>
        </div>
        <div style="flex:1;min-width:260px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">🔒 Criptografia em repouso</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">KMS ativo</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Ao salvar uma senha, ela é criptografada com uma chave no Google KMS. Ao ler, é decriptada só na hora. Use o botão pra migrar as antigas.</div>
          <button class="topbar-btn primario" id="btnMigrarCofre" style="margin-top:10px">🔒 Migrar credenciais existentes</button>
          <div id="migrarCofreMsg" class="muted" style="font-size:11px;margin-top:6px"></div>
        </div>
      </div>`;
    const btn = document.getElementById('btnCofre');
    btn.addEventListener('click', async () => {
      const ligar = !cofreAtivo;
      if (!confirm(ligar
        ? 'Ligar o Modo Cofre? A partir de agora, quem tentar puxar muitas senhas de sistemas em poucos minutos será bloqueado. Uso normal não é afetado.'
        : 'Desligar o Modo Cofre? As senhas voltam a poder ser puxadas sem limite.')) return;
      btn.disabled = true;
      try { await setModoCofre({ ativo: ligar }); carregarSeguranca(); }
      catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
    });
    const btnMig = document.getElementById('btnMigrarCofre');
    const msgMig = document.getElementById('migrarCofreMsg');
    btnMig.addEventListener('click', async () => {
      if (!confirm('Criptografar TODAS as senhas de sistemas que ainda estão em texto puro? Uma vez feito, o banco só terá senhas criptografadas.')) return;
      btnMig.disabled = true; msgMig.textContent = 'Migrando…';
      try {
        const r = await migrarCredenciaisCofre();
        const { migradas, jaOk, erros, total } = r.data || {};
        msgMig.textContent = `✓ Migradas: ${migradas} · Já criptografadas: ${jaOk} · Erros: ${erros} (de ${total} total)`;
        msgMig.style.color = erros ? 'var(--danger)' : '#16a34a';
      } catch (e) {
        msgMig.textContent = 'Erro: ' + e.message;
        msgMig.style.color = 'var(--danger)';
      } finally {
        btnMig.disabled = false;
      }
    });
  } catch (e) {
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

async function carregarBanner() {
  const el = document.getElementById('bannerAdmin');
  el.innerHTML = '<p class="muted">carregando...</p>';
  let banners = [];
  try { const r = await listarBanners(); banners = r.data.banners || []; }
  catch (e) { el.innerHTML = `<p class="erro">Erro: ${e.message}</p>`; return; }
  renderBannerAdmin(el, banners);
}

function renderBannerAdmin(el, banners) {
  el.innerHTML = `
    <div class="banner-admin-lista">
      ${banners.map((b, i) => `
        <div class="banner-admin-item">
          <span class="banner-admin-num">${i + 1}</span>
          ${banners.length > 1 ? `
          <span style="display:inline-flex;flex-direction:column;gap:2px;flex-shrink:0">
            <button class="topbar-btn banner-mover" data-idx="${i}" data-dir="-1" title="Subir na ordem" ${i === 0 ? 'disabled' : ''} style="padding:0 6px;font-size:10px;line-height:16px">▲</button>
            <button class="topbar-btn banner-mover" data-idx="${i}" data-dir="1" title="Descer na ordem" ${i === banners.length - 1 ? 'disabled' : ''} style="padding:0 6px;font-size:10px;line-height:16px">▼</button>
          </span>` : ''}
          ${b.tipo === 'video'
            ? `<video src="${b.mediaUrl}" class="banner-preview-img" muted preload="metadata"></video>`
            : `<img src="${b.imagem || b.mediaUrl}" class="banner-preview-img" alt="Banner ${i+1}">`}
          <span class="muted" style="font-size:10px;flex-shrink:0">${b.tipo?.toUpperCase() || 'IMG'}</span>
          <button class="topbar-btn perigo banner-rm" data-id="${b.id}">✕ Remover</button>
        </div>`).join('')}
      ${!banners.length ? '<div class="banner-preview-vazio"><span>Nenhum banner cadastrado</span></div>' : ''}
    </div>
    <div class="banner-admin-acoes" style="margin-top:10px">
      <button class="topbar-btn primario" id="bannerAdicionar">
        <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        ${banners.length ? 'Adicionar outro banner' : 'Enviar banner'}
      </button>
      ${banners.length > 1 ? `<span class="muted" style="font-size:11px">${banners.length} banners · alternam a cada 15s · use ▲▼ pra mudar a ordem</span>` : ''}
    </div>`;

  document.getElementById('bannerAdicionar').addEventListener('click', () => document.getElementById('bannerFileInput').click());
  el.querySelectorAll('.banner-rm').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmar('Remover este banner?'))) return;
      try { await removerBanner({ id: btn.dataset.id }); carregarBanner(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
  // Subir/descer: troca de posição com o vizinho e grava a nova ordem completa
  el.querySelectorAll('.banner-mover').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.idx, 10), j = i + parseInt(btn.dataset.dir, 10);
      if (j < 0 || j >= banners.length) return;
      const nova = banners.slice();
      [nova[i], nova[j]] = [nova[j], nova[i]];
      el.querySelectorAll('.banner-mover').forEach(b => b.disabled = true);
      try { await reordenarBanners({ ids: nova.map(b => b.id) }); }
      catch (e) { alert('Erro ao reordenar: ' + e.message); }
      carregarBanner();
    });
  });
}

// Calcula duração total do GIF em ms lendo os delays dos frames no binário
async function calcularDuracaoGif(file) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let ms = 0, i = 6;
    const flags = buf[10];
    if (flags & 0x80) i += 3 * (2 << (flags & 7)); // pula global color table
    i += 7;
    while (i < buf.length && buf[i] !== 0x3B) {
      if (buf[i] === 0x21 && buf[i+1] === 0xF9) { // Graphic Control Extension
        ms += ((buf[i+4] | buf[i+5] << 8) || 10) * 10; // delay em centisegundos → ms
        i += 8;
      } else if (buf[i] === 0x21) { // outra extensão
        i += 2;
        while (buf[i]) i += buf[i] + 1;
        i++;
      } else if (buf[i] === 0x2C) { // Image Descriptor
        const lf = buf[i+9];
        if (lf & 0x80) i += 3 * (2 << (lf & 7));
        i += 11;
        while (buf[i]) i += buf[i] + 1;
        i++;
      } else break;
    }
    return ms > 0 ? ms : null;
  } catch { return null; }
}

document.getElementById('bannerFileInput').addEventListener('change', async () => {
  const f = document.getElementById('bannerFileInput').files[0];
  document.getElementById('bannerFileInput').value = '';
  if (!f) return;

  const ext = f.name.split('.').pop().toLowerCase();
  const isVideo = f.type === 'video/mp4' || ext === 'mp4';
  const isGif   = f.type === 'image/gif'  || ext === 'gif';
  const btn = document.getElementById('bannerAdicionar');
  btn.disabled = true; btn.textContent = 'Enviando...';

  try {
    if (isVideo || isGif) {
      // GIF e MP4 vão pro Firebase Storage (sem limite de 1MB)
      const sRef = ref(storage, `banners/${Date.now()}_${f.name}`);
      const task = uploadBytesResumable(sRef, f);
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          snap => {
            const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
            btn.textContent = `Enviando ${pct}%...`;
          },
          reject, resolve
        );
      });
      const mediaUrl = await getDownloadURL(task.snapshot.ref);
      let duracao = null;
      if (isGif) duracao = await calcularDuracaoGif(f);
      await adicionarBanner({ mediaUrl, tipo: isVideo ? 'video' : 'gif', ...(duracao ? { duracao } : {}) });
    } else {
      // PNG/JPG: redimensiona via canvas e salva como base64 no Firestore
      await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('Não consegui ler a imagem.'));
          img.onload = async () => {
            // try/catch obrigatório: sem ele, uma falha do adicionarBanner (rede, cold
            // start, recusa do servidor) deixa a Promise externa PENDENTE pra sempre —
            // o botão ficava travado em "Enviando..." sem alerta. Só onerror rejeitava.
            try {
              // Força exatamente 1800×300 com corte central (cover), garantindo resolução fixa
              const TARGET_W = 1800, TARGET_H = 300;
              const scale = Math.max(TARGET_W / img.width, TARGET_H / img.height);
              const scaledW = Math.round(img.width * scale);
              const scaledH = Math.round(img.height * scale);
              const offsetX = Math.round((scaledW - TARGET_W) / 2);
              const offsetY = Math.round((scaledH - TARGET_H) / 2);
              const canvas = document.createElement('canvas');
              canvas.width = TARGET_W; canvas.height = TARGET_H;
              canvas.getContext('2d').drawImage(img, -offsetX, -offsetY, scaledW, scaledH);
              const dataURL = canvas.toDataURL('image/jpeg', 0.88);
              if (dataURL.length > 600000) { reject(new Error('Imagem muito grande após compressão.')); return; }
              await adicionarBanner({ imagem: dataURL, tipo: 'imagem' });
              resolve();
            } catch (err) { reject(err); }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
    }
    carregarBanner();
  } catch (e) {
    alert('Erro: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

// ─── Status dos apps (avisos de instabilidade) ───────────────────────────────
function escHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function carregarStatusApps() {
  elListaStatus.innerHTML = '<p class="muted">carregando...</p>';
  let ativos = {};
  try {
    const r = await listarStatusApps();
    ativos = r.data.status || {};
  } catch (e) {
    elListaStatus.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
    return;
  }
  elListaStatus.innerHTML = `
    <table class="users-table">
      <thead><tr><th>App</th><th>Mensagem de aviso</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${TODOS_APPS.map(a => {
          const ativo = a.key in ativos;
          const msg = ativos[a.key] || '';
          return `
            <tr data-key="${a.key}">
              <td><strong>${escHtml(a.nome)}</strong></td>
              <td>
                <select class="foto-input status-msg">
                  <option value="Instável"      ${msg === 'Instável'      ? 'selected' : ''}>⚠ Instável (abre com aviso)</option>
                  <option value="Em manutenção" ${msg === 'Em manutenção' ? 'selected' : ''}>🔧 Em manutenção (bloqueia)</option>
                  <option value="Indisponível"  ${msg === 'Indisponível'  ? 'selected' : ''}>⛔ Indisponível (bloqueia)</option>
                </select>
              </td>
              <td>${ativo ? '<span class="badge falta">⚠ Com aviso</span>' : '<span class="badge ok">OK</span>'}</td>
              <td class="acoes-user">
                <button class="topbar-btn status-ativar">${ativo ? 'Atualizar' : 'Ativar aviso'}</button>
                ${ativo ? '<button class="topbar-btn perigo status-limpar">Limpar</button>' : ''}
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  elListaStatus.querySelectorAll('tr[data-key]').forEach(row => {
    const key = row.dataset.key;
    const input = row.querySelector('.status-msg');
    row.querySelector('.status-ativar').addEventListener('click', async () => {
      const mensagem = input.value; // "Indisponível" ou "Em manutenção"
      try { await setStatusApp({ siteKey: key, mensagem, ativo: true }); carregarStatusApps(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
    row.querySelector('.status-limpar')?.addEventListener('click', async () => {
      try { await setStatusApp({ siteKey: key, ativo: false }); carregarStatusApps(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
}

async function carregarCredenciais() {
  elListaCred.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listCredentials();
    const existentes = new Map(resp.data.map(r => [r.siteKey, r]));

    elListaCred.innerHTML = '';
    for (const site of SITES) {
      const dado = existentes.get(site.key);
      const status = dado?.temSenha
        ? `<span class="badge ok">✓ Cadastrada</span>`
        : `<span class="badge falta">! Não cadastrada</span>`;
      const login = dado?.login ? `<code>${escHtml(dado.login)}</code>` : '<em class="muted">—</em>';

      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <div class="admin-card-head">
          <h4>${site.nome}</h4>
          ${status}
        </div>
        <p class="admin-card-row">Login: ${login}</p>
        <p class="admin-card-row">Senha: <em class="muted">oculta</em></p>
        <div class="admin-card-actions">
          <button class="topbar-btn" data-acao="editar" data-key="${site.key}" data-nome="${site.nome}">Editar</button>
          ${dado ? `<button class="topbar-btn perigo" data-acao="excluir" data-key="${site.key}">Excluir</button>` : ''}
        </div>
      `;
      elListaCred.appendChild(card);
    }

    elListaCred.querySelectorAll('button[data-acao]').forEach(b => {
      b.addEventListener('click', async () => {
        const acao = b.dataset.acao;
        const key  = b.dataset.key;
        if (acao === 'editar') abrirModalCredencial(key, b.dataset.nome);
        if (acao === 'excluir') {
          if (!(await confirmar(`Excluir as credenciais de ${key}?`))) return;
          await deleteCredentials({ siteKey: key });
          carregarCredenciais();
        }
      });
    });
  } catch (err) {
    elListaCred.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

async function abrirModalCredencial(siteKey, nome) {
  document.getElementById('modalCredTitulo').textContent = `Credencial: ${nome}`;
  document.getElementById('credSiteKey').value = siteKey;
  document.getElementById('credLogin').value = '';
  document.getElementById('credPassword').value = '';
  try {
    const r = await getCredentialAdmin({ siteKey });
    document.getElementById('credLogin').value = r.data.login || '';
    document.getElementById('credPassword').value = r.data.password || '';
  } catch (e) { /* sem credenciais ainda */ }
  modalCred.showModal();
}

async function carregarCodigos() {
  elListaCodigos.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listarCodigosConvite();
    const lista = resp.data;
    if (lista.length === 0) {
      elListaCodigos.innerHTML = '<p class="muted">Nenhum código ainda. Clique em "+ Gerar código" pra criar.</p>';
      return;
    }
    elListaCodigos.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Código</th><th>Usos</th><th>Admin?</th><th>Validade</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${lista.map(c => {
            const status = c.expirado ? '<span class="badge falta">Expirado</span>'
                         : c.esgotado ? '<span class="badge falta">Esgotado</span>'
                         : '<span class="badge ok">Ativo</span>';
            const validade = c.expiraEm ? new Date(c.expiraEm).toLocaleDateString('pt-BR') : 'Sem validade';
            return `
              <tr>
                <td><code>${c.codigo}</code></td>
                <td>${c.usos}/${c.maxUsos}</td>
                <td>${c.fazAdmin ? 'Sim' : 'Não'}</td>
                <td>${validade}</td>
                <td>${status}</td>
                <td><button class="topbar-btn perigo" data-cod="${c.codigo}">Excluir</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    elListaCodigos.querySelectorAll('button[data-cod]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!(await confirmar(`Excluir o código ${b.dataset.cod}?`))) return;
        try {
          await excluirCodigoConvite({ codigo: b.dataset.cod });
          carregarCodigos();
        } catch (e) { alert('Erro: ' + e.message); }
      });
    });
  } catch (err) {
    elListaCodigos.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

// Clubes da imobiliária (dropdown do Admin, ao lado do nome). Ordem = como o Nathan mandou.
const CLUBES_ADMIN = ['Calça Branca Club', 'Sem Meia Club', 'Producer Club', 'Executive Club', '100% Club', 'Platinum Club'];
function clubeOpts(atual) {
  atual = atual || '';
  // Se o valor salvo não estiver na lista (algo antigo/digitado), mantém como 1ª opção pra não sumir.
  const lista = (!atual || CLUBES_ADMIN.includes(atual)) ? CLUBES_ADMIN : [atual, ...CLUBES_ADMIN];
  return '<option value="">— Clube —</option>' +
    lista.map(c => `<option value="${escHtml(c)}"${c === atual ? ' selected' : ''}>${escHtml(c)}</option>`).join('');
}

async function carregarUsuarios() {
  elListaUser.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listUsers();
    // Ordem alfabética por e-mail (antes vinha na ordem crua do Auth, difícil de achar alguém)
    const usuarios = (resp.data || []).slice().sort((a, b) => (a.email || '').localeCompare(b.email || '', 'pt-BR'));
    // Salva o total para usar na barra de avisos e re-renderiza com o total correto
    totalUsuariosAdmin = usuarios.length;
    if (notificacoesCache.length) renderAvisosEnviados(notificacoesCache);
    elListaUser.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Email</th><th>Clube / Comissão</th><th>Admin</th><th>Criado</th><th>Último acesso</th><th>Último app</th><th></th></tr>
        </thead>
        <tbody>
          ${usuarios.map(u => `
            <tr>
              <td><span class="presence-dot ${presenceMap[u.uid] ? 'online' : 'offline'}" data-uid="${u.uid}" title="${presenceMap[u.uid] ? 'Online' : 'Offline'}"></span> ${u.email ? escHtml(u.email) : '<em>sem email</em>'}</td>
              <td class="user-extra">
                <select class="in-clube" data-uid="${u.uid}">${clubeOpts(u.clube)}</select>
                <input class="in-comissao" data-uid="${u.uid}" value="${escHtml(u.comissao || '')}" placeholder="Comissão" maxlength="40">
                <button class="topbar-btn salvar-extra" data-uid="${u.uid}">Salvar</button>
              </td>
              <td>
                <input type="checkbox" ${u.isAdmin ? 'checked' : ''} data-uid="${u.uid}" class="toggle-admin">
              </td>
              <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
              <td>${u.lastAppAt ? fmtDataHora(u.lastAppAt) : (u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString('pt-BR') : 'nunca')}</td>
              <td>${u.lastApp ? `${escHtml(u.lastApp)} · ${fmtDataHora(u.lastAppAt)}` : '<span class="muted">—</span>'}</td>
              <td class="acoes-user">
                <button class="topbar-btn" data-perm="${u.uid}" data-email="${escHtml(u.email || '')}">Permissões</button>
                <button class="topbar-btn perigo" data-uid="${u.uid}" data-email="${escHtml(u.email || '')}">Excluir</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    elListaUser.querySelectorAll('.toggle-admin').forEach(cb => {
      cb.addEventListener('change', async () => {
        try {
          await setUserAdmin({ uid: cb.dataset.uid, isAdmin: cb.checked });
        } catch (e) { alert('Erro: ' + e.message); cb.checked = !cb.checked; }
      });
    });
    elListaUser.querySelectorAll('.acoes-user button[data-uid]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!(await confirmar(`Excluir o usuário ${b.dataset.email}? Essa ação não pode ser desfeita.`))) return;
        try {
          await deleteUserAccount({ uid: b.dataset.uid });
          carregarUsuarios();
        } catch (e) { alert('Erro: ' + e.message); }
      });
    });
    elListaUser.querySelectorAll('button[data-perm]').forEach(b => {
      b.addEventListener('click', () => abrirModalPermissoes(b.dataset.perm, b.dataset.email));
    });
    // Salvar clube + comissão da pessoa (por linha)
    elListaUser.querySelectorAll('.salvar-extra').forEach(b => {
      b.addEventListener('click', async () => {
        const uid = b.dataset.uid;
        const clubeEl = elListaUser.querySelector('.in-clube[data-uid="' + uid + '"]');
        const comEl = elListaUser.querySelector('.in-comissao[data-uid="' + uid + '"]');
        const orig = b.textContent;
        b.disabled = true; b.textContent = 'Salvando...';
        try {
          await adminSetPessoaExtra({ uid, clube: clubeEl ? clubeEl.value : '', comissao: comEl ? comEl.value : '' });
          b.textContent = 'Salvo ✓';
          setTimeout(() => { b.textContent = orig; b.disabled = false; }, 1500);
        } catch (e) { alert('Erro: ' + e.message); b.textContent = orig; b.disabled = false; }
      });
    });
  } catch (err) {
    elListaUser.innerHTML = `<p class="erro">Erro: ${err.message}</p>`;
  }
}

// ─── Chamados de Suporte ────────────────────────────────────────────────────
async function carregarChamados() {
  const el = document.getElementById('listaChamados');
  if (!el) return;
  el.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const r = await listarChamados();
    const lista = r.data || [];
    if (!lista.length) {
      el.innerHTML = '<p class="muted">Nenhum chamado recebido.</p>';
      return;
    }
    el.innerHTML = `
      <table class="users-table">
        <thead><tr><th>Usuário</th><th>Mensagem</th><th>Data</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${lista.map(c => {
            const data = fmtDataHora(c.criadoEm);
            const statusLabel = c.status === 'aberto'
              ? '<span style="color:#e8a735;font-weight:600">Aberto</span>'
              : '<span style="color:#22c55e;font-weight:600">Resolvido</span>';
            const msgPreview = escHtml((c.mensagem || '').slice(0, 80)) + (c.mensagem?.length > 80 ? '...' : '');
            return `<tr>
              <td>
                <strong style="font-size:12px">${escHtml(c.criadoPorNome)}</strong>
                <div class="muted" style="font-size:10px">${escHtml(c.criadoPorEmail)}</div>
              </td>
              <td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msgPreview}${c.temImagem ? ' 📎' : ''}</td>
              <td style="font-size:12px;white-space:nowrap">${data}</td>
              <td>${statusLabel}</td>
              <td>${c.status === 'aberto'
                ? `<button class="topbar-btn primario chamado-responder" data-id="${c.id}" data-nome="${escHtml(c.criadoPorNome)}" data-email="${escHtml(c.criadoPorEmail)}" data-msg="${escHtml(c.mensagem || '')}">Responder</button>`
                : `<span class="muted" style="font-size:11px">${escHtml((c.resposta || '').slice(0, 60))}${(c.resposta || '').length > 60 ? '...' : ''}</span>
                   <button class="topbar-btn perigo chamado-excluir" data-id="${c.id}" style="margin-left:6px;font-size:11px">Excluir</button>`
              }</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    el.querySelectorAll('.chamado-responder').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('chamadoResponderId').value = btn.dataset.id;
        document.getElementById('chamadoDeNome').textContent = btn.dataset.nome;
        document.getElementById('chamadoDeEmail').textContent = btn.dataset.email;
        document.getElementById('chamadoMensagemOriginal').textContent = btn.dataset.msg;
        document.getElementById('chamadoResposta').value = '';
        document.getElementById('modalResponderChamado').showModal();
      });
    });
    el.querySelectorAll('.chamado-excluir').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '...';
        try { await excluirChamado({ chamadoId: btn.dataset.id }); carregarChamados(); }
        catch (err) { alert('Erro: ' + err.message); btn.disabled = false; btn.textContent = 'Excluir'; }
      });
    });
  } catch (e) {
    el.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

document.getElementById('cancelarChamado').addEventListener('click', () => {
  document.getElementById('modalResponderChamado').close();
});

document.getElementById('formResponderChamado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const chamadoId = document.getElementById('chamadoResponderId').value;
  const resposta = document.getElementById('chamadoResposta').value.trim();
  if (!resposta) return;
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    await responderChamado({ chamadoId, resposta });
    document.getElementById('modalResponderChamado').close();
    carregarChamados();
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Resolver e responder';
  }
});

// ─── Modal de permissões (apps restritos por usuário) ────────────────────────
async function abrirModalPermissoes(uid, email) {
  const reqId = ++permReqId; // se outro clique chamar essa função antes desta terminar, esta vira obsoleta
  document.getElementById('permUid').value = uid;
  document.getElementById('permEmail').textContent = email || '(sem email)';
  const cont = document.getElementById('permLista');
  cont.innerHTML = '<p class="muted">carregando...</p>';
  modalPermissoes.showModal();
  try {
    const r = await getUserAccess({ uid });
    if (reqId !== permReqId) return; // um clique mais novo já assumiu o modal — não sobrescrever
    const liberados = r.data.apps || [];
    const alvoAdmin = !!r.data.isAdmin;
    const temFoto = !!r.data.drives_fotografia;
    const temTI = !!r.data.ti;
    const temMkt = !!r.data.marketing_gerenciar;
    const locRole = r.data.loc_role || 'corretor';
    const locFin = !!r.data.loc_financeiro;
    const locBeta = !!r.data.loc_beta;
    cont.innerHTML =
      (alvoAdmin ? '<p class="muted">Este usuário é admin — já enxerga todos os apps restritos.</p>' : '') +
      APPS_RESTRITOS.map(a => `
        <label class="auth-label-inline">
          <input type="checkbox" value="${a.key}"
            ${(alvoAdmin || liberados.includes(a.key)) ? 'checked' : ''}
            ${alvoAdmin ? 'disabled' : ''}>
          ${a.nome}
        </label>
      `).join('') +
      `<hr style="border-color:var(--border);margin:10px 0">
       <p class="muted" style="font-size:11px;margin:0 0 6px">Permissões especiais:</p>
       <label class="auth-label-inline">
         <input type="checkbox" id="permDrivesFotografia" ${temFoto ? 'checked' : ''}>
         Drives Fotografia <span class="muted" style="font-size:10px">(gerenciar pastas de fotos)</span>
       </label>
       <label class="auth-label-inline">
         <input type="checkbox" id="permTI" ${temTI ? 'checked' : ''}>
         Suporte / TI <span class="muted" style="font-size:10px">(responder chamados de suporte)</span>
       </label>
       <label class="auth-label-inline">
         <input type="checkbox" id="permMarketing" ${temMkt ? 'checked' : ''}>
         Marketing · gerenciar <span class="muted" style="font-size:10px">(criar/editar/excluir sanfonas e templates)</span>
       </label>
       <hr style="border-color:var(--border);margin:10px 0">
       <p class="muted" style="font-size:11px;margin:0 0 6px">Gestão de Locações:</p>
       <!-- ESCONDIDO 2026-08-03 — "Meus Negócios" liberada pra todos; o checkbox "Acesso de teste"
            (loc_beta) não filtra mais nada. Nathan pediu p/ tirar da UI sem apagar. Reativar
            descomentando (o save já lê com ?.checked, então some/volta sem quebrar). Ver CLAUDE.md.
       <label class="auth-label-inline">
         <input type="checkbox" id="permLocBeta" ${locBeta ? 'checked' : ''}>
         Acesso de teste <span class="muted" style="font-size:10px">(vê o módulo "Meus Negócios" — libere só pra quem vai testar)</span>
       </label>
       -->
       <label class="auth-label-inline" style="gap:8px">
         Perfil
         <select id="permLocRole" class="topbar-btn" style="padding:4px 8px">
           <option value="corretor"${locRole === 'corretor' ? ' selected' : ''}>Corretor</option>
           <option value="administrativo"${locRole === 'administrativo' ? ' selected' : ''}>Administrativo</option>
           <option value="gestor"${locRole === 'gestor' ? ' selected' : ''}>Gestor</option>
         </select>
       </label>
       <label class="auth-label-inline">
         <input type="checkbox" id="permLocFinanceiro" ${locFin ? 'checked' : ''} ${locRole === 'corretor' ? 'disabled' : ''}>
         Financeiro <span class="muted" style="font-size:10px">(dar baixa e registrar repasse)</span>
       </label>
       <p class="muted" style="font-size:10px;margin:6px 0 0">A pessoa precisa deslogar/logar pra o novo perfil valer.</p>`;
    // Financeiro só faz sentido pra administrativo/gestor
    const selRole = document.getElementById('permLocRole');
    if (selRole) selRole.addEventListener('change', () => {
      const fin = document.getElementById('permLocFinanceiro');
      if (selRole.value === 'corretor') { fin.checked = false; fin.disabled = true; } else fin.disabled = false;
    });
  } catch (e) {
    if (reqId !== permReqId) return; // um clique mais novo já assumiu o modal — não sobrescrever
    cont.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

document.getElementById('cancelarPermissoes').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); modalPermissoes.close(); });
document.getElementById('formPermissoes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('permUid').value;
  // :not(:disabled) — pra um usuário admin, os apps restritos aparecem marcados+desabilitados
  // só como indicação visual ("já tem por ser admin"); sem excluir os disabled, salvar QUALQUER
  // permissão gravava o ClickSign como concessão explícita e permanente em user_access.
  const apps = Array.from(document.querySelectorAll('#permLista input[type="checkbox"]:not(#permDrivesFotografia):not(#permLocFinanceiro):not(#permLocBeta):not(#permTI):not(#permMarketing):checked:not(:disabled)')).map(c => c.value);
  const drives_fotografia = !!(document.getElementById('permDrivesFotografia')?.checked);
  const ti = !!(document.getElementById('permTI')?.checked);
  const marketing_gerenciar = !!(document.getElementById('permMarketing')?.checked);
  const loc_beta = !!(document.getElementById('permLocBeta')?.checked);
  const loc_role = document.getElementById('permLocRole')?.value || 'corretor';
  const loc_financeiro = !!(document.getElementById('permLocFinanceiro')?.checked);
  try {
    await setUserAccess({ uid, apps, drives_fotografia, loc_beta, loc_role, loc_financeiro, ti, marketing_gerenciar });
    modalPermissoes.close();
  } catch (err) { alert('Erro: ' + err.message); }
});

// ─── Presença: atualiza os dots na tabela de usuários sem recarregar tudo ────
function dotPresenca(uid) {
  const online = !!presenceMap[uid];
  return `<span class="presence-dot ${online ? 'online' : 'offline'}" title="${online ? 'Online' : 'Offline'}"></span>`;
}

function atualizarDotsPresenca() {
  document.querySelectorAll('.presence-dot[data-uid]').forEach(el => {
    const online = !!presenceMap[el.dataset.uid];
    el.className = `presence-dot ${online ? 'online' : 'offline'}`;
    el.title = online ? 'Online' : 'Offline';
  });
}

// ─── Avisos enviados (tempo real via onSnapshot) ──────────────────────────────
function renderAvisosEnviados(lista) {
  const el = document.getElementById('listaAvisosEnviados');
  if (!el) return;
  if (!lista.length) { el.innerHTML = '<p class="muted">Nenhum aviso enviado ainda.</p>'; return; }
  el.innerHTML = `
    <table class="users-table">
      <thead><tr><th>Título / Mensagem</th><th>Enviado em</th><th>Confirmações</th><th></th></tr></thead>
      <tbody>
        ${lista.map(n => {
          const total = n.totalDestinatarios
            || (n.todos ? totalUsuariosAdmin : (Array.isArray(n.destinatarios) ? n.destinatarios.length : 0));
          const lidos = Array.isArray(n.lidoPor) ? n.lidoPor.length : 0;
          const pct = total > 0 ? Math.round((lidos / total) * 100) : null;
          const data = n.criadoEm ? n.criadoEm.toDate().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
          return `
            <tr>
              <td>
                <strong style="font-size:12px">${escHtml(n.titulo || '(sem título)')}</strong>
                <div class="muted" style="font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${escHtml(n.mensagem || '')}</div>
              </td>
              <td style="font-size:12px;white-space:nowrap">${data}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="aviso-progresso">
                    <div class="aviso-progresso-bar" style="width:${pct ?? 0}%"></div>
                  </div>
                  <span style="font-size:12px;white-space:nowrap">${lidos}${total > 0 ? '/'+total : ''} viram</span>
                </div>
              </td>
              <td><button class="topbar-btn perigo aviso-excluir" data-id="${n.id}">Excluir</button></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  el.querySelectorAll('.aviso-excluir').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmar('Excluir este aviso? Ele sumirá de quem ainda não confirmou.'))) return;
      try { await excluirNotificacao({ id: btn.dataset.id }); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
}

// ─── Confirmação estilizada (no lugar do confirm() do navegador) ─────────────
function confirmar(mensagem, labelSim) {
  return new Promise((resolve) => {
    document.getElementById('confirmMsg').textContent = mensagem;
    const btnSim = document.getElementById('confirmSim');
    const btnNao = document.getElementById('confirmNao');
    // Rótulo customizável: sem `labelSim` = exclusão (botão "Excluir" vermelho);
    // com rótulo = ação neutra (o texto dado, sem o vermelho de perigo).
    btnSim.textContent = labelSim || 'Excluir';
    btnSim.classList.toggle('perigo', !labelSim);

    const fechar = (valor) => {
      btnSim.removeEventListener('click', onSim);
      btnNao.removeEventListener('click', onNao);
      modalConfirm.removeEventListener('cancel', onCancel); // Limpa o evento do ESC
      modalConfirm.close();
      resolve(valor);
    };
    
    const onSim = () => fechar(true);
    const onNao = () => fechar(false);
    
    // Se a pessoa apertar ESC, cancelamos a Promise com "false"
    const onCancel = (e) => {
      e.preventDefault(); 
      fechar(false);
    };

    btnSim.addEventListener('click', onSim);
    btnNao.addEventListener('click', onNao);
    modalConfirm.addEventListener('cancel', onCancel); // Ouve a tecla ESC
    
    modalConfirm.showModal();
  });
}
// ===================== H-REC AGENDA — imobiliárias + atribuição de papéis =====================
let _hrecImobs = [], _hrecCfg = null;
async function carregarHrecAdmin() {
  const painel = document.getElementById('hrecAdminPainel');
  if (!painel) return;
  painel.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const [imobsR, usersR, cfgR] = await Promise.all([hrecImobiliariasListar(), hrecUsuariosListar(), hrecAdminConfig()]);
    _hrecImobs = (imobsR.data.imobiliarias || []).slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    _hrecCfg = cfgR.data;
    renderHrecAdmin(painel, usersR.data.usuarios || []);
  } catch (e) {
    painel.innerHTML = `<p style="color:var(--danger,#c0353a)">Erro: ${escapeHtml(e.message || e)}</p>`;
  }
}

function renderHrecAdmin(painel, usuarios) {
  const PAPEIS = [['', '— sem acesso —'], ['corretor', 'Corretor'], ['avulso', 'Avulso'], ['broker', 'Broker'], ['fotografo', 'Fotógrafo (H-REC)'], ['administrador', 'Administrador (H-REC)']];
  const optImobs = (sel) => '<option value="">—</option>' + _hrecImobs.map(i => `<option value="${escapeHtml(i.id)}"${sel === i.id ? ' selected' : ''}>${escapeHtml(i.nome)} (${escapeHtml(i.tipo)})</option>`).join('');

  const linhasImobs = _hrecImobs.length
    ? _hrecImobs.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.tipo)}</td><td>${escapeHtml(i.pricingTableId || '')}</td><td>${i.ativa === false ? '—' : '✔'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Nenhuma imobiliária ainda.</td></tr>';

  const linhasUsers = usuarios.map(u => `
    <tr data-uid="${escapeHtml(u.uid)}">
      <td>${escapeHtml(u.email || u.nome || u.uid)}</td>
      <td><select class="hrecad-role">${PAPEIS.map(p => `<option value="${p[0]}"${(u.hrecRole || '') === p[0] ? ' selected' : ''}>${escapeHtml(p[1])}</option>`).join('')}</select></td>
      <td><select class="hrecad-imob">${optImobs(u.hrecImob || '')}</select></td>
      <td><button class="topbar-btn hrecad-salvar">Salvar</button></td>
    </tr>`).join('');

  painel.innerHTML = `
    <div style="display:grid;gap:16px">
      <div class="banner-admin-card">
        <h3 style="margin:0 0 8px">Imobiliárias</h3>
        <table class="users-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Tabela</th><th>Ativa</th></tr></thead><tbody>${linhasImobs}</tbody></table>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:10px">
          <div><label class="muted" style="font-size:11px">Nome</label><br><input id="hrecImNome" class="admin-input" placeholder="Ex.: REMAX Empire"></div>
          <div><label class="muted" style="font-size:11px">Tipo</label><br><select id="hrecImTipo" class="admin-input"><option value="avulso">Avulso (Pix)</option><option value="parceria">Parceria (créditos)</option></select></div>
          <button class="topbar-btn" id="hrecImAdd">+ Adicionar imobiliária</button>
        </div>
        <p class="muted" style="font-size:11px;margin-top:6px">Parceria usa a tabela <strong>remax_empire</strong> (20% desc.); avulso usa a <strong>padrao_hrec</strong>.</p>
      </div>

      <div class="banner-admin-card">
        <h3 style="margin:0 0 8px">Papéis das pessoas</h3>
        <table class="users-table"><thead><tr><th>Pessoa</th><th>Papel H-REC</th><th>Imobiliária</th><th></th></tr></thead><tbody>${linhasUsers}</tbody></table>
        <p class="muted" style="font-size:11px;margin-top:6px">Corretor e Broker exigem imobiliária. Depois de salvar, a pessoa precisa <strong>relogar</strong> pra o papel valer.</p>
      </div>
      ${hrecConfigHtml()}
    </div>`;

  document.getElementById('hrecImAdd')?.addEventListener('click', async (ev) => {
    const nome = document.getElementById('hrecImNome').value.trim();
    const tipo = document.getElementById('hrecImTipo').value;
    if (!nome) { alert('Informe o nome da imobiliária.'); return; }
    ev.target.disabled = true; ev.target.textContent = 'Salvando...';
    try { await hrecImobiliariaSalvar({ nome, tipo }); await carregarHrecAdmin(); }
    catch (e) { alert('Erro: ' + (e.message || e)); ev.target.disabled = false; ev.target.textContent = '+ Adicionar imobiliária'; }
  });

  painel.querySelectorAll('.hrecad-salvar').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr');
    const uid = tr.dataset.uid;
    const role = tr.querySelector('.hrecad-role').value;
    const imob = tr.querySelector('.hrecad-imob').value;
    if ((role === 'corretor' || role === 'broker') && !imob) { alert('Corretor e Broker exigem uma imobiliária.'); return; }
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      await hrecSetPapel({ uid, role, imobiliariaId: imob || '' });
      btn.textContent = 'Salvo ✔';
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Salvar'; }, 1500);
    } catch (e) { alert('Erro: ' + (e.message || e)); btn.disabled = false; btn.textContent = 'Salvar'; }
  }));
  ligarHrecConfig();
}

// Seções de configuração do módulo H-REC (agenda, Pix, datas bloqueadas, adicionais, tabelas).
function hrecConfigHtml() {
  const cfg = _hrecCfg || {};
  const ca = cfg.configAgenda || {}, px = cfg.configPix || {};
  const chk = (v) => v ? ' checked' : '';
  const inp = (id, val, tipo) => `<input id="${id}" class="admin-input" type="${tipo || 'text'}" value="${escapeHtml(val == null ? '' : val)}" style="width:100%">`;
  const DOW = [['0', 'Dom'], ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb']];
  const dias = Array.isArray(ca.diasAtendimento) ? ca.diasAtendimento.map(String) : ['1', '2', '3', '4', '5', '6'];

  // Config da agenda
  const agenda = `<div class="banner-admin-card"><h3 style="margin:0 0 8px">Configuração da agenda</h3>
    <div class="hrec-cfg-grid">
      <label>Abre<br>${inp('hcAgIni', ca.horaInicio || '09:00', 'time')}</label>
      <label>Fecha<br>${inp('hcAgFim', ca.horaFim || '18:00', 'time')}</label>
      <label>Almoço início<br>${inp('hcAlmI', ca.almocoInicio || '12:00', 'time')}</label>
      <label>Almoço fim<br>${inp('hcAlmF', ca.almocoFim || '13:00', 'time')}</label>
      <label>Buffer deslocamento (min)<br>${inp('hcBuf', ca.travelBufferMinutes == null ? 30 : ca.travelBufferMinutes, 'number')}</label>
      <label>Grade (min)<br>${inp('hcGrade', ca.gradeMinutos == null ? 15 : ca.gradeMinutos, 'number')}</label>
      <label>Limite/dia<br>${inp('hcLim', ca.limiteDia == null ? 5 : ca.limiteDia, 'number')}</label>
      <label>Antecedência (h)<br>${inp('hcAnt', ca.antecedenciaHoras == null ? 24 : ca.antecedenciaHoras, 'number')}</label>
      <label>Hold Pix (min)<br>${inp('hcHold', ca.holdMinutos == null ? 30 : ca.holdMinutos, 'number')}</label>
    </div>
    <div style="margin-top:8px">Dias de atendimento: ${DOW.map(d => `<label style="margin-right:8px;font-size:12px"><input type="checkbox" class="hc-dia" value="${d[0]}"${chk(dias.indexOf(d[0]) >= 0)}> ${d[1]}</label>`).join('')}</div>
    <button class="topbar-btn" id="hcSalvarAgenda" style="margin-top:10px">Salvar agenda</button></div>`;

  // Config Pix
  const pix = `<div class="banner-admin-card"><h3 style="margin:0 0 8px">Pix (cobrança avulsa e créditos)</h3>
    <div class="hrec-cfg-grid">
      <label>Chave Pix<br>${inp('hcPixChave', px.chave)}</label>
      <label>Tipo (cpf/cnpj/email/tel/aleatoria)<br>${inp('hcPixTipo', px.tipoChave)}</label>
      <label>Recebedor<br>${inp('hcPixNome', px.recebedor)}</label>
      <label>Cidade<br>${inp('hcPixCidade', px.cidade)}</label>
      <label>URL do QR (opcional)<br>${inp('hcPixQr', px.qrCodeUrl)}</label>
    </div>
    <label style="display:block;margin-top:8px;font-size:12px"><input type="checkbox" id="hcPixAtivo"${chk(px.ativo)}> Pix ativo</label>
    <button class="topbar-btn" id="hcSalvarPix" style="margin-top:10px">Salvar Pix</button></div>`;

  // Datas bloqueadas
  const bloq = (cfg.bloqueios || []).map(b => `<tr><td>${escapeHtml(b.dateISO)}</td><td>${escapeHtml(b.motivo || '')}</td><td><button class="topbar-btn hc-desbloq" data-iso="${escapeHtml(b.dateISO)}">Remover</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nenhuma data bloqueada.</td></tr>';
  const datas = `<div class="banner-admin-card"><h3 style="margin:0 0 8px">Datas bloqueadas</h3>
    <table class="users-table"><thead><tr><th>Data</th><th>Motivo</th><th></th></tr></thead><tbody>${bloq}</tbody></table>
    <div style="display:flex;gap:8px;align-items:end;margin-top:10px;flex-wrap:wrap">
      <label>Data<br><input id="hcBloqData" class="admin-input" type="date"></label>
      <label style="flex:1">Motivo<br><input id="hcBloqMotivo" class="admin-input" placeholder="Feriado, férias…" style="width:100%"></label>
      <button class="topbar-btn" id="hcBloquear">Bloquear data</button></div></div>`;

  // Adicionais (valor + ativo)
  const ads = (cfg.adicionais || []).map(a => `<tr data-id="${escapeHtml(a.id)}">
    <td>${escapeHtml(a.nome)}</td><td>${escapeHtml(a.tipoCobranca)}</td>
    <td><input class="admin-input hc-ad-valor" type="number" value="${escapeHtml(a.valor)}" style="width:90px"></td>
    <td><input type="checkbox" class="hc-ad-ativo"${chk(a.ativo !== false)}></td>
    <td><button class="topbar-btn hc-ad-salvar">Salvar</button></td></tr>`).join('');
  const adics = `<div class="banner-admin-card"><h3 style="margin:0 0 8px">Serviços adicionais</h3>
    <table class="users-table"><thead><tr><th>Nome</th><th>Cobrança</th><th>Valor (R$)</th><th>Ativo</th><th></th></tr></thead><tbody>${ads}</tbody></table></div>`;

  // Tabelas de preço (edita valorReferencia/valorFinal/tempoMinutos/ativo por faixa)
  const tabelas = (cfg.tabelas || []).map(t => {
    const faixas = (t.faixas || []).map((f, i) => `<tr data-i="${i}">
      <td>${f.min}–${f.max == null ? '∞' : f.max} m²${f.sobConsulta ? ' <span class="muted">(consulta)</span>' : ''}</td>
      <td><input class="admin-input hc-fx-ref" type="number" value="${f.valorReferencia == null ? '' : f.valorReferencia}" style="width:80px"></td>
      <td><input class="admin-input hc-fx-fin" type="number" value="${f.valorFinal == null ? '' : f.valorFinal}" style="width:80px"></td>
      <td><input class="admin-input hc-fx-tmp" type="number" value="${f.tempoMinutos == null ? '' : f.tempoMinutos}" style="width:70px"></td>
      <td><input type="checkbox" class="hc-fx-ativo"${chk(f.ativo !== false)}></td></tr>`).join('');
    return `<div class="banner-admin-card hc-tab" data-id="${escapeHtml(t.id)}"><h3 style="margin:0 0 4px">${escapeHtml(t.nome)} <span class="muted" style="font-size:11px">v${t.versao || 1} · ${escapeHtml(t.tipo)} · ${t.descontoPercentual || 0}%</span></h3>
      <table class="users-table"><thead><tr><th>Faixa</th><th>Ref.</th><th>Final</th><th>Tempo</th><th>Ativa</th></tr></thead><tbody>${faixas}</tbody></table>
      <button class="topbar-btn hc-tab-salvar" style="margin-top:10px">Salvar tabela (nova versão)</button></div>`;
  }).join('');

  return `<style>.hrec-cfg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.hrec-cfg-grid label{font-size:12px}@media(max-width:700px){.hrec-cfg-grid{grid-template-columns:1fr 1fr}}</style>` +
    agenda + pix + datas + adics + tabelas;
}

function ligarHrecConfig() {
  const val = id => (document.getElementById(id) || {}).value;
  const num = id => Number(val(id)) || 0;
  const chk = id => !!(document.getElementById(id) || {}).checked;
  const feedback = (btn, fn) => async () => { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Salvando…'; try { await fn(); btn.textContent = 'Salvo ✔'; setTimeout(() => carregarHrecAdmin(), 700); } catch (e) { alert('Erro: ' + (e.message || e)); btn.disabled = false; btn.textContent = t; } };

  const bAg = document.getElementById('hcSalvarAgenda');
  if (bAg) bAg.addEventListener('click', feedback(bAg, () => hrecSalvarConfigAgenda({ config: {
    horaInicio: val('hcAgIni'), horaFim: val('hcAgFim'), almocoInicio: val('hcAlmI'), almocoFim: val('hcAlmF'),
    travelBufferMinutes: num('hcBuf'), gradeMinutos: num('hcGrade'), limiteDia: num('hcLim'), antecedenciaHoras: num('hcAnt'), holdMinutos: num('hcHold'),
    diasAtendimento: [...document.querySelectorAll('.hc-dia:checked')].map(c => Number(c.value))
  } })));

  const bPix = document.getElementById('hcSalvarPix');
  if (bPix) bPix.addEventListener('click', feedback(bPix, () => hrecSalvarConfigPix({ pix: {
    chave: val('hcPixChave'), tipoChave: val('hcPixTipo'), recebedor: val('hcPixNome'), cidade: val('hcPixCidade'), qrCodeUrl: val('hcPixQr'), ativo: chk('hcPixAtivo')
  } })));

  const bBloq = document.getElementById('hcBloquear');
  if (bBloq) bBloq.addEventListener('click', feedback(bBloq, async () => { const dt = val('hcBloqData'); if (!dt) throw new Error('Escolha uma data.'); await hrecBloquearData({ dateISO: dt, motivo: val('hcBloqMotivo') }); }));
  document.querySelectorAll('.hc-desbloq').forEach(b => b.addEventListener('click', feedback(b, () => hrecDesbloquearData({ dateISO: b.dataset.iso }))));

  document.querySelectorAll('.hc-ad-salvar').forEach(b => b.addEventListener('click', feedback(b, () => {
    const tr = b.closest('tr');
    return hrecSalvarAdicional({ adicional: { id: tr.dataset.id, valor: Number(tr.querySelector('.hc-ad-valor').value) || 0, ativo: tr.querySelector('.hc-ad-ativo').checked } });
  })));

  document.querySelectorAll('.hc-tab-salvar').forEach(b => b.addEventListener('click', feedback(b, () => {
    const card = b.closest('.hc-tab');
    const id = card.dataset.id;
    const base = (_hrecCfg.tabelas || []).find(t => t.id === id);
    const faixas = base.faixas.map((f, i) => {
      const tr = card.querySelector(`tr[data-i="${i}"]`); if (!tr) return f;
      const nf = v => v === '' ? null : Number(v);
      return Object.assign({}, f, {
        valorReferencia: nf(tr.querySelector('.hc-fx-ref').value), valorFinal: nf(tr.querySelector('.hc-fx-fin').value),
        tempoMinutos: nf(tr.querySelector('.hc-fx-tmp').value), ativo: tr.querySelector('.hc-fx-ativo').checked
      });
    });
    return hrecSalvarTabela({ tabela: Object.assign({}, base, { faixas }), obs: 'edição pelo Admin' });
  })));
}
