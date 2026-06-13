/**
 * Transparency-of-tests data model.
 *
 * Every value the /transparency page shows comes from `buildTransparencyReport()`
 * in `run.ts`, which executes a ResearchOS bioinformatic implementation against a
 * curated showcase case and compares the result to a pinned third-party oracle
 * value (Biopython, primer3). The same function backs both the page (server
 * component, build-time) and the gate test (`report.test.ts`, CI), so the page
 * can never advertise a comparison the test is not enforcing.
 *
 * No DOM, no React, no third-party deps. Pure data + pure functions only.
 */

/** Pass/warn/fail verdict for a single comparison against its oracle. */
export type Status = "pass" | "warn" | "fail";

/**
 * A third-party reference implementation we check ourselves against. The
 * provenance fields are what make the page honest: a reader can see exactly which
 * tool, which version, which published parameter set, and which committed script
 * produced the numbers, then reproduce them.
 */
export interface OracleRef {
  /** Short id used to key oracle metadata, e.g. "biopython", "primer3". */
  id: string;
  /** Display name, e.g. "Biopython". */
  name: string;
  /** Pinned version the golden values were generated against. */
  version: string;
  /** The specific module / function used, e.g. "Bio.SeqUtils.MeltingTemp.Tm_NN". */
  entrypoint: string;
  /** One-line published-method citation (author/year + table). */
  citation: string;
  /** Committed script that re-derives the pinned values (repo-relative). */
  generator: string;
  /** Optional URL to the tool's docs/source. */
  url?: string;
}

/**
 * A tolerance band: how close our value must be to the oracle to count as
 * agreement, and a short reason. A "tight" tolerance means a faithful port that
 * must match to floating-point precision (any miss is a bug). A "loose" tolerance
 * encodes a known, explained ecosystem difference (e.g. primer3 uses a different
 * nearest-neighbor table, so a small systematic offset is expected, not a bug).
 */
export interface Tolerance {
  /** Maximum |delta| that still counts as "pass". */
  pass: number;
  /** Maximum |delta| that counts as "warn" (above pass, at/below this). */
  warn: number;
  /** Unit label for the delta, e.g. "C", "bp", "%". */
  unit: string;
  /** Why this tolerance is what it is. Shown on the page. */
  rationale: string;
  /** "tight" = faithful-port parity; "loose" = explained ecosystem offset. */
  kind: "tight" | "loose";
}

/**
 * One scalar comparison: our number vs the oracle's number. Used for domains
 * whose headline result is a single value per case (Tm, fragment count, identity).
 * Domains with a richer visual carry that payload in `CaseResult.visual`.
 */
export interface ScalarComparison {
  /** Which oracle this comparison is against. */
  oracleId: string;
  /**
   * Optional metric name, for domains that compare several quantities against
   * one oracle (e.g. protein parameters: molecular weight, pI, GRAVY). When set,
   * tables show the metric rather than the oracle name.
   */
  metric?: string;
  /** The value ResearchOS computed. */
  ours: number;
  /** The pinned oracle value. */
  theirs: number;
  /** |ours - theirs|. */
  delta: number;
  /** Tolerance applied. */
  tolerance: Tolerance;
  /** Verdict from delta vs tolerance. */
  status: Status;
  /**
   * When true, this is a cross-method context comparison (e.g. our nearest-neighbor
   * Tm vs the simpler Wallace rule), shown to illustrate where methods legitimately
   * diverge. It is NOT a pass/fail validation: it does not gate the build and is not
   * counted in the exact/within-tolerance totals.
   */
  informational?: boolean;
}

/**
 * Domain-specific visual payloads carried on a case so the page can draw the
 * signature picture for that tool (an actual alignment, a homology map, a gel
 * ladder). Scalar domains (Tm) carry no visual and fall back to the agreement
 * scatter. Each variant is discriminated by `kind`.
 */
export type CaseVisual =
  | {
      kind: "alignment-columns";
      /** Gapped top strand (ResearchOS output). */
      alignedA: string;
      /** Gapped bottom strand. */
      alignedB: string;
      /** Mode label, e.g. "global" / "local". */
      mode: string;
    }
  | {
      kind: "homology-map";
      /** Length of sequence A (bp). */
      aLen: number;
      /** Length of sequence B (bp). */
      bLen: number;
      /** The recovered shared region. */
      region: {
        aStart: number;
        aEnd: number;
        bStart: number;
        bEnd: number;
        strand: 1 | -1;
        identity: number;
      };
    }
  | {
      kind: "fragment-ladder";
      /** Fragment sizes (bp) ResearchOS produced, descending. */
      ours: number[];
      /** Fragment sizes the oracle produced. */
      theirs: number[];
      /** Enzyme set applied. */
      enzymes: string[];
    }
  | {
      kind: "codon-track";
      /** The DNA codons in frame. */
      codons: string[];
      /** Our one-letter amino acids, aligned to codons. */
      ours: string;
      /** The oracle's one-letter amino acids. */
      theirs: string;
    }
  | {
      kind: "property-table";
      /** One row per computed property (e.g. molecular weight, pI). */
      rows: {
        metric: string;
        ours: number;
        theirs: number;
        delta: number;
        unit: string;
        status: Status;
      }[];
    }
  | {
      kind: "sequence-match";
      /** Assembly / reaction type, e.g. "Gateway LR", "Gibson". */
      method: string;
      /** Product length in bp. */
      length: number;
      /** Whether the product equals the published reference exactly. */
      matches: boolean;
      /** A short, readable slice of the product (head ... tail) for display. */
      preview: string;
    }
  | {
      kind: "domain-set";
      /**
       * The reconciled per-domain rows: each domain reported by native HMMER
       * (the oracle) paired with the on-device WASM engine's match. For a
       * faithful port the two columns are identical to the residue.
       */
      domains: {
        /** Pfam family accession (version stripped), e.g. "PF00069". */
        accession: string;
        /** Pfam family short name, e.g. "Pkinase". */
        name: string;
        /** Native HMMER envelope coords, or null if native did not report it. */
        native: { start: number; end: number } | null;
        /** On-device envelope coords, or null if the engine did not report it. */
        ours: { start: number; end: number } | null;
        /** True when family + envelope coordinates match exactly. */
        exact: boolean;
      }[];
      /** True for a negative control (both engines report zero domains). */
      negativeControl: boolean;
    }
  | {
      kind: "phylo-figures";
      /** Public path of the committed ggtree reference PNG, or null until the offline run lands. */
      ggtreeFigure: string | null;
      /** Tips matched by label between our layout and the ggtree golden. */
      matchedTips: number;
      /** Total tips in our layout. */
      ourTips: number;
      /** Absolute Spearman correlation of tip y-order (the gated, headline metric). */
      tipOrderAgreement: number;
      /** Pearson correlation of normalized node depth (x). */
      depthAgreement: number;
      /** True while the golden is still the shipped placeholder (no real ggtree run yet). */
      pending: boolean;
    }
  | {
      kind: "phylo-published";
      /** True while no offline recipe run has landed for this case yet. */
      pending: boolean;
      /** Why the case is pending, when it is (no published tree sourced, files from Dryad, etc.). */
      pendingReason: string | null;
      /** Provenance of the input the recipe ran on. */
      source: string;
      /** Citation (DOI / accession) of the published study. */
      citation: string;
      /** One-line summary of the generated recipe (the BuilderOptions). */
      recipeSummary: string;
      /** Free-text tool versions from the offline run, or null while pending. */
      toolVersions: string | null;
      /** Taxa shared between our result and the published tree (the comparison set). */
      sharedTaxa: number;
      /** Robinson-Foulds distance (count of bipartitions in exactly one tree). */
      rf: number;
      /** Maximum possible RF for this many shared taxa. */
      maxRf: number;
      /** rf / maxRf, in [0, 1]. The gated headline metric (lower is better). */
      normalizedRf: number;
      /** Published clades our result also recovers. */
      cladesRecovered: number;
      /** Total nontrivial clades in the published tree. */
      cladesTotal: number;
      /** 100 * cladesRecovered / cladesTotal. */
      percentRecovered: number;
      /** Published clades our result missed, canonical sorted tip-name side, capped for display. */
      missingFromOurs: string[][];
      /** Clades in our result not in the published tree, same form, capped for display. */
      extraInOurs: string[][];
      /** Our result tree as Newick for the side-by-side render, or null while pending. */
      oursNewick: string | null;
      /** The published tree as Newick for the side-by-side render, or null while pending. */
      publishedNewick: string | null;
    };

/** One showcase case within a domain (e.g. a single oligo, a single pair). */
export interface CaseResult {
  /** Stable id, e.g. "mid25_realistic". */
  id: string;
  /** Human label, e.g. "25-mer realistic primer". */
  label: string;
  /** The input as a readable string (sequence, pair, enzyme set, etc.). */
  input: string;
  /** Scalar comparisons for this case (one per oracle). */
  comparisons: ScalarComparison[];
  /** Worst status across this case's comparisons (drives the row pill). */
  status: Status;
  /** Optional domain-specific visual payload (alignment columns, bands, etc.). */
  visual?: CaseVisual;
}

/** A bioinformatic capability we expose and verify (Tm, alignment, ...). */
export interface DomainReport {
  /** Stable id, e.g. "tm". */
  id: string;
  /** Display title, e.g. "Primer melting temperature". */
  title: string;
  /** One-paragraph plain-language description of what the tool does. */
  summary: string;
  /** The ResearchOS module under test (repo-relative), shown for transparency. */
  impl: string;
  /** Oracles this domain is checked against. */
  oracles: OracleRef[];
  /** Per-case results. */
  cases: CaseResult[];
  /** Counts rolled up from cases. */
  totals: { pass: number; warn: number; fail: number };
  /** Worst status across all cases (drives the domain pill). */
  status: Status;
}

/** The whole page in one object. */
export interface TransparencyReport {
  /** ISO date the report shape/content was last meaningfully revised. */
  generatedNote: string;
  domains: DomainReport[];
  totals: { pass: number; warn: number; fail: number };
  status: Status;
}

/** Classify a |delta| against a tolerance band. */
export function classify(delta: number, tol: Tolerance): Status {
  if (delta <= tol.pass) return "pass";
  if (delta <= tol.warn) return "warn";
  return "fail";
}

/** The more severe of two statuses (fail > warn > pass). */
export function worst(a: Status, b: Status): Status {
  const rank: Record<Status, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** Roll a list of statuses up to one, plus counts. */
export function rollup(statuses: Status[]): {
  status: Status;
  totals: { pass: number; warn: number; fail: number };
} {
  const totals = { pass: 0, warn: 0, fail: 0 };
  let status: Status = "pass";
  for (const s of statuses) {
    totals[s] += 1;
    status = worst(status, s);
  }
  return { status, totals };
}
