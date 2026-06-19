// Operator storage-inventory endpoint (powers the /admin Storage inventory section).
//
// GET /api/admin/storage-inventory[?refresh=1]
//
// Gated on the signed-in OAuth email being an operator (ADMIN_EMAILS). Anyone
// else gets a 404, so the endpoint's existence is not advertised. Returns the
// per-bucket, per-prefix object/byte breakdown across the R2 buckets (the icon
// library and the app data bucket). ?refresh=1 forces a fresh walk past the cache.

import { requireOperator } from "@/lib/sharing/operator-access";
import { json } from "@/lib/sharing/directory/guard";
import { getStorageInventory } from "@/lib/library/storage-inventory";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const blocked = await requireOperator();
  if (blocked) return blocked;

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const inventory = await getStorageInventory(refresh);
    return json(200, inventory);
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "storage inventory failed",
    });
  }
}
