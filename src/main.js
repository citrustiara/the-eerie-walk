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
import { AUDIO, LIGHT, FOG, GUN, PIT, DEBUG, ENDINGS, SAVE_KEY } from './config.js';

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
const endingsList = document.getElementById('endings-list');

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

let running = false;     // the frame loop is stepping the world
let gunEquipped = false;

// --- what screen you are on -------------------------------------------------
//
//   start    the title, before anything
//   playing  pointer locked, in the building
//   paused   esc; the same overlay with different words
//   dying    it has already happened and cannot be interrupted — the drop, or
//            the face. Input is ignored and the overlay stays down.
//   dead     one ending, on its own
//   endings  the list of them
//
// The dying state exists because both deaths take a second or two to play out
// and neither of them is allowed to be cancelled by pressing escape.
let mode = 'start';
const isOver = () => mode === 'dying' || mode === 'dead' || mode === 'endings';

// --- the collection ---------------------------------------------------------
// Which endings this browser has seen. There is no other save data; the layout,
// the seed and the run are all thrown away every time.
function loadEndings() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();   // private windows, file:// under some browsers, etc.
  }
}
const found = loadEndings();
let latestEnding = null;   // the one that just happened, marked until reload

function keepEnding(id) {
  latestEnding = id;
  if (found.has(id)) return;
  found.add(id);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify([...found]));
  } catch { /* nothing to be done about it, and it is not worth a crash */ }
}

function renderEndings() {
  endingsList.textContent = '';
  for (const e of ENDINGS) {
    const li = document.createElement('li');
    li.className = 'ending';
    if (found.has(e.id)) li.classList.add('found');
    if (e.id === latestEnding) li.classList.add('latest');

    const num = document.createElement('span');
    num.className = 'ending-num';
    num.textContent = e.numeral;

    const name = document.createElement('span');
    name.className = 'ending-name';
    // A row you have not reached is dotted out at the length of the name it is
    // standing in for. You get to know how much is missing and nothing else.
    name.textContent = found.has(e.id) ? e.name : '·'.repeat(e.name.length);

    li.append(num, name);
    endingsList.append(li);
  }
}

// Every overlay state goes through here, so none of them can inherit a line
// from the one before.
function setOverlay(next, { eyebrow = '', title, note = '', action }) {
  overlay.className = `mode-${next}`;
  overlayEyebrow.textContent = eyebrow;
  overlayTitle.textContent = title;
  overlayNote.textContent = note;
  overlayAction.textContent = action;
}

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

// One line, low on the screen, held long enough to read twice. Several of these
// are on delays of a second or two, so the run can quite easily be over by the
// time one arrives — and a line of gameplay text over an ending screen reads as
// a bug, which is exactly what it would be.
let subtitleTimer = 0;
function showLine(text) {
  if (isOver()) return;
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
  // The face is on the screen and the run is already over; it just has not
  // finished happening yet. Locking the state here rather than when the face
  // cuts away means escape cannot be used to get out from under it.
  if (director.fatal) beginDying();
};
// ...and this is the frame the face lets go on.
director.onDeath = (id) => showDeath(id);
director.onLine = showLine;

// --- Going in a hole --------------------------------------------------------
// One of the two ways this ends. The creature catches you and lets go; the
// floor does not, and neither does the thing that answers the gun.
player.onFall = () => {
  hideGunHint();
  subtitle.classList.remove('visible');
  beginDying();
  audio.playFallRush();
  audio.setBreath(0);
  audio.setHeartbeat(0);
};

player.onLand = () => {
  // Stop the loop on the frame you land rather than when the screen comes up.
  // The frame is already fully black by then, so nothing visibly changes — but
  // it means the director cannot spend the beat before the ending screen firing
  // a whisper at a corpse.
  running = false;
  audio.playFallImpact();
  audio.duck(0, 0.9);
  setTimeout(() => showDeath('fall'), PIT.deadFor * 1000);
};

// It has happened. From here nothing the player does reaches the game until the
// ending screen is up — no pausing out of it, no clicking back into it.
function beginDying() {
  if (isOver()) return;
  mode = 'dying';
  input.lockEnabled = false;
}

function showDeath(id) {
  if (mode === 'dead' || mode === 'endings') return;
  mode = 'dead';
  running = false;
  input.lockEnabled = false;
  document.exitPointerLock();
  reticle.classList.remove('visible');
  hud.classList.remove('visible');
  stamina.classList.remove('visible');
  subtitle.classList.remove('visible');
  hideGunHint();
  audio.setBreath(0);
  audio.setHeartbeat(0);

  const e = ENDINGS.find((x) => x.id === id) || ENDINGS[0];
  keepEnding(e.id);
  setOverlay('dead', {
    eyebrow: e.eyebrow,
    title: e.title,
    note: e.note,
    action: 'click to go on',
  });
}

// One ending is not the story. The list is — you find out on the first death
// that there were others, and you do not find out what they are.
function showEndings() {
  mode = 'endings';
  renderEndings();
  setOverlay('endings', {
    eyebrow: `${found.size} of ${ENDINGS.length} found`,
    title: 'the eerie walk',
    action: 'click to walk again',
  });
}

// The ending screen and the list are the only two places a click is not a
// request for the pointer, so they are wired here rather than through Input.
//
// Walking again is a reload rather than a reset: the seed, the layout, the
// event timeline and every piece of director state are module-level, and the
// honest way to get a clean one of each is a new page. It also means the place
// you wake up in is somewhere you have never been.
overlay.addEventListener('click', () => {
  if (mode === 'dead') showEndings();
  else if (mode === 'endings') location.reload();
});
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
input.onActivate = () => {
  audio.start();
};

input.onLockChange = (locked) => {
  // An ending is not a pause screen, and losing the pointer part-way through
  // one does not stop it: the loop keeps stepping so the face can finish and
  // the drop can land. You are frozen for the whole of both anyway.
  if (isOver()) return;
  running = locked;
  mode = locked ? 'playing' : 'paused';
  if (locked) {
    audio.start();           // idempotent fallback if onActivate didn't run
    audio.duck(AUDIO.masterVolume, 0.6);
    overlay.classList.add('hidden');
  } else {
    // Same overlay, different words. Pausing is not a menu you came back to on
    // purpose; it is the building waiting for you.
    setOverlay('pause', {
      eyebrow: 'stopped',
      title: 'still here',
      note: 'nothing out there is waiting for you to be ready.',
      action: 'click to go back',
    });
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
