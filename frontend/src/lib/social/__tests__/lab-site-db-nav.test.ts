// Unit tests for orderNavPages (lab-site-db.ts) and the
// listPublishedPages-adjacent logic. The DB function itself uses Neon and is
// tested via the route-level integration tests; the pure ordering function can be
// tested synchronously without any IO.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

import {
  orderNavPages,
  type PublishedPageEntry,
} from "../lab-site-db";

/** Helper to build a minimal PublishedPageEntry. */
function p(path: string, title = path || "Home"): PublishedPageEntry {
  return { path, title };
}

describe("orderNavPages", () => {
  it("returns an empty array unchanged", () => {
    expect(orderNavPages([])).toEqual([]);
  });

  it("puts the home page (empty path) first", () => {
    const pages = [p("people"), p(""), p("about")];
    const result = orderNavPages(pages);
    expect(result[0].path).toBe("");
  });

  it("puts people second", () => {
    const pages = [p("about"), p("people"), p("")];
    const result = orderNavPages(pages);
    expect(result[0].path).toBe("");
    expect(result[1].path).toBe("people");
  });

  it("puts papers/* entries before other pages", () => {
    const pages = [p("about"), p("contact"), p("papers/fakeyeast-2026"), p(""), p("people")];
    const result = orderNavPages(pages);
    expect(result.map((e) => e.path)).toEqual([
      "",
      "people",
      "papers/fakeyeast-2026",
      "about",
      "contact",
    ]);
  });

  it("sorts multiple papers/* entries among themselves alphabetically", () => {
    const pages = [
      p("papers/b-paper"),
      p("papers/a-paper"),
      p(""),
    ];
    const result = orderNavPages(pages);
    expect(result.map((e) => e.path)).toEqual([
      "",
      "papers/a-paper",
      "papers/b-paper",
    ]);
  });

  it("sorts the rest-bucket alphabetically", () => {
    const pages = [p("zzz"), p("aaa"), p("mmm"), p("")];
    const result = orderNavPages(pages);
    expect(result.map((e) => e.path)).toEqual(["", "aaa", "mmm", "zzz"]);
  });

  it("handles a bare 'papers' path as the papers bucket", () => {
    const pages = [p("papers"), p(""), p("people")];
    const result = orderNavPages(pages);
    expect(result.map((e) => e.path)).toEqual(["", "people", "papers"]);
  });

  it("does not mutate the input array", () => {
    const pages = [p("people"), p(""), p("papers/p1")];
    const copy = [...pages];
    orderNavPages(pages);
    expect(pages).toEqual(copy);
  });

  it("places papers before other non-standard pages", () => {
    const pages = [p("data"), p("methods"), p("papers/fakeyeast-2026"), p(""), p("people")];
    const result = orderNavPages(pages);
    expect(result[0].path).toBe("");
    expect(result[1].path).toBe("people");
    expect(result[2].path).toBe("papers/fakeyeast-2026");
    const rest = result.slice(3).map((e) => e.path).sort();
    expect(rest).toEqual(["data", "methods"]);
  });

  it("handles a single home page", () => {
    const pages = [p("")];
    expect(orderNavPages(pages)).toEqual([{ path: "", title: "Home" }]);
  });

  it("preserves titles", () => {
    const pages = [
      { path: "papers/fakeyeast-2026", title: "FakeYeast 2026, paper companion" },
      { path: "", title: "The Castellanos Lab" },
    ];
    const result = orderNavPages(pages);
    expect(result[0]).toEqual({ path: "", title: "The Castellanos Lab" });
    expect(result[1]).toEqual({ path: "papers/fakeyeast-2026", title: "FakeYeast 2026, paper companion" });
  });
});
