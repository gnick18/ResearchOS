// Operator-only read of the measured relay-write footprint, the ground truth
// for the pricing model's per-tier relayWritesM seed. Mirrors the gating of the
// other /api/admin routes: sharing must be enabled AND the caller must be an
// operator (ADMIN_EMAILS OAuth session or a valid operator access-code cookie).
//
// Returns a zeroed benchmark (period null) when there is no recorded activity
// yet, so the pricing dashboard renders a "no data yet" state rather than a
// misleading zero footprint.

import { getActivityBenchmark } from "@/lib/collab/server/db";
import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;
  try {
    const benchmark = await getActivityBenchmark();
    return json(200, benchmark);
  } catch {
    // A measurement hiccup should never break the dashboard; report no data.
    return json(200, { period: null, activeOwners: 0, avgWritesPerOwner: 0 });
  }
}
