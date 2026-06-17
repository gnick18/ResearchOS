// Lab companion-site hosted-asset GC / reclaim lifecycle (lab-domains Phase 4b,
// social lane).
//
// POLICY. Phase 4a hosts a lab's companion-site datasets on Cloudflare R2, billed
// via Billing's metered line. When a lab's subscription LAPSES:
//   - its published PAGES stay live read-only FOREVER (we never take the site
//     down; the public reader keeps seeing the baked Phase 3b snapshots), but
//   - its hosted DATA ASSETS on R2 are RECLAIMED 30 days after the lapse,
//   - UNLESS the lab pre-paid to permanently archive that specific dataset (the
//     Billing row is then flagged archived and the GC skips it).
//
// This module is split into a PURE core (the grace-period decision, IO-free and
// unit-testable) and a server RUNNER (the enumeration + per-asset reclaim, which
// touches the social DB, the social R2 client, and Billing read-only primitives).
// The cron route in app/api/cron/lab-site-asset-gc drives the runner.
//
// BOUNDARY. This module uses @/lib/billing/db (getLabLapse) and
// @/lib/collab/server/db (isHostedAssetArchived, removeHostedAsset) READ-ONLY in
// the sense that it never modifies their schema or business logic; it only calls
// the published primitives. It deletes R2 bytes through the social lane's OWN
// asset store (lab-site-asset-store.deleteAsset). It does NOT query Billing's
// lab_hosted_assets table directly for enumeration; the set of live assets comes
// from the social lane's own page manifests. A lab is referenced ONLY by its
// lab_owner_key.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getLabLapse } from "@/lib/billing/db";
import {
  isHostedAssetArchived,
  removeHostedAsset,
} from "@/lib/collab/server/db";

import { deleteAsset } from "./lab-site-asset-store";
import { listAllSiteHostedManifests } from "./lab-site-db";
import { parseHostedManifest } from "./lab-site-hosted";

/**
 * The reclaim grace period, in days, after a lab's subscription lapses before its
 * hosted R2 data assets are eligible for GC. Published PAGES are never reclaimed;
 * only the live DATA assets are, and only after this window. Exported so the pure
 * check, the runner, the route docs, and the tests all agree on one number.
 */
export const GRACE_DAYS = 30;

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PURE grace-period decision. Given the current time, a lab's lapse timestamp,
 * and the grace window, is reclaim DUE?
 *
 *   - lapsedAt null  -> NOT due. The lab is active or never subscribed; nothing
 *                       to reclaim. (Callers pass through getLabLapse's null.)
 *   - now <= lapsedAt + graceDays -> NOT due. Still inside the grace window.
 *   - now  > lapsedAt + graceDays -> DUE. The window has elapsed.
 *
 * The boundary is strictly greater-than (now must be PAST the deadline), so an
 * asset is never reclaimed early. An unparseable lapsedAt is treated as NOT due
 * (fail safe, never reclaim on a garbage timestamp). Pure and IO-free.
 */
export function isReclaimDue(
  nowMs: number,
  lapsedAt: string | null,
  graceDays: number = GRACE_DAYS,
): boolean {
  if (!lapsedAt) return false;
  const lapsedMs = Date.parse(lapsedAt);
  if (!Number.isFinite(lapsedMs)) return false;
  const deadline = lapsedMs + graceDays * MS_PER_DAY;
  return nowMs > deadline;
}

/**
 * The distinct hosted asset ids a lab currently references across ALL pages of
 * its site. Derived purely from the social lane's own page manifests (parsed via
 * parseHostedManifest), so it never touches Billing's lab_hosted_assets table.
 *
 * NOTE on orphans: an asset registered in Billing but no longer referenced by any
 * current page manifest (a dropped embed) will NOT appear here, so the page-driven
 * GC will not reclaim it. Reconciling those orphans is a known follow-up.
 */
export function liveAssetIdsFromManifests(
  hostedJsonByPath: Array<{ path: string; hostedJson: string }>,
): string[] {
  const ids = new Set<string>();
  for (const { hostedJson } of hostedJsonByPath) {
    const manifest = parseHostedManifest(hostedJson);
    for (const entry of Object.values(manifest.assets)) {
      if (entry.assetId) ids.add(entry.assetId);
    }
  }
  return Array.from(ids);
}

/** Per-asset outcome of a GC pass, for the run report + tests. */
export type AssetReclaimOutcome =
  | "reclaimed" // R2 delete + Billing row removed
  | "archived" // skipped, prepaid permanent archive
  | "failed"; // an error during this asset's reclaim (run continues)

/** Aggregate report of one GC run. Counts are deterministic; the model never
 *  interprets them, the route just returns them. */
export interface GcRunReport {
  /** Labs enumerated (have a site). */
  labsScanned: number;
  /** Labs whose subscription is active / never subscribed (skipped wholesale). */
  labsActive: number;
  /** Labs lapsed but still inside the 30-day grace window (skipped). */
  labsInGrace: number;
  /** Labs past the grace window whose assets were processed. */
  labsReclaimed: number;
  /** Distinct assets deleted from R2 + de-registered in Billing. */
  assetsReclaimed: number;
  /** Assets skipped because they are prepaid-archived. */
  assetsArchived: number;
  /** Assets that errored during reclaim (the run did not abort). */
  assetsFailed: number;
}

/**
 * Reclaim ONE asset for a lapsed-past-grace lab. Idempotent and resilient:
 *   - if the asset is prepaid-archived -> SKIP (return "archived"), no delete.
 *   - else delete the R2 object (best effort) AND remove the Billing row.
 *   - any thrown error is caught and reported as "failed" so one bad asset never
 *     aborts the surrounding run.
 *
 * Deleting an already-gone R2 object is a no-op success on R2, and removing an
 * already-removed Billing row is a harmless no-op DELETE, so re-running the GC is
 * safe (idempotent).
 */
export async function reclaimAsset(assetId: string): Promise<AssetReclaimOutcome> {
  try {
    if (await isHostedAssetArchived(assetId)) return "archived";
    // R2 bytes first, then the billing row. If the R2 delete throws it is caught
    // below and reported as failed; the billing row is left for the next run to
    // retry (idempotent), so we never de-register an asset whose bytes we failed
    // to delete.
    await deleteAsset(assetId);
    await removeHostedAsset(assetId);
    return "reclaimed";
  } catch {
    return "failed";
  }
}

/**
 * The Phase 4b GC RUNNER. Enumerates every lab site, and for each lab past its
 * 30-day post-lapse grace window, reclaims every hosted asset its page manifests
 * reference (skipping prepaid-archived ones).
 *
 * Resilience: each lab's lapse lookup is wrapped so one lab's billing-read error
 * cannot abort the whole run, and each asset's reclaim is independently caught
 * (reclaimAsset never throws). The function returns a deterministic count report.
 *
 * `nowMs` is injectable for testing; it defaults to Date.now().
 */
export async function runHostedAssetGc(
  nowMs: number = Date.now(),
): Promise<GcRunReport> {
  const report: GcRunReport = {
    labsScanned: 0,
    labsActive: 0,
    labsInGrace: 0,
    labsReclaimed: 0,
    assetsReclaimed: 0,
    assetsArchived: 0,
    assetsFailed: 0,
  };

  const sites = await listAllSiteHostedManifests();
  for (const site of sites) {
    report.labsScanned += 1;

    let lapse: { lapsedAt: string } | null = null;
    try {
      lapse = await getLabLapse(site.labOwnerKey);
    } catch {
      // A billing-read error for one lab must not abort the run. Treat as "cannot
      // determine lapse" => skip this lab this pass (counted as active, i.e. not
      // reclaimed). The next run retries.
      report.labsActive += 1;
      continue;
    }

    if (!lapse) {
      // Active or never subscribed -> nothing to reclaim.
      report.labsActive += 1;
      continue;
    }
    if (!isReclaimDue(nowMs, lapse.lapsedAt)) {
      // Lapsed but inside the grace window -> keep.
      report.labsInGrace += 1;
      continue;
    }

    // Past grace: reclaim each referenced asset.
    report.labsReclaimed += 1;
    const assetIds = liveAssetIdsFromManifests(site.hostedJsonByPath);
    for (const assetId of assetIds) {
      const outcome = await reclaimAsset(assetId);
      if (outcome === "reclaimed") report.assetsReclaimed += 1;
      else if (outcome === "archived") report.assetsArchived += 1;
      else report.assetsFailed += 1;
    }
  }

  return report;
}
