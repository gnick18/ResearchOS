// Lab companion-site hosted-asset GC cron (lab-domains Phase 4b, social lane).
//
// GET /api/cron/lab-site-asset-gc
//
// Invoked by Vercel Cron once a day (see frontend/vercel.json). It reclaims the
// hosted R2 data assets of any lab whose subscription lapsed more than 30 days
// ago (GRACE_DAYS), skipping any asset the lab prepaid to permanently archive.
// Published PAGES are never touched, only the live DATA assets. The run is
// idempotent and resilient (one failing asset never aborts the pass), so a daily
// cadence is safe.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". The route
// requires that secret and fails closed with a 404 if CRON_SECRET is unset or
// mismatched, so the endpoint is never an open trigger and its existence is not
// advertised. This mirrors the existing cost-breaker / business-reminders crons.
//
// Flag: dark unless LAB_SITES_ENABLED is on (the SERVER gate, read lazily), so
// with the flag off the route no-ops (after auth) exactly like the rest of the
// lab-sites lane. Default OFF => byte-identical app.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabSitesEnabled } from "@/lib/social/config";
import { runHostedAssetGc } from "@/lib/social/lab-site-asset-gc";

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
    // Flag off: inert. Auth already passed, so this is a benign no-op for the
    // scheduler, not a 404 (the route exists, the feature is simply dark).
    return Response.json({ ok: true, skipped: "lab sites disabled" });
  }

  try {
    const report = await runHostedAssetGc();
    return Response.json({ ok: true, ...report });
  } catch {
    return Response.json({ ok: false, error: "gc failed" }, { status: 500 });
  }
}
