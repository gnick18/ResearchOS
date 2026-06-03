"use client";

// sequence Phase 2a bot — EDITABLE SeqViz view. Same renderer as the read view
// (single-renderer principle), with `editable` turned on so keystrokes splice
// the host-owned document. Layers on a minimal calm toolbar (undo / redo / save)
// and a live selection readout (start..end, length bp, GC%). No autosave — Save
// is an explicit checkpoint.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Tooltip from "@/components/Tooltip";
import type { SequenceDetail } from "@/lib/types";
import type { AnnotationProp } from "@/vendor/seqviz/elements";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import { gcPercent } from "@/lib/sequences/edit-model";
import { useSequenceEditor } from "@/lib/sequences/use-sequence-editor";

const SeqViz = dynamic(() => import("@/vendor/seqviz"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
      Loading editor…
    </div>
  ),
});

// Inline SVG icons (no emojis / no icon library, per the project convention).
function IconUndo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function IconRedo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h1" />
    </svg>
  );
}
function IconSave({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const tone = primary
    ? "bg-sky-600 text-white hover:bg-sky-700 disabled:hover:bg-sky-600"
    : "text-gray-600 hover:bg-gray-100";
  return (
    <Tooltip label={label}>
      <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
        {children}
      </button>
    </Tooltip>
  );
}

export default function SequenceEditView({
  sequence,
  onSave,
  saving,
}: {
  sequence: SequenceDetail;
  /** persist the current GenBank; resolves true on success. */
  onSave: (genbank: string) => Promise<boolean>;
  saving: boolean;
}) {
  const editor = useSequenceEditor(sequence);
  const { doc, annotations: docAnnotations, applyEdit, undo, redo, canUndo, canRedo, dirty } = editor;

  // Track the live SeqViz selection for the readout.
  const [selection, setSelection] = useState<Selection | null>(null);

  const annotations: AnnotationProp[] = useMemo(
    () =>
      docAnnotations.map((a) => ({
        name: a.name,
        start: a.start,
        end: a.end,
        direction: a.direction,
        color: a.color,
      })),
    [docAnnotations],
  );

  const viewer = doc.circular ? "both" : "linear";

  const handleSave = useCallback(async () => {
    const { documentToGenbank } = await import("@/lib/sequences/edit-model");
    const gb = documentToGenbank(doc);
    if (!gb) {
      // Serialization failed — refuse to write a corrupt round-trip.
      // eslint-disable-next-line no-alert
      alert("Could not serialize this sequence to GenBank. Save aborted.");
      return;
    }
    const ok = await onSave(gb);
    if (ok) editor.commitSaved();
  }, [doc, onSave, editor]);

  // Keyboard: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redo, Cmd/Ctrl+S save.
  // These are bound at the container so they work whenever the editor surface
  // has focus, without depending on the SeqViz event router.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [undo, redo, handleSave]);

  // Selection readout values.
  type Readout =
    | { kind: "caret"; caret: number }
    | { kind: "range"; lo: number; hi: number; len: number; gc: number };
  const readout = useMemo<Readout | null>(() => {
    if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
      return null;
    }
    const lo = Math.min(selection.start, selection.end);
    const hi = Math.max(selection.start, selection.end);
    const len = hi - lo;
    if (len <= 0) {
      // A bare caret: show the caret position only.
      return { kind: "caret", caret: lo };
    }
    const gc = gcPercent(doc.seq, lo, hi);
    // SnapGene shows 1-based inclusive coordinates (e.g. "5..10").
    return { kind: "range", lo: lo + 1, hi, len, gc };
  }, [selection, doc.seq]);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col" tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1.5">
        <ToolbarButton label="Undo (Cmd+Z)" onClick={undo} disabled={!canUndo}>
          <IconUndo className="h-4 w-4" />
          <span className="hidden sm:inline">Undo</span>
        </ToolbarButton>
        <ToolbarButton label="Redo (Cmd+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <IconRedo className="h-4 w-4" />
          <span className="hidden sm:inline">Redo</span>
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <ToolbarButton label="Save (Cmd+S)" onClick={handleSave} disabled={!dirty || saving} primary>
          <IconSave className="h-4 w-4" />
          <span>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</span>
        </ToolbarButton>
        <div className="ml-auto pr-1 text-xs text-gray-400">
          {doc.seq.length.toLocaleString()} bp
          {dirty ? <span className="ml-2 text-amber-500">• unsaved</span> : null}
        </div>
      </div>

      {/* Editable viewer */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SeqViz
          key={sequence.id}
          name={sequence.locus_name || sequence.display_name}
          seq={doc.seq}
          seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
          annotations={annotations}
          primers={[]}
          viewer={viewer}
          editable
          onEdit={applyEdit}
          onSelection={setSelection}
          showComplement
          showIndex
          disableExternalFonts
          style={{ height: "100%", width: "100%" }}
        />
      </div>

      {/* Live selection readout */}
      <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
        {readout == null ? (
          <span className="text-gray-400">Click or select bases to see coordinates.</span>
        ) : readout.kind === "caret" ? (
          <span>
            Caret at <span className="font-medium text-gray-800">{(readout.caret + 1).toLocaleString()}</span>
          </span>
        ) : (
          <>
            <span>
              <span className="font-medium text-gray-800">
                {readout.lo.toLocaleString()}..{readout.hi.toLocaleString()}
              </span>
            </span>
            <span>
              <span className="font-medium text-gray-800">{readout.len.toLocaleString()}</span> bp
            </span>
            <span>
              <span className="font-medium text-gray-800">{readout.gc.toFixed(0)}%</span> GC
            </span>
          </>
        )}
      </div>
    </div>
  );
}
