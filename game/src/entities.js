// Everything that moves in Solmar Bay: the player (on foot and in a car),
// traffic cars, parked cars, pedestrians, police (on foot and in cruisers),
// bullets, particles and pickups. Plain objects, updated by the functions here.

import { clamp, dist, angleDiff, turnToward, randInt, pick } from './util.js';
import { WORLD, BLOCK, ROAD_W, insideBuilding, nearestRoad, clampToWorld } from './city.js';

const CAR_COLORS = ['#d33a2c', '#2c6fd3', '#e8b93c', '#3aa655', '#7a4fd0', '#e86a1f', '#c0c8d0', '#22262b', '#d3d3d3', '#2fb3a8'];
const CAR_NAMES = ['Vortex', 'Comet', 'Sandpiper', 'Mule', 'Falcon', 'Bison', 'Stinger', 'Cortez', 'Prowler', 'Dune'];
const PED_SHIRTS = ['#e05a4e', '#4e7de0', '#e0c34e', '#4ee07a', '#a04ee0', '#e08a4e', '#4ed8e0', '#e04e9a', '#f0f0f0', '#3a3f45'];
const PED_SKINS = ['#f2c89b', '#d9a06b', '#a9743f', '#8a5a2e', '#f7d7b0'];

let nextId = 1;

/** Make a car object. `kind` is 'traffic', 'parked', 'player' or 'police'. */
export function makeCar(x, y, angle, kind, rng) {
  const model = randInt(rng, 0, CAR_NAMES.length - 1);
  return {
    id: nextId++,
    kind,
    x, y, angle,
    speed: 0,
    maxSpeed: kind === 'police' ? 430 : randInt(rng, 300, 400),
    accel: kind === 'police' ? 300 : 230,
    name: CAR_NAMES[model],
    color: kind === 'police' ? '#1c2f4a' : CAR_COLORS[model],
    w: 46, h: 22,
    health: 100,
    driver: kind !== 'parked', // traffic cars carry a driver who flees when stolen
    dir: 0, // traffic heading: 0=E 1=S 2=W 3=N
    lane: 0,
    wait: 0,
    siren: kind === 'police',
    flashing: 0,
    ramCd: 0, // seconds until this cruiser may ram the player again
    crashCd: 0, // seconds until this car may damage the player again
    stolen: false,
  };
}

export function makePed(x, y, rng) {
  return {
    id: nextId++,
    x, y,
    angle: rng() * Math.PI * 2,
    speed: randInt(rng, 34, 62),
    shirt: pick(rng, PED_SHIRTS),
    skin: pick(rng, PED_SKINS),
    flee: 0, // seconds of fleeing left
    fleeX: 0, fleeY: 0,
    walkPhase: rng() * Math.PI * 2,
    dead: false,
    fade: 0,
  };
}

export function makePlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2,
    vx: 0, vy: 0,
    health: 100,
    armor: 0,
    cash: 0,
    inCar: null, // car object or null
    speed: 0,
    punchCd: 0,
    shootCd: 0,
    hurtFlash: 0,
    dead: false,
    busted: false,
  };
}

/** Spawn a traffic car on a random road, away from the player. */
export function spawnTrafficCar(city, player, rng) {
  for (let tries = 0; tries < 12; tries++) {
    const horizontal = rng() < 0.5;
    const road = randInt(rng, 1, 10) * BLOCK;
    const along = randInt(rng, 0, WORLD);
    const x = horizontal ? along : road;
    const y = horizontal ? road : along;
    if (dist(x, y, player.x, player.y) < 500) continue;
    const car = makeCar(x, y, 0, 'traffic', rng);
    car.dir = horizontal ? (rng() < 0.5 ? 0 : 2) : (rng() < 0.5 ? 1 : 3);
    car.angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][car.dir];
    car.lane = (rng() < 0.5 ? -1 : 1) * 19;
    car.speed = randInt(rng, 80, 130);
    return car;
  }
  return null;
}

/** Spawn a parked car inside a parking lot or along a road edge. */
export function spawnParkedCar(city, rng) {
  if (city.lots.length > 0 && rng() < 0.7) {
    const lot = pick(rng, city.lots);
    const car = makeCar(lot.x + 40 + rng() * (lot.w - 80), lot.y + 40 + rng() * (lot.w - 80), (Math.floor(rng() * 4) * Math.PI) / 2, 'parked', rng);
    return car;
  }
  const road = randInt(rng, 1, 10) * BLOCK;
  const along = randInt(rng, 60, WORLD - 60);
  const horizontal = rng() < 0.5;
  return makeCar(horizontal ? along : road + ROAD_W / 2 + 8, horizontal ? road + ROAD_W / 2 + 8 : along, horizontal ? 0 : Math.PI / 2, 'parked', rng);
}

/** Update one traffic car: cruise its road, turn at intersections, stop for jams. */
export function updateTrafficCar(car, dt, cars, rng) {
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const [dx, dy] = dirs[car.dir];
  // At an intersection, sometimes turn onto the crossing road.
  const nearX = Math.abs(car.x - nearestRoad(car.x)) < 14;
  const nearY = Math.abs(car.y - nearestRoad(car.y)) < 14;
  if (nearX && nearY && rng() < dt * 0.55) {
    const options = [0, 1, 2, 3].filter((d) => d !== (car.dir + 2) % 4);
    car.dir = pick(rng, options);
    car.angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][car.dir];
    car.lane = (rng() < 0.5 ? -1 : 1) * 19;
  }
  // Stop if another car is right ahead.
  let blocked = false;
  for (const other of cars) {
    if (other === car || other.kind === 'parked') continue;
    const ox = other.x - car.x;
    const oy = other.y - car.y;
    const ahead = ox * dx + oy * dy;
    const side = Math.abs(ox * -dy + oy * dx);
    if (ahead > 0 && ahead < 64 && side < 26) { blocked = true; break; }
  }
  const target = blocked ? 0 : 110;
  car.speed += clamp(target - car.speed, -260 * dt, 120 * dt);
  const nx = car.x + dx * car.speed * dt;
  const ny = car.y + dy * car.speed * dt;
  // Stay on the road: snap the off-axis coordinate to its lane.
  if (dx !== 0) {
    car.x = clamp(nx, 30, WORLD - 30);
    car.y = nearestRoad(car.y) + (car.dir === 0 ? car.lane : -car.lane);
    if (car.dir === 2) car.y = nearestRoad(car.y) - car.lane;
  } else {
    car.y = clamp(ny, 30, WORLD - 30);
    car.x = nearestRoad(car.x) + (car.dir === 1 ? -car.lane : car.lane);
  }
  car.angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][car.dir];
}

/** Update one pedestrian: stroll the sidewalks, flee from danger. */
export function updatePed(ped, dt, player, danger, city, rng) {
  if (ped.dead) { ped.fade += dt; return; }
  ped.walkPhase += dt * 8;
  const dPlayer = dist(ped.x, ped.y, player.x, player.y);
  if (danger && dPlayer < 260) {
    ped.flee = 1.6;
    ped.fleeX = ped.x - player.x;
    ped.fleeY = ped.y - player.y;
  }
  if (ped.flee > 0) {
    ped.flee -= dt;
    const len = Math.hypot(ped.fleeX, ped.fleeY) || 1;
    const sp = 150;
    movePed(ped, (ped.fleeX / len) * sp * dt, (ped.fleeY / len) * sp * dt);
    ped.angle = Math.atan2(ped.fleeY, ped.fleeX);
    return;
  }
  // Stroll: mostly straight, random turns at intersections; never walk through a building.
  const nearX = Math.abs(ped.x - nearestRoad(ped.x)) < 20;
  const nearY = Math.abs(ped.y - nearestRoad(ped.y)) < 20;
  if (nearX && nearY && rng() < dt * 0.5) ped.angle = (Math.floor(rng() * 4) * Math.PI) / 2;
  const sp = ped.speed;
  const nx = ped.x + Math.cos(ped.angle) * sp * dt;
  const ny = ped.y + Math.sin(ped.angle) * sp * dt;
  if (insideBuilding(city, nx, ny, 0)) {
    // Bumped into a wall: turn around instead of walking through it.
    ped.angle += Math.PI / 2;
    return;
  }
  movePed(ped, Math.cos(ped.angle) * sp * dt, Math.sin(ped.angle) * sp * dt);
}

function movePed(ped, dx, dy) {
  const nx = clamp(ped.x + dx, 24, WORLD - 24);
  const ny = clamp(ped.y + dy, 24, WORLD - 24);
  // Pedestrians stay out of buildings.
  ped.x = nx;
  ped.y = ny;
}

/** A police cruiser chasing the player along the road grid. */
export function updatePoliceCar(car, dt, player, cars) {
  const dx = player.x - car.x;
  const dy = player.y - car.y;
  const d = Math.hypot(dx, dy);
  // Desired heading: chase along the axis with the bigger gap (grid driving).
  let want;
  if (Math.abs(dx) > Math.abs(dy)) want = dx > 0 ? 0 : Math.PI;
  else want = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
  const speedNorm = clamp(car.speed / car.maxSpeed, 0, 1);
  car.angle = turnToward(car.angle, want, dt * (2.4 - speedNorm * 1.1));
  car.speed = clamp(car.speed + car.accel * dt, 0, car.maxSpeed);
  // Ram the player when close: slow a little so the touch registers as a hit.
  if (d < 90) car.speed = Math.min(car.speed, 200);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const c = clampToWorld(car.x, car.y);
  car.x = c.x;
  car.y = c.y;
  car.flashing += dt;
  // Nudge out of buildings (cruisers cut corners): push back along the last step.
  void cars;
}

/** A foot cop chasing the player. */
export function updateFootCop(cop, dt, player) {
  const dx = player.x - cop.x;
  const dy = player.y - cop.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = 235;
  cop.x += (dx / d) * sp * dt;
  cop.y += (dy / d) * sp * dt;
  cop.angle = Math.atan2(dy, dx);
  cop.flashing += dt;
}

export function makeFootCop(x, y) {
  return { id: nextId++, kind: 'cop', x, y, angle: 0, health: 100, flashing: 0, punchCd: 0 };
}

/** Move the player's car with arcade handling: accel, brake, steering by speed. */
export function driveCar(player, car, input, dt, city) {
  const axis = input.moveAxis();
  const forward = -axis.y; // W = forward
  const steer = axis.x;
  if (forward > 0) car.speed += car.accel * dt;
  else if (forward < 0) car.speed -= (car.speed > 0 ? 340 : 170) * dt;
  else {
    // Rolling resistance and drag.
    car.speed -= car.speed * 0.55 * dt;
    if (Math.abs(car.speed) < 4) car.speed = 0;
  }
  if (input.down('Space')) car.speed -= Math.sign(car.speed) * 420 * dt; // handbrake
  car.speed = clamp(car.speed, -140, car.maxSpeed);
  const steerRate = 2.1 * clamp(Math.abs(car.speed) / 120, 0.25, 1);
  car.angle += steer * steerRate * dt * Math.sign(car.speed || 1);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  // Buildings stop the car (with a bounce and damage at speed).
  const hit = insideBuilding(city, nx, ny, 0);
  if (hit) {
    if (Math.abs(car.speed) > 180) {
      car.health -= 12;
      player.hurtFlash = 0.25;
    }
    car.speed *= -0.25;
  } else {
    car.x = clamp(nx, 24, WORLD - 24);
    car.y = clamp(ny, 24, WORLD - 24);
  }
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = car.speed;
}

/** Move the player on foot. */
export function walkPlayer(player, input, dt, city) {
  const axis = input.moveAxis();
  const len = Math.hypot(axis.x, axis.y) || 1;
  const running = input.down('ShiftLeft') || input.down('ShiftRight');
  const speed = running ? 265 : 165;
  const dx = (axis.x / len) * speed * dt;
  const dy = (axis.y / len) * speed * dt;
  if (axis.x !== 0 || axis.y !== 0) player.angle = Math.atan2(axis.y, axis.x);
  // Slide along buildings: try each axis separately.
  if (!insideBuilding(city, player.x + dx, player.y, 0)) player.x += dx;
  if (!insideBuilding(city, player.x, player.y + dy, 0)) player.y += dy;
  const c = clampToWorld(player.x, player.y);
  player.x = c.x;
  player.y = c.y;
  player.speed = axis.x !== 0 || axis.y !== 0 ? speed : 0;
}

/** A bullet fired by the player (or a cop). */
export function makeBullet(x, y, angle, owner) {
  return { x, y, angle, speed: 760, life: 0.7, owner, dead: false };
}

export function updateBullet(b, dt, city) {
  b.x += Math.cos(b.angle) * b.speed * dt;
  b.y += Math.sin(b.angle) * b.speed * dt;
  b.life -= dt;
  if (b.life <= 0 || insideBuilding(city, b.x, b.y, 0)) b.dead = true;
}

/** A burst of sparks / smoke / blood. */
export function makeParticles(x, y, color, n, speed = 120) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    out.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, max: 0.9, color, size: 2 + Math.random() * 3 });
  }
  return out;
}

export function updateParticles(list, dt) {
  for (const p of list) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life -= dt;
  }
  return list.filter((p) => p.life > 0);
}
