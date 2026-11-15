// Worker for the real-world layers (see world.js). Everything heavy happens here so the map never stutters:
//   - fetches and unpacks the 4 km tiles of data/world/t/ (format: pipeline/world/w02_tiles.py)
//   - builds the 3D buildings of a tile, every footprint standing on the drawn terrain
//   - paints the ground around the camera (land cover, land use, water, roads, railways) into one picture that the
//     terrain shader lays over the relief
//   - scatters trees where the land cover is forest, as tall as NASA GEDI measured the canopy
import { makeGeo } from './world-geo.js';

let C = null, G = null, P = null;                               // config, geometry helpers, palette
const tiles = new Map();                                         // key -> Promise<tile | null>
const MAX_TILES = 640;
const ROAD_MIN_PX = [2.4, 2.1, 1.7, 1.4, 1.15, 0.9, 0.7];

async function inflate(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return u;
  return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

// undo the per-ring differences: int16 pairs -> metres from the tile's corner
function rings(xy, nv, q) {
  const out = new Float32Array(xy.length);
  let p = 0;
  for (let r = 0; r < nv.length; r++) {
    let x = 0, y = 0;
    for (let v = 0; v < nv[r]; v++, p += 2) { x += xy[p]; y += xy[p + 1]; out[p] = x * q; out[p + 1] = y * q; }
  }
  return out;
}

function loadTile(key) {
  let t = tiles.get(key);
  if (t) { tiles.delete(key); tiles.set(key, t); return t; }    // most recently used last
  if (!C.have.has(key)) return Promise.resolve(null);
  const tx = key % C.ntx, tz = (key - tx) / C.ntx;
  t = fetch(`${C.base}t/${tx}_${tz}.bin.gz`).then((r) => (r.ok ? r.arrayBuffer() : null)).then(async (buf) => {
    if (!buf) return null;
    const u = await inflate(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const [nB, nBv, nL, nLv, nP, nPr, nPv] = [4, 8, 12, 16, 20, 24, 28].map((o) => dv.getUint32(o, true));
    let o = 32;
    const u8 = (n) => { const a = u.subarray(o, o + n); o += n; return a; };
    const u16 = (n) => { const a = new Uint16Array(u.buffer.slice(u.byteOffset + o, u.byteOffset + o + n * 2)); o += n * 2; return a; };
    const i16 = (n) => { const a = new Int16Array(u.buffer.slice(u.byteOffset + o, u.byteOffset + o + n * 2)); o += n * 2; return a; };
    const T = { key, tx, tz, ox: tx * C.tile, oz: tz * C.tile, nB, nL, nP };
    T.bnv = u8(nB); T.bcls = u8(nB); T.bh = u16(nB); T.bxy = rings(i16(nBv * 2), T.bnv, C.q);
    T.lcls = u8(nL); T.lnv = u16(nL); T.lxy = rings(i16(nLv * 2), T.lnv, C.q);
    T.pcls = u8(nP); T.pnr = u8(nP); T.pnv = u16(nPr); T.pxy = rings(i16(nPv * 2), T.pnv, C.q);
    T.ground = u8(C.cells * C.cells);
    return T;
  }).catch(() => null);
  tiles.set(key, t);
  if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
  return t;
}

// ---- buildings ----------------------------------------------------------------------------------------------------
// Triangles of a simple polygon (ear clipping). xs, zs: n points; writes n - 2 triangles of indices (+ base) into out,
// wound so that they face up (the buildings are drawn one-sided).
function earclip(xs, zs, n, out, o, base) {
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += xs[j] * zs[i] - xs[i] * zs[j];
  const V = new Array(n);
  for (let i = 0; i < n; i++) V[i] = area > 0 ? i : n - 1 - i;
  let nv = n, guard = n * 2, i = 0;
  while (nv > 3 && guard-- > 0) {
    const a = V[(i + nv - 1) % nv], b = V[i % nv], c = V[(i + 1) % nv];
    const ax = xs[a], az = zs[a], bx = xs[b], bz = zs[b], cx = xs[c], cz = zs[c];
    let ear = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 1e-12;
    if (ear) for (let k = 0; k < nv; k++) {
      const p = V[k]; if (p === a || p === b || p === c) continue;
      const px = xs[p], pz = zs[p];
      const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), d2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx), d3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
      if (d1 >= 0 && d2 >= 0 && d3 >= 0) { ear = false; break; }
    }
    if (ear) { out[o++] = base + a; out[o++] = base + c; out[o++] = base + b; V.splice(i % nv, 1); nv--; guard = nv * 2; i = 0; } else i++;
  }
  for (let k = 1; k < nv - 1; k++) { out[o++] = base + V[0]; out[o++] = base + V[k + 1]; out[o++] = base + V[k]; }      // what is left (or a shape no ear was found in): a fan
  return o;
}

// Buildings are stored largest first, so a tile is built in steps: the few biggest for the far ring, more of them
// nearer, all of them close up. Each step only adds a chunk; nothing is ever rebuilt. Counts per tier: far, lite, full.
const TIERS = [[0.08, 8, 2500], [0.3, 25, 12000], [1, 40, 60000]], CHUNK = 2500;
function tierCounts(T) {
  let prev = 0;
  return TIERS.map(([f, least, cap], i) => (prev = Math.max(prev, Math.min(T.nB, Math.max(Math.ceil(T.nB * f), Math.min(T.nB, least)), i === 2 ? C.maxPerTile : cap))));
}

// Buildings b0..b1 of a tile as one mesh.
//   position  x, ground height, z      aH  metres above that ground (scene units), 0 at the foot of a wall
//   aN        wall normal x, z (signed bytes), roof flag + class, a random tint      aTop  the building's height and width in metres
function buildRange(T, b0, b1) {
  if (!T.bstart) { T.bstart = new Uint32Array(T.nB + 1); for (let b = 0; b < T.nB; b++) T.bstart[b + 1] = T.bstart[b] + T.bnv[b]; }
  const nvTot = T.bstart[b1] - T.bstart[b0];
  const pos = new Float32Array(nvTot * 5 * 3), hgt = new Float32Array(nvTot * 5), att = new Int8Array(nvTot * 5 * 4), top = new Uint8Array(nvTot * 5 * 2);   // top: the building's height and width in metres on every vertex, for the shader to size it on screen
  const idx = new Uint32Array(nvTot * 9);
  const xs = new Float64Array(256), zs = new Float64Array(256), gs = new Float64Array(256);
  const sink = 2.5 / G.mPerUnit;                                // walls go this far into the ground, so none floats on a slope
  let v = 0, ii = 0, p = T.bstart[b0] * 2, kept = 0;
  for (let b = b0; b < b1; b++) {
    const n = T.bnv[b], h = T.bh[b] / 10 / G.mPerUnit, cls = T.bcls[b];
    let gmin = 1e9, gmax = -1e9, ok = true;
    for (let k = 0; k < n; k++, p += 2) {
      const s = G.toScene(T.ox + T.bxy[p], T.oz + T.bxy[p + 1]);
      xs[k] = s[0]; zs[k] = s[1];
      if (!G.inside(s[0], s[1])) ok = false;
      const g = gs[k] = G.surface(s[0], s[1]); if (g < gmin) gmin = g; if (g > gmax) gmax = g;
    }
    if (!ok) continue;
    kept++;
    const tint = ((Math.imul(b + 1, 2654435761) ^ Math.imul(T.key + 7, 40503)) >>> 9) % 255 - 127, hm = Math.min(255, T.bh[b] / 10);
    let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += xs[j] * zs[i] - xs[i] * zs[j];
    const wide = Math.min(255, Math.sqrt(Math.abs(area) / 2) * G.mPerUnit);
    for (let k = v * 2, e = (v + n * 5) * 2; k < e; k += 2) { top[k] = hm; top[k + 1] = wide; }
    // the roof is level, at the height of the highest corner of the footprint plus the building's height
    const r0 = v;
    for (let k = 0; k < n; k++, v++) { pos[v * 3] = xs[k]; pos[v * 3 + 1] = gmax; pos[v * 3 + 2] = zs[k]; hgt[v] = h; att[v * 4] = 0; att[v * 4 + 1] = 0; att[v * 4 + 2] = 64 + cls; att[v * 4 + 3] = tint; }
    ii = earclip(xs, zs, n, idx, ii, r0);
    const sgn = area > 0 ? 1 : -1, foot = gmin - sink;
    for (let k = 0; k < n; k++) {
      const m = (k + 1) % n, dx = xs[m] - xs[k], dz = zs[m] - zs[k], len = Math.hypot(dx, dz) || 1;
      const nx = Math.round(sgn * dz / len * 127), nz = Math.round(-sgn * dx / len * 127);
      for (let c = 0; c < 4; c++, v++) {
        const e = c & 1 ? m : k, top = c >= 2;
        pos[v * 3] = xs[e]; pos[v * 3 + 1] = top ? gmax : foot; pos[v * 3 + 2] = zs[e]; hgt[v] = top ? h : 0;
        att[v * 4] = nx; att[v * 4 + 1] = nz; att[v * 4 + 2] = cls; att[v * 4 + 3] = tint;
      }
      const q = v - 4;
      if (sgn > 0) { idx[ii++] = q; idx[ii++] = q + 2; idx[ii++] = q + 1; idx[ii++] = q + 1; idx[ii++] = q + 2; idx[ii++] = q + 3; } else { idx[ii++] = q; idx[ii++] = q + 1; idx[ii++] = q + 2; idx[ii++] = q + 1; idx[ii++] = q + 3; idx[ii++] = q + 2; }
    }
  }
  return { pos: pos.slice(0, v * 3), hgt: hgt.slice(0, v), att: att.slice(0, v * 4), top: top.slice(0, v * 2), idx: idx.slice(0, ii), n: kept };
}

// ---- the ground picture ---------------------------------------------------------------------------------------------
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const LU_COLOUR = () => ({ 40: P.farmland, 41: P.orchard, 42: P.park, 43: P.residential, 44: P.industrial, 45: P.commercial, 46: P.institution, 47: P.cemetery, 48: P.rock, 50: P.sand, 51: P.rock, 52: P.land[8] });

// scene coordinates of a tile's lines and polygons, as canvas paths (built once per tile, drawn at any zoom)
function tilePaths(T) {
  if (T.paths) return T.paths;
  const road = Array.from({ length: 7 }, () => null), wl = {}, lu = {}, pa = { road, wl, lu, rail: null, water: null };
  let p = 0;
  for (let l = 0; l < T.nL; l++) {
    const c = T.lcls[l], n = T.lnv[l];
    let path;
    if (c < 7) path = road[c] ||= new Path2D(); else if (c === 10) path = pa.rail ||= new Path2D(); else path = wl[c] ||= new Path2D();
    for (let k = 0; k < n; k++, p += 2) { const s = G.toScene(T.ox + T.lxy[p], T.oz + T.lxy[p + 1]); if (k) path.lineTo(s[0], s[1]); else path.moveTo(s[0], s[1]); }
  }
  p = 0; let r = 0;
  for (let i = 0; i < T.nP; i++) {
    const c = T.pcls[i], path = c === 30 ? (pa.water ||= new Path2D()) : (lu[c] ||= new Path2D());
    for (let k = 0; k < T.pnr[i]; k++, r++) {
      const n = T.pnv[r];
      for (let q = 0; q < n; q++, p += 2) { const s = G.toScene(T.ox + T.pxy[p], T.oz + T.pxy[p + 1]); if (q) path.lineTo(s[0], s[1]); else path.moveTo(s[0], s[1]); }
      path.closePath();
    }
  }
  // the land cover of the tile as a small picture, one pixel per 50 m cell
  const N = C.cells, img = new ImageData(N, N), d = img.data, pal = P.land.map(hexRGB), tall = hexRGB(P.tree_tall);
  for (let i = 0; i < N * N; i++) {
    const g = T.ground[i], c = g >> 4, col = pal[c] || pal[0];
    let R = col[0], Gc = col[1], B = col[2];
    if (c === 1) { const f = Math.min(1, Math.max(0, ((g & 15) * 2 - 6) / 16)); R += (tall[0] - R) * f; Gc += (tall[1] - Gc) * f; B += (tall[2] - B) * f; }
    d[i * 4] = R; d[i * 4 + 1] = Gc; d[i * 4 + 2] = B; d[i * 4 + 3] = c ? 255 : 0;
  }
  const cv = new OffscreenCanvas(N, N); cv.getContext('2d').putImageData(img, 0, 0);
  const a = G.toScene(T.ox, T.oz).slice(), b = G.toScene(T.ox + C.tile, T.oz).slice(), c2 = G.toScene(T.ox, T.oz + C.tile).slice();
  pa.ground = { cv, m: [(b[0] - a[0]) / N, (b[1] - a[1]) / N, (c2[0] - a[0]) / N, (c2[1] - a[1]) / N, a[0], a[1]] };
  return (T.paths = pa);
}

// Buildings on the ground picture. Far from the camera a building is a few pixels: drawn as geometry it would flicker
// from pixel to pixel, painted into the picture it is filtered like the rest of the ground and holds still.
//   close up (a texel under 2.5 m): the footprints themselves, as one path per tile
//   further out: a 320 x 320 mask of the tile's footprints (12.5 m texels), drawn once and reused at every zoom
const MASK = 320;
function bldPath(T) {
  if (T.bpath !== undefined) return T.bpath;
  if (!T.nB) return (T.bpath = null);
  const path = new Path2D(); let p = 0;
  for (let b = 0; b < T.nB; b++) {
    for (let k = 0; k < T.bnv[b]; k++, p += 2) { const s = G.toScene(T.ox + T.bxy[p], T.oz + T.bxy[p + 1]); if (k) path.lineTo(s[0], s[1]); else path.moveTo(s[0], s[1]); }
    path.closePath();
  }
  return (T.bpath = path);
}
function bldMask(T) {
  if (T.mask !== undefined) return T.mask;
  if (!T.nB) return (T.mask = null);
  const cv = new OffscreenCanvas(MASK, MASK), c = cv.getContext('2d'), s = MASK / C.tile;
  c.setTransform(s, 0, 0, s, 0, 0); c.fillStyle = P.building_flat;
  let p = 0; c.beginPath();
  for (let b = 0; b < T.nB; b++) {
    for (let k = 0; k < T.bnv[b]; k++, p += 2) { if (k) c.lineTo(T.bxy[p], T.bxy[p + 1]); else c.moveTo(T.bxy[p], T.bxy[p + 1]); }
    c.closePath();
    if ((b & 1023) === 1023) { c.fill(); c.beginPath(); }
  }
  c.fill();
  return (T.mask = cv);
}
const pause = () => new Promise((r) => setTimeout(r));

let canvas = null, ctx = null;
async function drawDetail({ cx, cz, half, px }) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!canvas || canvas.width !== px) { canvas = new OffscreenCanvas(px, px); ctx = canvas.getContext('2d'); }
  // every tile the window touches
  const keys = new Set();
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const g = G.toGrid(cx + dx * half, cz + dz * half); keys.add(`${g[0]},${g[1]}`); }
  let x0 = 1e12, x1 = -1e12, z0 = 1e12, z1 = -1e12;
  for (const s of keys) { const [x, z] = s.split(',').map(Number); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const want = [];
  for (let tz = Math.max(0, Math.floor(z0 / C.tile)); tz <= Math.min(C.ntz - 1, Math.floor(z1 / C.tile)); tz++)
    for (let tx = Math.max(0, Math.floor(x0 / C.tile)); tx <= Math.min(C.ntx - 1, Math.floor(x1 / C.tile)); tx++) want.push(tz * C.ntx + tx);
  const list = (await Promise.all(want.map(loadTile))).filter(Boolean).map((T) => tilePaths(T) && T);
  const s = px / (2 * half), unitPx = 1 / s, mpp = unitPx * G.mPerUnit;        // scene units and metres per pixel
  if (mpp >= 2.5 && mpp < 45) {                                 // the masks first, a few at a time, so building requests are not kept waiting
    let t0 = performance.now();
    for (const T of list) if (T.mask === undefined) { bldMask(T); if (performance.now() - t0 > 24) { await pause(); t0 = performance.now(); } }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
  const base = () => ctx.setTransform(s, 0, 0, s, -(cx - half) * s, -(cz - half) * s);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const T of list) { const g = T.paths.ground; base(); ctx.transform(...g.m); ctx.drawImage(g.cv, 0, 0); }
  base(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const LU = LU_COLOUR();
  ctx.globalAlpha = 0.82;
  for (const c of [43, 44, 45, 46, 40, 41, 42, 47, 48, 50, 51, 52]) {
    ctx.fillStyle = LU[c];
    for (const T of list) if (T.paths.lu[c]) ctx.fill(T.paths.lu[c], 'evenodd');
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = P.water; for (const T of list) if (T.paths.water) ctx.fill(T.paths.water, 'evenodd');
  ctx.strokeStyle = P.water_line;
  for (const [c, wm, minPx] of [[21, 3, 0.8], [22, 5, 0.9], [20, 12, 1.4]]) {
    if (c === 21 && mpp > 14) continue;
    ctx.lineWidth = Math.max(wm / G.mPerUnit, minPx * unitPx);
    for (const T of list) if (T.paths.wl[c]) ctx.stroke(T.paths.wl[c]);
  }
  for (let c = 6; c >= 0; c--) {
    if ((c === 6 && mpp > 9) || (c === 5 && mpp > 22)) continue;
    ctx.strokeStyle = P.road[c]; ctx.lineWidth = Math.max(P.road_w[c] / G.mPerUnit, ROAD_MIN_PX[c] * unitPx);
    for (const T of list) if (T.paths.road[c]) ctx.stroke(T.paths.road[c]);
  }
  ctx.strokeStyle = P.rail; ctx.lineWidth = Math.max(5 / G.mPerUnit, 1.3 * unitPx); ctx.setLineDash([9 * unitPx, 5 * unitPx]); ctx.lineCap = 'butt';
  for (const T of list) if (T.paths.rail) ctx.stroke(T.paths.rail);
  ctx.setLineDash([]);
  if (mpp < 2.5) { ctx.fillStyle = P.building_flat; for (const T of list) { const b = bldPath(T); if (b) ctx.fill(b); } }
  else if (mpp < 45) for (const T of list) if (T.mask) { const g = T.paths.ground.m, k = C.cells / MASK; base(); ctx.transform(g[0] * k, g[1] * k, g[2] * k, g[3] * k, g[4], g[5]); ctx.drawImage(T.mask, 0, 0); }
  return canvas.transferToImageBitmap();
}

// ---- trees ------------------------------------------------------------------------------------------------------------
// Where a tree may not stand inside a tile: buildings, roads, water, fields and yards. 20 m cells.
const OCC = 200;
function occupancy(T) {
  if (T.occ) return T.occ;
  const cv = new OffscreenCanvas(OCC, OCC), c = cv.getContext('2d'), s = OCC / C.tile;
  c.setTransform(s, 0, 0, s, 0, 0); c.fillStyle = c.strokeStyle = '#000'; c.lineCap = 'round';
  let p = 0;
  c.beginPath();
  for (let b = 0; b < T.nB; b++) { for (let k = 0; k < T.bnv[b]; k++, p += 2) { if (k) c.lineTo(T.bxy[p], T.bxy[p + 1]); else c.moveTo(T.bxy[p], T.bxy[p + 1]); } c.closePath(); }
  c.fill(); c.lineWidth = 14; c.stroke();                       // a little clearance around every house
  p = 0;
  for (let l = 0; l < T.nL; l++) {
    const cl = T.lcls[l]; c.beginPath();
    for (let k = 0; k < T.lnv[l]; k++, p += 2) { if (k) c.lineTo(T.lxy[p], T.lxy[p + 1]); else c.moveTo(T.lxy[p], T.lxy[p + 1]); }
    c.lineWidth = cl < 7 ? P.road_w[cl] + 10 : cl === 20 ? 30 : 12; c.stroke();
  }
  p = 0; let r = 0;
  for (let i = 0; i < T.nP; i++) {
    const cl = T.pcls[i], block = cl === 30 || cl === 40 || (cl >= 43 && cl <= 46) || cl === 48 || cl === 50;
    c.beginPath();
    for (let k = 0; k < T.pnr[i]; k++, r++) { for (let q = 0; q < T.pnv[r]; q++, p += 2) { if (q) c.lineTo(T.pxy[p], T.pxy[p + 1]); else c.moveTo(T.pxy[p], T.pxy[p + 1]); } c.closePath(); }
    if (block) c.fill('evenodd');
  }
  const d = c.getImageData(0, 0, OCC, OCC).data, occ = new Uint8Array(OCC * OCC);
  for (let i = 0; i < occ.length; i++) occ[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  return (T.occ = occ);
}

const hash = (i, j, k) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// Trees are thinned by level: level 0 is at most one tree per 26 m cell (about half stay empty, in clearings), and every level up keeps one tree of each block of
// four, chosen by a hash, at the very place it already stood. So a coarser level is a subset of the finer one and no
// tree moves when the camera rises or sinks. `rank` is the highest level a tree survives to; the shader shrinks the
// trees that are about to drop out and widens the rest, continuously (js/world.js).
// Two rings: level `level` out to `radius`, and beyond it, out to `outer`, level + 2.
// Per tree: x, ground, z, height, a random seed, rank.
const pick = (ci, cj, l) => Math.min(3, hash(ci, cj, 100 + l) * 4 | 0);
const TREE_M = 26;
// groves and clearings: a smooth noise on a ~110 m grid decides how many cells of a patch keep a tree
const grove = (x, z) => {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, 31), b = hash(i + 1, j, 31), c = hash(i, j + 1, 31), d = hash(i + 1, j + 1, 31);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
};
async function scatterTrees({ cx, cz, radius, outer, level }) {
  if (typeof OffscreenCanvas === 'undefined') return new Float32Array(0);
  const g0 = G.toGrid(cx, cz).slice(), far = Math.max(radius, outer || 0) * G.mPerUnit, N = C.cells, cell = C.tile / N;
  const want = [];
  for (let tz = Math.max(0, Math.floor((g0[1] - far) / C.tile)); tz <= Math.min(C.ntz - 1, Math.floor((g0[1] + far) / C.tile)); tz++)
    for (let tx = Math.max(0, Math.floor((g0[0] - far) / C.tile)); tx <= Math.min(C.ntx - 1, Math.floor((g0[0] + far) / C.tile)); tx++) want.push(tz * C.ntx + tx);
  const got = new Map((await Promise.all(want.map(loadTile))).filter(Boolean).map((T) => [T.key, T]));
  const out = [];
  const ring = (lvl, r0, r1, clear) => {
    const step = TREE_M * 2 ** lvl, R0 = r0 * G.mPerUnit, R1 = r1 * G.mPerUnit;
    const i0 = Math.max(0, Math.floor((g0[0] - R1) / step)), i1 = Math.ceil((g0[0] + R1) / step), j0 = Math.max(0, Math.floor((g0[1] - R1) / step)), j1 = Math.ceil((g0[1] + R1) / step);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let ci = i, cj = j;                                       // down to the 12 m cell this block keeps
      for (let l = lvl; l >= 1; l--) { const q = pick(ci, cj, l); ci = ci * 2 + (q & 1); cj = cj * 2 + (q >> 1); }
      if (hash(ci, cj, 7) < 0.25 + 0.6 * grove(ci * TREE_M / 110, cj * TREE_M / 110)) continue;   // sparse, in clumps: not an even carpet
      const mx = (ci + 0.08 + 0.84 * hash(ci, cj, 1)) * TREE_M, mz = (cj + 0.08 + 0.84 * hash(ci, cj, 2)) * TREE_M;
      const dx = mx - g0[0], dz = mz - g0[1], d2 = dx * dx + dz * dz; if (d2 > R1 * R1 || d2 < R0 * R0) continue;
      const tx = Math.floor(mx / C.tile), tz = Math.floor(mz / C.tile), T = got.get(tz * C.ntx + tx); if (!T) continue;
      const lx = mx - T.ox, lz = mz - T.oz, g = T.ground[Math.min(N - 1, lz / cell | 0) * N + Math.min(N - 1, lx / cell | 0)];
      if (g >> 4 !== 1 || (g & 15) < 2) continue;               // not forest, or hardly any canopy measured
      if (clear && occupancy(T)[Math.min(OCC - 1, lz / C.tile * OCC | 0) * OCC + Math.min(OCC - 1, lx / C.tile * OCC | 0)]) continue;
      const s = G.toScene(mx, mz); if (!G.inside(s[0], s[1])) continue;
      let rank = lvl, pi = i, pj = j;                           // how many levels further up this tree is still the one kept
      for (let l = lvl + 1; l <= 7; l++) { const q = pick(pi >> 1, pj >> 1, l); if ((q & 1) !== (pi & 1) || (q >> 1) !== (pj & 1)) break; rank++; pi >>= 1; pj >>= 1; }
      const hm = Math.max(5, (g & 15) * 2 + 1) * (0.78 + 0.44 * hash(ci, cj, 5));
      out.push(s[0], G.surface(s[0], s[1]), s[1], hm / G.mPerUnit, hash(ci, cj, 9), rank);
    }
  };
  ring(level, 0, radius, true);
  if (outer > radius) ring(level + 2, radius, outer, false);
  return new Float32Array(out);
}

// ---- messages ----------------------------------------------------------------------------------------------------------
onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === 'init') {
      C = m.cfg; C.have = new Set(C.tiles); P = { building_flat: '#857b68', ...C.palette }; G = makeGeo(C.geo);
      postMessage({ t: 'ready', canvas: typeof OffscreenCanvas !== 'undefined' });
    } else if (m.t === 'tile') {                              // build what tier m.tier needs beyond the m.have buildings the page already has
      const T = await loadTile(m.key);
      if (!T || !T.nB) return postMessage({ t: 'tile', key: m.key, counts: [0, 0, 0], done: true, n: 0 });
      const counts = tierCounts(T), target = counts[m.tier];
      if (m.have >= target) return postMessage({ t: 'tile', key: m.key, counts, done: true, n: 0 });
      const stops = [...new Set(counts.filter((c) => c > m.have && c <= target))].sort((x, y) => x - y);
      let b = m.have;
      for (const stop of stops) while (b < stop) {
        const e = Math.min(stop, b + CHUNK), r = buildRange(T, b, e);
        postMessage({ t: 'tile', key: m.key, b0: b, b1: e, counts, done: e >= target, ...r }, [r.pos.buffer, r.hgt.buffer, r.att.buffer, r.top.buffer, r.idx.buffer]);
        b = e;
      }
    } else if (m.t === 'detail') {
      const bmp = await drawDetail(m);
      postMessage({ t: 'detail', slot: m.slot, cx: m.cx, cz: m.cz, half: m.half, bmp }, bmp ? [bmp] : []);
    } else if (m.t === 'trees') {
      const data = await scatterTrees(m);
      postMessage({ t: 'trees', cx: m.cx, cz: m.cz, radius: m.radius, outer: m.outer, level: m.level, data }, [data.buffer]);
    }
  } catch (err) { postMessage({ t: 'error', of: m.t, key: m.key, id: m.id, msg: String(err && err.stack || err) }); }
};
