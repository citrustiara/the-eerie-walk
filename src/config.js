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
  streetSpacing: 7,     // every Nth row/col of cells is a guaranteed-open street
  wallThreshold: 0.58,  // fBm value above which a non-street cell becomes solid
  noiseScale: 0.18,     // how zoomed-in the room/wall noise is
  cellSize: 1.0,        // world units per cell (kept 1 for simple math)
  wallHeight: 1.0,
};

export const PLAYER = {
  radius: 0.18,         // collision radius against walls
  walkSpeed: 2.4,       // units / second
  // A touch of urgency is fine, but no sprinting — dread likes a slow pace.
  mouseSensitivity: 0.0022,
  maxPitch: 220,        // clamp for vertical look, in screen pixels of horizon shift
  bobFrequency: 9.2,    // head-bob speed while walking
  bobAmount: 2.6,       // head-bob vertical pixels
  eyeHeight: 0.5,       // 0..1 within the wall height
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
};

// Gore + left-behind objects — rare "someone was here" sights. Kept rarer than
// the entity itself; rarity is the whole point.
export const DECALS = {
  bloodWallChance: 0.002,   // fraction of solid wall cells bearing a blood smear
};

export const PROPS = {
  cellChance: 0.00025,      // fraction of open cells holding a left-behind object
  bloodyChance: 0.08,       // of those, how many are blood-soaked
  radius: 14,               // cells around the player we place/draw props within
  scale: 0.62,              // found objects should feel human-sized, not furniture-sized
};

// The handgun: a single findable item that only appears deep into a session,
// lying in blood. Picking it up currently just sets a flag (no mechanics yet).
export const GUN = {
  appearAfter: 180,         // seconds before it can spawn (~3 minutes)
  proximity: 0.7,           // how close you must get to pick it up (world units)
  visibleFor: 22,           // missed guns vanish quickly instead of lingering
  respawnAfter: 5,          // seconds between missed gun sites
  pickupScale: 0.42,        // scale of the gun lying in the world
};

// Horror director — randomized timers with cooldowns and slow escalation.
export const HORROR = {
  dreadPerSecond: 0.0020,   // baseline creep of tension over a session
  dreadMax: 1.0,
  silhouetteMiss: {
    unseenLife: 7.0,        // unseen figures give up quickly
    escapeDistance: 6.4,    // if you are this far away, count it as a missed sighting
    respawnMin: 2.5,
    respawnMax: 5.0,
    seenAngle: 0.62,        // roughly the horizontal half-FOV
  },
  // Each event: [minDelay, maxDelay] seconds between attempts, and a cooldown.
  events: {
    phantomSteps: { min: 14, max: 34, cooldown: 22 },
    flicker:      { min: 18, max: 48, cooldown: 25 },
    silhouette:   { min: 8, max: 18, cooldown: 9 },
    redEyes:      { min: 14, max: 34, cooldown: 14 },
    anomaly:      { min: 70, max: 160, cooldown: 90 },
    whisper:      { min: 30, max: 75, cooldown: 20 },
  },
};

// Development-only hotkeys. Flip enabled to false for a clean playtest/build.
export const DEBUG = {
  enabled: true,
  keys: {
    redEyes: 'Digit7',
    silhouette: 'Digit8',
    gun: 'Digit9',
  },
};
