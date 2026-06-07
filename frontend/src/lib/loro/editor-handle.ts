/**
 * editor-handle.ts
 *
 * The minimal handle shape the markdown editor (InlineMarkdownEditor /
 * LiveMarkdownEditor) binds to. Both NoteHandle (store.ts, the running-log note
 * model) and TaskDocHandle (task-store.ts, the single-text experiment surface)
 * satisfy this interface structurally, so the same editor drives either one via
 * a single loroHandle prop.
 *
 * The two models differ in two places, captured here as OPTIONAL members:
 *   - ensureEntries: a note reconciles its entry set before binding; a task
 *     surface is a single text and has nothing to reconcile.
 *   - editorSeedText: a task reads its seed markdown from the root "content"
 *     text; a note has none, so the editor falls back to getEntryContentText
 *     for the active entry.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { LoroDoc, EphemeralStore } from "loro-crdt";
import type { UserState, EphemeralState } from "loro-codemirror";
import type { Extension } from "@codemirror/state";
import type { Note } from "@/lib/types";

export interface EditorLoroHandle {
  /** The live LoroDoc. Read-only for the editor; mutations flow through the
   *  bound CM6 extensions. */
  readonly doc: LoroDoc;

  /**
   * Build the CM6 extension wiring for the surface at `activeIndex`.
   *
   * Notes bind the entry at that index; a single-text task surface ignores the
   * index. When `collabEphemeral` and `collabUser` are both present (a live
   * session), the ephemeral cursor layer is installed alongside the sync layer.
   */
  bindEditorExtension(
    activeIndex: number,
    collabEphemeral?: EphemeralStore<EphemeralState>,
    collabUser?: UserState,
  ): Extension;

  /**
   * Debounced persist driven on every edit.
   *
   * The note model reads `base` to project untracked mirror fields; the task
   * model ignores it (a single-text surface has no mirror projection). The
   * editor always passes its `loroBaseNote` here, which is the note for the
   * note path and undefined for the task path. TaskDocHandle.commit takes no
   * argument and is shape-compatible by structural typing.
   */
  commit(base: Note): Promise<void>;

  /** Force any pending debounced commit to run now. */
  flush(): Promise<void>;

  /** Subscribe to committed doc changes. Returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;

  /** True while a debounced commit is queued or in flight (drives the
   *  Saving/Saved indicator). */
  readonly commitPending: boolean;

  /** Subscribe to commitPending flips. Fires once immediately with the current
   *  value, then on every change. */
  subscribeCommitPending(cb: (pending: boolean) => void): () => void;

  /**
   * Note-only: reconcile the doc's entry set to the note before binding a
   * (possibly new) entry index. Absent on single-text task surfaces.
   */
  ensureEntries?(base: Note): void;

  /**
   * Read the seed markdown for `activeIndex`. Present on task surfaces (reads
   * the root "content" text); absent on notes, where the editor falls back to
   * getEntryContentText for the active entry.
   */
  editorSeedText?(activeIndex: number): string;
}
