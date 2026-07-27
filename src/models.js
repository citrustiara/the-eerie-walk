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

// ============================================================================
// THE ROOMS THAT WERE BUILT ON PURPOSE
//
// Five objects that exist for one landmark each and are never rolled from the
// scatter bag — see LANDMARK_KITS in objects.js. The generated districts get
// cardboard and traffic cones because a district is somewhere nothing was ever
// decided; a room that was drawn by hand gets the one object that says what the
// room was FOR. That is the whole difference between walking through a shape
// and recognising a place.
// ============================================================================

// Sit a mesh on the floor. Rotating something tall about its own base swings the
// far end of it under the carpet; this puts the lowest vertex back at z = 0
// whatever the rotations did, so the object rests on the floor instead of
// through it.
function rest(faces) {
  let minZ = Infinity;
  for (const f of faces) for (const v of f.v) if (v[2] < minZ) minZ = v[2];
  return minZ ? translate(faces, 0, 0, -minZ) : faces;
}

// 25. Wooden cross — the chapel. Fallen off the plinth and lying at an angle,
//     because a cross standing upright is a set, and a cross on the floor with
//     the fixing torn out of the back of it is an event.
function cross() {
  const t = 0.075;
  const f = [
    ...bx(0, 0, 0.86, t, t * 0.62, 1.72, WOOD, { mat: 'wood' }),          // upright
    ...bx(0, 0, 1.20, 0.86, t * 0.60, t, DARKWOOD, { mat: 'wood' }),      // crossbar
    // The lap joint, proud of both members.
    ...bx(0, -t * 0.34, 1.20, t * 1.25, t * 0.30, t * 1.25, [92, 68, 40], { mat: 'wood' }),
  ];
  // Two bolts where it was fixed to something, and the plate they tore out of.
  for (const z of [0.14, 0.30]) {
    f.push(...translate(rotX(prism(6, 0.014, 0.012, 0, 0.02, [92, 96, 100], 'metal'), -1.5708),
      0, -t * 0.38, z));
  }
  f.push(...bx(0, -t * 0.36, 0.22, t * 1.6, 0.008, 0.30, [70, 58, 48], { mat: 'metal' }));
  // Down, and turned a little as it went. The quarter turn is not decoration:
  // the chapel aims its props inward at the plinth, and without it the cross
  // lies pointing straight down the nave — end-on to anyone walking up it, which
  // is the one angle from which a cross does not read as a cross.
  return rest(rotZ(rotY(f, 1.31), Math.PI / 2 + 0.4));
}

// 26. Spent candles — the chapel. Nothing in this building has a flame in it,
//     which is the point: somebody kept these going for a while and then did
//     not. Stubs, one still standing, and a spread of wax across the carpet.
function candles() {
  const WAX = [186, 176, 148];
  // Spread over half a metre and eight of them, not three over twenty
  // centimetres. A candle is 4 cm across and the screen is 480 px wide: one
  // stub is two pixels at any distance you would actually be standing, so what
  // has to read is the GROUP — a patch of pale things on dark carpet, the size
  // of somewhere a person knelt.
  const f = [
    // The wax that ran off them and set. Flat, so you walk over it.
    ...slab(0.30, 0.004, [142, 132, 108], 'plastic', { n: 14, a: 0.9, wobble: 0.34 }),
    ...translate(slab(0.16, 0.005, [156, 146, 120], 'plastic', { n: 11, a: 0.85, wobble: 0.4 }), 0.17, -0.12, 0),
  ];
  const stub = (x, y, h, lean) => {
    const c = [
      ...prism(8, 0.023, 0.021, 0, h, WAX, 'plastic'),
      ...prism(4, 0.0024, 0.0018, h, h + 0.014, [26, 22, 20], 'cloth'),   // dead wick
      ...prism(8, 0.029, 0.023, h - 0.014, h, [168, 158, 132], 'plastic'), // run-off collar
    ];
    f.push(...translate(rotY(c, lean), x, y, 0));
  };
  stub(0.00, 0.04, 0.185, 0.04);     // the one that is still up
  stub(-0.13, -0.07, 0.115, 0.10);
  stub(0.12, -0.10, 0.070, -0.07);
  stub(-0.05, 0.19, 0.145, -0.05);
  stub(0.20, 0.08, 0.055, 0.12);
  // Three knocked flat, lying in their own wax.
  f.push(...translate(rotY(prism(8, 0.022, 0.018, 0, 0.16, WAX, 'plastic'), 1.5708), 0.03, 0.17, 0.022));
  f.push(...translate(rotZ(rotY(prism(8, 0.022, 0.017, 0, 0.12, [172, 162, 136], 'plastic'), 1.5708), 1.1),
    -0.19, 0.07, 0.022));
  f.push(...translate(rotZ(rotY(prism(8, 0.021, 0.016, 0, 0.10, [178, 168, 140], 'plastic'), 1.5708), 2.4),
    0.14, -0.20, 0.021));
  return rest(f);
}

// 27. Pew — the chapel. Authored along +x so a row of them can be laid down the
//     nave facing the plinth; see the focal yaw in objects.js.
function pew() {
  const len = 1.55, seatH = 0.44, t = 0.045;
  const f = [
    ...bx(0, 0, seatH, len, 0.34, t, DARKWOOD, { mat: 'wood' }),                  // seat
    ...bx(0, -0.16, seatH + 0.28, len, 0.035, 0.42, WOOD, { mat: 'wood' }),       // back
    ...bx(0, -0.14, seatH + 0.50, len, 0.06, 0.045, DARKWOOD, { mat: 'wood' }),   // top rail
  ];
  for (const sx of [-1, 1]) {
    // Slab ends, front and back, with the gap between them you can see through.
    f.push(...bx(sx * (len / 2 - 0.05), 0.10, seatH / 2, 0.05, 0.11, seatH, WOOD, { mat: 'wood' }));
    f.push(...bx(sx * (len / 2 - 0.05), -0.15, seatH / 2, 0.05, 0.11, seatH, WOOD, { mat: 'wood' }));
  }
  return f;
}

// 28. Bed frame — the ward. Stripped: no mattress, just the deck and the two
//     ends, on castors, one of which has gone. Authored along +x.
function bedFrame() {
  const len = 1.94, wid = 0.86, deck = 0.58;
  const f = [
    ...bx(0, 0, deck, len - 0.08, wid - 0.10, 0.035, [72, 76, 80], { mat: 'metal' }),
    ...bx(0, 0, deck + 0.020, len - 0.16, wid - 0.22, 0.008, [50, 52, 54], { mat: 'metal' }),
  ];
  // Head and foot rails: uprights with three bars across, the head one taller.
  for (const [sx, h] of [[-1, 0.46], [1, 0.28]]) {
    const x = sx * (len / 2 - 0.03);
    for (const sy of [-1, 1]) {
      f.push(...bx(x, sy * (wid / 2 - 0.06), deck + h / 2, 0.030, 0.030, h, PORCELAIN, { mat: 'chrome' }));
    }
    for (let i = 0; i < 3; i++) {
      f.push(...bx(x, 0, deck + 0.09 + i * (h - 0.12) / 2, 0.022, wid - 0.12, 0.022,
        [178, 172, 160], { mat: 'chrome' }));
    }
  }
  // Legs and castors. The fourth castor is missing and that corner sits down on
  // the leg itself — which is the whole reason the bed is at an angle.
  const wheelR = 0.048;
  for (const [sx, sy, wheel] of [[-1, -1, true], [-1, 1, true], [1, -1, true], [1, 1, false]]) {
    const x = sx * (len / 2 - 0.16), y = sy * (wid / 2 - 0.10);
    // The leg has to START at the top of its castor, not above it: half of them
    // were hanging 1.6 cm clear of the wheel they are supposed to be sitting on.
    const foot = wheel ? wheelR * 2 : 0;
    f.push(...bx(x, y, (foot + deck) / 2, 0.036, 0.036, deck - foot, STEEL, { mat: 'metal' }));
    if (wheel) f.push(...translate(cylY(8, wheelR, 0.030, [38, 36, 36], 'rubber'), x, y, wheelR));
  }
  return f;
}

// 29. Broken safety rail — the shaft. A two-post section of the barrier that
//     used to run round the hole, with the middle of it torn away and the ends
//     bent out over the drop. Authored along +x, to be laid along a rim.
function railing() {
  const h = 1.06, span = 1.70;
  const f = [];
  for (const sx of [-1, 1]) {
    const x = sx * span / 2;
    f.push(...bx(x, 0, h / 2, 0.055, 0.055, h, [96, 88, 74], { mat: 'metal' }));
    // The flange it was bolted down through, one corner lifted.
    f.push(...bx(x, 0, 0.008, 0.15, 0.15, 0.016, RUST, { mat: 'metal' }));
  }
  // Top and mid rails, each running INWARD from its post and snapped short of
  // the middle, bent down over the drop. The sign matters: at +sx the segments
  // pointed away from the gap and out past their own posts, so the barrier read
  // as two bare poles with nothing between them and the torn-out middle — the
  // whole point of it — was not there.
  for (const [z, len] of [[h - 0.04, 0.58], [h * 0.52, 0.48]]) {
    for (const sx of [-1, 1]) {
      const seg = prism(6, 0.028, 0.024, 0, len, [104, 96, 80], 'metal');
      f.push(...translate(rotY(seg, -sx * (1.5708 + 0.30)), sx * span / 2, 0, z));
    }
  }
  // A torn strip of hazard tape still knotted to one post.
  f.push(...translate(rotY(rotZ(bx(0, 0, 0, 0.34, 0.002, 0.055, [150, 128, 44], { mat: 'plastic' }), 0.5), 0.7),
    -span / 2 + 0.16, 0.02, h - 0.20));
  return f;
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

// The way out. The only object in the game besides the pistol that the building
// puts down on purpose, and the pair of them are the whole choice: one of them
// summons the thing that ends you and the other one does this.
//
// It is authored standing in the plane y=0 with its opening facing -y, and the
// director places it flush against a wall face with the yaw that turns -y into
// the wall — so it reads as a door IN something rather than a prop standing in
// a corridor. There is no hole cut in the geometry behind it and there does not
// need to be: what is through it is not somewhere the raycaster can see.
//
// Everything about it is ordinary. It is a fire door in a building full of
// them, and the only thing wrong with it is that there is light on the other
// side, which there has not been anywhere else in nine minutes of walking.
function doorway() {
  const W2 = 1.02, HH = 2.06, JAMB = 0.085, PROUD = 0.05;
  const PAINT = [104, 96, 82];        // institutional grey-green, filthy
  const DARK = [46, 42, 36];
  // The pre-dawn coming through the gap. Cold, not warm — this is not a fire
  // exit sign and it is not sunrise, it is four in the morning.
  const GLOW = [150, 168, 196];
  const f = [];

  // Architrave: two jambs and a head, standing proud of the wall.
  for (const s of [-1, 1]) {
    f.push(...bx(s * (W2 / 2 + JAMB / 2), 0, HH / 2, JAMB, PROUD, HH + JAMB, PAINT, { mat: 'wood' }));
  }
  f.push(...bx(0, 0, HH + JAMB / 2, W2 + JAMB * 2, PROUD, JAMB, PAINT, { mat: 'wood' }));

  // What is behind it. A dark plane set back into the opening, so that the
  // light along the edges has something to be light against.
  f.push(face([
    [-W2 / 2, 0.10, 0.002], [W2 / 2, 0.10, 0.002],
    [W2 / 2, 0.10, HH], [-W2 / 2, 0.10, HH],
  ], [18, 20, 24], 'wood'));

  // THE GAP. A tall sliver down the closing edge and a strip under the bottom
  // rail: the two places light gets out of a shut room. Both go in before the
  // panel so the panel can occlude whatever it is actually in front of.
  const SLIVER = 0.075;
  f.push(face([
    [W2 / 2 - SLIVER, 0.048, 0.012], [W2 / 2, 0.048, 0.012],
    [W2 / 2, 0.048, HH - 0.04], [W2 / 2 - SLIVER, 0.048, HH - 0.04],
  ], GLOW, 'glass', { emit: GLOW }));
  // Over the threshold plate rather than inside it. Sitting at z=0.006 put it
  // within the plate's own 16 mm box, which occluded it completely.
  f.push(face([
    [-W2 / 2 + 0.03, -0.05, 0.012], [W2 / 2 - 0.03, -0.05, 0.012],
    [W2 / 2 - 0.03, 0.048, 0.012], [-W2 / 2 + 0.03, 0.048, 0.012],
  ], GLOW, 'glass', { emit: GLOW }));

  // The door itself, ajar by about six degrees on the left hinge. Hung on the
  // real hinge line rather than spun about its centre, because a door pivoting
  // around the middle of itself is the tell that it is a prop — and only just
  // ajar, because a door standing half open is a doorway, and a doorway does
  // not have a line of light down the side of it.
  const panel = [
    ...bx(W2 / 2 - 0.02, 0, HH / 2, W2 - 0.05, 0.045, HH - 0.03, PAINT, { mat: 'wood' }),
    // Kick plate and a push bar: the furniture that makes it a fire door. Both
    // darker than the leaf, not lighter — pale bars on a dark panel came out
    // reading as glazing, and the last thing this wants to be is a window.
    ...bx(W2 / 2 - 0.02, -0.026, 0.20, W2 - 0.18, 0.006, 0.32, [72, 68, 60], { mat: 'metal' }),
    ...bx(W2 / 2 - 0.02, -0.030, 1.03, W2 - 0.22, 0.034, 0.055, [80, 76, 68], { mat: 'metal' }),
  ];
  f.push(...translate(rotZ(panel, -0.11), -W2 / 2, 0, 0));

  // WHAT ACTUALLY SELLS IT: light on the floor. A four-pixel sliver at the far
  // end of a corridor is a sliver; a patch of pale on the carpet in a building
  // where the only light in nine minutes has been the one in your hand is the
  // thing you turn round for. Three flat steps rather than a gradient, because
  // the mesh shader has no per-vertex emissive and three quads cost nothing.
  // They are BANDS, not stacked quads: three coplanar rectangles one inside the
  // other would z-fight, since a floor plane's depth barely changes with the
  // millimetre of height that would separate them.
  const spill = (near, far, w0, w1, k) => face([
    [-w0, -near, 0.003], [w0, -near, 0.003],
    [w1, -far, 0.003], [-w1, -far, 0.003],
  ], [GLOW[0] * k, GLOW[1] * k, GLOW[2] * k], 'glass',
     { emit: [GLOW[0] * k, GLOW[1] * k, GLOW[2] * k] });
  // These are much hotter than they look like they should be. The torch is
  // pointed at this floor while you are looking at the door, and a wash worth
  // thirty levels on top of a lit carpet is invisible — the spill has to beat
  // the thing that is competing with it, not be physically plausible next to it.
  // Thrown a good deal further than a real door would manage, for the same
  // reason it is brighter: at this resolution, from the far end of the corridor
  // where you first see it, a metre of floor is four pixels.
  f.push(spill(0.05, 0.55, W2 / 2 - 0.08, W2 / 2 + 0.06, 0.80));
  f.push(spill(0.55, 1.40, W2 / 2 + 0.06, W2 / 2 + 0.22, 0.46));
  f.push(spill(1.40, 2.60, W2 / 2 + 0.22, W2 / 2 + 0.40, 0.20));

  // The threshold, worn to the metal. Something has been over this a lot.
  f.push(...bx(0, -0.005, 0.005, W2 + 0.04, 0.07, 0.010, [88, 86, 80], { mat: 'metal' }));
  // And the sill of the frame, so the bottom of the jambs are not floating.
  f.push(...bx(0, 0.06, 0.004, W2 + JAMB * 2, 0.05, 0.008, DARK, { mat: 'wood' }));
  return f;
}

// ============================================================================
// THE FIELD
//
// Six things that only exist in ending vi, and one rule that decides all of
// them: NOTHING OUT HERE WAS PUT HERE. Every object in the building is a thing
// a person left — a cup, a trike, a mattress — and if one of them turned up on
// the grass the ending would become a continuation of the building. So the
// field gets things that grew, things that fell over, and one fence, which is
// the only evidence in the whole ending that anybody ever owned this ground and
// is worth having for exactly that.
//
// They are also the only objects in the game that are TALLER THAN THE CEILING.
// Nine minutes of three-metre rooms and then a six-metre tree is most of what
// sells the change, and it is the reason these are modelled at all rather than
// painted into the sky with the treeline: a painted thing cannot parallax, and
// parallax against a painted horizon is precisely how the eye works out that
// the horizon is half a mile away.
//
// FACE BUDGET IS THE DESIGN CONSTRAINT. Fifty of these are in shot at once,
// against six or seven props indoors, and the rasteriser is the same one. Every
// model here is built to a count — a bare tree is thirty-odd faces and gets a
// separate seventeen-face version for the far half of the field. Trees do not
// get leaves for the same reason; they also read better without them, because
// the whole sky is doing the work behind them.
// ============================================================================

const BARK = [64, 57, 48];
const BARKLIT = [82, 74, 62];
const REED = [116, 108, 74];
const STONE = [92, 93, 96];

// One tapered limb, grown from the origin along +z, then tilted away from
// vertical and swung round. It ends in a point, which is what a branch that has
// been dead for years actually ends in — and, less romantically, is two faces
// cheaper than ending in a disc, times six branches, times fifty trees.
//
// Both caps are dropped: the far end is a point and the near end is buried in
// whatever the limb grew out of.
function limb(n, len, r0, tilt, yaw, col, mat = 'bark') {
  return rotZ(rotY(prism(n, r0, 0, 0, len, col, mat, { openBottom: true }), tilt), yaw);
}

// 31. A bare tree. Two trunk sections with a kink between them (a straight
//     trunk is a telegraph pole), four boughs off the top of it and two off the
//     side, each with a little lean of its own.
function tree() {
  const f = [];
  const h1 = 2.35, h2 = 2.10;
  f.push(...prism(5, 0.21, 0.155, 0, h1, BARK, 'bark',
    { openTop: true, openBottom: true }));
  // The kink. Everything above it is built at the top of the first section and
  // leaned, so the tree has a direction it has been growing away from.
  const upper = translate(rotY(
    prism(5, 0.150, 0.075, 0, h2, BARKLIT, 'bark', { openTop: true, openBottom: true }), 0.16),
    0, 0, h1 - 0.02);
  f.push(...upper);

  // Where the crown starts, allowing for the lean of the upper section.
  const cx = Math.sin(0.16) * h2, cz = h1 + Math.cos(0.16) * h2 - 0.35;
  const boughs = [
    [1.55, 0.072, 0.62, 0.4],
    [1.30, 0.064, 0.86, 2.1],
    [1.70, 0.078, 0.50, 3.6],
    [1.15, 0.058, 0.95, 5.0],
  ];
  for (const [len, r, tilt, yaw] of boughs) {
    f.push(...translate(limb(4, len, r, tilt, yaw, BARKLIT), cx, 0, cz));
  }
  // Two lower boughs, well down the trunk, because a crown that starts at five
  // metres and nothing below it is a lamppost with twigs on.
  f.push(...translate(limb(4, 1.25, 0.062, 1.18, 1.2, BARK), 0, 0, h1 * 0.62));
  f.push(...translate(limb(4, 0.95, 0.052, 1.32, 4.3, BARK), 0, 0, h1 * 0.46));
  return f;
}

// 32. The same tree from far enough away that it is a silhouette and a trunk.
//     Swapped in past FIELD.nearLOD — see objects.js. At twenty-one cells the
//     near model's boughs are under two pixels wide, so this is not a
//     compromise, it is the same picture for a third of the cost.
//
//     IT IS ALSO FATTER, WHICH LOOKS WRONG WRITTEN DOWN AND IS NOT. A distant
//     trunk drawn at its true width is a one-pixel vertical line, and a
//     one-pixel vertical dark line against a pale sky is the exact input the
//     chromatic split in the post chain does its worst work on: the first
//     version of the field came out with a row of green and magenta sticks
//     along the horizon. Half a metre of extra girth costs nothing at a hundred
//     metres, where the eye is reading a silhouette and not a measurement, and
//     it puts two pixels of honest bark between the two fringes.
function treeFar() {
  const f = [...prism(4, 0.31, 0.17, 0, 4.30, BARK, 'bark',
    { openTop: true, openBottom: true })];
  f.push(...translate(limb(3, 1.60, 0.125, 0.66, 0.5, BARKLIT), 0, 0, 3.55));
  f.push(...translate(limb(3, 1.35, 0.115, 0.92, 2.6, BARKLIT), 0, 0, 3.30));
  f.push(...translate(limb(3, 1.20, 0.100, 1.10, 4.4, BARK), 0, 0, 2.80));
  return f;
}

// 33. A snapped trunk. What is left when one of the above came down, and the
//     only thing out here at the height of the furniture indoors — which is
//     what makes it useful: it gives the field a scale you already know.
function stump() {
  const f = [...prism(6, 0.30, 0.24, 0, 1.05, BARK, 'bark',
    { openTop: true, openBottom: true })];
  // Splinters standing up out of the break, at three heights.
  for (let i = 0; i < 3; i++) {
    const a = i * 1.63 + 0.4;
    f.push(...translate(rotY(bx(0, 0, 0.14, 0.045, 0.05, 0.28, BARKLIT, { mat: 'bark' }), 0.18),
      Math.cos(a) * 0.13, Math.sin(a) * 0.13, 1.02));
  }
  return f;
}

// 34. Rushes. Only ever placed in the two inches of water at the edge of the
//     flood (see FIELD.reedDepth), which is why they are worth their faces:
//     they are not decoration, they are how you read where the shore is from
//     forty metres away, before the water is bright enough to see.
function reeds() {
  const f = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    const r = 0.10 + (i % 3) * 0.07;
    const len = 0.95 + ((i * 7) % 5) * 0.16;
    f.push(...translate(limb(3, len, 0.020, 0.10 + (i % 4) * 0.09, a, REED, 'bark'),
      Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return f;
}

// 35. A clump of dead grass. The cheap one — scattered on the dry rises purely
//     so the ground between the big things is not empty.
function tussock() {
  const f = [];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + 1.1;
    f.push(...translate(limb(3, 0.34 + (i % 3) * 0.07, 0.030, 0.44, a, REED, 'bark'),
      Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0));
  }
  return f;
}

// 36. A boulder, or as near as eight faces gets. Sunk into the ground rather
//     than resting on it — the bottom is below zero and gets clipped by the
//     floor, which is both cheaper and more convincing than modelling the
//     ground closing over it.
function boulder() {
  return translate(prism(6, 0.46, 0.30, 0, 0.52, STONE, 'stone'), 0, 0, -0.14);
}

// 37. A fence post with two strands running off it. The only straight line in
//     the ending, and the only thing in it that was made.
//
//     The lean is baked in rather than per-instance, because an instance only
//     carries a yaw about z — and the strands must stay LEVEL while the post
//     leans, or a line of them saws up and down instead of running true.
function fencePost() {
  const f = [...translate(rotY(bx(0, 0, 0.62, 0.085, 0.085, 1.24, [78, 66, 50],
    { mat: 'wood' }), 0.075), 0, 0, 0)];
  // Both strands run in local +x to the next post, 4.8 m away — the spacing the
  // scatterer places them at. See FIELD.fenceEvery; the two numbers are one
  // number and changing either alone leaves the wire hanging in the air.
  for (const z of [0.94, 0.62]) {
    f.push(...bx(2.40, 0, z, 4.80, 0.014, 0.014, [96, 90, 80], { mat: 'metal' }));
  }
  return f;
}

// 38. ...and one that has come down, with nothing on it. Every third or fourth
//     one, so the line has gaps in it and reads as abandoned rather than as
//     maintained.
function fencePostBroken() {
  return translate(rotY(bx(0, 0, 0.34, 0.080, 0.080, 0.68, [70, 60, 46],
    { mat: 'wood' }), 0.30), 0, 0, 0);
}

// ---------------------------------------------------------------------------

// key -> [builder, opts]. `props` lists the ones the world scatterer may use.
const CATALOGUE = {
  cardboardBox, cardboardOpen, crate, drum, cone, suitcase, doll, teddy, chair,
  crtTv, mattress, toolbox, bucket, paintCan, shoe, pallet, bottles, papers,
  lantern, tricycle, gasCan, radio, cup, crushedCan,
  // The landmark-only five. Reachable through LANDMARK_KITS and nothing else.
  cross, candles, pew, bedFrame, railing,
  // The field. Not in PROP_TYPES at all — the weighted bag is the building's,
  // and the outside is placed by its own scatterer against the height field
  // rather than rolled. A tree cannot turn up in a corridor because there is no
  // code path that could put it there.
  tree, treeFar, stump, reeds, tussock, boulder, fencePost, fencePostBroken,
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
  // WEIGHT ZERO IS LOAD-BEARING. These five belong to one room each, and the
  // moment one of them can turn up in a random corridor it stops meaning that
  // room. The weighted picker can never reach a zero, so the only way to get
  // one is to be standing in the landmark that owns it.
  { key: 'cross', collide: 0.120, weight: 0 },
  { key: 'candles', collide: 0, weight: 0 },
  { key: 'pew', collide: 0.200, weight: 0 },
  { key: 'bedFrame', collide: 0.240, weight: 0 },
  { key: 'railing', collide: 0.150, weight: 0 },
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
  out.doorway = toWorld(doorway());
  return out;
}
