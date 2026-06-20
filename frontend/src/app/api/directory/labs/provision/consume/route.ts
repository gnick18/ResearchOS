// PI-side CONSUME of a staged lab, called after the client genesis lands
// (staged-pi-provisioning lane).
//
// POST /api/directory/labs/provision/consume
//   Body: { labId }
//   Session-auth (signed-in user). The client has already run the lab genesis ON
//   DEVICE and published it (createLabForCurrentUser -> publishLabRemote), so the
//   directory_labs row for labId already exists with pi_email_hash set to this
//   PI's peppered hash. This endpoint finalizes the staging:
//     1. Verify the directory_labs row for labId has pi_email_hash === session
//        hash (the genesis wrote it). A mismatch is a 403 (the caller does not own
//        this lab).
//     2. Verify a pending staging exists for the hash. None is a 409 (nothing to
//        consume; the client should not have called).
//     3. Bind the reserved slug to the lab by creating the lab_sites row. The slug
//        is already reserved to this PI hash (stage time), so this is authorized.
//     4. Flip directory_labs.listed=true (operator intent = a real visible lab).
//     5. Mark the staging consumed so a second sign-in does not re-run this.
//
//   Returns { ok: true, slug }.
//
// The server never sees the PI private keys. The genesis and the key sealing
// happen client-side; this route only wires up the public metadata the operator
// staged to the real lab the client just created.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import {
  ensureLabsSchema,
  ensureSchema,
  getLabListing,
  setLabListed,
} from "@/lib/sharing/directory/db";
import { createSite } from "@/lib/social/lab-site-db";
import {
  getProvisionStaging,
  markProvisionConsumed,
} from "@/lib/lab/provision-staging-db";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "unauthorized" });

  let body: { labId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const labId = typeof body.labId === "string" ? body.labId.trim() : "";
  if (!labId) return json(400, { error: "labId is required" });

  let piEmailHash: string;
  try {
    piEmailHash = ownerKeyForEmail(email);
  } catch {
    return json(503, { error: "server not configured (missing pepper)" });
  }

  // 1. The genesis already wrote the directory_labs row. Verify it belongs to
  //    this PI before doing anything else (fail closed on a mismatch or a missing
  //    row, so a caller cannot consume a staging against someone else's lab).
  let listing;
  try {
    await ensureSchema();
    await ensureLabsSchema();
    listing = await getLabListing(labId);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!listing) return json(404, { error: "lab not found" });
  if (listing.piEmailHash !== piEmailHash) {
    return json(403, { error: "forbidden" });
  }

  // 2. A pending staging must exist for this PI. None means there is nothing to
  //    consume (already consumed, or never staged).
  let staging;
  try {
    staging = await getProvisionStaging(piEmailHash);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!staging || staging.status !== "pending") {
    return json(409, { error: "no pending staging" });
  }

  // 3. Bind the reserved slug to the real lab by creating the lab_sites row. The
  //    slug was reserved to this PI hash at stage time, and lab_sites is keyed by
  //    the lab owner key (the PI hash), so this write is authorized by ownership.
  try {
    await createSite(piEmailHash, staging.slug);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  // 4. Flip the listing visible. The operator staged a real lab, so the intent is
  //    a listed, discoverable lab the moment the PI lands.
  try {
    await setLabListed(labId, true);
  } catch {
    // Best-effort: a failed flip leaves the lab unlisted, which the PI can toggle
    // later. The slug bind already succeeded, so do not fail the whole consume.
  }

  // 5. Mark the staging consumed so a second sign-in is a clean no-op.
  try {
    await markProvisionConsumed(piEmailHash);
  } catch {
    // Best-effort: a failed mark leaves the row pending, which only re-runs the
    // (idempotent) bind + flip on the next boot. The slug + listing are already
    // correct, so this does not corrupt anything.
  }

  return json(200, { ok: true, slug: staging.slug });
}
