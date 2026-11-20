import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './Board.css';

type BoardProps = {
  /** Passed straight to chessground. Phase 1 drives this from the game controller. */
  config?: Config;
};

/**
 * Thin React wrapper around chessground. chessground manages its own DOM, so React only
 * owns the container element; we create the board once and push config changes into it.
 */
export function Board({ config }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, config);
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // Created once on mount; later config changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (config) api.current?.set(config);
  }, [config]);

  return (
    <div className="board-frame">
      <div ref={el} className="board" data-testid="board" />
    </div>
  );
}
