import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5174/game.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Click the REC button in the 3D scene (tape deck, right side of desk)
const rec = { x: 1032, y: 531 };
await page.mouse.click(rec.x, rec.y);
await page.waitForTimeout(400);
console.log('rec status after start:', await page.locator('#rec-status').textContent());

// Play a few notes via keyboard while recording
for (const key of ['a', 's', 'd', 'f']) {
  await page.keyboard.down(key);
  await page.waitForTimeout(180);
  await page.keyboard.up(key);
  await page.waitForTimeout(80);
}
await page.screenshot({ path: '/tmp/flow-1-recording.png' });

// Stop recording
await page.mouse.click(rec.x, rec.y);
await page.waitForTimeout(600);
console.log('rec status after stop:', await page.locator('#rec-status').textContent());
console.log('review bar visible:', await page.locator('#review-bar').isVisible());
await page.screenshot({ path: '/tmp/flow-2-review.png' });

// Delete the take
await page.locator('#review-delete').click();
await page.waitForTimeout(300);
console.log('review bar after delete:', await page.locator('#review-bar').isVisible());
console.log('dialogue:', await page.locator('#dialogue').textContent());

// Record again and submit this time
await page.mouse.click(rec.x, rec.y);
await page.waitForTimeout(300);
await page.keyboard.down('g');
await page.waitForTimeout(500);
await page.keyboard.up('g');
await page.mouse.click(rec.x, rec.y);
await page.waitForTimeout(600);
console.log('second take review bar:', await page.locator('#review-bar').isVisible());
await page.locator('#review-submit').click();
await page.waitForTimeout(1200);
console.log('after submit status:', await page.locator('#rec-status').textContent());
console.log('after submit dialogue:', await page.locator('#dialogue').textContent());
await page.screenshot({ path: '/tmp/flow-3-submitted.png' });

if (errors.length) {
  console.log('ERRORS:', errors.slice(0, 10).join('\n'));
} else {
  console.log('no page errors');
}
await browser.close();
