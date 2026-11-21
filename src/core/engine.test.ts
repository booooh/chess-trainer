import { describe, expect, it } from 'vitest';
import { lazyEngine, type Engine } from './engine';

describe('lazyEngine', () => {
  it('creates the real engine on first use, once, and passes every call through', async () => {
    let created = 0;
    const calls: unknown[][] = [];
    const engine = lazyEngine(() => {
      created++;
      const real: Engine = {
        analyse: async (...args) => (calls.push(args), [{ move: 'e2e4', score: { type: 'cp', value: 30 }, pv: ['e2e4'], depth: 12 }]),
      };
      return real;
    });
    expect(created).toBe(0);

    const signal = new AbortController().signal;
    const lines = await engine.analyse('fen', { multiPv: 3, movetimeMs: 1000 }, signal);
    await engine.analyse('fen2', { multiPv: 1, movetimeMs: 500 });
    expect(created).toBe(1);
    expect(lines[0]!.move).toBe('e2e4');
    expect(calls).toEqual([
      ['fen', { multiPv: 3, movetimeMs: 1000 }, signal],
      ['fen2', { multiPv: 1, movetimeMs: 500 }, undefined],
    ]);
  });
});
