import { useState, useSyncExternalStore } from 'react';
import type { Square } from '../core/game';
import type { GameSession, SessionState } from '../core/session';
import { Board } from './Board';

const PROMOTION_PIECES = [
  ['q', 'Queen'],
  ['r', 'Rook'],
  ['b', 'Bishop'],
  ['n', 'Knight'],
] as const;

function statusText(s: SessionState): string {
  const you = s.userColor;
  switch (s.status.kind) {
    case 'playing':
      return s.thinking ? 'Maia is thinking…' : 'Your move';
    case 'checkmate':
      return s.status.winner === you ? 'Checkmate. You win!' : 'Checkmate. Maia wins.';
    case 'resigned':
      return s.status.winner === you ? 'Maia resigned. You win!' : 'You resigned. Maia wins.';
    case 'draw':
      return {
        stalemate: 'Draw by stalemate.',
        insufficientMaterial: 'Draw: not enough material to checkmate.',
        threefoldRepetition: 'Draw by threefold repetition.',
        fiftyMoves: 'Draw by the fifty-move rule.',
      }[s.status.reason];
  }
}

/** Pairs SAN moves into numbered rows: "1. e4 e5". */
function moveRows(san: readonly string[]): string[] {
  const rows: string[] = [];
  for (let i = 0; i < san.length; i += 2) rows.push(`${i / 2 + 1}. ${san.slice(i, i + 2).join(' ')}`);
  return rows;
}

type Props = { session: GameSession; elo: number; onNewGame: () => void };

export function PlayScreen({ session, elo, onNewGame }: Props) {
  const s = useSyncExternalStore(session.subscribe, () => session.state);
  const [promotion, setPromotion] = useState<[Square, Square] | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const over = s.status.kind !== 'playing';

  const play = (uci: string) => {
    // An illegal move just leaves the position as it was; the board re-syncs from state.
    session.playUserMove(uci).catch(() => {});
  };
  const onMove = (from: Square, to: Square) =>
    session.isPromotion(from, to) ? setPromotion([from, to]) : play(from + to);

  return (
    <>
      <Board
        fen={s.fen}
        orientation={s.userColor}
        turnColor={s.turn}
        lastMove={s.lastMove}
        check={s.inCheck && !over}
        dests={promotion ? new Map() : s.dests}
        userColor={s.userColor}
        onMove={onMove}
      />
      <section className="panel play" aria-label="Game">
        <p className="opponent">
          You ({s.userColor}) vs Maia {elo}
        </p>
        <p className="status" role="status">
          {s.error ? `Maia couldn't move: ${s.error}` : statusText(s)}
          {s.inCheck && !over && !s.thinking && <strong className="check"> Check!</strong>}
        </p>

        {promotion && (
          <div className="promotion" role="group" aria-label="Promote to">
            {PROMOTION_PIECES.map(([p, name]) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPromotion(null);
                  play(promotion[0] + promotion[1] + p);
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <ol className="moves" aria-label="Moves">
          {moveRows(s.san).map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ol>

        <div className="actions">
          {s.error && (
            <button type="button" className="primary" onClick={() => void session.retryOpponent()}>
              Retry
            </button>
          )}
          {over ? (
            <button type="button" className="primary" onClick={onNewGame}>
              New game
            </button>
          ) : confirmResign ? (
            <>
              <button type="button" className="danger" onClick={() => session.resign()}>
                Confirm resign
              </button>
              <button type="button" onClick={() => setConfirmResign(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmResign(true)}>
              Resign
            </button>
          )}
        </div>
      </section>
    </>
  );
}
