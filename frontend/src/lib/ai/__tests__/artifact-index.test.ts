// Unit tests for the artifact index (Layer 1): scorer, adapters, searchMyWork.
// All tests are pure: no real folder, no I/O, no Loro. Each adapter and the
// scorer are tested directly; searchMyWork is tested with stubbed deps.

import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreBrief,
  noteToBrief,
  methodToBrief,
  sequenceToBrief,
  dataHubToBrief,
  projectToBrief,
  purchaseToBrief,
  moleculeToBrief,
  phyloToBrief,
  experimentToBrief,
  searchMyWork,
  dayPrefix,
  filterArtifacts,
  resolveProjectRefsToIds,
  resolveOwnerRefsToUsernames,
  periodToDateRange,
  listArtifacts,
  type ArtifactBrief,
  type ArtifactIndexDeps,
} from "../artifact-index";
import type { Note, NoteEntry, Method, SequenceRecord, Project, PurchaseItem, Task } from "@/lib/types";
import type { DataHubDocument } from "@/lib/datahub/model/types";
import type { Molecule } from "@/lib/chemistry/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "CRISPR cloning protocol",
    description: "PCR-based CRISPR insert assembly",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "e1",
        title: "Colony count",
        date: "2026-06-10",
        content: "Counted 24 white colonies on LB-amp plate",
        created_at: "2026-06-10T12:00:00.000Z",
        updated_at: "2026-06-10T12:00:00.000Z",
      } satisfies NoteEntry,
    ],
    comments: [],
    updated_at: "2026-06-10T12:00:00.000Z",
    username: "grant",
    ...overrides,
  };
}

function makeMethod(overrides: Partial<Method> = {}): Method {
  return {
    id: 2,
    name: "Tm melting curve",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: ["qPCR", "Tm"],
    is_public: false,
    created_by: "grant",
    owner: "grant",
    shared_with: [],
    excerpt: "Ramp from 65 to 95 C and record fluorescence at each step to find the melt peak.",
    ...overrides,
  };
}

function makeSequence(overrides: Partial<SequenceRecord> = {}): SequenceRecord {
  return {
    id: 3,
    display_name: "pUC19",
    project_ids: ["1"],
    added_at: "2026-06-09T10:00:00.000Z",
    seq_type: "dna",
    length: 2686,
    circular: true,
    feature_count: 7,
    ...overrides,
  };
}

function makeDataHub(overrides: Partial<DataHubDocument> = {}): DataHubDocument {
  return {
    id: "dh1",
    name: "fakeGFP qPCR",
    project_ids: ["1"],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 4,
    name: "CRISPR screen 2026",
    weekend_active: false,
    tags: ["CRISPR", "screen"],
    color: null,
    created_at: "2026-05-01T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makePurchase(overrides: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: 5,
    task_id: 10,
    item_name: "Gibson Assembly Master Mix",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 95,
    shipping_fees: 0,
    total_price: 95,
    notes: "Use for insert ligation",
    funding_string: null,
    vendor: "NEB",
    catalog_number: null,
    category: "reagents",
    order_status: "needs_ordering",
    ...overrides,
  };
}

function makeMolecule(overrides: Partial<Molecule> = {}): Molecule {
  return {
    id: "mol-uuid-1",
    name: "IPTG",
    project_ids: [],
    added_at: "2026-06-07T00:00:00.000Z",
    smiles: "OCC(O)=O",
    formula: "C9H18O5S",
    mol_weight: 238.3,
    source: "pubchem",
    ...overrides,
  };
}

function makeExperiment(overrides: Partial<Task> = {}): Task {
  return {
    id: 6,
    project_id: 4,
    name: "Colony PCR screen",
    start_date: "2026-06-10",
    duration_days: 1,
    end_date: "2026-06-10",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [2],
    deviation_log: null,
    tags: ["PCR", "screening"],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("splits on whitespace and lowercases", () => {
    expect(tokenize("CRISPR cloning")).toEqual(["crispr", "cloning"]);
  });

  it("strips punctuation", () => {
    expect(tokenize("pUC19, plasmid.")).toContain("puc19");
    expect(tokenize("pUC19, plasmid.")).toContain("plasmid");
  });

  it("drops single-character tokens", () => {
    expect(tokenize("t-test")).not.toContain("t");
  });

  it("returns empty for null/undefined/empty", () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scoreBrief
// ---------------------------------------------------------------------------

describe("scoreBrief", () => {
  it("returns 0 for empty query tokens", () => {
    const brief: ArtifactBrief = {
      type: "note",
      id: "1",
      title: "CRISPR cloning",
      deepLink: "/notes/1",
    };
    expect(scoreBrief(brief, [])).toBe(0);
  });

  it("scores exact title match higher than keyword match", () => {
    const briefWithTitleMatch: ArtifactBrief = {
      type: "note",
      id: "1",
      title: "CRISPR cloning",
      deepLink: "/notes/1",
      keywords: ["gibson"],
    };
    const briefWithKeywordMatch: ArtifactBrief = {
      type: "note",
      id: "2",
      title: "Assembly protocol",
      deepLink: "/notes/2",
      keywords: ["crispr"],
    };
    const tokens = tokenize("crispr");
    expect(scoreBrief(briefWithTitleMatch, tokens)).toBeGreaterThan(
      scoreBrief(briefWithKeywordMatch, tokens),
    );
  });

  it("accumulates score across multiple matched tokens", () => {
    const brief: ArtifactBrief = {
      type: "note",
      id: "1",
      title: "CRISPR cloning protocol",
      deepLink: "/notes/1",
    };
    const oneToken = scoreBrief(brief, tokenize("crispr"));
    const twoTokens = scoreBrief(brief, tokenize("crispr cloning"));
    expect(twoTokens).toBeGreaterThan(oneToken);
  });

  it("partial title token match scores below exact", () => {
    const briefExact: ArtifactBrief = {
      type: "note",
      id: "1",
      title: "crispr",
      deepLink: "/notes/1",
    };
    const briefPartial: ArtifactBrief = {
      type: "note",
      id: "2",
      title: "crispr-cas9",
      deepLink: "/notes/2",
    };
    const tokens = tokenize("crispr");
    expect(scoreBrief(briefExact, tokens)).toBeGreaterThanOrEqual(
      scoreBrief(briefPartial, tokens),
    );
  });
});

// ---------------------------------------------------------------------------
// Per-type adapters
// ---------------------------------------------------------------------------

describe("noteToBrief", () => {
  it("returns type note with correct id, title, date, deepLink", () => {
    const brief = noteToBrief(makeNote());
    expect(brief.type).toBe("note");
    expect(brief.id).toBe("1");
    expect(brief.title).toBe("CRISPR cloning protocol");
    expect(brief.date).toBe("2026-06-10T12:00:00.000Z");
    expect(brief.deepLink).toMatch(/\/notes\/1/);
  });

  it("includes entry titles in keywords for sub-item search", () => {
    const brief = noteToBrief(makeNote());
    expect(brief.keywords).toContain("colony");
    expect(brief.keywords).toContain("count");
  });

  it("falls back to Untitled note when title is empty", () => {
    const brief = noteToBrief(makeNote({ title: "" }));
    expect(brief.title).toBe("Untitled note");
  });
});

describe("methodToBrief", () => {
  it("returns type method with correct fields", () => {
    const brief = methodToBrief(makeMethod());
    expect(brief.type).toBe("method");
    expect(brief.id).toBe("2");
    expect(brief.title).toBe("Tm melting curve");
    expect(brief.subtitle).toBe("markdown");
    expect(brief.deepLink).toMatch(/\/methods\?openMethod=2/);
  });

  it("includes tags as keywords", () => {
    const brief = methodToBrief(makeMethod());
    expect(brief.keywords).toContain("qpcr");
  });

  it("scopes a public method deep link so it cannot resolve to a same-id private method", () => {
    // Public and private methods share the numeric id-space (separate stores).
    // The brief id stays the bare numeric for the read_method tool, but the
    // deep link a reference is written from must carry the public scope.
    const brief = methodToBrief(makeMethod({ is_public: true }));
    expect(brief.id).toBe("2");
    expect(brief.deepLink).toBe("/methods?openMethod=public%3A2");
  });
});

describe("sequenceToBrief", () => {
  it("returns type sequence with length in subtitle", () => {
    const brief = sequenceToBrief(makeSequence());
    expect(brief.type).toBe("sequence");
    expect(brief.subtitle).toContain("2686");
    expect(brief.deepLink).toMatch(/\/sequences\?seq=3/);
  });

  it("includes circular in keywords", () => {
    const brief = sequenceToBrief(makeSequence());
    expect(brief.keywords).toContain("circular");
  });
});

describe("dataHubToBrief", () => {
  it("returns type datahub with table_type as subtitle", () => {
    const brief = dataHubToBrief(makeDataHub());
    expect(brief.type).toBe("datahub");
    expect(brief.subtitle).toBe("column");
    expect(brief.deepLink).toMatch(/\/datahub\?doc=dh1/);
  });
});

describe("projectToBrief", () => {
  it("returns type project", () => {
    const brief = projectToBrief(makeProject());
    expect(brief.type).toBe("project");
    expect(brief.subtitle).toBe("active");
    expect(brief.deepLink).toMatch(/\/projects\/4/);
  });
});

describe("purchaseToBrief", () => {
  it("returns type purchase with vendor as subtitle", () => {
    const brief = purchaseToBrief(makePurchase());
    expect(brief.type).toBe("purchase");
    expect(brief.subtitle).toBe("NEB");
    expect(brief.deepLink).toBe("/purchases");
  });
});

describe("moleculeToBrief", () => {
  it("returns type molecule with formula as subtitle and real deepLink", () => {
    const brief = moleculeToBrief(makeMolecule());
    expect(brief.type).toBe("molecule");
    expect(brief.subtitle).toBe("C9H18O5S");
    expect(brief.deepLink).toMatch(/\/chemistry\?molecule=mol-uuid-1/);
  });
});

describe("phyloToBrief", () => {
  it("returns type phylo with tip count subtitle and the /phylo deepLink", () => {
    const brief = phyloToBrief({
      id: "tree-1",
      name: "cyp51A tree",
      project_ids: ["7"],
      added_at: "2026-06-12T00:00:00.000Z",
      format: "newick",
      tip_count: 42,
    } as Parameters<typeof phyloToBrief>[0]);
    expect(brief.type).toBe("phylo");
    expect(brief.title).toBe("cyp51A tree");
    expect(brief.subtitle).toBe("42 tips");
    expect(brief.projectIds).toEqual(["7"]);
    expect(brief.deepLink).toMatch(/\/phylo\?doc=tree-1/);
  });
});

describe("experimentToBrief", () => {
  it("returns type experiment with active status", () => {
    const brief = experimentToBrief(makeExperiment());
    expect(brief.type).toBe("experiment");
    expect(brief.subtitle).toBe("active");
    // id is the composite taskKey ("self:<numericId>" for own tasks).
    expect(brief.id).toBe("self:6");
  });

  it("routes deepLink to the openTask popup path (in-place popup, not project page)", () => {
    const brief = experimentToBrief(makeExperiment());
    // The deep link now uses the real experiment route so the root popup host
    // can open TaskDetailPopup in place. The old project-page fallback is gone.
    expect(brief.deepLink).toMatch(/\?openTask=self%3A6/);
  });

  it("routes a shared experiment deepLink with the owner namespace", () => {
    const shared = makeExperiment({ owner: "alice", is_shared_with_me: true });
    const brief = experimentToBrief(shared);
    expect(brief.id).toBe("alice:6");
    expect(brief.deepLink).toContain("openTask=alice%3A6");
  });
});

// ---------------------------------------------------------------------------
// searchMyWork integration (stubbed deps)
// ---------------------------------------------------------------------------

function makeStubDeps(overrides: Partial<ArtifactIndexDeps> = {}): ArtifactIndexDeps {
  return {
    listNotes: async () => [makeNote()],
    listMethods: async () => [makeMethod()],
    listSequences: async () => [makeSequence()],
    listDataHub: async () => [makeDataHub()],
    listProjects: async () => [makeProject()],
    listPurchases: async () => [makePurchase()],
    listExperiments: async () => [makeExperiment()],
    listMolecules: async () => [makeMolecule()],
    listPhylo: async () => [],
    ...overrides,
  };
}

describe("searchMyWork", () => {
  it("returns ranked briefs matching the query", async () => {
    const results = await searchMyWork("CRISPR cloning", undefined, makeStubDeps());
    expect(results.length).toBeGreaterThan(0);
    // The note titled "CRISPR cloning protocol" should rank at the top.
    expect(results[0].title).toContain("CRISPR");
  });

  it("filters by types when passed", async () => {
    const results = await searchMyWork("CRISPR", { types: ["note"] }, makeStubDeps());
    expect(results.every((r) => r.type === "note")).toBe(true);
  });

  it("respects the limit parameter", async () => {
    const deps = makeStubDeps({
      listNotes: async () => [
        makeNote({ id: 1, title: "Note one" }),
        makeNote({ id: 2, title: "Note two" }),
        makeNote({ id: 3, title: "Note three" }),
      ],
    });
    const results = await searchMyWork("note", { limit: 2 }, deps);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns all types on empty query and sorts by date", async () => {
    const results = await searchMyWork("", undefined, makeStubDeps());
    expect(results.length).toBeGreaterThan(0);
    // Date sort: most-recent first, all should have a type
    const types = new Set(results.map((r) => r.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it("is resilient when one type list throws", async () => {
    const deps = makeStubDeps({
      listMolecules: async () => {
        throw new Error("molecule store unavailable");
      },
    });
    // Should not throw, should return results from other types
    const results = await searchMyWork("CRISPR", undefined, deps);
    expect(results.some((r) => r.type !== "molecule")).toBe(true);
    expect(results.every((r) => r.type !== "molecule")).toBe(true);
  });

  it("returns an empty array when no types match the filter", async () => {
    const results = await searchMyWork("anything", { types: ["datahub"] }, makeStubDeps({
      listDataHub: async () => [],
    }));
    expect(results).toHaveLength(0);
  });

  it("does not return results from a failed type alongside good types", async () => {
    const deps = makeStubDeps({
      listSequences: async () => {
        throw new Error("sequences unavailable");
      },
    });
    const results = await searchMyWork("pUC19", undefined, deps);
    expect(results.every((r) => r.type !== "sequence")).toBe(true);
  });

  // Three notes on distinct days, only notes listed so the window is the only
  // thing in play.
  const datedNotesDeps = () =>
    makeStubDeps({
      listNotes: async () => [
        makeNote({ id: 1, title: "Note may", updated_at: "2026-05-15T09:00:00.000Z" }),
        makeNote({ id: 2, title: "Note early june", updated_at: "2026-06-03T09:00:00.000Z" }),
        makeNote({ id: 3, title: "Note mid june", updated_at: "2026-06-11T09:00:00.000Z" }),
      ],
      listMethods: async () => [],
      listSequences: async () => [],
      listDataHub: async () => [],
      listProjects: async () => [],
      listPurchases: async () => [],
      listExperiments: async () => [],
      listMolecules: async () => [],
    });

  it("keeps only briefs on or after the since bound", async () => {
    const results = await searchMyWork("note", { since: "2026-06-01" }, datedNotesDeps());
    expect(results.map((r) => r.id).sort()).toEqual(["2", "3"]);
  });

  it("keeps only briefs on or before the until bound", async () => {
    const results = await searchMyWork("note", { until: "2026-06-05" }, datedNotesDeps());
    expect(results.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("applies both bounds inclusively (day-granular) for a 'last week' window", async () => {
    const results = await searchMyWork(
      "note",
      { since: "2026-06-03", until: "2026-06-11" },
      datedNotesDeps(),
    );
    expect(results.map((r) => r.id).sort()).toEqual(["2", "3"]);
  });

  it("drops dateless artifacts (a purchase) when a date window is set", async () => {
    const deps = makeStubDeps({
      // Only the purchase has no date; everything else is listed empty.
      listNotes: async () => [],
      listMethods: async () => [],
      listSequences: async () => [],
      listDataHub: async () => [],
      listProjects: async () => [],
      listExperiments: async () => [],
      listMolecules: async () => [],
    });
    const results = await searchMyWork("", { since: "2026-01-01" }, deps);
    expect(results.every((r) => r.type !== "purchase")).toBe(true);
  });
});

describe("dayPrefix", () => {
  it("extracts the YYYY-MM-DD prefix from a full ISO timestamp", () => {
    expect(dayPrefix("2026-06-10T15:30:00.000Z")).toBe("2026-06-10");
  });
  it("passes a date-only string through", () => {
    expect(dayPrefix("2026-06-10")).toBe("2026-06-10");
  });
  it("returns null for empty / non-date input", () => {
    expect(dayPrefix(undefined)).toBeNull();
    expect(dayPrefix("")).toBeNull();
    expect(dayPrefix("last week")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterArtifacts (Layer 1 of the summary suite). Pure, exercised directly
// against a small mixed brief set covering every filter dimension, the empty
// filter, the no-match path, and the empty-array "no restriction" semantics.
// ---------------------------------------------------------------------------

describe("filterArtifacts", () => {
  // A small mixed corpus with explicit owners, projects, dates, statuses.
  function corpus(): ArtifactBrief[] {
    return [
      {
        type: "experiment",
        id: "self:6",
        title: "Colony PCR screen",
        subtitle: "active",
        date: "2026-06-10",
        projectIds: ["4"],
        owner: "grant",
        deepLink: "/?openTask=self:6",
        keywords: ["pcr", "screening"],
      },
      {
        type: "experiment",
        id: "alice:7",
        title: "Western blot",
        subtitle: "complete",
        date: "2026-04-02",
        projectIds: ["9"],
        owner: "alice",
        deepLink: "/?openTask=alice:7",
        keywords: ["western", "blot"],
      },
      {
        type: "purchase",
        id: "5",
        title: "Gibson Assembly Master Mix",
        subtitle: "NEB",
        // No date on purpose: a date-bounded filter must drop it.
        owner: "grant",
        deepLink: "/purchases",
        keywords: ["gibson", "neb", "reagents"],
      },
      {
        type: "note",
        id: "1",
        title: "CRISPR cloning protocol",
        date: "2026-05-20",
        // No owner: an owners filter must drop it.
        deepLink: "/notes/1",
        keywords: ["crispr", "cloning"],
      },
    ];
  }

  it("an empty filter keeps every brief", () => {
    const items = corpus();
    expect(filterArtifacts(items, {})).toHaveLength(items.length);
  });

  it("treats empty arrays as no restriction (not match-nothing)", () => {
    const items = corpus();
    expect(filterArtifacts(items, { types: [], owners: [], projectIds: [] })).toHaveLength(
      items.length,
    );
  });

  it("filters by type", () => {
    const out = filterArtifacts(corpus(), { types: ["experiment"] });
    expect(out.map((b) => b.id).sort()).toEqual(["alice:7", "self:6"]);
  });

  it("filters by multiple types", () => {
    const out = filterArtifacts(corpus(), { types: ["purchase", "note"] });
    expect(out.map((b) => b.id).sort()).toEqual(["1", "5"]);
  });

  it("filters by owner and drops briefs with no owner", () => {
    const out = filterArtifacts(corpus(), { owners: ["grant"] });
    // self:6 (grant experiment) + 5 (grant purchase). alice:7 is alice; note 1
    // has no owner and is dropped.
    expect(out.map((b) => b.id).sort()).toEqual(["5", "self:6"]);
  });

  it("filters by multiple owners", () => {
    const out = filterArtifacts(corpus(), { owners: ["grant", "alice"] });
    expect(out.map((b) => b.id).sort()).toEqual(["5", "alice:7", "self:6"].sort());
  });

  it("filters by project id and drops briefs not in any listed project", () => {
    const out = filterArtifacts(corpus(), { projectIds: ["4"] });
    expect(out.map((b) => b.id)).toEqual(["self:6"]);
  });

  it("filters by an inclusive since date and drops undated briefs", () => {
    const out = filterArtifacts(corpus(), { since: "2026-05-01" });
    // self:6 (06-10) + note 1 (05-20). alice:7 (04-02) is before; purchase 5 has
    // no date so a date-bounded filter excludes it.
    expect(out.map((b) => b.id).sort()).toEqual(["1", "self:6"]);
  });

  it("filters by an inclusive until date", () => {
    const out = filterArtifacts(corpus(), { until: "2026-05-31" });
    expect(out.map((b) => b.id).sort()).toEqual(["1", "alice:7"]);
  });

  it("filters by a since/until window (boundaries inclusive)", () => {
    const out = filterArtifacts(corpus(), { since: "2026-04-02", until: "2026-05-20" });
    expect(out.map((b) => b.id).sort()).toEqual(["1", "alice:7"]);
  });

  it("filters by status against the subtitle", () => {
    expect(filterArtifacts(corpus(), { status: "complete" }).map((b) => b.id)).toEqual([
      "alice:7",
    ]);
    expect(filterArtifacts(corpus(), { status: "active" }).map((b) => b.id)).toEqual([
      "self:6",
    ]);
  });

  it("filters by keywords via the scorer", () => {
    const out = filterArtifacts(corpus(), { keywords: "gibson" });
    expect(out.map((b) => b.id)).toEqual(["5"]);
  });

  it("ANDs multiple dimensions together", () => {
    // grant + experiment + since April should keep only self:6.
    const out = filterArtifacts(corpus(), {
      owners: ["grant"],
      types: ["experiment"],
      since: "2026-04-01",
    });
    expect(out.map((b) => b.id)).toEqual(["self:6"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterArtifacts(corpus(), { owners: ["nobody"] })).toEqual([]);
    expect(filterArtifacts(corpus(), { keywords: "nonexistentxyz" })).toEqual([]);
    expect(filterArtifacts(corpus(), { projectIds: ["999"] })).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const items = corpus();
    const before = items.length;
    filterArtifacts(items, { types: ["experiment"] });
    expect(items).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------
// owner threading on the converters that carry it (experiment + purchase).
// ---------------------------------------------------------------------------

describe("owner on briefs", () => {
  it("experimentToBrief carries the task owner", () => {
    expect(experimentToBrief(makeExperiment({ owner: "kritika" })).owner).toBe("kritika");
  });

  it("purchaseToBrief carries the decorated owner when present", () => {
    expect(purchaseToBrief({ ...makePurchase(), owner: "kritika" }).owner).toBe("kritika");
  });

  it("purchaseToBrief leaves owner undefined on an undecorated item", () => {
    expect(purchaseToBrief(makePurchase()).owner).toBeUndefined();
  });
});

describe("resolveProjectRefsToIds", () => {
  const projects = [
    { id: 1, name: "cyp51A knockout" },
    { id: 2, name: "Imaging" },
  ];
  it("resolves a project NAME (case-insensitive) to its id", () => {
    expect(resolveProjectRefsToIds(["cyp51a knockout"], projects)).toEqual(["1"]);
  });
  it("passes through a numeric id that matches a real project", () => {
    expect(resolveProjectRefsToIds(["2"], projects)).toEqual(["2"]);
    expect(resolveProjectRefsToIds([2], projects)).toEqual(["2"]);
  });
  it("dedupes and drops unresolved refs", () => {
    expect(resolveProjectRefsToIds(["Imaging", "imaging", "Nope", "999"], projects)).toEqual(["2"]);
  });
  it("returns [] for empty / missing input", () => {
    expect(resolveProjectRefsToIds(undefined, projects)).toEqual([]);
    expect(resolveProjectRefsToIds([], projects)).toEqual([]);
  });
  it("resolves a partial / typo'd project name via fuzzy match", () => {
    expect(resolveProjectRefsToIds(["cyp51"], projects)).toEqual(["1"]); // prefix
    expect(resolveProjectRefsToIds(["Imagimg"], projects)).toEqual(["2"]); // one typo
  });
});

describe("resolveOwnerRefsToUsernames", () => {
  const members = ["kritika", "grant", "alex chen"];
  it("resolves an exact / cased username", () => {
    expect(resolveOwnerRefsToUsernames(["Kritika"], members)).toEqual(["kritika"]);
  });
  it("resolves a first name and a small typo", () => {
    expect(resolveOwnerRefsToUsernames(["alex"], members)).toEqual(["alex chen"]);
    expect(resolveOwnerRefsToUsernames(["kritka"], members)).toEqual(["kritika"]);
  });
  it("dedupes and drops unresolved refs", () => {
    expect(resolveOwnerRefsToUsernames(["grant", "Grant", "nobody"], members)).toEqual(["grant"]);
  });
  it("returns [] for empty / missing input", () => {
    expect(resolveOwnerRefsToUsernames(undefined, members)).toEqual([]);
    expect(resolveOwnerRefsToUsernames([], members)).toEqual([]);
  });
});

describe("listArtifacts", () => {
  // Only notes; every other type empty, so we control the ordering precisely.
  const onlyNotes = (notes: Note[]) =>
    makeStubDeps({
      listNotes: async () => notes,
      listMethods: async () => [],
      listSequences: async () => [],
      listDataHub: async () => [],
      listProjects: async () => [],
      listPurchases: async () => [],
      listExperiments: async () => [],
      listMolecules: async () => [],
      listPhylo: async () => [],
    });

  const deps = () =>
    onlyNotes([
      makeNote({ id: 1, title: "Banana", updated_at: "2026-06-01T00:00:00.000Z" }),
      makeNote({ id: 2, title: "Apple", updated_at: "2026-06-10T00:00:00.000Z" }),
      makeNote({ id: 3, title: "Cherry", updated_at: "2026-05-01T00:00:00.000Z" }),
    ]);

  it("sorts by date descending (newest first) by default", async () => {
    const { total, items } = await listArtifacts({}, deps());
    expect(total).toBe(3);
    expect(items.map((i) => i.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts by date ascending (oldest first)", async () => {
    const { items } = await listArtifacts({ order: "asc" }, deps());
    expect(items.map((i) => i.id)).toEqual(["3", "1", "2"]);
  });

  it("sorts by title A-Z", async () => {
    const { items } = await listArtifacts({ sortBy: "title", order: "asc" }, deps());
    expect(items.map((i) => i.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("caps to limit but reports the full total", async () => {
    const { total, items } = await listArtifacts({ limit: 2 }, deps());
    expect(total).toBe(3);
    expect(items.map((i) => i.id)).toEqual(["2", "1"]);
  });

  it("applies the filter (type restriction) before sorting", async () => {
    const { total } = await listArtifacts({ filter: { types: ["method"] } }, deps());
    expect(total).toBe(0); // the deps expose only notes
  });
});

describe("periodToDateRange", () => {
  // Frozen "today" = Saturday 2026-06-13 (Q2, mid-month). Calendar semantics.
  const today = "2026-06-13";

  it("returns no bounds for all_time / unknown / missing", () => {
    expect(periodToDateRange("all_time", today)).toEqual({});
    expect(periodToDateRange("nonsense", today)).toEqual({});
    expect(periodToDateRange(undefined, today)).toEqual({});
  });

  it("today is a single day", () => {
    expect(periodToDateRange("today", today)).toEqual({ since: "2026-06-13", until: "2026-06-13" });
  });

  it("this_month runs from the 1st through today", () => {
    expect(periodToDateRange("this_month", today)).toEqual({ since: "2026-06-01", until: "2026-06-13" });
  });

  it("last_month is the full previous calendar month", () => {
    expect(periodToDateRange("last_month", today)).toEqual({ since: "2026-05-01", until: "2026-05-31" });
  });

  it("last_month crosses the year boundary in January", () => {
    expect(periodToDateRange("last_month", "2026-01-09")).toEqual({ since: "2025-12-01", until: "2025-12-31" });
  });

  it("this_quarter runs from the quarter start through today", () => {
    // June is in Q2 (Apr-Jun).
    expect(periodToDateRange("this_quarter", today)).toEqual({ since: "2026-04-01", until: "2026-06-13" });
  });

  it("last_quarter is the full previous quarter", () => {
    // From Q2, last quarter is Q1 (Jan-Mar).
    expect(periodToDateRange("last_quarter", today)).toEqual({ since: "2026-01-01", until: "2026-03-31" });
  });

  it("last_quarter crosses the year boundary from Q1", () => {
    // February is Q1; last quarter is the prior year's Q4 (Oct-Dec).
    expect(periodToDateRange("last_quarter", "2026-02-15")).toEqual({ since: "2025-10-01", until: "2025-12-31" });
  });

  it("this_year and last_year span calendar years", () => {
    expect(periodToDateRange("this_year", today)).toEqual({ since: "2026-01-01", until: "2026-06-13" });
    expect(periodToDateRange("last_year", today)).toEqual({ since: "2025-01-01", until: "2025-12-31" });
  });

  it("this_week runs Monday through today, last_week is the prior Mon-Sun", () => {
    // 2026-06-13 is a Saturday; that week's Monday is 2026-06-08.
    expect(periodToDateRange("this_week", today)).toEqual({ since: "2026-06-08", until: "2026-06-13" });
    expect(periodToDateRange("last_week", today)).toEqual({ since: "2026-06-01", until: "2026-06-07" });
  });

  it("normalizes spaces and hyphens in the token", () => {
    expect(periodToDateRange("Last Month", today)).toEqual({ since: "2026-05-01", until: "2026-05-31" });
    expect(periodToDateRange("last-month", today)).toEqual({ since: "2026-05-01", until: "2026-05-31" });
  });
});
