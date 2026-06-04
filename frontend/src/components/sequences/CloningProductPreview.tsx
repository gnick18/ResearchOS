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

import { productGc } from "@/lib/sequences/cloning";

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
        <span className="shrink-0 text-meta text-gray-500">
          {circular ? "Circular" : "Linear"} · {seq.length.toLocaleString()} bp ·{" "}
          {productGc(seq).toFixed(0)}% GC
        </span>
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
