// Erzeugt src/ui/icon.png (256×256): monochromes Quadrat mit Papierkorb. Aufruf: node tools/make-icon.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const N = 256, SS = 4;
const mix = (a, b, t) => a + (b - a) * t;
const inRound = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
function shape(x, y) {
  if (!inRound(x, y, 8, 8, 248, 248, 58)) return null; // transparent
  const t = (x + y) / (2 * N);
  let c = [mix(124, 34, t), mix(92, 211, t), mix(255, 238, t), 255];
  const white = [255, 255, 255, 255];
  if (inRound(x, y, 108, 54, 148, 76, 8)) c = white;              // Griff
  if (inRound(x, y, 112, 62, 144, 76, 2)) c = [mix(124, 34, t), mix(92, 211, t), mix(255, 238, t), 255];
  if (inRound(x, y, 70, 72, 186, 90, 9)) c = white;                // Deckel
  const k = (y - 100) / 104, inset = 8 * Math.max(0, k);
  if (y >= 100 && y <= 204 && inRound(x, y, 82 + inset, 100, 174 - inset, 204, 14)) {
    c = white;
    for (const sx of [107, 128, 149]) if (Math.abs(x - sx) <= 5 && y >= 120 && y <= 184) c = [mix(124, 34, t), mix(92, 211, t), mix(255, 238, t), 255];
  }
  return c;
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < SS; i++) for (let j = 0; j < SS; j++) {
      const c = shape(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
      if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = a / (SS * SS);
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'src', 'ui', 'icon.png'), png);
console.log('src/ui/icon.png geschrieben');
