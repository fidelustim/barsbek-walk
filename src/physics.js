// Физика (Rapier) и построение столкновений: для процедурных сцен — по коробкам,
// для сканов (гауссовых сплатов) — автоматически по плотности сплатов.
import * as THREE from 'three';
import RAPIER from 'rapier';

let rapierReady = null;
export function initPhysics() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.debugBoxes = [];   // {size, pos} для визуализации
  }

  addBox(hx, hy, hz, x, y, z, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
    if (rotY) desc.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
    this.world.createCollider(desc);
    this.debugBoxes.push({ hx, hy, hz, x, y, z, rotY });
  }

  addTrimesh(geometry, matrix) {
    const g = geometry.clone().applyMatrix4(matrix);
    const pos = g.attributes.position.array;
    const idx = g.index ? g.index.array : [...Array(pos.length / 3).keys()];
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)));
  }

  debugMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true, transparent: true, opacity: 0.5 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (const b of this.debugBoxes) {
      if (b.hy > 5 && b.hx > 20) continue; // не рисуем огромный пол
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(b.hx * 2, b.hy * 2, b.hz * 2);
      m.position.set(b.x, b.y, b.z);
      m.rotation.y = b.rotY;
      group.add(m);
    }
    return group;
  }
}

// Игрок: кинематическая капсула + контроллер персонажа.
export class Player {
  constructor(physics, radius = 0.28, height = 1.8) {
    this.physics = physics;
    this.radius = radius;
    this.halfHeight = (height - 2 * radius) / 2;
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(this.halfHeight, radius), this.body);
    this.ctrl = w.createCharacterController(0.02);
    this.ctrl.enableAutostep(0.35, 0.12, false); // ступеньки и бордюры до 35 см — сам, выше — прыжок
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.ctrl.setSlideEnabled(true);
    this.vy = 0;
    this.grounded = false;
    this.sinceGrounded = 0;   // сек с момента, когда стоял на земле (coyote time)
    this.jumpBuffer = 0;      // нажатие прыжка помним 0.2 с
    this.noclip = false;
  }

  // Позиция ступней
  get feet() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - this.halfHeight - this.radius, t.z);
  }

  teleport(x, feetY, z) {
    this.body.setTranslation({ x, y: feetY + this.halfHeight + this.radius + 0.05, z }, true);
    this.body.setNextKinematicTranslation({ x, y: feetY + this.halfHeight + this.radius + 0.05, z });
    this.vy = 0;
  }

  step(dt, vx, vz, jumpPressed) {
    if (jumpPressed) this.jumpBuffer = 0.2;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    const canJump = this.sinceGrounded < 0.15 && this.vy <= 0;
    let jump = false;
    if (this.jumpBuffer > 0 && canJump) {
      jump = true; this.jumpBuffer = 0; this.sinceGrounded = 1;
      this.vy = 5.0;
      this.grounded = false;
    } else if (this.grounded) {
      this.vy = -1;
    } else {
      this.vy -= 9.81 * dt;
      if (this.vy < -20) this.vy = -20;
    }
    const desired = { x: vx * dt, y: this.vy * dt, z: vz * dt };
    const t = this.body.translation();
    if (this.noclip) {
      this.body.setNextKinematicTranslation({ x: t.x + desired.x, y: t.y + (jump ? 0.05 : 0), z: t.z + desired.z });
      this.grounded = true; this.vy = 0;
      return;
    }
    // Во время подъёма прилипание к земле выключаем, иначе прыжок «съедается».
    if (this.vy > 0) this.ctrl.disableSnapToGround(); else this.ctrl.enableSnapToGround(0.3);
    this.ctrl.computeColliderMovement(this.collider, desired);
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -1;
    if (!this.grounded && m.y > desired.y + 1e-4 && this.vy > 0) this.vy = 0; // упёрся головой
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  }
}

// ---------- Анализ скана ----------

export const UP_OPTIONS = ['-y', 'y', 'z', '-z', 'x', '-x'];

export function upQuaternion(up) {
  const q = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  switch (up) {
    case '-y': q.setFromAxisAngle(X, Math.PI); break;
    case 'z': q.setFromAxisAngle(X, -Math.PI / 2); break;
    case '-z': q.setFromAxisAngle(X, Math.PI / 2); break;
    case 'x': q.setFromAxisAngle(Z, Math.PI / 2); break;
    case '-x': q.setFromAxisAngle(Z, -Math.PI / 2); break;
    default: break; // 'y'
  }
  return q;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

// Читает центры, «нормали» и непрозрачность сплатов (с прореживанием).
export function sampleSplats(mesh, maxSamples = 400000) {
  const n = mesh.packedSplats?.numSplats ?? mesh.splats?.getNumSplats?.() ?? 0;
  const stride = Math.max(1, Math.floor(n / maxSamples));
  const P = [], N = [], A = [], S = [];
  const v = new THREE.Vector3();
  mesh.forEachSplat((i, c, s, q, o) => {
    if (i % stride) return;
    if (o < 0.25) return;
    P.push(c.x, c.y, c.z);
    // нормаль = ось наименьшего масштаба
    if (s.x <= s.y && s.x <= s.z) v.set(1, 0, 0);
    else if (s.y <= s.z) v.set(0, 1, 0);
    else v.set(0, 0, 1);
    v.applyQuaternion(q);
    N.push(v.x, v.y, v.z);
    A.push(o);
    S.push(Math.max(s.x, s.y, s.z));
  });
  return { P: new Float32Array(P), N: new Float32Array(N), A: new Float32Array(A), S: new Float32Array(S), total: n };
}

// Угадывает, какая ось скана смотрит вверх.
export function guessUp(sample) {
  const { P, N } = sample;
  const cnt = P.length / 3;
  const flat = [0, 0, 0];
  const vals = [[], [], []];
  for (let i = 0; i < cnt; i++) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(N[i * 3 + k]) > 0.9) flat[k]++;
      if (i % 4 === 0) vals[k].push(P[i * 3 + k]);
    }
  }
  let best = 1, bestScore = -1;
  for (let k = 0; k < 3; k++) {
    vals[k].sort((a, b) => a - b);
    const ext = percentile(vals[k], 0.98) - percentile(vals[k], 0.02);
    const score = (flat[k] / cnt) * (ext < 3.6 ? 1.0 : 0.6);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  // Знак: снизу (пол + мебель) обычно плотнее, чем у потолка.
  const s = vals[best];
  const lo = percentile(s, 0.02), hi = percentile(s, 0.98), span = hi - lo;
  let nLow = 0, nHigh = 0;
  for (const x of s) { if (x < lo + span * 0.3) nLow++; else if (x > hi - span * 0.3) nHigh++; }
  const axis = ['x', 'y', 'z'][best];
  return nLow >= nHigh ? axis : '-' + axis;
}

// Строит столкновения по скану: пол + препятствия на высоте тела.
// Возвращает {floorY, ceilY, bounds, spawn, grid}
export function buildSplatCollision(physics, sample, quat, opts = {}) {
  const { P, N, A } = sample;
  const cnt = P.length / 3;
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  const pts = new Float32Array(cnt * 3);
  const flatUp = new Uint8Array(cnt);
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < cnt; i++) {
    c.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyQuaternion(quat);
    n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyQuaternion(quat);
    pts[i * 3] = c.x; pts[i * 3 + 1] = c.y; pts[i * 3 + 2] = c.z;
    flatUp[i] = Math.abs(n.dot(up)) > 0.85 ? 1 : 0;
    if (i % 3 === 0) { xs.push(c.x); ys.push(c.y); zs.push(c.z); }
  }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const minX = percentile(xs, 0.005), maxX = percentile(xs, 0.995);
  const minZ = percentile(zs, 0.005), maxZ = percentile(zs, 0.995);
  const yLo = percentile(ys, 0.01), yHi = percentile(ys, 0.99);

  // Пол: самый сильный пик горизонтальных сплатов в нижней части.
  const BIN = 0.03;
  const nb = Math.max(1, Math.ceil((yHi - yLo) / BIN));
  const hist = new Float32Array(nb);
  for (let i = 0; i < cnt; i++) {
    if (!flatUp[i]) continue;
    const b = Math.floor((pts[i * 3 + 1] - yLo) / BIN);
    if (b >= 0 && b < nb) hist[b] += A[i];
  }
  let floorBin = 0, fv = -1;
  for (let b = 0; b < Math.ceil(nb * 0.45); b++) if (hist[b] > fv) { fv = hist[b]; floorBin = b; }
  let ceilBin = nb - 1, cv = -1;
  for (let b = Math.floor(nb * 0.6); b < nb; b++) if (hist[b] > cv) { cv = hist[b]; ceilBin = b; }
  const floorY = yLo + (floorBin + 0.5) * BIN + (opts.floorOffset || 0);
  const ceilY = Math.max(floorY + 2.0, yLo + (ceilBin + 0.5) * BIN);

  // Сетка препятствий в полосе высот тела.
  const CELL = opts.cell || 0.1;
  const gw = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const gh = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const occ = new Float32Array(gw * gh);
  const floorSeen = new Float32Array(gw * gh);
  const bandLo = floorY + (opts.bandLo ?? 0.3);
  const bandHi = Math.min(floorY + (opts.bandHi ?? 1.5), ceilY - 0.25);
  for (let i = 0; i < cnt; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    const gx = Math.floor((x - minX) / CELL), gz = Math.floor((z - minZ) / CELL);
    if (gx < 0 || gz < 0 || gx >= gw || gz >= gh) continue;
    if (y > bandLo && y < bandHi) occ[gz * gw + gx] += A[i];
    if (Math.abs(y - floorY) < 0.12) floorSeen[gz * gw + gx] += A[i];
  }
  // Порог по плотности: относительно ненулевых ячеек.
  const nz = [];
  for (const v of occ) if (v > 0) nz.push(v);
  nz.sort((a, b) => a - b);
  const thr = Math.max(opts.minDensity ?? 2.0, percentile(nz, 0.5) * (opts.thrScale ?? 0.6));
  let solid = new Uint8Array(gw * gh);
  for (let i = 0; i < occ.length; i++) solid[i] = occ[i] >= thr ? 1 : 0;
  // Убираем одиночные «шумовые» ячейки.
  const cleaned = new Uint8Array(gw * gh);
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (!solid[z * gw + x]) continue;
    let nbh = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < gw && zz < gh && solid[zz * gw + xx]) nbh++;
    }
    if (nbh >= 2) cleaned[z * gw + x] = 1;
  }
  solid = cleaned;

  // Пол — один большой бокс, вокруг скана — невидимые стены.
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2 + 0.5, hz = (maxZ - minZ) / 2 + 0.5;
  physics.addBox(hx, 0.5, hz, cx, floorY - 0.5, cz);
  const wallH = 3, wy = floorY + wallH / 2;
  physics.addBox(hx, wallH / 2, 0.1, cx, wy, minZ - 0.1);
  physics.addBox(hx, wallH / 2, 0.1, cx, wy, maxZ + 0.1);
  physics.addBox(0.1, wallH / 2, hz, minX - 0.1, wy, cz);
  physics.addBox(0.1, wallH / 2, hz, maxX + 0.1, wy, cz);

  // Препятствия: склеиваем подряд идущие ячейки в строки.
  const obstH = (bandHi - floorY) + 0.4;
  let boxes = 0;
  for (let z = 0; z < gh; z++) {
    let x = 0;
    while (x < gw) {
      if (!solid[z * gw + x]) { x++; continue; }
      const x0 = x;
      while (x < gw && solid[z * gw + x]) x++;
      const len = x - x0;
      physics.addBox(len * CELL / 2, obstH / 2, CELL / 2,
        minX + (x0 + len / 2) * CELL, floorY + obstH / 2 + 0.05, minZ + (z + 0.5) * CELL);
      boxes++;
    }
  }

  // Точка появления: свободная клетка с полом рядом с центром, с запасом вокруг.
  const free = (gx, gz, r) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const xx = gx + dx, zz = gz + dz;
      if (xx < 0 || zz < 0 || xx >= gw || zz >= gh || solid[zz * gw + xx]) return false;
    }
    return true;
  };
  let spawn = new THREE.Vector3(cx, floorY, cz);
  let bestD = Infinity;
  const r = Math.ceil(0.45 / CELL);
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    if (floorSeen[z * gw + x] <= 0 || !free(x, z, r)) continue;
    const px = minX + (x + 0.5) * CELL, pz = minZ + (z + 0.5) * CELL;
    const d = (px - cx) ** 2 + (pz - cz) ** 2;
    if (d < bestD) { bestD = d; spawn = new THREE.Vector3(px, floorY, pz); }
  }

  return {
    floorY, ceilY, boxes, spawn,
    bounds: new THREE.Box3(new THREE.Vector3(minX, floorY, minZ), new THREE.Vector3(maxX, ceilY, maxZ)),
  };
}
