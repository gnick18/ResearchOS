"use client";

// sequence Phase 2c / 2c2 bot — the FEATURE dialog. SnapGene "Edit Feature"
// parity: name, type, strand, the SEGMENT TABLE (multi-segment join() editing
// with split / merge / delete + per-segment color), the QUALIFIERS editor
// (/product, /note, /gene, ... add/remove/edit), per-feature color, and the
// "Translate in sequence view" + "Prioritize display in maps" toggles. The SAME
// component renders a READ-ONLY variant (`editable: false`) used by read-mode
// double-click: it shows every field plus the feature's sequence + GC%, with no
// edit controls. Calm, compact layout. No emojis (inline SVG only), no em-dashes.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FeatureDraft,
  type FeatureSegment,
  type QualifierRow,
  splitSegment,
  mergeSegment,
  deleteSegment,
} from "@/lib/sequences/feature-edit";
import { gcPercent } from "@/lib/sequences/edit-model";
import {
  FEATURE_COLOR_SWATCHES,
  FEATURE_TYPE_COLORS,
  colorForType,
} from "@/lib/sequences/feature-colors";
import LivingPopup from "@/components/ui/LivingPopup";
import {
  MAX_LENGTH_FEATURE_NAME,
  stripControlChars,
  countControlChars,
  capLength,
  charsOver,
} from "@/lib/validation/input-hardening";
import FeatureSegmentDiagram from "./FeatureSegmentDiagram";
import StrandSelector, {
  type StrandDisplay,
  displayToStrand,
  strandToDisplay,
} from "./StrandSelector";

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
  /** "add" seeds from the current selection; "edit" seeds from a feature;
   *  "view" is the READ-ONLY variant (read-mode double-click). */
  mode: "add" | "edit" | "view";
  /** Initial draft (1-based-inclusive coordinates are converted by the dialog).
   *  May carry `segments` / `qualifiers` / `translate` / `prioritize` to seed the
   *  enriched controls; the dialog derives sensible defaults when they are
   *  absent. */
  initial: FeatureDraft;
  /** Whether deleting is offered (edit mode only). */
  onDelete?: () => void;
  /** sequence editor master (redesign). Duplicate this feature (edit mode only).
   *  Makes an independent copy on the molecule and closes the dialog. */
  onDuplicate?: () => void;
  /** Required in add/edit mode; omitted in view mode. */
  onSubmit?: (draft: FeatureDraft) => void;
  onCancel: () => void;
  /** Sequence length, for range validation/clamping display. */
  seqLength: number;
  /** The full sequence bases, used by the read-only variant to show the
   *  feature's own sequence + GC%. Optional in edit mode. */
  seq?: string;
}

export default function FeatureEditorDialog({
  request,
}: {
  request: FeatureEditorRequest | null;
}) {
  const [name, setName] = useState("");
  // Count of control characters removed from the name on the last keystroke.
  // Shown as "N characters removed" affordance (mirrors the sequence base strip).
  const [nameCtrlRemoved, setNameCtrlRemoved] = useState(0);
  const [type, setType] = useState("misc_feature");
  const [strand, setStrand] = useState<1 | -1>(1);
  // The selector's visual choice (4 SnapGene states). Only +1/-1 round-trips to
  // the .gb (see StrandSelector caveat); `strand` stays the source of truth for
  // persistence, `strandDisplay` drives the diagram's arrowheads.
  const [strandDisplay, setStrandDisplay] = useState<StrandDisplay>("forward");
  // Geometry source of truth: the SEGMENT TABLE, 0-based [start, end). A
  // single-segment feature is one row; >1 row persists as a GenBank join().
  const [segments, setSegments] = useState<FeatureSegment[]>([{ start: 0, end: 1 }]);
  const [color, setColor] = useState<string>("");
  const [qualifiers, setQualifiers] = useState<QualifierRow[]>([]);
  const [translate, setTranslate] = useState(false);
  const [prioritize, setPrioritize] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Seed the form whenever a new request opens.
  useEffect(() => {
    if (!request) return;
    const i = request.initial;
    setName(i.name);
    setType(i.type || "misc_feature");
    const seededStrand = i.strand === -1 ? -1 : 1;
    setStrand(seededStrand);
    setStrandDisplay(strandToDisplay(seededStrand));
    // Segments: explicit table if provided, else a single row from the range.
    setSegments(
      i.segments && i.segments.length
        ? i.segments.map((s) => ({ ...s }))
        : [{ start: i.start, end: i.end }],
    );
    setColor(i.color ?? "");
    setQualifiers((i.qualifiers ?? []).map((q) => ({ ...q })));
    setTranslate(!!i.translate);
    setPrioritize(!!i.prioritize);
    // Focus the name field on open (edit/add only).
    const t = setTimeout(() => {
      if (request.mode !== "view") nameRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [request]);

  // The color actually shown on the map: explicit override, else the per-type
  // default. The picker offers "use type default" by clearing the override.
  const effectiveColor = useMemo(
    () => (color.trim() ? color.trim() : colorForType(type)),
    [color, type],
  );

  // The overall span + total length across all segments (exon total).
  const span = useMemo(() => {
    if (!segments.length) return { start: 0, end: 0, length: 0 };
    const start = segments.reduce((m, s) => Math.min(m, s.start), segments[0].start);
    const end = segments.reduce((m, s) => Math.max(m, s.end), segments[0].end);
    const length = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
    return { start, end, length };
  }, [segments]);

  // Read-only feature sequence + GC% (view mode). For multi-segment features we
  // concatenate the segment slices in positional order.
  const seqStr = request?.seq;
  const featureSeq = useMemo(() => {
    if (!seqStr) return "";
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    return ordered.map((s) => seqStr.slice(s.start, s.end)).join("");
  }, [seqStr, segments]);
  const featureGc = useMemo(
    () => (featureSeq ? gcPercent(featureSeq, 0, featureSeq.length) : 0),
    [featureSeq],
  );

  if (!request) return null;

  const submit = () => {
    request.onSubmit?.({
      name,
      type,
      strand,
      // The geometry comes from the segment table; the model recomputes the span.
      start: span.start,
      end: span.end,
      color: color.trim() || undefined,
      segments: segments.map((s) => ({ ...s })),
      qualifiers: qualifiers.filter((q) => q.key.trim()).map((q) => ({ ...q })),
      translate,
      prioritize,
    });
  };

  const isAdd = request.mode === "add";
  const readOnly = request.mode === "view";

  // Strand selector: keep the persisted +1/-1 in sync with the visual choice.
  const onStrandChange = (next: StrandDisplay) => {
    setStrandDisplay(next);
    setStrand(displayToStrand(next));
  };
  // What the diagram should draw: 0 (no arrowheads) for "none", +1/-1 otherwise.
  // Bidirectional draws forward arrowheads (the persisted strand is +1).
  const diagramStrand: 1 | -1 | 0 =
    strandDisplay === "none" ? 0 : strandDisplay === "reverse" ? -1 : 1;

  // --- segment table mutators (no-ops in read-only mode) ---
  const setSegStart = (idx: number, v: number) =>
    setSegments((segs) => segs.map((s, i) => (i === idx ? { ...s, start: Math.max(0, v) } : s)));
  const setSegEnd = (idx: number, v: number) =>
    setSegments((segs) => segs.map((s, i) => (i === idx ? { ...s, end: Math.max(0, v) } : s)));
  const setSegColor = (idx: number, c: string) =>
    setSegments((segs) => segs.map((s, i) => (i === idx ? { ...s, color: c || undefined } : s)));
  const onSplit = (idx: number) => setSegments((segs) => splitSegment(segs, idx));
  const onMerge = (idx: number) => setSegments((segs) => mergeSegment(segs, idx));
  const onDeleteSeg = (idx: number) => setSegments((segs) => deleteSegment(segs, idx));

  // --- qualifier mutators ---
  const addQualifier = () => setQualifiers((q) => [...q, { key: "note", value: "" }]);
  const setQualKey = (idx: number, k: string) =>
    setQualifiers((q) => q.map((row, i) => (i === idx ? { ...row, key: k } : row)));
  const setQualValue = (idx: number, v: string) =>
    setQualifiers((q) => q.map((row, i) => (i === idx ? { ...row, value: v } : row)));
  const removeQualifier = (idx: number) =>
    setQualifiers((q) => q.filter((_, i) => i !== idx));

  return (
    <LivingPopup open onClose={request.onCancel} label="Edit feature" selfSize>
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="feature-editor-dialog"
        data-tour-popup-occluding="feature-editor"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span
            className="h-4 w-4 shrink-0 rounded-sm seq-swatch-border"
            style={{ backgroundColor: effectiveColor }}
            aria-hidden="true"
          />
          <h2 className="text-title font-semibold text-foreground">
            {isAdd ? "Add feature" : readOnly ? name || "Feature" : "Edit feature"}
          </h2>
          {readOnly ? (
            <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
              Read-only
            </span>
          ) : null}
        </div>

        <div
          className="space-y-3 overflow-y-auto px-5 py-4"
          onKeyDown={(e) => {
            if (!readOnly && e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              submit();
            }
          }}
        >
          {readOnly ? (
            <ReadOnlyBody
              name={name}
              type={type}
              strand={strand}
              segments={segments}
              span={span}
              qualifiers={qualifiers}
              effectiveColor={effectiveColor}
              colorOverride={color}
              translate={translate}
              prioritize={prioritize}
              featureSeq={featureSeq}
              featureGc={featureGc}
            />
          ) : (
          <>

          {/* Mini gene viewer: live segment diagram (SnapGene parity) */}
          <FeatureSegmentDiagram
            segments={segments}
            strand={diagramStrand}
            color={effectiveColor}
          />

          {/* Name */}
          <label className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">Name</span>
              {nameCtrlRemoved > 0 && (
                <span className="text-meta text-amber-600 dark:text-amber-400">
                  {nameCtrlRemoved} character{nameCtrlRemoved !== 1 ? "s" : ""} removed
                </span>
              )}
              {charsOver(name, MAX_LENGTH_FEATURE_NAME) > 0 && (
                <span className="text-meta text-rose-600 dark:text-rose-400">
                  {charsOver(name, MAX_LENGTH_FEATURE_NAME)} over limit
                </span>
              )}
            </div>
            <input
              ref={nameRef}
              value={name}
              maxLength={MAX_LENGTH_FEATURE_NAME}
              onChange={(e) => {
                const raw = e.target.value;
                const removed = countControlChars(raw);
                const cleaned = capLength(stripControlChars(raw), MAX_LENGTH_FEATURE_NAME);
                setNameCtrlRemoved(removed);
                setName(cleaned);
              }}
              placeholder="Feature name"
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
            />
          </label>

          {/* Type + strand */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[10rem] flex-1">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Type</span>
              <input
                list="feature-type-options"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              />
              <datalist id="feature-type-options">
                {COMMON_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <div className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">Strand</span>
              <StrandSelector value={strandDisplay} onChange={onStrandChange} />
            </div>
          </div>
          {strandDisplay === "none" || strandDisplay === "both" ? (
            <p className="-mt-1.5 text-meta text-foreground-muted">
              GenBank stores a + or - strand only, so this saves as forward (+).
            </p>
          ) : null}

          {/* Segment table (multi-segment join() editing) */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">
                Segments {segments.length > 1 ? `(join of ${segments.length})` : ""}
              </span>
              <span className="text-meta text-foreground-muted">
                {span.length.toLocaleString()} bp total
              </span>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-body">
                <thead>
                  <tr className="bg-surface-sunken text-meta font-medium text-foreground-muted">
                    <th className="px-2 py-1 text-left">Start</th>
                    <th className="px-2 py-1 text-left">End</th>
                    <th className="px-2 py-1 text-left">Color</th>
                    <th className="px-2 py-1 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={1}
                          max={request.seqLength}
                          value={s.start + 1}
                          onChange={(e) =>
                            setSegStart(i, (Number(e.target.value) || 1) - 1)
                          }
                          className="w-20 rounded border border-border px-1.5 py-1 text-body focus:border-sky-400 focus:outline-none"
                          aria-label={`Segment ${i + 1} start`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={1}
                          max={request.seqLength}
                          value={s.end}
                          onChange={(e) => setSegEnd(i, Number(e.target.value) || 0)}
                          className="w-20 rounded border border-border px-1.5 py-1 text-body focus:border-sky-400 focus:outline-none"
                          aria-label={`Segment ${i + 1} end`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <label className="flex h-6 w-6 cursor-pointer items-center justify-center rounded seq-swatch-border"
                          style={{ backgroundColor: s.color || effectiveColor }}>
                          <input
                            type="color"
                            value={s.color || effectiveColor}
                            onChange={(e) => setSegColor(i, e.target.value)}
                            className="h-6 w-6 cursor-pointer opacity-0"
                            aria-label={`Segment ${i + 1} color`}
                          />
                        </label>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onSplit(i)}
                            disabled={s.end - s.start < 2}
                            className="rounded px-1.5 py-0.5 text-meta text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20 disabled:opacity-30"
                          >
                            Split
                          </button>
                          {i < segments.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => onMerge(i)}
                              className="rounded px-1.5 py-0.5 text-meta text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20"
                            >
                              Merge
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onDeleteSeg(i)}
                            disabled={segments.length <= 1}
                            className="rounded px-1.5 py-0.5 text-meta text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20 disabled:opacity-30"
                            aria-label={`Delete segment ${i + 1}`}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-meta text-foreground-muted">
              Positions are 1-based inclusive (span {(span.start + 1).toLocaleString()}..
              {span.end.toLocaleString()}). Sequence is {request.seqLength.toLocaleString()} bp.
              Split a segment to create an intron gap (a GenBank join).
            </p>
          </div>

          {/* Color */}
          <div>
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Color</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {FEATURE_COLOR_SWATCHES.map((sw) => {
                const active = color.trim().toLowerCase() === sw.toLowerCase();
                return (
                  <button
                    key={sw}
                    type="button"
                    onClick={() => setColor(sw)}
                    className={`h-6 w-6 rounded-md seq-swatch-border transition-transform hover:scale-110 ${
                      active ? "ring-2 ring-sky-500 ring-offset-1" : ""
                    }`}
                    style={{ backgroundColor: sw }}
                    aria-label={`Set color ${sw}`}
                  />
                );
              })}
              {/* Custom color */}
              <label className="ml-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md seq-swatch-border">
                <input
                  type="color"
                  value={effectiveColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer opacity-0"
                  aria-label="Custom color"
                />
                <span className="pointer-events-none absolute text-meta font-bold text-foreground-muted">+</span>
              </label>
            </div>
            <button
              type="button"
              onClick={() => setColor("")}
              className="mt-1.5 text-meta text-foreground-muted underline-offset-2 hover:text-foreground-muted hover:underline"
            >
              Use type default ({FEATURE_TYPE_COLORS[type.trim().toLowerCase()] ? type : "auto"})
            </button>
          </div>

          {/* Qualifiers (GenBank /product, /note, /gene, ...) */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">Qualifiers</span>
              <button
                type="button"
                onClick={addQualifier}
                className="rounded px-1.5 py-0.5 text-meta font-medium text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/20"
              >
                + Add qualifier
              </button>
            </div>
            {qualifiers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-meta text-foreground-muted">
                No qualifiers. Add /product, /note, /gene, or any GenBank qualifier.
              </p>
            ) : (
              <div className="space-y-1.5">
                {qualifiers.map((q, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <input
                      list="qualifier-key-options"
                      value={q.key}
                      onChange={(e) => setQualKey(i, e.target.value)}
                      placeholder="key"
                      className="w-28 shrink-0 rounded-md border border-border px-2 py-1 text-body focus:border-sky-400 focus:outline-none"
                      aria-label={`Qualifier ${i + 1} key`}
                    />
                    <textarea
                      value={q.value}
                      onChange={(e) => setQualValue(i, e.target.value)}
                      rows={1}
                      placeholder="value"
                      className="min-h-[32px] flex-1 resize-y rounded-md border border-border px-2 py-1 text-body focus:border-sky-400 focus:outline-none"
                      aria-label={`Qualifier ${i + 1} value`}
                    />
                    <button
                      type="button"
                      onClick={() => removeQualifier(i)}
                      className="mt-0.5 rounded px-1.5 py-1 text-meta text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20"
                      aria-label={`Remove qualifier ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <datalist id="qualifier-key-options">
              {["product", "note", "gene", "function", "label", "locus_tag", "translation", "db_xref", "EC_number"].map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>

          {/* Display toggles */}
          <div className="space-y-2 rounded-md bg-surface-sunken px-3 py-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-meta font-medium text-foreground-muted">Translate in sequence view</span>
              <input
                type="checkbox"
                checked={translate}
                onChange={(e) => setTranslate(e.target.checked)}
                className="h-4 w-4 accent-sky-600"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-meta font-medium text-foreground-muted">Prioritize display in maps</span>
              <input
                type="checkbox"
                checked={prioritize}
                onChange={(e) => setPrioritize(e.target.checked)}
                className="h-4 w-4 accent-sky-600"
              />
            </label>
          </div>
          </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <div className="flex items-center gap-1">
            {/* sequence editor master (redesign). Duplicate the feature. Edit mode
                only (a copy of an existing feature has no meaning while adding or
                in the read-only view). Mirrors the right-click "Duplicate". */}
            {!isAdd && !readOnly && request.onDuplicate ? (
              <button
                type="button"
                onClick={request.onDuplicate}
                className="rounded-lg px-3 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
              >
                Duplicate
              </button>
            ) : null}
            {!readOnly && request.onDelete ? (
              <button
                type="button"
                onClick={request.onDelete}
                className="rounded-lg px-3 py-2 text-body font-medium text-rose-600 dark:text-rose-300 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/20"
              >
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={request.onCancel}
              className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={submit}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90"
              >
                {isAdd ? "Add feature" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

/** The READ-ONLY feature info body (read-mode double-click). Shows every field
 *  the edit dialog has, plus the feature's own sequence + GC%, with no controls. */
function ReadOnlyBody({
  name,
  type,
  strand,
  segments,
  span,
  qualifiers,
  effectiveColor,
  colorOverride,
  translate,
  prioritize,
  featureSeq,
  featureGc,
}: {
  name: string;
  type: string;
  strand: 1 | -1;
  segments: FeatureSegment[];
  span: { start: number; end: number; length: number };
  qualifiers: QualifierRow[];
  effectiveColor: string;
  colorOverride: string;
  translate: boolean;
  prioritize: boolean;
  featureSeq: string;
  featureGc: number;
}) {
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-3 py-1">
      <span className="w-28 shrink-0 text-meta font-medium text-foreground-muted">{label}</span>
      <span className="flex-1 break-words text-body text-foreground">{children}</span>
    </div>
  );

  return (
    <div>
      <div className="pb-3">
        <FeatureSegmentDiagram segments={segments} strand={strand} color={effectiveColor} />
      </div>
      <div className="divide-y divide-gray-50">
      <Row label="Name">{name || "(unnamed)"}</Row>
      <Row label="Type">{type || "misc_feature"}</Row>
      <Row label="Strand">{strand === -1 ? "Reverse (-)" : "Forward (+)"}</Row>
      <Row label="Range">
        {(span.start + 1).toLocaleString()}..{span.end.toLocaleString()}{" "}
        <span className="text-foreground-muted">(1-based inclusive)</span>
      </Row>
      <Row label="Length">{span.length.toLocaleString()} bp</Row>
      {segments.length > 1 ? (
        <Row label="Segments">
          <span className="text-foreground-muted">join of {segments.length}: </span>
          {segments
            .map((s) => `${(s.start + 1).toLocaleString()}..${s.end.toLocaleString()}`)
            .join(", ")}
        </Row>
      ) : null}
      <Row label="Color">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-3.5 rounded-sm seq-swatch-border"
            style={{ backgroundColor: effectiveColor }}
          />
          <span className="font-mono text-meta">
            {colorOverride.trim() ? effectiveColor : `${effectiveColor} (type default)`}
          </span>
        </span>
      </Row>
      {translate || prioritize ? (
        <Row label="Display">
          {[translate ? "Translated in sequence view" : null, prioritize ? "Prioritized in maps" : null]
            .filter(Boolean)
            .join(", ")}
        </Row>
      ) : null}

      {qualifiers.length ? (
        <div className="py-2">
          <span className="mb-1 block text-meta font-medium text-foreground-muted">Qualifiers</span>
          <div className="space-y-1">
            {qualifiers.map((q, i) => (
              <div key={i} className="flex gap-2 text-body">
                <span className="shrink-0 font-mono text-meta text-sky-700 dark:text-sky-300">/{q.key}</span>
                <span className="break-words text-foreground">{q.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {featureSeq ? (
        <div className="py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-meta font-medium text-foreground-muted">Sequence</span>
            <span className="text-meta text-foreground-muted">GC {featureGc.toFixed(1)}%</span>
          </div>
          <div className="max-h-32 overflow-y-auto rounded-md bg-surface-sunken px-2.5 py-2 font-mono text-meta leading-relaxed tracking-wide text-foreground break-all">
            {featureSeq}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
