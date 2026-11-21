import type { Uci } from './game';

/** Probability that a human would play each legal move (sums to ~1). */
export type MoveProbabilities = ReadonlyMap<Uci, number>;

export type PredictRequest = {
  /** The position to predict a move in. */
  fen: string;
  /** All moves from the start position to `fen`, in UCI. Maia uses recent ones as context. */
  moves: readonly Uci[];
  /** The position `moves` start from, if it isn't the usual one (a practice position). */
  startFen?: string;
  /** Rating of the player to move. */
  selfElo: number;
  /** Rating of the other player. */
  oppoElo: number;
};

/**
 * "What would a human of this rating play here?" Implemented by Maia-3 in a Web Worker
 * (`src/workers/`); tests use fakes. Also used later for natural replies in teaching lines.
 */
export interface HumanMovePredictor {
  predict(req: PredictRequest, signal?: AbortSignal): Promise<MoveProbabilities>;
}

export type SampleOptions = {
  /**
   * Moves less likely than this are never played. Maia gives tiny probabilities to many odd
   * moves; sampling those occasionally would make the opponent look broken rather than human.
   */
  floor?: number;
  /** Returns a number in [0, 1). Injected so tests are deterministic. */
  random: () => number;
};

export const DEFAULT_FLOOR = 0.02;

/** Picks a move at random, weighted by probability, ignoring moves below the floor. */
export function sampleMove(probs: MoveProbabilities, { floor = DEFAULT_FLOOR, random }: SampleOptions): Uci {
  if (probs.size === 0) throw new Error('sampleMove: no moves to choose from');
  const eligible = [...probs].filter(([, p]) => p >= floor);
  if (eligible.length === 0) {
    // Nothing clears the floor (a very flat distribution): play the most likely move.
    return [...probs].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  }
  const total = eligible.reduce((sum, [, p]) => sum + p, 0);
  let r = random() * total;
  for (const [uci, p] of eligible) {
    r -= p;
    if (r < 0) return uci;
  }
  return eligible.at(-1)![0]; // floating-point leftovers
}

export type OpponentOptions = {
  /** The opponent's playing strength, as a Maia (Lichess-scale) rating. */
  elo: number;
  /** The human player's rating, if known. Defaults to `elo`. */
  opponentElo?: number;
  floor?: number;
  random?: () => number;
};

/** A computer opponent that plays like a human of a given rating (ADR-0003). */
export class MaiaOpponent {
  constructor(
    private readonly predictor: HumanMovePredictor,
    private readonly options: OpponentOptions,
  ) {}

  get elo(): number {
    return this.options.elo;
  }

  async chooseMove(position: { fen: string; moves: readonly Uci[]; startFen?: string }, signal?: AbortSignal): Promise<Uci> {
    const { elo, opponentElo = elo, floor, random = Math.random } = this.options;
    const { fen, moves, startFen } = position;
    const probs = await this.predictor.predict(
      { fen, moves, ...(startFen ? { startFen } : {}), selfElo: elo, oppoElo: opponentElo },
      signal,
    );
    return sampleMove(probs, { floor, random });
  }
}
