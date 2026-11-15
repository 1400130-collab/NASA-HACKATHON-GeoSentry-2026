// Loads everything for one map area. No server: plain static files, gzip'd binaries are inflated in the browser.
//   map.html               all of South Korea (data/korea/)
//   map.html?area=region   the North Gyeongsang burn area at 20 m with NISAR (data/)
export async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  return buf;
}
const json = (u) => fetch(u).then((r) => r.json());

export const AREA = new URLSearchParams(location.search).get('area') === 'region' ? 'region' : 'korea';
export const BASE = AREA === 'region' ? 'data/' : 'data/korea/';
export const DAY0 = Date.UTC(2026, 5, 1);
export const DAYS = 153;                                   // 1 Jun .. 31 Oct 2026
export const dayOf = (s) => {                              // 'YYYYMMDD' or 'YYYY-MM-DD' -> day index
  s = s.replace(/-/g, '');
  return (Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) - DAY0) / 864e5;
};
export const TRACKS = ['125', '032', '024'];
const REGION_IMAGES = [['prefire_20250314', '14 Mar 2025', '2025.3.14'], ['postfire_20250408', '8 Apr 2025', '2025.4.8'], ['prestorm_20260612', '12 Jun 2026', '2026.6.12'],
  ['poststorm_20260806', '6 Aug 2026', '2026.8.6'], ['poststorm_20261002', '2 Oct 2026', '2026.10.2']].map(([key, en, ko]) => ({ key, en, ko }));

export async function loadAll(onProgress, base = BASE) {
  const jobs = {
    meta: () => json(base + 'meta.json'),
    vectors: () => json(base + 'vectors.json'),
    rain: () => json(base + 'rain.json'),
    cands: () => json(base + 'candidates.json'),
    height: () => fetchBin(base + 'height.bin.gz'),
    unitid: () => fetchBin(base + 'unitid.bin.gz'),
    units: () => fetchBin(base + 'units.bin.gz'),
    series: () => fetchBin(base + 'series.bin.gz'),
    coh: () => fetchBin(base + 'coh.bin.gz'),
  };
  const out = {}; let done = 0; const n = Object.keys(jobs).length;
  await Promise.all(Object.entries(jobs).map(async ([k, f]) => { out[k] = await f(); onProgress(++done / n, k); }));

  const m = out.meta, n_ = m.units.n, korea = m.scope === 'korea';
  const f32 = new Float32Array(out.units.buffer, out.units.byteOffset, out.units.byteLength / 4);
  const col = {};
  m.units.cols.forEach((c, i) => { col[c] = f32.subarray(i * n_, (i + 1) * n_); });
  // scene coordinates: x east, z south, origin at the centre of the box. 1 scene unit = k km (k = 1 for the region),
  // so the whole country gets the same framing, camera moves and effects as the 108 km regional box.
  const k = (m.view && m.view.scale) || 1;
  const h16 = new Uint16Array(out.height.buffer, out.height.byteOffset, out.height.byteLength / 2);
  const h = new Float32Array(h16.length);
  for (let i = 0; i < h.length; i++) h[i] = h16[i] / m.grid.height_scale / 1000 / k;      // scene units
  const D = {
    meta: m, vectors: out.vectors, rain: out.rain, cands: out.cands, base, korea, k,
    n: n_, col, h, H80: m.grid.h80[0], W80: m.grid.h80[1], H40: m.grid.h40[0], W40: m.grid.h40[1],
    Wkm: m.grid.w_km, Hkm: m.grid.h_km, Ws: m.grid.w_km / k, Hs: m.grid.h_km / k, unitid: out.unitid,
    series: new Int16Array(out.series.buffer, out.series.byteOffset, out.series.byteLength / 2), coh: out.coh, nd: m.units.nd,
    tracks: TRACKS.map((t) => ({ id: t, ...m.tracks[t], days: m.tracks[t].dates.map(dayOf) })),
    images: m.images || REGION_IMAGES, trueColour: !!m.images,
    // minDist: how close the camera may come. About 140 m, street level among the 3D buildings (js/world.js).
    view: korea ? { exag: m.view.exag, exagMax: m.view.exag_max, unitDist: 2.4, countyDist: 16, provDist: 46, minDist: 0.022, near: 0.04 }
      : { exag: 2.6, exagMax: 5, unitDist: 9, countyDist: 62, provDist: 62, minDist: 0.14, near: 0.5 },
  };
  D.sx = (kmx) => kmx / k - D.Ws / 2; D.sz = (kmz) => kmz / k - D.Hs / 2;
  D.hAt = (x, z) => {
    const fx = Math.min(Math.max((x / D.Ws + 0.5) * D.W80 - 0.5, 0), D.W80 - 1.001);
    const fz = Math.min(Math.max((z / D.Hs + 0.5) * D.H80 - 0.5, 0), D.H80 - 1.001);
    const j = fx | 0, i = fz | 0, a = fx - j, b = fz - i, q = i * D.W80 + j;
    return (h[q] * (1 - a) + h[q + 1] * a) * (1 - b) + (h[q + D.W80] * (1 - a) + h[q + D.W80 + 1] * a) * b;
  };
  D.unitAt = (x, z) => {                                    // -1 if no slope unit there
    const j = Math.floor((x / D.Ws + 0.5) * D.W40), i = Math.floor((z / D.Hs + 0.5) * D.H40);
    if (j < 0 || i < 0 || j >= D.W40 || i >= D.H40) return -1;
    const q = (i * D.W40 + j) * 4, b = D.unitid;
    return (b[q] | (b[q + 1] << 8) | (b[q + 2] << 16)) - 1;
  };
  D.cum = (u, t, q) => { const v = D.series[(u * 3 + t) * D.nd + q]; return v === -32768 ? NaN : v / 100; };
  D.cohAt = (u, t, q) => D.coh[(u * 3 + t) * (D.nd - 1) + q] / 255;
  // which photo the timeline shows on a given day
  D.imgAt = korea ? (d) => (d >= 66 ? 'poststorm_2026' : 'prestorm_2026') : (d) => (d >= 123 ? 'poststorm_20261002' : (d >= 66 ? 'poststorm_20260806' : 'prestorm_20260612'));
  D.img0 = korea ? 'latest_2026' : 'prestorm_20260612';
  // where the camera starts: the middle of the country's slopes
  let sx = 0, sz = 0; for (let u = 0; u < n_; u++) { sx += col.x[u]; sz += col.z[u]; }
  D.home = korea ? { x: D.sx(sx / n_) - 2, z: D.sz(sz / n_) + 15, dist: 150, polar: 0.66, az: -0.06 } : { x: 2, z: 5, dist: 122, polar: 0.84, az: -0.2 };
  if (korea) {
    const r = m.region.bbox_km;                              // the NISAR / 20 m area, for the storm replay
    D.region = { x: D.sx((r[0] + r[2]) / 2), z: D.sz((r[1] + r[3]) / 2), w: (r[2] - r[0]) / k, h: (r[3] - r[1]) / k };
  }
  return D;
}
