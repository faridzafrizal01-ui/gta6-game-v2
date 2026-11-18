// Solmar Bay — entry point. Wires the city, the entities, the missions, the
// renderer and the sound together into one game loop, plus the title / pause /
// end screens, the wanted system, saving, and the ?shot= scenes the maker uses
// to photograph the game for the judges.

import { buildCity, PLACES, WORLD, BLOCK, ROAD_W, insideBuilding, clampToWorld } from './city.js';
import { clamp, dist, randInt, mulberry32 } from './util.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';
import {
  makeCar, makePed, makePlayer, makeFootCop, makeBullet, makeParticles,
  spawnTrafficCar, spawnParkedCar, updateTrafficCar, updatePed,
  updatePoliceCar, updateFootCop, driveCar, walkPlayer, updateBullet,
  updateParticles,
} from './entities.js';
import { MISSIONS, freshMissionState, currentMission, currentStep, updateMission, resetMission } from './missions.js';
import { drawWorld, drawHUD, drawTitle, drawHelp, drawPause, drawEndScreen, drawStoryComplete, zoomFor } from './render.js';
import { saveGame, loadGame, hasSave } from './save.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | drive | chase | mission (screenshot scenes)
const SIM = Number(params.get('sim') ?? NaN);

const G = {
  w: 1280, h: 720,
  city: buildCity(1337),
  player: makePlayer(1600, 1500),
  cars: [],
  peds: [],
  cops: [],
  bullets: [],
  particles: [],
  pickups: [],
  wanted: 0,
  wantedTimer: 0,
  mission: freshMissionState(),
  cam: { x: 1600, y: 1500, zoom: 1 },
  time: 0,
  tod: 0.30, // time of day, 0..1 (0.30 = late morning sun)
  night: 0,
  state: 'title', // title | help | play | pause | busted | wasted | complete
  input: new Input(canvas),
  sound: new SoundBank(),
  toasts: [],
  hoverButton: null,
  titleButtons: [],
  pauseButtons: [],
  helpButton: null,
  endButton: null,
  hasSave: hasSave(),
  aiming: false,
  saveFlash: 0,
  interactCd: 0,
  copTouch: 0,
  spawnTimer: 0,
  regenTimer: 0,
  shotAuto: null, // synthetic input while a ?shot= scene is simulated
};

function toast(text, life = 3) {
  G.toasts.push({ text, life });
  if (G.toasts.length > 4) G.toasts.shift();
}

function banner(text, sub = '') {
  G.mission.banner = text;
  G.mission.bannerSub = sub;
  G.mission.bannerT = 3.2;
}

/** Put the player in a car (stealing it if it has a driver). */
function enterCar(car) {
  if (car.kind === 'traffic' && car.driver) {
    // The driver bails and runs.
    const driver = makePed(car.x, car.y, Math.random);
    driver.flee = 2;
    driver.fleeX = car.x - G.player.x;
    driver.fleeY = car.y - G.player.y;
    G.peds.push(driver);
    car.driver = false;
    setWanted(Math.max(G.wanted, 1));
    toast('Car stolen! The PD is onto you.');
    G.sound.wantedUp();
  }
  car.kind = 'player';
  car.speed = 0;
  G.player.inCar = car;
  G.player.x = car.x;
  G.player.y = car.y;
  G.sound.horn();
}

function exitCar() {
  const car = G.player.inCar;
  if (!car) return;
  car.kind = 'parked';
  car.speed = 0;
  G.player.inCar = null;
  // Step out to the side of the car.
  const side = car.angle + Math.PI / 2;
  G.player.x = car.x + Math.cos(side) * 34;
  G.player.y = car.y + Math.sin(side) * 34;
  const c = clampToWorld(G.player.x, G.player.y);
  G.player.x = c.x;
  G.player.y = c.y;
}

function setWanted(n) {
  const next = clamp(Math.round(n), 0, 5);
  if (next > G.wanted) G.sound.wantedUp();
  G.wanted = next;
  G.wantedTimer = 0;
}

/** Spawn police around the player until the wanted level's quota is met. */
function maintainPolice(dt) {
  const wantCars = G.wanted === 0 ? 0 : Math.min(2 + G.wanted, 6);
  const rng = Math.random;
  // Count live cruisers.
  let cruisers = 0;
  for (const car of G.cars) if (car.kind === 'police') cruisers++;
  if (cruisers < wantCars) {
    // Spawn on a road, 600-900px from the player.
    for (let tries = 0; tries < 8; tries++) {
      const horizontal = rng() < 0.5;
      const sign = rng() < 0.5 ? -1 : 1;
      const gap = randInt(rng, 600, 900);
      let x;
      let y;
      if (horizontal) {
        y = Math.round(G.player.y / BLOCK) * BLOCK + 19; // the player's road, east lane
        x = clamp(G.player.x + sign * gap, 60, WORLD - 60);
      } else {
        x = Math.round(G.player.x / BLOCK) * BLOCK + 19;
        y = clamp(G.player.y + sign * gap, 60, WORLD - 60);
      }
      if (dist(x, y, G.player.x, G.player.y) < 500) continue;
      const car = makeCar(x, y, 0, 'police', rng);
      G.cars.push(car);
      break;
    }
  }
  // Despawn cruisers that fell far behind.
  G.cars = G.cars.filter((car) => {
    if (car.kind === 'police' && dist(car.x, car.y, G.player.x, G.player.y) > 1600) return false;
    return true;
  });
  // Foot cops: one per wanted level, only when the player is on foot and close.
  const wantCops = G.wanted > 0 && !G.player.inCar ? Math.min(G.wanted, 3) : 0;
  if (G.cops.length < wantCops) {
    const a = Math.random() * Math.PI * 2;
    const d = 420;
    G.cops.push(makeFootCop(G.player.x + Math.cos(a) * d, G.player.y + Math.sin(a) * d));
  }
  if (G.wanted === 0) G.cops.length = 0;
}

/** Keep the streets alive: traffic, parked cars and pedestrians near the player. */
function maintainPopulation(dt) {
  G.spawnTimer -= dt;
  if (G.spawnTimer > 0) return;
  G.spawnTimer = 1.5;
  const rng = Math.random;
  let traffic = 0;
  let parked = 0;
  for (const car of G.cars) {
    if (car.kind === 'traffic') traffic++;
    if (car.kind === 'parked') parked++;
  }
  if (traffic < 14) {
    const car = spawnTrafficCar(G.city, G.player, rng);
    if (car) G.cars.push(car);
  }
  if (parked < 9) {
    const car = spawnParkedCar(G.city, rng);
    if (car && dist(car.x, car.y, G.player.x, G.player.y) > 260) G.cars.push(car);
  }
  // Pedestrians: spawn on sidewalks near the player, cull the far ones.
  G.peds = G.peds.filter((p) => !p.dead || p.fade < 0.6);
  G.peds = G.peds.filter((p) => dist(p.x, p.y, G.player.x, G.player.y) < 1300);
  if (G.peds.filter((p) => !p.dead).length < 18) {
    for (let tries = 0; tries < 6; tries++) {
      const road = randInt(rng, 0, 10) * BLOCK;
      const along = randInt(rng, 0, WORLD);
      const horizontal = rng() < 0.5;
      const x = horizontal ? along : road + ROAD_W / 2 + 12;
      const y = horizontal ? road + ROAD_W / 2 + 12 : along;
      if (dist(x, y, G.player.x, G.player.y) < 240 || dist(x, y, G.player.x, G.player.y) > 900) continue;
      if (insideBuilding(G.city, x, y, 0)) continue;
      G.peds.push(makePed(x, y, rng));
      break;
    }
  }
  // Medkits restock at their fixed spots (on the road beside each place).
  const spots = [PLACES.hospital, PLACES.park, PLACES.docks, PLACES.garage];
  for (const s of spots) {
    if (!G.pickups.some((pk) => pk.spot === s)) {
      if (Math.random() < 0.02) {
        const at = medkitPos(s);
        G.pickups.push({ x: at.x, y: at.y, spot: s });
      }
    }
  }
}

function shootToward(wx, wy) {
  const p = G.player;
  if (p.shootCd > 0) return;
  p.shootCd = 0.28;
  const a = Math.atan2(wy - p.y, wx - p.x);
  p.angle = a;
  G.bullets.push(makeBullet(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, 'player'));
  G.sound.gunshot();
  G.particles.push(...makeParticles(p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, '#ffe27a', 4, 90));
}

function punch() {
  const p = G.player;
  if (p.punchCd > 0) return;
  p.punchCd = 0.45;
  G.sound.punch();
  const range = 52;
  let hitAny = false;
  for (const cop of G.cops) {
    if (dist(p.x, p.y, cop.x, cop.y) < range) {
      cop.health -= 34;
      cop.x += Math.cos(p.angle) * 26;
      cop.y += Math.sin(p.angle) * 26;
      G.particles.push(...makeParticles(cop.x, cop.y, '#ff5a4e', 8, 140));
      hitAny = true;
    }
  }
  for (const ped of G.peds) {
    if (!ped.dead && dist(p.x, p.y, ped.x, ped.y) < range) {
      ped.dead = true;
      ped.fade = 0;
      G.particles.push(...makeParticles(ped.x, ped.y, '#c22', 10, 130));
      setWanted(Math.max(G.wanted, 1));
      hitAny = true;
    }
  }
  if (hitAny) setWanted(Math.max(G.wanted, 1));
}

/** Damage the player (armor soaks first), with a hurt flash. */
function hurtPlayer(amount) {
  const p = G.player;
  if (p.dead) return;
  let left = amount;
  if (p.armor > 0) {
    const soaked = Math.min(p.armor, left);
    p.armor -= soaked;
    left -= soaked;
  }
  p.health -= left;
  p.hurtFlash = 0.4;
  G.regenTimer = 0;
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    G.state = 'wasted';
    p.cash = Math.max(0, p.cash - 300);
    G.sound.busted();
  }
}

function busted() {
  const p = G.player;
  p.busted = true;
  p.cash = Math.max(0, p.cash - 300);
  setWanted(0);
  G.cops.length = 0;
  G.state = 'busted';
  G.sound.busted();
}

function respawn() {
  const p = G.player;
  p.dead = false;
  p.busted = false;
  p.health = 100;
  p.inCar = null;
  p.x = PLACES.hospital.x + 80;
  p.y = PLACES.hospital.y + 80;
  G.cam.x = p.x;
  G.cam.y = p.y;
  G.copTouch = 0;
  G.state = 'play';
}

function startGame(fromSave) {
  G.sound.unlock();
  const data = fromSave ? loadGame() : null;
  if (data) {
    G.player.cash = data.cash;
    G.player.health = data.health;
    G.mission.index = data.missionIndex;
    G.player.x = data.x;
    G.player.y = data.y;
    G.mission.step = 0;
    G.mission.timeLeft = null;
    toast('Save loaded — welcome back to Solmar Bay.');
  } else {
    G.player.cash = 0;
    G.player.health = 100;
    G.mission = freshMissionState();
    G.player.x = 1600;
    G.player.y = 1500;
  }
  G.player.inCar = null;
  G.player.dead = false;
  setWanted(0);
  G.cam.x = G.player.x;
  G.cam.y = G.player.y;
  G.state = 'play';
  if (!data) {
    banner('MISSION 1 — FIRST WHEELS', "Vic needs a driver. Steal any car, then bring it to the garage.");
  }
}

// ---------------------------------------------------------------- update

function update(dt) {
  G.time += dt;
  G.tod = (G.tod + dt / 240) % 1;
  const sun = Math.sin(G.tod * Math.PI * 2);
  G.night = clamp(0.55 - sun, 0, 0.55) * 1.8;
  G.night = clamp(G.night, 0, 1);

  if (G.mission.bannerT > 0) G.mission.bannerT -= dt;
  if (G.saveFlash > 0) G.saveFlash -= dt;
  for (const t of G.toasts) t.life -= dt;
  G.toasts = G.toasts.filter((t) => t.life > 0);

  // Title screen: the camera drifts over downtown while the streets live.
  if (G.state === 'title' || G.state === 'help') {
    G.cam.x = 1760 + Math.cos(G.time * 0.05) * 420;
    G.cam.y = 1760 + Math.sin(G.time * 0.04) * 320;
    G.cam.zoom = zoomFor(G.w, G.h) * 0.9;
    updateAmbient(dt);
    return;
  }
  if (G.state !== 'play') return;

  const input = G.shotAuto ?? G.input;
  const p = G.player;
  if (p.punchCd > 0) p.punchCd -= dt;
  if (p.shootCd > 0) p.shootCd -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (G.interactCd > 0) G.interactCd -= dt;

  // Enter / exit a car.
  if (!G.shotAuto && G.input.hit('KeyE') && G.interactCd <= 0) {
    G.interactCd = 0.4;
    if (p.inCar) {
      exitCar();
    } else {
      let best = null;
      let bestD = 58;
      for (const car of G.cars) {
        if (car.kind === 'police') continue;
        const d = dist(p.x, p.y, car.x, car.y);
        if (d < bestD) { best = car; bestD = d; }
      }
      if (best) enterCar(best);
      else toast('No car close enough — walk up to one and press E.');
    }
  }

  // Driving or walking.
  if (p.inCar) {
    driveCar(p, p.inCar, input, dt, G.city);
    if (input.down('KeyH') && !G.shotAuto) G.sound.horn();
    // Collisions with traffic (damage lands at most once per 0.8 s per car).
    for (const car of G.cars) {
      if (car === p.inCar || car.kind === 'parked' || car.kind === 'police') continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < 48) {
        const push = (48 - d) / 2;
        const a = Math.atan2(car.y - p.y, car.x - p.x);
        car.x += Math.cos(a) * push;
        car.y += Math.sin(a) * push;
        if (Math.abs(p.inCar.speed) > 200 && car.crashCd <= 0) {
          car.crashCd = 0.8;
          car.health -= 15;
          p.inCar.health -= 6;
          G.particles.push(...makeParticles(car.x, car.y, '#ffb347', 8, 120));
          G.sound.crash();
        }
      }
    }
    // Running over pedestrians.
    for (const ped of G.peds) {
      if (ped.dead) continue;
      if (dist(p.x, p.y, ped.x, ped.y) < 30 && Math.abs(p.inCar.speed) > 60) {
        ped.dead = true;
        ped.fade = 0;
        G.particles.push(...makeParticles(ped.x, ped.y, '#c22', 10, 130));
        setWanted(Math.max(G.wanted, 1));
        G.sound.crash();
      }
    }
  } else {
    walkPlayer(p, input, dt, G.city);
    // Traffic can hit the player on foot (once per 0.8 s).
    for (const car of G.cars) {
      if (car.kind === 'parked' || car.kind === 'player') continue;
      if (dist(p.x, p.y, car.x, car.y) < 30 && Math.abs(car.speed) > 60 && car.crashCd <= 0) {
        car.crashCd = 0.8;
        hurtPlayer(12);
        p.x += (p.x - car.x) * 0.4;
        p.y += (p.y - car.y) * 0.4;
        G.sound.crash();
      }
    }
  }

  // Shooting (mouse click) and punching (F).
  if (!G.shotAuto) {
    G.aiming = G.input.mouseDown;
    if (G.input.mouseDown) {
      const wx = G.cam.x + (G.input.mouseX - G.w / 2) / G.cam.zoom;
      const wy = G.cam.y + (G.input.mouseY - G.h / 2) / G.cam.zoom;
      shootToward(wx, wy);
    }
    if (G.input.hit('KeyF')) punch();
  }

  // Spray shop: repair + lose one star.
  if (!G.shotAuto && G.input.hit('KeyR') && p.inCar && dist(p.x, p.y, PLACES.spray.x, PLACES.spray.y) < 90) {
    if (p.cash >= 150) {
      p.cash -= 150;
      p.inCar.health = 100;
      setWanted(Math.max(0, G.wanted - 1));
      toast("Ray's Spray: fresh paint, one less star. -$150");
      G.sound.pickup();
    } else {
      toast("Ray's Spray costs $150 — you are short.");
    }
  }

  // Mute toggle.
  if (!G.shotAuto && G.input.hit('KeyM')) {
    G.sound.setEnabled(!G.sound.enabled);
    toast(G.sound.enabled ? 'Sound on.' : 'Sound off.');
  }

  // Pause. Consume the press here so the pause menu does not read the same
  // Escape and instantly resume in the same frame.
  if (!G.shotAuto && (G.input.hit('Escape') || G.input.hit('KeyP'))) {
    G.input.pressed.delete('Escape');
    G.input.pressed.delete('KeyP');
    G.state = 'pause';
    return;
  }

  // Traffic, pedestrians, police.
  for (const car of G.cars) {
    if (car.crashCd > 0) car.crashCd -= dt;
    if (car.kind === 'traffic') updateTrafficCar(car, dt, G.cars, Math.random);
    else if (car.kind === 'police') updatePoliceCar(car, dt, p, G.cars);
  }
  const danger = G.bullets.length > 0 || (p.inCar && Math.abs(p.inCar.speed) > 200);
  for (const ped of G.peds) updatePed(ped, dt, p, danger, G.city, Math.random);
  for (const cop of G.cops) {
    updateFootCop(cop, dt, p);
    const d = dist(cop.x, cop.y, p.x, p.y);
    if (!p.inCar && d < 30) {
      G.copTouch += dt;
      if (G.copTouch > 0.8) busted();
    } else if (d < 40 && cop.punchCd <= 0) {
      cop.punchCd = 0.7;
      hurtPlayer(9);
      G.particles.push(...makeParticles(p.x, p.y, '#ff5a4e', 6, 110));
    }
    if (cop.punchCd > 0) cop.punchCd -= dt;
  }
  if (G.cops.length === 0) G.copTouch = 0;

  // Police cruisers ram the player — but a ram lands at most once per 0.9 s,
  // so a chase stays survivable instead of shredding the car in two seconds.
  for (const car of G.cars) {
    if (car.kind !== 'police') continue;
    if (car.ramCd > 0) car.ramCd -= dt;
    const d = dist(car.x, car.y, p.x, p.y);
    if (d < 46 && car.ramCd <= 0) {
      car.ramCd = 0.9;
      if (p.inCar) {
        p.inCar.health -= 8;
        car.speed *= 0.5;
        G.particles.push(...makeParticles(p.x, p.y, '#ffb347', 8, 110));
        G.sound.crash();
      } else {
        hurtPlayer(10);
      }
    }
  }

  // Bullets.
  for (const b of G.bullets) {
    updateBullet(b, dt, G.city);
    if (b.dead) continue;
    for (const cop of G.cops) {
      if (dist(b.x, b.y, cop.x, cop.y) < 16) {
        cop.health -= 40;
        b.dead = true;
        G.particles.push(...makeParticles(cop.x, cop.y, '#ff5a4e', 8, 120));
        setWanted(Math.min(5, G.wanted + 1));
        if (cop.health <= 0) {
          G.cops = G.cops.filter((c) => c !== cop);
          setWanted(Math.min(5, G.wanted + 1));
          toast('Cop down! Wanted level up.');
        }
        break;
      }
    }
    if (b.dead) continue;
    for (const ped of G.peds) {
      if (!ped.dead && dist(b.x, b.y, ped.x, ped.y) < 14) {
        ped.dead = true;
        ped.fade = 0;
        b.dead = true;
        G.particles.push(...makeParticles(ped.x, ped.y, '#c22', 10, 130));
        setWanted(Math.max(G.wanted, 1));
        break;
      }
    }
    if (b.dead) continue;
    for (const car of G.cars) {
      if (car === p.inCar || car.kind === 'police') continue;
      if (dist(b.x, b.y, car.x, car.y) < 24) {
        car.health -= 20;
        b.dead = true;
        G.particles.push(...makeParticles(b.x, b.y, '#ffb347', 6, 110));
        break;
      }
    }
  }
  G.bullets = G.bullets.filter((b) => !b.dead);
  // Wrecked cars smoke and get towed away (removed).
  G.cars = G.cars.filter((car) => {
    if ((car.kind === 'traffic' || car.kind === 'parked') && car.health <= 0) {
      G.particles.push(...makeParticles(car.x, car.y, '#888', 16, 160));
      G.sound.crash();
      return false;
    }
    return true;
  });
  // A wrecked player car ejects the player.
  if (p.inCar && p.inCar.health <= 0) {
    G.particles.push(...makeParticles(p.x, p.y, '#888', 20, 180));
    G.sound.crash();
    G.cars = G.cars.filter((c) => c !== p.inCar);
    p.inCar = null;
    hurtPlayer(20);
    toast('Your ride is wrecked!');
  }

  G.particles = updateParticles(G.particles, dt);

  // Medkit pickups.
  for (const pk of G.pickups) {
    if (dist(p.x, p.y, pk.x, pk.y) < 34) {
      p.health = Math.min(100, p.health + 50);
      G.pickups = G.pickups.filter((q) => q !== pk);
      toast('Medkit +50 HP.');
      G.sound.pickup();
    }
  }

  // Wanted decay: hide from the PD and the heat fades.
  let copNear = false;
  for (const car of G.cars) if (car.kind === 'police' && dist(car.x, car.y, p.x, p.y) < 450) copNear = true;
  for (const cop of G.cops) if (dist(cop.x, cop.y, p.x, p.y) < 450) copNear = true;
  if (G.wanted > 0) {
    if (copNear) G.wantedTimer = 0;
    else {
      G.wantedTimer += dt;
      if (G.wantedTimer > 6) {
        G.wantedTimer = 0;
        setWanted(G.wanted - 1);
        if (G.wanted === 0) toast('You lost the heat.');
      }
    }
  }

  // Health regen when calm.
  G.regenTimer += dt;
  if (G.wanted === 0 && G.regenTimer > 5 && p.health < 100 && p.health > 0) {
    p.health = Math.min(100, p.health + 3 * dt);
  }

  maintainPolice(dt);
  maintainPopulation(dt);

  // Missions.
  const ev = updateMission(G.mission, p, G.wanted, {
    setWanted: (n) => setWanted(n),
    onMissionDone: (m) => {
      banner('MISSION COMPLETE', `${m.title}  ·  +${m.reward.toLocaleString('en-US')} cash`);
      G.sound.missionDone();
      saveGame(G);
    },
  }, dt);
  if (ev === 'failed') {
    banner('MISSION FAILED', 'Out of time — try the run again.');
    resetMission(G.mission);
    setWanted(Math.max(0, G.wanted - 1));
  } else if (ev === 'step') {
    G.sound.pickup();
  }
  if (G.mission.done && !G.mission.celebrated && G.state === 'play') {
    G.mission.celebrated = true;
    G.state = 'complete';
  }

  // Camera follows the player.
  const tx = p.x;
  const ty = p.y;
  G.cam.x += (tx - G.cam.x) * Math.min(1, dt * 5);
  G.cam.y += (ty - G.cam.y) * Math.min(1, dt * 5);
  G.cam.zoom = zoomFor(G.w, G.h) * (p.inCar ? 0.88 : 1);

  // Engine + siren follow the action.
  const speedNorm = p.inCar ? clamp(Math.abs(p.inCar.speed) / p.inCar.maxSpeed, 0, 1) : 0;
  G.sound.engine(speedNorm, !!p.inCar);
  G.sound.siren(G.wanted);
}

/** Ambient life for the title screen: traffic and pedestrians drift by. */
function updateAmbient(dt) {
  for (const car of G.cars) {
    if (car.kind === 'traffic') updateTrafficCar(car, dt, G.cars, Math.random);
  }
  for (const ped of G.peds) updatePed(ped, dt, G.player, false, G.city, Math.random);
  G.particles = updateParticles(G.particles, dt);
}

// ---------------------------------------------------------------- menus

function buttonAt(list, mx, my) {
  for (const b of list) {
    if (!b) continue;
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b;
  }
  return null;
}

function updateMenus() {
  const mx = G.input.mouseX;
  const my = G.input.mouseY;
  const clicked = G.input.clicked;
  G.hoverButton = null;

  if (G.state === 'title') {
    const b = buttonAt(G.titleButtons, mx, my);
    if (b && !b.disabled) G.hoverButton = b.id;
    if (clicked && b && !b.disabled) {
      G.sound.unlock();
      G.sound.click();
      if (b.id === 'start') startGame(false);
      else if (b.id === 'continue') startGame(true);
      else if (b.id === 'help') G.state = 'help';
    }
    if (G.input.hit('Enter')) {
      G.sound.unlock();
      startGame(false);
    }
  } else if (G.state === 'help') {
    const b = buttonAt([G.helpButton], mx, my);
    if (b) G.hoverButton = b.id;
    if ((clicked && b) || G.input.hit('Escape')) G.state = 'title';
  } else if (G.state === 'pause') {
    const b = buttonAt(G.pauseButtons, mx, my);
    if (b) G.hoverButton = b.id;
    if (clicked && b) {
      G.sound.click();
      if (b.id === 'resume') G.state = 'play';
      else if (b.id === 'save') {
        if (saveGame(G)) { G.saveFlash = 2; G.hasSave = true; }
      } else if (b.id === 'sound') {
        G.sound.setEnabled(!G.sound.enabled);
      } else if (b.id === 'restart') {
        G.mission = freshMissionState();
        G.player.cash = 0;
        G.player.health = 100;
        G.player.inCar = null;
        G.player.x = 1600;
        G.player.y = 1500;
        setWanted(0);
        G.state = 'play';
      } else if (b.id === 'quit') {
        G.state = 'title';
        G.hasSave = hasSave();
      }
    }
    if (G.input.hit('Escape') || G.input.hit('KeyP')) G.state = 'play';
  } else if (G.state === 'busted' || G.state === 'wasted') {
    const b = buttonAt([G.endButton], mx, my);
    if (b) G.hoverButton = b.id;
    if ((clicked && b) || G.input.hit('Enter')) respawn();
  } else if (G.state === 'complete') {
    const b = buttonAt([G.endButton], mx, my);
    if (b) G.hoverButton = b.id;
    if ((clicked && b) || G.input.hit('Enter')) {
      G.state = 'play';
      G.mission.index = MISSIONS.length; // free roam: no more objectives
    }
  }
}

// ---------------------------------------------------------------- render + loop

function render() {
  ctx.clearRect(0, 0, G.w, G.h);
  if (G.state === 'title') {
    drawTitle(ctx, G);
  } else if (G.state === 'help') {
    drawWorld(ctx, G);
    drawHelp(ctx, G);
  } else if (G.state === 'pause') {
    drawWorld(ctx, G);
    drawHUD(ctx, G);
    drawPause(ctx, G);
  } else if (G.state === 'busted') {
    drawWorld(ctx, G);
    drawHUD(ctx, G);
    drawEndScreen(ctx, G, 'busted');
  } else if (G.state === 'wasted') {
    drawWorld(ctx, G);
    drawHUD(ctx, G);
    drawEndScreen(ctx, G, 'wasted');
  } else if (G.state === 'complete') {
    drawWorld(ctx, G);
    drawHUD(ctx, G);
    drawStoryComplete(ctx, G);
  } else {
    drawWorld(ctx, G);
    drawHUD(ctx, G);
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.w = window.innerWidth;
  G.h = window.innerHeight;
  canvas.width = Math.floor(G.w * dpr);
  canvas.height = Math.floor(G.h * dpr);
  canvas.style.width = G.w + 'px';
  canvas.style.height = G.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function frame(t) {
  const dt = 0.016;
  if (G.state === 'play' || G.state === 'title' || G.state === 'help') update(dt);
  updateMenus();
  render();
  G.input.endFrame();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

function seedStreets() {
  // A lively street to open on: traffic, parked cars, pedestrians, one medkit.
  const rng = mulberry32(20261118);
  for (let i = 0; i < 14; i++) {
    const car = spawnTrafficCar(G.city, G.player, rng);
    if (car) G.cars.push(car);
  }
  for (let i = 0; i < 9; i++) {
    const car = spawnParkedCar(G.city, rng);
    if (car) G.cars.push(car);
  }
  for (let i = 0; i < 18; i++) {
    const road = randInt(rng, 0, 10) * BLOCK;
    const along = randInt(rng, 0, WORLD);
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : road + ROAD_W / 2 + 12;
    const y = horizontal ? road + ROAD_W / 2 + 12 : along;
    if (!insideBuilding(G.city, x, y, 0)) G.peds.push(makePed(x, y, rng));
  }
  G.pickups.push({ ...medkitPos(PLACES.hospital), spot: PLACES.hospital });
}

/** A medkit sits on the road beside a place, never on a rooftop. */
function medkitPos(place) {
  return { x: place.x, y: Math.round(place.y / BLOCK) * BLOCK + 19 };
}

seedStreets();

/** Set up a photographed scene for ?shot=, then simulate it forward. */
function setupShot() {
  if (!SHOT) return;
  G.tod = 0.42; // warm afternoon light for the photographs
  G.state = 'play';
  const rng = mulberry32(777);
  if (SHOT === 'start') {
    G.state = 'title';
    return;
  }
  if (SHOT === 'drive') {
    const car = makeCar(1600, 1500, 0, 'player', rng);
    car.x = 1600;
    car.y = 1600 + 19;
    car.angle = 0;
    G.cars.push(car);
    G.player.inCar = car;
    G.player.x = car.x;
    G.player.y = car.y;
    G.player.cash = 1250;
    G.cam.x = car.x;
    G.cam.y = car.y;
    G.shotAuto = fakeDriveInput();
    simulate(SIM || 2.5);
  } else if (SHOT === 'chase') {
    const car = makeCar(1760, 1600, 0, 'player', rng);
    car.x = 1760;
    car.y = 1600 + 19; // east lane of the 1600 road
    car.angle = 0;
    G.cars.push(car);
    G.player.inCar = car;
    G.player.x = car.x;
    G.player.y = car.y;
    G.player.cash = 2450;
    setWanted(3);
    for (let i = 0; i < 4; i++) {
      const cop = makeCar(1760 - 260 - i * 130, 1600, 0, 'police', rng);
      cop.x = 1760 - 260 - i * 130;
      cop.y = 1600 + 19;
      G.cars.push(cop);
    }
    G.cam.x = car.x;
    G.cam.y = car.y;
    G.shotAuto = fakeDriveInput();
    simulate(SIM || 4);
  } else if (SHOT === 'mission') {
    G.mission.index = 1; // The Pickup
    G.mission.step = 0;
    const car = makeCar(1600, 3200, 0, 'player', rng);
    car.x = 1600;
    car.y = 3200 + 19;
    car.angle = Math.PI; // drive west, toward the docks and its beacon
    G.cars.push(car);
    G.player.inCar = car;
    G.player.x = car.x;
    G.player.y = car.y;
    G.player.cash = 900;
    G.cam.x = car.x;
    G.cam.y = car.y;
    G.shotAuto = fakeDriveInput();
    simulate(SIM || 2);
  }
  G.shotAuto = null;
  // One frame of ambient life so the photograph is not frozen.
  updateAmbient(0.5);
}

/** Synthetic keyboard input: drive forward, steering gently along the road. */
function fakeDriveInput() {
  return {
    moveAxis: () => ({ x: 0, y: -1 }),
    down: (code) => code === 'KeyW',
    hit: () => false,
    mouseDown: false,
    mouseX: 0,
    mouseY: 0,
    clicked: false,
  };
}

/** Run the game forward `seconds` in fixed 1/60 steps (used by ?shot= only). */
function simulate(seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) update(1 / 60);
}

setupShot();
requestAnimationFrame(frame);
