// Version Control Phase 1: component tests for the read-only version-history
// sidebar (the Notes pilot). The sidebar is the merge's verification backbone
// because flipping HISTORY_ENGINE_ENABLED activates data capture, so these
// tests assert the viewer reliably:
//   - lists seeded versions newest-first, labels the live HEAD "Current version",
//   - renders the predecessor diff in the document column (via onPreviewChange),
//   - toggles the compare base to "vs current",
//   - paginates ("Load older" reveals older versions),
//   - shows the empty state for a note with no history.
//
// Determinism: a REAL HistoryEngine runs over an in-memory store seeded with a
// deterministic clock (no Date.now in the engine path). We seed via
// engine.appendEdit so the on-disk row shape + reconstruction are the genuine
// Phase 0 ones; the component then consumes reconstructed STATES (never diff
// text). The profile + color hooks are mocked so resolveDisplayName / avatars
// resolve without React Query plumbing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { HistoryEngine } from "@/lib/history/engine";
import { MemoryStorage, makeClock } from "@/lib/history/test-utils";

// ── Shared in-memory engine the component will read through ──────────────────
// A module-level handle so the test body can seed before rendering and the
// mocked `@/lib/history` barrel can expose the SAME engine to the component.
let storage: MemoryStorage;
let engine: HistoryEngine;

vi.mock("@/lib/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/history")>();
  return {
    ...actual,
    // The sidebar imports { historyEngine }. Route it to our test engine via a
    // getter so each test's fresh engine (set in beforeEach) is picked up.
    get historyEngine() {
      return engine;
    },
  };
});

// Profile map: morgan is a PI, mira a member, so resolveDisplayName resolves
// the "(PI)" badge + display names deterministically.
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    mira: { username: "mira", displayName: "Mira", account_type: "member" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "lab_head" },
  }),
}));

// Color hooks read the FS; stub them so avatars render solid without a real
// metadata file.
vi.mock("@/hooks/useUserColor", () => ({
  useUserColors: (username: string) => ({
    primary: username === "morgan" ? "#10b981" : "#3b82f6",
    secondary: null,
  }),
  useUserColor: () => "#3b82f6",
}));

import NoteVersionHistorySidebar from "./NoteVersionHistorySidebar";

const OWNER = "mira";
const NOTE_ID = 47;
const NOW = new Date("2026-01-02T00:00:00.000Z");

/** Build a Note record at a given content for engine seeding. */
function noteRecord(fields: {
  title: string;
  entries: { title: string; content: string }[];
}) {
  return {
    id: NOTE_ID,
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

/** Seed `count` saves into the engine so the file holds genesis + count deltas. */
async function seed(
  saves: { title: string; content: string; actor: string }[],
): Promise<void> {
  let prev: unknown = null;
  for (const s of saves) {
    const next = noteRecord({ title: s.title, entries: [{ title: "Notes", content: s.content }] });
    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id: NOTE_ID,
      owner: OWNER,
      actor: s.actor,
      prevState: prev,
      nextState: next,
    });
    prev = next;
  }
}

beforeEach(() => {
  storage = new MemoryStorage();
  engine = new HistoryEngine({ storage, clock: makeClock() });
});

describe("NoteVersionHistorySidebar", () => {
  it("lists seeded versions newest-first and labels HEAD 'Current version'", async () => {
    // Alternate editors so each save is its own single-version session (a
    // same-editor run collapses by default; that path is covered separately).
    await seed([
      { title: "Draft", content: "line one", actor: "mira" },
      { title: "Draft", content: "line one\nline two", actor: "morgan" },
      { title: "Final", content: "line one\nline two", actor: "mira" },
    ]);

    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    // Wait for the change summaries to finish reconstructing (the row list
    // paints first with generic summaries, then the per-version reconstruction
    // fills in the real ones). The newest save changed the title.
    await waitFor(() => {
      expect(screen.getByText("changed title")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("version-row").length).toBe(3);
    // Newest row (the mira "Final" save) is the HEAD = Current version, and it
    // carries the title-change summary.
    const rows = screen.getAllByTestId("version-row");
    expect(rows[0].getAttribute("data-version-index")).toBe("3");
    expect(within(rows[0]).getByText("Current version")).toBeInTheDocument();
    expect(within(rows[0]).getByText("changed title")).toBeInTheDocument();
  });

  it("renders the predecessor diff in the document column by default", async () => {
    const previews: Array<{ before: string; after: string; editor: string }> = [];
    await seed([
      { title: "Draft", content: "alpha", actor: "mira" },
      { title: "Draft", content: "alpha\nbeta", actor: "mira" },
    ]);

    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={(p) => {
          if (p) previews.push({ before: p.before, after: p.after, editor: p.editor });
        }}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(previews.length).toBeGreaterThan(0);
    });
    // Default selection is HEAD (the "alpha\nbeta" save); compared against its
    // predecessor ("alpha"). The reconstructed states drive the diff, never
    // raw diff text.
    const latest = previews[previews.length - 1];
    // The body leads with the note title ("# Draft") and anchors each entry with
    // its "## <heading>" line (vc-final-polish sub-bot of HR, 2026-05-31).
    expect(latest.after).toBe("# Draft\n\n## Notes\nalpha\nbeta");
    expect(latest.before).toBe("# Draft\n\n## Notes\nalpha");
    expect(latest.editor).toBe("mira");
  });

  it("toggles the compare base to 'vs current'", async () => {
    const previews: Array<{ before: string; after: string }> = [];
    // Alternate editors so all three rows render inline (no session collapse).
    await seed([
      { title: "Draft", content: "alpha", actor: "mira" },
      { title: "Draft", content: "alpha\nbeta", actor: "morgan" },
      { title: "Draft", content: "alpha\nbeta\ngamma", actor: "mira" },
    ]);

    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={(p) => {
          if (p) previews.push({ before: p.before, after: p.after });
        }}
        now={NOW}
      />,
    );

    // Select the MIDDLE version (alpha\nbeta) so predecessor != current.
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(3);
    });
    const rows = screen.getAllByTestId("version-row");
    // rows[1] is the middle save.
    fireEvent.click(rows[1]);
    await waitFor(() => {
      const last = previews[previews.length - 1];
      expect(last.after).toBe("# Draft\n\n## Notes\nalpha\nbeta");
      expect(last.before).toBe("# Draft\n\n## Notes\nalpha"); // predecessor
    });

    // Flip to "compare against current". Now before === the HEAD body.
    fireEvent.click(screen.getByTestId("compare-current"));
    await waitFor(() => {
      const last = previews[previews.length - 1];
      expect(last.after).toBe("# Draft\n\n## Notes\nalpha\nbeta");
      expect(last.before).toBe("# Draft\n\n## Notes\nalpha\nbeta\ngamma"); // current HEAD
    });
  });

  it("paginates: 'Load older' reveals versions beyond the first page", async () => {
    // 55 saves -> 55 delta rows. First page shows 50 (PAGE_SIZE), so the
    // oldest 5 are hidden until "Load older". Alternate editors so each save is
    // its own single-version session and all paged rows render inline.
    const saves = Array.from({ length: 55 }, (_, i) => ({
      title: "Draft",
      content: `v${i}`,
      actor: i % 2 === 0 ? "mira" : "morgan",
    }));
    await seed(saves);

    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(50);
    });
    expect(screen.getByTestId("load-older")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("load-older"));
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(55);
    });
    // No more pages: the button is gone.
    expect(screen.queryByTestId("load-older")).not.toBeInTheDocument();
  });

  it("collapses a same-editor run into one expandable session", async () => {
    // Four consecutive mira saves on one day -> one collapsible session.
    await seed([
      { title: "Draft", content: "a", actor: "mira" },
      { title: "Draft", content: "a b", actor: "mira" },
      { title: "Draft", content: "a b c", actor: "mira" },
      { title: "Draft", content: "a b c d", actor: "mira" },
    ]);

    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    // Collapsed by default: one summary row, no expanded version rows.
    await waitFor(() => {
      expect(screen.getByTestId("session-collapsed")).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId("version-row")).toHaveLength(0);
    expect(screen.getByTestId("session-collapsed").textContent).toMatch(
      /Mira, .*, 4 versions/,
    );

    // Expanding reveals all four versions.
    fireEvent.click(screen.getByTestId("session-collapsed"));
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row")).toHaveLength(4);
    });
  });

  it("shows the empty state for a note with no history", async () => {
    // No seeding: readHistory returns [].
    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={() => {}}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("version-empty")).toBeInTheDocument();
    });
    expect(screen.getByText("No earlier versions yet")).toBeInTheDocument();
  });

  it("Esc closes the sidebar via onClose", async () => {
    const onClose = vi.fn();
    await seed([{ title: "Draft", content: "alpha", actor: "mira" }]);
    render(
      <NoteVersionHistorySidebar
        noteId={NOTE_ID}
        owner={OWNER}
        onClose={onClose}
        onPreviewChange={() => {}}
        now={NOW}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("version-row").length).toBe(1);
    });
    fireEvent.keyDown(screen.getByTestId("version-list"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
