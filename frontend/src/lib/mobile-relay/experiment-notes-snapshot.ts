// Phone-notes P1 (read), the laptop publisher half (phone-notes bot, 2026-06-15).
//
// The mirror image of method-snapshot.ts, but for an experiment's Lab Notes and
// Results markdown instead of its method recipe. Builds a sealed READ-ONLY
// projection of a focused experiment's notes.md + results.md and seals a copy
// for each paired phone using the same pattern as the other snapshot builders.
//
// The phone renders this on the experiment hub (see mobile components/
// MarkdownLite.tsx) so a researcher can READ their existing lab notes + results
// at the bench. It is one-way read in P1; the place + push edit flow (P2) lands
// new note blocks back via the insert-note-block command, NOT by editing this
// projection. This snapshot is therefore a read projection only.
//
// Snapshot name on the relay: "experiment-notes"
//
// The decrypted shape the phone reads after openSealed is ExperimentNotesSnapshot
// (kept byte-compatible with mobile/lib/snapshots.ts). It carries the focused
// experiment id/owner/name plus the notes + results markdown (each null when the
// file does not exist yet, so the phone shows an empty-state, not a crash).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, filesApi } from "@/lib/local-api";
import { findExistingTaskResultsBase } from "@/lib/tasks/results-paths";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import type { Task } from "@/lib/types";

// ── Projection type (the decrypted shape the phone parses) ───────────────────
//
// Every field past taskId/owner is OPTIONAL so an older laptop shape never
// crashes the viewer, and so the absence of a section reads as "no notes yet".
// MUST stay byte-compatible with mobile/lib/snapshots.ts ExperimentNotesSnapshot.

/** A markdown document section (lab notes or results), as the phone reads it. */
export interface ExperimentNotesDoc {
  markdown: string;
}

/** The full snapshot the phone decrypts under the "experiment-notes" name. */
export interface ExperimentNotesSnapshot {
  taskId: number;
  owner: string;
  /** The focused experiment name, so the phone can label the screen. */
  experimentName?: string | null;
  /** notes.md content, or null when the experiment has no lab notes yet. */
  notes?: ExperimentNotesDoc | null;
  /** results.md content, or null when the experiment has no results yet. */
  results?: ExperimentNotesDoc | null;
  generatedAt?: string;
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

/** Read one markdown file best-effort, returning null on any miss / failure. */
async function readMarkdownDoc(path: string): Promise<ExperimentNotesDoc | null> {
  try {
    const file = await filesApi.readFile(path);
    // An existing-but-empty file is still "no notes" for the phone's purposes.
    if (!file.content || file.content.trim().length === 0) return null;
    return { markdown: file.content };
  } catch {
    return null;
  }
}

/**
 * Build the experiment-notes snapshot for one focused experiment. Resolves the
 * task's results directory (per-user path, falling back to legacy via
 * findExistingTaskResultsBase so pre-namespacing data still surfaces) and reads
 * notes.md + results.md. Returns null when the task cannot be read (so the
 * publisher skips a stale focus rather than publishing an empty shell); a task
 * that simply has no notes yet still returns a snapshot with notes/results null.
 *
 * `taskOwner` routes the read to the right per-user namespace (the focused
 * experiment may be a task shared with the current user, owned by someone else).
 */
export async function buildExperimentNotesSnapshot(
  taskId: number,
  taskOwner: string,
): Promise<ExperimentNotesSnapshot | null> {
  const task: Task | null = await tasksApi.get(taskId, taskOwner).catch(() => null);
  if (!task) return null;

  const base = await findExistingTaskResultsBase({ id: task.id, owner: task.owner });

  let notes: ExperimentNotesDoc | null = null;
  let results: ExperimentNotesDoc | null = null;
  if (base) {
    notes = await readMarkdownDoc(`${base}/notes.md`);
    results = await readMarkdownDoc(`${base}/results.md`);
  }

  return {
    generatedAt: new Date().toISOString(),
    taskId: task.id,
    owner: task.owner,
    experimentName: task.name,
    notes,
    results,
  };
}

/**
 * A stable content hash over a snapshot's markdown bodies (NOT generatedAt,
 * which changes every build). The caller (TodaySnapshotPublisher) compares this
 * against the last published hash so an unchanged experiment is a cheap no-op
 * (the build reads two small files; the seal + per-device upload is skipped).
 * Includes taskId + owner so switching the focused experiment always republishes.
 */
export function experimentNotesVersion(snap: ExperimentNotesSnapshot): string {
  const canonical = JSON.stringify({
    taskId: snap.taskId,
    owner: snap.owner,
    notes: snap.notes?.markdown ?? null,
    results: snap.results?.markdown ?? null,
  });
  // djb2: synchronous + good enough for a change-detection gate (not a security
  // hash). Avoids pulling crypto.subtle into the hot publish loop.
  let h = 5381;
  for (let i = 0; i < canonical.length; i += 1) {
    h = ((h << 5) + h + canonical.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

// ── Publisher ────────────────────────────────────────────────────────────────

/**
 * Seal + publish a PREBUILT experiment-notes snapshot to each paired phone.
 * Split from publishExperimentNotesToAllDevices (mirroring library-snapshot) so
 * TodaySnapshotPublisher can build once, compare experimentNotesVersion against
 * the last published hash, and skip the seal + upload when nothing changed.
 */
export async function publishExperimentNotesSnapshot(
  keys: UserCaptureKeys,
  snap: ExperimentNotesSnapshot,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[experiment-notes-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "experiment-notes", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}

/**
 * Build the experiment-notes snapshot for the focused experiment and seal a copy
 * to each paired phone. The convenience path (manual / one-shot) that builds and
 * publishes in one call; the periodic publisher uses the build + version-gate +
 * publishExperimentNotesSnapshot split instead. Returns published: 0 when the
 * task could not be read.
 */
export async function publishExperimentNotesToAllDevices(
  keys: UserCaptureKeys,
  taskId: number,
  taskOwner: string,
): Promise<{ published: number; skipped: number }> {
  const snap = await buildExperimentNotesSnapshot(taskId, taskOwner);
  if (!snap) return { published: 0, skipped: 0 };
  return publishExperimentNotesSnapshot(keys, snap);
}
