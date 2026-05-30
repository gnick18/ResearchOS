// frontend/src/lib/methods/method-catalog-lcms-files.test.ts
//
// Validates the SHIPPED method-catalog JSON on disk (public/method-catalog/):
//  - every manifest entry resolves to a template file that parses via the
//    loader and whose slug / method_type agree with the manifest entry;
//  - the LC-MS kit templates (lc_gradient + mass_spec pairs) carry the exact
//    payload shape the per-type create APIs expect, so "Use template" cannot
//    hit a malformed gradient table or mass-spec param block at runtime.
//
// Reads the real files (vitest cwd is frontend/, per vitest.config.mts) rather
// than fixtures, so an author typo in a payload file is caught here, not in the
// app.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseMethodCatalogManifest,
  parseMethodCatalogTemplate,
  isCatalogMethodType,
} from "./method-catalog";

const CATALOG_DIR = join(process.cwd(), "public", "method-catalog");

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(CATALOG_DIR, relPath), "utf8"));
}

const manifest = parseMethodCatalogManifest(readJson("manifest.json"));

describe("shipped method-catalog files", () => {
  it("every manifest entry resolves to a parseable template with matching slug + type", () => {
    for (const entry of manifest.templates) {
      expect(isCatalogMethodType(entry.method_type)).toBe(true);
      const tpl = parseMethodCatalogTemplate(
        readJson(`templates/${entry.slug}.json`),
      );
      expect(tpl.slug).toBe(entry.slug);
      expect(tpl.method_type).toBe(entry.method_type);
    }
  });

  it("every lc_gradient template has a well-formed gradient table, column, and ingredients", () => {
    const lcTemplates = manifest.templates.filter(
      (e) => e.method_type === "lc_gradient",
    );
    expect(lcTemplates.length).toBeGreaterThan(0);
    for (const entry of lcTemplates) {
      const tpl = parseMethodCatalogTemplate(
        readJson(`templates/${entry.slug}.json`),
      );
      if (tpl.method_type !== "lc_gradient") throw new Error("type narrowed");
      const { gradient_steps, column, ingredients } = tpl.payload;
      expect(Array.isArray(gradient_steps)).toBe(true);
      expect(gradient_steps.length).toBeGreaterThan(0);
      for (const step of gradient_steps) {
        expect(typeof step.time_min).toBe("number");
        expect(typeof step.percent_a).toBe("number");
        expect(typeof step.percent_b).toBe("number");
        expect(typeof step.flow_ml_min).toBe("number");
        // Binary gradient: A + B sum to 100.
        expect(step.percent_a + step.percent_b).toBeCloseTo(100, 5);
      }
      expect(typeof column).toBe("object");
      expect(Array.isArray(ingredients)).toBe(true);
    }
  });

  it("every mass_spec template has a valid ionization mode and source/scan/calibration blocks", () => {
    const VALID_MODES = new Set([
      "esi_pos",
      "esi_neg",
      "esi_switching",
      "apci_pos",
      "apci_neg",
      "ei",
      "maldi",
      "other",
    ]);
    const msTemplates = manifest.templates.filter(
      (e) => e.method_type === "mass_spec",
    );
    expect(msTemplates.length).toBeGreaterThan(0);
    for (const entry of msTemplates) {
      const tpl = parseMethodCatalogTemplate(
        readJson(`templates/${entry.slug}.json`),
      );
      if (tpl.method_type !== "mass_spec") throw new Error("type narrowed");
      const { ionization_mode, source, scan, calibration } = tpl.payload;
      expect(VALID_MODES.has(ionization_mode)).toBe(true);
      expect(typeof source).toBe("object");
      expect(typeof scan).toBe("object");
      expect(typeof calibration).toBe("object");
      expect(typeof scan.is_msms).toBe("boolean");
    }
  });

  it("ships the four Thermo LC-MS kit templates under the LC-MS category", () => {
    const expected = [
      "lcms-peptide-rp-lc-thermo",
      "lcms-peptide-ms-thermo-orbitrap",
      "lcms-intact-protein-rp-lc-thermo",
      "lcms-intact-protein-ms-thermo-exploris",
    ];
    for (const slug of expected) {
      const entry = manifest.templates.find((e) => e.slug === slug);
      expect(entry, `manifest is missing ${slug}`).toBeDefined();
      expect(entry?.category).toBe("LC-MS");
    }
  });
});
