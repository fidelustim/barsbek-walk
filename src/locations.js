// Загрузка локаций. Тип "procedural" — сцена из кода, "splat" — скан (гауссов сплат).
import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { sampleSplats, guessUp, upQuaternion, buildSplatCollision } from './physics.js?v=22';

export async function loadLocationList() {
  const res = await fetch('./locations/locations.json', { cache: 'no-cache' });
  return res.json();
}

// ---------- Процедурный тестовый двор ----------
export function buildYard(scene, physics) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0xa9c8e0);
  scene.fog = new THREE.Fog(0xa9c8e0, 30, 90);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 1.2);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 60 });
  group.add(hemi, sun);

  // Асфальт и газон
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x5b5f63, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  physics.addBox(40, 0.5, 40, 0, -0.5, 0);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x5f8a3e, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.set(-8, 0.01, -6); lawn.receiveShadow = true; group.add(lawn);

  const box = (w, h, d, x, y, z, color, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
    if (collide) physics.addBox(w / 2, h / 2, d / 2, x, y, z);
    return m;
  };

  // «Хрущёвки» по краям двора
  const khrush = (x, z, rotY) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.9 }));
    b.position.y = 7; b.castShadow = true; b.receiveShadow = true; g.add(b);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x33475a, roughness: 0.3 });
    const winGeo = new THREE.BoxGeometry(1.2, 1.4, 0.1);
    for (let fl = 0; fl < 5; fl++) for (let i = 0; i < 12; i++) {
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(-13.2 + i * 2.4, 1.8 + fl * 2.7, 5.02); g.add(w);
    }
    g.position.set(x, 0, z); g.rotation.y = rotY; group.add(g);
    const hx = Math.abs(Math.cos(rotY)) > 0.5 ? 15 : 5, hz = Math.abs(Math.cos(rotY)) > 0.5 ? 5 : 15;
    physics.addBox(hx, 7, hz, x, 7, z);
  };
  khrush(0, -22, 0);
  khrush(-24, 2, Math.PI / 2);
  khrush(24, 2, -Math.PI / 2);

  // Деревья (карагачи)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7a35, roughness: 1 });
  const tree = (x, z, s = 1) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 3 * s), trunkMat);
    t.position.set(x, 1.5 * s, z); t.castShadow = true; group.add(t);
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 * s, 1), leafMat);
    l.position.set(x, 3.8 * s, z); l.castShadow = true; group.add(l);
    physics.addBox(0.22 * s, 1.5 * s, 0.22 * s, x, 1.5 * s, z);
  };
  [[-12, -8], [-5, -9], [-10, -3], [8, -12], [14, 8], [-14, 10], [5, 14]].forEach(([x, z], i) => tree(x, z, 0.9 + (i % 3) * 0.15));

  // Лавочки, бордюры, «машина», ступеньки и горка для проверки прыжков
  box(2.2, 0.45, 0.6, -3, 0.225, -4, 0x8a5a36);
  box(2.2, 0.45, 0.6, 3, 0.225, -4, 0x8a5a36);
  box(4.2, 1.4, 1.8, 10, 0.7, 4, 0xd6d6d6);   // «машина»
  box(0.3, 0.15, 10, -1, 0.075, -6, 0x9a9a9a); // бордюр
  for (let i = 0; i < 5; i++) box(3, 0.2 * (i + 1), 0.6, -6, 0.1 * (i + 1), 6 + i * 0.6, 0xb8a58a);
  box(3, 1.0, 2, -6, 0.5, 10, 0xb8a58a);       // площадка над ступеньками
  box(1, 1, 1, 4, 0.5, 8, 0xc75b39);           // ящик для прыжка
  // Горы Ала-Тоо на горизонте (без столкновений)
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x8aa0b8, flatShading: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const h = 18 + (i * 37 % 13);
    const m = new THREE.Mesh(new THREE.ConeGeometry(14, h, 5), mountMat);
    m.position.set(-60 + i * 15, h / 2 - 2, -75); group.add(m);
    const s = new THREE.Mesh(new THREE.ConeGeometry(14 * 0.32, h * 0.32, 5), snowMat);
    s.position.set(-60 + i * 15, h - 2 - h * 0.16 + 0.1, -75); group.add(s);
  }

  return {
    group,
    spawn: new THREE.Vector3(0, 0, 2),
    floorY: 0,
    dispose() { scene.remove(group); scene.fog = null; },
    shadows: true,
  };
}

// ---------- Скан: гауссов сплат ----------
// src: {url} или {fileBytes, fileName}; loc: запись из locations.json (up, collision, spawn …)
export async function buildSplat(scene, physics, src, loc, onProgress, onStatus) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x1a1f26);
  scene.fog = null;
  group.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));

  const opts = { onProgress };
  if (src.fileBytes) { opts.fileBytes = src.fileBytes; opts.fileName = src.fileName; }
  else opts.url = src.url;
  const mesh = new SplatMesh(opts);
  await mesh.initialized;
  onStatus?.('Строю стены и пол по скану…');
  await new Promise((r) => setTimeout(r, 30));

  const sample = sampleSplats(mesh);
  let up = loc.up && loc.up !== 'auto' ? loc.up : guessUp(sample);
  const quat = upQuaternion(up);
  mesh.quaternion.copy(quat);
  group.add(mesh);

  const col = buildSplatCollision(physics, sample, quat, loc.collisionOptions || {});
  const spawn = loc.spawn ? new THREE.Vector3(...loc.spawn) : col.spawn;

  return {
    group, mesh, spawn, up, sample,
    floorY: col.floorY, ceilY: col.ceilY, bounds: col.bounds,
    info: `сплатов: ${sample.total.toLocaleString('ru')} · верх: ${up} · пол y=${col.floorY.toFixed(2)} · потолок ${(col.ceilY - col.floorY).toFixed(2)} м · препятствий: ${col.boxes}`,
    dispose() { scene.remove(group); mesh.dispose(); },
    indoor: true,
  };
}
