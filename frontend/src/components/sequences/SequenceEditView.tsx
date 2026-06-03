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
import type { AnnotationProp, TranslationProp } from "@/vendor/seqviz/elements";
import type { Selection } from "@/vendor/seqviz/selectionContext";
import {
  deriveSelectionReadout,
  SelectionReadoutContent,
} from "./SequenceSelectionReadout";
import {
  clipSelection,
  affectedFeatures,
  pasteClip,
  sanitizeRawSequence,
} from "@/lib/sequences/clipboard";
import {
  addFeature,
  updateFeature,
  duplicateFeature,
  deleteFeature,
  setFeatureColor,
  setTypeColor,
  type FeatureDraft,
} from "@/lib/sequences/feature-edit";
import { colorForType } from "@/lib/sequences/feature-colors";
import { findOrfs } from "@/lib/sequences/orf";
import {
  setMolecularClip,
  useMolecularClipboard,
} from "@/lib/sequences/molecular-clipboard";
import { useSequenceEditor } from "@/lib/sequences/use-sequence-editor";
import SequenceConfirmDialog, {
  type SequenceConfirmRequest,
} from "./SequenceConfirmDialog";
import FeaturesPanel from "./FeaturesPanel";
import ViewControlRail from "./ViewControlRail";
import FeatureEditorDialog, {
  type FeatureEditorRequest,
} from "./FeatureEditorDialog";
import EnzymePickerDialog from "./EnzymePickerDialog";
import {
  DEFAULT_VIEW_STATE,
  isFeatureVisible,
  COMMON_ENZYMES,
  type SequenceViewState,
} from "./sequence-view-state";

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
// Features index toggle — a list/index glyph (the on-demand feature panel opener).
function IconFeaturesList({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
// Enzyme picker opener — scissors (restriction cut site).
function IconEnzymePicker({ className }: { className?: string }) {
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

  // Phase 2c — view controls (calm-by-default) + the feature add/edit dialog +
  // the currently-selected feature row, and an externally-driven zoom selection.
  const [view, setView] = useState<SequenceViewState>(DEFAULT_VIEW_STATE);
  // FEATURES LIST = ON-DEMAND: the right-side feature index is hidden by default
  // (calm full-width map + left rail). A toolbar toggle opens it as a drawer.
  const [featuresPanelOpen, setFeaturesPanelOpen] = useState(false);
  const [featureEditor, setFeatureEditor] = useState<FeatureEditorRequest | null>(null);
  const [selectedFeatureIdx, setSelectedFeatureIdx] = useState<number | null>(null);
  // Phase 2d — the restriction-enzyme picker. `activeEnzymes` is the in-session
  // chosen set (lowercase keys); null means "use the small common default".
  // NOT persisted to disk (out of scope for this chip). `enzymePickerOpen`
  // drives the SnapGene-style chooser dialog.
  const [enzymePickerOpen, setEnzymePickerOpen] = useState(false);
  const [activeEnzymes, setActiveEnzymes] = useState<string[] | null>(null);
  // When a feature row is clicked we drive the viewer selection to zoom it.
  const [externalSel, setExternalSel] = useState<{ start: number; end: number } | null>(null);

  // Normalized [lo, hi) of the current selection, and the caret (paste point).
  const sel = useMemo(() => {
    if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
      return { lo: 0, hi: 0, hasRange: false, caret: 0 };
    }
    const lo = Math.min(selection.start, selection.end);
    const hi = Math.max(selection.start, selection.end);
    return { lo, hi, hasRange: hi > lo, caret: lo };
  }, [selection]);

  // VIEW CONTROLS are the lever for the calm default: SeqViz is prop-driven, so
  // a hidden layer is just a filtered prop. We filter the annotations by the
  // per-type / per-feature / master toggles before handing them to SeqViz.
  const annotations: AnnotationProp[] = useMemo(
    () =>
      docAnnotations
        .filter((a) =>
          isFeatureVisible(view, {
            name: a.name,
            type: a.type,
            start: a.start,
            end: a.end,
            strand: a.direction === -1 ? -1 : 1,
          }),
        )
        .map((a) => ({
          name: a.name,
          start: a.start,
          end: a.end,
          direction: a.direction,
          color: a.color,
        })),
    [docAnnotations, view],
  );

  // Translation tracks: amino-acid translation of CDS-like features (opt-in),
  // plus computed ORFs when that layer is on. Both render as SeqViz translation
  // tracks, which is the only translation primitive the renderer exposes.
  const translations: TranslationProp[] = useMemo(() => {
    const out: TranslationProp[] = [];
    if (view.showTranslation) {
      for (const f of doc.features) {
        const t = (f.type || "").toLowerCase();
        if (t === "cds" || t === "gene" || t === "mat_peptide") {
          out.push({
            start: f.start,
            end: f.end,
            direction: f.strand === -1 ? -1 : 1,
            name: f.name,
            color: colorForType(f.type),
          });
        }
      }
    }
    if (view.showOrfs) {
      for (const o of findOrfs(doc.seq)) {
        out.push({
          start: o.start,
          end: o.end,
          direction: o.strand,
          name: "ORF",
          color: "#94a3b8",
        });
      }
    }
    return out;
  }, [doc.features, doc.seq, view.showTranslation, view.showOrfs]);

  // Restriction-enzyme cut sites. `showEnzymes` (the rail toggle) is the master
  // visibility lever; the Phase 2d picker chooses WHICH enzymes are active.
  // When the user hasn't opened the picker, fall back to the small common set.
  // SeqViz runs the digest itself from the keys we feed it.
  const enzymes = useMemo(
    () => (view.showEnzymes ? (activeEnzymes ?? COMMON_ENZYMES) : []),
    [view.showEnzymes, activeEnzymes],
  );

  // Opening the enzyme picker also turns the cut-site layer on, so the chosen
  // enzymes are immediately visible on the map.
  const openEnzymePicker = useCallback(() => {
    setView((v) => (v.showEnzymes ? v : { ...v, showEnzymes: true }));
    setEnzymePickerOpen(true);
  }, []);

  // The topology toggle in the rail can force a circular plasmid to render as
  // linear; a genuinely linear molecule always renders linear.
  const viewer = doc.circular && !view.forceLinear ? "both" : "linear";

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

  // --- FEATURE MANAGEMENT (Phase 2c) -----------------------------------------

  // Select + zoom a feature in the viewer by driving an external selection over
  // its range. SeqViz highlights/centers the selected span.
  const selectFeature = useCallback(
    (index: number) => {
      const f = doc.features[index];
      if (!f) return;
      setSelectedFeatureIdx(index);
      setExternalSel({ start: f.start, end: f.end });
    },
    [doc.features],
  );

  // ADD: open the editor seeded from the current drag-selection (or a 1-bp stub
  // at the caret if there's no range).
  const openAddFeature = useCallback(() => {
    const hasRange = sel.hasRange;
    const start = hasRange ? sel.lo : sel.caret;
    const end = hasRange ? sel.hi : Math.min(sel.caret + 1, doc.seq.length);
    setFeatureEditor({
      mode: "add",
      seqLength: doc.seq.length,
      initial: { name: "", type: "misc_feature", strand: 1, start, end },
      onSubmit: (draft: FeatureDraft) => {
        editor.applyDocEdit((prev) => addFeature(prev, draft));
        setFeatureEditor(null);
      },
      onCancel: () => setFeatureEditor(null),
    });
  }, [sel, doc.seq.length, editor]);

  // EDIT: open the editor seeded from an existing feature, with a Delete action.
  const openEditFeature = useCallback(
    (index: number) => {
      const f = doc.features[index];
      if (!f) return;
      setFeatureEditor({
        mode: "edit",
        seqLength: doc.seq.length,
        initial: {
          name: f.name,
          type: f.type || "misc_feature",
          strand: f.strand === -1 ? -1 : 1,
          start: f.start,
          end: f.end,
          color: f.color,
        },
        onSubmit: (draft: FeatureDraft) => {
          editor.applyDocEdit((prev) => updateFeature(prev, index, draft));
          setFeatureEditor(null);
        },
        onDelete: () => {
          editor.applyDocEdit((prev) => deleteFeature(prev, index));
          setFeatureEditor(null);
          setSelectedFeatureIdx(null);
        },
        onCancel: () => setFeatureEditor(null),
      });
    },
    [doc.features, doc.seq.length, editor],
  );

  // DOUBLE-CLICK A FEATURE ON THE VIEWER -> open its editor. SeqViz assigns its
  // own internal ids to annotations, so we match the double-clicked annotation
  // back to its feature by (name, start, end) — documentToAnnotations projects
  // features 1:1 in order, so this resolves to the correct feature index.
  const handleAnnotationDoubleClick = useCallback(
    (range: { name: string; start: number; end: number; direction?: number }) => {
      let index = doc.features.findIndex(
        (f) => f.name === range.name && f.start === range.start && f.end === range.end,
      );
      // Fall back to name-only, then start-only, in case the viewer normalized
      // a coordinate (e.g. modulo across the origin on a circular plasmid).
      if (index < 0) index = doc.features.findIndex((f) => f.name === range.name);
      if (index < 0) index = doc.features.findIndex((f) => f.start === range.start);
      if (index < 0) return;
      setSelectedFeatureIdx(index);
      openEditFeature(index);
    },
    [doc.features, openEditFeature],
  );

  const duplicateFeatureAt = useCallback(
    (index: number) => editor.applyDocEdit((prev) => duplicateFeature(prev, index)),
    [editor],
  );

  const deleteFeatureAt = useCallback(
    (index: number) => {
      const f = doc.features[index];
      const name = f?.name ?? "this feature";
      setConfirm({
        tone: "delete",
        title: "Delete feature",
        summary: `Remove the feature "${name}" from the annotation list. The sequence bases are not changed.`,
        confirmLabel: "Delete",
        onConfirm: () => {
          editor.applyDocEdit((prev) => deleteFeature(prev, index));
          setSelectedFeatureIdx(null);
          setConfirm(null);
        },
        onCancel: () => setConfirm(null),
      });
    },
    [doc.features, editor],
  );

  const recolorFeatureAt = useCallback(
    (index: number, color: string) =>
      editor.applyDocEdit((prev) => setFeatureColor(prev, index, color)),
    [editor],
  );

  const recolorType = useCallback(
    (type: string, color: string) =>
      editor.applyDocEdit((prev) => setTypeColor(prev, type, color)),
    [editor],
  );

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

  // Selection readout values (shared with the read view via the extracted
  // helper; edit-mode behavior is identical to before).
  const readout = useMemo(
    () => deriveSelectionReadout(selection, doc.seq),
    [selection, doc.seq],
  );

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
        <Tooltip label={featuresPanelOpen ? "Hide the feature list" : "Show the feature list"}>
          <button
            type="button"
            onClick={() => setFeaturesPanelOpen((o) => !o)}
            aria-pressed={featuresPanelOpen}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              featuresPanelOpen ? "bg-sky-50 text-sky-700" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <IconFeaturesList className="h-4 w-4" />
            <span className="hidden sm:inline">Features</span>
          </button>
        </Tooltip>
        <Tooltip label="Choose restriction enzymes">
          <button
            type="button"
            onClick={openEnzymePicker}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <IconEnzymePicker className="h-4 w-4" />
            <span className="hidden sm:inline">Enzymes</span>
          </button>
        </Tooltip>
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

      {/* Icon rail + editable viewer + features/display panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ViewControlRail view={view} onViewChange={setView} circular={doc.circular} />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <SeqViz
            key={sequence.id}
            name={sequence.locus_name || sequence.display_name}
            seq={doc.seq}
            seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
            annotations={annotations}
            translations={translations}
            enzymes={enzymes}
            primers={[]}
            viewer={viewer}
            editable
            onEdit={requestEdit}
            onAnnotationDoubleClick={handleAnnotationDoubleClick}
            onSelection={(s) => {
              setSelection(s);
              // A user-driven selection takes back control from a feature zoom.
              if (externalSel) setExternalSel(null);
            }}
            selection={externalSel ?? undefined}
            showComplement={view.showComplement}
            showIndex={view.showIndex}
            disableExternalFonts
            style={{ height: "100%", width: "100%" }}
          />
        </div>
        {/* FEATURES LIST = ON-DEMAND: rendered only when the toolbar toggle is on.
            Default view is a clean full-width map + the left view-control rail. */}
        {featuresPanelOpen && (
          <FeaturesPanel
            features={doc.features}
            view={view}
            onViewChange={setView}
            onSelectFeature={selectFeature}
            selectedIndex={selectedFeatureIdx}
            onAddFeature={openAddFeature}
            canAdd
            onEditFeature={openEditFeature}
            onDuplicateFeature={duplicateFeatureAt}
            onDeleteFeature={deleteFeatureAt}
            onRecolorFeature={recolorFeatureAt}
            onRecolorType={recolorType}
            onClose={() => setFeaturesPanelOpen(false)}
          />
        )}
      </div>

      {/* Live selection readout */}
      <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
        <SelectionReadoutContent readout={readout} />
      </div>

      {/* Confirmation dialog for Cut / chunk-delete / Paste / feature delete. */}
      <SequenceConfirmDialog request={confirm} />

      {/* Add / edit feature dialog. */}
      <FeatureEditorDialog request={featureEditor} />

      {/* Phase 2d — restriction-enzyme chooser. Applies the active set live. */}
      <EnzymePickerDialog
        open={enzymePickerOpen}
        seq={doc.seq}
        seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
        circular={doc.circular}
        active={activeEnzymes ?? COMMON_ENZYMES}
        selection={sel.hasRange ? { start: sel.lo, end: sel.hi } : null}
        onApply={setActiveEnzymes}
        onClose={() => setEnzymePickerOpen(false)}
      />
    </div>
  );
}
