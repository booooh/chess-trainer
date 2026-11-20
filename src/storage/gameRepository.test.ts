import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameRecord } from '../core/records';
import { ChessTrainerDb, DexieGameRepository } from './gameRepository';

const record = (id: string, startedAt: string): GameRecord => ({
  id,
  startedAt,
  userColor: 'white',
  opponent: { engine: 'maia3', elo: 1100 },
  moves: ['e2e4'],
  pgn: '1. e4 *',
  result: '*',
  hintsUsed: [],
  schemaVersion: 1,
});

let db: ChessTrainerDb;
afterEach(async () => {
  db.close();
  await ChessTrainerDb.delete(db.name);
});

describe('DexieGameRepository', () => {
  it('saves games and lists them most recent first', async () => {
    db = new ChessTrainerDb('test-list');
    const repo = new DexieGameRepository(db);
    await repo.save(record('a', '2026-11-19T10:00:00.000Z'));
    await repo.save(record('b', '2026-11-20T10:00:00.000Z'));
    expect((await repo.list()).map((g) => g.id)).toEqual(['b', 'a']);
  });

  it('keeps games across reopening the database', async () => {
    db = new ChessTrainerDb('test-reopen');
    await new DexieGameRepository(db).save(record('a', '2026-11-20T10:00:00.000Z'));
    db.close();
    db = new ChessTrainerDb('test-reopen');
    expect(await new DexieGameRepository(db).list()).toEqual([record('a', '2026-11-20T10:00:00.000Z')]);
  });

  it('refuses to overwrite a saved game, since games are immutable', async () => {
    db = new ChessTrainerDb('test-immutable');
    const repo = new DexieGameRepository(db);
    await repo.save(record('a', '2026-11-20T10:00:00.000Z'));
    await expect(repo.save(record('a', '2026-11-21T10:00:00.000Z'))).rejects.toThrow();
  });
});
