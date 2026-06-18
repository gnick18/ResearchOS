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
import { objectDeepLink, DEFAULT_EMBED_VIEW } from "@/lib/references";
import { ObjectEmbedCard, UnavailableEmbedCard, EmbedCaption, type EmbedRendererProps } from "./ObjectEmbed";
import EmbedViewSwitch, { type EmbedViewOption } from "./EmbedViewSwitch";
import Tooltip from "@/components/Tooltip";
import {
  planRibbonLabels,
  charsThatFit,
  type RibbonLabelInput,
} from "@/lib/sequences/ribbon-label-layout";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; detail: SequenceDetail };

// Fallback feature colors when an annotation carries none.
const PALETTE = ["#bfdbfe", "#bbf7d0", "#fde68a", "#fbcfe8", "#ddd6fe", "#bae6fd"];

// SnapGene-style ribbon geometry (viewBox units; the SVG scales to its
// container). The molecule is one horizontal strand; feature names that fit
// inside their bar stay inline, the rest stack into collision-free tiers below
// the track with a leader line back to their feature (planRibbonLabels).
const VIEW_W = 720;
const PAD = 16;
const TOP_Y = 9; // end-position numbers ("1" / length) sit above the bar
const BAR_MID = 26; // vertical center of the feature strand
const BAR_H = 18; // feature bar height
const BAR_TOP = BAR_MID - BAR_H / 2;
const BAR_BOTTOM = BAR_MID + BAR_H / 2;
const LABEL_FONT = 10; // ribbon feature-name font size
const TIER0_BASE = BAR_BOTTOM + 13; // baseline of the first stacked label tier
const TIER_STEP = 14; // vertical step between stacked label tiers
const MAX_LABEL_PX = 200; // cap before a stacked name is ellipsized

// A sequence record always carries its bases, so both views render from the
// already-loaded detail. Map is the feature ribbon, bases is the raw monospace.
const SEQUENCE_VIEWS: EmbedViewOption[] = [
  { value: "map", label: "Map" },
  { value: "bases", label: "Bases" },
];

// How many residues the bases view previews before the trailing tail count.
const BASES_PREVIEW = 240;

export default function SequenceEmbed({ descriptor, caption, figureLabel, onViewChange }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });
  // The view rendered right now, initialized from the saved descriptor view. A
  // switch updates this immediately (instant flip) and, in the editor, persists.
  const [view, setView] = useState<string>(
    descriptor.view && descriptor.view !== "chip" ? descriptor.view : DEFAULT_EMBED_VIEW.sequence,
  );
  const selectView = (next: string) => {
    setView(next);
    onViewChange?.(next);
  };

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

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const d = state.detail;
  const length = d.length || d.seq.length || 1;
  const isProtein = String(d.seq_type).toLowerCase().includes("protein");
  const unit = isProtein ? "aa" : "bp";
  const title = d.display_name || caption;
  const href = objectDeepLink("sequence", descriptor.id);
  const facts = `${length.toLocaleString()} ${unit} · ${d.circular ? "Circular" : "Linear"} · ${d.feature_count} ${d.feature_count === 1 ? "feature" : "features"}`;

  const span = VIEW_W - 2 * PAD;
  const xOf = (pos: number) => PAD + (Math.max(0, Math.min(length, pos)) / length) * span;

  // The shared header. Map and bases both render under it, with the same facts,
  // Open link, and the view switch.
  const header = (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
      <span className="truncate text-body font-semibold text-foreground">{title}</span>
      <span className="shrink-0 text-meta text-foreground-muted">{facts}</span>
      <span className="flex-1" />
      <EmbedViewSwitch views={SEQUENCE_VIEWS} current={view} onSelect={selectView} />
      <a
        href={href}
        aria-label={`Open sequence ${title}`}
        className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
      >
        Open
      </a>
    </div>
  );

  // Bases view: a cheap read-only monospace preview of the first residues, with a
  // trailing count of how many more were not shown. Not the interactive map.
  if (view === "bases") {
    const seq = (d.seq || "").toUpperCase();
    const preview = seq.slice(0, BASES_PREVIEW);
    const remaining = Math.max(0, seq.length - preview.length);
    return (
      <div>
        {header}
        <div className="px-3 py-3">
          <p className="mb-1 text-meta text-foreground-muted">
            {`${length.toLocaleString()} ${unit} · ${isProtein ? "Protein" : d.seq_type}`}
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-meta leading-relaxed text-foreground">
            {preview || "(no sequence)"}
            {remaining > 0 ? (
              <span className="text-foreground-muted">{` … +${remaining.toLocaleString()} more ${unit}`}</span>
            ) : null}
          </pre>
        </div>
        <EmbedCaption caption={caption} name={d.display_name} figureLabel={figureLabel} />
      </div>
    );
  }

  // Map view geometry. Each feature is a bar on the strand; its name is drawn
  // INLINE when it fits inside the bar, otherwise lifted into a collision-free
  // stacked tier below the track with a leader line back to the feature
  // (planRibbonLabels, the same packer the editor's LinearMap uses). This is the
  // SnapGene-style layout that replaces the old "center the name on the bar and
  // hope it fits" approach, which clipped + overlapped short / close features.
  const bars = d.annotations.map((a, i) => {
    const x0 = xOf(a.start);
    const x1 = Math.max(x0 + 3, xOf(a.end));
    return {
      id: String(i),
      name: a.name || "feature",
      x0,
      x1,
      midX: (x0 + x1) / 2,
      fill: a.color || PALETTE[i % PALETTE.length],
    };
  });
  const labelInputs: RibbonLabelInput[] = bars.map((b) => ({ id: b.id, name: b.name, x0: b.x0, x1: b.x1 }));
  const plan = planRibbonLabels(labelInputs, {
    fontPx: LABEL_FONT,
    minX: PAD,
    maxX: VIEW_W - PAD,
    maxLabelPx: MAX_LABEL_PX,
  });
  const inlineSet = new Set(plan.inlineIds);
  const placedById = new Map(plan.external.map((p) => [p.id, p]));
  const mapH =
    plan.tiers > 0 ? TIER0_BASE + (plan.tiers - 1) * TIER_STEP + 6 : BAR_BOTTOM + 10;

  return (
    <div>
      {header}
      <div className="px-3 py-3">
        <svg viewBox={`0 0 ${VIEW_W} ${mapH}`} width="100%" height={mapH} role="img" aria-label={`${title} feature map`}>
          {/* backbone */}
          <line x1={PAD} y1={BAR_MID} x2={VIEW_W - PAD} y2={BAR_MID} stroke="var(--border)" strokeWidth="2" />
          {/* end-position numbers, above the bar so they never collide with the
              stacked feature labels below the track */}
          <text x={PAD} y={TOP_Y} fontSize="9" fill="var(--foreground-muted)">1</text>
          <text x={VIEW_W - PAD} y={TOP_Y} fontSize="9" textAnchor="end" fill="var(--foreground-muted)">
            {length.toLocaleString()}
          </text>
          {/* feature bars + inline labels */}
          {bars.map((b) => {
            const w = b.x1 - b.x0;
            return (
              <g key={`bar-${b.id}`}>
                <rect x={b.x0} y={BAR_TOP} width={w} height={BAR_H} rx="3" fill={b.fill} opacity={0.95} />
                {inlineSet.has(b.id) ? (
                  <text x={b.midX} y={BAR_MID + 4} fontSize={LABEL_FONT} textAnchor="middle" fill="#1f2937">
                    {b.name}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* stacked external labels: a thin leader line from the feature bar to
              the label's tier, then the name. SnapGene / Benchling style, so a
              short or crowded feature reads unambiguously instead of clipping */}
          {bars.map((b) => {
            const placed = placedById.get(b.id);
            if (!placed) return null;
            const baseY = TIER0_BASE + placed.tier * TIER_STEP;
            const elbowY = baseY - LABEL_FONT - 2;
            const full = b.name;
            const overCap = placed.width >= MAX_LABEL_PX;
            const shown = overCap ? `${full.slice(0, charsThatFit(full, LABEL_FONT, MAX_LABEL_PX))}…` : full;
            const labelEl = (
              <text x={placed.labelX} y={baseY} fontSize={LABEL_FONT} textAnchor="middle" fill="var(--foreground)">
                {shown}
              </text>
            );
            return (
              <g key={`lab-${b.id}`}>
                <polyline
                  points={`${b.midX},${BAR_BOTTOM} ${b.midX},${elbowY} ${placed.labelX},${elbowY}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
                {overCap ? <Tooltip label={full}>{labelEl}</Tooltip> : labelEl}
              </g>
            );
          })}
        </svg>
      </div>
      <EmbedCaption caption={caption} name={d.display_name} figureLabel={figureLabel} />
    </div>
  );
}
