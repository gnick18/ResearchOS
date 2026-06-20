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
import { enumerateLabWork, type LabWorkSource, type LabWorkRecord } from "./lab-work-enumerate";
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
import {
  isPrivateClassNotebookRecord,
  writePrivateNotebookRecord,
} from "./class-private-notebook";
import { getLabRemote } from "./lab-do-client";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { labDataObjectKey } from "./lab-data-protocol";

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

  /**
   * CLASS MODE (Stage 2). Fetch the head-signed roster so the private-notebook
   * write path can resolve the student LabMember (the session owner) and the
   * head LabMember (role === "head") it seals the per-student subkey to. Default:
   * getLabRemote. Only ever called when at least one private class notebook is
   * partitioned out of the team-key push, so a non-class lab pays no extra fetch.
   */
  getRemoteImpl?: typeof getLabRemote;

  /**
   * CLASS MODE (Stage 2). Read the unlocked session identity to recover the
   * student's x25519 PRIVATE key (decision 1: from getSessionIdentity at call
   * time, no new long-lived reference). writePrivateNotebookRecord needs it to
   * recover / mint the per-student subkey. Default: getSessionIdentity.
   */
  getIdentityImpl?: typeof getSessionIdentity;

  /**
   * CLASS MODE (Stage 2). The dedicated subkey write path for one private
   * notebook. Default: writePrivateNotebookRecord. Injected in tests to assert
   * the partition routes exactly the private notebooks here and nothing else.
   */
  writePrivateNotebookImpl?: typeof writePrivateNotebookRecord;
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
  /**
   * CLASS MODE (Stage 2). R2 object keys of private student notebooks pushed via
   * the dedicated subkey path this run (sealed under the per-student subkey, not
   * the team key). Empty on every non-class lab and every flag-off run.
   */
  privateNotebooksPushed?: string[];
}

// Module-level default for the index dedup cache. The runner only ever syncs the
// current session member's own records, so this holds a single entry. It resets
// on reload, which at worst causes one redundant index push per session.
const moduleIndexCache = new Map<string, string>();

/**
 * Lowercase hex sha256 of the given bytes via WebCrypto, used to dedup the
 * private-notebook write path against its carried-forward manifest. Mirrors the
 * content-hash dedup the team-key sync engine does internally (lab-sync.ts), so a
 * private notebook unchanged since last sync is not re-sealed and re-pushed.
 */
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const enumerated = await enumerateLabWork({ owner, source: deps.source });

  // CLASS MODE (Stage 2) PARTITION. A private student notebook must NOT ride the
  // generic team-key push: that would seal it under the team key (classmate
  // readable) AND leak its preview into the team-key lab INDEX. Partition it OUT
  // exactly once, up front, so every downstream generic consumer (size-gate,
  // sync engine, index build, manifest removal scan) sees ONLY the team records.
  // The private notebook is pushed by the dedicated subkey write path below.
  //
  // EXCLUSIVITY INVARIANT: isPrivateClassNotebookRecord is the single, total
  // arbiter. Every record satisfies exactly one branch, so a private notebook is
  // pushed by exactly one path, never both. Flag off the predicate always
  // returns false, so `records` === `enumerated` and the generic path is
  // byte-identical to today (no partition, no roster fetch, no identity read).
  const records: LabWorkRecord[] = [];
  const privateNotebooks: LabWorkRecord[] = [];
  for (const r of enumerated) {
    if (isPrivateClassNotebookRecord(r.recordType, r.plaintext)) {
      privateNotebooks.push(r);
    } else {
      records.push(r);
    }
  }

  // Step 2: load manifest. The manifest spans BOTH paths (one R2-key -> sha256
  // map). Split it so the team-key engine only sees the team keys (it tombstones
  // any input-manifest key it no longer finds among live records; a private-key
  // it never sees would otherwise be wrongly tombstoned), while the private
  // notebooks keep their own dedup entries. The two halves are merged back before
  // save so neither path re-pushes an unchanged record on the next run.
  const fullManifest = await deps.manifestStore.load(owner);
  const privateKeySet = new Set(
    privateNotebooks.map((r) =>
      labDataObjectKey(session.labId, owner, r.recordType, r.recordId),
    ),
  );
  // Carry forward any private-notebook keys already in the manifest from prior
  // syncs (their owner is always this session owner, so the key is reconstructable
  // the same way). A team key is everything not in the private set.
  const manifest: Record<string, string> = {};
  const priorPrivateManifest: Record<string, string> = {};
  for (const [k, v] of Object.entries(fullManifest)) {
    if (privateKeySet.has(k)) priorPrivateManifest[k] = v;
    else manifest[k] = v;
  }

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

  // CLASS MODE (Stage 2) PRIVATE NOTEBOOK WRITE. Push each partitioned-out
  // private notebook through the DEDICATED subkey path. This seals it under the
  // student's per-student subkey (sealed only to the student + the head), so a
  // classmate holding the team key cannot read it. We dedup by content sha256
  // against the carried-forward private manifest so an unchanged notebook is not
  // re-pushed every sync.
  //
  // The roster + identity are read ONLY when there is at least one private
  // notebook, so every non-class lab (and every flag-off build) pays no extra
  // fetch and stays byte-identical.
  const privateManifest: Record<string, string> = { ...priorPrivateManifest };
  const privatePushed: string[] = [];
  if (privateNotebooks.length > 0) {
    const getRemote = deps.getRemoteImpl ?? getLabRemote;
    const getIdentity = deps.getIdentityImpl ?? getSessionIdentity;
    const writeNotebook = deps.writePrivateNotebookImpl ?? writePrivateNotebookRecord;

    const remote = await getRemote(session.labId);
    const identity = getIdentity();
    const members = remote?.record.members ?? [];
    const headMember = members.find((m) => m.role === "head");
    const studentMember = members.find((m) => m.username === owner);
    const x25519Priv = identity?.keys.encryption.privateKey;

    // Guard: without the roster head, the session student member, and the
    // student x25519 key we cannot seal the subkey. Skip the private write this
    // run (the notebook stays unpushed and retries next sync) rather than leak it
    // under the team key. Never abort the whole sync (the team push already
    // succeeded and its manifest must still be saved).
    if (headMember && studentMember && x25519Priv) {
      for (const nb of privateNotebooks) {
        const key = labDataObjectKey(
          session.labId,
          owner,
          nb.recordType,
          nb.recordId,
        );
        const sha = await sha256HexBytes(nb.plaintext);
        if (privateManifest[key] === sha) {
          // Unchanged since last sync: skip (dedup).
          continue;
        }
        const out = await writeNotebook({
          labId: session.labId,
          student: studentMember,
          head: headMember,
          recordType: nb.recordType,
          recordId: nb.recordId,
          plaintext: nb.plaintext,
          teamKey: session.labKey,
          signerEd25519Priv: session.signingKeyPair.ed25519Priv,
          signerEd25519Pub: session.signingKeyPair.ed25519Pub,
          x25519PrivateKey: x25519Priv,
        });
        if ("subkey" in out) {
          privateManifest[key] = sha;
          privatePushed.push(key);
        }
        // A { refused } outcome (flag off mid-run) leaves the manifest entry
        // absent so the next sync retries; it never leaks to the team key.
      }
    }
  }

  // Step 4: persist the updated manifest ONLY on success. Merge the team-key
  // engine manifest with the private-notebook manifest so neither path re-pushes
  // an unchanged record next run. The two key spaces are disjoint (a private key
  // is never in the team manifest and vice versa), so the merge is conflict-free.
  await deps.manifestStore.save(owner, { ...result.manifest, ...privateManifest });

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
    privateNotebooksPushed: privatePushed,
  };
}
