// sequence editor master. CURATED HMM DATABASE download-once + cache layer.
//
// The "Common domains" source needs the curated CC0 Pfam subset in browser
// memory to run the on-device WASM HMMER engine against it (the search reads the
// whole library, so it must live next to the compute). We host the subset as a
// static asset and download it ONCE; the Cache API keeps it durably so every
// later annotation is instant with no network.
//
// getCuratedHmmDb checks the cache first and only fetches if absent, streaming
// progress while it downloads. Cancelable via an AbortSignal. The manifest is a
// tiny sibling json the UI reads for the family count without parsing the HMM.
//
// Nothing of the user's is sent; the database is a one-way static download, so
// there is no consent gate on this path. Voice in comments, no em-dashes, no
// emojis, no mid-sentence colons.

/** Where the curated subset + its manifest are served from (frontend/public). */
const DB_URL = "/hmmer/common-domains.hmm";
const MANIFEST_URL = "/hmmer/common-domains.json";

/** The durable Cache API bucket the downloaded database lives in. */
const CACHE_NAME = "researchos-hmmer-db";

/** The manifest the UI reads (family count, size, provenance) without parsing
 *  the HMM. Matches frontend/public/hmmer/common-domains.json. */
export interface CuratedDbManifest {
  name: string;
  version: string;
  families: number;
  sizeBytes: number;
  source: string;
}

/** A failure surfaced to the UI from the curated-database layer. */
export class CuratedHmmDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CuratedHmmDbError";
  }
}

/** Progress for the one-time download. `total` is undefined when the server does
 *  not report a Content-Length, so the UI shows an indeterminate state. */
export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
}

export interface GetCuratedHmmDbOptions {
  /** Called as bytes stream in during the one-time download. Not called at all
   *  when the database is already cached (the return is instant). */
  onProgress?: (progress: DownloadProgress) => void;
  /** Cancel the download; rejects with an AbortError. */
  signal?: AbortSignal;
}

/** Guard the Cache API + fetch for SSR / test environments where they are absent.
 *  We open the cache best-effort, returning null when caches is unavailable so
 *  the caller falls back to a plain fetch (or the typed offline error). */
async function openDbCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // A storage-blocked context (private mode, disabled storage) is not fatal;
    // we just lose the durable cache and re-download next time.
    return null;
  }
}

function ensureFetch(): void {
  if (typeof fetch === "undefined") {
    throw new CuratedHmmDbError(
      "This environment cannot download the common-domain database (no fetch).",
    );
  }
}

/**
 * Return the curated subset bytes. First checks the Cache API; on a hit returns
 * the cached bytes with NO network. On a miss fetches the static asset with
 * streamed progress, stores the response in the cache, and returns the bytes.
 *
 * If the database is not cached AND the fetch fails (typically offline), throws
 * a clear typed error rather than a raw network exception.
 */
export async function getCuratedHmmDb(
  opts: GetCuratedHmmDbOptions = {},
): Promise<Uint8Array> {
  const { onProgress, signal } = opts;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const cache = await openDbCache();

  // Cache hit: return the stored bytes, no network, no progress.
  if (cache) {
    try {
      const cached = await cache.match(DB_URL);
      if (cached) {
        const buf = await cached.arrayBuffer();
        return new Uint8Array(buf);
      }
    } catch {
      // A flaky cache read just falls through to the network path.
    }
  }

  ensureFetch();

  // Cache miss: download the asset, streaming progress, then cache it.
  let response: Response;
  try {
    response = await fetch(DB_URL, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new CuratedHmmDbError(
      "The common-domain database needs to download once while online. Reconnect and try again.",
    );
  }
  if (!response.ok) {
    throw new CuratedHmmDbError(
      `The common-domain database could not be downloaded (status ${response.status}).`,
    );
  }

  // Tee the body so one branch streams progress to the UI and the other is cached
  // verbatim. We only stream when the UI asked for progress AND the body is a
  // readable stream; otherwise we read the whole buffer in one go.
  const totalHeader = response.headers.get("Content-Length");
  const totalBytes = totalHeader ? Number(totalHeader) || undefined : undefined;

  // Clone for the cache before consuming the body for progress, so cache.put
  // stores a fresh, unconsumed response.
  const forCache = cache ? response.clone() : null;

  const bytes = await readWithProgress(response, totalBytes, onProgress, signal);

  // Store best-effort; a failed cache write is not fatal (we still return bytes).
  if (cache && forCache) {
    try {
      await cache.put(DB_URL, forCache);
    } catch {
      // Quota / storage errors just mean the next run re-downloads.
    }
  }

  return bytes;
}

/** Read a response body to a Uint8Array, reporting streamed progress when the
 *  body exposes a reader. Falls back to arrayBuffer when streaming is absent. */
async function readWithProgress(
  response: Response,
  totalBytes: number | undefined,
  onProgress: ((p: DownloadProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const body = response.body;
  // No streaming body (or no progress requested): one-shot read.
  if (!body || typeof body.getReader !== "function") {
    const buf = await response.arrayBuffer();
    const all = new Uint8Array(buf);
    onProgress?.({ receivedBytes: all.byteLength, totalBytes });
    return all;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress?.({ receivedBytes: 0, totalBytes });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.({ receivedBytes: received, totalBytes });
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released / errored; nothing to do.
    }
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch (and cache) the small sibling manifest so the UI can show "44 common
 * Pfam families" without parsing the HMM. Cache-first like the database; on a
 * miss it downloads + caches. Throws the typed error when uncached and offline.
 */
export async function getCuratedDbManifest(
  opts: { signal?: AbortSignal } = {},
): Promise<CuratedDbManifest> {
  const { signal } = opts;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const cache = await openDbCache();
  if (cache) {
    try {
      const cached = await cache.match(MANIFEST_URL);
      if (cached) return (await cached.json()) as CuratedDbManifest;
    } catch {
      // Fall through to the network on a flaky cache read.
    }
  }

  ensureFetch();

  let response: Response;
  try {
    response = await fetch(MANIFEST_URL, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new CuratedHmmDbError(
      "The common-domain database needs to download once while online. Reconnect and try again.",
    );
  }
  if (!response.ok) {
    throw new CuratedHmmDbError(
      `The common-domain manifest could not be downloaded (status ${response.status}).`,
    );
  }

  const forCache = cache ? response.clone() : null;
  const manifest = (await response.json()) as CuratedDbManifest;
  if (cache && forCache) {
    try {
      await cache.put(MANIFEST_URL, forCache);
    } catch {
      // Non-fatal.
    }
  }
  return manifest;
}
