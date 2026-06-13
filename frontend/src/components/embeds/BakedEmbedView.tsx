"use client";

// Markdown embed hybrid, Phase 7 (P7-1a). The frozen-snapshot renderer.
//
// Renders a BakedEmbed (the same frozen shape the PDF export bakes) inline in the
// document, so a PINNED embed shows exactly what it looked like on the day it was
// pinned instead of re-rendering live. One small component per BakedEmbed kind:
//   image   -> <img src={dataUrl}> with the caption as alt
//   table   -> a calm bordered table
//   text    -> the frozen text body
//   card    -> a quiet title / subtitle / meta card
//   missing -> the shared UnavailableEmbedCard
//
// No inline svg (icon guard), no emoji, calm muted styling that matches the live
// embeds. The "frozen <date>" badge is rendered by ObjectEmbed around this view,
// not here, so this stays a pure snapshot renderer.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { EmbedDescriptor } from "@/lib/references";
import { UnavailableEmbedCard } from "./ObjectEmbed";

export interface BakedEmbedViewProps {
  snapshot: BakedEmbed;
  /** The embed's caption (link text), used as alt text / card title fallback. */
  caption: string;
  /** Only needed for the missing fallback, which reuses UnavailableEmbedCard. */
  descriptor: EmbedDescriptor;
}

/** Render a frozen BakedEmbed inline. Pure, data-only, never loads anything (the
 *  whole point of a pin is that the data is already frozen on disk). */
export default function BakedEmbedView({
  snapshot,
  caption,
  descriptor,
}: BakedEmbedViewProps) {
  switch (snapshot.kind) {
    case "image":
      return (
        <div className="px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a frozen data:
              URL, there is nothing for next/image to optimize. */}
          <img
            src={snapshot.dataUrl}
            alt={snapshot.caption || caption || ""}
            className="block max-w-full rounded-lg"
          />
        </div>
      );

    case "table":
      return (
        <div className="overflow-x-auto px-3 py-3">
          <table className="w-full border-collapse text-meta">
            {snapshot.columns.length > 0 && (
              <thead>
                <tr>
                  {snapshot.columns.map((col, i) => (
                    <th
                      key={i}
                      className="border border-border bg-surface-sunken px-2 py-1 text-left font-semibold text-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {snapshot.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border border-border px-2 py-1 text-foreground-muted"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "text":
      return (
        <div className="whitespace-pre-wrap px-4 py-3 text-body text-foreground">
          {snapshot.body}
        </div>
      );

    case "card":
      return (
        <div className="px-4 py-3">
          <p className="text-body font-semibold text-foreground">
            {snapshot.title || caption}
          </p>
          {snapshot.subtitle && (
            <p className="text-meta text-foreground-muted">{snapshot.subtitle}</p>
          )}
          {snapshot.meta.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {snapshot.meta.map((m, i) => (
                <li key={i} className="text-meta text-foreground-muted">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case "missing":
      return (
        <UnavailableEmbedCard
          descriptor={descriptor}
          caption={snapshot.name || caption}
        />
      );

    default: {
      // Exhaustiveness guard. An unknown kind degrades to the unavailable card.
      const exhaustive: never = snapshot;
      void exhaustive;
      return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
    }
  }
}
