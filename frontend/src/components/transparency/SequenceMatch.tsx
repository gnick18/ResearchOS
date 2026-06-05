/**
 * Result card for a cloning-assembly case: the reaction type, the assembled
 * product length, whether it equals the oracle's molecule, and a short preview
 * of the product sequence. The "visual" for an assembly is the construct itself,
 * so this shows the product rather than a chart.
 */

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function SequenceMatch({
  method,
  length,
  matches,
  preview,
}: {
  method: string;
  length: number;
  matches: boolean;
  preview: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-meta">
        <span className="font-semibold uppercase tracking-wide text-gray-500">{method}</span>
        <span className="text-gray-400">{length} bp product</span>
      </div>
      <div className="px-4 py-3">
        <div
          className={`mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium ${
            matches ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {matches ? <CheckIcon /> : <CrossIcon />}
          {matches ? "Identical to the reference molecule" : "Does not match the reference"}
        </div>
        <div className="overflow-x-auto rounded-lg bg-gray-50 px-3 py-2">
          <code className="whitespace-pre font-mono text-[12px] text-gray-700">{preview}</code>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Compared as a canonical circular molecule (rotation and strand invariant).
        </p>
      </div>
    </figure>
  );
}
