// objects.js — placement of the left-behind human things.
//
// Two changes from the original that matter more than the model count:
//
// 1. DENSITY. It used to be 0.00025 — one object per four thousand cells. You
//    could walk for ten minutes and never see anything man-made, which is most
//    of why the place felt like a screensaver instead of a place.
//
// 2. SCENES. Objects arrive in small clusters of two to four, sometimes with a
//    blood pool under them. A single traffic cone in an empty corridor is set
//    dressing; a chair, a scatter of papers and one child's shoe together is an
//    event you are walking into the middle of.
//
// Placement stays deterministic and cached per cell, so the same seed always
// leaves the same objects, at the same fixed world yaw, in the same spot.

import { hash2 } from './mathutils.js';
import { PROPS } from './config.js';
import { PROP_TYPES } from './models.js';

// Precomputed weighted picker over the catalogue.
const WEIGHT_TOTAL = PROP_TYPES.reduce((s, t) => s + t.weight, 0);
function pickType(r) {
  let roll = r * WEIGHT_TOTAL;
  for (const t of PROP_TYPES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return PROP_TYPES[PROP_TYPES.length - 1];
}

// A few pairings that tell a story when they land together. If the first object
// of a scene is one of these, the rest of the cluster is drawn from its list.
const COMPANIONS = {
  chair: ['papers', 'cup', 'radio', 'bottles'],
  mattress: ['bottles', 'teddy', 'shoe', 'cup'],
  doll: ['teddy', 'shoe', 'tricycle', 'cardboardOpen'],
  tricycle: ['shoe', 'teddy', 'doll'],
  crate: ['cardboardBox', 'pallet', 'toolbox'],
  pallet: ['cardboardBox', 'crate', 'drum'],
  drum: ['gasCan', 'bucket', 'cone'],
  toolbox: ['paintCan', 'bucket', 'lantern'],
  cardboardBox: ['cardboardOpen', 'papers', 'crate'],
};

export class Props {
  constructor(world) {
    this.world = world;
    this.cache = new Map();   // "cx,cy" -> descriptor[] (possibly empty)
  }

  // Everything left in this open cell. Returns an array of renderer-ready mesh
  // descriptors { x, y, yaw, key, scale, bloodK, seed, collideR }.
  _at(cx, cy) {
    const k = cx + ',' + cy;
    const cached = this.cache.get(k);
    if (cached !== undefined) return cached;

    const out = [];
    const nearSpawn = Math.abs(cx) <= 1 && Math.abs(cy) <= 1;   // keep spawn clear
    const seedRoll = hash2(cx * 131 + cy * 53, cy * 97 + cx * 29);
    // Landmarks nominate the spots they want dressed. Everywhere else it is the
    // usual sparse roll — but a room that was built on purpose always has
    // something left in it, which is what makes it read as a room.
    const anchored = this.world.isPropAnchor(cx, cy);

    if (!nearSpawn && !this.world.blocked(cx, cy) &&
        (anchored || seedRoll > 1 - PROPS.cellChance)) {
      const baseSeed = (seedRoll * 4294967296) >>> 0;
      const lead = pickType(hash2(cx * 61 + cy * 113, cy * 41 + cx * 89));
      const companions = COMPANIONS[lead.key];
      const count = 1 + Math.floor(hash2(cx * 19 + 7, cy * 23 + 11) * PROPS.clusterMax);
      const bloody = hash2(cx * 17 + cy * 199, cy * 23 + cx * 151) > 1 - PROPS.bloodyChance;

      // The blood goes down first so props sit in it rather than beside it.
      if (bloody) {
        out.push({
          x: cx + 0.5, y: cy + 0.5,
          yaw: hash2(cx * 3 + 5, cy * 7 + 2) * Math.PI * 2,
          key: hash2(cx + 3, cy + 5) > 0.5 ? 'bloodPool' : 'bloodSmall',
          scale: 1, collideR: 0, bloodK: 0,
          seed: baseSeed ^ 0xb10d,
        });
      }

      for (let i = 0; i < count; i++) {
        const h1 = hash2(cx * 211 + cy * 7 + i * 37, cy * 157 + cx * 3 + i * 91);
        const h2 = hash2(cx * 5 + cy * 223 + i * 13, cy * 71 + cx * 13 + i * 57);
        const h3 = hash2(cx * 29 + cy * 31 + i * 71, cy * 43 + cx * 67 + i * 23);

        let type = lead;
        if (i > 0) {
          if (companions && h3 < 0.7) {
            const key = companions[(h3 / 0.7 * companions.length) | 0];
            type = PROP_TYPES.find((t) => t.key === key) || pickType(h3);
          } else {
            type = pickType(h3);
          }
        }

        // Spread the cluster across the cell, keeping everything well inside it.
        const ang = (i / count) * Math.PI * 2 + h1 * 1.4;
        const rad = i === 0 ? h1 * 0.10 : 0.16 + h2 * 0.16;
        out.push({
          x: cx + 0.5 + Math.cos(ang) * rad,
          y: cy + 0.5 + Math.sin(ang) * rad,
          yaw: hash2(cx * 7 + cy * 3 + i * 17, cy * 5 + cx * 9 + i * 41) * Math.PI * 2,
          key: type.key,
          scale: PROPS.scale,
          collideR: type.collide,
          bloodK: bloody && h2 > 0.45 ? 0.45 + 0.4 * h1 : 0,
          seed: (baseSeed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0,
        });
      }
    }

    this.cache.set(k, out);
    return out;
  }

  // Descriptors for every prop within `radius` cells of the player.
  near(px, py, radius = PROPS.radius) {
    const out = [], r = Math.ceil(radius), r2 = radius * radius;
    const cx0 = Math.floor(px), cy0 = Math.floor(py);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this._at(cx0 + dx, cy0 + dy);
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const ex = p.x - px, ey = p.y - py;
          if (ex * ex + ey * ey <= r2) out.push(p);
        }
      }
    }
    return out;
  }
}
