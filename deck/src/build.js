// SLOPEWATCH submission deck: 7 slides (the Seoul rules cap the demo deck at 7, title included).
// Every number comes from site/data/korea/meta.json or site/data/meta.json (runs of 13-14 Nov 2026).
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const Lu = require('react-icons/lu');
const path = require('path');
const { applyTheme } = require(process.env.SKILL + '/scripts/apply_theme.js');

const IMG = path.join(__dirname, 'img');
const OUT = process.argv[2] || path.join(__dirname, 'SLOPEWATCH.pptx');
const TEAM = process.env.TEAM || 'Team GeoSentry';
const REPO = 'github.com/1400130-collab/NASA-HACKATHON-GeoSentry-2026';

const THEME = {
  name: 'SLOPEWATCH',
  headFontFace: 'Arial Black',
  bodyFontFace: 'Arial',
  colors: {
    dk1: '0B0C0D', lt1: 'F3F1EC', dk2: '15181B', lt2: 'B4B1A9',
    accent1: 'FF4D2E', accent2: 'FFB020', accent3: '6FC3D6', accent4: '8C8A83', accent5: '2A2F35', accent6: '1D2125',
    hlink: '6FC3D6', folHlink: 'B4B1A9',
  },
};
const HEX = { red: 'FF4D2E', amber: 'FFB020', ice: '6FC3D6', mute: '8C8A83', ink: 'F3F1EC', ink2: 'B4B1A9', line: '2A2F35', panel: '15181B', dim: '4A4F55' };

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'SLOPEWATCH: check these slopes first';
pres.subject = 'NASA Space Apps Challenge 2026 Seoul, Dancing with the Stars: SARs';
pres.author = TEAM;
const C = pres.SchemeColor;
const INK = C.background1, INK2 = C.background2, BG = C.text1, PANEL = C.text2;
const RED = C.accent1, AMBER = C.accent2, ICE = C.accent3, MUTE = C.accent4, LINE = C.accent5, PANEL2 = C.accent6;
const HEAD = '+mj-lt';
const W = 13.333, M = 0.6, CW = W - 2 * M;

// ---------- assets ----------
async function icon(name, hex, px = 256) {
  const svg = renderToStaticMarkup(React.createElement(Lu[name], { size: px, color: '#' + hex, strokeWidth: 2 }));
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
async function logo(hex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40" width="480" height="400"><path d="M3 36 L18 10 L26 23 L32 15 L45 36 Z" fill="none" stroke="#${hex}" stroke-width="4" stroke-linejoin="round"/></svg>`;
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}

// ---------- layouts ----------
pres.defineSlideMaster({
  title: 'TITLE',
  background: { color: BG },
  objects: [
    { placeholder: { options: { name: 'kicker', type: 'body', x: M, y: 1.98, w: 8, h: 0.32, align: 'left', fontSize: 12, bold: true, color: RED, charSpacing: 3, margin: 0, valign: 'top' }, text: '' } },
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 2.38, w: 7.6, h: 2.05, align: 'left', fontSize: 58, color: INK, margin: 0, valign: 'top', lineSpacingMultiple: 0.88 }, text: '' } },
    { placeholder: { options: { name: 'sub', type: 'body', x: M, y: 4.5, w: 5.9, h: 1.15, align: 'left', fontSize: 17, color: INK2, margin: 0, valign: 'top', lineSpacingMultiple: 1.1 }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: BG },
  margin: [0.5, M, 0.6, M],
  objects: [
    { placeholder: { options: { name: 'eyebrow', type: 'body', x: M, y: 0.42, w: 9, h: 0.3, align: 'left', fontSize: 12, bold: true, color: RED, charSpacing: 3, margin: 0, valign: 'top' }, text: '' } },
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.74, w: CW, h: 1.08, align: 'left', fontSize: 30, color: INK, margin: 0, valign: 'top', lineSpacingMultiple: 0.95 }, text: '' } },
    { text: { text: 'SLOPEWATCH  ·  NASA Space Apps Challenge 2026  ·  Seoul', options: { x: M, y: 7.02, w: 8, h: 0.26, fontSize: 10, color: MUTE, margin: 0, valign: 'middle' } } },
  ],
  slideNumber: { x: W - M - 0.6, y: 7.02, w: 0.6, h: 0.26, fontSize: 10, color: MUTE, align: 'right', margin: 0 },
});

// ---------- helpers ----------
// keep a number on the same line as its unit or the next word ("300 m", "21 Jul", "108 × 78 km")
const nb = (s) => s.replace(/(\d) (cm|m|km|GB|mm|Jun|Jul|Aug|Oct|Nov|Mar|Apr|×)(?=[\s.,;:)]|$)/g, '$1 $2').replace(/× (\d)/g, '× $1');
const fix = (t) => (typeof t === 'string' ? nb(t) : t.map((r) => ({ ...r, text: nb(r.text) })));
const T = (slide, text, o) => slide.addText(fix(text), { isTextBox: true, margin: 0, valign: 'top', fontSize: 14, color: INK, ...o });
const label = (slide, text, o) => T(slide, text.toUpperCase(), { fontSize: 11, bold: true, color: MUTE, charSpacing: 2, h: 0.26, ...o });
const panel = (slide, x, y, w, h, o = {}) => slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: PANEL }, line: { color: LINE, width: 0.75 }, ...o });
async function badge(slide, name, x, y, d, ring, fill, iconHex) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: ring, width: 1.25 }, objectName: `icon-circle-${name}` });
  const p = d * 0.27;
  slide.addImage({ data: await icon(name, iconHex), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, altText: name.replace(/^Lu/, '') + ' icon' });
}
const marker = (slide, n, x, y, d = 0.36) => {
  slide.addShape(pres.shapes.OVAL, { x: x - d / 2, y: y - d / 2, w: d, h: d, fill: { color: RED }, line: { color: INK, width: 1.5 }, objectName: `marker-${n}` });
  T(slide, String(n), { x: x - d / 2, y: y - d / 2, w: d, h: d, fontSize: 13, bold: true, color: INK, align: 'center', valign: 'middle' });
};

(async () => {
  // ===================================================== 1 · TITLE
  pres.addSection({ title: 'Problem' });
  let s = pres.addSlide({ masterName: 'TITLE', sectionTitle: 'Problem' });
  s.background = { path: path.join(IMG, 'hero.jpg') };
  s.addImage({ data: await logo(HEX.red), x: M, y: 0.56, w: 0.42, h: 0.35, altText: 'SLOPEWATCH logo, a mountain outline' });
  T(s, 'SLOPEWATCH', { x: M + 0.55, y: 0.5, w: 3.2, h: 0.46, fontSize: 18, fontFace: HEAD, charSpacing: 1, valign: 'middle' });
  T(s, 'NASA SPACE APPS CHALLENGE 2026  ·  SEOUL', { x: W - M - 6, y: 0.5, w: 6, h: 0.46, fontSize: 12, bold: true, color: INK2, charSpacing: 2, align: 'right', valign: 'middle' });
  s.addText('CHALLENGE  ·  DANCING WITH THE STARS: SARs', { placeholder: 'kicker' });
  s.addText('Check these slopes first.', { placeholder: 'title' });
  s.addText('A radar satellite measures hillsides moving by the centimetre. Two machine-learning models turn that into a ranked list of slopes for local governments to inspect before the rainy season.', { placeholder: 'sub' });
  T(s, [
    { text: 'THE PROBLEM', options: { fontSize: 11, bold: true, color: RED, charSpacing: 2, breakLine: true } },
    { text: 'Korea’s landslide warnings watch the rain. Nothing measures whether a slope is already moving.', options: { fontSize: 15, color: INK } },
  ], { x: M, y: 5.88, w: 6.3, h: 0.8, paraSpaceAfter: 4 });
  T(s, `${TEAM}  ·  high school team, Seoul`, { x: M, y: 6.92, w: 6, h: 0.3, fontSize: 12, color: MUTE, valign: 'middle' });
  T(s, [
    { text: '■ ', options: { color: RED } }, { text: 'Check first    ', options: { color: INK2 } },
    { text: '■ ', options: { color: AMBER } }, { text: 'Watch    ', options: { color: INK2 } },
    { text: 'live map, Andong area', options: { color: MUTE } },
  ], { x: W - M - 5, y: 6.92, w: 5, h: 0.3, fontSize: 11, align: 'right', valign: 'middle' });
  s.addNotes([
    'Title, team, challenge, problem.',
    'We are a high school team from Seoul. Our challenge is Dancing with the Stars: SARs, using NISAR to see the Earth\'s surface change.',
    'Korea\'s landslide warnings are driven by rain and soil water. Nothing in that chain measures whether a hillside is already creeping. NISAR can.',
    'SLOPEWATCH turns NISAR radar plus two machine-learning models into a short, ranked list of hillsides to inspect before the rainy season.',
    'The background is our live 3D map: red patches are "check first", amber are "watch".',
  ].join('\n'));

  // ===================================================== 2 · PROBLEM AND USERS
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Problem' });
  s.addText('01  ·  THE PROBLEM AND WHO HAS IT', { placeholder: 'eyebrow' });
  s.addText([{ text: 'Warnings watch the rain. ', options: { color: INK } }, { text: 'Nobody watches the ground.', options: { color: INK2 } }], { placeholder: 'title' });
  const iw = 3.45, ih = iw * 792 / 1100, iy = 2.0;
  s.addImage({ path: path.join(IMG, 'fire_before.jpg'), x: M, y: iy, w: iw, h: ih, altText: 'Sentinel-2 false-colour image of North Gyeongsang on 14 March 2025, before the wildfires: mostly green vegetation' });
  s.addImage({ path: path.join(IMG, 'fire_after.jpg'), x: M + iw + 0.2, y: iy, w: iw, h: ih, altText: 'The same area on 8 April 2025, after the wildfires: a wide dark-red band of burned hillside across the middle' });
  T(s, '14 Mar 2025  ·  before the fires', { x: M, y: iy + ih + 0.1, w: iw, h: 0.3, fontSize: 13, bold: true });
  T(s, '8 Apr 2025  ·  after', { x: M + iw + 0.2, y: iy + ih + 0.1, w: iw, h: 0.3, fontSize: 13, bold: true, color: RED });
  T(s, 'Sentinel-2 false colour, same 108 × 78 km area. Green: vegetation. Dark red: burned ground.', { x: M, y: iy + ih + 0.42, w: 2 * iw + 0.2, h: 0.28, fontSize: 10, color: MUTE });
  // timeline
  const ty = 5.55, cols = [
    ['MAR 2025', 'Wildfires burn the hills from Uiseong to the coast.'],
    ['18–19 JUL 2026', 'A storm hits the burn scar. 217 people evacuated.'],
    ['EVERY YEAR', 'Officers pick which slopes to inspect, blind to movement.'],
  ];
  s.addShape(pres.shapes.LINE, { x: M, y: ty + 0.07, w: 2 * iw + 0.2, h: 0, line: { color: LINE, width: 1.5 } });
  cols.forEach(([d, t], i) => {
    const x = M + i * 2.45;
    s.addShape(pres.shapes.OVAL, { x, y: ty, w: 0.14, h: 0.14, fill: { color: i === 2 ? INK : RED }, line: { color: BG, width: 2 } });
    T(s, d, { x, y: ty + 0.25, w: 2.3, h: 0.26, fontSize: 11, bold: true, color: i === 2 ? INK : RED, charSpacing: 1 });
    T(s, t, { x, y: ty + 0.55, w: 2.25, h: 0.75, fontSize: 14, color: INK2 });
  });
  // who decides
  const px = 8.1, pw = W - M - px;
  panel(s, px, 2.0, pw, 4.8);
  label(s, 'Who decides', { x: px + 0.3, y: 2.22, w: pw - 0.6 });
  T(s, 'The local government officer', { x: px + 0.3, y: 2.5, w: pw - 0.6, h: 0.45, fontSize: 20, bold: true });
  const steps = [
    ['LuCloudRain', 'National forecast', [{ text: 'Rain, soil water and a fixed hazard map. No measured movement.' }]],
    ['LuUserRound', 'Local officer', [{ text: 'Chooses which slopes to check. ' }, { text: 'SLOPEWATCH fits here.', options: { color: RED, bold: true } }]],
    ['LuLandmark', 'Situation meeting', [{ text: 'Decides whether to evacuate.' }]],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [ic, head, body] = steps[i], y = 3.2 + i * 1.08, hot = i === 1;
    if (i < steps.length - 1) s.addShape(pres.shapes.LINE, { x: px + 0.575, y: y + 0.55, w: 0, h: 0.53, line: { color: LINE, width: 1.5 } });
    await badge(s, ic, px + 0.3, y, 0.55, hot ? RED : LINE, hot ? RED : PANEL2, hot ? HEX.ink : HEX.ink2);
    T(s, head, { x: px + 1.05, y: y - 0.02, w: pw - 1.3, h: 0.3, fontSize: 15, bold: true });
    T(s, body.map((r) => ({ text: r.text, options: { color: INK2, ...(r.options || {}) } })), { x: px + 1.05, y: y + 0.29, w: pw - 1.3, h: 0.62, fontSize: 14 });
  }
  T(s, 'Source: phone consultation with a landslide researcher (anonymous), 13 Nov 2026.', { x: px + 0.3, y: 6.33, w: pw - 0.6, h: 0.32, fontSize: 10, color: MUTE });
  s.addNotes([
    'Problem and target users.',
    'In March 2025 wildfires burned the hills of North Gyeongsang (the dark red band, Sentinel-2). Burned slopes fail more easily.',
    'On 18-19 July 2026 a storm hit the burn scar and 217 people were evacuated.',
    'We phoned a landslide researcher at a national institute. The national system forecasts from rain, soil water and a fixed hazard map. The local government officer then picks which slopes in the district are vulnerable, and a situation meeting decides on evacuation.',
    'Nothing in that chain measures whether a slope is actually moving. Our user is that local officer.',
  ].join('\n'));

  // ===================================================== 3 · UNDER THE HOOD
  // Noise budget: medians over the 23 pairs in data/work/p03.log (rad x lambda/4pi = 1.925 cm/rad), and the
  // per-hexagon noise_pair values in site/data/meta.json. Architecture and thresholds from p03, p04, p07, k04.
  pres.addSection({ title: 'Solution' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Solution' });
  s.addText('02  ·  UNDER THE HOOD', { placeholder: 'eyebrow' });
  s.addText([{ text: 'Centimetres from 747 km up: ', options: { color: INK } }, { text: 'the hard part.', options: { color: INK2 } }], { placeholder: 'title' });

  // the equation every pixel goes through
  const ey = 2.0, eh = 1.3, ew = 6.95;
  panel(s, M, ey, ew, eh);
  label(s, 'Phase to movement · every 80 m pixel · every 12-day pair', { x: M + 0.3, y: ey + 0.16, w: ew - 0.6, h: 0.22, fontSize: 10 });
  const it = (t) => ({ text: t, options: { italic: true } }), sub = (t) => ({ text: t, options: { fontSize: 12, italic: false, color: INK2 } }), r = (t) => ({ text: t });
  s.addText([
    it('d'), sub('LOS'), r(' = −('), it('λ'), r('/4π) · ('), it('φ'), sub('unw'), r(' − '), it('φ'), sub('iono'), r(' − '), it('φ'), sub('tropo'), r(' − '), it('φ'), sub('tide'), r(')'),
  ], { isTextBox: true, x: M + 0.3, y: ey + 0.42, w: ew - 0.6, h: 0.42, margin: 0, fontFace: 'Times New Roman', fontSize: 22, color: INK, valign: 'middle' });
  T(s, 'λ = 24.2 cm (L-band), so one radian of phase is 1.93 cm of motion. Every screen is interpolated from NISAR’s 3-D metadata cubes to ground height.', { x: M + 0.3, y: ey + 0.88, w: ew - 0.6, h: 0.36, fontSize: 11, color: INK2 });

  // noise budget, drawn as columns
  const nx = M + ew + 0.25, nw = W - M - nx;
  panel(s, nx, ey, nw, eh);
  label(s, 'Noise per pair, median of 23', { x: nx + 0.3, y: ey + 0.16, w: nw - 0.6, h: 0.22, fontSize: 10 });
  const budget = [['raw', 1.52], ['− iono', 1.33], ['+ tropo, tide', 1.54], ['− facing, 1 km', 0.55], ['per hexagon', 0.34]];
  const colW = (nw - 0.6) / budget.length, base = ey + eh - 0.47, hmax = 0.4;
  budget.forEach(([name, v], i) => {
    const x = nx + 0.3 + i * colW, h = hmax * v / 1.54, last = i === budget.length - 1;
    s.addShape(pres.shapes.RECTANGLE, { x: x + colW * 0.18, y: base - h, w: colW * 0.64, h, fill: { color: last ? ICE : MUTE, transparency: last ? 0 : 55 }, line: { type: 'none' }, objectName: `noise-${i}` });
    T(s, v.toFixed(2), { x, y: base + 0.04, w: colW, h: 0.19, fontSize: 10, bold: true, color: last ? ICE : INK2, align: 'center' });
    T(s, name, { x: x - 0.04, y: base + 0.23, w: colW + 0.08, h: 0.18, fontSize: 9, color: MUTE, align: 'center' });
  });
  T(s, 'cm', { x: nx + nw - 0.6, y: ey + 0.16, w: 0.3, h: 0.22, fontSize: 10, color: MUTE, align: 'right' });

  // six hard problems
  const hard = [
    ['Data access', '23 interferograms, 2.4 GB of HDF5 each, behind an Earthdata login.', 'HTTP range reads (earthaccess + fsspec + h5py) crop only our 108 × 78 km window: a few MB per pair.'],
    ['Decorrelation', 'Vegetation scrambles the phase, and unwrapping can slip by whole fringes.', 'Coherence ≥ 0.3 inside the main connected component; 12-day steps over 6 cm dropped as unwrapping errors.'],
    ['A phantom signal', 'A phase term that tracks whether each slope faces the radar, on all 3 tracks.', 'Per-pair least squares on plane, height and range-slope terms, then a 1 km Gaussian high-pass.'],
    ['One-dimensional radar', 'Radar sees motion only along its line of sight; a sideways slide is invisible.', 'Each slope’s 3-D downslope vector projected onto all 3 tracks’ look vectors; layover and shadow masked.'],
    ['Nothing to learn from', 'No labelled creeping slopes in Korea to train a detector on.', 'Synthetic creep hidden in real NISAR noise; GRU(12→32) + MLP head; 3 spatial folds; cut at 1% false alarms.'],
    ['20 labels, 129,948 slopes', '20 failed hexagons to rank a whole country.', 'LightGBM + a student distilled from a 20 m teacher (47,957 slopes), retrained out-of-fold per county group.'],
  ];
  const gy = ey + eh + 0.2, gw = (CW - 2 * 0.2) / 3, gh = (6.9 - gy - 0.2) / 2;
  hard.forEach(([head, prob, fix], i) => {
    const x = M + (i % 3) * (gw + 0.2), y = gy + Math.floor(i / 3) * (gh + 0.2);
    panel(s, x, y, gw, gh);
    T(s, [
      { text: String(i + 1).padStart(2, '0') + '  ', options: { color: RED, fontFace: HEAD } },
      { text: head, options: { bold: true, color: INK, breakLine: true } },
      { text: prob, options: { fontSize: 12, color: RED, breakLine: true } },
      { text: fix, options: { fontSize: 11, color: INK2 } },
    ], { x: x + 0.22, y: y + 0.15, w: gw - 0.44, h: gh - 0.25, fontSize: 14, paraSpaceAfter: 4 });
  });
  s.addNotes([
    'Under the hood: why this was hard.',
    'NISAR flies 747 km up. One colour fringe in an interferogram is 12.1 cm of motion, and we are looking for 2 to 4 cm over weeks.',
    'Every pixel goes through this equation: unwrapped phase minus the ionosphere, troposphere and solid-earth tide screens, times lambda over 4 pi. The screens come from 3-D cubes in each NISAR file that we interpolate to ground height.',
    'The noise budget on the right is measured: 1.52 cm raw per pair, 1.33 after the ionosphere. The official troposphere and tide screens did not reduce it further on their own. Removing a terrain-facing phantom term we found on all three tracks and a 1 km high-pass brought it to 0.55 cm per pixel, and the median per hexagon to 0.34 cm.',
    'Six problems we had to solve: streaming 2.4 GB HDF5 files by HTTP range reads; decorrelation and unwrapping slips; the phantom facing term; radar only seeing one direction, so we project each slope\'s downslope vector onto each orbit\'s look vector; no labelled moving slopes, so we trained a GRU on synthetic creep hidden in real noise; and only 20 failed slopes to rank 129,948, so we distilled a 20 m teacher model into the nationwide ranker with leak-free out-of-fold training.',
  ].join('\n'));

  // ===================================================== 4 · VISUALS AND UX
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Solution' });
  s.addText('03  ·  WHAT IT LOOKS LIKE', { placeholder: 'eyebrow' });
  s.addText([{ text: 'Click a slope. ', options: { color: INK } }, { text: 'See why it is on the list.', options: { color: INK2 } }], { placeholder: 'title' });
  const sx = M, sy = 2.0, sw = 8.6, sh = sw * 9 / 16;
  s.addImage({ path: path.join(IMG, 'ui.jpg'), x: sx, y: sy, w: sw, h: sh, altText: 'Screenshot of the SLOPEWATCH 3D map: a selected check-first slope near Andong with a beacon, its danger index of 94 out of 100, the reasons, and the June to October radar timeline' });
  s.addShape(pres.shapes.RECTANGLE, { x: sx, y: sy, w: sw, h: sh, fill: { type: 'none' }, line: { color: LINE, width: 0.75 } });
  marker(s, 1, sx + sw * 0.43, sy + sh * 0.47);
  marker(s, 2, sx + sw * 0.748, sy + sh * 0.30);
  marker(s, 3, sx + sw * 0.40, sy + sh * 0.895);
  const lx = sx + sw + 0.4, lw = W - M - lx;
  const how = [
    ['The slope', 'Each coloured patch is one hillside. Red: check first. Amber: watch.'],
    ['Danger index and reasons', '94 / 100, #15 of 1,355 here. Split into the slope itself and what lies below it.'],
    ['Storm replay', 'Scrub June to October. Every radar pass and the July storm are on the timeline.'],
  ];
  how.forEach(([h, b], i) => {
    const y = sy + i * 1.32;
    s.addShape(pres.shapes.OVAL, { x: lx, y, w: 0.36, h: 0.36, fill: { color: RED }, line: { color: RED, width: 1 } });
    T(s, String(i + 1), { x: lx, y, w: 0.36, h: 0.36, fontSize: 13, bold: true, align: 'center', valign: 'middle' });
    T(s, h, { x: lx + 0.5, y: y + 0.02, w: lw - 0.5, h: 0.32, fontSize: 15, bold: true });
    T(s, b, { x: lx + 0.5, y: y + 0.36, w: lw - 0.5, h: 0.9, fontSize: 14, color: INK2 });
  });
  T(s, [{ text: 'LIVE MAP', options: { bold: true, color: RED, charSpacing: 2, fontSize: 11, breakLine: true } }, { text: 'All 129,948 hillsides in 17 provinces, plus a 20 m map of the burn area.', options: { color: INK2 } }], { x: lx, y: sy + sh - 0.92, w: lw, h: 0.92, fontSize: 14, valign: 'bottom', paraSpaceAfter: 3 });
  s.addNotes([
    'Project visuals and user experience. This is a real screenshot of the working site.',
    '1: each coloured patch is one hillside. The officer clicks one and a beacon marks it.',
    '2: the danger index, 94 out of 100, number 15 of 1,355 in this area. The panel explains why: the radar measured movement here and a main road runs below it.',
    '3: the timeline replays June to October 2026, every NISAR pass and the July storm.',
    'One click prints an inspection sheet per county.',
  ].join('\n'));

  // ===================================================== 5 · NASA DATA
  pres.addSection({ title: 'Evidence' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Evidence' });
  s.background = { path: path.join(IMG, 'ifg.jpg') };
  s.addText('04  ·  NASA DATA', { placeholder: 'eyebrow' });
  s.addText([{ text: 'NISAR sees the ground move, ', options: { color: INK } }, { text: 'even through cloud.', options: { color: INK2 } }], { placeholder: 'title' });
  const stats = [
    ['23', 'NISAR L-band interferograms (GUNW) on 3 orbits, 22 Jun – 20 Oct 2026'],
    ['0.25–0.44 cm', 'noise per image pair per hillside, after removing ionosphere, atmosphere and tides'],
    ['21 Jul', 'radar saw the ground two days after the storm. The first clear optical image came on 6 Aug.'],
    ['2.4 GB → crop', 'streamed only our area from each NISAR file over HTTPS, nothing bulk-downloaded'],
  ];
  stats.forEach(([n, t], i) => {
    const y = 2.0 + i * 1.02;
    T(s, n, { x: M, y, w: 5.2, h: 0.46, fontSize: 26, fontFace: HEAD, color: ICE });
    T(s, t, { x: M, y: y + 0.46, w: 4.7, h: 0.52, fontSize: 14, color: INK2 });
  });
  T(s, 'Also used: Sentinel-2, Copernicus DEM, ESA WorldCover, Hansen forest loss (Landsat), ERA5 rain, OpenStreetMap.', { x: M, y: 6.2, w: 4.9, h: 0.5, fontSize: 11, color: MUTE });
  T(s, 'Raw NISAR interferogram spanning the 18–19 Jul 2026 storm, draped on the terrain around Andong. One colour cycle is 12.1 cm along the radar’s line of sight; most of this pattern is atmosphere, which the pipeline removes.', { x: 6.55, y: 6.18, w: W - M - 6.55, h: 0.6, fontSize: 10, color: INK2, align: 'right', valign: 'bottom' });
  s.addNotes([
    'NASA data use.',
    'NISAR is the NASA and ISRO radar satellite. We used 23 L-band interferograms (GUNW products from the ASF DAAC) on three orbits, June to October 2026.',
    'After removing the ionosphere, atmosphere and tides, plus a terrain-facing phase term we found ourselves, the noise is 0.25 to 0.44 cm per image pair per hillside. So we can see centimetres from space.',
    'Radar works through cloud: NISAR imaged the burn area on 21 July, two days after the storm. The first clear optical picture came on 6 August, 18 days later.',
    'Each NISAR file is about 2.4 GB. We streamed only our crop over HTTPS with earthaccess.',
    'The rainbow on the terrain is a raw interferogram. One colour cycle is 12.1 cm, half the 24.2 cm L-band wavelength. Most of that pattern is atmosphere, which is exactly what our pipeline strips out before the models see it.',
  ].join('\n'));

  // ===================================================== 6 · IMPLEMENTATION AND RESULTS
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Evidence' });
  s.addText('05  ·  HOW WE BUILT IT, HOW WE TESTED IT', { placeholder: 'eyebrow' });
  s.addText([{ text: 'Two models, ', options: { color: INK } }, { text: 'scored on ground they never saw.', options: { color: INK2 } }], { placeholder: 'title' });
  const cw2 = (CW - 0.3) / 2, cy = 2.0, ch = 4.4;
  const axis = { catAxisLabelColor: HEX.ink2, valAxisLabelColor: HEX.ink2, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, catAxisLineShow: false, valAxisLineShow: false };
  const blocks = [
    { tag: 'MODEL 1  ·  GRU NEURAL NETWORK', head: 'Is this slope moving?', how: 'Trained by hiding fake slips in real NISAR noise, so it needed no labelled landslides.', big: '66%', side: 'of 3 cm slips caught at 1% false alarms. A matched filter catches 33%.' },
    { tag: 'MODEL 2  ·  GRADIENT-BOOSTED TREES', head: 'Which slopes are weak?', how: 'Learned from the July 2026 failures, taught by a finer 20 m model of 47,957 slopes.', big: '5×', side: 'chance. 25% of the failed slopes sat in our top 5%. AUC 0.70 on held-out counties.' },
  ];
  blocks.forEach((b, i) => {
    const x = M + i * (cw2 + 0.3);
    panel(s, x, cy, cw2, ch);
    T(s, b.tag, { x: x + 0.3, y: cy + 0.22, w: cw2 - 0.6, h: 0.26, fontSize: 11, bold: true, color: RED, charSpacing: 2 });
    T(s, b.head, { x: x + 0.3, y: cy + 0.5, w: cw2 - 0.6, h: 0.4, fontSize: 19, bold: true });
    T(s, b.how, { x: x + 0.3, y: cy + 0.92, w: cw2 - 0.6, h: 0.5, fontSize: 13, color: INK2 });
    T(s, b.big, { x: x + 0.3, y: cy + 1.45, w: 1.55, h: 0.62, fontSize: 36, fontFace: HEAD, color: RED, valign: 'middle' });
    T(s, b.side, { x: x + 1.85, y: cy + 1.45, w: cw2 - 2.15, h: 0.62, fontSize: 13, color: INK, valign: 'middle' });
  });
  // model 1: detection rate vs injected movement (well-oriented slopes, 1% false alarms)
  const cm = [0, 1, 2, 3, 5, 8];
  s.addChart(pres.charts.SCATTER, [
    { name: 'cm', values: cm },
    { name: 'GRU detector (ours)', values: [1, 6.0, 32.1, 66.3, 95.6, 99.8] },
    { name: 'Matched filter', values: [1, 2.3, 11.7, 32.7, 77.1, 98.2] },
    { name: 'Z-score', values: [1, 1.7, 7.0, 21.6, 64.9, 96.1] },
    { name: 'Autoencoder (dropped)', values: [1, 1.5, 2.8, 7.3, 32.9, 76.7] },
  ], {
    x: M + 0.15, y: cy + 2.15, w: cw2 - 0.3, h: ch - 2.25, ...axis,
    chartColors: [HEX.red, HEX.ice, HEX.ink2, HEX.dim], lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    valAxisMinVal: 0, valAxisMaxVal: 100, valAxisMajorUnit: 50, catAxisMinVal: 0, catAxisMaxVal: 8, catAxisMajorUnit: 1,
    valGridLine: { color: HEX.line, size: 0.75 }, catGridLine: { style: 'none' },
    showValAxisTitle: true, valAxisTitle: '% caught', valAxisTitleColor: HEX.mute, valAxisTitleFontSize: 10, valAxisTitleFontFace: '+mn-lt',
    showCatAxisTitle: true, catAxisTitle: 'downslope movement hidden in real noise (cm)', catAxisTitleColor: HEX.mute, catAxisTitleFontSize: 10, catAxisTitleFontFace: '+mn-lt',
    showLegend: true, legendPos: 'r', legendColor: HEX.ink2, legendFontSize: 10, legendFontFace: '+mn-lt',
  });
  // model 2: share of July 2026 failed slopes inside the top 5% (counties held out)
  const x2 = M + cw2 + 0.3;
  // drawn as shapes: Keynote drops pptxgenjs bar charts, and shapes survive Google Slides import unchanged
  label(s, 'Failed slopes inside the top 5% of the ranking', { x: x2 + 0.3, y: cy + 2.2, w: cw2 - 0.6, fontSize: 10 });
  const bars = [['Random', 5], ['Steepness only', 10], ['Steep + burned', 15], ['SLOPEWATCH', 25]];
  const bx = x2 + 2.05, bmax = cw2 - 2.05 - 0.85, by0 = cy + 2.55;
  bars.forEach(([name, v], i) => {
    const y = by0 + i * 0.4, me = i === bars.length - 1, bw = bmax * v / 25;
    T(s, name, { x: x2 + 0.3, y, w: 1.65, h: 0.3, fontSize: 13, bold: me, color: me ? INK : INK2, valign: 'middle' });
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y: y + 0.03, w: bw, h: 0.24, fill: { color: me ? RED : MUTE, transparency: me ? 0 : 55 }, line: { type: 'none' }, objectName: `bar-${name}` });
    T(s, `${v}%`, { x: bx + bw + 0.1, y, w: 0.7, h: 0.3, fontSize: 13, bold: true, color: me ? RED : INK2, valign: 'middle' });
  });
  T(s, '5 county groups held out in turn. AUC 0.70 (0.62 without the 20 m teacher).', { x: x2 + 0.3, y: by0 + 1.56, w: cw2 - 0.6, h: 0.26, fontSize: 10, color: MUTE });
  T(s, [
    { text: 'THROWN OUT  ', options: { bold: true, color: RED, charSpacing: 2, fontSize: 11 } },
    { text: 'an autoencoder (7% vs 22% for a plain z-score), and radar inputs in the ranker.     ', options: { color: INK2 } },
    { text: 'LIMIT  ', options: { bold: true, color: RED, charSpacing: 2, fontSize: 11 } },
    { text: 'only 20 failed slopes, not yet checked by hand.', options: { color: INK2 } },
  ], { x: M, y: 6.52, w: CW, h: 0.32, fontSize: 12, valign: 'middle' });
  s.addNotes([
    'Implementation, design choices and results.',
    'Model 1 is a small GRU. Real landslide movement is rare, so we hid synthetic downslope slips in real NISAR noise and trained it to find them. On slopes the radar views at a useful angle (73% of them), at 1 false alarm in 100, it catches 66% of 3 cm slips: twice a classic matched filter. 50% detection at 2.5 cm, 80% at 3.9 cm.',
    'Model 2 is gradient-boosted trees (LightGBM), trained on the slopes that failed in the July 2026 storm, with whole groups of counties held out in turn. A finer 20 m regional model of 47,957 slopes teaches it; with that teacher the AUC rose from 0.62 to 0.70.',
    'Result: 25% of the failed slopes sat in our top 5%, five times chance, and better than steepness alone (10%) or steep plus burned (15%).',
    'What did not work: an autoencoder did worse than a plain z-score, and adding radar inputs to the ranker made it worse, so both were dropped.',
    'Limit: there are only 20 failed slopes nationwide in the test, found automatically and not yet hand-checked. The ranges are wide.',
  ].join('\n'));

  // ===================================================== 7 · IMPACT, NEXT STEPS, REFERENCES
  pres.addSection({ title: 'Impact' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Impact' });
  s.addImage({ path: path.join(IMG, 'korea.jpg'), x: 8.35, y: 1.9, w: 4.95 * 1400 / 1468, h: 4.95, altText: 'The SLOPEWATCH map of all of South Korea, with watch and check-first hillsides speckled orange across the mountain provinces' });
  s.addText('06  ·  IMPACT AND NEXT STEPS', { placeholder: 'eyebrow' });
  s.addText([{ text: '3,291 hillsides to check ', options: { color: INK } }, { text: 'before the next rainy season.', options: { color: INK2 } }], { placeholder: 'title' });
  const big = [['129,948', 'hillsides ranked in all 17 provinces', INK], ['22,768', 'to watch', AMBER], ['3,291', 'to check first: 2.5% of hillsides, each with a house or road below', RED]];
  big.forEach(([n, t, col], i) => {
    const x = M + i * 2.55;
    T(s, n, { x, y: 2.0, w: 2.45, h: 0.6, fontSize: 32, fontFace: HEAD, color: col });
    T(s, t, { x, y: 2.62, w: 2.35, h: 0.75, fontSize: 13, color: INK2 });
  });
  label(s, 'Next', { x: M, y: 3.62, w: 7 });
  const next = [
    'Hand-check the 170 storm-scar candidates to firm up the labels.',
    'Extend NISAR movement from North Gyeongsang to the whole country.',
    'Pilot with one county office before the 2027 rainy season.',
    'Add Korea Forest Service landslide records as a second test.',
  ];
  next.forEach((t, i) => {
    const y = 3.95 + i * 0.4;
    T(s, String(i + 1).padStart(2, '0'), { x: M, y, w: 0.45, h: 0.32, fontSize: 13, bold: true, color: RED, valign: 'middle' });
    T(s, t, { x: M + 0.5, y, w: 7.0, h: 0.32, fontSize: 14, valign: 'middle' });
  });
  T(s, 'Not a warning system: it ranks slopes for inspection and does not say when one will fail.', { x: M, y: 5.62, w: 7.5, h: 0.3, fontSize: 12, italic: true, color: INK2 });
  T(s, [
    { text: 'DATA  ', options: { bold: true, color: INK2 } },
    { text: 'NISAR L2 GUNW (NASA/ISRO, ASF DAAC) · Sentinel-2 L2A (ESA Copernicus) · Copernicus DEM · ESA WorldCover 2021 · Hansen Forest Change v1.13 · ERA5 (ECMWF) · OpenStreetMap · KOSTAT boundaries', options: { breakLine: true } },
    { text: 'TOOLS  ', options: { bold: true, color: INK2 } },
    { text: 'Python, PyTorch, LightGBM, earthaccess, three.js  ·  SI: Claude Code helped write code and text', options: { breakLine: true } },
    { text: 'CODE  ', options: { bold: true, color: INK2 } },
    { text: REPO },
  ], { x: M, y: 6.0, w: 7.6, h: 0.88, fontSize: 10, color: MUTE, paraSpaceAfter: 2 });
  s.addNotes([
    'Impact, next steps and references.',
    'Every hillside steeper than 10 degrees in South Korea, 129,948 of them, is ranked. 22,768 are to watch. 3,291, about 2.5%, are check first: risky, and with a house or main road below. We checked them against 1.38 million mapped buildings.',
    'That lets a county spend a limited inspection budget on the slopes that matter most, before the rain comes.',
    'Next: hand-check the storm-scar labels, extend NISAR movement nationwide, pilot with a county office before the 2027 rainy season, and add Korea Forest Service landslide records.',
    'It is not a warning system and it does not predict when a slope fails. All data, tools and AI assistance are listed here and on the project page.',
  ].join('\n'));

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
