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
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
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
                <tr key={c.id} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{c.label}</div>
                    <div className="mt-0.5 text-[11px] text-gray-400">{c.input}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800 whitespace-nowrap">
                    {cmp.ours} {cmp.tolerance.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600 whitespace-nowrap">
                    {cmp.theirs} {cmp.tolerance.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-500">{cmp.delta}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={cmp.status} exact={cmp.delta === 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
