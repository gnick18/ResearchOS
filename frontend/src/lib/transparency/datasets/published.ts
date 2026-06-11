/**
 * Published / reference validation cases for the transparency page.
 *
 * Where the other datasets check ResearchOS against a peer software package run
 * under identical settings, these cases check it against values that already
 * exist in the published record: the protein a GenBank record annotates for its
 * own coding sequence, the fragment pattern a reference genome yields under a
 * textbook enzyme, and a slope/efficiency pair stated in a peer-reviewed paper.
 *
 * THE VERBATIM RULE. Every pinned value here was transcribed from the raw fetched
 * source (NCBI efetch GenBank text, PMC full-text XML), never from a summary and
 * never from memory. Each case carries its accession or DOI and a URL so a reader
 * can pull the same record and confirm the number byte for byte.
 *
 * No network and no filesystem at runtime: the sequences are embedded constants
 * so `buildTransparencyReport()` and its gate test stay pure and deterministic.
 */

import { LAMBDA_J02459 } from "./lambda-genome";

/* ------------------------------------------------ translation against GenBank */

/**
 * A coding sequence and the protein the GenBank record annotates for it
 * (its `/translation` qualifier). We feed the coding nucleotides (codon_start
 * honored, terminal stop codon dropped so the output is the annotated protein)
 * to our translator and require it to reproduce the record-supplied protein
 * residue for residue.
 */
export interface PublishedTranslateCase {
  id: string;
  label: string;
  /** Accession of the source record. */
  accession: string;
  /** CDS span as written in the record, for the reader. */
  cds: string;
  /** Source URL (the NCBI nuccore record). */
  url: string;
  /** Coding nucleotides (CDS without the terminal stop codon), frame 1. */
  seq: string;
  /** The record's own `/translation`, transcribed verbatim. */
  protein: string;
}

export const PUBLISHED_TRANSLATE_CASES: PublishedTranslateCase[] = [
  {
    id: "insulin_NM_000207",
    label: "Human insulin preproprotein (NM_000207.3)",
    accession: "NM_000207.3",
    cds: "60..392",
    url: "https://www.ncbi.nlm.nih.gov/nuccore/NM_000207.3",
    // CDS 60..392 of the mRNA, codon_start=1, terminal TAG stop dropped (110 codons).
    seq:
      "ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTGGCGCTGCTGGCCCTCTGGGGACCTGACCCAGCC" +
      "GCAGCCTTTGTGAACCAACACCTGTGCGGCTCACACCTGGTGGAAGCTCTCTACCTAGTGTGCGGG" +
      "GAACGAGGCTTCTTCTACACACCCAAGACCCGCCGGGAGGCAGAGGACCTGCAGGTGGGGCAGGTG" +
      "GAGCTGGGCGGGGGCCCTGGTGCAGGCAGCCTGCAGCCCTTGGCCCTGGAGGGGTCCCTGCAGAAG" +
      "CGTGGCATTGTGGAACAATGCTGTACCAGCATCTGCTCCCTCTACCAGCTGGAGAACTACTGCAAC",
    protein:
      "MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQV"
      + "ELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN",
  },
  {
    id: "egfp_U55762",
    label: "Enhanced green fluorescent protein (U55762)",
    accession: "U55762",
    cds: "679..1398",
    url: "https://www.ncbi.nlm.nih.gov/nuccore/U55762",
    // CDS 679..1398, codon_start=1, terminal TAA stop dropped (239 codons). The
    // record marks transl_table=11, whose internal codon assignments are
    // identical to the standard table; only alternative start codons differ, and
    // this CDS starts with ATG, so the standard-table read reproduces it exactly.
    seq:
      "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGAC" +
      "GTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACC" +
      "CTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACC" +
      "TACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCC" +
      "ATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGC" +
      "GCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAG" +
      "GAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATG" +
      "GCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGC" +
      "GTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGAC" +
      "AACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTC" +
      "CTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAG",
    protein:
      "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLT"
      + "YGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFK"
      + "EDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPD"
      + "NHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK",
  },
];

/* ----------------------------------------- restriction digest of a reference genome */

/**
 * A reference genome and the fragment-size pattern it yields under a textbook
 * enzyme. We digest the embedded sequence with our engine and require the full
 * fragment ladder to match the pattern computed from the same published record.
 */
export interface PublishedDigestCase {
  id: string;
  label: string;
  accession: string;
  url: string;
  /** The reference sequence (embedded verbatim from the record). */
  seq: string;
  circular: boolean;
  enzymeKey: string;
  enzymeName: string;
  /** Expected fragment lengths, descending, from the published sequence. */
  fragments: number[];
  /** Plain-language note about how this relates to the wet-lab marker, if any. */
  note?: string;
}

export const PUBLISHED_DIGEST_CASES: PublishedDigestCase[] = [
  {
    id: "puc19_ecori_L09137",
    label: "pUC19 linearized by EcoRI (L09137)",
    accession: "L09137",
    url: "https://www.ncbi.nlm.nih.gov/nuccore/L09137",
    seq:
      "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGC" +
      "GGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCG" +
      "GCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACC" +
      "GCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACG" +
      "CCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGT" +
      "AAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCG" +
      "TAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCA" +
      "TAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCA" +
      "GTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGC" +
      "TCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGG" +
      "CGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAG" +
      "GAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGC" +
      "TCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCT" +
      "CTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCATAG" +
      "CTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAG" +
      "CCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAG" +
      "CAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTA" +
      "CGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGC" +
      "TCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAA" +
      "AAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGAT" +
      "TTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAA" +
      "AGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTAT" +
      "TTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAG" +
      "TGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCC" +
      "GAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTA" +
      "GTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTAT" +
      "GGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGC" +
      "TCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATA" +
      "ATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATA" +
      "GTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAA" +
      "GTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGT" +
      "AACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAG" +
      "GCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTAT" +
      "TGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGG" +
      "TTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAA" +
      "TAGGCGTATCACGAGGCCCTTTCGTC",
    circular: true,
    enzymeKey: "ecori",
    enzymeName: "EcoRI",
    // The 2,686 bp pUC19 sequence has a single EcoRI site (GAATTC), so a circular
    // plasmid digest linearizes it to one full-length band. This is the textbook
    // pUC19 + EcoRI result.
    fragments: [2686],
  },
  {
    id: "lambda_hindiii_J02459",
    label: "Lambda genome digested by HindIII (J02459)",
    accession: "J02459",
    url: "https://www.ncbi.nlm.nih.gov/nuccore/J02459",
    seq: LAMBDA_J02459,
    circular: false,
    enzymeKey: "hindiii",
    enzymeName: "HindIII",
    // The deposited 48,502 bp linear lambda sequence contains exactly six HindIII
    // sites, yielding these seven fragments. The familiar wet-lab Lambda/HindIII
    // marker is often quoted as eight bands because the 12 nt cohesive cos ends of
    // the terminal fragments can anneal and because the 6,682 bp fragment is split
    // into 6,557 and 125 bp on some references; both are artifacts of the cos ends
    // and the marker preparation, not extra cut sites in the genome.
    fragments: [23130, 9416, 6682, 4361, 2322, 2027, 564],
    note:
      "Seven fragments from six HindIII sites in the deposited sequence; the "
      + "eight-band wet-lab marker reflects cos-end annealing and marker prep, not "
      + "an extra genomic site.",
  },
];

/* --------------------------------------------- qPCR amplification efficiency */

/**
 * A standard-curve slope and the amplification efficiency a published paper
 * pairs with it. We recompute efficiency from the slope with the standard
 * formula and require it to match the paper's reported percent within its own
 * whole-percent rounding.
 *
 * efficiency% = (10^(-1/slope) - 1) * 100
 *
 * All pairs are transcribed verbatim from Ahmed et al. 2022, "Minimizing errors
 * in RT-PCR detection and quantification of SARS-CoV-2 RNA for wastewater
 * surveillance," Science of the Total Environment 805:149877 (PMC8341816), which
 * states each slope with its efficiency in parentheses.
 */
export interface PublishedQpcrCase {
  id: string;
  label: string;
  /** Standard-curve slope (m), transcribed verbatim from the paper. */
  slope: number;
  /** The efficiency percent the paper pairs with that slope. */
  reportedPercent: number;
  /** Where in the paper this pair appears. */
  context: string;
}

export const PUBLISHED_QPCR_DOI =
  "10.1016/j.scitotenv.2021.149877";
export const PUBLISHED_QPCR_URL =
  "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8341816/";
export const PUBLISHED_QPCR_CITATION =
  "Ahmed et al. 2022, Sci. Total Environ. 805:149877 (PMC8341816)";

export const PUBLISHED_QPCR_CASES: PublishedQpcrCase[] = [
  {
    id: "qpcr_ideal_100",
    label: "Ideal standard curve",
    slope: -3.32,
    reportedPercent: 100,
    context: "100% efficiency is characterized by a slope of -3.32",
  },
  {
    id: "qpcr_cdc_n2_95",
    label: "US CDC N2 assay, mean slope",
    slope: -3.46,
    reportedPercent: 95,
    context: "mean slope of -3.46 (95%) for the US CDC N2 assay",
  },
  {
    id: "qpcr_range_low_110",
    label: "Acceptable-range upper efficiency",
    slope: -3.1,
    reportedPercent: 110,
    context: "acceptable range bound of -3.1 (110%)",
  },
  {
    id: "qpcr_range_high_90",
    label: "Acceptable-range lower efficiency",
    slope: -3.58,
    reportedPercent: 90,
    context: "acceptable range bound of -3.58 (90%)",
  },
  {
    id: "qpcr_reported_low_90",
    label: "Reported low slope (CDC N1 range)",
    slope: -3.6,
    reportedPercent: 90,
    context: "reported slopes ranged from -3.60 (90%)",
  },
  {
    id: "qpcr_reported_high_161",
    label: "Reported high efficiency (CDC N1 range)",
    slope: -2.4,
    reportedPercent: 161,
    context: "reported slopes ranged ... to -2.40 (161%)",
  },
];

/** Standard-curve amplification efficiency, in percent, from the slope. */
export function qpcrEfficiencyPercent(slope: number): number {
  return (10 ** (-1 / slope) - 1) * 100;
}
