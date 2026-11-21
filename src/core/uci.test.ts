import { describe, expect, it } from 'vitest';
import { collectLines, parseBestMove, parseInfo } from './uci';

// Lines below are real Stockfish 19 Lite output (captured with `go movetime 300`, MultiPV 3).

describe('parseInfo', () => {
  it('reads a principal variation with a centipawn score', () => {
    const line =
      'info depth 13 seldepth 20 multipv 2 score cp 23 nodes 189749 nps 632496 hashfull 62 time 300 pv d2d4 e5d4 f3d4 g8f6';
    expect(parseInfo(line)).toEqual({
      multiPv: 2,
      depth: 13,
      score: { type: 'cp', value: 23 },
      pv: ['d2d4', 'e5d4', 'f3d4', 'g8f6'],
    });
  });

  it('reads mate scores, including negative ones (the side to move gets mated)', () => {
    expect(parseInfo('info depth 16 seldepth 2 multipv 1 score mate 1 nodes 258434 time 300 pv d1d8')).toMatchObject({
      score: { type: 'mate', value: 1 },
      pv: ['d1d8'],
    });
    expect(parseInfo('info depth 9 multipv 1 score mate -2 nodes 1 time 1 pv g8h8 d1d8')).toMatchObject({
      score: { type: 'mate', value: -2 },
    });
  });

  it('treats a missing multipv as line 1 (Stockfish omits it when MultiPV is 1)', () => {
    expect(parseInfo('info depth 5 score cp -40 nodes 10 time 1 pv e7e5')).toMatchObject({ multiPv: 1 });
  });

  it('ignores lines that are not a finished principal variation', () => {
    expect(parseInfo('info string Network replica 1: Local memory.')).toBeNull();
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
    // Bounds are provisional scores from a search window that failed; a later line replaces them.
    expect(parseInfo('info depth 12 multipv 1 score cp 30 lowerbound nodes 1 time 1 pv e2e4')).toBeNull();
    expect(parseInfo('info depth 12 multipv 1 score cp 30 upperbound nodes 1 time 1 pv e2e4')).toBeNull();
    // A position with no legal moves: there's a score but no line.
    expect(parseInfo('info depth 0 score mate 0')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
    expect(parseInfo('')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('reads the best move, with or without a ponder move', () => {
    expect(parseBestMove('bestmove f1b5 ponder a7a6')).toBe('f1b5');
    expect(parseBestMove('bestmove d1d8')).toBe('d1d8');
  });

  it('returns null for "(none)" (no legal moves) and for other lines', () => {
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('info depth 1 pv e2e4')).toBeNull();
  });
});

describe('collectLines', () => {
  it('keeps the latest line for each multipv slot, ordered best first', () => {
    const output = [
      'info string Network replica 1: Local memory.',
      'info depth 15 seldepth 2 multipv 1 score mate 1 nodes 230821 time 268 pv d1d8',
      'info depth 15 seldepth 22 multipv 2 score cp 671 nodes 230821 time 268 pv g2g4 f7f6',
      'info depth 15 seldepth 20 multipv 3 score cp 636 nodes 230821 time 268 pv h2h4 g8f8',
      // The search was stopped partway through depth 16, so only line 1 got there.
      'info depth 16 seldepth 2 multipv 1 score mate 1 nodes 258434 time 300 pv d1d8',
      'bestmove d1d8',
    ];
    expect(collectLines(output)).toEqual([
      { move: 'd1d8', score: { type: 'mate', value: 1 }, pv: ['d1d8'], depth: 16 },
      { move: 'g2g4', score: { type: 'cp', value: 671 }, pv: ['g2g4', 'f7f6'], depth: 15 },
      { move: 'h2h4', score: { type: 'cp', value: 636 }, pv: ['h2h4', 'g8f8'], depth: 15 },
    ]);
  });

  it('drops a stale slot that repeats a move already shown higher up', () => {
    // At depth 9 the old second-best move took first place; slot 2 still holds its depth-8 line.
    const output = [
      'info depth 8 multipv 1 score cp 20 nodes 1 time 1 pv e2e4 e7e5',
      'info depth 8 multipv 2 score cp 15 nodes 1 time 1 pv d2d4 d7d5',
      'info depth 9 multipv 1 score cp 25 nodes 2 time 2 pv d2d4 g8f6',
    ];
    expect(collectLines(output).map((l) => l.move)).toEqual(['d2d4']);
  });

  it('returns no lines when the side to move has no legal moves', () => {
    expect(collectLines(['info depth 0 score mate 0', 'bestmove (none)'])).toEqual([]);
    expect(collectLines(['info depth 0 score cp 0', 'bestmove (none)'])).toEqual([]);
  });
});
