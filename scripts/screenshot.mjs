import { chromium } from 'playwright';

const url = process.env.SHOT_URL ?? 'http://localhost:5174/game.html';
const out = process.env.SHOT_OUT ?? 'shot.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
