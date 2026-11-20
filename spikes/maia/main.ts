// Spike page: how fast is Maia-3 in this browser? Open it on the phone you care about.
import { Chess } from 'chess.js';
import type { Request, Response } from './maia.worker';

const out = document.getElementById('out')!;
const log = (html: string) => out.insertAdjacentHTML('beforeend', html);

const worker = new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' });
function call(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<Response>) =>
      e.data.type === 'error' ? reject(new Error(e.data.message)) : resolve(e.data);
    worker.postMessage(req);
  });
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

async function selfPlay(elo: number, plies: number, topK: number) {
  const game = new Chess();
  const moves: string[] = [];
  const times: number[] = [];
  while (!game.isGameOver() && moves.length < plies) {
    const r = await call({ type: 'predict', fen: game.fen(), priorMoves: moves, elo, topK });
    if (r.type !== 'predicted') throw new Error('unexpected reply');
    times.push(r.ms);
    game.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] });
    moves.push(r.move);
  }
  return { times, pgn: game.pgn() };
}

async function run() {
  log(
    `<p class="meta">${navigator.userAgent}<br>cores: ${navigator.hardwareConcurrency} · ` +
      `crossOriginIsolated: ${self.crossOriginIsolated}</p>`,
  );
  log('<p>Loading model…</p>');
  const loaded = await call({ type: 'load' });
  if (loaded.type !== 'loaded') throw new Error('unexpected reply');
  log(
    `<p>Model ${(loaded.bytes / 1e6).toFixed(1)} MB ${loaded.fromCache ? 'from cache' : 'downloaded'} in ` +
      `${loaded.downloadMs.toFixed(0)} ms; ONNX session created in ${loaded.sessionMs.toFixed(0)} ms.</p>`,
  );

  const rows: string[] = [];
  for (const [label, topK] of [
    ['Opponent move (policy only, topK 0)', 0],
    ['With 5 candidate evaluations (topK 5)', 5],
  ] as const) {
    log(`<p>Running: ${label}…</p>`);
    const { times, pgn } = await selfPlay(1100, 40, topK);
    const [first, ...rest] = times;
    rows.push(
      `<tr><td>${label}</td><td>${times.length}</td><td>${first!.toFixed(0)}</td>` +
        `<td>${pct(rest, 0.5).toFixed(0)}</td><td>${pct(rest, 0.9).toFixed(0)}</td><td>${Math.max(...rest).toFixed(0)}</td></tr>`,
    );
    if (topK === 0) log(`<details><summary>Sample game (Maia 1100 vs itself)</summary><pre>${pgn}</pre></details>`);
  }
  log(
    '<table><thead><tr><th>Call</th><th>Moves</th><th>First ms</th><th>Median ms</th><th>p90 ms</th><th>Max ms</th></tr></thead>' +
      `<tbody>${rows.join('')}</tbody></table><p id="done">Done.</p>`,
  );
}

run().catch((err) => log(`<p class="err" id="done">Error: ${err instanceof Error ? err.message : err}</p>`));
