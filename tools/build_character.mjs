// Сборка barsbek.glb: модель со скелетом + клипы Idle/Walk/Run/Jump из отдельных файлов Meshy,
// хвост Meshy получает свою цепочку костей Tail0..Tail7 (его качает код в src/tail.js),
// текстура пережимается в JPEG 2048 (из 3.4 МБ), лишнее удаляется.
// Запуск: node tools/build_character.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { mat4, vec3 } from 'gl-matrix';
import { execFileSync } from 'child_process';
import fs from 'fs';

const D = process.env.MESHY_DIR || 'source-art/meshy_v2/';
const io = new NodeIO();
const base = await io.read(D + 'rigged.glb');
const root = base.getRoot();
// Удаляем исходный клип rigged.glb (это T/A-поза), берём клипы из файлов анимаций.
for (const a of root.listAnimations()) a.dispose();

const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const clips = [['anim_0.glb', 'Idle'], ['walking.glb', 'Walk'], ['running.glb', 'Run'], ['anim_466.glb', 'Jump']];
for (const [file, name] of clips) {
  const src = await io.read(D + file);
  for (const sa of src.getRoot().listAnimations()) {
    const anim = base.createAnimation(name);
    const buf = root.listBuffers()[0];
    for (const ch of sa.listChannels()) {
      const tgt = nodeByName.get(ch.getTargetNode().getName());
      if (!tgt) continue;
      const ss = ch.getSampler();
      const inp = base.createAccessor().setArray(ss.getInput().getArray().slice()).setType('SCALAR').setBuffer(buf);
      let arr = ss.getOutput().getArray().slice();
      // В прыжке подъём делает физика игры, поэтому из клипа убираем подъём таза вверх
      // (оставляем присед перед прыжком и при приземлении).
      if (name === 'Jump' && tgt.getName() === 'Hips' && ch.getTargetPath() === 'translation') {
        const restY = arr[1];
        for (let i = 1; i < arr.length; i += 3) arr[i] = Math.min(arr[i], restY);
      }
      const out = base.createAccessor().setArray(arr).setType(ss.getOutput().getType()).setBuffer(buf);
      const s = base.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation(ss.getInterpolation());
      anim.addSampler(s);
      anim.addChannel(base.createAnimationChannel().setTargetNode(tgt).setTargetPath(ch.getTargetPath()).setSampler(s));
    }
    console.log('clip', name, sa.listChannels().length, 'channels');
  }
}

// ---------- Кости хвоста ----------
// Хвост Meshy: свисает из-под таза вниз и лежит на земле позади (в модели, координаты в метрах, вперёд = +z).
const skin = root.listSkins()[0];
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray();
const I = prim.getIndices().getArray();
const nV = P.length / 3;

// 1) Вершины хвоста: геодезическое расстояние по поверхности от кончика (самая задняя вершина).
//    Хвост — всё ближе TAIL_GEO; дальше начинается тело (радиус «слоя» резко растёт).
const posKey = (i) => `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`;
const weld = new Map(); const rep = new Int32Array(nV);
for (let i = 0; i < nV; i++) { const k = posKey(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
const adj = new Map();
const link = (a, b) => { a = rep[a]; b = rep[b]; if (a === b) return; if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { link(I[t + k], I[t + (k + 1) % 3]); link(I[t + (k + 1) % 3], I[t + k]); }
let tipV = 0; for (let i = 0; i < nV; i++) if (rep[i] === i && P[i * 3 + 2] < P[tipV * 3 + 2]) tipV = i;
const G = new Float64Array(nV).fill(Infinity); G[tipV] = 0;
{ const h = [[0, tipV]];
  const push = (e) => { h.push(e); let i = h.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (h[q][0] <= h[i][0]) break; [h[q], h[i]] = [h[i], h[q]]; i = q; } };
  const pop = () => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
  while (h.length) { const [d, v] = pop(); if (d > G[v] || d > 1.2) continue; for (const u of adj.get(v) || []) { const w = d + Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]); if (w < G[u]) { G[u] = w; push([w, u]); } } } }
// граница хвоста: первый слой, где радиус вырастает > 1.4× от медианы хвостовых слоёв
const SL = 0.03, layers = [];
for (let s0 = 0; s0 < 1.1; s0 += SL) {
  const sel = []; for (let i = 0; i < nV; i++) if (rep[i] === i && G[i] >= s0 && G[i] < s0 + SL) sel.push(i);
  if (!sel.length) { layers.push(null); continue; }
  const c = [0, 1, 2].map((k) => sel.reduce((a, i) => a + P[i * 3 + k], 0) / sel.length);
  let r = 0; for (const i of sel) r = Math.max(r, Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]));
  layers.push({ s0, c, r });
}
const rs = layers.filter(Boolean).slice(3, 15).map((l) => l.r).sort((a, b) => a - b);
const rMed = rs[rs.length >> 1];
let TAIL_GEO = 0.7;
for (let k = 6; k < layers.length; k++) if (layers[k] && layers[k].r > rMed * 1.4) { TAIL_GEO = layers[k].s0; break; }
const tail = new Uint8Array(nV);
for (let i = 0; i < nV; i++) tail[i] = G[rep[i]] < TAIL_GEO ? 1 : 0;
const tailIdx = []; for (let i = 0; i < nV; i++) if (tail[i]) tailIdx.push(i);
console.log('tail vertices', tailIdx.length, 'tail length (geodesic)', TAIL_GEO.toFixed(2), 'layer radius', rMed.toFixed(3));

// 2) Осевая линия: центры слоёв от корня к кончику, равномерно 9 точек (8 костей).
const centers = layers.filter((l) => l && l.s0 < TAIL_GEO).map((l) => l.c).reverse();
centers[centers.length - 1] = [P[tipV * 3], P[tipV * 3 + 1], P[tipV * 3 + 2]];
const arc = [0]; for (let i = 1; i < centers.length; i++) arc.push(arc[i - 1] + Math.hypot(...[0, 1, 2].map((k) => centers[i][k] - centers[i - 1][k])));
const L = arc[arc.length - 1];
const NBONES = 8;
const chain = [];
for (let j = 0; j <= NBONES; j++) {
  const s = L * j / NBONES; let k = 1; while (k < arc.length - 1 && arc[k] < s) k++;
  const t = (s - arc[k - 1]) / (arc[k] - arc[k - 1] || 1);
  chain.push([0, 1, 2].map((c) => centers[k - 1][c] * (1 - t) + centers[k][c] * t));
}
console.log('tail length', L.toFixed(2), 'chain', chain.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' | '));

// 3) Узлы костей: Tail0 — потомок Hips, остальные — цепочкой. Матрицы через bind-позу Hips.
const joints = skin.listJoints();
const hips = nodeByName.get('Hips');
const hipsJ = joints.indexOf(hips);
const ibmAcc = skin.getInverseBindMatrices();
const ibm = Array.from(ibmAcc.getArray());
const hipsIBM = mat4.clone(ibm.slice(hipsJ * 16, hipsJ * 16 + 16));
let parentWorld = mat4.invert(mat4.create(), hipsIBM);
let parent = hips;
const newJoints = [];
for (let j = 0; j <= NBONES; j++) {
  const local = vec3.transformMat4(vec3.create(), chain[j], mat4.invert(mat4.create(), parentWorld));
  const node = base.createNode(j < NBONES ? `Tail${j}` : 'TailEnd').setTranslation([...local]);
  parent.addChild(node);
  const world = mat4.multiply(mat4.create(), parentWorld, mat4.fromTranslation(mat4.create(), local));
  if (j < NBONES) {
    skin.addJoint(node);
    const inv = mat4.invert(mat4.create(), world);
    ibm.push(...inv);
    newJoints.push(joints.length + j);
  }
  parentWorld = world; parent = node;
}
ibmAcc.setArray(new Float32Array(ibm));

// 4) Веса: каждая вершина хвоста — к двум ближайшим костям по проекции на осевую линию.
//    У самого корня плавно смешиваем с исходными весами (таз), чтобы не было шва.
const JA = prim.getAttribute('JOINTS_0'), WA = prim.getAttribute('WEIGHTS_0');
const Jarr = JA.getArray(), Warr = WA.getArray();
if (joints.length + NBONES > 255) throw new Error('too many joints for Uint8');
let changed = 0;
for (const i of tailIdx) {
  const v = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  let best = { d: 1e9, seg: 0, t: 0 };
  for (let s = 0; s < NBONES; s++) {
    const a = chain[s], b = chain[s + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], av = [v[0] - a[0], v[1] - a[1], v[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = Math.max(0, Math.min(1, (av[0] * ab[0] + av[1] * ab[1] + av[2] * ab[2]) / l2));
    const d = Math.hypot(av[0] - ab[0] * t, av[1] - ab[1] * t, av[2] - ab[2] * t);
    if (d < best.d) best = { d, seg: s, t };
  }
  const sNorm = (best.seg + best.t) / NBONES; // 0 у корня, 1 на кончике
  const w = new Map();
  // кость сегмента и следующая (на последнем сегменте всё на последнюю кость)
  const j0 = newJoints[best.seg], j1 = newJoints[Math.min(NBONES - 1, best.seg + 1)];
  const tt = best.seg === NBONES - 1 ? 0 : best.t;
  const tailW = THREEsmooth(-0.02, 0.22, sNorm); // широкий плавный переход от таза к хвосту — без «перелома» у корня
  w.set(j0, (w.get(j0) || 0) + (1 - tt) * tailW);
  w.set(j1, (w.get(j1) || 0) + tt * tailW);
  for (let k = 0; k < 4; k++) if (Warr[i * 4 + k] > 0) w.set(Jarr[i * 4 + k], (w.get(Jarr[i * 4 + k]) || 0) + Warr[i * 4 + k] * (1 - tailW));
  const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  for (let k = 0; k < 4; k++) { Jarr[i * 4 + k] = top[k] ? top[k][0] : 0; Warr[i * 4 + k] = top[k] ? top[k][1] / sum : 0; }
  changed++;
}
JA.setArray(Jarr); WA.setArray(Warr);
console.log('reweighted', changed, 'vertices to', NBONES, 'tail bones');
function THREEsmooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// ---------- Сглаживание «шипов» меха на голове и шее ----------
// Meshy сделал мех на морде/шее острыми шипами с белыми кончиками — в игре это выглядит белым налётом.
// Сглаживание Таубина (без усадки) только для вершин выше плеч; плавно затухает к плечам.
// Соседство берётся по «сваренным» вершинам, чтобы не порвать швы UV.
if (process.env.SMOOTH_HEAD !== '0') {
  const Y0 = +(process.env.SMOOTH_Y0 || 1.38), Y1 = Y0 + 0.08;   // ниже Y0 — не трогаем, от Y1 — в полную силу
  const ITER = +(process.env.SMOOTH_ITER || 6);
  const Q = new Float32Array(P);                                  // рабочие позиции (по rep)
  const w = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { const y = P[i * 3 + 1]; w[i] = y <= Y0 ? 0 : y >= Y1 ? 1 : (y - Y0) / (Y1 - Y0); }
  const reps = []; for (let i = 0; i < nV; i++) if (rep[i] === i && w[i] > 0) reps.push(i);
  const tmp = new Float32Array(nV * 3);
  const step = (lam) => {
    for (const v of reps) {
      const ns = adj.get(v); if (!ns || !ns.size) continue;
      let cx = 0, cy = 0, cz = 0; for (const u of ns) { cx += Q[u * 3]; cy += Q[u * 3 + 1]; cz += Q[u * 3 + 2]; }
      const n = ns.size, k = lam * w[v];
      tmp[v * 3] = Q[v * 3] + k * (cx / n - Q[v * 3]);
      tmp[v * 3 + 1] = Q[v * 3 + 1] + k * (cy / n - Q[v * 3 + 1]);
      tmp[v * 3 + 2] = Q[v * 3 + 2] + k * (cz / n - Q[v * 3 + 2]);
    }
    for (const v of reps) { Q[v * 3] = tmp[v * 3]; Q[v * 3 + 1] = tmp[v * 3 + 1]; Q[v * 3 + 2] = tmp[v * 3 + 2]; }
  };
  for (let it = 0; it < ITER; it++) { step(0.6); step(-0.63); }
  let moved = 0, maxD = 0;
  for (let i = 0; i < nV; i++) {
    const r = rep[i]; if (!w[r]) continue;
    const d = Math.hypot(Q[r * 3] - P[i * 3], Q[r * 3 + 1] - P[i * 3 + 1], Q[r * 3 + 2] - P[i * 3 + 2]);
    maxD = Math.max(maxD, d); moved++;
    P[i * 3] = Q[r * 3]; P[i * 3 + 1] = Q[r * 3 + 1]; P[i * 3 + 2] = Q[r * 3 + 2];
  }
  prim.getAttribute('POSITION').setArray(P);
  // нормали пересчитает three.js не будет — пересчитываем здесь (сглаженные, по сваренным вершинам)
  const N = new Float32Array(nV * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = rep[I[t]], b = rep[I[t + 1]], c = rep[I[t + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { N[q * 3] += nx; N[q * 3 + 1] += ny; N[q * 3 + 2] += nz; }
  }
  const NA = prim.getAttribute('NORMAL');
  if (NA) {
    const old = NA.getArray();
    for (let i = 0; i < nV; i++) {
      if (!w[rep[i]]) continue; // ниже плеч нормали Meshy не трогаем
      const r = rep[i]; const l = Math.hypot(N[r * 3], N[r * 3 + 1], N[r * 3 + 2]) || 1;
      const k = w[r];
      const nx = N[r * 3] / l, ny = N[r * 3 + 1] / l, nz = N[r * 3 + 2] / l;
      let ox = old[i * 3] * (1 - k) + nx * k, oy = old[i * 3 + 1] * (1 - k) + ny * k, oz = old[i * 3 + 2] * (1 - k) + nz * k;
      const ol = Math.hypot(ox, oy, oz) || 1; old[i * 3] = ox / ol; old[i * 3 + 1] = oy / ol; old[i * 3 + 2] = oz / ol;
    }
    NA.setArray(old);
  }
  console.log('head smoothing: vertices', moved, 'max shift', (maxD * 100).toFixed(1), 'cm', 'from y', Y0);
}

// Текстура: JPEG 2048, quality 85 (через Pillow).
for (const tex of root.listTextures()) {
  fs.writeFileSync('/tmp/bw_tex_in', Buffer.from(tex.getImage()));
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open('/tmp/bw_tex_in').convert('RGB')
if max(im.size) > 2048: im = im.resize((2048, 2048), Image.LANCZOS)
im.save('/tmp/bw_tex_out.jpg', quality=85, optimize=True)
`]);
  tex.setImage(fs.readFileSync('/tmp/bw_tex_out.jpg')).setMimeType('image/jpeg');
}

await base.transform(dedup(), prune());
const OUT = process.env.OUT || 'assets/models/barsbek.glb';
fs.mkdirSync('assets/models', { recursive: true });
await io.write(OUT, base);
console.log('written', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'MB');
