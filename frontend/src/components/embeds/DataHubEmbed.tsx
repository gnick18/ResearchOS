"use client";

// Markdown embed hybrid, Phase 1. The Data Hub table block-embed renderer.
//
// Loaded lazily by ObjectEmbed for a `[caption](/datahub?doc=ID#ros=table)`
// embed. Reads the document's content (columns + rows) with a plain effect and
// renders a compact preview of the grid. A missing doc, or a non-table view we
// do not render yet (plot / result), degrades to the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { dataHubApi } from "@/lib/datahub/api";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { objectDeepLink } from "@/lib/references";
import { ObjectEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; content: DataHubDocContent };

/** Render a cell value as plain text. Table cells are scalars (string / number /
 *  null), so String() is safe; null / undefined show as empty. */
function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export default function DataHubEmbed({ descriptor, caption }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    dataHubApi
      .getContent(descriptor.id)
      .then((c) => {
        if (cancelled) return;
        setState(c ? { k: "ok", content: c } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [descriptor.id]);

  // Plot / result views need their own renderers (a later phase); until then they
  // show the calm card rather than a misleading raw table.
  const tableView = descriptor.view === "table" || descriptor.view === "summary";

  if (state.k !== "ok" || !tableView) {
    return (
      <ObjectEmbedCard descriptor={descriptor} caption={caption} loading={state.k === "loading"} />
    );
  }

  const { columns, rows } = state.content;
  const maxRows = descriptor.opts.rows ?? 6;
  const maxCols = descriptor.opts.cols ?? 6;
  const showCols = columns.slice(0, maxCols);
  const showRows = rows.slice(0, maxRows);
  const title = caption || state.content.meta.name;
  const href = objectDeepLink("datahub", descriptor.id);
  const dims = `${rows.length} ${rows.length === 1 ? "row" : "rows"} × ${columns.length} ${columns.length === 1 ? "col" : "cols"}`;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="shrink-0 text-meta text-foreground-muted">{dims}</span>
        <span className="flex-1" />
        <a
          href={href}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          Open
        </a>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <table className="w-full border-collapse text-meta">
          <thead>
            <tr>
              {showCols.map((c) => (
                <th
                  key={c.id}
                  className="border border-border bg-surface-sunken px-2 py-1 text-left font-semibold text-foreground-muted"
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showRows.map((r) => (
              <tr key={r.id}>
                {showCols.map((c) => (
                  <td key={c.id} className="border border-border px-2 py-1 text-foreground">
                    {cellText(r.cells[c.id])}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length > showRows.length ? (
              <tr>
                <td
                  colSpan={showCols.length}
                  className="border border-border px-2 py-1 text-center text-foreground-muted"
                >
                  {`+ ${rows.length - showRows.length} more rows`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
