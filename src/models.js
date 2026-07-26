// models.js — every solid object in the world, built from the mesh.js kit.
//
// EVERYTHING HERE IS AUTHORED IN METRES and converted once by `toWorld()` at the
// bottom. The player's eye sits at 1.5 m, so a 0.34 m box is genuinely something
// you look *down* at — that scale relationship is the whole reason these read as
// abandoned human clutter rather than level geometry.
//
// The catalogue is deliberately domestic and childish in places (dolls, a trike,
// a single shoe). Industrial junk is just scenery; a teddy bear face-down in a
// corridor that goes on forever is a story.

import {
  box, bx, prism, cylY, sphere, slab, face,
  translate, rotX, rotY, rotZ, toWorld, METER,
} from './mesh.js';

// --- palette (already grimy; the world is very dark) ------------------------
const CARD = [126, 98, 62];
const WOOD = [116, 86, 50];
const DARKWOOD = [78, 58, 36];
const STEEL = [88, 92, 98];
const RUST = [104, 66, 40];
const PORCELAIN = [206, 194, 178];
const BLOOD = [96, 14, 12];

// ============================================================================
// 1. Sealed cardboard box — packing tape, slightly crushed lid.
// ============================================================================
function cardboardBox() {
  const w = 0.36, d = 0.30, h = 0.28;
  return [
    ...bx(0, 0, h / 2, w, d, h, CARD, { mat: 'cardboard' }),
    // Tape running the length of the lid, plus a short cross piece.
    ...bx(0, 0, h + 0.003, w * 1.02, 0.055, 0.005, [148, 140, 120], { mat: 'plastic' }),
    ...bx(0.08, 0, h + 0.004, 0.05, d * 1.02, 0.004, [148, 140, 120], { mat: 'plastic' }),
    // A corner stove in — nothing here survived intact.
    ...bx(w / 2 - 0.03, d / 2 - 0.03, h - 0.02, 0.08, 0.08, 0.05, [96, 74, 46], { mat: 'cardboard' }),
  ];
}

// ============================================================================
// 2. Open cardboard box — four splayed flaps and a black interior.
// ============================================================================
function cardboardOpen() {
  const w = 0.34, d = 0.30, h = 0.26, t = 0.008;
  const f = [
    ...bx(0, 0, h / 2, w, d, h, CARD, { mat: 'cardboard' }),
    // Void interior: a smaller, near-black box sunk inside the walls.
    ...bx(0, 0, h / 2 + 0.01, w - 0.03, d - 0.03, h, [14, 11, 9], { mat: 'cardboard', noBottom: true }),
  ];
  const flap = (len, wid) => bx(0, 0, 0, len, wid, t, [136, 108, 70], { mat: 'cardboard' });
  f.push(...translate(rotY(flap(0.20, d - 0.02), -0.9), w / 2 + 0.06, 0, h + 0.06));
  f.push(...translate(rotY(flap(0.20, d - 0.02), 0.7), -w / 2 - 0.05, 0, h + 0.05));
  f.push(...translate(rotX(flap(w - 0.02, 0.18), 1.0), 0, d / 2 + 0.05, h + 0.05));
  f.push(...translate(rotX(flap(w - 0.02, 0.18), -0.6), 0, -d / 2 - 0.04, h + 0.04));
  return f;
}

// ============================================================================
// 3. Wooden crate — corner posts and slatted sides, gaps you can see into.
// ============================================================================
function crate() {
  const w = 0.42, h = 0.38, p = 0.035, t = 0.014;
  const f = [...bx(0, 0, 0.012, w - 0.04, w - 0.04, 0.024, [40, 30, 20], { mat: 'wood' })];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    f.push(...bx(sx * (w / 2 - p / 2), sy * (w / 2 - p / 2), h / 2, p, p, h, WOOD, { mat: 'wood' }));
  }
  // Three horizontal slats per side, with air between them.
  for (const z of [0.06, 0.19, 0.32]) {
    f.push(...bx(0, w / 2 - t / 2, z, w - p, t, 0.075, DARKWOOD, { mat: 'wood' }));
    f.push(...bx(0, -w / 2 + t / 2, z, w - p, t, 0.075, DARKWOOD, { mat: 'wood' }));
    f.push(...bx(w / 2 - t / 2, 0, z, t, w - p, 0.075, WOOD, { mat: 'wood' }));
    f.push(...bx(-w / 2 + t / 2, 0, z, t, w - p, 0.075, WOOD, { mat: 'wood' }));
  }
  return f;
}

// ============================================================================
// 4. Steel drum — rolling hoops, rusted lid, standard 88 cm oil barrel.
// ============================================================================
function drum() {
  const r = 0.29, h = 0.88;
  return [
    ...prism(10, r, r, 0, h, RUST, 'metal'),
    ...prism(10, r * 1.05, r * 1.05, 0.20, 0.245, STEEL, 'metal'),
    ...prism(10, r * 1.05, r * 1.05, 0.61, 0.655, STEEL, 'metal'),
    ...prism(10, r * 0.86, r * 0.86, h, h + 0.012, [72, 50, 34], 'metal'),
    ...prism(6, 0.045, 0.045, h + 0.012, h + 0.03, [58, 60, 64], 'metal'),
  ];
}

// ============================================================================
// 5. Traffic cone — reflective collar, scuffed rubber base.
// ============================================================================
function cone() {
  return [
    ...bx(0, 0, 0.012, 0.30, 0.30, 0.024, [34, 32, 32], { mat: 'rubber' }),
    ...prism(10, 0.13, 0.095, 0.024, 0.16, [176, 76, 22], 'plastic'),
    ...prism(10, 0.093, 0.070, 0.16, 0.28, [188, 196, 190], 'plastic'),
    ...prism(10, 0.068, 0.048, 0.28, 0.38, [176, 76, 22], 'plastic'),
    ...prism(10, 0.046, 0.014, 0.38, 0.52, [162, 68, 20], 'plastic'),
  ];
}

// ============================================================================
// 6. Suitcase — hard-shell, lying flat, brass clasps and a stitched handle.
// ============================================================================
function suitcase() {
  const w = 0.62, d = 0.44, h = 0.17;
  const f = [
    ...bx(0, 0, h / 2, w, d, h, [66, 54, 48], { mat: 'leather' }),
    // Seam between the halves.
    ...bx(0, 0, h * 0.52, w * 1.005, d * 1.005, 0.008, [34, 28, 26], { mat: 'leather' }),
  ];
  for (const sy of [-0.13, 0.13]) {
    f.push(...bx(w / 2 - 0.005, sy, h * 0.52, 0.02, 0.055, 0.035, [136, 118, 72], { mat: 'metal' }));
  }
  // Handle: two posts and a bar, standing proud of the shell.
  f.push(...bx(-0.055, d / 2 + 0.008, h * 0.52, 0.018, 0.02, 0.05, [40, 34, 32], { mat: 'leather' }));
  f.push(...bx(0.055, d / 2 + 0.008, h * 0.52, 0.018, 0.02, 0.05, [40, 34, 32], { mat: 'leather' }));
  f.push(...bx(0, d / 2 + 0.008, h * 0.52 + 0.028, 0.13, 0.026, 0.022, [52, 44, 40], { mat: 'leather' }));
  return f;
}

// ============================================================================
// 7. Porcelain doll — sitting, head tipped, one arm torn off at the shoulder.
//    The single most unsettling thing in the catalogue, and it is 41 cm tall.
// ============================================================================
function doll() {
  const f = [];
  const dress = [128, 104, 116];
  // Legs, splayed forward the way a dropped doll sits.
  for (const sy of [-0.055, 0.055]) {
    f.push(...translate(rotY(prism(6, 0.028, 0.024, 0, 0.15, PORCELAIN, 'porcelain'), 1.35), 0.075, sy, 0.030));
    f.push(...translate(prism(6, 0.030, 0.022, 0, 0.045, [42, 34, 34], 'leather'), 0.185, sy, 0.012)); // shoe
  }
  // Skirt + torso.
  f.push(...prism(8, 0.115, 0.062, 0.02, 0.19, dress, 'fabric'));
  f.push(...prism(6, 0.058, 0.052, 0.19, 0.28, dress, 'fabric'));
  // Arms: left intact and hanging, right a raw stub.
  f.push(...translate(rotY(prism(5, 0.019, 0.014, 0, 0.16, PORCELAIN, 'porcelain'), 0.42), -0.02, -0.072, 0.255));
  f.push(...translate(prism(5, 0.024, 0.020, 0, 0.028, [86, 24, 22], 'porcelain'), 0, 0.068, 0.255));
  // Head, tipped over to one side. The tilt is doing a lot of work.
  const head = [
    ...sphere(0.062, PORCELAIN, 'porcelain', 8, 5),
    // Eyes: two black glass beads set deep. One is missing — just a socket.
    ...translate(sphere(0.011, [10, 8, 10], 'glass', 5, 3), 0.052, -0.024, 0.012),
    ...translate(bx(0, 0, 0, 0.014, 0.022, 0.022, [8, 6, 7], { mat: 'glass' }), 0.054, 0.024, 0.012),
    // Painted mouth.
    ...translate(bx(0, 0, 0, 0.010, 0.026, 0.008, [104, 40, 42], { mat: 'porcelain' }), 0.058, 0, -0.020),
    // Matted hair cap.
    ...translate(sphere(0.064, [58, 42, 30], 'plush', 7, 3), -0.006, 0, 0.014),
  ];
  f.push(...translate(rotX(rotY(head, 0.55), 0.35), 0.012, 0, 0.345));
  return f;
}

// ============================================================================
// 8. Teddy bear — face down, one ear chewed off, stuffing showing.
// ============================================================================
function teddy() {
  const fur = [104, 78, 52];
  const f = [
    ...sphere(0.085, fur, 'plush', 7, 4),                                   // body
    ...translate(sphere(0.060, fur, 'plush', 7, 4), 0.095, 0, 0.020),       // head
    ...translate(sphere(0.024, [122, 96, 68], 'plush', 5, 3), 0.108, -0.048, 0.058), // ear
    ...translate(sphere(0.013, [70, 52, 34], 'plush', 4, 3), 0.108, 0.050, 0.058),   // torn ear stub
    ...translate(sphere(0.020, [148, 128, 104], 'plush', 5, 3), 0.146, 0, 0.000),    // muzzle
    ...translate(sphere(0.009, [12, 10, 10], 'glass', 4, 3), 0.152, 0, 0.016),       // nose
    ...translate(sphere(0.007, [14, 12, 12], 'glass', 4, 3), 0.135, -0.028, 0.038),  // eye
  ];
  // Limbs.
  for (const sy of [-1, 1]) {
    f.push(...translate(rotY(prism(5, 0.026, 0.020, 0, 0.085, fur, 'plush'), 1.2), 0.030, sy * 0.078, -0.010));
    f.push(...translate(rotY(prism(5, 0.030, 0.024, 0, 0.090, fur, 'plush'), 1.9), -0.060, sy * 0.060, -0.020));
  }
  // Split seam with pale stuffing pushing out.
  f.push(...translate(sphere(0.026, [188, 182, 168], 'plush', 5, 3), -0.055, 0.030, 0.055));
  return translate(f, 0, 0, 0.086);
}

// ============================================================================
// 9. Wooden chair — knocked over onto its back.
// ============================================================================
function chair() {
  const leg = 0.032, seat = 0.42, seatH = 0.45;
  const f = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const backLeg = sx > 0;
    const h = backLeg ? 0.92 : seatH;
    f.push(...bx(sx * (seat / 2 - leg), sy * (seat / 2 - leg), h / 2, leg, leg, h, WOOD, { mat: 'wood' }));
  }
  f.push(...bx(0, 0, seatH + 0.016, seat, seat, 0.032, DARKWOOD, { mat: 'wood' }));
  for (const z of [0.66, 0.80]) {
    f.push(...bx(seat / 2 - leg, 0, z, leg * 0.8, seat - leg * 2, 0.07, WOOD, { mat: 'wood' }));
  }
  // Tip it onto its back so it reads as "something happened here".
  return rotY(f, 1.42);
}

// ============================================================================
// 10. CRT television — dead, cracked, still plugged into nothing.
// ============================================================================
function crtTv() {
  const w = 0.46, d = 0.42, h = 0.38;
  const f = [
    ...bx(0, 0, h / 2, w, d, h, [76, 72, 66], { mat: 'plastic' }),
    ...bx(-w / 2 - 0.004, 0, h * 0.58, 0.012, d * 0.72, h * 0.62, [16, 20, 20], { mat: 'crt' }), // screen
    ...bx(-w / 2 + 0.006, 0, h * 0.58, 0.012, d * 0.78, h * 0.68, [44, 42, 38], { mat: 'plastic' }), // bezel
  ];
  // Control knobs and a dead standby lamp.
  for (const z of [0.10, 0.16]) f.push(...translate(rotY(prism(6, 0.022, 0.020, 0, 0.014, [52, 48, 44], 'plastic'), -1.5708), -w / 2 - 0.008, d * 0.28, z));
  f.push(...translate(rotY(prism(4, 0.007, 0.007, 0, 0.010, [72, 22, 20], 'glass'), -1.5708), -w / 2 - 0.006, d * 0.28, 0.24));
  // Bent rabbit-ear antenna.
  f.push(...translate(rotY(prism(4, 0.006, 0.003, 0, 0.34, [120, 122, 126], 'chrome'), 0.5), 0.08, -0.05, h));
  f.push(...translate(rotY(prism(4, 0.006, 0.003, 0, 0.26, [120, 122, 126], 'chrome'), -0.8), 0.08, 0.05, h));
  return f;
}

// ============================================================================
// 11. Mattress — bare, stained, dragged in from somewhere.
// ============================================================================
function mattress() {
  const w = 1.88, d = 0.90, h = 0.20;
  const f = [...bx(0, 0, h / 2, w, d, h, [150, 142, 124], { mat: 'fabric' })];
  // Quilting seams.
  for (let i = -2; i <= 2; i++) {
    f.push(...bx(i * 0.34, 0, h + 0.002, 0.02, d * 0.96, 0.012, [112, 104, 90], { mat: 'fabric' }));
  }
  f.push(...bx(0, 0, h + 0.002, w * 0.96, 0.02, 0.012, [112, 104, 90], { mat: 'fabric' }));
  // The stain. Not subtle, and that is correct.
  f.push(...translate(slab(0.34, h + 0.014, BLOOD, 'blood', { a: 0.62, pool: true, phase: 2 }), 0.24, -0.10, 0));
  return f;
}

// ============================================================================
// 12. Metal toolbox — cantilever lid, chipped paint, carry handle.
// ============================================================================
function toolbox() {
  const w = 0.46, d = 0.21, h = 0.20;
  return [
    ...bx(0, 0, h / 2, w, d, h, [58, 78, 84], { mat: 'metal' }),
    ...bx(0, 0, h + 0.012, w * 0.99, d * 0.99, 0.024, [70, 92, 98], { mat: 'metal' }),
    ...bx(0, 0, h + 0.028, 0.09, 0.02, 0.008, [128, 130, 134], { mat: 'chrome' }),
    ...bx(-0.045, 0, h + 0.046, 0.012, 0.016, 0.036, [128, 130, 134], { mat: 'chrome' }),
    ...bx(0.045, 0, h + 0.046, 0.012, 0.016, 0.036, [128, 130, 134], { mat: 'chrome' }),
    ...bx(0, 0, h + 0.062, 0.13, 0.026, 0.018, [40, 36, 34], { mat: 'rubber' }),
    ...bx(w / 2 - 0.03, 0, h * 0.6, 0.03, 0.05, 0.05, [120, 122, 126], { mat: 'chrome' }), // latch
  ];
}

// ============================================================================
// 13. Plastic bucket — tipped, wire handle, something dried in the bottom.
// ============================================================================
function bucket() {
  const f = [
    ...prism(10, 0.115, 0.145, 0, 0.30, [150, 148, 140], 'plastic', { openTop: true }),
    ...prism(10, 0.150, 0.150, 0.29, 0.305, [128, 126, 118], 'plastic'),
    ...slab(0.105, 0.012, [62, 24, 18], 'blood', { a: 0.7, pool: true }),
  ];
  // Wire bail, arced over the top.
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI;
    f.push(...bx(Math.cos(a) * 0.145, 0, 0.30 + Math.sin(a) * 0.10, 0.026, 0.008, 0.026, [110, 112, 116], { mat: 'chrome' }));
  }
  return f;
}

// ============================================================================
// 14. Paint can — open, tipped, with a dried spill running out of it.
// ============================================================================
function paintCan() {
  return [
    ...prism(9, 0.085, 0.085, 0, 0.19, [122, 124, 128], 'metal'),
    ...prism(9, 0.089, 0.089, 0.175, 0.19, [96, 98, 102], 'metal'),
    ...slab(0.078, 0.192, [162, 158, 146], 'paint', { a: 0.95, wobble: 0.05 }),
    ...translate(slab(0.30, 0.006, [148, 146, 138], 'paint', { a: 0.85, phase: 3, wobble: 0.35 }), 0.26, 0.05, 0),
    ...translate(rotY(prism(4, 0.005, 0.005, 0, 0.17, [110, 112, 116], 'chrome'), 1.5708), 0.08, 0, 0.19),
  ];
}

// ============================================================================
// 15. A single child's shoe. One. That is the entire point.
// ============================================================================
function shoe() {
  return [
    ...bx(0, 0, 0.014, 0.19, 0.075, 0.028, [46, 42, 40], { mat: 'rubber' }),
    ...bx(-0.025, 0, 0.055, 0.13, 0.070, 0.055, [128, 62, 66], { mat: 'leather' }),
    ...bx(0.058, 0, 0.038, 0.075, 0.066, 0.030, [136, 68, 72], { mat: 'leather' }),
    ...bx(-0.030, 0, 0.088, 0.055, 0.048, 0.016, [188, 182, 170], { mat: 'fabric' }),  // tongue
    ...bx(-0.010, 0, 0.084, 0.075, 0.008, 0.008, [206, 200, 188], { mat: 'fabric' }),  // lace
  ];
}

// ============================================================================
// 16. Wooden pallet — three bearers, seven deck boards, one snapped.
// ============================================================================
function pallet() {
  const w = 1.20, d = 1.00, t = 0.018;
  const f = [];
  for (const y of [-d / 2 + 0.05, 0, d / 2 - 0.05]) {
    f.push(...bx(0, y, 0.045, w, 0.10, 0.090, DARKWOOD, { mat: 'wood' }));
  }
  for (let i = 0; i < 7; i++) {
    const x = -w / 2 + 0.06 + i * (w - 0.12) / 6;
    const broken = i === 4;
    f.push(...bx(x, broken ? -0.16 : 0, 0.090 + t / 2, 0.095, broken ? d * 0.62 : d, t, WOOD, { mat: 'wood' }));
  }
  return f;
}

// ============================================================================
// 17. Glass bottles — a small cluster, one on its side.
// ============================================================================
function bottles() {
  const glass = [74, 96, 78];
  const one = (h) => [
    ...prism(8, 0.036, 0.036, 0, h * 0.66, glass, 'glass'),
    ...prism(8, 0.036, 0.014, h * 0.66, h * 0.86, glass, 'glass'),
    ...prism(8, 0.014, 0.014, h * 0.86, h, glass, 'glass'),
    ...prism(8, 0.017, 0.017, h - 0.016, h, [128, 118, 84], 'metal'),
  ];
  return [
    ...translate(one(0.28), 0, 0, 0),
    ...translate(one(0.24), 0.085, 0.055, 0),
    ...translate(rotY(one(0.26), 1.5708), -0.06, -0.075, 0.036),
  ];
}

// ============================================================================
// 18. Loose papers — a scattered spill of documents nobody will ever read.
// ============================================================================
function papers() {
  const f = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 1.37;
    const sheet = bx(0, 0, 0.0012, 0.21, 0.297, 0.0018, [176, 170, 152], { mat: 'paper' });
    f.push(...translate(rotZ(sheet, a), Math.cos(a * 2.1) * 0.16, Math.sin(a * 1.7) * 0.15, i * 0.0022));
  }
  // A binder half-buried in the drift.
  f.push(...translate(rotZ(bx(0, 0, 0.014, 0.23, 0.31, 0.028, [72, 60, 54], { mat: 'leather' }), 0.6), -0.10, 0.08, 0));
  return f;
}

// ============================================================================
// 19. Camping lantern — dead, glass cage, the closest thing to hope down here.
// ============================================================================
function lantern() {
  const f = [
    ...prism(8, 0.070, 0.062, 0, 0.055, [58, 74, 62], 'metal'),
    ...prism(8, 0.052, 0.052, 0.055, 0.175, [42, 48, 46], 'glass'),
    ...prism(8, 0.068, 0.030, 0.175, 0.235, [58, 74, 62], 'metal'),
    ...prism(5, 0.012, 0.010, 0.075, 0.150, [96, 88, 62], 'metal'), // dead mantle
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    f.push(...bx(Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0.115, 0.010, 0.010, 0.12, [80, 84, 80], { mat: 'metal' }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI;
    f.push(...bx(Math.cos(a) * 0.062, 0, 0.235 + Math.sin(a) * 0.055, 0.014, 0.007, 0.014, [104, 106, 110], { mat: 'chrome' }));
  }
  return f;
}

// ============================================================================
// 20. Child's tricycle — on its side, one wheel still slowly true.
// ============================================================================
function tricycle() {
  const frame = [138, 48, 42];
  const f = [
    ...translate(rotY(prism(6, 0.022, 0.018, 0, 0.42, frame, 'metal'), 1.15), -0.16, 0, 0.30),
    ...bx(-0.20, 0, 0.34, 0.14, 0.16, 0.045, [46, 42, 44], { mat: 'plastic' }),   // seat
    ...translate(cylY(10, 0.145, 0.045, [40, 38, 38], 'rubber'), 0.20, 0, 0.145), // front wheel
    ...translate(cylY(8, 0.070, 0.050, [150, 148, 140], 'plastic'), 0.20, 0, 0.145),
  ];
  for (const sy of [-0.15, 0.15]) {
    f.push(...translate(cylY(9, 0.095, 0.040, [40, 38, 38], 'rubber'), -0.26, sy, 0.095));
    f.push(...bx(-0.26, sy * 0.6, 0.095, 0.05, 0.14, 0.020, [110, 112, 116], { mat: 'chrome' }));
  }
  // Handlebar with one grip torn off.
  f.push(...translate(rotX(prism(6, 0.014, 0.014, 0, 0.30, [120, 122, 126], 'chrome'), 1.5708), 0.20, -0.15, 0.52));
  f.push(...translate(rotX(prism(6, 0.022, 0.022, 0, 0.075, [40, 38, 40], 'rubber'), 1.5708), 0.20, -0.15, 0.52));
  // Pedal crank on the front wheel.
  f.push(...bx(0.20, -0.075, 0.145, 0.020, 0.09, 0.020, [110, 112, 116], { mat: 'chrome' }));
  return rotY(f, 1.48);
}

// ============================================================================
// 21. Jerry can — dented, spout, the smell you can almost detect.
// ============================================================================
function gasCan() {
  const w = 0.34, d = 0.16, h = 0.44;
  return [
    ...bx(0, 0, h / 2, w, d, h, [64, 82, 60], { mat: 'metal' }),
    ...bx(0, 0, h * 0.5, w * 1.02, d * 0.55, h * 0.86, [56, 72, 52], { mat: 'metal' }),
    ...bx(-w / 2 + 0.05, 0, h + 0.035, 0.09, d * 0.7, 0.028, [48, 62, 46], { mat: 'metal' }),
    ...bx(-w / 2 + 0.05, 0, h + 0.062, 0.10, 0.03, 0.026, [48, 62, 46], { mat: 'metal' }),
    ...translate(rotY(prism(6, 0.028, 0.024, 0, 0.10, [72, 74, 78], 'metal'), 0.6), w / 2 - 0.07, 0, h + 0.01),
  ];
}

// ============================================================================
// 22. Transistor radio — speaker grille, tuning dial, whip antenna.
// ============================================================================
function radio() {
  const w = 0.22, d = 0.07, h = 0.14;
  const f = [
    ...bx(0, 0, h / 2, w, d, h, [122, 106, 76], { mat: 'plastic' }),
    ...bx(-0.04, -d / 2 - 0.003, h * 0.55, 0.11, 0.008, 0.085, [40, 36, 32], { mat: 'metal' }),
  ];
  for (let i = 0; i < 5; i++) {
    f.push(...bx(-0.04, -d / 2 - 0.006, h * 0.55 - 0.034 + i * 0.017, 0.10, 0.004, 0.005, [22, 20, 18], { mat: 'metal' }));
  }
  f.push(...bx(0.062, -d / 2 - 0.004, h * 0.62, 0.052, 0.006, 0.030, [198, 190, 168], { mat: 'plastic' })); // dial face
  f.push(...bx(0.062, -d / 2 - 0.006, h * 0.62, 0.004, 0.005, 0.028, [156, 40, 34], { mat: 'plastic' }));   // needle
  f.push(...translate(rotY(prism(6, 0.014, 0.014, 0, 0.012, [52, 48, 44], 'plastic'), 1.5708), 0.062, 0, h * 0.28));
  f.push(...translate(rotY(prism(4, 0.005, 0.002, 0, 0.42, [130, 132, 136], 'chrome'), 0.35), -w / 2 + 0.02, 0, h));
  return f;
}

// ============================================================================
// 23. Styrofoam cup — someone stood here long enough to finish a drink.
// ============================================================================
function cup() {
  return [
    ...prism(9, 0.032, 0.042, 0, 0.105, [206, 202, 192], 'plastic', { openTop: true }),
    ...prism(9, 0.044, 0.044, 0.100, 0.107, [186, 182, 172], 'plastic'),
    ...slab(0.030, 0.008, [52, 34, 22], 'paint', { a: 0.8, wobble: 0.06 }),
  ];
}

// ============================================================================
// 24. Crushed drink can.
// ============================================================================
function crushedCan() {
  return [
    ...translate(rotY(prism(8, 0.033, 0.028, 0, 0.06, [148, 60, 52], 'metal'), 1.5708), 0, 0, 0.033),
    ...translate(rotY(prism(8, 0.020, 0.030, 0, 0.055, [128, 52, 46], 'metal'), 1.72), 0.055, 0.006, 0.028),
  ];
}

// ============================================================================
// The pistol. Rebuilt from primitives instead of a 40-part parts list, sized to
// a real 195 mm service automatic and posed muzzle-along-+x, up-along-+z, so the
// same mesh serves as the world pickup (rolled onto its side) and the held
// viewmodel.
// ============================================================================
function pistol() {
  const FRAME = [34, 35, 40];
  const SLIDE = [46, 48, 55];
  const DARK = [20, 21, 25];
  const GRIP = [26, 24, 24];

  // --- slide assembly: everything that travels when a round goes off --------
  const slide = [];
  slide.push(...bx(0.012, 0, 0.088, 0.190, 0.030, 0.030, SLIDE, { mat: 'gunmetal' }));
  slide.push(...bx(0.012, 0, 0.104, 0.186, 0.020, 0.006, [58, 60, 68], { mat: 'gunmetal' })); // top rib
  // Cocking serrations — thin proud ribs at the rear and front.
  for (let i = 0; i < 5; i++) {
    slide.push(...bx(0.078 - i * 0.007, 0, 0.088, 0.0035, 0.032, 0.024, DARK, { mat: 'gunmetal' }));
    slide.push(...bx(-0.052 - i * 0.007, 0, 0.088, 0.0035, 0.032, 0.024, DARK, { mat: 'gunmetal' }));
  }
  // Ejection port cut into the right flank.
  slide.push(...bx(0.030, 0.0155, 0.094, 0.048, 0.004, 0.016, [10, 10, 12], { mat: 'gunmetal' }));
  // Barrel + crowned muzzle. The bore is a genuine dark hole, which matters a
  // lot when the thing is 12 cm from the camera.
  slide.push(...translate(rotY(prism(8, 0.0115, 0.0115, 0, 0.030, [62, 64, 72], 'gunmetal'), 1.5708), 0.104, 0, 0.090));
  slide.push(...translate(rotY(prism(8, 0.0060, 0.0060, 0, 0.016, [6, 6, 8], 'gunmetal'), 1.5708), 0.112, 0, 0.090));
  // Sights ride the slide, so they lift with it under recoil.
  slide.push(...bx(-0.070, -0.009, 0.108, 0.010, 0.008, 0.010, [24, 25, 29], { mat: 'gunmetal' }));
  slide.push(...bx(-0.070, 0.009, 0.108, 0.010, 0.008, 0.010, [24, 25, 29], { mat: 'gunmetal' }));
  slide.push(...bx(0.092, 0, 0.108, 0.008, 0.008, 0.010, [24, 25, 29], { mat: 'gunmetal' }));
  slide.push(...translate(rotY(bx(0, 0, 0, 0.012, 0.010, 0.030, [52, 54, 60], { mat: 'gunmetal' }), -0.5), -0.086, 0, 0.106)); // hammer

  // --- frame: grip, trigger group, rail, controls ---------------------------
  const frame = [];
  frame.push(...bx(0.006, 0, 0.066, 0.178, 0.026, 0.024, FRAME, { mat: 'gunmetal' }));
  frame.push(...bx(0.062, 0, 0.052, 0.062, 0.020, 0.010, FRAME, { mat: 'gunmetal' }));
  for (let i = 0; i < 3; i++) frame.push(...bx(0.044 + i * 0.017, 0, 0.047, 0.006, 0.024, 0.006, DARK, { mat: 'gunmetal' }));
  // Trigger guard: front strap, bottom bar, and the trigger inside it.
  frame.push(...bx(0.030, 0, 0.040, 0.010, 0.022, 0.036, FRAME, { mat: 'gunmetal' }));
  frame.push(...bx(0.004, 0, 0.026, 0.062, 0.022, 0.009, FRAME, { mat: 'gunmetal' }));
  frame.push(...bx(0.016, 0, 0.044, 0.007, 0.010, 0.024, DARK, { mat: 'rubber' }));
  // Grip, raked back, with checkered panels and a visible magazine floorplate.
  const grip = [
    ...bx(0, 0, -0.056, 0.038, 0.028, 0.115, GRIP, { mat: 'rubber' }),
    ...bx(0, 0.0145, -0.056, 0.032, 0.004, 0.100, [16, 15, 15], { mat: 'rubber' }),
    ...bx(0, -0.0145, -0.056, 0.032, 0.004, 0.100, [16, 15, 15], { mat: 'rubber' }),
    ...bx(-0.002, 0, -0.118, 0.042, 0.030, 0.012, [40, 42, 48], { mat: 'gunmetal' }),
  ];
  // Raked BACK: the butt sits behind the web of the hand, not out in front of
  // it. rotY swings +z toward +x, and +x is the muzzle — so the sign here has to
  // be positive or the grip leans toward the target and the whole weapon reads
  // as being held backwards.
  frame.push(...translate(rotY(grip, 0.30), -0.014, 0, 0.062));
  frame.push(...bx(-0.082, 0, 0.078, 0.026, 0.024, 0.012, FRAME, { mat: 'gunmetal' })); // beavertail
  frame.push(...bx(-0.050, -0.016, 0.072, 0.030, 0.005, 0.008, [66, 68, 74], { mat: 'gunmetal' }));
  frame.push(...bx(-0.058, 0.016, 0.076, 0.022, 0.005, 0.007, [66, 68, 74], { mat: 'gunmetal' }));
  return { frame, slide };
}

// A spent brass case — ejected on every shot and left on the floor.
function shellCase() {
  return [
    ...prism(7, 0.0048, 0.0048, 0, 0.019, [148, 116, 52], 'chrome'),
    ...prism(7, 0.0052, 0.0052, 0, 0.0022, [122, 94, 44], 'chrome'),
  ];
}

// A bullet hole: authored in the y/z plane so an instance yaw aims it out of the
// wall face it was shot into. Drawn as a decal (blended, no depth write).
function bulletHole() {
  const f = [];
  const ring = (rad, col, a) => {
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = rad * (0.78 + 0.22 * Math.sin(t * 3 + 1.1));
      pts.push([0, Math.cos(t) * r, Math.sin(t) * r]);
    }
    for (let i = 0; i < n; i++) {
      f.push(face([[0, 0, 0], pts[i], pts[(i + 1) % n]], col, 'concrete',
        { uv: [[0.5, 0.5], [1, 0], [1, 1]], a, pool: true }));
    }
  };
  ring(0.055, [58, 52, 44], 0.55);   // dust halo / spalling
  ring(0.022, [10, 9, 8], 0.98);     // the hole itself
  return f;
}

// A flat blood pool on the floor. Alpha-blended with per-pixel noise so its
// edge breaks up instead of ending in a hard polygon.
function bloodPool(rad) {
  // Darker than it looks on paper: the torch multiplies this by well over 1 at
  // the range you actually stand at, and the brighter red read as a flat mat
  // rather than as something soaking into carpet.
  return slab(rad, 0.006, [60, 10, 9], 'blood', { n: 16, a: 0.68, pool: true, wobble: 0.3 });
}

// One working ceiling panel, used only above the empty place in a terminal
// crowd formation. The ordinary ceiling texture already has dead fixtures in
// it; this is a small solid hung just below that plane so its position can be
// authored by the anomaly instead of landing on the texture's repeating grid.
function crowdCeilingLight() {
  return [
    ...box(-0.34, -0.18, -0.038, 0.34, 0.18, 0,
      [38, 38, 34], { mat: 'metal' }),
    face([
      [-0.285, -0.125, -0.040],
      [0.285, -0.125, -0.040],
      [0.285, 0.125, -0.040],
      [-0.285, 0.125, -0.040],
    ], [204, 196, 166], 'glass', { emit: [190, 174, 126] }),
  ];
}

// ---------------------------------------------------------------------------

// key -> [builder, opts]. `props` lists the ones the world scatterer may use.
const CATALOGUE = {
  cardboardBox, cardboardOpen, crate, drum, cone, suitcase, doll, teddy, chair,
  crtTv, mattress, toolbox, bucket, paintCan, shoe, pallet, bottles, papers,
  lantern, tricycle, gasCan, radio, cup, crushedCan,
};

// Every scatterable prop, with the collision radius the player bumps into (in
// world units) and how eye-catching it is. Flat junk has no collision at all —
// you walk over papers, you do not walk over a steel drum.
export const PROP_TYPES = [
  { key: 'cardboardBox', collide: 0.075, weight: 10 },
  { key: 'cardboardOpen', collide: 0.070, weight: 8 },
  { key: 'crate', collide: 0.085, weight: 7 },
  { key: 'drum', collide: 0.105, weight: 5 },
  { key: 'cone', collide: 0.055, weight: 6 },
  { key: 'suitcase', collide: 0.110, weight: 5 },
  { key: 'doll', collide: 0.045, weight: 4 },
  { key: 'teddy', collide: 0, weight: 4 },
  { key: 'chair', collide: 0.110, weight: 5 },
  { key: 'crtTv', collide: 0.090, weight: 4 },
  { key: 'mattress', collide: 0.180, weight: 3 },
  { key: 'toolbox', collide: 0.080, weight: 5 },
  { key: 'bucket', collide: 0.055, weight: 6 },
  { key: 'paintCan', collide: 0.035, weight: 5 },
  { key: 'shoe', collide: 0, weight: 6 },
  { key: 'pallet', collide: 0.140, weight: 4 },
  { key: 'bottles', collide: 0.040, weight: 5 },
  { key: 'papers', collide: 0, weight: 7 },
  { key: 'lantern', collide: 0.030, weight: 4 },
  { key: 'tricycle', collide: 0.100, weight: 3 },
  { key: 'gasCan', collide: 0.065, weight: 4 },
  { key: 'radio', collide: 0.035, weight: 5 },
  { key: 'cup', collide: 0, weight: 7 },
  { key: 'crushedCan', collide: 0, weight: 7 },
];

// Built once at boot; the renderer looks meshes up by key.
export function buildMeshes() {
  const out = {};
  for (const key in CATALOGUE) out[key] = toWorld(CATALOGUE[key]());

  const { frame, slide } = pistol();
  out.gunFrame = toWorld(frame);                   // held viewmodel, static part
  out.gunSlide = toWorld(slide);                   // held viewmodel, cycles
  out.gun = out.gunFrame.concat(out.gunSlide);     // whole weapon, upright
  // The world pickup lies on its right side on the carpet.
  out.gunPickup = translate(rotX(out.gun, Math.PI / 2), 0, 0, 0.017 * METER);
  out.shell = toWorld(shellCase());
  out.bulletHole = toWorld(bulletHole());
  out.bloodPool = bloodPool(0.55);
  out.bloodSmall = bloodPool(0.26);
  out.crowdCeilingLight = toWorld(crowdCeilingLight());
  return out;
}
