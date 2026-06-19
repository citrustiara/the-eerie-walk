// decals.js — unique, procedurally-generated blood smears for walls.
//
// Each bloody wall face gets its OWN decal, generated lazily from a per-face seed
// (random splat count, positions, drips and grain) so no two smears look alike.
// Bloody cells are rare, so the cache stays small over a session.

import { makeRng, hash2, packRGBA, clamp } from './mathutils.js';

const TS = 64; // must match the wall texel size the renderer samples

export class BloodDecals {
  constructor() { this.cache = new Map(); }

  get(cx, cy, face = 0) {
    const key = cx + ',' + cy + ',' + face;
    let d = this.cache.get(key);
    if (!d) { d = this._make(cx, cy, face); this.cache.set(key, d); }
    return d;
  }

  _make(cx, cy, face) {
    const data = new Uint32Array(TS * TS);
    const field = new Float32Array(TS * TS);
    const rng = makeRng(
      (((hash2(cx * 131 + cy * 53, cy * 97 + cx * 29) * 4294967296) >>> 0) ^
        0x9e3779b9 ^ Math.imul(face + 1, 0x85ebca6b)) >>> 0
    );

    const splats = 2 + ((rng() * 3) | 0);
    for (let s = 0; s < splats; s++) {
      const sx = TS * (0.18 + rng() * 0.64), sy = TS * (0.08 + rng() * 0.4);
      const rad = TS * (0.07 + rng() * 0.13), r2 = rad * rad;
      // Splatter blob.
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const dx = x - sx, dy = y - sy;
        let a = 1 - (dx * dx + dy * dy) / r2;
        if (a > 0) { a *= a; const i = y * TS + x; if (a > field[i]) field[i] = a; }
      }
      // A few drips running down from it.
      const drips = 1 + ((rng() * 3) | 0);
      for (let d = 0; d < drips; d++) {
        const x0 = sx - rad * 0.6 + rng() * rad * 1.2, len = TS * (0.1 + rng() * 0.42), wob = rng() * 4;
        for (let yy = 0; yy < len; yy++) {
          const yp = (sy + yy) | 0; if (yp < 0 || yp >= TS) continue;
          const xc = (x0 + Math.sin(yy * 0.3) * wob * 0.25) | 0;
          for (let w = -1; w <= 1; w++) {
            const xp = xc + w; if (xp < 0 || xp >= TS) continue;
            const a = (1 - yy / len) * (w === 0 ? 0.9 : 0.45);
            const i = yp * TS + xp; if (a > field[i]) field[i] = a;
          }
        }
      }
    }

    // Break it up with fine grain and resolve to a dark-red, alpha-keyed decal.
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const i = y * TS + x;
      let a = field[i];
      if (a <= 0.03) { data[i] = 0; continue; }
      a *= 0.7 + 0.5 * hash2(x * 3 + cx * 7 + face * 19, y * 3 + cy * 11 + face * 23);
      a = clamp(a, 0, 1);
      if (a <= 0.04) { data[i] = 0; continue; }
      const k = 0.5 + 0.5 * a;
      const r = clamp(120 * k, 28, 150), g = clamp(15 * k, 4, 26), b = clamp(13 * k, 3, 22);
      data[i] = packRGBA(r | 0, g | 0, b | 0, (a * 235) | 0);
    }
    return { data };
  }
}
