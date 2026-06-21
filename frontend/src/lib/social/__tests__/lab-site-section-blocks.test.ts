// Unit tests for the P3 section block kinds in lab-site-blocks.ts.
//
// Covers: parse/serialize round-trips for each section kind, defensive
// handling of malformed/missing fields, isSectionBlockKind guard, and the
// makeHomepageSectionTemplate helper. All tests are pure (no DB, no browser).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  parseLabSiteBlocks,
  serializeLabSiteBlocks,
  isSectionBlockKind,
  makeHomepageSectionTemplate,
  type HeroSectionBlock,
  type AboutSectionBlock,
  type TeamSectionBlock,
  type PublicationsSectionBlock,
  type ContactSectionBlock,
  type SectionBlock,
} from "../lab-site-blocks";

// ---------------------------------------------------------------------------
// isSectionBlockKind
// ---------------------------------------------------------------------------

describe("isSectionBlockKind", () => {
  it("identifies all section kinds", () => {
    expect(isSectionBlockKind("section-hero")).toBe(true);
    expect(isSectionBlockKind("section-about")).toBe(true);
    expect(isSectionBlockKind("section-team")).toBe(true);
    expect(isSectionBlockKind("section-publications")).toBe(true);
    expect(isSectionBlockKind("section-contact")).toBe(true);
  });

  it("rejects non-section kinds", () => {
    expect(isSectionBlockKind("heading")).toBe(false);
    expect(isSectionBlockKind("text")).toBe(false);
    expect(isSectionBlockKind("two-column")).toBe(false);
    expect(isSectionBlockKind("figure")).toBe(false);
    expect(isSectionBlockKind("unknown")).toBe(false);
    expect(isSectionBlockKind("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// section-hero parse
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: section-hero", () => {
  it("parses a full hero block", () => {
    const raw = [
      {
        id: "hero1",
        kind: "section-hero",
        props: {
          labName: "Smith Lab",
          tagline: "Decoding genomes.",
          coverImageUrl: "https://example.com/cover.jpg",
          ctaLabel: "Join us",
          ctaUrl: "https://example.com/join",
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as HeroSectionBlock;
    expect(block.kind).toBe("section-hero");
    expect(block.id).toBe("hero1");
    expect(block.props.labName).toBe("Smith Lab");
    expect(block.props.tagline).toBe("Decoding genomes.");
    expect(block.props.coverImageUrl).toBe("https://example.com/cover.jpg");
    expect(block.props.ctaLabel).toBe("Join us");
    expect(block.props.ctaUrl).toBe("https://example.com/join");
  });

  it("collapses missing fields to empty strings", () => {
    const raw = [{ id: "hero1", kind: "section-hero", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeroSectionBlock;
    expect(block.props.labName).toBe("");
    expect(block.props.tagline).toBe("");
    expect(block.props.coverImageUrl).toBe("");
    expect(block.props.ctaLabel).toBe("");
    expect(block.props.ctaUrl).toBe("");
  });

  it("collapses missing props object to empty strings", () => {
    const raw = [{ id: "hero1", kind: "section-hero" }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeroSectionBlock;
    expect(block.kind).toBe("section-hero");
    expect(block.props.labName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// section-about parse
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: section-about", () => {
  it("parses a full about block", () => {
    const raw = [
      {
        id: "about1",
        kind: "section-about",
        props: {
          heading: "About the lab",
          body: "We study fungi.",
          imageUrl: "https://example.com/lab.jpg",
          imageAlt: "Lab photo",
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as AboutSectionBlock;
    expect(block.kind).toBe("section-about");
    expect(block.props.heading).toBe("About the lab");
    expect(block.props.body).toBe("We study fungi.");
    expect(block.props.imageUrl).toBe("https://example.com/lab.jpg");
    expect(block.props.imageAlt).toBe("Lab photo");
  });

  it("collapses missing fields to empty strings", () => {
    const raw = [{ id: "a1", kind: "section-about", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as AboutSectionBlock;
    expect(block.props.heading).toBe("");
    expect(block.props.body).toBe("");
    expect(block.props.imageUrl).toBe("");
    expect(block.props.imageAlt).toBe("");
  });
});

// ---------------------------------------------------------------------------
// section-team parse
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: section-team", () => {
  it("parses a team block with members", () => {
    const raw = [
      {
        id: "team1",
        kind: "section-team",
        props: {
          heading: "Our team",
          members: [
            {
              id: "m1",
              name: "Dr. Jane Smith",
              role: "PI",
              photoUrl: "https://example.com/jane.jpg",
              bio: "Studies mycology.",
            },
            {
              id: "m2",
              name: "Alex Lee",
              role: "PhD student",
              photoUrl: "",
              bio: "",
            },
          ],
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as TeamSectionBlock;
    expect(block.kind).toBe("section-team");
    expect(block.props.heading).toBe("Our team");
    expect(block.props.members).toHaveLength(2);
    expect(block.props.members[0].name).toBe("Dr. Jane Smith");
    expect(block.props.members[0].role).toBe("PI");
    expect(block.props.members[0].photoUrl).toBe("https://example.com/jane.jpg");
    expect(block.props.members[0].bio).toBe("Studies mycology.");
    expect(block.props.members[1].name).toBe("Alex Lee");
  });

  it("treats missing members array as empty", () => {
    const raw = [{ id: "t1", kind: "section-team", props: { heading: "Team" } }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TeamSectionBlock;
    expect(block.props.members).toEqual([]);
  });

  it("collapses a malformed member entry to empty strings", () => {
    const raw = [
      {
        id: "t1",
        kind: "section-team",
        props: {
          heading: "",
          members: [null, 42, "string", { id: "m1", name: "Valid" }],
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TeamSectionBlock;
    // Malformed entries collapse to empty-string defaults, they are NOT dropped.
    expect(block.props.members).toHaveLength(4);
    // The valid member keeps its name.
    expect(block.props.members[3].name).toBe("Valid");
    // Malformed entries collapse to empty strings.
    expect(block.props.members[0].name).toBe("");
    expect(block.props.members[1].name).toBe("");
    expect(block.props.members[2].name).toBe("");
  });

  it("generates a fallback id for members missing an id field", () => {
    const raw = [
      {
        id: "t1",
        kind: "section-team",
        props: {
          heading: "",
          members: [{ name: "No id member" }],
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TeamSectionBlock;
    expect(block.props.members[0].id.length).toBeGreaterThan(0);
    expect(block.props.members[0].name).toBe("No id member");
  });
});

// ---------------------------------------------------------------------------
// section-publications parse
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: section-publications", () => {
  it("parses a publications block with entries", () => {
    const raw = [
      {
        id: "pub1",
        kind: "section-publications",
        props: {
          heading: "Selected publications",
          publications: [
            {
              id: "p1",
              citation: "Smith et al. 2024, Nature.",
              url: "https://doi.org/10.1000/xyz",
              badge: "New",
            },
          ],
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as PublicationsSectionBlock;
    expect(block.kind).toBe("section-publications");
    expect(block.props.heading).toBe("Selected publications");
    expect(block.props.publications).toHaveLength(1);
    expect(block.props.publications[0].citation).toBe("Smith et al. 2024, Nature.");
    expect(block.props.publications[0].url).toBe("https://doi.org/10.1000/xyz");
    expect(block.props.publications[0].badge).toBe("New");
  });

  it("treats missing publications array as empty", () => {
    const raw = [{ id: "pub1", kind: "section-publications", props: { heading: "" } }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as PublicationsSectionBlock;
    expect(block.props.publications).toEqual([]);
  });

  it("collapses missing publication fields to empty strings", () => {
    const raw = [
      {
        id: "pub1",
        kind: "section-publications",
        props: { heading: "", publications: [{ id: "p1" }] },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as PublicationsSectionBlock;
    expect(block.props.publications[0].citation).toBe("");
    expect(block.props.publications[0].url).toBe("");
    expect(block.props.publications[0].badge).toBe("");
  });
});

// ---------------------------------------------------------------------------
// section-contact parse
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: section-contact", () => {
  it("parses a full contact block", () => {
    const raw = [
      {
        id: "contact1",
        kind: "section-contact",
        props: {
          heading: "Contact",
          address: "123 Main St\nMadison, WI",
          email: "pi@lab.edu",
          linkLabel: "Apply",
          linkUrl: "https://example.com/apply",
        },
      },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as ContactSectionBlock;
    expect(block.kind).toBe("section-contact");
    expect(block.props.heading).toBe("Contact");
    expect(block.props.address).toBe("123 Main St\nMadison, WI");
    expect(block.props.email).toBe("pi@lab.edu");
    expect(block.props.linkLabel).toBe("Apply");
    expect(block.props.linkUrl).toBe("https://example.com/apply");
  });

  it("collapses missing fields to empty strings", () => {
    const raw = [{ id: "c1", kind: "section-contact", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as ContactSectionBlock;
    expect(block.props.heading).toBe("");
    expect(block.props.address).toBe("");
    expect(block.props.email).toBe("");
    expect(block.props.linkLabel).toBe("");
    expect(block.props.linkUrl).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize then parse for each section kind
// ---------------------------------------------------------------------------

describe("round-trip: section blocks serialize then parse", () => {
  it("round-trips a hero block", () => {
    const block: HeroSectionBlock = {
      id: "h1",
      kind: "section-hero",
      props: {
        labName: "Smith Lab",
        tagline: "Science forward.",
        coverImageUrl: "https://example.com/img.jpg",
        ctaLabel: "Join",
        ctaUrl: "https://example.com/join",
      },
    };
    const json = serializeLabSiteBlocks([block]);
    expect(typeof json).toBe("string");
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual([block]);
  });

  it("round-trips a team block with members", () => {
    const block: TeamSectionBlock = {
      id: "t1",
      kind: "section-team",
      props: {
        heading: "Team",
        members: [
          { id: "m1", name: "Alice", role: "PI", photoUrl: "", bio: "Fungal research." },
          { id: "m2", name: "Bob", role: "Postdoc", photoUrl: "https://x.com/p.jpg", bio: "" },
        ],
      },
    };
    const json = serializeLabSiteBlocks([block]);
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual([block]);
  });

  it("round-trips a publications block", () => {
    const block: PublicationsSectionBlock = {
      id: "pub1",
      kind: "section-publications",
      props: {
        heading: "Publications",
        publications: [
          { id: "p1", citation: "Smith et al. 2024.", url: "https://doi.org/x", badge: "New" },
          { id: "p2", citation: "Lee et al. 2023.", url: "", badge: "" },
        ],
      },
    };
    const json = serializeLabSiteBlocks([block]);
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual([block]);
  });

  it("round-trips a full template", () => {
    const template = makeHomepageSectionTemplate("smithlab");
    const json = serializeLabSiteBlocks(template);
    expect(typeof json).toBe("string");
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual(template);
  });

  it("unknown section kinds are dropped during parse", () => {
    const raw = [
      { id: "s1", kind: "section-video", props: { url: "https://youtube.com/x" } },
      { id: "s2", kind: "section-hero", props: { labName: "Kept", tagline: "", coverImageUrl: "", ctaLabel: "", ctaUrl: "" } },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("section-hero");
  });
});

// ---------------------------------------------------------------------------
// makeHomepageSectionTemplate
// ---------------------------------------------------------------------------

describe("makeHomepageSectionTemplate", () => {
  it("returns a non-empty array of section blocks", () => {
    const template = makeHomepageSectionTemplate();
    expect(template.length).toBeGreaterThan(0);
    for (const block of template) {
      expect(isSectionBlockKind(block.kind)).toBe(true);
    }
  });

  it("always includes hero, about, team, publications, contact", () => {
    const template = makeHomepageSectionTemplate();
    const kinds = template.map((b) => b.kind);
    expect(kinds).toContain("section-hero");
    expect(kinds).toContain("section-about");
    expect(kinds).toContain("section-team");
    expect(kinds).toContain("section-publications");
    expect(kinds).toContain("section-contact");
  });

  it("pre-fills the hero lab name when provided", () => {
    const template = makeHomepageSectionTemplate("smithlab");
    const hero = template.find((b) => b.kind === "section-hero") as HeroSectionBlock;
    expect(hero.props.labName).toBe("smithlab");
  });

  it("defaults lab name to 'Our Lab' when not provided", () => {
    const template = makeHomepageSectionTemplate();
    const hero = template.find((b) => b.kind === "section-hero") as HeroSectionBlock;
    expect(hero.props.labName).toBe("Our Lab");
  });

  it("all block ids are non-empty strings", () => {
    const template = makeHomepageSectionTemplate();
    for (const block of template) {
      expect(typeof block.id).toBe("string");
      expect(block.id.length).toBeGreaterThan(0);
    }
  });

  it("team section starts with at least one member placeholder", () => {
    const template = makeHomepageSectionTemplate();
    const team = template.find((b) => b.kind === "section-team") as TeamSectionBlock;
    expect(team.props.members.length).toBeGreaterThan(0);
  });

  it("publications section starts with at least one placeholder entry", () => {
    const template = makeHomepageSectionTemplate();
    const pubs = template.find(
      (b) => b.kind === "section-publications",
    ) as PublicationsSectionBlock;
    expect(pubs.props.publications.length).toBeGreaterThan(0);
  });

  it("round-trips cleanly through serialize/parse", () => {
    const template = makeHomepageSectionTemplate("fungilab");
    const json = serializeLabSiteBlocks(template);
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual(template);
  });
});

// ---------------------------------------------------------------------------
// Mixed-kind page: section blocks coexist with canvas blocks
// ---------------------------------------------------------------------------

describe("mixed section + canvas blocks in one page", () => {
  it("parses a page with both canvas and section blocks", () => {
    const raw = [
      { id: "hero1", kind: "section-hero", props: { labName: "Lab", tagline: "", coverImageUrl: "", ctaLabel: "", ctaUrl: "" } },
      { id: "h1", kind: "heading", props: { text: "Supplement", level: 2 } },
      { id: "fig1", kind: "figure", props: { sourceId: "abc", caption: "", width: "column" } },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("section-hero");
    expect(result[1].kind).toBe("heading");
    expect(result[2].kind).toBe("figure");
  });

  it("round-trips a mixed page", () => {
    const raw: Parameters<typeof serializeLabSiteBlocks>[0] = [
      { id: "hero1", kind: "section-hero", props: { labName: "Lab", tagline: "T", coverImageUrl: "", ctaLabel: "", ctaUrl: "" } } as SectionBlock,
      { id: "h1", kind: "heading", props: { text: "Notes", level: 2 } },
    ];
    const json = serializeLabSiteBlocks(raw);
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual(raw);
  });
});
