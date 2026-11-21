// Parsing for the UCI ("Universal Chess Interface") text protocol that Stockfish speaks.
// While it searches, the engine prints lines like
//   info depth 13 multipv 2 score cp 23 nodes 189749 time 300 pv d2d4 e5d4 f3d4
// and when it's done, `bestmove d2d4`. Pure functions, so they're tested on real output.
import type { Uci } from './game';
import type { Line, Score } from './engine';

export type InfoLine = { multiPv: number; depth: number; score: Score; pv: Uci[] };

/**
 * Reads an `info` line that carries a finished candidate line (a score plus a `pv`).
 * Returns null for everything else: `info string`, `currmove` progress, provisional
 * `lowerbound`/`upperbound` scores, and the depth-0 line printed when there are no moves.
 */
export function parseInfo(line: string): InfoLine | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info' || tokens[1] === 'string') return null;

  let multiPv = 1;
  let depth: number | null = null;
  let score: Score | null = null;
  let pv: Uci[] = [];
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        depth = Number(tokens[++i]);
        break;
      case 'multipv':
        multiPv = Number(tokens[++i]);
        break;
      case 'score': {
        const type = tokens[++i];
        const value = Number(tokens[++i]);
        if (type === 'cp' || type === 'mate') score = { type, value };
        break;
      }
      case 'lowerbound':
      case 'upperbound':
        return null;
      case 'pv':
        // `pv` is always last: everything after it is the line.
        pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }
  if (depth === null || score === null || pv.length === 0) return null;
  return { multiPv, depth, score, pv };
}

/** The move from `bestmove e2e4 [ponder e7e5]`, or null for `(none)` and non-bestmove lines. */
export function parseBestMove(line: string): Uci | null {
  const [keyword, move] = line.trim().split(/\s+/);
  if (keyword !== 'bestmove' || !move || move === '(none)') return null;
  return move;
}

/**
 * Turns the output of one search into candidate lines, best first.
 *
 * Stockfish reports each MultiPV slot again at every depth, so the latest line per slot
 * wins. If the search stops partway through a depth, some slots are one depth behind, and
 * a stale slot can repeat a move that has since moved up; that duplicate is dropped.
 */
export function collectLines(output: Iterable<string>): Line[] {
  const slots = new Map<number, InfoLine>();
  for (const line of output) {
    const info = parseInfo(line);
    if (info) slots.set(info.multiPv, info);
  }
  const ordered = [...slots.values()].sort((a, b) => a.multiPv - b.multiPv);
  const result: Line[] = [];
  for (const info of ordered) {
    const move = info.pv[0]!;
    const existing = result.findIndex((l) => l.move === move);
    const line: Line = { move, score: info.score, pv: info.pv, depth: info.depth };
    if (existing === -1) result.push(line);
    else if (info.depth > result[existing]!.depth) result[existing] = line;
  }
  return result;
}
