/**
 * Codon-to-amino-acid track for a translation case: each in-frame codon with the
 * ResearchOS residue beneath it, and the Biopython residue below that. When the
 * two residue rows are identical the translation matches; any disagreement is
 * tinted red. Stops (*) and ambiguous residues (X) read in place. Monospace.
 */

const AA_FULL: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", E: "Glu", Q: "Gln",
  G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe",
  P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val", "*": "Stop",
  X: "Any",
};

export default function CodonTrack({
  codons,
  ours,
  theirs,
}: {
  codons: string[];
  ours: string;
  theirs: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-meta font-semibold uppercase tracking-wide text-gray-500">
        Codon to amino acid
      </div>
      <div className="overflow-x-auto px-4 py-3">
        <div className="inline-flex gap-1.5">
          {codons.map((codon, i) => {
            const o = ours[i] ?? "";
            const t = theirs[i] ?? "";
            const mismatch = o !== t;
            return (
              <div key={`${codon}-${i}`} className="text-center" title={AA_FULL[o] ?? ""}>
                <div className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-gray-700">{codon}</div>
                <div className={`mt-1 font-mono text-[14px] font-bold ${mismatch ? "text-red-600" : "text-emerald-700"}`}>{o || "-"}</div>
                <div className={`font-mono text-[12px] ${mismatch ? "text-red-500" : "text-gray-400"}`}>{t || "-"}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 text-meta text-gray-400">
          <span>top row: ResearchOS</span>
          <span>bottom row: Biopython</span>
        </div>
      </div>
    </figure>
  );
}
