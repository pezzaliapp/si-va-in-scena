// Genera le icone PNG dell'app senza dipendenze esterne.
// Disegno: un fascio di luce su un palco, su fondo scuro.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [29, 27, 24];
const LIGHT = [246, 240, 228];
const ACCENT = [142, 36, 36];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** scale < 1 lascia margine per le icone "maskable". Supersampling 4x4 per bordi morbidi. */
function icon(scale) {
  return (px, py, size) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const u = ((px + (sx + 0.5) / 4) / size - 0.5) / scale + 0.5;
      const v = ((py + (sy + 0.5) / 4) / size - 0.5) / scale + 0.5;
      let c = BG;
      // fascio di luce: trapezio dall'alto verso il palco
      const top = 0.16, floor = 0.72;
      if (v >= top && v <= floor) {
        const t = (v - top) / (floor - top);
        const half = 0.05 + t * 0.25;
        if (Math.abs(u - 0.5) <= half) c = mix(BG, LIGHT, 0.18 + t * 0.2);
      }
      // cerchio di luce sul palco
      const dx = (u - 0.5) / 0.3, dy = (v - floor) / 0.07;
      if (dx * dx + dy * dy <= 1) c = LIGHT;
      // proiettore
      if (Math.abs(u - 0.5) <= 0.07 && v >= 0.1 && v <= 0.17) c = LIGHT;
      // proscenio
      if (v >= 0.8 && v <= 0.84 && u >= 0.14 && u <= 0.86) c = ACCENT;
      acc = acc.map((a, i) => a + c[i]);
    }
    return acc.map((a) => Math.round(a / 16));
  };
}

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), png(192, icon(1)));
writeFileSync(new URL('icon-512.png', out), png(512, icon(1)));
writeFileSync(new URL('icon-maskable-512.png', out), png(512, icon(0.8)));
writeFileSync(new URL('apple-touch-icon.png', out), png(180, icon(0.9)));
console.log('Icone generate in public/icons/');
