export type ColorChoice = 'white' | 'black' | 'random';

/** Maia opponent ratings offered (Lichess scale). The phase 1 spike found Maia-3 plays
 *  measurably weaker all the way down to 400 (docs/spikes/maia-3.md). */
export const ELO_CHOICES = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500];
export const DEFAULT_ELO = 1100;
