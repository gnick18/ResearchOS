// frontend/src/lib/onboarding/use-case-tab-mapping.test.ts
//
// Unit tests for the locked use-case → visible-tab mapping that backs
// the Onboarding v2 wizard's Continue button. The wizard mount + the
// settings.json write land in Phases 1-2; these tests pin the pure
// mapping contract so future tweaks (adding a use case, retabling)
// can't silently regress the locked table.

import { describe, expect, it } from "vitest";

import { ALL_TAB_HREFS, NAV_ITEMS } from "@/lib/nav";
import {
  USE_CASES,
  USE_CASE_IDS,
  USE_CASE_TAB_MAP,
  tabsForUseCases,
  seedVisibleTabsForStep3,
} from "./use-case-tab-mapping";

describe("USE_CASES catalog", () => {
  it("exposes 9 use cases", () => {
    expect(USE_CASES).toHaveLength(9);
    expect(USE_CASE_IDS).toHaveLength(9);
  });

  it("USE_CASES ids match USE_CASE_IDS exactly and in order", () => {
    expect(USE_CASES.map((u) => u.id)).toEqual([...USE_CASE_IDS]);
  });

  it("every non-just_exploring id has a tab list", () => {
    for (const id of USE_CASE_IDS) {
      if (id === "just_exploring") continue;
      expect(USE_CASE_TAB_MAP[id]).toBeDefined();
      expect(USE_CASE_TAB_MAP[id].length).toBeGreaterThan(0);
      // Home is always in the table value.
      expect(USE_CASE_TAB_MAP[id]).toContain("/");
    }
  });
});

describe("tabsForUseCases()", () => {
  it("returns all 8 tabs for an empty selection", () => {
    expect(tabsForUseCases([])).toEqual([...ALL_TAB_HREFS]);
  });

  it("returns all 8 tabs for just_exploring", () => {
    expect(tabsForUseCases(["just_exploring"])).toEqual([...ALL_TAB_HREFS]);
  });

  it("computational picks exactly home + workbench + methods + search", () => {
    expect(tabsForUseCases(["computational"])).toEqual([
      "/",
      "/workbench",
      "/methods",
      "/search",
    ]);
  });

  it("undergrad_researcher picks exactly home + workbench + calendar + search", () => {
    expect(tabsForUseCases(["undergrad_researcher"])).toEqual([
      "/",
      "/workbench",
      "/calendar",
      "/search",
    ]);
  });

  it("union of computational + phd_experiments includes gantt/calendar/purchases but not /links", () => {
    const result = tabsForUseCases(["computational", "phd_experiments"]);
    // Expected union in NAV_ITEMS order: /, /workbench, /gantt, /methods,
    // /purchases, /calendar, /search. (No /links — neither picks it.)
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/purchases",
      "/calendar",
      "/search",
    ]);
    expect(result).not.toContain("/links");
  });

  it("lab_manager picks all 8 tabs", () => {
    expect(tabsForUseCases(["lab_manager"])).toEqual([...ALL_TAB_HREFS]);
  });

  it("phd_experiments picks exactly 7 tabs (all minus /links)", () => {
    const result = tabsForUseCases(["phd_experiments"]);
    expect(result).toHaveLength(7);
    expect(result).not.toContain("/links");
    expect(result).toEqual(
      NAV_ITEMS.map((i) => i.href).filter((h) => h !== "/links"),
    );
  });

  it("solo_researcher picks exactly 7 tabs (all minus /links)", () => {
    // Master refinement 2026-05-20: solo_researcher should NOT default-show
    // /links since solo means no team to share with. A solo researcher who
    // later grows a team re-enables Lab Links via Settings, or Phase 2's
    // multi-user-folder override surfaces it automatically.
    const result = tabsForUseCases(["solo_researcher"]);
    expect(result).toHaveLength(7);
    expect(result).not.toContain("/links");
    expect(result).toEqual(
      NAV_ITEMS.map((i) => i.href).filter((h) => h !== "/links"),
    );
  });

  it("ignores unknown ids and returns only Home", () => {
    expect(tabsForUseCases(["unknown_id"])).toEqual(["/"]);
  });

  it("just_exploring short-circuits the union even when combined", () => {
    expect(tabsForUseCases(["just_exploring", "computational"])).toEqual([
      ...ALL_TAB_HREFS,
    ]);
  });

  it("preserves NAV_ITEMS canonical order in the union", () => {
    // postdoc lists /links before /search internally; tabsForUseCases
    // must reorder to NAV_ITEMS order (which puts /search before
    // /links).
    const result = tabsForUseCases(["postdoc"]);
    const searchIdx = result.indexOf("/search");
    const linksIdx = result.indexOf("/links");
    expect(searchIdx).toBeGreaterThanOrEqual(0);
    expect(linksIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeLessThan(linksIdx);
  });
});

describe("seedVisibleTabsForStep3()", () => {
  // Phase 2a wraps tabsForUseCases with a folder-state-aware override:
  // when the data folder has >1 non-system user dir, /links defaults
  // on regardless of static mapping. Master-locked 2026-05-20 as a
  // Phase 0 refinement. Tests pin both the no-op cases (no multi-user
  // override) and the override path.

  it("no override when isMultiUserFolder=false (phd_experiments keeps 7-tab list, no /links)", () => {
    const result = seedVisibleTabsForStep3(["phd_experiments"], false);
    expect(result).toEqual(tabsForUseCases(["phd_experiments"]));
    expect(result).not.toContain("/links");
    expect(result).toHaveLength(7);
  });

  it("adds /links when isMultiUserFolder=true for a use case that doesn't include /links by default", () => {
    const result = seedVisibleTabsForStep3(["phd_experiments"], true);
    expect(result).toContain("/links");
    expect(result).toHaveLength(8);
    // Order must follow NAV_ITEMS canonical order.
    expect(result).toEqual(
      NAV_ITEMS.map((i) => i.href).filter((href) =>
        new Set([...tabsForUseCases(["phd_experiments"]), "/links"]).has(href),
      ),
    );
  });

  it("no-op when /links is already in the base list (lab_manager + multi-user)", () => {
    expect(seedVisibleTabsForStep3(["lab_manager"], true)).toEqual(
      tabsForUseCases(["lab_manager"]),
    );
  });

  it("empty selection in a multi-user folder still returns all 8 tabs (just_exploring short-circuit)", () => {
    // tabsForUseCases([]) returns ALL_TAB_HREFS, which already
    // includes /links — so the multi-user override is a no-op here.
    const result = seedVisibleTabsForStep3([], true);
    expect(result).toEqual([...ALL_TAB_HREFS]);
  });
});
