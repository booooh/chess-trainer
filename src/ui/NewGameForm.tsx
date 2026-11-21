import { useState } from 'react';
import { ELO_CHOICES, type ColorChoice, type GameChoice } from './gameOptions';

type Props = {
  color: ColorChoice;
  elo: number;
  onColorChange: (c: ColorChoice) => void;
  onStart: (choice: GameChoice) => void;
};

export function NewGameForm({ color, elo: initialElo, onColorChange, onStart }: Props) {
  const [elo, setElo] = useState(initialElo);
  const [warnBlunders, setWarnBlunders] = useState(false);
  return (
    <form
      aria-label="New game"
      className="panel new-game"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ color, elo, warnBlunders });
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
      <label className="check-field">
        <input type="checkbox" checked={warnBlunders} onChange={(e) => setWarnBlunders(e.target.checked)} />
        Warn me before a blunder
      </label>
      <button type="submit" className="primary">
        Start game
      </button>
    </form>
  );
}
