import type { DomainReport } from "@/lib/transparency/types";

import StatusPill from "./StatusPill";

/**
 * Comparison table for a scalar domain whose cases use different units (the lab
 * calculators: grams, micromolar, microliters, picomoles). A single agreement
 * scatter would be meaningless across mixed units, so each calculation is its own
 * row with the result, the closed-form expected value, and the difference, each
 * carrying its own unit. Every case here has exactly one comparison.
 */
export default function ScalarMixedTable({ domain }: { domain: DomainReport }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      {/* Desktop table — hidden on phones */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-foreground-muted">
              <th className="px-3 py-2 font-semibold">Calculation</th>
              <th className="px-3 py-2 text-right font-semibold">ResearchOS</th>
              <th className="px-3 py-2 text-right font-semibold">Expected</th>
              <th className="px-3 py-2 text-right font-semibold">Δ</th>
              <th className="px-3 py-2 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {domain.cases.map((c) => {
              const cmp = c.comparisons[0];
              if (!cmp) return null;
              return (
                <tr key={c.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{c.label}</div>
                    <div className="mt-0.5 text-meta text-foreground-muted">{c.input}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground whitespace-nowrap">
                    {cmp.ours} {cmp.tolerance.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground-muted whitespace-nowrap">
                    {cmp.theirs} {cmp.tolerance.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground-muted">{cmp.delta}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={cmp.status} exact={cmp.delta === 0} kind={cmp.tolerance.kind} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone stacked cards — visible below sm */}
      <div className="sm:hidden divide-y divide-border">
        {domain.cases.map((c) => {
          const cmp = c.comparisons[0];
          if (!cmp) return null;
          return (
            <div key={c.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{c.label}</div>
                  {c.input ? <div className="mt-0.5 text-meta text-foreground-muted">{c.input}</div> : null}
                </div>
                <StatusPill status={cmp.status} exact={cmp.delta === 0} kind={cmp.tolerance.kind} />
              </div>
              <div className="grid grid-cols-3 gap-x-2 text-meta text-center">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Ours</div>
                  <div className="font-mono text-foreground whitespace-nowrap">{cmp.ours} {cmp.tolerance.unit}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Expected</div>
                  <div className="font-mono text-foreground-muted whitespace-nowrap">{cmp.theirs} {cmp.tolerance.unit}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Δ</div>
                  <div className="font-mono text-foreground-muted">{cmp.delta}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
