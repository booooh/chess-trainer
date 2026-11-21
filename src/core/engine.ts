import type { Uci } from './game';

/**
 * An engine evaluation, from the point of view of the side to move (the UCI convention):
 * positive is good for whoever is about to play.
 * - `cp`: centipawns, so 100 is roughly a pawn's worth of advantage.
 * - `mate`: moves until mate. Positive: the side to move mates. Negative: it gets mated.
 */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

/** One candidate move with the engine's expected continuation. */
export type Line = {
  /** The candidate move (same as `pv[0]`). */
  move: Uci;
  score: Score;
  /** Principal variation: the line the engine expects, starting with `move`. */
  pv: Uci[];
  /** Search depth (in plies) this line comes from. */
  depth: number;
};

export type AnalyseOptions = {
  /** How many candidate moves to return (UCI MultiPV). */
  multiPv: number;
  /** Thinking time. DESIGN §4.1: about 1–1.5 s per hint on a phone. */
  movetimeMs: number;
};

/**
 * "What are the best moves here, and how good are they?" Implemented by Stockfish in a Web
 * Worker (`src/workers/stockfishClient.ts`, ADR-0002); tests use fakes. Analysis only: the
 * opponent is Maia.
 */
export interface Engine {
  /**
   * Candidate lines for the side to move, best first. At most `multiPv` lines, fewer if
   * there are fewer legal moves, and none in checkmate or stalemate.
   * Rejects with an `AbortError` if `signal` aborts first.
   */
  analyse(fen: string, options: AnalyseOptions, signal?: AbortSignal): Promise<Line[]>;
}

/**
 * An Engine that only creates the real one on first use. Starting Stockfish costs a download,
 * a wasm compile and memory, which is wasted until someone actually asks for a hint.
 */
export function lazyEngine(create: () => Engine): Engine {
  let engine: Engine | null = null;
  return {
    analyse: (fen, options, signal) => (engine ??= create()).analyse(fen, options, signal),
  };
}
