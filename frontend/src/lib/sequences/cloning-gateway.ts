// cloning bot — PURE in-silico GATEWAY recombinational cloning engine
// (att-site BP and LR reactions), alongside the overlap (Gibson) engine in
// cloning.ts and the cut-and-ligate engine in cut-ligate.ts.
//
// A wrong recombinant is a real molecular-biology bug, so EVERYTHING here is
// pure, deterministic, DOM-free, and validated by a HAND-DERIVED reconciliation
// gate plus the published canonical att-site sequences
// (cloning-gateway.golden.test.ts). No React, no disk, no network.
//
// THE BIOLOGY (lambda site-specific recombination, the Gateway System)
// ====================================================================
// Gateway cloning moves a DNA segment between vectors by site-specific
// recombination between "att" sites, with NO restriction digestion and NO
// ligation. Lambda Integrase + IHF (BP Clonase) or Int + Xis + IHF (LR Clonase)
// bind the att sites, cleave within a short shared CORE, exchange strands, and
// religate. The reaction is CONSERVATIVE (no net gain/loss of bases) and the
// crossover happens inside a core region common to all att sites of the same
// specificity number (Landy 1989; Hartley et al. 2000).
//
//   BP reaction (Int + IHF):   attB x attP  ->  attL x attR
//   LR reaction (Int+Xis+IHF): attL x attR  ->  attB x attP
//
// DIRECTIONALITY (the "1" vs "2" specificity)
// -------------------------------------------
// Each att site carries a specificity number. attX1 recombines ONLY with the
// matching partner's site 1, attX2 ONLY with site 2 (Thermo Fisher Gateway
// manual: "attB1 sites react only with attP1 sites", etc.). A substrate that
// presents site 1 on its left and site 2 on its right therefore recombines into
// its partner in a SINGLE defined orientation. That is what makes Gateway
// directional with no ligation step.
//
// THE CROSSOVER, MODELED EXACTLY
// ------------------------------
// We model each att site as three parts on the top strand 5'->3':
//     [ 5' arm ] [ shared CORE ] [ 3' arm ]
// The CORE is the stretch common to all four att sites of that specificity
// number (the recombination crossover region; e.g. site 1 core
// "TTTGTACAAAAAAG"). Recombination is a crossover INSIDE the core: the two
// product sites each take one parent's 5' arm and the OTHER parent's 3' arm,
// with the shared core in between (conservative, no bases invented).
//
// For a substrate molecule  ...5'flankA-[att(left)]-INSERT-[att(right)]-3'flankB...
// recombining with partner  ...[att(left)']-CASSETTE-[att(right)']...  the INSERT
// transfers to the partner backbone and the cassette (ccdB / negative selection)
// transfers out, exactly as in the wet-lab BP/LR reactions. Each gene-flanking
// product att site is the crossover recombinant of the two input att sites at
// that position, computed base-by-base:
//
//     product_att = inputForBackbone.fivePrimeArm
//                 + sharedCore
//                 + inputForInsert.threePrimeArm
//
// (the strand that ends up adjacent to the insert contributes the 3' arm; the
// strand that ends up adjacent to the new backbone contributes the 5' arm).
//
// VERIFICATION THAT THIS REPRODUCES THE PUBLISHED SITES
// -----------------------------------------------------
// For the canonical Gateway site-1 reagents this crossover rule reproduces the
// published sequences EXACTLY. In an LR reaction attL1 x attR1 -> attB1, the
// product attB1 = attR1[5'arm + core] + attL1[3'arm] equals the published 25 bp
// attB1 site to the base (see the golden suite's hand trace). In the BP
// direction attB1 x attP1 -> attL1, the crossover product ends with the
// published gene-proximal attL1. The cassette-side BYPRODUCT att site is the
// mechanistic recombinant of the two input flanks; note that a vendor's
// "canonical" attP/attR can differ from a naive arm swap by ENGINEERED POINT
// MUTATIONS deliberately introduced to make the reaction efficient/irreversible
// (Thermo manual: "site-specific point mutations have been made to some att
// sites... sequence variations may exist among the att sites"; "A 43 bp portion
// of the attR site has been removed to make the attL x attR reaction
// irreversible"). We therefore compute the byproduct as the true crossover
// recombinant of the supplied inputs and label it as such; we never fabricate a
// vendor lookup sequence for it.
//
// COORDINATES + FEATURES
// ----------------------
// Insert features use 0-based, end-EXCLUSIVE [start, end) intervals on the
// insert's own forward strand, same as cloning.ts. They are rebased into the
// circular product by a pure additive shift (reuse `rebaseFeatures`).
//
// SCOPE (v1)
// ----------
// Single-fragment (standard) BP and LR with site 1 / site 2 specificity. The
// att-site MODEL (arm + core + arm, keyed by a specificity number) is built to
// extend to MultiSite Gateway (attB1/B4/B3 ...) later without reshaping the data;
// the full MultiSite grammar (3+ simultaneous crossovers in one tube) is NOT
// implemented here and is noted as future work.

import { reverseComplement } from "./primer";
import { canonicalCircular } from "./cut-ligate";
import { rebaseFeatures, type CloneFeature, type AssembledProduct, type FragmentSpan } from "./cloning";

// ============================================================================
// VERIFIED att-site CONSTANTS  (sourced, NEVER fabricated)
// ============================================================================
//
// SOURCES (each constant is traceable to a primary/public reference):
//   [1] Thermo Fisher Scientific, "Gateway Technology — A universal technology
//       to clone DNA sequences for functional analysis and expression in
//       multiple systems" (Invitrogen manual, Cat. 12535-019 / 12535-027).
//       https://documents.thermofisher.com/TFS-Assets/LSG/manuals/gatewayman.pdf
//       Verbatim from that manual:
//         attB1 adapter primer:  5'-GGGGACAAGTTTGTACAAAAAAGCAGGCT-3'  (p. "Adapter Primers")
//         attB2 adapter primer:  5'-GGGGACCACTTTGTACAAGAAAGCTGGGT-3'
//         "Four guanine (G) residues at the 5' end followed by the 25 bp attB1 site"
//         => attB1 site (25 bp) = ACAAGTTTGTACAAAAAAGCAGGCT
//       Mechanism: "the actual crossover occurs between homologous 15 bp core
//       regions"; "attB1 sites react only with attP1 sites", etc.
//   [2] Hartley, Temple & Brasch (2000) "DNA cloning using in vitro
//       site-specific recombination." Genome Research 10:1788-1795. (Defines the
//       Gateway BP/LR reactions and the modified att sites.)
//   [3] Landy (1989) "Dynamic, structural, and regulatory aspects of lambda
//       site-specific recombination." Annu. Rev. Biochem. 58:913-949. (The
//       lambda att recombination mechanism + the conserved core.)
//   [4] Kwan lab Tol2kit "att sequence list" (public reference compilation of
//       the full Gateway att-site sequences used for in-silico expression-clone
//       prediction): https://tol2kitkwan.genetics.utah.edu/index.php/Att_seq_list
//       The full attP/attL/attR site sequences below are transcribed VERBATIM
//       from that page's FASTA records and cross-checked against [1] for the
//       attB sites and the shared cores.
//
// NOTE ON VARIANTS: site-1 vs site-2 att sites are NOT simple base-for-base
// arm swaps of each other because the vendor introduced engineered point
// mutations (see [1]). The constants below are the published sequences; the
// engine derives products by crossover, which matches the published attB1/attL1
// gene-proximal junction exactly (proven in the golden suite).

/** A single att site, decomposed into the parts the crossover operates on. */
export interface AttSite {
  /** Site name, e.g. "attB1". */
  name: string;
  /** Recombination family: "B" | "P" | "L" | "R". */
  family: AttFamily;
  /** Specificity number (1 or 2 for standard Gateway; extensible to 3/4/5 for
   *  MultiSite). Only matching numbers recombine. */
  specificity: number;
  /** Full top-strand sequence, 5'->3', as published. */
  seq: string;
}

export type AttFamily = "B" | "P" | "L" | "R";

/** The shared crossover CORE for each specificity number (the stretch common to
 *  all four att families of that number; crossover occurs inside it). Sourced
 *  from the Kwan att list "shared" records [4] and consistent with the 15 bp
 *  core described in the Thermo manual [1]. */
export const ATT_CORE: Record<number, string> = {
  // att1_shared (Kwan [4]); present verbatim in attB1/attP1/attL1/attR1.
  1: "TTTGTACAAAAAAG",
  // att2_shared (Kwan [4]); the site-2 core. (attB2/attL2 share "CTTTCTTGTACAAAGT";
  // attP2/attR2 carry vendor point variants in the flanks per [1].)
  2: "CTTTCTTGTACAAAGT",
};

// --- VERIFIED canonical site sequences (verbatim, see SOURCES above) ---------
// Site 1
export const ATTB1 = "CAAGTTTGTACAAAAAAGCAGGCT"; // 24 bp site core (manual 25 bp incl. leading A: ACAAG...; Kwan lists 24 bp form) [1][4]
export const ATTP1 =
  "AAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACACATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA"; // [4]
export const ATTL1 =
  "TGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCAGGCT"; // gene-proximal attL1 (50 bp) [4]
export const ATTR1 =
  "CAAGTTTGTACAAAAAAGTTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATGCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA"; // [4]
// Site 2
export const ATTB2 = "ACCCAGCTTTCTTGTACAAAGTGG"; // [4]; manual adapter GGGGACCACTTTGTACAAGAAAGCTGGGT is the reverse-strand form [1]
export const ATTP2 =
  "AATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAGAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA"; // [4]
export const ATTL2 =
  "ACCCAGCTTTCTTGTACAAAGTTGGCATTATAAGAAAGCATTGCTTATCAATTTGTTGCAACGAACAGGTCACTATCAGTCAAAATAAAATCATTATTTG"; // [4]
export const ATTR2 =
  "TTGTGTTTTACAGTATTATGTAGTCTGTTTTTTATGCAAAATCTAATTTAATATATTGATATTTATATCATTTTACGTTTCTCGTTCAACTTTCTTGTACAAAGTGG"; // [4]

/** The verified canonical sites, keyed by name, for the standard reagents. */
export const CANONICAL_ATT: Record<string, AttSite> = {
  attB1: { name: "attB1", family: "B", specificity: 1, seq: ATTB1 },
  attB2: { name: "attB2", family: "B", specificity: 2, seq: ATTB2 },
  attP1: { name: "attP1", family: "P", specificity: 1, seq: ATTP1 },
  attP2: { name: "attP2", family: "P", specificity: 2, seq: ATTP2 },
  attL1: { name: "attL1", family: "L", specificity: 1, seq: ATTL1 },
  attL2: { name: "attL2", family: "L", specificity: 2, seq: ATTL2 },
  attR1: { name: "attR1", family: "R", specificity: 1, seq: ATTR1 },
  attR2: { name: "attR2", family: "R", specificity: 2, seq: ATTR2 },
};

// ============================================================================
// TYPES
// ============================================================================

/** Which recombination the user is running. */
export type GatewayReaction = "BP" | "LR";

/** An att site located on a substrate's top strand at [start, end). */
export interface LocatedAtt extends AttSite {
  /** 0-based start on the substrate top strand. */
  start: number;
  /** 0-based end-exclusive on the substrate top strand. */
  end: number;
}

/** A Gateway substrate molecule (entry clone, donor, destination, attB-PCR
 *  product, etc.). Gateway substrates are normally circular/supercoiled; the
 *  attB-PCR product is linear. */
export interface GatewaySubstrate {
  name: string;
  /** Top-strand sequence, 5'->3'. */
  seq: string;
  /** True if a closed circle (donor / destination / entry / expression vectors).
   *  The attB-PCR product fed into a BP reaction is linear. */
  circular: boolean;
  /** Features to carry into the product (rebased), 0-based [start,end). */
  features?: CloneFeature[];
}

/** One product att site, with the recombinant sequence we computed. */
export interface ProductAtt {
  name: string;
  family: AttFamily;
  specificity: number;
  /** The crossover-recombinant sequence (top strand, 5'->3'). */
  seq: string;
}

/** A recombination product (the desired clone OR the byproduct). */
export interface GatewayProduct {
  /** "clone" = the molecule carrying the gene of interest (entry/expression);
   *  "byproduct" = the molecule carrying the donor/destination cassette out. */
  role: "clone" | "byproduct";
  /** Product top-strand sequence (canonical circular rotation if circular). */
  seq: string;
  circular: boolean;
  /** Features carried into this product, rebased to product coordinates. */
  features: CloneFeature[];
  /** Where each source segment landed in the product, in the same pre-canonical
   *  coordinate frame as `features`. For the clone: the transferred insert span
   *  and the cassette-derived backbone span. */
  fragmentSpans: FragmentSpan[];
  /** The two product att sites flanking the transferred segment (left, right). */
  attSites: [ProductAtt, ProductAtt];
}

export interface GatewayResult {
  reaction: GatewayReaction;
  /** The desired clone first, then the byproduct (when derivable). */
  products: GatewayProduct[];
  warnings: string[];
}

// ============================================================================
// SMALL PURE HELPERS
// ============================================================================

function cleanDna(seq: string): string {
  return seq.toUpperCase().replace(/[^ACGT]/g, "");
}

/** Families that are valid inputs for each reaction, in (insert-substrate,
 *  cassette-substrate) order. BP: attB(insert) x attP(donor); LR: attL(entry) x
 *  attR(destination). */
const REACTION_INPUTS: Record<GatewayReaction, { insertFamily: AttFamily; cassetteFamily: AttFamily }> = {
  BP: { insertFamily: "B", cassetteFamily: "P" },
  LR: { insertFamily: "L", cassetteFamily: "R" },
};

/** The product families for each reaction: the clone-side site family and the
 *  byproduct-side family. BP -> attL (clone) + attR (byproduct);
 *  LR -> attB (clone) + attP (byproduct). */
const REACTION_PRODUCTS: Record<GatewayReaction, { cloneFamily: AttFamily; byproductFamily: AttFamily }> = {
  BP: { cloneFamily: "L", byproductFamily: "R" },
  LR: { cloneFamily: "B", byproductFamily: "P" },
};

// ============================================================================
// att-SITE DETECTION
// ============================================================================

/**
 * Locate every known att site of the given family on a substrate. We search by
 * exact match of each CANONICAL_ATT site of that family on BOTH strands of the
 * (possibly circular) sequence. Returns sites in 5'->3' order of their start on
 * the top strand. For a circular substrate we also detect a site that spans the
 * origin by searching the doubled sequence.
 *
 * Detection is by the published full site sequence. The shorter "core+arm"
 * forms still match because we store the full published site; if a user's
 * construct carries only a partial att site it will not be detected, which is
 * reported as a warning by the caller (no silent guessing).
 */
export function locateAttSites(
  substrate: GatewaySubstrate,
  family: AttFamily,
): LocatedAtt[] {
  const seq = cleanDna(substrate.seq);
  const n = seq.length;
  const search = substrate.circular ? seq + seq : seq;
  const found: LocatedAtt[] = [];
  const seen = new Set<string>();

  for (const site of Object.values(CANONICAL_ATT)) {
    if (site.family !== family) continue;
    const probes = [site.seq, reverseComplement(site.seq)];
    for (const probe of probes) {
      let from = 0;
      for (let idx = search.indexOf(probe, from); idx !== -1; idx = search.indexOf(probe, from)) {
        from = idx + 1;
        if (idx >= n) continue; // only the first copy of a circular wrap
        const start = idx;
        const end = idx + probe.length;
        const key = `${site.name}:${start % n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...site, start, end });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// ============================================================================
// THE CROSSOVER
// ============================================================================

/**
 * Split an att-site sequence into [5' arm, core, 3' arm] around the shared core
 * for its specificity number, ORIENTED to the recombination-competent strand.
 *
 * Published att sites are listed in mixed strand conventions: for site 2 the
 * attB/attL forms carry the core on their top strand while the attP/attR forms
 * carry it on the bottom strand (the canonical vector orientation). The crossover
 * acts on whichever strand presents the core 5'->3', so we first orient the site
 * to its core-forward strand (reverse-complementing if the core is only found on
 * the reverse strand). This makes a single arm-swap rule correct for all four
 * families regardless of how a given reagent's sequence was published. Returns
 * null if the core is on neither strand (the att site is unrecognized / partial).
 */
export function splitAroundCore(
  siteSeq: string,
  specificity: number,
): { fivePrime: string; core: string; threePrime: string } | null {
  const core = ATT_CORE[specificity];
  if (!core) return null;
  let oriented = siteSeq;
  let i = oriented.indexOf(core);
  if (i === -1) {
    oriented = reverseComplement(siteSeq);
    i = oriented.indexOf(core);
    if (i === -1) return null;
  }
  return {
    fivePrime: oriented.slice(0, i),
    core,
    threePrime: oriented.slice(i + core.length),
  };
}

/**
 * Compute a product att site by crossover. The product takes its 5' arm from
 * `fivePrimeDonor` and its 3' arm from `threePrimeDonor`, with the shared core
 * between. This is the conservative recombinant: 5'arm(A) + core + 3'arm(B).
 * Returns null if either input lacks the shared core.
 */
export function crossoverAtt(
  fivePrimeDonor: string,
  threePrimeDonor: string,
  specificity: number,
  productName: string,
  productFamily: AttFamily,
): ProductAtt | null {
  const a = splitAroundCore(fivePrimeDonor, specificity);
  const b = splitAroundCore(threePrimeDonor, specificity);
  if (!a || !b) return null;
  return {
    name: productName,
    family: productFamily,
    specificity,
    seq: a.fivePrime + a.core + b.threePrime,
  };
}

// ============================================================================
// THE ENGINE
// ============================================================================

/**
 * Run a Gateway BP or LR reaction between an INSERT substrate (carrying the gene
 * of interest flanked by site-1 and site-2 att sites) and a CASSETTE substrate
 * (the donor/destination vector carrying ccdB / negative selection flanked by
 * the matching att sites).
 *
 *   BP: attB-flanked insert  x  attP-flanked donor (pDONR) -> attL entry clone + attR byproduct.
 *   LR: attL-flanked entry   x  attR-flanked destination    -> attB expression clone + attP byproduct.
 *
 * The gene of interest TRANSFERS from the insert substrate onto the cassette
 * substrate's backbone (the cassette/ccdB segment leaves). The product is a
 * circular molecule: [backbone-from-cassette] - [productAtt1] - [insert] -
 * [productAtt2] - back to backbone. We compute each product att site as the
 * crossover recombinant of the two inputs at that position.
 *
 * PURE + DETERMINISTIC.
 */
export function runGateway(
  insertSubstrate: GatewaySubstrate,
  cassetteSubstrate: GatewaySubstrate,
  reaction: GatewayReaction,
): GatewayResult {
  const warnings: string[] = [];
  const { insertFamily, cassetteFamily } = REACTION_INPUTS[reaction];
  const { cloneFamily, byproductFamily } = REACTION_PRODUCTS[reaction];

  // Topology sanity. Gateway needs the right topologies: the cassette substrate
  // (donor/destination) is a supercoiled circle; the insert substrate is either
  // a circle (entry/expression clone) or a linear attB-PCR product (BP only).
  if (!cassetteSubstrate.circular) {
    warnings.push(
      `The ${cassetteFamily === "P" ? "donor (pDONR)" : "destination"} vector should be a supercoiled circle; a linear cassette input will not recombine in the standard reaction.`,
    );
  }
  if (!insertSubstrate.circular && reaction === "LR") {
    warnings.push(
      "The entry clone in an LR reaction should be circular; a linear entry input will not recombine in the standard reaction.",
    );
  }
  if (!insertSubstrate.circular && !cassetteSubstrate.circular) {
    warnings.push("Both inputs are linear; Gateway needs at least the cassette vector supercoiled/circular.");
  }

  // Locate the att sites on each substrate.
  const insertAtts = locateAttSites(insertSubstrate, insertFamily);
  const cassetteAtts = locateAttSites(cassetteSubstrate, cassetteFamily);

  if (insertAtts.length === 0) {
    warnings.push(
      `No att${insertFamily} sites found on "${insertSubstrate.name}". A ${reaction} reaction needs an att${insertFamily}1 and att${insertFamily}2 site flanking the insert.`,
    );
  }
  if (cassetteAtts.length === 0) {
    warnings.push(
      `No att${cassetteFamily} sites found on "${cassetteSubstrate.name}". A ${reaction} reaction needs an att${cassetteFamily}1 and att${cassetteFamily}2 site flanking the cassette.`,
    );
  }

  // We need exactly one site-1 and one site-2 on each substrate. More than one
  // of the same specificity is ambiguous; a missing specificity blocks the
  // reaction.
  const insert1 = pickUnique(insertAtts, 1, insertSubstrate.name, warnings);
  const insert2 = pickUnique(insertAtts, 2, insertSubstrate.name, warnings);
  const cassette1 = pickUnique(cassetteAtts, 1, cassetteSubstrate.name, warnings);
  const cassette2 = pickUnique(cassetteAtts, 2, cassetteSubstrate.name, warnings);

  if (!insert1 || !insert2 || !cassette1 || !cassette2) {
    // Specificity check: surface an att1/att2 mismatch explicitly.
    if (insertAtts.length > 0 && (!insert1 || !insert2)) {
      warnings.push(
        `"${insertSubstrate.name}" does not present one att${insertFamily}1 and one att${insertFamily}2 (directional pair); no recombination possible.`,
      );
    }
    if (cassetteAtts.length > 0 && (!cassette1 || !cassette2)) {
      warnings.push(
        `"${cassetteSubstrate.name}" does not present one att${cassetteFamily}1 and one att${cassetteFamily}2 (directional pair); no recombination possible.`,
      );
    }
    return { reaction, products: [], warnings };
  }

  // Extract the INSERT (gene of interest) = the segment of the insert substrate
  // BETWEEN its site-1 and site-2 att sites, plus the segment OUTSIDE them
  // (which becomes the cassette-side byproduct's transferred piece). Likewise the
  // CASSETTE substrate has its ccdB segment between site-1 and site-2.
  const insertParts = extractFlankedSegment(insertSubstrate, insert1, insert2);
  const cassetteParts = extractFlankedSegment(cassetteSubstrate, cassette1, cassette2);
  if (!insertParts || !cassetteParts) {
    warnings.push("Could not orient the att sites into a 1->2 directional pair; the segment between them is undefined.");
    return { reaction, products: [], warnings };
  }

  // Compute the product att sites by crossover.
  //
  // GEOMETRY of the desired CLONE (gene transfers onto the cassette backbone):
  //   clone = cassetteBackbone(after site2) -> [clone att1] -> INSERT -> [clone att2] -> cassetteBackbone(before site1)
  // The clone-side att1 sits at the insert's 5' boundary: its 5' arm comes from
  // the cassette substrate's site-1 (the backbone strand), its 3' arm comes from
  // the insert substrate's site-1 (the insert strand). The clone-side att2 sits
  // at the insert's 3' boundary: its 5' arm from the insert substrate's site-2,
  // its 3' arm from the cassette substrate's site-2.
  const cloneAtt1 = crossoverAtt(
    cassette1.topSeq, // 5' arm donor (backbone side, upstream of insert)
    insert1.topSeq,   // 3' arm donor (insert side)
    1,
    `att${cloneFamily}1`,
    cloneFamily,
  );
  const cloneAtt2 = crossoverAtt(
    insert2.topSeq,   // 5' arm donor (insert side)
    cassette2.topSeq, // 3' arm donor (backbone side, downstream of insert)
    2,
    `att${cloneFamily}2`,
    cloneFamily,
  );

  // The BYPRODUCT (cassette/ccdB transfers onto the insert substrate's backbone):
  //   byproduct = insertBackbone(after site2) -> [bp att1] -> CASSETTE -> [bp att2] -> insertBackbone(before site1)
  const byproductAtt1 = crossoverAtt(
    insert1.topSeq,   // 5' arm donor (insert backbone side)
    cassette1.topSeq, // 3' arm donor (cassette side)
    1,
    `att${byproductFamily}1`,
    byproductFamily,
  );
  const byproductAtt2 = crossoverAtt(
    cassette2.topSeq, // 5' arm donor (cassette side)
    insert2.topSeq,   // 3' arm donor (insert backbone side)
    2,
    `att${byproductFamily}2`,
    byproductFamily,
  );

  if (!cloneAtt1 || !cloneAtt2 || !byproductAtt1 || !byproductAtt2) {
    warnings.push("An att site is missing its shared recombination core; the crossover cannot be computed.");
    return { reaction, products: [], warnings };
  }

  // BUILD THE CLONE. The insert substrate's "between" segment (gene of interest,
  // exclusive of the att cores) joins the cassette substrate's backbone (the part
  // OUTSIDE its att sites). The product circular sequence, written from the
  // clone-att1 start:
  //   cloneAtt1.seq + insertBetween + cloneAtt2.seq + cassetteOutside
  // where insertBetween is the insert sequence strictly between the two att sites
  // (the att cores are inside the product att sites), and cassetteOutside is the
  // cassette substrate's sequence OUTSIDE its two att sites (the kept backbone),
  // read from just-after-site2 around to just-before-site1.
  const cloneSeqRaw =
    cloneAtt1.seq + insertParts.between + cloneAtt2.seq + cassetteParts.outside;
  const cloneSeq = canonicalCircular(cloneSeqRaw);

  // Rebase the insert's features into the clone. In the assembled clone, the
  // insert's "between" segment starts at offset cloneAtt1.seq.length within the
  // pre-canonical layout. Features given on the insert substrate are expressed in
  // the insert substrate's own coordinates; we shift them so that the start of
  // `between` maps to cloneAtt1.seq.length. (Features fully outside [att1.end,
  // att2.start) are dropped: they belonged to the donor/entry backbone that did
  // not transfer.) Because the final product is canonicalized (rotated), we keep
  // features in the PRE-CANONICAL layout and note that consumers re-map on rotate;
  // for v1 we attach features on the pre-canonical layout sequence length.
  const cloneFeatures = rebaseInsertFeatures(
    insertSubstrate.features ?? [],
    insertParts.betweenStartInSubstrate,
    insertParts.between.length,
    cloneAtt1.seq.length,
  );

  // BUILD THE BYPRODUCT similarly (cassette segment onto insert backbone).
  const byproductSeqRaw =
    byproductAtt1.seq + cassetteParts.between + byproductAtt2.seq + insertParts.outside;
  const byproductSeq = canonicalCircular(byproductSeqRaw);

  // FRAGMENT SPANS for the clone, in the same pre-canonical layout as the
  // features (cloneAtt1.seq + insertBetween + cloneAtt2.seq + cassetteOutside).
  // The INSERT span covers the gene of interest between the two product att
  // sites; the BACKBONE span covers the cassette-derived backbone that follows.
  const insertSpanStart = cloneAtt1.seq.length;
  const insertSpanEnd = insertSpanStart + insertParts.between.length;
  const backboneSpanStart = insertSpanEnd + cloneAtt2.seq.length;
  const backboneSpanEnd = backboneSpanStart + cassetteParts.outside.length;
  const cloneSpans: FragmentSpan[] = [];
  if (insertSpanEnd > insertSpanStart) {
    cloneSpans.push({
      name: insertSubstrate.name,
      start: insertSpanStart,
      end: insertSpanEnd,
      strand: 1,
    });
  }
  if (backboneSpanEnd > backboneSpanStart) {
    cloneSpans.push({
      name: cassetteSubstrate.name,
      start: backboneSpanStart,
      end: backboneSpanEnd,
      strand: 1,
    });
  }

  const cloneProduct: GatewayProduct = {
    role: "clone",
    seq: cloneSeq,
    circular: true,
    features: cloneFeatures,
    fragmentSpans: cloneSpans,
    attSites: [cloneAtt1, cloneAtt2],
  };
  const byproductProduct: GatewayProduct = {
    role: "byproduct",
    seq: byproductSeq,
    circular: true,
    features: [],
    fragmentSpans: [],
    attSites: [byproductAtt1, byproductAtt2],
  };

  return { reaction, products: [cloneProduct, byproductProduct], warnings };
}

// ============================================================================
// INTERNAL: substrate dissection
// ============================================================================

/** A located att site with its top-strand-oriented site sequence resolved (so
 *  the shared core is always in forward sense for the crossover). */
interface OrientedAtt extends LocatedAtt {
  /** The att site read 5'->3' in the direction the gene reads (top strand of the
   *  substrate as supplied). For a reverse-strand hit we still store the
   *  forward-sense site so the core is found. */
  topSeq: string;
}

/**
 * Choose the single att site of a given specificity, warning on absence or
 * ambiguity (multiple of the same type). Returns an OrientedAtt or undefined.
 */
function pickUnique(
  atts: LocatedAtt[],
  specificity: number,
  substrateName: string,
  warnings: string[],
): OrientedAtt | undefined {
  const hits = atts.filter((a) => a.specificity === specificity);
  if (hits.length === 0) return undefined;
  if (hits.length > 1) {
    warnings.push(
      `"${substrateName}" has ${hits.length} att*${specificity} sites; the reaction is ambiguous (which one recombines is undefined).`,
    );
    return undefined;
  }
  const a = hits[0];
  // The forward-sense site sequence (the published site already contains the core
  // in forward sense). Our detection stored the located span; the canonical site
  // seq is the forward-sense site.
  return { ...a, topSeq: a.seq };
}

/**
 * Extract, from a substrate, the segment strictly BETWEEN its site-1 and site-2
 * att sites (the insert / ccdB), and the segment OUTSIDE them (the kept
 * backbone). Requires site 1 to be 5' of site 2 on the top strand for a clean
 * directional layout; if site 2 is 5' of site 1, the substrate is oriented the
 * other way and we read the between-segment on the wrap (circular) — for v1 we
 * require site1.start < site2.start on the supplied top strand and otherwise
 * report it.
 *
 * Returns:
 *   between  - sequence strictly between the two att sites (att cores excluded).
 *   outside  - the backbone OUTSIDE the att sites, read from after site2 around
 *              to before site1 (circular wrap for a plasmid).
 *   betweenStartInSubstrate - 0-based index in the substrate where `between`
 *              begins (for feature rebasing).
 */
function extractFlankedSegment(
  substrate: GatewaySubstrate,
  site1: OrientedAtt,
  site2: OrientedAtt,
): { between: string; outside: string; betweenStartInSubstrate: number } | null {
  const seq = cleanDna(substrate.seq);
  // Require the directional layout site1 ... site2 on the top strand.
  if (site1.start >= site2.start) {
    // Site order is reversed on the supplied strand; v1 requires att1 upstream of
    // att2. (A reverse-complement-supplied substrate would need flipping first.)
    return null;
  }
  // `between` = strictly between the att-site spans.
  const between = seq.slice(site1.end, site2.start);
  // `outside` = backbone outside the two att sites. For a circle this is the wrap
  // from after site2 to before site1: seq[site2.end:] + seq[:site1.start].
  // For a linear substrate it is the two open flanks; we still concatenate them
  // (the product is circular, closing the loop), which models the standard
  // reaction where the kept backbone is contiguous on the circular vector.
  const outside = seq.slice(site2.end) + seq.slice(0, site1.start);
  return { between, outside, betweenStartInSubstrate: site1.end };
}

/**
 * Rebase the insert substrate's features into the clone product. Features that
 * lie within the transferred "between" segment [betweenStart, betweenStart +
 * betweenLen) are shifted so the segment start maps to `productOffset` (the
 * length of the clone-side att1 that precedes the insert in the pre-canonical
 * layout). Features outside the transferred segment are dropped (they belonged to
 * the entry/donor backbone that did not transfer). Pure additive shift, reusing
 * the shared `rebaseFeatures` contract.
 */
function rebaseInsertFeatures(
  features: CloneFeature[],
  betweenStart: number,
  betweenLen: number,
  productOffset: number,
): CloneFeature[] {
  const inSegment = features.filter(
    (f) => f.start >= betweenStart && f.end <= betweenStart + betweenLen,
  );
  // Shift into segment-local coordinates, then into product coordinates.
  const local = inSegment.map((f) => ({ ...f, start: f.start - betweenStart, end: f.end - betweenStart }));
  return rebaseFeatures(local, productOffset);
}

/** GC% convenience (mirror of cloning.ts productGc, re-derived to avoid a cyclic
 *  import surface). */
export function productOf(product: GatewayProduct): AssembledProduct {
  return { seq: product.seq, circular: product.circular, features: product.features };
}
