// Анализ клипов: скорость шага по движению стопы (чтобы ноги не «скользили») и фазы прыжка.
import { NodeIO } from '@gltf-transform/core';
import { mat4, vec3, quat } from 'gl-matrix';
const doc = await new NodeIO().read('assets/models/barsbek.glb');
const r = doc.getRoot();
const nodes = r.listNodes();
function sample(ch, t) {
  const s = ch.getSampler(), T = s.getInput().getArray(), O = s.getOutput().getArray(), n = ch.getTargetPath() === 'rotation' ? 4 : 3;
  let i = 0; while (i < T.length - 2 && T[i + 1] < t) i++;
  const a = Math.min(1, Math.max(0, (t - T[i]) / ((T[i + 1] ?? T[i]) - T[i] || 1)));
  const out = []; for (let k = 0; k < n; k++) out.push(O[i * n + k] * (1 - a) + (O[(i + 1) * n + k] ?? O[i * n + k]) * a);
  if (n === 4) { const q = quat.fromValues(...out); quat.normalize(q, q); return [...q]; }
  return out;
}
function worldPos(name, anim, t) {
  const trs = new Map(nodes.map((n) => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  for (const ch of anim.listChannels()) { const e = trs.get(ch.getTargetNode()); const v = sample(ch, t); if (ch.getTargetPath() === 'translation') e.t = v; else if (ch.getTargetPath() === 'rotation') e.r = v; else e.s = v; }
  let n = nodes.find((x) => x.getName() === name); const chain = [];
  while (n) { chain.unshift(n); n = n.getParentNode(); }
  const m = mat4.create();
  for (const c of chain) { const e = trs.get(c); const l = mat4.fromRotationTranslationScale(mat4.create(), e.r, e.t, e.s); mat4.multiply(m, m, l); }
  return vec3.transformMat4(vec3.create(), [0, 0, 0], m);
}
for (const a of r.listAnimations()) {
  const T = a.listChannels()[0].getSampler().getInput().getArray(); const dur = T[T.length - 1];
  let prev = null, best = 0, ys = [];
  const N = 120;
  const zs = [];
  for (let i = 0; i <= N; i++) {
    const t = dur * i / N; const p = worldPos('LeftToeBase', a, t); zs.push([t, p[1], p[2]]);
  }
  // Скорость стопы назад, пока она на земле (y близко к минимуму).
  const minY = Math.min(...zs.map((z) => z[1]));
  const v = [];
  for (let i = 1; i < zs.length; i++) if (zs[i][1] < minY + 0.03 && zs[i - 1][1] < minY + 0.03) v.push(-(zs[i][2] - zs[i - 1][2]) / (zs[i][0] - zs[i - 1][0]));
  v.sort((x, y) => x - y);
  const hips = []; for (let i = 0; i <= 20; i++) hips.push(worldPos('Hips', a, dur * i / 20)[1].toFixed(2));
  console.log(a.getName(), 'dur', dur.toFixed(2), 'stance foot speed (median m/s)', v.length ? v[v.length >> 1].toFixed(2) : '-', 'n', v.length, '| hipsY', hips.join(' '));
}
