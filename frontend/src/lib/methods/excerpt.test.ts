// Method Picker FLAG B (excerpt-field sub-bot of HR): unit coverage for the
// markdown-excerpt derivation that stamps Method.excerpt at save time. The
// helper strips the auto-stamp scaffold + markdown syntax, collapses
// whitespace, and truncates to <= 140 chars on a word boundary.

import { describe, expect, it } from "vitest";
import {
  deriveExcerptFromMarkdown,
  excerptForStructuredType,
  MAX_EXCERPT_LEN,
} from "./excerpt";
import { createNewFileContent } from "@/lib/stamp-utils";
import { getMethodTypeMeta } from "./method-type-registry";

describe("deriveExcerptFromMarkdown", () => {
  it("returns an empty string for empty / nullish bodies", () => {
    expect(deriveExcerptFromMarkdown("")).toBe("");
    expect(deriveExcerptFromMarkdown(null)).toBe("");
    expect(deriveExcerptFromMarkdown(undefined)).toBe("");
    expect(deriveExcerptFromMarkdown("   \n\n  ")).toBe("");
  });

  it("strips the auto-stamp create scaffold and the injected H1, leaving the body", () => {
    // createNewFileContent injects the stamp block + last-access marker + an
    // H1 "# <name>". A scaffold-only file (no user prose) has no real preview.
    const scaffoldOnly = createNewFileContent("PCR Master Mix", "Methods", "method");
    expect(deriveExcerptFromMarkdown(scaffoldOnly)).toBe("");

    // With a body appended after the scaffold (mirrors the create site:
    // `${stampedScaffold}\n${md}`), the excerpt is the body, not the stamp.
    const withBody = `${scaffoldOnly}\nMix 10 uL master mix with 2 uL primer.`;
    const excerpt = deriveExcerptFromMarkdown(withBody);
    expect(excerpt).toBe("Mix 10 uL master mix with 2 uL primer.");
    // None of the stamp metadata leaks through.
    expect(excerpt).not.toContain("experiment:");
    expect(excerpt).not.toContain("project folder:");
    expect(excerpt).not.toContain("stamp");
    expect(excerpt).not.toContain("PCR Master Mix");
  });

  it("strips markdown syntax (headings, bullets, emphasis, links, code)", () => {
    const body = [
      "## Reagents",
      "- **Buffer** at `10 mM`",
      "1. Add [primer](http://example.com)",
      "> note: keep on ice",
    ].join("\n");
    const excerpt = deriveExcerptFromMarkdown(body);
    expect(excerpt).toBe("Reagents Buffer at 10 mM Add primer note: keep on ice");
    expect(excerpt).not.toMatch(/[#*`>]/);
    expect(excerpt).not.toContain("http");
    expect(excerpt).not.toContain("](");
  });

  it("collapses whitespace and drops horizontal rules + blank lines", () => {
    const body = "First line\n\n\n___\n\n   Second    line   ";
    expect(deriveExcerptFromMarkdown(body)).toBe("First line Second line");
  });

  it("truncates a long body to <= 140 chars on a word boundary with an ellipsis", () => {
    const word = "lorem";
    const longBody = Array.from({ length: 60 }, () => word).join(" ");
    const excerpt = deriveExcerptFromMarkdown(longBody);
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LEN + 1); // +1 for the ellipsis char
    expect(excerpt.endsWith("…")).toBe(true);
    // Word-boundary cut: no partial trailing token before the ellipsis.
    const beforeEllipsis = excerpt.slice(0, -1).trimEnd();
    expect(beforeEllipsis.endsWith(word)).toBe(true);
  });

  it("does not truncate or add an ellipsis for a body at/under the cap", () => {
    const body = "Short protocol body well under the limit.";
    const excerpt = deriveExcerptFromMarkdown(body);
    expect(excerpt).toBe(body);
    expect(excerpt.endsWith("…")).toBe(false);
  });

  it("hard-cuts a single mega-token with no break point", () => {
    const mega = "x".repeat(300);
    const excerpt = deriveExcerptFromMarkdown(mega);
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LEN + 1);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("excerptForStructuredType", () => {
  it("returns the type-registry one-line description for a structured type", () => {
    expect(excerptForStructuredType("pcr")).toBe(
      getMethodTypeMeta("pcr").description,
    );
    expect(excerptForStructuredType("plate")).toBe(
      getMethodTypeMeta("plate").description,
    );
  });

  it("truncates a long registry description to the cap (qpcr_analysis)", () => {
    const excerpt = excerptForStructuredType("qpcr_analysis");
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LEN + 1);
    // The qPCR description is longer than the cap, so it ends with an ellipsis.
    const full = getMethodTypeMeta("qpcr_analysis").description ?? "";
    if (full.length > MAX_EXCERPT_LEN) {
      expect(excerpt.endsWith("…")).toBe(true);
    }
  });
});
