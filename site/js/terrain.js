import * as THREE from 'three';
import { fetchBin } from './data.js';

// Colour ramps: one source for both the shader and the legends (sRGB hex stops).
export const RAMPS = {
  suscept: ['#17120f', '#4a2413', '#9a3d18', '#e8662c', '#ffb884'],
  burn: ['#171116', '#4a1b33', '#96305a', '#d55181', '#ffadcb'],
  move: ['#8ec0f7', '#3987e5', '#27507f', '#383835', '#8a3434', '#e34948', '#f7a0a0'],
  coh: ['#101616', '#17403b', '#199e70', '#9aecd0'],
};
const RAMP_ROWS = ['suscept', 'burn', 'move', 'coh'];
export const LEVEL_COLORS = ['#7a7a76', '#4f8494', '#fab219', '#f0503c'];
export const TRACK_COLORS = ['#3987e5', '#d95926', '#199e70'];

function rampTexture() {
  const data = new Uint8Array(256 * RAMP_ROWS.length * 4);
  RAMP_ROWS.forEach((name, r) => {
    const stops = RAMPS[name].map((h) => new THREE.Color().setStyle(h, THREE.SRGBColorSpace).convertLinearToSRGB());
    for (let i = 0; i < 256; i++) {
      const f = (i / 255) * (stops.length - 1), a = Math.min(f | 0, stops.length - 2), t = f - a;
      const c = stops[a].clone().lerp(stops[a + 1], t), k = (r * 256 + i) * 4;
      data[k] = c.r * 255; data[k + 1] = c.g * 255; data[k + 2] = c.b * 255; data[k + 3] = 255;
    }
  });
  const t = new THREE.DataTexture(data, 256, RAMP_ROWS.length, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// The floor under the map. The nationwide map fades its sea into exactly this, so the country has no box around it.
const FLOOR_GLSL = /* glsl */`
float gridL(vec2 p, float s) { vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y), 1.0); }
vec3 floorCol(vec2 p, float a) { return vec3(0.012, 0.02, 0.028) * a + vec3(0.05, 0.09, 0.11) * (gridL(p, 10.0) * 0.5 + gridL(p, 50.0)) * a * 0.35; }`;

const VERT = /* glsl */`
uniform float uExag;
varying vec2 vUv; varying float vH; varying vec3 vW;
void main() {
  vUv = uv; vH = position.y;
  vec3 p = position; p.y *= uExag;
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D tNormal, tUnitId, tA, tB, tC, tRamp, tImgA, tImgB, tRadar, tCoast;
uniform vec2 uSize40, uHalf;
uniform float uHalo;
uniform int uMode, uTrack;
uniform float uK, uExag, uTime, uOverlay, uImgMix, uImgOn, uRadarOn, uSel, uHover, uCounty, uMoveScale, uEdges, uRevealOn, uRevealP;
uniform vec2 uScanO[3], uScanD[3], uRevealO, uRevealD;
uniform float uScanP[3], uScanI[3];
uniform vec3 uScanC[3], uLevelC[4], uFog;
varying vec2 vUv; varying float vH; varying vec3 vW;

${FLOOR_GLSL}
vec3 ramp(float row, float v) { return texture2D(tRamp, vec2(clamp(v, 0.002, 0.998), (row + 0.5) / 4.0)).rgb; }
float unitId(vec2 uv) {
  vec4 t = texelFetch(tUnitId, ivec2(clamp(uv, 0.0, 0.99999) * uSize40), 0);
  return floor(t.r * 255.0 + 0.5) + floor(t.g * 255.0 + 0.5) * 256.0 + floor(t.b * 255.0 + 0.5) * 65536.0;
}
float hatch() { return step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0)); }

// colour (rgb, alpha) of the unit under uv for the current layer; e = extra glow
vec4 unitColor(vec2 uv, out float glow) {
  glow = 0.0;
  float id = unitId(uv);
  if (id < 0.5 || uMode == 0 || uMode == 6) return vec4(0.0);
  ivec2 q = ivec2(int(mod(id, 1024.0)), int(floor(id / 1024.0)));
  vec4 A = texelFetch(tA, q, 0), B = vec4(0.0), C = vec4(0.0);          // this runs four times per pixel, so only read what the layer uses
  if (uCounty > 0.5) B = texelFetch(tB, q, 0);
  if (uMode == 3 || uMode == 5) C = texelFetch(tC, q, 0);
  vec4 c = vec4(0.0);
  if (uMode == 1) {
    int l = int(A.r + 0.5);
    if (l == 3) { float ph = fract(id * 0.618034); float pu = 0.5 + 0.5 * sin(uTime * 2.2 + ph * 6.2832); c = vec4(uLevelC[3], 0.93); glow = 0.25 + 0.55 * pu; }
    else if (l == 2) c = vec4(uLevelC[2] * 0.82, 0.5);
    else if (l == 1) c = vec4(uLevelC[1], 0.13);
    else c = vec4(uLevelC[0], 0.5 * hatch());
    if (A.a > 0.5 && l >= 2) glow += 0.35;
  } else if (uMode == 2) {
    float v = smoothstep(0.45, 1.0, A.g);
    c = vec4(ramp(0.0, pow(A.g, 2.2)), 0.2 + 0.75 * v);
  } else if (uMode == 3) {
    float val = uTrack == 0 ? C.r : (uTrack == 1 ? C.g : C.b);
    if (val < -900.0) c = vec4(uLevelC[0], 0.4 * hatch());
    else if (val > 900.0) c = vec4(0.0);
    else { float v = clamp(val / uMoveScale, -1.0, 1.0); c = vec4(ramp(2.0, v * 0.5 + 0.5), 0.3 + 0.65 * smoothstep(0.1, 0.8, abs(v))); glow = smoothstep(0.85, 1.0, abs(v)) * 0.4; }
  } else if (uMode == 4) {
    float v = clamp(A.b / 0.8, 0.0, 1.0);
    c = vec4(ramp(1.0, v), smoothstep(0.06, 0.34, v) * 0.92);
  } else if (uMode == 5) {
    if (C.a < 0.0) c = vec4(0.0); else c = vec4(ramp(3.0, C.a), 0.88);
  }
  if (uCounty > 0.5 && abs(B.a - uCounty) > 0.5) { c.a *= 0.1; glow = 0.0; }
  return c;
}

void main() {
  vec2 uv = vUv;
  vec4 nt = texture2D(tNormal, uv);
  vec2 g = (nt.xy - 0.5) * 2.4;
  vec3 N = normalize(vec3(g.x * uExag, 1.0, -g.y * uExag));
  vec3 L = normalize(vec3(-0.52, 0.66, -0.54));
  float diff = max(dot(N, L), 0.0);
  float fill = max(dot(N, normalize(vec3(0.6, 0.5, 0.6))), 0.0);
  float ao = 1.0 - clamp((nt.z - 0.5) * 1.6, -0.25, 0.35);
  float shade = (0.2 + 1.05 * diff + 0.14 * fill) * ao;

  // base terrain: cold slate, a little lighter with height
  float hm = vH * 1000.0 * uK;
  float land = texelFetch(tUnitId, ivec2(clamp(uv, 0.0, 0.99999) * uSize40), 0).a;   // 1 inside the map, 0.5 another country, 0 sea
  vec3 base = mix(vec3(0.012, 0.03, 0.042), vec3(0.05, 0.085, 0.1), smoothstep(40.0, 420.0, hm));
  base = mix(base, vec3(0.16, 0.19, 0.2), smoothstep(380.0, 1150.0, hm));
  bool sea = hm < 0.6 || land < 0.25;
  bool abroad = land > 0.25 && land < 0.75;
  if (sea) {
    float w = sin(uv.x * 900.0 / uK + uTime * 0.6) * sin(uv.y * 700.0 / uK - uTime * 0.45);
    base = vec3(0.004, 0.016, 0.03) + 0.006 * w * (1.0 - uHalo); shade = 1.0;
  }
  // nationwide: 0 on South Korean land, 1 about 100 km out. The sea is lighter at the shore and everything
  // off the map (open sea, North Korea, Japan) dissolves into the floor instead of ending at a box.
  float cd = uHalo > 0.5 ? texture2D(tCoast, uv).r : 0.0;
  vec3 fl = floorCol(vW.xz, 1.0);
  if (sea && uHalo > 0.5) base = mix(vec3(0.016, 0.052, 0.082), vec3(0.01, 0.03, 0.05), smoothstep(0.0, 0.45, cd));
  if (abroad) { base = mix(vec3(0.028, 0.034, 0.038), vec3(0.03, 0.036, 0.042), uHalo); shade = 1.0; sea = true; }      // outside South Korea: flat, no data
  vec3 col = base * shade;

  // imagery (Sentinel-2 false colour), cross-faded between two dates
  if (uImgOn > 0.001 && !(abroad || (sea && uK > 1.5))) {
    vec3 img = mix(texture2D(tImgA, uv).rgb, texture2D(tImgB, uv).rgb, uImgMix);
    col = mix(col, img * (0.42 + 0.85 * diff) * ao, uImgOn);
  }

  // per-unit layer, 4 taps across the pixel footprint
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float gl0, gl1, gl2, gl3;
  vec4 o0 = unitColor(uv + 0.125 * dx + 0.375 * dy, gl0), o1 = unitColor(uv - 0.375 * dx + 0.125 * dy, gl1);
  vec4 o2 = unitColor(uv + 0.375 * dx - 0.125 * dy, gl2), o3 = unitColor(uv - 0.125 * dx - 0.375 * dy, gl3);
  float oa = (o0.a + o1.a + o2.a + o3.a) * 0.25;
  vec3 oc = (o0.rgb * o0.a + o1.rgb * o1.a + o2.rgb * o2.a + o3.rgb * o3.a) / max(oa * 4.0, 1e-4);
  float glow = (gl0 * o0.a + gl1 * o1.a + gl2 * o2.a + gl3 * o3.a) / max(oa * 4.0, 1e-4);
  float reveal = 1.0;
  if (uRevealOn > 0.5) reveal = 1.0 - smoothstep(-3.0, 0.0, dot(vW.xz - uRevealO, uRevealD) - uRevealP);
  float k = oa * uOverlay * reveal * (sea ? 0.0 : 1.0);
  col = mix(col, oc * (0.4 + 0.8 * min(shade, 1.25)), k);
  col += oc * glow * k * 0.55;

  // interferogram raster for the pair that spans the storm
  if (uRadarOn > 0.001 && !abroad) {
    vec4 r = texture2D(tRadar, uv);
    vec3 fr = 0.5 + 0.5 * cos(6.2832 * (r.r + vec3(0.0, 0.33, 0.67)));
    col = mix(col, fr * fr * (0.12 + 0.95 * r.g * r.g) * (0.55 + 0.6 * diff), uRadarOn * step(0.5, r.a) * 0.92);
  }

  // hexagon outlines when close, selection and hover
  float idc = unitId(uv);
  vec2 tex = 1.0 / uSize40;
  float fp = max(length(dx * uSize40), length(dy * uSize40));
  float near = 1.0 - smoothstep(0.18, 0.6, fp);
  if ((near > 0.0 || idc == uSel || idc == uHover) && idc > 0.5) {
    vec2 f = fract(uv * uSize40);
    float wl = clamp(fp * 1.3, 0.07, 0.5);
    float e = 0.0;
    if (unitId(uv + vec2(tex.x, 0.0)) != idc) e = max(e, smoothstep(1.0 - wl, 1.0, f.x));
    if (unitId(uv - vec2(tex.x, 0.0)) != idc) e = max(e, 1.0 - smoothstep(0.0, wl, f.x));
    if (unitId(uv + vec2(0.0, tex.y)) != idc) e = max(e, smoothstep(1.0 - wl, 1.0, f.y));
    if (unitId(uv - vec2(0.0, tex.y)) != idc) e = max(e, 1.0 - smoothstep(0.0, wl, f.y));
    col = mix(col, col * 0.35, e * near * 0.7 * uEdges);
    if (idc == uSel) { col = mix(col, vec3(1.0), 0.1 + 0.06 * sin(uTime * 4.0)); col += vec3(1.6, 1.9, 2.2) * e; }
    else if (idc == uHover) { col = mix(col, vec3(1.0), 0.1); col += vec3(0.7) * e; }
  }

  // radar scan lines
  for (int i = 0; i < 3; i++) {
    if (uScanI[i] <= 0.001) continue;
    float d = dot(vW.xz - uScanO[i], uScanD[i]) - uScanP[i];
    float line = exp(-d * d / 0.09);
    float trail = d < 0.0 ? exp(d / 9.0) : 0.0;
    float rng = dot(vW.xz - uScanO[i], vec2(-uScanD[i].y, uScanD[i].x));
    float ticks = 0.5 + 0.5 * step(0.5, fract(rng * 0.9 + d * 0.3));
    col += uScanC[i] * uScanI[i] * (line * 2.6 + trail * 0.22 * ticks * (0.4 + diff));
  }

  float dist = length(cameraPosition - vW);
  col = mix(col, uFog, smoothstep(140.0, 520.0, dist) * 0.85);
  if (sea && uHalo > 0.5) {
    vec2 ed = (0.5 - abs(uv - 0.5)) * 2.0 * uHalf;                         // scene units in from the edge of the grid
    float keep = (1.0 - smoothstep(0.0, 1.0, cd)) * smoothstep(0.0, 6.0, min(ed.x, ed.y));
    if (abroad) keep *= keep * 0.8;                                         // other countries: fainter still, there is no data there
    col = mix(fl, col, keep);
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

export class Terrain {
  constructor(D, quality) {
    this.D = D;
    const { W80, H80, h, n } = D, Wkm = D.Ws, Hkm = D.Hs;
    // regional: 160 m mesh by default (0.65 M triangles), ultra 80 m. Nationwide: 1.1 km by default (0.75 M), ultra 720 m.
    const s = D.korea ? (quality === 'low' ? 4 : (quality === 'ultra' ? 2 : 3)) : (quality === 'low' ? 3 : (quality === 'ultra' ? 1 : 2));
    const nx = Math.floor((W80 - 1) / s) + 1, nz = Math.floor((H80 - 1) / s) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    let maxH = 0;
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const jj = Math.min(j * s, W80 - 1), ii = Math.min(i * s, H80 - 1), k = i * nx + j;
      const u = (jj + 0.5) / W80, v = (ii + 0.5) / H80, hh = h[ii * W80 + jj];
      pos[k * 3] = (u - 0.5) * Wkm; pos[k * 3 + 1] = hh; pos[k * 3 + 2] = (v - 0.5) * Hkm;
      uv[k * 2] = u; uv[k * 2 + 1] = v; if (hh > maxH) maxH = hh;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let i = 0; i < nz - 1; i++) for (let j = 0; j < nx - 1; j++) {
      const a = i * nx + j, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(Wkm, Hkm) / 2 + 10);
    this.maxH = maxH;
    this.ext = [pos[0], pos[(nx - 1) * 3], pos[2], pos[(nz - 1) * nx * 3 + 2]];      // x0, x1, z0, z1 of the mesh

    // unit lookup textures (1024 wide, index = unit id, 0 = none)
    const TW = 1024, TH = Math.ceil((n + 1) / TW);
    this.TW = TW; this.TH = TH;
    const mk = () => { const a = new Float32Array(TW * TH * 4); const t = new THREE.DataTexture(a, TW, TH, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return [a, t]; };
    const [a, tA] = mk(), [b, tB] = mk(), [c, tC] = mk();
    const C = D.col;
    for (let u = 0; u < n; u++) {
      const k = (u + 1) * 4;
      a[k] = C.level[u]; a[k + 1] = C.pct[u]; a[k + 2] = Number.isFinite(C.dnbr[u]) ? C.dnbr[u] : 0; a[k + 3] = C.moving[u];
      b[k] = C.cum_125[u]; b[k + 1] = C.cum_032[u]; b[k + 2] = C.cum_024[u]; b[k + 3] = C.county[u];
      c[k] = c[k + 1] = c[k + 2] = 999; c[k + 3] = -1;
    }
    tA.needsUpdate = tB.needsUpdate = true;
    this.dyn = c; this.tC = tC;
    const tId = new THREE.DataTexture(D.unitid, D.W40, D.H40, THREE.RGBAFormat, THREE.UnsignedByteType);
    tId.minFilter = tId.magFilter = THREE.NearestFilter; tId.generateMipmaps = false; tId.needsUpdate = true;
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); blank.needsUpdate = true;
    this.blank = blank;
    const tex = (url, srgb) => {
      const t = new THREE.TextureLoader().load(url); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    };
    this.loadTex = tex;
    const lc = (h) => new THREE.Color().setStyle(h);
    this.uniforms = {
      tNormal: { value: tex('data/normal.jpg', false) }, tUnitId: { value: tId }, tA: { value: tA }, tB: { value: tB }, tC: { value: tC },
      tRamp: { value: rampTexture() }, tImgA: { value: blank }, tImgB: { value: blank }, tRadar: { value: blank },
      uSize40: { value: new THREE.Vector2(D.W40, D.H40) }, tCoast: { value: D.korea ? this.coastTexture() : blank }, uHalo: { value: D.korea ? 1 : 0 }, uHalf: { value: new THREE.Vector2(Wkm / 2, Hkm / 2) }, uMode: { value: 1 }, uTrack: { value: 0 }, uK: { value: D.k },
      uExag: { value: D.view.exag }, uTime: { value: 0 }, uOverlay: { value: 0.92 }, uImgMix: { value: 0 }, uImgOn: { value: 0 }, uRadarOn: { value: 0 },
      uSel: { value: -1 }, uHover: { value: -1 }, uCounty: { value: 0 }, uMoveScale: { value: 3 }, uEdges: { value: 1 },
      uRevealOn: { value: 0 }, uRevealP: { value: 0 }, uRevealO: { value: new THREE.Vector2() }, uRevealD: { value: new THREE.Vector2(0, -1) },
      uScanO: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uScanD: { value: [new THREE.Vector2(0, -1), new THREE.Vector2(0, -1), new THREE.Vector2(0, -1)] },
      uScanP: { value: [0, 0, 0] }, uScanI: { value: [0, 0, 0] },
      uScanC: { value: TRACK_COLORS.map(lc) }, uLevelC: { value: LEVEL_COLORS.map(lc) }, uFog: { value: lc('#05090d') },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG }));
    this.mesh.frustumCulled = false;
    this.images = {}; this.radar = {};
    this.group = new THREE.Group(); this.group.add(this.mesh, this.makeFloor());
    if (!D.korea) this.group.add(this.makeSkirt());            // the regional map is a cut block; the country floats on the floor
  }

  // Distance from South Korean land on a coarse grid (8 x 8 unit-id pixels), as a texture: 0 on land, 255 where the sea has
  // faded out. The mainland and big islands carry a wide band of sea (REACH); a lone islet only a small one, so the
  // open sea is not dotted with bubbles.
  coastTexture() {
    const D = this.D, S = 8, gw = Math.ceil(D.W40 / S), gh = Math.ceil(D.H40 / S), a = D.unitid, REACH = 16, REACH_ISLET = 3.5;
    const big = new Float32Array(gw * gh).fill(1e9), any = new Float32Array(gw * gh).fill(1e9);
    for (let i = 0; i < gh; i++) for (let j = 0; j < gw; j++) {
      let n = 0;
      for (let y = i * S; y < Math.min((i + 1) * S, D.H40); y += 2) for (let x = j * S; x < Math.min((j + 1) * S, D.W40); x += 2) if (a[(y * D.W40 + x) * 4 + 3] > 200) n++;
      if (n > 0) any[i * gw + j] = 0;
      if (n >= 12) big[i * gw + j] = 0;                                          // at least three quarters land
    }
    const O = 1, G = Math.SQRT2;
    const chamfer = (d) => {                                                     // two-pass distance, in cells
      const at = (i, j) => (i < 0 || j < 0 || i >= gh || j >= gw ? 1e9 : d[i * gw + j]);
      for (let i = 0; i < gh; i++) for (let j = 0; j < gw; j++) d[i * gw + j] = Math.min(d[i * gw + j], at(i, j - 1) + O, at(i - 1, j) + O, at(i - 1, j - 1) + G, at(i - 1, j + 1) + G);
      for (let i = gh - 1; i >= 0; i--) for (let j = gw - 1; j >= 0; j--) d[i * gw + j] = Math.min(d[i * gw + j], at(i, j + 1) + O, at(i + 1, j) + O, at(i + 1, j + 1) + G, at(i + 1, j - 1) + G);
    };
    chamfer(big); chamfer(any);
    const cell = D.Ws / gw, out = new Uint8Array(gw * gh);
    for (let k = 0; k < out.length; k++) out[k] = Math.min(255, Math.round(Math.min(big[k] * cell / REACH, any[k] * cell / REACH_ISLET) * 255));
    const t = new THREE.DataTexture(out, gw, gh, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  }

  makeSkirt() {
    const { W80, H80, h } = this.D, Wkm = this.D.Ws, Hkm = this.D.Hs;
    const pts = [];
    const P = (j, i) => [((j + 0.5) / W80 - 0.5) * Wkm, h[i * W80 + j], ((i + 0.5) / H80 - 0.5) * Hkm];
    const st = 2;
    for (let j = 0; j < W80; j += st) pts.push(P(j, 0));
    for (let i = 0; i < H80; i += st) pts.push(P(W80 - 1, i));
    for (let j = W80 - 1; j >= 0; j -= st) pts.push(P(j, H80 - 1));
    for (let i = H80 - 1; i >= 0; i -= st) pts.push(P(0, i));
    pts.push(pts[0]);
    const pos = new Float32Array(pts.length * 6), top = new Float32Array(pts.length * 2), idx = [];
    pts.forEach((p, k) => { pos.set([p[0], p[1], p[2], p[0], p[1], p[2]], k * 6); top[k * 2] = 1; top[k * 2 + 1] = 0; if (k < pts.length - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aTop', new THREE.BufferAttribute(top, 1)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uExag: this.uniforms.uExag }, side: THREE.DoubleSide,
      vertexShader: `uniform float uExag; attribute float aTop; varying float vY; varying float vT;
        void main(){ vec3 p = position; p.y = aTop > 0.5 ? p.y * uExag : -1.6; vY = p.y; vT = aTop; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `varying float vY; varying float vT;
        void main(){ float strata = 0.5 + 0.5 * step(0.5, fract(vY * 3.0)); vec3 c = mix(vec3(0.004,0.008,0.012), vec3(0.03,0.05,0.06) * (0.7 + 0.3 * strata), smoothstep(-1.6, 0.6, vY));
          c += vec3(0.25,0.1,0.04) * (1.0 - smoothstep(-1.6, -1.45, vY)) * 0.5; gl_FragColor = vec4(c, 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; return mesh;
  }

  makeFloor() {
    const g = new THREE.PlaneGeometry(1400, 1400); g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { uHalf: { value: new THREE.Vector2(this.D.Ws / 2, this.D.Hs / 2) }, uHole: { value: new THREE.Vector4(...this.ext) }, uFlat: { value: this.D.korea ? 1 : 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vP; uniform vec2 uHalf; uniform vec4 uHole; uniform float uFlat;
        ${FLOOR_GLSL}
        void main(){ vec2 d = max(abs(vP.xz) - uHalf, 0.0); float r = length(d);
          vec3 c = floorCol(vP.xz, exp(-r / 60.0));
          c += vec3(0.5, 0.2, 0.08) * exp(-r / 2.5) * 0.12 * (1.0 - uFlat);            // glow along the foot of the regional block
          // nationwide the floor is at sea level with a hole where the map is, so the two meet in one plane
          if (uFlat > 0.5 && vP.x > uHole.x + 0.03 && vP.x < uHole.y - 0.03 && vP.z > uHole.z + 0.03 && vP.z < uHole.w - 0.03) discard;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.position.y = this.D.korea ? 0 : -1.6; return mesh;
  }

  // ---- layer state -------------------------------------------------------------
  setImage(key, url) {                                       // cross-fade to a new image
    const u = this.uniforms;
    if (!this.images[key]) this.images[key] = this.loadTex(url, true);
    if (this.curImg === key) return;
    u.tImgA.value = u.uImgMix.value > 0.5 ? u.tImgB.value : u.tImgA.value;
    u.tImgB.value = this.images[key]; u.uImgMix.value = this.curImg ? 0 : 1; this.imgTarget = 1; this.curImg = key;
  }
  async setRadar(track) {
    if (!this.radar[track]) {
      const b = await fetchBin(`data/radar_${track}.bin.gz`);
      const t = new THREE.DataTexture(b, this.D.W80, this.D.H80, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; this.radar[track] = t;
    }
    this.uniforms.tRadar.value = this.radar[track];
  }
  // movement and coherence as of day t (step at each acquisition; nothing is interpolated between passes)
  setTime(day) {
    const D = this.D, key = D.tracks.map((tr) => tr.days.filter((d) => d <= day).length).join(',');
    if (key === this.timeKey) return; this.timeKey = key;
    const idx = key.split(',').map(Number), c = this.dyn, n = D.n, nd = D.nd, ser = D.series, coh = D.coh, tsel = this.uniforms.uTrack.value;
    for (let u = 0; u < n; u++) {
      const k = (u + 1) * 4;
      for (let t = 0; t < 3; t++) {
        if (idx[t] < 1) { c[k + t] = 999; continue; }
        const v = ser[(u * 3 + t) * nd + idx[t] - 1];
        c[k + t] = v === -32768 ? -999 : v / 100;
      }
      c[k + 3] = idx[tsel] < 2 ? -1 : coh[(u * 3 + tsel) * (nd - 1) + idx[tsel] - 2] / 255;
    }
    this.tC.needsUpdate = true;
  }
  update(dt, t) {
    const u = this.uniforms; u.uTime.value = t;
    if (this.imgTarget !== undefined) u.uImgMix.value = Math.min(1, u.uImgMix.value + dt / 0.9);
  }

  // ---- picking: march the ray against the height field ---------------------------
  pick(origin, dir) {
    const D = this.D, ex = this.uniforms.uExag.value, top = this.maxH * ex + 0.01;
    let t0 = 0, t1 = 900;
    if (dir.y < 0) { if (origin.y > top) t0 = (top - origin.y) / dir.y; t1 = Math.min(t1, (0 - origin.y) / dir.y + 1); } else if (origin.y > top) return null;
    const hx = D.Ws / 2, hz = D.Hs / 2;
    let t = t0, prev = t0, step = 0.06;
    for (let i = 0; i < 4000 && t < t1; i++) {
      const x = origin.x + dir.x * t, z = origin.z + dir.z * t, y = origin.y + dir.y * t;
      if (Math.abs(x) <= hx && Math.abs(z) <= hz && y <= D.hAt(x, z) * ex) {
        let a = prev, b = t;
        for (let k = 0; k < 10; k++) { const m = (a + b) / 2, mx = origin.x + dir.x * m, mz = origin.z + dir.z * m; if (origin.y + dir.y * m <= D.hAt(mx, mz) * ex) b = m; else a = m; }
        const px = origin.x + dir.x * b, pz = origin.z + dir.z * b;
        return { x: px, z: pz, y: D.hAt(px, pz) * ex, unit: D.unitAt(px, pz) };
      }
      prev = t; t += step * (1 + t * 0.004);
    }
    return null;
  }
}
