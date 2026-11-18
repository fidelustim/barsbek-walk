// Анализ SPZ-скана: габариты, плотность по осям, оценка «верха» и пола.
// node tools/analyze_spz.mjs file.spz [...]
import fs from 'fs';
import zlib from 'zlib';

function readSpz(path) {
  const d = zlib.gunzipSync(fs.readFileSync(path));
  const magic = d.readUInt32LE(0), ver = d.readUInt32LE(4), n = d.readUInt32LE(8);
  const sh = d.readUInt8(12), fb = d.readUInt8(13);
  let o = 16;
  const P = new Float32Array(n * 3);
  if (ver >= 2) {
    for (let i = 0; i < n * 3; i++) {
      let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); if (v & 0x800000) v -= 1 << 24;
      P[i] = v / (1 << fb); o += 3;
    }
  } else { for (let i = 0; i < n * 3; i++) { P[i] = d.readUInt16LE(o); o += 2; } }
  const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = d[o + i] / 255; o += n;
  o += n * 3; // colors
  const S = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) S[i] = d[o + i] / 16 - 10; o += n * 3;
  return { n, P, A, S, ver, sh, fb, magic };
}
const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; };

for (const f of process.argv.slice(2)) {
  const { n, P, A, S, ver } = readSpz(f);
  console.log('==', f, 'splats', n, 'ver', ver);
  const ax = 'xyz';
  for (let k = 0; k < 3; k++) {
    const v = []; for (let i = 0; i < n; i += 7) if (A[i] > 0.3) v.push(P[i * 3 + k]);
    const lo = pct(v, 0.02), hi = pct(v, 0.98), lo5 = pct(v, 0.005), hi5 = pct(v, 0.995);
    // гистограмма по оси (30 бинов в 2–98%)
    const h = new Array(30).fill(0); for (const x of v) { const b = Math.floor((x - lo) / (hi - lo) * 30); if (b >= 0 && b < 30) h[b]++; }
    const m = Math.max(...h);
    console.log(` ${ax[k]}: 2%..98% ${lo.toFixed(2)}..${hi.toFixed(2)}  (0.5..99.5: ${lo5.toFixed(2)}..${hi5.toFixed(2)})  hist ${h.map((c) => ' .:-=+*#%@'[Math.min(9, Math.round(c / m * 9))]).join('')}`);
  }
  // «плоские» сплаты: ось наименьшего масштаба
  const flat = [0, 0, 0]; let cnt = 0;
  for (let i = 0; i < n; i += 5) { if (A[i] < 0.4) continue; const s = [S[i * 3], S[i * 3 + 1], S[i * 3 + 2]]; const mn = Math.min(...s); if (Math.max(...s) - mn > 1.5) { flat[s.indexOf(mn)]++; } cnt++; }
  console.log(' flat-axis share (unrotated scales, rough):', flat.map((c) => (c / cnt).toFixed(2)).join(' '));
}
