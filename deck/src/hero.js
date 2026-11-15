const puppeteer = require('puppeteer-core');
const OUT = process.argv[2], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE = `#top,#left,#right,#time,#hint,#hover,#tip,#caption,#intro{display:none!important}`;
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
  const p = await b.newPage(); await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
  await p.goto('http://localhost:5173/map.html?area=region&lang=en', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('intro')?.classList.contains('done') && window.__app, { timeout: 180000 });
  await sleep(6500);
  await p.evaluate(() => window.__app.setCounty(11)); await sleep(5000);
  for (const [dx, name] of [[330, 'hero_a'], [170, 'hero_b']]) {
    await p.mouse.move(700, 600); await p.mouse.down(); 
    for (let i = 1; i <= 20; i++) { await p.mouse.move(700 + dx * i / 20, 600 - 10 * i / 20); await sleep(16); }
    await p.mouse.up(); await p.mouse.move(5, 5); await sleep(3000);
    const tag = await p.addStyleTag({ content: HIDE }); await sleep(1500);
    await p.screenshot({ path: `${OUT}/${name}.png` }); await p.evaluate((el) => el.remove(), tag);
    console.log('shot', name);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
