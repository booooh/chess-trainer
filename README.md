# Chess Trainer

A chess training app for improving players (roughly 600–1000 rating): play against human-like
[Maia](https://www.maiachess.com/) opponents, get in-game hints that explain the whole line
(analysis by [Stockfish](https://stockfishchess.org/)), and get opening suggestions that track
what you've played with both colours.

Runs entirely in the browser as an installable PWA, with no backend in v1.

**Status:** phases 0 and 1 done, phase 2 (hints) next; see [`docs/STATUS.md`](docs/STATUS.md).
Phase 1 (play): play full games against Maia on your phone, from 400 to 1500
(Lichess-scale ratings); finished games are saved on the device. See
[`docs/DESIGN.md`](docs/DESIGN.md) for the plan and the
[architecture decision records](docs/adr/README.md) for why things are the way they are.

## Development

Needs Node 22 (see `.nvmrc`).

```sh
npm install
npm run dev         # dev server at http://localhost:5173
npm test            # unit tests (Vitest); `npm run test:watch` while working
npm run lint
npm run typecheck
npm run build       # production build into dist/, including the service worker
npm run e2e         # end-to-end tests against the production build (run `build` first)
```

First time running e2e tests: `npx playwright install chromium`. To use a Chromium you
already have instead, set `PW_CHROMIUM_PATH` to its executable.

`npm run icons` regenerates the PNG app icons from `public/favicon.svg`.

### Layout

| Path | What |
|---|---|
| `src/core/` | Pure TypeScript domain logic, no React (lint-enforced): `Game`, `GameSession`, `MaiaOpponent`, the `Engine` interface and UCI parsing |
| `src/ui/` | React components: chessground `Board` wrapper, new-game form, play screen |
| `src/workers/` | Web Workers (Maia-3 via ONNX Runtime, Stockfish 19 Lite) and their typed main-thread clients |
| `src/storage/` | IndexedDB (Dexie) implementations of core repository interfaces |
| `e2e/` | Playwright tests, run on an emulated Pixel 7 |
| `spikes/` | Throwaway experiments and measurements (see `docs/spikes/`) |
| `.github/workflows/ci.yml` | CI: checks on every PR; deploys PR previews and `main` to Cloudflare Pages |
| `.github/workflows/github-pages-moved.yml` | Manual, one-off: replaces the old GitHub Pages site with a "moved" page |

## Deployment

Hosted on Cloudflare Pages, deployed from CI with Wrangler ([ADR-0009](docs/adr/0009-cloudflare-pages-previews.md)).
Nothing deploys until lint, type-check, unit tests and e2e tests have passed.

- **Production:** every push to `main` is deployed to https://chess-trainer-dri.pages.dev.
  The project is called `chess-trainer`, but that subdomain was already taken on `pages.dev`, so
  Cloudflare added `-dri`. Use the URLs CI prints rather than guessing from the project name.
- **Previews:** every pull request from a branch of this repo gets its own preview, and CI
  posts the link as a PR comment (updated on each push). The link stays the same for the
  branch: `https://<branch-name>.chess-trainer-dri.pages.dev` (Cloudflare lowercases the name and
  replaces other characters with `-`). Previews have their own storage, so they
  never touch production's saved games.
- **Headers:** `public/_headers` sets long-lived caching for the content-hashed files in
  `/assets/`. Everything else is revalidated on each request, so app updates reach the phone.
- **Setup (done once):** repository secrets `CLOUDFLARE_API_TOKEN` (custom token with
  *Account → Cloudflare Pages → Edit*) and `CLOUDFLARE_ACCOUNT_ID`. The first deploy creates
  the `chess-trainer` Pages project if it doesn't exist.

The app used to live at https://booooh.github.io/chess-trainer/ ([ADR-0007](docs/adr/0007-github-pages-first.md)).
`legacy/github-pages/` holds the "moved" page that replaces it, deployed by hand with the
*Replace GitHub Pages site* workflow.

To install on Android: open the site in Chrome, then menu → **Add to Home screen** / **Install app**.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [ADR-0008](docs/adr/0008-agpl-license.md): the app
bundles Maia-3 (AGPL-3.0) and Stockfish (GPL-3.0).
