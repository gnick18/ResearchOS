// sequence editor master (Methods source sub-bot). Tests for the PURE Method
// Library BeakerSearch source builder. These cover the context-card copy
// (library / searching / browsing + the open-method selection line + the
// read-only / provenance hints), the command set (ids + groups + the permission
// gating, write gated by canModify, fork always enabled, retire only when
// public, delete excluded for shared-into-me), the Suggested ordering for the
// four contexts (selected method / open kit / template browser / nothing
// selected), the nav groups (both kinds, methods tone "method" + Open, templates
// neutral + Use), and the recent-methods MRU resolution, all without a DOM or a
// store, mirroring the posture of editor-commands.test.ts and the sibling
// gantt / workbench source tests.

import { describe, it, expect } from "vitest";
import type { Method } from "@/lib/types";
import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";
import {
  buildMethodsSource,
  methodsScopeMeta,
  methodNavKey,
  isMethodSharedIntoMe,
  type MethodRecentRef,
  type MethodsSourceData,
  type MethodsSourceHandlers,
} from "./methods-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeMethod(over: Partial<Method> = {}): Method {
  return {
    id: 1,
    name: "qPCR master mix",
    source_path: "methods/qpcr/qpcr.md",
    method_type: "pcr",
    folder_path: "Molecular Biology",
    parent_method_id: null,
    tags: ["qpcr", "mastermix"],
    is_public: false,
    created_by: "self",
    owner: "self",
    shared_with: [],
    ...over,
  } as Method;
}

function makeTemplate(
  over: Partial<MethodCatalogManifestEntry> = {},
): MethodCatalogManifestEntry {
  return {
    slug: "qpcr-sybr",
    title: "qPCR SYBR Green",
    description: "Standard SYBR Green qPCR run",
    category: "Molecular biology",
    method_type: "pcr",
    tags: ["qpcr", "sybr"],
    ...over,
  };
}

/** A handler bag where every callback is a no-op spy-friendly fn. */
function makeHandlers(): MethodsSourceHandlers {
  const noop = () => {};
  return {
    openMethod: noop,
    editCompound: noop,
    createMethod: noop,
    createMethodInFolder: noop,
    createCategory: noop,
    publishLabWideMethod: noop,
    browseTemplates: noop,
    closeTemplates: noop,
    useTemplate: noop,
    rename: noop,
    move: noop,
    extendIntoKit: noop,
    convertToSingle: noop,
    fork: noop,
    share: noop,
    deleteMethod: noop,
    retirePublic: noop,
    setSearchQuery: noop,
  };
}

/** Base data, an own qPCR method visible, nothing open, not browsing. */
function makeData(over: Partial<MethodsSourceData> = {}): MethodsSourceData {
  const own = makeMethod();
  return {
    methods: [own],
    filteredOwnMethods: [own],
    filteredSharedMethods: [],
    allFolders: ["Molecular Biology"],
    existingFolders: ["Molecular Biology"],
    searchQuery: "",
    browsingTemplates: false,
    viewingMethod: null,
    editingCompound: null,
    canModify: () => true,
    currentUser: "self",
    templates: [makeTemplate()],
    recent: [],
    ...over,
  };
}

/** Find a command by id in the built source. */
function cmd(source: ReturnType<typeof buildMethodsSource>, id: string) {
  return (source.commands ?? []).find((c) => c.id === id);
}

// ── Context card (spec 2.5) ──────────────────────────────────────────────────

describe("methods context card", () => {
  it("reads the own / shared counts at rest", () => {
    const shared = makeMethod({ id: 9, owner: "alex", is_shared_with_me: true });
    const data = makeData({
      filteredSharedMethods: [shared],
      methods: [makeMethod(), shared],
    });
    expect(methodsScopeMeta(data)).toBe("1 of yours, 1 shared");
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.title).toBe("Method Library");
    expect(card.iconName).toBe("book");
    expect(card.selection).toBeUndefined();
  });

  it("collapses to a search snapshot while searching", () => {
    const data = makeData({ searchQuery: "qpcr" });
    expect(methodsScopeMeta(data)).toBe('"qpcr" matches 1');
  });

  it("reads the template-library scope while browsing", () => {
    const data = makeData({
      browsingTemplates: true,
      templates: [makeTemplate(), makeTemplate({ slug: "b", title: "B" })],
    });
    expect(methodsScopeMeta(data)).toBe("Template library, 2 protocols");
  });

  it("reads the empty-library snapshot", () => {
    const data = makeData({
      methods: [],
      filteredOwnMethods: [],
      filteredSharedMethods: [],
      allFolders: [],
    });
    expect(methodsScopeMeta(data)).toBe("no methods yet, 1 template available");
  });

  it("adds the open-method selection line with type + folder", () => {
    const open = makeMethod();
    const data = makeData({ viewingMethod: open });
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.selection?.text).toContain('"qPCR master mix"');
    expect(card.selection?.text).toContain("PCR");
    expect(card.selection?.text).toContain("Molecular Biology");
    expect(card.selection?.text).toMatch(/^Open, /);
  });

  it("appends a read-only hint for a shared-with-view open method", () => {
    const open = makeMethod({ owner: "alex", is_shared_with_me: true });
    const data = makeData({ viewingMethod: open, canModify: () => false });
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.selection?.text).toContain("read-only, shared by alex");
  });

  it("appends a lab-wide read-only hint for a public open method", () => {
    const open = makeMethod({ is_public: true, owner: "public" });
    const data = makeData({ viewingMethod: open, canModify: () => false });
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.selection?.text).toContain("read-only, lab-wide");
  });

  it("shows the component count for an open compound", () => {
    const compound = makeMethod({
      method_type: "compound",
      source_path: null,
      components: [
        { method_id: 2, owner: null, ordering: 0 },
        { method_id: 3, owner: null, ordering: 1 },
      ],
    });
    const data = makeData({ editingCompound: compound });
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.selection?.text).toContain("Kit");
    expect(card.selection?.text).toContain("2 components");
  });

  it("shows a provenance line for a received own method", () => {
    const open = makeMethod({ received_from: "alex@lab.org" });
    const data = makeData({ viewingMethod: open, canModify: () => true });
    const card = buildMethodsSource(data, makeHandlers()).contextCard!;
    expect(card.selection?.text).toContain("received from alex@lab.org, verified");
  });
});

// ── Commands + permission gating (spec 3.1 / 6) ──────────────────────────────

describe("methods command permission gating", () => {
  it("enables every write on an OWN open method, and fork", () => {
    const open = makeMethod();
    const source = buildMethodsSource(
      makeData({ viewingMethod: open, canModify: () => true }),
      makeHandlers(),
    );
    expect(cmd(source, "methods-selected-edit")?.enabled).not.toBe(false);
    expect(cmd(source, "methods-selected-rename")?.enabled).not.toBe(false);
    expect(cmd(source, "methods-selected-move")?.enabled).not.toBe(false);
    expect(cmd(source, "methods-selected-share")?.enabled).not.toBe(false);
    expect(cmd(source, "methods-selected-delete")?.enabled).not.toBe(false);
    // Fork is always enabled.
    expect(cmd(source, "methods-selected-fork")?.enabled).not.toBe(false);
  });

  it("greys writes but keeps fork on a READ-ONLY shared-with-view method", () => {
    const open = makeMethod({ owner: "alex", is_shared_with_me: true });
    const source = buildMethodsSource(
      makeData({ viewingMethod: open, canModify: () => false }),
      makeHandlers(),
    );
    expect(cmd(source, "methods-selected-edit")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-rename")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-move")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-share")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-delete")?.enabled).toBe(false);
    // Fork stays enabled.
    expect(cmd(source, "methods-selected-fork")?.enabled).not.toBe(false);
    // The greyed reason lands in detail.
    expect(cmd(source, "methods-selected-edit")?.detail).toContain("Read-only");
    expect(cmd(source, "methods-selected-edit")?.detail).toContain("alex");
  });

  it("excludes Delete (and Share) for a SHARED-WITH-EDIT method, keeps Edit", () => {
    // canModify true (edit grant) but shared into me, so delete + share are off.
    const open = makeMethod({
      owner: "alex",
      is_shared_with_me: true,
      shared_permission: "edit",
    });
    const source = buildMethodsSource(
      makeData({ viewingMethod: open, canModify: () => true }),
      makeHandlers(),
    );
    expect(isMethodSharedIntoMe(open)).toBe(true);
    expect(cmd(source, "methods-selected-edit")?.enabled).not.toBe(false);
    expect(cmd(source, "methods-selected-rename")?.enabled).not.toBe(false);
    // Move is OWN-only (shared methods non-draggable).
    expect(cmd(source, "methods-selected-move")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-delete")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-share")?.enabled).toBe(false);
    expect(cmd(source, "methods-selected-delete")?.detail).toContain(
      "only the owner can delete",
    );
  });

  it("enables Retire only when the method is public", () => {
    const privateOpen = makeMethod();
    const pubOpen = makeMethod({ is_public: true, owner: "public" });
    const privSource = buildMethodsSource(
      makeData({ viewingMethod: privateOpen }),
      makeHandlers(),
    );
    const pubSource = buildMethodsSource(
      makeData({ viewingMethod: pubOpen, canModify: () => false }),
      makeHandlers(),
    );
    expect(cmd(privSource, "methods-selected-retire")?.enabled).toBe(false);
    expect(cmd(pubSource, "methods-selected-retire")?.enabled).toBe(true);
  });

  it("offers a per-template Use command for each catalog entry", () => {
    const source = buildMethodsSource(
      makeData({ templates: [makeTemplate({ slug: "x", title: "X kit" })] }),
      makeHandlers(),
    );
    const use = cmd(source, "methods-use-template-x");
    expect(use?.label).toBe('Use "X kit" template');
    expect(use?.group).toBe("Templates");
    // Templates never gate (instantiation lands an owned method).
    expect(use?.enabled).not.toBe(false);
  });

  it("swaps Browse for Close while the template browser is open", () => {
    const browsing = buildMethodsSource(
      makeData({ browsingTemplates: true }),
      makeHandlers(),
    );
    expect(cmd(browsing, "methods-templates-browse")).toBeUndefined();
    expect(cmd(browsing, "methods-templates-close")).toBeDefined();
    expect(cmd(browsing, "methods-templates-new-blank")).toBeDefined();
  });

  it("gates Clear the search on a non-empty query", () => {
    const empty = buildMethodsSource(makeData(), makeHandlers());
    const typed = buildMethodsSource(
      makeData({ searchQuery: "pcr" }),
      makeHandlers(),
    );
    expect(cmd(empty, "methods-clear-search")?.enabled).toBe(false);
    expect(cmd(typed, "methods-clear-search")?.enabled).toBe(true);
  });

  it("offers Extend into a kit on a non-compound, Edit components on a kit", () => {
    const single = makeMethod();
    const compound = makeMethod({
      method_type: "compound",
      source_path: null,
      components: [{ method_id: 2, owner: null, ordering: 0 }],
    });
    const singleSrc = buildMethodsSource(
      makeData({ viewingMethod: single }),
      makeHandlers(),
    );
    const kitSrc = buildMethodsSource(
      makeData({ viewingMethod: compound }),
      makeHandlers(),
    );
    expect(cmd(singleSrc, "methods-selected-extend-kit")).toBeDefined();
    expect(cmd(singleSrc, "methods-selected-edit-components")).toBeUndefined();
    expect(cmd(kitSrc, "methods-selected-edit-components")).toBeDefined();
    // One component, so Convert to single is offered.
    expect(cmd(kitSrc, "methods-selected-convert-single")).toBeDefined();
  });
});

// ── Suggested per context (spec 3) ───────────────────────────────────────────

describe("methods suggested ids", () => {
  it("leads with the selected-method actions, fork before delete", () => {
    const open = makeMethod();
    const source = buildMethodsSource(
      makeData({ viewingMethod: open }),
      makeHandlers(),
    );
    expect(source.suggestedIds?.slice(0, 5)).toEqual([
      "methods-selected-open",
      "methods-selected-edit",
      "methods-selected-rename",
      "methods-selected-move",
      "methods-selected-fork",
    ]);
    expect(source.suggestedHint).toBe("for the open method");
  });

  it("appends retire for a public open method", () => {
    const open = makeMethod({ is_public: true, owner: "public" });
    const source = buildMethodsSource(
      makeData({ viewingMethod: open, canModify: () => false }),
      makeHandlers(),
    );
    expect(source.suggestedIds).toContain("methods-selected-retire");
  });

  it("collapses a kit to Edit components + Convert to single", () => {
    const compound = makeMethod({
      method_type: "compound",
      source_path: null,
      components: [{ method_id: 2, owner: null, ordering: 0 }],
    });
    const source = buildMethodsSource(
      makeData({ editingCompound: compound }),
      makeHandlers(),
    );
    expect(source.suggestedIds).toContain("methods-selected-edit-components");
    expect(source.suggestedIds).toContain("methods-selected-convert-single");
    expect(source.suggestedIds).not.toContain("methods-selected-extend-kit");
    expect(source.suggestedHint).toBe("for the open kit");
  });

  it("offers the template-browser exits when browsing", () => {
    const source = buildMethodsSource(
      makeData({ browsingTemplates: true }),
      makeHandlers(),
    );
    expect(source.suggestedIds).toEqual([
      "methods-templates-close",
      "methods-templates-new-blank",
    ]);
  });

  it("offers the main create moves at rest", () => {
    const source = buildMethodsSource(makeData(), makeHandlers());
    expect(source.suggestedIds).toEqual([
      "methods-new",
      "methods-templates-browse",
      "methods-new-category",
      "methods-publish-labwide",
    ]);
  });

  it("shows only New method + Browse templates for an empty library", () => {
    const source = buildMethodsSource(
      makeData({
        methods: [],
        filteredOwnMethods: [],
        filteredSharedMethods: [],
        allFolders: [],
      }),
      makeHandlers(),
    );
    expect(source.suggestedIds).toEqual([
      "methods-new",
      "methods-templates-browse",
    ]);
  });
});

// ── Navigate, the TWO kinds (spec 4) ─────────────────────────────────────────

describe("methods nav groups", () => {
  it("builds Your methods (tone method, Open) and Template library (neutral, Use)", () => {
    const source = buildMethodsSource(makeData(), makeHandlers());
    const yours = source.navGroups?.find((g) => g.title === "Your methods");
    const templates = source.navGroups?.find(
      (g) => g.title === "Template library",
    );
    expect(yours).toBeDefined();
    expect(templates).toBeDefined();

    // Methods carry the emerald "method" tone.
    const methodItem = yours!.items[0];
    expect(methodItem.tone).toBe("method");
    expect(methodItem.id).toBe(methodNavKey(makeMethod()));
    expect(methodItem.iconName).toBe("file");

    // Templates are neutral (no tone) and use the library glyph.
    const templateItem = templates!.items[0];
    expect(templateItem.tone).toBeUndefined();
    expect(templateItem.iconName).toBe("book");
    expect(templateItem.id).toBe("template-qpcr-sybr");
    expect(templateItem.detail).toContain("Template");
  });

  it("widens the method list to all methods past the on-screen scope", () => {
    const own = makeMethod();
    const offscreen = makeMethod({ id: 50, name: "Offscreen method" });
    const data = makeData({
      methods: [own, offscreen],
      filteredOwnMethods: [own], // only one in view
      filteredSharedMethods: [],
    });
    const source = buildMethodsSource(data, makeHandlers());
    const yours = source.navGroups!.find((g) => g.title === "Your methods")!;
    // Both reachable, on-screen first.
    expect(yours.items.map((i) => i.label)).toEqual([
      "qPCR master mix",
      "Offscreen method",
    ]);
    expect(yours.hint).toBe("in view (1)");
  });

  it("folds the method type + tags + folder into nav keywords", () => {
    const source = buildMethodsSource(makeData(), makeHandlers());
    const yours = source.navGroups!.find((g) => g.title === "Your methods")!;
    const kw = yours.items[0].keywords ?? "";
    expect(kw).toContain("pcr");
    expect(kw).toContain("qpcr");
    expect(kw).toContain("Molecular Biology");
  });
});

// ── Recent methods MRU (spec 5) ──────────────────────────────────────────────

describe("methods recent MRU", () => {
  it("resolves recent refs against the live list, dropping a deleted one", () => {
    const alive = makeMethod();
    const recent: MethodRecentRef[] = [
      { owner: "self", id: 1, name: "qPCR master mix", method_type: "pcr" },
      { owner: "self", id: 999, name: "Deleted", method_type: "markdown" },
    ];
    const data = makeData({ methods: [alive], recent });
    const source = buildMethodsSource(data, makeHandlers());
    const recentGroup = source.navGroups?.find(
      (g) => g.title === "Recent methods",
    );
    expect(recentGroup).toBeDefined();
    expect(recentGroup!.items).toHaveLength(1);
    expect(recentGroup!.items[0].label).toBe("qPCR master mix");
    expect(recentGroup!.items[0].detail).toBe("opened recently");
    expect(recentGroup!.items[0].tone).toBe("method");
  });

  it("omits the Recent methods group when nothing resolves", () => {
    const data = makeData({ recent: [] });
    const source = buildMethodsSource(data, makeHandlers());
    expect(
      source.navGroups?.find((g) => g.title === "Recent methods"),
    ).toBeUndefined();
  });
});
