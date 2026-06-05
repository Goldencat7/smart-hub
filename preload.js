const { contextBridge, ipcRenderer } = require('electron');

// APIs expostas pro renderer. Tudo passa pelo main via IPC.
contextBridge.exposeInMainWorld('hubApi', {
  // Manda o main abrir uma janela do PWA (com ou sem credenciais)
  abrirApp: (payload) => ipcRenderer.send('abrir-app', payload),

  // Navegação entre páginas (login → index → admin)
  voltarParaLogin: () => ipcRenderer.send('voltar-para-login'),
  abrirAdmin: () => ipcRenderer.send('abrir-admin'),
  voltarParaHub: () => ipcRenderer.send('voltar-para-hub'),

  // Conectar Google Agenda: abre o navegador e devolve o código de autorização
  conectarGoogle: () => ipcRenderer.invoke('conectar-google'),

  // Iniciar com o Windows (Configurações)
  getIniciarWindows: () => ipcRenderer.invoke('get-iniciar-windows'),
  setIniciarWindows: (ligar) => ipcRenderer.invoke('set-iniciar-windows', ligar)
});

// API específica de login (chamada pelo auth-login.js depois do login Firebase)
contextBridge.exposeInMainWorld('hubAuth', {
  loginConcluido: () => ipcRenderer.send('login-concluido')
});
