# 0002 — Stockfish as WASM in a Web Worker, analysis only
Status: Accepted

## Context
We need a strong engine to judge positions and find tactics, running on a phone in a browser.

## Decision
- Use a Stockfish WebAssembly build inside a dedicated Web Worker, controlled over UCI.
- Start with the **single-threaded** build.
- Stockfish is used for **analysis only**. The opponent is Maia (ADR-0003).
- Wrap it in a typed `EngineClient` (`analyse(fen, {multiPv, movetimeMs}) → Promise<Line[]>`)
  with a request queue and cancellation, since only one search can run at a time.

## Alternatives considered
- **Multi-threaded build:** faster, but needs `SharedArrayBuffer`, which browsers only allow
  on pages served with COOP/COEP headers ("cross-origin isolation"). GitHub Pages can't set
  headers; Cloudflare Pages can (`_headers` file). Deferred until profiling shows we need it.
- **Server-side engine:** needs a backend (rejected in ADR-0001).
- **Stockfish with `UCI_Elo` as the opponent:** plays unnaturally (mostly perfect moves with
  random blunders), so it's poor practice for human play.

## Consequences
+ Offline, free, strong enough at a 1–1.5 s budget.
+ The UI never blocks: the worker runs in parallel.
− Stockfish is GPLv3, so the app must be GPLv3. That's fine, since it's open source anyway.
− Battery use during long analysis; keep the hint budget short and don't analyse continuously.
