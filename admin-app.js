// Página admin: gerenciar credenciais dos sistemas + usuários do Hub
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { getFirestore, collection, onSnapshot, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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
const dbFs    = getFirestore(app);

const listCredentials   = httpsCallable(fns, 'listCredentials');
const getCredentialAdmin = httpsCallable(fns, 'getCredentialAdmin');
const setCredentials    = httpsCallable(fns, 'setCredentials');
const deleteCredentials = httpsCallable(fns, 'deleteCredentials');
const listUsers         = httpsCallable(fns, 'listUsers');
const setUserAdmin      = httpsCallable(fns, 'setUserAdmin');
const createUser        = httpsCallable(fns, 'createUser');
const deleteUserAccount = httpsCallable(fns, 'deleteUserAccount');
const criarCodigoConvite    = httpsCallable(fns, 'criarCodigoConvite');
const listarCodigosConvite  = httpsCallable(fns, 'listarCodigosConvite');
const excluirCodigoConvite  = httpsCallable(fns, 'excluirCodigoConvite');
const getUserAccess  = httpsCallable(fns, 'getUserAccess');
const setUserAccess  = httpsCallable(fns, 'setUserAccess');
const getMinhasPermissoes = httpsCallable(fns, 'getMinhasPermissoes');
const publicarLocacoes = httpsCallable(fns, 'publicarLocacoes');
const getModoCofre = httpsCallable(fns, 'getModoCofre');
const setModoCofre = httpsCallable(fns, 'setModoCofre');
const migrarCredenciaisCofre = httpsCallable(fns, 'migrarCredenciaisCofre');
const listarStatusApps        = httpsCallable(fns, 'listarStatusApps');
const listarNotificacoesAdmin = httpsCallable(fns, 'listarNotificacoesAdmin');
const excluirNotificacao      = httpsCallable(fns, 'excluirNotificacao');
const getTreinamentoLinks = httpsCallable(fns, 'getTreinamentoLinks');
const setTreinamentoLink  = httpsCallable(fns, 'setTreinamentoLink');
const setStatusApp     = httpsCallable(fns, 'setStatusApp');
const getBanner        = httpsCallable(fns, 'getBanner');
const setBanner        = httpsCallable(fns, 'setBanner');
const listarBanners    = httpsCallable(fns, 'listarBanners');
const adicionarBanner  = httpsCallable(fns, 'adicionarBanner');
const removerBanner    = httpsCallable(fns, 'removerBanner');
const reordenarBanners = httpsCallable(fns, 'reordenarBanners');
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
  { key: 'clicksign',      nome: 'ClickSign' },
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
      const login = dado?.login ? `<code>${dado.login}</code>` : '<em class="muted">—</em>';

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

async function carregarUsuarios() {
  elListaUser.innerHTML = '<p class="muted">carregando...</p>';
  try {
    const resp = await listUsers();
    const usuarios = resp.data;
    // Salva o total para usar na barra de avisos e re-renderiza com o total correto
    totalUsuariosAdmin = usuarios.length;
    if (notificacoesCache.length) renderAvisosEnviados(notificacoesCache);
    elListaUser.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Email</th><th>Admin</th><th>Criado</th><th>Último acesso</th><th>Último app</th><th></th></tr>
        </thead>
        <tbody>
          ${usuarios.map(u => `
            <tr>
              <td><span class="presence-dot ${presenceMap[u.uid] ? 'online' : 'offline'}" data-uid="${u.uid}" title="${presenceMap[u.uid] ? 'Online' : 'Offline'}"></span> ${u.email || '<em>sem email</em>'}</td>
              <td>
                <input type="checkbox" ${u.isAdmin ? 'checked' : ''} data-uid="${u.uid}" class="toggle-admin">
              </td>
              <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
              <td>${u.lastAppAt ? fmtDataHora(u.lastAppAt) : (u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString('pt-BR') : 'nunca')}</td>
              <td>${u.lastApp ? `${u.lastApp} · ${fmtDataHora(u.lastAppAt)}` : '<span class="muted">—</span>'}</td>
              <td class="acoes-user">
                <button class="topbar-btn" data-perm="${u.uid}" data-email="${u.email || ''}">Permissões</button>
                <button class="topbar-btn perigo" data-uid="${u.uid}" data-email="${u.email}">Excluir</button>
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
    elListaUser.querySelectorAll('button[data-uid]').forEach(b => {
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
    const locGestao = !!r.data.loc_gestao;
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
       <label class="auth-label-inline">
         <input type="checkbox" id="permLocGestao" ${locGestao ? 'checked' : ''}>
         Gestão de Locações <span class="muted" style="font-size:10px">(vê a aba Locação — Painel e Imóveis)</span>
       </label>
       <label class="auth-label-inline">
         <input type="checkbox" id="permLocBeta" ${locBeta ? 'checked' : ''}>
         Acesso de teste <span class="muted" style="font-size:10px">(vê o módulo — libere só pra quem vai testar)</span>
       </label>
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
  const apps = Array.from(document.querySelectorAll('#permLista input[type="checkbox"]:not(#permDrivesFotografia):not(#permLocFinanceiro):not(#permLocBeta):not(#permLocGestao):not(#permTI):not(#permMarketing):checked:not(:disabled)')).map(c => c.value);
  const drives_fotografia = !!(document.getElementById('permDrivesFotografia')?.checked);
  const ti = !!(document.getElementById('permTI')?.checked);
  const marketing_gerenciar = !!(document.getElementById('permMarketing')?.checked);
  const loc_beta = !!(document.getElementById('permLocBeta')?.checked);
  const loc_gestao = !!(document.getElementById('permLocGestao')?.checked);
  const loc_role = document.getElementById('permLocRole')?.value || 'corretor';
  const loc_financeiro = !!(document.getElementById('permLocFinanceiro')?.checked);
  try {
    await setUserAccess({ uid, apps, drives_fotografia, loc_beta, loc_gestao, loc_role, loc_financeiro, ti, marketing_gerenciar });
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
function confirmar(mensagem) {
  return new Promise((resolve) => {
    document.getElementById('confirmMsg').textContent = mensagem;
    const btnSim = document.getElementById('confirmSim');
    const btnNao = document.getElementById('confirmNao');
    
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