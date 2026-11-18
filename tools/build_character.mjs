// Сборка barsbek.glb: модель со скелетом + клипы Idle/Walk/Run/Jump из отдельных файлов Meshy,
// хвост Meshy получает свою цепочку костей Tail0..Tail7 (его качает код в src/tail.js),
// текстура пережимается в JPEG 2048 (из 3.4 МБ), лишнее удаляется.
// Запуск: node tools/build_character.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { mat4, vec3 } from 'gl-matrix';
import { execFileSync } from 'child_process';
import fs from 'fs';

const D = 'source-art/meshy/';
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

// 1) Вершины хвоста: заливка по рёбрам от заведомо хвостовых вершин (далеко позади ног),
//    не дальше «коробки» за тазом — ноги (z ≥ 0.1) и спина не захватываются.
const inBox = (i) => P[i * 3 + 2] < 0.09 && Math.abs(P[i * 3]) < 0.13 && P[i * 3 + 1] < 0.8;
const posKey = (i) => `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`;
const weld = new Map(); const rep = new Int32Array(nV);
for (let i = 0; i < nV; i++) { const k = posKey(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
const adj = new Map();
const link = (a, b) => { a = rep[a]; b = rep[b]; if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { link(I[t + k], I[t + (k + 1) % 3]); link(I[t + (k + 1) % 3], I[t + k]); }
const tail = new Uint8Array(nV);
const queue = [];
for (let i = 0; i < nV; i++) if (rep[i] === i && P[i * 3 + 2] < -0.2 && P[i * 3 + 1] < 0.5) { tail[i] = 1; queue.push(i); }
while (queue.length) {
  const v = queue.pop();
  for (const u of adj.get(v) || []) if (!tail[u] && inBox(u)) { tail[u] = 1; queue.push(u); }
}
for (let i = 0; i < nV; i++) tail[i] = tail[rep[i]];
const tailIdx = []; for (let i = 0; i < nV; i++) if (tail[i]) tailIdx.push(i);
console.log('tail vertices', tailIdx.length);

// 2) Осевая линия хвоста: центры «слоёв» по расстоянию от корня, затем равномерно 9 точек (8 костей).
const rootPt = [0, 0.74, 0.03];
const dist = (i) => Math.hypot(P[i * 3] - rootPt[0], P[i * 3 + 1] - rootPt[1], P[i * 3 + 2] - rootPt[2]);
const dMax = Math.max(...tailIdx.map(dist));
const centers = [rootPt];
const NB = 14;
for (let b = 1; b < NB; b++) {
  const sel = tailIdx.filter((i) => { const d = dist(i); return d >= dMax * b / NB && d < dMax * (b + 1) / NB; });
  if (sel.length < 5) continue;
  centers.push([0, 1, 2].map((k) => sel.reduce((s, i) => s + P[i * 3 + k], 0) / sel.length));
}
// кончик — самая дальняя вершина
const far = tailIdx.reduce((a, i) => (dist(i) > dist(a) ? i : a), tailIdx[0]);
centers.push([P[far * 3], P[far * 3 + 1], P[far * 3 + 2]]);
const arc = [0]; for (let i = 1; i < centers.length; i++) arc.push(arc[i - 1] + Math.hypot(...[0, 1, 2].map((k) => centers[i][k] - centers[i - 1][k])));
const L = arc[arc.length - 1];
const NBONES = 8;
const chain = [];
for (let j = 0; j <= NBONES; j++) {
  const s = L * j / NBONES; let k = 1; while (k < arc.length - 1 && arc[k] < s) k++;
  const t = (s - arc[k - 1]) / (arc[k] - arc[k - 1] || 1);
  chain.push([0, 1, 2].map((c) => centers[k - 1][c] * (1 - t) + centers[k][c] * t));
}
chain[0][0] = 0; // корень строго по центру
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
  const tailW = THREEsmooth(0.03, 0.12, sNorm);
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
fs.mkdirSync('assets/models', { recursive: true });
await io.write('assets/models/barsbek.glb', base);
console.log('written', (fs.statSync('assets/models/barsbek.glb').size / 1024 / 1024).toFixed(2), 'MB');
