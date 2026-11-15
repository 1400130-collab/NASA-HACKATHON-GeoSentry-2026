// Site menu: the ☰ button in the header slides a sidebar in from the left. Big page titles; the sections fold open under
// each page, and the slide you are looking at is marked. Self-contained (own styles, both languages), used on every page.

// [anchor, number, English, Korean]
const MENU = [
  { page: 'index.html', en: 'Home', ko: '홈', items: [
    ['hero', '00', 'Check these slopes first', '먼저 점검할 사면'],
    ['gap', '01', 'The gap', '빈틈'],
    ['measurement', '02', 'The measurement', '측정'],
    ['where-it-learned', '03', 'Where it learned', '어디서 배웠나'],
    ['machine-learning', '04', 'The machine learning', '머신러닝'],
    ['inversion', '05', 'InSAR inversion', 'InSAR 역산'],
    ['rule', '06', 'The rule', '규칙'],
    ['short-list', '07', 'The short list', '짧은 목록'],
    ['does-it-work', '08', 'Does it work', '효과가 있나'],
    ['second-witness', '09', 'A second witness', '두 번째 증인'],
    ['officer', '10', 'What it asks of an officer', '담당자가 할 일'],
    ['keeps-running', '11', 'How it keeps running', '계속 돌아가는 방식']] },
  { page: 'map.html', en: 'Map', ko: '지도', items: [
    [null, '3D', 'All of South Korea', '대한민국 전체'],
    ['?area=region', '20 m', 'North Gyeongsang with NISAR', '경상북도 · NISAR']] },
  { page: 'drone.html', en: 'Drone flight', ko: '드론 비행', items: [] },
  { page: 'method.html', en: 'How it works', ko: '작동 방식', items: [
    ['measuring', '01', 'Split the hills', '사면 나누기'],
    ['radar', '02', 'Measure with radar', '레이더 측정'],
    ['models', '03', 'Decide what moved', '이동 판정'],
    ['ranking', '04', 'Rank every slope', '순위 매기기'],
    ['the-list', '05', 'Follow the debris', '토석류 추적'],
    ['levels', '06', 'Give a level', '등급 정하기']] },
  { page: 'results.html', en: 'Results', ko: '검증', items: [
    ['hindsight', '01', 'Hindsight test', '사후 검증'],
    ['detection', '02', 'Detection test', '탐지 시험'],
    ['did-not-work', '03', 'What did not work', '안 된 것'],
    ['checks', '04', 'Checks', '점검 항목'],
    ['by-province', '05', 'By province', '시·도별'],
    ['limits', '06', 'Limits', '한계'],
    ['uncertainty', '07', 'Uncertainty', '불확실성'],
    ['radar-check', '08', 'Radar check', '레이더 점검']] },
  { page: 'history.html', en: 'History', ko: '피해 기록', items: [
    ['impact', '01', 'Impact index', '피해 지수'],
    ['lives', '02', 'Lives', '인명 피해'],
    ['scoring', '03', 'Scoring', '산정 방식'],
    ['record-limits', '04', 'Limits', '한계']] },
  { page: 'about.html', en: 'About', ko: '소개', items: [
    ['mission', '01', 'Mission', '목표'],
    ['in-numbers', '02', 'In numbers', '숫자로 보기'],
    ['why-here', '03', 'Why here', '왜 이곳인가'],
    ['who-we-asked', '04', 'Who we asked', '자문'],
    ['principles', '05', 'Principles', '원칙'],
    ['team', '06', 'Team', '팀'],
    ['data', '07', 'Data', '자료'],
    ['tools', '08', 'How it was built', '만든 방법'],
    ['limits', '09', 'Limits', '한계'],
    ['roadmap', '10', 'Roadmap', '로드맵'],
    ['thanks', '11', 'Thanks', '감사']] },
];
const TOOLS = [['sheet.html', 'Inspection sheets', '점검표'], ['review.html', 'Label review', '라벨 검토']];

const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
const href = (page, a) => (a == null ? page : a.startsWith('?') ? page + a : `${page}#${a}`);
const bi = (en, ko) => `<span lang="en">${en}</span><span lang="ko">${ko}</span>`;
const pad = (i) => String(i + 1).padStart(2, '0');

const css = `
.snav-btn { flex: none; width: 40px; height: 40px; display: inline-grid; place-items: center; margin: 0 4px 0 -8px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--ink, #f1efe9); cursor: pointer; pointer-events: auto; transition: background .2s; }
.snav-btn:hover { background: rgba(255, 255, 255, .1); }
.snav-btn:focus-visible { outline: 2px solid var(--red, #ff4d2e); outline-offset: 2px; }
.snav-btn i { display: grid; gap: 5px; width: 20px; }
.snav-btn i b { display: block; height: 2px; border-radius: 2px; background: currentColor; transition: width .3s cubic-bezier(.2, .7, .2, 1); }
.snav-btn i b:nth-child(2) { width: 13px; }
.snav-btn:hover i b:nth-child(2) { width: 20px; }

.snav-scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(4, 5, 6, .62); opacity: 0; visibility: hidden; transition: opacity .35s, visibility 0s linear .35s; }
.snav-open .snav-scrim { opacity: 1; visibility: visible; transition: opacity .45s; }

.snav { --ink: #f3f1ec; --ink2: #b4b1a9; --mute: #6f6d68; --red: #ff4d2e; --ease: cubic-bezier(.16, 1, .3, 1); --px: 26px;
  position: fixed; inset: 0 auto 0 0; z-index: 1001; width: min(430px, calc(100vw - 44px)); display: flex; flex-direction: column; align-items: stretch; gap: 0; margin: 0; padding: 0;
  color: var(--ink); text-align: left; font: 400 15px/1.4 var(--sans, Roboto, "Pretendard Variable", Pretendard, system-ui, sans-serif); letter-spacing: 0; text-transform: none;
  background: #0d0f10; border-right: 1px solid rgba(255, 255, 255, .08); box-shadow: 40px 0 90px rgba(0, 0, 0, .55);
  transform: translateX(-102%); visibility: hidden; transition: transform .38s cubic-bezier(.5, 0, .75, 0), visibility 0s linear .38s; -webkit-font-smoothing: antialiased; overflow: hidden; }
.snav-open .snav { transform: none; visibility: visible; transition: transform .6s var(--ease); }
html[lang="en"] .snav [lang="ko"], html[lang="ko"] .snav [lang="en"], html:not([lang="ko"]) .snav [lang="ko"] { display: none !important; }
.snav a { color: inherit; text-decoration: none; }
.snav :focus-visible { outline: 2px solid var(--red); outline-offset: 2px; border-radius: 6px; }

.snav-head { position: relative; display: flex; align-items: center; gap: 8px; height: var(--hh, 64px); padding: 0 14px 0 var(--px); flex: none; }
.snav-head .geosentry-lockup { font-weight: 700; font-size: 16px; margin-right: auto; }
.snav-head .geosentry-logo { width: 46px; height: 32px; }
.snav-lang { height: 34px; padding: 0 12px; border: 1px solid rgba(255, 255, 255, .16); border-radius: 999px; background: none; color: var(--mute); font: 500 11.5px/1 var(--mono, "Roboto Mono", monospace); letter-spacing: .08em; cursor: pointer; transition: border-color .2s; }
.snav-lang b { color: var(--ink); font-weight: 600; }
.snav-lang:hover { border-color: rgba(255, 255, 255, .4); }
.snav-close { width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255, 255, 255, .16); border-radius: 50%; background: none; color: inherit; cursor: pointer; transition: transform .45s var(--ease), border-color .2s, background .2s; }
.snav-close:hover { transform: rotate(90deg); border-color: var(--red); background: rgba(255, 77, 46, .12); }
.snav-close svg { width: 15px; height: 15px; }

.snav-body { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .15) transparent; padding: 6px 0 18px; }
.snav-row { position: relative; }
.snav-row > div:first-child::before { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0; background: var(--red); transform: scaleY(0); transition: transform .5s var(--ease); }
.snav-row.cur > div:first-child::before { transform: none; transition-delay: .35s; }
.snav-row > div:first-child { position: relative; display: flex; align-items: center; padding-right: 10px; }
.snav .snav-page { flex: 1; min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; padding: 11px 0 11px var(--px); color: rgba(243, 241, 236, .5); transition: color .25s; }
.snav-page .n { font: 500 11px/1 var(--mono, monospace); letter-spacing: .06em; color: var(--mute); transition: color .25s; }
.snav-page .t { font-weight: 800; font-size: 25px; line-height: 1.1; letter-spacing: -.03em; white-space: nowrap; transition: transform .45s var(--ease); }
.snav-page .here { padding: 4px 8px; border-radius: 999px; background: var(--red); color: #0b0c0d; font: 600 9.5px/1 var(--mono, monospace); letter-spacing: .08em; text-transform: uppercase; }
.snav .snav-row.cur .snav-page, .snav .snav-page:hover, .snav .snav-page:focus-visible { color: var(--ink); }
.snav .snav-page:focus-visible { outline: none; }
.snav-row.cur .snav-page .n, .snav-page:hover .n { color: var(--red); }
.snav-page:hover .t, .snav-page:focus-visible .t { transform: translateX(6px); }
.snav-fold { display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--mute); cursor: pointer; transition: background .2s, color .2s; }
.snav-fold:hover { background: rgba(255, 255, 255, .07); color: var(--ink); }
.snav-fold svg { width: 18px; height: 18px; transition: transform .45s var(--ease); }
.snav-row.open .snav-fold { color: var(--ink); }
.snav-row.open .snav-fold svg { transform: rotate(180deg); }

.snav-row > .snav-secs { display: grid; overflow: hidden; grid-template-rows: 0fr; transition: grid-template-rows .5s var(--ease); }
.snav-row.open > .snav-secs { grid-template-rows: 1fr; }
.snav-row > .snav-secs > div { min-height: 0; overflow: hidden; }
.snav-secs { list-style: none; margin: 0; padding: 0; }
ul.snav-secs { position: relative; margin: 0 0 12px; padding: 2px 10px 0 calc(var(--px) + 14px); }
ul.snav-secs::before { content: ""; position: absolute; left: calc(var(--px) + 5px); top: 8px; bottom: 8px; width: 1px; background: rgba(255, 255, 255, .1); }
.snav-secs li { opacity: 0; transform: translateX(-8px); transition: opacity .2s, transform .2s; }
.snav-row.open .snav-secs li { opacity: 1; transform: none; transition: opacity .4s var(--ease), transform .5s var(--ease); transition-delay: calc(var(--k) * 28ms + 80ms); }
.snav-secs a { position: relative; display: grid; grid-template-columns: 2.5em minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 6px 10px; border-radius: 8px; color: var(--ink2); font-size: 14.5px; font-weight: 500; transition: background .15s, color .15s; }
.snav-secs a:hover, .snav-secs a:focus-visible { background: rgba(255, 255, 255, .06); color: #fff; }
.snav-secs .n { font: 500 11px/1 var(--mono, monospace); letter-spacing: .04em; color: var(--mute); }
.snav-secs .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snav-secs .now { padding: 3px 7px; border-radius: 999px; background: var(--red); color: #0b0c0d; font: 600 9px/1 var(--mono, monospace); letter-spacing: .08em; text-transform: uppercase; }
.snav-secs a.is-now { color: #fff; background: rgba(255, 255, 255, .06); }
.snav-secs a.is-now .n { color: var(--red); }
@keyframes snav-blink { 50% { opacity: .2; } }

.snav-foot { position: relative; flex: none; padding: 12px var(--px) 14px; border-top: 1px solid rgba(255, 255, 255, .07); background: #0d0f10; }
.snav-go { display: flex; align-items: center; justify-content: space-between; height: 46px; padding: 0 18px 0 20px; border-radius: 12px; background: #fff; color: #0b0c0d !important; font-weight: 800; font-size: 16px; letter-spacing: -.01em; white-space: nowrap; transition: background .2s, transform .2s; }
.snav-go:hover { background: var(--red); transform: translateY(-1px); }
.snav-go svg { width: 18px; height: 18px; transition: transform .35s var(--ease); }
.snav-go:hover svg { transform: translateX(4px); }
.snav-tools { display: flex; gap: 8px; margin-top: 10px; }
.snav-tools a { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 10px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 10px; color: var(--ink2); font-size: 13px; font-weight: 500; white-space: nowrap; transition: border-color .2s, color .2s, background .2s; }
.snav-tools a:hover { border-color: rgba(255, 255, 255, .4); color: var(--ink); background: rgba(255, 255, 255, .04); }
.snav-tools a.cur { border-color: var(--red); color: var(--ink); }
.snav-tools svg { width: 12px; height: 12px; opacity: .7; }
.snav-sig { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; font: 500 10px/1 var(--mono, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--mute); }
.snav-sig .dot { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: 50%; background: var(--red); animation: snav-blink 2s ease-in-out infinite; vertical-align: 1px; }
.snav-sig kbd { padding: 2px 5px; border: 1px solid rgba(255, 255, 255, .16); border-radius: 4px; font: inherit; color: var(--ink2); }

/* entrance: rows slide in one after another behind the panel */
.snav-head > *, .snav-row, .snav-foot > * { opacity: 0; transform: translateX(-22px); transition: opacity .15s, transform .15s; }
.snav-open .snav-head > *, .snav-open .snav-row, .snav-open .snav-foot > * { opacity: 1; transform: none; transition: opacity .5s var(--ease) calc(.12s + var(--d, 0) * 40ms), transform .7s var(--ease) calc(.12s + var(--d, 0) * 40ms); }

html.snav-lock, html.snav-lock body { overflow: hidden; }
section[id] { scroll-margin-top: 68px; }
@media (max-width: 480px) { .snav { --px: 20px; } .snav-page .t { font-size: 25px; } .snav-sig .k { display: none; } }
@media (max-width: 640px) { .masthead nav a:not(.go) { display: none; } }
@media print { .snav-btn, .snav, .snav-scrim { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .snav, .snav *, .snav-scrim, .snav-btn i b { transition-duration: .01s !important; transition-delay: 0s !important; animation: none !important; } }`;

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const secs = (g) => `<ul class="snav-secs" data-page="${g.page}">${g.items.map(([a, n, en, ko], k) =>
  `<li style="--k:${k}"><a href="${href(g.page, a)}" data-a="${a ?? ''}"><span class="n">${n}</span><span class="t">${bi(en, ko)}</span></a></li>`).join('')}</ul>`;

function build() {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'snav-btn'; btn.type = 'button';
  btn.setAttribute('aria-label', 'Open menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'snav');
  btn.innerHTML = '<i aria-hidden="true"><b></b><b></b><b></b></i>';

  const curIdx = MENU.findIndex((g) => g.page === here);
  const scrim = document.createElement('div'); scrim.className = 'snav-scrim';
  const nav = document.createElement('nav');
  nav.className = 'snav'; nav.id = 'snav'; nav.setAttribute('aria-label', 'Site menu'); nav.setAttribute('aria-hidden', 'true');
  nav.innerHTML = `
    <div class="snav-head">
      <a class="geosentry-lockup" href="index.html" style="--d:0"><img class="geosentry-logo" src="img/geosentry-logo.svg?v=2" width="56" height="38" alt=""><span>GeoSentry</span></a>
      <button class="snav-lang" type="button" style="--d:1" hidden></button>
      <button class="snav-close" type="button" aria-label="Close menu" style="--d:2">${X}</button>
    </div>
    <div class="snav-body">
      ${MENU.map((g, i) => `<div class="snav-row${i === curIdx ? ' cur open' : ''}" style="--d:${i + 2}">
        <div><a class="snav-page" href="${g.page}"><span class="n">${pad(i)}</span><span class="t">${bi(g.en, g.ko)}</span>${i === curIdx ? `<span class="here">${bi('Here', '현재')}</span>` : '<span></span>'}</a>
        ${g.items.length ? `<button class="snav-fold" type="button" aria-label="Sections" aria-expanded="${i === curIdx}">${CHEV}</button>` : ''}</div>
        ${g.items.length ? `<div class="snav-secs"><div>${secs(g)}</div></div>` : ''}
      </div>`).join('')}
    </div>
    <div class="snav-foot">
      ${here === 'map.html' ? '' : `<a class="snav-go" href="map.html" style="--d:${MENU.length + 2}">${bi('Open the map', '지도 열기')}${ARROW}</a>`}
      <div class="snav-tools" style="--d:${MENU.length + 3}">${TOOLS.map(([p, en, ko]) => `<a href="${p}"${p === here ? ' class="cur"' : ''}>${bi(en, ko)}${ARROW}</a>`).join('')}</div>
      <div class="snav-sig" style="--d:${MENU.length + 4}"><span><i class="dot"></i>NASA Space Apps 2026 · Seoul</span><span class="k"><kbd>Esc</kbd> ${bi('close', '닫기')}</span></div>
    </div>`;

  // header placement: inside the site masthead, or the map's top bar; otherwise a fixed button at the top left
  const host = document.querySelector('.masthead .wrap') || document.querySelector('#top'), bar = host ? null : document.querySelector('body > .bar');
  if (host) host.prepend(btn);
  else if (bar) { btn.style.cssText = 'color:#fff;margin:0 2px 0 -6px'; bar.prepend(btn); }      // the printable sheets: in their dark top bar
  else { btn.style.cssText = 'position:fixed;top:12px;left:16px;z-index:999;background:rgba(17,19,20,.85);margin:0'; document.body.appendChild(btn); }
  document.body.append(scrim, nav);

  const root = document.documentElement, $ = (s) => nav.querySelector(s);

  // the slide or section on screen right now, so the menu can say "now"
  const nowAnchor = () => {
    if (here === 'map.html') return new URLSearchParams(location.search).get('area') === 'region' ? '?area=region' : '';
    let best = null;
    for (const [a] of MENU[curIdx]?.items || []) {
      const el = a && document.getElementById(a); if (!el) continue;
      if (el.getBoundingClientRect().top <= innerHeight * .45) best = a;
    }
    return best;
  };
  const markNow = () => {
    nav.querySelectorAll('.snav-secs a').forEach((a) => { a.classList.remove('is-now'); a.querySelector('.now')?.remove(); });
    const now = curIdx < 0 ? null : nowAnchor(); if (now == null) return;
    nav.querySelectorAll(`.snav-secs[data-page="${here}"] a[data-a="${CSS.escape(now)}"]`).forEach((a) => {
      a.classList.add('is-now'); a.insertAdjacentHTML('beforeend', `<span class="now">${bi('Now', '지금')}</span>`);
    });
  };

  nav.querySelectorAll('.snav-fold').forEach((f) => f.addEventListener('click', () => {
    const open = f.closest('.snav-row').classList.toggle('open'); f.setAttribute('aria-expanded', open);
  }));

  // language: drive the page's own switch, so everything on the page follows
  const langBtn = $('.snav-lang'), pageLang = () => document.querySelector('.masthead .langbtn, #btnLang, body > .bar #lang');
  const paintLang = () => { const ko = root.lang === 'ko'; langBtn.innerHTML = ko ? 'EN / <b>KO</b>' : '<b>EN</b> / KO'; };
  if (pageLang()) { langBtn.hidden = false; paintLang(); langBtn.addEventListener('click', () => { pageLang()?.click(); setTimeout(paintLang, 30); }); }

  const isOpen = () => root.classList.contains('snav-open');
  const open = () => {
    // the sidebar's top bar is as tall as the page's own header, so the logo lands on the same line
    if (btn.parentElement !== document.body) nav.style.setProperty('--hh', `${Math.max(56, btn.parentElement.getBoundingClientRect().height)}px`);
    markNow(); if (pageLang()) paintLang();
    nav.setAttribute('aria-hidden', 'false');
    root.classList.add('snav-open', 'snav-lock'); btn.setAttribute('aria-expanded', 'true');
    const now = nav.querySelector('.snav-secs a.is-now');
    if (now) setTimeout(() => now.scrollIntoView({ block: 'nearest' }), 0);
    setTimeout(() => (nav.querySelector('.snav-row.cur .snav-page') || $('.snav-page')).focus({ preventScroll: true }), 120);
  };
  const close = (focusBtn = true) => {
    root.classList.remove('snav-open', 'snav-lock'); btn.setAttribute('aria-expanded', 'false'); nav.setAttribute('aria-hidden', 'true');
    if (focusBtn) btn.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  scrim.addEventListener('click', () => close());
  $('.snav-close').addEventListener('click', () => close());
  // while open, the wheel and keys belong to the menu: never the page, the slide deck or the map behind it
  scrim.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  nav.addEventListener('wheel', (e) => { e.stopPropagation(); if (!e.target.closest('.snav-body')) e.preventDefault(); }, { passive: false });
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {      // keep focus inside the menu
      const f = [...nav.querySelectorAll('a, button:not([hidden])')].filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {      // arrows walk the page list
      const pages = [...nav.querySelectorAll('.snav-page')], i = pages.indexOf(document.activeElement);
      if (i >= 0) { e.preventDefault(); pages[(i + (e.key === 'ArrowDown' ? 1 : pages.length - 1)) % pages.length].focus(); }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const url = new URL(a.href, location.href);
    // same page: close and glide to the section instead of a jump
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      const el = document.getElementById(url.hash.slice(1));
      if (el) { e.preventDefault(); close(false); history.replaceState(null, '', url.hash); if (!window.__goto?.(el)) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } else close(false);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
