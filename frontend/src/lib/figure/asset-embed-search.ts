// Option A: the lazy client-side SEMANTIC layer for icon search. Loads a small
// sentence-transformer (MiniLM) + a precomputed, L2-normalized asset-vector
// matrix (embeddings-v1.bin, built by the ingest lane, row order == manifest),
// embeds the query in-browser, and ranks by cosine (a dot product, since both
// sides are unit vectors). Blends with the always-on keyword baseline so a
// literal match still wins and semantics only ADD recall.
//
// Everything heavy is lazy + cached: nothing here runs until the user opts into
// smart search, and the model + vectors download once (behind the page-boot
// BeakerBot loader) then stay cached. The pure ranking/decoding helpers are
// unit-tested; the load path is integration-wired via buildSmartSearchTasks.

import { fetchWithProgress } from "@/lib/page-boot/fetch-with-progress";
import type { BootTask } from "@/lib/page-boot/page-boot";
import { rankAssets, type ScoredAsset } from "./asset-search";
import type { LibraryAsset } from "./asset-library";

const ASSET_BASE_URL =
  process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? "https://assets.research-os.com";
// Dev override so a locally-generated sidecar (public/dev-embeddings) can be used
// before the ingest lane syncs the real one to R2.
const EMBED_BASE = process.env.NEXT_PUBLIC_ASSET_EMBEDDINGS_BASE ?? ASSET_BASE_URL;

export interface EmbedMeta {
  model: string;
  dims: number;
  count: number;
  dtype: string;
  normalized: boolean;
  version: string;
}

export interface EmbedIndex {
  meta: EmbedMeta;
  /** count * dims, L2-normalized, row i == manifest asset i. */
  matrix: Float32Array;
  /** transformers feature-extraction pipeline (typed loosely to avoid the dep here). */
  embedQuery: (text: string) => Promise<Float32Array>;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** IEEE-754 half (uint16) -> float32. Inverse of the ingest writer's toHalf. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/** Decode a Float16 buffer into a Float32Array of count*dims values. */
export function decodeF16Matrix(buf: ArrayBuffer, count: number, dims: number): Float32Array {
  const u16 = new Uint16Array(buf);
  const n = count * dims;
  if (u16.length < n) {
    throw new Error(`embeddings too short: have ${u16.length}, need ${n}`);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = halfToFloat(u16[i]);
  return out;
}

/** Cosine (dot, both unit-normalized) of the query vs every row; top-k rows. */
export function dotTopK(
  matrix: Float32Array,
  query: Float32Array,
  count: number,
  dims: number,
  k: number,
  minScore = 0.2,
): { row: number; score: number }[] {
  const scored: { row: number; score: number }[] = [];
  for (let r = 0; r < count; r++) {
    let dot = 0;
    const base = r * dims;
    for (let d = 0; d < dims; d++) dot += matrix[base + d] * query[d];
    if (dot >= minScore) scored.push({ row: r, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Blend keyword (C) and semantic (A) results into one ranked list. A literal
 * keyword hit keeps full weight; a semantic-only hit is discounted so exact
 * matches stay on top while semantics fill in the long tail. Dedupes by uid.
 */
export function blendResults(
  keyword: ScoredAsset[],
  semantic: ScoredAsset[],
  limit: number,
  semanticWeight = 0.92,
): ScoredAsset[] {
  const best = new Map<string, ScoredAsset>();
  const bump = (asset: LibraryAsset, score: number) => {
    const prev = best.get(asset.uid);
    if (!prev || score > prev.score) best.set(asset.uid, { asset, score });
  };
  for (const s of keyword) bump(s.asset, s.score);
  for (const s of semantic) bump(s.asset, s.score * semanticWeight);
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.asset.title.localeCompare(b.asset.title))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Lazy load + search
// ---------------------------------------------------------------------------

let indexPromise: Promise<EmbedIndex> | null = null;

/** Whether the index is already loaded (so the UI can skip the loader). */
export function isEmbedIndexReady(): boolean {
  return indexPromise !== null;
}

/**
 * The page-boot tasks that load the smart-search index, with honest progress:
 * the MiniLM model download (streamed via transformers' progress_callback) and
 * the vector matrix (streamed via fetchWithProgress). Resolves the shared
 * indexPromise so semanticSearch can use it after. Idempotent.
 */
export function buildSmartSearchTasks(): BootTask[] {
  let extractor: ((text: string) => Promise<Float32Array>) | null = null;
  let meta: EmbedMeta | null = null;
  let matrix: Float32Array | null = null;

  return [
    {
      id: "smart-search-model",
      label: "Loading the smart-search model",
      weight: 60,
      run: async (onProgress) => {
        const meta_url = `${EMBED_BASE}/embeddings-v1.meta.json`;
        meta = (await fetch(meta_url, { cache: "force-cache" }).then((r) => r.json())) as EmbedMeta;
        const tf = await import("@xenova/transformers");
        // The MiniLM model files must load from a CSP-allowed origin. By default
        // transformers.js fetches from huggingface.co, which is NOT in the app's
        // connect-src allowlist; in prod we host the model on our own R2 (already
        // allowed, like the vectors). Set NEXT_PUBLIC_ASSET_MODEL_HOST to that
        // origin (files under <host>/<model>/...). Unset = HF default (dev only,
        // needs HF temporarily allowed in CSP).
        const modelHost = process.env.NEXT_PUBLIC_ASSET_MODEL_HOST;
        if (modelHost) {
          tf.env.allowLocalModels = false;
          tf.env.remoteHost = modelHost.replace(/\/$/, "") + "/";
          tf.env.remotePathTemplate = "{model}/";
        }
        // Aggregate the per-file download progress into one 0..1.
        const totals: Record<string, { loaded: number; total: number }> = {};
        const pipe = await tf.pipeline("feature-extraction", meta.model, {
          progress_callback: (p: { file?: string; loaded?: number; total?: number }) => {
            if (p.file && typeof p.total === "number" && p.total > 0) {
              totals[p.file] = { loaded: p.loaded ?? 0, total: p.total };
              let l = 0;
              let t = 0;
              for (const f of Object.values(totals)) {
                l += f.loaded;
                t += f.total;
              }
              if (t > 0) onProgress(Math.min(1, l / t));
            }
          },
        });
        extractor = async (text: string) => {
          const out = await pipe(text, { pooling: "mean", normalize: true });
          return out.data as Float32Array;
        };
        onProgress(1);
      },
    },
    {
      id: "smart-search-vectors",
      label: "Loading icon vectors",
      weight: 32,
      run: async (onProgress) => {
        const bin_url = `${EMBED_BASE}/embeddings-v1.bin`;
        const buf = await fetchWithProgress(bin_url, { onProgress, cache: "force-cache" });
        if (!meta) throw new Error("meta not loaded");
        matrix = decodeF16Matrix(buf, meta.count, meta.dims);
      },
    },
    {
      id: "smart-search-warm",
      label: "Warming up",
      weight: 8,
      run: async () => {
        if (!extractor || !matrix || !meta) throw new Error("smart search index incomplete");
        // A warm-up query primes the model so the first real search is instant.
        await extractor("warm up");
        const m = meta;
        const mat = matrix;
        const ex = extractor;
        indexPromise = Promise.resolve({ meta: m, matrix: mat, embedQuery: ex });
      },
    },
  ];
}

/**
 * Rank assets for a query using the loaded semantic index, BLENDED with the
 * keyword baseline. `manifest` MUST be in the same order the vectors were built
 * from (the asset-library manifest); row i == manifest[i]. Falls back to keyword
 * only if the index size no longer matches the manifest (corpus drift).
 */
export async function semanticSearch(
  manifest: LibraryAsset[],
  query: string,
  opts: { limit?: number } = {},
): Promise<ScoredAsset[]> {
  const limit = opts.limit ?? 240;
  const keyword = rankAssets(manifest, query, { limit });
  if (!indexPromise) return keyword; // index not loaded -> keyword only
  const index = await indexPromise;
  if (index.meta.count !== manifest.length) return keyword; // drift guard
  const q = await index.embedQuery(query);
  const hits = dotTopK(index.matrix, q, index.meta.count, index.meta.dims, limit);
  const semantic: ScoredAsset[] = hits
    .filter((h) => manifest[h.row])
    .map((h) => ({ asset: manifest[h.row], score: h.score }));
  return blendResults(keyword, semantic, limit);
}
