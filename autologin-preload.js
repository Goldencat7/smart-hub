// Roda no contexto do renderer ANTES de qualquer script da página.
// Esconde sinais que denunciam automação (webdriver, ausência do chrome object, etc.)
// — mesma técnica do puppeteer-extra-plugin-stealth.

// 1. Remove navigator.webdriver (principal sinal de automação)
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  delete navigator.__proto__.webdriver;
} catch (e) {}

// 2. Adiciona window.chrome (navegadores reais têm; Electron não tem por padrão)
try {
  if (!window.chrome) {
    window.chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
      },
      runtime: {
        OnInstalledReason: {},
        OnRestartRequiredReason: {},
        PlatformArch: {},
        PlatformNaclArch: {},
        PlatformOs: {},
        RequestUpdateCheckStatus: {}
      },
      loadTimes: function () {},
      csi: function () {}
    };
  }
} catch (e) {}

// 3. Corrige navigator.languages (Electron às vezes retorna array vazio)
try {
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
  }
} catch (e) {}

// 4. Corrige navigator.plugins (Electron retorna lista vazia; real Chrome tem plugins)
try {
  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }];
        arr.item = (i) => arr[i];
        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
        arr.refresh = () => {};
        return arr;
      }
    });
  }
} catch (e) {}
