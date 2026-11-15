// Drone mode: the landslides. Nothing here is drawn by hand: every slide is one of the 4,351 debris flows the pipeline
// simulated (p11: shallow-water flow with Voellmy friction, a 40 x 40 m slab let go on each flagged slope). The file gives,
// per 10 m cell, when the flow gets there and how deep it runs. A flow that is set off is written into a float texture
// around the drone; the ground, the trees and the buildings all read that texture, so mud, toppling and collapse stay in
// step. The CPU only follows the front to throw rocks, dust and splinters, and to count what was hit.
import * as THREE from 'three';
import { COMMON } from './land.js';

const SPEED = 1;                                     // playback: real time, as the solver ran it
const SZ = 512;                                      // the flow texture: 512 cells of 10 m around the drone
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const ROCK_VERT = /* glsl */`
${COMMON}
attribute vec3 aP0, aV0, aSz, aCol; attribute vec4 aT;                 // aT: born | lands after | gone after | seed
varying vec3 vW, vN, vCol;
vec3 rot(vec3 p, vec3 ax, float a) { return p * cos(a) + cross(ax, p) * sin(a) + ax * dot(ax, p) * (1. - cos(a)); }
void main() {
  float age = uTime - aT.x, tl = clamp(age, 0., aT.y);
  vec3 c = aP0 + aV0 * tl - vec3(0., 4.9, 0.) * tl * tl;
  float sc = step(0., age) * (1. - smoothstep(mix(aT.y, aT.z, .45), aT.z, age));
  vec3 ax = normalize(vec3(sin(aT.w * 37.), cos(aT.w * 91.), sin(aT.w * 53.) + .01)); float an = tl * (2.5 + 7. * fract(aT.w * 7.));
  vW = c + rot(position * aSz, ax, an) * sc; vN = rot(normalize(normal / aSz), ax, an); vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
const ROCK_FRAG = /* glsl */`
${COMMON}
varying vec3 vW, vN, vCol;
void main() { gl_FragColor = vec4(finish(applyFog(lit(vCol, normalize(vN), 1., .9), vW)), 1.); }`;

const DUST_VERT = /* glsl */`
${COMMON}
attribute vec3 aP0, aV0; attribute vec4 aT, aCol;                      // aT: born | life | size at birth | size at the end
varying vec2 vUv; varying vec4 vCol; varying vec3 vW; varying float vSeed;
void main() {
  float age = uTime - aT.x, k = clamp(age / aT.y, 0., 1.);
  vec3 c = aP0 + aV0 * (1. - exp(-age * 1.1)) / 1.1 + vec3(0., .5 * age * aCol.a, 0.);
  float size = mix(aT.z, aT.w, 1. - (1. - k) * (1. - k)), d = distance(c, cameraPosition);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float alive = step(0., age) * step(age, aT.y);
  vW = c + (right * position.x + up * position.y) * size * alive; vUv = position.xy; vSeed = fract(aT.x * 13.7);
  vCol = vec4(aCol.rgb, aCol.a * smoothstep(0., .1, k) * pow(1. - k, 1.4) * smoothstep(2., 9., d) * alive);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
const DUST_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDet;
varying vec2 vUv; varying vec4 vCol; varying vec3 vW; varying float vSeed;
void main() {
  float r = length(vUv); if (r > 1.) discard;
  float n = texture2D(uDet, vUv * .21 + vSeed).r, a = vCol.a * smoothstep(1., .25, r + (n - .5) * .7);
  vec3 col = vCol.rgb * (mix(uGndCol, uSkyCol, .7) + uSunCol * (.22 + .2 * vUv.y) + uFlash) * (.7 + .6 * n);
  gl_FragColor = vec4(finish(applyFog(col, vW)), a);
}`;

const BEAM_VERT = /* glsl */`
${COMMON}
attribute vec4 aPos;                                                    // xyz | 1 = the one F would set off
varying vec2 vUv; varying float vSel; varying vec3 vW;
void main() {
  vec3 to = cameraPosition - aPos.xyz; float d = length(to);
  vec3 right = normalize(cross(vec3(0., 1., 0.), to));
  float w = max(.9, d * .0016) * (1. + aPos.w * 1.2), h = 70. + d * .03;
  vW = aPos.xyz + right * position.x * w + vec3(0., position.y * h, 0.); vUv = position.xy; vSel = aPos.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
const BEAM_FRAG = /* glsl */`
${COMMON}
varying vec2 vUv; varying float vSel; varying vec3 vW;
void main() {
  float a = (1. - abs(vUv.x)) * pow(1. - vUv.y, 1.6) * (.38 + .5 * vSel) * (.75 + .25 * sin(uTime * 4. - vUv.y * 9.));
  float d = distance(vW, cameraPosition); a *= smoothstep(15., 60., d) * (1. - smoothstep(2200., 3000., d));
  gl_FragColor = vec4(mix(vec3(1., .62, .1), vec3(1., .3, .12), vSel) * 1.4, a);
}`;

class Pool {                                           // a ring of instances whose motion is worked out in the shader
  constructor(geo, n, attrs, mat) {
    this.n = n; this.i = 0; this.a = {};
    const g = this.geo = new THREE.InstancedBufferGeometry(); g.index = geo.index; for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    for (const [name, k] of attrs) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); this.a[name] = a; }
    this.a.aT.array.fill(-1e6); g.instanceCount = n;
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
  }
  next() { const i = this.i; this.i = (i + 1) % this.n; this.dirty = true; return i; }
  flush() { if (this.dirty) { for (const k in this.a) this.a[k].needsUpdate = true; this.dirty = false; } }
}

export class Slides {
  constructor(land, vec, trees, bytes, scene) {
    this.land = land; this.vec = vec; this.trees = trees;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 4), nf = this.nf = dv.getUint32(0, true), cut = (o, n, T) => new T(bytes.buffer.slice(bytes.byteOffset + o, bytes.byteOffset + o + n * T.BYTES_PER_ELEMENT));
    const count = cut(4 + 4 * nf, nf, Uint32Array), off = this.off = new Uint32Array(nf + 1); for (let i = 0; i < nf; i++) off[i + 1] = off[i] + count[i];
    const m = off[nf], o = 4 + 8 * nf; this.col = cut(o, m, Uint16Array); this.row = cut(o + 2 * m, m, Uint16Array);
    this.t = bytes.subarray(o + 4 * m, o + 5 * m); this.d = bytes.subarray(o + 5 * m, o + 6 * m);
    this.NC = Math.round(land.W / 10);

    // every flow: where it lets go, how far it reaches, what stands in its way
    const bcell = new Map(); for (let b = 0; b < vec.nb; b++) { const k = Math.floor((vec.bz[b] + land.hz) / 10) * this.NC + Math.floor((vec.bx[b] + land.hx) / 10); (bcell.get(k) || bcell.set(k, []).get(k)).push(b); }
    this.bcell = bcell;
    this.rx = new Float32Array(nf); this.rz = new Float32Array(nf); this.ry = new Float32Array(nf); this.cx = new Float32Array(nf); this.cz = new Float32Array(nf);
    this.nb = new Uint16Array(nf); this.len = new Float32Array(nf); this.fired = new Float64Array(nf).fill(-1);
    this.tiles = Array.from({ length: vec.nx * vec.nz }, () => []);
    for (let f = 0; f < nf; f++) {
      let sx = 0, sz = 0, rx = 0, rz = 0, rn = 0, far = 0, nb = 0; const a = off[f], b = off[f + 1];
      for (let q = a; q < b; q++) { sx += this.col[q]; sz += this.row[q]; if (this.t[q] <= 2) { rx += this.col[q]; rz += this.row[q]; rn++; } }
      rx = rn ? rx / rn : this.col[a]; rz = rn ? rz / rn : this.row[a];
      for (let q = a; q < b; q++) { far = Math.max(far, Math.hypot(this.col[q] - rx, this.row[q] - rz)); if (this.d[q] >= 14) { const l = bcell.get(this.row[q] * this.NC + this.col[q]); if (l) nb += l.length; } }
      this.rx[f] = (rx + .5) * 10 - land.hx; this.rz[f] = (rz + .5) * 10 - land.hz; this.cx[f] = (sx / (b - a) + .5) * 10 - land.hx; this.cz[f] = (sz / (b - a) + .5) * 10 - land.hz;
      this.len[f] = far * 10; this.nb[f] = nb; const t = vec.tile(this.rx[f], this.rz[f]); if (t >= 0) this.tiles[t].push(f);
    }
    // places worth flying to: flows that reach buildings and have many other flagged slopes around them, kept apart
    const cand = Array.from({ length: nf }, (_, i) => i).sort((a, b) => this.nb[b] - this.nb[a] || this.len[b] - this.len[a]).slice(0, 160);
    const score = new Map(cand.map((f) => [f, (1 + Math.min(this.nb[f], 6)) * (4 + Math.min(this.around(this.rx[f], this.rz[f], 1500).length, 40))]));
    this.hot = [];
    for (const f of cand.sort((a, b) => score.get(b) - score.get(a))) {
      if (this.hot.length >= 14) break;
      if (this.hot.every((h) => Math.hypot(this.rx[h] - this.rx[f], this.rz[h] - this.rz[f]) > 2500)) this.hot.push(f);
    }

    this.data = new Float32Array(SZ * SZ * 4); this.c0 = 1e9; this.r0 = 1e9;
    const tx = this.tex = new THREE.DataTexture(this.data, SZ, SZ, THREE.RGBAFormat, THREE.FloatType); tx.needsUpdate = true; land.U.uFlow.value = tx;
    this.active = []; this.events = []; this.log = []; this.hits = 0; this.count = 0; this.shake = 0; this.rumble = 0; this.target = -1; this.near = [];
    this.onHit = null; this.onCrack = null;

    const U = land.U;
    this.rocks = new Pool(new THREE.IcosahedronGeometry(1, 0), 3600, [['aP0', 3], ['aV0', 3], ['aSz', 3], ['aCol', 3], ['aT', 4]], new THREE.ShaderMaterial({ uniforms: U, vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG }));
    const quad = new THREE.BufferGeometry(); quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.dust = new Pool(quad, 2600, [['aP0', 3], ['aV0', 3], ['aT', 4], ['aCol', 4]], new THREE.ShaderMaterial({ uniforms: U, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false }));
    this.dust.mesh.renderOrder = 50;
    const beam = new THREE.BufferGeometry(); beam.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3)); beam.setIndex([0, 1, 2, 0, 2, 3]);
    const bg = this.beamGeo = new THREE.InstancedBufferGeometry(); bg.index = beam.index; bg.setAttribute('position', beam.attributes.position);
    this.aBeam = new THREE.InstancedBufferAttribute(new Float32Array(320 * 4), 4); this.aBeam.setUsage(THREE.DynamicDrawUsage); bg.setAttribute('aPos', this.aBeam); bg.instanceCount = 0;
    this.beams = new THREE.Mesh(bg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beams.frustumCulled = false; this.beams.renderOrder = 60;
    scene.add(this.rocks.mesh, this.dust.mesh, this.beams);
    this._n = new THREE.Vector3(); this._v = new THREE.Vector3(); this.bx = 1e9; this.bz = 1e9;
  }

  // ---- the flow texture --------------------------------------------------------------------------------------------------
  write(f, t0) {
    const { data, c0, r0, col, row, t, d } = this; let any = false;
    for (let q = this.off[f]; q < this.off[f + 1]; q++) {
      const i = col[q] - c0, j = row[q] - r0; if (i < 0 || j < 0 || i >= SZ || j >= SZ) continue;
      const p = (j * SZ + i) * 4, arr = t0 + t[q] * .5 / SPEED; any = true;
      if (arr < data[p]) data[p] = arr; data[p + 1] = Math.max(data[p + 1], d[q] * .02); data[p + 2] = Math.max(data[p + 2], 1 - t[q] / 6);
    }
    if (any) this.tex.needsUpdate = true;
  }
  recentre(x, z) {
    const cc = Math.floor((x + this.land.hx) / 10), cr = Math.floor((z + this.land.hz) / 10);
    if (Math.abs(cc - this.c0 - SZ / 2) < 110 && Math.abs(cr - this.r0 - SZ / 2) < 110) return;
    this.c0 = Math.round(cc / 32) * 32 - SZ / 2; this.r0 = Math.round(cr / 32) * 32 - SZ / 2;
    const dd = this.data; for (let p = 0; p < dd.length; p += 4) { dd[p] = 1e9; dd[p + 1] = 0; dd[p + 2] = 0; }
    this.land.U.uFlowWin.value.set(this.c0 * 10 - this.land.hx, this.r0 * 10 - this.land.hz, SZ, 10);
    for (const [f, t0] of this.log) this.write(f, t0);
    this.tex.needsUpdate = true;
  }
  // seconds since the flow reached this point (negative: it has not), and how deep it ran
  at(x, z, now) {
    const i = Math.floor((x + this.land.hx) / 10) - this.c0, j = Math.floor((z + this.land.hz) / 10) - this.r0; if (i < 0 || j < 0 || i >= SZ || j >= SZ) return null;
    const p = (j * SZ + i) * 4; return this.data[p] > 1e8 ? null : [now - this.data[p], this.data[p + 1]];
  }

  // ---- setting one off ---------------------------------------------------------------------------------------------------
  fire(f, now) {
    if (f < 0 || this.fired[f] >= 0) return false;
    this.fired[f] = now; this.count++; this.log.push([f, now]); if (this.log.length > 90) this.log.shift();
    this.write(f, now);
    const a = this.off[f], n = this.off[f + 1] - a, order = Uint32Array.from({ length: n }, (_, i) => a + i).sort((p, q) => this.t[p] - this.t[q]);
    this.active.push({ f, t0: now, order, ptr: 0, n, x: this.cx[f], z: this.cz[f], end: now + this.t[order[n - 1]] * .5 / SPEED + 8 });
    for (const q of order) {                                    // what the flow will hit, and when
      if (this.d[q] < 14) continue; const l = this.bcell.get(this.row[q] * this.NC + this.col[q]);
      if (l) for (const b of l) this.events.push({ t: now + this.t[q] * .5 / SPEED, b });
    }
    // trees in its path snap: a few of them get splinters and a crack
    const T = this.trees, x0 = this.cx[f] - this.len[f] - 80, x1 = this.cx[f] + this.len[f] + 80, z0 = this.cz[f] - this.len[f] - 80, z1 = this.cz[f] + this.len[f] + 80; let nt = 0;
    for (const c of T.chunks.values()) {
      if ((c.i + 1) * T.CH < x0 || c.i * T.CH > x1 || (c.j + 1) * T.CH < z0 || c.j * T.CH > z1) continue;
      for (let k = 0; k < T.PER && nt < 70; k++) {
        const s = c.slot * T.PER + k; if (T.aTree.array[s * 4] < 1 || (s * 7919) % 3) continue;
        const r = this.at(T.aPos.array[s * 3], T.aPos.array[s * 3 + 2], 0); if (!r || r[1] < .1) continue;
        this.events.push({ t: -r[0], tree: [T.aPos.array[s * 3], T.aPos.array[s * 3 + 1], T.aPos.array[s * 3 + 2], T.aTree.array[s * 4]] }); nt++;
      }
    }
    this.events.sort((p, q) => p.t - q.t); this.bx = 1e9;
    return true;
  }
  // unfired slopes near a point, nearest first
  around(x, z, R) {
    const { vec, land } = this, out = [], i0 = Math.max(0, Math.floor((x - R + land.hx) / 1000)), i1 = Math.min(vec.nx - 1, Math.floor((x + R + land.hx) / 1000)), j0 = Math.max(0, Math.floor((z - R + land.hz) / 1000)), j1 = Math.min(vec.nz - 1, Math.floor((z + R + land.hz) / 1000));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const f of this.tiles[j * vec.nx + i]) { const d = Math.hypot(this.rx[f] - x, this.rz[f] - z); if (this.fired[f] < 0 && d < R) out.push([d, f]); }
    return out.sort((a, b) => a[0] - b[0]);
  }

  // ---- particles ---------------------------------------------------------------------------------------------------------
  rock(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, now, hold = 3) {
    const land = this.land; let tl = 5;
    for (let t = .12; t < 5; t += .12) if (y + vy * t - 4.9 * t * t <= land.hAt(x + vx * t, z + vz * t) + .15) { tl = t; break; }
    const P = this.rocks, i = P.next(), a = P.a;
    a.aP0.array.set([x, y, z], i * 3); a.aV0.array.set([vx, vy, vz], i * 3); a.aSz.array.set([sx, sy, sz], i * 3); a.aCol.array.set([r, g, b], i * 3); a.aT.array.set([now, tl, tl + hold, Math.random()], i * 4);
  }
  puff(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, now) {
    const P = this.dust, i = P.next(), a = P.a;
    a.aP0.array.set([x, y, z], i * 3); a.aV0.array.set([vx, vy, vz], i * 3); a.aT.array.set([now, life, s0, s1], i * 4); a.aCol.array.set([r, g, b, alpha], i * 4);
  }
  // the front has just reached this cell
  burst(q, now, lod) {
    const land = this.land, n = this._n, R = Math.random, x = (this.col[q] + R()) * 10 - land.hx, z = (this.row[q] + R()) * 10 - land.hz, y = land.hAt(x, z), dep = this.d[q] * .02;
    land.normalAt(x, z, n, 5); const hl = Math.hypot(n.x, n.z) || 1, dx = n.x / hl, dz = n.z / hl, sp = 4 + 9 * Math.min(1, hl / n.y);
    if (R() < .75 * lod) { const c = .75 + R() * .3; this.puff(x, y + 1, z, dx * sp * .5 + (R() - .5) * 2, 1.2 + R() * 2, dz * sp * .5 + (R() - .5) * 2, 3 + R() * 4, 2.5 + dep * 2, 8 + R() * 8 + dep * 5, .3 * c, .235 * c, .165 * c, .2 + .2 * R(), now); }
    const k = (dep > .5 ? 2 : 1) * lod;
    for (let i = 0; i < k; i++) if (R() < .8) {
      const s = .25 + R() * R() * 1.5, g = .12 + R() * .16, mud = R() < .5;
      this.rock(x + (R() - .5) * 6, y + .4 + R(), z + (R() - .5) * 6, dx * sp * (.5 + R()) + (R() - .5) * 3, 2 + R() * 6, dz * sp * (.5 + R()) + (R() - .5) * 3, s, s * (.5 + R() * .5), s * (.6 + R() * .5), mud ? .2 : g, mud ? .14 : g * .97, mud ? .085 : g * .92, now, 2 + R() * 4);
    }
  }
  wreck(b, now) {                                              // a building goes
    const { land, vec } = this, R = Math.random, x = vec.bx[b], z = vec.bz[b], y = land.hAt(x, z), n = land.normalAt(x, z, this._n, 6), hl = Math.hypot(n.x, n.z) || 1, dx = n.x / hl, dz = n.z / hl;
    for (let i = 0; i < 22; i++) {
      const roof = i % 3 === 0, c = roof ? [.1, .18, .4] : [.5, .48, .44], k = .6 + R() * .5;
      this.rock(x + (R() - .5) * 8, y + 1 + R() * 3, z + (R() - .5) * 8, dx * (3 + R() * 7) + (R() - .5) * 9, 4 + R() * 9, dz * (3 + R() * 7) + (R() - .5) * 9, .5 + R() * 1.6, .06 + R() * .1, .25 + R() * .5, c[0] * k, c[1] * k, c[2] * k, now, 3 + R() * 4);
    }
    for (let i = 0; i < 7; i++) { const c = .8 + R() * .25; this.puff(x + (R() - .5) * 8, y + 2 + R() * 3, z + (R() - .5) * 8, dx * 3 + (R() - .5) * 5, 2 + R() * 4, dz * 3 + (R() - .5) * 5, 5 + R() * 5, 4, 16 + R() * 12, .44 * c, .4 * c, .35 * c, .5, now); }
  }
  snap(x, y, z, H, now) {
    const R = Math.random;
    for (let i = 0; i < 4; i++) this.rock(x + (R() - .5) * 2, y + H * (.2 + R() * .5), z + (R() - .5) * 2, (R() - .5) * 8, 3 + R() * 6, (R() - .5) * 8, .7 + R() * 1.4, .07, .1, .13, .09, .05, now, 2 + R() * 2);
    this.puff(x, y + H * .5, z, (R() - .5) * 3, 2, (R() - .5) * 3, 3 + R() * 2, 3, 9 + R() * 5, .12, .2, .08, .55, now);
  }

  // ---- every frame -------------------------------------------------------------------------------------------------------
  update(now, cam, dir) {
    this.recentre(cam.x, cam.z);
    let shake = 0, rumble = 0;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const A = this.active[k], dist = Math.hypot(A.x - cam.x, A.z - cam.z, this.land.hAt(A.x, A.z) - cam.y), lod = dist < 700 ? 1 : dist < 1800 ? .4 : .08;
      let made = 0;
      while (A.ptr < A.n && now >= A.t0 + this.t[A.order[A.ptr]] * .5 / SPEED) { if (made++ < 40) this.burst(A.order[A.ptr], now, lod); A.ptr++; }
      // the body of the flow keeps churning behind the front
      const lo = Math.max(0, A.ptr - 60), churn = A.ptr < A.n ? 3 : now < A.end - 5 ? 1 : 0;
      for (let i = 0; i < churn && A.ptr > lo; i++) if (Math.random() < lod) this.burst(A.order[lo + Math.floor(Math.random() * (A.ptr - lo))], now, lod * .6);
      const act = Math.exp(-(now - A.t0) / 26) * clamp((now - A.t0) / 1.5, 0, 1), w = act / (1 + (dist / 140) ** 2);
      shake += w; rumble += act / (1 + (dist / 420) ** 2);
      if (now > A.end) this.active.splice(k, 1);
    }
    while (this.events.length && this.events[0].t <= now) {
      const e = this.events.shift(), d2 = e.tree ? (e.tree[0] - cam.x) ** 2 + (e.tree[2] - cam.z) ** 2 : (this.vec.bx[e.b] - cam.x) ** 2 + (this.vec.bz[e.b] - cam.z) ** 2;
      if (e.tree) { if (d2 < 9e5) this.snap(...e.tree, now); this.onCrack?.(Math.sqrt(d2)); }
      else { this.hits++; this.wreck(e.b, now); this.onHit?.(e.b, Math.sqrt(d2)); shake += 1.5 / (1 + d2 / 3e4); }
    }
    this.shake = Math.min(1.6, shake); this.rumble = Math.min(1, rumble);
    this.rocks.flush(); this.dust.flush();

    // the slopes that could go, as beams of light; the one nearest the crosshair is the one F sets off
    if (Math.abs(cam.x - this.bx) > 250 || Math.abs(cam.z - this.bz) > 250) {
      this.bx = cam.x; this.bz = cam.z; this.near = this.around(cam.x, cam.z, 2800).slice(0, 320);
      const a = this.aBeam.array; this.near.forEach(([, f], i) => { if (!this.ry[f]) this.ry[f] = this.land.hAt(this.rx[f], this.rz[f]); a[i * 4] = this.rx[f]; a[i * 4 + 1] = this.ry[f]; a[i * 4 + 2] = this.rz[f]; a[i * 4 + 3] = 0; });
      this.beamGeo.instanceCount = this.near.length; this.aBeam.needsUpdate = true; this.sel = -1;
    }
    let best = -1, bs = 1e9; const v = this._v;
    this.near.forEach(([, f], i) => {
      v.set(this.rx[f] - cam.x, this.ry[f] - cam.y, this.rz[f] - cam.z); const d = v.length(), ang = Math.acos(clamp(v.dot(dir) / (d || 1), -1, 1));
      if (d > 1300 || this.fired[f] >= 0) return;                        // only slopes close enough to watch come down
      const s = d * (ang < .6 ? .35 + ang : 2.5 + ang); if (s < bs) { bs = s; best = i; }   // in view first, then simply the nearest
    });
    if (best !== this.sel) { const a = this.aBeam.array; if (this.sel >= 0 && this.sel < this.near.length) a[this.sel * 4 + 3] = 0; if (best >= 0) a[best * 4 + 3] = 1; this.sel = best; this.aBeam.needsUpdate = true; }
    this.target = best >= 0 ? this.near[best][1] : -1;
  }
}
