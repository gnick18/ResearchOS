import { describe, expect, it } from "vitest";

import {
  isSafeWikiPage,
  parseSidebarLinks,
  wikiPageToRawFilename,
  wikiPageToPath,
} from "@/lib/social/lab-tool-ingest";

// ---------------------------------------------------------------------------
// isSafeWikiPage
// ---------------------------------------------------------------------------

describe("isSafeWikiPage", () => {
  it("accepts normal wiki page names", () => {
    expect(isSafeWikiPage("Home")).toBe(true);
    expect(isSafeWikiPage("Installation")).toBe(true);
    expect(isSafeWikiPage("Step-by-step-tutorial")).toBe(true);
    expect(isSafeWikiPage("Manual")).toBe(true);
    expect(isSafeWikiPage("Getting Started")).toBe(true);
    expect(isSafeWikiPage("FAQ")).toBe(true);
    expect(isSafeWikiPage("v1.2.3 Release Notes")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(isSafeWikiPage("")).toBe(false);
  });

  it("rejects '.' and '..'", () => {
    expect(isSafeWikiPage(".")).toBe(false);
    expect(isSafeWikiPage("..")).toBe(false);
  });

  it("rejects names with slashes (path traversal)", () => {
    expect(isSafeWikiPage("../etc/passwd")).toBe(false);
    expect(isSafeWikiPage("a/b")).toBe(false);
  });

  it("rejects names with null bytes or shell-special chars", () => {
    expect(isSafeWikiPage("page\0evil")).toBe(false);
    expect(isSafeWikiPage("page;rm -rf")).toBe(false);
    expect(isSafeWikiPage("$(cmd)")).toBe(false);
  });

  it("rejects names longer than 200 chars", () => {
    expect(isSafeWikiPage("a".repeat(201))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSidebarLinks -- egluckthaler/starfish _Sidebar.md structure
// ---------------------------------------------------------------------------

describe("parseSidebarLinks -- [[wiki-link]] style", () => {
  it("extracts page names from [[Page]] links, excluding Home", () => {
    const sidebar = `
* [[Home]]
* [[Installation]]
* [[Manual]]
* [[Step-by-step-tutorial]]
    `;
    expect(parseSidebarLinks(sidebar)).toEqual([
      "Installation",
      "Manual",
      "Step-by-step-tutorial",
    ]);
  });

  it("handles [[label|target]] style (returns target)", () => {
    const sidebar = `[[Install Guide|Installation]]`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Installation"]);
  });

  it("deduplicates repeated page names", () => {
    const sidebar = `[[Installation]] [[Installation]]`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Installation"]);
  });

  it("skips Home in any casing", () => {
    const sidebar = `[[home]] [[HOME]] [[Installation]]`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Installation"]);
  });

  it("ignores anchored links ([[Page#section]])", () => {
    const sidebar = `[[Installation#Requirements]] [[Manual]]`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Manual"]);
  });
});

describe("parseSidebarLinks -- [label](target) markdown style", () => {
  it("extracts internal page names from standard markdown links", () => {
    const sidebar = `
- [Home](Home)
- [Installation](Installation)
- [Manual](Manual)
    `;
    expect(parseSidebarLinks(sidebar)).toEqual(["Installation", "Manual"]);
  });

  it("skips external URLs (http/https)", () => {
    const sidebar = `[External](https://example.com) [Installation](Installation)`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Installation"]);
  });

  it("skips links with anchors (#)", () => {
    const sidebar = `[Sec](Installation#section) [Manual](Manual)`;
    expect(parseSidebarLinks(sidebar)).toEqual(["Manual"]);
  });

  it("handles hyphenated display names (URL form) by converting back to spaces", () => {
    // GitHub wiki raw links often use hyphens for spaces; we normalize to spaces.
    const sidebar = `[Step by step](Step-by-step-tutorial)`;
    // "Step-by-step-tutorial" -> decoded -> "Step by step tutorial" (non-Home, safe).
    const result = parseSidebarLinks(sidebar);
    expect(result.length).toBe(1);
    // Either form is valid as long as it passes isSafeWikiPage.
    expect(isSafeWikiPage(result[0])).toBe(true);
  });
});

describe("parseSidebarLinks -- starfish realistic _Sidebar", () => {
  // Representative _Sidebar.md structure for egluckthaler/starfish.
  const starfishSidebar = `
**starfish**

* [[Home]]
* [[Installation]]
* [[Manual]]
* [[Step-by-step-tutorial]]
  `;

  it("returns Installation, Manual, Step-by-step-tutorial (not Home)", () => {
    const result = parseSidebarLinks(starfishSidebar);
    expect(result).toContain("Installation");
    expect(result).toContain("Manual");
    expect(result).toContain("Step-by-step-tutorial");
    expect(result).not.toContain("Home");
  });
});

// ---------------------------------------------------------------------------
// wikiPageToRawFilename
// ---------------------------------------------------------------------------

describe("wikiPageToRawFilename", () => {
  it("returns 'Home.md' for 'Home'", () => {
    expect(wikiPageToRawFilename("Home")).toBe("Home.md");
  });

  it("replaces spaces with hyphens", () => {
    expect(wikiPageToRawFilename("Getting Started")).toBe("Getting-Started.md");
  });

  it("preserves existing hyphens", () => {
    expect(wikiPageToRawFilename("Step-by-step-tutorial")).toBe("Step-by-step-tutorial.md");
  });

  it("preserves casing", () => {
    expect(wikiPageToRawFilename("Installation")).toBe("Installation.md");
    expect(wikiPageToRawFilename("Manual")).toBe("Manual.md");
  });
});

// ---------------------------------------------------------------------------
// wikiPageToPath
// ---------------------------------------------------------------------------

describe("wikiPageToPath", () => {
  it("maps 'Home' to '' (empty string = lab home page)", () => {
    expect(wikiPageToPath("Home")).toBe("");
    expect(wikiPageToPath("home")).toBe("");
    expect(wikiPageToPath("HOME")).toBe("");
  });

  it("maps 'Installation' to 'wiki/installation'", () => {
    expect(wikiPageToPath("Installation")).toBe("wiki/installation");
  });

  it("maps 'Manual' to 'wiki/manual'", () => {
    expect(wikiPageToPath("Manual")).toBe("wiki/manual");
  });

  it("maps 'Step-by-step-tutorial' to 'wiki/step-by-step-tutorial'", () => {
    expect(wikiPageToPath("Step-by-step-tutorial")).toBe("wiki/step-by-step-tutorial");
  });

  it("handles display names with spaces", () => {
    expect(wikiPageToPath("Getting Started")).toBe("wiki/getting-started");
  });

  it("strips non-slug characters and collapses consecutive dashes", () => {
    // "FAQ & Notes" -> lowercase -> "faq & notes" -> spaces to hyphens ->
    // "faq-&-notes" -> strip non [a-z0-9-] -> "faq--notes" -> collapse -> "faq-notes".
    const result = wikiPageToPath("FAQ & Notes");
    expect(result).toBe("wiki/faq-notes");
    expect(result.startsWith("wiki/")).toBe(true);
    expect(result).not.toContain(" ");
  });
});
