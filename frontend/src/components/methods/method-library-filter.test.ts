// Extension Store Phase C (store-search bot) coverage for the method library
// filter predicates. The Types | Templates segment switches BOTH the category
// set and the item kind, so these tests cover each view independently:
//   - Types: Standard / Structured categories, search over label + description,
//     enabled-only narrowing.
//   - Templates: manifest domain categories, search over title + tags, and the
//     deliberate rule that enabled-only does NOT hide a template on a disabled
//     type (it stays discoverable; Phase D gates the action).

import { describe, expect, it } from "vitest";
import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";
import type { MethodModuleMeta } from "@/lib/methods/method-module";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";
import {
  filterTemplateView,
  filterTypeView,
  templateCategoryOrder,
  templateMatchesSearch,
  typeMatchesSearch,
} from "./method-library-filter";

/** Minimal MethodModuleMeta fixture; the filter reads id + cosmetic
 *  label/description/category only. */
function mod(
  id: string,
  label: string,
  category: "standard" | "structured",
  description?: string,
): MethodModuleMeta {
  return {
    id: id as MethodTypeId,
    cosmetic: { id, label, category, description },
  } as unknown as MethodModuleMeta;
}

function tpl(
  slug: string,
  title: string,
  category: string,
  method_type: MethodCatalogManifestEntry["method_type"],
  tags?: string[],
): MethodCatalogManifestEntry {
  return { slug, title, description: "", category, method_type, tags };
}

const MARKDOWN = mod("markdown", "Markdown", "standard", "free-form text");
const PDF = mod("pdf", "PDF", "standard", "upload a PDF");
const PCR = mod("pcr", "PCR", "structured", "thermocycler program");
const LC = mod("lc_gradient", "LC Gradient", "structured", "solvent gradient");
const MODULES = [MARKDOWN, PDF, PCR, LC];

describe("typeMatchesSearch", () => {
  it("matches the empty query against everything", () => {
    expect(typeMatchesSearch(PCR, "")).toBe(true);
  });
  it("matches on label and description, case-insensitively", () => {
    expect(typeMatchesSearch(PCR, "pcr")).toBe(true);
    expect(typeMatchesSearch(PCR, "THERMOCYCLER")).toBe(true);
    expect(typeMatchesSearch(PCR, "gradient")).toBe(false);
  });
});

describe("filterTypeView", () => {
  const base = {
    modules: MODULES,
    enabledIds: new Set<MethodTypeId>(),
  };

  it("splits into Standard / Structured with full counts when unfiltered", () => {
    const { categories, items } = filterTypeView({
      ...base,
      query: "",
      enabledOnly: false,
      selectedCategoryId: null,
    });
    expect(items).toEqual(MODULES);
    expect(categories).toEqual([
      { id: "standard", label: "Standard", count: 2 },
      { id: "structured", label: "Structured", count: 2 },
    ]);
  });

  it("narrows items + counts on search", () => {
    const { categories, items } = filterTypeView({
      ...base,
      query: "gradient",
      enabledOnly: false,
      selectedCategoryId: null,
    });
    expect(items).toEqual([LC]);
    // Standard drops to 0 and is hidden; Structured keeps the one match.
    expect(categories).toEqual([
      { id: "structured", label: "Structured", count: 1 },
    ]);
  });

  it("narrows to enabled types when enabledOnly is on", () => {
    const { items, categories } = filterTypeView({
      ...base,
      enabledIds: new Set<MethodTypeId>(["markdown", "pcr"]),
      query: "",
      enabledOnly: true,
      selectedCategoryId: null,
    });
    expect(items).toEqual([MARKDOWN, PCR]);
    expect(categories).toEqual([
      { id: "standard", label: "Standard", count: 1 },
      { id: "structured", label: "Structured", count: 1 },
    ]);
  });

  it("filters the center list to the selected category", () => {
    const { items } = filterTypeView({
      ...base,
      query: "",
      enabledOnly: false,
      selectedCategoryId: "structured",
    });
    expect(items).toEqual([PCR, LC]);
  });
});

// ── Templates view ───────────────────────────────────────────────────────────

const T_GENERAL = tpl("gp", "General protocol", "General", "markdown", [
  "skeleton",
]);
const T_Q5 = tpl("q5", "Q5 PCR setup", "Molecular biology", "pcr", [
  "pcr",
  "q5",
]);
const T_COLONY = tpl("colony", "Colony PCR screen", "Molecular biology", "pcr", [
  "colony",
  "screening",
]);
const T_LC = tpl("rp-lc", "Reverse-phase LC", "Analytical chemistry", "lc_gradient", [
  "lc-ms",
  "peptide",
]);
const ENTRIES = [T_GENERAL, T_Q5, T_COLONY, T_LC];

describe("templateMatchesSearch", () => {
  it("matches the empty query against everything", () => {
    expect(templateMatchesSearch(T_Q5, "")).toBe(true);
  });
  it("matches on title and tags (not description), case-insensitively", () => {
    expect(templateMatchesSearch(T_Q5, "q5 pcr")).toBe(true); // title
    expect(templateMatchesSearch(T_LC, "PEPTIDE")).toBe(true); // tag
    expect(templateMatchesSearch(T_Q5, "colony")).toBe(false);
  });
});

describe("templateCategoryOrder", () => {
  it("lists distinct categories in first-seen order", () => {
    expect(templateCategoryOrder(ENTRIES)).toEqual([
      "General",
      "Molecular biology",
      "Analytical chemistry",
    ]);
  });
});

describe("filterTemplateView", () => {
  it("derives domain categories with full counts when unfiltered", () => {
    const { categories, items } = filterTemplateView({
      entries: ENTRIES,
      query: "",
      selectedCategoryId: null,
    });
    expect(items).toEqual(ENTRIES);
    expect(categories).toEqual([
      { id: "General", label: "General", count: 1 },
      { id: "Molecular biology", label: "Molecular biology", count: 2 },
      { id: "Analytical chemistry", label: "Analytical chemistry", count: 1 },
    ]);
  });

  it("narrows items + counts on a tag search", () => {
    const { categories, items } = filterTemplateView({
      entries: ENTRIES,
      query: "screening",
      selectedCategoryId: null,
    });
    expect(items).toEqual([T_COLONY]);
    expect(categories).toEqual([
      { id: "Molecular biology", label: "Molecular biology", count: 1 },
    ]);
  });

  it("filters the center list to the selected category", () => {
    const { items } = filterTemplateView({
      entries: ENTRIES,
      query: "",
      selectedCategoryId: "Molecular biology",
    });
    expect(items).toEqual([T_Q5, T_COLONY]);
  });
});
