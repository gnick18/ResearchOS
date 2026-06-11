// @vitest-environment jsdom
//
// click-element unit tests (ai click tests bot, 2026-06-11).
//
// Tests runClick, targetLabel, and the tool's describeAction / isDestructive
// shape. All effects (resolve and click) are injected, so no real DOM routing is
// required for runClick. targetLabel exercises the live-DOM path via jsdom for
// the "element is present" branch, and the fallback path for the "element gone"
// branch.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClick, targetLabel, clickElementTool } from "../tools/click-element";

// ---- runClick ----------------------------------------------------------------

describe("runClick", () => {
  it("resolves the ref and calls the injected click", () => {
    const fakeEl = document.createElement("button");
    const resolve = vi.fn().mockReturnValue(fakeEl);
    const click = vi.fn();

    const result = runClick({ ref: "bb-1", name: "Save" }, { resolve, click });

    expect(resolve).toHaveBeenCalledWith("bb-1");
    expect(click).toHaveBeenCalledWith(fakeEl);
    expect(result.clicked).toBe(true);
    expect(result.ref).toBe("bb-1");
    expect(result.message).toContain("Save");
  });

  it("returns a graceful result when resolve returns null", () => {
    const resolve = vi.fn().mockReturnValue(null);
    const click = vi.fn();

    const result = runClick({ ref: "bb-99" }, { resolve, click });

    expect(click).not.toHaveBeenCalled();
    expect(result.clicked).toBe(false);
    expect(result.ref).toBe("bb-99");
    // The model should be told to re-read the page.
    expect(result.message).toContain("read_page");
  });

  it("includes the element name in the success message", () => {
    const fakeEl = document.createElement("button");
    const resolve = vi.fn().mockReturnValue(fakeEl);
    const click = vi.fn();

    const result = runClick(
      { ref: "bb-2", name: "New Method" },
      { resolve, click },
    );

    expect(result.message).toContain("New Method");
  });

  it("produces a generic message when no name is supplied", () => {
    const fakeEl = document.createElement("button");
    const resolve = vi.fn().mockReturnValue(fakeEl);
    const click = vi.fn();

    const result = runClick({ ref: "bb-3" }, { resolve, click });

    expect(result.clicked).toBe(true);
    // Without a name the message falls back to a generic "Clicked the element"
    // form (no quoted label).
    expect(result.message).not.toContain('"');
  });
});

// ---- targetLabel ------------------------------------------------------------

describe("targetLabel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the aria-label from the live element when it is present", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Delete experiment");
    document.body.appendChild(btn);

    // Fake resolve returns the live element directly so the name is computed
    // from the real DOM (aria-label branch of accessibleName).
    const resolve = vi.fn().mockReturnValue(btn);

    const label = targetLabel("bb-1", "fallback name", resolve);
    expect(label).toBe("Delete experiment");
  });

  it("falls back to the model-supplied name when resolve returns null", () => {
    const resolve = vi.fn().mockReturnValue(null);
    const label = targetLabel("bb-99", "fallback label", resolve);
    expect(label).toBe("fallback label");
  });

  it("falls back to empty string when resolve returns null and no fallback is given", () => {
    const resolve = vi.fn().mockReturnValue(null);
    const label = targetLabel("bb-99", undefined, resolve);
    expect(label).toBe("");
  });
});

// ---- clickElementTool shape -------------------------------------------------

describe("clickElementTool shape", () => {
  it("has action: true", () => {
    expect(clickElementTool.action).toBe(true);
  });

  it("has a describeAction function", () => {
    expect(typeof clickElementTool.describeAction).toBe("function");
  });

  it("has an isDestructive function", () => {
    expect(typeof clickElementTool.isDestructive).toBe("function");
  });

  it("describeAction returns a summary string containing the name when supplied", () => {
    const described = clickElementTool.describeAction?.({
      ref: "bb-1",
      name: "New Method",
    });
    expect(described).toBeDefined();
    expect(typeof described?.summary).toBe("string");
    expect(described?.summary).toContain("New Method");
  });

  it("describeAction returns a summary when no name is supplied", () => {
    const described = clickElementTool.describeAction?.({ ref: "bb-1" });
    expect(typeof described?.summary).toBe("string");
    expect(described?.summary.length).toBeGreaterThan(0);
  });

  it("describeAction includes the ref when one is provided", () => {
    const described = clickElementTool.describeAction?.({
      ref: "bb-42",
      name: "Submit",
    });
    expect(described?.ref).toBe("bb-42");
  });

  it("describeAction does not include ref when no ref is given", () => {
    const described = clickElementTool.describeAction?.({ ref: "" });
    // An empty ref should not produce a ref field on the description.
    expect(described?.ref).toBeUndefined();
  });

  it("isDestructive returns true for a name containing a destructive term", () => {
    // isDestructive reads the accessible name from the live page via resolveRef,
    // which returns null in jsdom (no perceived elements registered). So the
    // fallback is the model-supplied name. A destructive name must trip it.
    const result = clickElementTool.isDestructive?.({
      ref: "bb-999",
      name: "Delete experiment",
    });
    expect(result).toBe(true);
  });

  it("isDestructive returns false for a benign name", () => {
    const result = clickElementTool.isDestructive?.({
      ref: "bb-999",
      name: "New Method",
    });
    expect(result).toBe(false);
  });

  it("name is 'click_element'", () => {
    expect(clickElementTool.name).toBe("click_element");
  });

  it("parameters require 'ref'", () => {
    expect(clickElementTool.parameters.required).toContain("ref");
  });

  it("execute resolves gracefully when no ref is given", async () => {
    // execute calls the real resolveRef which returns null in jsdom, giving us
    // the graceful-failure path without a ref.
    const result = (await clickElementTool.execute({})) as {
      clicked: boolean;
      message: string;
    };
    expect(result.clicked).toBe(false);
    expect(typeof result.message).toBe("string");
  });
});
