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
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="px-3 py-2 font-semibold">Property</th>
              <th className="px-3 py-2 text-right font-semibold">ResearchOS</th>
              <th className="px-3 py-2 text-right font-semibold">Biopython</th>
              <th className="px-3 py-2 text-right font-semibold">Δ</th>
              <th className="px-3 py-2 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 text-gray-700">
                  {r.metric}
                  {r.unit ? <span className="ml-1 text-gray-400">({r.unit})</span> : null}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-800">{r.ours}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{r.theirs}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{r.delta}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
