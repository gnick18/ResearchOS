import { describe, it, expect } from "vitest";
import {
  objectDeepLink,
  objectReferenceMarkdown,
  parseObjectDeepLink,
  type ObjectRefType,
} from "@/lib/references";

describe("objectDeepLink", () => {
  it("builds the sequence route", () => {
    expect(objectDeepLink("sequence", 5)).toBe("/sequences?seq=5");
  });
  it("builds the collection route", () => {
    expect(objectDeepLink("collection", "12")).toBe("/sequences?collection=12");
  });
  it("builds the reserved segment routes", () => {
    expect(objectDeepLink("method", " abc")).toBe("/methods/%20abc");
    expect(objectDeepLink("note", "n1")).toBe("/notes/n1");
    expect(objectDeepLink("file", "f1")).toBe("/files/f1");
    expect(objectDeepLink("project", "p1")).toBe("/projects/p1");
  });
});

describe("objectReferenceMarkdown", () => {
  it("wraps the name as a markdown link to the deep link", () => {
    expect(objectReferenceMarkdown("sequence", 5, "pUC19")).toBe(
      "[pUC19](/sequences?seq=5)",
    );
  });
  it("escapes a closing bracket in the name so the link cannot break", () => {
    expect(objectReferenceMarkdown("sequence", 5, "clone [v2]")).toBe(
      "[clone [v2\\]](/sequences?seq=5)",
    );
  });
});

describe("parseObjectDeepLink round-trip", () => {
  const cases: Array<{ type: ObjectRefType; id: string }> = [
    { type: "sequence", id: "5" },
    { type: "collection", id: "12" },
    { type: "method", id: "m1" },
    { type: "note", id: "n1" },
    { type: "file", id: "f1" },
    { type: "project", id: "p1" },
  ];
  for (const { type, id } of cases) {
    it(`round-trips ${type}`, () => {
      const href = objectDeepLink(type, id);
      expect(parseObjectDeepLink(href)).toEqual({ type, id });
    });
  }

  it("recognizes an absolute app URL", () => {
    expect(parseObjectDeepLink("https://research-os.app/sequences?seq=9")).toEqual({
      type: "sequence",
      id: "9",
    });
  });

  it("recognizes a sequence link with extra query params", () => {
    expect(parseObjectDeepLink("/sequences?seq=9&foo=bar")).toEqual({
      type: "sequence",
      id: "9",
    });
  });

  it("returns null for a non-object link", () => {
    expect(parseObjectDeepLink("https://example.com/page")).toBeNull();
    expect(parseObjectDeepLink("/sequences")).toBeNull();
    expect(parseObjectDeepLink("mailto:a@b.com")).toBeNull();
    expect(parseObjectDeepLink("#anchor")).toBeNull();
  });

  it("does not match a deeper sub-path of a segment route", () => {
    expect(parseObjectDeepLink("/methods/12/edit")).toBeNull();
  });

  it("returns null for empty / nullish input", () => {
    expect(parseObjectDeepLink(null)).toBeNull();
    expect(parseObjectDeepLink(undefined)).toBeNull();
    expect(parseObjectDeepLink("")).toBeNull();
    expect(parseObjectDeepLink("   ")).toBeNull();
  });
});
