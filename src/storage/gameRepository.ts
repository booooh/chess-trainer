import Dexie, { type EntityTable } from 'dexie';
import type { GameRecord, GameRepository } from '../core/records';

/**
 * The app's IndexedDB database. Dexie versions the schema: to add tables or indexes later,
 * add a `this.version(2).stores({...})` call rather than editing version 1.
 */
export class ChessTrainerDb extends Dexie {
  games!: EntityTable<GameRecord, 'id'>;

  constructor(name = 'chess-trainer') {
    super(name);
    this.version(1).stores({
      // Primary key `id`, plus an index on startedAt for "most recent first".
      games: 'id, startedAt',
    });
  }
}

export class DexieGameRepository implements GameRepository {
  constructor(private readonly db: ChessTrainerDb) {}

  async save(record: GameRecord): Promise<void> {
    // add(), not put(): a game is written once and never changed (DESIGN §7).
    await this.db.games.add(record);
  }

  async list(): Promise<GameRecord[]> {
    return this.db.games.orderBy('startedAt').reverse().toArray();
  }
}
