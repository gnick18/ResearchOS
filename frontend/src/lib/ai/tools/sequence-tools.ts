// BeakerBot sequence coworker tools (ai sequence-tools bot, 2026-06-11).
//
// Molecular-biology computations the model can invoke on a user's stored sequence
// or on a raw sequence string the user supplies. THE ENGINE COMPUTES, the model
// only relays what the engine returned. A wrong Tm or a wrong codon table is
// worse than no tool, so every function here delegates to the project's
// EXISTING, validated biology engines:
//
//   Tm                -- tmNearestNeighbor (lib/sequences/primer.ts) which
//                        delegates to nearestNeighborTm (lib/calculators/tm-nn.ts,
//                        Biopython Tm_NN parity, SantaLucia 1998)
//   reverse complement -- reverseComplement (lib/sequences/primer.ts, handles
//                        IUPAC ambiguity codes, T/U)
//   translation       -- translateFrame1 (lib/sequences/export.ts, with
//                        resolveCodon / degenerate-codon.ts, Biopython codon-table
//                        parity for IUPAC expansion)
//   ORF finding       -- findOrfs (lib/sequences/orf.ts, both strands, minAa
//                        threshold, forward-coordinate output)
//   primer design     -- designPrimers (lib/sequences/primer-design.ts,
//                        Primer3-compatible default windows, SantaLucia Tm)
//
// Every tool accepts EITHER a sequenceId (the model passes the numeric id from a
// search_my_work brief) OR a raw `sequence` string (ad-hoc input). When a
// sequenceId is given, the tool fetches the full SequenceDetail (including the
// base string) from the sequences API internally. The model NEVER needs to hold
// the base string itself in context.
//
// One WRITE tool (create_sequence) is gated (action: true). The approval preview
// shows the name, type, and length before anything is written.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { tmNearestNeighbor, reverseComplement as revcomp } from "@/lib/sequences/primer";
import { translateFrame1 } from "@/lib/sequences/export";
import { findOrfs, type Orf } from "@/lib/sequences/orf";
import {
  designPrimers,
  type PrimerCandidate,
  type DesignResult,
  DEFAULT_DESIGN_PARAMS,
} from "@/lib/sequences/primer-design";
import { sequencesApi } from "@/lib/local-api";
import { jsonToGenbank, type ParsedSequence } from "@/vendor/bio-parsers";
import type { SequenceDetail } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam (so the tools unit-test with no folder and no file system).
// ---------------------------------------------------------------------------

/** The sequences-layer reads and writes the tools depend on, injected so a test
 *  can stub them without a real folder. Production wires the real sequencesApi. */
export type SequenceToolsDeps = {
  /** Load one sequence in full (bases + annotations). Returns null when not found. */
  getSequence: (id: number) => Promise<SequenceDetail | null>;
  /** Create a new sequence from a GenBank string. Returns the saved record's id
   *  and display_name, or null on failure. */
  createSequence: (data: {
    display_name: string;
    genbank: string;
    seq_type?: "dna" | "rna" | "protein";
  }) => Promise<{ id: number; display_name: string } | null>;
};

export const sequenceToolsDeps: SequenceToolsDeps = {
  getSequence: (id) => sequencesApi.get(id),
  createSequence: async ({ display_name, genbank, seq_type }) => {
    const rec = await sequencesApi.create({
      display_name,
      genbank,
      seq_type,
    });
    if (!rec) return null;
    return { id: rec.id, display_name: rec.display_name };
  },
};

// ---------------------------------------------------------------------------
// Shared arg-parsing helpers (pure, exported for tests).
// ---------------------------------------------------------------------------

/** Resolve the raw sequence string from either a sequenceId or a raw
 *  sequence arg. Returns the bases (uppercased), or an error string.
 *  Exported for testing without real I/O by providing a stubbed deps. */
export async function resolveSequenceBases(
  args: Record<string, unknown>,
  deps: SequenceToolsDeps,
): Promise<{ bases: string } | { error: string }> {
  const rawId = args.sequenceId;
  const rawSeq = args.sequence;

  if (rawId !== undefined) {
    const numId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string"
          ? Number(rawId)
          : NaN;
    if (!Number.isFinite(numId)) {
      return { error: `sequenceId "${rawId}" is not a valid numeric id.` };
    }
    const detail = await deps.getSequence(numId);
    if (!detail) {
      return { error: `Sequence id ${numId} was not found.` };
    }
    if (!detail.seq || detail.seq.length === 0) {
      return { error: `Sequence id ${numId} has no base string in the stored record.` };
    }
    return { bases: detail.seq.toUpperCase() };
  }

  if (typeof rawSeq === "string" && rawSeq.trim().length > 0) {
    return { bases: rawSeq.trim().toUpperCase() };
  }

  return {
    error:
      "Provide either a sequenceId (numeric id from search_my_work) or a raw sequence string.",
  };
}

/** Build a minimal but valid GenBank text for a raw sequence string so
 *  create_sequence can write it through the standard sequencesApi.create path
 *  (which expects GenBank). Pure, no I/O. */
export function rawSeqToGenbank(
  name: string,
  seq: string,
  seqType: "dna" | "rna" | "protein" = "dna",
  circular = false,
): string {
  // jsonToGenbank expects a ParsedSequence shape. The vendored serializer
  // knows about type "circular"/"linear"/"RNA"/"aa"; we map our enum to it.
  const gbType =
    seqType === "protein"
      ? "aa"
      : seqType === "rna"
        ? "RNA"
        : circular
          ? "circular"
          : "linear";
  const parsed: Partial<ParsedSequence> & { sequence: string } = {
    name: name || "Untitled",
    sequence: seq.toUpperCase(),
    type: gbType,
    features: [],
    circular: circular,
  };
  return jsonToGenbank(parsed, {}) || "";
}

// ---------------------------------------------------------------------------
// compute_tm
// ---------------------------------------------------------------------------

/** Return value from compute_tm. */
export type TmResult =
  | {
      ok: true;
      sequence: string;
      tm_celsius: number;
      method: "nearest-neighbor (SantaLucia 1998)" | "basic (Wallace/salt-adjusted GC)";
      conditions: {
        na_millimolar: number;
        oligo_nanomolar: number;
      };
    }
  | { ok: false; error: string };

export const computeTmTool: AiTool = {
  name: "compute_tm",
  description:
    "Calculate the melting temperature (Tm) of a primer or short oligo. The engine uses the SantaLucia 1998 nearest-neighbor model (Biopython Tm_NN parity) for sequences >= 8 nt with unambiguous bases (A/C/G/T), and falls back to the Wallace rule / salt-adjusted GC formula for shorter or degenerate sequences. The model NEVER computes Tm itself, it only relays what this engine returns. Accepts either a sequenceId (numeric id from search_my_work) or a raw sequence string. For a stored sequence, pass its sequenceId and the tool fetches the bases internally. Returns the Tm in Celsius, the method used, and the reaction conditions assumed (50 mM NaCl, 250 nM oligo, matching the Scientific calculator defaults). For genomic-scale sequences this returns the approximate Tm of the full string; for primer design pass the oligo portion.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description:
          "Numeric id of a stored sequence (from search_my_work). The tool fetches the base string internally. Provide this OR sequence, not both.",
      },
      sequence: {
        type: "string",
        description:
          "Raw oligo or primer sequence string (A/C/G/T/U, IUPAC ambiguity codes accepted). Provide this OR sequenceId, not both.",
      },
      na_millimolar: {
        type: "number",
        description:
          "Monovalent cation (Na+) concentration in mM. Default 50 mM (matches the Scientific calculator default).",
      },
      oligo_nanomolar: {
        type: "number",
        description:
          "Total oligo strand concentration in nM. Default 250 nM (matches the Scientific calculator default).",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const resolved = await resolveSequenceBases(args, sequenceToolsDeps);
    if ("error" in resolved) return { ok: false, error: resolved.error } satisfies TmResult;

    const seq = resolved.bases;
    if (seq.length === 0) {
      return { ok: false, error: "The sequence is empty." } satisfies TmResult;
    }

    const naMm =
      typeof args.na_millimolar === "number" && Number.isFinite(args.na_millimolar)
        ? args.na_millimolar
        : 50;
    const oligoNm =
      typeof args.oligo_nanomolar === "number" && Number.isFinite(args.oligo_nanomolar)
        ? args.oligo_nanomolar
        : 250;

    // tmNearestNeighbor takes molarity units; convert from mM/nM.
    const tm = tmNearestNeighbor(seq, oligoNm * 1e-9, naMm * 1e-3);

    if (!Number.isFinite(tm)) {
      return {
        ok: false,
        error: "The engine could not compute a Tm for this sequence (may be empty or purely degenerate).",
      } satisfies TmResult;
    }

    // Determine which sub-method ran. The engine itself uses NN when n >= 8 and
    // all bases are ACGT; otherwise it falls back to the basic formula.
    const cleanSeq = seq.replace(/U/g, "T");
    const usedNn = cleanSeq.length >= 8 && !/[^ACGT]/.test(cleanSeq);

    return {
      ok: true,
      sequence: seq,
      tm_celsius: Math.round(tm * 100) / 100,
      method: usedNn
        ? "nearest-neighbor (SantaLucia 1998)"
        : "basic (Wallace/salt-adjusted GC)",
      conditions: {
        na_millimolar: naMm,
        oligo_nanomolar: oligoNm,
      },
    } satisfies TmResult;
  },
};

// ---------------------------------------------------------------------------
// translate_sequence
// ---------------------------------------------------------------------------

/** Return value from translate_sequence. */
export type TranslationResult =
  | {
      ok: true;
      /** The original nucleotide input (as used by the engine). */
      nucleotide: string;
      /** The amino-acid string. '*' = stop codon, 'X' = unresolvable/partial
       *  codon, matching Biopython convention. */
      protein: string;
      frame: 1 | 2 | 3;
      /** Number of amino acids in the translated product (excluding the stop). */
      length_aa: number;
    }
  | { ok: false; error: string };

export const translateSequenceTool: AiTool = {
  name: "translate_sequence",
  description:
    "Translate a DNA or RNA coding sequence to a protein (amino acid) string. Uses the standard genetic code with IUPAC ambiguity resolution matching Biopython: a degenerate codon is resolved to an amino acid only when every concrete expansion yields the same residue (GGN -> G, CTN -> L); ambiguous codons are rendered as X. Stop codons render as '*'. Accepts a reading frame offset (1, 2, or 3). Pass sequenceId to operate on a stored sequence, or a raw sequence string. The model NEVER translates itself, it relays the engine's output.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description:
          "Numeric id of a stored sequence (from search_my_work). Provide this OR sequence, not both.",
      },
      sequence: {
        type: "string",
        description:
          "Raw DNA or RNA nucleotide string. Provide this OR sequenceId, not both.",
      },
      frame: {
        type: "number",
        description:
          "Reading frame: 1 (default), 2, or 3. Frame 1 starts at position 0, frame 2 at position 1, frame 3 at position 2.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const resolved = await resolveSequenceBases(args, sequenceToolsDeps);
    if ("error" in resolved) return { ok: false, error: resolved.error } satisfies TranslationResult;

    const bases = resolved.bases;
    if (bases.length === 0) {
      return { ok: false, error: "The sequence is empty." } satisfies TranslationResult;
    }

    const rawFrame = args.frame;
    const frameNum: 1 | 2 | 3 =
      rawFrame === 2 ? 2 : rawFrame === 3 ? 3 : 1;

    // translateFrame1 starts from the beginning of what it is given; shift the
    // bases by (frame - 1) bases to implement frame 2 or 3.
    const offset = frameNum - 1;
    const sliced = bases.slice(offset);

    const protein = translateFrame1(sliced);

    // Count amino acids (everything that is not a stop codon '*').
    const stopIdx = protein.indexOf("*");
    const lengthAa = stopIdx >= 0 ? stopIdx : protein.length;

    return {
      ok: true,
      nucleotide: bases,
      protein,
      frame: frameNum,
      length_aa: lengthAa,
    } satisfies TranslationResult;
  },
};

// ---------------------------------------------------------------------------
// reverse_complement
// ---------------------------------------------------------------------------

/** Return value from reverse_complement. */
export type RevcompResult =
  | {
      ok: true;
      input: string;
      reverse_complement: string;
      length: number;
    }
  | { ok: false; error: string };

export const reverseComplementTool: AiTool = {
  name: "reverse_complement",
  description:
    "Return the reverse complement of a DNA or RNA sequence. Handles IUPAC ambiguity codes (R, Y, S, W, K, M, B, V, D, H, N) and U (folded to A's complement). Pass sequenceId for a stored sequence or a raw sequence string. The engine computes, the model relays.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description:
          "Numeric id of a stored sequence (from search_my_work). Provide this OR sequence, not both.",
      },
      sequence: {
        type: "string",
        description:
          "Raw nucleotide string. Provide this OR sequenceId, not both.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const resolved = await resolveSequenceBases(args, sequenceToolsDeps);
    if ("error" in resolved) return { ok: false, error: resolved.error } satisfies RevcompResult;

    const input = resolved.bases;
    if (input.length === 0) {
      return { ok: false, error: "The sequence is empty." } satisfies RevcompResult;
    }

    const rc = revcomp(input);

    return {
      ok: true,
      input,
      reverse_complement: rc,
      length: rc.length,
    } satisfies RevcompResult;
  },
};

// ---------------------------------------------------------------------------
// find_orfs
// ---------------------------------------------------------------------------

/** A compact ORF returned by find_orfs. */
export type OrfSummary = {
  /** 0-based inclusive start on the forward strand. */
  start: number;
  /** 0-based exclusive end on the forward strand. */
  end: number;
  strand: 1 | -1;
  /** ORF length in base pairs (end - start). */
  length_bp: number;
  /** Number of complete codons (including the stop) in the ORF. */
  length_aa: number;
  /** Frame-1 translation of the ORF (from ATG through the stop codon). */
  protein: string;
};

/** Return value from find_orfs. */
export type OrfResult =
  | {
      ok: true;
      total: number;
      min_aa_threshold: number;
      orfs: OrfSummary[];
    }
  | { ok: false; error: string };

export const findOrfsTool: AiTool = {
  name: "find_orfs",
  description:
    "Find open reading frames (ORFs) on both strands of a DNA sequence. An ORF is a run from an ATG start to the next in-frame stop codon (TAA, TAG, or TGA), at least minAa codons long (default 30 aa). Returns ORF positions in 0-based forward coordinates, strand (1 = forward, -1 = reverse), length in bp, and the frame-1 protein translation. Pass sequenceId for a stored sequence or a raw sequence string. The engine computes, the model relays.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description:
          "Numeric id of a stored sequence (from search_my_work). Provide this OR sequence, not both.",
      },
      sequence: {
        type: "string",
        description:
          "Raw DNA nucleotide string. Provide this OR sequenceId, not both.",
      },
      min_aa: {
        type: "number",
        description:
          "Minimum ORF length in amino acids (excluding the stop codon). Default 30. Shorter thresholds return more ORFs (including short putative ones).",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const resolved = await resolveSequenceBases(args, sequenceToolsDeps);
    if ("error" in resolved) return { ok: false, error: resolved.error } satisfies OrfResult;

    const seq = resolved.bases;
    if (seq.length === 0) {
      return { ok: false, error: "The sequence is empty." } satisfies OrfResult;
    }

    const minAa =
      typeof args.min_aa === "number" && Number.isFinite(args.min_aa) && args.min_aa > 0
        ? Math.round(args.min_aa)
        : 30;

    const rawOrfs: Orf[] = findOrfs(seq, minAa);

    const summaries: OrfSummary[] = rawOrfs.map((o) => {
      const orfSeq =
        o.strand === 1
          ? seq.slice(o.start, o.end)
          : revcomp(seq.slice(o.start, o.end));
      return {
        start: o.start,
        end: o.end,
        strand: o.strand,
        length_bp: o.end - o.start,
        length_aa: Math.floor((o.end - o.start) / 3),
        protein: translateFrame1(orfSeq),
      };
    });

    return {
      ok: true,
      total: summaries.length,
      min_aa_threshold: minAa,
      orfs: summaries,
    } satisfies OrfResult;
  },
};

// ---------------------------------------------------------------------------
// design_primers
// ---------------------------------------------------------------------------

/** A compact primer returned by design_primers. */
export type PrimerSummary = {
  direction: "forward" | "reverse";
  sequence: string;
  length: number;
  tm_celsius: number;
  gc_percent: number;
  /** 0-based forward-strand binding span [start, end). */
  start: number;
  end: number;
  /** Lower is better (0 = perfect match to length/Tm optimum). */
  score: number;
  /** Self-complementarity / hairpin heuristics from the engine's analysis, so the
   *  model can report a primer-dimer / fold check. These are simple complementary-
   *  run LENGTHS in bases (APE-level heuristics), not a thermodynamic dG. A value
   *  of 0 means no significant self-complementarity for that check. */
  self_complementarity: {
    /** Longest any-frame self-complementary run (self-dimer / self-fold risk). */
    self_dimer_run: number;
    /** Longest complementary run that includes the 3' terminal base (3' dimer). */
    three_prime_dimer_run: number;
    /** Strongest hairpin stem length (>=3 nt loop); 0 = no significant hairpin. */
    hairpin_stem: number;
  };
};

/** Return value from design_primers. */
export type PrimerDesignResult =
  | {
      ok: true;
      region_start: number;
      region_end: number;
      forward_count: number;
      reverse_count: number;
      primers: PrimerSummary[];
    }
  | { ok: false; error: string };

function candidateToSummary(c: PrimerCandidate, dir: "forward" | "reverse"): PrimerSummary {
  return {
    direction: dir,
    sequence: c.primer,
    length: c.length,
    tm_celsius: Math.round(c.tm * 100) / 100,
    gc_percent: Math.round(c.gc * 10) / 10,
    start: c.start,
    end: c.end,
    score: Math.round(c.score * 100) / 100,
    // The engine already ran the full trust analysis on every candidate; surface
    // its self-complementarity / hairpin run lengths so the model can report a
    // primer-dimer / fold check rather than dropping the signal.
    self_complementarity: {
      self_dimer_run: c.analysis.selfDimerRun,
      three_prime_dimer_run: c.analysis.threePrimeDimerRun,
      hairpin_stem: c.analysis.hairpinStem,
    },
  };
}

export const designPrimersTool: AiTool = {
  name: "design_primers",
  description:
    "Design forward and reverse primer candidates for a target region using an APE-style scan (Primer3-compatible default windows: length 18-27 bp, Tm 57-63 C, GC 30-70%, GC clamp, SantaLucia 1998 nearest-neighbor Tm). Pass sequenceId or a raw template sequence, plus regionStart and regionEnd (0-based, end-exclusive) defining the region to amplify. The engine generates and ranks candidates; the top 5 per direction are returned. Each candidate also relays the engine's self-complementarity check (a self_complementarity object with self_dimer_run, three_prime_dimer_run, and hairpin_stem, the longest complementary-run lengths in bases, where 0 means no significant self-complementarity), so the model can flag a primer-dimer or hairpin risk. These are simple APE-level heuristic lengths, not a thermodynamic dG. The model NEVER designs primers itself, it relays what the engine returned.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description:
          "Numeric id of a stored sequence (from search_my_work). Provide this OR sequence, not both.",
      },
      sequence: {
        type: "string",
        description:
          "Raw template DNA string. Provide this OR sequenceId, not both.",
      },
      region_start: {
        type: "number",
        description:
          "0-based start position (inclusive) of the region to amplify on the forward strand.",
      },
      region_end: {
        type: "number",
        description:
          "0-based end position (exclusive) of the region to amplify on the forward strand.",
      },
    },
    required: ["region_start", "region_end"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const resolved = await resolveSequenceBases(args, sequenceToolsDeps);
    if ("error" in resolved) return { ok: false, error: resolved.error } satisfies PrimerDesignResult;

    const template = resolved.bases;
    if (template.length === 0) {
      return { ok: false, error: "The template sequence is empty." } satisfies PrimerDesignResult;
    }

    const rStart = typeof args.region_start === "number" ? Math.round(args.region_start) : 0;
    const rEnd = typeof args.region_end === "number" ? Math.round(args.region_end) : template.length;

    if (rStart < 0 || rEnd > template.length || rStart >= rEnd) {
      return {
        ok: false,
        error: `Region [${rStart}, ${rEnd}) is invalid for a sequence of length ${template.length}.`,
      } satisfies PrimerDesignResult;
    }

    const result: DesignResult = designPrimers(template, rStart, rEnd, DEFAULT_DESIGN_PARAMS);

    const primers: PrimerSummary[] = [
      ...result.forward.map((c) => candidateToSummary(c, "forward")),
      ...result.reverse.map((c) => candidateToSummary(c, "reverse")),
    ];

    if (primers.length === 0) {
      return {
        ok: false,
        error:
          `No primers meeting the Primer3 default windows (Tm 57-63 C, length 18-27 bp, GC 30-70%, GC clamp) were found in the region [${rStart}, ${rEnd}). ` +
          "The region may be too short, too degenerate, or AT-rich for the default parameters.",
      } satisfies PrimerDesignResult;
    }

    return {
      ok: true,
      region_start: rStart,
      region_end: rEnd,
      forward_count: result.forward.length,
      reverse_count: result.reverse.length,
      primers,
    } satisfies PrimerDesignResult;
  },
};

// ---------------------------------------------------------------------------
// create_sequence  (GATED, action: true)
// ---------------------------------------------------------------------------

/** The parsed + normalized args for create_sequence. */
export type ParsedCreateSequence = {
  name: string;
  sequence: string;
  seq_type: "dna" | "rna" | "protein";
  circular: boolean;
};

/** Parse and normalize the raw tool args. Pure. */
export function parseCreateSequenceArgs(
  args: Record<string, unknown>,
): ParsedCreateSequence {
  const name = typeof args.name === "string" ? args.name.trim() : "Untitled sequence";
  const rawSeq = typeof args.sequence === "string" ? args.sequence.trim().toUpperCase() : "";

  const rawType = args.seq_type;
  const seqType: "dna" | "rna" | "protein" =
    rawType === "rna" ? "rna" : rawType === "protein" ? "protein" : "dna";

  const circular = args.circular === true;

  return { name, sequence: rawSeq, seq_type: seqType, circular };
}

/** Return value from create_sequence. */
export type CreateSequenceResult =
  | {
      ok: true;
      id: number;
      display_name: string;
      seq_type: string;
      length: number;
      circular: boolean;
    }
  | { ok: false; error: string };

export const createSequenceTool: AiTool = {
  name: "create_sequence",
  description:
    "Create a new sequence record in the user's library from a raw nucleotide or protein string. The user sees a preview of the name, type, and length BEFORE anything is written (this preview IS the consent, do not ask in prose first and do not call propose_plan for it). On Approve the sequence is saved; on Reject nothing is written. Non-destructive and reversible. The model must receive the sequence from the user or from a tool result; it must never fabricate bases.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Display name for the new sequence, for example \"pDEMO-GFP\" or \"M13fwd primer\".",
      },
      sequence: {
        type: "string",
        description:
          "The raw sequence string (DNA/RNA nucleotides or amino acids). Only bases the user provided or a tool returned, never invented.",
      },
      seq_type: {
        type: "string",
        description: '"dna" (default), "rna", or "protein".',
      },
      circular: {
        type: "boolean",
        description:
          "Whether the molecule is circular (for example a plasmid). Default false.",
      },
    },
    required: ["name", "sequence"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const parsed = parseCreateSequenceArgs(args);
    const typeLabel =
      parsed.seq_type === "protein"
        ? "protein"
        : parsed.seq_type === "rna"
          ? "RNA"
          : parsed.circular
            ? "circular DNA"
            : "linear DNA";
    const lengthLabel = parsed.sequence.length > 0 ? ` (${parsed.sequence.length} bp)` : "";
    return {
      summary: `create sequence "${parsed.name}" — ${typeLabel}${lengthLabel}`,
    };
  },
  execute: async (args) => {
    const parsed = parseCreateSequenceArgs(args);

    if (parsed.sequence.length === 0) {
      return {
        ok: false,
        error: "The sequence string is empty. Provide the bases before calling create_sequence.",
      } satisfies CreateSequenceResult;
    }

    if (parsed.name.length === 0) {
      parsed.name = "Untitled sequence";
    }

    const genbank = rawSeqToGenbank(parsed.name, parsed.sequence, parsed.seq_type, parsed.circular);
    if (!genbank) {
      return {
        ok: false,
        error: "Could not serialize the sequence to GenBank format. The sequence string may contain invalid characters.",
      } satisfies CreateSequenceResult;
    }

    const saved = await sequenceToolsDeps.createSequence({
      display_name: parsed.name,
      genbank,
      seq_type: parsed.seq_type,
    });

    if (!saved) {
      return {
        ok: false,
        error:
          "The sequence could not be saved. The folder may not be connected, or the sequence store rejected the write.",
      } satisfies CreateSequenceResult;
    }

    return {
      ok: true,
      id: saved.id,
      display_name: saved.display_name,
      seq_type: parsed.seq_type,
      length: parsed.sequence.length,
      circular: parsed.circular,
    } satisfies CreateSequenceResult;
  },
};
