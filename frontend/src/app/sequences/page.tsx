"use client";

// sequence Phase 1 bot — /sequences top-level workbench (read view + library).
// SnapGene-style working tree on the left (collection selector + sortable list
// + search), a READ-ONLY SeqViz view on the right. Phase 1 is view-only; no
// editing, enzymes, primers, or cloning (Phases 2-3). New top-level route is
// excluded from the wiki-coverage gate pending a Phase 4 wiki page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import SendReferencePicker from "@/components/references/SendReferencePicker";
import { objectReferenceMarkdown } from "@/lib/references";
import SequenceEditView from "@/components/sequences/SequenceEditView";
import { usePreloadOnIdle } from "@/lib/perf/use-preload-on-idle";
import SequenceNewDialog, {
  type NewSequenceSubmit,
} from "@/components/sequences/SequenceNewDialog";
import SequenceDropZone from "@/components/sequences/SequenceDropZone";
import SequenceImportTargetDialog, {
  type ImportTargetRequest,
} from "@/components/sequences/SequenceImportTargetDialog";
import ImportProgressOverlay, {
  type ImportProgress,
} from "@/components/sequences/ImportProgressOverlay";
import CloningWorkspace from "@/components/sequences/CloningWorkspace";
import CompareSequencesDialog from "@/components/sequences/CompareSequencesDialog";
import NcbiDownloadDialog, {
  type NcbiDownloadPrefill,
} from "@/components/sequences/NcbiDownloadDialog";
import TaxonomyLookupDialog from "@/components/sequences/TaxonomyLookupDialog";
import TaxonomyTreeView from "@/components/sequences/TaxonomyTreeView";
import type { EnrichResult } from "@/components/sequences/EnrichFromNcbiDialog";
import SequencesLauncher from "@/components/sequences/SequencesLauncher";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import BulkSequenceSendDialog from "@/components/sharing/BulkSequenceSendDialog";
import ReceivedFromBadge from "@/components/ReceivedFromBadge";
import RestoredBadge from "@/components/RestoredBadge";
import ObjectBacklinks from "@/components/ObjectBacklinks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { sequencesApi, projectsApi } from "@/lib/local-api";
import { emitSequenceDeleted } from "@/lib/sequences/delete-toast-bus";
import {
  importSequenceFile,
  buildNewSequence,
  type ImportedSequence,
} from "@/lib/sequences/import";
import type { NcbiImportedSequence } from "@/lib/sequences/ncbi-import";
import {
  IMPORT_ACCEPT_ATTR,
  partitionImportableFiles,
  importStatusText,
} from "@/lib/sequences/bulk-import";
import { LIST_WIDTH_STORAGE_KEY } from "@/lib/sequences/split-layout";
import { useSplitShell } from "@/components/SplitShell";
import type { SequenceRecord, SeqType } from "@/lib/types";
import {
  lineageIdsFrom,
  type PinnedLineage,
} from "@/lib/sequences/taxonomy-radial-layout";
import {
  applyTaxonomyToSequence,
  buildTaxonomyMenuItems,
  type SequenceTaxonomy,
} from "@/lib/sequences/apply-taxonomy";
import { useTaxonomyClipboard } from "@/lib/sequences/taxonomy-clipboard";
import {
  type EditMenuItem,
  SequencePromptDialog,
} from "@/components/sequences/SequenceEditMenu";
import { useContextMenu } from "@/components/context-menu/ContextMenuProvider";
import { buildObjectMenuItems } from "@/lib/object-menu";
import { copyObjectReference } from "@/lib/copy-reference";
import { resolveDeepLinkSelection } from "@/lib/sequences/deep-link-select";

type SortKey = "name" | "type" | "length" | "added";
type SortDir = "asc" | "desc";

// "all" | "unfiled" | a project id (as string)
type Collection = "all" | "unfiled" | string;

function seqTypeLabel(t: SeqType): string {
  return t === "protein" ? "Protein" : t === "rna" ? "RNA" : "DNA";
}

function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Circular / linear glyph. Inline SVG per the no-emoji icon convention. */
function MoleculeIcon({ circular, className }: { circular: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {circular ? (
        <circle cx="12" cy="12" r="8" />
      ) : (
        <line x1="4" y1="12" x2="20" y2="12" />
      )}
    </svg>
  );
}

/** Focus-mode "expand corners" glyph. Reused verbatim from the markdown
 *  editor's focus toggle (LiveMarkdownEditor hybrid-editor-focus-toggle) so the
 *  collapse-the-list / fill-the-viewer affordance reads the same everywhere.
 *  Inline SVG per the no-emoji icon convention. */
function FocusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  );
}

/** Share glyph (three nodes connected), for the cross-boundary send action.
 *  Inline SVG (no emojis). */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

/** Plus glyph for the New action. Inline SVG (no emojis). */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Upload / import glyph (tray with an up-arrow). Inline SVG (no emojis). */
function ImportIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 9 12 4 17 9" />
      <line x1="12" y1="4" x2="12" y2="16" />
    </svg>
  );
}

/** Assemble glyph: a plasmid built from fragments — a ring drawn as three arc
 *  segments with gaps (DNA pieces joining into a circular construct), reading as
 *  molecular-biology assembly / cloning. Inline SVG, stroke-only. */
function AssembleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Circumference of r=8 is ~50.27; "12.5 4.25" x3 ≈ 50.25 -> three even
          arc fragments with small gaps (the junctions of an assembled plasmid). */}
      <circle cx="12" cy="12" r="8" strokeDasharray="12.5 4.25" />
    </svg>
  );
}

/** Compare glyph: two stacked tracks with offset tick marks, reading as two
 *  sequences laid out for alignment. Inline SVG, stroke-only (no emojis). */
/** Align glyph: two separated DNA strands joined by DOTTED base-pair match lines,
 *  reading as a pairwise alignment (not a solid DNA ladder). Inline SVG,
 *  stroke-only (no emojis). */
function AlignIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
    </svg>
  );
}

/** Download-from-NCBI glyph: a cloud with a downward arrow (pull a record from a
 *  remote database into the local collection). Inline SVG, stroke-only. */
function NcbiCloudIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
        <polyline points="8 17 12 21 16 17" />
        <line x1="12" y1="12" x2="12" y2="21" />
      </g>
      <g>
        <rect x="13" y="2.5" width="9.5" height="6" rx="1.5" fill="#20558a" />
        <text x="17.75" y="7" textAnchor="middle" fontSize="3.6" fontWeight="800" fill="#fff" fontFamily="Arial, sans-serif">NCBI</text>
      </g>
    </svg>
  );
}

/** Downward chevron for the Import split-menu. Inline SVG (no emojis). */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Folder glyph for the "Choose folder…" import action. Inline SVG (no emojis). */
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** File glyph for the "Choose files…" import action. Inline SVG (no emojis). */
function FileIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/** Trash-can glyph for the per-row + bulk delete actions. Inline SVG (no
 *  emojis), matching the NoteDeleteUndoToast trash glyph. */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-left text-meta font-medium uppercase tracking-wide ${
        active ? "text-foreground" : "text-foreground-muted"
      } hover:text-foreground ${className ?? ""}`}
    >
      {label}
      <span className="text-meta">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

export default function SequencesPage() {
  // On the sequences surface the user is about to open the editor, so warm the
  // heavy SeqViz chunk on idle (same import the editor's dynamic() uses) so the
  // first sequence opens instantly.
  usePreloadOnIdle(() => import("@/vendor/seqviz"));
  const [collection, setCollection] = useState<Collection>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Whether the open editor has unsaved edits. Lifted from SequenceEditView so a
  // user-initiated switch to another sequence can confirm before discarding.
  const [editorDirty, setEditorDirty] = useState(false);
  // seq delete trash bot: ids checked for bulk delete. A non-empty set shows
  // the selection action bar; deleting routes each through the recoverable
  // trash with one shared Undo toast.
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Bulk SEND outside the lab: when true, the BulkSequenceSendDialog is mounted
  // over the current checked selection. Picks ONE recipient, then loops the
  // existing single-sequence send once per checked id (each lands as its own
  // inbox item). Separate from the open-viewer single Share (shareOpen).
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [assembleOpen, setAssembleOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  // "Download from NCBI" dialog (gene / genome / accession -> the collection).
  const [ncbiOpen, setNcbiOpen] = useState(false);
  // A one-shot prefill applied when the NCBI dialog opens (set by the taxonomy
  // tree explorer's import jump on a species node).
  const [ncbiPrefill, setNcbiPrefill] = useState<NcbiDownloadPrefill | undefined>(
    undefined,
  );
  // sequence editor master. The standalone "look up an organism" taxonomy tool.
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  // sequence editor master. The interactive taxonomy tree explorer. Optionally
  // centered on a tax id when opened from a cross-link.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerTaxId, setExplorerTaxId] = useState<string | undefined>(
    undefined,
  );
  // sequence editor master. The open sequence's pinned lineage, set when the
  // explorer is opened FROM a sequence (the editor's lineage chip or its
  // Analyze-menu entry). It highlights that sequence's trail in the tree and
  // shows the jump-back chip. Cleared (undefined) when the explorer is opened
  // from the launcher or the standalone lookup, so nothing highlights there.
  const [explorerPinned, setExplorerPinned] = useState<PinnedLineage | undefined>(
    undefined,
  );
  // Cross-boundary "Share outside this folder" dialog for the open sequence.
  const [shareOpen, setShareOpen] = useState(false);
  // "Send to..." picker for the open sequence: pushes a reference chip straight
  // into a chosen note / experiment doc / method (the push direction).
  const [sendOpen, setSendOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // Structured progress for a MULTI-file import, driving the centered
  // ImportProgressOverlay (+ the beforeunload guard). Null when no multi-file
  // import is running; a single-file import never sets this (it keeps the
  // inline status line only). Set at the start of finishImport, advanced by
  // the per-file onProgress callback, cleared in the finally block.
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  // Transient status line under the toolbar (import counts / parse errors).
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  // "Import into" chooser request, set when an import target is ambiguous
  // (All Sequences / Unfiled). Null when no chooser is open.
  const [importTarget, setImportTarget] = useState<ImportTargetRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

  // Split layout: the shared resizable + collapse-to-focus + width-persisted
  // shell, the same one Chemistry / Data Hub / Tree Studio use. Focus mode
  // (shell.collapsed) hides the list so the viewer fills the page; the Escape
  // handler below and the focus toggle drive it.
  const shell = useSplitShell(LIST_WIDTH_STORAGE_KEY);

  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const { canShare } = useAccountCapabilities();

  // sequence editor master. The app-scoped taxonomy clipboard (separate from the
  // OS clipboard + the molecular bases clipboard), persisted to localStorage so a
  // copy survives navigation + reload. Drives the list-row "Paste taxonomy"
  // enablement and the paste confirm label.
  const { copied: copiedTaxonomy, copyTaxonomy } = useTaxonomyClipboard();

  // sequence editor master. The list-row right-click menu (Copy / Paste taxonomy)
  // now opens through the website-wide framework. The row's onContextMenu builds
  // its items from the record and calls openMenu, which renders the ONE shared
  // cursor-anchored menu (see ContextMenuProvider).
  const { openMenu } = useContextMenu();
  // The pending single-paste confirm for a LIST ROW (the editor owns its own
  // confirm). Names the organism being pasted and the target sequence.
  const [pasteConfirm, setPasteConfirm] = useState<{
    seq: SequenceRecord;
    taxonomy: SequenceTaxonomy;
    fromName: string;
  } | null>(null);

  // sequence editor master. The pending inline rename (the universal row /
  // collection menu's Rename). `kind` routes the persist to the right store.
  const [renameTarget, setRenameTarget] = useState<{
    kind: "sequence" | "collection";
    id: number;
    name: string;
  } | null>(null);

  // sequence editor master. The deep-link param reader. Reading it via
  // useSearchParams keeps the resolver SSR-safe; the optional chaining guards the
  // (transient) null before the client search params hydrate.
  const searchParams = useSearchParams();

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-sequences"],
    queryFn: () => projectsApi.list(),
  });

  // Filter by collection.
  const inCollection = useMemo(() => {
    if (collection === "all") return sequences;
    if (collection === "unfiled") return sequences.filter((s) => s.project_ids.length === 0);
    return sequences.filter((s) => s.project_ids.includes(collection));
  }, [sequences, collection]);

  // Filter by search.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inCollection;
    return inCollection.filter((s) => s.display_name.toLowerCase().includes(q));
  }, [inCollection, search]);

  // Sort.
  const sorted = useMemo(() => {
    const arr = [...searched];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.display_name.localeCompare(b.display_name) * dir;
        case "type":
          return a.seq_type.localeCompare(b.seq_type) * dir;
        case "length":
          return (a.length - b.length) * dir;
        case "added":
          return (
            (new Date(a.added_at).getTime() - new Date(b.added_at).getTime()) * dir
          );
        default:
          return 0;
      }
    });
    return arr;
  }, [searched, sortKey, sortDir]);

  // seq delete trash bot: header "select all visible" tri-state. Toggling it
  // checks/unchecks exactly the currently-visible (filtered + sorted) rows.
  const visibleCheckedCount = useMemo(
    () => sorted.reduce((n, s) => n + (checkedIds.has(s.id) ? 1 : 0), 0),
    [sorted, checkedIds],
  );
  const allVisibleChecked = sorted.length > 0 && visibleCheckedCount === sorted.length;
  const someVisibleChecked = visibleCheckedCount > 0 && !allVisibleChecked;

  const toggleAllVisible = useCallback(() => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const everyVisibleChecked =
        sorted.length > 0 && sorted.every((s) => next.has(s.id));
      if (everyVisibleChecked) {
        for (const s of sorted) next.delete(s.id);
      } else {
        for (const s of sorted) next.add(s.id);
      }
      return next;
    });
  }, [sorted]);

  // sequence editor master. Deep-link resolver. A `?seq=<id>` (and optional
  // `?collection=<id>`) opens that sequence + collection. It runs whenever the
  // params or the loaded ids change, but a one-shot ref keyed on the raw param
  // string means a given link applies once (so it does not fight a later manual
  // selection while the param lingers in the URL). SSR-safe. searchParams is null
  // until the client hydrates, and resolveDeepLinkSelection is pure.
  const appliedDeepLinkRef = useRef<string | null>(null);
  // The id a just-applied deep link wants selected. The keep-valid effect below
  // runs in the same commit as the deep-link effect, and its `selectedId`
  // closure is still the pre-deep-link value (null on first load), so without
  // this it would clobber the deep-linked selection back to the first row. The
  // ref lets keep-valid honor the pending deep link, then clears so later
  // invalidations (e.g. the selected sequence is deleted) default normally.
  const deepLinkTargetRef = useRef<number | null>(null);
  useEffect(() => {
    const seqParam = searchParams?.get("seq") ?? null;
    const collectionParam = searchParams?.get("collection") ?? null;
    const key = `${seqParam ?? ""}|${collectionParam ?? ""}`;
    if (key === "|") return; // No deep-link params present.
    if (appliedDeepLinkRef.current === key) return; // Already applied this link.
    const sel = resolveDeepLinkSelection(
      seqParam,
      collectionParam,
      sequences.map((s) => s.id),
    );
    // Wait for the named sequence to load before claiming the link as applied,
    // so a deep link that arrives before the list query resolves still lands.
    if (seqParam && sel.selectId == null && sequences.length === 0) return;
    appliedDeepLinkRef.current = key;
    if (sel.selectCollection != null) setCollection(sel.selectCollection);
    if (sel.selectId != null) {
      deepLinkTargetRef.current = sel.selectId;
      setSelectedId(sel.selectId);
    }
  }, [searchParams, sequences]);

  // Keep a valid selection: default to the first visible sequence, but defer to
  // a pending deep-link target so a `?seq=<id>` link is not overwritten here.
  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !sorted.some((s) => s.id === selectedId)) {
      const target = deepLinkTargetRef.current;
      if (target != null && sorted.some((s) => s.id === target)) {
        deepLinkTargetRef.current = null;
        setSelectedId(target);
      } else {
        setSelectedId(sorted[0].id);
      }
    }
  }, [sorted, selectedId]);

  // A user-initiated switch to a different library row. Confirms before
  // discarding unsaved edits in the open sequence (the editor is explicit-save).
  // Programmatic selection (deep links, post-create, post-delete) does not route
  // through here, so those are never gated.
  const selectSequenceFromList = useCallback(
    (id: number) => {
      if (id === selectedId) return;
      if (
        editorDirty &&
        !window.confirm(
          "You have unsaved changes in the current sequence. Discard them and switch?",
        )
      ) {
        return;
      }
      setSelectedId(id);
    },
    [editorDirty, selectedId],
  );

  // seq delete trash bot: keep the bulk selection consistent — drop any
  // checked id that has left the live data set (deleted, or no longer exists).
  // Filtering by search/collection does NOT clear checks (a user can refine
  // the view mid-selection), but a gone-from-disk id is pruned.
  useEffect(() => {
    setCheckedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(sequences.map((s) => s.id));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sequences]);

  const toggleChecked = useCallback((id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  // Counts for the collection selector.
  const unfiledCount = useMemo(
    () => sequences.filter((s) => s.project_ids.length === 0).length,
    [sequences],
  );
  const projectCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sequences) {
      for (const pid of s.project_ids) m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [sequences]);

  const { data: selected } = useQuery({
    queryKey: ["sequence", selectedId],
    queryFn: () => (selectedId == null ? null : sequencesApi.get(selectedId)),
    enabled: selectedId != null,
  });

  // sequence editor master. The open sequence's pinned lineage, derived from its
  // taxonomy. lineageIds is the root-to-organism trail (the named lineage tax
  // ids plus the organism tax id), so the explorer can highlight that trail and
  // jump back to the organism. Null when the open sequence carries no taxonomy
  // (then opening the explorer pins nothing). Recomputed only when the open
  // sequence's taxonomy fields change.
  const pinnedForOpenSequence = useMemo<PinnedLineage | undefined>(() => {
    if (!selected) return undefined;
    const lineageIds = lineageIdsFrom(selected.tax_lineage, selected.tax_id);
    if (lineageIds.length === 0) return undefined;
    return {
      organismTaxId: selected.tax_id,
      organismName: selected.organism,
      lineageIds,
    };
  }, [selected]);

  // Persist the edited GenBank back to disk (atomic .gb rewrite via the store),
  // then refresh the summary + detail queries so the library and header update.
  const handleSave = useCallback(
    async (genbank: string): Promise<boolean> => {
      if (selectedId == null) return false;
      setSaving(true);
      try {
        await sequencesApi.update(selectedId, { genbank });
        await queryClient.invalidateQueries({ queryKey: ["sequence", selectedId] });
        await queryClient.invalidateQueries({ queryKey: ["sequences"] });
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [selectedId, queryClient],
  );

  // sequence editor master. The ONE taxonomy write path. Given a sequence id, its
  // current GenBank, and a taxonomy, it rewrites the source feature + persists the
  // .gb plus the organism / tax id / named-lineage sidecar fields through the
  // store update, then refreshes the detail + summary queries so the lineage line
  // and library row pick it up. The enrich apply, the single paste, and (later)
  // the bulk apply all flow through here instead of each inventing its own write.
  const applyTaxonomy = useCallback(
    async (
      seqId: number,
      currentGenbank: string,
      taxonomy: SequenceTaxonomy,
    ): Promise<boolean> => {
      const res = await applyTaxonomyToSequence(
        seqId,
        currentGenbank,
        taxonomy,
        (id, patch) => sequencesApi.update(id, patch),
      );
      if (!res.ok) {
        setStatus({
          text: res.error ?? "Could not apply the taxonomy.",
          tone: "error",
        });
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: ["sequence", seqId] });
      await queryClient.invalidateQueries({ queryKey: ["sequences"] });
      return true;
    },
    [queryClient],
  );

  // sequence editor master. Persist an NCBI enrichment for the open sequence. The
  // enrich dialog already rewrote the GenBank, so this routes the result through
  // the shared applyTaxonomy write path (one path, not two) and toasts on success.
  const handleEnriched = useCallback(
    async (result: EnrichResult): Promise<void> => {
      if (selectedId == null) return;
      const ok = await applyTaxonomy(selectedId, result.genbank, {
        organism: result.organism,
        tax_id: result.taxId,
        tax_lineage: result.lineage,
      });
      if (ok) {
        setStatus({ text: `Enriched "${result.organism}" from NCBI.`, tone: "ok" });
      }
    },
    [selectedId, applyTaxonomy],
  );

  // sequence editor master. Copy a record's taxonomy onto the clipboard (the
  // list-row "Copy taxonomy" action). The editor's own "Copy taxonomy" copies the
  // open sequence the same way. A calm toast names the organism. Caller guards
  // enablement (only shown when the record HAS taxonomy).
  const handleCopyTaxonomyFromRecord = useCallback(
    (rec: SequenceRecord) => {
      const organism = (rec.organism ?? "").trim();
      if (!organism) return;
      copyTaxonomy({
        organism,
        tax_id: rec.tax_id,
        tax_lineage: rec.tax_lineage,
        copiedFromName: organism,
      });
      setStatus({ text: `Copied the taxonomy of ${organism}.`, tone: "ok" });
    },
    [copyTaxonomy],
  );

  // sequence editor master. Run a confirmed single paste onto a target id. Fetches
  // the target's current GenBank (a list row carries no .gb), applies through the
  // shared write path, and toasts. Used by the list-row paste confirm.
  const runPasteTaxonomy = useCallback(
    async (seqId: number, taxonomy: SequenceTaxonomy) => {
      const detail = await sequencesApi.get(seqId);
      if (!detail) {
        setStatus({ text: "Could not load that sequence.", tone: "error" });
        return;
      }
      const ok = await applyTaxonomy(seqId, detail.genbank, taxonomy);
      if (ok) {
        setStatus({
          text: `Pasted the taxonomy of ${taxonomy.organism}.`,
          tone: "ok",
        });
      }
    },
    [applyTaxonomy],
  );

  // sequence editor master. Build the right-click menu for one list row. Copy is
  // enabled only when the row carries an organism; Paste only when the clipboard
  // holds a taxonomy. Paste opens the inline confirm rather than writing straight.
  const buildRowTaxonomyMenu = useCallback(
    (seq: SequenceRecord): EditMenuItem[] => {
      const clip = copiedTaxonomy;
      return buildTaxonomyMenuItems({
        hasTaxonomy: Boolean((seq.organism ?? "").trim()),
        clipboardHasTaxonomy: clip != null,
        onCopy: () => handleCopyTaxonomyFromRecord(seq),
        onPaste: () => {
          if (clip == null) return;
          setPasteConfirm({
            seq,
            taxonomy: {
              organism: clip.organism,
              tax_id: clip.tax_id,
              tax_lineage: clip.tax_lineage,
            },
            fromName: clip.copiedFromName ?? clip.organism,
          });
        },
        idPrefix: "row",
      });
    },
    [copiedTaxonomy, handleCopyTaxonomyFromRecord],
  );

  // seq delete trash bot: soft-delete a set of sequence ids into the
  // recoverable trash, refresh the list, and pop ONE Undo toast covering the
  // whole batch. Shared by the per-row delete (single id) and the bulk action
  // bar (several ids). Recovery is via the toast or the /trash page — nothing
  // is hard-deleted here. The toast restore re-invalidates the list.
  const deleteSequences = useCallback(
    async (ids: number[], label: string) => {
      if (ids.length === 0 || deleting) return;
      setDeleting(true);
      try {
        const deletedIds: number[] = [];
        for (const id of ids) {
          try {
            const ok = await sequencesApi.delete(id);
            if (ok) deletedIds.push(id);
          } catch (err) {
            console.warn("[sequences] delete failed for id", id, err);
          }
        }
        // Drop the just-deleted ids from the bulk selection + the open viewer.
        setCheckedIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedIds) next.delete(id);
          return next;
        });
        if (selectedId != null && deletedIds.includes(selectedId)) {
          setSelectedId(null);
        }
        await queryClient.invalidateQueries({ queryKey: ["sequences"] });
        if (deletedIds.length > 0) {
          emitSequenceDeleted({
            ids: deletedIds,
            label,
            onRestored: () => {
              void queryClient.invalidateQueries({ queryKey: ["sequences"] });
            },
          });
        }
      } finally {
        setDeleting(false);
      }
    },
    [deleting, selectedId, queryClient],
  );

  // Per-row delete: confirm, then trash the single sequence.
  const handleDeleteOne = useCallback(
    (seq: SequenceRecord) => {
      if (
        !window.confirm(
          `Move "${seq.display_name}" to Trash? You can restore it from Trash.`,
        )
      ) {
        return;
      }
      void deleteSequences([seq.id], `"${seq.display_name}"`);
    },
    [deleteSequences],
  );

  // sequence editor master. The OS-clipboard writer for Copy reference. Mirrors
  // the editor's writeOsClipboard (a no-throw navigator.clipboard wrapper) so a
  // blocked clipboard never breaks the menu.
  const writeOsClipboard = useCallback((text: string) => {
    if (text && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        /* clipboard may be blocked (no focus / permissions) */
      });
    }
  }, []);

  // sequence editor master. Copy reference. Writes a markdown link (plus the bare
  // deep link) to the object and toasts. Shared by the row + collection menus.
  const handleCopyReference = useCallback(
    (item: { type: "sequence" | "collection"; id: number | string; name: string }) => {
      const text = copyObjectReference(item, writeOsClipboard);
      setStatus({ text, tone: "ok" });
    },
    [writeOsClipboard],
  );

  // sequence editor master. Duplicate one sequence. A clean path exists. fetch
  // the full GenBank, create a copy named "<name> copy" in the same collections,
  // then open it. (The editor has no per-row duplicate, so this is the source.)
  const handleDuplicateOne = useCallback(
    async (seq: SequenceRecord) => {
      const detail = await sequencesApi.get(seq.id);
      if (!detail) {
        setStatus({ text: "Could not load that sequence to duplicate.", tone: "error" });
        return;
      }
      const copy = await sequencesApi.create({
        display_name: `${seq.display_name} copy`,
        genbank: detail.genbank,
        seq_type: seq.seq_type,
        project_ids: seq.project_ids,
      });
      await queryClient.invalidateQueries({ queryKey: ["sequences"] });
      if (copy) {
        setSelectedId(copy.id);
        setStatus({ text: `Duplicated "${seq.display_name}".`, tone: "ok" });
      }
    },
    [queryClient],
  );

  // sequence editor master. Share one sequence outside the lab. Reuses the open-
  // viewer Share path. select the row, then open the same UnifiedShareDialog that
  // the header Share button opens (which reads the loaded `selected` detail).
  const handleShareRow = useCallback((seq: SequenceRecord) => {
    setSelectedId(seq.id);
    setShareOpen(true);
  }, []);

  // sequence editor master. Persist a confirmed rename. Sequences route through
  // sequencesApi.update (display_name patch); collections through
  // projectsApi.update (name patch). Refreshes the affected query so the new name
  // shows immediately.
  const handleRenameConfirm = useCallback(
    async (next: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      if (!target) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === target.name) return;
      if (target.kind === "sequence") {
        await sequencesApi.update(target.id, { display_name: trimmed });
        await queryClient.invalidateQueries({ queryKey: ["sequences"] });
        await queryClient.invalidateQueries({ queryKey: ["sequence", target.id] });
      } else {
        await projectsApi.update(target.id, { name: trimmed });
        await queryClient.invalidateQueries({ queryKey: ["projects", "for-sequences"] });
      }
      setStatus({ text: `Renamed to "${trimmed}".`, tone: "ok" });
    },
    [renameTarget, queryClient],
  );

  // sequence editor master. Delete one collection (project). Confirms, then
  // routes through projectsApi.delete and refreshes the collection list. If the
  // deleted collection was active, fall back to All Sequences.
  const handleDeleteCollection = useCallback(
    async (projectId: number, name: string) => {
      if (
        !window.confirm(
          `Delete the collection "${name}"? Its sequences are not deleted, only the collection.`,
        )
      ) {
        return;
      }
      await projectsApi.delete(projectId);
      await queryClient.invalidateQueries({ queryKey: ["projects", "for-sequences"] });
      setCollection((c) => (c === String(projectId) ? "all" : c));
      setStatus({ text: `Deleted the collection "${name}".`, tone: "ok" });
    },
    [queryClient],
  );

  // sequence editor master. The collection right-click menu (Copy reference +
  // Rename + Delete). Reuses the shared builder so it reads the same as a row.
  const buildCollectionMenu = (projectId: number, name: string): EditMenuItem[] =>
    buildObjectMenuItems(
      { type: "collection", id: projectId, name },
      {
        onRename: () =>
          setRenameTarget({ kind: "collection", id: projectId, name }),
        onCopyReference: () =>
          handleCopyReference({ type: "collection", id: projectId, name }),
        onDelete: () => void handleDeleteCollection(projectId, name),
      },
    );

  // sequence editor master. The universal row right-click menu. The shared builder
  // turns the record into Rename / Duplicate / Share / Copy reference / Delete
  // (only the wired handlers show), then the existing taxonomy Copy / Paste items
  // are appended as their own group. Export / Move are omitted in v1 (no clean
  // per-row path). Not memoized. it runs once per right-click.
  const buildRowMenu = (seq: SequenceRecord): EditMenuItem[] => {
    const universal = buildObjectMenuItems(
      { type: "sequence", id: seq.id, name: seq.display_name },
      {
        onRename: () =>
          setRenameTarget({ kind: "sequence", id: seq.id, name: seq.display_name }),
        onDuplicate: () => void handleDuplicateOne(seq),
        onShare: canShare ? () => handleShareRow(seq) : undefined,
        onCopyReference: () =>
          handleCopyReference({
            type: "sequence",
            id: seq.id,
            name: seq.display_name,
          }),
        onDelete: () => handleDeleteOne(seq),
      },
    );
    const taxonomy = buildRowTaxonomyMenu(seq).map((it, i) => ({
      ...it,
      // Start the taxonomy group with a divider so it reads as its own block
      // under the universal actions.
      group: i === 0 ? true : it.group,
    }));
    return [...universal, ...taxonomy];
  };

  // Bulk delete: confirm the count, then trash every checked sequence.
  const handleDeleteChecked = useCallback(() => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "sequence" : "sequences";
    if (
      !window.confirm(
        `Move ${ids.length} ${noun} to Trash? You can restore them from Trash.`,
      )
    ) {
      return;
    }
    void deleteSequences(ids, `${ids.length} ${noun}`);
  }, [checkedIds, deleteSequences]);

  // Create one-or-more sequences via the store, refresh the library, and select
  // the first newly-created one. Shared by the import + new-from-paste paths.
  const persistNew = useCallback(
    async (
      imports: ImportedSequence[],
      projectIds: string[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<number | null> => {
      let firstId: number | null = null;
      let done = 0;
      for (const imp of imports) {
        const rec = await sequencesApi.create({
          display_name: imp.display_name,
          genbank: imp.genbank,
          seq_type: imp.seq_type,
          project_ids: projectIds,
        });
        if (rec && firstId == null) firstId = rec.id;
        done += 1;
        onProgress?.(done, imports.length);
        // Progressive refresh: for a big folder import (dozens of files) the
        // create loop is slow, so refresh the list every few records (fire and
        // forget, no await — it must not block the loop) so sequences appear as
        // they land and the user never has to manually reload.
        if (done % 8 === 0 && done < imports.length) {
          void queryClient.invalidateQueries({ queryKey: ["sequences"] });
        }
      }
      // Final authoritative refetch once every record is written.
      await queryClient.invalidateQueries({ queryKey: ["sequences"] });
      if (firstId != null) setSelectedId(firstId);
      return firstId;
    },
    [queryClient],
  );

  // When a project collection is active, new sequences land in it; otherwise
  // they are Unfiled (All / Unfiled views ⇒ no project link).
  const activeProjectIds = useMemo(
    () => (collection === "all" || collection === "unfiled" ? [] : [collection]),
    [collection],
  );

  // sequence editor master. The active project collection (null for All / Unfiled
  // / a stale id). Drives the right-clickable collection chip + its menu. Carries
  // a numeric id so the collection menu can route to projectsApi.
  const activeProject = useMemo(() => {
    if (collection === "all" || collection === "unfiled") return null;
    const proj = projects.find((p) => String(p.id) === collection);
    return proj ? { id: Number(proj.id), name: proj.name } : null;
  }, [collection, projects]);

  // sequence editor master (contextual BeakerSearch). The open collection's
  // human label and the OTHER sequences in it (the open one excluded), threaded
  // into the editor so the command palette can offer "Jump to a sequence" rows.
  const collectionLabel = useMemo(() => {
    if (collection === "all") return "All Sequences";
    if (collection === "unfiled") return "Unfiled";
    return activeProject?.name ?? "this collection";
  }, [collection, activeProject]);

  const collectionSiblings = useMemo(
    () => inCollection.filter((s) => s.id !== selectedId),
    [inCollection, selectedId],
  );

  // NEW flow: build a sequence from pasted bases (or a blank one).
  const handleNewSubmit = useCallback(
    async (data: NewSequenceSubmit) => {
      setNewOpen(false);
      const imp = buildNewSequence({
        name: data.name,
        seqType: data.seqType,
        rawSequence: data.rawSequence,
        allowEmpty: data.allowEmpty,
      });
      if (!imp) {
        setStatus({ text: "Could not create the sequence — no valid bases.", tone: "error" });
        return;
      }
      const id = await persistNew([imp], activeProjectIds);
      if (id != null) {
        setStatus({ text: `Created "${imp.display_name}".`, tone: "ok" });
      }
    },
    [persistNew, activeProjectIds],
  );

  // sequences / extract-locus — "Extract to new sequence" from the editor. The
  // child builds the ImportedSequence (a feature span or a base selection cut out
  // as its own molecule via the pure extract engine); the page owns the create +
  // list refresh + selection, reusing the same persistNew the import paths use so
  // the new sequence opens immediately. Returns its new id, or null on failure.
  const handleCreateFromRegion = useCallback(
    async (imported: ImportedSequence): Promise<number | null> => {
      const id = await persistNew([imported], activeProjectIds);
      if (id != null) {
        setStatus({ text: `Extracted "${imported.display_name}".`, tone: "ok" });
      } else {
        setStatus({ text: "Could not extract that region to a new sequence.", tone: "error" });
      }
      return id;
    },
    [persistNew, activeProjectIds],
  );

  // Resolve a collection id (a stringified project id) to its display name, for
  // the destination-named status line. Falls back to "Unfiled" for null / no
  // match (the All / Unfiled views, or a project that has since disappeared).
  const destinationName = useCallback(
    (projectId: string | null): string => {
      if (!projectId) return "Unfiled";
      const proj = projects.find((p) => String(p.id) === projectId);
      return proj ? proj.name : "Unfiled";
    },
    [projects],
  );

  // NCBI download flow: the dialog hands back provenance-tagged sequences. Unlike
  // the file-import persistNew path, each create carries the NCBI provenance
  // (source / accession / organism / tax id) onto the sidecar so the library can
  // show a "From NCBI" badge and the accession stays linkable. The new
  // sequence(s) land in the active collection and the first one opens.
  const handleNcbiImported = useCallback(
    async (imports: NcbiImportedSequence[]) => {
      if (imports.length === 0) return;
      let firstId: number | null = null;
      for (const imp of imports) {
        const rec = await sequencesApi.create({
          display_name: imp.display_name,
          genbank: imp.genbank,
          seq_type: imp.seq_type,
          project_ids: activeProjectIds,
          source: imp.provenance.source,
          ncbi_accession: imp.provenance.ncbi_accession,
          organism: imp.provenance.organism,
          tax_id: imp.provenance.tax_id,
          tax_lineage: imp.provenance.tax_lineage,
        });
        if (rec && firstId == null) firstId = rec.id;
      }
      await queryClient.invalidateQueries({ queryKey: ["sequences"] });
      if (firstId != null) setSelectedId(firstId);
      const noun = imports.length === 1 ? "sequence" : `${imports.length} sequences`;
      setStatus({
        text: `Downloaded ${noun} from NCBI into ${destinationName(
          activeProjectIds[0] ?? null,
        )}.`,
        tone: "ok",
      });
    },
    [activeProjectIds, queryClient, destinationName],
  );

  // Persist gathered imports into a chosen target and report a destination-named
  // status line. `projectId` is null for Unfiled, or a stringified project id.
  // Shared by the direct (project-active) path and the chooser confirm.
  const finishImport = useCallback(
    async (imports: ImportedSequence[], projectId: string | null, skipped: number) => {
      setImporting(true);
      // Show the centered progress overlay only for a real batch (>1 file).
      // A single-file import keeps the inline status line and never gets the
      // big modal (or the beforeunload guard).
      const isMulti = imports.length > 1;
      if (isMulti) setImportProgress({ done: 0, total: imports.length });
      try {
        await persistNew(
          imports,
          projectId ? [projectId] : [],
          (doneN, total) => {
            // Live progress for multi-file / folder imports so the user sees it
            // working (and the list filling in) rather than a frozen "Import".
            if (total > 1 && doneN < total) {
              setStatus({ text: `Importing ${doneN} of ${total}…`, tone: "ok" });
              setImportProgress({ done: doneN, total });
            }
          },
        );
        setStatus({
          text: importStatusText(imports.length, skipped, destinationName(projectId)),
          tone: "ok",
        });
      } finally {
        setImporting(false);
        // Always clear the overlay (success OR error), so a failed import never
        // leaves the blocking modal stuck on screen.
        setImportProgress(null);
      }
    },
    [persistNew, destinationName],
  );

  // IMPORT flow (shared core): filter the gathered files to importable
  // sequence extensions (folder pick + drag-drop hand us EVERY file, so the
  // filter happens here, not the input's `accept`), then read each kept file
  // (text for .gb/.fasta, bytes for .dna), parse via the vendored bio-parsers,
  // convert to GenBank, and create. `filtered` is false for the single-/multi-
  // file picker (its `accept` already constrained the choice), so a deliberately
  // -picked non-sequence file still surfaces a parse error.
  //
  // Destination: when a specific project collection is active, the target is
  // unambiguous, so import straight into it. When the active collection is All
  // Sequences / Unfiled, the target is AMBIGUOUS, so open the "Import into"
  // chooser (defaulting to Unfiled) instead of silently dropping the files. All
  // three entry paths (file picker, folder picker, drag-drop) funnel here.
  const handleImport = useCallback(
    async (incoming: File[], opts?: { filtered?: boolean }) => {
      if (incoming.length === 0) return;
      setImporting(true);
      setStatus(null);
      try {
        let files = incoming;
        let skipped = 0;
        if (opts?.filtered) {
          const part = partitionImportableFiles(incoming);
          files = part.kept;
          skipped = part.skipped;
          if (files.length === 0) {
            const noun = skipped === 1 ? "file" : "files";
            setStatus({
              text: `No sequence files found (skipped ${skipped} non-sequence ${noun}).`,
              tone: "error",
            });
            return;
          }
        }
        const allImports: ImportedSequence[] = [];
        const messages: string[] = [];
        for (const file of files) {
          try {
            const bytes = await file.arrayBuffer();
            const res = await importSequenceFile(file.name, bytes);
            allImports.push(...res.sequences);
            messages.push(...res.messages);
          } catch {
            messages.push(`Failed to read "${file.name}".`);
          }
        }
        if (allImports.length === 0) {
          setStatus({
            text: messages[0] ?? "No sequences could be imported.",
            tone: "error",
          });
          return;
        }
        // Specific project active ⇒ unambiguous, import straight in.
        if (activeProjectIds.length > 0) {
          await finishImport(allImports, activeProjectIds[0], skipped);
          return;
        }
        // Ambiguous (All / Unfiled) ⇒ ask which collection to file into. The
        // chooser owns the rest of the flow (persist on Import, abort on
        // Cancel).
        setImportTarget({
          count: allImports.length,
          skipped,
          projects: projects.map((p) => ({ id: String(p.id), name: p.name })),
          onConfirm: (projectId) => {
            setImportTarget(null);
            void finishImport(allImports, projectId, skipped);
          },
          onCancel: () => setImportTarget(null),
        });
      } finally {
        // Release the import lock. The direct-import path already finished via
        // finishImport (which manages its own lock); the chooser path hands off
        // to onConfirm/onCancel, so the toolbar must be interactive meanwhile.
        setImporting(false);
      }
    },
    [activeProjectIds, finishImport, projects],
  );

  // File picker (single / multi): the input `accept` already constrains the
  // choice, so no extension filter — funnel straight through the import core.
  const handleFilesPicked = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        await handleImport(Array.from(files));
      } finally {
        // Reset so re-picking the same file fires onChange again.
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [handleImport],
  );

  // Folder picker (webkitdirectory): grabs EVERY file in the folder; the
  // `accept` attribute is ignored for directory mode, so we filter in code.
  const handleFolderPicked = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        await handleImport(Array.from(files), { filtered: true });
      } finally {
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [handleImport],
  );

  // Drag-and-drop: the drop zone hands us a flat File[] (folders recursed); the
  // mix is unknown, so filter in code like the folder picker.
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      void handleImport(files, { filtered: true });
    },
    [handleImport],
  );

  // Clear the transient status after a short delay.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(t);
  }, [status]);

  // beforeunload guard: while a multi-file import is in flight, arm the
  // browser's native "Leave site?" prompt so a refresh / tab-close / external
  // navigation can't silently abandon a half-written batch. The in-app
  // ImportProgressOverlay covers the visual / in-app-navigation side; this is
  // the browser-level protection. Removed the moment importProgress clears
  // (success or error), so it never lingers past the import.
  useEffect(() => {
    if (!importProgress) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy assignment some browsers still require to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [importProgress]);

  // Close the Import menu on outside click / Escape.
  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!importMenuRef.current?.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImportMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [importMenuOpen]);

  // Escape exits focus mode, but only when it is "free" — never while the user
  // types in a field / contenteditable, and never when a dialog or the import
  // menu is open (those own Escape). Mirrors the markdown editor's guarded
  // Escape (LiveMarkdownEditor) in spirit: capture phase, re-check guards.
  useEffect(() => {
    if (!shell.collapsed) return;
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // A dialog or the import dropdown owns Escape while open.
      if (newOpen || assembleOpen || compareOpen || importMenuOpen || importTarget) return;
      const active = document.activeElement as HTMLElement | null;
      const typing =
        !!active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable);
      if (typing) return;
      // Decline if any modal dialog is mounted anywhere (belt-and-suspenders
      // for child overlays we do not directly track).
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      shell.setCollapsed(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    shell.collapsed,
    shell.setCollapsed,
    newOpen,
    assembleOpen,
    compareOpen,
    importMenuOpen,
    importTarget,
  ]);

  return (
    <AppShell>
      {/* Centered, blocking progress overlay for multi-file imports. Portals
          to document.body; renders only when importProgress is set with
          total > 1. Single-file imports use the inline status line below. */}
      <ImportProgressOverlay progress={importProgress} />
      {/* Dark mode: both the LEFT library panel and the RIGHT editor surface now
          theme. The editor is custom SVG/DOM (no third-party canvas), so its map
          + sequence views recolor via the --seq-* CSS vars (globals.css) and its
          chrome via semantic tokens. light-scope is no longer applied here; it
          stays available as a per-subsurface safety valve if any piece misbehaves. */}
      {/* The split editor needs real horizontal room AND the File System Access
          API, neither of which a phone offers, so below md we show a calm notice
          instead of the broken, horizontally-overflowing split layout. */}
      <div className="flex h-full min-h-0 items-center justify-center px-6 pb-4 text-center md:hidden">
        <div className="max-w-sm">
          <h2 className="mb-2 text-title font-bold text-foreground">
            Open the sequence editor on a desktop
          </h2>
          <p className="text-body text-foreground-muted">
            The sequence workbench needs a wide screen, and it reads your
            sequences straight from your data folder through a browser API that
            phones do not support. Open ResearchOS in Chrome or Edge on a
            computer to view and edit sequences.
          </p>
        </div>
      </div>
      <div
        ref={shell.containerRef}
        /* Fill the AppShell `main` area (which already subtracts the header)
         * instead of a hardcoded `100vh - 7rem`, which undershot and left a
         * dead ~60px bar at the bottom of the editor. `h-full min-h-0` lets the
         * library + viewer run all the way down; `pb-4` keeps the same 1rem
         * frame as the side padding so the rounded panels aren't flush.
         * Hidden below md (phone width) where the split cannot lay out; the
         * mobile notice above takes over there. */
        className="relative hidden h-full min-h-0 px-4 pb-4 md:flex"
      >
        {/* Focus re-open handle. Focus mode now lives in the (collapsing)
            sidebar header, so this thin pill on the left edge is the visible way
            back when the sidebar is hidden (Esc still works too). Absolutely
            positioned so re-opening does not shift the canvas. */}
        {shell.collapsed ? (
          <Tooltip label="Show the sequence list" placement="right">
            <button
              type="button"
              onClick={() => shell.setCollapsed(false)}
              aria-label="Show the sequence list"
              className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-lg border border-l-0 border-border bg-surface-raised px-1 py-3 text-foreground-muted shadow-md transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-4 w-4"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
        {/* LEFT: working tree / library. Wrapped in a drag-and-drop target so a
            user can drop files or a whole folder anywhere on the library to
            bulk-import (folders recursed; non-sequence files skipped). The
            outer wrapper owns the controlled, drag-resizable px width and
            collapses to 0 in focus mode so the viewer fills the page. */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ${
            shell.collapsed ? "pointer-events-none" : ""
          }`}
          style={{ width: shell.collapsed ? 0 : shell.width }}
          aria-hidden={shell.collapsed}
        >
        <SequenceDropZone
          onFiles={handleDroppedFiles}
          disabled={importing}
          className="flex h-full w-full min-w-0 flex-col"
        >
        <aside className="flex h-full w-full flex-col rounded-lg border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3">
            {/* Stack the title + description above the actions so they get the
                full sidebar width (no truncated title / thin wrapped text); the
                action buttons sit on their own row below. Calm, Apple-ish. */}
            <div className="flex flex-col gap-3">
              {/* Contextual header. With a sequence open the sidebar reflects what
                  you are working on (name, type, topology, length, features, and
                  organism) and carries Share + Focus, the two actions that used to
                  live in the editor's title row. With nothing open it falls back
                  to the generic workbench intro. */}
              {selected ? (
                <div className="border-b border-border pb-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h1 className="truncate text-base font-semibold text-foreground">
                          {selected.display_name}
                        </h1>
                        {/* Provenance, self-hides unless this sequence arrived
                            through a cross-boundary share. */}
                        <ReceivedFromBadge
                          receivedFrom={selected.received_from}
                          fingerprint={selected.received_from_fingerprint}
                          receivedAt={selected.received_at}
                          small
                        />
                        {/* Deleted/restored provenance, self-hides unless this
                            sequence was restored from Trash. */}
                        <RestoredBadge audit={selected._restore_audit} small />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* Copy reference for a note. Mirrors the chemistry
                          molecule detail's visible "Copy reference for a note"
                          action so exporting an open sequence into a note,
                          experiment (results or lab notes), or method is one
                          click, then "/" or paste drops it in as a chip. The
                          right-click row menu still has the same action. */}
                      <Tooltip label="Copy reference for a note" placement="bottom">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyReference({
                              type: "sequence",
                              id: selected.id,
                              name: selected.display_name,
                            })
                          }
                          aria-label="Copy reference for a note"
                          className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="copy" className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      {/* Send to... pushes this sequence's reference chip
                          straight into a chosen note, experiment (results or
                          lab notes), or method, no copy-paste. Mirrors the
                          chemistry molecule's "Send to..." action. */}
                      <Tooltip label="Send to a note, experiment, or method" placement="bottom">
                        <button
                          type="button"
                          onClick={() => setSendOpen(true)}
                          aria-label="Send to a note, experiment, or method"
                          className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="export" className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      {canShare && (
                      <Tooltip label="Share" placement="bottom">
                        <button
                          type="button"
                          onClick={() => setShareOpen(true)}
                          aria-label="Share"
                          className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                        >
                          <ShareIcon className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      )}
                      <Tooltip
                        label={
                          shell.collapsed
                            ? "Exit focus mode (Esc) and show the sequence list"
                            : "Focus mode, hide the list so the viewer fills the page"
                        }
                        placement="bottom"
                      >
                        <button
                          type="button"
                          onClick={() => shell.setCollapsed(!shell.collapsed)}
                          aria-pressed={shell.collapsed}
                          aria-label={
                            shell.collapsed
                              ? "Exit viewer focus mode"
                              : "Enter viewer focus mode"
                          }
                          className={`shrink-0 rounded p-1.5 transition-colors ${
                            shell.collapsed
                              ? "bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300 hover:bg-sky-200"
                              : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                          }`}
                        >
                          <FocusIcon className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <p className="mt-1.5 text-meta text-foreground-muted">
                    {seqTypeLabel(selected.seq_type)} ·{" "}
                    {selected.circular ? "Circular" : "Linear"} ·{" "}
                    {selected.length.toLocaleString()} bp · {selected.feature_count}{" "}
                    {selected.feature_count === 1 ? "feature" : "features"}
                  </p>
                  {/* Organism line, mirrors the list-row binomial styling
                      (tree glyph + italic name). Self-hides on a bare sequence. */}
                  {selected.organism ? (
                    <span className="mt-1 flex min-w-0 items-center gap-1 text-meta italic text-emerald-600 dark:text-emerald-400">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0"
                      >
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
                      </svg>
                      <span className="truncate">{selected.organism}</span>
                    </span>
                  ) : null}
                  {/* Backlinks panel — self-hides when the sequence has no references. */}
                  <ObjectBacklinks
                    type="sequence"
                    id={String(selected.id)}
                    className="mt-3"
                  />
                </div>
              ) : (
                <div>
                  <h1 className="text-lg font-semibold text-foreground">Sequences</h1>
                  <p className="mt-0.5 text-meta text-foreground-muted">
                    Your molecular-biology workbench. Edit, annotate, design
                    primers, plan cloning, and find domains.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  className="flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  New
                </button>
                {/* Assemble: open the standalone cloning workspace (overlap /
                    Gibson, restriction + ligation, Golden Gate, Gateway).
                    Combines several library sequences into a new construct. */}
                <Tooltip label="Assemble a new construct from fragments (Gibson overlap, restriction, Golden Gate, or Gateway).">
                  <button
                    type="button"
                    onClick={() => setAssembleOpen(true)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
                  >
                    <AssembleIcon className="h-3.5 w-3.5" />
                    Assemble
                  </button>
                </Tooltip>
                {/* Compare: align two library sequences and see their percent
                    identity, mismatches, gaps, and a k-mer dotplot. */}
                <Tooltip label="Align two sequences and see percent identity, mismatches, gaps, and a dotplot.">
                  <button
                    type="button"
                    onClick={() => setCompareOpen(true)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
                  >
                    <AlignIcon className="h-3.5 w-3.5" />
                    Align
                  </button>
                </Tooltip>
                {/* Import split-menu: pick files, or pick a whole folder
                    (e.g. a SnapGene collection). Drag-and-drop also works
                    anywhere on the library. */}
                <div className="relative" ref={importMenuRef}>
                  <Tooltip label="Import files or a whole folder. You can also drag files or a folder onto the library.">
                    <button
                      type="button"
                      onClick={() => setImportMenuOpen((o) => !o)}
                      disabled={importing}
                      aria-haspopup="menu"
                      aria-expanded={importMenuOpen}
                      className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
                    >
                      <ImportIcon className="h-3.5 w-3.5" />
                      {importing ? "Importing…" : "Import"}
                      <ChevronDownIcon className="h-3 w-3 text-foreground-muted" />
                    </button>
                  </Tooltip>
                  {importMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute left-0 z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setImportMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-meta font-medium text-foreground hover:bg-surface-sunken"
                      >
                        <FileIcon className="h-3.5 w-3.5 text-foreground-muted" />
                        Choose files…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setImportMenuOpen(false);
                          folderInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-meta font-medium text-foreground hover:bg-surface-sunken"
                      >
                        <FolderIcon className="h-3.5 w-3.5 text-foreground-muted" />
                        Choose folder…
                      </button>
                    </div>
                  ) : null}
                </div>
                {/* Download from NCBI: pull a gene / genome / accession straight
                    from the NCBI Datasets API into the active collection. */}
                <Tooltip label="Download a gene or genome from NCBI straight into your collection.">
                  <button
                    type="button"
                    onClick={() => setNcbiOpen(true)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
                  >
                    <NcbiCloudIcon className="h-3.5 w-3.5" />
                    Download from NCBI
                  </button>
                </Tooltip>
              </div>
            </div>
            {status ? (
              <p
                className={`mt-2 text-meta ${
                  status.tone === "error"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {status.text}
              </p>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={IMPORT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleFilesPicked(e.target.files)}
            />
            {/* Folder picker. webkitdirectory grabs every file in the chosen
                folder (accept is ignored for directory mode), so the kept set
                is filtered in code by handleFolderPicked. */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // Non-standard attributes for directory selection (cast for TS).
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              className="hidden"
              onChange={(e) => handleFolderPicked(e.target.files)}
            />
          </div>

          {/* Collection selector */}
          <div className="border-b border-border px-3 py-2">
            <label className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Collection
            </label>
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value as Collection)}
              className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
            >
              <option value="all">All Sequences ({sequences.length})</option>
              <option value="unfiled">Unfiled ({unfiledCount})</option>
              {projects.length > 0 && (
                <optgroup label="Projects">
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({projectCounts.get(String(p.id)) ?? 0})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* sequence editor master. The active collection's right-click home.
                The picker is a native <select> whose <option>s cannot host a
                context menu, so when a real project collection is active we show
                its name as a small right-clickable chip below the select. Right-
                click it for Copy reference / Rename / Delete (the universal
                collection menu). */}
            {activeProject ? (
              <div
                onContextMenu={(e) =>
                  openMenu(e, buildCollectionMenu(activeProject.id, activeProject.name))
                }
                className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted"
              >
                <span className="truncate">{activeProject.name}</span>
                <span className="shrink-0 text-foreground-muted">right-click for actions</span>
              </div>
            ) : null}
          </div>

          {/* Search */}
          <div className="border-b border-border px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sequences…"
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
          </div>

          {/* Bulk-select action bar — shown only when one or more rows are
              checked. "Delete N selected" routes each through the recoverable
              trash with one shared Undo toast. */}
          {checkedIds.size > 0 ? (
            <div className="flex items-center justify-between gap-2 border-b border-border bg-accent-soft px-3 py-2">
              <span className="text-meta font-medium text-accent">
                {checkedIds.size} selected
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCheckedIds(new Set())}
                  className="rounded-md px-2 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-raised"
                >
                  Clear
                </button>
                {/* Bulk SEND outside the lab. Reuses the single-sequence send,
                    looped once per checked id (each lands as its own inbox item
                    the recipient can sort independently). Hidden for solo/locked
                    accounts (capabilities bot, phase 3). */}
                {canShare && (
                <button
                  type="button"
                  onClick={() => setBulkSendOpen(true)}
                  disabled={deleting}
                  className="flex items-center gap-1 rounded-md border border-accent bg-surface-raised px-2.5 py-1 text-meta font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                >
                  <ShareIcon className="h-3.5 w-3.5" />
                  {`Send ${checkedIds.size} selected`}
                </button>
                )}
                <button
                  type="button"
                  onClick={handleDeleteChecked}
                  disabled={deleting}
                  className="flex items-center gap-1 rounded-md border border-rose-200 dark:border-rose-500/30 bg-surface-raised px-2.5 py-1 text-meta font-medium text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  {deleting
                    ? "Deleting…"
                    : `Delete ${checkedIds.size} selected`}
                </button>
              </div>
            </div>
          ) : null}

          {/* Sort header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-b border-border px-3 py-1.5">
            <Tooltip
              label={allVisibleChecked ? "Deselect all" : "Select all visible"}
            >
              <input
                type="checkbox"
                checked={allVisibleChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleChecked;
                }}
                onChange={toggleAllVisible}
                aria-label="Select all visible sequences"
                className="h-3.5 w-3.5 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
              />
            </Tooltip>
            <SortHeader label="Name" col="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Type" col="type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Length" col="length" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-6 text-body text-foreground-muted">Loading…</div>
            ) : sorted.length === 0 ? (
              sequences.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <p className="text-body font-medium text-foreground-muted">No sequences yet</p>
                  <p className="text-meta leading-relaxed text-foreground-muted">
                    Use New, Assemble, or Import above to create a sequence or
                    bring in a GenBank, FASTA, or SnapGene file.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-6 text-body text-foreground-muted">
                  No sequences match this filter.
                </div>
              )
            ) : (
              <ul>
                {sorted.map((s) => {
                  const checked = checkedIds.has(s.id);
                  return (
                  <li
                    key={s.id}
                    onContextMenu={(e) => {
                      // Route the universal list-row menu through the framework
                      // (Rename / Duplicate / Share / Copy reference / Delete,
                      // plus the taxonomy Copy / Paste group). openMenu
                      // preventDefaults the event for us.
                      openMenu(e, buildRowMenu(s));
                    }}
                    className={`group flex items-center gap-1 border-b border-border pr-2 hover:bg-accent-soft ${
                      selectedId === s.id ? "bg-accent-soft" : ""
                    } ${checked ? "bg-accent-soft/70" : ""}`}
                  >
                    {/* Row checkbox for bulk select. Stop propagation so a
                        check doesn't also change the open viewer selection. */}
                    <span className="flex shrink-0 items-center pl-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleChecked(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${s.display_name}`}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => selectSequenceFromList(s.id)}
                      data-testid={`seq-list-row-${s.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 text-left"
                    >
                      <MoleculeIcon
                        circular={s.circular}
                        className={`h-4 w-4 shrink-0 ${
                          selectedId === s.id ? "text-accent" : "text-foreground-muted"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="block truncate text-body font-medium text-foreground">
                            {s.display_name}
                          </span>
                          {/* restore audit bot: tiny pill + hover provenance,
                              self-hides unless this sequence was restored from
                              Trash. Kept subtle so the row stays uncluttered. */}
                          <RestoredBadge audit={s._restore_audit} small />
                        </span>
                        <span className="block text-meta text-foreground-muted">
                          {seqTypeLabel(s.seq_type)} · {s.length.toLocaleString()} bp ·{" "}
                          {formatAdded(s.added_at)}
                        </span>
                        {/* sequence editor master. At-a-glance taxonomy signal.
                            When a sequence carries an organism (NCBI-enriched or
                            hand-labeled) the row shows its binomial name so the
                            library is scannable for which sequences are labeled,
                            instead of having to open each one. Self-hides on a
                            bare sequence. */}
                        {s.organism ? (
                          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-meta italic text-emerald-600 dark:text-emerald-400">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              className="h-3 w-3 shrink-0"
                            >
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
                            </svg>
                            <span className="truncate">{s.organism}</span>
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {/* Per-row delete, revealed on hover / focus. Routes
                        through the recoverable trash with an Undo toast. */}
                    <Tooltip label="Move to Trash" placement="left">
                      <button
                        type="button"
                        onClick={() => handleDeleteOne(s)}
                        disabled={deleting}
                        aria-label={`Move ${s.display_name} to Trash`}
                        className="shrink-0 rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-rose-50 dark:hover:bg-rose-500/20 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        </SequenceDropZone>
        </div>

        {/* Drag-resizable divider between the list and the viewer. Hidden in
            focus mode (nothing to resize). Hover reveals a subtle handle;
            keyboard arrows nudge the width. Funnels through clampListWidth so
            neither pane can be dragged below its min. */}
        {!shell.collapsed ? (
          <Tooltip label="Drag to resize (or use arrow keys)">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the sequence list"
              tabIndex={0}
              {...shell.dividerHandlers}
              className="group relative mx-1 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center focus:outline-none"
            >
              <span
                aria-hidden="true"
                className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-sky-400 group-focus:bg-sky-400"
              />
            </div>
          </Tooltip>
        ) : null}

        {/* RIGHT: the single fluid editor surface. No Read|Edit modal toggle —
            you select / inspect (readout) / edit / double-click a feature all in
            one place (SnapGene / Benchling spirit). The /sequences route renders
            it editable (the user's own sequences); a read-only embed passes
            readOnly to the same component. */}
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface-raised">
          {selected ? (
            <>
              {/* No editor title row. The open sequence's name, meta, organism,
                  and the Share + Focus actions now live in the contextual left
                  sidebar header, so the editor starts directly at its action bar
                  and reclaims a full row of vertical space for the canvas. */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <SequenceEditView
                  key={selected.id}
                  sequence={selected}
                  onSave={handleSave}
                  saving={saving}
                  onEnriched={handleEnriched}
                  onApplyTaxonomy={(taxonomy) =>
                    applyTaxonomy(selected.id, selected.genbank, taxonomy)
                  }
                  onExploreInTree={(taxId) => {
                    // Opened FROM the open sequence (a lineage-level click or the
                    // Analyze-menu entry): pin that sequence's trail so the tree
                    // highlights it and shows the jump-back chip.
                    setExplorerPinned(pinnedForOpenSequence);
                    setExplorerTaxId(taxId);
                    setExplorerOpen(true);
                  }}
                  onLookupTaxonomy={() => setTaxonomyOpen(true)}
                  onOpenAssemble={() => setAssembleOpen(true)}
                  onCreateSequenceFromRegion={handleCreateFromRegion}
                  collectionSequences={collectionSiblings}
                  collectionLabel={collectionLabel}
                  onOpenSequence={setSelectedId}
                  onDirtyChange={setEditorDirty}
                />
              </div>
            </>
          ) : (
            // No sequence open: show the calm workbench overview (the launcher)
            // instead of a bare empty state. The clickable action cards reuse the
            // header handlers; the hint list teaches the editor-internal tools.
            <SequencesLauncher
              onNew={() => setNewOpen(true)}
              onAssemble={() => setAssembleOpen(true)}
              onAlign={() => setCompareOpen(true)}
              onImport={() => fileInputRef.current?.click()}
              onNcbi={() => setNcbiOpen(true)}
              onLookupTaxonomy={() => setTaxonomyOpen(true)}
              onExploreTaxonomy={() => {
                // Opened from the launcher (no open sequence): nothing pinned.
                setExplorerPinned(undefined);
                setExplorerTaxId(undefined);
                setExplorerOpen(true);
              }}
            />
          )}
        </section>
      </div>

      {/* "Import into" chooser — shown only when the active collection is
          ambiguous (All Sequences / Unfiled). Picks the destination project (or
          Unfiled) before the gathered sequences are persisted. */}
      <SequenceImportTargetDialog request={importTarget} />

      <SequenceNewDialog
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onSubmit={handleNewSubmit}
      />

      {/* Compare two sequences: align them (global / local, IUPAC-aware) and
          show identity, mismatches, gaps, and a dotplot. Seeds Sequence A from
          the currently selected library item. */}
      <CompareSequencesDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        defaultAId={selectedId}
      />

      {/* Download from NCBI: gene by symbol + organism, genome by accession, or
          any accession -> preview (caps enforced) -> download -> the parsed
          sequence(s) land in the active collection via handleNcbiImported. */}
      <NcbiDownloadDialog
        open={ncbiOpen}
        onClose={() => {
          setNcbiOpen(false);
          setNcbiPrefill(undefined);
        }}
        onImported={handleNcbiImported}
        prefill={ncbiPrefill}
      />

      {/* sequence editor master. The standalone organism-to-lineage lookup tool.
          Pure client over the NCBI taxonomy endpoint, no sequence involved. An
          "Explore in tree" cross-link opens the tree explorer centered on the
          looked-up organism. */}
      <TaxonomyLookupDialog
        open={taxonomyOpen}
        onClose={() => setTaxonomyOpen(false)}
        onExploreInTree={(taxId) => {
          // The standalone lookup is not tied to the open sequence, so its
          // tree cross-link pins nothing.
          setTaxonomyOpen(false);
          setExplorerPinned(undefined);
          setExplorerTaxId(taxId);
          setExplorerOpen(true);
        }}
      />

      {/* sequence editor master. The radial tree-of-life explorer (the primary
          surface, oseiskar style). Branches fan out from a center with thickness
          from each clade's species count, backed by the offline backbone (family
          and above) with a live drill below family. Click a branch for the slim
          detail (species / assemblies toggle + a species-node NCBI import jump). */}
      <TaxonomyTreeView
        open={explorerOpen}
        initialTaxId={explorerTaxId}
        pinned={explorerPinned}
        onClose={() => setExplorerOpen(false)}
        onImportOrganism={({ organism, accession }) => {
          setExplorerOpen(false);
          // A tip assembly row carries an accession, which opens the guided
          // flow's accession escape hatch seeded with it; an organism-only jump
          // seeds the wizard's organism step.
          setNcbiPrefill(
            accession ? { accession, organism } : { organism },
          );
          setNcbiOpen(true);
        }}
      />

      {/* Unified Share dialog. Sequences have no lab-ACL model, so the dialog
          shows only the "Outside your lab" tab (the cross-boundary encrypted-copy
          send / invite). Opens from the same single Share button. Only mounts
          with a loaded sequence + a resolved user (the export collect context). */}
      {shareOpen && selected && currentUser && (
        <UnifiedShareDialog
          isOpen
          target={{ kind: "sequence", sequence: selected, owner: currentUser }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Send the open sequence's reference into a note / experiment / method. */}
      {sendOpen && selected && (
        <SendReferencePicker
          referenceMarkdown={objectReferenceMarkdown(
            "sequence",
            String(selected.id),
            selected.display_name,
          )}
          sourceLabel={selected.display_name}
          onClose={() => setSendOpen(false)}
          onResult={(text, ok) =>
            setStatus({ text, tone: ok ? "ok" : "error" })
          }
        />
      )}

      {/* Bulk send the checked selection outside the lab. One recipient, then a
          loop of the single-sequence send (one {kind:"sequence"} payload each).
          Mounts only with a resolved user + a non-empty selection. */}
      {bulkSendOpen && currentUser && checkedIds.size > 0 && (
        <BulkSequenceSendDialog
          ids={Array.from(checkedIds)}
          ownerUsername={currentUser}
          onClose={() => setBulkSendOpen(false)}
          onSent={() => setCheckedIds(new Set())}
        />
      )}

      {/* Standalone overlap-assembly (Gibson / NEBuilder HiFi) workspace. The
          saved construct lands in the active collection and opens in the editor. */}
      <CloningWorkspace
        open={assembleOpen}
        onClose={() => setAssembleOpen(false)}
        activeProjectIds={activeProjectIds}
        onSaved={async (newId) => {
          setAssembleOpen(false);
          await queryClient.invalidateQueries({ queryKey: ["sequences"] });
          setSelectedId(newId);
          setStatus({ text: "Construct assembled and saved.", tone: "ok" });
        }}
      />

      {/* sequence editor master. The list-row taxonomy copy / paste menu now
          opens through the website-wide framework (useContextMenu().openMenu in
          the row's onContextMenu above). Copy is enabled only when the row HAS
          taxonomy; Paste only when the clipboard holds one (it opens the inline
          confirm rather than writing straight). The ONE shared menu is rendered
          by ContextMenuProvider. */}

      {/* sequence editor master. The single-paste confirm for a list row. Names
          the organism being pasted onto the named target before any write. */}
      {pasteConfirm ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPasteConfirm(null)}
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
                {pasteConfirm.fromName}
              </span>{" "}
              onto{" "}
              <span className="font-medium text-foreground">
                {pasteConfirm.seq.display_name}
              </span>
              ?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasteConfirm(null)}
                className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const req = pasteConfirm;
                  setPasteConfirm(null);
                  void runPasteTaxonomy(req.seq.id, req.taxonomy);
                }}
                className="rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90"
              >
                Paste taxonomy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* sequence editor master. The inline rename prompt for the universal row /
          collection menu. Reuses the Select Range prompt pattern. parse rejects an
          empty name so Confirm only enables on real input. */}
      <SequencePromptDialog<string>
        open={renameTarget != null}
        title={
          renameTarget?.kind === "collection"
            ? "Rename collection"
            : "Rename sequence"
        }
        label="New name"
        initialValue={renameTarget?.name ?? ""}
        confirmLabel="Rename"
        parse={(raw) => {
          const t = raw.trim();
          return t.length > 0 ? t : null;
        }}
        onConfirm={(value) => void handleRenameConfirm(value)}
        onClose={() => setRenameTarget(null)}
      />
    </AppShell>
  );
}
