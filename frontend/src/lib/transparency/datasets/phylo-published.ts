/**
 * Published-tree reproduction cases for the transparency page.
 *
 * Where the phylo-ggtree domain proves our Tree Studio RENDERS a tree the way
 * ggtree does, these cases prove the other half: that the Tree Builder's
 * GENERATED pipeline, run on a real paper's input, recovers that paper's
 * published tree. The metric is the Robinson-Foulds distance (lib/phylo/rf.ts)
 * over the shared taxa, plus the percent of published clades recovered.
 *
 * THE OFFLINE-RESULT CONTRACT (mirrors the ggtree golden). We never run a tree
 * search on a server and ML search is stochastic, so the result tree cannot be
 * computed in CI. Each case ships its paper's VERBATIM input under
 * datasets/phylo-published/<case>/ plus the exact BuilderOptions, and a PENDING
 * result.json placeholder. A human runs scripts/run-phylo-published-case.sh
 * <case> ONCE offline, which rewrites result.json with the resulting Newick and
 * pending = false. Until a case's result lands the gate skips it, so CI never
 * reds on a tree no one has computed. This module stays a pure import: no
 * filesystem and no network at runtime, the published trees are inlined as
 * constants and the results are imported JSON.
 *
 * THE PUBLISHED TREE IS HELD IN CODE. A case scores its result against a
 * published comparison tree that lives here as a string constant (same reason the
 * ggtree golden is committed JSON, the gate must not read the disk). A case whose
 * published tree is not sourced yet carries publishedNewick = null and is treated
 * as not ready, even if a result somehow lands.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { BuilderOptions } from "@/lib/phylo/catalog";
import { leaves, parseTree, type TreeNode } from "@/lib/phylo/parse";
import { compareTrees, type RfResult } from "@/lib/phylo/rf";

import { HPV58_NWK } from "./phylo-trees";
import hpv58Options from "./phylo-published/hpv58/builder-options.json";
import craugastorOptions from "./phylo-published/craugastor/builder-options.json";
import opsinOptions from "./phylo-published/firefly_opsin/builder-options.json";
import hpv58Result from "./phylo-published/hpv58/result.json";
import craugastorResult from "./phylo-published/craugastor/result.json";
import opsinResult from "./phylo-published/firefly_opsin/result.json";

/**
 * The Streicher, Crawford & Edwards 2009 Craugastor podiciferus complex tree
 * (Mol Phylogenet Evol 53:620-630), the published "Fig. 2" topology, verbatim
 * from the study's TreeBASE submission (S10103, tree Fig._2) with its numeric tip
 * ids substituted for the submission's own TRANSLATE-table labels (a mechanical
 * lookup, never hand-drawn). 47 tips, topology only (no support values), which is
 * why this case is scored by an RF tolerance rather than the support-aware rule.
 */
const CRAUGASTOR_PUBLISHED_NWK =
  "((Craugastor_tabasarae_MVUP_1720,(Craugastor_cf._longirostris_FMNH_257678,Craugastor_cf._longirostris_FMNH_257561)),(((((Craugastor_cf._podiciferus_FMNH_257672,Craugastor_cf._podiciferus_MVZ_149813,Craugastor_cf._podiciferus_UCR_16361,Craugastor_cf._podiciferus_FMNH_257670,Craugastor_cf._podiciferus_FMNH_257669),((Craugastor_cf._podiciferus_UCR_16355,Craugastor_cf._podiciferus_UCR_16354,Craugastor_cf._podiciferus_UCR_16353),((Craugastor_cf._podiciferus_FMNH_257671,Craugastor_cf._podiciferus_FMNH_257673),Craugastor_cf._podiciferus_UTA_A_52449))),(((Craugastor_cf._podiciferus_UCR_16356,(Craugastor_cf._podiciferus_UCR_16358,Craugastor_cf._podiciferus_UCR_16357)),(Craugastor_cf._podiciferus_UCR_17462,Craugastor_cf._podiciferus_UCR_17469),(Craugastor_cf._podiciferus_FMNH_257596,Craugastor_cf._podiciferus_FMNH_257595)),((Craugastor_cf._podiciferus_UCR_17439,Craugastor_cf._podiciferus_UCR_17442,Craugastor_cf._podiciferus_UCR_17441,Craugastor_cf._podiciferus_UCR_17443),(Craugastor_cf._podiciferus_UCR_18062,Craugastor_cf._podiciferus_MVZ_164825)))),((((Craugastor_cf._podiciferus_FMNH_257653,Craugastor_cf._podiciferus_FMNH_257550),Craugastor_cf._podiciferus_FMNH_257757,Craugastor_cf._podiciferus_FMNH_257756,(Craugastor_cf._podiciferus_FMNH_257652,Craugastor_cf._podiciferus_FMNH_257651),Craugastor_cf._podiciferus_FMNH_257755),Craugastor_cf._podiciferus_FMNH_257758),(Craugastor_cf._podiciferus_UCR_16360,Craugastor_cf._podiciferus_UCR_16359))),((((Craugastor_sp._A_USNM_563039,Craugastor_sp._A_USNM_563040),(Craugastor_sp._A_AJC_0891,Craugastor_sp._A_AJC_0890)),(Craugastor_sp._A_FMNH_257689,Craugastor_sp._A_FMNH_257562)),((Craugastor_stejnegerianus_UCR_16332,Craugastor_bransfordii_MVUP_1875),(Craugastor_underwoodi_UCR_16315,Craugastor_underwoodi_USNM_561403)))));";

/** The committed result of one offline recipe run (or the pending placeholder). */
export interface PublishedRunResult {
  /** true while no offline run has landed yet (the shipped placeholder). */
  pending: boolean;
  /** The Newick our generated recipe produced, or null while pending. */
  oursNewick: string | null;
  /** Free-text tool versions used in the offline run, for the page. */
  toolVersions: string | null;
  /** When the offline run was done, for the page (set by the run helper). */
  ranAt: string | null;
}

/** One published-tree reproduction case. */
export interface PhyloPublishedCase {
  /** Stable id, matches the case folder name. */
  id: string;
  /** Human label for the page. */
  label: string;
  /** A one-line description of the data type and pipeline. */
  kind: string;
  /** Short provenance line shown on the page. */
  source: string;
  /** Citation (DOI / accession) shown on the page. */
  citation: string;
  /**
   * The paper's published tree, VERBATIM, as Newick or NEXUS, or null when it is
   * not sourced yet (the case then stays inactive). Held in code so the gate is a
   * pure import.
   */
  publishedNewick: string | null;
  /** The exact BuilderOptions the recipe was generated from. */
  options: BuilderOptions;
  /** The committed offline-run result, or the pending placeholder. */
  result: PublishedRunResult;
  /**
   * Per-case "well-supported" cutoff. A case passes when no published clade at or
   * above this support is missed (Grant's locked decision: differences must be
   * confined to weakly supported branches). Defaults to WELL_SUPPORTED_CUTOFF.
   * Set it per case only if a study's support scale warrants a different bar.
   */
  supportCutoff?: number;
  /**
   * Per-case normalized-RF tolerance, for a published tree that carries NO branch
   * support (so the support-aware rule cannot apply). When set, the case passes
   * when its normalized Robinson-Foulds distance is at or below this bound. A case
   * declares EITHER a supportCutoff (support-bearing tree) or an rfTolerance
   * (support-less tree); rfTolerance takes precedence when both are somehow set.
   */
  rfTolerance?: number;
}

/**
 * The "well-supported" bootstrap cutoff. 70 is the field standard, anchored by
 * Hillis & Bull 1993 (Syst Biol 42:182): bootstrap proportions at or above 70%
 * correspond to roughly a 95% probability the clade is real. We judge the
 * PUBLISHED tree's clades against this, since the published trees we score
 * against carry standard-bootstrap-scale support.
 */
export const WELL_SUPPORTED_CUTOFF = 70;

/**
 * The published-tree reproduction cases. v1 spans the three data types: a
 * nucleotide single locus (hpv58), a nucleotide concatenated supermatrix
 * (turtle), and a protein single gene (firefly_opsin). hpv58 is ready to activate
 * once the offline run lands; turtle and firefly_opsin also need a published tree
 * (turtle) or both files (opsin) sourced first, see each folder's SOURCES.md.
 */
export const PHYLO_PUBLISHED_CASES: PhyloPublishedCase[] = [
  {
    id: "hpv58",
    label: "HPV58 whole-genome phylogeny (90 tips)",
    kind: "Nucleotide single locus: MAFFT, trimAl, IQ-TREE + ModelFinder + UFBoot",
    source: "90 complete HPV58 genomes from GenBank (NCBI efetch, verbatim)",
    citation:
      "Published tree: ggtree HPV58 example (Yu et al. 2017, Methods Ecol Evol 8:28-36). "
      + "Input: GenBank nuccore complete genomes.",
    // The published tree is the same HPV58 phylogeny we seed the demo with, reused
    // as the single source of truth rather than committing a second copy.
    publishedNewick: HPV58_NWK,
    options: hpv58Options as BuilderOptions,
    result: hpv58Result as PublishedRunResult,
  },
  {
    id: "craugastor",
    label: "Craugastor frog multilocus supermatrix (47 taxa)",
    kind:
      "Nucleotide concatenated supermatrix: 4 gene partitions (12S/16S/CO1/c-myc), "
      + "IQ-TREE + ModelFinder + UFBoot",
    source:
      "Streicher et al. 2009 Craugastor podiciferus complex, 4 genes / 1658 bp / 47 "
      + "taxa (TreeBASE S10103, verbatim)",
    citation:
      "Streicher JW, Crawford AJ, Edwards CW. Mol Phylogenet Evol. 2009;53(3):620-630. "
      + "Data: TreeBASE study S10103.",
    publishedNewick: CRAUGASTOR_PUBLISHED_NWK,
    options: craugastorOptions as BuilderOptions,
    result: craugastorResult as PublishedRunResult,
    // The published Fig. 2 tree is a topology with no branch support, so this case
    // is scored by a normalized-RF tolerance, not the support-aware rule. The bound
    // is provisional until the offline run lands; tighten or loosen it to match the
    // honest reproduction at activation.
    rfTolerance: 0.15,
  },
  {
    id: "firefly_opsin",
    label: "Firefly UV-opsin gene tree (protein)",
    kind: "Protein single gene: IQ-TREE + ModelFinder (LG family) + UFBoot",
    source: "Sander & Hall 2015 opsin alignment + BEAST tree (Dryad, human download)",
    citation:
      "Sander SE, Hall DW. Mol Ecol. 2015;24(18):4679-4696. doi:10.1111/mec.13346. "
      + "Data: Dryad doi:10.5061/dryad.q878c",
    // Both the alignment and the published BEAST tree come from Dryad, which blocks
    // scripted download, so a human drops the files in. See
    // phylo-published/firefly_opsin/SOURCES.md.
    publishedNewick: null,
    options: opsinOptions as BuilderOptions,
    result: opsinResult as PublishedRunResult,
  },
];

/**
 * Is a case fully ready to score? It needs a sourced published tree AND a landed
 * offline result (not the pending placeholder, with a non-empty Newick).
 */
export function caseIsReady(c: PhyloPublishedCase): boolean {
  return (
    c.publishedNewick !== null
    && !c.result.pending
    && typeof c.result.oursNewick === "string"
    && c.result.oursNewick.trim().length > 0
  );
}

/** The cases that are ready to score right now. */
export function readyCases(): PhyloPublishedCase[] {
  return PHYLO_PUBLISHED_CASES.filter(caseIsReady);
}

/** Is at least one case ready? The gate skips entirely when none are. */
export function anyCaseReady(): boolean {
  return readyCases().length > 0;
}

/**
 * Score one case by Robinson-Foulds, or null when the case is not ready. Parses
 * both trees (our result and the published tree) and delegates to compareTrees,
 * which restricts the comparison to the shared taxa and is unrooted-safe.
 */
export function comparePublishedCase(c: PhyloPublishedCase): RfResult | null {
  if (!caseIsReady(c) || c.publishedNewick === null || c.result.oursNewick === null) {
    return null;
  }
  const ours: TreeNode = parseTree(c.result.oursNewick);
  const published: TreeNode = parseTree(c.publishedNewick);
  return compareTrees(ours, published);
}

/**
 * The verdict for a ready case. A case is judged one of two honest ways. A
 * support-bearing published tree uses the SUPPORT mode (Grant's locked rule: no
 * well-supported clade missed). A support-less published tree (topology only)
 * uses the RF mode (normalized Robinson-Foulds at or below a committed bound),
 * since there is no support to confine differences to.
 */
export interface ReproductionVerdict {
  /** Which criterion judged this case. */
  mode: "support" | "rf";
  /** The full RF comparison. */
  rf: RfResult;
  /** True when the case passes its criterion. */
  pass: boolean;
  /** The "well-supported" cutoff applied (support mode), else the WELL_SUPPORTED_CUTOFF default. */
  cutoff: number;
  /**
   * Published clades we missed whose support is at or above the cutoff. ZERO is a
   * support-mode pass. Always 0 in RF mode (a support-less tree has none).
   */
  wellSupportedMissed: number;
  /** Missed clades below the cutoff (or with no support value), the expected noise. */
  weaklySupportedMissed: number;
  /** The highest support among the missed clades, or null when none were missed. */
  maxMissingSupport: number | null;
  /** The normalized-RF bound applied in RF mode, or null in support mode. */
  rfTolerance: number | null;
}

/**
 * Judge a ready case. RF mode when the case declares an rfTolerance (its
 * published tree carries no support); otherwise support mode (no published clade
 * at or above the cutoff may be missed, a missing clade with no support value is
 * treated as weakly supported). Returns null when the case is not ready.
 */
export function reproductionVerdict(c: PhyloPublishedCase): ReproductionVerdict | null {
  const rf = comparePublishedCase(c);
  if (!rf) return null;
  const cutoff = c.supportCutoff ?? WELL_SUPPORTED_CUTOFF;
  let wellSupportedMissed = 0;
  let weaklySupportedMissed = 0;
  let maxMissingSupport: number | null = null;
  for (const s of rf.missingFromOursSupport) {
    if (s !== null) {
      maxMissingSupport = maxMissingSupport === null ? s : Math.max(maxMissingSupport, s);
      if (s >= cutoff) wellSupportedMissed++;
      else weaklySupportedMissed++;
    } else {
      weaklySupportedMissed++;
    }
  }
  if (c.rfTolerance !== undefined) {
    return {
      mode: "rf",
      rf,
      pass: rf.normalizedRf <= c.rfTolerance,
      cutoff,
      wellSupportedMissed: 0,
      weaklySupportedMissed: rf.missingFromOurs.length,
      maxMissingSupport,
      rfTolerance: c.rfTolerance,
    };
  }
  return {
    mode: "support",
    rf,
    pass: wellSupportedMissed === 0,
    cutoff,
    wellSupportedMissed,
    weaklySupportedMissed,
    maxMissingSupport,
    rfTolerance: null,
  };
}

/** Tip count of a case's published tree, or 0 when it is not sourced yet. */
export function publishedTipCount(c: PhyloPublishedCase): number {
  if (c.publishedNewick === null) return 0;
  return leaves(parseTree(c.publishedNewick)).length;
}

/** A one-line plain summary of the generated recipe, for the page. */
export function recipeSummary(o: BuilderOptions): string {
  const data = o.dataType === "protein" ? "protein" : "nucleotide";
  const analysis =
    o.analysis === "supermatrix"
      ? "concatenated supermatrix"
      : o.analysis === "coalescent"
        ? "coalescent species tree"
        : "single locus";
  const align = o.align === "skip" ? "pre-aligned input" : `align with ${o.align}`;
  const model = o.model === "fixed" ? o.fixedModel : "ModelFinder";
  const support = o.support === "ufboot" ? "UFBoot" : o.support === "bootstrap" ? "bootstrap" : "no support";
  return `${data} ${analysis}, ${align}, ${o.infer} + ${model} + ${support}`;
}

/**
 * Why a case is not ready, for the page, or null when it is ready. Distinguishes
 * "no published tree sourced yet" from "no offline run yet" so the pending copy is
 * honest about what is missing.
 */
export function pendingReason(c: PhyloPublishedCase): string | null {
  if (caseIsReady(c)) return null;
  if (c.publishedNewick === null) {
    return "The published comparison tree is not sourced yet (see this case's SOURCES.md).";
  }
  return "No offline recipe run has been committed yet. Run scripts/run-phylo-published-case.sh to activate.";
}
