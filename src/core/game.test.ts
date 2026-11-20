import { describe, expect, it } from 'vitest';
import { Game, IllegalMoveError } from './game';

const play = (game: Game, ...moves: string[]) => moves.forEach((m) => game.play(m));

describe('Game', () => {
  it('starts in the standard position with white to move', () => {
    const game = new Game();
    expect(game.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(game.turn).toBe('white');
    expect(game.moves).toEqual([]);
    expect(game.status).toEqual({ kind: 'playing' });
  });

  it('lists legal destinations per square, for the board UI', () => {
    const dests = new Game().legalDestinations();
    expect(dests.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(dests.get('e2')?.sort()).toEqual(['e3', 'e4']);
    expect([...dests.values()].flat()).toHaveLength(20);
  });

  it('plays moves given in UCI and records them', () => {
    const game = new Game();
    expect(game.play('e2e4')).toEqual({ uci: 'e2e4', san: 'e4' });
    play(game, 'e7e5');
    expect(game.moves).toEqual(['e2e4', 'e7e5']);
    expect(game.sanMoves).toEqual(['e4', 'e5']);
    expect(game.turn).toBe('white');
    expect(game.lastMove).toEqual(['e7', 'e5']);
  });

  it('rejects illegal moves without changing the position', () => {
    const game = new Game();
    expect(() => game.play('e2e5')).toThrow(IllegalMoveError);
    expect(() => game.play('nonsense')).toThrow(IllegalMoveError);
    expect(game.moves).toEqual([]);
  });

  it('handles promotion, and tells the UI when a move needs a promotion piece', () => {
    const game = new Game('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(game.isPromotion('a7', 'a8')).toBe(true);
    expect(game.isPromotion('h1', 'h2')).toBe(false);
    expect(game.play('a7a8q').san).toBe('a8=Q+');
  });

  it('detects checkmate and the winner', () => {
    const game = new Game();
    play(game, 'f2f3', 'e7e5', 'g2g4', 'd8h4'); // fool's mate
    expect(game.status).toEqual({ kind: 'checkmate', winner: 'black' });
    expect(game.result).toBe('0-1');
    expect(() => game.play('a2a3')).toThrow(IllegalMoveError);
  });

  it('detects stalemate as a draw', () => {
    // Black king on a8, white queen on c7: black to move has no legal move and isn't in check.
    const game = new Game('k7/2Q5/8/8/8/8/8/7K b - - 0 1');
    expect(game.status).toEqual({ kind: 'draw', reason: 'stalemate' });
    expect(game.result).toBe('1/2-1/2');
  });

  it('detects insufficient material as a draw', () => {
    const game = new Game('k7/8/8/8/8/8/8/7K w - - 0 1');
    expect(game.status).toEqual({ kind: 'draw', reason: 'insufficientMaterial' });
  });

  it('lets a player resign, which ends the game', () => {
    const game = new Game();
    game.play('e2e4');
    game.resign('black');
    expect(game.status).toEqual({ kind: 'resigned', winner: 'white' });
    expect(game.result).toBe('1-0');
    expect(() => game.play('e7e5')).toThrow(IllegalMoveError);
  });

  it('exports PGN with headers and the result', () => {
    const game = new Game();
    play(game, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    const pgn = game.pgn({ White: 'You', Black: 'Maia 1100' });
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain('[Black "Maia 1100"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toMatch(/1\. f3 e5 2\. g4 Qh4# 0-1$/);
  });

  it('ends the PGN with the result after a resignation too', () => {
    const game = new Game();
    play(game, 'e2e4', 'e7e5');
    game.resign('white');
    expect(game.pgn()).toMatch(/1\. e4 e5 0-1$/);
  });
});
