# 0004 — Explanations: deterministic facts, then pluggable narrators
Status: Accepted

## Context
We want readable explanations of whole lines. LLMs write well but invent chess moves and
evaluations. We need explanations online (best quality), with a local model (offline), and
with no model at all (always works).

## Decision
Split explanation into two stages:
1. **Facts extractor** (pure TS, unit-tested): derives typed facts (hanging pieces via SEE,
   forks, pins, mate threats, material and eval changes, opening principles) from the position,
   the teaching line and the engine evals.
2. **Narrator chain**: `OnlineLLMNarrator → LocalLLMNarrator → TemplateNarrator`. Each has
   `isAvailable()` and a timeout; the first that succeeds wins. LLM prompts contain only the
   facts and SAN moves, and instruct the model not to add analysis.

Online narrator: the user pastes their own API key (stored on the device). Supports Anthropic
plus any OpenAI-compatible endpoint, which also covers self-hosted servers.
Local narrator (phase 5): WebLLM on WebGPU where available, wllama (llama.cpp WASM, CPU) as fallback.

## Alternatives considered
- **LLM analyses the position itself:** unreliable, and confidently wrong.
- **Templates only:** reliable but robotic. Kept as the floor, not the ceiling.

## Consequences
+ Correctness lives in testable code; the LLM only affects wording.
+ Small local models become viable because the task is just rephrasing.
+ Graceful degradation: a hint always appears.
− Explanation quality is capped by which motifs the extractor detects. Grow the detector list over time.
− Browser calls to LLM APIs expose the key to that browser. Acceptable: it's the user's own key on their own device.
