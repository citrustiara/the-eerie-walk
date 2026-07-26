// renderer.js — the raycaster engine.
//
// Pipeline, all into a 480x270 uint32 buffer that is then upscaled by the
// browser with image-rendering: pixelated:
//   1. floor casting (per-row affine texture mapping), then the ceiling — cast
//      once per distinct ceiling height in sight, far plane first
//   2. DDA wall casting with textured vertical slices  (also fills the z-buffer)
//   3. solid meshes — props, bullet holes, spent brass, and the creature, which
//      is rebuilt from primitives every frame and handed in on the instance
//   4. billboard sprites (distant eyes) tested against the z-buffer
//   5. the held viewmodel, with recoil, a cycling slide and a muzzle flash
//   6. the caught-you face, when it has you
//   7. a post pass: vignette, grain, scanlines, VHS chroma split, colour grade
//      and screen shake
//
// Lighting is the whole mood: ambient is almost zero, so a pixel is only
// visible if the flashlight beam (a soft screen-space cone aimed where you
// look) reaches it AND the exponential fog hasn't swallowed it. That is what
// makes the torch "absolutely essential". A gunshot briefly overrides all of
// it — for one frame the corridor is fully lit, and you see everything.
//
// Two things used to be constants in here and are now variables, and between
// them they are most of what makes the level have shapes:
//
//   EYE HEIGHT. Was the literal 0.5 in every projection in the file. It is now
//   read off the player, because you can walk into a hole and on the way down
//   it goes to zero and then past it.
//
//   CEILING HEIGHT. Was one plane at 1.0 everywhere. There are now four —
//   two and a half metres, three, seven, and none at all — and both the ceiling
//   cast and the height of a wall column follow whichever one is over the space
//   you are looking through.

import { RENDER, LIGHT, POST, GUN, PLAYER, PIT } from './config.js';
import { hash2, clamp } from './mathutils.js';
import { BloodDecals, DECAL_SIZE } from './decals.js';
import { METER } from './mesh.js';
import { fbm } from './noise.js';
import { FS, FTILE, WALL_W, WALL_H, WTILE, PITS, PIT_TILE, UP_W, UP_H, UP_SPAN, UP_TOP } from './textures.js';
import { CEIL_HEIGHT, CEIL_LOW, CEIL_STD, CEIL_HIGH, CEIL_OPEN } from './world.js';

const W = RENDER.width;
const H = RENDER.height;
const DS = DECAL_SIZE;          // blood decals are higher-res than the walls
// Floor and ceiling span FTILE cells per tile, at the same texel density as the
// walls, so the ground repeats every twelve metres instead of every three.
const FSCALE = FS / FTILE;      // texels per world unit
const FMASK = FS - 1;
// Walls are sampled the same way — by world position, not per cell. That is the
// whole fix for the mis-registered wallpaper: a run of wall is one continuous
// surface, so the stripes, the sheet seams and the damp all carry across every
// cell boundary instead of restarting (and mirroring) every three metres.
const WSCALE = WALL_W / WTILE;  // texels per world unit along a wall
const WMASK = WALL_W - 1;
const WHMASK = WALL_H - 1;
// Added before truncating so negative world coordinates still floor correctly
// without paying for Math.floor twice per pixel. Any common multiple will do —
// 1<<20 divides by 256, 128 and 64 alike.
const FBIAS = 1 << 20;

// Holes in the floor. The pit plane sits PIT.depth below the floor, so for the
// same screen row it is proportionally further away — one multiply, and the
// existing affine floor cast does the rest. The factor depends on how high your
// eye is, which is no longer a constant: on the way down a hole it goes to
// nothing, so this is computed per frame rather than baked in here.
const PIT_STEPS = 10;           // descent samples before we call it the bottom
const PSCALE = PITS / PIT_TILE;
const PMASK = PITS - 1;
// The band of wall above the wallpaper, in the same texels-per-world-unit terms
// as everything else. Only rooms taller than one wall height ever show it.
const USCALE = UP_H / UP_SPAN;
// Ceiling passes run far plane first so a nearer, lower ceiling paints over the
// tall room behind it. CEIL_OPEN is not in the list because there is nothing to
// draw: an open block is whatever the band was cleared to, which is fog.
const CEIL_ORDER = [CEIL_HIGH, CEIL_STD, CEIL_LOW];
// How many ceiling steps one ray is allowed to record. Three is already more
// changes of height than you will ever see down one column.
const MAX_RISERS = 3;
// Grain resolution for mesh surfaces — how many samples of the noise field one
// face's UV span is worth. Nothing to do with the wall textures.
const MESH_GRAIN = 64;

// Lighting lookup-table resolution (avoids per-pixel Math.exp).
const DMAX = 26, DN = 1024, DIST_SCALE = DN / DMAX;
const R2MAX = 12, BN = 2048, R2_SCALE = BN / R2MAX;

function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function sameSign(a, b, c, ref) {
  return ref > 0 ? (a >= 0 && b >= 0 && c >= 0) : (a <= 0 && b <= 0 && c <= 0);
}

export class Renderer {
  constructor(canvas, textures, meshes) {
    this.canvas = canvas;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tex = textures;
    this.meshes = meshes || {};            // low-poly object meshes, by key
    this.bloodDecals = new BloodDecals();  // unique per-cell wall smears

    this.imageData = this.ctx.createImageData(W, H);
    this.out = new Uint32Array(this.imageData.data.buffer); // final, after post
    this.buf = new Uint32Array(W * H);                      // lit scene
    this.zbuf = new Float32Array(W);                        // per-column wall depth
    // Ceilings are cast before walls, but that must not give a distant tall
    // wall permission to paint over a nearer low ceiling. Keep the winning
    // ceiling distance for every pixel so the later vertical passes can obey
    // the same visibility ordering.
    this.ceilingZ = new Float32Array(W * H);
    this.objZ = new Float32Array(W * H);                    // per-pixel depth for 3D objects
    this.viewZ = new Float32Array(W * H);                   // per-pixel depth for held viewmodels
    // Scratch for the ceiling steps found down the current column. Preallocated
    // because the wall pass runs 480 times a frame and must not allocate.
    this.riserD = new Float32Array(MAX_RISERS);
    this.riserLo = new Float32Array(MAX_RISERS);
    this.riserHi = new Float32Array(MAX_RISERS);
    this.riserSide = new Uint8Array(MAX_RISERS);

    // --- Static lighting tables -------------------------------------------
    this.beamShape = new Float32Array(BN);
    for (let i = 0; i < BN; i++) {
      const r2 = i / R2_SCALE;
      this.beamShape[i] = Math.exp(-r2 * LIGHT.beamCoreFalloff);
    }
    this.torchDist = new Float32Array(DN);
    for (let i = 0; i < DN; i++) {
      const d = i / DIST_SCALE;
      this.torchDist[i] = 1 / (1 + d * d * LIGHT.beamDistFalloff);
    }
    this.fogTable = new Float32Array(DN); // rebuilt per frame (density varies)

    // --- Vignette (radial edge darkening) ---------------------------------
    this.vign = new Float32Array(W * H);
    const cx = W / 2, cy = H / 2, maxR2 = cx * cx + cy * cy;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy;
        const r = (dx * dx + dy * dy) / maxR2;
        this.vign[y * W + x] = 1 - POST.vignette * r * r;
      }
    }

    // --- Film grain noise field (sampled with a per-frame offset) ----------
    this.grain = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) this.grain[i] = (Math.random() - 0.5);

    // --- Viewmodel state (recoil spring, slide cycle) ----------------------
    this.recoil = 0;        // 0..1, decays
    this.slide = 0;         // 0..1, slide travel
    this.kickPitch = 0;
  }

  _rebuildFog(density) {
    for (let i = 0; i < DN; i++) {
      this.fogTable[i] = Math.exp(-(i / DIST_SCALE) * density);
    }
  }

  // Called by the game when the gun goes off, so the viewmodel can react.
  punch() {
    this.recoil = 1;
    this.slide = 1;
    this.kickPitch = 1;
  }

  // One pixel of a hole in the floor.
  //
  // There is no second sector system here and no vertical geometry. The whole
  // effect is that the affine floor cast already gives you, for a screen row,
  // the world point where the FLOOR plane is; scaling that point away from the
  // camera by pitK gives the world point where a plane PIT.depth lower would
  // be. Walk from one to the other in a few steps and the first sample that is
  // no longer over a hole is where the ray met the lining — everything past
  // the last one is the bottom. Eight taps, only on pixels that are actually
  // over a hole, and a square void in the carpet reads as a shaft you could
  // fall down.
  _pitPixel(world, sx, sy, fx, fy, posX, posY, rowDist, pitDist, pitK, lit) {
    const dxTot = (fx - posX) * (pitK - 1);
    const dyTot = (fy - posY) * (pitK - 1);
    // The scan is quadratic in t rather than linear. At eight metres the far
    // plane is six times further away than the floor plane, so a tenth of the
    // way along that vector is well over a cell — evenly spaced samples step
    // straight over the near lip and only ever report the coarsest depth. All
    // the geometry that matters is in the first fifth of the ray, and t = s²
    // puts most of the samples there.
    let depth = 0, prevT = 0, qx = fx, qy = fy;
    for (let s = 1; s <= PIT_STEPS; s++) {
      const f = s / PIT_STEPS;
      const t = f * f;
      qx = fx + dxTot * t; qy = fy + dyTot * t;
      if (!world.isPit(Math.floor(qx), Math.floor(qy))) { depth = t; break; }
      prevT = t;
    }

    // Then bisect. Without this the shaft is quantised into PIT_STEPS depths,
    // and since depth drives both the lining's texture row and how dark it is,
    // a hole comes out as a set of nested rectangles that reads as a staircase
    // down into a swimming pool. Five halvings put the error well under a texel.
    if (depth > 0) {
      let lo = prevT, hi = depth;
      for (let i = 0; i < 5; i++) {
        const mid = (lo + hi) * 0.5;
        const mx = fx + dxTot * mid, my = fy + dyTot * mid;
        if (world.isPit(Math.floor(mx), Math.floor(my))) lo = mid; else hi = mid;
      }
      depth = hi;
      qx = fx + dxTot * hi; qy = fy + dyTot * hi;
    }

    if (depth === 0) {
      const tx = ((qx * PSCALE + FBIAS) | 0) & PMASK;
      const ty = ((qy * PSCALE + FBIAS) | 0) & PMASK;
      const texel = this.tex.pitFloor.data[ty * PITS + tx];
      return lit(sx, sy, pitDist, texel & 255, (texel >> 8) & 255, (texel >> 16) & 255);
    }

    // The lining. Its horizontal coordinate is the sum of the two world axes,
    // which is continuous whichever wall of the shaft we happen to be looking
    // at, and its vertical coordinate is how far down we got in WORLD units —
    // at the same texels-per-metre as everything else, so the courses of
    // blockwork are the right size all the way down instead of one texture
    // stretched over eight metres.
    const tx = ((((qx + qy) * PSCALE + FBIAS) | 0)) & PMASK;
    const ty = (((depth * PIT.depth) * PSCALE + FBIAS) | 0) & PMASK;
    const texel = this.tex.shaft.data[ty * PITS + tx];
    // Bright at the lip and then gone. Nothing gets more than a metre down a
    // shaft this deep, so what you actually see of a hole is a lit rim and then
    // black — which is both what it would look like and the only reading that
    // says "drop" rather than "step". Fading it gently instead produced a pale
    // flat surface that looked like standing water.
    const k = Math.max(0.03, 1.35 - depth * 3.6);
    return lit(sx, sy, rowDist + (pitDist - rowDist) * depth,
               (texel & 255) * k, ((texel >> 8) & 255) * k, ((texel >> 16) & 255) * k);
  }

  render(player, world, env) {
    const buf = this.buf, zbuf = this.zbuf, ceilingZ = this.ceilingZ;
    const tex = this.tex;
    this._rebuildFog(env.fogDensity);
    ceilingZ.fill(1e30);

    // View basis, with anomaly FOV-breathing applied to the camera plane.
    const dirX = player.dirX, dirY = player.dirY;
    const fovScale = env.fovScale || 1;
    const planeX = player.planeX * fovScale, planeY = player.planeY * fovScale;
    const posX = player.x, posY = player.y;
    const horizon = H * 0.5 + player.viewPitch() + (env.shakeY || 0);
    // How high your eye is above the floor, in wall heights. This used to be the
    // constant 0.5 baked into every projection in the file. It is a variable now
    // because of one thing: you can walk into a hole, and on the way down it
    // goes to zero and then past it. The floor comes up, the walls stretch, and
    // the geometry does all of that for free as long as nothing assumes 0.5.
    const eye = Math.max(0.02, player.eyeZ == null ? PLAYER.eyeHeight : player.eyeZ);

    // Flashlight beam parameters (screen-space cone aimed at the crosshair,
    // with a lazy idle sway so the light feels handheld).
    const swayX = Math.sin(env.time * LIGHT.flashlightSwaySpeed) * LIGHT.flashlightSwayAmount;
    const swayY = Math.cos(env.time * LIGHT.flashlightSwaySpeed * 0.7) * LIGHT.flashlightSwayAmount * 0.6;
    const beamCX = W * 0.5 + swayX + player.bobRoll * 2;
    const beamCY = horizon + swayY;
    const invRX = 1 / (W * LIGHT.beamRadiusX);
    const invRY = 1 / (H * LIGHT.beamRadiusY);
    const beamI = env.flashlightOn ? env.beamIntensity : 0;

    const ambient = env.ambient;
    const fr = env.fogColor[0], fg = env.fogColor[1], fb = env.fogColor[2];
    // A gunshot is, for two frames, the brightest thing that has ever happened
    // in this building. It floods from the muzzle, so it is much wider than the
    // torch cone and dies off far more slowly with distance.
    const flash = env.muzzleFlash || 0;

    const beamShape = this.beamShape, torchDist = this.torchDist, fogTable = this.fogTable;

    // Per-pixel shader shared by floor, ceiling and walls. Returns packed RGBA.
    const lit = (px, py, dist, tr, tg, tb) => {
      let di = dist * DIST_SCALE; if (di >= DN) di = DN - 1; di |= 0;
      const fog = fogTable[di];
      let light = ambient;
      if (beamI > 0) {
        const bx = (px - beamCX) * invRX, by = (py - beamCY) * invRY;
        let ri = (bx * bx + by * by) * R2_SCALE; if (ri >= BN) ri = BN - 1; ri |= 0;
        light += beamI * beamShape[ri] * torchDist[di];
      }
      let r = tr * light, g = tg * light, b = tb * light;
      if (flash > 0) {
        // Warm, wide, additive — and it reaches much further than the torch.
        // Bright enough that you see the whole corridor for two frames, not so
        // bright that the frame clips to white and the detail is lost.
        const f = flash * 1.75 / (1 + dist * dist * 0.022);
        r += tr * f; g += tg * f * 0.88; b += tb * f * 0.68;
      }
      r = fr + (r - fr) * fog; g = fg + (g - fg) * fog; b = fb + (b - fb) * fog;
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      return (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
    };

    // ---- 1. Floor -----------------------------------------------------------
    const rdx0 = dirX - planeX, rdy0 = dirY - planeY;
    const rdx1 = dirX + planeX, rdy1 = dirY + planeY;
    const floorTex = tex.floor.data;
    const panelEmit = env.panelEmissive || 0;
    const anyPits = world.anyPitNear(posX, posY);
    const pitK = 1 + PIT.depth / eye;

    // The horizon is allowed to leave the screen entirely — pitch swings 220 px
    // on a 270 px buffer — so both halves are clamped rather than assumed.
    const hy = Math.floor(horizon);
    const floorY0 = hy + 1 < 0 ? 0 : hy + 1;
    const ceilY1 = hy + 1 > H ? H : hy + 1;

    for (let y = floorY0; y < H; y++) {
      let p = y - horizon;
      if (p < 0.5) p = 0.5;
      let rowDist = (eye * H) / p;
      if (rowDist > DMAX) rowDist = DMAX;

      const stepX = rowDist * (rdx1 - rdx0) / W;
      const stepY = rowDist * (rdy1 - rdy0) / W;
      let fx = posX + rowDist * rdx0;
      let fy = posY + rowDist * rdy0;

      const rowBase = y * W;
      const pitDist = rowDist * pitK;
      for (let x = 0; x < W; x++) {
        // Is the floor here actually missing? Everywhere with no hole in sight
        // anyPits is false and this whole branch is one compare per pixel.
        if (anyPits && world.isPit((fx + FBIAS | 0) - FBIAS, (fy + FBIAS | 0) - FBIAS)) {
          buf[rowBase + x] =
            this._pitPixel(world, x, y, fx, fy, posX, posY, rowDist, pitDist, pitK, lit);
          fx += stepX; fy += stepY;
          continue;
        }

        const tx = ((fx * FSCALE + FBIAS) | 0) & FMASK;
        const ty = ((fy * FSCALE + FBIAS) | 0) & FMASK;
        const texel = floorTex[ty * FS + tx];
        buf[rowBase + x] = lit(x, y, rowDist, texel & 255, (texel >> 8) & 255, (texel >> 16) & 255);
        fx += stepX; fy += stepY;
      }
    }

    // ---- 1b. Ceilings, of which there are now four --------------------------
    //
    // A plane at height h is, for a given screen row, (h - eye)/(eye) times as
    // far away as the floor is — so each distinct height is its own affine cast
    // over the same rows, and a pixel belongs to whichever cast lands on a cell
    // of that height. Far plane first, so a low ceiling in front paints over the
    // tall room behind it.
    //
    // The band starts as fog, which is what an open block's ceiling IS: nothing,
    // at an unbounded distance. Everything else writes over it.
    if (ceilY1 > 0) {
      const bits = world.ceilBitsNear(posX, posY);
      const single = (bits & (bits - 1)) === 0;   // one height in sight
      if (!single || bits === (1 << CEIL_OPEN)) {
        const voidPix = (0xff000000 | ((fb | 0) << 16) | ((fg | 0) << 8) | (fr | 0)) >>> 0;
        buf.fill(voidPix, 0, ceilY1 * W);
      }

      for (let ci = 0; ci < CEIL_ORDER.length; ci++) {
        const cls = CEIL_ORDER[ci];
        if (!(bits & (1 << cls))) continue;
        const rise = CEIL_HEIGHT[cls] - eye;
        if (rise <= 0.02) continue;               // you are above this one
        const high = cls === CEIL_HIGH;
        const data = high ? tex.deck.data : tex.ceiling.data;
        const mask = high ? tex.deck.panelMask : tex.ceiling.panelMask;

        for (let y = 0; y < ceilY1; y++) {
          let p = horizon - y;
          if (p < 0.5) p = 0.5;
          let rowDist = (rise * H) / p;
          if (rowDist > DMAX) rowDist = DMAX;

          const stepX = rowDist * (rdx1 - rdx0) / W;
          const stepY = rowDist * (rdy1 - rdy0) / W;
          let fx = posX + rowDist * rdx0;
          let fy = posY + rowDist * rdy0;
          const rowBase = y * W;

          for (let x = 0; x < W; x++) {
            if (single ||
                world.ceilClass((fx + FBIAS | 0) - FBIAS, (fy + FBIAS | 0) - FBIAS) === cls) {
              const tx = ((fx * FSCALE + FBIAS) | 0) & FMASK;
              const ty = ((fy * FSCALE + FBIAS) | 0) & FMASK;
              const ti = ty * FS + tx;
              const texel = data[ti];
              let tr = texel & 255, tg = (texel >> 8) & 255, tb = (texel >> 16) & 255;
              if (panelEmit > 0 && mask[ti]) {
                tr += panelEmit; tg += panelEmit; tb += panelEmit * 1.1;
              }
              const pi = rowBase + x;
              buf[pi] = lit(x, y, rowDist, tr, tg, tb);
              ceilingZ[pi] = rowDist;
            }
            fx += stepX; fy += stepY;
          }
        }
      }
    }

    // ---- 2. Walls (DDA) -----------------------------------------------------
    const walls = tex.walls;
    for (let x = 0; x < W; x++) {
      const cameraX = 2 * x / W - 1;
      const rdx = dirX + planeX * cameraX;
      const rdy = dirY + planeY * cameraX;

      let mapX = Math.floor(posX), mapY = Math.floor(posY);
      const deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);

      let stepX, stepY, sideDistX, sideDistY;
      if (rdx < 0) { stepX = -1; sideDistX = (posX - mapX) * deltaX; }
      else { stepX = 1; sideDistX = (mapX + 1 - posX) * deltaX; }
      if (rdy < 0) { stepY = -1; sideDistY = (posY - mapY) * deltaY; }
      else { stepY = 1; sideDistY = (mapY + 1 - posY) * deltaY; }

      // The cell the ray was in before it hit is tracked because a wall is as
      // tall as the ROOM IT FACES, not as tall as its own block. Standing in a
      // three-metre corridor looking at the flank of a seven-metre hall, you see
      // three metres of wall and then your own ceiling; standing in the hall
      // looking back at the same wall, you see all seven.
      // RISERS. Where the ceiling steps DOWN as the ray goes out — a seven-metre
      // hall giving way to a three-metre corridor — there is a real surface
      // there: the face of the step, hanging from the taller ceiling down to the
      // shorter one. Nothing was drawing it, so the band of screen between the
      // near ceiling ending and the far one starting came out as a black wedge,
      // and the far ceiling read as floating in front of the near one.
      //
      // They are collected here rather than drawn, because the wall column is
      // always further away than every one of them and has to go down first.
      const rD = this.riserD, rLo = this.riserLo, rHi = this.riserHi, rSide = this.riserSide;
      let nRisers = 0;
      let curCeil = world.ceilClass(mapX, mapY);

      let side = 0, hit = false, depth = 0;
      let prevX = mapX, prevY = mapY;
      while (depth++ < RENDER.maxDepth) {
        prevX = mapX; prevY = mapY;
        // The perpendicular distance of the face about to be crossed is the
        // sideDist *before* it is stepped past.
        let dCross;
        if (sideDistX < sideDistY) { dCross = sideDistX; sideDistX += deltaX; mapX += stepX; side = 0; }
        else { dCross = sideDistY; sideDistY += deltaY; mapY += stepY; side = 1; }
        if (world.isWall(mapX, mapY)) { hit = true; break; }
        const cc = world.ceilClass(mapX, mapY);
        if (cc !== curCeil) {
          // Only a step DOWN has a face pointing at you. A step up is hidden by
          // its own ceiling, and the overlapping ceiling passes already cover it.
          if (CEIL_HEIGHT[cc] < CEIL_HEIGHT[curCeil] && nRisers < MAX_RISERS) {
            rD[nRisers] = dCross;
            rLo[nRisers] = CEIL_HEIGHT[cc];
            rHi[nRisers] = CEIL_HEIGHT[curCeil];
            rSide[nRisers] = side;
            nRisers++;
          }
          curCeil = cc;
        }
      }
      if (!hit) { zbuf[x] = 1e30; this._drawRisers(x, nRisers, rdx, rdy, posX, posY, horizon, eye, tex.upper.data, lit); continue; }

      const perp = side === 0
        ? (mapX - posX + (1 - stepX) / 2) / rdx
        : (mapY - posY + (1 - stepY) / 2) / rdy;
      zbuf[x] = perp;

      const spaceCls = world.ceilClass(prevX, prevY);
      const wallTop = CEIL_HEIGHT[spaceCls];
      const drawEnd = horizon + eye * H / perp;
      // Open districts are the exterior/city spaces. Their enclosing façades
      // continue above the visible frame instead of ending at the top of the
      // finite upper-wall texture.
      const drawStart = spaceCls === CEIL_OPEN
        ? 0
        : horizon + (eye - wallTop) * H / perp;

      // Texture column, in WORLD coordinates along the face. Every cell of a
      // wall run therefore gets consecutive slices of one continuous surface —
      // no restart, no mirroring, nothing to mis-register at the seam. The one
      // thing that varies per run is a whole-texture offset keyed off the run's
      // own line (mapX for a north/south-facing wall, mapY for the others),
      // which is constant along the run, so the two walls of a corridor are not
      // in lockstep with each other.
      const wallU = side === 0 ? posY + perp * rdy : posX + perp * rdx;
      const runOff = (hash2((side === 0 ? mapX : mapY) * 1.37 + side * 9.1, side * 4.7) * WALL_W) | 0;
      const wallX = ((wallU * WSCALE + FBIAS) | 0) & WMASK;
      const texX = (wallX + runOff) & WMASK;
      const wdata = walls[world.wallStyle(mapX, mapY)].data;
      // Above the wallpaper, in the rooms tall enough to have an above: bare
      // board, structural courses, and — where the ceiling is missing entirely —
      // a run of windows. Sampled WITHOUT the per-run offset, so the mullions
      // land on the cell grid instead of halfway across a pane.
      const udata = spaceCls === CEIL_OPEN ? tex.upperWindow.data : tex.upper.data;

      // A unique blood smear for this specific wall face (generated/cached), if
      // any. Sampled at the decal's own, higher resolution.
      const hitFace = side === 0 ? (stepX > 0 ? 0 : 1) : (stepY > 0 ? 2 : 3);
      const bdata = world.bloodWallFace(mapX, mapY) === hitFace
        ? this.bloodDecals.get(mapX, mapY, hitFace).data
        : null;
      const dTexX = bdata ? ((wallU - Math.floor(wallU)) * DS) | 0 : 0;

      // Slightly darken N/S faces for cheap directional shading. There is no
      // per-cell brightness jitter any more: it was the other half of why a
      // flat wall looked like a patchwork of panels.
      //
      // What there IS is a slow grime field keyed off where this piece of wall
      // actually is in the world. A texture twelve metres wide still comes round
      // again down a long corridor, and identical mould in identical places is
      // what the eye is really objecting to when it calls a wall repetitive.
      // Multiplying by this means two passes of the same texels are never the
      // same brightness. One noise sample per column, not per pixel.
      const hx = side === 0 ? mapX : wallU, hy = side === 0 ? wallU : mapY;
      const grime = 0.74 + fbm(hx * 0.085 + 11, hy * 0.085 + 7, 2) * 0.58;
      const sideDark = (side === 1 ? 0.74 : 1.0) * grime;

      let y0 = drawStart < 0 ? 0 : drawStart | 0;
      let y1 = drawEnd > H ? H : drawEnd | 0;

      // Two texture rows walked at once, both increasing down the screen: one
      // in the wallpaper, one in the band above it. Which is in use is decided
      // by the sign of the first — it goes negative exactly at the top of the
      // paper, three metres up, which is where the other one becomes valid.
      const stepZ = perp / H;                         // world height lost per row
      const zTop = eye - (y0 - horizon) * stepZ;
      let tl = (1 - zTop) * WALL_H;
      let tu = (UP_TOP - zTop) * USCALE;
      const dtl = WALL_H * stepZ, dtu = USCALE * stepZ;

      for (let y = y0; y < y1; y++) {
        const pi = y * W + x;
        // A nearer ceiling owns this pixel. Previously walls were simply drawn
        // after ceilings, so a tall-space wall extension visibly cut across a
        // short ceiling in front of it.
        if (ceilingZ[pi] < perp) {
          tl += dtl; tu += dtu;
          continue;
        }

        let cr, cg, cb, em = 0;
        if (tl >= 0) {
          let ty = tl | 0; if (ty > WHMASK) ty = WHMASK;
          const texel = wdata[ty * WALL_W + texX];
          cr = texel & 255; cg = (texel >> 8) & 255; cb = (texel >> 16) & 255;
          if (bdata) {
            const bp = bdata[(((tl * (DS / WALL_H)) | 0) & (DS - 1)) * DS + dTexX];
            const ba = bp >>> 24;
            if (ba) {
              const bk = ba / 255;
              cr += ((bp & 255) - cr) * bk;
              cg += (((bp >> 8) & 255) - cg) * bk;
              cb += (((bp >> 16) & 255) - cb) * bk;
            }
          }
        } else {
          let ty = tu | 0;
          if (spaceCls === CEIL_OPEN) {
            // The city façade is storey-periodic and has no visible top.
            ty %= UP_H;
            if (ty < 0) ty += UP_H;
          } else if (ty < 0) ty = 0;
          else if (ty >= UP_H) ty = UP_H - 1;
          const texel = udata[ty * UP_W + wallX];
          cr = texel & 255; cg = (texel >> 8) & 255; cb = (texel >> 16) & 255;
          em = texel >>> 24;              // windows. See textures.js.
        }
        tl += dtl; tu += dtu;

        let out = lit(x, y, perp, cr * sideDark, cg * sideDark, cb * sideDark);
        if (em) {
          // A window is the only thing in the building that makes its own light,
          // so it ignores the torch — and it barely dims with range, because the
          // whole point of one is that you see it from the other side of a hall
          // long before you can see the floor you are standing on.
          const k = em / (1 + perp * 0.05);
          const r = Math.min(255, (out & 255) + k * 0.70);
          const g = Math.min(255, ((out >> 8) & 255) + k * 0.84);
          const b = Math.min(255, ((out >> 16) & 255) + k);
          out = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
        buf[pi] = out;
      }

      // The steps in the ceiling, nearest last so a near one covers a far one.
      // After the wall, because every one of them is in front of it.
      if (nRisers) {
        this._drawRisers(x, nRisers, rdx, rdy, posX, posY, horizon, eye, tex.upper.data, lit, ceilingZ);
      }
    }

    // ---- 3. Solid 3D objects (props, decals, the creature) ------------------
    if (env.meshes && env.meshes.length) {
      this.objZ.fill(1e30);
      this._renderMeshes(player, env, horizon, eye, lit);
    }

    // ---- 4. Sprites (distant eyes) ------------------------------------------
    if (env.entities && env.entities.length) {
      this._renderSprites(player, env, horizon, eye, fogTable, lit);
    }

    // ---- 5. The gun in your hands -------------------------------------------
    if (env.gunEquipped) {
      this._drawHeldGun(player, env);
    }

    // ---- 6. It has you ------------------------------------------------------
    if (env.scare > 0) this._drawScare(env);

    // ---- 7. Post-processing -------------------------------------------------
    this._post(env);
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  // The face of a step in the ceiling: a vertical band hanging from zHi down to
  // zLo at distance d. It is the same texture as the wall above the wallpaper,
  // sampled by height exactly as that wall is, so a seven-metre hall dropping to
  // a three-metre corridor looks like the paper carrying on round the corner of
  // the step — which is what it would do.
  _drawRisers(x, n, rdx, rdy, posX, posY, horizon, eye, udata, lit, ceilingZ = this.ceilingZ) {
    const buf = this.buf;
    for (let i = n - 1; i >= 0; i--) {      // far to near
      const d = this.riserD[i];
      if (d <= 0.05) continue;
      const zHi = this.riserHi[i], zLo = this.riserLo[i];
      const yTop = horizon + (eye - zHi) * H / d;
      const yBot = horizon + (eye - zLo) * H / d;
      let y0 = yTop < 0 ? 0 : yTop | 0;
      let y1 = yBot > H ? H : yBot | 0;
      if (y1 <= y0) continue;

      // Horizontal coordinate along the face we crossed — the same world-space
      // mapping the walls use, so the stripe lines up with the wall it meets.
      const u = this.riserSide[i] === 0 ? posY + d * rdy : posX + d * rdx;
      const ux = ((u * WSCALE + FBIAS) | 0) & WMASK;
      const stepZ = d / H;
      let tu = (UP_TOP - (eye - (y0 - horizon) * stepZ)) * USCALE;
      const dtu = USCALE * stepZ;
      // The underside of a step gets no light from anywhere. Darker than the
      // wall it hangs off, which is what makes it read as an overhang.
      const shade = this.riserSide[i] === 1 ? 0.40 : 0.48;

      for (let y = y0; y < y1; y++) {
        const pi = y * W + x;
        if (ceilingZ[pi] < d) {
          tu += dtu;
          continue;
        }
        let ty = tu | 0;
        if (ty < 0) ty = 0; else if (ty >= UP_H) ty = UP_H - 1;
        tu += dtu;
        const texel = udata[ty * UP_W + ux];
        buf[pi] = lit(x, y, d,
          (texel & 255) * shade, ((texel >> 8) & 255) * shade, ((texel >> 16) & 255) * shade);
      }
    }
  }

  _renderSprites(player, env, horizon, eye, fogTable, lit) {
    const buf = this.buf, zbuf = this.zbuf;
    const dirX = player.dirX, dirY = player.dirY;
    const planeX = player.planeX, planeY = player.planeY;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    // Far-to-near so nearer figures blend last.
    const list = env.entities
      .map(e => ({ e, d: (e.x - player.x) ** 2 + (e.y - player.y) ** 2 }))
      .sort((a, b) => b.d - a.d);

    for (const { e } of list) {
      const sx = e.x - player.x, sy = e.y - player.y;
      const tX = invDet * (dirY * sx - dirX * sy);
      const tY = invDet * (-planeY * sx + planeX * sy); // depth
      if (tY <= 0.15) continue;

      const sprite = this.tex[e.tex];
      const tw = sprite.w, th = sprite.h, sdata = sprite.data;
      const scale = e.scale || 1;

      const screenX = (W / 2) * (1 + tX / tY);
      const spriteH = Math.abs(H / tY) * scale;
      const spriteW = spriteH * (tw / th);
      const feetY = horizon + (eye - (e.z || 0)) * H / tY;
      const startY = feetY - spriteH;

      let di = tY * DIST_SCALE; if (di >= DN) di = DN - 1; di |= 0;
      const fog = fogTable[di];
      const isVoid = !!e.void;
      const isGlow = !!e.glow;
      const isOpaque = !!e.opaque;
      // Glowing sprites are emissive, but still softened by fog so they feel
      // buried in it instead of pasted onto the screen.
      const fogFade = Math.sqrt(fog);
      const baseAlpha = (e.alpha == null ? 1 : e.alpha) *
        (isVoid ? (isOpaque ? 1 : fogFade) : isGlow ? (0.35 + 0.65 * fogFade) : 1);

      const x0 = Math.max(0, Math.floor(screenX - spriteW / 2));
      const x1 = Math.min(W, Math.ceil(screenX + spriteW / 2));
      const yS = Math.max(0, Math.floor(startY));
      const yE = Math.min(H, Math.ceil(feetY));

      for (let x = x0; x < x1; x++) {
        if (tY >= zbuf[x]) continue; // occluded by a wall column
        const texX = (((x - (screenX - spriteW / 2)) * tw / spriteW) | 0);
        if (texX < 0 || texX >= tw) continue;
        for (let y = yS; y < yE; y++) {
          const texY = (((y - startY) * th / spriteH) | 0);
          if (texY < 0 || texY >= th) continue;
          const texel = sdata[texY * tw + texX];
          const a = (texel >>> 24);
          if (a === 0) continue;
          const alpha = (a / 255) * baseAlpha;
          if (alpha <= 0.003) continue;
          const bg = buf[y * W + x];
          const br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
          let r, g, b;
          if (isVoid) {
            r = br + (5 - br) * alpha;
            g = bgc + (7 - bgc) * alpha;
            b = bb + (11 - bb) * alpha;
          } else if (isGlow) {
            r = Math.min(255, br + (texel & 255) * alpha * 1.15);
            g = Math.min(255, bgc + ((texel >> 8) & 255) * alpha * 0.75);
            b = Math.min(255, bb + ((texel >> 16) & 255) * alpha * 0.65);
          } else {
            const litc = lit(x, y, tY, texel & 255, (texel >> 8) & 255, (texel >> 16) & 255);
            r = br + ((litc & 255) - br) * alpha;
            g = bgc + (((litc >> 8) & 255) - bgc) * alpha;
            b = bb + (((litc >> 16) & 255) - bb) * alpha;
          }
          buf[y * W + x] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
      }
    }
  }

  _renderMeshes(player, env, horizon, eye, lit) {
    const buf = this.buf, zbuf = this.zbuf, objZ = this.objZ;
    const dirX = player.dirX, dirY = player.dirY;
    const fovScale = env.fovScale || 1;
    const planeX = player.planeX * fovScale, planeY = player.planeY * fovScale;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    const list = env.meshes
      .map(m => ({ m, d: (m.x - player.x) ** 2 + (m.y - player.y) ** 2 }))
      .sort((a, b) => b.d - a.d);

    for (const { m } of list) {
      // Instances may carry their own geometry — that is how the creature gets
      // to be re-posed every single frame without a mesh table entry.
      const mesh = m.mesh || this.meshes[m.key];
      if (!mesh) continue;

      const yaw = m.yaw || 0;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const scale = m.scale || 1;
      const zOff = m.z || 0;
      const seed = m.seed || 0;

      for (let fi = 0; fi < mesh.length; fi++) {
        const face = mesh[fi];
        const pv = [];
        let clipped = false;

        for (let i = 0; i < face.v.length; i++) {
          const v = face.v[i];
          const uv = face.uv ? face.uv[i] : [0, 0];
          const lx = v[0] * scale, ly = v[1] * scale;
          const wx = m.x + lx * cs - ly * sn;
          const wy = m.y + lx * sn + ly * cs;
          const wz = zOff + v[2] * scale;

          const sx = wx - player.x, sy = wy - player.y;
          const tX = invDet * (dirY * sx - dirX * sy);
          const tY = invDet * (-planeY * sx + planeX * sy);
          if (tY <= 0.08) { clipped = true; break; }

          pv.push({
            x: (W * 0.5) * (1 + tX / tY),
            y: horizon + (eye - wz) * H / tY,
            z: tY,
            u: uv[0],
            v: uv[1],
          });
        }

        if (clipped || pv.length < 3) continue;
        for (let i = 1; i < pv.length - 1; i++) {
          this._drawMeshTri(pv[0], pv[i], pv[i + 1], face, m, fi, seed, lit, buf, zbuf, objZ);
        }
      }
    }
  }

  _drawMeshTri(a, b, c, face, inst, faceIndex, seed, lit, buf, zbuf, objZ) {
    let minX = Math.floor(Math.min(a.x, b.x, c.x));
    let maxX = Math.ceil(Math.max(a.x, b.x, c.x));
    let minY = Math.floor(Math.min(a.y, b.y, c.y));
    let maxY = Math.ceil(Math.max(a.y, b.y, c.y));
    if (maxX < 0 || maxY < 0 || minX >= W || minY >= H) return;
    if (minX < 0) minX = 0; if (maxX >= W) maxX = W - 1;
    if (minY < 0) minY = 0; if (maxY >= H) maxY = H - 1;

    const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
    if (Math.abs(area) < 0.0001) return;
    const invArea = 1 / area;
    const pool = !!face.pool;
    const baseA = face.a == null ? 1 : face.a;
    const bloodK = inst.bloodK || 0;
    const emit = face.emit;
    const emitScale = inst.emitScale == null ? 1 : inst.emitScale;
    const dim = inst.dim == null ? 1 : inst.dim;
    // How fast an emissive face dims with range. The default buries the
    // creature's eyes past about ten metres, which is right for something you
    // are meant to almost miss; the hunter overrides it to near-flat so its
    // eyes reach you across a whole hall before the body resolves at all.
    const emitK = inst.emitFar == null ? 0.34 : inst.emitFar;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = edge(b.x, b.y, c.x, c.y, px, py);
        const w1 = edge(c.x, c.y, a.x, a.y, px, py);
        const w2 = edge(a.x, a.y, b.x, b.y, px, py);
        if (!sameSign(w0, w1, w2, area)) continue;

        const l0 = w0 * invArea, l1 = w1 * invArea, l2 = w2 * invArea;
        const depth = a.z * l0 + b.z * l1 + c.z * l2;
        const idx = y * W + x;
        if (depth <= 0.08 || depth >= zbuf[x] || depth >= objZ[idx]) continue;

        const u = a.u * l0 + b.u * l1 + c.u * l2;
        const v = a.v * l0 + b.v * l1 + c.v * l2;
        let { r, g, b: bl } = this._meshTexel(face, inst, faceIndex, seed, u, v);
        if (pool) {
          const n = hash2((x * 17 + seed + faceIndex * 101) | 0, (y * 31 + (seed >>> 8)) | 0);
          let alpha = baseA * (0.42 + n * 0.58);
          if (n < 0.12) alpha *= 0.35; // thin gaps in the pool.
          const litc = lit(x, y, depth, r, g, bl);
          const bg = buf[idx];
          const br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
          r = br + ((litc & 255) - br) * alpha;
          g = bgc + (((litc >> 8) & 255) - bgc) * alpha;
          bl = bb + (((litc >> 16) & 255) - bb) * alpha;
          buf[idx] = (0xff000000 | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
          continue;
        }

        if (bloodK > 0) {
          const grain = hash2((x * 13 + seed + faceIndex * 47) | 0, (y * 19 + (seed >>> 7)) | 0);
          const smear = hash2(((x / 4) | 0) + seed, ((y / 5) | 0) + faceIndex * 37);
          const k = clamp((grain * 0.55 + smear * 0.45 - (1 - bloodK)) * 2.6, 0, bloodK);
          r += (108 - r) * k;
          g += (13 - g) * k;
          bl += (10 - bl) * k;
        }

        if (dim !== 1) { r *= dim; g *= dim; bl *= dim; }

        let litc = lit(x, y, depth, r, g, bl);
        if (emit) {
          // Emissive faces (the creature's eyes) ignore the torch entirely —
          // they are the one thing you can see it by. They do still dim with
          // distance, or a pair of red points reads the same at four metres and
          // at twenty, and the approach stops meaning anything.
          const k = 1 / (1 + depth * emitK);
          const er = Math.min(255, (litc & 255) + emit[0] * emitScale * k);
          const eg = Math.min(255, ((litc >> 8) & 255) + emit[1] * emitScale * k);
          const eb = Math.min(255, ((litc >> 16) & 255) + emit[2] * emitScale * k);
          litc = (0xff000000 | ((eb | 0) << 16) | ((eg | 0) << 8) | (er | 0)) >>> 0;
        }
        buf[idx] = litc;
        objZ[idx] = depth;
      }
    }
  }

  _meshTexel(face, inst, faceIndex, seed, u, v) {
    let r = face.r, g = face.g, b = face.b;
    const tx = (u * MESH_GRAIN) | 0;
    const ty = (v * MESH_GRAIN) | 0;
    const sx = tx + ((seed >>> 2) & 1023) + faceIndex * 37;
    const sy = ty + ((seed >>> 12) & 1023) + faceIndex * 53;
    const grain = (hash2(sx * 5 + 3, sy * 5 + 7) - 0.5) * 18;
    const mat = face.mat || inst.key || 'cardboard';

    // The large-scale grime field is three octaves of value noise per pixel —
    // roughly fifteen times the cost of the hash above. The held gun covers a
    // sixth of the screen every frame, so materials that barely use this (the
    // whole weapon) must not pay for it: it is computed per branch, not up front.
    let stain = 0;
    if (mat !== 'gunmetal' && mat !== 'chrome' && mat !== 'rubber' &&
        mat !== 'glass' && mat !== 'paint' && mat !== 'concrete' && mat !== 'crt') {
      stain = (fbm(sx * 0.08, sy * 0.08, 3) - 0.5) * 36;
    }

    if (mat === 'cardboard') {
      const stripe = (Math.sin(tx * 0.75) * 0.5 + 0.5) * 12 - 6;
      r += stripe + stain * 0.6 + grain;
      g += stripe + stain * 0.55 + grain;
      b += stripe * 0.45 + stain * 0.35 + grain * 0.8;
      if ((tx & 15) === 0 || (ty & 31) === 0) { r *= 0.72; g *= 0.70; b *= 0.64; }
    } else if (mat === 'wood') {
      const plank = (tx % 21) < 2 || (ty % 28) < 2;
      const wave = Math.sin(tx * 0.28 + fbm(sx * 0.04, sy * 0.02, 2) * 4) * 16;
      r += wave + stain * 0.5 + grain;
      g += wave * 0.65 + stain * 0.35 + grain;
      b += wave * 0.25 + stain * 0.18 + grain * 0.7;
      if (plank) { r *= 0.55; g *= 0.50; b *= 0.45; }
    } else if (mat === 'metal') {
      const band = (ty % 18) < 2;
      const scrape = hash2((sx / 2) | 0, (sy / 8) | 0) > 0.78 ? 22 : 0;
      r += stain * 0.25 + grain * 0.8 + scrape;
      g += stain * 0.28 + grain * 0.8 + scrape;
      b += stain * 0.35 + grain * 0.9 + scrape;
      if (band) { r *= 0.58; g *= 0.62; b *= 0.66; }
      // Rust blooms where the stain field is strongest.
      if (stain > 12) { r += 26; g += 6; b -= 4; }
    } else if (mat === 'gunmetal') {
      // Parkerised finish. This gets its own branch because the gun spends most
      // of its life filling a sixth of the screen: the coarse rust-and-scrape
      // noise that makes an oil drum look good turned the slide into gravel.
      r += grain * 0.34 + stain * 0.06;
      g += grain * 0.34 + stain * 0.06;
      b += grain * 0.36 + stain * 0.08;
      // Bright wear along the edges where it has been holstered a thousand times.
      if (hash2((sx / 3) | 0, (sy / 3) | 0) > 0.93) { r += 15; g += 16; b += 18; }
    } else if (mat === 'chrome') {
      const streak = Math.sin(ty * 0.5 + sx * 0.02) * 26;
      r += streak + grain * 0.4; g += streak + grain * 0.4; b += streak * 1.05 + grain * 0.4;
    } else if (mat === 'fabric') {
      const weave = (((tx & 3) === 0) || ((ty & 3) === 0)) ? -14 : 4;
      r += weave + stain * 0.45 + grain;
      g += weave + stain * 0.45 + grain;
      b += weave + stain * 0.55 + grain;
    } else if (mat === 'plush') {
      // Matted fur: coarse directional noise plus bald patches.
      const fur = (hash2(sx * 3, (sy / 2) | 0) - 0.5) * 30;
      r += fur + stain * 0.5; g += fur + stain * 0.45; b += fur * 0.9 + stain * 0.4;
      if (fbm(sx * 0.06, sy * 0.06, 2) > 0.66) { r *= 0.72; g *= 0.70; b *= 0.68; }
    } else if (mat === 'plastic') {
      const band = ty > 38 && ty < 46 ? 38 : 0;
      r += band + stain * 0.3 + grain * 0.7;
      g += band + stain * 0.2 + grain * 0.6;
      b += band * 0.7 + stain * 0.15 + grain * 0.5;
    } else if (mat === 'rubber') {
      const stipple = hash2(sx * 11, sy * 13) > 0.55 ? 5 : -7;
      r += stipple + grain * 0.25;
      g += stipple + grain * 0.25;
      b += stipple + grain * 0.28;
    } else if (mat === 'porcelain') {
      // Glazed, with hairline crazing — the doll is not in good condition.
      const craze = fbm(sx * 0.22, sy * 0.22, 3);
      r += grain * 0.5 + 6; g += grain * 0.5 + 2; b += grain * 0.5;
      if (craze > 0.61 && craze < 0.645) { r *= 0.66; g *= 0.64; b *= 0.62; }
      if (stain > 8) { r -= stain * 0.4; g -= stain * 0.5; b -= stain * 0.55; }
    } else if (mat === 'glass') {
      const highlight = Math.exp(-((tx - 18) ** 2) * 0.004) * 46;
      r += highlight * 0.8 + grain * 0.3;
      g += highlight * 0.95 + grain * 0.3;
      b += highlight + grain * 0.3;
    } else if (mat === 'paper') {
      const rule = (ty % 6) === 0 ? -16 : 0;
      const yellow = stain * 0.5;
      r += rule + yellow + grain * 0.5;
      g += rule + yellow * 0.85 + grain * 0.5;
      b += rule + yellow * 0.4 + grain * 0.5;
    } else if (mat === 'crt') {
      // Dead glass: dark, faintly green, with the shadow mask still visible.
      const mask = (tx % 3) === 0 ? 8 : 0;
      r += mask * 0.5 + grain * 0.2;
      g += mask + grain * 0.2 + 6;
      b += mask * 0.7 + grain * 0.2;
      if ((ty % 2) === 0) { r *= 0.86; g *= 0.86; b *= 0.86; }
    } else if (mat === 'leather') {
      const crease = fbm(sx * 0.13, sy * 0.13, 3);
      r += grain * 0.7 + stain * 0.3;
      g += grain * 0.7 + stain * 0.25;
      b += grain * 0.7 + stain * 0.2;
      if (crease > 0.62) { r *= 0.74; g *= 0.72; b *= 0.70; }
    } else if (mat === 'paint') {
      r += grain * 0.3; g += grain * 0.3; b += grain * 0.3;
    } else if (mat === 'concrete') {
      const speck = hash2(sx * 9, sy * 9) > 0.86 ? 22 : 0;
      r += speck + grain * 0.6; g += speck + grain * 0.6; b += speck + grain * 0.6;
    } else if (mat === 'flesh') {
      // Taut, dry, mottled. Dark veins under the surface catch the torch a
      // fraction more than the skin does, which is what makes it crawl. One
      // noise field does both jobs at different thresholds rather than two.
      const vein = fbm(sx * 0.14, sy * 0.10, 3);
      r += grain * 0.6 + stain * 0.35;
      g += grain * 0.55 + stain * 0.28;
      b += grain * 0.55 + stain * 0.28;
      if (vein > 0.60) { r += 12; g += 4; b += 5; }
      if (vein < 0.34) { r *= 0.70; g *= 0.70; b *= 0.72; }
    }

    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
  }

  // ---------------------------------------------------------------------------
  // The viewmodel. Held low and right with the muzzle angled slightly inward,
  // driven by four things: idle breathing, walk sway, a recoil spring, and a
  // slide that actually cycles. Its own depth buffer means it composites over
  // the world without any of the world's geometry poking through it.
  // ---------------------------------------------------------------------------
  _drawHeldGun(player, env) {
    const frameMesh = this.meshes.gunFrame;
    const slideMesh = this.meshes.gunSlide;
    if (!frameMesh || !slideMesh) return;

    const t = env.time;
    const dt = 1 / 60;
    // Springs. Recoil snaps to 1 on fire and decays; the slide is faster still.
    this.recoil = Math.max(0, this.recoil - dt * 4.4);
    this.slide = Math.max(0, this.slide - dt * 9.5);
    this.kickPitch += (0 - this.kickPitch) * dt * 9;

    const moving = player.moving ? 1 : 0;
    const walk = player.bobPhase;
    const bob = Math.sin(walk) * 0.010 * moving + Math.sin(t * 1.9) * 0.0022;
    const swayX = Math.cos(walk * 0.5) * 0.014 * moving + Math.sin(t * 0.8) * 0.0030;
    const rec = this.recoil * this.recoil * GUN.recoil;

    // Pose. Local mesh space: +x muzzle, +y right, +z up.
    // originDepth is deliberately large relative to the weapon's 20 cm length:
    // held any closer, the perspective divide swings the grip out to the screen
    // edge while the muzzle stays near the middle, and the whole thing reads as
    // being carried sideways.
    const scale = 3.0;
    const yaw = -0.105 + Math.sin(t * 0.7) * 0.010;   // muzzle angled slightly inward
    const pitch = -0.04 + this.kickPitch * 0.34 + Math.sin(t * 1.1) * 0.008;
    const roll = 0.17;                                 // shows the top-left of the slide
    const originX = 0.156 + swayX + rec * 0.014;
    const originDepth = 0.520 - rec * 0.060;
    const originZ = -0.176 + bob + rec * 0.034;
    const focal = H * 1.05;
    const screenCY = H * 0.5 + player.viewPitch() * 0.25;

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);

    // Local -> view space. Pitch about the right axis, roll about the barrel,
    // yaw about up, then translate to the hand position.
    const project = (v, extraX) => {
      let fx = (v[0] + extraX) * scale;   // along the barrel
      let ry = v[1] * scale;              // right
      let up = v[2] * scale;              // up
      // pitch
      let p1 = fx * cp - up * sp, p2 = fx * sp + up * cp;
      fx = p1; up = p2;
      // roll (about the barrel axis)
      const r1 = ry * cr - up * sr, r2 = ry * sr + up * cr;
      ry = r1; up = r2;
      // yaw
      const vx = originX + ry * cy + fx * sy;
      const vd = originDepth + fx * cy - ry * sy;
      const vz = originZ + up;
      return { vx, vd, vz };
    };

    const faces = [];
    const light = [-0.30, 0.55, 0.78];
    // The gun is lit by your own torch — spill off the beam rather than the beam
    // itself — so it goes almost black when you switch the light off.
    const key = (env.flashlightOn ? 1.38 : 0.28) + (env.muzzleFlash || 0) * 2.6;

    const collect = (mesh, extraX, seed) => {
      for (let fi = 0; fi < mesh.length; fi++) {
        const f = mesh[fi];
        const pv = [], vv = [];
        let clipped = false;
        for (let i = 0; i < f.v.length; i++) {
          const { vx, vd, vz } = project(f.v[i], extraX);
          if (vd <= 0.05) { clipped = true; break; }
          vv.push({ x: vx, d: vd, z: vz });
          const uv = f.uv ? f.uv[i] : [0, 0];
          pv.push({
            x: W * 0.5 + (vx / vd) * focal,
            y: screenCY - (vz / vd) * focal,
            z: vd, u: uv[0], v: uv[1],
          });
        }
        if (clipped || pv.length < 3) continue;
        const a = vv[0], b = vv[1], c = vv[2];
        const ax = b.x - a.x, ay = b.d - a.d, az = b.z - a.z;
        const bx = c.x - a.x, by = c.d - a.d, bz = c.z - a.z;
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const ndl = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl);
        const shade = (0.42 + ndl * 0.95) * key;
        const depth = pv.reduce((s, p) => s + p.z, 0) / pv.length;
        faces.push({ face: f, pv, fi, depth, shade, seed });
      }
    };

    collect(frameMesh, 0, 0x5eed971);
    // Slide travel: back 14 mm (in mesh units) while cycling.
    collect(slideMesh, -this.slide * 0.030, 0x77a10c);

    // Muzzle flash: a short-lived emissive star hung off the bore. The bore sits
    // at 11.8 cm forward and 9 cm up in the *authored* model, so convert into
    // the mesh's world units before using it as a vertex position.
    const flash = env.muzzleFlash || 0;
    if (flash > 0.02) {
      const muzzleX = 0.118 * METER, muzzleZ = 0.090 * METER;
      const petals = 5;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + t * 31;
        const len = (0.055 + Math.abs(Math.sin(a * 2.3)) * 0.075) * METER * flash;
        const wid = 0.020 * METER * flash;
        const v = [
          [muzzleX, 0, muzzleZ],
          [muzzleX + len * 0.4, Math.cos(a) * wid, muzzleZ + Math.sin(a) * wid],
          [muzzleX + len, Math.cos(a) * wid * 0.35, muzzleZ + Math.sin(a) * wid * 0.35],
        ];
        const pv = [];
        let clipped = false;
        for (const vert of v) {
          const { vx, vd, vz } = project(vert, 0);
          if (vd <= 0.05) { clipped = true; break; }
          pv.push({ x: W * 0.5 + (vx / vd) * focal, y: screenCY - (vz / vd) * focal, z: vd, u: 0.5, v: 0.5 });
        }
        if (!clipped) {
          faces.push({
            face: { v, r: 255, g: 214, b: 130, mat: 'flash', a: Math.min(1, flash * 1.2) },
            pv, fi: 900 + i, depth: 0.001, shade: 1, seed: 0, raw: true,
          });
        }
      }
    }

    this.viewZ.fill(1e30);
    faces.sort((a, b) => b.depth - a.depth);
    for (const item of faces) {
      const pv = item.pv;
      for (let i = 1; i < pv.length - 1; i++) {
        this._drawViewmodelTri(pv[0], pv[i], pv[i + 1], item.face, item.fi, item.seed, item.shade, item.raw);
      }
    }
  }

  _drawViewmodelTri(a, b, c, face, faceIndex, seed, shade, raw) {
    const buf = this.buf, viewZ = this.viewZ;
    let minX = Math.floor(Math.min(a.x, b.x, c.x));
    let maxX = Math.ceil(Math.max(a.x, b.x, c.x));
    let minY = Math.floor(Math.min(a.y, b.y, c.y));
    let maxY = Math.ceil(Math.max(a.y, b.y, c.y));
    if (maxX < 0 || maxY < 0 || minX >= W || minY >= H) return;
    if (minX < 0) minX = 0; if (maxX >= W) maxX = W - 1;
    if (minY < 0) minY = 0; if (maxY >= H) maxY = H - 1;

    const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
    if (Math.abs(area) < 0.0001) return;
    const invArea = 1 / area;
    const alpha = face.a == null ? 1 : face.a;
    const inst = { key: 'gun' };

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = edge(b.x, b.y, c.x, c.y, px, py);
        const w1 = edge(c.x, c.y, a.x, a.y, px, py);
        const w2 = edge(a.x, a.y, b.x, b.y, px, py);
        if (!sameSign(w0, w1, w2, area)) continue;

        const l0 = w0 * invArea, l1 = w1 * invArea, l2 = w2 * invArea;
        const depth = a.z * l0 + b.z * l1 + c.z * l2;
        const idx = y * W + x;
        if (depth >= viewZ[idx]) continue;

        let r, g, bl;
        if (raw) {
          r = face.r; g = face.g; bl = face.b;
        } else {
          const u = a.u * l0 + b.u * l1 + c.u * l2;
          const v = a.v * l0 + b.v * l1 + c.v * l2;
          const tex = this._meshTexel(face, inst, faceIndex, seed, u, v);
          r = clamp(tex.r * shade + 5, 0, 255);
          g = clamp(tex.g * shade + 5, 0, 255);
          bl = clamp(tex.b * shade + 6, 0, 255);
        }

        const bg = buf[idx];
        const br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
        const rr = raw ? Math.min(255, br + r * alpha) : br + (r - br) * alpha;
        const gg = raw ? Math.min(255, bgc + g * alpha) : bgc + (g - bgc) * alpha;
        const bbb = raw ? Math.min(255, bb + bl * alpha) : bb + (bl - bb) * alpha;
        buf[idx] = (0xff000000 | ((bbb | 0) << 16) | ((gg | 0) << 8) | (rr | 0)) >>> 0;
        if (!raw) viewZ[idx] = depth;
      }
    }
  }

  // It has you.
  //
  // The face is dark on purpose (see textures.js), so this pass has to do the
  // job that brightness used to: make it impossible to finish looking at.
  //
  //   STROBE. The frame does not hold the face. It is lit for two or three
  //   frames, black for two or three, on an uneven pattern driven by a hash of
  //   the frame index — so it arrives in pieces and you assemble it yourself,
  //   which is worse than being shown it.
  //   TEAR. Per-row horizontal displacement, much heavier than before and worst
  //   at the start, like the tape is being chewed.
  //   BLOOD ON THE LENS. Composited over everything, including the face, so
  //   something is between you and it.
  _drawScare(env) {
    const tex = this.tex.scareFace;
    if (!tex) return;
    const k = clamp(env.scare, 0, 1);           // 1 at the start, 0 at the end
    const buf = this.buf;

    // The strobe. Roughly 14 Hz, uneven, and it stops strobing and simply holds
    // for the last third — the moment it settles is the moment you realise it
    // is not going to look away.
    const beat = (env.time * 14) | 0;
    const settled = k < 0.34;
    const on = settled || hash2(beat, 7) > 0.36;

    if (on) {
      const tw = tex.w, th = tex.h, data = tex.data;
      // Comes in from too far away and ends up well past the screen edges.
      const scale = (H / th) * (1.15 + (1 - k) * 1.9);
      const dw = tw * scale, dh = th * scale;
      const jitter = (0.35 + k) * 7;
      const cx = W * 0.5 + Math.sin(env.time * 47) * jitter;
      const cy = H * 0.54 + Math.cos(env.time * 39) * jitter;
      const x0 = Math.max(0, Math.floor(cx - dw / 2));
      const x1 = Math.min(W, Math.ceil(cx + dw / 2));
      const y0 = Math.max(0, Math.floor(cy - dh / 2));
      const y1 = Math.min(H, Math.ceil(cy + dh / 2));
      const fade = clamp(k * 3.0, 0, 1);
      const left = cx - dw / 2, top = cy - dh / 2;

      for (let y = y0; y < y1; y++) {
        // Bands rather than per-row noise: a torn tape displaces a run of lines
        // together, and single-row noise just reads as static.
        const band = (y / 5) | 0;
        const tear = (hash2(band, (env.time * 60) | 0) - 0.5) * (0.3 + k) * 34;
        const ty = ((y - top) / scale) | 0;
        if (ty < 0 || ty >= th) continue;
        const row = ty * tw;
        for (let x = x0; x < x1; x++) {
          const tx = ((x + tear - left) / scale) | 0;
          if (tx < 0 || tx >= tw) continue;
          const texel = data[row + tx];
          if ((texel >>> 24) === 0) continue;
          const idx = y * W + x;
          const bg = buf[idx];
          const r = (texel & 255) * fade + (bg & 255) * (1 - fade);
          const g = ((texel >> 8) & 255) * fade + ((bg >> 8) & 255) * (1 - fade);
          const b = ((texel >> 16) & 255) * fade + ((bg >> 16) & 255) * (1 - fade);
          buf[idx] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
      }
    } else {
      // Between strobes there is almost nothing — a smear of the frame at a
      // twentieth of its brightness, so the darkness has texture in it.
      for (let i = 0, n = W * H; i < n; i++) {
        const c = buf[i];
        buf[i] = (0xff000000
          | (((c >> 16) & 255) * 0.06 | 0) << 16
          | (((c >> 8) & 255) * 0.05 | 0) << 8
          | ((c & 255) * 0.07 | 0)) >>> 0;
      }
    }

    // Blood on the lens, over everything. It arrives a beat after the face and
    // then it stays, drifting, because nothing is going to wipe it off.
    const sp = this.tex.scareSpatter;
    if (sp && k < 0.86) {
      const sw = sp.w, sh = sp.h, sdata = sp.data;
      const amt = clamp((0.86 - k) * 3.2, 0, 1);
      const ox = (Math.sin(env.time * 3.1) * 3) | 0;
      const oy = (Math.cos(env.time * 2.3) * 2) | 0;
      for (let y = 0; y < H; y++) {
        const sy = ((y * sh / H) | 0) + oy;
        if (sy < 0 || sy >= sh) continue;
        const srow = sy * sw;
        for (let x = 0; x < W; x++) {
          const sx = ((x * sw / W) | 0) + ox;
          if (sx < 0 || sx >= sw) continue;
          const texel = sdata[srow + sx];
          const a = (texel >>> 24);
          if (!a) continue;
          const alpha = (a / 255) * amt;
          const idx = y * W + x;
          const bg = buf[idx];
          const r = (bg & 255) + ((texel & 255) - (bg & 255)) * alpha;
          const g = ((bg >> 8) & 255) + (((texel >> 8) & 255) - ((bg >> 8) & 255)) * alpha;
          const b = ((bg >> 16) & 255) + (((texel >> 16) & 255) - ((bg >> 16) & 255)) * alpha;
          buf[idx] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
      }
    }
  }

  _post(env) {
    const buf = this.buf, out = this.out, vign = this.vign, grain = this.grain;
    const N = W * H;
    const gOff = (Math.random() * N) | 0;
    const scare = env.scare || 0;
    const grainAmt = POST.grain * (1 + scare * 4 + (env.stress || 0) * 1.6);
    const scan = 1 - POST.scanlineDarken;
    const chroma = (POST.chromaShift + (scare * 5 | 0) + ((env.stress || 0) * 3 | 0)) | 0;
    // Colour grade: the redshift anomaly and the caught-you scare both push the
    // whole frame toward arterial.
    const grade = env.grade || null;
    const gr = grade ? grade[0] : 1, gg = grade ? grade[1] : 1, gb = grade ? grade[2] : 1;
    const shakeX = (env.shakeX || 0) | 0;
    const flashWash = (env.muzzleFlash || 0) * 16;
    // A flash of black — the creature's exit. Applied last so it takes the
    // grain and the vignette down with it and the frame really is gone.
    const dark = 1 - clamp(env.darkFlash || 0, 0, 1);

    for (let y = 0; y < H; y++) {
      const rowBase = y * W;
      const scanMul = (y & 1) ? scan : 1;
      const srcRow = rowBase;
      for (let x = 0; x < W; x++) {
        const idx = rowBase + x;
        let sx = x + shakeX;
        if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
        const sidx = srcRow + sx;
        let r, g, b;
        if (chroma) {
          // VHS RGB split: pull red from the right, blue from the left.
          const rx = sx + chroma < W ? sidx + chroma : sidx;
          const bx = sx - chroma >= 0 ? sidx - chroma : sidx;
          r = buf[rx] & 255;
          g = (buf[sidx] >> 8) & 255;
          b = (buf[bx] >> 16) & 255;
        } else {
          const c = buf[sidx];
          r = c & 255; g = (c >> 8) & 255; b = (c >> 16) & 255;
        }
        const v = vign[idx] * scanMul;
        let gi = idx + gOff; if (gi >= N) gi -= N;
        const gn = grain[gi] * grainAmt;
        r = (r * v * gr + gn + flashWash) * dark;
        g = (g * v * gg + gn + flashWash * 0.85) * dark;
        b = (b * v * gb + gn + flashWash * 0.62) * dark;
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        out[idx] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      }
    }
  }
}
