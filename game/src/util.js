// Small math and random helpers shared by every Solmar Bay module.
// Nothing here touches the DOM: pure functions only, so the world generator
// and the gameplay code can both use them.

/** A fast seeded PRNG (mulberry32) so the city layout is identical every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] from a random function. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Float in [min, max) from a random function. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Pick one element of an array with a random function. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest signed turn from angle a to angle b, in radians. */
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn angle `a` toward `b` by at most `step` radians. */
export function turnToward(a, b, step) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}

export function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Format a cash amount like $1,250. */
export function fmtCash(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/** Format seconds as M:SS. */
export function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}
