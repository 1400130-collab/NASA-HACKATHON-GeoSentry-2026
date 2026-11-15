// Home page finish: the things that make the slides feel alive. Nothing here carries a figure; every number still
// comes from site.js / extra.js. Loaded after them, so the slide dots already exist.
import { fetchBin } from './data.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const ease = (k) => 1 - Math.pow(1 - k, 4);

// ---- headlines arrive word by word, each rising out of its own line ---------------------------------------
// A word is wrapped in two spans: the outer one clips, the inner one slides up. Figures filled in later
// ([data-n], [data-x]) are kept whole, because site.js rewrites their text.
function split(el) {
  let i = 0;
  const wrap = (node) => {
    const o = document.createElement('span'); o.className = 'w'; o.style.setProperty('--i', i++);
    const inner = document.createElement('span'); inner.append(node); o.append(inner);
    return o;
  };
  const walk = (parent) => {
    [...parent.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/).filter(Boolean), frag = document.createDocumentFragment();
        // punctuation that follows a figure with no space belongs to that word ("2.5 cm" + ".")
        const prev = n.previousSibling;
        if (parts.length && !/^\s+$/.test(parts[0]) && prev?.nodeType === 1 && prev.classList.contains('w')) prev.firstChild.append(parts.shift());
        parts.forEach((p) => { frag.append(/^\s+$/.test(p) ? document.createTextNode(' ') : wrap(document.createTextNode(p))); });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) {
        if (n.matches('[data-n], [data-x], em, a')) { const at = document.createComment(''); n.replaceWith(at); at.replaceWith(wrap(n)); }
        else walk(n);
      }
    });
  };
  walk(el);
  el.classList.add('split');
}
if (!calm) $$('.band .statement, .band h2.big, .band h2.mid').forEach(split);

// ---- the contour lines behind every slide are the real hills: the same height grid the hero terrain uses ------
// Drawn once into a picture that the page uses as a mask, so the lines take each slide's ink colour by themselves.
async function contours() {
  const dir = 'data/korea/';
  const [info, hb] = await Promise.all([fetch(dir + 'hero.json').then((r) => r.json()), fetchBin(dir + 'hero_height.bin.gz')]);
  const { w: W, h: H } = info, h16 = new Uint16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2);
  // metres, blurred a little so the lines flow instead of jittering
  let a = Float32Array.from(h16, (v) => v / info.height_scale), b = new Float32Array(a.length);
  for (let n = 0; n < 3; n++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += a[yy * W + xx]; c++; } }
      b[y * W + x] = s / c;
    }
    [a, b] = [b, a];
  }
  // the window of ground to show: the highest all-land patch, so the picture is ridges and valleys, not coast
  const cw = 230, ch = 132, step = 8;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y + ch <= H; y += step) for (let x = 0; x + cw <= W; x += step) {
    let s = 0, sea = 0;
    for (let j = 0; j < ch; j += 6) for (let i = 0; i < cw; i += 6) { const v = a[(y + j) * W + x + i]; s += v; if (v <= 1) sea++; }
    if (sea > 4) continue;
    if (s > best) { best = s; bx = x; by = y; }
  }
  if (best < 0) return;
  const CW = 1500, CH = Math.round(CW * ch / cw), f = new Float32Array(CW * CH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const gx = bx + x / (CW - 1) * (cw - 1.001), gy = by + y / (CH - 1) * (ch - 1.001), j = gx | 0, i = gy | 0, u = gx - j, v = gy - i, k = i * W + j;
    f[y * CW + x] = (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + W] * (1 - u) + a[k + W + 1] * u) * v;
  }
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const g = cv.getContext('2d'), img = g.createImageData(CW, CH), px = img.data, GAP = 60;      // a line every 60 m, a heavier one every 300 m
  for (let y = 1; y < CH - 1; y++) for (let x = 1; x < CW - 1; x++) {
    const k = y * CW + x, hx = (f[k + 1] - f[k - 1]) / 2, hy = (f[k + CW] - f[k - CW]) / 2, slope = Math.hypot(hx, hy) + 1e-4;
    const q = f[k] / GAP, near = Math.abs(q - Math.round(q)) * GAP / slope;               // distance to the nearest line, in pixels
    const heavy = Math.round(q) % 5 === 0, half = heavy ? 1.15 : 0.6;
    const al = Math.min(Math.max(half + 0.5 - near, 0), 1) * (heavy ? 1 : 0.62);
    if (al > 0) px[k * 4 + 3] = al * 255;
  }
  g.putImageData(img, 0, 0);
  const url = URL.createObjectURL(await new Promise((r) => cv.toBlob(r)));
  const el = document.createElement('div'); el.className = 'topo'; el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--topo', `url(${url})`);
  document.body.prepend(el);
  requestAnimationFrame(() => el.classList.add('on'));
  if (calm) return;
  let ticking = false;                                              // drifts a little as the page moves: it sits far behind the words
  const move = () => { ticking = false; const m = Math.max(document.documentElement.scrollHeight - innerHeight, 1); el.style.transform = `translate3d(0, ${(-scrollY / m * 14).toFixed(2)}vh, 0)`; };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  move();
}
(window.requestIdleCallback || ((f) => setTimeout(f, 600)))(() => contours().catch((e) => console.warn('contour backdrop unavailable', e)));

// ---- slide dots: each one names its slide when you point at it -----------------------------------------
const slides = $$('section[data-slide]');
$$('.dots button').forEach((b, i) => {
  const s = slides[i]; if (!s) return;
  const name = (l) => (s.id === 'hero' ? (l === 'ko' ? '시작' : 'Start') : s.id === 'open-map' ? (l === 'ko' ? '지도' : 'Map')
    : (s.querySelector(`.eyebrow span[lang="${l}"]`) || s.querySelector('.eyebrow span'))?.textContent.trim() || '');
  b.dataset.en = name('en'); b.dataset.ko = name('ko');
});

// ---- cards: a soft light follows the pointer ---------------------------------------------------------
if (fine) $$('.model, .two > div:not(.and)').forEach((c) => {
  c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`); });
});

// ---- buttons lean towards the pointer ------------------------------------------------------------------
if (fine && !calm) $$('.hero .btn, .closer .arr').forEach((b) => {
  const host = b.closest('a') || b, k = b.matches('.arr') ? 0.1 : 0.22;
  host.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.translate = `${((e.clientX - r.left - r.width / 2) * k).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * k).toFixed(1)}px`; });
  host.addEventListener('pointerleave', () => { b.style.translate = ''; });
});

// ---- figures written by extra.js run up from zero the first time they are seen ----------------------------
function runUp(el) {
  const end = el.textContent.trim(), target = parseFloat(end.replace(/,/g, '')), dec = (end.split('.')[1] || '').length;
  if (!Number.isFinite(target) || !/^[\d.,]+$/.test(end)) return;
  const t0 = performance.now(), dur = 1400;
  const tick = (now) => {
    const k = Math.min(Math.max((now - t0) / dur, 0), 1);
    el.textContent = k === 1 ? end : (target * ease(k)).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
if (!calm) {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const go = (n = 0) => { const nums = $$('[data-x]', e.target); if (nums.some((x) => x.textContent.includes('…')) && n < 60) setTimeout(() => go(n + 1), 50); else nums.forEach(runUp); };
    go();
  }), { threshold: 0.4 });
  $$('.xbig > div > b').forEach((b) => io.observe(b));
}

// ---- before / after: the handle sweeps once by itself, so it is plain that it drags -----------------------
const ba = document.getElementById('ba');
if (ba && !calm) {
  const input = ba.querySelector('input');
  let touched = false;
  ['pointerdown', 'keydown'].forEach((ev) => input.addEventListener(ev, () => { touched = true; }));
  new IntersectionObserver(([e], o) => {
    if (!e.isIntersecting) return;
    o.disconnect();
    const t0 = performance.now() + 700, dur = 2200;
    const f = (now) => {
      if (touched) return;
      const k = Math.min(Math.max((now - t0) / dur, 0), 1), x = 50 + Math.sin(k * Math.PI * 2) * 26 * (1 - k * 0.25);
      input.value = x; ba.style.setProperty('--x', `${x.toFixed(2)}%`);
      if (k < 1) requestAnimationFrame(f); else { input.value = 50; ba.style.setProperty('--x', '50%'); }
    };
    requestAnimationFrame(f);
  }, { threshold: 0.6 }).observe(ba);
}

// runs `start` while the element is on screen and `stop` when it leaves
const whileSeen = (el, start, stop) => new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0.25 }).observe(el);

// ---- slide 09: an inspection sheet with one row per slope on the median county's list; the rows tick off ----
// The rows are placeholders (no real slope is named). The reasons on them are the ones the rule can give.
const paper = document.getElementById('paper');
if (paper) fetch('data/korea/stats.json').then((r) => r.json()).then((S) => {
  const n = Math.min(Math.max(Math.round(S.workload.per_county_median), 1), 9), list = paper.querySelector('ol'), cnt = paper.querySelector('.cnt b');
  const why = [[['top 5%', '상위 5%'], ['house below', '아래 집']], [['top 5%', '상위 5%'], ['road below', '아래 도로']], [['radar: moving', '레이더: 이동'], ['house below', '아래 집']]];
  const tag = ([en, ko]) => `<em><span lang="en">${en}</span><span lang="ko">${ko}</span></em>`;
  list.innerHTML = Array.from({ length: n }, (_, i) => `<li><i>${String(i + 1).padStart(2, '0')}</i><span class="nm" style="--w:${[72, 54, 88, 63, 46, 80, 58, 70, 50][i]}%"></span>${why[i % 3].map(tag).join('')}<u><svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5"/></svg></u></li>`).join('');
  const rows = [...list.children];
  if (calm) { rows.forEach((r) => r.classList.add('done')); cnt.textContent = n; return; }
  let k = 0, timer = 0;
  const step = () => {
    if (k < n) { rows[k++].classList.add('done'); cnt.textContent = k; timer = setTimeout(step, k === n ? 2600 : 560); }
    else { rows.forEach((r) => r.classList.remove('done')); k = 0; cnt.textContent = 0; timer = setTimeout(step, 900); }
  };
  whileSeen(paper, () => { clearTimeout(timer); timer = setTimeout(step, 900); }, () => clearTimeout(timer));
}).catch(() => {});

// ---- slide 10: the satellite goes round once per 12-day repeat; each pass sets the five steps off in turn ----
const orbit = document.getElementById('orbit'), xloop = document.getElementById('xloop');
if (orbit && xloop) {
  const NS = 'http://www.w3.org/2000/svg', mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };
  const ticks = orbit.querySelector('.ticks'), sat = orbit.querySelector('.sat'), num = orbit.querySelector('.num'), ping = orbit.querySelector('.ping'), steps = [...xloop.children];
  for (let d = 0; d < 12; d++) { const a = d / 12 * 6.2832 - 1.5708; ticks.append(mk('line', { x1: 200 + Math.cos(a) * 160, y1: 200 + Math.sin(a) * 160, x2: 200 + Math.cos(a) * 168, y2: 200 + Math.sin(a) * 168 })); }
  for (let i = 9; i >= 0; i--) { const a = -i * 0.07 - 1.5708; sat.append(mk('circle', { cx: 200 + Math.cos(a) * 150, cy: 200 + Math.sin(a) * 150, r: i ? 6.5 - i * 0.55 : 9, opacity: i ? (0.5 - i * 0.05).toFixed(2) : 1 })); }
  const marks = [...ticks.children];
  const show = (p, since) => {                                  // p: how far round (0..1); since: ms since the last pass
    sat.setAttribute('transform', `rotate(${(p * 360).toFixed(2)} 200 200)`);
    const day = Math.floor(p * 12);
    if (num.textContent !== String(day + 1)) { num.textContent = day + 1; marks.forEach((m, i) => m.classList.toggle('past', i <= day)); }
    const k = Math.min(Math.floor(since / 700), steps.length - 1);
    steps.forEach((s, i) => { s.classList.toggle('on', i <= k); s.classList.toggle('cur', i === k); });
  };
  if (calm) { xloop.classList.add('all'); steps.forEach((s) => s.classList.add('on')); show(0, 1e9); steps.forEach((s) => s.classList.remove('cur')); }
  else {
    const T = 9000;
    let raf = 0, t0 = 0, lap = -1;
    const frame = (now) => {
      const t = now - t0, n = Math.floor(t / T);
      if (n !== lap) { lap = n; ping.animate([{ transform: 'scale(1)', opacity: 0.8 }, { transform: 'scale(5)', opacity: 0 }], { duration: 1300, easing: 'cubic-bezier(.2,.7,.2,1)' }); }
      show((t % T) / T, t % T);
      raf = requestAnimationFrame(frame);
    };
    show(0, 0);
    whileSeen(orbit, () => { if (raf) return; t0 = performance.now() - 0; lap = -1; raf = requestAnimationFrame(frame); }, () => { cancelAnimationFrame(raf); raf = 0; });
  }
}
