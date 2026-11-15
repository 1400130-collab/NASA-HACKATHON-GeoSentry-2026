import * as THREE from 'three';
import { fetchBin } from './data.js?v=3';

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

// shared with the trees (world.js), which the flows knock down
export const DEB_GLSL = /* glsl */`
// ---- simulated debris flows (fx.js Debris), painted into the ground so they follow it exactly and cost no extra draw ----
// One texture (the ground shader has no texture units to spare), all read texel by texel except the far-view part:
//   page A, rows 0..: per 10 m cell R arrival (0.5 s), G deepest depth (2 cm), B + A flow number + 1, A bit 0 = best-fit case too
//   page B, rows uDebPB..: R outline (cover blurred over 3 x 3 cells, so the edge is a smooth curve, not 10 m steps),
//     G the same for the best-fit case, B + A position across the flow (cells from its centre line, 1/256 steps, +128)
//   rows uDebIY..: one texel per 8 x 8 block of cells, pointing at that block in the pages (0 = nothing there)
//   bottom rows (uDebCR maps cells there), filtered: per block R share covered, G earliest start (s), B best-fit share, A depth
uniform sampler2D tDebA;
uniform int uDebAW, uDebIY, uDebPB;
uniform vec2 uDebN;
uniform vec3 uDebX, uDebZ;
uniform vec4 uDebCR;
uniform float uDebOn, uDebT, uDebSpread, uDebSel, uDebSelT;

// x 1 if a flow covers the cell, y seconds since it got there, z depth (1 = 1.5 m), w best-fit case too.
// dim < 1: another flow is replaying. tArr: when the flow got there (s). sm: page B (outline, best-fit outline, across).
vec4 debCell(ivec2 q, out float dim, out float tArr, out vec3 sm) {
  dim = 1.0; tArr = 0.0; sm = vec3(0.0);
  if (q.x < 0 || q.y < 0 || q.x >= int(uDebN.x) || q.y >= int(uDebN.y)) return vec4(0.0);
  vec4 I = texelFetch(tDebA, (q >> 3) + ivec2(0, uDebIY), 0);
  int ti = int(I.r * 255.0 + 0.5) + int(I.g * 255.0 + 0.5) * 256 - 1;
  if (ti < 0) return vec4(0.0);
  ivec2 at = ivec2((ti % uDebAW) * 8 + (q.x & 7), (ti / uDebAW) * 8 + (q.y & 7));
  vec4 b = texelFetch(tDebA, at + ivec2(0, uDebPB), 0);
  sm = vec3(b.r, b.g, (floor(b.b * 255.0 + 0.5) + floor(b.a * 255.0 + 0.5) * 256.0) / 256.0 - 128.0);
  vec4 c = floor(texelFetch(tDebA, at, 0) * 255.0 + 0.5);
  float id = c.b + floor(c.a * 0.5) * 256.0 - 1.0;
  if (id < 0.0) return vec4(0.0);
  bool sel = abs(id - uDebSel) < 0.5;
  if (uDebSel > -0.5 && !sel) dim = 0.35;
  tArr = c.r * 0.5;
  float since = sel ? uDebSelT - tArr : (uDebOn > 0.5 ? uDebT - fract(id * 0.618034) * uDebSpread - tArr : -1e3);
  return vec4(1.0, since, c.g / 75.0, mod(c.a, 2.0));
}`;

// ---- the slope layer: one colour per unit (hillside), looked up through the unit-id map. Shared by the ground shader and
// the bake that pre-filters it for the view from far away (BAKE defined: no screen-space hatching, no pulsing).
const UNIT_GLSL = /* glsl */`
uniform sampler2D tUnitId, tA, tB, tC, tD, tRamp;
uniform vec2 uSize40;
uniform int uMode, uTrack;
uniform float uRain, uTime, uCounty, uMoveScale;
uniform vec3 uLevelC[4];
vec3 ramp(float row, float v) { return texture2D(tRamp, vec2(clamp(v, 0.002, 0.998), (row + 0.5) / 4.0)).rgb; }
vec4 idTexel(ivec2 q) { return texelFetch(tUnitId, clamp(q, ivec2(0), ivec2(uSize40) - 1), 0); }
float idOf(vec4 t) { return floor(t.r * 255.0 + 0.5) + floor(t.g * 255.0 + 0.5) * 256.0 + floor(t.b * 255.0 + 0.5) * 65536.0; }
#ifdef BAKE
float hatch() { return 0.45; }                 // the hatching's average: from far away it is a tone
float pulse(float id) { return 0.5; }
float gPulse = 0.0;
#else
float hatch() { return step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0)); }
float pulse(float id) { return 0.5 + 0.5 * sin(uTime * 2.2 + fract(id * 0.618034) * 6.2832); }
float gPulse;      // 1 close up, 0 where a slope is only a few pixels: there the check-first glow holds steady instead of twinkling
#endif

// colour (rgb, alpha) of a unit for the current layer; glow = extra light
vec4 unitColor(float id, out float glow) {
  glow = 0.0;
  if (id < 0.5 || uMode == 0 || uMode == 6) return vec4(0.0);
  ivec2 q = ivec2(int(mod(id, 1024.0)), int(floor(id / 1024.0)));
  vec4 A = texelFetch(tA, q, 0), B = vec4(0.0), C = vec4(0.0);          // this runs four times per pixel, so only read what the layer uses
  if (uCounty > 0.5) B = texelFetch(tB, q, 0);
  if (uMode == 3 || uMode == 5) C = texelFetch(tC, q, 0);
  vec4 c = vec4(0.0);
  if (uMode == 1) {
    int l = int(A.r + 0.5);
    if (l == 3) { float pu = 0.5 + (pulse(id) - 0.5) * gPulse; c = vec4(uLevelC[3], 0.93); glow = 0.25 + 0.55 * pu; }
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
  } else if (uMode == 8) {                                  // speed along the slope from the time-series inversion; faint inside the error bar
    vec4 Dd = texelFetch(tD, q, 0);
    if (Dd.g < -900.0) c = vec4(uLevelC[0], 0.35 * hatch());
    else if (Dd.g > 900.0) c = vec4(0.0);
    else { float v = clamp(Dd.g / 30.0, -1.0, 1.0); float sig = smoothstep(1.0, 4.0, abs(Dd.b)); c = vec4(ramp(2.0, v * 0.5 + 0.5), 0.08 + 0.86 * sig); glow = A.a > 0.5 ? 0.3 + 0.5 * pulse(id) : 0.0; }
  } else if (uMode == 7) {                                  // forecast rain against the heaviest rain the slope has stood through
    float rec = texelFetch(tD, q, 0).r; int l = int(A.r + 0.5);
    if (rec > 0.0 && uRain > rec) {
      if (l == 3) { c = vec4(uLevelC[3], 0.95); glow = 0.3 + 0.5 * pulse(id); }
      else if (l == 2) c = vec4(uLevelC[2] * 0.85, 0.6);
      else c = vec4(0.30, 0.52, 0.86, 0.2);
    } else c = vec4(uLevelC[1], l >= 2 ? 0.16 : 0.05);
  }
  if (uCounty > 0.5 && abs(B.a - uCounty) > 0.5) { c.a *= 0.1; glow = 0.0; }
  return c;
}`;

// Pre-filters the slope layer and the land mask for the view from far away, where a pixel covers several unit-map texels
// and reading one of them per pixel gave a speckle that crawled and sparkled as the camera moved. Left half: the layer,
// premultiplied, glow folded in, at half resolution (each texel the average of 2 x 2). Right half, after a gap that keeps
// the mipmaps apart: R share of South Korean land, G share of another country, B the coast distance (so the ground
// shader needs no texture unit for it). Mipmapped, so it is steady at any distance.
const BAKE_FRAG = /* glsl */`
#define BAKE
${UNIT_GLSL}
uniform sampler2D tCoast;
uniform vec2 uBake;                            // x: width of a half in texels, y: the gap between them
void main() {
  int x = int(gl_FragCoord.x), hw = int(uBake.x), gap = int(uBake.y);
  ivec2 b = ivec2(x, int(gl_FragCoord.y)) * 2;
  if (x < hw) {
    vec3 P = vec3(0.0); float A = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      float g; vec4 c = unitColor(idOf(idTexel(b + ivec2(i, j))), g);
      P += c.rgb * c.a * (1.0 + 0.5 * g); A += c.a;
    }
    gl_FragColor = vec4(P * 0.125, A * 0.25);                // colour halved: room for the glow in 8 bits
  } else if (x >= hw + gap) {
    b.x = (x - hw - gap) * 2; vec2 S = vec2(0.0);
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) { float a = idTexel(b + ivec2(i, j)).a; S += vec2(step(0.75, a), step(0.25, a) - step(0.75, a)); }
    gl_FragColor = vec4(S * 0.25, texture2D(tCoast, (vec2(b) + 1.0) / uSize40).r, 1.0);   // B: distance from the coast (nationwide)
  } else gl_FragColor = vec4(0.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D tNormal, tImgA, tImgB, tRadar, tLand, tDetail, tDetail2, tLayer;      // with UNIT_GLSL and tDebA: 15 of the 16 units
uniform vec2 uDetailC, uDetail2C;
uniform float uLandOn, uDetailOn, uDetailH, uDetail2On, uDetail2H;
uniform vec2 uHalf;
uniform vec4 uLayerUV;                         // the bake: u scale, u offset of its land half, v scale
uniform float uHalo;
uniform float uK, uExag, uOverlay, uImgMix, uImgOn, uRadarOn, uSel, uHover, uEdges, uRevealOn, uRevealP;
uniform vec2 uScanO[3], uScanD[3], uRevealO, uRevealD;
uniform float uScanP[3], uScanI[3];
uniform vec3 uScanC[3], uFog;
varying vec2 vUv; varying float vH; varying vec3 vW;

${FLOOR_GLSL}
${UNIT_GLSL}

${DEB_GLSL}
// The mud itself: dark and wet close up, where the glowing mesh carries the picture; seen from further out, where the
// mesh has faded, a lighter clay so a flow still reads as one shape.
vec3 debFill(float dep, float diff, float ao, float spec, float clay) {
  float dd = smoothstep(0.02, 0.6, dep);
  vec3 dark = mix(vec3(0.03, 0.016, 0.01), vec3(0.075, 0.03, 0.014), dd);
  vec3 light = mix(vec3(0.46, 0.25, 0.11), vec3(0.42, 0.13, 0.04), dd);
  return mix(dark, light, clay) * (0.4 + 0.95 * diff) * ao + vec3(0.9, 0.8, 0.7) * spec * 0.12;
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

  float hm = vH * 1000.0 * uK;
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float fp = max(length(dx * uSize40), length(dy * uSize40));             // unit-map texels (28 m nationwide) per pixel
  gPulse = 1.0 - smoothstep(0.12, 0.45, fp);
  // What lies under the pixel is worked out as shares rather than one yes/no texel, so coasts and the edges of the slope
  // patches are smooth lines at any zoom, not 28 m stair steps that crawl and sparkle as the camera moves. Close up: the
  // four texels round the point, blended, then sharpened so the 50% line is a crisp, round-cornered boundary about a pixel
  // soft. From far away, where a pixel covers several texels: the bake (Terrain.bakeLayer), filtered through its mipmaps.
  float farW = smoothstep(0.7, 1.6, fp), sharp = clamp(0.5 / max(fp, 1e-4), 1.0, 32.0);
  vec2 tq = uv * uSize40 - 0.5; ivec2 iq = ivec2(floor(tq)); vec2 fq = tq - floor(tq);
  vec4 u0 = idTexel(iq), u1 = idTexel(iq + ivec2(1, 0)), u2 = idTexel(iq + ivec2(0, 1)), u3 = idTexel(iq + ivec2(1, 1));
  vec4 bw = vec4((1.0 - fq.x) * (1.0 - fq.y), fq.x * (1.0 - fq.y), (1.0 - fq.x) * fq.y, fq.x * fq.y);
  vec4 la = vec4(u0.a, u1.a, u2.a, u3.a);                                  // 1 South Korea, 0.5 another country, 0 sea
  vec3 lb = texture2D(tLayer, vec2(uv.x * uLayerUV.x + uLayerUV.y, uv.y * uLayerUV.z)).rgb;
  vec2 lsh = mix(vec2(dot(bw, step(0.75, la)), dot(bw, step(0.25, la) - step(0.75, la))), lb.rg, farW);
  vec3 cls = pow(max(vec3(lsh, 1.0 - lsh.x - lsh.y), 0.0) + 1e-6, vec3(sharp)); cls /= cls.x + cls.y + cls.z;
  float hs = clamp((hm - 0.6) / max(fwidth(hm), 1e-3) + 0.5, 0.0, 1.0);   // below 0.6 m counts as sea too
  float kF = cls.x * hs, aF = cls.y, sF = max(1.0 - kF - aF, 0.0);         // shares: South Korean land, another country, sea
  bool sea = kF < 0.001;
  float cd = uHalo > 0.5 ? lb.b : 0.0;
  vec3 img = uImgOn > 0.001 ? mix(texture2D(tImgA, uv).rgb, texture2D(tImgB, uv).rgb, uImgMix) * (0.42 + 0.85 * diff) * ao : vec3(0.0);

  // the sea. Nationwide it is lighter at the shore (cd: 0 on South Korean land, 1 about 100 km out) and everything off
  // the map (open sea, North Korea, Japan) dissolves into the floor at the end instead of ending at a box.
  vec3 colS = vec3(0.004, 0.016, 0.03), colA = mix(vec3(0.028, 0.034, 0.038), vec3(0.03, 0.036, 0.042), uHalo);   // other countries: flat, no data
  if (uHalo > 0.5) colS = mix(vec3(0.016, 0.052, 0.082), vec3(0.01, 0.03, 0.05), smoothstep(0.0, 0.45, cd));
  else {                                                                   // the regional block: a slow swell, gone where it would be finer than the pixels
    vec2 wv = vec2(uv.x * 900.0, uv.y * 700.0) / uK;
    colS += 0.006 * sin(wv.x + uTime * 0.6) * sin(wv.y - uTime * 0.45) * (1.0 - smoothstep(0.12, 0.35, max(fwidth(wv.x), fwidth(wv.y))));
    colS = mix(colS, img, uImgOn);
  }

  vec3 col = vec3(0.0);
  float idc = 0.0, wTop = 1.0, wSel = 0.0, wHov = 0.0;                   // the main unit here and its share; the selected and hovered units' shares
  if (kF > 0.001) {
    // base terrain: cold slate, a little lighter with height
    vec3 base = mix(vec3(0.012, 0.03, 0.042), vec3(0.05, 0.085, 0.1), smoothstep(40.0, 420.0, hm));
    base = mix(base, vec3(0.16, 0.19, 0.2), smoothstep(380.0, 1150.0, hm));
    // the real ground (js/world.js): land cover over the whole map, and near the camera a sharper picture with fields,
    // water, roads and railways. It only replaces the slate base colour, so the relief shading stays and every slope
    // layer below is drawn over it exactly as before.
    if (uLandOn > 0.001) {
      vec4 lc = texture2D(tLand, uv);
      vec3 g = lc.rgb; float a = lc.a;
      if (uDetail2On > 0.001) {                                             // the wide picture, then the sharp one inside it
        vec2 q = (vW.xz - uDetail2C) / (2.0 * uDetail2H) + 0.5, e = min(q, 1.0 - q);
        float w = smoothstep(0.0, 0.07, min(e.x, e.y)) * uDetail2On;
        if (w > 0.0) { vec4 d = texture2D(tDetail2, q); g = g * (1.0 - d.a * w) + d.rgb * w; a = max(a, d.a * w); }
      }
      if (uDetailOn > 0.001) {
        vec2 q = (vW.xz - uDetailC) / (2.0 * uDetailH) + 0.5, e = min(q, 1.0 - q);
        float w = smoothstep(0.0, 0.07, min(e.x, e.y)) * uDetailOn;
        if (w > 0.0) { vec4 d = texture2D(tDetail, q); g = g * (1.0 - d.a * w) + d.rgb * w; a = max(a, d.a * w); }
      }
      g *= 0.82 + 0.5 * smoothstep(60.0, 1100.0, hm);                       // a little lighter with height, like the slate it replaces
      base = mix(base, g, a * uLandOn);
    }
    col = base * shade;
    // imagery (Sentinel-2 false colour), cross-faded between two dates
    if (uImgOn > 0.001) col = mix(col, img, uImgOn);

    // the slope layer. Each texel's unit holds a share of the neighbourhood (bilinear), sharpened; a unit on several of
    // the four texels is counted once (tw)
    vec4 ids = vec4(idOf(u0), idOf(u1), idOf(u2), idOf(u3));
    vec4 m0 = vec4(equal(ids, ids.xxxx)), m1 = vec4(equal(ids, ids.yyyy)), m2 = vec4(equal(ids, ids.zzzz)), m3 = vec4(equal(ids, ids.wwww));
    vec4 cnt = vec4(dot(m0, vec4(1.0)), dot(m1, vec4(1.0)), dot(m2, vec4(1.0)), dot(m3, vec4(1.0)));
    vec4 sw = pow(vec4(dot(bw, m0), dot(bw, m1), dot(bw, m2), dot(bw, m3)) + 1e-6, vec4(sharp));
    sw /= dot(sw / cnt, vec4(1.0));
    vec4 tw = sw / cnt;
    idc = ids.x; wTop = sw.x;
    if (sw.y > wTop) { idc = ids.y; wTop = sw.y; }
    if (sw.z > wTop) { idc = ids.z; wTop = sw.z; }
    if (sw.w > wTop) { idc = ids.w; wTop = sw.w; }
    wSel = dot(tw, vec4(equal(ids, vec4(uSel)))); wHov = dot(tw, vec4(equal(ids, vec4(uHover))));
    float Sl = 0.4 + 0.8 * min(shade, 1.25);
    vec3 ovP = vec3(0.0); float ovA = 0.0;                                 // premultiplied lit colour (glow included), cover
    if (farW < 0.999 && uMode != 0 && uMode != 6) {
      float g0, g1, g2, g3; vec4 c0 = unitColor(ids.x, g0), c1 = c0, c2 = c0, c3 = c0; g1 = g2 = g3 = g0;
      if (cnt.x < 3.5) { c1 = unitColor(ids.y, g1); c2 = unitColor(ids.z, g2); c3 = unitColor(ids.w, g3); }
      vec4 ca = vec4(c0.a, c1.a, c2.a, c3.a) * tw * (1.0 - farW);
      ovP = c0.rgb * ca.x * (Sl + 0.55 * g0) + c1.rgb * ca.y * (Sl + 0.55 * g1) + c2.rgb * ca.z * (Sl + 0.55 * g2) + c3.rgb * ca.w * (Sl + 0.55 * g3);
      ovA = dot(ca, vec4(1.0));
    }
    if (farW > 0.001) { vec4 b = texture2D(tLayer, vec2(uv.x * uLayerUV.x, uv.y * uLayerUV.z)); ovP += b.rgb * (2.0 * Sl * farW); ovA += b.a * farW; }
    float reveal = 1.0;
    if (uRevealOn > 0.5) reveal = 1.0 - smoothstep(-3.0, 0.0, dot(vW.xz - uRevealO, uRevealD) - uRevealP);
    float ow = uOverlay * reveal;
    col = col * (1.0 - ovA * ow) + ovP * ow;

    // interferogram raster for the pair that spans the storm
    if (uRadarOn > 0.001) {
      vec4 r = texture2D(tRadar, uv);
      vec3 fr = 0.5 + 0.5 * cos(6.2832 * (r.r + vec3(0.0, 0.33, 0.67)));
      col = mix(col, fr * fr * (0.12 + 0.95 * r.g * r.g) * (0.55 + 0.6 * diff), uRadarOn * step(0.5, r.a) * 0.92);
    }
  }

  // simulated debris flows. Close up: dark wet mud under a glowing mesh that is draped on the flow and streams downhill.
  // Its cross lines are where the front stood, so they run at the speed the flow ran (wide apart where it was fast,
  // bunched where it slowed) and go hot white where it was fast; its long lines follow the flow's centre line. Further
  // out the mesh fades to a clay fill, and from far away a filtered block texture takes over, so nothing flickers.
  vec2 dp = vec2(dot(uDebX, vec3(vW.xz, 1.0)), dot(uDebZ, vec3(vW.xz, 1.0)));
  float dfp = max(length(dFdx(dp)), length(dFdy(dp)));                     // cells per pixel
  float mudA = 0.0;
  if ((uDebOn > 0.5 || uDebSel > -0.5) && !sea && dp.x > -2.0 && dp.y > -2.0 && dp.x < uDebN.x + 1.0 && dp.y < uDebN.y + 1.0) {
    float lod = smoothstep(0.9, 2.4, dfp), meshOn = 1.0 - smoothstep(0.18, 0.45, dfp);
    vec3 V = normalize(cameraPosition - vW), Hh = normalize(L + V), Nm = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.55));
    vec3 mF = vec3(0.0), eF = vec3(0.0), mC = vec3(0.0); float aF = 0.0, aC = 0.0;
    if (lod < 0.999) {
      ivec2 q = ivec2(floor(dp)); vec2 f = dp - floor(dp);
      float d0, d1, d2, d3, t0, t1, t2, t3; vec3 b0, b1, b2, b3;
      vec4 c0 = debCell(q, d0, t0, b0), c1 = debCell(q + ivec2(1, 0), d1, t1, b1), c2 = debCell(q + ivec2(0, 1), d2, t2, b2), c3 = debCell(q + ivec2(1, 1), d3, t3, b3);
      vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      vec4 Sv = vec4(b0.x, b1.x, b2.x, b3.x);
      float S = dot(w, Sv);
      vec4 pw = vec4(c0.x, c1.x, c2.x, c3.x) * w;
      float P = pw.x + pw.y + pw.z + pw.w;
      if (S > 0.08 && P > 0.001) {
        float iw = 1.0 / P;
        float since = dot(pw, clamp(vec4(c0.y, c1.y, c2.y, c3.y), -20.0, 600.0)) * iw;
        float tA = dot(pw, vec4(t0, t1, t2, t3)) * iw, dep = dot(pw, vec4(c0.z, c1.z, c2.z, c3.z)) * iw;
        float dim = dot(pw, vec4(d0, d1, d2, d3)) * iw;
        float Sb = dot(w, vec4(b0.y, b1.y, b2.y, b3.y)), vx = dot(w, vec4(b0.z, b1.z, b2.z, b3.z));
        // the outline: a smooth curve through the blurred cover, about a pixel soft, with a thin bright edge
        vec2 gS = vec2(mix(Sv.y - Sv.x, Sv.w - Sv.z, f.y), mix(Sv.z - Sv.x, Sv.w - Sv.y, f.x));
        float sPx = (S - 0.33) / max(length(gS) * dfp, 1e-4);                  // pixels inside the edge
        float shape = smoothstep(-0.7, 0.7, sPx), edge = 1.0 - smoothstep(0.0, 1.3, abs(sPx - 0.6));
        float bestM = smoothstep(0.24, 0.42, Sb);
        float reveal = smoothstep(-0.8, 0.4, since), body = shape * reveal;
        // relief from the depth field
        vec4 dz = vec4(c0.z * c0.x, c1.z * c1.x, c2.z * c2.x, c3.z * c3.x);
        vec2 gd = vec2(mix(dz.y - dz.x, dz.w - dz.z, f.y), mix(dz.z - dz.x, dz.w - dz.y, f.x));
        vec3 Nd = normalize(Nm - vec3(gd.x, 0.0, gd.y) * 0.9);
        float dDiff = max(dot(Nd, L), 0.0), dSpec = pow(max(dot(Nd, Hh), 0.0), 26.0);
        // speed of the front here (cells a second), from how arrival time changes across the cells
        vec4 tt = mix(vec4(tA), vec4(t0, t1, t2, t3), vec4(c0.x, c1.x, c2.x, c3.x));
        vec2 gt = vec2(mix(tt.y - tt.x, tt.w - tt.z, f.y), mix(tt.z - tt.x, tt.w - tt.y, f.x));
        float fast = smoothstep(0.25, 3.0, 1.0 / max(length(gt), 0.02));
        // the mesh: cross lines on sqrt(arrival time), moving; long lines every cell across the flow
        float rt = sqrt(max(tA, 0.25));
        float ph = rt * 2.0 - uTime * 0.55, wA = length(gt) / rt * dfp + 1e-4;
        float dA = abs(fract(ph + 0.5) - 0.5) / wA, wL = dfp + 1e-4, dL = abs(fract(vx + 0.5) - 0.5) / wL;
        float fL = smoothstep(5.0, 10.0, 1.0 / wL), fA = min(smoothstep(4.0, 9.0, 1.0 / wA), fL);   // never cross lines alone: they read as stacked rings
        float lines = max((1.0 - smoothstep(0.4, 1.3, dA)) * fA, (1.0 - smoothstep(0.4, 1.3, dL)) * fL);
        float dots = (1.0 - smoothstep(2.6, 4.0, length(vec2(dA * fA + (1.0 - fA) * 9.0, dL * fL + (1.0 - fL) * 9.0))));
        vec3 meshC = mix(vec3(0.62, 0.55, 0.5) * 0.7, vec3(1.0, 0.93, 0.82), fast);          // slow: dim, fast: near white
        float fresh = exp(-max(since, 0.0) / 1.6);
        mF = debFill(dep, dDiff, ao, dSpec * bestM, 1.0 - meshOn * 0.85);
        aF = body * dim * mix(0.25, 0.93, bestM);
        eF = meshC * body * dim * meshOn * ((lines * 0.55 + dots * 1.5) * mix(0.4, 1.0, bestM) + edge * 0.7 * reveal + fresh * 0.6);
        col *= 1.0 - 0.38 * smoothstep(0.1, 0.3, S) * (1.0 - shape) * dim * reveal;   // soft contact shadow round the mud
      }
    }
    if (lod > 0.001) {
      vec2 cq = clamp(dp, vec2(0.0), uDebN - 1.0) + 0.5;
      vec4 cv = texture2D(tDebA, vec2(cq.x * uDebCR.x, uDebCR.y + cq.y * uDebCR.z));
      float since = uDebOn > 0.5 ? uDebT - cv.g * 255.0 : -1e3;
      if (cv.r > 0.002 && since > -4.0) {
        mC = debFill(max(cv.a, 0.3), diff, ao, 0.0, 1.0);
        aC = min(sqrt(cv.r) * 1.9, 1.0) * mix(0.45, 0.95, cv.b) * clamp(since / 8.0 + 0.5, 0.0, 1.0) * (uDebSel > -0.5 ? 0.35 : 1.0);
      }
    }
    mudA = mix(aF, aC, lod);
    vec3 mud = (mF * aF * (1.0 - lod) + mC * aC * lod) / max(mudA, 1e-4);
    col = mix(col, mud, mudA) + eF * (1.0 - lod);
  }

  // outlines between units when close, along the same smooth boundaries (where no unit holds most of the pixel);
  // the selected and hovered units lit, with a bright rim on their boundary
  if (kF > 0.001) {
    float near = 1.0 - smoothstep(0.18, 0.6, fp);
    float e = 1.0 - smoothstep(0.5, 0.8, wTop);
    col = mix(col, col * 0.35, e * near * 0.7 * uEdges * (1.0 - 0.85 * mudA));
    if (wSel > 0.002) { col = mix(col, vec3(1.0), (0.1 + 0.06 * sin(uTime * 4.0)) * wSel); col += vec3(1.6, 1.9, 2.2) * min(wSel * (1.0 - wSel) * 4.0, 1.0); }
    else if (wHov > 0.002) { col = mix(col, vec3(1.0), 0.1 * wHov); col += vec3(0.7) * min(wHov * (1.0 - wHov) * 4.0, 1.0); }
  }
  col = col * kF + colA * aF + colS * sF;

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
  if (uHalo > 0.5 && kF < 0.999) {
    vec2 ed = (0.5 - abs(uv - 0.5)) * 2.0 * uHalf;                         // scene units in from the edge of the grid
    float keep = (1.0 - smoothstep(0.0, 1.0, cd)) * smoothstep(0.0, 6.0, min(ed.x, ed.y));
    col = mix(floorCol(vW.xz, 1.0), col, kF + sF * keep + aF * keep * keep * 0.8);   // other countries: fainter still, there is no data there
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

export class Terrain {
  constructor(D, quality) {
    this.D = D;
    const { W80, H80, h, n } = D, Wkm = D.Ws, Hkm = D.Hs;
    // regional: 160 m mesh by default (0.65 M triangles), ultra 80 m. Nationwide: 1.1 km by default (0.75 M), ultra 720 m.
    const s = D.korea ? (quality === 'low' ? 4 : (quality === 'ultra' ? 2 : 3)) : (quality === 'low' ? 3 : (quality === 'ultra' ? 1 : 2));
    this.step = s;                                              // world-geo.js rebuilds this exact surface to stand buildings on it
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
    const [a, tA] = mk(), [b, tB] = mk(), [c, tC] = mk(), [d, tD] = mk();
    const C = D.col;
    for (let u = 0; u < n; u++) {
      const k = (u + 1) * 4;
      a[k] = C.level[u]; a[k + 1] = C.pct[u]; a[k + 2] = Number.isFinite(C.dnbr[u]) ? C.dnbr[u] : 0; a[k + 3] = C.moving[u];
      b[k] = C.cum_125[u]; b[k + 1] = C.cum_032[u]; b[k + 2] = C.cum_024[u]; b[k + 3] = C.county[u];
      c[k] = c[k + 1] = c[k + 2] = 999; c[k + 3] = -1; d[k] = C.rec48 ? C.rec48[u] : 0;
      // solved speed along the slope (mm a month) and how many error bars it is from zero; -999 = seen from one side only, 999 = no radar here
      const solved = C.vd && Number.isFinite(C.vd[u]) && C.vds[u] > 0;
      d[k + 1] = solved ? C.vd[u] : (!C.vd || (D.korea && !(C.rcov[u] > 0))) ? 999 : -999; d[k + 2] = solved ? C.vd[u] / C.vds[u] : 0;
    }
    tA.needsUpdate = tB.needsUpdate = tD.needsUpdate = true;
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
      tNormal: { value: tex('data/normal.jpg', false) }, tUnitId: { value: tId }, tA: { value: tA }, tB: { value: tB }, tC: { value: tC }, tD: { value: tD }, uRain: { value: 120 },
      tRamp: { value: rampTexture() }, tImgA: { value: blank }, tImgB: { value: blank }, tRadar: { value: blank },
      uSize40: { value: new THREE.Vector2(D.W40, D.H40) }, tCoast: { value: D.korea ? this.coastTexture() : blank }, uHalo: { value: D.korea ? 1 : 0 }, uHalf: { value: new THREE.Vector2(Wkm / 2, Hkm / 2) }, uMode: { value: 1 }, uTrack: { value: 0 }, uK: { value: D.k },
      uExag: { value: D.view.exag }, uTime: { value: 0 }, uOverlay: { value: 0.92 }, uImgMix: { value: 0 }, uImgOn: { value: 0 }, uRadarOn: { value: 0 },
      uSel: { value: -1 }, uHover: { value: -1 }, uCounty: { value: 0 }, uMoveScale: { value: 3 }, uEdges: { value: 1 },
      uRevealOn: { value: 0 }, uRevealP: { value: 0 }, uRevealO: { value: new THREE.Vector2() }, uRevealD: { value: new THREE.Vector2(0, -1) },
      uScanO: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uScanD: { value: [new THREE.Vector2(0, -1), new THREE.Vector2(0, -1), new THREE.Vector2(0, -1)] },
      uScanP: { value: [0, 0, 0] }, uScanI: { value: [0, 0, 0] },
      tLand: { value: blank }, tDetail: { value: blank }, uLandOn: { value: 0 }, uDetailOn: { value: 0 }, uDetailH: { value: 1 }, uDetailC: { value: new THREE.Vector2() },
      tDetail2: { value: blank }, uDetail2On: { value: 0 }, uDetail2H: { value: 1 }, uDetail2C: { value: new THREE.Vector2() },
      uScanC: { value: TRACK_COLORS.map(lc) }, uLevelC: { value: LEVEL_COLORS.map(lc) }, uFog: { value: lc('#05090d') },
      // simulated debris flows (fx.js Debris fills these in)
      tDebA: { value: blank }, uDebAW: { value: 1 }, uDebIY: { value: 0 }, uDebPB: { value: 0 }, uDebCR: { value: new THREE.Vector4() }, uDebN: { value: new THREE.Vector2(0, 0) },
      uDebX: { value: new THREE.Vector3() }, uDebZ: { value: new THREE.Vector3() }, uDebOn: { value: 0 }, uDebT: { value: 0 }, uDebSpread: { value: 70 },
      uDebSel: { value: -1 }, uDebSelT: { value: 0 },
    };
    this.debGLSL = DEB_GLSL;
    this.makeBake();
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
  // The far-view bake (BAKE_FRAG): half the unit map's resolution, the layer on the left, the land mask on the right,
  // a gap between them. sRGB 8-bit, so faint layers keep their precision; mipmapped and anisotropic for oblique views.
  makeBake() {
    const D = this.D, u = this.uniforms, GAP = 32, hw = Math.ceil(D.W40 / 2), hh = Math.ceil(D.H40 / 2), W = hw * 2 + GAP;
    this.layerRT = new THREE.WebGLRenderTarget(W, hh, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
    this.layerRT.texture.anisotropy = 8;
    u.tLayer = { value: this.layerRT.texture };
    u.uLayerUV = { value: new THREE.Vector4(D.W40 / 2 / W, (hw + GAP) / W, D.H40 / 2 / hh, 0) };
    const keys = ['tUnitId', 'tA', 'tB', 'tC', 'tD', 'tRamp', 'tCoast', 'uSize40', 'uMode', 'uTrack', 'uRain', 'uTime', 'uCounty', 'uMoveScale', 'uLevelC'];
    const uniforms = { uBake: { value: new THREE.Vector2(hw, GAP) } };
    for (const k of keys) uniforms[k] = u[k];
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false }));
    quad.frustumCulled = false;
    this.bakeScene = new THREE.Scene(); this.bakeScene.add(quad); this.bakeCam = new THREE.Camera();
    this.layerKey = null;
  }
  // Re-bake when anything the layer shows has changed (main.js calls this before every frame it draws; usually a no-op).
  bakeLayer(renderer) {
    const u = this.uniforms;
    const key = `${u.uMode.value}|${u.uTrack.value}|${u.uCounty.value}|${u.uRain.value}|${u.uMoveScale.value}|${u.tA.value.version}|${u.tB.value.version}|${u.tC.value.version}|${u.tD.value.version}|${u.uLevelC.value.map((c) => c.getHexString()).join()}`;
    if (key === this.layerKey) return;
    this.layerKey = key;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.layerRT); renderer.render(this.bakeScene, this.bakeCam); renderer.setRenderTarget(prev);
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
      prev = t; t += Math.min(step, 0.003 + 0.02 * t) * (1 + t * 0.004);     // fine steps near the camera, so close up the ray does not step over a ridge
    }
    return null;
  }
}
