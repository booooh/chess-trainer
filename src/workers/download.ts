/**
 * Reads a fetch response to the end, reporting progress.
 *
 * Progress is measured against `expectedBytes` (the real file size, known at build time),
 * not the Content-Length header: when a server compresses the response, as GitHub Pages does
 * with gzip, Content-Length is the *compressed* size while the stream yields *decompressed*
 * bytes, so the percentage would overshoot (we saw 117%).
 */
export async function readWithProgress(
  res: Response,
  { expectedBytes, onProgress }: { expectedBytes: number; onProgress?: (loaded: number, total: number) => void },
): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    // If the expected size is ever wrong, stretch the total rather than pass 100%.
    onProgress?.(loaded, Math.max(expectedBytes, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes.buffer;
}
