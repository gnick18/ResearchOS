// Shared Notebook widget (Shared 1:1 Notebooks Phase 4, notebooks-phase4-widget
// sub-bot, 2026-06-02). See docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// Pins the things that matter:
//   1. The tiles + ExpandedView render; empty state when the viewer is in no
//      notebook.
//   2. Notebook SELECTION: unconfigured surfaces the FIRST notebook; the
//      per-instance `config.pinnedMember` (the partner) selects which notebook
//      when the viewer is in more than one; a STALE pinnedMember falls back to
//      the first.
//   3. The glance shows OPEN weekly tasks (completed excluded) + recent notes,
//      and the SnapshotTile headline is the open-task count.
//   4. The "Open in Notes" CTA deep-links to
//      /workbench?tab=notes&notebook=<id>.
//   5. The config picker only appears when the viewer is in 2+ notebooks, and
//      persists { pinnedMember } via onConfigChange.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Note, SharedNotebook, WeeklyGoal } from "@/lib/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Viewer "morgan" (a student) is in TWO notebooks: one with PI "pat" and one
// with co-mentor "dana". Each notebook has its own notes + tasks.

const NB_PAT: SharedNotebook = {
  id: "nb-pat",
  members: ["pat", "morgan"],
  created_by: "pat",
  created_at: "2026-06-01T10:00:00.000Z",
  owner: "pat",
  shared_with: [
    { username: "pat", level: "edit" },
    { username: "morgan", level: "edit" },
  ],
};

const NB_DANA: SharedNotebook = {
  id: "nb-dana",
  members: ["morgan", "dana"],
  created_by: "morgan",
  created_at: "2026-06-02T10:00:00.000Z",
  title: "Rotation log",
  owner: "morgan",
  shared_with: [
    { username: "morgan", level: "edit" },
    { username: "dana", level: "edit" },
  ],
};

const NOTES_BY_NB: Record<string, Note[]> = {
  "nb-pat": [
    {
      id: 1,
      title: "1:1 agenda for May 30",
      description: "",
      is_running_log: false,
      is_shared: true,
      entries: [],
      updated_at: "2026-05-30T10:00:00.000Z",
      username: "pat",
      shared_with: [],
    },
    {
      id: 2,
      title: "Aim 2 results",
      description: "",
      is_running_log: true,
      is_shared: true,
      entries: [],
      updated_at: "2026-05-31T10:00:00.000Z",
      username: "morgan",
      shared_with: [],
    },
  ],
  "nb-dana": [
    {
      id: 3,
      title: "Rotation week 1",
      description: "",
      is_running_log: false,
      is_shared: true,
      entries: [],
      updated_at: "2026-06-02T10:00:00.000Z",
      username: "dana",
      shared_with: [],
    },
  ],
};

const TASKS_BY_NB: Record<string, WeeklyGoal[]> = {
  "nb-pat": [
    {
      id: 10,
      owner: "pat",
      text: "Read the Smith 2025 paper",
      week_of: "2026-06-01",
      is_complete: false,
      created_at: "2026-06-01T09:00:00.000Z",
      created_by: "pat",
      is_shared: true,
      notebook_id: "nb-pat",
    },
    {
      id: 11,
      owner: "morgan",
      text: "Send Pat the western blot images",
      week_of: "2026-06-01",
      is_complete: false,
      created_at: "2026-06-01T09:30:00.000Z",
      created_by: "morgan",
      is_shared: true,
      notebook_id: "nb-pat",
    },
    {
      id: 12,
      owner: "morgan",
      text: "DONE: book the confocal",
      week_of: "2026-05-25",
      is_complete: true,
      created_at: "2026-05-25T09:00:00.000Z",
      created_by: "morgan",
      is_shared: true,
      notebook_id: "nb-pat",
    },
  ],
  "nb-dana": [
    {
      id: 20,
      owner: "dana",
      text: "Pick a rotation project",
      week_of: "2026-06-01",
      is_complete: false,
      created_at: "2026-06-02T09:00:00.000Z",
      created_by: "dana",
      is_shared: true,
      notebook_id: "nb-dana",
    },
  ],
};

const { getSharedNotebooks, getNotebookNotes, getNotebookWeeklyTasks } =
  vi.hoisted(() => ({
    getSharedNotebooks: vi.fn(),
    getNotebookNotes: vi.fn(),
    getNotebookWeeklyTasks: vi.fn(),
  }));

vi.mock("@/lib/local-api", () => ({
  labApi: { getSharedNotebooks, getNotebookNotes, getNotebookWeeklyTasks },
}));

const viewerRef = { username: "morgan" as string };
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: viewerRef.username }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    pat: { username: "pat", displayName: "Dr. Pat", account_type: "lab_head" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "member" },
    dana: { username: "dana", displayName: "Dana", account_type: "member" },
  }),
}));
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`avatar-${username}`} />
  ),
}));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import SharedNotebookWidget, {
  SnapshotTile,
  SidebarTile,
} from "./SharedNotebookWidget";
import type { WidgetInstanceConfig } from "@/lib/settings/user-settings";

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderExpanded(opts?: {
  config?: WidgetInstanceConfig;
  onConfigChange?: (c: WidgetInstanceConfig | null) => void;
}) {
  return render(
    <QueryClientProvider client={client()}>
      <SharedNotebookWidget
        surface="canvas"
        config={opts?.config}
        onConfigChange={opts?.onConfigChange}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getSharedNotebooks.mockReset();
  getNotebookNotes.mockReset();
  getNotebookWeeklyTasks.mockReset();
  pushMock.mockReset();
  viewerRef.username = "morgan";
  getSharedNotebooks.mockResolvedValue([NB_PAT, NB_DANA]);
  getNotebookNotes.mockImplementation(async (id: string) => NOTES_BY_NB[id] ?? []);
  getNotebookWeeklyTasks.mockImplementation(
    async (id: string) => TASKS_BY_NB[id] ?? [],
  );
});

describe("SharedNotebookWidget: empty state", () => {
  it("shows the empty prompt when the viewer is in no notebook", async () => {
    getSharedNotebooks.mockResolvedValue([]);
    renderExpanded();
    expect(
      await screen.findByTestId("shared-notebook-empty"),
    ).toBeInTheDocument();
    // The empty CTA routes to the Notes tab (to start one).
    fireEvent.click(screen.getByTestId("shared-notebook-start"));
    expect(pushMock).toHaveBeenCalledWith("/workbench?tab=notes");
  });
});

describe("SharedNotebookWidget: notebook selection", () => {
  it("unconfigured surfaces the FIRST notebook (partner shown in the banner)", async () => {
    renderExpanded();
    // First notebook is NB_PAT → partner is Pat.
    expect(await screen.findByTestId("shared-notebook-banner")).toHaveTextContent(
      "Dr. Pat",
    );
    // Its open task is shown; the completed one is excluded.
    expect(
      await screen.findByText("Read the Smith 2025 paper"),
    ).toBeInTheDocument();
    expect(screen.queryByText("DONE: book the confocal")).toBeNull();
  });

  it("config.pinnedMember selects the matching notebook (by partner)", async () => {
    renderExpanded({ config: { pinnedMember: "dana" } });
    expect(await screen.findByTestId("shared-notebook-banner")).toHaveTextContent(
      "Dana",
    );
    expect(await screen.findByText("Pick a rotation project")).toBeInTheDocument();
    // The Pat notebook's task must NOT appear.
    expect(screen.queryByText("Read the Smith 2025 paper")).toBeNull();
  });

  it("a STALE pinnedMember (no matching notebook) falls back to the first", async () => {
    renderExpanded({ config: { pinnedMember: "ghost" } });
    expect(await screen.findByTestId("shared-notebook-banner")).toHaveTextContent(
      "Dr. Pat",
    );
  });
});

describe("SharedNotebookWidget: glance content + deep-link", () => {
  it("lists open tasks and recent notes for the active notebook", async () => {
    renderExpanded();
    expect(
      await screen.findByText("Read the Smith 2025 paper"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Send Pat the western blot images"),
    ).toBeInTheDocument();
    // Notes from the same notebook.
    expect(screen.getByText("1:1 agenda for May 30")).toBeInTheDocument();
    expect(screen.getByText("Aim 2 results")).toBeInTheDocument();
  });

  it("the Open in Notes CTA deep-links to the Notes tab with the notebook id", async () => {
    renderExpanded();
    const open = await screen.findByTestId("shared-notebook-open");
    fireEvent.click(open);
    expect(pushMock).toHaveBeenCalledWith(
      "/workbench?tab=notes&notebook=nb-pat",
    );
  });
});

describe("SharedNotebookWidget: config picker", () => {
  it("shows the picker only when the viewer is in 2+ notebooks", async () => {
    renderExpanded({ onConfigChange: () => {} });
    expect(
      await screen.findByTestId("shared-notebook-pin-select"),
    ).toBeInTheDocument();
  });

  it("hides the picker when the viewer is in a single notebook", async () => {
    getSharedNotebooks.mockResolvedValue([NB_PAT]);
    renderExpanded({ onConfigChange: () => {} });
    // Wait for content to load, then assert no picker.
    await screen.findByTestId("shared-notebook-banner");
    expect(screen.queryByTestId("shared-notebook-pin-select")).toBeNull();
  });

  it("picking a notebook persists { pinnedMember } via onConfigChange", async () => {
    const onConfigChange = vi.fn();
    renderExpanded({ onConfigChange });
    const select = await screen.findByTestId("shared-notebook-pin-select");
    fireEvent.change(select, { target: { value: "dana" } });
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedMember: "dana" }),
    );
  });
});

describe("SharedNotebookWidget: tiles", () => {
  it("SnapshotTile headlines the open-task count for the active notebook", async () => {
    render(
      <QueryClientProvider client={client()}>
        <SnapshotTile surface="canvas" />
      </QueryClientProvider>,
    );
    // First notebook (Pat) has 2 open tasks.
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByText(/1:1 with Dr. Pat/)).toBeInTheDocument();
  });

  it("SidebarTile renders the open-task count", async () => {
    render(
      <QueryClientProvider client={client()}>
        <SidebarTile widgetId="shared-notebook" onClick={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2")).toBeInTheDocument();
  });
});
