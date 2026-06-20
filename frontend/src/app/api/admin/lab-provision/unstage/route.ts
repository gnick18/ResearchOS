// Operator endpoint to UNSTAGE a pending staged lab (staged-pi-provisioning lane).
//
// POST /api/admin/lab-provision/unstage
//   Body: { piEmailHash } OR { email }
//   Operator-only (requireOperator gate, an unknown caller gets a 404).
//
// The UNDO for a mis-staged lab (wrong email/slug, a test stage) BEFORE the PI has
// ever signed in. It releases the reserved slug, revokes the comped grant, and
// deletes the staging row, all keyed to the PI owner hash.
//
// SAFETY: this only acts on a PENDING staging. If the PI already signed in (status
// 'consumed', the slug is bound to a live lab), it REFUSES with a 409 and changes
// NOTHING. The slug release itself double-checks for a lab_sites binding and a
// rename redirect, so a live lab's address can never be freed through this path.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import {
  getProvisionStaging,
  deleteProvisionStaging,
} from "@/lib/lab/provision-staging-db";
import { releaseReservedSlug } from "@/lib/social/slug-registry-db";
import { ensureGrantsSchema, revokeStagedGrant } from "@/lib/billing/grants";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const blocked = await requireOperator();
  if (blocked) return blocked;
  if (!isSharingEnabled()) return json(404, { error: "not found" });

  let body: { piEmailHash?: unknown; email?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  // The operator can identify the staging either by the raw email (typed) or by
  // the peppered hash (from the pending list, where the plaintext email is never
  // shown). The hash is the storage key either way.
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const rawHash = typeof body.piEmailHash === "string" ? body.piEmailHash.trim() : "";
  let piEmailHash: string;
  if (email) {
    try {
      piEmailHash = ownerKeyForEmail(email);
    } catch {
      return json(503, { error: "server not configured (missing pepper)" });
    }
  } else if (rawHash) {
    piEmailHash = rawHash;
  } else {
    return json(400, { error: "email or piEmailHash is required" });
  }

  // Load the staging. A missing row is a 404; the safety rule lives on the status.
  let staging;
  try {
    staging = await getProvisionStaging(piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!staging) return json(404, { error: "no staging found" });
  if (staging.status !== "pending") {
    return json(409, {
      error: "lab already provisioned, cannot unstage",
    });
  }

  // Release the reserved slug FIRST. releaseReservedSlug refuses if the slug is
  // bound to a live lab (a lab_sites row) or carries a rename redirect, so a
  // consumed lab's address is never freed even if the status check were bypassed.
  let released;
  try {
    released = await releaseReservedSlug(staging.slug, piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!released.ok) {
    if (released.reason === "bound") {
      return json(409, {
        error: "slug is bound to a live lab, cannot unstage",
      });
    }
    if (released.reason === "not-owner") {
      return json(409, { error: "slug ownership mismatch, aborting" });
    }
    // reason "not-found": the reservation is already gone, which is fine; fall
    // through and still clean up the grant + staging row.
  }

  // Revoke the comped grant (best-effort: a left-behind grant on an unowned hash
  // is inert because billing is keyed by owner_key and no one holds this key).
  let revokedGrants = 0;
  try {
    await ensureGrantsSchema();
    revokedGrants = await revokeStagedGrant(piEmailHash);
  } catch {
    // non-fatal; the staging delete below is the important part.
  }

  // Delete the staging row last, so a mid-failure leaves the row pending (and
  // re-runnable) rather than orphaning the slug/grant.
  try {
    await deleteProvisionStaging(piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, {
    ok: true,
    releasedSlug: released.ok ? staging.slug : null,
    revokedGrants,
  });
}
