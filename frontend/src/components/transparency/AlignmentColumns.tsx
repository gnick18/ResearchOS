/**
 * Renders an actual pairwise alignment, column by column: the two gapped strands
 * with a connector row between them (a tick for a match, a dot for a mismatch, a
 * space over a gap). This is the signature "show the work" visual for alignment,
 * far clearer than a single score. Monospace, pure markup, server-renderable.
 */

interface Col {
  a: string;
  b: string;
  /** "match" | "mismatch" | "gap" */
  kind: "match" | "mismatch" | "gap";
}

function columns(alignedA: string, alignedB: string): Col[] {
  const n = Math.min(alignedA.length, alignedB.length);
  const out: Col[] = [];
  for (let i = 0; i < n; i++) {
    const a = alignedA[i];
    const b = alignedB[i];
    const kind = a === "-" || b === "-" ? "gap" : a === b ? "match" : "mismatch";
    out.push({ a, b, kind });
  }
  return out;
}

const CELL: Record<Col["kind"], string> = {
  match: "text-emerald-700",
  mismatch: "text-red-600",
  gap: "text-gray-400",
};

export default function AlignmentColumns({
  alignedA,
  alignedB,
  mode,
}: {
  alignedA: string;
  alignedB: string;
  mode: string;
}) {
  const cols = columns(alignedA, alignedB);
  const matches = cols.filter((c) => c.kind === "match").length;
  const identity = cols.length ? Math.round((matches / cols.length) * 1000) / 10 : 0;

  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-meta">
        <span className="font-semibold uppercase tracking-wide text-gray-500">{mode} alignment</span>
        <span className="text-gray-400">
          {matches}/{cols.length} columns identical ({identity}%)
        </span>
      </div>
      <div className="overflow-x-auto px-4 py-3">
        <div className="inline-flex flex-col font-mono text-[13px] leading-5">
          <div className="flex">
            {cols.map((c, i) => (
              <span key={`a${i}`} className={CELL[c.kind]}>
                {c.a}
              </span>
            ))}
          </div>
          <div className="flex text-gray-300">
            {cols.map((c, i) => (
              <span key={`m${i}`}>{c.kind === "match" ? "|" : c.kind === "mismatch" ? "·" : " "}</span>
            ))}
          </div>
          <div className="flex">
            {cols.map((c, i) => (
              <span key={`b${i}`} className={CELL[c.kind]}>
                {c.b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
