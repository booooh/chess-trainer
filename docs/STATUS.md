# Project status and handoff

Last updated: 2026-11-21, phase 2 step 1 (Cloudflare Pages) merged in PR #6. Phase 1: PRs #1–#5.
Read this first when picking the project up in a new session, then `DESIGN.md` and the ADRs.

## Where things stand

| Phase | State | Notes |
|---|---|---|
| 0. Skeleton | ✅ Done (PR #2) | Installs on the phone; CI runs on every PR |
| 1. Play | ✅ Done (PRs #3, #4, #5) | Ben played a full game against Maia 1100 on a Pixel 10 |
| 2. Hints | 🚧 **In progress** | Step 1 (Cloudflare Pages, ADR-0009) done in PR #6; step 2 next. Plan below |
| 3–6, v1.x, v2 | Not started | See `DESIGN.md` §9 |

**Live app:** https://chess-trainer-dri.pages.dev (Cloudflare Pages, ADR-0009). It deploys from `main`
only after CI passes, and every PR from this repo gets a preview at
`https://<branch-name>.chess-trainer-dri.pages.dev`, linked in a PR comment. The Pages project is
named `chess-trainer`, but that `pages.dev` subdomain was taken, so Cloudflare added `-dri`;
`https://chess-trainer.pages.dev` is someone else's site. The old address,
https://booooh.github.io/chess-trainer/, still serves the phase 1 app until the "moved" page replaces it.

### What the app does today
- New game: play as White, Black or Random against Maia-3 rated 400–1500 (Lichess scale, default 1100).
- Play by dragging or tapping, with legal-move dots, last move, check, and a promotion picker. Maia replies from a Web Worker
  (about 30 ms per move on a Pixel 10).
- Status line, move list, resign (with confirmation), retry if Maia fails, and model download progress.
- Finished games are saved to IndexedDB (`chess-trainer` database, `games` table, DESIGN §7 format).
- AGPL-3.0 with a "Source code" link (ADR-0008). Installable PWA that works offline once Maia is cached.

### Known limitations (deliberately left out so far)
- A game in progress is lost on reload; only finished games are saved.
- No screen lists saved games yet (comes with phase 3 or 6).
- No take-backs, draw offers or clocks (timed play is v1.x).
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
src/workers/   maia.worker.ts (Maia-3 via onnxruntime-web), maiaClient.ts (request ids, abort,
               crash handling), maiaProtocol.ts (message types), download.ts (progress)
src/storage/   gameRepository.ts: Dexie implementation (add-only: games are immutable)
src/ui/        Board (chessground wrapper), NewGameForm, PlayScreen, services (dependency
               injection: real ones in browserServices.ts, fakes in tests), gameOptions
e2e/           Playwright on an emulated Pixel 7 against the production build (real Maia)
spikes/maia/   strength.ts: re-runnable Maia strength-by-rating measurement (Node + Stockfish)
```

Tests: 46 unit (Vitest) and 5 e2e (Playwright). CI is `.github/workflows/ci.yml`, with jobs
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

**Still to do:**
1. Install the app on the phone from https://chess-trainer-dri.pages.dev, if not done yet.
2. Run **Actions → Replace GitHub Pages site with a "moved" page** with
   `https://chess-trainer-dri.pages.dev/`. Open the old
   address on the phone to confirm it switches to the "moved" page.
3. Later: turn GitHub Pages off (Settings → Pages), delete `github-pages-moved.yml` and
   `legacy/`, and delete the `github-pages` environment.

### Step 2: Stockfish engine worker (DESIGN §4.1, ADR-0002)
- Use the `stockfish` npm package (19.0.1, already a devDependency for the spike; make it a
  dependency). Use the **lite single-threaded** build: `bin/stockfish-19-lite-single.js` (28 KB)
  plus `.wasm` (1.8 MB). It's GPL-3.0, which is compatible with our AGPL (ADR-0008).
- **Pitfall to check:** stockfish.js finds its `.wasm` from its own script URL (`locateFile`).
  Vite's hashed asset names can break that pairing. Options: serve both files unhashed from
  `public/`, or point it at the wasm explicitly. Try it in the production build and the e2e test,
  not just `vite dev`.
- `EngineClient` in core: `analyse(fen, { multiPv: 3, movetimeMs: 1000–1500 }) → Promise<Line[]>`
  where `Line = { move, scoreCp | mateIn, pv: Uci[], depth }`. It needs a request queue and
  cancellation, because Stockfish runs one search at a time (`stop`, then wait for `bestmove`).
  Parse UCI `info … multipv N … score cp|mate … pv …` lines in a pure, unit-tested function.
- Mirror the Maia pattern: a protocol file, a worker, a main-thread client with a fake-worker test,
  and injected services so UI tests use a fake engine.

### Step 3: Facts extractor (DESIGN §5.3, ADR-0004)
Pure TS in `src/core/`, unit-tested on hand-picked FENs. Start with what the done-when needs:
**fork** (one piece attacking two or more valuable targets, with check counting), **hanging piece**
(static exchange evaluation: cheapest captures first), material change, and eval swing. Add pins,
skewers, mate threats and opening principles afterwards.

### Step 4: Teaching line (DESIGN §5.2)
- Your move: among the MultiPV candidates within about 30 cp of the best, prefer the teachable one.
- Opponent's reply: Maia's most likely move at the opponent's rating. The `HumanMovePredictor`
  already returns full probabilities.
- Branch when Maia's reply differs from Stockfish's best defence.
- 3–5 plies, extended to 7 only while captures or checks are pending.

### Step 5: Template narrator and hint ladder UI (DESIGN §5.1, §5.3)
- `TemplateNarrator` turns facts into text. It never fails.
- Hint button: each press reveals one more level: nudge → piece → move arrow → line with explanation.
  Use chessground's `drawable` shapes for highlights and arrows.
- Record the highest level used per ply in `GameRecord.hintsUsed` (the field already exists).
- Done-when e2e: a fixed position with a fork, with level 4 showing the right move and an explanation mentioning the fork.
  Use a fake engine in unit tests; one e2e test can use real Stockfish.

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
