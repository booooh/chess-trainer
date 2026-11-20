import type { Color, GameResult, Uci } from './game';

/**
 * A finished game as stored on the device (DESIGN §7). Records are immutable and every
 * statistic is rebuilt from them, which keeps them ready for v2 sync (ADR-0006).
 */
export type GameRecord = {
  id: string;
  /** ISO 8601 timestamp. */
  startedAt: string;
  userColor: Color;
  opponent: { engine: 'maia3'; elo: number };
  /** Moves in UCI from the start position: easy to replay without parsing PGN. */
  moves: Uci[];
  pgn: string;
  result: GameResult;
  hintsUsed: { ply: number; level: 1 | 2 | 3 | 4 }[];
  openingKey?: string;
  schemaVersion: 1;
};

/** Where finished games are kept. Implemented with IndexedDB in `src/storage/`. */
export interface GameRepository {
  save(record: GameRecord): Promise<void>;
  /** Most recent first. */
  list(): Promise<GameRecord[]>;
}
