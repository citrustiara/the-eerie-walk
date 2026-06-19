// textures.js — everything you see is generated at boot from math, no images.
// Each texture is { w, h, data:Uint32Array } of little-endian packed RGBA so the
// renderer can blit texels with a single array read.

import { packRGBA, hash2, clamp } from './mathutils.js';
import { fbm } from './noise.js';

const TS = 64; // wall/floor/ceiling texel size

function make(w, h) {
  return { w, h, data: new Uint32Array(w * h) };
}

// --- Backrooms wallpaper: flat mustard yellow, faint vertical stripes, grime,
//     a horizontal seam, and a darker baseboard along the bottom. ------------
function wallTexture(variant) {
  const t = make(TS, TS);
  // Three slightly different yellows so neighbouring rooms don't feel cloned.
  const bases = [
    [190, 170, 96],
    [178, 158, 84],
    [198, 178, 104],
  ];
  const [br, bg, bb] = bases[variant % bases.length];

  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      // Vertical wallpaper striping.
      const stripe = (Math.sin(x * 0.78) * 0.5 + 0.5) * 10 - 5;
      // Organic discolouration / damp stains.
      const stain = (fbm(x * 0.06 + variant * 10, y * 0.06, 4) - 0.5) * 46;
      // Fine grain.
      const grain = (hash2(x + variant * 99, y) - 0.5) * 16;

      let r = br + stripe + stain + grain;
      let g = bg + stripe + stain * 0.9 + grain;
      let b = bb + stripe * 0.6 + stain * 0.6 + grain;

      // Horizontal seam every 32px (where wallpaper sheets meet).
      if (y % 32 === 0) { r -= 24; g -= 22; b -= 16; }

      // Baseboard: darker band along the bottom of every wall.
      if (y > TS - 8) {
        r *= 0.45; g *= 0.45; b *= 0.42;
        if (y === TS - 8) { r *= 0.7; g *= 0.7; b *= 0.7; }
      }

      t.data[y * TS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

// --- Damp, stained carpet. Muted brown-grey, blotchy. ----------------------
function floorTexture() {
  const t = make(TS, TS);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const blotch = fbm(x * 0.09, y * 0.09, 5);
      const grain = (hash2(x * 3 + 7, y * 3 + 11) - 0.5) * 22;
      const base = 46 + blotch * 34;
      let r = base + 8 + grain;
      let g = base + 2 + grain;
      let b = base - 6 + grain * 0.8;
      // Occasional darker water damage.
      if (blotch > 0.72) { r *= 0.6; g *= 0.6; b *= 0.62; }
      t.data[y * TS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  return t;
}

// --- Drop-ceiling tiles. Mostly dead fluorescent panels (that's why it's so
//     dark and the flashlight matters). Faint cool tint. ---------------------
function ceilingTexture() {
  const t = make(TS, TS);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const grain = (hash2(x * 5 + 3, y * 5 + 2) - 0.5) * 12;
      let r = 38 + grain, g = 40 + grain, b = 44 + grain;

      // Tile grid lines (the metal grid holding the panels).
      const gx = x % 32, gy = y % 32;
      if (gx < 1 || gy < 1) { r *= 0.4; g *= 0.4; b *= 0.45; }

      // The light panel itself sits inset within each tile — but dead, so only
      // a hair brighter than the frame. The flicker event lights these up.
      const inPanel = gx > 6 && gx < 26 && gy > 6 && gy < 26;
      if (inPanel) { r += 10; g += 11; b += 13; }

      t.data[y * TS + x] = packRGBA(
        clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0
      );
    }
  }
  // Tag which texels are "panel" so the renderer can make them emit light when
  // the flicker event fires. Stored as a parallel mask.
  t.panelMask = new Uint8Array(TS * TS);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const gx = x % 32, gy = y % 32;
      t.panelMask[y * TS + x] = (gx > 6 && gx < 26 && gy > 6 && gy < 26) ? 1 : 0;
    }
  return t;
}

// --- The figure. A featureless dark humanoid. Stored RGBA where alpha is the
//     silhouette coverage; the renderer blends it as a near-black void with a
//     faint cold rim so it reads as an absence of light. ---------------------
function silhouetteTexture() {
  const W = 64, H = 128;
  const t = make(W, H);
  const cx = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ny = y / H;
      const wobble = Math.sin(ny * 31) * 1.1 + Math.sin(ny * 73) * 0.55;
      const mx = cx + wobble;
      let halfW = 0;

      // Tall, narrow torso with a too-small head and shoulders that sag into
      // long arms. The outline is intentionally asymmetric and ragged.
      if (ny > 0.025 && ny < 0.155) {
        const hy = (ny - 0.088) / 0.067;
        halfW = Math.sqrt(Math.max(0, 1 - hy * hy)) * 7.4;
      } else if (ny < 0.22) {
        halfW = 3.4;
      } else if (ny < 0.38) {
        halfW = 15.5 - (ny - 0.22) * 34;
      } else if (ny < 0.70) {
        halfW = 9.8 - (ny - 0.38) * 8.5;
      } else {
        halfW = 7.0 - (ny - 0.70) * 6.5;
      }

      const dx = Math.abs(x - mx);
      const rag = (hash2(x * 3 + 17, y * 5 + 29) - 0.5) * 3.4;
      const bodyInside = dx < halfW + rag;

      let alpha = 0;
      if (ny > 0.68) {
        const gap = (ny - 0.68) * 14;
        const legHalf = halfW * 0.46;
        const leftLeg = Math.abs(x - (mx - gap - 1.8)) < legHalf;
        const rightLeg = Math.abs(x - (mx + gap + 1.2)) < legHalf * 0.85;
        if (leftLeg || rightLeg) alpha = 1;
      } else if (bodyInside) {
        alpha = 1;
      }

      if (ny > 0.22 && ny < 0.82) {
        const armDrop = (ny - 0.22) / 0.60;
        const leftArmX = mx - 16.5 + armDrop * -4.5 + Math.sin(ny * 35) * 1.4;
        const rightArmX = mx + 16.0 + armDrop * 3.3 + Math.sin(ny * 27) * 1.1;
        const armW = 2.9 - armDrop * 1.2;
        if (Math.abs(x - leftArmX) < armW || Math.abs(x - rightArmX) < armW) alpha = 1;
      }

      if (alpha > 0) {
        // Almost pure black with the faintest cold cast. Fully opaque: the
        // shape should read as a solid absence, not a transparent ghost.
        t.data[y * W + x] = packRGBA(2, 3, 6, 255);
      } else {
        t.data[y * W + x] = 0; // transparent
      }
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

export function generateTextures() {
  return {
    walls: [wallTexture(0), wallTexture(1), wallTexture(2)],
    floor: floorTexture(),
    ceiling: ceilingTexture(),
    silhouette: silhouetteTexture(),
    redEyes: redEyesTexture(),
    size: TS,
  };
}
