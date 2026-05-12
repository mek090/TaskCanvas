// Generates a 1024×1024 RGBA PNG with the TaskCanvas brand gradient.
// Used as the source for `npx tauri icon icons/source.png`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1024;
const H = 1024;

const rowStride = W * 4 + 1;
const raw = Buffer.alloc(rowStride * H);

for (let y = 0; y < H; y++) {
  raw[y * rowStride] = 0;
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H - 2);
    const r = Math.round(124 * (1 - t) + 6 * t);
    const g = Math.round(58 * (1 - t) + 182 * t);
    const b = Math.round(237 * (1 - t) + 212 * t);
    const off = y * rowStride + 1 + x * 4;
    raw[off] = r;
    raw[off + 1] = g;
    raw[off + 2] = b;
    raw[off + 3] = 255;
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.writeUInt8(8, 8);
ihdr.writeUInt8(6, 9);
ihdr.writeUInt8(0, 10);
ihdr.writeUInt8(0, 11);
ihdr.writeUInt8(0, 12);

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'icons', 'source.png');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, png);
console.log(`wrote ${png.length} bytes → ${dest}`);
