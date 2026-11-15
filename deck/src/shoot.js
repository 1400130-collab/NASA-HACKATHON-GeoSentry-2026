// Capture clean frames of the live SLOPEWATCH 3D map for the deck.
const puppeteer = require('puppeteer-core');
const OUT = process.argv[2];
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE = `#top,#left,#right,#time,#hint,#hover,#tip,#caption,#intro{display:none!important}`;

async function open(browser, url, w = 1600, h = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('intro')?.classList.contains('done') && window.__app, { timeout: 180000 });
  await sleep(6500);
  return page;
}
async function shot(page, name, hide = true) {
  const id = hide ? await page.addStyleTag({ content: HIDE }) : null;
  await sleep(1800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (id) await page.evaluate((el) => el.remove(), id);
  console.log('shot', name);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CH, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
  const job = process.argv[3] || 'all';

  if (job === 'all' || job === 'region') {
    const p = await open(browser, 'http://localhost:5173/map.html?area=region&lang=en');
    await shot(p, 'r_level_home');
    await p.evaluate(() => window.__app.setMode('ifg')); await sleep(3500);
    await shot(p, 'r_ifg_home');
    await p.evaluate(() => { window.__app.setMode('img'); window.__app.setImage('postfire_20250408', true); }); await sleep(3500);
    await shot(p, 'r_postfire_home');
    await p.evaluate(() => { window.__app.setMode('level'); window.__app.setCounty(11); }); await sleep(4500);
    await shot(p, 'r_level_andong');
    await p.evaluate(() => window.__app.setMode('ifg')); await sleep(3500);
    await shot(p, 'r_ifg_andong');
    await p.evaluate(() => window.__app.setMode('move')); await sleep(3500);
    await shot(p, 'r_move_andong');
    // top-ranked check-first slope, selected, with the UI visible
    await p.evaluate(() => { window.__app.setMode('level'); const it = document.querySelector('.item'); window.__app.select(+it.dataset.u, true); }); await sleep(5000);
    await shot(p, 'r_ui_selected', false);
    await shot(p, 'r_selected_clean');
    await p.close();
  }
  if (job === 'all' || job === 'korea') {
    const p = await open(browser, 'http://localhost:5173/map.html?lang=en');
    await shot(p, 'k_level_home');
    await shot(p, 'k_ui_home', false);
    await p.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
