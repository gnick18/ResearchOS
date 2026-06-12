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
import { DATAHUB_ENABLED } from "@/lib/datahub/config";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import { dataHubApi } from "@/lib/datahub/api";
import { projectsApi } from "@/lib/local-api";
import type {
  CellValue,
  DataHubDocContent,
  DataHubDocument,
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
  setPlot as setPlotInDoc,
  setCell,
} from "@/lib/loro/datahub-doc";
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
import { buildEmptyXYTable, yColumns } from "@/lib/datahub/xy-table";
import {
  buildEmptyGroupedTable,
  groupDatasets,
  DEFAULT_GROUPED_REPLICATES,
} from "@/lib/datahub/grouped-table";
import { buildEmptySurvivalTable } from "@/lib/datahub/survival-table";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import {
  buildPlotSpec,
  withStyle,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import DataHubRail, { type Collection } from "@/components/datahub/DataHubRail";
import DataTableGrid from "@/components/datahub/DataTableGrid";
import XYTableGrid from "@/components/datahub/XYTableGrid";
import GroupedTableGrid from "@/components/datahub/GroupedTableGrid";
import SurvivalTableGrid from "@/components/datahub/SurvivalTableGrid";
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
  // Transient "copied" flash for the Copy reference button.
  const [refCopied, setRefCopied] = useState(false);
  // Inline delete confirm for the table toolbar (no soft-lock: a Cancel is always
  // reachable). Holds the id pending deletion, or null when nothing is pending.
  const [confirmDeleteTableId, setConfirmDeleteTableId] = useState<string | null>(
    null,
  );

  // The live projection of the open document's Loro doc. Cell edits write to the
  // doc, then reproject into this state so the grid + footer re-derive. Null
  // until a table is opened.
  const [openContent, setOpenContent] = useState<DataHubDocContent | null>(null);
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
        setOpenContent(getDataHubContent(handle.doc, id));
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

  // Persist one cell edit: write the parsed value to the doc, commit (debounced),
  // and reproject immediately so the footer recomputes without waiting for the
  // commit round-trip.
  const handleCellCommit = useCallback(
    (rowId: string, columnId: string, raw: string) => {
      const handle = handleRef.current;
      if (!handle || openIdRef.current == null) return;
      const value: CellValue = parseCellInput(raw);
      setCell(handle.doc, rowId, columnId, value);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
    },
    [],
  );

  // Append a blank replicate row across the existing columns.
  const handleAddRow = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !openContent || openIdRef.current == null) return;
    const cells: Record<string, CellValue> = {};
    for (const col of openContent.columns) cells[col.id] = null;
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

  // Rename a column group on a Grouped table: every replicate column in the
  // group shares the group name, so a rename writes the new name to each of
  // them. Reprojects so the header and any two-way ANOVA pick up the new name.
  const handleRenameGroup = useCallback(
    (datasetId: string, name: string) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const trimmed = name.trim();
      if (trimmed === "") return;
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
    }),
    [
      handleDeleteRow,
      handleInsertRowAt,
      handleDeleteColumn,
      handleRenameColumn,
      handleDuplicateColumn,
      handleInsertColumnAt,
    ],
  );

  // Create a new Column table (seeded empty), refresh the catalog, and open it.
  const handleNewTable = useCallback(
    async (data: NewTableSubmit) => {
      setNewTableOpen(false);
      const seed =
        data.tableType === "column"
          ? buildEmptyColumnTable()
          : data.tableType === "xy"
            ? buildEmptyXYTable()
            : data.tableType === "grouped"
              ? buildEmptyGroupedTable()
              : data.tableType === "survival"
                ? buildEmptySurvivalTable()
                : { columns: [], rows: [] };
      const created = await dataHubApi.create({
        name: data.name,
        table_type: data.tableType,
        project_ids: data.collectionId ? [data.collectionId] : [],
        columns: seed.columns,
        rows: seed.rows,
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
    [collection, queryClient],
  );

  // Create + run an analysis: dispatch the chosen type + columns to the engine,
  // store the spec plus its cached normalized result in the Loro doc (so it is
  // version-controlled and re-runs), commit, reproject, and select it. Shared by
  // the New analysis dialog and the guided wizard, which both produce the same
  // { type, columnIds } shape, so a guided run is indistinguishable from a manual
  // one once it lands.
  const createAnalysis = useCallback(
    (data: { type: string; columnIds: string[] }) => {
      const handle = handleRef.current;
      if (!handle || !openContent || openIdRef.current == null) return;
      const id = `analysis-${Date.now()}`;
      const spec = {
        id,
        type: data.type,
        params: {},
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

  // Export the open table as a CSV download. Built from the live document
  // content (columns + rows), so it reflects the latest edits without a re-open.
  const handleExportTable = useCallback(() => {
    if (!openContent || !selectedMeta) return;
    downloadCsv(openContent, selectedMeta.name);
  }, [openContent, selectedMeta]);

  // Duplicate the open table, its analyses, and its graphs into a fresh document
  // ("<name> copy"), via the same create path New table uses, then open it. The
  // duplicate carries the source table's collection + folder so it lands beside
  // the original. Analyses keep their cached results, so the copy opens ready.
  const handleDuplicateTable = useCallback(async () => {
    if (!openContent || !selectedMeta) return;
    const created = await dataHubApi.create({
      name: `${selectedMeta.name} copy`,
      table_type: openContent.meta.table_type,
      project_ids: selectedMeta.project_ids,
      folder_path: selectedMeta.folder_path,
      columns: openContent.columns,
      rows: openContent.rows,
      analyses: openContent.analyses,
      plots: openContent.plots,
    });
    await queryClient.invalidateQueries({ queryKey: ["datahub", "tables"] });
    setSelectedTableId(created.id);
  }, [openContent, selectedMeta, queryClient]);

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
      const spec = buildPlotSpec({
        id,
        kind: data.kind,
        tableId: openIdRef.current,
        analysisId: data.analysisId,
        yColumnId: data.yColumnId ?? null,
        fitModel: data.fitModel,
        yTitle: isXY
          ? yName ?? selectedMeta?.name ?? "Y"
          : isSurvival
            ? "Survival"
            : selectedMeta?.name ?? "Value",
        xTitle: isXY ? "X" : isSurvival ? "Time" : undefined,
      });
      setPlotInDoc(handle.doc, spec);
      void handle.commit();
      setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
      setSelectedAnalysisId(null);
      setSelectedPlotId(id);
    },
    [openContent, selectedMeta],
  );

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
    const addColumnLabel =
      type === "xy" ? "Add Y column" : type === "grouped" ? "Add group" : "Add group";

    const addGroup: ToolbarGroup = [
      {
        icon: "plus",
        label: type === "survival" ? "Add subject" : "Add row",
        onClick: handleAddRow,
        testId: "datahub-toolbar-add-row",
      },
    ];
    if (type !== "survival") {
      addGroup.push({
        icon: "plus",
        label: addColumnLabel,
        onClick: handleAddColumn,
        testId: "datahub-toolbar-add-column",
      });
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
      ],
      addGroup,
      [
        {
          icon: "cloning",
          label: "Duplicate",
          onClick: handleDuplicateTable,
          tooltip: "Copy this table with its analyses and graphs.",
          testId: "datahub-toolbar-duplicate",
        },
        {
          icon: "download",
          label: "Export",
          onClick: handleExportTable,
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
          onSelectTable={setSelectedTableId}
          onNewTable={() => setNewTableOpen(true)}
          onNewFolder={() => setNewTableOpen(true)}
          onImport={() => setImportOpen(true)}
          counts={counts}
          analyses={openContent?.analyses ?? []}
          selectedAnalysisId={selectedAnalysisId}
          onSelectAnalysis={(id) => { setSelectedPlotId(null); setSelectedAnalysisId(id); }}
          onNewAnalysis={() => setNewAnalysisOpen(true)}
          onGuidedAnalysis={() => setGuidedOpen(true)}
          analysesEnabled={!!openContent}
          plots={openContent?.plots ?? []}
          selectedPlotId={selectedPlotId}
          onSelectPlot={(id) => {
            setSelectedAnalysisId(null);
            setSelectedPlotId(id);
          }}
          onNewGraph={() => setNewGraphOpen(true)}
          graphsEnabled={!!openContent}
        />

        <section
          className={`flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface-raised ${
            selectedMeta && openContent
              ? "overflow-hidden"
              : "overflow-auto p-5"
          }`}
        >
          {tablesInCollection.length === 0 ? (
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
                  className="btn-brand rounded-md px-4 py-2 text-body font-medium"
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
            />
          ) : selectedMeta && openContent && selectedAnalysis ? (
            <ResultsSheet
              spec={selectedAnalysis}
              content={openContent}
              title={selectedMeta.name}
              onNewAnalysis={() => setNewAnalysisOpen(true)}
              onGraphResult={() => setNewGraphOpen(true)}
              onChangeAnalysis={() => setNewAnalysisOpen(true)}
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
              </div>

              <WorkspaceToolbar testId="datahub-table-toolbar" groups={tableToolbarGroups} />

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
                <p className="mb-4 text-meta text-foreground-muted">
                  {openContent.meta.table_type === "xy"
                    ? "XY table. The first column is the X value, each following column is a measured Y, one observation per row."
                    : openContent.meta.table_type === "grouped"
                      ? "Grouped table. Each row is a category and each column group is a second factor, with replicate subcolumns for a two-way ANOVA."
                      : openContent.meta.table_type === "survival"
                        ? "Survival table. Each row is a subject with a time, an event indicator (1 or 0), and an optional group for Kaplan-Meier and the log-rank test."
                        : "Column table. Each column is a treatment group, each row a replicate."}
                </p>
                {openContent.meta.table_type === "xy" ? (
                  <XYTableGrid
                    content={openContent}
                    onCellCommit={handleCellCommit}
                    onAddRow={handleAddRow}
                    onAddColumn={handleAddColumn}
                    hideAddControls
                  />
                ) : openContent.meta.table_type === "grouped" ? (
                  <GroupedTableGrid
                    content={openContent}
                    onCellCommit={handleCellCommit}
                    onAddRow={handleAddRow}
                    onAddColumn={handleAddColumn}
                    onRenameGroup={handleRenameGroup}
                    hideAddControls
                  />
                ) : openContent.meta.table_type === "survival" ? (
                  <SurvivalTableGrid
                    content={openContent}
                    onCellCommit={handleCellCommit}
                    onAddRow={handleAddRow}
                    hideAddControls
                  />
                ) : (
                  <DataTableGrid
                    content={openContent}
                    onCellCommit={handleCellCommit}
                    onAddRow={handleAddRow}
                    onAddColumn={handleAddColumn}
                    crud={gridCrud}
                    hideAddControls
                  />
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
    </AppShell>
  );
}
