// mesh.js — tiny low-poly meshes for the "left-behind" objects and the gun.
//
// A mesh is just an array of faces; a face is { v, uv, r,g,b, mat } (a convex
// polygon, fanned into triangles by the renderer). Colours bake in cheap
// per-face form-shade; the renderer adds small procedural material texture.
//
// Local space: one unit == one wall height, z is up with 0 at the floor, and the
// object's footprint is centred on (0,0). Each placed instance gets a fixed world
// yaw, which is what makes these genuinely 3D (real parallax) instead of sprites
// that pivot to face the camera.

const sc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Axis-aligned box. Per-face shade (top lightest → bottom darkest) gives form.
export function box(x0, y0, z0, x1, y1, z1, col, opt = {}) {
  const top = col, bot = sc(col, 0.42), a = sc(col, 0.82), b = sc(col, 0.64);
  const mat = opt.mat || 'cardboard';
  const f = [];
  const push = (v, c, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) =>
    f.push({ v, uv, r: c[0], g: c[1], b: c[2], mat });
  push([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top);         // top
  if (!opt.noBottom) push([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], bot); // bottom
  push([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], a);           // -y
  push([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], a);           // +y
  push([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], b);           // -x
  push([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], b);           // +x
  return f;
}

// N-sided prism (a faceted cylinder) — the steel drum. Side facets are shaded by
// angle so the cylinder looks round under flat shading.
function prism(n, rad, z0, z1, col) {
  const top = [], bot = [], f = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2, cx = Math.cos(ang) * rad, cy = Math.sin(ang) * rad;
    top.push([cx, cy, z1]); bot.push([cx, cy, z0]);
  }
  f.push({
    v: top,
    uv: top.map(([x, y]) => [0.5 + x / (rad * 2), 0.5 + y / (rad * 2)]),
    r: col[0], g: col[1], b: col[2], mat: 'metal',
  }); // top cap
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = ((i + 0.5) / n) * Math.PI * 2;
    const c = sc(col, 0.5 + 0.5 * Math.max(0, Math.cos(a + 0.6)));
    f.push({ v: [bot[i], bot[j], top[j], top[i]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], r: c[0], g: c[1], b: c[2], mat: 'metal' });
  }
  return f;
}

// N-sided pyramid (a faceted cone) — the traffic cone.
function pyramid(n, rad, z0, zApex, col) {
  const ring = [], f = [], apex = [0, 0, zApex];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push([Math.cos(a) * rad, Math.sin(a) * rad, z0]); }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = ((i + 0.5) / n) * Math.PI * 2;
    const c = sc(col, 0.55 + 0.45 * Math.max(0, Math.cos(a + 0.6)));
    f.push({ v: [ring[i], ring[j], apex], uv: [[0, 1], [1, 1], [0.5, 0]], r: c[0], g: c[1], b: c[2], mat: 'plastic' });
  }
  return f;
}

const PISTOL_PARTS = [
  { name: 'frame', type: 'box', x: 0, y: 0.02, z: -0.05, sx: 0.11, sy: 0.08, sz: 0.36 },
  { name: 'frameAccentL', type: 'box', x: -0.0565, y: 0.02, z: -0.07, sx: 0.005, sy: 0.05, sz: 0.28 },
  { name: 'frameAccentR', type: 'box', x: 0.0565, y: 0.02, z: -0.07, sx: 0.005, sy: 0.05, sz: 0.28 },
  { name: 'slide', type: 'box', x: 0, y: 0.085, z: -0.1, sx: 0.118, sy: 0.078, sz: 0.44 },
  { name: 'slideTopRib', type: 'box', x: 0, y: 0.127, z: -0.1, sx: 0.07, sy: 0.018, sz: 0.42 },
  { name: 'slideStripeL', type: 'box', x: -0.0605, y: 0.1, z: -0.1, sx: 0.004, sy: 0.022, sz: 0.4 },
  { name: 'slideStripeR', type: 'box', x: 0.0605, y: 0.1, z: -0.1, sx: 0.004, sy: 0.022, sz: 0.4 },
  { name: 'serrRear0', type: 'box', x: 0, y: 0.085, z: 0.055, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrRear1', type: 'box', x: 0, y: 0.085, z: 0.072, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrRear2', type: 'box', x: 0, y: 0.085, z: 0.089, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrRear3', type: 'box', x: 0, y: 0.085, z: 0.106, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrFront0', type: 'box', x: 0, y: 0.085, z: -0.255, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrFront1', type: 'box', x: 0, y: 0.085, z: -0.272, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'serrFront2', type: 'box', x: 0, y: 0.085, z: -0.289, sx: 0.124, sy: 0.062, sz: 0.007 },
  { name: 'ejectionPort', type: 'box', x: 0.0615, y: 0.098, z: -0.03, sx: 0.004, sy: 0.04, sz: 0.1 },
  { name: 'barrel', type: 'cylinder', x: 0, y: 0.085, z: -0.37, sx: 0.03, sy: 0.16, sz: 0.03, rotX: 1.5708 },
  { name: 'barrelBushing', type: 'cylinder', x: 0, y: 0.085, z: -0.317, sx: 0.042, sy: 0.028, sz: 0.042, rotX: 1.5708 },
  { name: 'compBody', type: 'box', x: 0, y: 0.085, z: -0.415, sx: 0.095, sy: 0.072, sz: 0.09 },
  { name: 'compVent0', type: 'box', x: 0, y: 0.125, z: -0.398, sx: 0.04, sy: 0.012, sz: 0.02 },
  { name: 'compVent1', type: 'box', x: 0, y: 0.125, z: -0.432, sx: 0.04, sy: 0.012, sz: 0.02 },
  { name: 'hammer', type: 'box', x: 0, y: 0.108, z: 0.122, sx: 0.026, sy: 0.05, sz: 0.028, rotX: 0.45 },
  { name: 'beavertail', type: 'box', x: 0, y: 0.055, z: 0.105, sx: 0.07, sy: 0.028, sz: 0.06, rotX: -0.2 },
  { name: 'grip', type: 'box', x: 0, y: -0.085, z: 0.045, sx: 0.092, sy: 0.21, sz: 0.096, rotX: -0.25 },
  { name: 'gripPlateL', type: 'box', x: -0.05, y: -0.085, z: 0.045, sx: 0.012, sy: 0.18, sz: 0.085, rotX: -0.25 },
  { name: 'gripPlateR', type: 'box', x: 0.05, y: -0.085, z: 0.045, sx: 0.012, sy: 0.18, sz: 0.085, rotX: -0.25 },
  { name: 'gripScrewTopL', type: 'sphere', x: -0.058, y: -0.018, z: 0.032, sx: 0.009, sy: 0.009, sz: 0.009 },
  { name: 'gripScrewBotL', type: 'sphere', x: -0.058, y: -0.152, z: 0.066, sx: 0.009, sy: 0.009, sz: 0.009 },
  { name: 'gripScrewTopR', type: 'sphere', x: 0.058, y: -0.018, z: 0.032, sx: 0.009, sy: 0.009, sz: 0.009 },
  { name: 'gripScrewBotR', type: 'sphere', x: 0.058, y: -0.152, z: 0.066, sx: 0.009, sy: 0.009, sz: 0.009 },
  { name: 'magBase', type: 'box', x: 0, y: -0.196, z: 0.075, sx: 0.104, sy: 0.032, sz: 0.115, rotX: -0.25 },
  { name: 'triggerGuardFront', type: 'box', x: 0, y: -0.005, z: -0.122, sx: 0.03, sy: 0.085, sz: 0.02 },
  { name: 'triggerGuardBottom', type: 'box', x: 0, y: -0.043, z: -0.06, sx: 0.03, sy: 0.018, sz: 0.125 },
  { name: 'trigger', type: 'box', x: 0, y: 0.003, z: -0.075, sx: 0.016, sy: 0.046, sz: 0.018, rotX: -0.2 },
  { name: 'slideRelease', type: 'box', x: -0.061, y: 0.048, z: 0.015, sx: 0.012, sy: 0.018, sz: 0.07 },
  { name: 'safetyLever', type: 'box', x: 0.061, y: 0.052, z: 0.075, sx: 0.012, sy: 0.016, sz: 0.045 },
  { name: 'railBase', type: 'box', x: 0, y: -0.026, z: -0.165, sx: 0.07, sy: 0.02, sz: 0.145 },
  { name: 'railRib0', type: 'box', x: 0, y: -0.038, z: -0.12, sx: 0.074, sy: 0.012, sz: 0.018 },
  { name: 'railRib1', type: 'box', x: 0, y: -0.038, z: -0.165, sx: 0.074, sy: 0.012, sz: 0.018 },
  { name: 'railRib2', type: 'box', x: 0, y: -0.038, z: -0.21, sx: 0.074, sy: 0.012, sz: 0.018 },
  { name: 'sightRearL', type: 'box', x: -0.022, y: 0.146, z: 0.085, sx: 0.016, sy: 0.024, sz: 0.022 },
  { name: 'sightRearR', type: 'box', x: 0.022, y: 0.146, z: 0.085, sx: 0.016, sy: 0.024, sz: 0.022 },
  { name: 'sightFront', type: 'box', x: 0, y: 0.147, z: -0.3, sx: 0.018, sy: 0.026, sz: 0.02 },
];

function rotateWeaponOffset(x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) {
    const c = Math.cos(rx), s = Math.sin(rx), ny = y * c - z * s, nz = y * s + z * c;
    y = ny; z = nz;
  }
  if (ry) {
    const c = Math.cos(ry), s = Math.sin(ry), nx = x * c + z * s, nz = -x * s + z * c;
    x = nx; z = nz;
  }
  if (rz) {
    const c = Math.cos(rz), s = Math.sin(rz), nx = x * c - y * s, ny = x * s + y * c;
    x = nx; y = ny;
  }
  return [x, y, z];
}

function mapWeaponPoint(x, y, z) {
  const scale = 0.72;
  return [(-z - 0.17) * scale, (y + 0.03) * scale, (x + 0.084) * scale + 0.012];
}

function weaponTone(name) {
  if (name.includes('Port') || name.includes('bore')) return [8, 9, 12];
  if (name.includes('Screw') || name.includes('Release') || name.includes('safety')) return [54, 56, 64];
  if (name.includes('Stripe') || name.includes('Accent') || name.includes('Rib') || name.includes('Vent') || name.includes('serr')) return [26, 28, 34];
  if (name.includes('grip') || name.includes('trigger')) return [16, 17, 20];
  if (name.includes('barrel') || name.includes('Bushing') || name.includes('slide')) return [46, 48, 56];
  return [31, 33, 39];
}

function weaponMat(name) {
  return name.includes('grip') || name.includes('trigger') ? 'rubber' : 'gunmetal';
}

function pushWeaponFace(f, v, col, mat, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  f.push({ v, uv, r: col[0], g: col[1], b: col[2], mat });
}

function weaponBox(part) {
  const hx = part.sx * 0.5, hy = part.sy * 0.5, hz = part.sz * 0.5;
  const corners = [
    [-hx, -hy, -hz], [ hx, -hy, -hz], [ hx,  hy, -hz], [-hx,  hy, -hz],
    [-hx, -hy,  hz], [ hx, -hy,  hz], [ hx,  hy,  hz], [-hx,  hy,  hz],
  ].map(([x, y, z]) => {
    const [rx, ry, rz] = rotateWeaponOffset(x, y, z, part.rotX, part.rotY, part.rotZ);
    return mapWeaponPoint(part.x + rx, part.y + ry, part.z + rz);
  });
  const col = weaponTone(part.name), mat = weaponMat(part.name);
  const top = sc(col, 1.08), bot = sc(col, 0.44), a = sc(col, 0.82), b = sc(col, 0.64);
  const f = [];
  pushWeaponFace(f, [corners[4], corners[5], corners[6], corners[7]], top, mat);
  pushWeaponFace(f, [corners[0], corners[3], corners[2], corners[1]], bot, mat);
  pushWeaponFace(f, [corners[0], corners[1], corners[5], corners[4]], a, mat);
  pushWeaponFace(f, [corners[3], corners[7], corners[6], corners[2]], a, mat);
  pushWeaponFace(f, [corners[0], corners[4], corners[7], corners[3]], b, mat);
  pushWeaponFace(f, [corners[1], corners[2], corners[6], corners[5]], b, mat);
  return f;
}

function weaponCylinder(part) {
  const n = 8, f = [], top = [], bot = [];
  const rx = part.sx * 0.5, rz = part.sz * 0.5, hy = part.sy * 0.5;
  const col = weaponTone(part.name), mat = 'gunmetal';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lx = Math.cos(a) * rx, lz = Math.sin(a) * rz;
    for (const [dst, ly] of [[bot, -hy], [top, hy]]) {
      const [ox, oy, oz] = rotateWeaponOffset(lx, ly, lz, part.rotX, part.rotY, part.rotZ);
      dst.push(mapWeaponPoint(part.x + ox, part.y + oy, part.z + oz));
    }
  }
  pushWeaponFace(f, top, sc(col, 1.05), mat, top.map((_, i) => [i / n, 0]));
  pushWeaponFace(f, bot.slice().reverse(), sc(col, 0.42), mat, bot.map((_, i) => [i / n, 1]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, shade = sc(col, 0.52 + 0.42 * Math.max(0, Math.cos((i / n) * Math.PI * 2 + 0.8)));
    pushWeaponFace(f, [bot[i], bot[j], top[j], top[i]], shade, mat);
  }
  return f;
}

function weaponPebble(part) {
  const r = part.sx;
  const px = mapWeaponPoint(part.x + r, part.y, part.z);
  const nx = mapWeaponPoint(part.x - r, part.y, part.z);
  const py = mapWeaponPoint(part.x, part.y + r, part.z);
  const ny = mapWeaponPoint(part.x, part.y - r, part.z);
  const pz = mapWeaponPoint(part.x, part.y, part.z + r);
  const nz = mapWeaponPoint(part.x, part.y, part.z - r);
  const col = weaponTone(part.name), mat = 'gunmetal', f = [];
  const tris = [[px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz], [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz]];
  for (const tri of tris) pushWeaponFace(f, tri, col, mat, [[0, 0], [1, 0], [0.5, 1]]);
  return f;
}

// Adapted from GolfShooter's pistol JSON part model, but recoloured to black
// and dark grey only, then rotated so the found gun lies on its side.
function buildGun() {
  const faces = [];
  for (const part of PISTOL_PARTS) {
    if (part.type === 'cylinder') faces.push(...weaponCylinder(part));
    else if (part.type === 'sphere') faces.push(...weaponPebble(part));
    else faces.push(...weaponBox(part));
  }
  return faces;
}

// A flat blood pool that lies on the floor (z just above it). Flagged so the
// renderer alpha-blends it with per-pixel noise instead of drawing it solid.
function bloodPool(rad) {
  const n = 14, ring = [], f = [], c = [0, 0, 0.02];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = rad * (0.8 + 0.2 * Math.sin(a * 3 + 1));
    ring.push([Math.cos(a) * r, Math.sin(a) * r, 0.02]);
  }
  for (let i = 0; i < n; i++) f.push({ v: [c, ring[i], ring[(i + 1) % n]], uv: [[0.5, 0.5], [1, 0], [1, 1]], r: 92, g: 12, b: 10, mat: 'blood', pool: true, a: 0.72 });
  return f;
}

// Built once at boot; the renderer looks meshes up by key.
export function buildMeshes() {
  return {
    box:      box(-0.22, -0.22, 0, 0.22, 0.22, 0.42, [172, 134, 86], { mat: 'cardboard' }),
    crate:    box(-0.26, -0.26, 0, 0.26, 0.26, 0.50, [150, 110, 64], { mat: 'wood' }),
    barrel:   prism(8, 0.22, 0, 0.62, [70, 96, 104]),
    suitcase: [...box(-0.20, -0.09, 0, 0.20, 0.09, 0.50, [74, 78, 92], { mat: 'fabric' }),
               ...box(-0.06, -0.02, 0.50, 0.06, 0.02, 0.56, [44, 46, 56], { mat: 'rubber' })],
    cone:     [...box(-0.16, -0.16, 0, 0.16, 0.16, 0.05, [40, 40, 44], { mat: 'rubber' }),
               ...pyramid(10, 0.16, 0.05, 0.50, [214, 104, 30])],
    gun:      buildGun(),
    bloodPool: bloodPool(0.62),
  };
}
