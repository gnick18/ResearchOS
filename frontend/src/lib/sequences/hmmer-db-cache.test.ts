import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CuratedHmmDbError,
  getCuratedDbManifest,
  getCuratedHmmDb,
} from "./hmmer-db-cache";

const DB_URL = "/hmmer/common-domains.hmm";

// A tiny fake Response that exposes a streaming body (one chunk per call) so we
// can assert progress reporting, plus a Content-Length header for a known total.
function streamingResponse(bytes: Uint8Array, chunkSize = 4): Response {
  let offset = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (offset >= bytes.byteLength) return { done: true, value: undefined };
          const end = Math.min(offset + chunkSize, bytes.byteLength);
          const value = bytes.slice(offset, end);
          offset = end;
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === "Content-Length" ? String(bytes.byteLength) : null) },
    body,
    clone() {
      // The cache branch consumes a fresh clone; for the test it just needs to be
      // a distinct object cache.put can store.
      return streamingResponse(bytes, chunkSize);
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async json() {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  } as unknown as Response;
}

/** An in-memory Cache API double backed by a Map keyed on the request URL. */
function fakeCacheStorage() {
  const store = new Map<string, Response>();
  const cache = {
    async match(url: string) {
      return store.get(url);
    },
    async put(url: string, res: Response) {
      store.set(url, res);
    },
  };
  return {
    cache,
    store,
    caches: {
      open: vi.fn(async () => cache),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup of injected globals
  delete globalThis.caches;
  // @ts-expect-error test cleanup of injected globals
  delete globalThis.fetch;
});

describe("getCuratedHmmDb", () => {
  it("returns cached bytes without any fetch when present", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { caches, store } = fakeCacheStorage();
    store.set(DB_URL, streamingResponse(bytes));
    // @ts-expect-error inject the Cache API double
    globalThis.caches = caches;
    const fetchSpy = vi.fn();
    // Inject a fetch double for the offline / network path.
    globalThis.fetch = fetchSpy;

    const out = await getCuratedHmmDb();

    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches, reports streamed progress, caches, and returns when uncached", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const { caches, store } = fakeCacheStorage();
    // @ts-expect-error inject the Cache API double
    globalThis.caches = caches;
    const fetchSpy = vi.fn(async () => streamingResponse(bytes, 4));
    // Inject a fetch double for the offline / network path.
    globalThis.fetch = fetchSpy;

    const progress: number[] = [];
    const out = await getCuratedHmmDb({
      onProgress: (p) => progress.push(p.receivedBytes),
    });

    expect(fetchSpy).toHaveBeenCalledWith(DB_URL, { signal: undefined });
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    // Progress climbed monotonically and ended at the full byte count.
    expect(progress[progress.length - 1]).toBe(10);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    // The response was stored in the cache for next time.
    expect(store.has(DB_URL)).toBe(true);
  });

  it("throws the typed offline error when uncached and fetch fails", async () => {
    const { caches } = fakeCacheStorage();
    // @ts-expect-error inject the Cache API double
    globalThis.caches = caches;
    // Inject a failing fetch double (offline).
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(getCuratedHmmDb()).rejects.toBeInstanceOf(CuratedHmmDbError);
    await expect(getCuratedHmmDb()).rejects.toThrow(/download once while online/i);
  });

  it("falls back to a plain fetch when the Cache API is unavailable", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    // No globalThis.caches at all.
    const fetchSpy = vi.fn(async () => streamingResponse(bytes, 2));
    // Inject a fetch double for the offline / network path.
    globalThis.fetch = fetchSpy;

    const out = await getCuratedHmmDb();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getCuratedHmmDb({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getCuratedDbManifest", () => {
  it("fetches and caches the manifest when uncached", async () => {
    const manifest = {
      name: "Common Pfam domains",
      version: "2026-06-05",
      families: 44,
      sizeBytes: 3049633,
      source: "Pfam (CC0)",
    };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const { caches, store } = fakeCacheStorage();
    // @ts-expect-error inject the Cache API double
    globalThis.caches = caches;
    const fetchSpy = vi.fn(async () => streamingResponse(bytes));
    // Inject a fetch double for the offline / network path.
    globalThis.fetch = fetchSpy;

    const out = await getCuratedDbManifest();

    expect(out.families).toBe(44);
    expect(out.source).toBe("Pfam (CC0)");
    expect(store.has("/hmmer/common-domains.json")).toBe(true);
  });

  it("returns the cached manifest without fetching when present", async () => {
    const manifest = { name: "x", version: "v", families: 44, sizeBytes: 1, source: "Pfam (CC0)" };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const { caches, store } = fakeCacheStorage();
    store.set("/hmmer/common-domains.json", streamingResponse(bytes));
    // @ts-expect-error inject the Cache API double
    globalThis.caches = caches;
    const fetchSpy = vi.fn();
    // Inject a fetch double for the offline / network path.
    globalThis.fetch = fetchSpy;

    const out = await getCuratedDbManifest();

    expect(out.families).toBe(44);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
