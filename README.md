# The Backrooms

A browser raycaster horror game. No engine, no libraries — a software DDA
renderer drawing textured walls, cast floor/ceiling, and billboard sprites into
a 480×270 buffer that's upscaled with `image-rendering: pixelated`. The world is
infinite, generated from value-noise/fBm over a guaranteed-open street grid. The
soundscape and every texture are synthesised at runtime.

The whole point is the dark: ambient light is almost nothing, so the handheld
flashlight beam plus thick exponential fog are the only way to see. Dread is
built by a director that schedules events on randomised, cooldown-gated timers
and escalates slowly over a session.

## Running it

It uses native ES modules, so it must be served over HTTP (opening the file
directly with `file://` will be blocked by the browser). From this folder:

```bash
# pick one
python -m http.server 8000
npx serve .
php -S localhost:8000
```

Then open <http://localhost:8000/> and click to enter.

## Controls

- **W A S D / arrows** — move
- **Mouse** — look (click the canvas to capture the pointer)
- **F** — toggle flashlight
- **1** — equip the gun after you find it
- **Esc** — release the pointer (pauses)

Development hotkeys live behind `DEBUG.enabled` in `src/config.js`: **7** spawns
red eyes, **8** spawns the silhouette, and **9** spawns the gun pickup.

Use headphones — the audio is spatial and most of the horror lives there.

## How it's built

| File | Responsibility |
|------|----------------|
| `src/main.js` | Bootstrap + the input → player → director → renderer loop |
| `src/config.js` | Every tunable (fog, fov, lighting, horror cadence) |
| `src/renderer.js` | DDA raycaster: walls, floor/ceiling casting, sprites, lighting, post FX |
| `src/world.js` | Infinite cached 16×16 chunks; street-grid + fBm layout |
| `src/noise.js` | Seeded value noise + fBm |
| `src/textures.js` | Procedural wallpaper / carpet / ceiling / figure |
| `src/player.js` | Movement, collision, mouse-look, head-bob, footstep cadence |
| `src/input.js` | Keyboard, mouse, pointer lock |
| `src/audio.js` | Web Audio: hum, fluorescent whine, footsteps, whispers, reverb |
| `src/director.js` | Horror scheduler: dread, flicker, phantom steps, figure, anomalies |
| `src/mathutils.js` | clamp/lerp/hash/PRNG/packing helpers |

### The horror events

- **Phantom footsteps** approach from behind — and stop the instant you turn to face them.
- **Lights flicker** in a stutter, then settle and die back to dark.
- **A figure** appears down a sightline and is gone the moment you look straight at it or close in.
- **Spatial anomalies** (rare): the walls breathe, the fog thickens, or the world goes silent.
- **Whispers** drift past, panned, on randomised timers.

Everything is gated behind a rising `dread` value, so the first minutes are calm
and the place only turns on you later.
