// renderer.js — the raycaster engine.
//
// Pipeline, all into a 480x270 uint32 buffer that is then upscaled by the
// browser with image-rendering: pixelated:
//   1. floor + ceiling casting (per-row affine texture mapping)
//   2. DDA wall casting with textured vertical slices  (also fills the z-buffer)
//   3. solid low-poly meshes (left-behind props + the gun)
//   4. billboard sprites (the figure) tested against the z-buffer
//   5. a post pass: flashlight is already baked into lighting; here we add
//      vignette, film grain, scanlines and a subtle VHS chroma split.
//
// Lighting is the whole mood: ambient is almost zero, so a pixel is only
// visible if the flashlight beam (a soft screen-space cone aimed where you
// look) reaches it AND the exponential fog hasn't swallowed it. That is what
// makes the torch "absolutely essential".

import { RENDER, LIGHT, FOG, POST } from './config.js';
import { hash2, clamp } from './mathutils.js';
import { BloodDecals } from './decals.js';
import { fbm } from './noise.js';

const W = RENDER.width;
const H = RENDER.height;
const TS = 64;                  // texel size of wall/floor/ceiling textures

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
    this.objZ = new Float32Array(W * H);                    // per-pixel depth for 3D objects
    this.viewZ = new Float32Array(W * H);                   // per-pixel depth for held viewmodels
    this.gunBounds = this._meshBounds(this.meshes.gun);

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
  }

  _meshBounds(mesh) {
    if (!mesh) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const face of mesh) {
      for (const v of face.v) {
        for (let i = 0; i < 3; i++) {
          if (v[i] < min[i]) min[i] = v[i];
          if (v[i] > max[i]) max[i] = v[i];
        }
      }
    }
    return {
      min, max,
      center: [
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5,
      ],
    };
  }

  _rebuildFog(density) {
    for (let i = 0; i < DN; i++) {
      this.fogTable[i] = Math.exp(-(i / DIST_SCALE) * density);
    }
  }

  render(player, world, env) {
    const buf = this.buf, zbuf = this.zbuf;
    const tex = this.tex;
    this._rebuildFog(env.fogDensity);

    // View basis, with anomaly FOV-breathing applied to the camera plane.
    const dirX = player.dirX, dirY = player.dirY;
    const fovScale = env.fovScale || 1;
    const planeX = player.planeX * fovScale, planeY = player.planeY * fovScale;
    const posX = player.x, posY = player.y;
    const horizon = H * 0.5 + player.viewPitch();

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
      r = fr + (r - fr) * fog; g = fg + (g - fg) * fog; b = fb + (b - fb) * fog;
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      return (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
    };

    // ---- 1. Floor + ceiling -------------------------------------------------
    const rdx0 = dirX - planeX, rdy0 = dirY - planeY;
    const rdx1 = dirX + planeX, rdy1 = dirY + planeY;
    const floorTex = tex.floor.data, ceilTex = tex.ceiling.data;
    const panelMask = tex.ceiling.panelMask;
    const panelEmit = env.panelEmissive || 0;

    for (let y = 0; y < H; y++) {
      const isFloor = y > horizon;
      let p = isFloor ? (y - horizon) : (horizon - y);
      if (p < 0.5) p = 0.5;
      let rowDist = (0.5 * H) / p;
      if (rowDist > DMAX) rowDist = DMAX;

      const stepX = rowDist * (rdx1 - rdx0) / W;
      const stepY = rowDist * (rdy1 - rdy0) / W;
      let fx = posX + rowDist * rdx0;
      let fy = posY + rowDist * rdy0;

      const data = isFloor ? floorTex : ceilTex;
      const rowBase = y * W;
      for (let x = 0; x < W; x++) {
        const tx = (((fx - Math.floor(fx)) * TS) | 0) & (TS - 1);
        const ty = (((fy - Math.floor(fy)) * TS) | 0) & (TS - 1);
        const ti = ty * TS + tx;
        const texel = data[ti];
        let tr = texel & 255, tg = (texel >> 8) & 255, tb = (texel >> 16) & 255;
        if (!isFloor && panelEmit > 0 && panelMask[ti]) {
          tr += panelEmit; tg += panelEmit; tb += panelEmit * 1.1;
        }
        buf[rowBase + x] = lit(x, y, rowDist, tr, tg, tb);
        fx += stepX; fy += stepY;
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

      let side = 0, hit = false, depth = 0;
      while (depth++ < RENDER.maxDepth) {
        if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
        else { sideDistY += deltaY; mapY += stepY; side = 1; }
        if (world.isWall(mapX, mapY)) { hit = true; break; }
      }
      if (!hit) { zbuf[x] = 1e30; continue; }

      const perp = side === 0
        ? (mapX - posX + (1 - stepX) / 2) / rdx
        : (mapY - posY + (1 - stepY) / 2) / rdy;
      zbuf[x] = perp;

      const lineHeight = H / perp;
      let drawStart = -lineHeight / 2 + horizon;
      let drawEnd = lineHeight / 2 + horizon;

      // Texture column.
      let wallX = side === 0 ? posY + perp * rdy : posX + perp * rdx;
      wallX -= Math.floor(wallX);
      let texX = (wallX * TS) | 0;
      if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) texX = TS - texX - 1;
      const variant = world.wallVariant(mapX, mapY, walls.length);
      const wdata = walls[variant].data;

      // A unique blood smear for this specific wall face (generated/cached), if any.
      const hitFace = side === 0 ? (stepX > 0 ? 0 : 1) : (stepY > 0 ? 2 : 3);
      const bdata = world.bloodWallFace(mapX, mapY) === hitFace
        ? this.bloodDecals.get(mapX, mapY, hitFace).data
        : null;

      // Slightly darken N/S faces for cheap directional shading.
      const sideDark = side === 1 ? 0.74 : 1.0;

      const step = TS / lineHeight;
      let y0 = drawStart < 0 ? 0 : drawStart | 0;
      let y1 = drawEnd > H ? H : drawEnd | 0;
      let texPos = (y0 - drawStart) * step;
      for (let y = y0; y < y1; y++) {
        const ty = (texPos | 0) & (TS - 1);
        texPos += step;
        const texel = wdata[ty * TS + texX];
        let cr = texel & 255, cg = (texel >> 8) & 255, cb = (texel >> 16) & 255;
        if (bdata) {
          const bp = bdata[ty * TS + texX];
          const ba = bp >>> 24;
          if (ba) {
            const bk = ba / 255;
            cr += ((bp & 255) - cr) * bk;
            cg += (((bp >> 8) & 255) - cg) * bk;
            cb += (((bp >> 16) & 255) - cb) * bk;
          }
        }
        buf[y * W + x] = lit(x, y, perp, cr * sideDark, cg * sideDark, cb * sideDark);
      }
    }

    // ---- 3. Solid 3D objects (props + the gun), depth-tested vs walls -------
    if (env.meshes && env.meshes.length) {
      this.objZ.fill(1e30);
      this._renderMeshes(player, env, horizon, lit);
    }

    // ---- 4. Sprites (the figure) -------------------------------------------
    if (env.entities && env.entities.length) {
      this._renderSprites(player, env, horizon, fogTable, lit);
    }

    if (env.gunEquipped) {
      this._drawHeldGun();
    }

    // ---- 5. Post-processing -------------------------------------------------
    this._post(env);
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  _renderSprites(player, env, horizon, fogTable, lit) {
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
      const feetY = horizon + (0.5 * H) / tY;     // stand on the floor
      const startY = feetY - spriteH;

      let di = tY * DIST_SCALE; if (di >= DN) di = DN - 1; di |= 0;
      const fog = fogTable[di];
      const isVoid = !!e.void;
      const isGlow = !!e.glow;
      const isOpaque = !!e.opaque;
      // The silhouette is an absence of light: it ignores the torch and only
      // darkens what's behind it, with a sqrt fog fade so it stays a perceptible
      // shape at distance. Glowing sprites are emissive, but still softened by
      // fog so they feel buried in it instead of pasted onto the screen.
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
            // Pull the background toward near-black with a faint cold cast.
            r = br + (5 - br) * alpha;
            g = bgc + (7 - bgc) * alpha;
            b = bb + (11 - bb) * alpha;
          } else if (isGlow) {
            // Emissive eyes: additive so they can glimmer through distant fog.
            r = Math.min(255, br + (texel & 255) * alpha * 1.15);
            g = Math.min(255, bgc + ((texel >> 8) & 255) * alpha * 0.75);
            b = Math.min(255, bb + ((texel >> 16) & 255) * alpha * 0.65);
          } else {
            // Light the prop's texel exactly like a wall, then composite it over
            // the background by its coverage.
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

  _renderMeshes(player, env, horizon, lit) {
    const buf = this.buf, zbuf = this.zbuf, objZ = this.objZ;
    const dirX = player.dirX, dirY = player.dirY;
    const fovScale = env.fovScale || 1;
    const planeX = player.planeX * fovScale, planeY = player.planeY * fovScale;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    const list = env.meshes
      .map(m => ({ m, d: (m.x - player.x) ** 2 + (m.y - player.y) ** 2 }))
      .sort((a, b) => b.d - a.d);

    for (const { m } of list) {
      const mesh = this.meshes[m.key];
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
            y: horizon + (0.5 - wz) * H / tY,
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

        const litc = lit(x, y, depth, r, g, bl);
        buf[idx] = litc;
        objZ[idx] = depth;
      }
    }
  }

  _meshTexel(face, inst, faceIndex, seed, u, v) {
    let r = face.r, g = face.g, b = face.b;
    const tx = (u * TS) | 0;
    const ty = (v * TS) | 0;
    const sx = tx + ((seed >>> 2) & 1023) + faceIndex * 37;
    const sy = ty + ((seed >>> 12) & 1023) + faceIndex * 53;
    const grain = (hash2(sx * 5 + 3, sy * 5 + 7) - 0.5) * 18;
    const stain = (fbm(sx * 0.08, sy * 0.08, 3) - 0.5) * 36;
    const mat = face.mat || inst.key || 'cardboard';

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
    } else if (mat === 'metal' || mat === 'gunmetal') {
      const band = (ty % 18) < 2;
      const scrape = hash2((sx / 2) | 0, (sy / 8) | 0) > 0.78 ? 22 : 0;
      r += stain * 0.25 + grain * 0.8 + scrape;
      g += stain * 0.28 + grain * 0.8 + scrape;
      b += stain * 0.35 + grain * 0.9 + scrape;
      if (band) { r *= 0.58; g *= 0.62; b *= 0.66; }
    } else if (mat === 'fabric') {
      const weave = (((tx & 3) === 0) || ((ty & 3) === 0)) ? -14 : 4;
      r += weave + stain * 0.45 + grain;
      g += weave + stain * 0.45 + grain;
      b += weave + stain * 0.55 + grain;
    } else if (mat === 'plastic') {
      const band = ty > 38 && ty < 46 ? 38 : 0;
      r += band + stain * 0.3 + grain * 0.7;
      g += band + stain * 0.2 + grain * 0.6;
      b += band * 0.7 + stain * 0.15 + grain * 0.5;
    } else if (mat === 'rubber') {
      const stipple = hash2(sx * 11, sy * 13) > 0.55 ? 5 : -7;
      r += stipple + stain * 0.15;
      g += stipple + stain * 0.15;
      b += stipple + stain * 0.18;
    }

    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
    };
  }

  _drawHeldGun() {
    const mesh = this.meshes.gun;
    const bounds = this.gunBounds;
    if (!mesh || !bounds) return;

    const t = performance.now() * 0.001;
    const bob = Math.sin(t * 5.2) * 0.012;
    const sway = Math.sin(t * 1.4) * 0.012;
    // GolfShooter-style first-person pose: the barrel runs mostly into depth,
    // with only a small right-hand angle so it reads as a held 3D weapon.
    const scale = 1.30;
    const yaw = 1.78 + Math.sin(t * 0.9) * 0.014;
    const roll = -0.14 + Math.sin(t * 1.1) * 0.010;
    const pitch = 0.08;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const focal = H * 1.02;
    const originX = 0.32 + sway;
    const originDepth = 1.10;
    const originZ = -0.32 + bob;
    const screenCY = H * 0.60;
    const center = bounds.center;
    const light = [-0.28, -0.52, 0.81];
    const faces = [];

    for (let fi = 0; fi < mesh.length; fi++) {
      const face = mesh[fi];
      const pv = [];
      const vv = [];
      let clipped = false;

      for (let i = 0; i < face.v.length; i++) {
        const v = face.v[i];
        const uv = face.uv ? face.uv[i] : [0, 0];
        let lx = (v[0] - center[0]) * scale;       // barrel/rear axis
        let up = (v[1] - center[1]) * scale;       // grip/slide axis, upright in hand
        let side = (v[2] - center[2]) * scale;     // physical thickness

        const pL = lx * cp - up * sp;
        const pU = lx * sp + up * cp;
        lx = pL; up = pU;

        const rU = up * cr - side * sr;
        const rS = up * sr + side * cr;
        up = rU; side = rS;

        const vx = originX + lx * cy - side * sy;
        const vd = originDepth + lx * sy + side * cy;
        const vz = originZ + up;
        if (vd <= 0.12) { clipped = true; break; }

        vv.push({ x: vx, d: vd, z: vz });
        pv.push({
          x: W * 0.5 + (vx / vd) * focal,
          y: screenCY - (vz / vd) * focal,
          z: vd,
          u: uv[0],
          v: uv[1],
        });
      }

      if (clipped || pv.length < 3) continue;
      const a = vv[0], b = vv[1], c = vv[2];
      const ax = b.x - a.x, ay = b.d - a.d, az = b.z - a.z;
      const bx = c.x - a.x, by = c.d - a.d, bz = c.z - a.z;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const ndl = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl);
      const shade = 0.46 + ndl * 0.72;
      const depth = pv.reduce((sum, p) => sum + p.z, 0) / pv.length;
      faces.push({ face, pv, fi, depth, shade });
    }

    this.viewZ.fill(1e30);
    const inst = { key: 'gun' };
    const seed = 0x5eed971;
    faces.sort((a, b) => b.depth - a.depth);
    for (const item of faces) {
      const pv = item.pv;
      for (let i = 1; i < pv.length - 1; i++) {
        this._drawViewmodelTri(pv[0], pv[i], pv[i + 1], item.face, inst, item.fi, seed, item.shade);
      }
    }
  }

  _drawViewmodelTri(a, b, c, face, inst, faceIndex, seed, shade) {
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
    const alpha = face.a == null ? 0.98 : face.a;

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

        const u = a.u * l0 + b.u * l1 + c.u * l2;
        const v = a.v * l0 + b.v * l1 + c.v * l2;
        let { r, g, b: bl } = this._meshTexel(face, inst, faceIndex, seed, u, v);
        r = clamp(r * shade + 7, 0, 255);
        g = clamp(g * shade + 7, 0, 255);
        bl = clamp(bl * shade + 8, 0, 255);

        const bg = buf[idx];
        const br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
        const rr = br + (r - br) * alpha;
        const gg = bgc + (g - bgc) * alpha;
        const bbb = bb + (bl - bb) * alpha;
        buf[idx] = (0xff000000 | ((bbb | 0) << 16) | ((gg | 0) << 8) | (rr | 0)) >>> 0;
        viewZ[idx] = depth;
      }
    }
  }

  _post(env) {
    const buf = this.buf, out = this.out, vign = this.vign, grain = this.grain;
    const N = W * H;
    const gOff = (Math.random() * N) | 0;
    const grainAmt = POST.grain;
    const scan = 1 - POST.scanlineDarken;
    const chroma = POST.chromaShift | 0;

    for (let y = 0; y < H; y++) {
      const rowBase = y * W;
      const scanMul = (y & 1) ? scan : 1;
      for (let x = 0; x < W; x++) {
        const idx = rowBase + x;
        let r, g, b;
        if (chroma) {
          // VHS RGB split: pull red from the right, blue from the left.
          const rx = x + chroma < W ? idx + chroma : idx;
          const bx = x - chroma >= 0 ? idx - chroma : idx;
          r = buf[rx] & 255;
          g = (buf[idx] >> 8) & 255;
          b = (buf[bx] >> 16) & 255;
        } else {
          const c = buf[idx];
          r = c & 255; g = (c >> 8) & 255; b = (c >> 16) & 255;
        }
        const v = vign[idx] * scanMul;
        let gi = idx + gOff; if (gi >= N) gi -= N;
        const gn = grain[gi] * grainAmt;
        r = r * v + gn; g = g * v + gn; b = b * v + gn;
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        out[idx] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      }
    }
  }
}
