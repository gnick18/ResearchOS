import { afterEach, describe, expect, it, vi } from "vitest";

// Stub next/navigation for any transitively-imported module that reaches
// for the router (cursor-script + step-helpers chain stays pure, but the
// stub keeps the import graph happy under jsdom).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
}));

import { projectOverviewExitStep } from "../ProjectOverviewExitStep";
import {
  homeOrLabOverviewNavSelector,
  targetSelector,
  TOUR_TARGETS,
} from "../lib/targets";

/**
 * §6.2→6.3 transition step (`project-overview-exit`) target coverage
 * (pi-walkthrough hardening, 2026-05-29).
 *
 * After the PI Home migration the Home top-nav tab is hidden for
 * lab_head accounts, so the exit step's cursor glide / spotlight must
 * anchor to whichever "back to Home" tab is actually rendered:
 *   - member / solo  → home-nav-tab
 *   - PI (Home hidden) → lab-overview-nav-tab
 *
 * The step uses `homeOrLabOverviewNavSelector()`, a combined selector
 * resolved by DOM presence (document.querySelector returns the first
 * match in document order). These tests prove the selector shape and
 * that DOM presence picks the right tab per account type.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("project-overview-exit step shape", () => {
  it("keeps its id, pose, route, and manual completion", () => {
    expect(projectOverviewExitStep.id).toBe("project-overview-exit");
    expect(projectOverviewExitStep.pose).toBe("pointing");
    expect(projectOverviewExitStep.expectedRoute).toBe("/");
    expect(projectOverviewExitStep.completion.type).toBe("manual");
  });

  it("targets the combined Home / Lab Overview nav selector", () => {
    expect(projectOverviewExitStep.targetSelector).toBe(
      homeOrLabOverviewNavSelector(),
    );
    // The combined selector references BOTH tab anchors so DOM presence
    // can decide which one the cursor lands on.
    const sel = projectOverviewExitStep.targetSelector!;
    expect(sel).toContain(targetSelector(TOUR_TARGETS.homeNavTab));
    expect(sel).toContain(targetSelector(TOUR_TARGETS.labOverviewNavTab));
  });
});

describe("homeOrLabOverviewNavSelector — account-type resolution by DOM", () => {
  it("matches the Home tab for a member (only home-nav-tab rendered)", () => {
    document.body.innerHTML = `<button data-tour-target="home-nav-tab">Home</button>`;
    const found = document.querySelector(homeOrLabOverviewNavSelector());
    expect(found?.getAttribute("data-tour-target")).toBe("home-nav-tab");
  });

  it("matches the Lab Overview tab for a PI (Home tab hidden)", () => {
    // PI default post-migration: the Home tab is not rendered, only the
    // Lab Overview tab is.
    document.body.innerHTML = `<button data-tour-target="lab-overview-nav-tab">Lab Overview</button>`;
    const found = document.querySelector(homeOrLabOverviewNavSelector());
    expect(found?.getAttribute("data-tour-target")).toBe(
      "lab-overview-nav-tab",
    );
  });

  it("prefers Home when a PI opted Home back in (both rendered, Home first)", () => {
    // AppShell slots Lab Overview right AFTER Home, so when both are
    // present the first document-order match is Home — which is correct,
    // the PI chose to keep Home.
    document.body.innerHTML =
      `<button data-tour-target="home-nav-tab">Home</button>` +
      `<button data-tour-target="lab-overview-nav-tab">Lab Overview</button>`;
    const found = document.querySelector(homeOrLabOverviewNavSelector());
    expect(found?.getAttribute("data-tour-target")).toBe("home-nav-tab");
  });
});
