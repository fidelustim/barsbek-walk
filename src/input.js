// Ввод: клавиатура + мышь (pointer lock) и сенсорный экран (джойстик слева, обзор справа).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };       // x — вправо, y — вперёд, длина 0..1
    this.look = { dx: 0, dy: 0 };     // накопленный поворот камеры в пикселях
    this.run = false;
    this.jumpQueued = false;
    this.zoom = 0;
    this.enabled = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.handlers = {};
    this._initKeyboard();
    this._initMouse();
    this._initTouch();
  }

  on(key, fn) { this.handlers[key] = fn; }

  _initKeyboard() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      const h = this.handlers[e.code];
      if (h) h(e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  _initMouse() {
    this.canvas.addEventListener('click', () => {
      if (this.enabled && !this.isTouch && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
      }
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
    });
    this.canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); }, { passive: true });
  }

  _initTouch() {
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const R = 50;
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    let pinchDist = 0;
    const touches = new Map();

    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        touches.set(t.identifier, t);
        if (t.clientX < innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          base.style.display = 'block';
          base.style.left = (sx - 60) + 'px'; base.style.top = (sy - 60) + 'px';
          knob.style.transform = 'translate(0,0)';
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx *= R / len; dy *= R / len; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.move.x = dx / R; this.move.y = -dy / R;
          this.run = len > R * 0.95;
        } else if (t.identifier === lookId) {
          this.look.dx += (t.clientX - lx) * 1.6;
          this.look.dy += (t.clientY - ly) * 1.6;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        touches.delete(t.identifier);
        if (t.identifier === stickId) {
          stickId = null; this.move.x = 0; this.move.y = 0; this.run = false;
          base.style.display = 'none';
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);

    document.getElementById('btn-jump').addEventListener('touchstart', (e) => {
      this.jumpQueued = true; e.preventDefault(); e.stopPropagation();
    }, { passive: false });
    void pinchDist;
  }

  // Направление движения из клавиатуры (если нет сенсорного ввода).
  update() {
    if (!this.isTouch || (this.move.x === 0 && this.move.y === 0)) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (x || y || !this.isTouch) {
        const l = Math.hypot(x, y) || 1;
        this.move.x = x / l; this.move.y = y / l;
        this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      }
    }
  }

  consumeLook() { const l = { ...this.look }; this.look.dx = 0; this.look.dy = 0; return l; }
  consumeJump() { const j = this.jumpQueued; this.jumpQueued = false; return j; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
}
