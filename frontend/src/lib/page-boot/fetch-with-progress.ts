// Fetch that reports true byte progress, for the big downloads a page boots
// (a search model, an embedding matrix, a parquet file). Reads the response as a
// stream and calls onProgress(0..1) as bytes arrive, so the page-boot bar
// reflects real download progress instead of an opaque jump. Falls back to an
// indeterminate single 0->1 step when the server gives no Content-Length or the
// body is not streamable.

export interface FetchProgressOptions {
  onProgress?: (frac: number) => void;
  cache?: RequestCache;
  signal?: AbortSignal;
}

/** Fetch a URL into an ArrayBuffer, reporting download progress. */
export async function fetchWithProgress(
  url: string,
  opts: FetchProgressOptions = {},
): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: opts.cache ?? "force-cache", signal: opts.signal });
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);

  const lenHeader = res.headers.get("content-length");
  const total = lenHeader ? parseInt(lenHeader, 10) : 0;

  // No stream support (or no length) -> resolve in one shot, report 0 then 1.
  if (!res.body || !total) {
    opts.onProgress?.(0);
    const buf = await res.arrayBuffer();
    opts.onProgress?.(1);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      opts.onProgress?.(Math.min(1, received / total));
    }
  }
  // Concatenate into one buffer.
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  opts.onProgress?.(1);
  return out.buffer;
}
