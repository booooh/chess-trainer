# Architecture Decision Records (ADRs)

An ADR is a short note recording **one** important design decision: the context, what we
chose, what we rejected, and what it costs us. They're numbered and never rewritten. If a
decision changes, write a new ADR that *supersedes* the old one. Over time this explains
*why* the code looks the way it does, which code alone can't.

Template:

```
# NNNN — Title
Status: Proposed | Accepted | Superseded by NNNN
## Context    — the problem and the forces at play
## Decision   — what we chose
## Alternatives considered
## Consequences — good and bad
```

| # | Decision | Status |
|---|---|---|
| [0001](0001-client-only-pwa.md) | v1 is a client-only PWA, no backend | Accepted |
| [0002](0002-stockfish-wasm-worker.md) | Stockfish as WASM in a Web Worker, analysis only | Accepted |
| [0003](0003-maia-opponents.md) | Maia-3 for human-like opponents | Accepted |
| [0004](0004-facts-then-narrate.md) | Explanations: deterministic facts, then pluggable narrators | Accepted |
| [0005](0005-position-keyed-opening-tree.md) | Openings stored as a position-keyed graph | Accepted |
| [0006](0006-rust-backend-v2.md) | Rust backend for v2 sync | Proposed |
