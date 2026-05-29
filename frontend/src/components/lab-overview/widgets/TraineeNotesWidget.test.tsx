// Trainee notes + weekly goals widget (PI beta feedback, weekly-goals
// widget, 2026-05-29; extends pi-notes-widget, 2026-05-29).
//
// Pins the things that matter:
//   1. The ExpandedView renders the lab roster (one row per OTHER member).
//   2. The privacy contract for BOTH notes AND weekly goals: clicking a
//      member surfaces ONLY records that member has SHARED with the viewer,
//      never their private / unshared records, and never records shared
//      with a DIFFERENT user.
//   3. The two widget modes: everyone mode (roster) and single-member mode
//      (config.pinnedMember set — no roster step).
//
// The privacy mechanism under test is two gates, IDENTICAL for notes and
// goals:
//   - `labApi.getNotes / getWeeklyGoals ({ shared_only: true })` (coarse
//     `is_shared` gate)
//   - `canRead(record, viewer)` (precise per-viewer gate)
// The mocks mirror the real `shared_only` filter so the test exercises BOTH
// gates honestly for each dataset.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Note, WeeklyGoal } from "@/lib/types";

// ── Note fixtures ─────────────────────────────────────────────────────────
// One running-log note morgan shared with the whole lab ("*"), one note
// morgan shared explicitly with the PI (pat), one PRIVATE morgan note, and
// one note morgan shared only with a DIFFERENT member (alex).
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

// ── Weekly-goal fixtures ──────────────────────────────────────────────────
// Mirror the note fixtures' sharing shapes so the SAME two gates are
// exercised: whole-lab, PI-explicit, private, and shared-with-a-different-
// member.
const ALL_GOALS: WeeklyGoal[] = [
  {
    id: 10,
    owner: "morgan",
    text: "Finish the aim-2 western blots",
    week_of: "2026-05-25",
    is_complete: false,
    created_at: "2026-05-25T09:00:00.000Z",
    created_by: "morgan",
    is_shared: true,
    shared_with: [{ username: "*", level: "read" }],
  },
  {
    id: 11,
    owner: "morgan",
    text: "Draft committee-meeting slides (for PI)",
    week_of: "2026-05-25",
    is_complete: true,
    created_at: "2026-05-25T09:05:00.000Z",
    created_by: "morgan",
    is_shared: true,
    shared_with: [{ username: "pat", level: "read" }],
  },
  {
    id: 12,
    owner: "morgan",
    text: "SECRET private weekly goal",
    week_of: "2026-05-25",
    is_complete: false,
    created_at: "2026-05-25T09:10:00.000Z",
    created_by: "morgan",
    is_shared: false,
    shared_with: [],
  },
  {
    id: 13,
    owner: "morgan",
    text: "Goal shared only with alex",
    week_of: "2026-05-25",
    is_complete: false,
    created_at: "2026-05-25T09:15:00.000Z",
    created_by: "morgan",
    is_shared: true,
    shared_with: [{ username: "alex", level: "read" }],
  },
];

const { getNotes, getWeeklyGoals } = vi.hoisted(() => ({
  // Mirror the real shared_only semantics for BOTH datasets: shared_only
  // returns only records whose is_shared flag is set (GATE 1). Private
  // records never come back from these calls.
  getNotes: vi.fn(
    async (params?: { shared_only?: boolean }): Promise<Note[]> => {
      if (params?.shared_only) return ALL_NOTES.filter((n) => n.is_shared);
      return ALL_NOTES;
    },
  ),
  getWeeklyGoals: vi.fn(
    async (params?: { shared_only?: boolean }): Promise<WeeklyGoal[]> => {
      if (params?.shared_only) return ALL_GOALS.filter((g) => g.is_shared);
      return ALL_GOALS;
    },
  ),
}));

vi.mock("@/lib/local-api", () => ({
  labApi: { getNotes, getWeeklyGoals },
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

// UserAvatar reaches into the file system for colors; stub it.
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`avatar-${username}`} />
  ),
}));

// NoteDetailPopup pulls a heavy dependency tree; stub it to a marker.
vi.mock("@/components/NoteDetailPopup", () => ({
  default: ({ note }: { note: Note }) => (
    <div data-testid="note-detail-popup">{note.title}</div>
  ),
}));

// Tooltip wraps children; stub to a passthrough so buttons stay queryable.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import TraineeNotesWidget from "./TraineeNotesWidget";
import type { WidgetInstanceConfig } from "@/lib/settings/user-settings";

function renderWidget(config?: WidgetInstanceConfig) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TraineeNotesWidget surface="canvas" config={config} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getNotes.mockClear();
  getWeeklyGoals.mockClear();
  viewerRef.username = "pat";
  accountTypeRef.value = "lab_head";
});

describe("TraineeNotesWidget — roster + privacy (everyone mode)", () => {
  it("renders the roster of other lab members (not the viewer)", async () => {
    renderWidget();
    expect(
      await screen.findByTestId("trainee-notes-member-morgan"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("trainee-notes-member-alex"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("trainee-notes-member-pat")).toBeNull();
  });

  it("surfaces ONLY notes the member shared with the viewer, never private notes", async () => {
    renderWidget();
    fireEvent.click(await screen.findByTestId("trainee-notes-member-morgan"));

    expect(
      await screen.findByText("1:1 running log — morgan"),
    ).toBeInTheDocument();
    expect(screen.getByText("Thesis aim memo (for PI)")).toBeInTheDocument();
    // GATE 1 keeps the private note out of the dataset entirely.
    expect(screen.queryByText("SECRET private morgan draft")).toBeNull();
  });

  it("surfaces ONLY weekly goals the member shared with the viewer, never private goals", async () => {
    renderWidget();
    fireEvent.click(await screen.findByTestId("trainee-notes-member-morgan"));

    // Whole-lab goal and PI-explicit goal are visible.
    expect(
      await screen.findByText("Finish the aim-2 western blots"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Draft committee-meeting slides (for PI)"),
    ).toBeInTheDocument();
    // The PRIVATE goal must NEVER appear — GATE 1 (shared_only) keeps it
    // out of the dataset entirely.
    expect(screen.queryByText("SECRET private weekly goal")).toBeNull();
  });

  it("never surfaces a goal shared with a DIFFERENT member (canRead gate)", async () => {
    // View as a regular member 'alex' so canRead does the heavy lifting.
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderWidget();

    fireEvent.click(await screen.findByTestId("trainee-notes-member-morgan"));

    // alex sees the whole-lab goal and the goal shared with alex.
    expect(
      await screen.findByText("Finish the aim-2 western blots"),
    ).toBeInTheDocument();
    expect(screen.getByText("Goal shared only with alex")).toBeInTheDocument();
    // alex must NOT see the PI-only goal nor the private one.
    expect(
      screen.queryByText("Draft committee-meeting slides (for PI)"),
    ).toBeNull();
    expect(screen.queryByText("SECRET private weekly goal")).toBeNull();
  });

  it("never surfaces a note shared with a DIFFERENT member (canRead gate)", async () => {
    viewerRef.username = "alex";
    accountTypeRef.value = "member";
    renderWidget();

    fireEvent.click(await screen.findByTestId("trainee-notes-member-morgan"));

    expect(
      await screen.findByText("1:1 running log — morgan"),
    ).toBeInTheDocument();
    expect(screen.getByText("Shared-with-alex-only note")).toBeInTheDocument();
    expect(screen.queryByText("Thesis aim memo (for PI)")).toBeNull();
    expect(screen.queryByText("SECRET private morgan draft")).toBeNull();
  });

  it("links through to the note detail popup on row click", async () => {
    renderWidget();
    fireEvent.click(await screen.findByTestId("trainee-notes-member-morgan"));
    fireEvent.click(await screen.findByTestId("trainee-notes-note-2"));
    const popup = await screen.findByTestId("note-detail-popup");
    expect(popup).toHaveTextContent("Thesis aim memo (for PI)");
  });
});

describe("TraineeNotesWidget — single-member mode (config.pinnedMember)", () => {
  it("shows the pinned member directly with no roster step", async () => {
    renderWidget({ pinnedMember: "morgan" });

    // The pinned member's shared notes + goals show immediately — no
    // roster, no member-row click needed.
    expect(
      await screen.findByText("1:1 running log — morgan"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Finish the aim-2 western blots"),
    ).toBeInTheDocument();
    // Roster rows must NOT be present in single-member mode.
    expect(screen.queryByTestId("trainee-notes-member-alex")).toBeNull();
    expect(screen.queryByTestId("trainee-notes-member-morgan")).toBeNull();
  });

  it("enforces the SAME privacy gates in single-member mode", async () => {
    renderWidget({ pinnedMember: "morgan" });

    await screen.findByText("1:1 running log — morgan");
    // Private records never leak even when the widget is pinned to that
    // exact member.
    expect(screen.queryByText("SECRET private morgan draft")).toBeNull();
    expect(screen.queryByText("SECRET private weekly goal")).toBeNull();
  });
});
