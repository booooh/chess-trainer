# `src/core`

Pure TypeScript domain logic: game controller, coach, facts extractor, narrators, openings
(see `docs/DESIGN.md` §2). No React, no chessground, no DOM-only APIs, so everything here is
unit-tested with Vitest and could later be ported or reused by the v2 backend.

ESLint enforces the "no React / no UI imports" rule for this folder. Heavy work (Stockfish,
Maia, LLMs) is reached through typed interfaces backed by Web Workers, so tests use fakes.

Empty until phase 1.
