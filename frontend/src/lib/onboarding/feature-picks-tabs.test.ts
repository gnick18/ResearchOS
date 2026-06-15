// Unit tests for the v3 feature-picks → visible-tab derivation helper.
// Mirrors the structure of use-case-tab-mapping.test.ts for the v2
// helper; pins the contract that Phase 1 setup answers map deterministic
// tab lists in canonical NAV_ITEMS order.

import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/lib/nav";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import {
  deriveVisibleTabs,
  tabsForFeaturePicks,
} from "./feature-picks-tabs";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "maybe",
    calendar: "maybe",
    goals: "maybe",
    ai_helper: "full",
    ...over,
  };
}

const NAV_ORDER = NAV_ITEMS.map((i) => i.href);

describe("tabsForFeaturePicks() — null pass-through", () => {
  it("returns null when picks is null (caller falls back to settings.json visibleTabs)", () => {
    expect(tabsForFeaturePicks(null)).toBeNull();
  });
});

describe("tabsForFeaturePicks() — solo paths", () => {
  it("solo with all 'no' on Q2-Q5 returns the minimal always-visible set", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "solo",
        purchases: "no",
        calendar: "no",
        goals: "no",
        ai_helper: "no",
      }),
    );
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/sequences",    ]);
  });

  it("solo with all 'maybe' returns the same minimal set as all 'no'", () => {
    const result = tabsForFeaturePicks(picks({ account_type: "solo" }));
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/sequences",    ]);
  });

  it("solo with all 'yes' on Q2-Q5 adds /purchases and /calendar, no /links", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "solo",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
      }),
    );
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/sequences",
      "/purchases",
      "/calendar",    ]);
    expect(result).not.toContain("/links");
  });

  it("solo with only purchases=yes adds /purchases only", () => {
    const result = tabsForFeaturePicks(
      picks({ account_type: "solo", purchases: "yes" }),
    );
    expect(result).toContain("/purchases");
    expect(result).not.toContain("/calendar");
    expect(result).not.toContain("/links");
  });

  it("solo with only calendar=yes adds /calendar only", () => {
    const result = tabsForFeaturePicks(
      picks({ account_type: "solo", calendar: "yes" }),
    );
    expect(result).toContain("/calendar");
    expect(result).not.toContain("/purchases");
    expect(result).not.toContain("/links");
  });
});

describe("tabsForFeaturePicks() — lab paths", () => {
  // Lab Links manager 2026-05-22: /links visibility is now gated on
  // picks.links === "yes" (Q7), not picks.account_type === "lab".
  // Both solo and lab users get an explicit opt-in.
  it("lab with all 'no' + links unset omits /links from the minimal set", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "lab",
        purchases: "no",
        calendar: "no",
        goals: "no",
      }),
    );
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/sequences",    ]);
    expect(result).not.toContain("/links");
  });

  it("lab with all 'no' + links='yes' adds /links to the minimal set", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "lab",
        purchases: "no",
        calendar: "no",
        goals: "no",
        links: "yes",
      }),
    );
    expect(result).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/sequences",      "/links",
    ]);
  });

  it("lab with all 'yes' + links='yes' returns every nav tab", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "lab",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
        links: "yes",
      }),
    );
    // The FLAG-gated module tabs (/inventory, /chemistry, /datahub, /phylo,
    // /figures) are resolved in AppShell by their own feature flags, NOT by the
    // feature-pick wizard, so tabsForFeaturePicks never emits them. /search moved
    // to the Cmd-K palette (nav audit 2026-06-07). All are excluded from the
    // feature-picks tab set.
    const FLAG_GATED = new Set([
      "/inventory",
      "/chemistry",
      "/datahub",
      "/phylo",
      "/figures",
    ]);
    expect(result).toEqual(NAV_ORDER.filter((href) => !FLAG_GATED.has(href)));
  });
});

describe("tabsForFeaturePicks() — toggle independence", () => {
  // Confirms each Q2/Q3 toggle independently adds exactly its tab without
  // cross-contamination. goals has no top-nav href today;
  // toggling it must not move other tabs in or out of the set.
  it("toggling goals=yes does not change the tab set (no /goals nav href today)", () => {
    const off = tabsForFeaturePicks(picks({ goals: "no" }));
    const on = tabsForFeaturePicks(picks({ goals: "yes" }));
    expect(on).toEqual(off);
  });

  it("toggling ai_helper across all values does not change the tab set", () => {
    const sizes: FeaturePicks["ai_helper"][] = [
      "full",
      "medium",
      "minimal",
      "no",
      "maybe",
    ];
    const baseline = tabsForFeaturePicks(picks({ ai_helper: "full" }));
    for (const v of sizes) {
      expect(tabsForFeaturePicks(picks({ ai_helper: v }))).toEqual(baseline);
    }
  });

  it("returns hrefs in canonical NAV_ITEMS order regardless of which flags toggle", () => {
    const result = tabsForFeaturePicks(
      picks({
        account_type: "lab",
        purchases: "yes",
        calendar: "yes",
      }),
    )!;
    // Filter NAV_ORDER to the same set and compare; expect identical order.
    const expectedSubsetInOrder = NAV_ORDER.filter((href) =>
      result.includes(href),
    );
    expect(result).toEqual(expectedSubsetInOrder);
  });
});

describe("tabsForFeaturePicks() — every Q2/Q3 binary combination", () => {
  const yesNo: FeaturePicks["purchases"][] = ["yes", "no", "maybe"];
  for (const p of yesNo) {
    for (const c of yesNo) {
      it(`purchases=${p} calendar=${c} produces a stable set with the expected toggles`, () => {
        const result = tabsForFeaturePicks(
          picks({ purchases: p, calendar: c }),
        )!;
        expect(result.includes("/purchases")).toBe(p === "yes");
        expect(result.includes("/calendar")).toBe(c === "yes");
        // Always-on tabs are always present.
        expect(result).toContain("/");
        expect(result).toContain("/workbench");
        expect(result).toContain("/gantt");
        expect(result).toContain("/methods");
        // Search moved off the top nav into the Cmd-K palette (nav audit 2026-06-07).
        expect(result).not.toContain("/search");
      });
    }
  }
});

describe("tabsForFeaturePicks() — picks.links controls /links (Lab Links manager 2026-05-22)", () => {
  // Previously this section asserted account_type=lab always shows
  // /links and account_type=solo never does. The Lab Links manager
  // chip moved the gate to picks.links (Q7) so BOTH solo and lab
  // users get an explicit opt-in. The displayed label differs by
  // account_type ("Links" vs "Lab Links") but the visibility rule
  // is identical.
  it("solo with links='yes' includes /links", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "solo", links: "yes" })),
    ).toContain("/links");
  });

  it("lab with links='yes' includes /links", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "lab", links: "yes" })),
    ).toContain("/links");
  });

  it("solo without links pick (unset) does NOT include /links", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "solo", purchases: "yes" })),
    ).not.toContain("/links");
  });

  it("lab without links pick (unset) does NOT include /links", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "lab" })),
    ).not.toContain("/links");
  });

  it("links='no' hides /links regardless of account type", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "solo", links: "no" })),
    ).not.toContain("/links");
    expect(
      tabsForFeaturePicks(picks({ account_type: "lab", links: "no" })),
    ).not.toContain("/links");
  });

  it("links='maybe' hides /links (treat unknown/maybe as no)", () => {
    expect(
      tabsForFeaturePicks(picks({ account_type: "solo", links: "maybe" })),
    ).not.toContain("/links");
    expect(
      tabsForFeaturePicks(picks({ account_type: "lab", links: "maybe" })),
    ).not.toContain("/links");
  });
});

// ---------------------------------------------------------------------------
// deriveVisibleTabs() — the AppShell-side composition of feature_picks
// (primary) with settings.json.visibleTabs (manual-override layer). This
// is the read path Onboarding v3 P2a follow-up A plumbed; the contract
// is "picks decide what's visible; settings can additionally hide, never
// unhide". See feature-picks-tabs.ts docblock + ONBOARDING_V3_PROPOSAL.md §10.
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS_VISIBLE_TABS: string[] = [
  "/",
  "/workbench",
  "/gantt",
  "/methods",
  "/purchases",
  "/calendar",
  "/links",
];

describe("deriveVisibleTabs() — existing-user invariant (L1/L22)", () => {
  it("returns settings.visibleTabs as-is when picks is null", () => {
    // The whole reason picks can be null is that any pre-v4 sidecar
    // migrates to feature_picks=null. AppShell MUST render the same
    // tab set those users saw pre-chip — otherwise we've broken the
    // existing-user invisibility invariant.
    const settings = ["/", "/workbench", "/gantt", "/methods"];
    expect(deriveVisibleTabs(null, settings)).toEqual(settings);
  });

  it("returns a fresh copy, not the same reference", () => {
    const settings = ["/", "/workbench"];
    const result = deriveVisibleTabs(null, settings);
    expect(result).not.toBe(settings);
    expect(result).toEqual(settings);
  });

  it("an empty settings.visibleTabs stays empty under picks=null", () => {
    expect(deriveVisibleTabs(null, [])).toEqual([]);
  });
});

describe("deriveVisibleTabs() — picks present, no manual override", () => {
  it("solo user with picks excluding /calendar and /purchases drops both even though defaults include them", () => {
    const p = picks({
      account_type: "solo",
      purchases: "no",
      calendar: "no",
    });
    const result = deriveVisibleTabs(p, DEFAULT_SETTINGS_VISIBLE_TABS);
    expect(result).not.toContain("/purchases");
    expect(result).not.toContain("/calendar");
    expect(result).not.toContain("/links");
    expect(result).toContain("/");
    expect(result).toContain("/workbench");
    expect(result).toContain("/gantt");
    expect(result).toContain("/methods");
    // Search moved off the top nav into the Cmd-K palette (nav audit 2026-06-07).
    expect(result).not.toContain("/search");
  });

  it("lab user with all-yes picks (including links=yes) keeps every default tab visible", () => {
    // Lab Links manager 2026-05-22: links visibility now requires
    // picks.links === "yes" for both solo and lab users.
    const p = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      links: "yes",
    });
    expect(deriveVisibleTabs(p, DEFAULT_SETTINGS_VISIBLE_TABS)).toEqual(
      DEFAULT_SETTINGS_VISIBLE_TABS,
    );
  });

  it("preserves the order from settings.visibleTabs (manual layer drives order, picks only filter membership)", () => {
    // If a future Settings reorder feature reshuffles visibleTabs, the
    // composed output should match that reshuffle, not snap back to
    // NAV_ITEMS order. The membership filter is order-preserving.
    const reordered = ["/sequences", "/methods", "/gantt", "/workbench", "/"];
    const p = picks({ account_type: "solo" });
    expect(deriveVisibleTabs(p, reordered)).toEqual(reordered);
  });
});

describe("deriveVisibleTabs() — manual override semantics", () => {
  it("settings.visibleTabs hiding /sequences wins over picks that include /sequences", () => {
    // /sequences is in tabsForFeaturePicks's always-visible set. If the
    // user has manually hidden it via Settings, the manual layer
    // should hide it.
    const p = picks({ account_type: "solo" });
    const settings = ["/", "/workbench", "/gantt", "/methods"];
    const result = deriveVisibleTabs(p, settings);
    expect(result).not.toContain("/sequences");
  });

  it("settings.visibleTabs trying to show /links is rejected when picks say solo", () => {
    // The lock: settings can hide what picks would show, but not
    // unhide what picks excluded. A solo account whose settings.json
    // somehow lists /links (carryover from defaults or a manual
    // edit) sees /links HIDDEN.
    const p = picks({ account_type: "solo" });
    const settings = ["/", "/workbench", "/links"];
    const result = deriveVisibleTabs(p, settings);
    expect(result).not.toContain("/links");
    expect(result).toEqual(["/", "/workbench"]);
  });

  it("settings.visibleTabs trying to show /calendar is rejected when picks say calendar=no", () => {
    const p = picks({ calendar: "no" });
    const settings = ["/", "/calendar"];
    expect(deriveVisibleTabs(p, settings)).toEqual(["/"]);
  });

  it("settings.visibleTabs hiding /purchases wins over picks that include /purchases", () => {
    const p = picks({ purchases: "yes" });
    const settings = ["/", "/workbench"]; // user manually hid /purchases
    const result = deriveVisibleTabs(p, settings);
    expect(result).not.toContain("/purchases");
  });
});
