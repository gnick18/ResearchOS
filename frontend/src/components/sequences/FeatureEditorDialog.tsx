"use client";

// sequence Phase 2c bot — the Add / Edit FEATURE dialog. Collects name, type,
// strand, range (1-based inclusive in the UI, like SnapGene), and color. Calm,
// compact layout mirroring SequenceConfirmDialog. No emojis (inline SVG only),
// no em-dashes.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureDraft } from "@/lib/sequences/feature-edit";
import {
  FEATURE_COLOR_SWATCHES,
  FEATURE_TYPE_COLORS,
  colorForType,
} from "@/lib/sequences/feature-colors";

/** A common starter set of feature types for the selector. The free-text input
 *  still allows any GenBank type (the parsed file may carry others). */
const COMMON_TYPES = [
  "CDS",
  "gene",
  "promoter",
  "terminator",
  "rep_origin",
  "primer_bind",
  "protein_bind",
  "RBS",
  "misc_feature",
  "regulatory",
  "5'UTR",
  "3'UTR",
];

export interface FeatureEditorRequest {
  /** "add" seeds from the current selection; "edit" seeds from a feature. */
  mode: "add" | "edit";
  /** Initial draft (1-based-inclusive coordinates are converted by the dialog). */
  initial: FeatureDraft;
  /** Whether deleting is offered (edit mode only). */
  onDelete?: () => void;
  onSubmit: (draft: FeatureDraft) => void;
  onCancel: () => void;
  /** Sequence length, for range validation/clamping display. */
  seqLength: number;
}

export default function FeatureEditorDialog({
  request,
}: {
  request: FeatureEditorRequest | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("misc_feature");
  const [strand, setStrand] = useState<1 | -1>(1);
  // 1-based inclusive in the UI (start..end), converted on submit.
  const [start1, setStart1] = useState(1);
  const [end1, setEnd1] = useState(1);
  const [color, setColor] = useState<string>("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Seed the form whenever a new request opens.
  useEffect(() => {
    if (!request) return;
    const i = request.initial;
    setName(i.name);
    setType(i.type || "misc_feature");
    setStrand(i.strand === -1 ? -1 : 1);
    setStart1(i.start + 1); // 0-based [start,end) -> 1-based inclusive
    setEnd1(i.end);
    setColor(i.color ?? "");
    // Focus the name field on open.
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request]);

  // The color actually shown on the map: explicit override, else the per-type
  // default. The picker offers "use type default" by clearing the override.
  const effectiveColor = useMemo(
    () => (color.trim() ? color.trim() : colorForType(type)),
    [color, type],
  );

  if (!request) return null;

  const submit = () => {
    request.onSubmit({
      name,
      type,
      strand,
      start: start1 - 1, // back to 0-based inclusive start
      end: end1, // 1-based inclusive end == 0-based exclusive end
      color: color.trim() || undefined,
    });
  };

  const isAdd = request.mode === "add";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="feature-editor-dialog"
      data-tour-popup-occluding="feature-editor"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={request.onCancel} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <span
            className="h-4 w-4 shrink-0 rounded-sm ring-1 ring-black/10"
            style={{ backgroundColor: effectiveColor }}
            aria-hidden="true"
          />
          <h2 className="text-base font-semibold text-gray-900">
            {isAdd ? "Add feature" : "Edit feature"}
          </h2>
        </div>

        <div
          className="space-y-3 px-5 py-4"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        >
          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Feature name"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
            />
          </label>

          {/* Type + strand */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Type</span>
              <input
                list="feature-type-options"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              />
              <datalist id="feature-type-options">
                {COMMON_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Strand</span>
              <select
                value={strand}
                onChange={(e) => setStrand(Number(e.target.value) === -1 ? -1 : 1)}
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              >
                <option value={1}>Forward (+)</option>
                <option value={-1}>Reverse (-)</option>
              </select>
            </label>
          </div>

          {/* Range (1-based inclusive) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Start</span>
              <input
                type="number"
                min={1}
                max={request.seqLength}
                value={start1}
                onChange={(e) => setStart1(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">End</span>
              <input
                type="number"
                min={1}
                max={request.seqLength}
                value={end1}
                onChange={(e) => setEnd1(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
              />
            </label>
          </div>
          <p className="text-[11px] text-gray-400">
            Positions are 1-based inclusive ({Math.min(start1, end1).toLocaleString()}..
            {Math.max(start1, end1).toLocaleString()}). Sequence is{" "}
            {request.seqLength.toLocaleString()} bp.
          </p>

          {/* Color */}
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">Color</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {FEATURE_COLOR_SWATCHES.map((sw) => {
                const active = color.trim().toLowerCase() === sw.toLowerCase();
                return (
                  <button
                    key={sw}
                    type="button"
                    onClick={() => setColor(sw)}
                    className={`h-6 w-6 rounded-md ring-1 ring-black/10 transition-transform hover:scale-110 ${
                      active ? "ring-2 ring-sky-500 ring-offset-1" : ""
                    }`}
                    style={{ backgroundColor: sw }}
                    aria-label={`Set color ${sw}`}
                  />
                );
              })}
              {/* Custom color */}
              <label className="ml-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ring-1 ring-black/10">
                <input
                  type="color"
                  value={effectiveColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer opacity-0"
                  aria-label="Custom color"
                />
                <span className="pointer-events-none absolute text-[9px] font-bold text-gray-500">+</span>
              </label>
            </div>
            <button
              type="button"
              onClick={() => setColor("")}
              className="mt-1.5 text-[11px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
            >
              Use type default ({FEATURE_TYPE_COLORS[type.trim().toLowerCase()] ? type : "auto"})
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            {request.onDelete ? (
              <button
                type="button"
                onClick={request.onDelete}
                className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
              >
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={request.onCancel}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
            >
              {isAdd ? "Add feature" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
