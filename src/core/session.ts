import { Game, type Color, type GameStatus, type GameResult, type Square, type Uci } from './game';
import type { GameRecord } from './records';

/** Anything that can pick a move for the computer side (MaiaOpponent, or a fake in tests). */
export interface Opponent {
  readonly elo: number;
  chooseMove(position: { fen: string; moves: readonly Uci[] }, signal?: AbortSignal): Promise<Uci>;
}

export type SessionState = {
  fen: string;
  turn: Color;
  userColor: Color;
  moves: readonly Uci[];
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
};

export type SessionOptions = {
  userColor: Color;
  opponent: Opponent;
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
  private readonly game = new Game();
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private readonly startedAt: Date;
  private thinking = false;
  private error: string | undefined;
  private finished = false;
  private snapshot: SessionState;

  constructor(private readonly options: SessionOptions) {
    this.startedAt = (options.now ?? (() => new Date()))();
    this.snapshot = this.buildState();
  }

  get state(): SessionState {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts the game; if the opponent has white, waits for its first move. */
  async start(): Promise<void> {
    if (this.isOpponentsTurn()) await this.opponentMove();
  }

  /** Plays the user's move, then waits for the opponent's reply. */
  async playUserMove(uci: Uci): Promise<void> {
    if (this.thinking || this.game.turn !== this.options.userColor) {
      throw new Error(`not your turn: ${uci}`);
    }
    this.game.play(uci); // throws IllegalMoveError, leaving everything unchanged
    this.changed();
    if (this.isOpponentsTurn()) await this.opponentMove();
  }

  /** Tries the opponent's move again after an error. */
  async retryOpponent(): Promise<void> {
    if (this.isOpponentsTurn() && !this.thinking) await this.opponentMove();
  }

  resign(): void {
    if (this.game.isOver) return;
    this.game.resign(this.options.userColor);
    this.abort.abort();
    this.thinking = false;
    this.changed();
  }

  /** Stops listening for the opponent (e.g. the user left the game screen). */
  dispose(): void {
    this.abort.abort();
    this.listeners.clear();
  }

  private isOpponentsTurn(): boolean {
    return !this.game.isOver && this.game.turn !== this.options.userColor;
  }

  private async opponentMove(): Promise<void> {
    this.thinking = true;
    this.error = undefined;
    this.changed();
    const signal = this.abort.signal;
    try {
      const uci = await this.options.opponent.chooseMove({ fen: this.game.fen, moves: this.game.moves }, signal);
      if (signal.aborted) return;
      this.game.play(uci);
    } catch (err) {
      if (signal.aborted) return;
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!signal.aborted) {
        this.thinking = false;
        this.changed();
      }
    }
  }

  private changed(): void {
    this.snapshot = this.buildState();
    if (this.game.isOver && !this.finished) {
      this.finished = true;
      void this.options.onFinished?.(this.record());
    }
    for (const l of this.listeners) l();
  }

  private buildState(): SessionState {
    const g = this.game;
    const userCanMove = !this.thinking && !g.isOver && g.turn === this.options.userColor;
    return {
      fen: g.fen,
      turn: g.turn,
      userColor: this.options.userColor,
      moves: [...g.moves],
      lastMove: g.lastMove,
      inCheck: g.inCheck,
      dests: userCanMove ? g.legalDestinations() : new Map(),
      status: g.status,
      result: g.result,
      thinking: this.thinking,
      error: this.error,
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
      hintsUsed: [],
      schemaVersion: 1,
    };
  }
}
