// Markdown embed hybrid, Phase 7 (P7-4). External embed metadata cache.
//
// Fetched metadata (citation cards, link-preview titles) is cached into the SAME
// per-document `<note>.ros-embeds.json` sidecar that the pin system uses. The sidecar
// grows an `external` section keyed by the external URL (without fragment). A cached
// card renders immediately offline and feeds the export bibliography without a second
// network round-trip.
//
// Separation of concerns: this module handles the cache read/write layer. The actual
// network fetches live in the renderer components (CiteCard, StructureCard, LinkCard)
// and in external-fetch.ts. The renderer calls `getExternalCache` on mount; when a
// hit is found the card renders from cache; on a miss the renderer fetches and calls
// `putExternalCache` to persist for next time.
//
// The sidecar file format is backward-compatible. A sidecar written by a client that
// does not know about the `external` section simply lacks it; `getExternalCache`
// returns null, the renderer fetches fresh. A sidecar written by a client that DOES
// know about it carries `external: { "<url>": ExternalCacheEntry }`. Old clients
// loading a sidecar with an `external` key ignore the unknown field (the shape guard
// in embed-pins.ts already collapses unknown shapes gracefully).
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";

// ── On-disk shapes ─────────────────────────────────────────────────────────────

/** Cached data for a citation card (DOI or PMID). */
export interface CiteCache {
  kind: "cite";
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  url: string;
  /** ISO timestamp when the cache was written. */
  cachedAt: string;
}

/** Cached data for a structure card (PubChem CID or SMILES). */
export interface StructureCache {
  kind: "structure";
  name: string;
  formula: string;
  mol_weight: number | null;
  /** PubChem CID, null when the entry came from a bare SMILES. */
  cid: number | null;
  /** The canonical SMILES (from PubChem or passed through from the bare input). */
  smiles: string;
  inchikey: string;
  /** PubChem 2D depiction PNG URL, null when the entry came from a bare SMILES. */
  pngUrl: string | null;
  cachedAt: string;
}

/** Cached data for a link-preview card. */
export interface LinkCache {
  kind: "link";
  title: string;
  domain: string;
  /** Best available favicon URL or null when none was found. */
  faviconUrl: string | null;
  cachedAt: string;
}

export type ExternalCacheEntry = CiteCache | StructureCache | LinkCache;

/** The external section of the sidecar, keyed by the URL without fragment. */
export type ExternalCacheSection = Record<string, ExternalCacheEntry>;

// ── Sidecar read/write (merged into the existing pins sidecar) ─────────────────
//
// We reuse the same `<note>.ros-embeds.json` file that embed-pins.ts manages.
// Rather than re-exporting internal helpers from that module, we reach the file
// directly through fileService and merge the `external` key into whatever shape
// the file already has (version 1 pins sidecar or empty). This keeps the two
// concerns independent and avoids circular imports.

interface LooseSidecar {
  version?: unknown;
  pins?: unknown;
  external?: unknown;
}

async function readLooseSidecar(sidecarPath: string): Promise<LooseSidecar> {
  try {
    const raw = await fileService.readJson<unknown>(sidecarPath);
    if (raw && typeof raw === "object") return raw as LooseSidecar;
  } catch {
    // Missing or malformed file is fine; we treat it as empty.
  }
  return {};
}

function isExternalSection(value: unknown): value is ExternalCacheSection {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Read the cached entry for a given external URL from the sidecar. Returns null
 * on a cache miss (absent sidecar, absent key, or malformed entry). Never throws.
 */
export async function getExternalCache(
  sidecarPath: string,
  url: string,
): Promise<ExternalCacheEntry | null> {
  if (!sidecarPath || !url) return null;
  try {
    const loose = await readLooseSidecar(sidecarPath);
    if (!isExternalSection(loose.external)) return null;
    const entry = loose.external[url];
    if (!entry || typeof entry !== "object" || !("kind" in entry)) return null;
    return entry as ExternalCacheEntry;
  } catch {
    return null;
  }
}

/**
 * Write a cache entry for a given external URL into the sidecar. Merges into the
 * existing file so pins and other external entries are preserved. Best-effort; a
 * write failure is silently ignored (the renderer still showed the live data).
 */
export async function putExternalCache(
  sidecarPath: string,
  url: string,
  entry: ExternalCacheEntry,
): Promise<void> {
  if (!sidecarPath || !url) return;
  try {
    const loose = await readLooseSidecar(sidecarPath);
    const existing: ExternalCacheSection = isExternalSection(loose.external)
      ? loose.external
      : {};
    const next = {
      ...loose,
      external: { ...existing, [url]: entry },
    };
    await fileService.writeJson(sidecarPath, next);
  } catch {
    // Best-effort. A write failure leaves the cache cold for the next session.
  }
}

/**
 * Remove a specific URL's cache entry (e.g. when the user requests a refresh).
 * No-op when the sidecar is missing or the key is absent.
 */
export async function removeExternalCache(
  sidecarPath: string,
  url: string,
): Promise<void> {
  if (!sidecarPath || !url) return;
  try {
    const loose = await readLooseSidecar(sidecarPath);
    if (!isExternalSection(loose.external) || !loose.external[url]) return;
    const nextExternal = { ...loose.external };
    delete nextExternal[url];
    await fileService.writeJson(sidecarPath, { ...loose, external: nextExternal });
  } catch {
    // Best-effort.
  }
}
