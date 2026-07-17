# Integração Hub ⇄ CheckVisto — contrato v1.1

**Status:** v1.1 de 2026-07-16 — ajustada à realidade do CheckVisto depois de ler o código
(projeto `checkvisto-app`, functions v1/Node 20, multi-usuário por `userId`). Implementação
feita NO CHAT DO HUB com autorização do Nathan (os dois lados); o chat do CheckVisto vai
AUDITAR depois. Este arquivo é a fonte da verdade.

**Decisões da v1.1 (por que difere da v1):**
- A solicitação vira um doc na coleção **`agenda`** do CheckVisto (não uma "vistoria") —
  é assim que o app agenda vistorias, e o trigger `notifyNovaAgenda` que JÁ existe manda
  push pro vistoriador sem a gente escrever nada.
- O CheckVisto é multi-usuário: a solicitação leva **`vistoriadorEmail`** (a conta
  CheckVisto que recebe o serviço) e tudo é criado com o `userId` dela.
- O laudo do CheckVisto é PDF **gerado sob demanda** (sem URL permanente) — o `laudoUrl`
  que volta pro Hub é o link do app (`https://checkvisto-app.web.app/`); o checklist
  automático do Hub avança por STATUS, não por URL, então nada se perde.
- Vínculo Hub→vistoria: a solicitação faz upsert de um **imóvel no CheckVisto** carimbado
  com `hubImovelId`+`hubAmbiente`; o trigger de volta resolve `vistoria.imovelId → imóvel
  → hubImovelId`.
- Código do CheckVisto: arquivo **NOVO** `functions/hub-integracao.js` + **1 linha
  apêndice** no fim do `functions/index.js` (`Object.assign(exports, require('./hub-integracao'))`).
  Nenhuma linha existente alterada.

## Objetivo

Hoje a vistoria no Hub é registro manual (tipo + status + link do laudo, colado na mão).
Com a integração:

1. **Hub → CheckVisto**: botão "Solicitar vistoria" na aba Gestão da Locação (Tela 03)
   cria a vistoria lá no CheckVisto, já vinculada ao imóvel do Hub.
2. **CheckVisto → Hub**: quando a vistoria muda de status lá (agendada → realizada →
   laudo emitido), o CheckVisto avisa o Hub sozinho — o registro em `vistorias` atualiza,
   o link do laudo chega, e o checklist automático do imóvel anda sem ninguém digitar nada.

Os dois apps continuam **100% independentes**: cada um no seu projeto Firebase, seu repo,
seu deploy. A conversa é só HTTP entre Cloud Functions, autenticada por segredo compartilhado.

## Autenticação (igual nos dois sentidos)

- Header: `x-integracao-secret: <SEGREDO>`
- Segredo: **um só**, compartilhado, gravado como secret de Cloud Functions nos DOIS
  projetos com o nome **`HUB_CHECKVISTO_SECRET`**.
- Quem gera e grava é o **Nathan** (nunca vai pro código nem pro repo):
  ```powershell
  # gerar (uma vez):
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  # gravar no Hub:        (na pasta do hub)
  firebase functions:secrets:set HUB_CHECKVISTO_SECRET --project remax-smart-hub
  firebase functions:secrets:set HUB_CHECKVISTO_SECRET --project remax-smart-hub-staging
  # gravar no CheckVisto: (na pasta do CheckVisto)
  firebase functions:secrets:set HUB_CHECKVISTO_SECRET --project <projeto-do-checkvisto>
  ```
  ⚠️ Colar o valor quando o prompt pedir. Mesmo valor nos três lugares.
- Requisição sem o header ou com valor errado → **401**, sem detalhes no corpo.

## Endpoint 1 — no CHECKVISTO: `hubSolicitarVistoria`

HTTPS `onRequest`, método POST, JSON. O Hub chama quando alguém clica "Solicitar vistoria".

**Request:**
```json
{
  "hubImovelId":   "abc123",           // id do doc em imoveis/ no Hub (OBRIGATÓRIO)
  "ambiente":      "prod",             // "prod" | "staging" — de onde veio a solicitação (OBRIGATÓRIO)
  "tipo":          "entrada",          // "entrada" | "saida" (OBRIGATÓRIO)
  "endereco":      "Rua X, 123 - Bairro, Curitiba/PR",
  "codigoHub":     "#SH-0001",         // protocolo do imóvel no Hub (exibição)
  "proprietarioNome": "Fulano",        // opcional
  "inquilinoNome":    "Beltrano",      // opcional
  "corretorNome":     "Corretor Y",    // opcional
  "obs":              "..."            // opcional
}
```

**Regras:**
- Validar o secret; validar `hubImovelId`/`ambiente`/`tipo` (formatos acima).
- **Idempotente**: se já existe vistoria ABERTA (não concluída) pro mesmo
  `hubImovelId`+`tipo`+`ambiente`, devolve a existente em vez de criar outra.
- Guardar no doc da vistoria do CheckVisto: `hubImovelId`, `ambiente` e `origem: 'hub'`
  (é isso que liga a volta — Endpoint 2).
- Como a vistoria aparece na UI do CheckVisto = decisão do CheckVisto (o contrato não manda).

**Response 200:** `{ "ok": true, "imovelId": "<id do imóvel espelho>", "agendaId": "<id da AGENDA no CheckVisto>", "jaExistia": false }`
**Erros:** 401 (secret), 400 (payload inválido — dizer qual campo).

> ⚠️ **Atenção ao id:** aqui o CheckVisto devolve o id da **agenda** (`agendaId`), NÃO o da vistoria — a
> vistoria ainda nem existe no momento do solicit (o vistoriador cria depois). Já o Endpoint 2 (webhook)
> manda `vistoriaId` = id da **vistoria**. São docs diferentes de propósito. Por isso o Hub guarda o
> `agendaId` como `idExterno` provisório e, no 1º webhook, "promove" a solicitação agendada
> (por `hubImovelId`+`tipo`+`status:'agendada'`) e passa a rastrear pela `vistoriaId` dali em diante.
> **Não trocar o `agendaId` por `vistoriaId` na resposta do solicit** — regrediria o campo pra vazio.

## Endpoint 2 — no HUB: `vistoriaWebhook`

HTTPS `onRequest`, método POST, JSON. O CheckVisto chama **sempre que uma vistoria de
`origem:'hub'` muda de status** (criada, agendada, realizada, laudo emitido).

**URLs (pelo `ambiente` gravado na vistoria):**
- prod:    `https://southamerica-east1-remax-smart-hub.cloudfunctions.net/vistoriaWebhook`
- staging: `https://southamerica-east1-remax-smart-hub-staging.cloudfunctions.net/vistoriaWebhook`

**Request:**
```json
{
  "hubImovelId": "abc123",             // o que veio na solicitação (OBRIGATÓRIO)
  "vistoriaId":  "<id no CheckVisto>", // id externo — chave de idempotência (OBRIGATÓRIO)
  "tipo":        "entrada",            // "entrada" | "saida" (OBRIGATÓRIO)
  "status":      "laudo_emitido",      // ver mapeamento abaixo (OBRIGATÓRIO)
  "laudoUrl":    "https://...",        // obrigatório quando status = laudo_emitido
  "obs":         "..."                 // opcional
}
```

**Mapeamento de status** (o CheckVisto traduz os status internos dele pra estes 3, que
são os únicos que o Hub conhece):
| No CheckVisto (interno) | Manda pro Hub |
|---|---|
| criada / agendada / aguardando | `agendada` |
| em andamento / realizada / concluída sem laudo | `realizada` |
| laudo emitido / finalizada com laudo | `laudo_emitido` |

**O que o Hub faz ao receber** (lado do Hub, já combinado):
- Valida secret + payload + que o imóvel existe.
- **Upsert idempotente** em `vistorias`: procura doc com `idExterno == vistoriaId`;
  atualiza se existe, cria se não (com `origem: 'checkvisto'`, `corretorUid` do imóvel).
- `laudo_emitido` com `laudoUrl` → o checklist automático do imóvel anda sozinho
  (`recomputarChecklistAuto`) e a timeline do imóvel registra.

**Response 200:** `{ "ok": true }` · **Erros:** 401 (secret), 400 (payload), 404 (imóvel não existe).
**Retry:** se o Hub responder 5xx, re-tentar até 3x com backoff (1min, 5min, 30min) é
bem-vindo mas NÃO obrigatório na v1 — falhou, loga e segue (o corretor ainda consegue
registrar na mão como hoje; a integração é conforto, não trava).

## Regra de ouro no CheckVisto: 100% ADITIVO (pra não ter como quebrar o app)

O lado do CheckVisto NÃO PODE alterar nenhuma linha do código existente:

- `hubSolicitarVistoria` = Cloud Function **nova** (nada do app atual chama ela).
- O aviso pro Hub = **trigger do Firestore novo** (`onDocumentWritten` na coleção de
  vistorias, filtrando `origem == 'hub'`) — NUNCA um hook enfiado no fluxo existente.
  Trigger roda depois da escrita, em processo separado: se falhar, a vistoria já foi
  salva e o app nem percebe (erro fica só no log do trigger).
- Deploy sempre com `--only functions:hubSolicitarVistoria,functions:<nomeDoTrigger>` —
  não republicar hosting nem as outras functions.
- Se durante a implementação parecer necessário editar código existente do CheckVisto,
  PARAR e avisar o Nathan — não improvisar.

Com isso o pior cenário possível é "a integração não funciona ainda" — nunca
"o app de vistoria quebrou".

## Regras de fronteira (importantes)

- **Cada chat/sessão mexe SÓ no seu repo.** O chat do CheckVisto pode LER
  `C:\Users\Natha\OneDrive\Desktop\hub\INTEGRACAO-CHECKVISTO.md` (este arquivo) como
  referência, mas nunca escrever na pasta do Hub — e vice-versa.
- **Secrets**: só o Nathan grava (comandos acima). Nenhum dos dois lados imprime o valor.
- **Staging primeiro**: o lado do Hub nasce no staging; o CheckVisto (que não tem staging)
  atende os dois ambientes e usa o campo `ambiente` pra saber pra qual webhook responder.
  Teste ponta a ponta no staging antes do Hub de produção usar.
- **v2 (fora deste contrato)**: cancelamento de solicitação, fotos além do laudo,
  agendamento com data/hora vindo do Hub.

## Checklist de implementação

**CheckVisto (outro chat):**
- [ ] `hubSolicitarVistoria` (onRequest, secret, idempotente, grava hubImovelId/ambiente/origem)
- [ ] disparo do webhook nas mudanças de status de vistoria `origem:'hub'` (trigger ou hook no fluxo existente)
- [ ] mapeamento de status interno → os 3 do contrato
- [ ] deploy + me passar a URL final do `hubSolicitarVistoria`

**Hub (este chat):**
- [ ] `vistoriaWebhook` (onRequest, secret, upsert por idExterno, checklist + timeline)
- [ ] `locSolicitarVistoriaCheckVisto` (onCall) + botão "Solicitar vistoria" na Gestão da Locação (Tela 03)
- [ ] staging primeiro, teste ponta a ponta, depois produção (com OK do Nathan)

**Nathan (1x):**
- [ ] gerar o segredo e gravar nos 3 lugares (comandos na seção Autenticação)
- [ ] colar no chat do Hub a URL do `hubSolicitarVistoria` quando o CheckVisto terminar
