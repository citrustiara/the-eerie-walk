// textures.js — everything you see is generated at boot from math, no images.
// Each texture is { w, h, data:Uint32Array } of little-endian packed RGBA so the
// renderer can blit texels with a single array read.
//
// REPETITION, ROUND TWO. The first version tiled one 64x64 carpet across every
// cell. The second fixed the floor and ceiling (256x256 spanning four cells,
// generated toroidally so the tile has no seam) but left the walls sampled
// per-cell, mirrored and re-shaded from a per-cell hash. That is what produced
// the visible mis-registration: a flat wall was a patchwork of three-metre
// panels, each a different base yellow, each a different brightness, half of
// them mirrored, and none of them lining up with its neighbour.
//
// So walls are 256x64 spanning FOUR cells and are sampled by *world* position
// rather than per cell — the wallpaper runs continuously down a corridor and
// across every cell boundary, exactly like wallpaper.
//
// The variety that the per-cell scramble was faking is not here at all any
// more. It is in the SHAPE of the rooms (see world.js) and in how far gone the
// one wallpaper is (below). Ten unrelated materials were tried and thrown away:
// turning a corner into riveted steel does not say "elsewhere in this building",
// it says "a different building".

import { packRGBA, hash2, clamp } from './mathutils.js';
import { fbm } from './noise.js';

export const WALL_W = 256;   // wall texel width...
export const WALL_H = 64;    // ...and height: floor to ceiling
export const WTILE = 4;      // ...spanning this many world cells, so 64 texels
                             // per cell — same density as the floor.
                             //
                             // This was two cells. A corridor is one texture
                             // repeated along its length, so at two cells every
                             // mould bloom and every tear came back exactly
                             // every six metres, which the eye picks up
                             // instantly and reads as a tiling artefact rather
                             // than as decay. Four cells doubles the period to
                             // twelve metres; the renderer also modulates the
                             // whole thing by a world-space grime field (see
                             // renderer.js) so two passes of the same texture
                             // are never the same brightness.
export const FS = 256;       // floor/ceiling texture size
export const FTILE = 4;      // ...spanning this many world cells

// MATERIALS, ROUND THREE. There used to be ten of them: tile, concrete, steel,
// oxblood paint, wood panelling. Turning a corner into a riveted steel corridor
// did tell you that you were somewhere else — it told you you were in a
// different *building*, and the whole point of this place is that there is only
// one building and it never ends.
//
// So there is now exactly one wall in the whole level: mustard wallpaper over
// plasterboard, 16-inch sheets, damp. What varies is how far gone it is. Six
// stages of the same wall — barely touched, soaked, peeled off in sheets, black
// with mould, used for something, and stripped back to the board. The base
// colour and the stripe are identical in all six, so a change reads as decay
// rather than as decor.
//
// The index into this array is what world.wallStyle() hands back to the
// renderer, so the order is part of the contract between them.
export const WALL_STYLES = [
  'paper',        // 0  the yellow. Damp, but intact.
  'paperDamp',    // 1  water has been coming through this one for years
  'paperTorn',    // 2  hanging off in sheets, damp plaster behind
  'paperRot',     // 3  black mould has taken it
  'paperBlood',   // 4  someone bled a long way down this one
  'paperBare',    // 5  paper mostly gone; taped plasterboard
];

// Every wall starts here. Do not vary it per style — this single colour is what
// makes the place one place. The band above the wallpaper uses it too.
export const PAPER_BASE = [190, 170, 96];

// Eight faint printed stripes per cell. Shared with the upper band so the two
// textures line up vertically where they meet, which is the whole reason the
// join reads as a picture rail rather than as a seam.
const STRIPE_PER_CELL = 8;
const STRIPE_CYCLES = STRIPE_PER_CELL * WTILE;

// How far gone each stage is. All the same wall.
const WEAR = {
  paper:      { salt: 1, damp: 0.30, tear: 0.10 },
  paperDamp:  { salt: 2, damp: 1.00, tear: 0.28, rot: 0.30 },
  paperTorn:  { salt: 3, damp: 0.50, tear: 1.00, rot: 0.10 },
  paperRot:   { salt: 4, damp: 0.85, tear: 0.55, rot: 1.00 },
  paperBlood: { salt: 5, damp: 0.55, tear: 0.35, rot: 0.20, blood: 1.00 },
  paperBare:  { salt: 6, damp: 0.65, tear: 0.55, rot: 0.25, strip: 1.00 },
};

function make(w, h) {
  return { w, h, data: new Uint32Array(w * h) };
}

// fBm that wraps exactly over [0,sx) — and over [0,sy) too when sy is given.
// Cross-fading the four corner samples of a torus is the standard trick; it
// costs boot time only, and it is the whole difference between "a texture" and
// "a visible grid". The blend flattens contrast in the middle, so the result is
// pushed back out around 0.5.
function tfbm(x, y, sx, sy, freq, oct, ox = 0, oy = 0) {
  const u = x / sx;
  const a = fbm((x + ox) * freq, (y + oy) * freq, oct);
  const b = fbm((x - sx + ox) * freq, (y + oy) * freq, oct);
  let v;
  if (!sy) {
    v = a * (1 - u) + b * u;
  } else {
    const t = y / sy;
    const c = fbm((x + ox) * freq, (y - sy + oy) * freq, oct);
    const d = fbm((x - sx + ox) * freq, (y - sy + oy) * freq, oct);
    v = (a * (1 - u) + b * u) * (1 - t) + (c * (1 - u) + d * u) * t;
  }
  return clamp(0.5 + (v - 0.5) * 1.3, 0, 1);
}

// Convenience: wraps in x over the wall width, free in y (walls do not tile
// vertically — the top is ceiling and the bottom is skirting).
function wn(x, y, freq, oct, ox = 0, oy = 0) {
  return tfbm(x, y, WALL_W, 0, freq, oct, ox, oy);
}

// --- shared wall furniture --------------------------------------------------
// Every wall in the building meets the floor the same way and has been damp for
// the same number of years, whatever it is made of. Doing this once keeps the
// ten materials reading as ten materials rather than ten unrelated tilesets.

function skirting(px, y, height, r, g, b, k = 0.42) {
  if (y < height) return;
  const edge = y === height ? 0.66 : 1;
  return [r * k * edge, g * k * edge, b * k * edge];
}

// Damp creeping up from the floor and down from the ceiling. Multiplicative, so
// it darkens whatever the material happens to be.
function damp(x, y, salt) {
  const rise = clamp((y - WALL_H * 0.72) / (WALL_H * 0.28), 0, 1);
  const fall = clamp((WALL_H * 0.18 - y) / (WALL_H * 0.18), 0, 1);
  const n = wn(x, y, 0.09, 3, salt, 17);
  return 1 - (rise * 0.34 + fall * 0.22) * (0.35 + n * 0.9);
}

// --- the one wall -----------------------------------------------------------
//
// Layers, bottom to top: the paper itself, then water, then the paper coming
// away from the wall, then what is growing on it, then what has been spilled on
// it. A stage is just which of those layers are turned up. Every one of them
// leaves the base colour and the stripe alone, so the six stages read as the
// same corridor at six different ages rather than as six corridors.

function paperTexture(wear) {
  const t = make(WALL_W, WALL_H);
  const salt = wear.salt;
  const dampK = wear.damp || 0, tear = wear.tear || 0, rot = wear.rot || 0;
  const blood = wear.blood || 0, strip = wear.strip || 0;
  const [br, bg, bb] = PAPER_BASE;
  const stripeK = STRIPE_CYCLES * (Math.PI * 2 / WALL_W);
  const baseboard = WALL_H - 8;

  for (let y = 0; y < WALL_H; y++) {
    // Row 0 is the ceiling and row WALL_H-1 is the floor, so this runs 0 at the
    // top to 1 at the skirting. Everything that falls, pools or grows uses it.
    const low = y / (WALL_H - 1);
    for (let x = 0; x < WALL_W; x++) {
      const stripe = (Math.sin(x * stripeK) * 0.5 + 0.5) * 9 - 4.5;
      const stain = (wn(x, y, 0.055, 4, salt * 37, 0) - 0.5) * 44;
      const grain = (hash2(x + salt * 99, y) - 0.5) * 16;

      let r = br + stripe + stain + grain;
      let g = bg + stripe + stain * 0.9 + grain;
      let b = bb + stripe * 0.6 + stain * 0.6 + grain;

      if (y % 32 === 0) { r -= 22; g -= 20; b -= 15; }   // where two sheets meet

      // --- water ------------------------------------------------------------
      // It comes in at the ceiling and goes down, and the paper browns along
      // the run. This is the layer every stage has some of.
      if (dampK > 0) {
        const run = wn(x, y * 0.125, 0.16, 3, salt * 11, 0);
        if (run > 0.62) {
          const k = clamp((run - 0.62) * 3.0, 0, 0.78) * dampK * (0.40 + low * 0.60);
          r += (74 - r) * k; g += (66 - g) * k; b += (44 - b) * k;
        }
      }

      // --- the paper letting go ---------------------------------------------
      // Sheets have come off the wall. Behind them is plaster that has been wet
      // for a decade; along the split the paper is standing proud of the wall
      // and catches the torch, which is the only reason a tear reads as a tear
      // rather than as a stain.
      let bare = 0;
      if (tear > 0) {
        const peel = wn(x, y, 0.075, 3, 40 + salt * 5, salt * 23);
        const d = peel - (0.86 - tear * 0.22);
        if (d > 0) {
          // Damp plaster, warmer and paler than the paper, and mottled on its
          // own account so a bare patch is not a flat sticker.
          bare = clamp(d * 18, 0, 1);
          const pm = (wn(x, y, 0.26, 2, 7, salt * 3) - 0.5) * 26;
          const pr = 150 - low * 34 + pm, pg = 141 - low * 34 + pm, pb = 125 - low * 30 + pm;
          r += (pr - r) * bare; g += (pg - g) * bare; b += (pb - b) * bare;
          // Along the split the paper is standing off the wall, and the torch
          // catches the curl. This one line is the whole difference between a
          // tear and a stain.
          const lip = clamp(1 - d * 34, 0, 1);
          r += (222 - r) * lip * 0.6; g += (212 - g) * lip * 0.6; b += (178 - b) * lip * 0.55;
        } else if (d > -0.035) {
          // ...and the curl throws a shadow on the paper just outside it.
          const k = (1 + d / 0.035) * 0.34;
          r *= 1 - k; g *= 1 - k; b *= 1 - k;
        }
      }

      // --- stripped back to the board ---------------------------------------
      // Past a certain point there is no paper left to peel: grey plasterboard,
      // taped joints on a 42-texel pitch, and a few shreds still clinging on.
      if (strip > 0) {
        const held = wn(x, y, 0.06, 3, 71 + salt, 13);
        const keep = clamp((held - 0.58) * 5, 0, 1);      // 1 = paper survived
        const k = strip * (1 - keep);
        const joint = Math.abs(((x + 21) % 42) - 21);
        let pr = 126, pg = 120, pb = 108;
        if (joint < 3) { pr += 15; pg += 14; pb += 12; }  // the tape
        if (joint < 1) { pr -= 28; pg -= 27; pb -= 24; }  // ...and its seam
        const board = (wn(x, y, 0.30, 2, 3, salt * 9) - 0.5) * 20;
        r += (pr + board - r) * k; g += (pg + board - g) * k; b += (pb + board - b) * k;
        if (bare < k) bare = k;
      }

      // --- what is growing on it --------------------------------------------
      // Mould. Blooms outward from the damp, worse low down and worse where the
      // paper has already gone, with a pale spreading fringe at its edge.
      if (rot > 0) {
        const bloom = wn(x, y, 0.075, 4, 88 + salt * 3, 29);
        // ...modulated by a much slower field, so mould comes in stretches with
        // clean wall between them. Without this every bloom is the same size
        // and the same distance from the next one, and twelve metres later the
        // identical arrangement comes round again.
        const cover = wn(x, y * 0.4, 0.018, 2, 5, salt * 3);
        const bias = 0.63 - low * 0.17 - bare * 0.05 + (0.5 - cover) * 0.26;
        if (bloom > bias) {
          const k = clamp((bloom - bias) * 4.2, 0, 0.94) * rot;
          r += (30 - r) * k; g += (34 - g) * k; b += (24 - b) * k;
          const fringe = clamp(1 - (bloom - bias) * 11, 0, 1) * rot * 0.35;
          r += (96 - r) * fringe; g += (100 - g) * fringe; b += (64 - b) * fringe;
        }
      }

      // --- what has been spilled on it --------------------------------------
      // Old blood, gone brown. The first version scattered hard red dots evenly
      // over the whole wall, which read as wallpaper with a pattern on it — the
      // exact thing this file exists to avoid. It is now confined to two or
      // three PATCHES: inside a patch there is a run downward and a scatter of
      // thrown spots, and outside one there is nothing at all.
      if (blood > 0) {
        const where = wn(x, y * 0.10, 0.055, 2, 17 + salt * 7, 61);
        const zone = clamp((where - 0.52) * 5, 0, 1) * blood;
        if (zone > 0) {
          const run = wn(x, y * 0.035, 0.34, 3, 5 + salt, 23);
          const fade = clamp(1 - (low - 0.30) / 0.70, 0, 1);
          const k = clamp((run - 0.50) * 2.2, 0, 1) * zone * fade * (low > 0.28 ? 1 : 0.22);
          r += (78 - r) * k; g += (14 - g) * k; b += (13 - b) * k;
          // Thrown rather than poured, and only ever inside a patch.
          const sp = hash2(x * 7 + salt * 13, y * 11 + 3);
          if (sp > 0.972) {
            const k2 = zone * (0.55 + (sp - 0.972) * 16);
            r += (66 - r) * k2; g += (11 - g) * k2; b += (10 - b) * k2;
          }
        }
      }

      const d = damp(x, y, salt);
      r *= d; g *= d; b *= d;
      const sk = skirting(x, y, baseboard, r, g, b, 0.45);
      if (sk) { r = sk[0]; g = sk[1]; b = sk[2]; }

      t.data[y * WALL_W + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

function wallTexture(style) {
  return paperTexture(WEAR[style] || WEAR.paper);
}

// --- above the wallpaper ----------------------------------------------------
//
// The wallpaper stops at three metres because that is where the ceiling is
// supposed to be. In the rooms where it is not — the halls, the vaults, and the
// open blocks with no ceiling at all — something has to be there.
//
// The first version made it bare grey board with concrete courses. It was
// architecturally sensible and it looked like a completely different building
// bolted on above head height, which is the same mistake the ten materials
// made. So the paper simply KEEPS GOING: same mustard, same stripe at the same
// pitch, same sheet seams, just dirtier and darker the higher it gets, with a
// picture rail at the join so the change of texture reads as a moulding rather
// than as a seam. A seven-metre hall is now the same corridor with more of it.
//
// Above about five metres — which only the open blocks ever show — it gives out
// into soot and then into nothing, and that is where the windows are.
//
// Row 0 of this texture is the TOP of the band and the last row is the bottom,
// the same direction as the wall texture and as the screen, so the renderer can
// walk both with one increasing accumulator.

export const UP_W = 256;        // ...spanning WTILE cells, same as the wall
export const UP_H = 256;        // ...at the same 64 texels per wall height
export const UP_FROM = 1.0;     // wall-heights above the floor where it starts
export const UP_SPAN = 4.0;     // ...and how far up it goes
export const UP_TOP = UP_FROM + UP_SPAN;

function upperTexture(windows) {
  const t = make(UP_W, UP_H);
  const SC = UP_H / UP_SPAN;              // texels per wall height
  const [br, bg, bb] = PAPER_BASE;
  const stripeK = STRIPE_CYCLES * (Math.PI * 2 / UP_W);
  const un = (x, y, freq, oct, ox = 0, oy = 0) => tfbm(x, y, UP_W, 0, freq, oct, ox, oy);

  for (let y = 0; y < UP_H; y++) {
    const z = UP_TOP - (y + 0.5) / SC;    // wall-heights above the floor
    const above = z - UP_FROM;            // 0 at the top of the lower wallpaper
    // Nothing has cleaned or lit any of this in a very long time. Soot and dust
    // climb the wall; by five metres the paper is more grey than yellow, and by
    // the top of the band there is effectively nothing left to see.
    const soot = clamp(above / 3.2, 0, 1) ** 0.8;
    const vanish = clamp((UP_TOP - z) / 0.9, 0, 1);

    for (let x = 0; x < UP_W; x++) {
      const stripe = (Math.sin(x * stripeK) * 0.5 + 0.5) * 9 - 4.5;
      const stain = (un(x, y, 0.055, 4, 37, 400) - 0.5) * 44;
      const grain = (hash2(x + 99, y + 900) - 0.5) * 16;
      let r = br + stripe + stain + grain;
      let g = bg + stripe + stain * 0.9 + grain;
      let b = bb + stripe * 0.6 + stain * 0.6 + grain;
      let emit = 0;

      // Sheet seams, on the same half-wall-height pitch as below.
      if (y % 32 === 0) { r -= 22; g -= 20; b -= 15; }

      // Water coming down from wherever the roof failed. Much heavier up here,
      // because up here is where it starts.
      const run = un(x, y * 0.10, 0.14, 3, 11, 60);
      if (run > 0.56) {
        const k = clamp((run - 0.56) * 2.6, 0, 0.8) * (0.35 + soot * 0.65);
        r += (66 - r) * k; g += (58 - g) * k; b += (40 - b) * k;
      }
      // ...and the paper coming off in the damp.
      const peel = un(x, y, 0.06, 3, 71, 210);
      if (peel > 0.66) {
        const k = clamp((peel - 0.66) * 8, 0, 1) * 0.85;
        const pl = 136 - soot * 60;
        r += (pl - r) * k; g += ((pl - 8) - g) * k; b += ((pl - 22) - b) * k;
        const lip = clamp(1 - (peel - 0.66) * 30, 0, 1);
        r += (214 - r) * lip * 0.45; g += (204 - g) * lip * 0.45; b += (172 - b) * lip * 0.4;
      }

      // Soot: the yellow going grey and then dark with height.
      r += (58 - r) * soot * 0.72; g += (56 - g) * soot * 0.72; b += (52 - b) * soot * 0.74;

      // The picture rail the paper was trimmed against, right at the join. A
      // dark reveal with a lit top edge — real moulding, so the texture change
      // at three metres has something to be.
      if (above < 0.035) { r *= 0.45; g *= 0.45; b *= 0.44; }
      else if (above < 0.055) { r *= 1.30; g *= 1.26; b *= 1.18; }
      else if (above < 0.085) { r *= 0.80; g *= 0.80; b *= 0.80; }

      if (windows) {
        // A full stack of storeys, repeated vertically by the renderer so the
        // city façades never terminate in view. Whatever is out there is not
        // daylight — it is the colour of an overcast sky that has never moved.
        const px = x & 63;
        // Five equal storeys fill the four-unit texture exactly, keeping the
        // vertical wrap seamless.
        const storey = Math.floor(above / 0.80);
        const floorZ = above - storey * 0.80;
        const slab = floorZ < 0.10 || floorZ > 0.69;
        const transom = Math.abs(floorZ - 0.43) < 0.035;
        if (px > 7 && px < 57 && !slab && !transom) {
          const gx = px - 7;
          const dirt = un(x, y, 0.16, 3, 5, 41);
          const edge = clamp(Math.min(gx, 50 - gx) / 12, 0, 1);
          const paneId = (x >> 6) * 17 + storey;
          if (hash2(paneId * 7.7 + 3, 11) > 0.80) {
            // This one is gone. Whatever is behind a window here is not the
            // same thing that is behind the glass, and it does not glow.
            r = 15; g = 16; b = 18;
          } else {
            const glow = edge * (0.50 + dirt * 0.62);
            r = 92 + glow * 92; g = 100 + glow * 104; b = 112 + glow * 126;
            emit = glow * 150;
          }
        } else {
          r = 44; g = 45; b = 48;                       // the frame
        }
      }

      if (!emit) { r *= vanish; g *= vanish; b *= vanish; }
      t.data[y * UP_W + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0, emit | 0
      );
    }
  }
  return t;
}

// --- Damp, stained carpet. Muted brown-grey, blotchy. ----------------------
function floorTexture() {
  const t = make(FS, FS);
  for (let y = 0; y < FS; y++) {
    for (let x = 0; x < FS; x++) {
      const blotch = tfbm(x, y, FS, FS, 0.09, 5);
      const grain = (hash2(x * 3 + 7, y * 3 + 11) - 0.5) * 22;
      const base = 46 + blotch * 34;
      let r = base + 8 + grain;
      let g = base + 2 + grain;
      let b = base - 6 + grain * 0.8;
      // Occasional darker water damage.
      if (blotch > 0.72) { r *= 0.6; g *= 0.6; b *= 0.62; }
      // Worn traffic lines where the pile has been flattened by something
      // walking the same path for a very long time. At this size the wear runs
      // over several metres, which is what makes it read as a path.
      const worn = tfbm(x, y, FS, FS, 0.022, 3, 11, 5);
      if (worn > 0.60) { r *= 1.16; g *= 1.14; b *= 1.10; }
      // Burn-marks / trodden-in filth: small, sparse, high contrast. These are
      // the landmarks that stop one stretch of carpet looking like the next.
      const spot = tfbm(x, y, FS, FS, 0.14, 3, 61, 29);
      if (spot > 0.80) {
        const k = clamp((spot - 0.80) * 6, 0, 0.75);
        r += (26 - r) * k; g += (23 - g) * k; b += (22 - b) * k;
      }
      t.data[y * FS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

// --- Drop-ceiling tiles. Mostly dead fluorescent panels (that's why it's so
//     dark and the flashlight matters). Faint cool tint. ---------------------
function ceilingTexture() {
  const t = make(FS, FS);
  const mask = new Uint8Array(FS * FS);
  for (let y = 0; y < FS; y++) {
    for (let x = 0; x < FS; x++) {
      const grain = (hash2(x * 5 + 3, y * 5 + 2) - 0.5) * 12;
      let r = 38 + grain, g = 40 + grain, b = 44 + grain;

      // Tile grid lines (the metal grid holding the panels). 32 texels = half a
      // cell, so a 3 m corridor is spanned by two ceiling tiles.
      const gx = x % 32, gy = y % 32;
      const inPanel = gx > 6 && gx < 26 && gy > 6 && gy < 26;
      if (gx < 1 || gy < 1) { r *= 0.4; g *= 0.4; b *= 0.45; }

      // Sixty-four tiles fit in this texture, so each one can be individually
      // aged: most are dirty, some are missing entirely and open onto the black
      // plenum above. That per-tile variation is most of what stops a ceiling
      // this regular from reading as wallpaper.
      const th = hash2(((x / 32) | 0) * 7 + 1, ((y / 32) | 0) * 13 + 3);
      const missing = th > 0.90;
      const tileK = 0.82 + th * 0.34;

      if (inPanel) {
        if (missing) {
          // A hole. Dark, with the edge of the tile above catching a little.
          const edge = Math.min(gx - 6, 25 - gx, gy - 6, 25 - gy);
          const k = edge < 2 ? 0.55 : 0.12;
          r *= k; g *= k; b *= k * 1.1;
        } else {
          r += 10; g += 11; b += 13;
        }
      }
      r *= tileK; g *= tileK; b *= tileK;

      // Water stains blooming through the tiles.
      const stain = tfbm(x, y, FS, FS, 0.07, 4, 3, 9);
      if (stain > 0.66 && !missing) {
        const k = clamp((stain - 0.66) * 5, 0, 0.8);
        r += (58 - r) * k; g += (48 - g) * k; b += (34 - b) * k;
      }

      t.data[y * FS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
      // Tag which texels are "panel" so the renderer can make them emit light
      // when the flicker event fires. Missing tiles have nothing to light.
      mask[y * FS + x] = inPanel && !missing ? 1 : 0;
    }
  }
  t.panelMask = mask;
  return t;
}

// --- The ceiling over a room that is taller than a room should be. ----------
//
// This was poured concrete with structural beams, and it had the same problem
// as the grey upper wall: it read as a car park bolted onto the top of an
// office. It is the same suspended ceiling as everywhere else — the room is
// simply taller, which is the only thing that should be different about it.
//
// What it does have is a deeper grid, far more missing tiles (nobody has been
// up a seven-metre ladder to replace one), a warmer cast from years of nicotine
// and water, and the runs of strip light that the flicker event lights up. That
// last one is the only time you ever really see it.
function deckTexture() {
  const t = make(FS, FS);
  const mask = new Uint8Array(FS * FS);
  for (let y = 0; y < FS; y++) {
    for (let x = 0; x < FS; x++) {
      const grain = (hash2(x * 5 + 13, y * 5 + 3) - 0.5) * 11;
      let r = 44 + grain, g = 42 + grain, b = 35 + grain;

      // A coarser grid than the three-metre ceiling: one tile per cell rather
      // than two, because it is twice as far away and the finer one dissolved.
      const gx = x & 63, gy = y & 63;
      const inPanel = gx > 5 && gx < 58 && gy > 5 && gy < 58;
      if (gx < 2 || gy < 2) { r *= 0.42; g *= 0.42; b *= 0.46; }

      const th = hash2((x >> 6) * 7 + 1, (y >> 6) * 13 + 3);
      const missing = th > 0.72;             // a lot of them
      const tileK = 0.78 + th * 0.38;

      if (inPanel) {
        if (missing) {
          const edge = Math.min(gx - 5, 57 - gx, gy - 5, 57 - gy);
          const k = edge < 2 ? 0.5 : 0.10;
          r *= k; g *= k; b *= k * 1.1;
        } else {
          r += 12; g += 11; b += 8;
        }
      }
      r *= tileK; g *= tileK; b *= tileK;

      // Water blooming through, heavier than below.
      const stain = tfbm(x, y, FS, FS, 0.06, 4, 9, 27);
      if (stain > 0.60 && !missing) {
        const k = clamp((stain - 0.60) * 4.5, 0, 0.85);
        r += (60 - r) * k; g += (48 - g) * k; b += (30 - b) * k;
      }

      // A strip light slung under every other row of tiles. Half of them are
      // gone; the ones that remain are what the flicker event has to work with,
      // and seven metres up in the dark they are the only thing that tells you
      // how big the room you just walked into is.
      const run = ((y >> 6) & 1) === 0 && gy > 27 && gy < 37;
      if (run && hash2((x >> 6) * 11 + 5, (y >> 6) * 7 + 2) > 0.45) {
        const k = 1 - Math.abs(gy - 32) / 5;
        r = 64 + k * 36; g = 64 + k * 36; b = 62 + k * 36;
        mask[y * FS + x] = 1;
      }

      t.data[y * FS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  t.panelMask = mask;
  return t;
}

// --- The inside of a hole in the floor. -------------------------------------
// Two textures: the shaft lining you see on the way down, and whatever is at
// the bottom. Both wrap in both axes because the renderer samples them from
// arbitrary world coordinates.

// ============================================================================
// OUTSIDE — the two surfaces that only ever exist in ending vi.
//
// Everything else in this file is interior decay seen from under three metres.
// These two are the opposite of that on purpose: the ground is organic and wet,
// and the sky is the only thing in the game that is further away than the fog.
// If either of them reads as "a corridor with the lights on", the ending has
// failed, so neither of them shares a single colour with anything above.
// ============================================================================

// The sky is sampled DIRECTIONALLY — u is the compass bearing of the ray, v is
// how far up the screen row is — rather than by world position like the ceiling.
// That is what puts it at infinity: walk toward it and nothing about it changes,
// which is both correct and the point.
export const SKY_W = 512;         // one full turn
export const SKY_H = 192;         // horizon (row 0) to straight up (row H-1)
// The bearing the light is coming up from. Not a sun — there is no disc and it
// never rises. Just the one quarter of the sky that is further along.
const DAWN_BEARING = 0.62;

function skyTexture() {
  const t = make(SKY_W, SKY_H);
  // Deep, cold, and nowhere near black: the whole shock of this frame is that
  // there is light in it, forty minutes before there is any sun.
  const ZENITH = [24, 30, 54];
  const HORIZON = [104, 112, 132];
  const WARM = [104, 66, 28];     // added into the quarter it is coming from

  // WHERE THE SKY ACTUALLY IS. This texture spans the horizon to straight up,
  // and almost none of it is ever on screen: the projection puts a row at
  // atan((horizon - y)/H), so a player looking level sees elevations of nought
  // to about twenty-six degrees — the bottom THIRTY PER CENT of this image.
  // The first version had the cloud deck centred at a third of the way up and
  // the stars above that, which meant a flat grey band and nothing else unless
  // you happened to look at the ceiling. Everything worth seeing is now inside
  // el < 0.34, and the top two thirds is the part you have to go and find.
  const VIS = 0.30;

  for (let y = 0; y < SKY_H; y++) {
    const el = y / (SKY_H - 1);
    // Most of the gradient is spent inside the visible band and the rest of it
    // is dark blue, rather than a smooth ramp that only gets going off-screen.
    const k = clamp(el / (VIS * 1.9), 0, 1) ** 0.78;
    const base = [
      HORIZON[0] + (ZENITH[0] - HORIZON[0]) * k,
      HORIZON[1] + (ZENITH[1] - HORIZON[1]) * k,
      HORIZON[2] + (ZENITH[2] - HORIZON[2]) * k,
    ];
    // The cloud deck, seen edge-on from underneath: heaviest a third of the way
    // up the VISIBLE band, thinning above it, and flattening into haze as it
    // approaches the horizon because that is what perspective does to a deck.
    const bandK = Math.exp(-((el - VIS * 0.42) ** 2) / (VIS * VIS * 0.55)) *
      clamp(1 - (el - VIS) * 1.4, 0.15, 1);

    for (let x = 0; x < SKY_W; x++) {
      // Stretched about six to one across the sky, and wrapping exactly, so
      // there is no seam behind you.
      const cloud = tfbm(x, y * 5.5, SKY_W, 0, 0.018, 4, 13, 77);
      const wisp = tfbm(x, y * 7.0, SKY_W, 0, 0.062, 3, 91, 5);

      // How far round the sky we are from the bearing the light is behind,
      // 0..1, taking the short way round. Wide, because a narrow glow reads as
      // a light source, and there is no light source out here.
      let d = Math.abs(x / SKY_W - DAWN_BEARING);
      if (d > 0.5) d = 1 - d;
      const glow = Math.max(0, 1 - d * 2.2) ** 1.6 * Math.max(0, 1 - el / (VIS * 1.6));

      let r = base[0] + WARM[0] * glow * 0.80;
      let g = base[1] + WARM[1] * glow * 0.80;
      let b = base[2] + WARM[2] * glow * 0.80;

      // Cloud. Lit from underneath by the same quarter, grey everywhere else.
      const c = clamp((cloud - 0.44) * 3.0, 0, 1) * bandK;
      if (c > 0) {
        const lit = 0.42 + glow * 1.05;
        r += (44 + 128 * lit - r) * c * 0.88;
        g += (48 + 112 * lit - g) * c * 0.88;
        b += (66 + 100 * lit - b) * c * 0.88;
      }
      // A second, finer layer torn across the first.
      const wc = clamp((wisp - 0.60) * 3.4, 0, 1) * bandK * 0.55;
      if (wc > 0) { r += (140 - r) * wc; g += (144 - g) * wc; b += (156 - b) * wc; }

      // What is left of the night: high, and never inside the cloud. These do
      // not twinkle. Nothing out here moves, and that is the last wrong thing.
      if (el > VIS * 0.55 && c < 0.30) {
        const s = hash2(x * 1.7 + 3, y * 2.3 + 11);
        if (s > 0.9975) {
          const mag = (s - 0.9975) / 0.0025;
          const a = (0.40 + mag * 0.60) *
            clamp((el - VIS * 0.55) / 0.25, 0, 1) * (1 - c * 3.2);
          r += (222 - r) * a; g += (228 - g) * a; b += (242 - b) * a;
        }
      }

      // Haze BEFORE the trees, not after. Doing it the other way round hazed the
      // silhouette out into the same value as the ground and put a bright seam
      // between the two — the ground converges on the horizon colour inside the
      // last screen row (your eye is a metre and a half up and the field is
      // flat), so anything pale down here is a hard line rather than distance.
      const haze = clamp(1 - el / (VIS * 0.28), 0, 1) ** 1.5 * 0.55;
      r += (HORIZON[0] - r) * haze;
      g += (HORIZON[1] - g) * haze;
      b += (HORIZON[2] - b) * haze;

      // THE TREELINE, over the top of all of it. Painted into the sky rather
      // than modelled, for the reason every distant thing in this game is faked:
      // at 480x270 a silhouette that does not parallax reads as *far away*, and
      // a treeline you could walk up to and inspect would answer the question
      // the whole ending is built on. It is also the first non-orthogonal shape
      // in nine minutes of right angles, which is most of its job.
      // Pushed out around 0.5 first. fBm of value noise has a standard
      // deviation of about 0.13, so the raw field gives a skyline that wanders
      // by a couple of pixels and reads as a hedge — the same trap the artery
      // wander in world.js documents.
      const spread = (v) => clamp((v - 0.5) * 2.4 + 0.5, 0, 1);
      const ridge = spread(tfbm(x, 0, SKY_W, 0, 0.006, 3, 47, 3));
      const crowns = spread(tfbm(x, 0, SKY_W, 0, 0.055, 3, 5, 61));
      const scrub = tfbm(x, 0, SKY_W, 0, 0.20, 2, 71, 29);
      // Individual crowns on a wandering ridge. Deliberately shallow — it is
      // half a mile away and it should sit just off the bottom of the frame.
      const top = VIS * (0.055 + ridge * 0.075 + crowns * 0.085 + scrub * 0.022);
      if (el < top) {
        const into = 1 - el / top;
        // Solid most of the way up and broken at the top, so the skyline is
        // trees rather than a band with a bitten edge.
        const broken = into > 0.42 ? 1 : clamp(into / 0.42 + (scrub - 0.5) * 1.3, 0, 1);
        // Never black. Dark against a pale sky is a silhouette; black against a
        // pale sky is a hole in the frame.
        const k2 = broken * 0.92;
        r += (26 - r) * k2; g += (29 - g) * k2; b += (34 - b) * k2;
      }

      const grain = (hash2(x * 5 + 1, y * 5 + 7) - 0.5) * 5;
      t.data[y * SKY_W + x] = packRGBA(
        clamp(r + grain, 0, 255) | 0, clamp(g + grain, 0, 255) | 0, clamp(b + grain, 0, 255) | 0
      );
    }
  }
  return t;
}

// Wet ground. Sampled by the same affine floor cast and at the same texels per
// metre as the carpet, so nothing in the renderer has to change — but going
// from damp pile to mud and dead grass under your feet is the fastest and least
// deniable way to say you are not in it any more, because the floor is the
// surface you are looking at the whole time.
//
// The ALPHA byte carries standing water, which the floor pass turns into the
// only place in the lower half of the frame where the sky appears.
function groundTexture() {
  const t = make(FS, FS);
  for (let y = 0; y < FS; y++) {
    for (let x = 0; x < FS; x++) {
      // Ground shape first: broad hollows the water collects in.
      const lie = tfbm(x, y, FS, FS, 0.014, 4, 7, 23);
      const clump = tfbm(x, y, FS, FS, 0.075, 4, 51, 19);
      const blades = tfbm(x, y, FS, FS, 0.30, 2, 3, 88);
      const grain = (hash2(x * 3 + 5, y * 3 + 13) - 0.5) * 16;

      // Mud: brown, cold, and nothing like the carpet. It has to carry at this
      // ambient without the torch, so it sits a good deal lighter than anything
      // indoors — a floor lit by the sky and a floor lit by a hand torch are
      // different values, and this is the only one of the two that is not.
      let r = 62 + lie * 34 + grain;
      let g = 56 + lie * 30 + grain;
      let b = 44 + lie * 21 + grain * 0.8;

      // Dead grass over the top of it, in clumps rather than a lawn — olive
      // going to straw, with the blades picked out by the fine layer.
      const grass = clamp((clump - 0.40) * 2.3, 0, 1) * (1 - clamp((0.36 - lie) * 4, 0, 1));
      if (grass > 0) {
        const dry = 0.35 + blades * 0.95;
        r += (74 + 56 * dry - r) * grass;
        g += (76 + 50 * dry - g) * grass;
        b += (46 + 26 * dry - b) * grass;
      }

      // Standing water in the hollows. Flat, smooth, and darker than the mud
      // where it is deep — everything bright about a puddle is borrowed.
      const wet = clamp((0.40 - lie) * 4.2, 0, 1) * clamp((0.66 - clump) * 3.2, 0, 1);
      let water = 0;
      if (wet > 0.02) {
        // A hard edge. A puddle that fades out is a stain.
        water = clamp((wet - 0.10) * 3.2, 0, 1);
        const deep = water * 0.80;
        r += (26 - r) * deep; g += (30 - g) * deep; b += (36 - b) * deep;
      }

      t.data[y * FS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0,
        (water * 255) | 0
      );
    }
  }
  return t;
}

export const PITS = 64;   // shaft/floor texture size
export const PIT_TILE = 2; // ...spanning this many world cells

function shaftTexture() {
  const t = make(PITS, PITS);
  for (let y = 0; y < PITS; y++) {
    for (let x = 0; x < PITS; x++) {
      // Cooler than the carpet above it, because contrast at the rim is the
      // only thing that makes a hole read as a hole under a torch this weak —
      // but not the pale blue-grey it used to be. Eight metres of that, lit
      // evenly, looked like the tiled side of a swimming pool.
      const mott = tfbm(x, y, PITS, PITS, 0.10, 3, 15, 25);
      let v = 54 + mott * 34;
      let r = v * 0.95, g = v * 0.97, b = v * 1.06;
      // Courses of blockwork receding into the dark. Every eight texels is a
      // quarter of a wall height, so they come about every three-quarters of a
      // metre and give the drop a scale on the way down.
      if (y % 8 === 0) { r *= 0.5; g *= 0.5; b *= 0.54; }
      // Wet streaks.
      const wet = tfbm(x, y, PITS, PITS, 0.22, 2, 41, 3);
      if (wet > 0.60) { const k = (wet - 0.60) * 2.2; r *= 1 - k * 0.5; g *= 1 - k * 0.48; b *= 1 - k * 0.4; }
      t.data[y * PITS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

function pitFloorTexture() {
  const t = make(PITS, PITS);
  for (let y = 0; y < PITS; y++) {
    for (let x = 0; x < PITS; x++) {
      const sludge = tfbm(x, y, PITS, PITS, 0.13, 4, 7, 33);
      let v = 34 + sludge * 30;
      let r = v * 1.10, g = v * 0.94, b = v * 0.78;
      // Standing water: flat, slightly cooler, and it catches the torch.
      if (sludge < 0.42) {
        const k = (0.42 - sludge) * 3;
        r += (16 - r) * k; g += (20 - g) * k; b += (26 - b) * k;
      }
      // Something pale down there. Never resolved enough to identify.
      const bone = tfbm(x, y, PITS, PITS, 0.40, 2, 77, 51);
      if (bone > 0.79) {
        const k = clamp((bone - 0.79) * 6, 0, 0.6);
        r += (116 - r) * k; g += (110 - g) * k; b += (96 - b) * k;
      }
      t.data[y * PITS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

// --- Two red points, mostly glow. Used as a distant fog apparition. ----------
function redEyesTexture() {
  const W = 64, H = 24;
  const t = make(W, H);
  const eyes = [[28, 11], [36, 11]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let glow = 0;
      for (const [ex, ey] of eyes) {
        const dx = (x - ex) / 3.2, dy = (y - ey) / 2.0;
        const d2 = dx * dx + dy * dy;
        glow += Math.exp(-d2 * 1.8);
        if (d2 < 0.36) glow += 1.7;
      }
      glow *= 0.85 + hash2(x * 9 + 3, y * 7 + 5) * 0.25;
      if (glow < 0.05) continue;
      const a = clamp(glow * 150, 0, 230) | 0;
      const r = clamp(165 + glow * 60, 0, 255) | 0;
      const g = clamp(5 + glow * 10, 0, 45) | 0;
      const b = clamp(4 + glow * 8, 0, 30) | 0;
      t.data[y * W + x] = packRGBA(r, g, b, a);
    }
  }
  return t;
}

// --- The face. Drawn by the caught-you jumpscare. ---------------------------
//
// The first one was a skull: pale, evenly lit, two sockets and a mouth, legible
// in a single frame. That is the failure mode of every jumpscare — you get a
// clear look at a thing, the thing turns out to be a shape, and the fear stops.
//
// This one is built so that you cannot finish reading it:
//   * it is DARK. Most of it sits at eight or ten out of 255, so what you get is
//     wet highlights and holes rather than a face, and the shape has to be
//     assembled by you out of the parts that catch the light.
//   * it has EIGHT EYES — the pair where eyes belong plus six more scattered up
//     the brow, all of them wet, none of them symmetrical with each other.
//   * it is BLEEDING, heavily, from the mouth and from three of the sockets,
//     and the blood is wet enough to have highlights of its own.
//   * the jaw is split in two and hinged sideways, and there is nothing behind
//     it but more teeth.
function scareFaceTexture() {
  const W = 160, H = 208;
  const t = make(W, H);
  const cx = W / 2;

  // Where the eyes go: [|dx|, dy, radius x, radius y, how wet]. The first pair
  // are the big ones; the rest ring them, and they are deliberately not evenly
  // spaced, because evenly spaced reads as a pattern and a pattern is safe.
  const EYES = [
    [0.42, -0.13, 0.30, 0.21, 1.0],
    [0.66, -0.34, 0.15, 0.12, 0.8],
    [0.22, -0.40, 0.12, 0.10, 0.7],
    [0.78, -0.10, 0.11, 0.10, 0.6],
  ];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / (W * 0.42);
      const ny = (y - H * 0.46) / (H * 0.52);
      // Superelliptical skull, narrower and longer at the jaw than a head is.
      const taper = 1 + Math.max(0, ny) * 0.42;
      // The outline is broken with noise. A clean superellipse is an egg, and an
      // egg with holes in it is a mask — the silhouette has to be wrong before
      // any of the detail inside it gets a chance to be.
      const warp = 1 + (fbm(nx * 2.6 + 31, ny * 2.2 + 17, 3) - 0.5) * 0.30;
      const d = (Math.pow(Math.abs(nx * taper), 2.4) + Math.pow(Math.abs(ny), 2.0)) * warp;
      if (d > 1.04) { t.data[y * W + x] = 0; continue; }

      // Skin: dark, mottled, stretched over the bone. The whole face lives in
      // the bottom fifth of the range; everything you actually see is either a
      // highlight or a hole.
      const mott = fbm(x * 0.11, y * 0.10, 4);
      const grain = (hash2(x * 7 + 1, y * 5 + 3) - 0.5) * 16;
      let v = 26 + mott * 34 + grain;
      // Bone under it: brow, cheekbones, the ridge down the centre. These are
      // the only parts that come up out of the dark on their own.
      v += Math.exp(-((ny + 0.34) ** 2) * 55) * 30;
      v += Math.exp(-((Math.abs(nx) - 0.64) ** 2) * 62) * 24;
      v += Math.exp(-(nx * nx) * 130) * 16;
      // Wet: a fine specular sheen that follows the noise, so it looks damp
      // rather than dusty.
      const wet = fbm(x * 0.30 + 9, y * 0.26, 3);
      if (wet > 0.62) v += (wet - 0.62) * 150;
      // Edge falloff so it sits in the dark instead of being cut out of it.
      v *= clamp((1.04 - d) * 3.0, 0, 1);

      let r = v * 1.06, g = v * 0.92, b = v * 0.88;

      // --- the eyes ---------------------------------------------------------
      for (let ei = 0; ei < EYES.length; ei++) {
        const [ex0, ey0, rx0, ry0, k] = EYES[ei];
        for (const sgn of [-1, 1]) {
          // Every eye is nudged off its mirror. A face whose eyes match is a
          // face; a face whose eyes nearly match is something wearing one.
          const j = hash2(ei * 17 + (sgn > 0 ? 3 : 91), 5);
          const j2 = hash2(ei * 23 + (sgn > 0 ? 7 : 61), 13);
          const ex = ex0 + (j - 0.5) * 0.09;
          const ey = ey0 + (j2 - 0.5) * 0.10;
          const rx = rx0 * (0.84 + j2 * 0.34), ry = ry0 * (0.84 + j * 0.34);
          // ...and the big pair are slanted, in opposite directions.
          const px = nx - sgn * ex, py = ny - ey;
          const sl = ei === 0 ? sgn * 0.34 : 0;
          const ux = (px + py * sl) / rx, uy = py / ry;
          const e = ux * ux + uy * uy;
          if (e >= 1) continue;
          // A hole with nothing at the bottom of it.
          const kk = clamp((1 - e) * 2.6, 0, 1);
          r += (2 - r) * kk; g += (2 - g) * kk; b += (3 - b) * kk;
          // ...and one wet point in it, off-centre, catching whatever light
          // there is. This is the only red in the upper half of the face.
          const gx = (px - sgn * rx * 0.30) / (rx * 0.20);
          const gy = (py + ry * 0.26) / (ry * 0.20);
          if (gx * gx + gy * gy < 1) { r = 150 * k + 40; g = 26 * k; b = 20 * k; }
        }
      }

      // --- nose: two slits, no bridge ---------------------------------------
      for (const sgn of [-1, 1]) {
        const sx = (nx - sgn * 0.11) / 0.06, sy = (ny - 0.14) / 0.11;
        if (sx * sx + sy * sy < 1) { r *= 0.10; g *= 0.10; b *= 0.12; }
      }

      // --- the mouth --------------------------------------------------------
      // It takes the whole lower third of the face and it is split down the
      // middle: two jaws hinged sideways, with a dark seam between them.
      const mx = nx / 0.46, my = (ny - 0.58) / 0.40;
      const m = mx * mx + my * my;
      if (m < 1) {
        const kk = clamp((1 - m) * 3.0, 0, 1);
        r += (2 - r) * kk; g += (1 - g) * kk; b += (3 - b) * kk;
        // Teeth: uneven vertical bars top and bottom, plenty of them missing,
        // and a second row set behind the first.
        const col = Math.abs((x % 8) - 4);
        const topRow = ny > 0.28 && ny < 0.28 + 0.11 + hash2(x, 1) * 0.06;
        const botRow = ny < 0.90 && ny > 0.90 - 0.10 - hash2(x, 9) * 0.06;
        const inner = ny > 0.44 && ny < 0.52 && (x & 3) === 0;
        if ((topRow || botRow) && col < 3 && m < 0.9 && hash2((x / 8) | 0, topRow ? 2 : 3) > 0.18) {
          const tv = 112 + hash2(x, y) * 46;
          r = tv; g = tv * 0.9; b = tv * 0.74;
        } else if (inner && m < 0.7) {
          r = 54; g = 48; b = 40;
        }
        // The seam where the two halves of the jaw meet.
        if (Math.abs(nx) < 0.016 && ny > 0.42) { r *= 0.2; g *= 0.2; b *= 0.2; }
      }

      // --- blood ------------------------------------------------------------
      // Out of the mouth, over the chin, and off the bottom of the frame; out
      // of three of the sockets and down the cheek. Wet: the runs carry their
      // own highlights, which is the whole difference between blood and a
      // brown stain.
      const run = fbm(x * 0.26 + 5, y * 0.045 + 2, 3);
      let bl = 0;
      if (ny > 0.42) bl = clamp((run - 0.52) * 3.2, 0, 1) * clamp((ny - 0.42) * 2.6, 0, 1);
      // From under the big eyes, and from one of the small ones.
      for (const [ex, ey] of [[0.42, -0.13], [0.66, -0.34]]) {
        for (const sgn of [-1, 1]) {
          if (ny < ey) continue;
          const track = Math.abs(nx - sgn * (ex + 0.02)) / 0.075;
          if (track < 1) {
            const fall = clamp(1 - (ny - ey) / 0.95, 0, 1);
            const streak = fbm(x * 0.5, y * 0.06 + sgn * 3, 2);
            bl = Math.max(bl, (1 - track) * fall * clamp((streak - 0.42) * 3, 0, 1));
          }
        }
      }
      if (bl > 0.02) {
        const dark = 0.55 + fbm(x * 0.4 + 20, y * 0.4, 2) * 0.9;
        r += (104 * dark - r) * bl;
        g += (11 * dark - g) * bl;
        b += (10 * dark - b) * bl;
        // Wet highlight along the top edge of a run.
        const sheen = clamp((fbm(x * 0.6 + 40, y * 0.5, 2) - 0.66) * 6, 0, 1) * bl;
        r += (215 - r) * sheen * 0.7; g += (70 - g) * sheen * 0.5; b += (60 - b) * sheen * 0.5;
      }

      t.data[y * W + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0, 255
      );
    }
  }
  return t;
}

// --- Blood on the lens. Composited over the whole frame while it has you. ---
// Sparse, hard-edged, with a wet rim on each drop — it reads as something that
// landed on the camera rather than as a red filter, which is the difference
// between "it is close" and "the screen went red".
export const SPAT_W = 120, SPAT_H = 68;
function scareSpatterTexture() {
  const t = make(SPAT_W, SPAT_H);
  const drops = [];
  for (let i = 0; i < 34; i++) {
    const h1 = hash2(i * 13 + 1, 7), h2 = hash2(i * 29 + 3, 11), h3 = hash2(i * 7 + 5, 17);
    drops.push([h1 * SPAT_W, h2 * SPAT_H, 1.2 + h3 * h3 * 9]);
  }
  for (let y = 0; y < SPAT_H; y++) {
    for (let x = 0; x < SPAT_W; x++) {
      let cover = 0;
      for (const [dx, dy, rad] of drops) {
        // Squashed and wobbled, so nothing is a circle.
        const ux = (x - dx) / rad, uy = (y - dy) / (rad * 0.72);
        const d = Math.hypot(ux, uy) * (0.82 + fbm(x * 0.35, y * 0.35, 2) * 0.42);
        if (d < 1) cover = Math.max(cover, 1 - d * 0.35);
      }
      if (cover <= 0.02) { t.data[y * SPAT_W + x] = 0; continue; }
      const wet = fbm(x * 0.55 + 3, y * 0.55 + 9, 2);
      const dark = 0.5 + wet * 0.8;
      const a = clamp(cover * 255, 0, 235) | 0;
      t.data[y * SPAT_W + x] = packRGBA(
        clamp(96 * dark + (wet > 0.72 ? 90 : 0), 0, 255) | 0,
        clamp(9 * dark + (wet > 0.72 ? 30 : 0), 0, 255) | 0,
        clamp(8 * dark + (wet > 0.72 ? 26 : 0), 0, 255) | 0,
        a,
      );
    }
  }
  return t;
}

export function generateTextures() {
  const walls = WALL_STYLES.map(wallTexture);
  return {
    walls,
    floor: floorTexture(),
    ceiling: ceilingTexture(),
    deck: deckTexture(),
    // What is above the wallpaper in a tall room, and in a room with no ceiling
    // at all — the second one has windows in it.
    upper: upperTexture(false),
    upperWindow: upperTexture(true),
    // Only ever drawn by ending vi. Generated at boot regardless, because they
    // cost about as much as one wall stage and building them at the moment the
    // door opens would drop the frame the whole ending is riding on.
    sky: skyTexture(),
    ground: groundTexture(),
    shaft: shaftTexture(),
    pitFloor: pitFloorTexture(),
    redEyes: redEyesTexture(),
    scareFace: scareFaceTexture(),
    scareSpatter: scareSpatterTexture(),
    size: WALL_H,
  };
}
