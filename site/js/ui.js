import { STR, reason, compass } from './i18n.js?v=15';
import { addScores, checkOrder } from './score.js';
import { RAMPS, LEVEL_COLORS, TRACK_COLORS } from './terrain.js?v=24';
import { DAY0, DAYS, dayOf, AREA } from './data.js?v=3';
import { playSolver } from './inversion.js';
const stored = () => { try { return localStorage.getItem('sw_lang'); } catch { return null; } };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S4 = '#c98500';
const MODES = ['level', 'suscept', 'move', 'speed', 'burn', 'img'], ADV = ['coh', 'ifg'], AI_MODES = ['level', 'suscept'];
const LV_ICON = ['?', '·', '!', '!!'];

export class UI {
  constructor(app) {
    this.app = app; this.D = app.D; this.lang = (new URLSearchParams(location.search).get('lang')) || stored() || 'en'; this.shown = 30;
    addScores(this.D); this.order = checkOrder(this.D); this.rank = new Map(this.order.map((u, i) => [u, i + 1]));      // one order everywhere: danger index, highest first
    this.build(); this.setLang(this.lang);
  }
  t(k, v = {}) { if (this.D.korea && ((STR[this.lang] && STR[this.lang][k + '_kr']) ?? STR.en[k + '_kr']) !== undefined) k += '_kr'; let s = (STR[this.lang] && STR[this.lang][k]) ?? STR.en[k] ?? k; for (const x in v) s = s.replaceAll(`{${x}}`, v[x]); return s; }
  // The danger index and its two parts come from score.js; these only format them.
  dz(u) { return Math.round(this.D.col.danger[u]); }
  below(u) { const C = this.D.col; return C.bld[u] > 0 ? (this.lang === 'ko' ? `${this.t('bld')} ${C.bld[u]}동` : `${C.bld[u]} ${this.t('bld')}`) : (C.road[u] > 0 ? this.t('road') : ''); }
  // Share of slopes in the same band of the model's rank that failed in the July 2026 storm, read off the held-out
  // capture curve. Bands are wide (top 10%, 10-20%, 20-50%, bottom half) because there are only a few dozen failures.
  odds(u) {
    const s = this.D.meta.suscept, cv = (s.shipped_uses_nisar ? s.results.model_full : s.results.model_without_nisar).curve;
    const top = (1 - this.D.col.pct[u]) * 100, B = [0, 10, 20, 50, 100], i = Math.max(1, B.findIndex((b) => top <= b)), a = B[i - 1], b = B[i];
    const fails = Math.round((cv[b] - cv[a]) * s.n_failed), n = Math.round((b - a) / 100 * s.n_units), rnd = (v) => (v < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 50) * 50).toLocaleString();
    return { fails, n: n.toLocaleString(), one: fails ? rnd(n / fails) : null, avg: rnd(s.n_units / s.n_failed), k: s.n_failed };
  }
  county(id, withProv) {
    const c = this.D.meta.counties.find((c) => c.id === id); if (!c) return '—';
    const p = withProv && this.D.meta.provinces ? this.D.meta.provinces.find((p) => p.id === c.prov && this.D.meta.counties.filter((x) => x.prov === p.id).length > 1) : null;
    return (p ? (this.lang === 'ko' ? p.ko + ' ' : p.en + ' · ') : '') + (this.lang === 'ko' ? c.ko : c.en);
  }
  fmtDay(day) {
    const d = new Date(DAY0 + Math.round(day) * 864e5);
    return this.lang === 'ko' ? `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
      : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  build() {
    const a = this.app;
    const modeBtn = (m) => `<button class="mode" data-m="${m}" role="radio"><i></i><b data-i18n="m_${m}"></b></button>`;
    $('#modes').innerHTML = (this.D.past ? [...MODES, 'past'] : this.D.col.rec48 ? [...MODES, 'rain'] : MODES).map(modeBtn).join(''); $('#modesAdv').innerHTML = ADV.map(modeBtn).join('');
    $('#left').addEventListener('click', (e) => { const b = e.target.closest('.mode'), p = e.target.closest('[data-past]'); if (b) a.setMode(b.dataset.m); else if (p) a.flyPast(+p.dataset.past); });
    $('#tracks').innerHTML = this.D.tracks.map((t, i) => `<button data-t="${i}"><span class="dot" style="background:${TRACK_COLORS[i]}"></span>${t.id} ${t.dir === 'ascending' ? '↑' : '↓'}</button>`).join('');
    $('#tracks').onclick = (e) => { const b = e.target.closest('button'); if (b) a.setTrack(+b.dataset.t); };
    this.imgButtons();
    $('#imgs').onclick = (e) => { const b = e.target.closest('button'); if (b) a.setImage(b.dataset.k, true); };
    if (this.D.trueColour) {
      $('#imgSel').insertAdjacentHTML('beforeend', `<div class="seg" id="tcSel" style="margin-top:8px"><button data-tc="1" data-i18n="tc"></button><button data-tc="0" data-i18n="fc"></button></div>`);
      $('#tcSel').onclick = (e) => { const b = e.target.closest('button'); if (b) a.setTrueColour(b.dataset.tc === '1'); };
    }
    const ex = $('#exag'); ex.max = this.D.view.exagMax; ex.value = this.D.view.exag; $('#exagOut').textContent = '×' + (+ex.value).toFixed(1);
    $('#areaSel').innerHTML = `<a class="${AREA === 'korea' ? 'on' : ''}" href="map.html" data-i18n="area_kr_s" data-tip="area_kr"></a><a class="${AREA === 'region' ? 'on' : ''}" href="map.html?area=region" data-i18n="area_rg_s" data-tip="area_rg"></a>`;
    const togs = [['env', 1], ['trees', 1], ['borders', 1], ['roads', 1], ['labels', 1], ['edges', 1], ['scars', 0]];      // env, trees: the real-world layers (js/world.js)
    $('#debrisSwitch').hidden = !this.D.runout;
    $('#toggles').innerHTML = togs.map(([k, on]) => `<label class="tog"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span data-i18n="t_${k}"></span></label>`).join('');
    $('#toggles').onchange = $('#debrisSwitch').onchange = $('#bldSwitch').onchange = (e) => a.setToggle(e.target.dataset.k, e.target.checked);
    $('#exag').oninput = (e) => { a.setExag(+e.target.value); $('#exagOut').textContent = '×' + (+e.target.value).toFixed(1); };
    $('#opac').oninput = (e) => { a.terrain.uniforms.uOverlay.value = +e.target.value; $('#opacOut').textContent = Math.round(e.target.value * 100) + '%'; };
    $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) this.tab(b.dataset.tab); };
    $('#btnLang').onclick = () => this.setLang(this.lang === 'en' ? 'ko' : 'en');
    const bye = () => this.hintOff();
    $('#btnAI').onclick = () => this.ai();
    $('#btnBoard').onclick = () => { bye(); this.board(); };
    $('#btnStory').onclick = () => { bye(); a.story(); };
    $('#play').onclick = () => a.togglePlay();
    $('#modal').onclick = (e) => { if (e.target.id === 'modal' || e.target.closest('.close')) $('#modal').hidden = true; };
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modal').hidden = true; a.stopStory(); } if (e.key === ' ' && e.target === document.body) { e.preventDefault(); a.togglePlay(); } });
    const tl = $('#tl'); let drag = false;
    const at = (e) => { const r = tl.getBoundingClientRect(); a.setDay(Math.max(0, Math.min(DAYS - 1, (e.clientX - r.left - 8) / (r.width - 44) * (DAYS - 1))), true); };
    tl.onpointerdown = (e) => { drag = true; tl.setPointerCapture(e.pointerId); a.pause(); at(e); };
    tl.onpointermove = (e) => { if (drag) at(e); };
    tl.onpointerup = () => { drag = false; };
    new ResizeObserver(() => this.timeline()).observe(tl);          // redrawn at its real width: the window resizing, or the panels leaving for the storm replay
  }

  setLang(l) {
    this.lang = l; document.documentElement.lang = l;
    try { localStorage.setItem('sw_lang', l); } catch { /* private mode */ }
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
    document.querySelectorAll('[data-tip]').forEach((el) => { el.title = this.t(el.dataset.tip); });
    document.querySelectorAll('.mode').forEach((el) => { el.title = this.t(`m_${el.dataset.m}_s`); });
    $('#btnLang').textContent = l === 'en' ? 'KO' : 'EN';
    $('#btnSheet').href = `sheet.html?lang=${l}&county=${this.app.state.county || ''}${AREA === 'region' ? '&area=region' : ''}`;
    this.imgButtons(); this.image(this.app.state.img);
    $('#capSkip').textContent = this.t('skip');
    this.legend(); this.list(); this.detail(); this.numbers(); this.timeline(); this.app.relabel?.(l); this.time(this.app.state.day);
  }
  hintOff() { $('#hint').classList.add('gone'); }
  tab(name) {
    this.curTab = name;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    for (const k of ['list', 'detail', 'numbers']) $(`#tab-${k}`).hidden = k !== name;
  }
  mode(m) {
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#trackSel').hidden = !['move', 'coh', 'ifg'].includes(m); $('#imgSel').hidden = m !== 'img';
    this.legend();
    if ((m === 'rain') !== !!this.rainList) { this.rainList = m === 'rain'; this.shown = 30; this.list(); }      // the list follows the rain layer
  }
  // rain layer: how many flagged slopes get more rain than the heaviest they have stood through since the fire
  rain(mm) {
    const C = this.D.col; let a = 0, b = 0;
    for (let u = 0; u < this.D.n; u++) if (C.rec48[u] < mm) { if (C.level[u] === 3) a++; else if (C.level[u] === 2) b++; }
    if ($('#rainOut')) { $('#rainOut').textContent = `${mm} mm`; $('#rainCount').innerHTML = this.t('rf_count', { a: a.toLocaleString(), b: b.toLocaleString() }); }
    if (this.rainList) this.list();
  }
  track(i) { document.querySelectorAll('#tracks button').forEach((b) => b.classList.toggle('on', +b.dataset.t === i)); this.legend(); }
  image(k) {
    document.querySelectorAll('#imgs button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    document.querySelectorAll('#tcSel button').forEach((b) => b.classList.toggle('on', (b.dataset.tc === '1') === !!this.app.state.tc));
  }
  imgButtons() { $('#imgs').innerHTML = this.D.images.map((im) => `<button data-k="${im.key}" title="${esc(im.from ? im.from + ' – ' + im.to : '')}">${esc(this.lang === 'ko' ? im.ko : im.en)}</button>`).join(''); }

  // the big number counts to its new value when the filter changes it
  countUp(el, n) {
    const from = this._n ?? 0; this._n = n;
    if (from === n || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), step = (now) => {
      if (!el.isConnected) return;
      const f = Math.min(1, (now - t0) / 800);
      el.textContent = Math.round(from + (n - from) * (1 - (1 - f) ** 4)).toLocaleString();
      if (f < 1) requestAnimationFrame(step);
    };
    step(t0);
  }

  legend() {
    const m = this.app.state.mode, L = this.D.meta.levels.levels, t = (k) => this.t(k);
    const grad = (name) => `linear-gradient(90deg, ${RAMPS[name].join(',')})`;
    let h = `<div class="ttl">${t('lg_' + m)}</div>`;
    if (m === 'past') {                                         // the places, newest first; a click flies there
      const P = this.D.past, ko = this.lang === 'ko', yr = new Map(P.years.map((y) => [y.y, y])), ys = P.years.map((y) => y.y);
      const tip = (e) => e.years.map((y) => this.t('past_tip', { y, d: yr.get(y).deaths, a: yr.get(y).area_ha.toLocaleString() })).join(' / ');
      h = `<div class="ttl">${this.t('lg_past', { a: Math.min(...ys), b: Math.max(...ys) })}</div>`
        + P.events.map((e, i) => `<div class="row pick" data-past="${i}" title="${esc(tip(e))}"><i class="sw dot"></i><b>${esc(ko ? e.ko : e.en)}</b><span>${e.years.join(' · ')}</span></div>`).join('')
        + `<div class="note">${t('past_note')}</div><a class="more-link" href="history.html?lang=${this.lang}">${t('past_more')} <span>→</span></a>`;
    } else if (m === 'level') {
      const cnt = [L.not_measurable, L.no_signal, L.watch, L.check_first];
      h += [3, 2, 1, 0].map((l) => `<div class="row" title="${esc(t('lv' + l + '_d'))}"><i class="sw ${l === 0 ? 'hatch' : ''}" style="${l ? `background:${LEVEL_COLORS[l]}` : ''}">${l >= 2 ? LV_ICON[l] : ''}</i><b>${t('lv' + l)}${l >= 2 ? `<em>${l === 3 ? '80–100' : '50–79'}</em>` : ''}<small>${t('lv' + l + '_s')}</small></b><span>${cnt[l].toLocaleString()}</span></div>`).join('');
    } else if (m === 'suscept') h += `<div class="ramp" style="background:${grad('suscept')}"></div><div class="ticks"><span>${t('low')}</span><span>${t('high')}</span></div>`;
    else if (m === 'move') h += `<div class="ramp" style="background:${grad('move')}"></div><div class="ticks"><span>−3 ${t('away')}</span><span>0</span><span>+3 ${t('toward')}</span></div><div class="note">${t('hatch')}. ${t('sign')}</div>`;
    else if (m === 'speed') h += `<div class="ramp" style="background:${grad('move')}"></div><div class="ticks"><span>−30 ${t('sp_up')}</span><span>0</span><span>+30 ${t('sp_dn')}</span></div><div class="note">${t('sp_note')}</div>`;
    else if (m === 'burn') h += `<div class="ramp" style="background:${grad('burn')}"></div><div class="ticks"><span>${t('unburned')}</span><span>${t('severe')}</span></div>`;
    else if (m === 'rain') h += `<label class="slider"><span>${t('rf_label')}</span><input id="rainIn" type="range" min="80" max="200" step="5" value="${this.app.state.rain}"><output id="rainOut"></output></label><div class="rainc" id="rainCount"></div><div class="note">${t('rf_note')}</div>`;
    else if (m === 'coh') h += `<div class="ramp" style="background:${grad('coh')}"></div><div class="ticks"><span>0</span><span>0.5</span><span>1</span></div>`;
    if (m === 'img' && this.D.trueColour && this.app.state.tc) h = `<div class="ttl">${t('lg_img_tc')}</div>`;
    if (m === 'img' && this.D.trueColour) h += `<div class="note">${t('img_src')}</div>`;
    if (['move', 'speed', 'coh', 'ifg'].includes(m) && this.D.korea) h += `<div class="note">${t('radar_only')}</div>`;
    if (m === 'ifg') h += `<div class="ramp" style="background:linear-gradient(90deg,#ff4040,#c8c81e,#40ff40,#1ec8c8,#4040ff,#c81ec8,#ff4040)"></div><div class="ticks"><span>0</span><span>π</span><span>2π</span></div>`;
    $('#legend').innerHTML = h;
    if (m === 'rain') { $('#rainIn').oninput = (e) => this.app.setRain(+e.target.value); this.app.setRain(this.app.state.rain); }
  }

  // ---- "check first" list -----------------------------------------------------
  list() {
    const C = this.D.col, st = this.app.state, L = this.D.meta.levels, K = this.D.korea, nm = (x) => esc(this.lang === 'ko' ? x.ko : x.en);
    const cs = K ? this.D.meta.counties.filter((c) => L.check_first_by_county[String(c.id)] && (!st.prov || c.prov === st.prov)).sort((a, b) => (this.lang === 'ko' ? a.ko.localeCompare(b.ko, 'ko') : a.en.localeCompare(b.en)))
      : this.D.meta.counties.filter((c) => L.check_first_by_county[c.en + '-gun'] || L.check_first_by_county[c.en + '-si']);
    let rows = this.order.filter((u) => (!st.county || C.county[u] === st.county) && (!K || !st.prov || C.prov[u] === st.prov) && (st.mode !== 'rain' || C.rec48[u] < st.rain));
    const provSel = K ? `<select id="prov"><option value="0">${this.t('prov_all')}</option>${this.D.meta.provinces.map((p) => `<option value="${p.id}" ${st.prov === p.id ? 'selected' : ''}>${nm(p)} (${(L.check_first_by_province[p.en] || 0).toLocaleString()})</option>`).join('')}</select>` : '';
    const pv = K && st.prov ? this.D.meta.provinces.find((p) => p.id === st.prov) : null;
    const scope = st.county ? esc(this.county(st.county, K)) : pv ? nm(pv) : this.t(K ? 'area_kr' : 'area_rg');
    let h = `<div class="lhero"><b>${rows.length.toLocaleString()}</b><span>${this.t(st.mode === 'rain' ? 'rf_big' : 'l_big')}<small>${scope}</small></span></div>
      <div class="lfilt">${provSel}<select id="county"><option value="0">${this.t('all')}</option>${cs.map((c) => `<option value="${c.id}" ${st.county === c.id ? 'selected' : ''}>${nm(c)}${K ? ` (${L.check_first_by_county[String(c.id)]})` : ''}</option>`).join('')}</select></div>
      <div class="lcols"><span>${this.t('l_order')}</span><span>${this.t('sc_dz_s')}</span></div>`;
    const pvOf = new Map((this.D.meta.provinces || []).map((p) => [p.id, p]));
    h += rows.slice(0, this.shown).map((u, i) => {
      const r = C.r1[u] >= 0 ? reason(this.D.meta.features[C.r1[u]], C.v1[u], this.lang) : '', p = K && !st.prov ? pvOf.get(C.prov[u]) : null;
      const sub = [p ? nm(p) : '', this.below(u)].filter(Boolean).join(' · '), mv = C.moving[u] ? ` <span class="chip mv">${this.t('moving')}</span>` : '';
      return `<div class="item ${u === st.sel ? 'sel' : ''}" data-u="${u}" title="${esc(r)}"><span class="rk">${i + 1}</span><div><b>${esc(this.county(C.county[u]))}${mv}</b><small>${sub}</small></div><b class="sr">${this.dz(u)}</b></div>`;
    }).join('');
    if (rows.length > this.shown) h += `<button class="more">${this.t('showMore')}</button>`;
    const el = $('#tab-list'); el.innerHTML = h; this.countUp($('.lhero b', el), rows.length);
    $('#county').onchange = (e) => { this.shown = 30; this.app.setCounty(+e.target.value); };
    if (K) $('#prov').onchange = (e) => { this.shown = 30; this.app.setProvince(+e.target.value); };
    el.onclick = (e) => { const it = e.target.closest('.item'); if (it) this.app.select(+it.dataset.u, true); if (e.target.closest('.more')) { this.shown += 40; this.list(); } };
    el.onmouseover = (e) => { const it = e.target.closest('.item'); this.app.setHover(it ? +it.dataset.u : -1); };
    el.onmouseleave = () => this.app.setHover(-1);
    $('#btnSheet').href = `sheet.html?lang=${this.lang}&county=${st.county || ''}${AREA === 'region' ? '&area=region' : ''}`;
  }

  // ---- selected slope -----------------------------------------------------------
  detail() {
    const u = this.app.state.sel, el = $('#tab-detail'), D = this.D, C = D.col, t = (k, v) => this.t(k, v);
    if (u < 0) { el.innerHTML = `<div class="empty">${t('pick')}</div>`; return; }
    const lv = C.level[u], T = D.tracks;
    let best = -1, bz = -1;
    T.forEach((tr, i) => { const c = C['cum_' + tr.id][u], s = C['sig_' + tr.id][u]; if (C['meas_' + tr.id][u] && Number.isFinite(c) && Math.abs(c / s) > bz) { bz = Math.abs(c / s); best = i; } });
    const why = [];
    const vd = C.vd ? C.vd[u] : NaN, vs = C.vd ? C.vds[u] : NaN, sgn = (x) => { const r = Math.round(x); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r); };
    if (best < 0) why.push(['na', D.korea && !C.rcov[u] ? t('w_norcov') : t('w_nomeas')]);
    else if (C.vd && Number.isFinite(vd) && vs > 0)        // merged downslope rate from the time-series inversion
      why.push(['mv', C.moving[u] ? t('w_slide', { v: sgn(vd), s: vs.toFixed(0), d: t(vd > 0 ? 'w_slide_dn' : 'w_slide_up') })
        : vd / vs <= -4 ? t('w_upslope', { v: sgn(vd), s: vs.toFixed(0) }) : t('w_noslide', { v: sgn(vd), s: vs.toFixed(0), u: Math.ceil(Math.abs(vd) + 2 * vs) })]);
    else if (C.vd) why.push(['na', t('w_onedir')]);
    else {
      const id = T[best].id, v = C['cum_' + id][u], s = C['sig_' + id][u];
      why.push(['mv', t(C.moving[u] ? 'w_move' : 'w_nomove', { v: (v > 0 ? '+' : '') + v.toFixed(1), t: id, s: s.toFixed(1) })]);
    }
    const pct = C.pct[u];
    why.push(['', pct >= 0.8 ? t('w_top', { p: Math.max(1, Math.round((1 - pct) * 100)) }) : t('w_rank', { p: Math.round(pct * 100) })]);
    const rs = [[C.r1[u], C.v1[u]], [C.r2[u], C.v2[u]], [C.r3[u], C.v3[u]]].filter((r) => r[0] >= 0).map((r) => reason(D.meta.features[r[0]], r[1], this.lang));
    const ex = [];
    const sim = !!(C.sim && C.sim[u] > 0), r10 = (v) => (Math.round(v / 10) * 10).toLocaleString();      // flagged slopes: what the simulated debris flow reaches (p11)
    // nationwide: "below" reaches as far as this slope's debris reach, predicted by ML model 3 or simulated on the GPU (k04b)
    const ml = !sim && !!C.reach, sfx = sim ? '_sim' : ml ? '_ml' : '', rr = ml ? r10(C.reach[u]) : '';
    if (C.bld[u] > 0) ex.push(t('w_bld' + sfx, { n: C.bld[u], r: rr }));
    if (C.road[u] > 0) ex.push(t('w_road' + sfx, { r: rr }));
    if (!ex.length) ex.push(t('w_nothing' + sfx, { m: sim ? r10(C.rf_len[u]) : '', r: rr }));
    const meas = T.filter((tr) => C['meas_' + tr.id][u]).map((tr) => tr.id).join(', ');
    const sx = this.solverEx(u);
    const dz = this.dz(u), nb = C.bld[u], rd = C.road[u] > 0, od = this.odds(u);
    const dzc = lv === 3 ? t('dz_c3', { r: this.rank.get(u).toLocaleString(), n: this.order.length.toLocaleString() }) : t('dz_c' + lv);
    const rkc = C.moving[u] ? t('sc_risk_m') : t('sc_risk_c', { p: Math.min(99, Math.round(pct * 100)) });
    const ppc = t((nb > 0 ? (rd ? 'sc_ppl_br' : 'sc_ppl_b') : (rd ? 'sc_ppl_r' : 'sc_ppl_0')) + sfx, { n: nb, r: rr }), tb = sim && Number.isFinite(C.rf_tbld[u]);
    const part = (name, v, cap) => `<div class="gauge"><span>${name}</span><b>${v}<small>/100</small></b><i><em style="width:${v}%"></em></i><p>${esc(cap)}</p></div>`;
    el.innerHTML = `
      <div class="dhead"><div><span class="badge l${lv}"><span>${LV_ICON[lv]}</span>${t('lv' + lv)}</span><h2>${esc(this.county(C.county[u], D.korea))} #${u}</h2></div>
        <div class="coord">${C.lat[u].toFixed(5)}°N<br>${C.lon[u].toFixed(5)}°E</div></div>
      <div class="dz l${lv}"><span>${t('sc_dz')}</span><div class="num"><b>${dz}<small>/100</small></b><em>${dzc}</em></div>
        <div class="scale"><i></i><i></i><i></i><u style="left:${dz}%"></u></div><div class="ticks"><span>0</span><span style="left:50%">50</span><span style="left:80%">80</span><span>100</span></div></div>
      <div class="gauges">${part(t('sc_hz'), Math.round(C.hz[u]), rkc)}${part(t('sc_ex'), C.ex[u], ppc)}</div>
      <div class="odds"><b>${t('od_t')}</b><p>${od.one ? t('od_p', { n: od.one, f: od.fails, m: od.n, avg: od.avg }) : t('od_0', { m: od.n, avg: od.avg })}${C.moving[u] ? ' ' + t('od_m') : ''}</p><small>${t('od_n', { k: od.k })}</small></div>
      <div class="scnote">${t('sc_note')}</div>
      <div class="kv ${C.rec48 || ml ? '' : 'two'}"><div><b>${C.slope[u].toFixed(0)}°</b><span>${t('slope')} · ${t('faces')} ${compass(C.aspect[u], this.lang)}</span></div>
        <div><b>${C.rain_storm[u].toFixed(0)} mm</b><span>${t('stormRain')}</span></div>
        ${ml ? `<div><b>${rr} m</b><span>${t(C.reach_src[u] === 2 ? 'rc_tile_sim' : 'rc_tile_ml')}</span></div>` : ''}
        ${C.rec48 ? `<div><b>${C.rec48[u].toFixed(0)} mm</b><span>${t('rf_tile', { d: new Date(Date.parse(D.meta.rain_record.day0) + C.rec_day[u] * 864e5).toLocaleDateString(this.lang === 'ko' ? 'ko-KR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) })}</span></div>` : ''}</div>
      ${sim ? `<div class="sec runout"><h4>${t('ro_h')}</h4><div><div class="kv"><div><b>${r10(C.rf_len[u])} m</b><span>${t('ro_far')}</span></div><div><b>${r10(C.ro_len[u])} m</b><span>${t('ro_fit')}</span></div>
        <div><b>${tb ? Math.round(C.rf_tbld[u]) + ' s' : Math.round(C.rf_vmax[u]) + ' m/s'}</b><span>${t(tb ? 'ro_t' : 'ro_v')}</span></div></div>
        <p class="whysum">${t('ro_note')}</p>${this.D.runout ? `<div class="links"><button id="dFlow">${t('ro_play')}</button></div>` : ''}</div></div>` : ''}
      <div class="sec"><h4>${t('why', { l: t('lv' + lv) })}</h4><p class="whysum">${t(lv === 2 ? (C.moving[u] || pct >= 0.95 ? 'why2a' : 'why2b') : 'why' + lv)}</p>
        <div class="q"><b>1 · ${t('d_q1')}</b><ul class="why">${why.map(([c, s]) => `<li class="${c}">${esc(s)}</li>`).join('')}${rs.map((s) => `<li>${esc(s)}</li>`).join('')}
        ${C.label[u] ? `<li class="ex">${esc(t('w_scar'))}</li>` : ''}</ul></div>
        <div class="q"><b>2 · ${t('d_q2')}</b><ul class="why">${ex.map((s) => `<li class="ex">${esc(s)}</li>`).join('')}</ul></div></div>
      ${D.korea && !C.rcov[u] ? `<div class="sec"><h4>${t('history')}</h4><p class="whysum">${t('norcov_p')}</p><div class="links"><a class="btn" href="map.html?area=region">${t('area_rg')}</a></div></div>` : ''}
      ${sx ? `<div class="sec"><h4>${t('solver_h')}</h4><div id="dsolve" class="inv"></div><div class="caveat" style="border:0;padding:0;margin-top:6px">${esc(t('solver_c'))}</div></div>` : ''}
      <div class="sec" ${D.korea && !C.rcov[u] ? 'hidden' : ''}><h4>${t('history')} <span style="text-transform:none;letter-spacing:0">(${t('cm')})</span></h4><div id="dchart" class="chart"></div>
        <div class="cleg">${T.map((tr, i) => C['meas_' + tr.id][u] ? `<span><i style="background:${TRACK_COLORS[i]}"></i>${tr.id} ${tr.dir === 'ascending' ? '↑' : '↓'}</span>` : '').join('')}<span><i style="background:#555;height:8px;opacity:.5"></i>${t('noise')}</span></div>
        ${meas ? `<div class="caveat" style="border:0;padding:0;margin-top:6px">${esc(t('w_meas', { t: meas }))}. ${esc(t('sign'))}</div>` : ''}</div>
      <div class="links"><button id="dFly">${t('fly')}</button><a class="btn" target="_blank" rel="noopener" href="https://map.kakao.com/link/map/SLOPEWATCH,${C.lat[u].toFixed(6)},${C.lon[u].toFixed(6)}">${t('kakao')}</a><button id="dCopy">${t('copy')}</button><a class="btn" target="_blank" href="form.html?u=${u}&lang=${this.lang}${AREA === 'region' ? '&area=region' : ''}">${t('form')}</a></div>
      <div class="caveat">${t('caveat')}</div>`;
    $('#dFly').onclick = () => this.app.flyToUnit(u);
    if ($('#dFlow')) $('#dFlow').onclick = () => { this.app.debris.focus(this.D.runout.flow.get(u) ?? -1); this.app.flyToUnit(u); };
    $('#dCopy').onclick = (e) => { navigator.clipboard?.writeText(`${C.lat[u].toFixed(6)}, ${C.lon[u].toFixed(6)}`); e.target.textContent = t('copied'); };
    if (sx) playSolver($('#dsolve'), sx, { W: 340, H: 250, X0: 34, header: false, legend: false, colors: TRACK_COLORS });
    // movement chart
    const series = T.map((tr, i) => ({ name: `${tr.id}`, color: TRACK_COLORS[i], pts: C['meas_' + tr.id][u] ? tr.days.map((d, k) => [d, D.cum(u, i, k)]).filter((p) => Number.isFinite(p[1])) : [] })).filter((s) => s.pts.length > 1);
    const sg = T[0].noise_pair.reduce((a, b) => a + b, 0) / T[0].noise_pair.length;
    const band = Array.from({ length: 12 }, (_, k) => { const d = 21 + k * 11; return [d, -2 * sg * Math.sqrt(k), 2 * sg * Math.sqrt(k)]; });
    let ymax = 2; series.forEach((s) => s.pts.forEach((p) => { ymax = Math.max(ymax, Math.abs(p[1]) * 1.15); }));
    lineChart($('#dchart'), { w: 320, h: 150, series, band, x: [15, 147], y: [-ymax, ymax], vband: [47, 49],
      xt: [[30, 'Jul'], [61, 'Aug'], [92, 'Sep'], [122, 'Oct']], yt: niceTicks(-ymax, ymax, 4), fmtX: (d) => this.fmtDay(d), unit: ' cm', markers: true });
  }

  // the selected slope as the solver sees it: the passes of each usable track projected onto the slope line (same
  // arithmetic as p04b), and the solved model. The nationwide cells carry the model only, so no dots there.
  solverEx(u) {
    const D = this.D, C = D.col;
    if (!C.vd || !Number.isFinite(C.vd[u]) || !(C.vds[u] > 0)) return null;
    const Ts = Math.round((Date.parse(D.meta.storm[0]) - Date.UTC(2026, 5, 1)) / 864e5), f = (a) => (Number.isFinite(a) ? a : 0);
    const vpre = f(C.vpre?.[u]), step = f(C.vstep?.[u]), v = C.vd[u];
    const model = (t) => vpre * (Math.min(t, Ts) - Ts) / 30 + (t >= Ts ? step : 0) + v * Math.max(t - Ts, 0) / 30;
    const tracks = [];
    if (C.cpost) D.tracks.forEach((tr, i) => {
      const s = C['sens_' + tr.id][u]; let prev = D.cum(u, i, 0);
      if (!C['meas_' + tr.id][u] || !(Math.abs(s) >= 0.25) || !Number.isFinite(prev)) return;
      const days = tr.days, mm = [model(days[0])]; let acc = mm[0];
      for (let k = 1; k < days.length; k++) {
        const cur = D.cum(u, i, k), a = days[k - 1], b = days[k];
        if (!Number.isFinite(cur)) { acc += model(b) - model(a); mm.push(null); continue; }          // a missing pass follows the fit and is not drawn
        const shared = f(C.cpre[u]) * Math.max(Math.min(b, Ts) - a, 0) / 30 + (a < Ts && b >= Ts ? f(C.cstep[u]) : 0) + f(C.cpost[u]) * Math.max(b - Math.max(a, Ts), 0) / 30;
        acc += ((cur - prev) * 10 - shared) / s; prev = cur; mm.push(acc);
      }
      tracks.push({ id: tr.id, k: i, days, mm });
    });
    return { u, v, s: C.vds[u], z: v / C.vds[u], v_pre: vpre, step, storm_day: Ts, slope: C.slope[u], moving: !!C.moving[u], tracks };
  }

  // ---- the three numbers -----------------------------------------------------------
  nums() {
    const m = this.D.meta, s = m.suscept, R = s.results, ship = s.shipped_uses_nisar ? R.model_full : R.model_without_nisar, a = m.anomaly, pc = (v) => Math.round(v * 100);
    return { m, R, ship, a, pc,
      tiles: [
        ['n1', { v: pc(ship.capture_top5) }, { b: pc(R.steepness_only.capture_top5), s: pc(1 / s.n_failed) }, this.t('n1_f', { n: s.n_failed })],
        ['n2', { v: a.detect50_cm_well_oriented?.toFixed(1) ?? '>8' }, { v80: a.detect80_cm_well_oriented?.toFixed(1) ?? '>8', w: pc(a.well_oriented_share) }, null],
        this.D.korea ? ['n3', { v: pc(R.model_regional_20m.capture_top10) + '%' }, { a: pc(ship.capture_top10), b: pc(R.model_regional_20m.capture_top10), r: pc(R.model_with_rain.capture_top10) }, null]
          : ['n3', { v: (s.nisar_adds_top10 > 0 ? '+' : '−') + Math.abs(pc(s.nisar_adds_top10)) }, { a: pc(R.model_full.capture_top10), b: pc(R.model_without_nisar.capture_top10) }, null],
      ] };
  }
  tilesHTML() {
    return this.nums().tiles.map(([k, v, p, flag]) => `<div class="tile"><div class="k">${this.t(k + '_k')}</div><div class="v">${this.t(k + '_v', v)}</div><p><b>${this.t(k + '_s')}.</b> ${this.t(k + '_p', p)}</p>${flag ? `<span class="flag">⚠ ${flag}</span>` : ''}</div>`).join('');
  }
  aiTiles() {
    const { R, ship, a, pc, m } = this.nums(), t = (k, v) => this.t(k, v), x = (v) => (Math.abs(v - Math.round(v)) < 0.15 ? Math.round(v) : v.toFixed(1));
    const det = a.results.detector.well_oriented[3], mf = a.results.matched.well_oriented[3];
    return `<div class="tile"><div class="k">${t('ai_m1')}</div><div class="v">${t('a1_v', { x: x(ship.capture_top5 / 0.05) })}</div><p>${t('a1_p', { v: pc(ship.capture_top5), b: pc(R.steepness_only.capture_top5) })}</p><span class="flag">⚠ ${t('n1_f', { n: m.suscept.n_failed })}</span></div>
      <div class="tile"><div class="k">${t('ai_m2')}</div><div class="v">${t('a2_v', { x: x(det / mf) })}</div><p>${t('a2_p', { a: pc(det), b: pc(mf) })}</p></div>`;
  }
  numbers() {
    const L = this.D.meta.levels.levels;
    $('#tab-numbers').innerHTML = this.aiTiles() + `<div class="tile"><div class="k">${this.t('counts')}</div>
      ${[['lv3', L.check_first, 3], ['lv2', L.watch, 2], ['lv1', L.no_signal, 1], ['lv0', L.not_measurable, 0]].map(([k, v, l]) => `<div class="lvrow"><span><i class="sw ${l === 0 ? 'hatch' : ''}" style="${l ? `background:${LEVEL_COLORS[l]}` : ''}"></i>${this.t(k)}</span><b>${v.toLocaleString()}</b></div>`).join('')}</div>
      ${this.D.korea ? this.provBars() : ''}<button id="openBoard" class="more">${this.t('lb')}</button><button id="openAI" class="more">${this.t('ai')}</button><button id="openProof" class="more">${this.t('open')}</button>`;
    $('#openAI').onclick = () => this.ai(); $('#openBoard').onclick = () => this.board();
    document.querySelectorAll('.pbar').forEach((el) => { el.onclick = () => { this.tab('list'); this.app.setProvince(+el.dataset.p); }; });
    $('#openProof').onclick = () => this.proof();
  }

  provBars() {
    const L = this.D.meta.levels, P = this.D.meta.provinces.map((p) => ({ p, c: L.check_first_by_province[p.en] || 0, w: L.watch_by_province[p.en] || 0, n: L.slopes_by_province[p.en] || 0 })).sort((a, b) => b.c - a.c);
    const mx = Math.max(...P.map((r) => r.c), 1);
    return `<div class="tile"><div class="k">${this.t('byprov')}</div>${P.map((r) => `<div class="pbar" data-p="${r.p.id}" title="${esc(this.t('byprov_t', { w: r.w.toLocaleString(), n: r.n.toLocaleString() }))}"><span>${esc(this.lang === 'ko' ? r.p.ko : r.p.en)}</span><i><em style="width:${(r.c / mx * 100).toFixed(1)}%"></em></i><b>${r.c.toLocaleString()}</b></div>`).join('')}</div>`;
  }

  // ---- leaderboard: the slopes by danger index, and provinces and counties by their check-first slopes ----
  // Counted here from the per-slope levels, so it always matches the map and the list.
  boardData() {
    if (this._board) return this._board;
    const C = this.D.col, K = this.D.korea, M = this.D.meta, cty = new Map(), prov = new Map();
    const add = (m, id, u) => {
      if (!id) return; let r = m.get(id); if (!r) m.set(id, r = { id, n: 0, c: 0, w: 0, b: 0 });
      r.n++; if (C.level[u] === 3) { r.c++; r.b += C.bld[u] || 0; } else if (C.level[u] === 2) r.w++;
    };
    for (let u = 0; u < this.D.n; u++) { add(cty, C.county[u], u); if (K) add(prov, C.prov[u], u); }
    const join = (m, list) => [...m.values()].map((r) => ({ ...r, a: list.find((x) => x.id === r.id) })).filter((r) => r.a);
    return (this._board = { cty: join(cty, M.counties), prov: K ? join(prov, M.provinces) : [] });
  }
  board(scope = this.lbScope || 'slope', metric = this.lbMetric || 'c') {
    if (scope !== this.lbScope || metric !== this.lbMetric) this.lbShown = 20;
    this.lbScope = scope; this.lbMetric = metric;
    const t = (k, v) => this.t(k, v), K = this.D.korea, ko = this.lang === 'ko', MIN = 50, C = this.D.col, SL = scope === 'slope';
    const provName = (id) => { const p = K ? this.D.meta.provinces.find((p) => p.id === id) : null; return p ? esc(ko ? p.ko : p.en) : ''; };
    let rows, key, val, fmt, name, pv, cap, bar;
    if (SL) {                                                   // the slopes themselves: the same order as the check-first list
      rows = this.order; key = (u) => u; val = (u) => C.danger[u]; fmt = (v) => Math.round(v);
      name = (u) => esc(this.county(C.county[u])); pv = (u) => provName(C.prov?.[u]);
      cap = (u) => [`${C.slope[u].toFixed(0)}°`, this.below(u), C.moving[u] ? t('moving') : ''].filter(Boolean).join(' · ');
      bar = (u) => (C.danger[u] - 80) * 5;
    } else {
      val = { c: (r) => r.c, s: (r) => (r.n >= MIN ? r.c / r.n : 0), b: (r) => r.b }[metric];
      fmt = { c: (v) => v.toLocaleString(), s: (v) => (v * 100).toFixed(1) + '%', b: (v) => Math.round(v).toLocaleString() }[metric];
      rows = this.boardData()[scope].filter((r) => val(r) > 0).sort((a, b) => val(b) - val(a) || b.c - a.c);
      const mx = rows.length ? val(rows[0]) : 1;
      key = (r) => r.id; name = (r) => esc(ko ? r.a.ko : r.a.en); pv = (r) => (scope === 'cty' ? provName(r.a.prov) : '');
      cap = (r) => t('lb_of', { c: r.c.toLocaleString(), n: r.n.toLocaleString() }); bar = (r) => val(r) / mx * 100;
    }
    const seg = (attr, cur, opts) => `<div class="seg">${opts.map(([k, l]) => `<button data-${attr}="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    $('#modalBody').innerHTML = `<h2>${t('lb')}</h2><p class="lead">${t(SL ? 'lb_lead_sl' : 'lb_lead')}</p>
      <div class="lb-ctl">${seg('lbs', scope, [['slope', t('lb_slope')], ...(K ? [['prov', t('lb_prov')]] : []), ['cty', t('lb_cty')]])}${SL ? '' : seg('lbm', metric, [['c', t('lb_m_c')], ['s', t('lb_m_s')], ['b', t('lb_m_b')]])}</div>
      <div class="podium">${rows.slice(0, 3).map((r, i) => `<div class="pod p${i + 1}" data-lb="${key(r)}" role="button" tabindex="0"><span class="n">${i + 1}</span><div class="nm">${name(r)}${pv(r) ? `<small>${pv(r)}</small>` : ''}</div><div class="val">${fmt(val(r))}</div><div class="cap">${cap(r)}</div></div>`).join('')}</div>
      <div class="lbrows">${rows.slice(3, this.lbShown).map((r, i) => `<div class="lbrow" data-lb="${key(r)}" title="${esc(cap(r))}"><span class="rk">${i + 4}</span><span class="nm">${name(r)}${pv(r) ? `<small>${pv(r)}</small>` : ''}</span><i><em style="width:${bar(r).toFixed(1)}%"></em></i><b>${fmt(val(r))}</b></div>`).join('')}</div>
      ${rows.length > this.lbShown ? `<button id="lbMore" class="more">${t('showMore')}</button>` : ''}
      <p class="rulenote">${t(SL ? 'lb_note_sl' : metric === 's' ? 'lb_note_s' : (metric === 'b' ? 'lb_note_b' : 'lb_note'), { n: MIN })}</p>`;
    $('#modal').hidden = false;
    $('#modalBody').onclick = (e) => {
      const s = e.target.closest('[data-lbs]'), m = e.target.closest('[data-lbm]'), r = e.target.closest('[data-lb]');
      if (s) this.board(s.dataset.lbs, metric); else if (m) this.board(scope, m.dataset.lbm);
      else if (e.target.closest('#lbMore')) { this.lbShown += 40; this.board(scope, metric); }
      else if (r) {
        const id = +r.dataset.lb; $('#modal').hidden = true;
        if (SL) return this.app.select(id, true);
        this.shown = 30; this.tab('list');
        if (scope === 'prov') this.app.setProvince(id);
        else { if (K) this.app.state.prov = this.D.meta.counties.find((c) => c.id === id)?.prov || 0; this.app.setCounty(id); }
      }
    };
  }

  // ---- "How the AI works": the two models in plain language ----------------------------
  ai() {
    const { m, ship, a } = this.nums(), t = (k, v) => this.t(k, v), s = m.suscept;
    const x = (v) => (Math.abs(v - Math.round(v)) < 0.15 ? Math.round(v) : v.toFixed(1));
    const det = a.results.detector.well_oriented[3], mf = a.results.matched.well_oriented[3];
    // the same small live drawings as the home page's engines
    const G = {
      tree: '<svg class="eng-glyph g-tree" viewBox="0 0 112 40" aria-hidden="true"><path class="e" style="--i:0" pathLength="1" d="M56 5L28 20"/><path class="e" style="--i:0" pathLength="1" d="M56 5L84 20"/><path class="e" style="--i:1" pathLength="1" d="M28 20L14 35"/><path class="e" style="--i:1" pathLength="1" d="M28 20L42 35"/><path class="e" style="--i:1" pathLength="1" d="M84 20L70 35"/><path class="e" style="--i:1" pathLength="1" d="M84 20L98 35"/><circle class="n" style="--i:0" cx="56" cy="5" r="3.2"/><circle class="n" style="--i:1" cx="28" cy="20" r="3.2"/><circle class="n" style="--i:1" cx="84" cy="20" r="3.2"/><circle class="n" style="--i:2" cx="14" cy="35" r="3.2"/><circle class="n hit" style="--i:2" cx="70" cy="35" r="3.2"/><circle class="n" style="--i:2" cx="42" cy="35" r="3.2"/><circle class="n" style="--i:2" cx="98" cy="35" r="3.2"/></svg>',
      gru: `<svg class="eng-glyph g-gru" viewBox="0 0 112 40" aria-hidden="true">${[10, 16, 8, 14, 11, 18, 9, 13, 22, 28, 33, 37].map((h, i) => `<rect class="b${i > 7 ? ' hit' : ''}" x="${4 + i * 9}" y="${38 - h}" width="5" height="${h}" rx="1.5"/>`).join('')}<rect class="scan" x="0" y="0" width="14" height="40" rx="3"/></svg>`,
      flow: '<svg class="eng-glyph g-flow" viewBox="0 0 112 40" aria-hidden="true"><path class="s" d="M4 5C30 7 44 21 62 29S96 35 109 35"/><path class="f" pathLength="1" d="M9 6C31 9 44 21 62 29S82 34 90 35"/><path class="h" d="M91 35v-8l6-5 6 5v8z"/></svg>',
    };
    const models = [
      ['tree', t('ai_x', { x: x(ship.capture_top5 / 0.05) }), t('ai_s1'), t('ai_t1', { f: s.features.length })],
      ['gru', t('ai_x', { x: x(det / mf) }), t('ai_s2'), t('ai_t2')],
      m.reach && ['flow', 'R² ' + m.reach.far.r2_heldout.toFixed(2), t('ai_s3'), t('ai_t3')],
    ].filter(Boolean);
    const rule = (i) => t(i === 2 && m.reach ? 'ai_r2_ml' : 'ai_r' + i, { n: m.levels.check_first_moving }).match(/<b>(.*?)<\/b>\s*(.*)/s);
    $('#modalBody').innerHTML = `<div class="aisheet"><p class="kick">${t('ai_title')}</p><h2>${t('ai_hl' + models.length).replace('<br>', ' ')}</h2><p class="lead">${t('ai_ls')}</p>
      <div class="pin"><div class="big">${this.D.n.toLocaleString()}</div><div class="lbl">${t('ai_iu')}</div><ul>${[1, 2, 3, 4].map((i) => `<li>${t('ai_c' + i)}</li>`).join('')}</ul></div>
      <div class="pai" style="--n:${models.length}">${models.map(([g, v, l, tag], i) => `<div>
        <span class="pk">AI ${i + 1} · ${tag}</span>${G[g]}<h3>${t('ai_n' + (i + 1))}</h3><p>${t('ai_d' + (i + 1), { n: m.reach?.simulated_slopes.toLocaleString() })}</p>
        <div class="st"><b>${v}</b><span>${l}</span></div></div>`).join('')}</div>
      <div class="pout"><div class="big" data-count="${m.levels.levels.check_first}">${m.levels.levels.check_first.toLocaleString()}</div><div><b>${t('ai_out_v')}</b><p>${t('ai_os')}</p></div></div>
      <h3 class="hh">${t(models.length === 3 ? 'ai_rs' : 'ai_rs2')}</h3>
      <ol class="steps">${[1, 2, 3].map((i) => { const [, q, ans] = rule(i); return `<li><b>${q}</b><p>${ans}</p></li>`; }).join('')}</ol>
      <p class="rulenote">${t('ai_rule_n')}</p>
      <h3 class="hh">${t('ai_honest')}</h3><ul class="honest">${[1, 2, 3].map((i) => `<li>${t('ai_h' + i, { n: s.n_failed })}</li>`).join('')}</ul>
      <button id="aiProof" class="more">${t('ai_more')} →</button></div>`;
    $('#modal').hidden = false;
    const big = $('#modalBody .pout .big'), N = +big.dataset.count, t0 = performance.now();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const tick = (now) => { const p = Math.min(1, (now - t0) / 1100); big.textContent = Math.round(N * (1 - (1 - p) ** 3)).toLocaleString(); if (p < 1 && !$('#modal').hidden) requestAnimationFrame(tick); else big.textContent = N.toLocaleString(); };
      requestAnimationFrame(tick);
    }
    $('#aiProof').onclick = () => this.proof();
  }

  proof() {
    const { m, R, a, pc } = this.nums(), t = (k, v) => this.t(k, v), S = m.series, T = m.tracks, ag = S.ascending_agreement, mv = S.movement, lab = m.labels;
    const ship = m.suscept.shipped_uses_nisar, V = m.velocity;
    const row = (name, val, cls, status) => `<tr><td>${name}</td><td>${val}</td><td class="n ${cls}">${status}</td></tr>`;
    const stab = Object.values(T).map((x) => x.stable_cum_median.toFixed(2)).join(' / '), stabn = Object.values(T).map((x) => x.stable_cum_mad.toFixed(1)).join(' / ');
    const meas = this.D.korea ? m.levels.radar_measured : this.D.n - m.levels.levels.not_measurable;
    $('#modalBody').innerHTML = `<h2>${t('p_title')}</h2><p class="lead">${t('p_lead')}</p><div class="g3">${this.tilesHTML()}</div>
      <div class="g2"><div><h3>${t('p_cap')}</h3><p class="s">${t('p_cap_s')}</p><div id="capChart" class="chart"></div><div class="cleg" id="capLeg"></div></div>
        <div><h3>${t('p_inj')}</h3><p class="s">${t('p_inj_s')}</p><div id="injChart" class="chart"></div><div class="cleg" id="injLeg"></div></div></div>
      <div class="g2"><div><h3>${t('p_checks')}</h3><table class="t">
        ${row(t('c_stable'), t('c_stable_v', { a: stab, n: S.stable_units.toLocaleString(), s: stabn }), 'pass', t('ok'))}
        ${V ? row(t('c_inv'), t('c_inv_v', { p: Object.values(T).reduce((a, x) => a + x.dates.length - 1, 0), r: V.recovery['50'].recovered_median.toFixed(1), c: Math.round(Math.abs(V.calibration_factor.post - 1) * 100) }), 'pass', t('ok'))
          + row(t('c_floor'), t('c_floor_v', { q: (V.no_detectable_movement_share * 100).toFixed(1), n: V.slopes_solved.toLocaleString(), s: V.sigma_post_mm_pct['50'].toFixed(0) }), 'pass', t('ok'))
          + row(t('c_dir'), t('c_dir_v', { d: V.detected_downslope, u: V.detected_upslope, n: V.detected }), 'pass', t('ok'))
          : row(t('c_far'), t('c_far_v', { a: (mv.stable_units_flagged_share * 100).toFixed(2), b: (mv.share_of_measurable_slopes * 100).toFixed(2) }), 'pass', t('ok'))}
        ${row(t('c_asc'), t('c_asc_v', { r: ag.r_all.toFixed(2), n: ag.units.toLocaleString(), p: pc(ag.same_sign_moving) }), 'warn', t('weak'))}
        ${row(t('c_ml'), t('c_ml_v', { a: pc(a.results.detector.well_oriented[3]), b: pc(a.results.matched.well_oriented[3]) }), 'pass', t('ok'))}
        ${row(t('c_ae'), t('c_ae_v', { a: pc(a.results.autoenc.well_oriented[3]), b: pc(a.results.zmax.well_oriented[3]) }), 'fail', t('notused'))}
        ${row(t('c_cov'), t('c_cov_v', { a: meas.toLocaleString(), b: (this.D.korea ? m.levels.radar_units : this.D.n).toLocaleString() }), 'pass', t('ok'))}
        ${this.D.korea ? row(t('c_nat'), t('c_nat_v', { n: this.D.n.toLocaleString(), r: m.levels.radar_units.toLocaleString() }), 'warn', t('open_')) : ''}
        ${row(t('c_lab'), t('c_lab_v', { c: lab.candidates_ge3px, f: lab.auto_failure, u: lab.failed_slope_units, h: lab.human_reviewed }), 'warn', t('open_'))}
        ${m.sign?.confirmed ? row(t('c_sign'), t('c_sign_ok', { n: m.sign.pairs, r: Math.min(m.sign.wet_r, m.sign.hydro_r).toFixed(2), t: Math.abs(m.sign.tide_r).toFixed(2) }), 'pass', t('ok')) : row(t('c_sign'), t('c_sign_v'), 'warn', t('open_'))}</table></div>
        <div><h3>${t('p_limits')}</h3><ul class="limits">${[1, 2, 3, 4, 5, 6].map((i) => `<li>${t('l' + i)}</li>`).join('')}</ul></div></div>`;
    $('#modal').hidden = false;
    const x = Array.from({ length: 101 }, (_, i) => i);
    const cs = [
      { name: t('s_model'), color: TRACK_COLORS[0], width: 2.6, pts: x.map((i) => [i, (ship ? R.model_full : R.model_without_nisar).curve[i] * 100]) },
      this.D.korea ? { name: t('s_regional'), color: TRACK_COLORS[1], pts: x.map((i) => [i, R.model_regional_20m.curve[i] * 100]) }
        : { name: ship ? t('s_model') + ' − NISAR' : t('s_modeln'), color: TRACK_COLORS[1], pts: x.map((i) => [i, (ship ? R.model_without_nisar : R.model_full).curve[i] * 100]) },
      { name: t('s_rule'), color: TRACK_COLORS[2], pts: x.map((i) => [i, R.steep_and_burned.curve[i] * 100]) },
      { name: t('s_steep'), color: S4, pts: x.map((i) => [i, R.steepness_only.curve[i] * 100]) },
      { name: t('s_chance'), color: '#898781', dash: '4 4', width: 1.2, pts: [[0, 0], [100, 100]] },
    ];
    lineChart($('#capChart'), { w: 440, h: 260, series: cs, x: [0, 100], y: [0, 100], xt: [0, 10, 25, 50, 75, 100].map((v) => [v, v + '%']), yt: [0, 25, 50, 75, 100].map((v) => [v, v + '%']), xl: t('inspected'), yl: t('found'), vline: 10, fmtX: (v) => `${Math.round(v)}% ${t('inspected')}`, unit: '%', dec: 0 });
    $('#capLeg').innerHTML = cs.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    const ds = a.injection_cm_downslope, is = [['detector', 's_det', TRACK_COLORS[0], 2.6], ['matched', 's_mf', TRACK_COLORS[1], 2], ['zmax', 's_z', TRACK_COLORS[2], 2], ['autoenc', 's_ae', S4, 2]]
      .map(([k, l, c, w]) => ({ name: t(l), color: c, width: w, pts: ds.map((d) => [d, a.results[k].well_oriented[d] * 100]) }));
    lineChart($('#injChart'), { w: 440, h: 260, series: is, x: [0.5, 8.5], y: [0, 100], xt: ds.map((d) => [d, d + ' cm']), yt: [0, 25, 50, 75, 100].map((v) => [v, v + '%']), xl: t('size'), yl: t('caught'), fmtX: (v) => `${v} cm`, unit: '%', dec: 0, markers: true, endLabels: false });
    $('#injLeg').innerHTML = is.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
  }

  // ---- timeline ----------------------------------------------------------------------
  timeline() {
    const el = $('#tl'), W = el.clientWidth || 800, H = el.clientHeight || 96, D = this.D, r = D.rain, x = (d) => 8 + d / (DAYS - 1) * (W - 44);
    const mx = Math.max(...r.mean), y0 = Math.round(H * 0.56), bh = y0 - 11;
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    s += `<rect x="${x(47) - 1}" y="2" width="${x(49) - x(47) + 2}" height="${H - 4}" fill="rgba(255,77,46,.2)"/><text x="${x(49) + 5}" y="10" style="fill:#ff4d2e">${this.t('storm')}</text>`;
    const stormEnd = x(49) + 9 + this.t('storm').length * 6.2;                // a month name gives way to the storm's label
    [['Jun', 0], ['Jul', 30], ['Aug', 61], ['Sep', 92], ['Oct', 122]].forEach(([m, d]) => { if (x(d) > x(49) && x(d) < stormEnd) { s += `<line x1="${x(d)}" x2="${x(d)}" y1="14" y2="${H - 2}" stroke="rgba(255,255,255,.1)"/>`; return; } s += `<line x1="${x(d)}" x2="${x(d)}" y1="2" y2="${H - 2}" stroke="rgba(255,255,255,.1)"/><text x="${x(d) + 4}" y="10">${this.lang === 'ko' ? (6 + ['Jun', 'Jul', 'Aug', 'Sep', 'Oct'].indexOf(m)) + '월' : m}</text>`; });
    const bw = Math.max(1, (W - 44) / DAYS - 1);
    r.mean.forEach((v, d) => { if (v > 0.3) { const h = Math.max(1, v / mx * bh); s += `<rect x="${x(d) - bw / 2}" y="${y0 - h}" width="${bw}" height="${h}" fill="#5598e7" opacity="${d === 47 || d === 48 ? 1 : 0.55}" rx="1"/>`; } });
    s += `<line x1="8" x2="${W - 36}" y1="${y0}" y2="${y0}" stroke="rgba(255,255,255,.22)"/>`;
    D.tracks.forEach((tr, i) => { tr.days.forEach((d) => { s += `<circle cx="${x(d)}" cy="${y0 + 8}" r="2.6" fill="${TRACK_COLORS[i]}" stroke="#0b0c0d" stroke-width="1"/>`; }); });
    D.meta.s2.map(dayOf).filter((d) => d >= 0 && d < DAYS).forEach((d) => { const y = y0 + 17; s += `<path d="M${x(d)} ${y - 3}l3 3-3 3-3-3z" fill="#f3f1ec"/>`; });
    s += `<g id="ph"><line y1="0" y2="${H}" stroke="#ff4d2e" stroke-width="2"/><path d="M-5 0h10l-5 7z" fill="#ff4d2e"/></g></svg>`;
    el.innerHTML = s; this.tlx = x; this.time(this.app.state.day);
  }
  time(day) {
    const ph = $('#ph'); if (ph && this.tlx) ph.setAttribute('transform', `translate(${this.tlx(day)},0)`);
    $('#tDate').textContent = this.fmtDay(day);
    const d = Math.round(day), notes = [];
    this.D.tracks.forEach((tr) => { if (tr.days.includes(d)) notes.push(this.t('pass', { t: tr.id })); });
    if (this.D.meta.s2.map(dayOf).includes(d)) notes.push(this.t('optical'));
    if (!notes.length && this.app.state.clouds && d >= 45 && d < 66) notes.push(this.t('cloudNote'));
    if (!notes.length && this.D.rain.mean[d] >= 1) notes.push(this.t('rainDay', { v: this.D.rain.mean[d].toFixed(0) }));
    $('#tNote').textContent = notes.join(' · ') || this.t('tleg');
  }
  playing(on) { $('#playIcon').setAttribute('d', on ? 'M3 2h4v12H3zM9 2h4v12H9z' : 'M3 2l11 6-11 6z'); }
  hoverTip(u, x, y) {
    const el = $('#hover'); if (u < 0) { el.hidden = true; return; }
    const C = this.D.col, lv = C.level[u];
    const col = lv ? LEVEL_COLORS[lv] : '#c3c2b7', sub = [`${C.slope[u].toFixed(0)}°`, this.below(u), C.moving[u] ? this.t('moving') : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<b class="hz" style="color:${col}">${this.dz(u)}</b><div><b style="color:${col}">${this.t('lv' + lv)}</b> · ${esc(this.county(C.county[u], this.D.korea))}<small>${sub}</small></div>`;
    el.hidden = false;                                          // kept off the side panel and the bottom edge
    const w = el.offsetWidth, h = el.offsetHeight, x1 = innerWidth - (innerWidth > 820 ? $('#right').offsetWidth : 0) - 8, y1 = innerHeight - 8;
    el.style.left = (x + 14 + w > x1 ? Math.max(0, x - w - 28) : x) + 'px'; el.style.top = (y + 14 + h > y1 ? Math.max(0, y - h - 28) : y) + 'px';
  }
  caption(step, vars) {
    const el = $('#caption'); if (step === null) { el.hidden = true; return; }
    el.hidden = false; $('.cap-step', el).textContent = this.t('st' + step);
    const tx = $('.cap-text', el); tx.textContent = this.t(`st${step}_t`, vars); tx.style.animation = 'none'; void tx.offsetWidth; tx.style.animation = '';
    $('.cap-src', el).textContent = this.t(`st${step}_s`, vars);
  }
}

export function niceTicks(lo, hi, n) {
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= n + 1) || 50, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push([v, (v > 0 ? '+' : '') + (+v.toFixed(1))]);
  return out;
}

// Small SVG line chart: one y axis, recessive grid, hover crosshair + tooltip.
export function lineChart(host, o) {
  const W = o.w, H = o.h, m = { l: o.yl ? 46 : 34, r: 10, t: 8, b: o.xl ? 36 : 20 };
  const X = (v) => m.l + (v - o.x[0]) / (o.x[1] - o.x[0]) * (W - m.l - m.r), Y = (v) => H - m.b - (v - o.y[0]) / (o.y[1] - o.y[0]) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  if (o.vband) s += `<rect x="${X(o.vband[0])}" y="${m.t}" width="${Math.max(2, X(o.vband[1]) - X(o.vband[0]))}" height="${H - m.t - m.b}" fill="rgba(240,80,60,.22)"/>`;
  o.yt.forEach(([v, l]) => { s += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 3.500}" text-anchor="end">${l}</text>`; });
  o.xt.forEach(([v, l]) => { s += `<text x="${X(v)}" y="${H - m.b + 14}" text-anchor="middle">${l}</text>`; });
  if (o.y[0] < 0) s += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  if (o.vline !== undefined) s += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${H - m.b}" stroke="#898781" stroke-dasharray="2 3"/>`;
  if (o.band) s += `<path d="M${o.band.map((b) => `${X(b[0])} ${Y(Math.min(o.y[1], b[2]))}`).join('L')}L${o.band.slice().reverse().map((b) => `${X(b[0])} ${Y(Math.max(o.y[0], b[1]))}`).join('L')}Z" fill="#898781" opacity=".18"/>`;
  o.series.forEach((sr) => {
    s += `<path d="M${sr.pts.map((p) => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('L')}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''}/>`;
    if (o.markers) sr.pts.forEach((p) => { s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.200" fill="${sr.color}" stroke="#0b0c0d" stroke-width="1.500"/>`; });
  });
  if (o.xl) s += `<text class="lbl" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${o.xl}</text>`;
  if (o.yl) s += `<text class="lbl" transform="translate(11 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${o.yl}</text>`;
  s += `<line id="cx" y1="${m.t}" y2="${H - m.b}" stroke="#c3c2b7" stroke-width="1" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
  host.innerHTML = s;
  const svg = host.firstChild, cx = svg.querySelector('#cx'), tip = document.getElementById('tip');
  const xs = [...new Set(o.series.flatMap((sr) => sr.pts.map((p) => p[0])))].sort((a, b) => a - b);
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect(), vx = o.x[0] + ((e.clientX - r.left) / r.width * W - m.l) / (W - m.l - m.r) * (o.x[1] - o.x[0]);
    const near = xs.reduce((a, b) => (Math.abs(b - vx) < Math.abs(a - vx) ? b : a), xs[0]);
    cx.setAttribute('x1', X(near)); cx.setAttribute('x2', X(near)); cx.setAttribute('visibility', 'visible');
    const rows = o.series.map((sr) => { const p = sr.pts.reduce((a, b) => (Math.abs(b[0] - near) < Math.abs(a[0] - near) ? b : a), sr.pts[0]); return Math.abs(p[0] - near) < (o.x[1] - o.x[0]) * 0.04 ? `<div class="r"><i style="background:${sr.color}"></i>${sr.name}<b style="margin-left:auto;padding-left:10px;color:#f3f1ec">${(o.dec === 0 ? Math.round(p[1]) : (p[1] > 0 && o.unit === ' cm' ? '+' : '') + p[1].toFixed(2))}${o.unit || ''}</b></div>` : ''; }).join('');
    tip.innerHTML = `<div style="color:#77756f;margin-bottom:3px">${o.fmtX ? o.fmtX(near) : near}</div>${rows}`;
    tip.hidden = false; tip.style.left = Math.min(innerWidth - 250, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  };
  svg.onpointerleave = () => { cx.setAttribute('visibility', 'hidden'); tip.hidden = true; };
}
