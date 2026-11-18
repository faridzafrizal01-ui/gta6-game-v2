// Solmar Bay: the city itself. A fixed-seed procedural layout so every player
// (and every screenshot) sees the same streets: a road grid, four districts,
// a marina beach along the south edge, parks, parking lots and named places
// the missions point at. All art is drawn from these rectangles at render time;
// there are no image assets anywhere in the game.

import { mulberry32, randInt, randRange, pick } from './util.js';

export const WORLD = 3520; // world is WORLD x WORLD pixels
export const BLOCK = 320; // distance between road centre lines
export const ROAD_W = 76; // road width in pixels
export const GRID_N = 11; // road lines at 0, 320, ..., 3520

const PALETTES = {
  downtown: ['#8a7f8d', '#7d7468', '#6f7a8c', '#93847a', '#84748a', '#5f6b7a'],
  marina: ['#e8d9b0', '#d9c9a3', '#f0e2c0', '#cbb98f'],
  suburb: ['#c9a98c', '#b98f7a', '#d4b49a', '#a98a72', '#c2a284'],
  industrial: ['#8c8f94', '#7a7d82', '#96918a', '#6e7278'],
};

// Named places the story and the minimap refer to.
export const PLACES = {
  garage: { x: 1600, y: 1600, name: "Vic's Garage" },
  docks: { x: 480, y: 3360, name: 'Solmar Docks' },
  club: { x: 3040, y: 480, name: 'Club Neón' },
  park: { x: 2080, y: 2080, name: 'Palmetto Park' },
  hospital: { x: 1120, y: 1120, name: 'St. Marina Hospital' },
  bank: { x: 2560, y: 1440, name: 'Bay Federal Bank' },
  rooftop: { x: 1760, y: 2560, name: 'Harbor View Tower' },
  spray: { x: 960, y: 2720, name: "Ray's Spray Shop" },
};

/** Which district a block column/row sits in. */
export function districtAt(bx, by) {
  const cx = bx - 5;
  const cy = by - 5;
  if (Math.abs(cx) <= 2 && Math.abs(cy) <= 2) return 'downtown';
  if (by >= 8) return 'marina';
  if (bx <= 2) return 'industrial';
  return 'suburb';
}

/** Build the whole city from a fixed seed. Deterministic: same seed, same city. */
export function buildCity(seed = 1337) {
  const rng = mulberry32(seed);
  const buildings = [];
  const trees = [];
  const parks = [];
  const lots = [];
  const lamps = [];

  for (let by = 0; by < GRID_N; by++) {
    for (let bx = 0; bx < GRID_N; bx++) {
      const x0 = bx * BLOCK + ROAD_W / 2 + 14;
      const y0 = by * BLOCK + ROAD_W / 2 + 14;
      const w = BLOCK - ROAD_W - 28;
      const district = districtAt(bx, by);
      const roll = rng();

      // The marina strip (bottom rows) is mostly beach and open ground.
      if (by >= 9) {
        if (roll < 0.55) {
          parks.push({ x: x0, y: y0, w, h: w, kind: 'beach' });
        } else if (roll < 0.75) {
          parks.push({ x: x0, y: y0, w, h: w, kind: 'sand' });
        }
        // fall through: a few low beach houses may still appear
        if (roll >= 0.75) {
          buildings.push(makeBuilding(rng, x0, y0, w, w, district, 1));
        }
        continue;
      }
      if (roll < 0.12) {
        parks.push({ x: x0, y: y0, w, h: w, kind: rng() < 0.5 ? 'park' : 'plaza' });
        scatterTrees(rng, trees, x0, y0, w, 5);
        continue;
      }
      if (roll < 0.22) {
        lots.push({ x: x0, y: y0, w, h: w });
        continue;
      }
      // One block = one big building, or a 2x2 of smaller ones. Trees only
      // grow in parks, never on rooftops.
      if (rng() < 0.45) {
        buildings.push(makeBuilding(rng, x0, y0, w, w, district, 0));
      } else {
        const half = w / 2 - 6;
        buildings.push(makeBuilding(rng, x0, y0, half, half, district, 0));
        buildings.push(makeBuilding(rng, x0 + half + 12, y0, half, half, district, 0));
        buildings.push(makeBuilding(rng, x0, y0 + half + 12, half, half, district, 0));
        buildings.push(makeBuilding(rng, x0 + half + 12, y0 + half + 12, half, half, district, 0));
      }
    }
  }

  // Street lamps along every road, every other block corner.
  for (let i = 0; i <= GRID_N; i++) {
    for (let j = 0; j <= GRID_N; j += 2) {
      lamps.push({ x: i * BLOCK + ROAD_W / 2 + 4, y: j * BLOCK - ROAD_W / 2 - 4 });
      lamps.push({ x: j * BLOCK - ROAD_W / 2 - 4, y: i * BLOCK + ROAD_W / 2 + 4 });
    }
  }

  return { buildings, trees, parks, lots, lamps, seed };
}

function makeBuilding(rng, x, y, w, h, district, forceLow) {
  const palette = PALETTES[district];
  const tall = district === 'downtown' ? randInt(rng, 26, 78) : district === 'industrial' ? randInt(rng, 12, 24) : randInt(rng, 10, 30);
  return {
    x, y, w, h,
    height: forceLow ? randInt(rng, 8, 16) : tall,
    color: pick(rng, palette),
    roof: pick(rng, ['#4a4f55', '#5b5148', '#3f5a52', '#6b5a6e', '#54423a']),
    district,
    windows: rng() < 0.8,
    helipad: district === 'downtown' && rng() < 0.12,
  };
}

function scatterTrees(rng, trees, x0, y0, w, n) {
  for (let i = 0; i < n; i++) {
    trees.push({
      x: x0 + randRange(rng, 12, w - 12),
      y: y0 + randRange(rng, 12, w - 12),
      r: randRange(rng, 7, 13),
      shade: pick(rng, ['#2f7a3d', '#3a8a45', '#276b34', '#4a9a4a']),
    });
  }
}

/** Is the point inside any building (with a small margin)? */
export function insideBuilding(city, x, y, margin = 2) {
  for (const b of city.buildings) {
    if (x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin) return b;
  }
  return null;
}

/** Nearest road centre line coordinate to a value (roads run every BLOCK px). */
export function nearestRoad(v) {
  return Math.round(v / BLOCK) * BLOCK;
}

/** Is the point on a road (within the asphalt band)? */
export function onRoad(x, y) {
  const rx = Math.abs(x - nearestRoad(x));
  const ry = Math.abs(y - nearestRoad(y));
  return rx <= ROAD_W / 2 || ry <= ROAD_W / 2;
}

/** Clamp a point into the world bounds. */
export function clampToWorld(x, y) {
  return {
    x: Math.max(24, Math.min(WORLD - 24, x)),
    y: Math.max(24, Math.min(WORLD - 24, y)),
  };
}
