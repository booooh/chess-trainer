import { describe, expect, it } from 'vitest';
import type { Engine, Line } from './engine';
import { Game, type Uci } from './game';
import { HintCoach } from './hints';
import type { HumanMovePredictor } from './opponent';
import type { HintLevel } from './records';

// Nc7+ forks the king on e8 and the queen on a6.
const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
const after = (fen: string, ...moves: Uci[]) => {
  const g = new Game(fen);
  for (const m of moves) g.play(m);
  return g.fen;
};
const line = (value: number, ...pv: Uci[]): Line => ({ move: pv[0]!, score: { type: 'cp', value }, pv, depth: 12 });

/** An engine whose answers the test releases by hand, to observe the "thinking" state. */
function heldEngine() {
  const waiting: (() => void)[] = [];
  const answers = new Map<string, Line[]>([
    [FORK, [line(650, 'b5c7', 'e8d7', 'c7a6')]],
    [after(FORK, 'b5c7', 'e8d7'), [line(700, 'c7a6', 'd7c6')]],
  ]);
  const engine: Engine = {
    analyse: (fen, _options, signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        waiting.push(() => resolve(answers.get(fen) ?? []));
      }),
  };
  const release = async () => {
    while (waiting.length) {
      waiting.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { engine, release, pending: () => waiting.length };
}

const predictor: HumanMovePredictor = {
  predict: async ({ fen }) =>
    new Map<Uci, number>(fen === after(FORK, 'b5c7') ? [['e8d7', 1]] : [['d7c6', 1]]),
};

function coach(engine: Engine, levels: HintLevel[] = []) {
  return new HintCoach(
    { engine, predictor },
    { userColor: 'white', userElo: 1100, opponentElo: 1100, onLevel: (l) => levels.push(l) },
  );
}

const position = { fen: FORK, moves: [] as Uci[] };

describe('HintCoach', () => {
  it('starts idle; the first press thinks, then shows the nudge', async () => {
    const { engine, release } = heldEngine();
    const levels: HintLevel[] = [];
    const c = coach(engine, levels);
    expect(c.state).toEqual({ status: 'idle' });

    const pressed = c.more(position);
    expect(c.state).toEqual({ status: 'thinking' });
    await release();
    await pressed;
    expect(c.state).toMatchObject({ status: 'shown', level: 1, text: { nudge: 'There’s a fork here.' } });
    expect(levels).toEqual([1]);
  });

  it('each further press reveals one more level, up to 4, without thinking again', async () => {
    const { engine, release, pending } = heldEngine();
    const levels: HintLevel[] = [];
    const c = coach(engine, levels);
    const first = c.more(position);
    await release();
    await first;
    for (let i = 0; i < 4; i++) await c.more(position);
    expect(pending()).toBe(0);
    expect(c.state).toMatchObject({ status: 'shown', level: 4 });
    expect(levels).toEqual([1, 2, 3, 4]);
    if (c.state.status === 'shown') expect(c.state.text.explanation[0]).toMatch(/fork/);
  });

  it('notifies subscribers on every change', async () => {
    const { engine, release } = heldEngine();
    const c = coach(engine);
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.state.status));
    const pressed = c.more(position);
    await release();
    await pressed;
    expect(seen).toEqual(['thinking', 'shown']);
  });

  it('ignores presses while thinking', async () => {
    const { engine, release, pending } = heldEngine();
    const c = coach(engine);
    const first = c.more(position);
    void c.more(position);
    expect(pending()).toBe(1);
    await release();
    await first;
    expect(c.state).toMatchObject({ level: 1 });
  });

  it('starts again from level 1 when the position changes', async () => {
    const { engine, release } = heldEngine();
    const c = coach(engine);
    const first = c.more(position);
    await release();
    await first;
    await c.more(position);
    expect(c.state).toMatchObject({ level: 2 });

    // A press in a different position starts a new hint.
    const elsewhere = { fen: after(FORK, 'b5c7', 'e8d7'), moves: ['b5c7', 'e8d7'] };
    const next = c.more(elsewhere);
    expect(c.state).toEqual({ status: 'thinking' });
    await release();
    await next;
    expect(c.state).toMatchObject({ status: 'shown', level: 1 });

    c.reset();
    expect(c.state).toEqual({ status: 'idle' });
  });

  it('drops an unfinished hint on reset, without reporting a failure', async () => {
    const { engine } = heldEngine();
    const c = coach(engine);
    const pressed = c.more(position);
    c.reset();
    await pressed;
    expect(c.state).toEqual({ status: 'idle' });
  });

  it('reports a failure, and tries again on the next press', async () => {
    let fail = true;
    const { engine: good, release } = heldEngine();
    const engine: Engine = {
      analyse: (fen, options, signal) => (fail ? Promise.reject(new Error('Stockfish didn’t start')) : good.analyse(fen, options, signal)),
    };
    const c = coach(engine);
    await c.more(position);
    expect(c.state).toEqual({ status: 'failed', message: 'Stockfish didn’t start' });
    fail = false;
    const again = c.more(position);
    await release();
    await again;
    expect(c.state).toMatchObject({ status: 'shown', level: 1 });
  });

  it('says so when there is nothing to teach', async () => {
    const engine: Engine = { analyse: async () => [] };
    const c = coach(engine);
    await c.more(position);
    expect(c.state).toEqual({ status: 'none' });
  });
});

describe('HintCoach.moveTo', () => {
  const next = { fen: after(FORK, 'e1d2'), moves: ['e1d2'] as Uci[] };

  it('hides the hint when the game moves on, and brings it back when it returns', async () => {
    const { engine, release } = heldEngine();
    const levels: HintLevel[] = [];
    const c = coach(engine, levels);
    c.moveTo(position);
    const first = c.more(position);
    await release();
    await first;
    await c.more(position);
    await c.more(position);
    expect(c.state).toMatchObject({ status: 'shown', level: 3 });

    c.moveTo(next);
    expect(c.state).toEqual({ status: 'idle' });
    c.moveTo(position); // e.g. "Go back" after "why not?"
    expect(c.state).toMatchObject({ status: 'shown', level: 3 });
    expect(levels).toEqual([1, 2, 3]); // restoring isn't a new hint
    await c.more(position);
    expect(c.state).toMatchObject({ status: 'shown', level: 4 });
  });

  it('keeps the same position as it is, and stops thinking for a position left behind', async () => {
    const { engine, release } = heldEngine();
    const c = coach(engine);
    c.moveTo(position);
    void c.more(position);
    c.moveTo(position);
    expect(c.state).toEqual({ status: 'thinking' });
    c.moveTo(next);
    await release();
    expect(c.state).toEqual({ status: 'idle' });
    c.moveTo(position);
    expect(c.state).toEqual({ status: 'idle' }); // nothing was shown there to bring back
  });
});
