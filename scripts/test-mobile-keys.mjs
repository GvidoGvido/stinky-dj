import { chromium, devices } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5174/game.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

console.log('touch keys visible on mobile:', await page.locator('#touch-keys').isVisible());
await page.screenshot({ path: '/tmp/mobile-keys.png' });

// Tap a white key and a bass key
const white = page.locator('.tk-white').nth(2);
await white.tap();
await page.waitForTimeout(150);
const bass = page.locator('.tk-bass-key').nth(4);
await bass.tap();
await page.waitForTimeout(150);

// Octave shift
await page.locator('[data-tk="oct-up"]').tap();
console.log('octave label after up:', await page.locator('.tk-oct-label').textContent());

// Toggle off and on
await page.locator('#keys-toggle').tap();
console.log('visible after toggle off:', await page.locator('#touch-keys').isVisible());
await page.locator('#keys-toggle').tap();
console.log('visible after toggle on:', await page.locator('#touch-keys').isVisible());

console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
