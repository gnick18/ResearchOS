// Lipinski Rule-of-Five badge (chemistry v2 Phase 1c). A calm at-a-glance
// druglikeness verdict computed from the molecule's RDKit descriptors. Green
// when drug-like (no more than one rule violated), amber when not, with the
// failing rules listed beneath. Renders nothing when no descriptor was
// available to judge (e.g. a structure RDKit could not fully parse).

import type { LipinskiResult } from "@/lib/chemistry/rdkit";

export function LipinskiBadge({
  result,
  className,
}: {
  result: LipinskiResult;
  className?: string;
}) {
  // Nothing to say if not a single rule could be evaluated.
  if (result.violations.every((v) => v.ok) && !result.complete) return null;

  const failed = result.violations.filter((v) => !v.ok);
  const tone = result.pass
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
  const label = result.pass
    ? "Drug-like (Lipinski Ro5)"
    : `${result.count} of 4 Lipinski rules violated`;

  return (
    <div className={`rounded-lg border px-3 py-2 text-meta ${tone} ${className ?? ""}`}>
      <div className="font-semibold">
        {label}
        {!result.complete ? (
          <span className="font-normal opacity-70"> (partial)</span>
        ) : null}
      </div>
      {failed.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 opacity-90">
          {failed.map((v) => (
            <li key={v.rule}>{v.rule}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default LipinskiBadge;
