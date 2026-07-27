// objects.js — placement of the left-behind human things.
//
// Three changes from the original that matter more than the model count:
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
// 3. KITS. Everything above is still true of the generated districts, and it is
//    the wrong behaviour inside a landmark. The five stamped rooms are the only
//    places in the building that were drawn by hand, and dressing them out of
//    the same bag as everywhere else was why you could stand in the middle of
//    one and not know: the ward's marked corner got a traffic cone, the chapel
//    got cardboard. A scene inside a landmark — anchored or rolled — is now
//    built from that landmark's OWN kit, aimed at whatever the room is built
//    around, and marked with that landmark's own blood.
//
//    The aiming does at least as much work as the objects. A prop at a random
//    yaw reads as dropped; a row of chairs all facing the atrium core, or a
//    length of torn barrier lying tangent to the rim of the shaft, reads as
//    installed — as somewhere that was arranged, by people, for a reason.
//
// Placement stays deterministic and cached per cell, so the same seed always
// leaves the same objects, at the same fixed world yaw, in the same spot.

import { hash2 } from './mathutils.js';
import { PROPS, OUTSIDE } from './config.js';
import { PROP_TYPES } from './models.js';
import { FIELD } from './terrain.js';

// Precomputed weighted picker over the catalogue. The landmark-only models sit
// in PROP_TYPES at weight zero, which the roll below can never reach.
const WEIGHT_TOTAL = PROP_TYPES.reduce((s, t) => s + t.weight, 0);
function pickType(r) {
  let roll = r * WEIGHT_TOTAL;
  for (const t of PROP_TYPES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return PROP_TYPES[PROP_TYPES.length - 1];
}

const TYPE_BY_KEY = {};
for (const t of PROP_TYPES) TYPE_BY_KEY[t.key] = t;

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

// --- what each hand-drawn room is furnished with ----------------------------
//
// `lead` is what the scene is about and `with` is what else was left around it.
// `focus` is measured against the centre of the block, which is what every one
// of these templates is symmetric about:
//
//   inward   face the middle of the room. The atrium is a ring round a solid
//            core and there is nothing in the middle, so a dozen chairs all
//            turned to face it is the room telling you what it was for.
//   tangent  lie along the rim. The shaft is mostly hole; a barrier section
//            runs AROUND a hole, never at it.
//   axis     snap to the nearest right angle. A ward is a fitted-out room and
//            its beds were installed square to the walls, not dropped.
//   fixed    one constant yaw, everywhere, forever. See `identical`.
//
// `identical` is the combs and only the combs. Nine pillars on a perfect
// lattice with nothing to tell one row from the next — so every object in it is
// the same object, at the same angle, at the same offset in its cell, with the
// same seed. You cannot use them to work out whether you have been down this
// row, and finding that out is the room.
const LANDMARK_KITS = {
  ward: {
    lead: ['bedFrame', 'bedFrame', 'mattress'],
    with: ['bucket', 'papers', 'shoe', 'cup', 'bottles'],
    focus: 'axis', jitter: 0.05,
    count: [1, 3],
    bloody: 0.62,
    // Somebody was moved out of this room and down the corridor.
    trail: 'corridor',
  },
  atrium: {
    lead: ['chair', 'chair', 'suitcase'],
    with: ['chair', 'papers', 'cone', 'bottles', 'cup'],
    focus: 'inward', jitter: 0.09,
    count: [2, 3],
    bloody: 0.12,
  },
  shaft: {
    lead: ['railing', 'railing', 'drum'],
    with: ['gasCan', 'pallet', 'cone', 'toolbox', 'bucket'],
    focus: 'tangent', jitter: 0.07,
    count: [1, 3],
    bloody: 0.30,
  },
  combs: {
    lead: ['cone'],
    with: [],
    focus: 'fixed', jitter: 0,
    count: [1, 1],
    bloody: 0,
    identical: true,
  },
  chapel: {
    lead: ['cross', 'candles', 'pew', 'pew'],
    with: ['candles', 'papers', 'cup', 'shoe'],
    focus: 'inward', jitter: 0.06,
    count: [1, 2],
    bloody: 0.34,
    // A ring of it around the foot of the plinth, whatever else the room rolls.
    plinthRing: 2.9,
  },
};

// The one angle every object in every combs block in the building is set to.
const COMBS_YAW = 0.62;

// Kits are hand-edited data referring to models by name, so a typo in one is a
// `type.key` of undefined thrown from inside the prop placer — which is a caught
// frame-loop failure, on the frame you walk into that room, with a stack that
// points at the placer rather than at the table. Check it once at load instead.
for (const [name, kit] of Object.entries(LANDMARK_KITS)) {
  for (const key of [...kit.lead, ...kit.with]) {
    if (!TYPE_BY_KEY[key]) {
      throw new Error(`LANDMARK_KITS.${name} refers to "${key}", which is not in PROP_TYPES`);
    }
  }
}

// Yaw for a prop that belongs to a room, measured against the room's centre.
function focalYaw(kit, x, y, cx, cy, jitter) {
  if (kit.focus === 'fixed') return COMBS_YAW;
  const toward = Math.atan2(cy - y, cx - x);
  const j = (jitter - 0.5) * 2 * kit.jitter;
  switch (kit.focus) {
    case 'inward': return toward + j;
    case 'tangent': return toward + Math.PI / 2 + j;
    case 'axis': return Math.round(toward / (Math.PI / 2)) * (Math.PI / 2) + j;
    default: return toward + j;
  }
}

export class Props {
  constructor(world) {
    this.world = world;
    this.cache = new Map();   // "cx,cy" -> descriptor[] (possibly empty)
    // The field outside, built on the first frame anybody is standing in it and
    // never again. Null for every session that does not reach ending vi, which
    // is most of them. See _field.
    this._fieldList = null;
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

    // Nothing was ever left behind out there, because nobody was ever in there
    // to leave it. A cardboard box on the grass would undo the whole ending.
    const usable = !nearSpawn && !this.world.blocked(cx, cy) && !this.world.isOutside(cx, cy);
    const landmark = usable ? this.world.landmarkAt(cx, cy) : null;
    const kit = landmark ? LANDMARK_KITS[landmark] : null;
    const centre = kit ? this.world.blockCenter(cx, cy) : null;

    // The chapel marks its own plinth, whether or not this cell rolls a scene.
    // It is the one thing in the building that every visit to that room has in
    // common, which is what makes the room recognisable from the doorway.
    if (kit && kit.plinthRing) {
      this._plinthRing(out, cx, cy, centre, kit.plinthRing);
    }

    if (usable && (anchored || seedRoll > 1 - PROPS.cellChance)) {
      const baseSeed = (seedRoll * 4294967296) >>> 0;
      if (kit) this._landmarkScene(out, cx, cy, kit, centre, baseSeed);
      else this._districtScene(out, cx, cy, baseSeed, seedRoll);
    }

    this.cache.set(k, out);
    return out;
  }

  // --- the generated districts ----------------------------------------------
  // Unchanged: a lead object from the weighted bag, a couple of companions, and
  // sometimes blood under the lot of it.

  _districtScene(out, cx, cy, baseSeed, seedRoll) {
    const lead = pickType(hash2(cx * 61 + cy * 113, cy * 41 + cx * 89));
    const companions = COMPANIONS[lead.key];
    const count = 1 + Math.floor(hash2(cx * 19 + 7, cy * 23 + 11) * PROPS.clusterMax);
    const bloody = hash2(cx * 17 + cy * 199, cy * 23 + cx * 151) > 1 - PROPS.bloodyChance;

    // The blood goes down first so props sit in it rather than beside it.
    if (bloody) this._pool(out, cx + 0.5, cy + 0.5, cx, cy, baseSeed);

    for (let i = 0; i < count; i++) {
      const h1 = hash2(cx * 211 + cy * 7 + i * 37, cy * 157 + cx * 3 + i * 91);
      const h2 = hash2(cx * 5 + cy * 223 + i * 13, cy * 71 + cx * 13 + i * 57);
      const h3 = hash2(cx * 29 + cy * 31 + i * 71, cy * 43 + cx * 67 + i * 23);

      let type = lead;
      if (i > 0) {
        if (companions && h3 < 0.7) {
          const key = companions[(h3 / 0.7 * companions.length) | 0];
          type = TYPE_BY_KEY[key] || pickType(h3);
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

  // --- the rooms that were built on purpose ---------------------------------

  _landmarkScene(out, cx, cy, kit, centre, baseSeed) {
    // A combs scene is the same scene everywhere. Not merely "the same kind of
    // object" — the same object, the same way round, in the same place in its
    // cell, generated from the same seed, so the wear on one is the wear on all
    // of them. Nothing about it can tell you which row you are in.
    if (kit.identical) {
      const type = TYPE_BY_KEY[kit.lead[0]];
      out.push({
        x: cx + 0.5, y: cy + 0.5,
        yaw: COMBS_YAW,
        key: type.key,
        scale: PROPS.scale,
        collideR: type.collide,
        bloodK: 0,
        seed: 0x0c0b5e11 >>> 0,
      });
      return;
    }

    const pick = hash2(cx * 61 + cy * 113, cy * 41 + cx * 89);
    const lead = TYPE_BY_KEY[kit.lead[(pick * kit.lead.length) | 0]] || TYPE_BY_KEY[kit.lead[0]];
    const spanCount = kit.count[1] - kit.count[0];
    const count = kit.count[0] +
      Math.round(hash2(cx * 19 + 7, cy * 23 + 11) * spanCount);
    const bloody = hash2(cx * 17 + cy * 199, cy * 23 + cx * 151) < kit.bloody;

    if (bloody) {
      this._pool(out, cx + 0.5, cy + 0.5, cx, cy, baseSeed);
      // ...and in the ward, whoever bled here did not stay here.
      if (kit.trail === 'corridor') this._dragTrail(out, cx, cy, centre, baseSeed);
    }

    for (let i = 0; i < count; i++) {
      const h1 = hash2(cx * 211 + cy * 7 + i * 37, cy * 157 + cx * 3 + i * 91);
      const h2 = hash2(cx * 5 + cy * 223 + i * 13, cy * 71 + cx * 13 + i * 57);
      const h3 = hash2(cx * 29 + cy * 31 + i * 71, cy * 43 + cx * 67 + i * 23);

      let type = lead;
      if (i > 0 && kit.with.length) {
        type = TYPE_BY_KEY[kit.with[(h3 * kit.with.length) | 0]] || lead;
      }

      // The lead sits square in the cell — it is the thing the scene is about —
      // and the rest are scattered round it, tighter than a district scene so a
      // pew or a bed frame is not standing in the middle of somebody's cup.
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + h1 * 1.2;
      const rad = i === 0 ? h1 * 0.06 : 0.20 + h2 * 0.14;
      const x = cx + 0.5 + Math.cos(ang) * rad;
      const y = cy + 0.5 + Math.sin(ang) * rad;
      out.push({
        x, y,
        yaw: focalYaw(kit, x, y, centre.x, centre.y, h1),
        key: type.key,
        scale: PROPS.scale,
        collideR: type.collide,
        bloodK: bloody && h2 > 0.40 ? 0.45 + 0.4 * h1 : 0,
        seed: (baseSeed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0,
      });
    }
  }

  // Small pools running from this cell toward the middle of the block, which in
  // a ward is the corridor. It thins as it goes and it does not arrive: the
  // trail runs out somewhere short of wherever it was going.
  _dragTrail(out, cx, cy, centre, baseSeed) {
    const toward = Math.atan2(centre.y - (cy + 0.5), centre.x - (cx + 0.5));
    const steps = 3 + ((hash2(cx * 7 + 3, cy * 11 + 5) * 4) | 0);
    for (let i = 1; i <= steps; i++) {
      const d = i * 0.55;
      const wob = (hash2(cx * 13 + i * 29, cy * 17 + i * 31) - 0.5) * 0.34;
      const x = cx + 0.5 + Math.cos(toward + wob) * d;
      const y = cy + 0.5 + Math.sin(toward + wob) * d;
      if (this.world.blocked(Math.floor(x), Math.floor(y))) break;
      out.push({
        x, y,
        yaw: hash2(cx * 3 + i, cy * 5 + i) * Math.PI * 2,
        key: 'bloodSmall',
        scale: 1 - i / (steps + 2) * 0.55,
        collideR: 0, bloodK: 0,
        seed: (baseSeed ^ Math.imul(i + 61, 0x85ebca6b)) >>> 0,
      });
    }
  }

  // One mark per cell in a ring at the foot of the chapel plinth. Every chapel
  // in the building has this and nothing else does, so it is the tell you can
  // read from the end of the nave before you can read the shape of the room.
  _plinthRing(out, cx, cy, centre, radius) {
    const dx = cx + 0.5 - centre.x, dy = cy + 0.5 - centre.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.1 || d > radius) return;
    // Pulled in toward the plinth from the middle of the cell, so the ring is a
    // ring rather than a square of cell centres.
    const pull = (d - 0.85) / d;
    out.push({
      x: centre.x + dx * pull,
      y: centre.y + dy * pull,
      yaw: Math.atan2(dy, dx),
      // Mostly small. A ring of twenty full pools around the plinth read as a
      // flooded room rather than as something that had been done repeatedly in
      // the same place, which is what it is.
      key: hash2(cx * 5 + 1, cy * 9 + 4) > 0.88 ? 'bloodPool' : 'bloodSmall',
      scale: 1, collideR: 0, bloodK: 0,
      seed: ((hash2(cx * 41 + 7, cy * 23 + 19) * 4294967296) >>> 0) ^ 0xc4a9e1,
    });
  }

  _pool(out, x, y, cx, cy, baseSeed) {
    out.push({
      x, y,
      yaw: hash2(cx * 3 + 5, cy * 7 + 2) * Math.PI * 2,
      key: hash2(cx + 3, cy + 5) > 0.5 ? 'bloodPool' : 'bloodSmall',
      scale: 1, collideR: 0, bloodK: 0,
      seed: baseSeed ^ 0xb10d,
    });
  }

  // --- the field --------------------------------------------------------------
  //
  // A completely separate placer, and it has to be. Everything above is per
  // cell, cached per cell, and queried by walking a square of cells around the
  // player — which is exactly right for a building where the draw radius is
  // eleven cells and nothing is ever more than a couple of metres tall. Outside
  // you can see seventy-four units, and a square of cells that wide is nine
  // thousand map lookups a frame for a region that never changes.
  //
  // So the field is built ONCE, into one flat array, and queried by distance.
  // Fifty-odd survivors out of a couple of thousand records is a linear scan
  // costing less than one row of the floor pass.
  //
  // It is also placed against the HEIGHT FIELD rather than against the map: a
  // reed goes where the water is two inches deep, a boulder goes on a rise, and
  // a drowned trunk goes where nothing living could stand. That is the only way
  // the objects and the ground look like they belong to each other, and it is
  // why terrain.js is a module both of them can ask rather than a texture.
  _field() {
    if (this._fieldList) return this._fieldList;
    const w = this.world, o = w.outside;
    if (!o) return [];
    const F = OUTSIDE.field;
    const list = [];

    // Only the part of the region you could ever see. The ending caps the walk
    // at OUTSIDE.walkFor and the draw radius is F.radius, so everything past
    // this is a bake nobody will ever look at.
    const reach = OUTSIDE.walkFor + F.radius + 8;

    const put = (across, out, key, yaw, scale, collideR, far, maxDist) => {
      const d = {
        x: o.doorX + across, y: o.wallY - out,
        yaw, key, scale, collideR, bloodK: 0,
        seed: ((hash2(across * 733, out * 947) * 4294967296) >>> 0),
        // How far away this is still worth drawing. See the radii in
        // OUTSIDE.field — the renderer never sees this property.
        maxDist: maxDist || F.radius,
      };
      // The distant version of the same object, built now so the swap at draw
      // time is a property read rather than an allocation. See _fieldNear.
      if (far) d.far = { ...d, key: far };
      list.push(d);
      return d;
    };

    for (let out = 1; out <= reach; out++) {
      for (let across = -reach; across <= reach; across++) {
        if (Math.hypot(across, out) < F.clearOfDoor) continue;
        // JITTER FIRST, THEN ASK THE GROUND. The other way round — roll against
        // the middle of the cell and then scatter the object off it — is how
        // rushes ended up standing in half a metre of water: the bank of the
        // stream falls the better part of a metre inside two cells, and four
        // tenths of a cell of jitter is enough to walk a shoreline plant off
        // the edge of its own shoreline.
        const jx = hash2(across * 71 + 13, out * 37 + 5);
        const jy = hash2(across * 29 + 41, out * 83 + 7);
        const ax = across + (jx - 0.5) * 0.8, ao = out + (jy - 0.5) * 0.8;
        const yaw = hash2(across * 17 + 3, out * 23 + 9) * Math.PI * 2;

        // One height query per cell, not two. `groundWater` would run the whole
        // fBm stack again for a number this one already contains, and there are
        // thirteen thousand cells in the loop.
        const height = w.groundHeightAt(o.doorX + ax, o.wallY - ao);
        const depth = height >= FIELD.waterline
          ? 0 : Math.min(FIELD.maxDepth, FIELD.waterline - height);

        // Reeds first: the shallows are theirs and nothing else wants them.
        if (depth >= F.reedDepth[0] && depth <= F.reedDepth[1]) {
          if (hash2(across * 191 + 7, out * 131 + 3) < F.reedChance) {
            put(ax, ao, 'reeds', yaw, 0.85 + jx * 0.5, 0, null, F.reedRadius);
          }
          continue;
        }

        // A trunk standing in open water. Rare, and the best thing out here.
        if (depth >= F.drownedDepth[0] && depth <= F.drownedDepth[1]) {
          if (hash2(across * 313 + 11, out * 271 + 19) < F.drownedChance) {
            put(ax, ao, jx > 0.62 ? 'stump' : 'tree', yaw,
              0.75 + jy * 0.45, 0.09, 'treeFar');
          }
          continue;
        }
        if (depth > F.maxWadeDepth) continue;

        // Trees thin in the middle of the field and thicken toward the edges,
        // where the painted treeline takes over. You are walking out of cover.
        const edge = Math.min(1, Math.max(Math.abs(across), out) / reach);
        const treeK = F.treeChance * (1 + edge * edge * (F.treeEdgeBoost - 1));
        if (hash2(across * 419 + 23, out * 353 + 31) < treeK) {
          put(ax, ao, jy > 0.80 ? 'stump' : 'tree', yaw,
            0.82 + jx * 0.5, 0.09, 'treeFar');
          continue;
        }
        if (height > F.stoneAbove &&
            hash2(across * 149 + 53, out * 211 + 67) < F.stoneChance) {
          put(ax, ao, 'boulder', yaw, 0.8 + jx * 0.6, 0.15, null, F.stoneRadius);
          continue;
        }
        if (height > F.tussockAbove &&
            hash2(across * 97 + 71, out * 181 + 43) < F.tussockChance) {
          put(ax, ao, 'tussock', yaw, 0.9 + jy * 0.4, 0, null, F.tussockRadius);
        }
      }
    }

    this._fence(list, put);
    this._fieldList = list;
    return list;
  }

  // One line of fence, dead straight, running across your walk rather than
  // along it. Posts sit at exactly FIELD.fenceEvery because the wire on each
  // one is authored to reach the next; a gap is a post that has come down, and
  // the post that comes down takes its wire with it.
  _fence(list, put) {
    const F = OUTSIDE.field;
    const n = Math.floor(F.fenceSpan / F.fenceEvery);
    for (let i = -n; i <= n; i++) {
      const across = i * F.fenceEvery;
      const h = hash2(i * 313 + 7, 991);
      if (h < 0.10) continue;                    // gone entirely, wire and all
      const broken = h < 0.34;
      put(across, F.fenceOut, broken ? 'fencePostBroken' : 'fencePost',
        broken ? hash2(i * 61, 13) * Math.PI * 2 : 0,
        0.92 + hash2(i * 29, 5) * 0.2, 0.05);
    }
  }

  // Everything in the field within `radius`, with the far-LOD swap applied.
  _fieldNear(px, py, radius) {
    const F = OUTSIDE.field;
    const r2 = radius * radius, near2 = F.nearLOD * F.nearLOD;
    const out = [];
    const list = this._field();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = p.x - px, dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // ...and its own limit, which for grass is a great deal nearer than the
      // draw radius. A caller asking for a small radius (the collision query
      // asks for 2.5) is inside every one of these anyway.
      if (d2 > p.maxDist * p.maxDist) continue;
      out.push(d2 > near2 && p.far ? p.far : p);
    }
    return out;
  }

  // Descriptors for every prop within `radius` cells of the player.
  near(px, py, radius = PROPS.radius) {
    // Out there the cell cache holds nothing and never will — see the note in
    // _at — so the square walk below would be several thousand lookups for an
    // empty answer. The field has its own list and its own radius.
    if (this.world.outside && this.world.isOutside(Math.floor(px), Math.floor(py))) {
      return this._fieldNear(px, py, radius === PROPS.radius ? OUTSIDE.field.radius : radius);
    }
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
