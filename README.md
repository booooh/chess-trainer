# Chess Trainer

A chess training app for improving players (roughly 600–1000 rating): play against human-like
[Maia](https://www.maiachess.com/) opponents, get in-game hints that explain the whole line
(analysis by [Stockfish](https://stockfishchess.org/)), and get opening suggestions that track
what you've played with both colours.

Runs entirely in the browser as an installable PWA, with no backend in v1.

**Status:** phase 0 (skeleton): an installable PWA showing an empty board. See
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
| `src/core/` | Pure TypeScript domain logic, no React (lint-enforced) |
| `src/ui/` | React components, e.g. the chessground `Board` wrapper |
| `e2e/` | Playwright tests, run on an emulated Pixel 7 |
| `.github/workflows/ci.yml` | CI: checks on every PR; deploys `main` to GitHub Pages |

## Deployment

Every push to `main` that passes CI is deployed to GitHub Pages ([ADR-0007](docs/adr/0007-github-pages-first.md)).
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

To install on Android: open the site in Chrome, then menu → **Add to Home screen** / **Install app**.

## License

GPL-3.0. See [LICENSE](LICENSE). Required because the app bundles Stockfish.
