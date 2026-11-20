# 0005 — Openings stored as a position-keyed graph
Status: Accepted

## Context
We track openings and lines played with both colours, suggest new ones (Explore) or repeat
known ones (Deepen). The same position is often reached by different move orders (transpositions).

## Decision
- Node key = FEN without the move counters (fields 1–4).
- Store derived stats per `(positionKey, userColor)`: times seen, results, child moves played.
- Opening name = deepest node on the game's path that matches the ECO dataset.
- Stats are **derived from games** and can always be rebuilt (supports v2 sync and bug fixes).
- Opponent steering in Explore/Deepen reweights Maia probabilities and never forces a move
  below a probability floor.

## Alternatives considered
- **Move-list tree (one path per line):** simpler, but the same position appears in several
  places, so stats are split and wrong.
- **Zobrist hash keys:** compact but opaque when debugging. Could replace FEN keys later
  behind the same function.

## Consequences
+ Correct merging of transpositions; simple to query "have I seen this position?".
− Graph, not tree: UI code that draws "the tree" must handle multiple parents.
