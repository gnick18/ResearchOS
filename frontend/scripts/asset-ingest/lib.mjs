// Shared ingest library for the open scientific-asset federation.
//
// Pure + testable. Defines the normalized Asset shape every source adapter emits,
// the license policy, the auto-credit formatter, and an SVG sanitizer that PRESERVES
// per-fill addressability (so per-fill recolor works downstream). No app deps.
//
// Allowed licenses (commercial + derivative OK): CC0 / Public Domain / CC-BY / CC-BY-SA.
// Excluded: anything -NC (non-commercial) or -ND (no-derivatives; we recolor).

/**
 * @typedef {Object} Asset
 * @property {string} uid          Stable cross-source id, "<source>:<sourceId>".
 * @property {string} source       "phylopic" | "bioart" | "servier" | ...
 * @property {string} sourceId     The id within the source.
 * @property {string} title        Human title (taxon / asset name).
 * @property {string|null} creator Attribution name(s).
 * @property {string} license      Normalized license id (see classifyLicense).
 * @property {string|null} licenseUrl
 * @property {boolean} requiresAttribution
 * @property {string} sourceUrl    Canonical page for the asset.
 * @property {string} credit       Pre-formatted citation string.
 * @property {string} svgPath      Relative path of the sanitized SVG in the bundle.
 * @property {string[]} tags
 * @property {string|null} category
 */

/** License policy. allowed = may ingest; attribution = must credit on use. */
export function classifyLicense(s) {
  const t = (s || "").toLowerCase();
  if (/nc-nd|by-nc-nd/.test(t)) return { id: "CC-BY-NC-ND", allowed: false, attribution: false };
  if (/nc-sa|by-nc-sa/.test(t)) return { id: "CC-BY-NC-SA", allowed: false, attribution: false };
  if (/by-nc/.test(t)) return { id: "CC-BY-NC", allowed: false, attribution: false };
  if (/by-nd/.test(t)) return { id: "CC-BY-ND", allowed: false, attribution: false };
  if (/by-sa/.test(t)) return { id: "CC-BY-SA", allowed: true, attribution: true };
  if (/\/by\/|cc-by\b|\bcc by\b|attribution\s*[34]/.test(t)) return { id: "CC-BY", allowed: true, attribution: true };
  if (/zero|cc-?0|publicdomain\/zero/.test(t)) return { id: "CC0", allowed: true, attribution: false };
  if (/public\s*domain|publicdomain|\/mark\//.test(t)) return { id: "Public Domain", allowed: true, attribution: false };
  // Permissive code-style licenses (BioIcons tags some assets these): commercial +
  // derivative OK, but the copyright/license notice must be retained -> attribution.
  if (/\bmit\b/.test(t)) return { id: "MIT", allowed: true, attribution: true };
  if (/\bbsd\b/.test(t)) return { id: "BSD", allowed: true, attribution: true };
  if (/\bapache\b/.test(t)) return { id: "Apache-2.0", allowed: true, attribution: true };
  return { id: "UNKNOWN", allowed: false, attribution: false };
}

/** A short human label for a license id, for the credits UI. */
export function licenseLabel(id) {
  return id === "Public Domain" ? "Public Domain" : id;
}

/**
 * Build the verbatim credit line. CC-BY/SA require it; CC0/PD include a courtesy
 * credit (apps may hide it). Format mirrors the source's own citation style.
 */
export function formatCredit({ source, title, creator, license, sourceUrl }) {
  const who = creator || "Unknown";
  if (source === "phylopic") {
    return `${title} by ${who}. PhyloPic. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "bioart") {
    return `${who}. ${title}. NIH BioArt Source. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "bioicons") {
    return `${title} by ${who}. Bioicons. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "reactome") {
    // Reactome Icon Library is CC BY 4.0; credit the icon designer + Reactome.
    return `${title} by ${who}. Reactome Icon Library. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "healthicons") {
    // Health Icons are MIT / public-domain; courtesy credit retains the project notice.
    return `${title}. Health Icons by Resolve to Save Lives. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "tabler") {
    // Tabler Icons are MIT; courtesy credit retains the project notice.
    return `${title}. Tabler Icons (MIT). ${sourceUrl}`;
  }
  if (source === "devicon") {
    // Devicon ships the SVGs under MIT, but the logos themselves are TRADEMARKS of
    // their respective owners. Credit both so attribution + the trademark are clear.
    return `${title} logo. Devicon (MIT); logo is a trademark of its owner. ${sourceUrl}`;
  }
  if (source === "scidraw") {
    // SciDraw is CC-BY; credit the drawing authors + SciDraw + the DOI when present.
    return `${title} by ${who}. SciDraw. ${sourceUrl} (${licenseLabel(license)})`;
  }
  // Generic fallback.
  return `${title} by ${who}. ${sourceUrl} (${licenseLabel(license)})`;
}

// ---------------------------------------------------------------------------
// Category taxonomy mapping. The grouped sidebar (asset-library.ts) renders the
// LOCKED 9-section taxonomy by EXACT curated leaf name, so each source's raw
// category strings must be mapped onto those existing leaves (anything unmapped
// falls into "Other"). The raw category is retained as a search tag so keyword +
// semantic search still match the source's own vocabulary.

/** Reactome icon category (lowercase slug) -> curated taxonomy leaf. */
const REACTOME_CATEGORY = {
  protein: "Molecular biology",
  compound: "Chemistry",
  therapeutic: "Chemistry",
  cell_element: "Intracellular components",
  cell_type: "Cell types",
  receptor: "Receptors & channels",
  transporter: "Receptors & channels",
  human_tissue: "Tissues",
  arrow: "General",
  background: "General",
};
export function reactomeCategory(raw) {
  const k = (raw || "").toLowerCase().replace(/\s+/g, "_");
  return REACTOME_CATEGORY[k] || "General";
}

/** Health Icons folder name -> curated taxonomy leaf. */
const HEALTHICONS_CATEGORY = {
  blood: "Blood & immunology",
  body: "Human physiology",
  conditions: "Human physiology",
  contraceptives: "Human physiology",
  exercise: "Human physiology",
  specialties: "Human physiology",
  devices: "Lab apparatus",
  diagnostics: "Imaging",
  graphs: "Scientific graphs",
  medications: "Chemistry",
  emotions: "People",
  people: "People",
  ppe: "Safety symbols",
  symbols: "Safety symbols",
  zoonoses: "Microbiology",
  // nutrition / objects / places / shapes / typography / vehicles -> General
};
export function healthiconsCategory(raw) {
  const k = (raw || "").toLowerCase().replace(/\s+/g, "_");
  return HEALTHICONS_CATEGORY[k] || "General";
}

/** Tabler icon category -> curated taxonomy leaf. Also the ingest allowlist: a
 *  category not in this map is a UI/brand category (System, Arrows, Brand,
 *  E-commerce, ...) and is SKIPPED so the science library stays science. */
const TABLER_CATEGORY = {
  Health: "Human physiology",
  Nature: "General",
  Math: "Math",
  Charts: "Scientific graphs",
  Computers: "Computer hardware",
  Database: "Computer hardware",
  Development: "Computer hardware",
  Logic: "Computer hardware",
  Electrical: "Computer hardware",
  Devices: "Lab apparatus",
  Shapes: "General",
  Symbols: "Safety symbols",
};
/** Returns the mapped leaf, or null when the category is not science/tech (skip). */
export function tablerCategory(raw) {
  return TABLER_CATEGORY[raw] || null;
}

/** SciDraw category (a freeform single word like "physics", "mouse", "brain") ->
 *  curated taxonomy leaf, by keyword. SciDraw skews physics/neuro/apparatus; the raw
 *  word is also kept as a search tag so search works regardless of the mapping. */
export function scidrawCategory(raw) {
  const t = (raw || "").toLowerCase();
  if (/physic|optic|laser|photon|detector|quantum|particle|atom|magnet|wave|circuit|electron|spin|nucle|telescope|accelerat/.test(t)) return "Physics";
  if (/math|equation|geometr|vector|graph theory|topolog/.test(t)) return "Math";
  if (/brain|neuro|neuron|cortex|synap/.test(t)) return "Neuroscience";
  if (/mouse|rat|mice|rodent|mammal|primate|monkey|human body|animal/.test(t)) return "Mammals";
  if (/cell|membrane|organelle|mitochond/.test(t)) return "Intracellular components";
  if (/dna|rna|gene|nucleic|chromosom/.test(t)) return "Nucleic acids";
  if (/protein|receptor|enzyme|peptide/.test(t)) return "Peptides";
  if (/microb|bacteri|virus|pathogen/.test(t)) return "Microbiology";
  if (/chemi|molecul|reaction|compound/.test(t)) return "Chemistry";
  if (/apparatus|equipment|instrument|microscope|lab|syringe|tube|pipette|flask|beaker|vial|plate|dish|tip|centrifuge|cuvette|well/.test(t)) return "Lab apparatus";
  if (/plot|chart|data/.test(t)) return "Scientific graphs";
  return "General";
}

/**
 * Sanitize an SVG for safe embedding while KEEPING per-fill structure intact:
 *  - strip <script>, on* handlers, external refs (xlink to http), <foreignObject>.
 *  - keep all fill attributes/styles + path structure so per-fill recolor works.
 *  - ensure a viewBox so the asset scales in the composer.
 * Returns { svg, fills } where fills is the count of distinct fill colors.
 */
export function sanitizeSvg(input) {
  let svg = String(input);
  // Drop XML prolog / doctype / comments.
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  // Remove scripts + event handlers + foreignObject (XSS / non-portable).
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");
  // Neutralize external/script hrefs but keep internal (#id) refs for fills/gradients.
  svg = svg.replace(/((?:xlink:)?href)\s*=\s*"(?!#)[^"]*"/gi, '$1="#"');
  svg = svg.trim();
  // Count distinct fill colors (per-fill recolor feasibility).
  const fills = new Set();
  for (const m of svg.matchAll(/fill\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)/g)) {
    const v = m[1].toLowerCase();
    if (v !== "none") fills.add(v);
  }
  const hasViewBox = /\bviewBox\s*=/.test(svg);
  return { svg, fills: fills.size, hasViewBox };
}
