/**
 * Heuristic mapping tables for the purchase-item vendor/category backfill.
 *
 * Two tables drive everything:
 *
 *   VENDOR_HOSTNAME_MAP   regex → canonical vendor name; matched against
 *                         the parsed hostname of a PurchaseItem's `link`.
 *   CATEGORY_PATTERN_MAP  regex → canonical category; matched against
 *                         the PurchaseItem's `item_name`.
 *
 * Inference is intentionally conservative: the helpers return `null` when
 * nothing matches (the backfill leaves the field as-is in that case).
 *
 * Extending the tables: append new entries to the appropriate list. Order
 * inside CATEGORY_PATTERN_MAP matters — the first matching pattern wins,
 * so put more specific patterns above broader ones (e.g. an Equipment
 * keyword like "centrifuge" before a Plasticware keyword like "tube").
 */

export const VENDOR_HOSTNAME_MAP = [
  { match: /^(www\.)?neb\.com$/i, vendor: "NEB" },
  { match: /^(www\.)?(?:sigmaaldrich|emdmillipore|merckmillipore)\.com$/i, vendor: "Sigma-Aldrich" },
  { match: /^(www\.)?(?:idtdna|eu\.idtdna)\.com$/i, vendor: "IDT" },
  { match: /^(www\.)?thermofisher\.com$/i, vendor: "Thermo Fisher" },
  { match: /^(www\.)?(?:fishersci|fisherscientific)\.com$/i, vendor: "Fisher Scientific" },
  { match: /^(www\.)?bio-rad\.com$/i, vendor: "Bio-Rad" },
  { match: /^(www\.)?promega\.com$/i, vendor: "Promega" },
  { match: /^(www\.)?qiagen\.com$/i, vendor: "Qiagen" },
  { match: /^(www\.)?genscript\.com$/i, vendor: "GenScript" },
  { match: /^(www\.)?twistbioscience\.com$/i, vendor: "Twist Bioscience" },
  { match: /^(www\.)?takarabio\.com$/i, vendor: "Takara Bio" },
  { match: /^(www\.)?addgene\.org$/i, vendor: "Addgene" },
  { match: /^(www\.)?atcc\.org$/i, vendor: "ATCC" },
  { match: /^(www\.)?(?:genewiz|azenta)\.com$/i, vendor: "Azenta / Genewiz" },
  { match: /^(www\.)?eurofinsgenomics\.com$/i, vendor: "Eurofins Genomics" },
  { match: /^(www\.)?cellsignal\.com$/i, vendor: "Cell Signaling Technology" },
  { match: /^(www\.)?abcam\.com$/i, vendor: "Abcam" },
  { match: /^(www\.)?vwr\.com$/i, vendor: "VWR / Avantor" },
  { match: /^(www\.)?eppendorf\.com$/i, vendor: "Eppendorf" },
  { match: /^(www\.)?corning\.com$/i, vendor: "Corning" },
  { match: /^(www\.)?mcmaster\.com$/i, vendor: "McMaster-Carr" },
  { match: /^(www\.)?usascientific\.com$/i, vendor: "USA Scientific" },
  { match: /^(www\.)?beckman\.com$/i, vendor: "Beckman Coulter" },
  { match: /^(www\.)?lonza\.com$/i, vendor: "Lonza" },
  { match: /^(www\.)?(?:amazon|smile\.amazon)\.com$/i, vendor: "Amazon" },
];

export const CATEGORY_PATTERN_MAP = [
  // Service — sequencing / synthesis / custom orders. Specific phrases win
  // over generic ones below.
  { match: /\b(?:sequencing|gene synthesis|oligo synthesis|custom synthesis|sanger|nanopore|miseq|hiseq|service)\b/i, category: "Service" },
  // Reagents — kits, enzymes, antibodies, buffers, primers. Above
  // Strains / Cells so "genotyping primers for DemoStrain" stays a
  // reagent purchase rather than getting classified as a strain.
  { match: /\b(?:kits?|antibod(?:y|ies)|monoclonal|polyclonal|polymerases?|ligases?|restriction|enzymes?|primers?|oligos?|reagents?|buffers?|master[\s-]?mixe?s?|dntps?)\b/i, category: "Reagents" },
  // Strains, cell lines, plasmids — Addgene-style biologicals.
  { match: /\b(?:plasmid|strain|cell line|cell-line|fakeyeast|demostrain)\b/i, category: "Strains / Cells" },
  // Media — growth media + supplements.
  { match: /\b(?:ypd|ypda|lb broth|sd-?\w*|m9|dropout|yeast extract|agar|peptone|tryptone|media)\b/i, category: "Media" },
  // Solvents — kept above generic chemicals.
  { match: /\b(?:acetonitrile|methanol|ethanol|isopropanol|dmso|chloroform|acetone|hexane|solvent)\b/i, category: "Solvents" },
  // Chemicals — salts, acids, bases.
  { match: /\b(?:nacl|kcl|mgcl2|cacl2|sodium chloride|potassium chloride|magnesium chloride|hcl|naoh|tris|edta|chemical)\b/i, category: "Chemicals" },
  // Glassware before Plasticware so "Erlenmeyer flask" lands in glassware
  // (matches "erlenmeyer") rather than plasticware (matches "flask"). Also
  // before Equipment so "microscope coverslip" stays glassware.
  { match: /\b(?:glassware|beakers?|graduated cylinders?|erlenmeyer|slides?|coverslips?|vials?)\b/i, category: "Glassware" },
  // Plasticware before Equipment so "microcentrifuge tubes" is plasticware
  // (matches "tubes") rather than equipment (matches "microcentrifuge").
  { match: /\b(?:tubes?|tips?|pipettes?|plates?|flasks?|dishe?s?|petri|eppendorf|conicals?|cuvettes?|microplates?|microtubes?)\b/i, category: "Plasticware" },
  // Consumables — PPE + lab bench supplies.
  { match: /\b(?:gloves?|wipes?|masks?|foil|aluminum foil|bench paper|biohazard|parafilm|kimwipes?)\b/i, category: "Consumables" },
  // Equipment — last so plasticware/glassware/consumables win on overlapping
  // keywords. A bare "centrifuge" still lands here.
  { match: /\b(?:centrifuge|microcentrifuge|incubator|thermocycler|spectrophotometer|microscope|balance|shaker|vortex|autoclave|freezer)\b/i, category: "Equipment" },
];

/**
 * Parse a hostname from a link string. Tolerant of:
 *   - missing scheme ("neb.com/foo" → "neb.com")
 *   - trailing slashes
 *   - mixed case (hostname is returned as-given by URL, which lowercases it)
 *
 * Returns null for null/undefined/empty/malformed input.
 */
export function extractHostname(link) {
  if (typeof link !== "string") return null;
  const trimmed = link.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Look up the canonical vendor for a PurchaseItem.link. Returns null when:
 *   - the link is null/undefined/empty
 *   - the link cannot be parsed into a hostname
 *   - the hostname does not match any entry in VENDOR_HOSTNAME_MAP
 */
export function inferVendorFromLink(link) {
  const host = extractHostname(link);
  if (host == null) return null;
  for (const entry of VENDOR_HOSTNAME_MAP) {
    if (entry.match.test(host)) return entry.vendor;
  }
  return null;
}

/**
 * Look up the canonical category for a PurchaseItem.item_name. Returns null
 * when the name is empty/non-string or no pattern matches. First matching
 * pattern in CATEGORY_PATTERN_MAP wins.
 */
export function inferCategoryFromName(itemName) {
  if (typeof itemName !== "string") return null;
  const trimmed = itemName.trim();
  if (trimmed === "") return null;
  for (const entry of CATEGORY_PATTERN_MAP) {
    if (entry.match.test(trimmed)) return entry.category;
  }
  return null;
}
