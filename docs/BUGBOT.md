# Bug Fix Bot

Bot autônomo que investiga um bug (ou melhoria pontual) no repo e **propõe** um fix — a
regra de ouro é "propõe → você dispõe": ele **nunca** faz merge, sobe versão ou publica
o `.exe`. Isso continua 100% manual, feito pelo Nathan.

## Como acionar manualmente

GitHub → aba **Actions** → workflow **Bug Fix Bot** → **Run workflow** → preenche o campo
`descricao` (o bug ou a melhoria pedida) → Run.

Não precisa de PAT nem da Cloud Function pra esse caminho manual — só do secret
`CLAUDE_CODE_OAUTH_TOKEN` já configurado no repo.

## Fluxo (propõe → PR → revisão)

1. O workflow grava a descrição recebida em `bugbot-input.md`, na raiz do repo.
2. Cria um branch isolado (`bot/fix-<run_id>`).
3. O Claude lê `bugbot-input.md` e o `CLAUDE.md` (regras do projeto), investiga a causa
   raiz e, se houver um fix seguro, edita os arquivos com a correção mínima.
4. O Claude grava `BUGBOT-DIAGNOSTICO.md` — sempre, mesmo quando a conclusão é "não achei
   bug" ou "não é seguro corrigir". É a única forma dele reportar o que fez.
5. O workflow roda os mesmos checks da CI (`npm run lint` + `node --check`).
6. Se houve mudança de código, ele abre um **Pull Request** pra `main` com o diagnóstico e
   o resultado dos checks no corpo — pronto pra revisão humana.

## Disparo automático (via erro real)

Existe também um caminho automático: a Cloud Function `onErroParaBot` observa
`_erros/{id}` e pode disparar o mesmo fluxo via `repository_dispatch`. Vem **desligado por
padrão** (kill switch `_bot_config/bugfix.habilitado`) e tem dedupe + rate-limit de 1 PR a
cada 24h por tipo de erro. Detalhes de setup em `CLAUDE.md` (seção "Bug Fix Bot").
