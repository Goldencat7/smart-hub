# Smart Hub → produto white-label (multi-imobiliária)

> Plano de arquitetura pra transformar o Hub (hoje instância única da REMAX Smart) em
> produto que atende várias imobiliárias. Escrito em 2026-08-12. Companheiro do
> diagnóstico de performance (seção 6), que é **pré-requisito** de escalar bem.

## 0. TL;DR

- **Firebase aguenta** — o gargalo nunca vai ser capacidade do Firestore; é **cold start de Cloud Function** (ver §6) e acoplamento de código.
- Hoje o sistema é **single-tenant com acoplamento ALTO**: marca, projeto Firebase, catálogo de portais, e-mails, UIDs do dono e regras de comissão estão como literais espalhados no código.
- **Modelo recomendado: 1 projeto Firebase por imobiliária + MESMO código (um repo) dirigido por configuração + subdomínio por tenant.** Não é fork de código — é o mesmo build apontando pra projetos diferentes, com uma camada de config (marca, apps, regras) por tenant.
- **Rejeitado:** "tudo junto num projeto só com `tenantId` em cada documento". Bom pra SaaS comum, **arriscado aqui** — o Hub é um cofre de senhas de sistemas (`getCredentials` confia em qualquer logado); um bug de regra vazaria credenciais entre imobiliárias. Isolamento por projeto é a defesa certa pra esse tipo de dado.

## 1. Por que projeto-por-tenant (e não tenantId compartilhado)

| Critério | Projeto por tenant (recomendado) | tenantId compartilhado |
|---|---|---|
| Isolamento de dados/credenciais | **Total** (bancos separados) | Depende 100% de regras sem bug |
| Risco de vazamento entre imobiliárias | Praticamente nulo | Alto (cofre de senhas!) |
| KMS / Auth domain / buckets | Naturais por projeto | Compartilhados (mistura) |
| Custo de deploy por release | N deploys (script em loop) | 1 deploy |
| Complexidade de código | Baixa (quase nada muda) | Alta (`tenantId` em toda query/regra) |
| LGPD / exclusão / backup por cliente | Simples (por projeto) | Complexo (filtrar em tudo) |

O único preço real é **N deploys por release** — resolvível com um script que roda `firebase deploy --project <cada-tenant>` em loop. Pra um cofre de credenciais + PII, vale muito mais que o risco do modelo compartilhado.

## 2. Arquitetura alvo

```
                 imobiliariaA.smarthubapp.com.br ─┐
                 imobiliariaB.smarthubapp.com.br ─┼─► MESMO código (este repo)
                 remax.smarthubapp.com.br ────────┘        │
                                                            ▼
                          firebase-env.js resolve por hostname → projeto do tenant
                                                            │
        ┌──────────────────────────┬────────────────────────┴───────────────┐
        ▼                          ▼                                         ▼
   Projeto Firebase A         Projeto Firebase B                       Projeto REMAX
   (Firestore/Auth/KMS/       (isolado)                                (isolado)
    buckets/functions)             │
        │                          └── config/tenant  ◄── marca, APPS, comissão, e-mails, região
        └── config/tenant
```

- **Uma camada de config por tenant** vive em `config/tenant` (Firestore) — lida no boot e injeta marca, catálogo de apps, regras de comissão, e-mails, região da calculadora. O que hoje é literal vira leitura dessa config.
- **Subdomínio** → estende a lógica que o `firebase-env.js` **já tem** (resolve config por hostname). Só ampliar o mapa hostname→projeto.
- **Autologin (Electron):** o objeto `configs` do `main.js` (seletores de login por site) passa a ser lido da config do tenant, não cravado.

## 3. O que precisa virar configurável (inventário)

Acoplamento hoje = **ALTO**. Agrupado por dificuldade:

### 3A. Fácil (virar variável/config de texto)
- **Marca:** títulos (`login.html:5`, `index.html:5`, `admin.html:5`, `broker.html:5`), `logo.png` (asset único na raiz), prefixo do código de convite `REMAX-XXXX` (`login.html:96`, `admin.html:286`), manifest PWA (`pwa/manifest.webmanifest`), cores de marca — **`#DC1C2E` está cravado literalmente em ~8 pontos** do `styles.css` (deveria já ser `var(--danger)`), `--brand` do Broker (`broker.css:21`).
- **E-mails** (`functions/index.js:105-106`): `SUPORTE_EMAIL = nathangabriel@remax.com.br` (remetente E destino de todo e-mail), `FICHAS_ADMIN_EMAIL = marcelogutierres@remax.com.br`, alias de feed (`:6626`), robô Drive `remaxsmarthub@gmail.com` (`:4771`).
- **UID admin bootstrap** — cravado em **3 lugares** (`hub-app.js:157`, `functions/index.js:243-244`, `scripts/importar-feed-imoveis.js:30`): são UIDs pessoais do Nathan. Viram "o dono daquele tenant".
- **Regras de comissão** (`broker-app.js:260-266`): venda 6%, locação 100%, parceria 3%, negociadas 4/5%. E a **lista de nomes** de corretores 45%/40% (`broker-app.js:143-148`) — deveria virar campo no perfil de cada corretor, não lista no código.

### 3B. Médio (config + tocar 2 camadas juntas)
- **Catálogo de apps + autologin** (a espinha do "hub"): array `APPS` (`hub-app.js:161-235`, 14 portais) + objeto `configs` de seletores de login (`main.js:605-641`) + tratamento especial por host (`main.js:644-652`). A chave `siteKey` amarra **APPS ↔ `credentials/{siteKey}` ↔ `user_access`** — os três têm que usar as mesmas chaves da config do tenant. Mexe em `hub-app.js` e `main.js` ao mesmo tempo.
- **Infra por tenant** (`firebase-env.js` + cópia `public/firebase-env.js`): objetos `PROD`/`STAGING` cravados. `functions/index.js` **já** parametriza projeto/bucket por `GCLOUD_PROJECT` (só o fallback é REMAX) ✅ — mas o **KMS está cravado** (`functions/index.js:35`, sem env) e precisa virar env por projeto.

### 3C. Difícil (assets binários / tabelas regionais / provisionamento)
- **Contrato de representação:** PDF-modelo binário (`functions/assets/contrato-representacao-pf.pdf`) com CNPJ/razão social/comissão 6%/foro embutidos NO ARQUIVO + o mapa `CONTRATO_CAMPOS` (`functions/index.js:3604`) colado a esse PDF. Cada imobiliária = PDF + mapa próprios. Termos de uso (`public/termos.html`) idem.
- **Calculadoras regionais:** ITBI 3% (alíquota de SP, `calculadoras.html:449`), tabela de emolumentos 2026 do cartório de SP (33 faixas, `:400-437`), benchmark REMAX Broker 101. Tudo específico de SP/REMAX → tabelas por região/tenant.
- **Provisionamento de infra:** cada tenant precisa de projeto Firebase próprio (Auth domain, KMS keyring, buckets, backup), e — se cada um tiver `.exe` próprio — repo GitHub de auto-update (`package.json:89-90`) e `appId`/`productName` próprios.

## 4. Roadmap sugerido (por fases, sem parar a operação REMAX)

**Fase 0 — Higiene (barato, já ajuda a REMAX):**
- Trocar os `#DC1C2E` literais por `var(--danger)`/token.
- Tirar a lista de corretores 45%/40% do código → campo no perfil.
- Mover KMS e e-mails pra env/config.

**Fase 1 — Camada de tenant (fundação):**
- Criar `config/tenant` (Firestore) + um `carregarTenant()` no boot que injeta marca (nome, logo, cores), e-mails e regras de comissão.
- Ampliar o `firebase-env.js` pra resolver projeto por subdomínio.

**Fase 2 — Apps/autologin configuráveis:**
- `APPS` e os seletores do `main.js` passam a vir da config do tenant (mantendo `siteKey` como chave única que liga credentials/user_access).

**Fase 3 — Assets por tenant:**
- Contrato PDF + mapa, termos, calculadoras (alíquotas/tabelas por região) parametrizados.

**Fase 4 — Provisionamento & operação:**
- Script "novo tenant": cria projeto Firebase, KMS, buckets, semeia config, deploya. Script de deploy em loop sobre todos os tenants. Monitoramento por projeto.

## 5. Custo / escala (Firebase)

- Firestore/Auth escalam com folga pra dezenas de imobiliárias e centenas de corretores. O que monitorar: **custo de leitura** (o tempo real multiplica por tenant — hoje ~785 leituras/dia por instância, irrisório), **índices compostos** e **cota de instâncias de Function por projeto**.
- Projeto-por-tenant **separa o custo por cliente** (fatura limpa por imobiliária) — bom pra cobrar.

## 6. Performance — pré-requisito (a lentidão de hoje)

Diagnóstico 2026-08-12: "demora pra abrir" **não é o Firestore** — é cold start de Cloud Function + chamadas em série no login. Quick-wins, por retorno:

| Prioridade | Ação | Onde | Esforço | Ganho |
|---|---|---|---|---|
| 🥇 1 | `minInstances: 1` nas ~6 functions do login | `functions/index.js` (getMinhasPermissoes, listarStatusApps, listarBanners, getMeuPerfil, statusGoogleAgenda, listarEventos) | Baixo | Alto |
| 🥈 2 | Lazy-load do Broker + lucide (~675 KB) só ao abrir "Meus Negócios" | `index.html:551-552,7` | Médio | Alto (celular) |
| 🥉 3 | Paralelizar `getMinhasPermissoes` com status/banner; e `atualizarStatusGoogle`+`carregarEventos` | `hub-app.js:2058-2126` | Baixo | Médio |
| 4 | SDK Firebase local (ou `modulepreload`) em vez de gstatic | `index.html`, `login.html`, imports | Baixo→Médio | Médio (rede fria) |

⚠️ **Não usar `minInstances` global** (`setGlobalOptions`) — manteria ~150 functions quentes e custaria caro. Só as ~6 do caminho crítico. Custo: centavos/dia por function quente.

**Recomendação:** fazer 🥇+🥈 como release 1.0.155 (baixo risco, ganho grande) antes de onboard da nova imobiliária.

## 7. Veredito / próximo passo concreto

O sistema está **preso à REMAX** em ~7 frentes, mas o caminho é claro e as fundações existem (`GCLOUD_PROJECT` já parametrizado, Drive root já sobreponível, env por hostname já pronto). **As 3 frentes mais trabalhosas:** (1) apps+autologin, (2) contrato/calculadoras (assets binários + tabelas regionais), (3) provisionamento de infra por projeto.

Sugestão de ordem real: **Fase 6 (performance) → Fase 0 (higiene) → Fase 1 (camada de tenant)**. Ao chegar na Fase 1, o primeiro tenant novo já roda com marca/config próprias, mesmo que contrato e calculadoras entrem depois (Fase 3).
