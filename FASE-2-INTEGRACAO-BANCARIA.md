# Fase 2 — Integração bancária (cobrança automática)

> Status: **NÃO INICIADA — bloqueada por decisão + cadastro externo (não é código).**
> Data do documento: 2026-07-08.

## O que é a Fase 2
Hoje (Fase 1) a cobrança é **manual**: o contrato é ativado, o sistema gera as cobranças/repasses previstos, e o gestor/administrativo dá **baixa manual** ("marcar como pago", "marcar como repassado") no Financeiro.

A Fase 2 automatiza isso com um **provedor de cobrança** (gateway):
1. Ao ativar/gerar a cobrança, o sistema chama a API do provedor e cria um **boleto/PIX real**.
2. O inquilino paga.
3. O provedor avisa o sistema por **webhook**, que dá baixa **automática** (status = pago, `origemStatus = 'gateway'`).
4. Com split nativo (ex.: Asaas), o **repasse ao proprietário** pode sair automático também.

## Por que não dá pra "terminar" agora
Não é falta de código — é dependência externa que só a RE/MAX Smart resolve:

1. **Conta no provedor, no CNPJ da imobiliária.** Gerar boleto = movimentar recebível. Exige conta aberta e verificada no CNPJ, com dados bancários de liquidação. Ninguém de fora abre isso pela empresa.
2. **Credencial (API key) só existe após o cadastro.** E **não pode ir no código** (repositório é público) — entra no **Google Secret Manager**. Sem a chave, não há o que integrar.
3. **Código é específico do provedor.** Endpoint, payload e, principalmente, a **verificação de assinatura do webhook** são diferentes em cada provedor. Integração "genérica" seria chute e vira retrabalho.
4. **Homologação/sandbox.** Mesmo pra testar sem dinheiro real, precisa criar a conta e pegar as **chaves de sandbox**.
5. **Fazer pela metade é pior.** Esqueleto genérico = código morto que teria que ser reescrito. Melhor não existir do que existir errado mexendo em dinheiro.

## O que JÁ está pronto pra "plugar e ligar" (feito na Fase 1)
- **Webhook-stub** `locGatewayWebhook` (`functions/index.js`) — endpoint HTTP inerte (retorna 503; flag `GATEWAY_WEBHOOK_ATIVO = false`). URL: `https://southamerica-east1-remax-smart-hub.cloudfunctions.net/locGatewayWebhook`.
- Toda **cobrança** e **repasse** nasce com `status`, **`origemStatus: 'manual'`** e **`idExterno: ''`** (em `gerarCobrancasDoContrato`). O gateway só troca esses dois.
- **Baixa manual (hoje) e confirmação do gateway (Fase 2) escrevem no MESMO lugar** — nada no resto do sistema (telas, alertas, relatórios, portal) depende de como o status foi preenchido. Trocar de manual pra gateway não quebra nada.
- O **portal do inquilino** (Fase 1.5) já existe e já avisa "pagamento online em breve" — é só passar a exibir o boleto/PIX quando o gateway ligar.

## Provedores (comparação rápida)
| Provedor | Boleto/PIX | Split (repasse) | Sandbox | Observação |
|---|---|---|---|---|
| **Asaas** (recomendado) | ✅ | ✅ nativo | ✅ | Mais usado por imobiliária; split encaixa direto no repasse ao proprietário; API simples. |
| Cora | ✅ | parcial | ✅ | Banco digital PJ; sem split tão direto (repasse ficaria manual). |
| Iugu | ✅ | ✅ | ✅ | Robusto; curva um pouco maior. |
| Efí (ex-Gerencianet) | ✅ | limitado | ✅ | Barato; API/experiência menos redonda. |

**Recomendação: Asaas** — pelo split nativo (= o repasse ao proprietário sai automático).

## Passos pra desbloquear (na ordem)
1. **Decidir o provedor** (recomendação: Asaas).
2. **Abrir a conta** no CNPJ da RE/MAX Smart + validar.
3. Pegar a **chave de sandbox** (API key de teste).
4. **Passar a chave** pro dev → ela entra no **Google Secret Manager** (nunca no código).
5. Dev implementa a integração do provedor + testa no **sandbox** (boleto de teste, webhook de teste).
6. Validado, troca pras **chaves de produção** e liga (`GATEWAY_WEBHOOK_ATIVO = true`).

## Plano técnico (quando desbloquear)
- **Secret**: `defineSecret('ASAAS_API_KEY')` (já há padrão de secret no projeto — `SUPPORT_EMAIL_PASS`).
- **Gerar cobrança**: na ativação do contrato (ou sob demanda), chamar a API do provedor → guardar `idExterno` (id do boleto) + `linkBoleto`/`pixCopiaeCola` na cobrança.
- **Webhook**: em `locGatewayWebhook`, (1) validar a assinatura/segredo do provedor, (2) achar a cobrança por `idExterno`, (3) `update({ status:'pago', dataBaixa, origemStatus:'gateway' })`. Idempotente (reprocessar o mesmo evento não duplica baixa).
- **Split/repasse**: com Asaas, configurar o split pro dado bancário do proprietário → repasse automático (com o `revisarRateio` já sinalizando o caso de 2ª titular).
- **Portal do inquilino**: passar a exibir `linkBoleto`/PIX das cobranças em aberto.
- **Segurança**: chave só no Secret Manager; validar assinatura do webhook; App Check nas callables públicas seria um plus.

## Custo estimado
Depende do provedor e do volume. Ordem de grandeza: taxa por boleto emitido/pago (centavos a ~R$2) e/ou % do PIX. Para ~dezenas de contratos/mês, custo baixo — confirmar na tabela do provedor escolhido.

---
Ver também: `CLAUDE.md` (pendências) e a spec em `hub novo/files/REMAX-Gestao-Locacoes-Spec-Fase1.md` (Módulo 4, D-05).
