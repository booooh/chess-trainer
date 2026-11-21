import { expect, test, type Page } from '@playwright/test';

// Phase 2 done-when (DESIGN §9): a level-4 hint explains a fork correctly. Real Stockfish and
// real Maia, in the production build. Nc7+ forks the king on e8 and the queen on a6.
const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';

async function tap(page: Page, square: string) {
  const box = (await page.getByTestId('board').boundingBox())!;
  const size = box.width / 8;
  const col = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - Number(square[1]);
  await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
}

test('a level-4 hint finds and explains the fork, then goes away once you move', async ({ page }) => {
  test.setTimeout(90_000); // first run downloads Maia and starts Stockfish
  await page.goto(`./?fen=${encodeURIComponent(FORK)}`);
  // Like a returning visit on the phone: the service worker controls the page, so the app's
  // files (Stockfish's script included) come from its cache.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('status')).toHaveText('Your move');

  const started = Date.now();
  await page.getByRole('button', { name: 'Hint' }).click();
  const hint = page.getByRole('region', { name: 'Hint' });
  await expect(hint).toContainText('There’s a fork here.', { timeout: 60_000 });
  test.info().annotations.push({ type: 'hint time', description: `${Date.now() - started} ms` });

  const shapes = page.locator('[data-testid="board"] svg.cg-shapes');
  await page.getByRole('button', { name: 'More help' }).click();
  await expect(hint).toContainText('Look at your knight on b5.');
  await expect(shapes.locator('circle')).toHaveCount(1);

  await page.getByRole('button', { name: 'More help' }).click();
  await expect(hint).toContainText('Play Nc7+.');
  await expect(shapes.locator('line')).toHaveCount(1); // the arrow

  await page.getByRole('button', { name: 'More help' }).click();
  const explanation = hint.getByRole('list', { name: 'Explanation' });
  await expect(explanation).toContainText('Nc7+ is a fork: the knight attacks the king and the queen at the same time.');
  await expect(explanation).toContainText(/wins the queen/);

  await tap(page, 'b5');
  await tap(page, 'c7');
  await expect(page.getByRole('list', { name: 'Moves' })).toContainText('1. Nc7+');
  await expect(hint).toHaveCount(0);
  await expect(shapes.locator('line, circle')).toHaveCount(0);
});
