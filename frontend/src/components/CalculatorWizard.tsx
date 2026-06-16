"use client";

// Custom Calculator Builder, guided wizard (Hybrid redesign, 2026-06-10).
//
// A first-timer who picks Build your own lands here instead of the form, so
// they answer one plain question per step rather than facing every section at
// once. Five steps, matching the approved mockup:
//   1. Name (+ optional field)
//   2. Measurements, one plain label at a time (auto short-name)
//   3. The result formula, with clickable chips + a live answer
//   4. Optional warning / intermediate step (skippable)
//   5. Name the answer + review + save
//
// The wizard assembles a CalcDraft via buildDraftPartsFromWizard and saves
// through the SAME calculatorsApi path the form uses, so nothing about the
// saved shape changes. A Switch to the full form link hands the in-progress
// CalcDraft to the editor, carrying every answer unchanged.
//
// All glyphs go through the Icon component, no inline icon markup.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { calculatorsApi } from "@/lib/local-api";
import {
  evaluateCustomCalculator,
  type CustomCalcInputValues,
} from "@/lib/calculators/custom";
import {
  deriveInputKey,
  insertIntoFormula,
  buildDraftPartsFromWizard,
  emptyWizardState,
  FORMULA_HELPER_CHIPS,
  type WizardState,
  type WizardMeasurement,
} from "@/lib/calculators/builder-helpers";
import {
  draftToCalc,
  seedValues,
  type CalcDraft,
} from "@/components/CalculatorBuilder";
import type { CustomCalculator } from "@/lib/types";

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-body text-foreground bg-surface-raised focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400";

const TOTAL_STEPS = 5;

/** Turn a finished wizard state into the CalcDraft shape the editor + save path
 *  use. The wizard always saves private (empty shared_with); the author can
 *  share afterwards from the Use / Edit view, same as a form-built calculator. */
function wizardToDraft(state: WizardState): CalcDraft {
  const parts = buildDraftPartsFromWizard(state);
  return {
    name: parts.name,
    description: "",
    field: parts.field,
    inputs: parts.inputs,
    steps: parts.steps,
    conditionals: parts.conditionals,
    outputs: parts.outputs,
    shared_with: [],
  };
}

export function CalculatorWizard({
  onSaved,
  onCancel,
  onSwitchToForm,
}: {
  onSaved: (saved: CustomCalculator) => void;
  onCancel: () => void;
  /** Hand the in-progress draft to the full form, carrying every answer. */
  onSwitchToForm: (draft: CalcDraft) => void;
}) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(emptyWizardState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  // Live answer on the formula step: build the draft so far, seed each input
  // with its default (blank), and evaluate. The same engine the saved
  // calculator runs on, so the preview never lies.
  const previewDraft = useMemo(() => wizardToDraft(state), [state]);
  const livePreview = useMemo(() => {
    const calc = draftToCalc(previewDraft);
    const values: CustomCalcInputValues = seedValues(previewDraft.inputs);
    return evaluateCustomCalculator(calc, values);
  }, [previewDraft]);

  // ── Measurement editing (step 2) ──────────────────────────────────────────
  const variables = state.measurements.map((m) => m.key).filter(Boolean);

  const addMeasurement = () =>
    patch({ measurements: [...state.measurements, { label: "", key: "" }] });
  const updateMeasurementLabel = (i: number, label: string) => {
    const others = state.measurements
      .filter((_, j) => j !== i)
      .map((m) => m.key);
    const next = state.measurements.map((m, j): WizardMeasurement =>
      j === i ? { ...m, label, key: deriveInputKey(label, others) } : m,
    );
    patch({ measurements: next });
  };
  const updateMeasurementUnit = (i: number, unit: string) =>
    patch({
      measurements: state.measurements.map((m, j) =>
        j === i ? { ...m, unit } : m,
      ),
    });
  const removeMeasurement = (i: number) =>
    patch({ measurements: state.measurements.filter((_, j) => j !== i) });

  const insertIntoFormulaField = (text: string) =>
    patch({ formula: insertIntoFormula(state.formula, text) });

  // ── Optional logic (step 4) ───────────────────────────────────────────────
  const addWarning = () =>
    patch({ warnings: [...state.warnings, { condition: "", message: "" }] });
  const updateWarning = (
    i: number,
    p: Partial<{ condition: string; message: string }>,
  ) =>
    patch({
      warnings: state.warnings.map((w, j) => (j === i ? { ...w, ...p } : w)),
    });
  const removeWarning = (i: number) =>
    patch({ warnings: state.warnings.filter((_, j) => j !== i) });

  const addStepValue = () =>
    patch({ steps: [...state.steps, { key: "", expr: "" }] });
  const updateStepValue = (i: number, p: Partial<{ key: string; expr: string }>) =>
    patch({
      steps: state.steps.map((s, j) => (j === i ? { ...s, ...p } : s)),
    });
  const removeStepValue = (i: number) =>
    patch({ steps: state.steps.filter((_, j) => j !== i) });

  // ── Navigation ────────────────────────────────────────────────────────────
  const canNext =
    step === 1
      ? state.name.trim() !== ""
      : step === 3
        ? state.formula.trim() !== ""
        : true;

  const go = (delta: number) =>
    setStep((s) => Math.min(TOTAL_STEPS, Math.max(1, s + delta)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const draft = wizardToDraft(state);
      const saved = await calculatorsApi.create({
        name: draft.name,
        description: draft.description,
        field: draft.field || undefined,
        inputs: draft.inputs,
        steps: draft.steps,
        conditionals: draft.conditionals,
        outputs: draft.outputs,
        shared_with: draft.shared_with,
      });
      if (saved) onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the calculator.");
    } finally {
      setSaving(false);
    }
  };

  const STEP_TAGS = [
    "What does this calculator work out?",
    "What do you measure or type in?",
    "What is the formula for the answer?",
    "Add a warning or extra step? (optional)",
    "Name the answer and review",
  ];
  const STEP_SUBS = [
    "Give it a name in plain words. You can add the field of science too, it is optional.",
    "List each number you enter at the bench. Name it in plain words, we set the short name you use in the formula for you.",
    "Click a name or helper to drop it in, then add the math. The answer updates as you type.",
    "Skip this unless you want a heads-up message (like count is too low) or a named intermediate value. You can always add it later.",
    "Give the result a label and a unit, then save. It lands in My calculators and syncs to your paired phone.",
  ];

  return (
    <div className="space-y-5">
      {/* Progress dots */}
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const n = i + 1;
          const cls =
            n < step
              ? "bg-sky-500"
              : n === step
                ? "bg-purple-500"
                : "bg-surface-sunken";
          return (
            <div
              key={n}
              className={"h-1.5 flex-1 rounded-full " + cls}
              aria-hidden
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
          Step {step} of {TOTAL_STEPS}
        </p>
        <button
          type="button"
          onClick={() => onSwitchToForm(wizardToDraft(state))}
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-sky-700 dark:text-sky-300 hover:text-sky-900"
        >
          <Icon name="list" className="w-4 h-4" />
          Switch to the full form
        </button>
      </div>

      <div>
        <h3 className="text-heading font-bold text-foreground">
          {STEP_TAGS[step - 1]}
        </h3>
        <p className="mt-1 text-body text-foreground-muted">
          {STEP_SUBS[step - 1]}
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-body text-red-600 dark:text-red-400">
          <Icon name="alert" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}

      {/* ── Step 1: name + field ───────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-3">
          <div>
            <label className="block text-meta font-semibold text-foreground-muted mb-1">
              Name
            </label>
            <input
              value={state.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. CFU per mL"
              autoFocus
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-meta font-semibold text-foreground-muted mb-1">
              Field (optional)
            </label>
            <input
              value={state.field}
              onChange={(e) => patch({ field: e.target.value })}
              placeholder="e.g. Microbiology"
              className={inputCls}
            />
          </div>
        </div>
      )}

      {/* ── Step 2: measurements ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-2">
          {state.measurements.length === 0 && (
            <p className="text-body text-foreground-muted">
              No measurements yet. Add the first number you enter at the bench.
            </p>
          )}
          {state.measurements.map((m, i) => (
            <div
              key={i}
              className="rounded-xl border border-border p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
                  <input
                    value={m.label}
                    onChange={(e) => updateMeasurementLabel(i, e.target.value)}
                    placeholder="e.g. Colonies counted"
                    aria-label="Measurement label"
                    className={inputCls}
                  />
                  <input
                    value={m.unit ?? ""}
                    onChange={(e) => updateMeasurementUnit(i, e.target.value)}
                    placeholder="Unit (optional)"
                    aria-label="Measurement unit"
                    className={inputCls}
                  />
                </div>
                <Tooltip label="Remove measurement" placement="top">
                  <button
                    type="button"
                    onClick={() => removeMeasurement(i)}
                    aria-label="Remove measurement"
                    className="flex-shrink-0 w-9 h-9 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
              <p className="text-meta text-foreground-muted">
                used in formulas as{" "}
                <span className="font-mono font-semibold text-sky-700 dark:text-sky-300">
                  {m.key || "—"}
                </span>
              </p>
            </div>
          ))}
          <button
            type="button"
            onClick={addMeasurement}
            className="text-body font-medium text-sky-700 dark:text-sky-300 hover:text-sky-900 inline-flex items-center gap-1.5"
          >
            <Icon name="plus" className="w-4 h-4" />
            Add another measurement
          </button>
        </div>
      )}

      {/* ── Step 3: formula + live answer ──────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-foreground-muted mr-0.5">
              Tap to insert:
            </span>
            {variables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertIntoFormulaField(v)}
                className="font-mono text-meta font-semibold px-2 py-0.5 rounded-full border border-border bg-surface-sunken text-foreground hover:border-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
              >
                {v}
              </button>
            ))}
            {FORMULA_HELPER_CHIPS.map((h) => (
              <button
                key={h.label}
                type="button"
                onClick={() => insertIntoFormulaField(h.insert)}
                className="font-mono text-meta font-semibold px-2 py-0.5 rounded-full border border-border bg-surface-sunken text-purple-600 dark:text-purple-300 hover:border-sky-400 transition-colors"
              >
                {h.label}
              </button>
            ))}
          </div>
          <input
            value={state.formula}
            onChange={(e) => patch({ formula: e.target.value })}
            placeholder="e.g. colonies / (dilution * platedVol)"
            aria-label="Result formula"
            autoFocus
            className={inputCls + " font-mono"}
          />
          <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3">
            <span className="text-body text-foreground-muted">
              Answer, with your example values
            </span>
            <span className="text-title font-bold text-sky-700 dark:text-sky-300 tabular-nums">
              {livePreview.outputs[0]?.display ?? "—"}
              {state.answerUnit ? (
                <span className="ml-1 text-meta font-normal">
                  {state.answerUnit}
                </span>
              ) : null}
            </span>
          </div>
          {variables.length === 0 && (
            <p className="text-meta text-foreground-muted">
              Add a measurement on the previous step to get clickable names
              here.
            </p>
          )}
        </div>
      )}

      {/* ── Step 4: optional warning / step ────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="space-y-2">
            {state.warnings.map((w, i) => (
              <div
                key={i}
                className="rounded-xl border border-border p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={w.condition}
                      onChange={(e) =>
                        updateWarning(i, { condition: e.target.value })
                      }
                      placeholder="when, e.g. colonies < 30"
                      aria-label="Warning condition"
                      className={inputCls + " font-mono"}
                    />
                    <input
                      value={w.message}
                      onChange={(e) =>
                        updateWarning(i, { message: e.target.value })
                      }
                      placeholder="message, e.g. Count is too low"
                      aria-label="Warning message"
                      className={inputCls}
                    />
                  </div>
                  <Tooltip label="Remove warning" placement="top">
                    <button
                      type="button"
                      onClick={() => removeWarning(i)}
                      aria-label="Remove warning"
                      className="flex-shrink-0 w-9 h-9 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addWarning}
              className="text-body font-medium text-sky-700 dark:text-sky-300 hover:text-sky-900 inline-flex items-center gap-1.5"
            >
              <Icon name="plus" className="w-4 h-4" />
              Add a warning
            </button>
          </div>

          <div className="space-y-2">
            {state.steps.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border border-border p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                    <input
                      value={s.key}
                      onChange={(e) => updateStepValue(i, { key: e.target.value })}
                      placeholder="name"
                      aria-label="Intermediate value name"
                      className={inputCls + " font-mono"}
                    />
                    <input
                      value={s.expr}
                      onChange={(e) => updateStepValue(i, { expr: e.target.value })}
                      placeholder="expression, e.g. mean(live)"
                      aria-label="Intermediate value expression"
                      className={inputCls + " font-mono"}
                    />
                  </div>
                  <Tooltip label="Remove intermediate value" placement="top">
                    <button
                      type="button"
                      onClick={() => removeStepValue(i)}
                      aria-label="Remove intermediate value"
                      className="flex-shrink-0 w-9 h-9 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors"
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addStepValue}
              className="text-body font-medium text-sky-700 dark:text-sky-300 hover:text-sky-900 inline-flex items-center gap-1.5"
            >
              <Icon name="plus" className="w-4 h-4" />
              Add an intermediate value
            </button>
          </div>

          <p className="text-meta text-foreground-muted">
            Nothing here is required. Most calculators skip this step.
          </p>
        </div>
      )}

      {/* ── Step 5: name the answer + review ───────────────────────────────── */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-semibold text-foreground-muted mb-1">
                Answer label
              </label>
              <input
                value={state.answerLabel}
                onChange={(e) => patch({ answerLabel: e.target.value })}
                placeholder={state.name || "e.g. CFU per mL"}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-meta font-semibold text-foreground-muted mb-1">
                Unit (optional)
              </label>
              <input
                value={state.answerUnit}
                onChange={(e) => patch({ answerUnit: e.target.value })}
                placeholder="e.g. CFU/mL"
                className={inputCls}
              />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-sunken p-4 text-body">
            <Review label="Name" value={state.name || "—"} />
            <Review
              label="Inputs"
              value={variables.length ? variables.join(", ") : "—"}
            />
            <Review label="Result" value={state.formula || "—"} mono />
            <Review
              label="Example answer"
              value={
                (livePreview.outputs[0]?.display ?? "—") +
                (state.answerUnit ? " " + state.answerUnit : "")
              }
            />
          </div>
        </div>
      )}

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => go(-1)}
            className="ros-btn-neutral px-3 py-1.5 text-meta font-medium text-foreground-muted"
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral px-3 py-1.5 text-meta font-medium text-foreground-muted"
          >
            Cancel
          </button>
        )}
        {step < TOTAL_STEPS ? (
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!canNext}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-1.5 text-meta font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <Icon name="chevronRight" className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={saving || state.name.trim() === "" || state.formula.trim() === ""}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-1.5 text-meta font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="save" className="w-4 h-4" />
            {saving ? "Saving" : "Save calculator"}
          </button>
        )}
      </div>
    </div>
  );
}

function Review({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border last:border-0">
      <span className="text-foreground-muted">{label}</span>
      <span className={"text-foreground " + (mono ? "font-mono" : "")}>
        {value}
      </span>
    </div>
  );
}
