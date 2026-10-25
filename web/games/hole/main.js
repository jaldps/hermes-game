// Sinkhole City — game orchestration (menu / play / results), loop, input, hooks.
import * as THREE from 'three';
import { setOrientation, onBack, onPauseResume, goHome, params, vibrate as hostVibrate } from '../../shared/platform.js';
import { ROUND_TIME, SKINS, BOT_NAMES, BOT_COLORS, NUM_BOTS, CITY, levelRadius } from './config.js';
import { seed as seedRng, rand, range, pick } from './rng.js';
import { initRender, frameCamera, resize, R, viewBounds, setupGrade, renderFrame } from './render.js';
import { U } from './materials.js';
import { buildCity, P, city } from './city.js';
import { objects, writeObject, updateVisibility } from './objects.js';
import { updateCars, updatePeds, respawnLife } from './traffic.js';
import { Hole, holes, events, updateHoles, updateUniforms, clearHoles, setRimSkin, updateOccluders } from './holes.js';
import { makeBrain, updateBrain } from './bots.js';
import { initFx, updateFx, puff, sparkleRing, burst, resetFx, stars } from './fx.js';
import * as A from './audio.js';
import * as H from './hud.js';
import { store } from './store.js';
import { countStaticEdibles, matchEndReason, rankMatchHoles } from './match-rules.js';

const Q = {
  autoplay: params.get('autoplay') === '1', scene: params.get('scene'), seed: parseInt(params.get('seed') || '0', 10) || (Date.now() % 100000),
  fixed: params.get('fixedstep') === '1', warp: parseFloat(params.get('warp') || '0') || 0,
};
const headless = navigator.webdriver === true;
let userGesture = false;
const MODES = { classic: 'Classic', standing: 'Last Hole Standing', bite: 'Last Bite' };
const DURATIONS = [60, 90, 120, 180];
function selectedMode() { return Object.hasOwn(MODES, store.matchMode) ? store.matchMode : 'classic'; }
function selectedDuration() { return DURATIONS.includes(Number(store.matchDuration)) ? Number(store.matchDuration) : 120; }
const vibrate = ms => { if (userGesture && !Q.autoplay) hostVibrate(ms); };
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { userGesture = true; }, { capture: true });
setOrientation('portrait');

const G = { mode: 'boot', time: 0, roundT: ROUND_TIME, paused: false, player: null, countdown: 0, round: 0, sorted: [], popAcc: 0, popT: 0, lastTick: 99, menuCam: null, autoRestart: 0, overT: 0, lead: null, rules: 'classic', duration: 120, lastBiteWinner: null, resultReason: '' };
const $ = id => document.getElementById(id);

// ---------------- world ----------------
function disposeWorld() {
  for (const k in P) { const m = P[k].mesh; if (m) { R.scene.remove(m); m.geometry.dispose(); m.dispose?.(); } }
  clearHoles(R.scene); H.clearLabels(); H.clearPopups(); resetFx();
}
function currentSkin() { return SKINS.find(s => s.id === store.skin) || SKINS[0]; }

function spawnSpots(n) {
  const spots = []; let tries = 0;
  const lim = CITY.SPAN * 0.44;
  while (spots.length < n && tries < 600) {
    tries++;
    // spawn on road intersections / sidewalks so the hole starts with snacks nearby
    const i = Math.floor(rand() * (CITY.NX + 1)), j = Math.floor(rand() * (CITY.NX + 1));
    const x = CITY.X0 + i * CITY.PITCH + CITY.ROAD / 2 + range(-3, 3), z = CITY.X0 + j * CITY.PITCH + CITY.ROAD / 2 + range(-3, 3);
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (spots.every(s => Math.hypot(s[0] - x, s[1] - z) > 42 - tries * 0.05)) spots.push([x, z]);
  }
  while (spots.length < n) spots.push([range(-lim, lim), range(-lim, lim)]);
  return spots;
}

function buildWorld(withPlayer) {
  disposeWorld();
  seedRng(Q.seed + G.round * 7919);
  buildCity(R.scene);
  const nb = withPlayer ? NUM_BOTS : NUM_BOTS + 1;
  const spots = spawnSpots(nb + 1);
  const names = [...BOT_NAMES].sort(() => rand() - 0.5);
  if (withPlayer) {
    // player starts nearer the outskirts (residential), facing the city
    const s = spots[0];
    G.player = new Hole(R.scene, { name: 'You', isPlayer: true, skin: currentSkin(), x: s[0], z: s[1] });
    holes.push(G.player);
  } else G.player = null;
  for (let k = 0; k < nb; k++) {
    const s = spots[k + 1]; const c = BOT_COLORS[k % BOT_COLORS.length];
    const h = new Hole(R.scene, { name: names[k], skin: { a: c, b: '#ffffff', style: 0 }, x: s[0], z: s[1] });
    h.ai = makeBrain(0.55 + rand() * 0.4);
    holes.push(h);
  }
  if (G.player && Q.autoplay) G.player.ai = makeBrain(1.0);
  updateUniforms();
}

// ---------------- simulation ----------------
let respawnClock = 0, realDt = 0;
function sim(dt, fx = true) {
  window.__dbg && window.__dbg.sims++;
  G.time += dt; U.uTime.value = G.time;
  updateCars(dt, holes); updatePeds(dt, G.time);
  const frozen = G.mode === 'play' && G.countdown > 0;
  for (const h of holes) {
    if (h.ai) updateBrain(h, dt, G.time);
    if (frozen) { h.input.x = 0; h.input.z = 0; }
  }
  if (G.player && !G.player.ai) { G.player.input.x = inp.x; G.player.input.z = inp.z; if (G.mode !== 'play' || frozen) { G.player.input.x = 0; G.player.input.z = 0; } }
  updateHoles(dt, G.time);
  respawnClock -= dt; if (respawnClock <= 0) { respawnClock = 0.4; respawnLife(holes, dt); }
  handleEvents(fx);
  if (G.mode === 'play' && G.countdown <= 0) {
    const reason = matchEndReason({ mode: G.rules, aliveCount: holes.filter(h => h.alive).length, staticLeft: staticObjectsLeft(), lastEater: G.lastBiteWinner, clockExpired: G.roundT <= 0 });
    if (reason) endRound(fx, reason);
  }
  for (const o of objects) if (o.dirty && o.state !== 2) writeObject(o);
  for (const h of holes) h.updateVisual();
  updateUniforms();
  if (G.mode === 'play') {
    if (G.countdown > 0) {
      const before = Math.ceil(G.countdown / 0.8); G.countdown -= fx ? Math.max(dt, realDt) : dt; const after = Math.ceil(G.countdown / 0.8);
      if (fx && after !== before) { if (after > 0) { H.countPop(String(after)); A.sTick(false); } }
      if (G.countdown <= 0 && fx) { H.countPop('GO!'); A.sTick(true); }
    } else {
      G.roundT -= dt;
      const s = Math.ceil(G.roundT);
      if (fx && s <= 10 && s !== G.lastTick && s > 0) { G.lastTick = s; A.sTick(s <= 3); }
      if (G.roundT <= 0) { G.roundT = 0; endRound(fx); }
    }
  }
}

function visibleNear(x, z) { const c = R.camTarget; return Math.hypot(x - c.x, z - c.z) < R.camD * 0.9; }
function staticObjectsLeft() { return countStaticEdibles(objects); }
function handleEvents(fx) {
  if (!fx) {
    for (const e of events) if (e.type === 'eat' && G.rules === 'bite' && !e.obj.moving) G.lastBiteWinner = e.hole;
    events.length = 0; return;
  }
  for (const e of events) {
    const h = e.hole;
    if (e.type === 'eat') {
      if (G.rules === 'bite' && !e.obj.moving) G.lastBiteWinner = h;
      if (visibleNear(e.obj.x, e.obj.z)) puff(h.x + (e.obj.x - h.x) * 0.6, h.z + (e.obj.z - h.z) * 0.6, Math.min(h.r * 0.6, 3), e.obj.size);
      if (h === G.player) {
        A.sEat(e.obj.size, h.combo);
        if (e.obj.size > 0.8 || Math.random() < 0.3) stars(h.x, h.z, h.r, Math.min(8, 1 + Math.floor(e.obj.size * 1.5)));
        G.popAcc += e.pts;
        if (e.obj.size > 2.5) { R.shake = Math.min(1, R.shake + e.obj.size * 0.08); vibrate(e.obj.size > 5 ? 40 : 18); }
        if (h.combo >= 5 && h.combo % 5 === 0) { H.showCombo(h.combo >= 20 ? 'MEGA COMBO' : h.combo >= 10 ? 'SUPER COMBO' : 'COMBO'); A.sCombo(h.combo); }
        else if (h.combo > 5) H.showCombo(h.combo >= 20 ? 'MEGA COMBO' : h.combo >= 10 ? 'SUPER COMBO' : 'COMBO');
      } else if (visibleNear(h.x, h.z) && e.obj.size > 1.5) A.sEat(e.obj.size * 0.6, 0);
    } else if (e.type === 'level') {
      if (h === G.player) { H.banner('SIZE UP!', '#ffe14a'); A.sLevel(); sparkleRing(h.x, h.z, h.targetR, h.color); vibrate(25); R.shake = Math.min(1, R.shake + 0.25); }
    } else if (e.type === 'eatHole') {
      if (visibleNear(e.victim.x, e.victim.z)) burst(e.victim.x, e.victim.z, e.victim.r, e.victim.color);
      if (h === G.player) { H.banner('GULP!', '#7ef0ff'); H.feed(`You swallowed <span style="color:${e.victim.color}">${e.victim.name}</span> +${e.pts}`); A.sEatHole(); R.shake = 1; vibrate(60); G.popAcc += e.pts; }
      else if (e.victim === G.player) {
        A.sEaten(); vibrate(120); $('respawnBy').innerHTML = `by <span style="color:${h.color}">${h.name}</span>`;
        if (G.rules === 'standing') { $('respawn').classList.add('eliminated'); $('respawn').querySelector('.t1').textContent = 'ELIMINATED'; $('respawn').querySelector('.t3').textContent = 'No respawns — match continues'; H.show('respawn', G.mode === 'play'); }
        else H.show('respawn', G.mode === 'play');
      }
      else H.feed(`<span style="color:${h.color}">${h.name}</span> swallowed <span style="color:${e.victim.color}">${e.victim.name}</span>`);
    } else if (e.type === 'respawn') {
      if (h === G.player) H.show('respawn', false);
    }
  }
  events.length = 0;
}

// ---------------- flow ----------------
function fade(on) { $('fade').classList.toggle('on', on); }
function showMenu() {
  G.mode = 'menu'; G.paused = false;
  H.show('hud', false); H.show('over', false); H.show('pause', false); H.show('skins', false); H.show('menu', true);
  $('bestTxt').textContent = store.best; H.setCoins();
  syncMatchSetup();
  buildWorld(false);
  frameCamera(holes[0].x, holes[0].z, 3.2, 0, true); G.forceCull = true;
}
function startRound(opts = {}) {
  G.round++;
  G.rules = selectedMode(); G.duration = selectedDuration(); G.lastBiteWinner = null; G.resultReason = '';
  respawnClock = 0; inp.active = false; inp.x = inp.z = 0; inp.keys.clear(); $('respawn').classList.remove('eliminated'); $('respawn').querySelector('.t1').textContent = 'SWALLOWED!'; $('respawn').querySelector('.t3').textContent = 'Respawning…';
  buildWorld(true);
  for (const h of holes) h.noRespawn = G.rules === 'standing';
  G.mode = 'play'; G.paused = false; G.roundT = G.duration; G.lastTick = 99; G.sorted = []; G.popAcc = 0; G.popT = 0; G.autoRestart = 0;
  H.resetResults(); H.clearPopups(); H.clearLabels();
  G.countdown = (Q.autoplay || opts.instant) ? 0 : 2.4;
  H.show('menu', false); H.show('over', false); H.show('pause', false); H.show('skins', false); H.show('respawn', false); H.show('hud', true);
  $('hint').style.opacity = Q.autoplay ? '0' : '1'; hintShown = !Q.autoplay;
  frameCamera(G.player.x, G.player.z, G.player.r, 0, true); G.forceCull = true;
  H.setTimer(G.roundT);
  H.setObjective(G.rules, staticObjectsLeft(), holes.filter(h => h.alive).length);
  A.startMusic();
}
function endRound(fx, reason = 'timeout') {
  if (G.mode !== 'play') return;
  G.mode = 'over'; G.overT = 0; G.resultReason = reason;
  const sorted = rankMatchHoles(holes, G.rules, reason, G.lastBiteWinner); G.sorted = sorted;
  const rank = sorted.indexOf(G.player) + 1;
  const coins = Math.floor(G.player.score / 12) + ([60, 35, 22, 14, 10, 8, 6, 5][rank - 1] || 5);
  G.coinsEarned = coins;
  if (Q.autoplay) { G.autoRestart = 3; if (fx) H.banner("TIME'S UP!", '#fff'); return; }
  if (!G.testScene) store.coins = store.coins + coins;
  if (!G.testScene) store.best = Math.max(store.best, G.player.score); store.played = store.played + 1;
  if (fx) { H.banner(reason === 'last-bite' ? 'LAST BITE!' : reason === 'last-standing' ? 'LAST ONE!' : reason === 'empty' ? 'NO HOLES LEFT!' : reason === 'timeout' && G.rules === 'bite' ? 'TIME UP — SCORE WINS' : "TIME'S UP!", '#fff'); A.sFanfare(rank <= 3); }
  const resultRound = G.round;
  setTimeout(() => {
    if (G.mode !== 'over' || G.round !== resultRound) return;
    H.show('hud', false); H.show('over', true);
    H.showResults(sorted, G.player, coins, (done) => { A.sCoin(); }, { title: MODES[G.rules], reason, winner: G.lastBiteWinner });
    H.setCoins();
  }, fx ? 1400 : 0);
}

// ---------------- input ----------------
const inp = { glide: 0, x: 0, z: 0, active: false, ox: 0, oy: 0, id: -1, keys: new Set() };
let hintShown = false;
const JR = 52;
function onDown(e) {
  A.unlock(); if (G.mode === 'play') A.startMusic();
  if (G.mode !== 'play' || G.paused) return;
  inp.active = true; inp.id = e.pointerId; inp.ox = e.clientX; inp.oy = e.clientY; inp.x = inp.z = 0;
  const j = $('joy'); j.style.transform = `translate(${inp.ox}px,${inp.oy}px)`; j.querySelector('.knob').style.transform = ''; j.classList.add('on');
  if (hintShown) { hintShown = false; $('hint').style.opacity = '0'; }
}
function onMove(e) {
  if (!inp.active || e.pointerId !== inp.id) return;
  let dx = e.clientX - inp.ox, dy = e.clientY - inp.oy; const d = Math.hypot(dx, dy);
  if (d > JR) { // drag the joystick base along (relative joystick)
    inp.ox += dx / d * (d - JR); inp.oy += dy / d * (d - JR); dx = e.clientX - inp.ox; dy = e.clientY - inp.oy;
    $('joy').style.transform = `translate(${inp.ox}px,${inp.oy}px)`;
  }
  const dd = Math.hypot(dx, dy);
  const mag = dd < 5 ? 0 : Math.min(1, (dd - 5) / (JR * 0.6 - 5));
  inp.x = dd > 0 ? dx / dd * mag : 0; inp.z = dd > 0 ? dy / dd * mag : 0;
  $('joy').querySelector('.knob').style.transform = `translate(${dx}px,${dy}px)`;
}
function onUp(e) { if (e.pointerId !== inp.id) return; inp.active = false; inp.glide = 0.25; $('joy').classList.remove('on'); }
const touch = $('touch');
touch.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
function keyInput(dt) {
  if (inp.active) return;
  if (inp.glide > 0) { inp.glide -= dt; if (inp.glide <= 0) { inp.x = inp.z = 0; } return; }
  const k = inp.keys; let x = 0, z = 0;
  if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1; if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
  if (k.has('ArrowUp') || k.has('KeyW')) z -= 1; if (k.has('ArrowDown') || k.has('KeyS')) z += 1;
  const l = Math.hypot(x, z); inp.x = l ? x / l : 0; inp.z = l ? z / l : 0;
  if (l && hintShown) { hintShown = false; $('hint').style.opacity = '0'; }
}
window.addEventListener('keydown', e => { A.unlock(); inp.keys.add(e.code); if (e.code === 'Escape' || e.code === 'KeyP') backPressed(); });
window.addEventListener('keyup', e => inp.keys.delete(e.code));

// ---------------- UI wiring ----------------
const click = (id, fn) => $(id).addEventListener('click', (e) => { A.unlock(); A.sClick(); fn(e); });
click('btnPlay', () => { fade(true); setTimeout(() => { startRound(); fade(false); }, 300); });
click('btnHome', () => goHome());
click('btnSkins', () => { openSkins(); });
click('btnSkinsBack', () => { H.show('skins', false); });
click('btnPause', () => openPause());
click('btnResume', () => closePause());
click('btnSettings', () => openPause(true));
click('btnSound', () => { A.setMuted(!A.isMuted()); syncSettings(); });
click('btnQuality', () => { store.quality = store.quality === 'high' ? 'low' : 'high'; applyQuality(); syncSettings(); });
click('btnQuit', () => { closePause(); A.stopMusic(); fade(true); setTimeout(() => { showMenu(); fade(false); }, 300); });
click('btnAgain', () => { fade(true); setTimeout(() => { startRound(); fade(false); }, 300); });
click('btnMenu2', () => { A.stopMusic(); fade(true); setTimeout(() => { showMenu(); fade(false); }, 300); });

function syncSettings() { $('btnSound').textContent = 'SOUND: ' + (A.isMuted() ? 'OFF' : 'ON'); $('btnQuality').textContent = 'QUALITY: ' + store.quality.toUpperCase(); }
function syncMatchSetup() {
  const mode = selectedMode(), duration = selectedDuration();
  for (const b of document.querySelectorAll('.modeChoice')) b.classList.toggle('selected', b.dataset.mode === mode);
  for (const b of document.querySelectorAll('[data-duration]')) b.classList.toggle('selected', Number(b.dataset.duration) === duration);
  $('setupSummary').textContent = `${MODES[mode]} · ${duration}s · VS BOTS`;
}
for (const b of document.querySelectorAll('.modeChoice')) b.addEventListener('click', () => { store.matchMode = b.dataset.mode; syncMatchSetup(); A.sClick(); });
for (const b of document.querySelectorAll('[data-duration]')) b.addEventListener('click', () => { store.matchDuration = Number(b.dataset.duration); syncMatchSetup(); A.sClick(); });
function openPause(settingsOnly = false) {
  if (G.mode === 'play') G.paused = true;
  $('pauseTitle').textContent = settingsOnly ? 'SETTINGS' : 'PAUSED';
  $('btnResume').textContent = settingsOnly ? 'CLOSE' : 'RESUME';
  $('btnQuit').classList.toggle('hidden', settingsOnly);
  syncSettings(); H.show('pause', true);
  inp.active = false; inp.x = inp.z = 0; $('joy').classList.remove('on');
}
function closePause() { H.show('pause', false); G.paused = false; }
function openSkins() {
  H.setCoins();
  const pickSkin = (s) => {
    const owned = store.owned;
    if (owned.includes(s.id)) { store.skin = s.id; A.sClick(); }
    else if (store.coins >= s.price) { store.coins = store.coins - s.price; store.owned = [...owned, s.id]; store.skin = s.id; A.sCoin(); A.sCoin(1); A.sCoin(2); H.setCoins(); }
    else { A.sTick(false); return; }
    if (G.player) setRimSkin(G.player, currentSkin());
    H.renderSkins(pickSkin);
  };
  H.renderSkins(pickSkin); H.show('skins', true);
}
let maxPR = 2;
function applyQuality() {
  const q = store.quality; maxPR = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1.25 : 2);
  R.pr = maxPR; R.renderer.setPixelRatio(R.pr); resize();
  const sm = q === 'low' ? 1024 : 2048; const sh = R.sun.shadow;
  setupGrade(q !== 'low');
  if (sh.mapSize.x !== sm) { sh.mapSize.set(sm, sm); if (sh.map) { sh.map.dispose(); sh.map = null; } }
}
function backPressed() {
  if (!$('skins').classList.contains('hidden')) { H.show('skins', false); return true; }
  if (!$('pause').classList.contains('hidden')) { closePause(); return true; }
  if (G.mode === 'play') { openPause(); return true; }
  if (G.mode === 'over') { A.stopMusic(); showMenu(); return true; }
  return false;
}
onBack(backPressed);
onPauseResume(() => { if (G.mode === 'play' && !G.paused) openPause(); A.pauseAudio(); }, () => { A.resumeAudio(); });
window.addEventListener('resize', () => { resize(); H.hudResize(); });

// ---------------- loop ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, frameMs = 16, adaptT = 0;
let boardT = 0, cullN = 99; const VB = {};
window.__dbg = { frames: 0, sims: 0, board: 0 };
function frame(now) {
  requestAnimationFrame(frame); window.__dbg.frames++;
  const raw = Math.max(0, (now - last) / 1000); last = now;
  fpsAcc += raw; fpsN++; if (fpsAcc > 0.5) { window.__fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  frameMs += (raw * 1000 - frameMs) * 0.05;
  const dt = Q.fixed ? 1 / 60 : Math.min(raw, 1 / 30); realDt = Math.min(raw, 0.5);
  keyInput(G.paused ? 1 : dt);
  if (!G.paused) sim(dt);
  if (G.player) updateOccluders(G.player, dt || 1 / 30);
  if (++cullN >= 8 || G.forceCull) { cullN = 0; G.forceCull = false; updateVisibility(viewBounds(VB)); for (const k in P) P[k].compact(); }
  for (const k in P) P[k].flush();
  updateFx(G.paused ? 0 : dt);
  // camera
  if (G.mode === 'menu') {
    const t = holes.reduce((a, b) => (b.alive && b.r > a.r ? b : a), holes[0]);
    frameCamera(t.x, t.z, Math.max(3.4, t.r), dt);
  } else if (G.player) {
    let cameraHole = G.player;
    if (G.mode === 'play' && G.rules === 'standing' && !G.player.alive) cameraHole = holes.filter(h => h.alive).sort((a, b) => b.score - a.score)[0] || G.player;
    frameCamera(cameraHole.x, cameraHole.z, cameraHole.r, dt);
  }
  // HUD
  const lead = holes.reduce((a, b) => (b.score > a.score ? b : a), holes[0]);
  document.getElementById('labels').style.display = G.mode === 'menu' ? 'none' : '';
  if (G.mode !== 'menu') H.updateLabels(holes, R.camera, lead.score > 0 ? lead : null);
  H.updatePopups(G.paused ? 0 : dt); H.tickCombo(dt);
  if (G.mode === 'play' || G.mode === 'over') {
    boardT -= dt; if (boardT <= 0) { boardT = 0.25; window.__dbg.board++; const left = staticObjectsLeft(); const finalBiteWinner = left === 0 ? G.lastBiteWinner : null; G.sorted = H.updateBoard(holes, G.player, G.rules, finalBiteWinner); H.setObjective(G.rules, left, holes.filter(h => h.alive).length); }
    H.setTimer(G.roundT); H.setScore(G.player.score); H.setSize(G.player.level, G.player.progress);
    G.popT -= dt;
    if (G.popAcc > 0 && G.popT <= 0) {
      const p = G.player; const n = G.popAcc; G.popAcc = 0; G.popT = 0.14;
      H.popup('+' + n, p.x + range(-0.3, 0.3) * p.r, 0.5, p.z - p.r * 0.2, R.camera, n >= 100 ? 'huge' : n >= 20 ? 'big' : '');
    }
  }
  if (G.mode === 'over' && Q.autoplay) { G.autoRestart -= dt; if (G.autoRestart <= 0) startRound({ instant: true }); }
  // adaptive resolution (real devices only)
  adaptT += raw;
  if (!headless && adaptT > 2) {
    adaptT = 0;
    if (frameMs > 24 && R.pr > 1) { R.pr = Math.max(1, R.pr - 0.15); R.renderer.setPixelRatio(R.pr); resize(); }
    else if (frameMs < 13 && R.pr < maxPR) { R.pr = Math.min(maxPR, R.pr + 0.1); R.renderer.setPixelRatio(R.pr); resize(); }
  }
  renderFrame();
}

window.__game = {
  get mode() { return G.mode; }, get rules() { return G.rules; }, get duration() { return G.duration; }, get resultReason() { return G.resultReason; }, get lastBiteWinner() { return G.lastBiteWinner && G.lastBiteWinner.name; }, get time() { return G.time; }, get roundT() { return G.roundT; },
  get player() { const p = G.player; return p && { x: p.x, z: p.z, r: p.r, level: p.level, score: p.score, eaten: p.eaten, alive: p.alive }; },
  get holes() { return holes.map(h => ({ name: h.name, level: h.level, r: +h.r.toFixed(2), score: h.score, alive: h.alive })); },
  get objectsLeft() { return objects.filter(o => o.state === 0).length; },
  get drawCalls() { return R.renderer.info.render.calls; },
  start: () => startRound({ instant: true }), end: () => endRound(true),
  brain() { const p = G.player; return p && { x: +p.x.toFixed(1), z: +p.z.toFixed(1), tx: +p.ai.tx.toFixed(1), tz: +p.ai.tz.toFixed(1), ix: +p.input.x.toFixed(2), iz: +p.input.z.toFixed(2), r: p.r }; },
  simulate(sec) { const st = 1 / 30; for (let t = 0; t < sec; t += st) sim(st, false); return this.holes; },
};

// ---------------- boot ----------------
async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  initRender($('gl'), store.quality); maxPR = R.pr; setupGrade(store.quality !== 'low');
  initFx(R.scene);
  H.hudResize();
  if (Q.autoplay || Q.scene === 'play') startRound({ instant: Q.autoplay });
  else if (Q.scene === 'over') { startRound({ instant: true }); G.player.ai = makeBrain(0.95); G.testScene = true; for (let t = 0; t < 70; t += 1 / 20) sim(1 / 20, false); G.roundT = 0.01; sim(0.02, false); }
  else showMenu();
  if (Q.warp > 0) { const st = 1 / 30; for (let t = 0; t < Q.warp; t += st) sim(st, false); }
  if (G.player) frameCamera(G.player.x, G.player.z, G.player.r, 0, true);
  try { R.renderer.compile(R.scene, R.camera); } catch (e) {}
  last = performance.now();
  requestAnimationFrame(frame);
}
boot();
