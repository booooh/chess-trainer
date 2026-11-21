import { Game, type Color, type GameStatus, type GameResult, type Square, type Uci } from './game';
import type { MoveWarning } from './blunders';
import type { GameRecord, HintLevel } from './records';

/** Anything that can pick a move for the computer side (MaiaOpponent, or a fake in tests). */
export interface Opponent {
  readonly elo: number;
  /** `startFen` is set when the game started from a position other than the usual one. */
  chooseMove(position: { fen: string; moves: readonly Uci[]; startFen?: string }, signal?: AbortSignal): Promise<Uci>;
}

/**
 * Looks at the user's moves before they're final (the blunder warning, DESIGN §5.4).
 * Implemented by `BlunderChecker`; tests use fakes.
 */
export interface MoveChecker {
  /** Called whenever it's the user's turn, so the position can be analysed ahead. */
  prepare(fen: string): void;
  /** A warning if `uci` played in `fen` is a blunder, otherwise null. Should never reject. */
  check(fen: string, uci: Uci, signal: AbortSignal): Promise<MoveWarning | null>;
}

/**
 * The user's last move, waiting for the checker: being checked, or held back with a warning
 * until they choose `playAnyway()` or `reconsider()`.
 */
export type MoveReview = { status: 'checking' } | { status: 'warning'; warning: MoveWarning };

export type SessionState = {
  fen: string;
  turn: Color;
  userColor: Color;
  moves: readonly Uci[];
  /** The same moves in algebraic notation, for the move list. */
  san: readonly string[];
  lastMove: [Square, Square] | undefined;
  inCheck: boolean;
  /** Where the user may move right now; empty while the opponent thinks or after the game. */
  dests: ReadonlyMap<Square, Square[]>;
  status: GameStatus;
  result: GameResult;
  /** True while waiting for the opponent's move. */
  thinking: boolean;
  /** Set when the opponent failed to move; `retryOpponent()` tries again. */
  error: string | undefined;
  /** True if `takeBack()` would do something: the game is on and the user has moved. */
  canTakeBack: boolean;
  /** Set while the user's last move is being checked or is held back with a warning. */
  review: MoveReview | undefined;
};

export type SessionOptions = {
  userColor: Color;
  opponent: Opponent;
  /** Start from this position instead of the usual one (e.g. a practice position). */
  startFen?: string;
  /** Checks the user's moves before the opponent replies (the blunder warning, if turned on). */
  moveChecker?: MoveChecker;
  /** Called once when the game ends, with the record to store. */
  onFinished?: (record: GameRecord) => void | Promise<void>;
  now?: () => Date;
  newId?: () => string;
};

/**
 * One game between the user and a computer opponent: whose turn it is, asking the opponent
 * for moves, and producing the game record at the end. The UI subscribes to `state`.
 */
export class GameSession {
  private readonly game: Game;
  /** Highest hint level used for each of the user's moves, by ply (index into the moves). */
  private readonly hints = new Map<number, HintLevel>();
  private readonly listeners = new Set<() => void>();
  /** Cancels the opponent request in flight, if any (take-back, resign, dispose). */
  private pending: AbortController | undefined;
  private readonly startedAt: Date;
  /** Who moved first, which tells whose each ply is. */
  private readonly firstToMove: Color;
  private takebacks = 0;
  private review: MoveReview | undefined;
  /** Cancels the move check in flight, if any. */
  private reviewAbort: AbortController | undefined;
  private thinking = false;
  private error: string | undefined;
  private finished = false;
  private snapshot: SessionState;

  constructor(private readonly options: SessionOptions) {
    this.game = new Game(options.startFen);
    this.firstToMove = this.game.turn;
    this.startedAt = (options.now ?? (() => new Date()))();
    this.snapshot = this.buildState();
  }

  get state(): SessionState {
    return this.snapshot;
  }

  /** An arrow property, so it can be passed around unbound (e.g. to useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starts the game; if the opponent has white, waits for its first move. */
  async start(): Promise<void> {
    this.prepareCheck();
    if (this.isOpponentsTurn()) await this.opponentMove();
  }

  /**
   * Plays the user's move, then waits for the opponent's reply. With a move checker, the
   * move is checked first; a blunder is held back (resolving without a reply) until the
   * user chooses `playAnyway()` or `reconsider()`.
   */
  async playUserMove(uci: Uci): Promise<void> {
    if (this.thinking || this.review || this.game.turn !== this.options.userColor) {
      throw new Error(`not your turn: ${uci}`);
    }
    const fenBefore = this.game.fen;
    this.game.play(uci); // throws IllegalMoveError, leaving everything unchanged
    const checker = this.options.moveChecker;
    if (checker) {
      const abort = new AbortController();
      this.reviewAbort = abort;
      this.review = { status: 'checking' };
      this.changed();
      const warning = await checker.check(fenBefore, uci, abort.signal);
      if (abort.signal.aborted) return; // resigned or disposed meanwhile
      this.reviewAbort = undefined;
      if (warning) {
        this.review = { status: 'warning', warning };
        this.changed();
        return;
      }
      this.review = undefined;
    }
    this.changed();
    if (this.isOpponentsTurn()) await this.opponentMove();
  }

  /** Plays the move the checker warned about, then waits for the opponent's reply. */
  async playAnyway(): Promise<void> {
    if (this.review?.status !== 'warning') return;
    this.review = undefined;
    this.changed();
    if (this.isOpponentsTurn()) await this.opponentMove();
  }

  /** Takes back the move the checker warned about, so the user can choose another. */
  reconsider(): void {
    if (this.review?.status !== 'warning') return;
    this.review = undefined;
    this.game.undo();
    this.changed();
  }

  /** True if from → to is a pawn promotion, so the UI must ask which piece. */
  isPromotion(from: Square, to: Square): boolean {
    return this.game.isPromotion(from, to);
  }

  /** Tries the opponent's move again after an error. */
  async retryOpponent(): Promise<void> {
    if (this.isOpponentsTurn() && !this.thinking) await this.opponentMove();
  }

  /**
   * Notes that the user looked at a hint of this level for the move they're about to play.
   * Only the highest level per move is kept (DESIGN §5.1). Ignored when it isn't their turn.
   */
  noteHint(level: HintLevel): void {
    if (this.thinking || this.isOpponentsTurn() || this.game.isOver) return;
    const ply = this.game.moves.length;
    this.hints.set(ply, Math.max(level, this.hints.get(ply) ?? 0) as HintLevel);
  }

  /**
   * Takes back moves so it is the user's turn one move earlier: their last move and the
   * opponent's reply, or only their move if the reply hasn't come (it is cancelled) or
   * failed. Hints for those moves are forgotten. Does nothing once the game is over: by
   * then the record is saved, and records never change.
   */
  takeBack(): void {
    if (!this.canTakeBack()) return;
    this.cancelPending();
    this.thinking = false;
    this.error = undefined;
    do this.game.undo();
    while (this.game.turn !== this.options.userColor);
    for (const ply of this.hints.keys()) if (ply >= this.game.moves.length) this.hints.delete(ply);
    this.takebacks++;
    this.changed();
  }

  resign(): void {
    if (this.review) this.dropReview();
    if (this.game.isOver) return;
    this.game.resign(this.options.userColor);
    this.cancelPending();
    this.thinking = false;
    this.changed();
  }

  /** Stops listening for the opponent (e.g. the user left the game screen). */
  dispose(): void {
    this.cancelPending();
    this.reviewAbort?.abort();
    this.listeners.clear();
  }

  /** Forgets the move under review, as if it was never played. */
  private dropReview(): void {
    this.reviewAbort?.abort();
    this.reviewAbort = undefined;
    this.review = undefined;
    this.game.undo();
  }

  private prepareCheck(): void {
    if (this.userCanMove()) this.options.moveChecker?.prepare(this.game.fen);
  }

  private userCanMove(): boolean {
    return !this.thinking && !this.review && !this.game.isOver && this.game.turn === this.options.userColor;
  }

  private cancelPending(): void {
    this.pending?.abort();
    this.pending = undefined;
  }

  private canTakeBack(): boolean {
    // The user's first move is ply 0 if they moved first, otherwise ply 1.
    const firstUserPly = this.firstToMove === this.options.userColor ? 0 : 1;
    return !this.review && !this.game.isOver && this.game.moves.length > firstUserPly;
  }

  private isOpponentsTurn(): boolean {
    return !this.game.isOver && this.game.turn !== this.options.userColor;
  }

  private async opponentMove(): Promise<void> {
    this.thinking = true;
    this.error = undefined;
    this.changed();
    const request = new AbortController();
    this.pending = request;
    const signal = request.signal;
    try {
      const { startFen } = this.options;
      const position = { fen: this.game.fen, moves: this.game.moves, ...(startFen ? { startFen } : {}) };
      const uci = await this.options.opponent.chooseMove(position, signal);
      if (signal.aborted) return;
      this.game.play(uci);
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!signal.aborted) {
        this.pending = undefined;
        this.thinking = false;
        this.changed();
      }
    }
  }

  private changed(): void {
    this.snapshot = this.buildState();
    // A move under review isn't final yet, even if it would end the game.
    if (this.game.isOver && !this.finished && !this.review) {
      this.finished = true;
      void this.options.onFinished?.(this.record());
    }
    this.prepareCheck();
    for (const l of this.listeners) l();
  }

  private buildState(): SessionState {
    const g = this.game;
    return {
      fen: g.fen,
      turn: g.turn,
      userColor: this.options.userColor,
      moves: [...g.moves],
      san: [...g.sanMoves],
      lastMove: g.lastMove,
      inCheck: g.inCheck,
      dests: this.userCanMove() ? g.legalDestinations() : new Map(),
      status: g.status,
      result: g.result,
      thinking: this.thinking,
      error: this.error,
      canTakeBack: this.canTakeBack(),
      review: this.review,
    };
  }

  private record(): GameRecord {
    const { userColor, opponent } = this.options;
    const you = 'You';
    const maia = `Maia ${opponent.elo}`;
    const date = this.startedAt.toISOString();
    return {
      id: (this.options.newId ?? (() => crypto.randomUUID()))(),
      startedAt: date,
      userColor,
      opponent: { engine: 'maia3', elo: opponent.elo },
      moves: [...this.game.moves],
      pgn: this.game.pgn({
        Event: 'Chess Trainer game',
        Date: date.slice(0, 10).replaceAll('-', '.'),
        White: userColor === 'white' ? you : maia,
        Black: userColor === 'black' ? you : maia,
      }),
      result: this.game.result,
      hintsUsed: [...this.hints].sort(([a], [b]) => a - b).map(([ply, level]) => ({ ply, level })),
      ...(this.options.startFen ? { startFen: this.options.startFen } : {}),
      ...(this.takebacks > 0 ? { takebacks: this.takebacks } : {}),
      schemaVersion: 1,
    };
  }
}
