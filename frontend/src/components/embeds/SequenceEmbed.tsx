"use client";

// Markdown embed hybrid, Phase 1. The sequence map block-embed renderer.
//
// Loaded lazily by ObjectEmbed for a `[caption](/sequences?seq=ID#ros=map)`
// embed. Reads the sequence detail (which already carries parsed annotations) and
// draws a lightweight read-only feature ribbon, the map at a glance, not the full
// interactive LinearMap editor. A missing sequence degrades to the generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { sequencesApi } from "@/lib/local-api";
import type { SequenceDetail } from "@/lib/types";
import { objectDeepLink } from "@/lib/references";
import { ObjectEmbedCard, EmbedCaption, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; detail: SequenceDetail };

// Fallback feature colors when an annotation carries none.
const PALETTE = ["#bfdbfe", "#bbf7d0", "#fde68a", "#fbcfe8", "#ddd6fe", "#bae6fd"];

const VIEW_W = 720;
const PAD = 16;
const BASE_Y = 46;

export default function SequenceEmbed({ descriptor, caption, figureLabel }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    const id = Number(descriptor.id);
    if (!Number.isFinite(id)) {
      setState({ k: "missing" });
      return;
    }
    sequencesApi
      .get(id)
      .then((d) => {
        if (cancelled) return;
        setState(d ? { k: "ok", detail: d } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [descriptor.id]);

  if (state.k !== "ok") {
    return (
      <ObjectEmbedCard descriptor={descriptor} caption={caption} loading={state.k === "loading"} />
    );
  }

  const d = state.detail;
  const length = d.length || d.seq.length || 1;
  const unit = String(d.seq_type).toLowerCase().includes("protein") ? "aa" : "bp";
  const title = caption || d.display_name;
  const href = objectDeepLink("sequence", descriptor.id);
  const facts = `${length.toLocaleString()} ${unit} · ${d.circular ? "Circular" : "Linear"} · ${d.feature_count} ${d.feature_count === 1 ? "feature" : "features"}`;

  const span = VIEW_W - 2 * PAD;
  const xOf = (pos: number) => PAD + (Math.max(0, Math.min(length, pos)) / length) * span;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="shrink-0 text-meta text-foreground-muted">{facts}</span>
        <span className="flex-1" />
        <a
          href={href}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          Open
        </a>
      </div>
      <div className="px-3 py-3">
        <svg viewBox={`0 0 ${VIEW_W} 72`} width="100%" height="72" role="img" aria-label={`${title} feature map`}>
          {/* backbone */}
          <line x1={PAD} y1={BASE_Y} x2={VIEW_W - PAD} y2={BASE_Y} stroke="var(--border)" strokeWidth="2" />
          {d.annotations.map((a, i) => {
            const x = xOf(a.start);
            const w = Math.max(3, xOf(a.end) - x);
            const fill = a.color || PALETTE[i % PALETTE.length];
            const showLabel = w > 44;
            return (
              <g key={`${a.name}-${a.start}-${i}`}>
                <rect x={x} y={BASE_Y - 9} width={w} height={18} rx="3" fill={fill} opacity={0.95} />
                {showLabel ? (
                  <text
                    x={x + w / 2}
                    y={BASE_Y + 4}
                    fontSize="10"
                    textAnchor="middle"
                    fill="#1f2937"
                  >
                    {a.name}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* end ticks */}
          <text x={PAD} y={BASE_Y + 22} fontSize="9" fill="var(--foreground-muted)">1</text>
          <text x={VIEW_W - PAD} y={BASE_Y + 22} fontSize="9" textAnchor="end" fill="var(--foreground-muted)">
            {length.toLocaleString()}
          </text>
        </svg>
      </div>
      <EmbedCaption caption={caption} name={d.display_name} figureLabel={figureLabel} />
    </div>
  );
}
