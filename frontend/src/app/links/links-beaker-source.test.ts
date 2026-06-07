// sequence editor master (Links source sub-bot). Tests for the PURE Links
// BeakerSearch source builder. These cover the context-card copy (scope /
// filtered / editing / creating), the command set (ids + groups + ownership
// gating, shared-in omits the write rows, save enabled only when the form is
// valid), the Suggested ordering across the four contexts, the nav groups
// (internal jump + external open + recent links, all the blue "link" tone, the
// external detail shows the hostname, a malformed url degrades), and the
// parseLinkUrl / interpretQuery seam, all without a DOM or a store, mirroring
// the posture of gantt-beaker-source.test.ts.

import { describe, it, expect } from "vitest";
import type { LabLink } from "@/lib/types";
import {
  buildLinksSource,
  hostnameOf,
  isOwnLink,
  linksScopeSummary,
  parseLinkUrl,
  type LinksSourceData,
  type LinksSourceHandlers,
} from "./links-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeLink(over: Partial<LabLink> = {}): LabLink {
  return {
    id: 1,
    title: "Addgene plasmid catalog",
    url: "https://addgene.org/browse",
    description: "Plasmid repository",
    category: "Database",
    color: "#3b82f6",
    preview_image_url: null,
    sort_order: 0,
    created_at: "2026-06-01T00:00:00Z",
    owner: "self",
    shared_with: [],
    ...over,
  } as LabLink;
}

const noopHandlers: LinksSourceHandlers = {
  startCreate: () => {},
  startEdit: () => {},
  cancelEdit: () => {},
  handleCreate: () => {},
  handleUpdate: () => {},
  handleFetchPreview: () => {},
  setDeleteConfirmId: () => {},
  setColor: () => {},
  setWholeLab: () => {},
  setActiveCategory: () => {},
  toggleVisibility: () => {},
  refreshPreview: () => {},
  openExternally: () => {},
  openAll: () => {},
  copyUrl: () => {},
  jumpToLink: () => {},
  jumpToCategory: () => {},
};

function groupOf(links: LabLink[]): Record<string, LabLink[]> {
  return links.reduce((acc, l) => {
    const cat = l.category || "Other";
    (acc[cat] = acc[cat] ?? []).push(l);
    return acc;
  }, {} as Record<string, LabLink[]>);
}

function makeData(over: Partial<LinksSourceData> = {}): LinksSourceData {
  const links = over.links ?? [makeLink()];
  return {
    links,
    groupedLinks: over.groupedLinks ?? groupOf(links),
    editingLink: null,
    isCreating: false,
    isLoadingPreview: false,
    title: "",
    url: "",
    wholeLab: false,
    color: "#3b82f6",
    activeCategory: null,
    currentUser: "self",
    profileMap: { morgan: { displayName: "Morgan Lee" } },
    hoveredKey: null,
    ...over,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("parseLinkUrl", () => {
  it("parses an explicit http/https url", () => {
    expect(parseLinkUrl("https://addgene.org/browse")?.hostname).toBe("addgene.org");
    expect(parseLinkUrl("http://blast.ncbi.nlm.nih.gov")?.hostname).toBe(
      "blast.ncbi.nlm.nih.gov",
    );
  });

  it("parses a bare domain", () => {
    expect(parseLinkUrl("addgene.org")?.hostname).toBe("addgene.org");
    expect(parseLinkUrl("blast.ncbi.nlm.nih.gov/Blast.cgi")?.hostname).toBe(
      "blast.ncbi.nlm.nih.gov",
    );
  });

  it("rejects non-url text", () => {
    expect(parseLinkUrl("lab meeting")).toBeNull();
    expect(parseLinkUrl("addgene")).toBeNull();
    expect(parseLinkUrl("")).toBeNull();
    expect(parseLinkUrl("a thing with spaces .org")).toBeNull();
  });
});

describe("hostnameOf", () => {
  it("returns the hostname for a valid url", () => {
    expect(hostnameOf("https://bio-protocol.org/x")).toBe("bio-protocol.org");
  });
  it("degrades to the raw string for a malformed url", () => {
    expect(hostnameOf("not a url")).toBe("not a url");
  });
});

describe("isOwnLink", () => {
  it("treats unset owner (legacy) and matching owner as own", () => {
    expect(isOwnLink(makeLink({ owner: undefined }), "self")).toBe(true);
    expect(isOwnLink(makeLink({ owner: "self" }), "self")).toBe(true);
  });
  it("treats another owner as shared-in", () => {
    expect(isOwnLink(makeLink({ owner: "morgan" }), "self")).toBe(false);
  });
});

// ── Context card ─────────────────────────────────────────────────────────────

describe("linksScopeSummary", () => {
  it("reads N saved, K categories when unfiltered", () => {
    const data = makeData({
      links: [makeLink(), makeLink({ id: 2, category: "Protocol" })],
    });
    expect(linksScopeSummary(data)).toBe("2 saved, 2 categories");
  });

  it("reads category, count when a filter is active", () => {
    const links = [makeLink(), makeLink({ id: 2 }), makeLink({ id: 3 })];
    const data = makeData({ links, activeCategory: "Database" });
    expect(linksScopeSummary(data)).toBe("Database, 3 links");
  });

  it("reads none saved yet when empty", () => {
    expect(linksScopeSummary(makeData({ links: [], groupedLinks: {} }))).toBe(
      "none saved yet",
    );
  });
});

describe("buildLinksSource context card", () => {
  it("is two lines, no selection when nothing selected", () => {
    const card = buildLinksSource(makeData(), noopHandlers).contextCard!;
    expect(card.title).toBe("Links");
    expect(card.meta).toBe("1 saved, 1 category");
    expect(card.selection).toBeUndefined();
  });

  it("adds the editing line with category + visibility", () => {
    const link = makeLink({ shared_with: [{ username: "*", level: "edit" }] });
    const card = buildLinksSource(
      makeData({ links: [link], editingLink: link }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe(
      'Selected, "Addgene plasmid catalog", Database, shared with the whole lab',
    );
  });

  it("shows the new-link draft line while creating, unsaved when dirty", () => {
    const clean = buildLinksSource(
      makeData({ isCreating: true }),
      noopHandlers,
    ).contextCard!;
    expect(clean.selection?.text).toBe("New link draft");
    const dirty = buildLinksSource(
      makeData({ isCreating: true, title: "x" }),
      noopHandlers,
    ).contextCard!;
    expect(dirty.selection?.text).toBe("New link draft, unsaved");
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe("buildLinksSource commands", () => {
  it("emits open + copy + every write row for an own selected link", () => {
    const link = makeLink();
    const cmds = buildLinksSource(
      makeData({ links: [link], editingLink: link }),
      noopHandlers,
    ).commands;
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain("links-open-self:1");
    expect(ids).toContain("links-copy-self:1");
    expect(ids).toContain("links-edit-self:1");
    expect(ids).toContain("links-category-self:1");
    expect(ids).toContain("links-visibility-self:1");
    expect(ids).toContain("links-refresh-self:1");
    expect(ids).toContain("links-delete-self:1");
    // Save + Cancel lead while editing this link.
    expect(ids).toContain("links-save-self:1");
    expect(ids).toContain("links-cancel-self:1");
  });

  it("omits every write row for a shared-in selected link, keeps open / copy / jump", () => {
    const shared = makeLink({ id: 2, owner: "morgan" });
    const cmds = buildLinksSource(
      makeData({ links: [shared], editingLink: shared }),
      noopHandlers,
    ).commands;
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain("links-open-morgan:2");
    expect(ids).toContain("links-copy-morgan:2");
    expect(ids).toContain("links-jump-morgan:2");
    // No write rows for a link you do not own.
    expect(ids.some((id) => id.startsWith("links-edit-"))).toBe(false);
    expect(ids.some((id) => id.startsWith("links-delete-"))).toBe(false);
    expect(ids.some((id) => id.startsWith("links-visibility-morgan"))).toBe(false);
    expect(ids.some((id) => id.startsWith("links-save-"))).toBe(false);
  });

  it("enables Save only when title and url are non-empty", () => {
    const link = makeLink();
    const invalid = new Map(
      buildLinksSource(
        makeData({ links: [link], editingLink: link, title: "", url: "" }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(invalid.get("links-save-self:1")?.enabled).toBe(false);
    const valid = new Map(
      buildLinksSource(
        makeData({ links: [link], editingLink: link, title: "T", url: "u" }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(valid.get("links-save-self:1")?.enabled).toBe(true);
  });

  it("groups the per-link rows and drives the draft form while creating", () => {
    const cmds = buildLinksSource(
      makeData({ isCreating: true, title: "T", url: "u" }),
      noopHandlers,
    ).commands;
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get("links-add")?.group).toBe("Create");
    expect(byId.get("links-create")?.group).toBe("Create");
    expect(byId.get("links-create")?.enabled).toBe(true);
    expect(byId.get("links-fetch-preview")?.group).toBe("Create");
    expect(byId.get("links-draft-visibility")?.group).toBe("Visibility");
  });

  it("emits one filter + one jump command per category", () => {
    const links = [makeLink(), makeLink({ id: 2, category: "Protocol" })];
    const cmds = buildLinksSource(makeData({ links }), noopHandlers).commands;
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain("links-filter-Database");
    expect(ids).toContain("links-filter-Protocol");
    expect(ids).toContain("links-jump-cat-Database");
    expect(ids).toContain("links-jump-cat-Protocol");
  });

  it("unlocks new-in-category + open-all when a category filter is active", () => {
    const links = [makeLink(), makeLink({ id: 2 })];
    const byId = new Map(
      buildLinksSource(
        makeData({ links, activeCategory: "Database" }),
        noopHandlers,
      ).commands.map((c) => [c.id, c]),
    );
    expect(byId.get("links-new-in-category")?.label).toBe("New link in Database");
    expect(byId.get("links-open-all-in-category")?.enabled).toBe(true);
    expect(byId.get("links-clear-filter")?.enabled).toBe(true);
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildLinksSource suggested ordering", () => {
  it("leads with save / cancel then the own-link actions when editing", () => {
    const link = makeLink();
    const src = buildLinksSource(
      makeData({ links: [link], editingLink: link, title: "T", url: "u" }),
      noopHandlers,
    );
    expect(src.suggestedIds?.slice(0, 4)).toEqual([
      "links-save-self:1",
      "links-cancel-self:1",
      "links-open-self:1",
      "links-copy-self:1",
    ]);
    expect(src.suggestedHint).toBe("for the selected link");
    // Every suggested id must exist in commands.
    const ids = new Set(src.commands.map((c) => c.id));
    for (const id of src.suggestedIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it("suggests only open / copy / jump for a shared-in selected link", () => {
    const shared = makeLink({ id: 2, owner: "morgan" });
    const src = buildLinksSource(
      makeData({ links: [shared], editingLink: shared }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "links-open-morgan:2",
      "links-copy-morgan:2",
      "links-jump-morgan:2",
    ]);
    expect(src.suggestedHint).toBe("for the shared link");
  });

  it("drives the draft form while creating", () => {
    const src = buildLinksSource(makeData({ isCreating: true }), noopHandlers);
    expect(src.suggestedIds?.[0]).toBe("links-create");
    expect(src.suggestedIds).toContain("links-fetch-preview");
    expect(src.suggestedIds).toContain("links-draft-cancel");
    expect(src.suggestedHint).toBe("for the new link");
  });

  it("leads with Add a link when the board is visible and nothing selected", () => {
    const src = buildLinksSource(makeData(), noopHandlers);
    expect(src.suggestedIds?.[0]).toBe("links-add");
    expect(src.suggestedHint).toBeUndefined();
  });

  it("offers the category-filter set when a filter is active", () => {
    const src = buildLinksSource(
      makeData({ activeCategory: "Database" }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "links-new-in-category",
      "links-clear-filter",
      "links-open-all-in-category",
    ]);
    expect(src.suggestedHint).toBe("in Database");
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildLinksSource nav groups", () => {
  it("has Jump to a link + Open externally with the link tone, plus Recent links", () => {
    const src = buildLinksSource(makeData(), noopHandlers);
    const groups = src.navGroups ?? [];
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual(["Jump to a link", "Open externally", "Recent links"]);

    const jump = groups.find((g) => g.title === "Jump to a link")!;
    expect(jump.items[0].tone).toBe("link");
    expect(jump.items[0].keywords).toContain("addgene.org");

    const ext = groups.find((g) => g.title === "Open externally")!;
    expect(ext.items[0].tone).toBe("link");
    expect(ext.items[0].detail).toBe("addgene.org, opens in a new tab");
  });

  it("degrades the external detail for a malformed url", () => {
    const bad = makeLink({ url: "not a url" });
    const src = buildLinksSource(makeData({ links: [bad] }), noopHandlers);
    const ext = (src.navGroups ?? []).find((g) => g.title === "Open externally")!;
    expect(ext.items[0].detail).toBe("opens externally");
  });

  it("labels a shared-in jump row with its owner display name", () => {
    const shared = makeLink({ id: 2, owner: "morgan" });
    const src = buildLinksSource(makeData({ links: [shared] }), noopHandlers);
    const jump = (src.navGroups ?? []).find((g) => g.title === "Jump to a link")!;
    expect(jump.items[0].detail).toContain("shared by Morgan Lee");
  });

  it("omits Recent links when no link carries a timestamp", () => {
    const undated = makeLink({ created_at: "" });
    const src = buildLinksSource(makeData({ links: [undated] }), noopHandlers);
    expect((src.navGroups ?? []).some((g) => g.title === "Recent links")).toBe(false);
  });
});

// ── interpretQuery (the typed-url seam) ──────────────────────────────────────

describe("buildLinksSource interpretQuery", () => {
  it("returns an Open hostname row when the query parses as a url", () => {
    const src = buildLinksSource(makeData(), noopHandlers);
    const groups = src.interpretQuery!("addgene.org");
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Open externally");
    expect(groups[0].items[0].label).toBe("Open addgene.org");
    expect(groups[0].items[0].tone).toBe("link");
  });

  it("returns nothing for non-url text", () => {
    const src = buildLinksSource(makeData(), noopHandlers);
    expect(src.interpretQuery!("lab meeting")).toEqual([]);
  });
});
