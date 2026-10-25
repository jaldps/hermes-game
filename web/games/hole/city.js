// City generation: block layout, buildings, props, vehicles, pedestrians.
import * as THREE from 'three';
import { CITY, PAL } from './config.js';
import { rand, range, irange, pick, chance } from './rng.js';
import * as G from './geom.js';
import { paintMaterial, facadeMaterial, decalMaterial, U } from './materials.js';
import { Pool, addObject, objects, DECAL, initParts, writeObject, gridInsert, initGrid, resetObjects } from './objects.js';

const _c = new THREE.Color();
const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
const col = hex => new THREE.Color(hex);
const jit = (hex, a = 0.06) => { _c.set(hex); const hsl = {}; _c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h + (rand() - .5) * a * 0.5, Math.min(1, hsl.s * (1 + (rand() - .5) * a * 2)), Math.min(0.95, hsl.l * (1 + (rand() - .5) * a))); };

export const P = {};      // pools
export const city = { blocks: [], nodes: [], peds: [], cars: [], blockTex: null, spawnPoints: [] };

// Object tiers: size = footprint radius used for "fits in the hole" test, value = points & growth mass
const T = {
  person: { size: 0.32, h: 1.75, value: 1 }, hydrant: { size: 0.3, h: 0.8, value: 2 }, bin: { size: 0.36, h: 0.95, value: 2 },
  cone: { size: 0.3, h: 0.75, value: 1 }, mailbox: { size: 0.36, h: 1.2, value: 2 }, lamp: { size: 0.42, h: 4.3, value: 3 },
  bench: { size: 0.85, h: 0.9, value: 4 }, bush: { size: 0.75, h: 1.0, value: 3 }, flowerbed: { size: 1.1, h: 0.5, value: 5 },
  booth: { size: 0.65, h: 2.4, value: 5 }, signal: { size: 0.45, h: 3.8, value: 4 }, table: { size: 1.05, h: 2.6, value: 5 },
  cart: { size: 1.0, h: 2.9, value: 8 }, tree: { size: 1.2, h: 4.2, value: 8 }, conifer: { size: 1.15, h: 3.8, value: 8 },
  palm: { size: 1.1, h: 4.8, value: 8 }, planter: { size: 1.0, h: 1.2, value: 6 }, statue: { size: 1.2, h: 2.7, value: 14 },
  car: { size: 1.72, h: 1.5, value: 18 }, van: { size: 1.85, h: 1.9, value: 22 }, truck: { size: 3.0, h: 3.2, value: 40 },
  bus: { size: 3.6, h: 3.0, value: 55 }, kiosk: { size: 1.8, h: 3.1, value: 28 }, busstop: { size: 1.6, h: 2.4, value: 12 },
  fountain: { size: 2.9, h: 2.9, value: 45 }, billboard: { size: 2.3, h: 4.2, value: 16 }, fence: { size: 1.9, h: 0.9, value: 3 },
};

function makePools() {
  const mProp = paintMaterial({ rough: 0.65 });
  const mPeople = paintMaterial({ anim: 'walk', aoH: 0.001, aoMin: 1, rough: 0.75 });
  const mTree = paintMaterial({ anim: 'wind', aoH: 2.2, aoMin: 0.72, rough: 0.9, env: 0.4 });
  const mCar = paintMaterial({ rough: 0.32, metal: 0.15, env: 1.3, aoH: 0.75, aoMin: 0.55 });
  const mRoof = paintMaterial({ shingles: true, rough: 0.85, aoH: 0.001, aoMin: 1 });
  const mFac = facadeMaterial();
  const add = (name, geo, mat, extra) => (P[name] = new Pool(name, geo, mat, extra));
  add('facade', G.facadeBox(), mFac, { aSty: 4 });
  add('fcyl', G.facadeCyl(), mFac, { aSty: 4 });
  add('roof', G.gableRoof(), mRoof);
  for (let v = 0; v < 3; v++) add('person' + v, G.person([0, 2, 3][v]), mPeople, { tint2: 3, aAnim: 3 });
  for (const k of ['car', 'taxi', 'police', 'van', 'bus', 'truck']) add(k, G.car(k), mCar);
  for (const k of ['round', 'conifer', 'palm', 'bush']) add(k === 'round' ? 'tree' : k, G.tree(k), mTree);
  for (const k of ['hydrant', 'bin', 'bench', 'lamp', 'mailbox', 'cone', 'booth', 'busstop', 'table', 'kiosk', 'cart', 'fountain', 'planter', 'signal', 'ac', 'tank', 'heli', 'antenna', 'chimney', 'billboard', 'fence', 'flowerbed', 'statue', 'solar', 'hut', 'garden']) add(k, G.prop(k), mProp);
  const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
  DECAL.pool = add('decal', dg, decalMaterial());
}

// ---------- object helpers ----------
function simple(type, pool, x, z, yaw, base, o = {}) {
  const t = T[type];
  const parts = [{ pool: P[pool], local: o.local || M(0, 0, 0, o.sc ?? 1, o.sc ?? 1, o.sc ?? 1), color: o.color }];
  const size = (o.size ?? t.size) * (o.sc ?? 1);
  return addObject({
    type, kind: o.kind || 'prop', x, z, yaw, base, size, h: t.h * (o.sc ?? 1), value: Math.round((o.value ?? t.value) * (o.sc ?? 1)),
    parts, decal: o.decal === false ? null : { w: o.dw ?? size * 2.6, d: o.dd ?? size * 2.6 },
  });
}

function sty(style, floorH, colW) { return [style, floorH, colW, rand() * 97]; }

function building(kind, x, z, w, d, base, yaw = 0) {
  const parts = []; let h, value, size, styleArr, wall;
  const roofExtras = (top, ww, dd) => {
    const r = rand();
    if (r < 0.3 && ww > 6) parts.push({ pool: P.solar, local: M(ww * 0.12, top, dd * 0.05, 1, 1, 1, chance(.5) ? 0 : Math.PI) });
    else if (r < 0.48 && ww > 6.5) parts.push({ pool: P.garden, local: M(-ww * 0.15, top, dd * 0.12) });
    if (chance(0.6) && ww > 5) parts.push({ pool: P.hut, local: M(ww * 0.28, top, -dd * 0.26, 1, 1, 1, Math.PI * Math.floor(rand() * 4) / 2) });
  };
  const roofProps = (top, ww, dd, n) => {
    for (let i = 0; i < n; i++) {
      const px = range(-ww * 0.3, ww * 0.3), pz = range(-dd * 0.3, dd * 0.3);
      parts.push({ pool: P.ac, local: M(px, top, pz, 1, 1, 1, chance(.5) ? 0 : Math.PI / 2) });
    }
  };
  if (kind === 'house') {
    const floors = chance(0.6) ? 2 : 1; h = floors * 2.9 + 0.3;
    wall = jit(pick(PAL.walls)); styleArr = sty(2, 2.9, 2.3);
    parts.push({ pool: P.facade, local: M(0, 0, 0, w, h, d), color: wall, attrs: { aSty: styleArr } });
    const along = w > d; const rh = Math.min(w, d) * 0.42;
    parts.push({ pool: P.roof, local: M(0, h, 0, along ? d : w, rh, along ? w : d, along ? Math.PI / 2 : 0), color: jit(pick(PAL.roofs), 0.1) });
    parts.push({ pool: P.chimney, local: M(w * 0.22, h + rh * 0.3, d * 0.2) });
    h += rh; value = 85; size = Math.max(w, d) * 0.56;
  } else if (kind === 'shop') {
    h = range(5.5, 8.5); wall = jit(pick(PAL.walls)); styleArr = sty(3, 3.4, 2.8);
    parts.push({ pool: P.facade, local: M(0, 0, 0, w, h, d), color: wall, attrs: { aSty: styleArr } });
    roofProps(h, w, d, irange(1, 2)); if (chance(0.4)) roofExtras(h, w, d);
    if (chance(0.35)) parts.push({ pool: P.billboard, local: M(0, h, d * 0.2, 1, 1, 1), color: col(pick(['#ff5a5f', '#3fa7ff', '#ffd23f', '#43d17a', '#ff8c42'])) });
    value = 70; size = Math.max(w, d) * 0.56;
  } else if (kind === 'apt') {
    h = range(13, 24); const brick = chance(0.3);
    wall = brick ? jit(pick(['#c0634a', '#b5573f', '#d07a5a', '#a85a48'])) : jit(pick(PAL.walls));
    styleArr = sty(brick ? 4 : 0, 3.0, range(2.2, 2.8));
    parts.push({ pool: P.facade, local: M(0, 0, 0, w, h, d), color: wall, attrs: { aSty: styleArr } });
    let tw = w, td = d;
    if (chance(0.5)) { parts.push({ pool: P.facade, local: M(0, h, 0, w * 0.7, 3.0, d * 0.7), color: wall, attrs: { aSty: styleArr } }); h += 3; tw = w * 0.7; td = d * 0.7; }
    roofProps(h, tw * 0.8, td * 0.8, irange(0, 2)); roofExtras(h, tw, td);
    if (chance(0.45)) parts.push({ pool: P.tank, local: M(range(-1, 1), h, range(-1, 1)) });
    value = 140; size = Math.max(w, d) * 0.56;
  } else if (kind === 'office') {
    h = range(24, 40); wall = jit(pick(PAL.office), 0.1); styleArr = sty(1, 3.6, 1.6);
    parts.push({ pool: P.facade, local: M(0, 0, 0, w, h, d), color: wall, attrs: { aSty: styleArr } });
    const cw = w * 0.72, cd = d * 0.72;
    parts.push({ pool: P.facade, local: M(0, h, 0, cw, 2.6, cd), color: wall.clone().multiplyScalar(0.92), attrs: { aSty: styleArr } });
    h += 2.6;
    if (chance(0.5)) parts.push({ pool: P.heli, local: M(0, h, 0, cw * 0.42, 1, cw * 0.42) });
    else { roofProps(h, cw, cd, 2); roofExtras(h, cw, cd); parts.push({ pool: P.antenna, local: M(cw * 0.25, h, -cd * 0.2) }); }
    value = 240; size = Math.max(w, d) * 0.56;
  } else if (kind === 'tower') {
    h = range(46, 70); wall = jit(pick(PAL.office), 0.12);
    const round = chance(0.35);
    styleArr = sty(round ? 1 : (chance(0.5) ? 5 : 1), 3.8, 1.5);
    if (round) {
      parts.push({ pool: P.fcyl, local: M(0, 0, 0, w, h, w), color: wall, attrs: { aSty: styleArr } });
      parts.push({ pool: P.fcyl, local: M(0, h, 0, w * 0.8, 4, w * 0.8), color: wall.clone().multiplyScalar(0.9), attrs: { aSty: styleArr } });
      h += 4; parts.push({ pool: P.heli, local: M(0, h, 0, w * 0.3, 1, w * 0.3) });
      size = w * 0.52;
    } else {
      const h1 = h * 0.58, h2 = h * 0.28, h3 = h * 0.14;
      parts.push({ pool: P.facade, local: M(0, 0, 0, w, h1, d), color: wall, attrs: { aSty: styleArr } });
      parts.push({ pool: P.facade, local: M(0, h1, 0, w * 0.82, h2, d * 0.82), color: wall, attrs: { aSty: styleArr } });
      parts.push({ pool: P.facade, local: M(0, h1 + h2, 0, w * 0.6, h3, d * 0.6), color: wall, attrs: { aSty: styleArr } });
      parts.push({ pool: P.antenna, local: M(0, h, 0, 1.4, 1.6, 1.4) });
      size = Math.max(w, d) * 0.56;
    }
    value = 420;
  } else if (kind === 'landmark') {
    h = range(85, 100); wall = col('#6fa6e8');
    styleArr = sty(1, 4.0, 1.4);
    parts.push({ pool: P.fcyl, local: M(0, 0, 0, w, h, w), color: wall, attrs: { aSty: styleArr } });
    for (let i = 1; i <= 3; i++) parts.push({ pool: P.fcyl, local: M(0, h * i / 4, 0, w * 1.04, 0.9, w * 1.04), color: col('#3b5f99'), attrs: { aSty: [0, 99, 99, 1] } });
    parts.push({ pool: P.fcyl, local: M(0, h, 0, w * 0.72, 5, w * 0.72), color: col('#8fc0f5'), attrs: { aSty: styleArr } });
    h += 5; parts.push({ pool: P.antenna, local: M(0, h, 0, 2, 3, 2) }); size = w * 0.54; value = 900;
  }
  return addObject({ type: kind, kind: 'building', x, z, yaw, base, size, h, value, parts, decal: { w: w * 1.75, d: d * 1.75 } });
}

// ---------- layout ----------
function blockOrigin(i, j) { return [CITY.X0 + i * CITY.PITCH + CITY.ROAD, CITY.X0 + j * CITY.PITCH + CITY.ROAD]; }

function chooseTypes() {
  const NX = CITY.NX, types = [];
  const ring = (i, j) => Math.max(Math.abs(i - (NX - 1) / 2), Math.abs(j - (NX - 1) / 2));
  const all = [];
  for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) all.push({ i, j, ring: ring(i, j) });
  // district plan
  for (const b of all) {
    if (b.ring < 1) b.kind = 'downtown';
    else if (b.ring < 2) b.kind = chance(0.55) ? 'downtown' : 'midtown';
    else if (b.ring < 3 && NX > 6) b.kind = 'midtown';
    else if (b.ring < 2) b.kind = 'midtown';
    else b.kind = 'residential';
  }
  const pickBlocks = (list, n, k) => { for (let c = 0; c < n && list.length; c++) { const b = list.splice(Math.floor(rand() * list.length), 1)[0]; b.kind = k; } };
  const down = all.filter(b => b.kind === 'downtown'); pickBlocks(down, 1, 'plaza');
  const mid = all.filter(b => b.kind === 'midtown'); pickBlocks(mid, 2, 'park'); pickBlocks(mid, 1, 'plaza'); pickBlocks(mid, 1, 'parking'); pickBlocks(mid, 3, 'shops');
  const out = all.filter(b => b.kind === 'residential'); pickBlocks(out, 3, 'park'); pickBlocks(out, 6, 'shops'); pickBlocks(out, 2, 'parking'); pickBlocks(out, 1, 'plaza');
  return all;
}

const GROUND_TYPE = { downtown: 0, midtown: 0, shops: 0, park: 1, plaza: 2, residential: 3, parking: 4 };

function sidewalkProps(b, bx, bz) {
  const B = CITY.BLOCK, y = CITY.CURB_H;
  const sides = [
    { ox: bx, oz: bz, dx: 1, dz: 0, nx: 0, nz: -1 },        // north edge (−z), road beyond
    { ox: bx + B, oz: bz + B, dx: -1, dz: 0, nx: 0, nz: 1 }, // south
    { ox: bx, oz: bz + B, dx: 0, dz: -1, nx: -1, nz: 0 },    // west
    { ox: bx + B, oz: bz, dx: 0, dz: 1, nx: 1, nz: 0 },      // east
  ];
  const leafy = b.kind !== 'downtown' && b.kind !== 'parking';
  for (const s of sides) {
    const at = (t, inset) => [s.ox + s.dx * t - s.nx * inset, s.oz + s.dz * t - s.nz * inset];
    const faceRoad = Math.atan2(s.nx, s.nz);
    for (const t of [5.5, 20.5]) { const [x, z] = at(t, 0.75); simple('lamp', 'lamp', x, z, faceRoad, y); }
    if (leafy) for (const t of [8.7, 17.3]) { const [x, z] = at(t, 1.25); simple('tree', chance(0.85) ? 'tree' : 'conifer', x, z, rand() * 6.28, y, { color: jit(pick(PAL.foliage), 0.15), sc: range(0.85, 1.05) }); }
    else for (const t of [8.7, 17.3]) { const [x, z] = at(t, 1.0); simple('planter', 'planter', x, z, 0, y, { color: jit(pick(PAL.foliage), 0.1) }); }
    // benches facing road
    if (chance(0.7)) { const [x, z] = at(range(10.5, 15.5), 2.4); simple('bench', 'bench', x, z, faceRoad, y); }
    if (chance(0.6)) { const [x, z] = at(range(2.2, 3.2), 0.6); simple('hydrant', 'hydrant', x, z, rand() * 6, y); }
    if (chance(0.7)) { const [x, z] = at(range(6, 7.5), 0.8); simple('bin', 'bin', x, z, 0, y, { color: jit(pick(['#2f8f5b', '#3d4f63', '#d35a2f', '#27739c']), 0.05) }); }
    if (chance(0.25)) { const [x, z] = at(range(19, 20), 0.8); simple('mailbox', 'mailbox', x, z, faceRoad, y); }
    if (chance(0.12)) { const [x, z] = at(range(23, 24), 1.4); simple('booth', 'booth', x, z, faceRoad, y); }
    if (chance(0.15)) { const [x, z] = at(15, 1.5); simple('busstop', 'busstop', x, z, faceRoad + Math.PI, y); }
    if (chance(0.12)) { const [x, z] = at(range(3, 5), 1.9); simple('cone', 'cone', x, z, 0, y); }
  }
  // traffic signal at one corner
  if (chance(0.7)) simple('signal', 'signal', bx + 0.6, bz + 0.6, Math.PI * 1.25, y);
}

function fillBlock(b) {
  const [bx, bz] = blockOrigin(b.i, b.j);
  const B = CITY.BLOCK, W = CITY.WALK, LOT = B - 2 * W, y = CITY.CURB_H;
  const lx = bx + W, lz = bz + W, cx = bx + B / 2, cz = bz + B / 2;
  b.x0 = bx; b.z0 = bz; b.cx = cx; b.cz = cz;
  sidewalkProps(b, bx, bz);
  const q = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  if (b.kind === 'downtown') {
    if (chance(0.5)) {
      { const w = range(12.5, 14); building(chance(0.4) ? 'landmark' : 'tower', cx, cz, w, w, y); }
      const tw = objects[objects.length - 1]; tw.decal.d = tw.decal.w;
      for (const [sx, sz] of q) { simple('planter', 'planter', cx + sx * 8.2, cz + sz * 8.2, 0, y, { color: jit(pick(PAL.foliage)) }); }
      for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) simple('bench', 'bench', cx + sx * 8.4, cz + sz * 8.4, Math.atan2(-sx, -sz), y);
    } else {
      for (const [sx, sz] of q) { const w = range(8.0, 9.0); building(chance(0.55) ? 'tower' : 'office', cx + sx * 4.9, cz + sz * 4.9, w, w, y); }
    }
  } else if (b.kind === 'midtown') {
    const layout = rand();
    if (layout < 0.5) for (const [sx, sz] of q) { const w = range(7.4, 8.4), d = range(7.4, 8.4); building(chance(0.7) ? 'apt' : 'office', cx + sx * 4.9, cz + sz * 4.9, w, d, y); }
    else {
      building('office', cx - 4.9, cz, range(8, 8.8), range(8, 8.8), y);
      building('apt', cx + 4.9, cz - 4.9, 7.8, 7.6, y); building('apt', cx + 4.9, cz + 4.9, 7.6, 7.8, y);
      simple('tree', 'tree', cx - 4.9, cz + 7.5, 0, y, { color: jit(pick(PAL.foliage)) });
    }
    simple('cart', 'cart', cx + range(-1, 1), cz + range(-1, 1), rand() * 6, y, { color: col(pick(['#3fa7ff', '#ff5a5f', '#43d17a'])) });
    for (let k = 0; k < 3; k++) simple('bench', 'bench', cx + range(-1.5, 1.5), cz + range(-1.5, 1.5), rand() * 6, y);
  } else if (b.kind === 'shops') {
    for (const [sx, sz] of q) {
      if (chance(0.15)) { simple('kiosk', 'kiosk', cx + sx * 5, cz + sz * 5, Math.atan2(sx, sz), y, { color: jit(pick(PAL.walls)) }); continue; }
      building('shop', cx + sx * 4.9, cz + sz * 4.9, range(6.2, 7.0), range(6.2, 7.0), y, chance(0.5) ? 0 : Math.PI / 2);
    }
    simple('cone', 'cone', cx + range(-1, 1), cz + range(-1, 1), 0, y);
    simple('bin', 'bin', cx + 1, cz - 1, 0, y, { color: col('#3d4f63') });
  } else if (b.kind === 'residential') {
    const LOTW = LOT / 3;
    for (let ix = 0; ix < 3; ix++) for (const sz of [-1, 1]) {
      const hx = lx + LOTW * (ix + 0.5), hz = cz + sz * 4.9;
      const w = range(4.6, 5.3), d = range(5.0, 5.8);
      building('house', hx, hz + sz * 0.6, w, d, y, 0);
      if (chance(0.7)) simple(chance(0.6) ? 'tree' : 'conifer', chance(0.6) ? 'tree' : 'conifer', hx + range(-1.8, 1.8), hz - sz * 3.4, rand() * 6, y, { color: jit(pick(PAL.foliage), 0.12), sc: range(0.65, 0.85) });
      if (chance(0.6)) simple('bush', 'bush', hx + (ix - 1) * 1.2 + range(-1, 1), cz + sz * 8.4, rand() * 6, y, { color: jit(pick(PAL.foliage), 0.1), sc: 0.8 });
      if (chance(0.35)) simple('flowerbed', 'flowerbed', hx, cz + sz * 1.6, 0, y, { sc: 0.8 });
    }
    for (let k = 0; k < 2; k++) if (chance(0.4)) simple('fence', 'fence', cx + range(-6, 6), cz + (k ? 1 : -1) * 8.8, 0, y);
    if (chance(0.6)) { parkedCar(cx + range(-4, 4), cz, rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2, y); }
  } else if (b.kind === 'park') {
    simple('fountain', 'fountain', cx, cz, 0, y, { dw: 8, dd: 8 });
    for (let k = 0; k < 24; k++) {
      let x, z, tries = 0;
      do { x = lx + range(1, LOT - 1); z = lz + range(1, LOT - 1); tries++; } while (tries < 20 && (Math.abs(x - cx) < 2.2 || Math.abs(z - cz) < 2.2 || Math.abs(Math.hypot(x - cx, z - cz) - 6.5) < 1.6));
      const kind = rand(); if (kind < 0.6) simple('tree', 'tree', x, z, rand() * 6, y, { color: jit(pick(PAL.foliage), 0.15), sc: range(0.9, 1.25) });
      else if (kind < 0.75) simple('conifer', 'conifer', x, z, rand() * 6, y, { color: jit('#3f8a3a', 0.1), sc: range(0.9, 1.3) });
      else simple('bush', 'bush', x, z, rand() * 6, y, { color: jit(pick(PAL.foliage), 0.12), sc: range(0.9, 1.3) });
    }
    for (const a of [0.4, 2.0, 3.6, 5.2]) simple('bench', 'bench', cx + Math.cos(a) * 4.6, cz + Math.sin(a) * 4.6, -a - Math.PI / 2, y);
    simple('cart', 'cart', cx + 6.5, cz + 1.8, 0.3, y, { color: col('#3fa7ff') });
    if (chance(0.6)) simple('statue', 'statue', cx - 7.5, cz - 7.5, 0.8, y);
    for (const [sx, sz] of q) if (chance(0.5)) simple('flowerbed', 'flowerbed', cx + sx * 3.0, cz + sz * 8.6, 0, y);
    for (let k = 0; k < 4; k++) simple('lamp', 'lamp', cx + q[k][0] * 2.0, cz + q[k][1] * 2.0, Math.atan2(q[k][0], q[k][1]), y);
  } else if (b.kind === 'plaza') {
    if (chance(0.5)) simple('fountain', 'fountain', cx, cz, 0, y, { dw: 8, dd: 8 }); else simple('statue', 'statue', cx, cz, rand() * 6, y, { sc: 1.25 });
    for (const [sx, sz] of q) {
      simple('kiosk', 'kiosk', cx + sx * 7.2, cz + sz * 7.2, Math.atan2(-sx, -sz), y, { color: jit(pick(PAL.walls)) });
      for (let k = 0; k < 2; k++) simple('table', 'table', cx + sx * (3.5 + k * 2.4) + range(-0.4, 0.4), cz + sz * (5.5 - k * 2.2), rand() * 6, y, { color: col(pick(['#ff5a5f', '#3fa7ff', '#ffd23f', '#43d17a', '#ff8c42'])) });
      simple('planter', 'planter', cx + sx * 8.4, cz - sz * 2.5, 0, y, { color: jit(pick(PAL.foliage)) });
      simple('tree', 'tree', cx + sx * 3.2, cz + sz * 8.6, 0, y, { color: jit(pick(PAL.foliage)), sc: 0.85 });
    }
    simple('cart', 'cart', cx - 4.5, cz + 0.5, 1.2, y, { color: col('#ff5a5f') });
  } else if (b.kind === 'parking') {
    for (const row of [0, 1]) for (let k = 0; k < 7; k++) {
      if (chance(0.3)) continue;
      const x = lx + 1.4 + k * 2.8, z = row ? lz + LOT - 3.3 : lz + 3.3;
      parkedCar(x, z, row ? Math.PI : 0, y);
    }
    simple('booth', 'booth', lx + LOT - 1.5, lz + LOT / 2, 0, y);
    for (let k = 0; k < 4; k++) simple('cone', 'cone', lx + 3 + k * 1.2, lz + LOT / 2 + range(-0.3, 0.3), 0, y);
  }
}

function carColor(kind) { return kind === 'taxi' ? col('#ffc61a') : kind === 'police' ? col('#f4f6fa') : jit(pick(PAL.cars), 0.08); }
function parkedCar(x, z, yaw, base) {
  const kind = chance(0.12) ? 'van' : (chance(0.1) ? 'taxi' : 'car');
  return simple(kind === 'van' ? 'van' : 'car', kind, x, z, yaw, base, { color: carColor(kind), dw: 2.9, dd: 6.0 });
}

// ---------- traffic graph ----------
function buildRoadGraph() {
  const N = CITY.NX + 1; const nodes = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    nodes.push({ i, j, x: CITY.X0 + i * CITY.PITCH + CITY.ROAD / 2, z: CITY.X0 + j * CITY.PITCH + CITY.ROAD / 2, nb: [] });
  }
  const at = (i, j) => (i >= 0 && j >= 0 && i < N && j < N) ? nodes[j * N + i] : null;
  for (const n of nodes) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const m = at(n.i + di, n.j + dj); if (m) n.nb.push(m); }
  city.nodes = nodes;
}

function spawnCar(kind) {
  const nodes = city.nodes; const a = pick(nodes); const b = pick(a.nb);
  const t = T[kind === 'bus' ? 'bus' : kind === 'truck' ? 'truck' : kind === 'van' ? 'van' : 'car'];
  const o = simple(kind === 'bus' ? 'bus' : kind === 'truck' ? 'truck' : kind === 'van' ? 'van' : 'car', kind, a.x, a.z, 0, 0, { color: kind === 'bus' ? jit(pick(['#ffb000', '#e8433f', '#2f7de1', '#35b26b'])) : carColor(kind), dw: kind === 'bus' ? 4 : 2.9, dd: kind === 'bus' ? 13 : 6 });
  o.moving = true; o.kind = 'car';
  o.drive = { a, b, s: range(0, CITY.BLOCK), turn: null, speed: kind === 'bus' ? 4.4 : range(5.0, 6.4), len: kind === 'bus' ? 10.5 : 4.5, wait: 0, cur: 0 };
  city.cars.push(o);
  return o;
}

function spawnPed(b, mode) {
  const v = irange(0, 2);
  const o = addObject({ type: 'person', kind: 'person', x: b.cx, z: b.cz, yaw: 0, base: CITY.CURB_H, size: T.person.size * 1.3, h: T.person.h * 1.3, value: 1,
    parts: [{ pool: P['person' + v], local: M(0, 0, 0, 1, 1, 1), color: col(pick(PAL.shirts)), attrs: { tint2: col(pick(PAL.pants)).toArray(), aAnim: [rand() * 6.28, 0, 0] } }],
    decal: { w: 0.9, d: 0.9 } });
  o.moving = true;
  if (mode === 'loop') {
    const inset = range(1.0, CITY.WALK - 0.5);
    o.walk = { mode: 'loop', b, inset, s: rand() * 4 * (CITY.BLOCK - 2 * inset), dir: chance(0.5) ? 1 : -1, speed: range(1.1, 1.7) };
  } else {
    o.walk = { mode: 'wander', b, tx: b.cx, tz: b.cz, idle: range(0, 2), speed: range(0.9, 1.4), wanderR: mode === 'plaza' ? 9 : 8.5 };
    o.x = b.cx + range(-7, 7); o.z = b.cz + range(-7, 7);
  }
  city.peds.push(o);
  return o;
}

function promenade() {
  const H = CITY.HALF, y = CITY.CURB_H;
  const L = CITY.SPAN / 2 + 2;
  for (let k = -L; k <= L; k += 9) {
    for (const [x, z, yaw] of [[k, -H + 2.2, 0], [k, H - 2.2, Math.PI], [-H + 2.2, k, Math.PI / 2], [H - 2.2, k, -Math.PI / 2]]) {
      const idx = Math.round(k / 9);
      if (idx % 2 === 0) simple('palm', 'palm', x + range(-0.5, 0.5), z + range(-0.5, 0.5), rand() * 6, y, { color: jit('#6fbf4a', 0.1), sc: range(0.9, 1.2) });
      else if (chance(0.6)) simple('bench', 'bench', x, z, yaw + Math.PI, y);
      if (idx % 3 === 1) simple('lamp', 'lamp', x * 1.0 + (Math.abs(x) > Math.abs(z) ? Math.sign(x) * 1.0 : 0), z + (Math.abs(z) >= Math.abs(x) ? Math.sign(z) * 1.0 : 0), yaw, y);
    }
  }
  for (let k = -L; k < L; k += 4.2) for (const [x, z, yaw] of [[k + 2.1, -H + 0.4, 0], [k + 2.1, H - 0.4, 0], [-H + 0.4, k + 2.1, Math.PI / 2], [H - 0.4, k + 2.1, Math.PI / 2]]) simple('fence', 'fence', x, z, yaw, y, { decal: false });
}

export function buildCity(scene) {
  resetObjects(); initGrid();
  for (const k in P) delete P[k];
  city.blocks = []; city.peds = []; city.cars = [];
  makePools();
  buildRoadGraph();
  const blocks = chooseTypes(); city.blocks = blocks;
  for (const b of blocks) fillBlock(b);
  promenade();
  // pedestrians
  for (const b of blocks) {
    const n = b.kind === 'downtown' ? 12 : b.kind === 'midtown' ? 10 : b.kind === 'shops' ? 9 : 6;
    for (let k = 0; k < n; k++) spawnPed(b, 'loop');
    if (b.kind === 'park' || b.kind === 'plaza') for (let k = 0; k < (b.kind === 'plaza' ? 16 : 10); k++) spawnPed(b, b.kind);
  }
  city.pedTarget = city.peds.length;
  // traffic
  for (let k = 0; k < 60; k++) spawnCar(chance(0.12) ? 'taxi' : chance(0.08) ? 'van' : chance(0.04) ? 'police' : 'car');
  for (let k = 0; k < 6; k++) spawnCar('bus');
  for (let k = 0; k < 4; k++) spawnCar('truck');
  city.carTarget = city.cars.length;
  // block type texture for the ground shader
  const data = new Uint8Array(CITY.NX * CITY.NZ * 4);
  for (const b of blocks) { const k = (b.j * CITY.NX + b.i) * 4; data[k] = GROUND_TYPE[b.kind]; data[k + 3] = 255; }
  const tex = new THREE.DataTexture(data, CITY.NX, CITY.NZ, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  U.uBlocks.value = tex; city.blockTex = tex;
  // build GPU pools
  const noShadow = new Set(['decal', 'heli', 'fence', 'cone', 'hydrant', 'mailbox', 'bin', 'ac', 'chimney', 'flowerbed', 'solar', 'garden', 'antenna']);
  for (const k in P) P[k].build(scene, { cast: !noShadow.has(k), receive: k !== 'decal' });
  P.decal.mesh.renderOrder = 1; P.decal.mesh.castShadow = false; P.decal.mesh.receiveShadow = false;
  for (const o of objects) { initParts(o); gridInsert(o); writeObject(o); }
  for (const k in P) P[k].flush();
  return city;
}

export { spawnPed, spawnCar, T as TIERS };
