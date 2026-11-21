// The hint ladder (DESIGN §5.1): each press reveals one more level of the same hint. The
// teaching line is built once, on the first press, and thrown away when the position changes.
import type { Engine } from './engine';
import type { Color, Uci } from './game';
import { narrate, type HintText } from './narrator';
import type { HumanMovePredictor } from './opponent';
import type { HintLevel } from './records';
import { buildTeachingLine, type TeachingLine, type TeachingLineOptions } from './teachingLine';

export type HintState =
  | { status: 'idle' }
  | { status: 'thinking' }
  | { status: 'shown'; level: HintLevel; text: HintText; line: TeachingLine }
  /** No move to teach (the game is over). */
  | { status: 'none' }
  | { status: 'failed'; message: string };

export type HintCoachOptions = {
  userColor: Color;
  /**
   * The user's rating, for "which good move would a human find". We don't know it yet, so
   * the app passes the opponent's rating as a stand-in.
   */
  userElo: number;
  opponentElo: number;
  /** The position the game started from, if it isn't the usual one. */
  startFen?: string;
  /** Called each time a level is shown, so the game can record it. */
  onLevel?: (level: HintLevel) => void;
  lineOptions?: TeachingLineOptions;
};

type Position = { fen: string; moves: readonly Uci[] };
const keyOf = (p: Position) => `${p.moves.length} ${p.fen}`;

export class HintCoach {
  private current: HintState = { status: 'idle' };
  private key: string | null = null;
  /** The last hint shown, kept so `moveTo` can bring it back if the game returns there. */
  private saved: { key: string; state: HintState } | null = null;
  private abort: AbortController | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: { engine: Engine; predictor: HumanMovePredictor },
    private readonly options: HintCoachOptions,
  ) {}

  get state(): HintState {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The hint button: shows the next level for this position (building the hint if needed). */
  async more(position: Position): Promise<void> {
    const key = keyOf(position);
    if (key !== this.key) this.reset();
    this.key = key;

    const s = this.current;
    if (s.status === 'thinking' || s.status === 'none') return;
    if (s.status === 'shown') {
      if (s.level < 4) this.show({ ...s, level: (s.level + 1) as HintLevel });
      return;
    }

    const abort = new AbortController();
    this.abort = abort;
    this.set({ status: 'thinking' });
    try {
      const { userColor, userElo, opponentElo, startFen, lineOptions } = this.options;
      const line = await buildTeachingLine(
        { fen: position.fen, moves: position.moves, ...(startFen ? { startFen } : {}), userElo, opponentElo },
        this.deps,
        lineOptions,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      if (!line) return this.set({ status: 'none' });
      this.show({ status: 'shown', level: 1, line, text: narrate(line, { fen: position.fen, userColor }) });
    } catch (err) {
      if (abort.signal.aborted) return;
      this.set({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /**
   * Follows the game to `position`. A hint for another position is hidden (and its analysis
   * stopped); returning to the position of the last hint shown brings it back at the same
   * level, e.g. after "Go back" on a "why not?" explanation.
   */
  moveTo(position: Position): void {
    const key = keyOf(position);
    if (key === this.key) return;
    if (this.current.status === 'shown' && this.key) this.saved = { key: this.key, state: this.current };
    const restore = this.saved?.key === key ? this.saved.state : null;
    this.reset();
    this.key = key;
    if (restore) this.set(restore);
  }

  /** Hides the hint and stops any analysis in progress (e.g. the user moved). */
  reset(): void {
    this.abort?.abort();
    this.abort = null;
    this.key = null;
    if (this.current.status !== 'idle') this.set({ status: 'idle' });
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  private show(state: Extract<HintState, { status: 'shown' }>): void {
    this.set(state);
    this.options.onLevel?.(state.level);
  }

  private set(state: HintState): void {
    this.current = state;
    for (const l of this.listeners) l();
  }
}
