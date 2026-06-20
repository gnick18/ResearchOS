// Lab subdomain TLS provisioning reconcile cron (lab-domains, social lane).
//
// GET /api/cron/lab-domain-provision
//
// Invoked by Vercel Cron once a day (see frontend/vercel.json). It ensures every
// claimed lab slug has its `<slug>.research-os.com` subdomain registered on the
// Vercel project so Vercel issues the per-subdomain TLS cert. This is BOTH the
// one-time backfill for labs that predate claim-time provisioning AND the ongoing
// self-heal for any claim whose live provision call failed. Idempotent and
// resilient (one failing host never aborts the pass), so a daily cadence is safe.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". The route requires
// that secret and fails closed with a 404 if CRON_SECRET is unset or mismatched, so
// the endpoint is never an open trigger and its existence is not advertised. Mirrors
// the lab-site-asset-gc / cost-breaker / business-reminders crons.
//
// Inert paths: a 200 no-op when lab sites are disabled, and a 200 no-op when no
// VERCEL_API_TOKEN is set (provisioning skips per host). Default => byte-identical.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabSitesEnabled } from "@/lib/social/config";
import {
  isLabDomainProvisioningEnabled,
  reconcileLabDomains,
} from "@/lib/social/lab-domain-provision";
import { listAllSiteSlugs } from "@/lib/social/lab-site-db";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    // Fail closed. No secret configured, or a mismatched one, is a 404 so the
    // endpoint's existence is not advertised.
    return new Response("not found", { status: 404 });
  }

  if (!isLabSitesEnabled()) {
    return Response.json({ ok: true, skipped: "lab sites disabled" });
  }
  if (!isLabDomainProvisioningEnabled()) {
    return Response.json({ ok: true, skipped: "no vercel token" });
  }

  try {
    const slugs = await listAllSiteSlugs();
    const report = await reconcileLabDomains(slugs);
    return Response.json({ ok: true, ...report });
  } catch {
    return Response.json(
      { ok: false, error: "reconcile failed" },
      { status: 500 },
    );
  }
}
