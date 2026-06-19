// world.js — infinite map made of cached 16x16 chunks.
//
// Layout rules:
//  * A regular grid of "streets" (every WORLD.streetSpacing cells) is forced
//    open. This guarantees the player can always navigate — you can never be
//    sealed in, which keeps the dread psychological rather than frustrating.
//  * Everything else is decided by fBm noise, producing organic clumps of
//    mono-yellow rooms and partition walls between the streets.
//
// Cells are addressed in absolute integer coordinates; chunks are generated
// lazily the first time any ray or query touches them, then memoised forever
// (a real session never wanders far enough to matter).

import { WORLD, DECALS } from './config.js';
import { fbm } from './noise.js';
import { hash2 } from './mathutils.js';

const { chunkSize, streetSpacing, wallThreshold, noiseScale } = WORLD;

// Raw cell rule, before chunk caching. 1 = solid wall, 0 = open.
function computeCell(cx, cy) {
  // Streets: any cell on a spacing line is open corridor.
  if (((cx % streetSpacing) + streetSpacing) % streetSpacing === 0) return 0;
  if (((cy % streetSpacing) + streetSpacing) % streetSpacing === 0) return 0;

  // Rooms / partitions from fBm.
  const n = fbm(cx * noiseScale, cy * noiseScale, 4);
  if (n > wallThreshold) return 1;

  // Sparse free-standing pillars in otherwise open blocks — breaks up sight
  // lines so the fog has something to hide.
  const p = hash2(cx * 12.9898, cy * 78.233);
  if (p > 0.965) return 1;

  return 0;
}

export class World {
  constructor() {
    this.chunks = new Map(); // key "cx,cy" -> Uint8Array(chunkSize*chunkSize)
  }

  _chunkKey(ccx, ccy) { return ccx + ',' + ccy; }

  _getChunk(ccx, ccy) {
    const key = this._chunkKey(ccx, ccy);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;

    chunk = new Uint8Array(chunkSize * chunkSize);
    const baseX = ccx * chunkSize;
    const baseY = ccy * chunkSize;
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        chunk[y * chunkSize + x] = computeCell(baseX + x, baseY + y);
      }
    }
    this.chunks.set(key, chunk);
    return chunk;
  }

  // Solid test for a cell (integer coords). The hot path for DDA + collision.
  isWall(cx, cy) {
    const ccx = Math.floor(cx / chunkSize);
    const ccy = Math.floor(cy / chunkSize);
    const chunk = this._getChunk(ccx, ccy);
    const lx = cx - ccx * chunkSize;
    const ly = cy - ccy * chunkSize;
    return chunk[ly * chunkSize + lx] === 1;
  }

  // Deterministic texture-variant pick for a wall cell, so the same wall always
  // looks the same and adjacent walls vary a little.
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

  // Compatibility helper for callers that only need to know whether the cell
  // has any visible blood at all.
  isBloodyWall(cx, cy) {
    return this.bloodWallFace(cx, cy) !== -1;
  }

  // Find an open spawn cell near the origin (origin is a street intersection,
  // but be defensive in case tuning changes).
  findSpawn() {
    for (let r = 0; r < 32; r++) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (!this.isWall(x, y) && !this.isWall(x + 1, y) && !this.isWall(x - 1, y))
            return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }
}
