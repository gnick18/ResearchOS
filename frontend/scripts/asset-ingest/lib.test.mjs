// Unit tests for the ingest lib. Run: `node --test scripts/asset-ingest/lib.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLicense, formatCredit, sanitizeSvg, reactomeCategory, healthiconsCategory, tablerCategory, scidrawCategory, janoshDiagramsCategory, electricalSymbolCategory } from "./lib.mjs";

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
  // Core EE symbols -> Computer hardware.
  assert.equal(electricalSymbolCategory("core"), "Computer hardware");
  assert.equal(electricalSymbolCategory("semiconductors"), "Computer hardware");
  assert.equal(electricalSymbolCategory("resistor"), "Computer hardware");
  assert.equal(electricalSymbolCategory("capacitor"), "Computer hardware");
  assert.equal(electricalSymbolCategory("inductor"), "Computer hardware");
  assert.equal(electricalSymbolCategory("transistors"), "Computer hardware");
  assert.equal(electricalSymbolCategory("passives"), "Computer hardware");
  assert.equal(electricalSymbolCategory("amplifiers"), "Computer hardware");
  assert.equal(electricalSymbolCategory("sources"), "Computer hardware");
  assert.equal(electricalSymbolCategory("misc"), "Computer hardware");
  assert.equal(electricalSymbolCategory("diode"), "Computer hardware");
  // Transducers -> Lab apparatus (physical devices).
  assert.equal(electricalSymbolCategory("transducers"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("loudspeaker"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("piezo"), "Lab apparatus");
  assert.equal(electricalSymbolCategory("sensor"), "Lab apparatus");
  // KiCad library name patterns.
  assert.equal(electricalSymbolCategory("Device"), "Computer hardware");
  assert.equal(electricalSymbolCategory("Power"), "Computer hardware");
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
