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
import { productGc } from "@/lib/sequences/cloning";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
  select,
  children,
  onSave,
  saving = false,
}: Props) {
  const shown = seq.length > PREVIEW_LIMIT ? seq.slice(0, PREVIEW_LIMIT) : seq;
  const selectable = Boolean(select);
  const [copied, setCopied] = useState(false);

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
        selectable && select?.checked ? "border-sky-400 ring-1 ring-sky-200" : "border-gray-200"
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
          <h3 className="truncate text-body font-semibold text-gray-700">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-meta text-gray-500">
            {circular ? "Circular" : "Linear"} · {seq.length.toLocaleString()} bp ·{" "}
            {productGc(seq).toFixed(0)}% GC
          </span>
          <Tooltip label="Copy product sequence">
            <button
              type="button"
              onClick={copySequence}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-meta font-medium text-gray-600 hover:bg-gray-100"
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

      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-meta leading-relaxed text-gray-700">
        {shown}
        {seq.length > shown.length
          ? `\n… (${(seq.length - shown.length).toLocaleString()} more bp)`
          : ""}
      </pre>

      {children ? <div className="mt-3 space-y-3">{children}</div> : null}

      {onSave ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-meta font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save to library"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
