// frontend/src/lib/wiki/__tests__/search.test.ts
//
// Unit tests for the wiki search ranking + snippet helpers. Three concerns:
//
//   1. Title matches outrank heading matches, which outrank body matches.
//   2. Results group by category in the order the index declares categories.
//   3. Snippet builder produces a sensible window around the match offset.
//
// These run under the node-env vitest project (see vitest.config.mts).
//
// We also smoke-test against the real prebuilt index when it exists, so a
// regression in the actual generated index surfaces here. The smoke test
// no-ops gracefully when the index hasn't been built yet (e.g. on a fresh
// clone before `npm run wiki:search-index`).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSnippet,
  searchWikiIndex,
  type WikiSearchIndex,
} from "../search";

const fixture: WikiSearchIndex = {
  generatedAt: "2026-05-25T00:00:00Z",
  pageCount: 4,
  categories: [
    { id: "getting-started", label: "Getting Started" },
    { id: "features", label: "Features" },
    { id: "integrations", label: "Integrations" },
  ],
  entries: [
    {
      href: "/wiki/features/lab-head",
      title: "Lab Head",
      breadcrumbs: ["Features", "Lab Head"],
      categoryId: "features",
      headings: ["What a Lab Head actually is", "Soft-write actions"],
      bodySnippets: [
        "A Lab Head is a per-user role with the lab_head account type.",
        "Picker badge and sort-to-top so the PI is easy to find.",
      ],
    },
    {
      href: "/wiki/features/purchases",
      title: "Purchases & Funding",
      breadcrumbs: ["Features", "Purchases & Funding"],
      categoryId: "features",
      headings: ["Tracking purchases", "Funding accounts"],
      bodySnippets: [
        "Track buys against lab-wide funding accounts.",
        "Lab Head approval flow runs through the soft-write queue.",
      ],
    },
    {
      href: "/wiki/getting-started/connecting-your-folder",
      title: "Connecting Your Folder",
      breadcrumbs: ["Getting Started", "Connecting Your Folder"],
      categoryId: "getting-started",
      headings: ["Pick a folder", "What gets written"],
      bodySnippets: [
        "Use the folder picker to grant ResearchOS access to your folder.",
      ],
    },
    {
      href: "/wiki/integrations/telegram",
      title: "Telegram Bot",
      breadcrumbs: ["Integrations", "Telegram Bot"],
      categoryId: "integrations",
      headings: ["Pair the bot", "Token storage"],
      bodySnippets: ["Send phone photos straight into your inbox."],
    },
  ],
};

describe("searchWikiIndex ranking", () => {
  it("returns no results for queries under 2 chars", () => {
    expect(searchWikiIndex(fixture, "")).toEqual([]);
    expect(searchWikiIndex(fixture, "a")).toEqual([]);
  });

  it("ranks title matches above heading and body matches", () => {
    // 'lab head' matches Lab Head's title and Purchases' body. Title wins.
    const groups = searchWikiIndex(fixture, "lab head");
    const flat = groups.flatMap((g) => g.hits);
    expect(flat[0].entry.href).toBe("/wiki/features/lab-head");
    expect(flat[0].match.kind).toBe("title");

    // 'lab head' also matches the body of Purchases. It should appear but
    // rank lower than the title match.
    const purchasesHit = flat.find((h) => h.entry.href === "/wiki/features/purchases");
    expect(purchasesHit).toBeDefined();
    expect(purchasesHit!.score).toBeLessThan(flat[0].score);
  });

  it("ranks heading matches above body-only matches", () => {
    // 'soft-write' matches Lab Head's heading and Purchases' body. Heading wins.
    const groups = searchWikiIndex(fixture, "soft-write");
    const flat = groups.flatMap((g) => g.hits);
    const labHead = flat.find((h) => h.entry.href === "/wiki/features/lab-head")!;
    const purchases = flat.find((h) => h.entry.href === "/wiki/features/purchases")!;
    expect(labHead.match.kind).toBe("heading");
    expect(purchases.match.kind).toBe("body");
    expect(labHead.score).toBeGreaterThan(purchases.score);
  });

  it("groups hits by category in the order declared by the index", () => {
    // Both 'features' and 'getting-started' categories should match 'folder'
    // (well, just getting-started in this fixture).
    const groups = searchWikiIndex(fixture, "folder");
    expect(groups).toHaveLength(1);
    expect(groups[0].category.id).toBe("getting-started");

    // A broader query that hits both: 'lab' is in Lab Head + Purchases body.
    const broadGroups = searchWikiIndex(fixture, "lab");
    const ids = broadGroups.map((g) => g.category.id);
    // 'features' is declared before 'integrations' in the fixture, so it
    // should come first in the grouped output.
    expect(ids[0]).toBe("features");
  });

  it("caps result count at maxResults", () => {
    const groups = searchWikiIndex(fixture, "a", 2); // 'a' is short so returns []
    expect(groups).toEqual([]);
    // Use a longer common substring that hits every entry.
    const groups2 = searchWikiIndex(fixture, "the", 2);
    const flat = groups2.flatMap((g) => g.hits);
    expect(flat.length).toBeLessThanOrEqual(2);
  });

  it("returns no results when the query matches nothing", () => {
    const groups = searchWikiIndex(fixture, "xyzzy-nothing-here");
    expect(groups).toEqual([]);
  });

  it("is case-insensitive", () => {
    const lower = searchWikiIndex(fixture, "lab head");
    const upper = searchWikiIndex(fixture, "LAB HEAD");
    expect(upper.flatMap((g) => g.hits)[0].entry.href).toBe(
      lower.flatMap((g) => g.hits)[0].entry.href,
    );
  });
});

describe("buildSnippet", () => {
  it("returns the full title for title matches", () => {
    const groups = searchWikiIndex(fixture, "lab head");
    const hit = groups.flatMap((g) => g.hits).find((h) => h.match.kind === "title")!;
    const snippet = buildSnippet(hit);
    expect(snippet.text).toBe("Lab Head");
  });

  it("surrounds heading matches with context but doesn't truncate short headings", () => {
    const groups = searchWikiIndex(fixture, "soft-write");
    const hit = groups
      .flatMap((g) => g.hits)
      .find((h) => h.match.kind === "heading")!;
    const snippet = buildSnippet(hit);
    expect(snippet.text).toContain("Soft-write");
    expect(snippet.offset).toBeGreaterThanOrEqual(0);
  });

  it("truncates long body snippets with ... markers and highlights the match", () => {
    const groups = searchWikiIndex(fixture, "approval");
    const hit = groups.flatMap((g) => g.hits)[0];
    const snippet = buildSnippet(hit, 10);
    // Snippet should contain the match and end with the truncation marker.
    expect(snippet.text).toContain("approval");
    expect(snippet.text.endsWith("...")).toBe(true);
    // matchLength should be the query length (8 = 'approval'), not the
    // whole body length — that was the buildSnippet bug we fixed.
    expect(snippet.matchLength).toBe(8);
    // The offset points at where 'approval' starts inside the snippet.
    expect(
      snippet.text.slice(snippet.offset, snippet.offset + snippet.matchLength),
    ).toBe("approval");
  });
});

// Smoke test against the real generated index — only runs if the prebuild
// step has emitted the JSON file. Catches regressions in the actual build
// pipeline (not just the synthetic fixture).
describe("real prebuilt wiki search index (smoke)", () => {
  const indexPath = path.join(
    process.cwd(),
    "public",
    "wiki-search-index.json",
  );
  const hasIndex = existsSync(indexPath);
  const it_ = hasIndex ? it : it.skip;

  it_("loads and is queryable for a known term", () => {
    const data = JSON.parse(readFileSync(indexPath, "utf8")) as WikiSearchIndex;
    expect(data.pageCount).toBeGreaterThan(10);
    expect(data.categories.length).toBeGreaterThan(2);
    // Every wiki has a Calendar page; its title match should be the highest-
    // scoring hit. (Groups are emitted in category order, so the top
    // *score* may sit in a later group than the first.)
    const groups = searchWikiIndex(data, "calendar");
    const allHits = groups.flatMap((g) => g.hits);
    expect(allHits.length).toBeGreaterThan(0);
    const topByScore = allHits.reduce((a, b) => (a.score >= b.score ? a : b));
    expect(topByScore.entry.title.toLowerCase()).toContain("calendar");
    expect(topByScore.match.kind).toBe("title");
  });
});
