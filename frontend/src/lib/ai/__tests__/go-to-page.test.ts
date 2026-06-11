// go_to_page logic test (ai perception bot, 2026-06-11).
//
// Tests the plan (resolve a request or path to a destination) and the run
// (navigate, or skip when already there) with the navigate effect injected. Covers
// an explicit known path, a free-text query routed through the page hint, an
// unknown path, an empty request, and the already-on-page skip. The cross-page
// flow shape (navigate then the model reads) is asserted by the result message.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { planGoToPage, runGoToPage } from "../tools/go-to-page";

describe("planGoToPage", () => {
  it("accepts an explicit known path and normalizes to the top route", () => {
    const plan = planGoToPage({ path: "/methods/123" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.page).toBe("/methods");
      expect(plan.reason).toBe("path");
    }
  });

  it("routes a free-text query through the page hint", () => {
    const plan = planGoToPage({ query: "add a method" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.page).toBe("/methods");
      expect(plan.reason).toBe("hint");
    }
  });

  it("routes a buy-a-reagent query to purchases", () => {
    const plan = planGoToPage({ query: "buy a reagent" });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.page).toBe("/purchases");
  });

  it("rejects an unknown path", () => {
    const plan = planGoToPage({ path: "/not-a-page" });
    expect(plan.ok).toBe(false);
  });

  it("rejects an empty request", () => {
    const plan = planGoToPage({});
    expect(plan.ok).toBe(false);
  });

  it("returns an error when nothing matches the query", () => {
    const plan = planGoToPage({ query: "xyzzy nonsense words" });
    expect(plan.ok).toBe(false);
  });
});

describe("runGoToPage", () => {
  it("navigates and tells the model to read the page next", () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    const result = runGoToPage(plan, { navigate, currentPath: () => "/workbench" });

    expect(navigate).toHaveBeenCalledWith("/methods");
    expect(result.navigated).toBe(true);
    expect(result.message).toContain("read_page");
  });

  it("skips navigation when already on the page", () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    const result = runGoToPage(plan, { navigate, currentPath: () => "/methods" });

    expect(navigate).not.toHaveBeenCalled();
    expect(result.alreadyThere).toBe(true);
    expect(result.message).toContain("read_page");
  });
});
