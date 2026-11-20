// Renders public/favicon.svg into the PNG icons the PWA manifest and iOS need.
// Run with: npx tsx scripts/render-icons.ts (needs a Playwright Chromium installed, or
// PW_CHROMIUM_PATH pointing at a Chromium binary).
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile('public/favicon.svg', 'utf8');
const outputs = [
  { file: 'public/pwa-192.png', size: 192, padding: 0 },
  { file: 'public/pwa-512.png', size: 512, padding: 0 },
  { file: 'public/apple-touch-icon.png', size: 180, padding: 0 },
  // Maskable icons get cropped to a circle or squircle by Android, so keep the art inside
  // the central 80% "safe zone".
  { file: 'public/pwa-512-maskable.png', size: 512, padding: 0.1 },
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage();
for (const { file, size, padding } of outputs) {
  const inner = Math.round(size * (1 - 2 * padding));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:#2b2622;display:grid;place-items:center;width:${size}px;height:${size}px">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
     </body>`,
  );
  await page.screenshot({ path: file, omitBackground: false });
  console.log(`wrote ${file}`);
}
await browser.close();
