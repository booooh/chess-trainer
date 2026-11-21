import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Square } from '../core/game';
import type { HintCoach, HintState } from '../core/hints';
import type { GameSession, SessionState } from '../core/session';
import { Board, type BoardShape } from './Board';

const PROMOTION_PIECES = [
  ['q', 'Queen'],
  ['r', 'Rook'],
  ['b', 'Bishop'],
  ['n', 'Knight'],
] as const;

function statusText(s: SessionState): string {
  const you = s.userColor;
  if (s.review?.status === 'checking') return 'Checking your move…';
  if (s.review) return s.review.warning.kind === 'blunder' ? 'Are you sure?' : 'There was a better move.';
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

/** Level 2 circles the piece to move; level 3 draws the move as an arrow. */
function hintShapes(h: HintState): BoardShape[] {
  if (h.status !== 'shown' || h.level < 2) return [];
  const { from, to } = h.text.move;
  return h.level >= 3 ? [{ orig: from, dest: to }] : [{ orig: from }];
}

function hintButtonLabel(h: HintState): string | null {
  switch (h.status) {
    case 'thinking':
      return 'Thinking…';
    case 'shown':
      return h.level < 4 ? 'More help' : null;
    case 'none':
      return null;
    default:
      return 'Hint';
  }
}

type Props = { session: GameSession; hints: HintCoach; elo: number; onNewGame: () => void };

export function PlayScreen({ session, hints, elo, onNewGame }: Props) {
  const s = useSyncExternalStore(session.subscribe, () => session.state);
  const hint = useSyncExternalStore(hints.subscribe, () => hints.state);
  const [promotion, setPromotion] = useState<[Square, Square] | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  // A move under review may end the game, but isn't final until the user confirms it.
  const over = s.status.kind !== 'playing' && !s.review;
  const yourTurn = !over && !s.thinking && !s.review && s.turn === s.userColor;
  const warning = s.review?.status === 'warning' ? s.review.warning : undefined;
  const hintShapesNow = useMemo(() => hintShapes(hint), [hint]);
  // A blunder circles the piece left hanging in red; "why not?" shows the better move as an arrow.
  const warningShapes = useMemo<BoardShape[]>(() => {
    if (warning?.kind === 'whyNot') return [{ orig: warning.better.from, dest: warning.better.to }];
    return warning?.square ? [{ orig: warning.square, brush: 'red' }] : [];
  }, [warning]);
  const shapes = warning ? warningShapes : yourTurn ? hintShapesNow : undefined;
  const hintLabel = yourTurn ? hintButtonLabel(hint) : null;

  // A hint belongs to one position: hide it as soon as a move is made, and bring it back if
  // the move is taken back ("Go back" after "why not?").
  const { fen, moves } = s;
  useEffect(() => hints.moveTo({ fen, moves }), [hints, fen, moves]);

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
        shapes={shapes}
      />
      <section className="panel play" aria-label="Game">
        <p className="opponent">
          You ({s.userColor}) vs Maia {elo}
        </p>
        <p className="status" role="status">
          {s.error ? `Maia couldn't move: ${s.error}` : statusText(s)}
          {s.inCheck && !over && !s.thinking && !s.review && <strong className="check"> Check!</strong>}
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

        {warning?.kind === 'blunder' && (
          <section className="warning-panel" role="alertdialog" aria-label="Are you sure?">
            <p>{warning.text}</p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => session.reconsider()}>
                Take it back
              </button>
              <button type="button" onClick={() => void session.playAnyway()}>
                Play anyway
              </button>
            </div>
          </section>
        )}

        {warning?.kind === 'whyNot' && (
          <section className="warning-panel" role="alertdialog" aria-label={`Why not ${s.san.at(-1)}?`}>
            <ol className="explanation">
              {warning.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="actions">
              <button type="button" className="primary" onClick={() => session.reconsider()}>
                Go back
              </button>
              <button type="button" onClick={() => void session.playAnyway()}>
                Continue
              </button>
            </div>
          </section>
        )}

        {yourTurn && (hint.status === 'shown' || hint.status === 'failed') && (
          <section className="hint-panel" aria-label="Hint">
            {hint.status === 'failed' ? (
              <p>Couldn’t get a hint: {hint.message}</p>
            ) : (
              <>
                <p>{hint.text.nudge}</p>
                {hint.level >= 2 && <p>{hint.text.piece.text}</p>}
                {hint.level >= 3 && <p>{hint.text.move.text}</p>}
                {hint.level >= 4 && (
                  <ol className="explanation" aria-label="Explanation">
                    {hint.text.explanation.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        )}

        <ol className="moves" aria-label="Moves">
          {moveRows(s.san).map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ol>

        <div className="actions">
          {hintLabel && (
            <button
              type="button"
              disabled={hint.status === 'thinking'}
              onClick={() => void hints.more({ fen: s.fen, moves: s.moves })}
            >
              {hintLabel}
            </button>
          )}
          {s.error && (
            <button type="button" className="primary" onClick={() => void session.retryOpponent()}>
              Retry
            </button>
          )}
          {!over && (
            <button
              type="button"
              disabled={!s.canTakeBack}
              onClick={() => {
                setPromotion(null);
                session.takeBack();
              }}
            >
              Undo
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
