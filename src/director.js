// director.js — the "AI" of the horror. It owns a slowly-rising dread value and
// schedules events on randomised timers with cooldowns, gated so the first
// minutes are calm and the place only turns on you as dread escalates.
//
// Design philosophy: dread over jumpscares. Nothing here can kill you. The
// scares are perceptual — a sound that stops when you turn, a light that
// settles, a figure that isn't there when you look properly.
//
// update() returns a set of environment modifiers the renderer consumes; it
// never touches pixels itself.

import { HORROR, LIGHT, FOG, GUN } from './config.js';
import { wrapAngle, clamp, lerp } from './mathutils.js';

export class Director {
  constructor(audio, player, world, rng) {
    this.audio = audio;
    this.player = player;
    this.world = world;
    this.rng = rng;

    this.dread = 0;
    this.elapsed = 0;
    this.inited = false;
    this.next = {};            // key -> absolute time of next attempt

    this.flicker = null;       // ceiling lights: { t, dur, level, blinkAt }
    this.phantom = null;       // { srcX, srcY, stepsLeft, nextStep, dist }
    this.figure = null;        // { x, y, scale, alpha, t, vanishing, seen, missed }
    this.redEyes = null;       // { x, y, scale, alpha, t, life }
    this.lightFail = null;     // flashlight stutter that erases the figure
    this.anomaly = null;       // { type, t, dur }
    this.gunSite = null;       // { x, y, yaw, seed, pickedUp }
    this.nextGunTryAt = GUN.appearAfter;
    this.hasGun = false;
    this.onGunPickup = null;   // optional callback(site), for future mechanics

    // Dread thresholds gating each event (slow escalation).
    this.gate = {
      flicker: 0.0, whisper: 0.04, phantomSteps: 0.08, redEyes: 0.045, silhouette: 0.055, anomaly: 0.55,
    };
  }

  _rand(a, b) { return a + this.rng() * (b - a); }

  _schedule(key, time) {
    const cfg = HORROR.events[key];
    if (this.hasGun && key === 'phantomSteps') {
      this.next[key] = time + this._rand(4.5, 10.5);
      return;
    }
    // As dread rises, the window compresses — events come faster.
    const squeeze = 1 - this.dread * 0.45;
    this.next[key] = time + this._rand(cfg.min, cfg.max) * squeeze + cfg.cooldown * 0.2;
  }

  // Simple stepped ray for placing the figure down a sightline.
  _castDistance(x, y, ang, maxDist) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let d = 0;
    while (d < maxDist) {
      d += 0.08;
      if (this.world.isWall(Math.floor(x + dx * d), Math.floor(y + dy * d))) return d;
    }
    return maxDist;
  }

  _openAt(x, y) {
    return !this.world.isWall(Math.floor(x), Math.floor(y));
  }

  _placeOutOfSight(minDist, maxDist) {
    const p = this.player;
    const offsets = [Math.PI, -Math.PI * 0.78, Math.PI * 0.78, -Math.PI * 0.58, Math.PI * 0.58];
    let best = null;
    for (const off of offsets) {
      for (let i = 0; i < 10 && !best; i++) {
        const ang = p.angle + off + this._rand(-0.28, 0.28);
        const dist = this._rand(minDist, maxDist);
        const x = p.x + Math.cos(ang) * dist;
        const y = p.y + Math.sin(ang) * dist;
        const rel = Math.abs(wrapAngle(Math.atan2(y - p.y, x - p.x) - p.angle));
        if (rel < 1.15 || !this._openAt(x, y) || !this._hasLineOfSight(x, y)) continue;
        best = { x, y };
      }
    }

    if (best) return best;
    for (let i = 0; i < 36; i++) {
      const ang = p.angle + Math.PI + this._rand(-Math.PI, Math.PI);
      const dist = this._rand(minDist, maxDist);
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist;
      const rel = Math.abs(wrapAngle(Math.atan2(y - p.y, x - p.x) - p.angle));
      if (rel >= 1.15 && this._openAt(x, y) && this._hasLineOfSight(x, y)) return { x, y };
    }
    return null;
  }

  _placeDistantEyes() {
    const p = this.player;
    for (let i = 0; i < 36; i++) {
      const ang = p.angle + this._rand(-0.62, 0.62);
      const d = this._castDistance(p.x, p.y, ang, 30);
      if (d < 18) continue;
      const place = clamp(d - this._rand(1.5, 3.2), 18.0, 26.0);
      const x = p.x + Math.cos(ang) * place;
      const y = p.y + Math.sin(ang) * place;
      if (this._openAt(x, y) && this._hasLineOfSight(x, y)) return { x, y };
    }
    return null;
  }

  _placeInSight(minDist, maxDist) {
    const p = this.player;
    const offsets = [0, -0.22, 0.22, -0.48, 0.48, -0.78, 0.78];
    for (const off of offsets) {
      for (let i = 0; i < 8; i++) {
        const ang = p.angle + off + this._rand(-0.08, 0.08);
        const dist = this._rand(minDist, maxDist);
        const x = p.x + Math.cos(ang) * dist;
        const y = p.y + Math.sin(ang) * dist;
        if (this._openAt(x, y) && this._hasLineOfSight(x, y)) return { x, y };
      }
    }
    return null;
  }

  _isFacingPoint(x, y, angle = HORROR.silhouetteMiss.seenAngle) {
    const p = this.player;
    const rel = Math.abs(wrapAngle(Math.atan2(y - p.y, x - p.x) - p.angle));
    return rel <= angle && this._hasLineOfSight(x, y);
  }

  _scheduleMissedSilhouette(time) {
    const cfg = HORROR.silhouetteMiss;
    const retryAt = time + this._rand(cfg.respawnMin, cfg.respawnMax);
    this.next.silhouette = Math.min(this.next.silhouette || Infinity, retryAt);
  }

  debugSpawn(kind) {
    switch (kind) {
      case 'redEyes': {
        const spot = this._placeDistantEyes() || this._placeInSight(7.5, 11.5);
        if (!spot) return false;
        this.redEyes = {
          x: spot.x, y: spot.y,
          scale: 0.26,
          alpha: 0, t: 0, life: 6.0,
        };
        this.audio.quietBeat({ target: 0.20, attack: 0.08, hold: 0.7, release: 1.0 });
        return true;
      }

      case 'silhouette': {
        const spot = this._placeInSight(5.0, 7.0) || this._placeOutOfSight(5.8, 8.0);
        if (!spot) return false;
        this.figure = {
          x: spot.x, y: spot.y, scale: 1.22 + this.dread * 0.25,
          alpha: 1, t: 0, vanishing: false, seen: true, missed: false,
        };
        this.lightFail = null;
        this.audio.quietBeat({ target: 0.16, attack: 0.08, hold: 0.8, release: 1.0 });
        return true;
      }

      case 'gun':
        this.hasGun = false;
        return this._trySpawnGun(true);
    }
    return false;
  }

  update(dt, time) {
    const p = this.player;
    this.now = time;

    if (!this.inited) {
      this.inited = true;
      // First attempts are deliberately distant so the opening is quiet.
      for (const key in HORROR.events) {
        const cfg = HORROR.events[key];
        this.next[key] = time + this._rand(cfg.min, cfg.max) + 8;
      }
    }

    this.elapsed += dt;
    this.dread = Math.min(HORROR.dreadMax, this.dread + HORROR.dreadPerSecond * dt);
    this.audio.update(this.dread);

    // --- try to launch new events ------------------------------------------
    for (const key in HORROR.events) {
      if (time >= this.next[key] && this.dread >= (this.gate[key] || 0)) {
        this._trigger(key, time);
        this._schedule(key, time);
      }
    }

    // --- advance active events ---------------------------------------------
    const fx = {
      ambient: LIGHT.ambient,
      panelEmissive: 0,
      beamIntensity: LIGHT.beamIntensity,
      fogDensity: FOG.density,
      fogColor: FOG.color,
      fovScale: 1,
      entities: [],
      meshes: [],
      dread: this.dread,
    };

    this._updateFlicker(dt, fx);
    this._updatePhantom(dt, time);
    this._updateRedEyes(dt, fx);
    this._updateFigure(dt, p, fx);
    this._updateLightFail(dt, fx);
    this._updateAnomaly(dt, fx);
    this._updateGun(fx, time);

    // Dread very subtly thickens the fog over a whole session.
    fx.fogDensity *= 1 + this.dread * 0.12;
    return fx;
  }

  _trigger(key, time) {
    switch (key) {
      case 'flicker':
        this.flicker = { t: 0, dur: this._rand(1.2, 2.2), level: 0, blinkAt: 0 };
        this.audio.flickerWhine(0.6 + this.dread * 0.5);
        break;

      case 'phantomSteps': {
        const p = this.player;
        // Place the source directly behind, with a little jitter.
        const bearing = p.angle + Math.PI + this._rand(-0.35, 0.35);
        const dist = this.hasGun ? this._rand(2.8, 4.6) : this._rand(4, 6);
        this.phantom = {
          srcX: p.x + Math.cos(bearing) * dist,
          srcY: p.y + Math.sin(bearing) * dist,
          stepsLeft: (this.hasGun ? 8 : 5) + Math.floor(this.rng() * (this.hasGun ? 7 : 5)),
          nextStep: time + (this.hasGun ? 0.22 : 0.4),
          dist,
        };
        break;
      }

      case 'silhouette': {
        if (this.figure || this.lightFail) break;
        const best = this._placeOutOfSight(5.8, 8.0);
        if (best) {
          this.figure = {
            x: best.x, y: best.y, scale: 1.28 + this.dread * 0.35,
            alpha: 1, t: 0, vanishing: false, seen: false, missed: false,
          };
          this.audio.quietBeat({ target: 0.16, attack: 0.10, hold: 1.25, release: 1.45 });
        }
        break;
      }

      case 'redEyes': {
        if (this.redEyes || this.figure) break;
        const spot = this._placeDistantEyes();
        if (spot) {
          this.redEyes = {
            x: spot.x, y: spot.y,
            scale: this._rand(0.18, 0.28),
            alpha: 0, t: 0, life: this._rand(3.0, 5.2),
          };
          this.audio.quietBeat({ target: 0.20, attack: 0.14, hold: 1.0, release: 1.35 });
        }
        break;
      }

      case 'anomaly': {
        const types = ['fog', 'silence'];
        const type = types[Math.floor(this.rng() * types.length)];
        this.anomaly = { type, t: 0, dur: this._rand(3, 5) };
        this.audio.playDrone({ freq: this._rand(34, 46), dur: this.anomaly.dur, volume: 0.16 });
        if (type === 'silence') this.audio.duck(0.06, 0.5);
        break;
      }

      case 'whisper': {
        this.audio.playWhisper({ pan: this._rand(-0.8, 0.8), volume: 0.06 + this.dread * 0.05 });
        this.dread = Math.min(HORROR.dreadMax, this.dread + 0.015);
        break;
      }
    }
  }

  _updateFlicker(dt, fx) {
    const f = this.flicker;
    if (!f) return;
    f.t += dt;
    if (f.t < f.dur * 0.62) {
      // Rapid stutter phase.
      if (f.t >= f.blinkAt) {
        const on = this.rng() > 0.42;
        f.level = on ? 1 : 0.04;
        f.blinkAt = f.t + 0.03 + this.rng() * 0.12;
        if (on && this.rng() > 0.6) this.audio.flickerWhine(0.3);
      }
    } else {
      // Settle: brief steady glow, then fade back to the dark.
      const target = f.t < f.dur * 0.88 ? 0.5 : 0;
      f.level += (target - f.level) * Math.min(1, dt * 7);
    }
    if (f.t >= f.dur) { this.flicker = null; return; }
    fx.ambient = LIGHT.ambient * (1 + f.level * 6);
    fx.panelEmissive = f.level * 78;
  }

  _updatePhantom(dt, time) {
    const ph = this.phantom;
    if (!ph) return;
    const p = this.player;

    // Bearing of the source relative to where the player faces.
    const rel = wrapAngle(Math.atan2(ph.srcY - p.y, ph.srcX - p.x) - p.angle);

    // The signature beat: if the player turns to face the source, the steps
    // stop dead. Silence is the scare.
    if (Math.abs(rel) < 0.85) {
      this.phantom = null;
      this.dread = Math.min(HORROR.dreadMax, this.dread + 0.03);
      return;
    }

    if (time >= ph.nextStep) {
      const dist = Math.hypot(ph.srcX - p.x, ph.srcY - p.y);
      const force = this.hasGun ? 1.05 : 0.5;
      const vol = clamp(force / (1 + dist * 0.32), this.hasGun ? 0.14 : 0.05, this.hasGun ? 0.78 : 0.45);
      const pan = clamp(Math.sin(rel), -1, 1);
      this.audio.playPhantomStep(pan, vol);
      ph.nextStep = time + (this.hasGun ? this._rand(0.24, 0.40) : this._rand(0.42, 0.6));
      ph.stepsLeft--;
      // Creep a little closer each step.
      const toward = Math.atan2(p.y - ph.srcY, p.x - ph.srcX);
      const creep = this.hasGun ? 0.52 : 0.35;
      ph.srcX += Math.cos(toward) * creep;
      ph.srcY += Math.sin(toward) * creep;
      if (ph.stepsLeft <= 0) this.phantom = null;
    }
  }

  _updateRedEyes(dt, fx) {
    const eyes = this.redEyes;
    if (!eyes) return;
    eyes.t += dt;

    const fadeIn = clamp(eyes.t / 0.8, 0, 1);
    const fadeOut = clamp((eyes.life - eyes.t) / 1.1, 0, 1);
    eyes.alpha = Math.min(fadeIn, fadeOut) * (0.65 + this.dread * 0.2);

    if (eyes.t >= eyes.life) {
      this.redEyes = null;
      return;
    }

    // Tiny lateral drift makes them feel like something breathing in the fog,
    // not a fixed UI marker.
    const sway = Math.sin(eyes.t * 1.7) * 0.08;
    const side = this.player.angle + Math.PI * 0.5;
    fx.entities.push({
      x: eyes.x + Math.cos(side) * sway,
      y: eyes.y + Math.sin(side) * sway,
      tex: 'redEyes',
      scale: eyes.scale,
      alpha: eyes.alpha,
      glow: true,
    });
  }

  _updateFigure(dt, p, fx) {
    const fig = this.figure;
    if (!fig) return;
    fig.t += dt;

    let dist = Math.hypot(fig.x - p.x, fig.y - p.y);
    if (!fig.seen && this._isFacingPoint(fig.x, fig.y)) fig.seen = true;

    const miss = HORROR.silhouetteMiss;
    if (!fig.vanishing && !fig.seen && fig.t >= miss.unseenLife && dist >= miss.escapeDistance) {
      this.figure = null;
      this._scheduleMissedSilhouette(this.now || 0);
      return;
    }

    if (!fig.vanishing && dist > 5.2) {
      const toward = Math.atan2(p.y - fig.y, p.x - fig.x);
      const step = (0.18 + this.dread * 0.16) * dt;
      const nx = fig.x + Math.cos(toward) * step;
      const ny = fig.y + Math.sin(toward) * step;
      if (this._openAt(nx, ny)) {
        fig.x = nx;
        fig.y = ny;
        dist = Math.hypot(fig.x - p.x, fig.y - p.y);
      }
    }

    // The vanish beat: instead of a quiet fade, the *flashlight* stutters and
    // dies. A longer full-black blink hides the actual removal, so when the
    // light catches again the figure is simply gone.
    if (!fig.vanishing && dist < 5) {
      fig.vanishing = true;
      fig.missed = !fig.seen;
      this._failFlashlight();
      this.dread = Math.min(HORROR.dreadMax, this.dread + 0.04);
    }
    fx.entities.push({
      x: fig.x, y: fig.y,
      tex: 'silhouette',
      scale: fig.scale,
      alpha: 1,
      void: true,
      opaque: true,
    });
  }

  // Start a flashlight stutter-and-die (the opposite of the ceiling-light
  // flicker): the beam drops out, gasps, then catches — and the figure is gone.
  _failFlashlight() {
    if (this.lightFail) return;
    const blackoutAt = this._rand(0.55, 0.8);
    const blackoutDur = this._rand(0.42, 0.62);
    this.lightFail = {
      t: 0,
      dur: blackoutAt + blackoutDur + this._rand(0.55, 0.85),
      blinkAt: 0,
      blackoutAt,
      blackoutDur,
      mul: 1,
      removed: false,
    };
    this.audio.flickerWhine(0.7);
  }

  _updateLightFail(dt, fx) {
    const lf = this.lightFail;
    if (!lf) return;
    lf.t += dt;
    const blackoutEnd = lf.blackoutAt + lf.blackoutDur;
    if (lf.t >= lf.blackoutAt && lf.t < blackoutEnd) {
      lf.mul = 0;
      if (!lf.removed) {
        lf.removed = true;
        const missed = this.figure && this.figure.missed;
        this.figure = null;
        fx.entities = fx.entities.filter((e) => e.tex !== 'silhouette');
        if (missed) this._scheduleMissedSilhouette(this.now || 0);
        this.audio.playPhantomStep(0, 0.16);
        this.dread = Math.min(HORROR.dreadMax, this.dread + 0.02);
      }
    } else if (lf.t < lf.blackoutAt) {
      // Stutter phase: the beam mostly drops out, with weak gasps of light.
      if (lf.t >= lf.blinkAt) {
        lf.mul = this.rng() > 0.5 ? this._rand(0.18, 0.5) : this._rand(0, 0.08);
        lf.blinkAt = lf.t + 0.04 + this.rng() * 0.10;
        if (this.rng() > 0.7) this.audio.flickerWhine(0.4);
      }
    } else {
      // Recovery: after one full-black blink, the beam catches again.
      lf.mul += (1 - lf.mul) * Math.min(1, dt * 6);
    }
    if (lf.t >= lf.dur) { this.lightFail = null; return; }
    fx.beamIntensity = LIGHT.beamIntensity * lf.mul;
    fx.ambient = LIGHT.ambient * (lf.mul <= 0.001 ? 0.02 : 0.35 + 0.65 * lf.mul);
  }

  _updateAnomaly(dt, fx) {
    const a = this.anomaly;
    if (!a) return;
    a.t += dt;
    const k = a.t / a.dur;                 // 0..1
    const env = Math.sin(Math.min(1, k) * Math.PI); // smooth in/out 0..1..0

    if (a.type === 'fog') {
      fx.fogDensity *= 1 + env * 1.6;
      fx.fogColor = [lerp(FOG.color[0], 14, env), lerp(FOG.color[1], 6, env), lerp(FOG.color[2], 6, env)];
    } else if (a.type === 'silence') {
      fx.fogDensity *= 1 + env * 1.1;
    }

    if (a.t >= a.dur) {
      if (a.type === 'silence') this.audio.duck(0.7, 0.8); // restore master
      this.anomaly = null;
    }
  }

  _updateGun(fx, time) {
    this._trySpawnGun();
    const site = this.gunSite;
    if (!site) return;

    const dist = Math.hypot(site.x - this.player.x, site.y - this.player.y);
    if (!site.pickedUp && dist <= GUN.proximity) {
      site.pickedUp = true;
      this.hasGun = true;
      this.next.phantomSteps = Math.min(this.next.phantomSteps || Infinity, time + 2.5);
      if (this.onGunPickup) this.onGunPickup(site);
    }

    if (!site.pickedUp && this.elapsed - site.spawnedAt > GUN.visibleFor) {
      this.gunSite = null;
      this.nextGunTryAt = this.elapsed + GUN.respawnAfter;
      return;
    }

    fx.meshes.push({
      x: site.x, y: site.y,
      yaw: site.yaw + 0.25,
      key: 'bloodPool',
      seed: site.seed ^ 0xb10d,
    });
    if (!site.pickedUp) {
      fx.meshes.push({
        x: site.x, y: site.y,
        yaw: site.yaw,
        key: 'gun',
        scale: GUN.pickupScale,
        seed: site.seed ^ 0x6d2b79f5,
      });
    }
  }

  _trySpawnGun(force = false) {
    if (!force && (this.gunSite || this.hasGun || this.elapsed < this.nextGunTryAt)) return false;
    if (force) this.gunSite = null;

    const p = this.player;
    let best = null;

    // Prefer a spot in or near the player's forward arc so repeated misses
    // become obvious opportunities, not another hidden scavenger hunt.
    const offsets = [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05, Math.PI];
    for (const off of offsets) {
      for (let i = 0; i < 8 && !best; i++) {
        const ang = p.angle + off + this._rand(-0.18, 0.18);
        const dist = this._rand(4.2, 8.5);
        const cx = Math.floor(p.x + Math.cos(ang) * dist);
        const cy = Math.floor(p.y + Math.sin(ang) * dist);
        if (this._canPlaceGun(cx, cy) && this._hasLineOfSight(cx + 0.5, cy + 0.5)) best = { cx, cy };
      }
    }

    // Fallback scan keeps the pickup from being starved by unlucky geometry,
    // even if the forward arc is sealed off.
    if (!best) {
      const px = Math.floor(p.x), py = Math.floor(p.y);
      for (let r = 4; r <= 12 && !best; r++) {
        for (let y = -r; y <= r && !best; y++) {
          for (let x = -r; x <= r; x++) {
            if (Math.abs(x) !== r && Math.abs(y) !== r) continue;
            const cx = px + x, cy = py + y;
            if (this._canPlaceGun(cx, cy)) { best = { cx, cy }; break; }
          }
        }
      }
    }

    if (!best) {
      if (!force) this.nextGunTryAt = this.elapsed + 2;
      return false;
    }
    const seed = (this.rng() * 0xffffffff) >>> 0;
    this.gunSite = {
      x: best.cx + 0.5 + this._rand(-0.12, 0.12),
      y: best.cy + 0.5 + this._rand(-0.12, 0.12),
      yaw: this._rand(0, Math.PI * 2),
      seed,
      spawnedAt: this.elapsed,
      pickedUp: false,
    };
    this.audio.quietBeat({ target: 0.19, attack: 0.16, hold: 1.15, release: 1.5 });
    return true;
  }

  _canPlaceGun(cx, cy) {
    if (this.world.isWall(cx, cy)) return false;
    if (Math.hypot(cx + 0.5 - this.player.x, cy + 0.5 - this.player.y) < 3.5) return false;
    // Keep it off tight edges so the low-poly gun does not clip through walls.
    return !this.world.isWall(cx + 1, cy) && !this.world.isWall(cx - 1, cy) &&
           !this.world.isWall(cx, cy + 1) && !this.world.isWall(cx, cy - 1);
  }

  _hasLineOfSight(x, y) {
    const p = this.player;
    const dx = x - p.x, dy = y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.01) return true;
    const stepX = dx / dist, stepY = dy / dist;
    for (let d = 0.3; d < dist; d += 0.18) {
      if (this.world.isWall(Math.floor(p.x + stepX * d), Math.floor(p.y + stepY * d))) return false;
    }
    return true;
  }
}
