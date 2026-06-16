"use client";

// Public lab companion-site LIVE dataset viewer (lab-domains Phase 4a, social
// lane).
//
// Renders a hosted dataset (Parquet on R2) as a READ-ONLY interactive table for a
// PUBLIC, login-free reader. The reader has no account and no local workspace, so
// the dataset is fetched from the same-origin read endpoint (which streams it from
// R2), registered into the lazy DuckDB-WASM engine, and paged with LIMIT / OFFSET,
// exactly the data-mover surface the Data Hub preview grid uses. No statistic is
// computed; this only MOVES rows out for display (the validation-gate scope rule).
//
// FALLBACK (graceful degradation, the whole point of keeping the baked snapshot):
//   - while loading        a calm skeleton.
//   - asset gone / fetch
//     fails / DuckDB fails  fall back to the Phase 3b BAKED snapshot (a frozen
//                           PNG / table) when one was passed, else the calm
//                           "content unavailable" card.
// So a hosted asset is a pure UPGRADE: when R2 is reachable the reader gets the
// live explorer, and when it is not they see exactly the static table Phase 3b
// produced, never a crash or a blank.
//
// DuckDB is client-only and loads ~38 MB of wasm lazily on first open, so this
// component pays nothing until it mounts on a page that actually has a live asset.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";

import BakedEmbedView from "@/components/embeds/BakedEmbedView";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { EmbedDescriptor } from "@/lib/references";
import type { HostedAssetEntry } from "@/lib/social/lab-site-hosted";

/** How many rows the viewer pages at a time. */
const PAGE_SIZE = 50;

type ViewState =
  | { k: "loading" }
  | { k: "ready" }
  | { k: "error" };

/**
 * Quote a SQL identifier by doubling embedded double quotes (the column names come
 * from a user header, so they may contain spaces / punctuation). Identifier
 * quoting only; no values flow through here (the viewer is read-only and never
 * interpolates a value).
 */
function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export default function PublicDatasetEmbed({
  asset,
  baked,
  caption,
  descriptor,
}: {
  /** The hosted asset to render live (read URL + schema). */
  asset: HostedAssetEntry;
  /** The Phase 3b baked snapshot to fall back to if the live load fails. */
  baked: BakedEmbed | null;
  caption: string;
  descriptor: EmbedDescriptor;
}) {
  const [state, setState] = useState<ViewState>({ k: "loading" });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>(asset.columns ?? []);
  const [offset, setOffset] = useState(0);
  // The registered DuckDB virtual-file name for this asset (per-mount unique so a
  // remount never drops the new mount's buffer).
  const fileNameRef = useRef<string | null>(null);

  // Load the Parquet bytes from the same-origin read endpoint and register them in
  // the engine. On ANY failure (network, 404, DuckDB, non-browser) -> error state,
  // which renders the baked fallback.
  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    (async () => {
      try {
        // Dynamically import the client-only DuckDB engine so it never enters the
        // server bundle and only loads when a live asset actually mounts.
        const { init, registerParquetBuffer } = await import(
          "@/lib/datahub/bigtable/duckdb-client"
        );
        const res = await fetch(asset.readUrl);
        if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        await init();
        const fileName = `labsite_${asset.assetId}_${Date.now()}.parquet`;
        await registerParquetBuffer(fileName, buffer);
        if (cancelled) return;
        fileNameRef.current = fileName;
        setState({ k: "ready" });
        setOffset(0);
      } catch {
        if (!cancelled) setState({ k: "error" });
      }
    })();
    return () => {
      cancelled = true;
      // Best-effort drop of the registered buffer on unmount.
      const name = fileNameRef.current;
      if (name) {
        void import("@/lib/datahub/bigtable/duckdb-client")
          .then(({ dropFileBuffer }) => dropFileBuffer(name))
          .catch(() => {});
        fileNameRef.current = null;
      }
    };
  }, [asset.readUrl, asset.assetId]);

  // Read one page once the buffer is registered, and on page change.
  const loadPage = useCallback(
    async (pageOffset: number) => {
      const name = fileNameRef.current;
      if (!name) return;
      try {
        const { query } = await import("@/lib/datahub/bigtable/duckdb-client");
        const table = await query(
          `SELECT * FROM read_parquet('${name}') LIMIT ${PAGE_SIZE} OFFSET ${Math.max(
            0,
            Math.floor(pageOffset),
          )}`,
        );
        const pageRows = table
          .toArray()
          .map((r) => ({ ...(r as Record<string, unknown>) }));
        const cols = table.schema.fields.map((f) => f.name);
        setRows(pageRows);
        if (cols.length > 0) setColumns(cols);
      } catch {
        setState({ k: "error" });
      }
    },
    [],
  );

  useEffect(() => {
    if (state.k === "ready") void loadPage(offset);
  }, [state.k, offset, loadPage]);

  // ── Fallback render: baked snapshot, else unavailable card ──────────────────
  if (state.k === "error") {
    if (baked) {
      return (
        <BakedEmbedView snapshot={baked} caption={caption} descriptor={descriptor} />
      );
    }
    return (
      <BakedEmbedView
        snapshot={{ kind: "missing", name: caption || descriptor.id, label: null }}
        caption={caption}
        descriptor={descriptor}
      />
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (state.k === "loading") {
    return (
      <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="flex items-center gap-3 px-4 py-6">
          <span className="text-meta text-foreground-muted">
            Loading interactive dataset...
          </span>
        </div>
      </figure>
    );
  }

  // ── Live read-only table explorer ───────────────────────────────────────────
  const showingFrom = rows.length === 0 ? 0 : offset + 1;
  const showingTo = offset + rows.length;
  return (
    <figure
      className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised"
      data-public-dataset-embed="true"
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-meta font-semibold text-foreground-muted">
          {caption || "Dataset"}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-meta text-foreground-muted">
          {asset.rowCount.toLocaleString()} rows
        </span>
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse text-meta">
          <thead className="sticky top-0 bg-surface-sunken">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={`${col}-${i}`}
                  className="border-b border-border px-3 py-1.5 text-left font-semibold text-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="odd:bg-surface-raised even:bg-surface">
                {columns.map((col, c) => (
                  <td
                    key={`${r}-${c}`}
                    className="border-b border-border px-3 py-1 text-foreground-muted"
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          className="rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-meta text-foreground-muted">
          {showingFrom.toLocaleString()}-{showingTo.toLocaleString()} of{" "}
          {asset.rowCount.toLocaleString()}
        </span>
        <button
          type="button"
          disabled={offset + PAGE_SIZE >= asset.rowCount}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Next
        </button>
        <span className="flex-1" />
        <span className="shrink-0 text-meta text-foreground-muted">Live</span>
      </div>
    </figure>
  );
}

/** Format one cell value for display. BigInt -> string; null/undefined -> empty;
 *  everything else -> String(). Cosmetic only; never alters a stored value. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  return String(value);
}
