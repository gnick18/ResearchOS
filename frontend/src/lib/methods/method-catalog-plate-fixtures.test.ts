// frontend/src/lib/methods/method-catalog-plate-fixtures.test.ts
//
// Deep on-disk validation for the shipped `plate` method-template payloads
// under `frontend/public/method-catalog/`. The production parser
// (parseMethodCatalogTemplate) is a light presence guard, and the companion
// method-catalog-files.test.ts deep-checks only the pcr payloads, so this
// suite asserts the plate-specific invariants the plate editor + repair pass
// (src/lib/repair/plate-layouts.ts) enforce at runtime:
//   - plate_size is a supported size (12 | 24 | 48 | 96 | 384)
//   - every region role is a valid PlateWellRole
//   - every region's rows/cols are 0-indexed, ordered, and in-bounds for the
//     plate's row x col grid (so nothing gets silently clamped on load)
// It catches an author typo in a plate layout (an out-of-grid column, a
// row_end before row_start, a misspelled role) before the catalog reaches the
// browse surface.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// method-catalog.ts imports @/lib/local-api at module scope; mock it so this
// pure data-validation suite doesn't pull in the real local API stack.
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

import { parseMethodCatalogTemplate } from "./method-catalog";

const TEMPLATES_DIR = fileURLToPath(
  new URL("../../../public/method-catalog/templates", import.meta.url),
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Mirror src/lib/repair/plate-layouts.ts dimsForSize + VALID_SIZES / VALID_ROLES.
const DIMS_FOR_SIZE: Record<number, { rows: number; cols: number }> = {
  12: { rows: 3, cols: 4 },
  24: { rows: 4, cols: 6 },
  48: { rows: 6, cols: 8 },
  96: { rows: 8, cols: 12 },
  384: { rows: 16, cols: 24 },
};
const VALID_ROLES = new Set(["blank", "sample", "control", "na", "custom"]);

const plateTemplates = readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => parseMethodCatalogTemplate(readJson(`${TEMPLATES_DIR}/${f}`)))
  .filter((t) => t.method_type === "plate");

describe("method-catalog plate payload shape", () => {
  it("there are plate templates to validate", () => {
    expect(plateTemplates.length).toBeGreaterThan(0);
  });

  for (const template of plateTemplates) {
    it(`${template.slug}: plate_size + every region is in-bounds with a valid role`, () => {
      if (template.method_type !== "plate") return;
      const { plate_size, region_labels } = template.payload;

      const dims = DIMS_FOR_SIZE[plate_size];
      expect(dims, `unsupported plate_size ${plate_size}`).toBeDefined();
      expect(Array.isArray(region_labels)).toBe(true);
      expect(region_labels.length).toBeGreaterThan(0);

      const { rows, cols } = dims;
      for (const [i, region] of region_labels.entries()) {
        const where = `${template.slug} region ${i}`;
        expect(VALID_ROLES.has(region.role), `${where} role "${region.role}"`).toBe(true);

        for (const [name, value, max] of [
          ["row_start", region.row_start, rows],
          ["row_end", region.row_end, rows],
          ["col_start", region.col_start, cols],
          ["col_end", region.col_end, cols],
        ] as const) {
          expect(Number.isInteger(value), `${where} ${name} integer`).toBe(true);
          expect(value, `${where} ${name} >= 0`).toBeGreaterThanOrEqual(0);
          expect(value, `${where} ${name} < ${max}`).toBeLessThan(max);
        }

        expect(region.row_end, `${where} row_end >= row_start`).toBeGreaterThanOrEqual(
          region.row_start,
        );
        expect(region.col_end, `${where} col_end >= col_start`).toBeGreaterThanOrEqual(
          region.col_start,
        );
      }
    });
  }
});
