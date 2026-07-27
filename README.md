# The Eerie Walk

A browser raycaster horror game. No engine, no libraries — a software DDA
renderer drawing textured walls, cast floor/ceiling, articulated solid meshes
and billboard sprites into a 480×270 buffer that's upscaled with
`image-rendering: pixelated`. The world is infinite: mostly built district by
district out of value noise, with one block in five stamped from a hand-drawn
symmetric template — a ward, an atrium, a shaft, a lattice of pillars, a chapel.
Every texture, every model and the entire soundscape are synthesised at runtime.

There is one wall in the whole building — mustard wallpaper over plasterboard —
at six stages of coming apart. Everything that makes one place different from
another is its *shape*: how tight it is, how far you can see, whether the ceiling
is at two and a half metres or seven or simply absent with windows glowing three
storeys up, and whether the floor is all there. It is often not, and walking into
a hole is one way this ends.

Before you fire the gun there are no jumpscares and nothing runs at you. The
creature walks, and walking is enough; it reaches you and then it simply is not
there, and you have to decide whether it ever was.

Then you fire the gun, and something else comes. That one does not vanish, does
not lose interest, and when it reaches you the run is over.

Fire it and you also close the only way out. There is one ending that is not a
death — the building puts down a door, the way it once put down the weapon, and
it will only do that for a run in which you have not used the weapon. What is
through it is wet ground, a treeline and a sky going pale, and it does not tell
you whether you got out of anything.

Five of the six endings are the building being done with you; the sixth is you
being let go. There is still no winning. They are collected: the count is visible
from the first death, the shapes of the ones you have not had are not. The list
lives in `ENDINGS` in `src/config.js` and persists in localStorage under
`SAVE_KEY`.

The whole point is the dark: ambient light is almost nothing, so the handheld
flashlight beam plus thick exponential fog are the only way to see. Dread is
built by a director that schedules events on randomised, cooldown-gated timers
and escalates over a session.

## Running it

It uses native ES modules, so it must be served over HTTP (opening the file
directly with `file://` will be blocked by the browser). From this folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/> and click to enter.

## Controls

- **W A S D / arrows** — move
- **Mouse** — look (click the canvas to capture the pointer)
- **F** — toggle flashlight
- **1** — equip the gun after you find it
- **Left mouse** — fire
- **Shift** — sprint (does not exist until something makes it necessary)
- **Esc** — release the pointer (pauses)

Development hotkeys live behind `DEBUG.enabled` in `src/config.js`: **5** grants
full grace and puts down the door, **6** spawns the hunter, **7** spawns distant
eyes, **8** spawns the creature, **9** spawns the gun pickup, **0** forces an
anomaly. The same flag exposes `window.__game` — the live world,
player, director and renderer, plus `__game.step(dt, t)` to advance and draw a
single frame without owning the pointer lock, which is how the models and
lighting were tuned.

Use headphones. The audio is spatial and a lot of the horror lives there.
World-positioned sounds keep both halves of their bearing: stereo pan supplies
left/right, while a shared head-shadow stage rolls a source down toward 1.6 kHz,
softens it and adds room tail as it moves behind you. The `silence` anomaly
still owns a separate filter on the master bus, so it can flatten the whole mix
without either effect overwriting the other.

The balance probes that produced the landmark and anomaly-eligibility numbers
are checked in rather than living in a browser console:

```bash
npm test
npm run measure
```

`npm run measure -- --seeds=1337,7331 --span=25 --draws=10000` overrides the
defaults. Every seed constructs a fresh world, player and director; persistent
state such as `landmarksUsed` is explicitly reset between independent position
probes, so rerunning a sample cannot inherit the previous run.

### A note on freezes

The loop used to call `requestAnimationFrame` only at the *end* of the frame, so
a single exception anywhere in update or render permanently killed the game: the
picture stopped on the last good frame with nothing to say why. The body is now
wrapped, the frame is skipped, the first failure is logged to the console and
shown on screen, and the loop keeps going. If it ever happens again there will
be a stack trace naming the line.

I could not reproduce a hard hang under instrumentation — no exception, no
unbounded loop, and no frame over about 25 ms across several thousand frames
with audio live. What I did find and shorten was the creature's exit: it used to
leave the screen fully black for roughly two seconds (a 0.5 s dark flash plus a
torch failure that took 1.4–1.9 s to recover), which is long enough to read as
the game having stopped. It is about a second now.

### Sound

There is no monster shriek. There was — a pair of detuned saws sliding down
through a waveshaper — and it was the single most obviously *authored* sound in
a game where everything else is a room tone, which made the creature feel like a
game asset every time it did anything. It is replaced by `playVanish` (a sub-bass
drop under an inhale-shaped band of noise falling out of the top of your hearing,
then a hole in the mix where the room used to be) and `playDistantCall` (three
nearly-unison triangle partials beating against each other, lowpassed to 340 Hz
so it is unmistakably through a wall). Neither of them sounds like a creature.
That is the point.

## Scale

One world unit is the ceiling height, which the game treats as **3 metres**, so
the player's 0.5-unit eye height reads as a person 1.5 m tall. Every prop and
the creature are therefore authored in **metres** and converted once with
`toWorld()`. This is load-bearing: a cardboard box written as `0.34` ends up
0.11 units tall — something you look *down* at, which is what makes the clutter
read as abandoned human junk rather than level geometry.

## The building

The first map was a grid of open streets every seven cells with noise blobs
between them. It could never seal you in, but it only had one shape: wide open,
slightly lumpy, every junction identical. Measured, the average unobstructed
sightline was **8.2 cells** and 78% of the floor plan was open.

It is now three layers, in `world.js`:

- **Arteries.** A lattice of corridors every 14 cells (42 m) that *wander* — a
  smooth ±3 cell drift along their length — and are one or two cells wide rather
  than being open field. A short forced cross at each lattice node guarantees
  the horizontal and vertical arteries actually meet, and that is the whole
  proof that an infinite procedural map has no pocket you can be standing in and
  not get out of. Measured across six seeds, 97–98% of walkable cells are
  reachable from the spawn (the rest are sealed voids you can never enter in the
  first place), and the spawn is forced onto the lattice.
- **Landmarks.** One block in five is not generated at all. It is *stamped*,
  from a hand-drawn 14×14 template that is exactly symmetric about both axes.
  There is no generator behind these on purpose — noise is good at "somewhere"
  and completely incapable of "somewhere on purpose", and the complaint that
  everywhere looked the same was really the complaint that nothing anywhere had
  been *designed*. There are five, and they repeat, which is the point: the
  third time you walk into the same ward you know exactly where it goes.
  - **ward** — the standardised symmetric corridor. Two cells wide, running the
    whole block, three paired rooms off each side, a doorway into each, and no
    floor in the middle pair. Somebody bled down one of these walls.
  - **atrium** — a ring of floor around a solid cross-shaped core with four
    square holes at the corners. You can walk all the way round it, and you
    will, twice, before working out there is nothing in the middle. Seven-metre
    ceiling.
  - **shaft** — mostly hole. Two two-cell walkways cross it at right angles and
    there is a rim you can edge round. Sound comes up it, and if you take one
    step wrong so do you.
  - **combs** — nine identical pillars on a perfect lattice with four identical
    holes between them. Nothing here is random and nothing here is different
    from anything else here, which is why you cannot tell whether you have
    already been down this row. Two and a half metres of headroom, which you
    feel before you notice it.
  - **chapel** — a cruciform hall with a plinth at the crossing and a hole on
    either side of it, under a ceiling twice as high as it needs to be.
- **Districts.** Every other 14×14 block picks a structure from its own hash: a
  **warren** of one-wide corridors with dead ends, a grid of 4×4 **cells** each
  with exactly one doorway per wall, **chambers** with no straight walls at all,
  long parallel service **stacks**, near-solid **dense** rock with one winding
  channel through it, a **vault** — one big irregular room inside a thick shell —
  an open **hall**, a columned **expanse** with no ceiling at all, and a
  **collapse** where most of the floor has gone.

  Stacks pick their orientation from the *perpendicular* block index alone, so
  every stacks block in a row agrees and their two-cell halls line up across
  block boundaries. Two or three in sequence give you a corridor a hundred
  metres long that ends in the dark at both ends — which no amount of noise
  inside a single 14-cell block could ever produce.

Measured over six seeds and a 161×161 cell window, looking along all four
cardinal directions from every walkable cell: **66% of the plan is open, the
median sightline is 4 cells and 46% of sightlines are 3 cells or less** — so
almost half the time you cannot see past the next corner. But the *mean* is 7.3
and **one view in five runs past 12 cells**, because the open districts are
genuinely open. That gap between the median and the mean is the shape of the
building: mostly tight, occasionally not, and never in a way you can predict.
98% of walkable floor is reachable from the spawn.

The district and landmark layout is now seeded too (`seedSalt` in `noise.js`).
It previously came from a plain position hash, so although the *interiors*
changed with the seed the skeleton did not: the ward was in the same place
relative to your spawn in every session you ever played.

### Ceiling heights

Every block also has a ceiling, and there are four of them: **2.5 m, 3 m, 7 m,
and none at all**. It is stored in two spare bits of the cell flags so the
renderer can ask about it with the same array index it already uses for walls
and holes. Across six seeds the mix comes out 29% low, 42% standard, 22% high
and 6% open.

This is the single biggest lever on how a space feels and it is the reason the
walls are the same wallpaper everywhere. Ten unrelated materials were doing the
job of "this is a different place" badly — a riveted steel corridor did not say
*elsewhere in the building*, it said *a different building*. A corridor you can
almost touch the ceiling of opening into something seven metres high, or into
something with no ceiling at all and a run of windows glowing three storeys up,
says it properly.

Three things follow from it in `renderer.js`:

- The **ceiling is cast once per distinct height in sight**, far plane first, so
  a nearer low ceiling paints over the tall room behind it. Each chunk records a
  bitmask of the heights in it, so the overwhelmingly common frame — one height
  everywhere — costs exactly what a single pass always did, and the artificial
  worst case of all four at once measures under 2 ms.
- A **wall is as tall as the room it faces**, not as tall as its own block. The
  DDA tracks the cell it was in before it hit, and that cell's ceiling is the
  height the column is drawn to. Standing in a 3 m corridor looking at the flank
  of a 7 m hall you see 3 m of wall and then your own ceiling; standing in the
  hall looking back at the same wall you see all seven.
- Above the wallpaper the paper simply **keeps going** — same mustard, same
  stripe at the same pitch, same sheet seams, just dirtier and darker the higher
  it gets, with a picture rail at the join so the change of texture reads as a
  moulding rather than as a seam. The first attempt made it bare grey board with
  concrete courses; it was architecturally sensible and it looked like a
  completely different building bolted on above head height, which is the same
  mistake the ten materials made. A seven-metre hall is now the same corridor
  with more of it, and the seven-metre ceiling is the same suspended tiles, just
  further away and with most of them missing.
- In the blocks with no ceiling there are **windows** up there: emissive, barely
  dimming with range, because the point of a window is that you see it from the
  far side of a hall long before you can see the floor you are standing on.
- Where the ceiling steps **down** as you look outward, there is a **riser** —
  the face of the step, hanging from the taller ceiling to the shorter one,
  drawn from the same texture. Nothing was drawing it, and the arithmetic says
  exactly why it had to be: for a plane at height *h* the affine cast puts a
  screen row at distance *(h − eye)·H/p*, so looking from a tall space into a
  short one the near ceiling covers rows *above* `(hi−eye)H/B` and the far one
  covers rows *below* `(lo−eye)H/B` — and the band between them belongs to
  nobody. That was the black wedge, and it is why the far ceiling looked like it
  was floating in front of the near one.

### Holes in the floor, and going down one

Landmark templates mark a cell `O`, and the `collapse` district generates them
in broad irregular patches: the cell is open, you can see straight across it,
and there is no floor. Cells carry flags (`SOLID`, `PIT`, two anchors and two
bits of ceiling) rather than a boolean.

**Everything in the building collides against `world.blocked`, which includes
holes. You do not.** The player — and only the player — collides against
`world.isWall`. A hole used to have an invisible barrier round it, which is a
strange thing to put in a place that wants you dead; you can now walk into one,
and it is the only thing in the game that actually kills you. The creature
catches you and lets go. The hunter catches you and lets go. The floor does not.

The monsters keep the barrier on purpose. A creature that walks into a hole and
deletes itself is not a threat, it is a physics demonstration.

The fall is eight metres and takes about a second and a half at real gravity.
You keep half the speed you walked in with, so you go over the edge at an angle
and not down a lift shaft; the view tips forward and keeps going; the torch is
gone within a quarter of a second of your eye passing the floor line, so what
you actually get is one second of falling in the dark and then a sound. Then the
screen comes up, and clicking it reloads — a new seed, a new layout, a new
timeline, and somewhere you have never been.

Doing any of this needed one constant deleted. Eye height was the literal `0.5`
written into every projection in `renderer.js`; it is read off the player now,
because on the way down a hole it goes to zero and then past it, and the floor
rushing up and the walls stretching are what the existing geometry does for free
once nothing assumes half a wall.

Arteries bridge pits as well as cutting walls, so there is always one route
through a block that the floor is still under, and a hole can never sever the
lattice.

There is no second sector system and no vertical geometry behind the way a hole
is *drawn*, either. The affine floor cast already gives you, for a screen row,
the world point where the *floor* plane is; scaling that point away from the
camera by `1 + PIT.depth/eye` gives the point where a plane eight metres lower
would be. Walk from one to the other, and the first sample that is no longer
over a hole is where the ray met the lining — everything past the last one is
the bottom.

Two details make the difference between that reading as a shaft and reading as a
staircase down into a swimming pool, and both of them only showed up once the
hole got deep enough to be fatal:

- The walk is **quadratic in t and then bisected**. At eight metres the far
  plane is six times further away than the floor plane, so evenly spaced samples
  step straight over the near lip; and quantising depth into ten levels bands
  the whole shaft into nested rectangles, because depth drives both the texture
  row and the brightness. `t = s²` puts the samples where the geometry is, five
  halvings take the error under a texel, and it only runs on the thin band of
  pixels that actually hit the lining.
- The lining is **bright at the lip and then gone** — a metre of lit blockwork
  and then black. Fading it gently down eight metres lights the whole shaft
  evenly, which looks like standing water. A lit rim and a void is both what it
  would really look like and the only reading that says *drop* rather than
  *step*.

### Anchors

Templates also mark cells `*` (a scene of left-behind objects is guaranteed
here) and `G` (the gun prefers to turn up here). A room that was built on
purpose always has something in it, and the one object in the game that matters
ends up somewhere you can describe rather than in a corridor.

### Knowing you are in one

All of the above is true and none of it was working, because **shape is the
hardest channel this renderer has**. At 480×270, through 0.2 fog, from eye
height, a hand-drawn floor plan is very nearly indistinguishable from noise —
you could stand in the middle of the chapel and have no idea. Every other
channel was globally uniform: props rolled from one weighted bag everywhere,
blood walls were a flat 2.2% everywhere with the archetype rolled from fixed
weights, and `paperBlood` was shared with two districts. So the marked corner of
the ward got a traffic cone.

Four channels now carry the room instead of one.

**Kits** (`LANDMARK_KITS`, `objects.js`). Any scene inside a landmark —
anchored or rolled — is built from that landmark's own list, never the global
bag. Five models exist for one room each and are pinned at `weight: 0` in
`PROP_TYPES`, which the weighted picker can never reach: a stripped **bed frame**
on castors for the ward, a torn section of **safety barrier** for the shaft, and
a fallen **cross**, spent **candles** and a **pew** for the chapel.

**Aim** does at least as much work as the models. A prop at a random yaw reads
as dropped; every prop in a landmark is turned to face what the room is built
around — chairs facing the atrium's empty core, barrier lying *tangent* to the
rim of the shaft, ward beds snapped square to the walls. The combs is the
exception and the whole point of having one: it gets **one object, one yaw, one
seed**, everywhere, forever. Nothing in that room can tell you which row you are
in.

**Blood that records the room.** `decals.js` always had six archetypes; it just
rolled them uniformly across an infinite building, so the tally — the one that
says a *person* was in here for a long time — came up once in twenty-one smears
somewhere it meant nothing. Inside a landmark the wall is marked several times
as often and marked with the event that room was for: **handprints and drag** in
the ward (people were moved down that corridor and some held on), **soak** at
the shaft's rim, **spray** across the atrium core, and **tally** in the chapel,
which is now the only place in the building you will ever see one. Age is
authored too — the chapel's counting stopped a long time ago and the ward's did
not. The combs gets **nothing at all**: a smear would be a landmark inside the
landmark. Districts are untouched, still at 2.2% and still rolling their own.

Measured over three seeds:

| | wall cells | marked | archetypes |
|---|---|---|---|
| district | 44894 | 1.8% | all six, weighted |
| ward | 1527 | 13.2% | handprints, drag |
| chapel | 1988 | 11.4% | tally |
| shaft | 795 | 9.6% | soak |
| atrium | 1195 | 5.9% | spray |
| combs | 1457 | 0.0% | — |

The floor carries it too: a **drag trail** of thinning pools running out of a
ward room toward the corridor and stopping short of wherever it was going, and a
ring of marks at the foot of the **chapel plinth** — the one thing every visit
to that room has in common, and readable from the end of the nave before the
shape of the room is.

### Being told, without being told

There is no counter and there will not be one. "1 of 5 found" turns the best
rooms in the building into collectibles and the walk into an errand. Two tiers
instead (`LANDMARK_VOICE`), neither of them a number:

- **First time in any landmark — no words.** The mix ducks, the fog opens a
  shade so you can see further into the room than you could walking up to it,
  and the room plays *its own note*, quietly. That note is the same instrument
  its ritual uses, so the entry and the event get learnt as one thing and
  walking in becomes an omen for what the room does.
- **Second room of a kind, once ever, per kind — one line.** Not "you found a
  landmark"; something about having been here before. *the same six doors.*
  *this row is the row you came down.* *it was built to be walked down.* The
  horror of this building has always been recognition rather than collection —
  `world.js` has said so from the first commit — and the second time is when
  that lands. Suppressed while anything is in the room with you; the subtitle
  slot belongs to the building answering the gun, and that matters more.

**Not done: ramps and multiple floors.** The fixed eye height and the single
uniform wall height are both gone, so the projection is no longer the obstacle
it was — a room can be any height, and your eye can be anywhere. What is still
missing is *walkable* geometry at more than one level: a slope or a second
storey needs per-column sector data and an occlusion model that can put one
floor behind another, and the ceiling cast handles overlapping heights by
painting far-to-near rather than by depth-testing, which is enough for four flat
planes and not enough for stairs. Still its own piece of work, but a smaller one
than it was.

## Surfaces

The same 64×64 carpet tiled into every cell means the same square of floor every
three metres in both directions, and the eye finds that grid immediately. Floor
and ceiling textures are 256×256 spanning four cells, at the identical texel
density, so the repeat is twelve metres — and their noise is generated
*toroidally* (`tfbm` in `textures.js`), so the tile has no seam at all. Without
the seamless part you only trade a 3 m grid for a 12 m one.

The ceiling gets sixty-four individually aged tiles per texture, roughly one in
ten of them missing entirely and open onto the black above.

**Walls, second attempt.** The first fix left walls sampled *per cell*, mirrored
and re-shaded from a per-cell hash. That is what produced the visible
mis-registration in the wallpaper: a flat wall was a patchwork of three-metre
panels, each a different base yellow, each a different brightness, half of them
mirrored, and none of them lining up with its neighbour. So:

- Wall textures are 256×64 spanning **four** cells and are sampled by **world
  position**, not per cell. A run of wall is one continuous surface — the
  stripes, the sheet seams, the damp and the blood all carry across every cell
  boundary. The only per-run variation is a whole-texture offset keyed off the
  run's own line (constant along the run), so the two walls of a corridor are
  not in lockstep with each other.
- The per-cell brightness jitter is gone. It was the other half of the
  patchwork.

**Walls, third attempt: one wall.** The second attempt fixed the registration
and then answered "everywhere looks the same" with *ten materials* — tile,
poured concrete, riveted steel, oxblood paint, wood panelling. It worked, in the
sense that turning a corner into steel definitely told you something. What it
told you was that you had left the building. Level 0 is one dated retail
back-of-house that never ends; a corridor of glazed institutional tile is a
different place in a way the fiction cannot survive.

So there is now exactly one wall in the level — mustard wallpaper over
plasterboard, sixteen-inch sheets, damp — and what varies is how far gone it is.
Six stages of the same wall, all from one generator, all sharing a base colour
and a stripe so a change reads as decay and never as decor:

| | |
|---|---|
| `paper` | the yellow. Damp, but intact. |
| `paperDamp` | water has been coming through this one for years |
| `paperTorn` | hanging off in sheets, damp plaster behind |
| `paperRot` | black mould has taken it |
| `paperBlood` | someone bled a long way down this one |
| `paperBare` | paper mostly gone; taped plasterboard |

The layers are water, then the paper letting go, then what is growing on it,
then what has been spilled on it. Two of them earned their own note:

- A tear only reads as a tear because of **the lip**: where the paper has split
  it is standing off the wall and catches the torch, so there is a bright curl
  just inside the tear and a shadow on the paper just outside it. Without those
  two lines the same noise field is a grey stain, and the wall looks like it has
  been painted in camouflage.
- Blood is confined to **two or three patches**. The first version scattered
  hard red dots evenly over the whole texture, which read as wallpaper with a
  pattern on it — the exact thing this file exists to avoid. Inside a patch
  there is a run downward and a scatter of thrown spots; outside one there is
  nothing at all.

Which stage a block gets is not arbitrary. The tight sealed districts are merely
damp; the ones that are open to the rest of the building, or that have a hole in
the floor, are the ones that are rotten and marked.

## How it's built

| File | Responsibility |
|------|----------------|
| `src/main.js` | Bootstrap + the input → player → director → renderer loop, ammo HUD |
| `src/config.js` | Every tunable (fog, fov, lighting, horror cadence, the gun, the creature) |
| `src/renderer.js` | DDA raycaster: variable-height walls, floor, four ceilings, meshes, sprites, viewmodel, post FX |
| `src/world.js` | Infinite cached 16×16 chunks; arteries, five stamped landmarks, nine district types, pits, ceiling heights |
| `src/noise.js` | Seeded value noise + fBm, and the per-session layout salt |
| `src/textures.js` | One wallpaper at six stages of decay, the band above it (with windows), carpet / ceiling / deck / shaft / eyes, all seam-free |
| `src/mesh.js` | Primitive kit: boxes, prisms, spheres, slabs, transforms |
| `src/models.js` | Twenty-four scatter props plus five landmark-only ones, the pistol, brass, bullet holes, blood pools |
| `src/creature.js` | The creature and the hunter, rebuilt from primitives every frame |
| `src/objects.js` | Where the props go: deterministic scenes, ~one per 88 open cells, and the per-landmark kits |
| `src/decals.js` | Six archetypes of procedural wall blood; a landmark forces its own |
| `src/player.js` | Movement, collision, mouse-look, head-bob, sprint + stamina |
| `src/input.js` | Keyboard, mouse-look, pointer lock, trigger |
| `src/audio.js` | Web Audio: hum, heartbeat, breathing, footsteps, the gun, whispers, reverb |
| `src/director.js` | Horror scheduler: dread, both creatures, the flow field, anomalies, the gun |
| `src/mathutils.js` | clamp/lerp/hash/PRNG/packing helpers |

### The creature

A 2.4 m articulated solid in a 3 m corridor, posed from scratch every frame:
backward-bending knees, an extra length of forearm so its hands hang past its
knees, a small head on a long neck, and a jaw that opens further than a jaw
should. It is grounded by dropping the body until its lowest *leg* vertex
touches the carpet.

That grounding is why the gait numbers are so small. Any change in the planted
leg's effective length is vertical travel of the whole creature, so a stride
tuned by eye had its head moving twenty centimetres a step — it bounced rather
than walked. Three things fix it, all in `creature.js`: the knee straightens as
the leg extends behind rather than curling (which is also what a digitigrade leg
does at toe-off), the legs are excluded from the forward lean (whose pivot
otherwise converts fore-and-aft foot travel into vertical travel — 34 cm of it
during a charge), and the hands are excluded from the ground test, since its
fingertips hang almost to the carpet and a swinging arm was throwing the body
upward for half of every stride. Measured head travel: **2.9 cm**, down from 18.

Unwatched it moves a little slower than you do — walking a straight line holds
it off but never shakes it. The moment you look at it, it drops to a crawl. So
looking back costs you exactly the ground you were making, which is the decision
it exists to force.

**It never charges.** `CREATURE.canCharge` is `false`; it only ever walks. The
code path is intact for when the gun starts making it angry. And it is rare —
one or two sightings in a long session rather than one every half minute, which
is the difference between an event and furniture. Firing the gun is the one
reliable way to meet it.

**The twitch.** Every couple of seconds, more often the closer it is and more
often when it knows you are watching, the whole body stutters for a fifth of a
second: five body parts judder at five slightly different rates, so it never
resolves into one clean shake, and the head snaps to a random angle and *holds*
there for the whole fit before unwinding over half a second. The stillness
afterwards is the part that gets you.

It is never in the room with you. Inside **2.4 units (7 m)** — whether it closed
the distance or you walked up to it — the frame slams to black and when the
picture comes back the corridor is empty. That radius used to be 3.4 m, which
was close enough to stand and count its teeth, and a monster you can study is a
model. The old resolution was a
screaming face filling the screen; that is now behind `JUMPSCARE.enabled` in
`config.js` and switched off, because a jumpscare *resolves* the tension it spent
a minute building. This resolves nothing.

### The hunter

Fire one round and the building stops sending the thin one.

It used to be the creature again, taller — a folded-over biped with four arms.
That was the whole problem. Whatever it did, the silhouette said *the thing from
earlier, but bigger*, and a sequel to a monster is not a monster.

So it is not a person. It is a **spider**, at a scale nothing in a corridor
should be. A low flat body slung a metre and a half up dragging a heavy abdomen,
under **eight legs** that arch to nearly three metres at the knee before coming
back down — it stands *underneath* its own legs, and the knees are the highest
point on it. The leg span is close to four metres, wider than most of the
corridors it comes down. Its jaw is two chelicerae that hinge sideways with a
fang on each. It has **eight eyes** in a cluster on the front of the body.

Three things carry it, in the order you notice them:

- **The eyes.** They barely dim with distance (`HUNTER.eyeFalloff` overrides the
  renderer's default emissive falloff), so at twenty metres that cluster *is* the
  creature — there is no body yet, just a constellation coming down the hall.
- **The gait.** Alternating tetrapod: four legs down while four swing. The phase
  is driven by **ground actually covered**, not by a timer. The old version
  cycled its legs on a clock while the body was translated separately, so the
  feet slid and a 2.9 m monster read as a sprite on rails. Now a foot goes down
  where it goes down and stays there; walk it into a corner and the legs stop,
  because it is not covering any ground. Measured: 3.9 radians of gait per world
  unit, on every moving frame, and nothing but a slow idle shift when it is not.
- **The twitch.** Roughly three times as often as the creature and for longer,
  and the jitter is applied **per limb**, so the knees judder out of phase with
  each other and it is never once settled.

It is much darker than the creature: at rest it is a hole in the corridor. What
you actually see arriving is the eyes, which are large and barely dim with
distance (`HUNTER.eyeFalloff` overrides the renderer's default emissive falloff),
so they find you across a whole hall before the body resolves at all. You hear
it before that — its footfall carries thirty units, three times the creature's.

Three phases, and it never stops:

1. **approach** — 1.35 u/s for seven seconds. It is not in a hurry yet.
2. **pace** — your speed exactly, when it is near. Further out it is allowed to
   move up to 55% faster, because a pursuer at your nominal speed *loses ground
   continuously* in a warren: it walks the corridors while you cut the corner it
   is still going around. Without that it never arrived at all.
3. **charge** — it stops dead for 0.45 s, which is the only warning you get, and
   then comes at **5.4 u/s** against your 2.4. It will only start one from
   inside 3.2 units. At the old 5.5 it was winding up most of the way down a
   corridor, which gave you the whole run-up to react to and made the sprint a
   routine answer instead of a panic.

The word **run**, and the sprint itself, are handed over exactly once per
session — not when it spawns, but when it first gets within nine units. On
spawn it is a shape at the far end of a hall and the word is noise; it also used
to fire in the same frame as *it heard you*, overwriting the building's answer
to your gunshot before it could be read.

If it reaches you, the face fills the screen. That one is on.

Everything that hunts now navigates with a **flow field** — a breadth-first
distance-to-player over the open cells within 18 of you, rebuilt three times a
second and shared by both creatures. Walking at you and sliding off walls was
fine on open streets; in the reworked map a corridor that bends away from you is
indistinguishable from a wall, and the thing spent whole encounters grinding
against a corner. The rebuild costs 0.066 ms.

### Sprint

You do not have it. When the hunter arrives you are told to **run**, the key is
named a beat later, and a bar appears in the bottom left — the ability and the
reason for it show up in the same second.

3.6 seconds at 4.0 u/s, recharging at a third of the bar per second, and once
you empty it you have to get a fifth of it back before you can go again.
Forward only. The numbers are set so that sprinting the *instant* you hear the
charge wind-up gets you clear, and sprinting a second late does not.

### The gun

Findable after **sixteen seconds**, lying in blood — and **behind you**, out of
your view cone. You cannot watch it arrive; you hear metal land on carpet,
panned to where it is, and you either turn around or you don't. It keeps
clinking while you are within earshot, each repeat waiting a little longer than
the last, so it is a hint rather than a metronome.

Finding it used to be a coin flip: a site lasted 110 seconds, so if you missed
the one clink behind you the next two minutes were dead, and whether your
session had a gun in it at twenty seconds or at four minutes was luck. Three
things fix that without giving it away:

- A site is abandoned after **42 seconds** and another one goes down behind you
  2.5 seconds later. Getting closer extends that placement to 70 seconds, but
  never makes it permanent; an accidentally approached gun cannot be stranded
  silently behind you for the rest of the run.
- **Patience runs out.** After two missed placements the flashlight cuts several
  times. During a black frame the next gun appears almost directly ahead,
  close, where you cannot fail to walk into it when the light returns.
- If a **landmark** has marked a spot for it within sixteen cells, that wins.
  The gun on the floor of the ward, or on the chapel plinth, is somewhere you
  can find again and somewhere you will remember finding.

The invitation escalates without becoming a marker. After nine seconds the
metal catches the flashlight once; after eighteen, footsteps cross behind you
and stop at the weapon; after twenty-eight, small blood drops reveal the final
few cells of a walkable route to it. A player who gets measurably closer has
understood the clue, so that placement no longer expires. Landmark placements
also borrow the sound of their room — the shaft breathes, the ward answers, the
chapel calls — and the first two placements now obey the out-of-view rule even
when an anchor is available.

Measured with a bot that turns toward the clink the way a player would: found at
**21 s** on the first placement. With a bot that wanders blindly and walks into
walls a third of the time: 141 s, on the third — the one placed in front.

**Twelve rounds, no reload.** Left mouse fires: the corridor is fully lit for two
frames, the slide cycles, brass bounces off the carpet, the round punches a hole
in the wall where you aimed, and your ears ring while the mix rolls off
underneath. Three hits drive the creature away; one hit mid-charge breaks the
charge.

And a round that hits nothing tells the building exactly where you are standing.
Two to four seconds later — long enough that you have started to relax — you get
a line of text, a sound a long way off, and something walking in from a
direction you cannot see. That is the real price of the twelve.

There is one deliberately slower use of the trigger. With a live round, lower
the view almost as far as it goes and hold the mouse button: the weapon turns
inward over 1.35 seconds. Looking away or releasing lowers it without firing.
Following through spends the round, cuts the frame to black and records
**the refusal** ending; it does not summon the hunter.

### Grace, and the door

The first round you fire also closes the only way out of the building, and until
that happens there is a second number running alongside dread that the player is
never shown.

**Grace** goes up only from *witnessing*: staying with something the place shows
you until it has finished, rather than leaving or walking into it.

- A **landmark ritual that runs its own timer out while you stand still for it**
  is worth 0.25, so **four** of them is the door. Stillness is cumulative — 3.4 s,
  or 55% of that ritual's life, whichever is less — so you can shift your feet,
  and a short one is not unfairly strict. Closing on the eyes still breaks the
  event outright, and wandering off while it finishes behind you is worth
  nothing. The event itself plays out identically either way: what the room does
  has never been conditional on you, only what it is worth.
- **Holding a stare** is worth 0.07, capped at 0.28 lifetime. Stand still, with
  the creature inside ten units and inside your view cone, for three unbroken
  seconds. Watching it has always been pure cost — it slows to a crawl while you
  look and looking is ground you are not making — and this is the only thing
  that ever paid you for it. Break the stare and the count restarts; it is a
  nerve you hold, not a total you accumulate.
- **One round destroys it**, permanently, along with any door already placed:
  the torch fails the way it does for everything else that leaves, and when the
  light comes back there is wall there.

There is no meter. What you get instead is the building going *quiet* — whispers,
distant calls and the single pair of eyes all stretch their timers by up to 160%,
the fog thins a few percent and the frame goes a shade colder. Redshift already
taught you that a colour means something is coming; this is that sentence with
the sign flipped.

#### Being able to work it out

All of the above was true and none of it was *legible*. A rule that is never
stated, never acknowledged when you follow it, and whose only feedback is a tenth
of the fog over four minutes is not a rule the player is keeping — it is one they
are obeying by accident. The best ending in the game was reachable and not
deducible, which is a worse problem than being hard.

The fix is the one the landmarks already use: a wordless tier that fires every
time, and a spoken tier that fires late, once, and observes rather than instructs.

- **While it is happening, the fog opens.** Stand still with something up and it
  gives, over 2.2 seconds, by 30% — and shuts again in 0.45 if you move. That is
  the whole teaching mechanism and it is one number going one way and then the
  other. It works because the player has already been taught this exact sentence
  twice before they ever hold one: the air opens when you walk into a landmark,
  and it is permanently a shade thinner the more grace you have. This is the
  third use of the same word, under the one behaviour that earns the way out, and
  the only one you can switch on and off yourself. A ritual and a held stare use
  it identically — the lesson is not *rituals reward stillness*, it is that this
  place gives when you stop.
- **A breath under it at 1.5 s**, once per hold: the room's own note, at half the
  volume it uses walking in. Not a chime. The room noticing, in the instrument
  you already associate with that room.
- **The room answers when it banks** — its note again, at ritual volume, with the
  mix ducking under it. The award used to be entirely silent.
- **Three lines, once each, ever**, in the same register as the recognition lines
  and never an instruction. *it finished without you* the first time one runs out
  with you walking about inside it; *it was waiting for you to stop* once you have
  banked two; *the air has stopped moving* on the round that closes it, and only
  if there was something to close. Most players get them in that order, which is
  the right one — you find out something was on offer, then some minutes later
  what it wanted, and eventually what it cost.
- **Air with nothing at the end of it.** Past 0.72 grace the building starts
  moving air every nine to sixteen seconds from a bearing that is different every
  time and is therefore not a bearing at all. It is the only cue in the game that
  deliberately leads nowhere: what it teaches is the *sound*, so that when a door
  does turn up and announces itself with the same draught from a fixed direction,
  you already know what you are hearing.

Two things fell out of writing it. The pending-line slot was a **slot** and not a
queue, so two lines inside the same couple of seconds silently replaced each
other — survivable while the only speaker was a landmark, and not survivable once
banking a ritual could overwrite the line explaining what banking a ritual was.
And a line is now marked *said* when it is delivered rather than when it is
queued, because these three are the only explanation the mechanic ever gets and
losing one to a hunter walking in would put the player back where they started.

Hanging an ending off the rituals turned up two bugs that had been quietly
wrecking them since they were written, and both are worth recording because in
both cases the room appeared to work:

- **The arming was overwritten every frame.** `_updateLandmarkWatch` re-armed
  `pendingRitual` at `elapsed + 1.2..2.6` on every frame you were inside a
  landmark, so the moment it was waiting for receded exactly as fast as time
  passed. What actually happened was that the ritual fired on the first frame you
  stopped being in the room — out in the corridor, with its eyes scattered around
  wherever you had got to. The ranks never went down the ward corridor and the
  ring never went round the atrium core; standing still in a landmark did nothing
  at all. Measured: **5% of visits produced an event.** With the one-line guard,
  100%.
- **The keep-away was a range, not an approach.** Every one of these events puts
  its nearest pair two to six metres away *by design* — the ranks start at four —
  and the leave test asked "is anything within seven metres". It was already true
  on the frame it fired, so every ritual in the game was cut off at 0.9 s
  regardless of what the player did. The swarm anomaly had precisely this bug and
  was fixed; the rituals never were. It now measures how far you have **closed**
  on the nearest of them (2.6 m, or 1.7 for the chapel pair). Measured standing
  still: **97 of 100 run to completion**. Walking at them: **0 of 60**, broken at
  about a second, which is what the rule was always supposed to say.

And one authored beat that had never once been seen: the **chapel plinth is a
solid cell**, so `add()` rejected it every time and the altar silently fell
through to the random scatter. The pair now sits at the foot of the plinth, on
whichever side you are standing.

At full grace the building puts down a **door**, using the same machinery that
gave you the pistol: out of your view cone, close, escalating cues, and a
landmark-marked spot within eighteen cells wins over a random corridor. The
difference is that it needs a wall to be in — a free-standing door frame is a
prop, a door in a wall is a door — and that its cue is air rather than metal. A
draught, then a draught nearer, and there is a cold sliver of light down its
closing edge and a fan of light lying on the carpet in front of it, which after
nine minutes in which the only light has been the one in your hand is the thing
you turn round for.

Walking into it plays out inside the ordinary torch failure, and somewhere in the
middle of those cuts the building stops being where you are.

### Outside

The one place in the game that is not generated. It is stamped 9,000 cells away
from anything a walk can reach, so no chunk needs invalidating and no seam is
ever in shot, and it is hand-built rather than noised: 200 by 150 cells of open
ground with the building's back wall along one edge of it, four cells thick, with
bays and one doorway. The doorway is two cells deep and then sealed — walk back
into it and there is a wall two metres in.

Four things had to change in the renderer, and they are all consequences of one
fact: the fog is no longer holding the picture in.

- **The view distance moves.** The lighting tables run to 26 units, which is far
  past what 0.2 fog will ever show you, and the floor cast clamping its row
  distance there is invisible. At 0.034 it would be a hard ring of repeated
  ground twenty-six metres out, so `_setViewDistance` rescales both tables to 74
  and the fog table is rebuilt per frame anyway.
- **The sky is sampled directionally** — u is the compass bearing of the column,
  v is `atan((horizon − y) / H)`, the same projection the walls use — rather than
  by world position like a ceiling. That is what puts it at infinity. It is not
  fogged, because the bottom of the sky texture *is* the fog colour, so everything
  on the ground recedes into exactly the value the air above the treeline has.
- **Almost none of the sky is ever on screen.** Looking level you see elevations
  of nought to about twenty-six degrees, which is the bottom 30% of the texture.
  The first version put the cloud deck a third of the way up and the stars above
  it, and the result was a flat grey band unless you looked at the ceiling.
  Everything is now inside that band and the rest is what you have to go and find.
- **A wall's height comes off the wall cell**, not the space in front of it —
  the only place in the game that rule is inverted. Inside, a room's walls are
  the height of the room, and reading it off the wall would give you a corridor
  with two different ceiling heights. Outside there is no room, there is a
  frontage, and a frontage has a roofline: the bays are a storey lower than the
  main run. The space is CEIL_HIGH rather than CEIL_OPEN for the same reason —
  open blocks are the city districts, whose façades run up out of the frame, and
  the one thing the outside wall has to do is stop, at seven metres, with sky
  above it.

The ground is the other half of it, and probably the more important half, because
the floor is the surface you are looking at the whole time: wet earth, dead grass
in clumps, and standing water in the ruts carried in the texture's **alpha**
channel.

#### The field

That texture tiles every four cells, which is correct indoors, where the furthest
thing you can see is twenty-six units into fog. Outside the view runs to
seventy-four and the ground goes to the horizon, so twelve metres of period
repeats eighteen times between your boots and the treeline — visibly, in rows,
like tiled lino. A plane with one texture on it is also just a plane: the first
version of this ending was a flat field, and a flat field is the one thing the
outside cannot be, because the whole point of it is that it is not a corridor.

So there is a **height field** now (`terrain.js`), and three things ask it: the
texture baker, the world, and the scatterer. It is deliberately unseeded — every
other surface is reseeded per session because the building is different every
time, and the outside is one hand-built place that is always the same place.

- **Flat is a feature, not a limitation.** The floor is cast affinely from a
  single plane and nothing can raise it. So the relief is entirely *lit*, never
  built: the gradient of the field is shaded from the same quarter of the sky the
  dawn glow comes from, and the eye fills in ground that is not there. It works
  because the fiction is never contradicted — the amplitude is under a metre and
  a half over twenty-metre wavelengths, which is exactly the range where you
  cannot tell.
- **And the first attempt at that was invisible**, for a reason that is obvious
  afterwards: a metre of rise over sixty is a slope of one degree, and one degree
  of lambert is half a per cent of brightness. Fields do not read as ground
  because of their hills, they read because of their **ruts**. There is a second,
  much finer relief field — ten to thirty centimetres over two or three metres —
  that is shaded and does *not* feed the water, because water finds contours tens
  of metres across and a metres-wide wobble would speckle every shoreline in the
  region with puddles the size of a bath. The shape that holds water and the
  shape that catches light are two different fields.
- **Water is the one kind of terrain a flat-plane renderer can draw honestly**,
  because real water is also flat. There is a stream — the one authored feature —
  crossing your path at about nineteen cells out, pinching to a channel and
  swelling into pools along its length, plus whatever hollows past the fall are
  deep enough to catch it. About a fifth of the field; the other four fifths are
  what make that fifth legible as water at all. The first draft had the rolling
  ground swinging a full metre either way with nothing lifting it, and half of
  everything in sight came out flooded, the stream vanished into the general
  wet, and you walked out of the door directly into it.
- **It reflects, properly.** For a mirror at z = 0 the elevation of the reflected
  ray is exactly the depression of the screen row, so one row of the sky texture
  answers a whole row of water and the painted treeline lands in the flood upside
  down. Reflectance runs from 33% underfoot to nearly all of it at grazing, which
  is Fresnel and is also why the far water is bright and the water at your feet
  shows you its bottom. The riffle that stops it being a sheet of glass is the
  ground texture's own noise — free, and the right noise, because the riffle *is*
  the ground showing through.
- **All of it is one 768 × 576 texture** stretched once over the region, sampled
  by absolute position and unfiltered. A texel is 78 cm, which would band a smooth
  gradient into visible squares — so rather than pay four fetches per floor pixel
  for bilinear, the mottling is baked in at greater amplitude than one texel's
  worth of gradient. Quantisation you cannot find because it is quieter than the
  noise on top of it. Heights are baked into an array first and the shading is a
  difference of that array; calling the field again per texel for a gradient
  costs five times the whole bake.

And things standing in it, with one rule: **nothing out here was put here.**
Everything in the building is something a person left behind, and a cardboard box
on the grass would make the ending a continuation of the building. So the field
gets things that grew, things that fell over, and one fence — the only evidence in
the whole ending that anybody ever owned this ground, and worth having for exactly
that. They are also the only objects in the game taller than a ceiling, which is
most of what sells the change.

- Placed against the **height field**, not the map: rushes at the waterline,
  boulders on a rise, and a drowned trunk where nothing living could stand, which
  is the best thing out there because it gives the flood a scale.
- The scatter is built **once into one flat array** and queried by distance. The
  per-cell walk the building uses is right for an eleven-cell draw radius and is
  nine thousand map lookups a frame at this one.
- **The far treeline stays painted** and always will. What the real ones are for
  is *parallax*, the one cue a painted horizon cannot give: three real trees
  between you and the line tell the eye the line is half a mile away. Thirty of
  them tell it you are in a wood, which is a different ending. Small things get
  much shorter radii than trees — grass at fourteen cells is already one pixel,
  and without those culls most of the draw list is tussocks contributing a pixel
  each.
- **The distant tree is fatter than the near one**, which looks wrong written
  down. A trunk drawn at its true width a hundred metres off is a one-pixel
  vertical line, and a one-pixel vertical dark line against a pale sky is exactly
  what the chromatic split in the post chain does its worst work on: the first
  version came out with a row of green and magenta sticks along the horizon. The
  fence had the same problem for the same reason and was moved from thirty-one
  cells out to twelve, where you go through it rather than look at it.
- And **the ground answers your feet**. Standing water is the only surface in the
  game that makes a sound of its own, and after nine minutes of carpet a splash
  is the field replying to you — which it can afford to be, because unlike
  everything else that has made a noise at you, the field does not want anything.

Two things that only showed up on screen:

- **The treeline is painted into the sky, and the sky is allowed three rows below
  the horizon.** A flat field converges on the fog colour within a couple of
  screen rows — your eye is a metre and a half up — so the last of it came out as
  a clean pale band, which under a dark treeline reads as standing water. The
  cause is that trees painted at infinity occlude nothing, where a real treeline
  stands *on* the ground. Row zero of the sky texture is unbroken trunk at every
  bearing, so those three rows paint exactly the base of it.
- **Walls outside are shaded to 42%.** Everything out there is lit by the sky,
  and a vertical face sees half the dome where the ground sees all of it. Without
  it, the ambient that makes the field read at all turns the building into sunlit
  sandstone, and the frontage has to be a dark mass with a pale sky behind it.

You get about eleven seconds of walking (26 units from the door) or forty seconds
of standing still, whichever comes first, and never less than six and a half —
long enough for the fog to finish opening. Then the sky overexposes over 2.4
seconds and the card comes up out of the white. It is the only white cut in a
game where everything else ends in black, and the card is pale with dark type for
the same reason.

Measured on the frames above: **3.6 ms median outside against 7.4 ms inside**,
with sixty to a hundred field objects and 1,000–1,700 faces in shot. It is still
cheaper out there even carrying a landscape: no ceiling cast, and most rays never
hit anything.

### How long ending vi takes

Measured with a bot that walks the building on a wandering path and stops for
eight seconds whenever a ritual fires, which is roughly the informed player and
a good deal worse at exploring than a real one:

| | door appears |
|---|---|
| stops for rituals | **5.2, 5.7, 6.3 min** across three seeds |
| identical path, never stops | never — grace stays at **0** |

That second row is the whole point, and it is the same seed and the same route as
the first: this is not a thing you stumble into.

### How things leave

One clean fade to black is a transition. It tells you the game has decided the
scene is over, and it resolves the tension for you. Everything that vanishes now
takes the torch with it instead: three to five hard cuts to black with uneven
lit gaps between them, a relay click and a coil whine on each one, and partway
through that sequence the thing stops being there. You get one more lit frame of
it, then black, then a lit frame with nothing in it, then black again — and by
the time the light is properly back you are not sure which of those frames was
the real one.

The durations are drawn **gamma-shaped over a very wide range** (0.04–0.62 s
dark, 0.025–0.34 s lit, biased hard toward the short end), not uniformly over a
narrow one. Uniform draws gave every blackout roughly the same length and every
gap roughly the same length, and a torch failing on an even rhythm reads as an
effect rather than as a torch. Now most segments are a twitch and one or two per
sequence hold long enough that you think it is over and start moving again. The
dying-battery flicker underneath it does the same thing in three states — mostly
dark, sometimes a weak glow, occasionally something close to full brightness
that makes you believe it has come back — with a squared gap to the next one.

The creature's exit, the distant eyes, and both of the anomalies that put things
in the corridor with you all use it (`STUTTER` in `config.js`). Nothing fades
out any more; every one of them is at full strength on the last lit frame.

### Nothing is allowed to get close

Everything in this game is better at eleven metres than at four. A pair of red
points at the end of a corridor is a question; the same pair close enough to
resolve into a face is an answer, and the answer is always smaller than the
question was.

So an apparition does not wait out its timer. It checks how far away you are,
and the moment you start closing on it the torch fails and it is not there when
the light comes back — walking toward one is the fastest way to make it leave
(`KEEP_AWAY` in `config.js`: eyes at 8 units, the swarm at 7, the crowd at 6.5,
the landmark events at 7). The creature's own vanish radius has gone 1.15 →
2.4 → **4.4** over three passes and every step improved it for the same reason.
It should always be leaving one beat before you were ready.

### The jumpscare

Off for the creature, on for the hunter — and rebuilt, because the first one was
a pale evenly-lit skull that you could read in a single frame, which is the
failure mode of the whole genre: you get a clear look at a thing, the thing
turns out to be a shape, and the fear stops.

The face now sits at the very bottom of the range — most of it is eight or ten
out of 255 — so what you get is wet highlights and holes, and the shape has to be
assembled by you out of the parts that catch the light. It has **eight eyes**,
each one nudged off its mirror so the face nearly matches itself and does not;
a warped outline, because a clean superellipse is an egg; a jaw split down the
middle with two rows of uneven teeth; and it is bleeding heavily from the mouth
and from three of the sockets, wet enough that the runs carry their own
highlights.

The presentation does the rest: the frame **strobes** at roughly 14 Hz on an
uneven hash for the first two thirds and then simply holds — the moment it stops
strobing is the moment you realise it is not going to look away — with heavy
per-band tape tearing, a hard arterial grade, and **blood on the lens**
composited over everything, including the face, so there is something between
you and it.

### The horror events

- **The creature** — see above.
- **The answer to a gunshot** — see above.
- **Landmark events.** Each of the five stamped rooms owns one, armed the first
  time you walk in, using the shape of the room: ranks down the ward corridor, a
  ring around the atrium core, something looking up at you out of the shaft, the
  lattice of the combs filling in, and one pair on the chapel plinth that waits
  for you to come closer rather than for a timer. A room you recognise should
  not be a safe room. (`LANDMARK_EVENTS` in `config.js`.)

  **They aim now, and they wait.** The first version built one formation, then
  deleted every pair it could not see from where you happened to be standing —
  which threw away exactly the eyes a formation exists to place *behind* you (the
  far half of the atrium ring is on the other side of the core it is drawn
  around) — and if fewer than two survived it discarded the room's shape
  entirely and scattered the same number of pairs at random bearings. So the two
  best events in the game were the two most likely to arrive as confetti, and
  the ward's twelve pairs routinely arrived as three. Three separate faults
  behind it: the combs' lattice used a 4-cell pitch, which is precisely the
  pitch of its own pillar array, so every grid point was inside a pillar; the
  chapel's single pair went on the side of the plinth you were *standing* on,
  which is behind you as often as not; and the shaft's variant search took the
  first fully-visible formation it built, which was always the narrow one that
  found a single hole.

  Placement is now authored and only wall-tested — what you can *see* is the
  renderer's business, since it depth-tests billboards like everything else —
  and the director measures visibility only when deciding **when to fire**. It
  builds four candidate orientations, counts how many pairs land in your view
  cone, and either fires the best one or waits: the room gets six seconds of
  patience to catch you looking the right way, and it does not spend itself
  until it has. Walk out before it fires and it un-arms silently, unburned, and
  is still there next time. Measured across five seeds, from every open cell in
  every landmark, with the player turning at a casual 0.9 rad/s:

  | | fires | while you are looking | pairs placed |
  |---|---|---|---|
  | atrium | 100% | 100% | 10.0 of 10 |
  | shaft | 100% | 100% | 2.2 |
  | ward | 100% | 84% | 9.2 of 12 |
  | chapel | 100% | 80% | 1 of 1 |
  | combs | 100% | 94% | 6.9 of 8 |

  Out of patience, the room fires *in the place the room wanted it* rather than
  scattering — an altar at the foot of the plinth behind you is still an altar,
  the cue plays, and you have the rest of its life to turn round. The scatter
  survives only for the case where the template could not place anything at all.
  Redshift also lost its dread gate for ritual omens: it was gated at 0.30 as a
  random anomaly, and landmark rituals are the earliest authored thing that
  happens to you, so the colour meant to teach "something is about to happen
  here" was silent for exactly the events that would have taught it.
- **Phantom footsteps** approach from behind, and stop the instant you turn.
  Some cross your path and continue toward an unvisited landmark, using the same
  diegetic guide that leads to a missed pistol.
- **Lights flicker** in a stutter, then settle and die back to dark.
- **Distant eyes** open at the far end of whatever you can see down. This used
  to demand a clear eighteen-metre sightline, which the old open map had all
  over the place and the reworked one essentially never has — so they had
  quietly stopped appearing altogether. What matters is that they are at the
  limit of your light, not that the limit is far away.
- **A draft** comes up out of any hole in the floor within a few metres.
- **Distant sounds** — a door slamming, a radio finding a station, a child.
- **Whispers** drift past, panned, on randomised timers.
- **Anomalies**, gated so the session escalates:
  - *fog* — the air thickens and warms; neither hunter can begin a charge while
    it is at its densest
  - *silence* — the whole mix rolls off and the world goes flat; footsteps and
    charge warnings disappear, but a missed shot cannot schedule a second
    answer or hurry a hunter that is already present
  - *swarm* — a dozen pairs of eyes open in a directional wave: the last,
    largest pair marks the gun, a reserved hunter arrival, whatever is already
    following you, or (as its final fallback) the nearest unused landmark
  - *redshift* — the place turns arterial shortly before a hunter arrives or
    charges, or before a landmark ritual fires; it is never selected randomly
  - *blackout* — the torch simply stops, and the creature reliably arrives
    while it is off
  - *crowd* — the ceiling lights reveal ranks lining a real walkable route
    toward the unfound gun or a landmark within forty-eight cells. A room may be
    reused, so exploring nearby rituals no longer removes the congregation from
    the anomaly bag. The centre aisle is safe.
    One person-sized place in a ritual-bound rank is empty; deliberately
    standing beneath its single working ceiling panel and facing with them
    produces **the congregation** ending

Everything is gated behind a rising `dread` value, so the first minute is calm
and the place only turns on you later.

### Performance

The floor pass now has to ask every pixel below the horizon whether the ground
under it exists, which is about 65,000 extra cell lookups a frame. Two things
pay for it: each chunk records whether it contains a hole at all, so the whole
branch is skipped outside a landmark's neighbourhood; and `world.flags` was
rewritten to index chunks with a shift and a mask and a numeric map key with a
one-entry cache, instead of `Math.floor` and a string key per call. Median frame
time with pits on screen the entire time is **6.6 ms**, against 6.0–6.2 ms
before any of this existed.
