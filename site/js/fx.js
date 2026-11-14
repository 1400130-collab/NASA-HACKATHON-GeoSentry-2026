import * as THREE from 'three';
import { TRACK_COLORS } from './terrain.js';

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
const lineMat = (uExag, lift) => new THREE.ShaderMaterial({
  uniforms: { uExag, uLift: { value: lift }, uO: { value: 1 } }, transparent: true, depthWrite: false,
  vertexShader: `uniform float uExag, uLift; attribute vec4 aC; varying vec4 vC; void main(){ vC = aC; vec3 p = position; p.y = p.y * uExag + uLift; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `uniform float uO; varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb, vC.a * uO); }`,
});

function drape(D, lines, colorOf, step = 0.25) {
  const pos = [], col = [];
  for (const ln of lines) {
    const p = ln.p || ln, c = colorOf(ln);
    let prev = null;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = D.sx(p[i][0]), az = D.sz(p[i][1]), bx = D.sx(p[i + 1][0]), bz = D.sz(p[i + 1][1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) {
        const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
        if (Math.abs(x0) > D.Ws / 2 || Math.abs(z0) > D.Hs / 2 || Math.abs(x1) > D.Ws / 2 || Math.abs(z1) > D.Hs / 2) continue;
        pos.push(x0, D.hAt(x0, z0), z0, x1, D.hAt(x1, z1), z1); col.push(...c, ...c);
      }
      prev = p[i];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

export function makeVectors(D, uExag) {
  const out = {};
  const borders = D.vectors.counties.flatMap((c) => c.lines);
  out.borders = new THREE.LineSegments(drape(D, borders, () => (D.korea ? [1, 1, 1, 0.13] : [1, 1, 1, 0.42]), 0.3), lineMat(uExag, D.korea ? 0.03 : 0.09));
  if (D.vectors.provinces) out.provinces = new THREE.LineSegments(drape(D, D.vectors.provinces.flatMap((p) => p.lines), () => [1, 0.86, 0.66, 0.62], 0.3), lineMat(uExag, 0.04));
  const rc = [[1.0, 0.82, 0.5, 0.85], [1.0, 0.82, 0.5, 0.7], [0.95, 0.9, 0.8, 0.5], [0.9, 0.9, 0.9, 0.32], [0.9, 0.9, 0.9, 0.2]];
  out.roads = new THREE.LineSegments(drape(D, D.vectors.roads, (r) => (D.korea ? [rc[r.k][0], rc[r.k][1], rc[r.k][2], rc[r.k][3] * 0.38] : rc[r.k]), D.korea ? 0.35 : 0.2), lineMat(uExag, D.korea ? 0.02 : 0.05));
  const pts = (list, size, color, shape) => {
    const pos = new Float32Array(list.length * 3), a = new Float32Array(list.length);
    list.forEach((p, i) => { const x = D.sx(p.x ?? p[0]), z = D.sz(p.z ?? p[1]); pos.set([x, D.hAt(x, z), z], i * 3); a[i] = p.w ?? 1; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aW', new THREE.BufferAttribute(a, 1));
    return new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uExag, uS: { value: size }, uC: { value: new THREE.Color().setStyle(color) }, uT: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `uniform float uExag, uS; attribute float aW; varying float vW; void main(){ vW = aW; vec3 p = position; p.y = p.y * uExag + ${D.korea ? '0.02' : '0.07'}; vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uS / -mv.z, ${shape === 'ring' ? '5.0, 34.0' : '1.5, 9.0'}); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: shape === 'ring'
        ? `uniform vec3 uC; uniform float uT; varying float vW; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - 0.72)); float dot_ = 1.0 - smoothstep(0.12, 0.3, r);
            float a = max(ring, dot_ * 0.9) * (vW > 0.5 ? 1.0 : 0.45); if (a < 0.02) discard;
            gl_FragColor = vec4(vW > 0.5 ? uC * 1.5 : vec3(0.6), a); }`
        : `uniform vec3 uC; void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (max(d.x, d.y) > 0.38) discard; gl_FragColor = vec4(uC, 0.95); }`,
    }));
  };
  out.buildings = pts(D.vectors.buildings, D.korea ? 40 : 150, '#ffe3b8', 'sq');
  out.scars = pts(D.cands.map((c) => ({ x: c.x, z: c.z, w: c.final === 1 ? 1 : 0 })), D.korea ? 120 : 520, '#7fe3ff', 'ring');
  for (const k in out) { out[k].frustumCulled = false; out[k].renderOrder = 2; }
  return out;
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
