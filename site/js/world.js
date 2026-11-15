import * as THREE from 'three';
import { makeGeo } from './world-geo.js';

// The real world on the terrain: buildings in 3D, trees, and the ground itself (land cover, fields, water, roads,
// railways). Data: data/world/ (pipeline/world/). Nothing here replaces the terrain or its layers:
//   - the ground is a colour the terrain shader puts under the slope layers, so every layer still draws on top of it
//   - buildings and trees stand on the exact drawn surface (world-geo.js) and rise with the "mountain height" slider
//   - picking still goes to the slope under the pointer
// Far from the ground the whole country shows its land cover. Below about 35 km the tiles around the camera stream in
// (a worker unpacks them) and leave again as the camera moves on.
//
// Keeping it smooth:
//   - buildings come in three rings: every building near the camera, the larger ones further out, only the largest
//     in the far ring. A tile moving to a nearer ring gets chunks added; nothing is rebuilt
//   - a chunk is at most 2,500 buildings and only a few megabytes are handed to the GPU per frame
//   - the ground is two pictures, a sharp one around the camera inside a wide one, so neither is redrawn often
// Keeping it calm (nothing may sparkle while the camera moves):
//   - a building or tree that would cover less than about two pixels sinks into the ground and takes the ground's
//     colour, instead of flickering between pixels; buildings leaving a ring sink too, they are not switched off
//   - trees thin out with height as one nested set, each surviving tree where it stood, widening as its neighbours go
//   - from far away a mapped building is drawn as a small lit block, never smaller than a couple of pixels
const B_MAX_KM = 36, D_MAX_KM = 34, T_MAX_KM = 1.8, UPLOAD_BYTES = 2e6;
const FLAT = '#a29a8c';                                          // building footprints painted on the ground: the tone of the 3D buildings seen from afar

// Buildings read as a clean architectural model: pale walls, roofs in a few muted tones, soft shade at the foot.
// A new chunk fades in (an ordered dither, so it stays opaque and needs no sorting) instead of rising out of the ground.
const BLD_VERT = /* glsl */`
uniform float uExag, uHs, uGrow, uR, uShow, uMPU, uPx;
uniform vec2 uCenter;
attribute float aH; attribute vec2 aTop; attribute vec4 aN;
varying vec3 vN; varying float vHm, vRoof, vCls, vTint, vTop, vSmall, vFade;
void main() {
  vTop = aTop.x;
  vec3 p = position; p.y *= uExag;
  // how many pixels the building covers: one too small to hold still squats into its footprint on the ground picture
  float px = max(aTop.y, aTop.x * 0.6) / uMPU / (distance(cameraPosition, p) * uPx);
  float seen = smoothstep(1.6, 3.2, px);
  vSmall = 1.0 - smoothstep(3.0, 10.0, px);
  float h = (1.0 - smoothstep(uR * 0.8, uR, length(position.xz - uCenter))) * uShow * seen;
  p.y += aH * uHs * h;
  vFade = uGrow;
  float flag = aN.z * 127.0;
  vRoof = step(63.5, flag); vCls = flag - vRoof * 64.0; vTint = aN.w;
  vN = vRoof > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(vec3(aN.x, 0.0, aN.y));
  vHm = aH * uMPU;
  gl_Position = h < 0.002 || uGrow < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BLD_FRAG = /* glsl */`
uniform vec3 uFlat;
varying vec3 vN; varying float vHm, vRoof, vCls, vTint, vTop, vSmall, vFade;
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  if (vFade < 0.999 && vFade <= bayer4(gl_FragCoord.xy) * 0.96 + 0.02) discard;
  vec3 N = vRoof > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(vN);
  float diff = max(dot(N, normalize(vec3(-0.52, 0.66, -0.54))), 0.0), fill = max(dot(N, normalize(vec3(0.6, 0.5, 0.6))), 0.0);   // the terrain's two lights
  float light = 0.36 + 0.72 * diff + 0.14 * fill;
  float t = vTint * 0.5 + 0.5;
  vec3 roof = t < 0.46 ? vec3(0.46, 0.44, 0.4)                   // pale concrete
            : t < 0.62 ? vec3(0.2, 0.26, 0.32)                   // slate blue
            : t < 0.76 ? vec3(0.21, 0.29, 0.24)                  // grey-green
            : t < 0.88 ? vec3(0.36, 0.19, 0.14)                  // muted terracotta
            :            vec3(0.43, 0.39, 0.34);                 // warm grey
  vec3 wall = vec3(0.42, 0.4, 0.36) * (0.9 + 0.18 * fract(t * 7.3));
  if (vTop > 22.0) roof = vec3(0.42, 0.42, 0.41);               // apartment blocks: flat concrete roofs
  if (abs(vCls - 3.0) < 0.5) { roof = vec3(0.24, 0.29, 0.34); wall = vec3(0.46, 0.47, 0.48); }    // industry: blue-grey sheds
  if (abs(vCls - 5.0) < 0.5) { roof = vec3(0.7, 0.74, 0.72); wall = roof * 0.92; }               // greenhouses: pale film
  vec3 c = vRoof > 0.5 ? roof : wall;
  if (vRoof < 0.5) {
    float fl = vHm / 3.0, w = fwidth(fl);
    float band = mix(1.0, 0.86 + 0.14 * smoothstep(0.3, 0.42, fract(fl)), 1.0 - smoothstep(0.25, 0.6, w));
    c *= mix(1.0, band, smoothstep(8.0, 16.0, vTop));                                    // window bands on blocks of flats, once wide enough to see
    c *= 0.58 + 0.42 * smoothstep(0.0, 4.0, vHm);                                        // shade where the wall meets the ground
  }
  // small on screen: roof and walls merge toward the footprint painted on the ground, so rows of houses do not twinkle
  gl_FragColor = vec4(mix(c * light, uFlat * (0.86 + 0.2 * light), vSmall * 0.7), 1.0);
}`;

// Mapped buildings seen from far away (the points of data/**/vectors.json): a small lit block where each one stands.
// It keeps a size of a couple of pixels however high the camera is, and gives way to the real buildings close up.
const MARK_VERT = /* glsl */`
uniform float uExag, uMPU, uPx, uShow, uNear, uSize;
attribute vec3 iPos; attribute float iSeed;
varying vec3 vN; varying float vY, vSeed, vTiny;
void main() {
  vec3 base = vec3(iPos.x, iPos.y * uExag, iPos.z);
  float dist = distance(cameraPosition, base), real = uSize * (0.75 + 0.5 * iSeed) / uMPU;
  vTiny = 1.0 - smoothstep(0.8, 2.3, real / (dist * uPx));       // drawn bigger than it is: toned down, so towns are a texture, not glitter
  float s = max(real, 2.3 * dist * uPx) * uShow * (uNear > 0.0 ? smoothstep(uNear * 0.6, uNear, dist) : 1.0);
  float a = iSeed * 6.2832, cs = cos(a), sn = sin(a);
  vec3 q = vec3(position.x * cs - position.z * sn, position.y * (0.55 + 0.5 * fract(iSeed * 5.3)), position.x * sn + position.z * cs);
  vN = vec3(normal.x * cs - normal.z * sn, normal.y, normal.x * sn + normal.z * cs); vY = position.y; vSeed = iSeed;
  gl_Position = s <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(base + q * s, 1.0);
}`;
const MARK_FRAG = /* glsl */`
uniform vec3 uRoof, uWall;
varying vec3 vN; varying float vY, vSeed, vTiny;
void main() {
  vec3 N = normalize(vN);
  float light = 0.42 + 0.6 * max(dot(N, normalize(vec3(-0.52, 0.66, -0.54))), 0.0) + 0.16 * max(dot(N, normalize(vec3(0.6, 0.5, 0.6))), 0.0);
  vec3 c = N.y > 0.5 ? uRoof : uWall * 1.25;
  gl_FragColor = vec4(c * light * (0.92 + 0.16 * vSeed) * (1.0 - 0.45 * vTiny), 1.0);
}`;

// Trees: a sparse scatter close to the camera only (the forest colour of the ground does the rest). Low, rounded crowns
// in soft greens near the forest floor's own tone, so they add texture without speckling the slope colours.
const TREE_VERT = /* glsl */`
uniform float uExag, uHt, uR, uLam, uShow, uMPU, uPx;
uniform vec2 uCenter;
uniform vec3 uForest;
attribute vec3 iPos, iHSL; attribute float aRing;
#include <debris>
varying vec3 vC;
void main() {
  float d = length(iPos.xz - uCenter);
  // the detail level here rises with the camera. A tree whose rank is below it is gone, one exactly at it is
  // shrinking away, the others stand
  float lam = uLam, fl = floor(lam), rank = iHSL.z;
  float keep = rank > fl + 0.5 ? 1.0 : (rank > fl - 0.5 ? 1.0 - smoothstep(0.5, 1.0, lam - fl) : 0.0);
  float seed = iHSL.y, broad = step(0.45, fract(seed * 7.31));
  float rad = (2.4 + 1.6 * fract(seed * 3.7) + broad * 1.2) / uMPU * pow(1.2, lam);
  vec3 base = vec3(iPos.x, iPos.y * uExag, iPos.z);
  float f = (1.0 - smoothstep(uR * 0.6, uR, d)) * uShow * keep;
  float px = rad * f * 2.0 / (distance(cameraPosition, base) * uPx);
  f *= smoothstep(7.0, 12.0, px);                                 // a tree shrunk or far enough to be a speck is gone, not a dot
  if (uDebOn > 0.5 || uDebSel > -0.5) {                        // a simulated debris flow (fx.js) reaching the tree buries it
    float dm, dt; vec3 ds; vec4 dc = debCell(ivec2(floor(vec2(dot(uDebX, vec3(iPos.xz, 1.0)), dot(uDebZ, vec3(iPos.xz, 1.0))) + 0.5)), dm, dt, ds);
    f *= 1.0 - dc.x * smoothstep(-0.4, 1.6, dc.y);
  }
  float h = min(iHSL.x * uHt, rad * mix(3.0, 2.0, broad)) * f; rad *= f;          // never a spike: height capped by the crown's width
  vec3 q = position;
  if (aRing > 1.5) { q.y = mix(0.58, 0.8, broad); q.xz *= mix(0.5, 0.78, broad); }      // upper ring
  else if (aRing > 0.5) { q.y = mix(0.2, 0.36, broad); q.xz *= mix(1.0, 0.98, broad); } // lower ring
  float a = seed * 6.2832, cs = cos(a), sn = sin(a);
  vec3 p = base + vec3((q.x * cs - q.z * sn) * rad, q.y * h, (q.x * sn + q.z * cs) * rad);
  vec3 N = normalize(vec3(q.x * cs - q.z * sn, 0.6 + q.y * 0.8, q.x * sn + q.z * cs));
  float diff = max(dot(N, normalize(vec3(-0.52, 0.66, -0.54))), 0.0);
  vec3 col = mix(vec3(0.03, 0.075, 0.045), vec3(0.06, 0.1, 0.04), broad);
  col *= 0.85 + 0.3 * fract(seed * 13.1);
  // small on screen: the light and dark sides merge into the colour of the forest floor, so the canopy does not glitter
  vC = mix(uForest, col * (0.62 + 0.62 * diff) * (0.78 + 0.32 * q.y), smoothstep(3.0, 14.0, px) * 0.85 + 0.15);
  gl_Position = f < 0.02 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const TREE_FRAG = /* glsl */`varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }`;

function treeGeometry() {                                        // a seven-sided crown of two rings: the shader shapes it into a pine or a round broadleaf
  const S = 7, pos = [0, 1, 0, 0, 0.03, 0], ring = [0, 0], idx = [];
  for (let r = 1; r <= 2; r++) for (let i = 0; i < S; i++) { const a = (i + r * 0.5) / S * Math.PI * 2; pos.push(Math.cos(a), 0.3 * r, Math.sin(a)); ring.push(r); }
  for (let i = 0; i < S; i++) { const a = 2 + i, b = 2 + (i + 1) % S, c = 2 + S + i, d = 2 + S + (i + 1) % S; idx.push(1, a, b, a, c, b, b, c, d, 0, d, c); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 1)); g.setIndex(idx);
  return g;
}
function blockGeometry() {                                       // a unit block standing on the ground: four walls and a roof
  const P = [], Nn = [], I = [], face = (pts, n) => { const o = P.length / 3; for (const p of pts) { P.push(...p); Nn.push(...n); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const a = -0.5, b = 0.5;
  face([[a, 1, b], [b, 1, b], [b, 1, a], [a, 1, a]], [0, 1, 0]);
  face([[a, 0, b], [b, 0, b], [b, 1, b], [a, 1, b]], [0, 0, 1]); face([[b, 0, a], [a, 0, a], [a, 1, a], [b, 1, a]], [0, 0, -1]);
  face([[b, 0, b], [b, 0, a], [b, 1, a], [b, 1, b]], [1, 0, 0]); face([[a, 0, a], [a, 0, b], [a, 1, b], [a, 1, a]], [-1, 0, 0]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setIndex(I);
  return g;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class World {
  constructor(D, terrain, { quality = 'high', poke = () => {} } = {}) {
    this.D = D; this.terrain = terrain; this.poke = poke; this.U = terrain.uniforms;
    this.group = new THREE.Group(); this.group.renderOrder = 1;
    this.on = { buildings: true, trees: true, env: true };
    this.q = quality === 'low' ? 0.55 : quality === 'mid' ? 0.75 : 1;      // how far out detail is drawn, by device
    this.texPx = quality === 'low' ? 1024 : 2048;
    this.tiles = new Map(); this.inflight = 0; this.incoming = [];
    this.det = [{ busy: false, cur: null, tex: null }, { busy: false, cur: null, tex: null }];
    this.ready = false; this.busy = false; this.roadCut = 0; this.px = { value: 0.001 }; this.stats = { buildings: 0, trees: 0, tiles: 0, chunks: 0 };
    this.makeMarkers();
    this.init().catch((e) => console.warn('real-world layers unavailable:', e));
  }

  // the mapped buildings as small blocks (far view). They need no tiles, so they are there even without data/world/.
  makeMarkers() {
    const D = this.D, list = D.vectors.buildings || [], lin = (h) => new THREE.Color().setStyle(h);
    const surf = makeGeo({ korea: D.korea, k: D.k, Ws: D.Ws, Hs: D.Hs, W80: D.W80, H80: D.H80, step: this.terrain.step, h: D.h }).surface;
    const data = new Float32Array(list.length * 4);
    list.forEach((p, i) => { const x = D.sx(p[0]), z = D.sz(p[1]); data.set([x, surf(x, z), z, (Math.imul(i + 1, 2654435761) >>> 8) / 16777216], i * 4); });
    const g = blockGeometry(), ib = new THREE.InstancedInterleavedBuffer(data, 4);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('iSeed', new THREE.InterleavedBufferAttribute(ib, 1, 3)); g.instanceCount = list.length;
    this.uM = { uExag: this.U.uExag, uMPU: { value: 1000 * D.k }, uPx: this.px, uShow: { value: 0 }, uNear: { value: 0 }, uSize: { value: D.korea ? 60 : 16 },
      uRoof: { value: lin('#c9c2b5').multiplyScalar(0.86) }, uWall: { value: lin('#b2aa9c').multiplyScalar(0.8) } };
    this.markers = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uM, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG }));
    this.markers.frustumCulled = false; this.markers.visible = list.length > 0; this.group.add(this.markers);
  }

  async init() {
    const D = this.D, idx = await fetch('data/world/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!idx) return;                                            // the map works without the tiles
    this.idx = idx;
    const geo = { korea: D.korea, k: D.k, Ws: D.Ws, Hs: D.Hs, W80: D.W80, H80: D.H80, step: this.terrain.step, h: D.h, fit: idx.region };
    this.geo = makeGeo(geo); this.unitKm = this.geo.mPerUnit / 1000;
    const lin = (h) => new THREE.Color().setStyle(h);
    const U = this.U, shared = { uExag: U.uExag, uHs: { value: 1 }, uMPU: { value: this.geo.mPerUnit }, uPx: this.px };
    idx.palette = { ...idx.palette, building_flat: FLAT };
    this.uB = { ...shared, uR: { value: 1 }, uShow: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uFlat: { value: lin(FLAT).multiplyScalar(0.8) } };
    this.uT = { ...shared, uHt: { value: 1 }, uR: { value: 1 }, uLam: { value: 0 }, uShow: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uForest: { value: lin(idx.palette.tree_tall).multiplyScalar(0.95) } };
    for (const k of ['tDebA', 'uDebAW', 'uDebIY', 'uDebPB', 'uDebN', 'uDebX', 'uDebZ', 'uDebOn', 'uDebT', 'uDebSpread', 'uDebSel', 'uDebSelT', 'uDebCR']) this.uT[k] = U[k];   // the debris flows knock trees down
    this.treeMat = new THREE.ShaderMaterial({ uniforms: this.uT, vertexShader: TREE_VERT.replace('#include <debris>', this.terrain.debGLSL), fragmentShader: TREE_FRAG });
    this.treeBase = treeGeometry();
    this.Udet = [{ t: U.tDetail, c: U.uDetailC, h: U.uDetailH, on: U.uDetailOn }, { t: U.tDetail2, c: U.uDetail2C, h: U.uDetail2H, on: U.uDetail2On }];
    // the whole map's land cover, as the ground colour far from the camera
    const land = new THREE.TextureLoader().load(`data/world/land_${D.korea ? 'korea' : 'region'}.png`, () => this.poke(600));
    land.flipY = false; land.colorSpace = THREE.SRGBColorSpace; land.anisotropy = 8; land.wrapS = land.wrapT = THREE.ClampToEdgeWrapping;
    U.tLand.value = land;
    this.worker = new Worker(new URL('./world-worker.js?v=8', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.message(e.data);
    this.worker.onerror = (e) => console.warn('world worker:', e.message);
    this.worker.postMessage({ t: 'init', cfg: { base: new URL('data/world/', location.href).href, tile: idx.tile_m, q: idx.q_m, cells: idx.cells, ntx: idx.ntx, ntz: idx.ntz, tiles: idx.tiles, palette: idx.palette,
      maxPerTile: Math.round(60000 * this.q), geo: { ...geo, h: D.h.slice() } } });
    this.have = new Set(idx.tiles);
  }

  setOn(kind, on) { this.on[kind] = on; this.poke(900); }

  message(m) {
    if (m.t === 'ready') { this.ready = true; this.canvasOK = m.canvas; } else if (m.t === 'tile') this.gotTile(m); else if (m.t === 'detail') this.gotDetail(m); else if (m.t === 'trees') this.gotTrees(m);
    else if (m.t === 'error') {
      console.warn('world worker:', m.of, m.msg);
      if (m.of === 'tile') { this.inflight--; const t = this.tiles.get(m.key); if (t) { t.loading = false; t.counts = [t.built, t.built, t.built]; } } else if (m.of === 'detail') this.det.forEach((d) => { d.busy = false; }); else if (m.of === 'trees') this.treesBusy = false;
    }
    this.poke(700);
  }

  // ---- buildings ---------------------------------------------------------------------------------------------------
  // A tile is a list of chunks, each a mesh of the buildings b0..b1 in the tile's order (largest first).
  gotTile(m) {
    if (m.done) this.inflight--;
    const t = this.tiles.get(m.key);
    if (!t) return;                                              // the camera left before it arrived
    t.counts = m.counts;
    if (m.n) this.incoming.push(m); else if (m.done) t.loading = false;
  }
  upload() {                                                     // hand a few megabytes of the arrived chunks to the GPU, the rest next frame
    let bytes = 0;
    while (this.incoming.length && (bytes === 0 || bytes < UPLOAD_BYTES)) {
      const m = this.incoming.shift(), t = this.tiles.get(m.key);
      if (!t) continue;
      if (m.done) t.loading = false;
      if (m.b0 !== t.built || m.b0 >= t.counts[t.tier]) continue;      // the tile moved to a farther ring meanwhile
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setAttribute('aH', new THREE.BufferAttribute(m.hgt, 1));
      g.setAttribute('aN', new THREE.BufferAttribute(m.att, 4, true)); g.setAttribute('aTop', new THREE.BufferAttribute(m.top, 2, false)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      const grow = { value: 0 };                                 // new buildings fade in
      const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...this.uB, uGrow: grow }, vertexShader: BLD_VERT, fragmentShader: BLD_FRAG }));
      mesh.frustumCulled = false; this.group.add(mesh);
      t.chunks.push({ b0: m.b0, b1: m.b1, n: m.n, mesh, grow }); t.built = m.b1;
      bytes += m.pos.byteLength + m.hgt.byteLength + m.att.byteLength + m.top.byteLength + m.idx.byteLength;
    }
  }
  dropChunk(c) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); }
  dropTile(key) { const t = this.tiles.get(key); if (!t) return; t.chunks.forEach((c) => this.dropChunk(c)); t.dying.forEach((c) => this.dropChunk(c)); this.tiles.delete(key); }

  // rings: [far, lite, full] radii in metres. A tile's tier is the nearest ring it reaches.
  planTiles(gx, gz, R) {
    const T = this.idx.tile_m, ntx = this.idx.ntx, rMax = R[0], seen = new Set(), ask = [];
    const dist = (tx, tz) => Math.hypot(Math.max(tx * T - gx, 0, gx - (tx + 1) * T), Math.max(tz * T - gz, 0, gz - (tz + 1) * T));
    for (let tz = Math.max(0, Math.floor((gz - rMax) / T)); tz <= Math.min(this.idx.ntz - 1, Math.floor((gz + rMax) / T)); tz++)
      for (let tx = Math.max(0, Math.floor((gx - rMax) / T)); tx <= Math.min(ntx - 1, Math.floor((gx + rMax) / T)); tx++) {
        const key = tz * ntx + tx; if (!this.have.has(key)) continue;
        const d = dist(tx, tz); if (d >= rMax) continue;
        seen.add(key);
        let t = this.tiles.get(key);
        if (!t) { t = { chunks: [], dying: [], built: 0, counts: null, loading: false, tier: 0 }; this.tiles.set(key, t); }
        let tier = d < R[2] ? 2 : d < R[1] ? 1 : 0;
        if (tier < t.tier && d < R[t.tier] * 1.35) tier = t.tier;       // step down to a coarser ring a little late, so panning back and forth does not thrash
        t.tier = tier;
        if (t.counts) {
          const target = t.counts[tier];
          // a chunk the new ring does not need fades out (update() frees it at zero); one that is needed again fades back
          while (t.chunks.length && t.chunks.at(-1).b0 >= target) { t.dying.push(t.chunks.pop()); t.built = t.chunks.length ? t.chunks.at(-1).b1 : 0; }
          for (let i; t.built < target && (i = t.dying.findIndex((c) => c.b0 === t.built)) >= 0;) { const c = t.dying.splice(i, 1)[0]; t.chunks.push(c); t.built = c.b1; }
          if (t.built >= target) continue;
        }
        if (!t.loading) ask.push({ key, t, d, tier });
      }
    for (const key of [...this.tiles.keys()]) if (!seen.has(key)) { const tx = key % ntx; if (dist(tx, (key - tx) / ntx) > rMax * 1.2) this.dropTile(key); }
    ask.sort((a, b) => a.d - b.d);
    for (const r of ask) {
      if (this.inflight >= 6 || this.incoming.length > 24) break;       // the worker is ahead of the GPU: let the queue drain first
      r.t.loading = true; this.inflight++;
      this.worker.postMessage({ t: 'tile', key: r.key, tier: r.tier, have: r.t.built });
    }
  }

  // ---- ground pictures and trees --------------------------------------------------------------------------------------
  gotDetail(m) {
    const d = this.det[m.slot], u = this.Udet[m.slot]; d.busy = false;
    if (!m.bmp) return;
    const old = d.tex, tex = new THREE.Texture(m.bmp);
    tex.flipY = false; tex.premultiplyAlpha = false; tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8; tex.needsUpdate = true;
    u.t.value = tex; u.c.value.set(m.cx, m.cz); u.h.value = m.half;
    d.tex = tex; d.cur = { cx: m.cx, cz: m.cz, half: m.half };
    if (old) { old.image?.close?.(); old.dispose(); }
  }
  gotTrees(m) {
    this.treesBusy = false;
    if (this.trees) { this.group.remove(this.trees); this.trees.geometry.dispose(); this.trees = null; }
    const n = m.data.length / 6; this.stats.trees = n;
    this.treeSet = { cx: m.cx, cz: m.cz, radius: m.radius, level: m.level };
    if (!n) return;
    const g = this.treeBase.clone(), ib = new THREE.InstancedInterleavedBuffer(m.data, 6);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('iHSL', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    g.instanceCount = n;
    this.trees = new THREE.Mesh(g, this.treeMat); this.trees.frustumCulled = false; this.group.add(this.trees);
    this.uT.uCenter.value.set(m.cx, m.cz); this.uT.uR.value = m.radius;
  }

  // Called for every drawn frame. Decides what should be on screen for this camera and asks the worker for what is missing.
  update(camera, target, dt, viewH) {
    const U = this.U, k = Math.min(1, dt * 4);
    let busy = false;
    const ease = (u, to) => { if (Math.abs(u.value - to) > 0.004) { u.value += (to - u.value) * k; busy = true; } else u.value = to; };
    this.px.value = 2 * Math.tan(camera.fov * Math.PI / 360) / viewH;       // the angle one pixel covers: what is too small to draw is not drawn
    // far-away blocks for the mapped buildings; where a house is wide enough to see, the real buildings take over
    ease(this.uM.uShow, this.on.buildings ? 1 : 0);
    this.uM.uNear.value = this.ready && this.on.buildings ? (14 / this.uM.uMPU.value) / (1.2 * this.px.value) : 0;
    ease(U.uLandOn, this.ready && this.on.env && U.tLand.value.image ? 1 : 0);
    if (!this.ready) { this.busy = busy; return; }
    const dU = camera.position.distanceTo(target), dKm = dU * this.unitKm, km = 1 / this.unitKm;
    this.uB.uHs.value = Math.min(2.2, 1 + 0.15 * (U.uExag.value - 1));       // buildings and trees gain a small share of the terrain's exaggeration, not all of it
    this.uT.uHt.value = Math.min(1.5, 1 + 0.06 * (U.uExag.value - 1));
    const g = this.geo.toGrid(target.x, target.z), gx = g[0], gz = g[1];

    // buildings
    const showB = this.on.buildings && dKm < B_MAX_KM;
    ease(this.uB.uShow, showB ? 1 : 0);
    if (showB) {
      const q = this.q, rFull = clamp(dKm * 0.9, 1.5, 4.5) * q, rLite = clamp(dKm * 2.2, 5, 11) * q, rFar = clamp(dKm * 4.5, 10, 28) * q;
      this.uB.uCenter.value.set(target.x, target.z); this.uB.uR.value = rFar * km;
      this.planTiles(gx, gz, [rFar * 1000, rLite * 1000, rFull * 1000]);
    } else if (this.uB.uShow.value === 0 && this.tiles.size) { for (const key of [...this.tiles.keys()]) this.dropTile(key); this.incoming.length = 0; }
    this.upload();
    let nb = 0, nc = 0;
    for (const t of this.tiles.values()) {
      for (const c of t.chunks) { nc++; nb += c.n; if (c.grow.value < 1) { c.grow.value = Math.min(1, c.grow.value + dt * 3); busy = true; } }
      for (let i = t.dying.length - 1; i >= 0; i--) { const c = t.dying[i]; c.grow.value -= dt * 3; busy = true; if (c.grow.value <= 0) { this.dropChunk(c); t.dying.splice(i, 1); } }
    }
    this.stats.buildings = nb; this.stats.tiles = this.tiles.size; this.stats.chunks = nc;
    if (this.inflight || this.incoming.length) busy = true;

    // the ground: a sharp picture around the camera (a little ahead of where it looks) inside one four times as wide
    const showD = this.on.env && this.canvasOK && dKm < D_MAX_KM, fade = 1 - THREE.MathUtils.smoothstep(dKm, D_MAX_KM * 0.75, D_MAX_KM);
    const h0 = clamp(dKm * 1.15, 0.7, 12), halves = [h0 * km, clamp(h0 * 4, 5, 26) * km];
    const fx = target.x - camera.position.x, fz = target.z - camera.position.z, fl = Math.hypot(fx, fz) || 1;
    this.det.forEach((d, i) => {
      ease(this.Udet[i].on, showD && d.cur ? fade : 0);
      if (!showD || d.busy) return;
      const half = halves[i], cx = target.x + fx / fl * half * 0.3, cz = target.z + fz / fl * half * 0.3, c = d.cur;
      if (!c || Math.hypot(cx - c.cx, cz - c.cz) > c.half * 0.26 || half > c.half * 1.35 || half < c.half * 0.7) {
        d.busy = true; this.worker.postMessage({ t: 'detail', slot: i, cx, cz, half, px: this.texPx });
      }
    });
    const d0 = this.det[0].cur;
    this.roadCut = this.Udet[0].on.value > 0.5 && d0 ? dU + d0.half * 0.55 : 0;       // the main-road lines give way where the ground shows every road

    // trees: a sparse scatter around the camera, only when it is low; they fade out well before the overview zooms
    const showT = this.on.trees && this.canvasOK && dKm < T_MAX_KM;
    this.uT.uLam.value = clamp(Math.log2(dKm / 1.2), 0, 1.999);
    ease(this.uT.uShow, showT && this.trees ? 1 - THREE.MathUtils.smoothstep(dKm, T_MAX_KM * 0.5, T_MAX_KM) : 0);
    if (showT && !this.treesBusy) {
      const level = clamp(Math.floor(Math.log2(dKm / 1.2)), 0, 1), radius = clamp(dKm * 0.9, 0.8, 3.2) * this.q * km, s = this.treeSet;
      if (!s || s.level !== level || Math.hypot(target.x - s.cx, target.z - s.cz) > s.radius * 0.3 || radius > s.radius * 1.3 || radius < s.radius * 0.72) {
        this.treesBusy = true; this.worker.postMessage({ t: 'trees', cx: target.x, cz: target.z, radius, outer: 0, level });
      }
    } else if (!showT && this.uT.uShow.value === 0 && this.trees) { this.group.remove(this.trees); this.trees.geometry.dispose(); this.trees = null; this.treeSet = null; }
    this.busy = busy;
  }
}
