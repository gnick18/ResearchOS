import type { Status } from "@/lib/transparency/types";

import StatusPill from "./StatusPill";

/**
 * Per-property comparison table for a protein case: one row per computed
 * quantity (molecular weight, pI, extinction, instability, GRAVY, aliphatic),
 * ResearchOS beside Biopython with the difference and a verdict. This is the
 * signature visual for the protein-parameter domain, where a single number does
 * not capture the breadth of what is being validated.
 */

export interface PropertyRow {
  metric: string;
  ours: number;
  theirs: number;
  delta: number;
  unit: string;
  status: Status;
}

export default function PropertyTable({ rows }: { rows: PropertyRow[] }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      {/* Desktop table — hidden on phones */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-foreground-muted">
              <th className="px-3 py-2 font-semibold">Property</th>
              <th className="px-3 py-2 text-right font-semibold">ResearchOS</th>
              <th className="px-3 py-2 text-right font-semibold">Biopython</th>
              <th className="px-3 py-2 text-right font-semibold">Δ</th>
              <th className="px-3 py-2 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  {r.metric}
                  {r.unit ? <span className="ml-1 text-foreground-muted">({r.unit})</span> : null}
                </td>
                <td className="px-3 py-2 text-right font-mono text-foreground">{r.ours}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{r.theirs}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{r.delta}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} exact={r.delta === 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone stacked cards — visible below sm */}
      <div className="sm:hidden divide-y divide-border">
        {rows.map((r) => (
          <div key={r.metric} className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {r.metric}
                {r.unit ? <span className="ml-1 text-foreground-muted text-meta">({r.unit})</span> : null}
              </span>
              <StatusPill status={r.status} exact={r.delta === 0} />
            </div>
            <div className="grid grid-cols-3 gap-x-2 text-meta text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Ours</div>
                <div className="font-mono text-foreground">{r.ours}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Biopython</div>
                <div className="font-mono text-foreground-muted">{r.theirs}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Δ</div>
                <div className="font-mono text-foreground-muted">{r.delta}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
