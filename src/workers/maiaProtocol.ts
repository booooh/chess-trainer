// Messages between the app and the Maia Web Worker. Shared by both sides so they can't drift.
import type { Uci } from '../core/game';

export type ToWorker =
  | { type: 'load' }
  | { type: 'predict'; id: number; fen: string; moves: Uci[]; selfElo: number; oppoElo: number };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'loadFailed'; message: string }
  | { type: 'prediction'; id: number; probabilities: [Uci, number][] }
  | { type: 'predictionFailed'; id: number; message: string };
