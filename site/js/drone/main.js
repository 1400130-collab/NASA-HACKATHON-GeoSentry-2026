// Drone mode (drone.html): fly a quadcopter over the North Gyeongsang burn area while the slopes the model flagged let go.
// Real ground (Copernicus DEM, Sentinel-2 land cover, OpenStreetMap roads and buildings), real model output (the
// simulated debris flows of pipeline p11). This file wires it together: loading, controls, the storm's own timing, the HUD.
import * as THREE from 'three';
import { fetchBin } from '../data.js';
import { Land } from './land.js';
import { Vectors, Mask, Trees, Buildings } from './props.js';
import { Slides } from './slides.js';
import { Sky } from './sky.js';
import { Craft } from './craft.js';
import { Audio } from './audio.js';

const $ = (s) => document.querySelector(s);
let lang = 'en'; try { lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('sw_lang') || 'en'; } catch { /* private mode */ }
const KO = lang === 'ko' ? 1 : 0;
const TXT = {
  slides: ['slides', '산사태'], hits: ['buildings hit', '피해 건물'], auto: ['storm auto', '자동 붕괴'], chase: ['chase cam', '3인칭'], fpvc: ['nose cam', '1인칭'],
  agl: ['m above ground', 'm 지상 고도'], msl: ['m elevation', 'm 해발'], k_f: ['trigger landslide', '산사태 일으키기'], k_v: ['camera', '시점'], k_t: ['next site', '다음 지점'], k_n: ['weather', '날씨'], k_b: ['sprint', '가속'], k_p: ['pause', '일시 정지'], k_m: ['mute', '음소거'], esc: ['esc · pause', 'esc · 일시 정지'],
  sim: ['Simulated debris flows from the GeoSentry runout model. Not real events.', 'GeoSentry 토석류 모의 결과입니다. 실제 사건이 아닙니다.'], lost: ['SIGNAL LOST', '신호 끊김'], back: ['← Back to the map', '← 지도로'],
  kicker: ['North Gyeongsang · July 2026 storm', '경북 산불 피해 지역 · 2026년 7월 폭우'], title: ['Fly the storm', '폭풍 속을 날다'], lede: ['Nothing here is drawn by hand. The AI picked the slopes. A physics solver moved the mud.', '손으로 그린 장면은 없습니다. AI가 사면을 골랐고, 물리 해석이 토석류를 움직입니다.'],
  f1: ['slopes scored by machine learning', '머신러닝이 점수를 매긴 사면'], f2: ['debris flows from a physics solver', '물리 해석으로 계산한 토석류'], f3: ['real terrain', '실제 지형'],
  f1s: ['LightGBM · {f} inputs per slope · trained on the July 2026 failures', 'LightGBM · 사면당 입력 {f}개 · 2026년 7월 붕괴 사면으로 학습'],
  f2s: ['Shallow-water flow · Voellmy friction μ {mu}, the far-reach case · {v} m³ let go per flagged slope', '천수 방정식 · Voellmy 마찰 μ {mu} (최대 도달 조건) · 표시된 사면마다 {v} m³ 방출'],
  c_move: ['fly', '이동'], c_look: ['look', '시선'], c_ud: ['up / down', '상승 / 하강'], c_view: ['first / third person', '1인칭 / 3인칭'], loading: ['Loading terrain', '지형 불러오는 중'], building: ['Building the valley', '지형 구성 중'],
  go: ['Click to fly', '클릭해서 비행'], resume: ['Resume', '계속'], paused: ['Paused', '일시 정지'], fail: ['Slope failure', '사면 붕괴'], hit: ['Building hit', '건물 피해'], clear: ['Clearing', '날씨 갬'], storm: ['Storm', '폭우'],
  site: ['Site', '지점'], reach: ['buildings in its path', '동이 경로 안'], nowebgl: ['This needs WebGL 2', 'WebGL 2가 필요합니다'], autoOn: ['Storm auto on', '자동 붕괴 켬'], autoOff: ['Storm auto off', '자동 붕괴 끔'], none: ['No flagged slope within 1.3 km', '1.3 km 안에 표시된 사면 없음'], noneSub: ['Press T to jump to one', 'T 키로 다음 지점으로 이동'],
};
const t = (k) => TXT[k][KO];
document.documentElement.lang = lang; document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
const CARD = [['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], ['북', '북동', '동', '남동', '남', '남서', '서', '북서']][KO];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const nextFrame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });      // the timeout: a hidden tab gets no frames

const canvas = $('#gl'), go = $('#go'), bar = $('#bar i');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); if (!renderer.capabilities.isWebGL2) throw 0; } catch { go.textContent = t('nowebgl'); throw new Error('WebGL 2 unavailable'); }
let maxDpr = Math.min(devicePixelRatio || 1, 1.5), dpr = maxDpr;
renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setClearColor(0x0b0c0d);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, .35, 150000);

// ---- load ----------------------------------------------------------------------------------------------------------------
let done = 0; const track = (p) => p.then((v) => { bar.style.width = `${++done / 6 * 100}%`; return v; });
const image = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const [meta, hb, rb, vj, img] = await Promise.all([track(fetch('data/meta.json').then((r) => r.json())), track(fetchBin('data/height.bin.gz')), track(fetchBin('data/runout.bin.gz')),
  track(fetch('data/vectors.json').then((r) => r.json())), track(image('data/s2_prestorm_20260612.jpg'))]);
// the start screen says where the scene comes from, with the pipeline's own figures
{ const n = (v) => v.toLocaleString('en-US'), ro = meta.runout;
  $('#fML').textContent = n(meta.units.n); $('#fMLs').textContent = t('f1s').replace('{f}', meta.features.length);
  $('#fPH').textContent = n(ro.simulated_slopes); $('#fPHs').textContent = t('f2s').replace('{mu}', ro.far.mu).replace('{v}', n(ro.release.volume_m3)); }
go.textContent = t('building'); await nextFrame(); await nextFrame();

const land = new Land(meta, hb, img, renderer), U = land.U; scene.add(land.group);
const vec = new Vectors(land, vj), mask = new Mask(land, vec), trees = new Trees(land, vec), bld = new Buildings(land, vec);
scene.add(trees.mesh, bld.mesh);
const slides = new Slides(land, vec, trees, rb, scene), sky = new Sky(land, scene), craft = new Craft(land, scene, camera), audio = new Audio();
craft.body.visible = false;
bar.style.width = '100%';

// ---- state -----------------------------------------------------------------------------------------------------------------
let now = 0, last = performance.now(), intro = true, paused = false, locked = false, auto = true, warm = true, nextAuto = 5, hot = 0, orbit = 0, showFps = false;
const keys = new Set(), look = { x: 0, y: 0 }, input = { f: 0, s: 0, u: 0, boost: false, dx: 0, dy: 0, gust: 0 }, pending = [];
const dir = new THREE.Vector3(), v3 = new THREE.Vector3(), site = { x: 0, z: 0, y: 0 };

function view(f) {                                               // a place to stand and watch flow f come down
  const rx = slides.rx[f], rz = slides.rz[f]; let dx = slides.cx[f] - rx, dz = slides.cz[f] - rz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const far = slides.len[f] + 190, px = rx + dx * far - dz * 80, pz = rz + dz * far + dx * 80, tx = (rx + slides.cx[f]) / 2, tz = (rz + slides.cz[f]) / 2, agl = 60;
  const py = land.hAt(px, pz) + agl, ty = land.hAt(tx, tz);
  return { px, pz, agl, yaw: Math.atan2(-(tx - px), -(tz - pz)), pitch: Math.atan2(ty - py, Math.hypot(tx - px, tz - pz)), tx, ty, tz };
}
function goSite(i) {
  hot = (i + slides.hot.length) % slides.hot.length; const f = slides.hot[hot], w = view(f);
  craft.place(w.px, w.pz, w.agl, w.yaw, w.pitch); warm = true; nextAuto = now + 4;
  if (!intro) toast(`${t('site')} ${hot + 1} / ${slides.hot.length}`, `${slides.nb[f]} ${t('reach')}`, false, 2600);
}
{ const w = view(slides.hot[0]); site.x = w.tx; site.z = w.tz; site.y = w.ty; }

// ---- HUD -------------------------------------------------------------------------------------------------------------------
const el = { spd: $('#spd'), agl: $('#agl'), msl: $('#msl'), nS: $('#nSlides'), nH: $('#nHits'), place: $('#place'), tgt: $('#tgt'), tgtD: $('#tgtD'), act: $('#act'), actD: $('#actD'), toast: $('#toast'), view: $('#cView'), auto: $('#cAuto'), fps: $('#fps'), lost: $('#lost'), stH: $('#stHits') };
const cmp = $('#compass').getContext('2d'), rad = $('#radar').getContext('2d');
let toastT = 0;
function toast(title, sub, red, ms = 3200) { el.toast.firstElementChild.textContent = title; el.toast.lastElementChild.textContent = sub || ''; el.toast.className = red ? 'on red' : 'on'; clearTimeout(toastT); toastT = setTimeout(() => { el.toast.className = red ? 'red' : ''; }, ms); }
const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360, card = (deg) => CARD[Math.round(deg / 45) % 8];
function mark(node, x, y, z, edge) {                              // put a HUD marker over a point in the world; true if it is on screen
  v3.set(x, y, z).applyMatrix4(camera.matrixWorldInverse); const front = v3.z < 0; v3.applyMatrix4(camera.projectionMatrix);
  let nx = v3.x, ny = v3.y; const on = front && Math.abs(nx) < .96 && Math.abs(ny) < .92;
  if (!on) { if (!edge) { node.style.display = 'none'; return false; } if (!front) { nx = -nx; ny = -ny; } const m = Math.max(Math.abs(nx) / .9, Math.abs(ny) / .8, 1e-3); nx /= m; ny /= m; if (!front && Math.abs(ny) < .8) ny = -.8; node.style.setProperty('--r', `${Math.atan2(nx, ny) * 180 / Math.PI}deg`); }
  node.style.display = 'block'; node.style.transform = `translate(${(nx * .5 + .5) * innerWidth}px, ${(-ny * .5 + .5) * innerHeight}px)`; return on;
}
function hud() {
  const p = craft.pos, head = (-craft.yaw * 180 / Math.PI % 360 + 360) % 360;
  el.spd.textContent = Math.round(craft.speed * 3.6); el.agl.textContent = Math.max(0, Math.round(craft.agl)); el.msl.textContent = Math.round(p.y);
  el.nS.textContent = slides.count; el.nH.textContent = slides.hits;
  let best = 1e18, name = ''; for (const c of meta.counties) if (c.cx != null) { const d = (c.cx * 1000 - land.hx - p.x) ** 2 + (c.cz * 1000 - land.hz - p.z) ** 2; if (d < best) { best = d; name = KO ? c.ko : c.en; } }
  el.place.textContent = `${KO ? '경북' : 'North Gyeongsang'} · ${name}`;
  // compass tape
  cmp.clearRect(0, 0, 600, 60); cmp.textAlign = 'center'; cmp.fillStyle = cmp.strokeStyle = '#f3f1ec'; cmp.lineWidth = 2;
  for (let d = Math.ceil((head - 62) / 5) * 5; d <= head + 62; d += 5) {
    const x = 300 + (d - head) * 4.6, a = 1 - Math.abs(d - head) / 64, dd = (d % 360 + 360) % 360; cmp.globalAlpha = a * (dd % 45 ? .45 : 1);
    cmp.beginPath(); cmp.moveTo(x, 60); cmp.lineTo(x, dd % 45 ? 50 : dd % 90 ? 44 : 40); cmp.stroke();
    if (dd % 45 === 0) { cmp.font = `${dd % 90 ? 500 : 700} ${dd % 90 ? 17 : 22}px "Roboto Mono", monospace`; cmp.fillText(CARD[dd / 45], x, 30); }
  }
  cmp.globalAlpha = 1; cmp.fillStyle = '#ff4d2e'; cmp.beginPath(); cmp.moveTo(300, 38); cmp.lineTo(293, 26); cmp.lineTo(307, 26); cmp.fill();
  // radar, heading up, 1.2 km
  const S = 336, c = S / 2, R = 1200, k = (c - 10) / R, sy = Math.sin(craft.yaw), cy = Math.cos(craft.yaw);
  const put = (x, z) => { const dx = x - p.x, dz = z - p.z; return [c + (dx * cy - dz * sy) * k, c + (dx * sy + dz * cy) * k, dx * dx + dz * dz < R * R]; };
  rad.clearRect(0, 0, S, S); rad.fillStyle = 'rgba(11,12,13,.5)'; rad.beginPath(); rad.arc(c, c, c - 6, 0, 6.2832); rad.fill();
  rad.strokeStyle = 'rgba(243,241,236,.28)'; rad.lineWidth = 2; rad.stroke(); rad.lineWidth = 1; rad.strokeStyle = 'rgba(243,241,236,.12)'; for (const r of [400, 800]) { rad.beginPath(); rad.arc(c, c, r * k, 0, 6.2832); rad.stroke(); }
  rad.fillStyle = 'rgba(243,241,236,.55)';
  const i0 = Math.max(0, Math.floor((p.x - R + land.hx) / 1000)), i1 = Math.min(vec.nx - 1, Math.floor((p.x + R + land.hx) / 1000)), j0 = Math.max(0, Math.floor((p.z - R + land.hz) / 1000)), j1 = Math.min(vec.nz - 1, Math.floor((p.z + R + land.hz) / 1000));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const b of vec.bldTiles[j * vec.nx + i]) { const [x, y, ok] = put(vec.bx[b], vec.bz[b]); if (ok) rad.fillRect(x - 2, y - 2, 4, 4); }
  for (const [, f] of slides.near) if (slides.fired[f] < 0) { const [x, y, ok] = put(slides.rx[f], slides.rz[f]); if (!ok) continue; rad.fillStyle = f === slides.target ? '#ffb020' : 'rgba(255,176,32,.6)'; rad.beginPath(); rad.moveTo(x, y - 6); rad.lineTo(x + 6, y); rad.lineTo(x, y + 6); rad.lineTo(x - 6, y); rad.fill(); if (f === slides.target) { rad.strokeStyle = '#ffb020'; rad.lineWidth = 2; rad.beginPath(); rad.arc(x, y, 12, 0, 6.2832); rad.stroke(); } }
  for (const A of slides.active) { const [x, y, ok] = put(A.x, A.z); if (!ok) continue; const pl = (now * 1.4) % 1; rad.fillStyle = '#ff4d2e'; rad.beginPath(); rad.arc(x, y, 7, 0, 6.2832); rad.fill(); rad.strokeStyle = `rgba(255,77,46,${1 - pl})`; rad.lineWidth = 2; rad.beginPath(); rad.arc(x, y, 7 + pl * 22, 0, 6.2832); rad.stroke(); }
  { const [x, y] = put(p.x, p.z - 1e5); const a = Math.atan2(y - c, x - c); rad.fillStyle = '#f3f1ec'; rad.font = '700 20px "Roboto Mono", monospace'; rad.textAlign = 'center'; rad.textBaseline = 'middle'; rad.fillText(CARD[0], c + Math.cos(a) * (c - 22), c + Math.sin(a) * (c - 22)); }
  rad.fillStyle = '#f3f1ec'; rad.beginPath(); rad.moveTo(c, c - 12); rad.lineTo(c + 8, c + 9); rad.lineTo(c, c + 4); rad.lineTo(c - 8, c + 9); rad.fill();
  if (showFps) el.fps.textContent = `${Math.round(1000 / ema)} fps · ${dpr.toFixed(2)}x · ${trees.chunks.size} chunks · ${bld.n} bld`;
}
function markers() {
  const f = slides.target, p = craft.pos;
  if (f >= 0) { const d = Math.hypot(slides.rx[f] - p.x, slides.rz[f] - p.z); mark(el.tgt, slides.rx[f], slides.ry[f] + 14, slides.rz[f], false); el.tgtD.textContent = `${t('k_f')} · ${Math.round(d / 10) * 10} m`; } else el.tgt.style.display = 'none';
  let A = null, bd = 1e18; for (const a of slides.active) { const d = (a.x - p.x) ** 2 + (a.z - p.z) ** 2; if (d < bd && now - a.t0 < 45) { bd = d; A = a; } }
  if (A) { const on = mark(el.act, A.x, land.hAt(A.x, A.z) + 10, A.z, true); el.act.className = on ? '' : 'off'; el.actD.textContent = `${Math.round(Math.sqrt(bd) / 10) * 10} m`; } else el.act.style.display = 'none';
}

// ---- the slides ------------------------------------------------------------------------------------------------------------
function fire(f, quiet) {
  if (!slides.fire(f, now)) return false;
  const p = craft.pos, dx = slides.rx[f] - p.x, dz = slides.rz[f] - p.z;
  if (!quiet) toast(t('fail'), `${Math.round(Math.hypot(dx, dz) / 10) * 10} m ${card(bearing(dx, dz))}${slides.nb[f] ? ` · ${slides.nb[f]} ${t('reach')}` : ''}`, true);
  return true;
}
slides.onHit = (b, d) => { audio.crunch(d); el.stH.classList.add('hit'); setTimeout(() => el.stH.classList.remove('hit'), 900); if (d < 900) toast(t('hit'), `${Math.round(d / 10) * 10} m`, true, 1800); };
slides.onCrack = (d) => audio.crack(d);
craft.onCrash = (p, v) => {
  const R = Math.random;
  for (let i = 0; i < 26; i++) slides.rock(p.x, p.y + .5, p.z, v.x * .25 + (R() - .5) * 16, 3 + R() * 10, v.z * .25 + (R() - .5) * 16, .08 + R() * .22, .03 + R() * .05, .08 + R() * .2, i % 4 ? .05 : .9, i % 4 ? .05 : .25, i % 4 ? .055 : .1, now, 3);
  for (let i = 0; i < 5; i++) slides.puff(p.x, p.y + 1, p.z, (R() - .5) * 6, 2 + R() * 3, (R() - .5) * 6, 3 + R() * 2, 2, 10 + R() * 8, .3, .28, .26, .7, now);
  audio.crash(); craft.shake = 1.6; el.lost.classList.add('on'); setTimeout(() => el.lost.classList.remove('on'), 900);
};
function storm() {                                                // the storm sets slopes off by itself: a strike, then the slope goes
  if (!auto || sky.storm < .7 || now < nextAuto) return;
  const p = craft.pos, c = slides.around(p.x, p.z, 2200).slice(0, 14); nextAuto = now + 9 + Math.random() * 12;
  let best = -1, bs = 1e9;
  for (const [d, f] of c) { if (d < 110) continue; const s = d * (1.6 - ((slides.rx[f] - p.x) * dir.x + (slides.rz[f] - p.z) * dir.z) / d) * (.6 + Math.random() * .8); if (s < bs) { bs = s; best = f; } }
  if (best < 0) return;
  audio.thunder(sky.strike(slides.rx[best], slides.rz[best], now, camera.position)); pending.push([now + .7, best]);
}

// ---- controls ----------------------------------------------------------------------------------------------------------------
function start() {
  audio.start(); document.body.classList.remove('gate'); paused = false;
  if (intro) { intro = false; craft.setView(false); goSite(0); nextAuto = now + 3.5; }
  canvas.focus();
  try { const r = canvas.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* no pointer lock: drag to look */ } }); } catch { /* same */ }
}
function pause() { if (intro || paused) return; paused = true; keys.clear(); go.textContent = t('resume'); $('#gate h1').textContent = t('paused'); document.body.classList.add('gate'); audio.ctx?.suspend(); if (document.pointerLockElement) document.exitPointerLock(); }
$('#gate').addEventListener('click', (e) => { if (e.target.closest('a') || go.disabled) return; start(); });
canvas.addEventListener('click', () => { if (!intro && !paused && !locked) start(); });
document.addEventListener('pointerlockchange', () => { const was = locked; locked = document.pointerLockElement === canvas; if (was && !locked) pause(); });
addEventListener('mousemove', (e) => { if (locked || (e.buttons & 1 && !paused && !intro)) { look.x += e.movementX; look.y += e.movementY; } });
addEventListener('blur', () => keys.clear());
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (intro || paused) { if (!go.disabled && (e.code === 'Enter' || e.code === 'Space')) start(); return; }
  if (e.repeat) return; keys.add(e.code);
  switch (e.code) {
    case 'KeyV': craft.setView(!craft.fpv); document.body.classList.toggle('fpv', craft.fpv); el.view.textContent = t(craft.fpv ? 'fpvc' : 'chase'); audio.blip(craft.fpv ? 990 : 660); break;
    case 'KeyF': {                                                   // set off the marked slope: a strike on it (in the storm), then it goes
      const f = slides.target; if (f < 0) { toast(t('none'), t('noneSub'), false, 2600); break; }
      if (sky.storm > .5) audio.thunder(sky.strike(slides.rx[f], slides.rz[f], now, camera.position));
      fire(f); audio.blip(520); break;
    }
    case 'KeyT': goSite(hot + 1); audio.blip(740); break;
    case 'KeyN': toast(t(sky.toggle() ? 'storm' : 'clear'), '', false, 1800); break;
    case 'KeyG': auto = !auto; el.auto.classList.toggle('on', auto); toast(t(auto ? 'autoOn' : 'autoOff'), '', false, 1500); break;
    case 'KeyM': audio.mute(!audio.muted); break;
    case 'KeyR': craft.place(craft.pos.x, craft.pos.z, 30, craft.yaw, craft.pitch); break;
    case 'KeyH': document.body.classList.toggle('nohud'); break;
    case 'Backquote': showFps = !showFps; el.fps.hidden = !showFps; break;
    case 'KeyP': case 'Escape': pause(); break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const has = (...k) => k.some((c) => keys.has(c));

// ---- every frame -----------------------------------------------------------------------------------------------------------
let ema = 16.7, lastTune = 0, hudT = 0, frames = 0;
function frame(ms) {
  const raw = Math.max(0, ms - last); last = ms; const dt = paused ? 0 : Math.min(.05, raw / 1000); now += dt; U.uTime.value = now; frames++;
  if (raw < 200) ema += (raw - ema) * .05;
  if (ms - lastTune > 3000 && frames > 120) {                     // keep the frame rate: give up sharpness before smoothness
    if (ema > 22 && dpr > .75) { dpr -= .125; maxDpr = Math.min(maxDpr, dpr + .125); renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); lastTune = ms + 9000; }
    else if (ema < 17.4 && dpr < maxDpr) { dpr += .125; renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); lastTune = ms; }
    else lastTune = ms;
  }
  if (intro) {                                                      // before take-off: circle the first site
    orbit += dt * .07; camera.position.set(site.x + Math.cos(orbit) * 420, site.y + 150, site.z + Math.sin(orbit) * 420); camera.lookAt(site.x, site.y + 20, site.z); camera.updateMatrixWorld();
  } else if (!paused) {
    input.f = (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0); input.s = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0); input.u = (has('Space', 'KeyE') ? 1 : 0) - (has('KeyC', 'KeyQ') ? 1 : 0);
    input.boost = has('ShiftLeft', 'ShiftRight'); input.gust = sky.storm * 5;
    input.dx = look.x * .0021 + ((has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0)) * 1.7 * dt; input.dy = look.y * .0021 + ((has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0)) * 1.2 * dt;
    craft.shake = Math.max(craft.shake, slides.shake);
    craft.update(dt, input, now, (x, z) => { const r = slides.at(x, z, now); return r && r[0] > 0 ? r[1] * 1.5 * Math.min(1, r[0] / 2.5) : 0; });
  }
  look.x = look.y = 0;
  const cam = camera.position; camera.getWorldDirection(dir);
  land.update(cam); mask.update(cam.x, cam.z); trees.update(cam.x, cam.z, warm ? 800 : 14); bld.update(cam.x, cam.z); warm = false;
  trees.uWind.value = .4 + sky.storm * .9; trees.mesh.visible = cam.y - land.hAt(cam.x, cam.z) < 720;      // from higher up no tree is near enough to draw
  if (!paused) {
    while (pending.length && pending[0][0] <= now) fire(pending.shift()[1]);
    slides.update(now, cam, dir);
    const th = sky.update(dt, now, cam, craft.vel); if (th >= 0) audio.thunder(th);
    if (!intro) storm();
    audio.update(craft.throttle, craft.speed, sky.storm, slides.rumble, craft.fpv, craft.dead <= 0 && !intro);
  }
  renderer.toneMappingExposure = U.uExposure.value;
  sky.dome.position.copy(cam);
  renderer.render(scene, camera);
  if (!intro) { markers(); if (ms - hudT > 110) { hudT = ms; hud(); } }
}

go.disabled = false; go.textContent = t('go'); document.body.classList.add('ready');
const loop = (ms) => { requestAnimationFrame(loop); frame(ms); };
requestAnimationFrame(loop);
window.__drone = { run: (sec) => { const keep = last; for (let i = 0; i < sec * 60; i++) frame(last + 1000 / 60); last = keep; }, THREE, land, vec, trees, bld, slides, sky, craft, audio, camera, renderer, start, fire, goSite, get now() { return now; }, get fps() { return 1000 / ema; }, get dpr() { return dpr; } };
