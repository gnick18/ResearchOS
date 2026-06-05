// sequence entry-path bot — the ENTRY PATH: turn an imported file (.gb /
// .fasta / .dna) or pasted raw bases into GenBank text ready for
// `sequencesApi.create`. The on-disk source of truth stays a single `.gb`
// file (+ `.meta.json` sidecar), so EVERY entry route converts to GenBank
// here; `.dna` becomes a `.gb` in our store, never a new on-disk shape.

import {
  genbankToJson,
  fastaToJson,
  snapgeneToJson,
  jsonToGenbank,
  type ParseResult,
  type ParsedSequence,
} from "@/vendor/bio-parsers";
import type { SeqType } from "../types";
import { deriveSeqType } from "./parse";

/** One sequence ready to hand to `sequencesApi.create`. */
export interface ImportedSequence {
  /** Display name (from LOCUS / FASTA header / file name). */
  display_name: string;
  /** GenBank text — the on-disk source of truth. */
  genbank: string;
  /** Derived molecule kind. */
  seq_type: SeqType;
  /** Length in bases / residues (for the caller's summary / messaging). */
  length: number;
}

/** The result of importing one file: the sequences parsed out of it plus any
 *  non-fatal messages (e.g. "showed the first of 5 FASTA records"). */
export interface ImportResult {
  sequences: ImportedSequence[];
  messages: string[];
}

/** Recognized import extensions, lowercased without the dot. */
const GENBANK_EXTS = new Set(["gb", "gbk", "gbff", "genbank", "ape"]);
const FASTA_EXTS = new Set(["fasta", "fa", "fna", "ffn", "faa", "frn", "seq"]);
const SNAPGENE_EXTS = new Set(["dna", "prot"]);

export function extensionOf(fileName: string): string {
  const m = /\.([^.\\/]+)$/.exec(fileName || "");
  return m ? m[1].toLowerCase() : "";
}

/** Strip the extension off a file name for a display-name fallback. */
function baseName(fileName: string): string {
  return (fileName || "").replace(/\.[^.\\/]+$/, "") || "Untitled sequence";
}

/** Convert a parsed TeselaGen record into our ImportedSequence (serialize back
 *  to GenBank so the on-disk shape is always a `.gb`). */
function toImported(
  p: ParsedSequence,
  fallbackName: string,
): ImportedSequence | null {
  const seq = (p.sequence || "").trim();
  if (!seq) return null;
  const genbank = jsonToGenbank(p as ParsedSequence & { sequence: string }, {});
  if (!genbank) return null;
  return {
    display_name: (p.name && p.name.trim()) || fallbackName,
    genbank,
    seq_type: deriveSeqType({ type: p.type, sequence: seq }),
    length: seq.length,
  };
}

/** Pull the successfully-parsed sequences out of a ParseResult[]. */
function collect(
  results: ParseResult[],
  fallbackName: string,
): ImportedSequence[] {
  const out: ImportedSequence[] = [];
  results.forEach((r, i) => {
    if (!r.success || !r.parsedSequence) return;
    // Number multi-record fallback names (FASTA can hold many records).
    const name = results.length > 1 ? `${fallbackName} (${i + 1})` : fallbackName;
    const imp = toImported(r.parsedSequence, name);
    if (imp) out.push(imp);
  });
  return out;
}

/**
 * Import a file by name + bytes. GenBank / FASTA are read as text; SnapGene
 * `.dna` is read as binary. Routing is by extension, with a content-sniff
 * fallback for unknown extensions (a leading `>` ⇒ FASTA, `LOCUS` ⇒ GenBank).
 * Multi-record FASTA yields one ImportedSequence per record.
 */
export async function importSequenceFile(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<ImportResult> {
  const ext = extensionOf(fileName);
  const fallbackName = baseName(fileName);
  const messages: string[] = [];

  // SnapGene .dna / .prot — BINARY. Read the bytes directly.
  if (SNAPGENE_EXTS.has(ext)) {
    const results = await snapgeneToJson(bytes, { fileName });
    const sequences = collect(results, fallbackName);
    if (sequences.length === 0) {
      messages.push(
        `Could not read "${fileName}" as a SnapGene file. It may be corrupt or an unsupported variant.`,
      );
    }
    return { sequences, messages };
  }

  // Everything else is text. Decode once.
  const text = new TextDecoder("utf-8").decode(bytes);

  let results: ParseResult[];
  if (GENBANK_EXTS.has(ext)) {
    results = genbankToJson(text, {});
  } else if (FASTA_EXTS.has(ext)) {
    results = fastaToJson(text, {});
  } else {
    // Unknown extension: sniff the content.
    const trimmed = text.trimStart();
    if (trimmed.startsWith(">")) {
      results = fastaToJson(text, {});
    } else if (/^LOCUS\b/m.test(trimmed)) {
      results = genbankToJson(text, {});
    } else {
      return {
        sequences: [],
        messages: [
          `Unrecognized file type for "${fileName}". Import a GenBank (.gb), FASTA (.fasta), or SnapGene (.dna) file.`,
        ],
      };
    }
  }

  const sequences = collect(results, fallbackName);
  if (sequences.length === 0) {
    messages.push(`No sequences could be read from "${fileName}".`);
  } else if (sequences.length > 1) {
    messages.push(`Imported ${sequences.length} records from "${fileName}".`);
  }
  return { sequences, messages };
}

// ── New-from-paste ─────────────────────────────────────────────────────────

const DNA_ALLOWED = /[^ACGTNRYSWKMBDHVacgtnryswkmbdhv]/g;
const RNA_ALLOWED = /[^ACGUNRYSWKMBDHVacgunryswkmbdhv]/g;
// 20 standard amino acids + ambiguity (B, Z, X) + stop (*).
const PROTEIN_ALLOWED = /[^ACDEFGHIKLMNPQRSTVWYBZXacdefghiklmnpqrstvwybzx*]/g;

/**
 * Sanitize a pasted raw sequence for the given molecule type: drop whitespace,
 * digits (FASTA / GenBank line numbers), and any character outside the allowed
 * alphabet, then uppercase. Returns the cleaned bases.
 */
export function sanitizeRawSequence(raw: string, seqType: SeqType): string {
  // Strip a leading FASTA header line if the user pasted one.
  let body = raw;
  if (/^\s*>/.test(body)) {
    const nl = body.indexOf("\n");
    body = nl === -1 ? "" : body.slice(nl + 1);
  }
  const allowed =
    seqType === "protein"
      ? PROTEIN_ALLOWED
      : seqType === "rna"
        ? RNA_ALLOWED
        : DNA_ALLOWED;
  return body.replace(allowed, "").toUpperCase();
}

/**
 * Build an ImportedSequence from a pasted (or blank) raw sequence. The bases
 * are sanitized for the molecule type and wrapped into a GenBank record via
 * the parser round-trip (parse a minimal GenBank, re-serialize) so the on-disk
 * shape matches the import path exactly. Returns null if, after sanitizing,
 * there are no bases AND the caller did not request a blank record.
 */
export function buildNewSequence(args: {
  name: string;
  seqType: SeqType;
  rawSequence: string;
  allowEmpty?: boolean;
}): ImportedSequence | null {
  const { name, seqType, rawSequence, allowEmpty = false } = args;
  const bases = sanitizeRawSequence(rawSequence, seqType);
  if (!bases && !allowEmpty) return null;

  const displayName = name.trim() || "Untitled sequence";
  // Construct the parsed shape directly and serialize to GenBank. New
  // sequences are linear by default; the molecule type drives the LOCUS.
  const parsed = {
    name: displayName.replace(/\s+/g, "_").slice(0, 60) || "seq",
    sequence: bases,
    circular: false,
    type: seqType === "protein" ? "PROTEIN" : seqType === "rna" ? "RNA" : "DNA",
    features: [],
  };
  const genbank = jsonToGenbank(parsed, {});
  if (!genbank) return null;
  return {
    display_name: displayName,
    genbank,
    seq_type: seqType,
    length: bases.length,
  };
}
