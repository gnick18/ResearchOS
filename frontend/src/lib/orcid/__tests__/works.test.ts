import { describe, it, expect } from "vitest";

import { parseOrcidWorks, orderWorks } from "../works";
import type { OrcidWork } from "../works";

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

  it("collapses a preprint/published pair with the same title, keeping the published one", () => {
    const works = parseOrcidWorks({
      group: [
        {
          "work-summary": [
            {
              "put-code": 10,
              title: { title: { value: "Mining for a New Class of Natural Products" } },
              "journal-title": null,
              type: "preprint",
              "publication-date": { year: { value: "2023" } },
              "external-ids": {
                "external-id": [
                  {
                    "external-id-type": "doi",
                    "external-id-value": "10.1101/2023.04.17.537281",
                    "external-id-normalized": { value: "10.1101/2023.04.17.537281" },
                  },
                ],
              },
            },
          ],
        },
        {
          "work-summary": [
            {
              "put-code": 11,
              title: { title: { value: "Mining for a new class of natural products" } },
              "journal-title": { value: "Nucleic Acids Research" },
              type: "journal-article",
              "publication-date": { year: { value: "2023" } },
              "external-ids": {
                "external-id": [
                  {
                    "external-id-type": "doi",
                    "external-id-value": "10.1093/nar/gkad573",
                    "external-id-normalized": { value: "10.1093/nar/gkad573" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(works).toHaveLength(1);
    expect(works[0].journal).toBe("Nucleic Acids Research");
    expect(works[0].doi).toBe("10.1093/nar/gkad573");
  });

  it("collapses a Correction into its main paper, even with an author prefix", () => {
    const works = parseOrcidWorks({
      group: [
        {
          "work-summary": [
            {
              "put-code": 20,
              title: {
                title: {
                  value: "A Timeline of Biosynthetic Gene Cluster Discovery in Aspergillus fumigatus",
                },
              },
              "journal-title": { value: "Journal of Fungi" },
              "publication-date": { year: { value: "2024" } },
            },
          ],
        },
        {
          "work-summary": [
            {
              "put-code": 21,
              title: {
                title: {
                  value:
                    "Correction: Seo et al. A Timeline of Biosynthetic Gene Cluster Discovery in Aspergillus fumigatus",
                },
              },
              "journal-title": { value: "Journal of Fungi" },
              "publication-date": { year: { value: "2024" } },
            },
          ],
        },
      ],
    });
    expect(works).toHaveLength(1);
    expect(works[0].title).toBe(
      "A Timeline of Biosynthetic Gene Cluster Discovery in Aspergillus fumigatus",
    );
  });

  it("keeps an orphan correction whose main paper is not present", () => {
    const works = parseOrcidWorks({
      group: [
        {
          "work-summary": [
            {
              "put-code": 30,
              title: { title: { value: "Correction: Some Paper We Do Not Otherwise List" } },
              "journal-title": { value: "Journal of Fungi" },
              "publication-date": { year: { value: "2024" } },
            },
          ],
        },
      ],
    });
    expect(works).toHaveLength(1);
  });

  it("returns an empty array for malformed or empty input", () => {
    expect(parseOrcidWorks(null)).toEqual([]);
    expect(parseOrcidWorks(undefined)).toEqual([]);
    expect(parseOrcidWorks("garbage")).toEqual([]);
    expect(parseOrcidWorks({})).toEqual([]);
    expect(parseOrcidWorks({ group: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// orderWorks
// ---------------------------------------------------------------------------

function makeWork(putCode: string, year: string | null = null): OrcidWork {
  return { putCode, title: `Work ${putCode}`, journal: null, year, type: null, doi: null, url: null };
}

describe("orderWorks", () => {
  it("returns year-desc order when pinned and hidden are empty", () => {
    const works = [
      makeWork("1", "2021"),
      makeWork("2", "2023"),
      makeWork("3", "2022"),
    ];
    const result = orderWorks(works, [], []);
    expect(result.map((w) => w.putCode)).toEqual(["2", "3", "1"]);
  });

  it("pinned codes float to the top in pin order", () => {
    const works = [
      makeWork("1", "2023"),
      makeWork("2", "2022"),
      makeWork("3", "2021"),
    ];
    const result = orderWorks(works, ["3", "1"], []);
    // "3" pinned first, then "1" pinned second, then "2" unpinned
    expect(result.map((w) => w.putCode)).toEqual(["3", "1", "2"]);
  });

  it("hidden codes are excluded entirely", () => {
    const works = [
      makeWork("1", "2023"),
      makeWork("2", "2022"),
      makeWork("3", "2021"),
    ];
    const result = orderWorks(works, [], ["2"]);
    expect(result.map((w) => w.putCode)).toEqual(["1", "3"]);
    expect(result.find((w) => w.putCode === "2")).toBeUndefined();
  });

  it("empty pinned and hidden is a no-op (returns same year-desc order)", () => {
    const works = [
      makeWork("a", "2020"),
      makeWork("b", "2024"),
      makeWork("c", "2019"),
    ];
    const result = orderWorks(works, [], []);
    expect(result.map((w) => w.putCode)).toEqual(["b", "a", "c"]);
  });

  it("unpinned works remain year-desc after the pinned block", () => {
    const works = [
      makeWork("10", "2020"),
      makeWork("20", "2022"),
      makeWork("30", "2018"),
      makeWork("40", "2024"),
    ];
    const result = orderWorks(works, ["30"], []);
    // "30" pinned first, then the rest newest-first: "40", "20", "10"
    expect(result.map((w) => w.putCode)).toEqual(["30", "40", "20", "10"]);
  });
});
