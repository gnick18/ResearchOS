/**
 * Third-party reference implementations ResearchOS checks itself against.
 *
 * Version + entrypoint + citation + generator are the provenance the page shows
 * so a reader can reproduce every pinned number. The pinned oracle VALUES live in
 * `datasets/*.ts` next to the cases they belong to; this file only carries the
 * tool-level metadata shared across those cases.
 */

import type { OracleRef } from "./types";

export const BIOPYTHON: OracleRef = {
  id: "biopython",
  name: "Biopython",
  version: "1.83",
  entrypoint: "Bio.SeqUtils.MeltingTemp.Tm_NN",
  citation: "Allawi & SantaLucia 1997 (DNA_NN3), SantaLucia 1998 salt correction",
  generator: "frontend/scripts/gen-tm-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.SeqUtils.MeltingTemp.html",
};

export const PRIMER3: OracleRef = {
  id: "primer3",
  name: "primer3-py",
  version: "2.0.3",
  entrypoint: "primer3.calc_tm (tm_method='santalucia', salt_corrections_method='santalucia')",
  citation: "SantaLucia 1998 unified nearest-neighbor table",
  generator: "frontend/scripts/gen-tm-golden.py",
  url: "https://libnano.github.io/primer3-py/",
};

export const BIOPYTHON_ALIGN: OracleRef = {
  id: "biopython-align",
  name: "Biopython",
  version: "1.83",
  entrypoint: "Bio.Align.PairwiseAligner / local-homology reconciliation",
  citation: "Needleman-Wunsch (global) and Smith-Waterman (local), affine Gotoh gaps",
  generator: "frontend/scripts/gen-align-golden.py, frontend/scripts/gen-shared-regions-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.Align.html",
};

export const BIOPYTHON_DIGEST: OracleRef = {
  id: "biopython-digest",
  name: "Biopython",
  version: "1.83",
  entrypoint: "Bio.Restriction",
  citation: "REBASE recognition sites, both strands, linear + circular topology",
  generator: "frontend/scripts/gen-digest-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.Restriction.html",
};

export const BIOPYTHON_TRANSLATE: OracleRef = {
  id: "biopython-translate",
  name: "Biopython",
  version: "1.83",
  entrypoint: "Bio.Seq.translate",
  citation: "NCBI genetic-code tables",
  generator: "frontend/scripts/gen-translate-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.Seq.html",
};

/** Lookup by id, for resolving an oracle from a case's comparison. */
export const ORACLES: Record<string, OracleRef> = {
  [BIOPYTHON.id]: BIOPYTHON,
  [PRIMER3.id]: PRIMER3,
  [BIOPYTHON_ALIGN.id]: BIOPYTHON_ALIGN,
  [BIOPYTHON_DIGEST.id]: BIOPYTHON_DIGEST,
  [BIOPYTHON_TRANSLATE.id]: BIOPYTHON_TRANSLATE,
};
