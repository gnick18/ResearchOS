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
import { planGoToPage, runGoToPage, waitForPathMatch } from "../tools/go-to-page";

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
  it("navigates and tells the model to read the page next", async () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    const result = await runGoToPage(plan, {
      navigate,
      currentPath: () => "/workbench",
    });

    expect(navigate).toHaveBeenCalledWith("/methods");
    expect(result.navigated).toBe(true);
    expect(result.message).toContain("read_page");
  });

  it("skips navigation when already on the page", async () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    const result = await runGoToPage(plan, {
      navigate,
      currentPath: () => "/methods",
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(result.alreadyThere).toBe(true);
    expect(result.message).toContain("read_page");
  });

  it("awaits the route landing before resolving, then reports it landed", async () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    // The waiter only resolves after navigate ran, proving runGoToPage awaits it
    // before returning the read_page instruction.
    const order: string[] = [];
    const waitForPath = vi.fn(async (page: string) => {
      order.push(`wait:${page}`);
      return true;
    });
    navigate.mockImplementation((p: string) => order.push(`nav:${p}`));

    const result = await runGoToPage(plan, {
      navigate,
      currentPath: () => "/workbench",
      waitForPath,
    });

    expect(order).toEqual(["nav:/methods", "wait:/methods"]);
    expect(waitForPath).toHaveBeenCalledWith("/methods");
    expect(result.landed).toBe(true);
    expect(result.message).toContain("read_page");
  });

  it("reports the route did not confirm when the wait times out", async () => {
    const navigate = vi.fn();
    const plan = planGoToPage({ path: "/methods" });
    if (!plan.ok) throw new Error("plan failed");

    const result = await runGoToPage(plan, {
      navigate,
      currentPath: () => "/workbench",
      waitForPath: async () => false,
    });

    expect(result.navigated).toBe(true);
    expect(result.landed).toBe(false);
    expect(result.message).toContain("did not confirm");
  });
});

describe("waitForPathMatch", () => {
  it("resolves true once the live path matches the target top route", async () => {
    let path = "/workbench";
    // Flip the path after a couple of polls.
    let calls = 0;
    const readPath = () => {
      calls += 1;
      if (calls >= 3) path = "/methods/new";
      return path;
    };
    const ok = await waitForPathMatch("/methods", {
      readPath,
      intervalMs: 0,
      timeoutMs: 1000,
      now: (() => {
        let t = 0;
        return () => (t += 1);
      })(),
      setTimeoutFn: ((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
    });
    expect(ok).toBe(true);
  });

  it("resolves false when the path never matches before the timeout", async () => {
    let t = 0;
    const ok = await waitForPathMatch("/methods", {
      readPath: () => "/workbench",
      intervalMs: 10,
      timeoutMs: 100,
      now: () => (t += 60),
      setTimeoutFn: ((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
    });
    expect(ok).toBe(false);
  });
});
