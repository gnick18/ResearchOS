// Lab-tier Phase 3 chunk 2b-bind: sync trigger orchestrator.
//
// DESIGN: this module composes the three already-built pieces (session state,
// work enumeration, R2 sync engine) into a single runLabSyncForSession()
// function that can be called on a timer or on-focus event while a lab session
// is live.
//
// ALL EXTERNAL EFFECTS are injected via LabSyncRunDeps so the function is fully
// unit-testable without a browser, file-system handle, or network. The
// production caller (the browser lifecycle slice that wires this into the app)
// supplies the real implementations.
//
// ERROR POLICY: errors from enumeration, syncLabWorkToMirror, or the
// manifestStore are RETHROWN to the caller. The manifest is saved ONLY on
// success (after syncLabWorkToMirror resolves). A failed sync leaves the
// previous manifest untouched so the next run retries every record that
// failed. This is the correct choice because a partially-written manifest
// would cause the sync engine to skip records it has NOT successfully pushed,
// silently diverging the mirror from the source of truth.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabSessionState } from "./lab-session";
import { enumerateLabWork, type LabWorkSource } from "./lab-work-enumerate";
import { syncLabWorkToMirror } from "./lab-sync";
import type { ManifestStore } from "./lab-sync-manifest-store";
import {
  buildLabIndex,
  pushLabIndex,
  splitBySize,
  HEAVY_CONTENT_THRESHOLD_BYTES,
} from "./lab-index";
import {
  pruneExpired,
  activeGrantKeys,
  type ApprovalGrantStore,
} from "./lab-approval-grants";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * All external effects injected into runLabSyncForSession. Nothing is
 * imported at module level from the filesystem, network, or session store.
 */
export interface LabSyncRunDeps {
  /** Data source that yields raw persisted records for each lab-work type. */
  source: LabWorkSource;

  /** Manifest persistence (load before sync, save after success). */
  manifestStore: ManifestStore;

  /**
   * Optional override for the sync engine (default: syncLabWorkToMirror).
   * Injected in tests to avoid real R2 network calls.
   */
  syncImpl?: typeof syncLabWorkToMirror;

  /**
   * Optional override for the index push (default: pushLabIndex). Injected in
   * tests to avoid real R2 network calls.
   */
  pushIndexImpl?: typeof pushLabIndex;

  /**
   * Heavy-content size threshold in bytes (default: HEAVY_CONTENT_THRESHOLD_BYTES).
   * Records above it are indexed but held back from the eager push. Injected in
   * tests to exercise gating with small fixtures.
   */
  heavyThresholdBytes?: number;

  /**
   * Per-owner dedup cache for the index push, mapping owner to the last
   * successfully-pushed index JSON. Defaults to a module-level map (one entry,
   * the current user). Injected fresh in tests so cases do not share state.
   */
  indexHashCache?: Map<string, string>;

  /**
   * Approval-grant store (Phase C). When provided, heavy records with an active
   * grant are promoted into the eager push and marked eager in the index, and
   * expired grants are pruned. When omitted, no heavy record is ever promoted
   * (pure Phase B behavior).
   */
  grantStore?: ApprovalGrantStore;

  /**
   * Optional override for Date.now() (not used in this function directly but
   * available for future extension, e.g. timeout guards). Reserved here to keep
   * the deps bag consistent with other lab-tier modules.
   */
  now?: () => number;
}

/**
 * The outcome of one sync run.
 *
 *   ran:        true iff the sync pipeline actually ran (session was live).
 *   reason:     present when ran is false; explains why the run was skipped.
 *   owner:      username whose records were synced (present when ran is true).
 *   pushed:     R2 object keys uploaded during this run.
 *   skipped:    R2 object keys whose content hash matched the manifest (no-op).
 *   tombstoned: R2 object keys overwritten with a tombstone sentinel.
 *   heavyHeld:  count of records held back from the eager push for being over
 *               the heavy threshold (indexed but fetched on demand, Phase B).
 */
export interface LabSyncRunResult {
  ran: boolean;
  reason?: string;
  owner?: string;
  pushed?: string[];
  skipped?: string[];
  tombstoned?: string[];
  heavyHeld?: number;
}

// Module-level default for the index dedup cache. The runner only ever syncs the
// current session member's own records, so this holds a single entry. It resets
// on reload, which at worst causes one redundant index push per session.
const moduleIndexCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// runLabSyncForSession: main entry point.
// ---------------------------------------------------------------------------

/**
 * Runs one lab-sync cycle for `session`.
 *
 * Early-exit conditions (no enumeration, no network):
 *   - session.kind !== "live"  ->  returns { ran: false, reason: "session not live" }.
 *
 * Happy path:
 *   1. Enumerate all lab work for session.member.username via deps.source.
 *   2. Load the existing manifest from deps.manifestStore.
 *   3. Run syncLabWorkToMirror (or deps.syncImpl) with the session's labId,
 *      labKey, and signing keys, and tombstoneRemoved: true.
 *   4. Save the RETURNED manifest (only on success).
 *   5. Return { ran: true, owner, pushed, skipped, tombstoned }.
 *
 * Error policy:
 *   Any thrown error propagates to the caller UNCHANGED. The manifest is NOT
 *   saved if syncLabWorkToMirror rejects (no half-written manifest).
 *
 * @param session   current lab session state snapshot.
 * @param deps      injected effects (source, manifestStore, optional overrides).
 */
export async function runLabSyncForSession(
  session: LabSessionState,
  deps: LabSyncRunDeps,
): Promise<LabSyncRunResult> {
  // Guard: only run when the session is live.
  if (session.kind !== "live") {
    return { ran: false, reason: "session not live" };
  }

  const owner = session.member.username;
  const doSync = deps.syncImpl ?? syncLabWorkToMirror;

  // Step 1: enumerate.
  const records = await enumerateLabWork({ owner, source: deps.source });

  // Step 2: load manifest.
  const manifest = await deps.manifestStore.load(owner);

  // Phase B size-gating: push only LIGHT content eagerly. Heavy records are
  // indexed (so they stay searchable) but held back from the eager push and
  // fetched on demand.
  const threshold = deps.heavyThresholdBytes ?? HEAVY_CONTENT_THRESHOLD_BYTES;
  const { light, heavy } = splitBySize(records, threshold);

  // Phase C: a heavy record with an ACTIVE approval grant (the PI requested it,
  // the member approved it, within its TTL) is promoted back into the eager
  // push and marked eager in the index. When its grant expires it falls out of
  // the push set, and the engine's tombstone-on-removal reverts it to on-demand
  // automatically. Expired grants are pruned so the store does not grow.
  const nowMs = (deps.now ?? (() => Date.now()))();
  const grantStore = deps.grantStore ?? null;
  const grants = grantStore ? pruneExpired(await grantStore.load(owner), nowMs) : [];
  const grantKeys = activeGrantKeys(grants, nowMs);
  const promotedHeavy = heavy.filter((r) =>
    grantKeys.has(`${r.recordType}/${r.recordId}`),
  );
  const toPush = [...light, ...promotedHeavy];

  // Step 3: sync the light records plus any granted heavy records. If this
  // throws, let it propagate.
  const result = await doSync({
    labId: session.labId,
    owner,
    records: toPush,
    labKey: session.labKey,
    signerEd25519Priv: session.signingKeyPair.ed25519Priv,
    signerEd25519Pub: session.signingKeyPair.ed25519Pub,
    manifest,
    tombstoneRemoved: true,
  });

  // Persist the pruned grant set (drops grants that just expired).
  if (grantStore) await grantStore.save(owner, grants);

  // Step 4: persist the updated manifest ONLY on success.
  await deps.manifestStore.save(owner, result.manifest);

  // Step 5: rebuild the index from ALL records (light and heavy, with an eager
  // flag per entry) and push it when it actually changed. The push is gated on
  // the index CONTENT, not on the light-sync result, so a heavy-record change
  // the light sync cannot see still refreshes the index. The per-owner cache
  // dedups identical re-pushes within a session and resets harmlessly on reload.
  // Best-effort: an index push hiccup must not fail a content sync that already
  // succeeded.
  const index = buildLabIndex(owner, records, threshold, grantKeys);
  const indexJson = JSON.stringify(index);
  const cache = deps.indexHashCache ?? moduleIndexCache;
  if (cache.get(owner) !== indexJson) {
    const pushIndex = deps.pushIndexImpl ?? pushLabIndex;
    try {
      await pushIndex({
        labId: session.labId,
        owner,
        index,
        labKey: session.labKey,
        signerEd25519Priv: session.signingKeyPair.ed25519Priv,
        signerEd25519Pub: session.signingKeyPair.ed25519Pub,
      });
      // Only record success, so a failed push retries on the next run.
      cache.set(owner, indexJson);
    } catch (err) {
      console.warn("[lab-sync-runner] index push failed", err);
    }
  }

  // Step 6: return summary.
  return {
    ran: true,
    owner,
    pushed: result.pushed,
    skipped: result.skipped,
    tombstoned: result.tombstoned,
    heavyHeld: heavy.length - promotedHeavy.length,
  };
}
