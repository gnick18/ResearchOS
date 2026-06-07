// sequence editor master, tests for the COMMAND MODEL behind the Cmd-K palette
// (sequences redesign phase 4). These cover the pure pieces, the fuzzy matcher,
// the grouping, and the selection-biasing rule, so the palette's brain is
// verified without a DOM.

import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  scoreCommand,
  buildResults,
  flattenResults,
  suggestionIdsForSelection,
  buildPaletteResults,
  buildPaletteResultsForQuery,
  flattenPaletteItems,
  scoreSequenceNav,
  scoreArtifactNav,
  scoreNavItem,
  RECENT_RESULTS_CAP,
  COMMAND_GROUP_ORDER,
  type EditorCommand,
  type SequenceNavItem,
  type ArtifactNavItem,
  type PaletteNavGroup,
} from "./editor-commands";

const noop = () => {};

function makeCommands(): EditorCommand[] {
  return [
    { id: "primer-design", label: "Design primers", group: "Design", iconName: "primers", run: noop },
    { id: "annotate-add", label: "Add a feature", group: "Design", iconName: "plus", run: noop },
    { id: "align-open", label: "Align to another sequence", group: "Analyze", iconName: "align", run: noop },
    { id: "protein-props", label: "Protein properties", group: "Analyze", iconName: "protein", run: noop },
    { id: "protein-domains", label: "Find protein domains", group: "Analyze", iconName: "protein", keywords: "hmmer", run: noop },
    { id: "tree-explore", label: "Explore in the tree of life", group: "Analyze", iconName: "tree", run: noop },
    { id: "copy", label: "Copy", group: "Edit", iconName: "copy", shortcut: "Cmd C", run: noop },
    { id: "find", label: "Find", group: "Edit", iconName: "search", shortcut: "Cmd F", run: noop },
    { id: "view-map", label: "Go to the Map view", group: "View", iconName: "map", run: noop },
    { id: "export-fasta-sel", label: "Selected DNA (FASTA)", group: "Export", iconName: "export", run: noop },
  ];
}

describe("fuzzyScore", () => {
  it("returns a score for an in-order subsequence and null otherwise", () => {
    expect(fuzzyScore("dom", "Find protein domains")).not.toBeNull();
    expect(fuzzyScore("prim", "Design primers")).not.toBeNull();
    expect(fuzzyScore("zzz", "Design primers")).toBeNull();
  });

  it("scores a prefix higher than a deep match", () => {
    const prefix = fuzzyScore("des", "Design primers")!;
    const deep = fuzzyScore("des", "Hide the cut sites and design")!;
    expect(prefix).toBeGreaterThan(deep);
  });

  it("treats an empty query as a neutral match", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("scoreCommand", () => {
  it("matches on the keyword field as well as the label", () => {
    const cmd = makeCommands().find((c) => c.id === "protein-domains")!;
    expect(scoreCommand("hmmer", cmd)).not.toBeNull();
  });
});

describe("buildResults (empty query)", () => {
  it("groups every command under its intent group in order, no Suggested when none apply", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "", { selectionKind: "feature-other", hasOrganism: false });
    const labels = groups.map((g) => g.group);
    // feature-other suggests only "copy", which exists, so Suggested leads.
    expect(labels[0]).toBe("Suggested");
    const rest = labels.slice(1);
    // The remaining groups follow COMMAND_GROUP_ORDER (only the ones present).
    const expectedOrder = COMMAND_GROUP_ORDER.filter((g) => rest.includes(g));
    expect(rest).toEqual(expectedOrder);
  });

  it("biases Suggested for a region selection (design primers shows up first)", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "", { selectionKind: "region", hasOrganism: false });
    expect(groups[0].group).toBe("Suggested");
    const ids = groups[0].commands.map((c) => c.id);
    expect(ids).toContain("primer-design");
    expect(ids).toContain("annotate-add");
    expect(ids).toContain("copy");
  });

  it("biases Suggested for a CDS selection (protein properties + domains)", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "", { selectionKind: "feature-cds", hasOrganism: false });
    const ids = groups[0].commands.map((c) => c.id);
    expect(ids).toContain("protein-props");
    expect(ids).toContain("protein-domains");
  });

  it("adds the tree command to Suggested when an organism is attached", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "", { selectionKind: "none", hasOrganism: true });
    const ids = groups[0].commands.map((c) => c.id);
    expect(ids).toContain("tree-explore");
  });
});

describe("buildResults (query)", () => {
  it("narrows the list to fuzzy matches and drops empty groups", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "prot", { selectionKind: "none", hasOrganism: false });
    const flat = flattenResults(groups);
    const ids = flat.map((c) => c.id);
    expect(ids).toContain("protein-props");
    expect(ids).toContain("protein-domains");
    expect(ids).not.toContain("view-map");
    // No Suggested group once the user is typing.
    expect(groups.some((g) => g.group === "Suggested")).toBe(false);
  });

  it("floats the best match to the top of the flat list", () => {
    const cmds = makeCommands();
    const groups = buildResults(cmds, "copy", { selectionKind: "none", hasOrganism: false });
    const flat = flattenResults(groups);
    expect(flat[0].id).toBe("copy");
  });
});

describe("suggestionIdsForSelection", () => {
  it("returns region-relevant ids for a region", () => {
    const ids = suggestionIdsForSelection({ selectionKind: "region", hasOrganism: false });
    expect(ids).toContain("primer-design");
    expect(ids).toContain("copy");
  });
});

function makeSequenceNav(): SequenceNavItem[] {
  return [
    {
      id: "12",
      label: "pGEX-3X",
      detail: "DNA, Circular, 4,952 bp, Schistosoma japonicum",
      organism: "Schistosoma japonicum",
      iconName: "moleculeCircular",
      onRun: noop,
    },
    {
      id: "34",
      label: "GG cassette 2",
      detail: "DNA, Linear, 338 bp",
      iconName: "moleculeLinear",
      onRun: noop,
    },
  ];
}

function makeArtifactNav(): ArtifactNavItem[] {
  return [
    {
      id: "a1",
      label: "Align to pEGFP-N1-TRAP1",
      detail: "92% identity, 2 minutes ago",
      iconName: "align",
      onRun: noop,
    },
    {
      id: "a2",
      label: "Domains in EGFP",
      detail: "2 Pfam hits, 5 minutes ago",
      iconName: "protein",
      onRun: noop,
    },
  ];
}

describe("scoreSequenceNav / scoreArtifactNav", () => {
  it("matches a sequence by name and by organism", () => {
    const [seq] = makeSequenceNav();
    expect(scoreSequenceNav("pgex", seq)).not.toBeNull();
    expect(scoreSequenceNav("schistosoma", seq)).not.toBeNull();
    expect(scoreSequenceNav("zzz", seq)).toBeNull();
  });

  it("matches an artifact by title and by detail", () => {
    const [art] = makeArtifactNav();
    expect(scoreArtifactNav("align", art)).not.toBeNull();
    expect(scoreArtifactNav("identity", art)).not.toBeNull();
    expect(scoreArtifactNav("zzz", art)).toBeNull();
  });
});

describe("buildPaletteResults (empty query)", () => {
  const input = {
    commands: makeCommands(),
    sequences: makeSequenceNav(),
    artifacts: makeArtifactNav(),
    collectionLabel: "Gateway demo",
    selectionKind: "region" as const,
    hasOrganism: true,
  };

  it("orders the orienting glue, Suggested then Jump then Recent then the command groups", () => {
    const groups = buildPaletteResults(input);
    const titles = groups.map((g) => g.title);
    expect(titles[0]).toBe("Suggested");
    expect(titles[1]).toBe("Jump to a sequence");
    expect(titles[2]).toBe("Recent results");
    // The remaining titles are the command intent groups, in order.
    const rest = titles.slice(3);
    expect(rest).toEqual(COMMAND_GROUP_ORDER.filter((g) => rest.includes(g)));
  });

  it("carries the collection size in the Jump group hint", () => {
    const groups = buildPaletteResults(input);
    const jump = groups.find((g) => g.title === "Jump to a sequence");
    expect(jump?.hint).toBe("in Gateway demo (2)");
  });

  it("caps the Recent results group", () => {
    const many: ArtifactNavItem[] = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      label: `Result ${i}`,
      iconName: "align",
      onRun: noop,
    }));
    const groups = buildPaletteResults({ ...input, artifacts: many });
    const recent = groups.find((g) => g.title === "Recent results");
    expect(recent?.items.length).toBe(RECENT_RESULTS_CAP);
  });

  it("self-hides the jump and recent groups when empty", () => {
    const groups = buildPaletteResults({ ...input, sequences: [], artifacts: [] });
    const titles = groups.map((g) => g.title);
    expect(titles).not.toContain("Jump to a sequence");
    expect(titles).not.toContain("Recent results");
  });
});

describe("buildPaletteResultsForQuery (typed, across kinds)", () => {
  const input = {
    commands: makeCommands(),
    sequences: makeSequenceNav(),
    artifacts: makeArtifactNav(),
    collectionLabel: "Gateway demo",
    selectionKind: "none" as const,
    hasOrganism: false,
  };

  it("surfaces matches from commands, sequences, and artifacts together", () => {
    const groups = buildPaletteResultsForQuery(input, "p");
    const flat = flattenPaletteItems(groups);
    const kinds = new Set(flat.map((i) => i.kind));
    expect(kinds.has("command")).toBe(true);
    expect(kinds.has("sequence")).toBe(true);
    expect(kinds.has("artifact")).toBe(true);
    // No Suggested group once typing.
    expect(groups.some((g) => g.title === "Suggested")).toBe(false);
  });

  it("finds a sequence by name even when no command matches", () => {
    const groups = buildPaletteResultsForQuery(input, "pgex");
    const flat = flattenPaletteItems(groups);
    const seqHit = flat.find(
      (i) => i.kind === "sequence" && i.sequence.label === "pGEX-3X",
    );
    expect(seqHit).toBeTruthy();
  });

  it("finds an artifact by its title", () => {
    const groups = buildPaletteResultsForQuery(input, "domains in egfp");
    const flat = flattenPaletteItems(groups);
    const artHit = flat.find(
      (i) => i.kind === "artifact" && i.artifact.label === "Domains in EGFP",
    );
    expect(artHit).toBeTruthy();
  });
});

// BeakerSearch website-wide (step 3), the GENERIC per-page contract. A non-
// sequence page supplies suggestedIds + navGroups instead of the sequence shapes.
function makeNavGroups(): PaletteNavGroup[] {
  return [
    {
      title: "Milestones",
      hint: "on the chart",
      items: [
        { id: "m1", label: "Submit IRB packet", detail: "Mar 3", iconName: "list", onRun: noop },
        { id: "m2", label: "Plasmid prep deadline", keywords: "cloning", iconName: "list", onRun: noop },
      ],
    },
    {
      title: "Projects on the chart",
      items: [
        { id: "p1", label: "Mitochondria QC", iconName: "folder", tone: "project", onRun: noop },
      ],
    },
  ];
}

describe("scoreNavItem", () => {
  it("matches a nav item by its label, keywords, or detail", () => {
    const item = { id: "m2", label: "Plasmid prep deadline", keywords: "cloning", detail: "Apr 9", iconName: "list" as const, onRun: noop };
    expect(scoreNavItem("plasmid", item)).not.toBeNull();
    expect(scoreNavItem("cloning", item)).not.toBeNull();
    expect(scoreNavItem("apr", item)).not.toBeNull();
    expect(scoreNavItem("zzzz", item)).toBeNull();
  });
});

describe("generic per-page contract (empty query)", () => {
  const input = {
    commands: makeCommands(),
    suggestedIds: ["protein-domains", "view-map"],
    suggestedHint: "for this page",
    navGroups: makeNavGroups(),
    selectionKind: "none" as const,
  };

  it("lifts the page's suggestedIds into the Suggested group, in order", () => {
    const groups = buildPaletteResults(input);
    const suggested = groups.find((g) => g.title === "Suggested");
    expect(suggested?.hint).toBe("for this page");
    const labels = suggested?.items.map((i) =>
      i.kind === "command" ? i.command.label : "",
    );
    expect(labels).toEqual(["Find protein domains", "Go to the Map view"]);
  });

  it("renders the page's nav groups under their own headings", () => {
    const groups = buildPaletteResults(input);
    const titles = groups.map((g) => g.title);
    expect(titles).toContain("Milestones");
    expect(titles).toContain("Projects on the chart");
    const milestones = groups.find((g) => g.title === "Milestones");
    expect(milestones?.hint).toBe("on the chart");
    expect(milestones?.items.every((i) => i.kind === "nav")).toBe(true);
  });

  it("caps a nav group on the empty view", () => {
    const many: PaletteNavGroup[] = [
      {
        title: "Milestones",
        items: Array.from({ length: 12 }, (_, i) => ({
          id: `m${i}`,
          label: `Milestone ${i}`,
          iconName: "list" as const,
          onRun: noop,
        })),
      },
    ];
    const groups = buildPaletteResults({ ...input, navGroups: many });
    const milestones = groups.find((g) => g.title === "Milestones");
    expect(milestones!.items.length).toBeLessThanOrEqual(6);
  });
});

describe("generic per-page contract (typed)", () => {
  const input = {
    commands: makeCommands(),
    navGroups: makeNavGroups(),
    selectionKind: "none" as const,
  };

  it("scores nav items and re-buckets them under their page heading", () => {
    const groups = buildPaletteResultsForQuery(input, "plasmid");
    const flat = flattenPaletteItems(groups);
    const navHit = flat.find(
      (i) => i.kind === "nav" && i.item.label === "Plasmid prep deadline",
    );
    expect(navHit).toBeTruthy();
    const milestones = groups.find((g) => g.title === "Milestones");
    expect(milestones).toBeTruthy();
    // No Suggested group once typing.
    expect(groups.some((g) => g.title === "Suggested")).toBe(false);
  });

  it("finds a nav item by a keyword that is not in its label", () => {
    const groups = buildPaletteResultsForQuery(input, "cloning");
    const flat = flattenPaletteItems(groups);
    expect(
      flat.some((i) => i.kind === "nav" && i.item.label === "Plasmid prep deadline"),
    ).toBe(true);
  });
});

describe("page-defined command groups (step 3)", () => {
  // A page (e.g. Gantt) emits commands under its own group names. Those groups
  // render in first-appearance order, between the page nav groups and the global
  // "Go to" / "App" layer.
  const pageCommands: EditorCommand[] = [
    { id: "new-task", label: "New task", group: "Create", iconName: "plus", run: noop },
    { id: "filter-proj", label: "Filter by project", group: "Filter and scope", iconName: "list", run: noop },
    { id: "view-2w", label: "View, 2 weeks", group: "Timeline view", iconName: "list", run: noop },
    { id: "new-goal", label: "New high-level goal", group: "Create", iconName: "check", run: noop },
    { id: "goto-workbench", label: "Go to Workbench", group: "Go to", iconName: "folder", run: noop },
  ];

  it("renders page-defined groups in first-appearance order, global layer last", () => {
    const groups = buildPaletteResults({ commands: pageCommands, selectionKind: "none" });
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual(["Create", "Filter and scope", "Timeline view", "Go to"]);
  });

  it("buckets a page-defined group when typing", () => {
    const groups = buildPaletteResultsForQuery({ commands: pageCommands, selectionKind: "none" }, "view");
    const flat = flattenPaletteItems(groups);
    const hit = flat.find((i) => i.kind === "command" && i.command.label === "View, 2 weeks");
    expect(hit).toBeTruthy();
    expect(groups.some((g) => g.title === "Timeline view")).toBe(true);
  });
});
