// DOM HUD: hole labels, score popups, leaderboard, timer, combo, banners, results, skins.
import * as THREE from 'three';
import { SKINS, levelRadius } from './config.js';
import { store } from './store.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3();
const labels = new Map();
const pops = [];
let W = window.innerWidth, H = window.innerHeight;
export function hudResize() { W = window.innerWidth; H = window.innerHeight; }

export function project(x, y, z, cam) {
  cam.updateMatrixWorld();
  _v.set(x, y, z).project(cam);
  return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H, _v.z < 1];
}

export function clearLabels() { for (const [, el] of labels) el.remove(); labels.clear(); }
export function updateLabels(holes, cam, leader) {
  for (const h of holes) {
    let el = labels.get(h);
    if (!el) {
      el = document.createElement('div'); el.className = 'hl' + (h.isPlayer ? ' me' : '');
      el.innerHTML = `<div class="crown"></div><div class="lv"></div><div class="nm"></div>`;
      el.querySelector('.nm').textContent = h.name; $('labels').appendChild(el); labels.set(h, el);
      el._lv = el.querySelector('.lv'); el._lvv = -1;
    }
    el.style.setProperty('--c', h.color);
    if (!h.alive) { el.style.display = 'none'; continue; }
    const [sx, sy, vis] = project(h.x, 0.2, h.z - h.r * 1.05, cam);
    if (!vis || sx < -60 || sx > W + 60 || sy < (h.isPlayer ? -40 : 120) || sy > H - 60) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.transform = `translate3d(${sx.toFixed(1)}px,${(sy - 6).toFixed(1)}px,0) translate(-50%,-100%)`;
    if (el._lvv !== h.level) { el._lvv = h.level; el._lv.textContent = 'LV ' + h.level; }
    el.classList.toggle('lead', h === leader);
  }
}

export function popup(text, x, y, z, cam, cls = '') {
  const [sx, sy] = project(x, y, z, cam);
  let p = pops.find(q => !q.alive);
  if (!p) { if (pops.length > 40) return; const el = document.createElement('div'); el.className = 'pp'; $('popups').appendChild(el); p = { el, alive: false }; pops.push(p); }
  p.alive = true; p.t = 0; p.x = sx + (Math.random() - 0.5) * 30; p.y = sy; p.el.textContent = text; p.el.className = 'pp ' + cls; p.el.style.display = '';
}
export function updatePopups(dt) {
  for (const p of pops) {
    if (!p.alive) continue;
    p.t += dt; const t = p.t / 0.95;
    if (t >= 1) { p.alive = false; p.el.style.display = 'none'; continue; }
    const s = t < 0.15 ? 0.5 + t / 0.15 * 0.7 : (t < 0.3 ? 1.2 - (t - 0.15) / 0.15 * 0.2 : 1);
    p.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - t * 70).toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`;
    p.el.style.opacity = t > 0.7 ? (1 - (t - 0.7) / 0.3).toFixed(2) : '1';
  }
}
export function clearPopups() { for (const p of pops) { p.alive = false; p.el.style.display = 'none'; } }

export function setTimer(sec) {
  const s = Math.max(0, Math.ceil(sec)); const m = Math.floor(s / 60), r = s % 60;
  $('timeTxt').textContent = `${m}:${r < 10 ? '0' : ''}${r}`;
  $('timer').classList.toggle('low', s <= 10);
}
export function setObjective(mode, objectsLeft, survivors) {
  const el = $('objective');
  const html = mode === 'bite' ? `<b>LAST BITE</b><span>${objectsLeft.toLocaleString()} static ${objectsLeft === 1 ? 'object' : 'objects'} left</span>` : mode === 'standing' ? `<b>LAST HOLE STANDING</b><span>${survivors} alive · no respawns</span>` : '<b>CLASSIC</b><span>Highest score wins</span>';
  if (el.dataset.objective !== html) { el.dataset.objective = html; el.innerHTML = html; }
}
let boardKey = '';
export function updateBoard(holes, player, mode = 'classic', winner = null) {
  const sorted = [...holes].sort((a, b) => {
    if (mode === 'standing' && a.alive !== b.alive) return a.alive ? -1 : 1;
    if (mode === 'bite' && winner && a === winner) return -1;
    if (mode === 'bite' && winner && b === winner) return 1;
    return b.score - a.score;
  });
  const rows = []; const top = sorted.slice(0, 5); const pi = sorted.indexOf(player);
  const row = (h, i) => `<div class="r${h === player ? ' me' : ''}"><span class="n">${i + 1}</span><span class="d" style="background:${h.color}"></span><span class="nm">${h.name}</span><span class="sc">${fmt(h.score)}</span></div>`;
  top.forEach((h, i) => rows.push(row(h, i)));
  if (player && pi >= 5) { rows.push('<div class="sep"></div>'); rows.push(row(player, pi)); }
  const html = rows.join('');
  if (html !== boardKey) { $('board').innerHTML = html; boardKey = html; }
  return sorted;
}
export function fmt(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
let lastScore = -1;
export function setScore(n) { if (n === lastScore) return; lastScore = n; const el = $('scoreTxt'); el.textContent = fmt(n); el.style.transform = 'scale(1.18)'; clearTimeout(el._t); el._t = setTimeout(() => el.style.transform = '', 90); }
export function setSize(level, prog) { $('lvlTxt').textContent = level; $('sizeArc').style.strokeDashoffset = (113.1 * (1 - prog)).toFixed(1); }

let comboT = 0;
export function showCombo(n) { const el = $('combo'); const txt = typeof n === 'string' ? n : `COMBO x${Math.min(20, n)}`; el.innerHTML = txt; el.classList.add('on'); el.style.opacity = '1'; comboT = 0.9; }
export function tickCombo(dt) { if (comboT > 0) { comboT -= dt; if (comboT <= 0) { const el = $('combo'); el.classList.remove('on'); } } }
export function banner(text, color = '#fff') {
  const el = $('banner'); el.textContent = text; el.style.color = color; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
export function feed(html) {
  const f = $('feed'); const d = document.createElement('div'); d.className = 'f'; d.innerHTML = html; f.appendChild(d);
  while (f.children.length > 3) f.firstChild.remove();
  setTimeout(() => d.remove(), 3200);
}
export function countPop(text) { const el = $('count'); el.textContent = text; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

export function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
export function setCoins() { for (const el of document.querySelectorAll('.coinTxt')) el.textContent = store.coins; }

// ---------- skins ----------
export function skinPreviewCSS(s) {
  switch (s.style) {
    case 1: return `conic-gradient(${s.a},${s.b},${s.a},${s.b},${s.a})`;
    case 2: return `repeating-conic-gradient(${s.a} 0 18deg,${s.b} 18deg 36deg)`;
    case 3: return `repeating-conic-gradient(${s.a} 0 15deg,${s.b} 15deg 30deg)`;
    case 4: return `radial-gradient(circle at 30% 30%,#fff 0 2px,transparent 3px),radial-gradient(circle at 70% 75%,#fff 0 2px,transparent 3px),conic-gradient(${s.a},${s.b},${s.a})`;
    case 5: return `conic-gradient(${s.a},${s.b},${s.a},${s.b},${s.a},${s.b},${s.a})`;
    case 6: return `conic-gradient(${s.a},${s.b},${s.a},${s.b},${s.a})`;
    case 7: return `conic-gradient(#ff3d6e,#ffd23f,#3ddc84,#3dd6ff,#8b6bff,#ff3d6e)`;
    default: return `radial-gradient(circle,${s.b},${s.a} 70%)`;
  }
}
export function renderSkins(onPick) {
  const g = $('skinGrid'); g.innerHTML = '';
  const owned = store.owned, cur = store.skin;
  for (const s of SKINS) {
    const own = owned.includes(s.id);
    const afford = store.coins >= s.price;
    const d = document.createElement('div'); d.className = 'sk' + (s.id === cur ? ' sel' : '') + (own ? '' : afford ? ' afford' : ' locked');
    d.innerHTML = `<div class="pv" style="background:${skinPreviewCSS(s)}"></div><div class="nm">${s.name}</div>` +
      (s.id === cur ? `<div class="eq">EQUIPPED</div>` : own ? `<div class="eq" style="background:#8fd0ff">EQUIP</div>` : `<div class="pr"><span class="coin"></span>${s.price}</div>`);
    d.onclick = () => onPick(s, d);
    g.appendChild(d);
  }
}

// ---------- results ----------
let resultCoinTimer = null;
export function resetResults() { if (resultCoinTimer) clearInterval(resultCoinTimer); resultCoinTimer = null; }
export function showResults(sorted, player, coins, onDone, info = {}) {
  const rank = sorted.indexOf(player) + 1;
  $('over').querySelector('.rhead').textContent = info.reason === 'last-bite' ? 'LAST BITE!' : info.reason === 'last-standing' ? 'LAST HOLE STANDING!' : info.reason === 'empty' ? 'NO SURVIVORS — SCORE RESULT' : info.reason === 'timeout' && info.title === 'Last Bite' ? 'TIME OUT — SCORE RESULT' : `${info.title || 'ROUND'} OVER`;
  $('rankTxt').textContent = '#' + rank;
  $('rankSub').textContent = info.reason === 'last-bite' && info.winner === player ? 'FINAL OBJECT EATEN — YOU WIN!' : info.reason === 'last-standing' && player.alive ? 'LAST ONE ALIVE — YOU WIN!' : info.reason === 'empty' ? 'NO SURVIVORS — SCORE DECIDES' : rank === 1 ? 'CHAMPION!' : info.reason === 'timeout' && info.title === 'Last Bite' ? 'SCORE DECIDES THE RESULT' : rank <= 3 ? 'PODIUM!' : rank <= 5 ? 'NICE ROUND!' : 'KEEP GROWING!';
  document.querySelector('.rank .crown').style.visibility = rank === 1 ? 'visible' : 'hidden';
  const stars = rank === 1 ? 3 : rank <= 3 ? 2 : 1;
  for (let i = 1; i <= 3; i++) { const el = $('st' + i); el.classList.remove('on'); setTimeout(() => { if (i <= stars) el.classList.add('on'); }, 350 + i * 220); }
  $('standings').innerHTML = sorted.slice(0, 5).concat(rank > 5 ? [player] : []).map((h) => {
    const i = sorted.indexOf(h);
    return `<div class="r${h === player ? ' me' : ''}"><span class="n">${i + 1}</span><span class="d" style="background:${h.color}"></span><span class="nm">${h.name}</span><span class="sc">${h.score}</span></div>`;
  }).join('');
  $('rsScore').textContent = player.score; $('rsEaten').textContent = player.eaten; $('rsHoles').textContent = player.holesEaten; $('rsSize').textContent = player.maxLevel;
  // coin count-up
  const el = $('rsCoins'); let c = 0; const step = Math.max(1, Math.ceil(coins / 30));
  resetResults(); el.textContent = '0';
  resultCoinTimer = setInterval(() => { c = Math.min(coins, c + step); el.textContent = c; onDone && onDone(c === coins); if (c >= coins) { clearInterval(resultCoinTimer); resultCoinTimer = null; } }, 40);
  // next skin progress
  const owned = store.owned; const next = SKINS.find(s => !owned.includes(s.id));
  if (next) {
    const have = store.coins; const pct = Math.min(100, have / next.price * 100);
    $('nextSkin').innerHTML = have >= next.price ? `<span style="color:#ffd84a">${next.name} skin is ready to unlock in SKINS!</span><div class="bar"><i style="width:100%"></i></div>` : `Next skin: <b>${next.name}</b> — ${have}/${next.price}<div class="bar"><i style="width:${pct}%"></i></div>`;
  } else $('nextSkin').textContent = 'All skins unlocked — legend!';
  return rank;
}
