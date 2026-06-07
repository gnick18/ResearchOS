/**
 * task-doc.ts
 *
 * Loro model for a task's freeform markdown surfaces (Lab Notes and Results).
 *
 * Experiments are Tasks, and a Task has two markdown documents, Lab Notes
 * (notes.md) and Results (results.md). For real-time co-editing (experiment
 * collab, see docs/proposals/EXPERIMENT_COLLAB.md) each becomes a Loro-backed
 * doc, reusing the same DO collab engine notes use.
 *
 * Unlike a note (which is a running-log with an entries MovableList), a task
 * markdown surface is a SINGLE markdown string. So the model is deliberately
 * simple: a "meta" map plus ONE root "content" LoroText holding the markdown.
 *
 * Determinism (the fork-fix invariant, mirroring seed.ts seedNoteDoc): the
 * seed uses the fixed seedActorId and inserts the whole markdown in a SINGLE
 * op, so two devices that independently seed the same surface from the same
 * notes.md produce byte-equal Loro output and converge rather than fork when
 * they connect to the relay.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc, LoroText, LoroMap } from "loro-crdt";
import { seedActorId } from "./seed";

/** Root container names. "content" holds the markdown; "meta" holds scalars. */
const CONTENT_KEY = "content";
const META_KEY = "meta";

/**
 * Build a fresh Loro doc for a task markdown surface from its current markdown.
 *
 * Returns a snapshot (Uint8Array) so callers persist or import it the same way
 * seedNoteDoc is used. createdAt is stored in meta for parity with notes (it is
 * not strictly needed for editing, but keeps a stable, deterministic meta).
 */
export function seedTaskDoc(markdown: string, createdAt?: string): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(seedActorId);

  const meta = doc.getMap(META_KEY);
  meta.set("created_at", createdAt ?? "");

  const content = doc.getText(CONTENT_KEY);
  if (markdown) {
    // One insert keeps the op count deterministic (same reasoning as
    // seedNoteDoc): two devices seeding identical markdown produce byte-equal
    // output.
    content.insert(0, markdown);
  }

  doc.commit();
  return doc.export({ mode: "snapshot" });
}

/** The live "content" LoroText container (the markdown body). */
export function getTaskContent(doc: LoroDoc): LoroText {
  return doc.getText(CONTENT_KEY);
}

/** Read the full markdown string. */
export function getTaskContentText(doc: LoroDoc): string {
  return doc.getText(CONTENT_KEY).toString();
}

/**
 * Replace the full markdown content (for non-editor writes, e.g. an external
 * change ingested at open). The live editor mutates the LoroText directly via
 * loro-codemirror; this is the coarse "set the whole string" path. No-op when
 * the text already matches.
 */
export function setTaskContentText(doc: LoroDoc, text: string): void {
  const content = doc.getText(CONTENT_KEY);
  if (content.toString() === text) return;
  content.delete(0, content.length);
  if (text) content.insert(0, text);
}

/** The task surface meta map. */
export function getTaskMeta(doc: LoroDoc): LoroMap {
  return doc.getMap(META_KEY);
}

/** The container key the editor's Loro sync plugin binds to. */
export const TASK_CONTENT_CONTAINER = CONTENT_KEY;
