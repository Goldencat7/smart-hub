# Bugs da esteira de Imóveis/Locação — checklist pra reestruturação

Achados numa caça-bugs em **2026-07-15** (varredura + verificação manual). Ficaram **de
fora** dos fixes daquela data de propósito: vivem na esteira de Locação que o Nathan vai
reestruturar — melhor resolver **junto** com a reestruturação do que mexer agora e conflitar.

Todos **confirmados lendo o código** (não são hipótese). Ordem: mais grave primeiro.

---

## 🟠 1. Administrativo consegue desfazer decisão exclusiva do gestor
**Onde:** `functions/index.js` → `locMoverImovelStatus` (~linha 823-870), máquina de estados 842-857.

**O quê:** a trava `IMOVEL_STATUS_SO_GESTOR` só impede **ENTRAR** em `aprovado`/`em_contrato`.
Não há trava pra **voltar atrás**. Como `recebido`/`em_analise` não são "só gestor", um
**administrativo** (ou qualquer um que mova imóvel) pode:
- `aprovado → em_analise` / `recebido` — desfazendo a aprovação que é decisão do gestor;
- `em_contrato → em_analise` — deixando o doc em `contratos` **órfão**.

É alcançável pela UI: em `hub-app.js` `cardImovelHtml` (~3392-3394) as opções
`recebido`/`em_analise` ficam habilitadas mesmo com o imóvel em `aprovado`/`em_contrato`.

**Direção de fix:** guardar as transições de saída — ex.: sair de `aprovado`/`em_contrato`
só o gestor; `em_contrato` não sai pela esteira (só via cancelamento de contrato, que limpa
`contratos`). Idealmente uma tabela de transições permitidas por papel, em vez de só checar
o estado de destino.

---

## 🟠 2. Admin não recebe o aviso no sininho quando chega ficha do locador
**Onde:** `functions/index.js` → `enviarFichaParaAdmin` (~linha 3622).

**O quê:**
```js
const adminsSnap = await db.collection('user_profiles').where('isAdmin', '==', true).get();
```
`isAdmin` **nunca é gravado** em `user_profiles` no código de produção (admin é custom claim
`admin`; `salvarMeuPerfil` só grava nome/foto/updatedAt). A query volta **sempre vazia** → o
`batch` de notificações é commitado vazio → **nenhum admin vê a notificação no Hub**. Só o
e-mail ao administrativo funciona. Falha silenciosa (sem erro).
*(No emulador o bug some, porque o `scripts/emu-seed.js` grava `isAdmin` — em produção não.)*

**Direção de fix:** ou (a) enumerar admins por claim (`admin.auth().listUsers()` filtrando
`customClaims.admin`, ok pra ~22 users), ou (b) fazer `setUserAdmin` gravar `isAdmin` em
`user_profiles` junto com a claim **e** dar backfill nos admins atuais. A (a) não precisa de
backfill. O irmão `enviarFichaTipoAdmin` nem tenta notificar no Hub — alinhar os dois.

---

## 🟡 3. Corrida no `numeroProtocolo`
**Onde:** `functions/index.js` → `locListarImoveis` (~linha 677-687).

**O quê:** a listagem faz **backfill** de `numeroProtocolo` (escrita) **durante um GET**. Duas
chamadas concorrentes de `locListarImoveis` podem detectar `numeroProtocolo == null` no
**mesmo** imóvel e chamar `proximoNumeroProtocolo()` duas vezes → um número é consumido à toa
(buraco na sequência) e, transitoriamente, o imóvel mostra número diferente do retornado.

**Severidade:** baixa/cosmética (a sequência ganha buracos, nada quebra).

**Direção de fix:** mover o carimbo do protocolo pro momento da **criação** do imóvel
(`onFichaLocadorEnviadaAdmin` já gera protocolo ao criar — o backfill no GET é pra imóveis
antigos sem número). Alternativa: fazer o backfill numa transação que só escreve se ainda
estiver null, e não retornar número novo se outro já gravou.

---

_(Fora desta lista, na mesma caça-bugs, já foram corrigidos em 2026-07-15: PII órfã do 1º
locador em `onFichaLocadorEnviadaAdmin`, a guarda do `setUserAdmin`, e a trava anti-produção
do `emu-seed.js`. E o interruptor de ambiente foi revisado sem bug de produção.)_
