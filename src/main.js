// Барсбек гуляет — прототип: выбор локации, ходьба от третьего лица, физика, сканы-сплаты.
import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import RAPIER from 'rapier';
import { Input } from './input.js?v=27';
import { Character, CHARACTER_HEIGHT } from './character.js?v=27';
import { initPhysics, Physics, Player, UP_OPTIONS } from './physics.js?v=27';
import { loadLocationList, buildYard, buildSplat } from './locations.js?v=27';

const BUILD = 'v27';
const $ = (id) => document.getElementById(id);
const canvas = $('view');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- Рендер ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(window.location.search).has('snap') });
const params = new URLSearchParams(window.location.search);
const prParam = parseFloat(params.get('pr'));
renderer.setPixelRatio(prParam > 0 ? prParam : Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = params.get('shadows') !== '0';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 300);
const spark = new SparkRenderer({ renderer });
scene.add(spark);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- Состояние ----------
const input = new Input(canvas);
const character = new Character();
let physics = null, player = null, location = null, debugGroup = null;
let current = null;            // { loc, src, overrides }
const DEFAULT_PITCH = -0.2;
let yaw = 0, pitch = DEFAULT_PITCH;    // поворот камеры
let camDist = 2.6;             // дистанция камеры (меняется колесом)
let firstPerson = false;
let autoCam = new URLSearchParams(window.location.search).get('autocam') !== '0'; // камера сама заходит за спину
let lastManualLook = -10;     // время последнего ручного поворота камеры
const visualOff = new THREE.Vector3(); // сглаживание шага на ступеньку
let testMove = null;          // автотест: имитация джойстика
const simFps = parseFloat(new URLSearchParams(window.location.search).get('simfps')) || 0;
let running = false;
const camPos = new THREE.Vector3();
const pivotSmooth = new THREE.Vector3();
let pivotInit = false, camDistCur = 2.6;
let camTrack = null;          // автотест: максимальный скачок камеры за кадр
const heroParam = new URLSearchParams(window.location.search).get('hero');
const HERO_URL = heroParam === 'robot' ? './assets/models/robot.glb' : './assets/models/barsbek.glb?v=27';
const charReady = character.load(HERO_URL, (e) => {
  if (e.lengthComputable && !$('loading').classList.contains('hidden')) $('loading-bar').style.width = (100 * e.loaded / e.total).toFixed(0) + '%';
}).then(() => character.attach(scene));

function toast(text, ms = 2500) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Меню ----------
async function buildMenu() {
  const list = await loadLocationList();
  const box = $('locations');
  box.innerHTML = '';
  for (const loc of list) {
    const b = document.createElement('button');
    b.className = 'loc';
    b.innerHTML = `<b>${loc.name}</b><span>${loc.description || ''}</span>`;
    b.onclick = () => startLocation(loc, loc.type === 'splat' ? { url: loc.url } : null);
    box.appendChild(b);
  }
  // Глубокая ссылка: ?loc=id
  const want = new URLSearchParams(location_search()).get('loc');
  const hit = list.find((l) => l.id === want);
  if (hit) startLocation(hit, hit.type === 'splat' ? { url: hit.url } : null);
}
function location_search() { return window.location.search; }

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  startLocation({ id: 'file', name: f.name, type: 'splat', up: 'auto' }, { fileBytes: bytes, fileName: f.name });
  e.target.value = '';
});

function showMenu() {
  running = false;
  input.enabled = false;
  document.exitPointerLock?.();
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
}
function hideMenu() {
  document.activeElement?.blur?.();
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  input.enabled = true;
  running = true;
  if (!isTouch) toast('Кликни по сцене, чтобы управлять мышью · Esc — меню');
}
$('btn-menu').onclick = showMenu;
$('btn-view').onclick = () => { firstPerson = !firstPerson; };
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && running && !isTouch) { /* Esc выпустил мышь */ }
});
input.on('Escape', () => { if (running) showMenu(); else if (location) hideMenu(); });
input.on('KeyV', () => { firstPerson = !firstPerson; });
input.on('KeyF', () => { autoCam = !autoCam; toast(autoCam ? 'Камера следует за героем: вкл' : 'Камера следует за героем: выкл'); });
input.on('KeyH', () => $('stats').classList.toggle('hidden'));
input.on('KeyC', () => { if (debugGroup) debugGroup.visible = !debugGroup.visible; });
input.on('KeyN', () => { if (player) { player.noclip = !player.noclip; toast(player.noclip ? 'Сквозь стены: вкл' : 'Сквозь стены: выкл'); } });
input.on('KeyU', () => {
  if (!current || current.loc.type !== 'splat') return;
  const i = UP_OPTIONS.indexOf(location.up);
  const next = UP_OPTIONS[(i + 1) % UP_OPTIONS.length];
  toast('Верх скана: ' + next);
  startLocation({ ...current.loc, up: next, spawn: undefined }, current.src);
});
const shiftFloor = (d) => {
  if (!current || current.loc.type !== 'splat') return;
  const co = { ...(current.loc.collisionOptions || {}) };
  co.floorOffset = (co.floorOffset || 0) + d;
  toast('Сдвиг пола: ' + co.floorOffset.toFixed(2) + ' м');
  startLocation({ ...current.loc, up: location.up, collisionOptions: co }, current.src);
};
input.on('BracketLeft', () => shiftFloor(-0.05));
input.on('BracketRight', () => shiftFloor(0.05));

// ---------- Загрузка локации ----------
async function startLocation(loc, src) {
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-bar').style.width = '0%';
  $('loading-text').textContent = 'Загружаю «' + loc.name + '»…';
  running = false;
  try {
    await initPhysics();
    await charReady;
    if (location) location.dispose();
    if (debugGroup) { scene.remove(debugGroup); debugGroup = null; }
    physics = new Physics();
    if (loc.type === 'procedural') {
      location = buildYard(scene, physics);
    } else {
      location = await buildSplat(scene, physics, src, loc,
        (e) => { if (e.lengthComputable) $('loading-bar').style.width = (100 * e.loaded / e.total).toFixed(0) + '%'; },
        (s) => { $('loading-text').textContent = s; });
      console.log('[location]', location.info);
    }
    current = { loc, src };
    debugGroup = physics.debugMesh();
    debugGroup.visible = false;
    scene.add(debugGroup);

    player = new Player(physics, 0.28, CHARACTER_HEIGHT);
    player.teleport(location.spawn.x, location.spawn.y, location.spawn.z);
    // В помещении камера ближе.
    camDist = location.indoor ? 1.9 : 3.2;
    camDistCur = camDist; pivotInit = false;
    firstPerson = false;
    character.root.position.copy(location.spawn);
    character.resetTail();
    camPos.copy(location.spawn).add(new THREE.Vector3(0, 1.6, camDist));
    $('loading').classList.add('hidden');
    hideMenu();
    if (location.info) toast(location.info, 6000);
  } catch (err) {
    console.error(err);
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    alert('Не удалось загрузить локацию: ' + err.message);
  }
}

// ---------- Камера ----------
const tmpV = new THREE.Vector3();
function updateCamera(dt) {
  const look = input.consumeLook();
  if (look.dx || look.dy) lastManualLook = clock.elapsedTime;
  const sens = isTouch ? 0.004 : 0.0024;
  yaw -= look.dx * sens;
  pitch -= look.dy * sens;
  pitch = THREE.MathUtils.clamp(pitch, -1.2, 0.9);
  camDist = THREE.MathUtils.clamp(camDist + input.consumeZoom() * 0.25, 0.9, 6);

  const feet = player.feet;
  const head = feet.clone().add(new THREE.Vector3(0, CHARACTER_HEIGHT * 0.88, 0));
  if (firstPerson) {
    character.setVisible(false);
    camPos.copy(head);
    camera.position.copy(head);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    return;
  }
  character.setVisible(true);
  // Точка, куда смотрит камера, следует за ВИДИМОЙ моделью (со сглаженным шагом на ступеньку),
  // а по высоте — ещё мягче: ступеньки и мелкие неровности не дёргают камеру.
  const vis = character.root.position;
  if (!pivotInit || pivotSmooth.distanceTo(vis) > 2) { pivotSmooth.copy(vis); pivotInit = true; }
  pivotSmooth.x = vis.x; pivotSmooth.z = vis.z;
  // На земле — мягко (ступеньки), в прыжке вверх — вяло (камера не скачет), вниз — быстро.
  const dy = vis.y - pivotSmooth.y;
  const vRate = player.grounded ? 6 : (dy > 0 ? 3 : 14);
  pivotSmooth.y += dy * (1 - Math.exp(-dt * vRate));
  const pivot = pivotSmooth.clone().add(new THREE.Vector3(0, CHARACTER_HEIGHT * 0.8, 0));
  const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  // Камера не должна проходить сквозь стены: луч от головы к камере.
  // Приближаемся к стене быстро, отдаляемся плавно — без «пульсации» на ступеньках.
  let want = camDist;
  const ray = new RAPIER.Ray(pivot, dir);
  const hit = physics.world.castRay(ray, camDist, true, undefined, undefined, player.collider);
  if (hit) want = Math.max(0.35, hit.timeOfImpact - 0.15);
  if (want < camDistCur) camDistCur = want;
  else camDistCur += (want - camDistCur) * (1 - Math.exp(-dt * 3));
  const dist = camDistCur;
  const target = pivot.clone().addScaledVector(dir, dist);
  camPos.lerp(target, 1 - Math.exp(-dt * 20));
  if (camPos.distanceTo(target) > 1.5) camPos.copy(target);
  if (camTrack) { if (camTrack.prev !== null) camTrack.maxDy = Math.max(camTrack.maxDy, Math.abs(camPos.y - camTrack.prev)); camTrack.prev = camPos.y; }
  camera.position.copy(camPos);
  camera.lookAt(pivot);
  // Слишком близко — делаем героя полупрозрачным не умеем без материалов, просто прячем.
  character.setVisible(dist > 0.55);
  void tmpV;
}

// ---------- Цикл ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (running && player) {
    input.update();
    if (testMove) { input.move.x = testMove.x; input.move.y = testMove.y; input.run = false; }
    const mv = input.move;
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    const speed = (input.run ? 5.2 : 1.9) * mag;
    let vx = 0, vz = 0, moveYaw = null;
    if (mag > 0.05) {
      // вперёд = от камеры
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const d = fwd.multiplyScalar(mv.y).add(right.multiplyScalar(mv.x)).normalize();
      vx = d.x * speed; vz = d.z * speed;
      moveYaw = Math.atan2(d.x, d.z);
    }
    // Автокамера: при движении вперёд/вбок камера плавно заходит за спину героя.
    // Ручной поворот мышью/пальцем на 1 с отключает её; при ходьбе назад не крутим.
    // Автокамера: через 1 с после ручного поворота камера сама возвращается за спину героя —
    // при движении быстрее, стоя на месте — медленно и спустя 2 с. При ходьбе назад не крутим.
    const idleLook = clock.elapsedTime - lastManualLook;
    if (autoCam && !firstPerson && idleLook > 1.0) {
      const moving = moveYaw !== null;
      if ((moving && mv.y > -0.2) || (!moving && idleLook > 2.0)) {
        const targetYaw = character.facing + Math.PI;
        const diff = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
        const rate = moving ? (input.run ? 2.2 : 1.6) * Math.max(0.5, mag) : 1.2;
        yaw += diff * Math.min(1, dt * rate);
        pitch += (DEFAULT_PITCH - pitch) * Math.min(1, dt * rate * 0.6);
      }
    }
    const sub = simFps ? Math.max(1, Math.round(dt * simFps)) : 1;
    const jumpNow = input.consumeJump();
    for (let k = 0; k < sub; k++) {
      player.step(dt / sub, vx, vz, jumpNow && k === 0);
      physics.world.step();
    }
    const f = player.feet;
    // Сглаживаем визуальный подъём на ступеньку (физика поднимает мгновенно).
    if (player.stepped) { visualOff.x -= player.stepped.dx; visualOff.y -= player.stepped.h; visualOff.z -= player.stepped.dz; player.stepped = null; }
    visualOff.multiplyScalar(Math.exp(-dt * 12));
    if (visualOff.lengthSq() < 4e-6) visualOff.set(0, 0, 0);
    character.root.position.set(f.x + visualOff.x, f.y + visualOff.y, f.z + visualOff.z);
    character.update(dt, Math.hypot(vx, vz), player.grounded, moveYaw, f.y);
    // Упал за пределы — возвращаем на точку появления.
    if (f.y < location.floorY - 8) player.teleport(location.spawn.x, location.spawn.y, location.spawn.z);
    updateCamera(dt);
  } else if (location) {
    // В меню — камера медленно облетает героя.
    yaw += dt * 0.08;
    if (player) updateCamera(dt);
  } else {
    camera.position.set(0, 1.6, 4); camera.lookAt(0, 1, 0);
  }

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    if (!$('stats').classList.contains('hidden') && player) {
      const p = player.feet;
      $('stats').textContent = `FPS ${fps.toFixed(0)}\nпоз ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\nна земле ${player.grounded ? 'да' : 'нет'}\n${location?.info || ''}`;
    }
  }
  renderer.render(scene, camera);
});

buildMenu();
$('ver').textContent = 'версия ' + BUILD;

// Хук для автотестов и отладки из консоли.
window.__game = {
  state: () => player ? { tailM: character.tailBones ? character.tailBones.metrics() : null, tailTip: character.tailBones ? character.tailBones.p[character.tailBones.p.length - 1].toArray().map((v) => +v.toFixed(2)) : null, pitch: +pitch.toFixed(3), dbg: player.dbg, along: player.dbgAlong, g: player.dbgG, yaw: +yaw.toFixed(3), facing: +character.facing.toFixed(3), autoCam, feet: player.feet.toArray().map((v) => +v.toFixed(3)), grounded: player.grounded, fps: +fps.toFixed(1), info: location?.info || '', anim: Object.keys(character.map || {}).find((k) => character.map[k] === character.current) } : null,
  teleport: (x, y, z, camYaw) => { player.teleport(x, y, z); if (camYaw !== undefined) yaw = camYaw; },
  camTrack: (on) => { if (on) camTrack = { maxDy: 0, prev: null }; const r = camTrack; if (!on) camTrack = null; return r && +r.maxDy.toFixed(4); },
  snap: (w = 480, h = 640) => { const ow = innerWidth, oh = innerHeight; renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera); const url = renderer.domElement.toDataURL('image/jpeg', 0.85); renderer.setSize(ow, oh); camera.aspect = ow / oh; camera.updateProjectionMatrix(); return url; },
  setCam: (y, p, d) => { yaw = y; pitch = p; if (d) { camDist = d; camDistCur = d; } lastManualLook = clock.elapsedTime + 1000; },
  look: (dx, dy) => { input.look.dx += dx; input.look.dy += dy; },
  stick: (x, y) => { testMove = (x || y) ? { x, y } : null; },
  key: (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })),
};
