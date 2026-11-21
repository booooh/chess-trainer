import { expect, test, type Page } from '@playwright/test';

// Phase 2b done-when (DESIGN §9): play a different move after a hint, read why it's worse,
// go back and play the hint's move. Real Stockfish and real Maia, in the production build.
// Nc7+ forks the king on e8 and the queen on a6; Kd2 leaves the knight to the queen.
const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';

async function move(page: Page, from: string, to: string) {
  const box = (await page.getByTestId('board').boundingBox())!;
  const size = box.width / 8;
  for (const square of [from, to]) {
    const col = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const row = 8 - Number(square[1]);
    await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
  }
}

test('after a hint, a worse move is explained; going back brings the hint back', async ({ page }) => {
  test.setTimeout(90_000); // first run downloads Maia and starts Stockfish
  await page.goto(`./?fen=${encodeURIComponent(FORK)}`);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('status')).toHaveText('Your move');

  await page.getByRole('button', { name: 'Hint' }).click();
  const hint = page.getByRole('region', { name: 'Hint' });
  await expect(hint).toContainText('There’s a fork here.', { timeout: 60_000 });

  const started = Date.now();
  await move(page, 'e1', 'd2');
  const why = page.getByRole('alertdialog', { name: 'Why not Kd2?' });
  await expect(why).toContainText('Nc7+ was better: it forks the king and the queen.', { timeout: 30_000 });
  test.info().annotations.push({ type: 'why-not time', description: `${Date.now() - started} ms` });
  await expect(page.getByRole('status')).toHaveText('There was a better move.');
  await expect(page.locator('[data-testid="board"] svg.cg-shapes line')).toHaveCount(1); // Nc7+ as an arrow

  await why.getByRole('button', { name: 'Go back' }).click();
  await expect(why).toHaveCount(0);
  await expect(hint).toContainText('There’s a fork here.');
  await expect(page.getByRole('list', { name: 'Moves' })).toBeEmpty();

  await move(page, 'b5', 'c7');
  await expect(page.getByRole('list', { name: 'Moves' })).toContainText(/^1\. Nc7\+ \S+/, { timeout: 30_000 });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
