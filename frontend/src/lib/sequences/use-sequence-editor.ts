// sequence Phase 2a bot — the editor state hook. Owns the editable document, an
// undo/redo SNAPSHOT stack, and the apply path for edit intents coming off the
// vendored SeqViz EventHandler. Save is EXPLICIT (no autosave), matching the
// de-bloat arc's "Save = checkpoint" ethos: the hook exposes `dirty` and a
// `commitSaved` to mark the persisted baseline.

import { useCallback, useMemo, useRef, useState } from "react";
import type { SeqEdit } from "@/vendor/seqviz/EventHandler";
import type { SequenceDetail } from "../types";
import {
  deleteBases,
  documentFromDetail,
  documentToAnnotations,
  insertBases,
  replaceBases,
  type SeqDocument,
} from "./edit-model";

// Cap the undo history so a long editing session doesn't grow without bound.
const MAX_HISTORY = 200;

export interface SequenceEditorState {
  doc: SeqDocument;
  annotations: ReturnType<typeof documentToAnnotations>;
  /** apply an edit intent from the SeqViz EventHandler. */
  applyEdit: (edit: SeqEdit) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** true when the in-memory doc differs from the last saved baseline. */
  dirty: boolean;
  /** mark the current doc as the saved baseline (called after a successful write). */
  commitSaved: () => void;
  /** the byte length of the current sequence (cheap helper for the toolbar). */
  length: number;
}

export function useSequenceEditor(detail: SequenceDetail): SequenceEditorState {
  // Build the initial document once per detail identity (id+genbank).
  const initial = useMemo(() => documentFromDetail(detail), [detail]);

  const [doc, setDoc] = useState<SeqDocument>(initial);
  // Undo/redo as a snapshot stack of whole documents (small + simple; the
  // sequence object is plain data so structural sharing is cheap enough).
  const past = useRef<SeqDocument[]>([]);
  const future = useRef<SeqDocument[]>([]);
  const [, forceTick] = useState(0);
  const bump = useCallback(() => forceTick((t) => t + 1), []);

  // The last-saved baseline doc, for the dirty flag.
  const savedRef = useRef<SeqDocument>(initial);

  // Re-seed when the loaded sequence identity changes (selecting another seq).
  const seedKey = useRef<string>("");
  const currentKey = `${detail.id}:${detail.genbank.length}`;
  if (seedKey.current !== currentKey) {
    seedKey.current = currentKey;
    past.current = [];
    future.current = [];
    savedRef.current = initial;
    // setState during render is allowed when guarded by a changed key.
    if (doc !== initial) setDoc(initial);
  }

  const pushHistory = useCallback((prev: SeqDocument) => {
    past.current.push(prev);
    if (past.current.length > MAX_HISTORY) past.current.shift();
    future.current = []; // a new edit invalidates the redo stack
  }, []);

  const applyEdit = useCallback(
    (edit: SeqEdit) => {
      setDoc((prev) => {
        let next: SeqDocument;
        switch (edit.type) {
          case "insert":
            next = insertBases(prev, edit.at, edit.text);
            break;
          case "delete":
            next = deleteBases(prev, edit.from, edit.count);
            break;
          case "replace":
            next = replaceBases(prev, edit.from, edit.to, edit.text);
            break;
          default:
            return prev;
        }
        if (next === prev) return prev; // no-op edit
        pushHistory(prev);
        return next;
      });
      bump();
    },
    [pushHistory, bump],
  );

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setDoc((prev) => {
      const restored = past.current.pop()!;
      future.current.push(prev);
      return restored;
    });
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setDoc((prev) => {
      const restored = future.current.pop()!;
      past.current.push(prev);
      return restored;
    });
    bump();
  }, [bump]);

  const commitSaved = useCallback(() => {
    savedRef.current = doc;
    bump();
  }, [doc, bump]);

  const annotations = useMemo(() => documentToAnnotations(doc), [doc]);

  return {
    doc,
    annotations,
    applyEdit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    dirty: doc !== savedRef.current,
    commitSaved,
    length: doc.seq.length,
  };
}
