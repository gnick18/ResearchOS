"use client";

// Badge metrics loader (badges phase 2, owner-side foundation).
//
// The thin I/O layer over the pure leaf (metrics-pure.ts). Reads the connected
// folder to assemble the raw counts, then hands them to the validated builder.
// Resilient and non-throwing, so a badge surface degrades to a safe empty
// snapshot rather than hard-failing on a read hiccup.
//
// HONEST GAPS (phase 2 follow-ups, NOT faked). Three criteria need a source the
// owner's folder does not cleanly carry yet, so the loader leaves them false and
// names the wire-point rather than shipping a guessed value (the "never ship a
// number we have not validated" rule):
//   - isFounding: needs the per-lab founding-cohort record (billing go-live FLAG
//     in lib/billing/model-a/pricing.ts). Wire when that record lands.
//   - hasExternalShare: "external" means outside the lab roster, so it needs the
//     roster (getLabRemote members) to tell an external share from intra-lab
//     sharing. Wire alongside the roster read.
//   - hasCompanionSite: lives in the Neon lab_sites DB (listPublishedPages),
//     server-side only. Wire when the badge snapshot publish path lands.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { labApi } from "@/lib/local-api";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import type { BadgeMetrics } from "./earn";
import {
  computeBadgeMetricsFromCounts,
  earliestCreatedAt,
  tenureDaysSince,
} from "./metrics-pure";

export {
  computeBadgeMetricsFromCounts,
  earliestCreatedAt,
  tenureDaysSince,
} from "./metrics-pure";
export type { BadgeMetricCounts } from "./metrics-pure";

/**
 * Load real badge metrics for the currently connected folder. Reads the two
 * folder-derived metrics we can compute correctly today (experiment count, lab
 * tenure); the cloud/roster-derived flags stay false per HONEST GAPS above.
 */
export async function loadBadgeMetrics(): Promise<BadgeMetrics> {
  let experiments = 0;
  let tenureDays = 0;

  try {
    const exps = await labApi.getExperiments();
    experiments = exps.length;
  } catch {
    // Folder not connected / read hiccup: leave at 0.
  }

  try {
    const metadata = await readAllUserMetadata();
    const iso = earliestCreatedAt(metadata);
    tenureDays = tenureDaysSince(iso, Date.now());
  } catch {
    // No metadata yet: leave tenure at 0.
  }

  return computeBadgeMetricsFromCounts({ experiments, tenureDays });
}
