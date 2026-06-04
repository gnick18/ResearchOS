// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import { resolveCodon, GAP_GLYPH } from "../../lib/sequences/degenerate-codon";

import { NameRange, SeqType } from "./elements";

/**
 * Map of nucleotide bases
 */
export const nucleotides = { a: "a", c: "c", g: "g", t: "t", u: "u" };

/**
 * Map of DNA basepairs to all the bases encoded by that character in the DNA alphabet.
 *
 * https://meme-suite.org/meme/doc/alphabets.html
 */
const dnaAlphabet = {
  // ".": { a: "a", c: "c", g: "g", t: "t" },
  b: { c: "c", g: "g", t: "t" },
  d: { a: "a", g: "g", t: "t" },
  h: { a: "a", c: "c", t: "t" },
  k: { g: "g", t: "t" },
  m: { a: "a", c: "c" },
  n: { a: "a", c: "c", g: "g", t: "t" },
  r: { a: "a", g: "g" },
  s: { c: "c", g: "g" },
  v: { a: "a", c: "c", g: "g" },
  w: { a: "a", t: "t" },
  x: { a: "a", c: "c", g: "g", t: "t" },
  y: { c: "c", t: "t" },
};

/**
 * Map of RNA basepairs to all the bases encoded by that character in the RNA alphabet.
 *
 * https://meme-suite.org/meme/doc/alphabets.html
 */
const rnaAlphabet = {
  // ".": { c: "c", g: "g", u: "u" },
  b: { c: "c", g: "g", u: "u" },
  d: { a: "a", g: "g", u: "u" },
  h: { a: "a", c: "c", u: "u" },
  k: { g: "g", u: "u" },
  m: { a: "a", c: "c" },
  n: { a: "a", c: "c", g: "g", u: "u" },
  r: { a: "a", g: "g" },
  s: { c: "c", g: "g" },
  v: { a: "a", c: "c", g: "g" },
  w: { a: "a", u: "u" },
  x: { a: "a", c: "c", g: "g", u: "u" },
  y: { c: "c", u: "u" },
};

/**
 * mapping the 64 standard codons to amino acids
 *
 * adapted from: "https://github.com/keithwhor/NtSeq/blob/master/lib/nt.js
 */
const dnaCodonToAminoAcid = {
  AAA: "K",
  AAC: "N",
  AAG: "K",
  AAT: "N",
  ACA: "T",
  ACC: "T",
  ACG: "T",
  ACT: "T",
  AGA: "R",
  AGC: "S",
  AGG: "R",
  AGT: "S",
  ATA: "I",
  ATC: "I",
  ATG: "M",
  ATT: "I",
  CAA: "Q",
  CAC: "H",
  CAG: "Q",
  CAT: "H",
  CCA: "P",
  CCC: "P",
  CCG: "P",
  CCT: "P",
  CGA: "R",
  CGC: "R",
  CGG: "R",
  CGT: "R",
  CTA: "L",
  CTC: "L",
  CTG: "L",
  CTT: "L",
  GAA: "E",
  GAC: "D",
  GAG: "E",
  GAT: "D",
  GCA: "A",
  GCC: "A",
  GCG: "A",
  GCT: "A",
  GGA: "G",
  GGC: "G",
  GGG: "G",
  GGT: "G",
  GTA: "V",
  GTC: "V",
  GTG: "V",
  GTT: "V",
  TAA: "*",
  TAC: "Y",
  TAG: "*",
  TAT: "Y",
  TCA: "S",
  TCC: "S",
  TCG: "S",
  TCT: "S",
  TGA: "*",
  TGC: "C",
  TGG: "W",
  TGT: "C",
  TTA: "L",
  TTC: "F",
  TTG: "L",
  TTT: "F",
};

const aminoAcids = Array.from(new Set(Object.values(dnaCodonToAminoAcid)).values()).join("");
const aminoAcidsMap = aminoAcids
  .toLowerCase()
  .split("")
  .filter(aa => aa !== "*") // TODO
  .reduce((acc, aa) => ({ ...acc, [aa]: aa }), {});

/**
 * Map of amino acids alphabet characters to what each matches.
 *
 * https://meme-suite.org/meme/doc/alphabets.html
 */
const aaAlphabet = {
  b: { d: "d", n: "n" },
  j: { i: "i", l: "l" },
  x: aminoAcidsMap,
  z: { e: "e", q: "q" },
};

/** Given a seq type, return the associated symbol alphabet */
export const getAlphabet = (seqType: SeqType) => {
  return {
    aa: aaAlphabet,
    dna: dnaAlphabet,
    rna: rnaAlphabet,
    unknown: dnaAlphabet,
  }[seqType];
};

const aminoAcidRegex = new RegExp(`^[${aminoAcids}BJXZ]+$`, "i");

/**
 * Infer the type of a sequence. This is *without* any ambiguous symbols, so maybe wrong by being overly strict.
 */
export const guessType = (seq: string): SeqType => {
  seq = seq.substring(0, 1000);
  if (/^[atgcn.]+$/i.test(seq)) {
    return "dna";
  } else if (/^[augcn.]+$/i.test(seq)) {
    return "rna";
  } else if (aminoAcidRegex.test(seq)) {
    return "aa";
  }
  return "unknown";
};

/**
 * Reverses a string sequence
 */
export const reverse = (seq: string): string => seq.split("").reverse().join("");

// from http://arep.med.harvard.edu/labgc/adnan/projects/Utilities/revcomp.html
let dnaComp = {
  a: "t",
  b: "v",
  c: "g",
  d: "h",
  g: "c",
  h: "d",
  k: "m",
  m: "k",
  n: "n",
  r: "y",
  s: "s",
  t: "a",
  u: "a",
  v: "b",
  w: "w",
  x: "x",
  y: "r",
};
dnaComp = {
  ...dnaComp,
  ...Object.keys(dnaComp).reduce((acc, k) => ({ ...acc, [k.toUpperCase()]: dnaComp[k].toUpperCase() }), {}),
};

/**
 * A map from each basepair to its complement
 */
const typeToCompMap = {
  aa: Object.keys(aminoAcidsMap).reduce((acc, k) => ({ ...acc, [k.toUpperCase()]: "", [k.toLowerCase()]: "" }), {
    B: "",
    J: "",
    Z: "",
    b: "",
    j: "",
    z: "",
  }),
  dna: dnaComp,
  rna: { ...dnaComp, A: "U", a: "u" },
  undefined: dnaComp,
};

/**
 * Return the filtered sequence and its complement if its an empty string, return the same for both.
 */
export const complement = (origSeq: string, seqType: SeqType): { compSeq: string; seq: string } => {
  if (!origSeq) {
    return { compSeq: "", seq: "" };
  }
  const compMap = typeToCompMap[seqType];

  // filter out unrecognized base pairs and build up the complement
  let seq = "";
  let compSeq = "";
  for (let i = 0, origLength = origSeq.length; i < origLength; i += 1) {
    if (origSeq[i] in compMap) {
      seq += origSeq[i];
      compSeq += compMap[origSeq[i]];
    }
  }
  return { compSeq, seq };
};

/**
 * Return the reverse complement of a DNA sequence
 */
export const reverseComplement = (inputSeq: string, seqType: SeqType): string => {
  const { compSeq } = complement(inputSeq, seqType);
  return compSeq.split("").reverse().join("");
};

const fwd = new Set(["FWD", "fwd", "FORWARD", "forward", "FOR", "for", "TOP", "top", "1", 1]);
const rev = new Set(["REV", "rev", "REVERSE", "reverse", "BOTTOM", "bottom", "-1", -1]);

/**
 * Parse the user defined direction, estimate the direction of the element
 *
 * ```js
 * directionality("FWD") => 1
 * directionality("FORWARD") => 1
 * ```
 */
export const directionality = (direction: number | string | undefined): -1 | 0 | 1 => {
  if (!direction) {
    return 0;
  }
  if (fwd.has(direction)) {
    return 1;
  }
  if (rev.has(direction)) {
    return -1;
  }
  return 0;
};

/**
 * Given a sequence, translate it into an Amino Acid sequence
 */
export const translate = (seqInput: string, seqType: SeqType): string => {
  if (seqType === "aa") {
    return seqInput;
  }

  // Resolution always runs against the DNA 64-codon table; an RNA codon is
  // normalized U->T per position so RNA and DNA share one resolver and stay
  // consistent (the RNA table is the DNA table with T->U keys, same residues).
  const seq = seqInput.toUpperCase();
  const seqLength = seq.length;
  let aaSeq = "";
  for (let i = 0, j = 0; i < seqLength; i += 3, j += 1) {
    if (i + 2 < seqLength) {
      const codon = (seq[i] + seq[i + 1] + seq[i + 2]).replace(/U/g, "T");
      // resolveCodon: exact codon -> its residue; unambiguous degenerate codon
      // -> the resolved residue (GGN->G); disagreement / off-alphabet -> "X".
      aaSeq += resolveCodon(codon, dnaCodonToAminoAcid) || GAP_GLYPH;
    }
  }
  return aaSeq;
};

/**
 * seq introns bot — clip an absolute [start, end) span to a SeqBlock's visible
 * window [firstBase, lastBase). Returns null when the span does not intersect
 * this block (so a feature pushed onto an intron-only block draws nothing).
 * Pure + exported for unit testing the per-block segment geometry.
 */
export const clipSegmentToBlock = (
  segStart: number,
  segEnd: number,
  firstBase: number,
  lastBase: number,
): { start: number; end: number } | null => {
  const start = Math.max(Math.min(segStart, segEnd), firstBase);
  const end = Math.min(Math.max(segStart, segEnd), lastBase);
  if (end <= start) return null;
  return { start, end };
};

/**
 * seq introns bot — SPLICED translation for multi-exon (join) CDS features.
 *
 * Given exon `segments` (absolute coords, same space as start/end; `end` is the
 * exclusive boundary, matching how SeqViz's findXAndWidth + the raw-span path
 * treat translation ends), concatenate the exon bases in left-to-right order,
 * reverse-complement for a reverse-strand feature, and translate the spliced
 * mRNA so the protein is correct (introns are NOT translated).
 *
 * Returns the amino-acid string plus `aaToBp`: the absolute bp START of each
 * codon, so the renderer can place each AA glyph over its exon position and
 * leave a dashed gap over the introns. For reverse-strand features the bp map
 * is in protein order (N->C), i.e. decreasing genomic coordinate.
 *
 * Pure + exported for unit testing.
 */
export const spliceTranslation = (
  segments: { start: number; end: number }[],
  seq: string,
  seqType: SeqType,
  direction: -1 | 1,
): { AAseq: string; aaToBp: number[] } => {
  // Sort exons by genomic position and collect the spliced base list along with
  // each base's absolute genomic index, so codon->bp placement survives splicing.
  const exons = [...segments]
    .map(s => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }))
    .sort((a, b) => a.start - b.start);

  let splicedBases = "";
  const baseToBp: number[] = []; // genomic index of each spliced base
  for (const ex of exons) {
    for (let p = ex.start; p < ex.end; p += 1) {
      if (p < 0 || p >= seq.length) continue;
      splicedBases += seq[p];
      baseToBp.push(p);
    }
  }

  // Reverse-strand: translate the reverse complement, reading 3'->5' of the
  // spliced mRNA. Reverse the bp map in lockstep so codon i still maps to the
  // genomic base it is drawn over.
  let codingBases = splicedBases;
  let codingBaseToBp = baseToBp;
  if (direction === -1) {
    codingBases = reverseComplement(splicedBases, seqType);
    codingBaseToBp = [...baseToBp].reverse();
  }

  const AAseq = translate(codingBases, seqType);
  const bpPerBlock = seqType === "aa" ? 1 : 3;
  const aaToBp: number[] = [];
  for (let i = 0; i < AAseq.length; i += 1) {
    // The genomic bp where this codon's FIRST coding base sits.
    aaToBp.push(codingBaseToBp[i * bpPerBlock]);
  }
  return { AAseq, aaToBp };
};

/**
 * for each translation (range + direction) and the input sequence, convert it to a translation and amino acid sequence
 */
export const createTranslations = (translations: NameRange[], seq: string, seqType: SeqType) => {
  // elongate the original sequence to account for translations that cross the zero index
  const seqDoubled = seq + seq;
  const bpPerBlock = seqType === "aa" ? 1 : 3;

  return translations.map(t => {
    const { direction, start } = t;
    let { end } = t;
    if (start > end) end += seq.length;

    // seq introns bot — SPLICED path: a multi-exon (join) CDS translates the
    // concatenated exon bases, not the raw start..end span (which would read
    // through the introns and yield the wrong protein). Single-segment / no
    // segments fall through to the original span-based code below, unchanged.
    const segs = (t as { segments?: { start: number; end: number }[] }).segments;
    if (segs && segs.length > 1) {
      const dir: -1 | 1 = direction === -1 ? -1 : 1;
      const { AAseq, aaToBp } = spliceTranslation(segs, seq, seqType, dir);
      const sortedStarts = segs.map(s => Math.min(s.start, s.end)).sort((a, b) => a - b);
      const sortedEnds = segs.map(s => Math.max(s.start, s.end)).sort((a, b) => a - b);
      return {
        ...t,
        AAseq,
        aaToBp,
        // overall bounding span across all exons (introns included) so the row
        // height + handle span match the annotation; the AA glyphs are placed
        // per-codon via aaToBp and skip the introns.
        start: sortedStarts[0],
        end: sortedEnds[sortedEnds.length - 1],
      };
    }

    // TODO: below will fail on an "aa" type sequence if direction = -1. At the time of writing, this won't be reached, anyway

    // get the subsequence
    const subSeq =
      direction === 1 ? seqDoubled.substring(start, end) : reverseComplement(seqDoubled.substring(start, end), seqType);

    // translate the subsequence
    const aaSeq =
      direction === 1 ? translate(subSeq, seqType) : translate(subSeq, seqType).split("").reverse().join(""); // translate

    // the starting point for the translation, reading left to right (regardless of translation
    // direction). this is later needed to calculate the number of bps needed in the first
    // and last codons
    const tStart = direction === 1 ? start : end - aaSeq.length * bpPerBlock;
    let tEnd = direction === 1 ? (start + aaSeq.length * bpPerBlock) % seq.length : end % seq.length;

    // treating one particular edge case where the start at zero doesn't make sense
    if (tEnd === 0) {
      tEnd += seq.length;
    }

    return {
      ...t,
      AAseq: aaSeq,
      end: tEnd,
      start: tStart,
    };
  });
};

/**
 * Create a random 10 digit string ID
 *
 * Lazily copied from StackOverflow: https://stackoverflow.com/a/57355127
 */
export const randomID = (n = 10) => {
  const add = 1;
  let max = 12 - add;
  max = Math.pow(10, n + add);
  const min = max / 10; // Math.pow(10, n) basically
  const number = Math.floor(Math.random() * (max - min + 1)) + min;
  return String(number).substring(add);
};
