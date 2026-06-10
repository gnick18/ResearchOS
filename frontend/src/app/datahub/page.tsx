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
  addColumn as addColumnToDoc,
  getDataHubContent,
  setCell,
} from "@/lib/loro/datahub-doc";
import {
  buildEmptyColumnTable,
  parseCellInput,
} from "@/lib/datahub/column-table";
import DataHubRail, { type Collection } from "@/components/datahub/DataHubRail";
import DataTableGrid from "@/components/datahub/DataTableGrid";
import NewTableDialog, {
  type NewTableSubmit,
} from "@/components/datahub/NewTableDialog";

export default function DataHubPage() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  const [collection, setCollection] = useState<Collection>("all");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [newTableOpen, setNewTableOpen] = useState(false);

  // The live projection of the open document's Loro doc. Cell edits write to the
  // doc, then reproject into this state so the grid + footer re-derive. Null
  // until a table is opened.
  const [openContent, setOpenContent] = useState<DataHubDocContent | null>(null);
  const handleRef = useRef<DataHubDocHandle | null>(null);
  const openIdRef = useRef<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-datahub"],
    queryFn: () => projectsApi.list(),
    enabled: DATAHUB_ENABLED,
  });

  const { data: allTables = [] } = useQuery({
    queryKey: ["datahub", "tables"],
    queryFn: () => dataHubApi.list(),
    enabled: DATAHUB_ENABLED,
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

  // Keep a valid selection: default to the first visible table.
  useEffect(() => {
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
  }, [tablesInCollection, selectedTableId]);

  // Open (or switch) the Loro doc for the selected table and project its content.
  // Subscribing reprojects on any doc change (a local edit's commit, or a later
  // collaborator's op), so the grid + footer always reflect the doc. The prior
  // handle is closed (which flushes its pending commit) before opening the next.
  useEffect(() => {
    if (!DATAHUB_ENABLED || !currentUser || selectedTableId == null) {
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
  }, [currentUser, selectedTableId]);

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

  // Append a new group column (a "y" numeric column), then backfill a null cell
  // for it on every existing row so the grid reads cleanly.
  const handleAddColumn = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !openContent || openIdRef.current == null) return;
    const groupCount = openContent.columns.filter(
      (c) => c.role === "y" || c.role === "group",
    ).length;
    const colId = `col-${Date.now()}`;
    addColumnToDoc(handle.doc, {
      id: colId,
      name: `Group ${groupCount + 1}`,
      role: "y",
      dataType: "number",
    });
    for (const row of openContent.rows) {
      setCell(handle.doc, row.id, colId, null);
    }
    void handle.commit();
    setOpenContent(getDataHubContent(handle.doc, openIdRef.current));
  }, [openContent]);

  // Create a new Column table (seeded empty), refresh the catalog, and open it.
  const handleNewTable = useCallback(
    async (data: NewTableSubmit) => {
      setNewTableOpen(false);
      const seed =
        data.tableType === "column"
          ? buildEmptyColumnTable()
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

  // The active collection as the New-table dialog's default ("" for All/Unfiled).
  const dialogDefaultCollection =
    collection === "all" || collection === "unfiled" ? "" : collection;

  const selectedMeta = useMemo(
    () => allTables.find((t) => t.id === selectedTableId) ?? null,
    [allTables, selectedTableId],
  );

  // Gate: render a calm "not enabled" state when the flag is off (mirror the
  // /supplies gate). Never crash.
  if (!DATAHUB_ENABLED) {
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
          counts={counts}
        />

        <section className="flex min-w-0 flex-1 flex-col overflow-auto rounded-lg border border-border bg-surface-raised p-5">
          {tablesInCollection.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <h1 className="text-heading font-semibold text-foreground">
                No data tables yet
              </h1>
              <p className="max-w-sm text-body text-foreground-muted">
                A data table holds your raw replicates. The summary and any graph
                read from it live, so you enter the numbers once.
              </p>
              <button
                type="button"
                onClick={() => setNewTableOpen(true)}
                className="btn-brand rounded-md px-4 py-2 text-body font-medium"
              >
                New table
              </button>
            </div>
          ) : selectedMeta && openContent ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <h1 className="text-title font-semibold text-foreground">
                  {selectedMeta.name}
                </h1>
              </div>
              <p className="mb-4 text-meta text-foreground-muted">
                Column table. Each column is a treatment group, each row a
                replicate.
              </p>
              <DataTableGrid
                content={openContent}
                onCellCommit={handleCellCommit}
                onAddRow={handleAddRow}
                onAddColumn={handleAddColumn}
              />
            </>
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
    </AppShell>
  );
}
