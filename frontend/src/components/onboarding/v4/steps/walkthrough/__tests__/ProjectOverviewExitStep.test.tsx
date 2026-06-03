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
 * (tour-teardown audit, 2026-06-03).
 *
 * The widget-framework teardown removed the member/solo Home nav tab and
 * turned "/" into a pure role redirect that the tour-active guard
 * suppresses. So the exit step no longer glides to a (now-absent) Home /
 * Lab Overview tab nor pushes to "/". It now:
 *   - glides to the notification bell (rendered in the top nav on every
 *     page for every account type), and
 *   - lands the user on /workbench (a real page for member, solo, and PI)
 * so the following notifications cluster fires cleanly.
 *
 * The `homeOrLabOverviewNavSelector()` helper is still exported (other
 * call sites / back-compat), so its DOM-resolution behavior is still
 * covered by the second describe block below.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("project-overview-exit step shape", () => {
  it("keeps its id, pose, route, and manual completion", () => {
    expect(projectOverviewExitStep.id).toBe("project-overview-exit");
    expect(projectOverviewExitStep.pose).toBe("pointing");
    // Tour-teardown audit (2026-06-03): lands on /workbench, not "/".
    expect(projectOverviewExitStep.expectedRoute).toBe("/workbench");
    expect(projectOverviewExitStep.completion.type).toBe("manual");
  });

  it("targets the notification bell (present on every page)", () => {
    // Tour-teardown audit (2026-06-03): the removed Home / Lab Overview
    // nav-tab glide is replaced with the always-present notification bell.
    expect(projectOverviewExitStep.targetSelector).toBe(
      targetSelector(TOUR_TARGETS.notificationsBell),
    );
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
