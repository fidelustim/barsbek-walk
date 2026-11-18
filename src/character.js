// Персонаж: временная модель (робот, CC0) с анимациями. Позже меняется на Барсбека — тот же интерфейс.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CHARACTER_HEIGHT = 1.8; // метры, рост героя

export class Character {
  constructor() {
    this.root = new THREE.Group();   // позиция = точка между ступнями
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.facing = 0;                 // угол поворота модели (рад)
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, onProgress);
    const model = gltf.scene;
    // Нормализуем рост и ставим ступни на y=0.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    const s = CHARACTER_HEIGHT / h;
    model.scale.setScalar(s);
    box.setFromObject(model);
    model.position.y -= box.min.y;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    this.root.add(model);
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    // Имена клипов у робота: Idle, Walking, Running, Jump, Wave …
    this.map = {
      idle: this._find(['Idle', 'idle']),
      walk: this._find(['Walking', 'Walk', 'walk']),
      run: this._find(['Running', 'Run', 'run']),
      jump: this._find(['Jump', 'jump']),
    };
    if (this.map.jump) { this.map.jump.setLoop(THREE.LoopOnce); this.map.jump.clampWhenFinished = true; }
    this.play('idle', 0);
  }

  _find(names) { for (const n of names) if (this.actions[n]) return this.actions[n]; return null; }

  play(name, fade = 0.2) {
    const a = this.map[name];
    if (!a || a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  // speed — горизонтальная скорость м/с, grounded — стоит ли на земле, moveDir — направление движения (рад) или null
  update(dt, speed, grounded, moveYaw) {
    if (moveYaw !== null) {
      let d = moveYaw - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    this.root.rotation.y = this.facing;
    if (!grounded) this.play('jump', 0.15);
    else if (speed > 3.2) this.play('run');
    else if (speed > 0.25) this.play('walk');
    else this.play('idle');
    if (this.current === this.map.walk) this.current.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.6);
    if (this.current === this.map.run) this.current.timeScale = THREE.MathUtils.clamp(speed / 5, 0.7, 1.4);
    this.mixer?.update(dt);
  }

  setVisible(v) { this.root.visible = v; }
}
