// creature.js — The Thing In The Corridor.
//
// It used to be a billboard: a 64x128 alpha mask that pivoted to face you, which
// meant it read as a cardboard cut-out the moment you strafed. Now it is a real
// articulated solid, rebuilt from primitives every frame from a pose, so it has
// genuine parallax, its limbs occlude each other, and the flashlight resolves it
// out of the dark one body part at a time.
//
// The anatomy is deliberately wrong rather than monstrous:
//   * 2.4 m tall in a 3 m corridor, so it has to stoop
//   * backward-bending knees, taking long slow strides
//   * arms with an extra length of forearm, hanging past the knees
//   * a small head on a long neck, tilted the way a bird looks at something
//   * no face at all until you are close, then two dim eyes and a jaw that
//     opens far past where a jaw should stop
//
// Authored in metres like everything else and converted at the end.

import { prism, bx, xformIn, METER } from './mesh.js';
import { clamp } from './mathutils.js';

// In-place transforms. Everything below builds fresh geometry every frame, so
// nothing is shared and mutating is safe — see xformIn's note in mesh.js.
const tr = (f, dx, dy, dz) => xformIn(f, (v) => { v[0] += dx; v[1] += dy; v[2] += dz; });
const ry = (f, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return xformIn(f, (v) => { const x = v[0], z = v[2]; v[0] = x * c + z * s; v[2] = -x * s + z * c; });
};
const rz = (f, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return xformIn(f, (v) => { const x = v[0], y = v[1]; v[0] = x * c - y * s; v[1] = x * s + y * c; });
};

// Dead-skin greys. These are much lighter than they look on paper: ambient is
// 0.055, so at rest the creature is genuinely almost black, and it only
// resolves into a body when the torch lands on it. Any darker and it stayed a
// smudge at the distances it actually stalks you from.
const FLESH = [72, 66, 63];
const FLESH_DARK = [46, 42, 42];
const FLESH_PALE = [92, 85, 81];

// A tapered limb bone running from point a to point b. The prism is built along
// +z and then swung onto the bone axis with a single fused rotate-and-translate
// rather than three chained passes.
function segment(a, b, r0, r1, col, n = 6, mat = 'flesh') {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const yaw = Math.atan2(dy, dx);
  const pitch = Math.acos(clamp(dz / len, -1, 1));
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ax = a[0], ay = a[1], az = a[2];
  return xformIn(prism(n, r0, r1, 0, len, col, mat), (v) => {
    const x = v[0], y = v[1], z = v[2];
    const h = x * cp + z * sp;               // component in the bone's plane
    v[0] = h * cy - y * sy + ax;
    v[1] = h * sy + y * cy + ay;
    v[2] = -x * sp + z * cp + az;
  });
}

// Move along the line a->b by t, used to hang details off a bone.
function along(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// A leg. Knee bends *backwards* (digitigrade) which is the single cheapest way
// to make a humanoid silhouette feel wrong at a glance.
function leg(hip, swing, lift, side, k = 1, col = FLESH, dark = FLESH_DARK) {
  const thigh = 0.60 * k, shin = 0.66 * k, foot = 0.30 * k;
  // The knee's coupling to swing is what decides the creature's ride height,
  // because the body is grounded on its lowest vertex: any change in the
  // planted leg's effective length is vertical travel of the whole creature.
  // The original +0.30 made the leg *shorter* on the backswing and longer on
  // the forward swing, so it rose and fell nine centimetres a step and the head
  // travelled twenty. Negative coupling straightens the trailing leg as it
  // extends behind — which is both what a digitigrade leg does at toe-off and
  // what keeps the hips level. Measured travel: 2.7 cm at a full stride.
  const kneeAng = -0.55 - lift * 0.40 - swing * 0.55;
  const hipAng = swing * 0.72 - 0.05;

  const knee = [
    hip[0] + Math.sin(hipAng) * thigh,
    hip[1],
    hip[2] - Math.cos(hipAng) * thigh,
  ];
  const ankle = [
    knee[0] + Math.sin(hipAng + kneeAng) * shin,
    knee[1],
    knee[2] - Math.cos(hipAng + kneeAng) * shin,
  ];
  const toe = [ankle[0] + foot * (0.85 + swing * 0.2), ankle[1] + side * 0.02 * k, Math.max(0.012, ankle[2] - 0.04 * k)];

  return [
    ...segment(hip, knee, 0.115 * k, 0.072 * k, col),
    ...segment(knee, ankle, 0.070 * k, 0.046 * k, dark),
    ...segment(ankle, toe, 0.048 * k, 0.020 * k, dark, 5),
    // A splayed second toe — feet you would not want to hear on carpet.
    ...segment(ankle, [toe[0] - 0.04 * k, toe[1] - side * 0.08 * k, toe[2]], 0.028 * k, 0.012 * k, dark, 4),
  ];
}

// An arm. Two forearm-length bones instead of one, so the hand ends up below the
// knee no matter how it swings.
function arm(shoulder, swing, reach, side, detail) {
  const upper = 0.62, fore = 0.72;
  // reach 0 = hanging dead straight down; reach 1 = both arms thrown forward,
  // level with the shoulder. Anything past ~1.5 rad here and it starts waving
  // its arms over its head, which is comic rather than frightening.
  const shoulderAng = swing * 0.5 + reach * 1.38;
  const elbowAng = 0.24 - reach * 0.50 - swing * 0.25;

  const elbow = [
    shoulder[0] + Math.sin(shoulderAng) * upper,
    shoulder[1] + side * 0.02 * (1 - reach),
    shoulder[2] - Math.cos(shoulderAng) * upper,
  ];
  const wrist = [
    elbow[0] + Math.sin(shoulderAng + elbowAng) * fore,
    elbow[1] + side * 0.03,
    elbow[2] - Math.cos(shoulderAng + elbowAng) * fore,
  ];
  const palm = along(elbow, wrist, 1.16);

  const f = [
    ...segment(shoulder, elbow, 0.082, 0.052, FLESH),
    ...segment(elbow, wrist, 0.052, 0.034, FLESH_DARK),
    ...segment(wrist, palm, 0.040, 0.034, FLESH_DARK, 5),
  ];
  // Three long fingers per hand, fanned. Beyond a few metres they are two
  // pixels wide, so the far LOD collapses them into one.
  const fingers = detail ? 3 : 1;
  for (let i = 0; i < fingers; i++) {
    const spread = fingers === 1 ? 0 : (i - 1) * 0.10;
    const tip = [
      palm[0] + (palm[0] - wrist[0]) * 1.7 + spread * 0.3,
      palm[1] + spread,
      palm[2] + (palm[2] - wrist[2]) * 1.7 - 0.06,
    ];
    f.push(...segment(palm, tip, 0.020, 0.007, FLESH_DARK, 4));
  }
  return f;
}

// Ribcage: a tapered barrel with the ribs showing as proud slats. Starved, not
// muscular — you should be able to count them when the torch lands.
// Local +x is the direction it faces, so ribs sit on +x and the spine on -x.
function torso(chestZ, hipZ) {
  const f = [
    ...tr(prism(8, 0.150, 0.125, 0, 0.12, FLESH, 'flesh'), 0, 0, hipZ - 0.06),   // pelvis
    ...tr(prism(8, 0.125, 0.200, 0, chestZ - hipZ - 0.10, FLESH, 'flesh'), 0, 0, hipZ + 0.06),
    ...tr(prism(8, 0.200, 0.165, 0, 0.14, FLESH, 'flesh'), 0, 0, chestZ - 0.10),
  ];
  // Ribs, pushing out through the front of the chest.
  for (let i = 0; i < 5; i++) {
    const z = hipZ + 0.22 + i * 0.085;
    const w = 0.26 + i * 0.030;
    f.push(...bx(0.055 + i * 0.012, 0, z, 0.06, w, 0.030, FLESH_PALE, { mat: 'flesh' }));
  }
  // Spine knuckles down the back.
  for (let i = 0; i < 7; i++) {
    f.push(...bx(-0.135, 0, hipZ + 0.04 + i * 0.078, 0.040, 0.055, 0.050, FLESH_PALE, { mat: 'flesh' }));
  }
  // Collarbones, jutting.
  for (const s of [-1, 1]) {
    f.push(...tr(rz(bx(0, 0, 0, 0.26, 0.050, 0.038, FLESH_PALE, { mat: 'flesh' }), s * 0.55), 0.04, s * 0.11, chestZ - 0.02));
  }
  return f;
}

// The head. Small, smooth, and mostly featureless until the beam is right on it,
// at which point the jaw is the problem.
function head(tilt, turn, mouth, eyeGlow, detail) {
  const f = [];
  // Cranium: two stacked prisms rather than a sphere, so it reads as a skull.
  f.push(...tr(prism(7, 0.078, 0.100, 0, 0.09, FLESH, 'flesh'), -0.010, 0, 0));
  f.push(...tr(prism(7, 0.100, 0.055, 0, 0.10, FLESH, 'flesh'), -0.010, 0, 0.09));
  // Face plate on +x — the direction it walks. Sunken, so the brow overhangs.
  f.push(...bx(0.062, 0, 0.062, 0.050, 0.140, 0.145, FLESH_DARK, { mat: 'flesh' }));
  f.push(...bx(0.070, 0, 0.130, 0.062, 0.150, 0.030, FLESH, { mat: 'flesh' }));   // brow ridge
  // Eyes: deep, small, barely emissive. They are the only warm thing in the game.
  for (const s of [-1, 1]) {
    f.push(...bx(0.088, s * 0.042, 0.092, 0.016, 0.030, 0.019, [34, 7, 6],
      { mat: 'flesh', emit: [150 * eyeGlow, 18 * eyeGlow, 11 * eyeGlow] }));
  }
  // Jaw, hinged at the back of the skull and dropped by `mouth`. At mouth = 1 it
  // hangs open roughly twice as far as a jaw hinges.
  const drop = mouth * 1.0;
  const jaw = [
    ...bx(0.030, 0, -0.030, 0.115, 0.120, 0.055, FLESH_DARK, { mat: 'flesh' }),
    ...bx(0.086, 0, -0.010, 0.030, 0.100, 0.055, FLESH_DARK, { mat: 'flesh' }),
  ];
  // Rotate about the hinge point behind the jaw (ry tips +x downward for
  // positive angles, which is exactly a jaw dropping).
  f.push(...tr(ry(tr(jaw, 0.02, 0, 0.03), drop), -0.02, 0, -0.03));
  // Mouth cavity + teeth, only meaningful once it opens — and twelve teeth is
  // seventy-odd faces, so only when you are close enough to count them.
  if (mouth > 0.05) {
    f.push(...bx(0.058, 0, 0.016 - drop * 0.050, 0.060, 0.105, 0.024 + drop * 0.12, [5, 4, 5], { mat: 'flesh' }));
    if (detail) {
      for (let i = 0; i < 6; i++) {
        const y = -0.044 + i * 0.018;
        f.push(...bx(0.086, y, 0.022, 0.014, 0.010, 0.022, [180, 172, 148], { mat: 'porcelain' }));
        f.push(...bx(0.082 + drop * 0.030, y + 0.009, 0.020 - drop * 0.115, 0.014, 0.009, 0.020, [162, 152, 130], { mat: 'porcelain' }));
      }
    }
  }
  return rz(ry(f, tilt), turn);
}

/**
 * Build the creature in its current pose.
 *
 * @param {object} pose
 *   phase   walk-cycle phase in radians
 *   speed   0 = standing dead still, 1 = full stride
 *   lean    forward lean in radians (charging leans hard)
 *   reach   0..1, arms swinging up and forward to grab
 *   mouth   0..1 jaw drop
 *   stagger 0..1, hit reaction — the whole body jerks back
 *   eyeGlow 0..1
 *   twitch  0..1, intensity of a fit — see below
 *   twitchT time in seconds driving the judder waveform
 *   snap    radians the head has jerked round to and is holding
 * @returns {Array} faces in WORLD units, feet at z=0, facing +x
 */
export function buildCreature(pose) {
  const speed = clamp(pose.speed || 0, 0, 1);
  const phase = pose.phase || 0;
  const reach = clamp(pose.reach || 0, 0, 1);
  const mouth = clamp(pose.mouth || 0, 0, 1);
  const eyeGlow = pose.eyeGlow == null ? 1 : pose.eyeGlow;

  // The twitch. A fit lasts a fifth of a second: several body parts judder at
  // slightly different rates so it never resolves into a single clean shake,
  // and the head has already snapped somewhere else by the time it stops. The
  // frequencies are deliberately close to but not on the frame rate, which is
  // what makes it read as something malfunctioning rather than as an animation.
  const tw = clamp(pose.twitch || 0, 0, 1);
  const tt = pose.twitchT || 0;
  const jerk = (k, f) => tw * Math.sin(tt * f) * k;

  const lean = (pose.lean || 0) + pose.stagger * -0.5 + jerk(0.13, 41);

  // Stride. Amplitudes are deliberately small: because the body is grounded on
  // its lowest vertex (see below), every centimetre a foot gains across the
  // cycle becomes a centimetre the whole creature rises. The first pass used
  // 0.32 + speed*0.62 with a 0.045 hip drop and the head travelled twenty
  // centimetres a step — it bounced rather than walked, and at speed 0 it was
  // still bouncing fourteen. It should glide, low and level, like something
  // that does not have to work at it.
  const amp = 0.09 + speed * 0.38;
  const swingL = Math.sin(phase) * amp;
  const swingR = Math.sin(phase + Math.PI) * amp;
  const liftL = Math.max(0, Math.sin(phase + 1.2)) * speed * 0.18;
  const liftR = Math.max(0, Math.sin(phase + 1.2 + Math.PI)) * speed * 0.18;
  const bob = Math.abs(Math.cos(phase)) * 0.012 * speed;
  const sway = Math.sin(phase) * 0.018 * speed + jerk(0.030, 53);

  const hipZ = 1.28 - bob - pose.stagger * 0.10 + jerk(0.022, 61);
  const chestZ = hipZ + 0.68;
  const neckZ = chestZ + 0.10;

  const detail = pose.detail !== 0;
  const f = [];
  f.push(...leg([0, -0.095, hipZ], swingL, liftL, -1));
  f.push(...leg([0, 0.095, hipZ], swingR, liftR, 1));
  // Only the legs decide where the floor is. Its fingertips hang almost to the
  // carpet, and letting a swinging hand become the lowest vertex threw the
  // whole body upward for half of every stride.
  const footFaces = f.length;
  f.push(...torso(chestZ, hipZ));
  f.push(...arm([0, -0.215, chestZ - 0.03], swingR * 0.7 + jerk(0.42, 47), reach, -1, detail));
  f.push(...arm([0, 0.215, chestZ - 0.03], swingL * 0.7 + jerk(0.42, 59), reach, 1, detail));
  // Long neck, craning forward.
  f.push(...segment([0.01, 0, chestZ - 0.02], [0.07 + reach * 0.06, 0, neckZ + 0.16], 0.058, 0.046, FLESH_DARK, 6));
  // `snap` is the head having whipped round to somewhere and stopped there —
  // it holds through the fit and unwinds afterwards, which is the part that
  // actually gets you. The judder on top is just texture.
  f.push(...tr(
    head(
      0.30 - reach * 0.62 + pose.stagger * 0.9 + jerk(0.30, 67),
      Math.sin(phase * 0.5) * 0.16 + (pose.turn || 0) + (pose.snap || 0) + jerk(0.34, 43),
      mouth, eyeGlow, detail,
    ),
    0.08 + reach * 0.07, 0, neckZ + 0.16,
  ));

  // Everything above is upright and in metres. One fused pass leans the body
  // forward about the hips, adds the walking sway, and finds the lowest point;
  // a second converts to world units and drops the body onto the carpet.
  //
  // Grounding this way rather than hand-tuning bone lengths matters because the
  // leg is digitigrade and its reach changes across the stride.
  //
  // The legs are deliberately left OUT of the lean. The lean pivots about the
  // hip, so it swings the feet through an arc whose vertical component is
  // proportional to how far fore and aft they are — which at a charge's 0.55 rad
  // was thirty-four centimetres of bounce on its own, all of it introduced by
  // the grounding step. Excluding them keeps the legs vertical under a stooping
  // torso, which is what a stooped walk looks like anyway.
  const cl = Math.cos(lean), sl = Math.sin(lean);
  let minZ = Infinity;
  for (let i = 0; i < f.length; i++) {
    const vs = f[i].v;
    const ground = i < footFaces;
    for (let j = 0; j < vs.length; j++) {
      const v = vs[j];
      v[1] += sway;
      if (ground) {
        if (v[2] < minZ) minZ = v[2];
      } else {
        const x = v[0], zh = v[2] - hipZ;
        v[0] = x * cl + zh * sl;
        v[2] = -x * sl + zh * cl + hipZ;
      }
    }
  }
  const drop = minZ - 0.004;
  return xformIn(f, (v) => {
    v[0] *= METER; v[1] *= METER; v[2] = (v[2] - drop) * METER;
  });
}

// ============================================================================
// THE HUNTER — what the building sends after you fire the gun.
//
// It used to be the creature again, taller: a folded-over biped with four arms.
// That was the whole problem. Whatever it did, the silhouette said "the thing
// from earlier, but bigger", and a sequel to a monster is not a monster.
//
// So it is not a person any more. It is a SPIDER, at a scale nothing in a
// corridor should be: a low flat body slung about a metre and a half up,
// dragging a heavy abdomen, under EIGHT legs that arch to nearly three metres
// at the knee before coming down. It stands underneath its own legs. The leg
// span is close to four metres, which is wider than most of the corridors it
// comes down, so the front pair are usually braced on the walls.
//
// Three things carry it, in order of how early you notice them:
//
//   THE EYES. Eight of them in a cluster on the front of the body, two large
//   and six small, and they barely dim with distance (HUNTER.eyeFalloff). At
//   twenty metres that cluster is the entire creature.
//
//   THE GAIT. Alternating tetrapod — four legs down while four swing — and the
//   phase is driven by GROUND COVERED, not by a timer (see director.js). The
//   old one cycled its legs on a clock while the body slid along on rails, and
//   that single detail is what made a 2.9 m monster read as a sprite on a
//   track. The feet stay where they are put now.
//
//   THE TWITCH. Far more of it than the creature gets, and it is per-limb: the
//   knees jitter out of phase with each other, so even standing still it is
//   never quite settled.
// ============================================================================

const HUNT_DARK = [26, 23, 23];
const HUNT_MID = [40, 35, 34];
const HUNT_PALE = [62, 54, 51];

// One of the eight. The knee is the highest point on the whole animal, which is
// the read that says spider before any detail resolves: the body hangs UNDER
// the geometry instead of sitting on top of it.
function spiderLeg(base, ang, reachOut, kneeZ, swing, lift, jit, detail) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const foot = [
    base[0] + ca * reachOut + swing,
    base[1] + sa * reachOut,
    lift,
  ];
  const kneeOut = reachOut * 0.44;
  const knee = [
    base[0] + ca * kneeOut + swing * 0.30 + jit * 0.06,
    base[1] + sa * kneeOut + jit * 0.05,
    kneeZ + jit * 0.09,
  ];
  const f = [
    ...segment(base, knee, 0.088, 0.052, HUNT_MID, 6),
    ...segment(knee, foot, 0.052, 0.015, HUNT_DARK, 6),
    // The tarsus. It stands on points, and they are what you hear on carpet.
    ...segment(foot, [foot[0] + ca * 0.16, foot[1] + sa * 0.16, Math.max(0.006, lift - 0.03)],
      0.017, 0.005, HUNT_DARK, 4),
  ];
  if (detail) {
    // Bristles up the femur, longest at the knee.
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const p0 = along(base, knee, t);
      f.push(...segment(p0, [p0[0] - 0.02, p0[1], p0[2] + 0.07 + t * 0.09], 0.011, 0.002, HUNT_PALE, 3));
    }
  }
  return f;
}

// The face, on the front of the cephalothorax. A wedge with a split jaw and
// EIGHT eyes: two large forward pair and six small ones ringing them. The
// cluster is the whole silhouette at range.
function hunterHead(tilt, turn, mouth, eyeGlow, detail) {
  const f = [];
  f.push(...tr(prism(6, 0.115, 0.145, 0, 0.16, HUNT_MID, 'flesh'), -0.02, 0, 0));
  f.push(...tr(prism(6, 0.145, 0.060, 0, 0.19, HUNT_MID, 'flesh'), 0.03, 0, 0.16));
  f.push(...bx(0.100, 0, 0.100, 0.086, 0.215, 0.225, HUNT_DARK, { mat: 'flesh' }));
  f.push(...bx(0.116, 0, 0.212, 0.096, 0.225, 0.044, HUNT_MID, { mat: 'flesh' }));  // brow shelf

  // Eight eyes. The front pair are big and level; the rest are a scatter above
  // and outside them, all looking the same way, none of them blinking.
  const eyes = [
    [0.060, 0.140, 0.062, 0.042],   // |y|, z, width, height — the big pair
    [0.116, 0.176, 0.030, 0.024],
    [0.028, 0.192, 0.026, 0.022],
    [0.140, 0.116, 0.024, 0.020],
  ];
  for (const [ey, ez, ew, eh] of eyes) {
    for (const sgn of [-1, 1]) {
      f.push(...bx(0.146, sgn * ey, ez, 0.020, ew, eh, [40, 6, 5],
        { mat: 'flesh', emit: [235 * eyeGlow, 24 * eyeGlow, 13 * eyeGlow] }));
    }
  }

  // Chelicerae: a jaw that opens sideways in two halves, not down.
  const drop = mouth * 1.2;
  for (const sgn of [-1, 1]) {
    const half = [
      ...bx(0.052, sgn * 0.056, -0.048, 0.170, 0.104, 0.072, HUNT_DARK, { mat: 'flesh' }),
      ...bx(0.130, sgn * 0.050, -0.018, 0.042, 0.088, 0.072, HUNT_DARK, { mat: 'flesh' }),
      // The fang.
      ...segment([0.150, sgn * 0.050, 0.010], [0.196, sgn * 0.028, -0.120],
        0.020, 0.004, [138, 126, 108], 5, 'porcelain'),
    ];
    f.push(...tr(rz(ry(tr(half, 0.02, 0, 0.04), drop * 0.5), sgn * drop * 0.78), -0.02, 0, -0.04));
  }
  if (mouth > 0.05 && detail) {
    f.push(...bx(0.090, 0, 0.016 - drop * 0.06, 0.086, 0.160, 0.034 + drop * 0.15, [4, 3, 4], { mat: 'flesh' }));
  }
  return rz(ry(f, tilt), turn);
}

/**
 * Build the hunter. Same pose contract as buildCreature.
 * @returns {Array} faces in WORLD units, feet at z=0, facing +x
 */
export function buildHunter(pose) {
  const speed = clamp(pose.speed || 0, 0, 1);
  const phase = pose.phase || 0;
  const reach = clamp(pose.reach || 0, 0, 1);
  const mouth = clamp(pose.mouth || 0, 0, 1);
  const eyeGlow = pose.eyeGlow == null ? 1 : pose.eyeGlow;
  const tw = clamp(pose.twitch || 0, 0, 1);
  const tt = pose.twitchT || 0;
  const jerk = (k, fq) => tw * Math.sin(tt * fq) * k;
  const detail = pose.detail !== 0;

  // It crouches to come at you: the body drops and the legs splay wider, which
  // is the only warning you get before it goes.
  const bodyZ = 1.60 - reach * 0.34 - pose.stagger * 0.10 + jerk(0.055, 63);
  const splay = 1 + reach * 0.16;

  const f = [];

  // --- eight legs, alternating tetrapod ------------------------------------
  // Four attachment points down each side of the cephalothorax; adjacent legs
  // on a side are half a cycle apart and the two sides are offset again, so
  // four feet are always down.
  const LEG = [
    // [x on the body, outward angle, horizontal reach, knee height]
    [0.30, -0.52, 1.58, 2.62],
    [0.10, -1.06, 1.80, 2.86],
    [-0.12, -2.02, 1.76, 2.80],
    [-0.32, -2.52, 1.46, 2.54],
  ];
  const amp = 0.12 + speed * 0.40;
  for (let i = 0; i < 4; i++) {
    const [lx, la, lr, lk] = LEG[i];
    for (const sgn of [-1, 1]) {
      const lp = phase + i * Math.PI + (sgn > 0 ? Math.PI : 0);
      const swing = Math.sin(lp) * amp;
      // Planted on the backswing, lifted on the way forward. Feet stay put.
      const lift = Math.max(0, Math.cos(lp)) * (0.05 + speed * 0.34);
      const ang = sgn > 0 ? -la : la;
      f.push(...spiderLeg(
        [lx, sgn * 0.20, bodyZ - 0.02],
        ang, lr * splay, lk - reach * 0.24,
        swing, lift,
        jerk(1, 37 + i * 11 + (sgn > 0 ? 5 : 0)),
        detail,
      ));
    }
  }
  const footFaces = f.length;   // everything above is what it stands on

  // --- body ----------------------------------------------------------------
  // Cephalothorax: a wide flat plate carrying the legs and the face.
  f.push(...segment([0.36, 0, bodyZ], [-0.10, 0, bodyZ + 0.02], 0.24, 0.34, HUNT_MID, 8));
  // Abdomen: a heavy sac it drags, hanging lower than the plate.
  f.push(...segment([-0.14, 0, bodyZ + 0.01], [-0.86, 0, bodyZ - 0.12], 0.34, 0.14, HUNT_DARK, 8));
  if (detail) {
    // Plates down the abdomen, and a row of spines over the leg roots.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      f.push(...bx(-0.20 - t * 0.60, 0, bodyZ + 0.22 - t * 0.20, 0.10, 0.24 - t * 0.14, 0.050,
        HUNT_PALE, { mat: 'flesh' }));
    }
    for (let i = 0; i < 4; i++) {
      for (const sgn of [-1, 1]) {
        f.push(...bx(0.30 - i * 0.21, sgn * 0.19, bodyZ + 0.19, 0.045, 0.045, 0.11,
          HUNT_PALE, { mat: 'flesh' }));
      }
    }
  }

  // --- pedipalps ------------------------------------------------------------
  // The two short raptorial limbs folded under the face. They are the only part
  // of it that ever comes toward you on its own, and they do it while it winds
  // up to charge.
  for (const sgn of [-1, 1]) {
    const sh = [0.38, sgn * 0.15, bodyZ - 0.06];
    const el = [
      sh[0] + 0.30 + reach * 0.34,
      sgn * (0.26 + reach * 0.10),
      bodyZ - 0.30 - reach * 0.16 + jerk(0.05, 51),
    ];
    const tip = [
      el[0] + 0.26 + reach * 0.40,
      sgn * (0.20 - reach * 0.12),
      bodyZ - 0.52 + reach * 0.44 + jerk(0.07, 59),
    ];
    f.push(...segment(sh, el, 0.062, 0.040, HUNT_MID, 5));
    f.push(...segment(el, tip, 0.040, 0.012, HUNT_DARK, 5));
  }

  // --- the face -------------------------------------------------------------
  f.push(...tr(
    hunterHead(
      0.16 - reach * 0.42 + pose.stagger * 0.7 + jerk(0.40, 67),
      Math.sin(phase * 0.5) * 0.10 + (pose.turn || 0) + (pose.snap || 0) + jerk(0.44, 43),
      mouth, eyeGlow, detail,
    ),
    0.50 + reach * 0.14, 0, bodyZ - 0.06,
  ));

  // Sway, and the whole body pitching nose-down as it reaches.
  const lean = (pose.lean || 0) + reach * 0.30 + pose.stagger * -0.4 + jerk(0.09, 41);
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const sway = Math.sin(phase * 0.5) * 0.03 * speed + jerk(0.045, 53);
  let minZ = Infinity;
  for (let i = 0; i < f.length; i++) {
    const vs = f[i].v;
    const ground = i < footFaces;
    for (let j = 0; j < vs.length; j++) {
      const v = vs[j];
      v[1] += sway;
      if (ground) {
        if (v[2] < minZ) minZ = v[2];
      } else {
        // Only the body pitches; the legs stay where they are planted.
        const x = v[0], zh = v[2] - bodyZ;
        v[0] = x * cl + zh * sl;
        v[2] = -x * sl + zh * cl + bodyZ;
      }
    }
  }
  const drop = minZ - 0.004;
  return xformIn(f, (v) => {
    v[0] *= METER; v[1] *= METER; v[2] = (v[2] - drop) * METER;
  });
}

// A cheap, low-face-count stand-in used for the "crowd" anomaly, where a dozen
// of them appear at once and a full build each would cost real frame time.
//
// They get the mid-tone flesh rather than the dark one and a pair of dim
// emissive eyes: at the eight to twelve metres they stand at, an unlit dark
// figure is swallowed whole by the fog, and the anomaly reads as nothing
// happening. Two faint red points at head height, a dozen of them, all aimed
// at you, reads as exactly what it is.
export function buildCrowdFigure(phase) {
  const hipZ = 1.28, chestZ = hipZ + 0.68;
  const f = [
    ...segment([0, -0.09, hipZ], [0.02, -0.10, 0.02], 0.090, 0.036, FLESH_DARK, 4),
    ...segment([0, 0.09, hipZ], [0.02, 0.10, 0.02], 0.090, 0.036, FLESH_DARK, 4),
    ...tr(prism(6, 0.125, 0.185, 0, chestZ - hipZ, FLESH, 'flesh'), 0, 0, hipZ),
    ...segment([0, -0.195, chestZ - 0.03], [0.05, -0.23, hipZ - 0.42], 0.062, 0.026, FLESH, 4),
    ...segment([0, 0.195, chestZ - 0.03], [0.05, 0.23, hipZ - 0.42], 0.062, 0.026, FLESH, 4),
    ...tr(prism(6, 0.075, 0.095, 0, 0.19, FLESH, 'flesh'), 0.03, 0, chestZ + 0.06),
  ];
  for (const s of [-1, 1]) {
    f.push(...bx(0.098, s * 0.040, chestZ + 0.19, 0.016, 0.028, 0.018, [30, 6, 5],
      { mat: 'flesh', emit: [120, 14, 9] }));
  }
  ry(f, Math.sin(phase) * 0.05);
  return xformIn(f, (v) => { v[0] *= METER; v[1] *= METER; v[2] *= METER; });
}
