# Working on this repo

## Read first
- `docs/DESIGN.md` is the source of truth for architecture and phases.
- `docs/adr/` records why each decision was made. Don't contradict an accepted ADR; write a
  new one that supersedes it, and update the index in `docs/adr/README.md`.

## Workflow: red-green-refactor
1. **Red:** write a failing test for the next small behaviour. Run it and confirm it fails
   for the expected reason.
2. **Green:** write the minimum code to pass. Run the full test suite.
3. **Refactor** with tests green.
Commit each green step with a clear message. Don't commit failing tests to `main`.

## Conventions
- `src/core/` is pure TypeScript with no React imports, and is unit-tested with Vitest.
- Heavy work (Stockfish, Maia, LLMs) runs in Web Workers behind typed interfaces, so tests use fakes.
- Before pushing, run lint, type-check, tests and build (the same steps as CI).
- Work on feature branches and open pull requests into `main`.

## Owner context
Ben is comfortable with TypeScript/React and new to backends (v2 backend will be Rust).
This is a learning project: explain non-obvious design choices in docs or PR descriptions.
