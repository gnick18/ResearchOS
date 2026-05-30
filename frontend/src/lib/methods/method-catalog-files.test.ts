// frontend/src/lib/methods/method-catalog-files.test.ts
//
// On-disk validation for the shipped method-template catalog under
// `frontend/public/method-catalog/`. Unlike method-catalog.test.ts (which
// exercises the loader against in-memory fixtures), this suite loads the REAL
// manifest + every real template payload from disk and runs them through the
// production parser, then deep-checks the per-type payload shape that the
// light parser intentionally trusts. It catches an author typo (a missing
// field, a wrong method_type, a manifest/file mismatch, a malformed pcr
// gradient) before the catalog ever reaches the browse surface.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// method-catalog.ts imports @/lib/local-api at module scope; mock it so this
// pure data-validation suite doesn't pull in the real local API stack.
import { vi } from "vitest";
vi.mock("@/lib/local-api", () => ({
  methodsApi: { create: vi.fn() },
  pcrApi: { create: vi.fn() },
  lcGradientApi: { create: vi.fn() },
  plateApi: { create: vi.fn() },
  cellCultureApi: { create: vi.fn() },
  massSpecApi: { create: vi.fn() },
  filesApi: { writeFile: vi.fn() },
}));
vi.mock("@/lib/stamp-utils", () => ({
  createNewFileContent: vi.fn(() => "## stamp\n"),
}));

import {
  parseMethodCatalogManifest,
  parseMethodCatalogTemplate,
  type MethodCatalogTemplate,
} from "./method-catalog";

const CATALOG_DIR = fileURLToPath(
  new URL("../../../public/method-catalog", import.meta.url),
);
const TEMPLATES_DIR = `${CATALOG_DIR}/templates`;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = parseMethodCatalogManifest(
  readJson(`${CATALOG_DIR}/manifest.json`),
);

const templateFiles = readdirSync(TEMPLATES_DIR).filter((f) =>
  f.endsWith(".json"),
);

describe("method-catalog on-disk manifest", () => {
  it("parses the shipped manifest", () => {
    expect(manifest.templates.length).toBeGreaterThan(0);
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

describe("method-catalog on-disk template payloads", () => {
  for (const file of templateFiles) {
    const slug = file.replace(/\.json$/, "");

    it(`${slug}: parses and its slug matches the filename + manifest`, () => {
      const raw = readJson(`${TEMPLATES_DIR}/${file}`);
      const template = parseMethodCatalogTemplate(raw);
      expect(template.slug).toBe(slug);
      const manifestEntry = manifest.templates.find((t) => t.slug === slug);
      expect(manifestEntry).toBeDefined();
      // Manifest browse metadata must match the payload file's own metadata.
      expect(manifestEntry?.method_type).toBe(template.method_type);
      expect(manifestEntry?.title).toBe(template.title);
      expect(manifestEntry?.category).toBe(template.category);
    });
  }
});

// ── Deep shape checks for the pcr payloads ───────────────────────────────────
//
// The production parser is a light presence guard, so assert the structured
// pcr gradient + ingredient shape here for every pcr template (the new vendor
// enzyme protocols all live in this branch).

function assertStep(step: unknown) {
  expect(step && typeof step === "object").toBe(true);
  const s = step as Record<string, unknown>;
  expect(typeof s.name).toBe("string");
  expect(typeof s.temperature).toBe("number");
  expect(Number.isFinite(s.temperature)).toBe(true);
  expect(typeof s.duration).toBe("string");
  expect((s.duration as string).length).toBeGreaterThan(0);
}

describe("method-catalog pcr payload shape", () => {
  const pcrTemplates: MethodCatalogTemplate[] = templateFiles
    .map((f) => parseMethodCatalogTemplate(readJson(`${TEMPLATES_DIR}/${f}`)))
    .filter((t) => t.method_type === "pcr");

  it("there are pcr templates to validate", () => {
    expect(pcrTemplates.length).toBeGreaterThan(0);
  });

  for (const template of pcrTemplates) {
    it(`${template.slug}: has a well-formed pcr gradient + ingredients`, () => {
      if (template.method_type !== "pcr") return;
      const { gradient, ingredients } = template.payload;

      expect(Array.isArray(gradient.initial)).toBe(true);
      expect(Array.isArray(gradient.cycles)).toBe(true);
      expect(Array.isArray(gradient.final)).toBe(true);

      gradient.initial.forEach(assertStep);
      gradient.final.forEach(assertStep);

      // At least one cycle block, each with a positive repeat count and steps.
      expect(gradient.cycles.length).toBeGreaterThan(0);
      for (const cycle of gradient.cycles) {
        expect(typeof cycle.repeats).toBe("number");
        expect(cycle.repeats).toBeGreaterThan(0);
        expect(Array.isArray(cycle.steps)).toBe(true);
        expect(cycle.steps.length).toBeGreaterThan(0);
        cycle.steps.forEach(assertStep);
      }

      // hold is either null or a single well-formed step.
      if (gradient.hold !== null) {
        assertStep(gradient.hold);
      }

      // Ingredients: non-empty, every field a string.
      expect(Array.isArray(ingredients)).toBe(true);
      expect(ingredients.length).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const ing of ingredients) {
        expect(typeof ing.id).toBe("string");
        expect(typeof ing.name).toBe("string");
        expect(ing.name.length).toBeGreaterThan(0);
        expect(typeof ing.concentration).toBe("string");
        expect(typeof ing.amount_per_reaction).toBe("string");
        ids.add(ing.id);
      }
      // Ingredient ids are unique within a template.
      expect(ids.size).toBe(ingredients.length);

      // notes, when present, is a string.
      if (template.payload.notes != null) {
        expect(typeof template.payload.notes).toBe("string");
      }
    });
  }
});
