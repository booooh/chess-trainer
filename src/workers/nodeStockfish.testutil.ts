// Test helper: the real Stockfish 19 Lite wasm (the build the browser loads), run through the
// npm package's Node entry point and wrapped to look like a browser Worker. Only for tests
// that run in the Node environment (`// @vitest-environment node`).
import initEngine from 'stockfish';
import type { UciWorkerLike } from './stockfishClient';

export function nodeStockfish(): UciWorkerLike {
  const engine = initEngine('lite-single');
  let onMessage: ((e: MessageEvent<unknown>) => void) | null = null;
  // A browser Worker delivers messages later, from the event loop. The Node build calls its
  // listener synchronously, mid-command, and sending it a new command from inside that call
  // (e.g. `go` on `uciok`) crashes the wasm ("unreachable"). Deliver asynchronously, as a
  // Worker would; microtasks keep the lines in order.
  engine.listener = (line) => queueMicrotask(() => onMessage?.({ data: line } as MessageEvent<unknown>));
  return {
    postMessage: (cmd) => engine.processCommand(cmd),
    addEventListener: (type: 'message' | 'error', fn: (e: never) => void) => {
      if (type === 'message') onMessage = fn as (e: MessageEvent<unknown>) => void;
    },
    terminate: () => engine.processCommand('quit'),
  };
}
