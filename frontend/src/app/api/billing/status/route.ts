// Metered-storage billing, the caller's storage-plan status.
//
// GET /api/billing/status
//
// Returns the signed-in owner's free allowance, purchased blocks, and the block
// price, so the Settings UI can show a plan and an "Add storage" button. When
// BILLING_ENABLED is off it returns { enabled: false } so the UI hides the
// billing surface entirely rather than erroring.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import {
  FREE_ALLOWANCE_BYTES,
  GB_PER_BLOCK,
  isBillingEnabled,
  recommendedBlockPriceCents,
} from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import {
  ensureBillingSchema,
  getSubscription,
  paidBytesForOwner,
} from "@/lib/billing/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isBillingEnabled()) return json(200, { enabled: false });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  try {
    await ensureBillingSchema();
    const [sub, paidBytes] = await Promise.all([
      getSubscription(ownerKey),
      paidBytesForOwner(ownerKey),
    ]);
    return json(200, {
      enabled: true,
      active: sub?.status === "active",
      blocks: sub?.blocks ?? 0,
      paidBytes,
      freeBytes: FREE_ALLOWANCE_BYTES,
      gbPerBlock: GB_PER_BLOCK,
      blockPriceCents: recommendedBlockPriceCents(),
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
