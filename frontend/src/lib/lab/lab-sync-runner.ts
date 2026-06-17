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
import { buildLabIndex, pushLabIndex } from "./lab-index";

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
 */
export interface LabSyncRunResult {
  ran: boolean;
  reason?: string;
  owner?: string;
  pushed?: string[];
  skipped?: string[];
  tombstoned?: string[];
}

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

  // Step 3: sync. If this throws, we let it propagate (see error policy above).
  const result = await doSync({
    labId: session.labId,
    owner,
    records,
    labKey: session.labKey,
    signerEd25519Priv: session.signingKeyPair.ed25519Priv,
    signerEd25519Pub: session.signingKeyPair.ed25519Pub,
    manifest,
    tombstoneRemoved: true,
  });

  // Step 4: persist the updated manifest ONLY on success.
  await deps.manifestStore.save(owner, result.manifest);

  // Step 5: rebuild and push the index when the content actually changed. The
  // index is derived from the same enumerated records, so it only moves when a
  // record pushed or was tombstoned this run. On a fully-skipped (idle) run the
  // index is unchanged, so we skip the write. Best-effort: an index push hiccup
  // must not fail a content sync that already succeeded (the next changed run
  // rebuilds it).
  const contentChanged =
    result.pushed.length > 0 || result.tombstoned.length > 0;
  if (contentChanged) {
    const pushIndex = deps.pushIndexImpl ?? pushLabIndex;
    try {
      await pushIndex({
        labId: session.labId,
        owner,
        index: buildLabIndex(owner, records),
        labKey: session.labKey,
        signerEd25519Priv: session.signingKeyPair.ed25519Priv,
        signerEd25519Pub: session.signingKeyPair.ed25519Pub,
      });
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
  };
}
