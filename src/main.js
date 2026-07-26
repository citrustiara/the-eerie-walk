// main.js — bootstrap + game loop. Wires the modules together and owns the
// per-frame orchestration: input -> player -> director -> renderer.

import { World } from './world.js';
import { setNoiseSeed } from './noise.js';
import { generateTextures } from './textures.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Director } from './director.js';
import { makeRng } from './mathutils.js';
import { Props } from './objects.js';
import { buildMeshes } from './models.js';
import { AUDIO, LIGHT, FOG, GUN, PIT, DEBUG } from './config.js';

const canvas = document.getElementById('screen');
const reticle = document.getElementById('reticle');
const gunHint = document.getElementById('gun-hint');
const hud = document.getElementById('hud');
const ammoCount = document.getElementById('ammo-count');
const ammoPips = document.getElementById('ammo-pips');
const subtitle = document.getElementById('subtitle');
const stamina = document.getElementById('stamina');
const staminaFill = document.getElementById('stamina-fill');
const overlay = document.getElementById('overlay');
const overlayEyebrow = document.getElementById('overlay-eyebrow');
const overlayTitle = document.getElementById('overlay-title');
const overlayNote = document.getElementById('overlay-note');
const overlayAction = document.getElementById('overlay-action');

// --- Session seed: a fresh layout and event timeline every load -------------
const seed = (Math.random() * 0xffffffff) >>> 0;
setNoiseSeed(seed);
const rng = makeRng(seed ^ 0x9e3779b9);

const world = new World();
const textures = generateTextures();
const renderer = new Renderer(canvas, textures, buildMeshes());
const player = new Player(world);
const input = new Input(canvas);
const audio = new AudioEngine();
const director = new Director(audio, player, world, rng);
const props = new Props(world);

let running = false;     // pointer locked + playing
let gunEquipped = false;
let dead = false;        // the building got you. Only a hole can do this.

// --- Ammo readout -----------------------------------------------------------
// Twelve pips plus a number. The pips going out one at a time is the whole
// pressure curve of the second half of a session.
for (let i = 0; i < GUN.magazine; i++) {
  const pip = document.createElement('span');
  pip.className = 'pip';
  ammoPips.appendChild(pip);
}
function renderAmmo(n) {
  ammoCount.textContent = String(n).padStart(2, '0');
  const pips = ammoPips.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].classList.toggle('spent', i >= n);
  }
  hud.classList.toggle('empty', n === 0);
  hud.classList.toggle('low', n > 0 && n <= 3);
}
renderAmmo(director.ammo);

function showGunHint(text) {
  gunHint.textContent = text;
  gunHint.classList.add('visible');
}
function hideGunHint() {
  gunHint.classList.remove('visible');
}

// One line, low on the screen, held long enough to read twice.
let subtitleTimer = 0;
function showLine(text) {
  clearTimeout(subtitleTimer);
  subtitle.textContent = text;
  subtitle.classList.add('visible');
  subtitleTimer = setTimeout(() => subtitle.classList.remove('visible'), 4200);
}

input.onToggleFlashlight = () => player.toggleFlashlight();
input.onSelectGun = () => {
  if (!director.hasGun || gunEquipped) return;
  gunEquipped = true;
  reticle.classList.add('visible');
  hud.classList.add('visible');
  hideGunHint();
  audio.playGunReady();
};
input.onFire = () => {
  if (!running) return;
  if (!gunEquipped) return;
  if (director.shoot()) renderer.punch();
};
input.onDebugSpawn = DEBUG.enabled ? (kind) => {
  if (kind === 'hunter') { director.debugSpawn(kind); return; }
  const spawned = director.debugSpawn(kind);
  if (kind === 'gun' && spawned) {
    gunEquipped = false;
    reticle.classList.remove('visible');
    hud.classList.remove('visible');
    renderAmmo(director.ammo);
    hideGunHint();
  }
} : null;

director.onGunPickup = () => {
  audio.playGunPickup();
  showGunHint('press 1 to pull out the gun');
};
director.onAmmoChange = (n) => {
  renderAmmo(n);
  if (n === 0) {
    showGunHint('empty');
    setTimeout(hideGunHint, 2600);
  }
};
director.onCaught = () => {
  document.body.classList.add('caught');
  setTimeout(() => document.body.classList.remove('caught'), 1400);
};
director.onLine = showLine;

// --- Going in a hole --------------------------------------------------------
// The only thing in the building that actually kills you. The creature catches
// you and lets go; the hunter catches you and lets go; the floor does not.
player.onFall = () => {
  hideGunHint();
  subtitle.classList.remove('visible');
  audio.playFallRush();
  audio.setBreath(0);
  audio.setHeartbeat(0);
};

player.onLand = () => {
  // Stop the loop on the frame you land rather than when the screen comes up.
  // The frame is already fully black by then, so nothing visibly changes — but
  // it means the director cannot spend the beat before the death screen firing
  // a whisper at a corpse.
  running = false;
  audio.playFallImpact();
  audio.duck(0, 0.9);
  setTimeout(showDeath, PIT.deadFor * 1000);
};

function showDeath() {
  dead = true;
  running = false;
  document.exitPointerLock();
  reticle.classList.remove('visible');
  hud.classList.remove('visible');
  stamina.classList.remove('visible');
  overlay.classList.add('dead');
  overlayEyebrow.textContent = 'the floor was not there';
  overlayTitle.textContent = 'you fell';
  overlayNote.textContent = 'the building has holes in it and it does not warn you '
    + 'about them. it was eight metres. nothing came to look.';
  overlayAction.textContent = 'click to wake up somewhere else';
  overlay.classList.remove('hidden');
}
director.onSprintUnlock = () => {
  player.sprintUnlocked = true;
  stamina.classList.add('visible');
  // "run" lands first, from the director, and is the only instruction the game
  // ever gives. The key comes a beat later, and only if you have not already
  // worked it out — a player who is already sprinting does not need telling.
  // Both of these fire once per session and never again: the director now
  // hands the sprint over exactly once, when the thing is close.
  setTimeout(() => {
    if (player.sprintUnlocked && player.stamina > 0.995) showLine('shift to run');
  }, 2100);
};

// The bar is only redrawn when it actually moves — it sits at full for most of
// a session and a per-frame style write for that is just garbage.
let lastStamina = -1;
function renderStamina() {
  if (!player.sprintUnlocked) return;
  const s = player.stamina;
  if (Math.abs(s - lastStamina) < 0.004) return;
  lastStamina = s;
  staminaFill.style.transform = `scaleX(${s.toFixed(3)})`;
  stamina.classList.toggle('low', s < 0.45 && s > 0);
  stamina.classList.toggle('spent', player._winded);
}

// Start audio on the activating click itself — most reliable point for an
// AudioContext to resume, since it's squarely inside the user gesture.
//
// Once you are dead the same click is a restart. A reload rather than a reset:
// the seed, the layout, the event timeline and every piece of director state are
// module-level, and the honest way to get a clean one of each is a new page.
// It also means the place you wake up in is somewhere you have never been.
input.onActivate = () => {
  if (dead) { location.reload(); return; }
  audio.start();
};

input.onLockChange = (locked) => {
  if (dead) return;        // the death screen is not the pause screen
  running = locked;
  if (locked) {
    audio.start();           // idempotent fallback if onActivate didn't run
    audio.duck(AUDIO.masterVolume, 0.6);
    overlay.classList.add('hidden');
  } else {
    // Same overlay, different words. Pausing is not a menu you came back to on
    // purpose; it is the building waiting for you.
    overlayEyebrow.textContent = 'stopped';
    overlayTitle.textContent = 'still here';
    overlayNote.textContent = 'nothing out there is waiting for you to be ready.';
    overlayAction.textContent = 'click to go back';
    overlay.classList.remove('hidden');
    subtitle.classList.remove('visible');
    audio.setBreath(0);
    audio.setHeartbeat(0);
  }
};

// --- Main loop --------------------------------------------------------------
// The body is wrapped so that a single bad frame can never stop the loop. The
// original version called requestAnimationFrame at the end, which meant any
// exception anywhere in update or render permanently killed the game — the
// screen simply froze on the last good frame, with nothing to indicate why.
// Now the frame is skipped, the first failure is reported once to the console
// and to the player, and the loop keeps going.
let last = performance.now();
let loopFailures = 0;

function step(dt, t) {
  // While the face is on the screen you do not get to walk away from it.
  const frozen = director.scareT > 0;
  if (!frozen) {
    const blockers = props.near(player.x, player.y, 2.5);
    player.update(dt, input, blockers);
    if (player.justStepped) {
      audio.playFootstep({ pan: (Math.random() - 0.5) * 0.15, volume: player.sprinting ? 0.42 : undefined });
    }
    renderStamina();
  }
  const fx = director.update(dt, t);
  // The torch goes out on the way down, and nothing the director wanted to do
  // to the light matters after that.
  const fallDark = player.fallDark();
  if (fallDark > 0) fx.darkFlash = Math.max(fx.darkFlash, fallDark);
  // Static left-behind objects are solid meshes; the creature and the hunter
  // hand in their own freshly-posed geometry on the instance.
  fx.meshes = props.near(player.x, player.y).concat(fx.meshes || []);
  renderer.render(player, world, {
    ...fx,
    flashlightOn: player.flashlight,
    hasGun: director.hasGun,
    gunEquipped,
    time: t,
  });
}

function frame(now) {
  const t = now / 1000;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;           // clamp after tab-out / pause

  if (running) {
    try {
      step(dt, t);
    } catch (err) {
      loopFailures++;
      if (loopFailures === 1) {
        console.error('[frame] skipped after an error — the loop is still running:', err);
        showLine('something went wrong');
      }
    }
  }
  // When paused we simply stop updating; the last frame stays under the overlay.

  requestAnimationFrame(frame);
}

// Development hook: drive a single frame without owning the pointer lock, so
// the renderer can be inspected and posed from the console.
if (DEBUG.enabled) {
  window.__game = {
    world, player, renderer, director, props, audio, input,
    equip() {
      director.hasGun = true;
      gunEquipped = true;
      reticle.classList.add('visible');
      hud.classList.add('visible');
      renderAmmo(director.ammo);
    },
    step(dt = 1 / 60, t = performance.now() / 1000) {
      const fx = director.update(dt, t);
      fx.meshes = props.near(player.x, player.y).concat(fx.meshes || []);
      renderer.render(player, world, {
        ...fx, flashlightOn: player.flashlight,
        hasGun: director.hasGun, gunEquipped, time: t,
      });
      return fx;
    },
    run() { input.onLockChange(true); },
    failures() { return loopFailures; },
  };
}

// Render one idle frame behind the start overlay so it isn't pure black.
const introEnv = {
  ambient: LIGHT.ambient, panelEmissive: 0, beamIntensity: LIGHT.beamIntensity,
  fogDensity: FOG.density, fogColor: FOG.color, fovScale: 1,
  entities: [], meshes: [], flashlightOn: true, time: 0, dread: 0,
  hasGun: false, gunEquipped: false, scare: 0, muzzleFlash: 0, stress: 0,
  shakeX: 0, shakeY: 0, grade: null,
};
introEnv.meshes = props.near(player.x, player.y);
renderer.render(player, world, introEnv);

requestAnimationFrame(frame);
