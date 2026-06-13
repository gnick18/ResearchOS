"use client";

// Markdown embed hybrid, Phase 4 (DataHub-largetables lane). The big-table
// DATASET preview embed.
//
// Loaded lazily by ObjectEmbed for a `[caption](/datahub?dataset=ID#ros=table)`
// embed. This is the SLIM preview of a large dataset, NOT the heavy DatasetView:
// no virtualization, no column manager, no jump-to-row, no full-render path. It
// opens the dataset into the lazy DuckDB engine, reads ONE capped window of rows
// (a handful of rows by a handful of columns), and renders a compact table. The
// full grid is never materialized here, an embed only ever shows a preview.
//
// SCOPE. This is a READ path. DuckDB only MOVES the preview window; no statistic
// is computed or altered. The active recipe (sidecar.recipe) is applied so the
// preview reflects the transformed slice, exactly like the live DatasetView.
//
// A missing dataset (deleted, not shared, no parquet) degrades to the calm
// UnavailableEmbedCard. A non-table view we do not render yet degrades to the
// generic ObjectEmbedCard.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { readDatasetSidecar } from "@/lib/datahub/bigtable/dataset-store";
import {
  openDataset,
  closeDataset,
  readRowWindow,
  countRows,
  formatPreviewCell,
  type OpenDatasetHandle,
} from "@/lib/datahub/bigtable/dataset-view";
import type { DatasetSidecar } from "@/lib/datahub/bigtable/types";
import type { ColumnDataType } from "@/lib/datahub/model/types";
import { objectDeepLink } from "@/lib/references";
import {
  ObjectEmbedCard,
  UnavailableEmbedCard,
  EmbedCaption,
  type EmbedRendererProps,
} from "./ObjectEmbed";

/** The default preview window, the same shape DataHubEmbed uses for the editable
 *  lane. An embed shows a glance, not the data. Overridable per embed via the
 *  fragment opts (rows / cols). */
const DEFAULT_ROWS = 6;
const DEFAULT_COLS = 6;

interface PreviewData {
  sidecar: DatasetSidecar;
  rows: Record<string, unknown>[];
  /** The column names shown (a capped slice of the dataset schema). */
  columns: string[];
  /** Live Arrow types for the shown columns, so a parsed date renders formatted. */
  columnTypes: Record<string, ColumnDataType>;
  /** The result row count (through the recipe when one is active). */
  totalRows: number;
  /** True when an active transform recipe shapes the preview. */
  transformed: boolean;
}

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; data: PreviewData };

export default function DatasetEmbed({
  descriptor,
  caption,
  figureLabel,
}: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  const maxRows = descriptor.opts.rows ?? DEFAULT_ROWS;
  const maxCols = descriptor.opts.cols ?? DEFAULT_COLS;

  useEffect(() => {
    let cancelled = false;
    let opened: OpenDatasetHandle | null = null;
    setState({ k: "loading" });

    void (async () => {
      try {
        const owner = await getCurrentUserCached();
        if (!owner) {
          if (!cancelled) setState({ k: "missing" });
          return;
        }
        const sidecar = await readDatasetSidecar(owner, descriptor.id);
        if (!sidecar) {
          if (!cancelled) setState({ k: "missing" });
          return;
        }
        const handle = await openDataset(owner, sidecar);
        if (cancelled) {
          await closeDataset(handle);
          return;
        }
        opened = handle;
        const columns = sidecar.schema.slice(0, maxCols).map((c) => c.name);
        const recipe = sidecar.recipe;
        const [window, total] = await Promise.all([
          readRowWindow(handle, 0, maxRows, columns, recipe),
          countRows(handle, recipe),
        ]);
        if (cancelled) return;
        setState({
          k: "ok",
          data: {
            sidecar,
            rows: window.rows,
            columns,
            columnTypes: window.columnTypes,
            totalRows: total,
            transformed: recipe.length > 0,
          },
        });
      } catch {
        if (!cancelled) setState({ k: "missing" });
      }
    })();

    return () => {
      cancelled = true;
      if (opened) void closeDataset(opened);
    };
  }, [descriptor.id, maxRows, maxCols]);

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  // Only the "table" view is rendered for a dataset embed. Any other view degrades
  // to the calm card rather than a misleading render.
  if (descriptor.view !== "table" && descriptor.view !== "chip") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const { sidecar, rows, columns, columnTypes, totalRows, transformed } = state.data;
  const title = sidecar.name || caption;
  const href = objectDeepLink("dataset", descriptor.id);
  const rowLabel = `${totalRows.toLocaleString()} ${totalRows === 1 ? "row" : "rows"}`;
  const hiddenCols = sidecar.colCount - columns.length;

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="shrink-0 text-meta text-foreground-muted">{rowLabel}</span>
        {transformed ? (
          <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-meta font-semibold text-foreground-muted">
            transformed
          </span>
        ) : null}
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open dataset ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <table className="w-full border-collapse text-meta">
          <thead>
            <tr>
              {columns.map((name) => (
                <th
                  key={name}
                  className="border border-border bg-surface-sunken px-2 py-1 text-left font-semibold text-foreground-muted"
                >
                  {name}
                </th>
              ))}
              {hiddenCols > 0 ? (
                <th className="border border-border bg-surface-sunken px-2 py-1 text-left font-semibold text-foreground-muted">
                  {`+ ${hiddenCols} more`}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((name) => (
                  <td key={name} className="border border-border px-2 py-1 text-foreground">
                    {formatPreviewCell(r[name], columnTypes[name] ?? "text")}
                  </td>
                ))}
                {hiddenCols > 0 ? (
                  <td className="border border-border px-2 py-1 text-foreground-muted" />
                ) : null}
              </tr>
            ))}
            {totalRows > rows.length ? (
              <tr>
                <td
                  colSpan={columns.length + (hiddenCols > 0 ? 1 : 0)}
                  className="border border-border px-2 py-1 text-center text-foreground-muted"
                >
                  {`+ ${(totalRows - rows.length).toLocaleString()} more rows`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <EmbedCaption caption={caption} name={sidecar.name} figureLabel={figureLabel} />
    </div>
  );
}
