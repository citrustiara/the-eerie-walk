// director.js — the "AI" of the horror. It owns a slowly-rising dread value and
// schedules events on randomised timers with cooldowns, gated so the first
// minute is calm and the place turns on you as dread escalates.
//
// The original design philosophy was "dread over jumpscares — nothing here can
// kill you". That is still mostly true, but it had tipped over into nothing
// *happening*: the figure politely deleted itself the moment you looked at it,
// and there was no verb available to you except walking. So:
//
//   * the creature is a solid, articulated thing that walks, slows down when
//     watched rather than vanishing, and past a dread threshold will run you
//     down and put its face through the screen
//   * you have twelve rounds and no reload, and shooting it drives it off
//   * seven anomalies instead of two, gated so the session escalates from
//     "the air got thicker" to "there are twelve of them standing in the hall"
//
// update() returns a set of environment modifiers the renderer consumes; it
// never touches pixels itself.

import {
  HORROR, LIGHT, FOG, GUN, CREATURE, HUNTER, ANOMALIES, RENDER, JUMPSCARE, NOISE,
  STUTTER, LANDMARK_EVENTS, PIT, KEEP_AWAY,
} from './config.js';
import { wrapAngle, clamp, lerp } from './mathutils.js';
import { GUN_ANCHOR } from './world.js';
import { buildCreature, buildHunter, buildCrowdFigure } from './creature.js';

const ANOMALY_KEYS = Object.keys(ANOMALIES);

// Flow field: distance-to-player over the open cells within this many cells.
// 18 covers everything that can plausibly be chasing you; past that, whatever
// it is has not noticed you yet.
const FLOW_RADIUS = 18;
const FLOW_W = FLOW_RADIUS * 2 + 1;
const FLOW_DX = [1, -1, 0, 0];
const FLOW_DY = [0, 0, 1, -1];
const FLOW_REBUILD = 0.30;      // seconds between rebuilds

export class Director {
  constructor(audio, player, world, rng) {
    this.audio = audio;
    this.player = player;
    this.world = world;
    this.rng = rng;

    this.dread = 0;
    this.elapsed = 0;
    this.now = 0;
    this.inited = false;
    this.next = {};            // key -> absolute time of next attempt

    this.flicker = null;       // ceiling lights: { t, dur, level, blinkAt }
    this.phantom = null;       // { srcX, srcY, stepsLeft, nextStep, dist }
    this.creature = null;      // the thing itself
    this.redEyes = null;       // { x, y, scale, alpha, t, life }
    this.lightFail = null;     // flashlight stutter
    this.anomaly = null;       // { type, t, dur, ... }
    this.gunSite = null;       // { x, y, yaw, seed, pickedUp }
    this.nextGunTryAt = GUN.appearAfter;
    this.gunPlacements = 0;    // how many sites it has been through unfound
    this.hasGun = false;

    // The exit stutter: three to five hard cuts to black with uneven lit gaps,
    // and the thing is gone somewhere in the middle of them.
    this.stutter = null;

    // Landmark events. A block is only ever worth one, and only one landmark
    // in the building can be doing something at a time.
    this.ritual = null;
    this.pendingRitual = null;
    this.landmarksUsed = new Set();
    this.nextLandmarkAt = 18;
    this.nextDraftAt = 8;      // the sound coming up out of a hole in the floor
    this.onGunPickup = null;
    this.onAmmoChange = null;
    this.onCaught = null;
    this.onLine = null;        // a line of text for the player, briefly
    this.onSprintUnlock = null;

    // --- the building's answer to a gunshot --------------------------------
    this.noiseReplyAt = 0;     // absolute time the answer arrives, 0 = none
    this.noiseQuietUntil = 0;  // spamming the trigger does not summon a queue

    // --- the hunter ---------------------------------------------------------
    // Armed by the first round you fire. From then on the thin one stops
    // coming and this does instead.
    this.hunted = false;
    this.hunter = null;
    this.sprintGiven = false;
    this.hunterArrivesAt = 0;  // absolute time it walks in, 0 = not on its way
    this.hunterArrivalSpot = null; // reserved early so omens can point truthfully
    this.redshiftedArrivalAt = 0;
    // Set the moment it reaches you. The scare is still playing out on screen
    // when this goes up; what it changes is what happens when the scare ends.
    this.fatal = false;
    this.ending = null;        // which ending id the session finished on
    this.onDeath = null;       // fired once, after the face has finished with you

    // --- gun state ---------------------------------------------------------
    this.ammo = GUN.magazine;
    this.nextShotAt = 0;
    this.flashT = 0;           // muzzle-flash timer
    this.shake = 0;            // screen shake, decays
    this.scareT = 0;           // caught-you face timer
    this.holes = [];           // bullet-hole decal instances
    this.shells = [];          // spent brass with a little physics

    // Crowd figures are static, so one mesh is shared by every instance.
    this.crowdMesh = buildCrowdFigure(0);

    // Dread thresholds gating each event (slow escalation).
    this.gate = {
      flicker: 0.0, whisper: 0.02, distant: 0.02, phantomSteps: 0.05,
      redEyes: 0.03, creature: 0.14, anomaly: 0.10,
    };
  }

  _rand(a, b) { return a + this.rng() * (b - a); }

  _anomalyStrength(type) {
    const a = this.anomaly;
    if (!a || a.type !== type || a.leaving) return 0;
    return Math.sin(Math.min(1, a.t / a.dur) * Math.PI);
  }

  _isSilent() {
    return this.anomaly?.type === 'silence';
  }

  _fogConceals() {
    return this._anomalyStrength('fog') >= 0.62;
  }

  _schedule(key, time) {
    const cfg = HORROR.events[key];
    if (this.hasGun && key === 'phantomSteps') {
      this.next[key] = time + this._rand(4.5, 10.5);
      return;
    }
    // As dread rises, the window compresses — events come faster.
    const squeeze = 1 - this.dread * 0.5;
    this.next[key] = time + this._rand(cfg.min, cfg.max) * squeeze + cfg.cooldown * 0.2;
  }

  // --- geometry helpers -----------------------------------------------------

  _castDistance(x, y, ang, maxDist) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let d = 0;
    while (d < maxDist) {
      d += 0.08;
      if (this.world.isWall(Math.floor(x + dx * d), Math.floor(y + dy * d))) return d;
    }
    return maxDist;
  }

  // Somewhere a thing can stand. Not the same question as "can a ray get
  // through", which is why this is world.blocked and _hasLineOfSight is not:
  // you can see straight across a hole in the floor, and nothing can cross it.
  _openAt(x, y) {
    return !this.world.blocked(Math.floor(x), Math.floor(y));
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

  _isFacingPoint(x, y, angle = HORROR.seenAngle) {
    const p = this.player;
    const rel = Math.abs(wrapAngle(Math.atan2(y - p.y, x - p.x) - p.angle));
    return rel <= angle && this._hasLineOfSight(x, y);
  }

  _placeOutOfSight(minDist, maxDist) {
    const p = this.player;
    const offsets = [Math.PI, -Math.PI * 0.78, Math.PI * 0.78, -Math.PI * 0.58, Math.PI * 0.58];
    for (const off of offsets) {
      for (let i = 0; i < 10; i++) {
        const ang = p.angle + off + this._rand(-0.28, 0.28);
        const dist = this._rand(minDist, maxDist);
        const x = p.x + Math.cos(ang) * dist;
        const y = p.y + Math.sin(ang) * dist;
        const rel = Math.abs(wrapAngle(Math.atan2(y - p.y, x - p.x) - p.angle));
        if (rel < 1.15 || !this._openAt(x, y) || !this._hasLineOfSight(x, y)) continue;
        return { x, y };
      }
    }
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

  // At the far end of whatever you can see down. The original wanted a clear
  // eighteen-metre sightline, which the open map had all over the place and the
  // reworked one essentially never has — mean run of open floor is under five
  // cells now — so the eyes simply stopped appearing. What matters is that they
  // are at the limit of your light, not that the limit is far away.
  _placeDistantEyes() {
    const p = this.player;
    let best = null, bestD = 0;
    for (let i = 0; i < 40; i++) {
      const ang = p.angle + this._rand(-0.62, 0.62);
      const d = this._castDistance(p.x, p.y, ang, 30);
      if (d < 8) continue;
      const place = clamp(d - this._rand(1.2, 2.6), 6.5, 24.0);
      const x = p.x + Math.cos(ang) * place;
      const y = p.y + Math.sin(ang) * place;
      if (!this._openAt(x, y) || !this._hasLineOfSight(x, y)) continue;
      // Prefer the longest one it can find, so a hall still beats a cupboard.
      if (place > bestD) { bestD = place; best = { x, y }; }
      if (bestD > 16) break;
    }
    return best;
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

  // Reachable but not necessarily visible. This is the final placement fallback
  // for things delivered while the torch is off: a bend in the corridor should
  // hide them, not prevent the event from existing.
  _placeReachable(minDist, maxDist) {
    const p = this.player;
    const sx = Math.floor(p.x), sy = Math.floor(p.y);
    const queue = [{ cx: sx, cy: sy }];
    const seen = new Set([`${sx},${sy}`]);
    const candidates = [];
    let head = 0;
    const limit = Math.ceil(maxDist) + 8;

    while (head < queue.length && queue.length < 2048) {
      const cur = queue[head++];
      const dx = cur.cx + 0.5 - p.x, dy = cur.cy + 0.5 - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist && d <= maxDist) candidates.push(cur);
      if (Math.abs(cur.cx - sx) + Math.abs(cur.cy - sy) >= limit) continue;
      for (let i = 0; i < 4; i++) {
        const cx = cur.cx + FLOW_DX[i], cy = cur.cy + FLOW_DY[i];
        const key = `${cx},${cy}`;
        if (seen.has(key) || this.world.blocked(cx, cy)) continue;
        seen.add(key);
        queue.push({ cx, cy });
      }
    }
    if (!candidates.length) return null;
    const pick = candidates[(this.rng() * candidates.length) | 0];
    return { x: pick.cx + 0.5, y: pick.cy + 0.5 };
  }

  // A short, cold-path breadth-first search used for authored-looking guidance.
  // Gun sites are at most sixteen cells away, so strings and arrays here cost
  // less than trying to reuse the hot creature flow field and, unlike a straight
  // line, the resulting trail never paints blood through a wall.
  _pathBetween(fromX, fromY, toX, toY, maxNodes = 2048) {
    const sx = Math.floor(fromX), sy = Math.floor(fromY);
    const tx = Math.floor(toX), ty = Math.floor(toY);
    const start = `${sx},${sy}`, goal = `${tx},${ty}`;
    if (start === goal) return [{ cx: sx, cy: sy }];

    const margin = 7;
    const minX = Math.min(sx, tx) - margin, maxX = Math.max(sx, tx) + margin;
    const minY = Math.min(sy, ty) - margin, maxY = Math.max(sy, ty) + margin;
    const queue = [{ cx: sx, cy: sy }];
    const parent = new Map([[start, null]]);
    let head = 0;

    while (head < queue.length && queue.length < maxNodes) {
      const cur = queue[head++];
      for (let i = 0; i < 4; i++) {
        const cx = cur.cx + FLOW_DX[i], cy = cur.cy + FLOW_DY[i];
        if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
        if (this.world.blocked(cx, cy)) continue;
        const key = `${cx},${cy}`;
        if (parent.has(key)) continue;
        parent.set(key, `${cur.cx},${cur.cy}`);
        if (key === goal) {
          const path = [{ cx, cy }];
          let prev = parent.get(key);
          while (prev) {
            const comma = prev.indexOf(',');
            path.push({ cx: Number(prev.slice(0, comma)), cy: Number(prev.slice(comma + 1)) });
            prev = parent.get(prev);
          }
          path.reverse();
          return path;
        }
        queue.push({ cx, cy });
      }
    }
    return null;
  }

  // --- debug ----------------------------------------------------------------

  debugSpawn(kind) {
    switch (kind) {
      case 'redEyes': {
        const spot = this._placeDistantEyes() || this._placeInSight(7.5, 11.5);
        if (!spot) return false;
        this.redEyes = { x: spot.x, y: spot.y, scale: 0.26, alpha: 0, t: 0, life: 6.0 };
        return true;
      }
      case 'creature':
        return this._spawnCreature(true);
      case 'hunter':
        this.hunted = true;
        this.hunter = null;
        return this._spawnHunter();
      case 'anomaly':
        this._trigger('anomaly', this.now);
        return true;
      case 'gun':
        this.hasGun = false;
        this.ammo = GUN.magazine;
        return this._trySpawnGun(true);
    }
    return false;
  }

  // --- main tick ------------------------------------------------------------

  update(dt, time) {
    this.now = time;

    if (!this.inited) {
      this.inited = true;
      // First attempts are deliberately distant so the opening is quiet.
      for (const key in HORROR.events) {
        const cfg = HORROR.events[key];
        this.next[key] = time + this._rand(cfg.min, cfg.max) * 0.5 + 6;
      }
    }

    this.elapsed += dt;
    this.dread = Math.min(HORROR.dreadMax, this.dread + HORROR.dreadPerSecond * dt);

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
      grade: null,
      shakeX: 0,
      shakeY: 0,
      muzzleFlash: 0,
      scare: 0,
      stress: 0,
      darkFlash: 0,
    };

    // The caught-you sequence owns the frame while it runs.
    if (this.scareT > 0) {
      this.scareT -= dt;
      fx.scare = clamp(this.scareT / (this.scareDur || CREATURE.scareDuration), 0, 1);
      // Darker and much redder than it was. The face itself now lives at the
      // bottom of the range, so the grade has to push what is left toward
      // arterial rather than tint an already-bright picture.
      fx.grade = [1.58, 0.46, 0.42];
      fx.shakeX = (this.rng() - 0.5) * 22;
      fx.shakeY = (this.rng() - 0.5) * 16;
      fx.ambient = LIGHT.ambient * 0.25;
      fx.beamIntensity = 0;
      fx.stress = 1;
      // A creature scare is a beat you walk away from. A hunter scare is not,
      // and the difference is decided here rather than at the moment of contact,
      // so the face gets its full duration either way.
      if (this.scareT <= 0) {
        if (this.fatal) this._die();
        else this._afterCaught();
      }
      return fx;
    }

    // Something heard the last shot, and it has finished deciding.
    if (this.noiseReplyAt && time >= this.noiseReplyAt) {
      this.noiseReplyAt = 0;
      this._noiseReply();
    }

    // Red is a sentence now: an arrival or an authored room event is about to
    // happen. Give those omens first refusal before the random event scheduler
    // can occupy the anomaly slot for the same few seconds.
    this._updateOmenWatch();

    // --- try to launch new events ------------------------------------------
    for (const key in HORROR.events) {
      if (time >= this.next[key] && this.dread >= (this.gate[key] || 0)) {
        this._trigger(key, time);
        this._schedule(key, time);
      }
    }

    // ...and some seconds after that, it is actually in the building with you.
    // The line and the arrival are deliberately not the same event; see NOISE.
    if (this.hunterArrivesAt && time >= this.hunterArrivesAt) {
      this.hunterArrivesAt = 0;
      this._spawnHunter();
    }

    // Anything that hunts needs a route, not a bearing. Rebuilt a few times a
    // second and shared by the creature and the hunter.
    if ((this.creature || this.hunter) &&
        (this._flowAt == null || time - this._flowAt >= FLOW_REBUILD)) {
      this._rebuildFlow();
    }

    // --- advance active events ---------------------------------------------
    this._updateFlicker(dt, fx);
    this._updatePhantom(dt, time);
    this._updateRedEyes(dt, fx);
    this._updateCreature(dt, fx);
    this._updateHunter(dt, fx);
    this._updateLightFail(dt, fx);
    this._updateAnomaly(dt, fx);
    this._updateLandmarkWatch(dt, fx);
    this._updateRitual(dt, fx);
    this._updateGun(fx, time, dt);
    this._updateDraft(dt);
    this._updateShake(dt, fx);
    // Last, so a blackout wins over whatever else was doing things to the light.
    this._updateStutter(dt, fx);

    // Dread very subtly thickens the fog over a whole session.
    fx.fogDensity *= 1 + this.dread * 0.12;
    this.audio.update(this.dread, dt);
    return fx;
  }

  _updateShake(dt, fx) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      fx.muzzleFlash = clamp(this.flashT / 0.075, 0, 1) ** 0.6;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.4);
      const k = this.shake * this.shake;
      fx.shakeX += (this.rng() - 0.5) * 11 * k;
      fx.shakeY += (this.rng() - 0.5) * 7 * k;
    }
  }

  // A hole in the floor moves air, and you hear it before you see it. Cheap
  // enough to just scan the cells around you every few seconds.
  _updateDraft(dt) {
    if (this.elapsed < this.nextDraftAt) return;
    this.nextDraftAt = this.elapsed + this._rand(5.5, 11);
    const p = this.player;
    const r = Math.ceil(PIT.edgeSound);
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = Math.floor(p.x) + dx, cy = Math.floor(p.y) + dy;
        if (!this.world.isPit(cx, cy)) continue;
        const d = (cx + 0.5 - p.x) ** 2 + (cy + 0.5 - p.y) ** 2;
        if (d < bestD) { bestD = d; best = { cx, cy }; }
      }
    }
    if (!best) return;
    const rel = wrapAngle(Math.atan2(best.cy + 0.5 - p.y, best.cx + 0.5 - p.x) - p.angle);
    this.audio.playPitDraft(clamp(Math.sin(rel), -1, 1),
                            0.26 / (1 + Math.sqrt(bestD) * 0.35));
  }

  // ==========================================================================
  // Going away
  // ==========================================================================
  //
  // One clean fade to black is a transition. It tells you the game has decided
  // the scene is over, and it resolves the tension for you. What everything
  // does now instead is take the torch with it: the light cuts three to five
  // times in a row, in gaps too short and too uneven to be deliberate, and
  // partway through that sequence the thing stops being there. So you get one
  // more lit frame of it, then black, then a lit frame with nothing in it, then
  // black again — and by the time the light is properly back you are not sure
  // which of those frames was the real one.
  //
  // onHide fires at the point in the sequence where the thing goes.

  _startStutter(onHide) {
    const lo = STUTTER.counts[0], hi = STUTTER.counts[1];
    const n = lo + ((this.rng() * (hi - lo + 1)) | 0);
    // Gamma-shaped rather than uniform: most segments land near the short end
    // and one or two per sequence are long. A uniform draw over a narrow range
    // gives every blackout and every gap roughly the same length, and a torch
    // failing on an even rhythm reads as an effect rather than as a torch.
    const seg = (r) => r[0] + (r[1] - r[0]) * Math.pow(this.rng(), STUTTER.gamma);
    const seq = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      seq.push({
        dark: true,
        dur: seg(STUTTER.darkFor) * (last ? STUTTER.finalDark : 1),
      });
      if (!last) seq.push({ dark: false, dur: seg(STUTTER.litFor) });
    }
    // Fire the old sequence's callback rather than stranding it, in the rare
    // case two things leave on top of each other.
    if (this.stutter && !this.stutter.hidden && this.stutter.onHide) this.stutter.onHide();
    this.stutter = {
      seq, i: 0, t: 0, hidden: false, onHide,
      hideAt: Math.max(1, Math.round(seq.length * STUTTER.hideAfter)),
    };
    this.audio.playLightFail(0.85);
  }

  _stutterHide() {
    const s = this.stutter;
    if (!s || s.hidden) return;
    s.hidden = true;
    if (s.onHide) s.onHide();
  }

  _updateStutter(dt, fx) {
    const s = this.stutter;
    if (!s) return;
    s.t += dt;
    while (s.i < s.seq.length && s.t >= s.seq[s.i].dur) {
      s.t -= s.seq[s.i].dur;
      s.i++;
      if (s.i >= s.hideAt) this._stutterHide();
      if (s.i < s.seq.length && s.seq[s.i].dark) {
        this.audio.playLightFail(0.4 + this.rng() * 0.35);
      }
    }
    if (s.i >= s.seq.length) {
      this._stutterHide();
      this.stutter = null;
      this.audio.flickerWhine(0.45);
      return;
    }
    const seg = s.seq[s.i];
    if (!seg.dark) return;
    // Instant in, a hair softer out, so the last one bleeds back rather than
    // snapping — anything faster than about 50 ms reads as a dropped frame.
    const out = clamp((seg.dur - s.t) / 0.09, 0, 1);
    fx.darkFlash = Math.max(fx.darkFlash, 0.06 + out * 0.94);
    fx.beamIntensity = 0;
  }

  // ==========================================================================
  // What lives in the rooms that were built on purpose
  // ==========================================================================
  //
  // The generated districts are noise, and noise cannot be recognised. The five
  // stamped landmarks can be — you have been in this ward before — and the one
  // thing worse than not knowing where you are is knowing. So each of them owns
  // an event that only happens there, armed the first time you walk in, and it
  // uses the shape of the room: ranks down the ward corridor, a ring around the
  // atrium core, something looking up at you out of the shaft, the lattice of
  // the combs filling in, one pair on the chapel plinth.

  _updateLandmarkWatch(dt, fx) {
    const p = this.player;
    const name = this.world.landmarkAt(Math.floor(p.x), Math.floor(p.y));
    if (!name || this.ritual || this.creature || this.hunter) return;
    if (this.elapsed < this.nextLandmarkAt) return;

    const c = this.world.blockCenter(Math.floor(p.x), Math.floor(p.y));
    const key = Math.floor(c.x) + ',' + Math.floor(c.y);
    if (this.landmarksUsed.has(key)) return;

    const cfg = LANDMARK_EVENTS[name];
    if (!cfg) return;
    this.pendingRitual = {
      name, cfg, key, cx: c.x, cy: c.y,
      at: this.elapsed + this._rand(cfg.delay[0], cfg.delay[1]),
    };
  }

  _fireRitual(pending) {
    const { name, cfg, cx, cy } = pending;
    const p = this.player;
    const eyes = [];

    const add = (x, y, z, scale, delay) => {
      if (this.world.isWall(Math.floor(x), Math.floor(y))) return;
      if (!this._hasLineOfSight(x, y)) return;
      eyes.push({ x, y, z, scale, delay });
    };

    switch (cfg.kind) {
      case 'ranks': {
        // Two files, down whichever axis of the corridor you are actually
        // looking along, staggered so the far ones resolve last.
        const along = Math.abs(Math.cos(p.angle)) > Math.abs(Math.sin(p.angle))
          ? [Math.sign(Math.cos(p.angle)), 0] : [0, Math.sign(Math.sin(p.angle))];
        const perp = [-along[1], along[0]];
        for (let i = 0; i < cfg.eyes; i++) {
          const d = 4.0 + i * 2.1;
          for (const s of [-1, 1]) {
            add(p.x + along[0] * d + perp[0] * s * 0.72,
                p.y + along[1] * d + perp[1] * s * 0.72,
                0.56, 0.20 + i * 0.012, i * 0.22 + (s > 0 ? 0.09 : 0));
          }
        }
        break;
      }
      case 'circle': {
        // A ring around the solid core, so they are behind you as well.
        for (let i = 0; i < cfg.eyes * 2; i++) {
          const a = (i / (cfg.eyes * 2)) * Math.PI * 2;
          add(cx + Math.cos(a) * 5.4, cy + Math.sin(a) * 5.4, 0.58, 0.24, i * 0.11);
        }
        break;
      }
      case 'below': {
        // Down in the hole, looking up. Nothing else in the game is under you.
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            if (eyes.length >= cfg.eyes) break;
            const gx = Math.floor(p.x) + dx, gy = Math.floor(p.y) + dy;
            if (!this.world.isPit(gx, gy)) continue;
            if (this.rng() > 0.34) continue;
            add(gx + 0.5, gy + 0.5, -PIT.eyesAt, 0.30, this.rng() * 1.4);
          }
        }
        break;
      }
      case 'lattice': {
        // On the lattice itself, one per gap, so the regularity of the room
        // becomes the regularity of them.
        for (let i = 0; i < cfg.eyes; i++) {
          const gx = cx + ((i % 3) - 1) * 4;
          const gy = cy + (((i / 3) | 0) - 1) * 4;
          add(gx, gy, 0.60, 0.22, i * 0.17);
        }
        break;
      }
      case 'altar': {
        // One pair, on the plinth, much bigger than the rest and at the height
        // of something that is standing on it.
        add(cx, cy, 0.86, 0.62, 0);
        break;
      }
    }

    // The shape of the room is what each of these is built around, and by the
    // time it fires you have walked a few metres further into it — so most of
    // the intended positions can be inside a wall. Rather than have the event
    // silently not happen, fall back to scattering the same number of them
    // wherever they can actually be seen from where you are now.
    if (eyes.length < 2) {
      for (let i = 0; i < cfg.eyes * 3 && eyes.length < cfg.eyes; i++) {
        const a = p.angle + this._rand(-1.5, 1.5);
        const dd = this._rand(3.5, 11);
        add(p.x + Math.cos(a) * dd, p.y + Math.sin(a) * dd,
            cfg.kind === 'below' ? -PIT.eyesAt : this._rand(0.34, 0.64),
            this._rand(0.18, 0.28), this.rng() * 1.5);
      }
    }
    // Only burn the landmark once it has actually managed to do something.
    if (!eyes.length) return;
    this.landmarksUsed.add(pending.key);
    this.ritual = { name, kind: cfg.kind, t: 0, life: this._rand(4.6, 7.4), eyes, leaving: false };
    this.nextLandmarkAt = this.elapsed + LANDMARK_EVENTS.cooldown;
    this.dread = Math.min(HORROR.dreadMax, this.dread + 0.05);

    switch (cfg.kind) {
      case 'ranks':   this.audio.playDistantCall(0.30, 0); break;
      case 'circle':  this.audio.playDrone({ freq: 37, dur: 5.0, volume: 0.18 }); break;
      case 'below':   this.audio.playPitDraft(0, 0.30); this.audio.playWhisper({ pan: 0, volume: 0.09 }); break;
      case 'lattice': this.audio.playWhisper({ pan: -0.6, volume: 0.09 });
                      this.audio.playWhisper({ pan: 0.6, volume: 0.09 }); break;
      case 'altar':   this.audio.playDistantCall(0.42, 0); this.audio.setHeartbeat(0.7); break;
    }
  }

  _updateRitual(dt, fx) {
    if (this.pendingRitual && this.elapsed >= this.pendingRitual.at) {
      const pending = this.pendingRitual;
      this.pendingRitual = null;
      this._fireRitual(pending);
    }

    const r = this.ritual;
    if (!r) return;
    r.t += dt;

    for (const e of r.eyes) {
      const t = r.t - e.delay;
      if (t < 0) continue;
      fx.entities.push({
        x: e.x, y: e.y, tex: 'redEyes', z: e.z,
        scale: e.scale,
        alpha: clamp(t / 0.55, 0, 1) * (0.72 + this.dread * 0.2),
        glow: true,
      });
    }

    // None of these wait to be over. They wait for you to come closer, and then
    // they are not there. It used to be only the altar; every one of them is
    // better as something you saw across a room than as something you walked up
    // to, and the ranks down a ward corridor were the worst offender — twelve
    // pairs of eyes are terrifying at the far end and a line of floating dots
    // when you are standing among them.
    const p = this.player;
    let near = Infinity;
    for (const e of r.eyes) {
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2 < near) near = d2;
    }
    near = Math.sqrt(near);
    const keep = r.kind === 'altar' ? 3.4 : KEEP_AWAY.ritual;
    if (!r.leaving && (r.t >= r.life || (r.t > 0.9 && near < keep))) {
      r.leaving = true;
      this.audio.setHeartbeat(0);
      this._startStutter(() => { this.ritual = null; });
    }
  }

  _trigger(key, time) {
    switch (key) {
      case 'flicker':
        this.flicker = { t: 0, dur: this._rand(1.2, 2.2), level: 0, blinkAt: 0 };
        this.audio.flickerWhine(0.6 + this.dread * 0.5);
        break;

      case 'phantomSteps': {
        // Do not overwrite the one set of footsteps that is actually going
        // somewhere: late gun guidance crosses the player and ends at the site.
        if (this.phantom && this.phantom.mode === 'gunGuide') break;
        const p = this.player;
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

      case 'creature':
        // Once you have fired a round, the building stops sending the thin one.
        if (this.hunted) this._spawnHunter();
        else this._spawnCreature(false);
        break;

      case 'redEyes': {
        if (this.redEyes || this.creature) break;
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

      case 'anomaly':
        this._startAnomaly();
        break;

      case 'whisper':
        this.audio.playWhisper({ pan: this._rand(-0.8, 0.8), volume: 0.06 + this.dread * 0.05 });
        this.dread = Math.min(HORROR.dreadMax, this.dread + 0.010);
        break;

      case 'distant': {
        // Something happening in a part of the building you will never find.
        const pan = this._rand(-0.9, 0.9);
        const roll = this.rng();
        if (roll < 0.45) this.audio.playDistantBang(pan);
        else if (roll < 0.75) this.audio.playStaticBurst(pan);
        else this.audio.playChildLaugh(pan);
        break;
      }
    }
  }

  // --- ceiling lights -------------------------------------------------------

  _updateFlicker(dt, fx) {
    const f = this.flicker;
    if (!f) return;
    f.t += dt;
    if (f.t < f.dur * 0.62) {
      if (f.t >= f.blinkAt) {
        const on = this.rng() > 0.42;
        f.level = on ? 1 : 0.04;
        f.blinkAt = f.t + 0.03 + this.rng() * 0.12;
        if (on && this.rng() > 0.6) this.audio.flickerWhine(0.3);
      }
    } else {
      const target = f.t < f.dur * 0.88 ? 0.5 : 0;
      f.level += (target - f.level) * Math.min(1, dt * 7);
    }
    if (f.t >= f.dur) { this.flicker = null; return; }
    fx.ambient = LIGHT.ambient * (1 + f.level * 6);
    fx.panelEmissive = f.level * 78;
  }

  // --- footsteps behind you -------------------------------------------------

  _updatePhantom(dt, time) {
    const ph = this.phantom;
    if (!ph) return;
    const p = this.player;
    const rel = wrapAngle(Math.atan2(ph.srcY - p.y, ph.srcX - p.x) - p.angle);

    if (ph.mode === 'gunGuide') {
      if (time < ph.nextStep) return;
      const distFromPlayer = Math.hypot(ph.srcX - p.x, ph.srcY - p.y);
      const pan = clamp(Math.sin(rel), -1, 1);
      const vol = clamp(0.9 / (1 + distFromPlayer * 0.24), 0.16, 0.64);
      if (!this._isSilent()) this.audio.playPhantomStep(pan, vol);
      ph.nextStep = time + this._rand(0.30, 0.43);

      const dx = ph.targetX - ph.srcX, dy = ph.targetY - ph.srcY;
      const remaining = Math.hypot(dx, dy);
      if (remaining <= ph.step || ph.stepsLeft-- <= 1) {
        ph.srcX = ph.targetX;
        ph.srcY = ph.targetY;
        if (!this._isSilent()) this.audio.playShellDrop(pan);
        this.phantom = null;
        return;
      }
      ph.srcX += dx / remaining * ph.step;
      ph.srcY += dy / remaining * ph.step;
      return;
    }

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
      if (!this._isSilent()) this.audio.playPhantomStep(pan, vol);
      ph.nextStep = time + (this.hasGun ? this._rand(0.24, 0.40) : this._rand(0.42, 0.6));
      ph.stepsLeft--;
      const toward = Math.atan2(p.y - ph.srcY, p.x - ph.srcX);
      const creep = this.hasGun ? 0.52 : 0.35;
      ph.srcX += Math.cos(toward) * creep;
      ph.srcY += Math.sin(toward) * creep;
      if (ph.stepsLeft <= 0) this.phantom = null;
    }
  }

  // --- distant eyes ---------------------------------------------------------

  _updateRedEyes(dt, fx) {
    const eyes = this.redEyes;
    if (!eyes) return;
    eyes.t += dt;

    // No fade out. They do not dim and drift off; the light goes, and after it
    // has gone a few times they are not there any more.
    eyes.alpha = clamp(eyes.t / 0.8, 0, 1) * (0.65 + this.dread * 0.2);

    // It leaves on its timer, or the moment you start walking at it — whichever
    // comes first. You are never allowed to arrive.
    const near = (eyes.x - this.player.x) ** 2 + (eyes.y - this.player.y) ** 2
      < KEEP_AWAY.eyes * KEEP_AWAY.eyes;
    if ((eyes.t >= eyes.life || (near && eyes.t > 0.9)) && !eyes.leaving) {
      eyes.leaving = true;
      this._startStutter(() => { this.redEyes = null; });
    }

    const sway = Math.sin(eyes.t * 1.7) * 0.08;
    const side = this.player.angle + Math.PI * 0.5;
    fx.entities.push({
      x: eyes.x + Math.cos(side) * sway,
      y: eyes.y + Math.sin(side) * sway,
      tex: 'redEyes', scale: eyes.scale, alpha: eyes.alpha, glow: true,
      // Sprites stand on the floor by default, which put these at ankle height.
      // Whatever they belong to is taller than you are.
      z: 0.58,
    });
  }

  // ==========================================================================
  // The creature
  // ==========================================================================

  _spawnCreature(force) {
    if (this.creature && !force) return false;
    const spot = this._placeOutOfSight(CREATURE.spawnMin, CREATURE.spawnMax)
      || this._placeInSight(CREATURE.spawnMin, CREATURE.spawnMax)
      || this._placeReachable(CREATURE.spawnMin, CREATURE.spawnMax);
    if (!spot) return false;

    const p = this.player;
    this.creature = {
      x: spot.x, y: spot.y,
      yaw: Math.atan2(p.y - spot.y, p.x - spot.x),
      phase: this.rng() * Math.PI * 2,
      mode: 'stalk',
      t: 0,
      life: CREATURE.lifetime,
      hp: GUN.stagger,
      stagger: 0,
      mouth: 0,
      reach: 0,
      speed: 0,
      lastStepPhase: 0,
      nextChargeRoll: CREATURE.chargeRollEvery,
      // twitch state
      twitchAt: this._rand(0.6, 2.2),
      twitchUntil: -1,
      twitch: 0,
      snap: 0,
      snapTarget: 0,
    };
    this.audio.quietBeat({ target: 0.17, attack: 0.10, hold: 1.2, release: 1.4 });
    return true;
  }

  // --- getting to you -------------------------------------------------------
  //
  // Walking straight at the player and sliding along whatever it hits was fine
  // when the map was open streets. In a warren it is useless: a corridor that
  // bends away from you is indistinguishable from a wall, and the thing spends
  // the whole encounter grinding against a corner nine metres away. So there is
  // a proper flow field now — a breadth-first distance-to-player over the open
  // cells around you, rebuilt a few times a second and shared by everything
  // that hunts. It is about 5,000 cell tests every third of a second, which is
  // nothing next to a single frame of raycasting.

  _rebuildFlow() {
    const R = FLOW_RADIUS, W = FLOW_W;
    const p = this.player;
    const ox = Math.floor(p.x) - R, oy = Math.floor(p.y) - R;
    if (!this._flowDist) {
      this._flowDist = new Int16Array(W * W);
      this._flowQueue = new Int32Array(W * W);
    }
    const dist = this._flowDist, queue = this._flowQueue;
    dist.fill(-1);
    let head = 0, tail = 0;
    const start = R * W + R;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      const cx = idx % W, cy = (idx / W) | 0;
      const d = dist[idx] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + FLOW_DX[k], ny = cy + FLOW_DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const ni = ny * W + nx;
        if (dist[ni] !== -1) continue;
        if (this.world.blocked(ox + nx, oy + ny)) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
    this._flowOX = ox; this._flowOY = oy;
    this._flowAt = this.now;
  }

  // Bearing of the neighbouring cell that is closest to the player, or null if
  // this point is outside the field or walled off from it entirely.
  _flowBearing(x, y) {
    if (!this._flowDist) return null;
    const W = FLOW_W, dist = this._flowDist;
    const cx = Math.floor(x) - this._flowOX, cy = Math.floor(y) - this._flowOY;
    if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= W - 1) return null;
    let best = dist[cy * W + cx];
    if (best < 0) return null;
    let bx = 0, by = 0;
    for (let k = 0; k < 4; k++) {
      const d = dist[(cy + FLOW_DY[k]) * W + (cx + FLOW_DX[k])];
      if (d >= 0 && d < best) { best = d; bx = FLOW_DX[k]; by = FLOW_DY[k]; }
    }
    if (!bx && !by) return null;
    // Aim at the middle of that cell so it takes doorways square-on.
    return Math.atan2((this._flowOY + cy + by + 0.5) - y, (this._flowOX + cx + bx + 0.5) - x);
  }

  // Step toward a target. Straight line when it can see you — anything else
  // looks like it is following a route — and the flow field when it cannot.
  _creatureMove(c, tx, ty, dist) {
    let ang = Math.atan2(ty - c.y, tx - c.x);
    const chasing = tx === this.player.x && ty === this.player.y;
    if (chasing && !this._hasLineOfSight(c.x, c.y)) {
      const flow = this._flowBearing(c.x, c.y);
      if (flow != null) ang = flow;
    }
    const nx = c.x + Math.cos(ang) * dist;
    const ny = c.y + Math.sin(ang) * dist;
    if (this._openAt(nx, ny)) { c.x = nx; c.y = ny; return; }
    if (this._openAt(nx, c.y)) { c.x = nx; return; }
    if (this._openAt(c.x, ny)) { c.y = ny; return; }
    // Boxed in — sidestep along the wall it is pressed against.
    const side = ang + (this.rng() > 0.5 ? 1.57 : -1.57);
    const sx = c.x + Math.cos(side) * dist, sy = c.y + Math.sin(side) * dist;
    if (this._openAt(sx, sy)) { c.x = sx; c.y = sy; }
  }

  _updateCreature(dt, fx) {
    const c = this.creature;
    if (!c) {
      this.audio.setBreath(0);
      this.audio.setHeartbeat(clamp((this.dread - 0.5) * 0.4, 0, 0.25));
      return;
    }

    const p = this.player;
    c.t += dt;
    c.stagger = Math.max(0, c.stagger - dt * 2.6);

    let dx = p.x - c.x, dy = p.y - c.y;
    let dist = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx);
    const watched = this._isFacingPoint(c.x, c.y, 0.55);

    // It is never in the room with you. Whether it closed the distance or you
    // walked up to it, inside this radius it is simply gone. It stops doing
    // anything at all the instant that starts — it is still standing there
    // between the blackouts, it just is not deciding anything any more.
    if (!c.leaving && dist <= CREATURE.vanishDistance) { this._reached(c); return; }
    if (c.leaving) { this._drawCreature(c, fx, dist, watched); return; }

    // --- decide what it is doing --------------------------------------------
    if (c.mode === 'stalk') {
      // It never fully freezes. Being watched slows it to a crawl, which reads
      // far worse than stopping — you can see it is still getting closer.
      c.speed = watched ? CREATURE.watchedSpeed : CREATURE.walkSpeed * (0.75 + this.dread * 0.5);
      c.reach += (0 - c.reach) * dt * 3;
      c.mouth += ((watched ? 0.25 : 0.06) - c.mouth) * dt * 2;

      // Roll for a charge on a timer while it is in range and can see you —
      // not once per spawn, and not only while you happen to be looking at it,
      // or the charge almost never fires at all. Off by default: it walks, and
      // walking is enough.
      if (CREATURE.canCharge &&
          this.dread >= CREATURE.chargeFrom && dist <= CREATURE.chargeDistance &&
          c.t >= c.nextChargeRoll && !this._fogConceals() &&
          this._hasLineOfSight(c.x, c.y)) {
        c.nextChargeRoll = c.t + CREATURE.chargeRollEvery;
        if (this.rng() < CREATURE.chargeChance + this.dread * 0.28) this._beginCharge(c, bearing);
      }
    } else if (c.mode === 'charge') {
      c.speed = CREATURE.chargeSpeed;
      c.reach += (1 - c.reach) * dt * 5;
      c.mouth += (1 - c.mouth) * dt * 6;
      // It commits for a few seconds, then breaks off if it has not reached you.
      if (c.t - c.chargeStart > 6.5) {
        c.mode = 'stalk';
        c.speed = CREATURE.walkSpeed;
        c.nextChargeRoll = c.t + CREATURE.chargeRollEvery * 2;
      }
    } else if (c.mode === 'flee') {
      c.speed = CREATURE.chargeSpeed * 0.85;
      c.reach += (0 - c.reach) * dt * 4;
      c.mouth += (0.7 - c.mouth) * dt * 3;
      if (dist > 16 || c.t - c.fleeStart > 5) { this._despawnCreature(); return; }
    }

    // --- move ---------------------------------------------------------------
    const step = c.speed * dt * (1 - c.stagger * 0.8);
    if (c.mode === 'flee') {
      this._creatureMove(c, c.x - dx, c.y - dy, step);
    } else if (dist > 0.5) {
      this._creatureMove(c, p.x, p.y, step);
    }
    dx = p.x - c.x; dy = p.y - c.y;
    dist = Math.hypot(dx, dy);
    const face = c.mode === 'flee' ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
    c.yaw += wrapAngle(face - c.yaw) * Math.min(1, dt * 5);

    // --- the twitch ---------------------------------------------------------
    // Fits come more often the closer it is and when it knows you are looking.
    // The head snap is chosen once, held for the whole fit, then unwound over
    // about half a second: the stillness afterwards is the frightening part.
    const urge = 1 + (watched ? 0.9 : 0) + clamp(1 - dist / 8, 0, 1) * 1.2;
    if (c.t >= c.twitchAt) {
      const dur = this._rand(CREATURE.twitchDur[0], CREATURE.twitchDur[1]);
      c.twitchUntil = c.t + dur;
      c.twitchAmp = this._rand(0.55, 1);
      c.snapTarget = (this.rng() - 0.5) * 1.7;
      c.twitchAt = c.t + this._rand(CREATURE.twitchEvery[0], CREATURE.twitchEvery[1]) / urge;
    }
    if (c.t < c.twitchUntil) {
      c.twitch = c.twitchAmp;
      c.snap += (c.snapTarget - c.snap) * Math.min(1, dt * 26);
    } else {
      c.twitch = Math.max(0, c.twitch - dt * 7);
      c.snap += (0 - c.snap) * Math.min(1, dt * 2.4);
    }

    // --- animate ------------------------------------------------------------
    const strideRate = c.mode === 'charge' ? 9.5 : 2.1 + c.speed * 2.4;
    c.phase += strideRate * dt;
    // A footfall at the bottom of each stride, panned to its bearing.
    const stepIndex = Math.floor(c.phase / Math.PI);
    if (stepIndex !== c.lastStepPhase) {
      c.lastStepPhase = stepIndex;
      const rel = wrapAngle(bearing - p.angle);
      const vol = clamp(0.55 / (1 + dist * 0.30), 0.03, 0.55);
      if (dist < 15 && !this._isSilent()) {
        this.audio.playCreatureStep(clamp(Math.sin(rel), -1, 1), vol);
      }
    }

    // --- audio proximity ----------------------------------------------------
    const rel = wrapAngle(bearing - p.angle);
    const near = clamp(1 - dist / CREATURE.breathDistance, 0, 1);
    this.audio.setBreath(near * (c.mode === 'charge' ? 1.6 : 1), clamp(Math.sin(rel), -1, 1));
    this.audio.setHeartbeat(clamp(near * 1.3, 0, 1));
    fx.stress = near * (c.mode === 'charge' ? 1 : 0.45);

    // Being close to it drags the fog in and steals the ambient light.
    fx.fogDensity *= 1 + near * 0.35;
    fx.ambient *= 1 - near * 0.35;

    // --- lifetime -----------------------------------------------------------
    c.life -= dt;
    if (c.life <= 0 || dist > CREATURE.despawnDistance) { this._despawnCreature(); return; }

    this._drawCreature(c, fx, dist, watched);
  }

  // --- hand the posed mesh to the renderer -----------------------------------
  _drawCreature(c, fx, dist, watched) {
    fx.meshes.push({
      x: c.x, y: c.y,
      yaw: c.yaw,
      key: 'creature',
      seed: 0x1a7e,
      mesh: buildCreature({
        phase: c.phase,
        speed: c.leaving ? 0 : clamp(c.speed / CREATURE.walkSpeed, 0, 1.4),
        lean: c.mode === 'charge' ? 0.55 : 0.16 + Math.sin(c.t * 0.7) * 0.03,
        reach: c.reach,
        mouth: c.mouth,
        stagger: c.stagger,
        turn: watched ? 0 : Math.sin(c.t * 0.4) * 0.25,
        twitch: c.twitch,
        twitchT: c.t * CREATURE.twitchRate,
        snap: c.snap,
        eyeGlow: c.mode === 'charge' ? 1.6 : 0.55 + Math.sin(c.t * 1.3) * 0.15,
        // Teeth and individual fingers are sub-pixel past about six metres.
        detail: dist < 6.5 ? 1 : 0,
      }),
    });
  }

  _beginCharge(c, bearing) {
    c.mode = 'charge';
    c.chargeStart = c.t;
    this.shake = 0.5;
    const rel = wrapAngle(bearing - this.player.angle);
    this.audio.playDistantCall(0.45 + this.dread * 0.25, clamp(Math.sin(rel), -1, 1));
    this.dread = Math.min(HORROR.dreadMax, this.dread + 0.05);
  }

  // It got within arm's length — or you walked into it, which it likes even
  // less. Either way the corridor is empty a second later.
  //
  // The old version of this beat was the face filling the screen. That is now
  // behind JUMPSCARE.enabled, because a jumpscare resolves the tension it spent
  // forty seconds building: you flinch, you laugh, and then you are fine. This
  // resolves nothing. The torch cuts, and when it comes back there is nothing
  // there and no evidence there ever was.
  _reached(c) {
    const charging = c.mode === 'charge';
    if (JUMPSCARE.enabled && charging) { this._caught(); return; }

    this.audio.playVanish(charging ? 0.8 : 0.55, 0);
    this.shake = charging ? 0.8 : 0.4;
    this.dread = Math.max(0, this.dread - (charging ? 0.22 : 0.12));
    // It does not go now. It goes somewhere inside the next second of the torch
    // failing, and there is no frame that shows it going.
    c.leaving = true;
    c.mouth = 1;
    this._startStutter(() => this._despawnCreature());
    this.next.creature = this.now + this._rand(45, 90);
  }

  _caught() {
    this.scareT = CREATURE.scareDuration;
    this.shake = 1;
    this.audio.playScream();
    if (this.onCaught) this.onCaught();
  }

  // After the face cuts away: the creature is gone, your torch is broken for a
  // few seconds, and the pressure resets. You are not dead. That is the point —
  // you have to keep walking, and now you know what is out here.
  _afterCaught() {
    this.creature = null;
    this.hunter = null;
    this.scareDur = 0;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
    this.dread = Math.max(0, this.dread - 0.30);
    this._failFlashlight(2.4);
    // It does not stop coming. It just has to find you again.
    this.next.creature = this.now + this._rand(30, 55);
  }

  _despawnCreature() {
    this.creature = null;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
  }

  // ==========================================================================
  // The hunter
  // ==========================================================================

  // It comes in where you can see it. The creature was a thing you caught out
  // of the corner of your eye; this one wants to be looked at, because looking
  // at it does not slow it down.
  _spawnHunter() {
    if (this.hunter) return false;
    const reserved = this.hunterArrivalSpot;
    const spot = (reserved && this._openAt(reserved.x, reserved.y) ? reserved : null)
      || this._placeInSight(HUNTER.spawnMin, HUNTER.spawnMax)
      || this._placeOutOfSight(HUNTER.spawnMin, HUNTER.spawnMax)
      || this._placeReachable(HUNTER.spawnMin, HUNTER.spawnMax);
    if (!spot) return false;
    this.hunterArrivalSpot = null;

    const p = this.player;
    this.hunter = {
      x: spot.x, y: spot.y,
      yaw: Math.atan2(p.y - spot.y, p.x - spot.x),
      phase: this.rng() * Math.PI * 2,
      mode: 'approach',
      t: 0,
      life: HUNTER.lifetime,
      hp: HUNTER.stagger,
      stagger: 0,
      mouth: 0.25,
      reach: 0,
      speed: HUNTER.approachSpeed,
      lastStepPhase: 0,
      nextChargeAt: 0,      // it may run the moment it is in range
      chargeOmenAt: 0,
      windUntil: 0,
      chargeStart: 0,
      twitchAt: this._rand(0.15, 0.7),
      twitchUntil: -1, twitchAmp: 1, twitch: 0, snap: 0, snapTarget: 0,
      resnapAt: 0,
    };

    const rel = wrapAngle(Math.atan2(spot.y - p.y, spot.x - p.x) - p.angle);
    this.audio.playHunterCall(0.62, clamp(Math.sin(rel), -1, 1));
    this.dread = Math.min(HORROR.dreadMax, this.dread + 0.10);

    // The "run" line does NOT happen here any more, for two reasons. It fired
    // on every hunter spawn, so the one piece of instruction in the game became
    // a repeating notification; and it fired in the same frame as "it heard
    // you", overwriting it, so the answer to the gunshot was never actually
    // read. It now happens once, ever, when the thing gets close enough for the
    // word to mean something. See _updateHunter.
    return true;
  }

  _updateHunter(dt, fx) {
    const h = this.hunter;
    if (!h) return;
    const p = this.player;
    h.t += dt;
    h.stagger = Math.max(0, h.stagger - dt * 2.2);

    let dx = p.x - h.x, dy = p.y - h.y;
    let dist = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx);

    // The one line of instruction the game ever gives, and the ability it refers
    // to, handed over together and only ever once — at the moment the thing is
    // near enough that "run" is a description of your situation rather than a
    // tutorial.
    if (!this.sprintGiven && dist <= HUNTER.runPromptAt) {
      this.sprintGiven = true;
      if (this.onLine) this.onLine('run');
      if (this.onSprintUnlock) this.onSprintUnlock();
    }

    // If it simply walks into you — because you stood still, or because you ran
    // into it in the dark — that counts. It does not have to be running.
    if (h.mode !== 'flee' && dist <= HUNTER.catchDistance) { this._huntCaught(); return; }

    // --- what it is doing ----------------------------------------------------
    if (h.mode === 'approach') {
      // Slowly. It is not in a hurry yet, and it does not need to be.
      h.speed = HUNTER.approachSpeed * (1 + clamp((dist - HUNTER.catchUpFrom) / 14, 0, 0.9));
      h.reach += (0 - h.reach) * dt * 3;
      h.mouth += (0.28 - h.mouth) * dt * 2;
      if (h.t >= HUNTER.paceAfter) h.mode = 'pace';
    } else if (h.mode === 'pace') {
      // Exactly your speed — when it is near. Further out it is allowed to move
      // faster than you, because in a warren a pursuer at your nominal speed
      // loses ground continuously: it walks the corridors while you cut the
      // corner it is still going around. Without this it was a 2.5 u/s hunter
      // that fell steadily behind a 2.4 u/s walk and never arrived at all.
      h.speed = HUNTER.paceSpeed * (1 + clamp((dist - HUNTER.catchUpFrom) / 12, 0, HUNTER.catchUpMax));
      h.reach += (0.25 - h.reach) * dt * 2;
      h.mouth += (0.45 - h.mouth) * dt * 2;
      const canCharge = dist <= HUNTER.chargeFrom && !this._fogConceals() &&
        this._hasLineOfSight(h.x, h.y);
      if (h.chargeOmenAt && h.t >= h.chargeOmenAt) {
        h.chargeOmenAt = 0;
        if (canCharge) this._beginHunterWind(h);
        else h.nextChargeAt = h.t + 1.0; // the warning gave the player room
      } else if (!h.chargeOmenAt && canCharge && h.t >= h.nextChargeAt) {
        // When the anomaly slot is free, redshift buys a short, readable warning
        // before the wind-up. If another anomaly is already doing work, retain
        // the old immediate wind-up rather than letting the hunter stall.
        if (this._startAnomaly('redshift', 'charge')) {
          h.chargeOmenAt = h.t + ANOMALIES.redshift.chargeLead;
          h.nextChargeAt = h.chargeOmenAt;
        } else {
          this._beginHunterWind(h);
        }
      }
    } else if (h.mode === 'wind') {
      // It stops dead. Half a second of nothing, and then it is on you.
      h.speed = 0;
      h.reach += (1 - h.reach) * dt * 6;
      h.mouth += (1 - h.mouth) * dt * 8;
      if (h.t >= h.windUntil) { h.mode = 'charge'; h.chargeStart = h.t; }
    } else if (h.mode === 'charge') {
      h.speed = HUNTER.chargeSpeed;
      h.reach = 1; h.mouth = 1;
      if (dist <= HUNTER.catchDistance) { this._huntCaught(); return; }
      if (h.t - h.chargeStart > 3.6 || dist > 11) {
        h.mode = 'pace';
        h.nextChargeAt = h.t + HUNTER.chargeMinGap;
      }
    } else if (h.mode === 'flee') {
      h.speed = HUNTER.chargeSpeed * 0.7;
      h.reach += (0 - h.reach) * dt * 4;
      h.mouth += (0.6 - h.mouth) * dt * 3;
      if (dist > 20 || h.t - h.fleeStart > 6) { this._despawnHunter(); return; }
    }

    // --- move ----------------------------------------------------------------
    const step = h.speed * dt * (1 - h.stagger * 0.7);
    const wasX = h.x, wasY = h.y;
    if (h.mode === 'flee') this._creatureMove(h, h.x - dx, h.y - dy, step);
    else if (dist > 0.4) this._creatureMove(h, p.x, p.y, step);
    // How far it ACTUALLY got, which is not the same as how far it wanted to
    // go — a corner it is sliding along takes most of it. This drives the gait.
    const moved = Math.hypot(h.x - wasX, h.y - wasY);
    dx = p.x - h.x; dy = p.y - h.y;
    dist = Math.hypot(dx, dy);
    const face = h.mode === 'flee' ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
    h.yaw += wrapAngle(face - h.yaw) * Math.min(1, dt * 6);

    // --- twitch --------------------------------------------------------------
    // Three things happen here that did not before, all of them aimed at the
    // same problem: a fit that is one judder with one head-snap in it is a
    // canned animation, and you stop reading it as involuntary the second time
    // you see it.
    //
    //   * the head re-aims several times WITHIN a single fit, at a fifteenth of
    //     a second apart, so it checks two or three places that are not you
    //   * it snaps much further round — up to about seventy degrees off — and
    //     the return to facing you is slow, so between fits it spends whole
    //     seconds looking somewhere else while still walking straight at you
    //   * the whole thing accelerates hard with proximity, to the point that
    //     inside about four metres it is barely ever out of a fit
    if (h.t >= h.twitchAt) {
      h.twitchUntil = h.t + this._rand(HUNTER.twitchDur[0], HUNTER.twitchDur[1]);
      h.twitchAmp = this._rand(0.75, 1);
      h.snapTarget = (this.rng() - 0.5) * HUNTER.snapAmount;
      h.resnapAt = h.t + this._rand(0.05, 0.14);
      h.twitchAt = h.t + this._rand(HUNTER.twitchEvery[0], HUNTER.twitchEvery[1]) /
        (1 + clamp(1 - dist / 12, 0, 1) * 2.6);
    }
    if (h.t < h.twitchUntil) {
      h.twitch = h.twitchAmp;
      if (h.t >= h.resnapAt) {
        h.snapTarget = (this.rng() - 0.5) * HUNTER.snapAmount;
        h.resnapAt = h.t + this._rand(0.05, 0.16);
      }
      h.snap += (h.snapTarget - h.snap) * Math.min(1, dt * 48);
    } else {
      h.twitch = Math.max(0, h.twitch - dt * 6);
      h.snap += (0 - h.snap) * Math.min(1, dt * 1.5);
    }

    // --- animate + audio -----------------------------------------------------
    // The gait is a function of GROUND COVERED, not of elapsed time. The old
    // version advanced the legs on a clock while the body was moved separately,
    // so the feet slid along the floor and the whole thing read as a sprite on
    // rails — which is exactly what a two-and-a-half-metre spider must not read
    // as. Now a foot goes down where it goes down and stays there; walk it into
    // a wall and the legs stop, because it is not covering any ground.
    //
    // There is a trickle of idle phase on top so that standing still is a slow
    // shift of weight rather than a freeze-frame.
    h.phase += moved * HUNTER.strideRate + dt * 0.5;
    const stepIndex = Math.floor(h.phase / Math.PI);
    if (stepIndex !== h.lastStepPhase) {
      h.lastStepPhase = stepIndex;
      if (dist < HUNTER.stepDistance) {
        const rel = wrapAngle(bearing - p.angle);
        // Falls off much more slowly than the creature's step, so the first
        // thing you get is the sound of something enormous a long way off.
        const vol = clamp(0.75 / (1 + dist * 0.10), 0.06, 0.75);
        if (!this._isSilent()) this.audio.playHunterStep(clamp(Math.sin(rel), -1, 1), vol);
      }
    }

    const rel = wrapAngle(bearing - p.angle);
    const near = clamp(1 - dist / HUNTER.breathDistance, 0, 1);
    this.audio.setBreath(near * (h.mode === 'charge' ? 2 : 1.2), clamp(Math.sin(rel), -1, 1));
    this.audio.setHeartbeat(clamp(0.35 + near * 1.1, 0, 1));
    fx.stress = Math.max(fx.stress, near * (h.mode === 'charge' ? 1 : 0.6));
    fx.fogDensity *= 1 + near * 0.30;
    fx.ambient *= 1 - near * 0.30;
    if (h.mode === 'charge') { fx.shakeY += Math.sin(h.t * 40) * 1.6; }

    // --- lifetime ------------------------------------------------------------
    h.life -= dt;
    if (h.life <= 0 || dist > HUNTER.despawnDistance) { this._despawnHunter(); return; }

    fx.meshes.push({
      x: h.x, y: h.y,
      yaw: h.yaw,
      key: 'hunter',
      seed: 0x4b17,
      // Its eyes barely dim with range — they are what finds you first.
      emitFar: HUNTER.eyeFalloff,
      mesh: buildHunter({
        phase: h.phase,
        speed: clamp(h.speed / HUNTER.paceSpeed, 0, 1),
        lean: h.mode === 'charge' ? 0.22 : 0,
        reach: h.reach,
        mouth: h.mouth,
        stagger: h.stagger,
        turn: 0,
        twitch: h.twitch,
        twitchT: h.t * HUNTER.twitchRate,
        snap: h.snap,
        eyeGlow: h.mode === 'charge' ? 1.5 : h.mode === 'wind' ? 1.3 : 0.8,
        detail: dist < 7 ? 1 : 0,
      }),
    });
  }

  _beginHunterWind(h) {
    h.mode = 'wind';
    h.windUntil = h.t + HUNTER.chargeWindUp;
    if (!this._isSilent()) this.audio.playHunterCharge(0.8);
    this.shake = 0.35;
  }

  // It reached you. This is the end of the run — see JUMPSCARE.
  //
  // Which ending you get depends on the state of the magazine, because the
  // difference between being caught with rounds left and being caught having
  // fired all twelve is the only decision the second half of a session is
  // actually about.
  _huntCaught() {
    if (this.fatal) return;          // it cannot catch you twice
    this.hunter = null;
    this.hunterArrivesAt = 0;
    this.hunterArrivalSpot = null;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
    this.audio.playJumpscare();
    this.shake = 1;
    this.scareT = HUNTER.scareDuration;
    this.scareDur = HUNTER.scareDuration;
    this.fatal = true;
    this.ending = this.ammo > 0 ? 'taken' : 'spent';
    if (this.onCaught) this.onCaught();
  }

  // The face has finished. Nothing gets rebuilt, nothing gets rescheduled — the
  // director is done, and main.js takes it from here.
  _die() {
    this.creature = null;
    this.hunter = null;
    this.scareT = 0;
    this.scareDur = 0;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
    if (this.onDeath) this.onDeath(this.ending);
    this.onDeath = null;
  }

  _despawnHunter() {
    this.hunter = null;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
  }

  // --- flashlight failure ---------------------------------------------------

  _failFlashlight(extra = 0, immediate = false) {
    if (this.lightFail) return;
    // `immediate` skips the stutter and kills the beam on this frame, which is
    // what the creature vanishing needs: the dark has to arrive before you can
    // finish looking at it.
    const blackoutAt = immediate ? 0 : this._rand(0.55, 0.8);
    const blackoutDur = this._rand(0.42, 0.62) + extra;
    this.lightFail = {
      t: 0,
      dur: blackoutAt + blackoutDur + this._rand(0.55, 0.85),
      blinkAt: 0, blackoutAt, blackoutDur, mul: 1,
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
    } else if (lf.t < lf.blackoutAt) {
      if (lf.t >= lf.blinkAt) {
        // Three states, not two: mostly dark, occasionally a weak glow, and
        // now and then something close to full brightness that makes you think
        // it has come back. The gap to the next one is squared, so most are a
        // twitch and every so often the light holds long enough to move by.
        const r = this.rng();
        lf.mul = r > 0.86 ? this._rand(0.62, 0.95)
               : r > 0.48 ? this._rand(0.14, 0.44)
               : this._rand(0, 0.06);
        lf.blinkAt = lf.t + 0.018 + Math.pow(this.rng(), 2) * 0.46;
        if (this.rng() > 0.7) this.audio.flickerWhine(0.4);
      }
    } else {
      lf.mul += (1 - lf.mul) * Math.min(1, dt * 6);
    }
    if (lf.t >= lf.dur) { this.lightFail = null; return; }
    fx.beamIntensity = LIGHT.beamIntensity * lf.mul;
    fx.ambient = LIGHT.ambient * (lf.mul <= 0.001 ? 0.02 : 0.35 + 0.65 * lf.mul);
  }

  // ==========================================================================
  // Anomalies
  // ==========================================================================

  _anomalyTarget() {
    if (this.gunSite && !this.gunSite.pickedUp) {
      return { x: this.gunSite.x, y: this.gunSite.y, kind: 'gun' };
    }
    if (this.hunterArrivalSpot) {
      return { x: this.hunterArrivalSpot.x, y: this.hunterArrivalSpot.y, kind: 'arrival' };
    }
    if (this.hunter) return { x: this.hunter.x, y: this.hunter.y, kind: 'hunter' };
    if (this.pendingRitual) {
      return { x: this.pendingRitual.cx, y: this.pendingRitual.cy, kind: 'ritual' };
    }
    if (this.creature) return { x: this.creature.x, y: this.creature.y, kind: 'creature' };
    return null;
  }

  _crowdTarget() {
    if (this.gunSite && !this.gunSite.pickedUp) {
      return { x: this.gunSite.x, y: this.gunSite.y, kind: 'gun' };
    }
    if (this.pendingRitual) {
      return {
        x: this.pendingRitual.cx, y: this.pendingRitual.cy,
        kind: 'ritual', landmark: this.pendingRitual.name,
      };
    }

    // An unused gun anchor is also a walkable point inside a recognisable room.
    // Lead the player there and entering the block arms its own landmark event.
    const anchor = this.world.nearestAnchor(
      this.player.x, this.player.y, GUN.anchorRadius + 6, GUN_ANCHOR
    );
    if (!anchor) return null;
    const landmark = this.world.landmarkAt(anchor.cx, anchor.cy);
    if (!landmark) return null;
    const center = this.world.blockCenter(anchor.cx, anchor.cy);
    const key = `${Math.floor(center.x)},${Math.floor(center.y)}`;
    if (this.landmarksUsed.has(key)) return null;
    return {
      x: anchor.cx + 0.5, y: anchor.cy + 0.5,
      kind: 'ritual', landmark,
    };
  }

  _buildCrowdRoute(a, target) {
    const path = this._pathBetween(
      this.player.x, this.player.y, target.x, target.y, 4096
    );
    if (!path || path.length < 3) return false;

    a.target = target;
    a.route = path;
    a.figures = [];
    const last = Math.min(path.length - 1, 7);
    const joinIndex = Math.min(3, last);
    const joinSide = 1;

    for (let i = 1; i <= last; i++) {
      const prev = path[Math.max(0, i - 1)];
      const next = path[Math.min(path.length - 1, i + 1)];
      const tx = next.cx - prev.cx, ty = next.cy - prev.cy;
      const mag = Math.hypot(tx, ty) || 1;
      const ux = tx / mag, uy = ty / mag;
      const px = -uy, py = ux;
      const bx = path[i].cx + 0.5, by = path[i].cy + 0.5;
      const yaw = Math.atan2(uy, ux);

      for (const side of [-1, 1]) {
        const x = bx + px * side * 0.42;
        const y = by + py * side * 0.42;
        if (!this._openAt(x, y)) continue;
        if (!a.join && i >= joinIndex && side === joinSide) {
          // A literal missing member in one rank. Merely walking the centre
          // aisle is safe; taking this side position and holding it is not.
          a.join = {
            x, y, yaw,
            terminal: target.kind === 'ritual',
          };
          continue;
        }
        a.figures.push({ x, y, yaw });
      }
    }
    return a.figures.length >= 4;
  }

  _startAnomaly(forcedType = null, omen = null) {
    if (this.anomaly) return false;
    const guideTarget = this._anomalyTarget();
    const crowdTarget = forcedType == null || forcedType === 'crowd'
      ? this._crowdTarget() : null;
    if (forcedType === 'swarm' && !guideTarget) return false;
    if (forcedType === 'crowd' && !crowdTarget) return false;
    // Weighted pick among the ones dread has unlocked.
    // Redshift is deliberately absent: it is started by _updateOmenWatch or by
    // the hunter charge decision, never by a timer that has nothing to predict.
    const eligible = forcedType ? [forcedType] :
      ANOMALY_KEYS.filter((k) => k !== 'redshift' &&
        this.dread >= ANOMALIES[k].gate && ANOMALIES[k].weight > 0 &&
        (k !== 'swarm' || guideTarget) &&
        (k !== 'crowd' || crowdTarget));
    if (!eligible.length) return false;
    let total = 0;
    for (const k of eligible) total += ANOMALIES[k].weight;
    let type = forcedType || eligible[0];
    if (!forcedType) {
      let roll = this.rng() * total;
      for (const k of eligible) {
        roll -= ANOMALIES[k].weight;
        if (roll <= 0) { type = k; break; }
      }
    }

    const cfg = ANOMALIES[type];
    const a = { type, omen, t: 0, dur: this._rand(cfg.dur[0], cfg.dur[1]) };
    this.anomaly = a;

    switch (type) {
      case 'fog':
        this.audio.playDrone({ freq: this._rand(34, 46), dur: a.dur, volume: 0.16 });
        break;
      case 'silence':
        this.audio.duck(0.05, 0.5);
        this.audio.muffleFor(260, a.dur);
        break;
      case 'breathing':
        this.audio.playDrone({ freq: this._rand(26, 33), dur: a.dur, volume: 0.22 });
        break;
      case 'swarm': {
        // A billboard cannot visibly turn its head: every sprite always faces
        // the camera. Direction is therefore expressed as a wave. Eyes furthest
        // from the meaningful bearing open first; the wave ends on a larger pair
        // at the gun or the direction already reserved for the hunter.
        a.eyes = [];
        a.target = guideTarget;
        const p = this.player;
        const targetBearing = Math.atan2(guideTarget.y - p.y, guideTarget.x - p.x);
        const n = 10 + ((this.rng() * 8) | 0);
        for (let i = 0; i < n; i++) {
          for (let tries = 0; tries < 10; tries++) {
            const ang = this.rng() * Math.PI * 2;
            const d = this._rand(3.5, 14);
            const x = p.x + Math.cos(ang) * d;
            const y = p.y + Math.sin(ang) * d;
            if (!this._openAt(x, y) || !this._hasLineOfSight(x, y)) continue;
            const toward = 1 - Math.abs(wrapAngle(ang - targetBearing)) / Math.PI;
            a.eyes.push({
              x, y,
              delay: toward * 1.25 + this.rng() * 0.18,
              scale: this._rand(0.14, 0.28) * (0.86 + toward * 0.32),
              z: this._rand(0.30, 0.62),   // between waist and above head height
              startDist: d,
            });
            break;
          }
        }

        const targetDist = Math.hypot(guideTarget.x - p.x, guideTarget.y - p.y);
        let beaconX = guideTarget.x, beaconY = guideTarget.y;
        if (targetDist > 14 || !this._hasLineOfSight(beaconX, beaconY)) {
          const ray = Math.min(12.5, this._castDistance(p.x, p.y, targetBearing, 14) - 0.45);
          beaconX = p.x + Math.cos(targetBearing) * ray;
          beaconY = p.y + Math.sin(targetBearing) * ray;
        }
        const beaconDist = Math.hypot(beaconX - p.x, beaconY - p.y);
        if (beaconDist >= 2.2 && this._openAt(beaconX, beaconY)) {
          a.eyes.push({
            x: beaconX, y: beaconY, delay: 1.48, scale: 0.38, z: 0.62,
            startDist: beaconDist, beacon: true,
          });
        }
        this.audio.playDrone({ freq: 39, dur: a.dur, volume: 0.14 });
        this.audio.playWhisper({ pan: -0.7, volume: 0.10 });
        const rel = wrapAngle(targetBearing - p.angle);
        this.audio.playWhisper({ pan: clamp(Math.sin(rel), -1, 1), volume: 0.12 });
        break;
      }
      case 'redshift':
        this.audio.playDrone({ freq: this._rand(48, 58), dur: a.dur, volume: 0.20 });
        this.audio.setHeartbeat(0.8);
        break;
      case 'blackout':
        this.audio.playDrone({ freq: 30, dur: a.dur, volume: 0.18 });
        this.audio.muffleFor(500, a.dur * 0.7);
        break;
      case 'crowd': {
        // They are ranks, not scatter. Their empty centre follows a real route
        // toward the gun or an unused landmark, and every body faces down it.
        if (!this._buildCrowdRoute(a, crowdTarget)) {
          this.anomaly = null;
          return false;
        }
        this.audio.playDrone({ freq: 36, dur: a.dur, volume: 0.24 });
        this.audio.playDistantCall(0.26, 0);
        break;
      }
    }
    this.dread = Math.min(HORROR.dreadMax, this.dread + 0.02);
    return true;
  }

  _updateOmenWatch() {
    if (this.anomaly) return;
    const lead = ANOMALIES.redshift.lead;

    if (this.hunterArrivesAt &&
        this.hunterArrivesAt - this.now <= lead &&
        this.redshiftedArrivalAt !== this.hunterArrivesAt) {
      if (this._startAnomaly('redshift', 'arrival')) {
        this.redshiftedArrivalAt = this.hunterArrivesAt;
      }
      return;
    }

    const pending = this.pendingRitual;
    if (pending && !pending.redshifted &&
        pending.at - this.elapsed <= lead &&
        this.dread >= ANOMALIES.redshift.gate) {
      if (this._startAnomaly('redshift', 'ritual')) pending.redshifted = true;
    }
  }

  _updateAnomaly(dt, fx) {
    const a = this.anomaly;
    if (!a) return;
    a.t += dt;
    const k = a.t / a.dur;
    // While an anomaly is leaving through a stutter it is held near full rather
    // than allowed to fade — the whole point is that it is still completely
    // there right up until the light goes.
    const env = a.leaving ? 0.72 : Math.sin(Math.min(1, k) * Math.PI);
    const out = a.leaving ? 1 : 0;                    // override for the fades

    switch (a.type) {
      case 'fog':
        fx.fogDensity *= 1 + env * 1.6;
        fx.fogColor = [lerp(FOG.color[0], 14, env), lerp(FOG.color[1], 6, env), lerp(FOG.color[2], 6, env)];
        break;

      case 'silence':
        fx.fogDensity *= 1 + env * 1.1;
        break;

      case 'breathing': {
        // The corridor inhales. The FOV swells and contracts on a slow four
        // second cycle and the light dims on the out-breath.
        const breath = Math.sin(a.t * 1.55);
        fx.fovScale = 1 + breath * 0.13 * env;
        fx.ambient *= 1 + breath * 0.35 * env;
        fx.fogDensity *= 1 + (0.35 + breath * 0.3) * env;
        fx.shakeY += breath * 3.2 * env;
        break;
      }

      case 'swarm': {
        for (const e of a.eyes) {
          const t = a.t - e.delay;
          if (t < 0) continue;
          const fade = clamp(t / 0.7, 0, 1) * Math.max(out, clamp((a.dur - a.t) / 0.9, 0, 1));
          fx.entities.push({
            x: e.x, y: e.y, tex: 'redEyes',
            scale: e.scale * (e.beacon ? 1 + Math.sin(a.t * 5.2) * 0.06 : 1),
            alpha: fade * (e.beacon ? 1 : 0.9), glow: true, z: e.z,
          });
        }
        // Deliberately no extra fog here: the point of the anomaly is seeing
        // how many of them there are.
        fx.ambient *= 1 - env * 0.4;
        break;
      }

      case 'redshift':
        fx.grade = [1 + env * 0.55, 1 - env * 0.62, 1 - env * 0.66];
        fx.ambient *= 1 + env * 1.4;
        fx.fogColor = [lerp(FOG.color[0], 32, env), lerp(FOG.color[1], 3, env), lerp(FOG.color[2], 3, env)];
        fx.stress = Math.max(fx.stress, env * 0.7);
        break;

      case 'blackout': {
        // The torch does not flicker. It simply stops, and stays stopped.
        const off = clamp(a.t / 0.35, 0, 1) * clamp((a.dur - a.t) / 0.5, 0, 1);
        fx.beamIntensity *= 1 - off;
        fx.ambient *= 1 - off * 0.94;
        fx.fogDensity *= 1 + off * 0.5;
        // Two thirds of the way through, something arrives. When the light
        // catches again it is already there.
        if (!a.delivered && k > 0.62) {
          if (this.creature) {
            a.delivered = true;
          } else {
            // Far enough out that the returning beam finds it walking, rather
            // than finding it already on top of you — which was a jumpscare in
            // everything but name. It also has to clear CREATURE.vanishDistance
            // by a margin, or the light comes back on something that is already
            // close enough to leave again on the same frame.
            const spot = this._placeInSight(7.0, 9.5) || this._placeOutOfSight(7.0, 10.0);
            // _spawnCreature has its own valid fallback. The old code required
            // `spot` first and permanently marked the delivery complete even
            // when no spot was found, so some blackouts meant nothing at all.
            if (this._spawnCreature(true)) {
              if (spot) {
                this.creature.x = spot.x;
                this.creature.y = spot.y;
              }
              this.creature.mouth = 0.8;
              a.delivered = true;
            }
          }
        }
        break;
      }

      case 'crowd': {
        // Trying to pick a dozen unlit bodies out of exponential fog just reads
        // as nothing happening. So the ceiling panels come up instead — the only
        // time in the game the lights properly work — you see the corridor is
        // full, and then they go out again.
        const fade = clamp(a.t / 0.35, 0, 1) * Math.max(out, clamp((a.dur - a.t) / 0.35, 0, 1));
        for (const f of a.figures) {
          fx.meshes.push({
            x: f.x, y: f.y, yaw: f.yaw, key: 'crowd',
            mesh: this.crowdMesh, seed: 0x2b7, dim: 0.30 + fade * 0.70,
          });
        }
        fx.ambient = LIGHT.ambient * (1 + env * 9);
        fx.panelEmissive = env * 64;
        fx.fogDensity *= 1 - env * 0.45;
        fx.stress = Math.max(fx.stress, env * 0.5);

        // The aisle is guidance. The missing place beside it is a choice: enter
        // it, stop moving, and face the same way as the rank for long enough.
        // Requiring all three prevents a player following the route from earning
        // an ending they did not choose.
        if (a.join?.terminal) {
          const p = this.player;
          const inPlace = Math.hypot(p.x - a.join.x, p.y - a.join.y) < 0.48;
          const aligned = Math.abs(wrapAngle(p.angle - a.join.yaw)) < 0.52;
          if (inPlace && aligned && !p.moving) a.joinT = (a.joinT || 0) + dt;
          else a.joinT = Math.max(0, (a.joinT || 0) - dt * 2);
          if (a.joinT >= ANOMALIES.crowd.joinFor) {
            this._endCongregation();
            return;
          }
        }
        break;
      }
    }

    // The two that put THINGS in the corridor also leave the moment you close
    // on the nearest of them, for the same reason the single pair of eyes does:
    // a dozen shapes in the fog is the event, and a dozen shapes you can walk
    // up to and inspect is a diorama.
    if (!a.leaving && a.type === 'swarm') {
      const p = this.player;
      for (const e of a.eyes) {
        // Measure approach, not absolute range. The old fixed seven-unit test
        // deleted the event on its first frame whenever any randomly placed eye
        // happened to start closer than seven.
        const leaveAt = Math.max(1.2, e.startDist - KEEP_AWAY.swarm);
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < leaveAt * leaveAt) {
          a.t = a.dur;
          break;
        }
      }
    }
    if (!a.leaving && a.type === 'crowd') {
      const p = this.player;
      for (const f of a.figures) {
        if ((f.x - p.x) ** 2 + (f.y - p.y) ** 2 <
            KEEP_AWAY.crowd * KEEP_AWAY.crowd) {
          a.t = a.dur;
          break;
        }
      }
    }

    if (a.t >= a.dur && !a.leaving) {
      // The two that put THINGS in the corridor do not get to fade out. Every
      // one of them is at full strength on the last lit frame.
      if (a.type === 'swarm' || a.type === 'crowd') {
        a.leaving = true;
        this._startStutter(() => { this.anomaly = null; });
        return;
      }
      if (a.type === 'silence') this.audio.duck(0.7, 0.8);
      if (a.type === 'redshift') this.audio.setHeartbeat(0);
      if (a.type === 'blackout') this.audio.flickerWhine(0.8);
      this.anomaly = null;
    }
  }

  _endCongregation() {
    if (this.ending) return;
    this.ending = 'congregation';
    this.fatal = true;
    this.creature = null;
    this.hunter = null;
    this.hunterArrivesAt = 0;
    this.hunterArrivalSpot = null;
    this.audio.setBreath(0);
    this.audio.setHeartbeat(0);
    this.audio.playDistantCall(0.48, 0);
    this.audio.duck(0, 0.8);
    if (this.onDeath) this.onDeath(this.ending);
    this.onDeath = null;
  }

  // ==========================================================================
  // The gun
  // ==========================================================================

  // Fire one round. Returns true if a shot actually went off.
  shoot() {
    if (!this.hasGun || this.scareT > 0) return false;
    if (this.now < this.nextShotAt) return false;
    this.nextShotAt = this.now + GUN.fireInterval;

    if (this.ammo <= 0) {
      this.audio.playDryFire();
      return false;
    }

    this.ammo--;
    if (this.onAmmoChange) this.onAmmoChange(this.ammo);
    this._armHunt();
    this.audio.playGunshot();
    this.audio.playShellDrop(0.3);
    this.flashT = 0.075;
    this.shake = 0.85;
    this.dread = Math.min(HORROR.dreadMax, this.dread + 0.01);
    this._ejectShell();

    const p = this.player;
    const wall = this._castShot(GUN.range);

    // Did it hit something first? The hunter is checked first because it is the
    // one you are actually aiming at by the time you have both.
    for (const target of [this.hunter, this.creature]) {
      if (!target) continue;
      const dx = target.x - p.x, dy = target.y - p.y;
      const along = dx * p.dirX + dy * p.dirY;
      const perp = Math.abs(dx * -p.dirY + dy * p.dirX);
      if (along > 0.4 && along < wall.dist && perp <= GUN.hitRadius * (target === this.hunter ? 1.5 : 1)) {
        if (target === this.hunter) this._hitHunter(target);
        else this._hitCreature(target);
        return true;
      }
    }

    if (wall.hit) {
      this.audio.playBulletImpact(0, wall.dist);
      this._addHole(wall);
    }
    // A round that hit nothing is a round that told the building exactly where
    // you are standing. That is the real cost of the twelve.
    this._armNoiseReply();
    return true;
  }

  // Every shot, hit or miss, arms the hunt. You do not get to un-fire it.
  _armHunt() {
    if (this.hunted) return;
    this.hunted = true;
    // The first one comes soon, and from then on the creature event sends it.
    this.noiseQuietUntil = 0;
    this.noiseReplyAt = this.now + this._rand(NOISE.replyDelay[0], NOISE.replyDelay[1]);
  }

  // ==========================================================================
  // "It heard you"
  // ==========================================================================

  _armNoiseReply() {
    // Silence is a real window in the rules, not just a low-pass filter. The
    // first shot still arms the hunt in _armHunt, but misses made while the
    // building is silent cannot schedule another answer or hurry an existing
    // hunter into its next charge.
    if (this._isSilent()) return;
    if (this.noiseReplyAt || this.now < this.noiseQuietUntil) return;
    this.noiseQuietUntil = this.now + NOISE.cooldown;
    this.noiseReplyAt = this.now + this._rand(NOISE.replyDelay[0], NOISE.replyDelay[1]);
  }

  // A few seconds of nothing, then the answer. The gap is the point: long
  // enough that you have started to relax, short enough that you connect it to
  // what you just did.
  _noiseReply() {
    if (this.onLine) this.onLine(NOISE.lines[(this.rng() * NOISE.lines.length) | 0]);
    this.dread = Math.min(HORROR.dreadMax, this.dread + NOISE.dread);

    this.audio.playDistantCall(0.42 + this.dread * 0.24, this._rand(-0.85, 0.85));
    this.audio.playDrone({ freq: 31, dur: 5.5, volume: 0.20 });
    this.audio.setHeartbeat(0.75);

    // And then it starts walking. Once the hunt is on, it walks in where you
    // can see it instead — but not yet. The line you have just read is the
    // building telling you something is on its way; if the thing appears in the
    // same breath, the line was a label on it rather than a warning about it.
    // Four to seven seconds of corridor go past first, and the only thing
    // filling them is a set of footsteps you cannot place.
    if (this.hunted) {
      if (!this.hunter) {
        if (!this.hunterArrivesAt) {
          // Reserve the direction before the wait begins. Swarm and redshift can
          // now tell the truth about where the arrival will happen, and the
          // hunter uses the same point when the timer expires.
          this.hunterArrivalSpot =
            this._placeInSight(NOISE.approachFrom, NOISE.approachTo) ||
            this._placeOutOfSight(NOISE.approachFrom, NOISE.approachTo) ||
            this._placeReachable(NOISE.approachFrom, NOISE.approachTo);
          this.hunterArrivesAt = this.now + this._rand(NOISE.arriveAfter[0], NOISE.arriveAfter[1]);
        }
      } else {
        this.hunter.nextChargeAt = Math.min(this.hunter.nextChargeAt, this.hunter.t + 1.5);
      }
      this.next.phantomSteps = Math.min(this.next.phantomSteps || Infinity, this.now + 1.6);
      return;
    }
    if (!this.creature) {
      const spot = this._placeOutOfSight(NOISE.approachFrom, NOISE.approachTo);
      if (spot && this._spawnCreature(true)) {
        this.creature.x = spot.x;
        this.creature.y = spot.y;
        this.creature.mouth = 0.4;
      } else {
        this._spawnCreature(true);
      }
    } else {
      // Already out there — it stops waiting.
      this.creature.nextChargeRoll = this.creature.t;
      this.creature.life = Math.max(this.creature.life, 20);
    }
    this.next.phantomSteps = Math.min(this.next.phantomSteps || Infinity, this.now + 1.6);
  }

  _hitCreature(c) {
    c.hp--;
    c.stagger = 1;
    this.audio.playCreatureHit(0);
    // Knocked back along the shot line.
    const p = this.player;
    const nx = c.x + p.dirX * CREATURE.hitKnockback;
    const ny = c.y + p.dirY * CREATURE.hitKnockback;
    if (this._openAt(nx, ny)) { c.x = nx; c.y = ny; }

    if (c.hp <= 0) {
      c.mode = 'flee';
      c.fleeStart = c.t;
      this.audio.playVanish(0.6, 0);
      this.dread = Math.max(0, this.dread - 0.08);
    } else if (c.mode === 'charge') {
      // A hit mid-charge breaks it off, which is the whole reason to keep rounds.
      c.mode = 'stalk';
      c.nextChargeRoll = c.t + CREATURE.chargeRollEvery * 2;
    }
  }

  // Shooting it works, but it takes four and it does not run far. Breaking a
  // charge with a round is the only thing that reliably saves you.
  _hitHunter(h) {
    h.hp--;
    h.stagger = 1;
    this.audio.playCreatureHit(0);
    const p = this.player;
    const nx = h.x + p.dirX * HUNTER.hitKnockback;
    const ny = h.y + p.dirY * HUNTER.hitKnockback;
    if (this._openAt(nx, ny)) { h.x = nx; h.y = ny; }

    if (h.hp <= 0) {
      h.mode = 'flee';
      h.fleeStart = h.t;
      this.audio.playVanish(0.7, 0);
      this.dread = Math.max(0, this.dread - 0.10);
    } else if (h.mode === 'charge' || h.mode === 'wind') {
      h.mode = 'pace';
      h.nextChargeAt = h.t + HUNTER.chargeMinGap;
    }
  }

  // DDA along the exact view direction. Returns the impact point and the yaw of
  // the wall's outward normal, so a decal can be aimed out of the surface.
  _castShot(maxDist) {
    const p = this.player;
    const rdx = p.dirX, rdy = p.dirY;
    let mapX = Math.floor(p.x), mapY = Math.floor(p.y);
    const deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    const deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    let stepX, stepY, sideDistX, sideDistY;
    if (rdx < 0) { stepX = -1; sideDistX = (p.x - mapX) * deltaX; }
    else { stepX = 1; sideDistX = (mapX + 1 - p.x) * deltaX; }
    if (rdy < 0) { stepY = -1; sideDistY = (p.y - mapY) * deltaY; }
    else { stepY = 1; sideDistY = (mapY + 1 - p.y) * deltaY; }

    let side = 0;
    for (let i = 0; i < 128; i++) {
      if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
      else { sideDistY += deltaY; mapY += stepY; side = 1; }
      if (this.world.isWall(mapX, mapY)) {
        const dist = side === 0
          ? (mapX - p.x + (1 - stepX) / 2) / rdx
          : (mapY - p.y + (1 - stepY) / 2) / rdy;
        if (dist > maxDist) break;
        // Height of the impact, derived the same way the renderer derives the
        // world height of a screen row — so the hole lands where you aimed.
        const z = clamp(0.5 + p.pitch * dist / RENDER.height, 0.04, 0.96);
        const normalYaw = side === 0
          ? (stepX > 0 ? Math.PI : 0)
          : (stepY > 0 ? -Math.PI / 2 : Math.PI / 2);
        return {
          hit: true, dist,
          x: p.x + rdx * dist + Math.cos(normalYaw) * 0.014,
          y: p.y + rdy * dist + Math.sin(normalYaw) * 0.014,
          z, yaw: normalYaw,
        };
      }
    }
    return { hit: false, dist: maxDist };
  }

  _addHole(wall) {
    this.holes.push({
      x: wall.x, y: wall.y, z: wall.z, yaw: wall.yaw,
      key: 'bulletHole', scale: 1,
      seed: (this.rng() * 0xffffffff) >>> 0,
    });
    if (this.holes.length > GUN.maxHoles) this.holes.shift();
  }

  // Brass out of the ejection port, with just enough physics to bounce once.
  _ejectShell() {
    const p = this.player;
    const right = p.angle + Math.PI / 2;
    const up = 2.0 + this.rng() * 0.8;
    this.shells.push({
      x: p.x + Math.cos(right) * 0.12 + p.dirX * 0.2,
      y: p.y + Math.sin(right) * 0.12 + p.dirY * 0.2,
      z: 0.42,
      vx: Math.cos(right + this._rand(-0.4, 0.4)) * 1.5,
      vy: Math.sin(right + this._rand(-0.4, 0.4)) * 1.5,
      vz: up,
      yaw: this.rng() * Math.PI * 2,
      spin: this._rand(-14, 14),
      rest: false,
      key: 'shell', scale: 1,
      seed: (this.rng() * 0xffffffff) >>> 0,
    });
    if (this.shells.length > GUN.maxShells) this.shells.shift();
  }

  _updateShells(dt) {
    for (const s of this.shells) {
      if (s.rest) continue;
      s.vz -= 9.0 * dt;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
      if (this._openAt(nx, ny)) { s.x = nx; s.y = ny; } else { s.vx *= -0.4; s.vy *= -0.4; }
      s.z += s.vz * dt;
      s.yaw += s.spin * dt;
      if (s.z <= 0.004) {
        s.z = 0.004;
        if (Math.abs(s.vz) < 0.7) { s.rest = true; s.spin = 0; s.vx = 0; s.vy = 0; }
        else { s.vz *= -0.35; s.vx *= 0.5; s.vy *= 0.5; s.spin *= 0.4; }
      }
    }
  }

  _updateGun(fx, time, dt) {
    this._trySpawnGun();
    this._updateShells(dt);

    // Holes and brass accumulate for a whole session, so only submit the ones
    // near enough to be worth transforming — the fog has eaten the rest.
    const px = this.player.x, py = this.player.y, near2 = 12 * 12;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      if ((h.x - px) ** 2 + (h.y - py) ** 2 < near2) fx.meshes.push(h);
    }
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if ((s.x - px) ** 2 + (s.y - py) ** 2 < near2) fx.meshes.push(s);
    }

    const site = this.gunSite;
    if (!site) return;

    const dist = Math.hypot(site.x - this.player.x, site.y - this.player.y);
    const age = this.elapsed - site.spawnedAt;

    // A player who has made measurable progress has understood the clue. Taking
    // the gun away after that would turn a discovery into a timer they were
    // never told about, so a committed site no longer expires.
    site.closestDist = Math.min(site.closestDist, dist);
    if (!site.committed && site.initialDist - site.closestDist >= GUN.progressLock) {
      site.committed = true;
    }

    // The second layer is visual and still requires the player to search: once
    // the torch crosses the weapon's direction, the metal catches for less than
    // a second. It is a glint in the world, not an arrow over it.
    if (!site.glinted && age >= GUN.glintAfter && this.player.flashlight &&
        this._isFacingPoint(site.x, site.y, 0.48)) {
      site.glinted = true;
      site.glintUntil = this.elapsed + GUN.glintFor;
      this.audio.flickerWhine(0.18);
    }

    // If the clinks were not enough, footsteps begin behind the player, cross
    // their position, and stop at the gun. They wait for an unrelated phantom
    // to finish instead of replacing it halfway through a step.
    if (!site.footstepsUsed && age >= GUN.footstepsAfter && !this.phantom) {
      const dx = site.x - this.player.x, dy = site.y - this.player.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const cross = (this.rng() - 0.5) * 0.8;
      site.footstepsUsed = true;
      this.phantom = {
        mode: 'gunGuide',
        srcX: this.player.x - ux * 2.4 - uy * cross,
        srcY: this.player.y - uy * 2.4 + ux * cross,
        targetX: site.x,
        targetY: site.y,
        step: 0.58,
        stepsLeft: Math.ceil((d + 2.4) / 0.58) + 2,
        nextStep: time + 0.2,
      };
    }

    // It keeps announcing itself. You cannot watch it arrive, so the clink is
    // the only way you learn it is there, and once is easy to miss — but each
    // repeat waits longer than the last, and it goes quiet entirely once you
    // have walked out of earshot, so it stays a hint rather than a metronome.
    if (!site.pickedUp && this.elapsed >= site.nextCue && dist < 20) {
      site.cues = (site.cues || 0) + 1;
      site.nextCue = this.elapsed + Math.min(18, GUN.cueEvery * (1 + site.cues * GUN.cueGrowth));
      const rel = wrapAngle(Math.atan2(site.y - this.player.y, site.x - this.player.x) - this.player.angle);
      this.audio.playShellDrop(clamp(Math.sin(rel), -1, 1));
    }

    if (!site.pickedUp && dist <= GUN.proximity) {
      site.pickedUp = true;
      this.hasGun = true;
      this.next.phantomSteps = Math.min(this.next.phantomSteps || Infinity, time + 2.5);
      if (this.onGunPickup) this.onGunPickup(site);
    }

    if (!site.pickedUp && !site.committed && age > GUN.visibleFor) {
      this.gunSite = null;
      this.nextGunTryAt = this.elapsed + GUN.respawnAfter;
      return;
    }

    fx.meshes.push({
      x: site.x, y: site.y, yaw: site.yaw + 0.25,
      key: 'bloodPool', seed: site.seed ^ 0xb10d,
    });
    if (!site.pickedUp) {
      fx.meshes.push({
        x: site.x, y: site.y, yaw: site.yaw,
        key: 'gunPickup', scale: GUN.pickupScale,
        dim: this.elapsed < site.glintUntil ? 3.4 : 1,
        seed: site.seed ^ 0x6d2b79f5,
      });
    }
    if (!site.pickedUp && age >= GUN.trailAfter) {
      for (const drop of site.trail) fx.meshes.push(drop);
    }
  }

  _trySpawnGun(force = false) {
    if (!force && (this.gunSite || this.hasGun || this.elapsed < this.nextGunTryAt)) return false;
    if (force) this.gunSite = null;

    const p = this.player;
    // Patience runs out. Being out of your view cone is what makes finding it a
    // discovery rather than a handout, but after a few sites you have missed it
    // is just the game hiding the only object that matters, so from then on it
    // will happily turn up in front of you.
    const patient = this.gunPlacements < GUN.patienceRuns;
    const behind = (cx, cy) => !patient ||
      Math.abs(wrapAngle(Math.atan2(cy + 0.5 - p.y, cx + 0.5 - p.x) - p.angle)) >= GUN.spawnBehind;
    let best = null;

    // First choice is always a landmark that has marked the spot. A gun on the
    // floor of the ward, or on the chapel plinth, is somewhere you can find
    // again and somewhere you will remember finding — which is worth far more
    // than the couple of metres of extra walking it costs.
    const anchor = this.world.nearestAnchor(p.x, p.y, GUN.anchorRadius, GUN_ANCHOR);
    if (anchor && this._canPlaceGun(anchor.cx, anchor.cy) && behind(anchor.cx, anchor.cy)) {
      best = { ...anchor, landmark: this.world.landmarkAt(anchor.cx, anchor.cy) };
    }

    // Otherwise: behind you. Watching a pistol appear on the carpet ten metres
    // ahead is a spawn; turning round and finding one you walked straight past
    // is a discovery. Once patience has run out the order reverses and it goes
    // out in front, where you cannot fail to walk into it.
    const offsets = patient
      ? [Math.PI, -Math.PI * 0.80, Math.PI * 0.80,
         -Math.PI * 0.62, Math.PI * 0.62, -Math.PI * 0.46, Math.PI * 0.46]
      : [0, -0.34, 0.34, -0.7, 0.7, Math.PI, -Math.PI * 0.7, Math.PI * 0.7];
    for (const off of offsets) {
      for (let i = 0; i < 8 && !best; i++) {
        const ang = p.angle + off + this._rand(-0.2, 0.2);
        const dist = this._rand(GUN.spawnMin, GUN.spawnMax);
        const cx = Math.floor(p.x + Math.cos(ang) * dist);
        const cy = Math.floor(p.y + Math.sin(ang) * dist);
        if (this._canPlaceGun(cx, cy) && behind(cx, cy)) best = { cx, cy };
      }
    }

    // Ring search, still preferring anything out of the view cone.
    if (!best) {
      const px = Math.floor(p.x), py = Math.floor(p.y);
      let fallback = null;
      for (let r = 4; r <= 12 && !best; r++) {
        for (let y = -r; y <= r && !best; y++) {
          for (let x = -r; x <= r; x++) {
            if (Math.abs(x) !== r && Math.abs(y) !== r) continue;
            const cx = px + x, cy = py + y;
            if (!this._canPlaceGun(cx, cy)) continue;
            if (behind(cx, cy)) { best = { cx, cy }; break; }
            if (!fallback) fallback = { cx, cy };
          }
        }
      }
      best = best || fallback;
    }

    if (!best) {
      if (!force) this.nextGunTryAt = this.elapsed + 2;
      return false;
    }
    const seed = (this.rng() * 0xffffffff) >>> 0;
    const x = best.cx + 0.5 + this._rand(-0.12, 0.12);
    const y = best.cy + 0.5 + this._rand(-0.12, 0.12);
    const initialDist = Math.hypot(x - p.x, y - p.y);
    const path = this._pathBetween(p.x, p.y, x, y) || [];
    const trail = [];
    const firstDrop = Math.max(1, path.length - 6);
    for (let i = firstDrop; i < path.length - 1; i++) {
      if ((i - firstDrop) % 2 && i !== path.length - 2) continue;
      const cell = path[i];
      trail.push({
        x: cell.cx + 0.5 + this._rand(-0.22, 0.22),
        y: cell.cy + 0.5 + this._rand(-0.22, 0.22),
        yaw: this._rand(0, Math.PI * 2),
        key: 'bloodSmall',
        scale: this._rand(0.28, 0.52),
        seed: seed ^ (i * 0x9e3779b1),
      });
    }
    this.gunPlacements++;
    this.gunSite = {
      x, y,
      yaw: this._rand(0, Math.PI * 2),
      seed,
      spawnedAt: this.elapsed,
      nextCue: this.elapsed + GUN.cueEvery,
      pickedUp: false,
      initialDist,
      closestDist: initialDist,
      committed: false,
      glintUntil: 0,
      trail,
      landmark: best.landmark || null,
    };
    // Since you cannot see it land, you get to hear it: metal on carpet, panned
    // to where it is. That is the whole invitation to turn around.
    const rel = wrapAngle(Math.atan2(this.gunSite.y - p.y, this.gunSite.x - p.x) - p.angle);
    const pan = clamp(Math.sin(rel), -1, 1);
    this.audio.playShellDrop(pan);
    this.audio.quietBeat({ target: 0.19, attack: 0.16, hold: 1.15, release: 1.5 });
    this._playGunLandmarkCue(this.gunSite, pan);
    return true;
  }

  _playGunLandmarkCue(site, pan) {
    switch (site.landmark) {
      case 'ward':
        this.audio.playDistantBang(pan);
        break;
      case 'atrium':
        this.audio.playDrone({ freq: 43, dur: 2.6, volume: 0.11 });
        break;
      case 'shaft':
        this.audio.playPitDraft(pan, 0.22);
        break;
      case 'combs':
        this.audio.playWhisper({ pan: clamp(pan - 0.2, -1, 1), volume: 0.07 });
        this.audio.playWhisper({ pan: clamp(pan + 0.2, -1, 1), volume: 0.07 });
        break;
      case 'chapel':
        this.audio.playDistantCall(0.28, pan);
        break;
    }
  }

  _canPlaceGun(cx, cy) {
    if (this.world.blocked(cx, cy)) return false;
    if (Math.hypot(cx + 0.5 - this.player.x, cy + 0.5 - this.player.y) < 2.6) return false;
    // Two open neighbours, not four. Requiring an open cross meant the gun could
    // never appear anywhere in a one-wide corridor, which since the map rework
    // is most of the building.
    let open = 0;
    if (!this.world.blocked(cx + 1, cy)) open++;
    if (!this.world.blocked(cx - 1, cy)) open++;
    if (!this.world.blocked(cx, cy + 1)) open++;
    if (!this.world.blocked(cx, cy - 1)) open++;
    return open >= 2;
  }
}
