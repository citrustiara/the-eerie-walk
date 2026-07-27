import { spatialProfile } from '../src/audio.js';
import { ANOMALIES, WORLD } from '../src/config.js';
import { Director } from '../src/director.js';
import { setNoiseSeed } from '../src/noise.js';
import { World } from '../src/world.js';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ''] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const seeds = (args.get('seeds') || '1337,7331,424242')
  .split(',')
  .map(Number)
  .filter(Number.isFinite);
const span = Math.max(5, Number(args.get('span') || 25) | 0);
const draws = Math.max(100, Number(args.get('draws') || 10000) | 0);

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

function freshScenario(seed) {
  // Do not move this outside the per-seed loop. Director state is session state:
  // landmark use, active anomalies and timers surviving between samples was the
  // source of the misleading console measurements this harness replaces.
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
  const director = new Director(audio, player, world, mulberry32(seed ^ 0x41c6ce57));
  return { world, player, director };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function blockSample(world) {
  const landmarks = [];
  const searchLandmarks = [];
  const blocks = [];
  const counts = {};
  const size = WORLD.artery;
  for (let by = -span; by <= span; by++) {
    for (let bx = -span; bx <= span; bx++) {
      const x = (bx + 0.5) * size;
      const y = (by + 0.5) * size;
      const landmark = world.landmarkAt(Math.floor(x), Math.floor(y));
      const block = { x, y, landmark };
      blocks.push(block);
      if (!landmark) continue;
      landmarks.push(block);
      counts[landmark] = (counts[landmark] || 0) + 1;
    }
  }
  // A halo keeps edge blocks honest: their nearest room may sit just outside
  // the 51x51 density sample and should not be treated as infinitely far away.
  const halo = 8;
  for (let by = -span - halo; by <= span + halo; by++) {
    for (let bx = -span - halo; bx <= span + halo; bx++) {
      const x = (bx + 0.5) * size;
      const y = (by + 0.5) * size;
      if (world.landmarkAt(Math.floor(x), Math.floor(y))) {
        searchLandmarks.push({ x, y });
      }
    }
  }
  const nearest = blocks.map((block) => {
    let best = Infinity;
    for (const landmark of searchLandmarks) {
      const d = Math.hypot(landmark.x - block.x, landmark.y - block.y);
      if (d < best) best = d;
    }
    return best;
  }).sort((a, b) => a - b);
  return {
    total: blocks.length,
    landmarks: landmarks.length,
    share: landmarks.length / blocks.length,
    types: counts,
    nearestMedian: percentile(nearest, 0.5),
    nearestP90: percentile(nearest, 0.9),
  };
}

function targetSample(player, director) {
  const size = WORLD.artery;
  let crowdEligible = 0;
  let crowdRoute = 0;
  let crowdReusable = 0;
  let swarmFallback = 0;
  let swarmAfterNearestUsed = 0;
  let samples = 0;

  // These are independent probes, not one simulated run. Clear the deliberate
  // mutation before every position so exploration from one probe cannot leak
  // into the next one.
  for (let by = -span; by <= span; by += 2) {
    for (let bx = -span; bx <= span; bx += 2) {
      let open = null;
      const x0 = bx * size, y0 = by * size;
      for (let y = 0; y < size && !open; y++) {
        for (let x = 0; x < size; x++) {
          if (director.world.blocked(x0 + x, y0 + y)) continue;
          open = { x: x0 + x + 0.5, y: y0 + y + 0.5 };
          break;
        }
      }
      if (!open) continue;
      player.x = open.x;
      player.y = open.y;
      director.landmarksUsed.clear();
      director.gunSite = null;
      director.hunterArrivalSpot = null;
      director.hunter = null;
      director.pendingRitual = null;
      director.creature = null;

      const crowd = director._crowdTarget();
      if (crowd) {
        crowdEligible++;
        if (director._buildCrowdRoute({}, crowd)) crowdRoute++;
        director.landmarksUsed.add(crowd.key);
        if (director._crowdTarget()?.key === crowd.key) crowdReusable++;
        director.landmarksUsed.clear();
      }
      const first = director._anomalyTarget();
      if (first?.landmark) {
        swarmFallback++;
        director.landmarksUsed.add(first.key);
        if (director._anomalyTarget()?.landmark) swarmAfterNearestUsed++;
      }
      samples++;
    }
  }
  return {
    samples,
    crowdEligible: crowdEligible / samples,
    crowdRoute: crowdRoute / samples,
    crowdReusable: crowdReusable / samples,
    swarmFallback: swarmFallback / samples,
    swarmAfterNearestUsed: swarmAfterNearestUsed / samples,
  };
}

const results = [];
for (const seed of seeds) {
  const { world, player, director } = freshScenario(seed);
  results.push({
    seed,
    blocks: blockSample(world),
    targets: targetSample(player, director),
  });
}

const avg = (pick) => results.reduce((sum, row) => sum + pick(row), 0) / results.length;
const targetAvailability = avg((row) => row.targets.crowdRoute);
const weights = Object.entries(ANOMALIES)
  .filter(([key, cfg]) => key !== 'redshift' && cfg.weight > 0)
  .reduce((sum, [key, cfg]) => {
    if (key === 'crowd') return sum + cfg.weight * targetAvailability;
    return sum + cfg.weight;
  }, 0);
const crowdDrawChance = ANOMALIES.crowd.weight * targetAvailability / weights;

console.log(JSON.stringify({
  settings: { seeds, span, sampledBlocksPerSeed: (span * 2 + 1) ** 2, draws },
  spatial: {
    front: spatialProfile(0),
    side: spatialProfile(Math.PI / 2),
    back: spatialProfile(Math.PI),
  },
  perSeed: results,
  aggregate: {
    landmarkShare: avg((row) => row.blocks.share),
    nearestLandmarkMedian: avg((row) => row.blocks.nearestMedian),
    nearestLandmarkP90: avg((row) => row.blocks.nearestP90),
    crowdTargetAvailability: avg((row) => row.targets.crowdEligible),
    crowdRouteAvailability: targetAvailability,
    crowdReuseAvailability: avg((row) => row.targets.crowdReusable),
    swarmFallbackAvailability: avg((row) => row.targets.swarmFallback),
    swarmAvailabilityAfterNearestUsed: avg(
      (row) => row.targets.swarmAfterNearestUsed,
    ),
    crowdChancePerFullDreadDraw: crowdDrawChance,
    expectedCrowdsInDraws: crowdDrawChance * draws,
  },
}, null, 2));
