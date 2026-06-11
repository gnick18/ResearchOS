// frontend/src/lib/calculators/template-catalog-files.test.ts
//
// On-disk validation for the shipped calculator-template catalog under
// `frontend/public/calculator-templates/`. Mirrors method-catalog-files.test.ts:
// it loads the REAL manifest + every real template file, runs them through the
// production parser, checks manifest/file consistency, and evaluates each
// template on its default inputs to confirm it produces at least one finite
// output without throwing. It catches an author typo (a missing field, a wrong
// type, a manifest/file mismatch, a broken formula) before the catalog ever
// reaches the gallery.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  parseCalculatorTemplateManifest,
  parseCalculatorTemplate,
  type CalculatorTemplate,
} from "./template-catalog";
import { evaluateCustomCalculator } from "./custom";
import type { CustomCalculator } from "@/lib/types";

const CATALOG_DIR = fileURLToPath(
  new URL("../../../public/calculator-templates", import.meta.url),
);
const TEMPLATES_DIR = `${CATALOG_DIR}/templates`;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = parseCalculatorTemplateManifest(
  readJson(`${CATALOG_DIR}/manifest.json`),
);

const templateFiles = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json"));

/** Build the default-input map from a template's declared defaults. A dropdown
 *  falls back to its first option's value. */
function defaultValues(t: CalculatorTemplate): Record<string, number | number[] | string> {
  const values: Record<string, number | number[] | string> = {};
  for (const input of t.inputs) {
    if (input.type === "dropdown") {
      values[input.key] =
        input.default !== undefined && !Array.isArray(input.default)
          ? input.default
          : input.options![0].value;
    } else if (input.default !== undefined) {
      values[input.key] = input.default;
    }
  }
  return values;
}

function asCalc(t: CalculatorTemplate): CustomCalculator {
  return {
    id: 1,
    name: t.name,
    description: t.description,
    field: t.field,
    inputs: t.inputs,
    steps: t.steps,
    conditionals: t.conditionals,
    outputs: t.outputs,
    shared_with: [],
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
  };
}

describe("calculator-template on-disk manifest", () => {
  it("parses the shipped manifest with all 11 seed templates", () => {
    expect(manifest.templates.length).toBe(11);
  });

  it("every manifest slug has a matching template file", () => {
    const fileSlugs = new Set(templateFiles.map((f) => f.replace(/\.json$/, "")));
    for (const entry of manifest.templates) {
      expect(fileSlugs.has(entry.slug)).toBe(true);
    }
  });

  it("every template file is listed in the manifest", () => {
    const manifestSlugs = new Set(manifest.templates.map((t) => t.slug));
    for (const file of templateFiles) {
      expect(manifestSlugs.has(file.replace(/\.json$/, ""))).toBe(true);
    }
  });

  it("manifest slugs are unique", () => {
    const slugs = manifest.templates.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("calculator-template on-disk payloads", () => {
  for (const file of templateFiles) {
    const slug = file.replace(/\.json$/, "");

    it(`${slug}: parses and its slug + browse metadata match the manifest`, () => {
      const template = parseCalculatorTemplate(readJson(`${TEMPLATES_DIR}/${file}`));
      expect(template.slug).toBe(slug);
      const manifestEntry = manifest.templates.find((t) => t.slug === slug);
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry?.name).toBe(template.name);
      expect(manifestEntry?.field).toBe(template.field);
      expect(manifestEntry?.description).toBe(template.description);
    });

    it(`${slug}: input keys are unique and every output expression is non-empty`, () => {
      const template = parseCalculatorTemplate(readJson(`${TEMPLATES_DIR}/${file}`));
      const keys = template.inputs.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(template.outputs.length).toBeGreaterThan(0);
      for (const o of template.outputs) {
        expect(o.expr.trim().length).toBeGreaterThan(0);
        expect(o.label.trim().length).toBeGreaterThan(0);
      }
    });

    it(`${slug}: evaluates on its defaults with at least one finite output`, () => {
      const template = parseCalculatorTemplate(readJson(`${TEMPLATES_DIR}/${file}`));
      const result = evaluateCustomCalculator(asCalc(template), defaultValues(template));
      expect(result.outputs.length).toBe(template.outputs.length);
      const finiteCount = result.outputs.filter((o) => Number.isFinite(o.value)).length;
      expect(finiteCount).toBeGreaterThan(0);
    });
  }
});
