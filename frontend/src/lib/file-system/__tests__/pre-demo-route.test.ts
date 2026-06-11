// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  storePreDemoRoute,
  consumePreDemoRoute,
  demoRedirectTarget,
} from "../pre-demo-route";

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

describe("demoRedirectTarget", () => {
  it("returns empty for the bare /demo entry (render Home in place)", () => {
    expect(demoRedirectTarget("/demo")).toBe("");
    expect(demoRedirectTarget("/demo/")).toBe("");
    expect(demoRedirectTarget("")).toBe("");
  });

  it("strips the /demo prefix to the real in-app path", () => {
    expect(demoRedirectTarget("/demo/methods")).toBe("/methods");
    expect(demoRedirectTarget("/demo/datahub")).toBe("/datahub");
    expect(demoRedirectTarget("/demo/workbench/projects")).toBe(
      "/workbench/projects",
    );
  });

  it("preserves the query string so parameterized deep links survive", () => {
    expect(demoRedirectTarget("/demo/datahub", "?doc=5")).toBe("/datahub?doc=5");
    expect(
      demoRedirectTarget("/demo/sequences", "?seq=12&tab=map"),
    ).toBe("/sequences?seq=12&tab=map");
  });

  it("preserves the hash as well", () => {
    expect(demoRedirectTarget("/demo/wiki/features/datahub", "", "#graphs")).toBe(
      "/wiki/features/datahub#graphs",
    );
    expect(demoRedirectTarget("/demo/datahub", "?doc=5", "#top")).toBe(
      "/datahub?doc=5#top",
    );
  });

  it("adds no stray separators when there is no query or hash", () => {
    expect(demoRedirectTarget("/demo/methods", "", "")).toBe("/methods");
    expect(demoRedirectTarget("/demo/methods").includes("?")).toBe(false);
  });
});
