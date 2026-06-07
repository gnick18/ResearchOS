// Monthly usage-report cron for metered billing.
//
// GET /api/cron/billing-report
//
// Invoked by Vercel Cron once a month (see frontend/vercel.json). For every owner
// with an active metered subscription it averages the daily usage samples over
// the trailing ~month, subtracts the free tier, applies the minimum-charge
// waiver, and reports the billable GB-month to the Stripe storage meter as one
// event. Stripe aggregates the events into the customer's monthly invoice; the
// invoice.paid webhook then records the money in the LLC ledger. Old samples are
// pruned once read.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}"; the route
// requires it and fails closed (404). Dark unless BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  isBillingEnabled,
  labReportableGb,
  reportableGb,
} from "@/lib/billing/config";
import {
  aggregateAverageUsedBytes,
  averageUsedBytes,
  ensureBillingSchema,
  listActiveOwners,
  pruneUsageSamples,
} from "@/lib/billing/db";
import {
  countSponsoredOwners,
  ensureLabSchema,
  listActiveMemberKeys,
} from "@/lib/billing/lab";
import { getMeterEventName, reportStorageUsage } from "@/lib/billing/stripe";

export const runtime = "nodejs";

/** YYYY-MM-DD `days` ago, the start of the averaging window. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  if (!isBillingEnabled()) {
    return Response.json({ ok: true, skipped: "billing disabled" });
  }
  // Confirm the meter is configured before reporting anything.
  try {
    getMeterEventName();
  } catch {
    return Response.json({ ok: false, skipped: "STRIPE_METER_EVENT_NAME unset" });
  }

  await ensureBillingSchema();
  await ensureLabSchema();
  const since = isoDaysAgo(31);
  const owners = await listActiveOwners();

  let reported = 0;
  let billed = 0;
  for (const owner of owners) {
    if (!owner.stripeCustomerId) continue;
    try {
      let gb: number;
      if (owner.labBilling) {
        // A sponsoring PI is billed on the lab AGGREGATE above the pooled free
        // tier (1 GB per sponsored owner). Sponsored members are not in this
        // loop, their own subscriptions were ended when the lab took over.
        const memberKeys = await listActiveMemberKeys(owner.ownerKey);
        const labKeys = [owner.ownerKey, ...memberKeys];
        const sponsoredOwners = await countSponsoredOwners(owner.ownerKey);
        const aggAvg = await aggregateAverageUsedBytes(labKeys, since);
        gb = labReportableGb(aggAvg, sponsoredOwners);
      } else {
        const avg = await averageUsedBytes(owner.ownerKey, since);
        gb = reportableGb(avg);
      }
      // Skip the Stripe call when waived (0). No event this period = $0 line.
      if (gb > 0) {
        await reportStorageUsage(owner.stripeCustomerId, gb);
        billed += 1;
      }
      reported += 1;
    } catch {
      // One owner failing must not stop the rest.
    }
  }

  // Samples older than this window are billed; drop them.
  try {
    await pruneUsageSamples(since);
  } catch {
    // ignore, pruning is housekeeping
  }

  return Response.json({ ok: true, owners: owners.length, reported, billed });
}
