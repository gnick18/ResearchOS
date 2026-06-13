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

export const BIOPYTHON_PROTEIN: OracleRef = {
  id: "biopython-protein",
  name: "Biopython",
  version: "1.83",
  entrypoint: "Bio.SeqUtils.ProtParam.ProteinAnalysis (the engine behind ExPASy ProtParam)",
  citation: "Kyte-Doolittle GRAVY, Guruprasad instability, Ikai aliphatic, Lobry aromaticity",
  generator: "frontend/scripts/gen-protein-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.SeqUtils.ProtParam.html",
};

export const EXACT_DEFINITIONS: OracleRef = {
  id: "exact",
  name: "Exact definitions and published constants",
  version: "n/a",
  entrypoint: "SI unit definitions; dsDNA 650 g/mol per bp, ssDNA/RNA 330 g/mol per nt",
  citation: "SI prefixes (BIPM SI brochure) and standard average nucleotide masses",
  generator: "frontend/scripts/gen-calc-golden.py",
};

export const PUBLISHED_SEQUENCES: OracleRef = {
  id: "published-seq",
  name: "Published reference sequences",
  version: "n/a",
  entrypoint: "Gateway att-site sequences; hand-traced recombination products",
  citation: "Landy 1989 / Gateway att-site cores; hand-verified junction sequences",
  generator: "frontend/scripts/gen-cloning-golden.py",
};

export const PYDNA: OracleRef = {
  id: "pydna",
  name: "pydna",
  version: "5.5.13",
  entrypoint: "restriction-ligation and Golden Gate (Type IIS) assembly simulation",
  citation: "Pereira et al. 2015, in-silico cloning simulation",
  generator: "frontend/scripts/gen-cloning-golden.py",
  url: "https://github.com/BjornFJohansson/pydna",
};

export const NATIVE_HMMER: OracleRef = {
  id: "native-hmmer",
  name: "HMMER (native)",
  version: "3.3.2",
  entrypoint: "hmmsearch --domtblout (default mode, no --max) over a curated Pfam subset",
  citation: "Eddy 2011, profile-HMM domain search; Pfam-A profiles (CC0)",
  generator: "frontend/scripts/gen-domains-golden.mjs",
  url: "http://hmmer.org/",
};

export const WALLACE: OracleRef = {
  id: "wallace",
  name: "Wallace rule (2+4)",
  version: "n/a",
  entrypoint: "Bio.SeqUtils.MeltingTemp.Tm_Wallace",
  citation: "Wallace et al. 1979, 4*GC + 2*AT; valid only for short oligos",
  generator: "frontend/scripts/gen-tm-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.SeqUtils.MeltingTemp.html",
};

export const GC_RULE: OracleRef = {
  id: "gc-rule",
  name: "GC% rule",
  version: "n/a",
  entrypoint: "Bio.SeqUtils.MeltingTemp.Tm_GC",
  citation: "Marmur-Doty / empirical GC-percent formula with salt term",
  generator: "frontend/scripts/gen-tm-golden.py",
  url: "https://biopython.org/docs/latest/api/Bio.SeqUtils.MeltingTemp.html",
};

export const GENBANK_TRANSLATION: OracleRef = {
  id: "genbank-translation",
  name: "GenBank record annotation",
  version: "n/a",
  entrypoint: "the /translation qualifier on a record's annotated coding sequence",
  citation:
    "NCBI RefSeq / GenBank records: insulin NM_000207.3, EGFP U55762; the protein "
    + "each record annotates for its own CDS",
  generator: "transcribed verbatim from NCBI efetch GenBank text (no script)",
  url: "https://www.ncbi.nlm.nih.gov/nuccore/",
};

export const REFERENCE_GENOME_DIGEST: OracleRef = {
  id: "reference-genome-digest",
  name: "Reference genome fragment pattern",
  version: "n/a",
  entrypoint:
    "in-silico digest of a published reference sequence (pUC19 L09137, lambda J02459)",
  citation:
    "pUC19 + EcoRI single-cut linearization (2,686 bp); lambda + HindIII fragment "
    + "ladder computed from the deposited J02459 genome",
  generator: "transcribed verbatim from NCBI efetch GenBank text (no script)",
  url: "https://www.ncbi.nlm.nih.gov/nuccore/J02459",
};

export const PUBLISHED_QPCR: OracleRef = {
  id: "published-qpcr",
  name: "Published RT-qPCR standard-curve values",
  version: "n/a",
  entrypoint:
    "standard-curve slope paired with amplification efficiency percent, as stated in the paper",
  citation:
    "Ahmed et al. 2022, Minimizing errors in RT-PCR detection and quantification "
    + "of SARS-CoV-2 RNA, Sci. Total Environ. 805:149877",
  generator: "transcribed verbatim from the PMC full-text XML (PMC8341816, no script)",
  url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8341816/",
};

export const SCIPY: OracleRef = {
  id: "scipy",
  name: "SciPy",
  version: "1.17.1",
  entrypoint:
    "scipy.stats (ttest_ind, ttest_rel, mannwhitneyu, wilcoxon, f_oneway, "
    + "kruskal, friedmanchisquare, pearsonr, spearmanr, linregress, shapiro, levene)",
  citation:
    "Virtanen et al. 2020, SciPy 1.0: fundamental algorithms for scientific "
    + "computing in Python, Nat. Methods 17:261-272",
  generator: "frontend/scripts/gen-datahub-stats-golden.py",
  url: "https://docs.scipy.org/doc/scipy/reference/stats.html",
};

export const STATSMODELS: OracleRef = {
  id: "statsmodels",
  name: "statsmodels",
  version: "0.14.6",
  entrypoint:
    "statsmodels.stats.anova.anova_lm (two-way Type II) and "
    + "statsmodels.stats.multicomp.pairwise_tukeyhsd",
  citation: "Seabold & Perktold 2010, statsmodels: econometric and statistical modeling",
  generator: "frontend/scripts/gen-datahub-stats-golden.py",
  url: "https://www.statsmodels.org/",
};

export const PINGOUIN: OracleRef = {
  id: "pingouin",
  name: "Pingouin",
  version: "0.6.1",
  entrypoint:
    "pingouin.rm_anova(correction=True) (Greenhouse-Geisser / Huynh-Feldt "
    + "sphericity corrections) and pingouin.epsilon",
  citation: "Vallat 2018, Pingouin: statistics in Python, JOSS 3(31):1026",
  generator: "frontend/scripts/gen-datahub-stats-golden.py",
  url: "https://pingouin-stats.org/",
};

export const LIFELINES: OracleRef = {
  id: "lifelines",
  name: "lifelines",
  version: "0.30.3",
  entrypoint:
    "lifelines.KaplanMeierFitter (survival, median) and "
    + "lifelines.statistics.logrank_test",
  citation: "Davidson-Pilon 2019, lifelines: survival analysis in Python, JOSS 4(40):1317",
  generator: "frontend/scripts/gen-datahub-stats-golden.py",
  url: "https://lifelines.readthedocs.io/",
};

export const SKLEARN: OracleRef = {
  id: "sklearn",
  name: "scikit-learn",
  version: "1.9.0",
  entrypoint: "sklearn.metrics.roc_auc_score and sklearn.metrics.roc_curve",
  citation:
    "Pedregosa et al. 2011, scikit-learn: machine learning in Python, "
    + "JMLR 12:2825-2830; Hanley & McNeil 1982 for the AUC standard error and CI",
  generator: "frontend/scripts/gen-datahub-stats-golden.py",
  url: "https://scikit-learn.org/stable/modules/model_evaluation.html#roc-metrics",
};

export const GGTREE: OracleRef = {
  id: "ggtree",
  name: "ggtree",
  version: "pending (committed once the offline R run lands)",
  entrypoint: "ggtree::ggtree(tree, layout = 'rectangular'), node coordinate table p$data",
  citation:
    "Yu G, et al. 2017, ggtree: an R package for visualization and annotation of "
    + "phylogenetic trees with their covariates and other associated data, "
    + "Methods Ecol. Evol. 8(1):28-36",
  generator: "frontend/scripts/gen-phylo-ggtree-golden.R",
  url: "https://yulab-smu.top/treedata-book/",
};

/** Lookup by id, for resolving an oracle from a case's comparison. */
export const ORACLES: Record<string, OracleRef> = {
  [BIOPYTHON.id]: BIOPYTHON,
  [PRIMER3.id]: PRIMER3,
  [BIOPYTHON_ALIGN.id]: BIOPYTHON_ALIGN,
  [BIOPYTHON_DIGEST.id]: BIOPYTHON_DIGEST,
  [BIOPYTHON_TRANSLATE.id]: BIOPYTHON_TRANSLATE,
  [BIOPYTHON_PROTEIN.id]: BIOPYTHON_PROTEIN,
  [EXACT_DEFINITIONS.id]: EXACT_DEFINITIONS,
  [PUBLISHED_SEQUENCES.id]: PUBLISHED_SEQUENCES,
  [PYDNA.id]: PYDNA,
  [NATIVE_HMMER.id]: NATIVE_HMMER,
  [WALLACE.id]: WALLACE,
  [GC_RULE.id]: GC_RULE,
  [GENBANK_TRANSLATION.id]: GENBANK_TRANSLATION,
  [REFERENCE_GENOME_DIGEST.id]: REFERENCE_GENOME_DIGEST,
  [PUBLISHED_QPCR.id]: PUBLISHED_QPCR,
  [SCIPY.id]: SCIPY,
  [STATSMODELS.id]: STATSMODELS,
  [PINGOUIN.id]: PINGOUIN,
  [LIFELINES.id]: LIFELINES,
  [SKLEARN.id]: SKLEARN,
  [GGTREE.id]: GGTREE,
};
