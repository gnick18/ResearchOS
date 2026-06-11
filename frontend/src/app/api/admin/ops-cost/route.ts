// Operator-only cost-per-owner view for collab operations (Grant 2026-06-07).
//
// GET /api/admin/ops-cost
//
// Storage is the only thing on a user's bill, but the heaviest cost can come from
// a low-storage, high-activity owner. This endpoint surfaces, per owner, the
// write operations counted at the collab growth point and the estimated monthly
// cost they imply (rows written + requests at the published Cloudflare rates), so
// the operator can see who is expensive before deciding any fair-use policy.
//
// Operator-only, gated exactly like /api/admin/business, an unknown email gets a
// 404 so the endpoint's existence is not leaked. Tracking only, never billed.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { json } from "@/lib/sharing/directory/guard";
import { estimatedOpsCostCents } from "@/lib/billing/config";
import { ensureOpsSchema, topOwnersByWrites } from "@/lib/billing/ops";

export const runtime = "nodejs";

/** YYYY-MM-DD `days` ago, the start of the window. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function GET(): Promise<Response> {
  const blocked = await requireOperator();
  if (blocked) return blocked;

  try {
    await ensureOpsSchema();
    const since = isoDaysAgo(31);
    const owners = await topOwnersByWrites(since, 25);

    const rows = owners.map((o) => ({
      // Truncated key, the operator never needs the full hash.
      owner: `${o.ownerKey.slice(0, 12)}…`,
      writes: o.writes,
      writtenBytes: o.writtenBytes,
      estimatedCostCents: estimatedOpsCostCents(o.writes),
    }));
    const totalCostCents = rows.reduce((s, r) => s + r.estimatedCostCents, 0);

    return json(200, {
      windowDays: 31,
      owners: rows,
      totalEstimatedCostCents: totalCostCents,
      note: "Estimate covers rows written + requests. Durable Object duration is not attributed yet.",
    });
  } catch {
    return json(500, { error: "ops cost lookup failed" });
  }
}
