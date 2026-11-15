// Fills the uncertainty, radar-check and workload numbers. Like every other number on the site, they are read
// from files the analysis scripts write (analysis/headline_stats.py, analysis/radar_scar_check.py); none are typed in.
const pct = (x) => Math.round(x * 100);
const fmt = (x) => x.toLocaleString('en-US');
const p = (x) => (x < 0.001 ? '< 0.001' : x < 0.01 ? x.toFixed(3) : x.toFixed(2));
const dd = (s) => `${+s.slice(6, 8)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+s.slice(4, 6) - 1]}`;

function numbers(S, R) {
  const m = S.rows.model_national, r = S.rows.steep_and_burned, w = S.workload;
  const d = R.tracks['032'], e = R.tracks['024'];
  return {
    found: m.found, of: m.of, ciLo: pct(m.ci90[0]), ciHi: pct(m.ci90[1]), pModel: p(m.p_vs_chance),
    ruleFound: r.found, pRule: p(r.p_vs_chance), ruleCiLo: pct(r.ci90[0]), ruleCiHi: pct(r.ci90[1]),
    perCounty: fmt(w.per_county_median), perCountyMax: fmt(w.per_county_max), counties: fmt(w.counties_with_any),
    shareChecked: (w.check_first_share * 100).toFixed(1), regionUnits: fmt(w.region_units), regionVisits: fmt(w.region_top5_visits),
    reached: w.region_failures_reached, randomReached: w.random_failures_reached,
    dPair: `${dd(d.pair[0])} → ${dd(d.pair[1])}`, dScar: pct(d.share_below_threshold.failure), dClear: pct(d.share_below_threshold.clearing),
    dRand: pct(d.share_below_threshold.random), dP: p(d.p_failure_lower_than_clearing), dN: d.n.failure, dNc: d.n.clearing,
    ePair: `${dd(e.pair[0])} → ${dd(e.pair[1])}`, eScar: pct(e.share_below_threshold.failure), eRand: pct(e.share_below_threshold.random),
    eP: p(e.p_failure_lower_than_random),
    otherP: p(Math.max(R.tracks['125'].p_failure_lower_than_random, e.p_failure_lower_than_random)),
  };
}

function bars(el, N) {
  const rows = [['Random places', '무작위 지점', N.dRand, ''], ['Old clearings (already bare)', '기존 벌채지 (원래 맨땅)', N.dClear, ''], ['Storm scars', '폭우 붕괴 흔적', N.dScar, 'me']];
  const max = Math.max(...rows.map((r) => r[2]), 1);
  el.innerHTML = rows.map(([en, ko, v, c], i) => `<div class="${c}" style="--k:${i}"><span><span lang="en">${en}</span><span lang="ko">${ko}</span></span><i style="width:${(v / max * 100).toFixed(1)}%"></i><b>${v}%</b></div>`).join('');
}

Promise.all([fetch('data/korea/stats.json').then((r) => r.json()), fetch('data/radar_check.json').then((r) => r.json())])
  .then(([S, R]) => {
    const N = numbers(S, R);
    document.querySelectorAll('[data-x]').forEach((el) => { el.textContent = N[el.dataset.x] ?? '?'; });
    document.querySelectorAll('[data-xblock="radarbars"]').forEach((el) => bars(el, N));
  })
  .catch(() => document.querySelectorAll('[data-x]').forEach((el) => { el.textContent = '?'; }));
