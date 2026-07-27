import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AudioEngine, spatialProfile } from '../src/audio.js';
import {
  ANOMALIES, RITUAL_GUIDE, LANDMARK_EVENTS, LANDMARK_VOICE, DECALS, WORLD,
  WITNESS, OUTSIDE,
} from '../src/config.js';
import { generateTextures, TERRAIN_W, TERRAIN_SCALE } from '../src/textures.js';
import { FIELD } from '../src/terrain.js';
import { Director, hunterStepReverb } from '../src/director.js';
import { setNoiseSeed } from '../src/noise.js';
import { World } from '../src/world.js';
import { Props } from '../src/objects.js';
import { buildMeshes, PROP_TYPES } from '../src/models.js';

function mulberry32(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let z = n;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function freshScenario(seed = 1337) {
  // Every assertion gets a new world, player and director. Reusing a live
  // director is invalid here: landmarksUsed, anomaly and scheduler state are
  // intentionally persistent during a run.
  setNoiseSeed(seed);
  const world = new World();
  const spawn = world.findSpawn();
  const player = {
    ...spawn,
    angle: 0,
    dirX: 1,
    dirY: 0,
    moving: false,
    flashlight: true,
    falling: false,
    dead: false,
  };
  const audio = new Proxy({}, { get: () => () => {} });
  return {
    world,
    player,
    director: new Director(audio, player, world, mulberry32(seed ^ 0xa53c9e1d)),
  };
}

class FakeParam {
  constructor(value = 0) { this.value = value; }
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  connect(node) { return node; }
  start() {}
  stop() {}
}

function fakeAudioContext() {
  const node = (fields = {}) => Object.assign(new FakeNode(), fields);
  return {
    currentTime: 1,
    createGain: () => node({ gain: new FakeParam(1) }),
    createStereoPanner: () => node({ pan: new FakeParam(0) }),
    createBiquadFilter: () => node({
      type: 'lowpass',
      frequency: new FakeParam(20000),
      Q: new FakeParam(1),
    }),
    createBufferSource: () => node({ playbackRate: new FakeParam(1) }),
    createOscillator: () => node({ frequency: new FakeParam(200) }),
  };
}

const front = spatialProfile(0, 0.5);
const side = spatialProfile(Math.PI / 2, 0.5);
const back = spatialProfile(Math.PI, 0.5);
assert.equal(front.cutoff, 16000);
assert.ok(Math.abs(back.cutoff - 1600) < 1e-9);
assert.ok(front.gain > side.gain && side.gain > back.gain);
assert.ok(front.send < side.send && side.send < back.send);
assert.equal(hunterStepReverb(Math.PI, 2.9, true), 0);
assert.equal(hunterStepReverb(0, 2.9, true), 0.75);
assert.equal(hunterStepReverb(Math.PI, 3.1, true), 0.75);
assert.equal(hunterStepReverb(Math.PI, 2.9, false), 0.75);

const audioSource = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
assert.equal(
  (audioSource.match(/createStereoPanner\s*\(/g) || []).length,
  1,
  'all spatial graphs should route through AudioEngine._spatial',
);

{
  const engine = new AudioEngine();
  engine.ctx = fakeAudioContext();
  engine.started = true;
  engine.master = new FakeNode();
  engine.reverb = new FakeNode();
  engine.muffle = new FakeNode();
  engine.muffle.frequency = new FakeParam(777);
  engine._noise = {};
  engine._longNoise = {};
  assert.doesNotThrow(() => {
    engine.playPitDraft(0, 0.2, Math.PI);
    engine.playDraught(0, 0.2, Math.PI);
    engine.playFootstep({ pan: 0, rel: Math.PI });
    engine.playCreatureStep(0, 0.3, Math.PI);
    engine._breathIn(0.4, 0, Math.PI);
    engine.playDistantCall(0.3, 0, Math.PI);
    engine.playHunterStep(0, 0.4, Math.PI, 0);
    engine.playHunterCall(0.4, 0, Math.PI);
    engine.playShellDrop(0, Math.PI);
    engine.playBulletImpact(0, 5, Math.PI);
    engine.playWhisper({ pan: 0, rel: Math.PI });
    engine.playDrone({ pan: 0, rel: Math.PI });
    engine.playDistantBang(0, Math.PI);
  }, 'all converted sound graphs should connect through the shared spatial output');
  assert.equal(
    engine.muffle.frequency.value,
    777,
    'per-source spatial filters must not rewrite the silence anomaly master filter',
  );
}

{
  const { director } = freshScenario();
  const first = director._anomalyTarget();
  assert.ok(first?.landmark, 'swarm should fall back to an unused landmark');
  director.landmarksUsed.add(first.key);
  const second = director._anomalyTarget();
  assert.ok(second?.landmark, 'another unused landmark should remain available');
  assert.notEqual(second.key, first.key);
}

{
  const { director } = freshScenario();
  const crowd = director._crowdTarget();
  assert.ok(crowd?.landmark, 'crowd should find a landmark in its widened radius');
  director.landmarksUsed.add(crowd.key);
  const reused = director._crowdTarget();
  assert.equal(reused?.key, crowd.key, 'crowd eligibility must not depend on unused state');
  assert.equal(ANOMALIES.crowd.targetRadius, 48);
  assert.equal(director._startAnomaly('crowd'), true, 'a crowd target should build a real route');
}

{
  const { director, player } = freshScenario();
  director.creature = { x: player.x, y: player.y + 4, mode: 'stalk', leaving: false };
  director.hunter = { x: player.x - 8, y: player.y, mode: 'pace' };
  const fx = { threatRel: null, threatNear: 0 };
  director._updateThreatCues(fx);
  assert.ok(Math.abs(fx.threatRel - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(fx.threatNear - 0.6) < 1e-9);
}

assert.ok(RITUAL_GUIDE.radius > ANOMALIES.crowd.targetRadius);

// --- the rooms that were built on purpose -----------------------------------

const LANDMARK_NAMES = ['ward', 'atrium', 'shaft', 'combs', 'chapel'];
const LANDMARK_ONLY = ['cross', 'candles', 'pew', 'bedFrame', 'railing'];
const SIZE = WORLD.artery;

// Every block of every landmark kind within this many blocks of the origin.
function landmarkBlocks(world, span = 10) {
  const out = [];
  for (let by = -span; by <= span; by++) {
    for (let bx = -span; bx <= span; bx++) {
      const x = (bx + 0.5) * SIZE, y = (by + 0.5) * SIZE;
      const name = world.landmarkAt(Math.floor(x), Math.floor(y));
      if (name) out.push({ name, bx, by, x, y });
    }
  }
  return out;
}

{
  // The five landmark-only models must exist, must build, and must never be
  // reachable from the weighted scatter bag — a cross in a random corridor is
  // the whole failure this kit system exists to prevent.
  const meshes = buildMeshes();
  for (const key of LANDMARK_ONLY) {
    assert.ok(meshes[key]?.length, `${key} should build a mesh`);
    const type = PROP_TYPES.find((t) => t.key === key);
    assert.ok(type, `${key} should be in PROP_TYPES`);
    assert.equal(type.weight, 0, `${key} must never be reachable from the scatter bag`);
    // ...and it has to rest ON the floor, not through it. Rotating a tall model
    // about its own base is how the cross ended up half under the carpet.
    let minZ = Infinity;
    for (const f of meshes[key]) for (const v of f.v) if (v[2] < minZ) minZ = v[2];
    assert.ok(minZ > -1e-6, `${key} should sit on the floor, not through it (minZ ${minZ})`);
  }
}

{
  // A landmark's props come from its own kit; a district's never do. And the
  // combs is identical to itself everywhere: one key, one yaw, one seed.
  setNoiseSeed(1337);
  const world = new World();
  const props = new Props(world);
  const seen = {};
  let districtLeaks = 0;

  for (const b of landmarkBlocks(world)) {
    const bucket = (seen[b.name] ||= { keys: new Set(), yaws: new Set(), seeds: new Set() });
    for (let cy = b.by * SIZE; cy < b.by * SIZE + SIZE; cy++) {
      for (let cx = b.bx * SIZE; cx < b.bx * SIZE + SIZE; cx++) {
        for (const p of props._at(cx, cy)) {
          bucket.keys.add(p.key);
          if (b.name === 'combs') { bucket.yaws.add(p.yaw); bucket.seeds.add(p.seed); }
        }
      }
    }
  }
  // Sample a wide band of ordinary corridor for the negative case.
  for (let cy = -110; cy <= 110; cy++) {
    for (let cx = -110; cx <= 110; cx++) {
      if (world.landmarkAt(cx, cy)) continue;
      for (const p of props._at(cx, cy)) if (LANDMARK_ONLY.includes(p.key)) districtLeaks++;
    }
  }
  assert.equal(districtLeaks, 0, 'landmark-only props must not appear outside their room');
  assert.ok(seen.ward?.keys.has('bedFrame'), 'the ward should be furnished with bed frames');
  assert.ok(seen.shaft?.keys.has('railing'), 'the shaft should be furnished with torn barrier');
  assert.ok(seen.chapel?.keys.has('cross'), 'the chapel should be furnished with crosses');
  assert.deepEqual([...seen.combs.keys], ['cone'], 'the combs holds exactly one kind of object');
  assert.equal(seen.combs.yaws.size, 1, 'every combs prop faces the same way');
  assert.equal(seen.combs.seeds.size, 1, 'every combs prop is generated from the same seed');
}

{
  // Blood on a landmark's walls records the one event that room was for, and
  // the combs records nothing at all.
  setNoiseSeed(1337);
  const world = new World();
  const kinds = {};
  let combsMarked = 0;
  for (const b of landmarkBlocks(world)) {
    for (let cy = b.by * SIZE; cy < b.by * SIZE + SIZE; cy++) {
      for (let cx = b.bx * SIZE; cx < b.bx * SIZE + SIZE; cx++) {
        if (world.bloodWallFace(cx, cy) < 0) continue;
        if (b.name === 'combs') combsMarked++;
        const style = world.bloodWallStyle(cx, cy);
        assert.ok(style, `${b.name} walls should carry an authored archetype`);
        assert.ok(DECALS.landmark[b.name].kinds.includes(style.kind),
          `${b.name} should only record its own kind of event, got ${style.kind}`);
        (kinds[b.name] ||= new Set()).add(style.kind);
      }
    }
  }
  assert.equal(combsMarked, 0, 'nothing marks a combs wall; that is what the room is');
  assert.ok(kinds.chapel?.has('tally'), 'somebody counted in the chapel');
  assert.equal(world.bloodWallStyle(0, 0), null, 'district walls still roll their own');
}

{
  // Rituals aim. Across every landmark in a sample world, from every open cell,
  // the room must land its formation somewhere — and it must almost always land
  // it while the player is still looking, rather than firing blind at the
  // deadline. Before the aimer this was one build, LOS-filtered, and the two
  // best formations in the game were the two most likely to be discarded.
  setNoiseSeed(1337);
  const world = new World();
  const audio = new Proxy({}, { get: () => () => {} });
  const DT = 1 / 30;
  let tries = 0, patient = 0, dead = 0;

  for (const b of landmarkBlocks(world, 6)) {
    const cfg = LANDMARK_EVENTS[b.name];
    const open = [];
    for (let cy = b.by * SIZE; cy < b.by * SIZE + SIZE; cy++) {
      for (let cx = b.bx * SIZE; cx < b.bx * SIZE + SIZE; cx++) {
        if (!world.blocked(cx, cy)) open.push({ x: cx + 0.5, y: cy + 0.5 });
      }
    }
    for (let i = 0; i < open.length; i += 5) {
      for (const start of [0, 2.1, 4.2]) {
        const player = {
          ...open[i], angle: start, dirX: Math.cos(start), dirY: Math.sin(start),
          moving: false, flashlight: true, falling: false, dead: false,
        };
        const director = new Director(audio, player, world, mulberry32(0x41c6ce57));
        const pending = {
          name: b.name, cfg, key: 'k', cx: b.x, cy: b.y,
          at: 100, deadline: 100 + LANDMARK_EVENTS.patience,
        };
        tries++;
        let fired = false;
        // The patience window, with the player looking unhurriedly around.
        for (let t = 0; t <= LANDMARK_EVENTS.patience + DT; t += DT) {
          director.elapsed = 100 + t;
          player.angle = start + 0.9 * t;
          player.dirX = Math.cos(player.angle);
          player.dirY = Math.sin(player.angle);
          const forced = director.elapsed >= pending.deadline;
          if (director._fireRitual(pending, forced)) {
            fired = true;
            if (!forced) patient++;
            assert.ok(director.ritual.eyes.length > 0, 'a fired ritual has eyes');
            break;
          }
          if (forced) break;
        }
        if (!fired) dead++;
      }
    }
  }
  assert.ok(tries > 200, `the sample should be meaningful, got ${tries}`);
  assert.equal(dead, 0, 'every landmark ritual must land somewhere');
  assert.ok(patient / tries > 0.75,
    `most rituals should fire while you are looking, got ${(patient / tries * 100).toFixed(0)}%`);
}

{
  // Walking in registers, wordlessly, the first time; the SECOND room of a kind
  // is the one that says something, and it says it exactly once. There is no
  // counter and there must never be one.
  for (const name of LANDMARK_NAMES) {
    assert.ok(LANDMARK_VOICE.lines[name], `${name} should have a recognition line`);
    assert.ok(!/\d/.test(LANDMARK_VOICE.lines[name]),
      'a recognition line is not a score; it must not contain a number');
  }
  const { director } = freshScenario();
  const said = [];
  director.onLine = (t) => said.push(t);

  director._enterLandmark('ward');
  assert.ok(director.hush, 'walking in should hush the building');
  assert.equal(director.pendingLines.length, 0, 'the first ward of a run says nothing');

  director._enterLandmark('ward');
  assert.equal(director.pendingLines.length, 1,
    'the second ward of a run has something to say');
  assert.equal(director.pendingLines[0].text, LANDMARK_VOICE.lines.ward);
  assert.ok(director.pendingLines[0].at > director.elapsed, 'the line waits a beat');

  director.elapsed = director.pendingLines[0].at;
  director._updateLandmarkPresence(0.016, { fogDensity: 1 });
  assert.deepEqual(said, [LANDMARK_VOICE.lines.ward]);

  director._enterLandmark('ward');
  assert.equal(director.pendingLines.length, 0, 'a room only ever says its line once');
}

// The witness lines — the only explanation the sixth ending ever gets, and the
// three ways they can be lost. Each is once ever, but "once" has to mean once
// SAID: a line swallowed because something walked into the room with you has to
// be offered again, or the mechanic goes back to being undocumented.
{
  for (const key of ['missed', 'kept', 'spent']) {
    assert.ok(WITNESS.lines[key], `${key} should have a line`);
    assert.ok(!/\d/.test(WITNESS.lines[key]), 'a witness line is not a score');
    assert.equal(WITNESS.lines[key], WITNESS.lines[key].toLowerCase(),
      'witness lines share the register of the recognition lines');
  }

  const { director } = freshScenario();
  const said = [];
  director.onLine = (t) => said.push(t);

  // Two of them queued inside the same second. The first must not be eaten by
  // the second — that was a real bug and this is the guard on it.
  director._witnessLine('missed');
  director._witnessLine('kept');
  assert.equal(director.pendingLines.length, 2, 'lines queue, they do not replace');
  assert.equal(director._witnessLine('missed') || director.pendingLines.length, 2,
    'the same line does not queue twice');

  director.elapsed += 10;
  director._updateLandmarkPresence(0.016, { fogDensity: 1 });
  assert.deepEqual(said, [WITNESS.lines.missed]);
  assert.ok(director.witnessTold.has('missed'), 'said is what marks it said');
  assert.ok(!director.witnessTold.has('kept'), 'the one still queued is not said yet');

  director.elapsed += 10;
  director._updateLandmarkPresence(0.016, { fogDensity: 1 });
  assert.deepEqual(said, [WITNESS.lines.missed, WITNESS.lines.kept]);

  // ...and a line dropped because there was a hunter in the room comes back.
  const other = freshScenario().director;
  other.hunter = { x: 0, y: 0 };
  other.onLine = () => assert.fail('nothing speaks over the hunter');
  other._witnessLine('kept');
  other.elapsed += 10;
  other._updateLandmarkPresence(0.016, { fogDensity: 1 });
  assert.equal(other.pendingLines.length, 0, 'it was dropped');
  assert.ok(!other.witnessTold.has('kept'), '...and therefore never said');
  other._witnessLine('kept');
  assert.equal(other.pendingLines.length, 1, 'so it can be offered again');
}

// Standing still is the rule the whole ending turns on, and the fog opening is
// the only thing that ever states it. If this stops being true the ending goes
// back to being an accident.
{
  const { director } = freshScenario();
  const fog = () => {
    const fx = { fogDensity: 1 };
    director._updateHold(1 / 60, fx);
    return fx.fogDensity;
  };

  director.holdActive = true;
  for (let i = 0; i < 60 * 4; i++) fog();
  assert.ok(fog() < 1 - WITNESS.fog * 0.9, 'holding still opens the air');

  director.holdActive = false;
  for (let i = 0; i < 60; i++) fog();
  assert.equal(fog(), 1, 'and moving shuts it again');

  // The round that closes the way out closes this with it.
  director.holdActive = true;
  director.graceLost = true;
  for (let i = 0; i < 60 * 4; i++) fog();
  assert.equal(fog(), 1, 'after the gun there is nothing left to open');
}

// --- the field --------------------------------------------------------------

{
  setNoiseSeed(1337);
  const world = new World();
  world.findSpawn();
  const o = world.stampOutside();
  const F = OUTSIDE.field;

  // THE ONE THAT MATTERS. The ground is drawn from a baked texture and queried
  // by three other files, and each of them converts world coordinates into the
  // field's own frame separately. If those conversions ever disagree the water
  // is in a different place in the picture than it is under your feet, and
  // nothing about the symptom would point at the cause.
  const tex = generateTextures();
  for (const [across, out] of [[0, 4], [0, 20], [-13, 31], [26, 9], [40, 55]]) {
    const wx = o.doorX + across + 0.5, wy = o.wallY - out;
    const mx = ((wx - o.x0) * TERRAIN_SCALE) | 0;
    const my = ((wy - o.y0) * TERRAIN_SCALE) | 0;
    const baked = (tex.terrain.data[my * TERRAIN_W + mx] >>> 24) / 255 * FIELD.maxDepth;
    const live = world.groundWater(wx, wy);
    assert.ok(Math.abs(baked - live) < 0.12,
      `the baked ground and the queried ground must agree at ${across},${out} ` +
      `(texture says ${baked.toFixed(2)} m, terrain.js says ${live.toFixed(2)} m)`);
  }

  // You never arrive in it. The frame the light comes back on is the ending's
  // first impression and it is not "you are standing in a puddle".
  assert.equal(world.groundWater(o.spawnX, o.spawnY), 0, 'the doorway is dry');
  for (let out = 0; out <= 3; out += 0.5) {
    assert.equal(world.groundWater(o.spawnX, o.wallY - out), 0, 'so is the apron');
  }

  // ...but you do meet it, inside the walk the ending actually gives you.
  let met = 0;
  for (let out = 0; out <= OUTSIDE.walkFor; out += 0.5) {
    if (world.groundWater(o.spawnX, o.wallY - out) > 0.1) met++;
  }
  assert.ok(met > 4, 'the walk out should cross water, not just pass some');

  // And it is the exception. Half a field of standing water is a lake.
  let wet = 0, cells = 0;
  for (let out = 0; out < 70; out += 2) {
    for (let a = -70; a <= 70; a += 2) {
      cells++;
      if (world.groundWater(o.doorX + a, o.wallY - out) > 0) wet++;
    }
  }
  assert.ok(wet / cells < 0.30,
    `standing water should be a minority of the field, got ${(wet / cells * 100) | 0}%`);

  // What is standing in it, and the rules about where.
  const props = new Props(world);
  const meshes = buildMeshes();
  const field = props._field();
  assert.ok(field.length > 200, 'the field should have things in it');
  for (const p of field) {
    assert.ok(meshes[p.key], `${p.key} should be a real mesh`);
    if (p.far) assert.ok(meshes[p.far.key], `${p.far.key} should be a real mesh`);
    const across = p.x - o.doorX, out = o.wallY - p.y;
    assert.ok(Math.hypot(across, out) >= F.clearOfDoor - 1,
      'nothing stands where you are standing');
    const depth = world.groundWater(p.x, p.y);
    if (p.key === 'reeds') {
      // The waterline, not the water: the clump is rolled against the depth at
      // the middle of its cell and then jittered, so an individual one is
      // allowed to stand with its feet on the shore. What it may never do is
      // turn up out on the dry field, or out in the middle of the flood.
      assert.ok(depth <= FIELD.maxDepth * 0.6, 'rushes do not grow in deep water');
      assert.ok(world.groundHeightAt(p.x, p.y) < 0.25,
        'rushes belong at the waterline, not up the bank');
    }
    if (p.key === 'tussock' || p.key === 'boulder') {
      assert.equal(depth, 0, `${p.key} does not belong in the water`);
    }
  }

  // The wire on a fence post is authored to reach exactly the next post. Change
  // one of these two numbers alone and the fence hangs in the air.
  const wire = Math.max(...meshes.fencePost.flatMap((f) => f.v.map((v) => v[0])));
  assert.ok(Math.abs(wire - F.fenceEvery) < 0.02,
    `the wire spans ${wire.toFixed(2)} cells and the posts are ${F.fenceEvery} apart`);

  // The face budget. Fifty of these are in shot at once against six or seven
  // props indoors, and it is the same rasteriser.
  for (const out of [1.4, 12, 26]) {
    const vis = props.near(o.spawnX, o.wallY - out);
    const faces = vis.reduce((s, p) => s + meshes[p.key].length, 0);
    assert.ok(faces < 4000,
      `${faces} faces at ${out} cells out is more than the field's share`);
  }
}

console.log('direction, threat cues, landmark fallback, crowd eligibility,');
console.log('landmark kits, landmark blood, ritual aiming and recognition,');
console.log('witness lines, the air opening, and the field outside: ok');
