/**
 * Derived views over a TransparencyReport for the page chrome.
 *
 * The page no longer shows 140+ verdict pills at once. Instead it summarizes the
 * agreement (most comparisons are exact, by design) and spotlights the handful of
 * genuine differences. These helpers compute those summaries from the report so
 * the components stay presentational.
 */

import { ORACLES } from "./oracles";
import type { ScalarComparison, TransparencyReport } from "./types";

/** Gated comparison counts, split by how close the agreement is. */
export interface AgreementCounts {
  /** Identical to the reference (delta 0). */
  exact: number;
  /** Non-zero but within the pass tolerance. */
  within: number;
  /**
   * Beyond pass but with a LOOSE tolerance: an approximate-by-design method
   * whose offset from an exact tool is expected, not a defect.
   */
  expected: number;
  /**
   * Beyond pass with a TIGHT tolerance: a faithful port that drifted past
   * parity. This is the only bucket that warrants the amber "larger difference"
   * framing. Currently zero.
   */
  larger: number;
  /** Total gated comparisons (exact + within + expected + larger). */
  total: number;
}

function tallyCounts(
  comparisons: { status: string; delta: number; informational?: boolean; tolerance: { kind: "tight" | "loose" } }[],
): AgreementCounts {
  let exact = 0;
  let within = 0;
  let expected = 0;
  let larger = 0;
  for (const cmp of comparisons) {
    if (cmp.informational) continue;
    if (cmp.status === "warn" || cmp.status === "fail") {
      if (cmp.tolerance.kind === "tight") larger += 1;
      else expected += 1;
    } else if (cmp.delta === 0) exact += 1;
    else within += 1;
  }
  return { exact, within, expected, larger, total: exact + within + expected + larger };
}

export function agreementCounts(report: TransparencyReport): AgreementCounts {
  return tallyCounts(report.domains.flatMap((d) => d.cases.flatMap((c) => c.comparisons)));
}

/** One genuine difference to spotlight. */
export interface Difference {
  domainId: string;
  domainTitle: string;
  caseLabel: string;
  oracleName: string;
  ours: number;
  theirs: number;
  delta: number;
  unit: string;
  /** "within" = small documented offset; "flagged" = beyond the pass band. */
  level: "within" | "flagged";
  /**
   * Tolerance kind, which decides how a flagged case reads. "tight" = a
   * faithful port that drifted past parity (a genuine "larger difference").
   * "loose" = an approximate-by-design method whose offset is expected, so a
   * flagged loose case is an "expected difference", not an alarm.
   */
  kind: "tight" | "loose";
  reason: string;
}

function oracleName(id: string): string {
  return ORACLES[id]?.name ?? id;
}

/**
 * Every gated comparison where ResearchOS is NOT identical to the reference,
 * worst (largest, then flagged) first. This is the honest centerpiece: the page
 * shows exactly where it differs and why.
 */
export function collectDifferences(report: TransparencyReport): Difference[] {
  const out: Difference[] = [];
  for (const d of report.domains) {
    for (const c of d.cases) {
      for (const cmp of c.comparisons) {
        if (cmp.informational) continue;
        if (cmp.delta === 0 || cmp.status === "pass") {
          // pass + delta 0 = exact (skip); pass + delta>0 = within tolerance (keep)
          if (cmp.delta === 0) continue;
        }
        const level: Difference["level"] = cmp.status === "pass" ? "within" : "flagged";
        out.push({
          domainId: d.id,
          domainTitle: d.title,
          caseLabel: c.label,
          oracleName: oracleName(cmp.oracleId),
          ours: cmp.ours,
          theirs: cmp.theirs,
          delta: cmp.delta,
          unit: cmp.tolerance.unit,
          level,
          kind: cmp.tolerance.kind,
          reason: cmp.tolerance.rationale,
        });
      }
    }
  }
  // Flagged before within; within each, largest delta first.
  const rank = { flagged: 0, within: 1 } as const;
  out.sort((a, b) => rank[a.level] - rank[b.level] || b.delta - a.delta);
  return out;
}

/** Are there any informational cross-method comparisons (Wallace / GC)? */
export function hasMethodContext(report: TransparencyReport): boolean {
  return report.domains.some((d) =>
    d.cases.some((c) => c.comparisons.some((cmp) => cmp.informational)),
  );
}

/** Gated comparisons for a domain, split exact / within / expected / larger. */
export function domainCounts(comparisons: ScalarComparison[]): AgreementCounts {
  return tallyCounts(comparisons);
}
