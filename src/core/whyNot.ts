// "Why not?" (DESIGN §5.4): after a hint, the user may play a different move. If it's clearly
// worse, the move is held back and the two lines are compared, so the user can continue or
// go back and play the hint's move.
import type { Engine, Score } from './engine';
import { scoreToCp } from './facts';
import type { Color, Uci } from './game';
import { explainWhyNot, whyNotReasons } from './narrator';
import type { HumanMovePredictor } from './opponent';
import type { MoveChecker, MoveWarning, Position } from './session';
import { buildTeachingLine, type TeachingLine, type TeachingLineOptions } from './teachingLine';

const CAP_CP = 1000;
const capped = (score: Score) => Math.max(-CAP_CP, Math.min(CAP_CP, scoreToCp(score)));

/**
 * Is the user's line clearly worse than the hint's? By at least `thresholdCp` (default half
 * a pawn, DESIGN §10 "teachable but slightly worse"), with scores capped at ±1000 so two
 * winning moves count as equal. When the hint mates, any forced mate is as good.
 */
export function isClearlyWorse(hint: TeachingLine, yours: TeachingLine, thresholdCp = 50): boolean {
  if (hint.score.type === 'mate' && hint.score.value > 0) return !(yours.score.type === 'mate' && yours.score.value > 0);
  return lossCp(hint, yours) >= thresholdCp;
}

/** How much worse the user's line is than the hint's, on capped scores. */
const lossCp = (hint: TeachingLine, yours: TeachingLine) => capped(hint.score) - capped(yours.score);

export type CoachingCheckerOptions = {
  /** The hint's line shown right now, if any (read when the user moves). */
  hint: () => TeachingLine | null;
  /** The blunder warning, if it's turned on. */
  blunders?: MoveChecker;
  request: { userColor: Color; userElo: number; opponentElo: number; startFen?: string };
  lineOptions?: TeachingLineOptions;
  thresholdCp?: number;
  /**
   * Below this loss, "why not?" only interrupts when it has a concrete reason (material, a
   * hanging piece, a mate, a fork). "Stockfish rates it higher" alone isn't worth stopping
   * for, and would contradict a hint that just said "no tactic here". Default 200, the same
   * as the blunder warning.
   */
  unexplainedLossCp?: number;
  /** Give up on the explanation after this long and fall back on the blunder check. Default 10 s. */
  timeoutMs?: number;
};

/**
 * The move checker the game uses: "why not?" when the user played something other than the
 * hint shown, otherwise the blunder warning (if on). Answers at once (synchronously) when
 * there's nothing to check, so ordinary moves don't wait at all.
 */
export class CoachingChecker implements MoveChecker {
  constructor(
    private readonly deps: { engine: Engine; predictor: HumanMovePredictor },
    private readonly options: CoachingCheckerOptions,
  ) {}

  prepare(fen: string): void {
    this.options.blunders?.prepare(fen);
  }

  check(position: Position, uci: Uci, signal: AbortSignal): MoveWarning | null | Promise<MoveWarning | null> {
    const hint = this.options.hint();
    const first = hint?.plies[0];
    if (hint && first && first.fenBefore === position.fen && first.uci !== uci) {
      return this.whyNot(hint, position, uci, signal);
    }
    return this.options.blunders ? this.options.blunders.check(position, uci, signal) : null;
  }

  private async whyNot(hint: TeachingLine, position: Position, uci: Uci, signal: AbortSignal): Promise<MoveWarning | null> {
    const { request, lineOptions, thresholdCp, unexplainedLossCp = 200, timeoutMs = 10_000 } = this.options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort);
    try {
      const yours = await Promise.race([
        buildTeachingLine(
          { ...position, ...(request.startFen ? { startFen: request.startFen } : {}), userElo: request.userElo, opponentElo: request.opponentElo },
          this.deps,
          { ...lineOptions, firstMove: uci },
          abort.signal,
        ),
        new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('why not? timed out')), timeoutMs))),
      ]);
      if (!yours || !isClearlyWorse(hint, yours, thresholdCp)) return null;
      const context = { fen: position.fen, userColor: request.userColor };
      const reasons = whyNotReasons(hint, yours, context);
      const concrete = reasons.yours !== null || reasons.better !== null;
      if (!concrete && lossCp(hint, yours) < unexplainedLossCp) return null;
      const first = hint.plies[0]!;
      return {
        kind: 'whyNot',
        steps: explainWhyNot(hint, yours, context),
        better: { from: first.uci.slice(0, 2), to: first.uci.slice(2, 4), san: first.san },
      };
    } catch {
      abort.abort(); // stop a search that's still running
      if (signal.aborted || !this.options.blunders) return null;
      return this.options.blunders.check(position, uci, signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
