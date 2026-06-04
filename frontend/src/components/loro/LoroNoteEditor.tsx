"use client";

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { LoroExtensions } from "loro-codemirror";
import { EphemeralStore, LoroDoc, UndoManager } from "loro-crdt";

interface LoroNoteEditorProps {
  initialContent: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
}

// LoroNoteEditor is a flag-gated validation component that proves
// LoroExtensions mounts and destroys cleanly under React 19 StrictMode.
// It is NOT wired to persistence -- onChange fires into the existing
// NoteDetailPopup save flow just like LiveMarkdownEditor does.
export default function LoroNoteEditor({
  initialContent,
  onChange,
  readOnly = false,
}: LoroNoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // viewRef holds the EditorView so cleanup can destroy it across the
  // StrictMode double-invocation cycle (mount -> unmount -> remount).
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const doc = new LoroDoc();
    const ephemeral = new EphemeralStore();
    const undoManager = new UndoManager(doc, {});

    // Seed the CRDT text. LoroExtensions defaults to the "codemirror" key,
    // so we seed the same container it will bind to.
    if (initialContent) {
      doc.getText("codemirror").insert(0, initialContent);
    }

    const extensions = [
      LoroExtensions(
        doc,
        { ephemeral, user: { name: "local", colorClassName: "user-local" } },
        undoManager,
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
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
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="w-full h-full min-h-[200px]" />;
}
