// Проверка, как настоящий игрок (кинематическая капсула) стоит и ходит по неровной земле скана.
// node tools/test_walk_terrain.mjs <file.spz> [up]
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const [file, upArg] = process.argv.slice(2);
const up = upArg || '-y';
const d = zlib.gunzipSync(fs.readFileSync(file));
const n0 = d.readUInt32LE(8), fb = d.readUInt8(13);
let o = 16;
const keep = [];
const rawP = new Float32Array(n0 * 3), rawA = new Float32Array(n0), rawS = new Float32Array(n0 * 3);
for (let i = 0; i < n0 * 3; i++) { let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); if (v & 0x800000) v -= 1 << 24; rawP[i] = v / (1 << fb); o += 3; }
for (let i = 0; i < n0; i++) rawA[i] = d[o + i] / 255; o += n0;
o += n0 * 3;
for (let i = 0; i < n0 * 3; i++) rawS[i] = d[o + i] / 16 - 10; o += n0 * 3;
for (let i = 0; i < n0; i++) if (rawA[i] >= 0.25) keep.push(i);
const n = keep.length;
const P = new Float32Array(n * 3), A = new Float32Array(n), N = new Float32Array(n * 3);
keep.forEach((i, j) => {
  for (let k = 0; k < 3; k++) { P[j * 3 + k] = rawP[i * 3 + k]; }
  A[j] = rawA[i];
  const s = [rawS[i * 3], rawS[i * 3 + 1], rawS[i * 3 + 2]];
  const k = s[0] <= s[1] && s[0] <= s[2] ? 0 : (s[1] <= s[2] ? 1 : 2);
  N[j * 3 + k] = 1;
});

const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();
globalThis.__RAPIER__ = RAPIER;
const dir = path.resolve('.tmp-terrain-test');
fs.mkdirSync(dir, { recursive: true });
const strip = (f) => fs.readFileSync(f, 'utf8').replace(/\?v=\d+/g, '');
fs.writeFileSync(path.join(dir, 'rapier.js'), "export default globalThis.__RAPIER__;\n");
fs.writeFileSync(path.join(dir, 'three.js'), "export * from 'three';\n");
fs.writeFileSync(path.join(dir, 'physics.js'), strip('src/physics.js').replace("from 'rapier'", "from './rapier.js'"));
fs.writeFileSync(path.join(dir, 'terrain.js'), strip('src/terrain.js'));
const { buildSplatTerrainCollision } = await import(path.join(dir, 'terrain.js'));
const { Physics, Player } = await import(path.join(dir, 'physics.js'));

const physics = new Physics();
const quat = up === '-y' ? { x: 1, y: 0, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 };
const res = buildSplatTerrainCollision(physics, { P, N, A, S: null, total: n }, quat, JSON.parse(process.env.TERRAIN_OPTS || '{}'));
const player = new Player(physics, 0.28, 1.8);
player.teleport(res.spawn.x, res.spawn.y + 0.5, res.spawn.z);
const dt = 1 / 60;
for (let i = 0; i < 180; i++) { player.step(dt, 0, 0, false); physics.world.step(); }
let feet = player.feet;
console.log(`${path.basename(file)}: спавн y=${res.spawn.y.toFixed(2)} → после падения ступни y=${feet.y.toFixed(2)} (разница ${(feet.y - res.spawn.y).toFixed(3)} м), grounded=${player.grounded}`);
// Идём в 8 направлениях по 4 с: где пройти нельзя, там стена/препятствие; где провал — там земля дырявая.
const dirs = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
const dists = [];
for (const [dx, dz] of dirs) {
  const sx = res.spawn.x, sz = res.spawn.z, sy = res.spawn.y;
  player.teleport(sx, sy, sz);
  for (let i = 0; i < 30; i++) { player.step(dt, 0, 0, false); physics.world.step(); }
  let minY = 9, maxY = -9;
  for (let i = 0; i < 240; i++) {
    player.step(dt, 1.6 * dx, 1.6 * dz, false); physics.world.step();
    const f = player.feet;
    if (i > 30) { minY = Math.min(minY, f.y - sy); maxY = Math.max(maxY, f.y - sy); }
  }
  const f = player.feet;
  dists.push(`${((dx || dz) >= 0 ? '+' : '')}${Math.hypot(f.x - sx, f.z - sz).toFixed(1)}м(${minY.toFixed(1)}..${maxY.toFixed(1)})`);
}
console.log('  путь по 8 направлениям (дальность, перепад высоты):', dists.join(' '));
feet = player.feet;
// Тест прыжка: с точки появления — разбег, прыжок, приземление
player.teleport(res.spawn.x, res.spawn.y, res.spawn.z);
for (let i = 0; i < 30; i++) { player.step(dt, 1.6, 0, false); physics.world.step(); }
feet = player.feet;
let peak = -99;
player.step(dt, 1.6, 0, true); physics.world.step();
for (let i = 0; i < 90; i++) { player.step(dt, 1.6, 0, false); physics.world.step(); peak = Math.max(peak, player.feet.y); }
console.log(`  прыжок: пик ступней ${peak.toFixed(2)} (${(peak - feet.y).toFixed(2)} м), приземлился grounded=${player.grounded}`);
