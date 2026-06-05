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
  NATIVE_HMMER,
  ORACLES,
  PRIMER3,
  WALLACE,
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
