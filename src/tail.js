// Хвост снежного барса: цепочка точек с «пружинной» физикой (Verlet) + труба, которая
// перестраивается каждый кадр. Крепится к кости таза, качается при ходьбе, отлетает при беге и прыжке.
import * as THREE from 'three';

const N = 14;          // точек в цепочке
const RADIAL = 14;     // граней по окружности
const LENGTH = 0.95;   // длина хвоста, м

// Радиус по длине (0 — у основания, 1 — кончик): пушистый, толще в середине.
function radiusAt(t) {
  const base = 0.055 + 0.03 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
  const tip = t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.55 : 1;
  return base * tip;
}

// Текстура меха: дымчато-белая основа, кольцевые розетки угольного цвета, чёрный кончик.
function makeFurTexture() {
  const W = 256, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#d9d7d2'); grad.addColorStop(0.5, '#e4e2dd'); grad.addColorStop(1, '#cfccc6');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // шерстинки
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * W, y = Math.random() * H, l = 6 + Math.random() * 10;
    const v = 190 + Math.random() * 60 | 0;
    g.strokeStyle = `rgba(${v},${v},${v - 6},0.35)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + l); g.stroke();
  }
  // кольцевые розетки (u — по окружности, v — вдоль хвоста), к кончику — сплошные кольца
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 60; y < H * 0.84; y += 48 + rnd() * 18) {
    const n = 3 + (rnd() * 2 | 0);
    for (let k = 0; k < n; k++) {
      const x = (k / n) * W + rnd() * 30, r = 16 + rnd() * 10;
      g.strokeStyle = 'rgba(52,50,48,0.9)'; g.lineWidth = 6 + rnd() * 3;
      g.beginPath(); g.ellipse(x, y + rnd() * 12, r, r * 0.8, rnd(), 0.3, Math.PI * 2 - 0.4); g.stroke();
      g.fillStyle = 'rgba(160,150,138,0.35)';
      g.beginPath(); g.ellipse(x, y, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    }
  }
  for (let y = H * 0.84; y < H * 0.92; y += 34) { g.fillStyle = 'rgba(40,38,36,0.95)'; g.fillRect(0, y, W, 14); }
  g.fillStyle = '#232120'; g.fillRect(0, H * 0.92, W, H * 0.08);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export class Tail {
  constructor() {
    this.p = Array.from({ length: N }, () => new THREE.Vector3());
    this.prev = Array.from({ length: N }, () => new THREE.Vector3());
    this.seg = LENGTH / (N - 1);
    this.inited = false;

    const geo = new THREE.BufferGeometry();
    const verts = (N) * (RADIAL + 1);
    this.pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j <= RADIAL; j++) {
      const v = i * (RADIAL + 1) + j;
      uv[v * 2] = j / RADIAL; uv[v * 2 + 1] = 1 - i / (N - 1);
      if (i < N - 1 && j < RADIAL) {
        const a = v, b = v + RADIAL + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // крышка на кончике
    const tipC = verts; const posAll = new Float32Array((verts + 1) * 3); this.pos = posAll;
    const uvAll = new Float32Array((verts + 1) * 2); uvAll.set(uv); uvAll[tipC * 2] = 0.5; uvAll[tipC * 2 + 1] = 0;
    for (let j = 0; j < RADIAL; j++) idx.push((N - 1) * (RADIAL + 1) + j + 1, (N - 1) * (RADIAL + 1) + j, tipC);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvAll, 2));
    geo.setIndex(idx);
    this.geo = geo;
    const mat = new THREE.MeshStandardMaterial({ map: makeFurTexture(), roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }

  // Форма покоя в системе персонажа (+z — вперёд): назад и вниз, кончик чуть загнут вверх.
  restPoint(t, out, lift) {
    const z = -0.08 - 0.8 * t;
    const droop = -0.62 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5);
    const curl = t > 0.7 ? (t - 0.7) * 0.55 : 0;
    const y = THREE.MathUtils.lerp(droop + curl, -0.08 * t + 0.1 * t * t, lift);
    return out.set(0, y, z);
  }

  // anchor — точка крепления (мир), rootQuat — поворот персонажа, groundY — уровень пола,
  // speed — скорость, airborne — в прыжке
  update(dt, anchor, rootQuat, groundY, speed, airborne, time) {
    dt = Math.min(dt, 1 / 30);
    const lift = THREE.MathUtils.clamp((speed - 1.5) / 4, 0, 0.75) + (airborne ? 0.15 : 0);
    this.lift = THREE.MathUtils.lerp(this.lift ?? 0, lift, 1 - Math.exp(-dt * 4));
    const rest = this._v;
    if (!this.inited) {
      for (let i = 0; i < N; i++) {
        this.restPoint(i / (N - 1), rest, 0).applyQuaternion(rootQuat).add(anchor);
        this.p[i].copy(rest); this.prev[i].copy(rest);
      }
      this.inited = true;
    }
    const damping = 0.9;
    const sway = Math.sin(time * 1.7) * 0.06 + Math.sin(time * 0.63) * 0.04; // ленивое покачивание
    this.p[0].copy(anchor); this.prev[0].copy(anchor);
    for (let i = 1; i < N; i++) {
      const t = i / (N - 1);
      const cur = this.p[i], pr = this.prev[i];
      const vx = (cur.x - pr.x) * damping, vy = (cur.y - pr.y) * damping, vz = (cur.z - pr.z) * damping;
      pr.copy(cur);
      cur.x += vx; cur.y += vy - 3.0 * dt * dt; cur.z += vz;
      // тянем к форме покоя: у основания жёстко, к кончику мягко
      this.restPoint(t, rest, this.lift);
      rest.x += sway * t * t;
      rest.applyQuaternion(rootQuat).add(anchor);
      const k = THREE.MathUtils.lerp(0.35, 0.06, t);
      cur.lerp(rest, k);
    }
    // длины сегментов (несколько итераций)
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < N; i++) {
        const a = this.p[i - 1], b = this.p[i];
        const d = this._q; void d;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const len = Math.hypot(dx, dy, dz) || 1e-6;
        const f = this.seg / len;
        if (i === 1) { b.set(a.x + dx * f, a.y + dy * f, a.z + dz * f); }
        else {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
          a.set(mx - dx * f / 2, my - dy * f / 2, mz - dz * f / 2);
          b.set(mx + dx * f / 2, my + dy * f / 2, mz + dz * f / 2);
        }
      }
      this.p[0].copy(anchor);
      // не проваливаться в пол и не заходить внутрь тела (вперёд от основания)
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQuat);
      for (let i = 1; i < N; i++) {
        const r = radiusAt(i / (N - 1));
        if (this.p[i].y < groundY + r) this.p[i].y = groundY + r;
        const along = this._v.subVectors(this.p[i], anchor).dot(fwd);
        if (along > -0.04) this.p[i].addScaledVector(fwd, -0.04 - along);
      }
    }
    this.rebuild();
  }

  rebuild() {
    const P = this.pos, up = new THREE.Vector3(0, 1, 0);
    const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
    let prevN = null;
    for (let i = 0; i < N; i++) {
      const a = this.p[Math.max(0, i - 1)], c = this.p[Math.min(N - 1, i + 1)];
      t.subVectors(c, a).normalize();
      if (!prevN) { n.crossVectors(t, up); if (n.lengthSq() < 1e-4) n.set(1, 0, 0); n.normalize(); }
      else { n.copy(prevN).addScaledVector(t, -prevN.dot(t)).normalize(); } // параллельный перенос
      prevN = n.clone();
      b.crossVectors(t, n).normalize();
      const r = radiusAt(i / (N - 1));
      for (let j = 0; j <= RADIAL; j++) {
        const ang = (j / RADIAL) * Math.PI * 2;
        const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
        const v = (i * (RADIAL + 1) + j) * 3;
        P[v] = this.p[i].x + n.x * ca + b.x * sa;
        P[v + 1] = this.p[i].y + n.y * ca + b.y * sa;
        P[v + 2] = this.p[i].z + n.z * ca + b.z * sa;
      }
    }
    const tip = N * (RADIAL + 1) * 3, last = this.p[N - 1], dir = t;
    P[tip] = last.x + dir.x * 0.03; P[tip + 1] = last.y + dir.y * 0.03; P[tip + 2] = last.z + dir.z * 0.03;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  reset() { this.inited = false; }
}
