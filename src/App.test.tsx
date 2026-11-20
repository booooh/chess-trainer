import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('shows the app title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Chess Trainer' })).toBeInTheDocument();
  });

  it('shows a board in the starting position', () => {
    render(<App />);
    const board = screen.getByTestId('board');
    // chessground keeps a hidden "ghost" piece for drag previews; it isn't on the board.
    expect(board.querySelectorAll('piece:not(.ghost)')).toHaveLength(32);
    expect(board.querySelectorAll('piece.white:not(.ghost)')).toHaveLength(16);
    expect(board.querySelectorAll('piece.black:not(.ghost)')).toHaveLength(16);
  });

  it('links to its source code (required by the AGPL, ADR-0008)', () => {
    render(<App />);
    const link = screen.getByRole('link', { name: /source code/i });
    expect(link).toHaveAttribute('href', 'https://github.com/booooh/chess-trainer');
  });
});
