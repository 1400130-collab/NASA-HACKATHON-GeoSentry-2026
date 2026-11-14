import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAll, DAYS, AREA } from './data.js';
import { Terrain } from './terrain.js';
import { Satellite, Rain, Clouds, Beacon, makeVectors } from './fx.js';
import { UI } from './ui.js?v=5';

const qs = new URLSearchParams(location.search);
const quality = qs.get('q') || ((navigator.hardwareConcurrency || 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent) ? 'mid' : 'high');
const MODE_ID = { img: 0, level: 1, suscept: 2, move: 3, burn: 4, coh: 5, ifg: 6 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'ultra' ? 2 : 1.25));     // map.html?q=ultra for full retina
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#05090d');
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 2500);
camera.position.set(0, 330, 2);
const controls = new MapControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 2.5, maxDistance: 330, maxPolarAngle: 1.47, zoomToCursor: true, screenSpacePanning: false });
controls.target.set(0, 0, 0);

const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: quality === 'ultra' ? 4 : 0 });      // multisampling a half-float target cost about 40% of the frame
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 1.0);
composer.addPass(bloom); composer.addPass(new OutputPass());
const inset = { l: 0, r: 0, t: 0, b: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  bloom.setSize(w * renderer.getPixelRatio() / 2, h * renderer.getPixelRatio() / 2);      // the glow is blurry anyway, so it gets a quarter of the pixels
  camera.aspect = w / h;
  // the controls cover the left and right edges, so the map is centred in the part between them
  const L = document.getElementById('left'), R = document.getElementById('right'), wide = w > 820;
  inset.l = wide ? L.offsetWidth : 0; inset.r = wide ? R.offsetWidth : 0;
  inset.t = document.getElementById('top').offsetHeight; inset.b = document.getElementById('time').offsetHeight + (wide ? 0 : R.offsetHeight);
  if (wide) camera.setViewOffset(w, h, Math.round((inset.r - inset.l) / 2), 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const app = { state: { mode: 'level', track: 0, img: null, tc: true, day: DAYS - 1, playing: false, sel: -1, hover: -1, county: 0, prov: 0, clouds: false, story: null } };
const bar = document.getElementById('introBar'), msg = document.getElementById('introMsg');
const D = app.D = await loadAll((f, k) => { bar.style.width = `${f * 82}%`; msg.textContent = `Loaded ${k}`; });
if (D.korea) {                                                  // city districts arrive as "Buk-gu" or "Suwonsijangangu": name them after their city
  const city = new Map(D.vectors.towns.map((t) => [t.ko, t.en]));
  for (const c of D.meta.counties) {
    const m = /^(.+시)(.+구)$/.exec(c.ko), en = m && city.get(m[1]); if (!en) continue;
    const pre = en.toLowerCase() + 'si', low = c.en.toLowerCase();
    c.en = `${en} ${low.startsWith(pre) ? low.slice(pre.length).replace(/gu$/, '-gu').replace(/^./, (x) => x.toUpperCase()) : c.en}`;
  }
}
app.state.img = D.img0; app.state.tc = D.trueColour;
camera.near = D.view.near; camera.updateProjectionMatrix(); controls.minDistance = D.view.minDist;
document.body.classList.add(D.korea ? 'area-korea' : 'area-region');
const terrain = app.terrain = new Terrain(D, quality);
scene.add(terrain.group);
const U = terrain.uniforms;
const vectors = makeVectors(D, U.uExag);
vectors.scars.visible = false;
Object.values(vectors).forEach((v) => scene.add(v));
const sats = D.tracks.map((t, i) => new Satellite(t.id, i, terrain)); sats.forEach((s) => scene.add(s.group));
const rain = new Rain(D), clouds = new Clouds(D), beacon = new Beacon();
scene.add(rain.mesh, clouds.mesh, beacon.group);

// ---- place labels (HTML, projected each frame) -----------------------------------------
const labHost = document.getElementById('labels'); let labels = [], labelsOn = true;
app.relabel = (lang) => {
  labHost.innerHTML = ''; labels = [];
  const add = (txt, x, z, cls, lift, rank = 0) => { const el = document.createElement('div'); el.className = 'lab ' + cls; el.textContent = txt; labHost.appendChild(el); labels.push({ el, x, z, lift, cls, rank }); };
  const ko = (lang || ui.lang) === 'ko';
  if (D.korea) {
    D.meta.provinces.forEach((p) => add(ko ? p.ko : p.en, D.sx(p.lx), D.sz(p.lz), 'prov', 1.2, 3e6 + p.units));
    D.meta.counties.filter((c) => c.units > 120 && c.cx !== null).forEach((c) => add(ko ? c.ko : c.en, D.sx(c.cx), D.sz(c.cz), 'cty', 0.5, c.units));
  } else D.meta.counties.filter((c) => c.units > 2500 && c.cx !== null).forEach((c) => add(ko ? c.ko : c.en, D.sx(c.cx), D.sz(c.cz), 'cty', 2.2, c.units));
  D.vectors.towns.forEach((t) => add(ko ? t.ko : t.en, D.sx(t.x), D.sz(t.z), 'town', D.korea ? 0.15 : 0.5, 2e6));
  labels.sort((a, b) => b.rank - a.rank);                      // provinces, then towns, then counties by size: the first to claim a spot keeps it
  for (const l of labels) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
};
const v3 = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight, far = camera.position.distanceTo(controls.target), bare = !!app.state.story;
  const x0 = bare ? 0 : inset.l - 8, x1 = w - (bare ? 0 : inset.r), y1 = h - 84, placed = [];
  for (const l of labels) {
    v3.set(l.x, D.hAt(l.x, l.z) * U.uExag.value + l.lift, l.z).project(camera);
    const hide = D.korea ? (l.cls === 'prov' && far < 22) || (l.cls === 'cty' && (far > 34 || far < 2.5)) || (l.cls === 'town' && (far > 70 || far < 2))
      : (l.cls === 'cty' && far < 28) || (l.cls === 'town' && far > 190);
    const sx = (v3.x * 0.5 + 0.5) * w, sy = (-v3.y * 0.5 + 0.5) * h;
    let vis = labelsOn && v3.z < 1 && sx > x0 + l.w / 2 && sx < x1 - l.w / 2 && sy > 56 && sy < y1 && !hide;
    if (vis) for (const p of placed) if (Math.abs(p.x - sx) < (p.w + l.w) / 2 + 8 && Math.abs(p.y - sy) < (p.h + l.h) / 2 + 3) { vis = false; break; }   // never two names on top of each other
    if (vis) placed.push({ x: sx, y: sy, w: l.w, h: l.h });
    l.el.style.opacity = vis ? 1 : 0;
    if (vis) l.el.style.transform = `translate(-50%,-50%) translate(${sx}px, ${sy}px)`;
  }
}

// ---- camera moves ---------------------------------------------------------------------------
let tween = null;
function flyTo({ x = 0, z = 0, dist = 118, polar = 0.86, az = -0.22, dur = 1.8 }) {
  const y = D.hAt(x, z) * U.uExag.value;
  const t1 = new THREE.Vector3(x, y, z), p1 = new THREE.Vector3(x + dist * Math.sin(polar) * Math.sin(az), y + dist * Math.cos(polar), z + dist * Math.sin(polar) * Math.cos(az));
  tween = { t: 0, dur, t0: controls.target.clone(), p0: camera.position.clone(), t1, p1 };
  return sleep(dur * 1000);
}
app.flyToUnit = (u) => flyTo({ x: D.sx(D.col.x[u]), z: D.sz(D.col.z[u]), dist: D.view.unitDist, polar: 1.02, az: Math.PI - D.col.aspect[u] * Math.PI / 180, dur: 2 });
// The opening view. The camera keeps its angle and backs off just far enough for the land to fill the space the
// controls leave free, centred in it. Nationwide that means the mainland: with Jeju in the frame the rest had to
// shrink and sit high, so Jeju is left to the bottom edge. Worked out from the window, so any size gets a full map.
function home() {
  const { polar, az } = D.home, C = D.col, w = innerWidth, h = innerHeight, step = Math.max(1, Math.floor(D.n / 5000));
  const jeju = D.korea ? D.meta.provinces.find((p) => p.en === 'Jeju')?.id : -1, pts = [];
  for (let u = 0; u < D.n; u += step) if (!D.korea || C.prov[u] !== jeju) { const x = D.sx(C.x[u]), z = D.sz(C.z[u]); pts.push(x, D.hAt(x, z) * U.uExag.value, z); }
  const fx0 = (inset.l + 16) / w * 2 - 1, fx1 = (w - inset.r - 20) / w * 2 - 1, fy1 = 1 - (inset.t + 30) / h * 2, fy0 = 1 - (h - inset.b - 22) / h * 2;   // the free rectangle, in clip space
  const cam = camera.clone(), p = new THREE.Vector3(), xs = [], ys = [], num = (a, b) => a - b, q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  const sp = Math.sin(polar), cp = Math.cos(polar), sa = Math.sin(az), ca = Math.cos(az);
  let { x, z, dist } = D.home;
  for (let i = 0; i < 16; i++) {
    cam.position.set(x + dist * sp * sa, dist * cp, z + dist * sp * ca); cam.lookAt(x, 0, z); cam.updateMatrixWorld();
    xs.length = ys.length = 0;
    for (let k = 0; k < pts.length; k += 3) { p.set(pts[k], pts[k + 1], pts[k + 2]).project(cam); xs.push(p.x); ys.push(p.y); }
    xs.sort(num); ys.sort(num);
    const x0 = q(xs, 0.004), x1 = q(xs, 0.996), y0 = q(ys, 0.004), y1 = q(ys, 0.996);              // a few far islets are allowed to fall outside
    const hh = dist * Math.tan(camera.fov * Math.PI / 360), hw = hh * camera.aspect, dx = (x0 + x1 - fx0 - fx1) / 2 * hw, dy = (y0 + y1 - fy0 - fy1) / 2 * hh / cp;
    x += ca * dx - sa * dy; z += -sa * dx - ca * dy;                                                // slide the target until the land is centred
    dist *= Math.max((x1 - x0) / (fx1 - fx0), (y1 - y0) / (fy1 - fy0));
  }
  return { x, z, dist: Math.min(dist, controls.maxDistance), polar, az };
}

// ---- state changes --------------------------------------------------------------------------
let ui;
app.setMode = (m) => {
  app.state.mode = m; U.uMode.value = MODE_ID[m]; app.imgT = m === 'img' ? 1 : 0; app.radT = m === 'ifg' ? 1 : 0;
  if (m === 'img') app.setImage(app.state.img); if (m === 'ifg') terrain.setRadar(D.tracks[app.state.track].id);
  ui.mode(m);
};
app.setTrack = (i) => { app.state.track = i; U.uTrack.value = i; terrain.timeKey = null; terrain.setTime(app.state.day); if (app.state.mode === 'ifg') terrain.setRadar(D.tracks[i].id); ui.track(i); };
app.setImage = (k, manual) => {
  app.state.img = k; if (manual) app.imgManual = true;
  const tc = D.trueColour && app.state.tc, key = tc ? k + '_tc' : k;
  terrain.setImage(key, `${D.base}s2_${key}.jpg`); ui.image(k);
};
app.setTrueColour = (on) => { app.state.tc = on; app.setImage(app.state.img); ui.legend(); };
app.setExag = (v) => { U.uExag.value = v; if (app.state.sel >= 0) placeBeacon(app.state.sel); };
app.setToggle = (k, on) => { if (k === 'labels') labelsOn = on; else if (k === 'edges') U.uEdges.value = on ? 1 : 0; else { vectors[k].visible = on; if (k === 'borders' && vectors.provinces) vectors.provinces.visible = on; } };
app.setCounty = (id) => {
  app.state.county = id; U.uCounty.value = id; ui.list(); const c = D.meta.counties.find((c) => c.id === id);
  if (c && c.cx !== null) flyTo({ x: D.sx(c.cx), z: D.sz(c.cz), dist: D.view.countyDist, polar: 0.8, az: -0.2 });
  else if (app.state.prov) app.setProvince(app.state.prov); else flyTo(home());
};
app.setProvince = (id) => {                                   // nationwide only: filter the list, fly to the province
  app.state.prov = id; app.state.county = 0; U.uCounty.value = 0; ui.list(); const p = D.meta.provinces?.find((p) => p.id === id);
  if (p) flyTo({ x: D.sx(p.cx), z: D.sz(p.cz), dist: D.view.provDist * Math.min(1.4, Math.max(0.45, Math.sqrt(p.units / 9000))), polar: 0.8, az: -0.2 }); else flyTo(home());
};
app.setHover = (u) => { app.state.hover = u; U.uHover.value = u >= 0 ? u + 1 : -1; app.soft?.(); };
function placeBeacon(u) { const x = D.sx(D.col.x[u]), z = D.sz(D.col.z[u]); beacon.place(x, D.hAt(x, z) * U.uExag.value, z); }
app.select = (u, fly) => {
  app.state.sel = u; U.uSel.value = u >= 0 ? u + 1 : -1;
  if (u >= 0) { placeBeacon(u); ui.tab('detail'); if (fly) app.flyToUnit(u); } else beacon.hide();
  ui.detail(); document.querySelectorAll('.item').forEach((el) => el.classList.toggle('sel', +el.dataset.u === u));
};
// moving through time: step the data, fire a sweep for every NISAR pass that is crossed
app.setDay = (d, manual) => {
  const prev = app.state.day; app.state.day = d;
  terrain.setTime(d); rain.setDay(d);
  app.state.clouds = (app.state.playing || !!app.state.story || manual) && d >= 45 && d < 66;
  clouds.target = app.state.clouds && !D.korea ? 0.8 : 0;              // nationwide the deck hid the whole storm area
  if (!manual && d > prev && d - prev < 6) D.tracks.forEach((tr, i) => { if (tr.days.some((p) => p > prev && p <= d)) sats[i].fire(app.state.story ? 2.6 : 2.2); });
  if (app.state.mode === 'img' && !app.imgManual) app.setImage(D.imgAt(d));
  ui.time(d);
};
app.pause = () => { app.state.playing = false; ui.playing(false); };
app.togglePlay = () => {
  const s = app.state; s.playing = !s.playing; app.imgManual = false;
  if (s.playing && s.day >= DAYS - 1.5) { s.day = 0; app.setDay(0, true); }
  if (s.playing && !['move', 'coh', 'img'].includes(s.mode)) app.setMode('move');
  ui.playing(s.playing);
};

// ---- storm replay ---------------------------------------------------------------------------
app.stopStory = () => { if (app.state.story) app.state.story.cancel = true; };
app.story = async () => {
  if (app.state.story) return app.stopStory();
  const tok = app.state.story = { cancel: false }, st = app.state, L = D.meta.levels, A = D.meta.anomaly;
  const wait = async (s) => { const end = performance.now() + s * 1000; while (performance.now() < end) { if (tok.cancel) throw 0; await sleep(50); } };
  const run = async (from, to, secs) => { const t0 = performance.now(); st.day = from; for (;;) { const f = Math.min(1, (performance.now() - t0) / (secs * 1000)); app.setDay(from + (to - from) * f); if (f >= 1) break; if (tok.cancel) throw 0; await sleep(16); } };
  document.body.classList.add('story'); app.pause(); app.select(-1); app.setCounty0?.();
  const sel0 = { mode: st.mode, day: st.day };
  try {
    if (D.korea) {
      const G = D.region, at = (dx, dz, dist, polar, az, dur) => flyTo({ x: G.x + dx, z: G.z + dz, dist, polar, az, dur });
      ui.caption(0); app.imgManual = true; st.tc = false; app.setMode('img'); app.setImage('prefire_2025'); st.day = 0; app.setDay(0);
      flyTo({ ...home(), dist: 112, polar: 0.62, dur: 3 }); await wait(2.6); app.setImage('postfire_2025'); at(-6, 14, 52, 0.78, -0.15, 5); await wait(5);
      ui.caption(1); app.setTrack(0); app.setMode('coh'); at(0, 0, 34, 0.92, -0.5, 6); await run(19, 37, 6.5);
      ui.caption(2); app.setMode('burn'); at(-1, 1, 24, 1.1, 0.35, 6); await run(41, 48.4, 6.5); await wait(1.2);
      ui.caption(3); app.setTrack(2); await terrain.setRadar('024'); app.setMode('ifg'); at(2, 0, 30, 0.7, 0.1, 5); await run(48.5, 50.4, 2.5); await wait(4.5);
      ui.caption(4, { n: (L.radar_measured || 0).toLocaleString(), m: L.moving_units, d: A.detect80_cm_well_oriented?.toFixed(0) ?? '8' });
      app.setTrack(0); app.setMode('move'); at(0, 1, 32, 0.8, -0.3, 7); await run(51, DAYS - 1, 7); await wait(1);
      ui.caption(5, { n: L.levels.check_first.toLocaleString() }); st.tc = D.trueColour; app.setMode('level'); reveal(); flyTo({ ...home(), dur: 5 }); await wait(7);
    } else {
    ui.caption(0); app.imgManual = true; app.setMode('img'); app.setImage('prefire_20250314'); st.day = 0; app.setDay(0);
    flyTo({ x: 4, z: 2, dist: 128, polar: 0.62, az: 0.25, dur: 3 }); await wait(2.6); app.setImage('postfire_20250408'); flyTo({ x: 6, z: 0, dist: 104, polar: 0.78, az: -0.15, dur: 5 }); await wait(5);
    ui.caption(1); app.setTrack(0); app.setMode('coh'); flyTo({ x: 0, z: 4, dist: 132, polar: 0.92, az: -0.5, dur: 6 }); await run(19, 37, 6.5);
    ui.caption(2); app.setMode('burn'); flyTo({ x: -8, z: 2, dist: 70, polar: 1.18, az: 0.35, dur: 6 }); await run(41, 48.4, 6.5); await wait(1.2);
    ui.caption(3); app.setTrack(2); await terrain.setRadar('024'); app.setMode('ifg'); flyTo({ x: 16, z: 0, dist: 112, polar: 0.7, az: 0.1, dur: 5 }); await run(48.5, 50.4, 2.5); await wait(4.5);
    ui.caption(4, { n: (D.n - L.levels.not_measurable).toLocaleString(), m: L.moving_units, d: A.detect80_cm_well_oriented?.toFixed(0) ?? '8' });
    app.setTrack(0); app.setMode('move'); flyTo({ x: 0, z: 6, dist: 118, polar: 0.8, az: -0.3, dur: 7 }); await run(51, DAYS - 1, 7); await wait(1);
    ui.caption(5, { n: L.levels.check_first.toLocaleString() }); app.setMode('level'); reveal(); flyTo({ ...home(), dur: 4 }); await wait(6.5);
    }
  } catch (e) { if (e !== 0) throw e; }
  ui.caption(null); document.body.classList.remove('story'); app.state.story = null; app.imgManual = false; st.tc = D.trueColour;
  if (tok.cancel) { app.setMode(sel0.mode); app.setDay(sel0.day, true); } else app.setDay(DAYS - 1, true);
  clouds.target = 0;
};
document.getElementById('capSkip').onclick = () => app.stopStory();
let revealing = false;
function reveal() { U.uRevealOn.value = 1; U.uRevealD.value.copy(sats[0].dir); revealing = true; sats[0].fire(3.6); }

// ---- pointer: hover + click picking ---------------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null, ptr = null;
const pickAt = (x, y) => { ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); return terrain.pick(ray.ray.origin, ray.ray.direction); };
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; idle = 0; app.ui.hintOff(); });
canvas.addEventListener('pointermove', (e) => { ptr = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerleave', () => { ptr = null; app.setHover(-1); ui.hoverTip(-1); });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || app.state.story) return;
  const p = pickAt(e.clientX, e.clientY); app.select(p && p.unit >= 0 ? p.unit : -1, false);
});
canvas.addEventListener('wheel', () => { idle = 0; app.ui.hintOff(); }, { passive: true });

// ---- frame loop ------------------------------------------------------------------------------
const clock = new THREE.Clock(); let time = 0, idle = 0, frame = 0;
app.imgT = 0; app.radT = 0;
// Draw only when something changes. One frame of this scene is expensive, and the old loop drew one on
// every screen refresh for ever, which kept the GPU at 100%. Now it runs at 60 fps while the camera or the
// data is moving, one frame for the hover highlight when the pointer pauses, and not at all otherwise (the pulsing slopes
// hold still). map.html?live=1 keeps it animating all the time (for an unattended screen).
const LIVE = qs.has('live'), HOT_GAP = 1000 / Math.min(Math.max(+qs.get('fps') || 60, 10), 120) - 2;      // map.html?fps=30 halves the load while dragging
let lastFrame = 0, lastPick = 0, hotUntil = 0, softAt = 0, ptrMoved = false;
app.soft = () => { softAt = performance.now() + 120; };          // the hover highlight: one redraw once the pointer pauses, none while it sweeps across
const poke = app.poke = (ms = 600) => { hotUntil = Math.max(hotUntil, performance.now() + ms); };
for (const k of Object.keys(app)) {                              // anything that changes the map's state asks for a redraw
  if (typeof app[k] !== 'function' || k === 'poke' || k === 'soft' || k === 'setHover') continue;
  const f = app[k]; app[k] = (...a) => { poke(); return f(...a); };
}
for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown', 'input', 'change', 'wheel']) addEventListener(ev, () => poke(1200), { passive: true, capture: true });
addEventListener('resize', () => poke());
controls.addEventListener('change', () => poke(250));            // also covers the glide after a drag
THREE.DefaultLoadingManager.onLoad = () => poke(1500);           // a satellite photo finished loading
canvas.addEventListener('pointermove', () => { ptrMoved = true; if (down) poke(250); });
function tick(now) {
  requestAnimationFrame(tick);
  if (ptrMoved && ptr && now - lastPick > 30 && !tween && !app.state.story) {       // hover costs a redraw only when the slope under the pointer changes
    ptrMoved = false; lastPick = now;
    const p = pickAt(ptr[0], ptr[1]), u = p ? p.unit : -1;
    if (u !== app.state.hover) app.setHover(u);
    ui.hoverTip(u, ptr[0], ptr[1]);
  }
  const settling = Math.abs(app.imgT - U.uImgOn.value) > 0.003 || Math.abs(app.radT - U.uRadarOn.value) > 0.003;
  const hot = app.state.playing || tween || app.state.story || revealing || down || settling || now < hotUntil;
  const due = softAt && now >= softAt;
  const gap = hot ? HOT_GAP : due ? 0 : LIVE ? 48 : Infinity;
  if (now - lastFrame < gap) return;
  if (due) softAt = 0;
  lastFrame = now;
  const dt = Math.min(clock.getDelta(), 0.1); time += dt; frame++;
  if (app.state.playing) { const d = app.state.day + dt * 5; if (d >= DAYS - 1) { app.setDay(DAYS - 1); app.pause(); } else app.setDay(d); }
  if (tween) {
    tween.t += dt / tween.dur; const f = ease(Math.min(1, tween.t));
    controls.target.lerpVectors(tween.t0, tween.t1, f); camera.position.lerpVectors(tween.p0, tween.p1, f);
    if (tween.t >= 1) tween = null;
  } else if (!app.state.story) {                               // slow drift when nobody is touching it (live mode only)
    idle += dt;
    if (LIVE && idle > 25 && !down) { const a = dt * 0.012, p = camera.position.clone().sub(controls.target); p.applyAxisAngle(THREE.Object3D.DEFAULT_UP, a); camera.position.copy(controls.target).add(p); }
  }
  controls.update();
  U.uImgOn.value += (app.imgT - U.uImgOn.value) * Math.min(1, dt * 4); U.uRadarOn.value += (app.radT - U.uRadarOn.value) * Math.min(1, dt * 4);
  terrain.update(dt, time); sats.forEach((s) => s.update(dt, time)); rain.update(dt, time); clouds.update(dt, time);
  if (revealing) { U.uRevealP.value = U.uScanP.value[0]; if (!sats[0].active) { revealing = false; U.uRevealOn.value = 0; } }
  if (beacon.group.visible) beacon.update(time, camera.position.distanceTo(beacon.group.position));
  placeLabels();
  composer.render();
}
canvas.addEventListener('pointerup', () => { down = null; });

ui = app.ui = new UI(app);
ui.tab('list'); app.setMode('level'); app.setTrack(0); ui.image(app.state.img);
terrain.setTime(app.state.day); rain.setDay(app.state.day); app.relabel(); ui.time(app.state.day);
bar.style.width = '100%'; msg.textContent = 'Ready';
app.home = home; window.__app = app; app.gfx = { renderer, composer, bloom, scene, camera, resize };      // handles for profiling in the console
requestAnimationFrame(tick);
await sleep(500);
document.getElementById('intro').classList.add('done');
reveal(); flyTo({ ...home(), dur: 4.2 });
