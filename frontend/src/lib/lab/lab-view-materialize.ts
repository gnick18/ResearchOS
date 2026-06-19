// Multi-lab P2: materialize the relay-assembled member lab view into the active
// member (OPFS) folder.
//
// WHY THIS EXISTS (residency, spec critic):
//   A joined member holds an app-managed OPFS folder, not the lab head's disk.
//   The existing folder-bound consumers (People, 1:1s, comments, colors, etc.)
//   read records from `users/<owner>/<entity>/<id>.json` in the open folder.
//   pullLabView reconstructs the member's view from the server-blind R2 mirror
//   (own + shared-with-me). materializeLabView writes the SHARED-WITH-ME records
//   into the active OPFS folder under their ORIGINAL owner's path, so the
//   folder-bound consumers light up WITHOUT re-pointing each one (that is P3).
//
// RESIDENCY RULE (CRITICAL):
//   Own records STAY in the member's local folder (source of truth). We do NOT
//   write own records back from R2; doing so would demote the local folder from
//   source-of-truth and create a window where the member's own work is stale or
//   empty until a push+pull round-trip completes. materializeLabView therefore
//   SKIPS every record where isOwn is true. The member view the consumers read
//   is the UNION of own(local folder) and shared-with-me(materialized here).
//
// CRYPTO:
//   The plaintext handed here is already decrypted (pullLabView decrypted it
//   under the in-memory lab key). Nothing in this module touches R2 or the lab
//   key; it only writes already-decrypted bytes to the local OPFS folder.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "../file-system/file-service";
import type { LabViewRecord } from "./lab-read";

// ---------------------------------------------------------------------------
// recordType -> on-disk entity directory.
// ---------------------------------------------------------------------------

/**
 * Maps the R2 record-type segment (the LAB_WORK_TYPES name in the object key)
 * to the on-disk per-user entity directory the folder-bound consumers read from
 * (`users/<owner>/<dir>/<id>.json`).
 *
 * Notes:
 *   - "task" and "experiment" both live in the "tasks" directory (experiments
 *     are tasks with task_type === "experiment"); the splitting is a read-time
 *     concern, so both map to "tasks".
 *   - result_sheet / notes_sheet are NOT plain JSON records; they are the
 *     markdown mirrors under `users/<owner>/results/task-<id>/{results,notes}.md`
 *     and are handled separately (see materializeLabView).
 *   - datahub is a sidecar document under `users/<owner>/datahub/<id>.json`.
 *   - announcement is NOT a per-user record. It is aggregated into the lab-ROOT
 *     `_announcements.json` file (sibling to users/) and is handled separately
 *     (see materializeLabView); it is intentionally ABSENT from this map.
 */
const RECORD_TYPE_TO_DIR: Record<string, string> = {
  task: "tasks",
  experiment: "tasks",
  note: "notes",
  method: "methods",
  purchase: "purchase_items",
  inventory: "inventory_items",
  inventory_stock: "inventory_stocks",
  sequence: "sequences",
  phylo: "phylo",
  molecule: "molecules",
  datahub: "datahub",
  deposit: "deposits",
  one_on_one: "one_on_ones",
  one_on_one_action_item: "one_on_one_action_items",
  idp: "idps",
  weekly_goal: "weekly_goals",
  checkin_compact: "checkin_compacts",
  checkin_onboarding: "checkin_onboarding",
  checkin_rotation: "checkin_rotations",
};

// ---------------------------------------------------------------------------
// MaterializeResult.
// ---------------------------------------------------------------------------

export interface MaterializeResult {
  /** On-disk relative paths written this run (shared-with-me records). */
  written: string[];
  /** Count of own records that were intentionally SKIPPED (residency rule). */
  skippedOwn: number;
  /** Record keys skipped for an unknown record type (no on-disk mapping). */
  skippedUnknownType: string[];
}

/**
 * Optional injectable file-writer seam so the runner is unit-testable without a
 * real OPFS handle. Defaults to the production fileService methods.
 */
export interface MaterializeFileWriter {
  ensureDir(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
}

const defaultWriter: MaterializeFileWriter = {
  // fileService.ensureDir returns the directory handle; the writer contract is
  // void, so discard it.
  ensureDir: async (path) => {
    await fileService.ensureDir(path);
  },
  writeText: (path, text) => fileService.writeText(path, text),
};

// ---------------------------------------------------------------------------
// materializeLabView.
// ---------------------------------------------------------------------------

/**
 * Writes the SHARED-WITH-ME records from a pulled lab view into the active
 * member (OPFS) folder so the folder-bound consumers read them.
 *
 * RESIDENCY: own records (isOwn === true) are SKIPPED. They live in the local
 * folder already and are the source of truth; reading them back from R2 would
 * demote that source-of-truth guarantee. Only records another member explicitly
 * shared with the viewer (isOwn === false, which pullLabView only ever returns
 * when shared_with names the viewer) are materialized.
 *
 * The plaintext is written verbatim under the original owner's path so the
 * cross-owner aggregation the consumers already perform (listAllForUser over the
 * relay roster owners) finds them exactly where it expects.
 *
 * @param records  the pulled lab view (own + shared-with-me).
 * @param writer   optional file-writer override (tests inject a fake).
 */
export async function materializeLabView(
  records: LabViewRecord[],
  writer: MaterializeFileWriter = defaultWriter,
): Promise<MaterializeResult> {
  const written: string[] = [];
  const skippedUnknownType: string[] = [];
  let skippedOwn = 0;

  const decoder = new TextDecoder();

  // ANNOUNCEMENTS are lab-wide-public and live in the root _announcements.json
  // (not a per-user dir). We collect the shared (non-own) announcement entries
  // here and write them as one merged root file after the per-record loop, since
  // a single file aggregates many announcement records.
  const announcementEntries: unknown[] = [];

  for (const rec of records) {
    // RESIDENCY: never write the viewer's own records back from R2.
    if (rec.isOwn) {
      skippedOwn += 1;
      continue;
    }

    const text = decoder.decode(rec.plaintext);

    // ANNOUNCEMENTS: collect now, write the merged root file after the loop.
    if (rec.recordType === "announcement") {
      try {
        announcementEntries.push(JSON.parse(text));
      } catch {
        // A malformed announcement payload is skipped rather than poisoning the
        // whole _announcements.json write. listAnnouncements() is itself
        // defensive against a malformed file, but a clean write is preferable.
      }
      continue;
    }

    // result_sheet / notes_sheet are markdown mirrors, not JSON records.
    if (rec.recordType === "result_sheet" || rec.recordType === "notes_sheet") {
      const which = rec.recordType === "result_sheet" ? "results" : "notes";
      const dir = `users/${rec.owner}/results/task-${rec.recordId}`;
      const path = `${dir}/${which}.md`;
      await writer.ensureDir(dir);
      await writer.writeText(path, text);
      written.push(path);
      continue;
    }

    const entityDir = RECORD_TYPE_TO_DIR[rec.recordType];
    if (!entityDir) {
      // Unknown record type: no on-disk mapping. Skip rather than guess a path.
      skippedUnknownType.push(rec.key);
      continue;
    }

    const dir = `users/${rec.owner}/${entityDir}`;
    const path = `${dir}/${rec.recordId}.json`;
    await writer.ensureDir(dir);
    await writer.writeText(path, text);
    written.push(path);
  }

  // ANNOUNCEMENTS: write the aggregated lab-wide-public entries to the root
  // _announcements.json. The member authors none of its own, so the pulled set
  // (all PI-authored, all-members-readable) IS the member's announcement view.
  // We only write when there is at least one entry so an empty pull does not
  // clobber a file the member may already hold (e.g. before the first pull).
  if (announcementEntries.length > 0) {
    const path = "_announcements.json";
    const fileBody = { version: 1 as const, announcements: announcementEntries };
    await writer.writeText(path, JSON.stringify(fileBody));
    written.push(path);
  }

  return { written, skippedOwn, skippedUnknownType };
}

/** Exposed for unit tests: the recordType -> directory mapping. */
export const _RECORD_TYPE_TO_DIR_FOR_TEST = RECORD_TYPE_TO_DIR;
