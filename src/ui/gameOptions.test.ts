import { describe, expect, it } from 'vitest';
import { practiceFen } from './gameOptions';

describe('practiceFen', () => {
  it('reads a position from the ?fen= URL parameter', () => {
    const fen = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
    expect(practiceFen(`?fen=${encodeURIComponent(fen)}`)).toBe(fen);
    // URLSearchParams turns "+" into a space, which FENs use between fields.
    expect(practiceFen('?fen=4k3/7p/q7/1N6/8/8/7P/4K3+w+-+-+0+1')).toBe(fen);
  });

  it('ignores a missing, invalid or finished position', () => {
    expect(practiceFen('')).toBeUndefined();
    expect(practiceFen('?fen=not-a-position')).toBeUndefined();
    // Checkmate: nothing to play.
    expect(practiceFen(`?fen=${encodeURIComponent('3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 1')}`)).toBeUndefined();
  });
});
