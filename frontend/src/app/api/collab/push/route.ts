// Phase 3c chunk 1: collab push route.
//
// POST /api/collab/push
//
// Body (signed collab-push request):
//   { action: "collab-push", email, issuedAt, docId, signature, update: "<base64>" }
//
// Returns:
//   { ok: true, version: number }
//   where version is the id of the newly appended update row.
//
// The client calls this for each Loro update produced by a local edit. The
// update bytes are appended to the server-side log. The live DO fan-out to
// other connected clients is a separate concern handled by the DO relay
// (chunk 2); this route only handles the canonical persistence side.
//
// Compaction is triggered automatically when the outstanding update count
// exceeds COMPACT_THRESHOLD. Compaction is best-effort: if it throws the
// push still returns ok (the update was appended, only compaction failed).
//
// Auth: Ed25519 signed collab-push request, caller must be a doc member.
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL.

import {
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyCollabRequest } from "@/lib/collab/server/auth";
import {
  appendUpdate,
  COMPACT_THRESHOLD,
  compactDoc,
  ensureCollabSchema,
  getCatchup,
  getDocUsage,
  isMember,
} from "@/lib/collab/server/db";
import { CollabBudgetError } from "@/lib/collab/server/limits";
import { isBillingEnabled } from "@/lib/billing/config";
import { activityThrottleState, rateGate } from "@/lib/billing/throttle";
import { isCloudPaused } from "@/lib/billing/breaker";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "push failed" } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Cost circuit breaker. When tripped (estimated cost over budget), cloud
  // writes pause to stop a runaway provider bill. The push is RETRYABLE: the
  // edit stays in the client's local Loro doc and syncs once the operator resets
  // the breaker. Cached read, fails open (a DB hiccup never blocks a write).
  if (await isCloudPaused()) {
    return json(503, { error: "cloud sync paused", paused: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  await ensureCollabSchema();

  const verified = await verifyCollabRequest(body, "collab-push", getPepper());
  if (!verified) {
    return json(400, GENERIC_FAILURE);
  }

  const { emailHash, parsed } = verified;
  const { docId } = parsed;

  // Extract the update bytes from the body. The update field is NOT part of the
  // signed payload (it is the payload being stored, not a commitment), so we
  // read it from the raw body record after signature verification passes.
  const rawBody = body as Record<string, unknown>;
  if (typeof rawBody.update !== "string" || rawBody.update.length === 0) {
    return json(400, GENERIC_FAILURE);
  }
  let updateBytes: Uint8Array;
  try {
    updateBytes = new Uint8Array(Buffer.from(rawBody.update, "base64"));
  } catch {
    return json(400, GENERIC_FAILURE);
  }

  // Membership check.
  const member = await isMember(docId, emailHash);
  if (!member) {
    return json(403, { error: "not a member" });
  }

  // Activity throttle (flat-plan model, chunk C). Dormant unless BILLING_ENABLED
  // is on, so beta runs the push path unchanged. When the DOC OWNER (the bill
  // payer, not the author) is over their monthly activity allowance, pushes are
  // rate-limited to one every few seconds, degrading real-time sync to periodic.
  // A blocked push is RETRYABLE: the edit stays in the client's local Loro doc
  // and is included in a later push, so nothing is lost.
  if (isBillingEnabled()) {
    try {
      const usage = await getDocUsage(docId);
      const ownerHash = usage?.ownerHash;
      if (ownerHash) {
        const state = await activityThrottleState(ownerHash);
        if (state.over) {
          const gate = await rateGate(ownerHash);
          if (!gate.allowed) {
            return json(429, {
              error: "activity throttled",
              throttled: true,
              retryAfterMs: gate.retryAfterMs,
            });
          }
        }
      }
    } catch {
      // A throttle-check failure must never block a legitimate write.
    }
  }

  // Storage budget gate. appendUpdate throws CollabBudgetError when this write
  // would push the doc or the owner past the collab persistence budget (see
  // lib/collab/server/limits.ts). Surface that as a 413 with the scope that was
  // hit so the client can tell an oversized edit apart from a full account,
  // rather than letting Neon fill silently.
  let newId: number;
  try {
    newId = await appendUpdate(docId, updateBytes, emailHash);
  } catch (err) {
    if (err instanceof CollabBudgetError) {
      return json(413, { error: "storage budget reached", scope: err.scope });
    }
    throw err;
  }

  // Best-effort compaction when the outstanding update log grows large. We count
  // by fetching the catchup (cheap meta query) and trigger compaction only when
  // the delta exceeds the threshold. A compaction error must not fail the push.
  try {
    const catchup = await getCatchup(docId);
    if (catchup && catchup.updates.length >= COMPACT_THRESHOLD) {
      await compactDoc(docId);
    }
  } catch {
    // Compaction failure is non-fatal. The update was appended above.
  }

  return json(200, { ok: true, version: newId });
}
