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
});
