// Барсбек гуляет — прототип: выбор локации, ходьба от третьего лица, физика, сканы-сплаты.
import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import RAPIER from 'rapier';
import { Input } from './input.js';
import { Character, CHARACTER_HEIGHT } from './character.js';
import { initPhysics, Physics, Player, UP_OPTIONS } from './physics.js';
import { loadLocationList, buildYard, buildSplat } from './locations.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- Рендер ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
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
let yaw = 0, pitch = -0.15;    // поворот камеры
let camDist = 2.6;             // дистанция камеры (меняется колесом)
let firstPerson = false;
let running = false;
const camPos = new THREE.Vector3();
const charReady = character.load('./assets/models/robot.glb').then(() => scene.add(character.root));

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
    firstPerson = false;
    character.root.position.copy(location.spawn);
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
  const pivot = feet.clone().add(new THREE.Vector3(0, CHARACTER_HEIGHT * 0.8, 0));
  const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  // Камера не должна проходить сквозь стены: луч от головы к камере.
  let dist = camDist;
  const ray = new RAPIER.Ray(pivot, dir);
  const hit = physics.world.castRay(ray, camDist, true, undefined, undefined, player.collider);
  if (hit) dist = Math.max(0.35, hit.timeOfImpact - 0.15);
  const target = pivot.clone().addScaledVector(dir, dist);
  camPos.lerp(target, 1 - Math.exp(-dt * 18));
  if (camPos.distanceTo(target) > 1.5) camPos.copy(target);
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
    player.step(dt, vx, vz, input.consumeJump());
    physics.world.step();
    const f = player.feet;
    character.root.position.copy(f);
    character.update(dt, Math.hypot(vx, vz), player.grounded, moveYaw);
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
