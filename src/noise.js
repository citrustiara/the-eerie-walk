// noise.js — seeded value noise + fractional Brownian motion.
// Drives both the infinite world layout and several procedural textures.

import { hash2, smoothstep, lerp } from './mathutils.js';

let SEED = 1337;
let SALT_X = 11.3, SALT_Y = 7.9;
let EPOCH = 0;
export function setNoiseSeed(seed) {
  SEED = seed >>> 0;
  SALT_X = (SEED & 0xffff) * 0.01373 + 11.3;
  SALT_Y = ((SEED >>> 16) & 0xffff) * 0.01907 + 7.9;
  EPOCH++;
}

// Bumped every time the seed changes, so anything memoising a seed-dependent
// answer can tell that its cache is from a different world.
export function noiseEpoch() { return EPOCH; }

// A pair of per-session offsets for callers that pick things with a plain hash
// rather than with the noise field. Without this the district and landmark
// layout is identical in every session — only the fBm-driven interiors change —
// so the ward is always in the same place relative to where you started.
export function seedSalt() { return [SALT_X, SALT_Y]; }

// Hash that folds the global seed in, so a new session reshapes the world.
function h(x, y) {
  return hash2(x * 73856093 ^ SEED, y * 19349663 ^ (SEED << 1));
}

// Smooth value noise: bilinear interpolation of lattice hashes with a
// smoothstep fade. Output in [0,1].
export function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const v00 = h(x0, y0),     v10 = h(x0 + 1, y0);
  const v01 = h(x0, y0 + 1), v11 = h(x0 + 1, y0 + 1);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

// fBm — stack octaves of value noise at increasing frequency / decreasing
// amplitude. Normalised back to roughly [0,1].
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
