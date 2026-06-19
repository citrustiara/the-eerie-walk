// objects.js — placement of the "left-behind" props: the human-made things you
// rarely stumble on in the emptiness, now rendered as real 3D meshes (see
// mesh.js) rather than billboards.
//
// Placement is deterministic and cached per cell, so the same seed always leaves
// the same object — at the same fixed world yaw — in the same spot. Density is
// deliberately low: an object should be a rare, "wait, someone was here" moment,
// not set dressing.

import { hash2 } from './mathutils.js';
import { PROPS } from './config.js';

const TYPES = ['box', 'crate', 'barrel', 'suitcase', 'cone'];
const COLLISION_RADIUS = {
  box: 0.34,
  crate: 0.38,
  barrel: 0.33,
  suitcase: 0.26,
  cone: 0.24,
};

export class Props {
  constructor(world) {
    this.world = world;
    this.cache = new Map();   // "cx,cy" -> descriptor | null
  }

  // What (if anything) is left in this open cell. Returns a renderer-ready mesh
  // descriptor { x, y, yaw, key, bloodK, seed, collideR } or null.
  _at(cx, cy) {
    const k = cx + ',' + cy;
    const cached = this.cache.get(k);
    if (cached !== undefined) return cached;

    let prop = null;
    const nearSpawn = Math.abs(cx) <= 1 && Math.abs(cy) <= 1; // keep spawn clear
    if (!nearSpawn && !this.world.isWall(cx, cy) &&
        hash2(cx * 131 + cy * 53, cy * 97 + cx * 29) > 1 - PROPS.cellChance) {
      const type = TYPES[Math.min(TYPES.length - 1,
        (hash2(cx * 61 + cy * 113, cy * 41 + cx * 89) * TYPES.length) | 0)];
      const bloody = hash2(cx * 17 + cy * 199, cy * 23 + cx * 151) > 1 - PROPS.bloodyChance;
      const ox = 0.5 + (hash2(cx * 211 + cy * 7, cy * 157 + cx * 3) - 0.5) * 0.5;
      const oy = 0.5 + (hash2(cx * 5 + cy * 223, cy * 71 + cx * 13) - 0.5) * 0.5;
      prop = {
        x: cx + ox, y: cy + oy,
        yaw: hash2(cx * 7 + cy * 3, cy * 5 + cx * 9) * Math.PI * 2,
        key: type,
        scale: PROPS.scale,
        collideR: COLLISION_RADIUS[type] * PROPS.scale,
        bloodK: bloody ? 0.55 + 0.35 * hash2(cx * 3 + 1, cy * 3 + 2) : 0,
        seed: (hash2(cx * 131 + cy * 53, cy * 97 + cx * 29) * 4294967296) >>> 0,
      };
    }
    this.cache.set(k, prop);
    return prop;
  }

  // Descriptors for every prop within `radius` cells of the player.
  near(px, py, radius = PROPS.radius) {
    const out = [], r = Math.ceil(radius), r2 = radius * radius;
    const cx0 = Math.floor(px), cy0 = Math.floor(py);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const p = this._at(cx0 + dx, cy0 + dy);
      if (!p) continue;
      const ex = p.x - px, ey = p.y - py;
      if (ex * ex + ey * ey <= r2) out.push(p);
    }
    return out;
  }
}
