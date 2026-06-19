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
  if (source === "servier") {
    // Servier Medical Art is CC BY 4.0; credit the project by its full name.
    return `${title}. Servier Medical Art. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "swissbiopics") {
    // SwissBioPics is CC BY 4.0; credit SIB and the SwissBioPics project.
    return `${title}. SwissBioPics by ${who}. ${sourceUrl} (${licenseLabel(license)})`;
  }
  if (source === "ebi") {
    // EMBL-EBI Icon Fonts SVGs are CC BY-SA 4.0; credit EMBL-EBI and note the SA term.
    return `${title}. EMBL-EBI Icon Fonts by ${who}. ${sourceUrl} (${licenseLabel(license)})`;
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

// ---------------------------------------------------------------------------
// New source category mappers (Servier, SwissBioPics, EMBL-EBI).

/** Servier Medical Art PPTX topic slug (e.g. "Blood-immunology") -> curated taxonomy leaf.
 *  The slug is derived from the PPTX filename: "SMART-Blood-immunology.pptx" -> "Blood-immunology". */
const SERVIER_CATEGORY = {
  "blood-immunology": "Blood & immunology",
  "nucleic-acids": "Nucleic acids",
  "genetics": "Genetics",
  "intracellular-components": "Intracellular components",
  "cell-membrane": "Cell membrane",
  "receptors-channels": "Receptors & channels",
  "oncology": "Oncology",
  "tissues": "Tissues",
  "microbiology-cell-culture": "Microbiology",
  "infectiology": "Microbiology",
  "parasitology": "Parasites",
  "nervous-system": "Neuroscience",
  "neural-cells": "Neuroscience",
  "bones": "Human physiology",
  "bone-structure": "Human physiology",
  "bone-fractures": "Human physiology",
  "arteries-physiology": "Human physiology",
  "arteries-pathophysiology": "Human physiology",
  "arteries-atherothrombosis": "Human physiology",
  "heart-physiology": "Human physiology",
  "heart-pathophysiology": "Human physiology",
  "lymphatic-system": "Human physiology",
  "urinary-system": "Human physiology",
  "veins": "Human physiology",
  "respiratory-system": "Human physiology",
  "digestive-system": "Human physiology",
  "endocrinology": "Human physiology",
  "diabetes": "Human physiology",
  "reproduction": "Human physiology",
  "dermatology": "Human physiology",
  "ophthalmology": "Human physiology",
  "ent": "Human physiology",
  "embryology": "Cell types",
  "muscles": "Human physiology",
  "lipids": "Chemistry",
  "chemistry": "Chemistry",
  "drugs": "Chemistry",
  "lab-apparatus": "Lab apparatus",
  "medical-acts": "Procedures",
  "medical-equipment": "Lab apparatus",
  "emergency-equipment": "Lab apparatus",
  "paraclinical-exams": "Imaging",
  "risk-factors": "Human physiology",
  "animals": "Animals",
  "dietetics": "General",
  "general-items": "General",
  "people": "People",
  "scientific-graphs": "Scientific graphs",
  "world-maps": "General",
};
export function servierCategory(slug) {
  const k = (slug || "").toLowerCase().replace(/\s+/g, "-");
  return SERVIER_CATEGORY[k] || "General";
}

/** SwissBioPics image name (e.g. "Animal_cells", "Bacteria2M_rod") -> curated taxonomy leaf. */
export function swissbiopicsCategory(name) {
  const t = (name || "").toLowerCase();
  if (/^bacteria|^archaea|^mollicutes/.test(t)) return "Bacteria & archaea";
  if (/^fung|^yeast|^pombe/.test(t)) return "Fungi";
  if (/^animal|^muscle|^epithelial|^neuron|^photoreceptor|^egg|^spermatozoa|^cnidocyte|^host/.test(t)) return "Cell types";
  if (/^plant|^chlamydomona/.test(t)) return "Plants & algae";
  if (/^eukaryota/.test(t)) return "Cell types";
  if (/^trypanosoma|^apicomplexa/.test(t)) return "Parasites";
  return "Intracellular components";
}

/** EMBL-EBI Icon Fonts source directory + filename -> curated taxonomy leaf.
 *  dir is the subdirectory name within source/ (e.g. "species", "fileformats"). */
const EBI_SPECIES_MAMMALS = new Set([
  "alpaca", "armadillo", "bat", "cat", "chimpanzee", "cow", "dog", "dolphin", "elephant",
  "ferret", "goat", "gorilla", "guinea-pig", "hedgehog", "horse", "human", "kangaroo-rat",
  "marmoset", "monkey", "monodelphis", "mouse", "mouse-lemur", "orangutan", "papio", "pig",
  "platypus", "rabbit", "rat", "sheep", "shrew", "squirrel", "wallaby",
]);
const EBI_SPECIES_BIRDS = new Set(["chicken", "finch"]);
const EBI_SPECIES_FISH = new Set(["pufferfish", "ray", "zebrafish"]);
const EBI_SPECIES_INSECTS = new Set(["bee", "fly", "louse", "mosquito"]);
const EBI_SPECIES_ARACHNIDS = new Set(["scorpion", "spider", "tick"]);
const EBI_SPECIES_MOLLUSCS = new Set(["snail"]);
const EBI_SPECIES_MICROBES = new Set(["amoeba", "aspergillus", "diatom", "ecoli", "fungus", "plasmodium", "virus", "yeast"]);
const EBI_SPECIES_WORMS = new Set(["c-elegans"]);
const EBI_SPECIES_PLANTS = new Set(["barley", "brachypodium", "brassica", "corn", "glycinemax", "grapes", "plant", "rice", "tomatoes"]);
const EBI_SPECIES_REPTILES = new Set(["anolis"]);
const EBI_SPECIES_AMPHIBIANS = new Set(["frog"]);

export function ebiCategory(dir, name) {
  if (dir === "species") {
    if (EBI_SPECIES_MAMMALS.has(name)) return "Mammals";
    if (EBI_SPECIES_BIRDS.has(name)) return "Birds";
    if (EBI_SPECIES_FISH.has(name)) return "Fishes";
    if (EBI_SPECIES_INSECTS.has(name)) return "Insects";
    if (EBI_SPECIES_ARACHNIDS.has(name)) return "Arachnids";
    if (EBI_SPECIES_MOLLUSCS.has(name)) return "Molluscs";
    if (EBI_SPECIES_MICROBES.has(name)) return "Microbiology";
    if (EBI_SPECIES_WORMS.has(name)) return "Worms";
    if (EBI_SPECIES_PLANTS.has(name)) return "Plants & algae";
    if (EBI_SPECIES_REPTILES.has(name)) return "Reptiles";
    if (EBI_SPECIES_AMPHIBIANS.has(name)) return "Amphibians";
    return "Animals";
  }
  if (dir === "conceptual") {
    if (/dna|rna|nucleic/.test(name)) return "Nucleic acids";
    if (/protein|structure/.test(name)) return "Peptides";
    if (/chemical|chem/.test(name)) return "Chemistry";
    if (/ontology|systems|expression|literature|cross-domain/.test(name)) return "Bioinformatics";
    return "Bioinformatics";
  }
  if (dir === "fileformats") return "Bioinformatics";
  if (dir === "chemistry") return "Chemistry";
  if (dir === "functional") {
    if (/database|submit|download|browse/.test(name)) return "Bioinformatics";
    if (/analyse|compare|filter|graph/.test(name)) return "Scientific graphs";
    if (/sequence|dna|protein/.test(name)) return "Molecular biology";
    return "General";
  }
  if (dir === "generic") {
    if (/database|data/.test(name)) return "Bioinformatics";
    return "General";
  }
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
  // Strip Adobe Illustrator private-data blocks (<i:aipgf>/<i:pgf>): a zstd/base64
  // editable-copy blob that never renders, bloats files ~5x, and (when its CDATA
  // is malformed) can carry a stray </svg> that breaks XML parsing entirely.
  // GREEDY to the last close: this region is always trailing Adobe metadata, and
  // some exports are corrupted with a duplicated </i:aipgf> + orphaned base64; a
  // non-greedy match would stop at the first close and leave the orphan behind.
  svg = svg.replace(/<i:aipgf\b[\s\S]*<\/i:aipgf>/gi, "");
  svg = svg.replace(/<i:pgf\b[\s\S]*<\/i:pgf>/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "");
  svg = svg.replace(/\son\w+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");
  // Neutralize external/script hrefs but keep internal (#id) refs for fills/gradients.
  svg = svg.replace(/((?:xlink:)?href)\s*=\s*"(?!#)[^"]*"/gi, '$1="#"');
  // Repair Adobe Illustrator empty-prefix namespace declarations (xmlns:x="" ...).
  // Binding a non-default prefix to "" is illegal in XML 1.0, so the browser's
  // strict <img> XML parser rejects the WHOLE file ("must not undeclare prefix")
  // and the thumbnail renders blank. Rebind to valid URIs so prefixed attrs/
  // elements (i:/x:/graph:) stay bound and the document parses + renders.
  const NS_URIS = {
    x: "http://ns.adobe.com/Extensibility/1.0/",
    i: "http://ns.adobe.com/AdobeIllustrator/10.0/",
    graph: "http://ns.adobe.com/Graphs/1.0/",
  };
  svg = svg.replace(/xmlns:([a-zA-Z_][\w.-]*)\s*=\s*"\s*"/g, (_m, prefix) => {
    const uri = NS_URIS[prefix] || `https://research-os.app/ns/${prefix}`;
    return `xmlns:${prefix}="${uri}"`;
  });
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
