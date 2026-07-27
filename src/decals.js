// decals.js — procedurally-generated blood for walls.
//
// The old version had one generator: N round splats near the top of the wall,
// each with a couple of straight drips. Every bloody wall in the game therefore
// looked like the same wall, and the blood sat at 2.5 m — above head height,
// where blood does not come from.
//
// This version builds from ARCHETYPES, each of which describes a different
// event, placed at the height that event actually happens:
//
//   impact      a body or a head hit the wall here            (0.6 - 1.8 m)
//   spray       arterial cast-off, a directional fan          (1.2 - 2.6 m)
//   drag        something was pulled along the wall           (0.8 - 1.6 m)
//   handprints  someone held on, then slid                    (0.9 - 1.7 m)
//   soak        it ran down from above and pooled at the base (2.0 m -> floor)
//   tally       someone counted. The last group is crossed out. (1.1 - 1.4 m)
//
// Colour is thickness-driven: thin edges dry dark and brown (the coffee-ring the
// real thing leaves), thick centres stay deep red, and a per-decal `age` pushes
// the whole thing from fresh to old. Resolution is 128 against the walls' 64, so
// the detail survives being right up against it.

import { makeRng, hash2, packRGBA, clamp } from './mathutils.js';
import { DECALS } from './config.js';

const DS = DECALS.size;            // decal resolution (128)
const WALL_M = 3.0;                // a wall is one unit == three metres tall

// Texture v for a height in metres (v = 0 is the top of the wall).
const at = (m) => (1 - m / WALL_M) * DS;

// Each decal is a 128x128 Uint32Array — 64 KB — and one is generated the first
// time you look at any bloody wall face. Cached forever, a long session that
// covers ground steadily works its way into hundreds of megabytes; the map is
// infinite, so there is no natural end to it. Bounded, with the oldest evicted
// first: a wall you walked away from twenty minutes ago can afford to be
// regenerated, and generation is deterministic so it comes back identical.
const MAX_CACHED = 220;

export class BloodDecals {
  constructor() { this.cache = new Map(); }

  // `style` is { kind, age } when the wall belongs to a room that was built on
  // purpose and therefore knows what happened against it — see
  // world.bloodWallStyle. Null everywhere else, which rolls from the weights
  // below exactly as it always did.
  get(cx, cy, face = 0, style = null) {
    const key = cx + ',' + cy + ',' + face;
    let d = this.cache.get(key);
    if (!d) {
      d = this._make(cx, cy, face, style);
      if (this.cache.size >= MAX_CACHED) {
        // Map iterates in insertion order, so the first key is the oldest.
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(key, d);
    }
    return d;
  }

  // --- field primitives -----------------------------------------------------
  // Everything writes into a Float32 "wetness" field first; colour is resolved
  // once at the end so overlapping marks merge like liquid instead of stacking
  // like decals.

  _put(field, x, y, a) {
    if (a <= 0) return;
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= DS || yi >= DS) return;
    const i = yi * DS + xi;
    if (a > field[i]) field[i] = a > 1 ? 1 : a;
  }

  // Irregular blob — radius modulated per angle so no two read as circles.
  _blob(field, cx, cy, rad, strength, rng) {
    const wob = [];
    for (let i = 0; i < 8; i++) wob.push(0.62 + rng() * 0.62);
    const r = Math.ceil(rad * 1.35);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y);
        if (d > rad * 1.35) continue;
        const ang = Math.atan2(y, x) + Math.PI;
        const k = ang / (Math.PI * 2) * 8;
        const i0 = k | 0, t = k - i0;
        const wr = rad * (wob[i0 % 8] * (1 - t) + wob[(i0 + 1) % 8] * t);
        if (d > wr) continue;
        const a = strength * (1 - (d / wr) ** 2) ** 0.7;
        this._put(field, cx + x, cy + y, a);
      }
    }
  }

  // An elongated droplet, aimed along `ang`. Real spatter droplets are teardrops
  // pointing in the direction of travel.
  _droplet(field, cx, cy, len, wid, ang, strength) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const r = Math.ceil(Math.max(len, wid) + 1);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const u = x * ca + y * sa;         // along
        const v = -x * sa + y * ca;        // across
        const taper = u > 0 ? 1 - u / (len * 1.6) : 1;
        if (taper <= 0) continue;
        const w = wid * clamp(taper, 0.15, 1);
        const d = (u / len) ** 2 + (v / w) ** 2;
        if (d > 1) continue;
        this._put(field, cx + x, cy + y, strength * (1 - d) ** 0.6);
      }
    }
  }

  // A run of blood heading down under gravity, with a heavier bead at the tip.
  _drip(field, x0, y0, len, wid, strength, rng) {
    const drift = (rng() - 0.5) * 0.35;
    let x = x0;
    for (let i = 0; i < len; i++) {
      const y = y0 + i;
      if (y >= DS) break;
      x += drift + Math.sin(i * 0.16) * 0.22;
      const t = i / len;
      const w = wid * (1 - t * 0.55);
      const a = strength * (1 - t * 0.5);
      for (let dx = -w; dx <= w; dx++) {
        this._put(field, x + dx, y, a * (1 - Math.abs(dx) / (w + 0.8)));
      }
    }
    // Bead at the end where it stopped running and dried.
    this._blob(field, x, Math.min(DS - 1, y0 + len), wid * 1.5, strength * 0.95, rng);
  }

  // A smear stroke — the mark something leaves being dragged.
  _stroke(field, x0, y0, x1, y1, wid, strength, rng) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      // Strokes thin out and break up as the source runs dry.
      const dry = 1 - t * 0.65;
      const w = wid * dry * (0.7 + 0.3 * Math.sin(i * 0.3));
      for (let dy = -w; dy <= w; dy++) {
        for (let dx = -w * 0.5; dx <= w * 0.5; dx++) {
          const f = 1 - Math.hypot(dx * 2, dy) / (w + 0.6);
          if (f <= 0) continue;
          const gap = hash2((x + dx) | 0, ((y + dy) * 3) | 0);
          this._put(field, x + dx, y + dy, strength * dry * f * (gap > 0.24 ? 1 : 0.25));
        }
      }
    }
  }

  // A hand: palm plus four fingers and a thumb. ~20 cm across, so about 8 px —
  // small, but unmistakable when you are standing right next to it.
  _hand(field, cx, cy, s, ang, strength, rng) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const local = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
    const [px, py] = local(0, 0);
    this._blob(field, px, py, 2.6 * s, strength, rng);
    for (let i = 0; i < 4; i++) {
      const spread = (i - 1.5) * 1.35 * s;
      const len = (3.4 - Math.abs(i - 1.2) * 0.55) * s;
      const [fx, fy] = local(spread, -2.4 * s - len * 0.5);
      this._droplet(field, fx, fy, len, 0.9 * s, -Math.PI / 2 + ang, strength * 0.92);
    }
    const [tx, ty] = local(-3.4 * s, 0.4 * s);
    this._droplet(field, tx, ty, 2.6 * s, 1.0 * s, Math.PI + ang, strength * 0.9);
  }

  // --- archetypes -----------------------------------------------------------

  _impact(field, rng) {
    const cx = DS * (0.25 + rng() * 0.5);
    const cy = at(0.6 + rng() * 1.2);
    this._blob(field, cx, cy, DS * (0.055 + rng() * 0.05), 1, rng);
    // Radial spatter: dense near the impact, sparse and fine further out.
    const n = 40 + ((rng() * 50) | 0);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const d = DS * (0.05 + rng() * rng() * 0.34);
      const sz = clamp(3.2 - d / DS * 7, 0.5, 3.4) * (0.5 + rng());
      this._droplet(field, cx + Math.cos(a) * d, cy + Math.sin(a) * d, sz * 1.7, sz * 0.7, a, 0.55 + rng() * 0.45);
    }
    const drips = 2 + ((rng() * 4) | 0);
    for (let i = 0; i < drips; i++) {
      this._drip(field, cx + (rng() - 0.5) * DS * 0.12, cy + DS * 0.03,
        DS * (0.10 + rng() * 0.34), 1.2 + rng() * 1.4, 0.85, rng);
    }
  }

  _spray(field, rng) {
    // A cast-off fan: one swing of something wet, thrown across the wall.
    const ox = DS * (rng() < 0.5 ? -0.05 : 1.05);
    const oy = at(0.9 + rng() * 0.8);
    const aim = Math.atan2(at(1.8 + rng() * 0.8) - oy, DS * 0.5 - ox);
    const spread = 0.30 + rng() * 0.24;
    const n = 70 + ((rng() * 60) | 0);
    for (let i = 0; i < n; i++) {
      const a = aim + (rng() - 0.5) * spread;
      const d = DS * (0.15 + rng() * 0.85);
      const x = ox + Math.cos(a) * d, y = oy + Math.sin(a) * d;
      if (x < -8 || x > DS + 8 || y < -8 || y > DS + 8) continue;
      const sz = (0.6 + rng() * 2.3) * (1 - d / (DS * 1.3));
      this._droplet(field, x, y, sz * 2.6, sz * 0.85, a, 0.5 + rng() * 0.5);
      if (rng() > 0.88) this._drip(field, x, y, DS * (0.04 + rng() * 0.12), 0.9, 0.6, rng);
    }
  }

  _drag(field, rng) {
    const y = at(0.8 + rng() * 0.8);
    const dir = rng() < 0.5 ? 1 : -1;
    const x0 = dir > 0 ? DS * 0.04 : DS * 0.96;
    const x1 = dir > 0 ? DS * (0.55 + rng() * 0.45) : DS * (0.45 * rng());
    // Four finger-width channels — a hand that did not let go for a while.
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 2.6;
      this._stroke(field, x0, y + off, x1, y + off + (rng() - 0.5) * 5, 1.5, 0.9, rng);
    }
    this._stroke(field, x0, y, x1, y + 3, 4.5, 0.55, rng);
    this._blob(field, x0, y, 5 + rng() * 4, 0.95, rng);
    const drips = 3 + ((rng() * 4) | 0);
    for (let i = 0; i < drips; i++) {
      const t = rng();
      this._drip(field, x0 + (x1 - x0) * t, y + 3, DS * (0.05 + rng() * 0.2), 1.1, 0.7, rng);
    }
  }

  _handprints(field, rng) {
    const n = 1 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const hx = DS * (0.18 + rng() * 0.64);
      const hy = at(0.95 + rng() * 0.75);
      const s = 1.5 + rng() * 0.7;
      this._hand(field, hx, hy, s, (rng() - 0.5) * 0.8, 0.85 + rng() * 0.15, rng);
      // They slid. That is what the streak underneath is.
      if (rng() > 0.35) {
        for (let k = 0; k < 4; k++) {
          const off = (k - 1.5) * 1.4 * s;
          this._stroke(field, hx + off, hy + 3 * s, hx + off + (rng() - 0.5) * 4,
            hy + DS * (0.08 + rng() * 0.2), 1.3 * s, 0.72, rng);
        }
      }
    }
  }

  _soak(field, rng) {
    // It came from above and ran all the way to the baseboard.
    const cx = DS * (0.15 + rng() * 0.7);
    const w = DS * (0.10 + rng() * 0.16);
    this._blob(field, cx, at(2.4 + rng() * 0.4), w, 1, rng);
    const runs = 5 + ((rng() * 7) | 0);
    for (let i = 0; i < runs; i++) {
      const x = cx + (rng() - 0.5) * w * 2.4;
      const y0 = at(2.2 + rng() * 0.5);
      this._drip(field, x, y0, DS - y0 - rng() * DS * 0.12, 1.0 + rng() * 2.2, 0.9, rng);
    }
    // Pooling where it hit the baseboard and stopped.
    this._blob(field, cx + (rng() - 0.5) * 8, DS - 5, w * 1.5, 0.95, rng);
    this._stroke(field, cx - w, DS - 4, cx + w, DS - 3, 4, 0.8, rng);
  }

  _tally(field, rng) {
    // Someone kept count in here. The last group is crossed through.
    const groups = 3 + ((rng() * 5) | 0);
    const y = at(1.15 + rng() * 0.3);
    const h = 11 + rng() * 5;
    let x = DS * (0.12 + rng() * 0.2);
    for (let g = 0; g < groups; g++) {
      for (let i = 0; i < 4; i++) {
        this._stroke(field, x + i * 3.2, y, x + i * 3.2 + (rng() - 0.5) * 2, y + h, 1.0, 0.85, rng);
      }
      // The fifth stroke goes diagonally across the other four.
      this._stroke(field, x - 1.5, y + h * 0.85, x + 12, y + h * 0.15, 1.0, 0.85, rng);
      x += 19 + rng() * 4;
      if (x > DS - 24) break;
    }
    if (rng() > 0.5) {
      this._stroke(field, DS * 0.1, y - 4, x, y + h + 4, 2.2, 0.6, rng);
    }
  }

  // --- assembly -------------------------------------------------------------

  _make(cx, cy, face, style = null) {
    const seed = (((hash2(cx * 131 + cy * 53, cy * 97 + cx * 29) * 4294967296) >>> 0) ^
      0x9e3779b9 ^ Math.imul(face + 1, 0x85ebca6b)) >>> 0;
    const rng = makeRng(seed);

    const field = new Float32Array(DS * DS);
    const kinds = ['impact', 'spray', 'drag', 'handprints', 'soak', 'tally'];
    // Weighted so the mundane ones dominate and a tally wall is a real find.
    // A landmark does not roll: its walls record the one event that room was
    // for, which is what makes a tally mean "the chapel" rather than "a wall".
    const weights = [5, 4, 4, 4, 3, 1];
    let total = 0; for (const w of weights) total += w;
    let roll = rng() * total, pick = 0;
    while (roll > weights[pick]) { roll -= weights[pick]; pick++; }
    const kind = style && kinds.includes(style.kind) ? style.kind : kinds[pick];

    ({
      impact: () => this._impact(field, rng),
      spray: () => this._spray(field, rng),
      drag: () => this._drag(field, rng),
      handprints: () => this._handprints(field, rng),
      soak: () => this._soak(field, rng),
      tally: () => this._tally(field, rng),
    })[kind]();

    // A second, older event on the same wall — layering is what makes a place
    // feel used rather than dressed. A landmark layers its own kind under
    // itself: a ward wall that was held on to twice is a ward wall, and one that
    // was held on to and then also sprayed is a wall in a game about nothing in
    // particular.
    if (rng() > 0.62) {
      const second = style ? kind : kinds[(rng() * 5) | 0];
      const old = new Float32Array(DS * DS);
      ({
        impact: () => this._impact(old, rng),
        spray: () => this._spray(old, rng),
        drag: () => this._drag(old, rng),
        handprints: () => this._handprints(old, rng),
        soak: () => this._soak(old, rng),
        tally: () => this._tally(old, rng),
      })[second]();
      for (let i = 0; i < field.length; i++) {
        const o = old[i] * 0.55;
        if (o > field[i]) field[i] = o;
      }
    }

    // 0 = fresh and wet, 1 = old, brown, flaking. A landmark authors its own:
    // the chapel's counting stopped a long time ago, the ward's did not.
    const age = style ? clamp(style.age, 0, 1) : rng();
    return { data: this._resolve(field, age, seed), kind, age };
  }

  // Thickness -> colour. This is where blood stops looking like red paint:
  // thin film dries dark brown at the perimeter, thick centres stay red, and
  // fresh blood keeps a weak specular sheen.
  _resolve(field, age, seed) {
    const data = new Uint32Array(DS * DS);
    const EDGE = [46, 18, 13];
    const CORE = [132, 17, 14];
    const DRY = [66, 33, 24];

    for (let y = 0; y < DS; y++) {
      for (let x = 0; x < DS; x++) {
        const i = y * DS + x;
        let t = field[i];
        if (t <= 0.02) { data[i] = 0; continue; }

        // Break the film up so edges are ragged and the interior has texture.
        const n = hash2(x * 3 + seed, y * 3 + (seed >>> 9));
        t *= 0.78 + 0.34 * n;
        if (t <= 0.035) { data[i] = 0; continue; }
        t = clamp(t, 0, 1);

        const k = clamp(t * 1.45, 0, 1);            // 0 at the perimeter
        let r = EDGE[0] + (CORE[0] - EDGE[0]) * k;
        let g = EDGE[1] + (CORE[1] - EDGE[1]) * k;
        let b = EDGE[2] + (CORE[2] - EDGE[2]) * k;

        // Ageing browns and flattens everything.
        r += (DRY[0] - r) * age * 0.7;
        g += (DRY[1] - g) * age * 0.7;
        b += (DRY[2] - b) * age * 0.7;

        // Wet sheen: a few highlight speckles only where it is still pooled.
        if (age < 0.45 && t > 0.72 && hash2(x * 7 + 1, y * 11 + 3) > 0.90) {
          const s = (1 - age / 0.45) * 42;
          r += s; g += s * 0.5; b += s * 0.45;
        }
        // Dried blood cracks and lifts off in flakes.
        if (age > 0.6 && t < 0.5 && hash2(x * 5 + 9, y * 5 + 17) > 0.82) continue;

        const alpha = clamp(t * 1.7, 0, 1) * (0.86 + 0.14 * (1 - age));
        data[i] = packRGBA(
          clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0,
          clamp(alpha * 252, 0, 252) | 0,
        );
      }
    }
    return data;
  }
}

export const DECAL_SIZE = DS;
