# Recrutamento de corretores — ligar o Google Forms ao Hub

O formulário de inscrição alimenta o módulo **Recrutamento** do Hub por um webhook.
Cada resposta enviada vira um candidato na etapa **"Sem contato"**, automaticamente.

## Passo a passo (Nathan faz — 1 vez)

### 1. Definir o secret no Firebase
Escolha uma senha aleatória (ex.: gere uma frase longa) e rode:

```bash
# produção
printf 'SUA_SENHA_ALEATORIA' | firebase functions:secrets:set RECRUTAMENTO_SECRET --project remax-smart-hub --data-file=-
# staging (se for testar no staging antes)
printf 'SUA_SENHA_ALEATORIA' | firebase functions:secrets:set RECRUTAMENTO_SECRET --project staging --data-file=-
```

Guarde essa senha — ela vai também no script do formulário (passo 3).

### 2. Deploy da função (Claude faz)
`firebase deploy --only functions:recrutamentoWebhook,functions:recrutamentoListar,functions:recrutamentoObter,functions:recrutamentoSalvar,functions:recrutamentoHistorico,functions:recrutamentoExcluir --project <projeto>`

### 3. Colar o Apps Script no formulário
No formulário → menu **⋮ (três pontos)** → **Editor de script**. Apague o que estiver lá,
cole o código abaixo, **troque o `SECRET`** pela senha do passo 1 (e confira a `WEBHOOK_URL`
— produção ou staging), e salve.

```javascript
// ── Recrutamento REMAX — envia cada resposta do formulário pro Hub ──
var WEBHOOK_URL = 'https://southamerica-east1-remax-smart-hub.cloudfunctions.net/recrutamentoWebhook';
// staging:  'https://southamerica-east1-remax-smart-hub-staging.cloudfunctions.net/recrutamentoWebhook'
var SECRET = 'COLE_AQUI_A_MESMA_SENHA_DO_PASSO_1';

function aoEnviarFormulario(e) {
  var resp = e.response;
  var mapa = {};
  resp.getItemResponses().forEach(function (ir) {
    mapa[norm(ir.getItem().getTitle())] = ir.getResponse();
  });
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
  function pega(sub) {
    var chave = Object.keys(mapa).filter(function (t) { return t.indexOf(sub) !== -1; })[0];
    return chave ? mapa[chave] : '';
  }
  var payload = {
    nome:               pega('nome'),
    email:              resp.getRespondentEmail() || pega('e-mail') || pega('email'),
    telefone:           pega('telefone'),
    rg:                 pega('rg'),
    cpf:                pega('cpf'),
    endereco:           pega('endereco'),
    dadosBancarios:     pega('dados banc'),
    expImobiliaria:     pega('possui alguma experiencia no ramo'),
    expImobiliariaDesc: pega('descreva sua experiencia no ramo'),
    expVendas:          pega('possui experiencia em vendas'),
    expVendasDesc:      pega('descreva sua experiencia em vendas'),
    maiorSonho:         pega('maior sonho'),
    opiniaoRemax:       pega('modelo de negocio'),
    clubeDesejado:      pega('clube')
  };
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-recrutamento-secret': SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
```

### 4. Criar o gatilho
No editor de script → ícone de **relógio (Acionadores)** → **Adicionar acionador**:
- Função: `aoEnviarFormulario`
- Fonte do evento: **No formulário**
- Tipo de evento: **Ao enviar formulário**

Salve (vai pedir pra autorizar o script na sua conta Google — normal).

### 5. Testar
Responda o próprio formulário uma vez. O candidato deve aparecer no Hub em
**Recrutamento** (só o gestor vê), na etapa "Sem contato".

## Observações
- **Dados sensíveis** (RG, CPF, dados bancários): ficam na coleção `candidatos`, com
  acesso só via Cloud Function (gestor). Entra na LGPD quando ela for ligada.
- Reenvio da mesma pessoa (mesmo CPF) **não duplica** — atualiza os dados e marca no histórico.
- Se mudar os títulos das perguntas no formulário, confira os `pega('...')` acima.
