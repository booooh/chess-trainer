import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import type { Engine, Line } from './core/engine';
import { Game } from './core/game';
import type { HumanMovePredictor } from './core/opponent';
import type { GameRecord, GameRepository } from './core/records';
import { ModelStatusStore, type AppServices } from './ui/services';

function fakeServices(overrides: Partial<AppServices> = {}) {
  const saved: GameRecord[] = [];
  const repository: GameRepository = {
    save: async (r) => void saved.push(r),
    list: async () => saved,
  };
  // Always plays the first listed move for whichever side is to move.
  const predictor: HumanMovePredictor = {
    predict: async ({ fen }) => new Map([[fen.includes(' w ') ? 'e2e4' : 'e7e5', 1]]),
  };
  const engine: Engine = { analyse: async () => [] };
  const modelStatus = new ModelStatusStore();
  modelStatus.set({ state: 'ready' });
  const services: AppServices = { predictor, engine, repository, modelStatus, random: () => 0, ...overrides };
  return { services, saved };
}

describe('App', () => {
  it('shows the title, the board in the starting position and a source link', () => {
    render(<App services={fakeServices().services} />);
    expect(screen.getByRole('heading', { name: 'Chess Trainer' })).toBeInTheDocument();
    const board = screen.getByTestId('board');
    // chessground keeps a hidden "ghost" piece for drag previews; it isn't on the board.
    expect(board.querySelectorAll('piece:not(.ghost)')).toHaveLength(32);
    expect(board.querySelectorAll('piece.white:not(.ghost)')).toHaveLength(16);
    expect(board.querySelectorAll('piece.black:not(.ghost)')).toHaveLength(16);
    const link = screen.getByRole('link', { name: /source code/i });
    expect(link).toHaveAttribute('href', 'https://github.com/booooh/chess-trainer');
  });

  it('offers a new game: colour choice and opponent strength (default 1100)', () => {
    render(<App services={fakeServices().services} />);
    const setup = screen.getByRole('form', { name: 'New game' });
    for (const name of ['White', 'Black', 'Random']) {
      expect(within(setup).getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(within(setup).getByRole('radio', { name: 'White' })).toBeChecked();
    expect(within(setup).getByRole('combobox', { name: /opponent strength/i })).toHaveValue('1100');
    expect(within(setup).getByRole('button', { name: 'Start game' })).toBeEnabled();
  });

  it('as black, Maia moves first and then it is your move', async () => {
    const user = userEvent.setup();
    render(<App services={fakeServices().services} />);
    await user.click(screen.getByRole('radio', { name: 'Black' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /opponent strength/i }), '800');
    await user.click(screen.getByRole('button', { name: 'Start game' }));

    expect(await screen.findByText('Your move')).toBeInTheDocument();
    expect(screen.getByText(/vs Maia 800/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Moves' })).toHaveTextContent('1. e4');
    expect(screen.queryByRole('form', { name: 'New game' })).not.toBeInTheDocument();
  });

  it('resigning needs a confirmation, ends and saves the game, then offers a new one', async () => {
    const user = userEvent.setup();
    const { services, saved } = fakeServices();
    render(<App services={services} />);
    await user.click(screen.getByRole('button', { name: 'Start game' }));
    await screen.findByText('Your move');

    await user.click(screen.getByRole('button', { name: 'Resign' }));
    expect(screen.queryByText(/you resigned/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm resign' }));

    expect(await screen.findByText('You resigned. Maia wins.')).toBeInTheDocument();
    await waitFor(() => expect(saved.map((g) => g.result)).toEqual(['0-1']));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByRole('form', { name: 'New game' })).toBeInTheDocument();
  });

  it('shows Maia download progress until the model is ready', () => {
    const modelStatus = new ModelStatusStore();
    modelStatus.set({ state: 'loading', progress: 0.4 });
    render(<App services={fakeServices({ modelStatus }).services} />);
    expect(screen.getByText('Downloading Maia… 40%')).toBeInTheDocument();
    act(() => modelStatus.set({ state: 'ready' }));
    expect(screen.queryByText(/Downloading Maia/)).not.toBeInTheDocument();
  });

  it("explains when Maia can't move, and can retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    const predictor: HumanMovePredictor = {
      predict: async () => (fail ? Promise.reject(new Error('worker crashed')) : new Map([['e2e4', 1]])),
    };
    render(<App services={fakeServices({ predictor }).services} />);
    await user.click(screen.getByRole('radio', { name: 'Black' }));
    await user.click(screen.getByRole('button', { name: 'Start game' }));
    expect(await screen.findByText(/Maia couldn't move: worker crashed/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Your move')).toBeInTheDocument();
  });

  describe('hints', () => {
    // Nc7+ forks the king on e8 and the queen on a6.
    const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
    const afterMoves = (...moves: string[]) => {
      const g = new Game(FORK);
      for (const m of moves) g.play(m);
      return g.fen;
    };
    const line = (value: number, ...pv: string[]): Line => ({ move: pv[0]!, score: { type: 'cp', value }, pv, depth: 12 });
    const engine: Engine = {
      analyse: async (fen) =>
        new Map<string, Line[]>([
          [FORK, [line(650, 'b5c7', 'e8d7', 'c7a6')]],
          [afterMoves('b5c7', 'e8d7'), [line(700, 'c7a6', 'd7c6')]],
        ]).get(fen) ?? [],
    };
    const predictor: HumanMovePredictor = {
      predict: async ({ fen }) => new Map([[fen === afterMoves('b5c7') ? 'e8d7' : 'd7c6', 1]]),
    };

    it('each press reveals one more level, and the game records the highest', async () => {
      const user = userEvent.setup();
      const { services, saved } = fakeServices({ engine, predictor });
      render(<App services={services} startFen={FORK} />);
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      await screen.findByText('Your move');

      await user.click(screen.getByRole('button', { name: 'Hint' }));
      const hint = await screen.findByRole('region', { name: 'Hint' });
      expect(await within(hint).findByText('There’s a fork here.')).toBeInTheDocument();
      expect(within(hint).queryByText(/knight on b5/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'More help' }));
      expect(within(hint).getByText('Look at your knight on b5.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'More help' }));
      expect(within(hint).getByText('Play Nc7+.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'More help' }));
      const steps = within(hint).getByRole('list', { name: 'Explanation' });
      expect(steps).toHaveTextContent('Nc7+ is a fork: the knight attacks the king and the queen at the same time.');
      expect(screen.queryByRole('button', { name: 'More help' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Resign' }));
      await user.click(screen.getByRole('button', { name: 'Confirm resign' }));
      await waitFor(() => expect(saved[0]?.hintsUsed).toEqual([{ ply: 0, level: 4 }]));
      expect(saved[0]!.startFen).toBe(FORK);
      expect(screen.queryByRole('button', { name: 'Hint' })).not.toBeInTheDocument(); // game over
    });

    it('shows that it is thinking, then explains a failure and lets you try again', async () => {
      const user = userEvent.setup();
      let fail = true;
      let finish: () => void = () => {};
      const flaky: Engine = {
        analyse: (fen, options, signal) =>
          fail
            ? new Promise((_, reject) => (finish = () => reject(new Error('Stockfish didn’t start within 30 s'))))
            : engine.analyse(fen, options, signal),
      };
      render(<App services={fakeServices({ engine: flaky, predictor }).services} startFen={FORK} />);
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      await screen.findByText('Your move');

      await user.click(screen.getByRole('button', { name: 'Hint' }));
      expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled();
      act(() => finish());
      expect(await screen.findByText('Couldn’t get a hint: Stockfish didn’t start within 30 s')).toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole('button', { name: 'Hint' }));
      expect(await screen.findByText('There’s a fork here.')).toBeInTheDocument();
    });
  });
});
