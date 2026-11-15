// Shared by the pages around the map. Fills every figure from data/meta.json (or the page's data-meta, e.g. data/korea/meta.json) so nothing is typed in by hand.
import { STR, featName } from './i18n.js?v=2';

const KEY = 'sw_lang';
const $$ = (s) => [...document.querySelectorAll(s)];
let lang = document.documentElement.lang === 'ko' ? 'ko' : 'en';
let M = null, H = null;                                // H: the past-landslide record (data/history.json), only on pages that ask for it

const int = (v) => Math.round(v).toLocaleString('en-US');
const pc = (v, d = 0) => (v * 100).toFixed(d);
const t = (k, v = {}) => { let s = STR[lang][k] ?? STR.en[k] ?? k; for (const x in v) s = s.replaceAll(`{${x}}`, v[x]); return s; };
const day = (s) => {                                   // 'YYYYMMDD' -> '22 Jun' / '6월 22일'
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  return lang === 'ko' ? `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일` : `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
};

function numbers(m) {
  const L = m.levels.levels, R = m.suscept.results, A = m.anomaly.results, S = m.series, T = Object.values(m.tracks);
  const noise = T.flatMap((x) => x.noise_pair), best = R.model_without_nisar;
  return {
    units: int(m.units.n), check: int(L.check_first), watch: int(L.watch), nosig: int(L.no_signal), nomeas: int(L.not_measurable),
    moving: int(m.levels.moving_units), checkMoving: int(m.levels.check_first_moving), flagged: int(m.levels.z_rule_units),
    wkm: Math.round(m.grid.w_km), hkm: Math.round(m.grid.h_km), counties: m.counties.filter((c) => c.units > 0).length,
    cap10: pc(best.capture_top10), capLo: pc(best.capture_top10_ci90[0]), capHi: pc(best.capture_top10_ci90[1]),
    cap20: pc(best.capture_top20), capX: (best.capture_top10 / 0.1).toFixed(1),
    cap5: pc(best.capture_top5), capX5: (best.capture_top5 / 0.05).toFixed(0),
    auc: best.roc_auc.toFixed(2), aucBase: (R.model_base ?? best).roc_auc.toFixed(2), teacher: int(m.suscept.joint?.teacher_slopes ?? m.suscept.n_units),
    steep5: pc(R.steepness_only.capture_top5), rule5: pc(R.steep_and_burned.capture_top5), slip: pc(1 / m.suscept.n_failed),
    steep10: pc(R.steepness_only.capture_top10), rule10: pc(R.steep_and_burned.capture_top10), capNisar: pc(R.model_full.capture_top10),
    capReg: pc((R.model_regional_20m ?? best).capture_top10), provs: m.provinces?.length ?? 0,
    nfail: m.suscept.n_failed, ncand: m.labels.candidates_ge3px, nscar: m.labels.auto_failure, nreviewed: m.labels.human_reviewed,
    observed: int(m.suscept.n_units), nfeat: m.suscept.features.length, nfolds: Object.keys(m.suscept.folds).length,
    det50: m.anomaly.detect50_cm_well_oriented.toFixed(1), det80: m.anomaly.detect80_cm_well_oriented.toFixed(1),
    det3: pc(A.detector.well_oriented[3]), mf3: pc(A.matched.well_oriented[3]), z3: pc(A.zmax.well_oriented[3]), ae3: pc(A.autoenc.well_oriented[3]),
    far: pc(m.anomaly.false_alarm_rate), oriented: pc(m.anomaly.well_oriented_share), detUnits: int(m.anomaly.units),
    wave: (m.radar.wavelength_m * 100).toFixed(1), fringe: (m.radar.wavelength_m * 50).toFixed(1),
    npairs: T.reduce((a, x) => a + x.dates.length - 1, 0), ntracks: T.length,
    noiseLo: Math.min(...noise).toFixed(2), noiseHi: Math.max(...noise).toFixed(2),
    stable: int(S.stable_units), ascR: S.ascending_agreement.r_all.toFixed(2),
    ...(m.velocity ? { vSolved: int(m.velocity.slopes_solved), vOne: int(m.velocity.slopes_one_direction_only), vSig: m.velocity.sigma_post_mm_pct['50'].toFixed(0),
      vUb: m.velocity.upper_bound_mm_median.toFixed(0), vDown: m.velocity.detected_downslope, vUp: m.velocity.detected_upslope,
      vNone: pc(m.velocity.no_detectable_movement_share, 1), vLimit: m.velocity.detect_limit80_mm_median.toFixed(0),
      nObs: int(m.velocity.observations ?? 0), rec50: m.velocity.recovery['50'].recovered_median.toFixed(1) } : {}),
    ...(m.sign ? { wxR: Math.min(m.sign.wet_r, m.sign.hydro_r).toFixed(2), tideR: Math.abs(m.sign.tide_r).toFixed(2), signPairs: m.sign.pairs } : {}),
    bld: int(m.levels.buildings_mapped), unitsBld: int(m.levels.units_building_below), unitsRoad: int(m.levels.units_road_below),
    // ML model 3, the debris-reach emulator (k04b), and what it changes in the nationwide list (k05)
    ...(m.reach ? { emR2: m.reach.far.r2_heldout.toFixed(2), emX: m.reach.far.err_factor_heldout.toFixed(2), emX0: m.reach.far.err_factor_constant.toFixed(2),
      emTrain: int(m.reach.far.n_train), emUnits: int(m.reach.units_predicted), emMed: Math.round(m.reach.reach_m_p10_p50_p90[1] / 10) * 10,
      emLo: Math.round(m.reach.reach_m_p10_p50_p90[0] / 10) * 10, emHi: Math.round(m.reach.reach_m_p10_p50_p90[2] / 10) * 10,
      emMoved: int((m.levels.reach?.dropped ?? 0) + (m.levels.reach?.added ?? 0)), emOld: int(m.levels.reach?.check_first_fixed_360m) } : {}),
    // debris-flow simulation (pipeline p11) and what it does to the list (p08)
    ...(m.runout ? { roSim: int(m.runout.simulated_slopes), roReach: int(m.levels.runout?.exposed_sim_far), roFit: int(m.levels.runout?.exposed_sim_best_fit), roOld: int(m.levels.runout?.exposed_300m_rule),
      roScars: m.runout.calibration.n_scars, roLobs: Math.round(m.runout.calibration.L_obs_median_m), roMuLo: m.runout.calibration.mu_range_not_ruled_out[0], roMuHi: m.runout.calibration.mu_range_not_ruled_out[1],
      roFarMed: Math.round(m.runout.far.runout_m.median / 10) * 10, roFitMed: Math.round(m.runout.best_fit.runout_m.median / 10) * 10, roBld: int(m.runout.far.buildings_reached_total) } : {}),
    built: m.generated.slice(0, 10),
  };
}

// ---- past landslides (history.html): the Korea Forest Service's national record by year, ranked by an impact index.
// Each part is that year's figure as a share of the worst year in the record, weighted by H.weights, so a year that
// was worst for deaths, area and cost alike scores 100.
function hist() {
  if (H.rows) return H;
  const Y = [...H.years].sort((a, b) => a.y - b.y), w = H.weights, max = (k) => Math.max(...Y.map((r) => r[k]), 1);
  H.max = { deaths: max('deaths'), area_ha: max('area_ha'), cost_mkrw: max('cost_mkrw') };
  H.rows = Y.map((r) => {
    const life = 100 * w.lives * r.deaths / H.max.deaths, land = 100 * (w.area * r.area_ha / H.max.area_ha + w.cost * r.cost_mkrw / H.max.cost_mkrw);
    return { ...r, life, land, index: life + land };
  });
  return H;
}
function histNumbers() {
  const R = hist().rows, w = H.weights, sum = (k, rows = R) => rows.reduce((a, r) => a + r[k], 0), top = (k) => [...R].sort((a, b) => b[k] - a[k])[0];
  const late = R.slice(-3), dl = sum('deaths', late), d = sum('deaths');
  return {
    hDeaths: d, hArea: int(sum('area_ha')), hCost: (sum('cost_mkrw') / 1e6).toFixed(2), hCostKo: int(sum('cost_mkrw') / 100),
    hFrom: R[0].y, hTo: R.at(-1).y, hYears: R.length, hWorst: top('index').y, hDeadliest: top('deaths').y,
    hLate: pc(dl / d), hLateN: dl, hLateFrom: late[0].y, hEarlyN: d - dl, hEarlyTo: R.at(-4).y,
    hwLives: pc(w.lives), hwArea: pc(w.area), hwCost: pc(w.cost), hUpdated: H.source.updated,
  };
}

function impact(el) {
  const ko = lang === 'ko', R = hist().rows, mx = H.max, mode = el.dataset.mode || 'index', split = mode === 'index' || mode === 'year';
  const won = (m) => (ko ? `${int(m / 100)}<small>억 원</small>` : `₩${(m / 1000).toFixed(1)}<small> bn</small>`);
  const dead = (n) => (ko ? (n ? `사망 <b>${n}명</b>` : '사망 없음') : (n ? `<b>${n}</b> death${n > 1 ? 's' : ''}` : 'no deaths'));
  const key = { index: 'index', deaths: 'deaths', area: 'area_ha', cost: 'cost_mkrw' }[mode];
  const rows = [...R].sort((a, b) => (mode === 'year' ? b.y - a.y : b[key] - a[key] || b.index - a.index));
  const tabs = [['index', ko ? '피해 지수' : 'Impact index'], ['deaths', ko ? '사망자' : 'Lives lost'], ['area', ko ? '면적' : 'Hillside lost'], ['cost', ko ? '복구비' : 'Repair bill'], ['year', ko ? '연도순' : 'By year']];
  const val = (r) => (mode === 'deaths' ? r.deaths : mode === 'area' ? `${int(r.area_ha)}<small> ha</small>` : mode === 'cost' ? won(r.cost_mkrw) : r.index.toFixed(0));
  const bar = (r) => (split ? `<i class="life" style="width:${r.life.toFixed(2)}%"></i><i class="land" style="width:${r.land.toFixed(2)}%"></i>`
    : `<i class="${mode === 'deaths' ? 'life' : 'land'}" style="width:${(r[key] / mx[key] * 100).toFixed(2)}%"></i>`);
  el.dataset.mode = mode;
  el.innerHTML = `<div class="chips">${tabs.map(([k, n]) => `<button type="button" data-mode="${k}" aria-pressed="${k === mode}">${n}</button>`).join('')}</div>
    <p class="key">${split ? `<span>${ko ? '인명 피해' : 'lives lost'}</span><span>${ko ? '산사태 면적 + 복구비' : 'hillside lost + repair bill'}</span><em>${ko ? '100 = 모든 항목에서 최악인 해' : '100 = worst year on every count'}</em>`
      : `<em>${ko ? '막대 = 기록상 최악인 해 대비' : 'bars are a share of the worst year on record'}</em>`}</p>
    <ol>${rows.map((r, i) => `<li style="--k:${i}"><span class="pos">${String(i + 1).padStart(2, '0')}</span><b class="yr">${r.y}</b>
      <div><div class="bar"><span>${bar(r)}</span></div>
        <div class="meta"><span>${dead(r.deaths)}</span><span>${int(r.area_ha)} ha</span><span>${won(r.cost_mkrw).replace(/<\/?small>/g, '')}</span>${r.note_en ? `<em>${ko ? r.note_ko : r.note_en}</em>` : ''}</div></div>
      <b class="val">${val(r)}</b></li>`).join('')}</ol>`;
  el.onclick = (e) => { const b = e.target.closest('button[data-mode]'); if (b && b.dataset.mode !== mode) { el.dataset.mode = b.dataset.mode; impact(el); } };
}

// what the record and our index cannot say. The first line works out how much weight on lives would swap the top two years.
function hlimits(el) {
  const ko = lang === 'ko', [a, b] = [...hist().rows].sort((p, q) => q.index - p.index), mx = H.max;
  const L = (r) => r.deaths / mx.deaths, D = (r) => (r.area_ha / mx.area_ha + r.cost_mkrw / mx.cost_mkrw) / 2;
  const flip = L(b) > L(a) && D(a) > D(b) ? (D(a) - D(b)) / (D(a) - D(b) + L(b) - L(a)) : null;
  const close = flip == null ? '' : ko ? ` ${a.y}년과 ${b.y}년은 차이가 작아, 인명 피해 비중을 ${pc(flip)}%보다 높이면 ${b.y}년이 1위가 됩니다.` : ` ${a.y} and ${b.y} are close: count lives for more than ${pc(flip)}% and ${b.y} comes first.`;
  el.innerHTML = (ko ? [
    `피해 지수는 공식 지표가 아니라 저희가 정한 가중치입니다.${close}`,
    '사망자는 자연 산지에서 난 산사태로 숨진 사람만 셉니다. 절개지 붕괴, 침수 등 다른 호우 사망자는 들어 있지 않습니다.',
    '복구비는 산사태뿐 아니라 계류·임도까지 포함한 산림 분야 전체 복구비이며, 물가 상승을 반영하지 않은 그해 금액입니다.',
    '전국 합계뿐이고 위치 정보가 없어, 이 기록으로 저희 지도를 검증할 수는 없습니다.',
  ] : [
    `The index is our own weighting, not an official score.${close}`,
    'Deaths are only those from landslides on natural mountain slopes. Cut slopes, floods and other storm deaths are not in it.',
    "The repair bill covers all forest damage (landslides, streams, forest roads) in that year's won, not adjusted for inflation.",
    'National totals only. The table has no locations, so it cannot be used to check our map.',
  ]).map((x) => `<li>${x}</li>`).join('');
}
function hsource(el) {
  const S = H.source, ko = lang === 'ko';
  el.innerHTML = `${ko ? '출처' : 'Source'}: <a href="${S.url}" target="_blank" rel="noopener">${ko ? S.ko : S.en}</a>. ${ko ? `${S.basis_ko} 기준, ${S.updated} 갱신, ${S.retrieved} 확인.` : `Compiled from ${S.basis_en}. Updated ${S.updated}, read ${S.retrieved}.`}`;
}

function fill() {
  const N = { ...numbers(M), ...(H ? histNumbers() : {}) };
  $$('[data-n]').forEach((el) => { el.dataset.v = N[el.dataset.n] ?? '?'; if (!el.dataset.counting) el.textContent = el.dataset.v; });
}

// numbers marked data-count run up from zero the first time they scroll into view
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el) {
  const end = el.dataset.v, target = parseFloat(end.replace(/,/g, '')), dec = (end.split('.')[1] || '').length;
  if (calm || !Number.isFinite(target)) return;
  const t0 = performance.now(), dur = 1400;
  el.dataset.counting = '1';
  const tick = (now) => {
    const k = Math.min((now - t0) / dur, 1), v = target * (1 - Math.pow(1 - k, 4));
    el.textContent = k === 1 ? el.dataset.v : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (k < 1) requestAnimationFrame(tick); else delete el.dataset.counting;
  };
  requestAnimationFrame(tick);
}

// ---- small tables and bars ---------------------------------------------------------------
function tracks(el) {
  const H = lang === 'ko' ? ['궤도', '방향', '촬영 횟수', '기간', '쌍당 잡음 (cm)', '측정 가능 사면'] : ['Track', 'Direction', 'Passes', 'Period', 'Noise per pair (cm)', 'Slopes it can measure'];
  const dir = (d) => (lang === 'ko' ? (d === 'ascending' ? '상승 (북쪽으로)' : '하강 (남쪽으로)') : (d === 'ascending' ? 'ascending (northbound)' : 'descending (southbound)'));
  el.innerHTML = `<table class="tbl"><thead><tr>${H.map((h, i) => `<th${i > 1 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${Object.values(M.tracks).map((x) =>
    `<tr><td class="mono">${x.name}</td><td>${dir(x.dir)}</td><td class="num mono">${x.dates.length}</td><td class="num mono">${day(x.dates[0])} – ${day(x.dates.at(-1))}</td><td class="num mono">${Math.min(...x.noise_pair).toFixed(2)}–${Math.max(...x.noise_pair).toFixed(2)}</td><td class="num mono">${int(x.measurable)}</td></tr>`).join('')}</tbody></table>`;
}

function importance(el) {
  const top = Object.entries(M.suscept.importance).slice(0, 8), max = top[0][1];
  el.innerHTML = top.map(([k, v]) => `<div><span>${featName(k, lang)}</span><i style="width:${(v / max * 100).toFixed(1)}%"></i></div>`).join('');
}

function counties(el) {
  if (M.levels.check_first_by_province) {                // nationwide: one bar per province
    const rows = Object.entries(M.levels.check_first_by_province).sort((a, b) => b[1] - a[1]), max = rows[0][1];
    const name = (k) => { const p = M.provinces.find((p) => p.en === k); return p && lang === 'ko' ? p.ko : k; };
    el.innerHTML = rows.map(([k, v]) => `<div><span>${name(k)} <span class="mono small">${int(v)}</span></span><i style="width:${(v / max * 100).toFixed(1)}%;background:var(--red)"></i></div>`).join('');
    return;
  }
  const by = M.levels.check_first_by_county, name = (k) => { const c = M.counties.find((c) => k.startsWith(c.en)); return c ? (lang === 'ko' ? c.ko : c.en) : k; };
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), max = rows[0][1];
  el.innerHTML = rows.map(([k, v]) => `<div><span>${name(k)} <span class="mono small">${int(v)}</span></span><i style="width:${(v / max * 100).toFixed(1)}%;background:var(--red)"></i></div>`).join('');
}

function checks(el) {
  const S = M.series, T = Object.values(M.tracks), ag = S.ascending_agreement, mv = S.movement, lab = M.labels, A = M.anomaly.results;
  const rows = [
    ['c_stable', { a: T.map((x) => x.stable_cum_median.toFixed(2)).join(' / '), n: int(S.stable_units), s: T.map((x) => x.stable_cum_mad.toFixed(1)).join(' / ') }, 'pass', 'ok'],
    ...(M.velocity ? [['c_inv', { p: T.reduce((a, x) => a + x.dates.length - 1, 0), r: M.velocity.recovery['50'].recovered_median.toFixed(1), c: Math.round(Math.abs(M.velocity.calibration_factor.post - 1) * 100) }, 'pass', 'ok'],
      ['c_floor', { q: pc(M.velocity.no_detectable_movement_share, 1), n: int(M.velocity.slopes_solved), s: M.velocity.sigma_post_mm_pct['50'].toFixed(0) }, 'pass', 'ok'],
      ['c_dir', { d: M.velocity.detected_downslope, u: M.velocity.detected_upslope, n: M.velocity.detected }, 'pass', 'ok']]
      : [['c_far', { a: pc(mv.stable_units_flagged_share, 2), b: pc(mv.share_of_measurable_slopes, 2) }, 'pass', 'ok']]),
    ['c_asc', { r: ag.r_all.toFixed(2), n: int(ag.units), p: pc(ag.same_sign_moving) }, 'weak', 'weak'],
    ['c_ml', { a: pc(A.detector.well_oriented[3]), b: pc(A.matched.well_oriented[3]) }, 'pass', 'ok'],
    ['c_ae', { a: pc(A.autoenc.well_oriented[3]), b: pc(A.zmax.well_oriented[3]) }, 'off', 'notused'],
    M.levels.radar_units ? ['c_cov', { a: int(M.levels.radar_measured), b: int(M.levels.radar_units) }, 'pass', 'ok', 'c_cov_kr']
      : ['c_cov', { a: int(M.units.n - M.levels.levels.not_measurable), b: int(M.units.n) }, 'pass', 'ok'],
    ['c_lab', { c: lab.candidates_ge3px, f: lab.auto_failure, u: lab.failed_slope_units, h: lab.human_reviewed }, 'open', 'open_'],
    M.sign?.confirmed ? ['c_sign', { n: M.sign.pairs, r: Math.min(M.sign.wet_r, M.sign.hydro_r).toFixed(2), t: Math.abs(M.sign.tide_r).toFixed(2) }, 'pass', 'ok', 'c_sign_ok'] : ['c_sign', {}, 'open', 'open_'],
  ];
  el.innerHTML = `<table class="tbl"><tbody>${rows.map(([k, v, cls, st, vk]) => `<tr><td><b>${t(k)}</b></td><td>${t(vk || k + '_v', v)}</td><td class="num"><span class="tag ${cls}">${t(st)}</span></td></tr>`).join('')}</tbody></table>`;
}

// the hindsight figure against simpler ways of picking slopes, as thick bars (home page): share of the failed slopes
// that sat in each method's top 5%, the same cut the check-first rule uses
const barRows = (rows) => { const max = Math.max(...rows.map((r) => r[1])); return rows.map(([k, v, c], i) => `<div class="${c || ''}" style="--k:${i}"><span>${t(k)}</span><i style="width:${(v / max * 100).toFixed(1)}%"></i><b>${pc(v)}%</b></div>`).join(''); };
function versus(el) {
  const R = M.suscept.results;
  el.innerHTML = barRows([['s_chance', 0.05], ['s_steep', R.steepness_only.capture_top5], ['s_rule', R.steep_and_burned.capture_top5], ['s_model', R.model_without_nisar.capture_top5, 'me']]);
}
// the detector against the simpler ways of spotting movement: share of injected 3 cm slips caught (home page)
function detbars(el) {
  const A = M.anomaly.results, at = (k) => A[k].well_oriented[3];
  el.innerHTML = barRows([['s_z', at('zmax')], ['s_mf', at('matched')], ['s_det', at('detector'), 'me']]);
}

// two radar echoes, 12 days apart, drawn to scale: the second sits further along by twice the distance the ground
// moved (the wave travels there and back). The red wave slides into place the first time the slide is seen.
function phase(el) {
  const lam = M.radar.wavelength_m * 100, d = M.anomaly.detect50_cm_well_oriented, ko = lang === 'ko';
  const W = 640, H = 330, L = 262, mid = 168, A = 50, x0 = 58, s = 2 * d / lam * L, c1 = x0 + L, top = mid - A;
  let path = '';
  for (let x = -L; x <= W + 8; x += 6) path += `${x === -L ? 'M' : 'L'}${x} ${(mid - A * Math.cos((x - x0) / L * 6.2832)).toFixed(1)}`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ko ? '12일 간격의 두 레이더 반사파' : 'Two radar echoes, 12 days apart'}">
    <defs><clipPath id="wclip"><rect x="0" y="${top - 6}" width="${W}" height="${A * 2 + 12}"/></clipPath>
      <linearGradient id="wfade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".035" stop-color="#fff"/><stop offset=".965" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="wmask"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#wfade)"/></mask></defs>
    <g font-size="12.5"><line x1="0" x2="26" y1="14" y2="14" stroke="${INK}" stroke-opacity=".5" stroke-width="2.5"/><text x="36" y="18">${ko ? '첫 번째 반사파' : 'Echo, first pass'}</text>
      <line x1="${ko ? 150 : 178}" x2="${ko ? 176 : 204}" y1="14" y2="14" stroke="${HOT}" stroke-width="3"/><text class="hot" x="${ko ? 186 : 214}" y="18">${ko ? '12일 뒤의 반사파' : 'Echo, 12 days later'}</text></g>
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="${RULE}"/>
    <g clip-path="url(#wclip)" mask="url(#wmask)" fill="none" stroke-linecap="round">
      <path d="${path}" stroke="${INK}" stroke-opacity=".42" stroke-width="2.5"/>
      <g class="w2" style="--s:${s.toFixed(1)}px"><path d="${path}" stroke="${HOT}" stroke-width="3.5"/></g>
    </g>
    <g class="mk">
      <path d="M${c1} ${top - 8}V${top - 30}M${c1 + s} ${top - 8}V${top - 30}M${c1} ${top - 24}H${c1 + s}" stroke="${HOT}" stroke-width="1.5" fill="none"/>
      <text class="k hot" x="${c1 + s / 2}" y="${top - 62}" text-anchor="middle">${d.toFixed(1)} cm</text>
      <text class="hot" x="${c1 + s / 2}" y="${top - 42}" text-anchor="middle">${ko ? '지표 이동 (왕복이라 두 배로 보임)' : 'of ground movement, there and back'}</text>
    </g>
    <path d="M${x0} ${mid + A + 16}V${mid + A + 32}M${c1} ${mid + A + 16}V${mid + A + 32}M${x0} ${mid + A + 24}H${c1}" stroke="${AXIS}" stroke-width="1.5" fill="none"/>
    <text class="k" x="${(x0 + c1) / 2}" y="${mid + A + 56}" text-anchor="middle">${lam.toFixed(1)} cm</text>
    <text x="${(x0 + c1) / 2}" y="${mid + A + 76}" text-anchor="middle">${ko ? '레이더 파장 하나 (L밴드)' : 'one radar wavelength (L-band)'}</text>
  </svg>`;
}

// one dot per 100 hillsides: grey for the rest, amber for watch, red for check first (drawn last, so they gather
// at the end). The dots fill in the first time the picture comes into view.
function waffle(el) {
  const L = M.levels.levels, red = Math.round(L.check_first / 100), amb = Math.round(L.watch / 100);
  const n = Math.round(M.units.n / 100), grey = n - red - amb;
  const draw = (p) => {
    const w = el.clientWidth, dpr = Math.min(devicePixelRatio || 1, 2);
    const cols = Math.max(Math.round(w / (w < 500 ? 9.5 : 13.5)), 20), pitch = w / cols, rows = Math.ceil(n / cols), r = pitch * 0.34;
    el.width = Math.round(w * dpr); el.height = Math.round(rows * pitch * dpr); el.style.height = `${rows * pitch}px`;
    const g = el.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, rows * pitch);
    for (let i = 0; i < n; i++) {
      const t = Math.min(Math.max(p * 1.6 - (i / n) * 0.6, 0), 1);           // a wave from the first dot to the last
      if (t <= 0) continue;
      const kind = i < grey ? 0 : i < grey + amb ? 1 : 2, x = (i % cols + 0.5) * pitch, y = (Math.floor(i / cols) + 0.5) * pitch;
      g.globalAlpha = t;
      if (kind === 2) { g.shadowColor = 'rgba(255, 77, 46, .9)'; g.shadowBlur = 8 * t; } else g.shadowBlur = 0;
      g.fillStyle = kind === 0 ? 'rgba(255, 255, 255, .17)' : kind === 1 ? '#ffb020' : '#ff4d2e';
      g.beginPath(); g.arc(x, y, r * (kind === 2 ? 1.12 : 1), 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
  };
  if (el.dataset.done || calm) { el.dataset.done = 1; draw(1); return; }
  if (el.dataset.started) return;                                 // already waiting or animating (a language switch re-renders)
  el.dataset.started = 1; draw(0);
  new IntersectionObserver(([e], o) => {
    if (!e.isIntersecting) return;
    o.disconnect();
    const t0 = performance.now(), dur = 1800;
    const f = (now) => { const p = Math.min((now - t0) / dur, 1); draw(1 - Math.pow(1 - p, 3)); if (p < 1) requestAnimationFrame(f); else el.dataset.done = 1; };
    requestAnimationFrame(f);
  }, { threshold: 0.35 }).observe(el);
  if (!el.dataset.sized) { el.dataset.sized = 1; addEventListener('resize', () => { if (el.dataset.done) draw(1); }); }
}

function limits(el) { el.innerHTML = [...(M.scope === 'korea' ? [7] : []), 1, 2, 3, 4, 5, 6].map((i) => `<li>${t('l' + i)}</li>`).join(''); }

// ---- line charts, drawn as plain SVG with the labels on the lines ---------------------------
const INK = '#f3f1ec', HOT = '#ff4d2e', BLUE = '#6aa9e0', MUTE = '#77756f', AMBER = '#ffb020', RULE = 'rgba(255,255,255,.1)', AXIS = 'rgba(255,255,255,.35)';

function lineChart(el, { series, xmax, xmin = 0, xticks, xfmt, xlabel, step, mark }) {
  const W = 760, H = 400, l = 48, r = 190, tp = 14, b = 46;
  const x = (v) => l + (v - xmin) / (xmax - xmin) * (W - l - r), y = (v) => tp + (1 - v / 100) * (H - tp - b);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  [0, 25, 50, 75, 100].forEach((v) => { s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? RULE : AXIS}"/><text x="${l - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`; });
  xticks.forEach((v) => { s += `<line x1="${x(v)}" x2="${x(v)}" y1="${y(0)}" y2="${y(0) + 5}" stroke="${AXIS}"/><text x="${x(v)}" y="${y(0) + 19}" text-anchor="middle">${xfmt(v)}</text>`; });
  s += `<text x="${l}" y="${H - 4}">${xlabel}</text>`;
  if (mark) s += `<line x1="${x(mark.x)}" x2="${x(mark.x)}" y1="${tp}" y2="${y(0)}" stroke="${AXIS}" stroke-dasharray="2 4"/><text x="${x(mark.x) + 6}" y="${tp + 10}">${mark.label}</text>`;
  const ends = series.map((c) => ({ c, y: y(c.pts.at(-1)[1]) })).sort((a, b2) => a.y - b2.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 17) ends[i].y = ends[i - 1].y + 17;       // keep labels apart
  series.forEach((c) => {
    const d = c.pts.map(([px, py], i) => (i ? (step ? `H${x(px).toFixed(1)}V${y(py).toFixed(1)}` : `L${x(px).toFixed(1)} ${y(py).toFixed(1)}`) : `M${x(px).toFixed(1)} ${y(py).toFixed(1)}`)).join('');
    s += `<path d="${d}" fill="none" stroke="${c.color}" stroke-width="${c.width || 1.5}" ${c.dash ? `stroke-dasharray="${c.dash}"` : ''} stroke-linejoin="round"/>`;
    if (c.dots) c.pts.forEach(([px, py]) => { s += `<circle cx="${x(px)}" cy="${y(py)}" r="3" fill="${c.color}"/>`; });
  });
  ends.forEach(({ c, y: ly }) => { s += `<text class="lab" x="${W - r + 10}" y="${ly + 4}" style="fill:${c.color}">${c.name}${c.val == null ? '' : ` <tspan style="font-family:var(--mono);font-weight:400">${Math.round(c.val)}%</tspan>`}</text>`; });
  el.innerHTML = s + '</svg>';
}

function capture(el) {
  const R = M.suscept.results, XM = 40, cut = (c) => c.curve.slice(0, XM + 1).map((v, i) => [i, v * 100]);
  const at5 = (c) => c.curve[5] * 100;                       // the number printed beside each line is its value at the top-5% mark (the check-first cut)
  lineChart(el, {
    xmax: XM, xticks: [0, 10, 20, 30, 40], xfmt: (v) => v + '%', step: true,
    xlabel: lang === 'ko' ? '점검한 사면의 비율 (순위 높은 순) →' : 'share of slopes inspected, highest ranked first →',
    mark: { x: 5, label: lang === 'ko' ? '상위 5%' : 'top 5%' },
    series: [
      { name: t('s_model'), color: HOT, width: 3, pts: cut(R.model_without_nisar), val: at5(R.model_without_nisar) },
      R.model_regional_20m ? { name: t('s_reg'), color: BLUE, dash: '6 4', pts: cut(R.model_regional_20m), val: at5(R.model_regional_20m) }
        : { name: t('s_modeln'), color: BLUE, dash: '6 4', pts: cut(R.model_full), val: at5(R.model_full) },
      { name: t('s_rule'), color: INK, pts: cut(R.steep_and_burned), val: at5(R.steep_and_burned) },
      { name: t('s_steep'), color: MUTE, pts: cut(R.steepness_only), val: at5(R.steepness_only) },
      { name: t('s_chance'), color: MUTE, dash: '2 4', pts: [[0, 0], [XM, XM]], val: 5 },
    ],
  });
}

function inject(el) {
  const A = M.anomaly.results, cm = M.anomaly.injection_cm_downslope, pts = (k) => [[0, M.anomaly.false_alarm_rate * 100], ...cm.map((c) => [c, A[k].well_oriented[c] * 100])];
  lineChart(el, {
    xmax: 8, xticks: [0, 1, 2, 3, 5, 8], xfmt: (v) => v + ' cm',
    xlabel: lang === 'ko' ? '실제 잡음에 넣은 사면 아래 방향 이동량 →' : 'downslope movement added to real noise →',
    series: [
      { name: t('s_det'), color: HOT, width: 3, dots: true, pts: pts('detector') },
      { name: t('s_mf'), color: BLUE, dots: true, pts: pts('matched') },
      { name: t('s_z'), color: INK, dots: true, pts: pts('zmax') },
      { name: t('s_ae'), color: AMBER, dash: '6 4', dots: true, pts: pts('autoenc') },
    ],
  });
}

const BLOCKS = { tracks, importance, counties, checks, limits, capture, inject, versus, waffle, detbars, phase, impact, hlimits, hsource };
function render() {
  if (!M) return;
  fill();
  $$('[data-block]').forEach((el) => BLOCKS[el.dataset.block]?.(el));
}

function setLang(l) {
  lang = l; document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  $$('.langbtn').forEach((b) => { b.textContent = l === 'en' ? 'KO' : 'EN'; });
  $$('a[data-lang-href]').forEach((a) => { a.href = `${a.dataset.langHref}?lang=${l}`; });
  render();
}
$$('.langbtn').forEach((b) => { b.onclick = () => setLang(lang === 'en' ? 'ko' : 'en'); });
setLang(lang);

// ---- page behaviour: header, reveal on scroll, before/after slider, hero ---------------------
const head = document.querySelector('.masthead'), heroEl = document.getElementById('hero');
const onScroll = () => { if (heroEl) head?.classList.toggle('solid', scrollY > heroEl.offsetHeight - 70); };   // other pages ship with it solid
addEventListener('scroll', onScroll, { passive: true }); onScroll();

$$('.sec h2, .sec .step, .sec .bignum, .sec .chart, .sec .bars, .sec .scroll, .sec ul.plain, .pagehead h1, .pagehead .lede, .pagehead .facts, .sec .cards, .sec .chain, .sec .stats, .sec .stack, .sec .two, .sec .tl').forEach((el) => el.classList.add('rv'));
let pending = [];
const reveal = () => {                                   // anything at or above the lower edge of the screen shows, so a fast jump never leaves a gap
  const h = innerHeight;
  pending = pending.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.top > h * 0.92) return true;
    el.classList.add('in');
    (el.matches('[data-count]') ? [el] : [...el.querySelectorAll('[data-count]')]).forEach(countUp);
    return false;
  });
};
addEventListener('scroll', reveal, { passive: true }); addEventListener('resize', reveal);
// a slide winds back (at once, with nothing animating) so that it arrives afresh the next time it comes up
const rearm = (slide) => {
  const els = slide.querySelectorAll('.rv.in');
  if (!els.length) return;
  slide.classList.add('reset');
  els.forEach((el) => { el.classList.remove('in'); if (!pending.includes(el)) pending.push(el); });
  void slide.offsetWidth; slide.classList.remove('reset');
};

let frameNow = () => {};                                 // set further down: runs everything that follows the scroll, right now

// ---- scrolling ------------------------------------------------------------------------------------------
// The wheel always scrolls freely and the page glides after it, eased in time (not frames) so it feels the same at
// 60 Hz and 120 Hz. On the home page it always comes to rest on a slide: a spring catches it, carrying on the motion it
// already had. It never locks: any new scroll takes over at once, from where the page is. Arrow keys, space and page
// up/down go to the next slide; the dots, Home/End and the menu go straight to theirs behind one sweep of colour.
// Touch screens and reduced-motion users keep the browser's own scrolling; a scroll made some other way (scrollbar,
// a link) stops the glide and we carry on from there.
(() => {
  if (calm || !matchMedia('(pointer: fine)').matches) return;
  const slides = $$('section[data-slide]'), deck = slides.length > 0;
  const maxY = () => document.documentElement.scrollHeight - innerHeight;
  const clamp = (y) => Math.min(Math.max(y, 0), maxY());
  let raf = 0, cur = scrollY, target = scrollY, last = 0, k = 6, idle = 0, dir = 1, auto = false;   // auto: the page is moving itself (catch, keys, dots)
  let vel = 0, lim = 0, zeta = 1, rest = scrollY;          // px/s; the bottom of the page; damping of the catch (1: no bounce); where the page last lay still
  const root = document.documentElement;
  let rushing = false;
  const rush = (on) => { if (on !== rushing) { rushing = on; root.classList.toggle('rush', on); } };   // passing through: slides show their content at once

  // Following the wheel, the page eases after the target. Moving itself, it is a spring: it picks up the speed the
  // page already has, catches the slide and lands with a small bounce.
  const step = (now) => {
    const dt = Math.min((now - (last || now - 16)) / 1000, 0.05); last = now;
    const was = cur;
    if (auto) {
      for (let i = 0; i < 2; i++) { vel += (k * k * (target - cur) - 2 * zeta * k * vel) * dt / 2; cur += vel * dt / 2; }
      if (cur < 0 || cur > lim) { cur = Math.min(Math.max(cur, 0), lim); vel = 0; }
      if (Math.abs(target - cur) < 0.4 && Math.abs(vel) < 8) cur = target;
    } else {
      cur += (target - cur) * (1 - Math.exp(-k * dt));
      if (Math.abs(target - cur) < 0.3) cur = target;
      vel = (cur - was) / dt;
    }
    rush(auto ? Math.abs(target - cur) > innerHeight * 1.15 : Math.abs(vel) > 3200);
    scrollTo(0, cur);
    frameNow();                                            // colours, dots and depth move in the same frame as the page
    if (cur === target) { if (auto) rest = target; raf = 0; last = 0; auto = false; vel = 0; rush(false); } else raf = requestAnimationFrame(step);
  };
  const glide = (y, speed, self = false, damp = 1) => {
    if (!raf) { cur = scrollY; vel = 0; }
    lim = maxY(); target = clamp(y); k = speed; auto = self; zeta = damp;
    if (!raf) raf = requestAnimationFrame(step);
  };
  // The page goes to y by itself. Arriving fast, the spring stiffens just enough to stop on the slide instead of
  // flying past it and coming back; only an unhurried arrival gets the bounce.
  const spring = (y, w = 7.5, soft = 0.8) => {
    if (!raf) { cur = scrollY; vel = 0; }
    const to = clamp(y), d = Math.abs(to - cur), sp = Math.abs(vel), toward = Math.sign(to - cur) === Math.sign(vel);
    const stiff = toward ? Math.min(Math.max(w, 0.9 * sp / Math.max(d, 1)), 14) : w;
    glide(to, stiff, true, sp > 0.45 * stiff * d || d > innerHeight * 1.3 ? 1 : soft);
  };

  // where the page can rest: the top of every slide, plus the bottom of any slide taller than the screen
  const marks = () => {
    const m = maxY(), out = [], tall = [];
    slides.forEach((s) => { const a = s.offsetTop, b = a + s.offsetHeight - innerHeight; out.push(Math.min(a, m)); if (b > a + 4) { out.push(Math.min(b, m)); tall.push([Math.min(a, m), Math.min(b, m)]); } });
    out.push(m);
    return { M: [...new Set(out)].sort((p, q) => p - q), tall };
  };
  // The page always comes to rest on a slide. From the slide it was resting on, a nudge of a few dozen pixels is enough
  // to go on to the next; further on, it lands on whichever slide is nearer where the motion would have ended
  // (ahead: how much further the swipe was still going to carry). Inside a slide taller than the screen it rests anywhere.
  const settle = (ahead = 0) => {
    const h = innerHeight, y = clamp(target + Math.min(Math.max(ahead, -h * 0.9), h * 0.9)), { M, tall } = marks();
    const a = [...M].reverse().find((v) => v <= y + 1), b = M.find((v) => v > y + 1);
    if (a == null) return false;
    if (b == null) { spring(a); return true; }
    if (tall.some(([p, q]) => p === a && q === b)) return false;
    const need = (m) => (Math.abs(m - rest) < 2 ? Math.min(h * 0.08, 70) : (b - a) * 0.4);
    spring(dir > 0 ? (y - a > need(a) ? b : a) : (b - y > need(b) ? a : b));
    return true;
  };

  // A swipe on a trackpad keeps sending the wheel long after the fingers have left, fading out over a second. Waiting
  // for that to end meant the page crawled to a stop and only then set off again for the slide. So: once the wheel is
  // plainly dying away, the landing is decided there and then and the rest of that tail is ignored. A push that grows
  // again, turns round, or comes after a pause is a new swipe and takes over at once.
  let wAbs = 0, wAt = 0, falls = 0, coast = 0;
  addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;  // pinch zoom, sideways scrolling
    if (root.classList.contains('snav-open')) return;      // the site menu is open: the wheel scrolls the menu, not the page
    if (e.target.closest?.('.scroll, textarea, select, input:not([type="range"])')) return;   // the before/after slider is a range input as big as its picture
    e.preventDefault();
    if (leaping) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    const pad = e.deltaMode === 0 && (e.wheelDeltaY ? Math.abs(e.wheelDeltaY) === Math.abs(e.deltaY) * 3 : Math.abs(e.deltaY) < 40);
    const now = performance.now(), abs = Math.abs(px), turned = px && Math.sign(px) !== dir;
    if (now - wAt > 140 || turned || abs > wAbs * 1.3 + 2) { falls = 0; coast = 0; } else if (abs < wAbs) falls++;
    wAbs = abs; wAt = now;
    if (coast && now - coast < 1100) return;
    coast = 0;
    if (px) dir = Math.sign(px);
    if (!raf) rest = scrollY;
    // carry on from the target while the wheel keeps going the same way; start from where the page is if it was
    // moving on its own or the wheel has turned round, so the page never keeps going against the hand
    const from = !raf ? scrollY : auto || Math.sign(target - cur) !== dir ? cur : target;
    glide(from + px, pad ? 11 : 5.5);
    if (!deck) return;
    clearTimeout(idle);
    if (pad && falls >= 3 && abs >= 2 && settle(px * 12)) coast = now;
    else idle = setTimeout(settle, pad ? 90 : 120);
  }, { passive: false });

  const next = (d) => {
    const y = raf ? target : scrollY, { M } = marks();
    return d > 0 ? (M.find((v) => v > y + 4) ?? maxY()) : ([...M].reverse().find((v) => v < y - 4) ?? 0);
  };
  const hop = (y) => { clearTimeout(idle); coast = 0; spring(y, 6.5, 0.82); };

  // A jump of two slides or more does not drag every colour in between past the eye. One sheet, in the colour of the
  // slide you are going to, sweeps over the whole screen; the page moves behind it; the sheet melts into that slide.
  let veil = null, leaping = false;
  const leap = (y, slide) => {
    const to = clamp(y), from = raf ? cur : scrollY, d = Math.sign(to - from) || 1;
    if (Math.abs(to - from) < innerHeight * 1.5) { hop(to); return; }
    if (leaping) return;
    leaping = true; clearTimeout(idle); coast = 0;
    if (!veil) { veil = document.createElement('div'); veil.className = 'veil'; veil.setAttribute('aria-hidden', 'true'); veil.append(document.createElement('i')); document.body.append(veil); }
    veil.dataset.slide = slide.dataset.slide; veil.dataset.from = d > 0 ? 'below' : 'above';
    const opt = { duration: 560, easing: 'cubic-bezier(.62, 0, .18, 1)', fill: 'forwards' };
    const cap = veil.firstChild.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1)', offset: 0.45 }, { transform: 'scaleY(0)' }], opt);
    const rise = veil.animate([{ transform: `translateY(calc(${d * 100}% + ${d * 110}px))`, visibility: 'visible' }, { transform: 'none', visibility: 'visible' }], opt);
    const done = () => { rise.cancel(); cap.cancel(); leaping = false; };
    rise.finished.then(() => {
      cancelAnimationFrame(raf); raf = 0; last = 0; auto = false; vel = 0; rush(false);
      scrollTo(0, to); cur = target = rest = scrollY;
      frameNow(); rearm(slide); reveal();
      const melt = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
      return melt.finished.then(() => { melt.cancel(); done(); });
    }).catch(done);
  };
  window.__page = (i) => { if (slides[i]) leap(slides[i].offsetTop, slides[i]); };
  window.__goto = (el) => { const i = slides.indexOf(el); if (i < 0) return false; window.__page(i); return true; };   // for the site menu
  if (deck) addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (root.classList.contains('snav-open')) return;
    if (e.key === ' ' && e.target.closest?.('a, button:not(.dots button)')) return;      // space presses the focused button
    const d = { ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (e.key === 'Home') leap(0, slides[0]); else leap(maxY(), slides[slides.length - 1]); return; }
    if (!d) return;
    e.preventDefault();
    if (leaping) return;
    dir = d;
    hop(next(d));
  });

  addEventListener('scroll', () => {
    if (Math.abs(scrollY - cur) > 2) { cancelAnimationFrame(raf); clearTimeout(idle); raf = 0; last = 0; auto = false; vel = 0; rush(false); target = cur = rest = scrollY; }
  }, { passive: true });
})();

// ---- home page slides: the page takes the colours of the slide under the middle of the screen,
// dots on the right jump between slides, a thin bar shows how far down you are --------------------------
const slides = $$('section[data-slide]');
const tick = [];                                                     // everything that follows the scroll, run once per frame
if (slides.length) {
  const dots = document.createElement('nav'); dots.className = 'dots'; dots.setAttribute('aria-label', 'Slides');
  dots.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Slide ${i + 1}"></button>`).join('');
  document.body.append(dots);
  const bar = document.createElement('div'); bar.className = 'progress'; document.body.append(bar);
  const btns = [...dots.children];
  // Every slide lies on its own sheet of colour, so one colour rides up over the other at a real edge instead of the
  // whole page fading. The sheets sit behind everything; each slide carries its own inks (html.sheets in the CSS).
  const ground = document.createElement('div'); ground.className = 'ground'; ground.setAttribute('aria-hidden', 'true');
  const sheets = slides.map((s) => { const i = document.createElement('i'); i.dataset.slide = s.dataset.slide; ground.append(i); return i; });
  document.body.prepend(ground); document.documentElement.classList.add('sheets');
  let tops = [], maxS = 1, inks = [], barH = 68, fill = '';
  const layout = () => {
    const y = scrollY;
    inks = sheets.map((el) => getComputedStyle(el).backgroundColor); barH = head ? head.offsetHeight : 0;
    const rs = slides.map((s) => s.getBoundingClientRect());
    tops = rs.map((r) => r.top + y);
    rs.forEach((r, i) => { sheets[i].style.top = `${(r.top + y).toFixed(2)}px`; sheets[i].style.height = `${(r.height + 1).toFixed(2)}px`; });   // 1 px under the next sheet: no hairline between two
    maxS = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  };
  btns.forEach((b, i) => { b.onclick = () => (window.__page ? window.__page(i) : scrollTo({ top: slides[i].offsetTop, behavior: 'smooth' })); });
  // The bar at the top is filled with exactly what lies behind it: one colour, or two meeting at the edge that is
  // passing under it, so it never shows as a strip of the wrong colour. Its inks are those of the slide under its
  // middle; the dots take the slide under the middle of the screen.
  let shown = -1, under = -1;
  tick.push(() => {
    const y = scrollY + 1, mid = y + innerHeight * 0.5, bar0 = y + barH / 2;
    let cur = 0, top = 0, cut = 0; tops.forEach((t, i) => { if (t <= mid) cur = i; if (t <= bar0) top = i; if (i && t > y && t < y + barH - 1) cut = i; });
    if (top !== under) { under = top; document.body.dataset.slide = slides[top].dataset.slide; if (head) { head.dataset.slide = slides[top].dataset.slide; head.classList.toggle('on-hero', slides[top].id === 'hero'); } }
    const f = cut ? `linear-gradient(${inks[cut - 1]} ${(tops[cut] - scrollY).toFixed(1)}px, ${inks[cut]} 0)` : inks[top];
    if (head && f !== fill) { fill = f; head.style.setProperty('--fill', f); }
    if (cur !== shown) {
      shown = cur;
      dots.dataset.slide = slides[cur].dataset.slide;
      btns.forEach((b, i) => b.setAttribute('aria-current', String(i === cur)));
    }
    bar.style.transform = `scaleX(${(scrollY / maxS).toFixed(4)})`;
  });

  // the edge between two sheets bows out with the speed of the page and springs flat when the page stops
  if (!calm) {
    let on = 0, lastY = scrollY, lastT = 0, bow = 0, bv = 0;
    const frame = (now) => {
      const dt = Math.min(Math.max((now - (lastT || now - 16)) / 1000, 0.004), 0.05); lastT = now;
      const y = scrollY, h = innerHeight, v = Math.abs(y - lastY) > h ? 0 : (y - lastY) / dt; lastY = y;   // a jump is not speed
      const max = Math.min(90, h / 8), want = innerWidth > 900 ? Math.min(Math.max(v * 0.045, -max), max) : 0;
      bv += ((want - bow) * 170 - bv * 15) * dt; bow += bv * dt;
      const rest = !want && Math.abs(bow) < 0.4 && Math.abs(bv) < 4;
      if (rest) bow = bv = 0;
      // scrolling down, the top edge of the rising sheet leads; scrolling up, the bottom edge of the one coming down
      const up = (Math.max(bow, 0) / 100).toFixed(3), dn = (Math.max(-bow, 0) / 100).toFixed(3);
      sheets.forEach((el, i) => {
        const t = tops[i] - y, b = (tops[i + 1] ?? Infinity) - y;
        const u = t > -120 && t < h + 120 ? up : '0', d = b > -120 && b < h + 120 ? dn : '0';
        if (el.dataset.b !== u + d) { el.dataset.b = u + d; el.style.setProperty('--bu', u); el.style.setProperty('--bd', d); }
      });
      if (rest) { on = 0; lastT = 0; } else on = requestAnimationFrame(frame);
    };
    addEventListener('scroll', () => { if (!on) { lastY = scrollY; on = requestAnimationFrame(frame); } }, { passive: true });
  }
  // slide positions move whenever the page changes height: late figures, fonts, a language switch, a resize
  addEventListener('resize', layout); addEventListener('load', layout); layout();
  new ResizeObserver(() => { layout(); frameNow(); }).observe(document.body);
}

// the hero dissolves into the page as it leaves, so the next slide's colour never meets it at a hard edge
let heroH = 1, heroO = '';
if (heroEl) {
  const size = () => { heroH = Math.max(heroEl.offsetHeight, 1); };
  addEventListener('resize', size); size();
  tick.unshift(() => {                                                 // first, before anything is written this frame
    const o = Math.min(Math.max(1 - (scrollY / heroH - 0.08) / 0.44, 0), 1).toFixed(3);
    if (o === heroO) return;
    heroO = o; heroEl.style.opacity = o; heroEl.style.visibility = +o ? '' : 'hidden';
  });
}

// depth: each slide's content trails the page a little as the slide passes. On the full-screen deck it also sinks
// back and dims as it leaves through the top, so the slide rising under it reads as the nearer one.
const layers = slides.filter((s) => s.matches('.band')).map((s) => s.firstElementChild);
if (layers.length && !calm) {
  const fine = matchMedia('(pointer: fine)').matches, c01 = (v) => Math.min(Math.max(v, 0), 1);
  const gone = layers.map(() => false);
  tick.push(() => {
    const h = innerHeight, deck = fine && innerWidth > 900;
    // all the reads, then all the writes: reading a position right after moving the last slide forced a fresh layout each time
    const rs = layers.map((w) => w.parentElement.getBoundingClientRect());
    layers.forEach((w, i) => {
      const r = rs[i], out = r.bottom <= 1 || r.top >= h - 1;
      if (out !== gone[i]) { gone[i] = out; if (out && r.top > 0) rearm(w.parentElement); }   // gone below the screen: it plays again on the way back down. Gone above: it stays as it was left
      if (r.bottom < -h * 0.2 || r.top > h * 1.2) return;
      const left = deck ? c01((h - r.bottom) / h) : 0, due = deck ? c01(r.top / h) : 0;   // how far out through the top; how far still below
      const v = `translate3d(0, ${(r.top * -0.07).toFixed(1)}px, 0) scale(${(1 - left * 0.08 - due * 0.03).toFixed(4)})`, o = (1 - 0.82 * c01((left - 0.05) / 0.5)).toFixed(3);
      if (w.dataset.ty === v + o) return;                             // unchanged: leave the style alone
      w.dataset.ty = v + o; w.style.transform = v; w.style.opacity = o;
    });
  });
}

let ticking = false;
const onFrame = () => { ticking = false; tick.forEach((f) => f()); };
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onFrame); } }, { passive: true });
frameNow = onFrame;
onFrame();

const ba = document.getElementById('ba');
if (ba) ba.querySelector('input').addEventListener('input', (e) => ba.style.setProperty('--x', e.target.value + '%'));
if (heroEl) import('./hero.js?v=28').then((m) => m.startHero(heroEl, document.querySelector('.closer'))).catch((e) => { heroEl.classList.add('nogl'); document.documentElement.classList.add('nogl'); console.warn('3D hero unavailable, showing the still image', e); });

const json = (u) => fetch(u).then((r) => r.json());
Promise.all([json(document.body.dataset.meta || 'data/meta.json'), document.body.dataset.history ? json(document.body.dataset.history) : null]).then(async ([m, h]) => {
  if (!m.runout && m.region) {                                 // nationwide pages: the debris-flow simulation lives in the regional build
    const r = await json('data/meta.json').catch(() => null);
    if (r && r.runout && r.levels.runout) { m.runout = r.runout; m.levels.runout = r.levels.runout; }
  }
  M = m; H = h; render(); pending = $$('.rv'); reveal(); $$('.hero [data-count]').forEach(countUp); })
  .catch(() => { $$('[data-n]').forEach((el) => { el.textContent = '?'; }); $$('.rv').forEach((el) => el.classList.add('in')); });
