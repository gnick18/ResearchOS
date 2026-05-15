/**
 * Tests for the purchase-item vendor/category backfill heuristic +
 * driver. Runs under Node's built-in test runner — no vitest dependency.
 *
 *   node --test scripts/lib/__tests__/vendor-category-heuristics.test.mjs
 *
 * Or run the whole tree:
 *   node --test scripts/lib/__tests__/
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  inferVendorFromLink,
  inferCategoryFromName,
  extractHostname,
  VENDOR_HOSTNAME_MAP,
  CATEGORY_PATTERN_MAP,
} from "../vendor-category-heuristics.mjs";

import { run, planChanges } from "../../backfill-purchase-vendors.mjs";

// ── Pure-function tests ─────────────────────────────────────────────────────

describe("extractHostname", () => {
  test("returns lowercased hostname for a full URL", () => {
    assert.equal(extractHostname("https://www.neb.com/products/foo"), "www.neb.com");
  });
  test("tolerates missing scheme", () => {
    assert.equal(extractHostname("neb.com/foo"), "neb.com");
  });
  test("tolerates trailing slash", () => {
    assert.equal(extractHostname("https://neb.com/"), "neb.com");
  });
  test("mixed case input normalizes to lowercase hostname", () => {
    assert.equal(extractHostname("HTTPS://NEB.COM/Foo"), "neb.com");
  });
  test("null / undefined / empty / non-string → null", () => {
    assert.equal(extractHostname(null), null);
    assert.equal(extractHostname(undefined), null);
    assert.equal(extractHostname(""), null);
    assert.equal(extractHostname("   "), null);
    assert.equal(extractHostname(123), null);
  });
  test("malformed URL → null", () => {
    assert.equal(extractHostname("http://"), null);
    assert.equal(extractHostname("not a url at all !@#$"), null);
  });
});

describe("inferVendorFromLink — every entry in the table fires", () => {
  // Build a representative hostname for each entry by stripping the regex
  // anchors and picking the first alternative. This guards against typos
  // that would silently keep a vendor from ever matching.
  const samples = [
    { link: "https://neb.com/foo", expected: "NEB" },
    { link: "https://www.neb.com/foo", expected: "NEB" },
    { link: "https://sigmaaldrich.com/p/X", expected: "Sigma-Aldrich" },
    { link: "https://emdmillipore.com/p/X", expected: "Sigma-Aldrich" },
    { link: "https://idtdna.com/order", expected: "IDT" },
    { link: "https://eu.idtdna.com/order", expected: "IDT" },
    { link: "https://thermofisher.com/x", expected: "Thermo Fisher" },
    { link: "https://fishersci.com/x", expected: "Fisher Scientific" },
    { link: "https://www.fisherscientific.com/x", expected: "Fisher Scientific" },
    { link: "https://bio-rad.com/x", expected: "Bio-Rad" },
    { link: "https://promega.com/x", expected: "Promega" },
    { link: "https://qiagen.com/x", expected: "Qiagen" },
    { link: "https://genscript.com/x", expected: "GenScript" },
    { link: "https://twistbioscience.com/x", expected: "Twist Bioscience" },
    { link: "https://takarabio.com/x", expected: "Takara Bio" },
    { link: "https://addgene.org/x", expected: "Addgene" },
    { link: "https://atcc.org/x", expected: "ATCC" },
    { link: "https://genewiz.com/x", expected: "Azenta / Genewiz" },
    { link: "https://azenta.com/x", expected: "Azenta / Genewiz" },
    { link: "https://eurofinsgenomics.com/x", expected: "Eurofins Genomics" },
    { link: "https://cellsignal.com/x", expected: "Cell Signaling Technology" },
    { link: "https://abcam.com/x", expected: "Abcam" },
    { link: "https://vwr.com/x", expected: "VWR / Avantor" },
    { link: "https://eppendorf.com/x", expected: "Eppendorf" },
    { link: "https://corning.com/x", expected: "Corning" },
    { link: "https://mcmaster.com/x", expected: "McMaster-Carr" },
    { link: "https://usascientific.com/x", expected: "USA Scientific" },
    { link: "https://beckman.com/x", expected: "Beckman Coulter" },
    { link: "https://lonza.com/x", expected: "Lonza" },
    { link: "https://amazon.com/x", expected: "Amazon" },
  ];
  for (const { link, expected } of samples) {
    test(`${link} → ${expected}`, () => {
      assert.equal(inferVendorFromLink(link), expected);
    });
  }

  test("unmatched hostname → null", () => {
    assert.equal(inferVendorFromLink("https://random-supplier.example/x"), null);
  });
  test("null / empty → null", () => {
    assert.equal(inferVendorFromLink(null), null);
    assert.equal(inferVendorFromLink(""), null);
    assert.equal(inferVendorFromLink(undefined), null);
  });
  test("table size in the 15-30 range (catches accidental shrink)", () => {
    assert.ok(
      VENDOR_HOSTNAME_MAP.length >= 15 && VENDOR_HOSTNAME_MAP.length <= 40,
      `VENDOR_HOSTNAME_MAP length ${VENDOR_HOSTNAME_MAP.length} outside [15, 40]`,
    );
  });
});

describe("inferCategoryFromName — representative items hit expected category", () => {
  const samples = [
    { name: "DNA polymerase kit", expected: "Reagents" },
    { name: "Phusion polymerase", expected: "Reagents" },
    { name: "1.5 mL Eppendorf tubes", expected: "Plasticware" },
    { name: "96-well plate, black-walled", expected: "Plasticware" },
    { name: "Nitrile gloves, M", expected: "Consumables" },
    { name: "Parafilm M, 4-inch roll", expected: "Consumables" },
    { name: "Whole-genome sequencing service", expected: "Service" },
    { name: "Sanger sequencing 96 reactions", expected: "Service" },
    { name: "Refrigerated centrifuge", expected: "Equipment" },
    { name: "Benchtop incubator-shaker", expected: "Equipment" },
    { name: "DemoStrain ΔADE2 (fake yeast collection)", expected: "Strains / Cells" },
    { name: "pYES-GAL1 plasmid", expected: "Strains / Cells" },
    { name: "YPD broth, 500 g", expected: "Media" },
    { name: "LC-MS grade acetonitrile", expected: "Solvents" },
    { name: "Sodium chloride, 1 kg", expected: "Chemicals" },
    { name: "Pyrex 250 mL Erlenmeyer flask", expected: "Glassware" },
    { name: "Microscope coverslips, 22 mm", expected: "Glassware" },
  ];
  for (const { name, expected } of samples) {
    test(`"${name}" → ${expected}`, () => {
      assert.equal(inferCategoryFromName(name), expected);
    });
  }

  test("unmatched name → null", () => {
    assert.equal(inferCategoryFromName("widget"), null);
  });
  test("null / empty → null", () => {
    assert.equal(inferCategoryFromName(null), null);
    assert.equal(inferCategoryFromName(""), null);
    assert.equal(inferCategoryFromName(undefined), null);
    assert.equal(inferCategoryFromName("   "), null);
  });
  test("table size in the 8-20 range", () => {
    assert.ok(
      CATEGORY_PATTERN_MAP.length >= 8 && CATEGORY_PATTERN_MAP.length <= 20,
      `CATEGORY_PATTERN_MAP length ${CATEGORY_PATTERN_MAP.length} outside [8, 20]`,
    );
  });
});

// ── planChanges tests ───────────────────────────────────────────────────────

describe("planChanges", () => {
  test("fills nulls when force=false", () => {
    const item = {
      id: 1,
      vendor: null,
      category: null,
      link: "https://neb.com/x",
      item_name: "Phusion polymerase",
    };
    assert.deepEqual(planChanges(item, { force: false }), {
      vendor: "NEB",
      category: "Reagents",
    });
  });

  test("skips when vendor + category already set, no --force", () => {
    const item = {
      id: 1,
      vendor: "Custom",
      category: "Other",
      link: "https://neb.com/x",
      item_name: "Phusion polymerase",
    };
    assert.deepEqual(planChanges(item, { force: false }), {
      vendor: undefined,
      category: undefined,
    });
  });

  test("--force overwrites existing values", () => {
    const item = {
      id: 1,
      vendor: "Wrong",
      category: "Wrong",
      link: "https://neb.com/x",
      item_name: "Phusion polymerase",
    };
    assert.deepEqual(planChanges(item, { force: true }), {
      vendor: "NEB",
      category: "Reagents",
    });
  });

  test("--force is a no-op if inferred value equals existing", () => {
    const item = {
      id: 1,
      vendor: "NEB",
      category: "Reagents",
      link: "https://neb.com/x",
      item_name: "Phusion polymerase",
    };
    assert.deepEqual(planChanges(item, { force: true }), {
      vendor: undefined,
      category: undefined,
    });
  });

  test("leaves vendor null when no link", () => {
    const item = {
      id: 1,
      vendor: null,
      category: null,
      link: null,
      item_name: "Phusion polymerase",
    };
    assert.deepEqual(planChanges(item, { force: false }), {
      vendor: undefined,
      category: "Reagents",
    });
  });
});

// ── End-to-end driver tests (temp dir) ──────────────────────────────────────

async function makeFixtureDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-test-"));
  // Two users, each with a couple of purchase items, plus stuff that
  // should be ignored (metadata file, lab/ dir without purchase_items).
  await fs.mkdir(path.join(dir, "users", "alex", "purchase_items"), { recursive: true });
  await fs.mkdir(path.join(dir, "users", "morgan", "purchase_items"), { recursive: true });
  await fs.mkdir(path.join(dir, "users", "lab"), { recursive: true }); // no purchase_items
  await fs.writeFile(path.join(dir, "users", "_user_metadata.json"), "{}\n");

  const write = (rel, body) =>
    fs.writeFile(path.join(dir, rel), JSON.stringify(body, null, 2) + "\n");

  await write("users/alex/purchase_items/1.json", {
    id: 1,
    task_id: 7,
    item_name: "Phusion polymerase (demo)",
    quantity: 1,
    link: "https://neb.com/products/foo",
    cas: null,
    price_per_unit: 285,
    shipping_fees: 0,
    total_price: 285,
    notes: null,
    funding_string: null,
  });
  await write("users/alex/purchase_items/2.json", {
    id: 2,
    task_id: 7,
    item_name: "1.5 mL microcentrifuge tubes",
    quantity: 5,
    link: "https://www.eppendorf.com/x",
    cas: null,
    price_per_unit: 10,
    shipping_fees: 0,
    total_price: 50,
    notes: null,
    funding_string: null,
  });
  await write("users/alex/purchase_items/3.json", {
    id: 3,
    task_id: 7,
    item_name: "Unrecognized weird thing",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 1,
    shipping_fees: 0,
    total_price: 1,
    notes: null,
    funding_string: null,
    vendor: "Pre-existing vendor",
    category: "Pre-existing category",
  });
  await write("users/morgan/purchase_items/1.json", {
    id: 1,
    task_id: 1,
    item_name: "96-well black-walled plates",
    quantity: 2,
    link: "https://addgene.org/x", // mismatched but valid for vendor purposes
    cas: null,
    price_per_unit: 48,
    shipping_fees: 8,
    total_price: 104,
    notes: null,
    funding_string: null,
  });
  return dir;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function rmDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Capture stdout/stderr during run() so the test output stays clean.
async function captureRun(opts) {
  const out = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    out.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    const code = await run(opts);
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

describe("driver — dry-run default never writes", () => {
  test("dry run leaves files byte-identical", async () => {
    const dir = await makeFixtureDir();
    try {
      const before = await readJson(path.join(dir, "users/alex/purchase_items/1.json"));
      const result = await captureRun({
        dataDir: dir,
        dryRun: true,
        apply: false,
        force: false,
        verboseSample: false,
        verboseSampleN: 3,
      });
      assert.equal(result.code, 0);
      const after = await readJson(path.join(dir, "users/alex/purchase_items/1.json"));
      assert.deepEqual(after, before);
      assert.match(result.stdout, /Mode: DRY RUN/);
      assert.match(result.stdout, /Scanned 4 purchase items/);
    } finally {
      await rmDir(dir);
    }
  });

  test("dry-run output redacts item names and link URLs", async () => {
    const dir = await makeFixtureDir();
    try {
      const result = await captureRun({
        dataDir: dir,
        dryRun: true,
        apply: false,
        force: false,
        verboseSample: false,
        verboseSampleN: 3,
      });
      assert.ok(!result.stdout.includes("Phusion polymerase"),
        "stdout must not contain item names");
      assert.ok(!result.stdout.includes("neb.com"),
        "stdout must not contain raw hostnames");
      assert.ok(!result.stdout.includes("eppendorf.com"),
        "stdout must not contain raw hostnames");
    } finally {
      await rmDir(dir);
    }
  });
});

describe("driver — --apply writes", () => {
  test("apply fills vendor + category on items 1 and 2, leaves 3 alone", async () => {
    const dir = await makeFixtureDir();
    try {
      const result = await captureRun({
        dataDir: dir,
        dryRun: false,
        apply: true,
        force: false,
        verboseSample: false,
        verboseSampleN: 3,
      });
      assert.equal(result.code, 0);
      const a1 = await readJson(path.join(dir, "users/alex/purchase_items/1.json"));
      assert.equal(a1.vendor, "NEB");
      assert.equal(a1.category, "Reagents");
      const a2 = await readJson(path.join(dir, "users/alex/purchase_items/2.json"));
      assert.equal(a2.vendor, "Eppendorf");
      assert.equal(a2.category, "Plasticware");
      const a3 = await readJson(path.join(dir, "users/alex/purchase_items/3.json"));
      assert.equal(a3.vendor, "Pre-existing vendor");
      assert.equal(a3.category, "Pre-existing category");
      const m1 = await readJson(path.join(dir, "users/morgan/purchase_items/1.json"));
      assert.equal(m1.vendor, "Addgene");
      assert.equal(m1.category, "Plasticware");
    } finally {
      await rmDir(dir);
    }
  });

  test("idempotency: second run with --apply changes nothing", async () => {
    const dir = await makeFixtureDir();
    try {
      await captureRun({
        dataDir: dir, dryRun: false, apply: true, force: false,
        verboseSample: false, verboseSampleN: 3,
      });
      const snap1 = await readJson(path.join(dir, "users/alex/purchase_items/1.json"));
      const second = await captureRun({
        dataDir: dir, dryRun: false, apply: true, force: false,
        verboseSample: false, verboseSampleN: 3,
      });
      assert.equal(second.code, 0);
      const snap2 = await readJson(path.join(dir, "users/alex/purchase_items/1.json"));
      assert.deepEqual(snap2, snap1);
      assert.match(second.stdout, /Updated: 0 items \(vendor\), 0 items \(category\)/);
    } finally {
      await rmDir(dir);
    }
  });

  test("--force overwrites existing vendor + category", async () => {
    const dir = await makeFixtureDir();
    try {
      // Pre-populate alex/3 with a wrong vendor + a recognizable item name
      // and link so --force should retag.
      await fs.writeFile(
        path.join(dir, "users/alex/purchase_items/3.json"),
        JSON.stringify({
          id: 3,
          task_id: 7,
          item_name: "Phusion polymerase (demo)",
          quantity: 1,
          link: "https://neb.com/foo",
          cas: null,
          price_per_unit: 1,
          shipping_fees: 0,
          total_price: 1,
          notes: null,
          funding_string: null,
          vendor: "WRONG VENDOR",
          category: "WRONG CATEGORY",
        }, null, 2) + "\n",
      );
      const result = await captureRun({
        dataDir: dir, dryRun: false, apply: true, force: true,
        verboseSample: false, verboseSampleN: 3,
      });
      assert.equal(result.code, 0);
      const a3 = await readJson(path.join(dir, "users/alex/purchase_items/3.json"));
      assert.equal(a3.vendor, "NEB");
      assert.equal(a3.category, "Reagents");
    } finally {
      await rmDir(dir);
    }
  });

  test("--verbose-sample prints redacted samples only (no item names)", async () => {
    const dir = await makeFixtureDir();
    try {
      const result = await captureRun({
        dataDir: dir, dryRun: true, apply: false, force: false,
        verboseSample: true, verboseSampleN: 5,
      });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Sample changes/);
      assert.match(result.stdout, /item_\d+:/);
      // Item names must never appear, even in verbose mode.
      assert.ok(!result.stdout.includes("Phusion polymerase"));
      assert.ok(!result.stdout.includes("microcentrifuge tubes"));
    } finally {
      await rmDir(dir);
    }
  });
});

describe("driver — error handling", () => {
  test("missing --data-dir returns exit code 1 and prints usage", async () => {
    const result = await captureRun({
      dataDir: null, dryRun: true, apply: false, force: false,
      verboseSample: false, verboseSampleN: 3,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--data-dir is required/);
  });

  test("data-dir with no users/ subdir is a clean error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-empty-"));
    try {
      const result = await captureRun({
        dataDir: dir, dryRun: true, apply: false, force: false,
        verboseSample: false, verboseSampleN: 3,
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no users\/ subdirectory/);
    } finally {
      await rmDir(dir);
    }
  });

  test("malformed JSON counts a parse error and continues", async () => {
    const dir = await makeFixtureDir();
    try {
      await fs.writeFile(
        path.join(dir, "users/alex/purchase_items/99.json"),
        "{ this is not json",
      );
      const result = await captureRun({
        dataDir: dir, dryRun: true, apply: false, force: false,
        verboseSample: false, verboseSampleN: 3,
      });
      assert.equal(result.code, 1);
      assert.match(result.stdout, /Parse errors: 1/);
      // Importantly, OTHER files still get processed.
      assert.match(result.stdout, /Scanned 5 purchase items/);
    } finally {
      await rmDir(dir);
    }
  });
});
