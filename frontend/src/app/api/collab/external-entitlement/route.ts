// External live-collab HOST entitlement (Grant 2026-06-18).
//
// GET /api/collab/external-entitlement
// Returns { entitled } for the signed-in account: whether they may HOST/INITIATE
// external LIVE collaboration. Reuses isProduceEntitled, the Model-A paid-produce
// signal (Solo and up), which resolves a free member of a paid lab to their
// sponsoring PI, so a paid-lab member reads as entitled. A free account is never
// entitled; it keeps the one-time E2E copy send (which is NOT gated here) plus the
// ability to RECEIVE a live invite (also not gated).
//
// Unlike the relay produce paywall in /api/relay/send, this is NOT conditioned on
// isBillingEnabled. Grant's rule is that a free account can never host external
// live collab, so the gate stands on its own. It only matters once the feature
// flips on, because the whole surface stays dark behind EXTERNAL_COLLAB_ENABLED. A
// signed-out caller, or any error, reads as not entitled (fail closed).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { isProduceEntitled } from "@/lib/billing/model-a/resolve";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(200, { entitled: false });

  try {
    const entitled = await isProduceEntitled(ownerKeyForEmail(email));
    return json(200, { entitled });
  } catch {
    return json(200, { entitled: false });
  }
}
