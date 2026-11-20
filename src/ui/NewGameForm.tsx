import { useState } from 'react';
import { ELO_CHOICES, type ColorChoice } from './gameOptions';

type Props = {
  color: ColorChoice;
  elo: number;
  onColorChange: (c: ColorChoice) => void;
  onStart: (choice: { color: ColorChoice; elo: number }) => void;
};

export function NewGameForm({ color, elo: initialElo, onColorChange, onStart }: Props) {
  const [elo, setElo] = useState(initialElo);
  return (
    <form
      aria-label="New game"
      className="panel new-game"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ color, elo });
      }}
    >
      <fieldset className="segmented">
        <legend>Play as</legend>
        {(['white', 'black', 'random'] as const).map((c) => (
          <label key={c} className={color === c ? 'selected' : undefined}>
            <input type="radio" name="color" value={c} checked={color === c} onChange={() => onColorChange(c)} />
            {c[0]!.toUpperCase() + c.slice(1)}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Opponent strength</span>
        <select value={elo} onChange={(e) => setElo(Number(e.target.value))}>
          {ELO_CHOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Maia uses Lichess ratings, which usually run a few hundred points above chess.com at this level.
      </p>
      <button type="submit" className="primary">
        Start game
      </button>
    </form>
  );
}
