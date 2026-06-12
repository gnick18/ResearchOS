// Unit tests for BeakerBot search_literature (BeakerAI lane, 2026-06-12).
//
// Test strategy:
//   - Pure-logic tests (parseSearchLiteratureArgs, firstAuthorEtAl, paperToHit)
//     run with no I/O.
//   - Wiring tests mock europePmcPapers from chemistry/literature.ts (the only
//     dep) and assert the tool passes the right pageSize, maps the result to the
//     compact hit shape, applies the reviews-only filter and the limit, and never
//     throws on the empty / network-error path.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/chemistry/literature", () => ({
  europePmcPapers: vi.fn(),
  // europePmcArticleUrl is referenced by the Paper.url field we build in fixtures,
  // not imported by the tool itself, but stub it so the module mock is complete.
  europePmcArticleUrl: (source: string, id: string) =>
    `https://europepmc.org/article/${source}/${id}`,
}));

import { europePmcPapers, type Paper } from "@/lib/chemistry/literature";
import {
  searchLiteratureTool,
  firstAuthorEtAl,
  paperToHit,
  parseSearchLiteratureArgs,
  type SearchLiteratureResult,
} from "./search-literature";
import { toToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    title: "Programmable editing of a target base in genomic DNA",
    authors: "Komor AC, Kim YB, Packer MS, Zuranski JA, Liu DR",
    journal: "Nature",
    year: "2016",
    citedBy: 4000,
    source: "MED",
    id: "27096365",
    doi: "10.1038/nature17946",
    url: "https://europepmc.org/article/MED/27096365",
    pubType: "Journal Article",
    isReview: false,
    ...overrides,
  };
}

const run = (args: Record<string, unknown>) =>
  searchLiteratureTool.execute(args) as Promise<SearchLiteratureResult>;

beforeEach(() => {
  vi.mocked(europePmcPapers).mockReset();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("firstAuthorEtAl", () => {
  it("appends et al when there is more than one author", () => {
    expect(firstAuthorEtAl("Komor AC, Kim YB, Liu DR")).toBe("Komor AC et al");
  });

  it("returns a single author as-is", () => {
    expect(firstAuthorEtAl("Komor AC")).toBe("Komor AC");
  });

  it("returns an empty string for no authors", () => {
    expect(firstAuthorEtAl("")).toBe("");
    expect(firstAuthorEtAl("   ")).toBe("");
  });
});

describe("paperToHit", () => {
  it("maps a Paper to the compact hit shape", () => {
    const hit = paperToHit(makePaper());
    expect(hit).toEqual({
      title: "Programmable editing of a target base in genomic DNA",
      authors: "Komor AC et al",
      year: "2016",
      doi: "10.1038/nature17946",
      url: "https://europepmc.org/article/MED/27096365",
      isReview: false,
    });
  });
});

describe("parseSearchLiteratureArgs", () => {
  it("trims the query and defaults the limit to 8", () => {
    expect(parseSearchLiteratureArgs({ query: "  CRISPR  " })).toEqual({
      query: "CRISPR",
      limit: 8,
      reviewsOnly: false,
    });
  });

  it("caps the limit at 20 and floors a fractional limit", () => {
    expect(parseSearchLiteratureArgs({ query: "x", limit: 99 }).limit).toBe(20);
    expect(parseSearchLiteratureArgs({ query: "x", limit: 5.7 }).limit).toBe(5);
  });

  it("treats a non-positive or non-number limit as the default", () => {
    expect(parseSearchLiteratureArgs({ query: "x", limit: 0 }).limit).toBe(8);
    expect(parseSearchLiteratureArgs({ query: "x", limit: -3 }).limit).toBe(8);
    expect(parseSearchLiteratureArgs({ query: "x", limit: "many" }).limit).toBe(8);
  });

  it("reads reviewsOnly only when strictly true", () => {
    expect(parseSearchLiteratureArgs({ query: "x", reviewsOnly: true }).reviewsOnly).toBe(true);
    expect(parseSearchLiteratureArgs({ query: "x", reviewsOnly: "yes" }).reviewsOnly).toBe(false);
    expect(parseSearchLiteratureArgs({ query: "x" }).reviewsOnly).toBe(false);
  });

  it("yields an empty query when query is missing or not a string", () => {
    expect(parseSearchLiteratureArgs({}).query).toBe("");
    expect(parseSearchLiteratureArgs({ query: 42 }).query).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Tool wiring
// ---------------------------------------------------------------------------

describe("searchLiteratureTool metadata", () => {
  it("is read-only (no action flag) and exposes a query-required schema", () => {
    expect(searchLiteratureTool.name).toBe("search_literature");
    expect(searchLiteratureTool.action).toBeUndefined();
    expect(searchLiteratureTool.previewable).toBeUndefined();
    const def = toToolDefinition(searchLiteratureTool);
    expect(def.function.parameters.required).toEqual(["query"]);
    expect(def.function.parameters.additionalProperties).toBe(false);
  });
});

describe("searchLiteratureTool execute", () => {
  it("calls europePmcPapers with the query and the default pageSize, returns compact hits", async () => {
    vi.mocked(europePmcPapers).mockResolvedValue({
      hitCount: 1,
      papers: [makePaper()],
    });

    const result = await run({ query: "base editing" });

    expect(europePmcPapers).toHaveBeenCalledWith("base editing", 8);
    expect(result.count).toBe(1);
    expect(result.hits[0]).toEqual({
      title: "Programmable editing of a target base in genomic DNA",
      authors: "Komor AC et al",
      year: "2016",
      doi: "10.1038/nature17946",
      url: "https://europepmc.org/article/MED/27096365",
      isReview: false,
    });
    expect(result.message).toBeUndefined();
  });

  it("caps the returned hits at the limit", async () => {
    const papers = Array.from({ length: 10 }, (_, i) =>
      makePaper({ id: String(i), doi: `10.0/${i}` }),
    );
    vi.mocked(europePmcPapers).mockResolvedValue({ hitCount: 10, papers });

    const result = await run({ query: "crispr", limit: 3 });

    expect(europePmcPapers).toHaveBeenCalledWith("crispr", 3);
    expect(result.count).toBe(3);
    expect(result.hits).toHaveLength(3);
  });

  it("filters to reviews when reviewsOnly is set and over-fetches to fill the limit", async () => {
    const papers = [
      makePaper({ id: "a", isReview: false }),
      makePaper({ id: "b", isReview: true, title: "A review of base editors" }),
      makePaper({ id: "c", isReview: false }),
    ];
    vi.mocked(europePmcPapers).mockResolvedValue({ hitCount: 3, papers });

    const result = await run({ query: "base editing", limit: 8, reviewsOnly: true });

    // Over-fetch: pageSize is limit * 3 (capped) so the client-side review filter
    // still has candidates to fill the limit.
    expect(europePmcPapers).toHaveBeenCalledWith("base editing", 24);
    expect(result.count).toBe(1);
    expect(result.hits[0].isReview).toBe(true);
    expect(result.hits[0].title).toBe("A review of base editors");
  });

  it("returns a clean empty result with a message when nothing matches", async () => {
    vi.mocked(europePmcPapers).mockResolvedValue({ hitCount: 0, papers: [] });

    const result = await run({ query: "asdfqwerty" });

    expect(result.count).toBe(0);
    expect(result.hits).toEqual([]);
    expect(result.message).toMatch(/no papers matched/i);
  });

  it("returns a reviews-specific empty message when no reviews match", async () => {
    vi.mocked(europePmcPapers).mockResolvedValue({
      hitCount: 1,
      papers: [makePaper({ isReview: false })],
    });

    const result = await run({ query: "x", reviewsOnly: true });

    expect(result.count).toBe(0);
    expect(result.message).toMatch(/no review articles/i);
  });

  it("short-circuits an empty query without calling the network", async () => {
    const result = await run({ query: "   " });

    expect(europePmcPapers).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
    expect(result.message).toMatch(/no search terms/i);
  });

  it("never throws when the network call rejects, relays an error message", async () => {
    vi.mocked(europePmcPapers).mockRejectedValue(new Error("network down"));

    const result = await run({ query: "crispr" });

    expect(result.count).toBe(0);
    expect(result.hits).toEqual([]);
    expect(result.message).toMatch(/could not reach europe pmc/i);
  });
});
