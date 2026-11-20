// Runs spike-maia.html in headless Chromium (emulated Pixel 7) at several CPU throttling
// rates and prints what the page reports. Desktop CPU throttling is only a rough stand-in
// for a phone, so the real numbers come from opening the page on the phone itself.
//
// Run: npm run build && npx tsx spikes/maia/browser-bench.ts
import { spawn } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const PORT = 4175;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
try {
  for (const rate of [1, 4]) {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`http://localhost:${PORT}/spike-maia.html`);
    await page.locator('#done').waitFor({ timeout: 300_000 });
    const text = await page.locator('#out').innerText();
    console.log(`\n=== CPU throttling ${rate}x ===\n${text.replace(/\n\s*\n/g, '\n')}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
