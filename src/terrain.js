import * as THREE from 'three';
import { percentile } from './physics.js?v=35';

// Столкновения по неровной земле скана (улица, двор, горы): сетка высот → trimesh + препятствия.
// Плоский пол из buildSplatCollision здесь не годится: у таких сканов заметный уклон и рельеф.
export function buildSplatTerrainCollision(physics, sample, quat, opts = {}) {
  const { P, N, A } = sample;
  const cnt = P.length / 3;
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  const pts = new Float32Array(cnt * 3);
  const xs = [], zs = [], allY = [];
  for (let i = 0; i < cnt; i++) {
    c.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyQuaternion(quat);
    n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyQuaternion(quat);
    pts[i * 3] = c.x; pts[i * 3 + 1] = c.y; pts[i * 3 + 2] = c.z;
    if (i % 3 === 0) { xs.push(c.x); zs.push(c.z); allY.push(c.y); }
  }
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b); allY.sort((a, b) => a - b);
  const minX = percentile(xs, 0.005), maxX = percentile(xs, 0.995);
  const minZ = percentile(zs, 0.005), maxZ = percentile(zs, 0.995);
  const extX = maxX - minX, extZ = maxZ - minZ;

  // Ячейка: не крупнее opts.cell, но так, чтобы сетка была не больше maxCells по каждой оси
  // (большой trimesh в wasm строится долго и ест память телефона).
  const maxCells = opts.maxCells || 120;
  const cell = Math.max(opts.cell || 0.25, extX / maxCells, extZ / maxCells);
  const gw = Math.max(2, Math.ceil(extX / cell) + 1), gh = Math.max(2, Math.ceil(extZ / cell) + 1);

  // Высоты земли: нижний перцентиль y в ячейке (шумовой «мусор» под землёй и листва сверху не мешают).
  const buckets = new Array(gw * gh);
  const occ = new Float32Array(gw * gh);
  for (let i = 0; i < cnt; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    const gx = Math.round((x - minX) / cell), gz = Math.round((z - minZ) / cell);
    if (gx < 0 || gz < 0 || gx >= gw || gz >= gh) continue;
    if (A[i] < 0.25) continue;
    const k = gz * gw + gx;
    (buckets[k] || (buckets[k] = [])).push(y);
  }
  const gP = opts.groundP ?? 0.15;
  const minCount = opts.minCount || 4;
  const ground = new Float32Array(gw * gh).fill(NaN);
  for (let k = 0; k < ground.length; k++) {
    const b = buckets[k];
    if (!b || b.length < minCount) continue;
    b.sort((a, r) => a - r);
    ground[k] = b[Math.floor(gP * (b.length - 1))];
  }
  // Дырки (места, где скан разрежен) заполняем высотой соседей, иначе в земле будут провалы.
  const known0 = Uint8Array.from(ground, (v) => (isNaN(v) ? 0 : 1));
  for (let pass = 0; pass < 40; pass++) {
    let filled = 0;
    for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
      const k = z * gw + x;
      if (!isNaN(ground[k])) continue;
      let sum = 0, cntN = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= gw || zz >= gh) continue;
        const v = ground[zz * gw + xx];
        if (!isNaN(v)) { sum += v; cntN++; }
      }
      if (cntN >= 3) { ground[k] = sum / cntN; filled++; }
    }
    if (!filled) break;
  }
  // Что осталось пустым — за пределами нормального скана: тянем от ближайшей известной высоты, чтобы не было дыр.
  let fallback = percentile(allY, 0.1);
  for (let pass = 0; pass < 80; pass++) {
    let filled = 0;
    for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
      const k = z * gw + x;
      if (!isNaN(ground[k])) continue;
      let sum = 0, cntN = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= gw || zz >= gh) continue;
        const v = ground[zz * gw + xx];
        if (!isNaN(v)) { sum += v; cntN++; }
      }
      if (cntN) { ground[k] = sum / cntN; filled++; }
    }
    if (!filled) break;
  }
  const fo = opts.floorOffset || 0;   // ручной сдвиг земли (клавиши [ и ]) — для подгонки к скану
  for (let k = 0; k < ground.length; k++) { if (isNaN(ground[k])) ground[k] = fallback; ground[k] += fo; }

  // Сетка земли → trimesh
  const verts = new Float32Array(gw * gh * 3);
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    const k = z * gw + x;
    verts[k * 3] = minX + x * cell; verts[k * 3 + 1] = ground[k]; verts[k * 3 + 2] = minZ + z * cell;
  }
  const idx = [];
  for (let z = 0; z < gh - 1; z++) for (let x = 0; x < gw - 1; x++) {
    const a = z * gw + x, b = a + 1, d = a + gw, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  physics.addTrimeshRaw(verts, new Uint32Array(idx));

  // Высота земли в произвольной точке — билинейно по сетке.
  const terrainAt = (x, z) => {
    const fx = Math.min(gw - 1.001, Math.max(0, (x - minX) / cell));
    const fz = Math.min(gh - 1.001, Math.max(0, (z - minZ) / cell));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const a = ground[z0 * gw + x0], b = ground[z0 * gw + x0 + 1];
    const c2 = ground[(z0 + 1) * gw + x0], d2 = ground[(z0 + 1) * gw + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c2 * (1 - tx) + d2 * tx) * tz;
  };

  // Препятствия: всё, что стоит над локальной землёй в полосе высоты тела (деревья, стены, машины).
  const bandLo = opts.bandLo ?? 0.4, bandHi = opts.bandHi ?? 1.9;
  const obstCell = Math.max(cell, opts.obstCell || 0.3);
  const ow = Math.max(2, Math.ceil(extX / obstCell) + 1), oh = Math.max(2, Math.ceil(extZ / obstCell) + 1);
  const oocc = new Float32Array(ow * oh);
  const ohTop = new Float32Array(ow * oh).fill(-Infinity);
  for (let i = 0; i < cnt; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    const gx = Math.round((x - minX) / obstCell), gz = Math.round((z - minZ) / obstCell);
    if (gx < 0 || gz < 0 || gx >= ow || gz >= oh) continue;
    // Земля берётся билинейно по центру ячейки препятствий: на склоне соседние ячейки
    // стоят на разной высоте, и «полоса над землёй» от одной вершины давала ложные стены.
    const g = terrainAt(minX + (gx + 0.5) * obstCell, minZ + (gz + 0.5) * obstCell);
    if (y > g + bandLo && y < g + bandHi) {
      const k = gz * ow + gx;
      oocc[k] += A[i];
      if (y > ohTop[k]) ohTop[k] = y;   // докуда реально достаёт «стоящее» здесь
    }
  }
  const nz = []; for (const v of oocc) if (v > 0) nz.push(v);
  nz.sort((a, b) => a - b);
  const thr = Math.max(opts.minDensity ?? 2.0, percentile(nz, 0.5) * (opts.thrScale ?? 0.6));
  let solid = new Uint8Array(ow * oh);
  for (let i = 0; i < oocc.length; i++) solid[i] = oocc[i] >= thr ? 1 : 0;
  const cleaned = new Uint8Array(ow * oh);
  for (let z = 0; z < oh; z++) for (let x = 0; x < ow; x++) {
    if (!solid[z * ow + x]) continue;
    let nbh = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < ow && zz < oh && solid[zz * ow + xx]) nbh++;
    }
    if (nbh >= 2) cleaned[z * ow + x] = 1;
  }
  solid = cleaned;
  let boxes = 0;
  for (let z = 0; z < oh; z++) {
    let x = 0;
    while (x < ow) {
      if (!solid[z * ow + x]) { x++; continue; }
      const x0 = x;
      let top = -Infinity;
      while (x < ow && solid[z * ow + x]) { top = Math.max(top, ohTop[z * ow + x]); x++; }
      const len = x - x0;
      const bx = minX + (x0 + len / 2) * obstCell, bz = minZ + (z + 0.5) * obstCell;
      const g = terrainAt(bx, bz);
      // Высота препятствия — от земли до самой высокой точки, но не больше 3 м (это уже стены домов).
      const obstH = Math.min(opts.obstMax || 3.0, Math.max(0.6, top - g + 0.25));
      physics.addBox((len * obstCell) / 2, obstH / 2, obstCell / 2, bx, g + obstH / 2, bz);
      boxes++;
    }
  }

  // Стены по краю доступной области, чтобы не уйти в пустоту за пределами скана.
  let kx0 = Infinity, kx1 = -Infinity, kz0 = Infinity, kz1 = -Infinity;
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (!known0[z * gw + x]) continue;
    kx0 = Math.min(kx0, x); kx1 = Math.max(kx1, x); kz0 = Math.min(kz0, z); kz1 = Math.max(kz1, z);
  }
  if (!isFinite(kx0)) { kx0 = 0; kx1 = gw - 1; kz0 = 0; kz1 = gh - 1; }
  const wx0 = minX + kx0 * cell - 0.4, wx1 = minX + kx1 * cell + 0.4;
  const wz0 = minZ + kz0 * cell - 0.4, wz1 = minZ + kz1 * cell + 0.4;
  const wcx = (wx0 + wx1) / 2, wcz = (wz0 + wz1) / 2;
  const whx = (wx1 - wx0) / 2, whz = (wz1 - wz0) / 2;
  const wallH = 6;
  const gAt = (x, z) => {
    const gx = Math.min(gw - 1, Math.max(0, Math.round((x - minX) / cell)));
    const gz = Math.min(gh - 1, Math.max(0, Math.round((z - minZ) / cell)));
    return ground[gz * gw + gx];
  };
  const wyc = (gAt(wcx, wz0) + gAt(wcx, wz1) + gAt(wx0, wcz) + gAt(wx1, wcz)) / 4 + wallH / 2;
  physics.addBox(whx, wallH / 2, 0.1, wcx, wyc, wz0);
  physics.addBox(whx, wallH / 2, 0.1, wcx, wyc, wz1);
  physics.addBox(0.1, wallH / 2, whz, wx0, wyc, wcz);
  physics.addBox(0.1, wallH / 2, whz, wx1, wyc, wcz);

  // Точка появления: ровная площадка у центра, без препятствий вокруг.
  const slopeAt = (x, z) => {
    if (x < 1 || z < 1 || x >= gw - 1 || z >= gh - 1) return 9;
    const g = ground[z * gw + x];
    return Math.max(Math.abs(ground[z * gw + x + 1] - g), Math.abs(ground[(z + 1) * gw + x] - g),
      Math.abs(ground[z * gw + x - 1] - g), Math.abs(ground[(z - 1) * gw + x] - g)) / cell;
  };
  const ccx = (kx0 + kx1) / 2, ccz = (kz0 + kz1) / 2;
  let spawn = new THREE.Vector3(minX + ccx * cell, terrainAt(minX + ccx * cell, minZ + ccz * cell), minZ + ccz * cell);
  let bestScore = -Infinity;
  for (let z = Math.max(1, kz0); z < Math.min(gh - 1, kz1); z++) for (let x = Math.max(1, kx0); x < Math.min(gw - 1, kx1); x++) {
    if (!known0[z * gw + x]) continue;
    const px = minX + x * cell, pz = minZ + z * cell;
    const slope = slopeAt(x, z);
    if (slope > (opts.spawnSlope ?? 0.5)) continue;
    let blocked = false;
    const r = Math.ceil(0.6 / obstCell);
    const ox = Math.round((px - minX) / obstCell), oz = Math.round((pz - minZ) / obstCell);
    for (let dz = -r; dz <= r && !blocked; dz++) for (let dx = -r; dx <= r; dx++) {
      const xx = ox + dx, zz = oz + dz;
      if (xx < 0 || zz < 0 || xx >= ow || zz >= oh) continue;
      if (solid[zz * ow + xx]) { blocked = true; break; }
    }
    if (blocked) continue;
    const d = Math.hypot(px - (minX + ccx * cell), pz - (minZ + ccz * cell));
    const score = -d - slope * 4;
    if (score > bestScore) { bestScore = score; spawn = new THREE.Vector3(px, terrainAt(px, pz), pz); }
  }

  let floorMin = Infinity, floorMax = -Infinity;
  for (let k = 0; k < ground.length; k++) { if (ground[k] < floorMin) floorMin = ground[k]; if (ground[k] > floorMax) floorMax = ground[k]; }
  return {
    // floorY — порог «упал в пустоту» для респауна: ниже самой низкой точки рельефа.
    floorY: floorMin - 2, ceilY: floorMax + 4, boxes, spawn, terrain: { gw, gh, cell, minX, minZ, ground },
    bounds: new THREE.Box3(new THREE.Vector3(wx0, floorMin, wz0), new THREE.Vector3(wx1, floorMax, wz1)),
  };
}
