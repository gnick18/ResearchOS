"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type {
  QPCRAnalysisProtocol,
  QPCRAnalysisSnapshot,
} from "@/lib/types";

/**
 * Small per-task visualization component for qPCR analysis. Renders up to
 * three panels depending on what data is present:
 *   1. Per-target Cq bar chart (always renders when references are defined)
 *   2. Standard-curve scatter + linear regression line + efficiency readout
 *   3. ΔΔCq fold-change table (when the protocol toggles use_delta_delta_cq
 *      AND the snapshot carries Cq values for both the reference and one or
 *      more experimental targets)
 *
 * Animation is intentionally disabled (`isAnimationActive={false}`) so the
 * screenshot pipeline gets deterministic renders — Phase 1a's LC chip
 * established the precedent.
 */
export interface QpcrAnalysisVizProps {
  protocol: QPCRAnalysisProtocol;
  snapshot: QPCRAnalysisSnapshot | null;
}

interface CqBarDatum {
  target: string;
  refId: string;
  cq: number | null;
  isReference: boolean;
}

interface StandardCurvePlotPoint {
  logQ: number;
  cq: number;
  fit?: number;
}

interface DeltaDeltaCqRow {
  target: string;
  cq: number;
  deltaCq: number;
  foldChange: number;
}

function linearRegression(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
  r2: number;
} | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const rDenom = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  const r = rDenom === 0 ? 0 : (n * sumXY - sumX * sumY) / rDenom;
  return { slope, intercept, r2: r * r };
}

function efficiencyPercent(slope: number): number {
  // E = 10^(-1/slope) - 1; expressed as percentage.
  return (Math.pow(10, -1 / slope) - 1) * 100;
}

export default function QpcrAnalysisViz({ protocol, snapshot }: QpcrAnalysisVizProps) {
  const referenceTarget = protocol.references.find((r) => r.is_reference);

  const cqBarData = useMemo<CqBarDatum[]>(() => {
    return protocol.references.map((r) => ({
      refId: r.id,
      target: r.target || "(unnamed)",
      cq: snapshot?.cqs?.[r.id]?.cq ?? null,
      isReference: r.is_reference,
    }));
  }, [protocol.references, snapshot]);

  const hasAnyCq = cqBarData.some((d) => d.cq !== null);

  const standardCurveData = useMemo<{
    points: StandardCurvePlotPoint[];
    fit: { slope: number; intercept: number; r2: number; eff: number } | null;
  }>(() => {
    const raw = protocol.standard_curve ?? [];
    if (raw.length < 2) return { points: [], fit: null };
    const fit = linearRegression(raw.map((p) => ({ x: p.log_quantity, y: p.cq })));
    const points: StandardCurvePlotPoint[] = raw.map((p) => ({
      logQ: p.log_quantity,
      cq: p.cq,
      fit: fit ? fit.slope * p.log_quantity + fit.intercept : undefined,
    }));
    return {
      points,
      fit: fit ? { ...fit, eff: efficiencyPercent(fit.slope) } : null,
    };
  }, [protocol.standard_curve]);

  const deltaRows = useMemo<DeltaDeltaCqRow[]>(() => {
    if (!protocol.use_delta_delta_cq || !referenceTarget || !snapshot) return [];
    const refCq = snapshot.cqs?.[referenceTarget.id]?.cq;
    if (refCq === undefined) return [];
    return protocol.references
      .filter((r) => !r.is_reference)
      .map((r) => {
        const cq = snapshot.cqs?.[r.id]?.cq;
        if (cq === undefined) return null;
        const deltaCq = cq - refCq;
        return {
          target: r.target || "(unnamed)",
          cq,
          deltaCq,
          foldChange: Math.pow(2, -deltaCq),
        };
      })
      .filter((row): row is DeltaDeltaCqRow => row !== null);
  }, [protocol, referenceTarget, snapshot]);

  if (cqBarData.length === 0) {
    return (
      <p className="text-body text-foreground-muted">
        No targets defined yet — add at least one in the editor above.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cq bar chart */}
      <div>
        <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider mb-2">
          Per-target Cq{hasAnyCq ? "" : " (no readouts entered yet)"}
        </h4>
        <div className="border border-border rounded-lg p-3 bg-surface-raised" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cqBarData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="target" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                domain={[0, "dataMax + 5"]}
                label={{ value: "Cq", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
              />
              <RechartsTooltip />
              <Bar dataKey="cq" isAnimationActive={false}>
                {cqBarData.map((d) => (
                  <Cell key={d.refId} fill={d.isReference ? "#f59e0b" : "#3b82f6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-meta text-foreground-muted mt-1">
          Amber bars = reference / housekeeping target. Blue bars = experimental targets.
        </p>
      </div>

      {/* Standard curve scatter + fit line */}
      {standardCurveData.points.length > 0 && (
        <div>
          <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            Standard curve
            {standardCurveData.fit && (
              <span className="ml-2 font-normal text-foreground-muted">
                slope {standardCurveData.fit.slope.toFixed(3)}, R² {standardCurveData.fit.r2.toFixed(3)},
                efficiency {standardCurveData.fit.eff.toFixed(1)}%
              </span>
            )}
          </h4>
          <div className="border border-border rounded-lg p-3 bg-surface-raised" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="logQ"
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "log₁₀(quantity)",
                    position: "insideBottom",
                    offset: -5,
                    style: { fontSize: 11 },
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="cq"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Cq", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                <ZAxis range={[60, 60]} />
                <RechartsTooltip />
                <Scatter
                  name="Standard"
                  data={standardCurveData.points}
                  fill="#3b82f6"
                  isAnimationActive={false}
                />
                {standardCurveData.fit && (
                  <Line
                    type="linear"
                    dataKey="fit"
                    data={standardCurveData.points}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ΔΔCq fold-change readouts */}
      {deltaRows.length > 0 && (
        <div>
          <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            ΔΔCq fold-change vs {referenceTarget?.target || "reference"}
          </h4>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-meta">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-foreground-muted">Target</th>
                  <th className="px-3 py-1.5 text-right font-medium text-foreground-muted">Cq</th>
                  <th className="px-3 py-1.5 text-right font-medium text-foreground-muted">ΔCq</th>
                  <th className="px-3 py-1.5 text-right font-medium text-foreground-muted">Fold change (2⁻ΔΔᶜq)</th>
                </tr>
              </thead>
              <tbody>
                {deltaRows.map((row, idx) => (
                  <tr key={row.target} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                    <td className="px-3 py-1">{row.target}</td>
                    <td className="px-3 py-1 text-right">{row.cq.toFixed(2)}</td>
                    <td className="px-3 py-1 text-right">{row.deltaCq.toFixed(2)}</td>
                    <td className="px-3 py-1 text-right font-medium text-blue-700 dark:text-blue-300">
                      {row.foldChange < 0.01 || row.foldChange > 100
                        ? row.foldChange.toExponential(2)
                        : row.foldChange.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-meta text-foreground-muted mt-1">
            v2 ΔΔCq treats a single experimental condition vs the reference target. Multi-condition
            comparisons (induced vs uninduced sample-level fold change) live in v2.1.
          </p>
        </div>
      )}

      {/* Melt-curve Tm readouts (when entered) */}
      {snapshot?.melt_tms && Object.keys(snapshot.melt_tms).length > 0 && (
        <div>
          <h4 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            Melt-curve Tm readouts
          </h4>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-meta">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-foreground-muted">Target</th>
                  <th className="px-3 py-1.5 text-right font-medium text-foreground-muted">Tm (°C)</th>
                </tr>
              </thead>
              <tbody>
                {protocol.references.map((r, idx) => {
                  const tm = snapshot.melt_tms?.[r.id];
                  if (tm === undefined) return null;
                  return (
                    <tr key={r.id} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                      <td className="px-3 py-1">{r.target || "(unnamed)"}</td>
                      <td className="px-3 py-1 text-right">{tm.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
