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
import { digestEnzymes, fragmentSizes } from "@/lib/sequences/enzyme-filters";
import { translate } from "@/vendor/seqviz/sequence";

import { HOMOLOGY_CASES, PAIRWISE_CASES } from "./datasets/alignment";
import { DIGEST_CASES } from "./datasets/digest";
import { TM_CASES } from "./datasets/tm";
import { TRANSLATE_CASES } from "./datasets/translation";
import {
  BIOPYTHON,
  BIOPYTHON_ALIGN,
  BIOPYTHON_DIGEST,
  BIOPYTHON_TRANSLATE,
  PRIMER3,
} from "./oracles";
import {
  classify,
  rollup,
  type CaseResult,
  type DomainReport,
  type ScalarComparison,
  type Tolerance,
  type TransparencyReport,
} from "./types";

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

    const { status } = rollup(comparisons.map((cmp) => cmp.status));
    return {
      id: c.id,
      label: c.label,
      input: c.seq,
      comparisons,
      status,
    };
  });

  const { status, totals } = rollup(
    cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
  );

  return {
    id: "tm",
    title: "Primer melting temperature (Tm)",
    summary:
      "Melting temperature is computed from nearest-neighbor thermodynamics "
      + "(Allawi and SantaLucia 1997 parameters with the SantaLucia 1998 entropy "
      + "salt correction) given the primer sequence, monovalent and divalent ion "
      + "concentrations, and oligo concentration. Values are compared against "
      + "Biopython Tm_NN under identical parameters, and against primer3, which "
      + "uses the SantaLucia 1998 unified nearest-neighbor table.",
    impl: "frontend/src/lib/calculators/tm-nn.ts",
    oracles: [BIOPYTHON, PRIMER3],
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

/** Long-homology identity: the finder may trim a few boundary bases. */
const ALIGN_IDENTITY: Tolerance = {
  pass: 0.08,
  warn: 0.15,
  unit: "identity",
  kind: "loose",
  rationale:
    "On a multi-kilobase pair, the seed-and-extend finder recovers the planted "
    + "homologous block and reports its percent identity. It may trim a few "
    + "boundary bases versus Biopython's exact local span, so identity is checked "
    + "to within 0.08 of Biopython, never above it.",
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
  ];

  const { status, totals } = rollup(
    domains.flatMap((d) =>
      d.cases.flatMap((c) => c.comparisons.map((cmp) => cmp.status)),
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
