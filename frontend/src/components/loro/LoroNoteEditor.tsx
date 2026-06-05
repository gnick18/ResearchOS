"use client";

import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { openNote, type NoteHandle } from "@/lib/loro/store";
import type { Note } from "@/lib/types";

interface LoroNoteEditorProps {
  note: Note;
  owner: string;
  entryIndex: number;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

/**
 * LoroNoteEditor: flag-gated note editor backed by the Loro CRDT store.
 *
 * Lifecycle contract (React 19 StrictMode-safe):
 *   - Mount (or note.id/owner change): await openNote() to get the NoteHandle.
 *     While async, render an empty container (ready = false). Once ready,
 *     build an EditorView with handle.bindEditorExtension(entryIndex).
 *   - Entry switch (entryIndex change): tear down the current EditorView and
 *     rebuild with the new index's accessor. The SAME handle/doc is reused;
 *     we do NOT reopen the note. This matches the existing LiveMarkdownEditor
 *     behavior which already fully remounts on entry switch.
 *   - Unmount: view.destroy() then handle.close() (which flushes the last
 *     commit). React 19 StrictMode invokes mount -> unmount -> remount in
 *     development; the cleanup function must be idempotent. We guard with
 *     the `active` flag and null-check viewRef before destroying.
 *
 * Why separate effects for open-note vs. rebind-on-entry:
 *   The first effect runs when the note identity changes (new doc needed). The
 *   second effect runs on entryIndex changes against the already-open handle.
 *   Combining them would close+reopen the note on every entry switch, losing
 *   the single-doc-per-note cache invariant.
 */
export default function LoroNoteEditor({
  note,
  owner,
  entryIndex,
  onChange,
  readOnly = false,
}: LoroNoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // The EditorView is held in a ref (not state) so React's render cycle does
  // not interfere with the CodeMirror lifecycle. We destroy and recreate it
  // imperatively on entryIndex change.
  const viewRef = useRef<EditorView | null>(null);

  // The NoteHandle comes from the async openNote call. We hold it in a ref so
  // the entry-switch effect (second useEffect) can access it synchronously
  // without adding it to the dependency array (which would re-open the note).
  const handleRef = useRef<NoteHandle | null>(null);

  // `ready` drives the rendering decision: hide the container until the async
  // open completes so we never try to attach a CodeMirror view to a null
  // container. The state setter also triggers the second effect to build the
  // EditorView once the handle is available.
  const [ready, setReady] = useState(false);

  // Latest-value refs for note + onChange. These change identity on EVERY
  // render (NoteDetailPopup builds a fresh note object and updateEntryContent
  // closure each time the user types). If Effect 2 depended on them directly it
  // would destroy and rebuild the entire CodeMirror view on every keystroke,
  // re-initialising the Loro sync each time and hanging the main thread. The
  // updateListener reads these refs so the effect can stay stable.
  const noteRef = useRef(note);
  noteRef.current = note;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Effect 1: open the note (or close + reopen when note identity changes).
  // Dep array: note.id + owner -- the two things that identify which Loro doc
  // to open. entryIndex is intentionally excluded; it is handled by Effect 2.
  useEffect(() => {
    // `active` guards the StrictMode double-invoke cleanup: if this effect's
    // cleanup fires before openNote resolves (React unmounts the component
    // in dev StrictMode between the double mount), we skip updating state.
    let active = true;

    setReady(false);

    openNote(note, owner)
      .then((handle) => {
        if (!active) return;
        handleRef.current = handle;
        setReady(true);
      })
      .catch((err) => {
        // In production, a failed open leaves the editor blank (empty container).
        // Log and do not surface to the user; the legacy save path is still active.
        console.error("[LoroNoteEditor] openNote failed:", err);
      });

    return () => {
      active = false;
      // Destroy the current view (if any) synchronously on unmount.
      // view.destroy() is idempotent; safe to call more than once.
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      // Flush pending commit and release the handle. This is async; we fire
      // and forget on unmount because we cannot await inside a cleanup
      // function. The trailing-edge debounce (~600 ms) means the handle
      // typically has a pending write; flush() drains it before dropping the
      // doc from the cache.
      if (handleRef.current) {
        void handleRef.current.close();
        handleRef.current = null;
      }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, owner]);

  // Effect 2: build (or rebuild) the EditorView when the handle is ready OR
  // when the active entry changes.
  //
  // Why rebuild on entryIndex: LoroExtensions binds to a SPECIFIC LoroText
  // container via the getTextFromDoc accessor. There is no runtime rebind API;
  // a new EditorView is required for a new entry. We tear down the old view
  // and mount a fresh one into the same container div.
  useEffect(() => {
    if (!ready || !handleRef.current || !containerRef.current) return;

    const handle = handleRef.current;

    // Destroy the previous view if one exists (entry switch path).
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      handle.bindEditorExtension(entryIndex),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        // (a) Debounced persist through the handle (handle owns the timer).
        //     Read the latest base note from the ref, not the captured prop.
        void handle.commit(noteRef.current);
        // (b) Fire onChange so NoteDetailPopup's React state stays in sync
        //     with the CRDT content (drives the "unsaved changes" indicator
        //     and the legacy save path, which may still fire on Cmd+S).
        onChangeRef.current(update.state.doc.toString());
      }),
    ];

    if (readOnly) {
      extensions.push(EditorView.editable.of(false));
    }

    const view = new EditorView({
      parent: containerRef.current,
      extensions,
    });

    viewRef.current = view;

    return () => {
      // Cleanup on entryIndex change or unmount from this effect.
      // Do NOT call handle.close() here -- that belongs to Effect 1 (note
      // identity), not Effect 2 (entry switch). Closing on every entry switch
      // would evict the cached handle and lose the in-memory doc.
      view.destroy();
      viewRef.current = null;
    };
    // Deps are intentionally ONLY ready/entryIndex/readOnly. note and onChange
    // are accessed via refs (see noteRef/onChangeRef above) so a keystroke does
    // not rebuild the EditorView; rebuilding per keystroke hangs the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entryIndex, readOnly]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px]"
      // Hide the container while the handle is loading to avoid a flash of
      // unstyled CodeMirror chrome before the content is ready.
      style={ready ? undefined : { visibility: "hidden" }}
    />
  );
}
