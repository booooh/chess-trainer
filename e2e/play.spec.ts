import { expect, test, type Page } from '@playwright/test';

/** Taps a square on the board (chessground supports tap-to-select, tap-to-move). */
async function tap(page: Page, square: string, orientation: 'white' | 'black' = 'white') {
  const box = (await page.getByTestId('board').boundingBox())!;
  const size = box.width / 8;
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
}

async function move(page: Page, from: string, to: string) {
  await tap(page, from);
  await tap(page, to);
}

const status = (page: Page) => page.getByRole('status');
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' });

test('play a few moves as white against the real Maia', async ({ page }) => {
  test.setTimeout(90_000); // first run downloads and compiles the model
  await page.goto('./');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(status(page)).toHaveText('Your move');

  await move(page, 'e2', 'e4');
  await expect(moves(page)).toContainText(/^1\. e4 \S+/, { timeout: 60_000 });
  await expect(status(page)).toHaveText('Your move');

  // Nf3 is legal whatever Black replied to 1.e4.
  await move(page, 'g1', 'f3');
  await expect(moves(page)).toContainText(/2\. Nf3 \S+/, { timeout: 30_000 });
  await expect(status(page)).toHaveText('Your move');
});

test('as black, Maia opens; resigning saves the game to IndexedDB', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await page.getByRole('radio', { name: 'Black' }).check({ force: true });
  await page.getByRole('combobox', { name: /opponent strength/i }).selectOption('600');
  await page.getByRole('button', { name: 'Start game' }).click();

  await expect(moves(page)).toContainText(/^1\. \S+$/, { timeout: 60_000 });
  await expect(status(page)).toHaveText('Your move');
  await expect(page.getByText('You (black) vs Maia 600')).toBeVisible();

  await page.getByRole('button', { name: 'Resign' }).click();
  await page.getByRole('button', { name: 'Confirm resign' }).click();
  await expect(status(page)).toHaveText('You resigned. Maia wins.');

  const saved = await page.evaluate(
    () =>
      new Promise<{ result: string; userColor: string; elo: number }[]>((resolve, reject) => {
        const open = indexedDB.open('chess-trainer');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('games').objectStore('games').getAll();
          req.onsuccess = () =>
            resolve(req.result.map((g) => ({ result: g.result, userColor: g.userColor, elo: g.opponent.elo })));
        };
      }),
  );
  expect(saved).toEqual([{ result: '1-0', userColor: 'black', elo: 600 }]);

  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('form', { name: 'New game' })).toBeVisible();
});
