/**
 * Restriction-digest showcase cases for the transparency page.
 *
 * Each case is one (sequence, enzyme) digest. The comparison is the full
 * fragment-size pattern (sorted descending, SnapGene convention) against
 * Biopython's Bio.Restriction over the same sequence and topology. A digest is
 * "right" only if every band matches, so the delta we report is the number of
 * mismatched bands and the passing value is zero.
 *
 * Sequences, enzymes, and expected fragment lengths are lifted verbatim from the
 * committed golden suite (`lib/sequences/digest.golden.test.ts`), which derives
 * them from `frontend/scripts/gen-digest-golden.py` run against Biopython.
 *
 * The selection deliberately spans the cases where a digest engine is easy to get
 * wrong: a multi-cutter, an IUPAC-degenerate recognition site, a non-palindromic
 * site that only appears on the minus strand, a blunt cutter, and a circular
 * plasmid with a site that spans the origin.
 */

export interface DigestCase {
  id: string;
  label: string;
  seq: string;
  circular: boolean;
  /** Lowercase digest key passed to digestEnzymes. */
  enzymeKey: string;
  /** Display name for the enzyme. */
  enzymeName: string;
  /** Biopython fragment lengths, sorted descending. */
  bioFragments: number[];
}

export const DIGEST_CASES: DigestCase[] = [
  {
    id: "ecori_multi",
    label: "EcoRI, three sites in a linear fragment",
    seq: "GGCCGAATTCGCGCGGATCCGCGCGAATTCGCGCGATATCGCGCGAATTCGGCC",
    circular: false,
    enzymeKey: "ecori",
    enzymeName: "EcoRI",
    bioFragments: [20, 20, 9, 5],
  },
  {
    id: "hinfi_degen",
    label: "HinfI (G^ANTC), IUPAC-degenerate recognition",
    seq: "GCGCGAATCGCGCGACTCGCGCGAGTCGCGC",
    circular: false,
    enzymeKey: "hinfi",
    enzymeName: "HinfI",
    bioFragments: [9, 9, 8, 5],
  },
  {
    id: "hinfi_minus",
    label: "HinfI, non-palindromic site on the minus strand",
    seq: "GCGCGAATCGCGCGCGATTCGCGC",
    circular: false,
    enzymeKey: "hinfi",
    enzymeName: "HinfI",
    bioFragments: [11, 8, 5],
  },
  {
    id: "smai_blunt",
    label: "SmaI, blunt cutter",
    seq: "GCGCGAATTCGCGCCTGCAGGCGCGGTACCGCGCCCCGGGGCGC",
    circular: false,
    enzymeKey: "smai",
    enzymeName: "SmaI",
    bioFragments: [37, 7],
  },
  {
    id: "ecori_circular",
    label: "EcoRI on a circular plasmid, origin-spanning site",
    seq: "AATTCGCGCGCGAATTCGCGCGGATCCGCGCG",
    circular: true,
    enzymeKey: "ecori",
    enzymeName: "EcoRI",
    bioFragments: [20, 12],
  },
];
