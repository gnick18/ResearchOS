// sequence Phase 2d bot — RESTRICTION-ENZYME metadata + digest + filter logic.
//
// This is the pure, unit-tested half of the enzyme picker. It REUSES the
// vendored SeqViz dataset (`vendor/seqviz/enzymes.ts`, ~236 NEB enzymes) and the
// vendored `digest()` cut computation rather than reimplementing any enzyme
// data or cut-site search. Everything here is derived from that data:
//
//   - per-enzyme metadata (recognition length, palindromic, degenerate, overhang
//     type) computed from `rseq` / `fcut` / `rcut`,
//   - the cut-count per enzyme (whole-sequence OR restricted to a selection),
//   - the SnapGene-style filters (hide noncutters, unique / N-cutter, recognition
//     length, palindromic, overhang), and
//   - the built-in computed presets (All / Unique cutters / 6+ cutters / Common).
//
// SCOPE GUARD: nothing here persists to disk. The active enzyme selection lives
// in the in-session view-state only; persistent user-named saved sets are an
// explicit follow-up.

import presetEnzymes from "@/vendor/seqviz/enzymes";
import digest from "@/vendor/seqviz/digest";
import { reverseComplement } from "@/vendor/seqviz/sequence";
import type { Enzyme, CutSite, SeqType } from "@/vendor/seqviz/elements";
import { COMMON_ENZYMES } from "@/components/sequences/sequence-view-state";

/** The bundled enzyme map, keyed by lowercase name (the SeqViz convention). */
export const ALL_ENZYMES: { [key: string]: Enzyme } = presetEnzymes;

/** Overhang produced by a cut, derived from the relative fcut / rcut offsets. */
export type Overhang = "blunt" | "5'" | "3'";

/** Static, sequence-independent metadata about an enzyme. */
export interface EnzymeInfo {
  /** lowercase key into ALL_ENZYMES (and what the digest accepts as a string). */
  key: string;
  /** display name, e.g. "EcoRI". */
  name: string;
  /** recognition sequence (may contain IUPAC degenerate codes). */
  rseq: string;
  /** number of bases in the recognition sequence. */
  recognitionLength: number;
  /** the recognition site reads the same on its reverse complement. */
  palindromic: boolean;
  /** the recognition sequence contains a degenerate (non-ACGT) IUPAC code. */
  degenerate: boolean;
  /** the overhang the cut leaves: blunt, 5' or 3' sticky. */
  overhang: Overhang;
}

const ACGT = new Set(["a", "c", "g", "t", "u"]);

/** Compute the static metadata for a single enzyme definition. */
export function enzymeInfo(key: string, enzyme: Enzyme): EnzymeInfo {
  const rseq = enzyme.rseq || "";
  const lower = rseq.toLowerCase();
  // Some entries use lowercase methylation flags (e.g. "hmC"); strip non-letters
  // for the degenerate check but keep length as authored.
  const degenerate = lower
    .replace(/[^a-z]/g, "")
    .split("")
    .some((b) => !ACGT.has(b));
  // fcut === rcut => the top and bottom strand cut at the same column => blunt.
  // fcut < rcut => the top strand cuts first (5' recessed) => 5' overhang.
  // fcut > rcut => 3' overhang.
  let overhang: Overhang = "blunt";
  if (enzyme.fcut < enzyme.rcut) overhang = "5'";
  else if (enzyme.fcut > enzyme.rcut) overhang = "3'";

  let palindromic = false;
  try {
    palindromic = lower === reverseComplement(lower, "dna");
  } catch {
    palindromic = false;
  }

  return {
    key,
    name: enzyme.name || key,
    rseq,
    recognitionLength: rseq.length,
    palindromic,
    degenerate,
    overhang,
  };
}

/** Metadata for every bundled enzyme, sorted by display name. */
export function allEnzymeInfos(): EnzymeInfo[] {
  return Object.entries(ALL_ENZYMES)
    .map(([key, enzyme]) => enzymeInfo(key, enzyme))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A restriction range to scope the digest to (e.g. a selection). End-exclusive
 *  is fine — the vendored digest filters cut-sites by `start >= start && end <=
 *  end`, so we hand the raw selection bounds through. */
export interface DigestRange {
  start: number;
  end: number;
}

/** A cut produced by an enzyme: position + enzyme + strand, plus the enzyme key. */
export interface EnzymeCut {
  key: string;
  name: string;
  /** the forward-strand cut index (0-based). */
  position: number;
  /** 1 = top strand, -1 = bottom strand. */
  direction: 1 | -1;
}

/** Per-enzyme digest result: the enzyme + every place it cuts (scoped). */
export interface EnzymeDigest {
  info: EnzymeInfo;
  cuts: EnzymeCut[];
  /** total number of cuts (== cuts.length); the "N-cutter" count. */
  cutCount: number;
}

/**
 * Run the vendored digest for a set of enzyme keys against a sequence, OPTIONALLY
 * restricted to a selection range. Returns a per-enzyme breakdown including the
 * cut count (used by the unique / N-cutter filters) and each cut position.
 *
 * REUSE: this delegates to the vendored `digest()` for the actual cut search,
 * by attaching a `range` to each enzyme when a selection scope is requested
 * (the vendored findCutSites already honors `enzyme.range`). We never duplicate
 * the recognition-site regex logic.
 */
export function digestEnzymes(
  seq: string,
  seqType: SeqType,
  keys: string[],
  range?: DigestRange | null,
): EnzymeDigest[] {
  const out: EnzymeDigest[] = [];
  for (const key of keys) {
    const base = ALL_ENZYMES[key.toLowerCase()];
    if (!base) continue;
    const info = enzymeInfo(key.toLowerCase(), base);
    // Scope to the selection by handing the vendored digest a ranged copy of the
    // enzyme. Normalize the range so start <= end.
    const enzymeForDigest: Enzyme =
      range && range.end > range.start
        ? { ...base, range: { start: range.start, end: range.end } }
        : base;
    const cutSites: CutSite[] = digest(seq, seqType, [enzymeForDigest]);
    const cuts: EnzymeCut[] = cutSites.map((c) => ({
      key: info.key,
      name: info.name,
      position: c.fcut,
      direction: c.direction,
    }));
    out.push({ info, cuts, cutCount: cuts.length });
  }
  return out;
}

/** Fragment sizes (bp) that result from cutting a sequence at the given sorted
 *  unique cut positions. For a circular molecule the fragments wrap; for linear
 *  the ends are open. Returns sizes sorted descending (SnapGene convention). */
export function fragmentSizes(
  cutPositions: number[],
  seqLength: number,
  circular: boolean,
): number[] {
  const positions = Array.from(new Set(cutPositions)).sort((a, b) => a - b);
  if (positions.length === 0) return seqLength > 0 ? [seqLength] : [];
  const sizes: number[] = [];
  if (circular) {
    for (let i = 0; i < positions.length; i++) {
      const next = positions[(i + 1) % positions.length];
      const here = positions[i];
      const size = i === positions.length - 1 ? seqLength - here + next : next - here;
      sizes.push(size);
    }
  } else {
    sizes.push(positions[0]); // 0 .. first cut
    for (let i = 1; i < positions.length; i++) sizes.push(positions[i] - positions[i - 1]);
    sizes.push(seqLength - positions[positions.length - 1]); // last cut .. end
  }
  return sizes.filter((s) => s > 0).sort((a, b) => b - a);
}

// ── FILTERS ───────────────────────────────────────────────────────────────────

/** The cut-count category filter, mirroring SnapGene's enzyme chooser. */
export type CutCountFilter = "any" | "noncutters" | "unique" | "n-cutters";

/** The full filter state for the picker. All default to the most permissive. */
export interface EnzymeFilterState {
  /** free-text name search (case-insensitive substring). */
  search: string;
  /** hide enzymes that never cut the sequence. */
  hideNoncutters: boolean;
  /** cut-count category. */
  cutCount: CutCountFilter;
  /** for the "n-cutters" category, the exact cut count required. */
  nCuts: number;
  /** minimum recognition-sequence length (0 = no minimum). */
  minRecognitionLength: number;
  /** restrict to palindromic recognition sites only. */
  palindromicOnly: boolean;
  /** restrict to non-degenerate (exact ACGT) recognition sites only. */
  nondegenerateOnly: boolean;
  /** restrict to a single overhang type ("any" = no restriction). */
  overhang: Overhang | "any";
}

export const DEFAULT_FILTER_STATE: EnzymeFilterState = {
  search: "",
  hideNoncutters: true,
  cutCount: "any",
  nCuts: 1,
  minRecognitionLength: 0,
  palindromicOnly: false,
  nondegenerateOnly: false,
  overhang: "any",
};

/** Does one enzyme's digest pass the filter? Pure predicate over the digest +
 *  the enzyme metadata, so the same logic drives both the picker list and the
 *  computed presets. */
export function passesFilter(d: EnzymeDigest, f: EnzymeFilterState): boolean {
  const { info, cutCount } = d;

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!info.name.toLowerCase().includes(q)) return false;
  }
  if (f.hideNoncutters && cutCount === 0) return false;

  switch (f.cutCount) {
    case "noncutters":
      if (cutCount !== 0) return false;
      break;
    case "unique":
      if (cutCount !== 1) return false;
      break;
    case "n-cutters":
      if (cutCount !== f.nCuts) return false;
      break;
    case "any":
    default:
      break;
  }

  if (info.recognitionLength < f.minRecognitionLength) return false;
  if (f.palindromicOnly && !info.palindromic) return false;
  if (f.nondegenerateOnly && info.degenerate) return false;
  if (f.overhang !== "any" && info.overhang !== f.overhang) return false;

  return true;
}

/** Apply a filter to a full digest list, returning the matching digests sorted
 *  by display name. */
export function filterDigests(digests: EnzymeDigest[], f: EnzymeFilterState): EnzymeDigest[] {
  return digests
    .filter((d) => passesFilter(d, f))
    .sort((a, b) => a.info.name.localeCompare(b.info.name));
}

// ── COMPUTED PRESETS ────────────────────────────────────────────────────────

/** A built-in, COMPUTED enzyme set. `select` derives the active keys from the
 *  full per-enzyme digest of the current sequence (so "Unique cutters" really
 *  means "cuts this sequence exactly once"). Nothing is persisted. */
export interface EnzymePreset {
  id: string;
  label: string;
  description: string;
  select: (digests: EnzymeDigest[]) => string[];
}

/** Keys whose digest cuts the sequence at least once. */
const cutters = (digests: EnzymeDigest[]) => digests.filter((d) => d.cutCount > 0);

export const ENZYME_PRESETS: EnzymePreset[] = [
  {
    id: "common",
    label: "Common",
    description: "A small set of the everyday workhorse enzymes (EcoRI, BamHI, HindIII …).",
    // The common set is name-based, but we still intersect with cutters so the
    // map only shows enzymes that actually cut this molecule.
    select: (digests) => {
      const common = new Set(COMMON_ENZYMES);
      return digests.filter((d) => common.has(d.info.key) && d.cutCount > 0).map((d) => d.info.key);
    },
  },
  {
    id: "unique",
    label: "Unique cutters",
    description: "Enzymes that cut this sequence exactly once.",
    select: (digests) => digests.filter((d) => d.cutCount === 1).map((d) => d.info.key),
  },
  {
    id: "sixplus",
    label: "6+ recognition",
    description: "Cutters with a recognition site of 6 or more bases (rarer, cleaner cuts).",
    select: (digests) =>
      cutters(digests)
        .filter((d) => d.info.recognitionLength >= 6)
        .map((d) => d.info.key),
  },
  {
    id: "all",
    label: "All cutters",
    description: "Every bundled enzyme that cuts this sequence at least once.",
    select: (digests) => cutters(digests).map((d) => d.info.key),
  },
];
