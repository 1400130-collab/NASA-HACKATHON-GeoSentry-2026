// Drone mode: the weather. The July 2026 storm by default (low cloud that swallows the ridges, rain that slants as you fly,
// lightning), or a clear afternoon with the low sun the terrain shadows were baked for. One number, storm 0..1, blends
// every light, haze and sky value, so switching is a slow change of weather and not a cut.
import * as THREE from 'three';
import { COMMON } from './land.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position * 90000. + cameraPosition, 1.); gl_Position = p.xyww; }`;
const SKY_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDet; uniform float uStorm; uniform vec3 uFlashDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float y = max(d.y, 0.);
  vec2 cuv = d.xz / (y + .14);
  float c1 = texture2D(uDet, cuv * .09 + uTime * vec2(.0035, .0015)).r, c2 = texture2D(uDet, cuv * .27 - uTime * vec2(.005, .0026)).g, cl = c1 * .65 + c2 * .35;
  vec3 st = mix(vec3(.15, .17, .2), vec3(.5, .53, .58), smoothstep(.28, .8, cl)) * (.7 + .5 * y);
  vec3 cs = mix(vec3(.5, .64, .84), vec3(.08, .22, .58), pow(y, .5));
  float sd = max(dot(d, uSun), 0.);
  cs += vec3(1., .85, .6) * (pow(sd, 1400.) * 14. + pow(sd, 18.) * .35 + pow(sd, 3.) * .1);
  cs = mix(cs, vec3(1., .97, .93) * (.72 + .45 * c2), smoothstep(.57, .74, cl) * smoothstep(.03, .25, d.y) * .85);
  vec3 col = mix(cs, st, uStorm);
  col = mix(uFogCol, col, smoothstep(.0, mix(.16, .3, uStorm), d.y));
  col += uFlash * vec3(.5, .56, .72) * (.35 + 2. * pow(max(dot(d, uFlashDir), 0.), 5.)) * uStorm;
  gl_FragColor = vec4(finish(col), 1.);
}`;

const RAIN_VERT = /* glsl */`
${COMMON}
uniform vec3 uRainV, uRel; uniform float uRain;
attribute vec3 aSeed;
varying float vA;
void main() {
  vec3 box = vec3(56., 40., 56.);
  vec3 p = mod(aSeed * box + uRainV * uTime - cameraPosition, box) - box * .5;
  float sp = length(uRel), d = length(p); vec3 dir = uRel / max(sp, .01);
  float len = clamp(sp * .028, .35, 3.2);
  vec3 side = normalize(cross(dir, p));
  vec3 w = cameraPosition + p + dir * position.y * len + side * position.x * (.006 + d * .0011);
  vA = uRain * (.16 + .2 * fract(aSeed.x * 91.)) * smoothstep(.6, 3., d) * (1. - smoothstep(20., 28., d));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;
const RAIN_FRAG = /* glsl */`
${COMMON}
varying float vA;
void main() { gl_FragColor = vec4(finish((uSkyCol * 1.5 + uFogCol * .6 + uFlash)), vA); }`;

const STORM = { sun: [-.35, .8, .45], sunCol: [.56, .58, .63], sky: [.37, .4, .45], gnd: [.075, .075, .07], fog: [.33, .36, .4], dens: 4.4e-4, fall: 1 / 700, cloud: 1, exp: 1.08, wet: 1, sh: .18 };
const CLEAR = { sun: [-.66, .42, .62], sunCol: [3.3, 2.85, 2.25], sky: [.3, .42, .66], gnd: [.11, .105, .075], fog: [.55, .66, .82], dens: 5.2e-5, fall: 1 / 1500, cloud: 0, exp: .82, wet: 0, sh: 1 };
const mix = (a, b, k) => a + (b - a) * k;

export class Sky {
  constructor(land, scene) {
    this.land = land; this.U = land.U; this.storm = 1; this.want = 1; this.flashT = -99; this.next = 6; this.cloudBase = 660;
    this.u = { uStorm: { value: 1 }, uFlashDir: { value: new THREE.Vector3(0, .4, -1).normalize() } };
    const dome = this.dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), new THREE.ShaderMaterial({ uniforms: { ...land.U, ...this.u }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    dome.frustumCulled = false; dome.renderOrder = -10; scene.add(dome);

    const N = 7000, seed = new Float32Array(N * 3); for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -.5, 0, 1, -.5, 0, 1, .5, 0, -1, .5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3)); g.instanceCount = N;
    this.ru = { uRainV: { value: new THREE.Vector3(5, -21, 3) }, uRel: { value: new THREE.Vector3(0, -21, 0) }, uRain: { value: 1 } };
    this.rain = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...land.U, ...this.ru }, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.rain.frustumCulled = false; this.rain.renderOrder = 70; scene.add(this.rain);

    // the bolt: three jittered strands, redrawn for every strike
    this.boltPos = new Float32Array(3 * 2 * 60 * 3);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3));
    this.bolt = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.bolt.frustumCulled = false; this.bolt.visible = false; this.bolt.renderOrder = 80; scene.add(this.bolt);
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1); scene.add(this.sun, this.hemi);
    this.apply(1);
  }
  toggle() { this.want = this.want > .5 ? 0 : 1; return this.want; }
  apply(k) {
    const U = this.U, A = CLEAR, B = STORM, v3 = (a, b) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
    U.uSun.value.set(...v3(A.sun, B.sun)).normalize(); U.uSunCol.value.setRGB(...v3(A.sunCol, B.sunCol)); U.uSkyCol.value.setRGB(...v3(A.sky, B.sky)); U.uGndCol.value.setRGB(...v3(A.gnd, B.gnd)); U.uFogCol.value.setRGB(...v3(A.fog, B.fog));
    U.uFog.value.set(Math.exp(mix(Math.log(A.dens), Math.log(B.dens), k)), mix(A.fall, B.fall, k), this.cloudBase, Math.min(1, k * 1.4));
    U.uExposure.value = mix(A.exp, B.exp, k); U.uWet.value = mix(A.wet, B.wet, k); U.uShadowK.value = mix(A.sh, B.sh, k);
    this.u.uStorm.value = k; this.ru.uRain.value = Math.max(0, k * 1.6 - .6); this.rain.visible = k > .4;
    this.sun.position.copy(U.uSun.value).multiplyScalar(100); this.sun.color.copy(U.uSunCol.value); this.sun.intensity = mix(1.1, 2.2, k);
    this.hemi.color.copy(U.uSkyCol.value); this.hemi.groundColor.copy(U.uGndCol.value); this.hemi.intensity = mix(2.2, 3.2, k);
  }
  // lightning to a point on the ground; returns how far away it was
  strike(x, z, now, cam) {
    const y = this.land.hAt(x, z), top = Math.max(this.cloudBase + 150, y + 500), P = this.boltPos; let q = 0;
    for (let s = 0; s < 3; s++) {
      let px = x + (Math.random() - .5) * 260, pz = z + (Math.random() - .5) * 260, py = top; const steps = 18;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, nx = mix(px, x, 1 / (steps - i + 1)) + (i < steps ? (Math.random() - .5) * 70 * (1 - k) : 0), nz = mix(pz, z, 1 / (steps - i + 1)) + (i < steps ? (Math.random() - .5) * 70 * (1 - k) : 0), ny = mix(top, y, k);
        P.set([px + s * .8, py, pz, nx + s * .8, ny, nz], q); q += 6; px = nx; py = ny; pz = nz;
      }
    }
    this.bolt.geometry.setDrawRange(0, q / 3); this.bolt.geometry.attributes.position.needsUpdate = true;
    this.flashT = now; this.u.uFlashDir.value.set(x - cam.x, top * .5 - cam.y, z - cam.z).normalize();
    return Math.hypot(x - cam.x, z - cam.z);
  }
  update(dt, now, cam, vel) {
    if (this.storm !== this.want) { this.storm += Math.sign(this.want - this.storm) * Math.min(Math.abs(this.want - this.storm), dt / 3.5); this.apply(this.storm); }
    const a = now - this.flashT, f = a < 0 ? 0 : a < .07 ? 1 : a < .13 ? .2 : a < .2 ? .85 : .85 * Math.exp(-(a - .2) * 7);
    this.U.uFlash.value = f * this.storm; this.bolt.visible = a >= 0 && a < .22 && !(a > .07 && a < .13); this.bolt.material.opacity = Math.min(1, f * 1.2);
    this.ru.uRel.value.copy(this.ru.uRainV.value).sub(vel);
    let thunder = -1;
    if (this.storm > .7 && now > this.next) {                       // the storm's own lightning, a few kilometres off
      const ang = Math.random() * 6.2832, r = 1500 + Math.random() * 4500;
      thunder = this.strike(cam.x + Math.cos(ang) * r, cam.z + Math.sin(ang) * r, now, cam); this.next = now + 7 + Math.random() * 14;
    }
    return thunder;
  }
}
