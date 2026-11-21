import { describe, expect, it } from 'vitest';
import { hangingPieces, moveFacts, scoreToCp, type Fact } from './facts';

const kinds = (facts: Fact[]) => facts.map((f) => f.kind);

describe('hangingPieces', () => {
  it('reports a piece the opponent can win, with how much it wins', () => {
    // The black bishop on c5 attacks the undefended knight on d4.
    expect(hangingPieces('4k3/8/8/2b5/3N4/8/8/4K3 w - - 0 1')).toEqual([
      { kind: 'hanging', piece: { color: 'white', type: 'n' }, square: 'd4', gainCp: 300 },
    ]);
  });

  it('ignores a piece defended well enough', () => {
    // Bxd4 exd4 is an even trade, so the knight is not hanging.
    expect(hangingPieces('4k3/8/8/2b5/3N4/4P3/8/4K3 w - - 0 1')).toEqual([]);
  });

  it('counts a defended piece attacked by a cheaper one', () => {
    // The rook on d4 is defended, but a pawn takes it: Black wins 500 - 100.
    expect(hangingPieces('4k3/8/8/2p5/3R4/4P3/8/4K3 w - - 0 1')).toEqual([
      { kind: 'hanging', piece: { color: 'white', type: 'r' }, square: 'd4', gainCp: 400 },
    ]);
  });

  it('reports both sides, most valuable first', () => {
    // White's rook a1 is attacked by the bishop f6 (undefended); Black's knight h5 by the queen e2.
    const facts = hangingPieces('4k3/8/5b2/7n/8/8/4Q3/R3K3 w - - 0 1');
    expect(facts.map((f) => f.kind === 'hanging' && [f.square, f.gainCp])).toEqual([
      ['a1', 500],
      ['h5', 300],
    ]);
  });
});

describe('moveFacts: forks', () => {
  it('finds a knight fork of king and rook, with the king first (it is check)', () => {
    const facts = moveFacts('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    expect(facts).toContainEqual({
      kind: 'fork',
      by: { color: 'white', type: 'n' },
      square: 'c7',
      targets: ['e8', 'a8'],
    });
  });

  it('finds a pawn fork of two knights', () => {
    const facts = moveFacts('4k3/8/2n1n3/8/3P4/8/8/4K3 w - - 0 1', 'd4d5');
    expect(facts).toContainEqual({ kind: 'fork', by: { color: 'white', type: 'p' }, square: 'd5', targets: ['c6', 'e6'] });
  });

  it("isn't a fork if the forking piece can simply be taken", () => {
    // Nc7+ also hits a8, but the queen on d8 takes the knight.
    const facts = moveFacts('r2qk3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    expect(kinds(facts)).not.toContain('fork');
    expect(facts).toContainEqual({ kind: 'hanging', piece: { color: 'white', type: 'n' }, square: 'c7', gainCp: 300 });
  });

  it("doesn't count pawns, or pieces it can't win, as targets", () => {
    // The knight on e5 hits pawns d7 and f7 and a bishop c6 defended by the b7 pawn.
    const facts = moveFacts('4k3/1p1p1p2/2b5/8/8/5N2/8/4K3 w - - 0 1', 'f3e5');
    expect(kinds(facts)).not.toContain('fork');
  });
});

describe('moveFacts: material', () => {
  it('reports material won by a capture, for the side that moved', () => {
    expect(moveFacts('4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1', 'c3d5')).toContainEqual({ kind: 'materialChange', deltaCp: 300 });
    // Black capturing is a gain for Black.
    expect(moveFacts('4k3/8/8/3b4/8/8/6N1/4K3 b - - 0 1', 'd5g2')).toContainEqual({ kind: 'materialChange', deltaCp: 300 });
  });

  it('counts a promotion as the new piece minus the pawn', () => {
    expect(moveFacts('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q')).toContainEqual({ kind: 'materialChange', deltaCp: 800 });
  });

  it('says nothing about material for a quiet move', () => {
    expect(kinds(moveFacts('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a2'))).not.toContain('materialChange');
  });
});

describe('moveFacts: newly hanging pieces', () => {
  it('reports a piece the move leaves hanging', () => {
    // e3-e4 stops defending the knight on d4, which the bishop attacks.
    expect(moveFacts('4k3/8/8/2b5/3N4/4P3/8/4K3 w - - 0 1', 'e3e4')).toContainEqual({
      kind: 'hanging',
      piece: { color: 'white', type: 'n' },
      square: 'd4',
      gainCp: 300,
    });
  });

  it("doesn't repeat a piece that was already hanging", () => {
    // The knight on d4 was already hanging before the king moved.
    expect(kinds(moveFacts('4k3/8/8/2b5/3N4/8/8/4K3 w - - 0 1', 'e1f1'))).not.toContain('hanging');
  });
});

describe('moveFacts: eval swing', () => {
  const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';

  it("reports the engine's verdict before and after, from the mover's point of view", () => {
    // Before: White (to move) is +30. After: Black (to move) is +250, so White is -250.
    const facts = moveFacts(fen, 'a1a2', { before: { type: 'cp', value: 30 }, after: { type: 'cp', value: 250 } });
    expect(facts).toContainEqual({ kind: 'evalSwing', fromCp: 30, toCp: -250 });
  });

  it('stays quiet about small changes', () => {
    const facts = moveFacts(fen, 'a1a2', { before: { type: 'cp', value: 30 }, after: { type: 'cp', value: -60 } });
    expect(kinds(facts)).not.toContain('evalSwing');
  });

  it('turns mate scores into large values, nearer mates being larger', () => {
    expect(scoreToCp({ type: 'mate', value: 1 })).toBeGreaterThan(scoreToCp({ type: 'mate', value: 3 }));
    expect(scoreToCp({ type: 'mate', value: 3 })).toBeGreaterThan(5000);
    expect(scoreToCp({ type: 'mate', value: -2 })).toBeLessThan(-5000);
    expect(scoreToCp({ type: 'mate', value: 0 })).toBeLessThan(scoreToCp({ type: 'mate', value: -2 }));
    expect(scoreToCp({ type: 'cp', value: -42 })).toBe(-42);
  });
});

describe('moveFacts: input', () => {
  it('rejects an illegal move', () => {
    expect(() => moveFacts('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1b2')).toThrow(/illegal/);
  });
});
