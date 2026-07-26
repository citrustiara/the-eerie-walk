// mesh.js — the low-poly primitive kit every solid object in the game is built
// from.
//
// A mesh is just an array of faces; a face is
//   { v: [[x,y,z], ...], uv, r, g, b, mat, a?, pool?, emit? }
// — a convex polygon that the renderer fans into triangles. Per-face colours
// bake in cheap form-shading; the renderer layers procedural material texture
// (see `_meshTexel`) on top.
//
// SCALE. This is the important bit. One world unit is the ceiling height, which
// we treat as 3 metres — so the player's 0.5-unit eye height reads as a 1.5 m
// person. Authoring props at "0.3 units tall" produced furniture-sized junk, so
// every model in models.js is authored in **metres** and converted once with
// `toWorld()`. A 34 cm cardboard box is written as 0.34 and ends up 0.11 units
// tall: something you look down at, which is the whole point.
//
// Local space: z is up with 0 at the floor, the footprint is centred on (0,0),
// and each placed instance gets a fixed world yaw. That fixed yaw is what makes
// these genuinely 3D — they parallax instead of pivoting to face the camera.

export const METER = 1 / 3;

const sc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const DEFAULT_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

// Build one face. uv defaults to a unit quad clipped to the vertex count, which
// is all the material shader needs.
export function face(v, col, mat, opt = {}) {
  const f = {
    v,
    uv: opt.uv || (v.length <= 4 ? DEFAULT_UV.slice(0, v.length) : v.map((_, i) => [i / v.length, i & 1])),
    r: col[0], g: col[1], b: col[2],
    mat,
  };
  if (opt.a != null) f.a = opt.a;
  if (opt.pool) f.pool = true;
  if (opt.emit) f.emit = opt.emit;
  return f;
}

// --- transforms -------------------------------------------------------------
// All of these return new face arrays, so models compose by nesting calls.

export function xform(faces, fn) {
  return faces.map((f) => ({ ...f, v: f.v.map(fn) }));
}

// In-place variant. `fn` mutates the vertex array it is handed, and no face
// objects are cloned. Only safe on geometry you just built and do not share —
// which is exactly the creature, rebuilt from scratch every frame. Composing
// its pose out of the cloning `xform` above cost about 2 ms a frame; this is
// the same maths without the garbage.
export function xformIn(faces, fn) {
  for (let i = 0; i < faces.length; i++) {
    const v = faces[i].v;
    for (let j = 0; j < v.length; j++) fn(v[j]);
  }
  return faces;
}

export function translate(faces, dx, dy, dz) {
  return xform(faces, ([x, y, z]) => [x + dx, y + dy, z + dz]);
}

export function scaleFaces(faces, kx, ky = kx, kz = kx) {
  return xform(faces, ([x, y, z]) => [x * kx, y * ky, z * kz]);
}

export function rotX(faces, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return xform(faces, ([x, y, z]) => [x, y * c - z * s, y * s + z * c]);
}

export function rotY(faces, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return xform(faces, ([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
}

export function rotZ(faces, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return xform(faces, ([x, y, z]) => [x * c - y * s, x * s + y * c, z]);
}

// Recolour a whole sub-mesh, keeping the per-face form shading ratios.
export function tint(faces, col) {
  return faces.map((f) => {
    const lum = (f.r + f.g + f.b) / 3 || 1;
    const k = lum / 255;
    return { ...f, r: col[0] * k * 1.6, g: col[1] * k * 1.6, b: col[2] * k * 1.6 };
  });
}

// Metres -> world units. Applied once, at the end of every model.
export function toWorld(faces) {
  return scaleFaces(faces, METER);
}

// --- solids -----------------------------------------------------------------

// Axis-aligned box from corner to corner. Per-face shade (top lightest ->
// bottom darkest) is what gives these flat-shaded solids their form.
export function box(x0, y0, z0, x1, y1, z1, col, opt = {}) {
  const mat = opt.mat || 'cardboard';
  const top = opt.topCol || col;
  const bot = sc(col, 0.34), a = sc(col, 0.80), b = sc(col, 0.58);
  const f = [];
  f.push(face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top, mat, opt));
  if (!opt.noBottom) f.push(face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], bot, mat, opt));
  f.push(face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], a, mat, opt));
  f.push(face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], a, mat, opt));
  f.push(face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], b, mat, opt));
  f.push(face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], b, mat, opt));
  return f;
}

// Centre-and-size box — how nearly every model actually wants to place parts.
export function bx(cx, cy, cz, sx, sy, sz, col, opt = {}) {
  return box(cx - sx / 2, cy - sy / 2, cz - sz / 2,
             cx + sx / 2, cy + sy / 2, cz + sz / 2, col, opt);
}

// N-sided prism along +z. r0/r1 differ to give truncated cones (buckets, traffic
// cones, cups); r1 == 0 gives a proper cone. Side facets are shaded by their
// angle so flat shading still reads as round.
// NOTE: every face gets its OWN copy of each vertex, even though the ring
// points are shared geometrically. That matters because xformIn mutates
// vertices in place — with shared arrays a corner belonging to three faces
// would be transformed three times and the solid would fold itself inside out.
export function prism(n, r0, r1, z0, z1, col, mat = 'metal', opt = {}) {
  const bot = [], top = [], f = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    bot.push([Math.cos(a) * r0, Math.sin(a) * r0, z0]);
    top.push([Math.cos(a) * r1, Math.sin(a) * r1, z1]);
  }
  const cp = (v) => [v[0], v[1], v[2]];
  if (r1 > 1e-4 && !opt.openTop) f.push(face(top.map(cp), sc(col, opt.capK || 1.05), mat, opt));
  if (r0 > 1e-4 && !opt.openBottom) f.push(face(bot.slice().reverse().map(cp), sc(col, 0.34), mat, opt));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const k = 0.38 + 0.62 * Math.max(0, Math.cos(a + 0.7));
    const v = r1 > 1e-4
      ? [cp(bot[i]), cp(bot[j]), cp(top[j]), cp(top[i])]
      : [cp(bot[i]), cp(bot[j]), cp(top[0])];
    f.push(face(v, sc(col, k), mat, opt));
  }
  return f;
}

// A cylinder whose axis runs along y (wheels, rollers, drum hoops seen edge-on).
export function cylY(n, rad, len, col, mat = 'metal') {
  return rotX(prism(n, rad, rad, -len / 2, len / 2, col, mat), Math.PI / 2);
}

// UV sphere. Shaded by latitude *and* azimuth so a doll's head doesn't read as
// a flat disc under the torch.
export function sphere(r, col, mat = 'porcelain', seg = 8, rings = 5) {
  const f = [];
  const pt = (i, j) => {
    const phi = (j / rings) * Math.PI;
    const th = (i / seg) * Math.PI * 2;
    return [Math.sin(phi) * Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r, Math.cos(phi) * r];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const lat = 0.46 + 0.54 * (1 - j / rings);
      const az = 0.60 + 0.40 * Math.max(0, Math.cos(((i + 0.5) / seg) * Math.PI * 2 + 0.8));
      const cc = sc(col, lat * az * 1.2);
      const v = j === 0 ? [a, c, d] : j === rings - 1 ? [a, b, c] : [a, b, c, d];
      f.push(face(v, cc, mat));
    }
  }
  return f;
}

// A flat quad lying on the floor at height z — spills, stains, paper, puddles.
export function slab(rad, z, col, mat, opt = {}) {
  const n = opt.n || 12, ring = [], f = [];
  const wob = opt.wobble == null ? 0.22 : opt.wobble;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = rad * (1 - wob + wob * (0.5 + 0.5 * Math.sin(a * 3 + (opt.phase || 1))));
    ring.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  const cp = (v) => [v[0], v[1], v[2]];
  for (let i = 0; i < n; i++) {
    // Unshared vertices, for the same reason as prism above.
    f.push(face([[0, 0, z], cp(ring[i]), cp(ring[(i + 1) % n])], col, mat, {
      uv: [[0.5, 0.5], [1, 0], [1, 1]], a: opt.a, pool: opt.pool,
    }));
  }
  return f;
}
