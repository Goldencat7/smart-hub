#!/usr/bin/env node
/* Copia os motores de domínio H-REC (UMD) de `hrec/dominio/` para
 * `functions/hrec-dominio/`, porque o Firebase só faz UPLOAD da pasta `functions/`
 * — um require('../../hrec/dominio') quebraria em produção. A cópia é ARTEFATO
 * (gitignored); o canônico é `hrec/dominio/`. Roda no predeploy e antes dos testes
 * das functions. Idempotente.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'hrec', 'dominio');
const DST = path.join(__dirname, '..', 'functions', 'hrec-dominio');
const ARQUIVOS = ['enums.js', 'datas.js', 'precificacao.js', 'disponibilidade.js', 'seed.js'];

fs.mkdirSync(DST, { recursive: true });
let n = 0;
for (const f of ARQUIVOS) {
  fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
  n++;
}
// Marca a pasta como gerada (pra ninguém editar a cópia por engano).
fs.writeFileSync(path.join(DST, 'GERADO.txt'),
  'Cópia gerada por scripts/hrec-sync-functions.js — NÃO editar. Fonte: hrec/dominio/.\n');
console.log('✅ hrec-sync-functions:', n, 'motores copiados p/ functions/hrec-dominio/');
