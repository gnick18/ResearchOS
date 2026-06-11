// @vitest-environment jsdom
//
// spotlight_ui_element pure-logic test (ai spotlight bot, 2026-06-10).
//
// Tests the navigate-wait-highlight sequence with every effect injected, so no
// real DOM, router, or network is needed. Covers: resolving an id to the right
// page and selector, navigating then highlighting a present element, skipping
// navigation when already on the page, and the graceful result when the element
// never mounts. Also exercises waitForElement against a fake document for both
// the found and timeout paths.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  planSpotlight,
  runSpotlight,
  selectorForAnchor,
  narrationFor,
} from "../tools/spotlight-ui-element";
import { waitForElement } from "@/components/ai/spotlight-controller";
import type { UiAnchor } from "../ui-anchors.generated";

const ANCHORS: UiAnchor[] = [
  { id: "gantt-new-task-button", label: "New task button (Gantt timeline)", page: "/gantt" },
  { id: "methods-new-method-button", label: "New method button (Methods library)", page: "/methods" },
];

describe("planSpotlight", () => {
  it("resolves a known id to its page and selector", () => {
    const plan = planSpotlight("gantt-new-task-button", ANCHORS);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.anchor.page).toBe("/gantt");
      expect(plan.selector).toBe('[data-tour-target="gantt-new-task-button"]');
      expect(plan.narration.length).toBeGreaterThan(0);
    }
  });

  it("returns an error result for an unknown id", () => {
    const plan = planSpotlight("nope-not-real", ANCHORS);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toContain("find_ui_element");
  });
});

describe("selectorForAnchor / narrationFor", () => {
  it("builds the data-tour-target selector", () => {
    expect(selectorForAnchor("x-y")).toBe('[data-tour-target="x-y"]');
  });
  it("narrates without the area parenthetical", () => {
    const n = narrationFor(ANCHORS[0]);
    expect(n).not.toContain("(");
    expect(n.toLowerCase()).toContain("new task button");
  });
});

describe("runSpotlight", () => {
  it("navigates to the page then highlights a present element", async () => {
    const plan = planSpotlight("gantt-new-task-button", ANCHORS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const navigate = vi.fn();
    const show = vi.fn();
    const fakeEl = {} as HTMLElement;
    const wait = vi.fn().mockResolvedValue(fakeEl);

    const result = await runSpotlight(plan, {
      navigate,
      wait,
      show,
      currentPath: () => "/ai",
    });

    expect(navigate).toHaveBeenCalledWith("/gantt");
    expect(wait).toHaveBeenCalledWith(plan.selector);
    expect(show).toHaveBeenCalledWith(fakeEl, plan.narration);
    expect(result.highlighted).toBe(true);
    expect(result.id).toBe("gantt-new-task-button");
    expect(result.page).toBe("/gantt");
  });

  it("skips navigation when already on the target page", async () => {
    const plan = planSpotlight("gantt-new-task-button", ANCHORS);
    if (!plan.ok) throw new Error("plan failed");

    const navigate = vi.fn();
    const show = vi.fn();
    const wait = vi.fn().mockResolvedValue({} as HTMLElement);

    await runSpotlight(plan, {
      navigate,
      wait,
      show,
      currentPath: () => "/gantt",
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
  });

  it("returns a graceful result when the element never mounts", async () => {
    const plan = planSpotlight("methods-new-method-button", ANCHORS);
    if (!plan.ok) throw new Error("plan failed");

    const navigate = vi.fn();
    const show = vi.fn();
    const wait = vi.fn().mockResolvedValue(null); // timed out

    const result = await runSpotlight(plan, {
      navigate,
      wait,
      show,
      currentPath: () => "/ai",
    });

    expect(navigate).toHaveBeenCalledWith("/methods");
    expect(show).not.toHaveBeenCalled();
    expect(result.highlighted).toBe(false);
    expect(result.message).toContain("could not find");
  });
});

describe("waitForElement", () => {
  it("resolves with the element once it appears", async () => {
    // waitForElement checks `instanceof HTMLElement`, so use a real jsdom node
    // that is already mounted, the poll finds it on the first tick.
    const realEl = document.createElement("div");
    realEl.setAttribute("data-tour-target", "x");
    document.body.appendChild(realEl);
    const found = await waitForElement('[data-tour-target="x"]', {
      timeoutMs: 1000,
      intervalMs: 1,
    });
    expect(found).toBe(realEl);
    realEl.remove();
  });

  it("resolves with the element once a late mount lands", async () => {
    // Mount the target after a short delay to exercise the polling path.
    setTimeout(() => {
      const late = document.createElement("div");
      late.setAttribute("data-tour-target", "late-mount");
      document.body.appendChild(late);
    }, 15);
    const found = await waitForElement('[data-tour-target="late-mount"]', {
      timeoutMs: 1000,
      intervalMs: 5,
    });
    expect(found).not.toBeNull();
    found?.remove();
  });

  it("resolves null when the element never appears within the timeout", async () => {
    const found = await waitForElement('[data-tour-target="never-mounts-xyz"]', {
      timeoutMs: 30,
      intervalMs: 5,
    });
    expect(found).toBeNull();
  });
});
