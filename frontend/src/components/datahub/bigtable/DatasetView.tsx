"use client";

// DatasetView (DataHub-largetables lane, Increment 2).
//
// The read surface for one large dataset (mockup changes 1, 2, 3, 6; spec
// sections 5, 7). It opens the dataset into the lazy DuckDB engine, renders a
// VIRTUALIZED grid that pages rows from the engine on scroll (only the visible
// window is ever in the DOM), and surfaces the one-time explainer, the persistent
// status chip, the wide-column manager (three tiers), a jump-to-row box, and the
// no-soft-lock full-render warning.
//
// The validation gate holds: every query here only MOVES data (slice, page,
// project columns). No statistic is computed for the user.
//
// House style: <Icon> only, Tooltip component, no emojis / em-dashes /
// mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "@/components/icons";
import type { DatasetSidecar } from "@/lib/datahub/bigtable";
import {
  openDataset,
  closeDataset,
  readRowWindow,
  type OpenDatasetHandle,
} from "@/lib/datahub/bigtable/dataset-view";
import { columnTier } from "@/lib/datahub/bigtable/column-tiers";
import {
  isExplainerDismissed,
  dismissExplainer,
} from "@/lib/datahub/bigtable/explainer-dismissal";
import DatasetExplainerCard from "./DatasetExplainerCard";
import DatasetStatusChip from "./DatasetStatusChip";
import ColumnManager from "./ColumnManager";
import FullRenderWarning from "./FullRenderWarning";
import DatasetAnalysisDialog from "./DatasetAnalysisDialog";
import DatasetPlotDialog from "./DatasetPlotDialog";
import Tooltip from "@/components/Tooltip";
import { isBigTableEnabled } from "@/lib/datahub/config";

/** How many rows to fetch per engine page. The grid windows the DOM; this is the
 *  network-equivalent batch the engine returns per LIMIT/OFFSET call. */
const PAGE_SIZE = 200;
/** Up-front preview size quoted in the chip / explainer ("100 of TOTAL"). */
const PREVIEW_ROWS = 100;
/** Fixed row height for the virtualizer estimate (tabular-nums, one line). */
const ROW_HEIGHT = 28;

type RowCache = Map<number, Record<string, unknown>>;

export default function DatasetView({
  owner,
  sidecar,
  onOpenTransform,
}: {
  owner: string;
  sidecar: DatasetSidecar;
  /** Open the transform builder for this dataset (Phase 2a). */
  onOpenTransform?: () => void;
}) {
  const totalRows = sidecar.rowCount;
  const allColumnNames = useMemo(
    () => sidecar.schema.map((c) => c.name),
    [sidecar.schema],
  );
  const tier = columnTier(sidecar.colCount);

  // Selected columns to project. Tier A / B default to all columns (capped for A
  // chips by the schema itself); Tier C starts EMPTY, so no grid renders until
  // the user picks columns by rule (spec section 5).
  const [selected, setSelected] = useState<string[]>(
    tier === "c" ? [] : allColumnNames,
  );
  const visibleColumns = selected.length > 0 ? selected : allColumnNames;
  // Tier C with no selection shows no grid by default.
  const showGrid = tier !== "c" || selected.length > 0;

  const [handle, setHandle] = useState<OpenDatasetHandle | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showFullRender, setShowFullRender] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  // The analysis + graph entry points stay behind the lane flag, like every other
  // surface in this lane. Both run through the validated engine / plot path.
  const analyzeEnabled = isBigTableEnabled();

  const rowCacheRef = useRef<RowCache>(new Map());
  const pendingPagesRef = useRef<Set<number>>(new Set());
  const [, forceTick] = useState(0);
  const rerender = useCallback(() => forceTick((t) => t + 1), []);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Open the dataset into DuckDB once per (owner, id). Resets caches on a
  // dataset switch. Closes (drops the registered buffer) on unmount / switch.
  useEffect(() => {
    let cancelled = false;
    let opened: OpenDatasetHandle | null = null;
    setHandle(null);
    setOpenError(null);
    rowCacheRef.current = new Map();
    pendingPagesRef.current = new Set();
    setShowExplainer(!isExplainerDismissed(sidecar.id));
    setShowFullRender(false);
    setSelected(columnTier(sidecar.colCount) === "c" ? [] : sidecar.schema.map((c) => c.name));

    void (async () => {
      try {
        const h = await openDataset(owner, sidecar);
        if (cancelled) {
          await closeDataset(h);
          return;
        }
        opened = h;
        setHandle(h);
      } catch (e) {
        if (!cancelled) {
          setOpenError(
            e instanceof Error ? e.message : "Could not open this dataset.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (opened) void closeDataset(opened);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, sidecar.id]);

  // Fetch one engine page (PAGE_SIZE rows from a page-aligned offset), caching
  // each row by absolute index. De-duped via pendingPagesRef so a fast scroll
  // never fires the same page twice.
  const fetchPage = useCallback(
    async (page: number) => {
      if (!handle) return;
      if (pendingPagesRef.current.has(page)) return;
      // Already fully cached?
      const start = page * PAGE_SIZE;
      if (rowCacheRef.current.has(start)) return;
      pendingPagesRef.current.add(page);
      try {
        const rows = await readRowWindow(
          handle,
          start,
          PAGE_SIZE,
          visibleColumns,
        );
        rows.forEach((r, i) => rowCacheRef.current.set(start + i, r));
        rerender();
      } catch {
        // A failed page leaves those rows as placeholders; scrolling retries.
      } finally {
        pendingPagesRef.current.delete(page);
      }
    },
    [handle, visibleColumns, rerender],
  );

  // When the column projection changes, the cached row objects are keyed to the
  // old projection, so clear them and refetch the visible window.
  useEffect(() => {
    rowCacheRef.current = new Map();
    pendingPagesRef.current = new Set();
    if (handle) void fetchPage(0);
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumns.join("\u0000"), handle]);

  const virtualizer = useVirtualizer({
    count: showGrid ? totalRows : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Fetch the pages covering the currently visible virtual rows.
  useEffect(() => {
    if (!handle || !showGrid) return;
    const pages = new Set<number>();
    for (const item of virtualItems) {
      pages.add(Math.floor(item.index / PAGE_SIZE));
    }
    pages.forEach((p) => void fetchPage(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualItems, handle, showGrid, fetchPage]);

  const dismiss = () => {
    dismissExplainer(sidecar.id);
    setShowExplainer(false);
  };

  const jumpToRow = () => {
    const n = parseInt(jumpValue, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(Math.max(1, n), totalRows);
    virtualizer.scrollToIndex(clamped - 1, { align: "start" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="bigtable-dataset-view">
      {/* Header: name + status chip */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-foreground">
          {sidecar.name}
        </h1>
        <DatasetStatusChip
          previewRows={Math.min(PREVIEW_ROWS, totalRows)}
          totalRows={totalRows}
          onReopen={() => setShowExplainer(true)}
        />
        {analyzeEnabled && (
          <Tooltip
            label={
              handle === null
                ? "The dataset is still opening"
                : "Run a statistical analysis on this dataset"
            }
          >
            <button
              type="button"
              onClick={() => setShowAnalyze(true)}
              disabled={handle === null}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
              data-testid="bigtable-open-analyze"
            >
              <Icon name="results" className="h-3.5 w-3.5" />
              Analyze
            </button>
          </Tooltip>
        )}
        {analyzeEnabled && (
          <Tooltip
            label={
              handle === null
                ? "The dataset is still opening"
                : "Draw a figure from this dataset"
            }
          >
            <button
              type="button"
              onClick={() => setShowGraph(true)}
              disabled={handle === null}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
              data-testid="bigtable-open-graph"
            >
              <Icon name="chart" className="h-3.5 w-3.5" />
              Graph
            </button>
          </Tooltip>
        )}
        {onOpenTransform && (
          <button
            type="button"
            onClick={onOpenTransform}
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken ${
              analyzeEnabled ? "" : "ml-auto"
            }`}
            data-testid="bigtable-open-transform"
          >
            <Icon name="transform" className="h-3.5 w-3.5" />
            Transform
          </button>
        )}
        <span
          className={`text-meta text-foreground-muted ${
            onOpenTransform || analyzeEnabled ? "" : "ml-auto"
          }`}
        >
          {totalRows.toLocaleString()} rows by {sidecar.colCount.toLocaleString()}{" "}
          columns
        </span>
      </div>

      {showExplainer && (
        <DatasetExplainerCard
          name={sidecar.name}
          rowCount={totalRows}
          colCount={sidecar.colCount}
          previewRows={Math.min(PREVIEW_ROWS, totalRows)}
          onDismiss={dismiss}
        />
      )}

      {/* Wide-column manager (tier-driven) */}
      <ColumnManager
        columns={sidecar.schema}
        rowCount={totalRows}
        selected={selected}
        onChange={setSelected}
      />

      {/* Jump-to-row + render-all control */}
      {showGrid && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-meta text-foreground-muted">
            <Icon name="search" className="h-3.5 w-3.5" />
            Jump to row
          </label>
          <input
            type="number"
            min={1}
            max={totalRows}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToRow();
            }}
            placeholder="1"
            className="w-24 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
            data-testid="bigtable-jump-input"
          />
          <button
            type="button"
            onClick={jumpToRow}
            className="rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            data-testid="bigtable-jump-go"
          >
            Go
          </button>
          <button
            type="button"
            onClick={() => setShowFullRender(true)}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            data-testid="bigtable-render-all"
          >
            Render all rows
          </button>
        </div>
      )}

      {showFullRender && (
        <FullRenderWarning
          totalRows={totalRows}
          onKeepPreviewing={() => setShowFullRender(false)}
        />
      )}

      {/* The grid */}
      {openError ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4 text-meta text-foreground">
          This dataset could not be opened. {openError}
        </div>
      ) : !showGrid ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border text-center text-meta text-foreground-muted">
          Pick columns by rule above to preview them. No grid is drawn for a
          dataset this wide until you choose.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
          {/* Sticky header row */}
          <div className="flex border-b border-border bg-surface-sunken text-meta font-semibold text-foreground">
            <div className="w-16 flex-none border-r border-border-soft px-2 py-1 text-right text-foreground-muted">
              #
            </div>
            <div className="flex min-w-0 flex-1 overflow-hidden">
              {visibleColumns.map((name) => (
                <div
                  key={name}
                  className="min-w-[96px] flex-1 truncate border-r border-border-soft px-2 py-1 text-right"
                  title={name}
                >
                  {name}
                </div>
              ))}
            </div>
          </div>
          {/* Virtualized body */}
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-auto"
            data-testid="bigtable-grid-scroll"
          >
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
            >
              {virtualItems.map((item) => {
                const row = rowCacheRef.current.get(item.index);
                return (
                  <div
                    key={item.key}
                    className="flex items-stretch text-meta tabular-nums hover:bg-surface-sunken"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${item.size}px`,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <div className="w-16 flex-none border-b border-r border-border-soft px-2 py-1 text-right text-foreground-muted">
                      {item.index + 1}
                    </div>
                    <div className="flex min-w-0 flex-1 overflow-hidden">
                      {visibleColumns.map((name) => {
                        const v = row ? row[name] : undefined;
                        return (
                          <div
                            key={name}
                            className="min-w-[96px] flex-1 truncate border-b border-r border-border-soft px-2 py-1 text-right text-foreground"
                          >
                            {row === undefined
                              ? ""
                              : v === null || v === undefined
                                ? ""
                                : String(v)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {analyzeEnabled && (
        <DatasetAnalysisDialog
          open={showAnalyze}
          owner={owner}
          sidecar={sidecar}
          handle={handle}
          onClose={() => setShowAnalyze(false)}
        />
      )}

      {analyzeEnabled && (
        <DatasetPlotDialog
          open={showGraph}
          owner={owner}
          sidecar={sidecar}
          handle={handle}
          onClose={() => setShowGraph(false)}
        />
      )}
    </div>
  );
}
