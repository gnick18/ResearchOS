// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { storePreDemoRoute, consumePreDemoRoute } from "../pre-demo-route";

describe("pre-demo-route", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("stores a route and consumes it exactly once", () => {
    storePreDemoRoute("/settings");
    expect(consumePreDemoRoute()).toBe("/settings");
    expect(consumePreDemoRoute()).toBe(null); // already consumed
  });

  it("preserves query strings", () => {
    storePreDemoRoute("/workbench?tab=notes");
    expect(consumePreDemoRoute()).toBe("/workbench?tab=notes");
  });

  it("returns null when nothing is stored", () => {
    expect(consumePreDemoRoute()).toBe(null);
  });

  it("rejects non-relative or protocol-relative values (open-redirect guard)", () => {
    window.sessionStorage.setItem("researchos:pre-demo-route", "//evil.com");
    expect(consumePreDemoRoute()).toBe(null);
    window.sessionStorage.setItem("researchos:pre-demo-route", "https://evil.com");
    expect(consumePreDemoRoute()).toBe(null);
  });
});
