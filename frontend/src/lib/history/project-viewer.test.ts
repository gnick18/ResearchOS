// VC Phase 3 (VC-Phase3-Project sub-bot of HR, 2026-05-31): unit tests for the
// Project viewer adapter. project-viewer.ts projects a reconstructed canonical
// Project state to a diffable body + summarizes a change into a row label. These
// pin the projection (name + the editable metadata fields: tags, color, the
// weekend / 7-day schedule flag, archive state, funding link), the tolerance to
// malformed input, and the one-line summary precedence.
//
// Pure: every projection is a caller-supplied canonical string (no engine calls,
// no Date.now), so the assertions are deterministic.

import { describe, it, expect } from "vitest";
import { canonicalize } from "./canonicalize";
import {
  projectProjectState,
  summarizeProjectChange,
  projectAdapter,
} from "./project-viewer";

function projectCanonical(fields: {
  name?: string;
  tags?: string[] | null;
  color?: string | null;
  weekend_active?: boolean;
  is_archived?: boolean;
  funding_account_id?: number | null;
}): string {
  // Use explicit `in` checks so an EXPLICIT null (the fresh-project shape:
  // tags: null / color: null) is preserved rather than coalesced to a default.
  const record: Record<string, unknown> = {
    id: 7,
    name: fields.name ?? "Aptamer screen",
    tags: "tags" in fields ? fields.tags : null,
    color: "color" in fields ? fields.color : "#3b82f6",
    weekend_active: fields.weekend_active ?? false,
    is_archived: fields.is_archived ?? false,
    archived_at: null,
    sort_order: 0,
    funding_account_id: fields.funding_account_id ?? null,
    owner: "mira",
    shared_with: [],
  };
  return canonicalize(record);
}

describe("projectProjectState", () => {
  it("projects an empty / malformed canonical to all-empty fields", () => {
    for (const bad of [null, undefined, "", "   ", "{not json"]) {
      const p = projectProjectState(bad);
      expect(p.name).toBe("");
      expect(p.tags).toEqual([]);
      expect(p.color).toBe("");
      expect(p.weekendActive).toBe(false);
      expect(p.isArchived).toBe(false);
      expect(p.fundingAccountId).toBe(null);
      expect(p.body).toBe("");
    }
  });

  it("projects name + tags + color + schedule + funding into the diff body", () => {
    const p = projectProjectState(
      projectCanonical({
        name: "Aptamer screen",
        tags: ["rna", "selex"],
        color: "#10b981",
        weekend_active: true,
        funding_account_id: 4,
      }),
    );
    expect(p.name).toBe("Aptamer screen");
    expect(p.tags).toEqual(["rna", "selex"]);
    expect(p.color).toBe("#10b981");
    expect(p.weekendActive).toBe(true);
    expect(p.fundingAccountId).toBe(4);
    // The body anchors the name as a "#" title and the metadata under "## Details"
    // so a single-field edit localizes to its own line.
    expect(p.body).toContain("# Aptamer screen");
    expect(p.body).toContain("## Details");
    expect(p.body).toContain("Tags: rna, selex");
    expect(p.body).toContain("Color: #10b981");
    expect(p.body).toContain("Schedule: 7-day (weekends active)");
    expect(p.body).toContain("Funding account: #4");
    // Not archived -> no archive status line.
    expect(p.body).not.toContain("Status: archived");
  });

  it("tolerates a null tags / null color project (the fresh-project shape)", () => {
    const p = projectProjectState(
      projectCanonical({ name: "Bare", tags: null, color: null }),
    );
    expect(p.tags).toEqual([]);
    expect(p.color).toBe("");
    expect(p.body).toContain("# Bare");
    // No tags / color lines, but the schedule default still anchors.
    expect(p.body).toContain("Schedule: weekdays only");
    expect(p.body).not.toContain("Tags:");
    expect(p.body).not.toContain("Color:");
  });

  it("surfaces the archived status line when the project is archived", () => {
    const p = projectProjectState(
      projectCanonical({ name: "Done", is_archived: true }),
    );
    expect(p.isArchived).toBe(true);
    expect(p.body).toContain("Status: archived");
  });
});

describe("summarizeProjectChange", () => {
  const base = projectProjectState(projectCanonical({ name: "A" }));

  it("special-cases restore / undo rows ahead of any content diff", () => {
    expect(summarizeProjectChange(base, base, "revert")).toBe(
      "Restored an earlier version",
    );
    expect(summarizeProjectChange(base, base, "undo-revert")).toBe(
      "Undid a restore",
    );
  });

  it("labels the first version 'created project'", () => {
    expect(summarizeProjectChange(null, base)).toBe("created project");
  });

  it("detects rename, archive toggle, tags, color, schedule, and funding edits", () => {
    const renamed = projectProjectState(projectCanonical({ name: "B" }));
    expect(summarizeProjectChange(base, renamed)).toBe("renamed project");

    const archived = projectProjectState(
      projectCanonical({ name: "A", is_archived: true }),
    );
    expect(summarizeProjectChange(base, archived)).toBe("archived project");
    expect(summarizeProjectChange(archived, base)).toBe("unarchived project");

    const tagged = projectProjectState(
      projectCanonical({ name: "A", tags: ["rna"] }),
    );
    expect(summarizeProjectChange(base, tagged)).toBe("edited tags");

    const recolored = projectProjectState(
      projectCanonical({ name: "A", color: "#ef4444" }),
    );
    expect(summarizeProjectChange(base, recolored)).toBe("changed color");

    const rescheduled = projectProjectState(
      projectCanonical({ name: "A", weekend_active: true }),
    );
    expect(summarizeProjectChange(base, rescheduled)).toBe("changed schedule");
  });

  it("distinguishes link / unlink / change of the funding account", () => {
    const unlinked = projectProjectState(
      projectCanonical({ name: "A", funding_account_id: null }),
    );
    const linked = projectProjectState(
      projectCanonical({ name: "A", funding_account_id: 4 }),
    );
    const relinked = projectProjectState(
      projectCanonical({ name: "A", funding_account_id: 9 }),
    );
    expect(summarizeProjectChange(unlinked, linked)).toBe("linked funding");
    expect(summarizeProjectChange(linked, unlinked)).toBe("unlinked funding");
    expect(summarizeProjectChange(linked, relinked)).toBe("changed funding");
  });

  it("falls back to 'edited project' when nothing detectable changed", () => {
    expect(summarizeProjectChange(base, base)).toBe("edited project");
  });

  it("prefers rename over a simultaneous tag change (precedence order)", () => {
    const renamedAndTagged = projectProjectState(
      projectCanonical({ name: "B", tags: ["rna"] }),
    );
    expect(summarizeProjectChange(base, renamedAndTagged)).toBe(
      "renamed project",
    );
  });
});

describe("projectAdapter", () => {
  it("wraps the projection + summary so the generic sidebar consumes it", () => {
    expect(projectAdapter.projectBody).toBe(projectProjectState);
    expect(projectAdapter.summarize).toBe(summarizeProjectChange);
    const p = projectAdapter.projectBody(projectCanonical({ name: "Z" }));
    expect(p.body).toContain("# Z");
  });
});
