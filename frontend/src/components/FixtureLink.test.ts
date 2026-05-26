import { describe, expect, it } from "vitest";
import { withFixtureParam } from "./FixtureLink";

describe("withFixtureParam (FixtureLink helper)", () => {
  it("appends wikiCapture=1 to a plain internal href", () => {
    expect(withFixtureParam("/workbench", "1")).toBe("/workbench?wikiCapture=1");
  });

  it("returns the href unchanged when no capture value is present", () => {
    expect(withFixtureParam("/workbench", null)).toBe("/workbench");
    expect(withFixtureParam("/workbench", "")).toBe("/workbench");
  });

  it("merges with an existing query string using `&`", () => {
    expect(withFixtureParam("/lab?tab=purchases", "1")).toBe(
      "/lab?tab=purchases&wikiCapture=1",
    );
  });

  it("passes the picker variant through unchanged", () => {
    expect(withFixtureParam("/workbench", "picker")).toBe(
      "/workbench?wikiCapture=picker",
    );
  });

  it("does not modify external https links", () => {
    expect(withFixtureParam("https://example.com", "1")).toBe(
      "https://example.com",
    );
  });

  it("does not modify mailto: links", () => {
    expect(withFixtureParam("mailto:gnickles@wisc.edu", "1")).toBe(
      "mailto:gnickles@wisc.edu",
    );
  });

  it("does not modify in-page anchor hrefs", () => {
    expect(withFixtureParam("#overview", "1")).toBe("#overview");
  });

  it("does not modify protocol-relative or relative paths", () => {
    expect(withFixtureParam("workbench/projects/1", "1")).toBe(
      "workbench/projects/1",
    );
    expect(withFixtureParam("//cdn.example.com/x", "1")).toBe(
      "//cdn.example.com/x",
    );
  });

  it("passes UrlObject hrefs through untouched (not a plain string)", () => {
    const obj = { pathname: "/workbench", query: { x: "1" } } as const;
    expect(withFixtureParam(obj, "1")).toBe(obj);
  });

  it("URL-encodes the capture value to neutralize injection attempts", () => {
    expect(withFixtureParam("/x", "1&evil=1")).toBe(
      "/x?wikiCapture=1%26evil%3D1",
    );
  });

  // Panel investigator follow-up (finding #2): re-attach all allowlisted
  // fixture / preview params, not just `wikiCapture`. Prevents reload
  // mid-tour from preserving `wikiCapture=picker` while dropping
  // `wizard-preview=1` from the URL (URL-vs-state asymmetry).
  it("re-attaches wizard-preview when present in the record", () => {
    expect(withFixtureParam("/workbench", { "wizard-preview": "1" })).toBe(
      "/workbench?wizard-preview=1",
    );
  });

  it("re-attaches wizardSeedStep when present in the record", () => {
    expect(
      withFixtureParam("/workbench", { wizardSeedStep: "home-create-project" }),
    ).toBe("/workbench?wizardSeedStep=home-create-project");
  });

  it("re-attaches all three params together", () => {
    expect(
      withFixtureParam("/workbench", {
        wikiCapture: "picker",
        "wizard-preview": "1",
        wizardSeedStep: "home-create-project",
      }),
    ).toBe(
      "/workbench?wikiCapture=picker&wizard-preview=1&wizardSeedStep=home-create-project",
    );
  });

  it("merges allowlisted params with an existing query string using `&`", () => {
    expect(
      withFixtureParam("/lab?tab=purchases", {
        wikiCapture: "1",
        "wizard-preview": "1",
      }),
    ).toBe("/lab?tab=purchases&wikiCapture=1&wizard-preview=1");
  });

  it("returns the href unchanged when the record is empty", () => {
    expect(withFixtureParam("/workbench", {})).toBe("/workbench");
  });
});
