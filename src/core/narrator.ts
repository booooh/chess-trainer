// The template narrator (DESIGN §5.1, §5.3): turns a teaching line and its facts into the text
// of each hint level. Deterministic and offline, so a hint always appears; LLM narrators can
// rephrase the same facts later (ADR-0004), but may not add to them.
import type { Blunder } from './blunders';
import { Board, materialBalance, otherColor, type Piece, type PieceType } from './board';
import { hangingPieces, scoreToCp, type Fact } from './facts';
import { Game, type Color, type DrawReason, type Square } from './game';
import type { TeachingLine, TeachingPly } from './teachingLine';

export type HintText = {
  /** Level 1: what kind of moment it is, without naming the move. */
  nudge: string;
  /** Level 2: the piece to move. */
  piece: { square: Square; text: string };
  /** Level 3: the move itself. */
  move: { from: Square; to: Square; text: string };
  /** Level 4: the line, one sentence per step, then a summary and the best defence. */
  explanation: string[];
};

const NAMES: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Smallest engine score (centipawns, user's view) at which we say material is really won. */
const WINNING_CP = 100;

export function narrate(line: TeachingLine, { fen, userColor }: { fen: string; userColor: Color }): HintText {
  const first = line.plies[0]!;
  const from = first.uci.slice(0, 2);
  const to = first.uci.slice(2, 4);
  const mover = Board.fromFen(fen).get(from)!;
  // The engine has to agree before we say material is won: a fork can still lose the piece
  // later (e.g. a knight trapped in the corner after taking the rook).
  const engineAgrees = scoreToCp(line.score) >= WINNING_CP;

  return {
    nudge: nudge(line, fen, userColor, engineAgrees),
    piece: { square: from, text: `Look at your ${NAMES[mover.type]} on ${from}.` },
    move: { from, to, text: `Play ${first.san}.` },
    explanation: explain(line, fen, userColor, engineAgrees),
  };
}

const DRAWS: Record<DrawReason, string> = {
  stalemate: 'This is stalemate',
  threefoldRepetition: 'This repeats the position a third time',
  insufficientMaterial: 'This leaves too little material to checkmate',
  fiftyMoves: 'This reaches the fifty-move rule',
};

/** The blunder warning's text: why the move the user is about to play is a mistake. */
export function describeBlunder(b: Blunder): string {
  switch (b.kind) {
    case 'allowsMate':
      return b.inMoves === 1
        ? 'After this, your opponent can checkmate you in one move.'
        : `After this, your opponent has a forced checkmate in ${b.inMoves} moves.`;
    case 'missesMate':
      return b.inMoves === 1
        ? 'You can checkmate in one move, and this isn’t it.'
        : `You have a forced checkmate in ${b.inMoves} moves, and this move lets it slip.`;
    case 'draws':
      return `${DRAWS[b.reason]}: the game ends in a draw, though you stand better.`;
    case 'hangs':
      return `This leaves your ${NAMES[b.piece.type]} on ${b.square} to be taken.`;
    case 'loses': {
      const pawns = Math.max(1, Math.round(b.lossCp / 100));
      const worth = pawns === 1 ? 'a pawn’s' : `${pawns} pawns’`;
      return `This loses about ${worth} worth compared with the best move.`;
    }
  }
}

/**
 * The concrete reasons a "why not?" explanation can give, as typed facts (ADR-0004). Each is
 * null when there's nothing specific to say; then only Stockfish's numbers are left.
 */
export type WhyNotReasons = {
  /** What goes wrong after the user's move. */
  yours:
    | { kind: 'allowsMate' }
    | { kind: 'losesMaterial'; cp: number }
    | { kind: 'leavesHanging'; piece: Piece; square: Square }
    | null;
  /** What the hint's move does instead. */
  better:
    | { kind: 'checkmate' }
    | { kind: 'forcesMate'; inMoves: number }
    | { kind: 'fork'; targets: PieceType[] }
    | { kind: 'winsMaterial'; cp: number }
    | null;
};

/** Why the user's line (`yours`) is worse than the hint's, as far as the facts can say. */
export function whyNotReasons(hint: TeachingLine, yours: TeachingLine, { fen, userColor }: { fen: string; userColor: Color }): WhyNotReasons {
  const [mine, reply] = yours.plies;
  let mistake: WhyNotReasons['yours'] = null;
  const lost = -netMaterial(fen, yours.plies, userColor);
  const leftHanging = find(mine!.facts, 'hanging');
  if (yours.score.type === 'mate' && yours.score.value < 0) mistake = { kind: 'allowsMate' };
  else if (lost >= 100 && scoreToCp(yours.score) <= -100) mistake = { kind: 'losesMaterial', cp: lost };
  else if (leftHanging && leftHanging.piece.color === userColor && !capturedPiece(reply ?? mine!)) {
    mistake = { kind: 'leavesHanging', piece: leftHanging.piece, square: leftHanging.square };
  }

  const first = hint.plies[0]!;
  const fork = find(first.facts, 'fork');
  const won = netMaterial(fen, hint.plies, userColor);
  let better: WhyNotReasons['better'] = null;
  if (first.san.endsWith('#')) better = { kind: 'checkmate' };
  else if (hint.score.type === 'mate' && hint.score.value > 0) better = { kind: 'forcesMate', inMoves: hint.score.value };
  else if (fork) {
    const board = Board.fromFen(first.fenBefore);
    better = { kind: 'fork', targets: fork.targets.map((sq) => board.get(sq)!.type) };
  } else if (won >= 100 && scoreToCp(hint.score) >= WINNING_CP) better = { kind: 'winsMaterial', cp: won };
  return { yours: mistake, better };
}

/**
 * "Why not?" (DESIGN §5.4): why the move the user played (`yours`) is worse than the hint's
 * (`hint`). Both lines start in `fen`. First what goes wrong after the user's move, then what
 * the hint's move does instead. Deliberately short: the hint's own explanation has the rest.
 */
export function explainWhyNot(hint: TeachingLine, yours: TeachingLine, context: { fen: string; userColor: Color }): string[] {
  const steps: string[] = [];
  const [mine, reply] = yours.plies;
  if (reply) {
    const taken = capturedPiece(reply);
    steps.push(`After ${mine!.san}, most players reply ${reply.san}${taken ? `, taking your ${NAMES[taken.type]}` : ''}.`);
  } else if (mine!.san.endsWith('#')) {
    steps.push(`${mine!.san} is checkmate too.`);
  } else {
    steps.push(`After ${mine!.san}, the game is over.`);
  }

  const reasons = whyNotReasons(hint, yours, context);
  const mistake = reasons.yours;
  if (mistake?.kind === 'allowsMate') steps.push('From there your opponent can force checkmate.');
  else if (mistake?.kind === 'losesMaterial') steps.push(`Overall you lose material worth about ${pawns(mistake.cp)}.`);
  else if (mistake?.kind === 'leavesHanging') steps.push(`Your ${NAMES[mistake.piece.type]} on ${mistake.square} is left to be taken.`);

  steps.push(`${hint.plies[0]!.san} was better: ${whyBetter(reasons.better, hint, yours)}.`);
  return steps;
}

function whyBetter(better: WhyNotReasons['better'], hint: TeachingLine, yours: TeachingLine): string {
  switch (better?.kind) {
    case 'checkmate':
      return 'it’s checkmate';
    case 'forcesMate':
      return `it forces checkmate in ${better.inMoves} moves`;
    case 'fork':
      return `it forks ${list(better.targets.map((t) => `the ${NAMES[t]}`))}`;
    case 'winsMaterial':
      return `it wins material worth about ${pawns(better.cp)}`;
    default: {
      const diff = Math.min(1000, scoreToCp(hint.score)) - Math.max(-1000, scoreToCp(yours.score));
      return diff < 100 ? 'Stockfish rates it a little higher' : `Stockfish rates it about ${pawns(diff)} higher`;
    }
  }
}

/** "a pawn", "3 pawns" (centipawns, rounded). */
function pawns(cp: number): string {
  const n = Math.max(1, Math.round(cp / 100));
  return n === 1 ? 'a pawn' : `${n} pawns`;
}

function nudge(line: TeachingLine, fen: string, userColor: Color, engineAgrees: boolean): string {
  const first = line.plies[0]!;
  if (first.san.endsWith('#')) return 'You can checkmate in one move.';
  if (line.score.type === 'mate' && line.score.value > 0) return `There’s a forced checkmate in ${line.score.value} moves.`;
  if (find(first.facts, 'fork')) return 'There’s a fork here.';
  const ownHanging = hangingPieces(fen).find((f) => f.kind === 'hanging' && f.piece.color === userColor);
  if (ownHanging?.kind === 'hanging') return `Your ${NAMES[ownHanging.piece.type]} on ${ownHanging.square} is under attack.`;
  const gain = find(first.facts, 'materialChange');
  if (gain && gain.deltaCp > 0 && engineAgrees) return 'You can win material.';
  if (first.san.includes('+')) return 'Look for a check.';
  return 'No tactic here: look for a move that improves your position.';
}

function explain(line: TeachingLine, fen: string, userColor: Color, engineAgrees: boolean): string[] {
  const steps: string[] = [];
  const { plies } = line;
  plies.forEach((ply, i) => {
    if (i === 0) steps.push(firstStep(ply));
    else if (ply.side === 'opponent') steps.push(opponentStep(ply, i, line.bestDefence !== null));
    else steps.push(laterStep(ply, plies[i + 1]));
  });

  if (!plies.at(-1)!.san.endsWith('#')) {
    const net = netMaterial(fen, plies, userColor);
    if (net >= 100 && engineAgrees) {
      const pawns = Math.round(net / 100);
      steps.push(`Overall you win material worth about ${pawns} ${pawns === 1 ? 'pawn' : 'pawns'}.`);
    }
  }
  if (line.bestDefence) {
    const [reply, ...rest] = line.bestDefence.plies.map((p) => p.san);
    steps.push(`The best defence is ${reply}${rest.length ? `, then ${rest.join(', ')}` : ''}.`);
  }
  return steps;
}

function firstStep(ply: TeachingPly): string {
  const fork = find(ply.facts, 'fork');
  if (fork) {
    const before = Board.fromFen(ply.fenBefore);
    const targets = fork.targets.map((sq) => `the ${NAMES[before.get(sq)!.type]}`);
    return `${ply.san} is a fork: the ${NAMES[fork.by.type]} attacks ${list(targets)} at the same time.`;
  }
  if (ply.san.endsWith('#')) return `${ply.san} is checkmate.`;
  const captured = capturedPiece(ply);
  if (captured) return `${ply.san} takes the ${NAMES[captured.type]}.`;
  if (ply.san.includes('+')) return `${ply.san} gives check.`;
  return `Play ${ply.san}.`;
}

function opponentStep(ply: TeachingPly, index: number, branched: boolean): string {
  if (index === 1) return branched ? `Most players reply ${ply.san}.` : `The best reply is ${ply.san}.`;
  const captured = capturedPiece(ply);
  return captured ? `Then ${ply.san} takes your ${NAMES[captured.type]}.` : `Then ${ply.san}.`;
}

function laterStep(ply: TeachingPly, next: TeachingPly | undefined): string {
  if (ply.san.endsWith('#')) return `Then ${ply.san} is checkmate.`;
  const captured = capturedPiece(ply);
  if (captured) {
    // If the line takes straight back on the same square, it's a trade, not a win.
    const recaptured = next !== undefined && next.uci.slice(2, 4) === ply.uci.slice(2, 4) && next.san.includes('x');
    return `Then ${ply.san} ${recaptured ? 'takes' : 'wins'} the ${NAMES[captured.type]}.`;
  }
  if (ply.san.includes('+')) return `Then ${ply.san} gives check.`;
  return `Then ${ply.san}.`;
}

/** The piece standing on the destination square, if the move captures it. */
function capturedPiece(ply: TeachingPly): Piece | undefined {
  if (!ply.san.includes('x')) return undefined;
  const board = Board.fromFen(ply.fenBefore);
  // En passant captures a pawn that isn't on the destination square.
  return board.get(ply.uci.slice(2, 4)) ?? { color: otherColor(board.get(ply.uci.slice(0, 2))!.color), type: 'p' };
}

/** Material gained by the user over the whole line, in centipawns. */
function netMaterial(fen: string, plies: TeachingPly[], userColor: Color): number {
  const game = new Game(fen);
  for (const p of plies) game.play(p.uci);
  const sign = userColor === 'white' ? 1 : -1;
  return sign * (materialBalance(Board.fromFen(game.fen)) - materialBalance(Board.fromFen(fen)));
}

function find<K extends Fact['kind']>(facts: Fact[], kind: K): Extract<Fact, { kind: K }> | undefined {
  return facts.find((f): f is Extract<Fact, { kind: K }> => f.kind === kind);
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
