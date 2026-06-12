"use client";

// cloning coherence bot. The ONE shared assembled-product card, used by every
// review step in CloningWorkspace (overlap, restriction / golden-gate, Gateway).
// Before this, each method drew the product a different way (overlap had a framed
// PreviewBox, cut-ligate a raw <pre> + radio list, Gateway a per-card <pre>), and
// the Save action lived in different places. This component renders a single
// product consistently, a framed header (title + topology + length bp + %GC), the
// sequence in the framed PreviewBox style, optional method-specific extras as
// children, and a per-product "Save to library" button on the card. Presentation
// only; the engines and save payloads are unchanged.
//
// No emojis (inline SVG only), no em-dashes, Tooltip for icon-only controls.

import { useState } from "react";
import Tooltip from "@/components/Tooltip";
import { productGc, type FragmentSpan } from "@/lib/sequences/cloning";
import type { SequenceDetail } from "@/lib/types";
import SequenceReadView from "./SequenceReadView";
import FragmentRibbon, { type RibbonJunction } from "./FragmentRibbon";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className ?? ""} transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** A radio control rendered in the card header when a method offers several
 *  mutually exclusive products to choose between (cut-ligate symmetric overhangs). */
interface SelectControl {
  name: string;
  checked: boolean;
  onChange: () => void;
}

interface Props {
  /** Card title that conveys the product type, e.g. "Recombinant construct",
   *  "Assembled product", "Entry clone", "Byproduct". The Save verb stays uniform. */
  title: string;
  seq: string;
  circular: boolean;
  /** A renderable detail of the assembled product (productToDetail). When given,
   *  the card shows a read-only SeqViz map above the sequence. */
  detail?: SequenceDetail | null;
  /** Per-fragment product spans for the origin ribbon under the map. */
  fragmentSpans?: FragmentSpan[];
  /** Per-boundary junction-tick labels on the ribbon (overlap bp/Tm, overhang
   *  seal, att-site scar). Optional; the ribbon renders without them. */
  ribbonJunctions?: RibbonJunction[];
  /** Start the embedded map on the cut-site layer (restriction / Golden Gate). */
  showEnzymes?: boolean;
  /** Chemistry-specific hero module, rendered ABOVE the map. Leads the review
   *  with the one verification that chemistry's user most needs. */
  hero?: React.ReactNode;
  /** Optional radio for picking among several possible products. */
  select?: SelectControl;
  /** Method-specific extras (junctions, oligo table, digested pieces, att-sites). */
  children?: React.ReactNode;
  /** Per-product save. Omit to render the card without a Save action. */
  onSave?: () => void;
  saving?: boolean;
}

const PREVIEW_LIMIT = 4000;

export default function CloningProductPreview({
  title,
  seq,
  circular,
  detail,
  fragmentSpans,
  ribbonJunctions,
  showEnzymes = false,
  hero,
  select,
  children,
  onSave,
  saving = false,
}: Props) {
  const shown = seq.length > PREVIEW_LIMIT ? seq.slice(0, PREVIEW_LIMIT) : seq;
  const selectable = Boolean(select);
  const [copied, setCopied] = useState(false);
  // The raw bases live behind a disclosure now that the map is the primary view.
  // Default collapsed; the Copy control stays in the header so people can still
  // grab the sequence without expanding.
  const [showSequence, setShowSequence] = useState(false);

  // Copy the FULL product sequence (not the truncated preview). One card serves
  // every method, so this single control covers all four chemistries.
  const copySequence = async () => {
    try {
      await navigator.clipboard.writeText(seq);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the preview is still on screen to copy manually.
    }
  };
  return (
    <div
      className={`rounded-md border p-4 ${
        selectable && select?.checked ? "border-sky-400 ring-1 ring-sky-200" : "border-border"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {select ? (
            <input
              type="radio"
              name={select.name}
              checked={select.checked}
              onChange={select.onChange}
              aria-label={`Select ${title}`}
            />
          ) : null}
          <h3 className="truncate text-body font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-meta text-foreground-muted">
            {circular ? "Circular" : "Linear"} · {seq.length.toLocaleString()} bp ·{" "}
            {productGc(seq).toFixed(0)}% GC
          </span>
          <Tooltip label="Copy product sequence">
            <button
              type="button"
              onClick={copySequence}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-meta font-medium text-foreground-muted hover:bg-surface-raised"
              aria-label="Copy product sequence"
            >
              {copied ? (
                <>
                  <CheckIcon className="h-3.5 w-3.5 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <CopyIcon className="h-3.5 w-3.5" /> Copy
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Hero module, the chemistry-specific lead of the review. */}
      {hero ? <div className="mb-3">{hero}</div> : null}

      {/* The live product map (read-only SeqViz via the saved-sequence read path).
          Circular products render the ring, linear render the track. The embedded
          map opens on the Map (ring) view with slim chrome; restriction / Golden
          Gate also start with the enzyme / cut-site layer on. */}
      {detail ? (
        <div className="overflow-hidden rounded-md border border-border">
          <SequenceReadView
            sequence={detail}
            embedded
            initialViewMode="map"
            initialShowEnzymes={showEnzymes}
          />
        </div>
      ) : null}

      {/* Fragment-origin ribbon, directly under the map. */}
      {fragmentSpans && fragmentSpans.length > 0 ? (
        <div className="mt-3">
          <FragmentRibbon spans={fragmentSpans} length={seq.length} junctions={ribbonJunctions} />
        </div>
      ) : null}

      {/* Raw bases, hidden by default behind a disclosure. */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowSequence((v) => !v)}
          className="flex items-center gap-1.5 text-meta font-medium text-foreground-muted hover:text-foreground"
          aria-expanded={showSequence}
        >
          <ChevronIcon className="h-3.5 w-3.5" open={showSequence} />
          {showSequence ? "Hide sequence" : "Show sequence"}
        </button>
        {showSequence ? (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-sunken p-3 font-mono text-meta leading-relaxed text-foreground">
            {shown}
            {seq.length > shown.length
              ? `\n… (${(seq.length - shown.length).toLocaleString()} more bp)`
              : ""}
          </pre>
        ) : null}
      </div>

      {children ? <div className="mt-3 space-y-3">{children}</div> : null}

      {onSave ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-brand-action px-4 py-1.5 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save to library"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
