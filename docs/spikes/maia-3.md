# Spike: Maia-3 in the browser (phase 1)

Date: 2026-11-20. Code: `spikes/maia/strength.ts`. The speed-test page (`spike-maia.html`) and its
worker were removed once phase 1 had a real Maia worker; see commit `95ce67e` for them.

ADR-0003 left three questions open before building the opponent on Maia-3:
1. Does `maia3-js` + the ONNX model work in a browser Web Worker, and under what license?
2. Is it fast enough on a phone?
3. How does it play below 1100?

## 1. Packaging and license

- **`maia3-js@0.2.0`** (MIT label, 2 releases, single maintainer). It wraps ONNX Runtime and has
  a browser entry (`maia3-js/web`). The **5M-parameter model (21.5 MB) is bundled** in the npm
  package; the 23M and 79M variants download from a personal Hugging Face repo. Its README
  reports parity tests against the official PyTorch model.
- The browser code is small and readable: it only fetches the model URL it's given and runs
  ONNX Runtime. We pass the bytes in ourselves (`modelBytes`), so it never contacts Hugging Face.
- **License:** the upstream `CSSLab/maia3` repo (code and weights) is **AGPL-3.0**, and the model
  card defers to it. That's why the app moves to AGPL-3.0 (ADR-0008).
- **Bundle size:** `onnxruntime-web`'s default build includes WebGPU (29.5 MB `.wasm`). We alias it to
  the CPU-only `onnxruntime-web/wasm` build (14.8 MB, **3.8 MB gzipped**). First-use download is
  ~23 MB in total (the model doesn't compress), then cached. Both files are excluded from the
  service worker's install-time precache so installing the app stays light.
- Works in a module Web Worker built by Vite. Dev mode needs `optimizeDeps.exclude: ['onnxruntime-web']`.

## 2. Speed

First measured in headless Chromium on the cloud container used for development (4 cores,
single-threaded WASM, no cross-origin isolation):

| | Value |
|---|---:|
| Load model + create ONNX session | ~2 s (1 s download from localhost, 0.9 s session) |
| Opponent move (policy only, `topK: 0`), median / p90 | **44 / 71 ms** |
| Move + 5 candidate evaluations (`topK: 5`, for teaching lines), median / p90 | 181 / 225 ms |
| First call (warm-up) | ~150 ms |

Chrome DevTools CPU throttling **doesn't apply to Web Workers**, so a throttled desktop run
can't stand in for a phone. The real numbers came from opening
`/chess-trainer/spike-maia.html` on the phone (Chrome 158, 8 cores, not cross-origin isolated,
so single-threaded WASM like everywhere else):

| Device | Load | Opponent move median / p90 / max | topK 5 median / p90 |
|---|---:|---:|---:|
| Cloud container (headless Chromium) | 1.0 s download + 0.9 s session | 44 / 71 / 88 ms | 181 / 225 ms |
| **Pixel 10** (model already cached) | 38 ms from cache + 415 ms session | **29 / 31 / 33 ms** | **125 / 129 ms** |

My earlier guess that a phone would be 3–5× slower than the container was wrong: the Pixel 10 is
about 1.5× *faster*, with very steady times (p90 within a few ms of the median). An opponent move
costs about 30 ms, so Maia's speed is a non-issue. Even the teaching-line call with five
candidate evaluations (§5.2) takes only about 125 ms. On a phone with the model cached, the
first move is ready about half a second after opening the page.

Not yet measured: the first-ever download over mobile data (~23 MB), and older or cheaper phones.
Friends' phones may be several times slower than a Pixel 10 and would still be fast enough.

## 3. Strength below 1100

`spikes/maia/strength.ts`: Maia plays itself at each rating (moves sampled with temperature 1,
as the real opponent will), 30 games per rating, up to 100 plies. Stockfish 19 lite scores every
position at depth 10; evals are clamped to ±1000 cp.

| Rating | Moves | Avg. centipawn loss | ≥100 cp per 100 moves | ≥300 cp per 100 moves |
|---:|---:|---:|---:|---:|
| 400 | 2388 | 142 | 33.7 | 15.2 |
| 600 | 2392 | 112 | 28.0 | 10.7 |
| 800 | 1997 | 107 | 29.0 | 10.8 |
| 1100 | 2231 | 68 | 19.7 | 5.0 |
| 1500 | 2536 | 69 | 21.0 | 5.2 |
| 1900 | 2084 | 58 | 16.2 | 4.0 |

**Reading it:**
- Below 1100 Maia-3 **does** get weaker: 600–800 blunders (≥300 cp) about twice as often as 1100,
  and 400 is weaker again. So the "strength floor at ~1100" in ADR-0003 doesn't hold for Maia-3:
  the rating input keeps working down to at least 400, which covers the 600–1000 target range.
- 1100 and 1500 look the same on these measures, so the steps in between are less distinct than
  the numbers suggest. Fine for us: our users sit below 1100.
- Maia was trained on **Lichess** games, so its ratings are Lichess ratings. At this level Lichess
  ratings usually run a few hundred points higher than chess.com's, so a chess.com 800 player
  probably wants a Maia setting around 1000–1100, not 800. Worth checking by feel in phase 1.

**Caveats:** self-play means both sides share a rating, and one blunder changes the position for
the rest of the game. Average centipawn loss is inflated in already-lost positions. Depth 10 lite
Stockfish occasionally misjudges positions. 30 games per rating gives a rough shape, not precise
values. None of this changes the main finding.

## Decision

Go ahead with Maia-3 5M via `maia3-js` as ADR-0003 planned:
- Pin `maia3-js` exactly (single maintainer, v0.x) and keep it behind our own `OpponentEngine`
  interface so it can be replaced.
- Self-host the model and the CPU-only ONNX runtime; cache them on first use.
- Allow opponent ratings below 1100 (e.g. 400–1500) and pick the default after playing a few games.
