// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
// sequence Phase 1 bot — typed facade over the vendored TeselaGen bio-parsers
// (MIT) GenBank/FASTA path. Vendored no-install from TeselaGen/tg-oss
// (packages/bio-parsers + a small subset of packages/sequence-utils), with
// local shims for `lodash-es`, `color`, `@teselagen/range-utils`, and
// `validate.io-nonnegative-integer-array` under ./_shims. See ./LICENSE.
//
// Phase 1 uses GenBank as the on-disk source of truth (.gb) plus FASTA import.
// We vendor the real GenBank reader (genbankToJson) and writer (jsonToGenbank),
// and the real FASTA reader (fastaToJson). FASTA WRITING is implemented here
// directly (a header line + 80-col wrapped sequence) rather than vendoring the
// upstream jsonToFasta, which pulls a much deeper dependency tree
// (tidyUpSequenceData -> shortid + amino-acid tables) that Phase 1 does not
// need.

// The vendored parser source is plain JS without type declarations.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - vendored JS, typed via the wrappers below
import genbankToJsonRaw from "./genbankToJson";
// @ts-ignore - vendored JS
import jsonToGenbankRaw from "./jsonToGenbank";
// @ts-ignore - vendored JS
import fastaToJsonRaw from "./fastaToJson";
// @ts-ignore - vendored JS (SnapGene .dna binary reader; no-install vendoring)
import snapgeneToJsonRaw from "./snapgeneToJson";

/** A single parsed feature/annotation from a GenBank record. */
export interface ParsedFeature {
  name: string;
  /** 0-based inclusive start index on the sequence. */
  start: number;
  /** 0-based inclusive end index on the sequence. */
  end: number;
  /** 1 = forward strand, -1 = reverse strand. */
  strand: 1 | -1;
  /** GenBank feature type (CDS, promoter, misc_feature, ...). */
  type?: string;
  /** Hex/rgb color carried via the ApEinfo qualifiers, when present. */
  color?: string;
  notes?: Record<string, unknown>;
}

/** The TeselaGen sequence data shape produced by the parsers. */
export interface ParsedSequence {
  name: string;
  sequence: string;
  circular: boolean;
  type?: string;
  features: ParsedFeature[];
  primers?: ParsedFeature[];
  description?: string;
  size?: number;
}

/** A single parse result entry. */
export interface ParseResult {
  success: boolean;
  messages: string[];
  parsedSequence?: ParsedSequence;
}

interface ParseOptions {
  inclusive1BasedStart?: boolean;
  inclusive1BasedEnd?: boolean;
  primersAsFeatures?: boolean;
  guessIfProtein?: boolean;
}

/**
 * Parse a GenBank string into one or more sequence records. Returns the raw
 * TeselaGen result array (one entry per LOCUS in the file).
 */
export function genbankToJson(gbString: string, options: ParseOptions = {}): ParseResult[] {
  return genbankToJsonRaw(gbString, options) as ParseResult[];
}

/**
 * Parse a FASTA string into one or more sequence records.
 */
export function fastaToJson(fastaString: string, options: ParseOptions = {}): ParseResult[] {
  return fastaToJsonRaw(fastaString, options) as ParseResult[];
}

interface SnapgeneParseOptions extends ParseOptions {
  /** Used to derive the fallback display name and the protein flag. */
  fileName?: string;
  isProtein?: boolean;
}

/**
 * Parse a SnapGene `.dna` BINARY file into one or more sequence records.
 *
 * Unlike the GenBank / FASTA readers (which take a string), this takes the raw
 * bytes — an `ArrayBuffer` or `Uint8Array` (read the file with
 * `file.arrayBuffer()`, not `file.text()`). Async because the upstream
 * algorithm is async. The vendored reader uses only browser primitives
 * (DataView / TextDecoder / DOMParser), so it runs fully client-side with no
 * extra dependencies. Returns the same `ParseResult[]` shape as the others.
 */
export function snapgeneToJson(
  bytes: ArrayBuffer | Uint8Array,
  options: SnapgeneParseOptions = {},
): Promise<ParseResult[]> {
  return snapgeneToJsonRaw(bytes, options) as Promise<ParseResult[]>;
}

interface GenbankWriteOptions {
  inclusive1BasedStart?: boolean;
  inclusive1BasedEnd?: boolean;
  reformatSeqName?: boolean;
}

/**
 * Serialize a parsed sequence object back to a GenBank string. Returns the
 * GenBank text, or `false` if serialization failed (matches upstream).
 */
export function jsonToGenbank(
  seq: Partial<ParsedSequence> & { sequence: string },
  options: GenbankWriteOptions = {},
): string | false {
  return jsonToGenbankRaw(seq, options) as string | false;
}

/**
 * Serialize a sequence to a FASTA string: a `>name description` header line
 * followed by the bases wrapped at 80 columns. Implemented locally (see file
 * header) to avoid vendoring the heavy upstream FASTA writer.
 */
export function jsonToFasta(
  seq: { name?: string; description?: string; sequence: string },
  lineWidth = 80,
): string {
  const header = `>${seq.name || "Untitled_Sequence"}${
    seq.description ? ` ${seq.description}` : ""
  }`;
  const bases = (seq.sequence || "").replace(/\s+/g, "");
  const lines: string[] = [header];
  for (let i = 0; i < bases.length; i += lineWidth) {
    lines.push(bases.slice(i, i + lineWidth));
  }
  // FASTA convention is LF-terminated lines; keep it simple and portable.
  return lines.join("\n") + "\n";
}
