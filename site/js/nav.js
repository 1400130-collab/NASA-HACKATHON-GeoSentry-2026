// Site menu: a ☰ button at the left of the header opens a drawer that slides in from the left
// with a link to every page and every section on the site. Self-contained (own styles), used on every page.
const MENU = [
  { page: 'index.html', title: 'Home', items: [
    ['hero', 'Check these slopes first'], ['gap', '01 · The gap'], ['measurement', '02 · The measurement'],
    ['where-it-learned', '03 · Where it learned'], ['machine-learning', '04 · The machine learning'], ['rule', '05 · The rule'],
    ['short-list', '06 · The short list'], ['does-it-work', '07 · Does it work'], ['second-witness', '08 · A second witness'],
    ['officer', '09 · What it asks of an officer'], ['keeps-running', '10 · How it keeps running']] },
  { page: 'map.html', title: 'Map', items: [
    [null, 'All of South Korea'], ['?area=region', 'North Gyeongsang, 20 m with NISAR']] },
  { page: 'method.html', title: 'How it works', items: [
    ['measuring', '01–02 · Measuring'], ['models', '03–04 · Two models'], ['the-list', '05–06 · The list']] },
  { page: 'results.html', title: 'Results', items: [
    ['hindsight', '01 · Hindsight test'], ['detection', '02 · Detection test'], ['did-not-work', '03 · What did not work'],
    ['checks', '04 · Checks'], ['by-province', '05 · By province'], ['limits', '06 · Limits'],
    ['uncertainty', '07 · Uncertainty'], ['radar-check', '08 · Radar check']] },
  { page: 'history.html', title: 'History', items: [
    ['impact', '01 · Impact index'], ['lives', '02 · Lives'], ['scoring', '03 · Scoring']] },
  { page: 'about.html', title: 'About', items: [
    ['mission', '01 · Mission'], ['in-numbers', '02 · In numbers'], ['why-here', '03 · Why here'], ['who-we-asked', '04 · Who we asked'],
    ['principles', '05 · Principles'], ['team', '06 · Team'], ['data', '07 · Data sources'], ['tools', '08 · How it was built'],
    ['limits', '09 · Limits'], ['roadmap', '10 · Roadmap'], ['thanks', '11 · Thanks']] },
  { page: 'sheet.html', title: 'Inspection sheet', items: [] },
  { page: 'review.html', title: 'Label review tool', items: [] },
];

const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
const href = (page, a) => (a == null ? page : a.startsWith('?') ? page + a : `${page}#${a}`);

const css = `
.snav-btn { flex: none; width: 40px; height: 40px; display: inline-grid; place-items: center; margin: 0 4px 0 -8px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--ink, #f1efe9); cursor: pointer; pointer-events: auto; }
.snav-btn:hover { background: rgba(255, 255, 255, .08); }
.snav-btn:focus-visible { outline: 2px solid var(--red, #ff4d2e); outline-offset: 2px; }
.snav-btn svg { width: 22px; height: 22px; }
.snav-scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, .55); opacity: 0; visibility: hidden; transition: opacity .3s, visibility 0s linear .3s; }
.snav-drawer { position: fixed; inset: 0 auto 0 0; z-index: 1001; width: min(360px, 86vw); display: flex; flex-direction: column; background: #111314; color: #f1efe9; border-right: 1px solid rgba(255, 255, 255, .1); box-shadow: 24px 0 60px rgba(0, 0, 0, .45); transform: translateX(-100%); visibility: hidden; transition: transform .35s cubic-bezier(.2, .7, .1, 1), visibility 0s linear .35s; font-family: var(--sans, Roboto, system-ui, sans-serif); }
.snav-open .snav-scrim { opacity: 1; visibility: visible; transition: opacity .3s; }
.snav-open .snav-drawer { transform: none; visibility: visible; transition: transform .35s cubic-bezier(.2, .7, .1, 1); }
.snav-head { display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0 12px 0 22px; border-bottom: 1px solid rgba(255, 255, 255, .1); flex: none; }
.snav-head b { font-size: 15px; letter-spacing: .02em; }
.snav-close { width: 40px; height: 40px; border: 0; border-radius: 8px; background: none; color: inherit; font-size: 26px; line-height: 1; cursor: pointer; }
.snav-close:hover { background: rgba(255, 255, 255, .08); }
.snav-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 10px 0 28px; }
.snav-group { padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, .06); }
.snav-group > a { display: flex; align-items: center; justify-content: space-between; padding: 10px 22px; font-size: 16px; font-weight: 600; color: #f1efe9; text-decoration: none; }
.snav-group.here > a { color: var(--red, #ff4d2e); }
.snav-group.here > a::after { content: "you are here"; font: 500 10.5px/1 var(--mono, "Roboto Mono", monospace); letter-spacing: .06em; text-transform: uppercase; color: #77756f; }
.snav-group ul { list-style: none; margin: 0 0 6px; padding: 0; }
.snav-group li a { display: block; padding: 7px 22px 7px 36px; font-size: 14px; color: #b4b1a9; text-decoration: none; }
.snav-group a:hover, .snav-group a:focus-visible { background: rgba(255, 255, 255, .06); color: #fff; outline: none; }
html.snav-lock, html.snav-lock body { overflow: hidden; }
section[id] { scroll-margin-top: 68px; }
@media (max-width: 640px) { .masthead nav a:not(.go) { display: none; } }
@media print { .snav-btn, .snav-scrim, .snav-drawer { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .snav-drawer, .snav-scrim { transition: none !important; } }`;

function build() {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'snav-btn'; btn.type = 'button';
  btn.setAttribute('aria-label', 'Open menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'snav');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

  const scrim = document.createElement('div'); scrim.className = 'snav-scrim';
  const drawer = document.createElement('nav');
  drawer.className = 'snav-drawer'; drawer.id = 'snav'; drawer.setAttribute('aria-label', 'Site menu');
  drawer.innerHTML = `<div class="snav-head"><b>GeoSentry</b><button class="snav-close" type="button" aria-label="Close menu">×</button></div>
    <div class="snav-body">${MENU.map((g) => `<div class="snav-group${g.page === here ? ' here' : ''}">
      <a href="${g.page}">${g.title}</a>${g.items.length ? `<ul>${g.items.map(([a, t]) => `<li><a href="${href(g.page, a)}">${t}</a></li>`).join('')}</ul>` : ''}
    </div>`).join('')}</div>`;

  // header placement: inside the site masthead, or the map's top bar; otherwise a fixed button at the top left
  const host = document.querySelector('.masthead .wrap') || document.querySelector('#top'), bar = host ? null : document.querySelector('body > .bar');
  if (host) host.prepend(btn);
  else if (bar) { btn.style.cssText = 'color:#fff;margin:0 2px 0 -6px'; bar.prepend(btn); }      // the printable sheets: in their dark top bar
  else { btn.style.cssText = 'position:fixed;top:12px;left:16px;z-index:999;background:rgba(17,19,20,.85);margin:0'; document.body.appendChild(btn); }
  document.body.append(scrim, drawer);

  const root = document.documentElement;
  const open = () => {
    root.classList.add('snav-open', 'snav-lock'); btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => drawer.querySelector('.snav-group.here a, .snav-body a')?.focus(), 50);
  };
  const close = (focusBtn = true) => {
    root.classList.remove('snav-open', 'snav-lock'); btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  btn.addEventListener('click', () => (root.classList.contains('snav-open') ? close() : open()));
  scrim.addEventListener('click', () => close());
  // while open, the wheel only ever scrolls the menu: never the page or the map behind it
  scrim.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  drawer.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  drawer.querySelector('.snav-close').addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('snav-open')) close(); });
  drawer.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const url = new URL(a.href, location.href);
    // same page: close and scroll smoothly instead of a jump
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      const el = document.getElementById(url.hash.slice(1));
      if (el) { e.preventDefault(); close(false); history.replaceState(null, '', url.hash); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } else close(false);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
