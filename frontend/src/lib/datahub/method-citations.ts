// Data Hub method citations (the academic references a paper must cite for each
// statistical method the engine runs). Powers the Methods / Results writeup +
// the collected reference list (analysis-writeup.ts).
//
// ACCURACY IS THE WHOLE POINT. A wrong citation is worse than none. These are
// curated from canonical primary sources (the famous, stable papers that define
// each method). Each entry carries authors / year / title / venue, and a DOI ONLY
// where it is certain (most of the pre-1990 classics predate DOIs, so they carry
// none rather than a guessed one). Before any public-facing release, spot-verify
// the DOIs and page ranges against the primary source. NEVER add a reference from
// memory you are not sure of; verify it or leave it out.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** One bibliographic reference. `doi` is present only when certain. */
export interface Reference {
  /** Stable key, also the in-text anchor. */
  id: string;
  /** "Welch BL", or "Benjamini Y, Hochberg Y". Surname + initials, paper order. */
  authors: string;
  year: number;
  title: string;
  /** Journal or publisher, with volume/pages when known. */
  venue: string;
  doi?: string;
}

/**
 * The reference registry, keyed by a method id used across the writeup. Grouped
 * by family for review. Only entries the author is confident about are included;
 * a method without a confident primary citation is omitted here and the writeup
 * simply names it without a reference (honest over wrong).
 */
export const REFERENCES: Record<string, Reference> = {
  // --- t-tests and their rank-based alternatives ---
  studentT: {
    id: "studentT",
    authors: "Student",
    year: 1908,
    title: "The probable error of a mean",
    venue: "Biometrika 6(1):1-25",
  },
  welchT: {
    id: "welchT",
    authors: "Welch BL",
    year: 1947,
    title:
      "The generalization of 'Student's' problem when several different population variances are involved",
    venue: "Biometrika 34(1-2):28-35",
  },
  mannWhitney: {
    id: "mannWhitney",
    authors: "Mann HB, Whitney DR",
    year: 1947,
    title:
      "On a test of whether one of two random variables is stochastically larger than the other",
    venue: "Annals of Mathematical Statistics 18(1):50-60",
  },
  wilcoxonSignedRank: {
    id: "wilcoxonSignedRank",
    authors: "Wilcoxon F",
    year: 1945,
    title: "Individual comparisons by ranking methods",
    venue: "Biometrics Bulletin 1(6):80-83",
  },

  // --- ANOVA, its nonparametric kin, and post-hoc tests ---
  fisherAnova: {
    id: "fisherAnova",
    authors: "Fisher RA",
    year: 1925,
    title: "Statistical Methods for Research Workers",
    venue: "Oliver and Boyd, Edinburgh",
  },
  kruskalWallis: {
    id: "kruskalWallis",
    authors: "Kruskal WH, Wallis WA",
    year: 1952,
    title: "Use of ranks in one-criterion variance analysis",
    venue: "Journal of the American Statistical Association 47(260):583-621",
  },
  friedman: {
    id: "friedman",
    authors: "Friedman M",
    year: 1937,
    title:
      "The use of ranks to avoid the assumption of normality implicit in the analysis of variance",
    venue: "Journal of the American Statistical Association 32(200):675-701",
  },
  tukeyHSD: {
    id: "tukeyHSD",
    authors: "Tukey JW",
    year: 1949,
    title: "Comparing individual means in the analysis of variance",
    venue: "Biometrics 5(2):99-114",
  },
  dunnett: {
    id: "dunnett",
    authors: "Dunnett CW",
    year: 1955,
    title:
      "A multiple comparison procedure for comparing several treatments with a control",
    venue: "Journal of the American Statistical Association 50(272):1096-1121",
  },

  // --- effect sizes ---
  cohensD: {
    id: "cohensD",
    authors: "Cohen J",
    year: 1988,
    title: "Statistical Power Analysis for the Behavioral Sciences, 2nd ed.",
    venue: "Lawrence Erlbaum Associates, Hillsdale NJ",
  },
  hedgesG: {
    id: "hedgesG",
    authors: "Hedges LV",
    year: 1981,
    title: "Distribution theory for Glass's estimator of effect size and related estimators",
    venue: "Journal of Educational Statistics 6(2):107-128",
  },

  // --- assumption checks ---
  shapiroWilk: {
    id: "shapiroWilk",
    authors: "Shapiro SS, Wilk MB",
    year: 1965,
    title: "An analysis of variance test for normality (complete samples)",
    venue: "Biometrika 52(3-4):591-611",
  },
  brownForsythe: {
    id: "brownForsythe",
    authors: "Brown MB, Forsythe AB",
    year: 1974,
    title: "Robust tests for the equality of variances",
    venue: "Journal of the American Statistical Association 69(346):364-367",
  },

  // --- correlation ---
  spearman: {
    id: "spearman",
    authors: "Spearman C",
    year: 1904,
    title: "The proof and measurement of association between two things",
    venue: "American Journal of Psychology 15(1):72-101",
  },

  // --- regression depth ---
  firth: {
    id: "firth",
    authors: "Firth D",
    year: 1993,
    title: "Bias reduction of maximum likelihood estimates",
    venue: "Biometrika 80(1):27-38",
    doi: "10.1093/biomet/80.1.27",
  },
  fourPL: {
    id: "fourPL",
    authors: "DeLean A, Munson PJ, Rodbard D",
    year: 1978,
    title:
      "Simultaneous analysis of families of sigmoidal curves: application to bioassay, radioligand assay, and physiological dose-response curves",
    venue: "American Journal of Physiology 235(2):E97-E102",
  },
  aicc: {
    id: "aicc",
    authors: "Hurvich CM, Tsai CL",
    year: 1989,
    title: "Regression and time series model selection in small samples",
    venue: "Biometrika 76(2):297-307",
  },

  // --- survival ---
  kaplanMeier: {
    id: "kaplanMeier",
    authors: "Kaplan EL, Meier P",
    year: 1958,
    title: "Nonparametric estimation from incomplete observations",
    venue: "Journal of the American Statistical Association 53(282):457-481",
  },
  logRankMantel: {
    id: "logRankMantel",
    authors: "Mantel N",
    year: 1966,
    title:
      "Evaluation of survival data and two new rank order statistics arising in its consideration",
    venue: "Cancer Chemotherapy Reports 50(3):163-170",
  },
  gehan: {
    id: "gehan",
    authors: "Gehan EA",
    year: 1965,
    title:
      "A generalized Wilcoxon test for comparing arbitrarily singly-censored samples",
    venue: "Biometrika 52(1-2):203-223",
  },
  coxPH: {
    id: "coxPH",
    authors: "Cox DR",
    year: 1972,
    title: "Regression models and life-tables",
    venue: "Journal of the Royal Statistical Society, Series B 34(2):187-220",
  },

  // --- diagnostics, outliers, multiplicity, resampling ---
  grubbs: {
    id: "grubbs",
    authors: "Grubbs FE",
    year: 1969,
    title: "Procedures for detecting outlying observations in samples",
    venue: "Technometrics 11(1):1-21",
  },
  routMotulsky: {
    id: "routMotulsky",
    authors: "Motulsky HJ, Brown RE",
    year: 2006,
    title:
      "Detecting outliers when fitting data with nonlinear regression: a new method based on robust nonlinear regression and the false discovery rate",
    venue: "BMC Bioinformatics 7:123",
    doi: "10.1186/1471-2105-7-123",
  },
  rocHanley: {
    id: "rocHanley",
    authors: "Hanley JA, McNeil BJ",
    year: 1982,
    title:
      "The meaning and use of the area under a receiver operating characteristic (ROC) curve",
    venue: "Radiology 143(1):29-36",
  },
  benjaminiHochberg: {
    id: "benjaminiHochberg",
    authors: "Benjamini Y, Hochberg Y",
    year: 1995,
    title:
      "Controlling the false discovery rate: a practical and powerful approach to multiple testing",
    venue: "Journal of the Royal Statistical Society, Series B 57(1):289-300",
  },
  efronBootstrap: {
    id: "efronBootstrap",
    authors: "Efron B",
    year: 1979,
    title: "Bootstrap methods: another look at the jackknife",
    venue: "Annals of Statistics 7(1):1-26",
  },

  // --- contingency ---
  pearsonChiSquare: {
    id: "pearsonChiSquare",
    authors: "Pearson K",
    year: 1900,
    title:
      "On the criterion that a given system of deviations from the probable in the case of a correlated system of variables is such that it can be reasonably supposed to have arisen from random sampling",
    venue: "Philosophical Magazine, Series 5, 50(302):157-175",
  },
  fisherExact: {
    id: "fisherExact",
    authors: "Fisher RA",
    year: 1922,
    title: "On the interpretation of chi-square from contingency tables, and the calculation of P",
    venue: "Journal of the Royal Statistical Society 85(1):87-94",
  },
};

/**
 * Open-source software the engine actually computes with, that warrants an
 * academic citation. The app itself is always cited; specific compute libraries
 * are cited when they carry the published statistic. The full installed-license
 * list lives in /open-source (credits.json); this is the SMALL set with a
 * preferred academic citation, not a license attribution dump.
 */
export const SOFTWARE_CITATIONS: Reference[] = [
  {
    id: "researchosDataHub",
    authors: "ResearchOS",
    year: 2026,
    title:
      "ResearchOS Data Hub: an open, client-side statistical analysis and scientific plotting environment",
    venue: "https://research-os.app",
  },
];

/** Format a reference as a single plain-text line (author-year-title-venue). */
export function formatReference(r: Reference): string {
  // A title that already ends in a period (e.g. "2nd ed.") must not double up.
  const title = r.title.endsWith(".") ? r.title : `${r.title}.`;
  const base = `${r.authors} (${r.year}). ${title} ${r.venue}.`;
  return r.doi ? `${base} https://doi.org/${r.doi}` : base;
}

/** Short in-text form, "Welch 1947" / "Benjamini and Hochberg 1995". */
export function inTextCite(r: Reference): string {
  // One surname -> "Surname year"; two -> "A and B year"; more -> "A et al. year".
  const names = r.authors
    .split(",")
    .map((a) => a.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (names.length === 1) return `${names[0]} ${r.year}`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${r.year}`;
  return `${names[0]} et al. ${r.year}`;
}
