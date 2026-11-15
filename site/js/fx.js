import * as THREE from 'three';
import { TRACK_COLORS } from './terrain.js?v=24';

const az2dir = (deg) => new THREE.Vector2(Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180));   // (x east, z south)
// Flight headings measured from the look vectors in the NISAR files (left-looking radar).
const HEADING = { '125': 345, '024': 345, '032': 199 };

// ---- NISAR: a small satellite that sweeps a radar fan across the terrain -------------
export class Satellite {
  constructor(track, index, terrain) {
    this.track = track; this.i = index; this.u = terrain.uniforms; this.active = false; this.t = 0; this.dur = 3.2;
    this.dir = az2dir(HEADING[track]);
    this.perp = new THREE.Vector2(-this.dir.y, this.dir.x);
    const toSensor = az2dir(HEADING[track] - 90 + 180);                       // radar looks left, so the sensor sits to the right of the swath
    this.off = new THREE.Vector3(toSensor.x * 46, 44, toSensor.y * 46);
    this.u.uScanD.value[index].copy(this.dir);
    const col = new THREE.Color().setStyle(TRACK_COLORS[index]);
    this.group = new THREE.Group(); this.group.visible = false;

    // satellite body
    const gold = new THREE.MeshBasicMaterial({ color: 0xd8a84a }), dark = new THREE.MeshBasicMaterial({ color: 0x1c2f55 });
    const sat = new THREE.Group();
    sat.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.8), gold));
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 1.3), dark); p1.position.x = 2.5; sat.add(p1);
    const p2 = p1.clone(); p2.position.x = -2.5; sat.add(p2);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2), gold); boom.position.set(0, 1.9, -1.4); boom.rotation.x = 0.6; sat.add(boom);
    const dish = new THREE.Mesh(new THREE.CircleGeometry(2.6, 36), new THREE.MeshBasicMaterial({ color: 0xf2d28a, wireframe: true, transparent: true, opacity: 0.7 }));
    dish.position.set(0, 3.6, -2.6); dish.rotation.x = -0.9; sat.add(dish);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTex() }));
    halo.scale.setScalar(9); sat.add(halo);
    this.sat = sat; this.group.add(sat);

    // radar fan: apex at the satellite, base along the scan line on the ground
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array([1, 0, 0]), 1));
    g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array([0.5, 0, 1]), 1));
    this.fanU = { uC: { value: col }, uT: { value: 0 }, uI: { value: 1 } };
    this.fan = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.fanU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aA, aS; varying float vA, vS; void main(){ vA = aA; vS = aS; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uC; uniform float uT, uI; varying float vA, vS;
        void main(){ float rays = 0.55 + 0.45 * sin(vS * 240.0 + uT * 9.0) * sin(vS * 61.0 - uT * 4.0);
          float pulse = 0.6 + 0.4 * fract(vA * 6.0 - uT * 2.5);
          gl_FragColor = vec4(uC * (0.05 + 0.2 * (1.0 - vA)) * rays * pulse * uI, 1.0); }`,
    }));
    this.fan.frustumCulled = false; this.group.add(this.fan);
  }
  fire(dur = 3.2) { this.active = true; this.t = 0; this.dur = dur; this.group.visible = true; }
  update(dt, time) {
    if (!this.active) return;
    this.t += dt;
    const f = this.t / this.dur, L = 78, P = -L + 2 * L * f, I = Math.sin(Math.min(Math.max(f, 0), 1) * Math.PI) ** 0.5;
    this.u.uScanP.value[this.i] = P; this.u.uScanI.value[this.i] = f >= 1 ? 0 : I;
    const c = new THREE.Vector3(this.dir.x * P, 0.4, this.dir.y * P);
    this.sat.position.copy(c).add(this.off);
    this.sat.lookAt(this.sat.position.x + this.dir.x, this.sat.position.y, this.sat.position.z + this.dir.y);
    const pos = this.fan.geometry.attributes.position, W = 74;
    pos.setXYZ(0, this.sat.position.x, this.sat.position.y, this.sat.position.z);
    pos.setXYZ(1, c.x - this.perp.x * W, 0.6, c.z - this.perp.y * W);
    pos.setXYZ(2, c.x + this.perp.x * W, 0.6, c.z + this.perp.y * W);
    pos.needsUpdate = true;
    this.fanU.uT.value = time; this.fanU.uI.value = I;
    if (f >= 1) { this.active = false; this.group.visible = false; this.u.uScanI.value[this.i] = 0; }
  }
}

let _glow;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}

// ---- rain ---------------------------------------------------------------------------
export class Rain {
  constructor(D) {
    const N = 9000, seed = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      seed.set([a, b, c, a, b, c], i * 6); end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const r = D.rain;
    this.grid = new Uint8Array(r.rows * r.cols);
    this.tex = new THREE.DataTexture(this.grid, r.cols, r.rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter; this.tex.unpackAlignment = 1; this.tex.needsUpdate = true;
    this.D = D; this.day = -1;
    this.u = { uT: { value: 0 }, uI: { value: 0 }, tRain: { value: this.tex }, uBox: { value: new THREE.Vector2(D.Ws, D.Hs) },
      uG0: { value: new THREE.Vector2(r.x0 / D.Wkm, r.z0 / D.Hkm) }, uG1: { value: new THREE.Vector2(r.x1 / D.Wkm, r.z1 / D.Hkm) } };
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform float uT, uI; uniform vec2 uBox, uG0, uG1; uniform sampler2D tRain; varying float vA;
        void main(){ float top = 9.0; float y = top - mod(aSeed.y * top + uT * (9.0 + aSeed.x * 5.0), top);
          vec2 uv = aSeed.xz; vec3 p = vec3((uv.x - 0.5) * uBox.x, y + aEnd * 0.55, (uv.y - 0.5) * uBox.y);
          p.x += (y + aEnd * 0.55) * 0.12;
          float loc = texture2D(tRain, (uv - uG0) / (uG1 - uG0)).r;
          vA = uI * smoothstep(0.02, 0.5, loc) * (0.25 + 0.75 * aEnd) * step(aSeed.z * 0.0 + fract(aSeed.x * 91.7), 0.25 + loc * 1.5);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55, 0.72, 1.0) * vA * 0.5, 1.0); }`,
    }));
    this.mesh.frustumCulled = false;
  }
  setDay(day) {
    const r = this.D.rain, d = Math.max(0, Math.min(r.dates.length - 1, Math.round(day)));
    if (d !== this.day) { this.day = d; const row = r.grid[d]; for (let i = 0; i < row.length; i++) this.grid[i] = Math.min(255, row[i] / 110 * 255); this.tex.needsUpdate = true; }
    this.target = Math.min(1, r.mean[d] / 35);
  }
  update(dt, t) { this.u.uT.value = t; this.u.uI.value += ((this.target || 0) - this.u.uI.value) * Math.min(1, dt * 3); this.mesh.visible = this.u.uI.value > 0.01; }
}

// ---- cloud deck: stands for "no clear optical image", not literal weather --------------
export class Clouds {
  constructor(D) {
    const R = D.region;                                   // nationwide: the cloud deck sits over the storm area only
    const g = R ? new THREE.PlaneGeometry(R.w * 1.5, R.h * 1.5) : new THREE.PlaneGeometry(D.Ws * 1.25, D.Hs * 1.25); g.rotateX(-Math.PI / 2);
    this.u = { uT: { value: 0 }, uA: { value: 0 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT, uA; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
        void main(){ vec2 p = vUv * vec2(7.0, 5.0) + vec2(uT * 0.035, uT * 0.012);
          float c = fbm(p + fbm(p * 1.7 - uT * 0.02));
          float cover = smoothstep(0.62 - uA * 0.5, 0.95 - uA * 0.4, c + 0.12);
          vec2 e = smoothstep(0.0, 0.14, vUv) * (1.0 - smoothstep(0.86, 1.0, vUv));
          float a = cover * e.x * e.y * uA;
          vec3 col = mix(vec3(0.32, 0.36, 0.42), vec3(0.85, 0.88, 0.93), smoothstep(0.4, 1.0, c));
          gl_FragColor = vec4(col * 0.75, a * 0.9); }`,
    }));
    this.mesh.position.y = R ? 2.6 : 7.5; if (R) { this.mesh.position.x = R.x; this.mesh.position.z = R.z; } this.mesh.renderOrder = 5; this.target = 0;
  }
  update(dt, t) { this.u.uT.value = t; this.u.uA.value += (this.target - this.u.uA.value) * Math.min(1, dt * 1.5); this.mesh.visible = this.u.uA.value > 0.01; }
}

// ---- draped vectors -------------------------------------------------------------------
// The lines float a little above the ground so the relief never swallows them. From far away that is uLift, as before;
// close up the lift shrinks with the distance, so a line does not hang over the roofs of the 3D buildings.
// uCut > 0 fades a layer out nearer than that distance (main roads, once the ground itself shows every road).
//
// Every segment is a thin strip facing the screen, uW pixels wide with soft sides, rather than a one-pixel GL line.
// A GL line is either on a pixel or off it, so roads and borders crawled and sparkled whenever the camera moved;
// a strip fades across its edge and slides from pixel to pixel smoothly.
const lineMat = (uExag, lift, width = 1.3) => new THREE.ShaderMaterial({
  uniforms: { uExag, uLift: { value: lift }, uO: { value: 1 }, uCut: { value: 0 }, uW: { value: width }, uRes: { value: new THREE.Vector2(1, 1) } },
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `uniform float uExag, uLift, uCut, uW; uniform vec2 uRes; attribute vec3 iA, iB; attribute vec4 iC; varying vec4 vC; varying float vS;
    vec4 place(vec3 p, out float fade) { p.y *= uExag; float d = distance(cameraPosition, p); p.y += min(uLift, d * 0.004 + 0.0006);
      fade = uCut > 0.0 ? smoothstep(uCut * 0.55, uCut, d) : 1.0; return projectionMatrix * viewMatrix * vec4(p, 1.0); }
    void main(){
      float fa, fb; vec4 a = place(iA, fa), b = place(iB, fb); const float n = 1e-4;
      if (a.w < n && b.w < n) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }        // behind the camera
      if (a.w < n) a = mix(a, b, (n - a.w) / (b.w - a.w)); else if (b.w < n) b = mix(b, a, (n - b.w) / (a.w - b.w));
      vec2 sa = a.xy / a.w * uRes * 0.5, sb = b.xy / b.w * uRes * 0.5, dir = sb - sa;      // the two ends in pixels
      float len = length(dir); dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
      float hw = uW * 0.5 + 1.0; vS = position.y * hw;
      vec4 c = position.x < 0.5 ? a : b; vC = iC; vC.a *= position.x < 0.5 ? fa : fb;
      gl_Position = vec4(((position.x < 0.5 ? sa : sb) + vec2(-dir.y, dir.x) * vS) / (uRes * 0.5) * c.w, c.z, c.w); }`,
  fragmentShader: `uniform float uO, uW; varying vec4 vC; varying float vS;
    void main(){ float a = vC.a * uO * 0.75 * (1.0 - smoothstep(0.0, uW * 0.5 + 1.0, abs(vS))); if (a < 0.003) discard; gl_FragColor = vec4(vC.rgb, a); }`,      // rounded across its width: no hard edge and no sharp peak to pulse as it crosses a pixel. 0.75: the strip is wider than the old line, so it is fainter and weighs the same
});
const STRIP = new THREE.Vector2();
function lineMesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(STRIP); material.uniforms.uRes.value.copy(STRIP); };
  return m;
}

function drape(D, lines, colorOf, step = 0.25) {
  const pos = [], col = [], H = D.surfAt || D.hAt;      // the drawn surface itself (js/world-geo.js), so a line lies on the ground it crosses
  for (const ln of lines) {
    const p = ln.p || ln, c = colorOf(ln);
    for (let i = 0; i < p.length - 1; i++) {
      const ax = D.sx(p[i][0]), az = D.sz(p[i][1]), bx = D.sx(p[i + 1][0]), bz = D.sz(p[i + 1][1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) {
        const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
        if (Math.abs(x0) > D.Ws / 2 || Math.abs(z0) > D.Hs / 2 || Math.abs(x1) > D.Ws / 2 || Math.abs(z1) > D.Hs / 2) continue;
        pos.push(x0, H(x0, z0), z0, x1, H(x1, z1), z1); col.push(...c);
      }
    }
  }
  // one strip (two triangles) per segment: position.x picks the end, position.y the side
  const g = new THREE.InstancedBufferGeometry(), ends = new THREE.InstancedInterleavedBuffer(new Float32Array(pos), 6);
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(ends, 3, 0)); g.setAttribute('iB', new THREE.InterleavedBufferAttribute(ends, 3, 3));
  g.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(col), 4)); g.instanceCount = pos.length / 6;
  return g;
}

export function makeVectors(D, uExag) {
  const out = {};
  const borders = D.vectors.counties.flatMap((c) => c.lines);
  out.borders = lineMesh(drape(D, borders, () => (D.korea ? [1, 1, 1, 0.13] : [1, 1, 1, 0.42]), 0.3), lineMat(uExag, D.korea ? 0.03 : 0.09));
  if (D.vectors.provinces) out.provinces = lineMesh(drape(D, D.vectors.provinces.flatMap((p) => p.lines), () => [1, 0.86, 0.66, 0.62], 0.3), lineMat(uExag, 0.04));
  const rc = [[1.0, 0.82, 0.5, 0.85], [1.0, 0.82, 0.5, 0.7], [0.95, 0.9, 0.8, 0.5], [0.9, 0.9, 0.9, 0.32], [0.9, 0.9, 0.9, 0.2]];
  out.roads = lineMesh(drape(D, D.vectors.roads, (r) => (D.korea ? [rc[r.k][0], rc[r.k][1], rc[r.k][2], rc[r.k][3] * 0.38] : rc[r.k]), D.korea ? 0.35 : 0.2), lineMat(uExag, D.korea ? 0.02 : 0.05));
  const pts = (list, size, color, shape) => {
    const pos = new Float32Array(list.length * 3), a = new Float32Array(list.length);
    list.forEach((p, i) => { const x = D.sx(p.x ?? p[0]), z = D.sz(p.z ?? p[1]); pos.set([x, D.hAt(x, z), z], i * 3); a[i] = p.w ?? 1; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aW', new THREE.BufferAttribute(a, 1));
    return new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uExag, uS: { value: size }, uC: { value: new THREE.Color().setStyle(color) }, uT: { value: 0 }, uCut: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `uniform float uExag, uS, uCut; attribute float aW; varying float vW, vF; void main(){ vW = aW; vec3 p = position; p.y = p.y * uExag + ${D.korea ? '0.02' : '0.07'}; vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uS / -mv.z, ${shape === 'ring' ? '5.0, 34.0' : '1.5, 9.0'}); gl_Position = projectionMatrix * mv;
        vF = uCut > 0.0 ? smoothstep(uCut * 0.75, uCut, -mv.z) : 1.0; }`,      // uCut: nearer than this the 3D buildings stand in for the dots (js/world.js)
      fragmentShader: shape === 'ring'
        ? `uniform vec3 uC; uniform float uT; varying float vW; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - 0.72)); float dot_ = 1.0 - smoothstep(0.12, 0.3, r);
            float a = max(ring, dot_ * 0.9) * (vW > 0.5 ? 1.0 : 0.45); if (a < 0.02) discard;
            gl_FragColor = vec4(vW > 0.5 ? uC * 1.5 : vec3(0.6), a); }`
        : `uniform vec3 uC; varying float vF; void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (max(d.x, d.y) > 0.38 || vF < 0.02) discard; gl_FragColor = vec4(uC, 0.95 * vF); }`,
    }));
  };
  // buildings are no longer flat squares: js/world.js draws them as small 3D blocks from far away and as themselves close up
  out.scars = pts(D.cands.map((c) => ({ x: c.x, z: c.z, w: c.final === 1 ? 1 : 0 })), D.korea ? 120 : 520, '#7fe3ff', 'ring');
  for (const k in out) { out[k].frustumCulled = false; out[k].renderOrder = 2; }
  return out;
}

// ---- debris flows: the cells each simulated slide covers, filled in the order the flow reaches them ---------------
// Times are simulated seconds. The flows are painted into the ground by the terrain shader (terrain.js debCell/debShade):
// this bakes them into three textures once. Close up every 10 m cell is read and blended, far away a filtered texture
// of 80 m blocks takes over, so nothing flickers and the cost is a few texture reads per ground pixel, not 845k sprites.
// Cells only the far-reaching friction case covers are drawn pale and hatched.
export class Debris {
  constructor(D, uExag, terrain) {
    const R = D.runout, U = terrain.uniforms, B = 8, SPREAD = 70, m = R.m, nf = R.nf;
    this.R = R; this.U = U; this.len = new Float32Array(nf); this.cen = new Float32Array(nf * 2);
    let cmax = 0, rmax = 0;
    for (let i = 0; i < m; i++) { if (R.col[i] > cmax) cmax = R.col[i]; if (R.row[i] > rmax) rmax = R.row[i]; }
    // blocks that hold a flow cell or touch one (the blurred outline and the across coordinate reach a cell past the flow)
    const TW = ((cmax + 1) >> 3) + 1, TH = ((rmax + 1) >> 3) + 1, NT = TW * TH, tile = new Int32Array(NT).fill(-1), tq = [];
    for (let i = 0; i < m; i++) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const c = R.col[i] + dc, r = R.row[i] + dr; if (c < 0 || r < 0) continue;
      const q = (r >> 3) * TW + (c >> 3); if (tile[q] < 0) { tile[q] = tq.length; tq.push(q); }
    }
    // two pages of cells, then the block index, then (after a gap that keeps the filtered levels apart) the far-view blocks
    const nt = tq.length, AW = Math.max(Math.ceil(Math.sqrt(nt)), Math.ceil(TW / B)), AH = Math.ceil(nt / AW), PW = AW * B, PB = AH * B, IY = 2 * PB;
    const CY = IY + TH + 64, HT = CY + TH, atlas = new Uint8Array(PW * HT * 4), NC = PW * PB, first = new Float32Array(NC).fill(1e9), own = new Int32Array(NC).fill(-1);
    const cell = (c, r) => { if (c < 0 || r < 0 || c >= TW * B || r >= TH * B) return -1; const ti = tile[(r >> 3) * TW + (c >> 3)]; return ti < 0 ? -1 : ((ti / AW | 0) * B + (r & 7)) * PW + (ti % AW) * B + (c & 7); };
    for (let f = 0; f < nf; f++) {
      const s0 = (f * 0.618034) % 1; let cx = 0, cz = 0;
      for (let i = R.off[f]; i < R.off[f + 1]; i++) {
        const c = R.col[i], r = R.row[i], t = R.t[i] * 0.5, at = s0 * SPREAD + t, a = cell(c, r);
        if (at < first[a]) {                                           // two flows on one cell: the one that gets there first
          first[a] = at; own[a] = f; const id = f + 1;
          atlas[a * 4] = R.t[i]; atlas[a * 4 + 1] = Math.max(atlas[a * 4 + 1], R.d[i]); atlas[a * 4 + 2] = id & 255; atlas[a * 4 + 3] = ((id >> 8) << 1) | (R.k[i] ? 1 : 0);
        } else atlas[a * 4 + 1] = Math.max(atlas[a * 4 + 1], R.d[i]);
        if (t > this.len[f]) this.len[f] = t;
        cx += c; cz += r;
      }
      const n = R.off[f + 1] - R.off[f], [x, z] = R.at(cx / n, cz / n); this.cen[f * 2] = x; this.cen[f * 2 + 1] = z;
    }
    // arrival times smoothed over each flow's own neighbouring cells (twice), so the mesh's cross lines run as clean curves
    for (let pass = 0; pass < 2; pass++) {
      const tNew = new Float32Array(NC);
      for (let a = 0; a < NC; a++) {
        if (own[a] < 0) continue;
        const c = (a % PW), r = (a / PW | 0), ti = (r >> 3) * AW + (c >> 3), q = tq[ti], cc = (q % TW) * B + (c & 7), rr = (q / TW | 0) * B + (r & 7);
        let sw = 0, st = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const e = cell(cc + dx, rr + dy); if (e < 0 || own[e] !== own[a]) continue;
          const k = (dx ? 1 : 2) * (dy ? 1 : 2); sw += k; st += k * atlas[e * 4];
        }
        tNew[a] = st / sw;
      }
      for (let a = 0; a < NC; a++) if (own[a] >= 0) atlas[a * 4] = Math.round(tNew[a]);
    }
    // across coordinate: signed distance (cells) from each flow's centre line, which runs through the middles of its
    // cells taken in the order the flow reached them, so the mesh's long lines bend with the flow
    const vAt = new Float32Array(NC).fill(NaN);
    for (let f = 0; f < nf; f++) {
      const o = R.off[f], n = R.off[f + 1] - o, ord = Array.from({ length: n }, (_, k) => o + k).sort((p, q) => R.t[p] - R.t[q]);
      const G = Math.max(1, Math.min(16, Math.round(n / 16))), pts = [];
      for (let g = 0; g < G; g++) {
        let x = 0, y = 0; const a = Math.floor(g * n / G), b = Math.floor((g + 1) * n / G);
        for (let k = a; k < b; k++) { x += R.col[ord[k]]; y += R.row[ord[k]]; }
        pts.push([x / (b - a), y / (b - a)]);
      }
      let sm = pts;
      for (let it = 0; it < 3; it++) sm = sm.map((p, k) => (k === 0 || k === G - 1) ? p : [(sm[k - 1][0] + 2 * p[0] + sm[k + 1][0]) / 4, (sm[k - 1][1] + 2 * p[1] + sm[k + 1][1]) / 4]);
      const line = []; for (const p of sm) { const l = line[line.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.5) line.push(p); }
      for (let i = o; i < o + n; i++) {
        const a = cell(R.col[i], R.row[i]); if (own[a] !== f) continue;
        if (line.length < 2) { vAt[a] = 0; continue; }
        let best = 1e9, v = 0;
        for (let k = 0; k < line.length - 1; k++) {
          const [x0, y0] = line[k], [x1, y1] = line[k + 1], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
          let u = ((R.col[i] - x0) * dx + (R.row[i] - y0) * dy) / L2;
          if (k > 0) u = Math.max(u, 0); if (k < line.length - 2) u = Math.min(u, 1);
          const px = R.col[i] - (x0 + u * dx), py = R.row[i] - (y0 + u * dy), d = Math.hypot(px, py);
          if (d < best) { best = d; v = Math.sign(dx * py - dy * px) * d; }
        }
        vAt[a] = v;
      }
    }
    // page B: blurred cover (all flows, and the best-fit case alone) and the across coordinate, which cells just
    // outside a flow borrow from their neighbours so the blend at the edge stays sane
    const K = [1, 2, 1];
    for (let ti = 0; ti < nt; ti++) {
      const q = tq[ti], c0 = (q % TW) * B, r0 = (q / TW | 0) * B;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
        const c = c0 + x, r = r0 + y, a = cell(c, r); let sa = 0, sb = 0, vs = 0, vn = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const e = cell(c + dx, r + dy); if (e < 0 || own[e] < 0) continue;
          const k = K[dx + 1] * K[dy + 1]; sa += k; sb += k * (atlas[e * 4 + 3] & 1);
          if (!Number.isNaN(vAt[e])) { vs += vAt[e]; vn++; }
        }
        const v = own[a] >= 0 && !Number.isNaN(vAt[a]) ? vAt[a] : (vn ? vs / vn : 0), enc = Math.max(0, Math.min(65535, Math.round((v + 128) * 256)));
        const pb = (a + NC) * 4; atlas[pb] = Math.round(sa / 16 * 255); atlas[pb + 1] = Math.round(sb / 16 * 255); atlas[pb + 2] = enc & 255; atlas[pb + 3] = enc >> 8;
      }
    }
    // per 80 m block: share covered, earliest start, best-fit share, mean depth. Empty blocks take their nearest
    // covered neighbour's values (all but the share), so filtering never pulls a start time or depth towards zero.
    const cov = new Float32Array(NT), t0 = new Float32Array(NT).fill(255), bst = new Float32Array(NT), dep = new Float32Array(NT);
    for (let ti = 0; ti < nt; ti++) {
      const ax = (ti % AW) * B, ay = (ti / AW | 0) * B, q = tq[ti]; let n = 0, nb = 0, sd = 0;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
        const a = (ay + y) * PW + ax + x; if (own[a] < 0) continue;
        n++; nb += atlas[a * 4 + 3] & 1; sd += atlas[a * 4 + 1]; if (first[a] < t0[q]) t0[q] = first[a];
      }
      if (!n) continue; cov[q] = n / 64; bst[q] = nb / n; dep[q] = sd / n / 75;
    }
    const seen = new Uint8Array(NT), queue = new Int32Array(NT); let qh = 0, qt = 0;
    for (const q of tq) if (cov[q] > 0) { seen[q] = 1; queue[qt++] = q; }
    while (qh < qt) {
      const q = queue[qh++], x = q % TW, y = (q / TW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= TW || Y >= TH) continue;
        const p = Y * TW + X; if (seen[p]) continue;
        seen[p] = 1; t0[p] = t0[q]; bst[p] = bst[q]; dep[p] = dep[q]; queue[qt++] = p;
      }
    }
    for (let q = 0; q < NT; q++) {
      const id = tile[q] + 1, a = ((IY + (q / TW | 0)) * PW + q % TW) * 4; atlas[a] = id & 255; atlas[a + 1] = id >> 8;
      const c = ((CY + (q / TW | 0)) * PW + q % TW) * 4;
      atlas[c] = Math.round(cov[q] * 255); atlas[c + 1] = Math.min(255, Math.round(t0[q])); atlas[c + 2] = Math.round(bst[q] * 255); atlas[c + 3] = Math.round(Math.min(dep[q], 1) * 255);
    }
    const tex = (data, w, h, filtered) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = filtered ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter; t.magFilter = filtered ? THREE.LinearFilter : THREE.NearestFilter;
      t.generateMipmaps = filtered; t.anisotropy = filtered ? 4 : 1; t.needsUpdate = true; return t;
    };
    // scene x, z -> cell column, row (cell centres at whole numbers). Exact for the regional map; on the nationwide map the
    // cells sit on a gently curved lattice, so fit the plane through it.
    const S = [];
    for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) { const c = cmax * a / 8, r = rmax * b / 8, [x, z] = R.at(c, r); S.push([x, z, c, r]); }
    const fit = (k) => {
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
      for (const s of S) { const row = [s[0], s[1], 1]; for (let i = 0; i < 3; i++) { v[i] += row[i] * s[k]; for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j]; } }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const g = M[j][i] / M[i][i]; for (let l = 0; l < 3; l++) M[j][l] -= g * M[i][l]; v[j] -= g * v[i]; }
      const o = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * o[j]; o[i] = s / M[i][i]; }
      return new THREE.Vector3(...o);
    };
    U.uDebX.value = fit(2); U.uDebZ.value = fit(3);
    U.tDebA.value = tex(atlas, PW, HT, true); U.uDebIY.value = IY; U.uDebPB.value = PB; U.uDebCR.value.set(1 / (B * PW), CY / HT, 1 / (B * HT), 0);
    U.uDebAW.value = AW; U.uDebN.value.set(TW * B, TH * B); U.uDebSpread.value = SPREAD;
    this.points = new THREE.Group();                                   // nothing to add to the scene: the ground draws them
    this.playing = false; this.sel = -1;
  }
  get active() { return this.playing || this.sel >= 0 || this.U.uDebOn.value > 0; }      // the mesh streams, so it needs every frame
  centre(f) { return [this.cen[f * 2], this.cen[f * 2 + 1]]; }
  fireAll() { this.U.uDebOn.value = 1; this.U.uDebT.value = -4; this.playing = true; }
  showAll() { this.U.uDebOn.value = 1; this.U.uDebT.value = 1e4; this.playing = false; }        // every flow at its end state
  clear() { this.U.uDebOn.value = 0; this.playing = false; }
  focus(f) { this.sel = f; this.U.uDebSel.value = f; this.U.uDebSelT.value = -6; }                // replay one slope's flow in a loop
  update(dt) {
    const RATE = 9, U = this.U;                                        // simulated seconds per second on screen
    if (this.playing) { U.uDebT.value += dt * RATE; if (U.uDebT.value > U.uDebSpread.value + 140) this.playing = false; }
    if (this.sel >= 0) { U.uDebSelT.value += dt * RATE; if (U.uDebSelT.value > this.len[this.sel] + 45) U.uDebSelT.value = -6; }
  }
}

// ---- selection beacon -------------------------------------------------------------------
export class Beacon {
  constructor() {
    this.group = new THREE.Group(); this.group.visible = false;
    const g = new THREE.CylinderGeometry(0.1, 0.1, 1, 16, 1, true); g.translate(0, 0.5, 0);
    this.u = { uT: { value: 0 } };
    this.beam = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT; varying float vY; void main(){ float a = pow(clamp(1.0 - vY, 0.0, 1.0), 2.2) * (0.75 + 0.25 * sin(vY * 40.0 - uT * 6.0)); gl_FragColor = vec4(vec3(1.0, 0.82, 0.62) * a * 0.75, 1.0); }`,
    }));
    this.beam.scale.set(1, 16, 1);
    const rg = new THREE.RingGeometry(0.86, 1, 48); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffd9b8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.group.add(this.beam, this.ring);
  }
  place(x, y, z) { this.group.position.set(x, y, z); this.group.visible = true; this.t0 = performance.now(); }
  hide() { this.group.visible = false; }
  update(t, camDist) {
    this.u.uT.value = t;
    const s = Math.max(0.12, camDist * 0.0035), f = (t * 0.7) % 1;
    this.beam.scale.set(s, Math.max(4, camDist * 0.2), s);
    this.ring.scale.setScalar(0.2 + f * Math.max(0.5, camDist * 0.03)); this.ring.material.opacity = 0.9 * (1 - f);
  }
}

// Places where landslides killed people in the last ten years (data/history.json): a thin red beam over a ground ring.
// They hold still, so they cost no frames; update() resizes them to the camera so they read the same at any zoom.
export class PastMarks {
  constructor(D, events) {
    this.D = D; this.group = new THREE.Group(); this.group.visible = false;
    const bg = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); bg.translate(0, 0.5, 0);
    const beam = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vY; void main(){ float a = pow(clamp(1.0 - vY, 0.0, 1.0), 1.4); gl_FragColor = vec4(vec3(1.0, 0.3, 0.18) * a * 0.9, 1.0); }` });
    const rg = new THREE.RingGeometry(0.8, 1, 48); rg.rotateX(-Math.PI / 2);
    const ring = new THREE.MeshBasicMaterial({ color: 0xff4d2e, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    const dg = new THREE.CircleGeometry(0.26, 20); dg.rotateX(-Math.PI / 2);
    this.items = events.map((e) => {
      const o = new THREE.Group(), it = { o, x: D.sx(e.x), z: D.sz(e.z), top: 1, beam: new THREE.Mesh(bg, beam), flat: new THREE.Group() };
      it.flat.add(new THREE.Mesh(rg, ring), new THREE.Mesh(dg, ring)); o.add(it.beam, it.flat); o.position.set(it.x, 0, it.z); this.group.add(o);
      return it;
    });
  }
  update(camera, exag) {
    for (const it of this.items) {
      it.o.position.y = this.D.hAt(it.x, it.z) * exag;
      const d = camera.position.distanceTo(it.o.position), s = Math.max(0.04, d * 0.0062);
      it.top = d * 0.032; it.beam.scale.set(s * 0.16, it.top, s * 0.16); it.flat.scale.setScalar(s);
    }
  }
}
