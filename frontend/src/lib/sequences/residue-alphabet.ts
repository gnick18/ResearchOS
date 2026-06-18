// Canonical residue alphabets for the sequence editor. These are the ONLY
// characters allowed to enter a sequence on type or paste; anything else (X for
// DNA, digits, punctuation, FASTA headers, whitespace) is dropped before it can
// reach the model. Keeping the alphabet here, with a single sanitizer, means the
// keydown path, the paste path, and the new-sequence dialog all agree on what a
// valid base is.
//
// Alphabets follow IUPAC. We deliberately keep the degenerate / ambiguity codes
// (N, R, Y, ...) because a real cloning workflow uses them; a naive "ACGT only"
// filter would wrongly reject legitimate sequence.

import type { SeqType } from "../types";

// DNA: the four bases, the 11 IUPAC nucleotide ambiguity codes, and the gap.
const DNA_ALPHABET = "ACGTRYSWKMBDHVN-";
// RNA: identical to DNA but U replaces T.
const RNA_ALPHABET = "ACGURYSWKMBDHVN-";
// Protein: the 20 standard amino acids, the ambiguity codes B (Asx) and Z (Glx),
// X (any), U (selenocysteine), O (pyrrolysine), and the stop codon "*".
const PROTEIN_ALPHABET = "ACDEFGHIKLMNPQRSTVWYBZXUO*";

/**
 * The uppercase set of characters that may appear in a sequence of the given
 * type. Membership test is case-insensitive (callers uppercase first).
 */
export function residueAlphabet(seqType: SeqType): string {
  switch (seqType) {
    case "rna":
      return RNA_ALPHABET;
    case "protein":
      return PROTEIN_ALPHABET;
    case "dna":
    default:
      return DNA_ALPHABET;
  }
}

// Precomputed lookup sets so the per-character test in sanitizeResidues is O(1)
// regardless of sequence length.
const ALPHABET_SETS: Record<SeqType, Set<string>> = {
  dna: new Set(DNA_ALPHABET),
  rna: new Set(RNA_ALPHABET),
  protein: new Set(PROTEIN_ALPHABET),
};

/** True when `ch` (a single character) is a valid residue for `seqType`. */
export function isValidResidue(ch: string, seqType: SeqType): boolean {
  return ALPHABET_SETS[seqType]?.has(ch.toUpperCase()) ?? false;
}

/**
 * Filter arbitrary typed or pasted text down to the valid residues for the
 * molecule type, normalized to the editor's uppercase convention. Invalid
 * characters (including whitespace, digits, and FASTA punctuation) are dropped
 * silently. If nothing valid remains the result is "" and the caller should
 * treat the edit as a no-op.
 */
export function sanitizeResidues(text: string, seqType: SeqType): string {
  const set = ALPHABET_SETS[seqType] ?? ALPHABET_SETS.dna;
  let out = "";
  for (const ch of text.toUpperCase()) {
    if (set.has(ch)) out += ch;
  }
  return out;
}
