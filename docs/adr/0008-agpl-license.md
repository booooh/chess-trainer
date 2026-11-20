# 0008 — License the app under AGPL-3.0
Status: Accepted

## Context
ADR-0002 noted the app must be GPL-3.0 because it bundles Stockfish. The phase 1 Maia spike
([`docs/spikes/maia-3.md`](../spikes/maia-3.md)) found that the Maia-3 code and weights
(`CSSLab/maia3`) are licensed **AGPL-3.0**. The npm wrapper we use, `maia3-js`, is labelled
MIT, but it ports Maia-3's input encoding and ships the AGPL weights, so in practice we should
treat what we bundle as AGPL.

GPLv3 §13 and AGPLv3 §13 explicitly allow combining the two. The AGPL adds one duty on top of
the GPL: if you modify the program and people use it **over a network**, you must offer them
the source code.

## Decision
- License the whole app as **AGPL-3.0-or-later** (`LICENSE`, `package.json`).
- The app shows a "Source code" link to this repository (the AGPL's network clause), and a
  unit test checks the link is there.
- Stockfish (GPL-3.0) stays compatible: GPLv3 code may be combined with AGPLv3 code.

## Alternatives considered
- **Keep GPL-3.0 and note that the Maia parts are AGPL:** allowed, but two licenses in one
  bundle is confusing for anyone reusing the code, and the AGPL parts keep their extra duty anyway.
- **Avoid Maia-3, use the original Maia (GPL-3.0) via lc0 weights:** ADR-0003's plan B. More
  work (lc0 input encoding in TS), weaker human-likeness, and only fixed rating steps from 1100 up.

## Consequences
+ One license, matching the strictest part we bundle; no ambiguity for contributors.
+ No practical cost for an open-source, client-only app: the source link is all we need.
− The v2 Rust backend (ADR-0006) will be under the AGPL too, if it shares this repo or reuses
  Maia code. Anyone running a modified copy as a service must publish their changes. That suits
  a hobby project, but it rules out closed-source reuse.
− This is a reading of the licenses, not legal advice.
