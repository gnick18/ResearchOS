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
import Link from "next/link";
import dynamic from "next/dynamic";
import Tooltip from "@/components/Tooltip";
import BeakerBot from "@/components/BeakerBot";
import type { SequenceDetail, SequenceRecord } from "@/lib/types";
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
import { sanitizeResidues } from "@/lib/sequences/residue-alphabet";
import {
  addFeature,
  updateFeature,
  duplicateFeature,
  deleteFeature,
  setFeatureColor,
  renameFeature,
  setTypeColor,
  segmentsOf,
  qualifiersFromNotes,
  readNoteFlag,
  TRANSLATE_NOTE_KEY,
  PRIORITIZE_NOTE_KEY,
  type FeatureDraft,
} from "@/lib/sequences/feature-edit";
import { colorForType, FEATURE_COLOR_SWATCHES } from "@/lib/sequences/feature-colors";
import {
  featureDomId,
  decodeFeatureDomId,
  featureIndexFromEventTarget,
  chooseContextMenuKind,
  toFasta,
} from "@/lib/sequences/context-menu-target";
import {
  buildFeatureMenuItems,
  buildPrimerMenuItems,
  buildSelectionMenuItems,
} from "@/lib/sequences/context-menu-items";
import { findOrfs } from "@/lib/sequences/orf";
import {
  extractRegion,
  extractedRegionToImported,
  type ExtractTarget,
} from "@/lib/sequences/extract-region";
import type { ImportedSequence } from "@/lib/sequences/import";
import { annotationBarsToDraw, selectTranslationFeatures } from "@/lib/sequences/translation-tracks";
import {
  setMolecularClip,
  useMolecularClipboard,
} from "@/lib/sequences/molecular-clipboard";
import { useTaxonomyClipboard } from "@/lib/sequences/taxonomy-clipboard";
import { type SequenceTaxonomy } from "@/lib/sequences/apply-taxonomy";
import { useSequenceEditor } from "@/lib/sequences/use-sequence-editor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
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
import SequenceDisplayStrip from "./SequenceDisplayStrip";
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
import SequenceLineageFooter from "./SequenceLineageFooter";
import { extractAccession } from "@/lib/sequences/ncbi-datasets";
// menu reorg bot — the library-level Compare/Align dialog, also surfaced from
// the editor's new Analyze menu (a second door; the library-header Compare
// stays). Rendered here with its own open state; not modified.
import CompareSequencesDialog from "./CompareSequencesDialog";
import SequenceDomainsResultDialog from "./SequenceDomainsResultDialog";
// protein analyze bot — the second door into the protein-properties engine.
import ProteinPropertiesDialog from "./ProteinPropertiesDialog";
// sequence editor master — the third door: a right-docked drawer that opens when
// a coding feature is selected, reflowing the viewer narrower (never overlaying).
import ProteinPropertiesDrawer from "./ProteinPropertiesDrawer";
import {
  isCodingFeature,
  translateFeature,
  trimTrailingStop,
} from "@/lib/sequences/feature-protein";
import { analyzeProtein } from "@/lib/calculators/protein";
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
import { reverseComplement, predictTm, type BindingSite } from "@/lib/sequences/primer";
// primer bases bot — base-level (zoomed) SnapGene-style primer rendering: map the
// stored oligo onto template columns so annealing bases sit over the template and
// the 5' tail / mismatches pop off.
import { layoutPrimerBases, type PrimerBaseCell } from "@/lib/sequences/primer-base-layout";
import {
  DEFAULT_VIEW_STATE,
  isFeatureVisible,
  COMMON_ENZYMES,
  loadDisplayPrefs,
  saveDisplayPrefs,
  type SequenceViewState,
} from "./sequence-view-state";
import SequenceZoomControl from "./SequenceZoomControl";
import SequenceOverviewBar, { type OverviewFeature } from "./SequenceOverviewBar";
import SequenceOverviewZoomSlider from "./SequenceOverviewZoomSlider";
import LinearMap, { type LinearMapFeature } from "./LinearMap";
import { spanFromShiftClick, buildFeatureCard, buildPrimerCard } from "@/lib/sequences/linear-map-select";
import SequenceTabBar, {
  type SequenceViewMode,
  type SequenceFlyoutMode,
} from "./SequenceTabBar";
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
  SequencePromptDialog,
  type EditMenuItem,
} from "./SequenceEditMenu";
import { useContextMenu } from "@/components/context-menu/ContextMenuProvider";
// enhanced find bot — the inline Find box now lives in its own file as the
// SnapGene-style search family (DNA exact + closest-match fallback / by-name /
// protein). It owns mode + query and reports matches up via onResults.
import { SequenceFindBox, type FindResult } from "./SequenceFindBox";
import type { FindMatch } from "@/lib/sequences/find";
import { seqIdentity } from "@/lib/sequences/find";
// sequence editor master (redesign phase 5). results as artifacts. A completed
// Align / Find-domains run persists a per-sequence result artifact, surfaced in
// the History tab's Results section and re-openable from there.
import {
  listArtifacts,
  saveArtifact,
  deleteArtifact,
  newArtifactId,
  isArtifactStale,
  type Artifact,
  type AlignmentArtifactResult,
  type DomainsArtifactResult,
} from "@/lib/sequences/artifacts";
import { formatSummaryLine } from "@/lib/sequences/compare-format";
import { Icon } from "@/components/icons";
import { type ExportMenuItem } from "./SequenceExportMenu";
import {
  SequenceOperationsRail,
  ActionList,
  InspectorSection,
  InspectorCue,
  type RailOperation,
  type OperationAction,
} from "./SequenceOperationsRail";
import {
  deriveSelectionKind,
  buildContextBar,
  type SelectionKind,
} from "@/lib/sequences/inspector-context";
import type {
  ArtifactNavItem,
  EditorCommand,
  PaletteContext,
  SequenceNavItem,
} from "./editor-commands";
import { useBeakerSearch } from "@/components/beaker-search/BeakerSearchProvider";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import { formatRelative } from "@/components/AttributionChip";
import { useAutoOpenInspector } from "./useAutoOpenInspector";
import HoverCardActionHint from "./HoverCardActionHint";
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
  copyBottomStrand3to5,
  copyAminoAcids,
  copyAminoAcids3Letter,
  reverseComplementClip,
  invertSelection,
  parseSelectRange,
  parseGoTo,
  caseTransform,
  reverseComplementRange,
} from "@/lib/sequences/edit-ops";
import { getMolecularClip } from "@/lib/sequences/molecular-clipboard";

const SeqViz = dynamic(() => import("@/vendor/seqviz"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-body text-foreground-muted">
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
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
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
// sequence editor master. The OPERATIONS RAIL icon set (redesign phase 1).
// Inline SVG, stroke-only, matching the editor's existing toolbar glyphs and
// the v2 mockup. No emoji, no icon library.
function railSvg(children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[19px] w-[19px]"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const RailIcons = {
  primers: railSvg(
    <>
      <line x1="3" y1="17" x2="21" y2="17" />
      <path d="M6 11h9l-2.5-2.5M6 11l2.5 2.5" />
    </>,
  ),
  cloning: railSvg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 6.9 4" strokeWidth="4" />
    </>,
  ),
  cut: railSvg(
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 7l12 9M8 17L20 8" />
    </>,
  ),
  annotate: railSvg(
    <>
      <path d="M4 20 13.5 10.5" />
      <path d="M16 3.5l1.3 2.7 2.9 1.3-2.9 1.3L16 11.5l-1.3-2.7L11.8 7.5l2.9-1.3z" />
      <path d="M6 5l.6 1.4L8 7l-1.4.6L6 9l-.6-1.4L4 7l1.4-.6z" />
    </>,
  ),
  align: railSvg(
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
    </>,
  ),
  protein: railSvg(
    <>
      <path d="M4.5 13 8 8.5 12 12.5 16 8.5 19.5 13" strokeWidth="1.6" />
      <circle cx="4.5" cy="13" r="1.8" />
      <circle cx="8" cy="8.5" r="1.8" />
      <circle cx="12" cy="12.5" r="1.8" />
      <circle cx="16" cy="8.5" r="1.8" />
      <circle cx="19.5" cy="13" r="1.8" />
    </>,
  ),
  tree: railSvg(
    <>
      <path d="M12 20.5V7" />
      <path d="M10.5 20.5h3" />
      <circle cx="12" cy="4.8" r="1.7" />
      <path d="M12 11 7.6 8.4" />
      <circle cx="6.2" cy="7.6" r="1.7" />
      <path d="M12 11 16.4 8.4" />
      <circle cx="17.8" cy="7.6" r="1.7" />
      <path d="M12 15 8 12.9" />
      <circle cx="6.6" cy="12.1" r="1.7" />
      <path d="M12 15 16 12.9" />
      <circle cx="17.4" cy="12.1" r="1.7" />
    </>,
  ),
  export: railSvg(
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </>,
  ),
  more: railSvg(
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>,
  ),
} as const;

// sequence editor master. Small inline-SVG glyphs for the inspector action
// tiles (redesign phase 1). Inline SVG, never emoji or a symbol font (the house
// rule is every user-facing icon is a custom inline SVG). Single capital
// letters (the cloning chemistry initials, the mutagenesis M) stay as plain
// text labels, which is text, not an icon.
function actionSvg(children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const ActionGlyphs = {
  plus: actionSvg(<path d="M12 5v14M5 12h14" />),
  list: actionSvg(<path d="M4 7h16M4 12h16M4 17h10" />),
  layer: actionSvg(
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
    </>,
  ),
  check: actionSvg(<path d="M4 12l5 5L20 6" />),
  refresh: actionSvg(
    <>
      <path d="M4 12a8 8 0 0 1 13.5-5.5L20 9" />
      <path d="M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-13.5 5.5L4 15" />
      <path d="M4 20v-5h5" />
    </>,
  ),
  align: actionSvg(
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
    </>,
  ),
  protein: actionSvg(
    <>
      <path d="M4.5 13 8 8.5 12 12.5 16 8.5 19.5 13" strokeWidth="1.6" />
      <circle cx="4.5" cy="13" r="1.8" />
      <circle cx="8" cy="8.5" r="1.8" />
      <circle cx="12" cy="12.5" r="1.8" />
      <circle cx="16" cy="8.5" r="1.8" />
      <circle cx="19.5" cy="13" r="1.8" />
    </>,
  ),
  tree: actionSvg(
    <>
      <path d="M12 20.5V7" />
      <path d="M10.5 20.5h3" />
      <circle cx="12" cy="4.8" r="1.7" />
      <path d="M12 11 7.6 8.4" />
      <circle cx="6.2" cy="7.6" r="1.7" />
      <path d="M12 11 16.4 8.4" />
      <circle cx="17.8" cy="7.6" r="1.7" />
      <path d="M12 15 8 12.9" />
      <circle cx="6.6" cy="12.1" r="1.7" />
      <path d="M12 15 16 12.9" />
      <circle cx="17.4" cy="12.1" r="1.7" />
    </>,
  ),
  search: actionSvg(
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
  ),
  download: actionSvg(
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </>,
  ),
  copy: actionSvg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
  ),
  paste: actionSvg(
    <>
      <path d="M9 4h6v3H9zM7 5H5v15h14V5h-2" />
      <path d="M12 10v6M9 13l3 3 3-3" />
    </>,
  ),
  pencil: actionSvg(
    <>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </>,
  ),
} as const;

/** A small label-over-value chip for the contextual inspector readout (Length /
 *  Tm / GC), matching the mockup `.readout .r`. Calm tinted tile, no emoji. */
function InspectorReadoutChip({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-[68px] rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted dark:text-foreground-muted">
        {k}
      </div>
      <div className="text-base font-bold text-foreground">{v}</div>
    </div>
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
    ? "bg-brand-action text-white hover:bg-brand-action/90 disabled:hover:bg-brand-action/90"
    : "text-foreground-muted hover:bg-surface-sunken";
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
      className="pointer-events-none absolute z-30 flex items-center gap-3 rounded-lg border border-border bg-surface-overlay/95 px-3 py-1.5 text-meta text-foreground-muted shadow-md backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      <SelectionReadoutContent readout={readout} />
    </div>
  );
}

// Stable empty default for the collection sibling list, so an omitted prop does
// not churn the palette's jump-to memo.
const EMPTY_COLLECTION_SEQUENCES: SequenceRecord[] = [];

// A calm, stable swatch color for the organism dot on the palette context card.
// A small fixed palette indexed by a hash of the name, so the same organism
// always reads the same hue without pulling in a color engine.
const ORGANISM_SWATCHES = [
  "#0284c7",
  "#16a34a",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#0d9488",
];
function swatchForOrganism(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return ORGANISM_SWATCHES[Math.abs(hash) % ORGANISM_SWATCHES.length];
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
  onApplyTaxonomy,
  onExploreInTree,
  onLookupTaxonomy,
  onOpenAssemble,
  onCreateSequenceFromRegion,
  collectionSequences = EMPTY_COLLECTION_SEQUENCES,
  collectionLabel,
  onOpenSequence,
  onDirtyChange,
}: {
  sequence: SequenceDetail;
  /** persist the current GenBank; resolves true on success. Unused when readOnly. */
  onSave?: (genbank: string) => Promise<boolean>;
  saving?: boolean;
  /** Persist an NCBI enrichment: the rewritten GenBank (organism in the source
   *  feature) plus the organism / tax id / named lineage sidecar fields. The page
   *  writes them and refreshes. Absent in read-only / embedded surfaces. */
  onEnriched?: (result: EnrichResult) => Promise<void>;
  /** Apply a taxonomy (the "Paste taxonomy" action) to THIS open sequence. Writes
   *  the rewritten GenBank source feature + the organism / tax id / lineage
   *  sidecar through the page's shared write path, then refreshes. Resolves true
   *  on success. Absent in read-only / embedded surfaces. */
  onApplyTaxonomy?: (taxonomy: SequenceTaxonomy) => Promise<boolean>;
  /** Optional cross-link from the organism lineage chip into the taxonomy tree
   *  explorer, centered on this sequence's tax id. Absent in read-only / embedded
   *  surfaces. */
  onExploreInTree?: (taxId?: string) => void;
  /** Optional door into the standalone organism-to-lineage lookup dialog. Absent
   *  in read-only / embedded surfaces. */
  onLookupTaxonomy?: () => void;
  /** Optional hook into the library-level Assemble / cloning workspace (the
   *  four chemistries). The operations rail's Cloning panel opens it. The
   *  Assemble dialog is owned by the /sequences page, so the page passes this
   *  in; absent in embedded / read-only surfaces, where the rail's Cloning
   *  panel falls back to a calm note. */
  onOpenAssemble?: () => void;
  /** sequences / extract-locus — create a NEW standalone library sequence from a
   *  region of THIS one (a selected feature, which carries its strand, or the live
   *  base selection). The child builds the ImportedSequence via the pure extract
   *  engine; the page owns the create + list refresh + selection and resolves the
   *  new sequence's id (or null on failure). Absent in read-only / embedded
   *  surfaces, where the Extract button self-hides. */
  onCreateSequenceFromRegion?: (imported: ImportedSequence) => Promise<number | null>;
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
  /** The OTHER sequences in the open collection (the page passes inCollection
   *  minus the open one), surfaced as "Jump to a sequence" rows in the command
   *  palette. Default empty (the group self-hides). */
  collectionSequences?: SequenceRecord[];
  /** The collection name, for the palette's "Jump to a sequence" group hint. */
  collectionLabel?: string;
  /** Switch the editor to another sequence by id (the page's setSelectedId).
   *  Wires the "Jump to a sequence" rows. Absent => those rows self-hide. */
  onOpenSequence?: (id: number) => void;
  /** Notify the parent when the unsaved-edits flag changes, so it can guard a
   *  sequence switch. Absent in read-only / embedded surfaces. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const editor = useSequenceEditor(sequence);
  const { doc, annotations: docAnnotations, applyEdit, undo, redo, canUndo, canRedo, dirty } = editor;

  // Unsaved-edits safety net. The editor is explicit-save with no autosave, so
  // a refresh / tab close with pending edits would silently lose them. Warn the
  // browser while dirty (covers reload, close, and full-page navigation), and
  // surface the dirty flag to the parent so it can confirm a sequence switch.
  // SPA navigation to other in-app routes is not covered here (App Router has no
  // stable route-guard hook); the per-sequence switch guard lives in the page.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (readOnly || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, readOnly]);

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

  // sequence editor master. The app-scoped taxonomy clipboard (separate from the
  // molecular bases clipboard + the OS clipboard), persisted to localStorage. The
  // Analyze menu's Copy taxonomy fills it; Paste taxonomy reads it. Re-renders the
  // menu enablement reactively when a copy lands or the clipboard clears.
  const { copied: copiedTaxonomy, copyTaxonomy } = useTaxonomyClipboard();
  // The pending "Paste taxonomy" inline confirm for the open sequence (names the
  // organism being pasted). null = closed.
  const [pasteTaxConfirm, setPasteTaxConfirm] = useState<{
    taxonomy: SequenceTaxonomy;
    fromName: string;
  } | null>(null);
  // The calm taxonomy copy / paste toast, auto-dismissed after a few seconds.
  const [taxStatus, setTaxStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!taxStatus) return;
    const t = setTimeout(() => setTaxStatus(null), 6000);
    return () => clearTimeout(t);
  }, [taxStatus]);

  // sequence editor master — the calm Copy map image toast. `tone` colors the
  // banner (success vs a gentle warning) and the text carries the message. Auto
  // dismissed after a few seconds, same cadence as the taxonomy toast.
  const [copyStatus, setCopyStatus] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  useEffect(() => {
    if (!copyStatus) return;
    const t = setTimeout(() => setCopyStatus(null), 6000);
    return () => clearTimeout(t);
  }, [copyStatus]);

  // The pending confirmation request (Cut/range-delete/Paste). null = closed.
  const [confirm, setConfirm] = useState<SequenceConfirmRequest | null>(null);

  // Phase 2c — view controls (calm-by-default) + the feature add/edit dialog +
  // the currently-selected feature row, and an externally-driven zoom selection.
  // initialShowEnzymes (additive) starts the cut-site layer ON for embeds where
  // the cut sites are the point (restriction / Golden Gate). Default off keeps
  // the standalone editor's calm-by-default behavior.
  // The standalone workbench remembers the display-layer toggles + wrap mode
  // across sequences and reloads (loadDisplayPrefs). Embedded / read-only
  // surfaces (the Cloning preview) always open in the calm default so a saved
  // preference does not leak into them. The lazy initializer seeds straight from
  // the persisted subset, so the persist effect below never writes the default
  // over the saved value on mount (the list-width clobber lesson).
  const persistPrefs = !embedded && !readOnly;
  const [view, setView] = useState<SequenceViewState>(() => {
    const base = initialShowEnzymes
      ? { ...DEFAULT_VIEW_STATE, showEnzymes: true }
      : DEFAULT_VIEW_STATE;
    return persistPrefs ? { ...base, ...loadDisplayPrefs() } : base;
  });
  useEffect(() => {
    if (persistPrefs) saveDisplayPrefs(view);
  }, [persistPrefs, view]);
  // seq nav bot — the SnapGene BOTTOM-TAB view switcher. `viewMode` is the
  // primary "which view" state (Map / Sequence / Features / Primers /
  // History). Restriction enzymes are a display LAYER, not a tab.
  //
  // seq flyout bot — Map and Sequence are the only CANVAS modes (they swap the
  // SeqViz viewer: Map = a zoomed-out feature map, Sequence = base-level detail).
  // Features / Primers / History no longer blank the canvas. We keep ONE
  // `viewMode` state (so every existing setViewMode(...) caller keeps working)
  // and DERIVE two things from it:
  //   - `lastCanvasMode`: the most recent Map/Sequence value. The canvas always
  //     renders THIS, so the molecule stays mounted underneath an open flyout.
  //   - `openFlyout`: features/primers/history when viewMode is one of those,
  //     else null. That branch renders in a dismissable overlay over the canvas
  //     instead of replacing it.
  // setViewMode("primers") therefore OPENS the Primers flyout over the live
  // canvas (it never blanks it); setViewMode("map"|"sequence") swaps the canvas
  // and closes the flyout. This is orthogonal to the horizontal
  // SequenceDisplayStrip (which toggles WHAT is drawn on the map).
  const [viewMode, setViewMode] = useState<SequenceViewMode>(initialViewMode ?? "sequence");
  // The last Map/Sequence value seen. Seeded from the initial mode when it is a
  // canvas mode, else defaults to "map" (so a `?view=features` deep link opens
  // the flyout over the Map, never a blank canvas).
  const [lastCanvasMode, setLastCanvasMode] = useState<"map" | "sequence">(
    initialViewMode === "sequence" ? "sequence" : "map",
  );
  // Keep lastCanvasMode in lockstep with viewMode whenever viewMode is itself a
  // canvas mode (covers deep-link / command-palette / programmatic setViewMode
  // callers, not just the tab bar's onChange).
  useEffect(() => {
    if (viewMode === "map" || viewMode === "sequence") setLastCanvasMode(viewMode);
  }, [viewMode]);
  // Which flyout (if any) is open over the canvas. null on the canvas modes.
  const openFlyout: SequenceFlyoutMode | null =
    viewMode === "features" || viewMode === "primers" || viewMode === "history"
      ? viewMode
      : null;
  const [featureEditor, setFeatureEditor] = useState<FeatureEditorRequest | null>(null);
  // annotate-from-reference bot — homology-based "transfer features from a
  // reference" dialog (open via the Feature menu).
  const [annotateRef, setAnnotateRef] =
    useState<AnnotateFromReferenceRequest | null>(null);
  const [detectReq, setDetectReq] = useState<DetectFeaturesRequest | null>(null);
  // sequence editor master. The opt-in "Enrich from NCBI" dialog open state.
  const [enrichOpen, setEnrichOpen] = useState(false);
  // menu reorg bot. The Compare/Align dialog, opened from the Align rail
  // operation (a second door into the same library-level dialog the library
  // header opens).
  const [compareOpen, setCompareOpen] = useState(false);
  // protein analyze bot. The Protein properties dialog, opened from the
  // Protein rail operation.
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
  // sequence editor master. The OPERATIONS RAIL active operation (redesign
  // phase 1). null = the inspector is collapsed to just the rail (reclaiming
  // canvas width). Picking the active op again collapses it. The rail itself is
  // always visible. Not persisted (out of scope for phase 1).
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const toggleOp = useCallback(
    (id: string) => setActiveOp((cur) => (cur === id ? null : id)),
    [],
  );
  // sequence editor master (BeakerSearch step 1). The Cmd-K COMMAND PALETTE now
  // lives in the app-shell BeakerSearchProvider. This view OPENS it (the rail
  // "More" launcher + the front-door pill) and REGISTERS its command source (see
  // beakerSource below); the provider owns the open state and the global Cmd-K
  // listener.
  const { openPalette } = useBeakerSearch();
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

  // seq editops bot — Edit-menu plumbing. The Find box (open + query + match
  // results + active match) and the Select Range / Go To prompt dialogs.
  //
  // sequence editor master. The right-click context menu now routes through the
  // website-wide framework. openMenu opens the ONE shared cursor-anchored menu
  // (see ContextMenuProvider); the onContextMenu handler hit-tests the click and
  // passes either the feature items or the bases items.
  const { openMenu } = useContextMenu();
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
  // sequence editor master. QUICK-RENAME prompt for the feature right-click menu.
  // Holds the index being renamed (null = closed) so the dialog can prefill the
  // feature's current name and apply on confirm.
  const [renameFeatureIdx, setRenameFeatureIdx] = useState<number | null>(null);

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

  // Resolve each projected annotation back to its index in the source
  // `doc.features` list (annotations drop primer_bind and carry no index, so we
  // key by name|start|end, the same fallback chain handleMapFeatureClick uses).
  // First-match wins on duplicate keys. Shared by the overview strip AND the
  // right-click feature-id stamp below.
  const featureIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    doc.features.forEach((f, i) => {
      const key = `${f.name}|${f.start}|${f.end}`;
      if (!m.has(key)) m.set(key, i);
    });
    return m;
  }, [doc.features]);

  // translation on the feature. The features whose translation is currently
  // shown (global toggle or per-feature opt-in). When a feature is translated it
  // renders as the amino-acid row sitting on its own feature-colored translation
  // handle, so we SUPPRESS its duplicate annotation bar below (otherwise the
  // same feature paints twice, the detached "extra feature" look). Keyed
  // name|start|end to match the annotation projection. Shared with the
  // cdsTranslations track build so the selection logic runs once.
  const translatedFeatures = useMemo(
    () =>
      selectTranslationFeatures(doc.features, {
        globalOn: view.showTranslation,
        isExplicit: (f) => readNoteFlag(f.notes, TRANSLATE_NOTE_KEY),
      }),
    [doc.features, view.showTranslation],
  );
  const translatedKeys = useMemo(
    () => new Set(translatedFeatures.map((f) => `${f.name}|${f.start}|${f.end}`)),
    [translatedFeatures],
  );

  // VIEW CONTROLS are the lever for the calm default: SeqViz is prop-driven, so
  // a hidden layer is just a filtered prop. We filter the annotations by the
  // per-type / per-feature / master toggles before handing them to SeqViz.
  const annotations: AnnotationProp[] = useMemo(() => {
    // A translated feature's bar is replaced by its LINEAR translation handle, so
    // we normally drop the duplicate bar. But the CIRCULAR map has no translation
    // layer, so whenever a ring is on screen (the standalone Map or the
    // side-by-side "both" view) we must KEEP every arc, or enabling translation
    // silently erases the feature from the ring. annotationBarsToDraw encodes
    // that rule; translation then simply ADDS its layer on top.
    const hasCircularViewer = doc.circular && !view.forceLinear;
    return annotationBarsToDraw(
      docAnnotations,
      (a) => translatedKeys.has(`${a.name}|${a.start}|${a.end}`),
      hasCircularViewer,
    )
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
        // sequence editor master. Stamp a stable, index-encoding id onto each
        // annotation. SeqViz preserves an `id` we pass (its parseAnnotations
        // spreads our object AFTER its randomID default, so ours wins) and
        // renders it as the element id + class in BOTH the linear and circular
        // viewers. A right-click reads it back to know which feature was hit.
        const idx = featureIndexByKey.get(`${a.name}|${a.start}|${a.end}`);
        return {
          name: a.name,
          start: a.start,
          end: a.end,
          direction: a.direction,
          color: a.color,
          ...(idx != null ? { id: featureDomId(idx) } : {}),
          // seq introns bot. Pass exon spans through to SeqViz so a multi-exon
          // (join) feature draws exon boxes + a dashed intron connector. Absent
          // for single-span features (unchanged rendering).
          ...(a.segments && a.segments.length > 1 ? { segments: a.segments } : {}),
        };
      });
  }, [docAnnotations, view, featureIndexByKey, translatedKeys, doc.circular]);

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
    // The chosen set (central-dogma dedup: one track per locus) is computed once
    // in `translatedFeatures` above and shared, so the same features that get a
    // translation track are exactly the ones whose annotation bar is suppressed.
    return translatedFeatures.map((f) => ({
      start: f.start,
      end: f.end,
      direction: f.strand === -1 ? -1 : 1,
      name: f.name,
      // The translation handle now reads the FEATURE's color (the one the user
      // set), falling back to the per-type default. So a translated protein
      // matches its feature color, and overlapping proteins stay distinguishable.
      color: f.color || colorForType(f.type),
      // seq introns bot — for a multi-exon (join) CDS, pass the exon spans so
      // SeqViz splices the protein (translates concatenated exon bases, not the
      // raw span through the introns) and shows a dashed gap over the introns.
      ...(f.locations && f.locations.length > 1 ? { segments: f.locations } : {}),
    }));
  }, [translatedFeatures]);

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

  // seq flyout bot — flyout open/close plumbing for the bottom tab bar.
  //   closeFlyout: drop back to the last canvas mode (Map / Sequence).
  //   selectCanvas: pick a canvas mode (also closes any open flyout, since the
  //     derived openFlyout becomes null once viewMode is a canvas mode).
  //   toggleFlyout: open a flyout, or close it if it is already the open one.
  const closeFlyout = useCallback(() => {
    setViewMode((cur) =>
      cur === "features" || cur === "primers" || cur === "history"
        ? lastCanvasMode
        : cur,
    );
  }, [lastCanvasMode]);
  const selectCanvas = useCallback((mode: "map" | "sequence") => {
    setViewMode(mode);
  }, []);
  const toggleFlyout = useCallback(
    (mode: SequenceFlyoutMode) => {
      setViewMode((cur) => (cur === mode ? lastCanvasMode : mode));
    },
    [lastCanvasMode],
  );
  // seq flyout bot — NO SOFT-LOCK. Escape always dismisses an open flyout (in
  // addition to the button toggle + the panel's own close X), landing back on the
  // live canvas. Capture phase so it closes even if a child handles Escape, but it
  // is a no-op when no flyout is open so it never swallows other Escape uses.
  useEffect(() => {
    if (!(viewMode === "features" || viewMode === "primers" || viewMode === "history"))
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeFlyout();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [viewMode, closeFlyout]);

  // seq flyout bot — `canvasMode` is the mode the CANVAS renders. Map / Sequence
  // are the canvas modes; when a flyout (features/primers/history) is open the
  // canvas keeps rendering the last canvas mode underneath, so the molecule never
  // unmounts. All map-rendering branches below key off `canvasMode`, NOT
  // `viewMode` (which may be a flyout value). `editable` additionally requires no
  // flyout open so you cannot type into bases hidden under a panel.
  const canvasMode = lastCanvasMode;

  // The topology toggle in the rail can force a circular plasmid to render as
  // linear; a genuinely linear molecule always renders linear. For a circular
  // plasmid, the Map tab shows JUST the ring (full size, no sequence panel) and
  // the Sequence tab shows the ring PLUS the linear sequence ("both").
  const viewer = doc.circular && !view.forceLinear
    ? canvasMode === "map"
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
  // seq flyout bot — the canvas is ALWAYS shown now. Features / Primers / History
  // pop a flyout OVER it instead of replacing it, so `showViewer` is constant.
  // The few places that used `showViewer` to mean "is a canvas mode active"
  // (greying the Show strip / zoom cluster off-canvas, the protein drawer guard)
  // now use `flyoutOpen` instead. Map/Sequence-specific canvas behaviour keys off
  // `canvasMode`.
  const flyoutOpen = openFlyout !== null;
  const showViewer = true;
  const isMapView = canvasMode === "map";
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
  // seq flyout bot — track the CANVAS mode (Map / Sequence) here, not viewMode.
  // We want to reframe only on the transition INTO the Sequence canvas; opening a
  // flyout no longer changes the canvas, so it must not retrigger this.
  const prevCanvasModeRef = useRef(canvasMode);
  useEffect(() => {
    const prev = prevCanvasModeRef.current;
    prevCanvasModeRef.current = canvasMode;
    if (canvasMode !== "sequence" || prev === "sequence") return;
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
  }, [canvasMode, isLinearViewer, externalSel, scrollMainToBp, doc.seq.length]);

  // Features projected to the overview bar (whole sequence, as arrows). Uses the
  // same visibility filtering as the main map so hidden types stay hidden.
  // (featureIndexByKey, the name|start|end -> doc index resolver this consumes,
  // is defined once up by the annotations projection and shared.)
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

  // ── Phase 5 (results as artifacts) ──────────────────────────────────────────
  // A content fingerprint of the LIVE molecule. seqIdentity over the canonical
  // (bases + features + topology) is the cheap length+hash key the History tab's
  // Results section uses to flag a saved result STALE once the sequence moves on.
  const sequenceVersion = useMemo(() => seqIdentity(headCanonical), [headCanonical]);
  // The loaded result artifacts for THIS sequence, newest first. Loaded once per
  // sequence/owner; the save/delete handlers update it in place so the History
  // tab reflects a new result without a reload.
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  // A saved alignment artifact re-opened into the Compare dialog in a read view
  // (null = a normal, non-seeded open).
  const [seededAlignment, setSeededAlignment] = useState<AlignmentArtifactResult | null>(null);
  // A saved domains artifact re-opened into the read-only hit-list dialog, with
  // a stale flag captured at open time (true when the sequence moved on since).
  const [domainsResult, setDomainsResult] = useState<
    { payload: DomainsArtifactResult; stale: boolean } | null
  >(null);
  // A calm, auto-dismissed toast for a failed best-effort artifact save / delete.
  const [artifactToast, setArtifactToast] = useState<string | null>(null);
  useEffect(() => {
    if (!artifactToast) return;
    const t = setTimeout(() => setArtifactToast(null), 6000);
    return () => clearTimeout(t);
  }, [artifactToast]);

  // Load the saved results for the open sequence.
  useEffect(() => {
    if (!historyOwner) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listArtifacts(historyOwner, sequence.id);
        if (!cancelled) setArtifacts(list);
      } catch {
        // a missing / unreadable sidecar just yields no results; never block.
        if (!cancelled) setArtifacts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOwner, sequence.id]);

  // Persist a completed ALIGN run as an alignment artifact (best-effort). Titled
  // from the compared names, summarized from the stats; a failed write is a calm
  // toast, never an exception into the operation.
  const persistAlignmentArtifact = useCallback(
    (res: AlignmentArtifactResult) => {
      if (!historyOwner) return;
      const aName = res.aName ?? "sequence A";
      const bName = res.bName ?? "sequence B";
      const summary = res.large
        ? `${res.large.hsps.length} shared ${res.large.hsps.length === 1 ? "region" : "regions"}`
        : formatSummaryLine(res.summary);
      const artifact: Artifact = {
        id: newArtifactId(),
        type: "alignment",
        title: `Align ${aName} to ${bName}`,
        summary,
        createdAt: new Date().toISOString(),
        lineage: {
          sequenceId: sequence.id,
          sequenceVersion,
          inputs: {
            referenceId: res.bId,
            referenceName: res.bName,
            mode: res.mode,
            scheme: res.scheme,
            iupac: res.iupac,
          },
        },
        result: res,
      };
      void (async () => {
        try {
          await saveArtifact(historyOwner, sequence.id, artifact);
          setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)]);
        } catch {
          setArtifactToast("Could not save this result to the History tab.");
        }
      })();
    },
    [historyOwner, sequence.id, sequenceVersion],
  );

  // Persist a completed FIND-DOMAINS scan as a domains artifact (best-effort).
  const persistDomainsArtifact = useCallback(
    (payload: DomainsArtifactResult) => {
      if (!historyOwner) return;
      const n = payload.hits.length;
      const names = payload.hits
        .map((h) => h.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      const summary =
        n === 0
          ? "No domain hits"
          : `${n} ${n === 1 ? "hit" : "hits"}${names ? ` (${names}${n > 2 ? ", ..." : ""})` : ""}`;
      const artifact: Artifact = {
        id: newArtifactId(),
        type: "domains",
        title: `Domains in ${payload.featureName || "feature"}`,
        summary,
        createdAt: new Date().toISOString(),
        lineage: {
          sequenceId: sequence.id,
          sequenceVersion,
          inputs: {
            featureName: payload.featureName,
            featureIndex: payload.featureIndex,
            source: payload.source,
          },
        },
        result: payload,
      };
      void (async () => {
        try {
          await saveArtifact(historyOwner, sequence.id, artifact);
          setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)]);
        } catch {
          setArtifactToast("Could not save this result to the History tab.");
        }
      })();
    },
    [historyOwner, sequence.id, sequenceVersion],
  );

  // Open a saved result from the Results section. Alignment re-seeds the Compare
  // dialog in a read view; domains opens a read-only hit-list. A snapshot, so we
  // never recompute on open (a STALE one still opens, with a re-run affordance).
  const handleOpenArtifact = useCallback(
    (artifact: Artifact) => {
      if (artifact.type === "alignment") {
        setSeededAlignment(artifact.result as AlignmentArtifactResult);
        setCompareOpen(true);
      } else {
        setDomainsResult({
          payload: artifact.result as DomainsArtifactResult,
          stale: isArtifactStale(artifact, sequenceVersion),
        });
      }
    },
    [sequenceVersion],
  );

  // Delete a saved result (best-effort; optimistic removal from the list).
  const handleDeleteArtifact = useCallback(
    (artifactId: string) => {
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
      if (!historyOwner) return;
      void (async () => {
        try {
          await deleteArtifact(historyOwner, sequence.id, artifactId);
        } catch {
          setArtifactToast("Could not delete this result.");
        }
      })();
    },
    [historyOwner, sequence.id],
  );

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

  // sequence editor master (redesign). Duplicate the feature (or primer) at
  // `index` through the undoable edit path. Declared BEFORE openEditFeature /
  // openEditPrimer because they now reference it (the popup Duplicate action).
  const duplicateFeatureAt = useCallback(
    (index: number) => editor.applyDocEdit((prev) => duplicateFeature(prev, index)),
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
        // sequence editor master (redesign). Duplicate the feature, then close
        // the popup. duplicateFeatureAt handles both features and primers.
        onDuplicate: () => {
          duplicateFeatureAt(index);
          setFeatureEditor(null);
        },
        onCancel: () => setFeatureEditor(null),
      });
    },
    [doc.features, doc.seq.length, editor, duplicateFeatureAt],
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
        // sequence editor master (redesign). Duplicate the primer, then close the
        // popup. Edit mode only (omitted in the read-only variant).
        onDuplicate: readOnly
          ? undefined
          : () => {
              duplicateFeatureAt(index);
              setPrimerEditor(null);
            },
        onCancel: () => setPrimerEditor(null),
      });
    },
    [doc.features, doc.seq, editor, readOnly, duplicateFeatureAt],
  );

  // sequence editor master — open the right-docked PROTEIN-PROPERTIES DRAWER for a
  // specific CDS / coding feature (the right-click "Translate to protein" and
  // "Find domains" actions). Select the feature (the drawer is gated on the
  // selected CODING feature) and clear any prior dismissal for it so a dismissed
  // drawer reopens. The domain-annotation flow lives INSIDE the drawer footer
  // (DomainAnnotationPanel), so both actions land on the same drawer; "Find
  // domains" just points the user at the Annotate-domains control there.
  const openProteinDrawerForFeature = useCallback(
    (index: number) => {
      const f = doc.features[index];
      if (!f || !isCodingFeature(f)) return;
      selectFeature(index);
      setProteinDrawerDismissedIdx((prev) => (prev === index ? null : prev));
    },
    [doc.features, selectFeature],
  );

  // sequence editor master — the oligo bases of a primer_bind feature, for the
  // "Copy primer sequence" action and the Tm read-out. Prefers the stored oligo
  // (the /note "primer <SEQ>" flag), else the template subsequence at the binding
  // site (reverse-complemented on the bottom strand), matching openEditPrimer's
  // initialOligo derivation. Returns "" when the feature is missing.
  const primerOligoAt = useCallback(
    (index: number): string => {
      const f = doc.features[index];
      if (!f) return "";
      return (
        readPrimerSeq(f) ||
        (f.strand === -1
          ? reverseComplement(doc.seq.slice(f.start, f.end))
          : doc.seq.slice(f.start, f.end))
      );
    },
    [doc.features, doc.seq],
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

  // sequence editor master. Apply a quick rename onto the feature at `index`
  // through the same undoable edit path as recolor.
  const renameFeatureAt = useCallback(
    (index: number, name: string) =>
      editor.applyDocEdit((prev) => renameFeature(prev, index, name)),
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

  // COPY BOTTOM STRAND 3' to 5': the complement of the selection in the same
  // left-to-right order (no reversal), the bottom strand drawn under the top ->
  // OS clipboard only. DNA / RNA only; gated by the menu like copyBottom.
  const copyBottom3to5 = useCallback(() => {
    if (!sel.hasRange || !isNucleotide) return;
    writeOsClipboard(copyBottomStrand3to5(doc.seq.slice(sel.lo, sel.hi), doc.seqType));
  }, [sel, isNucleotide, doc.seq, doc.seqType, writeOsClipboard]);

  // COPY AMINO ACIDS: frame-1 translation of the selection -> OS clipboard.
  const copyAA = useCallback(() => {
    if (!sel.hasRange) return;
    writeOsClipboard(copyAminoAcids(doc.seq.slice(sel.lo, sel.hi), doc.seqType));
  }, [sel, doc.seq, doc.seqType, writeOsClipboard]);

  // COPY AMINO ACIDS (3-letter): the same frame-1 residues as copyAA, rendered as
  // space-separated 3-letter codes (Met Val Ser ...) -> OS clipboard.
  const copyAA3 = useCallback(() => {
    if (!sel.hasRange) return;
    writeOsClipboard(copyAminoAcids3Letter(doc.seq.slice(sel.lo, sel.hi), doc.seqType));
  }, [sel, doc.seq, doc.seqType, writeOsClipboard]);

  // sequence editor master — COPY AS FASTA. The selected bases (or the whole
  // sequence when nothing is selected) as a one-record FASTA block, header named
  // after the molecule, written to the OS clipboard. Pure toFasta builds the text.
  const copyAsFasta = useCallback(() => {
    const bases = sel.hasRange ? doc.seq.slice(sel.lo, sel.hi) : doc.seq;
    if (!bases) return;
    writeOsClipboard(toFasta(doc.name || sequence.display_name || "sequence", bases));
  }, [sel, doc.seq, doc.name, sequence.display_name, writeOsClipboard]);

  // sequence editor master — COPY MAP IMAGE. Rasterize the live map to a PNG (the
  // same SVG to PNG path the Export menu uses) and write it to the OS clipboard as
  // an image, so the user can paste the map straight into a doc or slide. Must run
  // inside the click gesture for the clipboard write to be allowed. Every failure
  // mode (no canvas, no Clipboard image API, a denied write) lands on a calm toast
  // and never throws.
  const copyMapImage = useCallback(async () => {
    // Browsers without the image clipboard API (Safari historically): bail calmly.
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setCopyStatus({
        tone: "warn",
        text: "This browser cannot copy images. Use Export to save the map instead.",
      });
      return;
    }
    try {
      const out = await exportMapImage(viewerRef.current);
      if (!out || !out.png) {
        setCopyStatus({
          tone: "warn",
          text: "Could not render the map image. Use Export to save the map instead.",
        });
        return;
      }
      const blob = await fetch(out.png).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopyStatus({ tone: "ok", text: "Copied the map image." });
    } catch (err) {
      console.error("[sequence] copy map image failed", err);
      setCopyStatus({
        tone: "warn",
        text: "Could not copy the map image. Use Export to save the map instead.",
      });
    }
  }, []);

  // sequence editor master — REVERSE COMPLEMENT IN PLACE. Replace the selected
  // bases with their reverse complement as ONE undoable edit (same length, no
  // coordinate shift, features keep their positions). DNA / RNA only; gated by the
  // menu so it never fires on a protein or an empty range. The selection is left
  // as-is so the user can chain ops on the same span.
  const reverseComplementInPlace = useCallback(() => {
    if (!sel.hasRange || !isNucleotide) return;
    editor.applyDocEdit((prev) => reverseComplementRange(prev, sel.lo, sel.hi));
  }, [sel, isNucleotide, editor]);

  // sequence editor master — open the Protein properties DIALOG seeded from the
  // current selection (the same door the Analyze menu uses). The dialog reads
  // `sel` directly, so opening it is enough.
  const openProteinPropsForSelection = useCallback(() => {
    setProteinPropsOpen(true);
  }, []);

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
    (edit: SeqEdit): number | void => {
      if (readOnly) return 0; // read-only surface: ignore any edit intent
      if (edit.type === "delete" && edit.count > 1) {
        requestRangeDelete(edit.from, edit.from + edit.count);
        return;
      }
      // Filter any incoming base text (a typed key or a type-over-selection
      // replace) to the valid alphabet for this molecule type, so stray
      // characters like X/Q/8/Z never enter the sequence. If nothing valid
      // remains the whole keystroke is a no-op: we neither insert "" nor delete
      // the user's selection on an invalid key. The returned count tells the
      // viewer how far to advance the caret (0 == key dropped, caret unmoved).
      if (edit.type === "insert" || edit.type === "replace") {
        const text = sanitizeResidues(edit.text, doc.seqType);
        if (!text) return 0;
        applyEdit({ ...edit, text });
        return text.length;
      }
      applyEdit(edit);
    },
    [applyEdit, requestRangeDelete, readOnly, doc.seqType],
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

  // sequence editor master (BeakerSearch step 1). The GLOBAL Cmd-K / Ctrl-K
  // listener now lives in the app-shell BeakerSearchProvider, which owns it for
  // every page. The embedded preview's "Cmd-K inert" behavior is preserved by
  // NOT registering a source when embedded (see beakerSource below), so with no
  // active source the provider's listener does nothing.

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

  // sequences / extract-locus — "Extract to new sequence". Enabled when a feature
  // is selected OR a base range is active (and the page wired the create callback,
  // so it self-hides on read-only / embedded surfaces). A selected feature wins
  // (it carries strand); otherwise the live half-open [lo, hi) selection is cut on
  // the forward strand.
  const canExtractRegion =
    !!onCreateSequenceFromRegion &&
    !readOnly &&
    (selectedFeatureIdx != null || sel.hasRange);

  const handleExtractRegion = useCallback(async () => {
    if (!onCreateSequenceFromRegion) return;
    const sourceName = sequence.display_name || doc.name || "sequence";
    // The extract engine reads .seq + .annotations; feed it the LIVE edited
    // document (docAnnotations is the rendered SequenceAnnotation[], primer_bind
    // excluded), so the cut matches exactly what the user sees.
    const detailForExtract: SequenceDetail = {
      ...sequence,
      seq: doc.seq,
      annotations: docAnnotations,
    };

    let target: ExtractTarget;
    let name: string;
    if (selectedFeatureIdx != null) {
      const feat = doc.features[selectedFeatureIdx];
      if (!feat) {
        setCopyStatus({ tone: "warn", text: "That feature is no longer selected." });
        return;
      }
      // Decision: extract a selected feature BY COORDINATES (its own span +
      // strand), not by name. selectedFeatureIdx indexes doc.features, but the
      // engine's by-name lookup takes the FIRST annotation with that name and
      // docAnnotations drops primer_bind, so a name match could resolve to a
      // different instance on a sequence with duplicate feature names. Coords off
      // the selected feature's own span extract exactly the instance in hand.
      // feat.end is INCLUSIVE (the app convention); the target end is EXCLUSIVE.
      target = {
        start: feat.start,
        end: feat.end + 1,
        strand: feat.strand === -1 ? -1 : 1,
      };
      name = `${feat.name || "feature"} (from ${sourceName})`;
    } else if (sel.hasRange) {
      // The editor selection is already half-open [lo, hi); the target end is
      // EXCLUSIVE too, so pass it straight (strand 1, forward).
      target = { start: sel.lo, end: sel.hi };
      name = `${sourceName} region ${sel.lo + 1}..${sel.hi}`;
    } else {
      return;
    }

    const region = extractRegion(detailForExtract, target);
    if ("error" in region) {
      setCopyStatus({ tone: "warn", text: region.error });
      return;
    }
    const imported = extractedRegionToImported(region, name);
    const newId = await onCreateSequenceFromRegion(imported);
    if (newId == null) {
      setCopyStatus({ tone: "warn", text: "Could not create the extracted sequence." });
    }
  }, [
    onCreateSequenceFromRegion,
    sequence,
    doc.name,
    doc.seq,
    doc.features,
    docAnnotations,
    selectedFeatureIdx,
    sel.hasRange,
    sel.lo,
    sel.hi,
  ]);

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

  // sequence editor master — the COPY FAMILY for the toolbar Copy split button.
  // The caret next to the primary Copy button opens this flat, grouped list so
  // every copy variant is reachable from one place (mirrors SnapGene's Copy
  // submenu). The primary button itself runs doCopy; this list is additive and
  // does not touch the Edit menu's own copy items. Map image only appears when the
  // map viewer is mounted (absent on the Features / Primers / History tabs).
  const copyMenuItems = useMemo<EditMenuItem[]>(() => {
    const items: EditMenuItem[] = [
      { id: "copy-top", label: "Copy", shortcut: "Cmd C", enabled: sel.hasRange, onRun: doCopy },
      {
        id: "copy-bottom-5-3",
        label: "Copy bottom strand (5' to 3')",
        enabled: sel.hasRange && isNucleotide,
        group: true,
        onRun: copyBottom,
      },
      {
        id: "copy-bottom-3-5",
        label: "Copy bottom strand (3' to 5')",
        enabled: sel.hasRange && isNucleotide,
        onRun: copyBottom3to5,
      },
      {
        id: "copy-aa-1",
        label: "Copy amino acids (1-letter)",
        enabled: sel.hasRange && isNucleotide,
        group: true,
        onRun: copyAA,
      },
      {
        id: "copy-aa-3",
        label: "Copy amino acids (3-letter)",
        enabled: sel.hasRange && isNucleotide,
        onRun: copyAA3,
      },
      {
        id: "copy-fasta",
        label: "Copy as FASTA",
        enabled: doc.seq.length > 0,
        group: true,
        onRun: copyAsFasta,
      },
    ];
    if (showViewer) {
      items.push({
        id: "copy-map",
        label: "Copy map image",
        enabled: true,
        group: true,
        onRun: () => {
          void copyMapImage();
        },
      });
    }
    return items;
  }, [
    sel.hasRange,
    isNucleotide,
    doc.seq.length,
    showViewer,
    doCopy,
    copyBottom,
    copyBottom3to5,
    copyAA,
    copyAA3,
    copyAsFasta,
    copyMapImage,
  ]);

  // sequence editor master — the SELECTION right-click menu. Opened when a base
  // RANGE is selected and the click missed every feature. It leads with the
  // selection-aware power moves (create a feature here, design primers here, read
  // protein properties, flip the strand in place, copy as FASTA), then a divider,
  // then the FULL standard bases menu (Cut / Copy / Paste / case / find all stay,
  // reused verbatim from editMenuItems) so nothing is lost. Reverse-complement is
  // DNA / RNA only and is omitted on a protein or read-only surface (a destructive
  // edit). Copy as FASTA copies the selection (or the whole sequence with no
  // range, though this menu only opens WITH a range) to the OS clipboard.
  const selectionContextMenuItems = useMemo<EditMenuItem[]>(
    () =>
      buildSelectionMenuItems({
        hasRange: sel.hasRange,
        readOnly,
        isNucleotide,
        seqLength: doc.seq.length,
        createFeature: openAddFeature,
        designPrimers: () => openPrimerDialog("standard"),
        proteinProps: openProteinPropsForSelection,
        reverseComplementInPlace,
        copyAsFasta,
        basesMenu: editMenuItems,
      }),
    [
      sel.hasRange,
      readOnly,
      isNucleotide,
      doc.seq.length,
      openAddFeature,
      openPrimerDialog,
      openProteinPropsForSelection,
      reverseComplementInPlace,
      copyAsFasta,
      editMenuItems,
    ],
  );

  // selFeat is the currently selected feature (if any); the protein-properties
  // drawer gate below reads it. The feature / primer right-click menus are built
  // per-HIT-index by buildFeatureMenu / buildPrimerContextMenu, so there is no
  // selection-derived selIsPrimer / selIsCoding here anymore.
  const selFeat = selectedFeatureIdx != null ? doc.features[selectedFeatureIdx] : null;

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

  // sequence editor master. The Feature menu. The QUICK ops sit at the top (a
  // recolor swatch row + Rename) so a right-click on a feature lands its two most
  // common edits in one move, then Add / Edit / Duplicate, then Remove as the
  // destructive group. Analysis engines (Detect / Annotate) live in the Analyze
  // menu; the per-type show/hide list lives on the left rail.
  // sequence editor master — build the FEATURE menu for a GIVEN feature index,
  // delegating the item list to the pure buildFeatureMenuItems (lib). A builder
  // (not just a memo) so the right-click can pass the HIT index directly, since
  // openMenu snapshots the items at click time, before a selectFeature state
  // update would land. Passing null builds the greyed shell (no feature). The
  // toolbar dropdown calls it with the current selection (a memo below).
  const buildFeatureMenu = useCallback(
    (idx: number | null): EditMenuItem[] => {
      const f = idx != null ? doc.features[idx] : null;
      return buildFeatureMenuItems({
        idx,
        feature: f ?? null,
        isCoding: !!f && isCodingFeature(f),
        // A calm subset of the shared feature palette (the first eight tones).
        swatchColors: FEATURE_COLOR_SWATCHES.slice(0, 8),
        recolor: recolorFeatureAt,
        rename: setRenameFeatureIdx,
        add: openAddFeature,
        edit: openEditFeature,
        duplicate: duplicateFeatureAt,
        remove: deleteFeatureAt,
        openProtein: openProteinDrawerForFeature,
      });
    },
    [
      doc.features,
      recolorFeatureAt,
      openAddFeature,
      openEditFeature,
      duplicateFeatureAt,
      deleteFeatureAt,
      openProteinDrawerForFeature,
    ],
  );

  // sequence editor master. Copy the open sequence's taxonomy onto the app-scoped
  // taxonomy clipboard (the Analyze > Copy taxonomy action). Calm toast names the
  // organism. Guarded by the menu enablement (only when the sequence HAS one).
  const handleCopyTaxonomy = useCallback(() => {
    const organism = (sequence.organism ?? "").trim();
    if (!organism) return;
    copyTaxonomy({
      organism,
      tax_id: sequence.tax_id,
      tax_lineage: sequence.tax_lineage,
      copiedFromName: organism,
    });
    setTaxStatus(`Copied the taxonomy of ${organism}.`);
  }, [sequence.organism, sequence.tax_id, sequence.tax_lineage, copyTaxonomy]);

  // sequence editor master. Open the inline paste confirm for the open sequence
  // (Analyze > Paste taxonomy). The actual write runs from the confirm dialog so
  // the user sees the organism being pasted first.
  const handlePasteTaxonomy = useCallback(() => {
    if (copiedTaxonomy == null) return;
    setPasteTaxConfirm({
      taxonomy: {
        organism: copiedTaxonomy.organism,
        tax_id: copiedTaxonomy.tax_id,
        tax_lineage: copiedTaxonomy.tax_lineage,
      },
      fromName: copiedTaxonomy.copiedFromName ?? copiedTaxonomy.organism,
    });
  }, [copiedTaxonomy]);

  // sequence editor master. Run the confirmed paste onto the open sequence through
  // the page's shared write path, then toast. Refresh is handled by the page
  // (it invalidates the detail + summary queries), so the lineage chip updates.
  const runPasteTaxonomy = useCallback(async () => {
    if (!pasteTaxConfirm || !onApplyTaxonomy) return;
    const { taxonomy } = pasteTaxConfirm;
    setPasteTaxConfirm(null);
    const ok = await onApplyTaxonomy(taxonomy);
    if (ok) {
      setTaxStatus(`Pasted the taxonomy of ${taxonomy.organism}.`);
    }
  }, [pasteTaxConfirm, onApplyTaxonomy]);

  // sequence editor master. Escape dismisses the paste-taxonomy confirm (the
  // inline overlay otherwise only has scrim-click dismiss).
  useEscapeToClose(() => setPasteTaxConfirm(null), pasteTaxConfirm !== null);

  // sequence editor master — build the PRIMER right-click menu for a GIVEN feature
  // index. Like buildFeatureMenu, a builder so the router can pass the HIT index
  // (openMenu snapshots items at click time). Opened in place of the generic
  // feature menu when the click lands on a primer_bind feature. Focused primer
  // actions: edit the primer, copy its oligo, a calm Tm read-out (a disabled
  // informational row, not a button), then delete as the destructive group. The
  // oligo + Tm reuse the same derivation as the editor and predictTm (the Tm-chip
  // model), so the read-out never drifts. No primer-design reimplementation.
  const buildPrimerContextMenu = useCallback(
    (idx: number | null): EditMenuItem[] => {
      const f = idx != null ? doc.features[idx] : null;
      const isPrimer = !!f && (f.type || "").toLowerCase() === "primer_bind";
      const oligo = isPrimer && idx != null ? primerOligoAt(idx) : "";
      const tm = oligo.length >= 2 ? predictTm(oligo) : null;
      return buildPrimerMenuItems({
        idx,
        feature: f ?? null,
        oligo,
        tm,
        readOnly,
        edit: openEditPrimer,
        copyOligo: writeOsClipboard,
        remove: deleteFeatureAt,
      });
    },
    [doc.features, primerOligoAt, readOnly, openEditPrimer, deleteFeatureAt, writeOsClipboard],
  );

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

  // sequence editor master. The OPERATIONS RAIL registry (redesign phase 1).
  // Each rail item is a calm LAUNCHER for an operation, wired to the editor's
  // EXISTING handler / dialog (no engine is reimplemented here). Edit /
  // destructive actions are omitted on the read-only surface, exactly as the
  // menu bar already hides them. The selection-contextual inspector, the Cmd-K
  // palette, and results-as-artifacts are later phases and are not built here.
  const hasOrganism = Boolean(
    (sequence.organism ?? "").trim() || (sequence.tax_id ?? "").trim(),
  );

  // sequence editor master. The CONTEXTUAL inspector (redesign phase 3). The
  // inspector body + a header context bar adapt to the live selection. We
  // classify the selection into one SELECTION KIND (the visible-panel form of
  // the smart right-click we already built), then each rail op recomputes its
  // panel for that kind, and a fresh selection auto-opens the most relevant op.
  // selFeat / isCodingFeature were computed above for the menus, reused here so
  // the inspector and the right-click menu never disagree.
  const selFeatType = selFeat ? (selFeat.type || "") : null;
  const selFeatIsCoding = !!selFeat && isCodingFeature(selFeat);
  const selectionKind: SelectionKind = useMemo(
    () =>
      deriveSelectionKind({
        hasRange: sel.hasRange,
        selectedFeatureType: selFeatType,
        selectedFeatureIsCoding: selFeatIsCoding,
      }),
    [sel.hasRange, selFeatType, selFeatIsCoding],
  );

  // The selected CDS protein properties (length aa / mass / pI), reusing the
  // shared feature->protein path + analyzeProtein. Only computed for a coding
  // feature selection so non-CDS work pays nothing. Null when the translation
  // is too short to score. No protein engine is reimplemented here.
  const selectedCdsProps = useMemo(() => {
    if (selectionKind !== "feature-cds" || !selFeat) return null;
    const aaRaw = trimTrailingStop(translateFeature(doc.seq, selFeat));
    if (!aaRaw) return null;
    const r = analyzeProtein(aaRaw);
    if (!r) return { aa: aaRaw.length, massKDa: null, pI: null };
    return {
      aa: r.length,
      massKDa: r.molecularWeight / 1000,
      pI: r.isoelectricPoint,
    };
  }, [selectionKind, selFeat, doc.seq]);

  // The selected primer's oligo + Tm, for the "This primer" contextual section.
  // Reuses primerOligoAt + predictTm (the same derivation the right-click primer
  // menu uses), so the read-out never drifts.
  const selectedPrimerInfo = useMemo(() => {
    if (selectionKind !== "feature-primer" || selectedFeatureIdx == null || !selFeat) {
      return null;
    }
    const oligo = primerOligoAt(selectedFeatureIdx);
    const tm = oligo.length >= 2 ? predictTm(oligo) : null;
    return { idx: selectedFeatureIdx, name: selFeat.name || "this primer", oligo, tm };
  }, [selectionKind, selectedFeatureIdx, selFeat, primerOligoAt]);

  // The context bar shown between the inspector header and the body. The
  // organism line surfaces only when nothing else is selected (whole-sequence
  // scope), so picking a region or feature always reads "Acting on selection".
  const inspectorContextBar = useMemo(
    () =>
      buildContextBar({
        kind: selectionKind,
        lo: readout?.kind === "range" ? readout.lo : undefined,
        hi: readout?.kind === "range" ? readout.hi : undefined,
        len: readout?.kind === "range" ? readout.len : undefined,
        featureName: selFeat?.name ?? null,
        aa: selectedCdsProps?.aa ?? null,
        organism: hasOrganism ? sequence.organism?.trim() || `Tax id ${sequence.tax_id}` : null,
      }),
    [selectionKind, readout, selFeat?.name, selectedCdsProps?.aa, hasOrganism, sequence.organism, sequence.tax_id],
  );

  // AUTO-OPEN on a NEW selection (the Figma rule). When the user makes a fresh
  // selection we pop open the contextual op even if the inspector was collapsed,
  // region -> Primers, feature-cds -> Protein, feature-primer -> Primers. We key
  // on a derived selection-IDENTITY (kind + the feature index + the region span),
  // and only react when that identity CHANGES, so we never yank the user off a
  // panel they are configuring for the SAME selection, never thrash on a same-
  // kind re-render, and never auto-open Tree on mount (organism is whole-sequence
  // scope, not a fresh selection, so autoOpenOpForKind returns null for it).
  // Clearing the selection (kind -> none) does NOT close the inspector.
  const selectionIdentity = useMemo(() => {
    if (selectionKind === "none") return "none";
    if (selectionKind === "region") return `region-${sel.lo}-${sel.hi}`;
    return `${selectionKind}-${selectedFeatureIdx ?? "?"}`;
  }, [selectionKind, sel.lo, sel.hi, selectedFeatureIdx]);
  useAutoOpenInspector(selectionIdentity, selectionKind, setActiveOp);

  const railOperations = useMemo<RailOperation[]>(() => {
    const ops: RailOperation[] = [];

    // DESIGN group ------------------------------------------------------------
    // PRIMERS. Design from the editor's existing primer flows + the Primers
    // tab. Designing / adding a primer mutates, so the launcher actions hide in
    // read-only; the "open the Primers tab" jump stays (it is read-only safe).
    // The whole-sequence primer launchers, shown below every contextual primer
    // body so the design and the Primers-tab jump are always reachable.
    const primerLaunchers: OperationAction[] = [];
    if (!readOnly) {
      primerLaunchers.push(
        {
          id: "op-primer-design",
          label: sel.hasRange ? "Design forward + reverse" : "Design primers",
          sub: sel.hasRange ? "from the current selection" : "type or paste a region",
          glyph: "+",
          tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
          onRun: () => openPrimerDialog("standard"),
        },
        {
          id: "op-primer-mutagenesis",
          label: "Design a mutagenesis primer",
          sub: "site-directed mutagenesis",
          glyph: "M",
          onRun: () => openPrimerDialog("mutagenesis"),
        },
      );
    }
    primerLaunchers.push({
      id: "op-primer-list",
      label: "Open the Primers tab",
      sub: primerCount
        ? `${primerCount} primer${primerCount === 1 ? "" : "s"} on this sequence`
        : "design, check, and list primers",
      glyph: ActionGlyphs.list,
      onRun: () => setViewMode("primers"),
    });

    // CONTEXTUAL primer panel. A primer feature shows "This primer" (the same
    // actions the right-click primer menu surfaces), a region shows "Design
    // primers here" with a live Length / Tm / GC readout, and an empty selection
    // teaches the design move. The whole-sequence launchers sit below all three.
    let primerPanel: React.ReactNode;
    if (selectionKind === "feature-primer" && selectedPrimerInfo) {
      const p = selectedPrimerInfo;
      const primerActions: OperationAction[] = [];
      if (!readOnly) {
        primerActions.push({
          id: "op-this-primer-edit",
          label: "Edit primer",
          sub: p.oligo ? `${p.name}, ${p.oligo.length} nt` : p.name,
          glyph: ActionGlyphs.pencil,
          tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
          onRun: () => openEditPrimer(p.idx),
        });
      }
      if (p.oligo) {
        primerActions.push({
          id: "op-this-primer-copy",
          label: "Copy primer sequence",
          sub: p.oligo,
          glyph: ActionGlyphs.copy,
          onRun: () => writeOsClipboard(p.oligo),
        });
      }
      primerActions.push({
        id: "op-this-primer-specificity",
        label: "Check specificity",
        sub: p.tm != null ? `Tm ${p.tm.toFixed(1)} C` : "scan the template for off-target binding",
        glyph: "Tm",
        tileClass: "bg-surface-sunken text-foreground-muted dark:bg-surface-sunken dark:text-foreground-muted",
        onRun: openSpecificityCheck,
      });
      primerPanel = (
        <>
          <InspectorSection>This primer</InspectorSection>
          <ActionList actions={primerActions} />
          <div className="mt-4">
            <InspectorSection>Design more</InspectorSection>
            <ActionList actions={primerLaunchers} />
          </div>
        </>
      );
    } else if (selectionKind === "region") {
      primerPanel = (
        <>
          <InspectorSection>Design primers here</InspectorSection>
          {readout?.kind === "range" ? (
            <div className="mb-3 flex flex-wrap gap-2">
              <InspectorReadoutChip k="Length" v={`${readout.len} nt`} />
              <InspectorReadoutChip
                k="Tm"
                v={readout.tm != null ? `${readout.tm.toFixed(1)} C` : "n/a"}
              />
              <InspectorReadoutChip k="GC" v={`${readout.gc.toFixed(0)}%`} />
            </div>
          ) : null}
          <ActionList actions={primerLaunchers} />
        </>
      );
    } else {
      primerPanel = (
        <>
          <InspectorSection>Design primers</InspectorSection>
          <div className="mb-3">
            <InspectorCue>
              Select a region on the map to design a pair here, or design across
              the whole sequence.
            </InspectorCue>
          </div>
          <ActionList actions={primerLaunchers} />
        </>
      );
    }
    ops.push({
      id: "primers",
      label: "Primers",
      title: "Primers",
      sub: "Design and check primers",
      icon: RailIcons.primers,
      groupLabel: "Design",
      badge: primerCount > 0 ? primerCount : undefined,
      panel: primerPanel,
    });

    // CLONING. The four chemistries live in the library-level Assemble
    // workspace (owned by the /sequences page). When the page passes
    // onOpenAssemble we open it; otherwise (embedded / read-only) we surface a
    // calm note instead of a dead button.
    if (!readOnly) {
      ops.push({
        id: "cloning",
        label: "Cloning",
        title: "Cloning",
        sub: "Assemble a construct from fragments",
        icon: RailIcons.cloning,
        panel: onOpenAssemble ? (
          <>
            <InspectorSection>Assemble a construct</InspectorSection>
            <ActionList
              actions={[
                {
                  id: "op-clone-gibson",
                  label: "Gibson / overlap",
                  sub: "join fragments by homology",
                  glyph: "G",
                  tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                  onRun: onOpenAssemble,
                },
                {
                  id: "op-clone-restriction",
                  label: "Restriction + ligation",
                  sub: "cut and paste with enzymes",
                  glyph: "R",
                  tileClass: "bg-pink-100 text-pink-700",
                  onRun: onOpenAssemble,
                },
                {
                  id: "op-clone-golden",
                  label: "Golden Gate",
                  sub: "Type IIS one-pot",
                  glyph: "GG",
                  tileClass: "bg-violet-100 text-violet-700",
                  onRun: onOpenAssemble,
                },
                {
                  id: "op-clone-gateway",
                  label: "Gateway",
                  sub: "attB / P / L / R recombination",
                  glyph: "GW",
                  tileClass: "bg-green-100 text-green-700",
                  onRun: onOpenAssemble,
                },
              ]}
            />
          </>
        ) : (
          <InspectorCue>
            Open Assemble from the sequence library to build a construct (Gibson
            overlap, restriction and ligation, Golden Gate, or Gateway).
          </InspectorCue>
        ),
      });
    }

    // CUT (restriction). The enzyme picker + the cut-site display layer. Both
    // are display-level, so this stays available in read-only.
    ops.push({
      id: "cut",
      label: "Cut",
      title: "Restriction and digest",
      sub: "Enzyme sites on the map",
      icon: RailIcons.cut,
      panel: (
        <ActionList
          actions={[
            {
              id: "op-cut-picker",
              label: "Choose enzymes…",
              sub: "filter and pick the cutters to show",
              glyph: ActionGlyphs.plus,
              tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
              onRun: () => setEnzymePickerOpen(true),
            },
            {
              id: "op-cut-toggle",
              label: view.showEnzymes ? "Hide cut sites on the map" : "Show cut sites on the map",
              sub: "the restriction-site display layer",
              glyph: ActionGlyphs.layer,
              onRun: () => setView((v) => ({ ...v, showEnzymes: !v.showEnzymes })),
            },
          ]}
        />
      ),
    });

    // ANNOTATE. Detect, annotate-from-reference, add feature. All mutate, so
    // the whole operation is edit-only.
    if (!readOnly) {
      // When a region is selected, lead with "Add feature from selection" (it
      // already exists, the same openAddFeature the selection right-click menu
      // fires), then keep Detect / Annotate-from-reference below.
      const addFromSelection: OperationAction = {
        id: "op-annot-add",
        label: selectionKind === "region" ? "Add feature from selection" : "Add a feature…",
        sub: selectionKind === "region" ? "annotate the current range" : "draw a new feature",
        glyph: "+",
        tileClass: selectionKind === "region" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" : undefined,
        onRun: openAddFeature,
      };
      const detectAndReference: OperationAction[] = [
        {
          id: "op-annot-detect",
          label: "Detect common features…",
          sub: "from the bundled database",
          glyph: ActionGlyphs.check,
          tileClass: "bg-green-100 text-green-700",
          onRun: openDetectFeatures,
        },
        {
          id: "op-annot-ref",
          label: "Annotate from a reference…",
          sub: "copy features off a known sequence",
          glyph: ActionGlyphs.refresh,
          tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
          onRun: openAnnotateFromReference,
        },
      ];
      ops.push({
        id: "annotate",
        label: "Annotate",
        title: "Annotate",
        sub: "Detect and add features",
        icon: RailIcons.annotate,
        panel:
          selectionKind === "region" ? (
            <>
              <InspectorSection>This selection</InspectorSection>
              <ActionList actions={[addFromSelection]} />
              <div className="mt-4">
                <InspectorSection>Whole sequence</InspectorSection>
                <ActionList actions={detectAndReference} />
              </div>
            </>
          ) : (
            <ActionList actions={[...detectAndReference, addFromSelection]} />
          ),
      });
    }

    // ANALYZE group -----------------------------------------------------------
    // ALIGN. The Compare / Align dialog (read-only safe, it only compares).
    ops.push({
      id: "align",
      label: "Align",
      title: "Align",
      sub: "Compare sequences",
      icon: RailIcons.align,
      groupLabel: "Analyze",
      divider: true,
      panel: (
        <ActionList
          actions={[
            {
              id: "op-align-open",
              label: "Align to another sequence…",
              sub: "pairwise or multiple alignment",
              glyph: ActionGlyphs.align,
              tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
              onRun: () => setCompareOpen(true),
            },
          ]}
        />
      ),
    });

    // PROTEIN. On a CDS selection the panel reads the properties (length aa /
    // mass / pI from the shared translate + analyzeProtein path) and surfaces
    // Translate / Full protein properties / Find domains, each scoped to that
    // CDS through the existing handlers (the per-CDS drawer owns the on-device
    // HMMER scan). Off a CDS it teaches the move with a calm cue.
    let proteinPanel: React.ReactNode;
    if (selectionKind === "feature-cds" && selectedCdsProps && selectedFeatureIdx != null) {
      const cdsIdx = selectedFeatureIdx;
      const props = selectedCdsProps;
      const proteinActions: OperationAction[] = [
        {
          id: "op-protein-translate",
          label: "Translate to protein",
          sub: "show the amino-acid track on the map",
          glyph: ActionGlyphs.protein,
          tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
          onRun: () => {
            selectFeature(cdsIdx);
            setView((v) => ({ ...v, showTranslation: true }));
          },
        },
        {
          id: "op-protein-props",
          label: "Full protein properties",
          sub: "composition, hydropathy, extinction",
          glyph: ActionGlyphs.protein,
          tileClass: "bg-violet-100 text-violet-700",
          onRun: () => setProteinPropsOpen(true),
        },
        {
          id: "op-protein-domains",
          label: "Find domains",
          sub: "on-device HMMER scan in the protein panel",
          glyph: RailIcons.primers,
          tileClass: "bg-amber-100 text-amber-700",
          onRun: () => openProteinDrawerForFeature(cdsIdx),
        },
      ];
      proteinPanel = (
        <>
          <InspectorSection>{selFeat?.name?.trim() || "Coding sequence"}</InspectorSection>
          <div className="mb-3 flex flex-wrap gap-2">
            <InspectorReadoutChip k="Length" v={`${props.aa} aa`} />
            {props.massKDa != null ? (
              <InspectorReadoutChip k="Mass" v={`${props.massKDa.toFixed(1)} kDa`} />
            ) : null}
            {props.pI != null ? (
              <InspectorReadoutChip k="pI" v={props.pI.toFixed(1)} />
            ) : null}
          </div>
          <ActionList actions={proteinActions} />
        </>
      );
    } else {
      proteinPanel = (
        <>
          <InspectorSection>Protein tools</InspectorSection>
          <ActionList
            actions={[
              {
                id: "op-protein-props",
                label: "Protein properties…",
                sub: "length, mass, pI, composition",
                glyph: ActionGlyphs.protein,
                tileClass: "bg-violet-100 text-violet-700",
                onRun: () => setProteinPropsOpen(true),
              },
            ]}
          />
          <div className="mt-3">
            <InspectorCue>
              Select a CDS or coding feature to translate it, read protein
              properties, and scan for domains.
            </InspectorCue>
          </div>
        </>
      );
    }
    ops.push({
      id: "protein",
      label: "Protein",
      title: "Protein",
      sub: "Translation, properties, domains",
      icon: RailIcons.protein,
      panel: proteinPanel,
    });

    // TREE OF LIFE. Taxonomy tools. Explore / lookup are read-only safe;
    // Enrich mutates (present only when onEnriched is given). The amber dot
    // badge signals the open sequence already carries an organism.
    const treeActions: OperationAction[] = [];
    if (onExploreInTree) {
      treeActions.push({
        id: "op-tree-explore",
        label: "Explore in the tree of life…",
        sub: hasOrganism ? "centered on this organism" : "open at the root",
        glyph: ActionGlyphs.tree,
        tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
        onRun: () => onExploreInTree(sequence.tax_id),
      });
    }
    if (onLookupTaxonomy) {
      treeActions.push({
        id: "op-tree-lookup",
        label: "Look up an organism…",
        sub: "name or tax id to lineage",
        glyph: ActionGlyphs.search,
        onRun: () => onLookupTaxonomy(),
      });
    }
    if (onEnriched) {
      treeActions.push({
        id: "op-tree-enrich",
        label: "Enrich taxonomy from NCBI…",
        sub: "attach the organism and lineage",
        glyph: ActionGlyphs.download,
        tileClass: "bg-green-100 text-green-700",
        onRun: () => setEnrichOpen(true),
      });
    }
    // sequence editor master. Taxonomy copy / paste, the two taxonomy tools
    // that previously lived on the Analyze menu, now grouped with the rest of
    // the taxonomy operations under Tree of life. Copy is available only when
    // the sequence carries an organism; Paste only when the app-scoped taxonomy
    // clipboard holds one (Paste opens a small inline confirm before writing).
    if (onApplyTaxonomy && hasOrganism) {
      treeActions.push({
        id: "op-tree-copy",
        label: "Copy this taxonomy",
        sub: "to the taxonomy clipboard",
        glyph: ActionGlyphs.copy,
        onRun: handleCopyTaxonomy,
      });
    }
    if (onApplyTaxonomy && copiedTaxonomy != null) {
      treeActions.push({
        id: "op-tree-paste",
        label: "Paste taxonomy here",
        sub: `from ${copiedTaxonomy.copiedFromName ?? copiedTaxonomy.organism}`,
        glyph: ActionGlyphs.paste,
        onRun: handlePasteTaxonomy,
      });
    }
    if (treeActions.length > 0) {
      ops.push({
        id: "tree",
        label: "Tree",
        title: "Tree of life",
        sub: "Taxonomy and phylogenetics",
        icon: RailIcons.tree,
        badge: hasOrganism ? "dot" : undefined,
        panel: (
          <>
            <InspectorSection>This sequence&rsquo;s organism</InspectorSection>
            {hasOrganism ? (
              <div className="mb-3 text-body text-foreground dark:text-foreground">
                {sequence.organism?.trim() || `Tax id ${sequence.tax_id}`}
              </div>
            ) : (
              <div className="mb-3">
                <InspectorCue>
                  No organism attached yet. Look it up or enrich from NCBI to add
                  the lineage.
                </InspectorCue>
              </div>
            )}
            <ActionList actions={treeActions} />
          </>
        ),
      });
    }

    // EXPORT. Reuse the existing export menu items (GenBank / FASTA / map image
    // / send to a note). Read-only safe. Divider before it.
    ops.push({
      id: "export",
      label: "Export",
      title: "Export",
      sub: "Save and share",
      icon: RailIcons.export,
      divider: true,
      panel: (
        <ActionList
          actions={exportMenuItems.map((item) => ({
            id: `op-export-${item.id}`,
            label: item.label.replace(/…$/, ""),
            glyph: ActionGlyphs.download,
            onRun: item.onRun,
          }))}
        />
      ),
    });

    // MORE. The doorway to the Cmd-K command palette (redesign phase 4). The
    // palette is the keyboard route to every operation, including any that do
    // not earn a permanent rail slot, so the More launcher just opens it and
    // names the shortcut. Available in read-only too (the palette filters to
    // non-mutating commands there).
    ops.push({
      id: "more",
      label: "BeakerSearch",
      title: "BeakerSearch",
      sub: "Search every operation (Cmd K)",
      icon: RailIcons.more,
      panel: (
        <>
          <ActionList
            actions={[
              {
                id: "op-more-palette",
                label: "Open BeakerSearch",
                sub: "search or run any tool (Cmd K)",
                glyph: ActionGlyphs.search,
                tileClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                onRun: () => openPalette(),
              },
            ]}
          />
          <div className="mt-3">
            <InspectorCue>
              Press Cmd K anywhere in the editor to open BeakerSearch and reach
              every operation from the keyboard.
            </InspectorCue>
          </div>
        </>
      ),
    });

    return ops;
  }, [
    readOnly,
    sel.hasRange,
    primerCount,
    openPrimerDialog,
    openEditPrimer,
    openSpecificityCheck,
    writeOsClipboard,
    onOpenAssemble,
    view.showEnzymes,
    openDetectFeatures,
    openAnnotateFromReference,
    openAddFeature,
    onExploreInTree,
    onLookupTaxonomy,
    onEnriched,
    onApplyTaxonomy,
    copiedTaxonomy,
    handleCopyTaxonomy,
    handlePasteTaxonomy,
    hasOrganism,
    sequence.organism,
    sequence.tax_id,
    exportMenuItems,
    // phase 3 contextual inputs
    selectionKind,
    selectedCdsProps,
    selectedPrimerInfo,
    selectedFeatureIdx,
    selFeat,
    readout,
    selectFeature,
    openProteinDrawerForFeature,
    openPalette,
  ]);

  // sequence editor master (redesign phase 4). THE COMMAND SOURCE for the Cmd-K
  // palette. Every command's `run` points at the SAME handler the rail / menu /
  // view switcher already uses, so nothing is re-implemented here. Mutating
  // commands are omitted on the read-only surface, exactly as the rail and the
  // menu bar already hide them. Each iconName is a real entry in the verified
  // icon registry (no new glyphs). The aspirational off-rail long tail (codon
  // optimize, gel sim, dot plot, GC skew) the mockup name-drops is intentionally
  // NOT here, those tools do not exist yet; this list ships only real commands,
  // and the rail "More" launcher + this palette leave a clean home for them.
  const commands = useMemo<EditorCommand[]>(() => {
    const list: EditorCommand[] = [];

    // sequence editor master (contextual BeakerSearch). The live selection,
    // echoed as a short command SUBTITLE so the Suggested rows read as "do this
    // to my highlight". rangeDetail is the coordinates ("from 612..632"),
    // lenDetail is the length ("21 nt"). Both null when nothing is selected, so
    // a row simply shows no sub then.
    const rangeDetail =
      readout?.kind === "range"
        ? `from ${readout.lo.toLocaleString()}..${readout.hi.toLocaleString()}`
        : undefined;
    const lenDetail =
      readout?.kind === "range" ? `${readout.len.toLocaleString()} nt` : undefined;

    // DESIGN ------------------------------------------------------------------
    if (!readOnly) {
      list.push({
        id: "primer-design",
        label: sel.hasRange ? "Design primers from selection" : "Design primers",
        group: "Design",
        iconName: "primers",
        keywords: "oligo forward reverse pcr amplify",
        detail: rangeDetail,
        run: () => openPrimerDialog("standard"),
      });
      list.push({
        id: "primer-mutagenesis",
        label: "Design a mutagenesis primer",
        group: "Design",
        iconName: "primers",
        keywords: "site-directed mutation oligo",
        run: () => openPrimerDialog("mutagenesis"),
      });
    }
    list.push({
      id: "primer-list",
      label: "Open the Primers tab",
      group: "Design",
      iconName: "primers",
      keywords: "list primers oligos",
      run: () => setViewMode("primers"),
    });
    if (selectedPrimerInfo) {
      if (!readOnly) {
        list.push({
          id: "primer-edit",
          label: "Edit this primer",
          group: "Design",
          iconName: "pencil",
          run: () => openEditPrimer(selectedPrimerInfo.idx),
        });
      }
      list.push({
        id: "primer-specificity",
        label: "Check primer specificity",
        group: "Design",
        iconName: "search",
        keywords: "off-target binding template",
        run: openSpecificityCheck,
      });
    }
    if (!readOnly && onOpenAssemble) {
      list.push({
        id: "cloning-assemble",
        label: "Assemble a construct",
        group: "Design",
        iconName: "cloning",
        keywords: "gibson overlap restriction ligation golden gate gateway clone",
        run: onOpenAssemble,
      });
    }
    list.push({
      id: "enzyme-picker",
      label: "Choose restriction enzymes",
      group: "Design",
      iconName: "cut",
      keywords: "digest cutters sites",
      run: () => setEnzymePickerOpen(true),
    });
    list.push({
      id: "enzyme-toggle",
      label: view.showEnzymes ? "Hide cut sites on the map" : "Show cut sites on the map",
      group: "Design",
      iconName: "layer",
      keywords: "restriction enzyme digest",
      run: () => setView((v) => ({ ...v, showEnzymes: !v.showEnzymes })),
    });

    // ANNOTATE (mutating, edit-only) lives under Design at the bench.
    if (!readOnly) {
      list.push({
        id: "annotate-add",
        label: selectionKind === "region" ? "Add feature from selection" : "Add a feature",
        group: "Design",
        iconName: "plus",
        keywords: "annotate feature region",
        detail: selectionKind === "region" ? rangeDetail : undefined,
        run: openAddFeature,
      });
      list.push({
        id: "annotate-detect",
        label: "Detect common features",
        group: "Design",
        iconName: "annotate",
        keywords: "auto detect database annotate",
        run: openDetectFeatures,
      });
      list.push({
        id: "annotate-ref",
        label: "Annotate from a reference",
        group: "Design",
        iconName: "refresh",
        keywords: "copy features reference known sequence",
        run: openAnnotateFromReference,
      });
    }

    // ANALYZE -----------------------------------------------------------------
    list.push({
      id: "align-open",
      label: "Align to another sequence",
      group: "Analyze",
      iconName: "align",
      keywords: "compare pairwise multiple alignment",
      run: () => setCompareOpen(true),
    });
    if (selectionKind === "feature-cds" && selectedFeatureIdx != null) {
      const cdsIdx = selectedFeatureIdx;
      list.push({
        id: "protein-translate",
        label: "Translate this CDS to protein",
        group: "Analyze",
        iconName: "translation",
        keywords: "amino acids translate cds protein",
        run: () => {
          selectFeature(cdsIdx);
          setView((v) => ({ ...v, showTranslation: true }));
        },
      });
      list.push({
        id: "protein-domains",
        label: "Find protein domains",
        group: "Analyze",
        iconName: "protein",
        keywords: "hmmer domain scan pfam",
        run: () => openProteinDrawerForFeature(cdsIdx),
      });
    }
    list.push({
      id: "protein-props",
      label: "Protein properties",
      group: "Analyze",
      iconName: "protein",
      keywords: "mass pi composition hydropathy extinction",
      run: () => setProteinPropsOpen(true),
    });
    if (onExploreInTree) {
      list.push({
        id: "tree-explore",
        label: "Explore in the tree of life",
        group: "Analyze",
        iconName: "tree",
        keywords: "taxonomy phylogeny organism lineage",
        run: () => onExploreInTree(sequence.tax_id),
      });
    }
    if (onLookupTaxonomy) {
      list.push({
        id: "tree-lookup",
        label: "Look up an organism",
        group: "Analyze",
        iconName: "search",
        keywords: "taxonomy tax id lineage organism",
        run: () => onLookupTaxonomy(),
      });
    }
    if (!readOnly && onEnriched) {
      list.push({
        id: "tree-enrich",
        label: "Enrich taxonomy from NCBI",
        group: "Analyze",
        iconName: "ncbi",
        keywords: "ncbi organism lineage taxonomy fetch",
        run: () => setEnrichOpen(true),
      });
    }

    // EDIT --------------------------------------------------------------------
    // Carry the wired handlers AND the shortcut hints straight from the Edit
    // menu so the palette shows the same accelerators.
    for (const item of editMenuItems) {
      const iconName: EditorCommand["iconName"] =
        item.id.startsWith("copy")
          ? "copy"
          : item.id === "paste" || item.id === "paste-rc"
            ? "paste"
            : item.id === "cut"
              ? "cut"
              : item.id === "delete"
                ? "trash"
                : item.id === "find" || item.id === "goto"
                  ? "search"
                  : "pencil";
      // Echo the selection length on the Copy row ("21 nt") so the Suggested
      // "Copy" reads as "copy my highlight", matching the mockup.
      const detail = item.id === "copy" ? lenDetail : undefined;
      list.push({
        id: `edit-${item.id}`,
        label: item.label.replace(/…$/, ""),
        group: "Edit",
        iconName,
        shortcut: item.shortcut,
        detail,
        run: item.onRun,
        enabled: item.enabled,
      });
    }

    // VIEW --------------------------------------------------------------------
    const viewTabs: Array<{ id: SequenceViewMode; label: string; icon: EditorCommand["iconName"] }> = [
      { id: "map", label: "Go to the Map view", icon: "map" },
      { id: "sequence", label: "Go to the Sequence view", icon: "sequence" },
      { id: "features", label: "Go to the Features view", icon: "features" },
      { id: "primers", label: "Go to the Primers view", icon: "primers" },
      { id: "history", label: "Go to the History view", icon: "history" },
    ];
    for (const tab of viewTabs) {
      list.push({
        id: `view-${tab.id}`,
        label: tab.label,
        group: "View",
        iconName: tab.icon,
        keywords: "switch tab view",
        run: () => setViewMode(tab.id),
      });
    }
    const toggles: Array<{
      id: string;
      on: boolean;
      onLabel: string;
      offLabel: string;
      icon: EditorCommand["iconName"];
      keywords: string;
      flip: () => void;
    }> = [
      {
        id: "features",
        on: view.showFeatures,
        onLabel: "Hide features",
        offLabel: "Show features",
        icon: "features",
        keywords: "annotation layer",
        flip: () => setView((v) => ({ ...v, showFeatures: !v.showFeatures })),
      },
      {
        id: "primers",
        on: view.showPrimers,
        onLabel: "Hide primers on the map",
        offLabel: "Show primers on the map",
        icon: "primers",
        keywords: "primer track annealing",
        flip: () => setView((v) => ({ ...v, showPrimers: !v.showPrimers })),
      },
      {
        id: "enzymes",
        on: view.showEnzymes,
        onLabel: "Hide enzyme sites",
        offLabel: "Show enzyme sites",
        icon: "cut",
        keywords: "restriction cut digest",
        flip: () => setView((v) => ({ ...v, showEnzymes: !v.showEnzymes })),
      },
      {
        id: "translation",
        on: view.showTranslation,
        onLabel: "Hide translation",
        offLabel: "Show translation",
        icon: "translation",
        keywords: "amino acid protein track",
        flip: () => setView((v) => ({ ...v, showTranslation: !v.showTranslation })),
      },
      {
        id: "orfs",
        on: view.showOrfs,
        onLabel: "Hide open reading frames",
        offLabel: "Show open reading frames",
        icon: "orfs",
        keywords: "orf reading frame",
        flip: () => setView((v) => ({ ...v, showOrfs: !v.showOrfs })),
      },
      {
        id: "ruler",
        on: view.showIndex,
        onLabel: "Hide the ruler",
        offLabel: "Show the ruler",
        icon: "ruler",
        keywords: "index coordinates",
        flip: () => setView((v) => ({ ...v, showIndex: !v.showIndex })),
      },
      {
        id: "wrap",
        on: view.wrapSequence,
        onLabel: "Switch to a single line",
        offLabel: "Wrap the sequence",
        icon: view.wrapSequence ? "singleLine" : "wrapped",
        keywords: "wrap single line layout",
        flip: () => setView((v) => ({ ...v, wrapSequence: !v.wrapSequence })),
      },
      {
        id: "topology",
        on: view.forceLinear,
        onLabel: "Show the circular map",
        offLabel: "Show as linear",
        icon: view.forceLinear ? "moleculeCircular" : "moleculeLinear",
        keywords: "linear circular topology plasmid",
        flip: () => setView((v) => ({ ...v, forceLinear: !v.forceLinear })),
      },
    ];
    for (const t of toggles) {
      list.push({
        id: `view-toggle-${t.id}`,
        label: t.on ? t.onLabel : t.offLabel,
        group: "View",
        iconName: t.on ? "eyeOff" : "eye",
        keywords: t.keywords,
        run: t.flip,
      });
    }

    // EXPORT ------------------------------------------------------------------
    for (const item of exportMenuItems) {
      list.push({
        id: `export-${item.id}`,
        label: item.label.replace(/…$/, ""),
        group: "Export",
        iconName: item.id.includes("map") ? "map" : "export",
        keywords: `download save ${item.hint ?? ""}`.trim(),
        run: item.onRun,
        enabled: item.enabled,
      });
    }

    return list;
  }, [
    readOnly,
    sel.hasRange,
    selectionKind,
    selectedPrimerInfo,
    selectedFeatureIdx,
    openPrimerDialog,
    openEditPrimer,
    openSpecificityCheck,
    onOpenAssemble,
    setEnzymePickerOpen,
    view.showEnzymes,
    view.showFeatures,
    view.showPrimers,
    view.showTranslation,
    view.showOrfs,
    view.showIndex,
    view.wrapSequence,
    view.forceLinear,
    openAddFeature,
    openDetectFeatures,
    openAnnotateFromReference,
    setCompareOpen,
    selectFeature,
    openProteinDrawerForFeature,
    setProteinPropsOpen,
    onExploreInTree,
    onLookupTaxonomy,
    onEnriched,
    setEnrichOpen,
    sequence.tax_id,
    editMenuItems,
    exportMenuItems,
    readout,
  ]);

  // sequence editor master (contextual BeakerSearch). The "On this sequence"
  // context card data. Display only; the live selection chips in only when a
  // RANGE is active (the readout's range branch carries lo..hi, length, Tm, GC).
  const paletteContext = useMemo<PaletteContext>(() => {
    const typeLabel =
      sequence.seq_type === "protein"
        ? "Protein"
        : sequence.seq_type === "rna"
          ? "RNA"
          : "DNA";
    const unit = sequence.seq_type === "protein" ? "aa" : "bp";
    const featureCount = doc.features.length;
    const meta =
      `${typeLabel}, ${sequence.circular ? "Circular" : "Linear"}, ` +
      `${doc.seq.length.toLocaleString()} ${unit}, ` +
      `${featureCount.toLocaleString()} ${featureCount === 1 ? "feature" : "features"}`;
    const organism = hasOrganism
      ? sequence.organism?.trim() || `Tax id ${sequence.tax_id}`
      : undefined;
    return {
      name: sequence.display_name,
      meta,
      circular: sequence.circular,
      organism,
      organismSwatch: organism ? swatchForOrganism(organism) : undefined,
      selection:
        readout?.kind === "range"
          ? {
              lo: readout.lo,
              hi: readout.hi,
              len: readout.len,
              tm: readout.tm,
              gc: readout.gc,
            }
          : undefined,
    };
  }, [
    sequence.seq_type,
    sequence.circular,
    sequence.display_name,
    sequence.organism,
    sequence.tax_id,
    doc.features.length,
    doc.seq.length,
    hasOrganism,
    readout,
  ]);

  // sequence editor master (contextual BeakerSearch). The "Jump to a sequence"
  // rows, built from the OTHER sequences in the open collection (the page passes
  // the collection minus the open one). Each row switches the editor to that
  // sequence; the organism widens its fuzzy match. Empty when the prop is empty
  // or no switch handler was wired (the group self-hides then).
  const jumpSequences = useMemo<SequenceNavItem[]>(() => {
    if (!onOpenSequence) return [];
    return collectionSequences.map((s) => {
      const typeLabel =
        s.seq_type === "protein" ? "Protein" : s.seq_type === "rna" ? "RNA" : "DNA";
      const unit = s.seq_type === "protein" ? "aa" : "bp";
      const org = s.organism?.trim();
      const detail =
        `${typeLabel}, ${s.circular ? "Circular" : "Linear"}, ` +
        `${s.length.toLocaleString()} ${unit}` +
        (org ? `, ${org}` : "");
      return {
        id: String(s.id),
        label: s.display_name,
        detail,
        organism: org,
        iconName: s.circular ? "moleculeCircular" : "moleculeLinear",
        onRun: () => onOpenSequence(s.id),
      };
    });
  }, [collectionSequences, onOpenSequence]);

  // sequence editor master (contextual BeakerSearch). The "Recent results" rows,
  // built from the loaded Phase 5 artifacts (newest first; the palette caps the
  // count). Each row reopens the saved result through the existing handler.
  const recentArtifacts = useMemo<ArtifactNavItem[]>(
    () =>
      artifacts.map((a) => ({
        id: a.id,
        label: a.title,
        detail: `${a.summary}, ${formatRelative(a.createdAt)}`,
        iconName: a.type === "alignment" ? "align" : "protein",
        onRun: () => handleOpenArtifact(a),
      })),
    [artifacts, handleOpenArtifact],
  );

  // sequence editor master (BeakerSearch step 1). Register THIS editor as the
  // shared palette's source. The object is the exact same data the palette mount
  // used to receive as props. We ALWAYS call useMemo (never conditionally) and
  // pass null when embedded, so the chrome-slim preview registers nothing and its
  // Cmd-K stays inert, preserving today's behavior.
  const beakerSource = useMemo<BeakerSearchSource>(
    () => ({
      id: "sequences-editor",
      commands,
      selectionKind,
      hasOrganism,
      context: paletteContext,
      sequences: jumpSequences,
      artifacts: recentArtifacts,
      collectionLabel,
    }),
    [
      commands,
      selectionKind,
      hasOrganism,
      paletteContext,
      jumpSequences,
      recentArtifacts,
      collectionLabel,
    ],
  );
  useBeakerSearchSource(embedded ? null : beakerSource);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col" tabIndex={-1}>
      {/* Toolbar. The mutating affordances (undo/redo/cut/paste/primer/save) are
          hidden on the read-only surface; selection, the feature list, enzymes
          (display-only) and Copy remain available. The whole row is hidden in an
          `embedded` preview (chrome slim): the view tabs + view rail + map stay. */}
      {!embedded ? (
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
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
            <div className="mx-1 h-5 w-px bg-surface-sunken" />
          </>
        ) : null}
        {/* sequence editor master — the Copy SPLIT button. The primary region
            runs doCopy (top strand, unchanged); the caret opens the full copy
            family (bottom strand 5' to 3' / 3' to 5', amino acids 1 / 3-letter,
            FASTA, map image). Non-mutating, so it renders in read-only too. */}
        <EditMenuDropdown
          items={copyMenuItems}
          label="Copy"
          width="w-64"
          testId="sequence-copy-button"
          icon={<IconCopy className="h-4 w-4" />}
          primaryAction={{
            label: "Copy",
            tooltip: "Copy (Cmd+C)",
            onRun: doCopy,
            disabled: !sel.hasRange,
          }}
        />
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
        {/* sequence editor master (redesign, two-zone chrome). The top action
            bar is now ONLY document editing (Undo / Redo / Copy / Cut / Paste /
            Save). The Edit, Feature, Primer, Enzyme, and Export dropdowns were
            REMOVED from this bar because they shadowed the right operations rail
            and the right-click menus, two homes for the same actions. The
            feature / primer / enzyme toolbar item builders were dead after that
            removal and have been deleted; the right-click menus now call
            buildFeatureMenu / buildPrimerContextMenu directly, and editMenuItems
            (right-click selection menu) + exportMenuItems (Export rail op) stay.
            Feature / primer object edits live on right-click + the double-click
            popups; enzymes are the "Enzyme sites" show chip + the Cut rail
            panel; Export is the Export rail op. */}
        {!readOnly ? (
          <>
            <div className="mx-1 h-5 w-px bg-surface-sunken" />
            <ToolbarButton label="Save (Cmd+S)" onClick={handleSave} disabled={!dirty || saving} primary>
              <IconSave className="h-4 w-4" />
              <span>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</span>
            </ToolbarButton>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-3 pr-1">
          {/* sequence editor master — the BeakerSearch front door. A visible,
              search-bar-styled pill that opens the Cmd-K command palette, so the
              palette is discoverable without knowing the shortcut. The mark is
              the real BeakerBot mascot (component import, no inline svg). */}
          <Tooltip label="Search every tool (Cmd K)">
            <button
              type="button"
              onClick={() => openPalette()}
              data-testid="beakersearch-pill"
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 py-1 text-foreground-muted transition-colors hover:border-sky-300 hover:text-foreground dark:hover:border-sky-700"
            >
              <BeakerBot
                pose="idle"
                animated={false}
                className="h-5 w-5"
                ariaLabel="BeakerBot"
              />
              <span className="hidden text-meta font-medium sm:inline">
                BeakerSearch
              </span>
              <kbd className="hidden rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted sm:inline">
                Cmd K
              </kbd>
            </button>
          </Tooltip>
          <div className="text-meta text-foreground-muted">
            {doc.seq.length.toLocaleString()} bp
            {!readOnly && dirty ? <span className="ml-2 text-amber-500">• unsaved</span> : null}
            {readOnly ? <span className="ml-2 text-foreground-muted">Read-only</span> : null}
          </div>
        </div>
      </div>
      ) : null}

      {/* sequence editor master (redesign, two-zone chrome). The canvas head is
          GONE: the view tabs and the "Show" display strip moved to the pinned
          BOTTOM zone (below the canvas + rail), so the canvas reclaims that
          vertical space and the chrome never stacks at the top. */}

      {/* Tab content. The vertical ViewControlRail is retired; its toggles now
          live in the horizontal display strip in the bottom zone.

          seq flyout bot — `relative` so the Features / Primers / History FLYOUT
          (rendered as the last child of this row) can absolutely position itself
          OVER the canvas + rail, rising from the bottom (just above the pinned
          bottom zone). */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
                <div className="flex items-stretch border-b border-border bg-surface-sunken">
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
                  <div className="flex shrink-0 items-center border-l border-border px-2.5">
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
                  // sequence editor master. CONTEXT-SPECIFIC right-click, routed
                  // through the website-wide framework. Hit-test the click target
                  // for a SeqViz feature element (its stamped, index-encoding id),
                  // then pick the most SPECIFIC menu:
                  //   primer_bind feature -> the PRIMER menu (edit / copy / Tm / delete)
                  //   any other feature   -> the FEATURE menu (CDS adds a protein group)
                  //   bare DNA + a range  -> the SELECTION menu (create feature /
                  //                          design primers / protein props / rev-comp /
                  //                          copy FASTA, then the full bases menu)
                  //   bare DNA, no range  -> the plain BASES menu (unchanged)
                  // The menu arrays are built from the HIT index (not the selection
                  // state) because openMenu snapshots its items synchronously, before
                  // a selectFeature state update would land. We still SELECT the hit
                  // feature so the rest of the editor (drawer, list, dialogs) follows.
                  // openMenu preventDefaults, so the global fallback treats this
                  // right-click as handled.
                  const rawHit = featureIndexFromEventTarget(e.target);
                  const hitIdx =
                    rawHit != null && rawHit >= 0 && rawHit < doc.features.length
                      ? rawHit
                      : null;
                  if (hitIdx != null) selectFeature(hitIdx);
                  const hitFeat = hitIdx != null ? doc.features[hitIdx] : null;
                  const kind = chooseContextMenuKind({
                    hitFeatureIndex: hitIdx,
                    hitFeatureType: hitFeat?.type,
                    hasRange: sel.hasRange,
                  });
                  const items =
                    kind === "primer"
                      ? buildPrimerContextMenu(hitIdx)
                      : kind === "feature"
                        ? buildFeatureMenu(hitIdx)
                        : kind === "selection"
                          ? selectionContextMenuItems
                          : editMenuItems;
                  openMenu(e, items);
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
                    className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50/90 dark:bg-sky-500/15 px-2 py-1 text-meta font-medium text-sky-700 shadow-sm backdrop-blur-sm"
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
                    onHideEnzymes={() => setView((v) => ({ ...v, showEnzymes: false }))}
                    onHidePrimers={() => setView((v) => ({ ...v, showPrimers: false }))}
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
                  editable={!readOnly && canvasMode === "sequence" && !flyoutOpen}
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
                    // Clicking a feature ANNOTATION must register as a FEATURE
                    // selection, not a bare base region. Otherwise the contextual
                    // inspector classifies it as a region and auto-opens the
                    // Primers panel (the reported bug). SeqViz carries our roidx
                    // stamp on the selection's ref, so decode it back to the
                    // feature index. A real base-range drag (type SEQ) clears the
                    // feature so a fresh region still reads as a region. Other
                    // selection types (enzyme, translation, find) leave the
                    // feature selection untouched.
                    if (s?.type === "ANNOTATION") {
                      setSelectedFeatureIdx(decodeFeatureDomId(s.ref));
                    } else if (s?.type === "SEQ") {
                      setSelectedFeatureIdx(null);
                    }
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
                    className="pointer-events-none absolute z-30 rounded-md border border-border bg-surface-raised px-3 py-2 shadow-lg"
                    style={{ left: circularHover.left, top: circularHover.top, width: CIRCULAR_CARD_W }}
                  >
                    <div className="text-body font-semibold text-foreground">{circularHoverCard.title}</div>
                    <div className="mt-1 space-y-0.5">
                      {circularHoverCard.lines.map((line, li) => (
                        <div key={li} className="text-meta text-foreground-muted">
                          {line.label ? (
                            <span className="font-medium text-foreground-muted">{line.label} </span>
                          ) : null}
                          {line.value}
                        </div>
                      ))}
                    </div>
                    <HoverCardActionHint />
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
                    className="pointer-events-none absolute z-30 rounded-md border border-border bg-surface-raised px-3 py-2 shadow-lg"
                    style={{ left: circularPrimerHover.left, top: circularPrimerHover.top, width: CIRCULAR_CARD_W }}
                  >
                    <div className="text-body font-semibold text-foreground">{circularPrimerCard.title}</div>
                    <div className="mt-1 space-y-0.5">
                      {circularPrimerCard.lines.map((line, li) => (
                        <div key={li} className="text-meta text-foreground-muted">
                          {line.label ? (
                            <span className="font-medium text-foreground-muted">{line.label} </span>
                          ) : null}
                          {line.value}
                        </div>
                      ))}
                    </div>
                    <HoverCardActionHint />
                  </div>
                ) : null}
              </div>
              {/* sequence editor master (redesign, two-zone chrome). The bottom
                  coordinate / zoom cluster moved OUT of the viewer column into
                  the pinned bottom zone (below the canvas + rail), where it is
                  always present and disables in place off the canvas tabs, so the
                  chrome never reflows. See the bottom zone after this flex row. */}
            </>
          ) : null}

          {/* seq flyout bot — Features / Primers / History no longer render here
              (they used to BLANK the canvas). They now pop a flyout panel UP over
              the live canvas, hosted in the dismissable overlay below (a sibling of
              this column, anchored to the bottom of the canvas + rail row). */}
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
            // Phase 5: a completed domain scan is saved as a result artifact,
            // tagged with the feature scanned (only on the editable surface).
            onScanResults={
              readOnly
                ? undefined
                : (hits, source) =>
                    persistDomainsArtifact({
                      featureName: selFeat.name || selFeat.type || "feature",
                      featureIndex: selectedFeatureIdx,
                      source,
                      hits,
                    })
            }
          />
        ) : null}

        {/* sequence editor master. The OPERATIONS RAIL + INSPECTOR (redesign
            phase 1). A persistent right-edge launcher for the marquee
            bioinformatics operations, replacing the buried Analyze menu. Hidden
            only in the chrome-slim `embedded` preview; shown in the normal AND
            read-only editor (the rail's edit / destructive ops omit themselves
            in read-only, like the menu bar already does). */}
        {!embedded ? (
          <SequenceOperationsRail
            operations={railOperations}
            activeId={activeOp}
            onPick={toggleOp}
            contextBar={inspectorContextBar}
          />
        ) : null}

        {/* seq flyout bot — THE FLYOUT. Features / Primers / History pop UP from
            their bottom-bar button and OVERLAY the live canvas (the map stays
            mounted + interactive around it), instead of blanking the canvas. It is
            absolutely positioned within this `relative` canvas + rail row, pinned
            to the bottom-left so it visually rises from the tab that opened it, and
            sits just above the pinned bottom zone. NO SOFT-LOCK: it carries a header
            close X, the bottom-bar button toggles it, and Escape dismisses it.
            Reuses the existing panels verbatim. */}
        {openFlyout ? (
          <div
            role="dialog"
            aria-modal="false"
            aria-label={
              openFlyout === "features"
                ? "Features"
                : openFlyout === "primers"
                  ? "Primers"
                  : "History"
            }
            // Pop up from the bottom-left over the canvas. max-h keeps a sliver of
            // map visible at the top so it reads as an overlay, not a new screen.
            // Features is a compact fixed-width list; Primers / History are wider
            // panels, so the flyout sizes to the panel it hosts.
            className={`absolute bottom-0 left-0 z-40 flex max-h-[72%] max-w-[92%] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-surface-raised ros-popup-card-shadow ${
              openFlyout === "features" ? "w-72" : "w-[32rem]"
            }`}
          >
            {/* Header + close affordance. */}
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-sunken px-3 py-1.5">
              <span className="text-meta font-semibold text-foreground">
                {openFlyout === "features"
                  ? "Features"
                  : openFlyout === "primers"
                    ? "Primers"
                    : "History"}
              </span>
              <Tooltip label="Close (Esc)">
                <button
                  type="button"
                  onClick={closeFlyout}
                  data-testid="seq-flyout-close"
                  aria-label="Close panel"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>
            {/* Panel body. The existing panels are reused verbatim; they own their
                own scroll and h-full to the flex body. */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {openFlyout === "features" ? (
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
              {openFlyout === "primers" ? (
                <SequencePrimersPanel
                  features={doc.features}
                  template={doc.seq}
                  selection={sel.hasRange ? { start: sel.lo, end: sel.hi } : null}
                  onSelectPrimer={(index) => {
                    // jump to the primer on the canvas, then dismiss the flyout so
                    // the map (now scrolled to the primer) is fully visible.
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
              {openFlyout === "history" ? (
                <SequenceHistoryPanel
                  sequenceId={sequence.id}
                  owner={historyOwner}
                  headCanonical={headCanonical}
                  canRestore={!readOnly && RESTORE_ENABLED}
                  onRestore={handleRestoreVersion}
                  restoreAudit={sequence._restore_audit}
                  artifacts={artifacts}
                  sequenceVersion={sequenceVersion}
                  onOpenArtifact={handleOpenArtifact}
                  onDeleteArtifact={handleDeleteArtifact}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* sequence editor master (redesign, two-zone chrome). THE PINNED BOTTOM
          ZONE. A constant, fixed-height spine below the canvas + rail that never
          reflows when you switch tabs or topology. Three stable sub-rows:
            1. the "Show" display strip (the "what is drawn" chips);
            2. the coordinate / zoom cluster (Fit / bp-in-view / slider / minimap);
            3. the view tabs (Find on the left, the Map / Sequence / Features /
               Primers / History tabs, then the live coordinate readout + the
               taxonomy footer on the right).
          seq flyout bot — Features / Primers / History no longer blank the
          canvas; they pop a flyout OVER it. The canvas (and therefore the Show
          chips + the zoom cluster, which drive it) stays live underneath, so this
          spine no longer disables in place. It always renders the live cluster
          for the active canvas mode. */}
      {/* seq bottom-bar clearance — the global BeakerSearch ask bar
          (AppShell's BeakerSearchBottomBar) is fixed bottom-center, ~62px tall
          off the bottom edge, and centered 460px wide. Without clearance it
          floats over the TOP of this tab row, where the Map / Sequence /
          Features / Primers / History tabs live, halving (or eating) their hit
          target so Map became awkward/impossible to click. Reserve a bg-surface
          band below the spine so the tabs lift clear of the bar; the bar then
          rests in that band instead of over the tabs. bg-surface here only
          colors the padded band (every inner row already paints bg-surface).
          Mirrors SequenceOperationsRail's pb-24 clearance for the same bar. */}
      <div className="shrink-0 border-t border-border bg-surface pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {/* 1. Show display strip. Always live now (the canvas it controls is
            always visible, even behind an open flyout). */}
        <SequenceDisplayStrip
          view={view}
          onViewChange={setView}
          circular={doc.circular}
          featureTypes={featureTypes}
          disabled={false}
        />

        {/* 2. Coordinate / zoom cluster. Always the live cluster for the active
            canvas mode (linear coordinate bar, circular zoom control, or the Map
            "whole molecule" indicator). */}
        {isLinearViewer ? (
          <SequenceCoordinateBar
            seqLength={doc.seq.length}
            window={overviewWindow}
            zoom={linearZoom}
            onZoomChange={(z) => setView((v) => ({ ...v, linearZoom: z }))}
            onScrollToBp={scrollMainToBp}
            // nav polish bot — in Map view the molecule is shown whole, so the
            // window cluster (slider / bp-in-view / readout / minimap) is stale;
            // collapse it to a "Whole molecule (N bp)" indicator.
            mapMode={canvasMode === "map"}
            // seq polish batch bot — FIX 3: hold the bp readout / bp-in-view
            // field until the true visible window has been measured.
            measured={windowMeasured}
          />
        ) : canvasMode === "map" ? (
          // circular molecule in Map view: the ring IS the whole-molecule map,
          // so the circular zoom slider is irrelevant. Calm indicator.
          <div className="flex items-center gap-2 bg-surface px-3 py-2 text-meta text-foreground-muted">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 text-foreground-muted"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
            </svg>
            <span>
              Whole molecule
              <span className="ml-1 font-mono text-foreground">
                ({doc.seq.length.toLocaleString()} bp)
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-surface px-3 py-1.5">
            <SequenceZoomControl
              axis="circular"
              zoom={view.circularZoom}
              onZoomChange={(z) => setView((v) => ({ ...v, circularZoom: z }))}
            />
          </div>
        )}

        {/* 3. The constant tabs spine. Find (left), the view tabs, then the live
            coordinate readout + the taxonomy footer (right). */}
        <div className="flex items-center gap-2 bg-surface px-1.5 py-0.5">
          {/* sequence editor master (redesign, two-zone chrome). The FIND control,
              left of the tabs. Opens the same inline Find box (Cmd F) the keyboard
              and right-click menu open. Go To, Select All / Range / Invert, and
              the case changes stay in the right-click menu + keyboard. */}
          <Tooltip label="Find in this sequence (Cmd F)">
            <button
              type="button"
              onClick={openFind}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Find</span>
            </button>
          </Tooltip>

          <SequenceTabBar
            active={canvasMode}
            openFlyout={openFlyout}
            onChange={selectCanvas}
            onToggleFlyout={toggleFlyout}
            featureCount={doc.features.length}
            primerCount={primerCount}
            position="bottom"
          />

          {/* Live selection readout (left of this group) + the compact taxonomy
              affordance, pushed to the far right of the spine. */}
          <div className="ml-auto flex min-w-0 items-center gap-4 pr-2 text-meta text-foreground-muted">
            <span
              role="status"
              aria-live="polite"
              className="flex items-center gap-4"
            >
              <SelectionReadoutContent readout={readout} />
            </span>
            {/* sequences / extract-locus — pull the selected feature (carries its
                strand) or the active base range out as a new standalone library
                sequence. Sits with the live selection readout so the cut and its
                bounds read together on camera. Self-hides unless the page wired
                the create callback (read-only / embedded surfaces omit it). */}
            {onCreateSequenceFromRegion && !readOnly ? (
              <Tooltip
                label={
                  canExtractRegion
                    ? "Make a new sequence from the selected feature or range"
                    : "Select a feature or a range to extract it as a new sequence"
                }
              >
                <button
                  type="button"
                  data-testid="seq-extract-region-btn"
                  onClick={handleExtractRegion}
                  disabled={!canExtractRegion}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-sunken disabled:hover:text-foreground-muted"
                >
                  <Icon name="cut" className="h-3.5 w-3.5" />
                  <span>Extract</span>
                </button>
              </Tooltip>
            ) : null}
            <SequenceLineageFooter
              organism={sequence.organism}
              taxId={sequence.tax_id}
              lineage={sequence.tax_lineage}
              onExploreInTree={onExploreInTree}
            />
          </div>
        </div>
      </div>

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

      {/* menu reorg bot. Compare / align two sequences, opened from the Align
          rail operation. Seeds sequence A with the open molecule (the dialog's
          own defaultAId); the user picks B. Phase 5: a completed run is saved as
          a result artifact, and re-opening a saved alignment seeds the dialog in
          a read view (seededAlignment). */}
      <CompareSequencesDialog
        open={compareOpen}
        onClose={() => {
          setCompareOpen(false);
          setSeededAlignment(null);
        }}
        defaultAId={sequence.id}
        seeded={seededAlignment}
        onResult={persistAlignmentArtifact}
      />

      {/* Phase 5 (results as artifacts). The READ view for a saved DOMAINS
          result, re-opened from the History tab's Results section. A snapshot;
          a live re-run is the editable protein drawer's job. */}
      <SequenceDomainsResultDialog
        result={domainsResult?.payload ?? null}
        stale={domainsResult?.stale}
        onClose={() => setDomainsResult(null)}
      />

      {/* protein analyze bot. Protein properties, opened from the Protein rail
          operation. Seeds from the current selection, else a CDS / gene picker,
          else a paste field; renders the SAME shared view as the calculators tab. */}
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

      {/* sequence editor master. The context-aware right-click menu now opens via
          the website-wide framework (useContextMenu().openMenu in the viewer's
          onContextMenu above). The FEATURE menu (quick recolor + rename + CRUD)
          when the click landed on a feature, the BASES menu (selection-aware DNA
          ops) otherwise. The ONE shared menu is rendered by ContextMenuProvider. */}

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

      {/* sequence editor master. Quick Rename prompt for the feature right-click
          menu. Prefilled with the feature's current name; a blank entry is invalid
          (the rename op would fall back to "Untitled", but the prompt asks for a
          real name). Confirm applies it through the undoable renameFeatureAt path. */}
      <SequencePromptDialog<string>
        open={renameFeatureIdx != null}
        title="Rename feature"
        label="Feature name"
        placeholder="e.g. AmpR promoter"
        initialValue={
          renameFeatureIdx != null ? doc.features[renameFeatureIdx]?.name ?? "" : ""
        }
        confirmLabel="Rename"
        parse={(raw) => (raw.trim() ? raw.trim() : null)}
        onConfirm={(name) => {
          if (renameFeatureIdx != null) renameFeatureAt(renameFeatureIdx, name);
          setRenameFeatureIdx(null);
        }}
        onClose={() => setRenameFeatureIdx(null)}
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

      {/* sequence editor master. The inline "Paste taxonomy" confirm for the open
          sequence. Names the organism being pasted before any write. */}
      {pasteTaxConfirm ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPasteTaxConfirm(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Paste taxonomy"
            className="relative w-full max-w-md rounded-lg border border-border bg-surface-raised p-5 shadow-xl"
          >
            <h2 className="text-title font-semibold text-foreground">
              Paste taxonomy
            </h2>
            <p className="mt-2 text-body text-foreground-muted">
              Paste the taxonomy of{" "}
              <span className="font-medium text-foreground">
                {pasteTaxConfirm.fromName}
              </span>{" "}
              onto this sequence?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasteTaxConfirm(null)}
                className="ros-btn-neutral px-3 py-1.5 text-body font-medium text-foreground-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runPasteTaxonomy()}
                className="ros-btn-raise rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90"
              >
                Paste taxonomy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* sequence editor master. The calm taxonomy copy / paste toast (mirrors the
          map-to-note banner). aria-live so a screen reader announces it. */}
      {taxStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-surface-raised px-4 py-2.5 text-body shadow-lg"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="text-foreground">{taxStatus}</span>
          <button
            type="button"
            onClick={() => setTaxStatus(null)}
            className="text-foreground-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* sequence editor master — the calm Copy map image toast. Emerald check on
          success, a gentle amber note when the browser cannot copy an image.
          aria-live so a screen reader announces it. */}
      {copyStatus ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-lg border bg-surface-raised px-4 py-2.5 text-body shadow-lg ${
            copyStatus.tone === "ok" ? "border-emerald-200" : "border-amber-200"
          }`}
        >
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
              copyStatus.tone === "ok"
                ? "bg-emerald-100 text-emerald-600"
                : "bg-amber-100 text-amber-600"
            }`}
          >
            {copyStatus.tone === "ok" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
          </span>
          <span className="text-foreground">{copyStatus.text}</span>
          <button
            type="button"
            onClick={() => setCopyStatus(null)}
            className="text-foreground-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* Phase 5 (results as artifacts). The calm, best-effort save/delete
          toast. A failed sidecar write never breaks the operation; it just lands
          here. Icon via <Icon> (no inline svg). */}
      {artifactToast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-amber-200 bg-surface-raised px-4 py-2.5 text-body shadow-lg dark:border-amber-500/30"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
            <Icon name="history" className="h-3 w-3" />
          </span>
          <span className="text-foreground">{artifactToast}</span>
          <button
            type="button"
            onClick={() => setArtifactToast(null)}
            className="text-foreground-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* map to note bot — calm success banner after the map lands in a note.
          aria-live so a screen reader announces it; a link jumps to the
          Workbench Notes tab where the note is listed. */}
      {mapToNoteStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-surface-raised px-4 py-2.5 text-body shadow-lg"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="text-foreground">
            Map added to{" "}
            <span className="font-medium text-foreground">{mapToNoteStatus.noteTitle}</span>
          </span>
          <Link
            href="/workbench?tab=notes"
            className="font-medium text-sky-600 hover:text-sky-700"
          >
            Open in Workbench
          </Link>
          <button
            type="button"
            onClick={() => setMapToNoteStatus(null)}
            className="text-foreground-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* sequence editor master (BeakerSearch step 1). The Cmd-K COMMAND PALETTE
          is now rendered by the app-shell BeakerSearchProvider from the source
          this view registers (beakerSource above). Not mounted here anymore. The
          embedded preview registers no source, so its Cmd-K stays inert; in
          read-only the command source already drops the mutating commands. */}
    </div>
  );
}
