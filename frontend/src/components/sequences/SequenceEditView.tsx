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
import { sequencesApi } from "@/lib/local-api";
import type { LibrarySequence } from "@/lib/sequences/primer-specificity";
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
  segmentsOf,
  qualifiersFromNotes,
  readNoteFlag,
  TRANSLATE_NOTE_KEY,
  PRIORITIZE_NOTE_KEY,
  type FeatureDraft,
} from "@/lib/sequences/feature-edit";
import { colorForType } from "@/lib/sequences/feature-colors";
import { findOrfs } from "@/lib/sequences/orf";
import { selectTranslationFeatures } from "@/lib/sequences/translation-tracks";
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
import PrimerDialog, { type PrimerDialogRequest } from "./PrimerDialog";
import PrimerEditorDialog, {
  type PrimerEditorRequest,
} from "./PrimerEditorDialog";
import {
  readPrimerSeq,
  readPrimerDescription,
  readPrimerPhosphorylated,
  buildPrimerQualifiers,
} from "@/lib/sequences/primer-feature";
import { reverseComplement } from "@/lib/sequences/primer";
import {
  DEFAULT_VIEW_STATE,
  isFeatureVisible,
  COMMON_ENZYMES,
  type SequenceViewState,
} from "./sequence-view-state";
import SequenceZoomControl from "./SequenceZoomControl";
import SequenceOverviewBar, { type OverviewFeature } from "./SequenceOverviewBar";
import SequenceTabBar, { type SequenceViewMode } from "./SequenceTabBar";
import SequenceCoordinateBar from "./SequenceCoordinateBar";
import SequencePrimersPanel from "./SequencePrimersPanel";
import SequenceEnzymesPanel from "./SequenceEnzymesPanel";
import SequenceHistoryPanel from "./SequenceHistoryPanel";
import {
  initialLinearZoom,
  viewportWindow,
  viewportWindowH,
  bpToScrollTop,
  bpToScrollLeft,
  zoomToCharWidth,
  pinchDeltaToZoom,
  bpUnderCursor,
  anchorScrollTopForBp,
  clampSequenceZoom,
  MAP_ZOOM,
} from "@/lib/sequences/sequence-zoom";
import {
  EditMenuDropdown,
  SequenceContextMenu,
  SequencePromptDialog,
  SequenceFindBox,
  type EditMenuItem,
} from "./SequenceEditMenu";
import {
  ExportMenuDropdown,
  type ExportMenuItem,
} from "./SequenceExportMenu";
import {
  documentToGenbankText,
  documentToFasta,
  selectionToGenbankText,
  selectionToFasta,
  selectionToProteinFasta,
  exportMapImage,
  sanitizeFilename,
  downloadText,
  downloadDataUrl,
  downloadBlob,
} from "@/lib/sequences/export";
import {
  copyBottomStrand,
  copyAminoAcids,
  reverseComplementClip,
  invertSelection,
  parseSelectRange,
  parseGoTo,
  caseTransform,
} from "@/lib/sequences/edit-ops";
import { getMolecularClip } from "@/lib/sequences/molecular-clipboard";
import type { Range as SeqVizRange } from "@/vendor/seqviz/elements";

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
  readOnly = false,
}: {
  sequence: SequenceDetail;
  /** persist the current GenBank; resolves true on success. Unused when readOnly. */
  onSave?: (genbank: string) => Promise<boolean>;
  saving?: boolean;
  /** When true, the surface is a read-only inspector: no caret/keystroke edit,
   *  no clipboard, no Save, no Add/Edit/Delete feature actions. Selection +
   *  readout still work, and double-clicking a feature opens its READ-ONLY info
   *  popup. Used to embed the same surface where the user can't edit (future
   *  in-note embeds / read-only-shared sequences). */
  readOnly?: boolean;
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
  // seq nav bot — the SnapGene BOTTOM-TAB view switcher. `viewMode` is the
  // primary "which view" state (Map / Sequence / Enzymes / Features / Primers /
  // History). The Map + Sequence tabs render the SeqViz viewer (Map = a
  // zoomed-out feature map, Sequence = base-level detail); the rest render their
  // panels in the main content area. This is orthogonal to the left
  // ViewControlRail (which toggles WHAT is drawn on the map).
  const [viewMode, setViewMode] = useState<SequenceViewMode>("sequence");
  const [featureEditor, setFeatureEditor] = useState<FeatureEditorRequest | null>(null);
  const [selectedFeatureIdx, setSelectedFeatureIdx] = useState<number | null>(null);
  // Phase 2d — the restriction-enzyme picker. `activeEnzymes` is the in-session
  // chosen set (lowercase keys); null means "use the small common default".
  // NOT persisted to disk (out of scope for this chip). `enzymePickerOpen`
  // drives the SnapGene-style chooser dialog.
  const [enzymePickerOpen, setEnzymePickerOpen] = useState(false);
  const [activeEnzymes, setActiveEnzymes] = useState<string[] | null>(null);
  // Phase 2e — the primer-design dialog (SnapGene "Add Primer"). null = closed.
  const [primerRequest, setPrimerRequest] = useState<PrimerDialogRequest | null>(null);
  // primer dialog bot — the SnapGene-style "Edit Primer" dialog (distinct from
  // PrimerDialog, the "Add Primer" flow). Opened by double-clicking a primer_bind
  // feature or via the Primers list. null = closed.
  const [primerEditor, setPrimerEditor] = useState<PrimerEditorRequest | null>(null);
  // When a feature row is clicked we drive the viewer selection to zoom it.
  const [externalSel, setExternalSel] = useState<{ start: number; end: number } | null>(null);

  // seq editops bot — Edit-menu plumbing. The right-click context menu position
  // (null = closed), the Find box (open + query + match results + active match),
  // and the Select Range / Go To prompt dialogs.
  const [contextMenuAt, setContextMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<SeqVizRange[]>([]);
  const [findActive, setFindActive] = useState(0);
  const [selectRangeOpen, setSelectRangeOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);

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
          // seq introns bot — pass exon spans through to SeqViz so a multi-exon
          // (join) feature draws exon boxes + a dashed intron connector. Absent
          // for single-span features (unchanged rendering).
          ...(a.segments && a.segments.length > 1 ? { segments: a.segments } : {}),
        })),
    [docAnnotations, view],
  );

  // Distinct feature types present (lowercase keys, sorted), for the per-type
  // show/hide flyout on the rail. Mirrors FeaturesPanel's typesPresent.
  const featureTypes = useMemo(() => {
    const set = new Set<string>();
    for (const f of doc.features) set.add((f.type || "misc_feature").trim().toLowerCase());
    return [...set].sort();
  }, [doc.features]);

  // Translation tracks: amino-acid translation of CDS-like features (opt-in),
  // plus computed ORFs when that layer is on. Both render as SeqViz translation
  // tracks, which is the only translation primitive the renderer exposes.
  const translations: TranslationProp[] = useMemo(() => {
    const out: TranslationProp[] = [];
    // Central-dogma dedup: when a locus carries overlapping gene/mRNA/CDS, only
    // the one closest to the protein gets a track, so the same translation is
    // not painted multiple times. Per-feature opt-ins are always kept.
    const chosen = selectTranslationFeatures(doc.features, {
      globalOn: view.showTranslation,
      isExplicit: (f) => readNoteFlag(f.notes, TRANSLATE_NOTE_KEY),
    });
    for (const f of chosen) {
      out.push({
        start: f.start,
        end: f.end,
        direction: f.strand === -1 ? -1 : 1,
        name: f.name,
        color: colorForType(f.type),
        // seq introns bot — for a multi-exon (join) CDS, pass the exon spans so
        // SeqViz splices the protein (translates concatenated exon bases, not the
        // raw span through the introns) and shows a dashed gap over the introns.
        ...(f.locations && f.locations.length > 1 ? { segments: f.locations } : {}),
      });
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

  // PRIMERS layer (Phase 2e): primers persist as standard GenBank primer_bind
  // features, so we derive the SeqViz `primers` prop from those features at their
  // binding-site coordinates + strand. The rail's `showPrimers` toggle is the
  // visibility lever (it was wired earlier as a forward hook fed primers={[]}).
  const primers = useMemo(() => {
    if (!view.showPrimers)
      return [] as { name: string; start: number; end: number; direction: 1 | -1; color: string }[];
    return doc.features
      .filter((f) => (f.type || "").toLowerCase() === "primer_bind")
      .map((f) => ({
        name: f.name,
        start: f.start,
        end: f.end,
        direction: (f.strand === -1 ? -1 : 1) as 1 | -1,
        // primer style bot — carry the primer color (pink, from feature-colors)
        // so the thin-bracket/marker renderer keeps it instead of SeqViz's
        // arbitrary colorByIndex fallback.
        color: f.color || colorForType("primer_bind"),
      }));
  }, [doc.features, view.showPrimers]);

  // Count of primer_bind features regardless of the Primers layer toggle (the
  // Primers tab badge + panel always reflect the real primers on the molecule).
  const primerCount = useMemo(
    () => doc.features.filter((f) => (f.type || "").toLowerCase() === "primer_bind").length,
    [doc.features],
  );

  // Opening the enzyme picker also turns the cut-site layer on, so the chosen
  // enzymes are immediately visible on the map.
  const openEnzymePicker = useCallback(() => {
    setView((v) => (v.showEnzymes ? v : { ...v, showEnzymes: true }));
    setEnzymePickerOpen(true);
  }, []);

  // PRIMER DESIGN: open the dialog, seeding the primer field from the current
  // selection's bases (if any). On submit, persist the primer as a primer_bind
  // feature at its binding site (strand = which template strand it anneals to),
  // storing the primer's own 5'->3' sequence as a /note qualifier so a primer
  // with a non-annealing 5' tail round-trips into the .gb. Turning the Primers
  // layer on so the new primer is immediately visible on the map.
  // Persist a primer as a primer_bind feature at its binding site. Shared by the
  // PrimerDialog ("Add a custom primer") and the Primers-tab design/check panel,
  // so every path that creates a primer uses the SAME persistence (it lands on
  // the map + GenBank, with the 5'->3' sequence in a /note "primer <SEQ>" flag).
  const addPrimerFeature = useCallback(
    (name: string, primerSeq: string, site: { start: number; end: number; direction: 1 | -1 }) => {
      editor.applyDocEdit((prev) =>
        addFeature(prev, {
          name: name || "primer",
          type: "primer_bind",
          strand: site.direction === -1 ? -1 : 1,
          start: site.start,
          end: site.end,
          qualifiers: [
            { key: "note", value: `primer ${primerSeq}` },
            { key: "label", value: name || "primer" },
          ],
        }),
      );
      setView((v) => (v.showPrimers ? v : { ...v, showPrimers: true }));
    },
    [editor],
  );

  // specificity bot — load the user's OWN connected sequences (with bases) for the
  // local-library specificity scan in the Primers > Check tab. Scope: the current
  // sequence plus its project siblings (sequences sharing any project_id), or the
  // whole library when the current sequence is unfiled. Each gets its bases via
  // sequencesApi.get; the current sequence uses the live (edited) doc so an
  // in-progress edit is scanned, not the on-disk copy.
  const loadLibrary = useCallback(async (): Promise<LibrarySequence[]> => {
    const all = await sequencesApi.list();
    const mine = sequence.project_ids ?? [];
    const inScope =
      mine.length > 0
        ? all.filter(
            (s) => s.id === sequence.id || s.project_ids.some((p) => mine.includes(p)),
          )
        : all;
    const out: LibrarySequence[] = [];
    for (const rec of inScope) {
      if (rec.id === sequence.id) {
        // Use the live edited document for the current sequence.
        out.push({ id: rec.id, name: rec.display_name, seq: doc.seq, circular: doc.circular });
        continue;
      }
      const detail = await sequencesApi.get(rec.id);
      if (detail?.seq) {
        out.push({ id: rec.id, name: rec.display_name, seq: detail.seq, circular: rec.circular });
      }
    }
    return out;
  }, [sequence.id, sequence.project_ids, doc.seq, doc.circular]);

  const openPrimerDialog = useCallback(() => {
    const seedSeq = sel.hasRange ? doc.seq.slice(sel.lo, sel.hi) : "";
    setPrimerRequest({
      template: doc.seq,
      seedSeq,
      seedName: "",
      onSubmit: ({ name, primerSeq, site }) => {
        addPrimerFeature(name, primerSeq, site);
        setPrimerRequest(null);
      },
      onCancel: () => setPrimerRequest(null),
    });
  }, [doc.seq, sel, addPrimerFeature]);

  // The topology toggle in the rail can force a circular plasmid to render as
  // linear; a genuinely linear molecule always renders linear. For a circular
  // plasmid, the Map tab shows JUST the ring (full size, no sequence panel) and
  // the Sequence tab shows the ring PLUS the linear sequence ("both").
  const viewer = doc.circular && !view.forceLinear
    ? viewMode === "map"
      ? "circular"
      : "both"
    : "linear";

  // seq nav bot — SEAMLESS ZOOM. The effective linear zoom is the user's chosen
  // value, or (until they touch the control) a length-aware "fit-ish" initial
  // zoom: large contigs open at the whole-sequence overview MAP, small plasmids
  // open at base level. This replaces the crude `>5000 bp -> linear 2` stand-in.
  const autoLinearZoom = useMemo(() => initialLinearZoom(doc.seq.length ?? 0), [doc.seq.length]);
  const linearZoom = view.linearZoom ?? autoLinearZoom;
  const isLinearViewer = viewer === "linear";

  // seq nav bot — MAP vs SEQUENCE tabs. The Sequence tab is the base-level detail
  // view (the user's chosen / auto zoom). The Map tab is a zoomed-out whole-
  // molecule view: circular molecules already render their ring (viewer="both"),
  // and a LINEAR molecule renders a feature MAP by pinning the zoom to MAP_ZOOM
  // (feature arrows, not legible bases). The zoom slider / coordinate cluster and
  // the editable detail surface belong to the Sequence tab.
  const showViewer = viewMode === "map" || viewMode === "sequence";
  const isMapView = viewMode === "map";
  // nav polish bot — FIX 1: keep Map and Sequence visually distinct even at the
  // slider floor. The Sequence view FLOORS its effective zoom just above SeqViz's
  // bases-free schematic band (SEQUENCE_MIN_LINEAR_ZOOM), so it always shows
  // legible bases + a base ruler; the Map view pins to MAP_ZOOM (pure feature
  // schematic, no bases). Toggling Map<->Sequence therefore always changes what
  // is drawn, not just the active-tab underline.
  const viewerLinearZoom = isMapView ? MAP_ZOOM : clampSequenceZoom(linearZoom);

  // wrap toggle bot — SINGLE-LINE (unwrapped) mode is opt-in and applies ONLY to
  // the linear Sequence DETAIL view (not the Map schematic, not circular). When
  // on, the whole sequence renders on one horizontal row at a fixed char width
  // mapped from the zoom knob; the viewer scrolls left-right. Default is WRAPPED.
  const singleLine = isLinearViewer && !isMapView && !view.wrapSequence;
  const singleLineCharWidth = useMemo(
    () => zoomToCharWidth(viewerLinearZoom),
    [viewerLinearZoom],
  );

  // The bp window currently visible in the main linear viewer, for the overview
  // bar's viewport box. Two-way sync: we read the SeqViz linear scroller's live
  // geometry (it stacks rows + scrolls vertically, so the visible vertical
  // fraction == the visible bp fraction). Updated on scroll/zoom/resize.
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [overviewWindow, setOverviewWindow] = useState<{ start: number; end: number }>({
    start: 0,
    end: doc.seq.length,
  });

  // ACCURACY FIX: re-resolve the live scroller (its ref can go stale across a
  // SeqViz re-render) and refuse to compute off a not-yet-laid-out subtree
  // (scrollHeight === 0 right after a zoom would otherwise snap the box to the
  // whole molecule). When the geometry isn't ready we leave the last good window
  // in place; the rAF-after-zoom effect below recomputes once it settles.
  const recomputeWindow = useCallback(() => {
    let sc = scrollerRef.current;
    if (!sc || !sc.isConnected) {
      sc = viewerRef.current?.querySelector<HTMLElement>(".la-vz-linear-scroller") ?? null;
      if (sc) scrollerRef.current = sc;
    }
    if (!sc) return;
    // wrap toggle bot — in SINGLE-LINE mode the window is read from the HORIZONTAL
    // scroll geometry (the row scrolls left-right); in WRAPPED mode it is read
    // from the VERTICAL geometry exactly as before.
    if (singleLine) {
      if (!(sc.scrollWidth > 0) || !(sc.clientWidth > 0)) return;
      setOverviewWindow(
        viewportWindowH({
          scrollLeft: sc.scrollLeft,
          scrollWidth: sc.scrollWidth,
          clientWidth: sc.clientWidth,
          seqLength: doc.seq.length,
        }),
      );
      return;
    }
    if (!(sc.scrollHeight > 0) || !(sc.clientHeight > 0)) return;
    setOverviewWindow(
      viewportWindow({
        scrollTop: sc.scrollTop,
        scrollHeight: sc.scrollHeight,
        clientHeight: sc.clientHeight,
        seqLength: doc.seq.length,
      }),
    );
  }, [doc.seq.length, singleLine]);

  // Locate the SeqViz linear scroller inside our viewer container and wire a
  // scroll listener + resize observer. SeqViz re-renders its scroll subtree on
  // zoom/seq changes, so we re-locate after those (effect deps below).
  useEffect(() => {
    if (!isLinearViewer) {
      scrollerRef.current = null;
      return;
    }
    let raf = 0;
    let sc: HTMLElement | null = null;
    // ACCURACY FIX: SeqViz mounts the linear scroller BEFORE its rows finish
    // wrapping, so the scroller's scrollHeight grows asynchronously over many
    // frames after attach (and after a client-side route reload). A fixed-time
    // settle window is racy; instead we watch scrollHeight on the rAF loop and
    // recompute the visible window WHENEVER it changes from the last value seen.
    // That converges the viewport box to the true visible range no matter how
    // long the row layout takes to settle, with near-zero steady-state cost.
    // wrap toggle bot — watch the layout dimension that grows asynchronously for
    // the active mode: scrollHeight (rows) in WRAPPED, scrollWidth (one wide row)
    // in SINGLE-LINE. Recompute the visible window whenever it changes.
    let lastScrollDim = -1;
    const onScroll = () => recomputeWindow();
    const attach = () => {
      const found = viewerRef.current?.querySelector<HTMLElement>(".la-vz-linear-scroller") ?? null;
      if (found && found !== sc) {
        if (sc) sc.removeEventListener("scroll", onScroll);
        sc = found;
        scrollerRef.current = sc;
        sc.addEventListener("scroll", onScroll, { passive: true });
        lastScrollDim = -1;
      }
      const dim = sc ? (singleLine ? sc.scrollWidth : sc.scrollHeight) : -1;
      if (sc && dim !== lastScrollDim) {
        lastScrollDim = dim;
        recomputeWindow();
      }
      raf = requestAnimationFrame(attach);
    };
    raf = requestAnimationFrame(attach);
    const ro = new ResizeObserver(() => recomputeWindow());
    if (viewerRef.current) ro.observe(viewerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      if (sc) sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [isLinearViewer, recomputeWindow, sequence.id, linearZoom, singleLine]);

  // ACCURACY FIX (the core bug): after ANY zoom change (slider, +/- buttons, the
  // bp-in-view field, the Fit button), SeqViz re-wraps the sequence into rows and
  // the scroller's scrollHeight changes asynchronously over the next frame or
  // two. A single synchronous recompute reads the STALE scrollHeight, so the
  // viewport box drifts / fails to shrink. We recompute on a short rAF burst so
  // the box settles to the true visible window once the row layout has updated.
  // (The pinch path runs its own re-assert loop, so this primarily covers the
  // slider / field / button / initial-mount paths.)
  useEffect(() => {
    if (!isLinearViewer) return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      recomputeWindow();
      if (performance.now() - start < 260) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isLinearViewer, linearZoom, recomputeWindow]);

  // seq pinch bot — TRACKPAD PINCH-TO-ZOOM (SnapGene feel). On macOS a trackpad
  // pinch arrives as a `wheel` event with ctrlKey===true (deltaY < 0 == spread /
  // zoom in, > 0 == pinch / zoom out). We attach a NON-passive wheel listener on
  // the viewer container so we can preventDefault and drive the SAME linear/
  // circular zoom view-state the slider uses. A PLAIN wheel (no ctrlKey) is left
  // untouched so SeqViz's own scroller keeps scrolling the sequence as today.
  //
  // Zoom is CURSOR-ANCHORED on the linear viewer: the bp under the pointer stays
  // under the pointer across a zoom step (SnapGene / map-app feel). SeqViz wraps
  // the sequence into stacked rows and scrolls VERTICALLY (no horizontal scroll),
  // so the meaningful anchor axis is the pointer's Y. At wheel time we capture the
  // bp under the pointer (bpUnderCursor) into pendingAnchorRef; a follow-up effect
  // re-applies scrollTop (anchorScrollTopForBp) once SeqViz re-lays-out the rows
  // with the new scrollHeight. Only the WHICH-ROW position is anchored exactly;
  // the column within a row can drift a few bases when bases-per-row changes (no
  // horizontal scroll exists to correct it) — this is the closest practical
  // anchoring for a row-wrapped renderer. The circular viewer has no scroll model
  // to anchor, so it stays centered. A PLAIN wheel (no ctrlKey) is untouched.
  // Resolve the live linear scroller: prefer the cached ref, but fall back to a
  // direct DOM query so a not-yet-attached ref never silently disables anchoring.
  const resolveScroller = useCallback((): HTMLElement | null => {
    if (scrollerRef.current && scrollerRef.current.isConnected) return scrollerRef.current;
    const found = viewerRef.current?.querySelector<HTMLElement>(".la-vz-linear-scroller") ?? null;
    if (found) scrollerRef.current = found;
    return found;
  }, []);

  // seq pinch bot — kick off the CURSOR-ANCHOR re-assert loop from the wheel/
  // gesture handler itself (NOT a zoom-keyed effect, which proved fragile: the
  // effect did not reliably re-run on the zoom change). We capture the bp under
  // the pointer NOW (pre-zoom geometry), then re-assert the anchored scrollTop on
  // every animation frame for a short window. SeqViz re-renders its scroller
  // subtree asynchronously AND restores its own scrollTop on its update cycle
  // (InfiniteScroll.scrollToCentralIndex) a frame or two later, so a one-shot set
  // gets clobbered; re-asserting against the live scrollHeight each frame wins and
  // recomputes correctly as the row layout grows/shrinks. Only the WHICH-ROW
  // (vertical) position is anchored exactly; the column within a row can drift a
  // few bases when bases-per-row changes (no horizontal scroll exists to correct
  // it) — the closest practical anchoring for a row-wrapped renderer.
  const anchorRafRef = useRef(0);
  const anchorTimerRef = useRef(0);
  const startCursorAnchor = useCallback((clientY: number) => {
    const sc = resolveScroller();
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const cursorY = clientY - rect.top;
    const bp = bpUnderCursor({
      cursorY,
      scrollTop: sc.scrollTop,
      scrollHeight: sc.scrollHeight,
      seqLength: doc.seq.length,
    });
    cancelAnimationFrame(anchorRafRef.current);
    window.clearTimeout(anchorTimerRef.current);
    const start = performance.now();
    const reassert = () => {
      const s = resolveScroller();
      if (!s) return;
      const target = anchorScrollTopForBp({
        bp,
        cursorY,
        newScrollHeight: s.scrollHeight,
        clientHeight: s.clientHeight,
        seqLength: doc.seq.length,
      });
      if (Math.abs(s.scrollTop - target) > 1) s.scrollTop = target;
      if (performance.now() - start < 320) {
        // Re-assert next frame. rAF is the smooth foreground path; a setTimeout
        // schedules the SAME single continuation so the loop survives frames where
        // rAF is starved (heavy SeqViz commit) or paused (background tab) — only
        // one of the two will win the next tick because each re-cancels the other.
        cancelAnimationFrame(anchorRafRef.current);
        window.clearTimeout(anchorTimerRef.current);
        anchorRafRef.current = requestAnimationFrame(reassert);
        anchorTimerRef.current = window.setTimeout(reassert, 32);
      } else {
        recomputeWindow();
      }
    };
    anchorRafRef.current = requestAnimationFrame(reassert);
    anchorTimerRef.current = window.setTimeout(reassert, 32);
  }, [doc.seq.length, resolveScroller, recomputeWindow]);

  // wrap toggle bot — SINGLE-LINE cursor-anchored zoom (horizontal analog of
  // startCursorAnchor). Capture the bp under the pointer's X from the pre-zoom
  // geometry, then re-assert the scrollLeft that keeps that bp under the pointer
  // as the row's scrollWidth changes with the new charWidth over the next frames.
  // Because single-line is a single continuous row (no row-wrapping), the anchor
  // is exact on both axes, unlike the wrapped path.
  const startCursorAnchorH = useCallback(
    (clientX: number) => {
      const sc = resolveScroller();
      if (!sc) return;
      const rect = sc.getBoundingClientRect();
      const cursorX = clientX - rect.left;
      const preWidth = sc.scrollWidth;
      if (!(preWidth > 0)) return;
      const frac = Math.max(0, Math.min(1, (sc.scrollLeft + cursorX) / preWidth));
      const bp = Math.round(frac * doc.seq.length);
      cancelAnimationFrame(anchorRafRef.current);
      window.clearTimeout(anchorTimerRef.current);
      const start = performance.now();
      const reassert = () => {
        const s = resolveScroller();
        if (!s) return;
        const newWidth = s.scrollWidth;
        const desired = (bp / Math.max(1, doc.seq.length)) * newWidth - cursorX;
        const maxScroll = Math.max(0, newWidth - s.clientWidth);
        const target = Math.max(0, Math.min(maxScroll, Math.round(desired)));
        if (Math.abs(s.scrollLeft - target) > 1) s.scrollLeft = target;
        if (performance.now() - start < 320) {
          cancelAnimationFrame(anchorRafRef.current);
          window.clearTimeout(anchorTimerRef.current);
          anchorRafRef.current = requestAnimationFrame(reassert);
          anchorTimerRef.current = window.setTimeout(reassert, 32);
        } else {
          recomputeWindow();
        }
      };
      anchorRafRef.current = requestAnimationFrame(reassert);
      anchorTimerRef.current = window.setTimeout(reassert, 32);
    },
    [doc.seq.length, resolveScroller, recomputeWindow],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(anchorRafRef.current);
      window.clearTimeout(anchorTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only a pinch (ctrl/⌘+wheel) zooms; everything else falls through to the
      // SeqViz scroller as a normal scroll.
      if (!e.ctrlKey) {
        // A PLAIN wheel over the circular plasmid rotates it (SeqViz's
        // rotateOnScroll). Consume the scroll there so the PAGE does not also
        // scroll while the user is spinning the plasmid. We only block over the
        // circular SVG itself, so the linear-detail half (and the linear view)
        // keep their normal scroll. SeqViz's own onWheel still fires to rotate;
        // preventDefault only stops the page-scroll default, not other handlers.
        const target = e.target as Element | null;
        if (target?.closest?.('[data-testid="la-vz-viewer-circular"]')) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (isLinearViewer) {
        if (singleLine) startCursorAnchorH(e.clientX);
        else startCursorAnchor(e.clientY);
      }
      setView((v) => {
        if (isLinearViewer) {
          const current = v.linearZoom ?? autoLinearZoom;
          const next = pinchDeltaToZoom(current, e.deltaY);
          return next === current && v.linearZoom !== null ? v : { ...v, linearZoom: next };
        }
        const next = pinchDeltaToZoom(v.circularZoom, e.deltaY);
        return next === v.circularZoom ? v : { ...v, circularZoom: next };
      });
    };
    // Safari (some builds) fires gesture* instead of ctrl+wheel. Handle if present.
    const onGesture = (e: Event) => {
      const ge = e as Event & { scale?: number; clientY?: number };
      if (typeof ge.scale !== "number") return;
      e.preventDefault();
      // gesturechange `scale` is relative to gesturestart (1 == no change, >1
      // spread/zoom-in, <1 pinch/zoom-out). Map to a deltaY-equivalent so we
      // reuse the same scaling: scale 1.1 -> ~ -10 deltaY (zoom in).
      const deltaY = (1 - ge.scale) * 100;
      const geX = (ge as Event & { clientX?: number }).clientX;
      if (isLinearViewer) {
        if (singleLine && typeof geX === "number") {
          startCursorAnchorH(geX);
        } else if (typeof ge.clientY === "number") {
          startCursorAnchor(ge.clientY);
        }
      }
      setView((v) => {
        if (isLinearViewer) {
          const current = v.linearZoom ?? autoLinearZoom;
          return { ...v, linearZoom: pinchDeltaToZoom(current, deltaY) };
        }
        return { ...v, circularZoom: pinchDeltaToZoom(v.circularZoom, deltaY) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture as EventListener);
    el.addEventListener("gesturechange", onGesture as EventListener);
    el.addEventListener("gestureend", onGesture as EventListener);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture as EventListener);
      el.removeEventListener("gesturechange", onGesture as EventListener);
      el.removeEventListener("gestureend", onGesture as EventListener);
    };
  }, [isLinearViewer, autoLinearZoom, startCursorAnchor, startCursorAnchorH, singleLine]);

  // Drag the overview viewport box -> scroll the main view so `bp` is at top.
  const scrollMainToBp = useCallback(
    (bp: number) => {
      const sc = scrollerRef.current;
      if (!sc) return;
      // wrap toggle bot — pan HORIZONTALLY in single-line mode, VERTICALLY when
      // wrapped. Both put `bp` at the left/top edge of the visible window.
      if (singleLine) {
        sc.scrollLeft = bpToScrollLeft({
          bp,
          scrollWidth: sc.scrollWidth,
          clientWidth: sc.clientWidth,
          seqLength: doc.seq.length,
        });
      } else {
        sc.scrollTop = bpToScrollTop({
          bp,
          scrollHeight: sc.scrollHeight,
          clientHeight: sc.clientHeight,
          seqLength: doc.seq.length,
        });
      }
      recomputeWindow();
    },
    [doc.seq.length, recomputeWindow, singleLine],
  );

  // Features projected to the overview bar (whole sequence, as arrows). Uses the
  // same visibility filtering as the main map so hidden types stay hidden.
  const overviewFeatures: OverviewFeature[] = useMemo(
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
          direction: (a.direction === -1 ? -1 : 1) as 1 | -1,
          color: a.color,
          type: a.type,
        })),
    [docAnnotations, view],
  );

  const handleSave = useCallback(async () => {
    if (readOnly || !onSave) return;
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
  }, [doc, onSave, editor, readOnly]);

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
        seq: doc.seq,
        initial: {
          name: f.name,
          type: f.type || "misc_feature",
          strand: f.strand === -1 ? -1 : 1,
          start: f.start,
          end: f.end,
          color: f.color,
          segments: segmentsOf(f),
          qualifiers: qualifiersFromNotes(f.notes),
          translate: readNoteFlag(f.notes, TRANSLATE_NOTE_KEY),
          prioritize: readNoteFlag(f.notes, PRIORITIZE_NOTE_KEY),
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

  // VIEW (read-only): open the feature info popup seeded from an existing
  // feature, with no edit affordances (mode "view").
  const openViewFeature = useCallback(
    (index: number) => {
      const f = doc.features[index];
      if (!f) return;
      setFeatureEditor({
        mode: "view",
        seqLength: doc.seq.length,
        seq: doc.seq,
        initial: {
          name: f.name,
          type: f.type || "misc_feature",
          strand: f.strand === -1 ? -1 : 1,
          start: f.start,
          end: f.end,
          color: f.color,
          segments: segmentsOf(f),
          qualifiers: qualifiersFromNotes(f.notes),
          translate: readNoteFlag(f.notes, TRANSLATE_NOTE_KEY),
          prioritize: readNoteFlag(f.notes, PRIORITIZE_NOTE_KEY),
        },
        onCancel: () => setFeatureEditor(null),
      });
    },
    [doc.features, doc.seq],
  );

  // primer dialog bot — EDIT PRIMER. Open the SnapGene-style Edit Primer dialog
  // for a primer_bind feature: seed name/description/oligo/phosphorylation from
  // the feature's /note flags (primer-feature.ts), and re-derive the binding site
  // from the (possibly edited) oligo on Save. Persistence goes through the SAME
  // feature-update path FeatureEditorDialog uses (updateFeature via applyDocEdit),
  // so the change lands on the map + round-trips to GenBank. When the oligo no
  // longer anneals, we keep the previous geometry (strand/start/end) and only
  // update the notes.
  const openEditPrimer = useCallback(
    (index: number) => {
      const f = doc.features[index];
      if (!f) return;
      setSelectedFeatureIdx(index);
      setPrimerEditor({
        featureIndex: index,
        template: doc.seq,
        initialName: f.name,
        initialDescription: readPrimerDescription(f),
        // The stored oligo, or the template subsequence at the binding site when
        // no /note "primer <SEQ>" flag is present (legacy / imported primers).
        initialOligo:
          readPrimerSeq(f) ||
          (f.strand === -1
            ? reverseComplement(doc.seq.slice(f.start, f.end))
            : doc.seq.slice(f.start, f.end)),
        initialPhosphorylated: readPrimerPhosphorylated(f),
        readOnly,
        onSubmit: ({ name, description, oligo, phosphorylated, site }) => {
          editor.applyDocEdit((prev) => {
            const cur = prev.features[index];
            if (!cur) return prev;
            const qualifiers = buildPrimerQualifiers(cur, {
              oligo,
              description,
              phosphorylated,
            });
            // Re-derive geometry from the edited oligo; keep the previous span /
            // strand when the oligo no longer anneals anywhere.
            const start = site ? site.start : cur.start;
            const end = site ? site.end : cur.end;
            const strand: 1 | -1 = site ? (site.direction === -1 ? -1 : 1) : cur.strand === -1 ? -1 : 1;
            return updateFeature(prev, index, {
              name: name || "primer",
              type: cur.type || "primer_bind",
              strand,
              start,
              end,
              color: cur.color,
              qualifiers,
            });
          });
          setPrimerEditor(null);
        },
        onDelete: readOnly
          ? undefined
          : () => {
              editor.applyDocEdit((prev) => deleteFeature(prev, index));
              setPrimerEditor(null);
              setSelectedFeatureIdx(null);
            },
        onCancel: () => setPrimerEditor(null),
      });
    },
    [doc.features, doc.seq, editor, readOnly],
  );

  // DOUBLE-CLICK A FEATURE ON THE VIEWER -> open its editor (editable surface) or
  // its READ-ONLY info popup (readOnly surface). SeqViz assigns its own internal
  // ids to annotations, so we match the double-clicked annotation back to its
  // feature by (name, start, end) — documentToAnnotations projects features 1:1
  // in order, so this resolves to the correct feature index.
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
      // primer dialog bot — primers get the dedicated Edit Primer dialog (read +
      // edit). Every other feature type opens the generic FeatureEditorDialog
      // (its read-only "view" popup on the read-only surface) unchanged.
      const isPrimer = (doc.features[index].type || "").toLowerCase() === "primer_bind";
      if (isPrimer) openEditPrimer(index);
      else if (readOnly) openViewFeature(index);
      else openEditFeature(index);
    },
    [doc.features, openEditFeature, openViewFeature, openEditPrimer, readOnly],
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

  // --- EDIT-MENU OPERATIONS (seq editops bot) --------------------------------

  // Is this a nucleotide sequence (complement / translate are meaningful)?
  const isNucleotide = doc.seqType !== "protein";

  // Write text to the OS clipboard, swallowing permission/focus errors (the same
  // best-effort pattern as doCopy). Returns the text written (or "").
  const writeOsClipboard = useCallback((text: string): string => {
    if (text && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        /* clipboard may be blocked (no focus / permissions) */
      });
    }
    return text;
  }, []);

  // COPY BOTTOM STRAND: reverse-complement of the selection (5'->3' bottom) -> OS
  // clipboard only (it is a strand readout, not an annotated molecular payload).
  const copyBottom = useCallback(() => {
    if (!sel.hasRange || !isNucleotide) return;
    writeOsClipboard(copyBottomStrand(doc.seq.slice(sel.lo, sel.hi), doc.seqType));
  }, [sel, isNucleotide, doc.seq, doc.seqType, writeOsClipboard]);

  // COPY AMINO ACIDS: frame-1 translation of the selection -> OS clipboard.
  const copyAA = useCallback(() => {
    if (!sel.hasRange) return;
    writeOsClipboard(copyAminoAcids(doc.seq.slice(sel.lo, sel.hi), doc.seqType));
  }, [sel, doc.seq, doc.seqType, writeOsClipboard]);

  // PASTE REVERSE COMPLEMENT: reverse-complement the molecular clip (bases +
  // carried features rebased onto the flipped frame), else the raw OS-clipboard
  // text, then paste at the caret through the same confirmation path.
  const pasteRevComp = useCallback(() => {
    const at = sel.caret;
    const clip = getMolecularClip();
    if (clip) {
      const rc = reverseComplementClip(clip);
      const n = rc.seq.length;
      const m = rc.features.length;
      const featPart = m === 0 ? "" : ` and ${m.toLocaleString()} ${m === 1 ? "feature" : "features"}`;
      setConfirm({
        tone: "paste",
        title: "Paste reverse complement",
        summary: `Insert ${n.toLocaleString()} bp${featPart} (reverse complement) at position ${(at + 1).toLocaleString()}.`,
        confirmLabel: "Insert",
        onConfirm: () => {
          editor.applyDocEdit((prev) => pasteClip(prev, at, rc));
          placeCaret(at + n);
          setConfirm(null);
        },
        onCancel: () => setConfirm(null),
      });
      return;
    }
    // No molecular clip: fall back to OS clipboard text, reverse-complemented.
    if (!navigator.clipboard?.readText) return;
    void (async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      const { bases, dropped } = sanitizeRawSequence(text, doc.seqType);
      if (!bases) return;
      const rcBases = isNucleotide
        ? reverseComplementClip({ seq: bases, features: [], seqType: doc.seqType, sourceName: "" }).seq
        : bases;
      setConfirm({
        tone: "paste",
        title: "Paste reverse complement",
        summary: `Insert ${rcBases.length.toLocaleString()} bp (reverse complement) at position ${(at + 1).toLocaleString()}.`,
        note:
          dropped > 0
            ? `${dropped.toLocaleString()} non-sequence ${dropped === 1 ? "character was" : "characters were"} skipped.`
            : undefined,
        confirmLabel: "Insert",
        onConfirm: () => {
          applyEdit({ type: "insert", at, text: rcBases });
          placeCaret(at + rcBases.length);
          setConfirm(null);
        },
        onCancel: () => setConfirm(null),
      });
    })();
  }, [sel, doc.seqType, isNucleotide, editor, applyEdit, placeCaret]);

  // SELECT ALL / SELECT RANGE / INVERT SELECTION. Selecting drives the viewer's
  // external selection (which also feeds the readout + every selection-aware op).
  const selectSpan = useCallback((start: number, end: number) => {
    setSelection({ clockwise: true, start, end, type: "SEQ" });
    setExternalSel({ start, end });
  }, []);

  const selectAll = useCallback(() => {
    if (doc.seq.length > 0) selectSpan(0, doc.seq.length);
  }, [doc.seq.length, selectSpan]);

  const applySelectRange = useCallback(
    (span: { start: number; end: number }) => {
      selectSpan(span.start, span.end);
      setSelectRangeOpen(false);
    },
    [selectSpan],
  );

  const invertSel = useCallback(() => {
    const { span } = invertSelection(sel.lo, sel.hi, doc.seq.length);
    if (span) selectSpan(span.start, span.end);
  }, [sel, doc.seq.length, selectSpan]);

  // MAKE UPPERCASE / MAKE LOWERCASE — case-transform the selected bases (an edit
  // joining the undo stack; no coordinate shift).
  const makeCase = useCallback(
    (to: "upper" | "lower") => {
      if (!sel.hasRange) return;
      editor.applyDocEdit((prev) => caseTransform(prev, sel.lo, sel.hi, to));
    },
    [sel, editor],
  );

  // FIND — drive the SeqViz `search` prop; the `onSearch` callback feeds matches
  // back. Cycling prev/next moves the active match and selects it in the viewer.
  const openFind = useCallback(() => {
    setFindOpen(true);
  }, []);

  const goToMatch = useCallback(
    (idx: number) => {
      if (findMatches.length === 0) return;
      const i = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
      setFindActive(i);
      const m = findMatches[i];
      selectSpan(Math.min(m.start, m.end), Math.max(m.start, m.end));
    },
    [findMatches, selectSpan],
  );

  // GO TO — jump/scroll the view to a coordinate and place the caret there,
  // reusing the nav's bp<->scroll math (scrollMainToBp).
  const applyGoTo = useCallback(
    (index: number) => {
      placeCaret(index);
      setExternalSel({ start: index, end: index });
      scrollMainToBp(index);
      setGoToOpen(false);
    },
    [placeCaret, scrollMainToBp],
  );

  // When the find query clears or shortens below the searchable minimum, drop
  // any stale matches so the readout + cycling reset cleanly.
  useEffect(() => {
    if (findQuery.trim().length < 2) {
      setFindMatches([]);
      setFindActive(0);
    }
  }, [findQuery]);

  // The SeqViz search prop (only active while the Find box is open with a real
  // query, so the digest/search recompute doesn't run otherwise).
  const searchProp = useMemo(
    () =>
      findOpen && findQuery.trim().length >= 2
        ? { query: findQuery.trim(), mismatch: 0 }
        : { query: "", mismatch: 0 },
    [findOpen, findQuery],
  );

  // SeqViz reports its match list here. We jump to the first match (and select
  // it) when the result set changes, mirroring a "find next" on submit.
  const onSearchResults = useCallback(
    (results: SeqVizRange[]) => {
      setFindMatches(results);
      if (results.length > 0) {
        setFindActive(0);
        const m = results[0];
        selectSpan(Math.min(m.start, m.end), Math.max(m.start, m.end));
      }
    },
    [selectSpan],
  );

  // Intercept edit intents from SeqViz: a chunk DELETE (a selected range, i.e.
  // count > 1) routes through the confirmation dialog so the user sees which
  // features it touches; single-char Backspace/Delete and all inserts/replaces
  // apply immediately so typing stays fluid.
  const requestEdit = useCallback(
    (edit: SeqEdit) => {
      if (readOnly) return; // read-only surface: ignore any edit intent
      if (edit.type === "delete" && edit.count > 1) {
        requestRangeDelete(edit.from, edit.from + edit.count);
        return;
      }
      applyEdit(edit);
    },
    [applyEdit, requestRangeDelete, readOnly],
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
      // NON-MUTATING shortcuts available in BOTH modes: Copy, Select All, Find,
      // Go To. (Read-only still selects, searches, and navigates.)
      if (k === "a") {
        e.preventDefault();
        selectAll();
        return;
      } else if (k === "f") {
        e.preventDefault();
        openFind();
        return;
      } else if (k === "g") {
        e.preventDefault();
        setGoToOpen(true);
        return;
      }
      // Read-only surface: allow Copy (non-mutating); ignore all edit shortcuts.
      if (readOnly) {
        if (k === "c") {
          if (doCopy()) e.preventDefault();
        }
        return;
      }
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
        // Shift+Cmd+V = Paste Reverse Complement; Cmd+V = ordinary paste.
        if (e.shiftKey) pasteRevComp();
        else doPaste();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    handleSave,
    doCopy,
    doCut,
    doPaste,
    pasteRevComp,
    selectAll,
    openFind,
    sel.hasRange,
    readOnly,
  ]);

  // Selection readout values (shared with the read view via the extracted
  // helper; edit-mode behavior is identical to before).
  const readout = useMemo(
    () => deriveSelectionReadout(selection, doc.seq),
    [selection, doc.seq],
  );

  // The shared Edit-menu action list (one source of truth for the toolbar
  // dropdown AND the right-click context menu). Destructive ops (Cut, Paste,
  // Paste RC, Delete, case-change) are OMITTED entirely on the read-only surface.
  const hasClip = !!molClip;
  const editMenuItems = useMemo<EditMenuItem[]>(() => {
    const items: EditMenuItem[] = [];
    // --- Clipboard group -----------------------------------------------------
    items.push({ id: "copy", label: "Copy", shortcut: "Cmd C", enabled: sel.hasRange, onRun: doCopy });
    items.push({
      id: "copy-bottom",
      label: "Copy Bottom Strand",
      enabled: sel.hasRange && isNucleotide,
      onRun: copyBottom,
    });
    items.push({
      id: "copy-aa",
      label: "Copy Amino Acids",
      enabled: sel.hasRange,
      onRun: copyAA,
    });
    if (!readOnly) {
      items.push({ id: "cut", label: "Cut", shortcut: "Cmd X", enabled: sel.hasRange, destructive: true, onRun: doCut });
      items.push({ id: "paste", label: "Paste", shortcut: "Cmd V", enabled: true, onRun: doPaste });
      items.push({
        id: "paste-rc",
        label: "Paste Reverse Complement",
        shortcut: "Shift Cmd V",
        enabled: true,
        onRun: pasteRevComp,
      });
      items.push({
        id: "delete",
        label: "Delete Bases",
        enabled: sel.hasRange,
        destructive: true,
        onRun: () => requestRangeDelete(sel.lo, sel.hi),
      });
    }
    // --- Selection group -----------------------------------------------------
    items.push({ id: "select-all", label: "Select All", shortcut: "Cmd A", enabled: doc.seq.length > 0, group: true, onRun: selectAll });
    items.push({ id: "select-range", label: "Select Range…", enabled: doc.seq.length > 0, onRun: () => setSelectRangeOpen(true) });
    items.push({ id: "invert", label: "Invert Selection", enabled: doc.seq.length > 0, onRun: invertSel });
    // --- Case group (edit only) ---------------------------------------------
    if (!readOnly) {
      items.push({ id: "upper", label: "Make Uppercase", enabled: sel.hasRange, group: true, onRun: () => makeCase("upper") });
      items.push({ id: "lower", label: "Make Lowercase", enabled: sel.hasRange, onRun: () => makeCase("lower") });
    }
    // --- Find / navigate group ----------------------------------------------
    items.push({ id: "find", label: "Find…", shortcut: "Cmd F", enabled: true, group: true, onRun: openFind });
    items.push({ id: "goto", label: "Go To…", shortcut: "Cmd G", enabled: doc.seq.length > 0, onRun: () => setGoToOpen(true) });
    return items;
  }, [
    readOnly,
    sel.hasRange,
    sel.lo,
    sel.hi,
    isNucleotide,
    doc.seq.length,
    hasClip,
    doCopy,
    copyBottom,
    copyAA,
    doCut,
    doPaste,
    pasteRevComp,
    requestRangeDelete,
    selectAll,
    invertSel,
    makeCase,
    openFind,
  ]);

  // seq export bot — the Export dropdown. Read-only download of the whole
  // sequence (GenBank/FASTA), the current selection (DNA .gb/FASTA + frame-1
  // protein FASTA), and the live map image (SVG always; PNG best-effort via
  // canvas rasterization). All serialization lives in lib/sequences/export.ts;
  // these handlers only call it and trigger the browser download.
  const baseFileName = useMemo(
    () => sanitizeFilename(doc.name || sequence.display_name || "sequence"),
    [doc.name, sequence.display_name],
  );

  const exportMenuItems = useMemo<ExportMenuItem[]>(() => {
    const items: ExportMenuItem[] = [];

    items.push({
      id: "gb-all",
      label: "GenBank (whole sequence)",
      hint: ".gb",
      enabled: true,
      onRun: () => {
        const text = documentToGenbankText(doc);
        if (!text) {
          alert("Could not serialize this sequence to GenBank.");
          return;
        }
        downloadText(text, `${baseFileName}.gb`, "chemical/seq-na-genbank");
      },
    });
    items.push({
      id: "fasta-all",
      label: "FASTA (whole sequence)",
      hint: ".fasta",
      enabled: true,
      onRun: () => {
        downloadText(documentToFasta(doc), `${baseFileName}.fasta`, "text/x-fasta");
      },
    });

    items.push({
      id: "gb-sel",
      label: "Selected DNA (GenBank)",
      hint: ".gb",
      enabled: sel.hasRange,
      group: true,
      onRun: () => {
        const text = selectionToGenbankText(doc, sel.lo, sel.hi);
        if (!text) {
          alert("Could not serialize the selection to GenBank.");
          return;
        }
        downloadText(text, `${baseFileName}_${sel.lo + 1}-${sel.hi}.gb`, "chemical/seq-na-genbank");
      },
    });
    items.push({
      id: "fasta-sel",
      label: "Selected DNA (FASTA)",
      hint: ".fasta",
      enabled: sel.hasRange,
      onRun: () => {
        const text = selectionToFasta(doc, sel.lo, sel.hi);
        downloadText(text, `${baseFileName}_${sel.lo + 1}-${sel.hi}.fasta`, "text/x-fasta");
      },
    });
    items.push({
      id: "protein-sel",
      label: "Selected protein (FASTA, frame 1)",
      hint: ".fasta",
      enabled: sel.hasRange && isNucleotide,
      onRun: () => {
        const text = selectionToProteinFasta(doc, sel.lo, sel.hi);
        downloadText(text, `${baseFileName}_${sel.lo + 1}-${sel.hi}_protein.fasta`, "text/x-fasta");
      },
    });

    items.push({
      id: "map-svg",
      label: "Map image (SVG)",
      hint: ".svg",
      enabled: true,
      group: true,
      onRun: async () => {
        const out = await exportMapImage(viewerRef.current);
        if (!out) {
          alert("Could not capture the map view.");
          return;
        }
        downloadText(out.svg, `${baseFileName}_map.svg`, "image/svg+xml");
      },
    });
    items.push({
      id: "map-png",
      label: "Map image (PNG)",
      hint: ".png",
      enabled: true,
      onRun: async () => {
        const out = await exportMapImage(viewerRef.current);
        if (!out) {
          alert("Could not capture the map view.");
          return;
        }
        if (out.png) {
          downloadDataUrl(out.png, `${baseFileName}_map.png`);
        } else {
          // PNG rasterization unavailable in this environment: fall back to SVG
          // so the user still gets an image they can convert.
          downloadBlob(
            new Blob([out.svg], { type: "image/svg+xml;charset=utf-8" }),
            `${baseFileName}_map.svg`,
          );
        }
      },
    });

    return items;
  }, [doc, sel, isNucleotide, baseFileName]);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col" tabIndex={-1}>
      {/* Toolbar. The mutating affordances (undo/redo/cut/paste/primer/save) are
          hidden on the read-only surface; selection, the feature list, enzymes
          (display-only) and Copy remain available. */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1.5">
        {!readOnly ? (
          <>
            <ToolbarButton label="Undo (Cmd+Z)" onClick={undo} disabled={!canUndo}>
              <IconUndo className="h-4 w-4" />
              <span className="hidden sm:inline">Undo</span>
            </ToolbarButton>
            <ToolbarButton label="Redo (Cmd+Shift+Z)" onClick={redo} disabled={!canRedo}>
              <IconRedo className="h-4 w-4" />
              <span className="hidden sm:inline">Redo</span>
            </ToolbarButton>
            <div className="mx-1 h-5 w-px bg-gray-200" />
          </>
        ) : null}
        <ToolbarButton label="Copy (Cmd+C)" onClick={doCopy} disabled={!sel.hasRange}>
          <IconCopy className="h-4 w-4" />
          <span className="hidden sm:inline">Copy</span>
        </ToolbarButton>
        {!readOnly ? (
          <>
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
          </>
        ) : null}
        {/* seq editops bot — the visible "Edit" dropdown (third home for the
            ops; right-click menu + keyboard shortcuts are the other two). */}
        <EditMenuDropdown items={editMenuItems} />
        {/* seq export bot — the Export dropdown (download .gb / .fasta /
            selected DNA + protein / map image). Available in read-only too. */}
        <ExportMenuDropdown items={exportMenuItems} />
        {!readOnly ? (
          <>
            <div className="mx-1 h-5 w-px bg-gray-200" />
            <ToolbarButton label="Save (Cmd+S)" onClick={handleSave} disabled={!dirty || saving} primary>
              <IconSave className="h-4 w-4" />
              <span>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</span>
            </ToolbarButton>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-3 pr-1">
          <div className="text-xs text-gray-400">
            {doc.seq.length.toLocaleString()} bp
            {!readOnly && dirty ? <span className="ml-2 text-amber-500">• unsaved</span> : null}
            {readOnly ? <span className="ml-2 text-gray-400">Read-only</span> : null}
          </div>
        </div>
      </div>

      {/* Icon rail + tab content. The left ViewControlRail (layer toggles) stays
          visible for the Map + Sequence views; the other tabs render their own
          panel in the main content area. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showViewer ? (
          <ViewControlRail view={view} onViewChange={setView} circular={doc.circular} featureTypes={featureTypes} />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* seq nav bot — Map + Sequence: the SeqViz viewer + the persistent top
              overview strip (linear) + the bottom coordinate / zoom cluster. The
              viewer is kept MOUNTED for both tabs (just re-zoomed) so switching
              Map<->Sequence does not tear down + reflow the renderer. */}
          {showViewer ? (
            <>
              {/* FIXED whole-molecule overview strip + moving viewport box. Always
                  shows the WHOLE molecule at full extent; the box reflects the bp
                  range currently visible in the detail view (linear only). */}
              {isLinearViewer ? (
                <SequenceOverviewBar
                  seqLength={doc.seq.length}
                  features={overviewFeatures}
                  window={overviewWindow}
                  onScrollToBp={scrollMainToBp}
                />
              ) : null}
              <div
                ref={viewerRef}
                className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
                onContextMenu={(e) => {
                  // Right-click anywhere on the sequence surface opens the Edit
                  // menu (the primary, selection-aware home for these ops).
                  e.preventDefault();
                  setContextMenuAt({ x: e.clientX, y: e.clientY });
                }}
              >
                {/* seq editops bot — inline Find box (Cmd+F), anchored top-right. */}
                {findOpen ? (
                  <SequenceFindBox
                    query={findQuery}
                    onQueryChange={setFindQuery}
                    matchCount={findMatches.length}
                    activeIndex={findActive}
                    onPrev={() => goToMatch(findActive - 1)}
                    onNext={() => goToMatch(findActive + 1)}
                    onClose={() => {
                      setFindOpen(false);
                      setFindQuery("");
                    }}
                  />
                ) : null}
                <SeqViz
                  key={sequence.id}
                  name={sequence.locus_name || sequence.display_name}
                  seq={doc.seq}
                  seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
                  annotations={annotations}
                  // nav polish bot — FIX 1: the Map view is explicitly the
                  // "no bases, whole molecule" feature schematic. Strip the
                  // base-level clutter (translation tracks, enzyme cut sites,
                  // primer arrows) so only feature arrows + labels carry the
                  // map; the Sequence view keeps the full layer stack. This makes
                  // the two tabs render obviously different content.
                  translations={isMapView ? [] : translations}
                  enzymes={isMapView ? [] : enzymes}
                  // primer style bot — primers now have a lightweight map renderer
                  // (thin brackets on linear / radial markers on circular), so the
                  // Map view keeps showing them as SnapGene-style markers instead
                  // of stripping them. Still gated by the Primers rail toggle via
                  // the `primers` memo.
                  primers={primers}
                  search={searchProp}
                  onSearch={onSearchResults}
                  viewer={viewer}
                  zoom={{ linear: viewerLinearZoom, circular: view.circularZoom }}
                  editable={!readOnly && viewMode === "sequence"}
                  onEdit={requestEdit}
                  onAnnotationDoubleClick={handleAnnotationDoubleClick}
                  onSelection={(s) => {
                    setSelection(s);
                    // A user-driven selection takes back control from a feature zoom.
                    if (externalSel) setExternalSel(null);
                  }}
                  selection={externalSel ?? undefined}
                  // nav polish bot — FIX 1: remove the base ruler / complement
                  // strand in Map view (there are no legible bases to index), and
                  // always keep them available in Sequence view so it retains its
                  // base-level character even at the slider floor.
                  showComplement={isMapView ? false : view.showComplement}
                  showIndex={isMapView ? false : view.showIndex}
                  // wrap toggle bot — SINGLE-LINE vs WRAPPED for the linear
                  // Sequence detail view. Map / circular always render wrapped.
                  wrapSequence={!singleLine}
                  singleLineCharWidth={singleLineCharWidth}
                  disableExternalFonts
                  style={{ height: "100%", width: "100%" }}
                />
              </div>
              {/* BOTTOM COORDINATE / ZOOM CLUSTER (linear only): zoom slider +
                  editable bp-in-view field + exact window readout + horizontal
                  coordinate minimap. Hidden on circular (the ring is the map). */}
              {isLinearViewer ? (
                <SequenceCoordinateBar
                  seqLength={doc.seq.length}
                  window={overviewWindow}
                  zoom={linearZoom}
                  onZoomChange={(z) => setView((v) => ({ ...v, linearZoom: z }))}
                  onScrollToBp={scrollMainToBp}
                  // nav polish bot — in Map view the molecule is shown whole, so
                  // the window cluster (slider / bp-in-view / readout / minimap)
                  // is stale; collapse it to a "Whole molecule (N bp)" indicator.
                  mapMode={viewMode === "map"}
                />
              ) : viewMode === "map" ? (
                // nav polish bot — circular molecule in Map view: the ring IS the
                // whole-molecule map, so the circular zoom slider is irrelevant.
                // Mirror the linear Map cluster with the same calm indicator.
                <div className="flex items-center gap-2 border-t border-gray-100 bg-white px-3 py-2 text-[12px] text-gray-500">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5 text-gray-400"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
                  </svg>
                  <span>
                    Whole molecule
                    <span className="ml-1 font-mono text-gray-600">
                      ({doc.seq.length.toLocaleString()} bp)
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 border-t border-gray-100 bg-white px-3 py-1.5">
                  <SequenceZoomControl
                    axis="circular"
                    zoom={view.circularZoom}
                    onZoomChange={(z) => setView((v) => ({ ...v, circularZoom: z }))}
                  />
                </div>
              )}
            </>
          ) : null}

          {/* FEATURES tab — reuses the FeaturesPanel content as a full-width view. */}
          {viewMode === "features" ? (
            <FeaturesPanel
              features={doc.features}
              view={view}
              onViewChange={setView}
              onSelectFeature={selectFeature}
              selectedIndex={selectedFeatureIdx}
              onAddFeature={openAddFeature}
              canAdd={!readOnly}
              readOnly={readOnly}
              onEditFeature={readOnly ? openViewFeature : openEditFeature}
              onDuplicateFeature={duplicateFeatureAt}
              onDeleteFeature={deleteFeatureAt}
              onRecolorFeature={recolorFeatureAt}
              onRecolorType={recolorType}
            />
          ) : null}

          {/* ENZYMES tab — in-panel digest summary; the picker dialog still opens
              from "Choose enzymes" to change the active set. */}
          {viewMode === "enzymes" ? (
            <SequenceEnzymesPanel
              seq={doc.seq}
              seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
              circular={doc.circular}
              active={activeEnzymes ?? COMMON_ENZYMES}
              onChooseEnzymes={openEnzymePicker}
              onGoToPosition={(bp) => {
                setViewMode("sequence");
                applyGoTo(bp);
              }}
            />
          ) : null}

          {/* PRIMERS tab — derived from primer_bind features; design via the
              existing PrimerDialog. */}
          {viewMode === "primers" ? (
            <SequencePrimersPanel
              features={doc.features}
              template={doc.seq}
              selection={sel.hasRange ? { start: sel.lo, end: sel.hi } : null}
              onSelectPrimer={(index) => {
                setViewMode("sequence");
                selectFeature(index);
              }}
              onEditPrimer={openEditPrimer}
              selectedIndex={selectedFeatureIdx}
              onAddCustomPrimer={openPrimerDialog}
              onAddPrimer={addPrimerFeature}
              onDeletePrimer={deleteFeatureAt}
              readOnly={readOnly}
              currentSequenceId={sequence.id}
              loadLibrary={loadLibrary}
            />
          ) : null}

          {/* HISTORY tab — empty state until the cloning-history phase lands. */}
          {viewMode === "history" ? <SequenceHistoryPanel /> : null}
        </div>
      </div>

      {/* Live selection readout */}
      <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
        <SelectionReadoutContent readout={readout} />
      </div>

      {/* seq nav bot — the SnapGene-style BOTTOM TAB BAR (always visible): the
          primary Map / Sequence / Enzymes / Features / Primers / History switch. */}
      <SequenceTabBar
        active={viewMode}
        onChange={setViewMode}
        featureCount={doc.features.length}
        primerCount={primerCount}
        enzymeCount={(activeEnzymes ?? COMMON_ENZYMES).length}
      />

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

      {/* Phase 2e — primer design dialog (Tm / GC / binding site / alignment). */}
      <PrimerDialog request={primerRequest} />

      {/* primer dialog bot — SnapGene-style Edit Primer dialog for a primer_bind
          feature (double-click a primer, or open from the Primers list). */}
      <PrimerEditorDialog request={primerEditor} />

      {/* seq editops bot — right-click Edit context menu (selection-aware home). */}
      <SequenceContextMenu
        at={contextMenuAt}
        items={editMenuItems}
        onClose={() => setContextMenuAt(null)}
      />

      {/* seq editops bot — Select Range… prompt (1-based start..end). */}
      <SequencePromptDialog<{ start: number; end: number }>
        open={selectRangeOpen}
        title="Select Range"
        label="Range (1-based)"
        placeholder="e.g. 100..240"
        helper="Enter start and end positions, e.g. 100..240 or 100-240."
        confirmLabel="Select"
        parse={(raw) => parseSelectRange(raw, doc.seq.length)}
        onConfirm={applySelectRange}
        onClose={() => setSelectRangeOpen(false)}
      />

      {/* seq editops bot — Go To… prompt (1-based coordinate; reuses nav math). */}
      <SequencePromptDialog<number>
        open={goToOpen}
        title="Go To Position"
        label="Position (1-based)"
        placeholder={`1 - ${doc.seq.length.toLocaleString()}`}
        helper={`Jump to a base between 1 and ${doc.seq.length.toLocaleString()}.`}
        confirmLabel="Go"
        parse={(raw) => parseGoTo(raw, doc.seq.length)}
        onConfirm={applyGoTo}
        onClose={() => setGoToOpen(false)}
      />
    </div>
  );
}
