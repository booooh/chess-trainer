// Runs Maia-3 (5M) off the main thread so the board never freezes (DESIGN §8).
// Speaks the protocol in maiaProtocol.ts; MaiaClient is the other side.
import { Maia3 } from 'maia3-js/web';
// Self-hosted model (see docs/spikes/maia-3.md). maia3-js's package exports don't expose the
// file, hence the path into node_modules; Vite copies it into the build with a hashed name.
import modelUrl from '../../node_modules/maia3-js/models/maia3_5m.onnx?url';
import type { FromWorker, ToWorker } from './maiaProtocol';

const CACHE = 'maia-model-v1';
const post = (msg: FromWorker) => self.postMessage(msg);
let maia: Maia3 | null = null;

/** Model bytes from Cache Storage, or downloaded (with progress) and then cached. */
async function modelBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(modelUrl);
  if (cached) return cached.arrayBuffer();

  const res = await fetch(modelUrl);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the Maia model (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: 'progress', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  await cache.put(modelUrl, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  // Old versions of the model would otherwise stay in storage forever.
  for (const key of await caches.keys()) if (key.startsWith('maia-model-') && key !== CACHE) await caches.delete(key);
  return bytes.buffer;
}

async function load(): Promise<void> {
  try {
    maia = new Maia3({ variant: '5m', modelBytes: await modelBytes() });
    await maia.load();
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'loadFailed', message: err instanceof Error ? err.message : String(err) });
  }
}

let loading: Promise<void> | null = null;

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    loading ??= load();
    return;
  }
  try {
    await (loading ??= load());
    if (!maia) throw new Error('Maia model is not loaded');
    // topK 0: we only need the move probabilities, not per-candidate win/draw/loss estimates
    // (each of those costs another forward pass).
    const r = await maia.predict({ fen: msg.fen, priorMoves: msg.moves, selfElo: msg.selfElo, oppoElo: msg.oppoElo, topK: 0 });
    post({ type: 'prediction', id: msg.id, probabilities: [...r.moves] });
  } catch (err) {
    post({ type: 'predictionFailed', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
