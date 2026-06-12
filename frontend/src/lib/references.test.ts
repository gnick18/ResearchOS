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
  it("builds the molecule route (chemistry query param)", () => {
    expect(objectDeepLink("molecule", "14")).toBe("/chemistry?molecule=14");
  });
  it("builds the datahub route (data hub query param)", () => {
    expect(objectDeepLink("datahub", "dh1")).toBe("/datahub?doc=dh1");
  });
  it("builds the reserved segment routes", () => {
    expect(objectDeepLink("method", " abc")).toBe("/methods/%20abc");
    expect(objectDeepLink("note", "n1")).toBe("/notes/n1");
    expect(objectDeepLink("file", "f1")).toBe("/files/f1");
    expect(objectDeepLink("project", "p1")).toBe("/projects/p1");
  });
  it("builds the task route (openTask query param, own task)", () => {
    expect(objectDeepLink("task", "self:42")).toBe("/?openTask=self%3A42");
  });
  it("builds the task route (openTask query param, shared task)", () => {
    expect(objectDeepLink("task", "alice:42")).toBe("/?openTask=alice%3A42");
  });
  it("builds the experiment route (same deep link as task)", () => {
    expect(objectDeepLink("experiment", "self:7")).toBe("/?openTask=self%3A7");
  });
});

describe("objectReferenceMarkdown", () => {
  it("wraps the name as a markdown link to the deep link", () => {
    expect(objectReferenceMarkdown("sequence", 5, "pUC19")).toBe(
      "[pUC19](/sequences?seq=5)",
    );
  });
  it("escapes both brackets in the name so the link cannot break", () => {
    expect(objectReferenceMarkdown("sequence", 5, "clone [v2]")).toBe(
      "[clone \\[v2\\]](/sequences?seq=5)",
    );
  });
  it("wraps a task name as a markdown link", () => {
    expect(objectReferenceMarkdown("task", "self:42", "My PCR run")).toBe(
      "[My PCR run](/?openTask=self%3A42)",
    );
  });
  it("wraps an experiment name as a markdown link", () => {
    expect(objectReferenceMarkdown("experiment", "self:7", "Western blot")).toBe(
      "[Western blot](/?openTask=self%3A7)",
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
    { type: "molecule", id: "14" },
    { type: "datahub", id: "dh1" },
  ];
  for (const { type, id } of cases) {
    it(`round-trips ${type}`, () => {
      const href = objectDeepLink(type, id);
      expect(parseObjectDeepLink(href)).toEqual({ type, id });
    });
  }

  // Task and experiment both build /?openTask=... URLs. parseObjectDeepLink
  // resolves them to "task" (the first match in OBJECT_ROUTES that returns a
  // non-null id). That is intentional -- the URL alone cannot distinguish a
  // task from an experiment; the popup host renders the same component either
  // way, and search_my_work briefs carry the "experiment" type separately.
  it("parses a task deep link back to type=task (own task)", () => {
    const href = objectDeepLink("task", "self:42");
    expect(parseObjectDeepLink(href)).toEqual({ type: "task", id: "self:42" });
  });
  it("parses a task deep link back to type=task (shared task)", () => {
    const href = objectDeepLink("task", "alice:42");
    expect(parseObjectDeepLink(href)).toEqual({ type: "task", id: "alice:42" });
  });
  it("parses an experiment deep link back to type=task (shared URL form)", () => {
    // objectDeepLink("experiment", ...) produces the same /?openTask= URL as
    // "task". parseObjectDeepLink resolves it to "task" because "task" is the
    // first entry that matches; this is documented behavior.
    const href = objectDeepLink("experiment", "self:7");
    expect(parseObjectDeepLink(href)).toEqual({ type: "task", id: "self:7" });
  });

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

  it("recognizes an absolute openTask URL", () => {
    expect(
      parseObjectDeepLink("https://research-os.app/?openTask=self%3A5"),
    ).toEqual({ type: "task", id: "self:5" });
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

describe("popup-capable type gating (via parseObjectDeepLink)", () => {
  it("a task href parses to a type that ObjectChip routes to the popup host", () => {
    // This documents the contract between references.ts and ObjectChip:
    // any href that parseObjectDeepLink resolves to type "task" or "experiment"
    // will be intercepted by openObjectPopup() rather than router.push().
    const parsed = parseObjectDeepLink("/?openTask=self%3A10");
    expect(parsed?.type).toBe("task");
  });
});
