// Персонаж: Барсбек (Meshy 7.1, скелет meshyrig, клипы Idle/Walk/Run/Jump) + хвост кодом.
// Запасной вариант — робот (?hero=robot). Интерфейс одинаковый: load / attach / update / play.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Tail } from './tail.js?v=25';

export const CHARACTER_HEIGHT = 1.8; // метры, рост героя

// Скорость, при которой клип ходьбы/бега совпадает с движением ног (замерено по стопе в клипах).
const CLIP_SPEED = { walk: 1.37, run: 4.8 };

export class Character {
  constructor() {
    this.root = new THREE.Group();   // позиция = точка между ступнями
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.facing = 0;                 // угол поворота модели (рад)
    this.tail = null;
    this.time = 0;
    this.airTime = 0;
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, onProgress);
    const model = gltf.scene;
    // Нормализуем рост и ставим ступни на y=0.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    model.scale.setScalar(CHARACTER_HEIGHT / h);
    box.setFromObject(model);
    model.position.y -= box.min.y;
    const hips = model.getObjectByName('Hips');
    // Модель Meshy смещена вперёд по z — центрируем по тазу.
    if (hips) {
      model.updateMatrixWorld(true);
      const hp = new THREE.Vector3(); hips.getWorldPosition(hp);
      model.position.x -= hp.x; model.position.z -= hp.z;
    }
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.root.add(model);
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      // Убираем «уезжание» таза вперёд/вбок из клипов: двигает персонажа физика игры.
      for (const tr of clip.tracks) {
        if (hips && /Hips\.position$/.test(tr.name)) {
          const v = tr.values, x0 = v[0], z0 = v[2];
          for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        }
      }
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.map = {
      idle: this._find(['Idle', 'idle']),
      walk: this._find(['Walk', 'Walking', 'walk']),
      run: this._find(['Run', 'Running', 'run']),
      jump: this._find(['Jump', 'jump']),
    };
    if (this.map.jump) { this.map.jump.setLoop(THREE.LoopOnce); this.map.jump.clampWhenFinished = true; }
    this.hips = hips;
    this.isBarsbek = !!hips;
    this.clipSpeed = this.isBarsbek ? CLIP_SPEED : { walk: 1.6, run: 5 };
    if (this.isBarsbek && model.getObjectByName('Tail0')) this.tailBones = new TailBones(model, this.root);
    this.play('idle', 0);
  }

  attach(scene) {
    scene.add(this.root);
  }

  _find(names) { for (const n of names) if (this.actions[n]) return this.actions[n]; return null; }

  play(name, fade = 0.2) {
    const a = this.map[name];
    if (!a || a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    // У Барсбека клип прыжка начинается с долгого приседа: физика уже оторвала от земли, пропускаем.
    if (name === 'jump' && this.isBarsbek) a.time = 0.55;
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  // speed — горизонтальная скорость м/с, grounded — стоит ли на земле, moveYaw — направление движения (рад) или null
  update(dt, speed, grounded, moveYaw, groundY) {
    this.time += dt;
    if (moveYaw !== null) {
      let d = moveYaw - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    this.root.rotation.y = this.facing;
    this.airTime = grounded ? 0 : this.airTime + dt;
    if (this.airTime > 0.08) this.play('jump', 0.12);
    else if (speed > 3.2) this.play('run');
    else if (speed > 0.25) this.play('walk');
    else this.play('idle');
    if (this.current === this.map.walk) this.current.timeScale = THREE.MathUtils.clamp(speed / this.clipSpeed.walk, 0.5, 1.8);
    if (this.current === this.map.run) this.current.timeScale = THREE.MathUtils.clamp(speed / this.clipSpeed.run, 0.6, 1.4);
    this.mixer?.update(dt);

    if (this.tailBones) {
      this.root.updateMatrixWorld(true);
      this.tailBones.update(dt, groundY ?? this.root.position.y, speed, !grounded, this.time);
    }
  }

  setVisible(v) { this.root.visible = v; }
  resetTail() { this.tailBones?.reset(); }
}

