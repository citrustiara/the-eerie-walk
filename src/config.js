// config.js — central tunables for the whole game.
// Keeping every magic number here makes the rest of the codebase read cleanly
// and lets us tune feel (fog, fov, horror cadence) without hunting through logic.

export const RENDER = {
  // Internal render resolution. Deliberately tiny — it gets upscaled with
  // image-rendering: pixelated for the chunky, degraded-tape look.
  width: 480,
  height: 270,
  fov: 0.66,        // length of the camera plane; ~66° horizontal field of view
  maxDepth: 64,     // DDA safety cap (cells) before we give up on a ray
};

export const WORLD = {
  chunkSize: 16,        // cells per chunk edge
  cellSize: 1.0,        // world units per cell (kept 1 for simple math)
  wallHeight: 1.0,      // == 3 metres. See mesh.js: everything is authored to it.

  // The guaranteed-connected corridor lattice. Spacing is deliberately wide
  // (42 m) so that most of your time is spent inside a district rather than on
  // the grid, and the corridors wander so junctions stop looking identical.
  artery: 14,
  arteryWander: 3,      // cells the corridor drifts off its base line

  // Fraction of blocks that are not generated at all but STAMPED from one of
  // the five hand-drawn symmetric templates in world.js. One in five means you
  // meet one every minute or two of walking, and meet the same one again later.
  landmarkChance: 0.20,

  // What fills each 14x14 block between the arteries.
  //
  // Variety here is SHAPE, not colour. Every one of these is the same yellow
  // wallpaper; what changes between them is how tight it is, how far you can
  // see, how high the ceiling is and whether the floor is all there.
  districtWeights: {
    warren:   18,       // one-wide corridors around 2x2 blocks, with dead ends
    cells:    16,       // 4x4 rooms, one doorway per wall
    stacks:   16,       // long parallel service halls, aligned across blocks
    chambers: 12,       // organic rooms with no straight walls
    dense:    10,       // near-solid, one winding channel through it
    hall:      8,       // open floor under a seven-metre ceiling
    expanse:   8,       // vast, columned, no ceiling at all, windows
    collapse:  6,       // the floor has gone. Most of it.
    vault:     6,       // one big irregular room inside a thick shell
  },

  // How high the ceiling is over each kind of block. This is the single biggest
  // lever on how a space feels, and it costs nothing to walk into: a corridor
  // you have to stoop through opening into something with no ceiling at all is
  // the whole point of the map having shapes.
  //
  //   low    two and a half metres. You notice.
  //   std    the standard three-metre drop ceiling.
  //   high   seven metres, bare concrete deck and dead strip lights.
  //   open   there is no ceiling. It goes up into the dark, and there are
  //          windows up there.
  //
  // The actual heights live in world.js next to the code that draws them.
  ceilings: {
    warren:   'low',
    cells:    'std',
    stacks:   'std',
    chambers: 'std',
    dense:    'low',
    hall:     'high',
    expanse:  'open',
    // The floor went and took two storeys of ceiling with it, but there is
    // still a deck up there. A collapse block with no ceiling either was just
    // a black room with invisible holes in it, which is not a hazard, it is a
    // coin flip.
    collapse: 'high',
    vault:    'high',
    // landmarks
    ward:     'std',
    atrium:   'high',
    shaft:    'high',
    combs:    'low',
    chapel:   'high',
  },
};

export const PLAYER = {
  radius: 0.18,         // collision radius against walls
  walkSpeed: 2.4,       // units / second
  // Sprinting does not exist until the hunter does. You are given it at the
  // exact moment it becomes the only thing that helps, and it runs out — the
  // bar is there so you can watch it run out.
  sprintSpeed: 4.0,
  sprintSeconds: 3.6,   // full bar to empty, at a dead run
  sprintRegen: 0.34,    // fraction of the bar per second while not sprinting
  sprintFloor: 0.22,    // once empty, this much must come back before you can go again
  mouseSensitivity: 0.0022,
  maxPitch: 360,        // wide vertical look, in screen pixels of horizon shift
  bobFrequency: 9.2,    // head-bob speed while walking
  bobAmount: 2.6,       // head-bob vertical pixels
  eyeHeight: 0.5,       // 0..1 within the wall height == 1.5 m
};

// Holes in the floor.
//
// They used to be scenery: open cells you could see across and that nothing,
// including you, could walk into. An invisible wall around a hole is a strange
// thing to put in a game about a building that wants you dead, so the hole is
// now exactly what it looks like. You can walk into one. You will not walk out.
//
// Everything else still treats them as blocked — the creature does not fall
// down holes, because a creature that removes itself from the level is not a
// threat, it is a physics demonstration.
export const PIT = {
  depth: 2.6,           // wall heights below the floor. Eight metres. Enough.
  edgeSound: 3.2,       // within this many units the draft coming up is audible
  eyesAt: 0.62,         // how far down the things that look up at you are
  // The fall itself.
  //
  // This used to be real gravity (3.27 wall-heights/s², one wall height being
  // three metres) and the drop took a second and a half. Physically correct and
  // completely wrong: a second and a half is long enough to watch yourself
  // falling, and watching yourself fall is not the same feeling as the floor
  // going. It is now about three times real gravity with a hard shove on the
  // first frame, the whole drop is over in a bit under six tenths of a second,
  // and it is fully black a fifth of the way in. Floor, nothing, bottom.
  gravity: 9.4,
  entryVel: 1.7,        // you are not let go of, you are dropped
  drift: 0.28,          // fraction of your walking speed you keep on the way down
  // The frame goes black almost at once. The torch is pointed at a wall that is
  // already moving past too fast to light, and then it is not pointed at
  // anything.
  darkFrom: 0.34,       // eye height, on the way down, where the dark starts
  darkTo: 0.02,         // ...and where there is nothing left to see by
  deadFor: 0.35,        // seconds at the bottom before the screen comes up
};

export const LIGHT = {
  ambient: 0.055,           // base visibility with the flashlight OFF (near black)
  ambientFlickerMin: 0.02,
  // Flashlight
  beamIntensity: 2.5,
  beamRadiusX: 0.66,        // fraction of screen width for the soft cone
  beamRadiusY: 0.8,         // generous vertically so the floor ahead is lit
  beamCoreFalloff: 1.5,     // higher = tighter hotspot
  beamDistFalloff: 0.15,    // how fast the torch light dies with distance
  beamColor: [255, 244, 214], // warm fluorescent-ish white
  flashlightSwayAmount: 5.0,  // pixels of lazy beam sway
  flashlightSwaySpeed: 1.3,
};

export const FOG = {
  density: 0.2,             // exponential fog — the thing that makes it claustrophobic
  color: [7, 7, 9],         // fog resolves to near-black, faintly cool
};

export const POST = {
  vignette: 0.85,           // strength of edge darkening
  grain: 14,                // +/- luminance of the film grain
  scanlineDarken: 0.10,     // how much alternating rows are dimmed
  chromaShift: 1,           // px of RGB split for the VHS bleed (0 disables)
};

export const AUDIO = {
  masterVolume: 0.7,
  humVolume: 0.16,
  footstepVolume: 0.32,
  phantomFootstepVolume: 0.46,
  gunshotVolume: 0.85,
};

// Gore. Blood is now a set of archetypes (spray, drag, handprints, pooling
// streaks) rather than one splat generator, so a wall that has been used for
// something reads as a specific event rather than as texture noise.
export const DECALS = {
  bloodWallChance: 0.022,   // fraction of solid wall cells bearing a smear
  size: 128,                // decal resolution; walls are 64, blood gets detail
};

// Left-behind human objects. Objects arrive in small SCENES: a chair with
// papers around it, a box with a doll beside it. Clusters read as "someone was
// here"; single objects read as decoration.
//
// Density has been through both extremes. At 0.00025 you could walk ten minutes
// and see nothing man-made; at 0.038 every other room had junk in it and the
// building read as a warehouse rather than as abandoned. 0.012 is roughly one
// scene per eighty cells — far enough apart that finding one is an event.
export const PROPS = {
  cellChance: 0.012,        // fraction of open cells seeding a scene
  clusterMax: 3,            // objects per scene
  bloodyChance: 0.14,       // of those, how many are blood-soaked
  radius: 11,               // cells around the player we place/draw props within
  scale: 1.0,               // models are authored at real size; do not rescale
};

// The handgun. It is findable, it holds twelve rounds, and there is no reload —
// scarcity is the mechanic. Shooting the creature drives it off; it does not
// kill it, because nothing here can be killed.
export const GUN = {
  // Twenty seconds, not fifty-five. Nothing much can happen to you before you
  // have it, so a long dry opening is just a long dry opening.
  appearAfter: 16,          // seconds before it can spawn
  proximity: 0.9,           // how close you must get to pick it up (world units)
  // A hundred and ten seconds per placement was the reason finding the gun was
  // a coin flip: miss the one clink behind you and the next two minutes were
  // dead. It now gives up on a site quickly and puts another one behind you,
  // so the worst case is "it keeps following me until I turn round" rather
  // than "I walked for four minutes and found nothing".
  visibleFor: 42,           // seconds before a missed site is abandoned
  cueEvery: 7,              // seconds between "there is something over here" clinks
  cueGrowth: 0.28,          // each repeat waits this much longer than the last
  respawnAfter: 2.5,        // seconds between missed gun sites
  // The invitation becomes less ambiguous the longer it is ignored, but never
  // turns into a HUD marker. First the metal catches the torch, then footsteps
  // cross the player's path and stop at it, and only very late does the blood
  // around the weapon reveal the last few cells of the route.
  glintAfter: 9,
  glintFor: 0.7,
  footstepsAfter: 18,
  trailAfter: 28,
  progressLock: 0.8,        // getting this much closer makes the site persistent
  // From this placement on it stops caring about being out of your view cone
  // and starts appearing wherever it can, including in front of you.
  patienceRuns: 2,
  pickupScale: 2.6,         // the world pickup is scaled up to be findable
  magazine: 12,             // total rounds. That is all you get.
  fireInterval: 0.28,       // seconds between shots
  recoil: 1.0,              // viewmodel kick multiplier
  range: 26,                // world units
  hitRadius: 0.34,          // how forgiving the creature hitbox is
  stagger: 3,               // hits needed to drive the creature off
  maxHoles: 48,             // bullet-hole decals kept in the world
  maxShells: 24,            // spent casings kept on the floor
  // The gun never materialises where you can watch it materialise. It is placed
  // behind you, out of the view cone, so that finding it is something you did
  // rather than something the game handed you — but it is placed close, and it
  // keeps making a noise until you go and look.
  spawnMin: 3.0,
  spawnMax: 6.5,
  spawnBehind: 1.05,        // radians off your facing before a spot is eligible
  // Landmarks mark the spot they want it in. If one of those is within reach,
  // that wins over a random patch of corridor: the gun ends up in a room you
  // can describe, which is most of what makes it findable at all.
  anchorRadius: 16,
};

// Firing is loud, and the building is listening. A shot that hits nothing draws
// something toward the noise a few seconds later: a line of text, a sound, and
// then the thing itself, walking in from wherever it was.
export const NOISE = {
  replyDelay: [2.6, 4.4],   // seconds between the shot and the answer
  // ...and then a second gap between the answer and the thing itself.
  //
  // These used to be the same beat: the line appeared and the hunter was placed
  // in the corridor on the same frame, which turned "it knows where you are"
  // into a spawn notification — you read the words and then immediately looked
  // at the thing the words were about, and there was nothing left to dread.
  // Now the building tells you, and then makes you wait for it. The wait is
  // where the sentence does its work.
  arriveAfter: [4.0, 7.5],
  cooldown: 26,             // seconds before a second shot can summon again
  approachFrom: 11,         // where it comes in from, world units
  approachTo: 16,
  dread: 0.09,              // what the answer costs you
  lines: [
    'it heard you',
    'something is coming',
    'it knows where you are',
    'that was a mistake',
  ],
};

// The creature. It is no longer a sprite that politely deletes itself when you
// look at it: it walks, it stops when watched, and past a dread threshold it
// will run you down.
export const CREATURE = {
  height: 2.4,              // metres, for reference — see creature.js
  // The whole chase hangs on these two numbers. Unwatched it moves a little
  // slower than your 2.4, so walking a straight line holds it off but never
  // shakes it; the instant you look at it, it drops to a crawl. Looking back
  // therefore costs you the ground you were making — which is the decision the
  // creature exists to force. (At its original 0.62 it could never reach a
  // player who was walking, and so nothing ever happened.)
  walkSpeed: 2.15,          // units/sec when you are not looking at it
  watchedSpeed: 0.05,       // it does not fully freeze; that is worse
  // Charging is OFF. It never runs at you; it only ever walks, and the pressure
  // comes from the fact that walking is enough. The whole code path is still
  // here behind this flag for when the gun starts making it angry.
  canCharge: false,
  chargeSpeed: 3.1,         // faster than you. You cannot outrun a charge.
  chargeFrom: 0.34,         // dread required before it will charge
  chargeDistance: 8.5,      // range at which a charge can start
  chargeChance: 0.22,       // per re-roll
  chargeRollEvery: 2.2,     // seconds between charge rolls while in range
  // The twitch. Every so often the whole body stutters for a fifth of a second
  // — the head snaps to one side and stays there, the limbs judder — and then
  // it carries on walking as if nothing happened. It does this more when you
  // are watching it, and more when it is close.
  twitchEvery: [1.6, 5.0],  // seconds between fits
  twitchDur: [0.09, 0.30],  // how long one lasts
  twitchRate: 46,           // rad/s of the judder; ~7 Hz, fast enough to be wrong
  spawnMin: 7.0,
  spawnMax: 13.0,
  despawnDistance: 24,      // lost you completely
  lifetime: 46,             // seconds before it gives up and melts away
  breathDistance: 9.0,      // within this it is audible
  hitKnockback: 1.5,        // units it recoils per bullet
  scareDuration: 1.35,      // how long the caught-you face fills the screen
  // It does not stand there and let you inspect it. Well before it is close
  // enough to read, the frame slams black and you are left deciding whether it
  // was ever in front of you. This has gone 1.15 -> 2.4 -> 4.4 (thirteen
  // metres) and every step improved it, for the same reason each time: a
  // monster you can get a good look at is a model. It should always be leaving
  // one beat before you were ready.
  vanishDistance: 4.4,
  // How it goes is no longer a single black flash — see STUTTER.
};

// How things leave.
//
// A single half-second fade to black was too polite for something that had been
// standing in the corridor looking at you. Everything that vanishes now takes
// the torch with it on the way out: three or four hard cuts to black with
// uneven lit gaps between them, like a battery going, and the thing is gone
// somewhere in the middle of them — so you get one or two frames of it still
// being there before the last cut, and then it is not.
export const STUTTER = {
  // These ranges are deliberately enormous. Narrow ones gave every blackout
  // roughly the same length and every gap roughly the same length, and a torch
  // that fails on an even rhythm does not read as a torch failing — it reads as
  // an effect. The durations are also gamma-shaped (see _startStutter): most
  // segments land near the short end and one or two in a sequence are long
  // enough that you think it is over and start moving again.
  darkFor: [0.04, 0.62],    // one blackout
  litFor: [0.025, 0.34],    // ...and the flicker of light between two of them
  gamma: 2.1,               // >1 biases both toward the short end
  counts: [3, 7],           // how many blackouts one exit is worth
  hideAfter: 0.4,           // fraction of the way through that it disappears
  finalDark: 1.5,           // the last blackout is this much longer
};

// Events that only exist inside a landmark, fired the first time you walk into
// one. A room you recognise should not be a safe room.
export const LANDMARK_EVENTS = {
  cooldown: 22,             // seconds before another landmark can fire one
  // Which room does what. `eyes` counts pairs; `delay` is how long you get to
  // stand in the room before it happens.
  ward:   { kind: 'ranks',  eyes: 6, delay: [1.2, 2.6] },
  atrium: { kind: 'circle', eyes: 5, delay: [1.8, 3.4] },
  shaft:  { kind: 'below',  eyes: 3, delay: [1.0, 2.2] },
  combs:  { kind: 'lattice', eyes: 8, delay: [2.0, 4.0] },
  chapel: { kind: 'altar',  eyes: 1, delay: [1.4, 2.8] },
};

// The caught-you jumpscare. `enabled` is the small creature — off, because it
// never catches you anyway. `hunter` is the thing that comes after you fire the
// gun, and that one absolutely does.
//
// The hunter's is now terminal. It used to cut away, break your torch for a few
// seconds and put you back on your feet, which meant the worst thing in the
// building was survivable and therefore, after the first time, an inconvenience.
// It ends the session. That is the whole difference between a thing that is
// chasing you and a thing that is following you around.
export const JUMPSCARE = {
  enabled: false,
  hunter: true,
};

// THE HUNTER — what answers the gun.
//
// Fire once and the building stops sending the thin one. This is bigger (2.9 m
// under a 3 m ceiling, so it has to fold), darker, four-armed, and unlike the
// creature it does not vanish and it does not lose interest. It arrives slowly,
// then matches your pace, then — once it is close — it runs, and it is much
// faster than you. That is what the sprint is for, and the sprint runs out.
export const HUNTER = {
  approachSpeed: 1.35,      // it takes its time getting to you
  paceSpeed: 2.5,           // ...and then it is exactly your speed
  catchUpFrom: 6.0,         // beyond this it is allowed to move faster than you
  catchUpMax: 0.55,         // ...by up to this fraction, so a maze cannot lose it
  chargeSpeed: 5.4,         // and then it is not. The old charge was 3.1.
  paceAfter: 7.0,           // seconds of slow approach before it matches you
  // It only runs from close. At 5.5 it was starting its charge from most of the
  // way down a corridor, which gave you the whole run-up to react to and made
  // the sprint a routine answer rather than a panic. From three metres there is
  // no thinking about it.
  chargeFrom: 3.2,
  // How close it has to get before the game tells you to run and hands you the
  // sprint. Not on spawn: on spawn it is a shape at the far end of a hall and
  // the word "run" is noise. This is the distance at which it stops being that.
  runPromptAt: 9.0,
  chargeWindUp: 0.45,       // it stops dead, and then it goes
  chargeMinGap: 5.0,        // seconds before it can try again after a failed run
  catchDistance: 1.05,
  // It walks. Every unit of ground it covers turns the gait by this much, so the
  // legs are locked to the floor instead of cycling on a timer while the body
  // slides — the single most obvious tell that a thing is not really walking.
  strideRate: 3.9,
  spawnMin: 9.0,
  spawnMax: 14.0,
  stepDistance: 30,         // audible from three times as far as the creature
  breathDistance: 14.0,
  eyeFalloff: 0.055,        // near-flat, so the eyes carry across a whole hall
  lifetime: 95,
  despawnDistance: 40,
  hitKnockback: 1.1,
  stagger: 4,               // hits to drive it off. You have twelve rounds.
  // Longer than it was, because this is now the last thing that happens to you
  // rather than a beat you recover from. It has to outstay its welcome.
  scareDuration: 2.2,
  // The fits are half again as long as they were and come about twice as often,
  // and because the jitter is applied per limb the knees judder out of phase
  // with each other.
  //
  // twitchEvery is a period between fit STARTS, not a gap between them, which
  // is the trap here: set it below twitchDur and the fits overlap, the thing
  // convulses without pause at every range, and a convulsion that never stops
  // is just how the model looks. At a distance it is now in a fit around three
  // fifths of the time and settles in between; inside about four metres the
  // proximity term closes the period below the duration and it never settles
  // again. The contrast is the scare — the stillness is what the fits are
  // measured against.
  twitchEvery: [0.42, 1.50],
  twitchDur: [0.18, 0.74],
  // Past the point where you can follow the individual frames. Deliberate: a
  // judder you can count is a machine, and a judder you cannot is something
  // wrong with the animal.
  twitchRate: 83,
  // How hard the head snaps off-axis during a fit. Roughly a hundred degrees —
  // it looks at things that are not you, very fast, and then looks back.
  snapAmount: 2.6,
};

// Horror director — randomized timers with cooldowns and slow escalation.
export const HORROR = {
  dreadPerSecond: 0.0060,   // baseline creep of tension over a session
  dreadMax: 1.0,
  seenAngle: 0.62,          // "you are looking at it": roughly the half-FOV
  // Each event: [minDelay, maxDelay] seconds between attempts, and a cooldown.
  events: {
    phantomSteps: { min: 12, max: 28, cooldown: 18 },
    flicker:      { min: 16, max: 40, cooldown: 22 },
    // Rare. It showing up every half-minute made it furniture; at one or two
    // sightings in a long session it stays an event. Firing the gun still
    // summons it directly, which is the one reliable way to meet it.
    creature:     { min: 70, max: 150, cooldown: 55 },
    redEyes:      { min: 14, max: 34, cooldown: 14 },
    anomaly:      { min: 34, max: 76, cooldown: 40 },
    whisper:      { min: 24, max: 62, cooldown: 18 },
    distant:      { min: 20, max: 55, cooldown: 16 },
  },
};

// How close anything the building shows you is allowed to get before the light
// takes it away.
//
// Everything in this game is better at eleven metres than at four. A pair of
// red points at the end of a corridor is a question; the same pair close enough
// to resolve into a face is an answer, and the answer is always less than the
// question was. So instead of waiting out its timer, an apparition now checks
// how far away you are, and if you have started closing on it the torch fails
// and it is not there when the light comes back. Walking toward one of these is
// the fastest way to make it leave.
export const KEEP_AWAY = {
  eyes: 8.0,        // the single pair down the corridor
  swarm: 1.0,       // how much closer you may get to a swarm pair before it leaves
  crowd: 0.24,      // touching a body breaks the formation; the centre aisle is safe
  ritual: 7.0,      // whatever the landmark events put in the room
};

// Spatial anomalies. Two of these (fog, silence) existed; the other four are
// new. Each has a dread gate so the session escalates from "the air got thick"
// to "there are twelve of them standing in the corridor".
export const ANOMALIES = {
  fog:       { gate: 0.10, weight: 3, dur: [3.5, 5.5] },
  silence:   { gate: 0.10, weight: 3, dur: [4.0, 6.5] },
  swarm:     { gate: 0.22, weight: 2, dur: [4.0, 6.0] },  // eyes open all around you
  // Redshift is never drawn from the random anomaly bag. The director starts it
  // shortly before an arrival, charge, or landmark ritual, so the colour
  // becomes a warning the player can learn instead of an unrelated filter.
  redshift:  { gate: 0.30, weight: 0, dur: [4.4, 5.2], lead: 2.4, chargeLead: 1.8 },
  blackout:  { gate: 0.38, weight: 2, dur: [3.4, 5.0] },  // the torch dies completely
  crowd:     { gate: 0.46, weight: 1, dur: [8.0, 11.0], joinFor: 1.25 },
};

// How it ends.
//
// There is no winning. There is only the particular way the building was done
// with you, and the point of writing them down is that after the first one you
// know there are others — the count is visible from the first death, the shapes
// of the ones you have not had are not.
//
// Order here is the order they are listed in. `id` is what goes in localStorage,
// so do not rename one without deciding what happens to saves that have it.
export const ENDINGS = [
  {
    id: 'fall',
    numeral: 'i',
    name: 'the drop',
    eyebrow: 'the floor was not there',
    title: 'you fell',
    note: 'it does not warn you about the holes. eight metres, and nothing came to look.',
  },
  {
    id: 'taken',
    numeral: 'ii',
    name: 'reached',
    eyebrow: 'it stopped walking',
    title: 'it had you',
    note: 'you were still carrying rounds. it turned out not to matter which of you was faster.',
  },
  {
    id: 'spent',
    numeral: 'iii',
    name: 'the twelfth',
    eyebrow: 'the hammer fell on nothing',
    title: 'it had you',
    note: 'twelve was all there ever was. it kept coming after the twelfth, the way it was always going to.',
  },
  {
    id: 'congregation',
    numeral: 'iv',
    name: 'the congregation',
    eyebrow: 'there was room beside them',
    title: 'you took your place',
    note: 'when the lights returned, one more figure was facing the plinth.',
  },
];

// Where the collected endings live between sessions.
export const SAVE_KEY = 'the-eerie-walk/endings';

// Development-only hotkeys. Flip enabled to false for a clean playtest/build.
export const DEBUG = {
  enabled: true,
  keys: {
    hunter: 'Digit6',
    redEyes: 'Digit7',
    creature: 'Digit8',
    gun: 'Digit9',
    anomaly: 'Digit0',
  },
};
