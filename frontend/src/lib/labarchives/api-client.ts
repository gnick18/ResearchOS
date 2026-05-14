"use client";

import type { MissingInlineImage } from "@/lib/import/eln/types";
import { readDeployerCreds, type DeployerCreds } from "./deployer-store";
import { readConnection } from "./tokens-store";

/**
 * Browser-side helper for fetching Form-B inline images during ELN import.
 *
 * LabArchives requires every API call to carry an HMAC-SHA1 signature
 * keyed by the institutional access password, which can't live in the
 * client bundle. So the actual signing happens server-side at
 * `/api/labarchives/fetch-image` — this module is just the orchestration:
 * keep a small concurrency window so we don't hammer their API, retry on
 * transient errors, and bubble per-image failures up to the caller
 * (non-fatal, the wizard renders the existing placeholder for misses).
 *
 * Sidecar-mode wiring (Phase 3 of LabArchives local-first config): we read
 * the FSA `_labarchives-deployer.json` sidecar ONCE per `fetchInlineImages`
 * call and include the creds in every `/api/labarchives/fetch-image` POST
 * body. The server reads env vars first and only falls back to the body
 * when env is unset, so this is a no-op for shared deployments.
 */

/** How many image fetches we keep in flight at once. LabArchives doesn't
 *  publish a rate limit number, so we stay conservatively below "a tab
 *  in a real browser would do." */
const DEFAULT_CONCURRENCY = 4;

/** Per-fetch timeout. LabArchives can be slow for larger images. */
const FETCH_TIMEOUT_MS = 30_000;

export type FetchedImage =
  | { kind: "ok"; blob: Blob; contentType: string }
  | { kind: "error"; message: string };

/** Coarse classification of why a single image fetch failed. Used by the
 *  batch path to decide whether ALL failures share a likely-systemic root
 *  cause (connection dead, network down) vs being a mixed bag of one-off
 *  issues. Per-image granularity beyond this isn't useful to the UI. */
export type FetchFailureKind = "auth" | "network" | "config" | "parse" | "other";

export interface FetchImagesOptions {
  /** UID returned by the connect step. Required. */
  uid: string;
  /** Inline-image records pulled out of the parsed notebook. */
  images: MissingInlineImage[];
  /** Concurrency cap. Defaults to 4. */
  concurrency?: number;
  /** Called after each image resolves (success or failure). Used by the
   *  wizard to drive its progress bar. `current` is 1-indexed by item
   *  finished; `total` is the input length. */
  onProgress?: (current: number, total: number, last: MissingInlineImage) => void;
  /** Optional AbortSignal so the wizard can cancel mid-flight if the user
   *  bails out. */
  signal?: AbortSignal;
}

export interface FetchImagesResult {
  /** Map keyed by `MissingInlineImage.originalUrl` → fetched blob or error. */
  byUrl: Map<string, FetchedImage>;
  successCount: number;
  errorCount: number;
  /** True when EVERY image failed (`successCount === 0 && errorCount > 0`)
   *  AND there was at least one image attempted. Caller uses this to decide
   *  whether to surface a top-level "your connection may have expired"
   *  banner instead of (or alongside) the per-row error list. */
  allFailed: boolean;
  /** When `allFailed` is true AND every failure shared the same classified
   *  kind, this is that kind. Lets the UI render a more specific banner
   *  ("your connection has expired" for auth, "network looks down" for
   *  network, etc.). Null when failures were a mixed bag, when no failures
   *  occurred, or when `allFailed` is false. */
  dominantFailureKind: FetchFailureKind | null;
}

/**
 * Fetch the bytes for a single Form-B inline image. Used internally; tests
 * import this directly to verify the per-image path without spinning up
 * a concurrency queue.
 *
 * `deployerCreds` is the optional sidecar-mode creds payload. When set, the
 * server-side route reads them out of the body instead of from env vars.
 */
export async function fetchOneImage(
  uid: string,
  image: MissingInlineImage,
  signal?: AbortSignal,
  deployerCreds?: DeployerCreds | null,
): Promise<FetchedImage> {
  const tagged = await fetchOneImageTagged(uid, image, signal, deployerCreds);
  if (tagged.kind === "ok") {
    return { kind: "ok", blob: tagged.blob, contentType: tagged.contentType };
  }
  return { kind: "error", message: tagged.message };
}

/** Internal variant of `fetchOneImage` that carries a coarse failure-kind
 *  tag for batch-level aggregation. We don't expose the tag on the public
 *  `FetchedImage` shape because per-image callers don't need it — only the
 *  `allFailed` banner does. */
async function fetchOneImageTagged(
  uid: string,
  image: MissingInlineImage,
  signal?: AbortSignal,
  deployerCreds?: DeployerCreds | null,
): Promise<
  | { kind: "ok"; blob: Blob; contentType: string }
  | { kind: "error"; message: string; failureKind: FetchFailureKind }
> {
  // Without an entryPartId we can't address the LabArchives entry — surface
  // a clear error so the caller knows the original URL wasn't parseable.
  if (!image.entryPartId) {
    return {
      kind: "error",
      message: "Original URL did not include a parseable ep_id.",
      failureKind: "parse",
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  // Chain external signal → internal controller, so the caller can also
  // abort.
  const onParentAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onParentAbort);

  try {
    const bodyObj: {
      uid: string;
      entryPartId: string;
      deployerCreds?: DeployerCreds;
    } = { uid, entryPartId: image.entryPartId };
    if (deployerCreds) bodyObj.deployerCreds = deployerCreds;
    const res = await fetch("/api/labarchives/fetch-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyObj),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* ignore body parse failures — keep the status code */
      }
      // Map HTTP status to a coarse failure kind for batch aggregation.
      // 401/403 → auth (stored UID rejected by upstream → connection rot);
      // 500 → config (server-side env-var / sidecar issue);
      // 502 → network (upstream timeout / 5xx — pass-through from
      // `signedLabArchivesFetch`); everything else falls into "other".
      let failureKind: FetchFailureKind;
      if (res.status === 401 || res.status === 403) failureKind = "auth";
      else if (res.status === 500) failureKind = "config";
      else if (res.status === 502 || res.status === 503 || res.status === 504) failureKind = "network";
      else failureKind = "other";
      return { kind: "error", message, failureKind };
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const blob = await res.blob();
    return { kind: "ok", blob, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        kind: "error",
        message: "Request timed out or was cancelled.",
        failureKind: "network",
      };
    }
    // Browser-level fetch rejection (DNS failure, offline, CORS) is a
    // network problem from the user's perspective.
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      failureKind: "network",
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Batch-fetch a list of Form-B inline images with a fixed concurrency cap.
 * Returns a map keyed by `originalUrl` so the apply pipeline can look up
 * the bytes when it's time to write the markdown ref.
 *
 * Failures are non-fatal — they're recorded in the result map with `kind:
 * "error"` and the apply pass falls back to the existing placeholder.
 */
export async function fetchInlineImages(
  options: FetchImagesOptions,
): Promise<FetchImagesResult> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const total = options.images.length;
  const byUrl = new Map<string, FetchedImage>();
  let done = 0;
  let successCount = 0;
  let errorCount = 0;
  const failureKinds = new Set<FetchFailureKind>();

  // Read the sidecar once at the start of the batch — saves N FSA reads,
  // and the deployer creds don't change mid-import. `readDeployerCreds`
  // returns null when no sidecar exists (env-var mode), so the workers
  // just don't send the field and the server resolves from env.
  let deployerCreds: DeployerCreds | null = null;
  try {
    deployerCreds = await readDeployerCreds();
  } catch {
    // Best-effort. Network 5xx from the server will surface clearly.
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (options.signal?.aborted) return;
      const idx = nextIndex++;
      if (idx >= total) return;
      const image = options.images[idx];
      const tagged = await fetchOneImageTagged(
        options.uid,
        image,
        options.signal,
        deployerCreds,
      );
      if (tagged.kind === "ok") {
        byUrl.set(image.originalUrl, {
          kind: "ok",
          blob: tagged.blob,
          contentType: tagged.contentType,
        });
        successCount++;
      } else {
        byUrl.set(image.originalUrl, {
          kind: "error",
          message: tagged.message,
        });
        errorCount++;
        failureKinds.add(tagged.failureKind);
      }
      done++;
      options.onProgress?.(done, total, image);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // "All failed" gives the UI a single boolean to gate a top-level banner.
  // When every failure shared one kind, surface it so the banner copy can
  // be more specific ("connection expired" vs "network looks down"). A
  // mixed bag leaves `dominantFailureKind` null and the banner falls back
  // to a generic "all images failed" message.
  const allFailed = total > 0 && successCount === 0 && errorCount > 0;
  const dominantFailureKind: FetchFailureKind | null =
    allFailed && failureKinds.size === 1
      ? (failureKinds.values().next().value as FetchFailureKind)
      : null;

  return {
    byUrl,
    successCount,
    errorCount,
    allFailed,
    dominantFailureKind,
  };
}

/** Quick helper for the wizard step: is the receiver already connected to
 *  LabArchives in their data folder? */
export async function isLabArchivesConnected(username: string): Promise<boolean> {
  return (await readConnection(username)) !== null;
}
