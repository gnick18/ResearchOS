// Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
// See docs/proposals/NOTEBOOKS_GENERALIZATION_PROPOSAL.md.
//
// Exercises the revamped NOTES-TAB LEFT RAIL of notebook containers:
//   1. The rail renders All notes / Unfiled / My notebooks / Shared, with
//      personal (1-member) and shared (2+-member) notebooks split correctly.
//   2. All notes is selected by default and shows the full local grid
//      (notesApi.list). Selecting Unfiled hides notes that carry a notebook_id.
//   3. Selecting a PERSONAL notebook filters the grid to its notes.
//   4. Selecting a SHARED notebook swaps in the dedicated SharedNotebookView
//      (cross-member reads via labApi.getNotebookNotes + the always-shared
//      banner), exactly as the 1:1 notebook did before.
//   5. "New notebook" opens the create dialog (notebooksApi.createPersonal);
//      the move-to-notebook menu routes through notebooksApi.moveNoteToNotebook.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Note, SharedNotebook } from "@/lib/types";

const {
  notesList,
  getSharedNotebooks,
  getNotebookNotes,
  getNotes,
  nbCreatePersonal,
  nbCreate,
  nbCreateNote,
  nbMoveNote,
  nbUpdateTitle,
  nbDelete,
  nbAddMember,
  usersList,
} = vi.hoisted(() => ({
  notesList: vi.fn(),
  getSharedNotebooks: vi.fn(),
  getNotebookNotes: vi.fn(),
  getNotes: vi.fn(),
  nbCreatePersonal: vi.fn(),
  nbCreate: vi.fn(),
  nbCreateNote: vi.fn(),
  nbMoveNote: vi.fn(),
  nbUpdateTitle: vi.fn(),
  nbDelete: vi.fn(),
  nbAddMember: vi.fn(),
  usersList: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  notesApi: { list: notesList },
  labApi: {
    getSharedNotebooks,
    getNotebookNotes,
    getNotes,
  },
  notebooksApi: {
    createPersonal: nbCreatePersonal,
    create: nbCreate,
    createNote: nbCreateNote,
    moveNoteToNotebook: nbMoveNote,
    updateTitle: nbUpdateTitle,
    delete: nbDelete,
    addMember: nbAddMember,
  },
  sharedNotebooksApi: {
    create: nbCreate,
    createNote: nbCreateNote,
  },
  usersApi: { list: usersList },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "student" }),
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Heavy children: stub to keep the test on the rail + view orchestration.
vi.mock("@/components/NoteDetailPopup", () => ({
  default: () => <div data-testid="note-popup" />,
}));
vi.mock("@/components/NoteCard", () => ({
  default: ({ note }: { note: Note }) => (
    <div data-testid={`note-card-${note.id}`}>{note.title}</div>
  ),
}));
vi.mock("@/components/NoteListRow", () => ({
  default: ({ note }: { note: Note }) => (
    <div data-testid={`note-row-${note.id}`}>{note.title}</div>
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

const SHARED_NB: SharedNotebook = {
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

const PERSONAL_NB: SharedNotebook = {
  id: "nb-p",
  members: ["student"],
  created_by: "student",
  created_at: "2026-06-02T00:00:00.000Z",
  owner: "student",
  title: "Biochem class",
  shared_with: [],
};

const floatingNote: Note = {
  id: 1,
  title: "Floating sticky",
  description: "",
  is_running_log: false,
  is_shared: false,
  entries: [],
  comments: [],
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  username: "student",
};

const filedNote: Note = {
  ...floatingNote,
  id: 2,
  title: "Filed in class",
  notebook_id: "nb-p",
};

const sharedNote: Note = {
  ...floatingNote,
  id: 3,
  title: "PI feedback",
  username: "pi",
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
  // The local grid sees the floating note + the personal-notebook note.
  notesList.mockResolvedValue([floatingNote, filedNote]);
  getSharedNotebooks.mockResolvedValue([SHARED_NB, PERSONAL_NB]);
  getNotebookNotes.mockResolvedValue([sharedNote]);
  getNotes.mockResolvedValue([]);
  usersList.mockResolvedValue({
    users: ["student", "pi", "other"],
    current_user: "student",
  });
  nbCreatePersonal.mockResolvedValue({ ...PERSONAL_NB, id: "nb-new", title: "Fresh" });
  nbMoveNote.mockResolvedValue({ ...filedNote, notebook_id: undefined });
});

describe("Notes tab notebook rail", () => {
  it("renders the rail buckets + splits personal vs shared notebooks", async () => {
    renderPanel();

    expect(await screen.findByTestId("rail-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("rail-unfiled")).toBeInTheDocument();
    // Personal notebook lives under My notebooks; shared under Shared.
    expect(await screen.findByTestId("rail-notebook-nb-p")).toHaveTextContent(
      "Biochem class",
    );
    expect(await screen.findByTestId("rail-notebook-nb-1")).toHaveTextContent(
      "Thesis 1:1",
    );

    // All notes shows the whole local grid.
    expect(await screen.findByTestId("note-card-1")).toBeInTheDocument();
    expect(await screen.findByTestId("note-card-2")).toBeInTheDocument();
  });

  it("Unfiled hides notes carrying a notebook_id", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("rail-unfiled"));

    expect(await screen.findByTestId("note-card-1")).toBeInTheDocument();
    expect(screen.queryByTestId("note-card-2")).toBeNull();
  });

  it("selecting a personal notebook filters the grid to its notes", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("rail-notebook-nb-p"));

    expect(await screen.findByTestId("note-card-2")).toBeInTheDocument();
    expect(screen.queryByTestId("note-card-1")).toBeNull();
    // Still the local grid, NOT the shared-notebook view.
    expect(screen.queryByTestId("notebook-shared-banner")).toBeNull();
  });

  it("selecting a shared notebook swaps in the cross-member view + banner", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("rail-notebook-nb-1"));

    const banner = await screen.findByTestId("notebook-shared-banner");
    expect(banner).toHaveTextContent("Shared with");
    expect(banner).toHaveTextContent("pi");
    expect(await screen.findByTestId("note-card-3")).toHaveTextContent(
      "PI feedback",
    );
  });

  it("New notebook opens the create dialog and routes through createPersonal", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("rail-new-notebook"));

    const input = await screen.findByTestId("notebook-form-title");
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.click(screen.getByTestId("notebook-form-save"));

    await waitFor(() =>
      expect(nbCreatePersonal).toHaveBeenCalledWith({ title: "Fresh" }),
    );
  });

  it("Start a shared notebook opens the person picker", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("rail-start-shared"));

    const select = (await screen.findByTestId(
      "notebook-partner-select",
    )) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain("student");
    expect(options).toContain("pi");
    expect(options).toContain("other");
  });

  it("Move to notebook routes a note through moveNoteToNotebook", async () => {
    renderPanel();
    // Right-click the filed note to open its tile context menu.
    fireEvent.contextMenu(await screen.findByTestId("note-card-2"));
    fireEvent.click(await screen.findByText("Move to notebook"));

    // The move menu offers "Remove from notebook" (the note is filed).
    fireEvent.click(await screen.findByTestId("move-to-remove"));

    await waitFor(() =>
      expect(nbMoveNote).toHaveBeenCalledWith(2, null, "student"),
    );
  });

  it("opening the overflow on a notebook offers rename / add member / delete", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("notebook-overflow-nb-p"));

    expect(await screen.findByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Add a member")).toBeInTheDocument();
    expect(screen.getByText("Delete notebook")).toBeInTheDocument();
  });
});
