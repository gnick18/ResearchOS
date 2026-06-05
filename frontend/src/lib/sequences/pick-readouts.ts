// sequence editor master — PURE pick-step readout helpers (Phase C of the
// cloning-visuals arc). These power the chemistry-tuned readouts the Assemble
// workspace shows on the PICK step, BEFORE the user commits to review, so each
// method's key compatibility fact is visible up front:
//
//   - Restriction / Golden Gate. "Sites per fragment" for the selected
//     enzyme(s), so a non-cutter (0 sites, will not cut) or an over-cut
//     fragment (many sites, chopped up) is obvious before review.
//   - Gateway. att-site auto-detection on each substrate (attL entry clone /
//     attR destination / attB insert / attP donor), plus a check that the
//     picked substrates match the chosen BP/LR reaction.
//
// Everything here is pure, DOM-free, and unit-tested. It REUSES the existing
// pure engine helpers rather than reimplementing any biology:
//   - `digestEnzymes` (enzyme-filters.ts) for the per-enzyme cut counts,
//   - `locateAttSites` (cloning-gateway.ts) for att detection.
// The UI in CloningWorkspace.tsx is display wiring on top of these.
//
// No emojis, no em-dashes, no mid-sentence colons in the prose here.

import { digestEnzymes } from "./enzyme-filters";
import {
  locateAttSites,
  type AttFamily,
  type GatewayReaction,
  type GatewaySubstrate,
  type LocatedAtt,
} from "./cloning-gateway";

// ============================================================================
// 1. RESTRICTION / GOLDEN GATE: sites per fragment
// ============================================================================

/** One enzyme's cut count on a single fragment. */
export interface EnzymeSiteCount {
  /** Display name as the user picked it, e.g. "BsaI". */
  name: string;
  /** How many times this enzyme cuts the fragment (0 = does not cut). */
  count: number;
}

/** The per-fragment site readout for one fragment against the selected enzymes. */
export interface FragmentSiteSummary {
  /** Per-enzyme cut counts, in the order the enzymes were supplied. */
  enzymes: EnzymeSiteCount[];
  /** True if at least one selected enzyme never cuts this fragment. For Golden
   *  Gate that means the part cannot be excised; for restriction it means that
   *  enzyme contributes no end here. */
  hasNoncutter: boolean;
  /** True if every selected enzyme cuts at least once (the healthy case). */
  allCut: boolean;
}

/**
 * Count how many times each selected enzyme cuts a single fragment sequence.
 * Pure, derived entirely from the vendored digest via `digestEnzymes`; we never
 * reimplement recognition-site search.
 *
 * `enzymeNames` are the user-facing names (e.g. "BsaI", "EcoRI"); `digestEnzymes`
 * lowercases them internally to key into ALL_ENZYMES, and silently skips any name
 * that does not resolve. We map the resolved digests back onto the requested
 * names so the readout lists exactly what the user selected, with 0 for any
 * enzyme that resolves but does not cut (and for one that does not resolve at
 * all, which also reads as "no sites here").
 */
export function fragmentSiteSummary(
  seq: string,
  enzymeNames: string[],
): FragmentSiteSummary {
  const digests = digestEnzymes(seq || "", "dna", enzymeNames);
  // Key the digest results by lowercase enzyme key so we can line them up with
  // the requested names regardless of the order digestEnzymes returns.
  const byKey = new Map<string, number>();
  for (const d of digests) byKey.set(d.info.key, d.cutCount);

  const enzymes: EnzymeSiteCount[] = enzymeNames.map((name) => ({
    name,
    count: byKey.get(name.toLowerCase()) ?? 0,
  }));
  const hasNoncutter = enzymes.some((e) => e.count === 0);
  const allCut = enzymes.length > 0 && enzymes.every((e) => e.count > 0);
  return { enzymes, hasNoncutter, allCut };
}

// ============================================================================
// 2. GATEWAY: att-site classification on a substrate
// ============================================================================

/** What a picked Gateway substrate looks like, by its detected att sites. */
export type GatewayKind =
  | "attL" // attL1 + attL2  -> entry clone
  | "attR" // attR1 + attR2  -> destination vector
  | "attB" // attB1 + attB2  -> insert (attB-PCR product or clone)
  | "attP" // attP1 + attP2  -> donor (pDONR)
  | "unknown"; // no recognizable directional att pair

/** The classification of one picked substrate. */
export interface GatewayClassification {
  kind: GatewayKind;
  /** Human label for the chip, e.g. "attL entry clone detected". */
  label: string;
  /** The att sites found for the matched family (empty for "unknown"). */
  sites: LocatedAtt[];
}

/** The att family every Gateway kind is built from, in detection order. */
const GATEWAY_FAMILIES: { family: AttFamily; kind: GatewayKind }[] = [
  { family: "L", kind: "attL" },
  { family: "R", kind: "attR" },
  { family: "B", kind: "attB" },
  { family: "P", kind: "attP" },
];

/** The chip label for each recognized kind. */
const KIND_LABEL: Record<Exclude<GatewayKind, "unknown">, string> = {
  attL: "attL entry clone",
  attR: "attR destination",
  attB: "attB insert (PCR)",
  attP: "attP donor (pDONR)",
};

/**
 * Classify a Gateway substrate by detecting its att sites across all four
 * families and matching the family that presents a directional 1 + 2 pair.
 *
 * REUSE: this calls `locateAttSites` (the engine's exact-match att detector) per
 * family and never reimplements site finding. A substrate is classified as a
 * family only when that family yields both a site-1 and a site-2 (the directional
 * pair Gateway requires); a lone site does not classify (it cannot recombine).
 *
 * Pure and deterministic.
 */
export function classifyGatewaySubstrate(
  substrate: GatewaySubstrate,
): GatewayClassification {
  for (const { family, kind } of GATEWAY_FAMILIES) {
    const sites = locateAttSites(substrate, family);
    const has1 = sites.some((s) => s.specificity === 1);
    const has2 = sites.some((s) => s.specificity === 2);
    if (has1 && has2) {
      return {
        kind,
        label: `${KIND_LABEL[kind as Exclude<GatewayKind, "unknown">]} detected`,
        sites,
      };
    }
  }
  return { kind: "unknown", label: "no att pair detected", sites: [] };
}

// ============================================================================
// 3. GATEWAY: reaction <-> substrate match check
// ============================================================================

/** The substrate kinds each reaction expects, in (slot 1, slot 2) order. */
const REACTION_EXPECTS: Record<
  GatewayReaction,
  { first: GatewayKind; second: GatewayKind; hint: string }
> = {
  // LR: attL entry clone (slot 1) x attR destination (slot 2) -> attB clone.
  LR: {
    first: "attL",
    second: "attR",
    hint: "LR expects an attL entry clone first, then an attR destination.",
  },
  // BP: attB insert (slot 1) x attP donor (slot 2) -> attL entry clone.
  BP: {
    first: "attB",
    second: "attP",
    hint: "BP expects an attB insert first, then an attP donor (pDONR).",
  },
};

/** The outcome of checking the two picked substrates against the reaction. */
export interface GatewayMatch {
  /** True when slot 1 and slot 2 match the reaction's expected families. */
  ok: boolean;
  /** A gentle inline hint when the picked substrates do not match (empty when
   *  ok, or when there are not yet two classified substrates to judge). */
  hint: string;
  /** The two classifications, in slot order (may be fewer than two). */
  substrates: GatewayClassification[];
}

/**
 * Check the picked substrates (slot order) against the chosen BP/LR reaction.
 * Returns ok=true only when slot 1 and slot 2 carry the families the reaction
 * needs. When they do not, returns a plain-language hint explaining what the
 * reaction expects, so the silent empty product becomes an explained one.
 *
 * Pure. Classifies each substrate via `classifyGatewaySubstrate`.
 */
export function checkGatewayMatch(
  substrates: GatewaySubstrate[],
  reaction: GatewayReaction,
): GatewayMatch {
  const classified = substrates.map(classifyGatewaySubstrate);
  const expect = REACTION_EXPECTS[reaction];

  // Need both slots filled to judge the match.
  if (classified.length < 2) {
    return { ok: false, hint: "", substrates: classified };
  }
  const ok =
    classified[0].kind === expect.first && classified[1].kind === expect.second;
  return { ok, hint: ok ? "" : expect.hint, substrates: classified };
}
