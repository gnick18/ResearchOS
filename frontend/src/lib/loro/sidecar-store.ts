/**
 * Backend (b): the CRDT sidecar store.
 *
 * Reads and writes the binary Loro snapshot at the locked path
 * users/<owner>/.researchos/notes/<id>.loro.
 *
 * Callers: do not guard on LORO_PILOT_ENABLED here. The flag check is the
 * caller's job in chunk 5 (the store facade). These backends are pure I/O.
 */

import { LoroDoc } from "loro-crdt";
import { fileService } from "@/lib/file-system/file-service";
import { rebuildFromNote } from "./seed";
import { writeMirror } from "./mirror";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Canonical path for the binary sidecar of a note.
 * Locked by Phase 1 design doc section 9, decision 1.
 */
export function sidecarPath(owner: string, noteId: number): string {
  return `users/${owner}/.researchos/notes/${noteId}.loro`;
}

/** Parent directory that must exist before writing the sidecar. */
function sidecarDir(owner: string): string {
  return `users/${owner}/.researchos/notes`;
}

// ---------------------------------------------------------------------------
// Sidecar I/O
// ---------------------------------------------------------------------------

/**
 * Persist a LoroDoc snapshot to disk for a given note id.
 *
 * ensureDir is called first so the hidden .researchos/notes/ directory is
 * created on first write. Then the snapshot bytes are wrapped in a Blob and
 * written atomically via fileService.
 *
 * Ordering note: persistNote calls this BEFORE writeMirror so that a crash
 * mid-write always leaves the authoritative CRDT on disk; the mirror is a
 * derivable projection and can be rebuilt from the sidecar.
 */
export async function persistSidecar(
  owner: string,
  noteId: number,
  doc: LoroDoc,
): Promise<void> {
  await fileService.ensureDir(sidecarDir(owner));
  const bytes = doc.export({ mode: "snapshot" });
  // Cast through ArrayBuffer to satisfy the strict BlobPart constraint; the
  // underlying buffer is always a plain ArrayBuffer when produced by loro-crdt.
  await fileService.writeFileFromBlob(sidecarPath(owner, noteId), new Blob([bytes.buffer as ArrayBuffer]));
}

/**
 * Load a LoroDoc from a sidecar file.
 *
 * Returns null when the sidecar does not exist. Throws if the file exists but
 * cannot be imported (corrupt bytes), so loadOrRebuild can distinguish
 * "missing" from "corrupt" and handle both gracefully.
 */
export async function loadSidecar(
  owner: string,
  noteId: number,
): Promise<LoroDoc | null> {
  const blob = await fileService.readFileAsBlob(sidecarPath(owner, noteId));
  if (blob === null) return null;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = new LoroDoc();
  // doc.import throws on corrupt/invalid snapshot bytes; the caller catches it.
  doc.import(bytes);
  return doc;
}

// ---------------------------------------------------------------------------
// Open-time entry point
// ---------------------------------------------------------------------------

/**
 * Load or rebuild a LoroDoc for a note.
 *
 * This is the function chunk 5's openNote calls. It tries the sidecar first;
 * if the sidecar is missing or corrupt it falls back to rebuilding from the
 * readable mirror via rebuildFromNote (graceful degradation, design doc
 * section 9). No error is surfaced to the user in either fallback case.
 *
 * The rebuild is deterministic: two devices that both rebuild from the same
 * mirror JSON produce byte-identical docs, so they converge rather than fork
 * when they later connect to a relay (design doc section 9, the fork pitfall).
 *
 * On a successful rebuild the in-memory doc is returned WITHOUT auto-writing
 * the sidecar. Chunk 5's commit path owns all writes; we do not side-effect
 * here.
 */
export async function loadOrRebuild(
  owner: string,
  base: Note,
): Promise<LoroDoc> {
  try {
    const doc = await loadSidecar(owner, base.id);
    if (doc !== null) return doc;
  } catch {
    // Sidecar exists but is corrupt (loadSidecar threw on doc.import).
    // Fall through to rebuild below; do not rethrow.
  }

  // Sidecar missing or unreadable: seed a fresh doc from the mirror.
  const bytes = rebuildFromNote(base);
  const doc = new LoroDoc();
  doc.import(bytes);
  return doc;
}

// ---------------------------------------------------------------------------
// Combined persist helper (used by chunk 5's debounced commit)
// ---------------------------------------------------------------------------

/**
 * True for the file-system errors that a concurrent writer races into.
 *
 * When two clients write the same note files at once (for example a live
 * collab session with both peers pointed at the same data folder, or two tabs
 * on one folder during testing), the shared atomic tmp file collides: one
 * client moves it into place, the other then finds it gone (NotFoundError) or
 * locked (NoModificationAllowedError). We match by DOMException name rather
 * than instanceof so it holds across realms and test environments.
 */
function isConcurrentWriteError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "NoModificationAllowedError";
}

/**
 * Write both the sidecar AND the readable mirror in one call.
 *
 * Sidecar-before-mirror ordering is intentional: if the process crashes
 * between the two writes, the authoritative CRDT is on disk and the mirror
 * can be re-projected from it. The mirror is always a derivable projection,
 * never the source of truth for merge or history.
 *
 * Concurrent-writer tolerance: a racing write from another client surfaces as
 * a NotFoundError / lock on the shared atomic tmp file. We swallow ONLY those
 * (anything else, quota, revoked permission, still propagates). It is safe to
 * drop a racing write because the sidecar is authoritative and idempotent and
 * re-persisted on the next debounced commit, so the converged CRDT lands on
 * disk regardless of which writer wins this round.
 */
export async function persistNote(
  owner: string,
  doc: LoroDoc,
  base: Note,
): Promise<void> {
  try {
    await persistSidecar(owner, base.id, doc);
    await writeMirror(owner, doc, base);
  } catch (err) {
    if (isConcurrentWriteError(err)) {
      console.warn(
        "[loro] note persist raced another writer; the sidecar re-persists on the next commit",
        err,
      );
      return;
    }
    throw err;
  }
}
