// Карта высот земли по SPZ-скану (оффлайн-проверка перед подключением локации).
// node tools/terrain_spz.mjs file.spz [cell=1] [up=-y]
import fs from 'fs';
import zlib from 'zlib';

const [file, cellArg, upArg] = process.argv.slice(2);
const CELL = +(cellArg || 1);
const d = zlib.gunzipSync(fs.readFileSync(file));
const n = d.readUInt32LE(8), fb = d.readUInt8(13);
let o = 16;
const P = new Float32Array(n * 3);
for (let i = 0; i < n * 3; i++) { let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); if (v & 0x800000) v -= 1 << 24; P[i] = v / (1 << fb); o += 3; }
const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = d[o + i] / 255;
const up = upArg || '-y';
// перевод в систему «y вверх»: для -y — поворот на 180° вокруг X: (x, -y, -z)
const pts = [];
for (let i = 0; i < n; i++) {
  if (A[i] < +(process.env.AMIN || 0.4)) continue;
  let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  if (up === '-y') { y = -y; z = -z; }
  pts.push(x, y, z);
}
const m = pts.length / 3;
const xs = [], zs = []; for (let i = 0; i < m; i += 5) { xs.push(pts[i * 3]); zs.push(pts[i * 3 + 2]); }
xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
const q = (s, p) => s[Math.floor(p * (s.length - 1))];
const x0 = q(xs, 0.02), x1 = q(xs, 0.98), z0 = q(zs, 0.02), z1 = q(zs, 0.98);
const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
const cells = Array.from({ length: W * H }, () => []);
for (let i = 0; i < m; i++) {
  const gx = Math.floor((pts[i * 3] - x0) / CELL), gz = Math.floor((pts[i * 3 + 2] - z0) / CELL);
  if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
  cells[gz * W + gx].push(pts[i * 3 + 1]);
}
const ground = new Float32Array(W * H).fill(NaN), cnt = new Int32Array(W * H);
for (let c = 0; c < W * H; c++) { const a = cells[c]; cnt[c] = a.length; if (a.length < +(process.env.NMIN || 15)) continue; a.sort((p, r) => p - r); ground[c] = a[Math.floor(a.length * 0.1)]; }
const g = [...ground].filter((v) => !isNaN(v)).sort((a, b) => a - b);
console.log(file.split('/').pop(), 'grid', W, 'x', H, 'cell', CELL, 'm; ground p5/p50/p95:', q(g, 0.05).toFixed(2), q(g, 0.5).toFixed(2), q(g, 0.95).toFixed(2), 'filled', g.length, '/', W * H);
console.log('x', x0.toFixed(1), '..', x1.toFixed(1), ' z', z0.toFixed(1), '..', z1.toFixed(1));
// ASCII: высота относительно медианы, шаг 0.5 м
const med = q(g, 0.5);
const ch = (v) => (isNaN(v) ? ' ' : '0123456789ABCDEFGHIJ'[Math.max(0, Math.min(19, Math.round((v - med) / 0.5) + 6))]);
const step = Math.max(1, Math.ceil(W / 90));
for (let z = 0; z < H; z += step) { let row = ''; for (let x = 0; x < W; x += step) row += ch(ground[z * W + x]); console.log(row); }
console.log('legend: 6 = median ground, each char = 0.5 m (0 = -3 m … J = +6.5 m)');
