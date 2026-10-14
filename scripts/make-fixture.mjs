#!/usr/bin/env node
// Generates test/fixtures/ean13.y4m: a still EAN-13 barcode as a Y4M video that Chromium
// plays as a fake camera (--use-file-for-fake-video-capture). Pure Node — no ffmpeg needed.
//
//   node scripts/make-fixture.mjs [value] [out]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const value = process.argv[2] ?? '5012345678900';
const out = resolve(root, process.argv[3] ?? 'test/fixtures/ean13.y4m');

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).join(''));
const G = R.map((c) => [...c].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Modules(v) {
  if (!/^\d{13}$/.test(v)) throw new Error(`EAN-13 needs 13 digits, got ${v}`);
  const d = [...v].map(Number);
  const sum = d.slice(0, 12).reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== d[12]) throw new Error(`Bad EAN-13 check digit in ${v}`);
  const parity = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

const W = 640;
const H = 480;
const MODULE = 4; // px per module
const FRAMES = 3;
const WHITE = 235;
const BLACK = 16;

const bits = ean13Modules(value);
const barWidth = bits.length * MODULE;
const x0 = Math.floor((W - barWidth) / 2);
const y0 = Math.floor(H * 0.25);
const y1 = Math.floor(H * 0.75);

const y = Buffer.alloc(W * H, WHITE);
for (let row = y0; row < y1; row++) {
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    y.fill(BLACK, row * W + x0 + i * MODULE, row * W + x0 + (i + 1) * MODULE);
  }
}
const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma]);
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, ...Array(FRAMES).fill(frame)]));
console.log(`Wrote ${out} (EAN-13 ${value}, ${W}x${H}, ${FRAMES} frames)`);
