// input.js — keyboard, mouse-look and pointer-lock management.
// Exposes a small polled state object plus accumulated mouse deltas that the
// player module drains each frame.

import { DEBUG } from './config.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.onLockChange = null; // callback(locked:boolean)
    this.onToggleFlashlight = null;
    this.onSelectGun = null;
    this.onDebugSpawn = null;
    this.onActivate = null;   // fired on the click that requests lock (gesture)

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    document.addEventListener('mousemove', (e) => this._onMove(e));
    document.addEventListener('pointerlockchange', () => this._onLockChange());

    // Click anywhere to (re)acquire pointer lock. We listen at the document
    // level on purpose: the start/pause overlay sits *above* the canvas, so a
    // canvas-only listener would never see the click. This is also the user
    // gesture we use to start the AudioContext.
    document.addEventListener('click', () => {
      if (this.locked) return;
      if (this.onActivate) this.onActivate();
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {}); // ignore rejects
    });
  }

  _onKey(e, down) {
    // Ignore browser shortcuts we don't care about, but capture game keys.
    const code = e.code;
    this.keys[code] = down;
    if (down && !e.repeat && code === 'KeyF' && this.onToggleFlashlight) {
      this.onToggleFlashlight();
    }
    if (down && !e.repeat && code === 'Digit1' && this.onSelectGun) {
      this.onSelectGun();
    }
    const debugAction = DEBUG.enabled && DEBUG.keys
      ? Object.keys(DEBUG.keys).find((key) => DEBUG.keys[key] === code)
      : null;
    if (down && !e.repeat && debugAction && this.onDebugSpawn) {
      this.onDebugSpawn(debugAction);
    }

    const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'ArrowUp', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'Space', 'Digit1'];
    if (DEBUG.enabled && DEBUG.keys) gameKeys.push(...Object.values(DEBUG.keys));
    if (gameKeys.includes(code)) {
      e.preventDefault();
    }
  }

  _onMove(e) {
    if (!this.locked) return;
    // movementX/Y are already raw deltas under pointer lock.
    this.mouseDX += e.movementX || 0;
    this.mouseDY += e.movementY || 0;
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.onLockChange) this.onLockChange(this.locked);
    if (!this.locked) {
      // Drop held keys so the player doesn't keep walking while paused.
      this.keys = Object.create(null);
    }
  }

  // Drain accumulated mouse movement (call once per frame).
  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  isDown(code) { return !!this.keys[code]; }
}
