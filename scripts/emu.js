#!/usr/bin/env node
/* Sobe o Firebase Emulator Suite garantindo o Java certo.
 * ---------------------------------------------------------------------------
 * Os emuladores de Firestore e Storage são programas Java e exigem Java 11+.
 * No Windows, a Oracle fixa um "java8path" na frente do PATH do sistema, então
 * um `java` cru pode resolver pro Java 8 (velho demais) mesmo com o 21 instalado.
 *
 * Aqui a gente prependa o `JAVA_HOME/bin` no PATH do processo do emulador — assim
 * o Java do JAVA_HOME (21+) vence, SEM cravar um caminho absoluto no repo (cada
 * máquina tem o seu; o Nathan trabalha em dois PCs). Instalou o JDK e o JAVA_HOME
 * aponta pra ele? Funciona em qualquer máquina.
 *
 * Uso: `npm run emu` (todos) — repassa argumentos extras pro firebase.
 *      `npm run emu -- --only firestore,functions`  (subconjunto)
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = { ...process.env };
const jh = env.JAVA_HOME;

if (jh && fs.existsSync(path.join(jh, 'bin'))) {
  env.PATH = path.join(jh, 'bin') + path.delimiter + (env.PATH || '');
} else {
  console.warn('\n⚠  JAVA_HOME não está definido (ou não tem /bin). Os emuladores de');
  console.warn('   Firestore/Storage precisam de Java 11+. Se derem erro de Java, instale');
  console.warn('   um JDK (ex.: winget install EclipseAdoptium.Temurin.21.JDK) e reabra o terminal.\n');
}

// Repassa qualquer flag extra depois do "emu" (ex.: --only firestore).
const extra = process.argv.slice(2);
const args = ['emulators:start', '--project', 'remax-smart-hub', ...extra];

const p = spawn('firebase', args, { stdio: 'inherit', shell: true, env });
p.on('exit', (code) => process.exit(code == null ? 0 : code));
p.on('error', (err) => { console.error('Falha ao iniciar o firebase:', err.message); process.exit(1); });
