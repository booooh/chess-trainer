import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HintCoach } from '../core/hints';
import { GameSession, type MoveChecker, type Opponent } from '../core/session';
import { PlayScreen } from './PlayScreen';

describe('PlayScreen: blunder warning', () => {
  function setup() {
    const opponent: Opponent = { elo: 1100, chooseMove: async () => 'e7e5' };
    const checker: MoveChecker = {
      prepare: () => {},
      check: async (_fen, uci) => (uci === 'f2f3' ? { text: 'This weakens your king.', square: 'f3' } : null),
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
