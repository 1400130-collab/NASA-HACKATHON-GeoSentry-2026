// The time-series inversion drawn on real slopes: every dot is one satellite pass projected onto the slope line, the
// line is the solved model (rate before the storm, step at the storm, rate after it) and the band is its error bar.
// Used twice: the home page's slide 05 loops over data/inversion.json (written by p04b / p09), and the map's slope
// panel plays the fit of the selected slope once (ui.js builds that slope from the exported columns).
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D0 = 15, D1 = 150;
const COL = ['var(--ink)', 'var(--inv-b)', 'var(--inv-c)'];
const MONTHS = [[30, 'Jul', '7월'], [61, 'Aug', '8월'], [92, 'Sep', '9월'], [122, 'Oct', '10월']];
const ko = () => document.documentElement.lang === 'ko';
const sgn = (v) => { const r = Math.round(v); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r); };
const ease = (k) => 1 - Math.pow(1 - Math.min(Math.max(k, 0), 1), 3);

function geom(o = {}) {
  const W = o.W || 500, H = o.H || 372, head = o.header !== false, legend = o.legend !== false;
  const G = { W, H, X0: o.X0 || 46, X1: W - 8, Y0: head ? 122 : 98, Y1: H - (legend ? 54 : 28), head, legend, col: o.colors || COL, loop: !!o.loop };
  G.sx = (d) => G.X0 + (d - D0) / (D1 - D0) * (G.X1 - G.X0);
  return G;
}

function prep(e, G) {
  const Ts = e.storm_day, model = (t) => e.v_pre * (Math.min(t, Ts) - Ts) / 30 + (t >= Ts ? e.step : 0) + e.v * Math.max(t - Ts, 0) / 30;
  const pts = [];
  e.tracks.forEach((tr, k) => tr.days.forEach((d, j) => { if (tr.mm[j] !== null && Number.isFinite(tr.mm[j])) pts.push({ d, v: tr.mm[j], k: tr.k ?? k }); }));
  pts.sort((a, b) => a.d - b.d);
  const first = pts.length ? Math.min(...pts.map((p) => p.d)) : 21, last = pts.length ? Math.max(...pts.map((p) => p.d)) : 142;
  const half = (t) => 2 * e.s * Math.max(t - Ts, 0) / 30;
  let lo = Math.min(...pts.map((p) => p.v), model(first), model(last) - half(last), 0), hi = Math.max(...pts.map((p) => p.v), model(first), model(last) + half(last), 0);
  const pad = Math.max((hi - lo) * 0.14, 4); lo -= pad; hi += pad;
  if (hi - lo < 36) { const m = (hi + lo) / 2; lo = m - 18; hi = m + 18; }
  const sy = (v) => G.Y1 - (v - lo) / (hi - lo) * (G.Y1 - G.Y0);
  const line = [[first, model(first)], [Ts - 0.01, model(Ts - 0.01)], [Ts, model(Ts)], [last, model(last)]];
  const band = `M${G.sx(Ts)} ${sy(model(Ts))}L${G.sx(last)} ${sy(model(last) + half(last))}L${G.sx(last)} ${sy(model(last) - half(last))}Z`;
  const step = Math.max(10, Math.round((hi - lo) / 4 / 10) * 10), ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return { e, pts, sy, line, band, ticks, Ts, ids: e.tracks.map((t) => t.id) };
}

function frame(P, t, G) {                                // t: milliseconds into this slope
  const { e, pts, sy } = P, K = ko(), { sx, X0, X1, Y0, Y1 } = G;
  const nd = calm ? pts.length : Math.floor(ease(t / 1500) * pts.length + 1e-6);
  const kl = calm ? 1 : ease((t - 1400) / 900), kn = calm ? 1 : ease((t - 2000) / 900), out = calm || !G.loop ? 1 : 1 - ease((t - 5600) / 400);
  const marks = pts.slice(0, nd).map((p, i) => {
    const x = sx(p.d).toFixed(1), y = sy(p.v).toFixed(1), fresh = !calm && i === nd - 1 && t < 1500;
    return `<circle cx="${x}" cy="${y}" r="${fresh ? 8 : 4.6}" fill="${G.col[p.k % 3]}" fill-opacity="${fresh ? .55 : .92}"/>`;
  }).join('');
  let len = 0; const seg = P.line.map(([d, v]) => [sx(d), sy(v)]);
  for (let i = 1; i < seg.length; i++) len += Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]);
  const path = seg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  const big = e.moving, up = !big && e.z <= -4, ub = Math.ceil(Math.abs(e.v) + 2 * e.s);
  const tag = big ? (K ? '아래로 이동 중' : 'MOVING DOWNHILL') : up ? (K ? '위 방향 변화 · 미끄러짐 아님' : 'READS UPHILL · NOT SLIDING')
    : (K ? `감지되는 이동 없음 · 월 ${ub} mm 초과는 배제` : `NOTHING DETECTABLE · OVER ${ub} MM RULED OUT`);
  const tw = tag.length * (K ? 11.5 : 7.6) + 22, top = G.head ? 0 : -6;
  return `<g opacity="${out.toFixed(2)}">
    ${P.ticks.map((v) => `<line class="axis" x1="${X0}" x2="${X1}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${X0 - 10}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${MONTHS.map(([d, en, kr]) => `<text x="${sx(d)}" y="${Y1 + 22}" text-anchor="middle">${K ? kr : en}</text>`).join('')}
    <line class="zero" x1="${X0}" x2="${X1}" y1="${sy(0)}" y2="${sy(0)}"/>
    <line class="storm" x1="${sx(P.Ts)}" x2="${sx(P.Ts)}" y1="${Y0 - 6}" y2="${Y1}"/><text x="${sx(P.Ts) + 7}" y="${Y0 + 4}" style="fill:var(--inv-c)">${K ? '폭우' : 'storm'}</text>
    <path class="band" d="${P.band}" opacity="${kl.toFixed(2)}"/>
    <path class="fit" d="${path}" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${(len * (1 - kl)).toFixed(1)}"/>
    ${marks}
    ${G.head ? `<text class="who" x="${X0}" y="22">${K ? e.ko : e.en} · #${e.u}</text><text x="${X0}" y="42">${K ? `경사 ${e.slope.toFixed(0)}° · 궤도 ${P.ids.join(', ')}` : `${e.slope.toFixed(0)}° slope · orbits ${P.ids.join(', ')}`}</text>` : ''}
    <g opacity="${kn.toFixed(2)}"><text class="num" x="${G.head ? X1 : 0}" y="${44 + top}" text-anchor="${G.head ? 'end' : 'start'}">${sgn(e.v * kn)} ± ${Math.round(e.s)}</text>
      <text class="per" x="${X1}" y="${G.head ? 66 : 26 + top}" text-anchor="end">${K ? 'mm / 월, 사면 아래 방향' : 'mm a month, down the slope'}</text>
      <rect x="${G.head ? X1 - tw : 0}" y="${G.head ? 78 : 56 + top}" width="${tw}" height="24" rx="4" fill="${big ? 'var(--inv-c)' : 'var(--ink)'}"/><text class="tag" x="${(G.head ? X1 - tw : 0) + tw / 2}" y="${(G.head ? 94.5 : 72.5 + top)}" text-anchor="middle" style="fill:${big ? '#fff' : 'var(--bg)'}">${tag}</text></g>
  </g>`;
}

// the map's slope panel: play one slope's fit once
const running = new WeakMap();
export function playSolver(el, e, opts = {}) {
  cancelAnimationFrame(running.get(el));
  const G = geom(opts), P = prep(e, G);
  el.innerHTML = `<svg viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="Solved movement along the slope"><g data-dyn></g></svg>`;
  const dyn = el.firstChild.firstChild;
  if (calm) { dyn.innerHTML = frame(P, 9999, G); return; }
  let t0 = 0;
  const tick = (now) => { if (!el.isConnected) return; if (!t0) t0 = now; dyn.innerHTML = frame(P, now - t0, G); if (now - t0 < 3200) running.set(el, requestAnimationFrame(tick)); };
  running.set(el, requestAnimationFrame(tick));
}

// the home page: loop over the exported example slopes while the slide is on screen
async function home(el) {
  const ex = await fetch('data/inversion.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // slopes the map flags as moving, and quiet ones, taking turns
  const mv = (ex || []).filter((e) => e.tracks.length && e.moving), q = (ex || []).filter((e) => e.tracks.length && !e.moving && Math.abs(e.z) < 1), mix = [];
  for (let k = 0; k < Math.max(mv.length, q.length); k++) { if (mv[k]) mix.push(mv[k]); if (q[k]) mix.push(q[k]); }
  if (!mix.length) { el.closest('figure')?.remove(); return; }
  const G = geom({ loop: true }), P = mix.map((e) => prep(e, G));
  el.innerHTML = `<svg viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="The solver fitting real slopes"><g data-dyn></g><g data-leg></g></svg>`;
  const dyn = el.querySelector('[data-dyn]'), leg = el.querySelector('[data-leg]');
  let i = 0, t0 = 0, on = false, raf = 0;
  const legend = () => { leg.innerHTML = P[i].ids.map((id, k) => `<circle cx="${G.X0 + 6 + k * 62}" cy="${G.H - 10}" r="4.6" fill="${COL[k % 3]}"/><text x="${G.X0 + 17 + k * 62}" y="${G.H - 6}">${id}</text>`).join('')
    + `<text x="${G.X1}" y="${G.H - 6}" text-anchor="end">${ko() ? `실제 사면 ${i + 1} / ${P.length}` : `real slope ${i + 1} of ${P.length}`}</text>`; };
  const tick = (now) => {
    if (!on) return;
    if (!t0) { t0 = now; legend(); }
    if (now - t0 > 6000) { i = (i + 1) % P.length; t0 = now; legend(); }
    dyn.innerHTML = frame(P[i], now - t0, G);
    raf = requestAnimationFrame(tick);
  };
  if (calm) { legend(); dyn.innerHTML = frame(P[0], 9999, G); return; }
  new IntersectionObserver(([en]) => { on = en.isIntersecting; cancelAnimationFrame(raf); if (on) { t0 = 0; raf = requestAnimationFrame(tick); } }, { threshold: 0.25 }).observe(el);
}
const slide = document.querySelector('[data-block="inversion"]');
if (slide) home(slide);
