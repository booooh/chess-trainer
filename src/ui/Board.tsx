import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { Color, Square } from '../core/game';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './Board.css';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type BoardProps = {
  fen?: string;
  orientation?: Color;
  turnColor?: Color;
  lastMove?: [Square, Square];
  /** Highlight the king of the side to move. */
  check?: boolean;
  /** Squares the user may move from → to. Empty means the board is read-only. */
  dests?: ReadonlyMap<Square, Square[]>;
  /** Which colour the user moves (needed for chessground's movable.color). */
  userColor?: Color;
  onMove?: (from: Square, to: Square) => void;
};

/**
 * Thin React wrapper around chessground. chessground manages its own DOM, so React only
 * owns the container element: the board is created once, and prop changes are pushed into
 * it with `api.set()`. The board shows positions; the rules live in `src/core`.
 */
export function Board({
  fen = START_FEN,
  orientation = 'white',
  turnColor = 'white',
  lastMove,
  check = false,
  dests,
  userColor,
  onMove,
}: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  // chessground keeps the callback it was given; route through a ref so it's never stale.
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      animation: { duration: 200 },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: { free: false, events: { after: (from, to) => onMoveRef.current?.(from, to) } },
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const canMove = !!dests && dests.size > 0;
    api.current?.set({
      fen,
      orientation,
      turnColor,
      lastMove: lastMove as Key[] | undefined,
      check: check ? turnColor : false,
      movable: {
        color: canMove ? userColor : undefined,
        dests: canMove ? (dests as Map<Key, Key[]>) : new Map(),
      },
    });
  }, [fen, orientation, turnColor, lastMove, check, dests, userColor]);

  return (
    <div className="board-frame">
      <div ref={el} className="board" data-testid="board" />
    </div>
  );
}
