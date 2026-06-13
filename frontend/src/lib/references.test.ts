import { describe, it, expect } from "vitest";
import {
  objectDeepLink,
  objectReferenceMarkdown,
  parseObjectDeepLink,
  methodRefId,
  splitMethodRefId,
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

describe("method scope (public vs private)", () => {
  it("leaves a private method ref a bare numeric id (resolves private-first)", () => {
    expect(methodRefId(1, false)).toBe("1");
    expect(splitMethodRefId("1")).toEqual({ id: 1 });
  });

  it("marks a public method ref with a public scope prefix", () => {
    expect(methodRefId(1, true)).toBe("public:1");
    expect(splitMethodRefId("public:1")).toEqual({ id: 1, owner: "public" });
  });

  it("round-trips a public method ref id", () => {
    const refId = methodRefId(42, true);
    expect(splitMethodRefId(refId)).toEqual({ id: 42, owner: "public" });
  });

  it("a public method reference resolves to the public method, not a same-id private one", () => {
    // A public method id 1 and a private method id 1 both exist (separate
    // stores, overlapping id-space). The inserted reference must carry the
    // public scope so the resolver (methodsApi.get with owner "public") reads
    // the public store rather than the private one that resolves first.
    const refId = methodRefId(1, true);
    const md = objectReferenceMarkdown("method", refId, "Lab qPCR protocol");
    expect(md).toBe("[Lab qPCR protocol](/methods/public%3A1)");

    const parsed = parseObjectDeepLink(md.slice(md.indexOf("(") + 1, -1));
    expect(parsed).toEqual({ type: "method", id: "public:1" });

    // The resolving side splits the id back into the numeric id + public owner,
    // which is exactly the argument shape methodsApi.get needs to hit the public
    // store instead of the same-id private method.
    expect(splitMethodRefId(parsed!.id)).toEqual({ id: 1, owner: "public" });
  });

  it("a private method reference resolves with no owner (private-first)", () => {
    const refId = methodRefId(1, false);
    const md = objectReferenceMarkdown("method", refId, "My draft method");
    expect(md).toBe("[My draft method](/methods/1)");

    const parsed = parseObjectDeepLink("/methods/1");
    expect(parsed).toEqual({ type: "method", id: "1" });
    expect(splitMethodRefId(parsed!.id)).toEqual({ id: 1 });
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
