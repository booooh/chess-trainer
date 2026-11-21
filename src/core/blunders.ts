// Blunder warning (DESIGN §5.4): decides whether a move the user is about to play is a
// blunder, as typed facts. The narrator turns them into the warning text (ADR-0004).
import type { Piece } from './board';
import type { Engine, Score } from './engine';
import { moveFacts, scoreToCp } from './facts';
import { Game, type DrawReason, type Square, type Uci } from './game';
import { describeBlunder } from './narrator';

export type Blunder =
  /** After the move, the opponent has a forced mate in `inMoves`. */
  | { kind: 'allowsMate'; inMoves: number }
  /** The user had a forced mate in `inMoves` and this move gives it up. */
  | { kind: 'missesMate'; inMoves: number }
  /** The move ends the game in a draw although the user stood better. */
  | { kind: 'draws'; reason: DrawReason }
  /** The move leaves `piece` on `square` to be won, and loses `lossCp` versus the best move. */
  | { kind: 'hangs'; piece: Piece; square: Square; lossCp: number }
  /** The move loses `lossCp` versus the best move. */
  | { kind: 'loses'; lossCp: number };

export type AssessOptions = {
  /** Smallest loss versus the best move that counts as a blunder. Default 200 (two pawns). */
  lossThresholdCp?: number;
  /** Smallest loss at which a newly hanging piece counts. Default 100. */
  hangingLossCp?: number;
  /** Only warn about missing a mate this short, which a player can be expected to see. Default 3. */
  missedMateMaxMoves?: number;
};

/**
 * Scores beyond this are "winning" or "lost" whatever the number: going from +15 to +11
 * pawns is not a blunder worth interrupting for.
 */
const CAP_CP = 1000;
const capped = (cp: number) => Math.max(-CAP_CP, Math.min(CAP_CP, cp));

/**
 * Is playing `uci` in `fen` a blunder? `best` is the engine's score of `fen` (the mover's
 * view, i.e. what the best move achieves); `reply` is its score after the move, from the
 * opponent's view as Stockfish reports it, or null if the move ends the game.
 *
 * In order: allowing a forced mate, ending the game in a draw from a better position,
 * missing a short forced mate, leaving a piece to be won, then any big enough loss.
 */
export function assessMove(
  fen: string,
  uci: Uci,
  best: Score,
  reply: Score | null,
  { lossThresholdCp = 200, hangingLossCp = 100, missedMateMaxMoves = 3 }: AssessOptions = {},
): Blunder | null {
  const bestCp = capped(scoreToCp(best));

  if (reply === null) {
    const game = new Game(fen);
    game.play(uci);
    const status = game.status;
    if (status.kind !== 'draw') return null; // checkmate: the best possible move
    return bestCp >= lossThresholdCp ? { kind: 'draws', reason: status.reason } : null;
  }

  const alreadyMated = best.type === 'mate' && best.value <= 0;
  if (reply.type === 'mate' && reply.value > 0 && !alreadyMated) return { kind: 'allowsMate', inMoves: reply.value };

  const keepsMate = reply.type === 'mate' && reply.value <= 0;
  if (best.type === 'mate' && best.value > 0 && best.value <= missedMateMaxMoves && !keepsMate) {
    return { kind: 'missesMate', inMoves: best.value };
  }

  const lossCp = bestCp - capped(-scoreToCp(reply));
  const mover = new Game(fen).turn;
  if (lossCp >= hangingLossCp) {
    for (const f of moveFacts(fen, uci)) {
      if (f.kind === 'hanging' && f.piece.color === mover) return { kind: 'hangs', piece: f.piece, square: f.square, lossCp };
    }
  }
  return lossCp >= lossThresholdCp ? { kind: 'loses', lossCp } : null;
}

/** What the UI shows before a blunder is played. `square` marks the piece left hanging. */
export type MoveWarning = { text: string; square?: Square };

export type BlunderCheckerOptions = {
  /** Thinking time for the position before the move, spent while the user thinks. Default 1000. */
  prepareMs?: number;
  /** Thinking time after the move, while the user waits. Default 300. */
  replyMs?: number;
  /** Give up and let the move through after this long (e.g. Stockfish still starting). Default 5000. */
  timeoutMs?: number;
  assess?: AssessOptions;
};

/**
 * Checks the user's moves for blunders (DESIGN §5.4). To keep the wait short, `prepare`
 * analyses the position while it's the user's turn; `check` then only needs a short search
 * of the position after their move. It never blocks a move: if the engine fails or is too
 * slow, `check` says nothing.
 */
export class BlunderChecker {
  private prepared: { fen: string; abort: AbortController; best: Promise<Score | null> } | null = null;
  private readonly options: Required<Omit<BlunderCheckerOptions, 'assess'>> & { assess?: AssessOptions };

  constructor(
    private readonly engine: Engine,
    { prepareMs = 1000, replyMs = 300, timeoutMs = 5000, assess }: BlunderCheckerOptions = {},
  ) {
    this.options = { prepareMs, replyMs, timeoutMs, ...(assess ? { assess } : {}) };
  }

  /** Starts analysing `fen` (the position the user is to move in), dropping any other. */
  prepare(fen: string): void {
    if (this.prepared?.fen === fen) return;
    this.prepared?.abort.abort();
    const abort = new AbortController();
    const best = this.engine
      .analyse(fen, { multiPv: 1, movetimeMs: this.options.prepareMs }, abort.signal)
      .then((lines) => lines[0]?.score ?? null)
      .catch(() => null);
    this.prepared = { fen, abort, best };
  }

  /** A warning if playing `uci` in `fen` is a blunder, otherwise null. Never rejects. */
  async check(fen: string, uci: Uci, signal: AbortSignal): Promise<MoveWarning | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), this.options.timeoutMs)));
    try {
      return await Promise.race([this.assess(fen, uci, signal), timeout]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  dispose(): void {
    this.prepared?.abort.abort();
    this.prepared = null;
  }

  private async assess(fen: string, uci: Uci, signal: AbortSignal): Promise<MoveWarning | null> {
    this.prepare(fen);
    const best = await this.prepared!.best;
    if (!best || signal.aborted) return null;
    const game = new Game(fen);
    game.play(uci);
    const reply = game.isOver
      ? null
      : ((await this.engine.analyse(game.fen, { multiPv: 1, movetimeMs: this.options.replyMs }, signal))[0]?.score ?? null);
    if (!game.isOver && !reply) return null;
    const blunder = assessMove(fen, uci, best, reply, this.options.assess);
    if (!blunder) return null;
    return { text: describeBlunder(blunder), ...(blunder.kind === 'hangs' ? { square: blunder.square } : {}) };
  }
}
