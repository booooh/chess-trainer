import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Color } from './core/game';
import { HintCoach } from './core/hints';
import { MaiaOpponent } from './core/opponent';
import { GameSession } from './core/session';
import { Board } from './ui/Board';
import { DEFAULT_ELO, type ColorChoice } from './ui/gameOptions';
import { NewGameForm } from './ui/NewGameForm';
import { PlayScreen } from './ui/PlayScreen';
import type { AppServices } from './ui/services';
import './App.css';

type Playing = { session: GameSession; hints: HintCoach; elo: number };

type AppProps = {
  services: AppServices;
  /** Start games from this position instead of the usual one (see `practiceFen`). */
  startFen?: string;
};

export default function App({ services, startFen }: AppProps) {
  const model = useSyncExternalStore(services.modelStatus.subscribe, services.modelStatus.get);
  const [color, setColor] = useState<ColorChoice>('white');
  const [elo, setElo] = useState(DEFAULT_ELO);
  const [playing, setPlaying] = useState<Playing | null>(null);

  // Stop waiting for Maia if the game screen goes away.
  useEffect(
    () => () => {
      playing?.session.dispose();
      playing?.hints.dispose();
    },
    [playing],
  );

  const start = (choice: { color: ColorChoice; elo: number }) => {
    const userColor: Color = choice.color === 'random' ? (services.random() < 0.5 ? 'white' : 'black') : choice.color;
    const session = new GameSession({
      userColor,
      opponent: new MaiaOpponent(services.predictor, { elo: choice.elo, random: services.random }),
      startFen,
      onFinished: (record) => services.repository.save(record).catch((err) => console.error('Saving the game failed', err)),
    });
    const hints = new HintCoach(
      { engine: services.engine, predictor: services.predictor },
      // We don't know the user's rating yet, so the opponent's stands in for it.
      { userColor, userElo: choice.elo, opponentElo: choice.elo, onLevel: (level) => session.noteHint(level) },
    );
    setElo(choice.elo);
    setPlaying({ session, hints, elo: choice.elo });
    void session.start();
  };

  return (
    <main className="app">
      <h1 className="app-title">Chess Trainer</h1>
      {playing ? (
        <PlayScreen session={playing.session} hints={playing.hints} elo={playing.elo} onNewGame={() => setPlaying(null)} />
      ) : (
        <>
          <Board fen={startFen} orientation={color === 'black' ? 'black' : 'white'} />
          <NewGameForm color={color} elo={elo} onColorChange={setColor} onStart={start} />
        </>
      )}
      {model.state === 'loading' && (
        <p className="model-status">
          {model.progress === null ? 'Loading Maia…' : `Downloading Maia… ${Math.round(model.progress * 100)}%`}
        </p>
      )}
      {model.state === 'failed' && <p className="model-status error">Couldn't load Maia: {model.message}</p>}
      <footer className="app-footer">
        Free software under the AGPL-3.0 · <a href="https://github.com/booooh/chess-trainer">Source code</a>
      </footer>
    </main>
  );
}
