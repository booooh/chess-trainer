import { describe, expect, it } from 'vitest';
import { readWithProgress } from './download';

/** A response whose body arrives in the given chunks, with optional headers. */
function response(chunks: number[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((n, i) => controller.enqueue(new Uint8Array(n).fill(i)));
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe('readWithProgress', () => {
  it('returns all the bytes, in order', async () => {
    const bytes = new Uint8Array(await readWithProgress(response([2, 3]), { expectedBytes: 5 }));
    expect([...bytes]).toEqual([0, 0, 1, 1, 1]);
  });

  it('reports progress against the known file size', async () => {
    const seen: [number, number][] = [];
    await readWithProgress(response([40, 60]), { expectedBytes: 100, onProgress: (l, t) => seen.push([l, t]) });
    expect(seen).toEqual([
      [40, 100],
      [100, 100],
    ]);
  });

  it('ignores Content-Length when the server compressed the response (it counts compressed bytes)', async () => {
    // GitHub Pages gzips the model: Content-Length says 85, but 100 bytes arrive after decompression.
    const seen: number[] = [];
    await readWithProgress(response([50, 50], { 'content-length': '85', 'content-encoding': 'gzip' }), {
      expectedBytes: 100,
      onProgress: (l, t) => seen.push(l / t),
    });
    expect(seen).toEqual([0.5, 1]);
  });

  it('never reports more than 100%, even if the expected size is wrong', async () => {
    const seen: number[] = [];
    await readWithProgress(response([60, 60]), { expectedBytes: 100, onProgress: (l, t) => seen.push(l / t) });
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(seen.at(-1)).toBe(1);
  });
});
