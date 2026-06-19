"use client";

// The Transform dialog (Data Hub transforms UI). It turns the open table into a
// DERIVED table by picking one of the five Prism-style Data Processing transforms
// and its options, then handing the choice back to the page, which creates a new
// derived document linked to this source. A derived table's columns/rows are
// COMPUTED from the source's current content, so the new table tracks edits to
// the source live (see datahub/derived.ts).
//
// The dialog is also the EDIT surface: when it opens with an initial transform +
// params (the derived table's existing derivedFrom), confirming updates the link
// in place instead of minting a new table.
//
// The math is owned by datahub/transforms.ts (one pure function per kind); this
// component only collects the kind + params and shows a small live preview by
// running runTransform against the source content. It never persists; the page
// owns create / update.
//
// House style: <Icon> only, Tooltip on icon-only buttons, StyledSelect not a
// native <select>, Seg for short option sets, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import type {
  DataHubDocContent,
  TransformKind,
} from "@/lib/datahub/model/types";
import {
  runTransform,
  type TransformFunction,
} from "@/lib/datahub/transforms";
import StyledSelect from "@/components/datahub/StyledSelect";

export interface TransformSubmit {
  transform: TransformKind;
  params: Record<string, unknown>;
  /** A suggested derived-table name (e.g. "Growth (normalized)"). The page may
   *  keep this as is for a create, and ignores it for an edit. */
  suggestedName: string;
}

/** A short, human suffix per transform for the auto-name (e.g. "normalized"). */
const NAME_SUFFIX: Record<TransformKind, string> = {
  transform: "transformed",
  normalize: "normalized",
  transpose: "transposed",
  removeBaseline: "baseline removed",
  fractionOfTotal: "fraction of total",
};

const KIND_META: { kind: TransformKind; label: string; blurb: string }[] = [
  {
    kind: "transform",
    label: "Transform",
    blurb:
      "Apply a function to every Y value, like log, square root, or a linear Y times k plus b.",
  },
  {
    kind: "normalize",
    label: "Normalize",
    blurb:
      "Rescale each column to a percent of its max, sum, first value, or its min-to-max range.",
  },
  {
    kind: "transpose",
    label: "Transpose",
    blurb:
      "Swap rows and columns, so each row becomes a column. Pick a column to title the new columns.",
  },
  {
    kind: "removeBaseline",
    label: "Remove baseline",
    blurb:
      "Subtract a baseline from every value, taken from a column, each column's first row, or a constant.",
  },
  {
    kind: "fractionOfTotal",
    label: "Fraction of total",
    blurb:
      "Express each value as a fraction or percent of its column, row, or the grand total.",
  },
];

const FUNCTION_OPTIONS: { value: TransformFunction; label: string }[] = [
  { value: "log10", label: "Log base 10" },
  { value: "ln", label: "Natural log (ln)" },
  { value: "log2", label: "Log base 2" },
  { value: "sqrt", label: "Square root" },
  { value: "square", label: "Square" },
  { value: "reciprocal", label: "Reciprocal (1 / Y)" },
  { value: "linear", label: "Linear (Y times k plus b)" },
];

const NORMALIZE_OPTIONS = [
  { value: "max", label: "Percent of column max" },
  { value: "sum", label: "Percent of column sum" },
  { value: "first", label: "Percent of first value" },
  { value: "minMax", label: "Min 0% to max 100%" },
];

const REMOVE_BASELINE_OPTIONS = [
  { value: "column", label: "Subtract a baseline column" },
  { value: "firstRow", label: "Subtract each column's first row" },
  { value: "value", label: "Subtract a constant" },
];

/** A small segmented control for short option sets (the Seg idiom reused across
 *  the Data Hub panels). Always closeable, no soft-lock. */
function Seg({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`px-2.5 py-1 text-meta font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              active
                ? "bg-accent-soft text-accent"
                : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small labeled number input that reports its parsed value up. defaultValue +
 *  commit-on-blur so a reproject never fights the caret. */
function NumberField({
  label,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-meta text-foreground-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        defaultValue={String(value)}
        key={`${ariaLabel}:${value}`}
        onBlur={(e) => {
          const n = Number(e.currentTarget.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={ariaLabel}
        className="w-20 rounded-md border border-border bg-surface-overlay px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none"
      />
    </label>
  );
}

export default function TransformDialog({
  open,
  content,
  sourceName,
  initialTransform,
  initialParams,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** The SOURCE table's current content. The preview runs against this, and the
   *  column pickers (baseline column, transpose header) read its columns. */
  content: DataHubDocContent | null;
  /** The source table's display name, used to suggest the derived table's name. */
  sourceName: string;
  /** When editing an existing derived table, its current transform + params seed
   *  the form so the dialog reopens prefilled. Absent for a fresh create. */
  initialTransform?: TransformKind;
  initialParams?: Record<string, unknown>;
  onCancel: () => void;
  onSubmit: (data: TransformSubmit) => void;
}) {
  const isEdit = initialTransform != null;

  // The data columns of the source (role "y" / subcolumn) are the candidates for
  // a baseline column; every column can title the transposed table.
  const dataColumns = useMemo(
    () =>
      content
        ? content.columns.filter(
            (c) => c.role === "y" || c.role === "subcolumn",
          )
        : [],
    [content],
  );
  const allColumns = useMemo(() => content?.columns ?? [], [content]);

  const [kind, setKind] = useState<TransformKind>("transform");
  // transform
  const [func, setFunc] = useState<TransformFunction>("log10");
  const [linearK, setLinearK] = useState(1);
  const [linearB, setLinearB] = useState(0);
  // normalize
  const [normalizeMode, setNormalizeMode] = useState("max");
  // transpose
  const [headerColumnId, setHeaderColumnId] = useState<string>("");
  // removeBaseline
  const [baselineMode, setBaselineMode] = useState("firstRow");
  const [baselineColumnId, setBaselineColumnId] = useState<string>("");
  const [baselineValue, setBaselineValue] = useState(0);
  // fractionOfTotal
  const [fractionScope, setFractionScope] = useState("column");
  const [asPercent, setAsPercent] = useState(false);

  // Seed the form each open. An edit reads the existing derivedFrom; a create
  // resets to sensible defaults (the first data column for the pickers).
  useEffect(() => {
    if (!open) return;
    const firstDataCol = dataColumns[0]?.id ?? "";
    if (isEdit && initialTransform) {
      const p = initialParams ?? {};
      setKind(initialTransform);
      setFunc((p.func as TransformFunction) ?? "log10");
      setLinearK(typeof p.k === "number" ? p.k : 1);
      setLinearB(typeof p.b === "number" ? p.b : 0);
      setNormalizeMode(typeof p.mode === "string" ? p.mode : "max");
      setHeaderColumnId(
        typeof p.headerColumnId === "string" ? p.headerColumnId : "",
      );
      // removeBaseline and normalize both carry a "mode"; route by transform.
      setBaselineMode(
        initialTransform === "removeBaseline" && typeof p.mode === "string"
          ? p.mode
          : initialTransform === "removeBaseline" && p.baselineColumnId
            ? "column"
            : "firstRow",
      );
      setBaselineColumnId(
        typeof p.baselineColumnId === "string"
          ? p.baselineColumnId
          : firstDataCol,
      );
      setBaselineValue(typeof p.value === "number" ? p.value : 0);
      setFractionScope(typeof p.scope === "string" ? p.scope : "column");
      setAsPercent(p.asPercent === true);
      return;
    }
    setKind("transform");
    setFunc("log10");
    setLinearK(1);
    setLinearB(0);
    setNormalizeMode("max");
    setHeaderColumnId("");
    setBaselineMode("firstRow");
    setBaselineColumnId(firstDataCol);
    setBaselineValue(0);
    setFractionScope("column");
    setAsPercent(false);
  }, [open, isEdit, initialTransform, initialParams, dataColumns]);

  // Escape closes (no soft-lock; the backdrop closes too).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // Assemble the params for the chosen transform, the SAME shape transforms.ts
  // reads. Used by both the preview and the submit so they never diverge.
  const params = useMemo<Record<string, unknown>>(() => {
    switch (kind) {
      case "transform":
        return func === "linear"
          ? { func, k: linearK, b: linearB }
          : { func };
      case "normalize":
        return { mode: normalizeMode };
      case "transpose":
        return headerColumnId ? { headerColumnId } : {};
      case "removeBaseline":
        if (baselineMode === "column")
          return { mode: "column", baselineColumnId };
        if (baselineMode === "value")
          return { mode: "value", value: baselineValue };
        return { mode: "firstRow" };
      case "fractionOfTotal":
        return { scope: fractionScope, asPercent };
      default:
        return {};
    }
  }, [
    kind,
    func,
    linearK,
    linearB,
    normalizeMode,
    headerColumnId,
    baselineMode,
    baselineColumnId,
    baselineValue,
    fractionScope,
    asPercent,
  ]);

  // A small live preview of the first few rows of the result, run against the
  // source content. Transforms are pure and cheap, so this recomputes on every
  // param change. A bad cell yields null (a blank), never a throw.
  const preview = useMemo(() => {
    if (!content) return null;
    try {
      const out = runTransform(kind, content, params);
      const cols = out.columns.slice(0, 6);
      const rows = out.rows.slice(0, 4);
      return { cols, rows };
    } catch {
      return null;
    }
  }, [content, kind, params]);

  if (!open) return null;

  const suggestedName = `${sourceName} (${NAME_SUFFIX[kind]})`;

  const submit = () => {
    onSubmit({ transform: kind, params, suggestedName });
  };

  const fmtCell = (v: number | string | null): string => {
    if (v === null) return "";
    if (typeof v === "number") {
      // Trim long decimals for the preview only; the stored result is full.
      return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
    }
    return v;
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-transform-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit transform" : "New transform"}
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface-overlay ros-popup-card-shadow"
      >
        <div className="border-b border-border px-5 pb-3 pt-4">
          <h2 className="text-title font-semibold text-foreground">
            {isEdit ? "Edit transform" : "Transform"}
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            {isEdit
              ? "A derived table is computed from its source, so it stays in step with edits to the source. Change the transform and the derived table recomputes."
              : "Make a new table computed from this one. It updates live when you edit the source, so you process the numbers once."}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
            Transform
          </label>
          <div className="mt-1 flex flex-col gap-2">
            {KIND_META.map((m) => {
              const active = kind === m.kind;
              return (
                <button
                  key={m.kind}
                  type="button"
                  onClick={() => setKind(m.kind)}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-sky-400 bg-accent-soft"
                      : "border-border bg-surface-raised hover:bg-surface-sunken"
                  }`}
                  data-testid={`datahub-transform-kind-${m.kind}`}
                >
                  <span className="block text-body font-medium text-foreground">
                    {m.label}
                  </span>
                  <span className="mt-0.5 block text-meta text-foreground-muted">
                    {m.blurb}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Kind-specific params. */}
          <div className="mt-4 flex flex-col gap-3">
            {kind === "transform" && (
              <>
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Function
                  </label>
                  <StyledSelect
                    className="mt-1"
                    value={func}
                    options={FUNCTION_OPTIONS}
                    onChange={(v) => setFunc(v as TransformFunction)}
                    ariaLabel="Transform function"
                  />
                </div>
                {func === "linear" && (
                  <div className="flex flex-wrap items-center gap-4">
                    <NumberField
                      label="k (multiplier)"
                      value={linearK}
                      onChange={setLinearK}
                      ariaLabel="Linear multiplier k"
                    />
                    <NumberField
                      label="b (offset)"
                      value={linearB}
                      onChange={setLinearB}
                      ariaLabel="Linear offset b"
                    />
                  </div>
                )}
              </>
            )}

            {kind === "normalize" && (
              <div>
                <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Baseline
                </label>
                <StyledSelect
                  className="mt-1"
                  value={normalizeMode}
                  options={NORMALIZE_OPTIONS}
                  onChange={setNormalizeMode}
                  ariaLabel="Normalize baseline"
                />
                <p className="mt-1 text-meta text-foreground-muted">
                  The result is in percent, so each column reads relative to its
                  own baseline.
                </p>
              </div>
            )}

            {kind === "transpose" && (
              <div>
                <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Title row from
                </label>
                <StyledSelect
                  className="mt-1"
                  value={headerColumnId}
                  options={[
                    { value: "", label: "Number the new columns" },
                    ...allColumns.map((c) => ({
                      value: c.id,
                      label: c.name || "(unnamed)",
                    })),
                  ]}
                  onChange={setHeaderColumnId}
                  ariaLabel="Transpose title column"
                />
                <p className="mt-1 text-meta text-foreground-muted">
                  Each new column is one of this table&apos;s rows. Pick a column whose
                  values should name them, or number them.
                </p>
              </div>
            )}

            {kind === "removeBaseline" && (
              <>
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Baseline
                  </label>
                  <StyledSelect
                    className="mt-1"
                    value={baselineMode}
                    options={REMOVE_BASELINE_OPTIONS}
                    onChange={setBaselineMode}
                    ariaLabel="Baseline source"
                  />
                </div>
                {baselineMode === "column" && (
                  <div>
                    <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Baseline column
                    </label>
                    <StyledSelect
                      className="mt-1"
                      value={baselineColumnId}
                      options={dataColumns.map((c) => ({
                        value: c.id,
                        label: c.name || "(unnamed)",
                      }))}
                      onChange={setBaselineColumnId}
                      ariaLabel="Baseline column"
                    />
                    <p className="mt-1 text-meta text-foreground-muted">
                      This column is subtracted from every other column, row by
                      row, then dropped from the result.
                    </p>
                  </div>
                )}
                {baselineMode === "value" && (
                  <NumberField
                    label="Subtract"
                    value={baselineValue}
                    onChange={setBaselineValue}
                    ariaLabel="Baseline constant"
                  />
                )}
              </>
            )}

            {kind === "fractionOfTotal" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Total
                  </span>
                  <Seg
                    value={fractionScope}
                    options={[
                      { value: "column", label: "Column" },
                      { value: "row", label: "Row" },
                      { value: "grand", label: "Grand" },
                    ]}
                    onChange={setFractionScope}
                    ariaLabel="Fraction total"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Output
                  </span>
                  <Seg
                    value={asPercent ? "percent" : "fraction"}
                    options={[
                      { value: "fraction", label: "Fraction" },
                      { value: "percent", label: "Percent" },
                    ]}
                    onChange={(v) => setAsPercent(v === "percent")}
                    ariaLabel="Fraction output"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live preview of the first rows of the result. */}
          {preview && preview.cols.length > 0 && (
            <div className="mt-4">
              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Preview
              </label>
              <div
                className="mt-1 overflow-auto rounded-md border border-border"
                data-testid="datahub-transform-preview"
              >
                <table className="border-collapse text-meta tabular-nums">
                  <thead>
                    <tr>
                      {preview.cols.map((c) => (
                        <th
                          key={c.id}
                          className="border border-border bg-surface-sunken px-2 py-1 text-center font-semibold text-foreground"
                        >
                          {c.name || "(unnamed)"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.id}>
                        {preview.cols.map((c) => (
                          <td
                            key={c.id}
                            className="border border-border bg-surface-raised px-2 py-1 text-center text-foreground-muted"
                          >
                            {fmtCell(row.cells[c.id] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-meta text-foreground-muted">
                The first rows of the result. A blank cell is a value the
                transform skips, like the log of a non-positive number.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral px-3 py-1.5 text-body font-medium text-foreground-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium"
            data-testid="datahub-transform-confirm"
          >
            {isEdit ? "Update transform" : "Create derived table"}
          </button>
        </div>
      </div>
    </div>
  );
}
