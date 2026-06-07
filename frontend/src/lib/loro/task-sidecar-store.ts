/**
 * task-sidecar-store.ts
 *
 * Disk persistence for a task's markdown-surface Loro docs (Lab Notes /
 * Results), the experiment-collab analogue of sidecar-store.ts for notes.
 *
 * Layout: the markdown surface keeps its existing readable mirror at
 * `${taskResultsBase}/<which>.md` (the file the rest of the task system,
 * attachments, migrations, legacy reads, already uses). The authoritative
 * CRDT lives beside it in a hidden dir at
 * `${taskResultsBase}/.researchos/<which>.loro`.
 *
 * persist writes the `.loro` sidecar FIRST then the `.md` mirror (same ordering
 * as persistNote: a crash mid-write leaves the authoritative CRDT on disk, and
 * the mirror is always re-derivable). loadOrRebuild tries the sidecar, then
 * falls back to seeding deterministically from the `.md` mirror.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc } from "loro-crdt";
import { fileService } from "../file-system/file-service";
import { taskResultsBase } from "../tasks/results-paths";
import { seedTaskDoc, getTaskContentText } from "./task-doc";

export type TaskMarkdownSurface = "notes" | "results";

/** Minimal task identity needed to resolve the on-disk paths. */
export interface TaskRef {
  id: number;
  owner: string;
}

function sidecarDir(task: TaskRef): string {
  return `${taskResultsBase(task)}/.researchos`;
}
function taskSidecarPath(task: TaskRef, which: TaskMarkdownSurface): string {
  return `${sidecarDir(task)}/${which}.loro`;
}
/** The existing readable markdown mirror (notes.md / results.md). */
function taskMdPath(task: TaskRef, which: TaskMarkdownSurface): string {
  return `${taskResultsBase(task)}/${which}.md`;
}

/** Load a LoroDoc from the sidecar, or null if absent. Throws on corrupt bytes. */
async function loadSidecar(
  task: TaskRef,
  which: TaskMarkdownSurface,
): Promise<LoroDoc | null> {
  const blob = await fileService.readFileAsBlob(taskSidecarPath(task, which));
  if (blob === null) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = new LoroDoc();
  // Throws on corrupt/invalid snapshot; loadOrRebuild catches it.
  doc.import(bytes);
  return doc;
}

/** Read the readable markdown mirror (empty string when the file is absent). */
async function readMdMirror(
  task: TaskRef,
  which: TaskMarkdownSurface,
): Promise<string> {
  const blob = await fileService.readFileAsBlob(taskMdPath(task, which));
  return blob ? await blob.text() : "";
}

/**
 * Load or rebuild the Loro doc for a task markdown surface.
 *
 * Tries the `.loro` sidecar first; if it is missing OR corrupt, seeds a fresh
 * doc deterministically from the `.md` mirror (so two devices rebuilding from
 * the same markdown converge rather than fork). Never surfaces an error.
 */
export async function loadOrRebuildTaskDoc(
  task: TaskRef,
  which: TaskMarkdownSurface,
): Promise<LoroDoc> {
  try {
    const doc = await loadSidecar(task, which);
    if (doc !== null) return doc;
  } catch {
    // Corrupt sidecar: fall through to rebuild from the mirror.
  }
  const md = await readMdMirror(task, which);
  const doc = new LoroDoc();
  doc.import(seedTaskDoc(md));
  return doc;
}

/** Concurrent-writer FS errors to swallow (same as persistNote). */
function isConcurrentWriteError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "NoModificationAllowedError";
}

/**
 * Persist the Loro doc: write the `.loro` sidecar, then sync the `.md` mirror
 * so the rest of the task system sees the latest content. Swallows the
 * concurrent-writer race (the sidecar is authoritative and re-persists next
 * commit); rethrows anything else.
 */
export async function persistTaskDoc(
  task: TaskRef,
  which: TaskMarkdownSurface,
  doc: LoroDoc,
): Promise<void> {
  try {
    await fileService.ensureDir(sidecarDir(task));
    const bytes = doc.export({ mode: "snapshot" });
    await fileService.writeFileFromBlob(
      taskSidecarPath(task, which),
      new Blob([bytes.buffer as ArrayBuffer]),
    );
    await fileService.writeFileFromBlob(
      taskMdPath(task, which),
      new Blob([getTaskContentText(doc)]),
    );
  } catch (err) {
    if (isConcurrentWriteError(err)) {
      console.warn(
        "[loro] task doc persist raced another writer; re-persists on the next commit",
        err,
      );
      return;
    }
    throw err;
  }
}
