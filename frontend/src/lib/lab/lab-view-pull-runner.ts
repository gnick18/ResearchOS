// Multi-lab P2: member lab-view PULL orchestrator.
//
// DESIGN: this is the PULL counterpart to runLabSyncForSession (lab-sync-runner
// .ts). The push runner mirrors a member's OWN folder to R2; this runner pulls
// the relay-assembled lab view back and MATERIALIZES the shared-with-me records
// into the active member (OPFS) folder so the existing folder-bound consumers
// light up without re-pointing each one (that is P3).
//
// PIPELINE (for a live session):
//   1. getLabRemote(labId) -> the head-signed roster (the owners list).
//   2. pullLabView(labId, viewer, owners, labKey, signing keys) -> decrypt every
//      record under the IN-MEMORY session lab key, returning own + shared-with-me.
//   3. materializeLabView(records) -> write ONLY the shared-with-me records into
//      the local folder. Own records are skipped (residency: local folder is the
//      source of truth, never read back from R2).
//
// RESIDENCY (CRITICAL, spec critic):
//   The member view = own(local folder) UNION shared-with-me(materialized from
//   R2). pullLabView returns both, but materializeLabView writes only the
//   shared-with-me half, leaving the member's own records untouched in the local
//   folder. We do NOT demote own-record reads to R2.
//
// PER-RECORD SHARING (CRITICAL):
//   pullLabView already enforces each record's shared_with: a non-PI member sees
//   another member's record only if shared_with names them. This runner adds NO
//   role-based read; it forwards the roster owners verbatim and relies on
//   pullLabView's gate. The PI-all path (pullMemberLabRecords) is deliberately
//   NOT used here.
//
// CRYPTO (CRITICAL):
//   Every record is decrypted under session.labKey via pullLabView -> getLabRecord
//   -> decryptLabData. The relay never holds the lab key, so the R2 store stays
//   server-blind. Nothing here weakens that.
//
// ALL EXTERNAL EFFECTS are injected via LabViewPullDeps so the function is fully
// unit-testable without a browser, file-system handle, or network. Production
// supplies the real getLabRemote / pullLabView / materializeLabView.
//
// ERROR POLICY: errors from the roster fetch, the pull, or the materialize are
// RETHROWN to the caller (the hook catches and logs them, exactly like the push
// hook). A failed pull leaves the previously materialized cache untouched so the
// next trigger retries.
//
// FLAG: gated by LAB_AS_FOLDER_ENABLED at the production caller (the hook). With
// the flag off, the pull never mounts and this module is inert.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabSessionState } from "./lab-session";
import { getLabRemote } from "./lab-do-client";
import { pullLabView, type LabViewRecord } from "./lab-read";
import { materializeLabView, type MaterializeResult } from "./lab-view-materialize";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * All external effects injected into runLabViewPullForSession. Nothing is
 * imported at module level from the filesystem, network, or session store at
 * call time; every effect is overridable for tests.
 */
export interface LabViewPullDeps {
  /**
   * Fetch the head-signed lab record (the roster). Default: getLabRemote.
   * Returns null when the relay has no such lab (a fresh / not-yet-propagated
   * membership); the runner treats that as "nothing to pull yet".
   */
  getRemoteImpl?: typeof getLabRemote;

  /**
   * Reconstruct the member lab view from R2 (own + shared-with-me), decrypting
   * under the lab key. Default: pullLabView.
   */
  pullImpl?: typeof pullLabView;

  /**
   * Materialize the shared-with-me records into the active OPFS folder.
   * Default: materializeLabView.
   */
  materializeImpl?: typeof materializeLabView;
}

/**
 * The outcome of one pull run.
 *
 *   ran:        true iff the pull pipeline actually ran (session was live and a
 *               roster existed).
 *   reason:     present when ran is false; explains why the run was skipped.
 *   viewer:     the username whose view was pulled (present when ran is true).
 *   owners:     the roster owners the pull enumerated.
 *   pulled:     count of visible records returned by pullLabView (own + shared).
 *   materialized: the MaterializeResult (shared-with-me written, own skipped).
 */
export interface LabViewPullResult {
  ran: boolean;
  reason?: string;
  viewer?: string;
  owners?: string[];
  pulled?: number;
  materialized?: MaterializeResult;
}

// ---------------------------------------------------------------------------
// runLabViewPullForSession: main entry point.
// ---------------------------------------------------------------------------

/**
 * Runs one lab-view pull cycle for `session`.
 *
 * Early-exit conditions (no network, no write):
 *   - session.kind !== "live"            -> { ran: false, reason: "session not live" }.
 *   - getLabRemote returns null          -> { ran: false, reason: "no lab record" }.
 *
 * Happy path:
 *   1. getLabRemote(session.labId) for the roster owners.
 *   2. pullLabView over those owners, decrypting under session.labKey.
 *   3. materializeLabView writes the shared-with-me records (own are skipped).
 *
 * @param session   current lab session state snapshot.
 * @param deps      injected effects (all optional, production defaults).
 */
export async function runLabViewPullForSession(
  session: LabSessionState,
  deps: LabViewPullDeps = {},
): Promise<LabViewPullResult> {
  // Guard: only run when the session is live.
  if (session.kind !== "live") {
    return { ran: false, reason: "session not live" };
  }

  const doGetRemote = deps.getRemoteImpl ?? getLabRemote;
  const doPull = deps.pullImpl ?? pullLabView;
  const doMaterialize = deps.materializeImpl ?? materializeLabView;

  const viewer = session.member.username;
  const labId = session.labId;

  // Step 1: roster owners from the head-signed lab record.
  const remote = await doGetRemote(labId);
  if (remote === null) {
    return { ran: false, reason: "no lab record" };
  }

  // The owners list is every roster member (including the viewer). pullLabView
  // groups output by this order and skips its own-record write at materialize.
  const owners = remote.record.members.map((m) => m.username);

  // Step 2: pull + decrypt under the in-memory session lab key. pullLabView
  // enforces each record's shared_with for non-own records (per-record sharing),
  // so a non-PI member sees another member's record only when named.
  const records: LabViewRecord[] = await doPull({
    labId,
    viewer,
    owners,
    labKey: session.labKey,
    signerEd25519Priv: session.signingKeyPair.ed25519Priv,
    signerEd25519Pub: session.signingKeyPair.ed25519Pub,
  });

  // Step 3: materialize ONLY the shared-with-me records into the local folder.
  // Own records are the source of truth in the local folder and are skipped.
  const materialized = await doMaterialize(records);

  return {
    ran: true,
    viewer,
    owners,
    pulled: records.length,
    materialized,
  };
}
