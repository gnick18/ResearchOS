"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import Tooltip from "@/components/Tooltip";
import {
  ADDED_ROW_CLASSES,
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CELL_CLASSES,
  MODIFIED_CHIP_TEXT,
  REMOVED_ROW_CLASSES,
  originalValueTooltip,
} from "@/lib/methods/diff-display";
import type {
  LCGradientColumn,
  LCGradientStep,
  LCIngredient,
  LCIngredientRole,
} from "@/lib/types";

/**
 * Interactive editor for an LC (HPLC / LC-MS) gradient protocol — the LC
 * counterpart to `InteractiveGradientEditor.tsx` for PCR.
 *
 * Layout (top → bottom):
 *  1. Optional "Modified from source" chip (visible only when `original*`
 *     props are passed AND the live value diverges)
 *  2. Recharts line chart of %A, %B, and flow vs time
 *  3. Gradient steps table (time, %A, %B, flow)
 *  4. Column fields (manufacturer, model, length, ID, particle size)
 *  5. Detection wavelength + description fields
 *  6. Ingredients table (name, role, concentration, notes)
 *
 * All `original*` props are optional. When omitted the editor is in
 * "standalone" mode (creating a new method, or editing the source protocol
 * directly via the /methods modal). When present, it's in "task-attached"
 * mode — modified fields get the amber chip + cell highlighting, added /
 * removed rows get green / red highlighting, all per the diff-display
 * contract in `lib/methods/diff-display.ts`.
 */
export interface LcGradientEditorProps {
  gradientSteps: LCGradientStep[];
  onGradientStepsChange?: (steps: LCGradientStep[]) => void;
  column: LCGradientColumn;
  onColumnChange?: (column: LCGradientColumn) => void;
  detectionWavelengthNm: number | null;
  onDetectionWavelengthChange?: (nm: number | null) => void;
  description?: string | null;
  onDescriptionChange?: (description: string | null) => void;
  ingredients: LCIngredient[];
  onIngredientsChange?: (ingredients: LCIngredient[]) => void;
  /** When true, all inputs render read-only (no row +/-, no input editing). */
  readOnly?: boolean;
  /** When set, diff display compares against these source values and shows
   *  the "Modified from source" chip + per-cell highlights. */
  originalGradientSteps?: LCGradientStep[];
  originalColumn?: LCGradientColumn;
  originalDetectionWavelengthNm?: number | null;
  originalDescription?: string | null;
  originalIngredients?: LCIngredient[];
}

const ROLE_LABELS: Record<LCIngredientRole, string> = {
  solvent_a: "Solvent A",
  solvent_b: "Solvent B",
  buffer: "Buffer",
  additive: "Additive",
};

const ROLE_OPTIONS: LCIngredientRole[] = ["solvent_a", "solvent_b", "buffer", "additive"];

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNumberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stepsEqual(a: LCGradientStep, b: LCGradientStep): boolean {
  return (
    a.time_min === b.time_min &&
    a.percent_a === b.percent_a &&
    a.percent_b === b.percent_b &&
    a.flow_ml_min === b.flow_ml_min
  );
}

function columnEqual(a: LCGradientColumn, b: LCGradientColumn): boolean {
  return (
    (a.manufacturer ?? "") === (b.manufacturer ?? "") &&
    (a.model ?? "") === (b.model ?? "") &&
    (a.length_mm ?? null) === (b.length_mm ?? null) &&
    (a.inner_diameter_mm ?? null) === (b.inner_diameter_mm ?? null) &&
    (a.particle_size_um ?? null) === (b.particle_size_um ?? null)
  );
}

function ingredientsEqual(a: LCIngredient[], b: LCIngredient[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.role !== y.role ||
      (x.concentration ?? "") !== (y.concentration ?? "") ||
      (x.notes ?? "") !== (y.notes ?? "")
    ) {
      return false;
    }
  }
  return true;
}

export function LcGradientEditor(props: LcGradientEditorProps) {
  const {
    gradientSteps,
    onGradientStepsChange,
    column,
    onColumnChange,
    detectionWavelengthNm,
    onDetectionWavelengthChange,
    description,
    onDescriptionChange,
    ingredients,
    onIngredientsChange,
    readOnly = false,
    originalGradientSteps,
    originalColumn,
    originalDetectionWavelengthNm,
    originalDescription,
    originalIngredients,
  } = props;

  const editable = !readOnly;
  const diffMode =
    originalGradientSteps !== undefined ||
    originalColumn !== undefined ||
    originalDetectionWavelengthNm !== undefined ||
    originalIngredients !== undefined ||
    originalDescription !== undefined;

  const isModified = useMemo(() => {
    if (!diffMode) return false;
    if (originalGradientSteps) {
      if (gradientSteps.length !== originalGradientSteps.length) return true;
      for (let i = 0; i < gradientSteps.length; i += 1) {
        if (!stepsEqual(gradientSteps[i], originalGradientSteps[i])) return true;
      }
    }
    if (originalColumn && !columnEqual(column, originalColumn)) return true;
    if (
      originalDetectionWavelengthNm !== undefined &&
      (detectionWavelengthNm ?? null) !== (originalDetectionWavelengthNm ?? null)
    ) {
      return true;
    }
    if (originalDescription !== undefined && (description ?? "") !== (originalDescription ?? "")) {
      return true;
    }
    if (originalIngredients && !ingredientsEqual(ingredients, originalIngredients)) return true;
    return false;
  }, [
    diffMode,
    gradientSteps,
    column,
    detectionWavelengthNm,
    description,
    ingredients,
    originalGradientSteps,
    originalColumn,
    originalDetectionWavelengthNm,
    originalDescription,
    originalIngredients,
  ]);

  const chartData = useMemo(
    () =>
      gradientSteps.map((s) => ({
        time: s.time_min,
        "% A": s.percent_a,
        "% B": s.percent_b,
        flow: s.flow_ml_min,
      })),
    [gradientSteps],
  );

  const updateStep = (idx: number, field: keyof LCGradientStep, value: number) => {
    if (!onGradientStepsChange) return;
    const next = gradientSteps.map((s, i) =>
      i === idx ? { ...s, [field]: value } : s,
    );
    onGradientStepsChange(next);
  };

  const addStep = () => {
    if (!onGradientStepsChange) return;
    const last = gradientSteps[gradientSteps.length - 1];
    const nextTime = last ? last.time_min + 1 : 0;
    const newStep: LCGradientStep = last
      ? { ...last, time_min: nextTime }
      : { time_min: 0, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 };
    onGradientStepsChange([...gradientSteps, newStep]);
  };

  const removeStep = (idx: number) => {
    if (!onGradientStepsChange) return;
    onGradientStepsChange(gradientSteps.filter((_, i) => i !== idx));
  };

  const updateColumn = <K extends keyof LCGradientColumn>(field: K, value: LCGradientColumn[K]) => {
    if (!onColumnChange) return;
    onColumnChange({ ...column, [field]: value });
  };

  const updateIngredient = <K extends keyof LCIngredient>(
    id: string,
    field: K,
    value: LCIngredient[K],
  ) => {
    if (!onIngredientsChange) return;
    onIngredientsChange(
      ingredients.map((ing) => (ing.id === id ? { ...ing, [field]: value } : ing)),
    );
  };

  const addIngredient = () => {
    if (!onIngredientsChange) return;
    onIngredientsChange([
      ...ingredients,
      {
        id: `lc-${Date.now()}-${ingredients.length}`,
        name: "",
        role: "additive",
      },
    ]);
  };

  const removeIngredient = (id: string) => {
    if (!onIngredientsChange) return;
    onIngredientsChange(ingredients.filter((ing) => ing.id !== id));
  };

  // ── Diff lookups for per-field highlighting ──────────────────────────────
  const originalStepByIdx = (idx: number): LCGradientStep | undefined =>
    originalGradientSteps?.[idx];

  const originalIngredientById = useMemo(() => {
    const map = new Map<string, LCIngredient>();
    if (originalIngredients) {
      for (const ing of originalIngredients) map.set(ing.id, ing);
    }
    return map;
  }, [originalIngredients]);

  return (
    <div className="space-y-4">
      {isModified && (
        <div>
          <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
        </div>
      )}

      {/* Chart */}
      <div
        data-tour-target="lc-gradient-chart"
        className="border border-border rounded-lg p-3 bg-surface-raised"
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              label={{ value: "Time (min)", position: "insideBottom", offset: -2, fontSize: 11, fill: "#6b7280" }}
            />
            <YAxis
              yAxisId="pct"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              label={{ value: "%", angle: -90, position: "insideLeft", fontSize: 11, fill: "#6b7280" }}
            />
            <YAxis
              yAxisId="flow"
              orientation="right"
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              label={{ value: "mL/min", angle: 90, position: "insideRight", fontSize: 11, fill: "#6b7280" }}
            />
            <RechartsTooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="pct" type="monotone" dataKey="% A" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            <Line yAxisId="pct" type="monotone" dataKey="% B" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            <Line yAxisId="flow" type="monotone" dataKey="flow" stroke="#10b981" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Gradient steps table */}
      <div>
        <h4 className="text-meta font-semibold text-foreground-muted mb-2 uppercase tracking-wide">
          Gradient steps
        </h4>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-body">
            <thead className="bg-surface-sunken text-meta text-foreground-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time (min)</th>
                <th className="px-3 py-2 text-left font-medium">% A</th>
                <th className="px-3 py-2 text-left font-medium">% B</th>
                <th className="px-3 py-2 text-left font-medium">Flow (mL/min)</th>
                {editable && <th className="px-2 py-2 w-8"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gradientSteps.map((step, idx) => {
                const origStep = originalStepByIdx(idx);
                const added = diffMode && !!originalGradientSteps && idx >= originalGradientSteps.length;
                const rowClass = added ? ADDED_ROW_CLASSES : "";
                return (
                  <StepRow
                    key={idx}
                    step={step}
                    origStep={origStep}
                    rowClass={rowClass}
                    editable={editable}
                    onUpdate={(field, value) => updateStep(idx, field, value)}
                    onRemove={() => removeStep(idx)}
                    rowIndex={idx}
                  />
                );
              })}
              {/* Removed-row placeholders for steps present in source but
                  not in current. Show as a strike-through ghost row so the
                  diff is reviewable. */}
              {diffMode && originalGradientSteps && originalGradientSteps.length > gradientSteps.length && (
                originalGradientSteps.slice(gradientSteps.length).map((step, i) => (
                  <tr key={`removed-${i}`} className={REMOVED_ROW_CLASSES}>
                    <td className="px-3 py-2">{step.time_min}</td>
                    <td className="px-3 py-2">{step.percent_a}</td>
                    <td className="px-3 py-2">{step.percent_b}</td>
                    <td className="px-3 py-2">{step.flow_ml_min}</td>
                    {editable && <td className="px-2 py-2"></td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {editable && (
            <button
              onClick={addStep}
              data-tour-target="lc-add-step"
              className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
            >
              + Add step
            </button>
          )}
        </div>
      </div>

      {/* Column + detection */}
      <div>
        <h4 className="text-meta font-semibold text-foreground-muted mb-2 uppercase tracking-wide">
          Column &amp; detection
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow
            label="Manufacturer"
            value={column.manufacturer ?? ""}
            originalValue={originalColumn?.manufacturer ?? undefined}
            onChange={(v) => updateColumn("manufacturer", v)}
            placeholder="e.g. Waters"
            editable={editable}
          />
          <FieldRow
            label="Model"
            value={column.model ?? ""}
            originalValue={originalColumn?.model ?? undefined}
            onChange={(v) => updateColumn("model", v)}
            placeholder="e.g. ACQUITY UPLC BEH C18"
            editable={editable}
          />
          <NumericFieldRow
            label="Length (mm)"
            value={column.length_mm ?? null}
            originalValue={originalColumn?.length_mm ?? null}
            onChange={(v) => updateColumn("length_mm", v)}
            editable={editable}
          />
          <NumericFieldRow
            label="Inner diameter (mm)"
            value={column.inner_diameter_mm ?? null}
            originalValue={originalColumn?.inner_diameter_mm ?? null}
            onChange={(v) => updateColumn("inner_diameter_mm", v)}
            editable={editable}
          />
          <NumericFieldRow
            label="Particle size (µm)"
            value={column.particle_size_um ?? null}
            originalValue={originalColumn?.particle_size_um ?? null}
            onChange={(v) => updateColumn("particle_size_um", v)}
            editable={editable}
          />
          <NumericFieldRow
            label="Detection wavelength (nm)"
            value={detectionWavelengthNm}
            originalValue={originalDetectionWavelengthNm ?? null}
            onChange={(v) => onDetectionWavelengthChange?.(v)}
            editable={editable && !!onDetectionWavelengthChange}
          />
        </div>
      </div>

      {/* Description */}
      {(onDescriptionChange || (description && description.trim())) && (
        <div>
          <h4 className="text-meta font-semibold text-foreground-muted mb-2 uppercase tracking-wide">
            Description
          </h4>
          {editable && onDescriptionChange ? (
            <textarea
              value={description ?? ""}
              onChange={(e) => onDescriptionChange(e.target.value || null)}
              rows={2}
              placeholder="Optional notes about the method (sample type, expected analytes, references)…"
              className={`w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                originalDescription !== undefined && (description ?? "") !== (originalDescription ?? "")
                  ? MODIFIED_CELL_CLASSES
                  : ""
              }`}
            />
          ) : (
            <p className="text-body text-foreground-muted whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}

      {/* Ingredients */}
      <div>
        <h4 className="text-meta font-semibold text-foreground-muted mb-2 uppercase tracking-wide">
          Ingredients
        </h4>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-body">
            <thead className="bg-surface-sunken text-meta text-foreground-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Concentration</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                {editable && <th className="px-2 py-2 w-8"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ingredients.map((ing) => {
                const orig = originalIngredientById.get(ing.id);
                const added = diffMode && !!originalIngredients && !orig;
                return (
                  <IngredientRow
                    key={ing.id}
                    ingredient={ing}
                    original={orig}
                    added={added}
                    editable={editable}
                    onUpdate={(field, value) => updateIngredient(ing.id, field, value)}
                    onRemove={() => removeIngredient(ing.id)}
                  />
                );
              })}
              {diffMode && originalIngredients && (() => {
                const liveIds = new Set(ingredients.map((i) => i.id));
                const removed = originalIngredients.filter((i) => !liveIds.has(i.id));
                return removed.map((ing) => (
                  <tr key={`removed-${ing.id}`} className={REMOVED_ROW_CLASSES}>
                    <td className="px-3 py-2">{ing.name}</td>
                    <td className="px-3 py-2">{ROLE_LABELS[ing.role]}</td>
                    <td className="px-3 py-2">{ing.concentration ?? ""}</td>
                    <td className="px-3 py-2">{ing.notes ?? ""}</td>
                    {editable && <td className="px-2 py-2"></td>}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          {editable && (
            <button
              onClick={addIngredient}
              className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
            >
              + Add ingredient
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function StepRow({
  step,
  origStep,
  rowClass,
  editable,
  onUpdate,
  onRemove,
  rowIndex,
}: {
  step: LCGradientStep;
  origStep: LCGradientStep | undefined;
  rowClass: string;
  editable: boolean;
  onUpdate: (field: keyof LCGradientStep, value: number) => void;
  onRemove: () => void;
  rowIndex?: number;
}) {
  const cellClass = (field: keyof LCGradientStep) =>
    origStep && step[field] !== origStep[field] ? MODIFIED_CELL_CLASSES : "";
  const cellTooltip = (field: keyof LCGradientStep): string | undefined =>
    origStep && step[field] !== origStep[field]
      ? originalValueTooltip(origStep[field])
      : undefined;

  return (
    <tr
      className={rowClass}
      data-tour-target={rowIndex !== undefined ? `lc-step-row-${rowIndex}` : undefined}
    >
      <NumericCell
        value={step.time_min}
        cellClass={cellClass("time_min")}
        tooltip={cellTooltip("time_min")}
        editable={editable}
        onChange={(v) => onUpdate("time_min", v ?? 0)}
      />
      <NumericCell
        value={step.percent_a}
        cellClass={cellClass("percent_a")}
        tooltip={cellTooltip("percent_a")}
        editable={editable}
        onChange={(v) => onUpdate("percent_a", v ?? 0)}
      />
      <NumericCell
        value={step.percent_b}
        cellClass={cellClass("percent_b")}
        tooltip={cellTooltip("percent_b")}
        editable={editable}
        onChange={(v) => onUpdate("percent_b", v ?? 0)}
      />
      <NumericCell
        value={step.flow_ml_min}
        cellClass={cellClass("flow_ml_min")}
        tooltip={cellTooltip("flow_ml_min")}
        editable={editable}
        onChange={(v) => onUpdate("flow_ml_min", v ?? 0)}
      />
      {editable && (
        <td className="px-2 py-2">
          <Tooltip label="Remove step" placement="left">
            <button
              onClick={onRemove}
              className="text-foreground-muted hover:text-red-500 text-body"
            >
              ✕
            </button>
          </Tooltip>
        </td>
      )}
    </tr>
  );
}

function NumericCell({
  value,
  cellClass,
  tooltip,
  editable,
  onChange,
}: {
  value: number;
  cellClass: string;
  tooltip?: string;
  editable: boolean;
  onChange: (value: number | null) => void;
}) {
  const inner = editable ? (
    <input
      type="number"
      value={fmtNumber(value)}
      step="0.01"
      onChange={(e) => onChange(parseNumberOrNull(e.target.value))}
      className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  ) : (
    <span className="text-foreground">{value}</span>
  );
  return (
    <td className={`px-3 py-2 ${cellClass}`}>
      {tooltip ? (
        <Tooltip label={tooltip} placement="top">
          {inner}
        </Tooltip>
      ) : (
        inner
      )}
    </td>
  );
}

function FieldRow({
  label,
  value,
  originalValue,
  onChange,
  placeholder,
  editable,
}: {
  label: string;
  value: string;
  originalValue?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  editable: boolean;
}) {
  const modified = originalValue !== undefined && originalValue !== value;
  const input = (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-2 py-1.5 border border-border rounded text-body text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 ${
        modified ? MODIFIED_CELL_CLASSES : ""
      }`}
    />
  );
  return (
    <label className="block text-meta font-medium text-foreground-muted space-y-1">
      <span>{label}</span>
      {editable ? (
        modified ? (
          <Tooltip label={originalValueTooltip(originalValue ?? "(empty)")} placement="top">
            {input}
          </Tooltip>
        ) : (
          input
        )
      ) : (
        <span className="block text-body text-foreground">{value || "—"}</span>
      )}
    </label>
  );
}

function NumericFieldRow({
  label,
  value,
  originalValue,
  onChange,
  editable,
}: {
  label: string;
  value: number | null;
  originalValue?: number | null;
  onChange: (value: number | null) => void;
  editable: boolean;
}) {
  const modified =
    originalValue !== undefined && (originalValue ?? null) !== (value ?? null);
  const input = (
    <input
      type="number"
      value={fmtNumber(value)}
      step="0.01"
      onChange={(e) => onChange(parseNumberOrNull(e.target.value))}
      className={`w-full px-2 py-1.5 border border-border rounded text-body text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 ${
        modified ? MODIFIED_CELL_CLASSES : ""
      }`}
    />
  );
  return (
    <label className="block text-meta font-medium text-foreground-muted space-y-1">
      <span>{label}</span>
      {editable ? (
        modified ? (
          <Tooltip label={originalValueTooltip(originalValue ?? "(empty)")} placement="top">
            {input}
          </Tooltip>
        ) : (
          input
        )
      ) : (
        <span className="block text-body text-foreground">
          {value === null || value === undefined ? "—" : value}
        </span>
      )}
    </label>
  );
}

function IngredientRow({
  ingredient,
  original,
  added,
  editable,
  onUpdate,
  onRemove,
}: {
  ingredient: LCIngredient;
  original: LCIngredient | undefined;
  added: boolean;
  editable: boolean;
  onUpdate: <K extends keyof LCIngredient>(field: K, value: LCIngredient[K]) => void;
  onRemove: () => void;
}) {
  const ing = ingredient;
  const cellClass = (field: keyof LCIngredient) => {
    if (added) return "";
    if (!original) return "";
    return (ing[field] ?? "") !== (original[field] ?? "") ? MODIFIED_CELL_CLASSES : "";
  };
  const cellTooltip = (field: keyof LCIngredient): string | undefined => {
    if (!original || added) return undefined;
    if ((ing[field] ?? "") === (original[field] ?? "")) return undefined;
    return originalValueTooltip(String(original[field] ?? "(empty)"));
  };

  const nameInner = editable ? (
    <input
      type="text"
      value={ing.name}
      onChange={(e) => onUpdate("name", e.target.value)}
      className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  ) : (
    <span className="text-foreground">{ing.name}</span>
  );
  const roleInner = editable ? (
    <select
      value={ing.role}
      onChange={(e) => onUpdate("role", e.target.value as LCIngredientRole)}
      className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500 bg-surface-raised"
    >
      {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  ) : (
    <span className="text-foreground">{ROLE_LABELS[ing.role]}</span>
  );
  const concInner = editable ? (
    <input
      type="text"
      value={ing.concentration ?? ""}
      onChange={(e) => onUpdate("concentration", e.target.value)}
      placeholder="e.g. 0.1%, 10 mM"
      className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  ) : (
    <span className="text-foreground">{ing.concentration || "—"}</span>
  );
  const notesInner = editable ? (
    <input
      type="text"
      value={ing.notes ?? ""}
      onChange={(e) => onUpdate("notes", e.target.value)}
      className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  ) : (
    <span className="text-foreground">{ing.notes || ""}</span>
  );
  const nameTip = cellTooltip("name");
  const roleTip = cellTooltip("role");
  const concTip = cellTooltip("concentration");
  const notesTip = cellTooltip("notes");

  return (
    <tr className={added ? ADDED_ROW_CLASSES : ""}>
      <td className={`px-3 py-2 ${cellClass("name")}`}>
        {nameTip ? (
          <Tooltip label={nameTip} placement="top">
            {nameInner}
          </Tooltip>
        ) : (
          nameInner
        )}
      </td>
      <td className={`px-3 py-2 ${cellClass("role")}`}>
        {roleTip ? (
          <Tooltip label={roleTip} placement="top">
            {roleInner}
          </Tooltip>
        ) : (
          roleInner
        )}
      </td>
      <td className={`px-3 py-2 ${cellClass("concentration")}`}>
        {concTip ? (
          <Tooltip label={concTip} placement="top">
            {concInner}
          </Tooltip>
        ) : (
          concInner
        )}
      </td>
      <td className={`px-3 py-2 ${cellClass("notes")}`}>
        {notesTip ? (
          <Tooltip label={notesTip} placement="top">
            {notesInner}
          </Tooltip>
        ) : (
          notesInner
        )}
      </td>
      {editable && (
        <td className="px-2 py-2">
          <Tooltip label="Remove ingredient" placement="left">
            <button
              onClick={onRemove}
              className="text-foreground-muted hover:text-red-500 text-body"
            >
              ✕
            </button>
          </Tooltip>
        </td>
      )}
    </tr>
  );
}

export default LcGradientEditor;
