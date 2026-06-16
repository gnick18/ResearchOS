"use client";

import { useMemo } from "react";
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
  QPCRChemistry,
  QPCRMeltCurveConfig,
  QPCRReference,
  QPCRStandardCurvePoint,
} from "@/lib/types";

/**
 * Interactive editor for a qPCR analysis method. Mirrors LcGradientEditor's
 * standalone-vs-task-attached dual mode: when `original*` props are absent
 * the editor is in source-record mode (new-method dialog or /methods modal);
 * when present, it surfaces the "Modified from source" chip + per-cell diff
 * highlighting against the source template.
 *
 * qPCR enters v2 as analysis-only. The cycling/recipe half lives on a
 * separate PCR method — users build "qPCR full kit" compounds bundling the
 * two via the composition primitive. See METHODS_EXPANSION_V2_PROPOSAL.md §5.
 *
 * Layout (top → bottom):
 *  1. Optional "Modified from source" chip
 *  2. Chemistry + description + ΔΔCq toggle
 *  3. Targets / references table (the heaviest part — drives ΔΔCq)
 *  4. Standard-curve dilution-series table (optional)
 *  5. Melt-curve sweep config
 */
export interface QpcrAnalysisEditorProps {
  chemistry: QPCRChemistry;
  onChemistryChange?: (chemistry: QPCRChemistry) => void;
  chemistryLabel: string | null;
  onChemistryLabelChange?: (label: string | null) => void;
  description: string | null;
  onDescriptionChange?: (description: string | null) => void;
  useDeltaDeltaCq: boolean;
  onUseDeltaDeltaCqChange?: (use: boolean) => void;
  references: QPCRReference[];
  onReferencesChange?: (references: QPCRReference[]) => void;
  standardCurve: QPCRStandardCurvePoint[];
  onStandardCurveChange?: (points: QPCRStandardCurvePoint[]) => void;
  meltCurve: QPCRMeltCurveConfig | null;
  onMeltCurveChange?: (mc: QPCRMeltCurveConfig | null) => void;
  /** When true, all inputs render read-only. */
  readOnly?: boolean;
  /** Diff-display source values. When present and the live value diverges,
   *  the editor renders the "Modified from source" chip + amber-cell highlights. */
  originalChemistry?: QPCRChemistry;
  originalChemistryLabel?: string | null;
  originalDescription?: string | null;
  originalUseDeltaDeltaCq?: boolean;
  originalReferences?: QPCRReference[];
  originalStandardCurve?: QPCRStandardCurvePoint[];
  originalMeltCurve?: QPCRMeltCurveConfig | null;
}

const CHEMISTRY_OPTIONS: Array<{ value: QPCRChemistry; label: string }> = [
  { value: "sybr", label: "SYBR Green" },
  { value: "taqman", label: "TaqMan probe" },
  { value: "evagreen", label: "EvaGreen" },
  { value: "other", label: "Other" },
];

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNumberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function referencesEqual(a: QPCRReference[], b: QPCRReference[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.target !== y.target ||
      x.channel !== y.channel ||
      x.is_reference !== y.is_reference ||
      (x.expected_cq ?? null) !== (y.expected_cq ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function standardCurveEqual(a: QPCRStandardCurvePoint[], b: QPCRStandardCurvePoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].log_quantity !== b[i].log_quantity ||
      a[i].cq !== b[i].cq ||
      (a[i].replicate_n ?? null) !== (b[i].replicate_n ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function meltCurveEqual(a: QPCRMeltCurveConfig | null, b: QPCRMeltCurveConfig | null): boolean {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  return (
    a.start_c === b.start_c &&
    a.end_c === b.end_c &&
    a.ramp_rate_c_per_sec === b.ramp_rate_c_per_sec
  );
}

export default function QpcrAnalysisEditor({
  chemistry,
  onChemistryChange,
  chemistryLabel,
  onChemistryLabelChange,
  description,
  onDescriptionChange,
  useDeltaDeltaCq,
  onUseDeltaDeltaCqChange,
  references,
  onReferencesChange,
  standardCurve,
  onStandardCurveChange,
  meltCurve,
  onMeltCurveChange,
  readOnly = false,
  originalChemistry,
  originalChemistryLabel,
  originalDescription,
  originalUseDeltaDeltaCq,
  originalReferences,
  originalStandardCurve,
  originalMeltCurve,
}: QpcrAnalysisEditorProps) {
  const diffMode =
    originalReferences !== undefined ||
    originalStandardCurve !== undefined ||
    originalMeltCurve !== undefined ||
    originalChemistry !== undefined;

  const chemistryModified =
    originalChemistry !== undefined && originalChemistry !== chemistry;
  const chemistryLabelModified =
    originalChemistryLabel !== undefined &&
    (originalChemistryLabel ?? "") !== (chemistryLabel ?? "");
  const descriptionModified =
    originalDescription !== undefined &&
    (originalDescription ?? "") !== (description ?? "");
  const deltaModified =
    originalUseDeltaDeltaCq !== undefined && originalUseDeltaDeltaCq !== useDeltaDeltaCq;
  const referencesModified =
    originalReferences !== undefined && !referencesEqual(originalReferences, references);
  const standardCurveModified =
    originalStandardCurve !== undefined &&
    !standardCurveEqual(originalStandardCurve, standardCurve);
  const meltCurveModified =
    originalMeltCurve !== undefined && !meltCurveEqual(originalMeltCurve ?? null, meltCurve);

  const anyModified =
    chemistryModified ||
    chemistryLabelModified ||
    descriptionModified ||
    deltaModified ||
    referencesModified ||
    standardCurveModified ||
    meltCurveModified;

  // Build keyed lookup for the references diff so per-row "added / removed /
  // modified" highlighting works even when the user reorders rows.
  const originalRefsById = useMemo(() => {
    if (!originalReferences) return null;
    return new Map(originalReferences.map((r) => [r.id, r]));
  }, [originalReferences]);

  const removedRefs = useMemo(() => {
    if (!originalReferences) return [];
    const liveIds = new Set(references.map((r) => r.id));
    return originalReferences.filter((r) => !liveIds.has(r.id));
  }, [originalReferences, references]);

  function classifyRef(r: QPCRReference): "added" | "modified" | "unchanged" {
    if (!originalRefsById) return "unchanged";
    const orig = originalRefsById.get(r.id);
    if (!orig) return "added";
    if (
      orig.target !== r.target ||
      orig.channel !== r.channel ||
      orig.is_reference !== r.is_reference ||
      (orig.expected_cq ?? null) !== (r.expected_cq ?? null)
    ) {
      return "modified";
    }
    return "unchanged";
  }

  function updateReference(idx: number, patch: Partial<QPCRReference>) {
    if (!onReferencesChange) return;
    onReferencesChange(references.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addReference() {
    if (!onReferencesChange) return;
    const newId = `ref_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    onReferencesChange([
      ...references,
      { id: newId, target: "", channel: "FAM", is_reference: false },
    ]);
  }

  function removeReference(idx: number) {
    if (!onReferencesChange) return;
    onReferencesChange(references.filter((_, i) => i !== idx));
  }

  function setReferenceFlag(idx: number, makeReference: boolean) {
    if (!onReferencesChange) return;
    // At most one reference at a time — flip everyone else off when one is set.
    onReferencesChange(
      references.map((r, i) =>
        i === idx ? { ...r, is_reference: makeReference } : makeReference ? { ...r, is_reference: false } : r,
      ),
    );
  }

  function updateCurvePoint(idx: number, patch: Partial<QPCRStandardCurvePoint>) {
    if (!onStandardCurveChange) return;
    onStandardCurveChange(standardCurve.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function addCurvePoint() {
    if (!onStandardCurveChange) return;
    const lastLog = standardCurve.length > 0 ? standardCurve[standardCurve.length - 1].log_quantity : 5;
    onStandardCurveChange([...standardCurve, { log_quantity: lastLog - 1, cq: 0 }]);
  }

  function removeCurvePoint(idx: number) {
    if (!onStandardCurveChange) return;
    onStandardCurveChange(standardCurve.filter((_, i) => i !== idx));
  }

  function updateMelt(patch: Partial<QPCRMeltCurveConfig>) {
    if (!onMeltCurveChange) return;
    const base: QPCRMeltCurveConfig = meltCurve ?? { start_c: 60, end_c: 95, ramp_rate_c_per_sec: 0.1 };
    onMeltCurveChange({ ...base, ...patch });
  }

  function toggleMeltCurve(enabled: boolean) {
    if (!onMeltCurveChange) return;
    if (enabled) {
      onMeltCurveChange(meltCurve ?? { start_c: 60, end_c: 95, ramp_rate_c_per_sec: 0.1 });
    } else {
      onMeltCurveChange(null);
    }
  }

  return (
    <div className="space-y-6">
      {diffMode && anyModified && (
        <div>
          <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
        </div>
      )}

      {/* Section 1: chemistry + description + ΔΔCq toggle */}
      <section className="space-y-3">
        <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider">
          Chemistry &amp; protocol
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-meta text-foreground-muted space-y-1">
            <span className="block">Chemistry</span>
            <select
              value={chemistry}
              onChange={(e) => onChemistryChange?.(e.target.value as QPCRChemistry)}
              disabled={readOnly || !onChemistryChange}
              className={`w-full px-2 py-1.5 border border-border rounded bg-surface-raised ${
                chemistryModified ? MODIFIED_CELL_CLASSES : ""
              }`}
              title={
                chemistryModified && originalChemistry
                  ? originalValueTooltip(originalChemistry)
                  : undefined
              }
            >
              {CHEMISTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {chemistry === "other" && (
            <label className="text-meta text-foreground-muted space-y-1">
              <span className="block">Chemistry label (free text)</span>
              <input
                type="text"
                value={chemistryLabel ?? ""}
                onChange={(e) => onChemistryLabelChange?.(e.target.value || null)}
                readOnly={readOnly || !onChemistryLabelChange}
                placeholder="e.g. proprietary master mix"
                className={`w-full px-2 py-1.5 border border-border rounded ${
                  chemistryLabelModified ? MODIFIED_CELL_CLASSES : ""
                }`}
              />
            </label>
          )}
        </div>
        <label className="text-meta text-foreground-muted block space-y-1">
          <span>Description</span>
          <textarea
            value={description ?? ""}
            onChange={(e) => onDescriptionChange?.(e.target.value || null)}
            readOnly={readOnly || !onDescriptionChange}
            placeholder="e.g. ΔΔCq fold-change of flbA relative to ACT1 in induced vs uninduced FakeYeast cultures."
            rows={2}
            className={`w-full px-2 py-1.5 border border-border rounded resize-y ${
              descriptionModified ? MODIFIED_CELL_CLASSES : ""
            }`}
          />
        </label>
        <label className="flex items-center gap-2 text-meta text-foreground">
          <input
            type="checkbox"
            checked={useDeltaDeltaCq}
            onChange={(e) => onUseDeltaDeltaCqChange?.(e.target.checked)}
            disabled={readOnly || !onUseDeltaDeltaCqChange}
            className={deltaModified ? "ring-2 ring-amber-300 rounded" : ""}
          />
          <span>
            Compute ΔΔCq fold-change vs the reference target (housekeeping gene)
          </span>
        </label>
      </section>

      {/* Section 2: targets / references table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider">
            Targets &amp; reference genes
          </h4>
          {!readOnly && onReferencesChange && (
            <Tooltip label="Add target row" placement="left">
              <button
                onClick={addReference}
                className="ros-btn-neutral px-2 py-1 text-meta text-foreground-muted"
              >
                + Target
              </button>
            </Tooltip>
          )}
        </div>
        <p className="text-meta text-foreground-muted">
          The row marked &ldquo;Reference?&rdquo; is the housekeeping gene for ΔΔCq. The other rows are the
          experimental targets whose fold-change you want to compute.
        </p>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-meta">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium text-foreground-muted">Target gene</th>
                <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-24">Channel</th>
                <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-20">Reference?</th>
                <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-24">Expected Cq</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {references.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-foreground-muted">
                    No targets defined yet. Add at least one experimental target plus one housekeeping reference.
                  </td>
                </tr>
              ) : (
                references.map((ref, idx) => {
                  const status = classifyRef(ref);
                  const rowClass =
                    status === "added"
                      ? ADDED_ROW_CLASSES
                      : idx % 2 === 0
                        ? "bg-surface-raised"
                        : "bg-surface-sunken";
                  const orig = originalRefsById?.get(ref.id);
                  return (
                    <tr key={ref.id} className={rowClass}>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={ref.target}
                          onChange={(e) => updateReference(idx, { target: e.target.value })}
                          readOnly={readOnly || !onReferencesChange}
                          placeholder="flbA"
                          className={`w-full px-2 py-1 border border-border rounded ${
                            status === "modified" && orig && orig.target !== ref.target
                              ? MODIFIED_CELL_CLASSES
                              : ""
                          }`}
                          title={
                            status === "modified" && orig && orig.target !== ref.target
                              ? originalValueTooltip(orig.target)
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={ref.channel}
                          onChange={(e) => updateReference(idx, { channel: e.target.value })}
                          readOnly={readOnly || !onReferencesChange}
                          placeholder="FAM"
                          className={`w-full px-2 py-1 border border-border rounded ${
                            status === "modified" && orig && orig.channel !== ref.channel
                              ? MODIFIED_CELL_CLASSES
                              : ""
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={ref.is_reference}
                          onChange={(e) => setReferenceFlag(idx, e.target.checked)}
                          disabled={readOnly || !onReferencesChange}
                          className={
                            status === "modified" && orig && orig.is_reference !== ref.is_reference
                              ? "ring-2 ring-amber-300 rounded"
                              : ""
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="0.1"
                          value={fmtNumber(ref.expected_cq)}
                          onChange={(e) =>
                            updateReference(idx, { expected_cq: parseNumberOrNull(e.target.value) })
                          }
                          readOnly={readOnly || !onReferencesChange}
                          placeholder="—"
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        {!readOnly && onReferencesChange && (
                          <Tooltip label="Remove target" placement="left">
                            <button
                              onClick={() => removeReference(idx)}
                              className="text-foreground-muted hover:text-red-500"
                            >
                              ✕
                            </button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              {removedRefs.map((r) => (
                <tr key={`removed-${r.id}`} className={REMOVED_ROW_CLASSES}>
                  <td className="px-2 py-1 line-through text-foreground-muted">{r.target || "(blank)"}</td>
                  <td className="px-2 py-1 line-through text-foreground-muted">{r.channel}</td>
                  <td className="px-2 py-1 text-center text-foreground-muted">
                    {r.is_reference ? "ref" : ""}
                  </td>
                  <td className="px-2 py-1 line-through text-foreground-muted">{fmtNumber(r.expected_cq)}</td>
                  <td className="px-2 py-1 text-center text-meta text-foreground-muted">removed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: standard curve dilution series */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider">
              Standard curve (optional)
            </h4>
            <p className="text-meta text-foreground-muted mt-0.5">
              Dilution-series Cq readouts used to derive primer efficiency. Leave empty when efficiency
              isn&rsquo;t being computed for this protocol.
            </p>
          </div>
          {!readOnly && onStandardCurveChange && (
            <Tooltip label="Add curve point" placement="left">
              <button
                onClick={addCurvePoint}
                className="ros-btn-neutral px-2 py-1 text-meta text-foreground-muted"
              >
                + Point
              </button>
            </Tooltip>
          )}
        </div>
        {standardCurve.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-meta">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-32">log₁₀(quantity)</th>
                  <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-24">Cq</th>
                  <th className="px-2 py-1.5 text-left font-medium text-foreground-muted w-24">Replicates</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {standardCurve.map((p, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.1"
                        value={fmtNumber(p.log_quantity)}
                        onChange={(e) =>
                          updateCurvePoint(idx, {
                            log_quantity: parseNumberOrNull(e.target.value) ?? 0,
                          })
                        }
                        readOnly={readOnly || !onStandardCurveChange}
                        className="w-full px-2 py-1 border border-border rounded"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={fmtNumber(p.cq)}
                        onChange={(e) =>
                          updateCurvePoint(idx, { cq: parseNumberOrNull(e.target.value) ?? 0 })
                        }
                        readOnly={readOnly || !onStandardCurveChange}
                        className="w-full px-2 py-1 border border-border rounded"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={fmtNumber(p.replicate_n)}
                        onChange={(e) => {
                          const n = parseNumberOrNull(e.target.value);
                          updateCurvePoint(idx, { replicate_n: n && n > 0 ? n : null });
                        }}
                        readOnly={readOnly || !onStandardCurveChange}
                        placeholder="3"
                        className="w-full px-2 py-1 border border-border rounded"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {!readOnly && onStandardCurveChange && (
                        <Tooltip label="Remove point" placement="left">
                          <button
                            onClick={() => removeCurvePoint(idx)}
                            className="text-foreground-muted hover:text-red-500"
                          >
                            ✕
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {standardCurveModified && (
          <p className="text-meta text-amber-700">Standard curve modified from source.</p>
        )}
      </section>

      {/* Section 4: melt-curve sweep */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider">
            Melt-curve sweep
          </h4>
          <label className="flex items-center gap-1.5 text-meta text-foreground-muted">
            <input
              type="checkbox"
              checked={meltCurve !== null}
              onChange={(e) => toggleMeltCurve(e.target.checked)}
              disabled={readOnly || !onMeltCurveChange}
            />
            <span>Enable melt curve</span>
          </label>
        </div>
        {meltCurve && (
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 ${meltCurveModified ? "ring-1 ring-amber-200 rounded p-2" : ""}`}>
            <label className="text-meta text-foreground-muted space-y-1">
              <span>Start (°C)</span>
              <input
                type="number"
                step="0.1"
                value={fmtNumber(meltCurve.start_c)}
                onChange={(e) =>
                  updateMelt({ start_c: parseNumberOrNull(e.target.value) ?? 60 })
                }
                readOnly={readOnly || !onMeltCurveChange}
                className="w-full px-2 py-1.5 border border-border rounded"
              />
            </label>
            <label className="text-meta text-foreground-muted space-y-1">
              <span>End (°C)</span>
              <input
                type="number"
                step="0.1"
                value={fmtNumber(meltCurve.end_c)}
                onChange={(e) =>
                  updateMelt({ end_c: parseNumberOrNull(e.target.value) ?? 95 })
                }
                readOnly={readOnly || !onMeltCurveChange}
                className="w-full px-2 py-1.5 border border-border rounded"
              />
            </label>
            <label className="text-meta text-foreground-muted space-y-1">
              <span>Ramp rate (°C/sec)</span>
              <input
                type="number"
                step="0.01"
                value={fmtNumber(meltCurve.ramp_rate_c_per_sec)}
                onChange={(e) =>
                  updateMelt({ ramp_rate_c_per_sec: parseNumberOrNull(e.target.value) ?? 0.1 })
                }
                readOnly={readOnly || !onMeltCurveChange}
                className="w-full px-2 py-1.5 border border-border rounded"
              />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
