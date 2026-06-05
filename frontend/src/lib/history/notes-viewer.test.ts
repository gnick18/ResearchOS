// Version Control Phase 1: unit tests for the read-only viewer data-prep.
//
// notes-viewer.ts is the pure backbone of the version-history sidebar: it turns
// engine HistoryRow[] + reconstructed canonical states into the grouped,
// paginated, summarized view model the component renders. These tests pin the
// projection, the one-line change summaries, the day -> session grouping, the
// pagination cutover, and the folded-rows ("summarized") group.
//
// Deterministic: ids + timestamps are injected synthetic values, `now` is a
// fixed Date, and we never assert on Date.now-derived relative strings here
// (those are exercised in the component test against absolute output).

import { describe, it, expect } from "vitest";
import { canonicalize } from "./canonicalize";
import type {
  BoundarySnapshotRow,
  DeltaRow,
  GenesisRow,
  HistoryRow,
} from "./types";
import {
  buildVersionList,
  dayKeyOf,
  dayLabelOf,
  projectNoteState,
  sessionRangeLabel,
  SESSION_GAP_MS,
  summarizeChange,
  VERSION_PAGE_SIZE,
} from "./notes-viewer";

// A fixed "now" so day labels are deterministic.
const NOW = new Date("2026-05-29T12:00:00.000Z");

function note(fields: {
  title?: string;
  description?: string;
  entries?: { title: string; content: string }[];
}): string {
  return canonicalize({
    id: 7,
    title: fields.title ?? "Untitled",
    description: fields.description ?? "",
    entries: (fields.entries ?? []).map((e, i) => ({
      id: `e${i}`,
      title: e.title,
      date: "2026-05-29",
      content: e.content,
    })),
  });
}

function genesis(): GenesisRow {
  return {
    id: "g0",
    ts: "2026-05-27T08:00:00.000Z",
    v: 1,
    actor: "mira",
    owner: "mira",
    kind: "genesis",
    post_hash: "h",
  };
}

function delta(opts: {
  id: string;
  ts: string;
  actor?: string;
}): DeltaRow {
  return {
    id: opts.id,
    ts: opts.ts,
    v: 1,
    actor: opts.actor ?? "mira",
    owner: "mira",
    kind: "update",
    delta: "@@ stub @@",
    post_hash: "h",
  };
}

describe("projectNoteState", () => {
  it("projects title, description and joined entry bodies", () => {
    const state = note({
      title: "PCR run",
      description: "Tuesday batch",
      entries: [
        { title: "Setup", content: "mix master mix" },
        { title: "Run", content: "cycle 35x" },
      ],
    });
    const p = projectNoteState(state);
    expect(p.title).toBe("PCR run");
    expect(p.description).toBe("Tuesday batch");
    expect(p.entries).toHaveLength(2);
    // The body leads with the note title ("# ...") and description, then anchors
    // each entry with its heading so a title / description / running-log edit all
    // read as a localized diff (vc-final-polish sub-bot of HR, 2026-05-31).
    expect(p.body).toBe(
      "# PCR run\n\nTuesday batch\n\n## Setup\nmix master mix\n\n## Run\ncycle 35x",
    );
    expect(p.entries[0]).toEqual({ title: "Setup", content: "mix master mix" });
  });

  it("surfaces entry content in the body so a running-log entry edit diffs", () => {
    // A running log: two dated entries. Editing ONE entry's content must change
    // the projected body (it used to render empty for entry-only edits).
    const before = projectNoteState(
      note({
        title: "Lab log",
        entries: [
          { title: "May 28", content: "seeded plates" },
          { title: "May 29", content: "no growth yet" },
        ],
      }),
    );
    const after = projectNoteState(
      note({
        title: "Lab log",
        entries: [
          { title: "May 28", content: "seeded plates" },
          { title: "May 29", content: "colonies on plate 3" },
        ],
      }),
    );
    expect(after.body).not.toBe(before.body);
    expect(after.body).toContain("colonies on plate 3");
    // The unchanged entry's content is still anchored in the body.
    expect(after.body).toContain("seeded plates");
  });

  it("surfaces a title-only change in the body so it diffs (vc-final-polish)", () => {
    // A title-only edit (entries + description identical) must still change the
    // projected body, otherwise the diff renders the misleading "No tracked
    // content changed in this version" (vc-final-polish sub-bot of HR).
    const before = projectNoteState(
      note({
        title: "Old title",
        entries: [{ title: "Notes", content: "same content" }],
      }),
    );
    const after = projectNoteState(
      note({
        title: "New title",
        entries: [{ title: "Notes", content: "same content" }],
      }),
    );
    expect(after.body).not.toBe(before.body);
    expect(after.body).toContain("# New title");
    expect(before.body).toContain("# Old title");
    // Entries are still anchored in the body alongside the title.
    expect(after.body).toContain("## Notes");
    expect(after.body).toContain("same content");
  });

  it("surfaces a description-only change in the body so it diffs (vc-final-polish)", () => {
    const before = projectNoteState(
      note({
        title: "Lab log",
        description: "old summary",
        entries: [{ title: "Notes", content: "same content" }],
      }),
    );
    const after = projectNoteState(
      note({
        title: "Lab log",
        description: "new summary",
        entries: [{ title: "Notes", content: "same content" }],
      }),
    );
    expect(after.body).not.toBe(before.body);
    expect(after.body).toContain("new summary");
    expect(before.body).toContain("old summary");
    // The title heading and entries still anchor the body.
    expect(after.body).toContain("# Lab log");
    expect(after.body).toContain("## Notes");
  });

  it("degrades gracefully on empty / malformed input", () => {
    expect(projectNoteState(null)).toEqual({
      title: "",
      description: "",
      body: "",
      entries: [],
    });
    expect(projectNoteState("not json")).toEqual({
      title: "",
      description: "",
      body: "",
      entries: [],
    });
  });
});

describe("summarizeChange", () => {
  const base = projectNoteState(
    note({ title: "T", description: "D", entries: [{ title: "Notes", content: "a" }] }),
  );

  it("reports 'created note' for the first version", () => {
    expect(summarizeChange(null, base)).toBe("created note");
  });

  it("detects a title change", () => {
    const after = projectNoteState(
      note({ title: "T2", description: "D", entries: [{ title: "Notes", content: "a" }] }),
    );
    expect(summarizeChange(base, after)).toBe("changed title");
  });

  it("detects a description change", () => {
    const after = projectNoteState(
      note({ title: "T", description: "D2", entries: [{ title: "Notes", content: "a" }] }),
    );
    expect(summarizeChange(base, after)).toBe("changed description");
  });

  it("names the edited entry on a body change", () => {
    const after = projectNoteState(
      note({ title: "T", description: "D", entries: [{ title: "Notes", content: "a b c" }] }),
    );
    expect(summarizeChange(base, after)).toBe("edited Notes");
  });

  it("detects an added entry", () => {
    const after = projectNoteState(
      note({
        title: "T",
        description: "D",
        entries: [
          { title: "Notes", content: "a" },
          { title: "Day 2", content: "x" },
        ],
      }),
    );
    expect(summarizeChange(base, after)).toBe("added entry");
  });

  it("detects a removed entry", () => {
    const two = projectNoteState(
      note({
        title: "T",
        description: "D",
        entries: [
          { title: "Notes", content: "a" },
          { title: "Day 2", content: "x" },
        ],
      }),
    );
    const one = projectNoteState(
      note({ title: "T", description: "D", entries: [{ title: "Notes", content: "a" }] }),
    );
    expect(summarizeChange(two, one)).toBe("removed entry");
  });

  it("labels a restore row distinctly from a plain content edit", () => {
    // A restore writes the reverted content back, so by diff alone it looks like
    // a normal edit. The row KIND ("revert") makes it legible in the timeline
    // (vc-persona-fixes sub-bot of HR, 2026-05-30).
    const after = projectNoteState(
      note({ title: "T", description: "D", entries: [{ title: "Notes", content: "older" }] }),
    );
    expect(summarizeChange(base, after, "revert")).toBe(
      "Restored an earlier version",
    );
    // The kind takes precedence even on the first comparison (before === null).
    expect(summarizeChange(null, after, "revert")).toBe(
      "Restored an earlier version",
    );
  });

  it("labels an undo-restore row as undoing a restore", () => {
    const after = projectNoteState(
      note({ title: "T", description: "D", entries: [{ title: "Notes", content: "back" }] }),
    );
    expect(summarizeChange(base, after, "undo-revert")).toBe("Undid a restore");
  });

  it("falls back to content-diff labels when no kind / a plain update kind", () => {
    const after = projectNoteState(
      note({ title: "T2", description: "D", entries: [{ title: "Notes", content: "a" }] }),
    );
    expect(summarizeChange(base, after)).toBe("changed title");
    expect(summarizeChange(base, after, "update")).toBe("changed title");
  });
});

describe("dayKeyOf / dayLabelOf", () => {
  it("labels today, yesterday, and older days", () => {
    expect(dayLabelOf("2026-05-29T09:00:00.000Z", NOW)).toBe("Today");
    expect(dayLabelOf("2026-05-28T09:00:00.000Z", NOW)).toBe("Yesterday");
    // Older day renders a month/day label, not Today/Yesterday.
    const older = dayLabelOf("2026-05-20T09:00:00.000Z", NOW);
    expect(older).not.toBe("Today");
    expect(older).not.toBe("Yesterday");
    expect(older.length).toBeGreaterThan(0);
  });

  it("derives a stable YYYY-MM-DD key", () => {
    expect(dayKeyOf("2026-05-27T23:30:00.000Z")).toMatch(/^2026-05-2[78]$/);
  });
});

describe("buildVersionList — grouping + HEAD", () => {
  it("lists delta rows newest-first and marks the newest as HEAD", () => {
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: "2026-05-29T09:00:00.000Z" }),
      delta({ id: "r2", ts: "2026-05-29T09:05:00.000Z" }),
      delta({ id: "r3", ts: "2026-05-29T09:10:00.000Z" }),
    ];
    const model = buildVersionList(rows, NOW, {
      r1: "created note",
      r2: "edited notes",
      r3: "changed title",
    });
    expect(model.totalVersions).toBe(3);
    const flat = model.days.flatMap((d) => d.sessions.flatMap((s) => s.versions));
    // Newest-first.
    expect(flat.map((v) => v.rowId)).toEqual(["r3", "r2", "r1"]);
    expect(flat[0].isHead).toBe(true);
    expect(flat[1].isHead).toBe(false);
    // versionIndex is the file index (so reconstructState can be called).
    expect(flat[0].versionIndex).toBe(3);
    expect(flat[2].versionIndex).toBe(1);
  });

  it("groups by day, newest day first", () => {
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: "2026-05-27T09:00:00.000Z" }),
      delta({ id: "r2", ts: "2026-05-28T09:00:00.000Z" }),
      delta({ id: "r3", ts: "2026-05-29T09:00:00.000Z" }),
    ];
    const model = buildVersionList(rows, NOW, {});
    expect(model.days.map((d) => d.label)).toEqual([
      "Today",
      "Yesterday",
      // the 27th renders an absolute label
      model.days[2].label,
    ]);
    expect(model.days[2].label).not.toBe("Today");
    expect(model.days[2].label).not.toBe("Yesterday");
  });

  it("collapses a contiguous same-editor run into one expandable session", () => {
    const rows: HistoryRow[] = [genesis()];
    for (let k = 1; k <= 5; k++) {
      rows.push(
        delta({
          id: `r${k}`,
          ts: `2026-05-29T09:0${k}:00.000Z`,
          actor: "morgan",
        }),
      );
    }
    const model = buildVersionList(rows, NOW, {});
    expect(model.days).toHaveLength(1);
    const sessions = model.days[0].sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].collapsible).toBe(true);
    expect(sessions[0].versions).toHaveLength(5);
    // Single-author session: actors has exactly one entry.
    expect(sessions[0].actors).toEqual(["morgan"]);
    // sessionRangeLabel with a string (legacy call) OR array both work.
    expect(sessionRangeLabel(sessions[0], "Morgan")).toMatch(/^Morgan, .*, 5 versions$/);
    expect(sessionRangeLabel(sessions[0], ["Morgan"])).toMatch(/^Morgan, .*, 5 versions$/);
  });

  it("keeps edits from different authors within the gap in ONE session (collab fix)", () => {
    // Under the OLD author-change rule these would split into 2 sessions.
    // Under the new time-gap rule all three are within 10 minutes so they
    // belong to one multi-author session.
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: "2026-05-29T09:00:00.000Z", actor: "mira" }),
      delta({ id: "r2", ts: "2026-05-29T09:05:00.000Z", actor: "morgan" }),
      delta({ id: "r3", ts: "2026-05-29T09:10:00.000Z", actor: "morgan" }),
    ];
    const model = buildVersionList(rows, NOW, {});
    const sessions = model.days[0].sessions;
    // All three edits are within SESSION_GAP_MS so they collapse into one session.
    expect(sessions).toHaveLength(1);
    // All versions are present newest-first.
    expect(sessions[0].versions.map((v) => v.rowId)).toEqual(["r3", "r2", "r1"]);
    // Both authors are tracked; morgan has 2 versions so is primary.
    expect(sessions[0].actor).toBe("morgan");
    // actors is ordered by first appearance in newest-first iteration: r3=morgan
    // is the first entry processed, so morgan appears first.
    expect(sessions[0].actors).toEqual(["morgan", "mira"]);
  });

  it("splits sessions on a time gap exceeding SESSION_GAP_MS", () => {
    const gapMs = SESSION_GAP_MS + 60_000; // 31 minutes
    const t1 = new Date("2026-05-29T08:00:00.000Z");
    const t2 = new Date(t1.getTime() + gapMs); // > 30 min later
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: t1.toISOString(), actor: "mira" }),
      delta({ id: "r2", ts: t2.toISOString(), actor: "mira" }),
    ];
    const model = buildVersionList(rows, NOW, {});
    const sessions = model.days[0].sessions;
    // Same author but gap exceeded -> 2 separate sessions.
    expect(sessions).toHaveLength(2);
    // Newest-first: r2, then r1.
    expect(sessions[0].versions.map((v) => v.rowId)).toEqual(["r2"]);
    expect(sessions[1].versions.map((v) => v.rowId)).toEqual(["r1"]);
    // Each session has only one actor.
    expect(sessions[0].actors).toEqual(["mira"]);
    expect(sessions[1].actors).toEqual(["mira"]);
  });

  it("interleaved A,B,A,B within the gap collapses into ONE multi-author session", () => {
    // The core collab scenario: four edits alternating between two authors,
    // all within a 10-minute window (well under the 30-minute gap threshold).
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: "2026-05-29T09:00:00.000Z", actor: "alex" }),
      delta({ id: "r2", ts: "2026-05-29T09:02:00.000Z", actor: "morgan" }),
      delta({ id: "r3", ts: "2026-05-29T09:05:00.000Z", actor: "alex" }),
      delta({ id: "r4", ts: "2026-05-29T09:08:00.000Z", actor: "morgan" }),
    ];
    const model = buildVersionList(rows, NOW, {});
    const sessions = model.days[0].sessions;
    // All four edits are within SESSION_GAP_MS -> exactly ONE session.
    expect(sessions).toHaveLength(1);
    // All four versions present newest-first.
    expect(sessions[0].versions.map((v) => v.rowId)).toEqual(["r4", "r3", "r2", "r1"]);
    // Both authors appear in actors (ordered by first appearance, newest-first
    // means alex appears first in the iteration order).
    expect(sessions[0].actors).toContain("alex");
    expect(sessions[0].actors).toContain("morgan");
    expect(sessions[0].actors).toHaveLength(2);
    // Morgan has 2 versions and alex has 2 versions; tie broken by first appearance
    // in the newest-first iteration. Check that actor is one of the two.
    expect(["alex", "morgan"]).toContain(sessions[0].actor);
    // The session is collapsible (>= SESSION_MIN_RUN).
    expect(sessions[0].collapsible).toBe(true);
  });

  it("solo editing within the gap produces a single-author session unchanged", () => {
    // Solo use: one author, multiple close-in-time edits. Must look identical
    // to the pre-collab behavior: one session, actors.length === 1.
    const rows: HistoryRow[] = [genesis()];
    for (let k = 1; k <= 4; k++) {
      rows.push(
        delta({
          id: `r${k}`,
          ts: `2026-05-29T10:0${k}:00.000Z`,
          actor: "mira",
        }),
      );
    }
    const model = buildVersionList(rows, NOW, {});
    const sessions = model.days[0].sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].actors).toEqual(["mira"]);
    expect(sessions[0].actor).toBe("mira");
    expect(sessions[0].collapsible).toBe(true);
    // Label is identical to the old format for a solo session.
    expect(sessionRangeLabel(sessions[0], ["Mira"])).toMatch(/^Mira, .*, 4 versions$/);
  });
});

describe("sessionRangeLabel — multi-author formats", () => {
  function fakeSession(actors: string[]): import("./notes-viewer").SessionGroup {
    return {
      actor: actors[0],
      actors,
      owner: "mira",
      versions: Array.from({ length: 3 }, (_, i) => ({
        rowId: `r${i}`,
        versionIndex: i + 1,
        ts: `2026-05-29T09:0${i}:00.000Z`,
        actor: actors[i % actors.length],
        owner: "mira",
        isHead: false,
        summary: "edited",
      })),
      startTs: "2026-05-29T09:00:00.000Z",
      endTs: "2026-05-29T09:02:00.000Z",
      collapsible: true,
    };
  }

  it("single author renders exactly as before (no visual change)", () => {
    const s = fakeSession(["morgan"]);
    expect(sessionRangeLabel(s, ["Morgan"])).toMatch(/^Morgan, .*, 3 versions$/);
    // Legacy string argument also works.
    expect(sessionRangeLabel(s, "Morgan")).toMatch(/^Morgan, .*, 3 versions$/);
  });

  it("two authors renders 'A & B, ...'", () => {
    const s = fakeSession(["morgan", "alex"]);
    expect(sessionRangeLabel(s, ["Morgan", "Alex"])).toMatch(
      /^Morgan & Alex, .*, 3 versions$/,
    );
  });

  it("three or more authors renders 'A +N others, ...'", () => {
    const s = fakeSession(["morgan", "alex", "mira"]);
    expect(sessionRangeLabel(s, ["Morgan", "Alex", "Mira"])).toMatch(
      /^Morgan \+2 others, .*, 3 versions$/,
    );

    const s4 = fakeSession(["morgan", "alex", "mira", "lee"]);
    expect(sessionRangeLabel(s4, ["Morgan", "Alex", "Mira", "Lee"])).toMatch(
      /^Morgan \+3 others, .*, 3 versions$/,
    );
  });
});

describe("buildVersionList — pagination", () => {
  it("shows the first PAGE_SIZE newest and flags hasMore", () => {
    const rows: HistoryRow[] = [genesis()];
    const total = VERSION_PAGE_SIZE + 10;
    for (let k = 1; k <= total; k++) {
      // Spread across one day so grouping does not change the count.
      rows.push(delta({ id: `r${k}`, ts: `2026-05-29T00:00:${String(k).padStart(2, "0")}.000Z` }));
    }
    const page1 = buildVersionList(rows, NOW, {}, 1);
    const shown1 = page1.days.flatMap((d) => d.sessions.flatMap((s) => s.versions));
    expect(shown1).toHaveLength(VERSION_PAGE_SIZE);
    expect(page1.hasMore).toBe(true);
    expect(page1.totalVersions).toBe(total);
    // Newest row is shown on page 1.
    expect(shown1[0].rowId).toBe(`r${total}`);

    const page2 = buildVersionList(rows, NOW, {}, 2);
    const shown2 = page2.days.flatMap((d) => d.sessions.flatMap((s) => s.versions));
    expect(shown2).toHaveLength(total);
    expect(page2.hasMore).toBe(false);
  });
});

describe("buildVersionList — folded-rows summary", () => {
  function boundary(): BoundarySnapshotRow {
    return {
      id: "b0",
      ts: "2026-05-20T08:00:00.000Z",
      v: 1,
      actor: "compaction",
      owner: "mira",
      kind: "boundary_snapshot",
      state: note({ title: "old" }),
      state_hash: "h",
      compacted_row_count: 401,
      compacted_range: {
        from_id: "g0",
        to_id: "r400",
        from_ts: "2026-05-01T00:00:00.000Z",
        to_ts: "2026-05-20T08:00:00.000Z",
      },
    };
  }

  it("surfaces a summarized group when a boundary snapshot is the anchor", () => {
    const rows: HistoryRow[] = [
      boundary(),
      delta({ id: "r401", ts: "2026-05-29T09:00:00.000Z" }),
    ];
    const model = buildVersionList(rows, NOW, { r401: "edited notes" });
    expect(model.summarized).not.toBeNull();
    expect(model.summarized?.compactedRowCount).toBe(401);
    // The boundary itself is NOT a selectable version row.
    expect(model.totalVersions).toBe(1);
    const flat = model.days.flatMap((d) => d.sessions.flatMap((s) => s.versions));
    expect(flat.map((v) => v.rowId)).toEqual(["r401"]);
  });

  it("has no summarized group for an un-compacted file", () => {
    const rows: HistoryRow[] = [
      genesis(),
      delta({ id: "r1", ts: "2026-05-29T09:00:00.000Z" }),
    ];
    const model = buildVersionList(rows, NOW, {});
    expect(model.summarized).toBeNull();
  });
});
