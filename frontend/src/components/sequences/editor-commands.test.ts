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
  COMMAND_GROUP_ORDER,
  type EditorCommand,
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
