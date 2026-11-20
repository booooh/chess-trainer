// Spike (phase 1): does Maia-3 play measurably weaker at lower ratings?
//
// Maia plays itself at several ratings, sampling moves the way the real opponent will.
// Stockfish scores every position; we report each rating's average centipawn loss (ACPL)
// and how often a move throws away ≥100 / ≥300 centipawns.
//
// Run: npx tsx spikes/maia/strength.ts [gamesPerElo=8] [depth=10]
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { Maia3 } from 'maia3-js';

const require = createRequire(import.meta.url);
type Engine = { processCommand(cmd: string): void; listener?: (line: string) => void; terminate(): void };
const initEngine = require('stockfish') as (flavor: string) => Engine;

const ELOS = [400, 600, 800, 1100, 1500, 1900];
const GAMES = Number(process.argv[2] ?? 8);
const DEPTH = Number(process.argv[3] ?? 10);
const MAX_PLIES = 100;
const CAP = 1000; // clamp evals so one missed mate doesn't dominate the average

// --- tiny promise wrapper around UCI -------------------------------------------------
const sf = initEngine('lite-single');
let waiter: ((line: string) => boolean) | null = null;
sf.listener = (line) => {
  if (waiter && waiter(line)) waiter = null;
};
function until(pred: (line: string) => boolean, send: string[]): Promise<void> {
  return new Promise((resolve) => {
    waiter = (line) => (pred(line) ? (resolve(), true) : false);
    for (const c of send) sf.processCommand(c);
  });
}
await until((l) => l === 'uciok', ['uci']);
await until((l) => l === 'readyok', ['setoption name Hash value 32', 'isready']);

/** Eval from the side to move's point of view, in centipawns, clamped to ±CAP. */
async function evaluate(fen: string): Promise<number> {
  let score = 0;
  await new Promise<void>((resolve) => {
    waiter = (line) => {
      const m = line.match(/ score (cp|mate) (-?\d+)/);
      if (m) score = m[1] === 'cp' ? Number(m[2]) : Math.sign(Number(m[2])) * CAP;
      if (line.startsWith('bestmove')) {
        resolve();
        return true;
      }
      return false;
    };
    sf.processCommand(`position fen ${fen}`);
    sf.processCommand(`go depth ${DEPTH}`);
  });
  return Math.max(-CAP, Math.min(CAP, score));
}

/** Eval of a finished position from the side to move's point of view. */
function terminalEval(game: Chess): number {
  return game.isCheckmate() ? -CAP : 0;
}

// --- self-play -------------------------------------------------------------------------
const maia = new Maia3({ variant: '5m', temperature: 1, topK: 0 });
await maia.load();

type Stats = { moves: number; loss: number; mistakes: number; blunders: number; plies: number[]; ms: number };
const results: Record<number, Stats> = {};

for (const elo of ELOS) {
  const s: Stats = { moves: 0, loss: 0, mistakes: 0, blunders: 0, plies: [], ms: 0 };
  for (let g = 0; g < GAMES; g++) {
    const game = new Chess();
    const history: string[] = [];
    let before = await evaluate(game.fen());
    while (!game.isGameOver() && history.length < MAX_PLIES) {
      const t0 = performance.now();
      const r = await maia.predict({ fen: game.fen(), selfElo: elo, priorMoves: history });
      s.ms += performance.now() - t0;
      const uci = r.bestMove;
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      history.push(uci);
      const after = game.isGameOver() ? terminalEval(game) : await evaluate(game.fen());
      // `after` is from the opponent's view; the mover's loss is how much their eval dropped.
      const loss = Math.max(0, before - -after);
      s.moves++;
      s.loss += loss;
      if (loss >= 100) s.mistakes++;
      if (loss >= 300) s.blunders++;
      before = after;
    }
    s.plies.push(history.length);
    process.stderr.write(`elo ${elo} game ${g + 1}/${GAMES}: ${history.length} plies\n`);
  }
  results[elo] = s;
}

console.log(`\nMaia-3 5M self-play, ${GAMES} games per rating, Stockfish lite depth ${DEPTH}\n`);
console.log('| Rating | Moves | ACPL | ≥100cp per 100 moves | ≥300cp per 100 moves | Maia ms/move (Node) |');
console.log('|---:|---:|---:|---:|---:|---:|');
for (const elo of ELOS) {
  const s = results[elo]!;
  console.log(
    `| ${elo} | ${s.moves} | ${(s.loss / s.moves).toFixed(0)} | ${((100 * s.mistakes) / s.moves).toFixed(1)} | ${((100 * s.blunders) / s.moves).toFixed(1)} | ${(s.ms / s.moves).toFixed(1)} |`,
  );
}
sf.terminate();
await maia.close();
