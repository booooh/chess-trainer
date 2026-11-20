# 0006 — Rust backend for v2 sync
Status: Proposed (v2)

## Context
Cross-device sync is wanted for v2. Ben chose Rust (also a learning goal).

## Decision (proposed)
- **Axum** web framework, **SQLx** with Postgres (or SQLite for a single small instance).
- Sync model: games are immutable, so the client **uploads new games** and **downloads games
  it doesn't have**. Stats are rebuilt on each device (ADR-0005). No merge conflicts on games.
  Settings and repertoire lines use last-writer-wins with timestamps.
- Auth: magic-link email or OAuth via a provider. Decide in a v2 ADR.
- Optional later: an API-key proxy so friends can use a shared LLM key, with per-user rate limits.

## Alternatives considered
- **Python/FastAPI:** quicker to learn; rejected by preference.
- **Hosted Backend-as-a-Service (Supabase/Firebase):** least code, but less learning and
  vendor lock-in.

## Consequences
+ v1 data model is already sync-ready (UUIDs, immutable games, rebuildable stats).
− New deploy target and running cost; needs auth and backup.
