const { contextBridge, ipcRenderer } = require('electron');

// APIs expostas pro renderer. Tudo passa pelo main via IPC.
contextBridge.exposeInMainWorld('hubApi', {
  // Manda o main abrir uma janela do PWA (com ou sem credenciais)
  abrirApp: (payload) => ipcRenderer.send('abrir-app', payload),

  // Abre uma URL no navegador PADRÃO do Windows (não numa janela do Hub).
  // Usado pelo aviso de status: quando a janela nativa de um app não está
  // confiável (ex.: CheckVisto), oferecemos o site pelo navegador.
  abrirNoNavegador: (url) => ipcRenderer.send('abrir-no-navegador', url),

  // O desktop TEM autologin. No PWA (pwa/platform-web.js) esta flag é false, e
  // é ela que impede o hub-app.js de pedir as senhas dos sistemas no celular.
  autologin: true,

  // Navegação entre páginas (login → index → admin)
  voltarParaLogin: () => ipcRenderer.send('voltar-para-login'),
  abrirAdmin: () => ipcRenderer.send('abrir-admin'),
  voltarParaHub: () => ipcRenderer.send('voltar-para-hub'),

  // "Meus Negócios" (visão nova do Broker) abre em JANELA PRÓPRIA no desktop —
  // como abrir um app. No PWA/web isso não existe (é overlay dentro do Hub).
  abrirMeusNegocios: () => ipcRenderer.send('abrir-meus-negocios'),
  // Fecha a janela atual (usado pelo "Voltar ao Hub" da janela do Broker).
  fecharJanela: () => ipcRenderer.send('fechar-janela'),

  // Conectar Google Agenda: abre o navegador e devolve o código de autorização
  conectarGoogle: () => ipcRenderer.invoke('conectar-google'),

  // Versão do app
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Iniciar com o Windows (Configurações)
  getIniciarWindows: () => ipcRenderer.invoke('get-iniciar-windows'),
  setIniciarWindows: (ligar) => ipcRenderer.invoke('set-iniciar-windows', ligar),

  // Abrir template de marketing numa janela dedicada. O 2º arg (perfil do corretor)
  // semeia o editor do template com nome/telefone/foto (ver preload-template.js).
  abrirTemplate: (fileName, prefill) => ipcRenderer.send('abrir-template', { fileName, prefill }),

  // Abrir ficha (visualização ou edição) em janela dedicada
  abrirFicha: (url, titulo) => ipcRenderer.send('abrir-ficha', { url, titulo }),

  // Abrir ficha interna do corretor (carrega do disco local, não do Hosting)
  abrirFichaLocal: (arquivo, params) => ipcRenderer.send('abrir-ficha-local', { arquivo, params }),

  // Verificar atualização manualmente (Configurações)
  verificarAtualizacao: () => ipcRenderer.invoke('verificar-atualizacao'),

  // Gerar e baixar PDF da ficha
  baixarFichaPDF: (url, filename) => ipcRenderer.invoke('baixar-ficha-pdf', { url, filename })
});

// API específica de login (chamada pelo auth-login.js depois do login Firebase)
contextBridge.exposeInMainWorld('hubAuth', {
  loginConcluido: () => ipcRenderer.send('login-concluido')
});
