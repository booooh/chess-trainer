# 0003 — Maia-3 for human-like opponents
Status: Accepted

## Context
The user is ~800 (chess.com). Practice is most useful against opponents who make human-style
mistakes. The original Maia models cover 1100–1900 as separate networks. Maia-2 and Maia-3
are single networks conditioned on rating. The Maia authors now recommend Maia-3 for new
projects, and browser-ready ONNX exports exist.

## Decision
- Opponent = Maia-3 (smallest variant first, ~20 MB) running on ONNX Runtime Web in a worker.
- Default opponent strength 1100; user-adjustable within what the model supports.
- Pick moves by **sampling** from Maia's probabilities (with a low-probability cutoff), not
  always the top move, for variety.
- Maia also predicts "natural" opponent replies for the teaching line (DESIGN §5.2).

## Alternatives considered
- **Original Maia 1100 network:** fine fallback; needs the lc0 input encoding (112×8×8 planes)
  implemented in TS. Keep it as plan B if Maia-3 web inference turns out too slow on the phone.
- **Limited Stockfish:** unnatural play (see ADR-0002).

## Consequences
+ Realistic opponents; one model covers all strengths, so there's no file switching.
+ Same model powers natural replies in explanations.
− Strength floor around 1100 is accepted for v1. *Test early how it behaves at lower settings.*
− Depends on a community npm wrapper (`maia3-js`) or our own inference code. Pin versions,
  and keep a thin `OpponentEngine` interface so we can swap it out.
− Check the model's license before release.
