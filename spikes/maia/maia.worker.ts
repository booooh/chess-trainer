// Spike worker: loads Maia-3 5M with onnxruntime-web and answers timing requests.
// The real app will put this behind a typed `OpponentEngine` interface (ADR-0003).
import { Maia3 } from 'maia3-js/web';
// Self-host the model next to the app instead of downloading it from Hugging Face.
// (maia3-js's package exports don't expose the file, hence the relative path.)
import modelUrl from '../../node_modules/maia3-js/models/maia3_5m.onnx?url';

export type Request =
  | { type: 'load' }
  | { type: 'predict'; fen: string; priorMoves: string[]; elo: number; topK: number };
export type Response =
  | { type: 'loaded'; downloadMs: number; sessionMs: number; bytes: number; fromCache: boolean }
  | { type: 'predicted'; move: string; ms: number; topProbability: number }
  | { type: 'error'; message: string };

let maia: Maia3 | null = null;
const post = (r: Response) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<Request>) => {
  try {
    const msg = e.data;
    if (msg.type === 'load') {
      const t0 = performance.now();
      const cache = await caches.open('maia-spike');
      let res = await cache.match(modelUrl);
      const fromCache = !!res;
      if (!res) {
        res = await fetch(modelUrl);
        if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
        await cache.put(modelUrl, res.clone());
      }
      const bytes = await res.arrayBuffer();
      const t1 = performance.now();
      maia = new Maia3({ variant: '5m', modelBytes: bytes, temperature: 1 });
      await maia.load();
      const t2 = performance.now();
      post({ type: 'loaded', downloadMs: t1 - t0, sessionMs: t2 - t1, bytes: bytes.byteLength, fromCache });
    } else if (msg.type === 'predict') {
      if (!maia) throw new Error('load first');
      const t0 = performance.now();
      const r = await maia.predict({ fen: msg.fen, priorMoves: msg.priorMoves, selfElo: msg.elo, topK: msg.topK });
      const ms = performance.now() - t0;
      post({ type: 'predicted', move: r.bestMove, ms, topProbability: Math.max(...r.moves.values()) });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
