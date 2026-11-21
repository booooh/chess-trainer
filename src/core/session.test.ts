import { describe, expect, it } from 'vitest';
import type { Uci } from './game';
import type { GameRecord } from './records';
import { GameSession, type Opponent } from './session';

/** An opponent that plays scripted moves, and lets the test decide when each reply arrives. */
function scriptedOpponent(...replies: Uci[]) {
  const asked: { fen: string; moves: readonly Uci[]; startFen?: string }[] = [];
  const pending: (() => void)[] = [];
  const opponent: Opponent = {
    elo: 1100,
    chooseMove(position) {
      asked.push({ fen: position.fen, moves: [...position.moves], ...(position.startFen ? { startFen: position.startFen } : {}) });
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

  it('exposes SAN moves for the move list, and promotion checks for the board', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    const done = session.playUserMove('e2e4');
    await reply();
    await done;
    expect(session.state.san).toEqual(['e4', 'e5']);
    expect(session.isPromotion('e4', 'e5')).toBe(false);
  });
});

describe('GameSession: starting position and hints', () => {
  const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';

  it('can start from a given position, and records it', async () => {
    const records: GameRecord[] = [];
    const { opponent } = scriptedOpponent();
    const session = new GameSession({ userColor: 'white', opponent, startFen: FORK, onFinished: (r) => void records.push(r) });
    expect(session.state.fen).toBe(FORK);
    session.resign();
    expect(records[0]).toMatchObject({ startFen: FORK, moves: [] });
    expect(records[0]!.pgn).toContain(`[FEN "${FORK}"]`);
  });

  it('tells the opponent which position the moves start from', async () => {
    const { opponent, asked } = scriptedOpponent('e8d7');
    const session = new GameSession({ userColor: 'white', opponent, startFen: FORK });
    void session.playUserMove('b5c7');
    expect(asked).toEqual([{ fen: '4k3/2N4p/q7/8/8/8/7P/4K3 b - - 1 1', moves: ['b5c7'], startFen: FORK }]);
  });

  it('leaves startFen out of the record for a normal game', () => {
    const records: GameRecord[] = [];
    const { opponent } = scriptedOpponent();
    const session = new GameSession({ userColor: 'white', opponent, onFinished: (r) => void records.push(r) });
    session.resign();
    expect(records[0]).not.toHaveProperty('startFen');
  });

  it('records the highest hint level used for each of the user’s moves', async () => {
    const records: GameRecord[] = [];
    const { opponent, reply } = scriptedOpponent('e7e5');
    const session = new GameSession({ userColor: 'white', opponent, onFinished: (r) => void records.push(r) });
    await session.start();
    session.noteHint(1);
    session.noteHint(3);
    session.noteHint(2); // going back down doesn't lower it
    const done = session.playUserMove('e2e4');
    await reply();
    await done;
    session.noteHint(4); // the user's second move is ply 2
    session.resign();
    expect(records[0]!.hintsUsed).toEqual([
      { ply: 0, level: 3 },
      { ply: 2, level: 4 },
    ]);
  });

  it("ignores hints when it isn't the user's turn", async () => {
    const records: GameRecord[] = [];
    const { opponent } = scriptedOpponent('d2d4');
    const session = new GameSession({ userColor: 'black', opponent, onFinished: (r) => void records.push(r) });
    void session.start(); // the opponent is thinking
    session.noteHint(2);
    session.resign();
    expect(records[0]!.hintsUsed).toEqual([]);
  });
});

describe('GameSession: taking moves back', () => {
  /** Plays the user's move and lets the scripted opponent reply. */
  async function exchange(session: GameSession, reply: () => Promise<void>, uci: Uci) {
    const done = session.playUserMove(uci);
    await reply();
    await done;
  }

  it('on your turn, takes back your move and the reply, so it is your turn again', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5', 'b8c6');
    const session = new GameSession({ userColor: 'white', opponent });
    await session.start();
    expect(session.state.canTakeBack).toBe(false);
    await exchange(session, reply, 'e2e4');
    await exchange(session, reply, 'g1f3');
    expect(session.state.canTakeBack).toBe(true);

    session.takeBack();
    expect(session.state).toMatchObject({ moves: ['e2e4', 'e7e5'], turn: 'white', thinking: false });
    expect(session.state.dests.get('g1')).toBeDefined();
    session.takeBack();
    expect(session.state).toMatchObject({ moves: [], turn: 'white', canTakeBack: false });
    session.takeBack(); // nothing left: no-op
    expect(session.state.moves).toEqual([]);
  });

  it("while the opponent thinks, takes back your move and ignores the reply when it comes", async () => {
    const { opponent, asked, reply } = scriptedOpponent('e7e5', 'c7c5');
    const signals: AbortSignal[] = [];
    const watching: Opponent = { elo: 1100, chooseMove: (p, signal) => (signals.push(signal!), opponent.chooseMove(p, signal)) };
    const s2 = new GameSession({ userColor: 'white', opponent: watching });
    const done = s2.playUserMove('e2e4');
    expect(s2.state).toMatchObject({ thinking: true, canTakeBack: true });
    s2.takeBack();
    expect(signals[0]!.aborted).toBe(true);
    expect(s2.state).toMatchObject({ moves: [], thinking: false, turn: 'white' });
    await reply(); // the cancelled request answers anyway
    await done;
    expect(s2.state.moves).toEqual([]);

    // The game carries on normally afterwards.
    await exchange(s2, reply, 'd2d4');
    expect(s2.state.moves).toEqual(['d2d4', 'c7c5']);
    expect(asked.map((a) => a.moves)).toEqual([['e2e4'], ['d2d4']]);
  });

  it('after the opponent failed to move, takes back your move and clears the error', async () => {
    const opponent: Opponent = { elo: 1100, chooseMove: () => Promise.reject(new Error('worker crashed')) };
    const session = new GameSession({ userColor: 'white', opponent });
    await session.playUserMove('e2e4');
    session.takeBack();
    expect(session.state).toMatchObject({ moves: [], error: undefined, thinking: false });
  });

  it("as black, never takes back the opponent's first move on its own", async () => {
    const { opponent, reply } = scriptedOpponent('e2e4', 'd2d4');
    const session = new GameSession({ userColor: 'black', opponent });
    const started = session.start();
    expect(session.state.canTakeBack).toBe(false); // the opponent's first move is pending
    await reply();
    await started;
    expect(session.state.canTakeBack).toBe(false);
    await exchange(session, reply, 'e7e5');
    session.takeBack();
    expect(session.state).toMatchObject({ moves: ['e2e4'], turn: 'black' });
  });

  it('cannot take back once the game is over', async () => {
    const { opponent, reply } = scriptedOpponent('e7e5', 'd8h4');
    const session = new GameSession({ userColor: 'white', opponent });
    await exchange(session, reply, 'f2f3');
    await exchange(session, reply, 'g2g4');
    expect(session.state.status.kind).toBe('checkmate');
    expect(session.state.canTakeBack).toBe(false);
    session.takeBack();
    expect(session.state.moves).toHaveLength(4);
  });

  it('drops hints for the moves taken back, and counts take-backs in the record', async () => {
    const records: GameRecord[] = [];
    const { opponent, reply } = scriptedOpponent('e7e5', 'b8c6', 'g8f6');
    const session = new GameSession({ userColor: 'white', opponent, onFinished: (r) => void records.push(r) });
    session.noteHint(2);
    await exchange(session, reply, 'e2e4');
    session.noteHint(4);
    await exchange(session, reply, 'g1f3');
    session.takeBack(); // drops the level-4 hint for ply 2
    await exchange(session, reply, 'f1c4');
    session.resign();
    expect(records[0]).toMatchObject({
      moves: ['e2e4', 'e7e5', 'f1c4', 'g8f6'],
      hintsUsed: [{ ply: 0, level: 2 }],
      takebacks: 1,
    });
  });

  it('leaves takebacks out of the record when there were none', () => {
    const records: GameRecord[] = [];
    const { opponent } = scriptedOpponent();
    const session = new GameSession({ userColor: 'white', opponent, onFinished: (r) => void records.push(r) });
    session.resign();
    expect(records[0]).not.toHaveProperty('takebacks');
  });
});
