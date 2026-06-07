// Metered-storage billing, set the caller's storage cap.
//
// POST /api/billing/cap   body { capGb: number }
//
// The cap is the owner's storage ceiling, at once the enforcement wall and their
// monthly spend ceiling. Lowering it to the free tier (1 GB) is how a user stops
// paying. Raising it above the free tier requires an active subscription (a
// payment method on file), otherwise there is nothing to bill against.
//
// Dark unless BILLING_ENABLED is on. The WI DOR sales-tax gate is enforced at
// checkout (where the card is added), not here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import {
  CAP_OPTIONS_GB,
  FREE_ALLOWANCE_BYTES,
  gbToBytes,
  isBillingEnabled,
} from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, getSubscription, setCapBytes } from "@/lib/billing/db";

export const runtime = "nodejs";

const FREE_GB = FREE_ALLOWANCE_BYTES / 1024 ** 3;
const ALLOWED_GB = new Set<number>([FREE_GB, ...CAP_OPTIONS_GB]);

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { capGb?: unknown };
  try {
    body = (await request.json()) as { capGb?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }

  const capGb = Number(body.capGb);
  if (!Number.isFinite(capGb) || !ALLOWED_GB.has(capGb)) {
    return json(400, { error: "invalid cap" });
  }

  const ownerKey = ownerKeyForEmail(email);
  try {
    await ensureBillingSchema();

    // Raising above the free tier needs an active subscription to bill against.
    if (capGb > FREE_GB) {
      const sub = await getSubscription(ownerKey);
      if (sub?.status !== "active") {
        return json(409, {
          error: "Add a payment method first to raise your storage limit.",
          needsCheckout: true,
        });
      }
    }

    await setCapBytes(ownerKey, gbToBytes(capGb));
    return json(200, { ok: true, capGb });
  } catch {
    return json(500, { error: "cap update failed" });
  }
}
