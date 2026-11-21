import { Game } from '../core/game';

export type ColorChoice = 'white' | 'black' | 'random';

/** Maia opponent ratings offered (Lichess scale). The phase 1 spike found Maia-3 plays
 *  measurably weaker all the way down to 400 (docs/spikes/maia-3.md). */
export const ELO_CHOICES = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500];
export const DEFAULT_ELO = 1100;

/**
 * A practice position from the page URL (`?fen=…`), so a game can start from any position:
 * useful for trying hints on a known tactic, and for the e2e tests. Returns undefined unless
 * it's a valid position with moves left to play.
 */
export function practiceFen(search: string): string | undefined {
  const fen = new URLSearchParams(search).get('fen')?.trim();
  if (!fen) return undefined;
  try {
    return new Game(fen).isOver ? undefined : fen;
  } catch {
    return undefined;
  }
}
