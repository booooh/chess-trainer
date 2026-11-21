import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Engine, Line } from '../core/engine';
import { Game, type Uci } from '../core/game';
import { HintCoach } from '../core/hints';
import type { HumanMovePredictor } from '../core/opponent';
import { GameSession, type MoveChecker, type Opponent } from '../core/session';
import { CoachingChecker } from '../core/whyNot';
import { PlayScreen } from './PlayScreen';

describe('PlayScreen: blunder warning', () => {
  function setup() {
    const opponent: Opponent = { elo: 1100, chooseMove: async () => 'e7e5' };
    const checker: MoveChecker = {
      prepare: () => {},
      check: async (_position, uci) => (uci === 'f2f3' ? { kind: 'blunder', text: 'This weakens your king.', square: 'f3' } : null),
    };
    const session = new GameSession({ userColor: 'white', opponent, moveChecker: checker });
    const hints = new HintCoach(
      { engine: { analyse: async () => [] }, predictor: { predict: async () => new Map() } },
      { userColor: 'white', userElo: 1100, opponentElo: 1100 },
    );
    render(<PlayScreen session={session} hints={hints} elo={1100} onNewGame={() => {}} />);
    return { session };
  }

  it('asks before playing a blunder; "Take it back" returns to your move', async () => {
    const user = userEvent.setup();
    const { session } = setup();
    await act(() => session.playUserMove('f2f3'));

    const warning = screen.getByRole('alertdialog', { name: 'Are you sure?' });
    expect(warning).toHaveTextContent('This weakens your king.');
    expect(screen.queryByRole('button', { name: 'Hint' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    await user.click(within(warning).getByRole('button', { name: 'Take it back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your move');
    expect(screen.getByRole('list', { name: 'Moves' })).toBeEmptyDOMElement();
  });

  it('"Play anyway" plays it, and Maia replies', async () => {
    const user = userEvent.setup();
    const { session } = setup();
    await act(() => session.playUserMove('f2f3'));
    await user.click(screen.getByRole('button', { name: 'Play anyway' }));
    expect(await screen.findByText('1. f3 e5')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('PlayScreen: "why not?"', () => {
  // Nc7+ forks the king on e8 and the queen on a6; Kd2 lets the queen take the knight.
  const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
  const at = (...moves: Uci[]) => {
    const g = new Game(FORK);
    for (const m of moves) g.play(m);
    return g.fen;
  };
  const line = (value: number, ...pv: Uci[]): Line => ({ move: pv[0]!, score: { type: 'cp', value }, pv, depth: 12 });
  const answers = new Map<string, Line[]>([
    [FORK, [line(650, 'b5c7', 'e8d7', 'c7a6')]],
    [at('b5c7', 'e8d7'), [line(700, 'c7a6', 'd7c6')]],
    [at('e1d2'), [line(850, 'a6b5', 'h2h4')]],
    [at('e1d2', 'a6b5'), [line(-850, 'h2h4')]],
  ]);
  const replies = new Map<string, Uci>([
    [at('b5c7'), 'e8d7'],
    [at('b5c7', 'e8d7', 'c7a6'), 'd7c6'],
    [at('e1d2'), 'a6b5'],
  ]);
  const engine: Engine = { analyse: async (fen) => answers.get(fen) ?? [] };
  const predictor: HumanMovePredictor = { predict: async ({ fen }) => new Map([[replies.get(fen)!, 1]]) };

  it('explains why your move is worse than the hint’s; "Go back" brings the hint back', async () => {
    const user = userEvent.setup();
    const hints = new HintCoach({ engine, predictor }, { userColor: 'white', userElo: 1100, opponentElo: 1100, startFen: FORK });
    const checker = new CoachingChecker(
      { engine, predictor },
      {
        hint: () => (hints.state.status === 'shown' ? hints.state.line : null),
        request: { userColor: 'white', userElo: 1100, opponentElo: 1100, startFen: FORK },
      },
    );
    const opponent: Opponent = { elo: 1100, chooseMove: async () => 'e8d7' };
    const session = new GameSession({ userColor: 'white', opponent, startFen: FORK, moveChecker: checker });
    render(<PlayScreen session={session} hints={hints} elo={1100} onNewGame={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Hint' }));
    expect(await screen.findByText('There’s a fork here.')).toBeInTheDocument();

    await act(() => session.playUserMove('e1d2'));
    const why = await screen.findByRole('alertdialog', { name: 'Why not Kd2?' });
    expect(within(why).getByRole('list')).toHaveTextContent(
      'After Kd2, most players reply Qxb5, taking your knight.' +
        'Overall you lose material worth about 3 pawns.' +
        'Nc7+ was better: it forks the king and the queen.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('There was a better move');

    await user.click(within(why).getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hint' })).toHaveTextContent('There’s a fork here.');

    await act(() => session.playUserMove('b5c7')); // the hint's move: no questions asked
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByText('1. Nc7+ Kd7')).toBeInTheDocument();
  });

  it('"Continue" plays your move after all', async () => {
    const user = userEvent.setup();
    const checker: MoveChecker = {
      prepare: () => {},
      check: () => ({ kind: 'whyNot', steps: ['Nc7+ was better.'], better: { from: 'b5', to: 'c7', san: 'Nc7+' } }),
    };
    const opponent: Opponent = { elo: 1100, chooseMove: async () => 'a6b5' };
    const session = new GameSession({ userColor: 'white', opponent, startFen: FORK, moveChecker: checker });
    const hints = new HintCoach({ engine, predictor }, { userColor: 'white', userElo: 1100, opponentElo: 1100 });
    render(<PlayScreen session={session} hints={hints} elo={1100} onNewGame={() => {}} />);
    await act(() => session.playUserMove('e1d2'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('1. Kd2 Qxb5')).toBeInTheDocument();
  });
});
