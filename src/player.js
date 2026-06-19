// player.js — position, view vectors, movement with wall collision, mouse-look
// (yaw + a faux pitch), and the head-bob that drives footstep timing.

import { PLAYER, RENDER } from './config.js';
import { clamp } from './mathutils.js';

export class Player {
  constructor(world) {
    this.world = world;
    const spawn = world.findSpawn();
    this.x = spawn.x;
    this.y = spawn.y;

    // View basis. dir is the facing unit vector; plane is the camera plane
    // (perpendicular to dir, length = FOV).
    this.dirX = 1; this.dirY = 0;
    this.planeX = 0; this.planeY = RENDER.fov;

    this.pitch = 0;        // horizon shift in pixels (faux vertical look)
    this.bobPhase = 0;
    this.bobOffset = 0;    // current head-bob vertical offset (pixels)
    this.bobRoll = 0;      // subtle horizontal sway
    this.moving = false;
    this.justStepped = false;
    this._stepArmed = true;

    this.flashlight = true;
  }

  get angle() { return Math.atan2(this.dirY, this.dirX); }

  toggleFlashlight() { this.flashlight = !this.flashlight; }

  _rotate(a) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const dx = this.dirX, dy = this.dirY;
    this.dirX = dx * cs - dy * sn;
    this.dirY = dx * sn + dy * cs;
    const px = this.planeX, py = this.planeY;
    this.planeX = px * cs - py * sn;
    this.planeY = px * sn + py * cs;
  }

  // Axis-separated circle-vs-grid collision so we slide along walls instead of
  // sticking on corners.
  _blockedByProp(x, y, blockers) {
    const r = PLAYER.radius;
    for (const b of blockers) {
      if (!b.collideR) continue;
      const dx = x - b.x, dy = y - b.y;
      const rr = r + b.collideR;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  _moveX(nx, blockers) {
    const r = PLAYER.radius;
    const cellX = Math.floor(nx + (nx > this.x ? r : -r));
    const y1 = Math.floor(this.y - r), y2 = Math.floor(this.y + r);
    if (!this.world.isWall(cellX, y1) && !this.world.isWall(cellX, y2) &&
        !this._blockedByProp(nx, this.y, blockers)) this.x = nx;
  }
  _moveY(ny, blockers) {
    const r = PLAYER.radius;
    const cellY = Math.floor(ny + (ny > this.y ? r : -r));
    const x1 = Math.floor(this.x - r), x2 = Math.floor(this.x + r);
    if (!this.world.isWall(x1, cellY) && !this.world.isWall(x2, cellY) &&
        !this._blockedByProp(this.x, ny, blockers)) this.y = ny;
  }

  update(dt, input, blockers = []) {
    this.justStepped = false;

    // --- Mouse look ---------------------------------------------------------
    const { dx, dy } = input.consumeMouse();
    if (dx) this._rotate(dx * PLAYER.mouseSensitivity);
    if (dy) {
      this.pitch = clamp(this.pitch - dy * PLAYER.mouseSensitivity * 600,
                         -PLAYER.maxPitch, PLAYER.maxPitch);
    }

    // --- Movement -----------------------------------------------------------
    let fwd = 0, strafe = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) fwd += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) fwd -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) strafe += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) strafe -= 1;

    // Normalise diagonal speed.
    const mag = Math.hypot(fwd, strafe);
    this.moving = mag > 0;
    if (this.moving) {
      fwd /= mag; strafe /= mag;
      const speed = PLAYER.walkSpeed * dt;
      // Right vector = normalised plane.
      const plen = Math.hypot(this.planeX, this.planeY) || 1;
      const rx = this.planeX / plen, ry = this.planeY / plen;
      const mvx = (this.dirX * fwd + rx * strafe) * speed;
      const mvy = (this.dirY * fwd + ry * strafe) * speed;
      this._moveX(this.x + mvx, blockers);
      this._moveY(this.y + mvy, blockers);
    }

    // --- Head bob + footstep cadence ---------------------------------------
    if (this.moving) {
      this.bobPhase += PLAYER.bobFrequency * dt;
      this.bobOffset = Math.sin(this.bobPhase) * PLAYER.bobAmount;
      this.bobRoll = Math.cos(this.bobPhase * 0.5) * 1.2;
      // Fire a footstep at the bottom of each bob (when sin crosses downward).
      const s = Math.sin(this.bobPhase);
      if (s < -0.9 && this._stepArmed) { this.justStepped = true; this._stepArmed = false; }
      if (s > 0) this._stepArmed = true;
    } else {
      // Ease the bob back to neutral when standing still.
      this.bobOffset *= 0.85;
      this.bobRoll *= 0.85;
      this._stepArmed = true;
    }
  }

  // The vertical horizon used by the renderer = pitch + breathing/bob.
  viewPitch() { return this.pitch + this.bobOffset; }
}
