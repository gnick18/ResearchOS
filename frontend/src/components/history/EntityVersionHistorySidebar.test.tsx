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
import { render, screen, waitFor, within } from "@testing-library/react";
import { HistoryEngine } from "@/lib/history/engine";
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

const OWNER = "mira";
const ID = 47;
const NOW = new Date("2026-01-02T00:00:00.000Z");

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

beforeEach(() => {
  storage = new MemoryStorage();
  engine = new HistoryEngine({ storage, clock: makeClock() });
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
    });
    const rows = screen.getAllByTestId("version-row");
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute("data-version-index")).toBe("3");
    expect(within(rows[0]).getByText("Current version")).toBeInTheDocument();
    expect(within(rows[0]).getByText("changed title")).toBeInTheDocument();
  });

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
    });
    const latest = previews[previews.length - 1];
    // The adapter (projectNoteState) drives the body projection: HEAD body vs
    // its predecessor body, never raw diff text.
    expect(latest.after).toBe("alpha\nbeta");
    expect(latest.before).toBe("alpha");
    expect(latest.editor).toBe("mira");
  });

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
    });
    expect(screen.getByText("No earlier versions yet")).toBeInTheDocument();
  });
});
