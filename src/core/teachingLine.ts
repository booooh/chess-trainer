// The teaching line (DESIGN §5.2): the sequence a hint shows, built from Stockfish for the
// user's moves and Maia for the opponent's, because a human opponent at this level rarely
// finds the engine's best defence.
import type { Engine, Line, Score } from './engine';
import { moveFacts, scoreToCp, type Fact } from './facts';
import { Game, type Uci } from './game';
import type { HumanMovePredictor } from './opponent';

export type TeachingPly = {
  uci: Uci;
  san: string;
  /** Who plays this move: the user being taught, or their opponent. */
  side: 'you' | 'opponent';
  /** The position before the move. */
  fenBefore: string;
  facts: Fact[];
};

export type TeachingLine = {
  /** The line to show: the user's move, the opponent's most likely reply, and onwards. */
  plies: TeachingPly[];
  /**
   * When the opponent's likely reply isn't Stockfish's best defence, the best defence and
   * what follows, starting from the opponent's reply (so it replaces `plies[1]` onwards).
   */
  bestDefence: { plies: TeachingPly[] } | null;
  /** Stockfish's evaluation of the chosen first move, from the user's point of view. */
  score: Score;
};

export type TeachingLineRequest = {
  /** The position where the user is to move. */
  fen: string;
  /** Moves from the start of the game to `fen` (Maia uses recent ones as context). */
  moves: readonly Uci[];
  /** The position `moves` start from, if the game didn't start from the usual one. */
  startFen?: string;
  userElo: number;
  opponentElo: number;
};

export type TeachingLineOptions = {
  /** Candidates within this many centipawns of the best count as equally good. Default 30. */
  marginCp?: number;
  /** Thinking time for the first analysis (several candidates). Default 1200 ms. */
  firstMovetimeMs?: number;
  /** Thinking time for each later move of the user's in the line. Default 400 ms. */
  followMovetimeMs?: number;
  /** Lines stop at the first quiet ply from this length on. Default 3. */
  minPlies?: number;
  /** Lines never go beyond this, even mid-exchange. Default 7. */
  maxPlies?: number;
};

type Deps = { engine: Engine; predictor: HumanMovePredictor };

/**
 * Builds the line a hint teaches, or null if the user has no legal move.
 *
 * 1. The user's move: among Stockfish's candidates within `marginCp` of the best, prefer one
 *    with a clear motif (a fork, or winning material), then the one Maia thinks a player at
 *    the user's rating is most likely to find, then Stockfish's order.
 * 2. Opponent replies: Maia's most likely move at the opponent's rating. If the first reply
 *    isn't Stockfish's best defence, the best defence is kept as `bestDefence`.
 * 3. The user's later moves: Stockfish's best move.
 * 4. Length: at least `minPlies`, then stop at the first ply that is neither a capture nor a
 *    check (so the line doesn't stop mid-exchange), and never beyond `maxPlies`.
 */
export async function buildTeachingLine(
  req: TeachingLineRequest,
  { engine, predictor }: Deps,
  options: TeachingLineOptions = {},
  signal?: AbortSignal,
): Promise<TeachingLine | null> {
  const { marginCp = 30, firstMovetimeMs = 1200, followMovetimeMs = 400, minPlies = 3, maxPlies = 7 } = options;
  const lines = await engine.analyse(req.fen, { multiPv: 3, movetimeMs: firstMovetimeMs }, signal);
  if (lines.length === 0) return null;

  const chosen = await chooseFirstMove(req, lines, marginCp, predictor, signal);
  const done = (plies: TeachingPly[]) =>
    plies.length >= maxPlies || (plies.length >= minPlies && !isForcing(plies.at(-1)!.san));

  // The main line: Stockfish for the user, Maia for the opponent.
  const game = new Game(req.fen);
  const history = [...req.moves];
  const plies: TeachingPly[] = [];
  let userScore = chosen.score; // the engine's view of the user's last move, from the user's side
  let userMove: Uci = chosen.move;
  let firstReply: Uci | undefined;

  for (;;) {
    // The user's move.
    plies.push(play(game, history, userMove, 'you', { before: userScore, after: flip(userScore) }));
    if (done(plies) || game.isOver) break;

    // The opponent's reply.
    const probs = await predictor.predict(
      { fen: game.fen, moves: [...history], ...startFrom(req), selfElo: req.opponentElo, oppoElo: req.userElo },
      signal,
    );
    const reply = mostLikely(probs);
    if (!reply) break;
    firstReply ??= reply;
    const fenBeforeReply = game.fen;
    plies.push(play(game, history, reply, 'opponent'));
    if (done(plies) || game.isOver) break;

    // The user's next move, from a fresh (shorter) analysis.
    const [best] = await engine.analyse(game.fen, { multiPv: 1, movetimeMs: followMovetimeMs }, signal);
    if (!best) break;
    // Now the engine has judged the opponent's reply, add the eval swing it caused (if any).
    plies.at(-1)!.facts = moveFacts(fenBeforeReply, reply, { before: flip(userScore), after: best.score });
    userScore = best.score;
    userMove = best.move;
  }

  const bestReply = chosen.pv[1];
  const missedBest = firstReply !== undefined && bestReply !== undefined && firstReply !== bestReply;
  return {
    plies,
    bestDefence: missedBest ? { plies: followPv(req, chosen, done) } : null,
    score: chosen.score,
  };
}

/** Picks the user's move to teach (see buildTeachingLine). */
async function chooseFirstMove(
  req: TeachingLineRequest,
  lines: Line[],
  marginCp: number,
  predictor: HumanMovePredictor,
  signal?: AbortSignal,
): Promise<Line> {
  const bestCp = scoreToCp(lines[0]!.score);
  const candidates = lines.filter((l) => bestCp - scoreToCp(l.score) <= marginCp);
  if (candidates.length === 1) return candidates[0]!;

  const probs = await predictor.predict(
    { fen: req.fen, moves: req.moves, ...startFrom(req), selfElo: req.userElo, oppoElo: req.opponentElo },
    signal,
  );
  const ranked = candidates.map((line, order) => ({
    line,
    order,
    motif: hasMotif(moveFacts(req.fen, line.move)),
    likelihood: probs.get(line.move) ?? 0,
  }));
  ranked.sort((a, b) => Number(b.motif) - Number(a.motif) || b.likelihood - a.likelihood || a.order - b.order);
  return ranked[0]!.line;
}

/** Maia replays `moves` from the start position, so it needs to know a custom one. */
const startFrom = (req: TeachingLineRequest) => (req.startFen ? { startFen: req.startFen } : {});

const hasMotif = (facts: Fact[]) =>
  facts.some((f) => f.kind === 'fork' || (f.kind === 'materialChange' && f.deltaCp > 0));

/** Captures (`x`) and checks (`+`, `#`) keep an exchange or an attack going. */
const isForcing = (san: string) => /[x+#]/.test(san);

function mostLikely(probs: ReadonlyMap<Uci, number>): Uci | undefined {
  let best: [Uci, number] | undefined;
  for (const entry of probs) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0];
}

/**
 * A score from the side to move's point of view, seen by the other side after the move is
 * played. Mate counts shrink by one when the mating side has made its move.
 */
function flip(score: Score): Score {
  if (score.type === 'cp') return { type: 'cp', value: -score.value };
  return { type: 'mate', value: score.value > 0 ? -(score.value - 1) : -score.value };
}

function play(
  game: Game,
  history: Uci[],
  uci: Uci,
  side: TeachingPly['side'],
  evals?: { before: Score; after: Score },
): TeachingPly {
  const fenBefore = game.fen;
  const facts = moveFacts(fenBefore, uci, evals);
  const { san } = game.play(uci);
  history.push(uci);
  return { uci, san, side, fenBefore, facts };
}

/** The best-defence branch: Stockfish's own line from the opponent's first reply onwards. */
function followPv(req: TeachingLineRequest, chosen: Line, done: (plies: TeachingPly[]) => boolean): TeachingPly[] {
  const game = new Game(req.fen);
  const history = [...req.moves];
  const counted: TeachingPly[] = [play(game, history, chosen.move, 'you')];
  for (const [i, uci] of chosen.pv.slice(1).entries()) {
    if (done(counted) || game.isOver) break;
    counted.push(play(game, history, uci, i % 2 === 0 ? 'opponent' : 'you'));
  }
  return counted.slice(1);
}
