// Trainee notes widget (PI beta feedback, pi-notes-widget, 2026-05-29).
//
// Pins the two things that matter:
//   1. The ExpandedView renders the lab roster (one row per OTHER member).
//   2. The privacy contract: clicking a member surfaces ONLY notes that
//      member has SHARED with the viewer, never their private / unshared
//      notes, and never notes shared with a DIFFERENT user.
//
// The privacy mechanism under test is two gates:
//   - `labApi.getNotes({ shared_only: true })` (coarse `is_shared` gate)
//   - `canRead(record, viewer)` (precise per-viewer gate)
// The mock for `labApi.getNotes` mirrors the real `shared_only` filter so
// the test exercises BOTH gates honestly.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Note } from "@/lib/types";

// ── Fixtures ─────────────────────────────────────────────────────────────
// One running-log note morgan shared with the whole lab ("*"), one single
// note morgan shared explicitly with the PI (pat), one PRIVATE morgan note
// (shared_with empty, is_shared false), and one note morgan shared only
// with a DIFFERENT member (alex) — should never reach pat OR a member view
// that isn't alex.
const ALL_NOTES: Note[] = [
  {
    id: 1,
    title: "1:1 running log — morgan",
    description: "",
    is_running_log: true,
    is_shared: true,
    entries: [],
    updated_at: "2026-05-29T10:00:00.000Z",
    username: "morgan",
    shared_with: [{ username: "*", level: "read" }],
  },
  {
    id: 2,
    title: "Thesis aim memo (for PI)",
    description: "",
    is_running_log: false,
    is_shared: true,
    entries: [],
    updated_at: "2026-05-28T10:00:00.000Z",
    username: "morgan",
    shared_with: [{ username: "pat", level: "read" }],
  },
  {
    id: 3,
    title: "SECRET private morgan draft",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-05-27T10:00:00.000Z",
    username: "morgan",
    shared_with: [],
  },
  {
    id: 4,
    title: "Shared-with-alex-only note",
    description: "",
    is_running_log: false,
    is_shared: true,
    entries: [],
    updated_at: "2026-05-26T10:00:00.000Z",
    username: "morgan",
    shared_with: [{ username: "alex", level: "read" }],
  },
];

const { getNotes } = vi.hoisted(() => ({
  // Mirror the real labApi.getNotes shared_only semantics: shared_only
  // returns only notes whose is_shared flag is set (GATE 1). Private
  // notes never come back from this call.
  getNotes: vi.fn(
    async (params?: { shared_only?: boolean }): Promise<Note[]> => {
      if (params?.shared_only) return ALL_NOTES.filter((n) => n.is_shared);
      return ALL_NOTES;
    },
  ),
}));

vi.mock("@/lib/local-api", () => ({
  labApi: { getNotes },
}));

// Current user + account type are swapped per-test via these mutable refs.
const viewerRef = { username: "pat" as string };
const accountTypeRef = { value: "lab_head" as "lab_head" | "member" };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: viewerRef.username }),
}));

vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => accountTypeRef.value,
}));

// Roster source: pat (PI), morgan (trainee), alex (trainee).
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    pat: { username: "pat", displayName: "Dr. Pat", account_type: "lab_head" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "member" },
    alex: { username: "alex", displayName: "Alex", account_type: "member" },
  }),
}));

// UserAvatar reaches into the file system for colors; stub it to a noop so
// the test stays focused on the roster + notes logic.
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`avatar-${username}`} />
  ),
}));

// NoteDetailPopup pulls a heavy dependency tree; stub it to a marker that
// echoes the opened note title so we can assert the link-through.
vi.mock("@/components/NoteDetailPopup", () => ({
  default: ({ note }: { note: Note }) => (
    <div data-testid="note-detail-popup">{note.title}</div>
  ),
}));

import TraineeNotesWidget from "./TraineeNotesWidget";

function renderWidget() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TraineeNotesWidget surface="canvas" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getNotes.mockClear();
  viewerRef.username = "pat";
  accountTypeRef.value = "lab_head";
});

describe("TraineeNotesWidget — roster + privacy", () => {
  it("renders the roster of other lab members (not the viewer)", async () => {
    renderWidget();
    // morgan + alex appear; the viewer (pat) does NOT appear in the roster.
    expect(
      await screen.findByTestId("trainee-notes-member-morgan"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("trainee-notes-member-alex"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("trainee-notes-member-pat"),
    ).toBeNull();
  });

  it("surfaces ONLY notes the member shared with the viewer, never private notes", async () => {
    renderWidget();
    const memberBtn = await screen.findByTestId(
      "trainee-notes-member-morgan",
    );
    fireEvent.click(memberBtn);

    // Whole-lab ("*") note and PI-explicit note are visible.
    expect(
      await screen.findByText("1:1 running log — morgan"),
    ).toBeInTheDocument();
    expect(screen.getByText("Thesis aim memo (for PI)")).toBeInTheDocument();

    // The PRIVATE note must NEVER appear — GATE 1 (shared_only) keeps it
    // out of the dataset entirely.
    expect(
      screen.queryByText("SECRET private morgan draft"),
    ).toBeNull();
  });

  it("never surfaces a note shared with a DIFFERENT member (canRead gate)", async () => {
    // View as a regular member 'alex' so canRead does the heavy lifting
    // (no lab_head view-all). The note explicitly shared with alex shows;
    // notes shared only with pat (and the whole-lab note) behave per
    // canRead.
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderWidget();

    const memberBtn = await screen.findByTestId(
      "trainee-notes-member-morgan",
    );
    fireEvent.click(memberBtn);

    // alex sees the whole-lab note (via "*") and the note shared with alex.
    expect(
      await screen.findByText("1:1 running log — morgan"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Shared-with-alex-only note"),
    ).toBeInTheDocument();

    // alex must NOT see the note shared only with pat, nor the private one.
    expect(screen.queryByText("Thesis aim memo (for PI)")).toBeNull();
    expect(screen.queryByText("SECRET private morgan draft")).toBeNull();
  });

  it("shows an empty state for a member who has shared nothing", async () => {
    renderWidget();
    // alex (the member) has shared nothing WITH pat: note id 4 is shared
    // with alex, not pat; pat is lab_head so view-all applies — but alex
    // OWNS none of the shared notes (morgan owns them all). So alex's
    // drill-down is empty.
    const alexBtn = await screen.findByTestId("trainee-notes-member-alex");
    fireEvent.click(alexBtn);
    await waitFor(() =>
      expect(
        screen.getByText(/has not shared any notes with you yet/i),
      ).toBeInTheDocument(),
    );
  });

  it("links through to the note detail popup on row click", async () => {
    renderWidget();
    fireEvent.click(
      await screen.findByTestId("trainee-notes-member-morgan"),
    );
    fireEvent.click(await screen.findByTestId("trainee-notes-note-2"));
    const popup = await screen.findByTestId("note-detail-popup");
    expect(popup).toHaveTextContent("Thesis aim memo (for PI)");
  });
});
