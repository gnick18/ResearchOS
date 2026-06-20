// Unit tests for the ingest lib. Run: `node --test scripts/asset-ingest/lib.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLicense, formatCredit, sanitizeSvg, reactomeCategory, healthiconsCategory, tablerCategory, scidrawCategory, janoshDiagramsCategory, electricalSymbolCategory, servierCategory, swissbiopicsCategory, ebiCategory, arcadiaCategory, togopicCategory } from "./lib.mjs";

test("classifyLicense: allowed set", () => {
  for (const [s, id] of [
    ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0"],
    ["https://creativecommons.org/licenses/by/4.0/", "CC-BY"],
    ["https://creativecommons.org/licenses/by-sa/4.0/", "CC-BY-SA"],
    ["Public Domain", "Public Domain"],
  ]) {
    const r = classifyLicense(s);
    assert.equal(r.id, id, s);
    assert.equal(r.allowed, true, s);
  }
  // attribution flags
  assert.equal(classifyLicense("CC-BY").attribution, true);
  assert.equal(classifyLicense("CC0").attribution, false);
  assert.equal(classifyLicense("Public Domain").attribution, false);
});

test("classifyLicense: BioIcons tags (hyphen cc-0 + permissive code licenses)", () => {
  // BioIcons license values are lowercase path tags.
  assert.deepEqual(classifyLicense("cc-0"), { id: "CC0", allowed: true, attribution: false });
  assert.equal(classifyLicense("cc-by").id, "CC-BY");
  assert.equal(classifyLicense("cc-by-sa").id, "CC-BY-SA");
  // MIT/BSD: allowed, but retain the notice -> attribution true.
  assert.deepEqual(classifyLicense("mit"), { id: "MIT", allowed: true, attribution: true });
  assert.deepEqual(classifyLicense("bsd"), { id: "BSD", allowed: true, attribution: true });
});

test("classifyLicense: excluded NC / ND", () => {
  for (const s of [
    "https://creativecommons.org/licenses/by-nc/4.0/",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    "https://creativecommons.org/licenses/by-nd/4.0/",
    "some unknown thing",
  ]) {
    assert.equal(classifyLicense(s).allowed, false, s);
  }
});

test("formatCredit: per-source format", () => {
  const c = formatCredit({
    source: "phylopic",
    title: "Strix aluco",
    creator: "T. Michael Keesey",
    license: "CC-BY",
    sourceUrl: "https://www.phylopic.org/images/abc",
  });
  assert.match(c, /Strix aluco by T\. Michael Keesey/);
  assert.match(c, /PhyloPic/);
  assert.match(c, /\(CC-BY\)/);

  // Reactome Icon Library credits the icon designer (CC BY 4.0 requires attribution).
  const r = formatCredit({
    source: "reactome",
    title: "Mitochondrial protein",
    creator: "Cristoffer Sevilla",
    license: "CC-BY",
    sourceUrl: "https://reactome.org/content/detail/R-ICO-013019",
  });
  assert.match(r, /Mitochondrial protein by Cristoffer Sevilla/);
  assert.match(r, /Reactome Icon Library/);
  assert.match(r, /\(CC-BY\)/);

  // Health Icons are MIT; courtesy credit retains the project notice.
  const h = formatCredit({
    source: "healthicons",
    title: "lungs",
    creator: "Resolve to Save Lives",
    license: "MIT",
    sourceUrl: "https://healthicons.org/icons/lungs",
  });
  assert.match(h, /Health Icons by Resolve to Save Lives/);
  assert.match(h, /\(MIT\)/);
});

test("category mappers land on existing curated leaves (never bare source slugs)", () => {
  // Reactome -> taxonomy leaves; unknown -> General.
  assert.equal(reactomeCategory("protein"), "Molecular biology");
  assert.equal(reactomeCategory("receptor"), "Receptors & channels");
  assert.equal(reactomeCategory("transporter"), "Receptors & channels");
  assert.equal(reactomeCategory("cell_element"), "Intracellular components");
  assert.equal(reactomeCategory("cell type"), "Cell types"); // space or underscore
  assert.equal(reactomeCategory("compound"), "Chemistry");
  assert.equal(reactomeCategory("arrow"), "General");
  assert.equal(reactomeCategory("nonsense"), "General");
  // Health Icons -> taxonomy leaves; life-stuff -> General.
  assert.equal(healthiconsCategory("blood"), "Blood & immunology");
  assert.equal(healthiconsCategory("body"), "Human physiology");
  assert.equal(healthiconsCategory("devices"), "Lab apparatus");
  assert.equal(healthiconsCategory("ppe"), "Safety symbols");
  assert.equal(healthiconsCategory("zoonoses"), "Microbiology");
  assert.equal(healthiconsCategory("vehicles"), "General");
  // Tabler: science/tech categories map to leaves; UI/brand categories return null (skip).
  assert.equal(tablerCategory("Health"), "Human physiology");
  assert.equal(tablerCategory("Computers"), "Computer hardware");
  assert.equal(tablerCategory("Charts"), "Scientific graphs");
  assert.equal(tablerCategory("Electrical"), "Computer hardware");
  assert.equal(tablerCategory("System"), null); // UI -> skipped
  assert.equal(tablerCategory("Brand"), null); // logos -> skipped
  assert.equal(tablerCategory("Arrows"), null);
  // SciDraw freeform category words -> leaves by keyword; default General.
  assert.equal(scidrawCategory("optics"), "Physics");
  assert.equal(scidrawCategory("quantum"), "Physics");
  assert.equal(scidrawCategory("mouse"), "Mammals");
  assert.equal(scidrawCategory("brain"), "Neuroscience");
  assert.equal(scidrawCategory("syringe"), "Lab apparatus");
  assert.equal(scidrawCategory("something-unmapped"), "General");
});

test("formatCredit: physics + electronics sources", () => {
  // janosh/diagrams: MIT, credits the author + repo name.
  const j = formatCredit({
    source: "janosh-diagrams",
    title: "bloch sphere",
    creator: "Janosh Riebesell",
    license: "MIT",
    sourceUrl: "https://github.com/janosh/diagrams/blob/main/assets/bloch-sphere/bloch-sphere.svg",
  });
  assert.match(j, /bloch sphere by Janosh Riebesell/);
  assert.match(j, /janosh\/diagrams/);
  assert.match(j, /\(MIT\)/);

  // ElectricalSymbolLibrary: CC0, courtesy credit includes project name.
  const e = formatCredit({
    source: "electricalsymbollib",
    title: "capacitor",
    creator: "Bas Verdoes",
    license: "CC0",
    sourceUrl: "https://github.com/basverdoes/ElectricalSymbolLibrary/blob/main/src/symbols/analog-ansi/core/capacitor.svg",
  });
  assert.match(e, /Electrical Symbol Library by Bas Verdoes/);
  assert.match(e, /\(CC0\)/);

  // electronic-symbols: MIT, retains copyright notice + repo name.
  const es = formatCredit({
    source: "electronic-symbols",
    title: "Resistor (IEC)",
    creator: "Chris Pikul",
    license: "MIT",
    sourceUrl: "https://github.com/chris-pikul/electronic-symbols/blob/master/SVG/Resistor-IEC-Standard.svg",
  });
  assert.match(es, /Resistor \(IEC\) by Chris Pikul/);
  assert.match(es, /chris-pikul\/electronic-symbols/);
  assert.match(es, /\(MIT\)/);

  // AcheronProject: BSD, retains copyright notice.
  const a = formatCredit({
    source: "acheron-electrical",
    title: "resistors (passives) schematic template",
    creator: "AcheronProject contributors",
    license: "BSD",
    sourceUrl: "https://github.com/AcheronProject/electrical_template/blob/main/passives/resistors.svg",
  });
  assert.match(a, /AcheronProject\/electrical_template/);
  assert.match(a, /\(BSD\)/);

  // KiCad symbols: CC-BY-SA, credit line must contain "CC-BY-SA".
  const k = formatCredit({
    source: "kicad-symbols",
    title: "R",
    creator: "KiCad Library contributors",
    license: "CC-BY-SA",
    sourceUrl: "https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/master/Device.kicad_sym",
  });
  assert.match(k, /KiCad Symbol Libraries/);
  assert.match(k, /\(CC-BY-SA\)/);
});

test("janoshDiagramsCategory: maps slugs to correct leaves", () => {
  // Physics leaves.
  assert.equal(janoshDiagramsCategory("bloch-sphere"), "Physics");
  assert.equal(janoshDiagramsCategory("feynman-diagram-1"), "Physics");
  assert.equal(janoshDiagramsCategory("higgs-potential"), "Physics");
  assert.equal(janoshDiagramsCategory("maxwell-boltzmann-distribution"), "Physics");
  assert.equal(janoshDiagramsCategory("seebeck-effect"), "Physics");
  assert.equal(janoshDiagramsCategory("mosfet"), "Physics");
  assert.equal(janoshDiagramsCategory("amplitude-modulation"), "Physics");
  // Math leaves.
  assert.equal(janoshDiagramsCategory("branch-cuts-1"), "Math");
  assert.equal(janoshDiagramsCategory("torus-fundamental-domain"), "Math");
  assert.equal(janoshDiagramsCategory("graph-isomorphism"), "Math");
  assert.equal(janoshDiagramsCategory("saddle-point"), "Math");
  assert.equal(janoshDiagramsCategory("jensens-inequality"), "Math");
  // Chemistry leaf.
  assert.equal(janoshDiagramsCategory("organic-molecule"), "Chemistry");
  assert.equal(janoshDiagramsCategory("periodic-table"), "Chemistry");
  assert.equal(janoshDiagramsCategory("dft-jacobs-ladder"), "Chemistry");
  // ML -> Computer hardware (Data & informatics section).
  assert.equal(janoshDiagramsCategory("variational-autoencoder"), "Computer hardware");
  assert.equal(janoshDiagramsCategory("multilayer-perceptron"), "Computer hardware");
  assert.equal(janoshDiagramsCategory("long-short-term-memory"), "Computer hardware");
  assert.equal(janoshDiagramsCategory("generative-adversarial-network"), "Computer hardware");
  // Unknown -> Physics (repo default).
  assert.equal(janoshDiagramsCategory("some-unknown-diagram"), "Physics");
  // Verify leaves exist in CATEGORY_SECTIONS (they all must be exact matches).
  const leaves = ["Physics", "Math", "Chemistry", "Computer hardware"];
  for (const leaf of leaves) {
    assert.ok(typeof leaf === "string" && leaf.length > 0, `leaf "${leaf}" must be non-empty`);
  }
});

test("electricalSymbolCategory: maps electrical subcat/name to correct leaf", () => {
  // Core EE symbols -> Electronics (the dedicated circuit-symbol leaf).
  assert.equal(electricalSymbolCategory("core"), "Electronics");
  assert.equal(electricalSymbolCategory("semiconductors"), "Electronics");
  assert.equal(electricalSymbolCategory("resistor"), "Electronics");
  assert.equal(electricalSymbolCategory("capacitor"), "Electronics");
  assert.equal(electricalSymbolCategory("inductor"), "Electronics");
  assert.equal(electricalSymbolCategory("transistors"), "Electronics");
  assert.equal(electricalSymbolCategory("passives"), "Electronics");
  assert.equal(electricalSymbolCategory("amplifiers"), "Electronics");
  assert.equal(electricalSymbolCategory("sources"), "Electronics");
  assert.equal(electricalSymbolCategory("misc"), "Electronics");
  assert.equal(electricalSymbolCategory("diode"), "Electronics");
  // Transducers -> Lab apparatus (physical devices).
  assert.equal(electricalSymbolCategory("transducers"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("loudspeaker"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("piezo"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("sensor"), "Lab apparatus");
  // KiCad library name patterns.
  assert.equal(electricalSymbolCategory("Device"), "Electronics");
  assert.equal(electricalSymbolCategory("Power"), "Electronics");
});

test("sanitizeSvg: strips scripts/handlers, keeps fills + viewBox", () => {
  const dirty =
    '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">' +
    '<script>alert(1)</script>' +
    '<path d="M0 0h10v10H0z" fill="#ff0000" onclick="evil()"/>' +
    '<circle cx="5" cy="5" r="3" fill="#00ff00"/></svg>';
  const { svg, fills, hasViewBox } = sanitizeSvg(dirty);
  assert.ok(!/<script/i.test(svg), "script removed");
  assert.ok(!/onclick/i.test(svg), "handler removed");
  assert.ok(/fill="#ff0000"/.test(svg) && /fill="#00ff00"/.test(svg), "fills preserved");
  assert.equal(fills, 2, "two distinct fills counted (per-fill recolor ready)");
  assert.equal(hasViewBox, true);
});

test("sanitizeSvg: rebinds Adobe empty-prefix namespaces so the file parses + renders", () => {
  // Adobe Illustrator export: xmlns:x/i/graph bound to "" is illegal XML and
  // makes the browser <img> parser reject the whole file -> blank thumbnail.
  const dirty =
    '<svg version="1.1" xmlns:x="" xmlns:i="" xmlns:graph="" ' +
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
    '<i:pgf></i:pgf><path d="M0 0h10v10H0z" fill="#123456"/></svg>';
  const { svg } = sanitizeSvg(dirty);
  assert.ok(!/xmlns:\w+=""/.test(svg), "no empty-prefix decls remain");
  assert.ok(/xmlns:x="http:\/\/ns\.adobe\.com\/Extensibility/.test(svg), "x prefix rebound to a valid URI");
  assert.ok(/xmlns:i="http:\/\/ns\.adobe\.com\/AdobeIllustrator/.test(svg), "i prefix rebound");
  assert.ok(/xmlns:graph="http:\/\/ns\.adobe\.com\/Graphs/.test(svg), "graph prefix rebound");
});

test("sanitizeSvg: neutralizes external href but keeps internal #refs", () => {
  const s =
    '<svg viewBox="0 0 1 1"><a href="https://evil.test">x</a>' +
    '<use href="#frag"/><rect fill="url(#grad)"/></svg>';
  const { svg } = sanitizeSvg(s);
  assert.ok(!/evil\.test/.test(svg), "external href neutralized");
  assert.ok(/href="#frag"/.test(svg), "internal #ref kept");
  assert.ok(/url\(#grad\)/.test(svg), "gradient ref kept");
});

// ---------------------------------------------------------------------------
// New mapper tests: Servier, SwissBioPics, EMBL-EBI.

test("servierCategory: PPTX topic slugs map to curated leaves", () => {
  assert.equal(servierCategory("Blood-immunology"), "Blood & immunology");
  assert.equal(servierCategory("Nucleic-acids"), "Nucleic acids");
  assert.equal(servierCategory("Genetics"), "Genetics");
  assert.equal(servierCategory("Intracellular-components"), "Intracellular components");
  assert.equal(servierCategory("Cell-membrane"), "Cell membrane");
  assert.equal(servierCategory("Receptors-channels"), "Receptors & channels");
  assert.equal(servierCategory("Oncology"), "Oncology");
  assert.equal(servierCategory("Tissues"), "Tissues");
  assert.equal(servierCategory("Microbiology-cell-culture"), "Microbiology");
  assert.equal(servierCategory("Infectiology"), "Microbiology");
  assert.equal(servierCategory("Parasitology"), "Parasites");
  assert.equal(servierCategory("Nervous-system"), "Neuroscience");
  assert.equal(servierCategory("Heart-physiology"), "Human physiology");
  assert.equal(servierCategory("Chemistry"), "Chemistry");
  assert.equal(servierCategory("Lab-apparatus"), "Lab apparatus");
  assert.equal(servierCategory("Paraclinical-exams"), "Imaging");
  assert.equal(servierCategory("Animals"), "Animals");
  assert.equal(servierCategory("People"), "People");
  assert.equal(servierCategory("Scientific-graphs"), "Scientific graphs");
  assert.equal(servierCategory("General-items"), "General");
  // Unknown slug falls through to General.
  assert.equal(servierCategory("Something-unknown"), "General");
});

test("servierCategory: CC-BY license is allowed + requires attribution", () => {
  // Confirm the license used in the Servier adapter passes the policy gate.
  const lic = classifyLicense("https://creativecommons.org/licenses/by/4.0/");
  assert.equal(lic.id, "CC-BY");
  assert.equal(lic.allowed, true);
  assert.equal(lic.attribution, true);
});

test("formatCredit: servier uses the Servier Medical Art project name", () => {
  const c = formatCredit({
    source: "servier",
    title: "Heart anatomy",
    creator: "Servier Medical Art",
    license: "CC-BY",
    sourceUrl: "https://smart.servier.com",
  });
  assert.match(c, /Servier Medical Art/);
  assert.match(c, /Heart anatomy/);
  assert.match(c, /\(CC-BY\)/);
  // No em-dash in the credit.
  assert.ok(!c.includes("—"), "no em-dash");
});

test("swissbiopicsCategory: cell names map to curated leaves", () => {
  assert.equal(swissbiopicsCategory("Animal_cells"), "Cell types");
  assert.equal(swissbiopicsCategory("Bacteria1M_rod"), "Bacteria & archaea");
  assert.equal(swissbiopicsCategory("Bacteria2M_coccus"), "Bacteria & archaea");
  assert.equal(swissbiopicsCategory("Archaea_cells"), "Bacteria & archaea");
  assert.equal(swissbiopicsCategory("Fungal_cells"), "Fungi");
  assert.equal(swissbiopicsCategory("Yeast_cells"), "Fungi");
  assert.equal(swissbiopicsCategory("Plant_cells"), "Plants & algae");
  assert.equal(swissbiopicsCategory("Neuron_cells"), "Cell types");
  assert.equal(swissbiopicsCategory("Muscle_cells"), "Cell types");
  assert.equal(swissbiopicsCategory("Eukaryota_cells"), "Cell types");
  assert.equal(swissbiopicsCategory("Trypanosoma"), "Parasites");
  assert.equal(swissbiopicsCategory("Apicomplexa_cells"), "Parasites");
  // Default fallback.
  assert.equal(swissbiopicsCategory("Spermatozoa_cell"), "Cell types");
});

test("formatCredit: swissbiopics credits SIB with CC-BY", () => {
  const c = formatCredit({
    source: "swissbiopics",
    title: "Animal cells",
    creator: "SIB Swiss Institute of Bioinformatics",
    license: "CC-BY",
    sourceUrl: "https://www.swissbiopics.org",
  });
  assert.match(c, /SwissBioPics/);
  assert.match(c, /SIB Swiss Institute of Bioinformatics/);
  assert.match(c, /\(CC-BY\)/);
});

test("ebiCategory: species names map to correct organism leaves", () => {
  // Mammals.
  assert.equal(ebiCategory("species", "human"), "Mammals");
  assert.equal(ebiCategory("species", "mouse"), "Mammals");
  assert.equal(ebiCategory("species", "rat"), "Mammals");
  assert.equal(ebiCategory("species", "pig"), "Mammals");
  // Birds.
  assert.equal(ebiCategory("species", "chicken"), "Birds");
  assert.equal(ebiCategory("species", "finch"), "Birds");
  // Fish.
  assert.equal(ebiCategory("species", "zebrafish"), "Fishes");
  assert.equal(ebiCategory("species", "pufferfish"), "Fishes");
  // Insects.
  assert.equal(ebiCategory("species", "fly"), "Insects");
  assert.equal(ebiCategory("species", "mosquito"), "Insects");
  // Arachnids.
  assert.equal(ebiCategory("species", "spider"), "Arachnids");
  assert.equal(ebiCategory("species", "tick"), "Arachnids");
  // Molluscs.
  assert.equal(ebiCategory("species", "snail"), "Molluscs");
  // Microbes.
  assert.equal(ebiCategory("species", "ecoli"), "Microbiology");
  assert.equal(ebiCategory("species", "yeast"), "Microbiology");
  assert.equal(ebiCategory("species", "virus"), "Microbiology");
  // Worms.
  assert.equal(ebiCategory("species", "c-elegans"), "Worms");
  // Plants.
  assert.equal(ebiCategory("species", "barley"), "Plants & algae");
  assert.equal(ebiCategory("species", "rice"), "Plants & algae");
  // Unknown species -> Animals (conservative fallback).
  assert.equal(ebiCategory("species", "unknown-critter"), "Animals");
});

test("ebiCategory: conceptual and format dirs map to bioinformatics leaves", () => {
  assert.equal(ebiCategory("conceptual", "dna"), "Nucleic acids");
  assert.equal(ebiCategory("conceptual", "proteins"), "Peptides");
  assert.equal(ebiCategory("conceptual", "chemical"), "Chemistry");
  assert.equal(ebiCategory("conceptual", "ontology"), "Bioinformatics");
  assert.equal(ebiCategory("fileformats", "FASTA"), "Bioinformatics");
  assert.equal(ebiCategory("fileformats", "BAM"), "Bioinformatics");
  assert.equal(ebiCategory("chemistry", "direction_left"), "Chemistry");
  assert.equal(ebiCategory("functional", "analyse"), "Scientific graphs");
  assert.equal(ebiCategory("generic", "something"), "General");
});

test("formatCredit: ebi carries CC-BY-SA in the credit label", () => {
  // This is the critical orchestrator requirement: CC-BY-SA must appear in
  // the formatted credit string so downstream citation tools see the SA term.
  const c = formatCredit({
    source: "ebi",
    title: "human",
    creator: "EMBL-EBI",
    license: "CC-BY-SA",
    sourceUrl: "https://github.com/ebiwd/EBI-Icon-fonts/blob/v1.3/source/species/human.svg",
  });
  assert.match(c, /EMBL-EBI/);
  assert.match(c, /CC-BY-SA/);
  assert.match(c, /human/);
});

test("classifyLicense: CC-BY-SA 4.0 is allowed with attribution and share-alike id", () => {
  // Confirms the license used by EMBL-EBI passes the ingest gate AND carries the right id.
  const lic = classifyLicense("https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(lic.id, "CC-BY-SA");
  assert.equal(lic.allowed, true);
  assert.equal(lic.attribution, true);
});

// Arcadia category mapper

test("arcadiaCategory: exact taxon matches land on valid curated leaves", () => {
  // Verify a representative sample from each leaf type.
  assert.equal(arcadiaCategory("Mus musculus"), "Mammals");
  assert.equal(arcadiaCategory("Rattus norvegicus"), "Mammals");
  assert.equal(arcadiaCategory("Gallus gallus"), "Birds");
  assert.equal(arcadiaCategory("Taeniopygia guttata"), "Birds");
  assert.equal(arcadiaCategory("Danio rerio"), "Fishes");
  assert.equal(arcadiaCategory("Petromyzon marinus"), "Fishes");
  assert.equal(arcadiaCategory("Xenopus tropicalis"), "Amphibians");
  assert.equal(arcadiaCategory("Anolis carolinensis"), "Reptiles");
  assert.equal(arcadiaCategory("Drosophila melanogaster"), "Insects");
  assert.equal(arcadiaCategory("Aedes aegypti"), "Insects");
  assert.equal(arcadiaCategory("Caenorhabditis elegans"), "Worms");
  assert.equal(arcadiaCategory("Schmidtea mediterranea"), "Worms");
  assert.equal(arcadiaCategory("Pristionchus pacificus"), "Worms");
  assert.equal(arcadiaCategory("Hofstenia miamia"), "Worms");
  assert.equal(arcadiaCategory("Hydra vulgaris"), "Cnidarians");
  assert.equal(arcadiaCategory("Clytia hemisphaerica"), "Cnidarians");
  assert.equal(arcadiaCategory("Nematostella vectensis"), "Cnidarians");
  assert.equal(arcadiaCategory("Ciona intestinalis"), "Other invertebrates");
  assert.equal(arcadiaCategory("Hypsibius dujardini"), "Other invertebrates");
  assert.equal(arcadiaCategory("Arabidopsis thaliana"), "Plants & algae");
  assert.equal(arcadiaCategory("Chlamydomonas reinhardtii"), "Plants & algae");
  assert.equal(arcadiaCategory("Saccharomyces cerevisiae"), "Fungi");
  assert.equal(arcadiaCategory("Aspergillus nidulans"), "Fungi");
  assert.equal(arcadiaCategory("Candida albicans"), "Fungi");
  assert.equal(arcadiaCategory("Escherichia coli"), "Bacteria & archaea");
  assert.equal(arcadiaCategory("Entamoeba histolytica"), "Protists");
  assert.equal(arcadiaCategory("Paramecium tetraurelia"), "Protists");
  assert.equal(arcadiaCategory("Dictyostelium discoideum"), "Protists");
  assert.equal(arcadiaCategory("Human immunodeficiency virus"), "Viruses");
  assert.equal(arcadiaCategory("Influenza virus"), "Viruses");
  assert.equal(arcadiaCategory("SARS-CoV-2"), "Viruses");
  assert.equal(arcadiaCategory("Plasmodium falciparum"), "Parasites");
  assert.equal(arcadiaCategory("Schistosoma mansoni"), "Parasites");
});

test("arcadiaCategory: keyword fallback handles novel organisms, unknown -> Other organisms", () => {
  // Future library additions not in the exact table fall through to keywords.
  assert.equal(arcadiaCategory("Some new virus XYZ"), "Viruses");
  assert.equal(arcadiaCategory("Novel fungi sp."), "Fungi");
  assert.equal(arcadiaCategory("A completely new algae"), "Plants & algae");
  // Totally unknown -> Other organisms (never lands in Other = never loses an asset).
  assert.equal(arcadiaCategory("Completely unrecognized thing"), "Other organisms");
});

test("arcadiaCategory: all 71 v1.0 organisms map to valid CATEGORY_SECTIONS leaves", () => {
  // This is a completeness gate: if any organism in the v1.0 set is unmapped,
  // it will show up as "Other organisms" which IS a valid leaf; the test checks
  // it matches one of the leaves in the Organisms section (never "General" or
  // another section -- those would indicate an incorrect keyword-fallback hit).
  const ORGANISMS_LEAVES = new Set([
    "Mammals","Birds","Reptiles","Amphibians","Fishes","Insects","Arachnids",
    "Crustaceans","Myriapods","Molluscs","Cnidarians","Echinoderms","Worms",
    "Other invertebrates","Plants & algae","Fungi","Bacteria & archaea","Protists",
    "Other organisms","Animals",
    // Microbes & pathogens is also a valid home for single-celled organisms.
    "Microbiology","Viruses","Parasites",
  ]);
  const allOrganisms = [
    "Abeoforma whisleri","Aedes aegypti","Agaricus bisporus","Amorphochlora amoebiformis",
    "Anolis carolinensis","Arabidopsis thaliana","Aspergillus nidulans","Bathycoccus prasinos",
    "Bodo saltans","Caenorhabditis elegans","Callithrix jacchus","Callorhinchus milii",
    "Candida albicans","Carlito syrichta","Chlamydomonas reinhardtii","Chlorella vulgaris",
    "Ciona intestinalis","Clytia hemisphaerica","Danio rerio","Dictyostelium discoideum",
    "Diplonema papillatum","Drosophila melanogaster","Entamoeba histolytica","Escherichia coli",
    "Euglena gracilis","Exaiptasia diaphana","Gallus gallus","Giardia intestinalis",
    "Hofstenia miamia","Human immunodeficiency virus","Hydra vulgaris","Hypsibius dujardini",
    "Influenza virus","Isochrysis galbana","Macaca mulatta","Microcebus murinus",
    "Micromonas commoda","Mnemiopsis leidyi","Monosiga brevicollis","Mus musculus",
    "Naegleria gruberi","Nannochloropsis sp.","Nematostella vectensis","Neurospora crassa",
    "Ostreococcus tauri","Pan troglodytes","Paramecium tetraurelia","Penicillium chrysogenum",
    "Perkinsus marinus","Petromyzon marinus","Phaeodactylum tricornutum","Plasmodium falciparum",
    "Porphyra yezoensis","Pristionchus pacificus","Rattus norvegicus","SARS-CoV-2",
    "Saccharomyces cerevisiae","Salpingoeca rosetta","Schistosoma mansoni",
    "Schizosaccharomyces pombe","Schmidtea mediterranea","Sphaeroforma arctica",
    "Sus scrofa domestica","Symbiodinium sp.","Taeniopygia guttata","Tetrahymena thermophila",
    "Tetraselmis striata","Ustilago maydis","Volvox carteri","Xenopus tropicalis",
    "Yarrowia lipolytica",
  ];
  for (const org of allOrganisms) {
    const leaf = arcadiaCategory(org);
    assert.ok(
      ORGANISMS_LEAVES.has(leaf),
      `${org} -> "${leaf}" is not in valid organism/microbe leaves`,
    );
  }
});

// ---------------------------------------------------------------------------
// Togopic (DBCLS Togo Picture Gallery) category mapper

test("togopicCategory: life-science filenames -> correct curated leaves", () => {
  // Lab apparatus filenames.
  assert.equal(togopicCategory("beaker1"), "Lab apparatus");
  assert.equal(togopicCategory("flask1"), "Lab apparatus");
  assert.equal(togopicCategory("thermalcycler_1"), "Lab apparatus");
  assert.equal(togopicCategory("GenomeSequencer_1"), "Lab apparatus");
  assert.equal(togopicCategory("centrifuge"), "Lab apparatus");
  // Cell lines (stripped YYYYMM_ prefix by the adapter before this call).
  assert.equal(togopicCategory("CHOcells"), "Cell lines");
  assert.equal(togopicCategory("HeLa"), "Cell lines");
  assert.equal(togopicCategory("HEK293"), "Cell lines");
  // Human physiology.
  assert.equal(togopicCategory("anterior_view_of_the_elbow_joint"), "Human physiology");
  assert.equal(togopicCategory("trachea_and_bronchial_tree"), "Human physiology");
  // Blood & immunology.
  assert.equal(togopicCategory("IgG"), "Blood & immunology");
  // Nucleic acids / molecular biology.
  assert.equal(togopicCategory("DNA"), "Nucleic acids");
  assert.equal(togopicCategory("RNA_polymerase"), "Nucleic acids");
  assert.equal(togopicCategory("western_blot"), "Molecular biology");
  // Organisms.
  assert.equal(togopicCategory("Zebrafish"), "Fishes");
  assert.equal(togopicCategory("mouse"), "Mammals");
  assert.equal(togopicCategory("budding_yeast"), "Fungi");
  assert.equal(togopicCategory("cyanobacteria"), "Bacteria & archaea");
  assert.equal(togopicCategory("virus"), "Viruses");
  // Neuroscience.
  assert.equal(togopicCategory("brain"), "Neuroscience");
  assert.equal(togopicCategory("neuron"), "Neuroscience");
  // Imaging.
  assert.equal(togopicCategory("confocal_scanning_laser_microscope"), "Imaging");
  // Unknown -> General (not lost in Other = never gated out).
  assert.equal(togopicCategory("some_random_item"), "General");
});

test("togopicCategory: returned leaves are all valid CATEGORY_SECTIONS members", () => {
  // All valid leaf names from asset-library.ts CATEGORY_SECTIONS.
  const ALL_LEAVES = new Set([
    "Mammals","Birds","Reptiles","Amphibians","Fishes","Insects","Arachnids",
    "Crustaceans","Myriapods","Molluscs","Cnidarians","Echinoderms","Worms",
    "Other invertebrates","Plants & algae","Fungi","Bacteria & archaea","Protists",
    "Other organisms","Animals","Microbiology","Viruses","Parasites",
    "Cell types","Cell lines","Cell culture","Cell membrane","Intracellular components",
    "Tissues","Extracellular matrix",
    "Nucleic acids","Amino acids","Peptides","Receptors & channels","Molecular modelling",
    "Molecular biology","Genetics","Genomics","Epigenetics",
    "Human physiology","Blood & immunology","Oncology","Neuroscience",
    "Lab apparatus","Procedures","Imaging","Safety symbols",
    "Chemistry",
    "Physics","Math",
    "Scientific graphs","Bioinformatics","Machine learning","Computer hardware","Nanotechnology",
    "People","General",
  ]);
  // Drive the mapper with a variety of real DBCLS filename patterns.
  const probes = [
    "beaker1","flask2","thermalcycler_1","confocal_scanning_laser_microscope",
    "brain","neuron","heart","lung","bone","blood","IgG","cancer","skin",
    "HeLa","HEK293","CHOcells","mitochondria","membrane","stem_cell",
    "DNA","RNA","western_blot","PCR","microarray","gene","RNAI",
    "bacteria","virus","yeast","fungi","plant","algae",
    "mouse","zebrafish","frog","bird","insect","spider","worm",
    "bioinformatics","graph","chart","safety","warning",
    "some_random_item",
  ];
  for (const p of probes) {
    const leaf = togopicCategory(p);
    assert.ok(ALL_LEAVES.has(leaf), `togopicCategory("${p}") -> "${leaf}" not in valid leaves`);
  }
});

// ---------------------------------------------------------------------------
// formatCredit: new sources

test("formatCredit: arcadia and togopic format correctly", () => {
  // Arcadia is CC0; credit includes "Arcadia Science" and the DOI URL.
  const a = formatCredit({
    source: "arcadia",
    title: "Mus musculus (silhouette)",
    creator: "Arcadia Science",
    license: "CC0",
    sourceUrl: "https://zenodo.org/records/17203578",
  });
  assert.match(a, /Mus musculus/);
  assert.match(a, /Arcadia Science/);
  assert.match(a, /zenodo\.org/);
  assert.match(a, /\(CC0\)/);

  // Togopic is CC-BY 4.0; credit names DBCLS TogoTV.
  const t = formatCredit({
    source: "togopic",
    title: "Beaker 1",
    creator: "DBCLS TogoTV",
    license: "CC-BY",
    sourceUrl: "https://dbarchive.biosciencedbc.jp/data/togo-pic/image/beaker1.svg",
  });
  assert.match(t, /Beaker 1/);
  assert.match(t, /DBCLS TogoTV/);
  assert.match(t, /\(CC-BY\)/);
});
