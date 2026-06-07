// Daily storage-usage sampler for metered billing.
//
// GET /api/cron/billing-usage-sample
//
// Invoked by Vercel Cron once a day (see frontend/vercel.json). For every owner
// with an active metered subscription it records today's used-bytes snapshot, so
// the monthly report can bill the AVERAGE GB-month rather than a single reading.
// One sample per owner per day (upsert), so re-running the cron is harmless.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}"; the route
// requires it and fails closed (404) if CRON_SECRET is unset or wrong. Also dark
// unless BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isBillingEnabled } from "@/lib/billing/config";
import {
  ensureBillingSchema,
  listActiveOwners,
  recordUsageSample,
} from "@/lib/billing/db";
import { getOwnerUsage } from "@/lib/collab/server/db";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  if (!isBillingEnabled()) {
    return Response.json({ ok: true, skipped: "billing disabled" });
  }

  await ensureBillingSchema();
  const owners = await listActiveOwners();

  let sampled = 0;
  for (const owner of owners) {
    try {
      // ownerKey is the same peppered hash collab keys its docs by, so usage is
      // read straight through with no re-derivation.
      const usedBytes = await getOwnerUsage(owner.ownerKey).catch(() => 0);
      await recordUsageSample(owner.ownerKey, usedBytes);
      sampled += 1;
    } catch {
      // One owner failing must not stop the rest.
    }
  }

  return Response.json({ ok: true, owners: owners.length, sampled });
}
