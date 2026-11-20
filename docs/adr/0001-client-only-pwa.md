# 0001 — v1 is a client-only PWA, no backend
Status: Accepted

## Context
Primary device is an Android phone; friends will use it too. Every v1 feature (engine
analysis, Maia opponent, opening tracking, LLM via the user's own key, local LLM) can run on
the device. Sync is wanted but deferred to v2.

## Decision
Ship v1 as a static Progressive Web App (installable from the browser, works offline).
Host it on a free static host. No server code of our own.

## Alternatives considered
- **Native Android (Kotlin):** better device access, but it's a second UI codebase and slower
  to iterate. It could also be Play-Store-only, which friends on iOS can't use.
- **Capacitor wrapper now:** possible later with the same code; no benefit yet.
- **Backend from day one:** adds hosting, auth, cost and attack surface for no v1 feature.

## Consequences
+ Zero running cost, works offline, simple deploys (push → CI → static host).
+ Every user brings their own compute, so it scales to any number of friends.
− Data lives on one device until v2. Mitigation: JSON export/import in settings.
− Each user must supply their own LLM API key for the online narrator.
