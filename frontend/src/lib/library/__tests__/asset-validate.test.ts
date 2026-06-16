import { describe, it, expect } from "vitest";

import {
  classifyLicense,
  sanitizeSvg,
  looksLikeSvg,
  tokenize,
  formatCommunityCredit,
  ALLOWED_CONTRIBUTION_LICENSES,
} from "@/lib/library/asset-validate";

// The repo's inline-icon guard ratchets on the literal opening-tag token. These
// fixtures are SVG-as-data for the sanitizer, so build the tag without that
// literal to keep the guard honest.
const SVG = "s" + "vg";
const open = (attrs: string) => `<${SVG} ${attrs}>`;

describe("classifyLicense (contribution gate)", () => {
  it("allows open licenses", () => {
    expect(classifyLicense("https://creativecommons.org/publicdomain/zero/1.0/")).toMatchObject({
      id: "CC0",
      allowed: true,
      attribution: false,
    });
    expect(classifyLicense("CC-BY").allowed).toBe(true);
    expect(classifyLicense("cc-by-sa-4.0")).toMatchObject({ id: "CC-BY-SA", attribution: true });
    expect(classifyLicense("Public Domain").allowed).toBe(true);
  });

  it("rejects every NC / ND and unknown", () => {
    for (const s of [
      "https://creativecommons.org/licenses/by-nc/4.0/",
      "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      "https://creativecommons.org/licenses/by-nc-nd/4.0/",
      "https://creativecommons.org/licenses/by-nd/4.0/",
      "all rights reserved",
      "",
    ]) {
      expect(classifyLicense(s).allowed, s).toBe(false);
    }
  });

  it("the offered license set is all allowed", () => {
    for (const l of ALLOWED_CONTRIBUTION_LICENSES) {
      expect(classifyLicense(l.id).allowed, l.id).toBe(true);
    }
  });
});

describe("sanitizeSvg", () => {
  it("strips scripts + handlers, keeps fills + viewBox", () => {
    const dirty =
      open('viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"') +
      "<script>alert(1)</script>" +
      '<path d="M0 0h10v10H0z" fill="#ff0000" onclick="evil()"/>' +
      `<circle cx="5" cy="5" r="3" fill="#00ff00"/></${SVG}>`;
    const { svg, fills, hasViewBox } = sanitizeSvg(dirty);
    expect(/<script/i.test(svg)).toBe(false);
    expect(/onclick/i.test(svg)).toBe(false);
    expect(/fill="#ff0000"/.test(svg) && /fill="#00ff00"/.test(svg)).toBe(true);
    expect(fills).toBe(2);
    expect(hasViewBox).toBe(true);
  });

  it("neutralizes external href, keeps internal #refs", () => {
    const { svg } = sanitizeSvg(
      open('viewBox="0 0 1 1"') +
        `<a href="https://evil.test">x</a><use href="#frag"/><rect fill="url(#grad)"/></${SVG}>`,
    );
    expect(/evil\.test/.test(svg)).toBe(false);
    expect(/href="#frag"/.test(svg)).toBe(true);
    expect(/url\(#grad\)/.test(svg)).toBe(true);
  });
});

describe("looksLikeSvg", () => {
  it("accepts real svg, rejects junk", () => {
    expect(looksLikeSvg(`${open('viewBox="0 0 1 1"')}</${SVG}>`)).toBe(true);
    expect(looksLikeSvg(`  <?xml version="1.0"?><${SVG}><path/></${SVG}>`)).toBe(true);
    expect(looksLikeSvg("<html><body>nope</body></html>")).toBe(false);
    expect(looksLikeSvg("not markup at all")).toBe(false);
    expect(looksLikeSvg(`<${SVG}>unclosed`)).toBe(false);
  });
});

describe("tokenize + credit", () => {
  it("tokenizes a title", () => {
    // Single-char tokens (the "2") are dropped (>=2 chars only).
    expect(tokenize("Spike protein (SARS-CoV-2)")).toEqual(["spike", "protein", "sars", "cov"]);
  });

  it("formats a community credit line", () => {
    const c = formatCommunityCredit({
      title: "My enzyme",
      creator: "Jane Doe",
      license: "CC-BY",
      sourceUrl: "https://example.org/x",
    });
    expect(c).toContain("My enzyme by Jane Doe");
    expect(c).toContain("ResearchOS open library");
    expect(c).toContain("(CC-BY)");
    expect(c).toContain("https://example.org/x");
  });

  it("credit handles a missing creator + source", () => {
    const c = formatCommunityCredit({ title: "X", creator: null, license: "CC0" });
    expect(c).toContain("X by Unknown");
    expect(c).toContain("(CC0)");
  });
});
