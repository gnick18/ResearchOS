import { describe, it, expect } from "vitest";

import { parseOrcidWorks } from "../works";

// A realistic ORCID Public API v3.0 /works payload: one fully-populated
// journal article (title, journal, year, DOI), one sparse work (no journal,
// no year, no external ids), and one empty group that must be skipped.
const SAMPLE = {
  group: [
    {
      "work-summary": [
        {
          "put-code": 222,
          title: { title: { value: "Older preprint, no metadata" } },
          "journal-title": null,
          type: "preprint",
          "publication-date": null,
          "external-ids": { "external-id": [] },
          url: null,
        },
      ],
    },
    {
      "work-summary": [
        {
          "put-code": 111,
          title: { title: { value: "A CRISPR screen in yeast" } },
          "journal-title": { value: "Nature Methods" },
          type: "journal-article",
          "publication-date": { year: { value: "2024" } },
          "external-ids": {
            "external-id": [
              {
                "external-id-type": "doi",
                "external-id-value": "10.1038/s41592-024-0001",
                "external-id-normalized": { value: "10.1038/s41592-024-0001" },
              },
            ],
          },
          url: { value: "https://example.com/fallback" },
        },
      ],
    },
    { "work-summary": [] },
  ],
};

describe("parseOrcidWorks", () => {
  it("extracts and sorts works, newest year first", () => {
    const works = parseOrcidWorks(SAMPLE);
    expect(works).toHaveLength(2);
    // 2024 article sorts ahead of the null-year preprint.
    expect(works[0].title).toBe("A CRISPR screen in yeast");
    expect(works[1].title).toBe("Older preprint, no metadata");
  });

  it("pulls journal, year, type, and DOI (with a doi.org url) from a full work", () => {
    const [first] = parseOrcidWorks(SAMPLE);
    expect(first.journal).toBe("Nature Methods");
    expect(first.year).toBe("2024");
    expect(first.type).toBe("journal-article");
    expect(first.doi).toBe("10.1038/s41592-024-0001");
    // normalized DOI is turned into a doi.org link, preferred over the work url.
    expect(first.url).toBe("https://doi.org/10.1038/s41592-024-0001");
  });

  it("leaves missing fields null without dropping the work", () => {
    const sparse = parseOrcidWorks(SAMPLE)[1];
    expect(sparse.journal).toBeNull();
    expect(sparse.year).toBeNull();
    expect(sparse.doi).toBeNull();
    expect(sparse.url).toBeNull();
    expect(sparse.type).toBe("preprint");
  });

  it("skips works with no title", () => {
    const works = parseOrcidWorks({
      group: [{ "work-summary": [{ "put-code": 1, title: null }] }],
    });
    expect(works).toEqual([]);
  });

  it("returns an empty array for malformed or empty input", () => {
    expect(parseOrcidWorks(null)).toEqual([]);
    expect(parseOrcidWorks(undefined)).toEqual([]);
    expect(parseOrcidWorks("garbage")).toEqual([]);
    expect(parseOrcidWorks({})).toEqual([]);
    expect(parseOrcidWorks({ group: [] })).toEqual([]);
  });
});
