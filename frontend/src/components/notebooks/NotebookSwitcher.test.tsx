// Shared Notebooks Phase 2 (notebooks-phase2 sub-bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// Exercises the NOTEBOOK-AWARE Notes tab:
//   1. The switcher renders a "Personal" chip plus one chip per shared
//      notebook the viewer is in (labApi.getSharedNotebooks).
//   2. Personal is selected by default and shows the personal notes list
//      (notesApi.list), completely unchanged.
//   3. Selecting a notebook chip swaps in the SHARED-NOTEBOOK VIEW: the
//      "Always shared with <other member>" banner + that notebook's notes
//      (labApi.getNotebookNotes) and weekly tasks (getNotebookWeeklyTasks).
//   4. Adding a weekly task routes through sharedNotebooksApi.createWeeklyTask
//      with the notebook id; toggling a task routes through the OWNER-ROUTED
//      sharedNotebooksApi.updateWeeklyTask.
//   5. "Start a shared notebook" opens the person picker (roster from
//      usersApi.list, self excluded) and creating one selects it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Note, SharedNotebook, WeeklyGoal } from "@/lib/types";

const {
  notesList,
  getSharedNotebooks,
  getNotebookNotes,
  getNotebookWeeklyTasks,
  getNotes,
  nbCreate,
  nbCreateNote,
  nbCreateWeeklyTask,
  nbUpdateWeeklyTask,
  wgDelete,
  usersList,
} = vi.hoisted(() => ({
  notesList: vi.fn(),
  getSharedNotebooks: vi.fn(),
  getNotebookNotes: vi.fn(),
  getNotebookWeeklyTasks: vi.fn(),
  getNotes: vi.fn(),
  nbCreate: vi.fn(),
  nbCreateNote: vi.fn(),
  nbCreateWeeklyTask: vi.fn(),
  nbUpdateWeeklyTask: vi.fn(),
  wgDelete: vi.fn(),
  usersList: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  notesApi: { list: notesList },
  labApi: {
    getSharedNotebooks,
    getNotebookNotes,
    getNotebookWeeklyTasks,
    getNotes,
  },
  sharedNotebooksApi: {
    create: nbCreate,
    createNote: nbCreateNote,
    createWeeklyTask: nbCreateWeeklyTask,
    updateWeeklyTask: nbUpdateWeeklyTask,
  },
  weeklyGoalsApi: { delete: wgDelete },
  usersApi: { list: usersList },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "student" }),
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Heavy children: stub to keep the test on the switcher + view orchestration.
vi.mock("@/components/NoteDetailPopup", () => ({
  default: () => <div data-testid="note-popup" />,
}));
vi.mock("@/components/NoteCard", () => ({
  default: ({ note }: { note: Note }) => (
    <div data-testid={`note-card-${note.id}`}>{note.title}</div>
  ),
}));
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`avatar-${username}`} />
  ),
}));

vi.mock("@/lib/weekly-goals/week", async () => {
  const actual = await vi.importActual<typeof import("@/lib/weekly-goals/week")>(
    "@/lib/weekly-goals/week",
  );
  return { ...actual, mondayOf: () => "2026-06-01" };
});

import NotesPanel from "@/components/NotesPanel";

const NOTEBOOK: SharedNotebook = {
  id: "nb-1",
  members: ["student", "pi"],
  created_by: "student",
  created_at: "2026-06-02T00:00:00.000Z",
  owner: "student",
  title: "Thesis 1:1",
  shared_with: [
    { username: "student", level: "edit" },
    { username: "pi", level: "edit" },
  ],
};

const personalNote: Note = {
  id: 1,
  title: "My personal note",
  description: "",
  is_running_log: false,
  is_shared: false,
  entries: [],
  comments: [],
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  username: "student",
};

const notebookNote: Note = {
  ...personalNote,
  id: 2,
  title: "PI feedback",
  username: "pi",
  notebook_id: "nb-1",
};

const notebookTask: WeeklyGoal = {
  id: 50,
  owner: "pi",
  text: "Run the gel by Friday",
  week_of: "2026-06-01",
  is_complete: false,
  created_at: "2026-06-02T00:00:00.000Z",
  created_by: "pi",
  is_shared: true,
  shared_with: [
    { username: "student", level: "edit" },
    { username: "pi", level: "edit" },
  ],
  notebook_id: "nb-1",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  notesList.mockResolvedValue([personalNote]);
  getSharedNotebooks.mockResolvedValue([NOTEBOOK]);
  getNotebookNotes.mockResolvedValue([notebookNote]);
  getNotebookWeeklyTasks.mockResolvedValue([notebookTask]);
  getNotes.mockResolvedValue([]);
  usersList.mockResolvedValue({
    users: ["student", "pi", "other"],
    current_user: "student",
  });
  nbCreate.mockResolvedValue({ ...NOTEBOOK, id: "nb-new", members: ["student", "other"] });
  nbCreateWeeklyTask.mockResolvedValue(notebookTask);
  nbUpdateWeeklyTask.mockResolvedValue({ ...notebookTask, is_complete: true });
});

describe("Notes tab notebook switcher", () => {
  it("renders Personal + a chip per shared notebook, Personal selected by default", async () => {
    renderPanel();

    // Switcher with Personal + the notebook chip.
    const personalChip = await screen.findByTestId("notebook-switch-personal");
    expect(personalChip).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("notebook-switch-nb-1")).toHaveTextContent(
      "Thesis 1:1",
    );

    // Personal view shows the personal note, NOT the notebook banner.
    expect(await screen.findByTestId("note-card-1")).toHaveTextContent(
      "My personal note",
    );
    expect(screen.queryByTestId("notebook-shared-banner")).toBeNull();
  });

  it("selecting a notebook swaps in the shared view with the always-shared banner + items", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("notebook-switch-nb-1"));

    // Banner names the OTHER member (pi, not the current user student).
    const banner = await screen.findByTestId("notebook-shared-banner");
    expect(banner).toHaveTextContent("Always shared with");
    expect(banner).toHaveTextContent("pi");

    // The notebook's note + task render; the personal note is gone.
    expect(await screen.findByTestId("note-card-2")).toHaveTextContent(
      "PI feedback",
    );
    expect(screen.queryByTestId("note-card-1")).toBeNull();
    expect(await screen.findByTestId("notebook-task-row-50")).toHaveTextContent(
      "Run the gel by Friday",
    );
  });

  it("adding a weekly task routes through createWeeklyTask with the notebook id", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("notebook-switch-nb-1"));

    const input = await screen.findByTestId("notebook-task-input");
    fireEvent.change(input, { target: { value: "New shared task" } });
    fireEvent.click(screen.getByTestId("notebook-task-add"));

    await waitFor(() =>
      expect(nbCreateWeeklyTask).toHaveBeenCalledWith({
        notebookId: "nb-1",
        text: "New shared task",
        week_of: "2026-06-01",
      }),
    );
  });

  it("toggling the other member's task routes through the OWNER-ROUTED update", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("notebook-switch-nb-1"));

    fireEvent.click(await screen.findByTestId("notebook-task-toggle-50"));
    await waitFor(() =>
      expect(nbUpdateWeeklyTask).toHaveBeenCalledWith({
        notebookId: "nb-1",
        taskId: 50,
        data: { is_complete: true },
      }),
    );
    // The other member's task has NO delete button (delete is owner-scoped).
    expect(screen.queryByTestId("notebook-task-delete-50")).toBeNull();
  });

  it("Start a shared notebook opens the picker (self excluded) and creating selects it", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("notebook-start-button"));

    const select = (await screen.findByTestId(
      "notebook-partner-select",
    )) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    // Roster excludes the current user (student); pi/other remain.
    expect(options).not.toContain("student");
    expect(options).toContain("pi");
    expect(options).toContain("other");

    fireEvent.change(select, { target: { value: "other" } });
    fireEvent.click(screen.getByTestId("notebook-create-confirm"));

    await waitFor(() =>
      expect(nbCreate).toHaveBeenCalledWith({ otherMember: "other" }),
    );
  });
});
