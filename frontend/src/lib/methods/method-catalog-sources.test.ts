// frontend/src/lib/methods/method-catalog-sources.test.ts
//
// Kit Phase 1 coverage for BUNDLED source PDFs. A "kit" template attaches a
// vendor pack-insert PDF that ships in-build under
// `frontend/public/method-catalog/sources/<slug>.pdf` and is copied alongside
// the structured method on instantiation (the structured method-catalog
// instantiation path is covered by method-catalog.test.ts).
//
// This suite is the on-disk integrity guard: for EVERY manifest entry whose
// `source_pdf.bundled === true`, the matching `sources/<slug>.pdf` must exist,
// and when a `sha256` is declared it must match the file on disk. It also prints
// a provenance LEDGER classifying every template:
//   DONE       — bundled === true AND the file is present (and sha matches)
//   LINK-ONLY  — a source_url but no bundle (reference only, no shipped asset)
//   PENDING    — no source_pdf at all (the default for templates without a kit)
//
// FastStart (roche-faststart-taq) is the one DONE entry this phase; every other
// template is PENDING and that is expected.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// method-catalog.ts imports @/lib/local-api at module scope; mock it so this
// pure data-validation suite does not pull in the real local API stack.
vi.mock("@/lib/local-api", () => ({
  methodsApi: { create: vi.fn() },
  pcrApi: { create: vi.fn() },
  lcGradientApi: { create: vi.fn() },
  plateApi: { create: vi.fn() },
  cellCultureApi: { create: vi.fn() },
  massSpecApi: { create: vi.fn() },
  filesApi: { writeFile: vi.fn(), uploadImage: vi.fn() },
}));
vi.mock("@/lib/stamp-utils", () => ({
  createNewFileContent: vi.fn(() => "## stamp\n"),
}));

import {
  parseMethodCatalogManifest,
  type MethodCatalogManifestEntry,
} from "./method-catalog";

const CATALOG_DIR = fileURLToPath(
  new URL("../../../public/method-catalog", import.meta.url),
);
const SOURCES_DIR = `${CATALOG_DIR}/sources`;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const manifest = parseMethodCatalogManifest(
  readJson(`${CATALOG_DIR}/manifest.json`),
);

const bundled = manifest.templates.filter(
  (t) => t.source_pdf?.bundled === true,
);

describe("method-catalog bundled source PDFs (kit Phase 1)", () => {
  it("the manifest parses and at least one kit is bundled", () => {
    expect(manifest.templates.length).toBeGreaterThan(0);
    expect(bundled.length).toBeGreaterThan(0);
  });

  for (const entry of bundled) {
    it(`${entry.slug}: bundled PDF exists on disk at sources/<slug>.pdf`, () => {
      const pdfPath = `${SOURCES_DIR}/${entry.slug}.pdf`;
      expect(existsSync(pdfPath)).toBe(true);
      // A real PDF, not an empty / zero-byte placeholder.
      expect(statSync(pdfPath).size).toBeGreaterThan(0);
    });

    const declaredSha = entry.source_pdf?.sha256;
    if (declaredSha) {
      it(`${entry.slug}: bundled PDF sha256 matches the declared digest`, () => {
        const pdfPath = `${SOURCES_DIR}/${entry.slug}.pdf`;
        expect(sha256OfFile(pdfPath)).toBe(declaredSha);
      });
    }

    it(`${entry.slug}: declares a non-empty vendor filename`, () => {
      expect(typeof entry.source_pdf?.filename).toBe("string");
      expect((entry.source_pdf?.filename ?? "").length).toBeGreaterThan(0);
    });
  }

  it("FastStart is bundled (the one piloted kit this phase)", () => {
    const faststart = bundled.find((t) => t.slug === "roche-faststart-taq");
    expect(faststart).toBeDefined();
    expect(faststart?.source_pdf?.bundled).toBe(true);
  });
});

// ── Provenance ledger (informational) ─────────────────────────────────────────
//
// Not an assertion gate beyond the bundled-file checks above: this classifies
// every template so a reviewer can see, at a glance, which kits are DONE vs.
// still PENDING a source PDF. Printed once per run.

type LedgerStatus = "DONE" | "LINK-ONLY" | "PENDING";

function classify(entry: MethodCatalogManifestEntry): LedgerStatus {
  const sp = entry.source_pdf;
  if (sp?.bundled) {
    const pdfPath = `${SOURCES_DIR}/${entry.slug}.pdf`;
    return existsSync(pdfPath) ? "DONE" : "PENDING";
  }
  if (sp?.source_url) return "LINK-ONLY";
  return "PENDING";
}

describe("method-catalog source-PDF ledger", () => {
  it("prints the DONE / LINK-ONLY / PENDING ledger", () => {
    const ledger = manifest.templates.map((t) => ({
      slug: t.slug,
      status: classify(t),
    }));
    const counts: Record<LedgerStatus, number> = {
      DONE: 0,
      "LINK-ONLY": 0,
      PENDING: 0,
    };
    for (const row of ledger) counts[row.status] += 1;

    const done = ledger.filter((r) => r.status === "DONE").map((r) => r.slug);
    const linkOnly = ledger
      .filter((r) => r.status === "LINK-ONLY")
      .map((r) => r.slug);

    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "── method-catalog source-PDF ledger ──",
        `  total templates: ${ledger.length}`,
        `  DONE       (bundled + file present): ${counts.DONE}` +
          (done.length ? `  [${done.join(", ")}]` : ""),
        `  LINK-ONLY  (source_url, no bundle):  ${counts["LINK-ONLY"]}` +
          (linkOnly.length ? `  [${linkOnly.join(", ")}]` : ""),
        `  PENDING    (no source_pdf):          ${counts.PENDING}`,
        "──────────────────────────────────────",
        "",
      ].join("\n"),
    );

    // FastStart is the single DONE kit this phase; everything else is PENDING
    // (no kit yet) or LINK-ONLY (a future link-only reference). No LINK-ONLY
    // entries exist yet, so PENDING + DONE accounts for the whole catalog.
    expect(counts.DONE).toBe(1);
    expect(done).toContain("roche-faststart-taq");
    expect(counts.DONE + counts["LINK-ONLY"] + counts.PENDING).toBe(
      ledger.length,
    );
  });
});
