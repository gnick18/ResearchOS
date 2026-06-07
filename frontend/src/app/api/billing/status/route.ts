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
import { getOwnerUsage, getOwnerQuotaBytes } from "@/lib/collab/server/db";

export const runtime = "nodejs";

/** Best-effort current server usage for this owner; 0 if collab is not set up. */
async function ownerUsedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

export async function GET(): Promise<Response> {
  const billingOn = isBillingEnabled();

  const session = await auth();
  const email = session?.user?.email;
  // Not signed in (also the local-only / sharing-off case): nothing to show.
  if (!email) return json(200, { enabled: billingOn, signedIn: false });

  const ownerKey = ownerKeyForEmail(email);
  try {
    const usedBytes = await ownerUsedBytes(ownerKey);

    // Billing off (pre-launch default): still show usage, but against the real
    // enforced ceiling (the MAX_OWNER_BYTES fairness wall getOwnerQuotaBytes
    // returns when billing is off), not the 1 GB free allowance that only
    // applies once billing is live. No buy button.
    if (!billingOn) {
      const quotaBytes = await getOwnerQuotaBytes(ownerKey).catch(
        () => FREE_ALLOWANCE_BYTES,
      );
      return json(200, {
        enabled: false,
        signedIn: true,
        active: false,
        blocks: 0,
        paidBytes: 0,
        freeBytes: quotaBytes,
        quotaBytes,
        usedBytes,
      });
    }

    await ensureBillingSchema();
    const [sub, paidBytes] = await Promise.all([
      getSubscription(ownerKey),
      paidBytesForOwner(ownerKey),
    ]);
    const active = sub?.status === "active";
    const effectivePaid = active ? paidBytes : 0;
    return json(200, {
      enabled: true,
      signedIn: true,
      active,
      blocks: sub?.blocks ?? 0,
      paidBytes: effectivePaid,
      freeBytes: FREE_ALLOWANCE_BYTES,
      quotaBytes: FREE_ALLOWANCE_BYTES + effectivePaid,
      usedBytes,
      gbPerBlock: GB_PER_BLOCK,
      blockPriceCents: recommendedBlockPriceCents(),
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
