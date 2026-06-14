"use client";

// DatasetAnalysisDialog (DataHub-largetables lane, Phase 3a).
//
// The dataset-lane analysis chooser, the large-table mirror of NewAnalysisDialog.
// It offers the analyses valid for the dataset's schema (gated by the numeric
// column count, plus the tidy / long group-by mode when a categorical column
// exists), pulls the chosen columns out of DuckDB into arrays, and runs them
// through runAnalysisOnDataset, which hands the arrays to the SAME validated
// engine the editable lane uses. The result renders through the REUSED
// ResultsSheet, so the dataset lane shows results identically to the editable lane.
// A Save persists the analysis spec to the dataset sidecar (savedAnalyses).
//
// THE VALIDATION GATE. DuckDB only MOVES the columns into arrays here. Every
// statistic is computed by the validated engine via runAnalysisOnDataset; this
// dialog never computes one.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white, <Icon> only, Tooltip for
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { TYPE_META } from "@/components/datahub/NewAnalysisDialog";
import ResultsSheet from "@/components/datahub/ResultsSheet";
import type { AnalysisType, RunOutcome } from "@/lib/datahub/run-analysis";
import type { AnalysisSpec, DataHubDocContent } from "@/lib/datahub/model/types";
import type { DatasetSidecar, SavedDatasetAnalysis } from "@/lib/datahub/bigtable/types";
import type { OpenDatasetHandle } from "@/lib/datahub/bigtable/dataset-view";
import {
  runAnalysisOnDataset,
  buildDatasetAnalysisContent,
  validDatasetAnalysisTypes,
  analysisIsXY,
  analysisIsWholeTableMultiCol,
} from "@/lib/datahub/bigtable/dataset-analyses";
import { readDistinctLabels } from "@/lib/datahub/bigtable/dataset-columns";
import { saveDatasetAnalysis } from "@/lib/datahub/bigtable/dataset-store";

/** A two-group test takes exactly two columns; the rest take all chosen. */
function isTwoGroup(type: AnalysisType): boolean {
  return TYPE_META[type].groupCount === "two";
}
/** Grubbs screens every chosen numeric column on its own. */
function isScreen(type: AnalysisType): boolean {
  return TYPE_META[type].groupCount === "screen";
}

export default function DatasetAnalysisDialog({
  open,
  owner,
  sidecar,
  handle,
  onClose,
  onSaved,
}: {
  open: boolean;
  owner: string;
  sidecar: DatasetSidecar;
  /** The dataset opened into DuckDB (from DatasetView). Null while opening. */
  handle: OpenDatasetHandle | null;
  onClose: () => void;
  /** Called with the updated sidecar after a Save, so the rail can refresh. */
  onSaved?: (sidecar: DatasetSidecar) => void;
}) {
  const numericNames = useMemo(
    () => sidecar.schema.filter((c) => c.type === "number").map((c) => c.name),
    [sidecar.schema],
  );
  const categoricalNames = useMemo(
    () => sidecar.schema.filter((c) => c.type !== "number").map((c) => c.name),
    [sidecar.schema],
  );
  const valid = useMemo(
    () => validDatasetAnalysisTypes(numericNames.length, categoricalNames.length),
    [numericNames.length, categoricalNames.length],
  );

  // Column mode: "wide" (chosen numeric columns are the groups) or "groupBy" (one
  // value column split by a categorical column).
  const [mode, setMode] = useState<"wide" | "groupBy">("wide");
  const offered = mode === "wide" ? valid.wide : valid.groupBy;

  const [type, setType] = useState<AnalysisType | null>(null);
  // WIDE picks.
  const [columnA, setColumnA] = useState("");
  const [columnB, setColumnB] = useState("");
  const [multiCols, setMultiCols] = useState<string[]>([]);
  // GROUP-BY picks.
  const [valueColumn, setValueColumn] = useState("");
  const [groupColumn, setGroupColumn] = useState("");
  // WHOLE-TABLE multi-column picks (two-way ANOVA, contingency, survival, nested).
  // value = valueColumn (reused); the two factors / subgroup are categorical; a
  // survival analysis uses time + event (numeric) and an optional group.
  const [rowFactor, setRowFactor] = useState("");
  const [colFactor, setColFactor] = useState("");
  const [timeCol, setTimeCol] = useState("");
  const [eventCol, setEventCol] = useState("");
  const [survGroup, setSurvGroup] = useState("");
  // The distinct levels of the chosen group-by column, loaded on demand so a
  // two-group test on a 3+ level column can ask which two levels to compare. Null
  // while loading / not yet needed.
  const [groupLevels, setGroupLevels] = useState<string[] | null>(null);
  const [groupA, setGroupA] = useState("");
  const [groupB, setGroupB] = useState("");

  // The run result + the synthetic content ResultsSheet recomputes against.
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    spec: AnalysisSpec;
    content: DataHubDocContent;
    outcome: RunOutcome;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset on open and on a mode switch: default to the first offered type, the
  // first two numeric columns, every numeric column for the multi-group types, and
  // the first value / categorical columns for group-by.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setRunError(null);
    setSaved(false);
    setType(offered[0] ?? null);
    setColumnA(numericNames[0] ?? "");
    setColumnB(numericNames[1] ?? "");
    setMultiCols(numericNames);
    setValueColumn(numericNames[0] ?? "");
    setGroupColumn(categoricalNames[0] ?? "");
    setGroupLevels(null);
    setGroupA("");
    setGroupB("");
    setRowFactor(categoricalNames[0] ?? "");
    setColFactor(categoricalNames[1] ?? "");
    setTimeCol(numericNames[0] ?? "");
    setEventCol(numericNames[1] ?? "");
    setSurvGroup(categoricalNames[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // Load the group-by column's distinct levels when a TWO-GROUP test is selected
  // in group-by mode, so the user can pick exactly which two levels to compare on
  // a 3+ level column (instead of the runner silently taking the first two). The
  // group column moving or the type changing reloads; switching away clears.
  const needsGroupLevels =
    mode === "groupBy" && type !== null && isTwoGroup(type) && groupColumn !== "";
  useEffect(() => {
    if (!open || !needsGroupLevels || handle === null) {
      setGroupLevels(null);
      return;
    }
    let cancelled = false;
    setGroupLevels(null);
    void readDistinctLabels(handle, groupColumn, sidecar.recipe)
      .then((levels) => {
        if (cancelled) return;
        setGroupLevels(levels);
        setGroupA(levels[0] ?? "");
        setGroupB(levels[1] ?? "");
      })
      .catch(() => {
        if (!cancelled) setGroupLevels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsGroupLevels, handle, groupColumn, sidecar.recipe]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cleanMulti = multiCols.filter((n) => numericNames.includes(n));
  // A two-group test on a group-by column with 3+ levels asks which two levels to
  // compare. Below that (2 levels, still loading, or a 3+ group test) the runner
  // uses every level as before.
  const showGroupPair =
    needsGroupLevels && groupLevels !== null && groupLevels.length > 2;
  // Whole-table multi-column readiness, per the columns each shape needs.
  const wholeTableReady = (t: AnalysisType): boolean => {
    if (t === "contingency")
      return rowFactor !== "" && colFactor !== "" && rowFactor !== colFactor;
    if (t === "kaplanMeier")
      return timeCol !== "" && eventCol !== "" && timeCol !== eventCol;
    if (t === "coxRegression")
      return (
        timeCol !== "" && eventCol !== "" && timeCol !== eventCol && survGroup !== ""
      );
    // two-way ANOVA + nested
    return (
      valueColumn !== "" &&
      rowFactor !== "" &&
      colFactor !== "" &&
      rowFactor !== colFactor
    );
  };
  const canRun =
    handle !== null &&
    type !== null &&
    (analysisIsWholeTableMultiCol(type)
      ? wholeTableReady(type)
      : mode === "groupBy"
        ? valueColumn !== "" &&
          groupColumn !== "" &&
          (!showGroupPair || (groupA !== "" && groupB !== "" && groupA !== groupB))
        : isTwoGroup(type)
          ? columnA !== "" && columnB !== "" && columnA !== columnB
          : isScreen(type)
            ? cleanMulti.length >= 1
            : cleanMulti.length >= 3);

  const selCls =
    "mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none";
  const labelCls =
    "block text-meta font-medium uppercase tracking-wide text-foreground-muted";

  // Resolve the chosen columns into an analysis spec's columnIds (dataset column
  // NAMES) the SAME way for both run and save.
  const resolveColumnIds = (t: AnalysisType): string[] => {
    if (analysisIsWholeTableMultiCol(t)) {
      if (t === "contingency") return [rowFactor, colFactor];
      if (t === "kaplanMeier" || t === "coxRegression")
        return survGroup ? [timeCol, eventCol, survGroup] : [timeCol, eventCol];
      // two-way ANOVA + nested: value, then the two factors / group + subgroup.
      return [valueColumn, rowFactor, colFactor];
    }
    if (mode === "groupBy") return [valueColumn];
    if (isTwoGroup(t)) return [columnA, columnB];
    return cleanMulti;
  };

  // The dataset-analysis options shared by run + save: the group-by column, plus
  // the chosen [Group A, Group B] pair when a two-group test runs on a 3+ level
  // column (so the runner compares the chosen levels, not the first two).
  const buildOpts = () => {
    if (mode !== "groupBy") return {};
    return showGroupPair
      ? { groupByColumn: groupColumn, groupPair: [groupA, groupB] as [string, string] }
      : { groupByColumn: groupColumn };
  };

  const buildSpec = (t: AnalysisType): AnalysisSpec => ({
    id: `ds-an-${Date.now()}`,
    type: t,
    params: {},
    inputs: { columnIds: resolveColumnIds(t) },
    resultCache: null,
    resultStale: false,
  });

  const run = async () => {
    if (!canRun || type === null || !handle) return;
    setRunning(true);
    setRunError(null);
    setSaved(false);
    try {
      const spec = buildSpec(type);
      const opts = buildOpts();
      const outcome = await runAnalysisOnDataset(handle, spec, sidecar, opts);
      const built = await buildDatasetAnalysisContent(handle, spec, sidecar, opts);
      if (!built) {
        setRunError("Could not read the chosen columns for this analysis.");
        return;
      }
      setResult({ spec: built.spec, content: built.content, outcome });
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "The analysis could not run.");
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!result || type === null) return;
    setSaving(true);
    try {
      const entry: SavedDatasetAnalysis = {
        id: `ds-an-${Date.now()}`,
        type,
        params: {},
        inputs: { columnIds: resolveColumnIds(type) },
        ...(mode === "groupBy" ? { groupByColumn: groupColumn } : {}),
        ...(showGroupPair ? { groupPair: [groupA, groupB] as [string, string] } : {}),
        resultCache: result.outcome.ok ? result.outcome : null,
        resultStale: false,
        created_at: new Date().toISOString(),
      };
      const updated = await saveDatasetAnalysis(owner, sidecar.id, entry);
      if (updated) {
        setSaved(true);
        onSaved?.(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="dataset-analysis-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Analyze dataset"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface-overlay shadow-xl"
      >
        <div className="flex-none px-5 pt-5">
          <h2 className="text-title font-semibold text-foreground">
            Analyze {sidecar.name}
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            The statistic is computed by the same validated engine the editable
            tables use. The dataset only moves the chosen columns into the test.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">
          {result ? (
            <div className="mt-4" data-testid="dataset-analysis-result">
              <ResultsSheet
                spec={result.spec}
                content={result.content}
                title={type ? TYPE_META[type].label : "Result"}
              />
            </div>
          ) : (
            <>
              {/* Column mode */}
              <div className="mt-4 inline-flex rounded-md border border-border bg-surface-raised p-0.5 text-meta">
                <button
                  type="button"
                  onClick={() => setMode("wide")}
                  className={`rounded px-3 py-1 font-medium transition-colors ${
                    mode === "wide"
                      ? "bg-accent-soft text-foreground"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                  data-testid="dataset-analysis-mode-wide"
                >
                  Columns are groups
                </button>
                <button
                  type="button"
                  onClick={() => setMode("groupBy")}
                  disabled={valid.groupBy.length === 0}
                  className={`rounded px-3 py-1 font-medium transition-colors disabled:opacity-40 ${
                    mode === "groupBy"
                      ? "bg-accent-soft text-foreground"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                  data-testid="dataset-analysis-mode-groupby"
                >
                  Split one column by a label
                </button>
              </div>

              {offered.length === 0 ? (
                <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
                  {mode === "groupBy"
                    ? "Add a text label column and a numeric column to split it by."
                    : "Add at least two numeric columns to run an analysis."}
                </p>
              ) : (
                <>
                  <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Analysis
                  </label>
                  <div className="mt-1 flex flex-col gap-2">
                    {offered.map((t) => {
                      const active = type === t;
                      const meta = TYPE_META[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setType(t)}
                          className={`rounded-md border px-3 py-2 text-left transition-colors ${
                            active
                              ? "border-sky-400 bg-accent-soft"
                              : "border-border bg-surface-raised hover:bg-surface-sunken"
                          }`}
                        >
                          <span className="block text-body font-medium text-foreground">
                            {meta.label}
                          </span>
                          <span className="mt-0.5 block text-meta text-foreground-muted">
                            {meta.blurb}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Column pickers */}
                  {mode === "groupBy" ? (
                    <>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                            Value column
                          </label>
                          <select
                            value={valueColumn}
                            onChange={(e) => setValueColumn(e.target.value)}
                            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                          >
                            {numericNames.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                            Group-by column
                          </label>
                          <select
                            value={groupColumn}
                            onChange={(e) => setGroupColumn(e.target.value)}
                            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                          >
                            {categoricalNames.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {/* A two-group test on a 3+ level column compares the chosen
                          pair, not the first two levels seen. */}
                      {showGroupPair && groupLevels && (
                        <div className="mt-3">
                          <p className="text-meta text-foreground-muted">
                            This column has {groupLevels.length} groups. Pick the two
                            to compare.
                          </p>
                          <div className="mt-1 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                                Group A
                              </label>
                              <select
                                value={groupA}
                                onChange={(e) => setGroupA(e.target.value)}
                                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                                data-testid="dataset-analysis-group-a"
                              >
                                {groupLevels.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                                Group B
                              </label>
                              <select
                                value={groupB}
                                onChange={(e) => setGroupB(e.target.value)}
                                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                                data-testid="dataset-analysis-group-b"
                              >
                                {groupLevels.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {groupA === groupB && (
                              <p className="col-span-2 text-meta text-amber-600">
                                Pick two different groups to compare.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : type && analysisIsWholeTableMultiCol(type) ? (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {(type === "twoWayAnova" ||
                        type === "nestedTTest" ||
                        type === "nestedOneWayAnova") && (
                        <div className="col-span-2">
                          <label className={labelCls}>Value column</label>
                          <select
                            value={valueColumn}
                            onChange={(e) => setValueColumn(e.target.value)}
                            className={selCls}
                            data-testid="dataset-analysis-value"
                          >
                            {numericNames.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {(type === "twoWayAnova" ||
                        type === "contingency" ||
                        type === "nestedTTest" ||
                        type === "nestedOneWayAnova") && (
                        <>
                          <div>
                            <label className={labelCls}>
                              {type === "nestedTTest" || type === "nestedOneWayAnova"
                                ? "Group"
                                : "Row factor"}
                            </label>
                            <select
                              value={rowFactor}
                              onChange={(e) => setRowFactor(e.target.value)}
                              className={selCls}
                              data-testid="dataset-analysis-rowfactor"
                            >
                              {categoricalNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>
                              {type === "nestedTTest" || type === "nestedOneWayAnova"
                                ? "Subgroup"
                                : "Column factor"}
                            </label>
                            <select
                              value={colFactor}
                              onChange={(e) => setColFactor(e.target.value)}
                              className={selCls}
                              data-testid="dataset-analysis-colfactor"
                            >
                              {categoricalNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          {rowFactor === colFactor && (
                            <p className="col-span-2 text-meta text-amber-600">
                              Pick two different columns.
                            </p>
                          )}
                        </>
                      )}
                      {(type === "kaplanMeier" || type === "coxRegression") && (
                        <>
                          <div>
                            <label className={labelCls}>Time column</label>
                            <select
                              value={timeCol}
                              onChange={(e) => setTimeCol(e.target.value)}
                              className={selCls}
                              data-testid="dataset-analysis-time"
                            >
                              {numericNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Event column (0/1)</label>
                            <select
                              value={eventCol}
                              onChange={(e) => setEventCol(e.target.value)}
                              className={selCls}
                              data-testid="dataset-analysis-event"
                            >
                              {numericNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className={labelCls}>
                              {type === "coxRegression"
                                ? "Group (the arms to compare)"
                                : "Group (optional)"}
                            </label>
                            <select
                              value={survGroup}
                              onChange={(e) => setSurvGroup(e.target.value)}
                              className={selCls}
                              data-testid="dataset-analysis-survgroup"
                            >
                              {type === "kaplanMeier" && (
                                <option value="">None (all subjects)</option>
                              )}
                              {categoricalNames.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          {timeCol === eventCol && (
                            <p className="col-span-2 text-meta text-amber-600">
                              Pick different time and event columns.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ) : type && isTwoGroup(type) ? (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                          {analysisIsXY(type) ? "X column" : "First column"}
                        </label>
                        <select
                          value={columnA}
                          onChange={(e) => setColumnA(e.target.value)}
                          className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                        >
                          {numericNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                          {analysisIsXY(type)
                            ? type === "rocCurve" || type === "logisticRegression"
                              ? "Y column (0/1 outcome)"
                              : "Y column"
                            : "Second column"}
                        </label>
                        <select
                          value={columnB}
                          onChange={(e) => setColumnB(e.target.value)}
                          className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                        >
                          {numericNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      {columnA === columnB && (
                        <p className="col-span-2 text-meta text-amber-600">
                          Pick two different columns to compare.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                        {type === "multipleRegression"
                          ? "Y column first, then the predictors"
                          : "Columns to include"}
                      </label>
                      <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-2">
                        {numericNames.map((n) => (
                          <label
                            key={n}
                            className="flex items-center gap-2 rounded px-1.5 py-1 text-body text-foreground hover:bg-surface-sunken"
                          >
                            <input
                              type="checkbox"
                              checked={multiCols.includes(n)}
                              onChange={() =>
                                setMultiCols((prev) =>
                                  prev.includes(n)
                                    ? prev.filter((x) => x !== n)
                                    : [...prev, n],
                                )
                              }
                              className="h-3.5 w-3.5 accent-sky-500"
                            />
                            {n}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {runError && (
                <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-meta text-foreground">
                  {runError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-4">
          {result ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setSaved(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
              >
                <Icon name="results" className="h-4 w-4" />
                Run another
              </button>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-meta text-emerald-600">Saved to dataset</span>
                )}
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || saved || !result.outcome.ok}
                  className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground hover:bg-surface-sunken disabled:opacity-50"
                  data-testid="dataset-analysis-save"
                >
                  {saving ? "Saving" : "Save analysis"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <span />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
                >
                  Cancel
                </button>
                <Tooltip
                  label={
                    handle === null ? "The dataset is still opening" : "Run the analysis"
                  }
                >
                  <button
                    type="button"
                    onClick={() => void run()}
                    disabled={!canRun || running}
                    className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
                    data-testid="dataset-analysis-run"
                  >
                    {running ? "Running" : "Run analysis"}
                  </button>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
