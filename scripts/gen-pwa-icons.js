#!/usr/bin/env node
/**
 * Gera os ícones do PWA a partir do ícone do app (build/icon.ico).
 *
 * Roda uma vez só (os PNGs gerados ficam versionados em pwa/icons/) — só precisa
 * rodar de novo se o build/icon.ico mudar:  node scripts/gen-pwa-icons.js
 *
 * Sem dependências: o .ico do electron-builder guarda cada tamanho como um PNG
 * inteiro, então dá pra extrair o de 256x256, decodificar (zlib), redimensionar
 * (bilinear) e re-encodar — tudo com o que vem no Node.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'pwa', 'icons');

// ─── Extrai o maior PNG de dentro do .ico ────────────────────────────────────
function maiorPngDoIco(icoPath) {
  const ico = fs.readFileSync(icoPath);
  const qtd = ico.readUInt16LE(4);
  let melhor = null;
  for (let i = 0; i < qtd; i++) {
    const o = 6 + i * 16;
    const largura = ico[o] || 256;
    const tam = ico.readUInt32LE(o + 8);
    const off = ico.readUInt32LE(o + 12);
    const bloco = ico.subarray(off, off + tam);
    const ehPng = bloco.subarray(0, 4).toString('hex') === '89504e47';
    if (ehPng && (!melhor || largura > melhor.largura)) melhor = { largura, bloco };
  }
  if (!melhor) throw new Error('Nenhuma entrada PNG dentro do .ico');
  return melhor.bloco;
}

// ─── Decodifica PNG (8 bits, RGB ou RGBA) → { w, h, rgba } ───────────────────
function decodificarPng(buf) {
  let pos = 8; // pula a assinatura
  let w = 0, h = 0, corTipo = 0, profundidade = 0;
  const pedacos = [];
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const tipo = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const dados = buf.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'IHDR') {
      w = dados.readUInt32BE(0);
      h = dados.readUInt32BE(4);
      profundidade = dados[8];
      corTipo = dados[9];
    } else if (tipo === 'IDAT') {
      pedacos.push(dados);
    } else if (tipo === 'IEND') break;
    pos += 12 + tam; // tamanho + tipo + dados + CRC
  }
  if (profundidade !== 8 || (corTipo !== 6 && corTipo !== 2)) {
    throw new Error(`PNG não suportado (profundidade=${profundidade} corTipo=${corTipo})`);
  }
  const canais = corTipo === 6 ? 4 : 3;
  const bruto = zlib.inflateSync(Buffer.concat(pedacos));
  const linha = w * canais;
  const rgba = Buffer.alloc(w * h * 4);
  const anterior = Buffer.alloc(linha);
  const atual = Buffer.alloc(linha);

  for (let y = 0; y < h; y++) {
    const filtro = bruto[y * (linha + 1)];
    bruto.copy(atual, 0, y * (linha + 1) + 1, y * (linha + 1) + 1 + linha);
    for (let i = 0; i < linha; i++) {
      const a = i >= canais ? atual[i - canais] : 0;  // esquerda
      const b = anterior[i];                          // cima
      const c = i >= canais ? anterior[i - canais] : 0; // diagonal
      let v = atual[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      atual[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * canais, d = (y * w + x) * 4;
      rgba[d] = atual[s];
      rgba[d + 1] = atual[s + 1];
      rgba[d + 2] = atual[s + 2];
      rgba[d + 3] = canais === 4 ? atual[s + 3] : 255;
    }
    atual.copy(anterior);
  }
  return { w, h, rgba };
}

// ─── Redimensiona (bilinear) ─────────────────────────────────────────────────
function redimensionar(img, destW, destH) {
  const out = Buffer.alloc(destW * destH * 4);
  const escalaX = img.w / destW, escalaY = img.h / destH;
  for (let y = 0; y < destH; y++) {
    const sy = Math.min(img.h - 1, (y + 0.5) * escalaY - 0.5);
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(img.h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < destW; x++) {
      const sx = Math.min(img.w - 1, (x + 0.5) * escalaX - 0.5);
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(img.w - 1, x0 + 1);
      const fx = sx - x0;
      for (let ch = 0; ch < 4; ch++) {
        const p00 = img.rgba[(y0 * img.w + x0) * 4 + ch];
        const p10 = img.rgba[(y0 * img.w + x1) * 4 + ch];
        const p01 = img.rgba[(y1 * img.w + x0) * 4 + ch];
        const p11 = img.rgba[(y1 * img.w + x1) * 4 + ch];
        const topo = p00 + (p10 - p00) * fx;
        const base = p01 + (p11 - p01) * fx;
        out[(y * destW + x) * 4 + ch] = Math.round(topo + (base - topo) * fy);
      }
    }
  }
  return { w: destW, h: destH, rgba: out };
}

// ─── "Maskable": encolhe o ícone e centraliza numa arte de fundo sólida ───────
// O Android recorta o ícone num círculo/squircle; a zona segura é ~80% do centro.
function comFundo(img, tamanho, fundo /* [r,g,b] */, escalaConteudo = 0.66) {
  const dentro = Math.round(tamanho * escalaConteudo);
  const pequeno = redimensionar(img, dentro, dentro);
  const out = Buffer.alloc(tamanho * tamanho * 4);
  for (let i = 0; i < tamanho * tamanho; i++) {
    out[i * 4] = fundo[0];
    out[i * 4 + 1] = fundo[1];
    out[i * 4 + 2] = fundo[2];
    out[i * 4 + 3] = 255;
  }
  const off = Math.round((tamanho - dentro) / 2);
  for (let y = 0; y < dentro; y++) {
    for (let x = 0; x < dentro; x++) {
      const s = (y * dentro + x) * 4;
      const alfa = pequeno.rgba[s + 3] / 255;
      if (alfa === 0) continue;
      const d = ((y + off) * tamanho + (x + off)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[d + ch] = Math.round(pequeno.rgba[s + ch] * alfa + out[d + ch] * (1 - alfa));
      }
      out[d + 3] = 255;
    }
  }
  return { w: tamanho, h: tamanho, rgba: out };
}

// ─── Encoda PNG (sem filtro, zlib nível 9) ───────────────────────────────────
function pedaco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0);
  return Buffer.concat([tam, corpo, crc]);
}
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff);
}
function encodarPng(img) {
  const linha = img.w * 4;
  const bruto = Buffer.alloc((linha + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    bruto[y * (linha + 1)] = 0; // filtro "none"
    img.rgba.copy(bruto, y * (linha + 1) + 1, y * linha, (y + 1) * linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;   // profundidade
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0))
  ]);
}

// ─── Main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(SAIDA, { recursive: true });
const original = decodificarPng(maiorPngDoIco(path.join(RAIZ, 'build', 'icon.ico')));
console.log(`Ícone base: ${original.w}x${original.h}`);

// Fundo = a própria cor de canto do ícone (se for opaca), pra a moldura do
// maskable não virar um quadrado visível dentro do outro. Cai pro --surface se
// o canto for transparente.
const canto = original.rgba[3] === 255
  ? [original.rgba[0], original.rgba[1], original.rgba[2]]
  : [29, 34, 45];
const gerados = [
  ['icon-192.png', redimensionar(original, 192, 192)],
  ['icon-512.png', redimensionar(original, 512, 512)],
  ['icon-maskable-512.png', comFundo(original, 512, canto)],
  ['apple-touch-icon.png', comFundo(original, 180, canto, 0.86)] // iOS não respeita transparência
];
for (const [nome, img] of gerados) {
  const destino = path.join(SAIDA, nome);
  fs.writeFileSync(destino, encodarPng(img));
  console.log(`  ✓ ${nome} (${img.w}x${img.h}, ${fs.statSync(destino).size} bytes)`);
}
console.log('Pronto — ícones em pwa/icons/');
