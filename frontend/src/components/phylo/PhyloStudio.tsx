"use client";

// The Tree Studio (phylo Phase 2 + 3 + 4), the iTOL alternative.
//
// You bring a finished tree (upload / paste / a saved tree), link a metadata
// table, toggle annotation tracks, edit the figure (reroot, ladderize, collapse,
// layout, phylogram vs cladogram, support values), and export SVG / PNG / copy
// plus the reproducible ggtree code. Native SVG, no server, no tree inference.
//
// All raw SVG markup is produced by lib/phylo/render.ts (the single renderer
// module). This component never writes SVG itself, it injects the renderer
// string and renders <Icon> UI chrome. The export path reuses the Data Hub
// helpers (downloadSvg / svgToPngBlob / clipboard) so what you see is what you
// export. Matches the approved mockup (docs/mockups/2026-06-12-phylogenetics-page.html).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { phyloApi } from "@/lib/phylo/api";
import { PhyloCollectionRail } from "@/components/phylo/PhyloCollectionRail";
import {
  SequenceOperationsRail,
  type RailOperation,
} from "@/components/sequences/SequenceOperationsRail";
import {
  clampListWidth,
  DEFAULT_LIST_WIDTH,
  LIST_MIN_WIDTH,
  LIST_MAX_WIDTH,
} from "@/lib/sequences/split-layout";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import type { PhyloMeta } from "@/lib/phylo/types";
import {
  parseTree,
  leaves,
  TreeParseError,
  type TreeNode,
} from "@/lib/phylo/parse";
import {
  ladderize,
  midpointRoot,
  rerootOnNode,
  parseCsv,
  matchMetadataToTips,
  bestTipColumn,
  type MetadataMatch,
} from "@/lib/phylo/layout";
import {
  renderTreeSvg,
  type RenderSpec,
} from "@/lib/phylo/render";
import {
  figureToRenderSpec,
  figureInputsFromStored,
} from "@/lib/phylo/figure-to-render";
import { projectTracksToPanels } from "@/lib/phylo/panels";
import { classifyColumn } from "@/lib/phylo/color-scale";
import {
  parseAlignment,
  matchAlignmentToTips,
  type Alignment,
} from "@/lib/phylo/msa";
import type { AlignedPanel } from "@/lib/phylo/types";
import {
  PhyloLayersControl,
  buildTemplate,
} from "@/components/phylo/PhyloLayers";
import {
  objectDeepLink,
  objectEmbedMarkdown,
  DEFAULT_EMBED_VIEW,
} from "@/lib/references";
import { generateGgtreeCode, GGTREE_CAVEAT } from "@/lib/phylo/ggtree-code";
import {
  downloadSvg,
  svgToPngBlob,
} from "@/lib/datahub/plot-spec";

const FIG_W = 620;
const FIG_H = 460;

// Per-page key for the persisted left-rail width (the shared split shell, keyed
// per page exactly as Sequences/Chemistry do).
const LIST_WIDTH_KEY = "researchos:phylo:listWidth";

// The right action-rail operations, in order. Each becomes a tab + flyout via
// SequenceOperationsRail (recycled). The panels are built in the component.
type PhyloOpId = "layers" | "setup" | "export" | "code";

const SAMPLE_TREE =
  "(((A. fumigatus:0.5,A. fischeri:0.5)100:0.3,(((A. flavus:0.45,A. oryzae:0.45)96:0.25,(A. nidulans:0.55,(A. niger:0.4,P. chrysogenum:0.6)90:0.2)85:0.18)80:0.15));";

const SAMPLE_CSV = [
  "tip,section,genome,gliP",
  "A. fumigatus,Fumigati,29.4,yes",
  "A. fischeri,Fumigati,32.5,no",
  "A. flavus,Flavi,37.0,yes",
  "A. oryzae,Flavi,37.1,no",
  "A. nidulans,Nidulantes,30.1,no",
  "A. niger,Nigri,34.0,yes",
  "P. chrysogenum,Outgroup,32.2,no",
].join("\n");

// A tiny aligned FASTA over the sample tree's tips, so "Sample alignment" shows
// the msa track without a file. Gaps are intentional (a real alignment has them).
const SAMPLE_ALIGNMENT = [
  ">A. fumigatus",
  "ATGCATGC-TAGCTAGCATCG",
  ">A. fischeri",
  "ATGCATGC-TAGCTAGCATGG",
  ">A. flavus",
  "ATGCATGCATAGCT-GCATCG",
  ">A. oryzae",
  "ATGCATGCATAGCT-GCATCG",
  ">A. nidulans",
  "ATGGATGCATA-CTAGCATCG",
  ">A. niger",
  "ATGCATGCATAGCTAGCAT-G",
  ">P. chrysogenum",
  "TTGCATGCATAGCTAGCATCA",
].join("\n");

type ImportMode = "upload" | "paste" | "saved" | null;

// The default layer stack a fresh figure starts from (phylo Phase 1): a plain
// phylogram with tip points + color strip + labels, the same baseline the Phase 0
// track defaults projected to. Built once, ids are regenerated per figure.
// All Phase 0 tracks off: the layer stack drives the render now, so the adapter's
// legacy track path stays inert and `panels` is the single source of truth.
const EMPTY_TRACKS = {
  labels: false,
  labelsItalic: false,
  points: false,
  strip: false,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

/** Tip count past which tip labels start unreadable + are defaulted OFF. */
const LABELS_OFF_TIP_THRESHOLD = 100;

/**
 * The default layer stack for a freshly imported tree. Tip labels start OFF on a
 * large tree (> LABELS_OFF_TIP_THRESHOLD tips) because hundreds of overlapping
 * names are unreadable; the user can turn them back on in the layers list. A
 * small tree keeps labels on, as before.
 */
function defaultPanels(tipCount = 0): AlignedPanel[] {
  return projectTracksToPanels({
    tracks: {
      labels: tipCount <= LABELS_OFF_TIP_THRESHOLD,
      labelsItalic: true,
      points: true,
      strip: true,
      bars: false,
      heat: false,
      clade: false,
      support: false,
    },
  });
}

export function PhyloStudio({ initialTreeId }: { initialTreeId?: string } = {}) {
  // The working tree (immutable, edits replace it). Null until a tree is brought in.
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeName, setTreeName] = useState("Untitled tree");
  // The id of the saved tree currently open, when one was opened from the library
  // (saved picker, demo auto-open, or a ?doc= deep link). Drives Copy reference,
  // which can only point at a tree that already lives in the store. Null for a
  // freshly imported / pasted tree that has not been saved yet.
  const [openTreeId, setOpenTreeId] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [pasteText, setPasteText] = useState("");

  const [layout, setLayout] = useState<"rectangular" | "circular">(
    "rectangular",
  );
  const [phylogram, setPhylogram] = useState(true);
  // The ordered LAYER stack (phylo Phase 1). This IS the persisted panels[]; the
  // layers control edits it directly and the renderer + exporter walk it.
  const [panels, setPanels] = useState<AlignedPanel[]>(defaultPanels);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  // The template id currently applied (drives the picker so it does not snap back
  // to the placeholder after an apply, the template-apply flicker fix). Cleared to
  // "" whenever the layers are edited by hand, so the placeholder returns.
  const [appliedTemplate, setAppliedTemplate] = useState("");

  // Edit the layer stack by hand. Any manual change clears the applied-template
  // marker so the picker no longer claims a template (the figure is now custom).
  const editPanels = (next: AlignedPanel[]) => {
    setPanels(next);
    setAppliedTemplate("");
  };

  // The alignment import-state (phylo Phase 3). The parsed aligned FASTA lives
  // here as live figure state (NOT a persisted panels[] field), the same way the
  // metadata table does, so a saved figure is unchanged. The msa panel reads it
  // through the shared figure -> RenderSpec adapter.
  const [alignment, setAlignment] = useState<Alignment | null>(null);

  // Metadata binding.
  const [metaRows, setMetaRows] = useState<Record<string, string>[] | null>(
    null,
  );
  const [metaColumns, setMetaColumns] = useState<string[]>([]);
  const [tipColumn, setTipColumn] = useState<string>("");

  const [copyState, setCopyState] = useState<"idle" | "image" | "text">("idle");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // The open action-rail tab (Layers / Setup / Export / Code), null = collapsed.
  // Defaults to Layers so the layer stack shows on open, as it always did.
  const [activeOp, setActiveOp] = useState<PhyloOpId | null>("layers");

  const queryClient = useQueryClient();

  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const alnFileRef = useRef<HTMLInputElement>(null);

  // The shared split shell (resizable + collapse-to-focus + persisted width),
  // copy-adapted from /sequences + /chemistry via the shared clamp math.
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [listCollapsed, setListCollapsed] = useState(false);

  // Load saved trees for the "From a saved tree" picker. In a demo session, open
  // the showcase tree straight away so the Studio lands on a populated, real
  // figure instead of the empty import panel (the screenshots + public demo).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    phyloApi
      .list()
      .then((list) => {
        if (getDemoMode() && !autoOpenedRef.current && list.length > 0) {
          autoOpenedRef.current = true;
          // Lowest id is the Candida auris circular showcase tree.
          const showcase = [...list].sort((a, b) => Number(a.id) - Number(b.id))[0];
          void onPickSaved(showcase.id);
        }
      })
      .catch(() => {});
    // onPickSaved is stable for this mount; demo auto-open runs once. The rail
    // owns the live saved-trees list now (its own query), so we no longer mirror
    // it into local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A `?doc=<id>` deep link (the form a phylo object reference / embed builds via
  // objectDeepLink("phylo", ...)) opens that tree in the Studio on first load.
  // Read after mount and once only, mirroring the Data Hub page, so the static
  // export never trips on useSearchParams and a later manual pick is not yanked
  // back. The id wins over the demo auto-open above (a deliberate link beats the
  // showcase default).
  const deepLinkOpenedRef = useRef(false);
  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    if (!initialTreeId) {
      deepLinkOpenedRef.current = true;
      return;
    }
    deepLinkOpenedRef.current = true;
    autoOpenedRef.current = true; // suppress the demo auto-open, the link wins
    void onPickSaved(initialTreeId);
    // onPickSaved is stable for this mount; the deep link is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTreeId]);

  // ---- split shell (resizable left rail) ----

  // Restore + persist the dragged rail width (shared clamp math, per-page key).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(LIST_WIDTH_KEY);
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    const w = splitRef.current?.getBoundingClientRect().width ?? 0;
    if (Number.isFinite(parsed)) setListWidth(clampListWidth(parsed, w));
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(listWidth)));
  }, [listWidth]);

  const onDividerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);
  const onDividerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    setListWidth(clampListWidth(e.clientX - rect.left, rect.width));
  }, []);
  const onDividerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);
  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      const w = splitRef.current?.getBoundingClientRect().width ?? 0;
      setListWidth((cur) =>
        clampListWidth(cur + (e.key === "ArrowLeft" ? -step : step), w),
      );
    },
    [],
  );
  // Restore the page cursor / selection if unmounted mid-drag.
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        draggingRef.current = false;
      }
    };
  }, []);

  // The metadata match (tip ids -> rows), recomputed when the binding changes.
  const match: MetadataMatch | null = useMemo(() => {
    if (!tree || !metaRows || !tipColumn) return null;
    return matchMetadataToTips(tree, metaRows, tipColumn);
  }, [tree, metaRows, tipColumn]);

  // The numeric metadata columns (drive the inspector's continuous-scale hint).
  const numericColumns = useMemo(() => {
    if (!tree || !match) return [];
    return metaColumns.filter(
      (c) => c !== tipColumn && classifyColumn(tree, match.matched, c) === "numeric",
    );
  }, [tree, match, metaColumns, tipColumn]);

  // The primary category column for the pinned categorical hues, taken from the
  // first points / strip layer so points + strip + legend agree (as in Phase 0).
  const categoryColumn = useMemo(() => {
    const p = panels.find(
      (x) => (x.kind === "points" || x.kind === "strip") && x.column,
    );
    return p?.column ?? "";
  }, [panels]);

  // The single figure spec the renderer + the ggtree exporter both read, built by
  // the shared figure -> RenderSpec adapter so the Studio canvas, the export, and
  // an embedded card all map the same figure to the same spec (one mapping). The
  // layer stack drives the render; the legacy track fields stay empty.
  const spec: RenderSpec | null = useMemo(() => {
    if (!tree) return null;
    return figureToRenderSpec(
      tree,
      {
        layout,
        phylogram,
        tracks: EMPTY_TRACKS,
        categoryColumn,
        metaRows,
        tipColumn,
        panels,
        alignment,
      },
      { width: FIG_W, height: FIG_H },
    );
  }, [
    tree,
    layout,
    phylogram,
    categoryColumn,
    metaRows,
    tipColumn,
    panels,
    alignment,
  ]);

  // The alignment-to-tips match (for the "matched X of Y" indicator + auto-adding
  // an msa panel on import). Recomputed when the tree or the imported alignment
  // changes. Mirrors the metadata match indicator.
  const alnMatch = useMemo(() => {
    if (!tree || !alignment || alignment.records.length === 0) return null;
    return matchAlignmentToTips(tree, alignment);
  }, [tree, alignment]);

  const svgMarkup = useMemo(
    () => (tree && spec ? renderTreeSvg(tree, spec) : ""),
    [tree, spec],
  );
  const ggtreeCode = useMemo(
    () => (spec ? generateGgtreeCode(spec) : ""),
    [spec],
  );

  // ---- tree import ----

  function loadTreeText(text: string, name: string) {
    try {
      const parsed = parseTree(text);
      setTree(parsed);
      setTreeName(name);
      // Reset to the tip-count-aware default stack (labels OFF on a big tree).
      // A saved tree overrides this immediately via restoreSavedFigure.
      setPanels(defaultPanels(leaves(parsed).length));
      setSelectedLayerId(null);
      setAppliedTemplate("");
      // A new tree drops any previously imported alignment (it was joined to the
      // old tips); the user re-imports an alignment for the new tree.
      setAlignment(null);
      setParseError(null);
      setImportMode(null);
      setPasteText("");
      // A freshly imported / pasted tree has no stored id yet; onPickSaved and
      // onSave set it back when the tree is opened from or written to the store.
      setOpenTreeId(null);
    } catch (err) {
      setParseError(
        err instanceof TreeParseError
          ? err.message
          : "Could not read that tree. Check it is valid Newick or Nexus.",
      );
    }
  }

  async function onUploadFile(file: File) {
    const text = await file.text();
    loadTreeText(text, file.name.replace(/\.[^.]+$/, ""));
  }

  async function onPickSaved(id: string) {
    const raw = await phyloApi.get(id);
    if (!raw) return;
    loadTreeText(raw.tree, raw.meta.name);
    restoreSavedFigure(raw.meta);
    // This tree lives in the store, so Copy reference can point at it.
    setOpenTreeId(id);
  }

  /**
   * Reopen a saved tree into the same figure it was exported with. The layer
   * stack + bound metadata live in the sidecar, so a saved tree lands looking
   * like its last save. A pre-Phase-1 record has no stored panels, so the
   * adapter projects them from its Phase 0 tracks + columns (the migration read
   * path), and the figure still opens through the one panel system.
   */
  function restoreSavedFigure(meta: PhyloMeta) {
    const inputs = figureInputsFromStored(meta.figure, meta.metadata);
    setLayout(inputs.layout);
    setPhylogram(inputs.phylogram);
    // Stored panels win; else project the layer stack from the Phase 0 fields.
    const restored =
      inputs.panels ??
      projectTracksToPanels({
        tracks: inputs.tracks,
        category: inputs.categoryColumn || undefined,
        bar: inputs.barColumn || undefined,
        heat:
          inputs.heatColumns && inputs.heatColumns.length > 0
            ? inputs.heatColumns
            : undefined,
        scales: inputs.scales,
        legend: inputs.legend,
      });
    setPanels(restored);
    setSelectedLayerId(null);
    setAppliedTemplate("");
    if (inputs.metaRows) {
      setMetaRows(inputs.metaRows);
      const cols =
        inputs.metaRows.length > 0 ? Object.keys(inputs.metaRows[0]) : [];
      setMetaColumns(cols);
      setTipColumn(inputs.tipColumn ?? cols[0] ?? "");
    } else {
      setMetaRows(null);
      setMetaColumns([]);
      setTipColumn("");
    }
  }

  // ---- metadata import ----

  function loadCsvText(text: string) {
    const parsed = parseCsv(text);
    if (parsed.columns.length === 0) return;
    setMetaRows(parsed.rows);
    setMetaColumns(parsed.columns);
    // Auto-detect the join key: the column that matches the most tree tips, so
    // the user does not have to hunt for which column lines up with the tips.
    // Falls back to the first column when no tree is loaded yet.
    const tipCol = tree
      ? bestTipColumn(tree, parsed.rows, parsed.columns)
      : parsed.columns[0];
    setTipColumn(tipCol);
    // Bind the default points / strip layers to the first non-tip column, so a
    // freshly dropped table immediately colors the figure (Phase 0 parity).
    const cat = parsed.columns.find((c) => c !== tipCol) ?? "";
    if (cat) {
      setPanels((prev) =>
        prev.map((p) =>
          (p.kind === "points" || p.kind === "strip") && !p.column
            ? { ...p, column: cat }
            : p,
        ),
      );
    }
  }

  async function onUploadCsv(file: File) {
    loadCsvText(await file.text());
  }

  // ---- alignment import (phylo Phase 3) ----

  // Parse an aligned FASTA into figure import-state, and ensure an msa panel
  // exists so the matrix draws immediately (mirrors the CSV import auto-binding a
  // color layer). The alignment lives only in component state; the join to tips
  // happens in the shared adapter on every render.
  function loadAlignmentText(text: string) {
    const parsed = parseAlignment(text);
    if (parsed.records.length === 0) return;
    setAlignment(parsed);
    setPanels((prev) => {
      if (prev.some((p) => p.kind === "msa")) return prev;
      // Insert the msa panel just before any labels layer (so labels stay
      // outermost), else append it as the outer-most data panel.
      const msaPanel: AlignedPanel = {
        id: `msa-${Date.now().toString(36)}`,
        kind: "msa",
        visible: true,
        legend: true,
      };
      const labelIdx = prev.findIndex((p) => p.kind === "labels");
      if (labelIdx === -1) return [...prev, msaPanel];
      const next = prev.slice();
      next.splice(labelIdx, 0, msaPanel);
      return next;
    });
    setAppliedTemplate("");
  }

  async function onUploadAlignment(file: File) {
    loadAlignmentText(await file.text());
  }

  // ---- editing ----

  const reroot = (mode: "midpoint" | "outgroup", nodeId?: number) => {
    if (!tree) return;
    setTree(
      mode === "midpoint"
        ? midpointRoot(tree)
        : nodeId != null
          ? rerootOnNode(tree, nodeId)
          : tree,
    );
  };
  const doLadderize = () => tree && setTree(ladderize(tree, true));

  // Apply a "start from" template, rebuilding the layer stack from the available
  // metadata columns (numeric columns hint a continuous scale).
  const onApplyTemplate = (id: string) => {
    // Never feed the tip-id column to a template. It is the unique tip label, so
    // binding it to a strip / points / heat produces a per-tip legend (300+ rows
    // on a big tree) and bunched dots. Templates bind to real demo metadata only.
    const bindable = metaColumns.filter((c) => c !== tipColumn);
    // Commit the full next state in ONE batch (panels + cleared selection + the
    // applied-template marker), so there is no transient render where the panels
    // changed but the picker still showed the placeholder (the apply flicker).
    setPanels(buildTemplate(id, bindable, numericColumns));
    setSelectedLayerId(null);
    setAppliedTemplate(id);
  };

  // ---- export ----

  const onExportSvg = () => svgMarkup && downloadSvg(svgMarkup, treeName || "tree");
  const onExportPng = async () => {
    if (!svgMarkup) return;
    const blob = await svgToPngBlob(svgMarkup, FIG_W, FIG_H, 3);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${treeName || "tree"}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onCopy = async () => {
    if (!svgMarkup) return;
    try {
      const canImage =
        typeof ClipboardItem !== "undefined" &&
        !!navigator.clipboard?.write;
      if (canImage) {
        const blob = await svgToPngBlob(svgMarkup, FIG_W, FIG_H, 3);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopyState("image");
      } else {
        await navigator.clipboard.writeText(svgMarkup);
        setCopyState("text");
      }
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    }
  };

  // ---- persist ----

  const onSave = async () => {
    if (!tree) return;
    // The layer stack is the source of truth, written as panels. We ALSO derive
    // the Phase 0 tracks + column bindings from the panels so a reader that has
    // not shipped the panel path yet still renders a faithful-enough figure
    // (forward-compat); a reader that has shipped it ignores tracks and uses
    // panels. The columns bindings double as the metadata sidecar.
    const derived = derivePhase0Fields(panels);
    const figure = {
      layout,
      branchLengths: phylogram,
      tracks: derived.tracks,
      legend: true,
      panels,
    };
    const metadata =
      metaRows && tipColumn
        ? {
            tipColumn,
            rows: metaRows,
            categoryColumn: derived.categoryColumn || undefined,
            barColumn: derived.barColumn || undefined,
            heatColumns:
              derived.heatColumns.length > 0 ? derived.heatColumns : undefined,
          }
        : undefined;
    const created = await phyloApi.create(serializeNewick(tree), {
      name: treeName || "Untitled tree",
      project_ids: [],
      format: "newick",
      source: "upload",
      figure,
      metadata,
    });
    // The tree now lives in the store, so Copy reference can point at it.
    setOpenTreeId(created.meta.id);
    setSavedMsg("Saved to your trees");
    setTimeout(() => setSavedMsg(null), 2200);
    // The rail owns the live list; tell it to re-fetch so the new tree appears.
    void queryClient.invalidateQueries({ queryKey: ["phylo", "list"] });
  };

  // Copy a note / chat reference to this saved tree. The clipboard gets the embed
  // markdown (a `#ros=` figure view, so a note renders the live tree card) on the
  // first line and the bare deep link on the second, so a paste target that strips
  // markdown still keeps a working link. Only offered once the tree is in the store
  // (openTreeId set), the same rule molecules and Data Hub docs follow.
  const onCopyReference = async () => {
    if (!openTreeId) return;
    const name = treeName || "Untitled tree";
    const embed = objectEmbedMarkdown("phylo", openTreeId, name, {
      view: DEFAULT_EMBED_VIEW.phylo,
    });
    const link = objectDeepLink("phylo", openTreeId);
    try {
      await navigator.clipboard?.writeText(`${embed}\n${link}`);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      setCopiedRef(false);
    }
  };

  // ---- render ----

  const tips = tree ? leaves(tree) : [];

  // The right action-rail operations (recycled SequenceOperationsRail): Layers,
  // Setup (the tree / metadata / alignment controls that used to live on the
  // left), Export, and the ggtree Code. Built only when a tree is open.
  const railOperations: RailOperation[] = [
    {
      id: "layers",
      label: "Layers",
      title: "Layers",
      sub: "Draw order, inner to outer",
      icon: <Icon name="layer" className="h-5 w-5" />,
      panel: (
        <PhyloLayersControl
          panels={panels}
          selectedId={selectedLayerId}
          columns={metaColumns.filter((c) => c !== tipColumn)}
          treeSummary={`${phylogram ? "phylogram" : "cladogram"}, ${layout}`}
          appliedTemplate={appliedTemplate}
          onChange={editPanels}
          onSelect={setSelectedLayerId}
          onApplyTemplate={onApplyTemplate}
        />
      ),
    },
    {
      id: "setup",
      label: "Setup",
      title: "Tree setup",
      sub: "Tree, metadata, and alignment",
      icon: <Icon name="database" className="h-5 w-5" />,
      panel: (
        <div className="space-y-3.5">
          <Panel title="Tree">
            <div className="text-sm text-foreground-muted mb-2 truncate">
              {treeName} ({tips.length} tips)
            </div>
            <div className="flex flex-wrap gap-1.5">
              <GhostBtn onClick={() => setTree(null)}>Change tree</GhostBtn>
              <GhostBtn onClick={doLadderize}>Ladderize</GhostBtn>
              <GhostBtn onClick={() => reroot("midpoint")}>Midpoint root</GhostBtn>
            </div>
            <RerootPicker tips={tips} onReroot={(id) => reroot("outgroup", id)} />
          </Panel>

          <Panel title="Metadata">
            <p className="text-xs text-foreground-muted mb-2">
              Drop a table, then bind its columns to layers in the inspector.
              Unmatched tips are shown, never dropped.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <GhostBtn onClick={() => csvFileRef.current?.click()}>
                Drop CSV
              </GhostBtn>
              <GhostBtn onClick={() => loadCsvText(SAMPLE_CSV)}>
                Sample table
              </GhostBtn>
            </div>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,.tsv,text/csv"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && onUploadCsv(e.target.files[0])
              }
            />
            {metaColumns.length > 0 && (
              <div className="mt-3 space-y-2">
                <ColumnSelect
                  label="Tip id column"
                  value={tipColumn}
                  options={metaColumns}
                  onChange={setTipColumn}
                />
              </div>
            )}
            {match && (
              <div
                className={`mt-2 text-xs font-medium ${
                  match.unmatchedTips.length === 0
                    ? "text-emerald-600"
                    : "text-foreground-muted"
                }`}
              >
                Matched {match.matched.size} of{" "}
                {match.matched.size + match.unmatchedTips.length} tips on{" "}
                {tipColumn}
              </div>
            )}
            {match && match.unmatchedTips.length > 0 && (
              <div className="mt-2 text-xs text-amber-600">
                {match.unmatchedTips.length} tip
                {match.unmatchedTips.length === 1 ? "" : "s"} with no metadata:{" "}
                {match.unmatchedTips.slice(0, 3).join(", ")}
                {match.unmatchedTips.length > 3 ? "..." : ""}
              </div>
            )}
            {match && match.unmatchedRows.length > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                {match.unmatchedRows.length} metadata row
                {match.unmatchedRows.length === 1 ? "" : "s"} matched no tip.
              </div>
            )}
          </Panel>

          <Panel title="Alignment">
            <p className="text-xs text-foreground-muted mb-2">
              Drop an aligned FASTA to add a sequence-alignment track. Sequences
              join to tips by label, the same way metadata does.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <GhostBtn onClick={() => alnFileRef.current?.click()}>
                Drop FASTA
              </GhostBtn>
              <GhostBtn onClick={() => loadAlignmentText(SAMPLE_ALIGNMENT)}>
                Sample alignment
              </GhostBtn>
            </div>
            <input
              ref={alnFileRef}
              type="file"
              accept=".fasta,.fa,.fas,.aln,.afa,.mfa,.txt,text/plain"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && onUploadAlignment(e.target.files[0])
              }
            />
            {alignment && alnMatch && (
              <div
                className={`mt-2 text-xs font-medium ${
                  alnMatch.unmatchedTips.length === 0
                    ? "text-emerald-600"
                    : "text-foreground-muted"
                }`}
              >
                Matched {alnMatch.matched.size} of{" "}
                {alnMatch.matched.size + alnMatch.unmatchedTips.length} tips,{" "}
                {alnMatch.binned.sourceColumns} columns
                {alnMatch.binned.binSize > 1
                  ? ` (binned to ${alnMatch.binned.blocks})`
                  : ""}
              </div>
            )}
            {alignment && alnMatch && alnMatch.unmatchedRecords.length > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                {alnMatch.unmatchedRecords.length} sequence
                {alnMatch.unmatchedRecords.length === 1 ? "" : "s"} matched no
                tip.
              </div>
            )}
            {alignment && (
              <button
                onClick={() => {
                  setAlignment(null);
                  setPanels((prev) => prev.filter((p) => p.kind !== "msa"));
                }}
                className="mt-2 text-xs font-semibold text-accent hover:underline"
              >
                Remove alignment
              </button>
            )}
          </Panel>
        </div>
      ),
    },
    {
      id: "export",
      label: "Export",
      title: "Export",
      sub: "SVG, PNG, save, reference",
      icon: <Icon name="export" className="h-5 w-5" />,
      panel: (
        <div>
          <div className="flex flex-wrap gap-1.5">
            <Tooltip label="Vector SVG, infinitely scalable">
              <button onClick={onExportSvg} className={GHOST_CLASS}>
                SVG
              </button>
            </Tooltip>
            <Tooltip label="Hi-DPI PNG for slides and print">
              <button onClick={onExportPng} className={GHOST_CLASS}>
                PNG
              </button>
            </Tooltip>
            <Tooltip label="Copy the figure to paste straight into a doc">
              <button onClick={onCopy} className={GHOST_CLASS}>
                {copyState === "image"
                  ? "Copied"
                  : copyState === "text"
                    ? "Copied SVG"
                    : "Copy"}
              </button>
            </Tooltip>
          </div>
          <button
            onClick={onSave}
            className="mt-2 w-full px-3 py-1.5 rounded-lg font-bold text-sm border border-border text-foreground hover:border-accent flex items-center justify-center gap-1.5"
          >
            <Icon name="save" className="w-4 h-4" />
            Save to my trees
          </button>
          {openTreeId && (
            <Tooltip label="Copy a link that renders this tree as a figure in a note">
              <button
                onClick={onCopyReference}
                className="mt-2 w-full px-3 py-1.5 rounded-lg font-bold text-sm border border-border text-foreground hover:border-accent flex items-center justify-center gap-1.5"
              >
                <Icon name="reference" className="w-4 h-4" />
                {copiedRef ? "Reference copied" : "Copy reference for a note"}
              </button>
            </Tooltip>
          )}
          {savedMsg && (
            <div className="mt-1 text-xs text-brand-sky font-semibold">
              {savedMsg}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "code",
      label: "Code",
      title: "ggtree code",
      sub: "Reproduce this figure in R",
      icon: <Icon name="file" className="h-5 w-5" />,
      panel: (
        <div>
          <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-800">
            <Icon name="alert" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-bold">Heads up. </span>
              {GGTREE_CAVEAT}
            </p>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-foreground bg-surface rounded-lg p-3 overflow-x-auto">
            {ggtreeCode}
          </pre>
        </div>
      ),
    },
  ];

  return (
    <div
      ref={splitRef}
      className="relative flex h-full min-h-0 gap-0 px-4 pb-4"
    >
      {/* Re-open pill, shown only when the rail is collapsed. */}
      {listCollapsed ? (
        <Tooltip label="Show the tree list">
          <button
            type="button"
            onClick={() => setListCollapsed(false)}
            aria-label="Show the tree list"
            className="mr-2 mt-1 flex h-9 w-7 shrink-0 items-center justify-center self-start rounded-md border border-border bg-surface-raised text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
          >
            <Icon name="chevronRight" className="w-4 h-4" />
          </button>
        </Tooltip>
      ) : null}

      {/* LEFT RAIL: the saved-trees collection (recycled from Sequence/Chemistry). */}
      <aside
        className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised transition-[width] duration-200 ${
          listCollapsed ? "pointer-events-none border-0" : ""
        }`}
        style={{ width: listCollapsed ? 0 : listWidth }}
        aria-hidden={listCollapsed}
      >
        <PhyloCollectionRail
          selectedId={openTreeId}
          onPick={(id) => void onPickSaved(id)}
          onNew={() => {
            setTree(null);
            setOpenTreeId(null);
          }}
          onCollapse={() => setListCollapsed(true)}
          onOpenCleared={() => {
            setTree(null);
            setOpenTreeId(null);
          }}
        />
      </aside>

      {/* DIVIDER (hidden when the rail is collapsed). */}
      {listCollapsed ? null : (
        <Tooltip label="Drag to resize (or use arrow keys)">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the tree list"
            aria-valuenow={Math.round(listWidth)}
            aria-valuemin={LIST_MIN_WIDTH}
            aria-valuemax={LIST_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onKeyDown={onDividerKeyDown}
            className="group relative mx-1 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center focus:outline-none"
          >
            <span className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-brand-action group-focus:bg-brand-action" />
          </div>
        </Tooltip>
      )}

      {/* MAIN: the canvas + the right action rail. */}
      <section className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-raised">
        <div className="flex min-w-0 flex-1 flex-col">
          {tree ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <Seg
                  value={layout}
                  options={[
                    ["rectangular", "Rectangular"],
                    ["circular", "Circular"],
                  ]}
                  onChange={setLayout}
                />
                <span className="grow" />
                <Seg
                  value={phylogram ? "phylo" : "clado"}
                  options={[
                    ["phylo", "Phylogram"],
                    ["clado", "Cladogram"],
                  ]}
                  onChange={(v) => setPhylogram(v === "phylo")}
                />
              </div>
              {/* The renderer string is the single source of SVG; injected here. */}
              <div
                className="min-h-0 flex-1 overflow-auto p-3"
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <ImportPanel
                importMode={importMode}
                setImportMode={setImportMode}
                pasteText={pasteText}
                setPasteText={setPasteText}
                parseError={parseError}
                fileRef={fileRef}
                onUploadFile={onUploadFile}
                onLoadPaste={() => loadTreeText(pasteText, "Pasted tree")}
                onSample={() => loadTreeText(SAMPLE_TREE, "Aspergillus sample")}
              />
            </div>
          )}
        </div>

        {/* The tabbed action rail only when a tree is open (nothing to act on
            otherwise; the import panel fills the canvas). */}
        {tree ? (
          <SequenceOperationsRail
            operations={railOperations}
            activeId={activeOp}
            onPick={(id) =>
              setActiveOp((cur) => (cur === id ? null : (id as PhyloOpId)))
            }
          />
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import (no tree loaded yet).
// ---------------------------------------------------------------------------

function ImportPanel(props: {
  importMode: ImportMode;
  setImportMode: (m: ImportMode) => void;
  pasteText: string;
  setPasteText: (s: string) => void;
  parseError: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUploadFile: (f: File) => void;
  onLoadPaste: () => void;
  onSample: () => void;
}) {
  const {
    importMode,
    setImportMode,
    pasteText,
    setPasteText,
    parseError,
    fileRef,
    onUploadFile,
    onLoadPaste,
    onSample,
  } = props;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="border border-border rounded-2xl bg-surface-raised p-6">
        <div className="flex items-center gap-3 mb-1">
          <Icon name="tree" className="w-7 h-7 text-brand-sky" />
          <h2 className="text-title font-extrabold text-foreground">
            Bring a finished tree
          </h2>
        </div>
        <p className="text-sm text-foreground-muted mb-4">
          The Studio renders and annotates the tree your script produced. It
          never infers a tree, so nothing runs on a server. Upload a Newick or
          Nexus file, paste the text, or open a tree you already saved.
        </p>
        <div className="flex flex-wrap gap-2">
          <GhostBtn onClick={() => fileRef.current?.click()}>
            <Icon name="import" className="w-4 h-4" /> Upload
          </GhostBtn>
          <GhostBtn
            onClick={() =>
              setImportMode(importMode === "paste" ? null : "paste")
            }
          >
            <Icon name="paste" className="w-4 h-4" /> Paste
          </GhostBtn>
          <GhostBtn onClick={onSample}>Try a sample</GhostBtn>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".nwk,.tree,.treefile,.nex,.nexus,.txt,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUploadFile(e.target.files[0])}
        />

        {importMode === "paste" && (
          <div className="mt-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="(A:0.1,B:0.2);"
              className="w-full h-28 text-sm font-mono border border-border rounded-lg p-2 bg-surface text-foreground"
            />
            <GhostBtn onClick={onLoadPaste}>Load this tree</GhostBtn>
          </div>
        )}

        {parseError && (
          <div className="mt-3 text-sm text-red-600">{parseError}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI atoms (match the Builder / Hub style).
// ---------------------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-2xl bg-surface-raised p-3.5">
      <h3 className="text-sm font-bold text-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}

const GHOST_CLASS =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-accent hover:text-accent transition-colors";

function GhostBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={GHOST_CLASS}>
      {children}
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 border border-border rounded-lg bg-surface">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
            value === v
              ? "bg-accent-soft text-accent"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-foreground-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "(none)" : o}
          </option>
        ))}
      </select>
    </label>
  );
}

function RerootPicker({
  tips,
  onReroot,
}: {
  tips: TreeNode[];
  onReroot: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold text-accent hover:underline"
      >
        {open ? "Hide outgroup rooting" : "Reroot on an outgroup"}
      </button>
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto border border-border rounded-lg">
          {tips.map((t) => (
            <button
              key={t.id}
              onClick={() => onReroot(t.id)}
              className="w-full text-left text-xs px-2 py-1 hover:bg-accent-soft text-foreground truncate"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// blankTree + firstCladeHighlight moved into the shared figure -> RenderSpec
// adapter (lib/phylo/figure-to-render.ts) so the Studio and the embed map a
// figure to the same spec from one place.

/**
 * Derive the Phase 0 tracks + column bindings from a layer stack, so a saved
 * figure stays readable by a consumer that has not shipped the panel path. The
 * panel array remains the source of truth; this is a forward-compat shadow.
 */
function derivePhase0Fields(panels: AlignedPanel[]): {
  tracks: Record<string, boolean>;
  categoryColumn: string;
  barColumn: string;
  heatColumns: string[];
} {
  const visible = (k: string) =>
    panels.some((p) => p.visible && p.kind === k);
  const firstCol = (k: string) =>
    panels.find((p) => p.visible && p.kind === k)?.column ?? "";
  const labels = panels.find((p) => p.visible && p.kind === "labels");
  const heatPanel = panels.find((p) => p.visible && p.kind === "heat");
  return {
    tracks: {
      labels: !!labels,
      labelsItalic: !!labels?.options?.italic,
      points: visible("points"),
      strip: visible("strip"),
      bars: visible("bars"),
      heat: !!heatPanel,
      clade: visible("clade"),
      support: visible("support"),
    },
    categoryColumn: firstCol("strip") || firstCol("points"),
    barColumn: firstCol("bars"),
    heatColumns: heatPanel?.columns ?? [],
  };
}

/** Serialize a tree back to Newick for persistence (round-trips the edits). */
function serializeNewick(node: TreeNode): string {
  const write = (n: TreeNode): string => {
    let s = "";
    if (n.children.length > 0) {
      s += "(" + n.children.map(write).join(",") + ")";
      if (n.support !== null) s += String(n.support);
    } else {
      s += /[\s,():;]/.test(n.name) ? `'${n.name.replace(/'/g, "''")}'` : n.name;
    }
    if (n.branchLength !== null) s += ":" + n.branchLength;
    return s;
  };
  return write(node) + ";";
}
