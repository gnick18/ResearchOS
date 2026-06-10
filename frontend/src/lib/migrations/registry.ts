// The ordered migration registry. Each entry wraps an existing, idempotent
// repair function (the ones that were manual "Run repair" buttons) and maps its
// report onto the uniform MigrationReport. Order matters where one depends on
// another; add new migrations at the END with a fresh `-vN` id.

import { tasksApi, methodsApi } from "@/lib/local-api";
import { repairStampFormats } from "@/lib/tasks/migrate-stamps";
import { splitAllTaskAttachments } from "@/lib/tasks/migrate-attachments";
import { repairAllPCRProtocols } from "@/lib/repair/pcr-protocols";
import { repairAllLCGradientProtocols } from "@/lib/repair/lc-gradients";
import { repairAllQPCRAnalysisProtocols } from "@/lib/repair/qpcr-analyses";
import { repairAllPlateProtocols } from "@/lib/repair/plate-layouts";
import { repairAllCellCultureSchedules } from "@/lib/repair/cell-culture-schedules";
import { repairAllCodingWorkflows } from "@/lib/repair/coding-workflows";
import { repairAllMassSpecProtocols } from "@/lib/repair/mass-spec";
import {
  cleanupOrphanLabArchives,
  LABARCHIVES_CLEANUP_ID,
} from "./cleanup-labarchives";
import {
  cleanupOrphanAuthJson,
  AUTH_JSON_CLEANUP_ID,
} from "./cleanup-auth-json";
import {
  reconcileHostedDriftOwnerOnly,
  RECONCILE_HOSTED_ID,
} from "./reconcile-hosted";
import { runFundingRework, FUNDING_REWORK_ID } from "./funding-rework";
import {
  backfillResultsHeaders,
  RESULTS_HEADER_BACKFILL_ID,
} from "./results-header-backfill";
import type { Migration, MigrationReport } from "./types";

/** The lib/repair/* functions share a `{ total, repaired, unrecoverable }`
 *  report; map it onto the uniform MigrationReport. */
function fromRepairReport(r: {
  total: number;
  repaired: number;
  unrecoverable: number;
}): MigrationReport {
  return { changed: r.repaired, scanned: r.total, failed: r.unrecoverable };
}

export const MIGRATIONS: Migration[] = [
  {
    id: "method-source-paths-v1",
    title: "Method source paths",
    run: async () => {
      const r = await methodsApi.repairSourcePaths();
      return { changed: r.repaired, scanned: r.scanned, failed: r.failed };
    },
  },
  {
    id: "method-links-v1",
    title: "Method links",
    run: async () => {
      const r = await tasksApi.repairMethodLinks();
      return { changed: r.repaired, scanned: r.scanned, failed: r.failed };
    },
  },
  {
    id: "stamp-formats-v1",
    title: "Stamp formats",
    run: async () => {
      const r = await repairStampFormats();
      return { changed: r.repaired, scanned: r.scanned, failed: 0 };
    },
  },
  {
    // Splits the shared results/task-N/{Files,Images} into per-tab folders and
    // folds any older Attachments/ migration first (handled inside the fn).
    id: "attachment-split-v1",
    title: "Split Lab Notes / Results attachments",
    run: async () => {
      const r = await splitAllTaskAttachments();
      return { changed: r.repaired, scanned: r.scanned, failed: r.failed };
    },
  },
  {
    id: "pcr-protocols-v1",
    title: "PCR protocols",
    run: async () => fromRepairReport(await repairAllPCRProtocols()),
  },
  {
    id: "lc-gradients-v1",
    title: "LC gradients",
    run: async () => fromRepairReport(await repairAllLCGradientProtocols()),
  },
  {
    id: "qpcr-analyses-v1",
    title: "qPCR analyses",
    run: async () => fromRepairReport(await repairAllQPCRAnalysisProtocols()),
  },
  {
    id: "plate-layouts-v1",
    title: "Plate layouts",
    run: async () => fromRepairReport(await repairAllPlateProtocols()),
  },
  {
    id: "cell-culture-schedules-v1",
    title: "Cell culture schedules",
    run: async () => fromRepairReport(await repairAllCellCultureSchedules()),
  },
  {
    id: "coding-workflows-v1",
    title: "Coding workflows",
    run: async () => fromRepairReport(await repairAllCodingWorkflows()),
  },
  {
    id: "mass-spec-v1",
    title: "Mass spec methods",
    run: async () => fromRepairReport(await repairAllMassSpecProtocols()),
  },
  // Destructive-but-recoverable (trash-not-delete). These remove dead/legacy
  // files, so they run last, after the in-place format fixes.
  {
    id: LABARCHIVES_CLEANUP_ID,
    title: "Remove orphaned LabArchives credentials",
    destructive: true,
    run: cleanupOrphanLabArchives,
  },
  {
    id: AUTH_JSON_CLEANUP_ID,
    title: "Remove orphaned _auth.json files",
    destructive: true,
    run: cleanupOrphanAuthJson,
  },
  {
    // Owner-only: scoped so every manifest write lands in the current user's own
    // hosted manifest (no cross-owner write, no shared-manifest race).
    id: RECONCILE_HOSTED_ID,
    title: "Reconcile cross-owner project sharing",
    run: reconcileHostedDriftOwnerOnly,
  },
  {
    // Funding-rework (2026-06-08): backfill PurchaseItem.funding_account_id from
    // the legacy funding_string label, and strip the dead spent / remaining
    // counters from funding-account files. Idempotent format upgrade.
    id: FUNDING_REWORK_ID,
    title: "Funding account links + live spend",
    run: runFundingRework,
  },
  {
    // Backfill the "# Results: <name>" header on experiments created before
    // results.md was scaffolded at creation, so Results opens with its title
    // like Lab Notes does. Additive, own experiments only, idempotent.
    id: RESULTS_HEADER_BACKFILL_ID,
    title: "Results headers",
    run: backfillResultsHeaders,
  },
];
