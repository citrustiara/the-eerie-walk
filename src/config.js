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
  // A wall height is three metres, so 9.81 m/s² is 3.27 wall-heights/s². From
  // eye height to the bottom is 3.1 wall heights, making this a roughly
  // 1.38-second fall. There is no artificial downward shove: you leave the edge
  // from rest vertically and retain the horizontal momentum you walked in with.
  gravity: 3.27,
  entryVel: 0,
  drift: 1.0,
  // The shaft fades out as the torch and floor recede rather than cutting to
  // black almost immediately.
  darkFrom: 0.34,       // eye height, on the way down, where the dark starts
  darkTo: -0.70,        // ...and where there is nothing left to see by
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
  // Inside ten units the nearest pursuer nudges the hand-held beam away from
  // its bearing. At full stress this is still only a few low-res pixels: a
  // flinch, not a pointer.
  flashlightThreatFlinch: 9.0,
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
  threatVignette: 0.20,     // extra edge darkening on the pursuer's side
  threatGrain: 0.55,        // ...and local grain there, both scaled by stress
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

  // ...and what happens on the walls of the rooms that were drawn by hand.
  //
  // A flat 2.2% everywhere with the archetype rolled from fixed weights meant
  // the six events blood can record were scattered uniformly across an infinite
  // building — so the tally, the one archetype that says a PERSON was in here
  // for a long time, came up once in twenty-one smears at a random spot in a
  // random corridor and meant nothing wherever it landed. Inside a landmark the
  // wall is much more likely to be marked, and it is marked with the thing that
  // happened in that particular room:
  //
  //   ward    handprints and drag. People were moved down that corridor, and
  //           some of them held on to the walls on the way.
  //   chapel  tally. Somebody knelt in here and counted, and this is now the
  //           only place in the building you will ever see them do it.
  //   shaft   soak, running down toward the hole it all went into.
  //   atrium  spray, thrown across the faces of the core.
  //   combs   nothing. Not "less" — nothing. It is the one room whose horror is
  //           that there is no mark anywhere in it to tell one row from the
  //           next, and a smear would be a landmark inside the landmark.
  landmark: {
    ward:   { chance: 0.15, kinds: ['handprints', 'drag'], age: [0.0, 0.42] },
    chapel: { chance: 0.13, kinds: ['tally'], age: [0.45, 1.0] },
    shaft:  { chance: 0.11, kinds: ['soak'], age: [0.1, 0.6] },
    atrium: { chance: 0.07, kinds: ['spray'], age: [0.3, 0.8] },
    combs:  { chance: 0, kinds: [], age: [0, 1] },
  },
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
  progressLock: 0.8,        // getting this much closer earns more search time
  committedFor: 70,         // ...but can never strand the gun for a whole run
  // From this placement on it stops caring about being out of your view cone
  // and arrives almost directly ahead during a flashlight failure.
  patienceRuns: 2,
  pickupScale: 2.6,         // the world pickup is scaled up to be findable
  magazine: 12,             // total rounds. That is all you get.
  fireInterval: 0.28,       // seconds between shots
  refusalPitch: 285,        // look this far down before a held trigger turns inward
  refusalHold: 1.35,        // deliberate hold before the choice is committed
  refusalRelease: 2.8,      // how quickly a cancelled hold lowers the gun again
  refusalDeathDelay: 0.72,  // report, flash, then black before the ending card
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
  // After `delay` the room is ready, but it does not go off into the back of
  // your head. It waits for you to be facing enough of the formation for the
  // formation to read as one — see _fireRitual — and only after this many more
  // seconds does it stop waiting and take whatever it can get. Long enough to
  // turn round in; short enough that a room never feels like it owes you.
  patience: 6.0,
  // Leave the room before it fires and it does not fire. The event is not spent,
  // the landmark is not burned, and it is still there the next time you are.
  // Measured from the block centre, in cells — a shade past the corner of a
  // 14-cell block, so standing in the doorway still counts as being in it.
  holdWithin: 10.5,
  // Which room does what. `eyes` counts pairs; `delay` is how long you get to
  // stand in the room before it is ready.
  ward:   { kind: 'ranks',  eyes: 6, delay: [1.2, 2.6] },
  atrium: { kind: 'circle', eyes: 5, delay: [1.8, 3.4] },
  shaft:  { kind: 'below',  eyes: 3, delay: [1.0, 2.2] },
  combs:  { kind: 'lattice', eyes: 8, delay: [2.0, 4.0] },
  chapel: { kind: 'altar',  eyes: 1, delay: [1.4, 2.8] },
};

// What a landmark does when you walk into it.
//
// The problem this solves is that you could stand in the middle of a room that
// was drawn by hand and have no way of knowing. Shape is the hardest channel to
// read at 480x270 through fog at eye level, and it was the only channel a
// landmark had.
//
// THERE IS NO COUNTER, AND THERE WILL NOT BE. "1 of 5 found" would turn the best
// rooms in the building into collectibles and the walk into an errand. Two tiers
// instead, and neither of them is a number:
//
//   FIRST TIME — no words at all. The building stops for a beat: the mix ducks,
//   the fog thins a shade so you can see further into the room than you could a
//   moment ago, and the room plays its own note, quietly. That note is the SAME
//   instrument its ritual uses, so the two get learnt as one thing and the entry
//   becomes an omen for the event.
//
//   SECOND TIME, and only the second, and only once per kind of room — one line.
//   Not "you found a landmark": something about having been here before. The
//   horror of this building is recognition, not collection, and world.js has
//   said so from the start — knowing where you are is much worse than not
//   knowing. The line is the moment that lands.
export const LANDMARK_VOICE = {
  hushFor: 1.35,            // seconds the room holds its breath
  hushFog: 0.34,            // ...and how far the fog opens while it does
  duckTo: 0.26,             // master gain during the hush
  duckHold: 0.55,
  noteVolume: 0.16,         // the room's own sound, well under its ritual
  // A beat before the words. Walking through a doorway and being handed text on
  // the same frame reads as a trigger volume; a second and a half later reads as
  // something occurring to you.
  lineAfter: [1.3, 2.1],
  lines: {
    ward:   'the same six doors',
    atrium: 'you have walked around this before',
    shaft:  'it is the same drop',
    combs:  'this row is the row you came down',
    chapel: 'it was built to be walked down',
  },
};

// Diegetic guidance toward rituals. The same five sounds used when the pistol
// lands in a landmark recur occasionally after the weapon is no longer asking
// for attention. Some phantom-step events also cross the player and continue
// toward the target, using the gun guide's existing machinery.
export const RITUAL_GUIDE = {
  radius: 84,               // effectively always finds the nearest unused room
  footstepRadius: 38,       // a walking cue must finish before it becomes a loop
  firstAfter: [32, 48],
  cueEvery: [38, 62],
  busyRetry: [8, 14],
  phantomChance: 0.42,
  maxSteps: 34,
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
  // These two are APPROACH distances, not ranges — how much closer you may get
  // to the nearest of them than you were when they appeared. The ritual entry
  // used to be a flat range of 7.0, which every one of these events was already
  // inside on the frame it fired (the ranks start four metres away), so nothing
  // ever ran its own timer out. Same mistake and same fix as `swarm` above.
  ritual: 2.6,
  altar: 1.7,       // the chapel pair is one big thing; you may get nearer to it
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
  crowd:     {
    gate: 0.46, weight: 1, dur: [8.0, 11.0], joinFor: 1.25,
    // Twenty-two cells plus "unused only" made this ending disappear as soon as
    // the nearby rooms had been explored. A congregation can reuse a landmark:
    // the route and the missing place are the event, not the ritual's freshness.
    targetRadius: 48,
  },
};

// GRACE — the only thing in the game that is not the building winning.
//
// It rises from WITNESSING: staying with something the building shows you until
// it is finished with you, rather than leaving or walking into it. Everything
// else in here escalates; this is the one number that goes the other way, and
// the player is never shown it.
//
// The gun destroys it. Not reduces — destroys, permanently, on the first round.
// That is the whole point of having it: twelve rounds already summon something
// worse, and now they also close the only door out, so the weapon becomes a
// decision you make once and live inside rather than a resource you spend.
export const GRACE = {
  // FOUR witnessed rituals, exactly. This was 0.24 — five rituals' worth — and
  // the measured runs were the argument against it: a bot that did everything
  // right four times sat at 0.96 for another four minutes waiting for a fifth
  // landmark it never found, which is the worst number in the range. Four is
  // already a real commitment at one landmark every minute or two plus the 22 s
  // cooldown between events, and it is a promise the map can actually keep.
  perRitual: 0.25,
  // ...and it only counts if you actually stood there for it. Cumulative
  // seconds of not moving while the ritual is up, or 55% of its life, whichever
  // is less — so a short one is not unfairly strict and you may still shift your
  // feet. Walking away while it happens to finish behind you is worth nothing.
  witnessFor: 3.4,
  // Watching the creature is currently pure cost: it slows to a crawl while you
  // look at it, and looking at it is ground you do not make. This is the payoff.
  // You have to be still, it has to be close, and it has to be in your cone.
  stareRange: 10.0,
  stareFor: 3.0,            // seconds of continuous held stare per award
  perStare: 0.07,
  stareCap: 0.28,           // ...and this is all staring will ever be worth
  // The tell. There is no meter: the building simply gets quieter as this rises,
  // and the frame goes a shade colder. Redshift means something is coming, and
  // players who learn that will read this without being told.
  calmFog: 0.10,            // fraction of the fog it thins at full grace
  calmTint: 0.07,           // how far toward cold the grade goes
};

// WITNESSING — how the building tells you what it wants, without telling you.
//
// The rule that opens the sixth ending is that you stop moving and let a thing
// finish. That rule was, until this block existed, completely invisible: grace
// is never shown, the award was silent, and the only feedback in the game was a
// tenth of the fog thinning over four minutes. A player who never happened to
// stand still through a ritual could not have deduced the mechanic from
// anything on screen, which makes the best ending an accident rather than a
// decision — and an accident is not worth having.
//
// THE FIX IS NOT A TUTORIAL AND IT IS NOT A METER. Landmarks already solved
// this exact problem once, and the answer is in LANDMARK_VOICE: a wordless tier
// that happens EVERY time, and a spoken tier that happens once, late, and is an
// observation rather than an instruction. Same two tiers here.
//
//   WHILE IT IS HAPPENING — the fog opens, slowly, for as long as you are
//   standing still, and closes when you move. That is the whole teaching
//   mechanism and it is one number. The player has already been taught this
//   sentence twice: the fog opens when you walk into a landmark (hushFog) and
//   it is thinner the more grace you have (calmFog). Opening it a third time,
//   under the one behaviour that earns the ending, finishes the association —
//   the air gives when you do, and it is the only thing in the building that
//   ever gives. Nobody has to be told they are doing it, because they can see
//   it happen and they can see it stop.
//
//   ONCE IT HAS HAPPENED — the room plays its own note. The same note it played
//   when you walked in and the same instrument its ritual just used, so the
//   third hearing of it lands as "that was the room" rather than as a reward
//   sound. There are no reward sounds in here.
//
//   AND THEN, TWICE, EVER — two lines. One when you let a ritual finish without
//   standing for it, which is the diagnosis, and one when you have banked two,
//   which is the confirmation. In that order for most players, which is the
//   right order: you find out something was on offer, and then you find out
//   what it was.
export const WITNESS = {
  // How far the fog opens at a full hold, and how long the hold takes to get
  // there. Slower than the landmark hush on purpose — that one is a beat and
  // this one is a decision, and you should be able to feel it still opening
  // while you wonder whether to stay.
  fog: 0.30,
  openIn: 2.2,              // seconds of standing still to reach full
  closeIn: 0.45,            // ...and how fast moving shuts it again

  // A breath under it, at the point the hold has clearly become deliberate.
  // Quiet enough that it is the room and not a chime.
  noteAfter: 1.5,
  noteVolume: 0.075,

  // The room answering, once, at the moment the thing is banked.
  bankNote: 0.19,
  bankDuck: 0.34,

  // THE AIR, BEFORE THERE IS A DOOR. Past this much grace the building starts
  // moving air somewhere you cannot place — the door's own cue, with no
  // direction on it and nothing at the end of it yet. It is guidance in the
  // only honest sense: it tells you something is close without telling you
  // where, and when a door finally does turn up it announces itself with the
  // sound you have already spent a minute failing to locate.
  airAt: 0.72,
  airEvery: [9, 16],
  airVolume: 0.055,

  // Same register as LANDMARK_VOICE.lines: lower case, observational, and never
  // an instruction. "Stand still" would be worth more to a player and cost the
  // whole game.
  lineAfter: [1.2, 2.0],
  lines: {
    missed: 'it finished without you',
    kept: 'it was waiting for you to stop',
    // Fired the once, on the round that closes the way out. Without this the
    // most consequential decision in the game has no feedback whatsoever.
    spent: 'the air has stopped moving',
  },
};

// THE DOOR — what the building offers you instead of a gun.
//
// Deliberately the same machinery as GUN above: placed out of your view cone,
// close, announcing itself, with the cues escalating the longer it is ignored.
// If you found the pistol you already know how to find this, and the fact that
// the two arrive the same way is the point.
export const DOOR = {
  proximity: 0.85,          // how close you must get before you are through it
  cueEvery: 6.5,            // seconds between draughts
  cueGrowth: 0.22,
  glowAfter: 5,             // seconds before the light under it is visible
  trailAfter: 22,           // ...and before the air starts moving down the route
  anchorRadius: 18,         // a landmark that has marked a spot wins, as ever
  spawnMin: 4.0,
  spawnMax: 8.0,
  spawnBehind: 1.05,        // radians off your facing before a spot is eligible
  respawnAfter: 3.0,        // seconds before an unreachable site is moved
  visibleFor: 60,           // ...and how long it waits before giving up on one
  scale: 1.0,
};

// OUTSIDE — where the door goes.
//
// Not a corridor with the lights on. Wet ground, a treeline, a sky going pale,
// and a seven-metre building wall behind you with the wallpaper still on it.
// It is one hand-built place, stamped far away from anywhere the walk can
// reach, and you arrive in it inside the same torch-failure the game uses for
// everything else that changes.
export const OUTSIDE = {
  // The region, in cells. It has to be bigger than the DDA can see (64 cells)
  // in every direction from anywhere you can stand, or you would be looking at
  // the seam where the building starts again.
  width: 200,
  height: 150,
  origin: [9000, 9000],     // far enough out that no walk will ever generate it
  wallDepth: 4,             // how thick the building's back wall is
  doorWidth: 2,

  // How far the eye goes once the fog stops holding it. The rest of the game
  // runs at 26 units, which is well past what 0.2 fog will show you; out here
  // the fog is a fifth of that and the clamp would be a visible ring on the
  // ground, so the view distance moves with it.
  viewDistance: 74,
  fogDensity: 0.034,
  // The fog colour IS the sky at the horizon. Everything that recedes has to
  // resolve to the same value the bottom of the sky does or the ground and the
  // air meet at a seam.
  horizon: [104, 112, 132],
  ambient: 0.92,            // you do not need the torch. That has never been true.

  openFor: 2.6,             // seconds for the fog to settle after you arrive
  torchOutFor: 3.2,         // ...and for the torch to become irrelevant and stop
  dawnFor: 20,              // the sky keeps going pale for this long
  // It ends when you have walked away from the door, or when you have stood
  // there long enough. Standing still and turning round is a legitimate way to
  // spend this — there is something behind you worth seeing.
  //
  // Thirteen units was the first number and it was far too few: a player who
  // simply held W was through the whole ending in five and a half seconds, with
  // the fog still opening and the sky not yet started. Twenty-six is about
  // eleven seconds of walking, which is long enough to have gone somewhere.
  walkFor: 26,              // units from the door
  holdFor: 40,              // ...or seconds, whichever comes first
  minHold: 6.5,             // and never before this, however fast you walk
  bleachFor: 2.4,           // the sky overexposing, which is the only white cut
                            // in a game where everything else ends in black

  // WHAT IS STANDING IN IT. See terrain.js for the ground itself; this is the
  // stuff on top of the ground, and there is a rule about all of it: nothing
  // out here was PUT here. Every object in the building is something a person
  // left behind, and every object in the field is something that grew, fell
  // over, or was fenced — the one exception being the fence, which is the only
  // evidence in the ending that anybody ever owned this and is worth having for
  // exactly that reason.
  //
  // Density is per cell, and it is low. The painted treeline does the far
  // distance (see skyTexture) and always will: what these are for is PARALLAX,
  // the one cue a painted horizon cannot give you. Three real trees between you
  // and the treeline tell the eye the treeline is half a mile away. Thirty of
  // them tell it you are in a wood, which is a different ending.
  field: {
    // Thirty-six, not forty-six. Past about a hundred metres a tree is a mark
    // three pixels wide and the painted treeline is already doing that job
    // better and for nothing; all the extra ten cells bought was a scattering
    // of specks between the real trees and the drawn ones, which read as dirt
    // on the screen rather than as distance.
    radius: 36,             // cells of field kept in the draw list at once
    nearLOD: 21,            // ...beyond which a tree is drawn as its own stump
    clearOfDoor: 5,         // nothing within this of where you are standing

    // SMALL THINGS DO NOT GET THE FULL RADIUS. A tree at forty-six cells is a
    // hundred and forty metres away and still eleven pixels tall; a clump of
    // grass at fourteen is already one. Culling the small stuff early is the
    // whole face budget — without these, most of what is in the draw list at
    // any moment is tussocks contributing a pixel each, and the count triples.
    reedRadius: 20,
    tussockRadius: 13,
    stoneRadius: 30,

    // Trees thin out toward the middle of the field and thicken toward the
    // edges of the region, which is where the painted line takes over. You walk
    // out of cover, not into it.
    treeChance: 0.0075,
    treeEdgeBoost: 2.4,     // ...multiplied by this at the far edge
    // A dead one standing in the water is worth four on dry land: it is the one
    // object out here that gives the flood a scale, and a bare trunk with its
    // reflection under it is the whole picture the ending is trying to make. So
    // this is a per-cell chance like the one above and it is twice as high,
    // over a much smaller area.
    drownedChance: 0.016,
    drownedDepth: [0.08, 0.62],
    maxWadeDepth: 0.10,     // a living tree will not stand deeper than this

    reedChance: 0.30,       // ...but only in the shallows, which is most of why
    reedDepth: [0.02, 0.26],// there are so few of them
    stoneChance: 0.006,     // ...and only on a real rise, or they are everywhere
    stoneAbove: 0.85,
    tussockChance: 0.010,
    tussockAbove: 0.02,

    // The fence. One line of it, running across the field rather than out of
    // the door, so it crosses your walk instead of leading it — a fence you can
    // follow is a corridor, and there has been enough of that.
    //
    // NEAR, AND SHORT. At thirty-one cells it sat exactly on the horizon and
    // came out as an evenly spaced row of one-pixel sticks, which the chromatic
    // fringing in the post chain then turned green and magenta — a picket line
    // of fairy lights across the last shot of the game. Twelve puts it between
    // you and the water, big enough to read as made of wood, and close enough
    // that you go through it rather than looking at it.
    fenceOut: 12,           // cells from the wall, at the doorway
    fenceSpan: 34,          // half-length, in cells: a run, not a boundary
    fenceEvery: 1.6,        // cells between posts — see fencePost, which draws
                            // its own wire this far and no further
  },
};

// How it ends.
//
// There is no winning. There is only the particular way the building was done
// with you — except once, and the sixth is not a win either: nothing is
// following you any more, and that is all anyone can tell you.
//
// The point of writing them down is that after the first one you know there are
// others — the count is visible from the first death, the shapes of the ones you
// have not had are not.
//
// Order here is the order they are listed in. `id` is what goes in localStorage,
// so do not rename one without deciding what happens to saves that have it.
// Appending is safe: an old save keeps everything it had and the total it is
// counted against goes up by one.
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
  {
    id: 'refusal',
    numeral: 'v',
    name: 'the refusal',
    eyebrow: 'you chose what would reach you',
    title: 'it was still there',
    note: 'the building continued around the place you had been.',
  },
  {
    id: 'outside',
    numeral: 'vi',
    name: 'the door',
    eyebrow: 'there was air moving',
    title: 'you got out',
    note: 'wet ground, a treeline, a sky going pale. nothing on it, no road — and the wallpaper did not stop at the outside wall.',
  },
];

// Where the collected endings live between sessions.
export const SAVE_KEY = 'the-eerie-walk/endings';

// Development-only hotkeys. Flip enabled to false for a clean playtest/build.
export const DEBUG = {
  enabled: true,
  keys: {
    door: 'Digit5',
    hunter: 'Digit6',
    redEyes: 'Digit7',
    creature: 'Digit8',
    gun: 'Digit9',
    anomaly: 'Digit0',
  },
};
