// world.js — infinite map made of cached 16x16 chunks.
//
// LAYOUT. The first version was a regular grid of open "streets" every seven
// cells with fBm blobs between them. That guaranteed you could never be sealed
// in, but it meant the whole building had exactly one shape: wide open, with
// occasional lumps. The second version fixed that with arteries and districts,
// and it still had one problem — everything in it was noise. Noise is good at
// "somewhere", and completely incapable of "somewhere on purpose". You could
// walk for ten minutes and never see a straight line that meant anything.
//
// So the map is now built in three layers:
//
//   1. ARTERIES — a coarse lattice of corridors every ARTERY cells that WANDER
//      (a smooth ±3 cell offset along their length) instead of running dead
//      straight, and are one or two cells wide rather than being open field.
//      A short forced cross at every lattice node guarantees the horizontal and
//      vertical arteries actually meet, which is what makes the whole infinite
//      map provably connected. You can always get out of wherever you are by
//      walking until you hit one.
//
//   2. LANDMARKS — one block in five is not generated at all. It is STAMPED,
//      from a hand-drawn 14x14 template that is exactly symmetric about both
//      axes: a ward of paired cells off a central corridor, an atrium around a
//      solid core, a shaft that is mostly a hole with two walkways across it, a
//      grid of pillars with four square holes punched between them, a cruciform
//      chapel with a plinth. They repeat. That is the point — the third time
//      you walk into the same ward you know exactly where it goes, and knowing
//      where you are is much worse than not knowing.
//
//   3. DISTRICTS — every other block picks a structure type from its own hash:
//      a warren of one-wide corridors, a grid of small rooms with a single
//      doorway per wall, long parallel service halls that line up across block
//      boundaries into corridors a hundred metres long, organic chambers,
//      near-solid rock with a winding channel through it, an open hall with
//      pillars, a columned expanse with no ceiling at all, or a stretch where
//      the floor has collapsed into holes.
//
// And a fourth thing that is not a layer but matters more than any of them:
// every block has a CEILING HEIGHT. Four of them — two and a half metres, three
// metres, seven metres, and none. That is what stops the whole level reading as
// one extruded floor plan, and it is why the walls are the same wallpaper
// everywhere: the shape of a space is doing the work that ten unrelated
// materials used to be doing badly.
//
// A cell carries flags, not a boolean: solid, PIT (an open cell with no floor —
// you can walk into one, and that is the last thing you do), the anchors that
// tell the prop placer and the gun where a landmark wants them, and two bits of
// ceiling class.
//
// Cells are addressed in absolute integer coordinates; chunks are generated
// lazily the first time any ray or query touches them, then memoised forever.

import { WORLD, DECALS, OUTSIDE } from './config.js';
import { fbm, seedSalt, noiseEpoch } from './noise.js';
import { hash2 } from './mathutils.js';
import { WALL_STYLES } from './textures.js';

const { chunkSize, artery, arteryWander, districtWeights, landmarkChance, ceilings } = WORLD;

export const SOLID = 1;
export const PIT = 2;
export const PROP_ANCHOR = 4;
export const GUN_ANCHOR = 8;
// Bit 6. Not a district and not a landmark: the one place in the game that is
// not in the building. See stampOutside below — it is written over the generator
// rather than generated, because the whole point of it is that it was not.
export const OUTSIDE_CELL = 64;

// Bits 4-5 of a cell are which of four ceilings is over it. Height varies per
// BLOCK, not per cell, but it is stored per cell so the renderer can ask the
// same fast flags() question it already asks about walls and holes rather than
// doing a block lookup for every pixel of the top half of the screen.
export const CEIL_MASK = 48;
export const CEIL_SHIFT = 4;
export const CEIL_LOW = 0;
export const CEIL_STD = 1;
export const CEIL_HIGH = 2;
export const CEIL_OPEN = 3;      // no ceiling at all

// Height above the floor, in wall heights (one == three metres). CEIL_OPEN has
// no plane to draw, so its entry is how far up the WALLS are built before they
// give out — past that there is nothing, which is exactly what you want to be
// looking at.
export const CEIL_HEIGHT = [0.82, 1.0, 2.35, 5.0];

const CEIL_CLASS = { low: CEIL_LOW, std: CEIL_STD, high: CEIL_HIGH, open: CEIL_OPEN };
function ceilClassOf(kind) {
  const c = CEIL_CLASS[ceilings[kind]];
  return c === undefined ? CEIL_STD : c;
}

// --- landmarks --------------------------------------------------------------
// 14x14, exactly the artery block size. Symmetric about both axes by hand —
// there is no generator here on purpose, because a generator cannot make a room
// that feels designed.
//
//   #  solid      .  open        O  open, but the floor is a hole
//   *  open, and a scene of left-behind objects is guaranteed here
//   G  open, and the gun prefers to turn up here

const LANDMARKS = {
  // The ward. A standardised symmetric corridor: two cells wide, running the
  // whole block, with three paired rooms off each side and a doorway into each.
  // The middle pair have no floor.
  ward: [
    '##############',
    '#.*.#....#.*.#',
    '#...#.OO.#...#',
    '#...#.OO.#...#',
    '#...#....#...#',
    '##.###..###.##',
    '..............',
    '..............',
    '##.###..###.##',
    '#...#....#...#',
    '#...#.OO.#...#',
    '#...#.OO.#...#',
    '#.G.#....#.G.#',
    '##############',
  ],
  // The atrium. A ring of floor around a solid cross-shaped core, with four
  // square holes at the corners. You can walk all the way round it, and you
  // will, twice, before you work out that there is nothing in the middle.
  atrium: [
    '##############',
    '#..G......G..#',
    '#.OO..##..OO.#',
    '#.OO..##..OO.#',
    '#.....##.....#',
    '#....####....#',
    '.....####.....',
    '.....####.....',
    '#....####....#',
    '#.....##.....#',
    '#.OO..##..OO.#',
    '#.OO..##..OO.#',
    '#..*......*..#',
    '##############',
  ],
  // The shaft. Mostly hole. Two two-cell walkways cross it at right angles and
  // there is a rim you can edge round. Sound comes up out of it.
  shaft: [
    '######..######',
    '#.G........G.#',
    '#............#',
    '#..OOO..OOO..#',
    '#..OOO..OOO..#',
    '#..OOO..OOO..#',
    '..............',
    '..............',
    '#..OOO..OOO..#',
    '#..OOO..OOO..#',
    '#..OOO..OOO..#',
    '#............#',
    '#.*........*.#',
    '######..######',
  ],
  // The combs. Nine identical pillars on a perfect lattice with four identical
  // holes between them. Nothing here is random and nothing here is different
  // from anything else here, which is why you cannot tell whether you have
  // already been down this row.
  combs: [
    '..............',
    '.....*..*.....',
    '..##..##..##..',
    '..##..##..##..',
    '....OO..OO....',
    '....OO..OO....',
    '..##..##..##..',
    '..##..##..##..',
    '....OO..OO....',
    '....OO..OO....',
    '..##..##..##..',
    '..##..##..##..',
    '.....G..G.....',
    '..............',
  ],
  // The chapel. A cruciform hall with a plinth at the crossing and a hole on
  // either side of it. Whatever this room was for, it was for exactly one
  // thing, and it was built to be walked down.
  chapel: [
    '#####....#####',
    '#####.GG.#####',
    '#####....#####',
    '#####....#####',
    '#####....#####',
    '..............',
    '....OO##OO....',
    '....OO##OO....',
    '..............',
    '#####....#####',
    '#####....#####',
    '#####....#####',
    '#####.**.#####',
    '#####....#####',
  ],
};

const LANDMARK_KEYS = Object.keys(LANDMARKS);

// Precompiled to flag arrays so the hot path is one array index, not a charAt
// and a switch.
const LANDMARK_FLAGS = {};
for (const key of LANDMARK_KEYS) {
  const rows = LANDMARKS[key];
  const flags = new Uint8Array(artery * artery);
  for (let y = 0; y < artery; y++) {
    for (let x = 0; x < artery; x++) {
      const c = rows[y][x];
      flags[y * artery + x] =
        c === '#' ? SOLID :
        c === 'O' ? PIT :
        c === '*' ? PROP_ANCHOR :
        c === 'G' ? GUN_ANCHOR : 0;
    }
  }
  LANDMARK_FLAGS[key] = flags;
}

// How far gone the wallpaper is in a given block. Two candidates per structure,
// never more — the point of a wear stage is that it holds for as far as you can
// see, so that finding a corridor where the paper has been stripped off means
// something happened in that corridor rather than meaning the level generator
// rolled a different number.
//
// The mapping is not arbitrary. The tight, sealed places are merely damp; the
// places that are open to the rest of the building, or that have a hole in the
// floor, are the ones that are rotten and marked.
const BLOCK_STYLES = {
  warren:   ['paper', 'paperDamp'],
  cells:    ['paperDamp', 'paperTorn'],
  stacks:   ['paperTorn', 'paper'],
  chambers: ['paperRot', 'paperDamp'],
  dense:    ['paperDamp', 'paperRot'],
  hall:     ['paper', 'paperTorn'],
  expanse:  ['paperBare', 'paperTorn'],
  collapse: ['paperRot', 'paperBlood'],
  vault:    ['paperRot', 'paperBlood'],
  ward:     ['paperBlood', 'paperDamp'],
  atrium:   ['paper', 'paperTorn'],
  shaft:    ['paperTorn', 'paperBare'],
  combs:    ['paperDamp', 'paperRot'],
  chapel:   ['paperBlood', 'paperRot'],
};
const STYLE_INDEX = {};
WALL_STYLES.forEach((s, i) => { STYLE_INDEX[s] = i; });

// Cumulative weights for the district picker, built once.
const DISTRICTS = Object.keys(districtWeights);
const DISTRICT_TOTAL = DISTRICTS.reduce((s, k) => s + districtWeights[k], 0);

// The per-session offsets, picked up the first time anything asks about a block
// and refreshed if the seed is ever changed underneath us.
let SX = 0, SY = 0, EP = -1;

function pickDistrict(bx, by) {
  let roll = hash2(bx * 0.7391 + 13.7 + SX, by * 1.1237 - 4.1 + SY) * DISTRICT_TOTAL;
  for (const k of DISTRICTS) {
    roll -= districtWeights[k];
    if (roll <= 0) return k;
  }
  return DISTRICTS[DISTRICTS.length - 1];
}

// null, or the name of the template stamped over this whole block.
function pickLandmark(bx, by) {
  if (hash2(bx * 2.113 + 55.5 + SY, by * 3.717 - 19.3 + SX) > landmarkChance) return null;
  const i = Math.min(
    LANDMARK_KEYS.length - 1,
    (hash2(bx * 6.311 - 3.9 - SX, by * 4.107 + 27.1 - SY) * LANDMARK_KEYS.length) | 0
  );
  return LANDMARK_KEYS[i];
}

// What a block is, its material, and its template if it has one. Memoised: this
// is asked once per wall column per frame, which is 480 times at 60 Hz, and the
// answer for a given block never changes.
const BLOCKS = new Map();
function blockInfo(bx, by) {
  if (EP !== noiseEpoch()) {
    EP = noiseEpoch();
    const s = seedSalt(); SX = s[0]; SY = s[1];
    BLOCKS.clear();
  }
  // Numeric key, not a template string: this is called once per wall column per
  // frame, and half a thousand string concatenations and their garbage every
  // sixtieth of a second is not free.
  const key = ((bx & 0xffff) << 16) | (by & 0xffff);
  let v = BLOCKS.get(key);
  if (v !== undefined) return v;
  const landmark = pickLandmark(bx, by);
  const kind = landmark || pickDistrict(bx, by);
  const pair = BLOCK_STYLES[kind] || BLOCK_STYLES.warren;
  const pick = hash2(bx * 8.31 - 5.5 + SX, by * 2.77 + 41.3 + SY) > 0.5 ? 1 : 0;
  v = {
    landmark, kind,
    flags: landmark ? LANDMARK_FLAGS[landmark] : null,
    style: STYLE_INDEX[pair[pick]] || 0,
    ceil: ceilClassOf(kind) << CEIL_SHIFT,
  };
  BLOCKS.set(key, v);
  return v;
}

// How far an artery has wandered off its base line at this point along it.
// Smooth, so consecutive cells differ by 0 or 1 and the corridor stays a
// corridor rather than breaking into steps.
function wander(along, base, salt) {
  // fBm of value noise clusters hard around 0.5 — its standard deviation is
  // only about 0.13 — so the obvious `(n - 0.5) * range` rounds to zero almost
  // everywhere and the "wandering" corridors come out laser straight. Scale by
  // roughly 1/sd first, then clamp to the intended range.
  const n = (fbm(along * 0.055 + salt, base * 0.37 + salt * 2, 2) - 0.5) * 3.6;
  const w = Math.round(n * arteryWander);
  return w < -arteryWander ? -arteryWander : w > arteryWander ? arteryWander : w;
}

// Is this cell part of the horizontal artery nearest to it? The span from the
// previous column's offset to this one's is filled in, which is what keeps the
// path connected as it wanders.
function onArteryH(cx, cy) {
  const base = Math.round(cy / artery) * artery;
  const a = wander(cx - 1, base, 0.0), b = wander(cx, base, 0.0);
  const d = cy - base;
  const lo = Math.min(a, b), hi = Math.max(a, b) + (hash2(Math.floor(cx / 6), base) > 0.72 ? 1 : 0);
  return d >= lo && d <= hi;
}

function onArteryV(cx, cy) {
  const base = Math.round(cx / artery) * artery;
  const a = wander(cy - 1, base, 7.3), b = wander(cy, base, 7.3);
  const d = cx - base;
  const lo = Math.min(a, b), hi = Math.max(a, b) + (hash2(Math.floor(cy / 6), base + 91) > 0.72 ? 1 : 0);
  return d >= lo && d <= hi;
}

// The forced cross at each lattice node. Both arteries pass within ±wander of
// the node, so a straight plus of half-length wander+1 is guaranteed to touch
// both of them — and the plus is connected to itself. That is the entire proof
// that the map has no sealed regions you can be standing in.
function onNodeCross(cx, cy) {
  const nx = Math.round(cx / artery) * artery;
  const ny = Math.round(cy / artery) * artery;
  const dx = cx - nx, dy = cy - ny;
  const reach = arteryWander + 1;
  return (dx === 0 && Math.abs(dy) <= reach) || (dy === 0 && Math.abs(dx) <= reach);
}

function onAnyArtery(cx, cy) {
  return onNodeCross(cx, cy) || onArteryH(cx, cy) || onArteryV(cx, cy);
}

// --- district structures ----------------------------------------------------
// Each returns 1 for solid, 0 for open, given absolute cell coords plus the
// block coords (used to decorrelate one block's noise from its neighbour's).

// A warren of one-wide corridors around 2x2 blocks, with enough of the
// corridor blocked off to produce dead ends and doubling back.
function dWarren(cx, cy) {
  const onX = ((cx % 3) + 3) % 3 === 0;
  const onY = ((cy % 3) + 3) % 3 === 0;
  if (!onX && !onY) return 1;
  return hash2(cx * 3.31 + 1.7, cy * 5.13 + 2.9) > 0.87 ? 1 : 0;
}

// A grid of 4x4 rooms. Every wall segment gets exactly one doorway, chosen by
// hash, so the whole district is connected and reads as a floor plan.
function dCells(cx, cy) {
  const mx = ((cx % 5) + 5) % 5, my = ((cy % 5) + 5) % 5;
  if (mx !== 0 && my !== 0) return 0;
  if (mx === 0 && my === 0) return 1;                 // corner post
  if (mx === 0) {
    const seg = Math.floor(cy / 5);
    return my === 1 + ((hash2(cx * 31.7, seg * 17.3) * 4) | 0) ? 0 : 1;
  }
  const seg = Math.floor(cx / 5);
  return mx === 1 + ((hash2(seg * 23.1, cy * 11.9) * 4) | 0) ? 0 : 1;
}

// Long parallel service halls, two cells wide, with the occasional cross-cut
// through the partition.
//
// Orientation used to be hashed from both block coordinates, which meant two
// adjacent stacks blocks pointed different ways and every hall was exactly
// fourteen cells long. It is now hashed from the perpendicular block index
// only, so every stacks block in the same row agrees — and because the hall
// spacing is keyed off absolute cell coordinates, consecutive blocks line up
// and you get a corridor that runs for eighty or a hundred metres and ends in
// the dark at both ends.
function dStacks(cx, cy, bx, by) {
  const horiz = hash2(by * 3.7 + 8.8, 41.3) > 0.5;
  const along = horiz ? cx : cy;
  const across = horiz ? cy : cx;
  if (((across % 4) + 4) % 4 < 2) return 0;                  // two-wide hall
  return hash2(along * 7.7, across * 13.3) > 0.88 ? 0 : 1;   // cross-cut
}

// The expanse. Almost nothing: floor, a lattice of thick square columns every
// six cells, and no ceiling. The columns exist so that the space has a scale —
// an empty room with no ceiling reads as a bug, and the same room with
// something in it that you can walk behind reads as enormous.
function dExpanse(cx, cy) {
  const mx = ((cx % 6) + 6) % 6, my = ((cy % 6) + 6) % 6;
  if (mx < 2 && my < 2) return 1;
  // The odd stub of a wall left standing where a partition used to be.
  return hash2(cx * 2.17 + 8.3, cy * 4.41 - 2.9) > 0.975 ? 1 : 0;
}

// Collapse. The floor gave way here and took the ceiling with it: broad
// irregular holes with narrow tongues of floor between them, and rubble where
// the walls came down. This is the one district that can kill you without
// anything in the building being involved.
function dCollapse(cx, cy, bx, by) {
  const n = fbm(cx * 0.19 + bx * 5.7, cy * 0.19 + by * 8.1, 3);
  if (n < 0.425) return PIT;                 // gone
  if (n > 0.595) return SOLID;               // what is left standing
  return 0;                                  // the ledge you edge round on
}

// Organic chambers: rooms with no straight walls at all, joined by short necks.
function dChambers(cx, cy, bx, by) {
  const n = fbm(cx * 0.23 + bx * 4.1, cy * 0.23 + by * 6.7, 3);
  if (n > 0.515) return 1;
  // Erode the chamber walls with a finer field so the rooms get pinched necks
  // and awkward alcoves instead of smooth lozenges.
  return fbm(cx * 0.55 + by * 3.3, cy * 0.55 + bx * 1.9, 2) > 0.60 ? 1 : 0;
}

// Near-solid, with one winding channel following a level set of the noise. The
// districts that make the arteries feel like the only way through.
function dDense(cx, cy, bx, by) {
  const n = fbm(cx * 0.15 + bx * 9.3, cy * 0.15 + by * 2.9, 3);
  return Math.abs(n - 0.5) < 0.032 ? 0 : 1;
}

// Open floor. Deliberately rare — the whole complaint about the old map was
// that everywhere looked like this.
function dHall(cx, cy) {
  if (hash2(cx * 12.9898, cy * 78.233) > 0.955) return 1;
  if ((cx & 3) === 0 && (cy & 3) === 0 && hash2(cx * 5.5, cy * 7.1) > 0.66) return 1;
  return 0;
}

// One large irregular room inside a thick shell. The arteries cut the shell
// where they cross it, so the way in is wherever the corridor happens to graze
// it — which is how you end up somewhere you did not mean to go.
function dVault(cx, cy, bx, by, lx, ly) {
  const edge = Math.min(lx, ly, artery - 1 - lx, artery - 1 - ly);
  if (edge < 2) return 1;
  const n = fbm(cx * 0.31 + bx * 2.3, cy * 0.31 + by * 7.9, 2);
  return n > 0.66 ? 1 : 0;    // a few stubs and islands inside
}

// Raw cell rule, before chunk caching. Returns the SOLID/PIT/anchor flags plus
// the ceiling class of the block, which is carried on every cell whatever else
// is or is not there.
function computeFlags(cx, cy) {
  const bx = Math.floor(cx / artery), by = Math.floor(cy / artery);
  const lx = cx - bx * artery, ly = cy - by * artery;

  const info = blockInfo(bx, by);
  const ceil = info.ceil;

  if (info.flags) {
    const f = info.flags[ly * artery + lx];
    // An artery running through a landmark cuts a walkway through it: it
    // removes walls, and it bridges holes. Without this a hole could sever the
    // lattice, and the lattice is the only reason the map is connected.
    if ((f & (SOLID | PIT)) && onAnyArtery(cx, cy)) return ceil;
    return f | ceil;
  }

  // Arteries and their crossings win over everything. They are also the reason
  // a district full of holes is survivable: there is always one route through a
  // block that the floor is still under.
  if (onAnyArtery(cx, cy)) return ceil;

  switch (info.kind) {
    case 'warren':   return (dWarren(cx, cy) ? SOLID : 0) | ceil;
    case 'cells':    return (dCells(cx, cy) ? SOLID : 0) | ceil;
    case 'stacks':   return (dStacks(cx, cy, bx, by) ? SOLID : 0) | ceil;
    case 'chambers': return (dChambers(cx, cy, bx, by) ? SOLID : 0) | ceil;
    case 'dense':    return (dDense(cx, cy, bx, by) ? SOLID : 0) | ceil;
    case 'hall':     return (dHall(cx, cy) ? SOLID : 0) | ceil;
    case 'expanse':  return (dExpanse(cx, cy) ? SOLID : 0) | ceil;
    case 'collapse': return dCollapse(cx, cy, bx, by) | ceil;
    case 'vault':    return (dVault(cx, cy, bx, by, lx, ly) ? SOLID : 0) | ceil;
  }
  return SOLID | ceil;
}

// chunkSize is a power of two, so cell -> chunk is a shift and cell -> offset
// within the chunk is a mask. This matters: flags() is called about seventy
// thousand times a frame now that the floor pass has to ask every pixel whether
// the ground under it exists, and the original Math.floor-plus-string-key
// version of it cost more than the raycaster did.
const CHUNK_SHIFT = Math.log2(chunkSize) | 0;
const CHUNK_MASK = chunkSize - 1;

export class World {
  constructor() {
    this.chunks = new Map(); // numeric key -> Uint8Array(chunkSize*chunkSize)
    this._lastKey = NaN;     // one-entry cache; floor scanning is very coherent
    this._lastChunk = null;
    // The outside. Null for almost every session, and for all of every session
    // in which a round is fired — see director.js. { x0, y0, x1, y1, ... }
    this.outside = null;
  }

  // Write the one place that is not generated.
  //
  // It is stamped a very long way from the spawn rather than spliced onto the
  // district you happen to be standing in, for two reasons. The generator is a
  // pure function of position with no seam logic in it, so grafting a field
  // onto a warren would mean deciding what happens along every edge; and out
  // here nothing has ever been asked about these cells, so no chunk needs
  // invalidating and no walk can reach the join.
  //
  // Layout, with the building along the top of the block and the field below it
  // in decreasing y — which is the direction you are facing when you arrive:
  //
  //     . . . . . . . . . . . . . .     open ground, ~145 cells of it
  //     . . . . . . . . . . . . . .
  //     # # # # # #     # # # # # #     the wall, four cells thick, with bays
  //     # # # # # #     # # # # # #     and one gap in it
  //
  // The whole region has to be deeper than the raycaster can see (64 cells) in
  // every direction from anywhere you are allowed to stand, or the far edge of
  // it — where the building starts again — would be in shot.
  stampOutside() {
    if (this.outside) return this.outside;
    const [ox, oy] = OUTSIDE.origin;
    const w = OUTSIDE.width, h = OUTSIDE.height;
    const doorX = ox + (w >> 1);
    const wallY = oy + h - OUTSIDE.wallDepth;   // first row of the wall
    this.outside = {
      x0: ox, y0: oy, x1: ox + w, y1: oy + h,
      wallY, doorX, doorW: OUTSIDE.doorWidth,
      // Where you are standing when the light comes back: a stride clear of the
      // doorway, facing away from the building.
      spawnX: doorX + OUTSIDE.doorWidth / 2,
      spawnY: wallY - 1.4,
      angle: -Math.PI / 2,
    };
    // Anything already built here would have been built from the generator.
    // Nothing ever is, but a stale chunk would be invisible and permanent, so
    // it costs one loop to be sure.
    for (let cy = oy - chunkSize; cy < oy + h + chunkSize; cy += chunkSize) {
      for (let cx = ox - chunkSize; cx < ox + w + chunkSize; cx += chunkSize) {
        this.chunks.delete((((cx >> CHUNK_SHIFT) & 0xffff) << 16) |
                           ((cy >> CHUNK_SHIFT) & 0xffff));
      }
    }
    this._lastKey = NaN;
    this._lastChunk = null;
    return this.outside;
  }

  // Flags for one cell of the region, or -1 if this cell is not in it.
  //
  // The ceiling class is CEIL_HIGH rather than CEIL_OPEN, which looks like the
  // wrong choice for a place with no ceiling and is the whole trick: the height
  // of a wall column is the height of the space it FACES, so this is what stops
  // the building's outside wall running up out of the frame like the façades in
  // an expanse block. It tops out at seven metres and there is sky above it.
  // Nothing draws the ceiling plane itself — the renderer skips the ceiling
  // pass entirely out here.
  _outsideFlags(cx, cy) {
    const o = this.outside;
    if (cx < o.x0 || cx >= o.x1 || cy < o.y0 || cy >= o.y1) return -1;
    const ceil = CEIL_HIGH << CEIL_SHIFT;
    if (cy < o.wallY - 2) return OUTSIDE_CELL | ceil;    // clear ground

    // The doorway. Two cells deep and then SEALED — walk back into it and there
    // is a wall two metres in. That is not a technicality about keeping you out
    // of the generator (though it is also that: past the region the districts
    // start again, holes and all). It is the better image. The way back is a
    // recess with nothing in it.
    const inDoor = cx >= o.doorX && cx < o.doorX + o.doorW;
    // Bays. A dead straight wall gives a dead straight roofline, and a roofline
    // is most of what tells you that the thing behind you is a building rather
    // than a wall. Every ninth column or so the frontage steps out into the
    // field — and the parts that step out are a storey lower, so the skyline
    // has something to do. See the renderer: out here a wall's height comes
    // from the WALL cell rather than from the space in front of it, which is
    // the only reason a varying roofline is possible at all.
    const bay = !inDoor && Math.abs(cx - o.doorX) > 3 &&
      hash2(Math.floor(cx / 9) * 3.7 + 5.1, 19.3) > 0.62;
    const height = (bay ? CEIL_STD : CEIL_HIGH) << CEIL_SHIFT;
    const front = o.wallY - (bay ? 2 : 0);
    if (cy < front) return OUTSIDE_CELL | ceil;
    if (inDoor && cy < o.wallY + 2) return OUTSIDE_CELL | ceil;
    return SOLID | height;
  }

  _getChunk(ccx, ccy) {
    const key = ((ccx & 0xffff) << 16) | (ccy & 0xffff);
    if (key === this._lastKey) return this._lastChunk;
    let chunk = this.chunks.get(key);
    if (chunk === undefined) {
      chunk = new Uint8Array(chunkSize * chunkSize);
      const baseX = ccx * chunkSize;
      const baseY = ccy * chunkSize;
      // Only pay for the region test on the handful of chunks that touch it.
      const o = this.outside;
      const over = !!o && baseX < o.x1 && baseX + chunkSize > o.x0 &&
                          baseY < o.y1 && baseY + chunkSize > o.y0;
      let hasPit = false, ceilBits = 0;
      for (let y = 0; y < chunkSize; y++) {
        for (let x = 0; x < chunkSize; x++) {
          const cx = baseX + x, cy = baseY + y;
          let f = over ? this._outsideFlags(cx, cy) : -1;
          if (f < 0) f = computeFlags(cx, cy);
          if (f & PIT) hasPit = true;
          ceilBits |= 1 << ((f & CEIL_MASK) >> CEIL_SHIFT);
          chunk[y * chunkSize + x] = f;
        }
      }
      chunk.hasPit = hasPit;
      chunk.ceilBits = ceilBits;
      this.chunks.set(key, chunk);
    }
    this._lastKey = key;
    this._lastChunk = chunk;
    return chunk;
  }

  // All flags for a cell. The hot path for DDA, collision and the floor pass.
  flags(cx, cy) {
    const chunk = this._getChunk(cx >> CHUNK_SHIFT, cy >> CHUNK_SHIFT);
    return chunk[((cy & CHUNK_MASK) << CHUNK_SHIFT) | (cx & CHUNK_MASK)];
  }

  // Blocks sight and rays.
  isWall(cx, cy) { return (this.flags(cx, cy) & SOLID) !== 0; }

  // Could there be a hole in the floor anywhere the renderer might see from
  // here? Each chunk records whether it contains one, so this is nine chunk
  // lookups covering at least sixteen cells in every direction — past which the
  // fog has taken everything anyway. When it is false the floor pass skips its
  // per-pixel test entirely.
  anyPitNear(px, py) {
    const ccx = Math.floor(px) >> CHUNK_SHIFT, ccy = Math.floor(py) >> CHUNK_SHIFT;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this._getChunk(ccx + dx, ccy + dy).hasPit) return true;
      }
    }
    return false;
  }

  // Open to look across, and there is no floor. You can walk into one of these.
  // Nothing else can.
  isPit(cx, cy) { return (this.flags(cx, cy) & PIT) !== 0; }

  // Not in the building. True only for cells of the stamped region, and only in
  // a session that reached it. The props scatterer and the renderer both ask.
  isOutside(cx, cy) { return (this.flags(cx, cy) & OUTSIDE_CELL) !== 0; }

  // Cannot be walked into by anything that has any sense — which is everything
  // in the building except you. The player deliberately does NOT use this: see
  // player.js, where a hole is something you find out about on the way down.
  blocked(cx, cy) { return (this.flags(cx, cy) & (SOLID | PIT)) !== 0; }

  // Which of the four ceilings is over this cell. Cheap enough to ask per
  // pixel, which the renderer does.
  ceilClass(cx, cy) { return (this.flags(cx, cy) & CEIL_MASK) >> CEIL_SHIFT; }

  // How high the ceiling is over this cell, in wall heights. For an open block
  // this is how far up the walls run before there is simply nothing.
  ceilHeight(cx, cy) { return CEIL_HEIGHT[this.ceilClass(cx, cy)]; }

  // Which ceiling classes exist anywhere the renderer might see from here, as a
  // bitmask. The ceiling has to be cast once per distinct height present, so on
  // the overwhelmingly common frame where the answer is "one" it costs exactly
  // what it always did. Same nine-chunk trick as anyPitNear.
  ceilBitsNear(px, py) {
    const ccx = Math.floor(px) >> CHUNK_SHIFT, ccy = Math.floor(py) >> CHUNK_SHIFT;
    let bits = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) bits |= this._getChunk(ccx + dx, ccy + dy).ceilBits;
    }
    return bits;
  }

  isPropAnchor(cx, cy) { return (this.flags(cx, cy) & PROP_ANCHOR) !== 0; }
  isGunAnchor(cx, cy) { return (this.flags(cx, cy) & GUN_ANCHOR) !== 0; }

  // Is this cell part of the guaranteed corridor lattice? Used to pick a spawn
  // that is definitely on the connected part of the map.
  onArtery(cx, cy) { return onAnyArtery(cx, cy); }

  // Which district or landmark covers this cell.
  districtAt(cx, cy) {
    return blockInfo(Math.floor(cx / artery), Math.floor(cy / artery)).kind;
  }

  // The landmark covering this cell, or null. The director uses this to hang
  // events off specific rooms.
  landmarkAt(cx, cy) {
    return blockInfo(Math.floor(cx / artery), Math.floor(cy / artery)).landmark;
  }

  // Centre of the block this cell sits in, in world units.
  blockCenter(cx, cy) {
    const bx = Math.floor(cx / artery), by = Math.floor(cy / artery);
    return { x: (bx + 0.5) * artery, y: (by + 0.5) * artery };
  }

  // Which of the wall materials this cell is built from. Constant across a
  // whole block, so a run of wall never changes material halfway along.
  wallStyle(cx, cy) {
    return blockInfo(Math.floor(cx / artery), Math.floor(cy / artery)).style;
  }

  // Nearest cell inside `radius` carrying a given anchor flag, or null. Used by
  // the gun placer so the one object that matters ends up in a room you will
  // remember rather than in the middle of a corridor.
  nearestAnchor(px, py, radius, flag) {
    const cx0 = Math.floor(px), cy0 = Math.floor(py);
    let best = null, bestD = Infinity;
    const r = Math.ceil(radius);
    const radius2 = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = cx0 + dx, cy = cy0 + dy;
        if ((this.flags(cx, cy) & flag) === 0) continue;
        const d = dx * dx + dy * dy;
        if (d > radius2) continue;
        if (d < bestD) { bestD = d; best = { cx, cy }; }
      }
    }
    return best;
  }

  // Deterministic texture-variant pick for a wall cell. Retained for callers
  // that want per-cell variation; the renderer no longer uses it.
  wallVariant(cx, cy, variants) {
    return Math.floor(hash2(cx * 0.731, cy * 1.317) * variants);
  }

  // Which exposed face of this wall cell carries a blood smear?
  // -1 = none, 0 = west, 1 = east, 2 = north, 3 = south.
  bloodWallFace(cx, cy) {
    if (!this.isWall(cx, cy)) return -1;
    if (hash2(cx * 131 + cy * 53, cy * 97 + cx * 29) < 1 - DECALS.bloodWallChance) return -1;

    const faces = [];
    if (!this.isWall(cx - 1, cy)) faces.push(0);
    if (!this.isWall(cx + 1, cy)) faces.push(1);
    if (!this.isWall(cx, cy - 1)) faces.push(2);
    if (!this.isWall(cx, cy + 1)) faces.push(3);
    if (!faces.length) return -1;

    const pick = Math.floor(hash2(cx * 43 + 11, cy * 71 + 17) * faces.length);
    return faces[pick];
  }

  // Spawn on the artery lattice. Anywhere else risks dropping the player into
  // an interior pocket of a district that happens not to reach the corridors.
  findSpawn() {
    for (let r = 0; r < 40; r++) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (Math.abs(x) !== r && Math.abs(y) !== r && r > 0) continue;
          if (!this.onArtery(x, y) || this.blocked(x, y)) continue;
          // Somewhere it is possible to take a step.
          let open = 0;
          if (!this.blocked(x + 1, y)) open++;
          if (!this.blocked(x - 1, y)) open++;
          if (!this.blocked(x, y + 1)) open++;
          if (!this.blocked(x, y - 1)) open++;
          if (open >= 2) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }
}
