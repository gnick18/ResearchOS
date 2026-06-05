/**
 * Result card for one protein in the domain-annotation domain: the Pfam domains
 * native HMMER (the oracle) reported, side by side with the on-device WASM
 * engine's call. For a faithful port the two envelope columns are identical to
 * the residue, so the visual for this domain is the reconciled domain table
 * itself rather than a chart. A negative control shows the "no domain" state.
 *
 * Voice: factual, no em-dashes, no emojis, no mid-sentence colons. Every icon is
 * an inline SVG.
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

interface DomainRow {
  accession: string;
  name: string;
  native: { start: number; end: number } | null;
  ours: { start: number; end: number } | null;
  exact: boolean;
}

function span(coords: { start: number; end: number } | null): string {
  return coords ? `${coords.start}-${coords.end}` : "none";
}

export default function DomainSet({
  domains,
  negativeControl,
}: {
  domains: DomainRow[];
  negativeControl: boolean;
}) {
  if (negativeControl || domains.length === 0) {
    const clean = domains.length === 0;
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium ${
          clean ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}
      >
        {clean ? <CheckIcon /> : <CrossIcon />}
        {negativeControl
          ? clean
            ? "No domain reported by either engine (correct for a negative control)"
            : "A domain was reported on a negative control"
          : "No domain reported"}
      </div>
    );
  }

  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="px-3 py-2 font-semibold">Pfam family</th>
              <th className="px-3 py-2 text-right font-semibold">Native HMMER</th>
              <th className="px-3 py-2 text-right font-semibold">On-device</th>
              <th className="px-3 py-2 font-semibold">Match</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d, i) => (
              <tr key={`${d.accession}-${i}`} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-800">{d.name}</span>{" "}
                  <span className="font-mono text-[11px] text-gray-400">{d.accession}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{span(d.native)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">{span(d.ours)}</td>
                <td className="px-3 py-2">
                  {d.exact ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckIcon />
                      exact
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-700">
                      <CrossIcon />
                      differs
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-meta text-gray-400">
        Envelope coordinates (1-based) on the protein, family by family. The
        on-device WebAssembly engine reproduces native HMMER to the residue.
      </p>
    </figure>
  );
}
