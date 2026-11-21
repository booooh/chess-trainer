# Project status and handoff

Last updated: 2026-11-21, phase 2b built: Undo, blunder warning (both checked on the phone) and "why not?" (draft PR #9, branch `phase-2b-undo`). Next: Ben checks "why not?" on the phone, merge, then phase 3.
Read this first when picking the project up in a new session, then `DESIGN.md` and the ADRs.

## Where things stand

| Phase | State | Notes |
|---|---|---|
| 0. Skeleton | ✅ Done (PR #2) | Installs on the phone; CI runs on every PR |
| 1. Play | ✅ Done (PRs #3, #4, #5) | Ben played a full game against Maia 1100 on a Pixel 10 |
| 2. Hints | ✅ Done (PRs #6, #7, #8) | Ben checked hints on the phone; done-when e2e passes |
| 2b. Coaching while playing | 🚧 **Built, in review** (draft PR #9) | Undo ✅ and blunder warning ✅ (Ben checked on the phone); "why not?" built, done-when e2e passes; phone check pending |
| 3–6, v1.x, v2 | Not started | See `DESIGN.md` §9 |

**Live app:** https://chess-trainer-dri.pages.dev (Cloudflare Pages, ADR-0009). It deploys from `main`
only after CI passes, and every PR from this repo gets a preview at
`https://<branch-name>.chess-trainer-dri.pages.dev`, linked in a PR comment. The Pages project is
named `chess-trainer`, but that `pages.dev` subdomain was taken, so Cloudflare added `-dri`;
`https://chess-trainer.pages.dev` is someone else's site. The old address,
https://booooh.github.io/chess-trainer/, now shows a "moved" page.

### What the app does today
- New game: play as White, Black or Random against Maia-3 rated 400–1500 (Lichess scale, default 1100).
- Play by dragging or tapping, with legal-move dots, last move, check, and a promotion picker. Maia replies from a Web Worker
  (about 30 ms per move on a Pixel 10).
- Status line, move list, resign (with confirmation), retry if Maia fails, and model download progress.
- Finished games are saved to IndexedDB (`chess-trainer` database, `games` table, DESIGN §7 format).
- AGPL-3.0 with a "Source code" link (ADR-0008). Installable PWA that works offline once Maia is cached.
- **Hints** (phase 2): on your turn, Hint shows a nudge; More help reveals the piece (circled), the move
  (arrow), then the line explained step by step. The highest level per move goes in `hintsUsed`.
- **"Why not?"** (phase 2b, always on): after a hint, a different move that's clearly worse (≥ half
  a pawn, or a forced mate let go) is held back, but only if there's a concrete reason to give
  (material, a piece left to be taken, a mate, a fork) or it loses ≥ 2 pawns. The panel explains what goes wrong after your
  move and why the hint's move is better (shown as an arrow), with *Go back* (the hint comes
  back) or *Continue*.
- **Blunder warning** (phase 2b, "Warn me before a blunder" on the new-game form, off by default):
  a move that loses ≥ 2 pawns versus the best, allows a forced mate, misses a mate in ≤ 3,
  throws a better position away with a draw, or leaves a piece to be won is held back with
  "Are you sure?", the reason, *Take it back* and *Play anyway*. A hanging piece is circled in red.
- **Undo** (phase 2b): takes back your move and Maia's reply (only your move if she's still
  thinking, which cancels her reply). Only while the game is on. The record counts take-backs.
- **Practice positions:** `?fen=<FEN>` in the URL starts games from that position (invalid or
  finished positions are ignored). Games record it as `startFen`.

### Known limitations (deliberately left out so far)
- A game in progress is lost on reload; only finished games are saved.
- No screen lists saved games yet (comes with phase 3 or 6).
- No draw offers or clocks (timed play is v1.x). No undo after the game ends (the record is saved by then).
- The opponent never plays moves Maia rates under 2% (`DEFAULT_FLOOR` in `src/core/opponent.ts`).
  That makes it slightly stronger than in the spike's measurements. Tune by feel.
- The default rating of 1100 is a guess. Maia uses Lichess ratings, which run higher than chess.com's (`docs/spikes/maia-3.md`).

## Code map

```
src/core/      Pure TS, no React (lint-enforced)
  game.ts        Game: rules via chess.js, UCI moves, legal dests, status/result, PGN
  opponent.ts    HumanMovePredictor interface, sampleMove (2% floor), MaiaOpponent
  session.ts     GameSession: turns, opponent calls, resign, retry, emits GameRecord once
  records.ts     GameRecord type + GameRepository interface
  engine.ts      Engine interface (analyse → Line[]), Score/Line types, lazyEngine
  uci.ts         Parses Stockfish's UCI output (info/bestmove) into Lines
  board.ts       Tactics board: attack maps (x-rays via "gone" squares), SEE, material
  facts.ts       Facts extractor: moveFacts (material, fork, newly hanging, eval swing), hangingPieces
  teachingLine.ts buildTeachingLine: Stockfish for the user, Maia for the opponent, best-defence branch
  narrator.ts    Template narrator: the text of the four hint levels
  hints.ts       HintCoach: the hint ladder (one more level per press), per position
  blunders.ts    assessMove (is this move a blunder? as typed facts), BlunderChecker (engine side)
  whyNot.ts      isClearlyWorse, CoachingChecker: "why not?" after a hint, else the blunder check
src/workers/   maia.worker.ts (Maia-3 via onnxruntime-web), maiaClient.ts (request ids, abort,
               crash handling), maiaProtocol.ts (message types), download.ts (progress),
               stockfishClient.ts (queue, stop/abort, start-up timeout; stockfish.js itself is
               the worker and speaks raw UCI, so there's no protocol file or worker file),
               nodeStockfish.testutil.ts (real Stockfish in Node for tests)
src/storage/   gameRepository.ts: Dexie implementation (add-only: games are immutable)
src/ui/        Board (chessground wrapper), NewGameForm, PlayScreen, services (dependency
               injection: real ones in browserServices.ts, fakes in tests), gameOptions
e2e/           Playwright on an emulated Pixel 7 against the production build (real Maia, real Stockfish)
spikes/maia/   strength.ts: re-runnable Maia strength-by-rating measurement (Node + Stockfish)
```

Tests: 196 unit (Vitest; two use real Stockfish in Node) and 11 e2e (Playwright). CI is `.github/workflows/ci.yml`, with jobs
`check` → `e2e` → `deploy` (`main` only).

## Phase 2 plan: Hints

Goal (DESIGN §9): *a level-4 hint explains a fork correctly.* Work in this order, each step test-first
(CLAUDE.md), on feature branches with PRs.

### Step 1: Move hosting to Cloudflare Pages with PR previews (ADR-0009)
Gives every later phase 2 PR a preview link you can open on the phone before merging.

**Done (PR #6):**
- Ben created the API token (*Account → Cloudflare Pages → Edit*) and added the repository
  secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- `ci.yml`: the `e2e` job uploads the `dist/` it tested; `deploy` downloads it and runs
  `wrangler pages deploy` (`cloudflare/wrangler-action@v4`, Wrangler pinned to 4.166.0) for pushes
  to `main` (production) and PRs from this repo (preview), after `check` and `e2e`. Fork PRs are
  skipped. The first run creates the `chess-trainer` Pages project through the Cloudflare API if
  it doesn't exist. One PR comment holds the preview links and is edited on each push. Runs on
  `main` now queue instead of cancelling each other, so a production deploy is never cut off.
- `BASE_PATH` removed (served at `/`). `public/_headers` makes `/assets/*` immutable; everything
  else keeps Cloudflare's default (revalidate each time). No COOP/COEP.
- Cloudflare's per-file limit is still 25 MiB (checked 2026-11-20); the largest file is the Maia
  model at 21.5 MiB.
- `legacy/github-pages/` + manual workflow `github-pages-moved.yml`: a "moved" page for the old
  address, plus a `sw.js` that deletes the old app's caches and unregisters its service worker.
  Without it, a phone with the app installed keeps serving the cached old app forever. Checked in
  Chromium: the first visit after the swap shows the old app, which reloads itself into the
  "moved" page with no service worker or caches left.
- ADR-0009 Accepted, ADR-0007 Superseded, README "Deployment" and DESIGN §3 updated.

- Checked: the first deploy created the project. The preview and production both work
  (Ben, on the phone), and `/assets/*` is served with `immutable`.

- Ben ran the "moved" workflow; the old address now shows the "moved" page.

**Later (housekeeping):** turn GitHub Pages off (Settings → Pages), then delete
`github-pages-moved.yml`, `legacy/` and the `github-pages` environment.

### Step 2: Stockfish engine worker (DESIGN §4.1, ADR-0002)
**Done (draft PR #8, branch `phase-2-stockfish-engine`):**
- `stockfish` 19.0.1 is a dependency (pinned). The app uses the **lite single-threaded** build:
  `stockfish-19-lite-single.js` (28 KB) + `.wasm` (1.8 MB, 1.2 MB compressed). GPL-3.0, compatible with
  our AGPL (ADR-0008).
- **The wasm pitfall** (stockfish.js finds its `.wasm` by swapping `.js` → `.wasm` in its own URL):
  - First attempt: Vite-hashed names plus the wasm URL in the worker URL's `#hash`, which
    stockfish.js reads first. **It broke whenever the service worker served the script from its
    cache**: the worker's location then has no hash, so the wasm name was guessed wrong and the
    engine never started. On a phone that's every visit after the first. Fresh-browser e2e tests
    missed it; the hint e2e test now reloads so the service worker is in control.
  - Now: a Vite plugin (`stockfishEngine` in `vite.config.ts`) publishes
    `engine/stockfish-<version>-lite-single.{js,wasm}` with matching names (served from
    node_modules in dev). `_headers` caches `/engine/*` as immutable; the version busts it.
- `Engine` (in `src/core/engine.ts`): `analyse(fen, { multiPv, movetimeMs }, signal) → Line[]`, with
  `Line = { move, score: {type:'cp'|'mate', value}, pv, depth }`. Scores are from the side to
  move's point of view (UCI convention). Checkmate and stalemate give `[]`.
- `uci.ts` parses real Stockfish output: the latest line per MultiPV slot wins (a stopped
  search leaves slots at different depths), provisional `lowerbound`/`upperbound` lines are
  skipped, and a stale slot that repeats a move is dropped.
- `StockfishClient`: waits for `uciok`, runs one search at a time, resends MultiPV only when it
  changes. Abort: a queued request is dropped; the running one gets `stop`, and the next search
  waits for its `bestmove`. Refuses FENs and options that could inject UCI commands.
  **A missing wasm raises no error event, the engine just never answers**, so a 30 s start-up
  timeout rejects everything instead of leaving a hint spinning forever.
- `services.engine` is a `lazyEngine`: the worker starts on the first `analyse`, so nobody downloads
  Stockfish until the hint UI asks for it.

**Still to do:**
- Measure on the Pixel 10 once the hint UI exists: depth reached in 1–1.5 s, and the first
  start-up time (download + compile). For reference, in Node in the cloud container: depth 13–16 in 300 ms.

**Follow-up (not urgent): offline wasm.** `.wasm` files aren't precached or runtime-cached by the
service worker (`globIgnores` in `vite.config.ts`). Offline they're served from the browser's HTTP
cache, which works on Cloudflare thanks to `immutable` (checked: ORT's wasm loads offline on
production after one visit), but the browser may evict it under storage pressure. A Workbox
`runtimeCaching` CacheFirst rule for `/assets/*.wasm` would make it as durable as the Maia model.

### Step 3: Facts extractor (DESIGN §5.3, ADR-0004)
**Done (draft PR #8):**
- `board.ts`: own attack maps rather than chess.js, because an exchange needs "who attacks this
  square once these pieces are gone" (x-rays). `see()` = static exchange evaluation: cheapest
  capture first, either side may stop, a king only captures on an undefended square. Pins and en
  passant are ignored (the usual SEE simplification).
- `facts.ts`, `moveFacts(fen, uci, evals?)` returns, in order:
  - `materialChange` for the mover (captures, promotions);
  - `fork` by the moved piece: ≥2 targets, each the king or a non-pawn piece it would win
    material by taking; not a fork if the forker can itself be won (e.g. a check the queen takes);
  - `hanging` pieces the move newly leaves winnable, either side's (SEE gain > 0);
  - `evalSwing` from the mover's point of view, only if it changes by ≥100 cp (configurable).
- `hangingPieces(fen)` for a whole position (for the level-1 nudge "your knight is hanging").
- Mate scores map to ±10000 minus the distance to mate (`scoreToCp`).
- Not yet: pins, skewers, mate threats, opening principles.

**Lesson for the narrator:** facts are about the *position*, not the outcome. In
`r3k3/7p/8/1N6/…` Nc7+ is a real fork, but after Nxa8 the knight is trapped in the corner and
Stockfish says the position is equal. Teaching lines only pick moves Stockfish rates near the
best, which guards against most of this; the narrator should still only say "wins material"
when the eval agrees.

### Step 4: Teaching line (DESIGN §5.2)
**Done (draft PR #8)**, `buildTeachingLine(request, { engine, predictor }, options, signal)`:
- **Your move:** Stockfish candidates (MultiPV 3, 1.2 s) within 30 cp of the best; a mate is only
  "equal" to other mates. Prefer a motif (fork or material won), then the move Maia gives the
  highest probability at the *user's* rating, then Stockfish's order.
- **Opponent replies:** Maia's most likely move at the opponent's rating. If the first reply
  isn't Stockfish's best defence, `bestDefence` holds Stockfish's own line from that reply on
  (no extra engine time).
- **Your later moves:** Stockfish best move, 0.4 s each. A typical hint costs ~1.6–2 s of
  engine time; all timings are options.
- **Length:** ≥3 plies, then stop at the first ply that is neither capture nor check; cap 7;
  stop if the game ends.
- Each ply carries its facts; an opponent reply that loses ground gets an `evalSwing`.
- Integration test with real Stockfish: the queen fork Nc7+ is taught, then Nxa6.
- **Test gotcha:** the Node build of Stockfish calls its listener synchronously, mid-command;
  sending `go` from inside that call crashes the wasm (`RuntimeError: unreachable`). Browser
  Workers can't do this (messages arrive from the event loop), so the test adapter delivers
  lines with `queueMicrotask`.

### Step 5: Template narrator and hint ladder UI (DESIGN §5.1, §5.3)
**Done (draft PR #8):**
- `narrator.ts` (template narrator, never fails): `narrate(line, { fen, userColor })` gives
  - level 1 nudge, first match wins: mate in one / forced mate in N / fork / your piece under
    attack / you can win material / look for a check / "no tactic: improve your position";
  - level 2 "Look at your knight on b5." (circle), level 3 "Play Nc7+." (arrow);
  - level 4 steps: the fork and its targets, "Most players reply …" (Maia ≠ best) or "The best
    reply is …", captures as "wins" or "takes" (taken straight back = a trade), a material
    summary, and the best defence. **Material is only claimed when Stockfish's score is ≥ +100.**
- `hints.ts`, `HintCoach`: first press builds the line (button shows "Thinking…"), later presses
  reveal levels without analysing again; a new position starts over; failures are shown with
  the reason and retried on the next press; each level shown calls `session.noteHint`.
- `GameSession.noteHint` keeps the highest level per ply → `GameRecord.hintsUsed`
  (`ply` indexes `moves`). Hints are only offered on the user's turn; the panel and shapes
  disappear as soon as a move is made.
- `Board` takes `shapes` (chessground `setAutoShapes`, green brush).
- The user's rating isn't known, so the opponent's rating stands in for "which move would a
  human find" (`userElo` in HintCoach).
- **Done-when e2e** (`e2e/hints.spec.ts`, real Stockfish + real Maia, service worker in control):
  in `4k3/7p/q7/1N6/8/8/7P/4K3 w`, level 4 says "Nc7+ is a fork: the knight attacks the king and
  the queen at the same time" and "Then Nxa6 wins the queen". A hint takes ~2.5 s there.
- **Bug found by it:** maia3-js replays `moves` from the standard start unless given `baseFen`, so
  every Maia call failed in practice positions. `startFen` now travels with each request.

- Ben tried it on the phone: everything works as expected.
- Not measured yet: how long a hint takes on the Pixel 10 (the first one includes starting
  Stockfish). Worth timing when tuning the blunder warning, which needs fast analysis.

## Phase 2b: coaching while playing (DESIGN §5.4)
Requested by Ben after using phase 2 hints. Build in this order, test-first as usual:
1. **Undo: done** (branch `phase-2b-undo`).
   - `Game.undo()` pops one ply (refused after a resignation; a checkmate can be undone at
     this level, but the session doesn't offer it).
   - `GameSession.takeBack()` undoes plies until it's the user's turn again, so it's one ply
     while Maia is thinking or has failed, two otherwise. `state.canTakeBack` is false before
     the user's first move (e.g. Maia's opening move as Black) and once the game is over.
   - Each opponent request now has its own `AbortController` (was one per session), so a
     take-back cancels Maia's pending reply and the session goes on. A reply that arrives
     after cancelling is ignored.
   - Records: optional `takebacks` count (left out when zero, so old records still match the
     type; `schemaVersion` stays 1). `hintsUsed` entries for undone plies are dropped.
   - UI: Undo button between Hint and Resign, disabled when there's nothing to take back.
     Disabled buttons are now dimmed (they looked enabled before, e.g. "Thinking…").
   - Tests: unit tests for Game/GameSession/App, plus an e2e test (e4, undo, d4 against the real Maia).
2. **Blunder warning: done** (draft PR #9, same branch).
   - `assessMove(fen, uci, best, reply)` in `blunders.ts` is pure: from Stockfish's score before
     the move (`best`) and after it (`reply`, the opponent's view, or null if the game ended) it
     returns a typed `Blunder`, first match wins: `allowsMate` (unless already lost to a mate),
     `draws` (the move ends the game in a draw while ≥ +200), `missesMate` (only mates in ≤ 3,
     which a player can be expected to see), `hangs` (a newly hanging own piece from
     `moveFacts`, *and* the engine agrees it costs ≥ 100 cp, so sacrifices pass), `loses` (≥ 200 cp).
     Scores are capped at ±1000 before comparing: +15 → +11 is still winning, not a blunder.
   - `describeBlunder` in the narrator gives the sentence, e.g. "This leaves your queen on d5 to
     be taken." It deliberately doesn't name the better move: that's what Hint is for.
   - `BlunderChecker`: `prepare(fen)` searches the position for 1 s while it's your turn (same
     FEN: no new search; new FEN: the old search is aborted); `check` then searches the position
     after your move for 0.3 s. **It never blocks a move:** an engine error or a check slower
     than 5 s (e.g. Stockfish still starting) means no warning.
   - `GameSession` takes an optional `MoveChecker`. The move is played on the board at once and
     Maia's reply waits: `state.review` is `checking`, then cleared or `warning`, and
     `playAnyway()` / `reconsider()` decide. A move under review doesn't end the game (so a
     stalemating move isn't saved before you confirm it); resigning drops it. *Take it back*
     here isn't counted in `takebacks` (that counts the Undo button).
   - With the option off, Stockfish is still only started by the first hint.
   - e2e (real Stockfish + Maia): `4k3/8/4p3/8/8/8/8/3QK3 w`, Qd5?? is caught with the queen
     circled; after taking it back, Qd2 goes straight through. ~3 s in CI-like conditions,
     including Stockfish start-up.
   - **Known limits, to tune by feel:** thresholds are guesses; the 1 s vs 0.3 s searches reach
     different depths, so borderline moves can flicker either way. Draws by threefold repetition
     aren't spotted (`assessMove` sees one FEN, not the history). After *Take it back* the hint
     panel starts over (press Hint again). Pre-analysis shares Stockfish with hints, so a hint
     asked for right after your turn starts may wait up to 1 s. Not measured on the Pixel 10 yet.
3. **"Why not?": built** (draft PR #9, same branch). Done-when e2e passes (`e2e/whyNot.spec.ts`).
   - `buildTeachingLine(…, { firstMove })` teaches a given move: Stockfish analyses the
     position *after* it (MultiPV 1, same 1.2 s as the hint's first search, so depths are
     comparable) and the score is turned round to the user's view (`unflip`, inverse of `flip`).
   - `isClearlyWorse(hint, yours)`: ≥ 50 cp on capped (±1000) scores; when the hint mates, any
     forced mate is as good; giving up a forced mate is always worse.
   - `explainWhyNot` (narrator): your move and the likely reply (and what it takes), then one of
     a forced mate against you / material lost over the line / a piece left to be taken, then
     "<hint> was better: it's checkmate / forces checkmate in N / forks the king and the queen /
     wins material worth about N pawns / Stockfish rates it about N pawns higher".
   - `CoachingChecker` is now the game's only `MoveChecker`: "why not?" when a hint is shown for
     this position and you played something else, otherwise the blunder check (if the option is
     on). If building your line fails or takes > 10 s, the blunder check takes over. When
     there's nothing to check it answers **synchronously**, and the session then skips the
     "Checking your move…" state, so ordinary moves don't pause even for a frame.
   - The session starts the check *before* announcing the move, because announcing it makes
     the UI move the hint coach on, and the checker must read the hint first.
   - `HintCoach.moveTo(position)` replaces the reset-on-every-move effect: the hint is hidden on
     a new position and restored (same level, not recorded again) when the game returns to it,
     so *Go back* shows the hint again.
   - UI: "There was a better move." status, the steps as a list, the hint's move as an arrow,
     *Go back* (primary) and *Continue*. Took ~1.8 s on the container for the fork position.
   - Not counted in the record (like *Take it back* for the blunder warning).
   - **Concrete reasons only (after Ben's phone check):** a hint saying "no tactic here" was
     followed by "there was a better move" with only Stockfish's numbers as the reason. Now a
     loss under 200 cp (the blunder threshold, `unexplainedLossCp`) only interrupts if
     `whyNotReasons` finds a fact: your line allows mate, loses material or leaves a piece to
     be taken, or the hint's move mates, forks or wins material. The narrator and the checker
     share `whyNotReasons`, so the panel never shows a reason the decision didn't use.
   - Tests: 196 unit, 11 e2e.
   - **Open:** the 50 cp threshold is a guess. Should "why not?" also work when you didn't ask for a hint?

### Open questions for phase 2 (also in DESIGN §10)
- Threshold for "teachable but slightly worse" moves.
- Should using hints mark a game as "assisted"?

## Working notes for a new session

- **Cloud sessions clone shallowly** (`git clone --depth 1`), and the clone tracks only `main`.
  After pushing a new branch, the Stop hook may say the branch "has no remote branch". Fix it
  with `git config --add remote.origin.fetch "+refs/heads/<b>:refs/remotes/origin/<b>"`, then
  `git fetch origin <b>` and `git branch --set-upstream-to=origin/<b>`. To branch from the latest
  `main`, run `git fetch --depth=30 origin main && git checkout -b <b> origin/main`.
- **Playwright in the cloud container:** the project's Playwright (1.65) is newer than the
  pre-installed Chromium. Run e2e with
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run e2e` (after `npm run build`).
  CI installs its own browser and doesn't need this.
- **Vitest loads CSS** (`css: true`), so styles like `pointer-events: none` affect user-event tests.
- **Chrome DevTools CPU throttling doesn't affect Web Workers.** It's useless for estimating
  engine speed on a phone; measure on the phone.
- **onnxruntime-web is aliased to its CPU-only build** (`onnxruntime-web/wasm`, 14.8 MB instead
  of 29.5 MB) in `vite.config.ts`, and is excluded from dev pre-bundling. `.onnx` and `.wasm`
  files are left out of the service worker's install-time precache and cached on first use instead.
- **`maia3-js` is pinned to 0.2.0** (single maintainer, v0.x). The model's real size is inlined at
  build time as `__MAIA_MODEL_BYTES__` because hosts gzip the model (PR #5).
- **Before pushing:** `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e`.
  This matches CI.
- **Phone checks Ben can do:** clear site data in Chrome's site settings to re-test the first download.
  The board must not flash blue on tap (PR #5).

## Housekeeping
- Merged or redundant branches still on GitHub: `docs/initial-design`, `phase-0-skeleton`,
  `phase-1-maia-spike`, `phase-1-play`, `fix/board-highlight-and-progress`, and
  `docs/maia-phone-numbers` (never merged on its own; its commit landed via PR #4). Safe to delete;
  consider turning on "Automatically delete head branches" in repo settings.
- `npm audit` reports moderate issues in `glob` and `minimatch`, pulled in by `workbox-build`. That
  code runs only at build time and isn't shipped to users. The only automatic fix downgrades
  `vite-plugin-pwa` to an older major version. Recheck when it updates.
