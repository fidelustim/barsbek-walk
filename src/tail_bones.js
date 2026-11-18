// Хвост Барсбека из модели Meshy, «оживлённый» кодом: у хвоста цепочка костей Tail0..Tail7
// (добавлены при сборке, tools/build_character.mjs). Каждый кадр точки цепочки считаются пружинной
// физикой (Verlet) и кости поворачиваются вдоль цепочки.
// Форма покоя = форма хвоста в модели, привязана к ТАЗУ (а не ко всему персонажу), чтобы корень
// не перегибался, когда таз качается при ходьбе. Подъём при беге/прыжке растёт от корня к кончику,
// а угол между соседними звеньями ограничен — хвост гнётся плавной дугой, без «перелома».
import * as THREE from 'three';

const _v = new THREE.Vector3();
const MAX_BEND = THREE.MathUtils.degToRad(28); // макс. угол между соседними звеньями

export class TailBones {
  constructor(model, root) {
    this.root = root;
    this.bones = [];
    for (let i = 0; ; i++) { const b = model.getObjectByName('Tail' + i); if (!b) break; this.bones.push(b); }
    const n = this.bones.length;
    this.hips = this.bones[0].parent;
    this.childDir = this.bones.map((b, i) => (i < n - 1 ? this.bones[i + 1].position.clone().normalize() : null));
    this.childDir[n - 1] = this.childDir[n - 2].clone();
    // Точки цепочки в bind-позе: в системе таза (для покоя) и высоты над ступнями.
    model.updateMatrixWorld(true); root.updateMatrixWorld(true);
    const world = this.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    world.push(world[n - 1].clone().add(world[n - 1].clone().sub(world[n - 2])));
    const hipsInv = new THREE.Matrix4().copy(this.hips.matrixWorld).invert();
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.restHips = world.map((p) => p.clone().applyMatrix4(hipsInv));
    this.restHeight = world.map((p) => p.clone().applyMatrix4(rootInv).y);
    this.seg = []; for (let i = 0; i < n; i++) this.seg.push(world[i + 1].distanceTo(world[i]));
    this.len = this.seg.reduce((a, b) => a + b, 0);
    this.p = world.map(() => new THREE.Vector3());
    this.prev = world.map(() => new THREE.Vector3());
    // Плавная форма покоя вместо формы из модели (там хвост висит вертикально и у земли резко
    // загибается на ~58° — в движении это выглядело «переломом»). Дуга в системе персонажа:
    // первое звено — как в модели, дальше угол плавно меняется до лёгкого подъёма кончика.
    const r0 = world[0].clone().applyMatrix4(rootInv), r1 = world[1].clone().applyMatrix4(rootInv);
    const a0 = Math.atan2(r1.y - r0.y, -(r1.z - r0.z)); // угол первого звена (вниз < 0), назад = -z
    const a1 = THREE.MathUtils.degToRad(15);
    this.restArc = [new THREE.Vector3()];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, th = a0 + (a1 - a0) * Math.pow(t, 1.4);
      const prevP = this.restArc[i];
      this.restArc.push(new THREE.Vector3(0, prevP.y + Math.sin(th) * this.seg[i], prevP.z - Math.cos(th) * this.seg[i]));
    }
    this.restHeight = this.restArc.map((p) => r0.y + p.y);
    this.lift = 0;
    this.inited = false;
  }

  reset() { this.inited = false; }

  // Цель для точки i в мире.
  target(i, out, sway, rq) {
    const t = i / (this.restHips.length - 1);
    const root0 = new THREE.Vector3().copy(this.restHips[0]).applyMatrix4(this.hips.matrixWorld);
    out.copy(this.restArc[i]).applyQuaternion(rq).add(root0); // покой — плавная дуга от корня
    if (this.lift > 0.001 && i > 0) {
      // поднятый хвост: от корня плавной дугой назад, кончик чуть вверх
      const s = this.len * t;
      const up = new THREE.Vector3(0, -0.28 * s + 0.55 * s * s / this.len, -s).applyQuaternion(rq).add(root0);
      out.lerp(up, this.lift * THREE.MathUtils.smoothstep(t, 0.0, 0.6)); // у корня слабее
    }
    out.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(rq), sway * t * t); // покачивание
    return out;
  }

  update(dt, groundY, speed, airborne, time) {
    dt = Math.min(dt, 1 / 30);
    const n = this.bones.length;
    const pts = this.p, prev = this.prev;
    for (const b of this.bones) b.quaternion.identity();
    this.hips.updateMatrixWorld(true);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const anchor = this.bones[0].getWorldPosition(new THREE.Vector3());

    const liftT = THREE.MathUtils.clamp((speed - 2.0) / 3.5, 0, 0.8) + (airborne ? 0.3 : 0);
    this.lift += (Math.min(1, liftT) - this.lift) * (1 - Math.exp(-dt * 5));
    const sway = Math.sin(time * 1.6) * 0.06 + Math.sin(time * 0.57) * 0.04 + (speed > 0.3 ? Math.sin(time * 6) * 0.025 : 0);

    const tgt = new THREE.Vector3();
    if (!this.inited) {
      for (let i = 0; i < pts.length; i++) { this.target(i, pts[i], 0, rq); prev[i].copy(pts[i]); }
      this.inited = true;
    }
    pts[0].copy(anchor); prev[0].copy(anchor);
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const c = pts[i], p = prev[i];
      const vx = (c.x - p.x) * 0.9, vy = (c.y - p.y) * 0.9, vz = (c.z - p.z) * 0.9;
      p.copy(c);
      c.x += vx; c.y += vy - 2.0 * dt * dt; c.z += vz;
      this.target(i, tgt, sway, rq);
      c.lerp(tgt, i === 1 ? 1 : THREE.MathUtils.lerp(0.55, 0.12, t)); // первое звено жёстко с тазом
    }
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rq);
    const d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), ax = new THREE.Vector3();
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < pts.length; i++) { // длины звеньев
        _v.subVectors(pts[i], pts[i - 1]); const l = _v.length() || 1e-6;
        pts[i].copy(pts[i - 1]).addScaledVector(_v, this.seg[i - 1] / l);
      }
      for (let i = 2; i < pts.length; i++) { // ограничение сгиба
        d0.subVectors(pts[i - 1], pts[i - 2]).normalize();
        d1.subVectors(pts[i], pts[i - 1]).normalize();
        if (d0.angleTo(d1) > MAX_BEND) {
          ax.crossVectors(d0, d1); if (ax.lengthSq() < 1e-8) continue; ax.normalize();
          d1.copy(d0).applyAxisAngle(ax, MAX_BEND);
          pts[i].copy(pts[i - 1]).addScaledVector(d1, this.seg[i - 1]);
        }
      }
      for (let i = 2; i < pts.length; i++) {
        const minY = groundY + Math.min(this.restHeight[i] * 0.9, 0.12); // не под пол (радиус хвоста)
        if (pts[i].y < minY) pts[i].y = minY;
        const along = _v.subVectors(pts[i], anchor).dot(fwd);          // не вперёд, в ноги
        if (along > -0.02) pts[i].addScaledVector(fwd, -0.02 - along);
      }
    }
    for (let i = 0; i < n; i++) { // кости вдоль цепочки
      const bone = this.bones[i];
      bone.updateMatrixWorld(true);
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      const cur = this.childDir[i].clone().applyQuaternion(wq);
      const want = new THREE.Vector3().subVectors(pts[i + 1], pts[i]).normalize();
      const newWorld = new THREE.Quaternion().setFromUnitVectors(cur, want).multiply(wq);
      const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parentWorld.invert().multiply(newWorld));
      bone.updateMatrixWorld(true);
    }
  }

  // Для автотеста: макс. угол сгиба между звеньями (градусы) и отклонение первого звена от покоя.
  metrics() {
    let maxBend = 0;
    for (let i = 2; i < this.p.length; i++) {
      const a = new THREE.Vector3().subVectors(this.p[i - 1], this.p[i - 2]).normalize();
      const b = new THREE.Vector3().subVectors(this.p[i], this.p[i - 1]).normalize();
      maxBend = Math.max(maxBend, THREE.MathUtils.radToDeg(a.angleTo(b)));
    }
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const restDir = this.restArc[1].clone().normalize().applyQuaternion(rq);
    const curDir = new THREE.Vector3().subVectors(this.p[1], this.p[0]).normalize();
    return { maxBend: +maxBend.toFixed(1), rootDev: +THREE.MathUtils.radToDeg(restDir.angleTo(curDir)).toFixed(1) };
  }
}
