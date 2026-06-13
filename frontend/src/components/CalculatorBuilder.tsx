"use client";

// Custom Calculator Builder UI (Phase 1, 2026-06-10), gated by
// CALC_BUILDER_ENABLED. Three right-pane modes share one panel:
//   - Use:     run a saved or library calculator from its JSON spec, live.
//   - Edit:    the builder (name, description, inputs, steps, conditionals,
//              outputs, sharing) with a live preview.
//   - Library: the static template gallery grouped by field.
// The left rail (built-in calculators + My calculators + Build your own +
// Template library) lives in CalculatorsButton's modal; this file owns the Use
// and Edit and Library content. No new inline icon markup, all glyphs go
// through the Icon component from @/components/icons.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { calculatorsApi } from "@/lib/local-api";
import {
  evaluateCustomCalculator,
  deriveTableRows,
  formatCalcValue,
  isReservedName,
  type CustomCalcInputValues,
  type CustomCalcResult,
} from "@/lib/calculators/custom";
import {
  fetchAllCalculatorTemplates,
  templateToDraft,
  type CalculatorTemplate,
} from "@/lib/calculators/template-catalog";
import {
  deriveInputKey,
  insertIntoFormula,
  FORMULA_HELPER_CHIPS,
} from "@/lib/calculators/builder-helpers";
import { buildCalculatorSubmissionUrl } from "@/lib/calculators/submit-to-library";
import type {
  CustomCalculator,
  CustomCalculatorInput,
  CustomCalculatorTableColumn,
  CustomCalculatorStep,
  CustomCalculatorConditional,
  CustomCalculatorOutput,
  SharedUser,
} from "@/lib/types";
import {
  WHOLE_LAB_SENTINEL,
  isWholeLabShared,
} from "@/lib/sharing/unified";
import { EXTERNAL_COLLAB_ENABLED } from "@/lib/loro/config";
import CalculatorSendOutsideDialog from "@/components/sharing/CalculatorSendOutsideDialog";
import { useFileSystem } from "@/lib/file-system/file-system-context";

// ── Shared field styling (mirrors CalculatorsButton's inputCls/selectCls) ─────

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-body text-foreground bg-surface-raised focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400";
const selectCls =
  "rounded-lg border border-border px-2 py-2 text-body text-foreground bg-surface-raised focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-meta font-semibold text-foreground-muted mb-1">
      {children}
    </label>
  );
}

// ── A draft is the editable spec sans id/timestamps ──────────────────────────

interface CalcDraft {
  name: string;
  description: string;
  field: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  /** Unified sharing shape (Phase 2). The whole-lab share is the
   *  `{ username: "*", level: "read" }` entry, exactly like methods. */
  shared_with: SharedUser[];
}

function emptyDraft(): CalcDraft {
  return {
    name: "",
    description: "",
    field: "",
    inputs: [],
    steps: [],
    conditionals: [],
    outputs: [],
    shared_with: [],
  };
}

function calcToDraft(c: CustomCalculator): CalcDraft {
  return {
    name: c.name,
    description: c.description,
    field: c.field ?? "",
    inputs: c.inputs,
    steps: c.steps,
    conditionals: c.conditionals,
    outputs: c.outputs,
    shared_with: c.shared_with ?? [],
  };
}

/** A draft rendered as a CustomCalculator so the pure engine can evaluate it in
 *  the live preview (the id/timestamps are placeholders the engine ignores). */
function draftToCalc(d: CalcDraft): CustomCalculator {
  return {
    id: 0,
    name: d.name,
    description: d.description,
    field: d.field || undefined,
    inputs: d.inputs,
    steps: d.steps,
    conditionals: d.conditionals,
    outputs: d.outputs,
    shared_with: d.shared_with,
    created_at: "",
    updated_at: "",
  };
}

// ── Input value collection + default seeding ─────────────────────────────────

function seedValues(inputs: CustomCalculatorInput[]): CustomCalcInputValues {
  const values: CustomCalcInputValues = {};
  for (const input of inputs) {
    if (input.type === "replicate") {
      values[input.key] = Array.isArray(input.default) ? input.default : [];
    } else if (input.type === "dropdown") {
      values[input.key] =
        input.default !== undefined && !Array.isArray(input.default)
          ? input.default
          : input.options?.[0]?.value ?? "";
    } else if (input.type === "table") {
      // Seed the grid from the template's example rows (deep-copied so editing
      // does not mutate the spec). Computed columns are derived by the engine.
      values[input.key] = Array.isArray(input.rows)
        ? input.rows.map((r) => ({ ...r }))
        : [];
    } else {
      values[input.key] =
        typeof input.default === "number" ? input.default : "";
    }
  }
  return values;
}

// ── Engine reserved names ────────────────────────────────────────────────────
//
// An input / step / table-column key must NOT collide with a built-in engine
// function or constant, or the expression silently resolves to NaN. The builder
// surfaces this as an inline warning so the author renames before it bites. The
// reserved set is derived from the live parser in custom.ts (isReservedName), so
// it can never drift from what the engine actually registers (a new helper is
// reserved automatically), and the match is case-insensitive.

function isReservedKey(key: string): boolean {
  return isReservedName(key);
}

// ── Sharing control (Phase 2) ────────────────────────────────────────────────
//
// Two stored scopes for the calculator's own ACL: "me" (private, shared_with:
// []) and "lab" (the whole-lab "*" read share, a LIVE reference other members
// read through to your file). "External person" is not an ACL state, it is a
// one-off action that seals a COPY to someone outside the folder, so it opens
// the external send dialog rather than mutating shared_with. External send is
// gated behind EXTERNAL_COLLAB_ENABLED, the same flag as every other tier.

const LAB_READ_SHARE: SharedUser[] = [
  { username: WHOLE_LAB_SENTINEL, level: "read" },
];

type ShareScope = "me" | "lab";

function scopeOf(sharedWith: SharedUser[]): ShareScope {
  return isWholeLabShared(sharedWith) ? "lab" : "me";
}

const SHARE_OPTIONS: { id: ShareScope; label: string; why: string }[] = [
  { id: "me", label: "Just me", why: "Stays in your folder, visible only to you." },
  {
    id: "lab",
    label: "My lab",
    why: "Everyone in your lab folder can run it. They see your latest, you stay the only editor.",
  },
];

function SharingControl({
  sharedWith,
  onChange,
  onSendExternal,
  canSendExternal,
  onSubmitToLibrary,
}: {
  sharedWith: SharedUser[];
  onChange: (next: SharedUser[]) => void;
  /** Open the external send dialog. Undefined hides the External button (flag
   *  off). Passing it but with `canSendExternal` false keeps it disabled with a
   *  save-first hint. */
  onSendExternal?: () => void;
  canSendExternal?: boolean;
  /** Open a pre-filled GitHub submission so the calculator can be considered
   *  for the shared template library. Reviewed, not instant. */
  onSubmitToLibrary?: () => void;
}) {
  const scope = scopeOf(sharedWith);
  return (
    <div>
      <FieldLabel>Sharing</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-meta font-semibold">
          {SHARE_OPTIONS.map((opt) => (
            <Tooltip key={opt.id} label={opt.why} placement="top">
              <button
                type="button"
                aria-pressed={scope === opt.id}
                onClick={() => onChange(opt.id === "lab" ? LAB_READ_SHARE : [])}
                className={
                  "px-3 py-1.5 transition-colors " +
                  (scope === opt.id
                    ? "bg-sky-600 text-white"
                    : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken")
                }
              >
                {opt.label}
              </button>
            </Tooltip>
          ))}
        </div>
        {onSendExternal && (
          <Tooltip
            label={
              canSendExternal
                ? "Send an encrypted copy to someone outside your lab folder."
                : "Save the calculator first, then you can send a copy."
            }
            placement="top"
          >
            <button
              type="button"
              onClick={onSendExternal}
              disabled={!canSendExternal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-meta font-semibold text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon name="share" className="w-4 h-4" />
              External person
            </button>
          </Tooltip>
        )}
      </div>
      <p className="mt-1 text-meta text-foreground-muted">
        My lab shares a live reference, lab members run your latest copy and you
        stay the only editor. External sends a separate encrypted copy the
        recipient then owns.
      </p>
      {onSubmitToLibrary && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onSubmitToLibrary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-meta font-semibold text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
          >
            <Icon name="library" className="w-4 h-4" />
            Share to the library
          </button>
          <p className="mt-1 text-meta text-foreground-muted">
            Opens a pre-filled GitHub submission in a new tab. A maintainer
            reviews it, and if it fits it ships in a later release so every lab
            gets it. Nothing is added automatically.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Replicate multi-box row ──────────────────────────────────────────────────

function ReplicateRow({
  values,
  onChange,
}: {
  values: number[];
  onChange: (next: number[]) => void;
}) {
  // Always show one trailing blank box so the user can keep adding values.
  const display = [...values.map((v) => String(v)), ""];
  const setAt = (i: number, raw: string) => {
    const next = display.map((v, j) => (j === i ? raw : v));
    const parsed = next
      .map((v) => v.trim())
      .filter((v) => v !== "")
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    onChange(parsed);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {display.map((v, i) => (
        <input
          key={i}
          type="number"
          inputMode="decimal"
          value={v}
          onChange={(e) => setAt(i, e.target.value)}
          aria-label={`Replicate value ${i + 1}`}
          className="w-20 rounded-lg border border-border px-2 py-1.5 text-body text-foreground bg-surface-raised focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400"
        />
      ))}
    </div>
  );
}

// ── Table input grid (Phase 5) ───────────────────────────────────────────────
//
// A mini-spreadsheet. Input columns are editable per row; computed columns show
// the engine-derived value live (read-only). Rows add / remove unless the whole
// calculator is shared-in (non-owner), where the grid is fully read-only,
// consistent with the rest of the Use view.

function TableInputGrid({
  calc,
  values,
  input,
  onChange,
  readOnly = false,
}: {
  calc: CustomCalculator;
  values: CustomCalcInputValues;
  input: CustomCalculatorInput;
  onChange: (rows: Record<string, number | string>[]) => void;
  readOnly?: boolean;
}) {
  const columns = input.columns ?? [];
  const rawRows = Array.isArray(values[input.key])
    ? (values[input.key] as Record<string, number | string>[])
    : [];
  // Engine-derived rows (computed columns filled in) for the read-only cells.
  const derived = deriveTableRows(calc, values, input.key);

  const setCell = (rowIdx: number, colKey: string, raw: string) => {
    const next = rawRows.map((r, j) =>
      j === rowIdx ? { ...r, [colKey]: raw } : { ...r },
    );
    onChange(next);
  };
  const addRow = () => {
    const blank: Record<string, number | string> = {};
    for (const c of columns) if (c.kind === "input") blank[c.key] = "";
    onChange([...rawRows.map((r) => ({ ...r })), blank]);
  };
  const removeRow = (rowIdx: number) =>
    onChange(rawRows.filter((_, j) => j !== rowIdx));

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="bg-surface-sunken">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="text-left px-3 py-2 text-meta font-semibold text-foreground-muted"
                >
                  {c.label}
                  {c.unit ? (
                    <span className="ml-1 font-normal">({c.unit})</span>
                  ) : null}
                </th>
              ))}
              {!readOnly && <th className="w-10" aria-hidden />}
            </tr>
          </thead>
          <tbody>
            {rawRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (readOnly ? 0 : 1)}
                  className="px-3 py-3 text-meta text-foreground-muted"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              rawRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-t border-border">
                  {columns.map((c) => {
                    if (c.kind === "computed") {
                      const cell = derived[rowIdx]?.[c.key];
                      const display =
                        typeof cell === "number"
                          ? formatCalcValue(cell)
                          : cell !== undefined && cell !== ""
                            ? String(cell)
                            : "—";
                      return (
                        <td
                          key={c.key}
                          className="px-3 py-1.5 text-foreground tabular-nums"
                        >
                          {display}
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className="px-2 py-1.5">
                        <input
                          value={
                            row[c.key] === undefined || row[c.key] === null
                              ? ""
                              : String(row[c.key])
                          }
                          onChange={(e) => setCell(rowIdx, c.key, e.target.value)}
                          disabled={readOnly}
                          aria-label={`${c.label} row ${rowIdx + 1}`}
                          className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground bg-surface-raised focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 disabled:opacity-60"
                        />
                      </td>
                    );
                  })}
                  {!readOnly && (
                    <td className="px-1 py-1.5 text-center">
                      <Tooltip label="Remove row" placement="top">
                        <button
                          type="button"
                          onClick={() => removeRow(rowIdx)}
                          aria-label={`Remove row ${rowIdx + 1}`}
                          className="w-7 h-7 rounded-md border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 inline-flex items-center justify-center transition-colors"
                        >
                          <Icon name="close" className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="px-3 py-2 border-t border-border">
          <AddButton label="Add row" onClick={addRow} />
        </div>
      )}
    </div>
  );
}

// ── The Use view (run a calculator) ──────────────────────────────────────────

export function CalculatorUseView({
  calc,
  onEdit,
}: {
  calc: CustomCalculator;
  onEdit?: () => void;
}) {
  const [values, setValues] = useState<CustomCalcInputValues>(() =>
    seedValues(calc.inputs),
  );

  // Re-seed when the selected calculator changes.
  useEffect(() => {
    setValues(seedValues(calc.inputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc.id]);

  const result: CustomCalcResult = useMemo(
    () => evaluateCustomCalculator(calc, values),
    [calc, values],
  );

  const setValue = (
    key: string,
    value: CustomCalcInputValues[string],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  // A calculator shared in via the whole-lab "*" reference is READ-ONLY for the
  // viewer (the owner stays the only editor; their edits propagate). Suppress
  // the Edit affordance and badge it so the viewer knows why.
  const sharedIn = calc.is_shared_with_me === true;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-title font-bold text-foreground">{calc.name}</h3>
            {sharedIn && (
              <Tooltip
                label={
                  calc.owner
                    ? `Shared by ${calc.owner}. You can run it; only the owner edits it.`
                    : "Shared with your lab. You can run it; only the owner edits it."
                }
                placement="top"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-meta font-semibold">
                  <Icon name="users" className="w-3.5 h-3.5" />
                  Lab
                </span>
              </Tooltip>
            )}
          </div>
          {calc.description && (
            <p className="mt-0.5 text-body text-foreground-muted">{calc.description}</p>
          )}
        </div>
        {onEdit && !sharedIn && (
          <Tooltip label="Edit this calculator" placement="top">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit this calculator"
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-meta font-medium text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
            >
              <Icon name="pencil" className="w-4 h-4" />
              Edit
            </button>
          </Tooltip>
        )}
      </div>

      <div className="space-y-3">
        {calc.inputs.map((input) => (
          <div key={input.key}>
            <FieldLabel>
              {input.label}
              {input.unit ? (
                <span className="ml-1 font-normal text-foreground-muted">({input.unit})</span>
              ) : null}
            </FieldLabel>
            {input.type === "table" ? (
              <TableInputGrid
                calc={calc}
                values={values}
                input={input}
                onChange={(rows) => setValue(input.key, rows)}
                readOnly={sharedIn}
              />
            ) : input.type === "replicate" ? (
              <ReplicateRow
                values={Array.isArray(values[input.key]) ? (values[input.key] as number[]) : []}
                onChange={(next) => setValue(input.key, next)}
              />
            ) : input.type === "dropdown" ? (
              <select
                value={String(values[input.key] ?? "")}
                onChange={(e) => {
                  // Recover the option's typed value (number or string).
                  const opt = input.options?.find((o) => String(o.value) === e.target.value);
                  setValue(input.key, opt ? opt.value : e.target.value);
                }}
                className={selectCls + " w-full"}
                aria-label={input.label}
              >
                {input.options?.map((opt) => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                value={
                  typeof values[input.key] === "number" || typeof values[input.key] === "string"
                    ? String(values[input.key] ?? "")
                    : ""
                }
                onChange={(e) => setValue(input.key, e.target.value)}
                className={inputCls}
                aria-label={input.label}
              />
            )}
          </div>
        ))}
      </div>

      {/* Results */}
      <div className="rounded-xl border border-sky-100 bg-sky-50/60 dark:bg-sky-500/15 p-4 space-y-1">
        {result.outputs.length === 0 ? (
          <p className="text-body text-foreground-muted">No outputs defined yet.</p>
        ) : (
          result.outputs.map((o, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 py-1">
              <span className="text-body text-foreground-muted">
                {o.label}
                {o.unit ? <span className="ml-1 text-meta">({o.unit})</span> : null}
              </span>
              <span className="text-title font-semibold text-foreground tabular-nums">
                {o.display}
              </span>
            </div>
          ))
        )}
        {result.messages.length > 0 && (
          <div className="mt-2 pt-2 border-t border-sky-100 space-y-1">
            {result.messages.map((m, i) => (
              <p
                key={i}
                className="flex items-start gap-1.5 text-body text-amber-700 dark:text-amber-300"
              >
                <Icon name="alert" className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {m}
              </p>
            ))}
          </div>
        )}
      </div>

      <p className="text-meta text-foreground-muted">
        Computed live in your browser. Nothing here leaves your folder.
      </p>
    </div>
  );
}

// ── Small list-editor primitives for the builder ─────────────────────────────

function RowShell({
  children,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-2">{children}</div>
        <Tooltip label={removeLabel} placement="top">
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="flex-shrink-0 w-9 h-9 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-body font-medium text-sky-700 dark:text-sky-300 hover:text-sky-900 inline-flex items-center gap-1.5"
    >
      <Icon name="plus" className="w-4 h-4" />
      {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
      {children}
    </p>
  );
}

// ── Section header with a one-line plain explanation ─────────────────────────
//
// Plain-language labels were one of the five approved fixes: each section says
// what it is for in human words, so the author is never staring at a bare,
// jargon-only heading wondering where to start.

function SectionHeader({
  title,
  help,
}: {
  title: string;
  help: string;
}) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <p className="mt-0.5 text-meta font-normal normal-case text-foreground-muted">
        {help}
      </p>
    </div>
  );
}

// ── Clickable variable + helper chips above a formula box ────────────────────
//
// The author clicks a variable name (an input key or an earlier step key) or a
// helper (mean, sum, count, if, col) to drop it straight into the formula,
// instead of remembering and hand-typing the exact short names. The live result
// next to the box (rendered by the caller) then updates, so the formula feels
// alive while it is being written.

function FormulaChips({
  variables,
  onInsert,
}: {
  variables: string[];
  onInsert: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
      <span className="text-meta text-foreground-muted mr-0.5">
        Click to insert:
      </span>
      {variables.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="font-mono text-meta font-semibold px-2 py-0.5 rounded-full border border-border bg-surface-sunken text-foreground hover:border-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
        >
          {v}
        </button>
      ))}
      {FORMULA_HELPER_CHIPS.map((h) => (
        <button
          key={h.label}
          type="button"
          onClick={() => onInsert(h.insert)}
          className="font-mono text-meta font-semibold px-2 py-0.5 rounded-full border border-border bg-surface-sunken text-purple-600 dark:text-purple-300 hover:border-sky-400 transition-colors"
        >
          {h.label}
        </button>
      ))}
    </div>
  );
}

// ── Auto short-name hint with an optional manual override ────────────────────
//
// Shows the formula key that was auto-derived from the input's label ("used in
// formulas as `colonies`"), with a small Rename toggle that reveals an editable
// field for the rare case the author wants a different name. Editing it sets the
// key directly, which the parent then treats as a manual override (the key stops
// tracking the label).

function InputKeyHint({
  keyValue,
  onChange,
}: {
  keyValue: string;
  onChange: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-meta text-foreground-muted">Formula name</span>
        <input
          value={keyValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="key"
          aria-label="Formula name (advanced)"
          autoFocus
          className={inputCls + " font-mono sm:w-48"}
        />
      </div>
    );
  }
  return (
    <p className="text-meta text-foreground-muted">
      used in formulas as{" "}
      <span className="font-mono font-semibold text-sky-700 dark:text-sky-300">
        {keyValue || "—"}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="ml-2 font-semibold text-sky-700 dark:text-sky-300 hover:underline"
      >
        Rename
      </button>
    </p>
  );
}

// ── The Edit view (the builder) ──────────────────────────────────────────────

export function CalculatorEditView({
  initial,
  existingId,
  onSaved,
  onCancel,
  onStartFromTemplate,
  onSwitchToWizard,
}: {
  initial: CalcDraft;
  /** When set, save patches that record; otherwise a new record is created. */
  existingId?: number;
  onSaved: (saved: CustomCalculator) => void;
  onCancel: () => void;
  /** Open the template library as the prominent front door. Omitted hides the
   *  header button (e.g. when editing an already-saved calculator). */
  onStartFromTemplate?: () => void;
  /** Hand the in-progress draft to the step-by-step wizard, carrying the data
   *  unchanged. Omitted hides the offer. */
  onSwitchToWizard?: (draft: CalcDraft) => void;
}) {
  const [draft, setDraft] = useState<CalcDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Steps + Guidance live under an Advanced disclosure so a basic calculator
  // (Inputs + a Result formula) is all the author sees by default. Auto-open
  // when the draft already uses them, so editing a template that relies on a
  // step or a warning never hides that logic.
  const [advancedOpen, setAdvancedOpen] = useState(
    initial.steps.length > 0 || initial.conditionals.length > 0,
  );
  // External send dialog. Only meaningful for a SAVED calculator (it seals the
  // record's current snapshot), so it carries the saved CustomCalculator.
  const [externalCalc, setExternalCalc] = useState<CustomCalculator | null>(null);
  const { currentUser } = useFileSystem();

  // Live preview values, re-seeded whenever the input set changes shape.
  const [previewValues, setPreviewValues] = useState<CustomCalcInputValues>(() =>
    seedValues(initial.inputs),
  );
  const inputKeys = draft.inputs.map((i) => `${i.key}:${i.type}`).join("|");
  useEffect(() => {
    setPreviewValues(seedValues(draft.inputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKeys]);

  const previewCalc = useMemo(() => draftToCalc(draft), [draft]);
  const preview = useMemo(
    () => evaluateCustomCalculator(previewCalc, previewValues),
    [previewCalc, previewValues],
  );

  const patch = (p: Partial<CalcDraft>) => setDraft((d) => ({ ...d, ...p }));

  // Variable chips above the Result formula: every input key plus every step
  // key (steps are intermediate values usable in later formulas). Empty keys
  // (a half-typed new input) are dropped so a blank chip never appears.
  const outputVariables = useMemo(
    () => [
      ...draft.inputs.map((x) => x.key).filter(Boolean),
      ...draft.steps.map((x) => x.key).filter(Boolean),
    ],
    [draft.inputs, draft.steps],
  );

  // Inputs
  const addInput = () =>
    patch({
      inputs: [
        ...draft.inputs,
        // New rows start with no key; it is auto-derived from the label as the
        // author types, so they never hand-edit a separate identifier field.
        { key: "", type: "number", label: "" },
      ],
    });
  const updateInput = (i: number, p: Partial<CustomCalculatorInput>) =>
    patch({ inputs: draft.inputs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const removeInput = (i: number) =>
    patch({ inputs: draft.inputs.filter((_, j) => j !== i) });

  // Auto short-name: when the author edits an input's plain-language label, the
  // formula key follows along (camelCase, valid, non-reserved, unique), UNLESS
  // they have manually overridden the key. We detect a manual override by
  // checking whether the current key still matches what the previous label
  // would have derived; if it diverged, the key is hand-set and we leave it.
  const updateInputLabel = (i: number, label: string) => {
    const current = draft.inputs[i];
    const others = draft.inputs
      .filter((_, j) => j !== i)
      .map((x) => x.key);
    const keyWasAuto =
      current.key === "" ||
      current.key === deriveInputKey(current.label, others);
    if (keyWasAuto) {
      updateInput(i, { label, key: deriveInputKey(label, others) });
    } else {
      updateInput(i, { label });
    }
  };

  // Steps
  const addStep = () =>
    patch({ steps: [...draft.steps, { key: `step${draft.steps.length + 1}`, expr: "" }] });
  const updateStep = (i: number, p: Partial<CustomCalculatorStep>) =>
    patch({ steps: draft.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const removeStep = (i: number) =>
    patch({ steps: draft.steps.filter((_, j) => j !== i) });

  // Conditionals
  const addConditional = () =>
    patch({ conditionals: [...draft.conditionals, { expr: "" }] });
  const updateConditional = (i: number, expr: string) =>
    patch({
      conditionals: draft.conditionals.map((x, j) => (j === i ? { expr } : x)),
    });
  const removeConditional = (i: number) =>
    patch({ conditionals: draft.conditionals.filter((_, j) => j !== i) });

  // Outputs
  const addOutput = () =>
    patch({ outputs: [...draft.outputs, { label: "", expr: "" }] });
  const updateOutput = (i: number, p: Partial<CustomCalculatorOutput>) =>
    patch({ outputs: draft.outputs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const removeOutput = (i: number) =>
    patch({ outputs: draft.outputs.filter((_, j) => j !== i) });

  const canSave = draft.name.trim() !== "" && draft.outputs.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        field: draft.field.trim() || undefined,
        inputs: draft.inputs,
        steps: draft.steps,
        conditionals: draft.conditionals,
        outputs: draft.outputs,
        shared_with: draft.shared_with,
      };
      const saved =
        existingId !== undefined
          ? await calculatorsApi.update(existingId, payload)
          : await calculatorsApi.create(payload);
      if (saved) onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the calculator.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-title font-bold text-foreground">
          {existingId !== undefined ? "Edit calculator" : "Build your own"}
        </h3>
        <div className="flex items-center gap-2">
          {onStartFromTemplate && (
            <button
              type="button"
              onClick={onStartFromTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-meta font-semibold text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
            >
              <Icon name="library" className="w-4 h-4" />
              Start from a template
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg border border-border text-meta font-medium text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-1.5 text-meta font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="save" className="w-4 h-4" />
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>

      {onSwitchToWizard && (
        <button
          type="button"
          onClick={() => onSwitchToWizard(draft)}
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-sky-700 dark:text-sky-300 hover:text-sky-900"
        >
          <Icon name="list" className="w-4 h-4" />
          Use the step-by-step wizard instead
        </button>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-body text-red-600 dark:text-red-400">
          <Icon name="alert" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel>Name</FieldLabel>
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. CFU per mL"
            className={inputCls}
          />
        </div>
        <div>
          <FieldLabel>Field (optional)</FieldLabel>
          <input
            value={draft.field}
            onChange={(e) => patch({ field: e.target.value })}
            placeholder="e.g. Microbiology"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <FieldLabel>Description (optional)</FieldLabel>
        <input
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="One line on what this computes and why."
          className={inputCls}
        />
      </div>

      {/* Inputs */}
      <div className="space-y-2">
        <SectionHeader
          title="Inputs"
          help="The boxes you type measurements into when you run the calculator."
        />
        {draft.inputs.map((input, i) => (
          <RowShell key={i} onRemove={() => removeInput(i)} removeLabel="Remove input">
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
              <input
                value={input.label}
                onChange={(e) => updateInputLabel(i, e.target.value)}
                placeholder="e.g. Colonies counted"
                aria-label="Input label"
                className={inputCls}
              />
              <select
                value={input.type}
                onChange={(e) =>
                  updateInput(i, {
                    type: e.target.value as CustomCalculatorInput["type"],
                    // Seed an options array when switching to dropdown.
                    ...(e.target.value === "dropdown" && !input.options
                      ? { options: [{ label: "Option A", value: 1 }] }
                      : {}),
                    // Seed a starter column set when switching to a table.
                    ...(e.target.value === "table" && !input.columns
                      ? {
                          columns: [
                            { key: "item", label: "Item", kind: "input" },
                            { key: "amount", label: "Amount", kind: "input" },
                          ] as CustomCalculatorTableColumn[],
                        }
                      : {}),
                  })
                }
                aria-label="Input type"
                className={selectCls + " w-full"}
              >
                <option value="number">Number</option>
                <option value="replicate">Replicate list</option>
                <option value="dropdown">Dropdown</option>
                <option value="table">Table</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={input.unit ?? ""}
                onChange={(e) => updateInput(i, { unit: e.target.value || undefined })}
                placeholder="Unit (optional)"
                aria-label="Input unit"
                className={inputCls}
              />
              {input.type === "number" && (
                <input
                  type="number"
                  inputMode="decimal"
                  value={typeof input.default === "number" ? String(input.default) : ""}
                  onChange={(e) =>
                    updateInput(i, {
                      default: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="Default (optional)"
                  aria-label="Input default"
                  className={inputCls}
                />
              )}
            </div>
            <InputKeyHint
              keyValue={input.key}
              onChange={(key) => updateInput(i, { key })}
            />
            {isReservedKey(input.key) && (
              <p className="text-meta text-amber-700 dark:text-amber-300">
                {`"${input.key.trim()}" is a built-in name, so the formula will read it as the function, not your input. Rename it below.`}
              </p>
            )}
            {input.type === "dropdown" && (
              <DropdownOptionsEditor
                options={input.options ?? []}
                onChange={(opts) => updateInput(i, { options: opts })}
              />
            )}
            {input.type === "table" && (
              <TableColumnsEditor
                columns={input.columns ?? []}
                onChange={(cols) => updateInput(i, { columns: cols })}
              />
            )}
          </RowShell>
        ))}
        <AddButton label="Add input" onClick={addInput} />
      </div>

      {/* Result (outputs). Relabelled as the answer, because "Outputs" read as
          jargon. Each formula box carries clickable variable + helper chips and
          a live result, the third approved fix. */}
      <div className="space-y-2">
        <SectionHeader
          title="Result"
          help="The answer, written as a formula using the input names above."
        />
        {draft.outputs.map((out, i) => (
          <RowShell key={i} onRemove={() => removeOutput(i)} removeLabel="Remove result">
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <input
                  value={out.label}
                  onChange={(e) => updateOutput(i, { label: e.target.value })}
                  placeholder="Answer label, e.g. CFU per mL"
                  aria-label="Result label"
                  className={inputCls}
                />
                <input
                  value={out.unit ?? ""}
                  onChange={(e) => updateOutput(i, { unit: e.target.value || undefined })}
                  placeholder="Unit"
                  aria-label="Result unit"
                  className={inputCls + " sm:w-24"}
                />
              </div>
              <div>
                <FormulaChips
                  variables={outputVariables}
                  onInsert={(text) =>
                    updateOutput(i, { expr: insertIntoFormula(out.expr, text) })
                  }
                />
                <input
                  value={out.expr}
                  onChange={(e) => updateOutput(i, { expr: e.target.value })}
                  placeholder="formula, e.g. colonies / (dilution * platedVol)"
                  aria-label="Result formula"
                  className={inputCls + " font-mono"}
                />
                {/* Live result for this output, from the engine over the seeded
                    preview values, so the formula feels alive while typing. */}
                <div className="mt-2 flex items-baseline justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                  <span className="text-meta text-foreground-muted">
                    With your example values
                  </span>
                  <span className="text-title font-bold text-sky-700 dark:text-sky-300 tabular-nums">
                    {preview.outputs[i]?.display ?? "—"}
                    {out.unit ? (
                      <span className="ml-1 text-meta font-normal">{out.unit}</span>
                    ) : null}
                  </span>
                </div>
              </div>
              {/* Number format. Auto keeps the clean default; Scientific reads a
                  large value as 2.5e8; Fixed pins the decimal count. */}
              <div className="flex items-center gap-2">
                <span className="text-meta text-foreground-muted">Format</span>
                <select
                  value={out.format ?? "auto"}
                  onChange={(e) => {
                    const fmt = e.target.value as
                      | "auto"
                      | "scientific"
                      | "fixed";
                    updateOutput(
                      i,
                      fmt === "auto"
                        ? { format: undefined, decimals: undefined }
                        : { format: fmt },
                    );
                  }}
                  className={selectCls}
                  aria-label="Output number format"
                >
                  <option value="auto">Auto</option>
                  <option value="scientific">Scientific</option>
                  <option value="fixed">Fixed</option>
                </select>
                {(out.format === "scientific" || out.format === "fixed") && (
                  <label className="flex items-center gap-1 text-meta text-foreground-muted">
                    Decimals
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={out.decimals ?? 2}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          updateOutput(i, { decimals: undefined });
                          return;
                        }
                        const n = Math.min(
                          20,
                          Math.max(0, Math.trunc(Number(raw))),
                        );
                        updateOutput(i, {
                          decimals: Number.isFinite(n) ? n : undefined,
                        });
                      }}
                      aria-label="Output decimal places"
                      className={inputCls + " w-16"}
                    />
                  </label>
                )}
              </div>
            </div>
          </RowShell>
        ))}
        <AddButton label="Add another result" onClick={addOutput} />
      </div>

      {/* Advanced logic disclosure. Steps + Guidance live here so a basic
          calculator (Inputs + a Result formula) is all the author sees by
          default, the second approved fix. Auto-opened when the draft already
          uses a step or a warning, so editing a template never hides its
          logic. */}
      <div className="border-t border-dashed border-border pt-3">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-2 text-body font-semibold text-foreground"
        >
          <Icon
            name="chevronRight"
            className={
              "w-4 h-4 text-foreground-muted transition-transform " +
              (advancedOpen ? "rotate-90" : "")
            }
          />
          Advanced logic (optional)
        </button>
        <p className="mt-1 text-meta text-foreground-muted">
          Most calculators do not need this. Open it only if you want a named
          intermediate value (a Step) or a warning message (Guidance), like a
          count is too low note.
        </p>
        {advancedOpen && (
          <div className="mt-3 space-y-5">
            {/* Steps */}
            <div className="space-y-2">
              <SectionHeader
                title="Steps (intermediate values)"
                help="A named value computed once, then reused in the result or in later steps."
              />
              {draft.steps.map((step, i) => (
                <RowShell
                  key={i}
                  onRemove={() => removeStep(i)}
                  removeLabel="Remove step"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                    <input
                      value={step.key}
                      onChange={(e) => updateStep(i, { key: e.target.value })}
                      placeholder="name"
                      aria-label="Step name"
                      className={inputCls + " font-mono"}
                    />
                    <div>
                      <FormulaChips
                        variables={outputVariables}
                        onInsert={(text) =>
                          updateStep(i, {
                            expr: insertIntoFormula(step.expr, text),
                          })
                        }
                      />
                      <input
                        value={step.expr}
                        onChange={(e) => updateStep(i, { expr: e.target.value })}
                        placeholder="expression, e.g. mean(live)"
                        aria-label="Step expression"
                        className={inputCls + " font-mono"}
                      />
                    </div>
                  </div>
                </RowShell>
              ))}
              <AddButton label="Add step" onClick={addStep} />
            </div>

            {/* Guidance (conditionals) */}
            <div className="space-y-2">
              <SectionHeader
                title="Guidance (warnings)"
                help="An optional message shown when a condition is met, like a quality flag."
              />
              {draft.conditionals.map((cond, i) => (
                <RowShell
                  key={i}
                  onRemove={() => removeConditional(i)}
                  removeLabel="Remove guidance"
                >
                  <input
                    value={cond.expr}
                    onChange={(e) => updateConditional(i, e.target.value)}
                    placeholder={'if(viability < 80, "Viability below 80%", "")'}
                    aria-label="Guidance expression"
                    className={inputCls + " font-mono"}
                  />
                </RowShell>
              ))}
              <AddButton label="Add guidance" onClick={addConditional} />
            </div>
          </div>
        )}
      </div>

      {/* Sharing */}
      <SharingControl
        sharedWith={draft.shared_with}
        onChange={(next) => patch({ shared_with: next })}
        onSendExternal={
          EXTERNAL_COLLAB_ENABLED
            ? () => {
                // External send seals the SAVED snapshot. Only available for an
                // already-saved calculator (existingId set); the tooltip + the
                // disabled state tell the user to save first otherwise.
                if (existingId === undefined) return;
                setExternalCalc({
                  ...draftToCalc(draft),
                  id: existingId,
                });
              }
            : undefined
        }
        canSendExternal={existingId !== undefined && !saving}
        onSubmitToLibrary={() => {
          // Submission carries the calculator as JSON in a pre-filled GitHub
          // issue body, so it works from the unsaved draft too (no save-first
          // gate, unlike the external encrypted send which seals a stored
          // snapshot). noopener keeps the new tab from reaching back here.
          window.open(
            buildCalculatorSubmissionUrl(draftToCalc(draft)),
            "_blank",
            "noopener",
          );
        }}
      />

      {/* Live preview */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <SectionTitle>Live preview</SectionTitle>
        {/* Table inputs render an editable example grid here. Edits both drive
            the preview AND are saved as the calculator's seed rows, so the
            author ships a worked example with the spec. */}
        {draft.inputs
          .filter((input) => input.type === "table")
          .map((input) => {
            const idx = draft.inputs.findIndex((x) => x.key === input.key);
            return (
              <div key={input.key} className="space-y-1">
                <FieldLabel>
                  {input.label || input.key}
                  <span className="ml-1 font-normal text-foreground-muted">
                    (seed rows)
                  </span>
                </FieldLabel>
                <TableInputGrid
                  calc={previewCalc}
                  values={previewValues}
                  input={input}
                  onChange={(rows) => {
                    setPreviewValues((prev) => ({ ...prev, [input.key]: rows }));
                    updateInput(idx, {
                      rows: rows.map((r) => ({ ...r })),
                    });
                  }}
                />
              </div>
            );
          })}
        {draft.outputs.length === 0 ? (
          <p className="text-body text-foreground-muted">
            Add an output to preview the result.
          </p>
        ) : (
          <div className="space-y-1">
            {preview.outputs.map((o, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className="text-body text-foreground-muted">
                  {o.label || `Output ${i + 1}`}
                  {o.unit ? <span className="ml-1 text-meta">({o.unit})</span> : null}
                </span>
                <span className="text-body font-semibold text-foreground tabular-nums">
                  {o.display}
                </span>
              </div>
            ))}
            {preview.messages.map((m, i) => (
              <p key={i} className="text-meta text-amber-700 dark:text-amber-300">
                {m}
              </p>
            ))}
          </div>
        )}
        <p className="text-meta text-foreground-muted">
          Preview uses each input default, so blanks show a dash until you set
          one.
        </p>
      </div>

      {externalCalc && (
        <CalculatorSendOutsideDialog
          calculator={externalCalc}
          ownerUsername={currentUser ?? ""}
          onClose={() => setExternalCalc(null)}
        />
      )}
    </div>
  );
}

function DropdownOptionsEditor({
  options,
  onChange,
}: {
  options: { label: string; value: number | string }[];
  onChange: (opts: { label: string; value: number | string }[]) => void;
}) {
  const update = (i: number, p: Partial<{ label: string; value: number | string }>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const remove = (i: number) => onChange(options.filter((_, j) => j !== i));
  const add = () => onChange([...options, { label: "", value: "" }]);

  // Preserve a numeric value as a number, otherwise keep the raw string (enum).
  const coerce = (raw: string): number | string => {
    if (raw.trim() === "") return "";
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
  };

  return (
    <div className="space-y-1.5 pl-1 border-l-2 border-border">
      <p className="text-meta text-foreground-muted pl-2">Dropdown options</p>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2 pl-2">
          <input
            value={opt.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Option label"
            aria-label="Option label"
            className={inputCls}
          />
          <input
            value={String(opt.value)}
            onChange={(e) => update(i, { value: coerce(e.target.value) })}
            placeholder="value (number or text)"
            aria-label="Option value"
            className={inputCls + " font-mono"}
          />
          <Tooltip label="Remove option" placement="top">
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove option"
              className="flex-shrink-0 w-8 h-8 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      ))}
      <div className="pl-2">
        <AddButton label="Add option" onClick={add} />
      </div>
    </div>
  );
}

function TableColumnsEditor({
  columns,
  onChange,
}: {
  columns: CustomCalculatorTableColumn[];
  onChange: (cols: CustomCalculatorTableColumn[]) => void;
}) {
  const update = (i: number, p: Partial<CustomCalculatorTableColumn>) =>
    onChange(columns.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const remove = (i: number) => onChange(columns.filter((_, j) => j !== i));
  const add = () =>
    onChange([
      ...columns,
      { key: `col${columns.length + 1}`, label: "", kind: "input" },
    ]);
  // Reorder by swapping with the neighbour, so a column can move up / down.
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2 pl-1 border-l-2 border-border">
      <p className="text-meta text-foreground-muted pl-2">
        Columns. Input columns the user fills per row; a computed column derives
        per row from the other columns plus your inputs and steps.
      </p>
      {columns.map((col, i) => (
        <div key={i} className="pl-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={col.key}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder="key"
              aria-label="Column key"
              className={inputCls + " font-mono"}
            />
            <input
              value={col.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label"
              aria-label="Column label"
              className={inputCls}
            />
            <input
              value={col.unit ?? ""}
              onChange={(e) => update(i, { unit: e.target.value || undefined })}
              placeholder="Unit"
              aria-label="Column unit"
              className={inputCls + " sm:w-20"}
            />
            <select
              value={col.kind}
              onChange={(e) =>
                update(i, {
                  kind: e.target.value as CustomCalculatorTableColumn["kind"],
                })
              }
              aria-label="Column kind"
              className={selectCls}
            >
              <option value="input">Input</option>
              <option value="computed">Computed</option>
            </select>
            <Tooltip label="Move up" placement="top">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move column up"
                className="flex-shrink-0 w-8 h-8 rounded-lg border border-border text-foreground-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Icon name="chevronDown" className="w-4 h-4 rotate-180" />
              </button>
            </Tooltip>
            <Tooltip label="Move down" placement="top">
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === columns.length - 1}
                aria-label="Move column down"
                className="flex-shrink-0 w-8 h-8 rounded-lg border border-border text-foreground-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Icon name="chevronDown" className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip label="Remove column" placement="top">
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove column"
                className="flex-shrink-0 w-8 h-8 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
              >
                <Icon name="close" className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
          {col.kind === "computed" && (
            <input
              value={col.expr ?? ""}
              onChange={(e) => update(i, { expr: e.target.value })}
              placeholder="per-row expression, e.g. perRxn * n"
              aria-label="Computed column expression"
              className={inputCls + " font-mono"}
            />
          )}
          {isReservedKey(col.key) && (
            <p className="text-meta text-amber-700 dark:text-amber-300">
              {`"${col.key.trim()}" is a built-in name. Rename the column key.`}
            </p>
          )}
        </div>
      ))}
      <div className="pl-2">
        <AddButton label="Add column" onClick={add} />
      </div>
    </div>
  );
}

// ── The Library view (template gallery) ──────────────────────────────────────

export function CalculatorLibraryView({
  onUseTemplate,
}: {
  onUseTemplate: (template: CalculatorTemplate) => void;
}) {
  const [templates, setTemplates] = useState<CalculatorTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllCalculatorTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load the template library.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!templates) return [];
    const byField = new Map<string, CalculatorTemplate[]>();
    for (const t of templates) {
      const list = byField.get(t.field) ?? [];
      list.push(t);
      byField.set(t.field, list);
    }
    return Array.from(byField.entries());
  }, [templates]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-title font-bold text-foreground">Template library</h3>
        <p className="mt-0.5 text-body text-foreground-muted">
          Start from a ready-made calculator, then tweak it. Using one loads it
          into the builder so you can edit and save your own copy.
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-body text-red-600 dark:text-red-400">
          <Icon name="alert" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}

      {!templates && !error && (
        <p className="text-body text-foreground-muted">Loading templates...</p>
      )}

      {grouped.map(([field, items]) => (
        <div key={field} className="space-y-2">
          <SectionTitle>{field}</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((t) => (
              <div
                key={t.slug}
                className="rounded-xl border border-border p-3 flex flex-col gap-2"
              >
                <div>
                  <p className="text-body font-semibold text-foreground">{t.name}</p>
                  <p className="mt-0.5 text-meta text-foreground-muted">{t.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onUseTemplate(t)}
                  className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 text-meta font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-brand-action/15 transition-colors"
                >
                  <Icon name="import" className="w-4 h-4" />
                  Use this
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Exports for the modal rail ───────────────────────────────────────────────

export { emptyDraft, calcToDraft, templateToDraft, draftToCalc, seedValues };
export type { CalcDraft };
