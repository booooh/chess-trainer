import { Chess } from 'chess.js';

export type Color = 'white' | 'black';
/** A move in UCI notation, e.g. "e2e4" or "a7a8q". Maia and Stockfish both speak UCI. */
export type Uci = string;
export type Square = string;

export type DrawReason = 'stalemate' | 'insufficientMaterial' | 'threefoldRepetition' | 'fiftyMoves';
export type GameStatus =
  | { kind: 'playing' }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason }
  | { kind: 'resigned'; winner: Color };
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export class IllegalMoveError extends Error {
  constructor(move: string, reason = 'illegal move') {
    super(`${reason}: ${move}`);
    this.name = 'IllegalMoveError';
  }
}

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const toColor = (c: 'w' | 'b'): Color => (c === 'w' ? 'white' : 'black');
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/**
 * One game of chess: the rules (via chess.js), the moves played so far, and how it ended.
 * Pure TypeScript with no UI or engine knowledge, so it is easy to test and reuse.
 */
export class Game {
  private readonly chess: Chess;
  private readonly startFen: string | undefined;
  private readonly played: Uci[] = [];
  private resignedBy: Color | null = null;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
    this.startFen = fen;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return toColor(this.chess.turn());
  }

  /** Moves played so far, in UCI. */
  get moves(): readonly Uci[] {
    return this.played;
  }

  /** Moves played so far, in standard algebraic notation (e.g. "Nf3"), for display. */
  get sanMoves(): readonly string[] {
    return this.chess.history();
  }

  get lastMove(): [Square, Square] | undefined {
    const last = this.played.at(-1);
    return last ? [last.slice(0, 2), last.slice(2, 4)] : undefined;
  }

  get inCheck(): boolean {
    return this.chess.inCheck();
  }

  get status(): GameStatus {
    if (this.resignedBy) return { kind: 'resigned', winner: other(this.resignedBy) };
    const c = this.chess;
    if (c.isCheckmate()) return { kind: 'checkmate', winner: other(this.turn) };
    if (c.isStalemate()) return { kind: 'draw', reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { kind: 'draw', reason: 'insufficientMaterial' };
    if (c.isThreefoldRepetition()) return { kind: 'draw', reason: 'threefoldRepetition' };
    if (c.isDrawByFiftyMoves()) return { kind: 'draw', reason: 'fiftyMoves' };
    return { kind: 'playing' };
  }

  get isOver(): boolean {
    return this.status.kind !== 'playing';
  }

  get result(): GameResult {
    const s = this.status;
    switch (s.kind) {
      case 'playing':
        return '*';
      case 'draw':
        return '1/2-1/2';
      case 'checkmate':
      case 'resigned':
        return s.winner === 'white' ? '1-0' : '0-1';
    }
  }

  /** Legal moves grouped by origin square, in the shape chessground's `movable.dests` wants. */
  legalDestinations(): Map<Square, Square[]> {
    const dests = new Map<Square, Square[]>();
    if (this.isOver) return dests;
    for (const m of this.chess.moves({ verbose: true })) {
      const list = dests.get(m.from) ?? [];
      if (!list.includes(m.to)) list.push(m.to);
      dests.set(m.from, list);
    }
    return dests;
  }

  /** True if moving from → to is a pawn promotion, so the UI must ask which piece. */
  isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
  }

  /** Plays a move, or throws IllegalMoveError and leaves the game unchanged. */
  play(uci: Uci): { uci: Uci; san: string } {
    if (this.isOver) throw new IllegalMoveError(uci, 'game is over');
    const m = UCI_PATTERN.exec(uci);
    if (!m) throw new IllegalMoveError(uci, 'not a UCI move');
    let san: string;
    try {
      san = this.chess.move({ from: m[1]!, to: m[2]!, promotion: m[3] }).san;
    } catch {
      throw new IllegalMoveError(uci);
    }
    this.played.push(uci);
    return { uci, san };
  }

  /**
   * Takes back the last move and returns it, or undefined if there is none. A resignation
   * is final, so nothing can be taken back after one; a checkmate or draw can.
   */
  undo(): Uci | undefined {
    if (this.resignedBy || this.played.length === 0) return undefined;
    this.chess.undo();
    return this.played.pop();
  }

  resign(color: Color): void {
    if (this.isOver) return;
    this.resignedBy = color;
  }

  /** PGN text with the given headers (e.g. White, Black, Date) and the game's result. */
  pgn(headers: Record<string, string> = {}): string {
    // Replay into a fresh instance so headers and the result don't leak into our own state.
    const copy = this.startFen ? new Chess(this.startFen) : new Chess();
    for (const [k, v] of Object.entries(headers)) copy.setHeader(k, v);
    if (this.startFen) {
      copy.setHeader('SetUp', '1');
      copy.setHeader('FEN', this.startFen);
    }
    copy.setHeader('Result', this.result);
    for (const uci of this.played) {
      copy.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    const text = copy.pgn();
    // chess.js only writes the result token for checkmate/draws; add it for resignations too.
    return text.endsWith(this.result) ? text : `${text} ${this.result}`.trim();
  }
}
