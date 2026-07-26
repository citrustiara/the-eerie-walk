// player.js — position, view vectors, movement with wall collision, mouse-look
// (yaw + a faux pitch), and the head-bob that drives footstep timing.

import { PLAYER, RENDER, PIT } from './config.js';
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
    this.velX = 0; this.velY = 0;   // world units/sec, for whatever comes next

    // --- The floor ----------------------------------------------------------
    // There is no jump and there is no crouch. The only thing in this game that
    // ever moves your eye off eyeHeight is a hole in the floor, and it only ever
    // moves it one way. Holes used to be walled off with an invisible barrier,
    // which is a strange thing to put in a building that wants you dead; they
    // are now exactly what they look like.
    this.eyeZ = PLAYER.eyeHeight;
    this.falling = false;
    this.fallVel = 0;
    this.fallDX = 0; this.fallDY = 0;
    this.dead = false;
    this.onFall = null;    // fired the instant the floor stops being there
    this.onLand = null;    // ...and when the falling stops

    // Sprint. Locked until the director hands it over, which it does at the
    // moment the hunter arrives and not a second before — the ability and the
    // reason for it show up together.
    this.sprintUnlocked = false;
    this.stamina = 1;        // 0..1
    this.sprinting = false;
    this._winded = false;    // emptied the bar; must recover past sprintFloor

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

  // world.isWall, not world.blocked: a wall stops you and a hole does not. This
  // is the one place in the codebase that makes that distinction — everything
  // else that moves still uses world.blocked, because a monster that walks into
  // a hole and deletes itself is not a threat, it is a physics demonstration.
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

  // How black the frame should be. The torch does not survive the drop: it is
  // pointed at a wall going past too fast to light anything, and then it is not
  // pointed at anything. Fully dark long before the bottom, so what you get is
  // one second of falling in the dark and then a sound.
  fallDark() {
    if (!this.falling && !this.dead) return 0;
    return clamp((PIT.darkFrom - this.eyeZ) / (PIT.darkFrom - PIT.darkTo), 0, 1);
  }

  _startFall() {
    this.falling = true;
    // Not from rest. Starting at zero meant the first tenth of a second of a
    // fall looked exactly like standing still, and the floor giving way has to
    // register on the frame it happens on, not two frames later.
    this.fallVel = PIT.entryVel;
    this.sprinting = false;
    // You keep some of the speed you walked in with, so you go over the edge at
    // an angle instead of dropping down it like a lift.
    this.fallDX = this.velX * PIT.drift;
    this.fallDY = this.velY * PIT.drift;
    if (this.onFall) this.onFall();
  }

  _fall(dt, input) {
    // You can look wherever you like on the way down. It does not help.
    const { dx } = input.consumeMouse();
    if (dx) this._rotate(dx * PLAYER.mouseSensitivity);

    this.fallVel += PIT.gravity * dt;
    this.eyeZ -= this.fallVel * dt;

    // Whatever you were doing when the floor ran out, you carry on doing, until
    // the side of the shaft takes it off you.
    const nx = this.x + this.fallDX * dt, ny = this.y + this.fallDY * dt;
    if (!this.world.isWall(Math.floor(nx), Math.floor(this.y))) this.x = nx;
    else this.fallDX = 0;
    if (!this.world.isWall(Math.floor(this.x), Math.floor(ny))) this.y = ny;
    else this.fallDY = 0;

    // The view tips forward over the edge and keeps going. Fast enough to be
    // all the way down inside the first third of a drop that is now only six
    // tenths of a second long.
    this.pitch = Math.max(-PLAYER.maxPitch, this.pitch - PLAYER.maxPitch * 5.5 * dt);
    this.bobOffset *= 0.72;
    this.bobRoll *= 0.72;

    if (this.eyeZ <= -PIT.depth) {
      this.eyeZ = -PIT.depth;
      this.falling = false;
      this.dead = true;
      if (this.onLand) this.onLand();
    }
  }

  update(dt, input, blockers = []) {
    this.justStepped = false;
    if (this.dead) return;
    if (this.falling) { this._fall(dt, input); return; }

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

    // --- Sprint -------------------------------------------------------------
    // Forward only. Sprinting sideways or backwards away from something that is
    // faster than you should not be a thing you can do.
    const wantsSprint = this.sprintUnlocked && fwd > 0 &&
      (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    this.sprinting = wantsSprint && !this._winded && this.stamina > 0;
    if (this.sprinting) {
      this.stamina -= dt / PLAYER.sprintSeconds;
      if (this.stamina <= 0) { this.stamina = 0; this._winded = true; this.sprinting = false; }
    } else {
      this.stamina = Math.min(1, this.stamina + dt * PLAYER.sprintRegen);
      if (this._winded && this.stamina >= PLAYER.sprintFloor) this._winded = false;
    }

    // Normalise diagonal speed.
    const mag = Math.hypot(fwd, strafe);
    this.moving = mag > 0;
    if (this.moving) {
      fwd /= mag; strafe /= mag;
      const speed = this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      // Right vector = normalised plane.
      const plen = Math.hypot(this.planeX, this.planeY) || 1;
      const rx = this.planeX / plen, ry = this.planeY / plen;
      this.velX = (this.dirX * fwd + rx * strafe) * speed;
      this.velY = (this.dirY * fwd + ry * strafe) * speed;
      this._moveX(this.x + this.velX * dt, blockers);
      this._moveY(this.y + this.velY * dt, blockers);
    } else {
      this.velX = 0; this.velY = 0;
    }

    // Is there still a floor here? Asked after moving, on the cell under your
    // centre, so you get half a step out over the edge before it gives.
    if (this.world.isPit(Math.floor(this.x), Math.floor(this.y))) {
      this._startFall();
      return;
    }

    // --- Head bob + footstep cadence ---------------------------------------
    if (this.moving) {
      this.bobPhase += PLAYER.bobFrequency * (this.sprinting ? 1.45 : 1) * dt;
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
