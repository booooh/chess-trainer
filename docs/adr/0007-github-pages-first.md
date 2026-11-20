# 0007 — Host on GitHub Pages first, deployed from CI
Status: Superseded by [0009](0009-cloudflare-pages-previews.md)

## Context
DESIGN §3 lists "Cloudflare Pages (or GitHub Pages)". Phase 0 needs *some* host so the empty
board can be installed on a phone. The one thing only Cloudflare gives us is custom response
headers (COOP/COEP), which multi-threaded Stockfish would need. ADR-0002 deferred that until
profiling shows single-threaded is too slow.

## Decision
- Deploy to **GitHub Pages** from the `deploy` job in `.github/workflows/ci.yml`.
- Deploys run only on pushes to `main`, and only after lint, type-check, unit tests, build
  and end-to-end tests have all passed.
- The site lives at `https://<owner>.github.io/chess-trainer/`, so the build takes a
  `BASE_PATH` env var. Everything else builds for `/`.

## Alternatives considered
- **Cloudflare Pages now:** supports `_headers`, but needs a Cloudflare account plus an API
  token stored as a repo secret. That's extra setup for a feature we don't use yet.
- **Netlify / Vercel:** similar to Cloudflare; no advantage for a static site.

## Consequences
+ No accounts, secrets or cost: GitHub's built-in `GITHUB_TOKEN` (OIDC) is enough.
+ "Merged to main" means "live", and a broken build can't be deployed.
− No custom headers, so no `SharedArrayBuffer` and no multi-threaded Stockfish. If ADR-0002's
  profiling says we need it, write a new ADR that moves hosting to Cloudflare Pages (the build
  output is the same static `dist/` folder, so it's a CI change only).
− One-time manual step: repo **Settings → Pages → Source: GitHub Actions**.
