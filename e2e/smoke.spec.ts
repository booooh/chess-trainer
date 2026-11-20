import { expect, test } from '@playwright/test';

test('shows the board in the starting position', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Chess Trainer' })).toBeVisible();
  const board = page.getByTestId('board');
  await expect(board).toBeVisible();
  await expect(board.locator('piece:not(.ghost)')).toHaveCount(32);

  // The board must be square and fit a phone screen without horizontal scrolling.
  const box = await board.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThanOrEqual(viewport!.width);
});

test('is installable: manifest with icons and an active service worker', async ({ page, request }) => {
  await page.goto('./');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, page.url()).toString());
    expect(res.ok(), `icon ${icon.src}`).toBe(true);
  }

  const swActive = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active !== null;
  });
  expect(swActive).toBe(true);
});
