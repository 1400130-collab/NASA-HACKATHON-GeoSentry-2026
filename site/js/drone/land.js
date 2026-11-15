// Drone mode: the ground. The real Copernicus DEM of the North Gyeongsang box (80 m, data/height.bin.gz) drawn 1:1 in metres.
// The same height function runs on the GPU (to draw) and on the CPU (to fly, crash and plant things on it):
//   bicubic DEM + three octaves of fine relief read from one shared noise table, so both sides agree to the millimetre.
// Drawn as a clipmap: ten nested 128 x 128 grids, 4 m cells under the drone doubling outwards, each ring morphing into
// the next one's lattice before it hands over, so nothing pops or cracks. Land cover is classified from the Sentinel-2
// false-colour picture (forest, 2025 burn scar, water, bare/built), the surface detail is procedural.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const rng = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// Everything every shader here shares: the height function, the debris-flow lookup, light, haze and the film curve.
export const COMMON = /* glsl */`
uniform sampler2D uHF, uNz, uFlow;
uniform vec2 uHalf;
uniform ivec2 uHFSize;
uniform vec4 uFlowWin;                       // world x, z of the window's corner | cells across | cell size (m)
uniform float uTime, uFlash, uExposure, uWet, uShadowK;
uniform vec3 uSun, uSunCol, uSkyCol, uGndCol, uFogCol;
uniform vec4 uFog;                           // density | height falloff | cloud base (m) | cloud ceiling on
vec4 crw(float t) { return vec4(((-t + 2.) * t - 1.) * t, (3. * t - 5.) * t * t + 2., ((-3. * t + 4.) * t + 1.) * t, (t - 1.) * t * t) * .5; }
vec2 hfBase(vec2 xz) {
  vec2 f = (xz + uHalf) / 80. - .5, i = floor(f), t = f - i; ivec2 b = ivec2(i);
  vec4 wx = crw(t.x), wz = crw(t.y); vec2 s = vec2(0.);
  for (int r = 0; r < 4; r++) {
    int rr = clamp(b.y - 1 + r, 0, uHFSize.y - 1); vec2 a = vec2(0.);
    for (int c = 0; c < 4; c++) a += wx[c] * texelFetch(uHF, ivec2(clamp(b.x - 1 + c, 0, uHFSize.x - 1), rr), 0).rg;
    s += wz[r] * a;
  }
  return s;
}
float vn(vec2 p) {
  vec2 i = floor(p), f = p - i; f = f * f * (3. - 2. * f); ivec2 b = ivec2(i);
  float a = texelFetch(uNz, b & 255, 0).r, bb = texelFetch(uNz, (b + ivec2(1, 0)) & 255, 0).r, c = texelFetch(uNz, (b + ivec2(0, 1)) & 255, 0).r, d = texelFetch(uNz, (b + ivec2(1, 1)) & 255, 0).r;
  return mix(mix(a, bb, f.x), mix(c, d, f.x), f.y);
}
// x how much of the ground is covered (0..1) | y deposit depth (m) | z release scar | w how fresh (1 = moving now)
vec4 flowAt(vec2 xz) {
  vec2 f = (xz - uFlowWin.xy) / uFlowWin.w - .5;
  if (f.x < 0. || f.y < 0. || f.x > uFlowWin.z - 1.001 || f.y > uFlowWin.z - 1.001) return vec4(0.);
  vec2 i = floor(f), t = f - i; ivec2 b = ivec2(i); vec4 s = vec4(0.);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1); vec4 c = texelFetch(uFlow, b + o, 0);
    float w = (o.x == 1 ? t.x : 1. - t.x) * (o.y == 1 ? t.y : 1. - t.y), age = uTime - c.r, a = clamp(age / 2.5, 0., 1.);
    s += w * vec4(a, a * c.g, a * c.b, a * exp(-max(age, 0.) / 14.));
  }
  return s;
}
// the one cell under a point: x seconds since the flow got there (negative: not yet) | y depth (m)
vec2 flowCell(vec2 xz) {
  vec2 f = (xz - uFlowWin.xy) / uFlowWin.w;
  if (f.x < 0. || f.y < 0. || f.x >= uFlowWin.z || f.y >= uFlowWin.z) return vec2(-1e6, 0.);
  vec4 c = texelFetch(uFlow, ivec2(f), 0); return vec2(uTime - c.r, c.g);
}
float terrainH(vec2 xz, float cell) {
  vec2 b = hfBase(xz);
  float d = 7. * (1. - smoothstep(.3, .6, cell / 97.)) * (vn(xz / 97. + vec2(13.7, 4.1)) - .5)
          + 3. * (1. - smoothstep(.3, .6, cell / 41.)) * (vn(xz / 41. + vec2(71.3, 29.9)) - .5)
          + 1.2 * (1. - smoothstep(.3, .6, cell / 17.)) * (vn(xz / 17. + vec2(5.5, 88.2)) - .5);
  vec4 fl = flowAt(xz);
  return b.x + b.y * d + fl.y * 1.5 - fl.z * 2.4;
}
vec3 lit(vec3 alb, vec3 n, float sh, float ao) {
  float nl = max(dot(n, uSun), 0.), up = n.y * .5 + .5;
  return alb * (uSunCol * nl * sh + mix(uGndCol, uSkyCol, up) * ao + uFlash * vec3(.9, .95, 1.15) * up);
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 rd = wp - cameraPosition; float d = length(rd); rd /= max(d, 1e-3);
  float t = uFog.y * rd.y * d, integ = abs(t) < 1e-3 ? d : d * (1. - exp(-t)) / t;
  float f = 1. - exp(-uFog.x * exp(-uFog.y * max(cameraPosition.y, 0.)) * integ);
  float cl = uFog.w * smoothstep(uFog.z - 70., uFog.z + 150., wp.y) * smoothstep(60., 900., d);
  cl = max(cl, uFog.w * smoothstep(uFog.z - 40., uFog.z + 120., cameraPosition.y) * (1. - exp(-d / 90.)));
  f = max(f, cl);
  vec3 fc = uFogCol + uSunCol * .12 * pow(max(dot(rd, uSun), 0.), 6.) + uFlash * vec3(.35, .4, .5);
  return mix(col, fc, clamp(f, 0., 1.));
}
vec3 finish(vec3 c) { c *= uExposure; c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14); return pow(clamp(c, 0., 1.), vec3(1. / 2.2)); }
`;

const TERRAIN_VERT = /* glsl */`
${COMMON}
uniform vec2 uSnap; uniform float uS, uClipOut;
varying vec3 vW, vN; varying float vCell;
void main() {
  vec2 w = uSnap + position.xz * uS;
  vec2 dc = abs(w - cameraPosition.xz); float d = max(dc.x, dc.y);
  float k = smoothstep(.72 * uClipOut, .94 * uClipOut, d);
  w -= fract(position.xz * .5) * 2. * uS * k;                       // odd vertices slide onto the next ring's lattice
  float cell = uS * (1. + k), e = max(cell * .5, 1.5);
  float h = terrainH(w, cell), hx = terrainH(w + vec2(e, 0.), cell), hz = terrainH(w + vec2(0., e), cell);
  vN = normalize(vec3(h - hx, e, h - hz)); vW = vec3(w.x, h, w.y); vCell = cell;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;

const TERRAIN_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uLand, uBake, uDet, uMask;
uniform vec4 uMaskWin;                        // world x, z of the corner | size (m) | on
uniform float uClipIn, uClipOut;
varying vec3 vW, vN; varying float vCell;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 dc = abs(vW.xz - cameraPosition.xz); float dcam = max(dc.x, dc.y);
  if (dcam > uClipOut || dcam <= uClipIn) discard;
  vec2 xz = vW.xz; float dist = distance(vW, cameraPosition);
  vec4 dA = texture2D(uDet, xz / 61.), dB = texture2D(uDet, xz / 420.), dD = texture2D(uDet, xz / 2300.);
  vec4 dC = mix(texture2D(uDet, mat2(.8, .6, -.6, .8) * xz / 12.7), texture2D(uDet, xz / 43. + .37).gbar, .5);       // fine grain, two turned layers so it never reads as tiles
  // a repeating texture seen from high up shows its repeat as a grid: each layer fades to its mean before its tile gets small
  dC = mix(vec4(.5), dC, 1. - smoothstep(90., 420., dist)); dA = mix(vec4(.5), dA, 1. - smoothstep(500., 2200., dist)); dB = mix(vec4(.5), dB, 1. - smoothstep(4000., 14000., dist));
  vec2 uv = (xz + uHalf + (dA.rg - .5) * 46. + (dB.rg - .5) * 90.) / (uHalf * 2.);
  vec4 lc = texture2D(uLand, uv);
  vec4 bk = texture2D(uBake, (xz + uHalf) / (uHalf * 2.));
  vec3 n = normalize(vN); float slope = 1. - n.y;
  float near1 = 1. - smoothstep(180., 900., dist), near2 = 1. - smoothstep(20., 110., dist);

  float wW = smoothstep(.45, .6, lc.b) * (1. - smoothstep(.02, .07, slope));
  float wF = lc.r * (1. - wW), wB = lc.g * (1. - wF), wU = lc.a * (1. - wW), wFld = clamp(1. - wF - wB - wU - wW, 0., 1.);
  wFld *= 1. - smoothstep(.05, .16, slope); float wScrub = clamp(1. - wF - wB - wU - wW - wFld, 0., 1.);

  // forest: crowns catch the light, the gaps between them fall dark
  vec2 cuv = xz / 21.; float crown = texture2D(uDet, cuv).b;
  vec2 cg = vec2(texture2D(uDet, cuv + vec2(.004, 0.)).b, texture2D(uDet, cuv + vec2(0., .004)).b) - crown;
  float leaf = dC.a;
  vec3 forest = mix(vec3(.022, .052, .02), vec3(.062, .118, .03), dB.r * .7 + dD.g * .3);
  forest = mix(forest, vec3(.026, .058, .036), smoothstep(.45, .7, dB.g));                // stands of pine
  forest *= .5 + .95 * mix(.55, crown, near1) + (leaf - .5) * .5 * near2;
  vec3 scrub = mix(vec3(.07, .11, .035), vec3(.15, .16, .06), dA.r) * (.8 + .4 * dC.r);
  // the 2025 burn scar: char and ash, a year of green coming back through it
  vec3 burn = mix(vec3(.06, .05, .042), vec3(.13, .115, .095), dA.g);
  burn = mix(burn, vec3(.085, .13, .04), smoothstep(.42, .7, dA.r + (dC.r - .5) * .5) * .75) * (.75 + .5 * dC.a);
  vec3 bare = mix(vec3(.13, .125, .115), vec3(.21, .195, .17), dA.g * .6 + dB.r * .4) * (.8 + .4 * dC.r);
  // valley floor: rice and vegetable plots, each its own shade, bunds between
  vec2 q = mat2(.8, -.6, .6, .8) * xz / vec2(46., 78.) + (dB.rg - .5) * .5; vec2 pid = floor(q), pf = fract(q); float ph = h21(pid);
  vec3 field = mix(vec3(.085, .16, .04), vec3(.2, .23, .07), ph);
  field = ph > .82 ? vec3(.2, .15, .1) : (ph < .14 ? vec3(.05, .09, .065) : field);
  float bund = smoothstep(0., .035, pf.x) * smoothstep(1., .965, pf.x) * smoothstep(0., .022, pf.y) * smoothstep(1., .978, pf.y);
  float pnear = 1. - smoothstep(600., 2600., dist);
  field *= mix(1., mix(.55, 1., bund), pnear) * (.9 + .2 * sin(q.x * 46. * 3.3) * near2) * (.85 + .3 * dC.r);
  vec3 alb = forest * wF + burn * wB + bare * wU + field * wFld + scrub * wScrub;

  float rk = smoothstep(.2, .36, slope) * (1. - wF * .55);
  alb = mix(alb, vec3(.22, .21, .19) * (.55 + .9 * dC.r) * (.8 + .4 * dA.g), rk);
  vec3 n2 = normalize(n + vec3(-cg.x, 0., -cg.y) * 5. * wF * near1 + vec3(dC.r - .5, 0., dC.g - .5) * .5 * near2 * (1. - wW));
  float ao = bk.g * mix(1., .55 + .6 * crown, wF * near1), spec = .03 * uWet, gloss = 30.;

  // roads and yards, painted in from the local map
  vec2 mu = (xz - uMaskWin.xy) / uMaskWin.z;
  if (uMaskWin.w > .5 && mu.x > 0. && mu.y > 0. && mu.x < 1. && mu.y < 1.) {
    vec4 m = texture2D(uMask, mu); vec2 ed = min(mu, 1. - mu); float fade = smoothstep(0., .04, min(ed.x, ed.y));
    float pad = smoothstep(.25, .7, m.b) * fade, road = smoothstep(.3, .62, m.r) * fade;
    alb = mix(alb, vec3(.27, .25, .22) * (.88 + .24 * dC.r), pad * .85);
    alb = mix(alb, vec3(.075, .077, .082) * (.85 + .3 * dC.a), road);
    alb = mix(alb, vec3(.55, .5, .32), road * smoothstep(.45, .8, m.g) * near1 * .7);       // lane dashes on the main roads
    spec = mix(spec, .22 * uWet + .02, road); n2 = normalize(mix(n2, n, max(road, pad)));
    ao = mix(ao, bk.g, max(road, pad));
  }
  alb *= mix(1., .7, uWet) * mix(1., .76 + .48 * texture2D(uDet, xz / 1.9).a, near2 * (1. - wW));

  // debris flow: wet granite soil running downhill, a pale scar where it let go
  vec4 fl = flowAt(xz);
  if (fl.x > .002) {
    vec2 down = normalize(n.xz + 1e-4);
    vec2 fuv = xz / 13. - down * uTime * .32 * fl.w;
    float st = texture2D(uDet, fuv).r, st2 = texture2D(uDet, fuv * 3.1 + .37).g, stones = smoothstep(.72, .8, texture2D(uDet, xz / 4.1 - down * uTime * .2 * fl.w).a);
    vec3 mud = mix(vec3(.105, .07, .042), vec3(.26, .185, .11), st * .7 + st2 * .3);
    mud = mix(mud, vec3(.36, .275, .17), fl.z * .8);                                        // the scar
    mud = mix(mud, vec3(.2, .19, .18), stones * .7);
    float m = smoothstep(.04, .42, fl.x + (st - .5) * .25);
    mud = mix(mud, vec3(.42, .37, .3), smoothstep(.25, .0, fl.x) * fl.w * .6);                // the front churns pale
    alb = mix(alb, mud, m); spec = mix(spec, .5, m * (.35 + .65 * fl.w)); gloss = mix(gloss, 70., m);
    n2 = normalize(mix(n2, n + vec3(st - .5, 0., st2 - .5) * .7, m)); ao = mix(ao, bk.g, m);
  }

  vec3 v = normalize(cameraPosition - vW);
  vec3 col = lit(alb, n2, mix(1., bk.r, uShadowK), ao);
  if (wW > .01) {                                                                             // lakes, rivers, the East Sea
    vec2 r1 = texture2D(uDet, xz / 37. + uTime * vec2(.011, .007)).rg - .5, r2 = texture2D(uDet, xz / 9. - uTime * vec2(.02, .013)).rg - .5;
    float wk = 1. - smoothstep(150., 900., dist);
    vec3 wn = normalize(vec3((r1.x + r2.x * .5) * .22 * wk, 1., (r1.y + r2.y * .5) * .22 * wk));
    float fr = .03 + .97 * pow(1. - max(dot(wn, v), 0.), 5.);
    float rings = smoothstep(.78, .95, texture2D(uDet, xz / 2.6 + uTime * vec2(.31, .17)).b) * uWet * near2;                // rain on the water
    vec3 water = mix(vec3(.012, .03, .036) * (uSkyCol + .25), mix(uFogCol * .5, uFogCol * .9, fr) + rings * .12, fr * .85 + .15) + uSunCol * pow(max(dot(wn, normalize(v + uSun)), 0.), 220.) * 1.6;
    col = mix(col, water, wW); spec *= 1. - wW;
  }
  col += uSunCol * spec * pow(max(dot(n2, normalize(v + uSun)), 0.), gloss) + mix(uGndCol, uSkyCol, .8) * spec * .5 * pow(1. - max(dot(n2, v), 0.), 4.);
  gl_FragColor = vec4(finish(applyFog(col, vW)), 1.);
}`;

export class Land {
  constructor(meta, hbytes, img, renderer) {
    const g = meta.grid, C = this.cols = g.h80[1], R = this.rows = g.h80[0];
    this.W = g.w_km * 1000; this.H = g.h_km * 1000; this.hx = this.W / 2; this.hz = this.H / 2;
    const h16 = new Uint16Array(hbytes.buffer, hbytes.byteOffset, C * R), hf = this.hf = new Float32Array(C * R * 2), sc = g.height_scale;
    for (let i = 0; i < C * R; i++) hf[i * 2] = h16[i] / sc;
    // where the fine relief may show: slopes, not valley floors or water
    const rough = new Float32Array(C * R);
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const q = i * C + j, a = hf[(i * C + Math.min(j + 1, C - 1)) * 2] - hf[(i * C + Math.max(j - 1, 0)) * 2], b = hf[(Math.min(i + 1, R - 1) * C + j) * 2] - hf[(Math.max(i - 1, 0) * C + j) * 2];
      rough[q] = sstep(.05, .3, Math.hypot(a, b) / 160) * sstep(.5, 6, hf[q * 2]);
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      let s = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += rough[clamp(i + a, 0, R - 1) * C + clamp(j + b, 0, C - 1)];
      hf[(i * C + j) * 2 + 1] = s / 9;
    }
    const rnd = rng(20260718), nz = this.nz = new Uint8Array(256 * 256); for (let i = 0; i < nz.length; i++) nz[i] = rnd() * 256;
    this._wx = new Float64Array(4); this._wz = new Float64Array(4);

    const tex = (data, w, h, fmt, type, lin) => { const t = new THREE.DataTexture(data, w, h, fmt, type); if (lin) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } t.needsUpdate = true; return t; };
    const tHF = tex(hf, C, R, THREE.RGFormat, THREE.FloatType), tNz = tex(nz, 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
    const tLand = tex(this.classify(img), this.lw, this.lh, THREE.RGBAFormat, THREE.UnsignedByteType, true);
    const tBake = tex(this.bake(), C, R, THREE.RGBAFormat, THREE.UnsignedByteType, true);
    const tDet = this.tDet = tex(detail(rnd), 512, 512, THREE.RGBAFormat, THREE.UnsignedByteType, true); tDet.wrapS = tDet.wrapT = THREE.RepeatWrapping;

    // shared by every material in drone mode
    this.U = {
      uHF: { value: tHF }, uNz: { value: tNz }, uFlow: { value: null }, uHalf: { value: new THREE.Vector2(this.hx, this.hz) }, uHFSize: { value: new THREE.Vector2(C, R) },
      uFlowWin: { value: new THREE.Vector4(0, 0, 512, 10) }, uTime: { value: 0 }, uFlash: { value: 0 }, uExposure: { value: 1 }, uWet: { value: 1 }, uShadowK: { value: .3 },
      uSun: { value: new THREE.Vector3(-.66, .42, .62).normalize() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(.4, .45, .5) }, uGndCol: { value: new THREE.Color(.1, .1, .09) },
      uFogCol: { value: new THREE.Color(.4, .43, .47) }, uFog: { value: new THREE.Vector4(3e-4, 1 / 900, 620, 1) }, uDet: { value: tDet },
    };
    this.TU = { uLand: { value: tLand }, uBake: { value: tBake }, uMask: { value: null }, uMaskWin: { value: new THREE.Vector4(0, 0, 1, 0) } };

    // the clipmap
    const N = 128, n1 = N + 1, pos = new Float32Array(n1 * n1 * 3), full = [], holed = [];
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) { const q = (j * n1 + i) * 3; pos[q] = i - N / 2; pos[q + 2] = j - N / 2; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1, gi = i - N / 2, gj = j - N / 2;
      full.push(a, c, b, b, c, d);
      if (Math.max(Math.abs(gi), Math.abs(gi + 1), Math.abs(gj), Math.abs(gj + 1)) > 27) holed.push(a, c, b, b, c, d);
    }
    const geo = (idx) => { const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gm.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1)); return gm; };
    const gFull = geo(full), gHoled = geo(holed);
    this.group = new THREE.Group(); this.levels = [];
    const S0 = 4, L = 10;
    for (let l = 0; l < L; l++) {
      const s = S0 * 2 ** l, u = { ...this.U, ...this.TU, uSnap: { value: new THREE.Vector2() }, uS: { value: s }, uClipIn: { value: l ? 60 * s / 2 : -1 }, uClipOut: { value: l < L - 1 ? 60 * s : 1e9 } };
      const m = new THREE.Mesh(l ? gHoled : gFull, new THREE.ShaderMaterial({ uniforms: u, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG }));
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = l; this.group.add(m); this.levels.push({ s, u });
    }
  }

  update(cam) { for (const { s, u } of this.levels) u.uSnap.value.set(Math.floor(cam.x / (2 * s)) * 2 * s, Math.floor(cam.z / (2 * s)) * 2 * s); }

  vn(px, pz) {
    const ix = Math.floor(px), iz = Math.floor(pz); let fx = px - ix, fz = pz - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const nz = this.nz, x0 = ix & 255, x1 = (ix + 1) & 255, z0 = (iz & 255) << 8, z1 = ((iz + 1) & 255) << 8;
    const a = nz[z0 | x0], b = nz[z0 | x1], c = nz[z1 | x0], d = nz[z1 | x1];
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) / 255;
  }
  // ground height in metres (the drawn surface, without debris on it)
  hAt(x, z) {
    const C = this.cols, R = this.rows, hf = this.hf, wx = this._wx, wz = this._wz;
    const fx = (x + this.hx) / 80 - .5, fz = (z + this.hz) / 80 - .5, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    wx[0] = ((-tx + 2) * tx - 1) * tx * .5; wx[1] = ((3 * tx - 5) * tx * tx + 2) * .5; wx[2] = ((-3 * tx + 4) * tx + 1) * tx * .5; wx[3] = (tx - 1) * tx * tx * .5;
    wz[0] = ((-tz + 2) * tz - 1) * tz * .5; wz[1] = ((3 * tz - 5) * tz * tz + 2) * .5; wz[2] = ((-3 * tz + 4) * tz + 1) * tz * .5; wz[3] = (tz - 1) * tz * tz * .5;
    let h = 0, r = 0;
    for (let a = 0; a < 4; a++) {
      const rr = clamp(iz - 1 + a, 0, R - 1) * C; let sh = 0, sr = 0;
      for (let b = 0; b < 4; b++) { const q = (rr + clamp(ix - 1 + b, 0, C - 1)) * 2; sh += wx[b] * hf[q]; sr += wx[b] * hf[q + 1]; }
      h += wz[a] * sh; r += wz[a] * sr;
    }
    return h + r * (7 * (this.vn(x / 97 + 13.7, z / 97 + 4.1) - .5) + 3 * (this.vn(x / 41 + 71.3, z / 41 + 29.9) - .5) + 1.2 * (this.vn(x / 17 + 5.5, z / 17 + 88.2) - .5));
  }
  normalAt(x, z, out, e = 2) { const h = this.hAt(x, z); return out.set(h - this.hAt(x + e, z), e, h - this.hAt(x, z + e)).normalize(); }
  // land cover at a point: [forest, burn, water, bare] 0..1
  lcAt(x, z, out) {
    const j = clamp(Math.floor((x + this.hx) / this.W * this.lw), 0, this.lw - 1), i = clamp(Math.floor((z + this.hz) / this.H * this.lh), 0, this.lh - 1), q = (i * this.lw + j) * 4, d = this.lc;
    out[0] = d[q] / 255; out[1] = d[q + 1] / 255; out[2] = d[q + 2] / 255; out[3] = d[q + 3] / 255; return out;
  }

  // Sentinel-2 false colour (SWIR, NIR, red) -> forest | burn scar | water | bare or built
  classify(img) {
    const w = this.lw = img.width, h = this.lh = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data, o = this.lc = new Uint8Array(w * h * 4);
    for (let q = 0; q < d.length; q += 4) {
      const r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255, gn = g - Math.max(r, b), lum = (r + g + b) / 3;
      const water = sstep(.34, .24, lum) * (b >= g * .9 ? 1 : 0), forest = sstep(.2, .4, gn) * (1 - water);
      const burn = (1 - forest) * sstep(.05, .14, r - b) * sstep(0, .08, gn) * (1 - water), bare = sstep(-.01, -.11, gn) * (1 - water);
      o[q] = forest * 255; o[q + 1] = burn * 255; o[q + 2] = water * 255; o[q + 3] = bare * 255;
    }
    return o;
  }
  // R: is the low sun on this cell or is a ridge in the way | G: how open the cell is to the sky
  bake() {
    const C = this.cols, R = this.rows, hf = this.hf, o = new Uint8Array(C * R * 4), sx = -.66, sz = .62, tan = .42 / Math.hypot(sx, sz), il = 1 / Math.hypot(sx, sz), dx = sx * il, dz = sz * il;
    const ring = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2], [7, 0], [-7, 0], [0, 7], [0, -7]];
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const h0 = hf[(i * C + j) * 2]; let sh = 1;
      for (let s = 1; s <= 22 && sh > 0; s++) {
        const jj = Math.round(j + dx * s), ii = Math.round(i + dz * s); if (jj < 0 || ii < 0 || jj >= C || ii >= R) break;
        const over = hf[(ii * C + jj) * 2] - (h0 + 3 + s * 80 * tan); if (over > 0) sh = Math.min(sh, 1 - over / 28);
      }
      let a = 0; for (const [u, v] of ring) a += hf[(clamp(i + v, 0, R - 1) * C + clamp(j + u, 0, C - 1)) * 2];
      const q = (i * C + j) * 4; o[q] = Math.max(sh, 0) * 255; o[q + 1] = clamp(1 - Math.max(0, a / ring.length - h0) / 150, .42, 1) * 255; o[q + 3] = 255;
    }
    return o;
  }
}

// One tiling 512 px texture for all surface detail: R, G two cloudy noises | B round bumps (tree crowns) | A fine grain
function detail(rnd) {
  const S = 512, o = new Uint8Array(S * S * 4);
  const lat = (p) => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const fbm = () => {
    const oct = [4, 8, 16, 32, 64, 128].map((p) => [p, lat(p)]), out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0, amp = .5;
      for (const [p, a] of oct) {
        const fx = x / S * p, fy = y / S * p, ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x1 = (ix + 1) % p, y1 = (iy + 1) % p;
        v += amp * ((a[iy * p + ix] * (1 - tx) + a[iy * p + x1] * tx) * (1 - ty) + (a[y1 * p + ix] * (1 - tx) + a[y1 * p + x1] * tx) * ty); amp *= .5;
      }
      out[y * S + x] = v;
    }
    let lo = 1, hi = 0; for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); } for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  };
  const A = fbm(), B = fbm(), G = 20, cs = S / G, pts = new Float32Array(G * G * 3);
  for (let i = 0; i < G * G; i++) { pts[i * 3] = rnd(); pts[i * 3 + 1] = rnd(); pts[i * 3 + 2] = .7 + rnd() * .6; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = Math.floor(x / cs), gy = Math.floor(y / cs); let best = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const cx = gx + b, cy = gy + a, k = (((cy % G) + G) % G * G + ((cx % G) + G) % G) * 3;
      const d = Math.hypot((cx + pts[k]) * cs - x, (cy + pts[k + 1]) * cs - y) / (cs * pts[k + 2]); if (d < best) best = d;
    }
    const q = (y * S + x) * 4, dome = Math.sqrt(Math.max(0, 1 - Math.min(1, best * 1.15) ** 2));
    o[q] = A[y * S + x] * 255; o[q + 1] = B[y * S + x] * 255; o[q + 2] = dome * 255; o[q + 3] = rnd() * 255;
  }
  return o;
}
