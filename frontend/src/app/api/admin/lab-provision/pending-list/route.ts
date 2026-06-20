// Operator endpoint listing the currently PENDING staged labs (staged-pi-
// provisioning lane).
//
// GET /api/admin/lab-provision/pending-list
//   Operator-only (requireOperator gate). Returns the pending stagings so the
//   admin panel can show what is staged but not yet claimed, each with an
//   "Unstage" affordance.
//
//   Shape: { staged: Array<{ piEmailHash, labName, slug, compTier, compMonths,
//            createdAt }> }
//
// Only the public metadata an operator typed is returned. piEmailHash is a
// peppered HMAC, safe to surface as an opaque identifier.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { listPendingStagings } from "@/lib/lab/provision-staging-db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const blocked = await requireOperator();
  if (blocked) return blocked;
  if (!isSharingEnabled()) return json(404, { error: "not found" });

  let staged;
  try {
    staged = await listPendingStagings();
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, { staged });
}
