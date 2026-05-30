// frontend/src/lib/methods/method-module.test.ts
//
// Extension Store Phase U2 (extension-store U2 bot) coverage for the
// method-type MODULE metadata projection:
//   - every cosmetic-registry type projects to a module meta
//   - the accessor falls back to markdown for null / unknown ids
//   - the curation-relevant facts (hasStructuredProtocol, sourcePathScheme,
//     hasTemplates, hiddenFromPicker) are derived correctly
//   - listMethodModules drops hidden types by default, includes them on demand

import { describe, expect, it } from "vitest";
import {
  METHOD_MODULES,
  getMethodModule,
  listMethodModules,
} from "./method-module";
import { METHOD_TYPE_REGISTRY } from "./method-type-registry";

describe("METHOD_MODULES projection", () => {
  it("has one module per cosmetic registry entry", () => {
    const cosmeticIds = Object.keys(METHOD_TYPE_REGISTRY).sort();
    const moduleIds = Object.keys(METHOD_MODULES).sort();
    expect(moduleIds).toEqual(cosmeticIds);
  });

  it("carries the cosmetic meta verbatim", () => {
    expect(METHOD_MODULES.pcr.cosmetic).toBe(METHOD_TYPE_REGISTRY.pcr);
    expect(METHOD_MODULES.pcr.cosmetic.label).toBe("PCR");
  });
});

describe("getMethodModule()", () => {
  it("returns the requested module", () => {
    expect(getMethodModule("pcr").id).toBe("pcr");
  });
  it("falls back to markdown for null/undefined", () => {
    expect(getMethodModule(null).id).toBe("markdown");
    expect(getMethodModule(undefined).id).toBe("markdown");
  });
});

describe("derived curation facts", () => {
  it("flags structured types and their source_path scheme", () => {
    expect(getMethodModule("pcr").hasStructuredProtocol).toBe(true);
    expect(getMethodModule("pcr").sourcePathScheme).toBe("pcr://protocol/");
    expect(getMethodModule("lc_gradient").sourcePathScheme).toBe(
      "lc_gradient://protocol/",
    );
  });

  it("leaves code-only and composite types without a scheme", () => {
    expect(getMethodModule("markdown").hasStructuredProtocol).toBe(false);
    expect(getMethodModule("markdown").sourcePathScheme).toBe(null);
    expect(getMethodModule("pdf").sourcePathScheme).toBe(null);
    // compound composes other methods; it owns no leaf sidecar scheme.
    expect(getMethodModule("compound").sourcePathScheme).toBe(null);
  });

  it("reports which types the template catalog can instantiate", () => {
    // The pure-data create shapes (catalog method types).
    expect(getMethodModule("markdown").hasTemplates).toBe(true);
    expect(getMethodModule("pcr").hasTemplates).toBe(true);
    expect(getMethodModule("plate").hasTemplates).toBe(true);
    // lc_gradient + mass_spec back the LC-MS kit templates.
    expect(getMethodModule("lc_gradient").hasTemplates).toBe(true);
    expect(getMethodModule("mass_spec").hasTemplates).toBe(true);
    // pdf needs a binary asset, so it has no pure-data template.
    expect(getMethodModule("pdf").hasTemplates).toBe(false);
  });

  it("surfaces hiddenFromPicker (compound only today)", () => {
    expect(getMethodModule("compound").hiddenFromPicker).toBe(true);
    expect(getMethodModule("pcr").hiddenFromPicker).toBe(false);
  });
});

describe("listMethodModules()", () => {
  it("drops hidden types by default", () => {
    const ids = listMethodModules().map((m) => m.id);
    expect(ids).not.toContain("compound");
    expect(ids).toContain("pcr");
  });
  it("includes hidden types when asked", () => {
    const ids = listMethodModules({ includeHidden: true }).map((m) => m.id);
    expect(ids).toContain("compound");
  });
});
