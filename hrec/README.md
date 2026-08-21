# H-REC AGENDA — módulo de agendamento/fotografia (dentro do Smart Hub)

Adaptação da spec `Agendamento.md` (H-REC AudioVisual) para o **stack real do Hub**:
vanilla JS + Cloud Functions JS, **sem** React/Vite/TS/Tailwind. Os motores de domínio
(preço, disponibilidade) são **UMD** — o mesmo arquivo roda como `require()` nas Cloud
Functions **e** como `window.Hrec.*` no renderer, sem build step (é o "shared/" da spec
traduzido pra realidade sem-bundler do Hub).

> Fonte de verdade das regras de negócio: `C:\Users\Natha\Downloads\Agendamento.md`
> (§ citados abaixo). Protótipo visual: `hrec-agenda.html` (não portar linha a linha —
> 14 bugs catalogados no §11 da spec).

## Estrutura

```
hrec/dominio/
├── enums.js            §5 — status/papéis/tipos canônicos (fonte única de strings)
├── datas.js            fuso America/Sao_Paulo; recebe `now` (nunca Date.now() dentro)
├── precificacao.js     §6 — motor de preço puro
├── disponibilidade.js  §7 — motor de slots (buffer 2 lados, almoço, limiteDia, holds)
└── seed.js             §4 — 2 tabelas + 5 adicionais + config (valores EXATOS do protótipo)

scripts/hrec-seed.js    grava o catálogo no Firestore (emulador por padrão)
test/hrec/*.test.mjs    30 testes dos motores  ·  npm run test:hrec
test/rules/firestore.test.mjs   +10 testes das regras H-REC  ·  npm test
```

## Blocos (§12 da spec)

- ✅ **1 Fundação** — enums, helpers de data/fuso (corrige bug #8).
- ✅ **3 Preço** — paridade numérica exata com as 2 tabelas do protótipo.
- ✅ **4 Disponibilidade** — O(bookings+dias) (corrige bug #12), aplica limiteDia (bug #6).
- ✅ **2 Firestore + Rules + Seed** — regras deny-write em bookings/credits/payments;
  leitura escopada por papel; script de seed do catálogo.
- ⬜ **5 Cloud Functions** — createBooking (transacional, revalida slot → SLOT_TAKEN),
  cancelBooking, expireHolds, transação de crédito (nunca negativo), código HREC-AAAA-NNNNN,
  e uma callable de disponibilidade (ver nota de segurança abaixo).
- ⬜ **6 Wizard (3 telas)** · 7 Meus Agendamentos · 8 Operação · 9 Pagamentos/créditos ·
  10 Relatórios · 11 Admin · 12 Notificações.

## Segurança — desvios conscientes da spec (alinhados ao Hub)

- **Escrita SEMPRE via Cloud Function** (Admin SDK ignora as regras). `bookings`, `credits`,
  `payments` e todo o resto = `write: if false` no `firestore.rules`.
- **Disponibilidade NÃO é lida varrendo `bookings` no cliente** (a spec §7 sugere isso, mas
  vazaria PII de todos os agendamentos pra qualquer corretor). Vai vir por **Cloud Function**
  que devolve só os intervalos ocupados / slots, sem PII — o motor puro roda no servidor.
- **Papéis via custom claims** `{ role, imobiliariaId }` (mintadas por Cloud Function no
  Bloco 5). Staff H-REC (`fotografo`/`administrador`) vê tudo; `broker` vê a própria
  imobiliária; `corretor`/`avulso` veem só o que é seu. `confirmarPagamento` = `administrador` e só.

## Índices compostos necessários (§4) — criar no console (ou via CLI quando houver)

⚠️ O repo **não** tem `firestore.indexes.json` (índices de produção foram criados à mão no
console). Não crie um arquivo global de índices sem listar TODOS os existentes — um
`deploy --only firestore` podaria os que faltarem. Os índices do H-REC:

| Coleção | Campos |
|---|---|
| `bookings` | `imobiliariaId` ASC, `schedule.dateISO` ASC |
| `bookings` | `corretorId` ASC, `createdAt` DESC |
| `bookings` | `status` ASC, `schedule.dateISO` ASC |
| `bookings` | `schedule.dateISO` ASC, `status` ASC (motor de disponibilidade) |

Na prática, o Firestore devolve um link "criar índice" na 1ª query que precisar — dá pra
criar sob demanda em dev.

## Como rodar

```bash
npm run test:hrec       # motores puros (não precisa de emulador)
npm test                # regras no emulador (precisa Java 21 no PATH)
npm run emu             # sobe o emulador (em outra janela)
npm run hrec:seed       # semeia o catálogo no emulador
# semear projeto real (staging primeiro!): HREC_SEED_PROJECT=<id> node scripts/hrec-seed.js
```

## Ainda NÃO ligado ao Hub

Nada em `hrec/` está plugado nas telas nem deployado. É só domínio + testes + regras + seed.
A integração (sidebar, wizard, callables) começa no Bloco 5/6.
