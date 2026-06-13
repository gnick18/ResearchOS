// Phylo Tree Studio, the multiple-sequence-alignment track (phylo Phase 3).
//
// The msaplot geom: a user brings an aligned FASTA (the same way they bring a
// metadata CSV), we join its sequences to the tree tips by label (the exact ->
// normalized -> token matcher the metadata join already uses, via
// matchAlignmentToTips below which mirrors matchMetadataToTips), and the renderer
// draws the alignment as a residue matrix aligned tip-for-tip against the shared
// TipAxis (a column block in rectangular, an outer ring band in circular).
//
// This module is PURE DATA: it parses the alignment, auto-detects nucleotide vs
// amino-acid, exposes the residue color palettes, and bins a wide alignment down
// to a sane render width so a 7.9kb / 20kb alignment still draws (the binning is
// surfaced, never silently dropped). The SVG comes from panel-render.ts.
//
// We DO NOT reuse the sequences-lib FASTA parser (lib/sequences/import.ts ->
// fastaToJson): that parser is built to sanitize a sequence into a stored GenBank
// record and strips gaps / non-base characters, which would destroy the column
// alignment an MSA depends on. An aligned FASTA needs gaps and exact column
// positions preserved, so a tiny gap-preserving local parser is the right tool
// (the spec's "else a small local parser" branch). Cross-lane: no sequences-lib
// import, read-only Data Hub palettes are NOT needed (residues use a fixed
// publication-standard key, the Clustal / Zappo convention researchers expect).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { matchMetadataToTips } from "./layout";
import { leaves, type TreeNode } from "./parse";

/** One parsed alignment record: a tip label + its gap-preserving residue string. */
export interface AlignmentRecord {
  /** The FASTA header (first whitespace token), the join key to a tree tip. */
  label: string;
  /** The aligned residues, gaps included, uppercased, exactly as columns. */
  residues: string;
}

/** A parsed multiple sequence alignment. */
export interface Alignment {
  records: AlignmentRecord[];
  /** Column count (the max record length, ragged rows are right-padded with gaps). */
  columns: number;
  /** Detected residue alphabet, decides the color palette. */
  kind: AlignmentKind;
}

/** The residue alphabet of an alignment. */
export type AlignmentKind = "nucleotide" | "amino-acid";

/** A gap character in an alignment (any of these reads as a gap cell). */
const GAP_CHARS = new Set(["-", ".", "~", " ", "*"]);

/** True when a residue character is a gap. */
export function isGap(ch: string): boolean {
  return GAP_CHARS.has(ch);
}

/**
 * Parse an aligned FASTA string into records, preserving gaps and column
 * positions (the whole point of an alignment). Multi-line sequence blocks are
 * concatenated; the header's first whitespace-delimited token is the join label
 * (so "FJ385264 some description" keys on "FJ385264"). Ragged records (rare, but
 * a hand-edited file can have them) are right-padded with gaps to the longest
 * length so the matrix is rectangular. Empty input yields an empty alignment.
 */
export function parseAlignment(text: string): Alignment {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const records: AlignmentRecord[] = [];
  let curLabel: string | null = null;
  let curParts: string[] = [];
  const flush = () => {
    if (curLabel !== null) {
      records.push({
        label: curLabel,
        residues: curParts.join("").toUpperCase(),
      });
    }
    curLabel = null;
    curParts = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith(">")) {
      flush();
      // The header label is the first whitespace token after ">".
      curLabel = line.slice(1).trim().split(/\s+/)[0] ?? "";
    } else if (curLabel !== null && line.trim() !== "") {
      // Keep every non-whitespace character (residues + gaps); strip only spaces
      // and tabs interior to a wrapped block (some tools pad blocks).
      curParts.push(line.replace(/[ \t]+/g, ""));
    }
  }
  flush();

  const columns = records.reduce((m, r) => Math.max(m, r.residues.length), 0);
  // Right-pad ragged rows with gaps so the matrix is rectangular.
  for (const r of records) {
    if (r.residues.length < columns) {
      r.residues = r.residues + "-".repeat(columns - r.residues.length);
    }
  }
  return { records, columns, kind: detectKind(records) };
}

/**
 * Decide nucleotide vs amino-acid from the residue makeup. We sample the
 * non-gap characters and call it nucleotide when nearly all of them are in the
 * extended nucleotide alphabet (ACGTUN + IUPAC ambiguity codes), else amino-acid.
 * The threshold tolerates a few stray ambiguity letters without misreading a
 * protein alignment (which is rich in non-ACGT letters) as DNA.
 */
export function detectKind(records: AlignmentRecord[]): AlignmentKind {
  let nt = 0;
  let total = 0;
  for (const r of records) {
    for (const ch of r.residues) {
      if (isGap(ch)) continue;
      total++;
      if (NUCLEOTIDE_ALPHABET.has(ch)) nt++;
      if (total >= 4000) break; // a sample is plenty to classify
    }
    if (total >= 4000) break;
  }
  if (total === 0) return "nucleotide";
  return nt / total >= 0.9 ? "nucleotide" : "amino-acid";
}

/** Extended nucleotide alphabet (bases + IUPAC ambiguity), used by detectKind. */
const NUCLEOTIDE_ALPHABET = new Set(
  "ACGTUNRYSWKMBDHV".split(""),
);

// ---------------------------------------------------------------------------
// Residue color palettes. A fixed, publication-standard key (not a Data Hub
// palette): nucleotides follow the common A/C/G/T scheme, amino acids a Zappo /
// Clustal-like grouping by physicochemistry, so the colors read the way a
// researcher coming from Jalview / MEGA / iTOL expects.
// ---------------------------------------------------------------------------

/** The empty / gap cell fill (matches the metadata empty-cell fill). */
export const GAP_FILL = "#f1f5f9";

/** Nucleotide residue -> color (A green, C blue, G amber, T/U red). */
export const NUCLEOTIDE_COLORS: Record<string, string> = {
  A: "#16a34a",
  C: "#1AA0E6",
  G: "#b45309",
  T: "#dc2626",
  U: "#dc2626",
};

/**
 * Amino-acid residue -> color, grouped by physicochemistry (a compact Zappo-like
 * key). Hydrophobic, polar, positive, negative, aromatic, special each share a
 * hue so a reader sees property blocks, the standard MSA reading.
 */
export const AMINO_ACID_COLORS: Record<string, string> = {
  // Hydrophobic / aliphatic.
  A: "#1AA0E6",
  I: "#1AA0E6",
  L: "#1AA0E6",
  M: "#1AA0E6",
  V: "#1AA0E6",
  // Aromatic.
  F: "#7c3aed",
  W: "#7c3aed",
  Y: "#7c3aed",
  // Positive.
  K: "#dc2626",
  R: "#dc2626",
  H: "#dc2626",
  // Negative.
  D: "#b45309",
  E: "#b45309",
  // Polar uncharged.
  S: "#16a34a",
  T: "#16a34a",
  N: "#16a34a",
  Q: "#16a34a",
  // Special.
  C: "#0891b2",
  G: "#94a3b8",
  P: "#94a3b8",
};

/** The labeled swatches a residue legend shows, in reading order, per kind. */
export interface ResidueLegendItem {
  label: string;
  color: string;
}

/** Build the residue legend for an alignment kind (the color key). */
export function residueLegend(kind: AlignmentKind): ResidueLegendItem[] {
  if (kind === "nucleotide") {
    return [
      { label: "A", color: NUCLEOTIDE_COLORS.A },
      { label: "C", color: NUCLEOTIDE_COLORS.C },
      { label: "G", color: NUCLEOTIDE_COLORS.G },
      { label: "T / U", color: NUCLEOTIDE_COLORS.T },
      { label: "gap / other", color: GAP_FILL },
    ];
  }
  // Amino acids: one swatch per physicochemical group (the property key reads
  // better than 20 near-identical rows).
  return [
    { label: "Hydrophobic", color: "#1AA0E6" },
    { label: "Aromatic", color: "#7c3aed" },
    { label: "Positive", color: "#dc2626" },
    { label: "Negative", color: "#b45309" },
    { label: "Polar", color: "#16a34a" },
    { label: "Cys / special", color: "#0891b2" },
    { label: "Gly / Pro", color: "#94a3b8" },
    { label: "gap / other", color: GAP_FILL },
  ];
}

/** The fill for one residue character given the alignment kind. */
export function residueColor(ch: string, kind: AlignmentKind): string {
  if (isGap(ch)) return GAP_FILL;
  const table = kind === "nucleotide" ? NUCLEOTIDE_COLORS : AMINO_ACID_COLORS;
  return table[ch] ?? GAP_FILL;
}

// ---------------------------------------------------------------------------
// Column binning. A wide alignment (thousands of columns) cannot draw one cell
// per column at figure scale, so we bin columns into at most MAX_RENDER_COLUMNS
// blocks and color each block by its most common (consensus) residue per tip.
// Binning is reported (binSize > 1) so the panel can note the downsampling, the
// spec's "do not silently drop" rule.
// ---------------------------------------------------------------------------

/** The most columns we ever draw; a wider alignment is binned down to this. */
export const MAX_RENDER_COLUMNS = 600;

/** A binned alignment ready to render: one consensus residue per tip per block. */
export interface BinnedAlignment {
  kind: AlignmentKind;
  /** Drawn block count (<= MAX_RENDER_COLUMNS). */
  blocks: number;
  /** Source alignment columns per block (1 = no binning, full resolution). */
  binSize: number;
  /** Original column count, for the panel's downsample note. */
  sourceColumns: number;
  /** label -> per-block consensus residue (the block's most common non-gap base,
   *  or a gap when the block is all gaps). */
  rows: Map<string, string>;
}

/**
 * Bin an alignment to at most MAX_RENDER_COLUMNS blocks, one consensus residue
 * per block per record. binSize is the number of source columns each block spans
 * (ceil so the whole alignment is covered); binSize 1 means full resolution. The
 * consensus is the most frequent non-gap residue in the block (ties keep the
 * first seen), or a gap when the block is entirely gaps for that record.
 */
export function binAlignment(aln: Alignment): BinnedAlignment {
  const cols = aln.columns;
  const binSize = cols <= MAX_RENDER_COLUMNS ? 1 : Math.ceil(cols / MAX_RENDER_COLUMNS);
  const blocks = Math.ceil(cols / binSize) || 0;
  const rows = new Map<string, string>();
  for (const rec of aln.records) {
    const out: string[] = [];
    for (let b = 0; b < blocks; b++) {
      const start = b * binSize;
      const end = Math.min(cols, start + binSize);
      out.push(consensusResidue(rec.residues, start, end));
    }
    rows.set(rec.label, out.join(""));
  }
  return {
    kind: aln.kind,
    blocks,
    binSize,
    sourceColumns: cols,
    rows,
  };
}

/** Most-common non-gap residue in residues[start, end); a gap when all gaps. */
function consensusResidue(residues: string, start: number, end: number): string {
  if (end - start === 1) return residues[start] ?? "-";
  const counts = new Map<string, number>();
  let best = "-";
  let bestN = 0;
  for (let i = start; i < end; i++) {
    const ch = residues[i] ?? "-";
    if (isGap(ch)) continue;
    const n = (counts.get(ch) ?? 0) + 1;
    counts.set(ch, n);
    if (n > bestN) {
      bestN = n;
      best = ch;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tip join. Reuses the exact -> normalized -> token matcher the metadata join
// uses (matchMetadataToTips), so an alignment header like "FJ385264" joins a
// composite tip label "SC144|FJ385264" the same way a metadata key would. We
// shape the alignment as one-cell rows ({ label }) and ask the shared matcher,
// then map the matched tip ids back to each tip's binned residue row.
// ---------------------------------------------------------------------------

export interface AlignmentMatch {
  /** tip id -> the tip's per-block residue row (from the binned alignment). */
  matched: Map<number, string>;
  /** Tree tips with no alignment row (surfaced, never silently dropped). */
  unmatchedTips: string[];
  /** Alignment labels that matched no tip. */
  unmatchedRecords: string[];
  /** The binned alignment the rows came from (carries kind + downsample note). */
  binned: BinnedAlignment;
}

/**
 * Match a binned alignment's records to tree tips by label, reusing the shared
 * tip-label matcher (exact / normalized / unique-token). Returns the per-tip
 * residue row plus both unmatched sides, mirroring matchMetadataToTips so the
 * "matched X of Y" indicator reads the same as the metadata import.
 */
export function matchAlignmentToTips(
  root: TreeNode,
  aln: Alignment,
): AlignmentMatch {
  const binned = binAlignment(aln);
  // Reuse the metadata matcher: shape each record as a one-column row keyed on
  // its label, then translate the matched rows back to residue strings.
  const rows = aln.records.map((r) => ({ __label: r.label }));
  const m = matchMetadataToTips(root, rows, "__label");
  const byLabel = binned.rows; // label -> residue row
  const matched = new Map<number, string>();
  for (const [tipId, row] of m.matched) {
    const label = row.__label;
    const residues = byLabel.get(label);
    if (residues !== undefined) matched.set(tipId, residues);
  }
  const tipNames = leaves(root);
  const unmatchedTips = tipNames
    .filter((t) => !matched.has(t.id))
    .map((t) => t.name);
  // An alignment label is unmatched when no tip resolved to its row. Rebuild from
  // the matcher's used set: a record whose label is in no matched row is unused.
  const usedLabels = new Set<string>();
  for (const row of m.matched.values()) usedLabels.add(row.__label);
  const unmatchedRecords = aln.records
    .map((r) => r.label)
    .filter((l) => !usedLabels.has(l));
  return { matched, unmatchedTips, unmatchedRecords, binned };
}
