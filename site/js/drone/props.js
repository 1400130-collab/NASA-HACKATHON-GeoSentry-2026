// Drone mode: what stands on the ground. Trees in 64 m chunks around the drone (pine, broadleaf, burnt snags in the 2025
// scar), the mapped OpenStreetMap buildings as low houses, sheds and greenhouses turned to the nearest road, and the roads
// themselves painted into a picture the ground shader reads. Trees and buildings look up the debris-flow texture in the
// vertex shader: when a flow reaches one it goes over, with no work on the CPU.
import * as THREE from 'three';
import { COMMON } from './land.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const hash = (a, b, c) => { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177) | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
const ROAD_W = [14, 10, 8, 6, 4.5];

// ---- the map vectors, in metres, bucketed by 1 km tile ------------------------------------------------------------------
export class Vectors {
  constructor(land, v) {
    const hx = land.hx, hz = land.hz, nx = this.nx = Math.ceil(land.W / 1000), nz = this.nz = Math.ceil(land.H / 1000);
    this.land = land;
    this.roads = v.roads.map((r) => ({ k: r.k, p: Float32Array.from(r.p.flatMap(([x, z]) => [x * 1000 - hx, z * 1000 - hz])) }));
    const nb = this.nb = v.buildings.length; this.bx = new Float32Array(nb); this.bz = new Float32Array(nb);
    this.roadTiles = Array.from({ length: nx * nz }, () => []); this.bldTiles = Array.from({ length: nx * nz }, () => []);
    v.buildings.forEach(([x, z], i) => { this.bx[i] = x * 1000 - hx; this.bz[i] = z * 1000 - hz; const t = this.tile(this.bx[i], this.bz[i]); if (t >= 0) this.bldTiles[t].push(i); });
    this.roads.forEach((r, ri) => {
      const p = r.p; let last = -1;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 400));
        for (let s = 0; s <= n; s++) { const t = this.tile(p[i] + (p[i + 2] - p[i]) * s / n, p[i + 1] + (p[i + 3] - p[i + 1]) * s / n); if (t >= 0 && t !== last && !this.roadTiles[t].includes(ri)) this.roadTiles[t].push(ri); last = t; }
      }
    });
    this.occ = new Map();
  }
  tile(x, z) { const i = Math.floor((x + this.land.hx) / 1000), j = Math.floor((z + this.land.hz) / 1000); return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i; }
  // 8 m cells of one tile where no tree may stand: on a road, against a building
  occupied(x, z) {
    const t = this.tile(x, z); if (t < 0) return true;
    let o = this.occ.get(t);
    if (!o) {
      if (this.occ.size > 400) this.occ.clear();
      o = new Uint8Array(125 * 125); const ti = t % this.nx, tj = (t - ti) / this.nx, x0 = ti * 1000 - this.land.hx, z0 = tj * 1000 - this.land.hz;
      const mark = (px, pz, r) => { const a = Math.max(0, Math.floor((px - r - x0) / 8)), b = Math.min(124, Math.floor((px + r - x0) / 8)), c = Math.max(0, Math.floor((pz - r - z0) / 8)), d = Math.min(124, Math.floor((pz + r - z0) / 8)); for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) o[j * 125 + i] = 1; };
      for (const ri of this.roadTiles[t]) {
        const { p, k } = this.roads[ri], r = ROAD_W[k] / 2 + 2.5;
        for (let i = 0; i + 3 < p.length; i += 2) { const n = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 5)); for (let s = 0; s <= n; s++) mark(p[i] + (p[i + 2] - p[i]) * s / n, p[i + 1] + (p[i + 3] - p[i + 1]) * s / n, r); }
      }
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const i = ti + a, j = tj + b; if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue; for (const bi of this.bldTiles[j * this.nx + i]) mark(this.bx[bi], this.bz[bi], 13); }
      this.occ.set(t, o);
    }
    const ti = t % this.nx, tj = (t - ti) / this.nx;
    return o[Math.floor((z + this.land.hz - tj * 1000) / 8) * 125 + Math.floor((x + this.land.hx - ti * 1000) / 8)] === 1;
  }
  // direction of the nearest road within reach, or null
  roadDir(x, z, reach = 90) {
    const t = this.tile(x, z); if (t < 0) return null; let best = reach * reach, dir = null;
    for (const ri of this.roadTiles[t]) {
      const p = this.roads[ri].p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, l2 = dx * dx + dz * dz || 1, u = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), ex = ax + dx * u - x, ez = az + dz * u - z, d = ex * ex + ez * ez;
        if (d < best) { best = d; dir = Math.atan2(dz, dx); }
      }
    }
    return dir;
  }
}

// ---- roads and yards: a 2048 px picture of the 6 km around the drone ---------------------------------------------------
export class Mask {
  constructor(land, vec) {
    this.land = land; this.vec = vec; this.px = 2048; this.m = 3; this.size = this.px * this.m; this.cx = 1e9; this.cz = 1e9;
    const cv = this.cv = document.createElement('canvas'); cv.width = cv.height = this.px; this.ctx = cv.getContext('2d');
    const t = this.tex = new THREE.CanvasTexture(cv); t.flipY = false; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace;
    land.TU.uMask.value = t; this.stamp = new Int32Array(vec.roads.length); this.n = 0;
  }
  update(x, z) {
    if (Math.abs(x - this.cx) < 1100 && Math.abs(z - this.cz) < 1100) return;
    const { ctx, px, m, size, vec, land } = this; this.cx = Math.round(x / 256) * 256; this.cz = Math.round(z / 256) * 256;
    const x0 = this.cx - size / 2, z0 = this.cz - size / 2, id = ++this.n;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, px, px);
    ctx.setTransform(1 / m, 0, 0, 1 / m, -x0 / m, -z0 / m); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = ctx.lineJoin = 'round';
    const i0 = Math.max(0, Math.floor((x0 + land.hx) / 1000)), i1 = Math.min(vec.nx - 1, Math.floor((x0 + size + land.hx) / 1000)), j0 = Math.max(0, Math.floor((z0 + land.hz) / 1000)), j1 = Math.min(vec.nz - 1, Math.floor((z0 + size + land.hz) / 1000));
    const byK = [[], [], [], [], []];
    ctx.fillStyle = 'rgb(0,0,230)'; ctx.beginPath();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = j * vec.nx + i;
      for (const ri of vec.roadTiles[t]) if (this.stamp[ri] !== id) { this.stamp[ri] = id; byK[vec.roads[ri].k].push(vec.roads[ri].p); }
      for (const bi of vec.bldTiles[t]) { ctx.moveTo(vec.bx[bi] + 13, vec.bz[bi]); ctx.arc(vec.bx[bi], vec.bz[bi], 13, 0, 6.2832); }
    }
    ctx.fill();
    const path = (ps) => { ctx.beginPath(); for (const p of ps) { ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); } };
    ctx.setLineDash([]); ctx.strokeStyle = 'rgb(255,0,0)';
    byK.forEach((ps, k) => { if (!ps.length) return; ctx.lineWidth = Math.max(ROAD_W[k], 5.4); path(ps); ctx.stroke(); });
    ctx.strokeStyle = 'rgb(0,255,0)'; ctx.lineWidth = 3.2; ctx.setLineDash([9, 12]);
    for (let k = 0; k <= 2; k++) if (byK[k].length) { path(byK[k]); ctx.stroke(); }
    this.tex.needsUpdate = true; land.TU.uMaskWin.value.set(x0, z0, size, 1);
  }
}

// ---- trees -------------------------------------------------------------------------------------------------------------
const TREE_VERT = /* glsl */`
${COMMON}
uniform sampler2D uBake; uniform float uWind;
attribute vec3 aPos, aDown; attribute vec4 aTree;                  // aTree: height | crown width | 0 pine 1 broadleaf 2 snag | seed
varying vec3 vW, vN, vCol; varying float vSh, vCrown;
void main() {
  float H = aTree.x, Wd = aTree.y, type = aTree.z, seed = aTree.w, u = position.y, part = position.z, ang = position.x + seed * 6.2832;
  float dist = distance(aPos, cameraPosition), far = smoothstep(200., 400., dist);
  float alive = step(fract(seed * 7.31), mix(1., .34, far)) * (1. - smoothstep(540., 630., dist)) * step(.5, H);
  Wd *= mix(1., 1.55, far); H *= mix(1., 1.1, far);
  float r, y; vec3 nrm = vec3(cos(ang), .5, sin(ang)); vec3 col; float ao = 1.;
  bool snag = type > 1.5;
  if (part > .5) { r = H * .02 * (snag ? 1.25 - u * .8 : 1.); y = u * H * (snag ? 1. : .5); nrm.y = 0.; col = snag ? vec3(.022, .02, .019) : vec3(.06, .045, .032); ao = .7; }
  else if (snag) { r = 0.; y = H * .6; col = vec3(.02); }
  else if (type < .5) {                                              // pine: two tiers of boughs
    r = Wd * .5 * (u < .1 ? 1. : u < .3 ? .4 : u < .6 ? .74 : u < .9 ? .24 : 0.);
    y = H * (u < .1 ? .2 : u < .3 ? .52 : u < .6 ? .47 : u < .9 ? .8 : 1.);
    col = mix(vec3(.02, .055, .026), vec3(.04, .085, .03), fract(seed * 13.7)); ao = mix(.45, 1., u);
  } else {                                                           // broadleaf: a round crown
    r = Wd * .5 * (u < .1 ? .55 : u < .3 ? .96 : u < .6 ? 1. : u < .9 ? .66 : 0.);
    y = H * (u < .1 ? .27 : u < .3 ? .42 : u < .6 ? .63 : u < .9 ? .86 : 1.);
    nrm.y = (u - .4) * 2.2; col = mix(vec3(.04, .1, .022), vec3(.085, .14, .03), fract(seed * 13.7)); ao = mix(.4, 1., u);
  }
  float crownK = part > .5 || snag ? 0. : 1.;
  r *= 1. + crownK * (type < .5 ? .16 : .34) * (fract(sin(position.x * 9.7 + u * 31.3 + seed * 57.) * 43758.5) - .5) * step(u, .9);     // lumpy, no two alike
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r) * alive;
  float sway = (p.y / max(H, 1.)); p.xz += vec2(.8, .6) * sway * sway * (sin(uTime * 1.9 + seed * 40.) * .35 + .3) * uWind;
  vec2 fc = flowCell(aPos.xz); float mudK = 0.;
  if (fc.x > 0. && fc.y > .1) {                                       // the flow has it: over it goes, then downhill with the mud
    float age = fc.x, pr = clamp(age / (1. + fract(seed * 5.3) * .8), 0., 1.); pr = pr * pr * (3. - 2. * pr);
    float a = pr * (1.35 + fract(seed * 9.1) * .25), al = dot(p.xz, aDown.xy); vec2 perp = p.xz - aDown.xy * al;
    p.xz = perp + aDown.xy * (al * cos(a) + p.y * sin(a)); p.y = -al * sin(a) + p.y * cos(a);
    float run = smoothstep(.8, 2.2, age) * min(age, 9.) * (1.2 + 2.6 * fract(seed * 3.7));
    p *= 1. - .6 * smoothstep(2., 10., age); p.xz += aDown.xy * run; p.y -= run * aDown.z * .9 - .4 + smoothstep(3., 12., age) * 1.6;
    mudK = smoothstep(.3, 3., age);
  }
  vW = aPos + p; vN = normalize(nrm); vCol = mix(col * ao, vec3(.09, .065, .04), mudK * .85); vCrown = crownK * (1. - mudK);
  vSh = textureLod(uBake, (aPos.xz + uHalf) / (uHalf * 2.), 0.).r;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
const TREE_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDet;
varying vec3 vW, vN, vCol; varying float vSh, vCrown;
void main() {
  vec3 n = normalize(vN), v = cameraPosition - vW; float dist = length(v); v /= dist;
  float g = texture2D(uDet, vW.xz / 2.7 + vW.y * .13).a, g2 = texture2D(uDet, vW.xz / 11. + vW.y * .07).r, clump = texture2D(uDet, vW.xz / 3.3 + vW.y * .21).b;
  // close up the crown breaks into leaf clumps: ragged at the rim, dark between
  float nearK = vCrown * (1. - smoothstep(90., 240., dist));
  if (nearK * ((1. - abs(dot(n, v))) * 1.15 + (1. - clump) * .6) > 1.08) discard;
  vec3 col = lit(vCol * (.62 + .5 * g + .5 * g2) * mix(1., .5 + .85 * clump, nearK), n, mix(1., vSh, uShadowK), 1.);
  gl_FragColor = vec4(finish(applyFog(col, vW)), 1.);
}`;

export class Trees {
  constructor(land, vec) {
    this.land = land; this.vec = vec; this.CH = 64; this.PER = 64; this.R = 10; this.MAX = 440;
    const SEG = 6, pos = [], idx = [];
    for (let r = 0; r < 5; r++) for (let s = 0; s < SEG; s++) pos.push(s / SEG * 6.2832, r / 4, 0);
    for (let r = 0; r < 4; r++) for (let s = 0; s < SEG; s++) { const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, c = a + SEG, d = b + SEG; idx.push(a, c, b, b, c, d); }
    const t0 = pos.length / 3; for (let r = 0; r < 2; r++) for (let s = 0; s < 4; s++) pos.push(s / 4 * 6.2832, r, 1);
    for (let s = 0; s < 4; s++) { const a = t0 + s, b = t0 + (s + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const n = this.MAX * this.PER, at = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('aPos', this.aPos = at(3)); g.setAttribute('aTree', this.aTree = at(4)); g.setAttribute('aDown', this.aDown = at(3)); g.instanceCount = 0;
    this.uWind = { value: 1 };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...land.U, uBake: land.TU.uBake, uWind: this.uWind }, vertexShader: TREE_VERT, fragmentShader: TREE_FRAG }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    this.chunks = new Map(); this.free = Array.from({ length: this.MAX }, (_, i) => this.MAX - 1 - i); this.queue = []; this.ci = 1e9; this.cj = 1e9;
    this._n = new THREE.Vector3(); this._lc = [0, 0, 0, 0]; this.count = 0;
  }
  key(i, j) { return (j + 4096) * 8192 + i + 4096; }
  update(x, z, budget = 10) {
    const ci = Math.floor(x / this.CH), cj = Math.floor(z / this.CH), R = this.R;
    if (ci !== this.ci || cj !== this.cj) {
      this.ci = ci; this.cj = cj; this.queue.length = 0;
      for (const [k, c] of this.chunks) if (Math.hypot(c.i - ci, c.j - cj) > R + 1.5) { this.clear(c.slot); this.free.push(c.slot); this.chunks.delete(k); }
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= R * R && !this.chunks.has(this.key(ci + i, cj + j))) this.queue.push([i * i + j * j, ci + i, cj + j]);
      this.queue.sort((a, b) => b[0] - a[0]); this.free.sort((a, b) => b - a);
    }
    let grew = false; while (budget-- > 0 && this.queue.length && this.free.length) { const [, i, j] = this.queue.pop(); this.build(i, j, this.free.pop()); grew = true; }
    if (grew) { let top = -1; for (const c of this.chunks.values()) if (c.slot > top) top = c.slot; this.mesh.geometry.instanceCount = (top + 1) * this.PER; }
    return this.queue.length;
  }
  touch(slot) { const s = slot * this.PER; for (const [a, k] of [[this.aPos, 3], [this.aTree, 4], [this.aDown, 3]]) { a.addUpdateRange(s * k, this.PER * k); a.needsUpdate = true; } }
  clear(slot) { const t = this.aTree.array, s = slot * this.PER * 4; for (let i = 0; i < this.PER; i++) t[s + i * 4] = 0; this.touch(slot); }
  build(ci, cj, slot) {
    const { land, vec, PER, CH } = this, P = this.aPos.array, T = this.aTree.array, D = this.aDown.array, lc = this._lc, n = this._n, s0 = slot * PER;
    for (let k = 0; k < PER; k++) {
      const q = s0 + k, gi = k & 7, gj = k >> 3, x = ci * CH + (gi + .15 + .7 * hash(ci, cj, k * 4 + 1)) * 8, z = cj * CH + (gj + .15 + .7 * hash(ci, cj, k * 4 + 2)) * 8, r = hash(ci, cj, k * 4 + 3), r2 = hash(cj, ci, k * 4 + 5);
      T[q * 4] = 0;
      if (Math.abs(x) > land.hx - 100 || Math.abs(z) > land.hz - 100) continue;
      land.lcAt(x, z, lc);
      if (lc[2] > .3 || lc[3] > .45) continue;
      const open = Math.max(0, 1 - lc[0] - lc[1] - lc[2] - lc[3]);
      if (r > lc[0] * .97 + lc[1] * .55 + open * .035) continue;
      const y = land.hAt(x, z); if (y < 1.5) continue;
      land.normalAt(x, z, n, 4); if (n.y < .62 || vec.occupied(x, z)) continue;
      const burnt = lc[1] > .35 && r2 < lc[1], hl = Math.hypot(n.x, n.z) || 1;
      let type, H, Wd;
      if (burnt && hash(ci, cj, k * 4 + 7) < .62) { type = 2; H = 5 + r2 * 22 % 7; Wd = 1; }
      else if (burnt) { type = 1; H = 2.5 + 3 * r2; Wd = 2.5 + 2 * r2; }                               // a year of regrowth
      else if (hash(ci >> 2, cj >> 2, 11) * .6 + r2 * .4 + y / 2500 < .56) { type = 0; H = 10 + 8 * hash(ci, cj, k * 4 + 9); Wd = 5.2 + 2.6 * r2; }
      else { type = 1; H = 8.5 + 6 * hash(ci, cj, k * 4 + 9); Wd = 7 + 3.4 * r2; }
      P[q * 3] = x; P[q * 3 + 1] = y - .3; P[q * 3 + 2] = z; T[q * 4] = H; T[q * 4 + 1] = Wd; T[q * 4 + 2] = type; T[q * 4 + 3] = hash(ci, cj, k * 4 + 13);
      D[q * 3] = n.x / hl; D[q * 3 + 1] = n.z / hl; D[q * 3 + 2] = hl / n.y;
    }
    this.touch(slot); this.chunks.set(this.key(ci, cj), { i: ci, j: cj, slot });
  }
}

// ---- buildings ---------------------------------------------------------------------------------------------------------
const BLD_VERT = /* glsl */`
${COMMON}
uniform sampler2D uBake;
attribute vec3 aPos; attribute vec4 aDim, aLook; attribute vec2 aDown;   // aDim: length | wall height | depth | turn (rad)   aLook: roof colour | 0 house 1 shed 2 greenhouse 3 block
attribute float aPart;                                                   // 0 wall 1 roof
varying vec3 vW, vN, vRoof, vL; varying float vPart, vType, vSh, vHit;
void main() {
  float roofH = aLook.w > 2.5 ? .5 : (aLook.w > 1.5 ? aDim.z * .42 : aDim.z * .3);
  vec3 p = vec3(position.x * aDim.x, position.y < -.5 ? -3.5 : (position.y > 1.5 ? aDim.y + roofH : aDim.y - (aPart > .5 ? .25 : 0.)), position.z * aDim.z);
  vL = vec3(abs(normal.x) > .5 ? p.z : p.x, p.y, abs(normal.x) > .5 ? aDim.z : aDim.x);
  vec2 fc = flowCell(aPos.xz); float hit = 0.;
  float c = cos(aDim.w), s = sin(aDim.w); vec3 n = normal; if (aPart > .5) n = normalize(vec3(0., aDim.z * .5, sign(normal.z) * roofH));
  p.xz = vec2(p.x * c - p.z * s, p.x * s + p.z * c); n.xz = vec2(n.x * c - n.z * s, n.x * s + n.z * c);
  if (fc.x > 0. && fc.y > .28) {                                          // hit: the walls go, the roof rides the mud a little way
    hit = clamp(fc.x / 1.6, 0., 1.); hit = hit * hit * (3. - 2. * hit);
    float up = max(p.y, 0.); p.y = min(p.y, 0.) + up * (1. - .8 * hit);
    p.xz += aDown * (up * 1.1 * hit + hit * (3. + 4. * fract(aDim.w * 7.)) + smoothstep(1.6, 9., fc.x) * 5.);
    p.xz += vec2(sin(aDim.w * 31. + up), cos(aDim.w * 17. + up)) * hit * .8 * step(.01, up);
    n = normalize(mix(n, vec3(aDown.x, .6, aDown.y), hit * .6));
  }
  vW = aPos + p; vN = n; vRoof = aLook.rgb; vPart = aPart; vType = aLook.w; vHit = hit;
  vSh = textureLod(uBake, (aPos.xz + uHalf) / (uHalf * 2.), 0.).r;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
const BLD_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDet;
varying vec3 vW, vN, vRoof, vL; varying float vPart, vType, vSh, vHit;
void main() {
  vec3 n = normalize(vN), alb, glow = vec3(0.); float g = texture2D(uDet, vW.xz / 5. + vW.y * .2).r;
  bool glass = vType > 1.5 && vType < 2.5;
  if (vPart > .5) alb = glass ? vec3(.62, .66, .66) * (.8 + .2 * step(.5, fract(vL.x / 2.))) : vRoof * (.85 + .15 * step(.5, fract(vL.x * 1.6))) * (.8 + .4 * g);
  else if (glass) alb = vec3(.55, .58, .58);
  else {
    alb = (vType > .5 && vType < 1.5 ? vec3(.36, .38, .4) : mix(vec3(.5, .48, .44), vec3(.66, .64, .6), fract(vRoof.r * 91.))) * (.8 + .4 * g);
    float fl = vType > 2.5 ? 3.1 : 9.;                                    // storeys
    vec2 w = vec2(fract((vL.x + vL.z * .5) / 3.4), fract(vL.y / fl) * fl);
    float win = step(.28, w.x) * step(w.x, .72) * step(1.05, w.y) * step(w.y, 2.2) * step(0., vL.y) * step(abs(vL.x), vL.z * .5 - .5) * step(vType, .5 + 3. * step(2.5, vType));
    float id = fract(sin(floor((vL.x + vL.z * .5) / 3.4) * 12.9 + floor(vL.y / fl) * 7.1 + vRoof.g * 50.) * 43758.5);
    alb = mix(alb, vec3(.03, .04, .05), win); glow = vec3(1., .72, .38) * win * step(.62, id) * (.25 + .9 * uWet) * (1. - vHit);
  }
  alb = mix(alb, vec3(.12, .085, .055) * (.7 + .6 * g), vHit * .8 + (1. - vHit) * smoothstep(1.2, -.2, vL.y) * .35 * step(vPart, .5));
  vec3 col = lit(alb, n, mix(1., vSh, uShadowK), 1.) + glow;
  gl_FragColor = vec4(finish(applyFog(col, vW)), 1.);
}`;
const ROOFS = [[.03, .12, .4], [.5, .15, .04], [.07, .075, .085], [.05, .19, .1], [.28, .07, .05], [.3, .32, .34], [.03, .12, .4], [.5, .15, .04]];

export class Buildings {
  constructor(land, vec) {
    this.land = land; this.vec = vec; this.MAX = 5000; this.cx = 1e9; this.cz = 1e9; this.n = 0; this.ids = new Int32Array(this.MAX);
    const P = [], N = [], A = [], I = [];
    const quad = (v, n, part) => { const b = P.length / 3; for (const q of v) { P.push(...q); N.push(...n); A.push(part); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const h = .5, e = .56, lo = -1, hi = 1, top = 2;
    quad([[-h, lo, h], [h, lo, h], [h, hi, h], [-h, hi, h]], [0, 0, 1], 0); quad([[h, lo, -h], [-h, lo, -h], [-h, hi, -h], [h, hi, -h]], [0, 0, -1], 0);
    quad([[h, lo, h], [h, lo, -h], [h, hi, -h], [h, hi, h]], [1, 0, 0], 0); quad([[-h, lo, -h], [-h, lo, h], [-h, hi, h], [-h, hi, -h]], [-1, 0, 0], 0);
    quad([[-e, hi, e], [e, hi, e], [e, top, 0], [-e, top, 0]], [0, 0, 1], 1); quad([[e, hi, -e], [-e, hi, -e], [-e, top, 0], [e, top, 0]], [0, 0, -1], 1);
    let b = P.length / 3; P.push(h, hi, h, h, hi, -h, h, top, 0); N.push(1, 0, 0, 1, 0, 0, 1, 0, 0); A.push(0, 0, 0); I.push(b, b + 1, b + 2);
    b = P.length / 3; P.push(-h, hi, -h, -h, hi, h, -h, top, 0); N.push(-1, 0, 0, -1, 0, 0, -1, 0, 0); A.push(0, 0, 0); I.push(b, b + 1, b + 2);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1)); g.setIndex(I);
    const at = (name, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX * k), k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = at('aPos', 3); this.aDim = at('aDim', 4); this.aLook = at('aLook', 4); this.aDown = at('aDown', 2); g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...land.U, uBake: land.TU.uBake }, vertexShader: BLD_VERT, fragmentShader: BLD_FRAG, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this._n = new THREE.Vector3();
  }
  update(x, z) {
    if (Math.abs(x - this.cx) < 500 && Math.abs(z - this.cz) < 500) return;
    this.cx = x; this.cz = z;
    const { land, vec } = this, R = 3600, n3 = this._n, P = this.aPos.array, D = this.aDim.array, L = this.aLook.array, W = this.aDown.array; let n = 0;
    const i0 = Math.max(0, Math.floor((x - R + land.hx) / 1000)), i1 = Math.min(vec.nx - 1, Math.floor((x + R + land.hx) / 1000)), j0 = Math.max(0, Math.floor((z - R + land.hz) / 1000)), j1 = Math.min(vec.nz - 1, Math.floor((z + R + land.hz) / 1000));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = vec.bldTiles[j * vec.nx + i], town = list.length > 120;
      for (const bi of list) {
        if (n >= this.MAX) break;
        const bx = vec.bx[bi], bz = vec.bz[bi]; if ((bx - x) ** 2 + (bz - z) ** 2 > R * R) continue;
        const y = land.hAt(bx, bz); land.normalAt(bx, bz, n3, 6);
        const r = hash(bi, 7, 1), r2 = hash(bi, 7, 2), r3 = hash(bi, 7, 3), flat = n3.y > .992, hl = Math.hypot(n3.x, n3.z) || 1;
        let type = 0, len = 9 + 5 * r2, dep = 6.5 + 2 * r3, wall = 3.1 + .5 * r3;
        if (town && r < .45) { type = 3; len = 12 + 14 * r2; dep = 10 + 6 * r3; wall = 6.2 + 3.1 * Math.floor(r3 * 3); }
        else if (flat && !town && r > .86) { type = 2; len = 28 + 30 * r2; dep = 6.5; wall = 1.1; }
        else if (r > .7 && r <= .86) { type = 1; len = 13 + 8 * r2; dep = 8 + 3 * r3; wall = 4.4; }
        const rd = vec.roadDir(bx, bz), rot = rd === null ? r3 * 6.2832 : rd + (hash(bi, 7, 4) < .25 ? 1.5708 : 0), col = type === 1 ? ROOFS[5] : type === 3 ? ROOFS[2] : ROOFS[Math.floor(hash(bi, 7, 5) * 8)];
        P[n * 3] = bx; P[n * 3 + 1] = y - Math.min(1.5, hl / n3.y * dep * .4); P[n * 3 + 2] = bz;
        D[n * 4] = len; D[n * 4 + 1] = wall; D[n * 4 + 2] = dep; D[n * 4 + 3] = rot;
        L[n * 4] = col[0]; L[n * 4 + 1] = col[1]; L[n * 4 + 2] = col[2]; L[n * 4 + 3] = type;
        W[n * 2] = n3.x / hl; W[n * 2 + 1] = n3.z / hl; this.ids[n] = bi; n++;
      }
    }
    this.n = this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aDim, this.aLook, this.aDown]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}
