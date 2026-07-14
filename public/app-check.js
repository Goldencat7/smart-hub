// App Check — o "crachá" das páginas públicas.
// =============================================================================
// As Cloud Functions das fichas e dos portais são ANÔNIMAS de propósito: o cliente
// preenche por link, sem login. Isso significa que hoje elas atendem QUALQUER um
// que ligue — inclusive um script rodando na casa de alguém, que poderia despejar
// fichas falsas na base ou ficar chutando tokens de portal.
//
// O App Check resolve isso sem pedir senha a ninguém: o reCAPTCHA olha o navegador,
// confirma que é uma pessoa de verdade na NOSSA página, e emite um crachá de curta
// duração (1h). A function passa a poder exigir esse crachá.
//
// ⚠️ SÓ PARA PÁGINAS https:// (as de public/, servidas pelo Firebase Hosting).
// NUNCA importar isto no hub-app.js / auth-login.js / admin-app.js: essas telas
// rodam em file:// dentro do .exe, e página file:// não tem origem — o reCAPTCHA
// não teria o que atestar e a inicialização falharia.
//
// A chave é PÚBLICA (do mesmo tipo que a apiKey do Firebase — vai no código do
// cliente por definição). O que protege não é ela ser secreta: é o reCAPTCHA só
// aceitar os domínios registrados (remax-smart-hub.web.app, .firebaseapp.com,
// localhost) e avaliar o comportamento do navegador.
//
// ESTADO ATUAL: a imposição está DESLIGADA no servidor. Ou seja, isto aqui só
// EMITE crachá e alimenta as métricas — nenhuma chamada é recusada por falta dele.
// Só depois de confirmar, nas métricas do console, que 100% do tráfego legítimo
// está com crachá é que a recusa deve ser ligada. Ver CLAUDE.md.

import { initializeAppCheck, ReCaptchaEnterpriseProvider }
  from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js';

const SITE_KEY = '6Lfa9FMtAAAAAPcB1WwGieeCGF45Y5nUBCaoemDr';

export function ligarAppCheck(app) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(SITE_KEY),
      isTokenAutoRefreshEnabled: true   // renova o crachá sozinho antes de expirar
    });
  } catch (e) {
    // Nunca derrubar a ficha por causa disto. Enquanto a imposição estiver
    // desligada, uma falha aqui é inofensiva — a chamada passa sem crachá.
    // Quando a imposição for ligada, uma falha aqui vira "chamada recusada", e é
    // exatamente por isso que a gente olha as métricas ANTES de ligar.
    console.warn('[app-check] não inicializou:', e && e.message);
  }
}
