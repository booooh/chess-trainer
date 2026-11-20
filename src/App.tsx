import { Board } from './ui/Board';
import './App.css';

export default function App() {
  return (
    <main className="app">
      <h1 className="app-title">Chess Trainer</h1>
      <Board />
      <footer className="app-footer">
        Free software under the AGPL-3.0 ·{' '}
        <a href="https://github.com/booooh/chess-trainer">Source code</a>
      </footer>
    </main>
  );
}
