// terrain.js — the lie of the land outside, and the only place it is decided.
//
// WHY THIS IS A MODULE AND NOT A TEXTURE. The field used to be a plane: one
// tiling mud texture, four cells to a tile, under a painted treeline. From a
// doorway that is fine for about two seconds — and the ending gives you nearly
// forty. Twelve metres of period against a seventy-four unit view distance is
// eighteen repeats of the same puddle receding to the horizon, and a player who
// walks in any direction at all is walking across wallpaper again, which is the
// one thing the outside cannot be.
//
// So there is a height field now, and everything that wants to know about the
// ground asks it: the texture baker (which turns it into shading and water),
// the world (which answers "am I standing in the stream"), and the scatterer
// (which will not stand a tree in three feet of water, but will stand a dead
// one there on purpose).
//
// FLAT IS A FEATURE, NOT A LIMITATION. The floor is cast affinely from a single
// plane at z = 0 and nothing in the renderer can raise it — a real heightmap
// would mean a per-column march, a second z-buffer, and props that no longer
// sit on the ground. The relief here is therefore ENTIRELY LIT, not built: the
// gradient of the field becomes a shading term baked into the ground, and the
// bottoms of it fill with standing water. Both of those are things the eye
// reads as terrain long before it reads silhouette, which is why a photograph
// of a field looks like a field.
//
// Keep the amplitude small enough that the lie is not caught. Metre-deep
// hollows over twenty-metre wavelengths shade beautifully and never contradict
// the flat plane your feet are actually on; a six-metre hill would.
//
// COORDINATES. Everything here is in CELLS, measured from the door — `across`
// is left/right of the doorway and `out` is how far into the field you have
// walked. That is the frame the ending is authored in ("the stream is twenty
// out"), and it keeps the numbers legible where region-local x/y would not.
// One cell is three metres; heights are in METRES, which is the unit the shape
// of this stuff is easiest to think in.
//
// SEEDING. Deliberately none. Every other surface in the game is reseeded per
// session because the building is different every time; the outside is one
// hand-built place that is always the same place, and the stream is in the same
// bend of it whichever run got you there. That is also why this uses its own
// hash-based noise rather than noise.js, whose field moves with the world seed.

import { hash2, smoothstep, lerp, clamp } from './mathutils.js';

// --- self-contained value noise ---------------------------------------------
// Same construction as noise.js, minus the seed. See above for why.

function vn(x, y, salt) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smoothstep(x - x0), fy = smoothstep(y - y0);
  const s = salt * 8191;
  const v00 = hash2(x0 + s, y0 - s), v10 = hash2(x0 + 1 + s, y0 - s);
  const v01 = hash2(x0 + s, y0 + 1 - s), v11 = hash2(x0 + 1 + s, y0 + 1 - s);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

function fbm2(x, y, oct, salt) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vn(x * freq, y * freq, salt + i);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// --- the shape of it ---------------------------------------------------------

export const FIELD = {
  // WHERE THE WATER IS. Sea level is zero and the ground is signed against it,
  // so "water" is not a separate map — it is wherever the field came out below
  // the line, which is what makes a shoreline follow the contours instead of
  // being drawn on top of them.
  waterline: 0,
  // How deep it is allowed to get. You wade the stream, you do not swim it,
  // and the ending never has to decide what drowning looks like — which is
  // what the cap is for, because the trough below is deeper than this and
  // without it the middle of a pool would be over your head.
  maxDepth: 0.85,

  // THE STREAM. The one piece of the field that is authored rather than rolled,
  // because the walk out needs something to HAPPEN on it. It ends up about
  // twenty cells out — sixty metres, roughly two thirds of the way through the
  // twenty-six the ending gives you, so you reach it with time to stand in it
  // and none to get bored of the far bank.
  //
  // It runs across your path rather than along it. A watercourse you walk
  // beside is scenery; one you have to step into is the last decision the game
  // asks you for, and it is not a decision at all, which is the point.
  //
  // The number written here is FOURTEEN because the wander below is not
  // zero-mean at the doorway: both terms are sines with a phase and at `across`
  // zero they add up to nearly six cells. Straight out of the door the water is
  // at nineteen, which is the number that matters and is not the one you set.
  streamOut: 14,
  streamWander: [[0.055, 4.2, 0], [0.021, 6.0, 1.7]],   // freq, cells, phase
  streamHalf: 2.3,          // half-width of the trough, in cells
  streamDepth: 1.25,        // ...and how far below the waterline the bed sits
  // ...and it does not run at one width. A channel of constant section is a
  // canal; a stream pinches between banks and then spreads into something you
  // would have to walk round, and the difference is one slow sine along its
  // length. The pools are also where the drowned trunks and most of the reeds
  // end up, because both of those are placed against depth.
  streamSwellFreq: 0.013,
  streamSwell: [0.80, 0.55],  // mean, and how far either side of it

  // HOW HIGH THE LAND SITS ABOVE ITS OWN WATER. This is the number that decides
  // whether the ending is a field with a stream in it or a lake with some grass
  // round the edge, and the first draft got it wrong: with the rolling ground
  // swinging a full metre either way and nothing lifting it, half of everything
  // in sight came out under water, the stream disappeared into the general
  // flooding, and the player walked out of the door directly into it.
  //
  // Water has to be the EXCEPTION for any of it to read. The rolling ground now
  // swings about half as far and sits comfortably above the line, so standing
  // water happens in the stream, in the pools it swells into, and in the few
  // hollows out past the fall that are deep enough to catch it. Roughly a fifth
  // of the field, which is a wet field; the other four fifths are what makes
  // that fifth legible as water at all.
  baseLift: 0.52,

  // The apron. The building stands on made ground and the first few metres out
  // of the door drain away from it, so you never arrive ankle-deep in water on
  // the frame the light comes back — which would read as a bug in the ending
  // rather than as weather.
  apronOut: 11,
  apronLift: 1.05,

  // The general fall of the land away from the building, which is why there is
  // water out there at all and none of it up here.
  fallFrom: 26,             // cells out before the ground starts dropping
  fallOver: 70,             // ...and over how many more it has fully dropped
  fallBy: 0.34,

  // Two scales of rolling ground. The broad one makes hollows big enough to
  // hold a flood you can see across; the fine one keeps the shoreline from
  // being a smooth curve, which is the tell that says "contour of a noise
  // field" rather than "edge of a puddle".
  broadFreq: 0.019, broadAmp: 1.30,
  fineFreq: 0.082, fineAmp: 0.40,
};

// Where the middle of the stream is, this far across the field.
function streamAt(across) {
  let s = FIELD.streamOut;
  for (const [f, a, p] of FIELD.streamWander) s += Math.sin(across * f + p) * a;
  return s;
}

// Height of the ground in metres, signed against the waterline. Positive is dry
// land, negative is under water.
//
// `across` and `out` are in cells from the doorway; see the header.
export function groundHeight(across, out) {
  const broad = (fbm2(across * FIELD.broadFreq, out * FIELD.broadFreq, 3, 1) - 0.5) *
    FIELD.broadAmp;
  const fine = (fbm2(across * FIELD.fineFreq, out * FIELD.fineFreq, 2, 5) - 0.5) *
    FIELD.fineAmp;

  // The trough, gaussian across its width so the banks roll into it rather than
  // stepping down. Wider than it is deep, like every stream in a flat field —
  // and both of those vary together along its length, so it pinches to a
  // channel you step over and swells into pools you do not.
  const swell = FIELD.streamSwell[0] +
    Math.sin(across * FIELD.streamSwellFreq + 0.9) * FIELD.streamSwell[1];
  const d = (out - streamAt(across)) / (FIELD.streamHalf * (0.55 + swell * 0.75));
  const trough = FIELD.streamDepth * swell * Math.exp(-d * d);

  const fall = clamp((out - FIELD.fallFrom) / FIELD.fallOver, 0, 1) * FIELD.fallBy;
  const apron = clamp(1 - out / FIELD.apronOut, 0, 1) * FIELD.apronLift;

  return FIELD.baseLift + broad + fine - trough - fall + apron;
}

// How deep the water is here, in metres. Zero on dry land.
export function waterDepth(across, out) {
  const h = groundHeight(across, out);
  return h >= FIELD.waterline ? 0 : Math.min(FIELD.maxDepth, FIELD.waterline - h);
}

// The SHADING of all this — the term that actually does the work of making a
// flat plane read as ground — is not here. It is a gradient of the field, and
// taking a gradient by calling this function four more times per texel costs
// five times what baking the field once does. So terrainTexture() in
// textures.js bakes heights into an array and differences the array instead.
// This module decides the shape; the baker decides what light does to it.
