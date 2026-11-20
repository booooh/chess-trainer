import { describe, expect, it } from 'vitest';
import type { Uci } from './game';
import type { GameRecord } from './records';
import { GameSession, type Opponent } from './session';

/** An opponent that plays scripted moves, and lets the test decide when each reply arrives. */
function scriptedOpponent(...replies: Uci[]) {
  const asked: { fen: string; moves: readonly Uci[] }[] = [];
  const pending: (() => void)[] = [];
  const opponent: Opponent = {
    elo: 1100,
    chooseMove(position) {
      asked.push({ fen: position.fen, moves: [...position.moves] });
      const reply = replies.shift();
      if (!reply) return Promise.reject(new Error('no scripted reply left'));
      return new Promise((resolve) => pending.push(() => resolve(reply)));
    },
  };
  /** Delivers the oldest pending reply and lets the session process it. */
  const reply = async () => {
    pending.shift()?.();
    await new Promise((r) => setTimeout(r, 0)); // let the session handle it
  };
  return { opponent, asked, reply };
}

const fixedClock = () => new Date('2026-11-20T10:00:00Z');
const ids = () => 'game-1';

describe('GameSession', () => {
  it('as white, lets the user move first and then gets the opponent reply', async () => {
    const { opponent, asked, reply } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    expect(session.state).toMatchObject({ turn: 'white', thinking: false, moves: [] });
    expect(session.state.dests.get('e2')).toBeDefined();

    const done = session.playUserMove('e2e4');
    expect(session.state).toMatchObject({ moves: ['e2e4'], thinking: true });
    expect(session.state.dests.size).toBe(0); // user can't move while the opponent thinks
    expect(asked).toEqual([{ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', moves: ['e2e4'] }]);

    await reply();
    await done;
    expect(session.state).toMatchObject({ moves: ['e2e4', 'e7e5'], thinking: false, turn: 'white', lastMove: ['e7', 'e5'] });
  });

  it('as black, the opponent moves first', async () => {
    const { opponent, reply } = scriptedOpponent('d2d4');
    const session = new GameSession({ userColor: 'black', opponent });
    const started = session.start();
    expect(session.state.thinking).toBe(true);
    await reply();
    await started;
    expect(session.state).toMatchObject({ moves: ['d2d4'], turn: 'black', thinking: false });
  });

  it("rejects moves when it isn't the user's turn, and illegal moves", async () => {
    const { opponent } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    await expect(session.playUserMove('e2e5')).rejects.toThrow(/illegal/);
    void session.playUserMove('e2e4');
    await expect(session.playUserMove('d2d4')).rejects.toThrow(/not your turn/);
    expect(session.state.moves).toEqual(['e2e4']);
  });

  it('notifies subscribers on every change', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent });
    const seen: number[] = [];
    const unsubscribe = session.subscribe(() => seen.push(session.state.moves.length));
    await session.start();
    const done = session.playUserMove('e2e4');
    await reply();
    await done;
    unsubscribe();
    expect(seen).toContain(1);
    expect(seen.at(-1)).toBe(2);
  });

  it('saves a game record once when the game ends by checkmate', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5', 'd8h4');
    const saved: GameRecord[] = [];
    const session = new GameSession({
      userColor: 'white',
      opponent,
      onFinished: (r) => void saved.push(r),
      now: fixedClock,
      newId: ids,
    });
    await session.start();
    for (const mine of ['f2f3', 'g2g4']) {
      const p = session.playUserMove(mine);
      await reply();
      await p;
    }
    expect(session.state.status).toEqual({ kind: 'checkmate', winner: 'black' });
    expect(session.state.dests.size).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: 'game-1',
      startedAt: '2026-11-20T10:00:00.000Z',
      userColor: 'white',
      opponent: { engine: 'maia3', elo: 1100 },
      result: '0-1',
      moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
      hintsUsed: [],
      schemaVersion: 1,
    });
    expect(saved[0]!.pgn).toContain('[Black "Maia 1100"]');
    expect(saved[0]!.pgn).toMatch(/Qh4# 0-1$/);
  });

  it('lets the user resign, ending the game and saving it', async () => {
    const { opponent } = scriptedOpponent();
    const saved: GameRecord[] = [];
    const session = new GameSession({ userColor: 'black', opponent: { ...opponent, chooseMove: async () => 'e2e4' }, onFinished: (r) => void saved.push(r) });
    await session.start();
    session.resign();
    expect(session.state.status).toEqual({ kind: 'resigned', winner: 'white' });
    expect(saved.map((r) => r.result)).toEqual(['1-0']);
    session.resign();
    expect(saved).toHaveLength(1);
  });

  it('ignores a late opponent reply after being disposed', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    const done = session.playUserMove('e2e4');
    session.dispose();
    await reply();
    await done;
    expect(session.state.moves).toEqual(['e2e4']);
  });

  it('reports opponent failures and can retry', async () => {
    let fail = true;
    const opponent: Opponent = { elo: 1100, chooseMove: async () => (fail ? Promise.reject(new Error('worker crashed')) : 'e7e5') };
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    await session.playUserMove('e2e4');
    expect(session.state).toMatchObject({ thinking: false, error: 'worker crashed' });
    fail = false;
    await session.retryOpponent();
    expect(session.state).toMatchObject({ moves: ['e2e4', 'e7e5'], error: undefined });
  });
});
