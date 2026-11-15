// Maps and graphics drawn for paper, shared by the district sheet (sheet.html) and the field form (form.html).
//
// Every position is first brought into one frame, "grid metres": EPSG:5179 metres east and south of the nationwide
// grid's corner, which is also the frame of the real-world tiles in data/world/ (pipeline/world/w02_tiles.py).
// The regional 20 m map converts with the polynomial fit the world index carries, as js/world-geo.js does.
//
//   vectorMap()  our own map, drawn from those tiles: Overture buildings and roads, ESA WorldCover land cover, canopy
//                height from NASA GEDI, relief from our terrain. The simulated debris flows (p11) or ML model 3's reach
//                go on top, and footprints under a flow turn red. North is grid north (under 1° from true north).
//   osmMap()     OpenStreetMap raster tiles, kept where place names matter; flows go on top through a local fit
//                from grid metres to latitude and longitude.
//   solverSVG()  the radar time-series inversion of one slope as a static chart.

const poly = (c, a, b) => c[0] + c[1] * a + c[2] * b + c[3] * a * a + c[4] * a * b + c[5] * b * b + c[6] * a * a * a + c[7] * a * a * b + c[8] * a * b * b + c[9] * b * b * b;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// ---- frames --------------------------------------------------------------------------------------------------------
export async function paperGeo(D, normal) {
  const W = await fetch('data/world/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const C = D.col, K = D.korea, R = W && W.region, RO = D.runout;
  if (!K && !R) return null;
  const kmToM = K ? (x, z) => [x * 1000, z * 1000]
    : (x, z) => { const a = (x - R.rc[0]) / R.rs, b = (z - R.rc[1]) / R.rs; return [poly(R.ix, a, b), poly(R.iz, a, b)]; };
  const mToKm = K ? (mx, mz) => [mx / 1000, mz / 1000]
    : (mx, mz) => { const a = (mx - R.c[0]) / R.s, b = (mz - R.c[1]) / R.s; return [poly(R.fx, a, b), poly(R.fz, a, b)]; };
  const G = { D, W, K, normal, kmToM, mToKm, tiles: new Map(), have: W ? new Set(W.tiles) : new Set() };
  G.unit = (u) => kmToM(C.x[u], C.z[u]);
  G.cellR = K ? 480 : 185;                                       // H3 res 8 / res 9: centre to corner, m

  // simulated debris flows: the 10 m cells of flow i in grid metres, with arrival (s), depth (m), best-fit flag
  if (RO) {
    const cellM = K ? (c, r) => { const s = RO.at(c, r); return kmToM((s[0] + D.Ws / 2) * D.k, (s[1] + D.Hs / 2) * D.k); }
      : (c, r) => kmToM((c + 0.5) * 0.01, (r + 0.5) * 0.01);
    const cache = new Map();
    G.flowCells = (i) => {
      let f = cache.get(i); if (f) return f;
      const n = RO.off[i + 1] - RO.off[i], xy = new Float64Array(2 * n), t = new Float32Array(n), d = new Float32Array(n), k = new Uint8Array(n);
      for (let q = 0; q < n; q++) { const p = RO.off[i] + q, m = cellM(RO.col[p], RO.row[p]); xy[2 * q] = m[0]; xy[2 * q + 1] = m[1]; t[q] = RO.t[p] * 0.5; d[q] = RO.d[p] * 0.02; k[q] = RO.k[p]; }
      f = { i, unit: RO.unit[i], n, xy, t, d, k }; cache.set(i, f); return f;
    };
    let start = null;                                            // where each flow starts, for searching by place
    G.flowsNear = (mx, mz, r) => {
      if (!start) { start = new Float64Array(2 * RO.nf); for (let i = 0; i < RO.nf; i++) { const p = RO.off[i], m = cellM(RO.col[p], RO.row[p]); start[2 * i] = m[0]; start[2 * i + 1] = m[1]; } }
      const out = []; for (let i = 0; i < RO.nf; i++) if (Math.hypot(start[2 * i] - mx, start[2 * i + 1] - mz) < r) out.push(i);
      return out;
    };
    // the flows that belong to slope u: its own run on the regional map; on the nationwide map, the regional runs
    // that start inside its hexagon (where ML 3's "simulated" reach comes from)
    G.flowsOf = (u) => {
      if (!K) { const i = RO.flow.get(u); return i === undefined ? [] : [i]; }
      const [mx, mz] = G.unit(u); return G.flowsNear(mx, mz, G.cellR);
    };
  } else { G.flowCells = null; G.flowsNear = () => []; G.flowsOf = () => []; }

  // local fit from grid metres to latitude and longitude, through the slopes near a place (their centres carry both)
  G.fitLL = (mx0, mz0, r = 15000) => {
    const S = [];
    for (let u = 0, step = Math.max(1, (D.n / 60000) | 0); u < D.n; u += step) { const [mx, mz] = G.unit(u); if (Math.abs(mx - mx0) < r && Math.abs(mz - mz0) < r) S.push([mx - mx0, mz - mz0, C.lat[u], C.lon[u]]); }
    if (S.length < 3) for (let u = 0; u < D.n; u += 97) { const [mx, mz] = G.unit(u); S.push([mx - mx0, mz - mz0, C.lat[u], C.lon[u]]); }
    const solve = (col) => {                                     // least squares v = a + b x + c z
      let n = 0, sx = 0, sz = 0, sxx = 0, sxz = 0, szz = 0, sv = 0, sxv = 0, szv = 0;
      for (const p of S) { const x = p[0] / 1000, z = p[1] / 1000, v = p[col]; n++; sx += x; sz += z; sxx += x * x; sxz += x * z; szz += z * z; sv += v; sxv += x * v; szv += z * v; }
      const A = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]], B = [sv, sxv, szv];
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k < 3; k++) A[j][k] -= f * A[i][k]; B[j] -= f * B[i]; }
      const c = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = B[i]; for (let k = i + 1; k < 3; k++) s -= A[i][k] * c[k]; c[i] = s / A[i][i]; }
      return c;
    };
    const a = solve(2), b = solve(3);
    return (mx, mz) => { const x = (mx - mx0) / 1000, z = (mz - mz0) / 1000; return [a[0] + a[1] * x + a[2] * z, b[0] + b[1] * x + b[2] * z]; };
  };
  return G;
}

// ---- real-world tiles ------------------------------------------------------------------------------------------------
async function inflate(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return u;
  return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function rings(xy, nv, q) {
  const out = new Float32Array(xy.length); let p = 0;
  for (let r = 0; r < nv.length; r++) { let x = 0, y = 0; for (let v = 0; v < nv[r]; v++, p += 2) { x += xy[p]; y += xy[p + 1]; out[p] = x * q; out[p + 1] = y * q; } }
  return out;
}
function tile(G, tx, tz) {
  const W = G.W, key = tz * W.ntx + tx;
  if (tx < 0 || tz < 0 || tx >= W.ntx || tz >= W.ntz || !G.have.has(key)) return Promise.resolve(null);
  let t = G.tiles.get(key); if (t) return t;
  t = fetch(`data/world/t/${tx}_${tz}.bin.gz`).then((r) => (r.ok ? r.arrayBuffer() : null)).then(async (buf) => {
    if (!buf) return null;
    const u = await inflate(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const [nB, nBv, nL, nLv, nP, nPr, nPv] = [4, 8, 12, 16, 20, 24, 28].map((o) => dv.getUint32(o, true));
    let o = 32;
    const u8 = (n) => { const a = u.subarray(o, o + n); o += n; return a; };
    const u16 = (n) => { const a = new Uint16Array(u.buffer.slice(u.byteOffset + o, u.byteOffset + o + n * 2)); o += n * 2; return a; };
    const i16 = (n) => { const a = new Int16Array(u.buffer.slice(u.byteOffset + o, u.byteOffset + o + n * 2)); o += n * 2; return a; };
    const T = { tx, tz, ox: tx * W.tile_m, oz: tz * W.tile_m, nB, nL, nP };
    T.bnv = u8(nB); T.bcls = u8(nB); T.bh = u16(nB); T.bxy = rings(i16(nBv * 2), T.bnv, W.q_m);
    T.lcls = u8(nL); T.lnv = u16(nL); T.lxy = rings(i16(nLv * 2), T.lnv, W.q_m);
    T.pcls = u8(nP); T.pnr = u8(nP); T.pnv = u16(nPr); T.pxy = rings(i16(nPv * 2), T.pnv, W.q_m);
    T.ground = u8(W.cells * W.cells);
    return T;
  }).catch(() => null);
  G.tiles.set(key, t);
  return t;
}

// ---- colours on paper ------------------------------------------------------------------------------------------------
const LC = [null, [205, 223, 190], [221, 229, 200], [230, 235, 207], [241, 234, 206], [226, 222, 216], [236, 228, 212], [184, 211, 232], [207, 227, 223]];
const TALL = [160, 194, 146];
const LU = { 40: '#f1e8c4', 41: '#e2e9c2', 42: '#d4e7c4', 43: '#e6e1da', 44: '#dedbe4', 45: '#eadcd6', 46: '#ebe4cf', 47: '#d5e1cd', 48: '#e1ded7', 50: '#efe6cf', 51: '#e1ded7', 52: '#cfe3df' };
const WATER = '#b3d1e7', WATER_LINE = '#5f9fca';
const ROAD_FILL = ['#f3c35f', '#f3c96f', '#f6d690', '#fff1cf', '#ffffff', '#ffffff', '#ffffff'];
const ROAD_PX = [2.6, 2.3, 2, 1.7, 1.4, 1.05, 0.8];             // minimum width on paper, CSS px
const ROAD_M = [24, 18, 14, 11, 8, 5.5, 4];
export const RED = '#c7341f', BLUE = '#1f5fa8', INK = '#111';
// arrival time of a debris flow, seconds -> colour (deep red at the release, orange where it arrives last)
const RAMP = [[0, [110, 10, 4]], [10, [168, 28, 12]], [30, [214, 66, 26]], [60, [238, 128, 40]], [120, [246, 190, 76]]];
export function arrivalRGB(t) {
  for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], f = (t - a) / (b - a); return ca.map((c, j) => Math.round(c + (cb[j] - c) * f)); }
  return RAMP[RAMP.length - 1][1];
}
export const RAMP_STOPS = RAMP.map((s) => s[0]);

// ---- our own map -----------------------------------------------------------------------------------------------------
// o: { cx, cz (grid m, centre), mpp (m per CSS px), dpr, hexR (m), flows: [flow index], ghost: [flow index],
//      fan: { r (m), az (compass °) }, ring: m (ML 3 reach circle), scale: true, north: true, legend }
// Returns the number of building footprints under the slope's own flows.
export async function vectorMap(G, cv, o) {
  const dpr = o.dpr || 3, Wc = cv.width, Hc = cv.height, mpp = o.mpp, s = dpr / mpp;
  const w = Wc / s, h = Hc / s, ox = o.cx - w / 2, oz = o.cz - h / 2;
  const g = cv.getContext('2d'), X = (mx) => (mx - ox) * s, Z = (mz) => (mz - oz) * s;
  g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, Wc, Hc);
  const W = G.W, TM = W ? W.tile_m : 4000;
  const T = W ? (await Promise.all((() => { const ps = []; for (let tz = Math.floor(oz / TM); tz <= Math.floor((oz + h) / TM); tz++) for (let tx = Math.floor(ox / TM); tx <= Math.floor((ox + w) / TM); tx++) ps.push(tile(G, tx, tz)); return ps; })())).filter(Boolean) : [];
  const at = (t) => g.setTransform(s, 0, 0, s, (t.ox - ox) * s, (t.oz - oz) * s);

  // 1 land cover at 50 m, trees darker where the canopy is taller
  const N = W ? W.cells : 80;
  for (const t of T) {
    const img = new ImageData(N, N), d = img.data;
    for (let i = 0; i < N * N; i++) {
      const v = t.ground[i], c = v >> 4, col = LC[c]; if (!col) continue;
      let r = col[0], gg = col[1], b = col[2];
      if (c === 1) { const f = clamp(((v & 15) * 2 - 6) / 22); r += (TALL[0] - r) * f; gg += (TALL[1] - gg) * f; b += (TALL[2] - b) * f; }
      d[4 * i] = r; d[4 * i + 1] = gg; d[4 * i + 2] = b; d[4 * i + 3] = 255;
    }
    const oc = document.createElement('canvas'); oc.width = oc.height = N; oc.getContext('2d').putImageData(img, 0, 0);
    at(t); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(oc, 0, 0, TM, TM);
  }
  // 2 land use and water polygons
  for (const t of T) {
    at(t); let p = 0, r = 0;
    for (let i = 0; i < t.nP; i++) {
      const c = t.pcls[i], path = new Path2D();
      for (let k = 0; k < t.pnr[i]; k++, r++) { for (let q = 0; q < t.pnv[r]; q++, p += 2) { if (q) path.lineTo(t.pxy[p], t.pxy[p + 1]); else path.moveTo(t.pxy[p], t.pxy[p + 1]); } path.closePath(); }
      const col = c === 30 ? WATER : LU[c]; if (!col) continue;
      g.fillStyle = col; g.fill(path, 'evenodd');
    }
  }
  // 3 relief: our terrain's normals as a soft shade, multiplied in
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (G.normal && o.relief !== false) shade(G, g, Wc, Hc, ox, oz, s);
  const iv = o.contours === false ? 0 : contours(G, g, Wc, Hc, ox, oz, s, dpr);
  // 4 water lines, rail, roads (casing, then fill)
  for (const t of T) {
    at(t); let p = 0; const lw = (px) => px / s;
    const paths = { road: [], rail: new Path2D(), river: new Path2D(), stream: new Path2D() };
    for (let l = 0; l < t.nL; l++) {
      const c = t.lcls[l], n = t.lnv[l], path = c < 7 ? (paths.road[c] ||= new Path2D()) : c === 10 ? paths.rail : c === 20 ? paths.river : paths.stream;
      for (let k = 0; k < n; k++, p += 2) { if (k) path.lineTo(t.lxy[p], t.lxy[p + 1]); else path.moveTo(t.lxy[p], t.lxy[p + 1]); }
    }
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = WATER_LINE; g.lineWidth = lw(1.6 * dpr); g.stroke(paths.river); g.lineWidth = lw(0.9 * dpr); g.stroke(paths.stream);
    const rs = o.roadScale ?? 1, wpx = (c) => Math.max(ROAD_PX[c] * dpr * rs, ROAD_M[c] * s * 0.7);
    for (let c = 6; c >= 0; c--) if (paths.road[c]) { g.strokeStyle = '#77736b'; g.lineWidth = lw(wpx(c) + 1.1 * dpr * rs); g.stroke(paths.road[c]); }
    for (let c = 6; c >= 0; c--) if (paths.road[c]) { g.strokeStyle = ROAD_FILL[c]; g.lineWidth = lw(wpx(c)); g.stroke(paths.road[c]); }
    g.strokeStyle = '#444'; g.lineWidth = lw(1.1 * dpr); g.setLineDash([lw(4 * dpr), lw(3 * dpr)]); g.stroke(paths.rail); g.setLineDash([]);
  }
  // 5 the flows: which 10 m cells each one covers (a hash of 10 m buckets, for finding the buildings under it)
  const mine = (o.flows || []).map((i) => G.flowCells(i)), ghost = (o.ghost || []).filter((i) => !(o.flows || []).includes(i)).map((i) => G.flowCells(i));
  const hitSet = new Set(), key = (x, z) => (Math.round(x / 10) + 2e5) * 4e5 + Math.round(z / 10) + 2e5;
  mine.forEach((f) => { for (let q = 0; q < f.n; q++) hitSet.add(key(f.xy[2 * q], f.xy[2 * q + 1])); });
  const under = (x, z) => { const a = Math.round(x / 10), b = Math.round(z / 10); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (hitSet.has((a + i + 2e5) * 4e5 + b + j + 2e5)) return true; return false; };
  // 6 the flows: other slopes' runs faint, this slope's coloured by when the debris gets there
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cell = Math.max(10 * s, 1.3 * dpr);
  const drawFlow = (f, faint) => {
    const idx = Array.from({ length: f.n }, (_, q) => q).sort((a, b) => f.t[b] - f.t[a]);
    for (const q of idx) {
      const x = X(f.xy[2 * q]), z = Z(f.xy[2 * q + 1]); if (x < -cell || z < -cell || x > Wc + cell || z > Hc + cell) continue;
      if (faint) g.fillStyle = 'rgba(199,52,31,.15)';
      else { const c = arrivalRGB(f.t[q]); g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${f.k[q] ? 0.92 : 0.5})`; }
      g.fillRect(x - cell / 2, z - cell / 2, cell, cell);
    }
  };
  ghost.forEach((f) => drawFlow(f, true)); mine.forEach((f) => drawFlow(f, false));
  // 7 buildings on top, red where a flow runs over them
  let hits = 0;
  for (const t of T) {
    at(t); let p = 0; const plain = new Path2D(), hit = new Path2D();
    for (let b = 0; b < t.nB; b++) {
      const n = t.bnv[b]; let cx = 0, cz = 0;
      for (let k = 0; k < n; k++) { cx += t.bxy[p + 2 * k]; cz += t.bxy[p + 2 * k + 1]; }
      const x = t.ox + cx / n, z = t.oz + cz / n, inView = x > ox - 50 && x < ox + w + 50 && z > oz - 50 && z < oz + h + 50;
      const isHit = inView && hitSet.size && under(x, z); if (isHit) hits++;
      const path = isHit ? hit : plain;
      for (let k = 0; k < n; k++, p += 2) { if (k) path.lineTo(t.bxy[p], t.bxy[p + 1]); else path.moveTo(t.bxy[p], t.bxy[p + 1]); }
      path.closePath();
    }
    // on a small map a house is under a pixel: an outline keeps every footprint visible
    const tiny = 12 * s < 2.2 * dpr;
    g.fillStyle = '#5b5852'; g.fill(plain); if (tiny) { g.strokeStyle = '#5b5852'; g.lineWidth = 0.8 * dpr / s; g.stroke(plain); }
    g.strokeStyle = '#fff'; g.lineWidth = 2.6 * dpr / s; g.stroke(hit);
    g.fillStyle = RED; g.fill(hit); g.strokeStyle = '#111'; g.lineWidth = (tiny ? 1.1 : 0.9) * dpr / s; g.stroke(hit);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // 8 the slope: its hexagon's circle, the ML 3 reach fan, the release point
  const [hx, hz] = [X(o.hx ?? o.cx), Z(o.hz ?? o.cz)];
  if (o.fan) {
    const a = (o.fan.az - 90) * Math.PI / 180, half = (o.fan.half || 38) * Math.PI / 180, R = o.fan.r * s;
    const grd = g.createRadialGradient(hx, hz, 0, hx, hz, R); grd.addColorStop(0, 'rgba(199,52,31,.30)'); grd.addColorStop(1, 'rgba(199,52,31,.06)');
    g.beginPath(); g.moveTo(hx, hz); g.arc(hx, hz, R, a - half, a + half); g.closePath(); g.fillStyle = grd; g.fill();
    g.setLineDash([5 * dpr, 3 * dpr]); g.strokeStyle = RED; g.lineWidth = 1.6 * dpr; g.stroke(); g.setLineDash([]);
    // an arrow along the fan's axis
    const ex = hx + Math.cos(a) * R * 0.96, ez = hz + Math.sin(a) * R * 0.96;
    g.beginPath(); g.moveTo(hx + Math.cos(a) * 8 * dpr, hz + Math.sin(a) * 8 * dpr); g.lineTo(ex, ez); g.lineWidth = 2 * dpr; g.stroke();
    g.beginPath(); g.moveTo(ex, ez); g.lineTo(ex - Math.cos(a - 0.45) * 7 * dpr, ez - Math.sin(a - 0.45) * 7 * dpr); g.lineTo(ex - Math.cos(a + 0.45) * 7 * dpr, ez - Math.sin(a + 0.45) * 7 * dpr); g.closePath(); g.fillStyle = RED; g.fill();
  }
  if (o.hexR) {
    const r = o.hexR * s;
    g.beginPath(); g.arc(hx, hz, r, 0, 7); g.setLineDash([6 * dpr, 4 * dpr]); g.strokeStyle = INK; g.lineWidth = 1.6 * dpr; g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4.2 * dpr; g.beginPath(); g.moveTo(hx - 7 * dpr, hz); g.lineTo(hx + 7 * dpr, hz); g.moveTo(hx, hz - 7 * dpr); g.lineTo(hx, hz + 7 * dpr); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 2 * dpr; g.stroke();
  }
  if (o.label) {                                               // a number in a black disc
    const r = (o.labelR || 8) * dpr; g.beginPath(); g.arc(hx, hz, r, 0, 7); g.fillStyle = INK; g.fill(); g.lineWidth = 1.4 * dpr; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = `700 ${(o.labelR || 8) * 1.15 * dpr}px Roboto, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.label, hx, hz + 0.5 * dpr);
  }
  // 9 north arrow and scale bar
  if (o.north !== false) {
    const nx = Wc - 14 * dpr, ny = 16 * dpr;
    g.beginPath(); g.moveTo(nx, ny - 10 * dpr); g.lineTo(nx + 5 * dpr, ny + 5 * dpr); g.lineTo(nx, ny + 2 * dpr); g.lineTo(nx - 5 * dpr, ny + 5 * dpr); g.closePath();
    g.fillStyle = INK; g.strokeStyle = '#fff'; g.lineWidth = 1 * dpr; g.fill(); g.stroke();
    g.font = `800 ${8.5 * dpr}px Roboto, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top'; g.lineWidth = 2.5 * dpr; g.strokeText('N', nx, ny + 6 * dpr); g.fillText('N', nx, ny + 6 * dpr);
  }
  if (o.scale !== false) {
    const len = [20, 50, 100, 200, 250, 500, 1000, 2000, 5000].filter((m) => m * s <= Wc * 0.3).pop() || 20, bx = 8 * dpr, by = Hc - 9 * dpr, bw = len * s;
    const ct = iv ? `  ·  ${o.ko ? '등고선' : 'contours'} ${iv} m` : '';
    g.font = `700 ${8 * dpr}px "Roboto Mono", ui-monospace, monospace`;
    g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(bx - 4 * dpr, by - 14 * dpr, Math.max(bw, g.measureText((len >= 1000 ? len / 1000 + ' km' : len + ' m') + ct).width) + 8 * dpr, 19 * dpr);
    g.strokeStyle = INK; g.lineWidth = 1.5 * dpr; g.beginPath(); g.moveTo(bx, by - 3 * dpr); g.lineTo(bx, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by - 3 * dpr); g.stroke();
    g.fillStyle = INK; g.font = `700 ${8 * dpr}px "Roboto Mono", ui-monospace, monospace`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText((len >= 1000 ? len / 1000 + ' km' : len + ' m') + ct, bx, by - 5 * dpr);
  }
  return hits;
}

// relief from our terrain's normal map, multiplied over the map (light, so it never fights the data)
function shade(G, g, Wc, Hc, ox, oz, s) {
  const D = G.D, im = G.normal, sx = im.width / D.Wkm, sy = im.height / D.Hkm;
  // local affine: grid metres -> normal-map pixels, from three points
  const cx = ox + Wc / s / 2, cz = oz + Hc / s / 2, p0 = G.mToKm(cx, cz), p1 = G.mToKm(cx + 1000, cz), p2 = G.mToKm(cx, cz + 1000);
  const a = (p1[0] - p0[0]) * sx / 1000, b = (p1[1] - p0[1]) * sy / 1000, c = (p2[0] - p0[0]) * sx / 1000, d = (p2[1] - p0[1]) * sy / 1000;
  const e = p0[0] * sx - a * cx - c * cz, f = p0[1] * sy - b * cx - d * cz;
  // image pixel -> canvas pixel is the inverse of (canvas -> metres -> image)
  const A = a / s, B = b / s, Cc = c / s, Dd = d / s, E = a * ox + c * oz + e, F = b * ox + d * oz + f, det = A * Dd - B * Cc;
  const oc = document.createElement('canvas'); oc.width = Wc; oc.height = Hc;
  const q = oc.getContext('2d', { willReadFrequently: true });
  q.fillStyle = 'rgb(128,128,255)'; q.fillRect(0, 0, Wc, Hc);
  q.setTransform(Dd / det, -B / det, -Cc / det, A / det, (Cc * F - Dd * E) / det, (B * E - A * F) / det);
  q.imageSmoothingEnabled = true; q.imageSmoothingQuality = 'high'; q.drawImage(im, 0, 0);
  q.setTransform(1, 0, 0, 1, 0, 0);
  const px = q.getImageData(0, 0, Wc, Hc), v = px.data;
  for (let i = 0; i < v.length; i += 4) {
    const nx = (v[i] / 255 - 0.5) * 2.4, ny = (v[i + 1] / 255 - 0.5) * 2.4, l = 1 / Math.hypot(nx * 2, ny * 2, 1);
    const sh = clamp((-0.55 * nx * 2 + 0.55 * ny * 2 + 0.63) * l * 1.15), val = 168 + 87 * sh;
    v[i] = v[i + 1] = v[i + 2] = val; v[i + 3] = 255;
  }
  q.putImageData(px, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.drawImage(oc, 0, 0); g.globalCompositeOperation = 'source-over';
}

// contour lines from our terrain grid (bilinear, sampled every ~7 CSS px, marching squares). Returns the interval.
function contours(G, g, Wc, Hc, ox, oz, s, dpr) {
  const D = G.D; if (!D.hAt) return 0;
  const st = 7 * dpr, nx = Math.ceil(Wc / st) + 1, nz = Math.ceil(Hc / st) + 1, E = new Float32Array(nx * nz);
  let lo = 1e9, hi = -1e9;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const km = G.mToKm(ox + i * st / s, oz + j * st / s), e = D.hAt(D.sx(km[0]), D.sz(km[1])) * 1000 * D.k;
    E[j * nx + i] = e; if (e < lo) lo = e; if (e > hi) hi = e;
  }
  const iv = [5, 10, 20, 25, 50, 100, 200].find((v) => (hi - lo) / v <= 22) || 250;
  const minor = new Path2D(), major = new Path2D();
  for (let L = Math.ceil(lo / iv) * iv; L <= hi; L += iv) {
    const path = Math.round(L / iv) % 5 === 0 ? major : minor;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = E[j * nx + i], b = E[j * nx + i + 1], c = E[(j + 1) * nx + i + 1], d = E[(j + 1) * nx + i];
      const k = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0); if (k === 0 || k === 15) continue;
      const x = i * st, y = j * st, t = (p, q) => (L - p) / (q - p);
      const T = [x + st * t(a, b), y], R = [x + st, y + st * t(b, c)], B = [x + st * t(d, c), y + st], Lf = [x, y + st * t(a, d)];
      const seg = (p, q) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
      switch (k) {
        case 1: case 14: seg(Lf, B); break; case 2: case 13: seg(B, R); break; case 3: case 12: seg(Lf, R); break;
        case 4: case 11: seg(T, R); break; case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, T); break;
        case 5: seg(Lf, T); seg(B, R); break; case 10: seg(T, R); seg(Lf, B); break;
      }
    }
  }
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(150,100,52,.42)'; g.lineWidth = 0.55 * dpr; g.stroke(minor);
  g.strokeStyle = 'rgba(140,88,40,.7)'; g.lineWidth = 1.05 * dpr; g.stroke(major);
  return iv;
}

// the box (grid m) a slope's map should show: its hexagon, its flows and its reach, padded, at least `min` m across
export function frameFor(G, u, { flows = [], reach = 0, aspect = 0, min = 600, pad = 1.18, aspectRatio = 1 } = {}) {
  const [mx, mz] = G.unit(u); let x0 = mx - G.cellR, x1 = mx + G.cellR, z0 = mz - G.cellR, z1 = mz + G.cellR;
  flows.forEach((i) => { const f = G.flowCells(i); for (let q = 0; q < f.n; q++) { x0 = Math.min(x0, f.xy[2 * q]); x1 = Math.max(x1, f.xy[2 * q]); z0 = Math.min(z0, f.xy[2 * q + 1]); z1 = Math.max(z1, f.xy[2 * q + 1]); } });
  if (reach) { const a = aspect * Math.PI / 180; for (const d of [-0.66, 0, 0.66]) { const x = mx + Math.sin(a + d) * reach, z = mz - Math.cos(a + d) * reach; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
  let w = Math.max(x1 - x0, min) * pad, h = Math.max(z1 - z0, min / aspectRatio) * pad;
  if (w / h > aspectRatio) h = w / aspectRatio; else w = h * aspectRatio;
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w, h, hx: mx, hz: mz };
}

// ---- OpenStreetMap raster tiles --------------------------------------------------------------------------------------
const mxOf = (lon) => (lon + 180) / 360, myOf = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
// a map W x H CSS px, either centred (lat, lon, z) or fitted to points [[lat, lon]...] (fit, maxZ)
export function osmMap({ W, H, lat, lon, z, fit, maxZ = 14, minZ = 7 }) {
  let zf, cxm, cym;
  if (fit) {
    let a0 = 1, a1 = 0, b0 = 1, b1 = 0; fit.forEach(([la, lo]) => { const a = mxOf(lo), b = myOf(la); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); });
    zf = Math.min(maxZ, Math.max(minZ, Math.log2(Math.min(W * 0.86 / (256 * Math.max(a1 - a0, 1e-7)), H * 0.8 / (256 * Math.max(b1 - b0, 1e-7))))));
    cxm = (a0 + a1) / 2; cym = (b0 + b1) / 2;
  } else { zf = z; cxm = mxOf(lon); cym = myOf(lat); }
  const zi = Math.ceil(zf), S = 256 * 2 ** (zf - zi), n = 2 ** zi, fx = cxm * n - W / 2 / S, fy = cym * n - H / 2 / S;
  const clat = 90 - 360 * Math.atan(Math.exp((cym - 0.5) * 2 * Math.PI)) / Math.PI, mpp = 156543.03392 * Math.cos(clat * Math.PI / 180) / 2 ** zf;
  let t = '';
  for (let ty = Math.floor(fy); ty < fy + H / S; ty++) for (let tx = Math.floor(fx); tx < fx + W / S; tx++)
    t += `<img alt="" src="https://tile.openstreetmap.org/${zi}/${tx}/${ty}.png" style="left:${((tx - fx) * S).toFixed(2)}px;top:${((ty - fy) * S).toFixed(2)}px;width:${(S + 0.5).toFixed(2)}px;height:${(S + 0.5).toFixed(2)}px" onerror="this.remove()">`;
  const px = (la, lo) => [(mxOf(lo) * n - fx) * S, (myOf(la) * n - fy) * S];
  const len = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].filter((m) => m / mpp <= W * 0.22).pop() || 100, bar = len / mpp;
  const deco = `<g transform="translate(${W - 20} 22)"><path d="M0 -14L6 6L0 2L-6 6Z" fill="#111" stroke="#fff" stroke-width="1"/><text y="19" text-anchor="middle" font-size="10" font-weight="800" stroke="#fff" stroke-width="2.5" paint-order="stroke">N</text></g>
    <g transform="translate(10 ${H - 10})"><rect x="-4" y="-15" width="${(bar + 8).toFixed(1)}" height="21" fill="rgba(255,255,255,.88)"/><path d="M0 -3V0H${bar.toFixed(1)}V-3" stroke="#111" stroke-width="1.5" fill="none"/><text x="1" y="-5" font-size="8.5" font-weight="700" font-family="Roboto Mono, monospace">${len >= 1000 ? len / 1000 + ' km' : len + ' m'}</text></g>`;
  return { W, H, zf, mpp, px, tiles: t, deco };
}

// flows drawn over an OSM map: cells through the local lat/lon fit, as small squares (at least 1.4 px)
export function flowsOnOSM(G, cv, m, flows, toLL, { dpr = 2, faint = false } = {}) {
  const g = cv.getContext('2d'), r = Math.max(1.4, 10 / m.mpp) * dpr;
  flows.forEach((i) => {
    const f = G.flowCells(i);
    for (let q = 0; q < f.n; q++) {
      const [la, lo] = toLL(f.xy[2 * q], f.xy[2 * q + 1]), [x, y] = m.px(la, lo);
      if (x < -4 || y < -4 || x > m.W + 4 || y > m.H + 4) continue;
      const c = arrivalRGB(f.t[q]); g.fillStyle = faint ? 'rgba(199,52,31,.5)' : `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(x * dpr - r / 2, y * dpr - r / 2, r, r);
    }
  });
}

// hillshade under an OSM map (shows where tiles fail to load), from the normal map around (ckm) at mpp m/px
export function osmHillshade(G, cv, ckm, mpp) {
  const D = G.D, im = G.normal; if (!im) return;
  const W = cv.width, H = cv.height, g = cv.getContext('2d', { willReadFrequently: true }), km = mpp / 1000, w = W * km, h = H * km, sx = im.width / D.Wkm, sy = im.height / D.Hkm;
  g.fillStyle = '#eee'; g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high'; g.drawImage(im, (ckm[0] - w / 2) * sx, (ckm[1] - h / 2) * sy, w * sx, h * sy, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H), d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const nx = (d[i] / 255 - 0.5) * 2.4, ny = (d[i + 1] / 255 - 0.5) * 2.4, l = 1 / Math.hypot(nx * 2, ny * 2, 1);
    d[i] = d[i + 1] = d[i + 2] = 150 + 105 * clamp((-0.55 * nx * 2 + 0.55 * ny * 2 + 0.63) * l * 1.15);
  }
  g.putImageData(px, 0, 0);
}

// ---- the radar time-series inversion of one slope --------------------------------------------------------------------
// The passes of each usable track projected onto the slope line (same arithmetic as p04b and the map's slope panel),
// and the solved model. The nationwide cells carry the model only, so no dots there.
export function solverData(D, u) {
  const C = D.col;
  if (!C.vd || !Number.isFinite(C.vd[u]) || !(C.vds[u] > 0)) return null;
  const Ts = Math.round((Date.parse(D.meta.storm[0]) - Date.UTC(2026, 5, 1)) / 864e5), f = (a) => (Number.isFinite(a) ? a : 0);
  const vpre = f(C.vpre?.[u]), step = f(C.vstep?.[u]), v = C.vd[u];
  const model = (t) => vpre * (Math.min(t, Ts) - Ts) / 30 + (t >= Ts ? step : 0) + v * Math.max(t - Ts, 0) / 30;
  const tracks = [];
  if (C.cpost) D.tracks.forEach((tr, i) => {
    const sn = C['sens_' + tr.id][u]; let prev = D.cum(u, i, 0);
    if (!C['meas_' + tr.id][u] || !(Math.abs(sn) >= 0.25) || !Number.isFinite(prev)) return;
    const days = tr.days, mm = [model(days[0])]; let acc = mm[0];
    for (let k = 1; k < days.length; k++) {
      const cur = D.cum(u, i, k), a = days[k - 1], b = days[k];
      if (!Number.isFinite(cur)) { acc += model(b) - model(a); mm.push(null); continue; }
      const shared = f(C.cpre[u]) * Math.max(Math.min(b, Ts) - a, 0) / 30 + (a < Ts && b >= Ts ? f(C.cstep[u]) : 0) + f(C.cpost[u]) * Math.max(b - Math.max(a, Ts), 0) / 30;
      acc += ((cur - prev) * 10 - shared) / sn; prev = cur; mm.push(acc);
    }
    tracks.push({ id: tr.id, k: i, days, mm });
  });
  return { u, v, s: C.vds[u], z: v / C.vds[u], v_pre: vpre, step, Ts, moving: !!C.moving[u], tracks, model };
}

const MARK = ['circle', 'square', 'diamond'];
function marker(kind, x, y, r) {
  if (kind === 'square') return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}"/>`;
  if (kind === 'diamond') return `<path d="M${x.toFixed(1)} ${(y - r * 1.3).toFixed(1)}l${r * 1.3} ${r * 1.3}l${-r * 1.3} ${r * 1.3}l${-r * 1.3} ${-r * 1.3}z"/>`;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
}
export function solverSVG(e, lang, { W = 660, H = 190 } = {}) {
  const K = lang === 'ko', l = 40, r = 10, t = 12, b = 24, D0 = 15, D1 = 150;
  const pts = []; e.tracks.forEach((tr) => tr.days.forEach((d, j) => { if (tr.mm[j] !== null && Number.isFinite(tr.mm[j])) pts.push({ d, v: tr.mm[j], k: tr.k }); }));
  const first = pts.length ? Math.min(...pts.map((p) => p.d)) : 21, last = pts.length ? Math.max(...pts.map((p) => p.d)) : 142, Ts = e.Ts;
  const half = (d) => 2 * e.s * Math.max(d - Ts, 0) / 30;
  let lo = Math.min(...pts.map((p) => p.v), e.model(first), e.model(last) - half(last), 0), hi = Math.max(...pts.map((p) => p.v), e.model(first), e.model(last) + half(last), 0);
  const pad = Math.max((hi - lo) * 0.12, 4); lo -= pad; hi += pad; if (hi - lo < 30) { const m = (hi + lo) / 2; lo = m - 15; hi = m + 15; }
  const x = (d) => l + (d - D0) / (D1 - D0) * (W - l - r), y = (v) => t + (hi - v) / (hi - lo) * (H - t - b);
  const step = [2, 5, 10, 20, 50, 100].find((s) => (hi - lo) / s <= 6) || 200, ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = [[first, e.model(first)], [Ts - 0.01, e.model(Ts - 0.01)], [Ts, e.model(Ts)], [last, e.model(last)]];
  const band = `M${x(Ts)} ${y(e.model(Ts))}L${x(last)} ${y(e.model(last) + half(last))}L${x(last)} ${y(e.model(last) - half(last))}Z`;
  const M = [[30, 'Jul', '7월'], [61, 'Aug', '8월'], [92, 'Sep', '9월'], [122, 'Oct', '10월']];
  return `<svg viewBox="0 0 ${W} ${H}" font-size="9.5" font-family="Roboto Mono, ui-monospace, monospace">
    ${ticks.map((v) => `<path d="M${l} ${y(v).toFixed(1)}H${W - r}" stroke="${v ? '#d6d4ce' : '#111'}" stroke-width="${v ? .6 : 1}"/><text x="${l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`).join('')}
    ${M.map(([d, en, ko]) => `<path d="M${x(d)} ${H - b}v4" stroke="#111"/><text x="${x(d) + 3}" y="${H - 8}">${K ? ko : en}</text>`).join('')}
    <path d="M${x(Ts)} ${t}V${H - b}" stroke="${RED}" stroke-width="1.2" stroke-dasharray="3 2"/><text x="${x(Ts) + 4}" y="${t + 9}" fill="${RED}" font-weight="700">${K ? '폭우' : 'storm'}</text>
    <path d="${band}" fill="${e.moving ? 'rgba(199,52,31,.18)' : 'rgba(31,95,168,.14)'}"/>
    <g fill="#fff" stroke="#111" stroke-width="1">${pts.map((p) => marker(MARK[p.k % 3], x(p.d), y(p.v), 2.6)).join('')}</g>
    <path d="${line.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${e.moving ? RED : BLUE}" stroke-width="2.4"/>
    <rect x="${l}" y="${t}" width="${W - l - r}" height="${H - t - b}" fill="none" stroke="#111" stroke-width=".8"/>
  </svg>`;
}
export const solverLegend = (e, lang) => e.tracks.map((tr) => `<svg width="9" height="9" viewBox="-5 -5 10 10" style="vertical-align:-1px"><g fill="#fff" stroke="#111">${marker(MARK[tr.k % 3], 0, 0, 3.2)}</g></svg> ${lang === 'ko' ? '궤도' : 'track'} ${tr.id}`).join(' &nbsp; ');

// a little horizontal bar for tables: value 0-1
export const bar = (f, col = INK, w = 18) => `<span class="mbar"${w ? ` style="width:${w}mm"` : ''}><i style="width:${(clamp(f) * 100).toFixed(0)}%;background:${col}"></i></span>`;

// a QR code (qrcode-generator, loaded by the page) as inline SVG
export function qrSVG(text) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}
