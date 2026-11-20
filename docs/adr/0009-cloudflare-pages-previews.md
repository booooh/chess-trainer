# 0009 — Move hosting to Cloudflare Pages, with a preview URL for every PR
Status: Proposed (do it first in phase 2). Supersedes [0007](0007-github-pages-first.md) once accepted.

## Context
ADR-0007 chose GitHub Pages because it needed no accounts or secrets. Phase 1 exposed two limits:

1. **No previews.** GitHub Pages hosts one deployment per repository, and CI deploys only `main`.
   The only way to try a change on the phone was to merge it first (PR #5 was checked that way).
   Workarounds were considered and rejected (see below).
2. **No custom headers.** Already known in ADR-0007. Phase 2 adds Stockfish, and multi-threaded
   Stockfish (and multi-threaded ONNX Runtime for Maia) need `SharedArrayBuffer`, which requires
   COOP/COEP headers (ADR-0002). We may not need threads, but we can't even try on GitHub Pages.

## Decision
Host on **Cloudflare Pages**, deployed from our existing GitHub Actions CI with Wrangler
("Direct Upload"), not Cloudflare's own Git integration:

- **Production:** pushes to `main` deploy to the production URL, only after `check` and `e2e` pass
  (same rule as today).
- **Previews:** every pull request from this repo deploys a preview after `check` and `e2e` pass,
  and CI comments the URL on the PR. Each branch gets a stable alias,
  `https://<branch-slug>.<project>.pages.dev`, plus a unique URL per deployment.
- **Served at the root (`/`)**, so the `BASE_PATH` workaround from ADR-0007 goes away.
- **Headers** come from a `public/_headers` file. Start with long caching for hashed assets only.
  Add COOP/COEP only when we actually need threads, and test that every resource still loads,
  since `Cross-Origin-Embedder-Policy: require-corp` blocks cross-origin resources without CORP/CORS.

Why Direct Upload from Actions rather than Cloudflare's Git integration: the Git integration
builds on Cloudflare's machines on every push, independent of our CI, so a branch with failing
tests would still get deployed (and production could deploy before `e2e` passes). Deploying from
CI keeps "only green builds go out", and the build runs once.

## Alternatives considered
- **Stay on GitHub Pages, deploy branches manually** (a `workflow_dispatch` that deploys any
  branch to the one live URL): no previews in parallel, and while testing, the live site *is* the
  branch. Needs the `github-pages` environment's branch rule relaxed.
- **GitHub Pages previews in subfolders** (e.g. `pr-preview-action` on a `gh-pages` branch):
  requires switching Pages back to "deploy from a branch", previews share one origin (so they
  share IndexedDB, Cache Storage and the service worker with production, which gets confusing
  for a PWA), and still no headers.
- **Netlify / Vercel:** also have previews and headers. No advantage over Cloudflare for a static
  site, and Cloudflare's free tier has unlimited bandwidth.
- **Local network preview** (`vite preview --host`): no HTTPS, so no service worker; fine for
  quick checks, not a substitute.

## Consequences
+ A tappable preview link on every PR: check on the phone *before* merging.
+ Previews have their own origins, so they don't touch production's saved games or caches.
+ Custom headers become possible (needed for any multi-threaded engine experiment).
+ No `BASE_PATH`; simpler build.
− **New origin = fresh start on the phone.** IndexedDB, Cache Storage and the installed PWA are
  per-origin, so games saved on `booooh.github.io` don't move over, and the app must be
  reinstalled from the new URL. Today that's only test games; do the move before friends use it.
  Keep the GitHub Pages site as a page that links (or redirects) to the new URL.
− Needs a Cloudflare account and two repository secrets (`CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`). PRs from forks don't get secrets, so they get no preview (fine).
− **25 MiB per-file limit** on Cloudflare Pages (verify the current limit). Today's largest file is
  the Maia model at 21.5 MiB, then ORT's `.wasm` at 14.2 MiB, so we fit. The Maia 23M variant
  and the full Stockfish build (~94 MB) would not; use the Stockfish **lite** build (ADR-0002).
− A second vendor in the deploy path. The build output is still a plain static `dist/`, so
  moving again is a CI change only.
