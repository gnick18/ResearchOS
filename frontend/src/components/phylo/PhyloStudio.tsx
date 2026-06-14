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

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { phyloApi } from "@/lib/phylo/api";
import { SAMPLE_TREE, SAMPLE_CSV, SAMPLE_ALIGNMENT } from "@/lib/phylo/sample";
import { PhyloCollectionRail } from "@/components/phylo/PhyloCollectionRail";
import { PhyloBuilder } from "@/components/phylo/PhyloBuilder";
import LivingPopup from "@/components/ui/LivingPopup";
import {
  SequenceOperationsRail,
  type RailOperation,
} from "@/components/sequences/SequenceOperationsRail";
import {
  useSplitShell,
  SplitDivider,
  RailReopenButton,
} from "@/components/SplitShell";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import type { PhyloMeta } from "@/lib/phylo/types";
import {
  parseTree,
  leaves,
  collectAnnotationKeys,
  TreeParseError,
  type TreeNode,
} from "@/lib/phylo/parse";
import {
  ladderize,
  midpointRoot,
  rerootOnNode,
  rotateNode,
  mrca,
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
import type {
  AlignedPanel,
  PhyloFigureSpec,
  PhyloLayout,
} from "@/lib/phylo/types";
import {
  FigureArtboard,
  FigureArtboardControls,
} from "@/components/figure/FigureArtboard";
import ZoomPanCanvas from "@/components/figure/ZoomPanCanvas";
import {
  readArtboardState,
  artboardInitial,
  saveArtboardPrefs,
  pageDims,
  placeFigureCentered,
  fitFigureToPage,
  artboardExportSvg,
  pxAtDpi,
  type ArtboardState,
} from "@/lib/figure/artboard";
import {
  PhyloLayersControl,
  MultiColumnField,
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
  buildPlotSpec,
  withStyle,
  type BarMode,
} from "@/lib/datahub/plot-spec";
import { dataHubApi } from "@/lib/datahub/api";
import {
  joinContentToTips,
  datahubJoinRate,
} from "@/lib/phylo/datahub-panel";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

const FIG_W = 620;
const FIG_H = 460;

// Per-page key for the persisted left-rail width (the shared split shell, keyed
// per page exactly as Sequences/Chemistry do).
const LIST_WIDTH_KEY = "researchos:phylo:listWidth";

// The right action-rail operations, in order. Each becomes a tab + flyout via
// SequenceOperationsRail (recycled). The panels are built in the component.
type PhyloOpId = "layers" | "setup" | "export" | "code";

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

  const [layout, setLayout] = useState<PhyloLayout>("rectangular");
  const [phylogram, setPhylogram] = useState(true);
  // Show the branch-length scale bar on a phylogram (geom_treescale). Default on.
  const [scaleBar, setScaleBar] = useState(true);
  const [rootEdge, setRootEdge] = useState(false);
  // Draw a full-width time axis (age before present) instead of the scale bar.
  const [timeAxis, setTimeAxis] = useState(false);
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
  // Color tree branches by this column (ggtree aes(color=trait)); "" = off.
  const [branchColorColumn, setBranchColorColumn] = useState<string>("");
  // Data Hub plot binding (phylo Phase 4): the picker state for the "Data Hub
  // plot" Setup panel, plus the RESOLVED render inputs the canvas reads. The
  // persisted reference rides on each datahubPlot panel's options seam; the
  // resolved { plotSpec, content, analysis } is recomputed from it here (live
  // figure state, never persisted), the same way alignment resolves to msaTrack.
  const [dhTables, setDhTables] = useState<{ id: string; name: string }[]>([]);
  const [dhTableId, setDhTableId] = useState<string>("");
  const [dhContent, setDhContent] = useState<DataHubDocContent | null>(null);
  const [dhJoinCol, setDhJoinCol] = useState<string>("");
  const [datahubResolved, setDatahubResolved] = useState<
    RenderSpec["datahubPanels"]
  >({});

  // Publication page-frame (artboard) state for the figure. Disabled by default
  // (the canvas renders exactly as before). The figure's width in inches is its
  // own state since Tree Studio has no other figure-size control; the height
  // follows the fixed tree aspect (FIG_H / FIG_W).
  const [artboard, setArtboard] = useState<ArtboardState>(() =>
    artboardInitial(undefined),
  );
  const [figWIn, setFigWIn] = useState<number>(FIG_W / 96);
  const figHIn = figWIn * (FIG_H / FIG_W);
  const onArtboardChange = (patch: Partial<ArtboardState>) =>
    setArtboard((s) => {
      const next = { ...s, ...patch };
      saveArtboardPrefs(next);
      return next;
    });
  const onFitToPage = () => {
    const fit = fitFigureToPage(pageDims(artboard), FIG_W / FIG_H);
    setFigWIn(fit.figWIn);
  };
  // Tip members whose MRCA clade the Rotate button flips (ggtree rotate()).
  const [rotateMembers, setRotateMembers] = useState<string[]>([]);

  const [copyState, setCopyState] = useState<"idle" | "image" | "text">("idle");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // The open action-rail tab (Layers / Setup / Export / Code), null = collapsed.
  // Defaults to Layers so the layer stack shows on open, as it always did.
  const [activeOp, setActiveOp] = useState<PhyloOpId | null>("layers");
  // The Tree Builder recipe wizard opens as an overlay from the rail's "Build a
  // tree" button (phylo v3 unified layout: no top mode-switch bar).
  const [builderOpen, setBuilderOpen] = useState(false);

  const queryClient = useQueryClient();

  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const alnFileRef = useRef<HTMLInputElement>(null);

  // The shared split shell (resizable + collapse-to-focus + persisted width).
  const shell = useSplitShell(LIST_WIDTH_KEY);

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

  // Each bindable column classified numeric vs categorical, so the layer
  // inspector offers only type-appropriate columns per field (size-by numeric,
  // shape-by categorical, etc. — Phase 0 contextual settings).
  const columnKinds = useMemo(() => {
    const out: Record<string, "numeric" | "categorical"> = {};
    if (!tree || !match) return out;
    for (const c of metaColumns) {
      if (c === tipColumn) continue;
      out[c] = classifyColumn(tree, match.matched, c);
    }
    return out;
  }, [tree, match, metaColumns, tipColumn]);

  // What the figure can currently supply, so the Add menu greys overlays whose
  // data is missing and says why (Phase 1 constraint-aware Smart Add).
  const layerCapabilities = useMemo(
    () => ({
      hasNumericColumn: numericColumns.length > 0,
      hasAnyColumn: metaColumns.filter((c) => c !== tipColumn).length > 0,
      hasAlignment: !!alignment,
      hasAnnotations: tree ? collectAnnotationKeys(tree).length > 0 : false,
      hasDatahubTable: dhTables.length > 0,
    }),
    [numericColumns, metaColumns, tipColumn, alignment, tree, dhTables],
  );

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
    const base = figureToRenderSpec(
      tree,
      {
        layout,
        phylogram,
        scaleBar,
        rootEdge,
        timeAxis,
        tracks: EMPTY_TRACKS,
        categoryColumn,
        metaRows,
        tipColumn,
        panels,
        alignment,
        branchColorColumn,
      },
      { width: FIG_W, height: FIG_H },
    );
    // Phase 4: the resolved Data Hub plot inputs are live figure state, supplied
    // on the spec the same way figureToRenderSpec resolves alignment to msaTrack.
    return { ...base, datahubPanels: datahubResolved };
  }, [
    tree,
    layout,
    phylogram,
    scaleBar,
    rootEdge,
    timeAxis,
    categoryColumn,
    metaRows,
    tipColumn,
    panels,
    alignment,
    branchColorColumn,
    datahubResolved,
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

  // ---- Data Hub plot binding (phylo Phase 4) ----

  // Load the Data Hub table list once, for the picker.
  useEffect(() => {
    let cancelled = false;
    dataHubApi
      .list()
      .then((docs) => {
        if (!cancelled) {
          setDhTables(docs.map((d) => ({ id: d.id, name: d.name })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // When a table is picked, load its content for the picker and default the join
  // column to the one that joins the most tips (seeded by the x-role column).
  useEffect(() => {
    if (!dhTableId) {
      setDhContent(null);
      return;
    }
    let cancelled = false;
    dataHubApi
      .getContent(dhTableId)
      .then((content) => {
        if (cancelled || !content) return;
        setDhContent(content);
        if (!tree) return;
        const seed =
          content.columns.find((c) => c.role === "x")?.id ??
          content.columns[0]?.id ??
          "";
        let best = seed;
        let bestRate = seed ? datahubJoinRate(content, seed, tree) : 0;
        for (const col of content.columns) {
          const rate = datahubJoinRate(content, col.id, tree);
          if (rate > bestRate) {
            bestRate = rate;
            best = col.id;
          }
        }
        setDhJoinCol(best);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dhTableId, tree]);

  // Resolve every bound datahubPlot panel into render inputs: load its table,
  // relabel rows onto the tree's tips, and pick (or build) a grouped-bar plot.
  // Re-runs on a panel/binding change or a new tree, so a reopened figure (which
  // persisted only the reference) re-resolves.
  useEffect(() => {
    if (!tree) return;
    const bound = panels.filter(
      (p) =>
        p.kind === "datahubPlot" &&
        typeof p.options?.datahubTableId === "string",
    );
    if (bound.length === 0) {
      setDatahubResolved({});
      return;
    }
    let cancelled = false;
    (async () => {
      const resolved: NonNullable<RenderSpec["datahubPanels"]> = {};
      for (const p of bound) {
        const tableId = String(p.options!.datahubTableId);
        const joinCol = String(p.options!.joinColumn ?? "");
        const content = await dataHubApi.getContent(tableId);
        if (!content) continue;
        const joined = joinContentToTips(content, joinCol, tree);
        const base =
          content.plots.find((pl) => pl.type === "groupedBar") ??
          buildPlotSpec({ id: `dhplot-${p.id}`, kind: "groupedBar", tableId });
        // Honor a panel-level barMode (dodge / stack / stack100), so a tip panel
        // can show the 100%-stacked relative-abundance look without editing the
        // plot back in the Data Hub.
        const barMode = p.options?.barMode as BarMode | undefined;
        const plotSpec = barMode ? withStyle(base, { barMode }) : base;
        resolved[p.id] = { plotSpec, content: joined, analysis: null };
      }
      if (!cancelled) setDatahubResolved(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [panels, tree]);

  // The tip-join rate for the picker indicator ("joins N of M tips").
  const dhMatchRate = useMemo(() => {
    if (!dhContent || !dhJoinCol || !tree) return null;
    return datahubJoinRate(dhContent, dhJoinCol, tree);
  }, [dhContent, dhJoinCol, tree]);

  // Add a datahubPlot panel bound to the picked table + join column, inserted
  // just inside any labels layer so the labels stay outermost.
  function addDatahubPanel() {
    if (!dhTableId || !dhJoinCol) return;
    const tableName =
      dhTables.find((t) => t.id === dhTableId)?.name ?? "Data Hub plot";
    const panel: AlignedPanel = {
      id: `dhplot-${Date.now().toString(36)}`,
      kind: "datahubPlot",
      visible: true,
      legend: true,
      options: {
        datahubTableId: dhTableId,
        joinColumn: dhJoinCol,
        title: tableName,
      },
    };
    setPanels((prev) => {
      const labelIdx = prev.findIndex((p) => p.kind === "labels");
      if (labelIdx === -1) return [...prev, panel];
      return [...prev.slice(0, labelIdx), panel, ...prev.slice(labelIdx)];
    });
  }

  // Add a Data Hub plot straight from the Layers Add menu (the first-class entry,
  // Phase 1) — load the table, auto-pick the join column that matches the most
  // tips, and insert the panel. Mirrors addDatahubPanel but parameterized by a
  // table id (the menu picks the table; the join is automatic, editable later).
  async function addDatahubFromTable(tableId: string) {
    if (!tree) return;
    const content = await dataHubApi.getContent(tableId);
    if (!content) return;
    const seed =
      content.columns.find((c) => c.role === "x")?.id ??
      content.columns[0]?.id ??
      "";
    let best = seed;
    let bestRate = seed ? datahubJoinRate(content, seed, tree) : 0;
    for (const col of content.columns) {
      const rate = datahubJoinRate(content, col.id, tree);
      if (rate > bestRate) {
        bestRate = rate;
        best = col.id;
      }
    }
    if (!best) return;
    const tableName =
      dhTables.find((t) => t.id === tableId)?.name ?? "Data Hub plot";
    const panel: AlignedPanel = {
      id: `dhplot-${Date.now().toString(36)}`,
      kind: "datahubPlot",
      visible: true,
      legend: true,
      options: { datahubTableId: tableId, joinColumn: best, title: tableName },
    };
    setPanels((prev) => {
      const labelIdx = prev.findIndex((p) => p.kind === "labels");
      if (labelIdx === -1) return [...prev, panel];
      return [...prev.slice(0, labelIdx), panel, ...prev.slice(labelIdx)];
    });
    setSelectedLayerId(panel.id);
  }

  // Change a datahubPlot panel's bar mode (dodge / stack / stack100); the
  // resolution effect re-applies it to the panel's plot spec.
  function setPanelBarMode(id: string, barMode: BarMode) {
    setPanels((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, options: { ...p.options, barMode } } : p,
      ),
    );
  }

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
      setBranchColorColumn("");
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
    // Restore the artboard config + figure width straight off the stored figure
    // (additive optional fields; absent means disabled + natural size).
    const storedFigure = meta.figure as PhyloFigureSpec | undefined;
    setArtboard(readArtboardState(storedFigure?.artboard));
    setFigWIn(
      typeof storedFigure?.figureWidthIn === "number" &&
        storedFigure.figureWidthIn > 0
        ? storedFigure.figureWidthIn
        : FIG_W / 96,
    );
    setLayout(inputs.layout);
    setPhylogram(inputs.phylogram);
    setScaleBar(inputs.scaleBar ?? true);
    setRootEdge(inputs.rootEdge ?? false);
    setTimeAxis(inputs.timeAxis ?? false);
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
    setBranchColorColumn(inputs.branchColorColumn ?? "");
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

  // Export dpi for the artboard's true-inch raster (the page-frame readout uses
  // the same value). Tree Studio has no per-figure dpi control, so it is fixed.
  const ARTBOARD_DPI = 300;
  // When the artboard is on, the figure exports at TRUE inches (vector) and the
  // PNG rasterizes at inches * dpi. When off, the legacy px box + 3x hi-DPI
  // behavior is unchanged.
  const exportSvgMarkup = () =>
    artboard.enabled
      ? artboardExportSvg({ figureSvg: svgMarkup, figWIn, figHIn, mode: "figure" })
      : svgMarkup;
  const pngDims = (): [number, number, number] =>
    artboard.enabled
      ? [pxAtDpi(figWIn, ARTBOARD_DPI), pxAtDpi(figHIn, ARTBOARD_DPI), 1]
      : [FIG_W, FIG_H, 3];

  const onExportSvg = () =>
    svgMarkup && downloadSvg(exportSvgMarkup(), treeName || "tree");
  // Export the whole page sheet (the tree centered on the chosen paper at true
  // inches). Only meaningful when the artboard is on.
  const onExportPage = () => {
    if (!svgMarkup) return;
    const page = pageDims(artboard);
    const placement = placeFigureCentered(page, figWIn, figHIn);
    const markup = artboardExportSvg({
      figureSvg: svgMarkup,
      figWIn,
      figHIn,
      mode: "page",
      page,
      placement,
    });
    downloadSvg(markup, `${treeName || "tree"}-page`);
  };
  const onExportPng = async () => {
    if (!svgMarkup) return;
    const [w, h, scale] = pngDims();
    const blob = await svgToPngBlob(svgMarkup, w, h, scale);
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
        const [w, h, scale] = pngDims();
        const blob = await svgToPngBlob(svgMarkup, w, h, scale);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopyState("image");
      } else {
        await navigator.clipboard.writeText(exportSvgMarkup());
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
      scaleBar,
      rootEdge,
      timeAxis,
      tracks: derived.tracks,
      legend: true,
      panels,
      branchColorColumn: branchColorColumn || undefined,
      artboard: artboard.enabled ? artboard : undefined,
      figureWidthIn: figWIn,
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
          columnKinds={columnKinds}
          capabilities={layerCapabilities}
          datahubTables={dhTables}
          onAddDatahub={addDatahubFromTable}
          tipNames={tips.map((t) => t.name)}
          annotationKeys={tree ? collectAnnotationKeys(tree) : []}
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
            {metaColumns.length > 0 && (
              <div className="mt-3">
                <ColumnSelect
                  label="Branch color by"
                  value={branchColorColumn}
                  options={["", ...metaColumns.filter((c) => c !== tipColumn)]}
                  onChange={setBranchColorColumn}
                />
              </div>
            )}
            <div className="mt-3">
              <span className="block text-xs text-foreground-muted mb-1">
                Rotate a clade (flip its branches), found by its tip members
              </span>
              <MultiColumnField
                columns={tips.map((t) => t.name)}
                selected={rotateMembers}
                label="Members"
                onChange={setRotateMembers}
              />
              <button
                onClick={() => {
                  if (!tree) return;
                  const id = mrca(tree, rotateMembers);
                  if (id != null) {
                    setTree(rotateNode(tree, id));
                    setRotateMembers([]);
                  }
                }}
                disabled={rotateMembers.length < 2}
                className="mt-2 text-xs font-semibold text-accent hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Rotate this clade
              </button>
            </div>
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

          <Panel title="Data Hub plot">
            <p className="text-xs text-foreground-muted mb-2">
              Align a Data Hub grouped-bar figure to the tips. Rows join to tips
              by a column, the same way metadata does. The figure math stays in
              the Data Hub engine; the tree just places it.
            </p>
            {dhTables.length === 0 ? (
              <p className="text-xs text-foreground-muted">
                No Data Hub tables found.
              </p>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs">
                  <span className="text-foreground-muted">Table</span>
                  <select
                    value={dhTableId}
                    onChange={(e) => setDhTableId(e.target.value)}
                    className="mt-0.5 w-full text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
                  >
                    <option value="">(pick a table)</option>
                    {dhTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {dhContent && (
                  <label className="block text-xs">
                    <span className="text-foreground-muted">
                      Join tips on column
                    </span>
                    <select
                      value={dhJoinCol}
                      onChange={(e) => setDhJoinCol(e.target.value)}
                      className="mt-0.5 w-full text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
                    >
                      {dhContent.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {dhMatchRate != null && (
                  <div
                    className={`text-xs font-medium ${
                      dhMatchRate >= 0.999
                        ? "text-emerald-600"
                        : "text-foreground-muted"
                    }`}
                  >
                    Joins {Math.round(dhMatchRate * tips.length)} of{" "}
                    {tips.length} tips
                  </div>
                )}
                {dhContent && (
                  <GhostBtn onClick={addDatahubPanel}>Add plot panel</GhostBtn>
                )}
              </div>
            )}
            {panels.some((p) => p.kind === "datahubPlot") && (
              <div className="mt-3 space-y-1">
                {panels
                  .filter((p) => p.kind === "datahubPlot")
                  .map((p) => (
                    <div
                      key={p.id}
                      className="space-y-1 rounded-md border border-border px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-foreground-muted truncate">
                          {String(p.options?.title ?? "Data Hub plot")}
                        </span>
                        <button
                          onClick={() =>
                            setPanels((prev) =>
                              prev.filter((q) => q.id !== p.id),
                            )
                          }
                          className="shrink-0 text-accent hover:underline font-semibold"
                        >
                          Remove
                        </button>
                      </div>
                      <select
                        value={String(p.options?.barMode ?? "dodge")}
                        onChange={(e) =>
                          setPanelBarMode(p.id, e.target.value as BarMode)
                        }
                        className="w-full rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground"
                      >
                        <option value="dodge">Grouped bars</option>
                        <option value="stack">Stacked</option>
                        <option value="stack100">
                          100% stacked (relative)
                        </option>
                      </select>
                    </div>
                  ))}
              </div>
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
            {artboard.enabled && (
              <Tooltip label="Export the whole page sheet with the tree placed on it">
                <button onClick={onExportPage} className={GHOST_CLASS}>
                  Page
                </button>
              </Tooltip>
            )}
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
          <div className="mt-3 border-t border-border pt-3">
            <FigureArtboardControls
              state={artboard}
              onChange={onArtboardChange}
              figWIn={figWIn}
              figHIn={figHIn}
              dpi={ARTBOARD_DPI}
              onFitToPage={onFitToPage}
              onFigWidthIn={setFigWIn}
            />
          </div>
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
      ref={shell.containerRef}
      className="relative flex h-full min-h-0 gap-0 px-4 pb-4"
    >
      {/* Re-open pill, shown only when the rail is collapsed. */}
      {shell.collapsed ? (
        <RailReopenButton
          onClick={() => shell.setCollapsed(false)}
          label="Show the tree list"
        />
      ) : null}

      {/* LEFT RAIL: the saved-trees collection (recycled from Sequence/Chemistry). */}
      <aside
        className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised transition-[width] duration-200 ${
          shell.collapsed ? "pointer-events-none border-0" : ""
        }`}
        style={{ width: shell.collapsed ? 0 : shell.width }}
        aria-hidden={shell.collapsed}
      >
        <PhyloCollectionRail
          selectedId={openTreeId}
          onPick={(id) => void onPickSaved(id)}
          onNew={() => {
            setTree(null);
            setOpenTreeId(null);
          }}
          onBuild={() => setBuilderOpen(true)}
          onCollapse={() => shell.setCollapsed(true)}
          onOpenCleared={() => {
            setTree(null);
            setOpenTreeId(null);
          }}
        />
      </aside>

      {/* DIVIDER (hidden when the rail is collapsed). */}
      <SplitDivider shell={shell} label="Resize the tree list" />

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
                    ["slanted", "Slanted"],
                    ["circular", "Circular"],
                    ["fan", "Fan"],
                    ["inwardCircular", "Inward circular"],
                    ["unrooted", "Unrooted"],
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
                {phylogram && (
                  <button
                    type="button"
                    onClick={() => setScaleBar((s) => !s)}
                    title="Branch-length scale bar"
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                      scaleBar
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    Scale bar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRootEdge((s) => !s)}
                  title="Draw a short root edge stub (geom_rootedge)"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                    rootEdge
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-foreground-muted hover:text-foreground"
                  }`}
                >
                  Root edge
                </button>
                {phylogram && (
                  <button
                    type="button"
                    onClick={() => setTimeAxis((s) => !s)}
                    title="Full-width time axis, tips at age 0 (theme_tree2)"
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                      timeAxis
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    Time axis
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onArtboardChange({ enabled: !artboard.enabled })
                  }
                  title="Show the figure on a publication page (artboard). Page size + fit live under Export."
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                    artboard.enabled
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-foreground-muted hover:text-foreground"
                  }`}
                >
                  Page frame
                </button>
              </div>
              {/* The renderer string is the single source of SVG. The artboard
                  frames it on a real page when enabled; otherwise it injects
                  directly, exactly as before. */}
              {artboard.enabled ? (
                <div className="min-h-0 flex-1">
                  <ZoomPanCanvas
                    contentWidth={pageDims(artboard).wIn * 96}
                    contentHeight={pageDims(artboard).hIn * 96}
                    minimap={
                      <FigureArtboard
                        figureSvg={svgMarkup}
                        figWIn={figWIn}
                        figHIn={figHIn}
                        state={artboard}
                      />
                    }
                  >
                    <FigureArtboard
                      figureSvg={svgMarkup}
                      figWIn={figWIn}
                      figHIn={figHIn}
                      state={artboard}
                    />
                  </ZoomPanCanvas>
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <ZoomPanCanvas
                    contentWidth={FIG_W}
                    contentHeight={FIG_H}
                    minimap={
                      <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
                    }
                  >
                    <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
                  </ZoomPanCanvas>
                </div>
              )}
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
      {/* Tree Builder overlay, opened from the rail's "Build a tree" button. */}
      <LivingPopup
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        label="Build a tree"
        widthClassName="max-w-4xl"
        padded
      >
        <div className="max-h-[80vh] overflow-auto">
          <h2 className="text-title font-bold text-foreground mb-1">
            Build a tree
          </h2>
          <p className="text-meta text-foreground-muted mb-4">
            Generate the exact tree-building scripts. Nothing runs on our
            servers.
          </p>
          <PhyloBuilder />
        </div>
      </LivingPopup>
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
