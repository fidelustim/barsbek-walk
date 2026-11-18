// Оффлайн-проверка buildSplatTerrainCollision на реальных .spz: время сборки, точка появления, рельеф.
// node tools/test_terrain.mjs <file.spz> [up]
// Модули src/ копируются во временную папку: в браузере они грузятся с ?v=NN (сброс кэша), node такой путь не понимает.
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const [file, upArg] = process.argv.slice(2);
const up = upArg || '-y';

function readSpz(p) {
  const d = zlib.gunzipSync(fs.readFileSync(p));
  const n = d.readUInt32LE(8), fb = d.readUInt8(13);
  let o = 16;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); if (v & 0x800000) v -= 1 << 24; P[i] = v / (1 << fb); o += 3; }
  const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = d[o + i] / 255; o += n;
  o += n * 3;
  const S = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) S[i] = d[o + i] / 16 - 1e2; o += n * 3;
  return { n, P, A, S };
}
const raw = readSpz(file);
// Как sampleSplats в игре: прозрачные сплаты (alpha<0.25) отбрасываем — в .spz таких много,
// и они стоят в «пустых» координатах ±131071, из-за чего границы сцены уезжают.
const keep = [];
for (let i = 0; i < raw.n; i++) if (raw.A[i] >= 0.25) keep.push(i);
const n = keep.length;
const P = new Float32Array(n * 3), A = new Float32Array(n), S = new Float32Array(n * 3);
keep.forEach((i, j) => {
  for (let k = 0; k < 3; k++) { P[j * 3 + k] = raw.P[i * 3 + k]; S[j * 3 + k] = raw.S[i * 3 + k]; }
  A[j] = raw.A[i];
});
console.log('прозрачных отброшено', raw.n - n, 'из', raw.n);
const N = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  const s = [S[i * 3], S[i * 3 + 1], S[i * 3 + 2]];
  const k = s[0] <= s[1] && s[0] <= s[2] ? 0 : (s[1] <= s[2] ? 1 : 2);
  N[i * 3 + k] = 1;
}
const sample = { P, N, A, S, total: n };

const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();
globalThis.__RAPIER__ = RAPIER;

// three.js: в terrain.js нужен только Quaternion/Vector3/Box3 → берём из node_modules
const dir = path.resolve('.tmp-terrain-test');
fs.mkdirSync(dir, { recursive: true });
const strip = (f) => fs.readFileSync(f, 'utf8').replace(/\?v=\d+/g, '');
fs.writeFileSync(path.join(dir, 'three.js'), "export * from 'three';\n");
fs.writeFileSync(path.join(dir, 'rapier.js'), "export default globalThis.__RAPIER__;\n");
fs.writeFileSync(path.join(dir, 'physics.js'), strip('src/physics.js').replace("from 'rapier'", "from './rapier.js'"));
fs.writeFileSync(path.join(dir, 'terrain.js'), strip('src/terrain.js'));
const { buildSplatTerrainCollision } = await import(path.join(dir, 'terrain.js'));
const { Physics } = await import(path.join(dir, 'physics.js'));

const physics = new Physics();
let colliders = 0;
const oc = physics.world.createCollider.bind(physics.world);
physics.world.createCollider = (...a) => { colliders++; return oc(...a); };
// трисекция trimesh-коллайдеров отдельно
const useQuat = up === '-y' ? { x: 1, y: 0, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 };

const t0 = Date.now();
const res = buildSplatTerrainCollision(physics, sample, useQuat, JSON.parse(process.env.TERRAIN_OPTS || '{}'));
console.log(`${path.basename(file)} (up=${up}): сплатов ${n.toLocaleString('ru')} · коллайдеров ${colliders} · сборка ${Date.now() - t0} мс`);
console.log('  spawn', res.spawn.x.toFixed(2), res.spawn.y.toFixed(2), res.spawn.z.toFixed(2),
  '· препятствий', res.boxes, '· земля', res.bounds.min.y.toFixed(2), '..', res.bounds.max.y.toFixed(2),
  '· сетка', res.terrain.gw, 'x', res.terrain.gh, '@', res.terrain.cell.toFixed(2), 'м');

const world = physics.world;
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(res.spawn.x, res.spawn.y + 3, res.spawn.z));
world.createCollider(RAPIER.ColliderDesc.capsule(0.62, 0.28), body);
for (let i = 0; i < 180; i++) world.step();
let t = body.translation();
console.log('  упал на y =', t.y.toFixed(2), '· ожидаем ≈', (res.spawn.y + 0.9).toFixed(2));
const startY = t.y;
for (let i = 0; i < 300; i++) { // 5 с вперёд
  body.setLinvel({ x: 1.6, y: body.linvel().y, z: 0 }, true);
  if (i % 5 === 0) t = body.translation();
  world.step();
}
t = body.translation();
console.log('  прошёл вперёд 5 с: x =', t.x.toFixed(2), 'y =', t.y.toFixed(2), '· старт y', startY.toFixed(2),
  '·', Math.abs(t.y - startY) < 6 ? 'идёт по земле' : 'ПРОВАЛ/ВЗЛЁТ');
const g = res.terrain;
const gi = (x, z) => g.ground[Math.min(g.gh - 1, Math.max(0, Math.round((z - g.minZ) / g.cell))) * g.gw + Math.min(g.gw - 1, Math.max(0, Math.round((x - g.minX) / g.cell)))];
const gy = gi(res.spawn.x, res.spawn.z);
console.log('  земля под спавном', gy.toFixed(2), '· уклон', (Math.abs(gi(res.spawn.x + 1, res.spawn.z) - gy) * 100).toFixed(0), 'см/м');
