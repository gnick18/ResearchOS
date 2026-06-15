// Version Control Phase 3 (shared-generalization): the generic
// EntityVersionHistorySidebar driven by the Notes adapter (notesAdapter) must
// reproduce the Notes pilot behavior, since NoteVersionHistorySidebar is now a
// thin wrapper over it. This is the per-chip "renders with the Notes adapter"
// assertion that complements the full NoteVersionHistorySidebar canary suite:
//   - lists seeded versions newest-first + labels the live HEAD "Current version",
//   - renders the predecessor diff in the document column (via onPreviewChange),
//   - shows the empty state for a record with no history.
//
// Same deterministic harness as the wrapper test: a REAL HistoryEngine over an
// in-memory store seeded with a deterministic clock; the component consumes
// reconstructed STATES (never diff text). Profile + color hooks are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { HistoryEngine } from "@/lib/history/engine";
import { canonicalize } from "@/lib/history/canonicalize";
import { MemoryStorage, makeClock } from "@/lib/history/test-utils";

let storage: MemoryStorage;
let engine: HistoryEngine;

vi.mock("@/lib/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/history")>();
  return {
    ...actual,
    get historyEngine() {
      return engine;
    },
  };
});

vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    mira: { username: "mira", displayName: "Mira", account_type: "member" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "lab_head" },
  }),
}));

vi.mock("@/hooks/useUserColor", () => ({
  useUserColors: (username: string) => ({
    primary: username === "morgan" ? "#10b981" : "#3b82f6",
    secondary: null,
  }),
  useUserColor: () => "#3b82f6",
}));

import EntityVersionHistorySidebar from "./EntityVersionHistorySidebar";
import { notesAdapter } from "@/lib/history/notes-viewer";
import { makeSpacedClock } from "@/lib/history/test-utils";

const OWNER = "mira";
const ID = 47;
const NOW = new Date("2026-01-02T00:00:00.000Z");

// Every assertion here gates on a REAL HistoryEngine reconstruction pass (the
// rows paint first, then per-version state reconstruction fills in the diffs /
// summaries a tick later). In isolation that resolves in well under a second,
// but under full-suite parallel load the workers contend for CPU and the
// reconstruction can overrun waitFor's 1000ms default, making this file
// intermittently flaky while passing every time alone. We can't fake-timer past
// it (the gate is real async reconstruction work, which fake timers would
// stall), so give the reconstruction-gated waits a generous ceiling: each
// waitFor still resolves the instant the work lands, it just no longer gives up
// early under load. IMPORT_WAIT must stay below the per-test timeout so a real
// failure surfaces the concrete assertion, not an opaque test-level timeout.
const IMPORT_WAIT = { timeout: 15000 } as const;
const TEST_TIMEOUT = 20000;

function noteRecord(fields: {
  title: string;
  entries: { title: string; content: string }[];
}) {
  return {
    id: ID,
    title: fields.title,
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: fields.entries.map((e, i) => ({
      id: `e${i}`,
      title: e.title,
      date: "2026-01-01",
      content: e.content,
    })),
    username: OWNER,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

async function seed(
  saves: { title: string; content: string; actor: string }[],
): Promise<void> {
  let prev: unknown = null;
  for (const s of saves) {
    const next = noteRecord({ title: s.title, entries: [{ title: "Notes", content: s.content }] });
    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id: ID,
      owner: OWNER,
      actor: s.actor,
      prevState: prev,
      nextState: next,
    });
    prev = next;
  }
}

/**
 * Seed the BARE-GENESIS case (the create-note-then-edit P0): a note that
 * already exists (non-empty) gets its FIRST tracked save, so genesis is anchored
 * at a non-empty pre-image (no genesis_state, hash != empty doc). Returns the
 * live HEAD record so the test can pass headCanonical the way the popup does.
 */
async function seedBareGenesis(): Promise<ReturnType<typeof noteRecord>> {
  // The note as it existed on disk BEFORE history tracking turned on.
  const created = noteRecord({ title: "Draft", entries: [{ title: "Notes", content: "alpha" }] });
  const editedOnce = noteRecord({ title: "Draft", entries: [{ title: "Notes", content: "alpha\nbeta" }] });
  const editedTwice = noteRecord({ title: "Final", entries: [{ title: "Notes", content: "alpha\nbeta" }] });
  // Distinct actors so the two saves do not collapse into one session group
  // (SESSION_MIN_RUN = 2 folds a same-actor run); the bug itself is
  // actor-agnostic. Each save renders as its own selectable version-row.
  await engine.appendEdit({
    type: "update",
    entityType: "notes",
    id: ID,
    owner: OWNER,
    actor: "mira",
    prevState: created, // non-empty pre-image -> bare non-empty genesis
    nextState: editedOnce,
  });
  await engine.appendEdit({
    type: "update",
    entityType: "notes",
    id: ID,
    owner: OWNER,
    actor: "morgan",
    prevState: editedOnce,
    nextState: editedTwice,
  });
  return editedTwice; // the live HEAD record the popup holds
}

beforeEach(() => {
  storage = new MemoryStorage();
  // Use a spaced clock (35-min intervals) so each save is a separate session
  // regardless of author. Tests that need individual version rows to be visible
  // without expanding collapsed groups depend on this.
  engine = new HistoryEngine({ storage, clock: makeSpacedClock() });
});

describe("EntityVersionHistorySidebar (Notes adapter)", () => {
  it("lists seeded versions newest-first and labels HEAD 'Current version'", async () => {
    await seed([
      { title: "Draft", content: "line one", actor: "mira" },
      { title: "Draft", content: "line one\nline two", actor: "morgan" },
      { title: "Final", content: "line one\nline two", actor: "mira" },
    ]);

    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("changed title")).toBeInTheDocument();
    }, IMPORT_WAIT);
    const rows = screen.getAllByTestId("version-row");
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute("data-version-index")).toBe("3");
    expect(within(rows[0]).getByText("Current version")).toBeInTheDocument();
    expect(within(rows[0]).getByText("changed title")).toBeInTheDocument();
  }, TEST_TIMEOUT);

  // ── Overflow guard (vc-sidebar-overflow-fix sub-bot of HR, 2026-05-31) ─────
  // The sidebar self-clamps so a LONG, fully-expanded version list scrolls
  // INSIDE the list region instead of pushing the sticky restore footer / the
  // header below the popup card. This is a flex-column contract: the root fills
  // its host (h-full flex flex-col), the version-list region is the only growing
  // child (flex-1 overflow-y-auto), and the header + compare toggle + footer are
  // pinned (flex-shrink-0). The HOST still has to give the chain a bounded height
  // (min-h-0 on the popup body row), which is what NoteDetailPopup / TaskDetail
  // Popup carry; this asserts the half of the contract the shared component owns.
  it("clamps the version-list region so the sidebar scrolls internally", async () => {
    await seed([
      { title: "Draft", content: "alpha", actor: "mira" },
      { title: "Draft", content: "alpha\nbeta", actor: "morgan" },
    ]);

    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    const sidebar = await screen.findByTestId(
      "note-version-history-sidebar",
      undefined,
      IMPORT_WAIT,
    );
    // Root: a full-height flex column. Without h-full it cannot inherit the
    // host card height; without flex-col the children do not stack.
    expect(sidebar.className).toContain("h-full");
    expect(sidebar.className).toContain("flex");
    expect(sidebar.className).toContain("flex-col");

    // The version list is the scrollable viewport (h-full + overflow-y-auto)
    // inside the ScrollArea wrapper, which is the growing flex child (flex-1
    // min-h-0) that bounds the column so the internal scroll engages.
    const list = await screen.findByTestId("version-list", undefined, IMPORT_WAIT);
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("h-full");
    expect(list.parentElement?.className).toContain("flex-1");
    expect(list.parentElement?.className).toContain("min-h-0");
  }, TEST_TIMEOUT);

  it("renders the predecessor diff in the document column via the adapter", async () => {
    const previews: Array<{ before: string; after: string; editor: string }> = [];
    await seed([
      { title: "Draft", content: "alpha", actor: "mira" },
      { title: "Draft", content: "alpha\nbeta", actor: "mira" },
    ]);

    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={(p) => {
          if (p) previews.push({ before: p.before, after: p.after, editor: p.editor });
        }}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(previews.length).toBeGreaterThan(0);
    }, IMPORT_WAIT);
    const latest = previews[previews.length - 1];
    // The adapter (projectNoteState) drives the body projection: HEAD body vs
    // its predecessor body, never raw diff text. The body leads with the note
    // title ("# Draft") and anchors each entry with its "## <heading>" line
    // (vc-final-polish sub-bot of HR, 2026-05-31) so title / running-log entry
    // edits diff as a localized change.
    expect(latest.after).toBe("# Draft\n\n## Notes\nalpha\nbeta");
    expect(latest.before).toBe("# Draft\n\n## Notes\nalpha");
    expect(latest.editor).toBe("mira");
  }, TEST_TIMEOUT);

  it("shows the empty state for a record with no history", async () => {
    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("version-empty")).toBeInTheDocument();
    }, IMPORT_WAIT);
    expect(screen.getByText("No earlier versions yet")).toBeInTheDocument();
  }, TEST_TIMEOUT);

  // ── P1: live-refresh after a restore / undo ────────────────────────────────
  // A restore / undo updates the live note, which changes headCanonical. The
  // OPEN sidebar must re-read history so the new "Restored..." / "Undid a
  // restore" row appears immediately, not only after a close + reopen
  // (vc-final-polish sub-bot of HR, 2026-05-31).
  it("re-reads history when headCanonical changes (live-refresh after restore)", async () => {
    // Alternate actors so every save renders as its own inline row (a same-actor
    // run of 2+ collapses into one session group, hiding the row count).
    await seed([
      { title: "Draft", content: "alpha", actor: "mira" },
      { title: "Draft", content: "alpha\nbeta", actor: "morgan" },
    ]);
    const readSpy = vi.spyOn(engine, "readHistory");

    const { rerender } = render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
        headCanonical="state-before-restore"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(2);
    }, IMPORT_WAIT);
    const callsAfterMount = readSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // A restore writes a new row AND changes the live note -> headCanonical
    // changes. Append a row so the re-read returns the longer history, then
    // rerender with the new headCanonical the way the popup does.
    await engine.appendEdit({
      type: "revert",
      entityType: "notes",
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: noteRecord({ title: "Draft", entries: [{ title: "Notes", content: "alpha\nbeta" }] }),
      nextState: noteRecord({ title: "Draft", entries: [{ title: "Notes", content: "alpha" }] }),
    });

    rerender(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
        headCanonical="state-after-restore"
      />,
    );

    // The changed headCanonical re-runs the read effect: readHistory is called
    // again and the new (third) restore row appears in the open timeline.
    await waitFor(() => {
      expect(readSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(3);
    }, IMPORT_WAIT);
    // The new restore row carries the "Restored an earlier version" summary once
    // reconstruction repopulates the summary map (a tick after the rows render).
    await waitFor(() => {
      expect(
        screen.getByText("Restored an earlier version"),
      ).toBeInTheDocument();
    }, IMPORT_WAIT);
  }, TEST_TIMEOUT);
});

// ── P0 regression: bare-genesis viewer flow (create-note-then-edit) ──────────
// A note created BEFORE history tracking, then edited, anchors genesis at a
// non-empty pre-image. The viewer MUST pass headCanonical = canonicalize(live
// note) or every reconstructState throws "cannot resolve anchor", the canonical
// stays "", and every diff renders empty. These tests reproduce that flow the
// way the popup does.
describe("EntityVersionHistorySidebar bare-genesis viewer flow (P0)", () => {
  it("renders EMPTY diffs without headCanonical (reproduces the bug)", async () => {
    await seedBareGenesis();
    const previews: Array<{ before: string; after: string }> = [];
    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={(p) => {
          if (p) previews.push({ before: p.before, after: p.after });
        }}
        now={NOW}
      />,
    );
    // The list still builds from the rows, but reconstruction fails so the diff
    // bodies come back empty.
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(2);
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(previews.length).toBeGreaterThan(0);
    }, IMPORT_WAIT);
    const latest = previews[previews.length - 1];
    expect(latest.after).toBe("");
    expect(latest.before).toBe("");
  }, TEST_TIMEOUT);

  it("renders NON-EMPTY diffs with headCanonical (the fix)", async () => {
    const liveHead = await seedBareGenesis();
    const previews: Array<{ before: string; after: string }> = [];
    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={(p) => {
          if (p) previews.push({ before: p.before, after: p.after });
        }}
        now={NOW}
        headCanonical={canonicalize(liveHead)}
      />,
    );
    await waitFor(() => {
      expect(previews.length).toBeGreaterThan(0);
    }, IMPORT_WAIT);
    // HEAD is auto-selected: its body is the live note, predecessor is the
    // first-save state. Both non-empty, and they differ by the note title (HEAD
    // is "Final", predecessor is "Draft"), which the title-in-body projection now
    // surfaces directly in the diff (vc-final-polish sub-bot of HR, 2026-05-31).
    const latest = previews[previews.length - 1];
    expect(latest.after).toBe("# Final\n\n## Notes\nalpha\nbeta");
    expect(latest.before).toBe("# Draft\n\n## Notes\nalpha\nbeta");
    // The HEAD row summary is a real change, not "No tracked content changed".
    const rows = screen.getAllByTestId("version-row");
    expect(rows.length).toBe(2);
    expect(within(rows[0]).getByText("Current version")).toBeInTheDocument();
    expect(within(rows[0]).getByText("changed title")).toBeInTheDocument();
  }, TEST_TIMEOUT);

  it("surfaces the restore footer on a selected non-HEAD version", async () => {
    const liveHead = await seedBareGenesis();
    render(
      <EntityVersionHistorySidebar
        entityType="notes"
        id={ID}
        owner={OWNER}
        adapter={notesAdapter}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
        headCanonical={canonicalize(liveHead)}
        canRestore
        onRestore={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(2);
    }, IMPORT_WAIT);
    const rows = screen.getAllByTestId("version-row");
    // HEAD (rows[0]) is selected by default: no footer (nothing to restore TO).
    expect(screen.queryByTestId("restore-footer")).not.toBeInTheDocument();
    // Select the older (non-HEAD) version -> the footer appears.
    const olderRow = rows.find(
      (r) => r.getAttribute("data-version-index") === "1",
    );
    expect(olderRow).toBeTruthy();
    fireEvent.click(olderRow!);
    await waitFor(() => {
      expect(screen.getByTestId("restore-footer")).toBeInTheDocument();
    }, IMPORT_WAIT);
    expect(screen.getByTestId("restore-button")).toBeInTheDocument();
  }, TEST_TIMEOUT);
});
