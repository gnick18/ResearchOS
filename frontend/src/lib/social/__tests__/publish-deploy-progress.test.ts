// Pure-logic tests for the publish / deploy-progress component helpers.
// These do NOT import React or the component itself (no jsdom required),
// focusing on the logic that can be extracted and verified in a plain TS
// environment.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// formatPublishTime (extracted for testing)
// ---------------------------------------------------------------------------
// The full component keeps formatPublishTime private; we inline the same
// logic here so the test doubles as a spec. If the logic ever moves to a
// shared utility, replace this copy.

function formatPublishTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 2) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

describe("formatPublishTime", () => {
  it("returns 'just now' for timestamps less than 2 min ago", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatPublishTime(recent)).toBe("just now");
  });

  it("returns '<N> min ago' for timestamps between 2 and 59 min ago", () => {
    const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatPublishTime(fiveMin)).toBe("5 min ago");
  });

  it("returns '<N>h ago' for timestamps between 1 and 23 hours ago", () => {
    const twoHours = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    expect(formatPublishTime(twoHours)).toBe("2h ago");
  });

  it("returns a localized date string for timestamps older than 24 hours", () => {
    const twoDays = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
    const result = formatPublishTime(twoDays);
    // The exact string depends on locale, but it should not be "just now" /
    // "X min ago" / "Xh ago" (those all bail out before the date branch).
    expect(result).not.toMatch(/just now|min ago|h ago/);
  });

  it("passes through unparseable strings unchanged", () => {
    expect(formatPublishTime("not-a-date")).toBe("not-a-date");
  });
});

// ---------------------------------------------------------------------------
// Deploy history entry shape
// ---------------------------------------------------------------------------

interface DeployHistoryEntry {
  publishedAt: string;
  label: string;
  isCurrent: boolean;
}

function buildCurrentEntry(
  pages: Array<{ path: string; title: string; status: string; updatedAt: string }>,
  editorPath: string,
): DeployHistoryEntry[] {
  // Mirrors the deployHistoryEntries logic in LabSiteDashboard.tsx.
  // Note: editorPath "" is the home page (valid), so we only bail on __new__
  // and on a null/undefined value. In LabSiteDashboard editorPath is string|null;
  // here we use string and treat a missing page as a no-op.
  if (editorPath === "__new__") return [];
  const page = pages.find((p) => p.path === editorPath);
  if (!page || page.status !== "published") return [];
  return [
    {
      publishedAt: page.updatedAt,
      label: page.title || (page.path === "" ? "Home page" : `/${page.path}`),
      isCurrent: true,
    },
  ];
}

describe("buildCurrentEntry (deploy history stub)", () => {
  const pages = [
    {
      path: "",
      title: "Home",
      status: "published" as const,
      updatedAt: "2026-06-20T12:00:00Z",
    },
    {
      path: "methods",
      title: "Methods",
      status: "draft" as const,
      updatedAt: "2026-06-20T13:00:00Z",
    },
  ];

  it("returns the published page as a single isCurrent entry", () => {
    const entries = buildCurrentEntry(pages, "");
    expect(entries).toHaveLength(1);
    expect(entries[0].isCurrent).toBe(true);
    expect(entries[0].label).toBe("Home");
    expect(entries[0].publishedAt).toBe("2026-06-20T12:00:00Z");
  });

  it("returns empty for a page that is still a draft", () => {
    const entries = buildCurrentEntry(pages, "methods");
    expect(entries).toHaveLength(0);
  });

  it("returns empty for new pages (__new__)", () => {
    const entries = buildCurrentEntry(pages, "__new__");
    expect(entries).toHaveLength(0);
  });

  it("returns empty when editorPath has no matching page", () => {
    const entries = buildCurrentEntry(pages, "nonexistent");
    expect(entries).toHaveLength(0);
  });

  it("falls back to a path label when the published page has no title", () => {
    const noTitle = [
      { path: "supplement", title: "", status: "published" as const, updatedAt: "2026-06-20T14:00:00Z" },
    ];
    const entries = buildCurrentEntry(noTitle, "supplement");
    expect(entries[0].label).toBe("/supplement");
  });
});
