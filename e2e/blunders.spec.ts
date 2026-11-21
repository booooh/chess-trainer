import { expect, test, type Page } from '@playwright/test';

// Phase 2b blunder warning, with real Stockfish and real Maia in the production build.
// Qd5?? walks the queen into the pawn on e6.
const QUEEN = '4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1';

async function tap(page: Page, square: string) {
  const box = (await page.getByTestId('board').boundingBox())!;
  const size = box.width / 8;
  const col = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - Number(square[1]);
  await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
}

test('the blunder warning holds back a hanging queen; after taking it back, a safe move goes straight through', async ({ page }) => {
  test.setTimeout(90_000); // first run downloads Maia and starts Stockfish
  await page.goto(`./?fen=${encodeURIComponent(QUEEN)}`);
  await page.getByRole('checkbox', { name: /warn me before a blunder/i }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('status')).toHaveText('Your move');

  const moves = page.getByRole('list', { name: 'Moves' });
  const warning = page.getByRole('alertdialog', { name: 'Are you sure?' });
  const circles = page.locator('[data-testid="board"] svg.cg-shapes circle');

  const started = Date.now();
  await tap(page, 'd1');
  await tap(page, 'd5');
  await expect(warning).toContainText('This leaves your queen on d5 to be taken.', { timeout: 30_000 });
  test.info().annotations.push({ type: 'check time (incl. Stockfish start-up)', description: `${Date.now() - started} ms` });
  await expect(circles).toHaveCount(1);

  await warning.getByRole('button', { name: 'Take it back' }).click();
  await expect(warning).toHaveCount(0);
  await expect(moves).toBeEmpty();
  await expect(page.getByRole('status')).toHaveText('Your move');
  await expect(circles).toHaveCount(0);

  // A safe move goes straight through, and Maia answers.
  await tap(page, 'd1');
  await tap(page, 'd2');
  await expect(moves).toContainText(/^1\. Qd2 \S+/, { timeout: 30_000 });
  await expect(warning).toHaveCount(0);
});

test('"Play anyway" plays the blunder and Maia replies', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`./?fen=${encodeURIComponent(QUEEN)}`);
  await page.getByRole('checkbox', { name: /warn me before a blunder/i }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('status')).toHaveText('Your move');

  await tap(page, 'd1');
  await tap(page, 'd5');
  const warning = page.getByRole('alertdialog', { name: 'Are you sure?' });
  await warning.getByRole('button', { name: 'Play anyway' }).click({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Moves' })).toContainText(/^1\. Qd5 \S+/, { timeout: 30_000 });
});
