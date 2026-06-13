"use client";

// /datahub — Data Hub, a free open-source GraphPad Prism style analysis surface.
// Slice 1 builds the visible tab skeleton (the three-pane navigator from the
// approved mockup, docs/mockups/data-hub-tab-mockup.html) plus the Column-table
// data-entry loop: an editable replicate grid whose mean / SD / SEM / n footer
// recomputes live through the already-built engine, with every cell edit
// persisted through the cell-level Loro store.
//
// Results, Graphs, the guided wizard, plotting, and import are LATER slices and
// render here only as empty-state placeholders. The whole route is gated behind
// DATAHUB_ENABLED. New top-level route, excluded from the wiki-coverage gate
// pending its own wiki page (mirrors the /sequences precedent).
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DATAHUB_ENABLED, isBigTableEnabled } from "@/lib/datahub/config";
import {
  isLargeTable,
  listDatasets,
  nextDatasetId,
  readDatasetSidecar,
  type DatasetSidecar,
} from "@/lib/datahub/bigtable";
import { ingestToDatasetLane } from "@/lib/datahub/bigtable/ingest";
import DatasetView from "@/components/datahub/bigtable/DatasetView";
import TransformBuilder from "@/components/datahub/bigtable/TransformBuilder";
import ManualSwitchControl from "@/components/datahub/bigtable/ManualSwitchControl";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import { dataHubApi } from "@/lib/datahub/api";
import { recipesApi } from "@/lib/datahub/recipes-store";
import { recomputeDerived } from "@/lib/datahub/derived";
import { chainCode } from "@/lib/datahub/chain-code";
import CodePanel from "@/components/datahub/CodePanel";
import { projectsApi } from "@/lib/local-api";
import type {
  AnalysisSpec,
  CellValue,
  DataHubDocContent,
  DataHubDocument,
  EntryFormat,
  InfoContent,
  PlotSpec,
  TransformKind,
} from "@/lib/datahub/model/types";
import {
  openDataHubDoc,
  type DataHubDocHandle,
} from "@/lib/loro/datahub-store";
import {
  addRow as addRowToDoc,
  addRowAt as addRowAtInDoc,
  addColumn as addColumnToDoc,
  addColumnAt as addColumnAtInDoc,
  updateColumn as updateColumnInDoc,
  deleteRow as deleteRowInDoc,
  removeColumnWithCells as removeColumnInDoc,
  getDataHubContent,
  setAnalysis as setAnalysisInDoc,
  removeAnalysis as removeAnalysisInDoc,
  setPlot as setPlotInDoc,
  removePlot as removePlotInDoc,
  setTitle as setTitleInDoc,
  setCell,
  replaceTable as replaceTableInDoc,
  setEntryFormat as setEntryFormatInDoc,
  setExcludedCells as setExcludedCellsInDoc,
  setInfoContent as setInfoContentInDoc,
} from "@/lib/loro/datahub-doc";
import {
  isCellExcluded,
  toggleCellExclusion,
} from "@/lib/datahub/cell-exclusion";
import {
  buildBlankRow,
  buildBlankColumn,
  buildDuplicateColumn,
  canDeleteColumn,
  canDeleteRow,
  columnIndex,
  rowIndex,
} from "@/lib/datahub/grid-crud";
import {
  buildEmptyColumnTable,
  parseCellInput,
} from "@/lib/datahub/column-table";
import {
  isSummaryFormat,
  entryFormatOf,
  spreadKindOf,
  summaryGroupIds,
  summaryColumnId,
  replicatesToSummaryPlan,
  summaryToReplicatesPlan,
  convertSpreadKindPlan,
} from "@/lib/datahub/summary-table";
import { buildEmptyXYTable, yColumns } from "@/lib/datahub/xy-table";
import {
  buildEmptyGroupedTable,
  groupDatasets,
  DEFAULT_GROUPED_REPLICATES,
} from "@/lib/datahub/grouped-table";
import {
  buildAddedReplicate,
  buildDuplicateGroupPlan,
  buildInsertGroupColumns,
  canDeleteGroup,
  canRemoveReplicate,
  groupColumnIds,
  replicateToRemove,
} from "@/lib/datahub/grouped-grid-crud";
import { buildEmptySurvivalTable } from "@/lib/datahub/survival-table";
import { buildEmptyContingencyTable } from "@/lib/datahub/contingency-table";
import {
  buildEmptyNestedTable,
  nestedGroupColumns,
  DEFAULT_NESTED_SUBGROUPS,
} from "@/lib/datahub/nested-table";
import { buildEmptyPartsOfWholeTable } from "@/lib/datahub/parts-of-whole-table";
import { buildEmptyInfoSheet } from "@/lib/datahub/info-sheet";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { coerceParam } from "@/lib/datahub/analysis-params";
import {
  buildPlotSpec,
  withStyle,
  renderPlot,
  readPlotStyle,
  exportSvgMarkup,
  exportPngPixels,
  downloadSvg,
  downloadPngAt,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import DataHubRail, { type Collection } from "@/components/datahub/DataHubRail";
import DataTableGrid from "@/components/datahub/DataTableGrid";
import TableFormatControl from "@/components/datahub/TableFormatControl";
import XYTableGrid from "@/components/datahub/XYTableGrid";
import GroupedTableGrid from "@/components/datahub/GroupedTableGrid";
import SurvivalTableGrid from "@/components/datahub/SurvivalTableGrid";
import ContingencyTableGrid from "@/components/datahub/ContingencyTableGrid";
import NestedTableGrid from "@/components/datahub/NestedTableGrid";
import PartsOfWholeTableGrid from "@/components/datahub/PartsOfWholeTableGrid";
import InfoSheetEditor from "@/components/datahub/InfoSheetEditor";
import NewTableDialog, {
  type NewTableSubmit,
} from "@/components/datahub/NewTableDialog";
import ImportTableDialog, {
  type ImportTableSubmit,
} from "@/components/datahub/ImportTableDialog";
import NewAnalysisDialog, {
  type NewAnalysisSubmit,
} from "@/components/datahub/NewAnalysisDialog";
import GuidedAnalysisWizard, {
  type GuidedAnalysisSubmit,
} from "@/components/datahub/GuidedAnalysisWizard";
import NewGraphDialog, {
  type NewGraphSubmit,
} from "@/components/datahub/NewGraphDialog";
import PowerPlannerDialog from "@/components/datahub/PowerPlannerDialog";
import TransformDialog, {
  type TransformSubmit,
} from "@/components/datahub/TransformDialog";
import { executePipeline } from "@/lib/datahub/transform/engine";
import {
  legacyOpToTransformOp,
  primarySourceId,
  singleOpForDialog,
} from "@/lib/datahub/transform/recipe";
import ResultsSheet from "@/components/datahub/ResultsSheet";
import GraphEditor from "@/components/datahub/GraphEditor";
import WorkspaceToolbar, {
  type ToolbarGroup,
} from "@/components/datahub/WorkspaceToolbar";
import { tableContentToCsv, downloadCsv } from "@/lib/datahub/table-csv";
import { objectReferenceMarkdown } from "@/lib/references";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { setBeakerContext } from "@/components/ai/context-bridge";

/**
 * A short, human label for a figure, used for the export filename stem (and the
 * duplicate's base name). Prefers the user-given display name, then the figure's
 * own title, then a label for its kind. Mirrors the rail's plotLabel.
 */
function plotExportLabel(spec: PlotSpec): string {
  if (typeof spec.name === "string" && spec.name.trim() !== "") {
    return spec.name.trim();
  }
  const style = readPlotStyle(spec);
  const title = style.title.trim();
  if (title !== "") return title;
  switch (style.kind) {
    case "columnBar":
      return "Bar graph";
    case "xyScatter":
      return "XY graph";
    case "groupedBar":
      return "Grouped bar";
    case "survivalCurve":
      return "Survival curve";
    case "columnScatter":
    default:
      return "Column scatter";
  }
}

/** A short, human label for a transform kind, used in the derived-table banner
 *  ("Derived from <source> via <label>"). Mirrors the dialog's kind labels. */
function transformLabel(kind: TransformKind): string {
  switch (kind) {
    case "transform":
      return "Transform";
    case "normalize":
      return "Normalize";
    case "transpose":
      return "Transpose";
    case "removeBaseline":
      return "Remove baseline";
    case "fractionOfTotal":
      return "Fraction of total";
    default:
      return "Transform";
  }
}

export default function DataHubPage() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  // Demo sessions get to preview Data Hub even when the production flag is off,
  // so the public demo can showcase it while real production users never see it.
  // The demo signal is client-only, so we default to the prod-safe value (not
  // demo) and read it after mount. `mounted` lets us hold a neutral frame until
  // then, so a demo session never flashes the not-enabled notice before the real
  // surface appears. `surfaceEnabled` drives both the gate and the data queries,
  // so the catalog only loads once the surface is allowed to render.
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setIsDemo(getDemoMode());
    setMounted(true);
  }, []);
  const surfaceEnabled = DATAHUB_ENABLED || isDemo;

  const [collection, setCollection] = useState<Collection>("all");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  // The selected LARGE-DATASET (dataset lane), separate from the editable-lane
  // selectedTableId. When set, the main panel renders the DatasetView (preview,
  // status chip, column tiers) instead of the cell grid. Gated by the bigtable
  // sub-capability flag; null whenever the lane is off.
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    null,
  );
  const [openDatasetSidecar, setOpenDatasetSidecar] =
    useState<DatasetSidecar | null>(null);
  // Transform builder (Phase 2a) open state, for the selected dataset. The
  // builder takes the main panel over the DatasetView when open.
  const [datasetBuilderOpen, setDatasetBuilderOpen] = useState(false);
  // True while the manual "Switch to large-dataset mode" conversion runs (the
  // engine is loading + the table is being re-materialized to a dataset).
  const [manualSwitchBusy, setManualSwitchBusy] = useState(false);
  const [newTableOpen, setNewTableOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // The selected analysis in the Results section (null means the data grid is
  // shown). New-analysis dialog open state.
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    null,
  );
  const [newAnalysisOpen, setNewAnalysisOpen] = useState(false);
  // The guided-analysis wizard open state. The wizard collects a structured
  // intent, plans the test (assumption-aware), and runs through the SAME path as
  // a New analysis once the user approves the plan.
  const [guidedOpen, setGuidedOpen] = useState(false);
  // The selected figure in the Graphs section (null means no figure is open).
  // New-graph dialog open state. A figure selection takes precedence over an
  // analysis selection in the main panel.
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  // The power / sample-size planner open state. The planner is a stateless
  // calculator, so it carries no table or content; it is reachable with or
  // without a table open (a researcher plans a study before any data exists).
  const [powerPlannerOpen, setPowerPlannerOpen] = useState(false);
  // The Transform dialog open state. It creates a DERIVED table from the open
  // table, or (when the open table is itself derived) edits its transform in
  // place. A single flag drives both since the dialog reads its mode from
  // whether the open table already carries a derivedFrom link.
  const [transformOpen, setTransformOpen] = useState(false);
  // The SOURCE content the Transform dialog previews + picks columns against.
  // For a normal table this is the open content itself; for a derived table the
  // open content is the computed snapshot, so we resolve its real source by id
  // when the dialog opens. Null until resolved (the dialog shows no preview then).
  const [transformSourceContent, setTransformSourceContent] =
    useState<DataHubDocContent | null>(null);
  // Transient "copied" flash for the Copy reference button.
  const [refCopied, setRefCopied] = useState(false);
  // The derived-table Code panel: a toggle and the lineage-aware chain script
  // (async, resolved from the table's base sources). Only a derived table shows
  // the toggle; an entered table has no recipe to reproduce.
  const [showTableCode, setShowTableCode] = useState(false);
  const [tableChainCode, setTableChainCode] = useState<string>("");
  // Inline delete confirm for the table toolbar (no soft-lock: a Cancel is always
  // reachable). Holds the id pending deletion, or null when nothing is pending.
  const [confirmDeleteTableId, setConfirmDeleteTableId] = useState<string | null>(
    null,
  );

  // The live projection of the open document's Loro doc. Cell edits write to the
  // doc, then reproject into this state so the grid + footer re-derive. Null
  // until a table is opened.
  const [openContent, setOpenContent] = useState<DataHubDocContent | null>(null);
  // True when the open table is DERIVED but its source table could not be
  // resolved (deleted / renamed away). The grid renders an explicit empty state
  // rather than stale data; for a normal entered table this is always false.
  const [derivedSourceMissing, setDerivedSourceMissing] = useState(false);
  const handleRef = useRef<DataHubDocHandle | null>(null);
  const openIdRef = useRef<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-datahub"],
    queryFn: () => projectsApi.list(),
    enabled: surfaceEnabled,
  });

  const { data: allTables = [] } = useQuery({
    queryKey: ["datahub", "tables"],
    queryFn: () => dataHubApi.list(),
    enabled: surfaceEnabled,
  });

  // Large-dataset-lane catalog (owner-scoped). Only loaded when the bigtable
  // sub-capability is on; otherwise an empty list, so the lane is fully inert.
  const bigTableOn = isBigTableEnabled();
  const { data: datasets = [] } = useQuery({
    queryKey: ["datahub", "datasets", currentUser],
    queryFn: () => (currentUser ? listDatasets(currentUser) : Promise.resolve([])),
    enabled: surfaceEnabled && bigTableOn && !!currentUser,
  });

  // Load the selected dataset's sidecar when the dataset selection changes. A
  // dataset selection takes the main panel; selecting an editable table clears
  // it (handled at the rail / open seams).
  useEffect(() => {
    // A dataset switch closes the builder (it is bound to one dataset).
    setDatasetBuilderOpen(false);
    if (!bigTableOn || !currentUser || selectedDatasetId == null) {
      setOpenDatasetSidecar(null);
      return;
    }
    let cancelled = false;
    void readDatasetSidecar(currentUser, selectedDatasetId).then((sc) => {
      if (!cancelled) setOpenDatasetSidecar(sc);
    });
    return () => {
      cancelled = true;
    };
  }, [bigTableOn, currentUser, selectedDatasetId]);

  // Filter the catalog by the active collection.
  const tablesInCollection = useMemo<DataHubDocument[]>(() => {
    if (collection === "all") return allTables;
    if (collection === "unfiled") {
      return allTables.filter((t) => t.project_ids.length === 0);
    }
    return allTables.filter((t) => t.project_ids.includes(collection));
  }, [allTables, collection]);

  // Counts for the collection selector labels.
  const counts = useMemo(() => {
    const perProject = new Map<string, number>();
    let unfiled = 0;
    for (const t of allTables) {
      if (t.project_ids.length === 0) unfiled += 1;
      for (const pid of t.project_ids) {
        perProject.set(pid, (perProject.get(pid) ?? 0) + 1);
      }
    }
    return { all: allTables.length, unfiled, perProject };
  }, [allTables]);

  // Resolve which table is selected, in one place so the two rules never fight.
  // On first load a `?doc=<id>` deep link wins (the form a Data Hub object
  // reference builds, via objectReferenceMarkdown("datahub", ...)): the filter
  // jumps to All so the doc is visible whatever project it belongs to, and the
  // doc is selected. The deep link is consumed once, so a later manual selection
  // is never yanked back. Otherwise the selection defaults to the first visible
  // table and self-heals when the current one leaves the filter.
  //
  // These were two effects; merging them fixes a race where the default-to-first
  // rule clobbered a just-applied deep-link selection in the same render pass
  // (both read the pre-update selectedTableId). The deep-link branch returns
  // before the default logic, so it can no longer be overridden.
  const deepLinkConsumed = useRef(false);
  // A pending `?analysis=<id>` deep link, captured alongside `?doc=` so that once
  // the deep-linked doc's content loads we can select that analysis and land the
  // user on its result sheet (not the raw data grid). BeakerBot's run navigation
  // uses this so the user sees the test RESULT. Null when no analysis was requested.
  // Consumed once the analysis is selected (or when its doc loads without it).
  const pendingAnalysisId = useRef<string | null>(null);
  // A pending `?plot=<id>` deep link, the figure analog of pendingAnalysisId,
  // captured alongside `?doc=` so once the deep-linked doc's content loads we can
  // select that plot and land the user ON the figure (the Graphs view) rather
  // than the raw data grid. BeakerBot's make_datahub_graph navigation uses this
  // so the user sees the chart it built. Null when no plot was requested.
  const pendingPlotId = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkConsumed.current && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const doc = params.get("doc");
      if (!doc) {
        deepLinkConsumed.current = true;
      } else if (allTables.length > 0) {
        deepLinkConsumed.current = true;
        if (allTables.some((t) => t.id === doc)) {
          // Stash any requested analysis or plot before selecting the table, so
          // the table-switch effect that clears the selection runs first and the
          // deep-link effects below re-apply them once content loads.
          pendingAnalysisId.current = params.get("analysis");
          pendingPlotId.current = params.get("plot");
          if (collection !== "all") setCollection("all");
          setSelectedTableId(doc);
          return; // the deep-link selection wins this pass
        }
      } else {
        return; // a doc is requested; wait for the catalog before deciding
      }
    }
    // Default / self-heal the selection to the first visible table.
    if (tablesInCollection.length === 0) {
      setSelectedTableId(null);
      return;
    }
    if (
      selectedTableId == null ||
      !tablesInCollection.some((t) => t.id === selectedTableId)
    ) {
      setSelectedTableId(tablesInCollection[0].id);
    }
  }, [allTables, tablesInCollection, selectedTableId, collection]);

  // Open (or switch) the Loro doc for the selected table and project its content.
  // Subscribing reprojects on any doc change (a local edit's commit, or a later
  // collaborator's op), so the grid + footer always reflect the doc. The prior
  // handle is closed (which flushes its pending commit) before opening the next.
  useEffect(() => {
    if (!surfaceEnabled || !currentUser || selectedTableId == null) {
      setOpenContent(null);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const id = selectedTableId;
    const owner = currentUser;

    void (async () => {
      // Close any previously-open handle first (flushes its debounced commit).
      const prior = handleRef.current;
      if (prior && openIdRef.current !== id) {
        await prior.close().catch(() => {});
        handleRef.current = null;
      }
      const handle = await openDataHubDoc(owner, id);
      if (cancelled) return;
      handleRef.current = handle;
      openIdRef.current = id;
      const project = () => {
        if (cancelled) return;
        const projected = getDataHubContent(handle.doc, id);
        if (!projected.meta.derivedFrom) {
          // Normal entered table: render the projection as-is (today's behavior).
          setDerivedSourceMissing(false);
          setOpenContent(projected);
          return;
        }
        // Derived table: recompute its columns/rows from the source table's
        // CURRENT content (the live link) before rendering. The recompute runs in
        // memory on open and never trusts the persisted snapshot. dataHubApi
        // resolves the source by id across any owner.
        void recomputeDerived(projected, (sourceId) =>
          dataHubApi.getContent(sourceId),
        ).then((result) => {
          if (cancelled) return;
          setDerivedSourceMissing(result.sourceMissing);
          setOpenContent(result.content);
        });
      };
      project();
      unsub = handle.subscribe(project);
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [surfaceEnabled, currentUser, selectedTableId]);

  // A table switch clears the analysis + figure selection (back to the data
  // grid) and dismisses any pending delete-confirm banner so it never bleeds
  // onto the newly opened table. The dependency is intentionally only the
  // table id.
  useEffect(() => {
    setSelectedAnalysisId(null);
    setSelectedPlotId(null);
    setConfirmDeleteTableId(null);
  }, [selectedTableId]);

  // Apply a pending `?analysis=<id>` deep link once the deep-linked doc's content
  // has loaded. This runs after the table-switch clear above, so the analysis the
  // run navigated to is what wins, and the user lands on its result sheet rather
  // than the raw data grid. Backward compatible, with no analysis param the ref is
  // null and this is a no-op (the table stays on the grid as before). If the id is
  // not among the loaded analyses we still consume the ref and fall back to the
  // grid, so a stale or wrong id never leaves the deep link stuck.
  useEffect(() => {
    if (pendingAnalysisId.current == null || !openContent) return;
    const wanted = pendingAnalysisId.current;
    pendingAnalysisId.current = null;
    if (openContent.analyses.some((a) => a.id === wanted)) {
      setSelectedPlotId(null);
      setSelectedAnalysisId(wanted);
    }
  }, [openContent]);

  // Apply a pending `?plot=<id>` deep link once the deep-linked doc's content has
  // loaded, the figure analog of the analysis deep-link effect above. This runs
  // after the table-switch clear, so the plot the build navigated to is what
  // wins, and the user lands on its figure rather than the raw data grid.
  // Backward compatible, with no plot param the ref is null and this is a no-op.
  // If the id is not among the loaded plots we still consume the ref and fall
  // back to the grid, so a stale or wrong id never leaves the deep link stuck.
  useEffect(() => {
    if (pendingPlotId.current == null || !openContent) return;
    const wanted = pendingPlotId.current;
    pendingPlotId.current = null;
    if (openContent.plots.some((p) => p.id === wanted)) {
      setSelectedAnalysisId(null);
      setSelectedPlotId(wanted);
    }
  }, [openContent]);

  // Flush + drop the open handle on unmount so a pending commit is never lost.
  useEffect(() => {
    return () => {
      const handle = handleRef.current;
      if (handle) {
        void handle.close().catch(() => {});
        handleRef.current = null;
        openIdRef.current = null;
      }
    };
  }, []);

  // Resolve any table's RAW stored content by id (its derivedFrom link plus the
  // last-computed snapshot), so the lineage-aware Code export can walk a derived
  // table's chain back to its base table(s). Raw content (not the recomputed
  // projection) is what the walker needs, so it still sees the derivedFrom link.
  const resolveTableContent = useCallback(
    (tableId: string) => dataHubApi.getContent(tableId),
    [],
  );

  // Hide the derived-table Code panel whenever the open table changes, so it
  // does not carry over to the next table.
  useEffect(() => {
    setShowTableCode(false);
    setTableChainCode("");
  }, [selectedTableId]);

  // Compute the derived-table chain script when the Code panel is open. It walks
  // the open table's lineage back to its base table(s) and emits one commented
  // script (base data to transforms). Async, so it lands in state.
  useEffect(() => {
    if (!showTableCode || !openContent?.meta.derivedFrom) {
      return;
    }
    let active = true;
    void chainCode(
      { kind: "table", tableId: openContent.meta.id, content: openContent },
      resolveTableContent,
    ).then((code) => {
      if (active) setTableChainCode(code);
    });
    return () => {
      active = false;
    };
  }, [showTableCode, openContent, resolveTableContent]);

  // Persist one cell edit: write the parsed value to the doc, commit (debounced),
  // and reproject immediately so the footer recomputes without waiting for the
  // commit round-trip.
  const handleCellCommit = useCallback(
    (rowId: string, columnId: string, raw: string) => {
      const handle = handleRef.current;
      if (!handle || openIdRef.current == null) return;
      // A DERIVED table's cells are computed from its source, so they are read
      // only. Ignore an entered edit rather than writing it into the doc (where
      // the next recompute would discard it anyway, and persisting it would
      // corrupt the snapshot). The next phase styles the grid as non-editable;
      // this guard makes the model correct regardless of the grid styling.
      if (openContent?.meta.derivedFrom) return;
      const value: CellValue = parseCellInput(raw);
      setCell(handle.doc, rowId, columnId, value);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent?.meta.derivedFrom],
  );

  // Toggle whether one cell is EXCLUDED from analyses and plots (the Prism
  // outlier affordance). The value is not deleted, only filtered, so this writes
  // the recomputed excluded-key set to meta and commits, mirroring a cell edit.
  // A derived table's data is computed from its source, so exclusion does not
  // apply there (the same read-only guard the cell edit uses).
  const handleToggleExclusion = useCallback(
    (rowId: string, columnId: string) => {
      const handle = handleRef.current;
      if (!handle || openIdRef.current == null) return;
      if (openContent?.meta.derivedFrom) return;
      const current = getDataHubContent(handle.doc, openIdRef.current);
      const next = toggleCellExclusion(current, rowId, columnId);
      setExcludedCellsInDoc(handle.doc, next);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent?.meta.derivedFrom],
  );

  // Persist an Info sheet's documentation (body + constants). An Info sheet has
  // no grid, so this writes the whole info payload to meta and commits, mirroring
  // a cell edit (the editor builds the next payload, this stores it). Reprojects
  // so the editor sees the committed content flow straight back in.
  const handleInfoChange = useCallback((next: InfoContent) => {
    const handle = handleRef.current;
    if (!handle || openIdRef.current == null) return;
    setInfoContentInDoc(handle.doc, next);
    void handle.commit();
    setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
  }, []);

  // Append a blank replicate row across the existing columns.
  const handleAddRow = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !openContent || openIdRef.current == null) return;
    const cells: Record<string, CellValue> = {};
    // A Contingency table seeds the row-label cell and zeroes the count cells so
    // a fresh row reads as a real category with no counts yet, the same shape the
    // empty-table builder produces. Every other table type backfills null.
    const isContingency = openContent.meta.table_type === "contingency";
    const rowCount = openContent.rows.length;
    for (const col of openContent.columns) {
      if (isContingency && col.role === "x") {
        cells[col.id] = `Group ${rowCount + 1}`;
      } else if (isContingency && col.role === "y") {
        cells[col.id] = 0;
      } else {
        cells[col.id] = null;
      }
    }
    const rowId = `row-${Date.now()}`;
    addRowToDoc(handle.doc, { id: rowId, cells });
    void handle.commit();
    setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
  }, [openContent]);

  // Append a new column, then backfill a null cell for it on every existing row
  // so the grid reads cleanly. A Column table gets a "Group N" treatment column;
  // an XY table gets a "Y N" response column (both role "y"), named for the
  // archetype so the header reads naturally.
  const handleAddColumn = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !openContent || openIdRef.current == null) return;
    const tableType = openContent.meta.table_type;
    const stamp = Date.now();

    if (tableType === "grouped") {
      // Add a whole new column group: one datasetId with the same replicate
      // count as the existing groups (or the default), each backfilled null.
      const groups = groupDatasets(openContent);
      const reps =
        groups[0]?.replicateColumnIds.length ?? DEFAULT_GROUPED_REPLICATES;
      const datasetId = `grp-${stamp}`;
      const name = `Group ${groups.length + 1}`;
      const newColIds: string[] = [];
      for (let r = 0; r < reps; r++) {
        const colId = `${datasetId}-r${r + 1}`;
        newColIds.push(colId);
        addColumnToDoc(handle.doc, {
          id: colId,
          name,
          role: "y",
          dataType: "number",
          datasetId,
          subcolumnKind: "replicate",
        });
      }
      for (const row of openContent.rows) {
        for (const colId of newColIds) setCell(handle.doc, row.id, colId, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      return;
    }

    // A summary-format Column table adds a whole group, which is three
    // subcolumns (mean, the format's spread, n) sharing one datasetId, plus a
    // null cell each in the single summary row. The new group seeds blank so the
    // user fills the three numbers in.
    if (tableType === "column" && isSummaryFormat(openContent.meta.entryFormat)) {
      const spreadKind = spreadKindOf(entryFormatOf(openContent));
      const datasetId = `grp-${stamp}`;
      const name = `Group ${summaryGroupIds(openContent).length + 1}`;
      const kinds: Array<"mean" | "sd" | "sem" | "n"> = [
        "mean",
        spreadKind,
        "n",
      ];
      const newColIds: string[] = [];
      for (const kind of kinds) {
        const id = summaryColumnId(datasetId, kind);
        newColIds.push(id);
        addColumnToDoc(handle.doc, {
          id,
          name,
          role: "subcolumn",
          dataType: "number",
          datasetId,
          subcolumnKind: kind,
        });
      }
      // The summary table holds a single row; backfill the new group's cells on
      // every existing row (there is one) so the projection reads cleanly.
      for (const row of openContent.rows) {
        for (const id of newColIds) setCell(handle.doc, row.id, id, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      return;
    }

    // A Contingency table adds another count column (an "Outcome N" category of
    // the column factor), backfilling 0 on every existing row so the count matrix
    // stays rectangular.
    if (tableType === "contingency") {
      const colId = `col-${stamp}`;
      const yCount = openContent.columns.filter((c) => c.role === "y").length;
      addColumnToDoc(handle.doc, {
        id: colId,
        name: `Outcome ${yCount + 1}`,
        role: "y",
        dataType: "number",
      });
      for (const row of openContent.rows) {
        setCell(handle.doc, row.id, colId, 0);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      return;
    }

    // A Nested table adds a whole new top-level group: one datasetId with the
    // same subgroup count as the existing groups (or the default), each subgroup a
    // role-"y" column carrying the new group's groupName, backfilled null.
    if (tableType === "nested") {
      const groups = nestedGroupColumns(openContent);
      const subCount =
        groups[0]?.subgroupColumnIds.length ?? DEFAULT_NESTED_SUBGROUPS;
      const datasetId = `grp-${stamp}`;
      const groupName = `Group ${groups.length + 1}`;
      const newColIds: string[] = [];
      for (let s = 0; s < subCount; s++) {
        const colId = `${datasetId}-s${s + 1}`;
        newColIds.push(colId);
        addColumnToDoc(handle.doc, {
          id: colId,
          name: `S${s + 1}`,
          role: "y",
          dataType: "number",
          datasetId,
          subcolumnKind: "replicate",
          groupName,
        });
      }
      for (const row of openContent.rows) {
        for (const colId of newColIds) setCell(handle.doc, row.id, colId, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      return;
    }

    const isXY = tableType === "xy";
    const colId = `col-${stamp}`;
    if (isXY) {
      const yCount = yColumns(openContent).length;
      addColumnToDoc(handle.doc, {
        id: colId,
        name: `Y${yCount + 1}`,
        role: "y",
        dataType: "number",
      });
    } else {
      const groupCount = openContent.columns.filter(
        (c) => c.role === "y" || c.role === "group",
      ).length;
      addColumnToDoc(handle.doc, {
        id: colId,
        name: `Group ${groupCount + 1}`,
        role: "y",
        dataType: "number",
      });
    }
    for (const row of openContent.rows) {
      setCell(handle.doc, row.id, colId, null);
    }
    void handle.commit();
    setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
  }, [openContent]);

  // Switch a Column table's entry format (Replicates / Mean+SD+N / Mean+SEM+N).
  // This is a STRUCTURAL rewrite, not a metadata flip: the grid changes from
  // replicate rows to a single summary row (or back), so we reshape the columns
  // + rows AND write the new format in one commit, mirroring the same Loro path
  // every other table edit uses. The lossy-switch confirms live in the control;
  // by the time this fires the user has accepted the reshape.
  //   - to a summary mode: compute each group's mean / spread / n from its
  //     replicates and replace the raw values with the three-subcolumn summary.
  //   - to replicates from a summary: reseed a replicate grid, keeping each
  //     group's mean as a single replicate (the raw values cannot be recovered).
  //   - SD <-> SEM: convert the stored spread losslessly with the stored n.
  const handleSwitchEntryFormat = useCallback(
    (next: EntryFormat) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      if (openContent.meta.table_type !== "column") return;
      const current = entryFormatOf(openContent);
      if (next === current) return;

      const currentlySummary = isSummaryFormat(current);
      const nextSummary = isSummaryFormat(next);
      let plan: { columns: typeof openContent.columns; rows: typeof openContent.rows };
      if (!currentlySummary && nextSummary) {
        plan = replicatesToSummaryPlan(openContent, next);
      } else if (currentlySummary && !nextSummary) {
        plan = summaryToReplicatesPlan(openContent);
      } else {
        // summary <-> summary: a lossless SD <-> SEM spread conversion.
        plan = convertSpreadKindPlan(openContent, next);
      }

      replaceTableInDoc(handle.doc, plan.columns, plan.rows);
      setEntryFormatInDoc(handle.doc, next);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Rename a summary group on a summary-format Column table: its three
  // subcolumns (mean / spread / n) share the group name, so the rename writes
  // the new name to each of them (the foundation keys the group name off the
  // mean column, but all three carry it). Mirrors the grouped-table rename path.
  const handleRenameSummaryGroup = useCallback(
    (datasetId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const trimmed = name.trim();
      if (trimmed === "") return;
      for (const col of openContent.columns) {
        if (col.role === "subcolumn" && col.datasetId === datasetId) {
          updateColumnInDoc(handle.doc, col.id, { name: trimmed });
        }
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Rename a column group on a Grouped table: every replicate column in the
  // group shares the group name, so a rename writes the new name to each of
  // them. Reprojects so the header and any two-way ANOVA pick up the new name.
  const handleRenameGroup = useCallback(
    (datasetId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const trimmed = name.trim();
      if (trimmed === "") return;
      // A Nested table carries the top-level group name on each subgroup column's
      // groupName field (the column `name` is the subgroup label, which must NOT
      // change here), so the rename writes groupName, not name.
      if (openContent.meta.table_type === "nested") {
        const group = nestedGroupColumns(openContent).find(
          (g) => g.datasetId === datasetId,
        );
        if (!group) return;
        for (const colId of group.subgroupColumnIds) {
          updateColumnInDoc(handle.doc, colId, { groupName: trimmed });
        }
        void handle.commit();
        setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
        return;
      }
      const group = groupDatasets(openContent).find(
        (g) => g.datasetId === datasetId,
      );
      if (!group) return;
      for (const colId of group.replicateColumnIds) {
        updateColumnInDoc(handle.doc, colId, { name: trimmed });
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Rename one subgroup column on a Nested table: the column's own `name` is the
  // subgroup label (a biological replicate), so a rename writes just that column.
  const handleRenameSubgroup = useCallback(
    (columnId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const trimmed = name.trim();
      if (trimmed === "") return;
      updateColumnInDoc(handle.doc, columnId, { name: trimmed });
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // --- Grid row/column CRUD (right-click menus) ------------------------------
  // These mirror the handleAddRow / handleAddColumn commit path exactly (write
  // through the Loro doc, commit debounced, reproject so the grid re-derives).
  // The guards live in lib/datahub/grid-crud so the menus can disable an action
  // and these handlers stay a no-op if one slips through. Generic over columns /
  // rows; only the menu labels differ by table type.

  // Delete one row by id. Guarded so the last remaining row is never removed (a
  // table needs at least one row to edit into).
  const handleDeleteRow = useCallback(
    (rowId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      if (!canDeleteRow(openContent)) return;
      deleteRowInDoc(handle.doc, rowId);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Insert a blank row at a position (above or below a clicked row). Reuses the
  // blank-row shape so every column gets a null cell.
  const handleInsertRowAt = useCallback(
    (index: number) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const row = buildBlankRow(openContent, `row-${Date.now()}`);
      addRowAtInDoc(handle.doc, row, index);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Delete one column by id, dropping its cell from every row. Guarded so a
  // structural axis (XY X column, Grouped row label) and the last data column are
  // never removed.
  const handleDeleteColumn = useCallback(
    (columnId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      if (!canDeleteColumn(openContent, columnId)) return;
      removeColumnInDoc(handle.doc, columnId);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Rename one column's display name. A blank name is rejected (a column needs a
  // label). The grid renames inline, so this is the commit half of that edit.
  const handleRenameColumn = useCallback(
    (columnId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const trimmed = name.trim();
      if (trimmed === "") return;
      updateColumnInDoc(handle.doc, columnId, { name: trimmed });
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Duplicate one column right after itself: a new column ("<name> copy") with the
  // source column's role / type, plus each row's source-cell value copied across.
  const handleDuplicateColumn = useCallback(
    (columnId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const newId = `col-${Date.now()}`;
      const copy = buildDuplicateColumn(openContent, columnId, newId);
      if (!copy) return;
      const srcIndex = columnIndex(openContent, columnId);
      addColumnAtInDoc(handle.doc, copy, srcIndex + 1);
      for (const row of openContent.rows) {
        setCell(handle.doc, row.id, newId, row.cells[columnId] ?? null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Insert a blank data column at a position (before or after a clicked column).
  // Reuses the blank-column shape (type-correct name) and backfills a null cell
  // per row so the grid reads cleanly.
  const handleInsertColumnAt = useCallback(
    (index: number) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const newId = `col-${Date.now()}`;
      const col = buildBlankColumn(openContent, newId);
      addColumnAtInDoc(handle.doc, col, index);
      for (const row of openContent.rows) {
        setCell(handle.doc, row.id, newId, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // --- Grouped grid group CRUD (right-click on the group header) -------------
  // A Grouped table's columns are replicate subcolumns bound into datasetId
  // groups, so these act on a WHOLE group (delete / duplicate / insert) or its
  // replicate COUNT (add / remove) rather than on a single column. Same commit
  // path as above; the guards live in lib/datahub/grouped-grid-crud so the menu
  // disables an action and these handlers stay a no-op if one slips through.

  // Delete a whole group: drop every replicate column of the datasetId plus its
  // cell from each row. Guarded so the last remaining group is never removed.
  const handleDeleteGroup = useCallback(
    (datasetId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      if (!canDeleteGroup(openContent, datasetId)) return;
      for (const colId of groupColumnIds(openContent, datasetId)) {
        removeColumnInDoc(handle.doc, colId);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Duplicate a whole group: clone every replicate column under a fresh datasetId
  // ("<name> copy"), inserted right after the source group, copying each row's
  // value across so the new group is a full copy.
  const handleDuplicateGroup = useCallback(
    (datasetId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const stamp = Date.now();
      const newDatasetId = `grp-${stamp}`;
      const plan = buildDuplicateGroupPlan(
        openContent,
        datasetId,
        newDatasetId,
        (i) => `${newDatasetId}-r${i + 1}`,
      );
      if (!plan) return;
      plan.columns.forEach((col, i) => {
        addColumnAtInDoc(handle.doc, col, plan.insertAt + i);
      });
      for (const row of openContent.rows) {
        for (const col of plan.columns) {
          const sourceId = plan.valueSourceByNewId[col.id];
          setCell(handle.doc, row.id, col.id, row.cells[sourceId] ?? null);
        }
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Grow one group by a replicate: append a blank replicate column to the group
  // (shared name + datasetId), backfilled null on every row.
  const handleAddReplicate = useCallback(
    (datasetId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const newId = `${datasetId}-r-${Date.now()}`;
      const added = buildAddedReplicate(openContent, datasetId, newId);
      if (!added) return;
      addColumnAtInDoc(handle.doc, added.column, added.insertAt);
      for (const row of openContent.rows) {
        setCell(handle.doc, row.id, newId, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Shrink one group by a replicate: drop its last replicate column plus cells.
  // Guarded so a group never loses its last replicate.
  const handleRemoveReplicate = useCallback(
    (datasetId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      if (!canRemoveReplicate(openContent, datasetId)) return;
      const colId = replicateToRemove(openContent, datasetId);
      if (!colId) return;
      removeColumnInDoc(handle.doc, colId);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Insert a fresh empty group at a column index (the menu passes the clicked
  // group's start for "before" or its end for "after"). The new group inherits the
  // table's replicate count so every group stays even, each subcolumn backfilled
  // null on every row.
  const handleInsertGroupAt = useCallback(
    (index: number) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const stamp = Date.now();
      const newDatasetId = `grp-${stamp}`;
      const columns = buildInsertGroupColumns(
        openContent,
        newDatasetId,
        (i) => `${newDatasetId}-r${i + 1}`,
      );
      columns.forEach((col, i) => {
        addColumnAtInDoc(handle.doc, col, index + i);
      });
      for (const row of openContent.rows) {
        for (const col of columns) setCell(handle.doc, row.id, col.id, null);
      }
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Bundle the grid CRUD callbacks once so each grid receives a stable object for
  // its right-click menus. The grid decides which items to surface from the table
  // type plus the per-column guards.
  const gridCrud = useMemo(
    () => ({
      onDeleteRow: handleDeleteRow,
      onInsertRowAt: handleInsertRowAt,
      onDeleteColumn: handleDeleteColumn,
      onRenameColumn: handleRenameColumn,
      onDuplicateColumn: handleDuplicateColumn,
      onInsertColumnAt: handleInsertColumnAt,
      onDeleteGroup: handleDeleteGroup,
      onDuplicateGroup: handleDuplicateGroup,
      onAddReplicate: handleAddReplicate,
      onRemoveReplicate: handleRemoveReplicate,
      onInsertGroupAt: handleInsertGroupAt,
    }),
    [
      handleDeleteRow,
      handleInsertRowAt,
      handleDeleteColumn,
      handleRenameColumn,
      handleDuplicateColumn,
      handleInsertColumnAt,
      handleDeleteGroup,
      handleDuplicateGroup,
      handleAddReplicate,
      handleRemoveReplicate,
      handleInsertGroupAt,
    ],
  );

  // Create a new Column table (seeded empty), refresh the catalog, and open it.
  const handleNewTable = useCallback(
    async (data: NewTableSubmit) => {
      setNewTableOpen(false);
      // An Info sheet is documentation, not a grid: it seeds an empty body +
      // constants in the info field and leaves columns / rows empty. Every grid
      // table seeds its columns / rows the usual way.
      const seed =
        data.tableType === "column"
          ? buildEmptyColumnTable()
          : data.tableType === "xy"
            ? buildEmptyXYTable()
            : data.tableType === "grouped"
              ? buildEmptyGroupedTable()
              : data.tableType === "survival"
                ? buildEmptySurvivalTable()
                : data.tableType === "contingency"
                  ? buildEmptyContingencyTable()
                  : data.tableType === "nested"
                    ? buildEmptyNestedTable()
                    : data.tableType === "partsOfWhole"
                      ? buildEmptyPartsOfWholeTable()
                      : { columns: [], rows: [] };
      const created = await dataHubApi.create({
        name: data.name,
        table_type: data.tableType,
        project_ids: data.collectionId ? [data.collectionId] : [],
        columns: seed.columns,
        rows: seed.rows,
        ...(data.tableType === "info" ? { info: buildEmptyInfoSheet() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
      // If the new table lands in the active collection, select it.
      if (
        collection === "all" ||
        (collection === "unfiled" && !data.collectionId) ||
        collection === data.collectionId
      ) {
        setSelectedTableId(created.id);
      } else {
        // Otherwise jump the filter to where it landed so it is visible.
        setCollection(data.collectionId || "unfiled");
        setSelectedTableId(created.id);
      }
    },
    [collection, queryClient],
  );

  // Create a Column table from imported data: seed it with the detected columns +
  // rows (the SAME api / store path New table uses, so the imported table is
  // version-controlled and editable from the first edit), refresh the catalog,
  // and open it.
  const handleImport = useCallback(
    async (data: ImportTableSubmit) => {
      setImportOpen(false);

      // AUTO-DETECTION (spec section 2). When the lane is enabled and the import
      // crosses the size threshold, route to the dataset lane BEFORE a single row
      // reaches the cell store, then open the dataset view. Below the threshold,
      // or with the lane off, the existing editable-lane path runs unchanged.
      if (
        bigTableOn &&
        currentUser &&
        isLargeTable(data.rows.length, data.columns.length)
      ) {
        const owner = currentUser;
        const id = await nextDatasetId(owner);
        await ingestToDatasetLane(owner, id, {
          name: data.name,
          columns: data.columns.map((c) => ({
            id: c.id,
            name: c.name,
            dataType: c.dataType,
          })),
          rows: data.rows.map((r) => ({ id: r.id, cells: r.cells })),
          source: { kind: "paste" },
          project_ids: data.collectionId ? [data.collectionId] : [],
        });
        await queryClient.invalidateQueries({
          queryKey: ["datahub", "datasets", owner],
        });
        setSelectedTableId(null);
        setSelectedDatasetId(id);
        return;
      }

      const created = await dataHubApi.create({
        name: data.name,
        table_type: "column",
        project_ids: data.collectionId ? [data.collectionId] : [],
        columns: data.columns,
        rows: data.rows,
      });
      await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
      if (
        collection === "all" ||
        (collection === "unfiled" && !data.collectionId) ||
        collection === data.collectionId
      ) {
        setSelectedTableId(created.id);
      } else {
        setCollection(data.collectionId || "unfiled");
        setSelectedTableId(created.id);
      }
    },
    [collection, queryClient, bigTableOn, currentUser],
  );

  // Create + run an analysis: dispatch the chosen type + columns to the engine,
  // store the spec plus its cached normalized result in the Loro doc (so it is
  // version-controlled and re-runs), commit, reproject, and select it. Shared by
  // the New analysis dialog and the guided wizard, which both produce the same
  // { type, columnIds } shape, so a guided run is indistinguishable from a manual
  // one once it lands.
  const createAnalysis = useCallback(
    (data: { type: string; columnIds: string[]; params?: Record<string, unknown> }) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const id = `analysis-${Date.now()}`;
      const spec = {
        id,
        type: data.type,
        // A recipe-applied analysis carries the recipe's Test-options bag; a plain
        // pick seeds an empty params bag (the engine defaults), as before.
        params: data.params ?? {},
        inputs: { columnIds: data.columnIds },
        resultCache: null as unknown,
        resultStale: false,
      };
      const outcome = runAnalysis(spec, openContent);
      spec.resultCache = outcome.ok ? outcome : null;
      setAnalysisInDoc(handle.doc, spec);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      setSelectedPlotId(null);
      setSelectedAnalysisId(id);
    },
    [openContent],
  );

  // Save the current analysis as a reusable recipe. Captures the REUSABLE part
  // (the analysis type + its Test-options params) plus the table TYPE it applies
  // to, so the New analysis dialog can offer it on any other table of that kind.
  // The table-specific inputs (column ids) and the cached result are NOT saved,
  // since a recipe re-runs against a fresh table's own columns.
  const handleSaveRecipe = useCallback(
    (name: string, analysis: AnalysisSpec, content: DataHubDocContent) => {
      void recipesApi.create({
        name,
        analysisType: analysis.type,
        params: analysis.params ?? {},
        tableType: content.meta.table_type,
      });
    },
    [],
  );

  const handleNewAnalysis = useCallback(
    (data: NewAnalysisSubmit) => {
      setNewAnalysisOpen(false);
      createAnalysis(data);
    },
    [createAnalysis],
  );

  const handleGuidedAnalysis = useCallback(
    (data: GuidedAnalysisSubmit) => {
      setGuidedOpen(false);
      createAnalysis(data);
    },
    [createAnalysis],
  );

  const selectedMeta = useMemo(
    () => allTables.find((t) => t.id === selectedTableId) ?? null,
    [allTables, selectedTableId],
  );

  // Manual "Switch to large-dataset mode" (spec section 2, mockup surface 3).
  // Re-materialize the OPEN editable table's current rows into a dataset via the
  // SAME ingestToDatasetLane path the auto-trip uses, then open the dataset view.
  // The cell store is left intact (a sub-threshold table can switch back), so this
  // is additive and non-destructive. Warned first by ManualSwitchControl.
  const handleManualSwitch = useCallback(async () => {
    if (!bigTableOn || !currentUser || !openContent || !selectedMeta) return;
    setManualSwitchBusy(true);
    try {
      const owner = currentUser;
      const id = await nextDatasetId(owner);
      await ingestToDatasetLane(owner, id, {
        name: selectedMeta.name,
        columns: openContent.columns.map((c) => ({
          id: c.id,
          name: c.name,
          dataType: c.dataType,
        })),
        rows: openContent.rows.map((r) => ({ id: r.id, cells: r.cells })),
        source: { kind: "paste" },
        project_ids: selectedMeta.project_ids ?? [],
      });
      await queryClient.invalidateQueries({
        queryKey: ["datahub", "datasets", owner],
      });
      setSelectedTableId(null);
      setSelectedDatasetId(id);
    } finally {
      setManualSwitchBusy(false);
    }
  }, [bigTableOn, currentUser, openContent, selectedMeta, queryClient]);

  // The derived-table banner inputs. When the open table is derived, resolve its
  // source meta from the catalog so the banner can name it and offer a jump to
  // it. isDerived comes from the open content's link (the recompute path sets it),
  // so a normal entered table reads isDerived false and shows no banner.
  const derivedInfo = useMemo(() => {
    const link = openContent?.meta.derivedFrom;
    if (!link) return null;
    // Read the primary source id from either link shape (legacy single-op or a
    // phase-2 recipe). A single editable column transform gets its own label; a
    // multi-step pipeline reads as the generic "a pipeline" label (the phase-3
    // builder owns multi-step editing).
    const sourceId = primarySourceId(link);
    if (!sourceId) return null;
    const sourceMeta = allTables.find((t) => t.id === sourceId) ?? null;
    const single = singleOpForDialog(link);
    return {
      sourceId,
      sourceMeta,
      label: single ? transformLabel(single.transform) : "a pipeline",
    };
  }, [openContent, allTables]);

  // Publish the current selection to the BeakerBot context bridge so the model
  // can resolve "this", "the t-test", or "this analysis" to the entity the user
  // actually has on screen. Placed after selectedMeta (useMemo above) so it is
  // in scope. The context is rebuilt whenever selectedMeta, selectedAnalysisId,
  // selectedPlotId, or openContent changes. On unmount it is cleared so the
  // model does not inherit a stale Data Hub selection after the user navigates.
  useEffect(() => {
    if (!selectedMeta) {
      setBeakerContext(null);
      return;
    }
    const tableParent = {
      type: "datahub-table" as const,
      id: selectedMeta.id,
      name: selectedMeta.name,
    };
    if (selectedAnalysisId && openContent) {
      const analysis = openContent.analyses.find(
        (a) => a.id === selectedAnalysisId,
      );
      setBeakerContext({
        route: "/datahub",
        pageLabel: "Data Hub",
        selection: {
          type: "datahub-analysis",
          id: selectedAnalysisId,
          name: analysis?.type ?? selectedAnalysisId,
          parent: tableParent,
        },
      });
    } else if (selectedPlotId && openContent) {
      const plot = openContent.plots.find((p) => p.id === selectedPlotId);
      setBeakerContext({
        route: "/datahub",
        pageLabel: "Data Hub",
        selection: {
          type: "datahub-plot",
          id: selectedPlotId,
          name: plot ? `Figure (${selectedPlotId})` : selectedPlotId,
          parent: tableParent,
        },
      });
    } else {
      setBeakerContext({
        route: "/datahub",
        pageLabel: "Data Hub",
        selection: {
          type: "datahub-table",
          id: selectedMeta.id,
          name: selectedMeta.name,
        },
      });
    }
    return () => {
      setBeakerContext(null);
    };
  }, [selectedMeta, selectedAnalysisId, selectedPlotId, openContent]);

  // Copy a markdown object reference to this table. Pasted into a note or a
  // result it renders as a live Data Hub chip that opens the table; pasted
  // anywhere else it stays a readable link. This is the note-embed entry point.
  const handleCopyReference = useCallback(async () => {
    if (!selectedMeta) return;
    const md = objectReferenceMarkdown("datahub", selectedMeta.id, selectedMeta.name);
    try {
      await navigator.clipboard.writeText(md);
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 1800);
    } catch {
      setRefCopied(false);
    }
  }, [selectedMeta]);

  // Export a table as a CSV download. With no id (the toolbar) it exports the
  // open table from the live document content, so the CSV reflects the latest
  // edits without a re-open. With an id (a rail right-click on a non-open table)
  // it reads that table's content from the readable mirror.
  const handleExportTable = useCallback(
    async (id?: string) => {
      if (!id || (openContent && openIdRef.current === id)) {
        if (!openContent || !selectedMeta) return;
        downloadCsv(openContent, selectedMeta.name);
        return;
      }
      const content = await dataHubApi.getContent(id);
      if (content) downloadCsv(content, content.meta.name);
    },
    [openContent, selectedMeta],
  );

  // --- Rail item CRUD (right-click menus) ------------------------------------
  // The rail's table / analysis / figure rows surface the same edit vocabulary
  // the grids do. Table actions reuse the table handlers above; analysis + plot
  // actions write through the open Loro doc (the same commit + reproject path
  // every in-doc edit uses), so a rename / delete / duplicate is version
  // controlled and converges like a cell edit.

  // Rename a table by id. Writes the new title into the live doc (so the sidebar
  // and the title round-trip from the CRDT) and syncs the readable mirror via the
  // catalog update, passing the live content so the re-seed stays faithful to the
  // open doc. A blank name is rejected (a table needs a label). Only the open
  // table is renamed here, which is the only one the rail can target.
  const handleRenameTable = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed === "") return;
      const handle = handleRef.current;
      if (handle && openIdRef.current === id && openContent) {
        setTitleInDoc(handle.doc, trimmed);
        void handle.commit();
        const live = getDataHubContent(handle.doc, id);
        setOpenContent(live);
        await dataHubApi.update(id, {
          name: trimmed,
          columns: live.columns,
          rows: live.rows,
          analyses: live.analyses,
          plots: live.plots,
        });
      } else {
        await dataHubApi.update(id, { name: trimmed });
      }
      await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
    },
    [openContent, queryClient],
  );

  // Rename one analysis. Sets the optional display name on its spec and commits;
  // a blank name clears the name back to the computed label (rail falls back).
  const handleRenameAnalysis = useCallback(
    (analysisId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.analyses.find((a) => a.id === analysisId);
      if (!current) return;
      const trimmed = name.trim();
      const next = { ...current };
      if (trimmed === "") delete next.name;
      else next.name = trimmed;
      setAnalysisInDoc(handle.doc, next);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Change one editable parameter on an analysis (tail, variance, post-hoc).
  // Writes the validated value into spec.params and marks the cache stale so the
  // stale-rerun effect recomputes against the engine with the new option. The
  // open ResultsSheet also recomputes live on the next render, so the tables,
  // verdict, and Show-the-code all reflect the change immediately. Mirrors the
  // rename path (set spec, commit, reproject) so it is version-controlled the
  // same way every other in-doc edit is.
  const handleAnalysisParamChange = useCallback(
    (analysisId: string, key: string, value: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.analyses.find((a) => a.id === analysisId);
      if (!current) return;
      const coerced = coerceParam(current.type, key, value);
      if (coerced === null) return; // out-of-schema edit, ignore
      const nextParams = { ...current.params, [key]: coerced };
      setAnalysisInDoc(handle.doc, {
        ...current,
        params: nextParams,
        resultStale: true,
      });
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Delete one analysis. Removes it from the doc, commits, reprojects, and clears
  // the selection if it was the one open so the main panel falls back to the grid
  // (never a blank / broken sheet pointing at a gone analysis).
  const handleDeleteAnalysis = useCallback(
    (analysisId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      removeAnalysisInDoc(handle.doc, analysisId);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      if (selectedAnalysisId === analysisId) setSelectedAnalysisId(null);
    },
    [openContent, selectedAnalysisId],
  );

  // Re-run one analysis. Forces a recompute against the current data (the engine
  // re-runs deterministically from the stored choice + params), restamps the
  // cache, clears the stale flag, then selects it so the fresh result is shown.
  // Reuses runAnalysis, the same primitive the stale-rerun effect uses.
  const handleReRunAnalysis = useCallback(
    (analysisId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.analyses.find((a) => a.id === analysisId);
      if (!current) return;
      const outcome = runAnalysis(current, openContent);
      setAnalysisInDoc(handle.doc, {
        ...current,
        resultCache: outcome.ok ? outcome : null,
        resultStale: false,
      });
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      setSelectedPlotId(null);
      setSelectedAnalysisId(analysisId);
    },
    [openContent],
  );

  // Rename one figure. Sets the optional display name on its spec and commits; a
  // blank name clears it (rail falls back to the figure title or kind label).
  const handleRenamePlot = useCallback(
    (plotId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.plots.find((p) => p.id === plotId);
      if (!current) return;
      const trimmed = name.trim();
      const next = { ...current };
      if (trimmed === "") delete next.name;
      else next.name = trimmed;
      setPlotInDoc(handle.doc, next);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent],
  );

  // Delete one figure. Removes it from the doc, commits, reprojects, and clears
  // the selection if it was the one open so the main panel falls back to the grid.
  const handleDeletePlot = useCallback(
    (plotId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      removePlotInDoc(handle.doc, plotId);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      if (selectedPlotId === plotId) setSelectedPlotId(null);
    },
    [openContent, selectedPlotId],
  );

  // Duplicate one figure. Clones the spec under a fresh id with a "<name> copy"
  // display name (so the two are distinguishable in the rail), persists it, then
  // selects the copy. The source style + source record carry over verbatim, so
  // the copy draws identically until the user edits it.
  const handleDuplicatePlot = useCallback(
    (plotId: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.plots.find((p) => p.id === plotId);
      if (!current) return;
      const newId = `plot-${Date.now()}`;
      const baseName = current.name ?? plotExportLabel(current);
      const copy: PlotSpec = {
        ...current,
        id: newId,
        name: `${baseName} copy`,
        style: { ...current.style },
        source: { ...current.source },
      };
      setPlotInDoc(handle.doc, copy);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      setSelectedAnalysisId(null);
      setSelectedPlotId(newId);
    },
    [openContent],
  );

  // Export one figure as a PNG / SVG without opening it. Renders the spec against
  // the live content (the same renderPlot the editor uses), resolves the linked
  // ANOVA for brackets, then hands the SVG string to the size-aware export. The
  // figure need not be the selected one.
  const exportPlot = useCallback(
    (plotId: string, format: "png" | "svg") => {
      if (!openContent) return;
      const spec = openContent.plots.find((p) => p.id === plotId);
      if (!spec) return;
      const aid = (spec.source as { analysisId?: unknown }).analysisId;
      const analysis =
        typeof aid === "string"
          ? openContent.analyses.find((a) => a.id === aid) ?? null
          : null;
      const { svg, frame } = renderPlot(spec, openContent, analysis);
      const stem = plotExportLabel(spec);
      if (format === "svg") {
        downloadSvg(exportSvgMarkup(svg, frame), stem);
      } else {
        const px = exportPngPixels(frame);
        void downloadPngAt(svg, px.width, px.height, stem);
      }
    },
    [openContent],
  );

  // Duplicate the open table, its analyses, and its graphs into a fresh document
  // ("<name> copy"), via the same create path New table uses, then open it. The
  // duplicate carries the source table's collection + folder so it lands beside
  // the original. Analyses keep their cached results, so the copy opens ready.
  const handleDuplicateTable = useCallback(
    async (id?: string) => {
      // The open table (toolbar, or a rail right-click on it) duplicates from the
      // live content so unsaved edits carry. A rail right-click on a non-open
      // table reads that table's content + catalog meta from the mirror.
      let name: string;
      let content: DataHubDocContent;
      let projectIds: string[];
      let folderPath: string | null;
      if (!id || (openContent && openIdRef.current === id)) {
        if (!openContent || !selectedMeta) return;
        name = selectedMeta.name;
        content = openContent;
        projectIds = selectedMeta.project_ids;
        folderPath = selectedMeta.folder_path;
      } else {
        const loaded = await dataHubApi.getContent(id);
        const meta = allTables.find((t) => t.id === id);
        if (!loaded || !meta) return;
        name = meta.name;
        content = loaded;
        projectIds = meta.project_ids;
        folderPath = meta.folder_path;
      }
      const created = await dataHubApi.create({
        name: `${name} copy`,
        table_type: content.meta.table_type,
        project_ids: projectIds,
        folder_path: folderPath,
        columns: content.columns,
        rows: content.rows,
        analyses: content.analyses,
        plots: content.plots,
      });
      await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
      setSelectedTableId(created.id);
    },
    [openContent, selectedMeta, allTables, queryClient],
  );

  // Delete the open table (both files), then refresh the catalog. The selection
  // self-heals to the next visible table through the existing resolve effect, so
  // we just clear the pending confirm and let that effect re-point the view.
  const handleDeleteTable = useCallback(async () => {
    if (!selectedTableId) return;
    const id = selectedTableId;
    setConfirmDeleteTableId(null);
    // Flush + drop the open handle first so its debounced commit cannot rewrite
    // the files we are about to delete.
    const handle = handleRef.current;
    if (handle && openIdRef.current === id) {
      await handle.close().catch(() => {});
      handleRef.current = null;
      openIdRef.current = null;
    }
    await dataHubApi.delete(id);
    await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
  }, [selectedTableId, queryClient]);

  // Create a new figure from the chosen kind: build the PlotSpec (seeding its
  // y-axis title from the table name), link the ANOVA for brackets when one was
  // chosen, persist it via setPlot, commit, reproject, and select it.
  const handleNewGraph = useCallback(
    (data: NewGraphSubmit) => {
      setNewGraphOpen(false);
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const id = `plot-${Date.now()}`;
      const tableType = openContent.meta.table_type;
      const isXY = tableType === "xy";
      const isSurvival = tableType === "survival";
      const yName = data.yColumnId
        ? yColumns(openContent).find((c) => c.id === data.yColumnId)?.name
        : undefined;
      // Diagnostic plots (qqPlot / residualPlot / rocCurve) set their own axis
      // titles from the diagnostic renderer, so the table-name seeding below is
      // skipped for them (an empty yTitle / xTitle lets the renderer default).
      const isDiagnostic =
        data.kind === "qqPlot" ||
        data.kind === "residualPlot" ||
        data.kind === "rocCurve";
      const spec = buildPlotSpec({
        id,
        kind: data.kind,
        tableId: openIdRef.current,
        analysisId: data.analysisId,
        yColumnId: data.yColumnId ?? null,
        fitModel: data.fitModel,
        estimationPaired: data.estimationPaired,
        estimationControlIndex: data.estimationControlIndex,
        diagnosticColumnIndex: data.diagnosticColumnIndex,
        yTitle: isDiagnostic
          ? ""
          : isXY
            ? yName ?? selectedMeta?.name ?? "Y"
            : isSurvival
              ? "Survival"
              : selectedMeta?.name ?? "Value",
        xTitle: isDiagnostic ? "" : isXY ? "X" : isSurvival ? "Time" : undefined,
      });
      setPlotInDoc(handle.doc, spec);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      setSelectedAnalysisId(null);
      setSelectedPlotId(id);
    },
    [openContent, selectedMeta],
  );

  // Create or update a DERIVED table from the Transform dialog.
  //
  // CREATE (the open table is a normal entered table): mint a new document whose
  // derivedFrom links back to the open table, seeded with a first computed
  // snapshot so the catalog mirror and any read of getContent see a valid table.
  // The recompute path keeps it live on every later open. The derived table
  // inherits the source's projects + folder so it lands beside it.
  //
  // EDIT (the open table is itself derived): rewrite its derivedFrom transform +
  // params and the snapshot in place, then reproject so the grid + figures
  // recompute. The source is the derived table's own sourceTableId, resolved by
  // id (the source content is what the transform runs against).
  const handleTransform = useCallback(
    async (data: TransformSubmit) => {
      setTransformOpen(false);
      if (!openContent || openIdRef.current == null) return;
      const existing = openContent.meta.derivedFrom;

      // The content the transform runs against. For a create that is the open
      // table itself; for an edit it is the derived table's source, fetched by
      // id (the open table's columns/rows are the previous computed snapshot, not
      // the source).
      let sourceId: string;
      let sourceContent: DataHubDocContent | null;
      if (existing) {
        // Read the primary source from either link shape (a derived table edited
        // here is always single-op, but it may already be stored in either shape).
        sourceId = primarySourceId(existing) ?? openIdRef.current;
        sourceContent = await dataHubApi.getContent(sourceId);
      } else {
        sourceId = openIdRef.current;
        sourceContent = openContent;
      }

      // The single-op dialog now writes a ONE-op recipe (the new derivedFrom
      // shape), not the legacy { transform, params }. The one op is the folded
      // column transform for the chosen kind, so it runs through the same engine
      // the recompute path uses. The multi-step builder is phase 3.
      const op = legacyOpToTransformOp(data.transform, data.params);
      const derivedFrom = { sources: [sourceId], recipe: [op] };

      // Compute the snapshot when the source is available. A missing source (only
      // possible on an edit whose source was deleted) seeds an empty snapshot; the
      // recompute path then surfaces the deleted-source empty state on open.
      const pipelineResult = sourceContent
        ? executePipeline(sourceContent, { ops: [op] }, new Map([[sourceId, sourceContent]]))
        : null;
      const snapshot =
        pipelineResult && "content" in pipelineResult ? pipelineResult.content : null;

      if (existing) {
        // Edit in place: update the link + snapshot on the derived document. The
        // selection is unchanged, so the open effect reprojects + recomputes.
        await dataHubApi.update(openIdRef.current, {
          derivedFrom,
          table_type: snapshot?.meta.table_type,
          columns: snapshot?.columns ?? [],
          rows: snapshot?.rows ?? [],
        });
        await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
        // Re-open the same handle so the recompute runs and the grid + figures
        // pick up the new transform. Toggling the id forces the open effect.
        const id = openIdRef.current;
        const handle = handleRef.current;
        if (handle) {
          await handle.close().catch(() => {});
          handleRef.current = null;
          openIdRef.current = null;
        }
        setSelectedTableId(null);
        setTimeout(() => setSelectedTableId(id), 0);
        return;
      }

      // Create: a new derived document linked to the open (source) table.
      const created = await dataHubApi.create({
        name: data.suggestedName,
        table_type: snapshot?.meta.table_type ?? openContent.meta.table_type,
        project_ids: selectedMeta?.project_ids ?? [],
        folder_path: selectedMeta?.folder_path ?? null,
        derivedFrom,
        columns: snapshot?.columns ?? [],
        rows: snapshot?.rows ?? [],
      });
      await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
      setSelectedTableId(created.id);
    },
    [openContent, selectedMeta, queryClient],
  );

  // Resolve the source content the Transform dialog previews against. For a
  // normal table the source is the open content; for a derived table the open
  // content is the snapshot, so fetch the real source by id. Cleared when the
  // dialog closes so a stale source never lingers.
  useEffect(() => {
    if (!transformOpen || !openContent) {
      setTransformSourceContent(null);
      return;
    }
    const existing = openContent.meta.derivedFrom;
    if (!existing) {
      setTransformSourceContent(openContent);
      return;
    }
    const sourceId = primarySourceId(existing);
    if (!sourceId) {
      setTransformSourceContent(openContent);
      return;
    }
    let cancelled = false;
    void dataHubApi.getContent(sourceId).then((c) => {
      if (!cancelled) setTransformSourceContent(c);
    });
    return () => {
      cancelled = true;
    };
  }, [transformOpen, openContent]);

  // Persist a style patch onto the open figure (a live styling-panel change).
  // Writes the updated PlotSpec back through setPlot, commits, and reprojects so
  // the figure redraws and the change is version-controlled.
  const handlePlotStyleChange = useCallback(
    (patch: Partial<PlotStyle>) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const current = openContent.plots.find((p) => p.id === selectedPlotId);
      if (!current) return;
      setPlotInDoc(handle.doc, withStyle(current, patch));
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [openContent, selectedPlotId],
  );

  // Re-run any stale analyses when the open content changes (a cell edit marks
  // nothing stale on its own here, so this restamps the cache to the latest
  // numbers and clears the stale flag for the open table's analyses). Kept cheap
  // by only writing when a stored result actually differs is overkill for slice
  // 2, so we restamp opportunistically when an analysis is selected and stale.
  const selectedAnalysis = useMemo(
    () =>
      openContent?.analyses.find((a) => a.id === selectedAnalysisId) ?? null,
    [openContent, selectedAnalysisId],
  );

  // The open figure, plus the analysis it pulls significance brackets from (its
  // source.analysisId, resolved against the live analyses so the latest cached
  // ANOVA result feeds the brackets).
  const selectedPlot = useMemo(
    () => openContent?.plots.find((p) => p.id === selectedPlotId) ?? null,
    [openContent, selectedPlotId],
  );
  const plotAnalysis = useMemo(() => {
    if (!selectedPlot || !openContent) return null;
    const aid = (selectedPlot.source as { analysisId?: unknown }).analysisId;
    if (typeof aid !== "string") return null;
    return openContent.analyses.find((a) => a.id === aid) ?? null;
  }, [selectedPlot, openContent]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !openContent || openIdRef.current == null) return;
    if (!selectedAnalysis || !selectedAnalysis.resultStale) return;
    const outcome = runAnalysis(selectedAnalysis, openContent);
    setAnalysisInDoc(handle.doc, {
      ...selectedAnalysis,
      resultCache: outcome.ok ? outcome : null,
      resultStale: false,
    });
    void handle.commit();
    setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
  }, [selectedAnalysis, openContent]);

  // The active collection as the New-table dialog's default ("" for All/Unfiled).
  const dialogDefaultCollection =
    collection === "all" || collection === "unfiled" ? "" : collection;

  // The table workspace toolbar. Analyze is the headline accent action (the same
  // chooser the rail's New analysis opens, Prism's single most-used button), New
  // graph sits beside it, then a group for the type-correct Add controls, then a
  // group for table-level Duplicate / Export / Delete. The Add label tracks the
  // table type so a column table reads "Add group" while an XY reads "Add Y
  // column" and a survival table only offers "Add subject" (no second axis).
  const tableToolbarGroups = useMemo<ToolbarGroup[]>(() => {
    if (!openContent) return [];
    const type = openContent.meta.table_type;

    // An Info sheet is documentation, not data. It has no Analyze, no New graph,
    // no Plan study, no Transform, and no Add controls. It still gets the
    // table-level Duplicate / Delete (Export-as-CSV is dropped, there is no grid
    // to export); rename lives on the rail like the other docs.
    if (type === "info") {
      return [
        [
          {
            icon: "cloning" as const,
            label: "Duplicate",
            onClick: () => void handleDuplicateTable(),
            tooltip: "Copy this info sheet with its notes and constants.",
            testId: "datahub-toolbar-duplicate",
          },
          {
            icon: "trash" as const,
            label: "Delete",
            onClick: () => setConfirmDeleteTableId(selectedTableId),
            danger: true,
            tooltip: "Delete this info sheet.",
            testId: "datahub-toolbar-delete",
          },
        ],
      ];
    }

    const addColumnLabel =
      type === "xy"
        ? "Add Y column"
        : type === "contingency"
          ? "Add column"
          : "Add group";

    // A summary-format Column table holds a single fixed row (the entered
    // descriptives), so Add row does not apply there; only Add group does.
    const summary =
      type === "column" && isSummaryFormat(openContent.meta.entryFormat);

    // A derived table is computed, not entered, so the Add controls do not apply.
    // It still graphs + analyzes + exports + duplicates + deletes like any table,
    // and its Transform button edits the link instead of creating a new one.
    const derived = !!openContent.meta.derivedFrom;

    const addGroup: ToolbarGroup = [];
    if (!derived) {
      if (!summary) {
        addGroup.push({
          icon: "plus",
          label:
            type === "survival"
              ? "Add subject"
              : type === "nested"
                ? "Add replicate"
                : "Add row",
          onClick: handleAddRow,
          testId: "datahub-toolbar-add-row",
        });
      }
      if (type !== "survival") {
        addGroup.push({
          icon: "plus",
          label: addColumnLabel,
          onClick: handleAddColumn,
          testId: "datahub-toolbar-add-column",
        });
      }
    }

    return [
      [
        {
          icon: "bolt",
          label: "Analyze",
          onClick: () => setNewAnalysisOpen(true),
          primary: true,
          tooltip: "Choose a statistical test to run on this table.",
          testId: "datahub-toolbar-analyze",
        },
        {
          icon: "chart",
          label: "New graph",
          onClick: () => setNewGraphOpen(true),
          tooltip: "Make a figure from this table.",
          testId: "datahub-toolbar-new-graph",
        },
        {
          icon: "gauge",
          label: "Plan study",
          onClick: () => setPowerPlannerOpen(true),
          tooltip:
            "Power and sample-size planner. Find the N you need, the power you have, or the smallest effect you can detect.",
          testId: "datahub-toolbar-plan-study",
        },
        {
          icon: "merge",
          label: derived ? "Edit transform" : "Transform",
          onClick: () => setTransformOpen(true),
          tooltip: derived
            ? "Change the transform that computes this table."
            : "Make a new table computed from this one. It updates live when you edit this one.",
          testId: "datahub-toolbar-transform",
        },
      ],
      addGroup,
      [
        // A derived table can show the open-source code that reproduces it from
        // its base table(s) through every transform, the same transparency the
        // analysis and figure Code buttons give. An entered table has no recipe
        // to reproduce, so this only appears on a derived table.
        ...(derived
          ? [
              {
                icon: "file" as const,
                label: showTableCode ? "Hide code" : "Code",
                onClick: () => setShowTableCode((v) => !v),
                tooltip:
                  "Show the code that rebuilds this table from its base table through every transform.",
                testId: "datahub-toolbar-code",
              },
            ]
          : []),
        {
          icon: "cloning",
          label: "Duplicate",
          // Call with no id so the toolbar always targets the open table (an
          // onClick event must not leak in as the id argument).
          onClick: () => void handleDuplicateTable(),
          tooltip: "Copy this table with its analyses and graphs.",
          testId: "datahub-toolbar-duplicate",
        },
        {
          icon: "download",
          label: "Export",
          onClick: () => void handleExportTable(),
          tooltip: "Download this table as a CSV.",
          testId: "datahub-toolbar-export",
        },
        {
          icon: "trash",
          label: "Delete",
          onClick: () => setConfirmDeleteTableId(selectedTableId),
          danger: true,
          tooltip: "Delete this table.",
          testId: "datahub-toolbar-delete",
        },
      ],
    ];
  }, [
    openContent,
    handleAddRow,
    handleAddColumn,
    handleDuplicateTable,
    handleExportTable,
    selectedTableId,
    showTableCode,
  ]);

  // Gate: render a calm "not enabled" state when the flag is off and this is not
  // a demo session (mirror the /supplies gate). Never crash. Before mount we hold
  // a neutral frame, since the demo signal is client-only, so a demo session never
  // flashes the not-enabled notice before the real surface appears.
  if (!surfaceEnabled) {
    if (!mounted) {
      return <AppShell>{null}</AppShell>;
    }
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-20 text-center">
          <h2 className="text-heading font-semibold text-foreground">
            Data Hub is not enabled
          </h2>
          <p className="mt-2 text-body text-foreground-muted">Check back soon.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full min-h-0 gap-3 px-4 pb-4">
        <DataHubRail
          projects={projects}
          tables={tablesInCollection}
          collection={collection}
          onCollectionChange={setCollection}
          selectedTableId={selectedTableId}
          onSelectTable={(id) => {
            setSelectedAnalysisId(null);
            setSelectedPlotId(null);
            setSelectedDatasetId(null);
            setSelectedTableId(id);
          }}
          datasets={datasets.map((d) => ({
            id: d.id,
            name: d.name,
            rowCount: d.rowCount,
          }))}
          selectedDatasetId={selectedDatasetId}
          onSelectDataset={(id) => {
            setSelectedAnalysisId(null);
            setSelectedPlotId(null);
            setSelectedTableId(null);
            setSelectedDatasetId(id);
          }}
          onNewTable={() => setNewTableOpen(true)}
          onNewFolder={() => setNewTableOpen(true)}
          onImport={() => setImportOpen(true)}
          onPlanStudy={() => setPowerPlannerOpen(true)}
          counts={counts}
          analyses={openContent?.analyses ?? []}
          selectedAnalysisId={selectedAnalysisId}
          onSelectAnalysis={(id) => { setSelectedPlotId(null); setSelectedAnalysisId(id); }}
          onNewAnalysis={() => setNewAnalysisOpen(true)}
          onGuidedAnalysis={() => setGuidedOpen(true)}
          analysesEnabled={!!openContent && openContent.meta.table_type !== "info"}
          plots={openContent?.plots ?? []}
          selectedPlotId={selectedPlotId}
          onSelectPlot={(id) => {
            setSelectedAnalysisId(null);
            setSelectedPlotId(id);
          }}
          onNewGraph={() => setNewGraphOpen(true)}
          graphsEnabled={!!openContent && openContent.meta.table_type !== "info"}
          onRenameTable={handleRenameTable}
          onDuplicateTable={handleDuplicateTable}
          onDeleteTable={(id) => {
            // Mirror the toolbar Delete: select the table so its confirm banner
            // is visible, then arm it. Never a one-click destructive delete.
            setSelectedTableId(id);
            setConfirmDeleteTableId(id);
          }}
          onExportTable={(id) => void handleExportTable(id)}
          onRenameAnalysis={handleRenameAnalysis}
          onDeleteAnalysis={handleDeleteAnalysis}
          onReRunAnalysis={handleReRunAnalysis}
          onRenamePlot={handleRenamePlot}
          onDeletePlot={handleDeletePlot}
          onDuplicatePlot={handleDuplicatePlot}
          onExportPlotPng={(id) => exportPlot(id, "png")}
          onExportPlotSvg={(id) => exportPlot(id, "svg")}
        />

        <section
          className={`flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface-raised ${
            (selectedMeta && openContent) ||
            (selectedDatasetId && openDatasetSidecar)
              ? "overflow-hidden"
              : "overflow-auto p-5"
          }`}
        >
          {selectedDatasetId && openDatasetSidecar && currentUser ? (
            // Large-dataset lane. The TransformBuilder takes the panel when open
            // (Phase 2a, mockup surface 1); otherwise the DatasetView owns it
            // (preview grid, status chip, explainer, column tiers, full-render
            // warning). Both take precedence over the editable-lane grid.
            datasetBuilderOpen ? (
              <TransformBuilder
                owner={currentUser}
                sidecar={openDatasetSidecar}
                mintId={() => nextDatasetId(currentUser)}
                onClose={() => setDatasetBuilderOpen(false)}
                onSaved={(saved) => {
                  setDatasetBuilderOpen(false);
                  void queryClient.invalidateQueries({
                    queryKey: ["datahub", "datasets", currentUser],
                  });
                  setSelectedDatasetId(saved.id);
                }}
              />
            ) : (
              <DatasetView
                owner={currentUser}
                sidecar={openDatasetSidecar}
                onOpenTransform={() => setDatasetBuilderOpen(true)}
              />
            )
          ) : tablesInCollection.length === 0 && datasets.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <h1 className="text-heading font-semibold text-foreground">
                No data tables yet
              </h1>
              <p className="max-w-sm text-body text-foreground-muted">
                A data table holds your raw replicates. The summary and any graph
                read from it live, so you enter the numbers once.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewTableOpen(true)}
                  className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-4 py-2 text-body font-medium"
                >
                  New table
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="rounded-md border border-border px-4 py-2 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken"
                >
                  Import data
                </button>
              </div>
            </div>
          ) : selectedMeta && openContent && selectedPlot ? (
            <GraphEditor
              spec={selectedPlot}
              content={openContent}
              analysis={plotAnalysis}
              title={selectedMeta.name}
              onStyleChange={handlePlotStyleChange}
              resolveContent={resolveTableContent}
            />
          ) : selectedMeta && openContent && selectedAnalysis ? (
            <ResultsSheet
              spec={selectedAnalysis}
              content={openContent}
              title={selectedMeta.name}
              onNewAnalysis={() => setNewAnalysisOpen(true)}
              onGraphResult={() => setNewGraphOpen(true)}
              onChangeAnalysis={() => setNewAnalysisOpen(true)}
              onParamChange={(key, value) =>
                handleAnalysisParamChange(selectedAnalysis.id, key, value)
              }
              onSaveRecipe={(name) =>
                handleSaveRecipe(name, selectedAnalysis, openContent)
              }
              resolveContent={resolveTableContent}
            />
          ) : selectedMeta && openContent ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Title row, then the workspace toolbar full-bleed, then the
                  scrollable grid body. The toolbar is the headline surface where
                  Analyze leads (the single most-used Prism move), New graph sits
                  beside it, the Add controls are their own group, and Duplicate /
                  Export / Delete close out table-level actions. */}
              <div className="flex items-center gap-2 px-5 pb-2 pt-4">
                <h1 className="text-title font-semibold text-foreground">
                  {selectedMeta.name}
                </h1>
                <Tooltip label="Copy a reference to paste into a note or result. It becomes a live chip that opens this table.">
                  <button
                    type="button"
                    onClick={handleCopyReference}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                    data-testid="datahub-copy-reference"
                  >
                    <Icon name="copy" className="h-3.5 w-3.5" />
                    {refCopied ? "Copied reference" : "Copy reference"}
                  </button>
                </Tooltip>
                {/* Entry-format control, Column tables only. Lets a researcher
                    switch to entering already-calculated summary stats (Mean,
                    SD or SEM, N) when they do not have the raw replicates. */}
                {openContent.meta.table_type === "column" && !derivedInfo ? (
                  <div className="ml-auto">
                    <TableFormatControl
                      format={entryFormatOf(openContent)}
                      onChange={handleSwitchEntryFormat}
                    />
                  </div>
                ) : null}
              </div>

              {/* Derived-table banner. A derived table is computed from a source
                  via a transform and recomputes live, so the banner names the
                  source + transform, offers a jump to the source, and carries a
                  subtle live cue. */}
              {derivedInfo && (
                <div
                  className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/50 px-5 py-2"
                  data-testid="datahub-derived-banner"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span className="text-meta text-foreground">
                    Derived from{" "}
                    {derivedInfo.sourceMeta ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTableId(derivedInfo.sourceId)
                        }
                        className="font-medium text-accent underline-offset-2 hover:underline"
                        data-testid="datahub-derived-source-link"
                      >
                        {derivedInfo.sourceMeta.name}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground">
                        a deleted table
                      </span>
                    )}{" "}
                    via {derivedInfo.label}. Updates live.
                  </span>
                </div>
              )}

              <WorkspaceToolbar testId="datahub-table-toolbar" groups={tableToolbarGroups} />

              {/* Manual switch into the large-dataset lane (spec section 2). Any
                  normal (non-derived, non-Info) table can opt into the heavy lane
                  for speed and the rule builder. Warns about load time first. */}
              {bigTableOn &&
                !derivedInfo &&
                openContent.meta.table_type !== "info" && (
                  <div className="border-b border-border px-5 py-2">
                    <ManualSwitchControl
                      rowCount={openContent.rows.length}
                      reversible={
                        !isLargeTable(
                          openContent.rows.length,
                          openContent.columns.length,
                        )
                      }
                      busy={manualSwitchBusy}
                      onConfirm={() => void handleManualSwitch()}
                    />
                  </div>
                )}

              {confirmDeleteTableId === selectedMeta.id && (
                <div
                  className="flex flex-wrap items-center gap-3 border-b border-border bg-rose-50 px-5 py-2.5 dark:bg-rose-500/10"
                  data-testid="datahub-delete-confirm"
                >
                  <span className="text-meta text-foreground">
                    Delete {selectedMeta.name}, its analyses, and its graphs. This
                    cannot be undone.
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTableId(null)}
                      className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
                      data-testid="datahub-delete-cancel"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteTable}
                      className="rounded-md bg-rose-600 px-2.5 py-1 text-meta font-semibold text-white transition-colors hover:bg-rose-700"
                      data-testid="datahub-delete-confirm-button"
                    >
                      Delete table
                    </button>
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4">
                {openContent.meta.table_type === "info" ? (
                  // An Info sheet is documentation, not a grid: render the
                  // markdown body + constants editor instead of any table grid.
                  <InfoSheetEditor
                    content={openContent}
                    onChange={handleInfoChange}
                  />
                ) : derivedInfo && derivedSourceMissing ? (
                  // The source table was deleted, so the live link has nothing to
                  // recompute from. Show a calm empty state (never a crash) with a
                  // way to delete this now-orphaned derived table.
                  <div
                    className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center"
                    data-testid="datahub-derived-source-missing"
                  >
                    <Icon
                      name="alert"
                      className="h-6 w-6 text-foreground-muted"
                    />
                    <h2 className="text-title font-semibold text-foreground">
                      The source table was deleted
                    </h2>
                    <p className="text-body text-foreground-muted">
                      This derived table is computed from another table that no
                      longer exists, so it has no data to show. You can delete it,
                      or recreate the source table to bring it back.
                    </p>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTableId(selectedMeta.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken"
                      data-testid="datahub-derived-delete"
                    >
                      Delete this derived table
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="mb-4 text-meta text-foreground-muted">
                      {derivedInfo
                        ? `Computed from ${
                            derivedInfo.sourceMeta?.name ?? "its source"
                          } via ${derivedInfo.label}. The cells are read-only because they recompute from the source. Edit the transform to change them, or edit the source to update them live.`
                        : openContent.meta.table_type === "xy"
                          ? "XY table. The first column is the X value, each following column is a measured Y, one observation per row."
                          : openContent.meta.table_type === "grouped"
                            ? "Grouped table. Each row is a category and each column group is a second factor, with replicate subcolumns for a two-way ANOVA."
                            : openContent.meta.table_type === "survival"
                              ? "Survival table. Each row is a subject with a time, an event indicator (1 or 0), and an optional group for Kaplan-Meier and the log-rank test."
                              : openContent.meta.table_type === "contingency"
                                ? "Contingency table. An R x C grid of counts, one row per category of the first factor and one count column per category of the second, for the chi-square test and a 2x2 Fisher exact test with relative risk and odds ratio."
                                : openContent.meta.table_type === "nested"
                                ? "Nested table. Each group is a treatment, each subgroup column a biological replicate, each row a technical replicate, for the nested t-test and nested one-way ANOVA."
                                : openContent.meta.table_type === "partsOfWhole"
                                ? "Parts-of-whole table. Each row is one slice of a single whole, a category label and a value, with the percent of total computed live, for pie, donut, and 100-percent stacked-bar figures."
                                : isSummaryFormat(openContent.meta.entryFormat)
                                ? `Column table, summary entry. Each column is a group, and you enter its mean, ${spreadKindOf(entryFormatOf(openContent)).toUpperCase()}, and n directly. Graphs and the summary-compatible tests draw from those numbers.`
                                : "Column table. Each column is a treatment group, each row a replicate."}
                    </p>
                    {openContent.meta.table_type === "xy" ? (
                      <XYTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        onAddColumn={handleAddColumn}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : openContent.meta.table_type === "grouped" ? (
                      <GroupedTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        onAddColumn={handleAddColumn}
                        onRenameGroup={handleRenameGroup}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : openContent.meta.table_type === "survival" ? (
                      <SurvivalTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : openContent.meta.table_type === "contingency" ? (
                      <ContingencyTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        onAddColumn={handleAddColumn}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : openContent.meta.table_type === "nested" ? (
                      <NestedTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        onAddColumn={handleAddColumn}
                        onRenameGroup={handleRenameGroup}
                        onRenameSubgroup={handleRenameSubgroup}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : openContent.meta.table_type === "partsOfWhole" ? (
                      <PartsOfWholeTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    ) : (
                      <DataTableGrid
                        content={openContent}
                        onCellCommit={handleCellCommit}
                        onToggleExclusion={handleToggleExclusion}
                        onAddRow={handleAddRow}
                        onAddColumn={handleAddColumn}
                        onRenameSummaryGroup={handleRenameSummaryGroup}
                        crud={gridCrud}
                        hideAddControls
                        readOnly={!!derivedInfo}
                      />
                    )}

                    {/* The lineage-aware Code panel for a derived table, below
                        the grid. It rebuilds this table from its base table(s)
                        through every transform, the same transparency the
                        analysis + figure Code buttons give. */}
                    {showTableCode && derivedInfo ? (
                      <div className="mt-5" data-testid="datahub-table-code">
                        <CodePanel
                          code={tableChainCode}
                          caption="This rebuilds the table from its base table, loading the data and running every transform, so the result traces back to the raw numbers rather than a black box."
                          testId="datahub-table-code-panel"
                        />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-body text-foreground-muted">
              Loading…
            </div>
          )}
        </section>
      </div>

      <NewTableDialog
        open={newTableOpen}
        projects={projects}
        defaultCollectionId={dialogDefaultCollection}
        onCancel={() => setNewTableOpen(false)}
        onSubmit={handleNewTable}
      />

      <ImportTableDialog
        open={importOpen}
        projects={projects}
        defaultCollectionId={dialogDefaultCollection}
        onCancel={() => setImportOpen(false)}
        onSubmit={handleImport}
      />

      <NewAnalysisDialog
        open={newAnalysisOpen}
        content={openContent}
        onCancel={() => setNewAnalysisOpen(false)}
        onSubmit={handleNewAnalysis}
      />

      <GuidedAnalysisWizard
        open={guidedOpen}
        content={openContent}
        onCancel={() => setGuidedOpen(false)}
        onSubmit={handleGuidedAnalysis}
      />

      <NewGraphDialog
        open={newGraphOpen}
        content={openContent}
        onCancel={() => setNewGraphOpen(false)}
        onSubmit={handleNewGraph}
      />

      <PowerPlannerDialog
        open={powerPlannerOpen}
        onCancel={() => setPowerPlannerOpen(false)}
      />

      <TransformDialog
        open={transformOpen}
        content={transformSourceContent}
        sourceName={
          openContent?.meta.derivedFrom
            ? transformSourceContent?.meta.name ?? "Source"
            : selectedMeta?.name ?? "Table"
        }
        initialTransform={openContent?.meta.derivedFrom?.transform}
        initialParams={openContent?.meta.derivedFrom?.params}
        onCancel={() => setTransformOpen(false)}
        onSubmit={handleTransform}
      />
    </AppShell>
  );
}
