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
import { buildMeshes } from './mesh.js';
import { AUDIO, LIGHT, FOG, DEBUG } from './config.js';

const canvas = document.getElementById('screen');
const reticle = document.getElementById('reticle');
const gunHint = document.getElementById('gun-hint');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayHint = document.getElementById('overlay-hint');

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
let started = false;     // has the player clicked in once
let gunEquipped = false;

function showGunHint() {
  gunHint.textContent = 'press 1 to pull out the gun';
  gunHint.classList.add('visible');
}

function hideGunHint() {
  gunHint.classList.remove('visible');
}

input.onToggleFlashlight = () => player.toggleFlashlight();
input.onSelectGun = () => {
  if (!director.hasGun || gunEquipped) return;
  gunEquipped = true;
  reticle.classList.add('visible');
  hideGunHint();
  audio.playGunReady();
};
input.onDebugSpawn = DEBUG.enabled ? (kind) => {
  const spawned = director.debugSpawn(kind);
  if (kind === 'gun' && spawned) {
    gunEquipped = false;
    reticle.classList.remove('visible');
    hideGunHint();
  }
} : null;
director.onGunPickup = () => {
  audio.playGunPickup();
  showGunHint();
};

// Start audio on the activating click itself — most reliable point for an
// AudioContext to resume, since it's squarely inside the user gesture.
input.onActivate = () => audio.start();

input.onLockChange = (locked) => {
  running = locked;
  if (locked) {
    started = true;
    audio.start();           // idempotent fallback if onActivate didn't run
    audio.duck(AUDIO.masterVolume, 0.6);
    overlay.classList.add('hidden');
  } else {
    overlayTitle.textContent = 'paused';
    overlayHint.textContent = 'click to return. wasd move · mouse look · f flashlight · 1 equip · esc release';
    overlay.classList.remove('hidden');
  }
};

// --- Main loop --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const t = now / 1000;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;           // clamp after tab-out / pause

  if (running) {
    const blockers = props.near(player.x, player.y, 2.5);
    player.update(dt, input, blockers);
    if (player.justStepped) {
      audio.playFootstep({ pan: (Math.random() - 0.5) * 0.15 });
    }
    const fx = director.update(dt, t);
    // Static left-behind objects are solid low-poly meshes now. The figure stays
    // a sprite because it is meant to read as an absence, not a physical prop.
    fx.meshes = props.near(player.x, player.y).concat(fx.meshes || []);
    const env = {
      ...fx,
      flashlightOn: player.flashlight,
      hasGun: director.hasGun,
      gunEquipped,
      time: t,
    };
    renderer.render(player, world, env);
  }
  // When paused we simply stop updating; the last frame stays under the overlay.

  requestAnimationFrame(frame);
}

// Render one idle frame behind the start overlay so it isn't pure black.
const introEnv = {
  ambient: LIGHT.ambient, panelEmissive: 0, beamIntensity: LIGHT.beamIntensity,
  fogDensity: FOG.density, fogColor: FOG.color, fovScale: 1,
  entities: [], meshes: [], flashlightOn: true, time: 0, dread: 0,
  hasGun: false, gunEquipped: false,
};
renderer.render(player, world, introEnv);

requestAnimationFrame(frame);
