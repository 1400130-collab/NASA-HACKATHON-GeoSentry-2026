// The danger index: one number from 0 to 100 per slope. The map colour, the check-first list, the leaderboard
// and the inspection sheet all rank by it, so a higher number is always a higher place on the list.
// The bands are the inspection levels (pipeline p08 / k05), so the number can never disagree with the colour:
//   80-100  check first     80 + 20 x (60% slope + 40% below)
//   50-79   watch           by the slope part alone
//   0-49    nothing flagged, or radar can't see it: by the slope part alone
// Slope part (0-100): the AI model's rank among all slopes; 100 where the radar measured movement.
// Below part (0-100): buildings within 300 m downslope on a log scale (80 points at 30 or more), plus 20 for a main road.
// Keep the formula in step with `prio` in pipeline/p08_levels.py and pipeline/korea/k05_levels.py.
const clamp = (v) => Math.min(1, Math.max(0, v));

export function addScores(D) {
  const C = D.col, n = D.n, hz = new Float32Array(n), ex = new Float32Array(n), dz = new Float32Array(n);
  for (let u = 0; u < n; u++) {
    const h = hz[u] = C.moving[u] ? 100 : (C.pct[u] || 0) * 100;
    const e = ex[u] = Math.min(100, Math.round(80 * Math.log(1 + Math.min(C.bld[u], 30)) / Math.log(31) + (C.road[u] > 0 ? 20 : 0)));
    dz[u] = C.level[u] === 3 ? 80 + 20 * (0.6 * clamp((h - 95) / 5) + 0.4 * e / 100)
      : C.level[u] === 2 ? 50 + 29.4 * clamp((h - 80) / 20)
        : Math.min(49.4, 49.4 * h / 80);
  }
  C.hz = hz; C.ex = ex; C.danger = dz;
  return D;
}

// the check-first slopes, most dangerous first
export function checkOrder(D) {
  const C = D.col, out = [];
  for (let u = 0; u < D.n; u++) if (C.level[u] === 3) out.push(u);
  return out.sort((a, b) => C.danger[b] - C.danger[a] || C.pct[b] - C.pct[a] || a - b);
}
