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
import type { SeqEdit } from "@/vendor/seqviz/EventHandler";
import type { AnnotationProp } from "@/vendor/seqviz/elements";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import { gcPercent } from "@/lib/sequences/edit-model";
import {
  clipSelection,
  affectedFeatures,
  pasteClip,
  sanitizeRawSequence,
} from "@/lib/sequences/clipboard";
import {
  setMolecularClip,
  useMolecularClipboard,
} from "@/lib/sequences/molecular-clipboard";
import { useSequenceEditor } from "@/lib/sequences/use-sequence-editor";
import SequenceConfirmDialog, {
  type SequenceConfirmRequest,
} from "./SequenceConfirmDialog";

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

function IconCopy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconCut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88" />
      <path d="M14.47 14.48L20 20" />
      <path d="M8.12 8.12L12 12" />
    </svg>
  );
}
function IconPasteTool({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
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

  // App-scoped molecular clipboard (survives switching open sequences).
  const molClip = useMolecularClipboard();

  // The pending confirmation request (Cut/range-delete/Paste). null = closed.
  const [confirm, setConfirm] = useState<SequenceConfirmRequest | null>(null);

  // Normalized [lo, hi) of the current selection, and the caret (paste point).
  const sel = useMemo(() => {
    if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
      return { lo: 0, hi: 0, hasRange: false, caret: 0 };
    }
    const lo = Math.min(selection.start, selection.end);
    const hi = Math.max(selection.start, selection.end);
    return { lo, hi, hasRange: hi > lo, caret: lo };
  }, [selection]);

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

  // Move the SeqViz caret to a given index after an edit so the next action
  // (e.g. paste, then keep typing) lands in the right place.
  const placeCaret = useCallback((pos: number) => {
    setSelection({ clockwise: true, end: pos, start: pos, type: "SEQ" });
  }, []);

  // --- ANNOTATED CLIPBOARD ---------------------------------------------------

  // COPY: plain bases -> OS clipboard (interop), annotated clip -> molecular
  // clipboard (in-app, cross-document). Returns false if there's no range.
  const doCopy = useCallback((): boolean => {
    if (!sel.hasRange) return false;
    const bases = doc.seq.slice(sel.lo, sel.hi);
    // OS clipboard (plain text) for interop with other tools.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(bases).catch(() => {
        /* clipboard may be blocked (no focus / permissions); the molecular
           clip below still works for in-app paste. */
      });
    }
    // Molecular (annotated) clipboard, clipped + rebased to 0.
    setMolecularClip(clipSelection(doc, sel.lo, sel.hi));
    return true;
  }, [doc, sel]);

  // CUT: annotated copy, then delete the range (through the same confirmation
  // path as a chunk delete, since cutting bases is destructive).
  const requestRangeDelete = useCallback(
    (lo: number, hi: number, opts: { isCut?: boolean } = {}) => {
      const count = hi - lo;
      const aff = affectedFeatures(doc, lo, hi);
      const featNote =
        aff.length === 0
          ? ""
          : ` This ${aff.some((a) => a.effect === "removed") ? "removes" : "trims"} ${aff.length} ${aff.length === 1 ? "feature" : "features"}.`;
      setConfirm({
        tone: "delete",
        title: opts.isCut ? "Cut selection" : "Remove bases",
        summary: `Remove ${count.toLocaleString()} bp at position ${(lo + 1).toLocaleString()}.${featNote}`,
        affected: aff,
        confirmLabel: opts.isCut ? "Cut" : "Remove",
        onConfirm: () => {
          applyEdit({ type: "delete", from: lo, count });
          placeCaret(lo);
          setConfirm(null);
        },
        onCancel: () => setConfirm(null),
      });
    },
    [doc, applyEdit, placeCaret],
  );

  const doCut = useCallback(() => {
    if (!sel.hasRange) return;
    doCopy(); // annotated + OS-clipboard copy first
    requestRangeDelete(sel.lo, sel.hi, { isCut: true });
  }, [sel, doCopy, requestRangeDelete]);

  // PASTE: prefer the molecular clip (annotated); else fall back to OS-clipboard
  // raw text (unannotated, sanitized). Both go through a confirmation popup.
  const pasteMolecular = useCallback(() => {
    if (!molClip) return;
    const at = sel.caret;
    const n = molClip.seq.length;
    const m = molClip.features.length;
    const featPart =
      m === 0 ? "" : ` and ${m.toLocaleString()} ${m === 1 ? "feature" : "features"}`;
    setConfirm({
      tone: "paste",
      title: "Paste sequence",
      summary: `Insert ${n.toLocaleString()} bp${featPart} at position ${(at + 1).toLocaleString()}.`,
      confirmLabel: "Insert",
      onConfirm: () => {
        // Apply via the editor so it joins the undo stack: stage the doc, then
        // diff it into a single replace-style insert + feature merge. We use a
        // dedicated insert edit for the bases and rely on the model to shift,
        // then merge the carried features through a custom apply.
        editor.applyDocEdit((prev) => pasteClip(prev, at, molClip));
        placeCaret(at + n);
        setConfirm(null);
      },
      onCancel: () => setConfirm(null),
    });
  }, [molClip, sel, editor, placeCaret]);

  const pasteRawText = useCallback(async () => {
    if (!navigator.clipboard?.readText) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return; // clipboard read blocked
    }
    if (!text) return;
    const { bases, dropped } = sanitizeRawSequence(text, doc.seqType);
    if (!bases) return;
    const at = sel.caret;
    setConfirm({
      tone: "paste",
      title: "Paste bases",
      summary: `Insert ${bases.length.toLocaleString()} bp at position ${(at + 1).toLocaleString()}.`,
      note:
        dropped > 0
          ? `${dropped.toLocaleString()} non-sequence ${dropped === 1 ? "character was" : "characters were"} skipped.`
          : undefined,
      confirmLabel: "Insert",
      onConfirm: () => {
        applyEdit({ type: "insert", at, text: bases });
        placeCaret(at + bases.length);
        setConfirm(null);
      },
      onCancel: () => setConfirm(null),
    });
  }, [doc.seqType, sel, applyEdit, placeCaret]);

  // Single paste entry point: annotated clip wins, else raw OS text.
  const doPaste = useCallback(() => {
    if (molClip) {
      pasteMolecular();
    } else {
      void pasteRawText();
    }
  }, [molClip, pasteMolecular, pasteRawText]);

  // Intercept edit intents from SeqViz: a chunk DELETE (a selected range, i.e.
  // count > 1) routes through the confirmation dialog so the user sees which
  // features it touches; single-char Backspace/Delete and all inserts/replaces
  // apply immediately so typing stays fluid.
  const requestEdit = useCallback(
    (edit: SeqEdit) => {
      if (edit.type === "delete" && edit.count > 1) {
        requestRangeDelete(edit.from, edit.from + edit.count);
        return;
      }
      applyEdit(edit);
    },
    [applyEdit, requestRangeDelete],
  );

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
      } else if (k === "c") {
        // Annotated + OS-clipboard copy. Only override the browser default when
        // there's a range to copy; otherwise let the native copy through.
        if (doCopy()) e.preventDefault();
      } else if (k === "x") {
        if (sel.hasRange) {
          e.preventDefault();
          doCut();
        }
      } else if (k === "v") {
        e.preventDefault();
        doPaste();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [undo, redo, handleSave, doCopy, doCut, doPaste, sel.hasRange]);

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
        <ToolbarButton label="Copy (Cmd+C)" onClick={doCopy} disabled={!sel.hasRange}>
          <IconCopy className="h-4 w-4" />
          <span className="hidden sm:inline">Copy</span>
        </ToolbarButton>
        <ToolbarButton label="Cut (Cmd+X)" onClick={doCut} disabled={!sel.hasRange}>
          <IconCut className="h-4 w-4" />
          <span className="hidden sm:inline">Cut</span>
        </ToolbarButton>
        <ToolbarButton
          label={molClip ? "Paste annotated sequence (Cmd+V)" : "Paste bases from clipboard (Cmd+V)"}
          onClick={doPaste}
        >
          <IconPasteTool className="h-4 w-4" />
          <span className="hidden sm:inline">Paste</span>
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
          onEdit={requestEdit}
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

      {/* Confirmation dialog for Cut / chunk-delete / Paste. */}
      <SequenceConfirmDialog request={confirm} />
    </div>
  );
}
