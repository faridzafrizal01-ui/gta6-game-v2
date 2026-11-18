// All drawing for Solmar Bay: the city, the cars and people, the particles,
// the HUD with its minimap, and every menu screen. Canvas 2D only, no assets —
// every colour, shape and letter is drawn from code.

import { WORLD, BLOCK, ROAD_W, GRID_N, PLACES } from './city.js';
import { clamp, fmtCash, fmtTime, dist } from './util.js';
import { currentMission, currentStep } from './missions.js';

/** Camera zoom for a given canvas: the city reads well at any window size. */
export function zoomFor(w, h) {
  return clamp(Math.min(w, h) / 700, 0.62, 1.25);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, s, x, y, size, color, align = 'left', weight = 'bold') {
  ctx.font = `${weight} ${size}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function textShadow(ctx, s, x, y, size, color, align = 'left') {
  ctx.font = `bold ${size}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillText(s, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// ---------------------------------------------------------------- the world

export function drawWorld(ctx, G) {
  const { city, cam } = G;
  const vw = G.w / cam.zoom;
  const vh = G.h / cam.zoom;
  const x0 = cam.x - vw / 2;
  const y0 = cam.y - vh / 2;
  const x1 = cam.x + vw / 2;
  const y1 = cam.y + vh / 2;

  ctx.save();
  ctx.translate(G.w / 2, G.h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  // Ground: dry grass base, then the sea and beach along the south edge.
  ctx.fillStyle = '#7fae62';
  ctx.fillRect(x0 - 40, y0 - 40, x1 - x0 + 80, y1 - y0 + 80);
  // Sea (south of the last road).
  ctx.fillStyle = '#2f7fb8';
  ctx.fillRect(x0 - 40, WORLD - 120, x1 - x0 + 80, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 6; i++) {
    const wy = WORLD - 112 + i * 22;
    ctx.fillRect(x0 + ((i * 613) % 900), wy, 90, 3);
  }
  // Beach sand.
  ctx.fillStyle = '#e8d9a8';
  ctx.fillRect(x0 - 40, WORLD - 160, x1 - x0 + 80, 44);

  // Parks, plazas and beach blocks.
  for (const p of city.parks) {
    if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue;
    if (p.kind === 'beach' || p.kind === 'sand') {
      ctx.fillStyle = p.kind === 'beach' ? '#ecdcae' : '#e2cf9e';
    } else if (p.kind === 'park') {
      ctx.fillStyle = '#5d9b4a';
    } else {
      ctx.fillStyle = '#b9b3a4';
    }
    ctx.fillRect(p.x, p.y, p.w, p.h);
    if (p.kind === 'park') {
      ctx.fillStyle = '#6fae58';
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Parking lots.
  for (const lot of city.lots) {
    if (lot.x > x1 || lot.x + lot.w < x0 || lot.y > y1 || lot.y + lot.h < y0) continue;
    ctx.fillStyle = '#5a5e63';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const lx = lot.x + (lot.w / 5) * i;
      ctx.beginPath();
      ctx.moveTo(lx, lot.y + 14);
      ctx.lineTo(lx, lot.y + 46);
      ctx.stroke();
    }
  }

  // Roads: asphalt bands with sidewalks and centre dashes.
  drawRoads(ctx, x0, y0, x1, y1);

  // Buildings, drawn far-to-near so the pseudo-3D faces overlap correctly.
  const visible = city.buildings.filter((b) => b.x + b.w > x0 && b.x < x1 && b.y + b.h > y0 && b.y < y1);
  visible.sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const b of visible) drawBuilding(ctx, b, G.night);

  // Trees and lamps.
  for (const t of city.trees) {
    if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(t.x + 4, t.y + 5, t.r, t.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.shade;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(t.x - 3, t.y - 3, t.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3a3f45';
  for (const l of city.lamps) {
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
    if (G.night) {
      ctx.fillStyle = 'rgba(255,230,140,0.85)';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a3f45';
    }
  }

  // Mission target beacon + place labels.
  drawMarkers(ctx, G);

  // Pickups (medkits).
  for (const pk of G.pickups) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(pk.x, pk.y + 6, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pk.x - 10, pk.y - 10, 20, 20);
    ctx.fillStyle = '#d33a2c';
    ctx.fillRect(pk.x - 7, pk.y - 2.5, 14, 5);
    ctx.fillRect(pk.x - 2.5, pk.y - 7, 5, 14);
  }

  // Cars, people, player, bullets, particles — all in world space.
  for (const car of G.cars) drawCar(ctx, car, G);
  for (const ped of G.peds) drawPed(ctx, ped);
  for (const cop of G.cops) drawFootCop(ctx, cop);
  drawPlayer(ctx, G);
  for (const b of G.bullets) {
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x - Math.cos(b.angle) * 14, b.y - Math.sin(b.angle) * 14);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const p of G.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // Night falls over the city: a blue veil plus lit windows already drawn.
  if (G.night > 0) {
    ctx.fillStyle = `rgba(12,16,52,${(G.night * 0.34).toFixed(3)})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
}

function drawRoads(ctx, x0, y0, x1, y1) {
  // Sidewalk bands first (wider, lighter), then asphalt.
  ctx.fillStyle = '#a9a49a';
  for (let i = 0; i <= GRID_N; i++) {
    const c = i * BLOCK;
    ctx.fillRect(x0, c - ROAD_W / 2 - 12, x1 - x0, ROAD_W + 24);
    ctx.fillRect(c - ROAD_W / 2 - 12, y0, ROAD_W + 24, y1 - y0);
  }
  ctx.fillStyle = '#3c4046';
  for (let i = 0; i <= GRID_N; i++) {
    const c = i * BLOCK;
    ctx.fillRect(x0, c - ROAD_W / 2, x1 - x0, ROAD_W);
    ctx.fillRect(c - ROAD_W / 2, y0, ROAD_W, y1 - y0);
  }
  // Centre dashes and crosswalks.
  ctx.fillStyle = '#e8d44d';
  for (let i = 0; i <= GRID_N; i++) {
    const c = i * BLOCK;
    for (let d = 0; d <= WORLD; d += 64) {
      if (d % BLOCK < 80) continue; // keep intersections clear
      ctx.fillRect(d, c - 2, 26, 4);
      ctx.fillRect(c - 2, d, 4, 26);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i <= GRID_N; i++) {
    for (let j = 0; j <= GRID_N; j++) {
      const cx = i * BLOCK;
      const cy = j * BLOCK;
      for (let s = -3; s <= 3; s++) {
        ctx.fillRect(cx - ROAD_W / 2 + 4 + (s + 3) * 10, cy - ROAD_W / 2 - 10, 5, 8);
        ctx.fillRect(cx - ROAD_W / 2 + 4 + (s + 3) * 10, cy + ROAD_W / 2 + 2, 5, 8);
      }
    }
  }
}

function drawBuilding(ctx, b, night) {
  const lift = b.height;
  const ox = lift * 0.45;
  const oy = -lift * 0.55;
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
  // South and east faces (the extruded sides).
  ctx.fillStyle = shade(b.color, -28);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + b.h);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.lineTo(b.x + b.w + ox, b.y + b.h + oy);
  ctx.lineTo(b.x + ox, b.y + b.h + oy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(b.color, -16);
  ctx.beginPath();
  ctx.moveTo(b.x + b.w, b.y);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.lineTo(b.x + b.w + ox, b.y + b.h + oy);
  ctx.lineTo(b.x + b.w + ox, b.y + oy);
  ctx.closePath();
  ctx.fill();
  // Roof.
  ctx.fillStyle = b.roof;
  ctx.beginPath();
  ctx.moveTo(b.x + ox, b.y + oy);
  ctx.lineTo(b.x + b.w + ox, b.y + oy);
  ctx.lineTo(b.x + b.w + ox, b.y + b.h + oy);
  ctx.lineTo(b.x + ox, b.y + b.h + oy);
  ctx.closePath();
  ctx.fill();
  // Roof detail: edge trim + windows / helipad.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (b.helipad) {
    ctx.strokeStyle = '#e8d44d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2 + ox, b.y + b.h / 2 + oy, Math.min(b.w, b.h) / 4, 0, Math.PI * 2);
    ctx.stroke();
    text(ctx, 'H', b.x + b.w / 2 + ox, b.y + b.h / 2 + oy + 7, 20, '#e8d44d', 'center');
  } else if (b.windows && b.w > 60) {
    ctx.fillStyle = night > 0.4 ? 'rgba(255,214,120,0.9)' : 'rgba(180,220,255,0.55)';
    const cols = Math.floor(b.w / 26);
    const rows = Math.floor(b.h / 26);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r * 7 + c * 3) % 4 === 0) continue;
        ctx.fillRect(b.x + ox + 10 + c * 26, b.y + oy + 10 + r * 26, 12, 12);
      }
    }
  }
}

/** Lighten (positive) or darken (negative) a #rrggbb colour. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
  const b = clamp((n & 0xff) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawMarkers(ctx, G) {
  const step = currentStep(G.mission);
  const m = currentMission(G.mission);
  if (m && step && step.target) {
    const t = step.target;
    const pulse = 1 + Math.sin(G.time * 4) * 0.15;
    // Ground ring.
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, 46 * pulse, 46 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,210,62,0.18)';
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, 46 * pulse, 46 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    // Light pillar.
    const grad = ctx.createLinearGradient(t.x, t.y - 320, t.x, t.y);
    grad.addColorStop(0, 'rgba(255,210,62,0)');
    grad.addColorStop(1, 'rgba(255,210,62,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(t.x - 16, t.y - 320, 32, 320);
    // Floating marker.
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - 64);
    ctx.lineTo(t.x + 14, t.y - 92);
    ctx.lineTo(t.x - 14, t.y - 92);
    ctx.closePath();
    ctx.fill();
    text(ctx, t.name, t.x, t.y - 104, 15, '#ffffff', 'center');
  }
  // Spray shop marker (repair + lose heat) — always on the map.
  const s = PLACES.spray;
  ctx.fillStyle = '#3aa655';
  ctx.beginPath();
  ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, 'SPRAY', s.x, s.y + 5, 9, '#ffffff', 'center');
}

function drawCar(ctx, car, G) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -car.w / 2 + 3, -car.h / 2 + 4, car.w, car.h, 7);
  ctx.fill();
  // Body.
  ctx.fillStyle = car.color;
  roundRect(ctx, -car.w / 2, -car.h / 2, car.w, car.h, 7);
  ctx.fill();
  // Hood + roof + windshield.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, car.w / 2 - 12, -car.h / 2 + 3, 9, car.h - 6, 3);
  ctx.fill();
  ctx.fillStyle = shade(car.color, 26);
  roundRect(ctx, -8, -car.h / 2 + 3, 16, car.h - 6, 4);
  ctx.fill();
  ctx.fillStyle = '#1b2a3a';
  ctx.fillRect(-2, -car.h / 2 + 4, 4, car.h - 8);
  // Headlights at night.
  if (G.night > 0.35) {
    ctx.fillStyle = 'rgba(255,240,170,0.9)';
    ctx.fillRect(car.w / 2 - 2, -car.h / 2 + 2, 3, 5);
    ctx.fillRect(car.w / 2 - 2, car.h / 2 - 7, 3, 5);
  }
  // Police livery + light bar.
  if (car.kind === 'police') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-car.w / 2 + 4, -car.h / 2 + 3, 12, car.h - 6);
    ctx.fillStyle = '#111';
    text(ctx, 'PD', -car.w / 2 + 10, 4, 10, '#111', 'center');
    const flash = Math.floor(car.flashing * 6) % 2 === 0;
    ctx.fillStyle = flash ? '#ff2d2d' : '#2d7dff';
    ctx.beginPath();
    ctx.arc(-6, -car.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#2d7dff' : '#ff2d2d';
    ctx.beginPath();
    ctx.arc(-6, car.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Damage smoke.
  if (car.health < 45) {
    ctx.fillStyle = 'rgba(120,120,120,0.5)';
    ctx.beginPath();
    ctx.arc(-car.w / 2 + 4, 0, 6 + Math.random() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Name tag over the player's car.
  if (G.player.inCar === car) {
    text(ctx, car.name, car.x, car.y - 26, 12, '#ffffff', 'center');
  }
}

function drawPed(ctx, ped) {
  if (ped.dead && ped.fade > 0.6) return;
  ctx.save();
  ctx.translate(ped.x, ped.y);
  if (ped.dead) ctx.globalAlpha = clamp(1 - ped.fade, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 5, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const bob = Math.sin(ped.walkPhase) * 1.5;
  // Body.
  ctx.fillStyle = ped.shirt;
  roundRect(ctx, -5, -6 + bob * 0.3, 10, 13, 4);
  ctx.fill();
  // Head.
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(0, -10 + bob * 0.3, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFootCop(ctx, cop) {
  ctx.save();
  ctx.translate(cop.x, cop.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 5, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c2f4a';
  roundRect(ctx, -5, -6, 10, 13, 4);
  ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath();
  ctx.arc(0, -10, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c2f4a';
  ctx.fillRect(-5, -15, 10, 3);
  const flash = Math.floor(cop.flashing * 6) % 2 === 0;
  ctx.fillStyle = flash ? '#ff2d2d' : '#2d7dff';
  ctx.beginPath();
  ctx.arc(0, -19, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx, G) {
  const p = G.player;
  if (p.inCar) return; // the car drawing covers the player
  if (p.dead) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 6, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const bob = p.speed > 0 ? Math.sin(G.time * 14) * 1.5 : 0;
  // Danny Vale: teal jacket, dark jeans.
  ctx.fillStyle = '#12333f';
  roundRect(ctx, -5, 0, 10, 9, 3);
  ctx.fill();
  ctx.fillStyle = '#0f8a8a';
  roundRect(ctx, -6, -8 + bob * 0.3, 12, 12, 5);
  ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath();
  ctx.arc(0, -12 + bob * 0.3, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a1c12';
  ctx.beginPath();
  ctx.arc(0, -14 + bob * 0.3, 5.5, Math.PI, Math.PI * 2);
  ctx.fill();
  // Pistol in hand when aiming.
  if (G.aiming) {
    ctx.fillStyle = '#222';
    ctx.fillRect(4, -6, 9, 3);
  }
  ctx.restore();
  // Hurt vignette handled by the HUD.
}

// ---------------------------------------------------------------- HUD + minimap

export function drawHUD(ctx, G) {
  const p = G.player;
  const m = currentMission(G.mission);
  const step = currentStep(G.mission);

  // Top-left: cash + health.
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  roundRect(ctx, 12, 12, 218, 74, 10);
  ctx.fill();
  text(ctx, fmtCash(p.cash), 24, 40, 24, '#7dff8a');
  // Health bar.
  ctx.fillStyle = '#222';
  roundRect(ctx, 24, 52, 150, 12, 6);
  ctx.fill();
  ctx.fillStyle = p.health > 40 ? '#37d67a' : '#e23a2e';
  roundRect(ctx, 24, 52, 150 * clamp(p.health / 100, 0, 1), 12, 6);
  ctx.fill();
  text(ctx, 'HP ' + Math.ceil(p.health), 182, 63, 12, '#ffffff');
  if (p.armor > 0) text(ctx, 'ARMOR ' + Math.ceil(p.armor), 24, 80, 12, '#7db8ff');

  // Top-right: wanted stars.
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  roundRect(ctx, G.w - 212, 12, 200, 46, 10);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const on = i < G.wanted;
    text(ctx, '★', G.w - 196 + i * 36, 44, 28, on ? '#ffd23e' : 'rgba(255,255,255,0.25)', 'left');
  }

  // Mission objective, bottom-left.
  if (m && step) {
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    roundRect(ctx, 12, G.h - 96, 430, 84, 10);
    ctx.fill();
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(12, G.h - 96, 6, 84);
    text(ctx, `MISSION ${m.id} — ${m.title}`, 30, G.h - 68, 15, '#ffd23e');
    text(ctx, step.text, 30, G.h - 44, 14, '#ffffff');
    if (step.target) {
      const d = Math.round(dist(p.x, p.y, step.target.x, step.target.y));
      text(ctx, `${d}m  ·  reward ${fmtCash(m.reward)}`, 30, G.h - 24, 12, '#bfe3ff');
    }
    if (G.mission.timeLeft !== null) {
      text(ctx, '⏱ ' + fmtTime(Math.max(0, G.mission.timeLeft)), 420, G.h - 68, 16, '#ff8a7a', 'right');
    }
  } else if (G.mission.done) {
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    roundRect(ctx, 12, G.h - 96, 430, 84, 10);
    ctx.fill();
    text(ctx, 'STORY COMPLETE — KING OF SOLMAR', 30, G.h - 68, 15, '#ffd23e');
    text(ctx, 'Free roam: steal cars, dodge the PD, stack cash.', 30, G.h - 44, 14, '#ffffff');
  }

  // Speed + car state, bottom-right above the minimap.
  if (p.inCar) {
    const kmh = Math.round(Math.abs(p.inCar.speed) * 0.55);
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    roundRect(ctx, G.w - 212, G.h - 296, 200, 62, 10);
    ctx.fill();
    text(ctx, p.inCar.name.toUpperCase(), G.w - 200, G.h - 270, 13, '#ffffff');
    text(ctx, kmh + ' km/h', G.w - 24, G.h - 248, 22, '#ffffff', 'right');
    ctx.fillStyle = '#222';
    roundRect(ctx, G.w - 200, G.h - 242, 176, 8, 4);
    ctx.fill();
    ctx.fillStyle = p.inCar.health > 40 ? '#37d67a' : '#e23a2e';
    roundRect(ctx, G.w - 200, G.h - 242, 176 * clamp(p.inCar.health / 100, 0, 1), 8, 4);
    ctx.fill();
  }

  // Controls hint, top-centre (the mission box owns the bottom-left).
  textShadow(ctx, p.inCar ? 'WASD drive · Space handbrake · E exit car · F punch · Click shoot · H horn · Esc menu' : 'WASD walk · Shift run · E steal car · F punch · Click shoot · Esc menu', G.w / 2, 30, 12, 'rgba(255,255,255,0.8)', 'center');

  // Banner (mission complete / failed / busted / wasted).
  if (G.mission.bannerT > 0) {
    const a = clamp(G.mission.bannerT, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(10,14,20,0.7)';
    ctx.fillRect(0, G.h / 2 - 64, G.w, 92);
    text(ctx, G.mission.banner, G.w / 2, G.h / 2 - 8, 34, '#ffd23e', 'center');
    if (G.mission.bannerSub) text(ctx, G.mission.bannerSub, G.w / 2, G.h / 2 + 16, 16, '#ffffff', 'center');
    ctx.globalAlpha = 1;
  }

  // Toast messages (top-centre, short-lived).
  let ty = 66;
  for (const t of G.toasts) {
    ctx.globalAlpha = clamp(t.life, 0, 1);
    textShadow(ctx, t.text, G.w / 2, ty, 15, '#ffffff', 'center');
    ty += 24;
  }
  ctx.globalAlpha = 1;

  // Hurt flash.
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(200,30,20,${(p.hurtFlash * 0.5).toFixed(3)})`;
    ctx.fillRect(0, 0, G.w, G.h);
  }

  drawMinimap(ctx, G);
}

function drawMinimap(ctx, G) {
  const size = 190;
  const x = G.w - size - 12;
  const y = G.h - size - 12;
  const scale = size / WORLD;
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  roundRect(ctx, x - 6, y - 6, size + 12, size + 12, 10);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.fillStyle = '#2e4a2e';
  ctx.fillRect(x, y, size, size);
  // Roads.
  ctx.strokeStyle = '#565b63';
  ctx.lineWidth = 3;
  for (let i = 0; i <= GRID_N; i++) {
    const c = x + i * BLOCK * scale;
    ctx.beginPath(); ctx.moveTo(c, y); ctx.lineTo(c, y + size); ctx.stroke();
    const r = y + i * BLOCK * scale;
    ctx.beginPath(); ctx.moveTo(x, r); ctx.lineTo(x + size, r); ctx.stroke();
  }
  // Sea.
  ctx.fillStyle = '#2f7fb8';
  ctx.fillRect(x, y + (WORLD - 120) * scale, size, 120 * scale);
  // Buildings.
  ctx.fillStyle = 'rgba(200,200,210,0.5)';
  for (const b of G.city.buildings) {
    ctx.fillRect(x + b.x * scale, y + b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
  }
  // Mission target.
  const step = currentStep(G.mission);
  if (step && step.target) {
    const pulse = 1 + Math.sin(G.time * 5) * 0.3;
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.arc(x + step.target.x * scale, y + step.target.y * scale, 5 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  // Spray shop.
  ctx.fillStyle = '#3aa655';
  ctx.fillRect(x + PLACES.spray.x * scale - 2, y + PLACES.spray.y * scale - 2, 4, 4);
  // Police blips (flashing red/blue).
  const flash = Math.floor(G.time * 4) % 2 === 0;
  ctx.fillStyle = flash ? '#ff2d2d' : '#2d7dff';
  for (const car of G.cars) {
    if (car.kind !== 'police') continue;
    ctx.beginPath();
    ctx.arc(x + car.x * scale, y + car.y * scale, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const cop of G.cops) {
    ctx.beginPath();
    ctx.arc(x + cop.x * scale, y + cop.y * scale, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const px = x + G.player.x * scale;
  const py = y + G.player.y * scale;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(G.player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // North + view box.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + (G.cam.x - (G.w / G.cam.zoom) / 2) * scale, y + (G.cam.y - (G.h / G.cam.zoom) / 2) * scale, (G.w / G.cam.zoom) * scale, (G.h / G.cam.zoom) * scale);
  ctx.restore();
  text(ctx, 'N', x + size / 2, y - 10, 11, '#ffffff', 'center');
}

// ---------------------------------------------------------------- menus

function menuButton(ctx, x, y, w, h, label, hover) {
  ctx.fillStyle = hover ? '#ffd23e' : 'rgba(16,22,30,0.85)';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = hover ? '#ffffff' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 7, 19, hover ? '#111' : '#ffffff', 'center');
}

export function drawTitle(ctx, G) {
  // The city drifts behind the title.
  drawWorld(ctx, G);
  ctx.fillStyle = 'rgba(6,10,18,0.55)';
  ctx.fillRect(0, 0, G.w, G.h);
  const cx = G.w / 2;
  textShadow(ctx, 'SOLMAR BAY', cx, 170, 84, '#ffd23e', 'center');
  textShadow(ctx, 'AN OPEN-WORLD CRIME STORY', cx, 212, 22, '#ffffff', 'center');
  textShadow(ctx, 'Steal cars. Outrun the Bay PD. Run six story missions. Own the city.', cx, 246, 16, '#cfe6ff', 'center');

  const bw = 340;
  const bx = cx - bw / 2;
  const buttons = [
    { label: 'START GAME', id: 'start' },
    { label: 'CONTINUE', id: 'continue', disabled: !G.hasSave },
    { label: 'HOW TO PLAY', id: 'help' },
  ];
  buttons.forEach((b, i) => {
    const y = 300 + i * 66;
    const hover = G.hoverButton === b.id;
    ctx.globalAlpha = b.disabled ? 0.45 : 1;
    menuButton(ctx, bx, y, bw, 52, b.label, hover);
    ctx.globalAlpha = 1;
    G.titleButtons[i] = { id: b.id, x: bx, y, w: bw, h: 52, disabled: !!b.disabled };
  });
  textShadow(ctx, 'Keyboard + mouse · Offline · Your progress saves locally', cx, 540, 14, 'rgba(255,255,255,0.75)', 'center');
  textShadow(ctx, 'An original game. No real city, person or brand appears in it.', cx, 566, 13, 'rgba(255,255,255,0.55)', 'center');
}

export function drawHelp(ctx, G) {
  ctx.fillStyle = 'rgba(6,10,18,0.82)';
  ctx.fillRect(0, 0, G.w, G.h);
  const cx = G.w / 2;
  text(ctx, 'HOW TO PLAY', cx, 110, 40, '#ffd23e', 'center');
  const lines = [
    ['WASD / Arrows', 'Walk or drive'],
    ['Shift', 'Run on foot'],
    ['E', 'Steal / enter a car, or get out'],
    ['Space', 'Handbrake while driving'],
    ['Left click', 'Shoot your pistol toward the mouse'],
    ['F', 'Punch someone up close'],
    ['H', 'Horn'],
    ['R', 'Repair + lose one wanted star at Ray’s Spray Shop ($150)'],
    ['Esc / P', 'Pause menu — save, sound, restart'],
    ['M', 'Mute / unmute sound'],
    ['★ Wanted', 'Stealing, hitting people and shooting cops raises it.'],
    ['         ', 'Hide from the PD and it fades. Busted or wasted costs cash.'],
  ];
  let y = 170;
  for (const [k, v] of lines) {
    text(ctx, k, cx - 260, y, 17, '#ffd23e');
    text(ctx, v, cx - 120, y, 17, '#ffffff');
    y += 34;
  }
  const hover = G.hoverButton === 'back';
  menuButton(ctx, cx - 170, y + 10, 340, 52, 'BACK', hover);
  G.helpButton = { id: 'back', x: cx - 170, y: y + 10, w: 340, h: 52 };
}

export function drawPause(ctx, G) {
  ctx.fillStyle = 'rgba(6,10,18,0.6)';
  ctx.fillRect(0, 0, G.w, G.h);
  const cx = G.w / 2;
  text(ctx, 'PAUSED', cx, 150, 44, '#ffffff', 'center');
  const buttons = [
    { label: 'RESUME', id: 'resume' },
    { label: 'SAVE GAME', id: 'save' },
    { label: 'SOUND: ' + (G.sound.enabled ? 'ON' : 'OFF'), id: 'sound' },
    { label: 'RESTART STORY', id: 'restart' },
    { label: 'QUIT TO TITLE', id: 'quit' },
  ];
  buttons.forEach((b, i) => {
    const y = 210 + i * 66;
    menuButton(ctx, cx - 170, y, 340, 52, b.label, G.hoverButton === b.id);
    G.pauseButtons[i] = { id: b.id, x: cx - 170, y, w: 340, h: 52 };
  });
  if (G.saveFlash > 0) text(ctx, 'Game saved.', cx, 560, 16, '#7dff8a', 'center');
}

export function drawEndScreen(ctx, G, kind) {
  ctx.fillStyle = 'rgba(6,10,18,0.72)';
  ctx.fillRect(0, 0, G.w, G.h);
  const cx = G.w / 2;
  if (kind === 'busted') {
    text(ctx, 'BUSTED!', cx, 200, 64, '#ff5a4e', 'center');
    text(ctx, 'The Bay PD caught you. Bail cost you $300.', cx, 250, 18, '#ffffff', 'center');
  } else {
    text(ctx, 'WASTED', cx, 200, 64, '#ff5a4e', 'center');
    text(ctx, 'You woke up at St. Marina Hospital. The bill cost you $300.', cx, 250, 18, '#ffffff', 'center');
  }
  text(ctx, 'Cash: ' + fmtCash(G.player.cash), cx, 300, 20, '#7dff8a', 'center');
  menuButton(ctx, cx - 170, 350, 340, 52, 'GET BACK OUT THERE', G.hoverButton === 'respawn');
  G.endButton = { id: 'respawn', x: cx - 170, y: 350, w: 340, h: 52 };
}

export function drawStoryComplete(ctx, G) {
  ctx.fillStyle = 'rgba(6,10,18,0.72)';
  ctx.fillRect(0, 0, G.w, G.h);
  const cx = G.w / 2;
  text(ctx, 'KING OF SOLMAR', cx, 200, 56, '#ffd23e', 'center');
  text(ctx, 'Every mission done. The city is yours, Danny.', cx, 250, 18, '#ffffff', 'center');
  text(ctx, 'Final cash: ' + fmtCash(G.player.cash), cx, 292, 20, '#7dff8a', 'center');
  menuButton(ctx, cx - 170, 340, 340, 52, 'KEEP PLAYING (FREE ROAM)', G.hoverButton === 'roam');
  G.endButton = { id: 'roam', x: cx - 170, y: 340, w: 340, h: 52 };
}
