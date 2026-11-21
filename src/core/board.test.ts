import { describe, expect, it } from 'vitest';
import { Board, materialBalance, PIECE_VALUES } from './board';

describe('Board', () => {
  it('reads pieces from a FEN', () => {
    const board = Board.fromFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1');
    expect(board.get('d5')).toEqual({ color: 'black', type: 'n' });
    expect(board.get('e4')).toEqual({ color: 'white', type: 'p' });
    expect(board.get('a1')).toBeUndefined();
  });

  it('finds attackers of a square for one side, through empty squares only', () => {
    // White queen d1 and black queen d8 both see d5; the black pawn on e7 does not.
    const board = Board.fromFen('3qk3/4p3/8/3p4/8/8/8/3QK3 w - - 0 1');
    expect(board.attackers('d5', 'white')).toEqual(['d1']);
    expect(board.attackers('d5', 'black')).toEqual(['d8']);
    // Pawns attack diagonally forwards: e7 covers d6 and f6.
    expect(board.attackers('d6', 'black').sort()).toEqual(['d8', 'e7']);
    expect(board.attackers('f6', 'black')).toEqual(['e7']);
  });

  it('lists the squares a piece attacks', () => {
    const board = Board.fromFen('r3k3/8/8/8/8/8/2N5/4K3 w - - 0 1');
    expect(board.attacksFrom('c2').sort()).toEqual(['a1', 'a3', 'b4', 'd4', 'e1', 'e3']);
  });
});

describe('Board.see (static exchange evaluation)', () => {
  it('wins the whole piece when nothing defends it', () => {
    const board = Board.fromFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1');
    expect(board.see('d5', 'white')).toBe(PIECE_VALUES.n);
  });

  it('counts the loss when a valuable piece takes a defended pawn', () => {
    const board = Board.fromFen('3qk3/4p3/8/3p4/8/8/8/3QK3 w - - 0 1');
    expect(board.see('d5', 'white')).toBe(100 - 900);
  });

  it('sees x-rays: a rook behind a rook joins the exchange', () => {
    // Rd2xd5 Rxd5 Rd1xd5: White wins a pawn. Without the x-ray it would lose a rook for a pawn.
    const board = Board.fromFen('3rk3/8/8/3p4/8/8/3R4/3RK3 w - - 0 1');
    expect(board.see('d5', 'white')).toBe(100);
  });

  it("doesn't let a king recapture on a square that is still defended", () => {
    // Bxf7+: the king can't take back, because the queen on f3 also covers f7.
    expect(Board.fromFen('6k1/5p2/8/8/2B5/5Q2/8/6K1 w - - 0 1').see('f7', 'white')).toBe(100);
    // Without the queen, Kxf7 wins the bishop for a pawn.
    expect(Board.fromFen('6k1/5p2/8/8/2B5/8/8/6K1 w - - 0 1').see('f7', 'white')).toBe(100 - 300);
  });

  it('returns null when the side has no attacker on the square', () => {
    expect(Board.fromFen('4k3/8/8/3n4/8/8/8/4K3 w - - 0 1').see('d5', 'white')).toBeNull();
  });

  it('can start the exchange with a given piece', () => {
    // Taking the defended pawn with the queen loses; the result depends on who captures first.
    const board = Board.fromFen('3qk3/4p3/8/3p4/8/8/8/3QK3 w - - 0 1');
    expect(board.seeCapture('d1', 'd5')).toBe(100 - 900);
  });
});

describe('materialBalance', () => {
  it('is White minus Black in centipawns, kings excluded', () => {
    expect(materialBalance(Board.fromFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1'))).toBe(100 - 300);
    expect(materialBalance(Board.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))).toBe(0);
  });
});
