// BeakerBot molecular-cloning coworker tools (BeakerAI).
//
// A suite that lets the assistant, from natural language, FETCH a sequence from
// NCBI, EXTRACT a gene / region out of a sequence, and ASSEMBLE a plasmid by
// Gibson overlap or restriction / Golden Gate ligation, and CHAIN these (the
// agent loop already chains tool calls, so "download human GAPDH, pull the CDS,
// and Gibson it into pUC19" becomes fetch_sequence -> extract_feature ->
// assemble_gibson, each gated by its own approval card).
//
// DIVISION OF LABOR (the same rule the data-analysis tools follow)
//   - The LLM orchestrates. It calls list_sequences / read_sequence_features to
//     get REAL ids and feature names, then maps the request to engine calls. It
//     NEVER computes a base, a junction, an overhang, or an assembled product.
//   - The ENGINE computes. The validated, golden-tested cloning engines do all
//     the biology:
//       NCBI fetch        -- efetchGenbank / resolveGeneToAccession (ncbi-efetch.ts),
//                            previewGenomeByAccession + downloadPackage +
//                            ncbiPackageToImports (ncbi-datasets.ts / ncbi-import.ts)
//       region extract    -- extractRegion (extract-region.ts)
//       Gibson assembly   -- assembleGibson (cloning.ts)
//       cut + ligate      -- cutAndLigate (cut-ligate.ts), restriction + Golden Gate
//     and the serialize / coordinate translation reuses cloning-io.ts
//     (annotationsToCloneFeatures, productToGenbank) so a saved construct
//     round-trips byte-identically to the cloning workspace.
//   - Each WRITE shows an APPROVAL CARD. fetch_sequence / extract_feature /
//     assemble_gibson / digest_ligate are action tools (action: true). The user
//     sees a one-line summary describing exactly what will be created BEFORE
//     anything is written; that card IS the consent. On Approve the tool writes
//     the new library sequence and navigates to /sequences?seq=<id>.
//
// The read tools (list_sequences, read_sequence_features) cache the loaded
// SequenceDetail so the synchronous describeAction can preview an extract / an
// assembly without an await, mirroring the datahub-analysis content cache. execute
// always re-reads the live record so a stale cache never corrupts a saved result.
//
// SCOPE BOUNDARY. These use the EXISTING per-write approval flow only (a plain
// action confirm). No "approve all" / batch-approve mechanism is built here, that
// is a separate arc; this file only ADDS tools and is registered in registry.ts.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { sequencesApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import {
  efetchGenbank,
  resolveGeneToAccession,
  NoRefSeqGeneError,
} from "@/lib/sequences/ncbi-efetch";
import {
  previewByAccession,
  previewGenomeByAccession,
  sniffAccessionKind,
  checkCaps,
  includeForKind,
  downloadPackage,
  type NcbiPreview,
} from "@/lib/sequences/ncbi-datasets";
import {
  ncbiPackageToImports,
  efetchGenbankToImports,
  type NcbiProvenance,
} from "@/lib/sequences/ncbi-import";
import { extractRegion, type ExtractTarget } from "@/lib/sequences/extract-region";
import { assembleGibson, type Fragment, type OverlapMode } from "@/lib/sequences/cloning";
import { cutAndLigate, type LigateFragment } from "@/lib/sequences/cut-ligate";
import {
  annotationsToCloneFeatures,
  productToGenbank,
} from "@/lib/sequences/cloning-io";
import { jsonToGenbank, type ParsedSequence, type ParsedFeature } from "@/vendor/bio-parsers";
import type { SequenceDetail } from "@/lib/types";
import type { AiTool } from "./types";

// ===========================================================================
// Injectable deps seam (so the tools unit-test with no folder and no network).
// ===========================================================================

/** A light library summary the model reads to get real ids + feature names. */
export type LibrarySummary = {
  id: number;
  display_name: string;
  length: number;
  circular: boolean;
  seq_type: string;
  /** The annotated feature names, so the model can pick a gene to extract. */
  feature_names: string[];
};

/** The sequence-layer + NCBI reads/writes the cloning tools depend on, injected
 *  so a test can stub them. Production wires the real engines + sequencesApi. */
export type CloningToolsDeps = {
  /** List the library as light records (id, name, length, circular, type, ...). */
  listSequences: () => Promise<LibrarySummary[]>;
  /** Load one sequence in full (bases + annotations). Null when not found. */
  getSequence: (id: number) => Promise<SequenceDetail | null>;
  /** Create a new sequence from a GenBank string + optional provenance. Returns
   *  the saved record's id + display_name, or null on failure. */
  createSequence: (data: {
    display_name: string;
    genbank: string;
    seq_type?: "dna" | "rna" | "protein";
    provenance?: NcbiProvenance;
  }) => Promise<{ id: number; display_name: string } | null>;
  /** Navigate to a path after a successful write. */
  navigate: (path: string) => void;

  // NCBI legs (injected so fetch_sequence is offline + deterministic in tests).
  /** Fetch annotated GenBank text for a nuccore accession. */
  efetchGenbank: (accession: string) => Promise<string>;
  /** Resolve a gene symbol + taxon to its RefSeqGene accession. */
  resolveGeneToAccession: (symbol: string, taxon: string) => Promise<string>;
  /** Cheap preview by accession (sniffs the kind). For the size guard + routing. */
  previewByAccession: (accession: string) => Promise<NcbiPreview>;
  /** Cheap preview of a genome assembly accession (GCF_ / GCA_). */
  previewGenomeByAccession: (accession: string) => Promise<NcbiPreview>;
  /** Download a Datasets ZIP package for a genome accession. */
  downloadGenomePackage: (accession: string) => Promise<ArrayBuffer>;
};

async function defaultListSequences(): Promise<LibrarySummary[]> {
  const records = await sequencesApi.list();
  const out: LibrarySummary[] = [];
  for (const rec of records) {
    // The list record carries the count but not the names; load the detail only
    // for its feature names. The library is small (one workspace), so this is
    // cheap and keeps the model's pick grounded in real names.
    let featureNames: string[] = [];
    if (rec.feature_count > 0) {
      const detail = await sequencesApi.get(rec.id);
      featureNames = detail
        ? detail.annotations.map((a) => a.name || "Untitled").filter(Boolean)
        : [];
    }
    out.push({
      id: rec.id,
      display_name: rec.display_name,
      length: rec.length,
      circular: rec.circular,
      seq_type: rec.seq_type,
      feature_names: featureNames,
    });
  }
  return out;
}

export const cloningToolsDeps: CloningToolsDeps = {
  listSequences: defaultListSequences,
  getSequence: (id) => sequencesApi.get(id),
  createSequence: async ({ display_name, genbank, seq_type, provenance }) => {
    const rec = await sequencesApi.create({
      display_name,
      genbank,
      seq_type,
      ...(provenance
        ? {
            source: provenance.source,
            ncbi_accession: provenance.ncbi_accession,
            organism: provenance.organism,
            tax_id: provenance.tax_id,
            tax_lineage: provenance.tax_lineage,
          }
        : {}),
    });
    if (!rec) return null;
    return { id: rec.id, display_name: rec.display_name };
  },
  navigate: requestNavigation,
  efetchGenbank: (accession) => efetchGenbank(accession),
  resolveGeneToAccession: (symbol, taxon) => resolveGeneToAccession(symbol, taxon),
  previewByAccession: (accession) => previewByAccession(accession),
  previewGenomeByAccession: (accession) => previewGenomeByAccession(accession),
  downloadGenomePackage: async (accession) => {
    const preview = await previewGenomeByAccession(accession);
    const include = includeForKind("genome");
    return downloadPackage({ kind: "genome", id: preview.accession, include });
  },
};

// ===========================================================================
// Content cache (bridges the sync describeAction to the async sequence read).
// ===========================================================================

const _seqCache = new Map<number, SequenceDetail>();

/** Cache one sequence detail (used by the read tools + each execute). */
export function cacheSequenceDetail(detail: SequenceDetail): void {
  _seqCache.set(detail.id, detail);
}

/** Read a cached sequence detail (used by the sync describeAction paths). */
export function getCachedSequenceDetail(id: number): SequenceDetail | null {
  return _seqCache.get(id) ?? null;
}

/** Test helper, clear the content cache between cases. */
export function _clearCloningCache(): void {
  _seqCache.clear();
}

// ===========================================================================
// list_sequences  (READ-only)
// ===========================================================================

export type ListSequencesResult =
  | { ok: true; total: number; sequences: LibrarySummary[] }
  | { ok: false; error: string };

export const listSequencesTool: AiTool = {
  name: "list_sequences",
  description:
    "List the user's sequence library so you have REAL numeric ids before extracting or assembling. Returns each sequence's id, display name, length, whether it is circular, its molecule type (dna / rna / protein), and the names of its annotated features. Call this FIRST whenever the user asks to pull a gene out of a sequence, run a Gibson assembly, or run a restriction / Golden Gate ligation, so you can map their words (for example \"pUC19\" or \"the GAPDH CDS\") to a real sequence id and a real feature name. Read-only, never writes or navigates.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const sequences = await cloningToolsDeps.listSequences();
    return { ok: true, total: sequences.length, sequences } satisfies ListSequencesResult;
  },
};

// ===========================================================================
// read_sequence_features  (READ-only, caches the detail for describeAction)
// ===========================================================================

/** One annotation projected for the model, with the coordinates it needs to pick
 *  a region to extract. start / end are 0-based, end-INCLUSIVE (the app shape). */
export type AnnotationSummary = {
  name: string;
  type: string;
  start: number;
  end: number;
  direction: -1 | 0 | 1;
};

export type ReadSequenceFeaturesResult =
  | {
      ok: true;
      id: number;
      display_name: string;
      seq_type: string;
      length: number;
      circular: boolean;
      organism: string | null;
      annotations: AnnotationSummary[];
    }
  | { ok: false; error: string };

function parseSeqId(raw: unknown): { id: number } | { error: string } {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return { error: `sequenceId "${String(raw)}" is not a valid numeric id.` };
  return { id: Math.round(n) };
}

export const readSequenceFeaturesTool: AiTool = {
  name: "read_sequence_features",
  description:
    "Read one sequence's full annotation list so you can pick a gene or region to extract. Returns the sequence id, name, type, length, whether it is circular, organism if known, and every annotated feature with its name, type, coordinates (0-based, end-inclusive), and direction (1 forward, -1 reverse, 0 none). The base string is NOT returned (it is too large for the context window); the extract / assemble tools fetch the bases internally. Call this after list_sequences when the user wants to extract a feature by name, so you know the feature exists and what it is called. Read-only, never writes or navigates.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description: "Numeric id of a stored sequence (from list_sequences).",
      },
    },
    required: ["sequenceId"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseSeqId(args.sequenceId);
    if ("error" in parsed) return { ok: false, error: parsed.error } satisfies ReadSequenceFeaturesResult;
    const detail = await cloningToolsDeps.getSequence(parsed.id);
    if (!detail) {
      return { ok: false, error: `Sequence id ${parsed.id} was not found.` } satisfies ReadSequenceFeaturesResult;
    }
    cacheSequenceDetail(detail);
    const annotations: AnnotationSummary[] = detail.annotations.map((a) => ({
      name: a.name || "Untitled",
      type: a.type || "misc_feature",
      start: a.start,
      end: a.end,
      direction: a.direction,
    }));
    return {
      ok: true,
      id: detail.id,
      display_name: detail.display_name,
      seq_type: detail.seq_type,
      length: detail.length,
      circular: detail.circular,
      organism: detail.organism ?? null,
      annotations,
    } satisfies ReadSequenceFeaturesResult;
  },
};

// ===========================================================================
// fetch_sequence  (ACTION, gated)
// ===========================================================================

export type FetchSequenceArgs = {
  accession?: string;
  geneSymbol?: string;
  organism?: string;
  name?: string;
};

export function parseFetchSequenceArgs(args: Record<string, unknown>): FetchSequenceArgs {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  return {
    accession: str(args.accession),
    geneSymbol: str(args.geneSymbol),
    organism: str(args.organism),
    name: str(args.name),
  };
}

export type FetchSequenceResult =
  | {
      ok: true;
      created: { id: number; display_name: string }[];
      accession: string;
      organism?: string;
    }
  | { ok: false; error: string };

/** Build a calm one-line summary of what will be fetched, for the approval card. */
function describeFetch(args: Record<string, unknown>): { summary: string } {
  const a = parseFetchSequenceArgs(args);
  if (a.accession) {
    const kind = sniffAccessionKind(a.accession);
    const kindLabel = kind === "genome" ? "genome assembly" : kind === "protein" ? "protein" : "sequence";
    return { summary: `fetch the ${kindLabel} ${a.accession} from NCBI and save it to the library` };
  }
  if (a.geneSymbol) {
    const org = a.organism ? ` (${a.organism})` : "";
    return { summary: `fetch the gene ${a.geneSymbol}${org} from NCBI and save it to the library` };
  }
  return { summary: "fetch a sequence from NCBI" };
}

export const fetchSequenceTool: AiTool = {
  name: "fetch_sequence",
  description:
    "Fetch a sequence from NCBI and save it to the user's library. Provide EXACTLY ONE of: an accession (a nuccore accession like NM_002046, NG_007073, or a genome assembly accession GCF_/GCA_), OR a gene symbol plus an organism (for example geneSymbol \"GAPDH\", organism \"Homo sapiens\"). The browser fetches the public record directly from NCBI (no server, no personal data leaves the machine); the only thing sent is the public identifier you pass. Annotated records arrive with their features. Genome assemblies are size-capped (about 50 Mb / 500 contigs); a larger genome is refused with a clear message rather than freezing the editor. The user sees an approval card naming what will be fetched before anything is written; that card IS the consent, do NOT call propose_plan for it. On Approve the sequence is saved and the user is taken to it. After it saves, say in one short sentence what landed (the name and length), then chain into extract_feature or an assembly if the user asked for a multi-step build. You NEVER fabricate bases or an accession; only fetch a real identifier the user named.",
  parameters: {
    type: "object",
    properties: {
      accession: {
        type: "string",
        description:
          "An NCBI accession: a nuccore record (NM_, NR_, XM_, NG_, NC_, or any accession efetch serves) or a genome assembly accession (GCF_ / GCA_). Provide this OR geneSymbol + organism, not both.",
      },
      geneSymbol: {
        type: "string",
        description:
          'A gene symbol to resolve to its RefSeqGene record (for example "GAPDH", "TP53"). Requires organism. Provide this OR accession, not both.',
      },
      organism: {
        type: "string",
        description:
          'The organism for a gene-symbol lookup (for example "Homo sapiens", "Escherichia coli"). Required when geneSymbol is given.',
      },
      name: {
        type: "string",
        description:
          "Optional display name for the saved sequence. Defaults to the record name from NCBI.",
      },
    },
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => describeFetch(args),
  execute: async (args) => {
    const a = parseFetchSequenceArgs(args);

    // Resolve the route. Accession wins; otherwise gene symbol + organism.
    let accession = a.accession;
    let geneRoute = false;
    if (!accession) {
      if (!a.geneSymbol) {
        return {
          ok: false,
          error: "Provide an accession, or a gene symbol plus an organism.",
        } satisfies FetchSequenceResult;
      }
      if (!a.organism) {
        return {
          ok: false,
          error: `A gene-symbol lookup needs an organism. Pass organism (for example "Homo sapiens") alongside geneSymbol "${a.geneSymbol}".`,
        } satisfies FetchSequenceResult;
      }
      try {
        accession = await cloningToolsDeps.resolveGeneToAccession(a.geneSymbol, a.organism);
        geneRoute = true;
      } catch (err) {
        if (err instanceof NoRefSeqGeneError) {
          return {
            ok: false,
            error: `${a.geneSymbol} has no annotated RefSeqGene record on NCBI for ${a.organism}, so there is no whole-gene file to fetch. Try a specific transcript accession (an NM_ id) instead.`,
          } satisfies FetchSequenceResult;
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not resolve that gene on NCBI.",
        } satisfies FetchSequenceResult;
      }
    }

    const kind = sniffAccessionKind(accession);

    // GENOME route: a cheap preview enforces the size cap, then the Datasets ZIP
    // path imports each record. This can fan out (one record per chromosome /
    // plasmid / contig).
    if (kind === "genome") {
      let preview: NcbiPreview;
      try {
        preview = await cloningToolsDeps.previewGenomeByAccession(accession);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not preview that genome on NCBI.",
        } satisfies FetchSequenceResult;
      }
      const cap = checkCaps(preview);
      if (!cap.ok) {
        return { ok: false, error: cap.reason ?? "This genome is over the in-browser import limit." } satisfies FetchSequenceResult;
      }
      let zip: ArrayBuffer;
      try {
        zip = await cloningToolsDeps.downloadGenomePackage(accession);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not download that genome from NCBI.",
        } satisfies FetchSequenceResult;
      }
      const provenance: NcbiProvenance = {
        source: "ncbi-datasets",
        ncbi_accession: preview.accession,
        organism: preview.organism,
        tax_id: preview.taxId,
      };
      let imports;
      try {
        imports = await ncbiPackageToImports(zip, provenance);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not read the downloaded genome package.",
        } satisfies FetchSequenceResult;
      }
      return saveImports(imports, a.name, preview.accession, preview.organism, provenance);
    }

    // PROTEIN: efetch serves protein records too, but the rest of this suite is
    // nucleotide cloning, so we surface a calm note rather than guess.
    if (kind === "protein") {
      return {
        ok: false,
        error: "That looks like a protein accession. The cloning tools work on nucleotide sequences; fetch a gene or transcript (an NM_ / NG_ accession) instead.",
      } satisfies FetchSequenceResult;
    }

    // NUCLEOTIDE route (gene / transcript / any nuccore accession): efetch the
    // annotated GenBank directly. This covers the gene-symbol route (whose
    // resolved NG_ accession is a nuccore record) and any typed accession.
    let genbank: string;
    try {
      genbank = await cloningToolsDeps.efetchGenbank(accession);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not fetch that record from NCBI.",
      } satisfies FetchSequenceResult;
    }
    const provenance: NcbiProvenance = {
      source: "ncbi-efetch",
      ncbi_accession: accession,
      organism: a.organism,
    };
    let imports;
    try {
      imports = await efetchGenbankToImports(genbank, provenance);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not read the fetched NCBI record.",
      } satisfies FetchSequenceResult;
    }
    // For the gene route the organism the user typed is the best provenance label;
    // for a raw accession we leave organism to whatever the record carried.
    const orgLabel = geneRoute ? a.organism : a.organism;
    return saveImports(imports, a.name, accession, orgLabel, provenance);
  },
};

/** Save one or more imported records, navigate to the first, return the result. */
async function saveImports(
  imports: { display_name: string; genbank: string; seq_type: "dna" | "rna" | "protein" }[],
  nameOverride: string | undefined,
  accession: string,
  organism: string | undefined,
  provenance: NcbiProvenance,
): Promise<FetchSequenceResult> {
  if (imports.length === 0) {
    return { ok: false, error: "NCBI returned no sequence record to save." };
  }
  const created: { id: number; display_name: string }[] = [];
  for (let i = 0; i < imports.length; i += 1) {
    const imp = imports[i];
    // Only the first record takes the user's name override (a multi-record genome
    // keeps each record's own LOCUS name).
    const displayName = i === 0 && nameOverride ? nameOverride : imp.display_name;
    const saved = await cloningToolsDeps.createSequence({
      display_name: displayName,
      genbank: imp.genbank,
      seq_type: imp.seq_type,
      provenance,
    });
    if (saved) created.push(saved);
  }
  if (created.length === 0) {
    return {
      ok: false,
      error: "The fetched sequence could not be saved. The folder may not be connected.",
    };
  }
  cloningToolsDeps.navigate(`/sequences?seq=${created[0].id}`);
  return { ok: true, created, accession, organism };
}

// ===========================================================================
// extract_feature  (ACTION, gated)
// ===========================================================================

export type ExtractFeatureArgs = {
  sequenceId: number;
  featureName?: string;
  start?: number;
  end?: number;
  strand?: 1 | -1;
  name?: string;
};

export function parseExtractFeatureArgs(args: Record<string, unknown>): ExtractFeatureArgs {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const id = typeof args.sequenceId === "number" ? args.sequenceId : Number(args.sequenceId);
  return {
    sequenceId: Number.isFinite(id) ? Math.round(id) : NaN,
    featureName: typeof args.featureName === "string" && args.featureName.trim() !== "" ? args.featureName.trim() : undefined,
    start: num(args.start),
    end: num(args.end),
    strand: args.strand === -1 ? -1 : args.strand === 1 ? 1 : undefined,
    name: typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : undefined,
  };
}

/** Build the ExtractTarget from the parsed args, or an error string. Pure. */
export function buildExtractTarget(a: ExtractFeatureArgs): ExtractTarget | { error: string } {
  if (a.featureName) return { featureName: a.featureName };
  if (a.start !== undefined && a.end !== undefined) {
    return { start: a.start, end: a.end, strand: a.strand };
  }
  return { error: "Provide a featureName, or both start and end coordinates, to extract." };
}

export type ExtractFeatureResult =
  | { ok: true; id: number; display_name: string; length: number; strand: 1 | -1 }
  | { ok: false; error: string };

/** Serialize an extracted region (bases + inclusive-end annotations) to GenBank.
 *  Reuses the vendored writer; annotation ends are inclusive (jsonToGenbank's
 *  ParsedFeature convention), which is exactly what extractRegion emits. */
function extractedToGenbank(
  name: string,
  seq: string,
  annotations: { name: string; start: number; end: number; direction: -1 | 0 | 1; type?: string }[],
): string {
  const features: ParsedFeature[] = annotations.map((a) => ({
    name: a.name || "feature",
    start: a.start,
    end: Math.max(a.start, a.end),
    strand: a.direction === -1 ? -1 : 1,
    type: a.type || "misc_feature",
  }));
  const parsed: ParsedSequence = {
    name: (name || "extract").replace(/\s+/g, "_").slice(0, 60) || "extract",
    sequence: seq.toUpperCase(),
    circular: false,
    type: "DNA",
    features,
  };
  return jsonToGenbank(parsed, {}) || "";
}

export const extractFeatureTool: AiTool = {
  name: "extract_feature",
  description:
    "Create a new library sequence from a REGION of an existing one, either by a feature name (for example pull the \"GAPDH\" CDS out of a fetched gene) OR by coordinates (start and end, 0-based and end-exclusive, with an optional strand). Call list_sequences and read_sequence_features first so you pass a real sequence id and a real feature name. The engine slices the bases, reverse-complements the region when it is on the minus strand (so the result reads 5'->3'), and carries over any features that overlap the region, rebased to the new molecule. The user sees an approval card naming what will be extracted before anything is written; that card IS the consent, do NOT call propose_plan for it. On Approve the new sequence is saved and the user is taken to it. This is the middle step of a fetch -> extract -> assemble chain.",
  parameters: {
    type: "object",
    properties: {
      sequenceId: {
        type: "number",
        description: "Numeric id of the source sequence (from list_sequences).",
      },
      featureName: {
        type: "string",
        description:
          "Name of an annotated feature to extract (match a feature from read_sequence_features). Provide this OR start + end, not both. The feature's strand is used automatically.",
      },
      start: {
        type: "number",
        description:
          "0-based start position (inclusive) on the source forward strand. Provide with end (and optionally strand) instead of featureName.",
      },
      end: {
        type: "number",
        description: "0-based end position (exclusive) on the source forward strand.",
      },
      strand: {
        type: "number",
        description:
          "1 for the forward strand (default), -1 to reverse-complement the region. Only used with start + end (a featureName carries its own strand).",
      },
      name: {
        type: "string",
        description:
          "Optional display name for the extracted sequence. Defaults to the feature name or \"<source> region\".",
      },
    },
    required: ["sequenceId"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const a = parseExtractFeatureArgs(args);
    const target = buildExtractTarget(a);
    if ("error" in target) {
      return { summary: "extract a region from a sequence" };
    }
    // Preview off the cache when available (read_sequence_features populates it).
    const detail = Number.isFinite(a.sequenceId) ? getCachedSequenceDetail(a.sequenceId) : null;
    if (!detail) {
      const where = "featureName" in target ? `the "${target.featureName}" feature` : `[${a.start}, ${a.end})`;
      return { summary: `extract ${where} into a new sequence` };
    }
    const r = extractRegion(detail, target);
    if ("error" in r) return { summary: "extract a region from a sequence" };
    const label =
      r.featureName ?? (a.name || `${detail.display_name} region`);
    const strandLabel = r.strand === -1 ? " (reverse strand)" : "";
    return {
      summary: `create sequence "${label}" — ${r.seq.length} bp${strandLabel}, extracted from "${detail.display_name}"`,
    };
  },
  execute: async (args) => {
    const a = parseExtractFeatureArgs(args);
    if (!Number.isFinite(a.sequenceId)) {
      return { ok: false, error: "Provide a valid numeric sequenceId from list_sequences." } satisfies ExtractFeatureResult;
    }
    const target = buildExtractTarget(a);
    if ("error" in target) return { ok: false, error: target.error } satisfies ExtractFeatureResult;

    // Always re-read the live source so the slice is current.
    const detail = await cloningToolsDeps.getSequence(a.sequenceId);
    if (!detail) {
      return { ok: false, error: `Sequence id ${a.sequenceId} was not found.` } satisfies ExtractFeatureResult;
    }
    cacheSequenceDetail(detail);

    const r = extractRegion(detail, target);
    if ("error" in r) return { ok: false, error: r.error } satisfies ExtractFeatureResult;
    if (r.seq.length === 0) {
      return { ok: false, error: "The extracted region is empty." } satisfies ExtractFeatureResult;
    }

    const name = r.featureName ?? a.name ?? `${detail.display_name} region`;
    const genbank = extractedToGenbank(name, r.seq, r.annotations);
    if (!genbank) {
      return { ok: false, error: "Could not serialize the extracted region to GenBank." } satisfies ExtractFeatureResult;
    }
    const saved = await cloningToolsDeps.createSequence({
      display_name: name,
      genbank,
      seq_type: "dna",
    });
    if (!saved) {
      return {
        ok: false,
        error: "The extracted sequence could not be saved. The folder may not be connected.",
      } satisfies ExtractFeatureResult;
    }
    cloningToolsDeps.navigate(`/sequences?seq=${saved.id}`);
    return {
      ok: true,
      id: saved.id,
      display_name: saved.display_name,
      length: r.seq.length,
      strand: r.strand,
    } satisfies ExtractFeatureResult;
  },
};

// ===========================================================================
// assemble_gibson  (ACTION, gated)
// ===========================================================================

export type AssembleGibsonArgs = {
  sequenceIds: number[];
  circular: boolean;
  overlapBp?: number;
  name?: string;
};

export function parseAssembleGibsonArgs(args: Record<string, unknown>): AssembleGibsonArgs {
  const ids = Array.isArray(args.sequenceIds)
    ? args.sequenceIds
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.round(n))
    : [];
  return {
    sequenceIds: ids,
    circular: args.circular !== false, // default true (plasmid)
    overlapBp:
      typeof args.overlapBp === "number" && Number.isFinite(args.overlapBp) && args.overlapBp > 0
        ? Math.round(args.overlapBp)
        : undefined,
    name: typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : undefined,
  };
}

/** Build the engine fragments from cached/loaded details, in the given id order.
 *  Returns the fragments or a missing-id error. */
function detailsToFragments(
  ids: number[],
  resolve: (id: number) => SequenceDetail | null,
): { fragments: Fragment[]; names: string[] } | { error: string } {
  const fragments: Fragment[] = [];
  const names: string[] = [];
  for (const id of ids) {
    const detail = resolve(id);
    if (!detail) return { error: `Sequence id ${id} was not found in the library.` };
    fragments.push({
      name: detail.display_name,
      seq: detail.seq,
      features: annotationsToCloneFeatures(detail.annotations),
    });
    names.push(detail.display_name);
  }
  return { fragments, names };
}

export type AssembleGibsonResult =
  | {
      ok: true;
      id: number;
      display_name: string;
      length: number;
      circular: boolean;
      junctions: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export const assembleGibsonTool: AiTool = {
  name: "assemble_gibson",
  description:
    "Assemble two or more library sequences into one construct by Gibson / NEBuilder HiFi overlap assembly. Pass sequenceIds in the order the fragments should join (the first fragment is the start; for a plasmid the last joins back to the first). Set circular true for a plasmid (the default) or false for a linear product. The engine concatenates the fragment bodies (the homology lives once at each seam), designs the per-junction PCR primers with homology tails, and rebases every fragment's features into the product. The model NEVER computes a base, a junction, or a primer; the validated engine does. The user sees an approval card naming the product (length, circular or linear, fragment count) before anything is written; that card IS the consent, do NOT call propose_plan for it. On Approve the assembled construct is saved as a new sequence (with the designed primers as primer_bind features) and the user is taken to it. After it saves, say the product length and per-junction homology in one short sentence, and surface any warnings the engine returned (a short overlap, an ambiguous junction).",
  parameters: {
    type: "object",
    properties: {
      sequenceIds: {
        type: "array",
        items: { type: "number" },
        description:
          "The library sequence ids of the fragments to assemble, in join order (first fragment first). At least two.",
      },
      circular: {
        type: "boolean",
        description:
          "true for a circular plasmid product (default), false for a linear construct.",
      },
      overlapBp: {
        type: "number",
        description:
          "Optional fixed homology-overlap length in bp (default 25). The engine caps it to the shorter flanking fragment.",
      },
      name: {
        type: "string",
        description: "Optional display name for the assembled construct. Defaults to \"Gibson assembly\".",
      },
    },
    required: ["sequenceIds"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const a = parseAssembleGibsonArgs(args);
    if (a.sequenceIds.length < 2) {
      return { summary: "assemble a Gibson construct" };
    }
    const built = detailsToFragments(a.sequenceIds, getCachedSequenceDetail);
    if ("error" in built) {
      return { summary: `assemble ${a.sequenceIds.length} fragments by Gibson overlap` };
    }
    const overlap: OverlapMode | undefined = a.overlapBp ? { kind: "length", bp: a.overlapBp } : undefined;
    const result = assembleGibson(built.fragments, { circular: a.circular, overlap });
    const topology = a.circular ? "circular plasmid" : "linear construct";
    const name = a.name ?? "Gibson assembly";
    return {
      summary: `create sequence "${name}" — ${topology}, ${result.product.seq.length} bp from ${a.sequenceIds.length} fragments (${result.junctions.length} junctions)`,
    };
  },
  execute: async (args) => {
    const a = parseAssembleGibsonArgs(args);
    if (a.sequenceIds.length < 2) {
      return { ok: false, error: "Gibson assembly needs at least two sequence ids, in join order." } satisfies AssembleGibsonResult;
    }

    // Re-read every fragment live, caching for any later describe pass.
    const details = new Map<number, SequenceDetail>();
    for (const id of a.sequenceIds) {
      const d = await cloningToolsDeps.getSequence(id);
      if (!d) return { ok: false, error: `Sequence id ${id} was not found in the library.` } satisfies AssembleGibsonResult;
      cacheSequenceDetail(d);
      details.set(id, d);
    }
    const built = detailsToFragments(a.sequenceIds, (id) => details.get(id) ?? null);
    if ("error" in built) return { ok: false, error: built.error } satisfies AssembleGibsonResult;

    const overlap: OverlapMode | undefined = a.overlapBp ? { kind: "length", bp: a.overlapBp } : undefined;
    const result = assembleGibson(built.fragments, { circular: a.circular, overlap });
    if (result.product.seq.length === 0) {
      return { ok: false, error: "The assembly produced an empty product. Check the fragments are not empty." } satisfies AssembleGibsonResult;
    }

    const name = a.name ?? "Gibson assembly";
    const genbank = productToGenbank(name, result.product, { primersAsFeatures: result.primers });
    if (!genbank) {
      return { ok: false, error: "Could not serialize the assembled construct to GenBank." } satisfies AssembleGibsonResult;
    }
    const saved = await cloningToolsDeps.createSequence({
      display_name: name,
      genbank,
      seq_type: "dna",
    });
    if (!saved) {
      return {
        ok: false,
        error: "The assembled construct could not be saved. The folder may not be connected.",
      } satisfies AssembleGibsonResult;
    }
    cloningToolsDeps.navigate(`/sequences?seq=${saved.id}`);
    return {
      ok: true,
      id: saved.id,
      display_name: saved.display_name,
      length: result.product.seq.length,
      circular: result.product.circular,
      junctions: result.junctions.length,
      warnings: result.warnings,
    } satisfies AssembleGibsonResult;
  },
};

// ===========================================================================
// digest_ligate  (ACTION, gated)
// ===========================================================================

export type DigestLigateArgs = {
  sequenceIds: number[];
  enzymes: string[];
  mode: "restriction" | "golden-gate";
  productIndex: number;
  name?: string;
};

export function parseDigestLigateArgs(args: Record<string, unknown>): DigestLigateArgs {
  const ids = Array.isArray(args.sequenceIds)
    ? args.sequenceIds
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.round(n))
    : [];
  const enzymes = Array.isArray(args.enzymes)
    ? args.enzymes.filter((e): e is string => typeof e === "string" && e.trim() !== "").map((e) => e.trim())
    : [];
  const mode: "restriction" | "golden-gate" = args.mode === "golden-gate" ? "golden-gate" : "restriction";
  const idx =
    typeof args.productIndex === "number" && Number.isFinite(args.productIndex) && args.productIndex >= 0
      ? Math.round(args.productIndex)
      : 0;
  return {
    sequenceIds: ids,
    enzymes,
    mode,
    productIndex: idx,
    name: typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : undefined,
  };
}

/** Build the engine LigateFragments from resolved details, carrying circularity
 *  and features. */
function detailsToLigateFragments(
  ids: number[],
  resolve: (id: number) => SequenceDetail | null,
): { fragments: LigateFragment[] } | { error: string } {
  const fragments: LigateFragment[] = [];
  for (const id of ids) {
    const detail = resolve(id);
    if (!detail) return { error: `Sequence id ${id} was not found in the library.` };
    fragments.push({
      name: detail.display_name,
      seq: detail.seq,
      circular: detail.circular,
      features: annotationsToCloneFeatures(detail.annotations),
    });
  }
  return { fragments };
}

export type DigestLigateResult =
  | {
      ok: true;
      id: number;
      display_name: string;
      length: number;
      circular: boolean;
      productCount: number;
      productIndex: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export const digestLigateTool: AiTool = {
  name: "digest_ligate",
  description:
    "Cut one or more library sequences with restriction enzyme(s) and ligate the resulting pieces into an assembled product. Set mode \"restriction\" for a classic cut-and-paste cloning (keeps every piece) or \"golden-gate\" for Type IIS / Golden Gate assembly (BsaI, BsmBI/Esp3I, BbsI, SapI; discards the recognition-bearing flanks and ligates the central parts seamlessly). Pass the enzyme name(s) as they appear in the enzyme dataset (for example \"ecori\", \"bamhi\", \"bsai\"). The engine digests, enumerates every distinct product (orientation-ambiguous overhangs can yield more than one), and rebases features into the product. When more than one product is possible the result lists them; pass productIndex to pick which one to save (default 0, the first by canonical order). The model NEVER computes an overhang or a product; the golden-tested engine does. The user sees an approval card naming the product before anything is written; that card IS the consent, do NOT call propose_plan for it. On Approve the chosen product is saved as a new sequence and the user is taken to it. Surface any warnings the engine returned (multiple products, no ligatable pieces, an unknown enzyme).",
  parameters: {
    type: "object",
    properties: {
      sequenceIds: {
        type: "array",
        items: { type: "number" },
        description: "The library sequence ids of the fragments / vectors to digest and ligate.",
      },
      enzymes: {
        type: "array",
        items: { type: "string" },
        description:
          'The restriction enzyme name(s) to digest with, as dataset keys (for example "ecori", "bamhi", "bsai"). For Golden Gate, one Type IIS enzyme (for example "bsai").',
      },
      mode: {
        type: "string",
        description:
          '"restriction" (classic cut-and-ligate, keeps all pieces, the default) or "golden-gate" (Type IIS, drops the recognition flanks and ligates the central parts seamlessly).',
      },
      productIndex: {
        type: "number",
        description:
          "Which product to save when more than one is possible (0-based, default 0). Run once with the default to see how many products the engine found, then re-run with a specific index if the user wants a different one.",
      },
      name: {
        type: "string",
        description: "Optional display name for the ligated product. Defaults to a mode-based name.",
      },
    },
    required: ["sequenceIds", "enzymes"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const a = parseDigestLigateArgs(args);
    if (a.sequenceIds.length === 0 || a.enzymes.length === 0) {
      return { summary: "digest and ligate sequences" };
    }
    const built = detailsToLigateFragments(a.sequenceIds, getCachedSequenceDetail);
    const modeLabel = a.mode === "golden-gate" ? "Golden Gate" : "restriction-ligation";
    if ("error" in built) {
      return { summary: `${modeLabel} of ${a.sequenceIds.length} sequences with ${a.enzymes.join(", ")}` };
    }
    const result = cutAndLigate(built.fragments, { enzymeNames: a.enzymes, mode: a.mode });
    if (result.products.length === 0) {
      return { summary: `${modeLabel} with ${a.enzymes.join(", ")} (no product yet, the card shows the outcome)` };
    }
    const chosen = result.products[Math.min(a.productIndex, result.products.length - 1)];
    const name = a.name ?? (a.mode === "golden-gate" ? "Golden Gate assembly" : "Ligation product");
    const topology = chosen.circular ? "circular" : "linear";
    const multi = result.products.length > 1 ? ` (1 of ${result.products.length} possible products)` : "";
    return {
      summary: `create sequence "${name}" — ${topology}, ${chosen.seq.length} bp by ${modeLabel}${multi}`,
    };
  },
  execute: async (args) => {
    const a = parseDigestLigateArgs(args);
    if (a.sequenceIds.length === 0) {
      return { ok: false, error: "Provide at least one sequence id to digest and ligate." } satisfies DigestLigateResult;
    }
    if (a.enzymes.length === 0) {
      return { ok: false, error: "Provide at least one enzyme name (for example \"ecori\" or \"bsai\")." } satisfies DigestLigateResult;
    }

    const details = new Map<number, SequenceDetail>();
    for (const id of a.sequenceIds) {
      const d = await cloningToolsDeps.getSequence(id);
      if (!d) return { ok: false, error: `Sequence id ${id} was not found in the library.` } satisfies DigestLigateResult;
      cacheSequenceDetail(d);
      details.set(id, d);
    }
    const built = detailsToLigateFragments(a.sequenceIds, (id) => details.get(id) ?? null);
    if ("error" in built) return { ok: false, error: built.error } satisfies DigestLigateResult;

    const result = cutAndLigate(built.fragments, { enzymeNames: a.enzymes, mode: a.mode });
    if (result.products.length === 0) {
      const reason = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
      return {
        ok: false,
        error: `The digest produced no assembled product.${reason}`,
      } satisfies DigestLigateResult;
    }
    if (a.productIndex >= result.products.length) {
      return {
        ok: false,
        error: `productIndex ${a.productIndex} is out of range; the engine found ${result.products.length} product(s) (indices 0..${result.products.length - 1}).`,
      } satisfies DigestLigateResult;
    }

    const chosen = result.products[a.productIndex];
    const name = a.name ?? (a.mode === "golden-gate" ? "Golden Gate assembly" : "Ligation product");
    // The LigationProduct shares the AssembledProduct's { seq, circular, features }
    // shape, so productToGenbank serializes it directly.
    const genbank = productToGenbank(name, {
      seq: chosen.seq,
      circular: chosen.circular,
      features: chosen.features,
    });
    if (!genbank) {
      return { ok: false, error: "Could not serialize the ligated product to GenBank." } satisfies DigestLigateResult;
    }
    const saved = await cloningToolsDeps.createSequence({
      display_name: name,
      genbank,
      seq_type: "dna",
    });
    if (!saved) {
      return {
        ok: false,
        error: "The ligated product could not be saved. The folder may not be connected.",
      } satisfies DigestLigateResult;
    }
    cloningToolsDeps.navigate(`/sequences?seq=${saved.id}`);
    return {
      ok: true,
      id: saved.id,
      display_name: saved.display_name,
      length: chosen.seq.length,
      circular: chosen.circular,
      productCount: result.products.length,
      productIndex: a.productIndex,
      warnings: result.warnings,
    } satisfies DigestLigateResult;
  },
};
