"use client";

// sequence Phase 2a bot — EDITABLE SeqViz view. Same renderer as the read view
// (single-renderer principle), with `editable` turned on so keystrokes splice
// the host-owned document. Layers on a minimal calm toolbar (undo / redo / save)
// and a live selection readout (start..end, length bp, GC%). No autosave: Save
// is an explicit checkpoint.
//
// ── SEQUENCE EDITOR TYPE SCALE (one size per role, SnapGene-calm) ────────────
// This surface is the worked reference for the site-wide semantic type scale
// (see docs/TYPE_SCALE.md). Keep every UI text usage on exactly one of these
// roles via its semantic token; do not reintroduce arbitrary text-[Npx] one-offs.
//   TITLE     text-title (16px), semibold where present. Panel / section titles,
//             the sequence name header. (One exception: the top-most page
//             heading "Sequences" stays text-lg, between text-title and
//             text-heading; left as-is so the swap is pixel-identical.)
//   BODY      text-body (14px). List items, menu items, toolbar / button labels,
//             dialog body text, form controls, primary interactive labels.
//   META      text-meta (12px). Grey subtitles, dates, captions, tab labels,
//             coordinate / selection readouts, helper text, badges, small chrome
//             controls. This tier absorbs all the former 9-13px one-offs.
//   SVG MAP   fontSize 10 = ruler / coordinate numbers, fontSize 11 = feature /
//             primer / enzyme labels. Constant pair, no other SVG label sizes.
// NOTE: the monospace SEQUENCE BASES font is SeqViz-owned (zoom-driven) and is
// out of this scale; do not retune it here. Icon sizes (h-4 w-4 etc.) are not
// font sizes and are unaffected.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  type SelectionReadout,
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useStaleGuardedValue } from "@/hooks/useDebouncedValue";
import {
  historyEngine,
  canonicalize,
  recordSequenceHistory,
  sequencePayload,
  projectSequenceState,
  HISTORY_ENGINE_ENABLED,
  RESTORE_ENABLED,
  HistoryCompactedTargetError,
  SEQUENCES_ENTITY_TYPE,
} from "@/lib/history";
import SequenceConfirmDialog, {
  type SequenceConfirmRequest,
} from "./SequenceConfirmDialog";
import FeaturesPanel from "./FeaturesPanel";
import ViewControlRail from "./ViewControlRail";
import FeatureEditorDialog, {
  type FeatureEditorRequest,
} from "./FeatureEditorDialog";
import AnnotateFromReferenceDialog, {
  type AnnotateFromReferenceRequest,
} from "./AnnotateFromReferenceDialog";
import DetectFeaturesDialog, {
  type DetectFeaturesRequest,
} from "./DetectFeaturesDialog";
// sequence editor master. The opt-in "Enrich from NCBI" dialog (taxonomy +
// organism enrichment) plus the calm organism / lineage line on the sequence.
import EnrichFromNcbiDialog, {
  type EnrichResult,
} from "./EnrichFromNcbiDialog";
import SequenceLineageChip from "./SequenceLineageChip";
import { extractAccession } from "@/lib/sequences/ncbi-datasets";
// menu reorg bot — the library-level Compare/Align dialog, also surfaced from
// the editor's new Analyze menu (a second door; the library-header Compare
// stays). Rendered here with its own open state; not modified.
import CompareSequencesDialog from "./CompareSequencesDialog";
// protein analyze bot — the second door into the protein-properties engine.
import ProteinPropertiesDialog from "./ProteinPropertiesDialog";
// sequence editor master — the third door: a right-docked drawer that opens when
// a coding feature is selected, reflowing the viewer narrower (never overlaying).
import ProteinPropertiesDrawer from "./ProteinPropertiesDrawer";
import { isCodingFeature } from "@/lib/sequences/feature-protein";
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
  derivePrimerSite,
} from "@/lib/sequences/primer-feature";
import { reverseComplement, type BindingSite } from "@/lib/sequences/primer";
// primer bases bot — base-level (zoomed) SnapGene-style primer rendering: map the
// stored oligo onto template columns so annealing bases sit over the template and
// the 5' tail / mismatches pop off.
import { layoutPrimerBases, type PrimerBaseCell } from "@/lib/sequences/primer-base-layout";
import {
  DEFAULT_VIEW_STATE,
  isFeatureVisible,
  COMMON_ENZYMES,
  type SequenceViewState,
} from "./sequence-view-state";
import SequenceZoomControl from "./SequenceZoomControl";
import SequenceOverviewBar, { type OverviewFeature } from "./SequenceOverviewBar";
import SequenceOverviewZoomSlider from "./SequenceOverviewZoomSlider";
import LinearMap, { type LinearMapFeature } from "./LinearMap";
import { spanFromShiftClick, buildFeatureCard, buildPrimerCard } from "@/lib/sequences/linear-map-select";
import SequenceTabBar, { type SequenceViewMode } from "./SequenceTabBar";
import SequenceCoordinateBar from "./SequenceCoordinateBar";
import SequencePrimersPanel from "./SequencePrimersPanel";
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
  frameExtentToSelection,
} from "@/lib/sequences/sequence-zoom";
import {
  EditMenuDropdown,
  SequenceContextMenu,
  SequencePromptDialog,
  type EditMenuItem,
} from "./SequenceEditMenu";
// enhanced find bot — the inline Find box now lives in its own file as the
// SnapGene-style search family (DNA exact + closest-match fallback / by-name /
// protein). It owns mode + query and reports matches up via onResults.
import { SequenceFindBox, type FindResult } from "./SequenceFindBox";
import type { FindMatch } from "@/lib/sequences/find";
import { seqIdentity } from "@/lib/sequences/find";
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
  mapImageFilename,
  mapImageAltText,
  downloadText,
  downloadDataUrl,
  downloadBlob,
} from "@/lib/sequences/export";
import SendToNotePicker from "@/components/SendToNotePicker";
import { attachImageToNote } from "@/lib/attachments/attach-image";
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

const SeqViz = dynamic(() => import("@/vendor/seqviz"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-body text-gray-400">
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
// feature/primer menus bot — toolbar glyphs for the Feature and Primer
// dropdowns. A tag for features, a forward-arrow oligo for primers. Inline SVG
// only (no emojis), matching the rest of the toolbar icon set.
function IconFeatureTag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
// primer colors bot — a clearer SnapGene-style OLIGO glyph: a short oligo/ruler
// bar with a forward arrow riding ABOVE it (5'->3') and a shorter reverse arrow
// tucked BELOW, so the icon reads as "a primer / oligo pair", not two abstract
// arrows. Stroke-only, currentColor, no fill.
function IconPrimer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* the oligo / template bar */}
      <line x1="3" y1="12" x2="21" y2="12" />
      {/* forward primer arrow, above the bar, 3' end pointing right */}
      <path d="M5 8h11" />
      <polyline points="14 5.5 17 8 14 10.5" />
      {/* reverse primer arrow, below the bar, 3' end pointing left */}
      <path d="M19 16H10" />
      <polyline points="12 13.5 9 16 12 18.5" />
    </svg>
  );
}
// top menus consolidation bot — scissors glyph for the new "Enzyme" toolbar
// dropdown. Mirrors the IconEnzymes cut-site icon in ViewControlRail.
function IconScissors({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88" />
      <path d="M14.47 14.48 20 20" />
      <path d="M8.12 8.12 12 12" />
    </svg>
  );
}
// menu reorg bot — a magnifier-over-waveform glyph for the new "Analyze"
// toolbar dropdown (Detect features / Annotate from reference / Compare
// sequences). Inline SVG, matching the rest of the toolbar icon set.
function IconAnalyze({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
      <path d="M8 11h1.5l1.5-2.5L13 13l1-2h2" />
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
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
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

/** selection badge bot — the drag-time FLOATING SELECTION BADGE. A small
 *  absolutely-positioned card anchored inside the viewer's (position: relative)
 *  container, near the cursor. It measures itself after layout and clamps to
 *  the container bounds: it offsets down-right of the cursor by default and
 *  flips up / left when that would overflow the right or bottom edge, so the
 *  card never spills out of the viewer. pointer-events: none keeps it from
 *  intercepting the drag. Content reuses SelectionReadoutContent so range / bp /
 *  GC / the temperature-gradient Tm chip match the bottom strip exactly. */
function FloatingSelectionBadge({
  pointer,
  container,
  readout,
}: {
  pointer: { x: number; y: number };
  container: HTMLElement | null;
  readout: Extract<SelectionReadout, { kind: "range" }>;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: pointer.x + 12,
    top: pointer.y + 16,
  });

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const cw = container?.clientWidth ?? 0;
    const ch = container?.clientHeight ?? 0;
    const bw = card.offsetWidth;
    const bh = card.offsetHeight;
    const offX = 12;
    const offY = 16;
    const margin = 6;
    // Default down-right of the cursor; flip to the other side when the card
    // would overflow the right / bottom edge.
    let left = pointer.x + offX;
    if (cw && left + bw + margin > cw) left = pointer.x - offX - bw;
    let top = pointer.y + offY;
    if (ch && top + bh + margin > ch) top = pointer.y - offY - bh;
    // Final clamp so the card stays inside even in tiny viewers.
    if (cw) left = Math.max(margin, Math.min(left, cw - bw - margin));
    if (ch) top = Math.max(margin, Math.min(top, ch - bh - margin));
    setPos({ left, top });
  }, [pointer.x, pointer.y, container, readout.lo, readout.hi, readout.len, readout.tm]);

  return (
    <div
      ref={cardRef}
      className="pointer-events-none absolute z-30 flex items-center gap-3 rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-meta text-gray-600 shadow-md backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      <SelectionReadoutContent readout={readout} />
    </div>
  );
}

export default function SequenceEditView({
  sequence,
  onSave,
  saving,
  readOnly = false,
  initialViewMode,
  initialShowEnzymes = false,
  embedded = false,
  onEnriched,
}: {
  sequence: SequenceDetail;
  /** persist the current GenBank; resolves true on success. Unused when readOnly. */
  onSave?: (genbank: string) => Promise<boolean>;
  saving?: boolean;
  /** Persist an NCBI enrichment: the rewritten GenBank (organism in the source
   *  feature) plus the organism / tax id / named lineage sidecar fields. The page
   *  writes them and refreshes. Absent in read-only / embedded surfaces. */
  onEnriched?: (result: EnrichResult) => Promise<void>;
  /** When true, the surface is a read-only inspector: no caret/keystroke edit,
   *  no clipboard, no Save, no Add/Edit/Delete feature actions. Selection +
   *  readout still work, and double-clicking a feature opens its READ-ONLY info
   *  popup. Used to embed the same surface where the user can't edit (future
   *  in-note embeds / read-only-shared sequences). */
  readOnly?: boolean;
  /** Seed the bottom-tab view switcher. Default "sequence" (unchanged). Embeds
   *  that want to open on the ring pass "map". Additive, default-preserving. */
  initialViewMode?: SequenceViewMode;
  /** Start with the restriction-enzyme cut-site layer ON. Default off (unchanged).
   *  Used by chemistries where the cut sites ARE the point (restriction / GG). */
  initialShowEnzymes?: boolean;
  /** When true, hide the top editor toolbar row entirely (Copy / Edit / Enzyme /
   *  Export / read-only badge). The view tabs, the left view rail, and the map
   *  itself stay. The "chrome slim" for a preview embed. Default false. */
  embedded?: boolean;
}) {
  const editor = useSequenceEditor(sequence);
  const { doc, annotations: docAnnotations, applyEdit, undo, redo, canUndo, canRedo, dirty } = editor;

  // seq history bot — the signed-in user is the actor credited on a recorded
  // version + the owner folder the history file lives under (the /sequences route
  // edits the current user's own sequences, so owner === actor here).
  const { currentUser } = useCurrentUser();
  const historyActor = currentUser ?? "";
  const historyOwner = currentUser ?? "";

  // Track the live SeqViz selection for the readout.
  const [selection, setSelection] = useState<Selection | null>(null);

  // selection badge bot — drag-time floating badge state. `isDragging` is true
  // only while the mouse button is held down over the viewer (SeqViz owns the
  // actual selection; we only need to know whether a drag is in progress).
  // `dragPointer` is the cursor position relative to the viewer container, used
  // to anchor the badge near the cursor and follow it live.
  const [isDragging, setIsDragging] = useState(false);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);

  // App-scoped molecular clipboard (survives switching open sequences).
  const molClip = useMolecularClipboard();

  // The pending confirmation request (Cut/range-delete/Paste). null = closed.
  const [confirm, setConfirm] = useState<SequenceConfirmRequest | null>(null);

  // Phase 2c — view controls (calm-by-default) + the feature add/edit dialog +
  // the currently-selected feature row, and an externally-driven zoom selection.
  // initialShowEnzymes (additive) starts the cut-site layer ON for embeds where
  // the cut sites are the point (restriction / Golden Gate). Default off keeps
  // the standalone editor's calm-by-default behavior.
  const [view, setView] = useState<SequenceViewState>(
    initialShowEnzymes ? { ...DEFAULT_VIEW_STATE, showEnzymes: true } : DEFAULT_VIEW_STATE,
  );
  // seq nav bot — the SnapGene BOTTOM-TAB view switcher. `viewMode` is the
  // primary "which view" state (Map / Sequence / Features / Primers /
  // History). Restriction enzymes are a rail LAYER, not a tab. The Map +
  // Sequence tabs render the SeqViz viewer (Map = a
  // zoomed-out feature map, Sequence = base-level detail); the rest render their
  // panels in the main content area. This is orthogonal to the left
  // ViewControlRail (which toggles WHAT is drawn on the map).
  const [viewMode, setViewMode] = useState<SequenceViewMode>(initialViewMode ?? "sequence");
  const [featureEditor, setFeatureEditor] = useState<FeatureEditorRequest | null>(null);
  // annotate-from-reference bot — homology-based "transfer features from a
  // reference" dialog (open via the Feature menu).
  const [annotateRef, setAnnotateRef] =
    useState<AnnotateFromReferenceRequest | null>(null);
  const [detectReq, setDetectReq] = useState<DetectFeaturesRequest | null>(null);
  // sequence editor master. The opt-in "Enrich from NCBI" dialog open state.
  const [enrichOpen, setEnrichOpen] = useState(false);
  // menu reorg bot — the Compare/Align dialog, opened from the new Analyze menu
  // (a second door into the same library-level dialog the library header opens).
  const [compareOpen, setCompareOpen] = useState(false);
  // protein analyze bot — the Analyze > Protein properties dialog.
  const [proteinPropsOpen, setProteinPropsOpen] = useState(false);
  // menu reorg bot — a nonce the Primer menu's "Check specificity..." item bumps
  // to switch the Primers tab onto its Check (specificity) view directly.
  const [primersCheckNonce, setPrimersCheckNonce] = useState(0);
  const [selectedFeatureIdx, setSelectedFeatureIdx] = useState<number | null>(null);
  // sequence editor master — the protein-properties drawer is dismissable with
  // its X without clearing the feature selection. We track the dismissed feature
  // index so reselecting the SAME coding feature reopens it, and selecting a
  // DIFFERENT coding feature opens fresh. Cleared whenever the selection changes
  // to a new index (see the effect below).
  const [proteinDrawerDismissedIdx, setProteinDrawerDismissedIdx] = useState<
    number | null
  >(null);
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
  // map select bot — the ANCHOR feature range of the current Map selection (the
  // first-selected feature). A plain Map click sets it; a SHIFT-click on the Map
  // spans from this anchor through the clicked feature. Null when no Map-driven
  // selection is active.
  const [selAnchor, setSelAnchor] = useState<{ start: number; end: number } | null>(null);

  // circular qol bot — HOVER state for the CIRCULAR (plasmid) map, mirroring the
  // linear Map's hover affordances. While a feature arc on the ring is hovered we
  // carry the resolved doc-feature INDEX (for the card content + the preview-arc
  // range) and the card's already-clamped {left, top} (px, relative to the
  // viewer container) so the floating info card follows the cursor. Null on
  // mouse-leave clears both the card and the red preview arc.
  const [circularHover, setCircularHover] = useState<{ idx: number; left: number; top: number } | null>(null);
  // primer hover bot — HOVER state for a PRIMER marker on the ring. Mirrors the
  // linear Map's primer hover card: it carries the primer identity (name +
  // binding span, for the coords/length/%GC/Tm card) and the clamped {left, top}.
  // Separate from circularHover because primers use the primer card, not the
  // feature card. Null on mouse-leave clears it.
  const [circularPrimerHover, setCircularPrimerHover] = useState<{
    primer: { name: string; start: number; end: number };
    left: number;
    top: number;
  } | null>(null);
  // circular qol bot — drop a lingering hover card / preview arc on a molecule
  // swap or a tab switch (the ring unmounts, so no mouse-leave would fire).
  useEffect(() => {
    setCircularHover(null);
    setCircularPrimerHover(null);
  }, [sequence.id, viewMode]);

  // seq editops bot — Edit-menu plumbing. The right-click context menu position
  // (null = closed), the Find box (open + query + match results + active match),
  // and the Select Range / Go To prompt dialogs.
  const [contextMenuAt, setContextMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  // enhanced find bot — the box owns its query + mode internally and reports the
  // computed match list up here (FindMatch carries direction + an optional label
  // for the closest-match readout). `findIsClose` flags an approximate DNA
  // fallback so the highlight color can differ from an exact hit.
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findActive, setFindActive] = useState(0);
  const [findIsClose, setFindIsClose] = useState(false);
  // debounce-perf bot — STALE GUARD KEY. The identity of the sequence revision
  // `findMatches` were computed against (reported by the debounced Find box).
  // Find positions are absolute, so an edit shifts them; we render / select a
  // match ONLY while this still equals the live sequence's identity. The moment
  // the live sequence diverges (an edit landed but the debounced rescan has not
  // caught up) the matches are treated as PENDING and nothing stale is painted,
  // rather than risking a highlight at an off-by-shift position.
  const [findMatchesKey, setFindMatchesKey] = useState<string>("");
  const [selectRangeOpen, setSelectRangeOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);

  // map to note bot — "Send map image to a note" flow. `mapToNotePng` holds the
  // captured PNG data URL while the note picker is open (null = picker closed).
  // `mapToNoteStatus` drives the calm success banner after the attach lands.
  const [mapToNotePng, setMapToNotePng] = useState<string | null>(null);
  const [mapToNoteBusy, setMapToNoteBusy] = useState(false);
  const [mapToNoteStatus, setMapToNoteStatus] = useState<
    { noteTitle: string } | null
  >(null);
  // Auto-dismiss the success banner after a few seconds (the user can also
  // dismiss it manually). Re-armed on each new success.
  useEffect(() => {
    if (!mapToNoteStatus) return;
    const t = setTimeout(() => setMapToNoteStatus(null), 6000);
    return () => clearTimeout(t);
  }, [mapToNoteStatus]);

  // Normalized [lo, hi) of the current selection, and the caret (paste point).
  const sel = useMemo(() => {
    if (!selection || typeof selection.start !== "number" || typeof selection.end !== "number") {
      return { lo: 0, hi: 0, hasRange: false, caret: 0 };
    }
    const lo = Math.min(selection.start, selection.end);
    const hi = Math.max(selection.start, selection.end);
    return { lo, hi, hasRange: hi > lo, caret: lo };
  }, [selection]);

  // map select bot — the selection the LinearMap draws as a band + that persists
  // across the Map / Sequence tabs. It is the SHARED editor selection, preferring
  // a feature-zoom / Map selection (externalSel) but falling back to the user's
  // active drag RANGE made in the Sequence view (sel.hasRange) so a selection made
  // in either view shows on the Map. Null (no range) draws no band.
  const mapSelection = useMemo(() => {
    if (externalSel) return externalSel;
    if (sel.hasRange) return { start: sel.lo, end: sel.hi };
    return null;
  }, [externalSel, sel.hasRange, sel.lo, sel.hi]);

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

  // debounce-perf bot — a CHEAP identity (length + hash) of the LIVE sequence,
  // computed once and shared by every stale guard (debounced ORF tracks + the
  // Find match guard). Absolute-position derivations are only valid for the exact
  // revision they were computed against; comparing this key rejects any stale
  // result before it can be painted at shifted coordinates.
  const liveSeqKey = useMemo(() => seqIdentity(doc.seq), [doc.seq]);

  // CDS-feature translation tracks (opt-in). These come from `doc.features`,
  // whose coordinates the editor shifts ATOMICALLY with the bases on each edit,
  // so they are always in sync with the live sequence and stay LIVE (cheap).
  const cdsTranslations: TranslationProp[] = useMemo(() => {
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
    return out;
  }, [doc.features, view.showTranslation]);

  // debounce-perf bot — ORF overlay tracks are COMPUTED from the WHOLE sequence
  // (ATG-to-stop runs), an ~O(n) scan that re-ran on every keystroke when the
  // layer was on. DEBOUNCE it keyed on the live sequence identity, and STALE-
  // GUARD it: ORF spans are absolute positions, so a scan over an old revision
  // must never be drawn against the edited sequence (shifted = wrong arrows).
  // The input carries the layer toggle too, so flipping it off settles to [] and
  // flipping it on triggers a rescan. `value` is null while a recompute is owed;
  // we simply omit ORFs until the settled scan reports tracks keyed to the live
  // sequence (the `findOrfs` math itself is unchanged — only WHEN it runs).
  const orfTranslations = useStaleGuardedValue<
    { seq: string; on: boolean },
    TranslationProp[]
  >(
    useMemo(() => ({ seq: doc.seq, on: view.showOrfs }), [doc.seq, view.showOrfs]),
    // Key derived PURELY from the input arg (never the live closure) so the
    // effect tags the result with the SAME revision it scanned. Reuse the cached
    // liveSeqKey only when the arg IS the live seq (the common case); otherwise
    // hash the arg's own bases.
    (inp) => (inp.on ? `on:${inp.seq === doc.seq ? liveSeqKey : seqIdentity(inp.seq)}` : "off"),
    (inp) =>
      !inp.on
        ? []
        : findOrfs(inp.seq).map((o) => ({
            start: o.start,
            end: o.end,
            direction: o.strand,
            name: "ORF",
            color: "#94a3b8",
            orf: true,
          })),
    200,
  );

  // Translation tracks fed to the renderer: live CDS tracks plus the debounced/
  // stale-guarded ORF tracks (omitted while a rescan is pending, never shown at
  // stale positions). SeqViz renders these as its translation primitive.
  const translations: TranslationProp[] = useMemo(
    () => [...cdsTranslations, ...(orfTranslations.value ?? [])],
    [cdsTranslations, orfTranslations.value],
  );

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
      return [] as {
        name: string;
        start: number;
        end: number;
        direction: 1 | -1;
        color: string;
        baseCells?: PrimerBaseCell[];
        tailLength?: number;
      }[];
    return doc.features
      .filter((f) => (f.type || "").toLowerCase() === "primer_bind")
      .map((f) => {
        const direction = (f.strand === -1 ? -1 : 1) as 1 | -1;
        // primer bases bot — read the stored 5'->3' oligo (the /note "primer
        // <SEQ>" flag) and map it onto template columns so the zoomed viewer can
        // draw the annealing bases over the template + the 5' tail / mismatches
        // popped off. The feature's start/end already record the ANNEALED span,
        // but we re-derive the BindingSite from the oligo so we recover the
        // annealedLength + tail length + mismatch columns the feature does not
        // store.
        let baseCells: PrimerBaseCell[] | undefined;
        let tailLength: number | undefined;
        const storedOligo = readPrimerSeq(f);
        if (storedOligo) {
          // A primer with an explicit 5'->3' oligo note can carry a 5' tail
          // (cloning overhang) and internal mismatches, so we have to DISCOVER
          // which sub-region actually anneals and how long the tail is. Re-derive
          // the BindingSite against the template the same way the Check view does.
          const site = derivePrimerSite(storedOligo, doc.seq);
          if (site) {
            const layout = layoutPrimerBases(storedOligo, site);
            if (layout) {
              baseCells = layout.cells;
              tailLength = layout.tailLength;
            }
          }
        } else {
          // primer bases FIX (2026-06-04) — the COMMON case. Most primers in real
          // files (imported .dna/GenBank, or ones marked only as a binding region)
          // carry NO oligo note, so readPrimerSeq returned nothing and the renderer
          // drew a bare arrow with no bases (the FAD-5F bug Grant hit). Treat a
          // note-less primer as a clean full-length annealer whose oligo IS the
          // template over its recorded binding span (reverse-complemented for a
          // reverse primer, since the oligo reads 5'->3' on the bottom strand).
          //
          // PIN the layout straight to the recorded span instead of re-searching
          // with derivePrimerSite. We already KNOW where it binds, so building the
          // BindingSite directly guarantees the bases sit exactly on the stored
          // span (and the arrow) and removes the repeat-ambiguity risk where
          // findBindingSites could otherwise lock onto a duplicate of a short
          // region elsewhere in the molecule. No tail, no mismatches by construction.
          const lo = Math.min(f.start, f.end);
          const hi = Math.max(f.start, f.end);
          const region = doc.seq.slice(lo, hi);
          if (region.length > 0) {
            const oligo = direction === -1 ? reverseComplement(region) : region;
            const site: BindingSite = {
              start: lo,
              end: hi,
              direction,
              annealedLength: hi - lo,
              fullMatch: true,
            };
            const layout = layoutPrimerBases(oligo, site);
            if (layout) {
              baseCells = layout.cells;
              tailLength = layout.tailLength;
            }
          }
        }
        return {
          name: f.name,
          start: f.start,
          end: f.end,
          direction,
          // primer style bot — carry the primer color (pink, from feature-colors)
          // so the thin-bracket/marker renderer keeps it instead of SeqViz's
          // arbitrary colorByIndex fallback.
          color: f.color || colorForType("primer_bind"),
          baseCells,
          tailLength,
        };
      });
  }, [doc.features, doc.seq, view.showPrimers]);

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
    (
      name: string,
      primerSeq: string,
      site: { start: number; end: number; direction: 1 | -1 },
      // primer colors bot — optional per-primer color, persisted on the
      // primer_bind feature (via addFeature's color -> ApEinfo notes). Undefined
      // falls back to the default primer color when the map derives `primers`.
      color?: string,
    ) => {
      editor.applyDocEdit((prev) =>
        addFeature(prev, {
          name: name || "primer",
          type: "primer_bind",
          strand: site.direction === -1 ? -1 : 1,
          start: site.start,
          end: site.end,
          color: color && color.trim() ? color.trim() : undefined,
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

  // menu reorg bot — open the Add-Primer dialog. `mode` picks the flow the dialog
  // OPENS in: "standard" (type/paste) for "Add Primer...", or "mutagenesis" (SDM)
  // for the Primer menu's "Design mutagenesis primer..." item. Both seed from the
  // current selection (bases + range, so the SDM target lands on the selection).
  const openPrimerDialog = useCallback(
    (mode: "standard" | "mutagenesis" = "standard") => {
      const seedSeq = sel.hasRange ? doc.seq.slice(sel.lo, sel.hi) : "";
      setPrimerRequest({
        template: doc.seq,
        seedSeq,
        seedRange: sel.hasRange ? { lo: sel.lo, hi: sel.hi } : undefined,
        seedName: "",
        initialMode: mode,
        onSubmit: ({ name, primerSeq, site, color }) => {
          addPrimerFeature(name, primerSeq, site, color);
          setPrimerRequest(null);
        },
        onCancel: () => setPrimerRequest(null),
      });
    },
    [doc.seq, sel, addPrimerFeature],
  );

  // menu reorg bot — jump the Primers tab onto its Check (specificity) view. The
  // nonce bump re-applies the mode even when the Primers tab is already mounted.
  const openSpecificityCheck = useCallback(() => {
    setViewMode("primers");
    setPrimersCheckNonce((n) => n + 1);
  }, []);

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
  // linear map bot — the LINEAR MAP render path. In Map mode a LINEAR molecule
  // now renders the dedicated SnapGene-style single-line LinearMap (one strand
  // fit to width + ruler + feature arrows below + enzyme/primer labels above)
  // INSTEAD of SeqViz's wrapped MAP_ZOOM rows. The Sequence view, the circular
  // ring, and the wrap toggle are untouched.
  const linearMapMode = isLinearViewer && isMapView;
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

  // selection badge bot — end the drag on mouse-up ANYWHERE (release can land
  // outside the viewer after a fast drag), so the floating badge always hides
  // on release. The button-down side is set by the viewer's onMouseDown.
  useEffect(() => {
    if (!isDragging) return;
    const end = () => setIsDragging(false);
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, [isDragging]);
  const [overviewWindow, setOverviewWindow] = useState<{ start: number; end: number }>({
    start: 0,
    end: doc.seq.length,
  });
  // overview zoom bot — the overview bar's OWN bp EXTENT (its independent zoom),
  // decoupled from the detail-view linearZoom. Defaults to the whole molecule so
  // the bar opens exactly as before. Scroll / pinch over the bar narrows or
  // widens it (onExtentChange), and a Map selection that lands in Sequence view
  // FRAMES it around the selected range. Reset to whole-molecule on seq swap.
  const [overviewExtent, setOverviewExtent] = useState<{ start: number; end: number }>({
    start: 0,
    end: doc.seq.length,
  });
  // seq polish batch bot — FIX 3 (bp-readout flicker): the window above is seeded
  // to the WHOLE molecule, but the true visible window is only known after the
  // SeqViz scroller lays out (a frame or two later). Without gating, the bottom
  // bp readout / bp-in-view field flash the whole-molecule span for one frame on
  // first paint + on every Map<->Sequence toggle, then snap to the measured
  // window. This flag flips true on the first successful recompute so the readout
  // can hold until the real window is known. It is reset whenever the renderer is
  // about to re-measure from scratch (sequence swap / view-mode change).
  const [windowMeasured, setWindowMeasured] = useState(false);

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
      setWindowMeasured(true);
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
    setWindowMeasured(true);
  }, [doc.seq.length, singleLine]);

  // seq polish batch bot — FIX 3: reset the measured flag whenever the renderer
  // is about to re-measure from scratch, so the bp readout holds until the new
  // visible window is known instead of flashing the seeded whole-molecule span.
  // Triggers: sequence swap, Map<->Sequence toggle, wrap toggle. The rAF burst
  // below re-measures within a frame or two and flips the flag back on.
  useEffect(() => {
    setWindowMeasured(false);
  }, [sequence.id, viewMode, singleLine]);

  // overview zoom bot — reset the overview bar's independent extent to the whole
  // molecule whenever the open sequence changes, so a new molecule opens at full
  // overview rather than inheriting the previous one's zoomed extent.
  useEffect(() => {
    setOverviewExtent({ start: 0, end: doc.seq.length });
  }, [sequence.id, doc.seq.length]);

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
      // SeqViz scroller as a normal scroll. A macOS trackpad pinch surfaces as a
      // wheel event with ctrlKey true; we also accept metaKey to mirror the Map's
      // pinch handler (LinearMap.tsx) and cover stray ⌘+wheel configs.
      if (!e.ctrlKey && !e.metaKey) {
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
          // Floor the pinch result to the Sequence view's range (the SAME clamp the
          // slider uses) so pinch and slider stay perfectly in sync. Without this,
          // a long contig (whose auto zoom can be < SEQUENCE_MIN_LINEAR_ZOOM) lets
          // the stored zoom sink into the 1..11 band that clampSequenceZoom pins at
          // the floor — so pinching produced NO visible change (the reported bug).
          const next = clampSequenceZoom(pinchDeltaToZoom(current, e.deltaY));
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
          // Same Sequence-view floor as the wheel path so pinch == slider range.
          return { ...v, linearZoom: clampSequenceZoom(pinchDeltaToZoom(current, deltaY)) };
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

  // map select bot follow-up — when the user ENTERS the base Sequence view (e.g.
  // from the Map) with an active selection, land them at the START of the
  // selection instead of bp 1, so the detail view shows where they were looking.
  // SeqViz restores its own scrollTop a frame or two after the view swap
  // (InfiniteScroll.scrollToCentralIndex), so a one-shot scroll gets clobbered;
  // re-assert the target each frame for a short window (same burst pattern the
  // recompute loop uses). Only fires on the transition INTO the sequence view,
  // not on selection changes made while already in it (so a base-view drag-select
  // never yanks the scroll).
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (viewMode !== "sequence" || prev === "sequence") return;
    if (!isLinearViewer || !externalSel) return;
    // overview frame — this is the VIEW TRANSITION into the Sequence view (e.g.
    // coming from the Map) with an active selection, which is DIFFERENT from a
    // feature click made while already in the Sequence view (that is guarded out
    // above and deliberately does not reframe). On the transition, frame the
    // overview bar to the selection so the user lands looking at their region.
    setOverviewExtent(
      frameExtentToSelection({ selection: externalSel, seqLength: doc.seq.length }),
    );
    const startBp = Math.min(externalSel.start, externalSel.end);
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      scrollMainToBp(startBp);
      if (performance.now() - start < 260) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewMode, isLinearViewer, externalSel, scrollMainToBp, doc.seq.length]);

  // Features projected to the overview bar (whole sequence, as arrows). Uses the
  // same visibility filtering as the main map so hidden types stay hidden.
  // overview featclick bot — resolve each annotation back to its index in the
  // source `doc.features` list (the index `selectFeature` consumes). Annotations
  // drop `primer_bind` + carry no index, so key by name|start|end (the same
  // fallback chain handleMapFeatureClick uses). First-match wins on duplicate
  // keys, consistent with the Map's findIndex.
  const featureIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    doc.features.forEach((f, i) => {
      const key = `${f.name}|${f.start}|${f.end}`;
      if (!m.has(key)) m.set(key, i);
    });
    return m;
  }, [doc.features]);

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
          index: featureIndexByKey.get(`${a.name}|${a.start}|${a.end}`),
        })),
    [docAnnotations, view, featureIndexByKey],
  );

  // linear map bot — features for the SnapGene-style single-line LinearMap (the
  // linear Map render path). Same visibility filtering + the SAME color/coords as
  // the SeqViz annotations, but it ALSO carries `segments` so multi-exon (join)
  // features draw exon boxes + dashed intron connectors. No recompute of data:
  // these are the existing docAnnotations projected to the LinearMap shape.
  // map select bot — also resolve a /product or /note qualifier from doc.features
  // (keyed by name+start+end) so the Map's hover info card can show it. The note
  // is a read-only display field; it is not part of the on-disk annotation shape.
  const featureNoteByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of doc.features) {
      const notes = (f.notes as Record<string, unknown>) || undefined;
      if (!notes) continue;
      const pick = (k: string): string | undefined => {
        const v = notes[k];
        if (Array.isArray(v) && v.length > 0) return String(v[0]);
        if (typeof v === "string" && v.trim()) return v;
        return undefined;
      };
      const text = pick("product") || pick("note") || pick("gene");
      if (text) m.set(`${f.name}|${f.start}|${f.end}`, text);
    }
    return m;
  }, [doc.features]);

  const linearMapFeatures: LinearMapFeature[] = useMemo(
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
        .map((a) => {
          const note = featureNoteByKey.get(`${a.name}|${a.start}|${a.end}`);
          return {
            name: a.name,
            start: a.start,
            end: a.end,
            direction: (a.direction === -1 ? -1 : 1) as 1 | -1,
            color: a.color,
            type: a.type,
            ...(a.segments && a.segments.length > 1 ? { segments: a.segments } : {}),
            ...(note ? { note } : {}),
          };
        }),
    [docAnnotations, view, featureNoteByKey],
  );

  const handleSave = useCallback(async () => {
    if (readOnly || !onSave) return;
    const { documentToGenbank, documentFromDetail } = await import(
      "@/lib/sequences/edit-model"
    );
    const gb = documentToGenbank(doc);
    if (!gb) {
      // Serialization failed — refuse to write a corrupt round-trip.
      // eslint-disable-next-line no-alert
      alert("Could not serialize this sequence to GenBank. Save aborted.");
      return;
    }
    const ok = await onSave(gb);
    if (ok) {
      editor.commitSaved();
      // seq history bot — record this Save as a permanent, restorable version.
      // Best-effort + AFTER the .gb write (recordSequenceHistory swallows its own
      // errors so a history-write failure never affects the save). The prev state
      // is the on-disk molecule this Save overwrote (the loaded detail), next is
      // the just-saved doc. The engine's empty-delta short-circuit drops a no-op.
      if (HISTORY_ENGINE_ENABLED && historyOwner) {
        const prevDoc = documentFromDetail(sequence);
        void recordSequenceHistory({
          type: "update",
          id: sequence.id,
          owner: historyOwner,
          actor: historyActor,
          prevState: prevDoc,
          nextState: doc,
        });
      }
    }
  }, [doc, onSave, editor, readOnly, sequence, historyOwner, historyActor]);

  // seq history bot — the canonical tracked state of the LIVE molecule, threaded
  // to the History panel so the engine can resolve a bare-genesis anchor (a
  // sequence first versioned on top of a pre-existing .gb) when reconstructing
  // each version. Recomputed when the doc changes.
  const headCanonical = useMemo(() => canonicalize(sequencePayload(doc)), [doc]);

  // seq history bot — RESTORE a version from the History tab. Reverse-walk from
  // the LIVE HEAD canonical to the target version, rebuild the editor doc from
  // the reconstructed tracked state, load it into the editor (a single undo step
  // via applyDocEdit), persist the .gb, and record a "revert" row so the timeline
  // shows "Restored an earlier version" and the restore is itself revertible.
  //
  // Fidelity note: the tracked state carries the bases, topology, name, and the
  // recognized feature fields (name / type / strand / span). Per-feature
  // qualifier notes + colors are intentionally not versioned (they would churn
  // every diff), so a restored feature comes back without those extras.
  const handleRestoreVersion = useCallback(
    async (versionIndex: number) => {
      if (readOnly || !onSave || !RESTORE_ENABLED || !historyOwner) return;
      try {
        const rows = await historyEngine.readHistory(
          SEQUENCES_ENTITY_TYPE,
          historyOwner,
          sequence.id,
        );
        if (rows.length === 0) return;
        const headCanon = canonicalize(sequencePayload(doc));
        let targetCanonical: string;
        try {
          targetCanonical = historyEngine.reverseWalkTo(rows, versionIndex, headCanon);
        } catch (err) {
          if (err instanceof HistoryCompactedTargetError) {
            console.warn(
              `[history] sequence restore target ${versionIndex} was summarized for ${SEQUENCES_ENTITY_TYPE}/${sequence.id}; cannot restore exactly`,
            );
            return;
          }
          throw err;
        }
        const target = projectSequenceState(targetCanonical);
        // Reconstruct the tracked state object (the projection drops the raw
        // feature list shape, so re-parse the canonical for the features).
        let trackedFeatures: {
          name: string;
          type: string;
          strand: 1 | -1;
          start: number;
          end: number;
        }[] = [];
        try {
          const parsed = JSON.parse(targetCanonical) as {
            features?: typeof trackedFeatures;
          };
          if (Array.isArray(parsed.features)) trackedFeatures = parsed.features;
        } catch {
          /* tolerate: restore bases + metadata even if features fail to parse */
        }

        const { documentToGenbank } = await import("@/lib/sequences/edit-model");
        // Load the restored state into the editor as one undo step.
        editor.applyDocEdit((prev) => ({
          ...prev,
          name: target.name || prev.name,
          seq: target.seq,
          circular: target.circular,
          features: trackedFeatures.map((f) => ({
            name: f.name,
            type: f.type,
            strand: f.strand,
            forward: f.strand !== -1,
            start: f.start,
            end: f.end,
          })),
        }));

        // Persist the restored molecule + record the "revert" row. We rebuild the
        // GenBank from the restored fields directly (applyDocEdit's setState has
        // not flushed yet, so we cannot read the new `doc` synchronously here).
        const restoredDoc = {
          name: target.name || doc.name,
          seq: target.seq,
          seqType: doc.seqType,
          circular: target.circular,
          features: trackedFeatures.map((f) => ({
            name: f.name,
            type: f.type,
            strand: f.strand,
            forward: f.strand !== -1,
            start: f.start,
            end: f.end,
          })),
        };
        const gb = documentToGenbank(restoredDoc);
        if (!gb) return;
        // Record the "revert" row FIRST (awaited) so the panel's re-read — which
        // fires when onSave's refetch changes headCanonical — already sees the
        // new HEAD row labeled "Restored an earlier version". prev = the live
        // molecule we are reverting FROM, next = the restored molecule.
        await recordSequenceHistory({
          type: "revert",
          id: sequence.id,
          owner: historyOwner,
          actor: historyActor,
          prevState: doc,
          nextState: restoredDoc,
          revertTargetVersion: versionIndex,
        });
        // Persist the .gb. The parent invalidates the sequence query, which
        // re-feeds the restored detail and RE-SEEDS the editor (savedRef =
        // restored doc), so the dirty flag clears cleanly — we deliberately do
        // NOT call commitSaved here (its closure `doc` is the pre-restore doc, so
        // it would set a stale saved baseline and leave the editor "unsaved").
        await onSave(gb);
      } catch (err) {
        console.error("[SequenceEditView] restore failed:", err);
      }
    },
    [readOnly, onSave, historyOwner, historyActor, sequence.id, doc, editor],
  );

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
      // map select bot — a plain feature select sets the span ANCHOR to this
      // feature's own range, so a subsequent Map shift-click spans from here.
      setSelAnchor({ start: f.start, end: f.end });
      // NOTE: selecting a feature deliberately does NOT re-zoom the overview bar
      // (no frameExtentToSelection). Selection just highlights; the overview keeps
      // whatever zoom the user set, and zooming the top bar stays a manual choice
      // (slider / scroll over the bar). Whole-molecule reset still happens on seq swap.
    },
    [doc.features],
  );

  // overview featclick bot — CLICK A FEATURE in the TOP OVERVIEW STRIP -> SELECT
  // it (its range), reusing the shared `selectFeature` path (externalSel +
  // selectedFeatureIdx + the selection band), exactly like the Map's feature
  // click. It does NOT change the view mode, so the user stays where they are.
  // A bare-track click in the strip keeps the existing scroll-to-bp behavior.
  const handleOverviewFeatureClick = useCallback(
    (feature: OverviewFeature, mods: { shiftKey: boolean }) => {
      // Resolve the feature's index (carried index first, then name+range fallback
      // for duplicate-key annotations, like handleMapFeatureClick).
      let idx =
        typeof feature.index === "number" && feature.index >= 0 ? feature.index : -1;
      if (idx < 0) {
        idx = doc.features.findIndex(
          (f) => f.name === feature.name && f.start === feature.start && f.end === feature.end,
        );
        if (idx < 0) idx = doc.features.findIndex((f) => f.name === feature.name);
      }
      if (idx < 0) return;
      const f = doc.features[idx];
      if (!f) return;
      // SHIFT-click extends from the span anchor through this feature (mirrors the
      // Map's shift-span); a plain click selects just this feature + sets anchor.
      if (mods.shiftKey && selAnchor) {
        const span = spanFromShiftClick(selAnchor, { start: f.start, end: f.end });
        setSelectedFeatureIdx(idx);
        setExternalSel(span);
        return;
      }
      selectFeature(idx);
    },
    [doc.features, selAnchor, selectFeature],
  );

  // Shift-click on the overview's BARE track extends the current selection to the
  // clicked bp (matches the Map's shift behavior). Anchor = the feature/selection
  // origin; if only a free-hand area is selected (no feature anchor), use that as
  // the anchor and stabilize it so further shift-clicks keep extending from it.
  const handleOverviewShiftSelectToBp = useCallback(
    (bp: number) => {
      const anchor =
        selAnchor ?? externalSel ?? (sel.hasRange ? { start: sel.lo, end: sel.hi } : null);
      if (!anchor) return;
      if (!selAnchor) setSelAnchor(anchor);
      const span = spanFromShiftClick(anchor, { start: bp, end: bp });
      setSelectedFeatureIdx(null);
      setExternalSel(span);
    },
    [selAnchor, externalSel, sel.hasRange, sel.lo, sel.hi],
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

  // annotate-from-reference bot — open the "transfer features from a reference"
  // dialog. On confirm, add every chosen proposed feature in ONE undoable edit
  // by folding the addFeature calls through a single applyDocEdit transform.
  const openAnnotateFromReference = useCallback(() => {
    setAnnotateRef({
      openSeq: doc.seq,
      currentSeqId: sequence.id,
      onApply: (features: FeatureDraft[]) => {
        if (features.length > 0) {
          editor.applyDocEdit((prev) =>
            features.reduce((acc, draft) => addFeature(acc, draft), prev),
          );
        }
        setAnnotateRef(null);
      },
      onCancel: () => setAnnotateRef(null),
    });
  }, [doc.seq, sequence.id, editor]);

  // feature detect bot — open the "detect common features" dialog. It scans the
  // open DNA against the bundled protein feature DB (fluorescent proteins,
  // markers, fusion + epitope tags) by translating ORFs on both strands, then
  // adds every chosen hit in ONE undoable edit (same fold-through-applyDocEdit
  // path as annotate-from-reference).
  const openDetectFeatures = useCallback(() => {
    setDetectReq({
      openSeq: doc.seq,
      onApply: (features: FeatureDraft[]) => {
        if (features.length > 0) {
          editor.applyDocEdit((prev) =>
            features.reduce((acc, draft) => addFeature(acc, draft), prev),
          );
        }
        setDetectReq(null);
      },
      onCancel: () => setDetectReq(null),
    });
  }, [doc.seq, editor]);

  // sequence editor master — apply accepted protein-domain hits (from the
  // opt-in EBI InterProScan handoff in the CDS protein drawer) as features in ONE
  // undoable edit, the same fold-through-applyDocEdit path as detect-features.
  const addDomainFeatures = useCallback(
    (drafts: FeatureDraft[]) => {
      if (drafts.length === 0) return;
      editor.applyDocEdit((prev) =>
        drafts.reduce((acc, draft) => addFeature(acc, draft), prev),
      );
    },
    [editor],
  );

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
        // primer colors bot — seed the color picker from the primer's explicit
        // color (empty when it has none, so the picker shows "use default").
        initialColor: f.color ?? "",
        readOnly,
        onSubmit: ({ name, description, oligo, phosphorylated, site, color }) => {
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
              // primer colors bot — persist the chosen color (empty -> default).
              color: color && color.trim() ? color.trim() : undefined,
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

  // linear map bot — DOUBLE-CLICK A PRIMER on the linear map -> open the Edit
  // Primer dialog. Primers are NOT in the annotation layer (they render via the
  // dedicated primer renderer), so the LinearMap reports the primer by
  // (name, start, end); we resolve it back to its primer_bind feature index and
  // route through the SAME openEditPrimer the rest of the editor uses.
  const handlePrimerDoubleClick = useCallback(
    (range: { name: string; start: number; end: number }) => {
      let index = doc.features.findIndex(
        (f) =>
          (f.type || "").toLowerCase() === "primer_bind" &&
          f.name === range.name &&
          f.start === range.start &&
          f.end === range.end,
      );
      if (index < 0)
        index = doc.features.findIndex(
          (f) => (f.type || "").toLowerCase() === "primer_bind" && f.name === range.name,
        );
      if (index < 0) return;
      openEditPrimer(index);
    },
    [doc.features, openEditPrimer],
  );

  // map select bot — CLICK A FEATURE on the linear Map. The Map NEVER changes
  // the view mode; it only sets the SHARED editor selection (externalSel +
  // selectedFeatureIdx), which highlights in the base SeqViz view and frames the
  // overview bar, and persists across the Map / Sequence tabs.
  //   - a PLAIN click selects that one feature and resets the span anchor;
  //   - a SHIFT-click extends the selection to span the anchor (first-selected)
  //     feature through the clicked feature, [min(anchor.start, clicked.start),
  //     max(anchor.end, clicked.end)], keeping the anchor for further shift-clicks.
  // Resolves the clicked range back to a doc feature via the same fallback chain
  // as handleAnnotationDoubleClick so a normalized coordinate still maps right.
  const handleMapFeatureClick = useCallback(
    (
      range: { name: string; start: number; end: number; direction?: number },
      mods: { shiftKey: boolean },
    ) => {
      let index = doc.features.findIndex(
        (f) => f.name === range.name && f.start === range.start && f.end === range.end,
      );
      if (index < 0) index = doc.features.findIndex((f) => f.name === range.name);
      if (index < 0) index = doc.features.findIndex((f) => f.start === range.start);
      if (index < 0) return;
      const f = doc.features[index];
      if (!f) return;

      if (mods.shiftKey && selAnchor) {
        // SPAN from the anchor through this feature. The anchor is preserved so a
        // further shift-click keeps extending from the same origin.
        const span = spanFromShiftClick(selAnchor, { start: f.start, end: f.end });
        setSelectedFeatureIdx(index);
        setExternalSel(span);
        // No overview re-zoom on a shift-span select either; the band shows at the
        // user's current overview zoom, which stays a manual control.
        return;
      }
      // Plain click: select just this feature and (re)set the anchor to it.
      selectFeature(index);
    },
    [doc.features, doc.seq.length, selAnchor, selectFeature],
  );

  // map select bot — CLICK EMPTY TRACK / RULER / BACKBONE on the linear Map ->
  // CLEAR the selection (deselect). No navigation, no view-mode change. Drops the
  // shared selection (externalSel + selectedFeatureIdx) and the span anchor so
  // the selection band disappears in both the Map and the Sequence view.
  const handleMapClearSelection = useCallback(() => {
    setExternalSel(null);
    setSelectedFeatureIdx(null);
    setSelAnchor(null);
  }, []);

  // map drag bot — CLICK-DRAG a bp RANGE on the linear Map. Fires live while
  // dragging (so the band + base view + overview all follow) and once on
  // pointer-up to finalize. It writes the SHARED selection (externalSel) so the
  // range stays in sync everywhere, drops any feature highlight (a freehand range
  // is not a feature), and sets the span ANCHOR to a zero-width range at the drag
  // ORIGIN so a later Map shift-click extends from where the drag began. The Map
  // never changes the view mode.
  const handleMapDragSelect = useCallback(
    (range: { start: number; end: number }, anchorBp: number) => {
      setExternalSel(range);
      setSelectedFeatureIdx(null);
      setSelAnchor({ start: anchorBp, end: anchorBp });
    },
    [],
  );

  // circular qol bot — resolve a clicked/hovered CIRCULAR annotation range back to
  // its doc-feature INDEX, using the SAME name+range -> name -> start fallback
  // chain as handleMapFeatureClick so a normalized coordinate still maps right.
  const resolveCircularFeatureIdx = useCallback(
    (range: { name: string; start: number; end: number }): number => {
      let index = doc.features.findIndex(
        (f) => f.name === range.name && f.start === range.start && f.end === range.end,
      );
      if (index < 0) index = doc.features.findIndex((f) => f.name === range.name);
      if (index < 0) index = doc.features.findIndex((f) => f.start === range.start);
      return index;
    },
    [doc.features],
  );

  // circular qol bot — HOVER a feature arc on the CIRCULAR ring. Mirrors the
  // linear Map: it stores the resolved doc-feature index (for the info-card
  // content + the red preview-arc range) and the card's clamped {left, top}
  // (px, relative to the viewer container). A null range (mouse-leave) clears
  // both the card and the preview arc. The card position is clamped on-screen
  // and flips left near the right edge so it never overflows the viewer.
  const CIRCULAR_CARD_W = 240;
  const handleCircularFeatureHover = useCallback(
    (range: { name: string; start: number; end: number } | null, clientX: number, clientY: number) => {
      if (!range) {
        setCircularHover(null);
        return;
      }
      const idx = resolveCircularFeatureIdx(range);
      if (idx < 0) {
        setCircularHover(null);
        return;
      }
      const el = viewerRef.current;
      if (!el) {
        setCircularHover({ idx, left: 0, top: 0 });
        return;
      }
      const rect = el.getBoundingClientRect();
      const OFFSET = 14;
      let left = clientX - rect.left + OFFSET;
      let top = clientY - rect.top + OFFSET;
      if (left + CIRCULAR_CARD_W > rect.width) left = clientX - rect.left - CIRCULAR_CARD_W - OFFSET;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      setCircularHover({ idx, left, top });
    },
    [resolveCircularFeatureIdx],
  );

  // circular qol bot — the interaction object handed to SeqViz's circular tree via
  // context. The feature CLICK reuses handleMapFeatureClick verbatim, so the
  // circular shift-span runs the SAME selAnchor + spanFromShiftClick path as the
  // linear/overview handlers (one shared selection source of truth). The HOVER
  // drives the card + preview arc.
  // primer hover bot — HOVER a primer marker on the ring. Same geometry as the
  // feature hover (clamp the card inside the viewer, flip left near the right
  // edge), but it stores the primer identity for the primer card (coords / bp /
  // %GC / Tm) instead of a feature index. Null range (mouse-leave) clears it.
  const handleCircularPrimerHover = useCallback(
    (range: { name: string; start: number; end: number } | null, clientX: number, clientY: number) => {
      if (!range) {
        setCircularPrimerHover(null);
        return;
      }
      const el = viewerRef.current;
      if (!el) {
        setCircularPrimerHover({ primer: range, left: 0, top: 0 });
        return;
      }
      const rect = el.getBoundingClientRect();
      const OFFSET = 14;
      let left = clientX - rect.left + OFFSET;
      let top = clientY - rect.top + OFFSET;
      if (left + CIRCULAR_CARD_W > rect.width) left = clientX - rect.left - CIRCULAR_CARD_W - OFFSET;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      setCircularPrimerHover({ primer: range, left, top });
    },
    [],
  );

  const circularFeatureInteraction = useMemo(
    () => ({
      onFeatureClick: handleMapFeatureClick,
      onFeatureHover: handleCircularFeatureHover,
      onPrimerHover: handleCircularPrimerHover,
    }),
    [handleMapFeatureClick, handleCircularFeatureHover, handleCircularPrimerHover],
  );

  // circular qol bot — the hovered feature's range, fed to the circular viewer as
  // the red PREVIEW arc (the circular analogue of the linear red brackets). Only
  // active on the circular Map view; null clears the arc.
  const circularPreviewRange = useMemo(() => {
    if (!circularHover) return null;
    const f = doc.features[circularHover.idx];
    if (!f) return null;
    return { start: f.start, end: f.end };
  }, [circularHover, doc.features]);

  // circular qol bot — the hovered feature's info-card content (reuses the SAME
  // buildFeatureCard the linear Map uses, so the fields read identically). The
  // doc feature carries note/type for the product + aa/kDa lines.
  const circularHoverCard = useMemo(() => {
    if (!circularHover) return null;
    const f = doc.features[circularHover.idx];
    if (!f) return null;
    // Note comes from the SAME product/note/gene qualifier index the linear Map
    // uses (featureNoteByKey), so the Product line reads identically.
    const note = featureNoteByKey.get(`${f.name}|${f.start}|${f.end}`);
    return buildFeatureCard({ name: f.name, start: f.start, end: f.end, type: f.type, note });
  }, [circularHover, doc.features, featureNoteByKey]);

  // primer hover bot — the hovered primer's info-card content (reuses the SAME
  // buildPrimerCard the linear Map uses, so the fields read identically: 1-based
  // coords, length, %GC, Tm computed from the binding region of doc.seq).
  const circularPrimerCard = useMemo(() => {
    if (!circularPrimerHover) return null;
    return buildPrimerCard(circularPrimerHover.primer, doc.seq);
  }, [circularPrimerHover, doc.seq]);

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

  // debounce-perf bot — whether the current `findMatches` were computed against
  // the live sequence. `findMatchesFresh` is the gate every position-bearing
  // consumer (highlights / prev-next selection) must check: when false, an edit
  // has landed since the matches were computed and their absolute positions are
  // stale, so we paint / select nothing until the debounced rescan reports
  // matches keyed to the new sequence. No `findMatches` -> always fresh (an empty
  // set is position-free). `liveSeqKey` is computed once near the top of the
  // component (the ORF stale-guard shares the same identity).
  const findMatchesFresh =
    findMatches.length === 0 || findMatchesKey === liveSeqKey;

  const goToMatch = useCallback(
    (idx: number) => {
      // debounce-perf bot — STALE GUARD: prev/next must not jump the selection to
      // a position computed against a stale sequence revision. While the matches
      // are stale (an edit landed, rescan pending) prev/next is a no-op until the
      // debounced rescan lands fresh, live-keyed matches.
      if (findMatches.length === 0 || !findMatchesFresh) return;
      const i = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
      setFindActive(i);
      const m = findMatches[i];
      selectSpan(Math.min(m.start, m.end), Math.max(m.start, m.end));
    },
    [findMatches, findMatchesFresh, selectSpan],
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

  // enhanced find bot — the Find box (SequenceFindBox) runs the pure search
  // (exact DNA both-strand / closest-match fallback / by-name / protein-frame)
  // and reports the resulting match list here. We jump to + select the first
  // hit when the set changes, mirroring a "find next" on submit. The previous
  // SeqViz-search-prop path is retired; highlighting now comes from the
  // `findHighlights` memo fed to SeqViz's `highlights` prop, which covers ALL
  // modes (close-match, name, protein), not just an exact substring.
  const onFindResults = useCallback(
    (result: FindResult) => {
      setFindMatches(result.matches);
      setFindIsClose(result.isCloseMatch);
      setFindMatchesKey(result.seqKey);
      if (result.matches.length > 0) {
        setFindActive(0);
        const m = result.matches[0];
        selectSpan(Math.min(m.start, m.end), Math.max(m.start, m.end));
      } else {
        setFindActive(0);
      }
    },
    [selectSpan],
  );

  // Visual highlights for every find match, fed to SeqViz. Amber for an
  // approximate (closest-match) DNA fallback, the default search-yellow for an
  // exact / name / protein hit. Only active while the box is open.
  const findHighlights = useMemo(() => {
    // debounce-perf bot — STALE GUARD: never paint a highlight whose positions
    // were computed against a different sequence revision than the one on screen
    // (an edit shifts every absolute index). When the matches are stale we draw
    // nothing until the debounced rescan reports matches keyed to the live seq.
    if (!findOpen || findMatches.length === 0 || !findMatchesFresh) return [];
    const color = findIsClose ? "#fde68a" : "#fbe58b";
    return findMatches.map((m) => ({
      start: Math.min(m.start, m.end),
      end: Math.max(m.start, m.end),
      color,
    }));
  }, [findOpen, findMatches, findIsClose, findMatchesFresh]);

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

  // overview featclick bot — the selection the readout describes. A FEATURE
  // selection (Map / overview / Features list) sets `externalSel` but, because
  // SeqViz never fires onSelection for a programmatic prop selection, it never
  // reaches the local `selection` state. So the readout prefers `externalSel`
  // when present, falling back to the user's live drag `selection`. A free-hand
  // drag clears externalSel (onSelection), so the fallback path is unchanged.
  const readoutSelection = useMemo<Selection | null>(() => {
    if (externalSel) {
      return { start: externalSel.start, end: externalSel.end, type: "" };
    }
    return selection;
  }, [externalSel, selection]);

  // overview featclick bot — the SELECTED FEATURE context for the readout. When a
  // feature is selected (selectedFeatureIdx set) and the readout selection still
  // equals that feature's span, the readout prefixes the feature NAME.
  const readoutSelectedFeature = useMemo(() => {
    if (selectedFeatureIdx == null) return null;
    const f = doc.features[selectedFeatureIdx];
    if (!f) return null;
    return { name: f.name, start: f.start, end: f.end };
  }, [selectedFeatureIdx, doc.features]);

  // Selection readout values (shared with the read view via the extracted
  // helper; edit-mode behavior is identical to before).
  const readout = useMemo(
    () => deriveSelectionReadout(readoutSelection, doc.seq, readoutSelectedFeature),
    [readoutSelection, doc.seq, readoutSelectedFeature],
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

  // feature/primer menus bot — two discoverable toolbar dropdowns ("Feature"
  // and "Primer") that mirror the Edit/Export shells. Add is always enabled;
  // Edit / Duplicate / Remove are greyed out until a feature (or primer) is the
  // current selection. Primers ARE features of type primer_bind, so both menus
  // read the shared selectedFeatureIdx and split on the selected type.
  const selFeat = selectedFeatureIdx != null ? doc.features[selectedFeatureIdx] : null;
  const selIsPrimer = !!selFeat && (selFeat.type || "").toLowerCase() === "primer_bind";
  const selIsFeature = !!selFeat && !selIsPrimer;

  // sequence editor master — PROTEIN-PROPERTIES DRAWER GATE. The drawer opens
  // when the selected feature is CODING (cds / gene / mat_peptide / sig_peptide)
  // and the user has not dismissed it for that same index. Non-coding selections
  // never open it, so the existing select behavior is unchanged for them.
  const showProteinDrawer =
    selectedFeatureIdx != null &&
    !!selFeat &&
    isCodingFeature(selFeat) &&
    proteinDrawerDismissedIdx !== selectedFeatureIdx;
  // Reselecting a DIFFERENT feature clears any prior dismissal so the drawer can
  // reopen. (Dismissing keeps the feature selected; reopening = reselect it.)
  useEffect(() => {
    if (
      proteinDrawerDismissedIdx != null &&
      proteinDrawerDismissedIdx !== selectedFeatureIdx
    ) {
      setProteinDrawerDismissedIdx(null);
    }
  }, [selectedFeatureIdx, proteinDrawerDismissedIdx]);

  // menu reorg bot — the Feature menu is now TRUE CRUD only: Add / Edit /
  // Duplicate / Remove. The analysis engines (Detect / Annotate) moved to the new
  // Analyze menu, and the per-feature-type show/hide list moved back to the left
  // rail as a labeled "Feature types" flyout, so this menu no longer mixes three
  // kinds of action under one verb.
  const featureMenuItems = useMemo<EditMenuItem[]>(() => {
    const idx = selectedFeatureIdx;
    return [
      { id: "feat-add", label: "Add Feature…", enabled: true, onRun: openAddFeature },
      {
        id: "feat-edit",
        label: "Edit Feature…",
        enabled: selIsFeature,
        group: true,
        onRun: () => {
          if (idx != null) openEditFeature(idx);
        },
      },
      {
        id: "feat-dup",
        label: "Duplicate Feature",
        enabled: selIsFeature,
        onRun: () => {
          if (idx != null) duplicateFeatureAt(idx);
        },
      },
      {
        id: "feat-remove",
        label: "Remove Feature",
        enabled: selIsFeature,
        destructive: true,
        onRun: () => {
          if (idx != null) deleteFeatureAt(idx);
        },
      },
    ];
  }, [
    selectedFeatureIdx,
    selIsFeature,
    openAddFeature,
    openEditFeature,
    duplicateFeatureAt,
    deleteFeatureAt,
  ]);

  // menu reorg bot — the new ANALYZE menu: the home for cross-cutting molecule
  // analysis. Detect + Annotate moved here from the overloaded Feature menu, and
  // Compare adds a second door into the library-level Compare/Align dialog from
  // inside the editor. Display-ish, but the apply paths mutate, so edit-only.
  const analyzeMenuItems = useMemo<EditMenuItem[]>(
    () => [
      {
        id: "analyze-detect",
        label: "Detect common features…",
        enabled: true,
        onRun: openDetectFeatures,
      },
      {
        id: "analyze-annotate-ref",
        label: "Annotate from reference…",
        enabled: true,
        onRun: openAnnotateFromReference,
      },
      {
        id: "analyze-compare",
        label: "Align sequences…",
        enabled: true,
        group: true,
        onRun: () => setCompareOpen(true),
      },
      // protein analyze bot — the second door into the protein-properties
      // engine (the Lab calculators panel tab is the first). Pipes in the
      // active selection or a chosen CDS / gene, no copy-paste.
      {
        id: "analyze-protein-props",
        label: "Protein properties…",
        enabled: true,
        onRun: () => setProteinPropsOpen(true),
      },
      // sequence editor master. Opt-in NCBI taxonomy enrichment, present only
      // when the surface can persist (onEnriched given). A preview-then-apply
      // dialog, never automatic.
      ...(onEnriched
        ? [
            {
              id: "analyze-enrich-ncbi",
              label: "Enrich from NCBI…",
              enabled: true,
              group: true,
              onRun: () => setEnrichOpen(true),
            } as EditMenuItem,
          ]
        : []),
    ],
    [openDetectFeatures, openAnnotateFromReference, onEnriched],
  );

  const primerMenuItems = useMemo<EditMenuItem[]>(() => {
    const idx = selectedFeatureIdx;
    return [
      { id: "primer-add", label: "Add Primer…", enabled: true, onRun: () => openPrimerDialog("standard") },
      {
        id: "primer-edit",
        label: "Edit Primer…",
        enabled: selIsPrimer,
        group: true,
        onRun: () => {
          if (idx != null) openEditPrimer(idx);
        },
      },
      {
        id: "primer-dup",
        label: "Duplicate Primer",
        enabled: selIsPrimer,
        onRun: () => {
          if (idx != null) duplicateFeatureAt(idx);
        },
      },
      {
        id: "primer-remove",
        label: "Remove Primer",
        enabled: selIsPrimer,
        destructive: true,
        onRun: () => {
          if (idx != null) deleteFeatureAt(idx);
        },
      },
      // menu reorg bot — two NAMED primer actions that used to be buried (SDM was
      // a tab inside Add Primer; specificity was a sub-tab three levels down).
      // "Design mutagenesis primer..." opens Add-Primer straight into its SDM
      // mode; "Check specificity..." jumps the Primers tab onto its Check view.
      {
        id: "primer-mutagenesis",
        label: "Design mutagenesis primer…",
        enabled: true,
        group: true,
        onRun: () => openPrimerDialog("mutagenesis"),
      },
      {
        id: "primer-specificity",
        label: "Check specificity…",
        enabled: true,
        onRun: openSpecificityCheck,
      },
      // top menus consolidation bot — the primer LAYER show/hide, relocated so
      // the Primer menu holds actions AND visibility (mirrors Feature / Enzyme).
      {
        id: "primer-show",
        label: "Primers",
        enabled: true,
        group: true,
        checked: view.showPrimers,
        onRun: () => setView((v) => ({ ...v, showPrimers: !v.showPrimers })),
      },
    ];
  }, [
    selectedFeatureIdx,
    selIsPrimer,
    openPrimerDialog,
    openSpecificityCheck,
    openEditPrimer,
    duplicateFeatureAt,
    deleteFeatureAt,
    view.showPrimers,
  ]);

  // top menus consolidation bot — the new "Enzyme" toolbar dropdown. Display
  // only (no mutation), so it renders in read-only too. Holds the cut-site LAYER
  // toggle + the "Choose enzymes" picker, plus a subtle active-count appended to
  // the picker label. Relocated from the rail's EnzymeLayerFlyout.
  const enzymeMenuItems = useMemo<EditMenuItem[]>(() => {
    const activeCount = (activeEnzymes ?? COMMON_ENZYMES).length;
    return [
      {
        id: "enz-cut-sites",
        label: "Cut sites",
        enabled: true,
        checked: view.showEnzymes,
        onRun: () => setView((v) => ({ ...v, showEnzymes: !v.showEnzymes })),
      },
      {
        id: "enz-choose",
        label: `Choose enzymes… (${activeCount})`,
        enabled: true,
        group: true,
        onRun: openEnzymePicker,
      },
    ];
  }, [view.showEnzymes, activeEnzymes, openEnzymePicker]);

  // seq export bot — the Export dropdown. Read-only download of the whole
  // sequence (GenBank/FASTA), the current selection (DNA .gb/FASTA + frame-1
  // protein FASTA), and the live map image (SVG always; PNG best-effort via
  // canvas rasterization). All serialization lives in lib/sequences/export.ts;
  // these handlers only call it and trigger the browser download.
  const baseFileName = useMemo(
    () => sanitizeFilename(doc.name || sequence.display_name || "sequence"),
    [doc.name, sequence.display_name],
  );

  // map to note bot — capture the live map as a PNG and open the note picker.
  // Reuses exportMapImage (the same SVG->PNG path the Export menu's "Map image
  // (PNG)" item uses); the picker then routes to attachImageToNote.
  const captureMapForNote = useCallback(async () => {
    setMapToNoteStatus(null);
    const out = await exportMapImage(viewerRef.current);
    if (!out) {
      alert("Could not capture the map view.");
      return;
    }
    if (!out.png) {
      // PNG rasterization unavailable (no canvas): the SVG-only fallback the
      // download path uses doesn't apply here since notes embed a raster image.
      alert(
        "Could not rasterize the map to PNG in this browser. Try the SVG/PNG download from the Export menu instead.",
      );
      return;
    }
    setMapToNotePng(out.png);
  }, []);

  // map to note bot — attach the captured PNG to the chosen note via the
  // EXISTING note image-attachment path (attachImageToNote: writes the blob to
  // `users/<owner>/notes/<id>/Images/` and appends a markdown link to the
  // note's latest entry — the same path the inbox photo router uses). Convert
  // the PNG data URL to a Blob with fetch (browser-native, no canvas re-encode).
  const attachMapToNote = useCallback(
    async (note: { id: number; owner: string; title: string }) => {
      if (!mapToNotePng || mapToNoteBusy) return;
      setMapToNoteBusy(true);
      try {
        const blob = await fetch(mapToNotePng).then((r) => r.blob());
        const seqName = doc.name || sequence.display_name || "sequence";
        await attachImageToNote({
          ownerUsername: note.owner,
          noteId: note.id,
          blob,
          suggestedFilename: mapImageFilename(seqName),
          altText: mapImageAltText(seqName),
        });
        setMapToNotePng(null);
        setMapToNoteStatus({ noteTitle: note.title || "note" });
      } catch (err) {
        console.error("[sequence] send map to note failed", err);
        alert("Failed to attach the map image to that note.");
      } finally {
        setMapToNoteBusy(false);
      }
    },
    [mapToNotePng, mapToNoteBusy, doc.name, sequence.display_name],
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

    // map to note bot — file the current map straight into a lab note as a PNG
    // (no download / re-upload round-trip). Reuses the same map capture; the
    // note picker + attachImageToNote do the rest.
    items.push({
      id: "map-to-note",
      label: "Send map image to a note…",
      enabled: true,
      group: true,
      onRun: () => {
        void captureMapForNote();
      },
    });

    return items;
  }, [doc, sel, isNucleotide, baseFileName, captureMapForNote]);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col" tabIndex={-1}>
      {/* Toolbar. The mutating affordances (undo/redo/cut/paste/primer/save) are
          hidden on the read-only surface; selection, the feature list, enzymes
          (display-only) and Copy remain available. The whole row is hidden in an
          `embedded` preview (chrome slim): the view tabs + view rail + map stay. */}
      {!embedded ? (
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
        {/* feature/primer menus bot — two discoverable dropdowns next to Edit.
            Add is always live; Edit / Duplicate / Remove grey out until a
            feature (or primer) is selected. Mutation-only, so edit mode only. */}
        {!readOnly ? (
          <>
            <EditMenuDropdown
              items={featureMenuItems}
              label="Feature"
              testId="sequence-feature-button"
              icon={<IconFeatureTag className="h-4 w-4" />}
            />
            <EditMenuDropdown
              items={primerMenuItems}
              label="Primer"
              testId="sequence-primer-button"
              icon={<IconPrimer className="h-4 w-4" />}
            />
            {/* menu reorg bot — the new Analyze dropdown: Detect features /
                Annotate from reference / Compare sequences. One calm home for the
                molecule-level analysis that used to be scattered. */}
            <EditMenuDropdown
              items={analyzeMenuItems}
              label="Analyze"
              testId="sequence-analyze-button"
              icon={<IconAnalyze className="h-4 w-4" />}
            />
          </>
        ) : null}
        {/* top menus consolidation bot — the Enzyme dropdown. Display only (cut
            sites layer + enzyme picker), so it renders in read-only too. Sits
            after Feature / Primer for the consistent top trio. */}
        {showViewer ? (
          <EditMenuDropdown
            items={enzymeMenuItems}
            label="Enzyme"
            testId="sequence-enzyme-button"
            icon={<IconScissors className="h-4 w-4" />}
          />
        ) : null}
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
          <div className="text-meta text-gray-400">
            {doc.seq.length.toLocaleString()} bp
            {!readOnly && dirty ? <span className="ml-2 text-amber-500">• unsaved</span> : null}
            {readOnly ? <span className="ml-2 text-gray-400">Read-only</span> : null}
          </div>
        </div>
      </div>
      ) : null}

      {/* sequence editor master. The calm organism + taxonomy-lineage line for an
          enriched sequence. Self-hides when the sequence has no organism / lineage
          (a native or non-enriched sequence shows nothing). */}
      <SequenceLineageChip
        organism={sequence.organism}
        taxId={sequence.tax_id}
        lineage={sequence.tax_lineage}
      />

      {/* Icon rail + tab content. The left ViewControlRail (layer toggles) stays
          visible for the Map + Sequence views; the other tabs render their own
          panel in the main content area. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showViewer ? (
          <ViewControlRail
            view={view}
            onViewChange={setView}
            circular={doc.circular}
            featureTypes={featureTypes}
          />
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
              {/* linear map bot — HIDE the redundant overview strip in linear Map
                  mode: the LinearMap IS the whole-molecule view. The strip stays
                  for the linear Sequence (detail) view, where it provides the
                  navigational context the detail scroll lacks. */}
              {isLinearViewer && !linearMapMode ? (
                // overview slider bot — the overview bar sits in a row with its
                // OWN zoom slider on the right. The slider drives the bar's bp
                // EXTENT (its zoom), two-way synced with the bar's scroll / pinch
                // zoom. The base/text view keeps pinch + Fit (no slider here).
                <div className="flex items-stretch border-b border-gray-100 bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <SequenceOverviewBar
                      seqLength={doc.seq.length}
                      features={overviewFeatures}
                      window={overviewWindow}
                      onScrollToBp={scrollMainToBp}
                      // overview featclick bot — a click ON a feature arrow
                      // SELECTS that feature (range + band), reusing selectFeature;
                      // a bare-track click still scrolls via onScrollToBp.
                      onFeatureClick={handleOverviewFeatureClick}
                      onShiftSelectToBp={handleOverviewShiftSelectToBp}
                      // overview zoom bot — the bar's OWN zoom (independent of the
                      // detail-view linearZoom). Scroll / pinch over the bar
                      // updates this extent; it never touches the detail zoom.
                      extent={overviewExtent}
                      onExtentChange={setOverviewExtent}
                      // overview selband bot — the shared editor selection drawn
                      // as a blue band on the strip (same range the LinearMap +
                      // base view highlight), distinct from the viewport box.
                      selection={mapSelection}
                    />
                  </div>
                  <div className="flex shrink-0 items-center border-l border-gray-100 px-2.5">
                    <SequenceOverviewZoomSlider
                      seqLength={doc.seq.length}
                      extent={overviewExtent}
                      onExtentChange={setOverviewExtent}
                      winSpan={overviewWindow.end - overviewWindow.start}
                    />
                  </div>
                </div>
              ) : null}
              <div
                ref={viewerRef}
                className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
                // selection badge bot — mouse-down starts a drag; mouse-move
                // tracks the cursor relative to this (position: relative)
                // container so the floating badge can follow it. Mouse-up is
                // handled by the window listener above so a release outside the
                // viewer still ends the drag.
                onMouseDown={(e) => {
                  // Left button only; right-click opens the context menu.
                  if (e.button !== 0) return;
                  const rect = viewerRef.current?.getBoundingClientRect();
                  if (rect) setDragPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  setIsDragging(true);
                }}
                onMouseMove={(e) => {
                  if (!isDragging) return;
                  const rect = viewerRef.current?.getBoundingClientRect();
                  if (rect) setDragPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onContextMenu={(e) => {
                  // Right-click anywhere on the sequence surface opens the Edit
                  // menu (the primary, selection-aware home for these ops).
                  e.preventDefault();
                  setContextMenuAt({ x: e.clientX, y: e.clientY });
                }}
              >
                {/* seq polish batch bot — MAP-MODE BADGE. At the slider floor the
                    Map and Sequence tabs can read as near-identical, so the Map
                    view carries an explicit, always-on "Map view" badge anchored
                    top-left of the viewer. Mode-agnostic (linear map + circular
                    ring both show it); the Sequence view never does, so the two
                    tabs are unmistakable at a glance. Inline SVG ring, type-meta,
                    pointer-events:none so it never intercepts a map click. */}
                {isMapView ? (
                  <div
                    className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50/90 px-2 py-1 text-meta font-medium text-sky-700 shadow-sm backdrop-blur-sm"
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
                    </svg>
                    <span>Map view</span>
                  </div>
                ) : null}
                {/* enhanced find bot — inline Find box (Cmd+F), anchored top-right.
                    SnapGene-style modes (DNA / Name / Protein) with a closest-
                    match fallback; it owns mode + query and reports matches up. */}
                {findOpen ? (
                  <SequenceFindBox
                    seq={doc.seq}
                    features={doc.features}
                    circular={doc.circular}
                    matchCount={findMatches.length}
                    activeIndex={findActive}
                    onResults={onFindResults}
                    onPrev={() => goToMatch(findActive - 1)}
                    onNext={() => goToMatch(findActive + 1)}
                    onClose={() => {
                      setFindOpen(false);
                      setFindMatches([]);
                      setFindActive(0);
                      setFindIsClose(false);
                      setFindMatchesKey("");
                    }}
                  />
                ) : null}
                {/* linear map bot — linear Map mode renders the dedicated
                    single-line LinearMap (one strand fit to width + ruler +
                    feature arrows below + enzyme/primer leader-line labels above)
                    INSTEAD of SeqViz's wrapped MAP_ZOOM rows. The Sequence view
                    and the circular ring keep SeqViz unchanged. */}
                {linearMapMode ? (
                  <LinearMap
                    seq={doc.seq}
                    seqType={doc.seqType === "protein" ? "aa" : doc.seqType}
                    seqLength={doc.seq.length}
                    features={linearMapFeatures}
                    enzymeKeys={enzymes}
                    showEnzymes={view.showEnzymes}
                    primers={primers}
                    showPrimers={view.showPrimers}
                    onFeatureDoubleClick={handleAnnotationDoubleClick}
                    onPrimerDoubleClick={handlePrimerDoubleClick}
                    onFeatureClick={handleMapFeatureClick}
                    onClearSelection={handleMapClearSelection}
                    onRangeSelect={handleMapDragSelect}
                    selection={mapSelection}
                  />
                ) : (
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
                  highlights={findHighlights}
                  viewer={viewer}
                  zoom={{ linear: viewerLinearZoom, circular: view.circularZoom }}
                  editable={!readOnly && viewMode === "sequence"}
                  onEdit={requestEdit}
                  onAnnotationDoubleClick={handleAnnotationDoubleClick}
                  // circular qol bot — CIRCULAR map selection QoL: single/shift-click
                  // a ring feature to select / span (reuses handleMapFeatureClick,
                  // the SAME selAnchor + spanFromShiftClick path as the linear/
                  // overview handlers) + the hover card / red preview arc. Threaded
                  // through context to the deep circular Annotations tree; the
                  // preview range drives the red arc inside the ring SVG.
                  circularFeatureInteraction={circularFeatureInteraction}
                  circularPreviewRange={circularPreviewRange}
                  onSelection={(s) => {
                    setSelection(s);
                    // A user-driven selection takes back control from a feature zoom.
                    if (externalSel) setExternalSel(null);
                  }}
                  selection={externalSel ?? undefined}
                  // nav polish bot — FIX 1: drop the complement strand in Map view
                  // (no legible bases to index there). But KEEP the index: for a
                  // circular plasmid the Map view IS the bp-number ring, which is
                  // useful at a glance, so respect the user's showIndex toggle in
                  // both modes. (The linear Map uses the separate LinearMap with its
                  // own ruler, so this prop only affects the circular ring.)
                  showComplement={!isMapView}
                  showIndex={view.showIndex}
                  // wrap toggle bot — SINGLE-LINE vs WRAPPED for the linear
                  // Sequence detail view. Map / circular always render wrapped.
                  wrapSequence={!singleLine}
                  singleLineCharWidth={singleLineCharWidth}
                  disableExternalFonts
                  style={{ height: "100%", width: "100%" }}
                />
                )}
                {/* selection badge bot — FLOATING SELECTION BADGE. Visible only
                    while the user is actively dragging a real range (mouse held
                    down, readout.kind === "range"); hidden the instant the
                    mouse is released. Shares SelectionReadoutContent with the
                    persistent bottom strip (range + bp always, Tm violet chip
                    for 8..50 bp). pointer-events: none so it never intercepts
                    the drag or a double-click. Positioned near the cursor with
                    a small offset, flipped near the right / bottom edges so it
                    never overflows the container. */}
                {isDragging && dragPointer && readout?.kind === "range" ? (
                  <FloatingSelectionBadge
                    pointer={dragPointer}
                    container={viewerRef.current}
                    readout={readout}
                  />
                ) : null}
                {/* circular qol bot — CIRCULAR map HOVER INFO CARD. The same
                    floating popover the linear Map shows (name, 1-based range, bp
                    length, aa/kDa for a coding feature, the product/note), built
                    from the SHARED buildFeatureCard so the fields read identically.
                    It is a custom positioned popover (NOT the icon Tooltip),
                    anchored at the cursor inside this (position: relative) viewer
                    container, clamped on-screen. pointer-events:none so it never
                    intercepts the ring click/drag. */}
                {circularHover && circularHoverCard ? (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute z-30 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-lg"
                    style={{ left: circularHover.left, top: circularHover.top, width: CIRCULAR_CARD_W }}
                  >
                    <div className="text-body font-semibold text-slate-800">{circularHoverCard.title}</div>
                    <div className="mt-1 space-y-0.5">
                      {circularHoverCard.lines.map((line, li) => (
                        <div key={li} className="text-meta text-slate-600">
                          {line.label ? (
                            <span className="font-medium text-slate-500">{line.label} </span>
                          ) : null}
                          {line.value}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {/* primer hover bot — CIRCULAR map PRIMER HOVER CARD. The same
                    floating popover the linear Map shows on a primer (name,
                    1-based binding range, bp length, %GC, Tm), built from the
                    SHARED buildPrimerCard so the two maps read identically.
                    pointer-events:none keeps it clear of the ring click/drag. */}
                {circularPrimerHover && circularPrimerCard ? (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute z-30 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-lg"
                    style={{ left: circularPrimerHover.left, top: circularPrimerHover.top, width: CIRCULAR_CARD_W }}
                  >
                    <div className="text-body font-semibold text-slate-800">{circularPrimerCard.title}</div>
                    <div className="mt-1 space-y-0.5">
                      {circularPrimerCard.lines.map((line, li) => (
                        <div key={li} className="text-meta text-slate-600">
                          {line.label ? (
                            <span className="font-medium text-slate-500">{line.label} </span>
                          ) : null}
                          {line.value}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
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
                  // seq polish batch bot — FIX 3: hold the bp readout / bp-in-view
                  // field until the true visible window has been measured, so
                  // neither flashes the seeded whole-molecule span for a frame on
                  // first paint or on a view toggle.
                  measured={windowMeasured}
                />
              ) : viewMode === "map" ? (
                // nav polish bot — circular molecule in Map view: the ring IS the
                // whole-molecule map, so the circular zoom slider is irrelevant.
                // Mirror the linear Map cluster with the same calm indicator.
                <div className="flex items-center gap-2 border-t border-gray-100 bg-white px-3 py-2 text-meta text-gray-500">
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
              initialMode="check"
              initialModeNonce={primersCheckNonce}
            />
          ) : null}

          {/* HISTORY tab — real per-sequence version timeline (seq history bot).
              Each Save records a version; restore loads an earlier one back. */}
          {viewMode === "history" ? (
            <SequenceHistoryPanel
              sequenceId={sequence.id}
              owner={historyOwner}
              headCanonical={headCanonical}
              canRestore={!readOnly && RESTORE_ENABLED}
              onRestore={handleRestoreVersion}
              restoreAudit={sequence._restore_audit}
            />
          ) : null}
        </div>

        {/* sequence editor master — RIGHT-DOCKED PROTEIN-PROPERTIES DRAWER. A flex
            sibling of the viewer column (NOT an overlay): when it mounts, the
            column above shrinks and SeqViz reflows narrower via its ResizeObserver,
            so the map is never covered. Shown only alongside the Map / Sequence
            viewer, and only for a CODING feature selection. */}
        {showViewer && showProteinDrawer && selFeat && selectedFeatureIdx != null ? (
          <ProteinPropertiesDrawer
            feature={selFeat}
            featureIndex={selectedFeatureIdx}
            seq={doc.seq}
            features={doc.features}
            readOnly={readOnly}
            onClose={() => setProteinDrawerDismissedIdx(selectedFeatureIdx)}
            onEditFeature={openEditFeature}
            onAddDomains={readOnly ? undefined : addDomainFeatures}
            // Click a domain block in the bar -> select + scroll its DNA feature
            // on the map (the protein-view -> DNA-view cross-link).
            onSelectDomain={selectFeature}
          />
        ) : null}
      </div>

      {/* Live selection readout */}
      <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-meta text-gray-600">
        <SelectionReadoutContent readout={readout} />
      </div>

      {/* seq nav bot — the SnapGene-style BOTTOM TAB BAR (always visible): the
          primary Map / Sequence / Features / Primers / History switch. Restriction
          enzymes are a rail LAYER (the "Restriction sites" toggle + its picker
          flyout), not a tab. */}
      <SequenceTabBar
        active={viewMode}
        onChange={setViewMode}
        featureCount={doc.features.length}
        primerCount={primerCount}
      />

      {/* Confirmation dialog for Cut / chunk-delete / Paste / feature delete. */}
      <SequenceConfirmDialog request={confirm} />

      {/* Add / edit feature dialog. */}
      <FeatureEditorDialog request={featureEditor} />

      {/* annotate-from-reference bot — transfer features from a reference. */}
      <AnnotateFromReferenceDialog request={annotateRef} />

      {/* feature detect bot — detect common protein features from the bundled DB. */}
      <DetectFeaturesDialog request={detectReq} />

      {/* sequence editor master. Opt-in "Enrich from NCBI". Resolves this
          sequence's organism + tax id + named lineage (its own accession, its
          NCBI provenance, or a typed organism / accession), previews them, and on
          apply persists the sidecar + the source-feature qualifiers via onEnriched. */}
      {onEnriched ? (
        <EnrichFromNcbiDialog
          open={enrichOpen}
          onClose={() => setEnrichOpen(false)}
          genbank={sequence.genbank}
          parsedAccession={extractAccession(sequence.genbank)}
          provenanceAccession={sequence.ncbi_accession}
          onApply={onEnriched}
        />
      ) : null}

      {/* menu reorg bot — Compare / align two sequences, opened from the Analyze
          menu. Seeds sequence A with the open molecule (the dialog's own
          defaultAId); the user picks B. Unmodified shared dialog. */}
      <CompareSequencesDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        defaultAId={sequence.id}
      />

      {/* protein analyze bot — Protein properties, opened from the Analyze menu.
          Seeds from the current selection, else a CDS / gene picker, else a
          paste field; renders the SAME shared view as the calculators tab. */}
      <ProteinPropertiesDialog
        open={proteinPropsOpen}
        onClose={() => setProteinPropsOpen(false)}
        seq={doc.seq}
        features={doc.features}
        selection={sel}
      />

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
        username={currentUser ?? undefined}
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

      {/* map to note bot — note picker for "Send map image to a note". The
          captured PNG lives in mapToNotePng while this is open; picking a note
          (or "New note") attaches it via attachImageToNote. */}
      <SendToNotePicker
        isOpen={mapToNotePng !== null}
        selectedCount={1}
        headerLabel="Send map image to a note"
        subLabel={`Adds "${mapImageAltText(doc.name || sequence.display_name || "sequence")}" to the note's latest entry.`}
        ctaLabel={mapToNoteBusy ? "Adding…" : "Add map here"}
        allowCreateNew
        newNoteTitle={`${doc.name || sequence.display_name || "Sequence"} map`}
        onClose={() => {
          if (mapToNoteBusy) return;
          setMapToNotePng(null);
        }}
        onPick={(note) => {
          void attachMapToNote(note);
        }}
      />

      {/* map to note bot — calm success banner after the map lands in a note.
          aria-live so a screen reader announces it; a link jumps to the
          Workbench Notes tab where the note is listed. */}
      {mapToNoteStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-body shadow-lg"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="text-gray-700">
            Map added to{" "}
            <span className="font-medium text-gray-900">{mapToNoteStatus.noteTitle}</span>
          </span>
          <a
            href="/workbench?tab=notes"
            className="font-medium text-sky-600 hover:text-sky-700"
          >
            Open in Workbench
          </a>
          <button
            type="button"
            onClick={() => setMapToNoteStatus(null)}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
