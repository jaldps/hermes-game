// Bot brains: pick juicy targets, chase smaller holes, flee bigger ones.
import { CITY, HOLE } from './config.js';
import { holes } from './holes.js';
import { gridQuery } from './objects.js';
import { rand, range } from './rng.js';

const _q = [];
export function makeBrain(skill) {
  return { skill, think: rand() * 0.3, tx: 0, tz: 0, has: false, ix: 0, iz: 0, wanderT: 0, chase: null };
}

export function updateBrain(h, dt, time) {
  const b = h.ai; if (!b || !h.alive) return;
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.25 + (1 - b.skill) * 0.45 + rand() * 0.15;
    decide(h, b);
  }
  let dx = b.tx - h.x, dz = b.tz - h.z;
  let d = Math.hypot(dx, dz);
  // flee vector recomputed each frame (cheap: few holes)
  let fx = 0, fz = 0;
  for (const o of holes) {
    if (o === h || !o.alive || o.r < h.r * HOLE.EAT_HOLE_RATIO) continue;
    const ox = h.x - o.x, oz = h.z - o.z; const od = Math.hypot(ox, oz);
    const danger = o.r + 5 + h.r;
    if (od < danger * (0.8 + b.skill * 0.6)) { const w = (1 - od / (danger * 1.4)) * 2.5; fx += ox / (od || 1) * w; fz += oz / (od || 1) * w; }
  }
  let ix = d > 0.3 ? dx / d : 0, iz = d > 0.3 ? dz / d : 0;
  ix += fx; iz += fz;
  // keep off the edges
  const lim = CITY.HALF - h.r - 3;
  if (h.x < -lim) ix += 1.5; if (h.x > lim) ix -= 1.5; if (h.z < -lim) iz += 1.5; if (h.z > lim) iz -= 1.5;
  const il = Math.hypot(ix, iz);
  if (il > 1e-3) { ix /= il; iz /= il; }
  const sp = d < h.r * 0.3 && !fx && !fz ? 0.35 : (0.82 + b.skill * 0.18);
  b.ix += (ix * sp - b.ix) * Math.min(1, dt * 6); b.iz += (iz * sp - b.iz) * Math.min(1, dt * 6);
  h.input.x = b.ix; h.input.z = b.iz;
}

function decide(h, b) {
  // 1) chase a smaller hole nearby
  let bestHole = null, bestHD = 1e9;
  for (const o of holes) {
    if (o === h || !o.alive || o.invuln > 0) continue;
    if (h.r > o.r * HOLE.EAT_HOLE_RATIO * 1.03) {
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      if (d < 8 + h.r * 1.6 * b.skill && d < bestHD) { bestHD = d; bestHole = o; }
    }
  }
  // 1b) hunt the player if we can eat them and are near
  const player = holes.find(o => o.isPlayer && o.alive);
  if (player && h.r > player.r * HOLE.EAT_HOLE_RATIO * 1.02) {
    const d = Math.hypot(player.x - h.x, player.z - h.z);
    if (d < 14 + h.r * 2.5 && d < bestHD) { bestHD = d; bestHole = player; }
  }
  if (bestHole && rand() < 0.5 + b.skill * 0.4) { b.tx = bestHole.x + bestHole.vx * 0.4; b.tz = bestHole.z + bestHole.vz * 0.4; return; }
  // 2) best food cluster within reach
  const R = 12 + h.r * 3.2;
  gridQuery(h.x, h.z, R, _q);
  const fit = h.r * HOLE.FIT;
  let best = null, bestS = 0;
  for (let i = 0; i < _q.length; i++) {
    const o = _q[i]; if (o.state !== 0 || o.size >= fit) continue;
    const d = Math.hypot(o.x - h.x, o.z - h.z);
    if (d > R) continue;
    // prefer valuable, near objects slightly ahead of current heading
    const ahead = (h.vx * (o.x - h.x) + h.vz * (o.z - h.z)) / ((d || 1) * (Math.hypot(h.vx, h.vz) || 1));
    let s = (o.value + 0.6) / Math.pow(d + 3, 1.25) * (1 + ahead * 0.35) * (0.75 + rand() * 0.5 * (1.4 - b.skill));
    if (o.drive) s *= 0.55;
    if (s > bestS) { bestS = s; best = o; }
  }
  if (best) {
    b.tx = best.x; b.tz = best.z; b.has = true;
    if (best.drive) { const lead = Math.min(1.2, Math.hypot(best.x - h.x, best.z - h.z) / 8); b.tx += Math.sin(best.yaw) * best.drive.cur * lead; b.tz += Math.cos(best.yaw) * best.drive.cur * lead; }
    return;
  }
  // 3) wander toward the city centre-ish
  b.tx = range(-CITY.SPAN * 0.4, CITY.SPAN * 0.4); b.tz = range(-CITY.SPAN * 0.4, CITY.SPAN * 0.4);
}
