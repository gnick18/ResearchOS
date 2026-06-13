/**
 * The single source of truth for the /transparency page.
 *
 * `buildTransparencyReport()` runs each ResearchOS bioinformatic implementation
 * against its curated showcase cases, compares every result to the pinned
 * third-party oracle value, and returns a fully classified report. The page
 * (server component) renders it at build time; the gate test (`report.test.ts`)
 * asserts every comparison is in tolerance. One function, two consumers, so the
 * page and the test can never disagree.
 *
 * Pure and deterministic: no DOM, no React, no network, no Python. Adding a new
 * domain = write a `datasets/<x>.ts`, a `build<X>Domain()` here, and register it
 * in `buildTransparencyReport()`.
 */

import { alignGlobal, alignLocal } from "@/lib/align/core";
import { findSharedRegions } from "@/lib/align/local-homology";
import { nearestNeighborTm } from "@/lib/calculators/tm-nn";
import { analyzeProtein, type ProteinResult } from "@/lib/calculators/protein";
import {
  describe as engineDescribe,
  unpairedTTest,
  unpairedTTestFromStats,
  pairedTTest,
  mannWhitneyU,
  wilcoxonSignedRank,
  oneWayAnova,
  oneWayAnovaFromStats,
  twoWayAnova,
  kruskalWallis,
  friedman,
  repeatedMeasuresAnova,
  randomInterceptModel,
  pearson,
  spearman,
  linearRegression,
  logisticRegression,
  rocAuc,
  multipleRegression,
  fitModel,
  fitGlobal,
  fivePLLogEC50Shift,
  extraSumOfSquaresF,
  aiccCompare,
  shapiroWilk,
  levene,
  brownForsythe,
  grubbsTest,
  kaplanMeier,
  logRank,
  gehanBreslowWilcoxon,
  coxPH,
  contingencyTest,
  percentileInterval,
  biasCorrection,
  jackknifeAcceleration,
  sampleMean,
  powerTwoSampleT,
  sampleSizeTwoSampleT,
} from "@/lib/datahub/engine";
import { qqPositions } from "@/lib/datahub/diagnostic-plot";
import { digestEnzymes, fragmentSizes } from "@/lib/sequences/enzyme-filters";
import { translate } from "@/vendor/seqviz/sequence";

import { HOMOLOGY_CASES, PAIRWISE_CASES } from "./datasets/alignment";
import { CALC_CASES } from "./datasets/calculators";
import { CLONING_CASES } from "./datasets/cloning";
import { DIGEST_CASES } from "./datasets/digest";
import {
  DOMAIN_PROTEINS,
  NATIVE_HMMER_VERSION,
  PFAM_FAMILIES,
  type PinnedDomain,
} from "./datasets/domains";
import {
  PROTEIN_CASES,
  PROTEIN_METRICS,
  type ProteinExpect,
} from "./datasets/protein";
import {
  PUBLISHED_DIGEST_CASES,
  PUBLISHED_QPCR_CASES,
  PUBLISHED_QPCR_CITATION,
  PUBLISHED_TRANSLATE_CASES,
  qpcrEfficiencyPercent,
} from "./datasets/published";
import {
  BOOT_ACCEL_SAMPLE,
  BOOT_DISTRIBUTION,
  BOOT_OBSERVED,
  BOOT_STATS,
  CONTINGENCY_2X2,
  CONTINGENCY_2X3,
  DOSE_LOG_CONC,
  DOSE_RESPONSE,
  GLOBAL_FIT_X,
  GLOBAL_FIT_YA,
  GLOBAL_FIT_YB,
  GROUP_A,
  GROUP_B,
  GROUP_C,
  KM_READ_TIMES,
  LOGIT_X,
  LOGIT_Y,
  MLR_X1,
  MLR_X2,
  MLR_Y,
  OUTLIER_SAMPLE,
  PAIR_X,
  PAIR_Y,
  POWER_ALPHA,
  POWER_TWO_SAMPLE_D,
  POWER_TWO_SAMPLE_N,
  REPEATED,
  REPEATED_LABELS,
  SAMPLESIZE_D,
  SAMPLESIZE_TARGET_POWER,
  STAT_PINS,
  SURV_CONTROL,
  SURV_TREAT,
  TWOWAY,
  XY_X,
  XY_Y,
  type StatPin,
} from "./datasets/datahub-stats";
import {
  PHYLO_CASES,
  allGoldensReady,
  comparePhyloLayout,
} from "./datasets/phylo-ggtree";
import { TM_CASES } from "./datasets/tm";
import { TRANSLATE_CASES } from "./datasets/translation";
import {
  BIOPYTHON,
  BIOPYTHON_ALIGN,
  BIOPYTHON_DIGEST,
  BIOPYTHON_PROTEIN,
  BIOPYTHON_TRANSLATE,
  EXACT_DEFINITIONS,
  GC_RULE,
  GENBANK_TRANSLATION,
  LIFELINES,
  NATIVE_HMMER,
  ORACLES,
  PRIMER3,
  PUBLISHED_QPCR,
  REFERENCE_GENOME_DIGEST,
  SCIPY,
  SKLEARN,
  STATSMODELS,
  WALLACE,
  GGTREE,
} from "./oracles";
import {
  classify,
  rollup,
  type CaseResult,
  type DomainReport,
  type ScalarComparison,
  type Status,
  type Tolerance,
  type TransparencyReport,
} from "./types";

/** Drop informational (cross-method context) comparisons from gated rollups. */
function gated(cmps: ScalarComparison[]): ScalarComparison[] {
  return cmps.filter((c) => !c.informational);
}

/* ---------------------------------------------------------------- Tm domain */

/** Faithful-port parity with Biopython: must match to floating point. */
const TM_TIGHT: Tolerance = {
  pass: 0.05,
  warn: 0.5,
  unit: "C",
  kind: "tight",
  rationale:
    "Our calculator is a line-by-line port of Biopython Tm_NN with the same "
    + "nearest-neighbor table (DNA_NN3) and salt model, so the two must agree to "
    + "floating-point precision. Anything above 0.05 C would be a port bug.",
};

/** Loose ecosystem cross-check with primer3 (different table, expected offset). */
const TM_LOOSE: Tolerance = {
  pass: 3.0,
  warn: 4.0,
  unit: "C",
  kind: "loose",
  rationale:
    "primer3 uses the SantaLucia 1998 unified table and its own salt model "
    + "instead of the Allawi 1997 table we share with Biopython, so a small "
    + "systematic offset (largest on GC-terminal oligos) is expected, not a bug.",
};

/** Cross-method context (Wallace / GC rules): expected to diverge, not gated. */
const TM_METHOD: Tolerance = {
  pass: 2.0,
  warn: 8.0,
  unit: "C",
  kind: "loose",
  rationale:
    "The Wallace 2+4 rule and the GC-percent rule are simpler Tm estimators that "
    + "ignore sequence context, so they diverge from nearest-neighbor by several "
    + "degrees (the Wallace rule is unbounded and only valid for short oligos). "
    + "Shown as context, not as a target ResearchOS is expected to match.",
};

function buildTmDomain(): DomainReport {
  const cases: CaseResult[] = TM_CASES.map((c) => {
    const r = nearestNeighborTm(c.seq, c.opts);
    if (!r) {
      throw new Error(`transparency: nearestNeighborTm returned null for ${c.id}`);
    }
    const ours = round(r.tm, 4);

    const comparisons: ScalarComparison[] = [];

    const bioDelta = round(Math.abs(ours - c.bioTm), 4);
    comparisons.push({
      oracleId: BIOPYTHON.id,
      ours,
      theirs: c.bioTm,
      delta: bioDelta,
      tolerance: TM_TIGHT,
      status: classify(bioDelta, TM_TIGHT),
    });

    if (c.p3Tm !== undefined) {
      const p3Delta = round(Math.abs(ours - c.p3Tm), 4);
      comparisons.push({
        oracleId: PRIMER3.id,
        ours,
        theirs: c.p3Tm,
        delta: p3Delta,
        tolerance: TM_LOOSE,
        status: classify(p3Delta, TM_LOOSE),
      });
    }

    // Cross-method context: informational, not gated.
    for (const [val, oracleId] of [
      [c.wallaceTm, WALLACE.id],
      [c.gcTm, GC_RULE.id],
    ] as const) {
      if (val === undefined) continue;
      const d = round(Math.abs(ours - val), 4);
      comparisons.push({
        oracleId,
        ours,
        theirs: val,
        delta: d,
        tolerance: TM_METHOD,
        status: classify(d, TM_METHOD),
        informational: true,
      });
    }

    const { status } = rollup(gated(comparisons).map((cmp) => cmp.status));
    return {
      id: c.id,
      label: c.label,
      input: c.seq,
      comparisons,
      status,
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => gated(c.comparisons).map((cmp) => cmp.status)),
  );

  return {
    id: "tm",
    title: "Primer melting temperature (Tm)",
    summary:
      "Melting temperature is computed from nearest-neighbor thermodynamics "
      + "(Allawi and SantaLucia 1997 parameters with the SantaLucia 1998 entropy "
      + "salt correction) given the primer sequence, monovalent and divalent ion "
      + "concentrations, and oligo concentration. Values are compared against "
      + "Biopython Tm_NN under identical parameters and against primer3. The "
      + "simpler Wallace and GC-percent rules are shown as context, to make the "
      + "spread between Tm methods visible.",
    impl: "frontend/src/lib/calculators/tm-nn.ts",
    oracles: [BIOPYTHON, PRIMER3, WALLACE, GC_RULE],
    cases,
    totals,
    status,
  };
}

/* -------------------------------------------------------- alignment domain */

/** Affine-Gotoh optimal score is an exact integer; Biopython reproduces it. */
const ALIGN_SCORE: Tolerance = {
  pass: 0.5,
  warn: 1.5,
  unit: "score",
  kind: "tight",
  rationale:
    "Under identical scoring (DNA match +2, mismatch -1, gap open 5, extend 1) "
    + "our affine-gap dynamic program and Biopython's PairwiseAligner find the "
    + "same optimal score exactly, so the only passing delta is zero.",
};

/** Long-homology identity: our seed-and-extend finder is approximate. */
const ALIGN_IDENTITY: Tolerance = {
  pass: 0.085,
  warn: 0.3,
  unit: "identity",
  kind: "loose",
  rationale:
    "Our shared-region finder is a BLAST-style seed-and-extend, not an exact "
    + "local aligner. It recovers the homologous block but reports identity a few "
    + "percent below Biopython's exact local alignment because it includes some "
    + "boundary bases, and the gap grows on shorter blocks. This is a real, "
    + "expected limitation of the approximate method, not a bug.",
};

function buildAlignmentDomain(): DomainReport {
  const cases: CaseResult[] = [];

  for (const c of PAIRWISE_CASES) {
    const r = c.mode === "global" ? alignGlobal(c.a, c.b) : alignLocal(c.a, c.b);
    const ours = r.score;
    const delta = round(Math.abs(ours - c.bioScore), 4);
    const status = classify(delta, ALIGN_SCORE);
    cases.push({
      id: c.id,
      label: c.label,
      input: `${c.a} vs ${c.b}`,
      comparisons: [
        {
          oracleId: BIOPYTHON_ALIGN.id,
          ours,
          theirs: c.bioScore,
          delta,
          tolerance: ALIGN_SCORE,
          status,
        },
      ],
      status,
      visual: {
        kind: "alignment-columns",
        alignedA: r.alignedA,
        alignedB: r.alignedB,
        mode: c.mode,
      },
    });
  }

  for (const c of HOMOLOGY_CASES) {
    const { a, b } = c.build();
    const result = findSharedRegions(a, b);
    const top = result.hsps[0];
    if (!top) {
      throw new Error(`transparency: findSharedRegions found no region for ${c.id}`);
    }
    const ours = round(top.identity, 4);
    const delta = round(Math.abs(ours - c.bioIdentity), 4);
    const status = classify(delta, ALIGN_IDENTITY);
    cases.push({
      id: c.id,
      label: c.label,
      input: `A ${a.length.toLocaleString()} bp vs B ${b.length.toLocaleString()} bp`,
      comparisons: [
        {
          oracleId: BIOPYTHON_ALIGN.id,
          ours,
          theirs: c.bioIdentity,
          delta,
          tolerance: ALIGN_IDENTITY,
          status,
        },
      ],
      status,
      visual: {
        kind: "homology-map",
        aLen: a.length,
        bLen: b.length,
        region: {
          aStart: top.aStart,
          aEnd: top.aEnd,
          bStart: top.bStart,
          bEnd: top.bEnd,
          strand: top.strand,
          identity: ours,
        },
      },
    });
  }

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "alignment",
    title: "Sequence alignment",
    summary:
      "Global and local pairwise alignment use an affine-gap (Gotoh) dynamic "
      + "program with IUPAC-aware DNA scoring. Homology between long sequences is "
      + "detected by seed-and-extend. Optimal alignment scores and recovered-region "
      + "percent identity are compared against Biopython.",
    impl: "frontend/src/lib/align/",
    oracles: [BIOPYTHON_ALIGN],
    cases,
    totals,
    status,
  };
}

/* ---------------------------------------------------------- digest domain */

/** A digest is right only if every band matches; the passing delta is zero. */
const DIGEST_BANDS: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "bands",
  kind: "tight",
  rationale:
    "Cut sites and fragment sizes are exact integers. ResearchOS and Biopython "
    + "scan both strands over the same topology, so every band must match. Any "
    + "mismatched band is a failure, not a tolerance.",
};

/** Number of bands that differ between two fragment-size multisets. */
function bandMismatch(ours: number[], theirs: number[]): number {
  const freq = new Map<number, number>();
  for (const x of ours) freq.set(x, (freq.get(x) ?? 0) + 1);
  for (const x of theirs) freq.set(x, (freq.get(x) ?? 0) - 1);
  let diff = 0;
  for (const v of freq.values()) diff += Math.abs(v);
  return diff;
}

function buildDigestDomain(): DomainReport {
  const cases: CaseResult[] = DIGEST_CASES.map((c) => {
    const [d] = digestEnzymes(c.seq, "dna", [c.enzymeKey]);
    const cuts = d
      ? Array.from(new Set(d.cuts.map((cut) => cut.position))).sort((a, b) => a - b)
      : [];
    const ourFragments = fragmentSizes(cuts, c.seq.length, c.circular);

    const delta = bandMismatch(ourFragments, c.bioFragments);
    const status = classify(delta, DIGEST_BANDS);

    return {
      id: c.id,
      label: c.label,
      input: `${c.enzymeName} on ${c.seq.length} bp ${c.circular ? "circular" : "linear"}`,
      comparisons: [
        {
          oracleId: BIOPYTHON_DIGEST.id,
          ours: ourFragments.length,
          theirs: c.bioFragments.length,
          delta,
          tolerance: DIGEST_BANDS,
          status,
        },
      ],
      status,
      visual: {
        kind: "fragment-ladder",
        ours: ourFragments,
        theirs: c.bioFragments,
        enzymes: [c.enzymeName],
      },
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "digest",
    title: "Restriction digest",
    summary:
      "Restriction sites are located on both strands for linear and circular "
      + "sequences, including sites spanning the origin of a plasmid, and fragment "
      + "lengths are derived from the cut positions. The complete fragment-size "
      + "pattern is compared against Biopython Bio.Restriction.",
    impl: "frontend/src/lib/sequences/enzyme-filters.ts",
    oracles: [BIOPYTHON_DIGEST],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------------ translation domain */

/** The genetic code is a fixed lookup; every residue must match Biopython. */
const TRANSLATE_RES: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "residues",
  kind: "tight",
  rationale:
    "Frame-1 translation under the standard NCBI table is a deterministic codon "
    + "lookup, including IUPAC-degenerate resolution and trailing-codon "
    + "truncation, so ResearchOS must reproduce Biopython residue for residue.",
};

/** Count residues that differ between two protein strings (length-aware). */
function residueMismatch(ours: string, theirs: string): number {
  const n = Math.max(ours.length, theirs.length);
  let diff = 0;
  for (let i = 0; i < n; i++) {
    if (ours[i] !== theirs[i]) diff += 1;
  }
  return diff;
}

/** Split a DNA sequence into full codons (drops a trailing partial codon). */
function codons(seq: string): string[] {
  const s = seq.toUpperCase().replace(/U/g, "T");
  const out: string[] = [];
  for (let i = 0; i + 3 <= s.length; i += 3) out.push(s.slice(i, i + 3));
  return out;
}

function buildTranslationDomain(): DomainReport {
  const cases: CaseResult[] = TRANSLATE_CASES.map((c) => {
    const ours = translate(c.seq, "dna");
    const delta = residueMismatch(ours, c.bioProtein);
    const status = classify(delta, TRANSLATE_RES);

    return {
      id: c.id,
      label: c.label,
      input: c.seq,
      comparisons: [
        {
          oracleId: BIOPYTHON_TRANSLATE.id,
          ours: ours.length,
          theirs: c.bioProtein.length,
          delta,
          tolerance: TRANSLATE_RES,
          status,
        },
      ],
      status,
      visual: {
        kind: "codon-track",
        codons: codons(c.seq),
        ours,
        theirs: c.bioProtein,
      },
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "translation",
    title: "Translation",
    summary:
      "DNA is translated in frame 1 under the standard genetic code (NCBI table "
      + "1). IUPAC-degenerate codons are resolved where they specify a single "
      + "amino acid, and a trailing partial codon is dropped. Each residue is "
      + "compared against Biopython Seq.translate.",
    impl: "frontend/src/vendor/seqviz/sequence.ts",
    oracles: [BIOPYTHON_TRANSLATE],
    cases,
    totals,
    status,
  };
}

/* ---------------------------------------------------------- protein domain */

/** Pull each golden metric from a ProteinResult. */
const PROTEIN_GET: Record<keyof ProteinExpect, (r: ProteinResult) => number> = {
  mw: (r) => r.molecularWeight,
  pi: (r) => r.isoelectricPoint,
  epsReduced: (r) => r.extinctionReduced,
  epsOxidized: (r) => r.extinctionOxidized,
  instability: (r) => r.instabilityIndex,
  gravy: (r) => r.gravy,
  aliphatic: (r) => r.aliphaticIndex,
};

function buildProteinDomain(): DomainReport {
  const cases: CaseResult[] = PROTEIN_CASES.map((c) => {
    const r = analyzeProtein(c.seq);
    if (!r) throw new Error(`transparency: analyzeProtein returned null for ${c.id}`);

    const comparisons: ScalarComparison[] = [];
    const rows: {
      metric: string;
      ours: number;
      theirs: number;
      delta: number;
      unit: string;
      status: Status;
    }[] = [];

    for (const m of PROTEIN_METRICS) {
      const ours = round(PROTEIN_GET[m.key](r), 4);
      const theirs = c.bio[m.key];
      const delta = round(Math.abs(ours - theirs), 4);
      const tol: Tolerance = {
        pass: m.pass,
        warn: m.warn,
        unit: m.unit,
        kind: "tight",
        rationale:
          "ResearchOS ports the Biopython ProtParam algorithm with its verbatim "
          + "constant tables, so this value must match Biopython to floating-point "
          + "precision.",
      };
      const status = classify(delta, tol);
      comparisons.push({ oracleId: BIOPYTHON_PROTEIN.id, metric: m.label, ours, theirs, delta, tolerance: tol, status });
      rows.push({ metric: m.label, ours, theirs, delta, unit: m.unit, status });
    }

    const { status } = rollup(comparisons.map((cmp) => cmp.status));
    return {
      id: c.id,
      label: c.label,
      input: c.seq,
      comparisons,
      status,
      visual: { kind: "property-table", rows },
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "protein",
    title: "Protein parameters",
    summary:
      "From a protein sequence ResearchOS computes molecular weight, isoelectric "
      + "point, molar extinction coefficient (and the A280 of a 1 g/L solution), "
      + "the Guruprasad instability index, Kyte-Doolittle GRAVY, and the Ikai "
      + "aliphatic index. Each is compared against Biopython ProtParam, the engine "
      + "behind the ExPASy ProtParam web tool.",
    impl: "frontend/src/lib/calculators/protein.ts",
    oracles: [BIOPYTHON_PROTEIN],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------------ calculators domain */

function buildCalculatorsDomain(): DomainReport {
  const cases: CaseResult[] = CALC_CASES.map((c) => {
    const raw = c.compute();
    if (raw == null || !Number.isFinite(raw)) {
      throw new Error(`transparency: calculator returned null for ${c.id}`);
    }
    const deltaFull = Math.abs(raw - c.oracle);
    const tol: Tolerance = {
      pass: Math.max(Math.abs(c.oracle) * 1e-9, 1e-12),
      warn: Math.max(Math.abs(c.oracle) * 1e-6, 1e-9),
      unit: c.unit,
      kind: "tight",
      rationale:
        "The result follows from exact algebra (molarity, C1V1 = C2V2, serial "
        + "dilution) and the cited average-mass and spectrophotometry constants, "
        + "so it must reproduce the closed-form value to floating-point precision.",
    };
    const status = classify(deltaFull, tol);

    return {
      id: c.id,
      label: c.label,
      input: c.input,
      comparisons: [
        {
          oracleId: EXACT_DEFINITIONS.id,
          ours: round(raw, 4),
          theirs: round(c.oracle, 4),
          delta: round(deltaFull, 6),
          tolerance: tol,
          status,
        },
      ],
      status,
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "calculators",
    title: "Lab calculators",
    summary:
      "Molarity, dilution (C1V1 = C2V2), serial dilution, nucleic-acid mass-to-mole "
      + "conversion, and concentration from A260. These follow from exact algebra "
      + "and cited constants (average nucleotide masses 650 and 330 g/mol per base, "
      + "and the 50, 33, and 40 ng/uL per A260 spectrophotometry factors) rather "
      + "than a peer software package, so each result is checked against its "
      + "closed-form value.",
    impl: "frontend/src/lib/calculators/calculators.ts",
    oracles: [EXACT_DEFINITIONS],
    cases,
    totals,
    status,
  };
}

/* --------------------------------------------------------- cloning domain */

/** A cloning product is correct only if it equals the expected molecule exactly. */
const CLONING_MATCH: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "match",
  kind: "tight",
  rationale:
    "Assembled products are compared as canonical circular molecules (rotation "
    + "and strand invariant). The product either equals the one the oracle "
    + "reports or it does not; there is no partial credit.",
};

/** Short head ... tail preview of a sequence for the card. */
function previewSeq(seq: string): string {
  if (seq.length <= 44) return seq;
  return `${seq.slice(0, 22)} ... ${seq.slice(-18)}`;
}

function buildCloningDomain(): DomainReport {
  const cases: CaseResult[] = CLONING_CASES.map((c) => {
    const { product, expected } = c.build();
    const matches = product !== null && product === expected;
    const delta = matches ? 0 : 1;
    const status = classify(delta, CLONING_MATCH);

    return {
      id: c.id,
      label: c.label,
      input: c.method,
      comparisons: [
        {
          oracleId: c.oracleId,
          ours: product ? product.length : 0,
          theirs: expected.length,
          delta,
          tolerance: CLONING_MATCH,
          status,
        },
      ],
      status,
      visual: {
        kind: "sequence-match",
        method: c.method,
        length: expected.length,
        matches,
        preview: previewSeq(expected),
      },
    };
  });

  const oracleIds = Array.from(new Set(CLONING_CASES.map((c) => c.oracleId)));
  const oracles = oracleIds.map((id) => ORACLES[id]).filter(Boolean);

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "cloning",
    title: "Cloning assembly",
    summary:
      "ResearchOS simulates restriction-ligation, Type IIS Golden Gate assembly, "
      + "and Gateway recombination, then reports the assembled construct. The "
      + "restriction and Golden Gate products are compared against pydna, an "
      + "established in-silico cloning package, and the Gateway product against "
      + "the published attB site sequence.",
    impl: "frontend/src/lib/sequences/cut-ligate.ts, cloning-gateway.ts",
    oracles,
    cases,
    totals,
    status,
  };
}

/* --------------------------------------------------------- domains domain */

/**
 * Domain annotation is a faithful WASM port of native HMMER, so it must match to
 * the residue. The unit is "domains": a protein passes only when the on-device
 * engine reproduces every native domain (same family, same envelope coordinates)
 * with no spurious extras, so the only passing delta is zero.
 */
const DOMAINS_EXACT: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "domains",
  kind: "tight",
  rationale:
    "The on-device engine is the same HMMER algorithm compiled to WebAssembly, "
    + "run against the identical Pfam subset, so it must reproduce native HMMER "
    + "exactly: the same families at the same envelope coordinates to the residue. "
    + "Any drift is a port bug, not a tolerance to relax. A negative control "
    + "passes only when both engines report zero domains.",
};

/** Stable key for one domain (family + exact envelope span). */
function domainKey(d: PinnedDomain): string {
  return `${d.accession}:${d.start}-${d.end}`;
}

/**
 * Reconcile the native (golden) and on-device (ours) domain sets for one protein
 * into side-by-side rows, and count how many golden domains are reproduced
 * exactly. The number of mismatched rows (a golden domain not reproduced, or a
 * spurious extra from our engine) is the delta against DOMAINS_EXACT.
 */
function reconcileDomains(golden: PinnedDomain[], ours: PinnedDomain[]) {
  const oursByKey = new Map<string, PinnedDomain>();
  for (const d of ours) oursByKey.set(domainKey(d), d);
  const goldenKeys = new Set(golden.map(domainKey));

  const rows: {
    accession: string;
    name: string;
    native: { start: number; end: number } | null;
    ours: { start: number; end: number } | null;
    exact: boolean;
  }[] = [];

  // Every golden domain, paired with its exact on-device match if present.
  let matched = 0;
  for (const g of golden) {
    const o = oursByKey.get(domainKey(g));
    const exact = o !== undefined;
    if (exact) matched += 1;
    rows.push({
      accession: g.accession,
      name: g.name,
      native: { start: g.start, end: g.end },
      ours: o ? { start: o.start, end: o.end } : null,
      exact,
    });
  }

  // Any on-device domain with no exact golden counterpart is a spurious extra.
  let spurious = 0;
  for (const o of ours) {
    if (!goldenKeys.has(domainKey(o))) {
      spurious += 1;
      rows.push({
        accession: o.accession,
        name: o.name,
        native: null,
        ours: { start: o.start, end: o.end },
        exact: false,
      });
    }
  }

  rows.sort((a, b) => {
    const as = a.native?.start ?? a.ours?.start ?? 0;
    const bs = b.native?.start ?? b.ours?.start ?? 0;
    return as - bs || a.accession.localeCompare(b.accession);
  });

  // Delta = golden domains not reproduced + spurious extras. Zero = exact parity.
  const delta = golden.length - matched + spurious;
  return { rows, matched, expected: golden.length, delta };
}

function buildDomainsDomain(): DomainReport {
  const cases: CaseResult[] = DOMAIN_PROTEINS.map((p) => {
    const { rows, matched, expected, delta } = reconcileDomains(p.golden, p.ours);
    const status = classify(delta, DOMAINS_EXACT);

    const input = p.negative
      ? `${p.acc} (negative control, no Pfam domain in subset)`
      : `${p.acc} (${expected} domain${expected === 1 ? "" : "s"})`;

    return {
      id: p.acc,
      label: p.label,
      input,
      comparisons: [
        {
          oracleId: NATIVE_HMMER.id,
          // Matched-of-expected on-device domains vs the native count.
          ours: matched,
          theirs: expected,
          delta,
          tolerance: DOMAINS_EXACT,
          status,
        },
      ],
      status,
      visual: {
        kind: "domain-set",
        domains: rows,
        negativeControl: p.negative,
      },
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  const posCount = DOMAIN_PROTEINS.filter((p) => !p.negative).length;
  const negCount = DOMAIN_PROTEINS.filter((p) => p.negative).length;

  return {
    id: "domains",
    title: "Protein domain annotation",
    summary:
      "The on-device domain search is HMMER compiled to WebAssembly, the same "
      + `profile-HMM algorithm as the reference tool (HMMER ${NATIVE_HMMER_VERSION}), `
      + "and it runs entirely in your browser. Each of "
      + `${posCount} diverse proteins (kinases, GPCRs, zinc fingers, immunoglobulin `
      + "and globin folds, RRMs, WD40 repeats, multi-domain adaptors, tandem "
      + `ubiquitin, plus ${negCount} negative controls) is annotated by both the `
      + `in-browser engine and native HMMER over an identical curated Pfam subset `
      + `(${PFAM_FAMILIES.length} families). The two are compared family by family `
      + "at exact envelope coordinates: the in-browser engine reproduces every "
      + "native domain to the residue, and reports no domain on the negative "
      + "controls. This isolates the WebAssembly port (the part a user would "
      + "reasonably doubt) with no database or coordinate noise.",
    impl: "frontend/public/hmmer/hmmsearch.js, frontend/src/lib/sequences/hmmer-domtbl.ts",
    oracles: [NATIVE_HMMER],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------------- published domain */

/** A record-annotated protein is a fixed string; every residue must match. */
const PUBLISHED_TRANSLATE_RES: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "residues",
  kind: "tight",
  rationale:
    "The protein is the one the GenBank record annotates for its own coding "
    + "sequence. Translating that CDS under the standard genetic code is a fixed "
    + "codon lookup, so ResearchOS must reproduce the record's protein residue for "
    + "residue.",
};

/** A genome digest is right only when every band matches; passing delta is zero. */
const PUBLISHED_DIGEST_BANDS: Tolerance = {
  pass: 0,
  warn: 0,
  unit: "bands",
  kind: "tight",
  rationale:
    "Fragment sizes from a published reference sequence are exact integers. Our "
    + "digest scans both strands over the same topology, so every band must match "
    + "the pattern computed from the deposited record.",
};

/** Efficiency is recomputed from the slope; must match the paper to its rounding. */
const PUBLISHED_QPCR_PCT: Tolerance = {
  pass: 0.5,
  warn: 0.9,
  unit: "%",
  kind: "tight",
  rationale:
    "Amplification efficiency follows from the standard-curve slope by "
    + "efficiency% = (10^(-1/slope) - 1) * 100. The paper reports each efficiency "
    + "to the whole percent, so our value must land within that rounding (under "
    + "half a percent) of the published number.",
};

function buildPublishedDomain(): DomainReport {
  const cases: CaseResult[] = [];

  // Translation against the GenBank record's own annotated protein.
  for (const c of PUBLISHED_TRANSLATE_CASES) {
    const ours = translate(c.seq, "dna");
    const delta = residueMismatch(ours, c.protein);
    const status = classify(delta, PUBLISHED_TRANSLATE_RES);
    cases.push({
      id: c.id,
      label: c.label,
      input: `${c.accession} CDS ${c.cds} (${c.protein.length} aa)`,
      comparisons: [
        {
          oracleId: GENBANK_TRANSLATION.id,
          metric: c.accession,
          ours: ours.length,
          theirs: c.protein.length,
          delta,
          tolerance: PUBLISHED_TRANSLATE_RES,
          status,
        },
      ],
      status,
      visual: {
        kind: "codon-track",
        codons: codons(c.seq),
        ours,
        theirs: c.protein,
      },
    });
  }

  // Restriction digest of a published reference genome.
  for (const c of PUBLISHED_DIGEST_CASES) {
    const [d] = digestEnzymes(c.seq, "dna", [c.enzymeKey]);
    const cuts = d
      ? Array.from(new Set(d.cuts.map((cut) => cut.position))).sort((a, b) => a - b)
      : [];
    const ourFragments = fragmentSizes(cuts, c.seq.length, c.circular);
    const delta = bandMismatch(ourFragments, c.fragments);
    const status = classify(delta, PUBLISHED_DIGEST_BANDS);
    cases.push({
      id: c.id,
      label: c.label,
      input: `${c.enzymeName} on ${c.accession} (${c.seq.length.toLocaleString()} bp ${c.circular ? "circular" : "linear"})`,
      comparisons: [
        {
          oracleId: REFERENCE_GENOME_DIGEST.id,
          metric: c.accession,
          ours: ourFragments.length,
          theirs: c.fragments.length,
          delta,
          tolerance: PUBLISHED_DIGEST_BANDS,
          status,
        },
      ],
      status,
      visual: {
        kind: "fragment-ladder",
        ours: ourFragments,
        theirs: c.fragments,
        enzymes: [c.enzymeName],
      },
    });
  }

  // RT-qPCR amplification efficiency from a published standard-curve slope.
  for (const c of PUBLISHED_QPCR_CASES) {
    const ours = round(qpcrEfficiencyPercent(c.slope), 4);
    const delta = round(Math.abs(ours - c.reportedPercent), 4);
    const status = classify(delta, PUBLISHED_QPCR_PCT);
    cases.push({
      id: c.id,
      label: c.label,
      input: `slope ${c.slope} reported as ${c.reportedPercent}% efficiency`,
      comparisons: [
        {
          oracleId: PUBLISHED_QPCR.id,
          metric: `slope ${c.slope}`,
          ours,
          theirs: c.reportedPercent,
          delta,
          tolerance: PUBLISHED_QPCR_PCT,
          status,
        },
      ],
      status,
    });
  }

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "published",
    title: "Validated against published results",
    summary:
      "Beyond matching peer software under identical settings, ResearchOS "
      + "reproduces values that already exist in the published record. It "
      + "translates the coding sequences of two GenBank records (human insulin "
      + "NM_000207.3 and EGFP U55762) to the exact proteins those records annotate, "
      + "digests two reference sequences (the pUC19 cloning vector L09137 and the "
      + "bacteriophage lambda genome J02459) to the fragment patterns the deposited "
      + "sequences yield, and recomputes RT-qPCR amplification efficiencies from the "
      + "standard-curve slopes reported in a peer-reviewed SARS-CoV-2 wastewater "
      + `surveillance paper (${PUBLISHED_QPCR_CITATION}). Every reference value is `
      + "transcribed verbatim from the cited record or paper, so each row can be "
      + "checked against the original source.",
    impl:
      "frontend/src/vendor/seqviz/sequence.ts, frontend/src/lib/sequences/enzyme-filters.ts",
    oracles: [GENBANK_TRANSLATION, REFERENCE_GENOME_DIGEST, PUBLISHED_QPCR],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------- Data Hub statistics domain */

/**
 * Run the Data Hub statistics engine on the single fixed dataset and return a map
 * from pin id to the engine's computed value. This is the "OURS" side of every
 * comparison; the pinned `reference` in datahub-stats.ts is the scipy /
 * statsmodels / lifelines side. Throws if any engine call fails on the dataset,
 * since that would itself be a regression the gate must catch.
 */
function runDatahubEngine(): Record<string, number> {
  const need = <T extends { ok: boolean }>(
    r: T,
    what: string,
  ): Extract<T, { ok: true }> => {
    if (!r.ok) {
      throw new Error(`transparency: datahub engine failed on ${what}`);
    }
    return r as Extract<T, { ok: true }>;
  };

  const welch = need(unpairedTTest(GROUP_A, GROUP_B), "Welch t-test");
  const student = need(
    unpairedTTest(GROUP_A, GROUP_B, { variance: "student" }),
    "Student t-test",
  );
  const paired = need(pairedTTest(PAIR_X, PAIR_Y), "paired t-test");
  const mwu = need(mannWhitneyU(GROUP_A, GROUP_B), "Mann-Whitney U");
  const wil = need(wilcoxonSignedRank(PAIR_X, PAIR_Y), "Wilcoxon signed-rank");
  const aov1 = need(
    oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C }, { postHoc: "tukey" }),
    "one-way ANOVA",
  );

  // Selectable PARAMETER options. Each runs the engine with the option a user
  // could pick, so the same gate that protects the defaults protects every
  // option. One-sided tails on each two-group test, and the non-Tukey ANOVA
  // post-hoc families. The default-option runs above already cover two-sided
  // and Student variance.
  const welchGreater = need(
    unpairedTTest(GROUP_A, GROUP_B, { tail: "greater" }),
    "Welch t-test (greater)",
  );
  const welchLess = need(
    unpairedTTest(GROUP_A, GROUP_B, { tail: "less" }),
    "Welch t-test (less)",
  );
  const pairedGreater = need(
    pairedTTest(PAIR_X, PAIR_Y, { tail: "greater" }),
    "paired t-test (greater)",
  );
  const pairedLess = need(
    pairedTTest(PAIR_X, PAIR_Y, { tail: "less" }),
    "paired t-test (less)",
  );
  const mwuGreater = need(
    mannWhitneyU(GROUP_A, GROUP_B, { tail: "greater" }),
    "Mann-Whitney U (greater)",
  );
  const mwuLess = need(
    mannWhitneyU(GROUP_A, GROUP_B, { tail: "less" }),
    "Mann-Whitney U (less)",
  );
  const wilGreater = need(
    wilcoxonSignedRank(PAIR_X, PAIR_Y, { tail: "greater" }),
    "Wilcoxon signed-rank (greater)",
  );
  const wilLess = need(
    wilcoxonSignedRank(PAIR_X, PAIR_Y, { tail: "less" }),
    "Wilcoxon signed-rank (less)",
  );
  const aovSidak = need(
    oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C }, { postHoc: "sidak" }),
    "one-way ANOVA (Sidak)",
  );
  const aovBonf = need(
    oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C }, { postHoc: "bonferroni" }),
    "one-way ANOVA (Bonferroni)",
  );
  const aovHolm = need(
    oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C }, { postHoc: "holm-sidak" }),
    "one-way ANOVA (Holm-Sidak)",
  );
  // The A vs C adjusted p out of a post-hoc comparison set.
  const acAdj = (comps: typeof aov1.comparisons): number => {
    const c = comps.find(
      (x) =>
        [x.groupA, x.groupB].sort().join("__") === "A__C",
    );
    if (!c) throw new Error("transparency: post-hoc A vs C comparison missing");
    return c.pAdjusted;
  };
  // From-summary-stats paths. We compute the summary (mean / SD / n) of the same
  // raw groups with the engine's own describe, then feed it to the from-stats
  // tests, so the gate proves the from-stats engine reproduces the scipy
  // ttest_ind_from_stats / f_oneway reference on this fixed dataset.
  const summ = (values: number[]): { mean: number; sd: number; n: number } => {
    const d = need(engineDescribe(values), "describe for from-stats");
    return { mean: d.mean, sd: d.sd, n: d.n };
  };
  const sA = summ(GROUP_A);
  const sB = summ(GROUP_B);
  const sC = summ(GROUP_C);
  const fsWelch = need(
    unpairedTTestFromStats({
      mean1: sA.mean, sd1: sA.sd, n1: sA.n,
      mean2: sB.mean, sd2: sB.sd, n2: sB.n,
    }),
    "from-stats Welch t-test",
  );
  const fsStudent = need(
    unpairedTTestFromStats({
      mean1: sA.mean, sd1: sA.sd, n1: sA.n,
      mean2: sB.mean, sd2: sB.sd, n2: sB.n,
      variance: "student",
    }),
    "from-stats Student t-test",
  );
  const fsWelchGreater = need(
    unpairedTTestFromStats({
      mean1: sA.mean, sd1: sA.sd, n1: sA.n,
      mean2: sB.mean, sd2: sB.sd, n2: sB.n,
      tail: "greater",
    }),
    "from-stats Welch t-test (greater)",
  );
  const fsWelchLess = need(
    unpairedTTestFromStats({
      mean1: sA.mean, sd1: sA.sd, n1: sA.n,
      mean2: sB.mean, sd2: sB.sd, n2: sB.n,
      tail: "less",
    }),
    "from-stats Welch t-test (less)",
  );
  const fsOneway = need(
    oneWayAnovaFromStats([sA, sB, sC]),
    "from-stats one-way ANOVA",
  );

  const aov2 = need(twoWayAnova(TWOWAY), "two-way ANOVA");
  const kw = need(kruskalWallis({ A: GROUP_A, B: GROUP_B, C: GROUP_C }), "Kruskal-Wallis");
  const fr = need(friedman(REPEATED, REPEATED_LABELS), "Friedman");
  // One-way repeated-measures ANOVA on the SAME REPEATED fixture (6 subjects x 3
  // conditions). Uncorrected F / df / p cross-check statsmodels AnovaRM; partial
  // eta-squared and the Greenhouse-Geisser / Huynh-Feldt epsilons + corrected p
  // cross-check pingouin rm_anova.
  const rmAov = need(
    repeatedMeasuresAnova(REPEATED, REPEATED_LABELS),
    "repeated-measures ANOVA",
  );
  // Random-intercept linear mixed model on the SAME REPEATED fixture, reshaped to
  // long form (response value, treatment-coded condition fixed effect with P the
  // reference, random intercept by subject). Fit by REML, cross-checking
  // statsmodels MixedLM. The fixed effects + SEs pin tight; the variance
  // components and the REML log-likelihood pin on an honest looser band because a
  // variance-component optimum is implementation-dependent.
  const lmm = need(
    randomInterceptModel(REPEATED, REPEATED_LABELS),
    "linear mixed model",
  );
  const lmmIntercept = lmm.fixedEffects[0];
  const lmmQ = lmm.fixedEffects[1];
  const lmmR = lmm.fixedEffects[2];

  const pear = need(pearson(XY_X, XY_Y), "Pearson correlation");
  const spear = need(spearman(XY_X, XY_Y), "Spearman correlation");
  const reg = need(linearRegression(XY_X, XY_Y), "linear regression");

  // Diagnostic plots (Theme 4): the PLOTTED positions, validated like any stat.
  // QQ plot of GROUP_A. qqPositions orders the sample and pairs each value with
  // the theoretical normal quantile at (i - 0.5)/n, plus the least-squares
  // reference line scipy.stats.probplot draws. The theoretical extremes and the
  // line slope / intercept are pinned against scipy.
  const qq = qqPositions(GROUP_A, "GROUP_A");
  const qqTheoFirst = qq.points[0]?.theoretical ?? NaN;
  const qqTheoLast = qq.points[qq.points.length - 1]?.theoretical ?? NaN;
  // Residual plot of the simple regression. The plotted y values are the OLS
  // residuals the engine already returns; the residual sum of squares pins every
  // plotted y at once, and the first / last residual pin the per-point positions.
  const regResiduals = reg.residuals;
  const residualSS = regResiduals.reduce((acc, r) => acc + r * r, 0);

  // Simple logistic regression (D4). Fit P(Y=1) = 1 / (1 + exp(-(b0 + b1*x))) by
  // maximum likelihood (IRLS) on the same fixed binary dataset statsmodels Logit
  // was run on, then read off the intercept / slope (with the slope SE and Wald p),
  // the odds ratio exp(b1), McFadden pseudo-R-squared, and the ROC AUC. The MLE is
  // deterministic given the data and the zero start, so these reproduce the pins.
  const logit = need(
    logisticRegression(
      LOGIT_X.map((x) => [x]),
      LOGIT_Y,
      ["x"],
    ),
    "logistic regression",
  );

  // ROC curve + AUC (Theme 4). Score the SAME binary dataset the logistic case
  // pins (LOGIT_X as the classifier score, LOGIT_Y as the true label), then read
  // off the AUC (trapezoidal over the swept curve, equal to sklearn's
  // roc_auc_score), its Hanley-McNeil SE and 95% CI, and the Youden-optimal
  // threshold with its sensitivity and specificity. Deterministic, so these pin
  // tight against scikit-learn.
  const roc = need(rocAuc(LOGIT_X, LOGIT_Y), "ROC curve");

  // Multiple linear regression (D5). Fit y = b0 + b1*x1 + b2*x2 by OLS on the same
  // fixed arrays statsmodels OLS was run on, then read off the coefficients (with
  // the x1 slope SE and the x2 slope p), R-squared, adjusted R-squared, the overall
  // F, and the x1 VIF. Closed-form OLS, so these reproduce the pins exactly.
  const mlr = need(
    multipleRegression(
      MLR_X1.map((v, i) => [v, MLR_X2[i]]),
      MLR_Y,
      ["x1", "x2"],
    ),
    "multiple regression",
  );

  // Dose-response (D1). Fit the 4PL and the 5PL to the same fixed log(dose) vs
  // response arrays scipy.optimize.curve_fit was run on, and read off the EC50 (the
  // true half-max concentration; for the 5PL via the closed-form half-max shift),
  // Hill / Top / Bottom / S, and R-squared. EC50 = 10^logEC50True.
  const dr4 = need(fitModel("logistic4pl", DOSE_LOG_CONC, DOSE_RESPONSE), "4PL fit");
  const dr5 = need(fitModel("logistic5pl", DOSE_LOG_CONC, DOSE_RESPONSE), "5PL fit");
  const dr5Shift = fivePLLogEC50Shift(dr5.values.HillSlope, dr5.values.S);
  const dr4Ec50 = dr4.derived?.EC50 ?? NaN;
  const dr5Ec50 = Math.pow(10, dr5.values.logEC50 + dr5Shift);

  // Model comparison (D2). Reuse the two fits above (same dataset). The 4PL is
  // the simpler model (4 params), the 5PL is the complex one (5 params), and the
  // pair is nested, so both the extra-sum-of-squares F test and AICc apply. Every
  // number is derived from the two fits' residual sums of squares, the same path
  // run-analysis uses, so it reproduces the on-screen comparison.
  const mcSimple = {
    id: "logistic4pl",
    label: "4PL",
    ssr: dr4.ssr,
    nParams: 4,
    n: DOSE_LOG_CONC.length,
  };
  const mcComplex = {
    id: "logistic5pl",
    label: "5PL",
    ssr: dr5.ssr,
    nParams: 5,
    n: DOSE_LOG_CONC.length,
  };
  const mcF = extraSumOfSquaresF(mcSimple, mcComplex);
  const mcAicc = aiccCompare([mcSimple, mcComplex]);
  const mcAicc4 = mcAicc.models.find((m) => m.id === "logistic4pl")!.aicc;
  const mcAicc5 = mcAicc.models.find((m) => m.id === "logistic5pl")!.aicc;

  // Global (shared-parameter) fit (D3). One 4PL across two curves that share
  // Bottom, Top, and Hill; each curve keeps its own local EC50. This is the SAME
  // stacked-residual objective the scipy least_squares golden fits, so the shared
  // parameters, each local EC50, and the global R-squared reproduce the gf_* pins.
  const gf = need(
    fitGlobal(
      "logistic4pl",
      [
        { label: "A", x: GLOBAL_FIT_X, y: GLOBAL_FIT_YA },
        { label: "B", x: GLOBAL_FIT_X, y: GLOBAL_FIT_YB },
      ],
      ["Bottom", "Top", "HillSlope"],
    ),
    "global fit",
  );
  const gfParam = (name: string, ds: string | null) =>
    gf.parameters.find((p) => p.name === name && p.datasetLabel === ds)!;
  const gfEc50A = Math.pow(10, gfParam("logEC50", "A").value);
  const gfEc50B = Math.pow(10, gfParam("logEC50", "B").value);

  const sw = need(shapiroWilk([...GROUP_A, ...GROUP_B, ...GROUP_C]), "Shapiro-Wilk");
  const lev = need(levene([GROUP_A, GROUP_B, GROUP_C]), "Levene");
  const bf = need(brownForsythe([GROUP_A, GROUP_B, GROUP_C]), "Brown-Forsythe");

  // Grubbs outlier test on the one-outlier OUTLIER_SAMPLE (n = 9). The iterative
  // sweep produces two passes: pass 1 on all 9 values flags the extreme 12.7,
  // pass 2 on the remaining 8 flags nothing. The G and Bonferroni-corrected
  // critical value of each pass cross-check the scipy.stats.t hand computation in
  // the generator. The sweep is deterministic, so these pin tight.
  const grubbs = need(grubbsTest(OUTLIER_SAMPLE), "Grubbs outlier test");
  const grubbsStep1 = grubbs.steps[0];
  const grubbsStep2 = grubbs.steps[1];
  if (!grubbsStep1 || !grubbsStep2) {
    throw new Error("transparency: Grubbs did not produce two sweep passes");
  }

  const km = need(kaplanMeier(SURV_TREAT), "Kaplan-Meier");
  const lr = need(
    logRank([
      { name: "Treat", observations: SURV_TREAT },
      { name: "Control", observations: SURV_CONTROL },
    ]),
    "log-rank",
  );
  const gbw = need(
    gehanBreslowWilcoxon([
      { name: "Treat", observations: SURV_TREAT },
      { name: "Control", observations: SURV_CONTROL },
    ]),
    "Gehan-Breslow-Wilcoxon",
  );

  // Cox proportional hazards on the same two arms. The covariate is the arm
  // indicator (Treatment = 1, Control = 0), matching the lifelines reference
  // coding so exp(coef) is the Treatment-vs-Control hazard ratio.
  const coxRows = [
    ...SURV_TREAT.map((o) => ({ time: o.time, event: o.event, covariates: [1] })),
    ...SURV_CONTROL.map((o) => ({ time: o.time, event: o.event, covariates: [0] })),
  ];
  const cox = need(coxPH(coxRows, ["arm"]), "Cox PH");
  const coxArm = cox.coefficients[0];

  // Categorical association on the fixed contingency tables. The 2x2 case carries
  // the Yates correction, Fisher's exact p, and the relative-risk / odds-ratio
  // measures; the 2x3 case carries only the uncorrected chi-square.
  const ct2 = need(contingencyTest(CONTINGENCY_2X2), "chi-square 2x2");
  const ct3 = need(contingencyTest(CONTINGENCY_2X3), "chi-square 2x3");
  const ctRR = ct2.relativeRisk;
  const ctOR = ct2.oddsRatio;
  if (!ctRR || !ctOR) {
    throw new Error("transparency: 2x2 contingency produced no effect measures");
  }

  // Read the step-function survival just after a fixed time (the value carried
  // forward from the last event at or before t), matching lifelines' predict().
  const survAt = (t: number): number => {
    let s = 1;
    for (const step of km.steps) {
      if (step.time <= t) s = step.survival;
      else break;
    }
    return s;
  };

  // Tukey comparisons keyed by the unordered pair, with the sign-free mean diff.
  const tukey = new Map<string, { meanDiff: number; pAdjusted: number }>();
  for (const c of aov1.comparisons) {
    const key = [c.groupA, c.groupB].sort().join("__");
    tukey.set(key, { meanDiff: Math.abs(c.meanDiff), pAdjusted: c.pAdjusted });
  }
  const twoWayRow = (source: string) => {
    const row = aov2.table.find((r) => r.source === source);
    if (!row) throw new Error(`transparency: two-way ANOVA missing row ${source}`);
    return row;
  };
  const rowA = twoWayRow("Factor A");
  const rowB = twoWayRow("Factor B");
  const rowAB = twoWayRow("Interaction");

  // E1 effect sizes. The standardized-effect CIs (Cohen's d / dz, eta-squared)
  // and the correlation r-squared CI are carried straight on the same engine
  // results computed above, so the gate proves these match the pingouin / scipy
  // noncentral references on the SAME fixed dataset the tests ran on. A finite
  // bound is required (the pinned dataset always yields one); throw otherwise so
  // a regression that drops a CI cannot pass silently.
  const ciBound = (
    ci: [number, number] | null,
    which: 0 | 1,
    what: string,
  ): number => {
    if (!ci || !Number.isFinite(ci[which])) {
      throw new Error(`transparency: ${what} CI bound missing`);
    }
    return ci[which];
  };
  const aovEffect = aov1.effectSize;
  if (!aovEffect || aovEffect.omegaSquared === null) {
    throw new Error("transparency: one-way ANOVA effect size missing");
  }

  // E3 power scenarios. These take design parameters, not the dataset, so they
  // are fixed scenario constants validated against statsmodels.
  const powerTwoSample = powerTwoSampleT(
    POWER_TWO_SAMPLE_N,
    POWER_TWO_SAMPLE_D,
    POWER_ALPHA,
  );
  const sampleSizeTwoSample = sampleSizeTwoSampleT(
    SAMPLESIZE_D,
    POWER_ALPHA,
    SAMPLESIZE_TARGET_POWER,
  );
  if (sampleSizeTwoSample === null) {
    throw new Error("transparency: a-priori sample-size scenario produced no N");
  }

  // E4 bootstrap, the deterministic (RNG-free) machinery only. A reseeded JS
  // bootstrap cannot match scipy resample-for-resample, so we validate the parts
  // that ARE exactly reproducible against numpy / scipy.
  const bootPercentile = percentileInterval(BOOT_DISTRIBUTION, 0.05);
  const bootZ0 = biasCorrection(BOOT_STATS, BOOT_OBSERVED);
  const bootAcceleration = jackknifeAcceleration(BOOT_ACCEL_SAMPLE, sampleMean);

  return {
    unpaired_welch_t: welch.statistic,
    unpaired_welch_df: welch.df,
    unpaired_welch_p: welch.pValue,
    unpaired_student_t: student.statistic,
    unpaired_student_df: student.df,
    unpaired_student_p: student.pValue,
    paired_t: paired.statistic,
    paired_p: paired.pValue,

    mann_whitney_u: mwu.statistic,
    mann_whitney_p: mwu.pValue,
    wilcoxon_w: wil.statistic,
    wilcoxon_p: wil.pValue,

    unpaired_welch_greater_p: welchGreater.pValue,
    unpaired_welch_less_p: welchLess.pValue,
    paired_greater_p: pairedGreater.pValue,
    paired_less_p: pairedLess.pValue,
    mann_whitney_greater_p: mwuGreater.pValue,
    mann_whitney_less_p: mwuLess.pValue,
    wilcoxon_greater_p: wilGreater.pValue,
    wilcoxon_less_p: wilLess.pValue,
    posthoc_sidak_ac_p: acAdj(aovSidak.comparisons),
    posthoc_bonferroni_ac_p: acAdj(aovBonf.comparisons),
    posthoc_holm_sidak_ac_p: acAdj(aovHolm.comparisons),

    fromstats_welch_t: fsWelch.statistic,
    fromstats_welch_df: fsWelch.df,
    fromstats_welch_p: fsWelch.pValue,
    fromstats_student_t: fsStudent.statistic,
    fromstats_student_df: fsStudent.df,
    fromstats_student_p: fsStudent.pValue,
    fromstats_welch_greater_p: fsWelchGreater.pValue,
    fromstats_welch_less_p: fsWelchLess.pValue,
    fromstats_oneway_f: fsOneway.statistic,
    fromstats_oneway_p: fsOneway.pValue,

    oneway_f: aov1.statistic,
    oneway_p: aov1.pValue,
    tukey_ac_p: tukey.get("A__C")!.pAdjusted,
    tukey_ab_meandiff: tukey.get("A__B")!.meanDiff,
    tukey_bc_meandiff: tukey.get("B__C")!.meanDiff,

    twoway_a_f: rowA.f ?? NaN,
    twoway_a_p: rowA.pValue ?? NaN,
    twoway_b_f: rowB.f ?? NaN,
    twoway_b_p: rowB.pValue ?? NaN,
    twoway_ab_f: rowAB.f ?? NaN,
    twoway_ab_p: rowAB.pValue ?? NaN,

    kruskal_h: kw.statistic,
    kruskal_p: kw.pValue,
    friedman_chi2: fr.statistic,
    friedman_p: fr.pValue,

    rmanova_f: rmAov.statistic,
    rmanova_p: rmAov.pValue,
    rmanova_partial_eta_sq: rmAov.partialEtaSquared,
    rmanova_gg_epsilon: rmAov.greenhouseGeisserEpsilon,
    rmanova_p_gg: rmAov.pGreenhouseGeisser,
    rmanova_hf_epsilon: rmAov.huynhFeldtEpsilon,
    rmanova_p_hf: rmAov.pHuynhFeldt,

    lmm_intercept_est: lmmIntercept.estimate,
    lmm_intercept_se: lmmIntercept.standardError,
    lmm_q_est: lmmQ.estimate,
    lmm_q_se: lmmQ.standardError,
    lmm_r_est: lmmR.estimate,
    lmm_r_se: lmmR.standardError,
    lmm_group_var: lmm.groupVariance,
    lmm_residual_var: lmm.residualVariance,
    lmm_reml_loglike: lmm.remlLogLikelihood,

    pearson_r: pear.coefficient,
    pearson_p: pear.pValue,
    spearman_rho: spear.coefficient,
    linreg_slope: reg.slope,
    linreg_intercept: reg.intercept,
    linreg_r2: reg.rSquared,

    lr_intercept: logit.intercept.estimate,
    lr_slope: logit.slope.estimate,
    lr_slope_se: logit.slope.standardError,
    lr_slope_p: logit.slope.pValue,
    lr_odds_ratio: logit.oddsRatio,
    lr_mcfadden_r2: logit.mcFaddenR2,
    lr_auc: logit.auc,

    roc_auc: roc.auc,
    roc_auc_se: roc.aucStandardError,
    roc_auc_ci_low: roc.aucCiLow,
    roc_auc_ci_high: roc.aucCiHigh,
    roc_youden_threshold: roc.youdenThreshold,
    roc_youden_sensitivity: roc.youdenSensitivity,
    roc_youden_specificity: roc.youdenSpecificity,

    // Diagnostic plots (Theme 4): the validated plotted positions.
    qq_theoretical_first: qqTheoFirst,
    qq_theoretical_last: qqTheoLast,
    qq_line_slope: qq.lineSlope,
    qq_line_intercept: qq.lineIntercept,
    residual_ss: residualSS,
    residual_first: regResiduals[0] ?? NaN,
    residual_last: regResiduals[regResiduals.length - 1] ?? NaN,

    mlr_intercept: mlr.intercept.estimate,
    mlr_x1_slope: mlr.slopes[0].estimate,
    mlr_x2_slope: mlr.slopes[1].estimate,
    mlr_x1_slope_se: mlr.slopes[0].standardError,
    mlr_x2_slope_p: mlr.slopes[1].pValue,
    mlr_r2: mlr.rSquared,
    mlr_adj_r2: mlr.adjRSquared,
    mlr_f: mlr.fStatistic,
    mlr_x1_vif: mlr.slopes[0].vif,

    dr4pl_ec50: dr4Ec50,
    dr4pl_hill: dr4.values.HillSlope,
    dr4pl_top: dr4.values.Top,
    dr4pl_bottom: dr4.values.Bottom,
    dr4pl_r2: dr4.rSquared,
    dr5pl_ec50: dr5Ec50,
    dr5pl_s: dr5.values.S,
    dr5pl_r2: dr5.rSquared,
    mc_f: mcF.f,
    mc_f_p: mcF.pValue,
    mc_aicc_4pl: mcAicc4,
    mc_aicc_5pl: mcAicc5,
    // Decisions as 0/1: 1 means the COMPLEX (5PL) model is preferred.
    mc_f_prefers_complex: mcF.preferredId === "logistic5pl" ? 1 : 0,
    mc_aicc_prefers_complex: mcAicc.preferredId === "logistic5pl" ? 1 : 0,
    gf_bottom: gfParam("Bottom", null).value,
    gf_top: gfParam("Top", null).value,
    gf_hill: gfParam("HillSlope", null).value,
    gf_ec50_a: gfEc50A,
    gf_ec50_b: gfEc50B,
    gf_r2: gf.rSquared,

    shapiro_w: sw.statistic,
    shapiro_p: sw.pValue,
    levene_w: lev.statistic,
    levene_p: lev.pValue,
    bf_w: bf.statistic,
    bf_p: bf.pValue,

    grubbs_g1: grubbsStep1.g,
    grubbs_gcrit1: grubbsStep1.gCritical,
    grubbs_g2: grubbsStep2.g,
    grubbs_gcrit2: grubbsStep2.gCritical,
    // 1 when pass 1 flags an outlier and pass 2 does not (the expected sweep
    // shape for a single-outlier sample). A regression that flagged the wrong
    // count would change this to 0.
    grubbs_sweep_shape:
      grubbsStep1.flagged && !grubbsStep2.flagged ? 1 : 0,

    km_surv_t7: survAt(KM_READ_TIMES[0]),
    km_surv_t13: survAt(KM_READ_TIMES[1]),
    km_surv_t23: survAt(KM_READ_TIMES[2]),
    km_median: km.median ?? NaN,
    logrank_chi2: lr.chiSquare,
    logrank_p: lr.pValue,
    gehan_chi2: gbw.chiSquare,
    gehan_p: gbw.pValue,
    cox_coef: coxArm.coef,
    cox_se: coxArm.se,
    cox_z: coxArm.z,
    cox_p: coxArm.pValue,
    cox_hr: coxArm.hazardRatio,
    cox_hr_ci_low: coxArm.hrCiLow,
    cox_hr_ci_high: coxArm.hrCiHigh,
    cox_log_likelihood: cox.logLikelihood,
    cox_lr_chi2: cox.lrChiSquare,
    cox_lr_p: cox.lrPValue,
    cox_concordance: cox.concordance,

    contingency_2x2_chi2: ct2.chiSquare,
    contingency_2x2_p: ct2.pValue,
    contingency_2x2_yates_chi2: ct2.yatesChiSquare,
    contingency_2x2_yates_p: ct2.yatesPValue,
    contingency_2x2_fisher_p: ct2.fisherPValue,
    contingency_2x2_min_expected: ct2.minExpected,
    contingency_2x2_rr: ctRR.estimate,
    contingency_2x2_rr_ci_low: ctRR.ciLow,
    contingency_2x2_rr_ci_high: ctRR.ciHigh,
    contingency_2x2_or: ctOR.estimate,
    contingency_2x2_or_ci_low: ctOR.ciLow,
    contingency_2x2_or_ci_high: ctOR.ciHigh,
    contingency_2x3_chi2: ct3.chiSquare,
    contingency_2x3_p: ct3.pValue,
    contingency_2x3_min_expected: ct3.minExpected,

    // E1: effect sizes + standardized-effect CIs (sign-preserving; the pins
    // carry the same sign as the references, so no magnitude folding here).
    unpaired_cohens_d: welch.effectSize,
    unpaired_hedges_g: welch.hedgesG ?? NaN,
    unpaired_d_ci_lo: ciBound(welch.effectSizeCI95, 0, "unpaired Cohen's d"),
    unpaired_d_ci_hi: ciBound(welch.effectSizeCI95, 1, "unpaired Cohen's d"),
    paired_cohens_dz: paired.effectSize,
    paired_dz_ci_lo: ciBound(paired.effectSizeCI95, 0, "paired Cohen's dz"),
    paired_dz_ci_hi: ciBound(paired.effectSizeCI95, 1, "paired Cohen's dz"),
    oneway_eta_squared: aovEffect.etaSquared,
    oneway_omega_squared: aovEffect.omegaSquared,
    oneway_eta2_ci_lo: ciBound(aovEffect.etaSquaredCI95, 0, "one-way eta-squared"),
    oneway_eta2_ci_hi: ciBound(aovEffect.etaSquaredCI95, 1, "one-way eta-squared"),
    pearson_r_squared: pear.rSquared,
    pearson_r2_ci_lo: ciBound(pear.rSquaredCI95, 0, "Pearson r-squared"),
    pearson_r2_ci_hi: ciBound(pear.rSquaredCI95, 1, "Pearson r-squared"),

    // E3: power and sample-size planning (study-design scenarios).
    power_two_sample_t: powerTwoSample,
    samplesize_two_sample_t: sampleSizeTwoSample,

    // E4: bootstrap deterministic machinery (no RNG).
    boot_percentile_lo: bootPercentile[0],
    boot_percentile_hi: bootPercentile[1],
    boot_z0: bootZ0,
    boot_acceleration: bootAcceleration,
  };
}

function buildDatahubStatsDomain(): DomainReport {
  const ours = runDatahubEngine();

  const cases: CaseResult[] = STAT_PINS.map((pin: StatPin) => {
    const got = ours[pin.id];
    if (got === undefined || !Number.isFinite(got)) {
      throw new Error(`transparency: datahub stat ${pin.id} produced no finite value`);
    }
    // Compare on the sign-free magnitude where the metric is sign-invariant
    // (mean differences are pinned as magnitudes; everything else is direct).
    const oursVal = pin.unit === "diff" ? Math.abs(got) : got;
    const delta = round(Math.abs(oursVal - pin.reference), 9);
    const tol: Tolerance = {
      pass: pin.tol,
      warn: pin.warn,
      unit: pin.unit,
      kind: pin.difference ? "loose" : "tight",
      rationale:
        pin.difference
        ?? "ResearchOS computes this statistic by the same definition as the "
          + "reference tool, so it must agree to numerical precision on this fixed "
          + "dataset. Any drift beyond the tolerance is an engine regression.",
    };
    const status = classify(delta, tol);

    return {
      id: pin.id,
      label: pin.metric,
      input: pin.metric,
      comparisons: [
        {
          oracleId: pin.oracleId,
          metric: pin.metric,
          ours: round(oursVal, 6),
          theirs: pin.reference,
          delta,
          tolerance: tol,
          status,
        },
      ],
      status,
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "datahub-stats",
    title: "Data Hub statistics",
    summary:
      "The Data Hub analysis engine (a free, open, local-first alternative to "
      + "GraphPad Prism) is validated against the tools working scientists already "
      + "trust. On one small fixed dataset it runs the unpaired (Welch and Student) "
      + "and paired t-tests, Mann-Whitney U, Wilcoxon signed-rank, one-way and "
      + "two-way ANOVA with Tukey post-hoc, Kruskal-Wallis, Friedman, Pearson and "
      + "Spearman correlation, simple linear regression, Shapiro-Wilk and Levene / "
      + "Brown-Forsythe assumption checks, the Grubbs outlier test, the ROC curve "
      + "with its area under the curve (AUC, against scikit-learn), Kaplan-Meier "
      + "survival with the log-rank test, and the chi-square test of independence on "
      + "a contingency table (with the Yates correction, Fisher's exact test, and the "
      + "relative-risk / odds-ratio measures for a 2x2 table, against "
      + "scipy.stats.chi2_contingency and fisher_exact). The diagnostic figures are validated on "
      + "their plotted positions too, the normal QQ plot's theoretical quantiles and "
      + "reference line against scipy.stats.probplot and the residual plot's residuals "
      + "against statsmodels OLS. It also validates the estimation layer that "
      + "turns a p-value "
      + "into a measured effect, the Cohen's d / Hedges' g and standardized-effect "
      + "confidence intervals on the t-tests, eta-squared and omega-squared on the "
      + "one-way ANOVA, and r-squared on the correlation (each against the pingouin / "
      + "scipy noncentral reference), two power and sample-size scenarios against "
      + "statsmodels, and the deterministic bootstrap machinery (percentile "
      + "extraction, the BCa bias-correction z0, and the jackknife acceleration) "
      + "against numpy and scipy. Every reference value is generated by scipy.stats, "
      + "statsmodels, and lifelines in a committed Python script and pinned here, so "
      + "each comparison is reproducible. Two rows are flagged as documented method "
      + "differences (Wilcoxon exact vs normal-approximation p, and the "
      + "mean-centered vs median-centered Levene convention) rather than forced to "
      + "match.",
    impl: "frontend/src/lib/datahub/engine/",
    oracles: [SCIPY, STATSMODELS, LIFELINES, SKLEARN],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------------- phylogenetics domain */

/**
 * Tip-order agreement against ggtree. The headline claim is that our native tree
 * layout draws tips in the SAME order as ggtree and places nodes at the SAME
 * relative branch-length depth. Both are affine-robust correlations, so a value
 * of 1.0 is perfect agreement and the delta is 1 minus the correlation. The band
 * is loose because we explicitly do NOT claim pixel parity, only that the tree
 * shape and ordering match (a real layout regression, e.g. a tip reordering,
 * would drop the correlation far below the warn line and fail).
 */
const PHYLO_LAYOUT: Tolerance = {
  pass: 0.02,
  warn: 0.1,
  unit: "1 - corr",
  kind: "loose",
  rationale:
    "ggtree and our renderer differ in scale, pixel sizing, and y-axis "
    + "orientation, so a pixel-identical claim would be dishonest. What must agree "
    + "is the topology-invariant structure both tools draw, the tip ordering and "
    + "the relative branch-length depth of every node. We compare the absolute "
    + "Spearman correlation of tip order (orientation-invariant) and require it "
    + "within 0.02 of a perfect 1.0. A tip reordering or a depth bug would drop it "
    + "well past the warn line.",
};

function buildPhyloDomain(): DomainReport {
  const ready = allGoldensReady();

  const cases: CaseResult[] = PHYLO_CASES.map((pc) => {
    const cmp = comparePhyloLayout(pc.newick, pc.golden);
    const agreement = Number.isFinite(cmp.tipOrderAgreement)
      ? round(cmp.tipOrderAgreement, 6)
      : 0;
    const delta = round(Math.abs(1 - agreement), 6);
    const status: Status = ready ? classify(delta, PHYLO_LAYOUT) : "pass";

    return {
      id: pc.id,
      label: pc.label,
      input:
        `${pc.source}. Tip-order agreement ${ready ? agreement.toFixed(4) : "pending"}, `
        + `depth agreement ${
          ready && Number.isFinite(cmp.depthAgreement)
            ? cmp.depthAgreement.toFixed(4)
            : "pending"
        } (${cmp.matchedTips}/${cmp.ourTips} tips matched by label).`,
      comparisons: [
        {
          oracleId: GGTREE.id,
          metric: "tip-order agreement (abs Spearman)",
          ours: agreement,
          theirs: 1,
          delta,
          tolerance: PHYLO_LAYOUT,
          status,
          // While the golden is the placeholder the comparison is NOT gated: it is
          // shown as context so the page reads honestly, and the gate test skips.
          informational: !ready,
        },
      ],
      status,
      visual: {
        kind: "phylo-figures",
        ggtreeFigure: ready ? pc.figure : null,
        matchedTips: cmp.matchedTips,
        ourTips: cmp.ourTips,
        tipOrderAgreement: agreement,
        depthAgreement:
          ready && Number.isFinite(cmp.depthAgreement)
            ? round(cmp.depthAgreement, 6)
            : 0,
        pending: !ready,
      },
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => gated(c.comparisons).map((cmp) => cmp.status)),
  );

  return {
    id: "phylo",
    title: "Phylogenetic tree layout",
    summary:
      "The /phylo Tree Studio lays trees out with our own native-SVG layout math, "
      + "no plotting library. To show that layout is trustworthy we compare it "
      + "against ggtree, the de-facto standard tree-plotting package in R, on three "
      + "real published phylogenies (a Candida auris global-epidemiology tree, the "
      + "Human Microbiome Project tree, and an HPV58 phylogeny). The claim is "
      + "deliberately not pixel parity, since ggtree and our renderer differ in "
      + "scale and y-axis orientation. What we prove is that the two draw the same "
      + "tree, the tips fall in the same order and every node sits at the same "
      + "relative branch-length depth, measured as orientation-invariant rank and "
      + "depth correlations. ggtree is R and cannot run in CI, so its coordinate "
      + "table is produced once offline by a committed R script "
      + "(gen-phylo-ggtree-golden.R) and frozen as JSON, exactly like the scipy "
      + "reference values, then our layout is checked against it on every build."
      + (ready
        ? ""
        : " The ggtree reference is not committed yet, so these rows are shown as "
          + "pending context and the gate is skipped until the offline run lands."),
    impl: "frontend/src/lib/phylo/layout.ts",
    oracles: [GGTREE],
    cases,
    totals,
    status,
  };
}

/* ------------------------------------------------------------- aggregation */

/**
 * Build the whole transparency report. Register new domains here as their
 * datasets land (alignment, digest, translation).
 */
export function buildTransparencyReport(): TransparencyReport {
  const domains: DomainReport[] = [
    buildTmDomain(),
    buildAlignmentDomain(),
    buildDigestDomain(),
    buildTranslationDomain(),
    buildProteinDomain(),
    buildCalculatorsDomain(),
    buildCloningDomain(),
    buildDomainsDomain(),
    buildPublishedDomain(),
    buildDatahubStatsDomain(),
    buildPhyloDomain(),
  ];

  const { status, totals } = rollup(
    domains.flatMap((d) =>
      d.cases.flatMap((c) => gated(c.comparisons).map((cmp) => cmp.status)),
    ),
  );

  return {
    generatedNote:
      "Recomputed from source on each build. Reference values are pinned from the "
      + "cited tool versions and reproducible with the listed generator scripts.",
    domains,
    totals,
    status,
  };
}

/** Round to `n` decimals (avoids float noise in displayed deltas). */
function round(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}
